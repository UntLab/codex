#!/usr/bin/env bash
set -euo pipefail

umask 077

STACK_DIR="${BITVANTAGE_STACK_DIR:-/srv/stacks/bitvantage}"
SNAPSHOT_ROOT="${BITVANTAGE_SNAPSHOT_ROOT:-$STACK_DIR/backups/google-snapshots}"
RETENTION_DAYS="${BITVANTAGE_SNAPSHOT_RETENTION_DAYS:-31}"
POSTGRES_IMAGE="${BITVANTAGE_PGDUMP_IMAGE:-postgres:17-alpine}"
RCLONE_REMOTE="${BITVANTAGE_SNAPSHOT_RCLONE_REMOTE:-gdrive-nextcloud:bitvantage-snapshots/daily}"
RCLONE_SHEETS_REMOTE="${BITVANTAGE_SNAPSHOT_SHEETS_REMOTE:-gdrive-nextcloud:bitvantage-snapshots/google-sheets}"
OPERATION_DAYS="${BITVANTAGE_SNAPSHOT_OPERATION_DAYS:-30}"
NOTIFICATION_DAYS="${BITVANTAGE_SNAPSHOT_NOTIFICATION_DAYS:-7}"
PUSH_URL="${BITVANTAGE_SNAPSHOT_PUSH_URL:-}"
LOCK_FILE="${BITVANTAGE_SNAPSHOT_LOCK_FILE:-/run/lock/bitvantage-google-snapshot.lock}"
STAMP_UTC="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
DAY_BAKU="$(TZ=Asia/Baku date +%Y-%m-%d)"
RUN_DIR="$SNAPSHOT_ROOT/$DAY_BAKU"

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

run_psql() {
  docker run --rm \
    --network host \
    -e DATABASE_URL \
    -e PGSSLMODE=require \
    -v "$RUN_DIR:/snapshot" \
    "$POSTGRES_IMAGE" \
    psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 "$@"
}

send_success_heartbeat() {
  [[ -n "$PUSH_URL" ]] || return 0
  command -v curl >/dev/null || {
    log "curl is not available; Google snapshot heartbeat skipped."
    return 0
  }
  local separator="?"
  [[ "$PUSH_URL" == *"?"* ]] && separator="&"
  curl -fsS --max-time 10 \
    "${PUSH_URL}${separator}status=up&msg=BitVantage%20Google%20snapshot%20completed%20${DAY_BAKU}&ping=" \
    >/dev/null \
    || log "Google snapshot heartbeat push failed; snapshot artifacts were still created."
}

