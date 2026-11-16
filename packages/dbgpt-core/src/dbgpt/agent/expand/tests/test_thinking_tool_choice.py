"""Native requests must remain valid with Qwen thinking enabled."""

import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

from dbgpt.agent.core.agent import AgentMessage
from dbgpt.agent.expand.tool_calling_agent import ToolCallingReActAgent


class ThinkingToolChoiceTest(unittest.IsolatedAsyncioTestCase):
    async def test_normal_recovery_and_report_requests_use_auto(self):
        for recovery, app in (
            (False, "react_agent"),
            (True, "react_agent"),
            (True, "react_agent_report"),
        ):
            with self.subTest(recovery=recovery, app=app):
                state = {"_native_retry_requires_tool_call": recovery}
                tools = [{"type": "function", "function": {
                    "name": "terminate", "parameters": {"type": "object"},
                }}]
                output = SimpleNamespace(
                    has_text=False, text="", usage=None,
                    tool_calls=[{"function": {
                        "name": "terminate", "arguments": '{"output":"done"}',
                    }}],
                )
                create = AsyncMock(return_value=output)
                agent = SimpleNamespace(
                    _report_repair_state=state,
                    _tool_protocol_failures=2 if recovery else 0,
                    _build_native_tools=lambda: tools,
                    _a_select_llm_model=AsyncMock(return_value="qwen3.5-27b"),
                    _manage_model_context=AsyncMock(side_effect=lambda m, *_a, **_k: m),
                    _request_max_new_tokens=lambda: 300,
                    llm_client=SimpleNamespace(create_with_output=create),
                    not_null_agent_context=SimpleNamespace(
                        gpts_app_code=app, temperature=0, verbose=False, conv_id="test",
                    ),
                    memory=SimpleNamespace(gpts_memory=None), stream_out=False,
                )
                agent._native_tool_choice = lambda: (
                    ToolCallingReActAgent._native_tool_choice(agent)
                )
                await ToolCallingReActAgent._thinking_native(agent, [
                    AgentMessage(role="system", content="Use tools to finish."),
                    AgentMessage(role="human", content="Finish the task."),
                ])
                request = create.call_args.kwargs
                self.assertEqual(request["tool_choice"], "auto")
                self.assertEqual(request["llm_model"], "qwen3.5-27b")
                self.assertEqual(request["tools"], tools)
                self.assertEqual(agent._pending_native_tool_calls, output.tool_calls)
                if recovery:
                    self.assertTrue(any(
                        "previous action was rejected" in m.get("content", "")
                        for m in request["messages"]
                    ))


if __name__ == "__main__":
    unittest.main()
