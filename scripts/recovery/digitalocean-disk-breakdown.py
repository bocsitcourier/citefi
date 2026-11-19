#!/usr/bin/env python3
"""Read-only, root-filesystem accounting with allowlisted output."""
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys

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


def log_family(relative):
    if relative.parts[0] == "journal":
        return "system journal"
    if relative.parts[0] in ("nginx", "postgresql", "redis", "apt", "unattended-upgrades"):
        return relative.parts[0]
    for family in ("syslog", "auth.log", "kern.log", "ufw.log", "cloud-init.log", "cloud-init-output.log",
                   "btmp", "wtmp", "lastlog", "daemon.log", "messages", "mail.log",
                   "citefi", "pm2", "fail2ban.log", "gitlab", "audit", "apache2"):
        if relative.name == family or relative.name.startswith(family + "."):
            return family
    if relative.parts[0] in ("citefi", "pm2", "audit", "apache2"):
        return relative.parts[0]
    if re.fullmatch(r"citefi[-_.][a-z-]{1,30}\.log(?:\.\d+(?:\.gz)?)?", relative.name):
        return "citefi"
    return "other"


def log_usage(root):
    totals = {}
    visited = set()
    opaque = 0
    device = root.stat().st_dev
    for directory, names, files in os.walk(root, followlinks=False):
        directory = Path(directory)
        names[:] = sorted(n for n in names if not (directory / n).is_symlink()
                          and (directory / n).lstat().st_dev == device)
        for name in sorted(files):
            p = directory / name
            try:
                info = p.lstat()
            except FileNotFoundError:
                opaque += 1
                continue
            if info.st_dev != device or not stat.S_ISREG(info.st_mode) or info.st_ino in visited:
                continue
            visited.add(info.st_ino)
            row = totals.setdefault(log_family(p.relative_to(root)),
                                    {"currentBytes": 0, "rotatedBytes": 0, "largestFileBytes": 0})
            key = "rotatedBytes" if re.search(r"\.\d+(?:\.(?:gz|xz|zst))?$|\.(?:gz|xz|zst)$|@\S+\.journal$", name) else "currentBytes"
            row[key] += info.st_blocks * 512
            row["largestFileBytes"] = max(row["largestFileBytes"], info.st_blocks * 512)
    return {"logGroups": totals, "vanishedFiles": opaque}


def report_logs():
    result = log_usage(Path("/var/log"))
    conf = Path("/etc/logrotate.d")
    result["logrotateRulesPresent"] = {k: (conf / k).is_file()
                                      for k in ("rsyslog", "nginx", "postgresql-common", "redis-server", "ufw",
                                                "btmp", "wtmp", "citefi", "pm2")}
    if shutil.which("logrotate"):
        # Debug mode never changes files or the rotation state. Log entries and
        # raw daemon configuration are not relayed to the runner.
        validation = subprocess.run(["logrotate", "--debug", "/etc/logrotate.conf"],
                                    capture_output=True, text=True, errors="replace", timeout=25)
        result["logrotateDryRunOk"] = validation.returncode == 0
        result["rotationDue"] = len(re.findall(r"\blog needs rotating\b", validation.stderr))
    print(json.dumps(result, sort_keys=True))


def main():
    if os.geteuid() != 0 or not (CITEFI / "current").is_symlink():
        raise SystemExit("Expected privileged inspection of the existing Citefi host")
    active = (CITEFI / "current").resolve(strict=True)
    if active.parent != CITEFI / "releases":
        raise SystemExit("Unexpected active release layout")
    device = Path("/").stat().st_dev
    if CITEFI.stat().st_dev != device:
        raise SystemExit("Unexpected application filesystem; root-only accounting not representative")
    if sys.argv[1:] == ["--logs"]:
        report_logs()
        return
    if sys.argv[1:] == ["--storage-categories"]:
        report_storage_categories()
        return
    if sys.argv[1:]:
        raise SystemExit("Unknown disk inspection mode")
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


def report_storage_categories():
    """Categorize only the measured large files and staging's first level."""
    root = Path("/var/log")
    scan = log_usage(root)
    leaders = []
    for folder, dirs, names in os.walk(root, followlinks=False):
        dirs[:] = [d for d in dirs if (Path(folder) / d).lstat().st_dev == root.stat().st_dev
                   and not (Path(folder) / d).is_symlink()]
        for name in names:
            f = Path(folder) / name
            try:
                data = f.lstat()
            except FileNotFoundError:
                continue
            if not stat.S_ISREG(data.st_mode) or data.st_blocks * 512 < 100 * 1024 * 1024:
                continue
            rel = f.relative_to(root)
            family = log_family(rel)
            # Prefer known system/application families. A new log identity
            # is shown only as a basename and only for standard log naming;
            # never print content, arbitrary filenames, or inner directory names.
            label = name if re.fullmatch(r"[a-z][a-z-]{0,45}(?:\.(?:log|[0-9]{1,2}|gz)){0,3}", name) else None
            leaders.append({"family": family, "logBasename": label, "allocatedBytes": data.st_blocks * 512,
                            "inode": data.st_ino, "hardLinks": data.st_nlink})
    stage = Path("/var/www/citefi-staging")
    p = subprocess.run(["du", "-x", "-B1", "--max-depth=2", "--", str(stage)],
                       capture_output=True, text=True, errors="replace", timeout=150)
    named = {"publishing-qa", "node_modules", ".next", "current", "releases", "incoming", ".deploy",
             "logs", "ops-recovery", ".git", ".pnpm-store", "artifacts", "public"}
    groups = {}
    for line in p.stdout.splitlines():
        amount, sep, full = line.partition("\t")
        if not sep or not amount.isdecimal():
            continue
        rel = Path(full).relative_to(stage)
        if not rel.parts:
            continue
        if rel.parts[0] == "publishing-qa" and len(rel.parts) == 2:
            key = "QA source snapshots" if re.fullmatch(r"source-[a-f0-9]{64}", rel.parts[1]) else f"QA {rel.parts[1]}" if rel.parts[1] in named else "QA other"
        elif len(rel.parts) == 1:
            key = rel.parts[0] if rel.parts[0] in named else "other staging"
        else:
            continue
        groups[key] = groups.get(key, 0) + int(amount)
    print(json.dumps({**scan, "largestLogs": sorted(leaders, key=lambda row: -row["allocatedBytes"])[:15],
                      "stagingGroups": groups, "stagingScanComplete": p.returncode == 0}, sort_keys=True))


if __name__ == "__main__":
    main()
