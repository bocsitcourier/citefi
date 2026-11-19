#!/usr/bin/env python3
"""One-time production cleanup of the two approved failed-release artifacts."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import stat
import sys

ROOT = Path("/var/www/citefi")
ACTIVE = "51ddab5ba07f3bf4be33778afb6f4bd65c0670cd-e7070b009dab3b62"
FAILED = "7dd7fe00b90a6be0eafb45864a6fab63c28aa7c0-ac00ab7cf462a4b9"
ARCHIVE = f".deploy/incoming/artifact-{FAILED}-p4bDdm.tar.gz"
UNPACK = f"releases/.unpack-{FAILED}-943363"
ARCHIVE_MTIME = 1795050332069923099
UNPACK_MTIME = 1795049507000000000


def information(path, filesystem, mode, owner_uid=None):
    info = path.lstat()
    if (path.resolve() != path or info.st_dev != filesystem or
            info.st_uid != (os.getuid() if owner_uid is None else owner_uid) or not mode(info.st_mode)):
        raise RuntimeError(f"Unexpected ownership, type or filesystem: {path.name}")
    return info


def same_or_child(path, ancestor):
    return path == str(ancestor) or path.startswith(str(ancestor) + "/")


def identity(info):
    # Hashing the archive can legitimately change its access time.
    return {k: getattr(info, f"st_{k}") for k in
            ("dev", "ino", "uid", "mtime_ns", "size", "blocks", "nlink")}


def is_root_parented_ssh_transport(entry, proc):
    # OpenSSH's unprivileged transport can be non-dumpable, so a same-user
    # process may not inspect its file descriptors. Exempt only the transport
    # directly parented by root, not a service or a same-user SSH child.
    try:
        if (entry / "comm").read_text().strip() not in ("sshd", "sshd-session", "sshd-auth"):
            return False
        match = re.search(r"^PPid:\s+([1-9][0-9]*)$", (entry / "status").read_text(), re.M)
        if not match:
            return False
        parent = proc / match.group(1)
        return (parent.stat().st_uid == 0 and
                (parent / "comm").read_text().strip() in ("sshd", "sshd-session"))
    except OSError:
        return False


def own_ssh_transport_ancestors(proc):
    # The SSH session executing this exact cleanup has never received either
    # artifact as input. Its restricted OpenSSH parent may be non-dumpable
    # even if the root parent cannot be read from the service account.
    ancestors = set()
    pid = os.getppid()
    while pid > 1 and len(ancestors) < 12:
        entry = proc / str(pid)
        try:
            if (entry / "comm").read_text().strip() in ("sshd", "sshd-session", "sshd-auth"):
                ancestors.add(entry)
            match = re.search(r"^PPid:[ \t]+([1-9][0-9]*)$", (entry / "status").read_text(), re.M)
            if not match or int(match.group(1)) >= pid:
                break
            pid = int(match.group(1))
        except OSError:
            break
    return ancestors


def verify_live_refs(targets, *, privileged=False):
    for record in Path("/proc/self/mountinfo").read_text().splitlines():
        mount = re.sub(r"\\([0-7]{3})", lambda m: chr(int(m[1], 8)), record.split()[4])
        if any(same_or_child(mount, target) for target in targets):
            raise RuntimeError("Approved artifact contains a mount")
    # Check the processes owned by the deployment account, including PM2 and
    # its children. Never read or emit argv, environment variables or file data.
    proc = Path("/proc")
    own_transport = own_ssh_transport_ancestors(proc) if not privileged else set()
    for entry in proc.iterdir():
        if not entry.name.isdecimal():
            continue
        try:
            if not privileged and entry.stat().st_uid != os.getuid():
                continue
            links = [entry / name for name in ("cwd", "exe", "root")]
            links.extend((entry / "fd").iterdir())
            for link in links:
                try:
                    reference = os.readlink(link).removesuffix(" (deleted)")
                except FileNotFoundError:
                    continue
                if any(same_or_child(reference, target) for target in targets):
                    raise RuntimeError("A live process references an approved artifact")
        except FileNotFoundError:
            continue
        except PermissionError:
            if privileged or (entry not in own_transport and not is_root_parented_ssh_transport(entry, proc)):
                try:
                    kind = (entry / "comm").read_text().strip()
                except OSError:
                    kind = ""
                safe_kind = kind if re.fullmatch(r"[a-zA-Z0-9._-]{1,15}", kind) else "unknown"
                raise RuntimeError(f"Cannot verify release references for process type {safe_kind}") from None


def drop_privileges(account):
    os.setgroups([])
    os.setresgid(account.pw_gid, account.pw_gid, account.pw_gid)
    os.setresuid(account.pw_uid, account.pw_uid, account.pw_uid)
    if os.getresuid() != (account.pw_uid,) * 3 or os.getresgid() != (account.pw_gid,) * 3:
        raise RuntimeError("Removal is allowed only as the service account")


def cleanup(root, *, privileged=False):
    account = None
    if privileged:
        if os.geteuid() != 0:
            raise RuntimeError("Privileged file-reference verification requires root")
        account = pwd.getpwnam("citefi")
        if not account.pw_uid or not account.pw_gid:
            raise RuntimeError("Expected a non-root deployment account")
    elif os.geteuid() == 0:
        raise RuntimeError("Root must use the fixed privileged-verification mode")
    filesystem = root.lstat().st_dev
    def inspect(path, mode):
        if account is None:
            return information(path, filesystem, mode)
        return information(path, filesystem, mode, account.pw_uid)
    for directory in (root, root / ".deploy", root / ".deploy/incoming", root / "releases"):
        inspect(directory, stat.S_ISDIR)
    lock = root / ".deploy/release.lock"
    lock_info = inspect(lock, stat.S_ISREG)
    with os.fdopen(os.open(lock, os.O_RDONLY | os.O_NOFOLLOW), "rb") as handle:
        if (os.fstat(handle.fileno()).st_ino != lock_info.st_ino):
            raise RuntimeError("Host release lock changed")
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        current = root / "current"
        live = root / "releases" / ACTIVE
        if not current.is_symlink() or current.resolve(strict=True) != live:
            raise RuntimeError("Active production release differs from the approved evidence")
        inspect(live, stat.S_ISDIR)
        if ((live / ".release-sha").read_text().strip() != ACTIVE.split("-")[0] or
                not (live / ".next/BUILD_ID").stat().st_size):
            raise RuntimeError("Active artifact identity is missing")
        if os.path.lexists(root / "releases" / FAILED):
            raise RuntimeError("The failed release now has a final artifact")
        status_file = root / ".deploy/release-status.json"
        if inspect(status_file, stat.S_ISREG).st_size != 0:
            raise RuntimeError("Release status has changed since the approved inspection")
        archive, unpack = root / ARCHIVE, root / UNPACK
        first = inspect(archive, stat.S_ISREG)
        second = inspect(unpack, stat.S_ISDIR)
        if ((first.st_mtime_ns, first.st_blocks * 512, first.st_nlink) !=
                (ARCHIVE_MTIME, 773722112, 1) or second.st_mtime_ns != UNPACK_MTIME):
            raise RuntimeError("Approved artifacts differ from the storage inventory")
        with archive.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        if not digest.startswith(FAILED.split("-")[1]):
            raise RuntimeError("Archive does not match the failed deployment checksum")
        if account is not None:
            verify_live_refs((archive, unpack), privileged=True)
            # Keep the already-acquired release lock, but remove both paths
            # with service-account permissions, not root's filesystem access.
            drop_privileges(account)
        else:
            verify_live_refs((archive, unpack))
        if not shutil.rmtree.avoids_symlink_attacks:
            raise RuntimeError("Safe directory removal is unavailable")
        if (identity(inspect(archive, stat.S_ISREG)) != identity(first) or
                identity(inspect(unpack, stat.S_ISDIR)) != identity(second)):
            raise RuntimeError("An approved artifact changed before removal")
        disk = os.statvfs(root)
        print(json.dumps({"phase": "verified", "active": ACTIVE, "archive": identity(first),
                          "archiveSha256": digest, "partialTree": identity(second),
                          "availableBytes": disk.f_bavail * disk.f_frsize}), flush=True)
        shutil.rmtree(unpack)
        archive.unlink()
        disk = os.statvfs(root)
        print(json.dumps({"phase": "removed", "active": ACTIVE, "removedPaths": [UNPACK, ARCHIVE],
                          "availableBytes": disk.f_bavail * disk.f_frsize}), flush=True)


if __name__ == "__main__":
    if sys.argv[1:] not in ([], ["--privileged-verification"]):
        raise SystemExit("Unknown cleanup mode")
    cleanup(ROOT, privileged=bool(sys.argv[1:]))
