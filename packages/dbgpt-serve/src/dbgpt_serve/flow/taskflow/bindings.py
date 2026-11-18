"""Resolve datasource bindings for one run without mutating a saved flow."""

from copy import deepcopy
from typing import Any, Dict, List, Optional


def bind_taskflow_datasource(
    source: Dict[str, Any], database_name: Optional[str]
) -> Dict[str, Any]:
    """An explicit composer selection replaces database bindings for this run.

    Without a selection, retain the flow's configured (including multi-DB)
    bindings. Never rewrite the template, saved DSL or shared cached DAG.
    """
    result = deepcopy(source)
    if database_name is None:
        return result
    if not isinstance(database_name, str) or not database_name.strip():
        raise ValueError("A non-empty datasource name is required")
    database_name = database_name.strip()
    for node in result.get("nodes", []):
        config = node.setdefault("config", {})
        if node.get("kind") == "agent":
            tools = config.get("tools") or []
            if "datasources" in config or "sql_query" in tools or any(
                tool.startswith("semantic_") for tool in tools
            ):
                config["datasources"] = [database_name]
        elif node.get("kind") in {"db_query", "visualize"}:
            # A file-only visualization must stay file-only.
            if node["kind"] == "db_query" or config.get("datasource"):
                config["datasource"] = database_name
    return result


def taskflow_datasources(source: Dict[str, Any]) -> List[str]:
    """Return all database resources that will be compiled into the run."""
    sources = []
    for node in source.get("nodes", []):
        config = node.get("config") or {}
        if node.get("kind") == "agent":
            sources.extend(config.get("datasources") or [])
        elif node.get("kind") in {"db_query", "visualize"}:
            if config.get("datasource"):
                sources.append(config["datasource"])
    return list(dict.fromkeys(sources))
