import json
from types import SimpleNamespace

from dbgpt_app.openapi.api_v1.history_projection import react_history_dialogues


def row(kind, text, round_id=1):
    return SimpleNamespace(type=kind, content=text, round_index=round_id)


def test_only_duplicate_ai_view_representation_in_same_known_round_is_removed():
    answer = "Exact evidence=sql-1; quality=INCOMPLETE; values=3.14; repair unresolved"
    history = [row("human", "q"), row("ai", answer), row("view", json.dumps({"final_content": answer})),
               row("human", "ask again", 2), row("view", {"final_content": answer}, 2)]
    projected = react_history_dialogues(history)
    assert [m.role for m in projected] == ["human", "ai", "human", "ai"]
    assert [m.content for m in projected] == ["q", answer, "ask again", answer]


def test_different_answers_unknown_rounds_and_malformed_legacy_are_not_dropped():
    history = [row("human", "q"), row("ai", "a"), row("view", {"final_content": "b"}),
               row("view", "malformed {"), row("ai", "unknown", 0), row("ai", "unknown", 0)]
    projected = react_history_dialogues(history)
    assert [m.content for m in projected] == ["q", "a", "b", "malformed {", "unknown", "unknown"]
