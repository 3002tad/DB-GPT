"""A pathname in stdout is not an output; observed files survive partial failure."""

import hashlib
import inspect
import json
from pathlib import Path

import pytest

from dbgpt_app.openapi.api_v1.tools import code_interpreter, shell_interpreter
from dbgpt_app.openapi.api_v1.tools.generated_files import (
    generated_file_chunks,
    snapshot_generated_files,
)


def files(response):
    return [chunk["content"] for chunk in response["chunks"] if chunk["output_type"] == "file"]


def test_inventory_ignores_controls_dependencies_and_unmodified_files(tmp_path):
    for folder in [".report-executions", "__pycache__", ".venv", "node_modules", ".git"]:
        directory = tmp_path / folder
        directory.mkdir()
        (directory / "internal.py").write_text("internal")
    (tmp_path / "old.csv").write_text("old")
    before = snapshot_generated_files(str(tmp_path))
    (tmp_path / "exports").mkdir()
    output = tmp_path / "exports" / "empty.csv"
    output.write_bytes(b"")
    chunks = generated_file_chunks(str(tmp_path), before, "succeeded")
    assert [item["content"]["file_path"] for item in chunks] == [str(output)]
    assert chunks[0]["content"]["size"] == 0
    assert chunks[0]["content"]["sha256"] == hashlib.sha256(b"").hexdigest()


def test_same_size_content_change_is_detected_but_deleted_file_is_not(tmp_path):
    target = tmp_path / "data.csv"
    target.write_text("one")
    before = snapshot_generated_files(str(tmp_path))
    target.write_text("two")
    result = generated_file_chunks(str(tmp_path), before, "failed")
    assert result[0]["content"]["producer_status"] == "failed"
    assert result[0]["content"]["sha256"] == hashlib.sha256(b"two").hexdigest()
    observed = snapshot_generated_files(str(tmp_path))
    target.unlink()
    assert generated_file_chunks(str(tmp_path), {}, "succeeded", after=observed) == []


def test_library_symlink_is_not_a_generated_file(tmp_path):
    root = tmp_path / "work"
    root.mkdir()
    source = tmp_path / "library.py"
    source.write_text("library")
    (root / "alias.py").symlink_to(source)
    assert snapshot_generated_files(str(root)) == {}


@pytest.fixture
def runtime(tmp_path, monkeypatch):
    from dbgpt.configs import model_config
    from dbgpt_sandbox.sandbox.execution_layer import runtime_factory
    monkeypatch.setattr(model_config, "PILOT_PATH", str(tmp_path))
    monkeypatch.setattr(model_config, "STATIC_MESSAGE_IMG_PATH", str(tmp_path / "images"))
    monkeypatch.setattr(runtime_factory, "SANDBOX_RUNTIME", "local")


@pytest.mark.asyncio
async def test_python_stdout_and_traceback_do_not_create_file_cards(runtime):
    run = inspect.unwrap(code_interpreter.make_code_interpreter({"conv_id": "no-outputs"}))
    result = json.loads(await run(code=(
        "print('Planned: /app/workspace/missing.csv and /usr/lib/library.py')\n"
        "raise RuntimeError('File /opt/site-packages/pandas/io/common.py')"
    )))
    assert result["success"] is False
    assert files(result) == []


@pytest.mark.asyncio
async def test_failed_python_preserves_only_files_really_written(runtime):
    state = {"conv_id": "partial-output"}
    run = inspect.unwrap(code_interpreter.make_code_interpreter(state))
    result = json.loads(await run(code=(
        "from pathlib import Path\n"
        "Path(output_path('exports/partial.csv')).write_text('n\\n7\\n')\n"
        "print('Wrote /usr/lib/library.py; future.csv and future.png')\n"
        "raise RuntimeError('stopped after save')"
    )))
    assert result["success"] is False
    produced = files(result)
    assert [item["name"] for item in produced] == ["partial.csv"]
    assert produced[0]["producer_status"] == "failed"
    assert produced[0]["existence_verified"] is True
    assert Path(produced[0]["file_path"]).read_text() == "n\n7\n"
    assert produced[0]["sha256"] == hashlib.sha256(b"n\n7\n").hexdigest()
    read_only = json.loads(await run(code="print('partial.csv, /opt/library.py')"))
    assert read_only["success"] is True
    assert files(read_only) == []


@pytest.mark.asyncio
async def test_shell_manifest_uses_disk_delta_not_redirection_or_traceback_text(runtime):
    run = inspect.unwrap(shell_interpreter.make_shell_interpreter({"conv_id": "shell-outputs"}))
    result = json.loads(await run(code=(
        "printf 'n\\n7\\n' > actual.csv\n"
        "printf 'planned.csv /usr/lib/library.py > not-created.csv\\n'\nexit 1"
    )))
    produced = files(result)
    assert [item["name"] for item in produced] == ["actual.csv"]
    assert produced[0]["producer_status"] == "failed"
    assert Path(produced[0]["file_path"]).read_bytes() == b"n\n7\n"
    assert files(json.loads(await run(code="cat actual.csv"))) == []


@pytest.mark.asyncio
@pytest.mark.parametrize("subagent", [False, True])
@pytest.mark.parametrize("success", [False, True])
async def test_skill_adapters_keep_real_exports_without_guessing_stdout(
    runtime, monkeypatch, subagent, success
):
    from types import SimpleNamespace
    from dbgpt.agent.skill import manage
    from dbgpt_app.openapi.api_v1.subagent.react_tools import make_react_tools
    from dbgpt_app.openapi.api_v1.tools.skill_tools import make_execute_skill_script_file

    async def execute(*args, output_dir, **kwargs):
        (Path(output_dir) / "skill.csv").write_text("n\n7\n")
        return json.dumps({
            "success": success, "exit_code": 0 if success else 1,
            "error": None if success else "stopped after save",
            "chunks": [{"output_type": "text", "content": "planned.csv /usr/lib/library.py"}],
        })
    monkeypatch.setattr(manage, "get_skill_manager", lambda *_: SimpleNamespace(execute_skill_script_file=execute))
    state = {"conv_id": "skill-outputs"}
    tool = make_react_tools(state)["execute_skill_script_file"] if subagent else make_execute_skill_script_file(state)
    result = json.loads(await inspect.unwrap(tool)(skill_name="fixture", script_file_name="analyze.py"))
    assert [item["name"] for item in files(result)] == ["skill.csv"], result
    assert files(result)[0]["producer_status"] == ("succeeded" if success else "failed")
