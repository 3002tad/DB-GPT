"""Explain missing explicit bindings without interpreting prompt text as authority."""

import re


def missing_context_selections(user_input, database_name=None, knowledge_space=None):
    prefix = re.match(
        r"^\s*((?:\[(?:Database|Knowledge):[^\]\r\n]+\]\s*)+)",
        user_input,
        re.IGNORECASE,
    )
    labels = prefix.group(1).casefold() if prefix else ""
    missing = []
    if "[database:" in labels and not database_name:
        missing.append("database")
    if "[knowledge:" in labels and not knowledge_space:
        missing.append("knowledge")
    return missing


def context_selection_message(locale):
    locale = str(locale or "").lower()
    if locale.startswith("vi"):
        return (
            "Nhãn [Database: …] hoặc [Knowledge: …] trong câu hỏi chưa chọn nguồn "
            "thực tế. Hãy chọn nguồn dữ liệu/kho tri thức bằng các nút bên dưới "
            "ô nhập rồi gửi lại. Chưa chạy phân tích hoặc gọi model cho yêu cầu này."
        )
    if locale.startswith("zh"):
        return (
            "问题中的 [Database: …] 或 [Knowledge: …] 标签不会选择实际数据源。"
            "请使用输入框下方的控件选择数据源或知识库后重新发送。"
            "此请求尚未执行分析或调用模型。"
        )
    return (
        "Typed [Database: …] or [Knowledge: …] labels do not select a source. "
        "Choose the datasource/knowledge base using the controls below the input, "
        "then send again. No analysis or model call was started for this request."
    )
