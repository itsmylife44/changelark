#!/bin/sh
# Backs up the self-hosted instance into one archive and keeps the newest 7.
# Archive: db.dump (pg_dump -Fc), db-config (the Vault key), storage (bug screenshots), .env.
# Run by cron/crontab; by hand: docker compose exec cron /cron/backup.sh
src=${BACKUP_SRC:-/backup}
dest=${BACKUP_DIR:-/backups}
log() { echo "$(date -u +%FT%TZ) backup $*"; }
if [ -z "$POSTGRES_PASSWORD" ]; then
  log "skipped: POSTGRES_PASSWORD is not set (no self-hosted Supabase)"
  exit 0
fi
umask 077 # the archive holds .env and the Vault key
work=$(mktemp -d "$dest/.tmp.XXXXXX") || { log "FAILED: cannot write to $dest"; exit 1; }
trap 'rm -f "$work/db.dump" "$work/a.tar.gz"; rmdir "$work"' EXIT
name=changelark-$(date -u +%Y%m%dT%H%M%SZ).tar.gz
if ! err=$(PGHOST=${PGHOST:-db} PGPORT=${POSTGRES_PORT:-5432} PGUSER=supabase_admin PGPASSWORD=$POSTGRES_PASSWORD \
  PGDATABASE=${POSTGRES_DB:-postgres} pg_dump -Fc -f "$work/db.dump" 2>&1 >/dev/null); then
  log "FAILED: pg_dump: $err"
  exit 1
fi
if ! err=$(tar -czf "$work/a.tar.gz" -C "$work" db.dump -C "$src" db-config storage .env 2>&1); then
  log "FAILED: tar: $err"
  exit 1
fi
mv "$work/a.tar.gz" "$dest/$name"
ls -1 "$dest"/changelark-*.tar.gz | sort -r | tail -n +8 | while read -r old; do rm -f "$old"; done
log "ok: $dest/$name"
