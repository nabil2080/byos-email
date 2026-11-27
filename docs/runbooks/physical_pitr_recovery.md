# Operational Runbook: Physical Point-in-Time Recovery (PITR) & Base Backup Restoration

## 1. Overview and Invariants

This runbook defines the authoritative, step-by-step procedure for performing a **physical Point-in-Time Recovery (PITR)** on a BYOS PostgreSQL cluster.

### Critical Distinction: Physical PITR vs Logical Restoration vs Full-Stack PITR
| Attribute | Pure Physical PostgreSQL PITR | Full-Stack Physical PITR | Logical Backup (`database.dump`) |
|---|---|---|---|
| **Underlying Tooling** | `pg_basebackup` (tar format) + continuous encrypted WAL replay | Base backup + encrypted WAL replay + Redis + BYOS API `/health` | `pg_dump -Fc` + `pg_restore` + `globals.sql` |
| **Recovery Mechanism** | Replays exact write-ahead log records up to transaction boundary | Physical DB recovery + service dependency start + API healthcheck | Drops and re-executes DDL, re-inserts data, rebuilds indexes |
| **Target Precision** | Exact microsecond timestamp or transaction ID prior to disaster | Exact microsecond timestamp with verified app readiness | Snapshot timestamp only (discrete point in time) |
| **Schema State** | Exact byte-for-byte replica of binary database cluster | Active production schema (Migration 075 verified) | Re-migrated relational objects |
| **Typical Cold RTO** | **~5.5 - 7.5 seconds** (C6.8.1: 5.902s, C6.8.2: 5.503s / 7.507s) | **~39.0 seconds** (C6.8.2: 39.013s) | **~15.4 seconds** (Measured C6.8: 15.426s) |
| **Primary Use Case** | PostgreSQL host loss, hardware corruption, immediate rollbacks | Complete multi-tier disaster recovery from cold storage | Tenant migration, offsite cold archival, schema inspection |

### Non-Negotiable Operational Invariants
1. **Never perform PITR in-place on live data without a pre-recovery snapshot.**
2. **Never modify or delete original encrypted WAL segments.** All operations on the archive are read-only.
3. **Target Data Directory Ownership:** The target data directory must be mode `0700` and owned by `postgres:postgres` (`uid=70` in Alpine Linux containers, `uid=999` in Debian containers).
4. **Key Isolation:** The decryption key must reside outside both the PostgreSQL data directory and the archive directory, with permissions mode `0600`.
5. **Timeline Progression:** Completing PITR advances PostgreSQL to a new timeline (e.g. Timeline 1 to Timeline 2). Never force replay to remain on Timeline 1 after recovery promotion.

---

## 2. Recovery Scenarios

The BYOS PITR architecture supports two operational recovery targets:

- **Scenario A: Point-in-Time Recovery to Exact Timestamp ($T_{\text{target}}$):**
  Used to recover from human error (e.g. accidental `DROP TABLE` or bad migration) by stopping immediately prior to the offending transaction commit.
- **Scenario B: Recovery to Latest Available State ($T_{\text{latest}}$):**
  Used after catastrophic host loss or power outage to restore the cluster to the most recent committed transaction captured in the encrypted WAL archive.

---

## 3. Step-by-Step Execution Procedure

### Step 1: Pre-Recovery Assessment and Inventory
Inspect the storage archive to determine the oldest and newest available WAL segments and verify sequence continuity:
```bash
byos-backup wal-status --archive-dir /var/byos/archive
```
Expected output:
```
==================================================
BYOS WAL Archive Status Report
==================================================
Total Segments:    X
History Files:     Y
Archive Disk Size: ...
Oldest WAL:        000000010000000000000001 (...)
Newest WAL:        00000001000000000000000N (...)
Archive Lag:       ...
Sequence Check:    CONTINUOUS (No gaps detected)
==================================================
```
> [!IMPORTANT]
> If `Sequence Check` reports a sequence gap between required segments, recovery cannot cross the gap. Target time must be set prior to the gap, or the missing segment must be restored from secondary storage.

---

### Step 2: Base Backup Selection & Unpacking
Select the latest base backup whose `start_time` is prior to the intended recovery target timestamp:

1. Retrieve the encrypted base backup bundle:
   ```bash
   # Bundle located at /var/byos/archive/backups/basebackup_<id>.enc
   ```
