"""Regressions from the November 24 Python/chart run, without paid LLM calls."""

import inspect
import json
from datetime import date
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from dbgpt.core.interface.report_capture import (
    ArtifactCaptureContext,
    InMemoryArtifactSink,
    capture_sql_execution,
    read_artifact_result,
)
from dbgpt_app.openapi.api_v1.approval import make_approval_gate
from dbgpt_app.openapi.api_v1.approval_code_risk import python_preflight_error
from dbgpt_app.openapi.api_v1.tools import code_interpreter
from dbgpt_app.openapi.api_v1.tools.result_preview import result_preview
from dbgpt_app.openapi.api_v1.tools.session_evidence import make_session_evidence


@pytest.fixture
def runtime(tmp_path, monkeypatch):
    from dbgpt.configs import model_config
    from dbgpt_sandbox.sandbox.execution_layer import runtime_factory

    monkeypatch.setattr(model_config, "PILOT_PATH", str(tmp_path))
    monkeypatch.setattr(model_config, "STATIC_MESSAGE_IMG_PATH", str(tmp_path / "images"))
    monkeypatch.setattr(runtime_factory, "SANDBOX_RUNTIME", "local")
    sink = InMemoryArtifactSink(ArtifactCaptureContext(conv_uid="csv-followup"))
    return {"conv_id": "csv-followup", "_report_artifact_sink": sink}, sink


async def execute(state, source):
    return json.loads(await inspect.unwrap(code_interpreter.make_code_interpreter(state))(code=source))


@pytest.mark.asyncio
async def test_exact_csv_inputs_flow_to_chart_and_unread_files_do_not(runtime):
    state, sink = runtime
    source = capture_sql_execution(
        sql="SELECT day, n FROM fixture", database="test", duration_ms=1,
        columns=["day", "n"], rows=[[date(2026, 9, 1), 4], [date(2026, 9, 2), 6]],
        artifact_sink=sink,
    )
    first = await execute(state, f"df=sql_result_frame({source!r})\n"
        "df.to_csv(output_path('exports/daily.csv'), index=False)\n"
        "df.to_csv(output_path('exports/unread.csv'), index=False)\n"
        "REPORT_RESULT={'total':df.n.sum(),'day':df.day.min()}\n")
    assert first["saved_result"]["value"] == {"total": 10, "day": {"$date": "2026-09-01"}}
    assert first["saved_result"]["truncated"] is False
    saved = next(a for a in sink.snapshot() if a.artifact_id == first["artifact_id"])
    assert saved.input_artifact_ids == [source]
    reference = next(a for a in sink.snapshot() if getattr(a, "source_name", "") == "daily.csv")
    second = await execute(state, "import matplotlib\nmatplotlib.use('Agg')\n"
        "import matplotlib.pyplot as plt\n"
        "df=pd.read_csv(output_path('exports/daily.csv'))\n"
        "plt.plot(pd.to_datetime(df.day),df.n)\n"
        "plt.savefig(output_path('plots/followup.png'))\nplt.close()\n")
    assert second["success"]
    assert second["provenance"]["input_artifact_ids"] == [reference.artifact_id]
    assert second["recovery_hint"] is None
    assert any(c["output_type"] == "image" for c in second["chunks"])
    assert not any("INPUT_LINEAGE_UNCAPTURED" in str(c) for c in second["chunks"])
    chart = next(a for a in sink.snapshot() if a.artifact_id == second["artifact_id"])
    assert chart.input_artifact_ids == [reference.artifact_id]
    assert reference.input_artifact_ids == [first["artifact_id"]]
    assert read_artifact_result(chart)["images"]


@pytest.mark.asyncio
async def test_changed_or_unregistered_csv_never_inherits_old_lineage(runtime):
    state, sink = runtime
    await execute(state, "pd.DataFrame({'n':[4]}).to_csv(output_path('exports/data.csv'),index=False)")
    root = Path(code_interpreter.conversation_work_dir(state))
    (root / "exports/data.csv").write_text("n\n99\n")
    response = await execute(state, "df=pd.read_csv(output_path('exports/data.csv'))\nREPORT_RESULT={'n':df.n.sum()}")
    assert response["success"]
    assert response["provenance"]["input_artifact_ids"] == []
    assert response["saved_result"]["value"] == {"n": 99}
    assert "INPUT_LINEAGE_UNCAPTURED" in str(response["chunks"])
    (root / "exports/unknown.csv").write_text("n\n123\n")
    other = await execute(state, "REPORT_RESULT={'n':pd.read_csv(output_path('exports/unknown.csv')).n.sum()}")
    assert other["provenance"]["input_artifact_ids"] == []
    another_sink = SimpleNamespace(
        context=ArtifactCaptureContext(conv_uid="another"), snapshot=sink.snapshot,
    )
    assert code_interpreter.workspace_csv_manifest(another_sink, str(root)) == {}


