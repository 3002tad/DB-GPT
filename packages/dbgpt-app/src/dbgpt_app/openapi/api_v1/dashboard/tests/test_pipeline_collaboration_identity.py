from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from dbgpt_app.openapi.api_v1.dashboard import api


@pytest.mark.asyncio
async def test_socket_rejects_ticket_belonging_to_another_pipeline_actor(monkeypatch):
    monkeypatch.setattr(api.ticket_store, "consume", lambda *_: SimpleNamespace(actor_id="other"))
    socket = SimpleNamespace(
        query_params={"ticket": "one-use-ticket"},
        state=SimpleNamespace(pipeline_actor=SimpleNamespace(id="verified")),
        close=AsyncMock(),
    )
    await api.collaborate_dashboard(socket, "board-1")
    socket.close.assert_awaited_once_with(code=4403, reason="Collaboration identity mismatch")
