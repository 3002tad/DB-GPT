"""Regression tests for a repeated completed plan and opt-in evaluation budgets."""

import asyncio
import json
import os
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from dbgpt.agent.core.action.base import ActionOutput
from dbgpt.agent.core.agent import AgentContext, AgentMessage
from dbgpt.agent.expand.evaluation_budget import (
    before_model_call,
    configure_evaluation_budget,
    record_model_usage,
)
from dbgpt.agent.expand.tool_calling_agent import ToolCallingReActAgent
from dbgpt.agent.expand.model_progress import model_call_started, model_progress
from dbgpt.agent.expand.tool_recovery import (
    observe_action_results, observe_tool_result, repeated_failure,
)
from dbgpt_app.openapi.api_v1.tools.todowrite import make_todowrite


class AgentEvaluationLimitsTest(unittest.TestCase):
    def test_advisory_estimate_and_tool_local_recovery(self):
        state, plan = {}, []
        todo = make_todowrite(plan, lambda *_: None, state)
        schema = todo._tool.parameters_schema()
        self.assertIn("estimated_model_calls", schema["properties"])
        self.assertNotIn("estimated_model_calls", schema["required"])
        todo(json.dumps([{"content": "inspect", "status": "in_progress"}]), estimated_model_calls=2)
        self.assertEqual(model_progress(state), {"calls": 0, "estimated_calls": 2})
        query = "SELECT missing"
        model_call_started(state)
        self.assertIsNone(observe_tool_result(state, "sql_query", query, success=False, error_code="SQL_UNDEFINED_TABLE"))
        self.assertIsNotNone(observe_tool_result(state, "sql_query", query, success=False, error_code="SQL_UNDEFINED_TABLE"))
        self.assertTrue(repeated_failure(state, "sql_query", query))
        self.assertFalse(repeated_failure(state, "sql_query", "SELECT other"))
        self.assertIsNone(observe_tool_result(state, "sql_query", "SELECT other", success=True))
        self.assertFalse(repeated_failure(state, "sql_query", query))
        todo(json.dumps([{"content": "inspect", "status": "in_progress"}]), estimated_model_calls=8)
        self.assertEqual(model_progress(state), {"calls": 1, "estimated_calls": 8})

    def test_batch_recovery_is_per_tool_and_does_not_stop_agent(self):
        state = {}
        calls = [
            {"function": {"name": "kb_cat", "arguments": '{"path":"missing"}'}},
            {"function": {"name": "other", "arguments": '{}'}},
        ]
        results = json.dumps([
            {"success": False, "content": '{"error_code":"NOT_FOUND"}'},
            {"success": True, "content": "ok"},
        ])
        self.assertEqual(observe_action_results(state, calls, results, False), [])
        signals = observe_action_results(state, calls, results, False)
        self.assertEqual(signals[0]["tool"], "kb_cat")
        self.assertEqual(signals[0]["reason"], "same_call_failed")
        self.assertEqual(observe_action_results(state, calls, json.dumps([
            {"success": True, "content": "found"},
            {"success": True, "content": "ok"},
        ]), True), [])

    def test_repeated_tool_failure_adds_advice_without_terminating_agent(self):
        state = {}
        calls = [{"function": {"name": "kb_cat", "arguments": '{"path":"missing"}'}}]
        agent = SimpleNamespace(_report_repair_state=state, _pending_native_tool_calls=calls, agent_context=None)
        for _ in range(2):
            message = AgentMessage(content="query")
            output = ToolCallingReActAgent._apply_report_result(
                agent, ActionOutput(is_exe_success=False, content="NOT_FOUND"), message, 0
            )
        self.assertIn("Tool recovery", output.content)
        self.assertTrue(output.have_retry)
        self.assertNotIn("execution_status", message.get_dict_context())

    def test_model_call_progress_event_does_not_depend_on_budget(self):
        events = []

        async def callback(payload):
            events.append(payload)

        async def call(**_kwargs):
            return SimpleNamespace(has_text=False, text="", tool_calls=[], usage=None)

        agent = SimpleNamespace(
            _report_repair_state={}, _build_native_tools=lambda: [],
            _a_select_llm_model=lambda _: asyncio.sleep(0, result="model"),
            llm_client=SimpleNamespace(create_with_output=call),
            not_null_agent_context=SimpleNamespace(max_new_tokens=300, temperature=0, verbose=False, conv_id="test"),
            memory=SimpleNamespace(gpts_memory=None), stream_out=False,
        )
        asyncio.run(ToolCallingReActAgent._thinking_native(
            agent, [AgentMessage(role="human", content="test")], stream_callback=callback
        ))
        self.assertEqual(events, [{"model_progress": {"calls": 1, "estimated_calls": None}}])

    @unittest.skipUnless(os.getenv("FUNNELMETRY_Q08_TRACE"), "Q08 trace not provided")
    def test_saved_q08_plan_updates_detect_only_the_repeated_reset_run(self):
        for path, expected_stall in (
            (os.environ["FUNNELMETRY_Q08_TRACE"], True),
            (os.environ["FUNNELMETRY_Q08_BASELINE_TRACE"], False),
        ):
            state, plan = {}, []
            repeated_resets = 0
            tool = make_todowrite(plan, lambda *_: None, state)
            with open(path, encoding="utf-8") as stream:
                for line in stream:
                    if not line.startswith("data:"):
                        continue
                    try:
                        event = json.loads(line[5:].strip())
                    except json.JSONDecodeError:
                        continue
                    if event.get("type") == "plan.update":
                        result = json.loads(tool(json.dumps(event["tasks"])))
                        if result.get("error_code") == "PLAN_ALREADY_COMPLETE":
                            repeated_resets += 1
            self.assertEqual(repeated_resets >= 2, expected_stall)

    def test_completed_plan_reset_suggests_recovery_and_retains_evidence(self):
        state, plan = {}, []
        tool = make_todowrite(plan, lambda *_: None, state)
        completed = [{"content": f"task {i}", "status": "completed"} for i in range(7)]
        reset = [{"content": f"task {i}", "status": "in_progress" if i == 0 else "pending"} for i in range(7)]
        tool(json.dumps(completed))
        first = json.loads(tool(json.dumps(reset)))
        self.assertEqual(first["error_code"], "PLAN_ALREADY_COMPLETE")
        self.assertIn("already complete", first["chunks"][0]["content"])
        self.assertTrue(all(item["status"] == "completed" for item in plan))
        self.assertNotIn("_completed_plan_stalled", state)
        second = json.loads(tool(json.dumps(reset)))
        self.assertEqual(second["tool_recovery"]["attempts"], 2)
        message = AgentMessage(content="todowrite")
        agent = SimpleNamespace(_report_repair_state=state, agent_context=AgentContext(conv_id="test"))
        output = ToolCallingReActAgent._apply_report_result(
            agent, ActionOutput(content="tool response"), message, 0
        )
        self.assertTrue(output.have_retry)
        self.assertNotIn("AGENT_PLAN_STALLED", output.content)
        self.assertTrue(all(item["status"] == "completed" for item in plan))

    def test_different_or_partial_revision_is_permitted(self):
        state, plan = {}, []
        tool = make_todowrite(plan, lambda *_: None, state)
        tool(json.dumps([{"content": "A", "status": "completed"}, {"content": "B", "status": "completed"}]))
        tool(json.dumps([{"content": "A", "status": "completed"}, {"content": "B", "status": "in_progress"}]))
        self.assertEqual(plan[1]["status"], "in_progress")
        tool(json.dumps([{"content": "C", "status": "in_progress"}]))
        self.assertEqual(plan[0]["content"], "C")
        self.assertFalse(state.get("_completed_plan_stalled"))

    def test_opt_in_budget_stops_before_next_call_and_handles_unknown_usage(self):
        state = {}
        configure_evaluation_budget(state, {"max_model_calls": 3, "max_provider_tokens": 100})
        before_model_call(state)
        record_model_usage(state, {"total_tokens": 120})
        with self.assertRaisesRegex(ValueError, "token limit"):
            before_model_call(state)
        state = {}
        configure_evaluation_budget(state, {"max_model_calls": 2, "max_provider_tokens": 100})
        before_model_call(state)
        record_model_usage(state, None)
        with self.assertRaisesRegex(ValueError, "usage unavailable"):
            before_model_call(state)
        state = {}
        configure_evaluation_budget(state, {"max_model_calls": 1})
        before_model_call(state)
        with self.assertRaisesRegex(ValueError, "call limit"):
            before_model_call(state)
        before_model_call({})
        with self.assertRaises(ValueError):
            configure_evaluation_budget({}, {"max_model_calls": True})

    def test_native_call_records_provider_usage_before_next_turn(self):
        state = {}
        configure_evaluation_budget(state, {"max_model_calls": 2, "max_provider_tokens": 100})
        count = []

        async def call(**_kwargs):
            count.append(1)
            return SimpleNamespace(has_text=False, text="", tool_calls=[], usage={"total_tokens": 120})

        agent = SimpleNamespace(
            _report_repair_state=state, _build_native_tools=lambda: [],
            _a_select_llm_model=lambda _: asyncio.sleep(0, result="model"),
            llm_client=SimpleNamespace(create_with_output=call),
            not_null_agent_context=SimpleNamespace(max_new_tokens=300, temperature=0, verbose=False, conv_id="test"),
            memory=SimpleNamespace(gpts_memory=None), stream_out=False,
        )
        messages = [AgentMessage(role="human", content="test")]
        asyncio.run(ToolCallingReActAgent._thinking_native(agent, messages))
        with self.assertRaisesRegex(ValueError, "token limit"):
            asyncio.run(ToolCallingReActAgent._thinking_native(agent, messages))
        self.assertEqual(len(count), 1)


