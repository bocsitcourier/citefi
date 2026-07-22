#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════
# Citefi — Digital Ocean Ubuntu 22.04/24.04 Droplet Setup Script
#
# Quick start (public repo):
#   export DOMAIN=yourdomain.com
#   export GITHUB_REPO=https://github.com/yourorg/citefi.git
#   curl -sL https://raw.githubusercontent.com/yourorg/citefi/main/deploy.sh | sudo bash
#
# Private repo — set up a Deploy Key first (see step 4 notes), then:
#   export DOMAIN=yourdomain.com
#   export GITHUB_REPO=git@github.com:yourorg/citefi.git
#   sudo bash deploy.sh
#
# Re-deploy after a git push:
#   sudo -u citefi bash -c 'cd /var/www/citefi && git pull && npm ci && npm run check && npm run build && pm2 restart all'
# ════════════════════════════════════════════════════════════════════
set -euo pipefail

APP_DIR="/var/www/citefi"
APP_USER="citefi"
LOG_DIR="/var/log/citefi"
DOMAIN="${DOMAIN:-yourdomain.com}"
GITHUB_REPO="${GITHUB_REPO:-}"
NODE_VERSION="22"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   Citefi — Digital Ocean Setup Script   ║"
echo "╚══════════════════════════════════════════╝"
echo ""

if [[ "$EUID" -ne 0 ]]; then
  echo "❌  Run this script as root (sudo ./deploy.sh)"
  exit 1
fi

# ── 0. Swap (prevents OOM during npm run build on small droplets) ─
echo "[0/9] Ensuring swap space..."
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "    2 GB swap created"
else
  echo "    Swap already configured"
fi

# ── 1. System packages ────────────────────────────────────────────
echo "[1/9] Installing system dependencies..."
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  curl git nginx certbot python3-certbot-nginx \
  ffmpeg build-essential ca-certificates gnupg \
  fail2ban ufw unattended-upgrades

# ── 2. Node.js (NodeSource) ───────────────────────────────────────
echo "[2/9] Installing Node.js ${NODE_VERSION}..."
NODE_INSTALLED_MAJOR=$(node --version 2>/dev/null | sed 's/v\([0-9]*\).*/\1/' || echo "0")
if [[ "$NODE_INSTALLED_MAJOR" -lt "$NODE_VERSION" ]]; then
  curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
  apt-get install -y nodejs
fi
echo "    Node $(node -v) / npm $(npm -v)"

npm install -g tsx pm2

# ── 3. Firewall ───────────────────────────────────────────────────
echo "[3/9] Configuring firewall (ufw)..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
echo "    ufw enabled — SSH + HTTP/HTTPS open, port 5000 closed to internet"

# ── 4. fail2ban ───────────────────────────────────────────────────
echo "[4/9] Enabling fail2ban..."
systemctl enable fail2ban --now

# ── 5. Automatic security updates ────────────────────────────────
echo "[5/9] Enabling unattended-upgrades..."
dpkg-reconfigure -plow unattended-upgrades 2>/dev/null || true

# ── 6. App user + directories ─────────────────────────────────────
echo "[6/9] Creating app user '${APP_USER}'..."
id "${APP_USER}" &>/dev/null || useradd --system --create-home --shell /bin/bash "${APP_USER}"
mkdir -p "${APP_DIR}" "${LOG_DIR}"
chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}" "${LOG_DIR}"

# ── 7. Clone / pull code ──────────────────────────────────────────
echo "[7/9] Deploying code..."
if [[ -n "${GITHUB_REPO}" ]]; then
  if [[ -d "${APP_DIR}/.git" ]]; then
    echo "    Pulling latest..."
    sudo -u "${APP_USER}" git -C "${APP_DIR}" pull
  else
    echo "    Cloning ${GITHUB_REPO}..."
    # Private repo note: generate a deploy key first:
    #   ssh-keygen -t ed25519 -C "citefi-deploy" -f /home/citefi/.ssh/deploy_key -N ""
    #   cat /home/citefi/.ssh/deploy_key.pub   # → add as Deploy Key in GitHub repo settings (read-only)
    #   echo 'Host github.com' >> /home/citefi/.ssh/config
    #   echo '  IdentityFile /home/citefi/.ssh/deploy_key' >> /home/citefi/.ssh/config
    sudo -u "${APP_USER}" git clone "${GITHUB_REPO}" "${APP_DIR}"
  fi
