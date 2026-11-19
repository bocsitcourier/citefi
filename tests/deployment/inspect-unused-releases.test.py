import importlib.util
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

script = Path(__file__).resolve().parents[2] / "scripts/recovery/inspect-unused-releases.py"
spec = importlib.util.spec_from_file_location("release_inventory", script)
inventory = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inventory)


class RetainedDependencies(unittest.TestCase):
    def test_versioned_evidence_exception_rejects_new_files(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            p = root / "evidence"
            p.mkdir()
            (p / "original.txt").write_text("versioned content")
            device = p.stat().st_dev
            digest = inventory.git_tree(p, device).hex()
            with patch.object(inventory, "FROZEN_SOURCE", {root.name: {"evidence": digest}}):
                self.assertTrue(inventory.matching_source(root, Path("evidence"), device))
                (p / "new-production-proof.txt").write_text("unversioned content")
                self.assertFalse(inventory.matching_source(root, Path("evidence"), device))

    def test_refuses_changed_plan_and_protected_release(self):
        report = {"digest": "preview", "releases": [
            {"environment": "production", "release": "current", "keepReasons": ["current build"],
             "buildIdentityOk": True, "allocatedBytes": 20},
            {"environment": "production", "release": "unused", "keepReasons": [],
             "buildIdentityOk": True, "allocatedBytes": 20},
        ]}
        for digest, selection in (("old", ["production/unused"]), ("preview", ["production/current"]),
                                  ("preview", ["production/unused", "production/unused"])):
            with self.assertRaises(ValueError):
                inventory.choose_removals(report, digest, selection)
        self.assertEqual(inventory.choose_removals(report, "preview", ["production/unused"]), report["releases"][1:])

    def test_keeps_intermediate_link_owners(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            a, b, c = (root / name for name in ("a", "b", "c"))
            for p in (a, b, c):
                p.mkdir()
            (a / "node_modules").symlink_to("../b/node_modules")
            (b / "node_modules").symlink_to(c)
            self.assertEqual(inventory.anchors(a / "node_modules/bin/next", {a, b, c}), {a, b, c})
            self.assertEqual(inventory.protected_closure({a}, {a: {b}, b: {c}}), {a, b, c})

    def test_release_build_identity_does_not_accept_linked_build(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp) / ("e" * 40 + "-" + "b" * 16)
            root.mkdir()
            (root / ".release-sha").write_text("e" * 40)
            (root / ".next").mkdir()
            build = root / ".next/BUILD_ID"
            build.write_text("verified-build")
            self.assertTrue(inventory.build_identity(root))
            build.rename(build.with_suffix(".target"))
            build.symlink_to(build.with_suffix(".target"))
            self.assertFalse(inventory.build_identity(root))


if __name__ == "__main__":
    unittest.main()
