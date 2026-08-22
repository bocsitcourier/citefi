# Database Backup & Restore Runbook

## Overview

The production database is backed up nightly to **DO Spaces**. The backup script
reads `DATABASE_URL` from the app's `.env.local` and connects using `pg_dump`'s
native libpq connection-string support — the same connection the application uses.
Dumps are compressed with gzip and uploaded via the AWS CLI.

**Retention policy:**
- 7 most-recent daily snapshots (last 7 nights)
- 1 representative snapshot per ISO-calendar-week for the 4 oldest eligible weeks (≈ 5–11 weeks back)
- Everything older is deleted automatically at the end of each backup run

**Schedule:** `02:05 UTC` every day (cron on the droplet)

---

## Files & Locations

| Item | Path |
|---|---|
| Backup script | `/usr/local/bin/citefi-db-backup.sh` |
| Cron definition | `/etc/cron.d/citefi-db-backup` |
| Backup log | `/var/log/citefi-db-backup.log` |
| DO Spaces prefix | `db-backups/` inside `DO_SPACES_BUCKET` |

---

## Required `.env.local` vars on the droplet

The backup script and installer both read from `/var/www/citefi/.env.local`:

```
DATABASE_URL=postgresql://citefi:<password>@localhost:5432/citefi
DO_SPACES_KEY=<access-key>
DO_SPACES_SECRET=<secret-key>
DO_SPACES_ENDPOINT=https://<region>.digitaloceanspaces.com
DO_SPACES_BUCKET=<bucket-name>
```

These are the same values the application uses for its DB connection and media
uploads, so they should already be present.

---

## Installing / Reinstalling the Cron Job

Run this once from the Replit workspace (after the droplet is live and `.env.local`
is in place):

```bash
bash scripts/install-db-backup-cron.sh
```

This will:
1. Upload `/usr/local/bin/citefi-db-backup.sh` to the droplet
2. Install the AWS CLI v2 if not already present
3. Write `/etc/cron.d/citefi-db-backup` (schedule: 02:05 UTC daily)
4. **Perform an authenticated DO Spaces API call** to confirm credentials work — the installer fails hard if any required var is missing or if the bucket is unreachable

---

## Running a Manual Backup

SSH to the droplet and run:

```bash
/usr/local/bin/citefi-db-backup.sh
```

Or trigger it from Replit (requires `DO_HOST` and `DO_SSH_PRIVATE_KEY` in env):

```bash
bash scripts/install-db-backup-cron.sh   # re-runs the full install + smoke-test
# then on the droplet:
ssh root@<DO_HOST> '/usr/local/bin/citefi-db-backup.sh'
```

---

## Listing Available Backups

```bash
# On the droplet — credentials sourced from .env.local
source <(grep -E '^(DO_SPACES_KEY|DO_SPACES_SECRET|DO_SPACES_ENDPOINT|DO_SPACES_BUCKET)=' \
  /var/www/citefi/.env.local | tr -d "'\"")

AWS_ACCESS_KEY_ID="$DO_SPACES_KEY" \
AWS_SECRET_ACCESS_KEY="$DO_SPACES_SECRET" \
aws s3 ls "s3://${DO_SPACES_BUCKET}/db-backups/" \
  --endpoint-url "$DO_SPACES_ENDPOINT"
```

Example output:
```
2026-08-22 02:05:55  45678901 citefi_20260822_020541.sql.gz
2026-08-21 02:05:38  45432101 citefi_20260821_020538.sql.gz
...
```

---

## Restoring from a Backup

### Step 1 — Load credentials and download the backup

SSH to the droplet, then:

