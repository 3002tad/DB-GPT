"""Admin-declared capabilities for an exact endpoint/model, never quota data."""

import hashlib
import logging
import os
from datetime import datetime

from sqlalchemy import Column, DateTime, String, Text

from dbgpt.storage.metadata import Model, db

logger = logging.getLogger(__name__)
_manager = None


class ManualModelMetadata(Model):
    __tablename__ = "dbgpt_model_manual_metadata"

    key = Column(String(64), primary_key=True)
    values_json = Column(Text, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


def ensure_manual_metadata_schema(manager):
    global _manager
    ManualModelMetadata.__table__.create(bind=manager.engine, checkfirst=True)
    _manager = manager


def _key(api_base, model):
    endpoint = os.path.expandvars(api_base or "").strip().rstrip("/")
    if not endpoint or not model:
        return None
    return hashlib.sha256(f"{endpoint}\0{model}".encode()).hexdigest()


def read_manual_metadata(api_base, model):
    import json

    key = _key(api_base, model)
    if key is None:
        return {}
    try:
        with (_manager or db).session(commit=False) as session:
            row = session.get(ManualModelMetadata, key)
            return json.loads(row.values_json) if row else {}
    except Exception as exc:
        # Remote workers without this metadata DB keep normal adapter fallback.
        logger.debug("Manual model metadata unavailable: %s", type(exc).__name__)
        return {}


def write_manual_metadata(api_base, model, values):
    import json

    key = _key(api_base, model)
    if key is None:
        raise ValueError("Configure the provider endpoint before declaring metadata")
    with (_manager or db).session() as session:
        row = session.get(ManualModelMetadata, key)
        if row is None:
            row = ManualModelMetadata(key=key)
            session.add(row)
        row.values_json = json.dumps(values, ensure_ascii=False)


def apply_manual_metadata(metadata, api_base, model):
    values = read_manual_metadata(api_base, model)
    for field in ("context_length", "max_output_length", "function_calling"):
        if values.get(field) is not None:
            setattr(metadata, field, values[field])
    metadata.metadata = dict(metadata.metadata or {})
    if values.get("context_length") is not None:
        metadata.metadata["context_length_source"] = "user_config"
    if any(values.get(field) is not None for field in ("context_length", "max_output_length", "function_calling")):
        metadata.metadata.update({
            "metadata_source": values.get("reference"),
            "metadata_checked_at": values.get("checked_at"),
            "metadata_declaration": "user_config",
        })
    return metadata
