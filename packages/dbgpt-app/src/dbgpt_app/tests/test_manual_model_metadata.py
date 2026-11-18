"""Manual declarations: validation, persistence, policy and runtime propagation."""

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import httpx
from fastapi import FastAPI

from dbgpt.storage.metadata import DatabaseManager, Model, db
from dbgpt.core import ModelMetadata
from dbgpt.agent.core.context.budget import ContextBudgetConfig, resolve_context_budget
from dbgpt.model.cluster.client import DefaultLLMClient
from dbgpt.model.cluster.storage import ModelProviderConfigItem
from dbgpt.model.cluster.worker.default_worker import DefaultModelWorker
from dbgpt.model.cluster.manual_metadata import ensure_manual_metadata_schema, read_manual_metadata
from dbgpt_app.pipeline_authorization import authorize_pipeline_request
from dbgpt_app.pipeline_identity import PipelineActor, PipelineIdentityMiddleware
from dbgpt_serve.model.api import endpoints

PATH = "/api/v2/serve/model/providers/models/metadata"
BASE = "https://fixture-gateway.example/v1"


class Verifier:
    async def verify(self, authorization):
        role = authorization.removeprefix("Bearer ")
        return PipelineActor(id=role, role=role)


class ManualModelMetadataTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        db.init_db(f"sqlite:///{Path(self.temp.name) / 'metadata.db'}")
        ensure_manual_metadata_schema(db)
        self.addCleanup(db.engine.dispose)
        self.item = ModelProviderConfigItem(provider="custom/fixture", api_base=BASE, api_key="fixture-secret", enabled_models=["any-model"])
        self.storage = MagicMock()
        self.storage.get.side_effect = lambda provider: self.item if provider == self.item.provider else None
        self.storage.list_all.return_value = [self.item]
        self.manager = SimpleNamespace(supported_models=AsyncMock(return_value=[]))
        app = FastAPI()
        app.include_router(endpoints.router, prefix="/api/v2/serve/model")
        app.dependency_overrides[endpoints.get_provider_config_storage] = lambda: self.storage
        app.dependency_overrides[endpoints.get_worker_manager] = lambda: self.manager
        app.add_middleware(PipelineIdentityMiddleware, verifier=Verifier(), policy=authorize_pipeline_request)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://ai.test")
        self.addAsyncCleanup(self.client.aclose)

    def payload(self, **extra):
        return {"provider": self.item.provider, "model": "any-model", "context_length": 256000,
                "max_output_length": 16000, "function_calling": False,
                "reference": "Provider console, checked manually", "checked_at": "2026-11-18", **extra}

    async def save(self, role="super_admin", **extra):
        return await self.client.put(PATH, json=self.payload(**extra), headers={"Authorization": f"Bearer {role}", "user-id": "spoofed"})

    def worker(self):
        worker = DefaultModelWorker.__new__(DefaultModelWorker)
        worker.model_name = "any-model"
        worker.context_len = 4096
        worker._context_length_source = "fallback"
        worker._model_params = SimpleNamespace(api_base=BASE)
        worker.llm_adapter = SimpleNamespace(get_prompt_roles=lambda: ["system", "human", "ai"], get_default_message_separator=lambda: "\n")
        worker.model = SimpleNamespace(proxy_llm_client=SimpleNamespace(default_model="any-model", get_model_metadata=AsyncMock(return_value=ModelMetadata(model="any-model", context_length=8192, metadata={"context_length_source": "fallback"}))))
        return worker

    async def test_admin_can_save_and_catalog_matches_runtime_without_secret_payload(self):
        response = await self.save()
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()["success"])
        # Re-running schema bootstrap preserves declarations.
        ensure_manual_metadata_schema(db)
        self.assertEqual(read_manual_metadata(BASE, "any-model")["context_length"], 256000)
        catalog = await self.client.get("/api/v2/serve/model/providers", headers={"Authorization": "Bearer super_admin"})
        row = catalog.json()["data"][0]["models"][0]
        self.assertEqual(row["context_length"], 256000)
        self.assertFalse(row["function_calling"])
        self.assertEqual(row["metadata_declaration"], "user_config")
        self.assertNotIn("fixture-secret", catalog.text)
        metadata = await self.worker().async_get_model_metadata({})
        self.assertEqual(metadata.context_length, 256000)
        self.assertEqual(metadata.max_output_length, 16000)
        self.assertFalse(metadata.function_calling)
        self.assertEqual(metadata.metadata["context_length_source"], "user_config")
        budget = await resolve_context_budget(ContextBudgetConfig(), SimpleNamespace(get_model_metadata=AsyncMock(return_value=metadata)), "any-model", max_new_tokens=4000)
        self.assertEqual(budget.max_context_tokens, 256000)
        self.assertEqual(budget.context_window_source, "user_config")

    async def test_analyst_and_unauthenticated_cannot_write(self):
        self.assertEqual((await self.save(role="analyst")).status_code, 403)
        response = await self.client.put(PATH, json=self.payload())
        self.assertEqual(response.status_code, 401)
        self.assertEqual(read_manual_metadata(BASE, "any-model"), {})

    async def test_invalid_numbers_and_missing_provenance_are_rejected(self):
        for extra in ({"context_length": 0}, {"context_length": -1}, {"context_length": True}, {"context_length": 3.5}, {"max_output_length": 300000}, {"reference": " "}, {"checked_at": None}, {"function_calling": "yes"}):
            with self.subTest(extra=extra):
                self.assertEqual((await self.save(**extra)).status_code, 422)
        self.assertEqual(read_manual_metadata(BASE, "any-model"), {})

    async def test_empty_declarations_restore_fallback_and_endpoint_changes_do_not_reuse_values(self):
        await self.save()
        self.assertEqual(read_manual_metadata("https://another.example/v1", "any-model"), {})
        self.assertEqual(read_manual_metadata(BASE, "another-model"), {})
        response = await self.save(context_length=None, max_output_length=None, function_calling=None, reference=None, checked_at=None)
        self.assertEqual(response.status_code, 200)
        metadata = await self.worker().async_get_model_metadata({})
        self.assertEqual(metadata.metadata["context_length_source"], "fallback")
        budget = await resolve_context_budget(ContextBudgetConfig(), SimpleNamespace(get_model_metadata=AsyncMock(return_value=metadata)), "any-model")
        self.assertEqual(budget.max_context_tokens, 120000)

    async def test_new_metadata_read_refreshes_cached_client_and_keeps_explicit_agent_cap(self):
        await self.save()
        worker = self.worker()
        async def worker_metadata(_):
            return await worker.async_get_model_metadata({})
        manager = SimpleNamespace(get_model_metadata=AsyncMock(side_effect=worker_metadata))
        client = DefaultLLMClient(worker_manager=manager)
        self.assertEqual((await client.get_model_metadata("any-model")).context_length, 256000)
        await self.save(context_length=512000)
        metadata = await client.get_model_metadata("any-model")
        self.assertEqual(metadata.context_length, 512000)
        budget = await resolve_context_budget(ContextBudgetConfig(), client, "any-model", configured_limit=64000)
        self.assertEqual(budget.max_context_tokens, 64000)
        self.assertEqual(budget.context_window_source, "agent_config")

    async def test_registry_uses_the_model_service_database_manager(self):
        manager = DatabaseManager()
        manager.init_db(f"sqlite:///{Path(self.temp.name) / 'model-service.db'}", base=Model)
        try:
            ensure_manual_metadata_schema(manager)
            self.assertEqual((await self.save()).status_code, 200)
            self.assertEqual(read_manual_metadata(BASE, "any-model")["context_length"], 256000)
            from dbgpt.model.cluster.manual_metadata import ManualModelMetadata
            with db.session(commit=False) as session:
                self.assertEqual(session.query(ManualModelMetadata).count(), 0)
        finally:
            ensure_manual_metadata_schema(db)
            manager.engine.dispose()
