"""Regression coverage for the 2026-11-18 manual follow-up trace."""

import ast
import inspect
import json
from pathlib import Path

import pytest

from dbgpt.core.interface.report_capture import (
    ArtifactCaptureContext, InMemoryArtifactSink, capture_sql_execution,
)
from dbgpt_app.openapi.api_v1.conversation_resources import resource_context_snapshot
from dbgpt_app.openapi.api_v1.stream_lifecycle import StreamHeartbeat
from dbgpt_app.openapi.api_v1.tools import code_interpreter
from dbgpt_app.openapi.api_v1.tools.analysis_lineage import source_lineage_notice
from dbgpt_app.openapi.api_v1.tools.schema_recovery import query_schema_hint
from dbgpt_app.openapi.api_v1.tools.evidence_catalog import EvidenceCatalog, SessionArtifactSink


def test_resource_context_is_allowlisted_and_keeps_explicit_clear():
    value = resource_context_snapshot({"database_name": "demo", "knowledge_space_id": 7,
                                       "skill_name": "analysis", "token": "never-save"})
    assert value["database_name"] == "demo"
    assert value["knowledge_space_id"] == 7
    assert "token" not in value
    assert all(v is None for v in resource_context_snapshot({}).values())
    assert resource_context_snapshot({"knowledge_space_id": True})["knowledge_space_id"] is None
    assert resource_context_snapshot({"knowledge_space": "legacy-kb"})["knowledge_space_name"] == "legacy-kb"


def test_all_main_history_paths_record_resources_and_sse_wait_has_keepalive():
    source = Path(__file__).parents[1] / "openapi/api_v1/agentic_data_api.py"
    tree = ast.parse(source.read_text(encoding="utf-8"))
    calls = [n for n in ast.walk(tree) if isinstance(n, ast.Call)
             and isinstance(n.func, ast.Name) and n.func.id == "_build_react_history_payload"]
    assert len(calls) == 4
    assert all("resource_context" in {k.arg for k in n.keywords} for n in calls)
    assert "heartbeat = stream_heartbeat.due()" in source.read_text(encoding="utf-8")


def test_heartbeat_is_comment_only_and_rate_limited():
    now = [0.0]
    heartbeat = StreamHeartbeat(clock=lambda: now[0])
    assert heartbeat.due() is None
    now[0] = 10.0
    assert heartbeat.due() == ": keepalive\n\n"
    assert heartbeat.due() is None
    now[0] = 25.0
    assert heartbeat.due() == ": keepalive\n\n"


@pytest.mark.asyncio
async def test_schema_recovery_uses_actual_granted_columns_and_caches_inventory(monkeypatch):
    from dbgpt_app.openapi.api_v1.dashboard import source_metadata
    calls = []

    def inventory(connector):
        calls.append(connector)
        return [{"name": "demo.sessions", "aliases": [], "columns": [
            {"name": "session_id"}, {"name": "started_at"}]}]

    monkeypatch.setattr(source_metadata, "readable_source_tables", inventory)
    state, connector = {}, object()
    hint = await query_schema_hint(state, connector, 'SELECT s.session_start FROM "demo"."sessions" s')
    assert hint["relations"] == [{"name": "demo.sessions", "columns": ["session_id", "started_at"]}]
    assert "session_start" not in hint["relations"][0]["columns"]
    await query_schema_hint(state, connector, 'SELECT * FROM demo.sessions')
    assert calls == [connector]
    assert await query_schema_hint({}, None, 'SELECT 1') == {"status": "datasource_required"}


@pytest.mark.asyncio
async def test_followup_python_reads_prior_sql_without_report_resume(tmp_path, monkeypatch):
    from dbgpt.configs import model_config
    from dbgpt_sandbox.sandbox.execution_layer import runtime_factory
    from dbgpt.core.interface.report_capture import read_artifact_result
    monkeypatch.setattr(model_config, "PILOT_PATH", str(tmp_path))
    monkeypatch.setattr(runtime_factory, "SANDBOX_RUNTIME", "local")
    catalog = EvidenceCatalog(tmp_path / 'catalog.sqlite3', owner_id='analyst')
    first = SessionArtifactSink(ArtifactCaptureContext(conv_uid='chat', run_id='turn-1'), catalog)
    sql_id = capture_sql_execution(sql='SELECT 12 AS observed', database='fixture', duration_ms=1,
                                  columns=['observed'], rows=[[12]], artifact_sink=first)
    followup = SessionArtifactSink(ArtifactCaptureContext(conv_uid='chat', run_id='turn-2'), catalog, include_prior=True)
    execute = inspect.unwrap(code_interpreter.make_code_interpreter({'conv_id': 'chat', '_report_artifact_sink': followup}))
    result = json.loads(await execute(code="frame=sql_result_frame(-1)\nREPORT_RESULT={'observed':int(frame.iloc[0,0])}\nprint(REPORT_RESULT)"))
    assert result['success'] is True
    assert sql_id in result['provenance']['input_artifact_ids']
    artifact = next(a for a in followup.snapshot() if a.artifact_id == result['artifact_id'])
    assert read_artifact_result(artifact) == {'observed': 12}
    assert not source_lineage_notice(followup, 'vi')
    other = SessionArtifactSink(ArtifactCaptureContext(conv_uid='other', run_id='turn-3'), catalog, include_prior=True)
    assert other.snapshot() == []
    other_owner = EvidenceCatalog(tmp_path / 'catalog.sqlite3', owner_id='other-actor')
    assert other_owner.list_artifacts('chat') == []


