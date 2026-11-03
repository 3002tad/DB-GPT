from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import HTTPException

from dbgpt_app.openapi.api_v1.editor import api_editor_v1 as editor


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setenv("DBGPT_PIPELINE_IDENTITY_URL", "http://pipeline/api/auth/ai-identity")
    for key, value in {
        "DBGPT_PIPELINE_ANALYTICAL_SOURCE": "analytics",
        "DBGPT_PIPELINE_ANALYTICAL_DB_USER": "readonly",
        "DBGPT_PIPELINE_ANALYTICAL_DB_HOST": "db.internal",
        "DBGPT_PIPELINE_ANALYTICAL_DB_PORT": "5432",
    }.items():
        monkeypatch.setenv(key, value)
    connector = Mock(db_type="postgresql")
    connector.query_ex.return_value = (["value"], [(1,)])
    manager = Mock()
    manager.get_connector.return_value = connector
    manager.storage.get_db_config.return_value = {
        "db_name": "analytics", "db_user": "readonly", "db_host": "db.internal",
        "db_port": 5432, "db_type": "postgresql",
    }
    monkeypatch.setattr(editor, "CFG", SimpleNamespace(local_db_manager=manager))
    return manager, connector


def request(role="analyst"):
    return SimpleNamespace(state=SimpleNamespace(pipeline_actor=SimpleNamespace(id="alice", role=role)))


@pytest.mark.asyncio
async def test_sql_editor_uses_only_the_approved_source_and_preserves_cte(configured):
    manager, connector = configured
    sql = "WITH x AS (SELECT 1 AS value) SELECT value FROM x"
    await editor.editor_sql_run({"db_name": "analytics", "sql": sql}, editor_service=None, http_request=request())
    connector.query_ex.assert_called_once_with(sql, params={}, timeout=30)
    with pytest.raises(HTTPException) as exc:
        await editor.editor_sql_run({"db_name": "other", "sql": "SELECT 1"}, editor_service=None, http_request=request())
    assert exc.value.status_code == 403
    assert manager.get_connector.call_count == 1


@pytest.mark.asyncio
async def test_sql_editor_rejects_unknown_or_missing_identity(configured):
    manager, _ = configured
    for user, status in ((request("other"), 403), (None, 401)):
        with pytest.raises(HTTPException) as exc:
            await editor.editor_sql_run({"db_name": "analytics", "sql": "SELECT 1"}, editor_service=None, http_request=user)
        assert exc.value.status_code == status
    manager.get_connector.assert_not_called()


@pytest.mark.asyncio
async def test_admin_can_query_the_same_approved_source(configured):
    _, connector = configured
    await editor.editor_sql_run({"db_name": "analytics", "sql": "SELECT 1"}, editor_service=None, http_request=request("super_admin"))
    connector.query_ex.assert_called_once()
