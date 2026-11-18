"""Project stored replies without replaying duplicate AI/view representations."""
import json
from typing import Any, Iterable, List

from dbgpt.agent.core.agent import AgentMessage


def react_history_dialogues(history: Iterable[Any]) -> List[AgentMessage]:
    messages = []
    last_answer = None
    for stored in history:
        kind = stored.type
        content = stored.content
        if kind == "human":
            messages.append(AgentMessage(content=content, role="human"))
            last_answer = None
            continue
        if kind not in {"ai", "view"}:
            continue
        if kind == "view":
            try:
                payload = json.loads(content) if isinstance(content, str) else content
                if isinstance(payload, dict):
                    content = payload.get("final_content") or ""
            except (ValueError, TypeError):
                pass
        if not content:
            continue
        round_id = getattr(stored, "round_index", None)
        identity = (round_id, content)
        # Only collapse an identical representation within a known round. A
        # repeated answer to a later question, or differing reply, stays intact.
        if isinstance(round_id, int) and round_id > 0 and identity == last_answer:
            continue
        messages.append(AgentMessage(content=content, role="ai"))
        last_answer = identity
    return messages
