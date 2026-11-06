import json
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import patch

from dbgpt_app.openapi.api_v1.tools.sql_query import make_sql_query
from dbgpt.datasource.rdbms.base import RDBMSConnector


class _Connector:
    def __init__(self) -> None:
        self.calls = 0

    def run(self, _sql: str):
        self.calls += 1
        return [[("value",)], [self.calls]]


def test_postgres_query_uses_server_side_timeout_path():
    connector = object.__new__(RDBMSConnector)
    connector._engine = SimpleNamespace(dialect=SimpleNamespace(name="postgresql"))
    connector._is_closed = True
    observed = []

    def query_ex(_self, sql, *, timeout=None, cancel_event=None):
        observed.append((sql, timeout, cancel_event is not None))
        return ["value"], [(1,)]

    with patch.object(RDBMSConnector, "query_ex", query_ex), patch(
        "dbgpt_app.openapi.api_v1.tools.sql_query.connector_database_name",
        return_value="test",
    ), patch(
        "dbgpt_app.openapi.api_v1.tools.sql_query.capture_sql_execution",
        return_value="artifact-test",
    ):
        result = json.loads(make_sql_query({}, connector, query_timeout_seconds=7)(sql="SELECT 1"))

    assert result["artifact_id"] == "artifact-test"
    assert observed == [("SELECT 1", 7, True)]


def test_postgres_timeout_is_transaction_local_and_does_not_reset_session():
    connector = object.__new__(RDBMSConnector)
    connector._engine = SimpleNamespace(dialect=SimpleNamespace(name="postgresql"))
    connector._is_closed = True
    statements = []

    class Session:
        def execute(self, statement, _params=None):
            statements.append(str(statement))
            return SimpleNamespace(returns_rows=True, fetchall=lambda: [(1,)],
                                   keys=lambda: ["value"])

    @contextmanager
    def session_scope(_self):
        yield Session()

    with patch.object(RDBMSConnector, "session_scope", session_scope):
        columns, rows = connector.query_ex("SELECT 1", timeout=7)
    assert (columns, rows) == (["value"], [(1,)])
    assert statements == ["SET LOCAL statement_timeout = 7000", "SELECT 1"]


def test_early_sql_errors_are_tracked_for_recovery():
    state = {}
    query = make_sql_query(state, None)
    first = json.loads(query(sql="SELECT 1"))
    second = json.loads(query(sql="SELECT 1"))
    assert first["error_code"] == "SQL_DATASOURCE_REQUIRED"
    assert second["tool_recovery"]["reason"] == "same_call_failed"

    query = make_sql_query({}, _Connector())
    assert json.loads(query(sql="DELETE FROM orders"))["error_code"] == "SQL_READ_ONLY_REQUIRED"


def test_dashboard_sql_query_limit_is_enforced_before_connector_execution():
    connector = _Connector()
    sql_query = make_sql_query({}, connector, max_calls=2)

    first = json.loads(sql_query(sql="SELECT 1"))
    second = json.loads(sql_query(sql="SELECT 2"))
    limited = json.loads(sql_query(sql="SELECT 3"))

    assert first["chunks"][0]["output_type"] == "markdown"
    assert second["chunks"][0]["output_type"] == "markdown"
    assert connector.calls == 2
    assert limited["dashboard_discovery_limit_reached"] is True
    assert "call plan_dashboard now" in limited["chunks"][0]["content"]


def test_zero_limit_blocks_sql_on_dashboard_confirmation_turns():
    connector = _Connector()
    sql_query = make_sql_query({}, connector, max_calls=0)

    limited = json.loads(sql_query(sql="SELECT 1"))

    assert connector.calls == 0
    assert limited["dashboard_discovery_limit_reached"] is True


def test_failed_sql_is_not_executed_a_third_time_and_another_query_can_run():
    class Connector:
        def __init__(self):
            self.calls = []

        def run(self, sql):
            self.calls.append(sql)
            if "missing" in sql:
                raise RuntimeError('relation "missing" does not exist')
            return [[("value",)], [1]]

    connector = Connector()
    sql_query = make_sql_query({}, connector)
    first = json.loads(sql_query(sql="SELECT * FROM missing"))
    second = json.loads(sql_query(sql="SELECT * FROM missing"))
    third = json.loads(sql_query(sql="SELECT * FROM missing"))
    changed = json.loads(sql_query(sql="SELECT 1"))

    assert first["error_code"] == "SQL_UNDEFINED_TABLE"
    assert "information_schema" in first["recovery_hint"]
    assert second["tool_recovery"]["reason"] == "same_call_failed"
    assert third["error_code"] == "SQL_REPEATED_FAILURE"
    assert len(connector.calls) == 3
    assert "artifact_id" in changed


