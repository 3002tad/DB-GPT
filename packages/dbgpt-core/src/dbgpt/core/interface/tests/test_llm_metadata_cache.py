"""Model metadata must belong to the client that advertised it."""

import asyncio
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

from dbgpt.core.interface.llm import LLMClient, ModelMetadata
from dbgpt.model.cluster.client import DefaultLLMClient


class StubClient(LLMClient):
    # Deliberately no super().__init__: proxy clients use this pattern too.
    def __init__(self, name, context_length):
        self.name = name
        self.context_length = context_length
        self.model_calls = 0

    async def models(self):
        self.model_calls += 1
        return [ModelMetadata(model=self.name, context_length=self.context_length)]

    async def generate(self, request, message_converter=None):
        raise NotImplementedError

    async def generate_stream(self, request, message_converter=None):
        raise NotImplementedError
        yield

    async def count_token(self, model, prompt):
        raise NotImplementedError


class MetadataCacheTest(unittest.IsolatedAsyncioTestCase):
    async def test_clients_keep_disjoint_lists_and_windows(self):
        first = StubClient("qwen3.5-27b", 128000)
        second = StubClient("qwen3.6-plus", 256000)
        metadata = await asyncio.gather(
            first.get_model_metadata(first.name),
            second.get_model_metadata(second.name),
        )
        self.assertEqual([m.context_length for m in metadata], [128000, 256000])
        self.assertIsNot(first.cache, second.cache)
        await first.get_model_metadata(first.name)
        await second.get_model_metadata(second.name)
        self.assertEqual((first.model_calls, second.model_calls), (1, 1))

    async def test_same_model_name_does_not_share_deployment_metadata(self):
        first = StubClient("shared-alias", 32000)
        second = StubClient("shared-alias", 64000)
        self.assertEqual(
            (await first.get_model_metadata(first.name)).context_length, 32000
        )
        self.assertEqual(
            (await second.get_model_metadata(second.name)).context_length, 64000
        )

    async def test_cluster_can_enumerate_distinct_proxy_workers(self):
        clients = {
            name: StubClient(name, 128000)
            for name in ("qwen3.5-27b", "qwen3.6-plus")
        }

        async def metadata(params):
            client = clients[params["model"]]
            return await client.get_model_metadata(client.name)

        manager = SimpleNamespace(
            get_all_model_instances=AsyncMock(return_value=[
                SimpleNamespace(worker_key=f"{name}@llm") for name in clients
            ]),
            get_model_metadata=metadata,
        )
        cluster = DefaultLLMClient(manager)
        self.assertEqual(
            {item.model for item in await cluster.models()}, set(clients)
        )
        # An aggregate-client cache must not poison a proxy cache either.
        await cluster.cached_models()
        self.assertEqual(
            [item.model for item in await clients["qwen3.5-27b"].cached_models()],
            ["qwen3.5-27b"],
        )

    async def test_unknown_model_still_fails(self):
        client = StubClient("known", 128000)
        with self.assertRaisesRegex(ValueError, "Model unknown not found"):
            await client.get_model_metadata("unknown")


if __name__ == "__main__":
    unittest.main()
