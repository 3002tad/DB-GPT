"""E2E-04: do not publish assets as skills or re-seed the retired example."""

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from dbgpt.agent.skill.loader import SkillLoader
from dbgpt_app.initialization import skills_provisioning


class SkillCatalogTest(unittest.TestCase):
    def test_reference_assets_and_blank_names_are_not_skills(self):
        loader = SkillLoader()
        for asset in ({}, [], {"type": "object"}, {"metadata": {}},
                      {"metadata": {"name": " "}}):
            with self.subTest(asset=asset):
                self.assertIsNone(loader._create_skill_from_dict(asset))

    def test_named_custom_skill_is_preserved(self):
        skill = SkillLoader()._create_skill_from_dict({
            "metadata": {"name": "custom-analysis", "description": "Custom workflow"},
            "config": {},
        })
        self.assertEqual(skill.metadata.name, "custom-analysis")

    def test_recursive_loader_ignores_json_reference_but_keeps_real_skill(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "reference.json").write_text('{"type": "object"}')
            (root / "skill.json").write_text('{"metadata": {"name": "test-analysis"}}')
            self.assertEqual(
                [s.metadata.name for s in SkillLoader().load_skills_from_directory(folder)],
                ["test-analysis"],
            )

    def test_retirement_is_idempotent_and_does_not_touch_other_skills(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            destination, bundle = root / "runtime", root / "bundle"
            retired = "walmart-sales-analyzer"
            for parent, name in ((destination, retired), (bundle, retired),
                                 (bundle, "business-report"), (destination, "user")):
                path = parent / name
                path.mkdir(parents=True)
                (path / "SKILL.md").write_text("preserved")
            with patch.object(skills_provisioning, "bundled_resource_dir", return_value=str(bundle)):
                skills_provisioning.ensure_builtin_skills(str(destination))
                skills_provisioning.ensure_builtin_skills(str(destination))
            self.assertFalse((destination / retired).exists())
            self.assertTrue((destination / "business-report/SKILL.md").exists())
            self.assertEqual((destination / "user/SKILL.md").read_text(), "preserved")

    def test_old_image_skill_is_removed_even_without_a_bundle(self):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / "walmart-sales-analyzer"
            target.mkdir()
            with patch.object(skills_provisioning, "bundled_resource_dir", return_value=None):
                skills_provisioning.ensure_builtin_skills(folder)
            self.assertFalse(target.exists())

    @unittest.skipIf(os.name == "nt", "Symlink creation requires Windows privileges")
    def test_retired_symlink_is_unlinked_without_touching_its_target(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            runtime, external = root / "runtime", root / "external"
            runtime.mkdir()
            external.mkdir()
            (external / "SKILL.md").write_text("keep")
            target = runtime / "walmart-sales-analyzer"
            target.symlink_to(external, target_is_directory=True)
            with patch.object(skills_provisioning, "bundled_resource_dir", return_value=None):
                skills_provisioning.ensure_builtin_skills(str(runtime))
            self.assertFalse(target.is_symlink())
            self.assertEqual((external / "SKILL.md").read_text(), "keep")


if __name__ == "__main__":
    unittest.main()
