#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# install-db-backup-cron.sh
# Installs the nightly pg_dump + DO Spaces upload cron job on the droplet.
#
# Run once from the Replit workspace (after the DO deploy script has run at
# least once and .env.local is already present on the server).
#
# Required Replit secrets / env vars (same as deploy-to-do.sh):
#   DO_SSH_PRIVATE_KEY, DO_HOST
# Optional:
#   DO_USER  (default: root)
#   DO_PORT  (default: 22)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

: "${DO_SSH_PRIVATE_KEY:?DO_SSH_PRIVATE_KEY secret is missing}"
: "${DO_HOST:?DO_HOST env var is missing}"
: "${DO_SSH_HOST_FINGERPRINT:?DO_SSH_HOST_FINGERPRINT pin is missing}"

DO_USER="${DO_USER:-root}"
DO_PORT="${DO_PORT:-22}"
SCRIPT_SRC="$(dirname "$0")/db-backup.sh"
REMOTE_SCRIPT="/usr/local/bin/citefi-db-backup.sh"
CRON_FILE="/etc/cron.d/citefi-db-backup"
LOG_FILE="/var/log/citefi-db-backup.log"

[[ -f "$SCRIPT_SRC" ]] || { echo "ERROR: ${SCRIPT_SRC} not found"; exit 1; }

# ── SSH key setup (same technique as deploy-to-do.sh) ────────────────────────
mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
KEY="$HOME/.ssh/id_do_deploy"
python3 - <<'PYEOF' > "$KEY"
import os, re, sys
raw = os.environ["DO_SSH_PRIVATE_KEY"]
if "\n" in raw:
    sys.stdout.write(raw if raw.endswith("\n") else raw + "\n")
else:
    raw = re.sub(r"-----BEGIN ([^-]+)-----\s*", r"-----BEGIN \1-----\n", raw)
    raw = re.sub(r"\s*-----END ([^-]+)-----", r"\n-----END \1-----\n", raw)
    lines = raw.split("\n")
    out = []
    for line in lines:
        if "-----" in line:
            out.append(line)
        else:
            out.extend(line.split())
    sys.stdout.write("\n".join(out) + "\n")
PYEOF
chmod 600 "$KEY"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KNOWN_HOSTS_FILE="$HOME/.ssh/known_hosts" "$SCRIPT_DIR/verify-ssh-host-key.sh"

SSH_OPTS=(
  -i "$KEY"
  -p "$DO_PORT"
  -o BatchMode=yes
  -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=yes
  -o UserKnownHostsFile="$HOME/.ssh/known_hosts"
  -o ConnectTimeout=15
)

echo "Installing DB backup cron on ${DO_USER}@${DO_HOST}..."

# ── Step 1: Upload the backup script ─────────────────────────────────────────
echo "  Uploading backup script to ${REMOTE_SCRIPT}..."
ssh "${SSH_OPTS[@]}" "${DO_USER}@${DO_HOST}" "cat > '${REMOTE_SCRIPT}'" < "$SCRIPT_SRC"
ssh "${SSH_OPTS[@]}" "${DO_USER}@${DO_HOST}" "chmod 755 '${REMOTE_SCRIPT}'"
echo "  ✓ Backup script installed"

# ── Step 2: Server-side setup (AWS CLI, log file, cron, smoke-test) ──────────
ssh "${SSH_OPTS[@]}" "${DO_USER}@${DO_HOST}" \
  "REMOTE_SCRIPT='${REMOTE_SCRIPT}' LOG_FILE='${LOG_FILE}' CRON_FILE='${CRON_FILE}' bash -s" <<'REMOTE'
set -euo pipefail

ENV_FILE="/var/www/citefi/.env.local"

