"""Regression checks for malformed native tool calls and model selection."""

import asyncio
import json
import unittest
from types import SimpleNamespace

from dbgpt.agent.core.agent import AgentContext, AgentMessage
from dbgpt.agent.core.action.base import ActionOutput
from dbgpt.agent.core.base_agent import ConversableAgent
from dbgpt.agent.expand.tool_calling_agent import ToolCallingReActAgent
from dbgpt.agent.util.llm.llm import LLMStrategyType


class NativeRecoveryTest(unittest.TestCase):
    def test_repeated_incomplete_sql_stops_with_explicit_reason(self):
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
        self.assertFalse(second.have_retry)
        self.assertIn("AGENT_TOOL_CALL_STALLED", message.content)

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
