#!/usr/bin/env python3
"""Inventory immutable builds and produce an evidence-bound candidate list."""
from contextlib import ExitStack
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import stat
import subprocess
import time

PROD = Path("/var/www/citefi")
STAGING = Path("/var/www/citefi-staging")
RELEASE = re.compile(r"[a-f0-9]{40}-[a-f0-9]{16}")
LEGACY_ROLLBACKS = {"5b44cd1178b4d32778a54d5e2c96dc2799c3a355-c30a792f8f170098",
                    "3f85ef0ef9b0156f0f392f8eba20e1fcf79d6886-a754b8cf49f55f7c"}
LIVE_PATH = re.compile(r"/var/www/citefi(?:-staging)?/(?:releases/[a-f0-9]{40}-[a-f0-9]{16}|current)(?=[/ \t\r\n\"'\0]|$)")
EVIDENCE = {"ops-recovery", "retained-media", "uploads", "evidence", "db-backups", ".git", "storage"}
LOCK_PATHS = tuple(root / ".deploy/release.lock" for root in (PROD, STAGING))
QA_LOCK = STAGING / "publishing-qa/.source-operation.lock"
MAX_RECLAIM = 8 * 1024**3


def anchors(path, candidates):
    """Collect every release owner along each symlink chain, not only the endpoint."""
    seen = set()
    hits = set()
    current = Path(os.path.abspath(path))
    for _ in range(64):
        if current in seen:
            return hits
        seen.add(current)
        prefix = Path("/")
        for index, component in enumerate(current.parts[1:], 1):
            prefix /= component
            if prefix in candidates:
                hits.add(prefix)
            if prefix.is_symlink():
                current = Path(os.path.abspath(prefix.parent / os.readlink(prefix) / Path(*current.parts[index + 1:])))
                break
        else:
            return hits
    raise ValueError("Release symlink depth exceeded")


def path_refs(text, candidates):
    hits = set()
    for match in LIVE_PATH.finditer(text):
        hits.update(anchors(match[0], candidates))
    return hits


def process_refs(candidates):
    refs = set()
    for entry in Path("/proc").iterdir():
        if not entry.name.isdecimal():
            continue
        try:
            links = [entry / k for k in ("cwd", "root", "exe")] + list((entry / "fd").iterdir())
            for link in links:
                try:
                    ref = os.readlink(link).removesuffix(" (deleted)")
                except (FileNotFoundError, ProcessLookupError):
                    continue
                refs.update(path_refs(ref, candidates))
            for field in ("cmdline", "maps"):
                try:
                    refs.update(path_refs((entry / field).read_text(errors="replace"), candidates))
                except (FileNotFoundError, ProcessLookupError):
                    continue
        except (FileNotFoundError, ProcessLookupError):
            continue
    return refs


def disk_identity(info):
    return [info.st_dev, info.st_ino, info.st_uid, info.st_gid, info.st_mode, info.st_mtime_ns, info.st_ctime_ns]


def build_identity(path):
    sha = path.name.split("-")[0]
    marker, build = path / ".release-sha", path / ".next/BUILD_ID"
    if (not marker.is_file() or marker.is_symlink() or marker.stat().st_size > 128
            or not build.is_file() or build.is_symlink() or build.stat().st_size > 256
            or build.resolve(strict=True) != build):
        return False
    build_id = build.read_text().strip()
    return marker.read_text().strip() == sha and bool(re.fullmatch(r"[A-Za-z0-9_-]{1,128}", build_id))


def protected_closure(initial, edges):
    keep = set(initial)
    frontier = list(keep)
    while frontier:
        for target in edges.get(frontier.pop(), set()) - keep:
            frontier.append(target)
            keep.add(target)
    return keep


def inspect_tree(root, candidates, rows, edges, protected):
    """Observe retained links and ownership without opening application file contents."""
    device = root.stat().st_dev
    for directory, dirs, names in os.walk(root, followlinks=False, onerror=lambda e: fail_walk(e)):
        here = Path(directory)
        owner = next((p for p in here.parents if p in candidates), None)
        if here in candidates:
            owner = here
        for name in dirs + names:
            p = here / name
            info = p.lstat()
            if info.st_dev != device:
                if owner:
                    protected.setdefault(owner, set()).add("contains another filesystem")
                if name in dirs:
                    dirs.remove(name)
                continue
            if owner and info.st_uid != rows[owner]["identity"][2]:
                protected.setdefault(owner, set()).add("mixed file ownership")
            if owner and (name in EVIDENCE or name.endswith((".sql.gz", ".log", ".receipt.json"))):
                if "node_modules" not in p.relative_to(owner).parts:
                    protected.setdefault(owner, set()).add("contains possible evidence or runtime data")
            if stat.S_ISLNK(info.st_mode):
                hits = anchors(p, candidates)
                if owner:
                    edges.setdefault(owner, set()).update(hits - {owner})
                else:
                    for target in hits:
                        protected.setdefault(target, set()).add("referenced by a retained path")


def fail_walk(error):
    raise error


