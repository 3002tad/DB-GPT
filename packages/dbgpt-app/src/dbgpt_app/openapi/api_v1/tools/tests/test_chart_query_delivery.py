"""Native chart payloads must reach chat without model reconstruction or requery."""

import json
import sqlite3

import pytest

from dbgpt.core.interface.report_capture import ArtifactCaptureContext, InMemoryArtifactSink
from dbgpt_ext.datasource.rdbms.conn_sqlite import SQLiteConnector
from dbgpt_app.openapi.api_v1.tools.chart_query import make_chart_query
from dbgpt_app.openapi.api_v1.harness_pi_stream import _embedded_artifact_outputs


@pytest.mark.asyncio
@pytest.mark.parametrize("display_type", ["response_line_chart", "response_bar_chart", "response_table"])
@pytest.mark.parametrize("empty", [False, True])
async def test_native_sql_chart_is_typed_and_preserves_rows_and_lineage(tmp_path, display_type, empty):
    path = tmp_path / "charts.db"
    with sqlite3.connect(path) as db:
        db.execute("CREATE TABLE monthly (month TEXT, sessions INTEGER)")
        db.executemany("INSERT INTO monthly VALUES (?, ?)", [("2025-11", 7327), ("2025-12", 8965)])
    connector = SQLiteConnector.from_file_path(str(path))
    sink = InMemoryArtifactSink(ArtifactCaptureContext(conv_uid="chart-delivery"))
    state = {"_ui_locale": "vi", "_report_artifact_sink": sink}
    sql = "SELECT month, sessions FROM monthly" + (" WHERE 0" if empty else "") + " ORDER BY month"
    try:
        result = json.loads(await make_chart_query(state, connector)(sql=sql, display_type=display_type, thought="Phiên theo tháng"))
    finally:
        connector.close()
    assert result["success"] is True, result
    assert len(result["chunks"]) == 1
    assert result["chunks"][0]["output_type"] == "chart"
    chart = result["chunks"][0]["content"]
    assert chart["renderer"] == "vis-db-chart"
    assert chart["type"] == display_type
    assert chart["sql"] == sql
    assert chart["data"] == ([] if empty else [{"month": "2025-11", "sessions": 7327}, {"month": "2025-12", "sessions": 8965}])
    snapshots = sink.snapshot()
    assert len([item for item in snapshots if item.type == "sql"]) == 1
    producer = next(item for item in snapshots if item.type == "chart")
    assert producer.status == "succeeded"
    assert chart["artifact_id"] == producer.artifact_id
    assert chart["input_artifact_ids"] == producer.input_artifact_ids
    assert _embedded_artifact_outputs(json.dumps(result)) == result["chunks"]


@pytest.mark.asyncio
async def test_failed_query_does_not_emit_a_chart(tmp_path):
    connector = SQLiteConnector.from_file_path(str(tmp_path / "failed.db"))
    try:
        result = json.loads(await make_chart_query({}, connector)(sql="SELECT missing_column FROM missing_table"))
    finally:
        connector.close()
    assert result["success"] is False
    assert not any(chunk["output_type"] == "chart" for chunk in result["chunks"])