2. Decrypt the base backup package:
   ```bash
   byos-backup decrypt-bundle \
     --in-file "/var/byos/archive/backups/basebackup_<id>.enc" \
     --out-dir "/tmp/unpacked_base" \
     --key-file "/etc/byos/keys/backup.key"
   ```
3. Initialize a clean target PostgreSQL data directory and unpack:
   ```bash
   TARGET_DATA="/var/lib/postgresql/data"
   rm -rf "$TARGET_DATA"/*
   mkdir -p "$TARGET_DATA"
   chmod 700 "$TARGET_DATA"

   tar -xf /tmp/unpacked_base/base.tar -C "$TARGET_DATA"
   ```
4. Verify manifest and starting WAL:
   Inspect `manifest.json` inside the base backup to record `start_wal` and `required_wals`.

---

### Step 3: Configure PITR & Write Recovery Signals
Run `byos-backup prepare-pitr` to generate `recovery.signal` and configure `postgresql.auto.conf`:

#### For Scenario A (Target Timestamp):
```bash
byos-backup prepare-pitr \
  --target-dir "/var/lib/postgresql/data" \
  --restore-cmd "/usr/local/bin/byos-backup restore-wal --archive-dir /var/byos/archive --key-file /etc/byos/keys/backup.key --wal-name %f --target-path %p" \
  --target-time "2026-11-24 14:30:00 UTC" \
  --target-action "promote"
```

#### For Scenario B (Latest State):
```bash
byos-backup prepare-pitr \
  --target-dir "/var/lib/postgresql/data" \
  --restore-cmd "/usr/local/bin/byos-backup restore-wal --archive-dir /var/byos/archive --key-file /etc/byos/keys/backup.key --wal-name %f --target-path %p" \
  --target-action "promote"
```

This automated command ensures:
- `recovery.signal` is created in `/var/lib/postgresql/data`.
- `postgresql.auto.conf` contains:
  ```ini
  restore_command = '/usr/local/bin/byos-backup restore-wal --archive-dir /var/byos/archive --key-file /etc/byos/keys/backup.key --wal-name %f --target-path %p'
  recovery_target_time = '2026-11-24 14:30:00 UTC' # (omitted in Scenario B)
  recovery_target_action = 'promote'
  recovery_target_inclusive = 'true'
  ```

---

### Step 4: Fix Ownership & Permissions
Ensure container or host daemon user owns the data directory:
```bash
# In Docker/Alpine environments:
chown -R 70:70 /var/lib/postgresql/data
chmod 700 /var/lib/postgresql/data
```

---

### Step 5: Start PostgreSQL & Monitor Archive Recovery
Start the PostgreSQL instance:
```bash
docker run -d --name byos-postgres-recovery \
  -v /var/lib/postgresql/data:/var/lib/postgresql/data \
  -v /var/byos/archive:/var/byos/archive:ro \
  -v /etc/byos/keys:/etc/byos/keys:ro \
  -p 5432:5432 \
  postgres:16-alpine
```

Monitor container logs:
```bash
docker logs -f byos-postgres-recovery
```

Expected log sequence:
1. `LOG: starting point-in-time recovery to 2026-11-24 14:30:00+00`
2. `LOG: restored log file "000000010000000000000001" from archive`
3. `LOG: redo starts at 0/1000028`
4. `LOG: restored log file "000000010000000000000002" from archive`
5. `LOG: recovery stopping before commit of transaction 735, time 2026-11-24 14:30:05.123456+00`
6. `LOG: selected new timeline ID: 2`
7. `LOG: archive recovery complete`
8. `LOG: database system is ready to accept connections`

---

### Step 6: Post-Recovery Validation
Verify cluster timeline and database contents:
```sql
-- 1. Verify timeline ID
SELECT timeline_id, redo_lsn FROM pg_control_checkpoint();

-- 2. Verify read-write capability
CREATE TABLE pitr_health_check (id serial primary key, restored_at timestamptz default now());
INSERT INTO pitr_health_check DEFAULT VALUES;
SELECT * FROM pitr_health_check;
DROP TABLE pitr_health_check;

-- 3. Verify application schema consistency
SELECT count(*) FROM organizations;
SELECT count(*) FROM users;
SELECT count(*) FROM outbound_queue;
```

---

