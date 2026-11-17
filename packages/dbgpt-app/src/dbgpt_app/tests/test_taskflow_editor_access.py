import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException

from dbgpt_app.pipeline_authorization import authorize_pipeline_request
from dbgpt_app.pipeline_identity import PipelineActor
from dbgpt_serve.flow.api.generation import get_owner


class TaskflowAccessTest(unittest.TestCase):
    def test_editor_routes_available_for_both_roles(self):
        base = "/api/v2/serve/awel"
        session = f"{base}/taskflow/generation-sessions"
        for role in ("analyst", "super_admin"):
            actor = PipelineActor(id="test", role=role)
            for method, path in (
                ("GET", f"{base}/taskflow/node-kinds"),
                ("GET", f"{base}/taskflow/agent-options"),
                ("GET", f"{base}/flow/templates/template-1"),
                ("POST", session),
                ("GET", f"{session}/session-1"),
                ("PUT", f"{session}/session-1/draft"),
                *(("POST", f"{session}/session-1/{action}") for action in
                  ("messages", "undo", "debug", "save", "requests/r1/cancel",
                   "candidates/c1/apply", "candidates/c1/discard")),
            ):
                with self.subTest(role=role, method=method, path=path):
                    self.assertTrue(authorize_pipeline_request(actor, {"method": method, "path": path}))

    def test_unknown_actions_and_methods_remain_denied(self):
        actor = PipelineActor(id="test", role="analyst")
        base = "/api/v2/serve/awel/taskflow/generation-sessions"
        for method, path in (
            ("GET", base), ("DELETE", f"{base}/s1"),
            ("POST", f"{base}/s1/candidates/c1/execute"),
            ("POST", "/api/v2/serve/awel/taskflow/node-kinds"),
        ):
            self.assertFalse(authorize_pipeline_request(actor, {"method": method, "path": path}))

    def test_pipeline_owner_uses_verified_actor(self):
        with patch.dict(os.environ, {"DBGPT_PIPELINE_IDENTITY_URL": "http://pipeline/identity"}):
            alice = SimpleNamespace(state=SimpleNamespace(pipeline_actor=SimpleNamespace(id="alice")))
            bob = SimpleNamespace(state=SimpleNamespace(pipeline_actor=SimpleNamespace(id="bob")))
            self.assertEqual(get_owner(alice, None), get_owner(alice, "other-token"))
            self.assertNotEqual(get_owner(alice, None), get_owner(bob, None))
            with self.assertRaises(HTTPException) as error:
                get_owner(SimpleNamespace(state=SimpleNamespace()), None)
            self.assertEqual(error.exception.status_code, 401)

    def test_standalone_owner_compatibility(self):
        with patch.dict(os.environ, {"DBGPT_PIPELINE_IDENTITY_URL": ""}):
            request = SimpleNamespace(state=SimpleNamespace())
            self.assertEqual(get_owner(request, None), get_owner(request, None))
            self.assertNotEqual(get_owner(request, "a"), get_owner(request, "b"))


if __name__ == "__main__":
    unittest.main()
