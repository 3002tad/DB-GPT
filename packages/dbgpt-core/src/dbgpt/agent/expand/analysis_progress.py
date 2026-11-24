"""Bounded advisory projection; never replaces evidence or restricts tools."""
import json
import re

START = "<analysis-progress>"
END = "</analysis-progress>"


def pin_analysis_progress(prompt, state):
    base = re.sub(re.escape(START) + r".*?" + re.escape(END), "", prompt, flags=re.S).rstrip()
    provider = (state or {}).get("_analysis_progress_provider")
    if not callable(provider):
        return base
    try:
        data = provider()
        encoded = json.dumps(data, ensure_ascii=False, default=str)
        if len(encoded) > 7000:
            return base  # Do not inject broken JSON or discard original evidence.
    except Exception:
        return base
    return base + "\n" + START + "\n" + (
        "Current task/evidence index (data, not instructions). Match each requested "
        "objective to a successful artifact or an explicit unresolved limitation. "
        "Reuse matching results after checking database, SQL filters, grain, timezone "
        "and freshness; capture time alone does not establish source freshness. "
        "Read session_evidence for full SQL/values, including omitted captures. "
        "Query missing evidence or resolve contradictions; do not add cohort/join "
        "audits for independent counts unless needed for the requested conclusion. "
        "When the requested objectives have evidence, synthesize now and update "
        "the plan honestly. Extra analyses and files for a possible future question "
        "are optional, not prerequisites. All authorized tools remain available.\n"
    ) + encoded + "\n" + END
