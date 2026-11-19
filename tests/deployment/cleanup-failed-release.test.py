import fcntl
import hashlib
import importlib.util
import io
import os
from contextlib import redirect_stdout
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

PATH = Path(__file__).resolve().parents[2] / "scripts/recovery/cleanup-failed-7dd7fe00.py"
spec = importlib.util.spec_from_file_location("approved_cleanup", PATH)
controller = importlib.util.module_from_spec(spec)
spec.loader.exec_module(controller)


class CleanupContract(unittest.TestCase):
    def fixture(self, root):
        live = root / "releases" / controller.ACTIVE
        (live / ".next").mkdir(parents=True)
        (live / ".next/BUILD_ID").write_text("kept")
        (live / ".release-sha").write_text(controller.ACTIVE.split("-")[0])
        (root / "current").symlink_to(live)
        (root / ".deploy/incoming").mkdir(parents=True)
        (root / ".deploy/release.lock").touch()
        (root / ".deploy/release-status.json").touch()
        archive, unpack = root / controller.ARCHIVE, root / controller.UNPACK
        archive.write_bytes(b"fixture archive")
        unpack.mkdir()
        (unpack / "small-file").write_text("failed")
        os.utime(archive, ns=(controller.ARCHIVE_MTIME, controller.ARCHIVE_MTIME))
        os.utime(unpack, ns=(controller.UNPACK_MTIME, controller.UNPACK_MTIME))
        return archive, unpack, live

    def test_success_keeps_other_releases_and_backups(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive, unpack, live = self.fixture(root)
            preserved = root / ".deploy/incoming/other-incident.tar.gz"
            preserved.write_text("evidence")
            rollback = root / "releases/verified-rollback"
            rollback.mkdir()
            status = root / ".deploy/release-status.json"
            # Synthetic hash/blocks stand in for the exact production archive;
            # exercise the real deletion and compare protected paths.
            fake = type("FixtureInfo", (), {})()
            info = archive.stat()
            for key in ("dev", "ino", "uid", "mtime_ns", "size", "nlink"):
                setattr(fake, f"st_{key}", getattr(info, f"st_{key}"))
            fake.st_blocks = 773722112 // 512
            original_info = controller.information
            def safe_info(path, device, mode):
                actual = original_info(path, device, mode)
                return fake if path == archive else actual
            with patch.object(controller, "information", side_effect=safe_info), \
                    patch.object(controller, "verify_live_refs") as check, \
                    patch.object(hashlib, "file_digest") as digest, redirect_stdout(io.StringIO()):
                digest.return_value.hexdigest.return_value = controller.FAILED.split("-")[1] + "0" * 48
                controller.cleanup(root)
                check.assert_called_once_with((archive, unpack))
            self.assertFalse(archive.exists())
            self.assertFalse(unpack.exists())
            self.assertEqual(preserved.read_text(), "evidence")
            self.assertTrue(rollback.is_dir())
            self.assertEqual((root / "current").resolve(), live)
            self.assertEqual(status.stat().st_size, 0)

    def test_requires_lock_and_refuses_changed_active_release(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive, unpack, _ = self.fixture(root)
            with (root / ".deploy/release.lock").open() as lock:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                with self.assertRaises(BlockingIOError):
                    controller.cleanup(root)
            (root / "current").unlink()
            (root / "current").symlink_to(unpack)
            with self.assertRaisesRegex(RuntimeError, "Active production release differs"):
                controller.cleanup(root)
            self.assertTrue(unpack.is_dir())
            self.assertTrue(archive.is_file())

    def test_refuses_symlink_archive_and_new_status(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive, unpack, live = self.fixture(root)
            archive.unlink()
            archive.symlink_to(live / ".next/BUILD_ID")
            with self.assertRaisesRegex(RuntimeError, "Unexpected ownership, type or filesystem"):
                controller.cleanup(root)
            (root / ".deploy/release-status.json").write_text("{}")
            with self.assertRaisesRegex(RuntimeError, "Release status has changed"):
                controller.cleanup(root)
            self.assertTrue(unpack.is_dir())
            self.assertTrue(archive.is_symlink())

    def test_process_exemption_is_only_for_root_parented_ssh_transport(self):
        with tempfile.TemporaryDirectory() as directory:
            proc = Path(directory)
            parent = proc / "100"
            child = proc / "101"
            parent.mkdir()
            child.mkdir()
            (parent / "comm").write_text("sshd\n")
            (child / "comm").write_text("sshd-session\n")
            (child / "status").write_text("PPid:\t100\n")
            real_stat = Path.stat
            def fake_stat(path, **options):
                return SimpleNamespace(st_uid=0) if path == parent else real_stat(path, **options)
            with patch.object(Path, "stat", fake_stat):
                self.assertTrue(controller.is_root_parented_ssh_transport(child, proc))
                (child / "comm").write_text("node\n")
                self.assertFalse(controller.is_root_parented_ssh_transport(child, proc))
                (child / "comm").write_text("sshd-session\n")
                (parent / "comm").write_text("node\n")
                self.assertFalse(controller.is_root_parented_ssh_transport(child, proc))


if __name__ == "__main__":
    unittest.main()
