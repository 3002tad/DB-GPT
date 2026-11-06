"""Regression checks for malformed native tool calls and model selection."""

import asyncio
import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from dbgpt.agent.core.agent import AgentContext, AgentMessage
from dbgpt.agent.core.action.base import ActionOutput
from dbgpt.agent.core.base_agent import ConversableAgent
from dbgpt.agent.expand.tool_calling_agent import ToolCallingReActAgent
from dbgpt.agent.expand.actions.tool_action import ToolCallSpec, run_tools_batch
from dbgpt.agent.expand.tool_recovery import observe_tool_result
from dbgpt.agent.util.llm.llm import LLMStrategyType


class NativeRecoveryTest(unittest.TestCase):
    def test_repeated_kb_failure_skips_only_identical_read_call(self):
        state = {}
        for _ in range(2):
            observe_tool_result(state, "knowledge_retrieve", {"query": "missing"},
                                success=False, error_code="KNOWLEDGE_RETRIEVAL_FAILED")
        calls = []

        async def fake_run_tool(name, args, *_positional, **_kwargs):
            calls.append((name, args))
            return ActionOutput(content="found", is_exe_success=True)

        with patch("dbgpt.agent.expand.actions.tool_action.run_tool", fake_run_tool):
            result = asyncio.run(run_tools_batch([
                ToolCallSpec(name="knowledge_retrieve", args={"query": "missing"}),
                ToolCallSpec(name="knowledge_retrieve", args={"query": "changed"}),
            ], resource=None, recovery_state=state))
        rows = json.loads(result.observations)
        self.assertEqual(rows[0]["success"], False)
        self.assertEqual(json.loads(rows[0]["content"])["error_code"],
                         "TOOL_REPEATED_FAILURE")
        self.assertEqual(rows[1]["success"], True)
        self.assertEqual(calls, [("knowledge_retrieve", {"query": "changed"})])

    def test_batch_keeps_distinct_observation_without_repeating_equal_content(self):
        async def fake_run_tool(name, *_args, **_kwargs):
            if name == "preview":
                return ActionOutput(content="preview", observations="full evidence",
                                    persisted_path="/tmp/evidence", is_exe_success=True)
            return ActionOutput(content="104", observations="104",
                                is_exe_success=True)

        with patch("dbgpt.agent.expand.actions.tool_action.run_tool", fake_run_tool):
            result = asyncio.run(run_tools_batch(
                [ToolCallSpec(name="count", args={}),
                 ToolCallSpec(name="preview", args={})],
                resource=None,
            ))
        rows = json.loads(result.observations)
        self.assertEqual(rows[0]["content"], "104")
        self.assertNotIn("observation", rows[0])
        self.assertEqual(rows[1]["content"], "preview")
        self.assertEqual(rows[1]["observation"], "full evidence")

    def test_repeated_incomplete_sql_suggests_recovery_without_stopping(self):
        state = {}
        agent = SimpleNamespace(
            _report_repair_state=state,
            _pending_native_tool_calls=None,
            agent_context=AgentContext(
                conv_id="test-conversation", enable_native_function_calling=True
            ),
        )
        reason = 'sql_query requires a non-empty SQL string. Retry with {"sql":"SELECT ..."}.'
        first = ToolCallingReActAgent._apply_report_result(
            agent, ActionOutput(content=reason, is_exe_success=False),
            AgentMessage(content="Action: sql_query"), 0,
        )
        self.assertTrue(first.have_retry)
        self.assertTrue(state["_native_retry_requires_tool_call"])
        ToolCallingReActAgent._apply_report_result(
            agent, ActionOutput(content="SQL result", is_exe_success=True),
            AgentMessage(content=""), 0,
        )
        self.assertEqual(state["_native_invalid_call_count"], 0)
        self.assertFalse(state["_native_retry_requires_tool_call"])
        ToolCallingReActAgent._apply_report_result(
            agent, ActionOutput(content=reason, is_exe_success=False),
            AgentMessage(content="Action: sql_query"), 0,
        )
        message = AgentMessage(content="Action: sql_query")
        second = ToolCallingReActAgent._apply_report_result(
            agent, ActionOutput(content=reason, is_exe_success=False), message, 0,
        )
        self.assertTrue(second.have_retry)
        self.assertIn("AGENT_TOOL_CALL_RECOVERY", second.content)
        self.assertEqual(message.content, "Action: sql_query")

    def test_native_retry_repair_omits_empty_assistant(self):
        state = {"_native_retry_requires_tool_call": True}
        captured = {}

        async def create_with_output(**kwargs):
            captured.update(kwargs)
            return SimpleNamespace(has_text=False, text="", tool_calls=[
                {"function": {"name": "terminate", "arguments": '{"output":"done"}'}}
            ])

        agent = SimpleNamespace(
            _report_repair_state=state,
            _build_native_tools=lambda: [{"type": "function"}],
            _a_select_llm_model=lambda _excluded: asyncio.sleep(0, result="qwen3.5-flash"),
            llm_client=SimpleNamespace(create_with_output=create_with_output),
            not_null_agent_context=SimpleNamespace(max_new_tokens=300,
                temperature=0, verbose=False, conv_id="test-conversation"),
            memory=SimpleNamespace(gpts_memory=None),
            stream_out=False,
        )
        messages = [AgentMessage(role="system", content="instructions"),
                    AgentMessage(role="ai", content=""),
                    AgentMessage(role="human", content="finish")]
        text, model = asyncio.run(ToolCallingReActAgent._thinking_native(
            agent, messages
        ))
        self.assertEqual((text, model), ("", "qwen3.5-flash"))
        self.assertEqual(captured["tool_choice"], "auto")
        self.assertIn("previous action was rejected", captured["messages"][-1]["content"])
        self.assertNotIn("", [m.get("content") for m in captured["messages"]])

    def test_selected_model_remains_pinned_on_retry(self):
        class FakeAgent:
            _excluded_models = ConversableAgent._excluded_models

            def __init__(self):
                self.role = "test-agent"
                self.not_null_agent_context = SimpleNamespace(pin_selected_model=True)
                self.not_null_llm_config = SimpleNamespace(
                    llm_strategy=LLMStrategyType.Priority,
                    strategy_context=json.dumps(["qwen3.5-flash"]),
                )
                self.not_null_llm_client = SimpleNamespace(
                    models=lambda: asyncio.sleep(0, result=[
                        SimpleNamespace(model="qwen3.5-flash"),
                        SimpleNamespace(model="qwen3.5-27b"),
                    ])
                )

        agent = FakeAgent()
        selected = asyncio.run(ConversableAgent._a_select_llm_model(
            agent, "qwen3.5-flash"
        ))
        self.assertEqual(selected, "qwen3.5-flash")
        agent.not_null_llm_client.models = lambda: asyncio.sleep(
            0, result=[SimpleNamespace(model="qwen3.5-27b")]
        )
        with self.assertRaisesRegex(ValueError, "Selected LLM model is unavailable"):
            asyncio.run(ConversableAgent._a_select_llm_model(agent, None))
