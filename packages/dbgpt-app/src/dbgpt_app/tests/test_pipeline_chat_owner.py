from unittest.mock import patch

import pytest
from fastapi import HTTPException

from dbgpt_app.openapi.api_v1.agentic_data_api import _guard_pipeline_conversation_owner


def test_pipeline_chat_accepts_own_or_new_conversation_and_rejects_foreign(monkeypatch):
    monkeypatch.setenv("DBGPT_PIPELINE_IDENTITY_URL", "http://pipeline/api/auth/ai-identity")
    with patch("dbgpt_app.openapi.api_v1.agentic_data_api._conversation_owner_user_name", return_value=None):
        _guard_pipeline_conversation_owner("new", "alice")
    with patch("dbgpt_app.openapi.api_v1.agentic_data_api._conversation_owner_user_name", return_value="alice"):
        _guard_pipeline_conversation_owner("mine", "alice")
        with pytest.raises(HTTPException) as exc:
            _guard_pipeline_conversation_owner("mine", "bob")
        assert exc.value.status_code == 404
    with pytest.raises(HTTPException) as exc:
        _guard_pipeline_conversation_owner("new", None)
    assert exc.value.status_code == 401
