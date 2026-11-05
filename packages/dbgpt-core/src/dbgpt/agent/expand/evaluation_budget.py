"""Optional limits for paid evaluation turns of the main native-tool agent.

Usage is provider reported after each call. A call already in flight can exceed
the token threshold, and independently dispatched subagents are not counted.
"""

from typing import Any, Dict


def configure_evaluation_budget(state: Dict[str, Any], config: Any) -> None:
    """Install an opt-in budget; an absent budget leaves normal turns unchanged."""
    if config is None:
        return
    if not isinstance(config, dict) or not config:
        raise ValueError("evaluation_budget must be a non-empty object")
    allowed = {"max_model_calls", "max_provider_tokens"}
    if set(config) - allowed:
        raise ValueError("Unknown evaluation_budget field")
    for name, value in config.items():
        if isinstance(value, bool) or not isinstance(value, int) or value < 1:
            raise ValueError(f"evaluation_budget.{name} must be a positive integer")
    state["_evaluation_budget"] = {
        **config,
        "calls": 0,
        "provider_tokens": 0,
        "usage_unknown": False,
    }


def before_model_call(state: Dict[str, Any]) -> None:
    budget = state.get("_evaluation_budget")
    if not budget:
        return
    if (
        budget.get("max_model_calls") is not None
        and budget["calls"] >= budget["max_model_calls"]
    ):
        raise ValueError("AGENT_EVALUATION_BUDGET: model call limit reached")
    if budget.get("max_provider_tokens") is not None:
        if budget["usage_unknown"]:
            raise ValueError("AGENT_EVALUATION_BUDGET: provider usage unavailable")
        if budget["provider_tokens"] >= budget["max_provider_tokens"]:
            raise ValueError("AGENT_EVALUATION_BUDGET: provider token limit reached")
    budget["calls"] += 1


def record_model_usage(state: Dict[str, Any], usage: Any) -> None:
    budget = state.get("_evaluation_budget")
    if not budget or budget.get("max_provider_tokens") is None:
        return
    total = usage.get("total_tokens") if isinstance(usage, dict) else None
    if isinstance(total, bool) or not isinstance(total, int) or total < 0:
        budget["usage_unknown"] = True
    else:
        budget["provider_tokens"] += total
