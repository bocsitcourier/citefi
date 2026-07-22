#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
# Citefi — Digital Ocean Droplet Setup + Deployment Script
#
# Run this once on a fresh Ubuntu 22.04 droplet:
#   curl -sL https://raw.githubusercontent.com/YOUR_ORG/citefi/main/deploy.sh | sudo bash
#
# Or clone the repo first and run:
#   chmod +x deploy.sh && sudo ./deploy.sh
# ════════════════════════════════════════════════════════════════════
set -euo pipefail

APP_DIR="/var/www/citefi"
APP_USER="citefi"
LOG_DIR="/var/log/citefi"
DOMAIN="${DOMAIN:-yourdomain.com}"           # override: DOMAIN=mysite.com ./deploy.sh
GITHUB_REPO="${GITHUB_REPO:-}"              # e.g. git@github.com:yourorg/citefi.git
NODE_VERSION="22"                           # LTS

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   Citefi — Digital Ocean Setup Script   ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── 1. System packages ────────────────────────────────────────────
echo "[1/8] Installing system dependencies..."
apt-get update -qq
apt-get install -y -qq \
  curl git nginx certbot python3-certbot-nginx \
  ffmpeg build-essential ca-certificates gnupg

# ── 2. Node.js via NodeSource ─────────────────────────────────────
echo "[2/8] Installing Node.js ${NODE_VERSION}..."
if ! command -v node &>/dev/null || [[ "$(node -e 'process.stdout.write(process.version.split(\".\")[0].replace(\"v\",\"\"))')" != "${NODE_VERSION}" ]]; then
  curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
  apt-get install -y nodejs
fi
echo "    Node $(node -v) / npm $(npm -v)"

# tsx (TypeScript runner) + PM2 (process manager) globally
npm install -g tsx pm2 2>/dev/null

# ── 3. Create app user ────────────────────────────────────────────
echo "[3/8] Creating app user '${APP_USER}'..."
id "${APP_USER}" &>/dev/null || useradd --system --create-home --shell /bin/bash "${APP_USER}"
mkdir -p "${APP_DIR}" "${LOG_DIR}"
chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}" "${LOG_DIR}"

# ── 4. Clone / pull repository ────────────────────────────────────
echo "[4/8] Deploying application code..."
if [[ -n "${GITHUB_REPO}" ]]; then
  if [[ -d "${APP_DIR}/.git" ]]; then
    echo "    Pulling latest from ${GITHUB_REPO}..."
    sudo -u "${APP_USER}" git -C "${APP_DIR}" pull
  else
    echo "    Cloning ${GITHUB_REPO}..."
    sudo -u "${APP_USER}" git clone "${GITHUB_REPO}" "${APP_DIR}"
  fi
else
  echo "    GITHUB_REPO not set — skipping git clone."
  echo "    Manually copy your code to ${APP_DIR} and re-run from step 5."
fi

# ── 5. Install dependencies + build ──────────────────────────────
echo "[5/8] Installing npm dependencies..."
sudo -u "${APP_USER}" bash -c "cd ${APP_DIR} && npm ci --production=false"

echo "    Building Next.js..."
sudo -u "${APP_USER}" bash -c "cd ${APP_DIR} && npm run build"

# ── 6. Environment file ───────────────────────────────────────────
echo "[6/8] Environment file check..."
if [[ ! -f "${APP_DIR}/.env.local" ]]; then
  echo ""
  echo "  ⚠️  No .env.local found at ${APP_DIR}/.env.local"
  echo "  Copy .env.example → .env.local and fill in your values:"
  echo ""
  echo "    sudo cp ${APP_DIR}/.env.example ${APP_DIR}/.env.local"
  echo "    sudo nano ${APP_DIR}/.env.local"
  echo "    sudo chown ${APP_USER}:${APP_USER} ${APP_DIR}/.env.local"
  echo ""
  echo "  Then restart with: sudo -u ${APP_USER} pm2 restart citefi"
fi

# ── 7. PM2 process manager ────────────────────────────────────────
echo "[7/8] Starting app with PM2..."
sudo -u "${APP_USER}" bash -c "cd ${APP_DIR} && pm2 start ecosystem.config.js --env production"
sudo -u "${APP_USER}" pm2 save
# Make PM2 start on boot
pm2 startup systemd -u "${APP_USER}" --hp "/home/${APP_USER}" | tail -1 | bash

# ── 8. Nginx ──────────────────────────────────────────────────────
echo "[8/8] Configuring Nginx..."
sed "s/yourdomain.com/${DOMAIN}/g" "${APP_DIR}/nginx.conf" \
  > /etc/nginx/sites-available/citefi

if [[ ! -L /etc/nginx/sites-enabled/citefi ]]; then
  ln -s /etc/nginx/sites-available/citefi /etc/nginx/sites-enabled/citefi
fi
rm -f /etc/nginx/sites-enabled/default

nginx -t && systemctl reload nginx
echo "    Nginx configured for ${DOMAIN}"

# ── Done ──────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════╗"
echo "║               Setup complete!            ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "Next steps:"
echo "  1. Add your DNS A record:  ${DOMAIN} → $(curl -s ifconfig.me 2>/dev/null || echo '<droplet-ip>')"
echo "  2. Fill in secrets:        sudo nano ${APP_DIR}/.env.local"
echo "  3. Enable HTTPS:           sudo certbot --nginx -d ${DOMAIN} -d www.${DOMAIN}"
echo "  4. Restart the app:        sudo -u ${APP_USER} pm2 restart citefi"
echo ""
echo "Useful commands:"
echo "  View logs:   sudo -u ${APP_USER} pm2 logs citefi"
echo "  Status:      sudo -u ${APP_USER} pm2 status"
echo "  Restart:     sudo -u ${APP_USER} pm2 restart citefi"
echo "  Redeploy:    sudo -u ${APP_USER} bash -c 'cd ${APP_DIR} && git pull && npm ci && npm run build && pm2 restart citefi'"
echo ""
