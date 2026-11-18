"""A not-yet-created conversation must not weaken telemetry ownership checks."""
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient

from ..api.endpoints import get_service, router


@pytest.mark.asyncio
async def test_usage_is_unknown_until_provider_reports_and_never_reads_foreign(monkeypatch):
    from dbgpt_app.openapi.api_v1 import agentic_data_api as api

    monkeypatch.setenv("DBGPT_PIPELINE_IDENTITY_URL", "http://identity.test")
    stored = set()
    reads = Mock(return_value=[])

    def require_owner(conv_id, actor):
        if actor != "analyst-1" or conv_id not in stored:
            raise HTTPException(404, "Conversation not found")

    monkeypatch.setattr(api, "_require_owned_conversation", require_owner)
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_service] = lambda: SimpleNamespace(
        provider=SimpleNamespace(conversation_usage=reads)
    )

    @app.middleware("http")
    async def actor(request, call_next):
        request.state.pipeline_actor = SimpleNamespace(id="analyst-1", role="analyst")
        return await call_next(request)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Invalid/unpersisted IDs retain 404; the UI waits instead of changing ACL.
        for conv_id in ("new", "foreign"):
            response = await client.get("/usage", params={"conversation_id": conv_id})
            assert response.status_code == 404
        reads.assert_not_called()
        stored.add("new")
        response = await client.get("/usage", params={"conversation_id": "new"})
        assert response.status_code == 200
        assert response.json()["data"]["models"] == []
        reads.assert_called_once_with("new")
        reads.return_value = [{"model": "qwen-test", "calls": 1, "complete": True, "total_tokens": 42}]
        response = await client.get("/usage", params={"conversation_id": "new"})
        assert response.json()["data"]["models"][0]["total_tokens"] == 42


def test_pi_storage_does_not_confirm_a_failed_save(monkeypatch):
    from dbgpt_app.openapi.api_v1 import harness_pi_stream as pi

    conv = Mock()
    serve = SimpleNamespace(conv_storage=object(), message_storage=object())
    monkeypatch.setattr(pi.ConversationServe, "get_instance", lambda _: serve)
    monkeypatch.setattr(pi, "StorageConversation", lambda **kwargs: conv)
    dialogue = SimpleNamespace(chat_mode="chat_react_agent", user_name="analyst-1", sys_code=None, user_input="test", app_code=None)
    assert pi._open_pi_storage_conv(dialogue, "new") is conv
    assert [call[0] for call in conv.mock_calls] == ["save_to_storage", "start_new_round"]
    conv.reset_mock()
    conv.save_to_storage.side_effect = RuntimeError("test persistence failure")
    assert pi._open_pi_storage_conv(dialogue, "failed") is None
    conv.start_new_round.assert_not_called()
