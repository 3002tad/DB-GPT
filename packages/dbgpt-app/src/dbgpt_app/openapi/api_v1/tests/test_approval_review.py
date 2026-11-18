"""Complete review stays separate from compact events and execution permission."""
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from dbgpt_app.openapi.api_v1 import approval as module


@pytest.mark.parametrize("locale", ["vi", "vi-VN", "vi_VN"])
def test_vietnamese_intent(locale):
    assert module.normalize_intent_locale(locale) == "vi"
    assert "tiếng Việt" in module.intent_prompt(module.normalize_intent_locale(locale))
    assert "Chưa phân tích" in module.intent_fallback_bullets(module.normalize_intent_locale(locale))[0]


@pytest.mark.asyncio
async def test_intent_failure_follows_conversation_language(monkeypatch):
    from dbgpt_app.openapi.api_v1 import approval_audit
    monkeypatch.setattr(approval_audit, "audit_intent", lambda *args: None)
    module.set_conv_locale("review-vi", "vi-VN")
    events = []

    async def emit(kind, data):
        events.append((kind, data))

    async def unavailable(*args):
        raise RuntimeError("test analyzer unavailable")

    pending = SimpleNamespace(approval_id="review", conv_id="review-vi", tool="code", args={})
    await module.push_intent(pending, emit, unavailable)
    assert events[0][1]["bullets"] == module.intent_fallback_bullets("vi")


@pytest.mark.asyncio
async def test_full_review_requires_owner_without_resolving(monkeypatch):
    from dbgpt_app.openapi.api_v1 import agentic_data_api as api
    code = "# long script\n" * 100 + "print('TAIL_FULL_SCRIPT')"
    args = {"code": code, "timeout": 37, "nested": {"path": "output.csv"}}
    pending = SimpleNamespace(approval_id="review-1", conv_id="owned", tool="code", args=args, status="pending")
    monkeypatch.setattr(module, "approval_center", SimpleNamespace(get=lambda key: pending if key == "review-1" else None))
    calls = []

    def require_owner(conv_id, actor):
        calls.append((conv_id, actor))
        if actor != "owner":
            raise HTTPException(404, "Conversation not found")

    monkeypatch.setenv("DBGPT_PIPELINE_IDENTITY_URL", "http://identity.test")
    monkeypatch.setattr(api, "_require_owned_conversation", require_owner)
    result = await api.approval_details("review-1", SimpleNamespace(user_id="owner"))
    assert result.data["arguments"] == args
    assert "TAIL_FULL_SCRIPT" not in module.preview_args(args)
    assert pending.status == "pending"
    assert calls == [("owned", "owner")]
    for key, actor in [("review-1", "other"), ("missing", "owner")]:
        with pytest.raises(HTTPException) as exc:
            await api.approval_details(key, SimpleNamespace(user_id=actor))
        assert exc.value.status_code == 404
    with pytest.raises(HTTPException) as exc:
        await api.approval_details("review-1", SimpleNamespace(user_id=None))
    assert exc.value.status_code == 401


def test_code_memory_is_exact_and_once_does_not_remember():
    center = module.ApprovalCenter()
    args = {"code": "print(1)", "timeout": 10}
    center.remember("chat", "once", "code", args)
    assert not center.is_allowed("chat", "code", args)
    center.remember("chat", "session", "code", args)
    assert center.is_allowed("chat", "code", args)
    assert not center.is_allowed("other", "code", args)
    assert not center.is_allowed("chat", "code", {**args, "code": "print(2)"})
    assert not center.is_allowed("chat", "code", {**args, "timeout": 11})


@pytest.mark.parametrize("role", ["analyst", "super_admin"])
def test_review_route_is_available_to_both_roles(role):
    from dbgpt_app.pipeline_authorization import authorize_pipeline_request
    from dbgpt_app.pipeline_identity import PipelineActor
    actor = PipelineActor(id="owner", role=role)
    path = "/api/v1/chat/approval/review-1/details"
    assert authorize_pipeline_request(actor, {"method": "GET", "path": path})
    assert not authorize_pipeline_request(actor, {"method": "DELETE", "path": path})
