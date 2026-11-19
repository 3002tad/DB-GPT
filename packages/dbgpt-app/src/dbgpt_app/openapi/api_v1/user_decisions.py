"""Retain confirmed clarification answers independently of rolling memory."""
import json


def remember_answers(state, pairs, request_id=""):
    confirmed = [
        {"question": p["question"], "answer": p["answer"]}
        for p in pairs
        if isinstance(p, dict) and p.get("question") and p.get("answer")
    ]
    if not confirmed:
        return
    decisions = state.setdefault("_user_decisions", [])
    record = {"request_id": request_id, "pairs": confirmed}
    if record not in decisions:
        decisions.append(record)


def restore_answers(state, history):
    """Read only persisted question-tool recaps, never model prose or plans."""
    for message in history:
        if message.type != "view":
            continue
        try:
            payload = json.loads(message.content) if isinstance(message.content, str) else message.content
        except (ValueError, TypeError):
            continue
        if not isinstance(payload, dict):
            continue
        records = payload.get("user_decisions")
        if isinstance(records, list):
            for record in records:
                if isinstance(record, dict):
                    remember_answers(state, record.get("pairs") or [], record.get("request_id", ""))
            continue
        for step in payload.get("steps", []):
            if not isinstance(step, dict) or step.get("action") != "question":
                continue
            for output in step.get("outputs", []):
                if not isinstance(output, dict) or output.get("output_type") != "question_recap":
                    continue
                content = output.get("content")
                if isinstance(content, dict) and not content.get("rejected") and not content.get("timed_out"):
                    remember_answers(state, content.get("pairs") or [],
                                     f"history:{getattr(message, 'round_index', 0)}:{step.get('id', '')}")
