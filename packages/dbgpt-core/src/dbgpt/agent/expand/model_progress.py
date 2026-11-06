"""Advisory model-call progress; estimates never constrain execution."""

from typing import Any, Dict


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
