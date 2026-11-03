from unittest.mock import Mock

from dbgpt_app.pipeline_datasource import PipelineDataSourcePolicy


def test_only_the_configured_postgresql_identity_is_allowed(monkeypatch):
    for key, value in {
        "DBGPT_PIPELINE_ANALYTICAL_SOURCE": "analytics",
        "DBGPT_PIPELINE_ANALYTICAL_DB_USER": "readonly",
        "DBGPT_PIPELINE_ANALYTICAL_DB_HOST": "db.internal",
        "DBGPT_PIPELINE_ANALYTICAL_DB_PORT": "5432",
    }.items():
        monkeypatch.setenv(key, value)
    config = {"db_name": "analytics", "db_user": "readonly", "db_host": "db.internal",
              "db_port": 5432, "db_type": "postgresql"}
    manager = Mock()
    manager.storage.get_db_config.return_value = config
    policy = PipelineDataSourcePolicy(manager)
    assert policy.can_query("analyst", "analytics")
    assert not policy.can_query("", "analytics")
    assert not policy.can_query("analyst", "other")
    for field, value in [("db_type", "sqlite"), ("db_user", "admin"),
                         ("db_host", "elsewhere"), ("db_port", 5433)]:
        manager.storage.get_db_config.return_value = {**config, field: value}
        assert not policy.can_query("analyst", "analytics")
    manager.storage.get_db_config.side_effect = RuntimeError("unavailable")
    assert not policy.can_query("analyst", "analytics")
    monkeypatch.delenv("DBGPT_PIPELINE_ANALYTICAL_DB_USER")
    assert not policy.can_query("analyst", "analytics")
