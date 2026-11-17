"""Verify semantic tool calls and native suite gates without an LLM."""

import asyncio
import ast
import json
import os
from pathlib import Path

from dbgpt_app.openapi.api_v1.suite_binder import (
    SuiteBinding,
    canonical_suite_tool,
)
from dbgpt_app.openapi.api_v1.tools.semantic_tools import make_semantic_tools
from dbgpt.agent.resource.tool.base import tool
from dbgpt.agent.resource.tool.pack import ToolPack


class Reader:
    def get_metric(self, **kwargs):
        return {"status": "ok", "metric": kwargs}


def _initial_tool_names(**overrides):
    """Execute the real discovery setup with real ToolPack, without booting LLM/DB.

    Read the candidate source explicitly when testing alongside an older image.
    This exercises the crashing production branch rather than a copied helper.
    """
    source = Path(os.environ.get("E2E01_AGENT_SOURCE", str(
        Path(__file__).parents[1] / "openapi/api_v1/agentic_data_api.py"
    )))
    tree = ast.parse(source.read_text(encoding="utf-8"))
    branch = next(node for node in ast.walk(tree) if isinstance(node, ast.If)
                  and any(isinstance(child, ast.Assign)
                          and any(isinstance(target, ast.Name) and target.id == "initial_names"
                                  for target in child.targets) for child in node.body))
    start = next(i for i, child in enumerate(branch.body) if isinstance(child, ast.Assign)
                 and any(isinstance(target, ast.Name) and target.id == "initial_names"
                         for target in child.targets))
    end = next(i for i, child in enumerate(branch.body) if isinstance(child, ast.Assign)
               and any(isinstance(target, ast.Name) and target.id == "greeting"
                       for target in child.targets))
    context = dict(ToolPack=ToolPack, BASE_TOOLS={"terminate"},
                   database_connector=None, semantic_tool_list=[], knowledge_space=None,
                   kb_tool_list=[], react_state={}, connector_tool_extras=[])
    context.update(overrides)
    exec(compile(ast.Module(body=branch.body[start:end], type_ignores=[]), str(source), "exec"), context)
    return context["initial_names"]


def test_native_discovery_accepts_decorated_semantic_functions():
    tools = make_semantic_tools("orders_db", reader=Reader())
    assert all(callable(item) and not hasattr(item, "name") for item in tools)
    names = _initial_tool_names(database_connector=object(), semantic_tool_list=tools)
    assert names == {"terminate", "sql_query", *(item._tool.name for item in tools)}
    # Registration preserves the schema and the original executable resource.
    catalog = ToolPack(tools).sub_resources
    assert {item.name for item in catalog} <= names
    assert len(catalog) == 4
    assert catalog[3] is tools[3]._tool
    assert json.loads(asyncio.run(tools[3](metric_id=7, version=2)))["metric"]["version"] == 2


def test_native_discovery_combines_kb_semantic_and_connector_resources():
    @tool("kb_fixture", description="Read a test knowledge resource.")
    def kb_fixture(query: str) -> str:
        return query

    semantic = make_semantic_tools("orders_db")
    names = _initial_tool_names(database_connector=object(), semantic_tool_list=semantic,
                                knowledge_space="fixture", kb_tool_list=[kb_fixture],
                                connector_tool_extras=[kb_fixture._tool])
    assert names == {"terminate", "sql_query", "kb_fixture", *(item._tool.name for item in semantic)}


def test_native_discovery_keeps_no_database_and_kb_only_modes():
    assert _initial_tool_names() == {"terminate"}
    tools = make_semantic_tools("orders_db")
    # Already normalized resources remain accepted as well as decorated functions.
    names = _initial_tool_names(database_connector=object(), semantic_tool_list=ToolPack(tools).sub_resources)
    assert {item._tool.name for item in tools} <= names
    assert _initial_tool_names(knowledge_space="fixture") == {"terminate"}


def test_tool_factory_binds_database_and_preserves_version_arguments():
    assert make_semantic_tools(None) == []
    tools = make_semantic_tools("orders_db", reader=Reader())
    names = [t._tool.name for t in tools]
    assert names == [
        "semantic_get_metadata",
        "semantic_search_business",
        "semantic_search_metrics",
        "semantic_get_metric",
    ]
    loop = asyncio.new_event_loop()
    try:
        result = json.loads(loop.run_until_complete(tools[3](metric_id=7, version=2)))
    finally:
        loop.close()
    assert result["metric"] == {"metric_id": 7, "metric_name": "", "version": 2}
    assert "database_name" not in tools[3]._tool.args
    assert "ds_id" not in tools[3]._tool.args


def test_native_query_and_analysis_suites_allow_all_semantic_reads():
    root = Path(__file__).resolve().parents[5] / "assets" / "suites"
    for slug in ("db-query", "db-analysis"):
        manifest = json.loads(
            (root / slug / ".dbgpt-plugin" / "plugin.json").read_text()
        )
        binding = SuiteBinding(
            name=slug,
            version=manifest["version"],
            allow={
                canonical_suite_tool(n) for n in manifest["dbgpt"]["tools"]["allow"]
            },
        )
        for t in make_semantic_tools("orders_db"):
            assert binding.violation(t._tool.name) is None
        assert binding.violation("bash") is not None


def test_pi_manifest_includes_semantic_tools_only_for_loaded_database(monkeypatch):
    from dbgpt_app.agent_harness.pi import tool_bridge
    from dbgpt_app.openapi.api_v1.subagent import react_tools
    from dbgpt_serve.datasource.manages import ConnectorManager

    class Manager:
        def get_connector(self, name):
            assert name == "orders_db"
            return object()

    monkeypatch.setattr(ConnectorManager, "get_instance", lambda app: Manager())
    monkeypatch.setattr(react_tools, "make_react_tools", lambda *a, **kw: {})
    monkeypatch.setattr(tool_bridge, "_skill_tools", lambda *a, **kw: [])
    try:
        manifest = tool_bridge.register_conv_tools(
            "semantic-test", {"database_name": "orders_db"}, object()
        )
        semantic = [t for t in manifest if t["name"].startswith("semantic_")]
        assert len(semantic) == 4
        for t in semantic:
            assert "database_name" not in t["parameters"]["properties"]
            assert "ds_id" not in t["parameters"]["properties"]
        manifest = tool_bridge.register_conv_tools("semantic-test", {}, object())
        assert not any(t["name"].startswith("semantic_") for t in manifest)
    finally:
        tool_bridge._REGISTRY.pop("semantic-test", None)
