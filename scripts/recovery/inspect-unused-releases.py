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
import shutil
import stat
import subprocess
import sys
import time
from urllib.error import HTTPError
from urllib.request import urlopen

PROD = Path("/var/www/citefi")
STAGING = Path("/var/www/citefi-staging")
RELEASE = re.compile(r"[a-f0-9]{40}-[a-f0-9]{16}")
LEGACY_ROLLBACKS = {"5b44cd1178b4d32778a54d5e2c96dc2799c3a355-c30a792f8f170098",
                    "3f85ef0ef9b0156f0f392f8eba20e1fcf79d6886-a754b8cf49f55f7c"}
LIVE_PATH = re.compile(r"/var/www/citefi(?:-staging)?/(?:releases/[a-f0-9]{40}-[a-f0-9]{16}|current)(?=[/ \t\r\n\"'\0]|$)")
EVIDENCE = {"ops-recovery", "retained-media", "uploads", "evidence", "db-backups", ".git", "storage"}
# These two directories are versioned application source in the one inspected
# October release. Exact Git tree IDs come from that release's independent
# GitHub source. An extra, missing or changed byte keeps the release protected.
FROZEN_SOURCE = {
    "4aa8bddcfbf615d643110cbb6514b3666c5fa260-aef3ab7b759ac3ae": {
        "QA/evidence": "a71cf009d8734887a38b5de0d78fcb71f84d7514",
        "packages/apex-receiver/src/storage": "6fff913730ff0dbcc023d819d133dc631dffc926",
    },
}
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


def git_object(kind, payload):
    return hashlib.sha1(kind + str(len(payload)).encode() + b"\0" + payload, usedforsecurity=False).digest()


def git_tree(path, device):
    entries = []
    for p in path.iterdir():
        info = p.lstat()
        if info.st_dev != device:
            raise ValueError("Source subtree crossed a filesystem")
        name = os.fsencode(p.name)
        if stat.S_ISDIR(info.st_mode):
            mode, digest, sort_key = b"40000", git_tree(p, device), name + b"/"
        elif stat.S_ISLNK(info.st_mode):
            mode, digest, sort_key = b"120000", git_object(b"blob ", os.fsencode(os.readlink(p))), name
        elif stat.S_ISREG(info.st_mode) and info.st_size <= 128 * 1024**2:
            mode = b"100755" if info.st_mode & stat.S_IXUSR else b"100644"
            with os.fdopen(os.open(p, os.O_RDONLY | os.O_NOFOLLOW), "rb") as source:
                if disk_identity(os.fstat(source.fileno())) != disk_identity(info):
                    raise ValueError("Source evidence changed during verification")
                digest = git_object(b"blob ", source.read(128 * 1024**2 + 1))
            sort_key = name
        else:
            raise ValueError("Unexpected frozen source file")
        entries.append((sort_key, mode + b" " + name + b"\0" + digest))
    return git_object(b"tree ", b"".join(payload for _, payload in sorted(entries)))


def matching_source(path, relative, device):
    expected = FROZEN_SOURCE.get(path.name, {}).get(str(relative))
    full = path / relative
    return (expected is not None and full.resolve(strict=True) == full
            and git_tree(full, device).hex() == expected)


def inspect_tree(root, candidates, rows, edges, protected):
    """Observe retained links and ownership without opening application file contents."""
    device = root.stat().st_dev
    source_roots = {}
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
                relative = p.relative_to(owner)
                verified = source_roots.setdefault(owner, set())
                if stat.S_ISDIR(info.st_mode) and matching_source(owner, relative, device):
                    verified.add(relative)
                if "node_modules" not in relative.parts and not any(
                        relative == source or source in relative.parents for source in verified):
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
        if path.resolve(strict=True) != path:
            raise ValueError("Release lock does not resolve to its canonical path")
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
        if root == PROD and current not in runtime:
            for p in local:
                protected.setdefault(p, set()).add("production current not confirmed by running processes")
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


def choose_removals(report, digest, release_ids):
    if report["digest"] != digest:
        raise ValueError("Live release inventory differs from the reviewed plan")
    if not release_ids or len(set(release_ids)) != len(release_ids):
        raise ValueError("An explicit set of distinct release identities is required")
    selected = []
    for identifier in release_ids:
        matching = [r for r in report["releases"] if f'{r["environment"]}/{r["release"]}' == identifier]
        if len(matching) != 1 or matching[0]["keepReasons"] or not matching[0]["buildIdentityOk"]:
            raise ValueError("An approved release is not eligible")
        selected.append(matching[0])
    if sum(r["allocatedBytes"] for r in selected) > MAX_RECLAIM:
        raise ValueError("Approved removal batch exceeds the per-operation bound")
    return selected


