# Controlled WAL Activation & First Production Recovery Chain (Release C6.8.4) Report

## A. Executive Summary
Release C6.8.4 executed the controlled, operator-approved activation of continuous AES-256-GCM encrypted WAL archiving on the active BYOS PostgreSQL deployment (`byos-postgres`) via `infra/docker-compose.yml`. Prior to restarting the active container, a full pre-activation physical base backup and auxiliary logical backup were captured, encrypted, and validated on an isolated restoration target. After receiving explicit operator approval (`APPROVE ACTIVATION`), the PostgreSQL service was recreated with service-scoped Compose isolation (`docker compose -p byos-email -f infra/docker-compose.yml up -d --no-deps postgres`), preserving `byos-email_postgres-data` and mounting persistent archive volume `byos-email_postgres-archive`. Continuous encrypted WAL archiving, byte-exact WAL restoration, fail-closed integrity checks, a post-activation physical baseline (`pg_basebackup`), and a full isolated PITR recovery chain promoting to Timeline 2 in 8.959 seconds were all established and observed.

---

## B. Initial State

### Active Container Identity (Pre-Activation)
- **Container ID:** `d1e245e8d561f33626ce4cbe4018be75b19ace9d5a79f0e864caa247d0f6a579`
- **Container Name:** `/byos-postgres`
- **Compose Project:** `byos-email`
- **Compose Service:** `postgres`
- **Compose Configuration:** `F:\Codex\byos-email\infra\docker-compose.yml`
- **Image:** `postgres:16-alpine` (`16.15-alpine3.24`)
- **Attached Data Volume:** `byos-email_postgres-data:/var/lib/postgresql/data:rw`

### Original PostgreSQL Settings (Read-Only Query)
Command:
```bash
docker exec byos-postgres psql -U byos -d byos -c "SHOW server_version; SHOW wal_level; SHOW archive_mode; SHOW archive_command; SHOW archive_library; SHOW archive_timeout; SHOW data_directory; SELECT archived_count, last_archived_wal, last_archived_time, failed_count, last_failed_wal, last_failed_time FROM pg_stat_archiver;"
```
Output:
```text
 server_version 
----------------
 16.15
(1 row)

 wal_level 
-----------
 replica
(1 row)

 archive_mode 
--------------
 off
(1 row)

 archive_command 
-----------------
 (disabled)
(1 row)

 archive_library 
-----------------
 
(1 row)

 archive_timeout 
-----------------
 0
(1 row)

      data_directory      
--------------------------
 /var/lib/postgresql/data
(1 row)

 archived_count | last_archived_wal | last_archived_time | failed_count | last_failed_wal | last_failed_time 
----------------+-------------------+--------------------+--------------+-----------------+------------------
              0 |                   |                    |            0 |                 | 
(1 row)
```

---

## C. Pre-Activation Backup

Command:
```bash
powershell -ExecutionPolicy Bypass -File tests/create_and_verify_preactivation_backup.ps1
```
Output:
```text
================================================================
BYOS C6.8.4: Pre-Activation Safety Backup & Verification
Source Container: byos-postgres (port 5432)
Destination:      F:\Codex\byos-email\backups\pre_activation_c684
================================================================

[Stage 1] Executing non-intrusive pg_basebackup against active byos-postgres...
  -> Captured base.tar.gz (41681478 bytes)
  -> Captured backup_manifest (2398286 bytes)
  -> Captured pg_wal.tar.gz (17100 bytes)

[Stage 2] Inspecting cluster control data from active byos-postgres...
  - System Identifier:   7691245582692712482
  - PostgreSQL Version:  16.15
  - Manifest Version:    1
  - Timeline ID:         1
  - Start LSN:           0/A0000028
  - Stop LSN:            0/A0000138
  - Bytes per WAL:       16777216

[Stage 3] Encrypting physical base backup package using AES-256-GCM...
==================================================
SUCCESS: Encrypted backup archive created!
Output File:    F:\Codex\byos-email\backups\pre_activation_c684\byos_physical_pre_activation.tar.enc
Encrypted Size: 41277525 bytes
Cipher:         AES-256-GCM (Authenticated)
==================================================

[Stage 4] Verifying encryption integrity of physical backup bundle...
==================================================
SUCCESS: Encrypted archive integrity and key verified!
Archive File:   F:\Codex\byos-email\backups\pre_activation_c684\byos_physical_pre_activation.tar.enc
Dump Size:      41681478 bytes
Globals Size:   17100 bytes
Authentication: AES-256-GCM Tag MATCHED
==================================================

[Stage 6] Performing isolated restoration test on temporary container (byos-c684-preflight-verify)...
  -> Verification container is query-ready.
  (26 rows in pg_database)
  -> Public tables present in restored database: 52

[Stage 7] Capturing auxiliary encrypted logical backup bundle via backup_encrypted.ps1...
==================================================
BACKUP SUCCESSFUL
Archive:  F:\Codex\byos-email\backups\pre_activation_c684\byos_backup_20261125_062029.enc
Size:     862341 bytes
==================================================
```