## 4. Troubleshooting and Edge Cases

### Case 1: `FATAL: recovery ended before configured recovery target was reached`
- **Root Cause:** PostgreSQL was instructed to stop at target time $T$, but the archived WAL stream ended before reaching a transaction committed at or after $T$.
- **Resolution:** Verify whether unarchived WAL segments remain on the original host in `pg_wal/`. If the host is lost and no further WAL exists, remove `recovery_target_time` from `postgresql.auto.conf` to recover up to the latest available transaction.

### Case 2: `cipher: message authentication failed`
- **Root Cause:** A WAL segment in the archive was corrupted, tampered with, or encrypted with a key version not configured in KMS.
- **Resolution:**
  1. Inspect the metadata sidecar `/var/byos/archive/wal/<segment>.meta.json` to verify the required `key_version`.
  2. Verify that `BYOS_BACKUP_ENCRYPTION_KEY` or `BYOS_BACKUP_KEY_<VERSION>` matches the sidecar key version.
  3. If corruption is on disk, restore the `.enc` segment from the independent offsite replica.

### Case 3: `FATAL: could not locate required checkpoint record` (Scenario C Missing-WAL Gap)
- **Root Cause:** A required WAL segment (specifically the checkpoint redo segment named in `backup_label`) is missing from the archive and is absent from local `pg_wal`.
- **Verified Behavior & Expected Logging (C6.8.2 Evidence Closure):**
  When the required starting redo segment is missing:
  1. PostgreSQL invokes `restore_command` requesting the required segment (e.g. `000000010000000000000003`).
  2. `byos-backup restore-wal` returns exit code 1 because the segment file does not exist in `/var/byos/archive/wal/`.
  3. PostgreSQL halts immediately without replaying any WAL records.
  4. The server log displays:
     ```text
     LOG:  starting archive recovery
     LOG:  starting backup recovery with redo LSN 0/3000028, checkpoint LSN 0/3000060, on timeline ID 1
     LOG:  invalid checkpoint record
     FATAL:  could not locate required checkpoint record
     LOG:  startup process (PID ...) exited with exit code 1
     LOG:  shutting down due to startup process failure
     LOG:  database system is shut down
     ```
  5. The target container terminates with status `exited` and `ExitCode: 1`. Zero connections are accepted.
  > [!NOTE]
  > In C6.8.1, the report previously contained a logging contradiction where segment 3 was reported restored due to a test script transition from segment 4 to segment 3. C6.8.2 conclusively verified that when segment 3 is absent, NO `restored log file` message is emitted for segment 3, and PostgreSQL fails closed immediately.

### Case 4: Interrupted Recovery (Container/Host Crash Mid-Replay)
- **Root Cause:** The recovery process was interrupted before completing.
- **Resolution:** Do NOT re-extract the base backup. Restart PostgreSQL directly against `/var/lib/postgresql/data`. Because `recovery.signal` is only removed upon successful completion, PostgreSQL will resume recovery from the last checkpoint record in the data directory and continue replaying WAL segments to completion.

---

## 5. Commit-to-Independent-Storage RPO Model

PostgreSQL WAL archiving mechanics govern commit-to-independent-storage durability:

1. **Measurement Definition:**
   $$\text{Measured RPO} = T_{\text{measurement}} - T_{\text{commit of latest recoverable transaction in storage}}$$
2. **Idle Traffic Profile (archive_timeout flush):**
   - Controlled by `archive_timeout = 300` (in staging/production) or `10s` (in controlled tests).
   - *Mechanic:* `archive_timeout` forces a WAL segment switch periodically **only if** write activity has occurred since the previous switch. If zero bytes are written to the database, PostgreSQL intentionally does NOT force segment switches, avoiding empty archive churn. Once any transaction commits, the timer ensures the segment closes and archives within the timeout window.
   - *Measured RPO (Test):* 8.03 seconds (bounded by 10s timeout). Staging/production expectation: $\le 300\text{ seconds}$.
3. **Low Traffic Profile (periodic commits):**
   - With explicit or event-driven segment closures, individual commit-to-archive latency averages **385.26 ms** (Min: 361.98 ms, Max: 394.36 ms).
