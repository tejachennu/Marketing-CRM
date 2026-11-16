#!/usr/bin/env bash
# Take a business domain off this server (its nginx site and certificate). Nothing else is touched.
#   sudo bash remove-store-domain.sh shop.theirname.com
set -euo pipefail
DOMAIN="$(echo "${1:-}" | tr 'A-Z' 'a-z')"
[ -n "$DOMAIN" ] || { echo "Use: sudo bash remove-store-domain.sh shop.theirname.com" >&2; exit 1; }
[ "$(id -u)" = "0" ] || { echo "Run with sudo." >&2; exit 1; }
rm -f "/etc/nginx/sites-enabled/wama-store-$DOMAIN.conf" "/etc/nginx/sites-available/wama-store-$DOMAIN.conf"
nginx -t && systemctl reload nginx
certbot delete --cert-name "$DOMAIN" --non-interactive 2>/dev/null || true
echo "$DOMAIN removed from this server."
