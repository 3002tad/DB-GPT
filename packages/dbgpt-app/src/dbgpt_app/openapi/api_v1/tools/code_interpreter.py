"""code tool — execute Python via the configured sandbox runtime.

Execution boundary: file locations (``FILE_PATH``/``FILES_JSON``/``PLOT_DIR``)
travel only through the subprocess environment; the generated Python source
never interpolates a path literal, so adversarial display names or paths
cannot inject code.
"""

import json
import logging
import os
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from dbgpt.agent.resource.tool.base import tool
from dbgpt.core.interface.report_capture import (
    artifact_content_path,
    capture_python_execution,
    execution_output_files,
    get_current_artifact_sink,
    publish_generated_images,
    snapshot_execution_files,
    sql_execution_context,
    store_artifact_json,
)
from dbgpt_sandbox.sandbox.execution_layer.base import ExecutionStatus

from ._execution import run_code
from ._sandbox_capture import capture_helper_source
from .generated_files import (
    generated_file_chunks,
    snapshot_generated_files as _workspace_files,
)

logger = logging.getLogger(__name__)

EXECUTION_TIMEOUT_SECONDS = 60


def conversation_work_dir(react_state: Dict[str, Any]) -> str:
    """Return the shared data workspace for Python and shell in one conversation.

    Keeping both tools in the same directory restores cross-tool file handoff;
    only bootstrap/capture controls live under ``.report-executions``.
    """
    from dbgpt.configs.model_config import PILOT_PATH

    conv_id = react_state.get("conv_id") or "default"
    return os.path.join(PILOT_PATH, "tmp", conv_id)


async def _run_python_file(
    script_path: str,
    *,
    cwd: str,
    env: Optional[Dict[str, str]] = None,
    timeout: int = EXECUTION_TIMEOUT_SECONDS,
) -> Tuple[Optional[int], bytes, bytes]:
    """Compatibility seam shared by code_interpreter and execute_analysis.

    Select the runtime through the common executor; keep the historical
    (returncode, stdout, stderr) result and None-on-timeout contract.
    """
    result = await run_code(
        Path(script_path).read_text(encoding="utf-8"),
        language="python",
        work_dir=cwd,
        env=env,
        timeout=timeout,
    )
    if result.status == ExecutionStatus.TIMEOUT:
        return None, result.output.encode("utf-8"), result.error.encode("utf-8")
    returncode = result.exit_code
    if result.status != ExecutionStatus.SUCCESS and not returncode:
        returncode = 1
    return returncode, result.output.encode("utf-8"), result.error.encode("utf-8")


