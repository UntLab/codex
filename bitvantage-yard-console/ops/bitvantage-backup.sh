#!/usr/bin/env bash
set -euo pipefail

umask 077

STACK_DIR="${BITVANTAGE_STACK_DIR:-/srv/stacks/bitvantage}"
BACKUP_ROOT="${BITVANTAGE_BACKUP_ROOT:-$STACK_DIR/backups/automated}"
RETENTION_DAYS="${BITVANTAGE_BACKUP_RETENTION_DAYS:-21}"
POSTGRES_IMAGE="${BITVANTAGE_PGDUMP_IMAGE:-postgres:17-alpine}"
PASSPHRASE_FILE="${BITVANTAGE_BACKUP_PASSPHRASE_FILE:-/root/.bitvantage-backup-passphrase}"
RCLONE_REMOTE="${BITVANTAGE_BACKUP_RCLONE_REMOTE:-}"
PUSH_URL="${BITVANTAGE_BACKUP_PUSH_URL:-}"
LOCK_FILE="${BITVANTAGE_BACKUP_LOCK_FILE:-/run/lock/bitvantage-backup.lock}"
STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
RUN_DIR="$BACKUP_ROOT/$STAMP"

log() {
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

fail() {
  log "ERROR: $*"
  exit 1
}

read_env_value() {
  local key="$1"
  local env_file="$STACK_DIR/.env"
  [[ -f "$env_file" ]] || fail "Missing env file: $env_file"
  awk -F= -v key="$key" '
    $1 == key {
      sub(/^[^=]*=/, "")
      gsub(/^["'\'' ]+|["'\'' ]+$/, "")
      print
      exit
    }
  ' "$env_file"
}

run_pg_tool() {
  docker run --rm \
    --network host \
    -e DATABASE_URL \
    -e PGSSLMODE=require \
    -v "$RUN_DIR:/backup" \
    "$POSTGRES_IMAGE" \
    "$@"
}

send_success_heartbeat() {
  [[ -n "$PUSH_URL" ]] || return 0
  command -v curl >/dev/null || {
    log "curl is not available; backup heartbeat skipped."
    return 0
  }
  local separator="?"
  [[ "$PUSH_URL" == *"?"* ]] && separator="&"
  curl -fsS --max-time 10 \
    "${PUSH_URL}${separator}status=up&msg=BitVantage%20backup%20completed%20${STAMP}&ping=" \
    >/dev/null \
    || log "Backup heartbeat push failed; backup artifacts were still created."
}

main() {
  mkdir -p "$(dirname "$LOCK_FILE")" "$BACKUP_ROOT"
  exec 9>"$LOCK_FILE"
  flock -n 9 || fail "Another BitVantage backup is already running."

  [[ -d "$STACK_DIR" ]] || fail "Missing stack directory: $STACK_DIR"
  command -v docker >/dev/null || fail "docker is required"
  command -v sha256sum >/dev/null || fail "sha256sum is required"

  DATABASE_URL="$(read_env_value DATABASE_URL)"
  [[ -n "$DATABASE_URL" ]] || fail "DATABASE_URL is not configured"
  export DATABASE_URL

  mkdir -p "$RUN_DIR"
  chmod 700 "$RUN_DIR"

  local public_dump="bitvantage-public-${STAMP}.dump"
  local full_dump="bitvantage-full-${STAMP}.dump"
  local stack_archive="bitvantage-stack-${STAMP}.tar.gz"
  local encrypted_archive="bitvantage-backup-${STAMP}.tar.gz.enc"

  log "Starting BitVantage backup into $RUN_DIR"

  run_pg_tool pg_dump "$DATABASE_URL" \
    --format=custom \
    --no-owner \
    --no-privileges \
    --schema=public \
    -f "/backup/$public_dump"

  run_pg_tool pg_dump "$DATABASE_URL" \
    --format=custom \
    --no-owner \
    --no-privileges \
    -f "/backup/$full_dump"

  run_pg_tool pg_restore -l "/backup/$public_dump" > "$RUN_DIR/${public_dump}.toc"
  run_pg_tool pg_restore -l "/backup/$full_dump" > "$RUN_DIR/${full_dump}.toc"

  tar -czf "$RUN_DIR/$stack_archive" \
    -C "$STACK_DIR" \
    --exclude='./backups' \
    .

  (
    cd "$RUN_DIR"
    sha256sum "$public_dump" "$full_dump" "$stack_archive" "${public_dump}.toc" "${full_dump}.toc" > SHA256SUMS.txt
    sha256sum -c SHA256SUMS.txt
  )

  cat > "$RUN_DIR/MANIFEST.txt" <<EOF
Project: BitVantage Yard Console
Created UTC: $STAMP
Stack directory: $STACK_DIR
Backup directory: $RUN_DIR
PostgreSQL image: $POSTGRES_IMAGE
Contents:
- public schema pg_dump custom archive
- full database pg_dump custom archive
- pg_restore TOC listings
- server stack archive excluding backups
- SHA256SUMS.txt
EOF

  if [[ -f "$PASSPHRASE_FILE" ]]; then
    tar -czf - -C "$BACKUP_ROOT" "$STAMP" \
      | openssl enc -aes-256-cbc -pbkdf2 -salt -out "$BACKUP_ROOT/$encrypted_archive" -pass "file:$PASSPHRASE_FILE"
    sha256sum "$BACKUP_ROOT/$encrypted_archive" > "$BACKUP_ROOT/${encrypted_archive}.sha256"
    log "Encrypted offsite package created: $encrypted_archive"

    if [[ -n "$RCLONE_REMOTE" ]] && command -v rclone >/dev/null; then
      rclone copy "$BACKUP_ROOT/$encrypted_archive" "$RCLONE_REMOTE" --checksum
      rclone copy "$BACKUP_ROOT/${encrypted_archive}.sha256" "$RCLONE_REMOTE" --checksum
      log "Encrypted package copied to configured rclone remote."
    fi
  else
    log "No passphrase file found at $PASSPHRASE_FILE; offsite encrypted package skipped."
  fi

  find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime +"$RETENTION_DAYS" -print -exec rm -rf {} +
  find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type f -name 'bitvantage-backup-*.tar.gz.enc*' -mtime +"$RETENTION_DAYS" -print -delete

  send_success_heartbeat

  log "BitVantage backup completed successfully."
}

main "$@"
