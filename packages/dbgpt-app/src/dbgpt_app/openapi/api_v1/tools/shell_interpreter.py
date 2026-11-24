"""bash tool — run shell commands using the configured execution runtime."""

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, List

from dbgpt.agent.resource.tool.base import tool
from dbgpt.core.interface.report_capture import IMAGE_EXTENSIONS, publish_generated_images
from dbgpt_sandbox.sandbox.execution_layer.base import ExecutionStatus

from ._execution import run_code
from .code_interpreter import build_execution_env, conversation_work_dir
from .generated_files import generated_file_chunks, snapshot_generated_files

logger = logging.getLogger(__name__)


def make_shell_interpreter(react_state: Dict[str, Any]):
    @tool(
        description=(
            "Execute shell/bash commands using the configured runtime. "
            "Use this tool when you need to run shell commands such as ls, cat, "
            "grep, curl, apt, pip, git, or any other CLI tool. "
            "Execution has a 30s timeout. Local mode runs on the server; "
            "configure Docker for container isolation. "
            'Parameters: {"code": "shell command(s) to execute"}'
        )
    )
    async def bash(code: str) -> str:
        """Execute shell/bash commands with the selected runtime."""
        if not code or not code.strip():
            return json.dumps(
                {"chunks": [{"output_type": "text", "content": "No command provided"}]},
                ensure_ascii=False,
            )

        from dbgpt.configs.model_config import SKILLS_DIR

        sandbox_work_dir = conversation_work_dir(react_state)
        os.makedirs(sandbox_work_dir, exist_ok=True)
        files_before = await asyncio.to_thread(snapshot_generated_files, sandbox_work_dir)
        producer_status = "failed"

        output_text = ""
        try:
            result = await run_code(
                code,
                language="bash",
                work_dir=sandbox_work_dir,
                env=build_execution_env(
                    work_dir=sandbox_work_dir,
                    file_path=react_state.get("file_path"),
                    files_json_path=react_state.get("files_json_path"),
                ),
                timeout=30,
                input_paths=[SKILLS_DIR]
                if os.path.isdir(SKILLS_DIR)
                and ("skills/" in code or SKILLS_DIR in code)
                else [],
            )

            if result.status == ExecutionStatus.SUCCESS:
                producer_status = "succeeded"
                output_text = result.output or ""
            elif result.status == ExecutionStatus.TIMEOUT:
                producer_status = "timed_out"
                output_text = "Execution timed out (30s limit)"
            else:
                output_text = result.error or "Unknown execution error"
                if result.output:
                    output_text = result.output + "\n[ERROR]\n" + output_text
        except Exception as e:
            output_text = f"Sandbox execution error: {e}"

        # Cap shell output size so a verbose command (e.g. `find /`, huge log
        # dumps) can't overflow the LLM context window. Larger outputs are
        # persisted to disk by the ToolResultStorage layer.
        MAX_SHELL_OUTPUT_CHARS = 50_000
        if len(output_text) > MAX_SHELL_OUTPUT_CHARS:
            output_text = (
                output_text[:MAX_SHELL_OUTPUT_CHARS]
                + f"\n\n... [Output truncated at {MAX_SHELL_OUTPUT_CHARS} chars]"
            )

        chunks: List[Dict[str, Any]] = [
            {"output_type": "code", "content": code.strip()},
        ]
        if output_text.strip():
            chunks.append({"output_type": "text", "content": output_text.strip()})
        else:
            chunks.append({"output_type": "text", "content": "(no output)"})

        # Publish only changed files from this successful execution. Never scan
        # old charts or guess output paths from stdout/skill command names.
        files_after = await asyncio.to_thread(snapshot_generated_files, sandbox_work_dir)
        image_paths = [path for path, signature in files_after.items()
                       if files_before.get(path) != signature
                       and Path(path).suffix.lower() in IMAGE_EXTENSIONS]
        published = []
        publication_error = None
        if producer_status == "succeeded":
            if "calculate_ratios" in code:
                try:
                    ratios = json.loads(output_text)
                    if isinstance(ratios, dict): react_state["ratio_data"] = ratios
                except (ValueError, TypeError):
                    pass
            try:
                published = await asyncio.to_thread(publish_generated_images, image_paths)
            except (OSError, ValueError) as error:
                publication_error = str(error)
                chunks.append({"output_type": "text", "content": "Image publication failed: " + str(error)})
        for image in published:
            chunks.append({"output_type": "image", "content": image["uri"]})
            react_state.setdefault("generated_images", []).append(image["uri"])
            react_state.setdefault("image_url_map", {})[Path(image["source_path"]).stem.lower()] = image["uri"]
        published_paths = {image["source_path"] for image in published}
        chunks.extend(chunk for chunk in generated_file_chunks(
            sandbox_work_dir, files_before, producer_status, after=files_after
        ) if chunk["content"]["file_path"] not in published_paths)
        success = producer_status == "succeeded" and publication_error is None
        return json.dumps({
            "success": success,
            "error_code": None if success else (
                "SHELL_IMAGE_PUBLICATION_FAILED" if publication_error else
                "SHELL_EXECUTION_TIMEOUT" if producer_status == "timed_out" else "SHELL_EXECUTION_FAILED"
            ),
            "producer_status": producer_status,
            "chunks": chunks,
        }, ensure_ascii=False)

    return bash