class AgentDisconnectTest(unittest.IsolatedAsyncioTestCase):
    async def test_http_disconnect_cancels_agent_work(self):
        from dbgpt_app.openapi.api_v1 import agentic_data_api as api

        started, stopped, sent = asyncio.Event(), asyncio.Event(), asyncio.Event()
        never = asyncio.Event()
        tasks = []

        async def agent_work():
            started.set()
            try:
                await never.wait()
            finally:
                stopped.set()

        async def stream_impl(dialogue, tool_mode="full", agent_task_holder=None, attachment_ctx=None):
            task = asyncio.create_task(agent_work())
            tasks.append(task)
            agent_task_holder.append(task)
            await started.wait()
            yield api._sse_event({"type": "step", "content": "first"})
            await never.wait()

        async def send(message):
            if message["type"] == "http.response.body" and message.get("more_body"):
                sent.set()
                await never.wait()

        async def receive():
            await sent.wait()
            return {"type": "http.disconnect"}

        with patch.object(api, "_react_agent_stream_impl", stream_impl):
            response = api._AgentStreamingResponse(
                api._react_agent_stream(SimpleNamespace()), media_type="text/event-stream"
            )
            scope = {"type": "http", "method": "POST", "path": "/v1/chat/react-agent",
                     "headers": [], "asgi": {"version": "3.0", "spec_version": "2.0"}}
            await asyncio.wait_for(response(scope, receive, send), timeout=2)
        self.assertEqual(len(tasks), 1)
        self.assertTrue(tasks[0].cancelled())
        self.assertTrue(stopped.is_set())


if __name__ == "__main__":
    unittest.main()
