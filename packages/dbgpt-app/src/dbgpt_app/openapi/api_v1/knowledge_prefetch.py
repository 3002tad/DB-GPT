"""Bounded, fail-open retrieval from a user's selected knowledge space."""

import asyncio
import logging
from hashlib import sha256

logger = logging.getLogger(__name__)
MAX_CONTEXT_CHARS = 3500


def knowledge_prefetch_evidence(metadata):
    """Expose retrieval provenance without copying document text into SSE."""
    return {
        "type": "knowledge.prefetch",
        "status": metadata.get("status", "unavailable"),
        "knowledge_space": metadata.get("knowledge_space"),
        "space_id": metadata.get("space_id"),
        "space_name": metadata.get("space_name"),
        "context_sha256": metadata.get("context_sha256"),
        "context_chars": metadata.get("context_chars", 0),
        "included_in_prompt": metadata.get("included_in_prompt", False),
        "documents": [
            {key: ref.get(key) for key in
             ("document_id", "document", "chunk_id", "version", "excerpt_sha256")}
            for ref in metadata.get("documents", [])
        ],
    }


async def prefetch_knowledge(system_app, knowledge_id, query, conversation_id, evidence=None):
    """Return a short cited context and persist its exact contents in a trace."""
    from dbgpt.util.tracer import root_tracer
    from dbgpt_serve.rag.api.schemas import KnowledgeRetrieveRequest
    from dbgpt_serve.rag.chunk_metadata import parse_chunk_metadata
    from dbgpt_serve.rag.service.service import Service

    meta = evidence if evidence is not None else {}
    meta.update({"conversation_id": conversation_id, "knowledge_space": str(knowledge_id),
                 "status": "unavailable", "documents": [], "context_chars": 0})
    span = root_tracer.start_span("knowledge.prefetch", metadata=meta)
    try:
        service = Service.get_instance(system_app)
        space_id = str(knowledge_id)
        lookup = {"id": int(space_id)} if space_id.isdigit() else {"name": space_id}
        space = await asyncio.to_thread(service.get, lookup)
        if not space:
            meta["status"] = "space_not_found"
            return ""
        meta["space_id"] = space.id
        meta["space_name"] = space.name
        request = KnowledgeRetrieveRequest(query=query[:1000], space_id=space.id,
                                           top_k=3, score_threshold=0.0)
        chunks = await asyncio.wait_for(service.retrieve(request, space), timeout=15)
        parts = []
        remaining = MAX_CONTEXT_CHARS
        for chunk in chunks or []:
            fields = parse_chunk_metadata(getattr(chunk, "metadata", None))
            content = (getattr(chunk, "content", "") or "").strip()
            if not content or remaining <= 0:
                continue
            content = content[:remaining]
            remaining -= len(content)
            ref = {"document_id": fields.get("document_id") or fields.get("doc_id"),
                   "document": fields.get("doc_name") or fields.get("file_path"),
                   "chunk_id": fields.get("chunk_id") or getattr(chunk, "chunk_id", None),
                   "version": fields.get("version"), "excerpt": content,
                   "excerpt_sha256": sha256(content.encode("utf-8")).hexdigest()}
            meta["documents"].append(ref)
            parts.append(f"Document: {ref['document'] or 'unknown'}; "
                         f"document_id: {ref['document_id']}; chunk_id: {ref['chunk_id']}; "
                         f"version: {ref['version'] or 'see document/space'}\n{content}")
        meta["status"] = "retrieved" if parts else "no_results"
        if not parts:
            return ""
        context = ("\n### Retrieved knowledge excerpts (derived; verify against the "
                   "datasource and cite the source/version)\n" + "\n\n---\n\n".join(parts))
        meta["context_chars"] = len(context)
        meta["context_sha256"] = sha256(context.encode("utf-8")).hexdigest()
        return context
    except Exception:
        meta["status"] = "error"
        logger.warning("Selected knowledge prefetch failed", exc_info=True)
        return ""
    finally:
        root_tracer.end_span(span, metadata=meta)
