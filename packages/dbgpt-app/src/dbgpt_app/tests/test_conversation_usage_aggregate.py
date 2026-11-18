"""Validate the existing provider aggregate used by the composer, no model calls."""

import tempfile
import unittest
from datetime import datetime
from pathlib import Path

from dbgpt.observability.default_provider import DefaultObservabilityProvider
from dbgpt.observability.span_store import ObservabilitySpanEntity


class ConversationUsageTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.provider = DefaultObservabilityProvider(sqlite_path=str(Path(self.temp.name) / "usage.sqlite"))

    def add(self, sid, *, conv="chat", model="a", total=14, missing=False, operation="Agent.llm_client.no_streaming_call"):
        with self.provider._session as session:
            session.add(ObservabilitySpanEntity(
                trace_id="trace", span_id=sid, conversation_id=conv,
                operation_name=operation, model_name=model, start_time=datetime(2026, 1, 1),
                prompt_tokens=None if missing else total - 4,
                completion_tokens=None if missing else 4,
                total_tokens=None if missing else total,
            ))
            session.commit()

    def test_parent_spans_and_other_conversations_do_not_add_tokens(self):
        self.add("call")
        self.add("parent", total=14, operation="agent.run")
        self.add("nested", total=14, operation="llm.chat")
        self.add("other", conv="other", total=100)
        result = self.provider.conversation_usage("chat")
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["calls"], 1)
        self.assertEqual(result[0]["total_tokens"], 14)

    def test_followup_and_model_switch_keep_provider_sums_without_double_add(self):
        self.add("one")
        self.add("two", model="b", total=24)
        self.assertEqual(sum(item["total_tokens"] for item in self.provider.conversation_usage("chat")), 38)
        self.assertEqual(sum(item["total_tokens"] for item in self.provider.conversation_usage("chat")), 38)
        self.add("three", total=34)
        self.assertEqual(sum(item["total_tokens"] for item in self.provider.conversation_usage("chat")), 72)

    def test_missing_usage_is_not_zero_and_empty_native_scope_is_not_certified(self):
        self.add("known")
        self.add("missing", missing=True)
        item = self.provider.conversation_usage("chat")[0]
        self.assertFalse(item["complete"])
        self.assertIsNone(item["total_tokens"])
        self.assertEqual(item["known_total_tokens"], 14)
        self.assertEqual(item["missing_usage_calls"], 1)
        self.assertEqual(self.provider.conversation_usage("unreported-native-app"), [])


if __name__ == "__main__":
    unittest.main()
