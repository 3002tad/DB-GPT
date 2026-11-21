"""Lossless prompt projection helpers; counts are characters, never token usage."""
import copy
import json
import re
from typing import TYPE_CHECKING, Any, Dict, List

if TYPE_CHECKING:
    from dbgpt.agent.core.agent import AgentMessage

NATIVE_TOOL_PROTOCOL = """# PROVIDER-NATIVE TOOL PROTOCOL #
Use the supplied tool_calls functions for actions with complete JSON arguments.
Before each group of calls, write a short public progress message in the user's
language explaining the action and next step. Keep private reasoning in the
thinking channel. Use intention for a short public explanation. Write ordinary
prose without Thought, Action or Action Input protocol labels. Do not return
only reasoning or merely describe an intended call. When finished, prefer calling
terminate with the final answer in output. A complete public answer without tool
calls also ends the turn; it does not certify unfinished work or missing evidence."""


def native_public_answer(response: Any) -> str:
    """Recognize provider public text, never private reasoning or broken calls.

    Missing finish_reason is supported by older provider adapters. Explicit
    non-stop finish reasons must not turn truncated/filtered output into success.
    This is a transport check, not a classifier of the user's business question.
    """
    if (
        not response
        or not getattr(response, "has_text", False)
        or getattr(response, "error_code", 0)
        or getattr(response, "tool_calls", None)
        or getattr(response, "finish_reason", None) not in (None, "stop", "end_turn")
    ):
        return ""
    text = (response.text or "").strip()
    if re.search(
        r"(?im)^\s*(?:Thought|Action|Action Input|Observation)\s*:"
        r"|<\s*/?\s*(?:think|tool_call|function_call)\b",
        text,
    ):
        return ""
    return text


def project_history_roles(messages: List["AgentMessage"]) -> List["AgentMessage"]:
    """Respect known roles; parity is only a fallback for legacy untyped lists."""
    projected = []
    for index, original in enumerate(messages):
        message = copy.copy(original)
        if not message.role:
            message.role = "human" if index % 2 == 0 else "ai"
        projected.append(message)
    return projected


def native_request_shape(
    messages: List[Dict[str, Any]], tools: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """Safe diagnostics: no prompt text, tool names, args or model responses."""
    by_role = {}
    for message in messages:
        role = message.get("role")
        if role not in {"system", "human", "user", "ai", "assistant", "tool"}:
            role = "other"
        entry = by_role.setdefault(
            role, {"messages": 0, "content_chars": 0, "tool_call_chars": 0}
        )
        entry["messages"] += 1
        content = message.get("content")
        if isinstance(content, str):
            entry["content_chars"] += len(content)
        elif content is not None:
            entry["content_chars"] += len(
                json.dumps(content, ensure_ascii=False, default=str)
            )
        if message.get("tool_calls"):
            entry["tool_call_chars"] += len(
                json.dumps(message["tool_calls"], ensure_ascii=False, default=str)
            )
    return {
        "unit": "characters_not_tokens", "roles": by_role, "tools": len(tools),
        "tool_schema_chars": len(json.dumps(tools, ensure_ascii=False, default=str)),
    }
