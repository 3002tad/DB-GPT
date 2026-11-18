"""Localized user-facing messages for an unfinished Agent execution."""

import re

_COPY = {
    "vi": {
        "unfinished": "Tác vụ chưa hoàn thành",
        "saved": "Kết quả đã thực hiện được giữ lại.",
        "completed": "Đã hoàn thành",
        "remaining": "Còn lại",
        "partial": "Tác vụ con hoàn thành một phần",
        "reason": "Lý do",
        "recovered": "Báo cáo phân tích HTML đã được tạo từ kết quả hiện có.",
        "resume_skill": "Khi tiếp tục, dùng lại thư mục kỹ năng đã tạo và hoàn thiện tệp, kiểm thử, đóng gói.",
        "resume_other": "Khi tiếp tục, dùng lại kết quả hiện có và chỉ bổ sung phân tích hoặc báo cáo còn thiếu.",
        "invalid_final": "Tác vụ chưa hoàn thành: mô hình chưa trả về kết quả cuối hợp lệ. Hãy xem các bước thực thi.",
        "report_missing": "Chưa tạo được báo cáo phân tích HTML",
        "report_unfinished": "Chưa hoàn tất kết xuất báo cáo",
        "report_binding": "Một số mục trong báo cáo chưa có liên kết bằng chứng hợp lệ.",
        "report_review": "Chi tiết lỗi được giữ trong các bước thực thi. Hãy dùng lại kết quả đã có khi tiếp tục.",
        "main_incomplete": "Luồng chính chưa gửi kết quả hoàn chỉnh",
        "thinking": "Đang suy luận", "skill_phase": "Nạp kỹ năng",
        "tool_unfinished": "Quá trình kết thúc trước khi công cụ trả về kết quả",
        "main_interrupted": "Luồng chính bị gián đoạn",
        "interrupted_notice": "Tác vụ đã bị gián đoạn. Tiến độ và kết quả đã lưu được giữ lại; bạn có thể tiếp tục tác vụ.",
        "statuses": {"timeout": "hết thời gian", "step_limit": "đạt giới hạn bước thực thi", "failed": "thực thi thất bại", "report_failed": "kết xuất báo cáo thất bại", "incomplete": "tác vụ chưa hoàn thành"},
    },
    "en": {
        "unfinished": "Task incomplete", "saved": "Existing results have been preserved.",
        "completed": "Completed", "remaining": "Remaining", "partial": "Partially completed subtasks", "reason": "Reason",
        "recovered": "The HTML analysis report was generated from existing artifacts.",
        "resume_skill": "On continuation, reuse the skill directory and complete its files, tests, and package.",
        "resume_other": "On continuation, reuse existing artifacts and complete only the missing analysis or report.",
        "invalid_final": "Task incomplete: the model did not return a valid final result. Review the execution steps.",
        "report_missing": "The HTML analysis report was not generated", "report_unfinished": "Report rendering did not finish",
        "report_binding": "Some report items do not have valid evidence bindings.",
        "report_review": "Full diagnostics remain in the execution steps. Reuse existing results when continuing.",
        "main_incomplete": "The main flow did not submit a complete result",
        "thinking": "Thinking", "skill_phase": "Loading skill",
        "tool_unfinished": "Execution ended before the tool reported a result",
        "main_interrupted": "The main flow was interrupted",
        "interrupted_notice": "Execution was interrupted. Saved progress and results were retained; you can continue the task.",
        "statuses": {"timeout": "timed out", "step_limit": "reached the step limit", "failed": "execution failed", "report_failed": "report rendering failed", "incomplete": "task incomplete"},
    },
    "zh": {
        "unfinished": "任务未完成", "saved": "已有执行结果已保留。",
        "completed": "已完成", "remaining": "待完成", "partial": "部分完成的子任务", "reason": "原因",
        "recovered": "HTML 分析报告已复用现有产物生成。",
        "resume_skill": "继续时应复用已创建的技能目录，补齐文件、测试和打包。",
        "resume_other": "继续时应复用现有产物，只补充缺失分析和报告。",
        "invalid_final": "任务未完成：模型未返回有效的最终结果，请查看执行步骤。",
        "report_missing": "HTML 分析报告未生成", "report_unfinished": "报告渲染未完成",
        "report_binding": "报告中的部分内容尚未关联有效证据。",
        "report_review": "完整诊断保留在执行步骤中，继续时请复用已有结果。",
        "main_incomplete": "主流程未提交完整结果",
        "thinking": "思考中", "skill_phase": "加载技能",
        "tool_unfinished": "执行提前结束，未收到工具完成结果",
        "main_interrupted": "主流程执行中断",
        "interrupted_notice": "任务执行已中断，已保存的进度和结果已保留，可继续任务。",
        "statuses": {"timeout": "运行超时", "step_limit": "达到执行步数上限", "failed": "执行失败", "report_failed": "报告渲染失败", "incomplete": "任务未完成"},
    },
}


