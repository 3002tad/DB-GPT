"""RUN18-02: real publication handlers behind the Pipeline boundary, no LLM."""

import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import httpx
from fastapi import FastAPI

from dbgpt.storage.metadata import DatabaseManager, Model
from dbgpt_app.openapi.api_v1.dashboard import api
from dbgpt_app.openapi.api_v1.dashboard.access import DashboardAuthorizationService
from dbgpt_app.openapi.api_v1.dashboard.models import (
    DashboardAccessDao, DashboardAuditDao, DashboardDao,
)
from dbgpt_app.openapi.api_v1.dashboard.schemas import (
    DashboardCreateRequest, DashboardSchemaV1,
)
from dbgpt_app.openapi.api_v1.dashboard.service import DashboardService
from dbgpt_app.pipeline_authorization import authorize_pipeline_request
from dbgpt_app.pipeline_identity import PipelineActor, PipelineIdentityMiddleware
from dbgpt_ext.datasource.rdbms.conn_sqlite import SQLiteConnector


class Verifier:
    async def verify(self, authorization):
        role = authorization.removeprefix("Bearer ")
        if role in ("admin-user-123", "admin-user-456"):
            return PipelineActor(id=role, role="super_admin")
        return PipelineActor(id=role, role=role)


class PublicationIntegrationTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        self.env = patch.dict(os.environ, {
            "DBGPT_PIPELINE_IDENTITY_URL": "http://test-pipeline",
            "DBGPT_SHARE_KEY_FILE": str(root / "share.key"),
        })
        self.env.start()
        self.addCleanup(self.env.stop)
        source = root / "source.db"
        with sqlite3.connect(source) as c:
            c.execute("CREATE TABLE sales (amount REAL)")
            c.executemany("INSERT INTO sales VALUES (?)", [(10,), (20,)])
        manager = DatabaseManager()
        manager.init_db(f"sqlite:///{root / 'metadata.db'}", base=Model)
        Model.metadata.create_all(manager.engine)
        self.addCleanup(manager.engine.dispose)
        dao = DashboardDao(manager)
        self.allow_source = True
        authorization = DashboardAuthorizationService(
            dashboard_dao=dao,
            access_dao=DashboardAccessDao(manager), audit_dao=DashboardAuditDao(manager),
            data_source_policy=SimpleNamespace(
                can_query=lambda actor, name: self.allow_source and name == "demo"
            ),
            require_data_source_authorizer=True,
        )
        connector = SQLiteConnector.from_file_path(str(source))
        self.service = DashboardService(
            dao=dao, connector_resolver=lambda _: connector,
            authorization_service=authorization,
        )
        self.schema = DashboardSchemaV1.model_validate({
            "schema_version": "1.3",
            "dashboard": {"title": "Publication fixture", "data_source_id": "demo"},
            "filters": [],
            "widgets": [{
                "id": "total", "type": "kpi", "title": "Synthetic total",
                "encoding": {"value": "value"},
                "query": {"data_source_id": "demo", "sql": "SELECT SUM(amount) AS value FROM sales",
                          "output_fields": [{"name": "value", "type": "number"}]},
                "publication": {
                    "query": {"data_source_id": "demo", "sql": "SELECT amount FROM sales",
                              "output_fields": [{"name": "amount", "type": "number"}]},
                    "filter_fields": {},
                    "measures": [{"source_field": "amount", "output_field": "value", "aggregation": "sum"}],
                    "output_columns": ["value"],
                },
            }],
            "layouts": {"desktop": [{"widget_id": "total", "x": 0, "y": 0, "w": 12, "h": 4}]},
        })
        app = FastAPI()
        app.include_router(api.router, prefix="/api")
        app.dependency_overrides[api.get_dashboard_service] = lambda: self.service
        app.add_middleware(
            PipelineIdentityMiddleware, verifier=Verifier(),
            policy=authorize_pipeline_request,
            ui_origin="https://pipeline.test", ai_origin="https://ai.test",
        )
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="https://ai.test"
        )
        self.addAsyncCleanup(self.client.aclose)

    async def test_both_roles_publish_read_filter_rotate_and_revoke(self):
        for role in ("analyst", "super_admin"):
            with self.subTest(role=role):
                record = self.service.create_dashboard(
                    DashboardCreateRequest(schema=self.schema), role
                )
                path = f"/api/v1/dashboards/{record.id}"
                headers = {"Authorization": f"Bearer {role}"}
                status = await self.client.get(path + "/live-share", headers=headers)
                self.assertEqual(200, status.status_code, status.text)
                response = await self.client.post(path + "/publish", headers=headers,
                    json={"expected_revision": record.current_revision, "filters": {}})
                self.assertEqual(200, response.status_code, response.text)
                token = response.json()["data"]["share_token"]
                public = f"/api/v1/public/dashboards/{token}"
                snapshot = await self.client.get(public)
                self.assertEqual(200, snapshot.status_code, snapshot.text)
                self.assertEqual([[30.0]], snapshot.json()["data"]["snapshot"]["widgets"]["total"]["rows"])
                filtered = await self.client.post(public + "/filter", json={"filters": {}})
                self.assertEqual(200, filtered.status_code, filtered.text)
                self.assertEqual(200, (await self.client.get(path + "/publications", headers=headers)).status_code)
                rotated = await self.client.post(path + "/publications/1/rotate", headers=headers, json={})
                self.assertEqual(200, rotated.status_code, rotated.text)
                self.assertEqual(404, (await self.client.get(public)).status_code)
                new_token = rotated.json()["data"]["share_token"]
                self.assertEqual(200, (await self.client.get(f"/api/v1/public/dashboards/{new_token}")).status_code)
                revoked = await self.client.delete(path + "/publications/1", headers=headers)
                self.assertEqual(200, revoked.status_code, revoked.text)
                self.assertEqual(404, (await self.client.get(f"/api/v1/public/dashboards/{new_token}")).status_code)

    async def test_admin_live_share_uses_actor_id_not_role_and_supports_full_lifecycle(self):
        owner_id = "admin-user-123"
        record = self.service.create_dashboard(DashboardCreateRequest(schema=self.schema), owner_id)
        path = f"/api/v1/dashboards/{record.id}"
        owner = {"Authorization": f"Bearer {owner_id}", "user-id": "spoofed-owner"}
        status = await self.client.get(path + "/live-share", headers=owner)
        self.assertEqual(200, status.status_code, status.text)
        published = await self.client.post(path + "/publish", headers=owner,
            json={"expected_revision": record.current_revision, "filters": {}})
        self.assertEqual(200, published.status_code, published.text)
        shared = await self.client.post(path + "/live-share", headers=owner, json={})
        self.assertEqual(200, shared.status_code, shared.text)
        token = shared.json()["data"]["share_path"].rsplit("/", 1)[-1]
        public = f"/api/v1/public/dashboards/{token}"
        data = await self.client.get(public)
        self.assertEqual(200, data.status_code, data.text)
        self.assertEqual([[30.0]], data.json()["data"]["snapshot"]["widgets"]["total"]["rows"])
        filtered = await self.client.post(public + "/filter", json={"filters": {}})
        self.assertEqual(200, filtered.status_code, filtered.text)
        self.assertEqual(200, (await self.client.get(path + "/live-share", headers=owner)).status_code)
        foreign = {"Authorization": "Bearer admin-user-456"}
        for method, suffix in (("get", "/live-share"), ("post", "/publish"), ("delete", "/live-share")):
            body = {"json": {"expected_revision": record.current_revision, "filters": {}}} if method == "post" else {}
            response = await getattr(self.client, method)(path + suffix, headers=foreign, **body)
            self.assertIn(response.status_code, (403, 404))
        self.assertEqual(200, (await self.client.delete(path + "/live-share", headers=owner)).status_code)
        self.assertEqual(404, (await self.client.get(public)).status_code)

    async def test_live_share_and_owner_source_boundaries(self):
        record = self.service.create_dashboard(DashboardCreateRequest(schema=self.schema), "analyst")
        path = f"/api/v1/dashboards/{record.id}"
        owner = {"Authorization": "Bearer analyst"}
        self.assertEqual(401, (await self.client.post(path + "/publish", json={})).status_code)
        denied = await self.client.post(path + "/publish",
            headers={"Authorization": "Bearer super_admin"}, json={"expected_revision": 1})
        self.assertIn(denied.status_code, (403, 404))
        published = await self.client.post(path + "/publish", headers=owner, json={"expected_revision": 1})
        self.assertEqual(200, published.status_code, published.text)
        created = await self.client.post(path + "/live-share", headers=owner, json={})
        self.assertEqual(200, created.status_code, created.text)
        token = created.json()["data"]["share_path"].rsplit("/", 1)[-1]
        public = f"/api/v1/public/dashboards/{token}"
        self.assertEqual(200, (await self.client.get(public)).status_code)
        self.allow_source = False
        self.assertEqual(404, (await self.client.get(public)).status_code)
        self.allow_source = True
        self.assertEqual(200, (await self.client.delete(path + "/live-share", headers=owner)).status_code)
        self.assertEqual(404, (await self.client.get(public)).status_code)
        self.assertEqual(404, (await self.client.get("/api/v1/public/dashboards/not-a-valid-token")).status_code)
        self.assertEqual(401, (await self.client.put(public, json={})).status_code)
        self.assertEqual(401, (await self.client.get(public + "/edit")).status_code)


if __name__ == "__main__":
    unittest.main()
