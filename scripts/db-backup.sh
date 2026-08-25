#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# db-backup.sh — nightly pg_dump → compress → DO Spaces upload → prune
#
# Designed to run as root on the DigitalOcean droplet via cron:
#   5 2 * * * root /usr/local/bin/citefi-db-backup.sh >> /var/log/citefi-db-backup.log 2>&1
#
# All credentials are read from the app's .env.local (single source of truth):
#   DATABASE_URL       — pg_dump connection target (postgresql://user:pass@host:port/db)
#   DO_SPACES_KEY      — DO Spaces / S3-compatible access key
#   DO_SPACES_SECRET   — DO Spaces / S3-compatible secret key
#   DO_SPACES_ENDPOINT — e.g. https://nyc3.digitaloceanspaces.com
#   DO_SPACES_BUCKET   — bucket name
#
# Retention policy (enforced after every upload):
#   - Keep the 7 most-recent daily snapshots.
#   - Track which ISO calendar weeks the daily set already covers.
#   - Then keep one representative per week for up to 4 ADDITIONAL distinct
#     ISO weeks not already represented in the daily set (i.e. genuinely older
#     historical snapshots — typically 2–5+ weeks back).
#   - Delete everything else.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ENV_FILE="${BACKUP_ENV_FILE:-/var/www/citefi/.env.local}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/citefi-db}"
SPACES_PREFIX="${BACKUP_SPACES_PREFIX:-db-backups}"
LOG_PREFIX="[$(date -u +%FT%TZ)]"
STATUS_FILE="${BACKUP_STATUS_FILE:-${BACKUP_DIR}/status.json}"

# Atomic status updates let the health endpoint read this file while cron is
# writing it, without ever observing partial JSON. Do not include credentials
# or raw command output in this operational signal.
write_status() {
  local state="$1"
  local message="$2"
  local tmp="${STATUS_FILE}.tmp.$$"
  mkdir -p "$(dirname "$STATUS_FILE")"
  printf '{"state":"%s","timestamp":"%s","message":"%s"}\n' \
    "$state" "$(date -u +%FT%TZ)" "$message" > "$tmp"
  chmod 0644 "$tmp"
  mv -f "$tmp" "$STATUS_FILE"
}

backup_failed() {
  local exit_code=$?
  trap - ERR
  write_status "failed" "Backup command failed"
  exit "$exit_code"
}
trap backup_failed ERR

# ── Load credentials from the app's .env.local ───────────────────────────────
if [[ ! -f "$ENV_FILE" ]]; then
  echo "${LOG_PREFIX} ERROR: ${ENV_FILE} not found" >&2
  exit 1
fi

_load_var() {
  # Extract value for KEY= from .env.local; strips inline comments and quotes.
  local var="$1"
  grep -E "^${var}=" "$ENV_FILE" | head -1 \
    | sed "s/^${var}=//" \
    | sed 's/[[:space:]]*#.*//' \
    | tr -d "'\""
}

DATABASE_URL="$(_load_var DATABASE_URL)"
DO_SPACES_KEY="$(_load_var DO_SPACES_KEY)"
DO_SPACES_SECRET="$(_load_var DO_SPACES_SECRET)"
DO_SPACES_ENDPOINT="$(_load_var DO_SPACES_ENDPOINT)"
DO_SPACES_BUCKET="$(_load_var DO_SPACES_BUCKET)"

: "${DATABASE_URL:?DATABASE_URL missing from ${ENV_FILE}}"
: "${DO_SPACES_KEY:?DO_SPACES_KEY missing from ${ENV_FILE}}"
: "${DO_SPACES_SECRET:?DO_SPACES_SECRET missing from ${ENV_FILE}}"
: "${DO_SPACES_ENDPOINT:?DO_SPACES_ENDPOINT missing from ${ENV_FILE}}"
: "${DO_SPACES_BUCKET:?DO_SPACES_BUCKET missing from ${ENV_FILE}}"

# ── Configure AWS CLI env for this run ───────────────────────────────────────
export AWS_ACCESS_KEY_ID="$DO_SPACES_KEY"
export AWS_SECRET_ACCESS_KEY="$DO_SPACES_SECRET"
export AWS_DEFAULT_REGION="us-east-1"   # required by CLI; ignored by DO Spaces

# ── Create dump ───────────────────────────────────────────────────────────────
TIMESTAMP="$(date -u +%Y%m%d_%H%M%S)"
FILENAME="citefi_${TIMESTAMP}.sql.gz"
LOCAL_PATH="${BACKUP_DIR}/${FILENAME}"

mkdir -p "$BACKUP_DIR"
write_status "running" "Backup in progress"

echo "${LOG_PREFIX} Starting pg_dump (target: ${DATABASE_URL%%@*}@...)..."

# pg_dump accepts a full libpq connection URI via --dbname.
# The password is embedded in DATABASE_URL; no PGPASSWORD needed.
pg_dump \
  --dbname="$DATABASE_URL" \
  --no-owner \
  --no-acl \
  --compress=0 \
  | gzip -9 > "$LOCAL_PATH"

DUMP_SIZE="$(du -sh "$LOCAL_PATH" | cut -f1)"
echo "  Dump written: ${LOCAL_PATH} (${DUMP_SIZE})"

