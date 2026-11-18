"""Chart tool errors follow the conversation locale without an LLM call."""

import json

import pytest

from dbgpt_app.openapi.api_v1.tools.chart_query import make_chart_query


@pytest.mark.asyncio
@pytest.mark.parametrize("locale,expected", [
    ("vi-VN", "Chưa chọn nguồn dữ liệu"),
    ("en", "Select a data source"),
    ("zh-CN", "未选择数据库"),
])
async def test_missing_database_is_localized(locale, expected):
    tool = make_chart_query({"_ui_locale": locale}, None)
    result = json.loads(await tool(sql="SELECT 1"))
    assert result["success"] is False
    assert result["error_code"] == "SQL_DATASOURCE_REQUIRED"
    assert expected in result["chunks"][0]["content"]
    assert result["recovery_hint"] == result["chunks"][0]["content"]


@pytest.mark.asyncio
async def test_unsupported_type_keeps_identifier_and_does_not_query():
    tool = make_chart_query({"_ui_locale": "vi"}, object())
    result = json.loads(await tool(sql="SELECT 1", display_type="unknown_type"))
    assert result["error_code"] == "CHART_TYPE_UNSUPPORTED"
    assert result["chunks"][0]["content"] == "Loại biểu đồ không được hỗ trợ: unknown_type"
