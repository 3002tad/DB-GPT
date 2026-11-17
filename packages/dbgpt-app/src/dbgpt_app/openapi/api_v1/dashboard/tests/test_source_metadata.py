"""E2E-02: schema discovery and SQL validation share the actual read scope."""

import unittest
from types import SimpleNamespace

from dbgpt_app.openapi.api_v1.dashboard.query_executor import DashboardQueryExecutor
from dbgpt_app.openapi.api_v1.dashboard.source_metadata import (
    readable_source_tables,
    source_table_context,
)
from dbgpt_app.openapi.api_v1.dashboard.sql_security import (
    DashboardSQLSecurityError,
    validate_read_only_sql,
)
from dbgpt_app.openapi.api_v1.dashboard.temporal_discovery import (
    collect_temporal_evidence,
)


def connector(rows, **options):
    return SimpleNamespace(
        dialect="postgresql", _schema="funnelmetry_ai",
        query_ex=lambda sql, timeout: ([], rows), **options,
    )


class SourceMetadataTest(unittest.TestCase):
    def setUp(self):
        self.source = connector([
            ("funnelmetry_ai", "sessions", True, "catalog_id", "text"),
            ("funnelmetry_demo", "sessions", False, "session_id", "text"),
            ("funnelmetry_demo", "sessions", False, "started_at", "timestamp"),
        ])

    def test_plan_and_validator_see_the_same_qualified_demo_relation(self):
        context = source_table_context(self.source)
        self.assertIn(
            "funnelmetry_demo.sessions (session_id text, started_at timestamp)", context
        )
        tables, columns = DashboardQueryExecutor()._allowlists(self.source, "source")
        result = validate_read_only_sql(
            'WITH s AS (SELECT session_id FROM "funnelmetry_demo"."sessions") '
            'SELECT COUNT(*) FROM s',
            dialect="postgres", allowed_tables=tables, allowed_columns=columns,
        )
        self.assertEqual(result.tables, {"funnelmetry_demo.sessions"})

    def test_unknown_schema_cannot_borrow_an_allowed_leaf_name(self):
        tables, columns = DashboardQueryExecutor()._allowlists(self.source, "source")
        for name in (
            "public.sessions", "private.sessions", "other_db.funnelmetry_demo.sessions"
        ):
            with self.subTest(name=name), self.assertRaises(DashboardSQLSecurityError):
                validate_read_only_sql(
                    f"SELECT COUNT(*) FROM {name}", dialect="postgres",
                    allowed_tables=tables, allowed_columns=columns,
                )

    def test_unqualified_alias_only_for_search_path_visible_relation(self):
        entries = readable_source_tables(self.source)
        self.assertEqual(entries[0]["aliases"], ["sessions"])
        self.assertEqual(entries[1]["aliases"], [])
        only_demo = connector([
            ("funnelmetry_demo", "sessions", False, "session_id", "text")
        ])
        tables, _ = DashboardQueryExecutor()._allowlists(only_demo, "source")
        with self.assertRaises(DashboardSQLSecurityError):
            validate_read_only_sql(
                "SELECT * FROM sessions", dialect="postgres", allowed_tables=tables
            )

    def test_explicit_include_does_not_expand_to_other_schemas(self):
        self.source._include_tables = {"sessions"}
        self.assertEqual(
            [x["name"] for x in readable_source_tables(self.source)],
            ["funnelmetry_ai.sessions"],
        )
        self.source._include_tables = {"funnelmetry_demo.sessions"}
        self.assertEqual(
            [x["name"] for x in readable_source_tables(self.source)],
            ["funnelmetry_demo.sessions"],
        )

    def test_explicit_ignore_is_respected(self):
        self.source._ignore_tables = {"funnelmetry_demo.sessions"}
        self.assertEqual(
            [x["name"] for x in readable_source_tables(self.source)],
            ["funnelmetry_ai.sessions"],
        )

    def test_inventory_failure_is_not_replaced_with_partial_catalog(self):
        def fail(sql, timeout):
            raise TimeoutError("metadata timeout")
        self.source.query_ex = fail
        with self.assertRaises(TimeoutError):
            readable_source_tables(self.source)

    def test_no_readable_relations_means_empty_allowlist(self):
        self.assertEqual(
            DashboardQueryExecutor()._allowlists(connector([]), "source"), ([], [])
        )

    def test_sqlite_inventory_and_fields_remain_native(self):
        sqlite = SimpleNamespace(
            dialect="sqlite", get_table_names=lambda: ["orders"],
            get_fields=lambda name, source: [("amount", "NUMERIC")],
        )
        entry = readable_source_tables(sqlite)[0]
        self.assertEqual(entry["name"], "orders")
        self.assertEqual(entry["columns"], [{"name": "amount", "type": "NUMERIC"}])

    def test_temporal_probes_compile_schema_and_relation_separately(self):
        from sqlalchemy.dialects.postgresql import dialect

        calls = []

        def query(sql, timeout):
            calls.append(sql)
            if "pg_catalog.pg_class" in sql:
                return [], [("demo", "sessions", False, "started_at", "timestamp")]
            if "count(" in sql.lower():
                return [], [(1, 1, 1)]
            return [], [("2026-01-01 00:00:00",)]

        source = connector([])
        source.query_ex = query
        source._engine = SimpleNamespace(dialect=dialect())
        evidence = collect_temporal_evidence(source)
        self.assertEqual(evidence["columns"][0]["table"], "demo.sessions")
        self.assertEqual(evidence["columns"][0]["source_distinct_count"], 1)
        self.assertTrue(all("FROM demo.sessions" in sql for sql in calls[1:]))


if __name__ == "__main__":
    unittest.main()