def build_execution_env(
    *,
    work_dir: str,
    file_path: Optional[str] = None,
    files_json_path: Optional[str] = None,
    extra: Optional[Dict[str, str]] = None,
    artifact_sink: Any = None,
    selected_file_ids: Optional[List[str]] = None,
) -> Dict[str, str]:
    """Build the subprocess environment for file-aware code execution.

    On Windows, a child Python process otherwise inherits the active console
    code page (commonly GBK).  LLM-generated analysis may legitimately contain
    Unicode symbols such as ``⚠``; force UTF-8 at the process boundary so such
    output is captured as bytes instead of terminating the analysis script.
    """
    env = {}
    env["PYTHONUTF8"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    env["PLOT_DIR"] = work_dir
    sink = artifact_sink or get_current_artifact_sink()
    inputs, input_ids = snapshot_execution_files(
        {"file_path": file_path},
        sink,
        action="execution.input",
        # These paths are supplied by the server's materialized session state,
        # not by the model's Python source or skill arguments.
        allowed_paths=[path for path in (file_path,) if path],
    )
    file_path = inputs["file_path"]
    if files_json_path:
        if sink:
            manifest_path = Path(files_json_path)
            if os.path.normcase(
                str(manifest_path.resolve(strict=True))
            ) != os.path.normcase(os.path.abspath(files_json_path)):
                raise ValueError("FILE_INPUT_NOT_AUTHORIZED: symbolic file input")
            before = manifest_path.stat()
        with open(files_json_path, encoding="utf-8") as stream:
            manifest = json.load(stream)
        if sink:
            after = manifest_path.stat()
            if (before.st_size, before.st_mtime_ns) != (
                after.st_size,
                after.st_mtime_ns,
            ):
                raise ValueError("FILE_CHANGED_DURING_CAPTURE: retry the file snapshot")
        if selected_file_ids is not None:
            manifest = {
                key: value
                for key, value in manifest.items()
                if key in selected_file_ids
            }
        manifest, manifest_ids = snapshot_execution_files(
            manifest,
            sink,
            action="execution.input",
            allowed_paths=[path for path in manifest.values() if isinstance(path, str)],
        )
        input_ids.extend(manifest_ids)
        if sink:
            files_json_path = str(
                artifact_content_path(store_artifact_json(manifest).uri)
            )
    env["DBGPT_INPUT_ARTIFACT_IDS"] = json.dumps(list(dict.fromkeys(input_ids)))
    if file_path:
        env["FILE_PATH"] = file_path
    if files_json_path:
        env["FILES_JSON"] = files_json_path
    for key, value in (extra or {}).items():
        if value is not None:
            env[key] = value
    return env


def _try_repair_truncated_code(raw_code: str) -> Optional[str]:
    """Attempt to fix code that was truncated by the LLM's token limit."""
    lines = raw_code.split("\n")
    for trim in range(1, min(11, len(lines))):
        candidate_lines = lines[: len(lines) - trim]
        if not candidate_lines:
            continue
        candidate = "\n".join(candidate_lines)
        open_chars = {"(": ")", "[": "]", "{": "}"}
        close_chars = set(open_chars.values())
        stack: list = []
        for ch in candidate:
            if ch in open_chars:
                stack.append(open_chars[ch])
            elif ch in close_chars:
                if stack and stack[-1] == ch:
                    stack.pop()
        if stack:
            candidate += "\n" + "".join(reversed(stack))
        try:
            compile(candidate, "<repair>", "exec")
            return candidate
        except SyntaxError:
            continue
    return None


def make_code_interpreter(
    react_state: Dict[str, Any],
    *,
    max_output_chars: int = 50_000,
    legacy_truncation_notice: bool = False,
):
    @tool(
        description=(
            "Execute Python code for data analysis and computation. "
            "Supports pandas, numpy, matplotlib, json, os, etc. "
            "Use this tool when you need to run Python code to process data, "
            "generate charts, or perform calculations. "
            "For SQL evidence captured in this conversation, use the injected "
            "sql_result_frame('sql-<artifact_id>') to load a captured result "
            "directly; do not retype its rows into literals. "
            "print(SQL_RESULT_CATALOG) lists available IDs, SQL, columns and "
            "row counts without marking those datasets as read. "
            "sql_result_frame(index) also works; -1 is the latest successful SQL, "
            "which may have a different shape from an earlier query. "
            "SQL_RESULTS remains available with artifact_id, sql, columns, rows, "
            "row_count and truncated. Do not reconnect or scan for the database. "
            "Do not import db_gpt_tools: it is not a runtime module. SQL_RESULTS "
            "and sql_result_frame are already available globals. For finer time "
            "grains, query actual rows or aggregates first; monthly totals cannot "
            "establish weekly/hourly distributions. Literal/sample input remains "
            "allowed for exploration but is not evidence about the datasource. "
            "For report analysis, assign the computed results to REPORT_RESULT "
            "(a JSON-compatible dict/list). Convert DataFrames to "
            "{columns: [...], rows: frame.to_dict(orient='records')}. "
            "REPORT_RESULT is captured separately from printed progress. "
            "OUTPUT_DIR (also PLOT_DIR) is the existing conversation workspace. "
            "Use output_path('exports/summary.csv') for CSV/JSON/PNG outputs; "
            "it creates parent directories there. Do not guess /app/workspace. "
            "Assign REPORT_RESULT directly; capture normalizes NumPy scalars "
            "and typed values. If JSON text is needed, use "
            "result_json(REPORT_RESULT) instead of json.dumps or default=str. "
            "Each call starts fresh Python variables; workspace files persist. "
            'Parameters: {{"code": "python code string"}}'
        )
    )
    async def code(code: str) -> str:
        """Execute arbitrary Python code and return stdout/stderr.

        CRITICAL: Each call is completely independent — variables do NOT
        persist between calls. Every code snippet MUST include all necessary
        data loading and processing. Always print() results you want to see.
        Files in the same conversation's working directory persist across calls.
        """
        missing = react_state.get("_report_missing_calculation")
        if missing and not missing.get("result_artifact_id"):
            if missing.get("execution_attempts", 0) >= 3:
                react_state["_report_calculation_exhausted"] = True
                react_state["_report_html_error"] = (
                    "REPORT_CALCULATION_LIMIT_REACHED: missing calculation did not "
                    "produce a captured JSON "
                    "result"
                )
                return json.dumps(
                    {
                        "success": False,
                        "error_code": "PYTHON_CALCULATION_INCOMPLETE",
                        "retryable": False,
                        "chunks": [
                            {
                                "output_type": "text",
                                "content": react_state["_report_html_error"],
                            }
                        ],
                    }
                )
            missing["execution_attempts"] = missing.get("execution_attempts", 0) + 1

        if not code or not code.strip():
            return json.dumps(
                {"success": False, "error_code": "PYTHON_CODE_REQUIRED",
                 "chunks": [{"output_type": "text", "content": "No code provided"}]},
                ensure_ascii=False,
            )

        work_dir = conversation_work_dir(react_state)
        capture_dir = os.path.join(work_dir, ".report-executions", uuid.uuid4().hex)
        os.makedirs(capture_dir, exist_ok=True)
        files_before = _workspace_files(work_dir)

        preamble_lines = [
            "import json",
            "import os",
            "import pandas as pd",
            "import numpy as np",
            "import types as _capture_types",
            '_report_capture = _capture_types.ModuleType("_sandbox_capture")',
            f"exec({capture_helper_source()!r}, _report_capture.__dict__)",
            'PLOT_DIR = os.environ["PLOT_DIR"]',
            "os.makedirs(PLOT_DIR, exist_ok=True)",
            "OUTPUT_DIR = PLOT_DIR",
            "def output_path(filename):",
            "    return _report_capture.prepare_output_path(OUTPUT_DIR, filename)",
            "result_json = _report_capture.result_json",
            'FILE_PATH = os.environ.get("FILE_PATH") or None',
            'FILES_JSON = os.environ.get("FILES_JSON") or None',
            'SQL_RESULTS_PATH = os.environ.get("SQL_RESULTS_PATH") or None',
            "_sql_datasets = []",
            "if SQL_RESULTS_PATH:",
            '    with open(SQL_RESULTS_PATH, encoding="utf-8") as _sql_results_file:',
            "        _sql_datasets = json.load(_sql_results_file)",
            "SQL_RESULTS = _report_capture.TrackedSQLResults(",
            '    _sql_datasets, os.environ["SQL_INPUT_TRACE_PATH"])',
            "SQL_RESULT_CATALOG = SQL_RESULTS.catalog()",
            "def sql_result_frame(index=-1, *, artifact_id=None):",
            "    dataset = SQL_RESULTS.select(artifact_id if artifact_id is not None else index)",
            '    return pd.DataFrame(dataset["rows"], columns=dataset["columns"])',
        ]
        preamble = "\n".join(preamble_lines) + "\n"
        result_path = os.path.join(capture_dir, "_report_result.json")
        postamble = (
            '\nif "REPORT_RESULT" in globals():\n'
            '    with open(os.environ["REPORT_RESULT_PATH"], "w", '
            'encoding="utf-8") as _report_result_file:\n'
            "        json.dump(\n"
            "            _report_capture.normalize_artifact_value(REPORT_RESULT), "
            "_report_result_file, ensure_ascii=False, allow_nan=False)\n"
        )
        full_code = preamble + code
        started = time.perf_counter()

        try:
            compile(full_code, "<code>", "exec")
        except SyntaxError as se:
            repaired = _try_repair_truncated_code(full_code)
            if repaired is not None:
                logger.warning(
                    "code: auto-repaired truncated code "
                    "(original SyntaxError: %s line %s)",
                    se.msg,
                    se.lineno,
                )
                full_code = repaired
                code = full_code[len(preamble) :]
            else:
                error_msg = (
                    f"SyntaxError before execution: {se.msg} "
                    f"(line {se.lineno})\n"
                    "Please regenerate complete, syntactically valid Python code. "
                    "Keep code under 80 lines."
                )
                capture_python_execution(
                    code=code,
                    duration_ms=int((time.perf_counter() - started) * 1000),
                    status="failed",
                    exit_code=None,
                    stdout="",
                    stderr="",
                    error=error_msg,
                    artifact_sink=react_state.get("_report_artifact_sink"),
                )
                return json.dumps(
                    {
                        "success": False,
                        "error_code": "PYTHON_SYNTAX_ERROR",
                        "chunks": [
                            {"output_type": "code", "content": code.strip()},
                            {"output_type": "text", "content": error_msg},
                        ]
                    },
                    ensure_ascii=False,
                )

        full_code += postamble
        output_text = ""
        error_text = ""
        returncode: Optional[int] = None
        execution_error: Optional[str] = None
        stdout = b""
        stderr = b""
        stdout_text = ""
        sql_input_artifact_ids: List[str] = []
        tmp_path = None
        try:
            sql_results_path = None
            artifact_sink = (
                react_state.get("_report_artifact_sink") or get_current_artifact_sink()
            )
            sql_results = sql_execution_context(artifact_sink)
            # Containers have neither the host artifact store nor DB-GPT. Ship
            # complete normalized snapshots inside the uploaded working folder.
            for dataset in sql_results:
                content_uri = dataset.pop("content_uri", None)
                if content_uri:
                    data = json.loads(
                        artifact_content_path(content_uri).read_text(encoding="utf-8")
                    )
                    dataset.update(data)
                    dataset["truncated"] = False
                    dataset["row_count"] = len(data["rows"])
            sql_trace_path = os.path.join(capture_dir, "_sql_inputs.json")
            if isinstance(sql_results, list) and sql_results:
                sql_results_path = os.path.join(capture_dir, "_report_sql_results.json")
                with open(sql_results_path, "w", encoding="utf-8") as context_file:
                    json.dump(
                        sql_results, context_file, ensure_ascii=False, allow_nan=False
                    )
            with tempfile.NamedTemporaryFile(
                mode="w",
                encoding="utf-8",
                prefix="_run_",
                suffix=".py",
                dir=capture_dir,
                delete=False,
            ) as tmp:
                tmp_path = tmp.name
                tmp.write(full_code)

            execution_env = build_execution_env(
                work_dir=work_dir,
                file_path=react_state.get("file_path"),
                files_json_path=react_state.get("files_json_path"),
                artifact_sink=artifact_sink,
                extra={
                    "REPORT_RESULT_PATH": result_path,
                    "SQL_RESULTS_PATH": sql_results_path,
                    "SQL_INPUT_TRACE_PATH": sql_trace_path,
                    "REPORT_CALCULATION_INPUTS": (
                        (react_state.get("_report_missing_calculation") or {}).get(
                            "input_path"
                        )
                        if not (
                            react_state.get("_report_missing_calculation") or {}
                        ).get("result_artifact_id")
                        else None
                    ),
                },
            )
            returncode, stdout, stderr = await _run_python_file(
                tmp_path,
                cwd=work_dir,
                env=execution_env,
                timeout=EXECUTION_TIMEOUT_SECONDS,
            )
            stdout_text = stdout.decode("utf-8", errors="replace")
            output_text = stdout_text
            error_text = stderr.decode("utf-8", errors="replace")

            if returncode is None:
                # ``_run_python_file`` returns ``None`` only on timeout.
                output_text = (
                    f"Execution timed out ({EXECUTION_TIMEOUT_SECONDS}s limit)"
                )
            elif returncode and error_text:
                output_text = (
                    output_text + "\n[ERROR]\n" + error_text
                    if output_text
                    else error_text
                )
        except Exception as e:
            execution_error = f"Execution error: {e}"
            output_text = execution_error
        finally:
            try:
                if tmp_path and os.path.exists(tmp_path):
                    os.remove(tmp_path)
            except OSError:
                logger.debug("Cannot remove execution script", exc_info=True)
        execution_duration_ms = int((time.perf_counter() - started) * 1000)

        chunks: List[Dict[str, Any]] = [
            {"output_type": "code", "content": code.strip()},
        ]
        if output_text.strip():
            clean_output = output_text.strip()
            # Raised from 2000 to 50_000: data-analysis tasks frequently need
            # more than 2000 chars of output (e.g. DataFrame summaries). Larger
            # outputs are persisted to disk by the ToolResultStorage layer
            # rather than truncated here, so the agent can read_file to recover
            # the full content.
            max_out_len = max_output_chars
            if len(clean_output) > max_out_len:
                if legacy_truncation_notice:
                    truncation_notice = (
                        f"\n\n... [Output truncated, length: {len(clean_output)} chars."
                        f" Only showing first {max_out_len} chars."
                        " If you generated HTML, the file is saved.]"
                    )
                else:
                    truncation_notice = (
                        f"\n\n... [Output truncated, length: {len(clean_output)} chars."
                        f" Only showing first {max_out_len} chars.]"
                    )
                clean_output = clean_output[:max_out_len] + truncation_notice
            chunks.append({"output_type": "text", "content": clean_output})
        else:
            chunks.append(
                {
                    "output_type": "text",
                    "content": "(no output — add print() to see results)",
                }
            )

        files_after = _workspace_files(work_dir)
        changed_files = {
            path
            for path, signature in files_after.items()
            if files_before.get(path) != signature
        }
        image_paths = [
            path
            for path in execution_output_files(work_dir, images=True)
            if path in changed_files
        ]

        if execution_error is not None:
            status = "failed"
            artifact_error = execution_error
        elif returncode is None:
            status = "timed_out"
            artifact_error = output_text
        elif returncode != 0:
            status = "failed"
            artifact_error = (
                error_text.strip() or f"Python exited with code {returncode}"
            )
        else:
            status = "succeeded"
            artifact_error = None

        # A script can write a chart and then fail. Such a partial output has no
        # successful producer and must not be advertised for report use.
        captured_images = (
            publish_generated_images(image_paths) if status == "succeeded" else []
        )
        published_paths = {image["source_path"] for image in captured_images}
        chunks.extend(
            chunk for chunk in generated_file_chunks(
                work_dir, files_before, status, after=files_after
            ) if chunk["content"]["file_path"] not in published_paths
        )
        for image in captured_images:
            chunks.append({"output_type": "image", "content": image["uri"]})
            react_state.setdefault("generated_images", []).append(image["uri"])
        if "execution_env" in locals():
            sql_input_artifact_ids = json.loads(
                execution_env["DBGPT_INPUT_ARTIFACT_IDS"]
            )
        if "sql_trace_path" in locals() and os.path.isfile(sql_trace_path):
            with open(sql_trace_path, encoding="utf-8") as trace:
                sql_input_artifact_ids.extend(json.load(trace))
        missing_calculation = react_state.get("_report_missing_calculation")
        if missing_calculation and not missing_calculation.get("result_artifact_id"):
            sql_input_artifact_ids.extend(missing_calculation["source_artifact_ids"])
        result_inline = None
        if status == "succeeded" and os.path.isfile(result_path):
            with open(result_path, encoding="utf-8") as result_file:
                result_inline = json.load(result_file)
        python_artifact_id = capture_python_execution(
            code=code,
            duration_ms=execution_duration_ms,
            status=status,
            exit_code=returncode,
            stdout=stdout_text,
            result_inline=result_inline,
            stderr=error_text,
            error=artifact_error,
            images=captured_images,
            output_files=[
                path
                for path in execution_output_files(work_dir)
                if path in changed_files
            ],
            input_artifact_ids=list(dict.fromkeys(sql_input_artifact_ids)),
            metadata={"input_lineage": "captured_inputs" if sql_input_artifact_ids else "uncaptured_inputs"},
            artifact_sink=react_state.get("_report_artifact_sink"),
        )
        sink = react_state.get("_report_artifact_sink")
        if (
            status == "succeeded"
            and sink
            and python_artifact_id
            and any(
                item.artifact_id == python_artifact_id and item.result is None
                for item in sink.snapshot()
            )
        ):
            chunks.append(
                {
                    "output_type": "text",
                    "content": (
                        "PYTHON_STRUCTURED_RESULT_MISSING: Execution succeeded but "
                        "no structured result was captured. Text output is not a "
                        "selectable result; capture the needed calculation as "
                        "REPORT_RESULT before referencing its fields."
                    ),
                }
            )
        if (
            missing_calculation
            and not missing_calculation.get("result_artifact_id")
            and status == "succeeded"
            and python_artifact_id
        ):
            sink = react_state.get("_report_artifact_sink")
            if sink and any(
                item.artifact_id == python_artifact_id
                and item.status == "succeeded"
                and getattr(item, "result", None) is not None
                for item in sink.snapshot()
            ):
                missing_calculation["result_artifact_id"] = python_artifact_id
                from .report_repair import save_execution_checkpoint

                save_execution_checkpoint(
                    react_state, "REPORT_CALCULATION_CAPTURED: resume saved report spec"
                )

        # The per-call script is removed in finally; clean up its SQL context.
        try:
            if (
                "sql_results_path" in locals()
                and sql_results_path
                and os.path.exists(sql_results_path)
            ):
                os.remove(sql_results_path)
        except Exception:
            pass

        all_images = react_state.get("generated_images", [])
        if all_images:
            locale = str(react_state.get("_ui_locale") or "en")
            image_heading = (
                "Ảnh đã tạo (URL đã công bố):"
                if locale.startswith("vi") else
                "已生成的图片（已发布的 URL）:"
                if locale.startswith("zh") else
                "Generated images (published URLs):"
            )
            img_summary = image_heading + "\n" + "\n".join(
                f"  - {url}" for url in all_images
            )
            chunks.append({"output_type": "text", "content": img_summary})

        success = status == "succeeded"
        lineage = list(dict.fromkeys(sql_input_artifact_ids))
        error_code = None if success else (
            "PYTHON_EXECUTION_TIMEOUT" if status == "timed_out" else
            "PYTHON_OUTPUT_PATH_INVALID" if "PYTHON_OUTPUT_PATH_INVALID" in (error_text or artifact_error or "") else
            "PYTHON_OUTPUT_DIRECTORY_MISSING" if "Cannot save file into a non-existent directory" in (error_text or artifact_error or "") else
            "PYTHON_RESULT_SERIALIZATION_FAILED" if any(message in (error_text or artifact_error or "") for message in (
                "is not JSON serializable", "unsupported artifact value:",
                "artifact mappings require string keys",
            )) else
            "PYTHON_SQL_INPUT_NOT_FOUND" if "SQL_RESULT_NOT_FOUND" in (error_text or artifact_error or "") else
            "PYTHON_SQL_INPUT_SELECTOR_INVALID" if "SQL_RESULT_SELECTOR_INVALID" in (error_text or artifact_error or "") else
            "PYTHON_IMPORT_ERROR" if "ModuleNotFoundError" in (error_text or artifact_error or "") else
            "PYTHON_EXECUTION_FAILED"
        )
        recovery_hint = (
            "Use output_path('exports/summary.csv') or output_path('plots/chart.png'); "
            "OUTPUT_DIR/PLOT_DIR already exists for this conversation and the helper "
            "creates child directories. Do not guess a global /app/workspace or "
            "rerun completed SQL to fix an output location."
            if error_code in {"PYTHON_OUTPUT_PATH_INVALID", "PYTHON_OUTPUT_DIRECTORY_MISSING"} else
            "Assign REPORT_RESULT directly; it is normalized at capture. For JSON "
            "text use result_json(REPORT_RESULT), which preserves NumPy booleans "
            "and numbers and typed Decimal/date values without default=str. "
            "Keep dictionary keys as strings and convert DataFrames to explicit "
            "columns/records. Preserve prior SQL artifacts instead of rerunning them."
            if error_code == "PYTHON_RESULT_SERIALIZATION_FAILED" else
            "Inspect print(SQL_RESULT_CATALOG); select the exact artifact ID with "
            "sql_result_frame('sql-...'). Only this owner's conversation artifacts "
            "are available. Query missing data with sql_query; do not invent rows."
            if error_code in {"PYTHON_SQL_INPUT_NOT_FOUND", "PYTHON_SQL_INPUT_SELECTOR_INVALID"} else
            "Use SQL_RESULTS or sql_result_frame(index), which are injected globals; "
            "db_gpt_tools is not installed. Inspect imports and available inputs "
            "before retrying. Do not substitute invented source records."
            if error_code == "PYTHON_IMPORT_ERROR" else
            "Inspect the captured error and correct the script; preserve valid prior artifacts."
            if not success else None
        )
        if success and not lineage:
            chunks.append({"output_type": "text", "content": (
                "INPUT_LINEAGE_UNCAPTURED: this computation has no captured input "
                "artifact references. It may be a standalone calculation or literal "
                "example; do not present it as observed datasource statistics. "
                "Use df = sql_result_frame('sql-<artifact_id>') or captured source "
                "files for data-grounded analysis. print(SQL_RESULT_CATALOG) lists "
                "the available SQL inputs; artifact IDs in comments or literal "
                "REPORT_RESULT fields do not establish a source read."
            )})
            if sql_results:
                recovery_hint = (
                    "The calculation succeeded but has no captured inputs. For "
                    "source analysis, load the intended SQL result with "
                    "sql_result_frame(artifact_id='sql-...') and recompute the "
                    "dependent values. Inspect SQL_RESULT_CATALOG for IDs and "
                    "columns; do not rerun the SQL just to obtain these rows."
                )
        return json.dumps({
            "success": success, "execution_status": status, "error_code": error_code,
            "recovery_hint": recovery_hint,
            "provenance": {"input_artifact_ids": lineage,
                           "status": "captured_inputs" if lineage else "uncaptured_inputs"},
            "chunks": chunks, "artifact_id": python_artifact_id,
        }, ensure_ascii=False)

    return code
