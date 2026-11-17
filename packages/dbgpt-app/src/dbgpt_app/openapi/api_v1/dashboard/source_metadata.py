"""Shared readable relation inventory for planning and Dashboard SQL validation.

PostgreSQL's connector schema is the default introspection schema, not the
database user's permission boundary. Discover qualified relations using that
same user's grants; never fall back to a partial inventory after a query error.
"""

from typing import Any, Dict, List


_POSTGRES_COLUMNS = """
SELECT n.nspname, c.relname, pg_table_is_visible(c.oid),
       a.attname, format_type(a.atttypid, a.atttypmod)
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND n.nspname NOT LIKE 'pg\\_%' ESCAPE '\\'
  AND a.attnum > 0 AND NOT a.attisdropped
  AND has_schema_privilege(n.oid, 'USAGE')
  AND has_table_privilege(c.oid, 'SELECT')
  AND has_column_privilege(c.oid, a.attnum, 'SELECT')
ORDER BY n.nspname, c.relname, a.attnum
"""


def is_postgresql(connector: Any) -> bool:
    return str(getattr(connector, "dialect", "")).lower() in {
        "postgres",
        "postgresql",
    }


def readable_source_tables(connector: Any, source: str = "") -> List[Dict[str, Any]]:
    """Return physical names, columns and safe unqualified aliases.

    An unqualified alias is allowed only if PostgreSQL resolves it to this
    relation on the connection's search_path. Explicit connector include/ignore
    entries remain scoped to its default schema unless already qualified.
    Other dialects retain their connector's inventory and field semantics.
    """
    if is_postgresql(connector):
        _, rows = connector.query_ex(_POSTGRES_COLUMNS, timeout=5)
        default_schema = getattr(connector, "_schema", None) or "public"

        def qualified(names):
            return {
                str(name) if "." in str(name) else f"{default_schema}.{name}"
                for name in names
            }

        included = qualified(getattr(connector, "_include_tables", ()) or ())
        ignored = qualified(getattr(connector, "_ignore_tables", ()) or ())
        relations: Dict[str, Dict[str, Any]] = {}
        for schema, table, visible, column, storage_type in rows or []:
            name = f"{schema}.{table}"
            if name in ignored or (included and name not in included):
                continue
            entry = relations.setdefault(
                name,
                {
                    "name": name,
                    "schema": schema,
                    "table": table,
                    "aliases": [table] if visible else [],
                    "columns": [],
                },
            )
            entry["columns"].append({"name": column, "type": storage_type})
        return list(relations.values())

    tables = []
    for name in sorted(connector.get_table_names()):
        try:
            fields = connector.get_fields(name, source)
        except TypeError:
            fields = connector.get_fields(name)
        columns = []
        for field in fields or []:
            if isinstance(field, dict):
                columns.append(
                    {"name": str(field["name"]), "type": str(field.get("type", ""))}
                )
            else:
                columns.append(
                    {
                        "name": str(field[0]),
                        "type": str(field[1]) if len(field) > 1 else "",
                    }
                )
        tables.append(
            {
                "name": str(name),
                "schema": getattr(connector, "_schema", None),
                "table": str(name),
                "aliases": [],
                "columns": columns,
            }
        )
    return tables


def source_table_context(connector: Any, tables=None) -> str:
    """Describe PostgreSQL grants without table samples or guessed schema aliases."""
    if not is_postgresql(connector):
        return connector.get_table_info_no_throw()
    if tables is None:
        tables = readable_source_tables(connector)
    return "\n".join(
        f"{item['name']} ("
        + ", ".join(f"{field['name']} {field['type']}" for field in item["columns"])
        + ")"
        for item in tables
    )
