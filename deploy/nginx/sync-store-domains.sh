#!/usr/bin/env bash
# Runs every 2 minutes (systemd timer from install-auto-domains.sh). Reads the list of business domains
# connected in WAMA and makes nginx match it:
#   - a new domain that points to this server → its own nginx site + https certificate (add-store-domain.sh)
#   - a domain no longer in WAMA → its site and certificate removed (only sites this job made: wama-store-*)
# Existing websites on this server are never touched. Settings: /etc/wama-shop/domains.env
set -uo pipefail

CONF=/etc/wama-shop/domains.env
[ -f "$CONF" ] || { echo "Missing $CONF (run install-auto-domains.sh)"; exit 1; }
# shellcheck disable=SC1090
. "$CONF"
HERE="$(cd "$(dirname "$0")" && pwd)"
STATE=/var/lib/wama-shop/domains
mkdir -p "$STATE"
exec 9>/run/wama-store-domains.lock
flock -n 9 || exit 0   # the last run is still busy
log() { echo "$(date '+%F %T') $*"; }

# 1. The list from WAMA (a failure changes nothing on this server)
JSON="$(curl -s --max-time 20 -H "X-Gateway-Key: $STORE_GATEWAY_KEY" "$LIST_URL")" || { log "Could not reach $LIST_URL"; exit 0; }
LIST="$(printf '%s' "$JSON" | python3 -I -c 'import json,sys; d=json.load(sys.stdin); assert isinstance(d.get("domains"), list); print("\n".join(d["domains"]))' 2>/dev/null)" \
  || { log "WAMA did not send a domain list (check STORE_GATEWAY_KEY)"; exit 0; }

# 2. Add new ones. Not ready yet (DNS not changed yet): tried again in 5 minutes. Anything else (e.g. the
#    certificate failed): in 30 minutes, to stay well inside Let's Encrypt's limits.
for DOMAIN in $LIST; do
  if [ -f "/etc/nginx/sites-enabled/wama-store-$DOMAIN.conf" ] && [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
    # Connected. Add www.<domain> once it points here too (looked at every 30 minutes)
    if [[ "$DOMAIN" != www.* ]] && ! grep -q "server_name www.$DOMAIN;" "/etc/nginx/sites-available/wama-store-$DOMAIN.conf"; then
      WNEXT="$(cat "$STATE/$DOMAIN.www-next" 2>/dev/null || echo 0)"
      if [ "$(date +%s)" -ge "$WNEXT" ]; then
        echo $(( $(date +%s) + 1800 )) > "$STATE/$DOMAIN.www-next"
        bash "$HERE/add-store-domain.sh" "$DOMAIN" "$ACME_EMAIL" "$APP_PORT" >>"$STATE/$DOMAIN.log" 2>&1 || log "www.$DOMAIN could not be added (see $STATE/$DOMAIN.log)"
        grep -q "server_name www.$DOMAIN;" "/etc/nginx/sites-available/wama-store-$DOMAIN.conf" && log "www.$DOMAIN added (opens $DOMAIN)"
      fi
    fi
    continue
  fi
  NEXT="$(cat "$STATE/$DOMAIN.next" 2>/dev/null || echo 0)"
  [ "$(date +%s)" -lt "$NEXT" ] && continue
  log "Connecting $DOMAIN"
  RC=0
  bash "$HERE/add-store-domain.sh" "$DOMAIN" "$ACME_EMAIL" "$APP_PORT" >>"$STATE/$DOMAIN.log" 2>&1 || RC=$?
  if [ "$RC" = "0" ]; then
    log "$DOMAIN connected"; rm -f "$STATE/$DOMAIN.next"
  elif [ "$RC" = "3" ]; then
    log "$DOMAIN not ready yet (DNS or WAMA, see $STATE/$DOMAIN.log); trying again in 5 minutes"
    echo $(( $(date +%s) + 300 )) > "$STATE/$DOMAIN.next"
  else
    log "$DOMAIN could not be connected (see $STATE/$DOMAIN.log); trying again in 30 minutes"
    echo $(( $(date +%s) + 1800 )) > "$STATE/$DOMAIN.next"
  fi
done

# 3. Remove domains a business took off (never more than half at once: a safety net)
mapfile -t HAVE < <(ls /etc/nginx/sites-enabled/ 2>/dev/null | sed -n 's/^wama-store-\(.*\)\.conf$/\1/p')
GONE=()
for DOMAIN in "${HAVE[@]}"; do printf '%s\n' "$LIST" | grep -qxF "$DOMAIN" || GONE+=("$DOMAIN"); done
if [ "${#GONE[@]}" -gt 0 ]; then
  if [ "${#HAVE[@]}" -gt 2 ] && [ $(( ${#GONE[@]} * 2 )) -gt "${#HAVE[@]}" ]; then
    log "Not removing ${#GONE[@]} of ${#HAVE[@]} domains at once; check WAMA and run remove-store-domain.sh by hand"
  else
    for DOMAIN in "${GONE[@]}"; do log "Removing $DOMAIN"; bash "$HERE/remove-store-domain.sh" "$DOMAIN" >>"$STATE/$DOMAIN.log" 2>&1; done
  fi
fi
exit 0
