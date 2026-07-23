#!/usr/bin/env bash
# Deploy latest code to a DigitalOcean droplet via SSH.
#
# The server must already have:
#   - Node.js, npm, PM2 installed
#   - The repo cloned and GitHub access configured
#   - An ecosystem.config.cjs (or ecosystem.config.js) for PM2
#
# Required Replit Secrets: DO_SSH_PRIVATE_KEY, DO_HOST
# Optional Replit Secrets: DO_USER (default: deploy), DO_PORT (default: 22),
#   DO_APP_DIR (default: /var/www/citefi), DO_PM2_CONFIG (default: ecosystem.config.cjs),
#   DO_HEALTHCHECK_URL (default: http://127.0.0.1:5000/api/health)
set -euo pipefail

: "${DO_SSH_PRIVATE_KEY:?DO_SSH_PRIVATE_KEY secret is missing — add it in Replit Secrets}"
: "${DO_HOST:?DO_HOST secret is missing — add your droplet IP/hostname in Replit Secrets}"

DO_USER="${DO_USER:-deploy}"
DO_PORT="${DO_PORT:-22}"
DO_APP_DIR="${DO_APP_DIR:-/var/www/citefi}"
DO_BRANCH="${DO_BRANCH:-main}"
DO_PM2_CONFIG="${DO_PM2_CONFIG:-ecosystem.config.cjs}"
DO_HEALTHCHECK_URL="${DO_HEALTHCHECK_URL:-http://127.0.0.1:5000/api/health}"

# ── SSH key setup ─────────────────────────────────────────────────────────────
mkdir -p "$HOME/.ssh" && chmod 700 "$HOME/.ssh"
KEY="$HOME/.ssh/id_do_deploy"
printf '%s\n' "$DO_SSH_PRIVATE_KEY" > "$KEY"
chmod 600 "$KEY"

# Accept host key on first run
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

OLD_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo none)"
echo "  Current: ${OLD_SHA}"

git fetch origin "${DO_BRANCH}"
git pull --ff-only origin "${DO_BRANCH}"

NEW_SHA="$(git rev-parse --short HEAD)"
echo "  Updated: ${OLD_SHA} -> ${NEW_SHA}"
echo ""

if [[ "$OLD_SHA" == "$NEW_SHA" ]]; then
  echo "Already up to date — skipping build."
else
  echo "Installing dependencies..."
  npm ci --prefer-offline

  echo "Building..."
  npm run build
fi

echo "Reloading PM2..."
pm2 startOrReload "$DO_PM2_CONFIG" --update-env 2>/dev/null \
  || pm2 restart all --update-env

echo "Health check..."
sleep 3
curl -fsS "$DO_HEALTHCHECK_URL" >/dev/null \
  && echo "Health check passed." \
  || { echo "ERROR: Health check failed at $DO_HEALTHCHECK_URL"; exit 1; }

echo ""
echo "✓ Deployed ${NEW_SHA} successfully."
REMOTE

echo ""
echo "Done. Live at: http://${DO_HOST}"
