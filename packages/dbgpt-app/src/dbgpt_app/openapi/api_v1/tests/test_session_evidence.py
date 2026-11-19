"""Follow-up reuse from real persisted captures, without source queries or LLMs."""
import ast
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from dbgpt.core.interface import report_capture
from dbgpt.core.interface.report_capture import ArtifactCaptureContext, capture_sql_execution, capture_python_execution
from dbgpt_app.openapi.api_v1.tools.evidence_catalog import EvidenceCatalog, SessionArtifactSink
from dbgpt_app.openapi.api_v1.tools.session_evidence import evidence_page, inventory_prompt, make_session_evidence
from dbgpt_app.openapi.api_v1.suite_binder import SuiteBinding
from dbgpt_app.openapi.api_v1.tools.tool_catalog import BASE_TOOLS
from dbgpt.agent.resource.tool.pack import ToolPack
from dbgpt_app.openapi.api_v1.react_prompt import build_react_prompt_template


@pytest.fixture
def captures(tmp_path, monkeypatch):
    blob_root = tmp_path / 'blobs'
    blob_root.mkdir()
    monkeypatch.setattr(report_capture, 'artifact_storage_root', lambda: blob_root)
    catalog = EvidenceCatalog(tmp_path / 'catalog.sqlite3', owner_id='alice')
    first = SessionArtifactSink(ArtifactCaptureContext(conv_uid='thread', run_id='turn-1'), catalog)
    sql = capture_sql_execution(sql="SELECT COUNT(*) AS ticket_count FROM support_tickets WHERE priority='high'",
        database='service-desk', duration_ms=1, columns=['ticket_count'], rows=[[42]], artifact_sink=first)
    python = capture_python_execution(code="REPORT_RESULT={'median_duration': 3.5}",
        duration_ms=1, status='succeeded', exit_code=0, stdout='', stderr='',
        result_inline={'median_duration': 3.5}, artifact_sink=first)
    capture_sql_execution(sql='SELECT missing_column', database='service-desk',
        duration_ms=1, error='column missing', artifact_sink=first)
    followup = SessionArtifactSink(ArtifactCaptureContext(conv_uid='thread', run_id='turn-2'),
                                  catalog, include_prior=True)
    return catalog, first, followup, sql, python


def test_initial_inventory_metadata_only_prior_scope_and_literal_prompt_render(captures):
    _, _, sink, sql, python = captures
    with patch.object(report_capture, 'read_artifact_result', side_effect=AssertionError('no eager data loads')):
        prompt = inventory_prompt(sink, current_database='another-database')
    assert sql in prompt and python in prompt
    assert 'another-database' in prompt and 'service-desk' in prompt
    assert 'source freshness' in prompt and 'unknown scope' in prompt
    assert 'SELECT missing_column' not in prompt
    assert '42' not in json.dumps([x['recorded_scope'] for x in evidence_page(sink)['artifacts']])
    assert all(x['recorded_scope'] is None for x in evidence_page(sink)['artifacts'])
    assert 'uri' not in json.dumps(evidence_page(sink))
    rendered = build_react_prompt_template(prompt + '\nCurrent request', financial_enabled=False).format(
        native_function_calling=True, action_space='', action_space_names='session_evidence,sql_query,code,terminate')
    assert rendered.count('## Prior session evidence inventory') == 1
    assert 'Current request' in rendered and 'sql_query,code' in rendered


def test_exact_old_sql_and_python_values_survive_restart(captures):
    _, _, sink, sql, python = captures
    tool = make_session_evidence({'_report_artifact_sink': sink})
    result = json.loads(tool(artifact_id=sql, read_values=True))
    assert result['scalars'][0]['value'] == 42
    assert result['scalars'][0]['status'] == 'captured_value'
    assert result['artifacts'][0]['run_id'] == 'turn-1'
    assert result['freshness'] == 'not_refreshed'
    assert result['business_meaning'] == 'producer_label_not_certified'
    result = json.loads(tool(artifact_id=python, read_values=True, query='median'))
    assert result['scalars'][0]['value'] == 3.5
    assert json.loads(tool(artifact_id=python, query='absent'))['scalar_total'] == 0
    assert evidence_page(sink, query='median_duration')['total'] == 1
    assert 'median_duration' in inventory_prompt(sink)
    assert '3.5' not in inventory_prompt(sink)