4. **High Traffic Profile (sustained burst ingestion):**
   - PostgreSQL serializes `archive_command` invocations (1 process at a time).
   - Under heavy bursts, `.ready` files temporarily queue in `pg_wal/archive_status`.
   - Measured archival throughput is **52.69 MB/s** (3 segments / 48 MB drained in 561 ms).
   - Maximum backlog age during burst ingestion is bounded by drain duration ($< 1\text{ second}$).
5. **Destination Outage Profile:**
   - When independent storage is unavailable, `archive_command` exits non-zero.
   - Primary database operations proceed normally without transaction aborts, queueing `.ready` files in `pg_wal`.
   - RPO expands linearly with outage duration: $\text{RPO} = T_{\text{outage\_elapsed}}$.
   - When storage recovers, PostgreSQL replays the queued backlog in strict sequential order.
   - C6.8.2 validated 100% data recovery (including all outage markers) with zero data loss.
> [!IMPORTANT]
> All measurements in this runbook reflect **local independent-storage RPO** (separate Docker volume mounts on the same host). True off-site RPO will include remote network latency and cloud object store upload duration.

---

## 6. Benchmarks and RTO Reference

Verified under C6.8.2 automated disaster recovery testing (`tests/disaster_recovery_pitr_cold_drill.ps1` and `tests/disaster_recovery_fullstack_pitr_drill.ps1`):

### Pure Physical PostgreSQL PITR RTO (~5.5 - 7.5 seconds)
| Stage | Operation | Duration (ms) | Duration (s) |
|---|---|---|---|
| **Stage 1** | Disposable Recovery Environment Provisioning | 282.97 ms | 0.283 s |
| **Stage 2** | Base Backup Retrieval | 7.77 ms | 0.008 s |
| **Stage 3** | Base Backup Decryption (AES-256-GCM) | 237.28 ms | 0.237 s |
| **Stage 4** | Physical Unpack & Permissions (70:70) | 1953.82 ms | 1.954 s |
| **Stage 5** | PITR Configuration (`prepare-pitr`) | 813.44 ms | 0.813 s |
| **Stage 6 & 7** | PostgreSQL Startup, WAL Replay & Promotion | 2003.83 ms | 2.004 s |
| **Stage 8** | Data Validation & Timeline Verification | 204.26 ms | 0.204 s |
| **SUBTOTAL** | **Pure Physical PostgreSQL PITR RTO** | **5503.37 ms** | **5.503 s** |

### Full-Stack Physical Disaster Recovery RTO (~39.0 seconds)
| Stage | Component / Phase | Duration (ms) | Duration (s) |
|---|---|---|---|
| **Stage 1** | Infrastructure & Redis Dependency Provisioning | 1175.76 ms | 1.176 s |
| **Stage 2** | Base Backup Retrieval | 9.15 ms | 0.009 s |
| **Stage 3** | Base Backup Decryption (AES-256-GCM) | 312.94 ms | 0.313 s |
| **Stage 4** | Physical Extraction & Permissions Setup | 2591.14 ms | 2.591 s |
| **Stage 5** | PITR Configuration Setup | 1339.52 ms | 1.340 s |
| **Stage 6 & 7** | PostgreSQL Startup, WAL Replay & Promotion | 2078.81 ms | 2.079 s |
| **Stage 8** | BYOS API Application Startup | 32.01 ms | 0.032 s |
| **Stage 9** | Healthcheck Stabilization (`/health` HTTP 200) | 30878.32 ms | 30.878 s |
| **Stage 10** | Application Query & Entity Verification | 546.39 ms | 0.546 s |
| **TOTAL** | **Full-Stack Physical Disaster Recovery RTO** | **39012.97 ms** | **39.013 s** |

---

## 7. Remote-Only S3 PITR (Release C6.9)
When recovering from complete host loss where `/var/byos/archive` is unavailable:
- Fetch the encrypted base backup via `byos-backup remote-fetch --object-key backups/<backup-id>/base.tar.enc --out-file /tmp/base.tar.enc`.
- Configure `restore_command` with `--remote`:
  ```text
  restore_command = '/usr/local/bin/byos-backup restore-wal --remote --wal-name %f --target-path %p --key-file /etc/byos/recovery_keys/backup.key'
  ```
- See [`docs/runbooks/offsite_disaster_recovery.md`](file:///f:/Codex/byos-email/docs/runbooks/offsite_disaster_recovery.md) for the full remote-only recovery procedure.
