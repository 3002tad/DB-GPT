"""Offline regressions across query transport, Python and owned image delivery."""
import inspect
import json
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from dbgpt.core.interface.report_capture import publish_generated_images
from dbgpt_app.openapi.api_v1.generated_images import IMAGE_NAME, link_published_images, register_images, resolve_image
from dbgpt_app.openapi.api_v1.tools.code_interpreter import make_code_interpreter
from dbgpt_app.openapi.api_v1.tools.query_artifact import build_query_chunk
from dbgpt_app.openapi.api_v1.tools.shell_interpreter import make_shell_interpreter


def test_nonfinite_sql_values_survive_strict_json_transport_without_becoming_null():
    payload = build_query_chunk('SELECT values', ['n'], [[float('nan')], [float('inf')], [float('-inf')], [None]])
    encoded = json.dumps(payload, allow_nan=False)
    assert json.loads(encoded)['content']['rows'] == [['NaN'], ['Infinity'], ['-Infinity'], [None]]


def test_wide_query_discloses_column_loss_even_without_row_loss():
    p = build_query_chunk('SELECT wide', [f'c{i}' for i in range(70)], [list(range(70))])['content']
    assert p['truncated'] and p['columns_truncated']
    assert not p['rows_truncated']
    assert p['column_count'] == 70
    assert len(p['columns']) == len(p['rows'][0]) == 64


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    from dbgpt.configs import model_config
    from dbgpt_sandbox.sandbox.execution_layer import runtime_factory
    monkeypatch.setattr(model_config, 'PILOT_PATH', str(tmp_path))
    monkeypatch.setattr(model_config, 'STATIC_MESSAGE_IMG_PATH', str(tmp_path / 'images'))
    monkeypatch.setattr(runtime_factory, 'SANDBOX_RUNTIME', 'local')
    return tmp_path


@pytest.mark.asyncio
async def test_invalid_python_is_not_silently_trimmed_and_executed(workspace, monkeypatch):
    execute = AsyncMock()
    monkeypatch.setattr('dbgpt_app.openapi.api_v1.tools.code_interpreter._run_python_file', execute)
    result = json.loads(await inspect.unwrap(make_code_interpreter({'conv_id': 'syntax'}))(
        code="print('prefix would execute')\nREPORT_RESULT = {\n"
    ))
    assert result['success'] is False and result['error_code'] == 'PYTHON_SYNTAX_ERROR'
    execute.assert_not_called()


def test_identical_images_have_distinct_owned_urls_and_safe_names(workspace):
    source = workspace / 'chart (final)#1.png'
    source.write_bytes(b'PNG-data')
    one = publish_generated_images([str(source)])[0]
    two = publish_generated_images([str(source)])[0]
    assert one['uri'] != two['uri']
    root = workspace / 'images'
    register_images(root, [one['uri']], 'alice')
    register_images(root, [two['uri']], 'bob')
    assert resolve_image(root, Path(one['uri']).name, 'alice').read_bytes() == b'PNG-data'
    assert resolve_image(root, Path(two['uri']).name, 'bob').read_bytes() == b'PNG-data'
    with pytest.raises(FileNotFoundError):
        resolve_image(root, Path(one['uri']).name, 'bob', lambda *_: False)
    assert IMAGE_NAME.fullmatch(Path(one['uri']).name)
    assert '![' in link_published_images('`plots/chart (final)#1.png`', [one['uri']])
    long = workspace / ('图' * 78 + '.png')
    long.write_bytes(b'long-name')
    item = publish_generated_images([str(long)])[0]
    assert len(Path(item['uri']).name.encode()) < 255
    assert IMAGE_NAME.fullmatch(Path(item['uri']).name)


@pytest.mark.asyncio
async def test_failed_shell_is_failed_native_tool_and_retains_actual_partial_file(workspace):
    from dbgpt.agent.expand.actions.tool_action import run_tool
    from dbgpt.agent.resource.tool.pack import ToolPack
    tool = make_shell_interpreter({'conv_id': 'failed-shell'})
    action = await run_tool('bash', {'code': "printf 'partial' > partial.csv; exit 1"}, ToolPack([tool]), need_vis_render=False)
    assert action.is_exe_success is False
    payload = json.loads(action.observations)
    assert payload['error_code'] == 'SHELL_EXECUTION_FAILED'
    assert any(c['output_type'] == 'file' and c['content']['name'] == 'partial.csv' for c in payload['chunks'])


@pytest.mark.asyncio
async def test_shell_changed_charts_publish_again_but_read_only_commands_do_not(workspace):
    state = {'conv_id': 'shell-charts'}
    run = inspect.unwrap(make_shell_interpreter(state))
    first = json.loads(await run(code="mkdir -p plots; printf 'PNG-one' > plots/chart.png"))
    second = json.loads(await run(code="printf 'PNG-two' > plots/chart.png"))
    images = lambda p: [c['content'] for c in p['chunks'] if c['output_type'] == 'image']
    assert first['success'] and second['success']
    assert images(first) and images(second) and images(first) != images(second)
    assert images(json.loads(await run(code='cat plots/chart.png'))) == []
