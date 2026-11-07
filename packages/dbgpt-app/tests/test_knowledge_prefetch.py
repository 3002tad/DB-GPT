"""Focused checks for bounded, fail-open selected-KB retrieval."""

import asyncio
from types import SimpleNamespace
from unittest.mock import patch
from hashlib import sha256

from dbgpt_app.openapi.api_v1.knowledge_prefetch import (
    prefetch_knowledge, knowledge_prefetch_evidence,
)


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
        evidence = {}
        context = asyncio.run(prefetch_knowledge(None, "selected-kb", "question", "conv-1", evidence))
    assert "snapshot-v1" in context and "c1" in context
    assert len(recorded["documents"][0]["excerpt"]) == 3500
    assert recorded["conversation_id"] == "conv-1" and recorded["status"] == "retrieved"
    assert evidence["context_sha256"] == sha256(context.encode("utf-8")).hexdigest()
    public = knowledge_prefetch_evidence(evidence)
    assert public["status"] == "retrieved" and public["context_chars"] == len(context)
    assert public["documents"][0]["excerpt_sha256"] == sha256(("x" * 3500).encode()).hexdigest()
    assert "excerpt" not in public["documents"][0]
    assert public["included_in_prompt"] is False
    evidence["included_in_prompt"] = True
    assert knowledge_prefetch_evidence(evidence)["included_in_prompt"] is True


def test_missing_space_fails_open():
    service = SimpleNamespace(get=lambda _lookup: None)
    with patch("dbgpt_serve.rag.service.service.Service.get_instance", return_value=service):
        evidence = {}
        assert asyncio.run(prefetch_knowledge(None, "missing", "question", "conv", evidence)) == ""
    assert knowledge_prefetch_evidence(evidence)["status"] == "space_not_found"
    assert knowledge_prefetch_evidence(evidence)["context_chars"] == 0


def test_retrieval_failure_is_visible_and_does_not_block_agent():
    class Service:
        def get(self, _lookup):
            return SimpleNamespace(id=4, name="selected-kb")

        async def retrieve(self, *_args):
            raise RuntimeError("retrieval unavailable")

    evidence = {}
    with patch("dbgpt_serve.rag.service.service.Service.get_instance", return_value=Service()):
        assert asyncio.run(prefetch_knowledge(None, "selected-kb", "question", "conv", evidence)) == ""
    assert knowledge_prefetch_evidence(evidence)["status"] == "error"
    assert knowledge_prefetch_evidence(evidence)["documents"] == []
