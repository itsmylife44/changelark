#!/bin/sh
# Calls one cron route of the app, as Vercel Cron does. Usage: run.sh asc-sync|alerts
# A failed call is logged; the cron container keeps running.
route=$1
log() { echo "$(date -u +%FT%TZ) $route $*"; }
if [ "$route" = alerts ] && [ -z "$SMTP_URL" ]; then
  log "skipped: SMTP_URL is not set"
  exit 0
fi
if out=$(wget -q -O - -T 600 --header "Authorization: Bearer $CRON_SECRET" "${APP_URL:-http://app:3000}/api/cron/$route" 2>&1); then
  log "ok: $out"
else
  log "FAILED: $out"
fi
