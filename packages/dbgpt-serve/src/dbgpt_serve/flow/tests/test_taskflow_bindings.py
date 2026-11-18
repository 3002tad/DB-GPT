"""RUN18-01: request source must reach every compiled SQL node."""

import asyncio
import json
import os
import unittest
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, PropertyMock, patch

from fastapi import HTTPException

from dbgpt.core.awel import CommonLLMHttpRequestBody
from dbgpt.core.awel.flow.flow_factory import FlowFactory, FlowPanel
from dbgpt_app.operators.taskflow_agent import TFAgentOperator
from dbgpt_serve.flow.service import service as flow_service
from dbgpt_serve.flow.taskflow.bindings import (
    bind_taskflow_datasource,
    taskflow_datasources,
)


def template():
    path = Path(__file__).parents[1] / "templates/en/taskflow-db-fetch-template.json"
    return json.loads(path.read_text(encoding="utf-8"))["flow"]


class BindingTest(unittest.TestCase):
    def test_saved_template_is_unchanged_and_all_agents_are_rebound(self):
        source = template()["taskflow_source"]
        before = deepcopy(source)
        bound = bind_taskflow_datasource(source, "funnelmetry_handoff")
        self.assertEqual(["funnelmetry_handoff"], taskflow_datasources(bound))
        self.assertEqual(source, before)
        self.assertEqual(["Walmart_Sales"], taskflow_datasources(source))
        self.assertEqual(3, sum(n["kind"] == "agent" for n in bound["nodes"]))

    def test_multi_db_defaults_and_non_database_resources_are_preserved(self):
        source = {"nodes": [
            {"kind": "agent", "config": {"datasources": ["a", "b"], "skills": ["csv"]}},
            {"kind": "db_query", "config": {"datasource": "a"}},
            {"kind": "visualize", "config": {"datasource": "b"}},
            {"kind": "visualize", "config": {"max_charts": 2}},
            {"kind": "agent", "config": {"tools": ["web_fetch"]}},
        ]}
        self.assertEqual(source, bind_taskflow_datasource(source, None))
        bound = bind_taskflow_datasource(source, "selected")
        self.assertEqual(["selected"], taskflow_datasources(bound))
        self.assertEqual(["csv"], bound["nodes"][0]["config"]["skills"])
        self.assertEqual(source["nodes"][3:], bound["nodes"][3:])

    def test_invalid_selection_never_falls_back_to_sample(self):
        for invalid in ("", "  ", 42, ["a"]):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                bind_taskflow_datasource(template()["taskflow_source"], invalid)


class RunBindingTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.flow = FlowPanel(**template())
        self.service = SimpleNamespace(
            get=Mock(return_value=self.flow),
            _system_app=None,
            _flow_factory=FlowFactory(),
        )
        self.service._maybe_compile_taskflow = lambda flow: (
            flow_service.Service._maybe_compile_taskflow(self.service, flow)
        )
        config = patch.object(flow_service, "CFG", SimpleNamespace(local_db_manager=Mock()))
        config.start()
        self.addCleanup(config.stop)

    def request(self, name):
        return CommonLLMHttpRequestBody(
            model="test", messages="SELECT COUNT(*) FROM funnelmetry_demo.sessions",
            user_name="analyst", conv_uid=f"binding-{name}",
            extra={"database_name": name},
        )

    async def test_real_compiled_workflow_uses_selected_source_in_every_agent(self):
        observed = []

        async def agent(**kwargs):
            # Unlike SELECT 2+3, this must be dispatched to the requested DB.
            self.assertEqual(["funnelmetry_handoff"], kwargs["datasources"])
            self.assertIn("funnelmetry_demo.sessions", kwargs["question"])
            observed.append(kwargs["datasources"])
            return "fixture source=funnelmetry_handoff; total_sessions=17"

        async def execute(_app, function, *args):
            return function(*args)

        with (
            patch.dict(os.environ, {"DBGPT_PIPELINE_IDENTITY_URL": "http://pipeline"}),
            patch("dbgpt_app.pipeline_datasource.PipelineDataSourcePolicy.can_query", return_value=True) as permission,
            patch.object(flow_service, "blocking_func_to_async", side_effect=execute),
            patch("dbgpt_app.operators.taskflow_agent.run_react_agent", side_effect=agent),
            patch.object(TFAgentOperator, "llm_client", new_callable=PropertyMock),
        ):
            task = await flow_service.Service._get_callable_task(
                self.service, "saved-template", self.request("funnelmetry_handoff")
            )
            result = await task.call(call_data=self.request("funnelmetry_handoff").model_dump())
        self.assertEqual(3, len(observed))
        self.assertIn("total_sessions=17", result)
        permission.assert_called_once_with("analyst", "funnelmetry_handoff")
        self.assertEqual(["Walmart_Sales"], taskflow_datasources(self.flow.taskflow_source))

    async def test_parallel_run_graphs_do_not_leak_selection(self):
        built = []

        async def execute(_app, function, flow):
            await asyncio.sleep(0)
            built.append(flow)
            return SimpleNamespace(leaf_nodes=[object()])

        with (
            patch.dict(os.environ, {"DBGPT_PIPELINE_IDENTITY_URL": ""}),
            patch.object(flow_service, "blocking_func_to_async", side_effect=execute),
        ):
            tasks = await asyncio.gather(*(
                flow_service.Service._get_callable_task(self.service, "same", self.request(name))
                for name in ("source_a", "source_b")
            ))
        self.assertIsNot(tasks[0], tasks[1])
        self.assertEqual([["source_a"], ["source_b"]], [taskflow_datasources(f.taskflow_source) for f in built])
        self.assertEqual(["Walmart_Sales"], taskflow_datasources(self.flow.taskflow_source))

    async def test_unavailable_source_is_rejected_before_build(self):
        for name in ("Walmart_Sales", None):
            request = self.request(name)
            with (
                patch.dict(os.environ, {"DBGPT_PIPELINE_IDENTITY_URL": "http://pipeline"}),
                patch("dbgpt_app.pipeline_datasource.PipelineDataSourcePolicy.can_query", return_value=False),
                patch.object(flow_service, "blocking_func_to_async", new=AsyncMock()) as build,
            ):
                with self.assertRaises(HTTPException) as error:
                    await flow_service.Service._get_callable_task(self.service, "saved", request)
                self.assertEqual(403, error.exception.status_code)
                build.assert_not_called()


if __name__ == "__main__":
    unittest.main()
