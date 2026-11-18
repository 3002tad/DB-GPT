"""DEEP18-03: use the execution workspace and preserve typed JSON results."""

import inspect
import json
from pathlib import Path

import pytest

from dbgpt.core.interface.report_capture import (
    ArtifactCaptureContext,
    InMemoryArtifactSink,
    capture_sql_execution,
    read_artifact_result,
)
from dbgpt_app.openapi.api_v1.tools._sandbox_capture import (
    capture_helper_source,
    prepare_output_path,
)
from dbgpt_app.openapi.api_v1.tools import code_interpreter


@pytest.fixture
def runtime(tmp_path, monkeypatch):
    from dbgpt.configs import model_config
    from dbgpt_sandbox.sandbox.execution_layer import runtime_factory

    monkeypatch.setattr(model_config, "PILOT_PATH", str(tmp_path))
    monkeypatch.setattr(runtime_factory, "SANDBOX_RUNTIME", "local")


def test_output_helper_creates_only_requested_workspace_parents(tmp_path):
    first = tmp_path / "first"
    second = tmp_path / "second"
    one = prepare_output_path(str(first), "exports/results.csv")
    two = prepare_output_path(str(second), "exports/results.csv")
    assert Path(one).parent.is_dir()
    assert Path(two).parent.is_dir()
    assert one != two
    for invalid in ["", ".", "../outside/result.csv", str(tmp_path / "outside.csv")]:
        with pytest.raises(ValueError, match="PYTHON_OUTPUT_PATH_INVALID"):
            prepare_output_path(str(first), invalid)
    assert not (tmp_path / "outside").exists()
    assert not (tmp_path / "outside.csv").exists()


def test_typed_json_helper_is_self_contained_and_does_not_stringify_numbers():
    import numpy as np
    from datetime import date
    from decimal import Decimal

    namespace = {}
    exec(capture_helper_source(), namespace)
    source = {"ok": np.bool_(True), "n": np.int64(7), "ratio": np.float32(0.5),
              "amount": Decimal("12.30"), "day": date(2026, 11, 18)}
    output = json.loads(namespace["result_json"](source))
    assert output == {"ok": True, "n": 7, "ratio": 0.5,
                      "amount": {"$decimal": "12.30"}, "day": {"$date": "2026-11-18"}}
    assert type(output["ok"]) is bool
    assert type(output["n"]) is int
    assert type(source["ok"]) is np.bool_
    with pytest.raises(ValueError, match="unsupported artifact value"):
        namespace["result_json"]({"value": object()})


@pytest.mark.asyncio
async def test_native_sql_to_csv_png_and_numpy_json_in_one_call(runtime):
    from dbgpt.agent.expand.actions.tool_action import run_tool
    from dbgpt.agent.resource.tool.pack import ToolPack

    sink = InMemoryArtifactSink(ArtifactCaptureContext(conv_uid="output-e2e"))
    sql_id = capture_sql_execution(
        sql="SELECT 3 AS sessions UNION ALL SELECT 7 AS sessions",
        database="fixture", columns=["sessions"], rows=[[3], [7]],
        duration_ms=1, artifact_sink=sink,
    )
    state = {"conv_id": "output-e2e", "_report_artifact_sink": sink}
    native = code_interpreter.make_code_interpreter(state)
    action = await run_tool("code", {"code": (
        "import matplotlib\nmatplotlib.use('Agg')\n"
        "import matplotlib.pyplot as plt\nfrom pathlib import Path\n"
        f"df = sql_result_frame({sql_id!r})\n"
        "csv_path = output_path('exports/session-summary.csv')\n"
        "png_path = output_path('plots/sessions.png')\n"
        "df.to_csv(csv_path, index=False)\n"
        "plt.plot(df.sessions)\nplt.savefig(png_path)\nplt.close()\n"
        "REPORT_RESULT = {'sum': df.sessions.sum(), 'ok': np.bool_(True), "
        "'csv': csv_path, 'png': png_path}\n"
        "Path(output_path('exports/result.json')).write_text("
        "result_json(REPORT_RESULT), encoding='utf-8')\n"
        "print(result_json(REPORT_RESULT))"
    )}, ToolPack([native._tool]), need_vis_render=False)
    assert action.is_exe_success is True, action.observations
    response = json.loads(action.observations)
    assert response["success"] is True
    produced = next(a for a in sink.snapshot() if a.artifact_id == response["artifact_id"])
    result = read_artifact_result(produced)
    assert result["ok"] is True
    assert result["sum"] == 10
    assert produced.input_artifact_ids == [sql_id]
    root = Path(code_interpreter.conversation_work_dir(state))
    assert Path(result["csv"]).is_relative_to(root)
    assert Path(result["png"]).read_bytes().startswith(b"\x89PNG\r\n\x1a\n")
    assert Path(result["csv"]).read_text().splitlines() == ["sessions", "3", "7"]
    saved = json.loads((root / "exports/result.json").read_text())
    # Capture adds the URLs of published figures after the script has saved
    # its JSON. All analytical fields must still match exactly.
    assert {key: value for key, value in result.items() if key != "images"} == saved
    assert result["images"] == [
        chunk["content"] for chunk in response["chunks"] if chunk["output_type"] == "image"
    ]
    assert result["images"]


@pytest.mark.asyncio
async def test_bad_output_location_has_recovery_without_creating_global_alias(runtime, tmp_path):
    execute = inspect.unwrap(code_interpreter.make_code_interpreter({"conv_id": "missing-output"}))
    missing = tmp_path / "guessed-global-dir" / "result.csv"
    response = json.loads(await execute(code=f"pd.DataFrame({{'n': [1]}}).to_csv({str(missing)!r})"))
    assert response["success"] is False
    assert response["error_code"] == "PYTHON_OUTPUT_DIRECTORY_MISSING"
    assert "output_path" in response["recovery_hint"]
    assert not missing.parent.exists()


@pytest.mark.asyncio
async def test_native_json_error_is_truthful_and_recovery_names_typed_helper(runtime):
    execute = inspect.unwrap(code_interpreter.make_code_interpreter({"conv_id": "bad-json"}))
    response = json.loads(await execute(code="REPORT_RESULT={'ok': np.bool_(True)}\nprint(json.dumps(REPORT_RESULT))"))
    assert response["success"] is False
    assert response["error_code"] == "PYTHON_RESULT_SERIALIZATION_FAILED"
    assert "result_json" in response["recovery_hint"]
    fixed = json.loads(await execute(code="REPORT_RESULT={'ok': np.bool_(True)}\nprint(result_json(REPORT_RESULT))"))
    assert fixed["success"] is True
    assert any(chunk.get("content") == '{"ok": true}' for chunk in fixed["chunks"])


@pytest.mark.asyncio
async def test_two_conversations_do_not_share_export_files(runtime):
    for conv, number in [("one", 1), ("two", 2)]:
        execute = inspect.unwrap(code_interpreter.make_code_interpreter({"conv_id": conv}))
        response = json.loads(await execute(code=(
            "from pathlib import Path\n"
            f"Path(output_path('exports/same.json')).write_text(result_json({{'n': {number}}}), encoding='utf-8')"
        )))
        assert response["success"] is True
    for conv, number in [("one", 1), ("two", 2)]:
        path = Path(code_interpreter.conversation_work_dir({"conv_id": conv})) / "exports/same.json"
        assert json.loads(path.read_text()) == {"n": number}
