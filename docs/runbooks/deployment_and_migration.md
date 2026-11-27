# Operational Runbook: Outbound Delivery Deployment and Migration

## 1. Overview and Pre-Deployment Safety
This runbook governs the deployment of the BYOS outbound delivery subsystem, database migration execution, and release rollbacks.

### Safety Invariants
1. **Never apply migrations without an advisory lock:** The canonical migration tool `tools/byos-migrate` must be used. It acquires session-level advisory lock `4780962453531182930` to prevent concurrent runner races.
2. **Never modify running production schemas without dry-run verification:** Check database status via `byos-migrate status` prior to migration.
3. **Database isolation:** Never point migration scripts or test suites to active customer storage or production databases without approval.
4. **Canonical Migration File Ledger:** There are exactly 74 canonical migration files (versions 001–004, 006–075; version 005 was skipped historically in the BYOS architecture). The current production release baseline is version **075**.

---

## 2. Pre-Deployment Checklist
- [ ] Confirm target database host, port, and credentials.
- [ ] Ensure full encrypted database backup is taken using `tools/backup_encrypted.sh` or `tools/backup_encrypted.ps1` (with AES-256-GCM authenticated encryption).
- [ ] Verify WAL archiving continuity via `byos-backup wal-status --archive-dir /var/byos/archive` (status must report `CONTINUOUS (No gaps detected)`).
- [ ] Record exact UTC timestamp prior to deployment start ($T_{\text{pre-deploy}}$) for potential PITR rollback.
- [ ] Verify disk capacity on PostgreSQL host (minimum 25% free disk space).
- [ ] Verify outbound worker binary is built using `services/outbound-worker/Dockerfile.rust` (Rust native binary). Legacy Go worker must remain excluded.
- [ ] Check migration status:
  ```bash
  byos-migrate status --db-url "$DATABASE_URL" --dir infra/postgres/migrations
  ```

---

## 3. Step-by-Step Deployment Procedure

### Step 1: Execute Database Migrations
Run the canonical migration runner:
```bash
byos-migrate up --db-url "$DATABASE_URL" --dir infra/postgres/migrations
```
Verify schema consistency and checksums:
```bash
byos-migrate verify --db-url "$DATABASE_URL" --dir infra/postgres/migrations
```

### Step 2: Secret & Keyring Staging
Ensure the outbound delivery keyring file is provisioned at `/run/secrets/outbound_delivery_keyring.json`:
```json
{
  "keys": [
    {
      "key_epoch": 1,
      "key_id": "<epoch-1-pubkey-hex>",
      "sk_b64": "<base64-secret-key-1>",
      "status": "decrypt_only"
    },
    {
      "key_epoch": 2,
      "key_id": "<epoch-2-pubkey-hex>",
      "sk_b64": "<base64-secret-key-2>",
      "status": "active"
    }
  ]
}
```
Ensure the worker database password file is provisioned at `/run/secrets/outbound_worker_db_password`.

### Step 3: Service Startup Order
Start services in the following strict dependency sequence:
1. `postgres` (Wait for healthy readiness probe)
2. `redis` and `minio` (Wait for healthy readiness probe)
3. `crypto-worker` and `mail-router`
4. `outbound-worker` (Rust worker process)
5. `admin-api`
6. `support-crm`

### Step 4: Post-Deployment Verification
1. Verify worker status and queue connectivity:
   ```bash
   curl -s -H "Cookie: byos_admin_session=$SESSION_TOKEN" http://localhost:8087/admin/v1/queue/overview
   ```
2. Verify Prometheus queue metrics:
   ```bash
   curl -s -H "Cookie: byos_admin_session=$SESSION_TOKEN" http://localhost:8087/admin/v1/queue/metrics
   ```
3. Inspect worker logs for clean lease acquisition:
   ```bash
   docker logs --tail 50 byos-outbound-worker
   ```

---

## 4. Rollback and Forward-Recovery Procedures

### Rollback Strategy for Migrations 073 - 075
If deployment must be halted immediately after applying migrations 073, 074, or 075:
1. **Stop Outbound Worker:** Prevent new lease claims:
   ```bash
   docker stop byos-outbound-worker
   ```
