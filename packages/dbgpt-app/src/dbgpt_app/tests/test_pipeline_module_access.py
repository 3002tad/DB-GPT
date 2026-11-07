"""Regression checks for native module dependencies; no model/API billing."""

import asyncio
import os
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

from fastapi import HTTPException

from dbgpt_app.pipeline_authorization import authorize_pipeline_request
from dbgpt_app.pipeline_identity import PipelineActor
from dbgpt_app.openapi.api_v1.tools.question_manager import QuestionManager


class ModuleRoutesTest(unittest.TestCase):
    def test_native_dependencies_for_both_roles(self):
        cases = [
            ("POST", "/api/v1/chat/completions"),
            ("POST", "/api/v1/chat/prepare"),
            ("POST", "/api/v1/chat/topic/terminate"),
            ("GET", "/api/v1/conv/feedback/reasons"),
            ("POST", "/api/v1/conv/feedback/add"),
            ("POST", "/api/v1/conv/feedback/cancel"),
            ("POST", "/api/v1/chat/question/que_test/reply"),
            ("POST", "/api/v1/chat/question/que_test/reject"),
            ("POST", "/api/v1/skills/upload"),
            ("POST", "/api/v1/skills/import_github"),
            ("GET", "/api/v1/agent/skills/download"),
            ("POST", "/api/v1/editor/sql"),
            ("POST", "/api/v1/sql/editor/submit"),
            ("POST", "/api/v1/chart/editor/submit"),
            ("GET", "/api/v1/editor/sql/rounds"),
            ("POST", "/api/v1/knowledge/demo/argument/save"),
            ("GET", "/api/v2/serve/knowledge/8/wiki/pages/nested/page.md"),
            ("GET", "/api/v2/serve/knowledge/8/git/sync-status"),
            ("POST", "/api/v2/serve/knowledge/8/git/sync"),
            ("GET", "/api/v2/serve/knowledge/spaces/8/knowledge_sources"),
            ("POST", "/api/v2/serve/knowledge/spaces/8/knowledge_sources/source1/sync"),
            ("GET", "/api/v1/dashboards/d1/versions"),
            ("GET", "/api/v1/dashboards/d1/annotations"),
            ("POST", "/api/v1/dashboards/d1/assistant-task"),
            ("POST", "/api/v1/dashboards/d1/annotations/a1/apply"),
            ("GET", "/api/v1/dashboard-catalog/template1/features"),
            ("POST", "/api/v1/dashboard-catalog/template1/generate"),
            ("GET", "/api/v1/reports/r1/runs/run1/preview"),
            ("GET", "/api/v2/serve/file/files/dbgpt/file1"),
            ("GET", "/api/v1/app/app1/admins"),
            ("POST", "/api/v2/serve/scheduled-tasks/"),
        ]
        for role in ("analyst", "super_admin"):
            for method, path in cases:
                with self.subTest(role=role, method=method, path=path):
                    self.assertTrue(authorize_pipeline_request(
                        PipelineActor(id="alice", role=role),
                        {"method": method, "path": path},
                    ))

    def test_admin_dependencies_are_not_global_analyst_access(self):
        for method, path in [
            ("GET", "/api/v1/observability/capabilities"),
            ("GET", "/api/v1/observability/models/usage"),
            ("GET", "/api/v1/evaluate/datasets"),
            ("POST", "/api/v1/app/admins/update"),
            ("POST", "/api/v1/knowledge/users/update"),
        ]:
            for role in ("analyst", "super_admin"):
                with self.subTest(role=role, path=path):
                    self.assertEqual(role == "super_admin", authorize_pipeline_request(
                        PipelineActor(id="alice", role=role),
                        {"method": method, "path": path},
                    ))

    def test_no_prefix_or_public_sharing_bypass(self):
        for role in ("analyst", "super_admin", "unknown"):
            for method, path in [
                ("DELETE", "/api/v1/chat/completions"),
                ("POST", "/api/v1/not-reviewed"),
                ("POST", "/api/v1/dashboards/d1/publish"),
                ("GET", "/api/v1/dashboards/../other/cover"),
            ]:
                self.assertFalse(authorize_pipeline_request(
                    PipelineActor(id="alice", role=role),
                    {"method": method, "path": path},
                ))


