"""ADMIN18-01: dataset -> native evaluator -> stored score/export under Admin."""

import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import httpx
from fastapi import FastAPI

from dbgpt.storage.metadata import DatabaseManager, Model
from dbgpt_app.pipeline_authorization import authorize_pipeline_request
from dbgpt_app.pipeline_identity import PipelineActor, PipelineIdentityMiddleware
from dbgpt_serve.evaluate.api import endpoints
from dbgpt_serve.evaluate.config import ServeConfig
from dbgpt_serve.evaluate.models.models import ServeDao, ServeEntity
from dbgpt_serve.evaluate.service.service import Service
from dbgpt_serve.agent.evaluation.evaluation import AgentOutputOperator


class Verifier:
    async def verify(self, authorization):
        role = authorization.removeprefix("Bearer ")
        return PipelineActor(id=role, role=role)


class EvaluationManagementTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        environment = patch.dict(os.environ, {"DBGPT_PIPELINE_IDENTITY_URL": "http://pipeline"})
        environment.start()
        self.addCleanup(environment.stop)
        self.db = DatabaseManager()
        self.db.init_db(f"sqlite:///{Path(self.temp.name) / 'evaluation.db'}", base=Model)
        Model.metadata.create_all(self.db.engine)
        self.addCleanup(self.db.engine.dispose)
        config = ServeConfig()
        dao = ServeDao(config)
        dao._db_manager = self.db
        self.service = object.__new__(Service)
        self.service._dao = dao
        self.service._serve_config = config
        # Only replace model generation. Native evaluator/DAG/metric computation
        # and SQL persistence run for real; no provider request or token expense.
        async def fixture_output(_self, value):
            return {"prediction": "42" if value == "answer?" else "wrong", "prediction_cost": 0}
        model = patch.object(AgentOutputOperator, "map", fixture_output)
        model.start()
        self.addCleanup(model.stop)
        app = FastAPI()
        app.include_router(endpoints.router, prefix="/api/v1/evaluate")
        app.dependency_overrides[endpoints.get_service] = lambda: self.service
        app.add_middleware(PipelineIdentityMiddleware, verifier=Verifier(), policy=authorize_pipeline_request)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://ai.test")
        self.addAsyncCleanup(self.client.aclose)

    async def request(self, method, path, role="super_admin", **kwargs):
        return await self.client.request(method, "/api/v1/evaluate" + path,
            headers={"Authorization": "Bearer " + role, "user-id": "spoofed"}, **kwargs)

    async def create_dataset(self):
        response = await self.request("POST", "/dataset/upload/content", json={
            "dataset_name": "ADMIN18 fixture", "content": json.dumps([
                {"query": "answer?", "factual": "42"}, {"query": "other?", "factual": "42"},
            ]),
        })
        self.assertEqual(200, response.status_code, response.text)
        return response.json()["data"]["code"]

    async def test_real_execution_scores_results_persistence_export_and_delete(self):
        types = await self.request("GET", "/storage/types")
        self.assertEqual([{"db": "Database JSON"}, {"file": "Upload file (database storage)"}], types.json()["data"])
        code = await self.create_dataset()
        datasets = await self.request("GET", "/datasets")
        self.assertEqual(2, datasets.json()["data"]["items"][0]["datasets_count"])
        metrics = await self.request("GET", "/metrics", params={"scene_key": "app", "scene_value": "fixture"})
        self.assertIn("ExactMatchMetric", [item["name"] for item in metrics.json()["data"]])
        result = await self.request("POST", "/start", json={"scene_key": "app", "scene_value": "fixture",
            "datasets": code, "evaluate_metrics": "ExactMatchMetric", "parallel_num": 1})
        self.assertEqual(200, result.status_code, result.text)
        run = result.json()["data"]
        self.assertEqual("complete", run["state"])
        self.assertEqual({"ExactMatchMetric": 0.5}, json.loads(run["average_score"]))
        detail = await self.request("GET", "/evaluation/detail/show", params={"evaluate_code": run["evaluate_code"]})
        self.assertEqual([1.0, 0.0], [item["score"] for item in detail.json()["data"]])
        runs = await self.request("GET", "/evaluations")
        self.assertEqual(1, runs.json()["data"]["total_count"])
        self.assertEqual(1, (await self.request("GET", "/datasets")).json()["data"]["total_count"])
        for path, params in (("/dataset/download", {"code": code}), ("/evaluation/result/download", {"evaluate_code": run["evaluate_code"]})):
            export = await self.request("GET", path, params=params)
            self.assertEqual(200, export.status_code)
            self.assertIn("text/csv", export.headers["content-type"])
            self.assertIn("answer?", export.text)
        self.assertEqual(200, (await self.request("DELETE", "/dataset", params={"code": code})).status_code)
        self.assertEqual(2, len((await self.request("GET", "/evaluation/detail/show", params={"evaluate_code": run["evaluate_code"]})).json()["data"]))
        self.assertEqual(200, (await self.request("DELETE", "/evaluation", params={"evaluation_code": run["evaluate_code"]})).status_code)

    async def test_upload_file_update_members_and_invalid_input(self):
        upload = await self.request("POST", "/dataset/upload/file", data={"dataset_name": "CSV fixture"},
                                    files={"doc_file": ("fixture.csv", b"query,factual\nanswer?,42\n", "text/csv")})
        self.assertEqual(200, upload.status_code, upload.text)
        code = upload.json()["data"]["code"]
        changed = await self.request("POST", "/dataset/members/update", json={"code": code, "members": "reviewer"})
        self.assertEqual("reviewer", changed.json()["data"]["members"])
        bad = await self.request("POST", "/dataset/upload/content", json={"dataset_name": "bad", "content": '[{"secret":"not a query"}]'})
        self.assertEqual(422, bad.status_code)
        self.assertEqual(1, (await self.request("GET", "/datasets")).json()["data"]["total_count"])

    async def test_failed_native_execution_is_saved_as_failed_not_success(self):
        code = await self.create_dataset()
        with patch.object(self.service, "run_evaluation", side_effect=RuntimeError("fixture generation failure")):
            failed = await self.request("POST", "/start", json={"scene_key": "app", "scene_value": "fixture", "datasets": code, "evaluate_metrics": ["ExactMatchMetric"]})
        self.assertEqual(422, failed.status_code)
        rows = (await self.request("GET", "/evaluations")).json()["data"]["items"]
        self.assertEqual("failed", rows[0]["state"])
        self.assertIn("fixture generation failure", rows[0]["log_info"])

    async def test_policy_and_owner_scope_are_preserved(self):
        code = await self.create_dataset()
        self.assertEqual(403, (await self.request("GET", "/datasets", role="analyst")).status_code)
        unauthenticated = await self.client.get("/api/v1/evaluate/datasets")
        self.assertEqual(401, unauthenticated.status_code)
        with self.db.session() as session:
            item = session.query(ServeEntity).filter_by(evaluate_code=code).one()
            self.assertEqual("super_admin", item.user_id)
            item.user_id = "another-admin"
        self.assertEqual(0, (await self.request("GET", "/datasets")).json()["data"]["total_count"])
        self.assertEqual(404, (await self.request("DELETE", "/dataset", params={"code": code})).status_code)


if __name__ == "__main__":
    unittest.main()
