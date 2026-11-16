"""Turn guidance must match upstream discovery and canonical tool schemas."""
import unittest
from dbgpt_app.openapi.api_v1.tool_names import canonical_tool, tool_availability_guidance


class ToolAvailabilityTest(unittest.TestCase):
    def test_discovery_keeps_renamed_script_capability_reachable(self):
        text = tool_availability_guidance({"tool_search", "sql_query"}, {"run_skill_script", "code"})
        self.assertIn("next round", text)
        self.assertIn("execute_skill_script_file -> run_skill_script", text)
        self.assertIn("code_interpreter -> code", text)
        self.assertNotIn("shell_interpreter -> bash", text)

    def test_knowledge_mode_does_not_advertise_nonexistent_discovery(self):
        text = tool_availability_guidance({"kb_cat", "terminate"}, {"run_skill_script"})
        self.assertNotIn("tool_search", text)
        self.assertNotIn("run_skill_script", text)

    def test_suite_with_eager_code_needs_no_discovery(self):
        text = tool_availability_guidance({"code", "terminate"})
        self.assertIn("code_interpreter -> code", text)
        self.assertNotIn("tool_search", text)

    def test_renaming_is_idempotent(self):
        for old, new in [("execute_skill_script_file", "run_skill_script"), ("code_interpreter", "code"), ("shell_interpreter", "bash")]:
            self.assertEqual(canonical_tool(old), new)
            self.assertEqual(canonical_tool(new), new)


if __name__ == "__main__":
    unittest.main()