# ── Ensure AWS CLI is installed ───────────────────────────────────────────────
# The backup commands only need the stable `aws s3` interface, which is provided
# by both distro AWS CLI packages and AWS CLI v2. Prefer the distribution's
# signed package repository. The zip fallback is deliberately version- and
# digest-pinned: never execute an archive downloaded from the network before its
# independently recorded SHA-256 is checked.
if ! command -v aws &>/dev/null; then
  echo "  Installing AWS CLI from the system package manager..."
  installed_from_package_manager=false
  if command -v apt-get &>/dev/null; then
    if DEBIAN_FRONTEND=noninteractive apt-get install -y awscli >/dev/null 2>&1; then
      installed_from_package_manager=true
    fi
  elif command -v dnf &>/dev/null; then
    if dnf install -y awscli >/dev/null 2>&1; then
      installed_from_package_manager=true
    fi
  elif command -v yum &>/dev/null; then
    if yum install -y awscli >/dev/null 2>&1; then
      installed_from_package_manager=true
    fi
  elif command -v apk &>/dev/null; then
    if apk add --no-interactive aws-cli >/dev/null 2>&1; then
      installed_from_package_manager=true
    fi
  elif command -v nix &>/dev/null; then
    if nix profile install nixpkgs#awscli2 >/dev/null 2>&1; then
      export PATH="$HOME/.nix-profile/bin:$PATH"
      installed_from_package_manager=true
    fi
  fi

  if ! "$installed_from_package_manager" || ! command -v aws &>/dev/null; then
    echo "  System AWS CLI package unavailable; installing verified AWS CLI v2 fallback..."
    # AWS CLI v2.17.63 official archive digests, recorded independently at
    # review time. Update the URL and its matching digest together.
    AWS_CLI_VERSION="2.17.63"
    case "$(uname -m)" in
      x86_64)
        AWS_ARCH="x86_64"
        AWS_CLI_SHA256="c522b373953885eacad54eb5fde5e2696ad9321d02d66b23144d9e91413f9e04"
        ;;
      aarch64)
        AWS_ARCH="aarch64"
        AWS_CLI_SHA256="8e9e699f25a85495d84329a400b79baa67e50c96412544e79ac305ced2227871"
        ;;
      *)
        echo "  ✗ FAIL: no verified AWS CLI fallback for architecture $(uname -m)" >&2
        exit 1
        ;;
    esac
    AWS_URL="https://awscli.amazonaws.com/awscli-exe-linux-${AWS_ARCH}-${AWS_CLI_VERSION}.zip"
    AWS_TMPDIR="$(mktemp -d)"
    trap 'rm -rf "$AWS_TMPDIR"' EXIT
    AWS_ARCHIVE="${AWS_TMPDIR}/awscliv2.zip"
    curl --fail --location --silent --show-error "$AWS_URL" -o "$AWS_ARCHIVE"
    if ! printf '%s  %s\n' "$AWS_CLI_SHA256" "$AWS_ARCHIVE" | sha256sum -c -; then
      echo "  ✗ FAIL: AWS CLI archive checksum mismatch; refusing to unzip or install it" >&2
      exit 1
    fi
    unzip -q "$AWS_ARCHIVE" -d "$AWS_TMPDIR"
    "${AWS_TMPDIR}/aws/install" --update
    rm -rf "$AWS_TMPDIR"
    trap - EXIT
  fi

  if ! command -v aws &>/dev/null; then
    echo "  ✗ FAIL: AWS CLI installation did not provide an aws executable" >&2
    exit 1
  fi
  echo "  ✓ AWS CLI installed: $(aws --version)"
else
  echo "  ✓ AWS CLI already present: $(aws --version 2>&1 | head -1)"
fi

# ── Ensure pg_dump is available — hard fail if absent and cannot install ──────
if command -v pg_dump &>/dev/null; then
  echo "  ✓ pg_dump found: $(pg_dump --version | head -1)"
else
  echo "  pg_dump not found — attempting to install postgresql-client..."
  # Match the client version to whatever PostgreSQL server is installed
  PG_VER="$(ls /usr/lib/postgresql/ 2>/dev/null | sort -rV | head -1 || echo "")"
  PKG="postgresql-client${PG_VER:+-${PG_VER}}"
  if apt-get install -y "$PKG" >/dev/null 2>&1 && command -v pg_dump &>/dev/null; then
    echo "  ✓ Installed ${PKG}: $(pg_dump --version | head -1)"
  else
    echo "  ✗  FAIL: pg_dump is not available and could not be installed automatically." >&2
    echo "     Install it manually: apt-get install -y postgresql-client-16" >&2
    echo "     Then re-run this installer." >&2
    exit 1
  fi
fi

