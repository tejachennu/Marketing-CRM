#!/usr/bin/env bash
# Connect one business's own domain to its WAMA online store on a server that already runs nginx.
# Adds ONE nginx site for that domain (nothing else is touched), tests nginx, reloads it gently,
# and gets a free https certificate for it.
#
#   sudo bash add-store-domain.sh shop.theirname.com you@yourmail.com [app port, default 3000]
#
# Before running: the business has typed the domain in WAMA (E-commerce → Website → Store address →
# My own domain) and added the DNS record it shows. Safe to run again for the same domain.
set -euo pipefail

DOMAIN="$(echo "${1:-}" | tr 'A-Z' 'a-z' | sed -E 's#^https?://##; s#/.*$##; s#\.$##')"
EMAIL="${2:-}"
PORT="${3:-3000}"

if [ -z "$DOMAIN" ] || [ -z "$EMAIL" ]; then
  echo "Use: sudo bash add-store-domain.sh shop.theirname.com you@yourmail.com [app port]" >&2; exit 1
fi
if ! [[ "$DOMAIN" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$ ]]; then
  echo "\"$DOMAIN\" does not look like a domain." >&2; exit 1
fi
# WAMA's own names (wamacrm, stores, www… .magnetora.in) are refused by WAMA in step 2.
# Exit 3 = not ready yet (not connected in WAMA, or DNS not pointing here): the automatic job tries again soon.
if [ "$(id -u)" != "0" ]; then echo "Run with sudo." >&2; exit 1; fi
command -v nginx >/dev/null || { echo "nginx is not installed on this server." >&2; exit 1; }

if [ -f "/etc/nginx/sites-enabled/wama-store-$DOMAIN.conf" ] && [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  echo "$DOMAIN is already connected."; exit 0
fi

echo "== 1. Is the shop running on port $PORT?"
if ! curl -s -o /dev/null --max-time 10 "http://127.0.0.1:$PORT/"; then
  echo "Nothing answers on 127.0.0.1:$PORT. Check: sudo -u wamashop pm2 status" >&2; exit 1
fi

echo "== 2. Has a store connected $DOMAIN in WAMA?"
if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:$PORT/api/public/store-domain-check?domain=$DOMAIN")" != "200" ]; then
  echo "No store has $DOMAIN yet. The business must type it in WAMA first (Website → Store address → My own domain)." >&2; exit 3
fi

echo "== 3. Does $DOMAIN point to this server?"
MY_IPS="$(hostname -I) $(curl -s --max-time 5 https://api.ipify.org || true)"
# Ask public DNS first: this server's own DNS cache can keep a domain's old address for hours
PUBLIC_IPS="$(curl -s --max-time 8 "https://dns.google/resolve?name=$DOMAIN&type=A" | python3 -I -c 'import json,sys; print(" ".join(a["data"] for a in json.load(sys.stdin).get("Answer", []) if a.get("type") == 1))' 2>/dev/null || true)"
DNS_IPS="${PUBLIC_IPS:-$(getent ahostsv4 "$DOMAIN" | awk '{print $1}' | sort -u | tr '\n' ' ')}"
POINTS=no
for ip in $DNS_IPS; do [[ " $MY_IPS " == *" $ip "* ]] && POINTS=yes; done
if [ "$POINTS" != "yes" ]; then
  echo "$DOMAIN points to: ${DNS_IPS:-nothing yet}. This server is: $MY_IPS" >&2
  echo "Ask the business to add the DNS record shown in WAMA, wait a few minutes, then run this again." >&2; exit 3
fi

SITE="/etc/nginx/sites-available/wama-store-$DOMAIN.conf"
echo "== 4. Adding the nginx site $SITE (only this file)"
cat > "$SITE" <<NGINX
# WAMA online store for $DOMAIN (added by add-store-domain.sh)
server {
  listen 80;
  listen [::]:80;
  server_name $DOMAIN;
  client_max_body_size 10m;
  location / {
    proxy_pass http://127.0.0.1:$PORT;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
NGINX
ln -sf "$SITE" "/etc/nginx/sites-enabled/wama-store-$DOMAIN.conf"
if ! nginx -t; then
  echo "nginx refused the new site, so it was removed again. Nothing else changed." >&2
  rm -f "/etc/nginx/sites-enabled/wama-store-$DOMAIN.conf" "$SITE"; exit 1
fi
systemctl reload nginx

echo "== 5. https certificate (Let's Encrypt)"
command -v certbot >/dev/null || apt-get install -y certbot python3-certbot-nginx
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect --keep-until-expiring
nginx -t && systemctl reload nginx

echo "== 6. Check"
CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$DOMAIN/")"
echo "https://$DOMAIN answered $CODE"
[ "$CODE" = "200" ] && echo "Done. $DOMAIN now opens the store." || echo "Opened with $CODE: check the store is switched on in WAMA (Website tab)."
