# BitVantage Backup And Restore Runbook

This project uses two backup layers:

- Git/source backups in `UntLab/codex`, branch `backups`, with secrets excluded.
- Production data backups on `apps-01-cloud` under `/srv/stacks/bitvantage/backups/automated`, with encrypted offsite packages copied through the configured root `rclone` remote.

## Backup Schedule

The server timer `bitvantage-backup.timer` runs every 4 hours.

Each run creates:

- `bitvantage-public-<timestamp>.dump`: PostgreSQL custom-format dump of the `public` schema.
- `bitvantage-full-<timestamp>.dump`: PostgreSQL custom-format dump of the full Supabase database.
- `*.toc`: `pg_restore -l` listing for quick integrity inspection.
- `bitvantage-stack-<timestamp>.tar.gz`: server stack archive excluding previous backups.
- `SHA256SUMS.txt`: checksum verification file.
- `bitvantage-backup-<timestamp>.tar.gz.enc`: encrypted offsite package when the passphrase file is present.

## Operator Commands

Check timer:

```bash
ssh apps-01-cloud 'systemctl list-timers bitvantage-backup.timer --all'
```

Run a backup manually:

```bash
ssh apps-01-cloud 'sudo systemctl start bitvantage-backup.service'
```

View recent backup logs:

```bash
ssh apps-01-cloud 'sudo journalctl -u bitvantage-backup.service -n 120 --no-pager'
```

Verify latest local backup checksums:

```bash
ssh apps-01-cloud 'cd /srv/stacks/bitvantage/backups/automated/$(ls -1 /srv/stacks/bitvantage/backups/automated | sort | tail -1) && sha256sum -c SHA256SUMS.txt'
```

## Monitoring

Uptime Kuma monitors are configured for:

- `BitVantage production healthz`: checks `https://bitvantage.online/healthz`.
- `BitVantage backup heartbeat`: receives a push heartbeat after every successful backup.
- `BitVantage Google snapshot heartbeat`: receives a push heartbeat after every successful printable Google Drive snapshot.

Both monitors are linked to the existing Telegram infrastructure notification channel.

Check recent heartbeat records:

```bash
ssh apps-01-cloud 'docker exec uptime-kuma sh -lc "sqlite3 /app/data/kuma.db \"select monitor_id,status,msg,ping,time from heartbeat where monitor_id in (select id from monitor where name like '\''BitVantage%'\'') order by id desc limit 10;\""'
```

## Daily Printable Google Drive Snapshot

The server also creates a human-readable operational snapshot every day at 22:00 Asia/Baku.

Timer:

```bash
ssh apps-01-cloud 'systemctl list-timers bitvantage-google-snapshot.timer --all'
```

Run manually:

```bash
ssh apps-01-cloud 'sudo systemctl start bitvantage-google-snapshot.service'
```

Local path:

```text
/srv/stacks/bitvantage/backups/google-snapshots/YYYY-MM-DD
```

Google Drive path:

```text
gdrive-nextcloud:bitvantage-snapshots/daily/YYYY-MM-DD
```

Files:

- `01_current_inventory.csv`: current yard state for printing.
- `02_yard_summary.csv`: count summary by block, direction, status, and type.
- `03_operations_last_30_days.csv`: recent movement log.
- `04_users_no_secrets.csv`: user list without password hashes or session tokens.
- `05_terminal_blocks.csv`: block layout.
- `06_slot_overrides.csv`: slot restrictions.
- `07_notification_logs_last_7_days.csv`: recent notification delivery attempts.
- `PRINT_FIRST.txt`: emergency usage note.
- `SHA256SUMS.txt`: checksum verification.

## Restore Notes

For app-table restore, prefer the `public` dump first. Use a staging database before production restore.

Example restore listing:

```bash
pg_restore -l bitvantage-public-YYYY-MM-DDTHH-MM-SSZ.dump
```

Example restore into a prepared PostgreSQL database:

```bash
pg_restore --clean --if-exists --no-owner --no-privileges --dbname "$DATABASE_URL" bitvantage-public-YYYY-MM-DDTHH-MM-SSZ.dump
```

Do not restore directly into production until a fresh backup exists and the owner approves the restore window.
