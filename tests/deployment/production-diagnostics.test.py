import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "diagnostics", ROOT / "scripts/production-diagnostics.py")
diagnostics = importlib.util.module_from_spec(spec)
spec.loader.exec_module(diagnostics)


class OutputSafety(unittest.TestCase):
    def test_logs_only_emit_fixed_signatures(self):
        output = diagnostics.log_signatures(
            "SECRET_CUSTOMER_TOKEN https://private.example/query?token=secret "
            "Cannot find package 'tsx' ReferenceError: privateCustomerName")
        self.assertEqual(output["missingPackages"], ["tsx"])
        self.assertEqual(output["reference_error"], 1)
        self.assertNotIn("SECRET", str(output))
        self.assertNotIn("privateCustomerName", str(output))

    def test_status_drops_payloads_and_error_messages(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "status.json"
            path.write_text('{"status":"failed","timestamp":"2026-10-08T00:00:00Z",'
                            '"message":"private token","state":"https://private",'
                            '"rlsVerified":true,"credentials":{"key":"secret"}}')
            fields = diagnostics.status(path)["fields"]
            self.assertEqual(fields, {"status": "failed",
                                     "timestamp": "2026-10-08T00:00:00Z",
                                     "rlsVerified": True})

    def test_workflow_has_no_release_entrypoint(self):
        workflow = (ROOT / ".github/workflows/production-diagnostics.yml").read_text()
        self.assertNotIn("deploy-to-do.sh", workflow)
        self.assertNotIn("host-release.sh", workflow)
        self.assertNotIn("npm run", workflow)
        script = (ROOT / "scripts/production-diagnostics.sh").read_text()
        self.assertIn("StrictHostKeyChecking=yes", script)
        self.assertLess(script.index('bash "$ROOT/scripts/verify-ssh-host-key.sh"'),
                        script.index('KEY_FILE='))


if __name__ == "__main__":
    unittest.main()
