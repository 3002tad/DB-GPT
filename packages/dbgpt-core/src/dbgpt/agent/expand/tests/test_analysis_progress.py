from dbgpt.agent.expand.analysis_progress import pin_analysis_progress, START


def test_latest_projection_replaces_old_and_keeps_evidence():
    data = {"tasks": [{"status": "pending"}], "evidence_total": 2}
    state = {"_analysis_progress_provider": lambda: data}
    first = pin_analysis_progress("original instructions", state)
    data["tasks"][0]["status"] = "completed"
    latest = pin_analysis_progress(first, state)
    assert latest.count(START) == 1
    assert '"pending"' not in latest
    assert '"completed"' in latest
    assert latest.startswith("original instructions")
    assert "All authorized tools remain available" in latest


def test_provider_failure_or_oversize_is_fail_open():
    def failing():
        raise RuntimeError("unavailable")
    assert pin_analysis_progress("original", {"_analysis_progress_provider": failing}) == "original"
    assert pin_analysis_progress("original", {"_analysis_progress_provider": lambda: {"x": "a" * 8000}}) == "original"
    assert pin_analysis_progress("original", {}) == "original"
