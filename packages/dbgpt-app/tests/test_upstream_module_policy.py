"""Policy compatibility with the actual upstream route declarations."""
import ast
import os
import re
from pathlib import Path
from typing import Any
from types import SimpleNamespace, ModuleType
from unittest.mock import Mock
import sys
import pytest
from dbgpt_app.pipeline_authorization import authorize_pipeline_request
from dbgpt_app.pipeline_identity import PipelineActor

ROOT = Path(__file__).parents[3]
API = ROOT / "packages/dbgpt-app/src/dbgpt_app/openapi/api_v1/agentic_data_api.py"


def allowed(role, method, path):
    return authorize_pipeline_request(PipelineActor("test-user", role), {"method": method, "path": path})


def routes(relative, prefix):
    tree = ast.parse((ROOT / relative).read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for dec in node.decorator_list:
                if isinstance(dec, ast.Call) and isinstance(dec.func, ast.Attribute) and dec.func.attr in {"get", "post", "put", "patch", "delete"} and dec.args and isinstance(dec.args[0], ast.Constant):
                    path = prefix + dec.args[0].value
                    yield dec.func.attr.upper(), re.sub(r"\{[^}]+\}", "1", path)


@pytest.mark.parametrize("role", ["analyst", "super_admin"])
def test_all_native_semantic_and_plugin_actions_have_explicit_routes(role):
    for module, prefix in [
        ("packages/dbgpt-serve/src/dbgpt_serve/semantic/api.py", "/api"),
        ("packages/dbgpt-serve/src/dbgpt_serve/plugins/api/endpoints.py", "/api/v1/suites"),
        ("packages/dbgpt-serve/src/dbgpt_serve/plugins/api/creation.py", "/api/v1"),
    ]:
        for method, path in routes(module, prefix):
            expected = role == "super_admin" if path == "/api/v1/suites/sync" else True
            assert bool(allowed(role, method, path)) == expected, (role, method, path)


@pytest.mark.parametrize("role", ["analyst", "super_admin"])
def test_chat_owned_operations_and_admin_configuration(role):
    for method, path in [("POST", "/api/v1/chat/sql/run"), ("GET", "/api/v1/chat/approval/pending"), ("GET", "/api/v1/chat/approval/log"), ("GET", "/api/v1/chat/approval/session-mode"), ("POST", "/api/v1/chat/approval/session-mode"), ("POST", "/api/v1/chat/approval/apr_123/resolve")]:
        assert allowed(role, method, path)
    for method, path in [("GET", "/api/v1/chat/harness/engines"), ("PUT", "/api/v1/chat/harness/engine"), ("POST", "/api/v1/chat/approval/policy/save"), ("GET", "/api/v1/chat/approval/whitelist"), ("POST", "/api/v1/chat/approval/whitelist/revoke")]:
        assert bool(allowed(role, method, path)) == (role == "super_admin")
    # Loopback engine execution and arbitrary file paths are not workspace routes.
    assert not allowed(role, "POST", "/api/v1/chat/harness/tool/run")
    assert not allowed(role, "GET", "/api/v1/chat/harness/artifact-file")
    assert not allowed(role, "DELETE", "/api/v1/suites/sync")
    assert not allowed(role, "POST", "/api/v1/semantic/unknown")


def load_function(path, name, namespace):
    node = next(n for n in ast.parse(path.read_text(encoding="utf-8")).body if isinstance(n, ast.FunctionDef) and n.name == name)
    exec(compile(ast.Module(body=[node], type_ignores=[]), str(path), "exec"), namespace)
    return namespace[name]


def test_approval_requires_owned_existing_thread(monkeypatch):
    class Denied(Exception):
        def __init__(self, status_code, detail): self.status_code = status_code
    owner = Mock()
    check = load_function(API, "_require_pipeline_chat_owner", {"os": os, "HTTPException": Denied, "_require_owned_conversation": owner})
    monkeypatch.setenv("DBGPT_PIPELINE_IDENTITY_URL", "http://pipeline/api/auth/ai-identity")
    check("owned", "actor")
    owner.assert_called_once_with("owned", "actor")
    with pytest.raises(Denied) as error: check("owned", None)
    assert error.value.status_code == 401
    owner.side_effect = Denied(404, "not owned")
    with pytest.raises(Denied) as error: check("other", "actor")
    assert error.value.status_code == 404
    monkeypatch.delenv("DBGPT_PIPELINE_IDENTITY_URL")
    check("standalone", None)


def test_semantic_sync_uses_existing_pipeline_datasource_grant(monkeypatch):
    for key, value in {"DBGPT_PIPELINE_IDENTITY_URL": "http://pipeline", "DBGPT_PIPELINE_ANALYTICAL_SOURCE": "analytics", "DBGPT_PIPELINE_ANALYTICAL_DB_USER": "readonly", "DBGPT_PIPELINE_ANALYTICAL_DB_HOST": "db", "DBGPT_PIPELINE_ANALYTICAL_DB_PORT": "5432"}.items(): monkeypatch.setenv(key, value)
    manager = Mock()
    manager.storage.get_db_config.return_value = {"db_name": "analytics", "db_type": "postgresql", "db_user": "readonly", "db_host": "db", "db_port": 5432}
    for name, attrs in {"dbgpt._private.config": {"Config": lambda: SimpleNamespace(SYSTEM_APP=None)}, "dbgpt_serve.datasource.manages": {"ConnectorManager": SimpleNamespace(get_instance=lambda app: manager)}}.items():
        module = ModuleType(name)
        module.__dict__.update(attrs)
        monkeypatch.setitem(sys.modules, name, module)
    connector = load_function(ROOT / "packages/dbgpt-serve/src/dbgpt_serve/semantic/api.py", "_connector", {"os": os, "Any": Any})
    with pytest.raises(PermissionError): connector("internal_credentials")
    manager.get_connector.assert_not_called()
    assert connector("analytics") is manager.get_connector.return_value



def test_approval_resolve_checks_owner_and_global_scope_before_mutation(monkeypatch):
    import asyncio
    class Denied(Exception):
        def __init__(self, status_code, detail): self.status_code = status_code
    center = Mock()
    center.get.return_value = SimpleNamespace(conv_id="owned")
    center.resolve.return_value = True
    module = ModuleType("dbgpt_app.openapi.api_v1.approval")
    module.approval_center = center
    monkeypatch.setitem(sys.modules, module.__name__, module)
    tree = ast.parse(API.read_text(encoding="utf-8"))
    node = next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name == "approval_resolve")
    node.decorator_list = []
    node.args.defaults = []
    for arg in node.args.args: arg.annotation = None
    owner = Mock()
    namespace = {"HTTPException": Denied, "_require_pipeline_chat_owner": owner, "Result": SimpleNamespace(succ=lambda value: value, failed=lambda **kw: kw)}
    exec(compile(ast.Module(body=[node], type_ignores=[]), str(API), "exec"), namespace)
    resolve = namespace["approval_resolve"]
    async def call(role, scope):
        return await resolve("apr1", SimpleNamespace(decision="approve", scope=scope, reason=None), SimpleNamespace(state=SimpleNamespace(pipeline_actor=SimpleNamespace(role=role))), SimpleNamespace(user_id="user"))
    with pytest.raises(Denied) as error: asyncio.run(call("analyst", "always"))
    assert error.value.status_code == 403
    center.resolve.assert_not_called()
    assert asyncio.run(call("analyst", "session"))["success"] is True
    owner.assert_called_with("owned", "user")
    center.resolve.reset_mock()
    owner.side_effect = Denied(404, "not owned")
    with pytest.raises(Denied): asyncio.run(call("analyst", "once"))
    center.resolve.assert_not_called()
    owner.side_effect = None
    assert asyncio.run(call("super_admin", "always"))["success"] is True
