"""sql_query tool — read-only SQL query against the selected database."""

import asyncio
import json
import re
import time
from functools import wraps
from threading import Event
from typing import Any, Dict, Optional

from dbgpt.agent.resource.tool.base import tool
from dbgpt.core.interface.report_capture import (
    capture_sql_execution,
    connector_database_name,
)
from dbgpt.datasource.rdbms.base import RDBMSConnector
from dbgpt.agent.expand.tool_recovery import observe_tool_result, repeated_failure

from .sql_read_only import ReadOnlySqlError, read_only_sql


def _supports_bounded_query(connector: Any) -> bool:
    """Use ``query_ex`` only for connectors backed by its SQLAlchemy session.

    ``ClickhouseConnector`` and other dedicated-client subclasses inherit
    ``query_ex`` from ``RDBMSConnector`` but do not own its SQLAlchemy session
    pool. They must use their own ``run`` implementation instead. PostgreSQL's
    query_ex applies a server-side statement timeout; SQLite supports
    cooperative cancellation.
    """
    return (
        isinstance(connector, RDBMSConnector)
        and type(connector).run is RDBMSConnector.run
        and type(connector).query_ex is RDBMSConnector.query_ex
        and connector.dialect in {"sqlite", "postgresql"}
    )


def make_sql_query(
    react_state: Dict[str, Any],
    database_connector: Optional[Any],
    *,
    max_output_chars: Optional[int] = 20_000,
    query_timeout_seconds: float = 30,
    max_calls: Optional[int] = None,
):
    call_count = 0
    schema_cache: Dict[str, Any] = {}
    limit_description = (
        f" Dashboard planning allows at most {max_calls} discovery calls; "
        "after that, use the collected observations and call plan_dashboard."
        if max_calls is not None
        else ""
    )

    @tool(
        description=(
            "Execute one read-only SELECT/WITH SQL query on the selected database. "
            'Arguments: {"sql": "SELECT ..."}. Each query has a 30-second '
            "timeout. On an error, use the structured recovery hint to inspect "
            "schema or change the query; do not repeat a failed call unchanged."
            + limit_description
        )
    )
    async def sql_query(sql: str) -> str:
        """Execute a read-only SQL query against the selected database."""

        nonlocal call_count
        def with_recovery(payload: Dict[str, Any], query: str) -> str:
            signal = observe_tool_result(
                react_state, "sql_query", query,
                success=payload.get("success") is not False,
                error_code=payload.get("error_code"),
            )
            if signal:
                payload["tool_recovery"] = signal
            return json.dumps(payload, ensure_ascii=False)

        if max_calls is not None and call_count >= max_calls:
            return json.dumps(
                {
                    "chunks": [
                        {
                            "output_type": "text",
                            "content": (
                                "Dashboard discovery limit reached after "
                                f"{max_calls} SQL queries. Do not call sql_query "
                                "again in this turn. Use the observations already "
                                "collected and call plan_dashboard now. If plan "
                                "validation rejects a field or default, correct the "
                                "plan from that validation feedback instead of "
                                "restarting discovery."
                            ),
                        }
                    ],
                    "dashboard_discovery_limit_reached": True,
                },
                ensure_ascii=False,
            )
        call_count += 1

        artifact_sink = react_state.get("_report_artifact_sink")
        if database_connector is None:
            return with_recovery(
                {
                    "success": False,
                    "error_code": "SQL_DATASOURCE_REQUIRED",
                    "chunks": [
                        {
                            "output_type": "text",
                            "content": "Select a data source before querying.",
                        }
                    ],
                    "recovery_hint": "Choose an available database, then retry.",
                },
                sql,
            )

        try:
            sql_stripped = read_only_sql(sql)
        except ReadOnlySqlError:
            return with_recovery(
                {
                    "success": False,
                    "error_code": "SQL_READ_ONLY_REQUIRED",
                    "chunks": [
                        {
                            "output_type": "text",
                            "content": "Only one read-only SELECT/WITH query or its EXPLAIN is supported.",
                        }
                    ],
                },
                sql,
            )
        if repeated_failure(react_state, "sql_query", sql_stripped):
            return with_recovery({
                "success": False,
                "error_code": "SQL_REPEATED_FAILURE",
                "chunks": [{"output_type": "text", "content": (
                    "This identical SQL already failed twice in this task. "
                    "It was not executed again. Inspect the reported error and "
                    "schema, change the SQL, or use the valid results collected."
                )}],
                "recovery_hint": "Inspect information_schema.columns or use a schema-qualified view.",
            }, sql_stripped)
        # Schema discovery is stable within a short task window. Reuse only
        # these read-only metadata results; business queries can change live.
        schema_query = (
            max_calls is None and
            bool(re.search(
                r"\bFROM\s+(?:information_schema|pg_catalog)\.",
                sql_stripped, re.IGNORECASE,
            )) and
            not re.search(r"\b(?:JOIN|UNION)\b", sql_stripped, re.IGNORECASE)
        )
        cached = schema_cache.get(sql_stripped) if schema_query else None
        if cached and time.monotonic() - cached[0] < 60:
            return with_recovery({**cached[1], "cached_schema_result": True}, sql_stripped)
        started = time.perf_counter()
        cancel_event = Event()
        try:
            if _supports_bounded_query(database_connector):

                async def execute():
                    columns, rows = await asyncio.to_thread(
                        database_connector.query_ex,
                        sql_stripped,
                        timeout=query_timeout_seconds,
                        cancel_event=cancel_event,
                    )
                    return [columns, *(rows or [])]
            else:

                async def execute():
                    return await asyncio.to_thread(database_connector.run, sql_stripped)

            result = await asyncio.wait_for(execute(), timeout=query_timeout_seconds)
            if not result:
                artifact_id = capture_sql_execution(
                    sql=sql_stripped,
                    database=connector_database_name(database_connector, artifact_sink),
                    duration_ms=int((time.perf_counter() - started) * 1000),
                    columns=[],
                    rows=[],
                    artifact_sink=artifact_sink,
                )
                return with_recovery(
                    {
                        "artifact_id": artifact_id,
                        "chunks": [
                            {"output_type": "text", "content": "Query returned no rows."}
                        ],
                    },
                    sql_stripped,
                )

            columns = result[0]
            col_names = [str(c[0]) if isinstance(c, tuple) else str(c) for c in columns]
            rows = result[1:]

            artifact_id = capture_sql_execution(
                sql=sql_stripped,
                database=connector_database_name(database_connector, artifact_sink),
                duration_ms=int((time.perf_counter() - started) * 1000),
                columns=col_names,
                rows=rows,
                artifact_sink=artifact_sink,
            )

            header = "| " + " | ".join(col_names) + " |"
            separator = "| " + " | ".join(["---"] * len(col_names)) + " |"
            md_rows = []
            for row in rows[:50]:
                md_rows.append("| " + " | ".join(str(v) for v in row) + " |")
            table = "\n".join([header, separator] + md_rows)
            if len(rows) > 50:
                table += f"\n\n（仅显示前 50 行，共 {len(rows)} 行）"

            # Cap total output size so a single wide query can't blow out the
            # LLM context window. The full result remains available via the
            # ToolResultStorage persistence layer if it exceeds the threshold.
            if max_output_chars is not None and len(table) > max_output_chars:
                table = (
                    table[:max_output_chars]
                    + f"\n\n... [Output truncated at {max_output_chars} chars. "
                    f"Total rows: {len(rows)}]"
                )

            response = {
                "artifact_id": artifact_id,
                "chunks": [{"output_type": "markdown", "content": table}],
            }
            # A returned quality status is evidence, not an empty dataset. Do
            # not infer a gate from arbitrary NULLs or from SQL text alone.
            quality_columns = [
                i for i, name in enumerate(col_names)
                if name.lower() in ("status", "quality_status")
            ]
            if any(
                i < len(row) and row[i] == "BLOCKED_BY_QUALITY"
                for row in rows for i in quality_columns
            ):
                response["quality_warning"] = {
                    "status": "BLOCKED_BY_QUALITY",
                    "message": (
                        "A returned result is blocked by data quality. Its NULL "
                        "values mean unavailable, not zero or absence of data. "
                        "Do not report a count or infer a change for the blocked "
                        "scope; explain the quality limitation to the user."
                    ),
                }
                response["chunks"].insert(0, {
                    "output_type": "text",
                    "content": response["quality_warning"]["message"],
                })
            if schema_query and len(schema_cache) < 16:
                schema_cache[sql_stripped] = (time.monotonic(), response)
            return with_recovery(response, sql_stripped)
        except asyncio.CancelledError:
            cancel_event.set()
            capture_sql_execution(
                sql=sql_stripped,
                database=connector_database_name(database_connector, artifact_sink),
                duration_ms=int((time.perf_counter() - started) * 1000),
                error="SQL_QUERY_CANCELLED: upper-level task cancelled the query",
                artifact_sink=artifact_sink,
            )
            raise
        except Exception as e:
            if str(e).startswith("ARTIFACT_CAPTURE_FAILED:"):
                return json.dumps(
                    {
                        "success": False,
                        "error_code": "ARTIFACT_CAPTURE_FAILED",
                        "chunks": [{"output_type": "text", "content": str(e)}],
                    },
                    ensure_ascii=False,
                )
            cancel_event.set()
            timed_out = isinstance(e, TimeoutError)
            quality_blocked = "BLOCKED_BY_QUALITY:" in str(e)
            db_error = getattr(e, "orig", e)
            sql_state = getattr(db_error, "pgcode", None) or getattr(db_error, "sqlstate", None)
            error_text = str(e).lower()
            code = (
                "SQL_QUERY_TIMEOUT" if timed_out else
                "BLOCKED_BY_QUALITY" if quality_blocked else
                "SQL_UNDEFINED_TABLE" if sql_state == "42P01" or "does not exist" in error_text and "relation" in error_text else
                "SQL_UNDEFINED_COLUMN" if sql_state == "42703" or "column" in error_text and "does not exist" in error_text else
                "SQL_QUERY_FAILED"
            )
            message = (
                f"{code}: Query exceeded {query_timeout_seconds:g} seconds; cancellation requested. "
                "Inspect the query plan and indexes before retrying."
                if timed_out
                else f"{code}: SQL execution failed: {e}"
            )
            recovery_hint = (
                "Inspect information_schema.tables/views and use a schema-qualified name, "
                "for example funnelmetry_demo.browser_events."
                if code == "SQL_UNDEFINED_TABLE" else
                "Inspect information_schema.columns for the named view; use its actual "
                "columns and grain before rewriting the query."
                if code == "SQL_UNDEFINED_COLUMN" else
                "Inspect EXPLAIN and narrow the query before retrying."
                if timed_out else None
            )
            if quality_blocked:
                message = (
                    "BLOCKED_BY_QUALITY: The requested data is unavailable "
                    "because its quality check failed. Explain this limitation; "
                    "do not use unverified raw data as a confirmed substitute. "
                    "Independent data with its own valid quality contract may "
                    "still be analyzed, with its scope clearly identified."
                )
            capture_sql_execution(
                sql=sql_stripped,
                database=connector_database_name(database_connector, artifact_sink),
                duration_ms=int((time.perf_counter() - started) * 1000),
                error=message,
                artifact_sink=artifact_sink,
            )
            return with_recovery(
                {
                    "chunks": [
                        {
                            "output_type": "text",
                            "content": message,
                        }
                    ],
                    "error_code": code,
                    "success": False,
                    **({"recovery_hint": recovery_hint} if recovery_hint else {}),
                },
                sql_stripped,
            )

    @wraps(sql_query)
    def invoke_sql_query(*args, **kwargs):
        # Preserve direct synchronous callers while agents use the asynchronous
        # FunctionTool copied by wraps. Its coroutine keeps timeout/cancellation.
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return asyncio.run(sql_query(*args, **kwargs))
        return sql_query(*args, **kwargs)

    return invoke_sql_query
