#!/usr/bin/env python3
"""Losslessly compress two measured historical log files without touching live logs."""
import fcntl
import gzip
import hashlib
import json
import os
from pathlib import Path
import stat
import time
from uuid import uuid4

DIRECTORY = Path("/var/log/citefi")
LOCK = "/var/www/citefi/.deploy/release.lock"
TARGETS = {817369: 4584849408, 817321: 441491456}
LIVE_LOGS = {"web-out.log", "web-error.log", "worker-out.log", "worker-error.log"}
MAX_GZIP = 512 * 1024 ** 2
MIN_FREE = 1024 ** 3
CHUNK = 1024 ** 2


def identity(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_blocks, info.st_mtime_ns,
            info.st_ctime_ns, info.st_nlink)


def inspect(info, measured_bytes, name, now):
    if name in LIVE_LOGS or name.endswith((".gz", ".xz", ".zst", ".bz2", ".zip")):
        return "live or already compressed"
    if not stat.S_IMODE(info.st_mode) & 0o400 or info.st_mode & 0o7000:
        return "unexpected permissions"
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_blocks * 512 != measured_bytes:
        return "file identity changed"
    if now - info.st_mtime < 86400:
        return "changed within the last day"
    return None


def not_open(info, our_fd):
    for process in Path("/proc").iterdir():
        if not process.name.isdecimal():
            continue
        try:
            members = list((process / "fd").iterdir())
        except (FileNotFoundError, ProcessLookupError):
            continue
        for fd in members:
            if process.name == str(os.getpid()) and fd.name == str(our_fd):
                continue
            try:
                target = fd.stat()
            except (FileNotFoundError, ProcessLookupError):
                continue
            if (target.st_dev, target.st_ino) == (info.st_dev, info.st_ino):
                return False
    return True


def compress(directory, name, expected):
    before = os.stat(name, dir_fd=directory, follow_symlinks=False)
    reason = inspect(before, expected, name, time.time())
    if reason:
        return {"outcome": reason}
    temporary = ".citefi-archive-" + uuid4().hex
    final = name + ".gz"
    with os.fdopen(os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory), "rb") as src:
        if identity(os.fstat(src.fileno())) != identity(before) or not not_open(before, src.fileno()):
            return {"outcome": "open by a process or identity changed"}
        if os.fstatvfs(directory).f_bavail * os.fstatvfs(directory).f_frsize < MIN_FREE + MAX_GZIP:
            return {"outcome": "insufficient scratch space"}
        try:
            if os.stat(final, dir_fd=directory, follow_symlinks=False):
                return {"outcome": "compressed name already exists"}
        except FileNotFoundError:
            pass
        fd = os.open(temporary, os.O_RDWR | os.O_EXCL | os.O_CREAT | os.O_NOFOLLOW, 0o600, dir_fd=directory)
        published = False
        try:
            with os.fdopen(fd, "w+b") as dest:
                digest = hashlib.sha256()
                with gzip.GzipFile(filename="", fileobj=dest, mode="wb", compresslevel=3, mtime=0) as encoder:
                    while chunk := src.read(CHUNK):
                        digest.update(chunk)
                        encoder.write(chunk)
                        if dest.tell() > MAX_GZIP:
                            return {"outcome": "compressed archive exceeded the safe scratch limit"}
                dest.flush()
                if dest.tell() > MAX_GZIP:
                    return {"outcome": "compressed archive exceeded the safe scratch limit"}
                dest.seek(0)
                with gzip.GzipFile(fileobj=dest, mode="rb") as decoded:
                    if hashlib.file_digest(decoded, "sha256").digest() != digest.digest():
                        return {"outcome": "compressed verification failed"}
                if (identity(os.stat(name, dir_fd=directory, follow_symlinks=False)) != identity(before)
                        or not not_open(before, src.fileno())):
                    return {"outcome": "log changed during verification"}
                os.fchown(dest.fileno(), before.st_uid, before.st_gid)
                os.fchmod(dest.fileno(), stat.S_IMODE(before.st_mode))
                os.utime(dest.fileno(), ns=(before.st_atime_ns, before.st_mtime_ns))
                os.fsync(dest.fileno())
                # Hard-link publication cannot overwrite an existing archive.
                os.link(temporary, final, src_dir_fd=directory, dst_dir_fd=directory, follow_symlinks=False)
                os.fsync(directory)
                published = True
                if identity(os.stat(name, dir_fd=directory, follow_symlinks=False)) != identity(before):
                    return {"outcome": "original kept because it changed"}
                os.unlink(name, dir_fd=directory)
                os.fsync(directory)
                return {"outcome": "compressed and verified", "oldBytes": expected,
                        "archiveBytes": os.fstat(dest.fileno()).st_blocks * 512}
        finally:
            os.unlink(temporary, dir_fd=directory)
            if published:
                os.fsync(directory)


def main():
    if os.geteuid() != 0 or DIRECTORY.resolve(strict=True) != DIRECTORY:
        raise SystemExit("Expected privileged access to the canonical production log directory")
    dir_fd = os.open(DIRECTORY, os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        with os.fdopen(os.open(LOCK, os.O_RDONLY | os.O_NOFOLLOW), "rb") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            rows = {}
            for name in sorted(os.listdir(dir_fd)):
                if not name.endswith(".log") or name in LIVE_LOGS:
                    continue
                info = os.stat(name, dir_fd=dir_fd, follow_symlinks=False)
                if info.st_ino not in TARGETS or info.st_dev != os.fstat(dir_fd).st_dev:
                    continue
                rows[info.st_ino] = compress(dir_fd, name, TARGETS[info.st_ino])
            volume = os.fstatvfs(dir_fd)
            print(json.dumps({"archiveResults": rows, "availableBytes": volume.f_bavail * volume.f_frsize},
                             sort_keys=True), flush=True)
    finally:
        os.close(dir_fd)


if __name__ == "__main__":
    main()
