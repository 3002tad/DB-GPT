"""Focused checks for bounded, fail-open selected-KB retrieval."""

import asyncio
from types import SimpleNamespace
from unittest.mock import patch

from dbgpt_app.openapi.api_v1.knowledge_prefetch import prefetch_knowledge


def test_selected_space_context_is_bounded_and_traced():
    class Service:
        def get(self, lookup):
            assert lookup == {"name": "selected-kb"}
            return SimpleNamespace(id=4, name="selected-kb")

        async def retrieve(self, request, space):
            assert request.space_id == 4 and request.top_k == 3
            return [SimpleNamespace(content="x" * 5000, metadata={
                "document_id": 7, "doc_name": "snapshot-v1", "chunk_id": "c1"})]

    recorded = {}
    with patch("dbgpt_serve.rag.service.service.Service.get_instance", return_value=Service()), \
         patch("dbgpt.util.tracer.root_tracer.end_span", side_effect=lambda _s, **kw: recorded.update(kw["metadata"])):
        context = asyncio.run(prefetch_knowledge(None, "selected-kb", "question", "conv-1"))
    assert "snapshot-v1" in context and "c1" in context
    assert len(recorded["documents"][0]["excerpt"]) == 3500
    assert recorded["conversation_id"] == "conv-1" and recorded["status"] == "retrieved"


def test_missing_space_fails_open():
    service = SimpleNamespace(get=lambda _lookup: None)
    with patch("dbgpt_serve.rag.service.service.Service.get_instance", return_value=service):
        assert asyncio.run(prefetch_knowledge(None, "missing", "question", "conv")) == ""
