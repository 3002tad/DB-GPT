"""Thin ReAct adapter for DB-GPT's native SQL chart action."""

import json
from typing import Any, Dict, Optional

from dbgpt.agent.expand.actions.chart_action import ChartAction, _native_vis_chart_spec
from dbgpt.agent.resource.database import RDBMSConnectorResource
from dbgpt.agent.resource.tool.base import tool
from dbgpt.core.interface.report_capture import (
    bind_artifact_sink,
    connector_database_name,
)

from .sql_read_only import ReadOnlySqlError, read_only_sql
from .schema_recovery import query_schema_hint

_DISPLAY_TYPES = {
    "response_line_chart",
    "response_bar_chart",
    "response_pie_chart",
    "response_donut_chart",
    "response_scatter_chart",
    "response_bubble_chart",
    "response_area_chart",
    "response_heatmap_chart",
    "response_table",
}
_DISPLAY_TYPE_ALIASES = {
    # DB-GPT's older VisChart prompt advertises this name. Persist one
    # canonical artifact type, while continuing to accept old agent output.
    "response_heatmap": "response_heatmap_chart",
}


def make_chart_query(react_state: Dict[str, Any], database_connector: Optional[Any]):
    """Create the tool without reimplementing SQL-to-chart execution or capture."""

    locale = str(react_state.get("_ui_locale") or "en").lower()
    copy = (
        {"missing": "Chưa chọn nguồn dữ liệu. Hãy chọn cơ sở dữ liệu rồi thử lại.",
         "unsupported": "Loại biểu đồ không được hỗ trợ",
         "thought": "Hiển thị biểu đồ phân tích dữ liệu",
         "failed": "Không thể tạo biểu đồ"}
        if locale.startswith("vi") else
        {"missing": "未选择数据库。", "unsupported": "不支持的原生图表类型",
         "thought": "展示数据库分析图表", "failed": "原生图表生成失败"}
        if locale.startswith("zh") else
        {"missing": "Select a data source before querying.",
         "unsupported": "Unsupported chart type",
         "thought": "Display a database analysis chart",
         "failed": "Chart generation failed"}
    )

    @tool(
        description=(
            "Execute read-only SQL using DB-GPT's native interactive charts. "
            "Use for trends, comparisons, shares and distributions. Chart and SQL "
            "are captured together. Requires a selected data source. "
            "The UI renders the returned chart directly; do not copy its raw JSON "
            "or row data into the final answer. Explain the observed findings. "
            'Arguments: {"sql":"SELECT ...", "display_type":"response_line_chart", '
            '"thought":"chart description"}.'
        )
    )
    async def chart_query(
        sql: str,
        display_type: str = "response_line_chart",
        thought: str = "",
    ) -> str:
        display_type = _DISPLAY_TYPE_ALIASES.get(display_type, display_type)
        if database_connector is None:
            return json.dumps(
                {
                    "success": False,
                    "error_code": "SQL_DATASOURCE_REQUIRED",
                    "chunks": [{"output_type": "text", "content": copy["missing"]}],
                    "recovery_hint": copy["missing"],
                    "retryable": False,
                    "requires_user_action": "select_datasource",
                },
                ensure_ascii=False,
            )
        if display_type not in _DISPLAY_TYPES:
            return json.dumps(
                {
                    "success": False,
                    "error_code": "CHART_TYPE_UNSUPPORTED",
                    "chunks": [
                        {
                            "output_type": "text",
                            "content": f"{copy['unsupported']}: {display_type}",
                        }
                    ],
                },
                ensure_ascii=False,
            )
        try:
            normalized_sql = read_only_sql(sql)
        except ReadOnlySqlError as error:
            return json.dumps(
                {
                    "success": False,
                    "error_code": "SQL_READ_ONLY_REQUIRED",
                    "chunks": [{"output_type": "text", "content": str(error)}],
                },
                ensure_ascii=False,
            )
        try:
            artifact_sink = react_state.get("_report_artifact_sink")
            prior_ids = {item.artifact_id for item in artifact_sink.snapshot()} if artifact_sink else set()
            database_name = connector_database_name(database_connector, artifact_sink)
            resource = RDBMSConnectorResource(
                name=database_name or "database",
                connector=database_connector,
                db_name=database_name,
            )
            action = ChartAction()
            action.init_resource(resource)
            action_input = json.dumps(
                {
                    "sql": normalized_sql,
                    "display_type": display_type,
                    "thought": thought or copy["thought"],
                },
                ensure_ascii=False,
            )
            if artifact_sink is None:
                result = await action.run(action_input)
            else:
                # ChartAction owns SQL and chart capture. Bind the same sink
                # supplied by the ReAct state so its native capture path also
                # works when this adapter is called outside the normal agent loop.
                with bind_artifact_sink(artifact_sink):
                    result = await action.run(action_input)
            if not result.is_exe_success:
                schema_hint = await query_schema_hint(react_state, database_connector, normalized_sql)
                return json.dumps(
                    {
                        "success": False,
                        "error_code": "SQL_QUERY_TIMEOUT"
                        if "SQL_QUERY_TIMEOUT" in (result.content or "")
                        else "NATIVE_CHART_FAILED",
                        "recovery_schema": schema_hint,
                        "chunks": [
                            {
                                "output_type": "text",
                                "content": result.content or copy["failed"],
                            }
                        ],
                        "recovery_hint": (
                            "Inspect schema through sql_query before retrying: use "
                            "actual timestamp columns and join keys, not inferred "
                            "names. Aggregate each grain before joining to avoid "
                            "fanout. Reuse captured successful SQL results."
                        ),
                    },
                    ensure_ascii=False,
                )
            chart = _native_vis_chart_spec(result.view)
            if chart is None:
                # The native action's public result is also a structured payload.
                payload = json.loads(result.content)
                chart = {
                    "renderer": "vis-db-chart", "type": payload["display_type"],
                    "data": payload.get("data", []), "sql": payload["sql"],
                    "title": "", "describe": payload.get("thought", ""),
                }
            if artifact_sink:
                producers = [item for item in artifact_sink.snapshot()
                             if item.artifact_id not in prior_ids and item.type == "chart"
                             and item.status == "succeeded" and item.spec.get("sql") == normalized_sql]
                if producers:
                    chart["artifact_id"] = producers[-1].artifact_id
                    chart["input_artifact_ids"] = producers[-1].input_artifact_ids
            return json.dumps(
                {
                    "success": True,
                    "chunks": [
                        {
                            "output_type": "chart",
                            "content": chart,
                        }
                    ]
                },
                ensure_ascii=False,
            )
        except Exception as error:
            return json.dumps(
                {
                    "success": False,
                    "error_code": "NATIVE_CHART_FAILED",
                    "chunks": [
                        {
                            "output_type": "text",
                            "content": f"{copy['failed']}: {error}",
                        }
                    ],
                },
                ensure_ascii=False,
            )

    return chart_query
