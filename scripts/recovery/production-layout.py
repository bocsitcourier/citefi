#!/usr/bin/env python3
"""Preserve the legacy build; never install, migrate, reload, or delete it."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone

ROOT = Path("/var/www/citefi")


def source_sha(root):
    receipt = root / ".release-sha"
    value = receipt.read_text().strip() if receipt.is_file() else subprocess.check_output(
        ["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip()
    if not re.fullmatch(r"[a-f0-9]{40}", value):
        raise RuntimeError("Invalid source identity")
    return value


def build_identity(root):
    required = [".next/BUILD_ID", ".next/routes-manifest.json",
                ".next/server/app-paths-manifest.json", "node_modules/next/package.json",
                "ecosystem.config.cjs"]
    for name in required:
        file = root / name
        if not file.is_file() or file.stat().st_size == 0:
            raise RuntimeError(f"Legacy artifact is incomplete: {name}")
    build = (root / ".next/BUILD_ID").read_text().strip()
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", build):
        raise RuntimeError("Invalid legacy build identity")
    return {"sourceSha": source_sha(root), "buildId": build}


def inspect(root):
    result = {"root": str(root), "currentIsSymlink": (root / "current").is_symlink(),
              "sharedEnvironmentPresent": (root / ".env.local").is_file()}
    try:
        result["legacyArtifact"] = build_identity(root)
    except (RuntimeError, subprocess.CalledProcessError):
        result["legacyArtifact"] = {"complete": False}
    result["recoveryFiles"] = {
        name: (root / "ops-recovery" / relative).is_file()
        for name, relative in {
            "configuration": "recovery.env",
            "backupStatus": "backups/status.json",
            "restoreVerification": "backups/restore-verification-status.json",
        }.items()
    }
    # Environment values and PM2 environments are deliberately never reported.
    if (root / ".env.local").is_file():
        names = set(re.findall(r"^\s*(?:export\s+)?([A-Z_][A-Z_0-9]*)\s*=",
                               (root / ".env.local").read_text(), re.M))
        result["configuredRuntimeKeys"] = {
            key: key in names for key in
            ["JWT_SECRET", "CANARY_ACCOUNTING_TEAM_ID", "BACKUP_STATUS_FILE",
             "RESTORE_VERIFICATION_STATUS_FILE", "GEMINI_API_KEY", "OPENAI_API_KEY"]
        }
    return result


def prepare(root):
    if root.stat().st_uid != os.getuid():
        raise RuntimeError("Service account does not own the application root")
    for path in [root / ".deploy", root / "releases"]:
        if path.exists() and (path.is_symlink() or path.stat().st_uid != os.getuid()):
            raise RuntimeError("Release control paths must be owned real directories")
    if not (root / ".env.local").is_file():
        raise RuntimeError("Shared environment is missing")
    identity = build_identity(root)
    releases = root / "releases"
    releases.mkdir(exist_ok=True)
    current = root / "current"
    if current.is_symlink():
        target = current.resolve(strict=True)
        if target.parent != releases or build_identity(target)["buildId"] != identity["buildId"]:
            raise RuntimeError("Existing current link needs separate inspection")
        return {"state": "already_prepared", "release": str(target), **identity}
    if current.exists():
        raise RuntimeError("Refusing to replace an existing non-symlink current path")
    sha = identity["sourceSha"]
    target = releases / f"bootstrap-{sha}"
    pending = releases / f".prepare-bootstrap-{sha}"
    next_link = root / "current.next"
    if target.exists() or pending.exists() or next_link.exists() or next_link.is_symlink():
        raise RuntimeError("A previous preparation exists; preserve it for inspection")

    def ignore(directory, names):
        excluded = {name for name in names if name.startswith(".env")}
        if Path(directory) == root:
            excluded.update({".git", ".deploy", "releases", "current", "current.next",
                             "ops-recovery", ".backup"})
        return excluded

    # Refuse escaping dependency/source links before creating a snapshot.
    size = 0
    for directory, dirs, files in os.walk(root, followlinks=False):
        skipped = ignore(directory, dirs + files)
        dirs[:] = [name for name in dirs if name not in skipped]
        for name in dirs + [name for name in files if name not in skipped]:
            file = Path(directory) / name
            if file.is_symlink():
                if not file.resolve().is_relative_to(root):
                    raise RuntimeError("Source contains an escaping symlink")
            elif file.is_file():
                size += file.stat().st_size
    if shutil.disk_usage(root).free < size + 512 * 1024 * 1024:
        raise RuntimeError("Insufficient disk space to preserve the existing build")
    shutil.copytree(root, pending, symlinks=True, ignore=ignore)
    if (pending / ".next/BUILD_ID").read_text().strip() != identity["buildId"]:
        raise RuntimeError("Preserved build identity does not match")
    if build_identity(root) != identity:
        raise RuntimeError("Legacy source or build changed during preparation")
    for name in [".next/routes-manifest.json", ".next/server/app-paths-manifest.json",
                 "node_modules/next/package.json", "ecosystem.config.cjs"]:
        if hashlib.sha256((root / name).read_bytes()).digest() != hashlib.sha256(
                (pending / name).read_bytes()).digest():
            raise RuntimeError("Preserved artifact manifest does not match")
    (pending / ".env.local").symlink_to(root / ".env.local")
    (pending / ".release-sha").write_text(sha + "\n")
    (pending / ".release-build-id").write_text(identity["buildId"] + "\n")
    receipt = {"state": "preserved_legacy_artifact", **identity,
               "preparedAt": datetime.now(timezone.utc).isoformat(),
               "processesReloaded": False, "migrationsRun": False}
    (pending / ".bootstrap-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    pending.rename(target)
    next_link.symlink_to(target.relative_to(root))
    os.replace(next_link, current)
    return {**receipt, "release": str(target), "current": str(current.resolve())}


def finalize(root):
    current = root / "current"
    if not current.is_symlink():
        raise RuntimeError("No immutable release is active")
    release = current.resolve(strict=True)
    if release.parent != root / "releases":
        raise RuntimeError("Active release is outside the release store")
    sha = source_sha(release)
    status = json.loads((root / ".deploy/release-status.json").read_text())
    if (status.get("status") != "succeeded" or status.get("knownGoodSha") != sha
            or status.get("activeRelease") != str(release)):
        raise RuntimeError("Release has not passed the activation gates")
    rows = json.loads(subprocess.check_output(["pm2", "jlist"], text=True))
    wanted = {"citefi-web", "citefi-worker"}
    selected = [row for row in rows if row.get("name") in wanted]
    if len(selected) != 2 or {row["name"] for row in selected} != wanted:
        raise RuntimeError("Expected exactly the two named production processes")
    for row in selected:
        environment = row.get("pm2_env", {})
        if (environment.get("status") != "online"
                or Path(environment.get("pm_exec_path", "")).resolve()
                != release / "scripts/process-bootstrap.ts"
                or Path(environment.get("pm_cwd", "")).resolve() != release):
            raise RuntimeError("Production process is not using the active bootstrap")
    with urllib.request.urlopen("http://127.0.0.1:5000/api/health?full=1", timeout=20) as response:
        if json.load(response).get("ok") is not True:
            raise RuntimeError("Full production health is not ready")
    subprocess.run(["pm2", "save"], check=True, capture_output=True)
    return {"state": "verified_process_configuration_saved", "releaseSha": sha,
            "processes": sorted(wanted), "processesReloaded": False}


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in ["inspect", "prepare", "finalize"]:
        raise RuntimeError("Only fixed inspect/prepare/finalize operations are supported")
    if pwd.getpwuid(os.getuid()).pw_name != "citefi":
        raise RuntimeError("Production layout operations require the citefi service account")
    if sys.argv[1] == "inspect":
        print(json.dumps(inspect(ROOT), indent=2))
        return
    state = ROOT / ".deploy"
    if not state.is_dir() or state.is_symlink() or state.stat().st_uid != os.getuid():
        raise RuntimeError("Owned deployment state directory is required")
    with (state / "release.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        operation = finalize if sys.argv[1] == "finalize" else prepare
        print(json.dumps(operation(ROOT), indent=2))


if __name__ == "__main__":
    try:
        main()
    except RuntimeError as error:
        # These are only fixed, deliberate preflight messages from this module.
        print(f"Production layout refused: {error}", file=sys.stderr)
        sys.exit(1)
    except Exception:
        # Do not echo filesystem/command errors that may contain configuration.
        print("Production layout operation refused or failed; legacy app was not reloaded.",
              file=sys.stderr)
        sys.exit(1)
