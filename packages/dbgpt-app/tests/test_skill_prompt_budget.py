"""Render the real skill template without booting databases or model workers."""

import ast
import json
import unittest
from pathlib import Path
from types import SimpleNamespace


SOURCE = Path(__file__).parents[1] / "src/dbgpt_app/openapi/api_v1/agentic_data_api.py"


def render_skill_prompt(source, mode="skill", **overrides):
    tree = ast.parse(source)
    branch = next(node for node in ast.walk(tree) if isinstance(node, ast.If)
                  and isinstance(node.test, ast.Name) and node.test.id == "is_skill_mode"
                  and any(isinstance(child, ast.Assign)
                          and any(isinstance(t, ast.Name) and t.id == "workflow_prompt"
                                  for t in child.targets) for child in node.body))
    candidates = branch.body if mode == "skill" else branch.orelse
    value = next(child.value for child in candidates if isinstance(child, ast.Assign)
                 and any(isinstance(t, ast.Name) and t.id == "workflow_prompt"
                         for t in child.targets))
    context = dict(language_instruction="LANGUAGE", skill_prompt_context="SKILL",
                   execution_instruction="EXECUTION", available_images_hint="IMAGES",
                   file_context="FILES", knowledge_context="KNOWLEDGE",
                   database_context="DATABASE", native_response_format="NATIVE",
                   skills_context="SKILLS", codegraph_section="CODEGRAPH",
                   wiki_section="WIKI",
                   traceable_report_capability=SimpleNamespace(prompt_fragment="REPORT_POLICY"),
                   DEFAULT_SKILLS_DIR="/skills", Path=Path, json=json, _skill_name="sample")
    context.update(overrides)
    return eval(compile(ast.Expression(value), str(SOURCE), "eval"), context)


class SkillPromptBudgetTest(unittest.TestCase):
    def test_preserves_context_and_report_policy_without_expanding_json(self):
        values = {name: f'{name}: {{"status":"UNVERIFIED","amount":null}}'
                  for name in ("skill_prompt_context", "execution_instruction",
                               "file_context", "knowledge_context", "database_context",
                               "available_images_hint", "language_instruction")}
        prompt = render_skill_prompt(SOURCE.read_text(encoding="utf-8"), **values)
        for value in values.values():
            self.assertEqual(prompt.count(value), 1)
        self.assertIn("REPORT", prompt)
        self.assertIn("Other registered tools remain available", prompt)
        self.assertIn("never both", prompt)  # args versus argv
        self.assertIn("non-retryable", prompt)
        self.assertLess(len(prompt), 3500)

    def test_general_prompt_keeps_skill_and_data_context(self):
        prompt = render_skill_prompt(SOURCE.read_text(encoding="utf-8"),
                                     mode="general")
        for value in ("SKILLS", "KNOWLEDGE", "DATABASE", "FILES", "REPORT_POLICY",
                      "CODEGRAPH", "WIKI", "NATIVE"):
            self.assertEqual(prompt.count(value), 1, value)
        self.assertIn("dispatch_parallel_tasks", prompt)
        self.assertIn("generate_report", prompt)
        self.assertIn("REPORT_RESULT", prompt)
        self.assertLess(len(prompt), 3200)

    def test_quality_guidance_applies_after_all_prompt_branches(self):
        tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
        policies = [node.value.value for node in ast.walk(tree)
                    if isinstance(node, ast.AugAssign)
                    and isinstance(node.target, ast.Name)
                    and node.target.id == "workflow_prompt"
                    and isinstance(node.value, ast.Constant)
                    and isinstance(node.value.value, str)]
        policy = next(p for p in policies if "Evidence and concise answers" in p)
        self.assertIn("Preserve the status returned", policy)
        self.assertIn("not what has been observed", policy)
        self.assertIn("Use already retrieved", policy)

    def test_selected_skill_keeps_kb_tools_in_both_modes(self):
        tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
        skill_branch = next(node for node in ast.walk(tree)
                            if isinstance(node, ast.If)
                            and isinstance(node.test, ast.Name)
                            and node.test.id == "is_skill_mode"
                            and any(isinstance(child, ast.Assign)
                                    and any(isinstance(t, ast.Name)
                                            and t.id == "workflow_prompt"
                                            for t in child.targets)
                                    for child in node.body))
        mode_branch = next(node for node in skill_branch.body
                           if isinstance(node, ast.If)
                           and isinstance(node.test, ast.Compare)
                           and isinstance(node.test.left, ast.Name)
                           and node.test.left.id == "tool_mode")
        context = {name: name for name in (
            "execute_skill_script", "get_skill_resource",
            "execute_skill_script_file_tool", "code_interpreter_tool",
            "read_file_tool", "sql_query_tool", "chart_query_tool",
            "todowrite_tool", "question_tool")}
        context.update(kb_tool_list=["kb_grep", "kb_cat"],
                       report_tools=["generate_report"], business_tools=[],
                       connector_tool_extras=[], Terminate=lambda: "terminate",
                       ToolPack=lambda tools: tools)
        for mode, branch in (("knowledge", mode_branch.body),
                             ("analysis", mode_branch.orelse)):
            assignment = next(node for node in branch if isinstance(node, ast.Assign)
                              and any(isinstance(t, ast.Name) and t.id == "tool_pack"
                                      for t in node.targets))
            tools = eval(compile(ast.Expression(assignment.value), str(SOURCE),
                                 "eval"), context)
            self.assertIn("kb_grep", tools, mode)
            self.assertIn("kb_cat", tools, mode)
            self.assertEqual(tools.count("kb_grep"), 1, mode)
            self.assertEqual("sql_query_tool" in tools, mode == "analysis")

    def test_zero_temperature_is_preserved(self):
        tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
        context = next(node for node in ast.walk(tree) if isinstance(node, ast.Call)
                       and isinstance(node.func, ast.Name)
                       and node.func.id == "AgentContext"
                       and any(kw.arg == "pin_selected_model" for kw in node.keywords))
        value = next(kw.value for kw in context.keywords
                     if kw.arg == "temperature")
        code = compile(ast.Expression(value), str(SOURCE), "eval")
        for requested, expected in ((0, 0), (0.7, 0.7), (None, 0.2)):
            self.assertEqual(eval(code, {"dialogue": SimpleNamespace(
                temperature=requested)}), expected)


if __name__ == "__main__":
    unittest.main()
