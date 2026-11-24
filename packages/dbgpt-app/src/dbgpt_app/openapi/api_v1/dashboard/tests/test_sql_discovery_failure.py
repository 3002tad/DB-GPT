"""Typed discovery recovery and truthful errors for heterogeneous SQL batches."""
import json

import pytest

from dbgpt.agent import ActionOutput, AgentContext, AgentMessage
from dbgpt.agent.resource import ToolPack
from dbgpt.agent.resource.tool.base import tool
from dbgpt_app.openapi.api_v1.dashboard.confirmation import generation_failure
from dbgpt_app.openapi.api_v1.dashboard.tool_failure import capture_tool_failure, discovery_correction
from .test_tool_failure_routing import bound_agent


def sql_error(code="SQL_UNDEFINED_COLUMN"):
    return {"success": False, "error_code": code,
            "chunks": [{"output_type": "text", "content": 'column "created_at" does not exist'}],
            "recovery_schema": {"relations": [{"name": "payments", "columns": ["action_at", "action", "currency"]}]},
            "recovery_hint": "Inspect the actual columns and grain."}


def batch(error, *, first_success=True):
    success = {"name": "sql_query", "success": True, "content": "successful-rows-" + "x" * 5000}
    failure = {"name": "sql_query", "success": False, "content": json.dumps(error)}
    items = [success, failure, success] if first_success else [failure, success]
    return ActionOutput(action=", ".join("sql_query" for _ in items), is_exe_success=False,
                        content="\n\n".join(i["content"] for i in items), observations=json.dumps(items))


@pytest.mark.parametrize("code", ["SQL_UNDEFINED_COLUMN", "SQL_UNDEFINED_TABLE", "SQL_AMBIGUOUS_COLUMN", "SQL_GROUPING_ERROR"])
def test_typed_postgres_recovery_retains_schema_without_replaying_successes(code):
    state = {}
    output = batch(sql_error(code))
    original = output.observations
    correction = discovery_correction(state, output)
    assert code in correction and "action_at" in correction and "correct failed calls only" in correction
    assert "successful-rows" not in correction
    assert output.observations == original
    assert discovery_correction(state, output)
    assert discovery_correction(state, output) is None
    assert "dashboard_tool_failure" not in state


@pytest.mark.parametrize("code", ["SQL_QUERY_TIMEOUT", "SQL_READ_ONLY_REQUIRED", "BLOCKED_BY_QUALITY", "SQL_PERMISSION_DENIED", "CONNECTION_FAILED", "UNKNOWN"])
def test_mixed_fatal_sibling_cannot_be_recovered_as_authoring_error(code):
    output = batch(sql_error())
    items = json.loads(output.observations)
    items.append({"name": "sql_query", "success": False, "content": json.dumps(sql_error(code))})
    output.observations = json.dumps(items)
    state = {}
    assert discovery_correction(state, output) is None
    assert not state
    failure = capture_tool_failure(state, output)
    assert len(failure["failed_calls"]) == 2
    assert code in failure["message"] and "successful-rows" not in failure["message"]


@pytest.mark.parametrize("locale", ["vi", "en", "zh"])
@pytest.mark.parametrize("first_success", [True, False])
def test_terminal_batch_error_extracts_failed_item_and_localizes(locale, first_success):
    failure = capture_tool_failure({"_ui_locale": locale}, batch(sql_error(), first_success=first_success))
    assert failure["reason"] == "SQL_UNDEFINED_COLUMN"
    assert 'created_at' in failure["message"] and "successful-rows" not in failure["message"]
    assert failure["failed_calls"][0]["recovery_schema"]["relations"][0]["columns"][0] == "action_at"
    if locale != "zh":
        for field in ("title", "summary", "message", "retry_hint", "stage_label"):
            assert not any('\u4e00' <= c <= '\u9fff' for c in failure[field])


@pytest.mark.parametrize("observation", ['[{"success":false}]', '[null]', '[{"name":"sql_query","success":1}]', '[{"name":"sql_query","success":false,"content":"not JSON"}]'])
def test_malformed_batch_is_not_retryable(observation):
    output = ActionOutput(action="sql_query", is_exe_success=False, content="bad", observations=observation)
    assert discovery_correction({}, output) is None
    assert capture_tool_failure({}, output)


@pytest.mark.parametrize("content", ["[]", '[{"dashboard_id":"saved"}]', '[1,2,3]'])
def test_successful_business_json_array_is_not_a_failed_batch(content):
    assert capture_tool_failure({}, ActionOutput(action="list_dashboards", is_exe_success=True,
                                                content=content, observations=content)) is None


