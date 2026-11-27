# Operational Runbook: Off-Site Backup & Remote-Only Disaster Recovery (C6.9)

## 1. Remote Storage Configuration
Configure non-secret environment variables in `.env` or container runtime:
```text
BYOS_BACKUP_REMOTE_ENABLED=true
BYOS_BACKUP_REMOTE_ENDPOINT=https://s3.us-east-1.amazonaws.com
BYOS_BACKUP_REMOTE_REGION=us-east-1
BYOS_BACKUP_REMOTE_BUCKET=<approved-bucket-name>
BYOS_BACKUP_REMOTE_PREFIX=byos-prod
BYOS_BACKUP_REMOTE_PATH_STYLE=false
BYOS_BACKUP_REMOTE_REQUIRED=false   # Keep false until remote path is verified end-to-end
```
Provision credentials exclusively via IAM roles or mounted secret files (`BYOS_BACKUP_REMOTE_ACCESS_KEY_FILE`, `BYOS_BACKUP_REMOTE_SECRET_KEY_FILE`). Never pass credentials on CLI flags or commit them to Git.

---

## 2. Encrypted WAL Replication & Dual-Destination Modes
- **Optional Mode (`BYOS_BACKUP_REMOTE_REQUIRED=false`):** `byos-backup archive-wal` writes encrypted WAL locally first, then attempts remote upload. Remote failures emit warnings and are surfaced by `remote-status`, while local archiving continues.
- **Required Mode (`BYOS_BACKUP_REMOTE_REQUIRED=true`):** `archive-wal` returns nonzero to PostgreSQL if remote upload or post-upload verification fails. Local encrypted WAL is preserved and PostgreSQL retains `.ready` status to retry automatically.

---

## 3. Physical Base Backup Upload & Recovery Catalog Publication
1. Capture physical base backup (`pg_basebackup -Ft -z -X none`) and encrypt via `byos-backup encrypt-bundle`.
2. Publish atomically to remote storage (catalog committed last after all WAL & manifest dependencies verify):
```bash
byos-backup recovery-catalog --action publish \
  --archive-dir /var/byos/archive \
  --backup-id <backup-id> \
  --system-id <pg-system-id> \
  --pg-version 16.15 \
  --start-lsn <start-lsn> \
  --stop-lsn <stop-lsn> \
  --timeline 1 \
  --required-wals <comma-separated-wals> \
  --backup-history <backup-history-file> \
  --key-version v1 \
  --key-file /etc/byos/keys/backup.key \
  --base-file <path-to-base.tar.enc> \
  --manifest-file <path-to-backup_manifest>
```

---

## 4. Remote Monitoring & Verification
- Check remote health, lag, pending local objects, and key availability:
  ```bash
  byos-backup remote-status --archive-dir /var/byos/archive --key-file /etc/byos/keys/backup.key
  ```
- Verify full dependency graph of all cataloged recovery points:
  ```bash
  byos-backup remote-verify --key-file /etc/byos/keys/backup.key
  ```
- Check remote recovery readiness gate:
  ```bash
  byos-backup remote-recovery-check --key-file /etc/byos/keys/backup.key
  ```

---

## 5. Remote Outage & Backlog Synchronization
During a remote endpoint outage:
1. Local `pg_wal` and `/var/byos/archive/wal` will grow if `BYOS_BACKUP_REMOTE_REQUIRED=true`. Monitor disk capacity (`df -h`). **Never delete unarchived WAL files.**
2. Once remote connectivity returns, run:
   ```bash
   byos-backup remote-sync --archive-dir /var/byos/archive
   ```
   (`remote-sync` uploads missing encrypted WALs idempotently and never deletes local files.)

---

## 6. Remote-Only Physical PITR (Complete Host Loss)
On a brand-new host with zero access to the lost primary server:
1. Retrieve decryption key versions (`v1`, `v2`, ...) from the independent KMS / offline recovery key store (set `BYOS_BACKUP_ENCRYPTION_KEY` / `BYOS_BACKUP_KEY_V1`, etc., or mount read-only key file outside the restore directory).
2. Inspect available remote recovery points:
   ```bash
   byos-backup recovery-catalog --action list
   ```
3. Fetch and decrypt the target encrypted base backup:
   ```bash
   byos-backup remote-fetch --object-key backups/<backup-id>/base.tar.enc --out-file /tmp/base.tar.enc
   byos-backup decrypt-bundle --in-file /tmp/base.tar.enc --out-dir /tmp/dec_base --key-file /etc/byos/recovery_keys/backup.key
   ```
4. Extract `/tmp/dec_base/database.dump` (`base.tar.gz`) into clean `$PGDATA` (`chown 70:70`, `chmod 700`), create `pg_wal/`, touch `recovery.signal`, and configure `postgresql.auto.conf`:
   ```text
   restore_command = '/usr/local/bin/byos-backup restore-wal --remote --wal-name %f --target-path %p --key-file /etc/byos/recovery_keys/backup.key'
   recovery_target_time = '<YYYY-MM-DD HH:MM:SS UTC>'
   recovery_target_action = 'promote'
   ```
5. Start PostgreSQL, verify `pg_is_in_recovery() = f`, verify promoted timeline (`Timeline 2+`), and validate application tables before cutting over DNS/traffic.

---

## 7. Dependency-Aware Remote Retention & Pruning
1. Always inspect candidates first (dry-run is the default):
   ```bash
   byos-backup remote-prune --daily-days 7 --weekly-weeks 4 --monthly-months 12
   ```
2. Only execute deletion using `retention-admin` credentials with explicit confirmation and audit logging:
   ```bash
   byos-backup remote-prune --confirm-delete --audit-log /var/log/byos-remote-prune.log
   ```
   (The sole surviving recovery point and all WALs/history files required by any retained backup are strictly protected.)