main() {
  mkdir -p "$(dirname "$LOCK_FILE")" "$SNAPSHOT_ROOT"
  exec 9>"$LOCK_FILE"
  flock -n 9 || fail "Another BitVantage Google snapshot is already running."

  [[ -d "$STACK_DIR" ]] || fail "Missing stack directory: $STACK_DIR"
  command -v docker >/dev/null || fail "docker is required"
  command -v sha256sum >/dev/null || fail "sha256sum is required"
  command -v rclone >/dev/null || fail "rclone is required"

  DATABASE_URL="$(read_env_value DATABASE_URL)"
  [[ -n "$DATABASE_URL" ]] || fail "DATABASE_URL is not configured"
  export DATABASE_URL

  rm -rf "$RUN_DIR"
  mkdir -p "$RUN_DIR"
  chmod 700 "$RUN_DIR"

  cat > "$RUN_DIR/export.sql" <<SQL
\\pset format csv
CREATE FUNCTION pg_temp.csv_safe(value text) RETURNS text
LANGUAGE sql IMMUTABLE AS \$\$
  SELECT CASE
    WHEN value IS NULL THEN ''
    WHEN value ~ '^[=+@-]' THEN '''' || value
    ELSE value
  END;
\$\$;

\\o /snapshot/00_manifest.csv
SELECT
  '${STAMP_UTC}' AS snapshot_utc,
  '${DAY_BAKU}' AS snapshot_day_baku,
  COUNT(*) AS containers_total,
  COUNT(*) FILTER (WHERE direction = 'Import') AS import_total,
  COUNT(*) FILTER (WHERE direction = 'Export') AS export_total,
  COUNT(*) FILTER (WHERE status = 'Loaded') AS loaded_total,
  COUNT(*) FILTER (WHERE status = 'Empty') AS empty_total
FROM inventory;

\\o /snapshot/01_current_inventory.csv
SELECT
  block,
  bay,
  row_num,
  tier_num,
  position_code,
  pg_temp.csv_safe(container_id) AS container_id,
  container_type,
  status,
  direction,
  bonded,
  stack_out_date,
  weight,
  pg_temp.csv_safe(commodity) AS commodity,
  pg_temp.csv_safe(line) AS line,
  pg_temp.csv_safe(expeditor) AS expeditor,
  arrived_at,
  positioned_at,
  updated_at
FROM inventory
ORDER BY block, bay, row_num, tier_num, container_id;

\\o /snapshot/02_yard_summary.csv
SELECT
  block,
  direction,
  status,
  container_type,
  COUNT(*) AS containers
FROM inventory
GROUP BY block, direction, status, container_type
ORDER BY block, direction, status, container_type;

\\o /snapshot/03_operations_last_${OPERATION_DAYS}_days.csv
SELECT
  performed_at,
  operation_type,
  pg_temp.csv_safe(container_id) AS container_id,
  pg_temp.csv_safe(old_position_code) AS old_position_code,
  pg_temp.csv_safe(new_position_code) AS new_position_code,
  pg_temp.csv_safe(operator_username) AS operator_username,
  pg_temp.csv_safe(operator_full_name) AS operator_full_name,
  operator_role,
  emergency_override,
  pg_temp.csv_safe(override_reason) AS override_reason
FROM operations_log
WHERE performed_at >= now() - interval '${OPERATION_DAYS} days'
ORDER BY performed_at DESC;

\\o /snapshot/04_users_no_secrets.csv
SELECT
  username,
  role,
  pg_temp.csv_safe(full_name) AS full_name,
  notifications_enabled,
  telegram_notifications_enabled,
  receive_all_movement_alerts,
  created_at,
  is_active,
  deleted_at,
  pg_temp.csv_safe(deleted_by) AS deleted_by
FROM users
ORDER BY is_active DESC, role, username;

\\o /snapshot/05_terminal_blocks.csv
SELECT
  block,
  pg_temp.csv_safe(label) AS label,
  bay_count,
  row_count,
  tier_count,
  pg_temp.csv_safe(equipment) AS equipment
FROM terminal_blocks
ORDER BY block;

\\o /snapshot/06_slot_overrides.csv
SELECT
  slot_code,
  block,
  bay,
  row_num,
  enabled,
  max_tiers,
  allowed_container_types::text AS allowed_container_types,
  pg_temp.csv_safe(notes) AS notes
FROM slot_overrides
ORDER BY block, bay, row_num;

\\o /snapshot/07_notification_logs_last_${NOTIFICATION_DAYS}_days.csv
SELECT
  created_at,
  operation_type,
  pg_temp.csv_safe(container_id) AS container_id,
  success,
  status_code,
  targets::text AS targets,
  pg_temp.csv_safe(left(response_text, 500)) AS response_text
FROM notification_logs
WHERE created_at >= now() - interval '${NOTIFICATION_DAYS} days'
ORDER BY created_at DESC;

\\o
SQL

  run_psql -f /snapshot/export.sql
  rm -f "$RUN_DIR/export.sql"

  cat > "$RUN_DIR/PRINT_FIRST.txt" <<EOF
BitVantage daily human-readable snapshot
Snapshot day Baku: $DAY_BAKU
Created UTC: $STAMP_UTC

Use these files if the application is unavailable and the team needs a printable operational picture:
1. 01_current_inventory.csv
2. 02_yard_summary.csv
3. 03_operations_last_${OPERATION_DAYS}_days.csv
4. 04_users_no_secrets.csv

Security note:
- password_hash and session tokens are intentionally excluded.
- This is not a database restore backup. Restore backups are stored separately under bitvantage-backups/automated.
EOF

  (
    cd "$RUN_DIR"
    rm -f SHA256SUMS.txt
    sha256sum *.csv PRINT_FIRST.txt > SHA256SUMS.txt
    sha256sum -c SHA256SUMS.txt
  )

  rclone sync "$RUN_DIR" "$RCLONE_REMOTE/$DAY_BAKU" --checksum
  rclone copy "$RUN_DIR" "$RCLONE_SHEETS_REMOTE/$DAY_BAKU" \
    --include "*.csv" \
    --drive-import-formats csv \
    --drive-export-formats csv \
    || log "Native Google Sheets conversion failed; raw CSV snapshot remains available in Google Drive."

  find "$SNAPSHOT_ROOT" -mindepth 1 -maxdepth 1 -type d -mtime +"$RETENTION_DAYS" -print -exec rm -rf {} +

  send_success_heartbeat
  log "BitVantage Google snapshot completed successfully."
}

main "$@"
