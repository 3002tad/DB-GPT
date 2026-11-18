"""DEEP18-02: explicit SQL producers reach Python without copying source rows."""

import inspect
import json
import sqlite3

import pytest

from dbgpt.core.interface.report_capture import (
    ArtifactCaptureContext,
    InMemoryArtifactSink,
    capture_sql_execution,
    read_artifact_result,
)
from dbgpt_app.openapi.api_v1.tools._sandbox_capture import (
    TrackedSQLResults,
    capture_helper_source,
)
from dbgpt_app.openapi.api_v1.tools.code_interpreter import make_code_interpreter
from dbgpt_app.openapi.api_v1.tools.evidence_catalog import EvidenceCatalog, SessionArtifactSink
from dbgpt_app.openapi.api_v1.tools.sql_query import make_sql_query


def test_input_discovery_does_not_claim_unread_sources(tmp_path):
    trace = tmp_path / "inputs.json"
    results = TrackedSQLResults([
        {"artifact_id": "sql-first", "columns": ["sales"], "row_count": 1,
         "rows": [[7]], "truncated": False},
        {"artifact_id": "sql-other", "columns": ["different"], "row_count": 1,
         "rows": [[999]], "truncated": False},
    ], str(trace))
    assert [item["artifact_id"] for item in results.catalog()] == ["sql-first", "sql-other"]
    assert "rows" not in results.catalog()[0]
    assert not trace.exists()
    assert results.select("sql-first")["rows"] == [[7]]
    assert json.loads(trace.read_text()) == ["sql-first"]
    with pytest.raises(KeyError, match="SQL_RESULT_NOT_FOUND"):
        results.select("sql-foreign")
    assert json.loads(trace.read_text()) == ["sql-first"]


def test_loader_is_shipped_to_children_without_host_imports(tmp_path):
    namespace = {}
    exec(capture_helper_source(), namespace)
    results = namespace["TrackedSQLResults"]([
        {"artifact_id": "sql-typed", "rows": [[{"$decimal": "12.30"}]],
         "columns": ["amount"], "row_count": 1, "truncated": False},
    ], str(tmp_path / "trace.json"))
    assert str(results.select("sql-typed")["rows"][0][0]) == "12.30"
    with pytest.raises(TypeError, match="SQL_RESULT_SELECTOR_INVALID"):
        results.select(True)
    with pytest.raises(IndexError, match="SQL_RESULT_NOT_FOUND"):
        results.select(99)


class SqliteConnector:
    def run(self, sql):
        with sqlite3.connect(":memory:") as db:
            cursor = db.execute(sql)
            return [cursor.description, *cursor.fetchall()]


@pytest.mark.asyncio
async def test_native_tool_observation_exposes_a_usable_python_handoff(python_runtime):
    from dbgpt.agent.expand.actions.tool_action import run_tool
    from dbgpt.agent.resource.tool.pack import ToolPack

    sink = InMemoryArtifactSink(ArtifactCaptureContext(conv_uid="native-handoff"))
    state = {"conv_id": "native-handoff", "database_name": "fixture", "_report_artifact_sink": sink}
    query = make_sql_query(state, SqliteConnector())
    sql_out = await run_tool("sql_query", {"sql": "SELECT 17 AS observed"},
                             ToolPack([query._tool]), need_vis_render=False)
    assert sql_out.is_exe_success is True
    sql_response = json.loads(sql_out.observations)
    python = make_code_interpreter(state)
    py_out = await run_tool("code", {"code": (
        sql_response["python_input"]["load"] + "\n"
        "REPORT_RESULT = {'observed': int(df.iloc[0, 0])}"
    )}, ToolPack([python._tool]), need_vis_render=False)
    assert py_out.is_exe_success is True, py_out.observations
    response = json.loads(py_out.observations)
    assert response["provenance"]["input_artifact_ids"] == [sql_response["artifact_id"]]
    produced = next(a for a in sink.snapshot() if a.artifact_id == response["artifact_id"])
    assert read_artifact_result(produced) == {"observed": 17}


@pytest.fixture
def python_runtime(tmp_path, monkeypatch):
    from dbgpt.configs import model_config
    from dbgpt_sandbox.sandbox.execution_layer import runtime_factory

    monkeypatch.setattr(model_config, "PILOT_PATH", str(tmp_path))
    monkeypatch.setattr(runtime_factory, "SANDBOX_RUNTIME", "local")


