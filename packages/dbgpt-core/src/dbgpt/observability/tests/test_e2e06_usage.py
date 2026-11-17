"""Usage telemetry regressions with temporary SQLite and fake model output."""

import asyncio
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from dbgpt.core import ModelOutput
from dbgpt.observability.default_provider import DefaultObservabilityProvider
from dbgpt.observability.span_store import ObservabilitySpanEntity, get_observability_store
from dbgpt.util.tracer.base import Span
from dbgpt.util.tracer.sqlite_span_storage import SqliteSpanStorage


def span(sid, ended=False, tokens=True):
    item = Span(trace_id="test-trace", span_id=sid,
                operation_name="Agent.llm_client.no_streaming_call",
                metadata={"conversation_id": "owned", "model_name": "test-model"})
    if ended:
        item.end_time = datetime.now()
    if tokens:
        item.metadata["usage"] = {"prompt_tokens": 10, "completion_tokens": 4, "total_tokens": 14}
    return item


class UsageTelemetryTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = str(Path(self.tmp.name) / "observability.db")
        self.engine, self.factory = get_observability_store(self.path)
        self.storage = SqliteSpanStorage(self.path)

    def tearDown(self):
        self.engine.dispose()
        self.tmp.cleanup()

    def test_repeated_create_end_in_batch_keeps_all_calls(self):
        self.storage.append_span_batch([
            span("one", tokens=False), span("one", ended=True),
            span("two", ended=True), span("one", tokens=False),
        ])
        result = DefaultObservabilityProvider(self.path).conversation_usage("owned")[0]
        self.assertEqual(result["calls"], 2)
        self.assertEqual(result["total_tokens"], 28)

    def test_concurrent_writers_upsert_same_span(self):
        with ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(self.storage.append_span, [span("one", True) for _ in range(12)]))
        with self.factory() as session:
            self.assertEqual(session.query(ObservabilitySpanEntity).count(), 1)

    def test_partial_usage_has_known_subtotal_but_no_complete_total(self):
        self.storage.append_span_batch([span("one", True), span("two", True, False)])
        result = DefaultObservabilityProvider(self.path).conversation_usage("owned")[0]
        self.assertFalse(result["complete"])
        self.assertIsNone(result["total_tokens"])
        self.assertEqual(result["known_total_tokens"], 14)
        self.assertEqual(result["reported_calls"], 1)
        self.assertEqual(result["missing_usage_calls"], 1)
        self.assertEqual(DefaultObservabilityProvider(self.path).conversation_usage("other"), [])

    def test_usage_is_preserved_when_later_stream_chunk_omits_it(self):
        from dbgpt.agent.util.llm import llm_client

        captured = {}

        async def stream(request):
            yield ModelOutput(text="answer", error_code=0, usage={"prompt_tokens": 10, "completion_tokens": 4, "total_tokens": 14})
            yield ModelOutput(text="answer", error_code=0, usage=None)

        active_span = SimpleNamespace(span_id="one", metadata={},
                                      end=lambda metadata: captured.update(metadata))
        wrapper = llm_client.AIWrapper(SimpleNamespace(generate_stream=stream))
        with patch.object(llm_client.root_tracer, "start_span", return_value=active_span):
            asyncio.run(wrapper._completions_create("test-model", {
                "messages": [], "temperature": 0.1, "max_new_tokens": 10,
            }, conv_id="owned", stream_out=False))
        self.assertEqual(captured["total_tokens"], 14)
        self.assertEqual(captured["usage_source"], "provider")

    def test_reported_zero_is_not_missing_usage(self):
        item = span("zero", True)
        item.metadata["usage"] = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
        self.storage.append_span(item)
        result = DefaultObservabilityProvider(self.path).conversation_usage("owned")[0]
        self.assertTrue(result["complete"])
        self.assertEqual(result["total_tokens"], 0)
        self.assertEqual(result["reported_calls"], 1)

    def test_complementary_missing_fields_do_not_count_as_reported_calls(self):
        first, second = span("one", True), span("two", True)
        first.metadata["usage"] = {"prompt_tokens": 10, "total_tokens": 14}
        second.metadata["usage"] = {"completion_tokens": 4}
        self.storage.append_span_batch([first, second])
        result = DefaultObservabilityProvider(self.path).conversation_usage("owned")[0]
        self.assertEqual(result["reported_calls"], 0)
        self.assertEqual(result["missing_usage_calls"], 2)
        self.assertIsNone(result["total_tokens"])


if __name__ == "__main__":
    unittest.main()
