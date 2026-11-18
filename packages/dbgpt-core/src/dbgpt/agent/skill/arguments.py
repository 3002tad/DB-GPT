"""Compatibility and validation at the skill-script argument boundary."""

import json
from typing import Any, Dict, List, Optional, Tuple


class SkillArgumentsError(ValueError):
    """A tool call can be repaired without starting a script."""


def normalize_script_arguments(
    args: Any = None, argv: Any = None,
) -> Tuple[Optional[Dict[str, Any]], Optional[List[str]]]:
    """Decode one JSON encoding layer; never parse shell syntax or guess flags.

    Native schemas request an object/list, but some model calls encode that
    value as a JSON string. Nested values are deliberately left untouched.
    """
    values = []
    for name, value, expected in (("args", args, dict), ("argv", argv, list)):
        if isinstance(value, str):
            try:
                value = json.loads(value)
            except (ValueError, TypeError) as error:
                raise SkillArgumentsError(
                    f"{name} must be a JSON {'object' if name == 'args' else 'array of strings'}"
                ) from error
            if value is None:
                raise SkillArgumentsError(f"{name} must not be a JSON null string")
        if value is not None and not isinstance(value, expected):
            raise SkillArgumentsError(
                f"{name} must be a {'JSON object' if name == 'args' else 'list of strings'}"
            )
        if name == "argv" and value is not None and not all(
            isinstance(item, str) for item in value
        ):
            raise SkillArgumentsError("argv must contain strings only")
        values.append(value.copy() if value is not None else None)
    return values[0], values[1]


def skill_arguments_failure(error: ValueError) -> str:
    hint = (
        'For JSON scripts use args={"input_file":"<attached file>"}; '
        'for CLI scripts use argv=["<one argument>","--flag","value"]. '
        "Use args OR argv, never both. Read the loaded skill's script contract; "
        "do not switch to CLI merely because a JSON value was encoded as a string."
    )
    return json.dumps({
        "success": False,
        "error_code": "SKILL_ARGUMENTS_INVALID",
        "chunks": [{"output_type": "text", "content": str(error)}],
        "recovery_hint": hint,
    }, ensure_ascii=False)
