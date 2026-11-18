"""Display-only context measurements persisted with the owning chat turn."""

import math
import time
from typing import Any, Dict, Optional


def _number(value: Any, *, positive: bool = False) -> bool:
    try:
        return (
            isinstance(value, (int, float)) and not isinstance(value, bool)
            and math.isfinite(value) and (value > 0 if positive else value >= 0)
        )
    except OverflowError:
        return False


def capture_context_snapshot(
    status: Dict[str, Any], model: Optional[str],
) -> Optional[Dict[str, Any]]:
    """Allowlist server event fields; never persist prompt or arbitrary metadata."""
    if not isinstance(status, dict):
        return None
    name = status.get("model") or model
    if not isinstance(name, str) or not name or len(name) > 256:
        return None
    used, budget = status.get("used"), status.get("budget")
    if not _number(used) or not _number(budget, positive=True):
        return None
    percent = used / budget * 100
    if not _number(percent):
        return None
    state = status.get("state")
    states = {"normal": "OK", "warning": "WARNING", "error": "ERROR",
              "critical": "ERROR", "overflow": "ERROR",
              "OK": "OK", "WARNING": "WARNING", "ERROR": "ERROR"}
    snapshot = {
        "model": name,
        "state": states.get(state, "OK") if isinstance(state, str) else "OK",
        "used_tokens": used,
        "max_tokens": budget,
        "usage_percent": percent,
        "measured_at": int(time.time() * 1000),
        "layer": None,
    }
    for source, target in (("context_window", "context_window"),
                           ("reserved_tokens", "reserved_tokens")):
        if _number(status.get(source)):
            snapshot[target] = status[source]
    for source, target in (("compact_layer", "layer"), ("window_source", "window_source")):
        value = status.get(source)
        if isinstance(value, str) and len(value) <= 128:
            snapshot[target] = value
    return snapshot


def snapshot_payload(value: Any) -> Dict[str, Any]:
    """Return independent, allowlisted copies for persisted turn envelopes."""
    if not isinstance(value, dict):
        return {}
    result = {}
    for model, item in value.items():
        if not isinstance(item, dict) or model != item.get("model"):
            continue
        normalized = capture_context_snapshot({
            "used": item.get("used_tokens"), "budget": item.get("max_tokens"),
            "state": item.get("state"), "model": model,
            "context_window": item.get("context_window"),
            "reserved_tokens": item.get("reserved_tokens"),
            "compact_layer": item.get("layer"), "window_source": item.get("window_source"),
        }, model)
        if normalized and _number(item.get("measured_at"), positive=True):
            normalized["measured_at"] = item["measured_at"]
            result[model] = normalized
    return result