@pytest.mark.asyncio
async def test_sql_tool_handoff_reads_full_prior_result_by_id(python_runtime, tmp_path):
    catalog = EvidenceCatalog(tmp_path / "catalog.sqlite3", owner_id="analyst")
    first = SessionArtifactSink(ArtifactCaptureContext(conv_uid="chat", run_id="one"), catalog)
    state = {"conv_id": "chat", "database_name": "fixture", "_report_artifact_sink": first}
    query = inspect.unwrap(make_sql_query(state, SqliteConnector()))
    result = json.loads(await query(sql=(
        "WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL "
        "SELECT n + 1 FROM numbers WHERE n < 1200) SELECT n AS sales FROM numbers"
    )))
    sql_id = result["artifact_id"]
    assert result["python_input"]["artifact_id"] == sql_id
    assert result["python_input"]["load"] == f"df = sql_result_frame({sql_id!r})"
    assert result["result_coverage"]["preview_truncated"] is True
    # The loader must survive the beginning of a tool-result persistence preview.
    assert "sql_result_frame" in json.dumps(result)[:700]
    other = json.loads(await query(sql="SELECT 999 AS different"))["artifact_id"]

    followup = SessionArtifactSink(
        ArtifactCaptureContext(conv_uid="chat", run_id="two"), catalog, include_prior=True,
    )
    execute = inspect.unwrap(make_code_interpreter({"conv_id": "chat", "_report_artifact_sink": followup}))
    response = json.loads(await execute(code=(
        "print(SQL_RESULT_CATALOG)\n" + result["python_input"]["load"] + "\n"
        "REPORT_RESULT = {'rows': len(df), 'sum': int(df.sales.sum())}\n"
        "print(REPORT_RESULT)"
    )))
    assert response["success"] is True, response
    assert response["provenance"]["input_artifact_ids"] == [sql_id]
    artifact = next(a for a in followup.snapshot() if a.artifact_id == response["artifact_id"])
    assert artifact.execution.run_id == "two"
    assert artifact.input_artifact_ids == [sql_id]
    assert other not in artifact.input_artifact_ids
    assert read_artifact_result(artifact) == {"rows": 1200, "sum": 720600}


@pytest.mark.asyncio
async def test_discovery_literal_and_commented_id_do_not_gain_lineage(python_runtime):
    sink = InMemoryArtifactSink(ArtifactCaptureContext(conv_uid="literal"))
    sql_id = capture_sql_execution(sql="SELECT 7 AS observed", database="fixture", columns=["observed"],
                                   rows=[[7]], duration_ms=1, artifact_sink=sink)
    execute = inspect.unwrap(make_code_interpreter({"conv_id": "literal", "_report_artifact_sink": sink}))
    response = json.loads(await execute(code=(
        f"# SQL source: {sql_id}\nprint(SQL_RESULT_CATALOG)\n"
        f"REPORT_RESULT = {{'observed': 7, 'sql_artifact_id': {sql_id!r}}}\n"
    )))
    assert response["success"] is True
    assert response["provenance"] == {"input_artifact_ids": [], "status": "uncaptured_inputs"}
    assert "sql_result_frame(artifact_id=" in response["recovery_hint"]
    assert "INPUT_LINEAGE_UNCAPTURED" in json.dumps(response)


@pytest.mark.asyncio
async def test_missing_foreign_and_failed_sql_are_actionable_not_auto_bound(python_runtime):
    sink = InMemoryArtifactSink(ArtifactCaptureContext(conv_uid="empty"))
    failed = capture_sql_execution(sql="SELECT broken", database="fixture", duration_ms=1,
                                   error="missing column", artifact_sink=sink)
    execute = inspect.unwrap(make_code_interpreter({"conv_id": "empty", "_report_artifact_sink": sink}))
    for selector in [failed, "sql-other-conversation"]:
        response = json.loads(await execute(code=f"frame = sql_result_frame({selector!r})"))
        assert response["success"] is False
        assert response["error_code"] == "PYTHON_SQL_INPUT_NOT_FOUND"
        assert response["provenance"]["input_artifact_ids"] == []
        assert "SQL_RESULT_CATALOG" in response["recovery_hint"]


@pytest.mark.asyncio
async def test_keyword_selector_and_legacy_index_read_only_selected_inputs(python_runtime):
    sink = InMemoryArtifactSink(ArtifactCaptureContext(conv_uid="selectors"))
    ids = [capture_sql_execution(sql=f"SELECT {n}", database="fixture", columns=["n"],
                                rows=[[n]], duration_ms=1, artifact_sink=sink) for n in [3, 9]]
    execute = inspect.unwrap(make_code_interpreter({"conv_id": "selectors", "_report_artifact_sink": sink}))
    for selector in [f"artifact_id={ids[0]!r}", "0", "-2"]:
        response = json.loads(await execute(code=f"df = sql_result_frame({selector})\nREPORT_RESULT={{'n': int(df.iloc[0,0])}}"))
        assert response["success"] is True, response
        assert response["provenance"]["input_artifact_ids"] == [ids[0]]


@pytest.mark.asyncio
@pytest.mark.parametrize("owner,conversation", [("analyst", "other-chat"), ("other-actor", "chat")])
async def test_id_lookup_cannot_cross_catalog_owner_or_conversation(python_runtime, tmp_path, owner, conversation):
    path = tmp_path / "scoped-catalog.sqlite3"
    source = SessionArtifactSink(ArtifactCaptureContext(conv_uid="chat"), EvidenceCatalog(path, owner_id="analyst"))
    sql_id = capture_sql_execution(sql="SELECT 7", database="fixture", columns=["n"], rows=[[7]],
                                   duration_ms=1, artifact_sink=source)
    target = SessionArtifactSink(ArtifactCaptureContext(conv_uid=conversation),
                                 EvidenceCatalog(path, owner_id=owner), include_prior=True)
    execute = inspect.unwrap(make_code_interpreter({"conv_id": conversation, "_report_artifact_sink": target}))
    response = json.loads(await execute(code=f"df = sql_result_frame({sql_id!r})"))
    assert response["success"] is False
    assert response["error_code"] == "PYTHON_SQL_INPUT_NOT_FOUND"
    assert response["provenance"]["input_artifact_ids"] == []
