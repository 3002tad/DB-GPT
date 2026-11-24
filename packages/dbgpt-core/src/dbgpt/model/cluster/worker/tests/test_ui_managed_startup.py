"""UI-managed model storage must bootstrap without a static LLM."""
from types import SimpleNamespace

import pytest

from dbgpt.model.cluster.worker import manager


@pytest.mark.parametrize("kind", ["empty", "embedding", "reranker", "llm"])
def test_manager_exists_before_registering_start_listener(monkeypatch, kind):
    events = []
    storage = object()
    listener = object()
    adapter = SimpleNamespace(worker_manager=None)
    local = SimpleNamespace(after_start=lambda value: events.append(("listener", value)))

    def create(params, model_storage):
        assert model_storage is storage
        events.append(("created", None))
        return local

    def start(*args, **kwargs):
        if adapter.worker_manager is None:
            adapter.worker_manager = create(None, kwargs["model_storage"])
        events.append(("worker", None))

    adapter.after_start = lambda value: adapter.worker_manager.after_start(value)
    monkeypatch.setattr(manager, "worker_manager", adapter)
    monkeypatch.setattr(manager, "_setup_fastapi", lambda *a, **kw: None)
    monkeypatch.setattr(manager, "_create_local_model_manager", create)
    monkeypatch.setattr(manager, "_start_local_worker", start)
    monkeypatch.setattr(manager, "_start_local_embedding_worker", start)
    manager.initialize_worker_manager_in_client(
        SimpleNamespace(controller_addr=None),
        SimpleNamespace(llms=[object()] if kind == "llm" else [],
                        embeddings=[object()] if kind == "embedding" else [],
                        rerankers=[object()] if kind == "reranker" else []),
        app=object(), include_router=False, start_listener=listener,
        model_storage=storage,
    )
    assert adapter.worker_manager is local
    assert events.count(("created", None)) == 1
    assert events[-1] == ("listener", listener)
