"""RUN18-08: preserve missing-value groups without restricting native SQL."""

import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from dbgpt_app.openapi.api_v1.tools import sql_query as module


class Connector:
    def __init__(self, path):
        self.path = path
        self.calls = 0

    def run(self, sql):
        self.calls += 1
        with sqlite3.connect(self.path) as db:
            cursor = db.execute(sql)
            return [[item[0] for item in cursor.description], *cursor.fetchall()]


class DistributionCoverageTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = str(Path(self.temp.name) / "fixture.db")
        with sqlite3.connect(self.path) as db:
            db.execute("CREATE TABLE sessions(utm_source TEXT, n INTEGER)")
            db.executemany("INSERT INTO sessions VALUES (?, ?)", [
                ("facebook", 23971), ("tiktok", 19976), ("zalo", 11975),
                ("other", 34138), (None, 9940),
            ])
        self.connector = Connector(self.path)
        self.state = {}
        self.ids = iter(f"fixture-{i}" for i in range(100))
        self.capture = patch.object(
            module, "capture_sql_execution", side_effect=lambda **_: next(self.ids),
        )
        self.capture.start()
        self.addCleanup(self.capture.stop)
        self.query = module.make_sql_query(self.state, self.connector)

    def execute(self, sql):
        return json.loads(self.query(sql=sql))

    def test_null_group_remains_in_artifact_and_observation(self):
        result = self.execute("SELECT utm_source, SUM(n) AS n FROM sessions GROUP BY utm_source")
        self.assertIn([None, 9940], result["chunks"][0]["content"]["rows"])
        self.assertIn("| NULL | 9940 |", result["chunks"][1]["content"])
        self.assertEqual(result["result_coverage"]["null_columns"], [
            {"column_index": 0, "column": "utm_source", "null_result_rows": 1},
        ])
        self.assertNotIn("quality_warning", result)

    def test_sql_reconciles_all_groups_and_subset_denominator(self):
        result = self.execute(
            "SELECT SUM(n) AS total, SUM(CASE WHEN utm_source IN "
            "('facebook','tiktok','zalo') THEN n ELSE 0 END) AS selected, "
            "SUM(CASE WHEN utm_source IS NULL THEN n ELSE 0 END) AS missing, "
            "SUM(CASE WHEN utm_source = 'other' THEN n ELSE 0 END) AS other "
            "FROM sessions"
        )
        self.assertEqual(result["chunks"][0]["content"]["rows"], [[100000, 55922, 9940, 34138]])
        reconciliation = self.execute(
            "SELECT (SELECT SUM(n) FROM (SELECT SUM(n) AS n FROM sessions "
            "GROUP BY utm_source)) = (SELECT SUM(n) FROM sessions) AS reconciles"
        )
        self.assertEqual(reconciliation["chunks"][0]["content"]["rows"], [[1]])

    def test_blank_and_literal_null_are_not_sql_null(self):
        with sqlite3.connect(self.path) as db:
            db.executemany("INSERT INTO sessions VALUES (?, 1)", [("",), ("NULL",)])
        result = self.execute("SELECT utm_source FROM sessions")
        rows = result["chunks"][0]["content"]["rows"]
        self.assertIn([""], rows)
        self.assertIn(["NULL"], rows)
        self.assertEqual(result["result_coverage"]["null_columns"][0]["null_result_rows"], 1)

    def test_repeat_is_fresh_execution_with_prior_artifact_hint(self):
        sql = "SELECT SUM(n) AS total FROM sessions"
        first = self.execute(sql)
        with sqlite3.connect(self.path) as db:
            db.execute("INSERT INTO sessions VALUES ('new', 7)")
        second = self.execute(sql)
        self.assertEqual(self.connector.calls, 2)
        self.assertEqual(second["chunks"][0]["content"]["rows"], [[100007]])
        self.assertEqual(second["prior_execution"]["artifact_id"], first["artifact_id"])
        self.assertTrue(second["prior_execution"]["reexecuted"])
        self.assertNotEqual(first["artifact_id"], second["artifact_id"])

    def test_changed_query_and_new_tool_have_no_false_reuse_hint(self):
        self.execute("SELECT SUM(n) FROM sessions")
        changed = self.execute("SELECT SUM(n) FROM sessions WHERE utm_source IS NOT NULL")
        self.assertNotIn("prior_execution", changed)
        separate = module.make_sql_query({}, self.connector)
        self.assertNotIn("prior_execution", json.loads(separate(sql="SELECT SUM(n) FROM sessions")))

    def test_preview_truncation_does_not_claim_source_coverage(self):
        result = self.execute(
            "WITH RECURSIVE numbers(n) AS (SELECT 1 UNION ALL "
            "SELECT n+1 FROM numbers WHERE n<60) SELECT n FROM numbers"
        )
        coverage = result["result_coverage"]
        self.assertEqual(coverage["returned_rows"], 60)
        self.assertTrue(coverage["preview_truncated"])
        self.assertEqual(coverage["scope"], "returned_result_only")
        self.assertEqual(len(result["chunks"][0]["content"]["rows"]), 60)
        short = module.make_sql_query({}, self.connector, max_output_chars=10)
        self.assertTrue(json.loads(short(sql="SELECT * FROM sessions"))["result_coverage"]["preview_truncated"])

    def test_empty_result_and_count_semantics(self):
        empty = self.execute("SELECT * FROM sessions WHERE 1=0")
        self.assertEqual(empty["result_coverage"]["returned_rows"], 0)
        self.assertEqual(empty["result_coverage"]["null_columns"], [])
        counts = self.execute("SELECT COUNT(*), COUNT(utm_source) FROM sessions")
        self.assertEqual(counts["chunks"][0]["content"]["rows"], [[5, 4]])

    def test_failure_is_not_registered_as_successful_evidence(self):
        sql = "SELECT * FROM nonexistent"
        first = self.execute(sql)
        second = self.execute(sql)
        self.assertFalse(first["success"])
        self.assertNotIn("prior_execution", second)


if __name__ == "__main__":
    unittest.main()