---

## D. Key and Storage Validation

### Git Exclusion and Key Metadata (No Key Contents Exposed)
Command:
```bash
git check-ignore -v infra/secrets/backup.key ; git ls-files --error-unmatch infra/secrets/backup.key
```
Output:
```text
.gitignore:44:infra/secrets/	infra/secrets/backup.key
error: pathspec 'infra/secrets/backup.key' did not match any file(s) known to git
```

Command:
```powershell
Get-Item infra/secrets/backup.key | Select-Object Length, Mode, LastWriteTime
```
Output:
```text
Length Mode   LastWriteTime        
------ ----   -------------        
    64 -a---- 11/24/2026 6:23:24 PM
```

### Archive Storage and Capacity
- Persistent Archive Volume: `byos-email_postgres-archive` mounted at `/var/byos/archive` (mode `0700`, owner `postgres:postgres`).
- Available Filesystem Capacity: `912.8G` free out of `1006.9G` (`4%` used).

---

## E. Activation

- **Operator Approval Received:** `APPROVE ACTIVATION`
- **Compose Command Executed:** `docker compose -p byos-email -f infra/docker-compose.yml up -d --no-deps postgres`
- **Container ID Before Restart:** `d1e245e8d561f33626ce4cbe4018be75b19ace9d5a79f0e864caa247d0f6a579`
- **Container ID After Restart:** `72e2b4cee994633b528f6efddaa5678a1c6db5ae5068e70727408f10aa83774e`
- **Start Timestamp:** `2026-11-25T06:30:18.4236364Z`
- **Healthy Ready Timestamp:** `2026-11-25T06:30:26.1129285Z`
- **Total Recreation + Healthy Duration:** `7.689s` (Postgres database restart downtime ~2s)

Command & Output:
```text
 Volume byos-email_postgres-archive Created 
 Container byos-postgres Recreated 
 Container byos-postgres Started 
ExitCode: 0

PostgreSQL Database directory appears to contain a database; Skipping initialization
2026-11-25 06:30:21.433 UTC [1] LOG:  starting PostgreSQL 16.15 on x86_64-pc-linux-musl, compiled by gcc (Alpine 15.2.0) 15.2.0, 64-bit
2026-11-25 06:30:21.459 UTC [32] LOG:  database system was shut down at 2026-11-25 06:30:19 UTC
2026-11-25 06:30:21.480 UTC [1] LOG:  database system is ready to accept connections
```

### Effective Post-Activation Settings
Command:
```bash
docker exec byos-postgres psql -U byos -d byos -c "SELECT version(); SHOW wal_level; SHOW archive_mode; SHOW archive_command; SHOW archive_timeout;"
```
Output:
```text
                                         version                                          
------------------------------------------------------------------------------------------
 PostgreSQL 16.15 on x86_64-pc-linux-musl, compiled by gcc (Alpine 15.2.0) 15.2.0, 64-bit
(1 row)

 wal_level 
-----------
 replica
(1 row)

 archive_mode 
--------------
 on
(1 row)

                                                              archive_command                                                               
--------------------------------------------------------------------------------------------------------------------------------------------
 /usr/local/bin/byos-backup archive-wal --source-path %p --wal-name %f --archive-dir /var/byos/archive --key-file /etc/byos/keys/backup.key
(1 row)

 archive_timeout 
-----------------
 5min
(1 row)
```

