"""Describe files observed on disk, never paths guessed from stdout or prose."""

import hashlib
import os
from pathlib import Path
from typing import Dict, Tuple


def snapshot_generated_files(directory: str) -> Dict[str, Tuple[int, str]]:
    """Content signatures exclude execution controls and dependency/cache trees."""
    files = {}
    ignored = {".report-executions", "__pycache__", ".git", ".venv", "node_modules"}
    for parent, directories, names in os.walk(directory, followlinks=False):
        directories[:] = [name for name in directories if name not in ignored]
        for name in names:
            path = Path(parent) / name
            if path.is_symlink() or not path.is_file():
                continue
            try:
                digest = hashlib.sha256()
                with path.open("rb") as stream:
                    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                        digest.update(chunk)
                files[str(path)] = (path.stat().st_size, digest.hexdigest())
            except OSError:
                continue
    return files


def generated_file_chunks(directory, before, producer_status, *, after=None):
    """Emit new/changed regular files, including outputs saved before failure.

    Presence is an observation at execution end, not a claim that the producer
    succeeded, the content is analytically correct, or the file cannot be deleted.
    """
    after = snapshot_generated_files(directory) if after is None else after
    return [
        {
            "output_type": "file",
            "content": {
                "name": Path(path).name,
                "file_path": path,
                "size": signature[0],
                "sha256": signature[1],
                "existence_verified": True,
                "producer_status": producer_status,
            },
        }
        for path, signature in sorted(after.items())
        if before.get(path) != signature and Path(path).is_file()
    ]