```bash
# Load all relevant vars in one shot
_load() { grep -E "^${1}=" /var/www/citefi/.env.local | head -1 | sed "s/^${1}=//" | tr -d "'\""; }
export DATABASE_URL="$(_load DATABASE_URL)"
export AWS_ACCESS_KEY_ID="$(_load DO_SPACES_KEY)"
export AWS_SECRET_ACCESS_KEY="$(_load DO_SPACES_SECRET)"
DO_SPACES_ENDPOINT="$(_load DO_SPACES_ENDPOINT)"
DO_SPACES_BUCKET="$(_load DO_SPACES_BUCKET)"
export AWS_DEFAULT_REGION="us-east-1"

# Download the specific backup (replace timestamp with the one you want)
aws s3 cp "s3://${DO_SPACES_BUCKET}/db-backups/citefi_YYYYMMDD_HHMMSS.sql.gz" \
  /tmp/restore.sql.gz \
  --endpoint-url "$DO_SPACES_ENDPOINT"
```

### Step 2 — Stop the application

Prevent writes while the restore is in progress:

```bash
pm2 stop all
```

### Step 3 — Extract the database name from DATABASE_URL

```bash
# e.g. DATABASE_URL=postgresql://citefi:pass@localhost:5432/citefi
DB_NAME="${DATABASE_URL##*/}"          # → citefi
DB_HOST="$(echo "$DATABASE_URL" | python3 -c "
import sys
from urllib.parse import urlparse
u = urlparse(sys.stdin.read().strip())
print(u.hostname or 'localhost')
")"
```

### Step 4 — Drop and recreate the database

> ⚠️ **This permanently destroys all current data in the database.** If the current
> state has any value (even partial), take a fresh dump first:
> `/usr/local/bin/citefi-db-backup.sh`

```bash
# Connect as the postgres superuser to recreate the database
sudo -u postgres psql <<SQL
-- Kick out active connections
SELECT pg_terminate_backend(pid)
  FROM pg_stat_activity
  WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid();

DROP DATABASE IF EXISTS ${DB_NAME};
CREATE DATABASE ${DB_NAME};
GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_NAME};
SQL
```

### Step 5 — Restore the dump

```bash
gunzip -c /tmp/restore.sql.gz | psql "$DATABASE_URL"
```

If the database user needs ownership reassigned (dump was made with `--no-owner`):

```bash
sudo -u postgres psql "$DB_NAME" -c "REASSIGN OWNED BY postgres TO ${DB_NAME};"
```

### Step 6 — Verify the restore

```bash
psql "$DATABASE_URL" -c "\dt"                          # list tables
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM users;"  # sanity row count
```

### Step 7 — Restart the application

```bash
cd /var/www/citefi
pm2 startOrReload ecosystem.config.cjs --update-env
```

Then verify at `http://<DO_HOST>/api/health` — confirm `database.ok === true`.

---

## Monitoring

**Check recent backup log:**

```bash
ssh root@<DO_HOST> 'tail -50 /var/log/citefi-db-backup.log'
```

**Confirm last backup ran successfully:**

```bash
ssh root@<DO_HOST> 'grep "Backup complete" /var/log/citefi-db-backup.log | tail -5'
```

Expected output:
```
[2026-08-22T02:05:55Z] Backup complete: citefi_20260822_020541.sql.gz
```

**If a backup is missing** (no line for today's date), investigate:

```bash
ssh root@<DO_HOST> 'grep -i "error\|fail\|missing" /var/log/citefi-db-backup.log | tail -20'
# Also try a manual run to see the exact error:
ssh root@<DO_HOST> '/usr/local/bin/citefi-db-backup.sh'
```

Common causes:

| Symptom | Fix |
|---|---|
| `DO_SPACES_KEY missing` | Add `DO_SPACES_KEY=...` to `/var/www/citefi/.env.local` |
| `aws: command not found` | Re-run `bash scripts/install-db-backup-cron.sh` to install AWS CLI |
| `authentication failed` | DO Spaces key rotated — update `.env.local` |
| `pg_dump: error: connection...` | `DATABASE_URL` wrong or DB not running (`systemctl status postgresql`) |
| Cron not running | `systemctl status cron` / `service cron status` |
