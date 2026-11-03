from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import HTTPException

from dbgpt_serve.conversation.api import endpoints


@pytest.fixture
def identity(monkeypatch):
    monkeypatch.setenv("DBGPT_PIPELINE_IDENTITY_URL", "http://pipeline/api/auth/ai-identity")
    return SimpleNamespace(state=SimpleNamespace(pipeline_actor=SimpleNamespace(id="alice", role="analyst")))


@pytest.mark.asyncio
async def test_list_uses_verified_actor_not_client_query(identity):
    service = Mock()
    service.get_list_by_page.return_value.items = []
    await endpoints.list_latest_conv(user_name="bob", user_id="bob", service=service, http_request=identity)
    assert service.get_list_by_page.call_args.args[0].user_name == "alice"


@pytest.mark.asyncio
async def test_history_and_delete_refuse_foreign_conversation(identity):
    service = Mock()
    service.get.return_value = None
    for action in (endpoints.get_history_messages, endpoints.delete, endpoints.clear):
        with pytest.raises(HTTPException) as exc:
            await action("other", service=service, http_request=identity)
        assert exc.value.status_code == 404
    service.get_history_messages.assert_not_called()
    service.delete.assert_not_called()
    service.clear.assert_not_called()


@pytest.mark.asyncio
async def test_owned_history_uses_verified_actor(identity):
    service = Mock()
    service.get.return_value = object()
    service.get_history_messages.return_value = []
    await endpoints.get_history_messages("mine", service=service, http_request=identity)
    assert service.get.call_args.args[0].user_name == "alice"
    assert service.get_history_messages.call_args.args[0].user_name == "alice"


@pytest.mark.asyncio
@pytest.mark.parametrize("action_name", ["delete", "clear"])
async def test_owned_mutation_passes_verified_owner(identity, action_name):
    service = Mock()
    service.get.return_value = object()
    await getattr(endpoints, action_name)("mine", service=service, http_request=identity)
    assert service.get.call_args.args[0].user_name == "alice"
    assert getattr(service, action_name).call_args.args[0].user_name == "alice"


def test_missing_verified_identity_fails_closed(monkeypatch):
    monkeypatch.setenv("DBGPT_PIPELINE_IDENTITY_URL", "http://pipeline/api/auth/ai-identity")
    with pytest.raises(HTTPException) as exc:
        endpoints._pipeline_actor(None)
    assert exc.value.status_code == 401
