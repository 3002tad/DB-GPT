from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from dbgpt_serve.datasource.api import endpoints
from dbgpt_serve.datasource.api.schemas import DatasourceQueryResponse


@pytest.mark.asyncio
async def test_analyst_only_receives_approved_datasource_without_secrets(monkeypatch):
    monkeypatch.setenv("DBGPT_PIPELINE_IDENTITY_URL", "http://pipeline/api/auth/ai-identity")
    for key, value in {
        "DBGPT_PIPELINE_ANALYTICAL_SOURCE": "analytics",
        "DBGPT_PIPELINE_ANALYTICAL_DB_USER": "readonly",
        "DBGPT_PIPELINE_ANALYTICAL_DB_HOST": "db.internal",
        "DBGPT_PIPELINE_ANALYTICAL_DB_PORT": "5432",
    }.items():
        monkeypatch.setenv(key, value)
    manager = Mock()
    manager.storage.get_db_config.return_value = {
        "db_name": "analytics", "db_user": "readonly", "db_host": "db.internal",
        "db_port": 5432, "db_type": "postgresql",
    }
    service = Mock()
    service.datasource_manager = manager
    service.get_list.return_value = [
        DatasourceQueryResponse(type="postgresql", db_name="analytics", id=1,
                                params={"password": "secret", "host": "db.internal"}),
        DatasourceQueryResponse(type="mysql", db_name="internal", id=2,
                                params={"password": "other-secret"}),
    ]
    async def run_sync(_system_app, func, **kwargs):
        return func(**kwargs)
    monkeypatch.setattr(endpoints, "blocking_func_to_async", run_sync)
    request = SimpleNamespace(state=SimpleNamespace(pipeline_actor=SimpleNamespace(id="alice", role="analyst")))
    result = await endpoints.query_page(db_type=None, service=service, http_request=request)
    assert len(result.data) == 1
    assert result.data[0].db_name == "analytics"
    assert result.data[0].params == {"database": "analytics"}
    assert "secret" not in str(result.data)
