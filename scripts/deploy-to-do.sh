#!/usr/bin/env bash
# Deploy latest code to a DigitalOcean droplet via SSH.
#
# The server must already have:
#   - Node.js, npm, PM2 installed
#   - The repo cloned at DO_APP_DIR with GitHub HTTPS access
#   - .env.local present at DO_APP_DIR/.env.local (NEVER in git)
#   - ecosystem.config.cjs present (tracked in git)
#
# Required env vars : DO_SSH_PRIVATE_KEY (Replit secret), DO_HOST
# Optional env vars : DO_USER (default: citefi), DO_PORT (default: 22),
#                     DO_APP_DIR (default: /var/www/citefi),
#                     DO_BRANCH (default: main),
#                     DO_PM2_CONFIG (default: ecosystem.config.cjs),
#                     DO_HEALTHCHECK_URL (default: http://127.0.0.1:5000/api/health)
set -euo pipefail

: "${DO_SSH_PRIVATE_KEY:?DO_SSH_PRIVATE_KEY secret is missing — add it in Replit Secrets}"
: "${DO_HOST:?DO_HOST env var is missing — add it in Replit}"

DO_USER="${DO_USER:-citefi}"
DO_PORT="${DO_PORT:-22}"
DO_APP_DIR="${DO_APP_DIR:-/var/www/citefi}"
DO_BRANCH="${DO_BRANCH:-main}"
DO_PM2_CONFIG="${DO_PM2_CONFIG:-ecosystem.config.cjs}"
DO_HEALTHCHECK_URL="${DO_HEALTHCHECK_URL:-http://127.0.0.1:5000/api/health}"

# ── SSH key setup ─────────────────────────────────────────────────────────────
mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
KEY="$HOME/.ssh/id_do_deploy"
# Replit stores multi-line secrets with spaces instead of newlines — reconstruct proper PEM.
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

ssh-keyscan -p "$DO_PORT" -H "$DO_HOST" >> "$HOME/.ssh/known_hosts" 2>/dev/null || true

SSH_OPTS=(
  -i "$KEY"
  -p "$DO_PORT"
  -o BatchMode=yes
  -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=yes
  -o ConnectTimeout=15
)

echo "Deploying to ${DO_USER}@${DO_HOST}:${DO_APP_DIR} (branch: ${DO_BRANCH})"
echo ""

# ── Remote deploy ─────────────────────────────────────────────────────────────
ssh "${SSH_OPTS[@]}" "${DO_USER}@${DO_HOST}" \
  "DO_APP_DIR='${DO_APP_DIR}' DO_BRANCH='${DO_BRANCH}' DO_PM2_CONFIG='${DO_PM2_CONFIG}' DO_HEALTHCHECK_URL='${DO_HEALTHCHECK_URL}' bash -s" <<'REMOTE'
set -euo pipefail

cd "$DO_APP_DIR"
test -d .git || { echo "ERROR: $DO_APP_DIR is not a git repo"; exit 1; }

# ── Preflight: require .env.local ──────────────────────────────────────────
if [[ ! -f .env.local ]]; then
  echo ""
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║  DEPLOY BLOCKED: .env.local is missing from the server      ║"
  echo "║                                                              ║"
  echo "║  Create it at: ${DO_APP_DIR}/.env.local                     ║"
  echo "║  It must contain DATABASE_URL, NEXTAUTH_SECRET, and all     ║"
  echo "║  other secrets the app needs to start.                      ║"
  echo "╚══════════════════════════════════════════════════════════════╝"
  echo ""
  exit 1
fi

# ── Required env-var smoke-test ───────────────────────────────────────────
REQUIRED_VARS=(DATABASE_URL JWT_SECRET)
MISSING=()
for var in "${REQUIRED_VARS[@]}"; do
  grep -q "^${var}=" .env.local 2>/dev/null || MISSING+=("$var")