def test_recorded_scope_quality_and_private_locators_are_not_guessed_or_leaked(captures):
    _, first, sink, sql, _ = captures
    item = next(a for a in first.snapshot() if a.artifact_id == sql).model_copy(deep=True)
    item.artifact_id = 'sql-explicit-scope'
    item.metadata.update(grain='ticket', scope={'priority': 'high'},
        time_window={'start': '2024-01-01', 'end_exclusive': '2024-02-01'},
        quality={'status': 'UNVERIFIED'},
        parameters={'region': 'north', 'api_key': 'private-value', 'uri': 'file:///private'})
    first.record(item)
    result = evidence_page(sink, artifact_id=item.artifact_id)['artifacts'][0]
    assert result['recorded_scope']['grain'] == 'ticket'
    assert result['recorded_scope']['quality']['status'] == 'UNVERIFIED'
    assert result['recorded_scope']['time_window']['start'] == '2024-01-01'
    assert result['recorded_scope']['parameters'] == {'region': 'north'}
    assert 'private-value' not in json.dumps(result)


def test_no_other_owner_session_or_current_turn_in_initial_inventory(captures):
    catalog, _, sink, _, _ = captures
    for other in (
        SessionArtifactSink(ArtifactCaptureContext(conv_uid='other-thread', run_id='turn-2'), catalog, include_prior=True),
        SessionArtifactSink(ArtifactCaptureContext(conv_uid='thread', run_id='turn-2'),
            EvidenceCatalog(catalog.path, owner_id='bob'), include_prior=True),
    ):
        assert inventory_prompt(other) == ''
        assert evidence_page(other)['total'] == 0
    current = capture_sql_execution(sql='SELECT 777 AS current', database='test', duration_ms=1,
        columns=['current'], rows=[[777]], artifact_sink=sink)
    assert current not in inventory_prompt(sink)
    assert current in json.dumps(evidence_page(sink))


def test_bounded_inventory_and_full_catalog_remain_accessible(captures):
    catalog, first, _, _, _ = captures
    for i in range(15):
        capture_sql_execution(sql=f'SELECT {i} AS measurement', database='weather', duration_ms=1,
            columns=['measurement'], rows=[[i]], artifact_sink=first)
    sink = SessionArtifactSink(ArtifactCaptureContext(conv_uid='thread', run_id='turn-3'), catalog, include_prior=True)
    with patch.object(report_capture, 'read_artifact_result', side_effect=AssertionError('metadata only')):
        prompt = inventory_prompt(sink, max_chars=1200)
    data = json.loads(prompt.split('\n')[-1])
    assert data['omitted'] > 0 and data['shown'] < data['total']
    assert len(json.dumps(data)) < 1400
    found = []
    offset = 0
    while True:
        result = evidence_page(sink, offset=offset, limit=4)
        found.extend(x['artifact_id'] for x in result['artifacts'])
        if result['next_offset'] is None:
            break
        offset = result['next_offset']
    assert len(set(found)) == data['total'] == 17
    assert evidence_page(sink, query='weather')['total'] == 15


def test_corrupt_or_missing_blob_is_not_replaced_with_invented_value(captures):
    _, _, sink, sql, _ = captures
    artifact = next(a for a in sink.snapshot() if a.artifact_id == sql)
    report_capture.artifact_content_path(artifact.result.uri).write_text('corrupted')
    tool = make_session_evidence({'_report_artifact_sink': sink})
    value = json.loads(tool(artifact_id=sql, read_values=True))['scalars'][0]
    assert value['status'] == 'unavailable' and 'value' not in value
    assert json.loads(tool(artifact_id='sql-not-owned', read_values=True))['status'] == 'not_found'
    assert json.loads(tool(offset=-1))['status'] == 'unavailable'


