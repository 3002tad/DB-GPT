"""Skills provisioning module for dbgpt-app pip package users.

Copies builtin skill templates from the installed package to the user's
skills directory on first startup. Existing skills are not overwritten, except
that explicitly retired built-in paths are removed by the retirement migration.
"""

import logging
import os
import shutil

from .package_resources import bundled_resource_dir

logger = logging.getLogger(__name__)

# Retire the sample from old image layers/persisted built-in skill directories.
# Personal skills under user/ are outside this narrowly scoped migration.
RETIRED_BUILTIN_SKILLS = frozenset({"walmart-sales-analyzer"})


def ensure_builtin_skills(skills_dir: str) -> None:
    """Idempotently seed builtin skills into *skills_dir*.

    On first run after ``pip install dbgpt-app``, the builtin skill
    templates bundled inside the wheel (``dbgpt_app/_builtin_skills/``)
    are copied to *skills_dir*.  Skills that already exist in the
    destination are **never** overwritten so that user modifications are
    preserved.

    Explicitly retired built-in paths are removed first, including when no
    current bundle is available. Other existing skills remain untouched.

    Assets are located in the package or the installed editable wheel.
    If no bundled directory is available, provisioning is a no-op.

    Args:
        skills_dir: Absolute path to the target skills directory,
            e.g. ``~/.dbgpt/skills/``.
    """
    root = os.path.realpath(skills_dir)
    for name in RETIRED_BUILTIN_SKILLS:
        target = os.path.join(root, name)
        if os.path.islink(target):
            # Unlink only the entry, never traverse or delete its target.
            os.unlink(target)
            logger.info("Removed retired builtin skill link: %s", name)
        elif os.path.isdir(target) and os.path.dirname(os.path.realpath(target)) == root:
            shutil.rmtree(target)
            logger.info("Removed retired builtin skill: %s", name)

    builtin_root = bundled_resource_dir("_builtin_skills")
    if builtin_root is None:
        logger.debug("dbgpt_app._builtin_skills not available, skipping seed.")
        return

    if not os.path.isdir(builtin_root):
        return

    os.makedirs(skills_dir, exist_ok=True)

    for entry in os.listdir(builtin_root):
        # Skip Python artifacts and hidden files
        if entry.startswith(("_", ".")) or entry == "__pycache__":
            continue
        if entry in RETIRED_BUILTIN_SKILLS:
            continue

        src = os.path.join(builtin_root, entry)
        dst = os.path.join(skills_dir, entry)

        # Never overwrite existing skills (user may have modified them)
        if os.path.exists(dst):
            logger.debug("Builtin skill already exists, skipping: %s", dst)
            continue

        if os.path.isdir(src):
            shutil.copytree(src, dst)
            logger.info("Provisioned builtin skill: %s", entry)
        else:
            shutil.copy2(src, dst)
            logger.info("Provisioned builtin skill file: %s", entry)

    # Ensure user/ subdirectory exists for uploaded/imported skills
    user_dir = os.path.join(skills_dir, "user")
    os.makedirs(user_dir, exist_ok=True)
