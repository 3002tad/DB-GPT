"""RUN18-06: a newly returned ID already has a persisted owner and header."""

import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import httpx
from fastapi import FastAPI

from dbgpt.storage.chat_history.chat_history_db import ChatHistoryEntity, ChatHistoryMessageEntity
from dbgpt.storage.chat_history.storage_adapter import DBMessageStorageItemAdapter, DBStorageConversationItemAdapter
from dbgpt.storage.metadata import DatabaseManager, Model
from dbgpt.storage.metadata.db_storage import SQLAlchemyStorage
from dbgpt.util.serialization.json_serialization import JsonSerializer
from dbgpt_app.pipeline_authorization import authorize_pipeline_request
from dbgpt_app.pipeline_identity import PipelineActor, PipelineIdentityMiddleware
from dbgpt_serve.conversation.api import endpoints
from dbgpt_serve.conversation.api.schemas import ServeRequest
from dbgpt_serve.conversation.config import ServeConfig
from dbgpt_serve.conversation.models.models import ServeDao
from dbgpt_serve.conversation.service import service as conversation_service


class Verifier:
    async def verify(self, authorization):
        role = authorization.removeprefix("Bearer ")
        return PipelineActor(id=role, role=role)


class NativeConversationLifecycleTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        env = patch.dict(os.environ, {"DBGPT_PIPELINE_IDENTITY_URL": "http://pipeline"})
        env.start()
        self.addCleanup(env.stop)
        self.db = DatabaseManager()
        self.db.init_db(f"sqlite:///{Path(self.temp.name) / 'history.db'}", base=Model)
        Model.metadata.create_all(self.db.engine)
        self.addCleanup(self.db.engine.dispose)
        config = ServeConfig(default_model="fixture-model")
        dao = ServeDao(config)
        dao._db_manager = self.db
        self.service = conversation_service.Service(
            None, config, dao=dao,
            storage=SQLAlchemyStorage(self.db, ChatHistoryEntity, DBStorageConversationItemAdapter(), JsonSerializer()),
            message_storage=SQLAlchemyStorage(self.db, ChatHistoryMessageEntity, DBMessageStorageItemAdapter(), JsonSerializer()),
        )
        for target, value in (
            ("dbgpt_serve.file.serve.Serve.get_instance", SimpleNamespace(replace_uri=lambda value: value)),
            ("dbgpt_serve.conversation.service.service.get_service", SimpleNamespace(list_conv_feedbacks=lambda **_: [])),
        ):
            p = patch(target, return_value=value)
            p.start()
            self.addCleanup(p.stop)
        app = FastAPI()
        app.include_router(endpoints.router, prefix="/api/v1/chat/dialogue")
        app.dependency_overrides[endpoints.get_service] = lambda: self.service
        app.add_middleware(PipelineIdentityMiddleware, verifier=Verifier(), policy=authorize_pipeline_request)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://ai.test")
        self.addAsyncCleanup(self.client.aclose)

    async def create(self, role="analyst", mode="chat_normal"):
        response = await self.client.post("/api/v1/chat/dialogue/new", params={
            "chat_mode": mode, "app_code": "fixture-app", "user_name": "forged-owner",
        }, headers={"Authorization": f"Bearer {role}"})
        self.assertEqual(200, response.status_code, response.text)
        return response.json()["data"]["conv_uid"]

    async def history(self, uid, role="analyst"):
        return await self.client.get("/api/v1/chat/dialogue/messages/history",
            params={"con_uid": uid}, headers={"Authorization": f"Bearer {role}"})

    async def test_new_conversations_are_readable_before_first_turn_for_both_roles(self):
        for role in ("analyst", "super_admin"):
            with self.subTest(role=role):
                uid = await self.create(role)
                with self.db.session(commit=False) as session:
                    entity = session.query(ChatHistoryEntity).filter_by(conv_uid=uid).one()
                    self.assertEqual(role, entity.user_name)
                    self.assertEqual("fixture-app", entity.app_code)
                    self.assertEqual("chat_normal", entity.chat_mode)
                    self.assertEqual(0, session.query(ChatHistoryMessageEntity).filter_by(conv_uid=uid).count())
                for _ in range(2):
                    response = await self.history(uid, role)
                    self.assertEqual(200, response.status_code, response.text)
                    self.assertEqual([], response.json()["data"])

    async def test_first_round_updates_same_conversation_and_keeps_app_binding(self):
        uid = await self.create()
        conv = self.service.create_storage_conv(ServeRequest(conv_uid=uid, user_name="analyst"))
        conv.start_new_round()
        conv.add_user_message("Fixture question")
        conv.add_ai_message("Fixture answer")
        conv.end_current_round()
        response = await self.history(uid)
        self.assertEqual(200, response.status_code, response.text)
        self.assertTrue(response.json()["data"])
        reloaded = self.service.create_storage_conv(ServeRequest(conv_uid=uid, user_name="analyst"))
        self.assertEqual("fixture-app", reloaded.app_code)
        self.assertEqual("analyst", reloaded.user_name)
        with self.db.session(commit=False) as session:
            self.assertEqual(1, session.query(ChatHistoryEntity).filter_by(conv_uid=uid).count())

    async def test_missing_foreign_and_unauthenticated_history_stay_denied(self):
        uid = await self.create()
        self.assertEqual(404, (await self.history(uid, "super_admin")).status_code)
        self.assertEqual(404, (await self.history("missing")).status_code)
        self.assertEqual(401, (await self.client.get("/api/v1/chat/dialogue/messages/history", params={"con_uid": uid})).status_code)
        for operation in ("clear", "delete"):
            denied = await self.client.post(f"/api/v1/chat/dialogue/{operation}", params={"con_uid": uid},
                headers={"Authorization": "Bearer super_admin"})
            self.assertEqual(404, denied.status_code)
        self.assertEqual(200, (await self.history(uid)).status_code)

    async def test_new_calls_have_distinct_persisted_ids(self):
        first = await self.create()
        second = await self.create(mode="chat_agent")
        self.assertNotEqual(first, second)
        with self.db.session(commit=False) as session:
            self.assertEqual(2, session.query(ChatHistoryEntity).count())
            self.assertEqual(0, session.query(ChatHistoryMessageEntity).count())


if __name__ == "__main__":
    unittest.main()
