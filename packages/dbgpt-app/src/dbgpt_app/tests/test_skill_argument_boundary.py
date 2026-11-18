"""RUN18-03: script execution accepts structured or JSON-encoded parameters."""

import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from dbgpt.agent.expand.tool_recovery import observe_action_results
from dbgpt.agent.skill.arguments import (
    SkillArgumentsError, normalize_script_arguments,
)
from dbgpt.agent.skill.manage import SkillManager
from dbgpt.configs import model_config
from dbgpt.core.interface.report_capture import ArtifactCaptureContext, InMemoryArtifactSink
from dbgpt_app.openapi.api_v1.tools import skill_tools


class ArgumentBoundaryTest(unittest.TestCase):
    def test_single_json_encoding_is_decoded_without_changing_nested_values(self):
        original = {"input_file": "a file.csv", "nested": '{"keep":"string"}'}
        args, argv = normalize_script_arguments(json.dumps(original))
        self.assertEqual(original, args)
        self.assertIsNone(argv)
        copied, _ = normalize_script_arguments(original)
        copied["input_file"] = "changed"
        self.assertEqual("a file.csv", original["input_file"])

    def test_cli_array_preserves_spaces_and_shell_characters(self):
        values = ["path with spaces.csv", "--label", "$(literal); data"]
        self.assertEqual((None, values), normalize_script_arguments(argv=json.dumps(values)))

    def test_invalid_values_are_not_silently_coerced(self):
        for invalid in ("not-json", '"still a string"', "[]", "null", 42, []):
            with self.subTest(invalid=invalid), self.assertRaises(SkillArgumentsError):
                normalize_script_arguments(invalid)
        for invalid in ("--input file.csv", [1], {"x": "y"}):
            with self.subTest(invalid=invalid), self.assertRaises(SkillArgumentsError):
                normalize_script_arguments(argv=invalid)

    def test_repeated_argument_errors_produce_advisory_recovery(self):
        state = {}
        calls = [{"function": {"name": "run_skill_script", "arguments": '{"args":[]}'}}]
        results = json.dumps([{"success": False, "content": json.dumps({
            "success": False, "error_code": "SKILL_ARGUMENTS_INVALID",
        })}])
        self.assertEqual([], observe_action_results(state, calls, results, False))
        self.assertEqual("RECOVERY_SUGGESTED", observe_action_results(state, calls, results, False)[0]["status"])
        observe_action_results(state, calls, json.dumps([{"success": True}]), True)
        self.assertNotIn("run_skill_script", state["_tool_recovery"])


class ScriptBoundaryTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.skill = self.root / "skills/boundary-fixture"
        (self.skill / "scripts").mkdir(parents=True)
        (self.skill / "scripts/read.py").write_text(
            "import json,sys\nfrom pathlib import Path\n"
            "def main():\n"
            "    args=json.loads(sys.argv[1])\n"
            "    text=Path(args['input_file']).read_text()\n"
            "    Path('report.html').write_text('<html><body>'+text+'</body></html>')\n"
            "    print(json.dumps({'rows':len(text.splitlines())-1}))\n"
            "if __name__ == '__main__': main()\n", encoding="utf-8"
        )
        self.input = self.root / "sales fixture.csv"
        self.input.write_text("source,sessions\nfacebook,360\ntiktok,300\n", encoding="utf-8")
        for name, value in (("SKILLS_DIR", str(self.skill.parent)), ("PILOT_PATH", str(self.root / "pilot"))):
            p = patch.object(model_config, name, value)
            p.start()
            self.addCleanup(p.stop)
        self.manager = SkillManager(None)
        p = patch("dbgpt.agent.skill.manage.get_skill_manager", return_value=self.manager)
        p.start()
        self.addCleanup(p.stop)
        self.sink = InMemoryArtifactSink(ArtifactCaptureContext(conv_uid="run18-03"))
        self.state = {"conv_id": "run18-03", "file_path": str(self.input), "_report_artifact_sink": self.sink}

    async def test_unified_json_string_runs_script_and_captures_real_html(self):
        run = skill_tools.make_run_skill_script(self.state)
        result = json.loads(await run(
            "boundary-fixture", "read.py", args=json.dumps({"input_file": "placeholder.csv"})
        ))
        self.assertIsNot(result.get("success"), False, result)
        artifact = next(a for a in self.sink.snapshot() if a.artifact_id == result["artifact_id"])
        self.assertEqual("succeeded", artifact.status)
        reports = list((self.root / "pilot").rglob("report.html"))
        self.assertEqual(1, len(reports))
        self.assertIn("facebook,360", reports[0].read_text())
        self.assertEqual(str(self.input), self.state["file_path"])

    async def test_legacy_and_manager_paths_also_accept_json_strings(self):
        original = {"input_file": str(self.input)}
        result = json.loads(await skill_tools.make_execute_skill_script_file(self.state)(
            "boundary-fixture", "read.py", args=json.dumps(original)
        ))
        self.assertIsNot(result.get("success"), False, result)
        direct = json.loads(await self.manager.execute_skill_script_file(
            "boundary-fixture", "read.py", args=json.dumps(original), output_dir=str(self.root / "direct")
        ))
        self.assertIsNot(direct.get("success"), False, direct)

    async def test_cli_execution_keeps_argument_boundaries(self):
        (self.skill / "scripts/cli.py").write_text(
            "import json,sys\nprint(json.dumps({'argv':sys.argv[1:]}))\n",
            encoding="utf-8",
        )
        values = ["--label", "a value with spaces; $(literal)"]
        result = json.loads(await skill_tools.make_run_skill_script(self.state)(
            "boundary-fixture", "cli.py", argv=json.dumps(values)
        ))
        self.assertIsNot(result.get("success"), False, result)
        artifact = next(a for a in self.sink.snapshot() if a.artifact_id == result["artifact_id"])
        self.assertEqual({"argv": values}, artifact.metadata["arguments"])

    async def test_invalid_args_and_mixed_modes_return_repairable_failure(self):
        for kwargs in ({"args": []}, {"args": "broken"}, {"args": {}, "argv": []}):
            with self.subTest(kwargs=kwargs), patch.object(self.manager, "execute_skill_script_file", new=AsyncMock()) as execute:
                result = json.loads(await skill_tools.make_run_skill_script(self.state)(
                    "boundary-fixture", "read.py", **kwargs
                ))
                self.assertFalse(result["success"])
                self.assertEqual("SKILL_ARGUMENTS_INVALID", result["error_code"])
                self.assertIn("args OR argv", result["recovery_hint"])
                execute.assert_not_called()

    async def test_real_csv_analyzer_accepts_trace_argument_shape(self):
        repository = next(parent for parent in Path(__file__).resolve().parents if (parent / "skills/csv-data-analysis").is_dir())
        shutil.copytree(repository / "skills/csv-data-analysis", self.skill.parent / "csv-data-analysis")
        result = json.loads(await skill_tools.make_run_skill_script(self.state)(
            "csv-data-analysis", "csv_analyzer.py", args=json.dumps({"input_file": str(self.input)})
        ))
        self.assertIsNot(result.get("success"), False, result)
        self.assertTrue(result["artifact_id"])
        self.assertTrue(self.state.get("auto_data"))


if __name__ == "__main__":
    unittest.main()
