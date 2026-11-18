import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

from jinja2 import Template

from dbgpt.agent.core.agent import AgentMessage
from dbgpt.agent.core.base_agent import ConversableAgent
from dbgpt.agent.expand.prompt_payload import (
    NATIVE_TOOL_PROTOCOL,
    native_request_shape,
    project_history_roles,
)
from dbgpt.agent.expand.react_agent import _REACT_SYSTEM_TEMPLATE, _REACT_USER_TEMPLATE
from dbgpt.agent.expand.tool_calling_agent import ToolCallingReActAgent


def test_native_objective_is_once_in_user_prompt_and_legacy_remains():
    question = "Analyze evidence with exact filters\n" * 1000
    inputs = dict(question=question, native_function_calling=True, goal="Keep source and quality", max_steps=100)
    system = Template(_REACT_SYSTEM_TEMPLATE).render(**inputs)
    user = Template(_REACT_USER_TEMPLATE).render(**inputs)
    assert question not in system
    assert question in user
    assert system.count(NATIVE_TOOL_PROTOCOL) == 1
    legacy = Template(_REACT_SYSTEM_TEMPLATE).render(**{**inputs, "native_function_calling": False})
    assert question in legacy
    assert "ACTION SPACE" in legacy or "Action Input" in legacy
    assert len(system + user) < len(legacy + user)


def test_roles_are_preserved_without_mutating_history_or_guessing_known_turns():
    original = [AgentMessage(role="human", content="q"), AgentMessage(role="ai", content="a"),
                AgentMessage(role="ai", content="extra answer"), AgentMessage(role="human", content="follow-up"),
                AgentMessage(role=None, content="legacy")]
    projected = project_history_roles(original)
    assert [m.role for m in projected] == ["human", "ai", "ai", "human", "human"]
    assert original[-1].role is None
    assert all(a is not b for a, b in zip(original, projected))


def test_request_shape_contains_sizes_only_and_keeps_tool_call_cost_separate():
    secret = "NEVER_LOG_CONTENT"
    shape = native_request_shape([{"role": "system", "content": secret},
                                  {"role": "tool", "content": "error", "tool_calls": [{"arguments": secret}]}],
                                 [{"function": {"name": secret}}])
    assert shape["roles"]["system"]["content_chars"] == len(secret)
    assert shape["roles"]["tool"]["tool_call_chars"] > 0
    assert shape["tools"] == 1
    assert shape["unit"] == "characters_not_tokens"
    assert secret not in json.dumps(shape)


def test_native_request_does_not_duplicate_protocol_or_modify_observations():
    captured = {}

    async def reply(**kwargs):
        captured.update(kwargs)
        return SimpleNamespace(has_text=False, text="", tool_calls=[{"function": {"name": "terminate", "arguments": '{"output":"done"}'}}])

    agent = SimpleNamespace(
        _report_repair_state={}, _build_native_tools=lambda: [{"type": "function", "function": {"name": "sql_query"}}],
        _manage_model_context=AsyncMock(side_effect=lambda messages, *_args, **_kwargs: messages),
        _request_max_new_tokens=lambda: 300, _native_tool_choice=lambda: "auto",
        _a_select_llm_model=lambda _: asyncio.sleep(0, result="test-model"),
        llm_client=SimpleNamespace(create_with_output=reply),
        not_null_agent_context=SimpleNamespace(max_new_tokens=300, gpts_app_code=None, temperature=0, verbose=False, conv_id="test"),
        memory=SimpleNamespace(gpts_memory=None), stream_out=False,
    )
    error = 'SQL_GROUPING_ERROR: fix with subquery; evidence=sql-1; quality=INCOMPLETE'
    messages = [AgentMessage(role="system", content=NATIVE_TOOL_PROTOCOL),
                AgentMessage(role="human", content=error)]
    asyncio.run(ToolCallingReActAgent._thinking_native(agent, messages))
    assert captured["messages"][0]["content"].count(NATIVE_TOOL_PROTOCOL) == 1
    assert captured["messages"][-1]["content"] == error
    assert messages[0].content == NATIVE_TOOL_PROTOCOL
    assert captured["tools"][0]["function"]["name"] == "sql_query"


def test_only_identical_current_objective_memory_is_removed_in_native_mode():
    objective = "question"
    memory = [AgentMessage(role="human", content="Question: question"),
              AgentMessage(role="human", content="Observation: ERROR evidence and repair"),
              AgentMessage(role="ai", content="prior reasoning")]
    fake = SimpleNamespace(
        read_memories=AsyncMock(return_value=memory), task_progress_summary=None,
        load_resource=AsyncMock(return_value=("", {})), generate_resource_variables=AsyncMock(return_value={}),
        build_system_prompt=AsyncMock(return_value="system"), build_prompt=AsyncMock(return_value="Question: question"),
        agent_context=SimpleNamespace(enable_native_function_calling=True),
    )
    kwargs = dict(received_message=AgentMessage(content=objective), sender=None, historical_dialogues=[AgentMessage(role="ai", content="old answer")])
    result, _ = asyncio.run(ConversableAgent._load_thinking_messages(fake, **kwargs))
    assert [m.content for m in result].count("Question: question") == 1
    assert "Observation: ERROR evidence and repair" in [m.content for m in result]
    assert "prior reasoning" in [m.content for m in result]
    fake.agent_context.enable_native_function_calling = False
    result, _ = asyncio.run(ConversableAgent._load_thinking_messages(fake, **kwargs))
    assert [m.content for m in result].count("Question: question") == 2
