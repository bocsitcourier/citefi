import importlib.util
import json
import os
import re
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class RecoverySafety(unittest.TestCase):
    def test_shared_operational_env_is_app_root_scoped(self):
        with tempfile.TemporaryDirectory() as directory:
            production = Path(directory) / "production"
            staging = Path(directory) / "staging"
            (production / "ops-recovery").mkdir(parents=True)
            (production / "ops-recovery/recovery.env").write_text("CANARY_ACCOUNTING_TEAM_ID=1025\n")
            script = "console.log(JSON.stringify(require(process.argv[1]).apps.map(a=>a.interpreter_args)))"
            for root, present in [(production, True), (staging, False)]:
                result = subprocess.run(["node", "-e", script, str(ROOT / "ecosystem.config.cjs")],
                    env={**os.environ, "DO_CURRENT_DIR": str(root / "current")},
                    capture_output=True, text=True, check=True)
                self.assertEqual("--env-file=" + str(production / "ops-recovery/recovery.env") in result.stdout, present)

    def test_bootstrap_executable_detection_uses_node_process(self):
        script = '''export HOST_RELEASE_SOURCE_ONLY=1; source "$1"
pm2() { printf '%s' '[{"name":"citefi-worker","pm2_env":{"pm_exec_path":"/test/scripts/process-bootstrap.ts"}}]'; }
process_uses_bootstrap citefi-worker
'''
        subprocess.run(["bash", "-c", script, "test", str(ROOT / "scripts/host-release.sh")], check=True)

    def test_off_host_registry_normalization_covers_both_private_origins(self):
        paths = [".github/workflows/production-recovery.yml",
                 ".github/workflows/deploy.yml", "scripts/deploy-to-do.sh"]
        expressions = [re.search(r"sed -i -E '([^']+)'", (ROOT / path).read_text()).group(1) for path in paths]
        self.assertEqual(len(set(expressions)), 1)
        inputs = "\n".join(f"{protocol}://package-firewall.replit.{host}/npm/example/-/example.tgz"
                           for protocol in ["http", "https"] for host in ["local", "internal"])
        result = subprocess.run(["sed", "-E", expressions[0]], input=inputs,
                                text=True, capture_output=True, check=True)
        self.assertEqual(result.stdout.splitlines(),
                         ["https://registry.npmjs.org/example/-/example.tgz"] * 4)

    def test_preserve_all_retains_local_backup_and_skips_prune(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            bins = root / "bin"
            bins.mkdir()
            for name, content in {
                "pg_dump": "#!/bin/sh\nprintf 'SELECT 1;\\n'\n",
                "psql": "#!/bin/sh\ncase \"$*\" in *count*) echo 3;; *) cat >/dev/null; echo 'GRANT USAGE ON SCHEMA public TO citefi_tenant;';; esac\n",
                "aws": "#!/bin/sh\nprintf '%s\\n' \"$*\" >> \"$AWS_CALLS\"\n",
            }.items():
                path = bins / name
                path.write_text(content)
                path.chmod(0o700)
            envfile = root / "fixture.env"
            envfile.write_text("DATABASE_URL=postgresql://fixture\nDO_SPACES_KEY=fixture\nDO_SPACES_SECRET=fixture\nDO_SPACES_ENDPOINT=https://fixture.invalid\nDO_SPACES_BUCKET=fixture\n")
            result = subprocess.run(["bash", str(ROOT / "scripts/db-backup.sh")], capture_output=True,
                env={**os.environ, "PATH": f"{bins}:{os.environ['PATH']}",
                     "BACKUP_ENV_FILE": str(envfile), "BACKUP_DIR": str(root / "backups"),
                     "BACKUP_PRESERVE_ALL": "true", "AWS_CALLS": str(root / "calls")})
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(len(list((root / "backups").glob("*.sql.gz"))), 1)
            self.assertEqual(json.loads((root / "backups/status.json").read_text())["state"], "success")
            calls = (root / "calls").read_text()
            self.assertIn("s3 cp", calls)
            self.assertNotIn("s3 ls", calls)
            self.assertNotIn("s3 rm", calls)

    def test_isolated_restore_refuses_non_runner_before_database_calls(self):
        spec = importlib.util.spec_from_file_location("restore", ROOT / "scripts/recovery/restore-check.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        old = os.environ.pop("GITHUB_ACTIONS", None)
        try:
            with self.assertRaisesRegex(RuntimeError, "Disposable GitHub runner"):
                module.main()
        finally:
            if old is not None:
                os.environ["GITHUB_ACTIONS"] = old

    def test_remote_operations_are_named_and_pinned(self):
        ssh = (ROOT / "scripts/recovery/ssh-session.sh").read_text()
        self.assertIn("StrictHostKeyChecking=yes", ssh)
        self.assertLess(ssh.index("verify-ssh-host-key.sh"), ssh.index("KEY_FILE="))
        prepare = (ROOT / "scripts/recovery/prepare-backup.sh").read_text()
        for forbidden in ["sudo ", "pm2 ", "db:push", "migrate", "rm -rf"]:
            self.assertNotIn(forbidden, prepare)
        provision = (ROOT / "scripts/recovery/provision.mjs").read_text()
        self.assertIn("full_team_visibility", provision)
        self.assertIn("pg_advisory_xact_lock", provision)
        self.assertNotIn("INSERT INTO team_members", provision)
        self.assertNotIn("UPDATE users", provision)


if __name__ == "__main__":
    unittest.main()
