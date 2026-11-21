"""Regression checks for malformed native tool calls and model selection."""

import asyncio
import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from dbgpt.agent.core.agent import AgentContext, AgentMessage
from dbgpt.agent.core.action.base import ActionOutput
from dbgpt.agent.core.base_agent import ConversableAgent
from dbgpt.agent.expand.tool_calling_agent import ToolCallingReActAgent
from dbgpt.agent.expand.actions.tool_action import ToolCallSpec, run_tools_batch
from dbgpt.agent.expand.tool_recovery import observe_action_results, observe_tool_result
from dbgpt.agent.util.llm.llm import LLMStrategyType
from dbgpt.agent.expand.prompt_payload import native_public_answer


class NativeRecoveryTest(unittest.TestCase):
    def test_public_answer_uses_only_completed_public_provider_output(self):
        def response(**overrides):
            return SimpleNamespace(**dict(
                {"has_text": True, "text": "Kết quả phân tích.", "error_code": 0,
                 "finish_reason": "stop", "tool_calls": None}, **overrides
            ))

        self.assertEqual(native_public_answer(response()), "Kết quả phân tích.")
        self.assertTrue(native_public_answer(response(finish_reason=None)))
        for output in (
            response(has_text=False, text="", reasoning_content="private answer"),
            response(finish_reason="length"),
            response(finish_reason="content_filter"),
            response(finish_reason="tool_calls"),
            response(error_code=1),
            response(tool_calls=[{"function": {"name": "sql_query", "arguments": "{"}}]),
            response(text="Thought: private reasoning"),
            response(text='Action: sql_query\nAction Input: {}'),
            response(text='<tool_call>{}</tool_call>'),
            response(text='<think>private</think>'),
        ):
            with self.subTest(output=output):
                self.assertEqual(native_public_answer(output), "")

    def test_native_public_final_is_delivered_once_without_certifying_plan(self):
        state = {"_ui_locale": "vi", "_native_invalid_call_count": 2,
                 "_native_retry_requires_tool_call": True,
                 "pending_plan": ["unfinished analysis"]}
        agent = SimpleNamespace(
            agent_context=AgentContext(conv_id="native-final", enable_native_function_calling=True),
            _report_repair_state=state, _pending_native_tool_calls=None,
            _pending_native_public_answer="Kết quả phân tích.",
            parser=SimpleNamespace(parse_current_step=lambda _: []),
        )
        agent._apply_report_result = lambda *args: ToolCallingReActAgent._apply_report_result(agent, *args)
        message = AgentMessage(content="Kết quả phân tích.")
        first = asyncio.run(ToolCallingReActAgent.act(agent, message, sender=None))
        self.assertTrue(first.terminate)
        self.assertTrue(first.is_exe_success)
        self.assertEqual(first.content, message.content)
        self.assertEqual(state["_final_delivery_origin"], "native_public_text")
        self.assertEqual(state["pending_plan"], ["unfinished analysis"])
        self.assertFalse(state["_native_retry_requires_tool_call"])
        second = asyncio.run(ToolCallingReActAgent.act(agent, message, sender=None))
        self.assertFalse(second.is_exe_success)

    def test_history_or_mismatched_message_cannot_be_promoted_to_final(self):
        agent = SimpleNamespace(
            agent_context=AgentContext(conv_id="native-final", enable_native_function_calling=True),
            _report_repair_state={}, _pending_native_tool_calls=None,
            _pending_native_public_answer="different provider answer",
            parser=SimpleNamespace(parse_current_step=lambda _: []),
        )
        agent._apply_report_result = lambda *args: ToolCallingReActAgent._apply_report_result(agent, *args)
        output = asyncio.run(ToolCallingReActAgent.act(
            agent, AgentMessage(content="historical prose"), sender=None,
        ))
        self.assertFalse(output.is_exe_success)
        self.assertFalse(output.terminate)

    def test_real_protocol_failure_is_classified_and_localized(self):
        for locale in ("vi", "en"):
            agent = SimpleNamespace(
                _report_repair_state={"_ui_locale": locale},
                _pending_native_tool_calls=None,
                agent_context=AgentContext(conv_id="bad-call", enable_native_function_calling=True),
            )
            for _ in range(3):
                output = ToolCallingReActAgent._apply_report_result(
                    agent, ActionOutput(is_exe_success=False,
                        content="No valid ReAct step or native tool call found."),
                    AgentMessage(content="bad protocol"), 0,
                )
            self.assertFalse(output.have_retry)
            self.assertIn("TOOL_PROTOCOL_RETRY_EXHAUSTED [MISSING_ACTION]", output.content)
            self.assertNotRegex(output.content, r"[\u4e00-\u9fff]")
            if locale == "vi":
                self.assertIn("Không thể", output.content)

    def test_missing_datasource_single_result_recovers_by_error_across_changed_sql(self):
        state = {}
        error = json.dumps({"success": False, "error_code": "SQL_DATASOURCE_REQUIRED"})
        for sql in ('SELECT 1', 'SELECT 2'):
            signals = observe_action_results(state, [{"function": {
                "name": "chart_query", "arguments": json.dumps({"sql": sql})
            }}], error, False)
        self.assertEqual(signals[0]["reason"], "same_error_recurred")
        self.assertIn("changing SQL will not", signals[0]["instruction"])
        self.assertEqual(state["_tool_recovery"]["chart_query"]["error_repeats"], 2)

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
        state = {"_native_retry_requires_tool_call": True, "_user_decisions": [
            {"pairs": [{"question": "Period and ranking?", "answer": "Q3/2026; top 20 by order count"}]}
        ]}
        captured = {}
        provider_output = SimpleNamespace(has_text=False, text="", tool_calls=[
            {"function": {"name": "terminate", "arguments": '{"output":"done"}'}}
        ])

        async def create_with_output(**kwargs):
            captured.update(kwargs)
            return provider_output

        agent = SimpleNamespace(
            _report_repair_state=state,
            _build_native_tools=lambda: [{"type": "function"}],
            _manage_model_context=AsyncMock(side_effect=lambda messages, *_args, **_kwargs: messages),
            _request_max_new_tokens=lambda: 300,
            _native_tool_choice=lambda: 'auto',
            _a_select_llm_model=lambda _excluded: asyncio.sleep(0, result="qwen3.5-flash"),
            llm_client=SimpleNamespace(create_with_output=create_with_output),
            not_null_agent_context=SimpleNamespace(max_new_tokens=300, gpts_app_code=None,
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
        self.assertIn("Q3/2026; top 20 by order count", captured["messages"][0]["content"])
        self.assertEqual(1, captured["messages"][0]["content"].count("Confirmed user clarification answers"))
        self.assertEqual(agent._pending_native_public_answer, "")
        # Actual provider prose becomes eligible without turning thinking into
        # public content or changing auto tool choice. The next response resets it.
        provider_output = SimpleNamespace(has_text=True, text="Đã phân tích.",
                                          tool_calls=None, finish_reason="stop")
        asyncio.run(ToolCallingReActAgent._thinking_native(agent, messages))
        self.assertEqual(agent._pending_native_public_answer, "Đã phân tích.")
        self.assertIsNone(agent._pending_native_tool_calls)
        provider_output = SimpleNamespace(has_text=False, text="", tool_calls=None,
                                          reasoning_content="private")
        asyncio.run(ToolCallingReActAgent._thinking_native(agent, messages))
        self.assertEqual(agent._pending_native_public_answer, "")

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