class ModuleHandlerTest(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {"DBGPT_PIPELINE_IDENTITY_URL": "http://pipeline/api/auth/ai-identity"})
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_question_first_turn_owner_reply_and_reject(self):
        from dbgpt_app.openapi.api_v1.agentic_data_api import _authorize_pending_question
        manager = QuestionManager()
        for operation in ("reply", "reject"):
            pending = manager.create("not-yet-persisted", [{}], owner_id="alice")
            with self.assertRaises(HTTPException) as error:
                _authorize_pending_question(manager, pending.request_id, SimpleNamespace(user_id="bob"))
            self.assertEqual(404, error.exception.status_code)
            self.assertFalse(pending.event.is_set())
            _authorize_pending_question(manager, pending.request_id, SimpleNamespace(user_id="alice"))
            if operation == "reply":
                manager.reply(pending.request_id, [["answer"]])
            else:
                manager.reject(pending.request_id)
            self.assertTrue(pending.event.is_set())

    def test_native_app_checks_database_binding(self):
        from dbgpt_app.openapi.api_v1.api_v1 import _require_pipeline_chat_access
        dialogue = SimpleNamespace(user_name="alice", conv_uid="new", chat_mode="chat_agent", app_code="app1", ext_info=None)
        resource = SimpleNamespace(type="database", value='{"db_name":"analytics"}')
        app = SimpleNamespace(details=[SimpleNamespace(resources=[resource])])
        controller = SimpleNamespace(multi_agents=SimpleNamespace(get_app=Mock(return_value=app)))
        with patch("dbgpt_app.openapi.api_v1.agentic_data_api._guard_pipeline_conversation_owner") as owner, \
             patch("dbgpt_app.pipeline_datasource.PipelineDataSourcePolicy.can_query", return_value=True) as source, \
             patch.dict(sys.modules, {"dbgpt_serve.agent.agents.controller": controller}), \
             patch("dbgpt_app.openapi.api_v1.api_v1.CFG", SimpleNamespace(local_db_manager=Mock())):
            _require_pipeline_chat_access(dialogue)
            owner.assert_called_once_with("new", "alice")
            source.assert_called_once_with("alice", "analytics")
            source.return_value = False
            with self.assertRaises(HTTPException) as error:
                _require_pipeline_chat_access(dialogue)
            self.assertEqual(403, error.exception.status_code)

    def test_editor_post_read_reuses_owner_guard(self):
        from dbgpt_app.openapi.api_v1.editor import api_editor_v1 as editor
        service = Mock()
        service.get_editor_sql_by_round.return_value = [{"sql": "SELECT 1"}]
        request = SimpleNamespace(state=SimpleNamespace(pipeline_actor=SimpleNamespace(id="alice")))
        with patch("dbgpt_app.openapi.api_v1.agentic_data_api._require_owned_conversation") as owner:
            asyncio.run(editor.get_editor_sql_from_body("conv1", 1, service, request))
            owner.assert_called_once_with("conv1", "alice")
            owner.side_effect = HTTPException(status_code=404)
            service.reset_mock()
            with self.assertRaises(HTTPException):
                asyncio.run(editor.get_editor_sql_from_body("conv1", 1, service, request))
            service.get_editor_sql_by_round.assert_not_called()

    def test_url_and_space_validation(self):
        from dbgpt_app.knowledge.api import _require_knowledge_http_url, _require_pipeline_sync_document
        _require_knowledge_http_url("https://example.com/manual")
        for value in ("file:///etc/passwd", "https://user:secret@example.com", "http://[invalid"):
            with self.subTest(value=value), self.assertRaises(HTTPException):
                _require_knowledge_http_url(value)
        service = Mock()
        service.get_document.return_value = SimpleNamespace(space="demo", doc_type="URL", content="https://example.com/manual")
        _require_pipeline_sync_document(service, "demo", 8)
        with self.assertRaises(HTTPException) as error:
            _require_pipeline_sync_document(service, "other-space", 8)
        self.assertEqual(404, error.exception.status_code)

    def test_feedback_binds_actor_and_checks_thread(self):
        from dbgpt_serve.feedback.api.endpoints import _bind_pipeline_feedback_owner
        request = SimpleNamespace(conv_uid="conv1", user_code="spoofed", user_name="spoofed")
        http = SimpleNamespace(state=SimpleNamespace(pipeline_actor=SimpleNamespace(id="alice")))
        with patch("dbgpt_app.openapi.api_v1.agentic_data_api._require_owned_conversation") as owner:
            _bind_pipeline_feedback_owner(request, http)
            owner.assert_called_once_with("conv1", "alice")
            self.assertEqual("alice", request.user_code)
            owner.side_effect = HTTPException(status_code=404)
            with self.assertRaises(HTTPException):
                _bind_pipeline_feedback_owner(request, http)
        with self.assertRaises(HTTPException) as error:
            _bind_pipeline_feedback_owner(request, None)
        self.assertEqual(401, error.exception.status_code)


if __name__ == "__main__":
    unittest.main()
