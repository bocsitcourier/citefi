"""Bounded, read-only inspection. Never emit environment values or raw logs."""
import datetime
import hashlib
import json
import os
import re
import shutil
import subprocess
import urllib.request
import urllib.error
from pathlib import Path

ROOT = Path("/var/www/citefi")
SAFE_NAMES = {"citefi-web", "citefi-worker"}
PATH_KEYS = {
    "BACKUP_STATUS_FILE", "RESTORE_VERIFICATION_STATUS_FILE",
    "DEPLOYMENT_STATUS_FILE", "BACKUP_DIR",
}
SECRET_KEYS = {"GEMINI_API_KEY", "OPENAI_API_KEY", "DATABASE_URL", "REDIS_URL"}
STATUS_KEYS = {
    "status", "state", "timestamp", "completedAt", "lastSuccessAt",
    "verifiedAt", "updatedAt", "updated_at", "schemaVerified", "rolesVerified", "rlsVerified",
}


def metadata(path):
    try:
        s = Path(path).stat()
        return {"exists": True, "bytes": s.st_size, "mode": oct(s.st_mode & 0o777),
                "uid": s.st_uid, "gid": s.st_gid,
                "readable": os.access(path, os.R_OK),
                "modifiedAt": datetime.datetime.fromtimestamp(
                    s.st_mtime, datetime.timezone.utc).isoformat()}
    except OSError as e:
        return {"exists": False, "errno": e.errno}


def log_signatures(text):
    # Fixed categories, not arbitrary provider messages/customer payloads.
    patterns = {
        "module_not_found": r"ERR_MODULE_NOT_FOUND|Cannot find module|MODULE_NOT_FOUND",
        "permission_denied": r"EACCES|Permission denied",
        "disk_full": r"ENOSPC|No space left on device",
        "model_resolution_failed": r"No valid model|model.*(?:unavailable|not found)|critical.*tier|ModelResolutionError",
        "missing_canary_owner": r"CANARY_ACCOUNTING_TEAM_ID|canary accounting",
        "redis_connection_failed": r"ECONNREFUSED|ETIMEDOUT|WRONGPASS|NOAUTH",
        "syntax_error": r"SyntaxError",
        "reference_error": r"ReferenceError",
        "type_error": r"TypeError",
        "worker_started": r"Worker.*(?:started|ready)|workers registered",
        "heartbeat_failed": r"worker-heartbeat.*failed",
        "model_validation": r"model-resolver|model validation",
        "fatal_exit": r"FATAL|Unhandled|uncaught|exited unexpectedly",
        "dump_version_mismatch": r"server version mismatch|aborting because of server version",
    }
    result = {k: len(re.findall(p, text, re.I)) for k, p in patterns.items()}
    # Report only package identifiers from Node's standard missing-package error.
    result["missingPackages"] = sorted(set(re.findall(
        r"Cannot find package '([a-zA-Z0-9@/_.-]{1,100})'", text)))
    return result


def tail(path):
    try:
        with open(path, "rb") as f:
            f.seek(max(0, os.fstat(f.fileno()).st_size - 32768))
            return log_signatures(f.read().decode("utf8", errors="replace"))
    except OSError as e:
        return {"errno": e.errno}


def status(path):
    result = metadata(path)
    if result.get("readable") and result.get("bytes", 0) < 16384:
        try:
            value = json.loads(Path(path).read_text())
            # Only enums/timestamps/booleans; never error text or nested payloads.
            result["fields"] = {
                k: v for k, v in value.items() if k in STATUS_KEYS and
                (isinstance(v, bool) or (isinstance(v, str) and re.fullmatch(
                    r"(?:[a-z_]{1,32}|[0-9TZ:+. -]{1,40})", v)))
            }
        except (ValueError, OSError, AttributeError):
            result["invalid"] = True
    return result


