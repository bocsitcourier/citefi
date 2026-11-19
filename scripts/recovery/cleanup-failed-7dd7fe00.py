#!/usr/bin/env python3
"""One-time production cleanup of the two approved failed-release artifacts."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat

ROOT = Path("/var/www/citefi")
ACTIVE = "51ddab5ba07f3bf4be33778afb6f4bd65c0670cd-e7070b009dab3b62"
FAILED = "7dd7fe00b90a6be0eafb45864a6fab63c28aa7c0-ac00ab7cf462a4b9"
ARCHIVE = f".deploy/incoming/artifact-{FAILED}-p4bDdm.tar.gz"
UNPACK = f"releases/.unpack-{FAILED}-943363"
ARCHIVE_MTIME = 1795050332069923099
UNPACK_MTIME = 1795049507000000000


def information(path, filesystem, mode):
    info = path.lstat()
    if (path.resolve() != path or info.st_dev != filesystem or
            info.st_uid != os.getuid() or not mode(info.st_mode)):
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


def verify_live_refs(targets):
    for record in Path("/proc/self/mountinfo").read_text().splitlines():
        mount = re.sub(r"\\([0-7]{3})", lambda m: chr(int(m[1], 8)), record.split()[4])
        if any(same_or_child(mount, target) for target in targets):
            raise RuntimeError("Approved artifact contains a mount")
    # Check the processes owned by the deployment account, including PM2 and
    # its children. Never read or emit argv, environment variables or file data.
    proc = Path("/proc")
    for entry in proc.iterdir():
        if not entry.name.isdecimal():
            continue
        try:
            if entry.stat().st_uid != os.getuid():
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
            if not is_root_parented_ssh_transport(entry, proc):
                raise


def cleanup(root):
    filesystem = root.lstat().st_dev
    for directory in (root, root / ".deploy", root / ".deploy/incoming", root / "releases"):
        information(directory, filesystem, stat.S_ISDIR)
    lock = root / ".deploy/release.lock"
    lock_info = information(lock, filesystem, stat.S_ISREG)
    with os.fdopen(os.open(lock, os.O_RDONLY | os.O_NOFOLLOW), "rb") as handle:
        if (os.fstat(handle.fileno()).st_ino != lock_info.st_ino):
            raise RuntimeError("Host release lock changed")
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        current = root / "current"
        live = root / "releases" / ACTIVE
        if not current.is_symlink() or current.resolve(strict=True) != live:
            raise RuntimeError("Active production release differs from the approved evidence")
        information(live, filesystem, stat.S_ISDIR)
        if ((live / ".release-sha").read_text().strip() != ACTIVE.split("-")[0] or
                not (live / ".next/BUILD_ID").stat().st_size):
            raise RuntimeError("Active artifact identity is missing")
        if os.path.lexists(root / "releases" / FAILED):
            raise RuntimeError("The failed release now has a final artifact")
        status_file = root / ".deploy/release-status.json"
        if information(status_file, filesystem, stat.S_ISREG).st_size != 0:
            raise RuntimeError("Release status has changed since the approved inspection")
        archive, unpack = root / ARCHIVE, root / UNPACK
        first = information(archive, filesystem, stat.S_ISREG)
        second = information(unpack, filesystem, stat.S_ISDIR)
        if ((first.st_mtime_ns, first.st_blocks * 512, first.st_nlink) !=
                (ARCHIVE_MTIME, 773722112, 1) or second.st_mtime_ns != UNPACK_MTIME):
            raise RuntimeError("Approved artifacts differ from the storage inventory")
        with archive.open("rb") as stream:
            digest = hashlib.file_digest(stream, "sha256").hexdigest()
        if not digest.startswith(FAILED.split("-")[1]):
            raise RuntimeError("Archive does not match the failed deployment checksum")
        verify_live_refs((archive, unpack))
        if not shutil.rmtree.avoids_symlink_attacks:
            raise RuntimeError("Safe directory removal is unavailable")
        if (identity(information(archive, filesystem, stat.S_ISREG)) != identity(first) or
                identity(information(unpack, filesystem, stat.S_ISDIR)) != identity(second)):
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
    cleanup(ROOT)
