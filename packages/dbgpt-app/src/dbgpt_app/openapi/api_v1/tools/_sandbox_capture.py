"""Build self-contained capture helpers for images without DB-GPT installed."""

import inspect
import json
import os
from pathlib import Path
from typing import Any

from dbgpt.core.interface.report_capture import (
    normalize_artifact_value,
    restore_artifact_value,
)


def result_json(value: Any, *, indent: int | None = None) -> str:
    """Serialize analytical results using the same typed rules as capture."""
    return json.dumps(
        normalize_artifact_value(value),
        ensure_ascii=False,
        allow_nan=False,
        indent=indent,
    )


def prepare_output_path(root: str, filename: str | os.PathLike) -> str:
    """Create parents for an output inside this execution's existing workspace.

    This is a convenience helper, not an arbitrary-code isolation boundary.
    Native Python file APIs remain unchanged.
    """
    workspace = Path(root).resolve()
    target = (workspace / filename).resolve()
    if target == workspace or not target.is_relative_to(workspace):
        raise ValueError(
            "PYTHON_OUTPUT_PATH_INVALID: use a filename within OUTPUT_DIR, "
            "for example output_path('exports/summary.csv')"
        )
    target.parent.mkdir(parents=True, exist_ok=True)
    return str(target)


class TrackedSQLResults(list):
    """Track reads of complete datasets already materialized by the host."""

    def __init__(self, values: list, trace_path: str):
        super().__init__(restore_artifact_value(values))
        self.trace_path = trace_path
        self.used: set[str] = set()

    def catalog(self):
        """Describe inputs without recording a metadata lookup as a data read."""
        return [
            {key: item.get(key) for key in (
                "artifact_id", "sql", "columns", "row_count", "truncated"
            )}
            for item in list.__iter__(self)
            if isinstance(item, dict) and isinstance(item.get("artifact_id"), str)
        ]

    def select(self, selector=-1):
        """Select an exact captured producer without reading unrelated datasets."""
        if isinstance(selector, str):
            matches = [
                index for index, item in enumerate(list.__iter__(self))
                if isinstance(item, dict) and item.get("artifact_id") == selector
            ]
            if len(matches) != 1:
                raise KeyError(
                    "SQL_RESULT_NOT_FOUND: select one artifact_id from "
                    "SQL_RESULT_CATALOG in this conversation"
                )
            return self[matches[0]]
        if isinstance(selector, int) and not isinstance(selector, bool):
            try:
                return self[selector]
            except IndexError as error:
                raise IndexError(
                    "SQL_RESULT_NOT_FOUND: index is outside SQL_RESULT_CATALOG"
                ) from error
        raise TypeError("SQL_RESULT_SELECTOR_INVALID: use an artifact ID or integer index")

    def _record(self, value):
        for item in value if isinstance(value, list) else [value]:
            if isinstance(item, dict) and isinstance(item.get("artifact_id"), str):
                if item.get("truncated"):
                    raise ValueError("SQL_RESULT_INCOMPLETE: full snapshot required")
                self.used.add(item["artifact_id"])
        trace = Path(self.trace_path)
        temporary = trace.with_suffix(".pending")
        temporary.write_text(json.dumps(sorted(self.used)), encoding="utf-8")
        os.replace(temporary, trace)
        return value

    def __getitem__(self, index):
        return self._record(super().__getitem__(index))

    def __iter__(self):
        for item in super().__iter__():
            yield self._record(item)

    def copy(self):
        return list(self)

    def __reversed__(self):
        for item in super().__reversed__():
            yield self._record(item)

    def __add__(self, other):
        return list(self) + other

    def __mul__(self, count):
        return list(self) * count

    __rmul__ = __mul__


def capture_helper_source() -> str:
    """Reuse host serialization rules without importing host packages in children.

    The returned source runs in a private module namespace. Only standard-library
    imports are shipped; SQL snapshot URIs must be resolved before execution.
    """
    imports = """
import base64
import json
import math
import os
import uuid
from collections.abc import Mapping
from datetime import date, datetime, time
from decimal import Decimal
from enum import Enum
from pathlib import Path
from typing import Any
"""
    return imports + "\n\n".join(
        inspect.getsource(definition)
        for definition in (
            normalize_artifact_value,
            restore_artifact_value,
            result_json,
            prepare_output_path,
            TrackedSQLResults,
        )
    )