---

## F. WAL Archiving

### Controlled Test Transaction & Switch
Command:
```bash
docker exec byos-postgres psql -U byos -d byos -c "BEGIN; SELECT txid_current() AS test_xid, clock_timestamp() AS commit_ts, pg_current_wal_lsn() AS wal_lsn, pg_create_restore_point('c684_activation_test') AS restore_pt; COMMIT; SELECT pg_switch_wal() AS switched_lsn;"
```
Output:
```text
BEGIN
 test_xid |           commit_ts           |  wal_lsn   | restore_pt 
----------+-------------------------------+------------+------------
   340255 | 2026-11-25 06:30:48.779559+00 | 0/A1001728 | 0/A1001790
(1 row)

COMMIT
 switched_lsn 
--------------
 0/A10017D0
(1 row)
```

### `pg_stat_archiver` & Encrypted Archive Metadata
```text
-[ RECORD 1 ]------+------------------------------
archived_count     | 1
last_archived_wal  | 0000000100000000000000A1
last_archived_time | 2026-11-25 06:30:49.166608+00
failed_count       | 0
last_failed_wal    | 
last_failed_time   | 

{
  "wal_name": "0000000100000000000000A1",
  "plaintext_size": 16777216,
  "plaintext_sha256": "715a8d58ca988c63a1512905fc0710180ba7cf7dd71f736439c2b222de245ad6",
  "ciphertext_sha256": "121a58b5517cbcbe6f0ac8fc74f45fe40b982f0080d457b2eb3ff4da543edd24",
  "key_version": "v1",
  "archived_at": "2026-11-25T06:30:49.073406578Z",
  "is_history_file": false,
  "timeline_id": 1,
  "segment_no": 161
}
```

### Byte-Exact Restoration & Fail-Closed Negative Checks
Command:
```bash
docker exec byos-postgres sh -c "/usr/local/bin/byos-backup restore-wal --archive-dir /var/byos/archive --key-file /etc/byos/keys/backup.key --wal-name 0000000100000000000000A1 --target-path /tmp/restored_A1 && stat -c '%s' /tmp/restored_A1 && sha256sum /tmp/restored_A1 && rm -f /tmp/restored_A1"
```
Output:
```text
16777216
715a8d58ca988c63a1512905fc0710180ba7cf7dd71f736439c2b222de245ad6  /tmp/restored_A1
```

Negative checks (on isolated `/tmp/c684_neg_test` copy):
```text
--- Missing Object ---
Exit:True
--- Wrong Key ---
ERROR: restoring WAL segment 0000000100000000000000A1: wal: archive integrity check failed or corrupted: failed to decrypt WAL segment 0000000100000000000000A1: backup decryption failed: authentication tag mismatch or invalid key: cipher: message authentication failed
Exit:True
--- Corrupted Payload ---
ERROR: restoring WAL segment 0000000100000000000000A1: wal: archive integrity check failed or corrupted: failed to decrypt WAL segment 0000000100000000000000A1: backup decryption failed: authentication tag mismatch or invalid key: cipher: message authentication failed
Exit:True
```

---

## G. First Physical Baseline & Recovery Chain

