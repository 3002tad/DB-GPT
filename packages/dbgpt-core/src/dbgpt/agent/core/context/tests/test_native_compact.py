import asyncio
import unittest
from types import SimpleNamespace

from dbgpt.agent.core.agent import AgentMessage
from dbgpt.agent.core.context.budget import ContextBudgetConfig, ContextBudgetTracker
from dbgpt.agent.core.context.compact import (
    FullContextCompression, ObservationMicroCompact, ReactiveCompact,
    SessionMemoryCompact, _detect_round_boundaries,
)
from dbgpt.core import ModelMessageRoleType as Role


def message(role, content="", **kwargs):
    return AgentMessage(role=role, content=content, **kwargs)


def exchange(i):
    ids = [f"{i}-a", f"{i}-b"]
    return [
        message(Role.AI, tool_calls=[{"id": x, "type": "function", "function": {"name": "sql_query", "arguments": "{}"}} for x in ids]),
        message(Role.TOOL, "result " * 100, tool_call_id=ids[1]),
        message(Role.TOOL, "result " * 100, tool_call_id=ids[0]),
    ]


def assert_paired(test, messages):
    pending = set()
    for msg in messages:
        if msg.tool_calls:
            pending.update(c["id"] for c in msg.tool_calls)
        if msg.role == Role.TOOL:
            test.assertIn(msg.tool_call_id, pending)
            pending.remove(msg.tool_call_id)
    test.assertFalse(pending)


class NativeCompactionTest(unittest.TestCase):
    def setUp(self):
        self.tracker = ContextBudgetTracker(ContextBudgetConfig(
            min_keep_recent_rounds=2, min_keep_tokens=0,
            max_observation_age_rounds=2, truncated_observation_max_chars=50,
        ))
        self.objective = message(Role.HUMAN, "Compare the selected sources")
        self.messages = [message(Role.SYSTEM, "system"), self.objective]
        for i in range(6): self.messages.extend(exchange(i))

    def test_parallel_results_are_one_atomic_round(self):
        rounds = _detect_round_boundaries(self.messages)
        self.assertEqual(len(rounds), 6)
        for group in rounds:
            assert_paired(self, [self.messages[i] for i in group])

    def test_native_message_roundtrip_and_copy_keep_protocol(self):
        originals = exchange(1)
        restored = [AgentMessage.from_llm_message(m.to_llm_message()) for m in originals]
        assert_paired(self, restored)
        copies = [m.copy() for m in restored]
        assert_paired(self, copies)
        copies[0].tool_calls[0]["function"]["arguments"] = '{"changed":true}'
        self.assertEqual(restored[0].tool_calls[0]["function"]["arguments"], "{}")

    def test_incomplete_parallel_group_is_not_split(self):
        messages = exchange(1)[:2]
        self.assertEqual(_detect_round_boundaries(messages), [[0, 1]])

    def test_microcompact_changes_only_working_copy_and_preserves_pairs(self):
        before = self.messages[3].content
        result = ObservationMicroCompact().compact(self.messages, 0, self.tracker)
        self.assertEqual(self.messages[3].content, before)
        self.assertLess(len(result[3].content), len(before))
        self.assertEqual(result[-1].content, self.messages[-1].content)
        assert_paired(self, result)

    def test_session_drop_preserves_objective_and_recent_parallel_pairs(self):
        result = SessionMemoryCompact().compact(self.messages, None, self.tracker)
        self.assertIn(self.objective, result)
        self.assertLess(len(result), len(self.messages))
        assert_paired(self, result)

    def test_reactive_drop_preserves_objective_and_recent_pairs(self):
        result = ReactiveCompact().compact(self.messages, self.tracker)
        self.assertIn(self.objective, result)
        self.assertEqual(sum(m.role == Role.TOOL for m in result), 4)
        assert_paired(self, result)

    def test_summary_contains_tool_identity_and_keeps_recent_pairs(self):
        captured = []
        async def summarize(prompt, **kwargs):
            captured.append(prompt)
            return "Completed earlier SQL checks; compare selected sources."
        self.tracker.model_name = "fake-model"
        result = asyncio.run(FullContextCompression().compact(
            self.messages, SimpleNamespace(generate_text=summarize), self.tracker,
        ))
        self.assertIn("sql_query", captured[0])
        self.assertIn("Tool result 0-b", captured[0])
        self.assertIn(self.objective, result)
        assert_paired(self, result)

    def test_plain_conversation_turns_are_separated_before_native_tools(self):
        messages = [message(Role.HUMAN, "Earlier question"), message(Role.AI, "Earlier answer"),
                    message(Role.HUMAN, "Follow-up")] + exchange(1)
        rounds = _detect_round_boundaries(messages)
        self.assertEqual(rounds[0], [0, 1])
        self.assertEqual(rounds[1], [2, 3, 4, 5])

    def test_native_overflow_retries_only_after_a_smaller_paired_request(self):
        from dbgpt.agent.expand.tool_calling_agent import ToolCallingReActAgent
        from dbgpt.core import ModelOutput
        from dbgpt.util.error_types import LLMChatError

        requests = []
        async def create(**kwargs):
            requests.append(kwargs["messages"])
            if len(requests) == 1:
                raise LLMChatError(original_exception=ValueError("context_length_exceeded"))
            return ModelOutput(text="done", error_code=0)
        async def select(last): return "fake-model"
        async def manage(messages, model, tools): return messages
        async def reactive(messages):
            return ReactiveCompact().compact(messages, self.tracker)
        fake = SimpleNamespace(
            _build_native_tools=lambda: [], _a_select_llm_model=select,
            _manage_model_context=manage,
            _context_manager=SimpleNamespace(tracker=self.tracker, reactive_compact=reactive),
            llm_client=SimpleNamespace(create_with_output=create),
            _request_max_new_tokens=lambda: 100, _native_tool_choice=lambda: "auto",
            not_null_agent_context=SimpleNamespace(temperature=0, verbose=False, conv_id="test"),
            memory=SimpleNamespace(gpts_memory=None), stream_out=False,
        )
        result = asyncio.run(ToolCallingReActAgent._thinking_native(fake, self.messages))
        self.assertEqual(result, ("done", "fake-model"))
        self.assertEqual(len(requests), 2)
        self.assertLess(len(requests[1]), len(requests[0]))
        assert_paired(self, [AgentMessage.from_llm_message(m) for m in requests[1]])

        # With no removable older groups, do not repeat the same overflowing call.
        requests.clear()
        with self.assertRaises(LLMChatError):
            asyncio.run(ToolCallingReActAgent._thinking_native(fake, exchange(1)))
        self.assertEqual(len(requests), 1)


if __name__ == "__main__": unittest.main()
