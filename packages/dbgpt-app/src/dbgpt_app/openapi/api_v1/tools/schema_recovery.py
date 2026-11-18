"""Return bounded, granted source metadata after SQL/chart errors; never rewrite SQL."""

import asyncio
import re


async def query_schema_hint(state, connector, sql):
    if connector is None:
        return {"status": "datasource_required"}
    try:
        relations = state.get("_query_recovery_relations")
        if relations is None:
            from ..dashboard.source_metadata import readable_source_tables
            relations = await asyncio.wait_for(
                asyncio.to_thread(readable_source_tables, connector), timeout=5
            )
            state["_query_recovery_relations"] = relations
        referenced = set(re.findall(r'(?i)\b(?:FROM|JOIN)\s+([\w."`]+)', sql))
        referenced = {name.replace('"', '').replace('`', '') for name in referenced}
        selected = [r for r in relations if referenced.intersection(
            {r["name"], *(r.get("aliases") or [])})][:4]
        return {"status": "source_metadata", "relations": [
            {"name": r["name"], "columns": [c["name"] for c in r["columns"][:80]]}
            for r in selected
        ], "instruction": (
            "Use these actual source columns and inspect keys/metadata when joining. "
            "Do not infer a direct session/order relationship or finer time grain "
            "without source evidence. Rewrite the query yourself; no SQL was auto-corrected."
        )}
    except Exception as error:
        return {"status": "metadata_unavailable", "error_type": type(error).__name__,
                "instruction": "Inspect the selected datasource schema with a read-only metadata query before retrying."}
