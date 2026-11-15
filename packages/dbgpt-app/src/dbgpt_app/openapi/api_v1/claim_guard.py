"""Conservative final-answer guard for unsupported analytical assertions.

Only high-confidence claim families are checked here. The SQL text is evidence
of what was queried, not proof that the returned data establishes causation or
an official metric. This guard cannot certify arbitrary natural-language claims.
"""

import json
import re
from typing import Any, Iterable, Optional


def _successful_sql(steps: Iterable[dict[str, Any]]) -> list[str]:
    queries = []
    for step in steps:
        if (str(step.get("action", "")).lower() != "sql_query"
                or step.get("status") != "done"):
            continue
        raw = step.get("action_input") or ""
        try:
            args = json.loads(raw) if isinstance(raw, str) else raw
        except (TypeError, ValueError):
            continue
        sql = args.get("sql") if isinstance(args, dict) else None
        if isinstance(sql, str):
            queries.append(sql.casefold())
    return queries


def _artifact_sql(artifacts: Iterable[Any]) -> list[str]:
    """Use confirmed SQL artifacts from both lead and child agents when present."""
    queries = []
    for artifact in artifacts:
        artifact_type = getattr(artifact, "type", None)
        if artifact_type not in {"sql", "sql_query"}:
            continue
        if getattr(artifact, "status", None) != "succeeded":
            continue
        sql = getattr(artifact, "sql", None)
        if isinstance(sql, str) and sql.strip():
            queries.append(sql.casefold())
    return queries


_LIMITATION = re.compile(
    r"\b(?:không chứng minh|không suy ra|không phải|chưa đủ|không có đủ|"
    r"không thể kết luận|chưa xác nhận|không rõ|không có dữ liệu|"
    r"thiếu bằng chứng|does not prove|cannot infer|"
    r"insufficient evidence|not evidence of)\b",
    re.IGNORECASE,
)
_CART_OUTCOME = re.compile(
    r"(bỏ giỏ|bỏ rơi giỏ|thêm vào giỏ|abandon(?:ed|ment)? cart|added to cart)",
    re.IGNORECASE,
)
_CART_ABANDONMENT = re.compile(
    r"(bỏ giỏ|bỏ rơi giỏ|tín hiệu.{0,30}bỏ giỏ|"
    r"giỏ.{0,50}không hoàn tất|không hoàn tất.{0,25}(?:đơn|checkout|thanh toán)|"
    r"abandon(?:ed|ment)?(?:\s+(?:signal|rate|event|session|cart))?|"
    r"cart.{0,30}abandon(?:ed|ment)?|drop[ -]?off|cart.{0,30}without.{0,20}checkout)",
    re.IGNORECASE,
)
_PAYMENT_OUTCOME = re.compile(
    r"(đã thanh toán|đã thu tiền|doanh thu đã thu|paid revenue|payment succeeded|captured revenue|"
    r"doanh thu thực thu|tiền thực thu)",
    re.IGNORECASE,
)
_FULFILLMENT_OUTCOME = re.compile(
    r"(đã giao hàng|đã hoàn tất giao hàng|delivered orders|fulfilled orders)",
    re.IGNORECASE,
)
_CAUSAL = re.compile(
    r"(gây ra|dẫn đến|khiến cho|do đó khách|vì vậy khách|caused by|causes customers|"
    r"led to customers|therefore customers)",
    re.IGNORECASE,
)
_CONVERSION = re.compile(r"(tỷ lệ chuyển đổi|conversion rate)", re.IGNORECASE)
_RETENTION = re.compile(
    r"(khách quay lại|tỷ lệ giữ chân|retention rate|returning customer)",
    re.IGNORECASE,
)
_SELLABLE = re.compile(
    r"(tồn kho khả dụng|có thể bán|sellable stock|available to sell)",
    re.IGNORECASE,
)
_REFUND = re.compile(
    r"(đã hoàn tiền|doanh thu sau hoàn tiền|net revenue|refunded amount)",
    re.IGNORECASE,
)
_ATTRIBUTION = re.compile(
    r"(utm_source|facebook|tiktok|zalo|google).{0,70}"
    r"(mang lại|tạo ra|đóng góp|caused|drove|generated)",
    re.IGNORECASE,
)
_CART_SOURCE = re.compile(r"cart_item|cart\.item_added|cart_item_changes")
_TIME_SOURCE = re.compile(r"occurred_at|created_at|started_at|event_time")
_DATASET_SESSION_GRAIN = re.compile(
    r"\(?\s*dataset_id\s*,\s*session_id\s*\)?", re.IGNORECASE,
)
_SQL_RELATION = re.compile(r"\b(?:from|join)\s+([\w.]+)", re.IGNORECASE)


