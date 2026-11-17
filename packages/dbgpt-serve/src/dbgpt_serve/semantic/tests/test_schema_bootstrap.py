import unittest
from types import SimpleNamespace

from sqlalchemy import create_engine, inspect, select

from dbgpt_serve.semantic.models import SemDatasourceEntity
from dbgpt_serve.semantic.schema import SEMANTIC_TABLES, ensure_semantic_schema


class SchemaBootstrapTest(unittest.TestCase):
    def test_missing_tables_and_existing_data_survive_repeated_bootstrap(self):
        engine = create_engine("sqlite:///:memory:")
        try:
            table = SemDatasourceEntity.__table__
            table.create(engine)
            with engine.begin() as conn:
                conn.execute(table.insert().values(conn_id="source", conn_name="keep"))
            manager = SimpleNamespace(engine=engine)
            ensure_semantic_schema(manager)
            ensure_semantic_schema(manager)
            self.assertEqual(set(inspect(engine).get_table_names()),
                             {t.name for t in SEMANTIC_TABLES})
            with engine.connect() as conn:
                self.assertEqual(conn.execute(select(table.c.conn_name)).scalars().all(),
                                 ["keep"])
        finally:
            engine.dispose()


if __name__ == "__main__":
    unittest.main()
