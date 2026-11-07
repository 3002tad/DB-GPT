-- Additive MySQL migration for dbgpt_serve.rag.knowledge_source.models.
-- MySQL deployments do not run SQLite's automatic create_all/Alembic path.
-- Safe to apply again; existing tables and records are left intact.
CREATE TABLE IF NOT EXISTS knowledge_source (
    id INTEGER NOT NULL AUTO_INCREMENT,
    space_id INTEGER,
    name VARCHAR(128),
    type VARCHAR(64),
    config TEXT,
    target_resource_ids TEXT,
    mapping_json TEXT,
    interval_minutes INTEGER,
    sync_mode VARCHAR(16),
    conflict_strategy VARCHAR(16),
    sync_deletions INTEGER,
    status VARCHAR(16),
    last_sync_at DATETIME,
    last_sync_cursor TEXT,
    last_sync_result TEXT,
    error_message TEXT,
    gmt_created DATETIME,
    gmt_modified DATETIME,
    PRIMARY KEY (id),
    KEY ix_knowledge_source_space_id (space_id)
);

CREATE TABLE IF NOT EXISTS knowledge_source_keystore (
    id INTEGER NOT NULL AUTO_INCREMENT,
    key_text TEXT,
    gmt_created DATETIME,
    gmt_modified DATETIME,
    PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS knowledge_source_sync_log (
    id INTEGER NOT NULL AUTO_INCREMENT,
    source_id INTEGER,
    space_id INTEGER,
    `trigger` VARCHAR(16),
    mode VARCHAR(16),
    items_created INTEGER,
    items_updated INTEGER,
    items_skipped INTEGER,
    items_failed INTEGER,
    status VARCHAR(16),
    error TEXT,
    started_at DATETIME,
    finished_at DATETIME,
    PRIMARY KEY (id),
    KEY ix_knowledge_source_sync_log_source_id (source_id),
    KEY ix_knowledge_source_sync_log_space_id (space_id)
);