else
  echo "    GITHUB_REPO not set — skipping clone."
  echo "    Copy code manually to ${APP_DIR} then re-run from step 8."
fi

# ── 8. Install, type-check, build ─────────────────────────────────
echo "[8/9] Installing dependencies + building..."
sudo -u "${APP_USER}" bash -c "cd ${APP_DIR} && npm ci --production=false"
echo "    Running type-check gate..."
sudo -u "${APP_USER}" bash -c "cd ${APP_DIR} && npm run check" || {
  echo "❌  TypeScript errors detected — fix before deploying."
  exit 1
}
echo "    Building Next.js..."
sudo -u "${APP_USER}" bash -c "cd ${APP_DIR} && npm run build"

# Env file
if [[ ! -f "${APP_DIR}/.env.local" ]]; then
  cp "${APP_DIR}/.env.example" "${APP_DIR}/.env.local"
  chown "${APP_USER}:${APP_USER}" "${APP_DIR}/.env.local"
  chmod 600 "${APP_DIR}/.env.local"
  echo ""
  echo "  ⚠️  .env.local created from template — fill in your values:"
  echo "    sudo nano ${APP_DIR}/.env.local"
  echo "    sudo -u ${APP_USER} pm2 restart all  (after saving)"
  echo ""
else
  chmod 600 "${APP_DIR}/.env.local"
  chown "${APP_USER}:${APP_USER}" "${APP_DIR}/.env.local"
fi

# ── 9. PM2 + Nginx ────────────────────────────────────────────────
echo "[9/9] Starting PM2 and configuring Nginx..."

sudo -u "${APP_USER}" bash -c "cd ${APP_DIR} && pm2 start ecosystem.config.js"
sudo -u "${APP_USER}" pm2 save

# Configure PM2 to start on boot (must run as root)
pm2 startup systemd -u "${APP_USER}" --hp "/home/${APP_USER}"
systemctl enable pm2-${APP_USER}

# Nginx
sed "s/yourdomain.com/${DOMAIN}/g" "${APP_DIR}/nginx.conf" \
  > /etc/nginx/sites-available/citefi
[[ -L /etc/nginx/sites-enabled/citefi ]] || \
  ln -s /etc/nginx/sites-available/citefi /etc/nginx/sites-enabled/citefi
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

DROPLET_IP=$(curl -s --max-time 3 ifconfig.me 2>/dev/null || echo "<droplet-ip>")

# ── Done ──────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════╗"
echo "║               Setup complete!            ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "Droplet IP: ${DROPLET_IP}"
echo ""
echo "Next steps:"
echo "  1. Point DNS:    ${DOMAIN} A → ${DROPLET_IP}"
echo "  2. Fill secrets: sudo nano ${APP_DIR}/.env.local"
echo "  3. Restart app:  sudo -u ${APP_USER} pm2 restart all"
echo "  4. Enable HTTPS: sudo certbot --nginx -d ${DOMAIN} -d www.${DOMAIN}"
echo ""
echo "Useful commands:"
echo "  Logs (web):    sudo -u ${APP_USER} pm2 logs citefi-web"
echo "  Logs (worker): sudo -u ${APP_USER} pm2 logs citefi-worker"
echo "  Status:        sudo -u ${APP_USER} pm2 status"
echo "  Redeploy:      sudo -u ${APP_USER} bash -c 'cd ${APP_DIR} && git pull && npm ci && npm run check && npm run build && pm2 restart all'"
echo ""
