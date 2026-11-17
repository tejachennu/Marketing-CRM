#!/usr/bin/env bash
# One time, on the shop server: business domains connect by themselves from now on.
#   sudo bash install-auto-domains.sh you@magnetora.in [app port, default 3000] [app folder, default /opt/wama-shop]
# Makes a secret key shared by this server's shop and the job (never shown), and a systemd timer that runs
# sync-store-domains.sh every 2 minutes. Existing websites, nginx settings and services are not changed.
set -euo pipefail
EMAIL="${1:-}"; PORT="${2:-3000}"; APP="${3:-/opt/wama-shop}"
[ -n "$EMAIL" ] || { echo "Use: sudo bash install-auto-domains.sh you@magnetora.in [port] [app folder]" >&2; exit 1; }
[ "$(id -u)" = "0" ] || { echo "Run with sudo." >&2; exit 1; }
[ -f "$APP/.env.local" ] || { echo "$APP/.env.local not found: is the shop installed there?" >&2; exit 1; }
command -v certbot >/dev/null || apt-get install -y certbot python3-certbot-nginx

# The shared key: kept if the shop already has one, else made here
KEY="$(grep -E '^STORE_GATEWAY_KEY=' "$APP/.env.local" | head -1 | cut -d= -f2- || true)"
if [ "${#KEY}" -lt 16 ]; then
  KEY="$(openssl rand -hex 32)"
  sed -i '/^STORE_GATEWAY_KEY=/d' "$APP/.env.local"
  echo "STORE_GATEWAY_KEY=$KEY" >> "$APP/.env.local"
  OWNER="$(stat -c %U "$APP")"
  echo "Restarting the shop so it reads its new key"
  sudo -u "$OWNER" bash -lc 'pm2 reload wama-shop --update-env' || echo "Reload the shop yourself: pm2 reload wama-shop"
fi

install -d -m 700 /etc/wama-shop
umask 077
cat > /etc/wama-shop/domains.env <<ENV
LIST_URL=http://localhost:$PORT/api/public/store-domains
STORE_GATEWAY_KEY=$KEY
ACME_EMAIL=$EMAIL
APP_PORT=$PORT
ENV

cat > /etc/systemd/system/wama-store-domains.service <<UNIT
[Unit]
Description=WAMA shop: connect business domains
After=network-online.target nginx.service

[Service]
Type=oneshot
ExecStart=/bin/bash $APP/deploy/nginx/sync-store-domains.sh
UNIT
cat > /etc/systemd/system/wama-store-domains.timer <<UNIT
[Unit]
Description=WAMA shop: connect business domains every 2 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=2min

[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now wama-store-domains.timer
sleep 5
systemctl start wama-store-domains.service || true
echo "Done. Business domains now connect by themselves within a few minutes of pointing here."
echo "See what it does: journalctl -u wama-store-domains -n 50"
