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

MY_IPS="$(hostname -I) $(curl -s --max-time 5 https://api.ipify.org || true)"
# Where a name points. Public DNS first: this server's own DNS cache can keep an old address for hours.
dns_ips() {
  local ips
  ips="$(curl -s --max-time 8 "https://dns.google/resolve?name=$1&type=A" | python3 -I -c 'import json,sys; print(" ".join(a["data"] for a in json.load(sys.stdin).get("Answer", []) if a.get("type") == 1))' 2>/dev/null || true)"
  echo "${ips:-$(getent ahostsv4 "$1" | awk '{print $1}' | sort -u | tr '\n' ' ')}"
}
points_here() { local ip; for ip in $(dns_ips "$1"); do [[ " $MY_IPS " == *" $ip "* ]] && return 0; done; return 1; }
# Records of one kind from public DNS (28 = AAAA, 257 = CAA), one per line
dns_records() {
  curl -s --max-time 8 "https://dns.google/resolve?name=$1&type=$2" | python3 -I -c 'import json,sys; t=int(sys.argv[1]); print("\n".join(a["data"] for a in json.load(sys.stdin).get("Answer", []) if a.get("type") == t))' "$2" 2>/dev/null || true
}
# IPv6 (AAAA) addresses that are not this server. Domain companies often add one by default ("parking");
# Let's Encrypt and many phones then go there instead, the certificate fails and the store never opens.
foreign_v6() { local ip; for ip in $(dns_records "$1" 28); do [[ " $MY_IPS " == *" $ip "* ]] || echo "$ip"; done; }
# CAA records can allow only some certificate companies; Let's Encrypt must be one of them
caa_blocks() {
  local name="$1" caa
  while [[ "$name" == *.* ]]; do
    caa="$(dns_records "$name" 257 | grep -E '^[0-9]+ issue(wild)? ' || true)"
    if [ -n "$caa" ]; then printf '%s\n' "$caa" | grep -qi 'letsencrypt\.org' && return 1; return 0; fi
    name="${name#*.}"
  done
  return 1
}

# www.<domain> comes along when it points here too (it opens the store at <domain>)
WWW=""
if [[ "$DOMAIN" != www.* ]] && points_here "www.$DOMAIN" && [ -z "$(foreign_v6 "www.$DOMAIN")" ]; then WWW="www.$DOMAIN"; fi

SITE="/etc/nginx/sites-available/wama-store-$DOMAIN.conf"
if [ -f "/etc/nginx/sites-enabled/wama-store-$DOMAIN.conf" ] && [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  if [ -z "$WWW" ] || grep -q "server_name $WWW;" "$SITE"; then echo "$DOMAIN is already connected."; exit 0; fi
  echo "$DOMAIN is connected; adding $WWW to it."
fi

echo "== 1. Is the shop running on port $PORT?"
# nginx is pointed at the exact address the shop listens on ("localhost" makes nginx try 127.0.0.1 first,
# which is refused on every request when the shop listens on [::1] only)
UPSTREAM=""
for H in 127.0.0.1 '[::1]'; do
  if curl -s -o /dev/null --max-time 10 "http://$H:$PORT/"; then UPSTREAM="$H"; break; fi
done
if [ -z "$UPSTREAM" ]; then
  echo "Nothing answers on localhost:$PORT. Check: sudo -u wamashop pm2 status" >&2; exit 1
fi

echo "== 2. Has a store connected $DOMAIN in WAMA?"
if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "http://localhost:$PORT/api/public/store-domain-check?domain=$DOMAIN")" != "200" ]; then
  echo "No store has $DOMAIN yet. The business must type it in WAMA first (Website → Store address → My own domain)." >&2; exit 3
fi

echo "== 3. Does $DOMAIN point to this server?"
if ! points_here "$DOMAIN"; then
  DNS_IPS="$(dns_ips "$DOMAIN")"
  echo "$DOMAIN points to: ${DNS_IPS:-nothing yet}. This server is: $MY_IPS" >&2
  echo "Ask the business to add the DNS record shown in WAMA, wait a few minutes, then run this again." >&2; exit 3
fi
V6="$(foreign_v6 "$DOMAIN" | tr '\n' ' ')"
if [ -n "$V6" ]; then
  echo "$DOMAIN also has an IPv6 (AAAA) record pointing elsewhere: $V6" >&2
  echo "Ask the business to delete the AAAA record for it at their domain company; then it connects by itself." >&2; exit 3
fi
if caa_blocks "$DOMAIN"; then
  echo "$DOMAIN has a CAA record that does not allow Let's Encrypt, so no https certificate can be made." >&2
  echo "Ask the business to delete the CAA record, or add: CAA 0 issue \"letsencrypt.org\"." >&2; exit 3
fi

echo "== 4. Adding the nginx site $SITE (only this file)"
# A site that is already there (adding www to it) is kept aside, and put back if anything fails
BACKUP=""
if [ -f "$SITE" ]; then BACKUP="$(mktemp)"; cp "$SITE" "$BACKUP"; fi
put_back() {
  if [ -n "$BACKUP" ]; then cp "$BACKUP" "$SITE"; else rm -f "/etc/nginx/sites-enabled/wama-store-$DOMAIN.conf" "$SITE"; fi
  nginx -t && systemctl reload nginx
}
cat > "$SITE" <<NGINX
# WAMA online store for $DOMAIN (added by add-store-domain.sh)
server {
  listen 80;
  listen [::]:80;
  server_name $DOMAIN;
  client_max_body_size 10m;
  location / {
    proxy_pass http://$UPSTREAM:$PORT;
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
if [ -n "$WWW" ]; then cat >> "$SITE" <<NGINX

# $WWW opens the store at $DOMAIN
server {
  listen 80;
  listen [::]:80;
  server_name $WWW;
  location / {
    return 301 https://$DOMAIN\$request_uri;
  }
}
NGINX
fi
ln -sf "$SITE" "/etc/nginx/sites-enabled/wama-store-$DOMAIN.conf"
if ! nginx -t; then
  echo "nginx refused the new site, so it was put back as it was. Nothing else changed." >&2
  put_back; exit 1
fi
systemctl reload nginx

echo "== 5. https certificate (Let's Encrypt)"
command -v certbot >/dev/null || apt-get install -y certbot python3-certbot-nginx
NAMES=(-d "$DOMAIN"); [ -n "$WWW" ] && NAMES+=(-d "$WWW")
if ! certbot --nginx "${NAMES[@]}" --cert-name "$DOMAIN" --expand --non-interactive --agree-tos -m "$EMAIL" --redirect --keep-until-expiring; then
  echo "The certificate could not be made, so the site was put back as it was." >&2
  if [ -n "$BACKUP" ]; then put_back; fi
  exit 1
fi
nginx -t && systemctl reload nginx

echo "== 6. Check (through this server's nginx: the server's own DNS cache may still hold an old address)"
CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/")"
echo "https://$DOMAIN answered $CODE"
[ -n "$WWW" ] && echo "https://$WWW answered $(curl -s -o /dev/null -w '%{http_code}' --max-time 15 --resolve "$WWW:443:127.0.0.1" "https://$WWW/") (301 = sends people to $DOMAIN)"
[ "$CODE" = "200" ] && echo "Done. $DOMAIN now opens the store." || echo "Opened with $CODE: check the store is switched on in WAMA (Website tab)."
