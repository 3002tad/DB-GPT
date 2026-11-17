"""Additive bootstrap for the Semantic Center's local metadata tables."""

from dbgpt_serve.semantic.models import (
    SemColumnEntity,
    SemDatasourceEntity,
    SemEntryEntity,
    SemExampleEntity,
    SemMetricEntity,
    SemMetricVersionEntity,
    SemPublishLogEntity,
    SemRelationEntity,
    SemRuleEntity,
    SemTableEntity,
)

SEMANTIC_TABLES = tuple(entity.__table__ for entity in (
    SemDatasourceEntity, SemTableEntity, SemColumnEntity, SemEntryEntity,
    SemMetricEntity, SemMetricVersionEntity, SemRelationEntity,
    SemExampleEntity, SemRuleEntity, SemPublishLogEntity,
))


def ensure_semantic_schema(db_manager):
    """Create missing tables only; existing columns/data require migrations."""
    for table in SEMANTIC_TABLES:
        table.create(bind=db_manager.engine, checkfirst=True)
