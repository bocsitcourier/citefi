#!/usr/bin/env python3
"""Read-only, root-filesystem accounting with allowlisted output."""
import json
import os
from pathlib import Path
import stat
import subprocess

CITEFI = Path("/var/www/citefi")
TOTALS = {
    "application": "/var/www/citefi",
    "production releases": "/var/www/citefi/releases",
    "deployment files": "/var/www/citefi/.deploy",
    "incoming archives": "/var/www/citefi/.deploy/incoming",
    "legacy dependencies": "/var/www/citefi/node_modules",
    "legacy build": "/var/www/citefi/.next",
    "application recovery": "/var/www/citefi/ops-recovery",
    "staging": "/var/www/citefi-staging",
    "host logs": "/var/log",
    "system journal": "/var/log/journal",
    "system data": "/var/lib",
    "PostgreSQL": "/var/lib/postgresql",
    "Redis": "/var/lib/redis",
    "container storage": "/var/lib/docker",
    "system caches": "/var/cache",
    "local backups": "/var/backups",
    "temporary files": "/tmp",
    "service homes": "/home",
    "root home": "/root",
    "installed programs": "/usr",
    "all of /var": "/var",
}


def report_usage(text, active):
    releases = str(CITEFI / "releases") + "/"
    sizes = {}
    release_items = {}
    for line in text.splitlines():
        raw, sep, path = line.partition("\t")
        if not sep or not raw.isdecimal():
            continue
        if path == "/" or path in TOTALS.values() or path == active:
            sizes[path] = int(raw)
        if path.startswith(releases) and "/" not in path[len(releases):]:
            release_items[path] = int(raw)
    unpack = [size for path, size in release_items.items() if path[len(releases):].startswith(".unpack-")]
    inactive = [size for path, size in release_items.items()
                if path != active and not path[len(releases):].startswith(".")]
    return {"namedRootFilesystemBytes": sizes.get("/"),
            "groups": {label: sizes[path] for label, path in TOTALS.items() if path in sizes},
            "activeReleaseBytes": sizes.get(active),
            "otherReleaseDirectories": {"count": len(inactive), "bytes": sum(inactive)},
            "partialExtractions": {"count": len(unpack), "bytes": sum(unpack)}}


def opened_deleted_files(device):
    blocks = {}
    for entry in Path("/proc").iterdir():
        if not entry.name.isdecimal():
            continue
        try:
            for fd in (entry / "fd").iterdir():
                try:
                    if not os.readlink(fd).endswith(" (deleted)"):
                        continue
                    info = fd.stat()
                    if info.st_dev == device and stat.S_ISREG(info.st_mode) and not info.st_nlink:
                        blocks[info.st_ino] = info.st_blocks * 512
                except OSError:
                    continue
        except OSError:
            continue
    return {"count": len(blocks), "allocatedBytes": sum(blocks.values())}


def main():
    if os.geteuid() != 0 or not (CITEFI / "current").is_symlink():
        raise SystemExit("Expected privileged inspection of the existing Citefi host")
    active = (CITEFI / "current").resolve(strict=True)
    if active.parent != CITEFI / "releases":
        raise SystemExit("Unexpected active release layout")
    device = Path("/").stat().st_dev
    if CITEFI.stat().st_dev != device:
        raise SystemExit("Unexpected application filesystem; root-only accounting not representative")
    scan = subprocess.run(["du", "-x", "-B1", "--max-depth=5", "--", "/"],
                          capture_output=True, text=True, errors="replace", timeout=210)
    disk = os.statvfs("/")
    result = report_usage(scan.stdout, str(active))
    result["scanComplete"] = scan.returncode == 0 and result["namedRootFilesystemBytes"] is not None
    result["rootFilesystem"] = {"totalBytes": disk.f_blocks * disk.f_frsize,
                                "freeBytes": disk.f_bfree * disk.f_frsize,
                                "unprivilegedAvailableBytes": disk.f_bavail * disk.f_frsize}
    result["openDeletedFiles"] = opened_deleted_files(device)
    result["otherMounts"] = {str(p): p.stat().st_dev != device for p in (Path("/tmp"), Path("/var"), CITEFI)}
    result["swapFileBytes"] = sum(
        p.stat().st_blocks * 512 for p in (Path("/swapfile"), Path("/swap.img"), Path("/swap"))
        if not p.is_symlink() and p.is_file() and p.stat().st_dev == device)
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
