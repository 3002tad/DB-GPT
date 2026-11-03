from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import HTTPException

from dbgpt_serve.connector.api.endpoints import list_connectors
from dbgpt_serve.connector.service.service import ConnectorResponse


@pytest.mark.asyncio
async def test_analyst_picker_only_returns_active_connector_identity(monkeypatch):
    monkeypatch.setenv("DBGPT_PIPELINE_IDENTITY_URL", "https://pipeline/identity")
    service = Mock()
    service.list_connectors.return_value = [
        ConnectorResponse(connector_id="one", connector_type="mcp", display_name="One",
                          status="active", config={"token": "secret", "server_uri": "private"},
                          user_name="admin"),
        ConnectorResponse(connector_id="two", connector_type="mcp", display_name="Two",
                          status="disconnected"),
    ]
    request = SimpleNamespace(state=SimpleNamespace(pipeline_actor=SimpleNamespace(role="analyst")))
    result = await list_connectors(user_name="forged", sys_code="forged", service=service, http_request=request)
    service.list_connectors.assert_called_once_with(user_name=None, sys_code=None)
    assert len(result.data) == 1
    assert result.data[0].connector_id == "one"
    assert result.data[0].config is None
    assert result.data[0].user_name is None
    assert "secret" not in str(result)


@pytest.mark.asyncio
async def test_connector_list_requires_verified_actor_in_pipeline_mode(monkeypatch):
    monkeypatch.setenv("DBGPT_PIPELINE_IDENTITY_URL", "https://pipeline/identity")
    service = Mock()
    with pytest.raises(HTTPException) as error:
        await list_connectors(user_name=None, sys_code=None, service=service, http_request=None)
    assert error.value.status_code == 401
    service.list_connectors.assert_not_called()