def test_legacy_error_with_fatal_reason_is_not_retried_for_syntax_wording():
    error = sql_error("SQL_QUERY_FAILED")
    error["chunks"][0]["content"] = "permission denied; inspect syntax error diagnostics"
    assert discovery_correction({}, batch(error)) is None


def test_fatal_sibling_remains_visible_after_a_long_schema_error():
    error = sql_error()
    error["chunks"][0]["content"] = "schema diagnostic " * 300
    output = batch(error)
    items = json.loads(output.observations)
    items.append({"name": "sql_query", "success": False,
                  "content": json.dumps({"error_code": "SQL_QUERY_TIMEOUT",
                                         "message": "Query timed out"})})
    output.observations = json.dumps(items)
    assert discovery_correction({}, output) is None
    failure = capture_tool_failure({}, output)
    assert failure["reason"] == "SQL_QUERY_TIMEOUT"
    assert "SQL_QUERY_TIMEOUT" in failure["summary"]
    assert len(failure["failed_calls"]) == 2


@pytest.mark.parametrize("payload", [
    {"error_code": "SQL_QUERY_FAILED", "chunks": None},
    {"error_code": "SQL_QUERY_FAILED", "chunks": {}},
    {"__dashboard_tool_error__": "malformed"},
])
def test_malformed_error_payload_stops_without_crashing_handler(payload):
    assert discovery_correction({}, batch(payload)) is None
    assert capture_tool_failure({}, batch(payload))


@pytest.mark.parametrize("locale", ["vi", "en"])
def test_generation_failure_localizes_without_marking_unsaved_widgets_complete(locale):
    state = {"_ui_locale": locale, "dashboard_plan": {"widgets": [{"id": "a", "title": "Metric"}]},
             "dashboard_generation": {"dashboard_id": "demo", "current_revision": 1, "stage": "saving"}}
    failure = generation_failure(state)
    assert failure["pending_widget_ids"] == ["a"] and failure["validated_widgets"] == 0
    assert not any('\u4e00' <= c <= '\u9fff' for c in failure["message"])


@pytest.mark.asyncio
async def test_real_native_dispatch_can_repair_failed_query_only_then_continue():
    calls = []

    @tool(description="Read-only query")
    async def sql_query(sql: str):
        calls.append(sql)
        return json.dumps(sql_error()) if "created_at" in sql else json.dumps({"success": True, "rows": [[1]]})

    state = {"conv_id": "typed-native-repair", "_ui_locale": "vi"}
    agent = bound_agent(state, [sql_query])
    agent.bind(ToolPack([sql_query]))
    agent.bind(AgentContext(conv_id=state["conv_id"], enable_native_function_calling=True))

    async def dispatch(queries):
        object.__setattr__(agent, "_pending_native_tool_calls", [
            {"id": str(i), "type": "function", "function": {"name": "sql_query", "arguments": json.dumps({"sql": q})}}
            for i, q in enumerate(queries)
        ])
        return await agent.act(AgentMessage(content="Khám phá dữ liệu"), agent, **agent.prepare_act_param(None, agent))

    output = await dispatch(["SELECT 1", "SELECT created_at FROM payments", "SELECT 2"])
    assert output.have_retry and not output.is_exe_success
    assert [x["success"] for x in json.loads(output.observations)] == [True, False, True]
    repaired = await dispatch(["SELECT action_at FROM payments"])
    assert repaired.is_exe_success and "dashboard_tool_failure" not in state
    assert calls.count("SELECT 1") == calls.count("SELECT 2") == 1


@pytest.mark.asyncio
async def test_native_public_prose_cannot_skip_dashboard_plan_persistence():
    state = {"conv_id": "public-dashboard", "_ui_locale": "vi",
             "_query_artifacts": {"sql-ok": {"execution": {"status": "succeeded"}}}}
    agent = bound_agent(state, [])
    agent.bind(AgentContext(conv_id=state["conv_id"], enable_native_function_calling=True))
    for _ in range(2):
        object.__setattr__(agent, "_pending_native_public_answer", "Đã tạo dashboard.")
        result = await agent.act(AgentMessage(content="Đã tạo dashboard."), agent)
        assert not result.is_exe_success and not result.terminate and result.have_retry
        assert "plan_dashboard" in result.content
    object.__setattr__(agent, "_pending_native_public_answer", "Đã tạo dashboard.")
    result = await agent.act(AgentMessage(content="Đã tạo dashboard."), agent)
    assert not result.is_exe_success and not result.have_retry
    assert not state.get("dashboard_refs")
