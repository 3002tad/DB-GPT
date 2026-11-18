"""Recover a turn's persisted model without stamping the server default on it."""

import json
import math
from typing import Any, Optional


def _model(value: Any) -> Optional[str]:
    if isinstance(value, str) and 0 < len(value.strip()) <= 256:
        return value.strip()
    return None


def history_message_model(message: Any) -> Optional[str]:
    """Prefer explicit turn metadata; old ReAct turns have measured snapshots."""
    extra = getattr(message, "additional_kwargs", None)
    if isinstance(extra, dict) and (name := _model(extra.get("model_name"))):
        return name
    if getattr(message, "type", None) != "view":
        return None
    content = getattr(message, "content", None)
    try:
        payload = json.loads(content) if isinstance(content, str) else content
    except (ValueError, TypeError):
        return None
    if not isinstance(payload, dict) or payload.get("type") != "react-agent":
        return None
    if name := _model(payload.get("model_name")):
        return name
    snapshots = payload.get("context_snapshots")
    if not isinstance(snapshots, dict):
        return None
    measured = []
    for key, value in snapshots.items():
        if not isinstance(value, dict) or value.get("model") != key:
            continue
        stamp = value.get("measured_at")
        if (
            _model(key)
            and isinstance(stamp, (int, float))
            and not isinstance(stamp, bool)
            and math.isfinite(stamp)
            and stamp > 0
        ):
            measured.append((stamp, key))
    return max(measured)[1] if measured else None
