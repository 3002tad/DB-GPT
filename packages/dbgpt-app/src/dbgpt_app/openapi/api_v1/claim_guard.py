"""Conservative final-answer guard for unsupported analytical assertions.

Only high-confidence empirical claims are removed. Concepts, proposals and
hypotheses do not require SQL. Ambiguous claims are retained with a review note.
SQL text describes query scope, not result correctness, causation or metric
certification. This presentation-only guard never controls Agent execution.
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

_CONCEPTUAL_REQUEST = re.compile(
    r"\b(?:giải thích|định nghĩa|khái niệm|là gì|explain|define|definition|what is)\b",
    re.IGNORECASE,
)
_ANALYTICAL_REQUEST = re.compile(
    r"\b(?:phân tích|so sánh|tính toán|thống kê|analy[sz]e|compare|calculate)\b",
    re.IGNORECASE,
)
_GENERAL_EXPLANATION = re.compile(
    r"\b(?:funnel gồm|thường gồm|thường bao gồm|mỗi giai đoạn|về nguyên tắc|nói chung|"
    r"được định nghĩa|là khái niệm|là hành trình|là tổng|là số|"
    r"bài viết mô tả|tài liệu mô tả|khái niệm|"
    r"generally|typically|by definition|defined as|refers to|"
    r"each stage|the document describes)\b",
    re.IGNORECASE,
)
_EMPIRICAL_ANCHOR = re.compile(
    r"\b(?:của shop|của cửa hàng|trong dữ liệu|dữ liệu hiện tại|kết quả truy vấn|"
    r"ghi nhận|quan sát được|our shop|this shop|this dataset|query results|observed)\b|"
    r"^(?:grain\s*:)",
    re.IGNORECASE,
)
_MEASURED_VALUE = re.compile(
    r"\d[\d.,]*\s*(?:%|đơn|phiên|khách|orders?|sessions?|customers?)(?!\w)|"
    r"(?:tỷ lệ chuyển đổi|conversion rate|tồn kho khả dụng|doanh thu).{0,35}"
    r"(?:là|đạt|is|was|=|:)\s*\d|"
    r"(?:có thể bán|available to sell|sellable stock).{0,20}\d",
    re.IGNORECASE,
)
_EMPIRICAL_WORDING = re.compile(
    r"\b(?:đã thanh toán|đã thu tiền|đã giao hàng|đã hoàn tiền|"
    r"nhiều người|nhiều khách|cho thấy|chứng tỏ|đây là|tăng|giảm|"
    r"this is|these are|increased|decreased|shows that|therefore)\b",
    re.IGNORECASE,
)
_PROPOSAL = re.compile(
    r"\b(?:ví dụ|giả định|giả thuyết|đề xuất|nên kiểm tra|cần kiểm tra|"
    r"có thể(?!\s+bán\b)|có khả năng|for example|hypothetically|hypothesis|"
    r"propose|recommend|may|might|could)\b",
    re.IGNORECASE,
)


def _dataset_session_grain_supported(queries: list[str]) -> bool:
    return any(
        "dataset_id" in sql and "session_id" in sql and (
            re.search(r"(?:select|group\s+by)\s+(?:distinct\s+)?dataset_id\s*,\s*session_id", sql)
            or re.search(r"count\s*\(\s*distinct\s*\(\s*dataset_id\s*,\s*session_id", sql)
            or (re.search(r"\bwhere\b[\s\S]*\bdataset_id\s*=", sql)
                and re.search(r"count\s*\(\s*distinct\s+session_id", sql))
        ) for sql in queries
    )


def _has_unverified_sql_examples(content: str, queries: list[str]) -> bool:
    """Flag proposed SQL for review without deleting Agent-authored examples."""
    if not queries:
        return False
    verified = {name for sql in queries for name in _SQL_RELATION.findall(sql)}
    for match in re.finditer(r"```sql\s*\n([\s\S]*?)\n```", content, flags=re.IGNORECASE):
        relations = _SQL_RELATION.findall(match.group(1))
        if relations and any(name.casefold() not in verified for name in relations):
            return True
    return False


def _has_query_scope(queries: list[str], *patterns: str) -> bool:
    """Compatible SQL scope only; never a verifier of a claim or result value."""
    return any(all(re.search(pattern, sql) for pattern in patterns) for sql in queries)


def _scope_is_opaque(queries: list[str], artifacts: Iterable[Any]) -> bool:
    """Unrecognized SQL/calculations are not proof of missing capability.

    Avoid deleting valid custom-SQL/Python/document analyses just because this
    small guard does not understand their source names or computations. Keep
    them under review instead of treating their mere presence as certification.
    """
    for artifact in artifacts:
        if getattr(artifact, "status", None) != "succeeded":
            continue
        if getattr(artifact, "type", None) == "python" and (
            getattr(artifact, "result", None) is not None or getattr(artifact, "stdout", None)
        ):
            return True
        if getattr(artifact, "type", None) == "reference" and getattr(artifact, "excerpt", None):
            return True
    known_references = {"sessions", "orders", "cart_links", "inventory_level", "fulfillment", "payment_actions"}
    for sql in queries:
        relations = _SQL_RELATION.findall(sql)
        if (not relations or any(name.split(".")[-1] not in known_references for name in relations)
                or re.search(r"\bjoin\b|\bwith\b|\bselect\s+\*", sql)):
            return True
    return False


def _is_limitation(assertion: str, claim_match: re.Match[str] | None) -> bool:
    """A caveat after a positive assertion does not excuse that assertion."""
    if assertion.rstrip().endswith("?"):
        return True
    if re.match(r"^(?:nếu|giả sử|if|suppose)\b", assertion, re.IGNORECASE):
        return True
    limitation = _LIMITATION.search(assertion)
    proposal = _PROPOSAL.search(assertion)
    return any(
        match and (claim_match is None or match.start() <= claim_match.start())
        for match in (limitation, proposal)
    )


def _claim_scope(assertion: str, request_text: str) -> str:
    """Conservative presentation hints, not a router or a general NL verifier.

    A conceptual user request cannot excuse an explicit measured shop claim.
    A mixed answer is classified per sentence, never exempted wholesale.
    """
    if _MEASURED_VALUE.search(assertion):
        return "empirical"
    if re.search(r"\b(?:được định nghĩa|defined as|refers to)\b", assertion, re.IGNORECASE):
        return "conceptual"
    if _EMPIRICAL_ANCHOR.search(assertion):
        return "empirical"
    if _GENERAL_EXPLANATION.search(assertion):
        return "conceptual"
    if (_CONCEPTUAL_REQUEST.search(request_text)
            and not _EMPIRICAL_ANCHOR.search(request_text)
            and not _MEASURED_VALUE.search(request_text)
            and not _ANALYTICAL_REQUEST.search(request_text)):
        return "conceptual"
    if _EMPIRICAL_WORDING.search(assertion):
        return "empirical"
    return "uncertain"


def guard_final_claims(content: str, steps: Iterable[dict[str, Any]],
                       locale: str = "vi", *,
                       artifacts: Optional[Iterable[Any]] = None,
                       request_text: str = "") -> tuple[str, list[str]]:
    """Check final presentation without constraining planning, SQL or tools.

    Remove only clearly empirical claims outside captured query scope. Retain
    ambiguous interpretations/proposals and mark their unverified status. Even
    compatible SQL is not proof that values or business semantics are correct.
    """
    steps = list(steps)
    artifact_list = list(artifacts) if artifacts is not None else None
    queries = _artifact_sql(artifact_list) if artifact_list is not None else _successful_sql(steps)
    opaque_scope = _scope_is_opaque(queries, artifact_list or [])
    # KB listing/retrieval alone is not an exemption for measured shop claims.
    # Document explanations remain eligible through sentence-level scoping.
    unverified_sql_example = _has_unverified_sql_examples(content, queries)
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
            r"(?=,\s*(?:nhưng|tuy nhiên|thực tế|but|however|in fact)\b)|"
            r"(?=\s*(?:→|->)\s*)",
            line, flags=re.IGNORECASE,
        )
        for sentence in sentences:
            before = len(issues)
            _check_sentence(sentence, queries, output, issues, request_text, opaque_scope)
            if len(issues) > before and sentence.endswith("\n") and output:
                if not output[-1].endswith("\n"):
                    output.append("\n")
    if not issues:
        return content, []
    messages = []
    if any(not issue.startswith("review_required:") and issue != "unverified_sql_example" for issue in issues):
        messages.append(
            "Một số diễn giải về hành vi hoặc kết quả đã được lược bỏ vì các truy vấn "
            "trong lượt này chưa cung cấp bằng chứng phù hợp."
            if locale.startswith("vi") else
            "Some behavioral or outcome interpretations were omitted because this "
            "run did not provide the necessary evidence."
        )
    if any(issue.startswith("review_required:") for issue in issues):
        messages.append(
            "Một số diễn giải được giữ lại để tham khảo, nhưng chưa được xác minh "
            "với kết quả và ngữ nghĩa dữ liệu; không xem chúng là kết luận đã chứng nhận."
            if locale.startswith("vi") else
            "Some interpretations are retained for review, but their result values "
            "and business meaning have not been verified; they are not certified findings."
        )
    if unverified_sql_example:
        messages.append(
            "SQL đề xuất được giữ nguyên; cần kiểm tra các bảng/cột chưa được đối chiếu trước khi dùng."
            if locale.startswith("vi") else
            "Proposed SQL is retained; verify unconfirmed tables/columns before using it."
        )
    remaining = "".join(output).rstrip()
    return (remaining + "\n\n" if remaining else "") + "\n".join(messages), sorted(set(issues))


def _check_sentence(
    line: str, queries: list[str], output: list[str], issues: list[str],
    request_text: str = "",
    opaque_scope: bool = False,
) -> None:
    assertion = re.sub(r"^\s*(?:[-*]|\d+\.)\s*", "", line).strip()
    assertion = re.sub(r"\*\*|__|`", "", assertion).lstrip("# ")
    if not assertion:
        output.append(line)
        return
    scope = _claim_scope(assertion, request_text)
    if scope == "conceptual":
        output.append(line)
        return
    if _DATASET_SESSION_GRAIN.search(assertion) and not _is_limitation(assertion, None):
        if not _dataset_session_grain_supported(queries):
            if scope == "empirical" and not opaque_scope:
                issues.append("unsupported_grain")
                return
            issues.append("review_required:unsupported_grain")
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
    review = []
    for pattern, category, required in checks:
        claim = pattern.search(assertion)
        if claim and not _is_limitation(assertion, claim):
            if required is None or not _has_query_scope(queries, *required):
                if opaque_scope and required is not None:
                    review.append("review_required:" + category)
                else:
                    missing.append(category)
            else:
                # Matching table/column names do not verify a numerical claim.
                review.append("review_required:" + category)
    if missing and scope == "empirical":
        issues.extend(missing)
        return
    issues.extend(review + ["review_required:" + category for category in missing])
    output.append(line)