2. **Evaluate Schema Rollback:**
   - Migration 075 introduces:
     - `trg_enforce_support_agent_outbound_queue_boundaries` trigger and `enforce_support_agent_outbound_queue_boundaries()` function.
   - Migration 074 introduces:
     - Column-level SELECT and UPDATE permissions for `role_support_agent`.
   - Migration 073 introduces:
     - `outbound_queue.manual_retry_count` (int, default 0)
     - `outbound_queue.max_manual_retries` (int, default 1)
     - `delivery_operator_idempotency` table
     - `chk_outbound_queue_manual_retry_bounds` check constraint

   To safely roll back to version 072:
   ```sql
   BEGIN;
   -- Rollback 075
   DROP TRIGGER IF EXISTS trg_enforce_support_agent_outbound_queue_boundaries ON outbound_queue;
   DROP FUNCTION IF EXISTS enforce_support_agent_outbound_queue_boundaries();
   DELETE FROM public.schema_migrations WHERE version = '075';

   -- Rollback 074
   DELETE FROM public.schema_migrations WHERE version = '074';

   -- Rollback 073
   DROP TABLE IF EXISTS public.delivery_operator_idempotency CASCADE;
   ALTER TABLE public.outbound_queue DROP CONSTRAINT IF EXISTS chk_outbound_queue_manual_retry_bounds;
   ALTER TABLE public.outbound_queue DROP COLUMN IF EXISTS manual_retry_count;
   ALTER TABLE public.outbound_queue DROP COLUMN IF EXISTS max_manual_retries;
   DELETE FROM public.schema_migrations WHERE version = '073';
   COMMIT;
   ```
3. **Restart Services:** Revert container image tags to C6.5.2 and restart.

### Alternative Disaster Recovery Rollback via PITR
If a catastrophic migration failure, data corruption, or aborted schema evolution occurs:
1. Identify the pre-deployment timestamp recorded during checklist verification ($T_{\text{pre-deploy}}$).
2. Restore the latest base backup taken prior to deployment.
3. Configure Point-in-Time Recovery to rewind database state to $T_{\text{pre-deploy}}$:
   ```bash
   byos-backup prepare-pitr \
     --target-dir "/var/lib/postgresql/data" \
     --restore-cmd "/usr/local/bin/byos-backup restore-wal --archive-dir /var/byos/archive --key-file /etc/byos/keys/backup.key --wal-name %f --target-path %p" \
     --target-time "$PRE_DEPLOY_TIMESTAMP" \
     --target-action "promote"
   ```
4. Start PostgreSQL. Replay will proceed cleanly to the exact second prior to deployment, promote to Timeline 2, and resume operations without data loss. See `docs/runbooks/physical_pitr_recovery.md` and `docs/runbooks/backup_and_disaster_recovery.md` Section 6.

---

## 5. Production Docker Compose Configuration for Continuous WAL Archiving

### Archiving Prerequisites in Compose
To enable continuous WAL archiving in production Compose deployments:
1. Mount the `byos-backup-linux` ELF binary into `/usr/local/bin/byos-backup` (mode `0755`).
2. Mount the 256-bit encryption key file into `/etc/byos/keys/backup.key` (mode `0600`, owned by `postgres:postgres`).
3. Mount the persistent archive storage volume to `/var/byos/archive` (owned by `postgres:postgres` / `uid=70` in Alpine).
4. Supply runtime PostgreSQL configuration flags:
   - `-c wal_level=replica`
   - `-c archive_mode=on`
   - `-c archive_command='/usr/local/bin/byos-backup archive-wal --source-path %p --wal-name %f --archive-dir /var/byos/archive --key-file /etc/byos/keys/backup.key'`
   - `-c archive_timeout=300`

### Production Compose Snippet (`docker-compose.prod.yml`)
```yaml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    container_name: byos-postgres
    restart: always
    command: >
      postgres
      -c wal_level=replica
      -c archive_mode=on
      -c archive_command="/usr/local/bin/byos-backup archive-wal --source-path %p --wal-name %f --archive-dir /var/byos/archive --key-file /etc/byos/keys/backup.key"
      -c archive_timeout=300
    environment:
      POSTGRES_DB: byos
      POSTGRES_USER: byos
      POSTGRES_PASSWORD_FILE: /run/secrets/postgres_password
    volumes:
      - postgres-data:/var/lib/postgresql/data
      - postgres-archive:/var/byos/archive
      - ./tools/byos-backup/byos-backup-linux:/usr/local/bin/byos-backup:ro
      - ./secrets/backup.key:/etc/byos/keys/backup.key:ro
    ports:
      - "127.0.0.1:5432:5432"
    secrets:
      - postgres_password

volumes:
  postgres-data:
  postgres-archive:
    driver: local

secrets:
  postgres_password:
    file: ./secrets/postgres_password.txt
```

---

## 6. Controlled Operator Activation & Rollback Procedure for Active Database (`byos-postgres`)

This section documents the exact, safe procedure an operator must follow to transition the active, running database from `archive_mode = off` to continuous encrypted WAL archiving once operator deployment authorization is granted.

> [!CAUTION]
> The active `byos-postgres` container (`d1e245e8d561`) and volume (`byos-email_postgres-data`) must NOT be restarted or modified without explicit operator sign-off and maintenance window scheduling.

