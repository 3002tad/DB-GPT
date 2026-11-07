"""User-facing execution failure messages follow the selected UI locale."""

from dbgpt_app.openapi.api_v1.execution_fallback import (
    execution_copy,
    missing_report_message,
    unfinished_message,
)


def test_vietnamese_unfinished_execution_keeps_progress_without_chinese():
    message = unfinished_message(
        "vi-VN", "failed", ["Đếm phiên"], ["Tổng hợp"], ["Kiểm tra"],
        "SQL failed", recovered=False,
    )
    assert "Tác vụ chưa hoàn thành: thực thi thất bại" in message
    assert "Đã hoàn thành: Đếm phiên" in message
    assert "Còn lại: Tổng hợp" in message
    assert "Lý do: SQL failed" in message
    assert "继续" not in message and "任务" not in message


def test_english_fallback_and_chinese_explicit_locale():
    assert execution_copy("")["main_incomplete"].startswith("The main flow")
    assert "Task incomplete" in unfinished_message("fr", "step_limit")
    assert "任务未完成" in unfinished_message("zh-CN", "timeout")
    assert "Chưa tạo được" in missing_report_message("vi", "render failed")