@pytest.mark.asyncio
async def test_exploratory_inspection_does_not_demand_calculation_or_recompute(runtime):
    state, sink = runtime
    result = await execute(state, "print(SQL_RESULT_CATALOG)\nprint(OUTPUT_DIR)")
    assert result["success"]
    assert result["recovery_hint"] is None
    assert "STRUCTURED_RESULT_MISSING" not in str(result)
    assert "INPUT_LINEAGE_UNCAPTURED" not in str(result)
    source = capture_sql_execution(sql="SELECT n FROM fixture", database="test",
        duration_ms=1, columns=["n"], rows=[[1]], artifact_sink=sink)
    inspection = await execute(state, f"df=sql_result_frame({source!r})\nprint(df.dtypes)")
    assert inspection["success"]
    assert "STRUCTURED_RESULT_MISSING" not in str(inspection)


@pytest.mark.asyncio
async def test_csv_keyword_compression_and_memory_map_keep_pandas_behavior(runtime):
    state, sink = runtime
    first = await execute(state,
        "pd.DataFrame({'n':[2,3]}).to_csv(output_path('exports/data.csv.gz'),index=False)")
    assert first["success"]
    reference = next(a for a in sink.snapshot() if getattr(a, "source_name", "") == "data.csv.gz")
    loaded = await execute(state,
        "df=pd.read_csv(filepath_or_buffer=output_path('exports/data.csv.gz'), memory_map=True)\n"
        "REPORT_RESULT={'total':df.n.sum()}")
    assert loaded["success"], loaded
    assert loaded["saved_result"]["value"] == {"total":5}
    assert loaded["provenance"]["input_artifact_ids"] == [reference.artifact_id]


@pytest.mark.asyncio
async def test_typed_dates_fail_with_specific_recovery_and_preserve_sql(runtime):
    state, sink = runtime
    source = capture_sql_execution(sql="SELECT day FROM fixture", database="test",
        duration_ms=1, columns=["day"], rows=[[date(2026,9,1)]], artifact_sink=sink)
    broken = await execute(state, f"df=sql_result_frame({source!r})\nprint(df.day.iloc[0].date())")
    assert broken["error_code"] == "PYTHON_DATE_TYPE_ERROR"
    assert "pd.to_datetime" in broken["recovery_hint"]
    fixed = await execute(state, f"df=sql_result_frame({source!r})\n"
        "REPORT_RESULT={'day':pd.to_datetime(df.day).dt.date.iloc[0]}")
    assert fixed["success"]
    assert fixed["provenance"]["input_artifact_ids"] == [source]


@pytest.mark.asyncio
async def test_invalid_nested_payload_or_syntax_never_requests_approval_or_executes(monkeypatch):
    callback = AsyncMock()
    runner = AsyncMock()
    monkeypatch.setattr(code_interpreter, "_run_python_file", runner)
    gate = make_approval_gate("preflight", callback)
    for source, expected in [
        (json.dumps({"code":"print('valid hidden source')"}), "PYTHON_ARGUMENT_ENVELOPE_INVALID"),
        ('{"code": "print(1)\\n' + chr(10) + "broken", "PYTHON_ARGUMENT_ENVELOPE_INVALID"),
        ("print('prefix')\nx={", "PYTHON_SYNTAX_ERROR"),
        ("return 1", "PYTHON_SYNTAX_ERROR"),
    ]:
        response = json.loads(await gate("code", {"code":source}))
        assert response["error_code"] == expected
        actual = await execute({"conv_id":"preflight"}, source)
        assert actual["error_code"] == expected
    callback.assert_not_awaited()
    runner.assert_not_awaited()
    assert python_preflight_error({"code":"x=1\nprint(x)"}) is None


def test_large_result_preview_is_valid_bounded_and_truthfully_incomplete():
    result = result_preview({"total": 42, "rows": [{"n":i,"s":"x"*100} for i in range(1000)]}, max_chars=1500)
    assert result["truncated"]
    assert result["value"]["total"] == 42
    assert len(json.dumps(result)) < 2000
    assert "__preview_omitted_items__" in json.dumps(result)


def test_evidence_tool_exposes_limit_and_returns_complete_saved_small_result(runtime):
    state, sink = runtime
    from dbgpt.core.interface.report_capture import capture_python_execution
    identity = capture_python_execution(code="REPORT_RESULT = ...", duration_ms=1,
        status="succeeded", exit_code=0, stdout="", stderr="", artifact_sink=sink,
        result_inline={"total":6853,"peak_day":"2026-09-09","null_source":None})
    tool = make_session_evidence(state)
    schema = tool._tool.parameters_schema()["properties"]
    assert schema["limit"]["minimum"] == 1
    assert schema["limit"]["maximum"] == 40
    assert schema["offset"]["minimum"] == 0
    result = json.loads(tool(artifact_id=identity, read_values=True))
    assert result["saved_result"]["value"] == {"total":6853,"peak_day":"2026-09-09","null_source":None}
    assert not result["saved_result"]["truncated"]
