"""Display-safe resource selections persisted with each owned conversation turn."""

from typing import Any, Dict

RESOURCE_KEYS = (
    "database_name", "database_type", "knowledge_space_name", "knowledge_space_id",
    "skill_name", "skill_id",
)


def resource_context_snapshot(ext_info: Any) -> Dict[str, Any]:
    # An explicit empty selection is meaningful: do not inherit an older turn.
    source = ext_info if isinstance(ext_info, dict) else {}
    source = dict(source)
    if not source.get("knowledge_space_name") and isinstance(source.get("knowledge_space"), str):
        source["knowledge_space_name"] = source["knowledge_space"]
    result = {key: None for key in RESOURCE_KEYS}
    for key in RESOURCE_KEYS:
        value = source.get(key)
        if isinstance(value, str) and 0 < len(value) <= 256:
            result[key] = value
        elif key.endswith("_id") and type(value) is int and value > 0:
            result[key] = value
    return result
