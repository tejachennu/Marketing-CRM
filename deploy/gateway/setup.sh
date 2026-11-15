#!/usr/bin/env bash
# Sets up (or updates) the WAMA store domain gateway on Ubuntu 22.04 / 24.04. Safe to run again.
# Run as root with these set in the environment (the GitHub "Deploy store gateway" workflow does this):
#   GATEWAY_HOSTNAME   the gateway's own name, e.g. stores.magnetora.in (its DNS A record → this server)
#   APP_URL            the WAMA app, e.g. https://wamacrm.magnetora.in
#   STORE_GATEWAY_KEY  a long random key; the same value goes in Vercel as STORE_GATEWAY_KEY
#   ACME_EMAIL         email for certificate notices
set -euo pipefail

for name in GATEWAY_HOSTNAME APP_URL STORE_GATEWAY_KEY ACME_EMAIL; do
  if [ -z "${!name:-}" ]; then echo "Missing $name" >&2; exit 1; fi
done
if [ "${#STORE_GATEWAY_KEY}" -lt 16 ]; then echo "STORE_GATEWAY_KEY must be at least 16 characters" >&2; exit 1; fi
APP_HOST="$(echo "$APP_URL" | sed -E 's#^https?://##; s#/.*$##')"
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "== Installing Caddy"
if ! command -v caddy >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

echo "== Firewall: SSH, http, https"
if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw --force enable >/dev/null
fi

echo "== Settings"
install -d -m 0750 -o root -g caddy /etc/caddy
umask 027
cat > /etc/caddy/gateway.env <<ENV
GATEWAY_HOSTNAME=$GATEWAY_HOSTNAME
APP_URL=$APP_URL
APP_HOST=$APP_HOST
STORE_GATEWAY_KEY=$STORE_GATEWAY_KEY
ACME_EMAIL=$ACME_EMAIL
ENV
chown root:caddy /etc/caddy/gateway.env
chmod 0640 /etc/caddy/gateway.env
install -m 0644 "$HERE/Caddyfile" /etc/caddy/Caddyfile
install -d -o caddy -g caddy /var/log/caddy

# Caddy reads the settings file
install -d /etc/systemd/system/caddy.service.d
cat > /etc/systemd/system/caddy.service.d/gateway.conf <<'UNIT'
[Service]
EnvironmentFile=/etc/caddy/gateway.env
UNIT
systemctl daemon-reload

echo "== Checking the config"
set -a; . /etc/caddy/gateway.env; set +a
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

echo "== Starting"
systemctl enable caddy >/dev/null
systemctl restart caddy
sleep 3
systemctl is-active --quiet caddy && echo "Caddy is running." || { journalctl -u caddy -n 50 --no-pager; exit 1; }