def main():
    report = {"utc": datetime.datetime.now(datetime.timezone.utc).isoformat()}
    disk = os.statvfs(ROOT)
    report["disk"] = {"freeBytes": disk.f_bavail * disk.f_frsize,
                      "freeInodes": disk.f_favail, "totalInodes": disk.f_files}
    report["current"] = {"target": str((ROOT / "current").resolve()),
                         **metadata(ROOT / "current")}
    # Compare the actual local listener with the public health report.
    try:
        try:
            response = urllib.request.urlopen(
                "http://127.0.0.1:5000/api/health", timeout=20)
        except urllib.error.HTTPError as e:
            response = e
        with response:
            body = json.loads(response.read(65536))
            report["localHealth"] = {
                "httpCode": response.code,
                "status": body.get("status"),
                "services": {
                    k: {field: v[field] for field in
                        ["ok", "ready", "status", "state", "lastHeartbeatAt"]
                        if field in v and (v[field] is None or
                                           isinstance(v[field], (bool, int)) or
                                           (isinstance(v[field], str) and
                                            re.fullmatch(r"[a-z0-9TZ:+._ -]{1,80}", v[field])))}
                    for k, v in body.get("services", {}).items()
                    if isinstance(v, dict)
                },
            }
    except (OSError, ValueError):
        report["localHealth"] = "local listener probe failed"
    # pm2 jlist can launch a daemon: refuse unless the existing daemon is alive.
    pidfile = Path.home() / ".pm2/pm2.pid"
    processes = []
    try:
        os.kill(int(pidfile.read_text().strip()), 0)
        raw = subprocess.run(["pm2", "jlist"], capture_output=True, text=True,
                             timeout=12, check=True)
        processes = json.loads(raw.stdout)
    except (OSError, ValueError, subprocess.SubprocessError):
        report["pm2"] = "existing daemon unavailable; no daemon started"
    report["processes"] = []
    for proc in processes:
        if proc.get("name") not in SAFE_NAMES:
            continue
        env = proc.get("pm2_env", {})
        cwd = env.get("pm_cwd", "")
        item = {"name": proc["name"], "pid": proc.get("pid"),
                "status": env.get("status"), "restarts": env.get("restart_time"),
                "uptimeEpochMs": env.get("pm_uptime"), "cwd": cwd,
                "script": env.get("pm_exec_path"),
                "credentialPresence": {k: bool(env.get(k)) for k in SECRET_KEYS},
                "statusPaths": {k: env[k] for k in PATH_KEYS if
                                isinstance(env.get(k), str) and
                                re.fullmatch(r"/[a-zA-Z0-9/_.-]+", env[k])}}
        for kind in ["out", "err"]:
            path = env.get("pm_" + kind + "_log_path")
            if path:
                item[kind + "Log"] = {"file": metadata(path), "signatures": tail(path)}
        if cwd:
            item["sourceMarkers"] = {}
            for relative, markers in {
                "server/worker-process.ts": ["startWorkerHeartbeat", "beginWorkerReadiness", "resolveModels"],
                "app/api/health/route.ts": ["readWorkerReadiness", "model-resolver", "BACKUP_STATUS_FILE"],
                "scripts/db-backup.sh": ["STATUS_FILE", "write_status", "pg_dump"],
                ".next/server/app/api/health/route.js": [
                    "ops:worker:heartbeat", "ops:worker:readiness",
                    "Model resolver has not run", "model-resolver",
                    "/var/backups/citefi-db",
                ],
            }.items():
                path = Path(cwd) / relative
                try:
                    text = path.read_text()
                    item["sourceMarkers"][relative] = {
                        "sha256": hashlib.sha256(text.encode()).hexdigest(),
                        **{m: m in text for m in markers}}
                    if relative == "scripts/db-backup.sh":
                        item["legacyBackupPaths"] = sorted(set(re.findall(
                            r"/var/backups/[a-zA-Z0-9/_.-]+", text)))
                except OSError as e:
                    item["sourceMarkers"][relative] = {"errno": e.errno}
            item["build"] = metadata(Path(cwd) / ".next/BUILD_ID")
            bundle_markers = ["ops:worker:heartbeat", "ops:worker:readiness",
                              "Model resolver has not run", "Configured status file is missing"]
            item["bundledHealthMarkers"] = {m: False for m in bundle_markers}
            remaining = 40 * 1024 * 1024
            for chunk in sorted((Path(cwd) / ".next/server/chunks").glob("*.js")):
                size = chunk.stat().st_size
                if size > remaining:
                    continue
                remaining -= size
                text = chunk.read_text(errors="replace")
                for marker in bundle_markers:
                    item["bundledHealthMarkers"][marker] |= marker in text
            item["bundleScanBudgetExhausted"] = remaining == 0
            try:
                revision = subprocess.run(
                    ["git", "-C", cwd, "rev-parse", "HEAD"],
                    capture_output=True, text=True, timeout=5, check=True).stdout.strip()
                if re.fullmatch(r"[0-9a-f]{40}", revision):
                    item["sourceRevision"] = revision
            except (OSError, subprocess.SubprocessError):
                pass
        report["processes"].append(item)
    files = [
        "/var/backups/citefi-db/status.json",
        "/var/backups/citefi-db/restore-verification-status.json",
        "/var/www/citefi/.deploy/release-status.json",
    ]
    for proc in report["processes"]:
        files.extend(proc["statusPaths"].values())
    report["statusFiles"] = {p: status(p) for p in sorted(set(files))}
    report["backupDirectory"] = metadata("/var/backups/citefi-db")
    try:
        entries = list(Path("/var/backups/citefi-db").iterdir())
        report["backupArtifacts"] = [
            {"format": ".sql.gz" if p.name.endswith(".sql.gz") else ".dump",
             **metadata(p)} for p in sorted(entries, key=lambda p: p.name)[-40:]
            if p.name.endswith((".sql.gz", ".dump"))]
    except OSError as e:
        report["backupArtifacts"] = {"errno": e.errno}
    for path in ["/etc/cron.d/citefi-db-backup", "/usr/local/bin/citefi-db-backup.sh"]:
        item = metadata(path)
        try:
            text = Path(path).read_text()
            item["markers"] = {m: m in text for m in
                               ["status.json", "STATUS_FILE", "pg_dump", "citefi-db-backup.sh"]}
        except OSError:
            pass
        report[path] = item
    report["backupLog"] = tail("/var/log/citefi-db-backup.log")
    report["recoveryTools"] = {
        name: bool(shutil.which(name))
        for name in ["node", "pg_dump", "psql", "aws", "crontab", "flock", "rsync"]
    }
    # Catalog-only queries against the host's effective environment. The code
    # returns booleans/counts only; connection strings and provider keys stay
    # inside Node. Refuse a different database target before proceeding.
    catalog_probe = r"""
const { Client } = await import('pg');
const db = new Client({connectionString:process.env.DATABASE_URL, connectionTimeoutMillis:5000});
try {
  await db.connect();
  await db.query('BEGIN READ ONLY');
  await db.query("SET LOCAL statement_timeout = '5s'");
  const {rows:[identity]} = await db.query("SELECT current_database() = 'citefi' AS expected_database, current_setting('server_version_num')::int AS server_version");
  if (!identity.expected_database) throw Object.assign(new Error(), {code:'UNEXPECTED_TARGET'});
  const {rows:[controls]} = await db.query(`SELECT
    EXISTS (SELECT 1 FROM pg_roles WHERE rolname='citefi_tenant' AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcanlogin AND NOT rolcreaterole AND NOT rolcreatedb) AS tenant_role_safe,
    EXISTS (SELECT 1 FROM pg_roles WHERE rolname=current_user AND rolcreaterole) AS current_role_can_create_roles,
    (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON c.relnamespace=n.oid WHERE n.nspname='public' AND c.relrowsecurity) AS rls_tables,
    (SELECT count(*)::int FROM pg_policies WHERE schemaname='public' AND 'citefi_tenant'=ANY(roles)) AS tenant_policies,
    (SELECT count(*)::int FROM information_schema.role_table_grants WHERE grantee='citefi_tenant') AS tenant_grants`);
  // Names identify candidates only, not proof of system ownership. Do not
  // disclose names, emails, billing identifiers, or arbitrary customer rows.
  const {rows:canaryOwnerCandidates} = await db.query(`SELECT t.id,
    (t.name ~* '(^|[^a-z])(canary|synthetic|system|internal)([^a-z]|$)') AS system_name_candidate,
    (to_jsonb(t)->>'deleted_at' IS NOT NULL) AS deleted,
    (NULLIF(to_jsonb(t)->>'stripe_customer_id','') IS NOT NULL
      OR NULLIF(to_jsonb(t)->>'stripe_subscription_id','') IS NOT NULL) AS has_billing,
    (u.role = 'admin') AS creator_is_platform_admin,
    (SELECT count(*)::int FROM team_members m WHERE m.team_id=t.id) AS member_count,
    (SELECT count(*)::int FROM team_members m JOIN users mu ON mu.id=m.user_id
      WHERE m.team_id=t.id AND mu.role IS DISTINCT FROM 'admin') AS non_admin_member_count
    FROM teams t JOIN users u ON u.id=t.created_by
    WHERE t.name ~* '(^|[^a-z])(canary|synthetic|system|internal)([^a-z]|$)'
    ORDER BY t.id LIMIT 20`);
  await db.query('ROLLBACK');
  console.log(JSON.stringify({identity,controls,canaryOwnerCandidates,environmentPresence:Object.fromEntries(
    ['DO_SPACES_KEY','DO_SPACES_SECRET','DO_SPACES_ENDPOINT','DO_SPACES_BUCKET',
     'BACKUP_STATUS_FILE','RESTORE_VERIFICATION_STATUS_FILE','RESTORE_VERIFY_DATABASE_URL',
     'CANARY_ACCOUNTING_TEAM_ID'].map(k=>[k,Boolean(process.env[k])]))}));
} catch(e) { console.log(JSON.stringify({errorCode:/^[A-Z0-9_]{1,40}$/.test(e.code??'')?e.code:'PROBE_FAILED'})); process.exitCode=1; }
finally {await db.end();}
"""
    try:
        probe = subprocess.run(
            ["node", "--env-file=/var/www/citefi/.env.local",
             "--input-type=module", "-"],
            input=catalog_probe, cwd=ROOT, capture_output=True, text=True,
            timeout=25)
        report["databaseRecoveryPreflight"] = json.loads(probe.stdout)
    except (OSError, ValueError, subprocess.SubprocessError):
        report["databaseRecoveryPreflight"] = "catalog probe unavailable"
    report["legacyBackupLocations"] = {}
    for proc in report["processes"]:
        for path in proc.get("legacyBackupPaths", []):
            report["legacyBackupLocations"][path] = metadata(path)
    # Count matching schedules, never return crontab contents or credentials.
    try:
        cron = subprocess.run(["crontab", "-l"], capture_output=True, text=True,
                              timeout=5)
        report["userBackupSchedules"] = sum(
            1 for line in cron.stdout.splitlines()
            if not line.lstrip().startswith("#") and
            ("db-backup" in line or "pg_dump" in line))
    except (OSError, subprocess.SubprocessError):
        report["userBackupSchedules"] = "unavailable"
    try:
        report["systemBackupScheduleFiles"] = [
            p.name for p in Path("/etc/cron.d").iterdir()
            if re.fullmatch(r"[a-zA-Z0-9_.-]{1,80}", p.name) and
            ("citefi" in p.name or "backup" in p.name)]
    except OSError:
        report["systemBackupScheduleFiles"] = "unavailable"
    print(json.dumps(report, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
