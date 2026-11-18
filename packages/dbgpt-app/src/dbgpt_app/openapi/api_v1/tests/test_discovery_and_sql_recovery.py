"""Use registered tool schemas and repair aggregate SQL without rewriting it."""

import json
import sqlite3
from unittest.mock import AsyncMock

import pytest

from dbgpt.agent.expand.actions.tool_action import run_tool
from dbgpt.agent.expand.tool_calling_agent import _build_openai_tools
from dbgpt.agent.resource.tool.base import tool
from dbgpt.agent.resource.tool.pack import ToolPack
from dbgpt.core.interface.report_capture import ArtifactCaptureContext, InMemoryArtifactSink
from dbgpt_ext.datasource.rdbms.conn_sqlite import SQLiteConnector
from dbgpt_app.openapi.api_v1.tool_names import tool_availability_guidance
from dbgpt_app.openapi.api_v1.tools.sql_query import make_sql_query
from dbgpt_app.openapi.api_v1.tools.tool_catalog import make_tool_search


@pytest.mark.asyncio
async def test_missing_tool_then_discovery_then_native_schema_call():
    calls = []

    @tool(description="Chart executed SQL")
    def chart_query(sql: str, display_type: str = "response_line_chart"):
        calls.append((sql, display_type))
        return "rendered"

    @tool(description="A tool outside this turn's permissions")
    def unavailable_tool():
        raise AssertionError("must not run")

    pack = ToolPack([])
    catalog = ToolPack([chart_query, unavailable_tool]).sub_resources
    search = make_tool_search(catalog, lambda: pack, lambda name: name == "chart_query", AsyncMock())
    pack.append(search._tool)
    missing = await run_tool("chart_query", {"chart_type": "line", "data": []}, pack, need_vis_render=False)
    assert missing.is_exe_success is False
    error = json.loads(missing.observations)
    assert error["error_code"] == "TOOL_NOT_ACTIVE"
    assert "tool_search" in error["recovery_hint"]
    assert calls == []
    discovery = json.loads(await search("chart_query"))
    assert discovery["available_next_round"] is True
    schema = discovery["tools"][0]["parameters"]
    assert schema["required"] == ["sql"]
    assert "display_type" in schema["properties"]
    native = next(item for item in _build_openai_tools(pack) if item["function"]["name"] == "chart_query")
    native_schema = native["function"]["parameters"]
    # The native transport adds optional public progress ('intention'), not
    # an argument of the underlying tool. Real tool fields stay identical.
    assert native_schema["required"] == schema["required"]
    assert {key: value for key, value in native_schema["properties"].items() if key != "intention"} == schema["properties"]
    invalid = await run_tool("chart_query", {"chart_type": "line", "data": []}, pack, need_vis_render=False)
    assert invalid.is_exe_success is False
    assert "TOOL_ARGUMENT_INVALID" in invalid.content
    assert '"display_type"' in invalid.content
    assert calls == []
    corrected = await run_tool("chart_query", {"sql": "SELECT 1", "display_type": "response_bar_chart"}, pack, need_vis_render=False)
    assert corrected.is_exe_success is True
    assert calls == [("SELECT 1", "response_bar_chart")]
    denied = json.loads(await search("unavailable_tool"))
    assert denied["tools"] == [] and denied["available_next_round"] is False
    assert "unavailable_tool" not in pack._resources


@pytest.mark.asyncio
async def test_no_discovery_pack_does_not_advertise_nonexistent_search():
    result = await run_tool("invented", {}, ToolPack([]), need_vis_render=False)
    assert result.is_exe_success is False
    assert "tool_search" not in json.loads(result.observations)["recovery_hint"]


def test_availability_distinguishes_active_from_deferred_names():
    text = tool_availability_guidance({"tool_search", "sql_query"}, {"sql_query", "chart_query"})
    assert "Callable now: sql_query, tool_search." in text
    assert "Discoverable, not yet callable: chart_query." in text
    assert "sequential, not parallel" in text
    assert "parameter schema" in text


@pytest.mark.asyncio
async def test_nested_aggregate_error_can_recover_with_real_sql_and_keep_evidence(tmp_path):
    path = tmp_path / "recovery.db"
    with sqlite3.connect(path) as db:
        db.execute("CREATE TABLE visits (source TEXT, session_id TEXT)")
        db.executemany("INSERT INTO visits VALUES (?, ?)", [("a", "one"), ("a", "one"), ("b", "two")])
    connector = SQLiteConnector.from_file_path(str(path))
    sink = InMemoryArtifactSink(ArtifactCaptureContext(conv_uid="grouping-recovery"))
    query = make_sql_query({"_report_artifact_sink": sink}, connector)
    try:
        failed = json.loads(await query(sql="SELECT SUM(COUNT(DISTINCT session_id)) FROM visits GROUP BY source"))
        assert failed["success"] is False
        assert failed["error_code"] == "SQL_GROUPING_ERROR"
        assert "subquery/CTE" in failed["recovery_hint"]
        assert "overlap" in failed["recovery_hint"]
        fixed_sql = "WITH counts AS (SELECT source, COUNT(DISTINCT session_id) AS n FROM visits GROUP BY source) SELECT SUM(n) AS total FROM counts"
        fixed = json.loads(await query(sql=fixed_sql))
        assert fixed.get("success") is not False and "error_code" not in fixed
        result = next(chunk["content"] for chunk in fixed["chunks"] if chunk["output_type"] == "query")
        assert result["rows"] == [{"total": 2}] or result["rows"] == [[2]]
        window = json.loads(await query(sql="SELECT source, COUNT(*) AS n, SUM(COUNT(*)) OVER () AS total FROM visits GROUP BY source"))
        assert window.get("success") is not False and "error_code" not in window
    finally:
        connector.close()
    sql_artifacts = [item for item in sink.snapshot() if item.type == "sql"]
    assert [item.status for item in sql_artifacts] == ["failed", "succeeded", "succeeded"]
    assert sql_artifacts[1].sql == fixed_sql


@pytest.mark.asyncio
async def test_postgres_grouping_sqlstate_gets_recovery_without_schema_guessing():
    class GroupingError(Exception):
        pgcode = "42803"
    class Connector:
        def run(self, sql):
            raise GroupingError("grouping failed")
    result = json.loads(await make_sql_query({}, Connector())(sql="SELECT SUM(COUNT(*)) FROM visits"))
    assert result["error_code"] == "SQL_GROUPING_ERROR"
    assert "recovery_schema" not in result
    assert "Window aggregates" in result["recovery_hint"]
