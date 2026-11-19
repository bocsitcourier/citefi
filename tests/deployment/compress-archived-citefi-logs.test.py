import gzip
import importlib.util
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

script = Path(__file__).resolve().parents[2] / "scripts/recovery/compress-archived-citefi-logs.py"
spec = importlib.util.spec_from_file_location("log_cleanup", script)
controller = importlib.util.module_from_spec(spec)
spec.loader.exec_module(controller)


class ArchiveContract(unittest.TestCase):
    def test_only_an_unchanged_closed_log_is_replaced_with_verified_gzip(self):
        with tempfile.TemporaryDirectory() as work:
            path = Path(work) / "old-worker.log"
            text = b"historical error\n" * 4096
            path.write_bytes(text)
            path.chmod(0o640)
            earlier = time.time() - 90000
            os.utime(path, (earlier, earlier))
            fd = os.open(work, os.O_DIRECTORY)
            try:
                expected = path.stat().st_blocks * 512
                with patch.object(controller, "not_open", return_value=False):
                    self.assertIn("open by a process", controller.compress(fd, path.name, expected)["outcome"])
                self.assertEqual(path.read_bytes(), text)
                with patch.object(controller, "not_open", return_value=True), patch.object(controller, "MIN_FREE", 0):
                    self.assertEqual(controller.compress(fd, path.name, expected)["outcome"], "compressed and verified")
                self.assertFalse(path.exists())
                self.assertEqual(gzip.decompress(path.with_suffix(".log.gz").read_bytes()), text)
                self.assertEqual(path.with_suffix(".log.gz").stat().st_mode & 0o777, 0o640)
            finally:
                os.close(fd)


if __name__ == "__main__":
    unittest.main()
