"""Terminal SSE and reloaded history share observed step counts and duration."""

import json
from unittest.mock import MagicMock

import pytest

from dbgpt_app.openapi.api_v1 import agentic_data_api as api
from dbgpt_app.openapi.api_v1.execution_summary import TurnDuration, summarize_execution
from dbgpt_app.openapi.api_v1.react_final import AgentFinalAnswer


STEPS = [
    {"id": "plan", "action": "todowrite", "status": "done", "title": "init"},
    {"id": "one", "action": "sql_query", "status": "failed"},
    {"id": "plan", "action": "todowrite", "status": "done", "title": "progress"},
    {"id": "two", "action": "sql_query", "status": "done"},
    {"id": "plan", "action": "todowrite", "status": "done", "title": "done"},
    {"id": "progress", "action": "__progress__", "status": "done"},
    {"id": "final", "action": "terminate", "status": "done"},
]


def test_visible_counts_collapse_todo_updates_without_hiding_failed_attempts():
    result = summarize_execution(STEPS)
    assert result == {"version": 1, "recorded_steps": 3, "tool_steps": 3}
    assert len(STEPS) == 7
    assert STEPS[1]["status"] == "failed"


def test_duration_freezes_on_terminal_and_does_not_grow_during_reload():
    now = [10.0]
    timer = TurnDuration(clock=lambda: now[0])
    now[0] = 15.0
    assert timer.snapshot() == {"duration_ms": 5000, "duration_complete": False}
    now[0] = 70.1
    saved = timer.snapshot(terminal=True)
    now[0] = 999999.0
    assert timer.snapshot(terminal=True) == saved
    assert timer.snapshot() == {"duration_ms": 60100, "duration_complete": True}


@pytest.mark.parametrize("status", [None, "failed", "interrupted", "running"])
def test_history_and_terminal_event_preserve_exact_same_summary(status):
    timer = TurnDuration(clock=lambda: 10)
    timing = timer.snapshot(terminal=status != "running")
    history = api._build_react_history_payload(
        final_content="Retained result", steps=[dict(step) for step in STEPS],
        task_plan=[], generated_images=[], sub_agents=[], input_files=[],
        execution_status=status, execution_timing=timing,
    )
    stored = json.loads(history)
    expected = {"version": 1, "recorded_steps": 3, "tool_steps": 3, **timing}
    assert stored["execution_summary"] == expected
    storage = MagicMock()
    final, _ = api._react_terminal_events(storage, history, AgentFinalAnswer("Retained result"))
    storage.add_view_message.assert_called_once_with(history)
    assert json.loads(final.removeprefix("data: "))["execution_summary"] == expected


def test_old_history_without_timing_does_not_invent_duration_or_provider_calls():
    result = summarize_execution([{"id": "batch", "action": "parallel_tool", "status": "done"}])
    assert result["tool_steps"] == 1
    assert "duration_ms" not in result
    assert "model_calls" not in result and "tool_calls" not in result