def test_scalar_pages_read_once_and_never_copy_all_results_into_prompt(captures):
    _, first, sink, _, _ = captures
    artifact_id = capture_sql_execution(sql='SELECT measured_fields', database='arbitrary-source',
        duration_ms=1, columns=['a', 'b', 'c'], rows=[[12, 24, 36]], artifact_sink=first)
    from dbgpt_app.openapi.api_v1.tools import session_evidence as module
    original = module.read_artifact_result
    tool = make_session_evidence({'_report_artifact_sink': sink})
    with patch.object(module, 'read_artifact_result', wraps=original) as reader:
        first_page = json.loads(tool(artifact_id=artifact_id, read_values=True, limit=2))
        assert reader.call_count == 1
    assert [x['value'] for x in first_page['scalars']] == [12, 24]
    assert first_page['scalar_next_offset'] == 2
    last_page = json.loads(tool(artifact_id=artifact_id, read_values=True, offset=2, limit=2))
    assert [x['value'] for x in last_page['scalars']] == [36]
    assert last_page['scalar_next_offset'] is None
    assert '"value"' not in inventory_prompt(sink)


def test_missing_scope_is_not_fabricated_from_sql_and_no_result_rows_are_injected(captures):
    _, first, sink, _, _ = captures
    capture_sql_execution(sql="SELECT id FROM arbitrary_source WHERE happened_at >= '2024-01-01'",
        database='arbitrary-source', duration_ms=1, columns=['id'], rows=[['private-row-a'], ['private-row-b']],
        artifact_sink=first)
    prompt = inventory_prompt(sink)
    assert 'private-row-a' not in prompt and 'private-row-b' not in prompt
    entry = evidence_page(sink, query='arbitrary_source')['artifacts'][0]
    assert entry['recorded_scope'] is None
    assert entry['row_count'] == 2
    assert entry['freshness'] == 'snapshot_at_capture_not_refreshed'


def test_tool_is_available_at_followup_start_without_widening_suite_sql_scope(captures):
    _, _, sink, _, _ = captures
    resource = ToolPack([make_session_evidence({'_report_artifact_sink': sink})]).sub_resources[0]
    assert resource.name == 'session_evidence' and resource.name in BASE_TOOLS
    assert 'artifact_id' in resource.parameters_schema()['properties']
    bound = SuiteBinding(name='test', version='1', allow={'sql_query'}, deny={'bash'})
    assert bound.violation('session_evidence') is None
    assert bound.violation('bash') is not None


def test_unavailable_catalog_does_not_block_analysis():
    class Broken:
        def snapshot(self):
            raise OSError('private/server/location')
    assert inventory_prompt(Broken()) == ''
    assert json.loads(make_session_evidence({})())['status'] == 'unavailable'


def test_production_prefix_is_added_after_mode_selection_before_template_rendering():
    source = Path(__file__).parents[1] / 'agentic_data_api.py'
    tree = ast.parse(source.read_text(encoding='utf-8'))
    fn = next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name == '_react_agent_stream_impl')
    start = next(i for i, n in enumerate(fn.body) if isinstance(n, ast.Assign)
                 and any(isinstance(t, ast.Name) and t.id == 'prior_inventory' for t in n.targets))
    context = {'workflow_prompt': 'Selected skill, KB and current task', 'artifact_sink': object(),
               'database_name': 'selected', 'inventory_prompt': lambda *_a, **_k: 'Prior evidence',
               'tool_pack': SimpleNamespace(sub_resources=[SimpleNamespace(name='session_evidence')])}
    exec(compile(ast.Module(body=fn.body[start:start + 2], type_ignores=[]), str(source), 'exec'), context)
    assert context['workflow_prompt'] == 'Prior evidence\n\nSelected skill, KB and current task'
    context.update(workflow_prompt='Greeting or constrained mode', tool_pack=SimpleNamespace(sub_resources=[]))
    exec(compile(ast.Module(body=fn.body[start:start + 2], type_ignores=[]), str(source), 'exec'), context)
    assert context['workflow_prompt'] == 'Greeting or constrained mode'