def test_sql_same_error_with_different_query_suggests_recovery_without_blocking():
    class Connector:
        def __init__(self):
            self.calls = 0

        def run(self, sql):
            self.calls += 1
            raise RuntimeError('column "session_id" does not exist')

    connector = Connector()
    sql_query = make_sql_query({}, connector)
    first = json.loads(sql_query(sql="SELECT session_id FROM one"))
    second = json.loads(sql_query(sql="SELECT session_id FROM two"))
    assert first["error_code"] == "SQL_UNDEFINED_COLUMN"
    assert second["tool_recovery"]["reason"] == "same_error_recurred"
    assert connector.calls == 2


def test_schema_discovery_reuses_result_but_business_sql_stays_live():
    connector = _Connector()
    query = make_sql_query({}, connector)
    metadata_sql = "SELECT column_name FROM information_schema.columns"
    first = json.loads(query(sql=metadata_sql))
    second = json.loads(query(sql=metadata_sql))
    query(sql="SELECT 1")
    query(sql="SELECT 1")

    assert first["artifact_id"] == second["artifact_id"]
    assert second["cached_schema_result"] is True
    assert connector.calls == 3


def test_quality_block_is_exposed_as_a_warning_not_a_zero_count():
    class Connector:
        def run(self, _sql):
            return [[("status",), ("product_count",)], ["BLOCKED_BY_QUALITY", None]]

    result = json.loads(make_sql_query({}, Connector())(sql="SELECT 1"))
    assert result["quality_warning"]["status"] == "BLOCKED_BY_QUALITY"
    assert "not zero" in result["chunks"][0]["content"]
    assert "BLOCKED_BY_QUALITY" in result["chunks"][1]["content"]


def test_null_or_unrelated_status_text_does_not_trigger_quality_warning():
    class Connector:
        def run(self, _sql):
            return [[("description",), ("product_count",)], ["BLOCKED_BY_QUALITY", None]]

    result = json.loads(make_sql_query({}, Connector())(sql="SELECT 1"))
    assert "quality_warning" not in result


def test_passing_quality_with_zero_is_not_blocked():
    class Connector:
        def run(self, _sql):
            return [[("status",), ("product_count",)], ["REFERENCE_CURRENT_ONLY", 0]]

    result = json.loads(make_sql_query({}, Connector())(sql="SELECT 1"))
    assert "quality_warning" not in result


def test_quality_warning_survives_table_row_and_output_truncation():
    class Connector:
        def run(self, _sql):
            return [[("status",), ("product_count",)]] + [
                ["REFERENCE_CURRENT_ONLY", i] for i in range(51)
            ] + [["BLOCKED_BY_QUALITY", None]]

    result = json.loads(make_sql_query({}, Connector(), max_output_chars=20)(sql="SELECT 1"))
    assert result["quality_warning"]["status"] == "BLOCKED_BY_QUALITY"
    assert "not zero" in result["chunks"][0]["content"]


def test_selecting_only_null_count_cannot_identify_quality_block():
    class Connector:
        def run(self, _sql):
            return [[("product_count",)], [None]]

    result = json.loads(make_sql_query({}, Connector())(sql="SELECT product_count FROM summary"))
    # Document the known gap: arbitrary SQL can omit the status altogether.
    assert "quality_warning" not in result


def test_database_quality_block_is_a_structured_error():
    class Connector:
        def run(self, _sql):
            raise RuntimeError("BLOCKED_BY_QUALITY: product count is unavailable")

    result = json.loads(make_sql_query({}, Connector())(sql="SELECT product_count FROM summary"))
    assert result["success"] is False
    assert result["error_code"] == "BLOCKED_BY_QUALITY"
    assert "unavailable" in result["chunks"][0]["content"]


def test_quality_block_does_not_prevent_an_independent_query():
    class Connector:
        def run(self, sql):
            if "blocked_catalog" in sql:
                raise RuntimeError("BLOCKED_BY_QUALITY: catalog unavailable")
            return [[("value",)], [7]]

    query = make_sql_query({}, Connector())
    blocked = json.loads(query(sql="SELECT * FROM blocked_catalog"))
    independent = json.loads(query(sql="SELECT 7 AS value"))
    assert blocked["error_code"] == "BLOCKED_BY_QUALITY"
    assert "7" in independent["chunks"][0]["content"]
    assert "error_code" not in independent