def execution_copy(locale: str) -> dict:
    """Use the UI locale; unknown locales fall back to English."""
    language = (locale or "").lower().split("-", 1)[0].split("_", 1)[0]
    return _COPY.get(language, _COPY["en"])


def unfinished_message(locale: str, status: str, completed=(), remaining=(), partial=(), error=None, recovered=False, skill_creator=False) -> str:
    copy = execution_copy(locale)
    label = copy["statuses"].get(status, copy["statuses"]["incomplete"])
    headline = copy["unfinished"] + (f": {label}" if status != "incomplete" else "") + ". " + copy["saved"]
    lines = [headline]
    for key, values in (("completed", completed), ("remaining", remaining), ("partial", partial)):
        if values:
            lines.append(f"{copy[key]}: " + "; ".join(str(value) for value in values))
    if status == "failed" and error:
        reason = str(error)
        if _REPORT_ERROR.search(reason):
            reason = _public_report_reason(locale, reason)
        lines.append(f"{copy['reason']}: {reason[:1000]}")
    lines.append(copy["recovered"] if recovered else copy["resume_skill" if skill_creator else "resume_other"])
    return "\n".join(lines)


def missing_report_message(locale: str, reason: str) -> str:
    copy = execution_copy(locale)
    return (
        f"{copy['report_missing']}. {_public_report_reason(locale, reason)} "
        f"{copy['saved']} {copy['report_review']}"
    )


_REPORT_ERROR = re.compile(r"\b(?:REPORT|HTML)_[A-Z][A-Z0-9_]*\s*:")


def _public_report_reason(locale: str, reason: str) -> str:
    """Never copy HTML, target JSON, paths or arbitrary exception text to a final."""
    copy = execution_copy(locale)
    if "REPORT_TARGET_BINDING_REQUIRED" in str(reason):
        return copy["report_binding"]
    return copy["report_unfinished"] + "."


def report_failure_answer(content: str, locale: str, reason: str) -> str:
    """Retain the analytical answer while separating failed report delivery.

    Raw tool diagnostics remain in history steps/checkpoints. A diagnostic block
    is not an analytical paragraph; preserve only preceding complete paragraphs.
    This presentation helper does not mark reports or other deliverables ready.
    """
    text = content.strip()
    marker = _REPORT_ERROR.search(text)
    diagnostic_start = marker.start() if marker else (
        text.find(str(reason)) if reason else -1
    )
    if diagnostic_start >= 0:
        prefix = text[:diagnostic_start]
        if prefix.endswith("\n\n"):
            text = prefix.strip()
        elif "\n\n" in prefix:
            text = prefix.rsplit("\n\n", 1)[0].strip()
        else:
            text = ""
    if text.startswith(tuple(copy["report_missing"] for copy in _COPY.values())):
        text = ""
    notice = missing_report_message(locale, reason)
    return f"{text}\n\n{notice}" if text else notice
