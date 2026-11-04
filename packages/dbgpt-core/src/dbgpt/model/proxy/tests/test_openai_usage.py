"""Provider usage survives a final streaming chunk without choices."""
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

from dbgpt.core import ModelMessage, ModelRequest
from dbgpt.model.proxy.llms.chatgpt import OpenAILLMClient


def test_stream_requests_and_preserves_provider_usage():
    usage = {"prompt_tokens": 20, "completion_tokens": 5, "total_tokens": 25}
    async def chunks():
        yield SimpleNamespace(usage=None, choices=[SimpleNamespace(
            finish_reason=None, delta=SimpleNamespace(content="answer", tool_calls=None))])
        yield SimpleNamespace(usage=SimpleNamespace(model_dump=lambda: usage), choices=[])
    client = SimpleNamespace(default_headers={}, chat=SimpleNamespace(
        completions=SimpleNamespace(create=AsyncMock(return_value=chunks()))))
    adapter = OpenAILLMClient(openai_client=client)
    request = ModelRequest(model="qwen3.5-flash", messages=[ModelMessage(role="user", content="hi")])
    payload = adapter._build_request(request, stream=True)
    assert payload["stream_options"] == {"include_usage": True}
    async def collect():
        return [item async for item in adapter.generate_stream_v1([], payload)]
    outputs = asyncio.run(collect())
    assert outputs[-1].text == "answer"
    assert outputs[-1].usage == usage
