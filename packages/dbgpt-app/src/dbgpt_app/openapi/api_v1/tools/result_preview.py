"""Bounded, JSON-valid views of captured results; never fabricate omitted data."""

import json

from dbgpt.core.interface.report_capture import normalize_artifact_value


def result_preview(value, *, max_chars=12000):
    """Expose small structured results directly, with explicit omission markers.

    Large tables still live in their full artifacts. This is a model-facing
    preview, not a replacement for capture or an analytical recomputation.
    """
    value = normalize_artifact_value(value)
    budget = max_chars
    truncated = False

    def visit(item, depth=0):
        nonlocal budget, truncated
        encoded = json.dumps(item, ensure_ascii=False, allow_nan=False)
        if len(encoded) <= budget:
            budget -= len(encoded)
            return item
        truncated = True
        if depth >= 8 or budget < 100:
            return {"__omitted__": True}
        if isinstance(item, dict):
            result = {}
            for key, child in item.items():
                if budget < len(key) + 100:
                    result["__preview_omitted_fields__"] = len(item) - len(result)
                    break
                budget -= len(key) + 5
                result[key] = visit(child, depth + 1)
            return result
        if isinstance(item, list):
            result = []
            for child in item:
                if budget < 100:
                    result.append({"__preview_omitted_items__": len(item) - len(result)})
                    break
                budget -= 2
                result.append(visit(child, depth + 1))
            return result
        return {"__omitted__": True}

    return {"value": visit(value), "truncated": truncated,
            "meaning": "captured_producer_result_not_a_certified_metric"}
