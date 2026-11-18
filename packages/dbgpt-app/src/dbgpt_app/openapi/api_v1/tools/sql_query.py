"""sql_query tool — read-only SQL query against the selected database."""

import asyncio
import json
import re
import time
from datetime import datetime, timezone
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

from .query_artifact import (
    build_query_chunk,
    check_read_only,
)
from .sql_read_only import ReadOnlySqlError, read_only_sql
from .schema_recovery import query_schema_hint


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


def _result_coverage(columns, rows, *, preview_truncated: bool) -> Dict[str, Any]:
    """Describe returned rows only; never certify source or cohort coverage."""
    null_cells = [
        {"column_index": i, "column": name,
         "null_result_rows": sum(i < len(row) and row[i] is None for row in rows)}
        for i, name in enumerate(columns)
    ]
    return {
        "scope": "returned_result_only",
        "returned_rows": len(rows),
        "preview_truncated": preview_truncated,
        "null_columns": [cell for cell in null_cells if cell["null_result_rows"]],
        "interpretation_hint": (
            "Preserve NULL and empty-string groups separately when summarizing. "
            "These counts describe returned rows, not source records or sessions. "
            "For a full distribution, reconcile disjoint groups against a total "
            "with the same grain, filters and time window. Label requested subsets "
            "or top-N as partial; do not silently change the denominator. "
            "Reuse sufficient successful artifacts; query only missing evidence "
            "or changed freshness. This is advisory, not a quality gate."
        ),
    }


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
    empty_schema_discoveries = 0
    successful_queries: Dict[str, str] = {}
    limit_description = (
        f" Dashboard planning allows at most {max_calls} discovery calls; "
        "after that, use the collected observations and call plan_dashboard."
        " This is discovery, not the final analysis: combine compatible counts, "
        "grain and missing-value checks in one SELECT where possible. Once "
        "fields, scope, grain and requested filter values are known, plan now. "
        "Do not preview future widgets with separate ranking or trend queries; "
        "having more visual slots does not require more discovery. Query again "
        "only for unresolved semantics, date parsing, joins or data limitations."
        if max_calls is not None
        else ""
    )

    @tool(
        description=(
            "Execute one read-only SELECT/WITH SQL query on the selected database. "
            'Arguments: {"sql": "SELECT ..."}. Each query has a 30-second '
            "timeout. On an error, use the structured recovery hint to inspect "
            "schema or change the query; do not repeat a failed call unchanged."
            " For a second aggregation level, aggregate in a subquery/CTE first; "
            "do not nest aggregate calls at the same SELECT level. Valid aggregate "
            "window expressions remain supported."
            " Preserve NULL groups in distributions and reconcile totals at the "
            "same grain/scope. Reuse sufficient prior successful artifacts; "
            "re-query when evidence or freshness requires it."
            + limit_description
        )
    )
    async def sql_query(sql: str) -> str:
        """Execute a read-only SQL query against the selected database."""

        nonlocal call_count, empty_schema_discoveries
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

        sql_stripped = sql.strip().rstrip(";")
        forbidden_kw = check_read_only(sql_stripped)
        if forbidden_kw:
            return json.dumps(
                {
                    "success": False,
                    "error_code": "SQL_READ_ONLY_REQUIRED",
                    "chunks": [
                        {
                            "output_type": "text",
                            "content": f"安全限制: 不允许执行 {forbidden_kw} 语句，"
                            "仅支持 SELECT 查询。",
                        }
                    ],
                },
                ensure_ascii=False,
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
        broad_schema_query = schema_query and not re.search(
            r"\b(?:table_name|relname)\s*(?:=|~|\b(?:IN|LIKE|ILIKE|SIMILAR\s+TO)\b)",
            sql_stripped, re.IGNORECASE,
        )
        if broad_schema_query and empty_schema_discoveries >= 2:
            return json.dumps({
                "success": False,
                "error_code": "SQL_SCHEMA_DISCOVERY_EMPTY_LOOP",
                "chunks": [{"output_type": "text", "content": (
                    "Broad schema discovery returned no rows twice in this task. "
                    "This query was not executed. Check the selected database and "
                    "schema/search_path, query a known schema-qualified relation, "
                    "or target a specific table_name."
                )}],
                "recovery_hint": "Use a schema-qualified relation or a targeted metadata query.",
            }, ensure_ascii=False)
        cached = schema_cache.get(sql_stripped) if schema_query else None
        if cached and time.monotonic() - cached[0] < 60:
            if broad_schema_query and cached[1].get("schema_discovery_empty"):
                empty_schema_discoveries += 1
            return with_recovery({**cached[1], "cached_schema_result": True}, sql_stripped)
        started = time.perf_counter()
        started_at = datetime.now(timezone.utc).isoformat()
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
            duration_ms = int((time.perf_counter() - started) * 1000)
            columns = result[0] if result else []
            col_names = [str(c[0]) if isinstance(c, tuple) else str(c) for c in columns]
            rows = result[1:] if result else []
            if broad_schema_query and not rows:
                empty_schema_discoveries += 1
            elif rows:
                empty_schema_discoveries = 0

            artifact_id = capture_sql_execution(
                sql=sql_stripped,
                database=connector_database_name(database_connector, artifact_sink),
                duration_ms=duration_ms,
                columns=col_names,
                rows=rows,
                artifact_sink=artifact_sink,
            )

            header = "| " + " | ".join(col_names) + " |"
            separator = "| " + " | ".join(["---"] * len(col_names)) + " |"
            md_rows = []
            for row in rows[:50]:
                md_rows.append("| " + " | ".join(
                    "NULL" if v is None else str(v) for v in row
                ) + " |")
            table = "\n".join([header, separator] + md_rows)
            if not result:
                table = "查询返回空结果。"
            if len(rows) > 50:
                table += f"\n\n（仅显示前 50 行，共 {len(rows)} 行）"

            # Cap total output size so a single wide query can't blow out the
            # LLM context window. The full result remains available via the
            # ToolResultStorage persistence layer if it exceeds the threshold.
            preview_truncated = len(rows) > 50 or (
                max_output_chars is not None and len(table) > max_output_chars
            )
            if max_output_chars is not None and len(table) > max_output_chars:
                table = (
                    table[:max_output_chars]
                    + f"\n\n... [Output truncated at {max_output_chars} chars. "
                    f"Total rows: {len(rows)}]"
                )

            # First-class query artifact (SQL + capped full result set) rides
            # alongside the markdown observation: the client renders it as a
            # data artifact with CSV / Excel export, the model only sees the
            # compact markdown table.  db_name travels with the payload so
            # the edit & re-run endpoint can re-resolve the connector.
            chunks = [
                build_query_chunk(
                    sql_stripped,
                    col_names,
                    rows,
                    db_name=(react_state or {}).get("database_name"),
                    execution={
                        "status": "succeeded",
                        "started_at": started_at,
                        "duration_ms": duration_ms,
                        "tool": "sql_query",
                        "artifact_id": artifact_id,
                    },
                ),
                {
                    "output_type": "markdown",
                    "content": table,
                },
            ]
            react_state.setdefault("_query_artifacts", {})[artifact_id] = chunks[0][
                "content"
            ]
            # Put the handoff before row previews so a persisted-output preview
            # retains the direct loader instead of encouraging row copying.
            response = {"artifact_id": artifact_id}
            if artifact_id:
                response["python_input"] = {
                    "artifact_id": artifact_id,
                    "load": f"df = sql_result_frame({artifact_id!r})",
                    "catalog": "print(SQL_RESULT_CATALOG)",
                    "hint": (
                        "In the code tool, load this complete captured SQL result "
                        "directly rather than copying preview rows into literals. "
                        "The load records its source ID; comments alone do not. "
                        "Keep the query's grain, scope and freshness limitations."
                    ),
                }
            response.update({
                "chunks": chunks,
                "result_coverage": _result_coverage(
                    col_names, rows, preview_truncated=preview_truncated,
                ),
            })
            previous_artifact = successful_queries.get(sql_stripped)
            if previous_artifact:
                response["prior_execution"] = {
                    "artifact_id": previous_artifact,
                    "same_sql": True,
                    "reexecuted": True,
                    "hint": (
                        "This SQL already succeeded in this tool session. Reuse "
                        "the earlier artifact if scope and freshness suffice; "
                        "the current result is a fresh execution, not a cache hit."
                    ),
                }
            if sql_stripped in successful_queries or len(successful_queries) < 16:
                successful_queries[sql_stripped] = artifact_id
            if broad_schema_query and not rows:
                response["schema_discovery_empty"] = True
                response["recovery_hint"] = (
                    "No metadata rows matched. Check the selected database and "
                    "schema/search_path; use a known schema-qualified relation "
                    "or target a specific table_name."
                )
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
                "SQL_AMBIGUOUS_COLUMN" if sql_state == "42702" or "column reference" in error_text and "ambiguous" in error_text else
                "SQL_GROUPING_ERROR" if sql_state == "42803" or any(text in error_text for text in (
                    "aggregate function calls cannot be nested", "misuse of aggregate function", "must appear in the group by clause",
                )) else
                "SQL_QUERY_FAILED"
            )
            message = (
                f"{code}: Query exceeded {query_timeout_seconds:g} seconds; cancellation requested. "
                "Inspect the query plan and indexes before retrying."
                if timed_out
                else f"{code}: SQL execution failed: {e}"
            )
            recovery_hint = (
                "Aggregate functions cannot be nested at the same SELECT level. "
                "Compute the inner aggregate in a subquery/CTE at its intended grain, "
                "then aggregate those named results in an outer SELECT. For a grouped "
                "column error, group or aggregate the selected column at the requested "
                "grain. Preserve DISTINCT keys, filters, NULL semantics and time scope; "
                "summing group counts is not a global distinct count when groups overlap. "
                "Window aggregates such as SUM(COUNT(*)) OVER (...) can be valid; "
                "do not remove valid window logic or rerun unchanged failed SQL."
                if code == "SQL_GROUPING_ERROR" else
                "PostgreSQL UNION ORDER BY accepts output column names only. "
                "Wrap the UNION in a subquery/CTE, then sort by the expression, "
                "or project a sort_key in every branch and ORDER BY sort_key."
                if "invalid union/intersect/except order by" in error_text else
                "PostgreSQL does not require FROM dual. Remove it and select the expression directly."
                if code == "SQL_UNDEFINED_TABLE" and re.search(r"\bfrom\s+dual\b", sql_stripped, re.IGNORECASE) else
                "Inspect information_schema.tables/views and use a schema-qualified name, "
                "for example funnelmetry_demo.browser_events."
                if code == "SQL_UNDEFINED_TABLE" else
                "Inspect information_schema.columns for the named view; use its actual "
                "columns and grain before rewriting the query."
                if code == "SQL_UNDEFINED_COLUMN" else
                "Qualify the column with the correct table or CTE alias in joins."
                if code == "SQL_AMBIGUOUS_COLUMN" else
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
            duration_ms = int((time.perf_counter() - started) * 1000)
            artifact_id = capture_sql_execution(
                sql=sql_stripped,
                database=connector_database_name(database_connector, artifact_sink),
                duration_ms=duration_ms,
                error=message,
                artifact_sink=artifact_sink,
            )
            schema_hint = await query_schema_hint(react_state, database_connector, sql_stripped) if code in {
                "SQL_UNDEFINED_COLUMN", "SQL_UNDEFINED_TABLE", "SQL_AMBIGUOUS_COLUMN"
            } else None
            return with_recovery(
                {
                    "chunks": [
                        {
                            "output_type": "text",
                            "content": message,
                        },
                        build_query_chunk(
                            sql_stripped,
                            [],
                            [],
                            db_name=(react_state or {}).get("database_name"),
                            execution={
                                "status": "failed",
                                "started_at": started_at,
                                "duration_ms": duration_ms,
                                "tool": "sql_query",
                                "artifact_id": artifact_id,
                                "error": message,
                            },
                        ),
                    ],
                    "error_code": code,
                    **({"recovery_schema": schema_hint} if schema_hint else {}),
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
