"""Deployment-bound analytical datasource policy for Pipeline integration.

The PostgreSQL role must independently have only the approved read privileges.
These identity checks do not themselves make a database account read-only.
"""

import os


class PipelineDataSourcePolicy:
    def __init__(self, connector_manager=None):
        self._connector_manager = connector_manager

    def can_query(self, actor_id: str, data_source_id: str) -> bool:
        if not actor_id or not data_source_id:
            return False
        expected = {
            "db_name": os.getenv("DBGPT_PIPELINE_ANALYTICAL_SOURCE", "").strip(),
            "db_user": os.getenv("DBGPT_PIPELINE_ANALYTICAL_DB_USER", "").strip(),
            "db_host": os.getenv("DBGPT_PIPELINE_ANALYTICAL_DB_HOST", "").strip(),
            "db_port": os.getenv("DBGPT_PIPELINE_ANALYTICAL_DB_PORT", "").strip(),
        }
        if not all(expected.values()) or data_source_id != expected["db_name"]:
            return False
        try:
            if self._connector_manager is None:
                from dbgpt._private.config import Config
                from dbgpt_serve.datasource.manages.connector_manager import ConnectorManager

                manager = ConnectorManager.get_instance(Config().SYSTEM_APP)
            else:
                manager = self._connector_manager
            config = manager.storage.get_db_config(data_source_id)
            if str(config.get("db_type", "")).lower() not in ("postgresql", "postgres"):
                return False
            return all(str(config.get(field, "")).strip() == value for field, value in expected.items())
        except Exception:
            return False
