import importlib.util
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

script = Path(__file__).resolve().parents[2] / "scripts/recovery/inspect-unused-releases.py"
spec = importlib.util.spec_from_file_location("release_inventory", script)
inventory = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inventory)


class RetainedDependencies(unittest.TestCase):
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