def config_refs(candidates):
    files = [PROD / ".deploy/release-status.json", STAGING / ".deploy/release-status.json",
             STAGING / "publishing-qa/setup.json", STAGING / "publishing-qa/processes.config.cjs"]
    for user in pwd.getpwall():
        if user.pw_uid and not user.pw_dir.startswith("/home/"):
            continue
        files.extend(Path(user.pw_dir) / ".pm2" / name for name in ("dump.pm2", "dump.pm2.bak"))
    for folder in (Path("/etc/systemd/system"), Path("/etc/cron.d"), Path("/etc/nginx/sites-enabled"),
                   PROD / "ops-recovery", PROD / ".deploy/recovery-plans", STAGING / ".deploy/recovery-plans"):
        if folder.is_dir():
            for base, directories, names in os.walk(folder, followlinks=False, onerror=fail_walk):
                del directories[:]  # root configuration plus one level of recovery manifests
                entries = [Path(base) / n for n in names]
                if folder.name == "recovery-plans":
                    entries.extend(target for d in folder.iterdir() if d.is_dir() and not d.is_symlink()
                                   for target in d.glob("*.json"))
                files.extend(p for p in entries
                             if p.suffix in (".json", ".service", ".timer", ".conf", ".cjs")
                             or folder.name in ("cron.d", "sites-enabled"))
    refs = set()
    for p in files:
        if p.is_file():
            if p.stat().st_size > 32 * 1024**2:
                raise ValueError("Oversize startup or recovery configuration")
            refs.update(path_refs(p.read_text(errors="replace"), candidates))
    return refs


def get_builds():
    candidates, flags, rows = set(), {}, {}
    for root in (PROD, STAGING):
        releases = root / "releases"
        if releases.resolve(strict=True) != releases or not releases.is_dir():
            raise ValueError("Release directory is not canonical")
        for p in sorted(releases.iterdir()):
            entry = p.lstat()
            if not RELEASE.fullmatch(p.name) or not stat.S_ISDIR(entry.st_mode) or p.is_symlink():
                continue
            candidates.add(p)
            rows[p] = {"environment": "production" if root == PROD else "staging",
                       "release": p.name, "identity": disk_identity(entry), "buildIdentityOk": build_identity(p)}
    for root in (PROD, STAGING):
        local = [p for p in candidates if p.parent.parent == root]
        current = root / "current"
        if not current.is_symlink() or current.resolve(strict=True) not in local:
            flags[root.name] = "Current live release is not established"
        else:
            flags[root.name] = current.resolve(strict=True).name
    return candidates, rows, flags


def lock_releases(stack):
    if os.geteuid() != 0:
        raise ValueError("Expected privileged read-only process inspection")
    for path in LOCK_PATHS:
        f = stack.enter_context(os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), "rb"))
        fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
    if os.path.lexists(QA_LOCK):
        raise ValueError("Staging QA operation is active")


def preview():
    candidates, rows, flags = get_builds()
    protected = {}
    edges = {}
    for p, row in rows.items():
        if not row["buildIdentityOk"]:
            protected.setdefault(p, set()).add("build identity unproved")
        if time.time() - p.stat().st_mtime < 7 * 86400:
            protected.setdefault(p, set()).add("new or recently changed")
        if p.parent.parent == PROD and p.name in LEGACY_ROLLBACKS:
            protected.setdefault(p, set()).add("documented production recovery build")
    runtime, configuration = process_refs(candidates), config_refs(candidates)
    for p in runtime | configuration:
        protected.setdefault(p, set()).add("live process or startup/recovery reference")
    for root in (PROD, STAGING):
        local = [p for p in candidates if p.parent.parent == root]
        inspect_tree(root, candidates, rows, edges, protected)
        current = next((p for p in local if p.name == flags[root.name]), None)
        if current is None or not rows[current]["buildIdentityOk"]:
            for p in local:
                protected.setdefault(p, set()).add("no verified current build")
            continue
        protected.setdefault(current, set()).add("current build")
        backups = sorted((p for p in local if p != current and rows[p]["buildIdentityOk"]),
                         key=lambda p: (p.stat().st_mtime_ns, p.name), reverse=True)
        for p in backups[:2]:
            protected.setdefault(p, set()).add("retained rollback build")
        if root == PROD and not any(p.name in LEGACY_ROLLBACKS for p in backups):
            for p in local:
                protected.setdefault(p, set()).add("documented production rollback was not found")
        if root == STAGING and not any(p in runtime | configuration for p in local):
            for p in local:
                protected.setdefault(p, set()).add("staging runtime/startup relationship unverified")
    for p in protected_closure(protected, edges) - protected.keys():
        protected[p] = {"dependency of a retained build"}
    for note in Path("/proc/self/mountinfo").read_text().splitlines():
        mount = re.sub(r"\\([0-7]{3})", lambda m: chr(int(m[1], 8)), note.split()[4])
        for p in candidates:
            if mount == str(p) or mount.startswith(str(p) + "/"):
                protected.setdefault(p, set()).add("contains a mount")
    for p in protected_closure(protected, edges) - protected.keys():
        protected[p] = {"dependency of a retained build"}
    paths = sorted(rows)
    sizes = subprocess.run(["du", "-x", "-s", "-B1", "--", *map(str, paths)], check=True,
                           capture_output=True, text=True, timeout=260) if paths else None
    measured = dict(line.split("\t", 1)[::-1] for line in sizes.stdout.splitlines()) if sizes else {}
    results = []
    for p in paths:
        row = rows[p]
        row["allocatedBytes"] = int(measured[str(p)])
        row["keepReasons"] = sorted(protected.get(p, ()))
        if not row["keepReasons"] and row["allocatedBytes"] > MAX_RECLAIM:
            row["keepReasons"].append("larger than the approved operation bound")
        results.append(row)
    proof = {"current": flags, "releases": results}
    digest = hashlib.sha256(json.dumps(proof, sort_keys=True).encode()).hexdigest()
    volume = os.statvfs(PROD)
    return {**proof, "digest": digest, "availableBytes": volume.f_bavail * volume.f_frsize}


def main():
    with ExitStack() as stack:
        lock_releases(stack)
        print(json.dumps(preview(), sort_keys=True), flush=True)


if __name__ == "__main__":
    main()