# ── Upload to DO Spaces ───────────────────────────────────────────────────────
SPACES_KEY="${SPACES_PREFIX}/${FILENAME}"
echo "  Uploading to s3://${DO_SPACES_BUCKET}/${SPACES_KEY} ..."
aws s3 cp "$LOCAL_PATH" "s3://${DO_SPACES_BUCKET}/${SPACES_KEY}" \
  --endpoint-url "$DO_SPACES_ENDPOINT" \
  --no-progress \
  --storage-class STANDARD

echo "  Upload complete."

# Remove local copy — the authoritative copy lives in Spaces
rm -f "$LOCAL_PATH"

# ── Prune old backups ─────────────────────────────────────────────────────────
# List all citefi_* filenames under the prefix, sorted newest-first
ALL_BACKUPS="$(aws s3 ls "s3://${DO_SPACES_BUCKET}/${SPACES_PREFIX}/" \
  --endpoint-url "$DO_SPACES_ENDPOINT" \
  | awk '{print $4}' \
  | grep -E '^citefi_[0-9]{8}_[0-9]{6}\.sql\.gz$' \
  | sort -r)"

if [[ -z "$ALL_BACKUPS" ]]; then
  echo "  No backups found to prune (unexpected — just uploaded one)."
  echo "${LOG_PREFIX} Backup complete: ${FILENAME}"
  write_status "success" "Backup uploaded successfully"
  exit 0
fi

# Helper: return ISO year-week (e.g. "2026-W34") for a YYYYMMDD string.
# Tries python3 first (always available on Ubuntu), falls back to GNU date.
iso_week() {
  local ds="$1"
  python3 - <<PYEOF 2>/dev/null || date -d "${ds}" "+%G-W%V" 2>/dev/null || echo ""
import datetime
d = datetime.date(int("${ds}"[0:4]), int("${ds}"[4:6]), int("${ds}"[6:8]))
iso = d.isocalendar()
print(f"{iso[0]}-W{iso[1]:02d}")
PYEOF
}

declare -a KEEP=()
declare -A DAILY_WEEKS=()   # ISO weeks already covered by the daily set
declare -A EXTRA_WEEKS=()   # ISO weeks kept as additional historical snapshots
DAILY_KEPT=0

# ── Pass 1: keep the 7 newest (daily) and record which ISO weeks they span ───
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  DATE_STR="${f#citefi_}"; DATE_STR="${DATE_STR%%_*}"
  [[ ! "$DATE_STR" =~ ^[0-9]{8}$ ]] && continue

  if [[ $DAILY_KEPT -lt 7 ]]; then
    KEEP+=("$f")
    DAILY_KEPT=$((DAILY_KEPT + 1))
    WK="$(iso_week "$DATE_STR")"
    [[ -n "$WK" ]] && DAILY_WEEKS["$WK"]=1
  fi
done < <(echo "$ALL_BACKUPS")

# ── Pass 2: from older backups, keep one per week for up to 4 NEW ISO weeks
#    that are NOT already represented in the daily set. ───────────────────────
while IFS= read -r f; do
  [[ -z "$f" ]] && continue

  # Skip files already in KEEP
  IN_KEEP=false
  for k in "${KEEP[@]}"; do [[ "$f" == "$k" ]] && { IN_KEEP=true; break; }; done
  [[ "$IN_KEEP" == "true" ]] && continue

  DATE_STR="${f#citefi_}"; DATE_STR="${DATE_STR%%_*}"
  [[ ! "$DATE_STR" =~ ^[0-9]{8}$ ]] && continue

  WK="$(iso_week "$DATE_STR")"
  [[ -z "$WK" ]] && continue

  # Accept this backup only if its ISO week is not in the daily set
  # and we haven't already claimed it for the extra weekly set.
  if [[ -z "${DAILY_WEEKS[$WK]:-}" \
        && -z "${EXTRA_WEEKS[$WK]:-}" \
        && ${#EXTRA_WEEKS[@]} -lt 4 ]]; then
    KEEP+=("$f")
    EXTRA_WEEKS["$WK"]=1
  fi
done < <(echo "$ALL_BACKUPS")

# ── Delete anything not in KEEP ───────────────────────────────────────────────
DELETED=0
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  SHOULD_KEEP=false
  for k in "${KEEP[@]}"; do
    [[ "$f" == "$k" ]] && { SHOULD_KEEP=true; break; }
  done
  if [[ "$SHOULD_KEEP" == "false" ]]; then
    aws s3 rm "s3://${DO_SPACES_BUCKET}/${SPACES_PREFIX}/${f}" \
      --endpoint-url "$DO_SPACES_ENDPOINT" > /dev/null
    DELETED=$((DELETED + 1))
    echo "  Pruned: ${f}"
  fi
done < <(echo "$ALL_BACKUPS")

echo "  Retention: kept ${#KEEP[@]} (${DAILY_KEPT} daily + ${#EXTRA_WEEKS[@]} extra weekly), pruned ${DELETED}."
echo "${LOG_PREFIX} Backup complete: ${FILENAME}"
write_status "success" "Backup uploaded successfully"