def test_report_binding_failure_is_bounded_and_preserves_diagnostics(tmp_path, monkeypatch):
    from dbgpt_app.openapi.api_v1.tools import report_repair
    monkeypatch.setattr(report_repair, '_save_checkpoint', lambda *_args: None)
    state = {'conv_id': 'binding-fixture', '_report_pending_path': str(tmp_path/'draft.html'),
             '_report_checkpoint_path': str(tmp_path/'evidence.json'),
             '_report_pending_html': '<html>saved draft</html>'}
    error = 'REPORT_TARGET_BINDING_REQUIRED: ' + ('missing source target; ' * 800)
    result = json.loads(report_repair._record_failure(state, {'html': '<html>draft</html>'}, error, reached_renderer=True))
    assert result['success'] is False
    assert result['error_code'] == 'REPORT_TARGET_BINDING_REQUIRED'
    assert result['error_preview_truncated'] is True
    assert len(result['chunks'][0]['content']) < 6000
    assert 'report_evidence_manifest' in result['chunks'][0]['content']
    assert state['_report_html_error'] == error
    assert state['_report_pending_html'] == '<html>saved draft</html>'


@pytest.mark.asyncio
async def test_python_import_failure_and_timeout_are_failed_tool_results(tmp_path, monkeypatch):
    from dbgpt.configs import model_config
    monkeypatch.setattr(model_config, "PILOT_PATH", str(tmp_path))

    async def failed(*args, **kwargs):
        return 1, b"", b"ModuleNotFoundError: No module named 'db_gpt_tools'"

    monkeypatch.setattr(code_interpreter, "_run_python_file", failed)
    sink = InMemoryArtifactSink(ArtifactCaptureContext(conv_uid="import-failure"))
    execute = inspect.unwrap(code_interpreter.make_code_interpreter({"conv_id": "import-failure", "_report_artifact_sink": sink}))
    response = json.loads(await execute(code="import db_gpt_tools"))
    assert response["success"] is False
    assert response["error_code"] == "PYTHON_IMPORT_ERROR"
    assert "SQL_RESULTS" in response["recovery_hint"]
    assert sink.snapshot()[-1].status == "failed"
    from dbgpt.agent.expand.actions.tool_action import run_tool
    from dbgpt.agent.resource.tool.pack import ToolPack
    native_tool = code_interpreter.make_code_interpreter({"conv_id": "native-import-failure"})
    action = await run_tool('code', {'code': 'import db_gpt_tools'}, ToolPack([native_tool._tool]), need_vis_render=False)
    assert action.is_exe_success is False
    assert 'PYTHON_IMPORT_ERROR' in (action.observations or action.content)

    async def timed_out(*args, **kwargs):
        return None, b"", b""

    monkeypatch.setattr(code_interpreter, "_run_python_file", timed_out)
    response = json.loads(await execute(code="print(1)"))
    assert response["success"] is False
    assert response["error_code"] == "PYTHON_EXECUTION_TIMEOUT"


@pytest.mark.asyncio
async def test_uncaptured_literal_is_allowed_but_not_certified_as_source_data(tmp_path, monkeypatch):
    from dbgpt.configs import model_config
    from dbgpt_sandbox.sandbox.execution_layer import runtime_factory
    monkeypatch.setattr(model_config, "PILOT_PATH", str(tmp_path))
    monkeypatch.setattr(runtime_factory, "SANDBOX_RUNTIME", "local")
    sink = InMemoryArtifactSink(ArtifactCaptureContext(conv_uid="literal-source"))
    sql_id = capture_sql_execution(sql="SELECT 42 AS observed", database="fixture",
        duration_ms=1, columns=["observed"], rows=[[42]], artifact_sink=sink)
    execute = inspect.unwrap(code_interpreter.make_code_interpreter({"conv_id": "literal-source", "_report_artifact_sink": sink}))
    literal = json.loads(await execute(code="REPORT_RESULT={'invented_hourly_count': 999}\nprint('computed')"))
    assert literal["success"] is True  # Native computation remains available.
    assert literal["provenance"]["status"] == "uncaptured_inputs"
    assert "chưa có liên kết" in source_lineage_notice(sink, "vi")
    grounded = json.loads(await execute(code="frame=sql_result_frame(-1)\nREPORT_RESULT={'observed':int(frame.iloc[0,0])}\nprint(REPORT_RESULT)"))
    assert grounded["success"] is True
    assert sql_id in grounded["provenance"]["input_artifact_ids"]
