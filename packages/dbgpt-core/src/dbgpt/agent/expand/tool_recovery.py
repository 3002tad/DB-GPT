"""Task-local, advisory recovery for repeated tool failures.

The detector records bounded fingerprints, not tool arguments or result data.
Only repeated identical read-only retrieval calls can be skipped. Other tools,
changed arguments, and the number of analysis steps remain available.
"""

import hashlib
import json
from typing import Any, Dict, Optional


def _fingerprint(value: Any) -> str:
    try:
        encoded = json.dumps(value, sort_keys=True, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        encoded = str(type(value))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def repeated_failure(state: Dict[str, Any], tool_name: str, arguments: Any) -> bool:
    """A failed identical call can be skipped on its third attempt."""
    entry = state.get("_tool_recovery", {}).get(tool_name, {})
    return entry.get("signature") == _fingerprint(arguments) and entry.get("repeats", 0) >= 2


def observe_tool_result(
    state: Dict[str, Any], tool_name: str, arguments: Any,
    *, success: bool, error_code: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Return a recovery signal after two failures of the same call or error."""
    entries = state.setdefault("_tool_recovery", {})
    if success:
        entries.pop(tool_name, None)
        return None
    signature = _fingerprint(arguments)
    previous = entries.get(tool_name, {})
    same_call = previous.get("signature") == signature
    same_error = bool(error_code) and previous.get("error_code") == error_code
    repeats = previous.get("repeats", 0) + 1 if same_call else 1
    error_repeats = previous.get("error_repeats", 0) + 1 if same_error else 1
    entries[tool_name] = {
        "signature": signature, "repeats": repeats,
        "error_code": error_code, "error_repeats": error_repeats,
    }
    if repeats < 2 and error_repeats < 2:
        return None
    return {
        "status": "RECOVERY_SUGGESTED",
        "tool": tool_name,
        "reason": "same_call_failed" if repeats >= 2 else "same_error_recurred",
        "instruction": (
            "Do not repeat this failing call unchanged. Inspect the tool error, "
            "change the arguments or use another available tool. You may also "
            "summarize the valid results already collected."
        ),
    }


def observe_action_results(
    state: Dict[str, Any], calls: Any, observations: Any, success: bool,
) -> list:
    """Inspect each native tool result, including mixed-success batches.

    SQL handles its own richer feedback inside the SQL tool. Other tools get
    advisory feedback without converting the entire Agent turn to a failure.
    """
    if not isinstance(calls, list) or not calls:
        return []
    try:
        batch = json.loads(observations) if isinstance(observations, str) else observations
    except (TypeError, ValueError):
        batch = None
    results = batch if isinstance(batch, list) and len(batch) == len(calls) else None
    signals = []
    for index, call in enumerate(calls):
        fn = call.get("function", {}) if isinstance(call, dict) else {}
        name = fn.get("name")
        if not name or name in {"sql_query", "todowrite", "terminate"}:
            continue
        arguments = fn.get("arguments", {})
        try:
            arguments = json.loads(arguments) if isinstance(arguments, str) else arguments
        except (TypeError, ValueError):
            pass
        result = results[index] if results is not None else None
        if results is not None and not isinstance(result, dict):
            continue
        succeeded = bool(result.get("success")) if result is not None else bool(success)
        error_code = None
        if not succeeded and result is not None:
            try:
                payload = json.loads(result.get("content", ""))
                error_code = payload.get("error_code") if isinstance(payload, dict) else None
            except (TypeError, ValueError):
                pass
        signal = observe_tool_result(
            state, name, arguments, success=succeeded, error_code=error_code,
        )
        if signal:
            signals.append(signal)
    return signals
