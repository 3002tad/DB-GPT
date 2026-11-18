"""Report failures must not replace completed analysis or publish a fake report."""

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from dbgpt.core.interface.report_capture import (
    ArtifactCaptureContext,
    InMemoryArtifactSink,
    capture_sql_execution,
)
from dbgpt_app.openapi.api_v1 import agentic_data_api as api
from dbgpt_app.openapi.api_v1.execution_fallback import (
    missing_report_message,
    report_failure_answer,
    unfinished_message,
)
from dbgpt_app.openapi.api_v1.react_final import AgentFinalAnswer
from dbgpt_app.openapi.api_v1.tools import report_repair
from dbgpt_app.openapi.api_v1.tools.report_policy import TraceableReportPolicy


RAW_ERROR = 'REPORT_TARGET_BINDING_REQUIRED: ' + json.dumps(
    [{"html_offset": 1234, "path": "/app/internal/draft.html", "html": "<div>raw target</div>"}] * 100
)


@pytest.mark.parametrize("locale", ["vi-VN", "en", "zh-CN", "fr"])
def test_final_report_notice_never_echoes_raw_diagnostics(locale):
    notice = missing_report_message(locale, RAW_ERROR)
    assert len(notice) < 500
    for internal in ("REPORT_TARGET", "html_offset", "/app/", "<div>"):
        assert internal not in notice
    assert "arbitrary private path" not in missing_report_message(
        locale, "arbitrary private path"
    )


@pytest.mark.parametrize("separator", ["\n\n", "\n\nRender failed: "])
def test_report_failure_retains_completed_analysis_and_exports(separator):
    analysis = "Observed total: 10.\n\n[CSV](/exports/result.csv) and [PNG](/plots/chart.png)."
    answer = report_failure_answer(analysis + separator + RAW_ERROR, "vi", RAW_ERROR)
    assert answer.startswith(analysis + "\n\n")
    assert "Chưa tạo được báo cáo" in answer
    assert "liên kết bằng chứng" in answer
    assert "html_offset" not in answer
    assert len(answer) < 700


def test_raw_only_failure_and_interrupted_failure_are_localized():
    answer = report_failure_answer(RAW_ERROR, "vi", RAW_ERROR)
    assert answer.startswith("Chưa tạo được")
    interrupted = unfinished_message("vi", "failed", error=RAW_ERROR)
    combined = report_failure_answer(interrupted, "vi", RAW_ERROR)
    assert "Tác vụ chưa hoàn thành" in combined
    assert "REPORT_TARGET" not in combined
    assert not any("\u4e00" <= char <= "\u9fff" for char in combined)


def test_unclassified_render_exception_is_not_copied_to_final():
    diagnostic = "Invalid target <div>internal</div> at /app/private/draft.html"
    answer = report_failure_answer(
        "Observed total: 10.\n\n" + diagnostic, "vi", diagnostic
    )
    assert answer.startswith("Observed total: 10.\n\n")
    assert "<div>" not in answer and "/app/private" not in answer


def test_policy_keeps_reports_available_without_compulsory_extra_output():
    prompt = TraceableReportPolicy().instructions()
    assert "not a required phase" in prompt
    assert "does not require an additional HTML report" in prompt
    assert "Use generate_report when a report is part of the requested task" in prompt
    assert "Finish analysis, then call generate_report" not in prompt
    assert "data-dbgpt-artifacts" in prompt
    assert TraceableReportPolicy(enabled=False).instructions() == ""


@pytest.mark.asyncio
async def test_failed_report_keeps_evidence_and_publishes_same_final_in_history_and_sse(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(report_repair, "_save_checkpoint", lambda *_: None)
    schedule = AsyncMock()
    monkeypatch.setattr(api, "_schedule_turn_report_persistence", schedule)
    sink = InMemoryArtifactSink(ArtifactCaptureContext(conv_uid="delivery-fixture"))
    sql_id = capture_sql_execution(
        sql="SELECT 10 AS observed", database="fixture", duration_ms=1,
        columns=["observed"], rows=[[10]], artifact_sink=sink,
    )
    state = {
        "conv_id": "delivery-fixture", "_report_html_attempted": True,
        "_report_pending_html": "<html>saved draft</html>",
        "_report_pending_path": str(tmp_path / "draft.html"),
        "_report_checkpoint_path": str(tmp_path / "evidence.json"),
        "_report_artifact_sink": sink,
    }
    response = json.loads(report_repair._record_failure(
        state, {"html": "<html>draft</html>"}, RAW_ERROR, reached_renderer=True,
    ))
    assert response["success"] is False
    assert response["error_preview_truncated"] is True
    assert state["_report_html_error"] == RAW_ERROR
    assert state["_report_pending_html"] == "<html>saved draft</html>"
    content = report_failure_answer("Observed total: 10.", "vi", RAW_ERROR)
    answer = await api._finalize_turn_report_persistence(
        dialogue=SimpleNamespace(user_name="analyst"), conv_id="delivery-fixture",
        user_input="Return CSV and PNG only", final_answer=AgentFinalAnswer(content),
        artifact_sink=sink, react_state=state,
    )
    schedule.assert_not_awaited()
    assert answer.report_id is None and answer.report_run_id is None
    assert answer.report_status is None
    assert sink.snapshot()[0].artifact_id == sql_id
    assert sink.snapshot()[0].status == "succeeded"
    history = api._build_react_history_payload(
        final_content=answer.content, steps=[], task_plan=[], generated_images=[],
        sub_agents=[], input_files=[], report_id=answer.report_id,
        report_run_id=answer.report_run_id, report_status=answer.report_status,
    )
    storage = MagicMock()
    final_event, done = api._react_terminal_events(storage, history, answer)
    storage.add_view_message.assert_called_once_with(history)
    assert content in history or "Observed total: 10." in history
    final = json.loads(final_event.removeprefix("data: "))
    assert final["content"] == content
    assert "html_offset" not in history and "html_offset" not in final_event
    assert json.loads(done.removeprefix("data: "))["type"] == "done"