Command:
```bash
powershell -ExecutionPolicy Bypass -File tests/verify_c684_first_recovery_chain.ps1
```
Output:
```text
[Step 1] Executing pg_basebackup against activated byos-postgres...
NOTICE:  all required WAL segments have been archived
  -> Captured base.tar.gz (41682180 bytes) and backup_manifest (2398286 bytes)
  -> System Identifier: 7691245582692712482
  -> Backup LSN Range:  0/A3000028 -> 0/A3000138 (Timeline 1)
  -> Encrypted Baseline: F:\Codex\byos-email\backups\first_physical_baseline_c684\byos_physical_baseline_c684.tar.enc (41237440 bytes)

[Step 2] Creating non-destructive WAL restore points (c684_pitr_t1 -> c684_pitr_t2)...
  -> Restore Point T1: BEGIN 340256|2026-11-25 06:32:41.509329+00|0/A4000090 COMMIT
  -> Restore Point T2: BEGIN 340257|2026-11-25 06:32:43.752042+00|0/A4000120 COMMIT

[Step 3] Inspecting archive volume contents and WAL continuity...
total 64M
-rw-------    1 postgres postgres   16.0M Nov 25 06:30 0000000100000000000000A1.enc
-rw-------    1 postgres postgres     398 Nov 25 06:30 0000000100000000000000A1.meta.json
-rw-------    1 postgres postgres   16.0M Nov 25 06:32 0000000100000000000000A2.enc
-rw-------    1 postgres postgres     398 Nov 25 06:32 0000000100000000000000A2.meta.json
-rw-------    1 postgres postgres     377 Nov 25 06:32 0000000100000000000000A3.00000028.backup.enc
-rw-------    1 postgres postgres     407 Nov 25 06:32 0000000100000000000000A3.00000028.backup.meta.json
-rw-------    1 postgres postgres   16.0M Nov 25 06:32 0000000100000000000000A3.enc
-rw-------    1 postgres postgres     397 Nov 25 06:32 0000000100000000000000A3.meta.json
-rw-------    1 postgres postgres   16.0M Nov 25 06:32 0000000100000000000000A4.enc
-rw-------    1 postgres postgres     398 Nov 25 06:32 0000000100000000000000A4.meta.json

==================================================
BYOS WAL Archive Status Report
==================================================
Total Segments:    4
History Files:     0
Archive Disk Size: 67109385 bytes (64.00 MB)
Oldest WAL:        0000000100000000000000A1 (2026-11-25 06:30:49 UTC)
Newest WAL:        0000000100000000000000A4 (2026-11-25 06:32:44 UTC)
Archive Lag:       1s
Sequence Check:    CONTINUOUS (No gaps detected)
==================================================

[Step 5] Booting isolated recovery PostgreSQL (byos-c684-recovery-chain) on port 15447...
  -> Isolated PITR recovery and promotion completed in 8.959 seconds.

[Step 6] Recovery Container Startup & Replay Logs:
  2026-11-25 06:33:03.229 UTC [29] LOG:  starting point-in-time recovery to "c684_pitr_t1"
  2026-11-25 06:33:03.229 UTC [29] LOG:  starting backup recovery with redo LSN 0/A3000028, checkpoint LSN 0/A3000060, on timeline ID 1
  2026-11-25 06:33:03.423 UTC [29] LOG:  restored log file "0000000100000000000000A3" from archive
  2026-11-25 06:33:03.464 UTC [29] LOG:  redo starts at 0/A3000028
  2026-11-25 06:33:03.598 UTC [29] LOG:  restored log file "0000000100000000000000A4" from archive
  2026-11-25 06:33:03.618 UTC [29] LOG:  completed backup recovery with redo LSN 0/A3000028 and end LSN 0/A3000138
  2026-11-25 06:33:03.618 UTC [29] LOG:  consistent recovery state reached at 0/A3000138
  2026-11-25 06:33:03.618 UTC [29] LOG:  recovery stopping at restore point "c684_pitr_t1", time 2026-11-25 06:32:41.509331+00
  2026-11-25 06:33:03.748 UTC [29] LOG:  selected new timeline ID: 2
  2026-11-25 06:33:03.839 UTC [29] LOG:  archive recovery complete
  2026-11-25 06:33:03.882 UTC [1] LOG:  database system is ready to accept connections

[Step 7] Verification Summary:
  - Promoted Timeline ID:   2 (expected: >= 2)
  - Databases Present:      26
  - Public Tables Present:  52
  - Active Primary Status:  healthy
```

---

