"""Separate failed tool execution from business clarification for one agent turn."""

import json

from dbgpt.agent import ActionOutput

_SQL_AUTHORING_CODES = {
    "SQL_UNDEFINED_COLUMN", "SQL_UNDEFINED_TABLE", "SQL_AMBIGUOUS_COLUMN",
    "SQL_GROUPING_ERROR",
}

TOOL_STAGES = {
    "propose_dashboard_change": "生成批注修改提案",
    "question": "校验业务追问参数",
    "sql_query": "探索源数据",
    "plan_dashboard": "生成看板规划",
    "load_dashboard_draft": "加载已保存看板",
    "resolve_dashboard_reference": "定位看板组件",
    "create_dashboard_draft": "生成组件查询",
    "repair_dashboard_draft": "修复组件查询",
    "modify_dashboard_draft": "修改看板",
    "revise_dashboard_plan": "修改看板规划",
}

_STAGE_TRANSLATIONS = {
    "vi": ["Đề xuất chỉnh sửa", "Kiểm tra câu hỏi làm rõ", "Khám phá dữ liệu",
           "Lập kế hoạch dashboard", "Tải dashboard đã lưu", "Xác định thành phần",
           "Tạo truy vấn biểu đồ", "Sửa truy vấn biểu đồ", "Chỉnh sửa dashboard",
           "Chỉnh sửa kế hoạch"],
    "en": ["Propose changes", "Validate clarification", "Explore source data",
           "Plan dashboard", "Load saved dashboard", "Resolve component",
           "Generate chart queries", "Repair chart queries", "Modify dashboard",
           "Revise dashboard plan"],
}


def _locale(state):
    language = str(state.get("_ui_locale") or state.get("_report_language") or "en").lower()
    return "vi" if language.startswith("vi") else "zh" if language.startswith("zh") else "en"


def _stage_label(name, locale):
    if locale == "zh":
        return TOOL_STAGES.get(name, "解析或执行模型工具调用")
    return dict(zip(TOOL_STAGES, _STAGE_TRANSLATIONS[locale])).get(
        name, "Thực thi công cụ" if locale == "vi" else "Execute tool"
    )


def _decode(value):
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value or "{}")
    except (TypeError, ValueError):
        return None


def _failed_results(output):
    """Read structured batch observations; never parse joined content as JSON."""
    payload = _decode(output.observations) or _decode(output.content)
    if isinstance(payload, list):
        if output.is_exe_success and any(
            not isinstance(item, dict) or not isinstance(item.get("success"), bool)
            for item in payload
        ):
            # A successful tool may return a business JSON array, not a batch.
            return []
        failures = []
        for item in payload:
            if not isinstance(item, dict) or not isinstance(item.get("success"), bool):
                return [(output.action or "agent_output", None, "Malformed batch observation")]
            if item["success"] is False:
                raw = item.get("observation") or item.get("content")
                failures.append((item.get("name") or "agent_output", _decode(raw), raw))
        return failures
    if isinstance(payload, dict) and isinstance(payload.get("__dashboard_tool_error__"), dict):
        return [(output.action or "agent_output", payload, output.content)]
    return [] if output.is_exe_success else [(
        output.action or "agent_output", payload, output.observations or output.content
    )]


def _error_detail(name, payload, raw):
    payload = payload if isinstance(payload, dict) else {}
    explicit = payload.get("__dashboard_tool_error__") or {}
    explicit = explicit if isinstance(explicit, dict) else {}
    chunks = payload.get("chunks")
    chunks = chunks if isinstance(chunks, list) else []
    text = "\n".join(
        str(chunk.get("content", "")) for chunk in chunks
        if isinstance(chunk, dict) and chunk.get("output_type") == "text"
    )
    # No successful sibling rows/artifacts belong in a failure explanation.
    return {
        "tool": explicit.get("tool") or name,
        "code": explicit.get("code") or payload.get("error_code") or "tool_execution_failed",
        "reason": str(explicit.get("reason") or text or payload.get("message")
                      or payload.get("error") or raw or "No valid tool result.")[:2000],
        **({"stage": explicit["stage"]} if explicit.get("stage") else {}),
        **({"recovery_hint": payload["recovery_hint"]} if payload.get("recovery_hint") else {}),
        **({"recovery_schema": payload["recovery_schema"]} if payload.get("recovery_schema") else {}),
    }


