import importlib.util
import json
from pathlib import Path
import unittest

path = Path(__file__).resolve().parents[2] / "scripts/recovery/digitalocean-disk-breakdown.py"
spec = importlib.util.spec_from_file_location("breakdown", path)
breakdown = importlib.util.module_from_spec(spec)
spec.loader.exec_module(breakdown)


class BreakdownTest(unittest.TestCase):
    def test_reports_only_fixed_categories_and_no_release_names(self):
        base = "/var/www/citefi"
        active = f"{base}/releases/active-fixture"
        source = "\n".join([
            "9000000\t/",
            f"2000000\t{base}",
            f"1000000\t{base}/releases",
            f"800000\t{active}",
            f"150000\t{base}/releases/rollback-private",
            f"50000\t{base}/releases/.unpack-failed-private",
            f"20000\t{base}/releases/rollback-private/customer-fixture",
            "200000\t/var/log",
            "4000\t/private-name",
        ])
        result = breakdown.report_usage(source, active)
        self.assertEqual(result["namedRootFilesystemBytes"], 9000000)
        self.assertEqual(result["groups"]["host logs"], 200000)
        self.assertEqual(result["activeReleaseBytes"], 800000)
        self.assertEqual(result["otherReleaseDirectories"], {"count": 1, "bytes": 150000})
        self.assertEqual(result["partialExtractions"], {"count": 1, "bytes": 50000})
        self.assertNotIn("private", json.dumps(result))
        self.assertNotIn("customer", json.dumps(result))


if __name__ == "__main__":
    unittest.main()