done
if [[ ${#MISSING[@]} -gt 0 ]]; then
  echo "ERROR: .env.local is missing required keys: ${MISSING[*]}"
  exit 1
fi
echo "✓ .env.local present and keys verified"

# ── Git update ────────────────────────────────────────────────────────────
OLD_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo none)"
echo "  Current: ${OLD_SHA}"

git fetch origin "${DO_BRANCH}"
# Reset tracked files to match remote exactly — does NOT touch untracked files
git reset --hard "origin/${DO_BRANCH}"

NEW_SHA="$(git rev-parse --short HEAD)"
echo "  Updated: ${OLD_SHA} -> ${NEW_SHA}"
echo ""

# ── Build ─────────────────────────────────────────────────────────────────
# Always build if .next is missing, even if SHA didn't change (e.g. after server wipe)
NEEDS_BUILD=false
if [[ "$OLD_SHA" != "$NEW_SHA" ]]; then
  echo "Code changed — running full install + build."
  NEEDS_BUILD=true
elif [[ ! -d .next ]] || [[ ! -f .next/BUILD_ID ]]; then
  echo ".next missing or incomplete (no BUILD_ID) — forcing build despite no code change."
  NEEDS_BUILD=true
elif [[ ! -d node_modules ]]; then
  echo "node_modules missing — running install + build."
  NEEDS_BUILD=true
fi

if [[ "$NEEDS_BUILD" == "true" ]]; then
  echo "Installing dependencies..."
  # package-lock.json may contain Replit's internal proxy URLs — patch them before npm ci
  if grep -q "package-firewall.replit.local" package-lock.json 2>/dev/null; then
    echo "  Patching package-lock.json Replit proxy URLs -> public registry..."
    sed -i 's|http://package-firewall\.replit\.local/npm|https://registry.npmjs.org|g' package-lock.json
  fi
  npm ci --registry https://registry.npmjs.org
  # Restore lock file so git doesn't see a dirty tree
  git checkout -- package-lock.json 2>/dev/null || true

  echo "Building... (stopping PM2 first to free RAM on 2GB droplet)"
  pm2 stop all 2>/dev/null || true
  NODE_OPTIONS="--max-old-space-size=1700" npm run build
  echo "Build complete."
else
  echo "Build artifacts present and code unchanged — skipping build."
fi

# ── PM2 reload ────────────────────────────────────────────────────────────
echo "Reloading PM2..."
# Capture restart counts BEFORE reload so we can detect crash-loops after
WEB_RESTARTS_BEFORE=$(pm2 jlist 2>/dev/null | python3 -c "
import json,sys
procs = json.load(sys.stdin)
for p in procs:
    if p.get('name') == 'citefi-web':
        print(p.get('pm2_env',{}).get('restart_time',0))
" 2>/dev/null || echo "0")

pm2 startOrReload "$DO_PM2_CONFIG" --update-env 2>/dev/null \
  || pm2 restart all --update-env

# ── Health check with crash-loop detection ───────────────────────────────
echo ""
echo "Health check (waiting up to 45s)..."
PASSED=false
for i in $(seq 1 15); do
  sleep 3
  if curl -fsS --max-time 5 "$DO_HEALTHCHECK_URL" >/dev/null 2>&1; then
    echo "✓ Health check passed (attempt ${i})."
    PASSED=true
    break
  fi
  if [[ $i -eq 15 ]]; then
    echo ""
    echo "ERROR: Health check failed after 45s at $DO_HEALTHCHECK_URL"
    echo ""
    echo "── PM2 process list ──────────────────────────────────────────"
    pm2 list
    echo ""
    echo "── citefi-web logs (last 40 lines) ──────────────────────────"
    pm2 logs citefi-web --lines 40 --nostream 2>/dev/null || true
    echo ""
    echo "── Port 5000 listener check ──────────────────────────────────"
    ss -ltnp sport = :5000 2>/dev/null || netstat -tlnp 2>/dev/null | grep ':5000' || echo "(nothing on port 5000)"
    exit 1
  fi
  # Crash-loop early warning after 3 attempts
  if [[ $i -eq 3 ]]; then
    WEB_RESTARTS_NOW=$(pm2 jlist 2>/dev/null | python3 -c "
import json,sys
procs = json.load(sys.stdin)
for p in procs:
    if p.get('name') == 'citefi-web':
        print(p.get('pm2_env',{}).get('restart_time',0))
" 2>/dev/null || echo "0")
    if [[ "$WEB_RESTARTS_NOW" -gt "$WEB_RESTARTS_BEFORE" ]]; then
      echo "  ⚠ citefi-web is crash-looping (restarts: ${WEB_RESTARTS_BEFORE} → ${WEB_RESTARTS_NOW})"
      echo "  ── citefi-web error log (last 20 lines) ──"
      pm2 logs citefi-web --lines 20 --nostream 2>/dev/null || true
    fi
  fi
  echo "  Waiting... (attempt ${i})"
done

echo ""
echo "✓ Deployed ${NEW_SHA} successfully."
REMOTE

echo ""
echo "Done. Live at: http://${DO_HOST}"
