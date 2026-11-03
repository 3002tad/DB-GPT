from types import SimpleNamespace

import pytest

from dbgpt_serve.session_file.api.endpoints import (
    SessionFileApiError,
    check_api_key,
    get_authenticated_owner,
)
from dbgpt_serve.session_file.config import ServeConfig


@pytest.mark.asyncio
async def test_pipeline_owner_ignores_client_header(monkeypatch):
    monkeypatch.setenv("DBGPT_PIPELINE_IDENTITY_URL", "https://pipeline/identity")
    config = ServeConfig()
    request = SimpleNamespace(state=SimpleNamespace(pipeline_actor=SimpleNamespace(id="alice")))
    assert await check_api_key(auth=None, config=config, request=request) is None
    assert get_authenticated_owner(user_id="bob", _checked_key=None, config=config, request=request) == "alice"


@pytest.mark.asyncio
async def test_pipeline_missing_actor_fails_closed(monkeypatch):
    monkeypatch.setenv("DBGPT_PIPELINE_IDENTITY_URL", "https://pipeline/identity")
    config = ServeConfig()
    with pytest.raises(SessionFileApiError):
        await check_api_key(auth=None, config=config, request=None)
    with pytest.raises(SessionFileApiError):
        get_authenticated_owner(user_id="bob", _checked_key=None, config=config, request=None)
