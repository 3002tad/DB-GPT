"""Advisory provenance for source analysis; never restrict Python execution."""


def uncaptured_source_computations(sink):
    if sink is None:
        return []
    artifacts = sink.snapshot()
    if not any(a.type == "sql" and a.status == "succeeded" for a in artifacts):
        return []
    return [a.artifact_id for a in artifacts if (
        a.type == "python" and a.status == "succeeded" and a.result is not None
        and not a.input_artifact_ids
        and a.execution.run_id == sink.context.run_id
    )]


def source_lineage_notice(sink, locale="en"):
    if not uncaptured_source_computations(sink):
        return ""
    if locale.startswith("vi"):
        return (
            "Lưu ý bằng chứng: một số kết quả Python chưa có liên kết đầu vào "
            "tới dữ liệu nguồn đã capture. Chúng chỉ chứng minh phép tính đã "
            "chạy, chưa xác minh được các phân phối/kết luận mới là số đo từ "
            "database. Cần truy vấn đúng grain hoặc liên kết artifact nguồn để xác minh."
        )
    if locale.startswith("zh"):
        return "来源提示：部分 Python 计算没有已捕获输入的关联，不能视为已验证的数据库统计；请补充同粒度查询或来源关联。"
    return (
        "Evidence limitation: some Python results have no captured input lineage. "
        "Successful computation alone does not verify new distributions or claims "
        "as observed database statistics. Query the required grain or link source artifacts."
    )