def _dataset_session_grain_supported(queries: list[str]) -> bool:
    return any(
        "dataset_id" in sql and "session_id" in sql and (
            re.search(r"(?:select|group\s+by)\s+(?:distinct\s+)?dataset_id\s*,\s*session_id", sql)
            or re.search(r"count\s*\(\s*distinct\s*\(\s*dataset_id\s*,\s*session_id", sql)
            or (re.search(r"\bwhere\b[\s\S]*\bdataset_id\s*=", sql)
                and re.search(r"count\s*\(\s*distinct\s+session_id", sql))
        ) for sql in queries
    )


def _remove_unverified_sql_examples(content: str, queries: list[str]) -> tuple[str, bool]:
    """A proposed SQL block must not present an unqueried relation as usable."""
    if not queries:
        return content, False
    verified = {name for sql in queries for name in _SQL_RELATION.findall(sql)}
    changed = False

    def replace(match: re.Match[str]) -> str:
        nonlocal changed
        relations = _SQL_RELATION.findall(match.group(1))
        if relations and any(name.casefold() not in verified for name in relations):
            changed = True
            return "[SQL example omitted: verify the referenced table and columns first.]"
        return match.group(0)

    result = re.sub(r"```sql\s*\n([\s\S]*?)\n```", replace, content, flags=re.IGNORECASE)
    return result, changed


def _has_evidence(queries: list[str], *patterns: str) -> bool:
    """Require one successful query to carry all parts of a claim's lineage."""
    return any(all(re.search(pattern, sql) for pattern in patterns) for sql in queries)


def _is_limitation(assertion: str, claim_match: re.Match[str] | None) -> bool:
    """A caveat after a positive assertion does not excuse that assertion."""
    if assertion.rstrip().endswith("?"):
        return True
    if re.match(r"^(?:nếu|giả sử|if|suppose)\b", assertion, re.IGNORECASE):
        return True
    limitation = _LIMITATION.search(assertion)
    return bool(limitation and (claim_match is None or limitation.start() <= claim_match.start()))