def backup_health():
    try:
        response = urlopen("https://citefi.co/api/health?full=1", timeout=12)
    except HTTPError as error:
        if error.code != 503:
            raise
        response = error
    with response:
        if response.url != "https://citefi.co/api/health?full=1":
            raise ValueError("Unexpected production readiness endpoint")
        services = json.loads(response.read(524288))["services"]
    for key in ("backup", "restoreVerification", "redis", "worker", "storage"):
        if services.get(key, {}).get("ok") is not True:
            raise ValueError("Production recovery prerequisites did not pass")


def remove_as_owner(path, identity):
    uid, gid = identity[2:4]
    if uid == 0 or gid == 0 or uid != pwd.getpwnam("citefi").pw_uid:
        raise ValueError("Expected the approved service account as release owner")
    if disk_identity(path.lstat()) != identity or not shutil.rmtree.avoids_symlink_attacks:
        raise ValueError("Release tree changed or safe removal is unavailable")
    parent = path.parent
    removed = parent / (".reclaim-" + path.name)
    if os.path.lexists(removed):
        raise ValueError("An earlier reclamation tree exists; review it separately")
    child = os.fork()
    if child == 0:
        try:
            os.setgroups([])
            os.setresgid(gid, gid, gid)
            os.setresuid(uid, uid, uid)
            if os.getresuid() != (uid,) * 3 or os.getresgid() != (gid,) * 3:
                raise ValueError("Could not drop privileged filesystem access")
            if disk_identity(path.lstat()) != identity or path.resolve(strict=True) != path:
                raise ValueError("Approved release changed before reclamation")
            os.rename(path, removed)
            # The release packer marks its tree read-only. Open and make
            # directories writable as the owner without following any links.
            for _, _, _, dir_fd in os.fwalk(removed, topdown=True, follow_symlinks=False):
                node = os.fstat(dir_fd)
                if node.st_dev != identity[0] or node.st_uid != uid:
                    raise ValueError("Unexpected ownership or filesystem in release")
                os.fchmod(dir_fd, stat.S_IMODE(node.st_mode) | stat.S_IRWXU)
            shutil.rmtree(removed)
        except Exception:
            os._exit(1)
        os._exit(0)
    _, status = os.waitpid(child, 0)
    if status != 0 or os.path.lexists(path) or os.path.lexists(removed):
        raise RuntimeError("Scoped release removal stopped; inspect its location before retrying")


def reclaim(digest, release_ids):
    if not re.fullmatch(r"[0-9a-f]{64}", digest) or not all(
            re.fullmatch(r"(?:production|staging)/[a-f0-9]{40}-[a-f0-9]{16}", item) for item in release_ids):
        raise ValueError("Invalid reviewed reclamation request")
    # Use the same lock as staging QA. A simultaneous QA operation must fail
    # closed; do not interrupt it, break stale locks, or remove its evidence.
    QA_LOCK.mkdir(mode=0o700)
    lock_identity = disk_identity(QA_LOCK.lstat())
    try:
        report = preview()
        approved = choose_removals(report, digest, release_ids)
        backup_health()
        paths = {(PROD if r["environment"] == "production" else STAGING) / "releases" / r["release"]
                 for r in approved}
        if process_refs(paths) or config_refs(paths):
            raise ValueError("An approved directory acquired a live reference")
        print(json.dumps({"phase": "verified listing", "releases": release_ids,
                          "availableBytesBefore": report["availableBytes"]}), flush=True)
        for row in approved:
            root = PROD if row["environment"] == "production" else STAGING
            path = root / "releases" / row["release"]
            if root.joinpath("current").resolve(strict=True).name != report["current"][root.name]:
                raise ValueError("Current release changed")
            remove_as_owner(path, row["identity"])
            print(json.dumps({"phase": "removed", "environment": row["environment"],
                              "release": row["release"], "allocatedBytesBefore": row["allocatedBytes"]}), flush=True)
        volume = os.statvfs(PROD)
        print(json.dumps({"phase": "completed", "availableBytesAfter": volume.f_bavail * volume.f_frsize}), flush=True)
    finally:
        if disk_identity(QA_LOCK.lstat()) != lock_identity:
            raise ValueError("Staging lock changed; it was not removed")
        QA_LOCK.rmdir()


def main():
    with ExitStack() as stack:
        lock_releases(stack)
        args = sys.argv[1:]
        if not args:
            print(json.dumps(preview(), sort_keys=True), flush=True)
        elif len(args) >= 3 and args[0] == "--reclaim":
            reclaim(args[1], args[2:])
        else:
            raise ValueError("Unknown release operation")


if __name__ == "__main__":
    main()
