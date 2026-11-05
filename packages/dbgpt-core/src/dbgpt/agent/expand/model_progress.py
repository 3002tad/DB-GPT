"""Advisory model-call estimate and a narrow repeated SQL failure guard."""

import hashlib
import json
from typing import Any, Dict, Optional


def set_estimate(state: Dict[str, Any], value: Any) -> None:
    """Accept a model's optional estimate; it is never an execution limit."""
    if not isinstance(value, bool) and isinstance(value, int) and 0 < value <= 10000:
        state.setdefault("_model_progress", {})["estimated_calls"] = value


def model_call_started(state: Dict[str, Any]) -> Dict[str, Any]:
    progress = state.setdefault("_model_progress", {})
    progress["calls"] = progress.get("calls", 0) + 1
    return model_progress(state)


def model_progress(state: Dict[str, Any]) -> Dict[str, Any]:
    progress = state.get("_model_progress", {})
    return {
        "calls": progress.get("calls", 0),
        "estimated_calls": progress.get("estimated_calls"),
    }


def repeated_failed_sql(state: Dict[str, Any], calls: Any, success: bool) -> bool:
    """Detect three consecutive identical failed single SQL calls after estimate.

    Batch, malformed, successful and other tool calls reset the sequence. We
    store only a hash; exact input equality intentionally favors avoiding false
    positives over catching every possible loop.
    """
    progress = state.setdefault("_model_progress", {})
    signature: Optional[str] = None
    if not success and isinstance(calls, list) and len(calls) == 1:
        fn = calls[0].get("function", {}) if isinstance(calls[0], dict) else {}
        if fn.get("name") == "sql_query":
            try:
                args = fn.get("arguments", {})
                args = json.loads(args) if isinstance(args, str) else args
                sql = args.get("sql") if isinstance(args, dict) else None
                if isinstance(sql, str) and sql.strip():
                    signature = hashlib.sha256(sql.strip().encode()).hexdigest()
            except (ValueError, TypeError):
                pass
    if signature is None:
        progress.pop("failed_sql_hash", None)
        progress.pop("failed_sql_repeats", None)
        return False
    repeats = (
        progress.get("failed_sql_repeats", 0) + 1
        if signature == progress.get("failed_sql_hash")
        else 1
    )
    progress.update(failed_sql_hash=signature, failed_sql_repeats=repeats)
    estimate = progress.get("estimated_calls")
    return bool(estimate and progress.get("calls", 0) >= estimate and repeats >= 3)
