"""todowrite tool — maintain a session-level structured task list."""

import json
from typing import Any, Callable, Dict, List, Optional

from dbgpt.agent.resource.tool.base import tool


def make_todowrite(
    todo_list: List[Dict[str, str]],
    stream_callback: Callable,
    execution_state: Optional[Dict[str, Any]] = None,
):
    """Return a ``todowrite`` FunctionTool that mutates ``todo_list`` in-place."""

    @tool(
        description=(
            "Create and manage a structured task list for the current session. "
            "Use this tool to plan complex tasks (3+ steps) or tasks containing "
            "2 or more mutually independent subtasks, track progress, and show "
            "the user what you are doing. "
            "Pass the FULL todo list every time (not incremental). "
            "Each todo has: content (brief description), "
            "status (pending | in_progress | completed | cancelled), "
            "priority (high | medium | low). "
            "Rules: only ONE task in_progress at a time; mark tasks completed "
            "immediately after finishing; do NOT use for single trivial tasks."
            '\nParameter: {"todos": [{"content": "...", "status": "...", '
            '"priority": "..."}]}'
        )
    )
    def todowrite(todos: str) -> str:
        """Update the session todo list (full replacement)."""
        parsed: List[Dict[str, str]] = []
        try:
            raw = json.loads(todos) if isinstance(todos, str) else todos
            items = raw if isinstance(raw, list) else raw.get("todos", raw)
            if isinstance(items, list):
                for item in items:
                    parsed.append(
                        {
                            "content": str(item.get("content", "")),
                            "status": str(item.get("status", "pending")),
                            "priority": str(item.get("priority", "medium")),
                        }
                    )
        except Exception:
            return json.dumps(
                {
                    "chunks": [
                        {
                            "output_type": "text",
                            "content": "Error: invalid todos JSON",
                        }
                    ]
                },
                ensure_ascii=False,
            )

        # A completed plan may be revised with different work. Reopening the
        # exact same completed tasks is the observed no-progress loop; keep the
        # completed plan visible and give the model one opportunity to recover.
        same_tasks = (
            len(todo_list) > 1
            and len(todo_list) == len(parsed)
            and [item["content"] for item in todo_list]
            == [item["content"] for item in parsed]
        )
        completed_reset = (
            same_tasks
            and all(item["status"] == "completed" for item in todo_list)
            and all(item["status"] in {"pending", "in_progress"} for item in parsed)
        )
        if execution_state is not None and completed_reset:
            count = execution_state.get("_completed_plan_reset_count", 0) + 1
            execution_state["_completed_plan_reset_count"] = count
            if count >= 2:
                execution_state["_completed_plan_stalled"] = True
            return json.dumps(
                {
                    "chunks": [{"output_type": "text", "content": (
                        "This exact plan is already complete. Reuse the existing "
                        "results and call terminate with the answer, or create a "
                        "new plan describing genuinely different remaining work."
                    )}],
                    "__todos__": list(todo_list),
                },
                ensure_ascii=False,
            )
        if execution_state is not None:
            execution_state["_completed_plan_reset_count"] = 0

        todo_list.clear()
        todo_list.extend(parsed)

        total = len(parsed)
        done = sum(1 for t in parsed if t["status"] == "completed")
        return json.dumps(
            {
                "chunks": [
                    {
                        "output_type": "text",
                        "content": f"Todo list updated: {done}/{total} completed",
                    }
                ],
                "__todos__": parsed,
            },
            ensure_ascii=False,
        )

    return todowrite