### Phase 1: Pre-Activation Health and Configuration Verification
Before executing any container changes, verify existing database and file state:
1. Verify container status and health:
   ```bash
   docker ps -f name=byos-postgres
   ```
2. Inspect current PostgreSQL archiving settings:
   ```bash
   docker exec byos-postgres psql -U byos -d byos -c "SHOW wal_level; SHOW archive_mode; SHOW archive_command; SHOW archive_timeout; SELECT * FROM pg_stat_archiver;"
   ```
3. Verify host encryption key permissions and availability:
   ```bash
   ls -la infra/secrets/backup.key
   # Permissions must be 0600 or 0400, owned by the operator
   ```
4. Verify Linux backup tool binary:
   ```bash
   ls -la tools/byos-backup/byos-backup-linux
   # Must be executable (0755) and match target architecture (Linux x86_64 ELF)
   ```
5. Validate Compose file syntax:
   ```bash
   docker compose -f infra/docker-compose.yml config --quiet
   ```

### Phase 2: Controlled Activation Procedure
1. Capture pre-activation physical or encrypted logical backup:
   ```bash
   powershell -File tools/backup_encrypted.ps1 -DatabaseUrl "postgres://byos:byos_dev_password@127.0.0.1:5432/byos" -KeyFile "infra/secrets/backup.key" -OutputDir "backups"
   ```
2. Record pre-activation timestamp for auditing and rollback:
   ```bash
   docker exec byos-postgres psql -U byos -d byos -t -A -c "SELECT clock_timestamp()::text;"
   ```
3. Recreate the `postgres` service with the updated Compose configuration:
   ```bash
   docker compose -f infra/docker-compose.yml up -d postgres
   ```
4. Wait for healthy readiness status:
   ```bash
   docker compose -f infra/docker-compose.yml ps postgres
   ```

### Phase 3: Post-Activation Verification Checks
1. Query active settings to ensure archiving flags took effect:
   ```bash
   docker exec byos-postgres psql -U byos -d byos -c "SHOW wal_level; SHOW archive_mode; SHOW archive_command; SHOW archive_timeout;"
   ```
   *Expected settings:*
   - `wal_level = replica`
   - `archive_mode = on`
   - `archive_command = /usr/local/bin/byos-backup archive-wal --source-path %p --wal-name %f --archive-dir /var/byos/archive --key-file /etc/byos/keys/backup.key`
   - `archive_timeout = 5min` (300s)
2. Force an immediate WAL segment rotation:
   ```bash
   docker exec byos-postgres psql -U byos -d byos -c "SELECT pg_switch_wal();"
   ```
3. Check `pg_stat_archiver` to confirm zero failures and incremented archived count:
   ```bash
   docker exec byos-postgres psql -U byos -d byos -x -c "SELECT * FROM pg_stat_archiver;"
   ```
   *Required invariants:* `failed_count == 0`, `archived_count >= 1`.
4. Inspect the archive volume to verify `.enc` and `.meta.json` artifacts:
   ```bash
   docker exec byos-postgres ls -lh /var/byos/archive/wal
   ```
5. Check archive integrity and continuity via `wal-status`:
   ```bash
   ./tools/byos-backup/byos-backup.exe wal-status --archive-dir /var/byos/archive
   ```

### Phase 4: Emergency Rollback Procedure
If the archiver fails (`failed_count > 0`) or the container fails to become healthy after activation:
1. Check logs to diagnose cause:
   ```bash
   docker logs --tail 100 byos-postgres
   ```
2. If directory permissions error:
   ```bash
   docker exec byos-postgres chown -R postgres:postgres /var/byos/archive && chmod 700 /var/byos/archive
   ```
3. If an immediate rollback to unarchived mode is required:
   - Edit `infra/docker-compose.yml` to remove the `entrypoint` override from `services.postgres`.
   - Re-run:
     ```bash
     docker compose -f infra/docker-compose.yml up -d postgres
     ```
   - Verify PostgreSQL starts with `archive_mode = off`.
   - All customer data in volume `postgres-data` remains fully preserved.

---

## 7. Opt-In Off-Site Replication Gate (Release C6.9)
- Remote S3-compatible replication (`BYOS_BACKUP_REMOTE_ENABLED`, `BYOS_BACKUP_REMOTE_REQUIRED`) must remain `false` on active `byos-postgres` until Stage B operator approval is granted for a live off-site provider and bucket.
- Never enable `BYOS_BACKUP_REMOTE_REQUIRED=true` without verifying `byos-backup remote-status` and `pg_wal` disk capacity alerts first. See [`docs/runbooks/offsite_disaster_recovery.md`](file:///f:/Codex/byos-email/docs/runbooks/offsite_disaster_recovery.md).


