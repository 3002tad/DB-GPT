"""Offline regression tests: clarification scope survives rolling memory."""
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import unittest

BASE = Path(__file__).resolve().parents[1] / "openapi/api_v1"


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


decisions = load("decisions", BASE / "user_decisions.py")
core = next(p for p in Path(__file__).resolve().parents if p.name == "packages")
context = load("decision_context", core / "dbgpt-core/src/dbgpt/agent/expand/decision_context.py")
locale = load("suite_prompt_locale", BASE / "suite_prompt_locale.py")
progress = load("task_progress", BASE / "task_progress.py")


class DecisionContextTest(unittest.TestCase):
    def test_confirmed_scope_round_trip_keeps_a_later_return_to_an_earlier_choice(self):
        state = {}
        for index, answer in enumerate(("Q2", "Q3", "Q2")):
            decisions.remember_answers(state, [{"question": "Period?", "answer": answer}], str(index))
        saved = {"user_decisions": state["_user_decisions"]}
        restored = {}
        decisions.restore_answers(restored, [SimpleNamespace(type="view", content=saved)])
        self.assertEqual(state, restored)
        prompt = context.decision_context(restored)
        self.assertLess(prompt.index('"answer": "Q3"'), prompt.rindex('"answer": "Q2"'))

    def test_partial_terminal_plan_keeps_unfinished_objectives_in_denominator(self):
        tasks = [{"status": "completed"}, {"status": "in_progress"}, {"status": "pending"}]
        self.assertTrue(progress.pause_unfinished_tasks(tasks, "vi"))
        self.assertEqual(["completed", "pending", "pending"], [t["status"] for t in tasks])
        self.assertEqual({"state": "progress", "done": 1, "total": 3}, progress.task_plan_meta(tasks))

    def test_repin_does_not_repeat_scope_or_drop_unrelated_system_instructions(self):
        state = {}
        decisions.remember_answers(state, [{"question": "Period?", "answer": "Q2"}], "1")
        prompt = context.pin_decision_context("Keep all tools", state)
        decisions.remember_answers(state, [{"question": "Period?", "answer": "Q3"}], "2")
        prompt = context.pin_decision_context(prompt, state)
        self.assertEqual(1, prompt.count("Confirmed user clarification answers"))
        self.assertTrue(prompt.startswith("Keep all tools"))
        self.assertIn('"answer": "Q3"', prompt)

    def test_correction_survives_history_and_old_model_prose_is_not_a_decision(self):
        pairs = [{"question": "Period?", "answer": "Q3/2026"}]
        payload = {"final_content": "Q2/2026 top 10", "steps": [
            {"action": "question", "outputs": [{"output_type": "question_recap", "content": {"pairs": pairs}}]},
            {"action": "sql_query", "outputs": [{"output_type": "question_recap", "content": {"pairs": [{"question": "Period?", "answer": "wrong"}]}}]},
        ]}
        state = {}
        decisions.remember_answers(state, [{"question": "Ranking?", "answer": "20 by order count"}])
        decisions.restore_answers(state, [SimpleNamespace(type="view", content=json.dumps(payload))])
        prompt = context.decision_context(state)
        self.assertIn("Q3/2026", prompt)
        self.assertIn("20 by order count", prompt)
        self.assertNotIn("Q2/2026", prompt)
        self.assertNotIn('"wrong"', prompt)
        before = len(state["_user_decisions"])
        decisions.restore_answers(state, [SimpleNamespace(type="view", content=payload)])
        self.assertEqual(before, len(state["_user_decisions"]))

    def test_empty_rejected_malformed_and_timeout_do_not_pin_answers(self):
        state = {}
        decisions.remember_answers(state, [{"question": "Period?", "answer": ""}])
        for flag in ("rejected", "timed_out"):
            payload = {"steps": [{"action": "question", "outputs": [{"output_type": "question_recap", "content": {flag: True, "pairs": [{"question": "Period?", "answer": "Q2"}]}}]}]}
            decisions.restore_answers(state, [SimpleNamespace(type="view", content=payload)])
        decisions.restore_answers(state, [SimpleNamespace(type="view", content="{bad")])
        self.assertEqual("", context.decision_context(state))

    def test_localized_package_injects_each_reference_once_without_cjk(self):
        root = core.parent
        package = root / "assets/suites/db-query"
        path = "skills/nl2sql-precision/SKILL.md"
        body = (package / path).read_text(encoding="utf-8")
        binding = SimpleNamespace(name="db-query", version="1.1.0", package_path=str(package),
            sop_text="original SOP", command_skill_text=body, command="/nl2sql",
            command_skill="nl2sql-precision", command_error="", watermark="",
            commands=[{"name": "/nl2sql"}], loaded_documents=[{"path": path, "sha256": "source-hash"},
                {"path": "prompts/query-playbook.md", "content": "original SOP"}])
        result = locale.localized_sop_block(binding, "vi-VN")
        self.assertNotRegex(result, r"[\u4e00-\u9fff]")
        self.assertEqual(1, result.count("# Smart Data Query: runtime playbook"))
        self.assertEqual(1, result.count("# nl2sql-precision"))
        self.assertLess(len(result), len(body))
        self.assertIn("Public progress and final explanations must use vi", result)


if __name__ == "__main__":
    unittest.main()