## H. Rollback Status
Rollback was **not required** and **not executed**. The rollback procedure in `docs/runbooks/deployment_and_migration.md` Section 6 remains prepared and available.

---

## I. Regression Results

### 1. `tools/byos-backup`
Command: `go test -count=1 -v ./tools/byos-backup/...` (Exit Code: 0; 6 integration tests skipped because `TEST_DATABASE_URL` is unset)
```text
PASS
ok  	byos-backup	1.137s
```

### 2. `tools/byos-migrate`
Command: `go test -count=1 -v ./tools/byos-migrate/...` (Exit Code: 0)
```text
PASS
ok  	byos-migrate	11.745s
```

### 3. `services/admin-api`
Command: `go test -count=1 ./services/admin-api/...` (Exit Code: 0)
```text
ok  	admin-api	1.515s
ok  	admin-api/handlers	3.627s
```

### 4. `services/api`
- **Initial Run (Failed):** Failed due to `byos-redis` container being stopped following earlier host restart (`dial tcp 127.0.0.1:6379: connectex: No connection could be made`).
- **Retry after `docker start byos-redis`:**
  Command: `cmd /c "set TEST_UNMIGRATED_DATABASE_URL=postgres://byos:byos_dev_password@127.0.0.1:5432/byos_unmigrated?sslmode=disable && go test -count=1 ./services/api/..."` (Exit Code: 0)
```text
ok  	byos.email/services/api	12.808s
```

### 5. `services/outbound-worker` (Rust Compile Check — Not Runtime Test Suite)
Command: `docker run --rm -v "f:/Codex/byos-email:/workspace" -v "byos-cargo-cache:/usr/local/cargo" -v "byos-worker-target:/workspace/services/outbound-worker/target" -w /workspace/services/outbound-worker rustlang/rust:nightly-slim cargo check --offline --all-targets` (Exit Code: 0)
```text
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 1.30s
```

---

## Files edited

| File | Reason |
|---|---|
| `tests/create_and_verify_preactivation_backup.ps1` | Added preflight script capturing, encrypting, and restoring physical and logical pre-activation safety backups. |
| `tests/verify_c684_first_recovery_chain.ps1` | Added post-activation physical baseline capture, non-destructive restore-point markers, and isolated PITR recovery chain test. |
| `docs/controlled_wal_activation_and_first_recovery_chain_c6_8_4_report.md` | Authoritative C6.8.4 controlled activation and first production recovery-chain report. |

---

## Manual browser verification
No frontend or browser UI components were modified in this release. Browser verification is **UNTESTED** and not applicable to this database infrastructure activation.

---

## What did not work or is untested
1. **`recovery-status` Base Backup Detection:** `byos-backup recovery-status --archive-dir /var/byos/archive` scans `/var/byos/archive/backups/*.enc` for `PhysicalBackupManifest` packages; because the encrypted baseline packages were staged in host `backups/first_physical_baseline_c684/`, `recovery-status` alerts on `Total Base Backups: 0` inside `/var/byos/archive/backups/` while reporting `Total Archived WALs: 4` and `Estimated RPO: 1m5s`.
2. **External Off-Site Replication & Cloud KMS:** **UNTESTED** against live S3/GCS or AWS/GCP KMS in this local host activation (out of scope per release boundaries).

---

## J. Final Deployment State & Verdict

| Stage | Status |
|---|---|
| `CONFIGURATION_IMPLEMENTED` | `CRITERIA_MET` |
| `PREFLIGHT_PASS` | `CRITERIA_MET` |
| `OPERATOR_APPROVAL_RECEIVED` | `CRITERIA_MET` |
| `ACTIVE_POSTGRES_RESTARTED` | `CRITERIA_MET` |
| `ACTIVE_ARCHIVING_VERIFIED` | `CRITERIA_MET` |
| `FIRST_PHYSICAL_BASELINE_CREATED` | `CRITERIA_MET` |
| `FIRST_RECOVERY_CHAIN_VERIFIED` | `CRITERIA_MET` |

```text
PASS: Active WAL archiving enabled and first physical recovery chain verified.
```