def guard_final_claims(content: str, steps: Iterable[dict[str, Any]],
                       locale: str = "vi", *,
                       artifacts: Optional[Iterable[Any]] = None) -> tuple[str, list[str]]:
    """Remove unsupported high-impact claims from prose lines, preserving data.

    The check is intentionally narrow: ordinary descriptive numbers and
    explicitly qualified limitations stay visible. Unsupported lines are
    replaced by a brief limitation; no model call or fabricated value is used.
    """
    steps = list(steps)
    artifact_list = list(artifacts) if artifacts is not None else None
    queries = _artifact_sql(artifact_list) if artifact_list is not None else _successful_sql(steps)
    knowledge_artifact = bool(artifact_list and any(
        getattr(artifact, "type", None) == "reference"
        and getattr(artifact, "reference_type", None) == "knowledge"
        and getattr(artifact, "status", None) == "succeeded"
        for artifact in artifact_list
    ))
    if not queries and (knowledge_artifact or any(
        step.get("status") == "done" and str(step.get("action", "")).lower()
        in {"knowledge_retrieve", "kb_cat", "kb_ls"}
        for step in steps
    )):
        # A retrieved document may supply claims outside SQL. This guard has
        # no document-to-claim verifier and must not erase that source.
        return content, []
    content, unverified_sql_example = _remove_unverified_sql_examples(content, queries)
    issues = ["unverified_sql_example"] if unverified_sql_example else []
    output = []
    in_code_fence = False
    for line in content.splitlines(keepends=True):
        if line.lstrip().startswith("```"):
            in_code_fence = not in_code_fence
            output.append(line)
            continue
        if in_code_fence:
            output.append(line)
            continue
        if line.lstrip().startswith("#") and not re.search(
            r"\d|đã|tăng|giảm|mang lại|gây ra|dẫn đến|caused|generated", line,
            re.IGNORECASE,
        ):
            output.append(line)
            continue
        # Keep a supported observation when a later sentence on the same
        # line makes an unsupported interpretation.
        sentences = re.split(
            r"(?<=[.!?;])(?=\s+\S)|"
            r"(?=,\s*(?:cho thấy|chứng tỏ|suy ra|therefore|which shows|indicating)\b)|"
            r"(?=\s*(?:→|->)\s*)",
            line, flags=re.IGNORECASE,
        )
        for sentence in sentences:
            before = len(issues)
            _check_sentence(sentence, queries, output, issues)
            if len(issues) > before and sentence.endswith("\n") and output:
                if not output[-1].endswith("\n"):
                    output.append("\n")
    if not issues:
        return content, []
    message = (
        "Một số diễn giải về hành vi hoặc kết quả đã được lược bỏ vì các truy vấn "
        "trong lượt này chưa cung cấp bằng chứng phù hợp."
        if locale.startswith("vi") else
        "Some behavioral or outcome interpretations were omitted because this "
        "run did not provide the necessary evidence."
    )
    remaining = "".join(output).rstrip()
    return (remaining + "\n\n" if remaining else "") + message, sorted(set(issues))


def _check_sentence(
    line: str, queries: list[str], output: list[str], issues: list[str]
) -> None:
    assertion = re.sub(r"^\s*(?:[-*]|\d+\.)\s*", "", line).strip()
    if not assertion:
        output.append(line)
        return
    if _DATASET_SESSION_GRAIN.search(assertion) and not _is_limitation(assertion, None):
        if not _dataset_session_grain_supported(queries):
            issues.append("unsupported_grain")
            return
    checks = (
        (
            _CART_ABANDONMENT,
            "cart_abandonment",
            (
                _CART_SOURCE.pattern, r"checkout|order",
                r"not\s+exists|left\s+join", _TIME_SOURCE.pattern,
            ),
        ),
        (_CART_OUTCOME, "cart_outcome", (_CART_SOURCE.pattern,)),
        (_PAYMENT_OUTCOME, "payment_outcome", (r"payment", r"captured|paid|settled")),
        (_FULFILLMENT_OUTCOME, "fulfillment_outcome", (r"fulfillment", r"delivered|fulfilled")),
        (_CAUSAL, "causal_claim", None),
        (
            _CONVERSION,
            "conversion_claim",
            (r"join|exists", r"session_id|customer_id", _TIME_SOURCE.pattern),
        ),
        (_RETENTION, "retention_claim", (r"customer_id", r"count|row_number", r"order|session")),
        (_SELLABLE, "sellable_stock_claim", (r"location", r"reservation", r"sales_channel")),
        (_REFUND, "refund_claim", (r"refund", r"refunded|amount")),
        (_ATTRIBUTION, "attribution_claim", None),
    )
    missing = []
    for pattern, category, required in checks:
        claim = pattern.search(assertion)
        if claim and not _is_limitation(assertion, claim):
            if required is None or not _has_evidence(queries, *required):
                missing.append(category)
    if missing:
        issues.extend(missing)
        return
    output.append(line)
