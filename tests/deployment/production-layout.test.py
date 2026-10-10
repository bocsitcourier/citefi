import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "production_layout", SOURCE / "scripts/recovery/production-layout.py")
layout = importlib.util.module_from_spec(spec)
spec.loader.exec_module(layout)


class ProductionLayoutTests(unittest.TestCase):
    def fixture(self, root):
        subprocess.run(["git", "init", "-q", str(root)], check=True)
        subprocess.run(["git", "-C", str(root), "-c", "user.name=Fixture",
                        "-c", "user.email=fixture@example.invalid", "commit",
                        "--allow-empty", "-q", "-m", "Fixture"], check=True)
        for name, text in {
            ".next/BUILD_ID": "fixture-build",
            ".next/routes-manifest.json": "{}",
            ".next/server/app-paths-manifest.json": "{}",
            "node_modules/next/package.json": "{}",
            "ecosystem.config.cjs": "module.exports={apps:[]};",
            ".env.local": "JWT_SECRET=fixture-not-a-real-secret",
            ".deploy/incoming/preserve.tar.gz": "retained-evidence",
        }.items():
            file = root / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text(text)

    def test_preserves_build_and_links_shared_configuration_without_copying_secrets(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.fixture(root)
            report = layout.prepare(root)
            release = Path(report["release"])
            self.assertEqual((release / ".next/BUILD_ID").read_text(), "fixture-build")
            self.assertTrue((release / ".env.local").is_symlink())
            self.assertEqual((release / ".env.local").resolve(), root / ".env.local")
            self.assertFalse((release / ".git").exists())
            self.assertFalse((release / ".deploy").exists())
            self.assertEqual((root / ".deploy/incoming/preserve.tar.gz").read_text(), "retained-evidence")
            self.assertFalse(report["processesReloaded"])
            self.assertFalse(report["migrationsRun"])
            self.assertEqual(layout.prepare(root)["state"], "already_prepared")

    def test_rejects_existing_real_current_directory_without_removing_it(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.fixture(root)
            (root / "current").mkdir()
            (root / "current/keep").write_text("preserve")
            with self.assertRaises(RuntimeError):
                layout.prepare(root)
            self.assertEqual((root / "current/keep").read_text(), "preserve")

    def test_incomplete_build_and_escaping_links_fail_before_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.fixture(root)
            (root / "node_modules/escape").symlink_to("/etc")
            with self.assertRaises(RuntimeError):
                layout.prepare(root)
            self.assertFalse((root / "current").exists())
            self.assertFalse(any((root / "releases").iterdir()))
            (root / "node_modules/escape").unlink()
            (root / ".next/routes-manifest.json").unlink()
            with self.assertRaises(RuntimeError):
                layout.prepare(root)

    def test_inspection_does_not_create_paths_or_disclose_configuration(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.fixture(root)
            before = set(root.rglob("*"))
            report = json.dumps(layout.inspect(root))
            self.assertNotIn("fixture-not-a-real-secret", report)
            self.assertEqual(before, set(root.rglob("*")))
            self.assertFalse((root / "releases").exists())

    def test_saves_only_after_exact_release_and_process_health_are_verified(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.fixture(root)
            receipt = layout.prepare(root)
            release = Path(receipt["release"])
            (root / ".deploy/release-status.json").write_text(json.dumps({
                "status": "succeeded", "knownGoodSha": receipt["sourceSha"],
                "activeRelease": str(release)}))
            rows = [{"name": name, "pm2_env": {
                "status": "online", "pm_exec_path": str(root / "current/scripts/process-bootstrap.ts"),
                "pm_cwd": str(root / "current")}} for name in ["citefi-web", "citefi-worker"]]
            with patch.object(layout.subprocess, "check_output", return_value=json.dumps(rows)), \
                    patch.object(layout.subprocess, "run") as run, \
                    patch.object(layout.urllib.request, "urlopen", return_value=io.BytesIO(b'{"ok":true}')):
                self.assertEqual(layout.finalize(root)["state"], "verified_process_configuration_saved")
                run.assert_called_once_with(["pm2", "save"], check=True, capture_output=True)
            rows[0]["pm2_env"]["pm_exec_path"] = str(root / "legacy-next.js")
            with patch.object(layout.subprocess, "check_output", return_value=json.dumps(rows)), \
                    patch.object(layout.subprocess, "run") as run:
                with self.assertRaises(RuntimeError):
                    layout.finalize(root)
                run.assert_not_called()
            (root / ".deploy/release-status.json").write_text('{"status":"deploying"}')
            with patch.object(layout.subprocess, "run") as run:
                with self.assertRaises(RuntimeError):
                    layout.finalize(root)
                run.assert_not_called()


if __name__ == "__main__":
    unittest.main()
