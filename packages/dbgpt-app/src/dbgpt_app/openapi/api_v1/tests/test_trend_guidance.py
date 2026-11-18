"""Both real prompt builders preserve tools and render trend guidance once."""
import pytest

from dbgpt_app.openapi.api_v1.react_prompt import build_react_prompt_template
from dbgpt_app.openapi.api_v1.tools.report_objects import report_object_prompt
from dbgpt_app.openapi.api_v1.trend_guidance import TREND_GUIDANCE


@pytest.mark.parametrize("native", [True, False])
def test_chat_prompt_keeps_context_and_registered_tools_without_duplicating_guidance(native):
    context = 'KB version=7; SQL artifact=sql-123; template={{literal}}'
    prompt = build_react_prompt_template(context, financial_enabled=False).format(
        native_function_calling=native,
        action_space="sql_query; code; chart_query",
        action_space_names="sql_query, code, chart_query, terminate",
    )
    assert prompt.startswith(context)
    assert prompt.count(TREND_GUIDANCE) == 1
    assert "sql_query, code, chart_query, terminate" in prompt


@pytest.mark.parametrize("mode", ["spec", "placeholders"])
def test_active_report_author_prompt_gets_same_guidance_and_keeps_binding(mode):
    prompt = report_object_prompt(
        "/test/report.html", {"mode": mode, "fields": ["SUMMARY"]}, [], "en"
    )
    assert prompt.count(TREND_GUIDANCE) == 1
    assert "/test/report.html" in prompt
    assert "compose_report" in prompt
