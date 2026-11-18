"""ADMIN18-05: retained metadata is distinct from live datasource registration."""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from dbgpt.storage.metadata import db
from dbgpt_serve.datasource.manages.connect_config_db import (
    ConnectConfigDao,
    ConnectConfigEntity,
)
from dbgpt_serve.semantic import api
from dbgpt_serve.semantic.models import SemEntryEntity, SemTableEntity
from dbgpt_serve.semantic.sync import SemanticSyncService


class SemanticSourceRegistrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        db.init_db(f"sqlite:///{Path(cls.temp.name) / 'metadata.db'}")
        db.create_all()
        api._service = None
        app = FastAPI()
        app.include_router(api.router, prefix="/api")
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        cls.client.close()
        api._service = None
        db.engine.dispose()
        cls.temp.cleanup()

    def seed(self, suffix):
        name = f"fixture_{suffix}"
        primary = f"primary_{suffix}"
        session = ConnectConfigDao().get_raw_session()
        try:
            session.add_all([
                ConnectConfigEntity(db_type="sqlite", db_name=name, db_pwd="fixture-secret"),
                ConnectConfigEntity(db_type="sqlite", db_name=primary),
            ])
            session.commit()
        finally:
            session.close()
        sync = SemanticSyncService()
        space = sync.ensure_space(name, name, "sqlite")
        main = sync.ensure_space(primary, primary, "sqlite")
        session = ConnectConfigDao().get_raw_session()
        try:
            session.add(SemTableEntity(ds_id=space.id, table_name="orders"))
            session.add(SemEntryEntity(ds_id=space.id, entry_type="table", entry_name="retained meaning"))
            session.commit()
        finally:
            session.close()
        return space.id, main.id, name

    def remove_connection(self, name):
        session = ConnectConfigDao().get_raw_session()
        try:
            session.query(ConnectConfigEntity).filter_by(db_name=name).delete()
            session.commit()
        finally:
            session.close()

    def detail(self, identifier):
        response = self.client.get(f"/api/v1/semantic/spaces/{identifier}")
        self.assertEqual(response.status_code, 200)
        return response.json()["data"]

    def test_delete_is_visible_without_destroying_semantic_history_or_other_sources(self):
        identifier, main, name = self.seed("delete")
        before = self.detail(identifier)
        self.assertEqual(before["connection_status"], "configured")
        self.remove_connection(name)
        after = self.detail(identifier)
        self.assertEqual(after["connection_status"], "missing")
        self.assertEqual(after["status"], before["status"])
        self.assertEqual(self.detail(main)["connection_status"], "configured")
        rows = self.client.get("/api/v1/semantic/spaces").json()["data"]
        self.assertEqual(next(r for r in rows if r["id"] == identifier)["connection_status"], "missing")
        self.assertNotIn("fixture-secret", str(rows))
        tables = self.client.get(f"/api/v1/semantic/spaces/{identifier}/tables").json()["data"]
        entries = self.client.get(f"/api/v1/semantic/spaces/{identifier}/entries").json()["data"]
        self.assertEqual(len(tables), 1)
        self.assertEqual(len(entries), 1)

    def test_missing_source_sync_does_not_open_connector_even_with_override(self):
        identifier, _, name = self.seed("sync")
        self.remove_connection(name)
        with patch.object(api, "_connector") as connector:
            response = self.client.post(f"/api/v1/semantic/spaces/{identifier}/sync", json={"db_name": "other"})
        self.assertEqual(response.status_code, 409)
        connector.assert_not_called()

    def test_registry_error_is_unknown_not_deleted_and_does_not_change_metadata(self):
        identifier, _, _ = self.seed("unknown")
        with patch.object(ConnectConfigDao, "get_raw_session", side_effect=RuntimeError("fixture registry outage")):
            rows = api._with_connection_status([{"id": identifier, "conn_id": "fixture_unknown", "status": "activated"}])
        self.assertEqual(rows[0]["connection_status"], "unknown")
        self.assertEqual(rows[0]["status"], "activated")
        self.assertEqual(self.detail(identifier)["connection_status"], "configured")

    def test_registration_return_does_not_erase_metadata_or_claim_a_new_sync(self):
        identifier, _, name = self.seed("restore")
        before = self.detail(identifier)
        self.remove_connection(name)
        self.assertEqual(self.detail(identifier)["connection_status"], "missing")
        session = ConnectConfigDao().get_raw_session()
        try:
            session.add(ConnectConfigEntity(db_type="sqlite", db_name=name))
            session.commit()
        finally:
            session.close()
        after = self.detail(identifier)
        self.assertEqual(after["connection_status"], "configured")
        self.assertEqual(after["last_sync_at"], before["last_sync_at"])
