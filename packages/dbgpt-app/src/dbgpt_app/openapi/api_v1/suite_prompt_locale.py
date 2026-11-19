"""Locale-aware suite prompt projection; source packages stay unchanged."""
from pathlib import Path
import hashlib


def localized_sop_block(binding, locale):
    language = "vi" if str(locale).startswith("vi") else "en"
    root = Path(binding.package_path).resolve() if binding.package_path else None
    projections = {}

    def localized(path, fallback):
        if root is None:
            return fallback
        original = (root / path).resolve()
        if not original.is_relative_to(root):
            return fallback
        # English is an explicit fallback for Vietnamese prompt instructions.
        for lang in (language, "en"):
            candidate = original.with_name(original.stem + f".{lang}" + original.suffix).resolve()
            if candidate.is_relative_to(root) and candidate.is_file():
                body = candidate.read_text(encoding="utf-8").strip()
                relative = candidate.relative_to(root).as_posix()
                projections[relative] = {
                    "path": relative, "locale": lang,
                    "sha256": hashlib.sha256(body.encode("utf-8")).hexdigest(),
                }
                return body
        return fallback

    sop = localized("prompts/query-playbook.md", binding.sop_text) if binding.name == "db-query" else binding.sop_text
    skill = binding.command_skill_text
    # The selected skill's provenance entry intentionally stores only a hash,
    # not its body. Linked references may contain content; do not confuse them.
    skill_path = (
        binding.loaded_documents[0].get("path", "")
        if skill and binding.loaded_documents else ""
    )
    if skill_path:
        skill = localized(skill_path, skill)
    sections = [
        f"## Suite SOP ({binding.name}@{binding.version})",
        "Follow the selected suite and actual tool contracts; explain conflicts with the user request. "
        "Do not invent missing metadata, connections, tool capabilities or execution results. "
        f"Public progress and final explanations must use {language}; keep identifiers and source quotations unchanged.",
        sop.strip() or "No SOP supplied by this package.",
        "Available skills: " + ", ".join(c["name"] for c in binding.commands),
    ]
    if binding.command_error:
        sections += ["Command unavailable", binding.command_error, "Explain the error and ask the user to select a valid command."]
    elif binding.command:
        sections += [f"Selected command: {binding.command}; skill: {binding.command_skill}",
                     "The following skill is already loaded. Use the user's request as its arguments. Loading a skill is not task completion.", skill]
    seen = {sop.strip(), skill.strip()}
    for doc in binding.loaded_documents:
        body = localized(doc["path"], doc.get("content", "")).strip()
        if body and body not in seen:
            seen.add(body)
            sections += [f"Package reference: {doc['path']}", body]
    if binding.watermark:
        from .suite_binder import SEMANTIC_DEGRADED_WATERMARK
        sections.append(
            "Semantic layer unavailable: raw schema results need explicit definition/quality limitations. "
            "Existing read-only, timeout, row and authorization controls still apply."
            if binding.watermark == SEMANTIC_DEGRADED_WATERMARK else binding.watermark
        )
    result = "\n\n" + "\n\n".join(sections)
    binding.prompt_projection = {
        "locale": language,
        "sha256": hashlib.sha256(result.encode("utf-8")).hexdigest(),
        "characters": len(result), "documents": list(projections.values()),
    }
    return result
