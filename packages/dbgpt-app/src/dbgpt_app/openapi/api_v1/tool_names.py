"""Canonical tool names and historical aliases.

The shell / code tools were renamed ``shell_interpreter`` -> ``bash`` and
``code_interpreter`` -> ``code``. Stored L2 rules / overrides, replayed
conversation steps and model habits from before the rename still carry the
old strings, so every name comparison goes through :func:`canonical_tool`.
"""

TOOL_ALIASES = {
    "shell_interpreter": "bash",
    "code_interpreter": "code",
    "execute_skill_script_file": "run_skill_script",
    "execute_skill_script": "run_skill_script",
}


def canonical_tool(name: str) -> str:
    """Map a historical tool name to its canonical one (idempotent)."""
    return TOOL_ALIASES.get(name, name)


def tool_availability_guidance(active_names, discoverable_names=()) -> str:
    """Describe the actual turn catalog without advertising unavailable tools."""
    active = set(active_names)
    discovery = "tool_search" in active
    available = active | (set(discoverable_names) if discovery else set())
    lines = ["## Tool availability", "Use the supplied native function schemas and complete JSON arguments."]
    if discovery:
        lines.append("Use tool_search to find a missing capability in this turn's catalog; activated tools become callable on the next round.")
    aliases = [f"{old} -> {new}" for old, new in TOOL_ALIASES.items() if new in available]
    if aliases:
        lines.append("Historical instructions use these renamed tools: " + "; ".join(aliases) + ". Use the canonical function name.")
    if "run_skill_script" in available:
        lines.append("For run_skill_script pass skill_name and exactly one script_file_name or script_name; use args OR argv, never both.")
    return "\n\n" + "\n".join(lines)