# ── Create log file ───────────────────────────────────────────────────────────
touch "$LOG_FILE"
chmod 640 "$LOG_FILE"
echo "  ✓ Log file ready at ${LOG_FILE}"

# ── Install cron job (runs at 02:05 UTC daily) ────────────────────────────────
cat > "$CRON_FILE" << CRONEOF
# Nightly citefi database backup to DO Spaces
# Retention: 7 daily + 4 weekly snapshots (pruned automatically)
# See: /var/www/citefi/docs/db-backup-runbook.md
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
5 2 * * * root ${REMOTE_SCRIPT} >> ${LOG_FILE} 2>&1
CRONEOF
chmod 644 "$CRON_FILE"
echo "  ✓ Cron installed at ${CRON_FILE} (runs daily at 02:05 UTC)"

# ── Verify cron daemon is active ─────────────────────────────────────────────
if systemctl is-active --quiet cron 2>/dev/null || systemctl is-active --quiet crond 2>/dev/null; then
  echo "  ✓ Cron daemon is running"
else
  echo "  ⚠  Cron daemon not detected via systemctl; check 'service cron status'"
fi

# ── Authenticated DO Spaces smoke-test ───────────────────────────────────────
# Loads credentials from .env.local and performs a real S3 API call.
# Fails the install if credentials are absent or rejected.
echo "  Running authenticated DO Spaces smoke-test..."

if [[ ! -f "$ENV_FILE" ]]; then
  echo "  ✗  FAIL: ${ENV_FILE} not found — add it before relying on backups" >&2
  exit 1
fi

_load_var() {
  local var="$1"
  grep -E "^${var}=" "$ENV_FILE" | head -1 | sed "s/^${var}=//" | sed 's/[[:space:]]*#.*//' | tr -d "'\""
}

SPACES_KEY="$(_load_var DO_SPACES_KEY)"
SPACES_SECRET="$(_load_var DO_SPACES_SECRET)"
SPACES_ENDPOINT="$(_load_var DO_SPACES_ENDPOINT)"
SPACES_BUCKET="$(_load_var DO_SPACES_BUCKET)"
DB_URL="$(_load_var DATABASE_URL)"

MISSING=()
[[ -z "$SPACES_KEY"      ]] && MISSING+=("DO_SPACES_KEY")
[[ -z "$SPACES_SECRET"   ]] && MISSING+=("DO_SPACES_SECRET")
[[ -z "$SPACES_ENDPOINT" ]] && MISSING+=("DO_SPACES_ENDPOINT")
[[ -z "$SPACES_BUCKET"   ]] && MISSING+=("DO_SPACES_BUCKET")
[[ -z "$DB_URL"          ]] && MISSING+=("DATABASE_URL")

if [[ ${#MISSING[@]} -gt 0 ]]; then
  echo "  ✗  FAIL: .env.local is missing required vars: ${MISSING[*]}" >&2
  echo "     Add them and re-run this installer." >&2
  exit 1
fi

# Perform a real authenticated S3 ListObjectsV2 call to db-backups/ prefix.
# This validates key/secret/endpoint/bucket in one shot.
export AWS_ACCESS_KEY_ID="$SPACES_KEY"
export AWS_SECRET_ACCESS_KEY="$SPACES_SECRET"
export AWS_DEFAULT_REGION="us-east-1"

if aws s3 ls "s3://${SPACES_BUCKET}/db-backups/" \
     --endpoint-url "$SPACES_ENDPOINT" \
     >/dev/null 2>&1; then
  echo "  ✓ DO Spaces credentials valid — bucket accessible"
else
  echo "  ✗  FAIL: DO Spaces authentication failed. Check DO_SPACES_KEY/SECRET/ENDPOINT/BUCKET in .env.local" >&2
  exit 1
fi

echo "  ✓ DATABASE_URL present (target: ${DB_URL%%@*}@...)"
echo ""
echo "  All checks passed."
REMOTE

echo ""
echo "✓ Installation complete."
echo ""
echo "  Monitor:       ssh ${DO_USER}@${DO_HOST} 'tail -f /var/log/citefi-db-backup.log'"
echo "  Manual run:    ssh ${DO_USER}@${DO_HOST} '/usr/local/bin/citefi-db-backup.sh'"
echo "  Restore docs:  docs/db-backup-runbook.md"