def discovery_correction(state, output):
    """Keep a bounded SQL authoring error in the loop with its real evidence."""
    if (
        output is None
        or output.is_exe_success
        or {name.strip() for name in (output.action or "").split(",")} != {"sql_query"}
        or state.get("dashboard_generation")
    ):
        return None
    failures = _failed_results(output)
    if not failures:
        return None
    for name, failure, _raw in failures:
        if name != "sql_query" or not isinstance(failure, dict):
            return None
        code = failure.get("error_code")
        if code in _SQL_AUTHORING_CODES:
            continue
        if code != "SQL_QUERY_FAILED":
            return None
        chunks = failure.get("chunks")
        if not isinstance(chunks, list):
            return None
        reason = "\n".join(
            str(chunk.get("content", ""))
            for chunk in chunks
            if isinstance(chunk, dict) and chunk.get("output_type") == "text"
        )
        if any(marker in reason.lower() for marker in (
            "permission denied", "timeout", "connection refused", "connection closed",
            "read-only", "blocked_by_quality", "[approval]",
        )):
            return None
        if not any(
            marker in reason.lower()
            for marker in ("no such table:", "no such column:", "syntax error")
        ):
            # Never recover a batch containing timeout, approval rejection,
            # security failure or an unknown execution error.
            return None
    attempts = state.get("_dashboard_discovery_corrections", 0)
    if attempts >= 2:
        return None
    state["_dashboard_discovery_corrections"] = attempts + 1
    details = [_error_detail(*failure) for failure in failures]
    return (
        json.dumps({"failed_calls": details}, ensure_ascii=False) + "\n"
        "The failed discovery SELECTs returned no valid data. "
        "Retain any successful results in this batch; correct failed calls only. "
        "Use the authorized tables, columns and SQL dialect already provided "
        "in the database context and the returned recovery_schema/recovery_hint. "
        "Use information_schema only when supported by the selected dialect; "
        "SQLite has no information_schema or pg_catalog. "
        "Do not repeat the failed SQL or ask the user a technical question. "
        "Call sql_query with a corrected SELECT against the listed business "
        "tables, or plan_dashboard from the observations already collected. "
        f"Correction {attempts + 1} of 2; the discovery call limit is unchanged."
    )


def capture_tool_failure(state, output):
    """Use actual execution status / explicit error metadata, never prose guessing."""
    if output is None:
        return None
    failures = _failed_results(output)
    if not failures:
        if output.is_exe_success:
            return None
        failures = [(output.action or "agent_output", None, "No failed batch item was supplied.")]
    details = [_error_detail(*failure) for failure in failures]
    # A fatal/unknown sibling must not disappear behind a long schema error
    # when the user-facing summary is bounded. Keep every failed item below.
    details.sort(key=lambda item: item["code"] in _SQL_AUTHORING_CODES)
    error = details[0]
    name = ", ".join(dict.fromkeys(item["tool"] for item in details))
    names = set(name.split(", "))
    stage_name = next(iter(names)) if len(names) == 1 else name
    locale = _locale(state)
    stage_label = _stage_label(stage_name, locale)
    reason = "\n".join(f"[{item['code']}] {item['reason']}" for item in details)[:2000]
    retry_hint = (
        "本轮已停止，不会要求你解答内部技术问题。"
        "已保存的看板和发布版本保持不变。请检查需求后重新发起本次操作；"
        "如再次失败，请将上述工具名称和错误详情交给维护者排查。"
    )
    if locale != "zh":
        retry_hint = (
            "Lượt này đã dừng. Dashboard và phiên bản đã lưu được giữ nguyên. "
            "Kiểm tra yêu cầu trước khi thử lại; gửi mã lỗi cho người bảo trì nếu lỗi tiếp diễn."
            if locale == "vi" else
            "This turn stopped. Saved dashboards and published versions are preserved. "
            "Review the request before retrying; report the error code if it persists."
        )
    generation = state.get("dashboard_generation") or {}
    failure = {
        **generation,
        "type": "dashboard.generation.failed",
        "title": "Thao tác dashboard thất bại" if locale == "vi" else "Dashboard operation failed" if locale == "en" else "看板操作失败",
        "reason": error.get("code", "tool_execution_failed"),
        "tool": name,
        "stage": error.get("stage", name),
        "stage_label": stage_label,
        "summary": f"{stage_label}失败：{reason}",
        "message": (
            f"停在「{stage_label}」（{name}）。\n失败原因：{reason}\n{retry_hint}"
        ),
        "retry_hint": retry_hint,
        "source_turn_id": generation.get("source_turn_id") or state.get("conv_id"),
        "failed_calls": details,
    }
    if locale != "zh":
        failure["summary"] = f"{stage_label}: {reason}"
        failure["message"] = (
            f"Dừng ở bước {stage_label} ({name}).\nLý do: {reason}\n{retry_hint}"
            if locale == "vi" else f"Stopped at {stage_label} ({name}).\nReason: {reason}\n{retry_hint}"
        )
    if generation.get("dashboard_id"):
        failure["editor_path"] = f"/dashboards/{generation['dashboard_id']}"
    state["dashboard_tool_failure"] = failure
    return failure


def failed_action(failure, action=None):
    # LOOP verification checks have_retry, not terminate, on unsuccessful actions.
    return ActionOutput(
        is_exe_success=False,
        have_retry=False,
        terminate=False,
        action=action or failure.get("tool"),
        content=failure["message"],
        observations=failure["message"],
    )
