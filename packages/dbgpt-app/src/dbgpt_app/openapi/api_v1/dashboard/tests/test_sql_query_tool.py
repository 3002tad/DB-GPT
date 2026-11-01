import json

from dbgpt_app.openapi.api_v1.tools.sql_query import make_sql_query


class _Connector:
    def __init__(self) -> None:
        self.calls = 0

    def run(self, _sql: str):
        self.calls += 1
        return [[("value",)], [self.calls]]


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
