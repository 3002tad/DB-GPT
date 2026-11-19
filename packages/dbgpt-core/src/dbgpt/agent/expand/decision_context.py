"""Small, pinned user scope; unaffected by a rolling tool transcript."""
import json
import re

_START = "<confirmed-user-decisions>"
_END = "</confirmed-user-decisions>"


def pin_decision_context(prompt, state):
    """Replace our previous projection if a compacted system message returns."""
    base = re.sub(re.escape(_START) + r".*?" + re.escape(_END), "", prompt, flags=re.S).rstrip()
    current = decision_context(state)
    return base + ("\n\n" + _START + "\n" + current + "\n" + _END if current else "")


def decision_context(state):
    decisions = (state or {}).get("_user_decisions") or []
    if not decisions:
        return ""
    # Preserve chronological corrections. Do not infer replacements by keywords.
    pairs = []
    for record in decisions:
        for pair in record.get("pairs", []):
            if not pairs or pair != pairs[-1]:
                pairs.append(pair)
    return (
        "Confirmed user clarification answers (chronological; later explicit "
        "corrections override earlier choices; the current user request may revise "
        "them):\n" + json.dumps(pairs, ensure_ascii=False)
        + "\nBefore finishing, check period, ranking criterion, top-N and grain "
        "against these answers. Report partial objectives honestly and update the "
        "task plan accordingly. Empty SQL results establish only the queried "
        "predicate, not absence of an event or business process. Check enum values "
        "and join keys when appropriate. Reuse evidence only when its scope matches."
    )
