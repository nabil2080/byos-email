# Safe Compose WAL Activation & Deployment Verification (Release C6.8.3) Report

## What was built
Release C6.8.3 connects the continuous WAL archiving, AES-256-GCM encryption, and physical Point-in-Time Recovery (PITR) engine developed in releases C6.8, C6.8.1, and C6.8.2 directly into the canonical BYOS Compose configuration (`infra/docker-compose.yml`). The Compose specification for the `postgres` service was updated to define a persistent `postgres-archive` volume, mount the native Linux `byos-backup` binary, mount the isolated 256-bit encryption key file, and execute continuous WAL archiving flags (`wal_level=replica`, `archive_mode=on`, `archive_command`, and `archive_timeout=300`) with volume directory permission bootstrapping. An isolated disposable Compose integration test (`tests/test_c683_disposable_compose.ps1` using `tests/compose-c683-wal-override.yml`) was built and executed, proving end-to-end continuous encrypted archiving, byte-for-byte fidelity, container recreation volume persistence, six archiver failure and recovery modes, and a 2.223-second cold physical PITR restoration to an exact target timestamp. Throughout this validation, the active production database (`byos-postgres` container `d1e245e8d561` on port 5432) remained strictly untouched (`PENDING_OPERATOR_APPROVAL`).

---

## Deployment Status and Verdicts

| Evaluation Criterion | Verdict | Evidence Summary |
|---|---|---|
| **COMPOSE_CONFIGURATION_IMPLEMENTED** | `CRITERIA_MET` | Updated `infra/docker-compose.yml` with entrypoint bootstrap, volume mounts, archive command, and `postgres-archive` volume. |
| **DISPOSABLE_COMPOSE_INTEGRATION_PASS** | `CRITERIA_MET` | Isolated Compose project `byos-c683-wal-test` passed all 10 integration stages including PITR in 2.223s. |
| **ACTIVE_BYOS_POSTGRES_ACTIVATED** | `PENDING_OPERATOR_APPROVAL` | Active `byos-postgres` container `d1e245e8d561` was preserved untouched with `archive_mode = off`. |
| **ACTIVE_BYOS_POSTGRES_VERIFIED** | `PENDING_OPERATOR_APPROVAL` | Operator activation runbook documented in `docs/runbooks/deployment_and_migration.md` awaiting scheduled maintenance window. |

---

## Files edited

| File | Reason |
|---|---|
| `infra/docker-compose.yml` | Integrated continuous WAL archiving command, `byos-backup` binary bind mount, `backup.key` bind mount, and `postgres-archive` volume into the `postgres` service. |
| `.env.example` | Documented `BYOS_BACKUP_KEY_FILE` environment variable with security constraints and operational guidance. |
| `tests/compose-c683-wal-override.yml` | Defined isolated disposable Compose override with project name `byos-c683-wal-test`, port 15444, container name `byos-c683-wal-test-pg`, and test volumes. |
| `tests/test_c683_disposable_compose.ps1` | Orchestrated end-to-end disposable Compose integration test covering settings, continuous archiving, recreation, failure modes, and physical PITR. |
| `docs/runbooks/deployment_and_migration.md` | Added Section 6 documenting the controlled step-by-step operator activation, verification, and rollback runbook for the active database. |
| `docs/safe_compose_wal_activation_c6_8_3_report.md` | Primary engineering and operational readiness verification report for Release C6.8.3. |

---

## Raw evidence

### 1. Baseline Inspection of Active Database (`byos-postgres`)
Command:
```bash
docker exec byos-postgres psql -U byos -d byos -c "SHOW wal_level; SHOW archive_mode; SHOW archive_command; SHOW archive_timeout; SELECT * FROM pg_stat_archiver;"
```
Output:
```text
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

 archive_timeout 
-----------------
 0
(1 row)

 archived_count | last_archived_wal | last_archived_time | failed_count | last_failed_wal | last_failed_time |          stats_reset          
----------------+-------------------+--------------------+--------------+-----------------+------------------+-------------------------------
              0 |                   |                    |            0 |                 |                  | 2026-11-24 12:22:20.854287+00
(1 row)
```

### 2. Diff of Canonical Compose and Environment Configuration
Command:
```bash
git diff -- infra/docker-compose.yml .env.example
```
Output:
```diff
diff --git a/.env.example b/.env.example
index 18e26c5..db72bda 100644
--- a/.env.example
+++ b/.env.example
@@ -37,6 +73,11 @@ POSTGRES_PORT=5432
 POSTGRES_DB=byos
 POSTGRES_USER=byos
 POSTGRES_PASSWORD=byos_dev_password
 
+# PostgreSQL Continuous WAL Archiving & Backup Encryption (Release C6.8)
+# Path to 256-bit AES-GCM backup key file on host (relative to compose file or absolute).
+# In production, ensure this file is owned by root with 0400 permissions and isolated from the backup volume.
+BYOS_BACKUP_KEY_FILE=./secrets/backup.key
+
 REDIS_URL=redis://localhost:6379
diff --git a/infra/docker-compose.yml b/infra/docker-compose.yml
index d7b0b3a..684d8fb 100644
--- a/infra/docker-compose.yml
+++ b/infra/docker-compose.yml
@@ -15,11 +15,35 @@ services:
     volumes:
       - postgres-data:/var/lib/postgresql/data
       - ./postgres/init:/docker-entrypoint-initdb.d:ro
+      - ./postgres/migrations:/migrations:ro
+      - postgres-archive:/var/byos/archive
+      - ../tools/byos-backup/byos-backup-linux:/usr/local/bin/byos-backup:ro
+      - ${BYOS_BACKUP_KEY_FILE:-./secrets/backup.key}:/etc/byos/keys/backup.key:ro
+    entrypoint:
+      - "sh"
+      - "-c"
+      - "mkdir -p /var/byos/archive && chown -R postgres:postgres /var/byos/archive && chmod 700 /var/byos/archive && exec docker-entrypoint.sh postgres -c wal_level=replica -c archive_mode=on -c \"archive_command=/usr/local/bin/byos-backup archive-wal --source-path %p --wal-name %f --archive-dir /var/byos/archive --key-file /etc/byos/keys/backup.key\" -c archive_timeout=300"
     healthcheck:
@@ -470,6 +508,7 @@ secrets:
 
 volumes:
   postgres-data:
+  postgres-archive:
   redis-data:
   minio-data:
```

### 3. Canonical Compose Validation
Command:
```bash
docker compose -f infra/docker-compose.yml config postgres
```
Output:
```yaml
name: byos-email
services:
  postgres:
    container_name: byos-postgres
    entrypoint:
      - sh
      - -c
      - mkdir -p /var/byos/archive && chown -R postgres:postgres /var/byos/archive
        && chmod 700 /var/byos/archive && exec docker-entrypoint.sh postgres -c wal_level=replica
        -c archive_mode=on -c "archive_command=/usr/local/bin/byos-backup archive-wal
        --source-path %p --wal-name %f --archive-dir /var/byos/archive --key-file
        /etc/byos/keys/backup.key" -c archive_timeout=300
    environment:
      POSTGRES_DB: byos
      POSTGRES_PASSWORD: byos_dev_password
      POSTGRES_USER: byos
    image: postgres:16-alpine
    networks:
      default: null
    volumes:
      - type: volume
        source: postgres-data
        target: /var/lib/postgresql/data
        volume: {}
      - type: bind
        source: F:\Codex\byos-email\infra\postgres\init
        target: /docker-entrypoint-initdb.d
        read_only: true
        bind: {}
      - type: bind
        source: F:\Codex\byos-email\infra\postgres\migrations
        target: /migrations
        read_only: true
        bind: {}
      - type: volume
        source: postgres-archive
        target: /var/byos/archive
        volume: {}
      - type: bind
        source: F:\Codex\byos-email\tools\byos-backup\byos-backup-linux
        target: /usr/local/bin/byos-backup
        read_only: true
        bind: {}
      - type: bind
        source: F:\Codex\byos-email\infra\secrets\backup.key
        target: /etc/byos/keys/backup.key
        read_only: true
        bind: {}
    expose:
      - "5432"
    healthcheck:
      test:
        - CMD-SHELL
        - pg_isready -h 127.0.0.1 -U byos -d byos
      timeout: 5s
      interval: 5s
      retries: 20
      start_period: 10s
    ports:
      - mode: ingress
        host_ip: 127.0.0.1
        target: 5432
        published: "5432"
        protocol: tcp
networks:
  default:
    name: byos-email_default
volumes:
  postgres-archive:
    name: byos-email_postgres-archive
  postgres-data:
    name: byos-email_postgres-data
```

### 4. Disposable Compose Integration Test Execution
Command:
```bash
powershell -ExecutionPolicy Bypass -File tests/test_c683_disposable_compose.ps1
```
Output:
```text
=================================================================
BYOS C6.8.3: Compose WAL Activation & Deployment Verification
=================================================================
[Teardown] Cleaning up any previous disposable test resources...

[Step 1] Starting Disposable Compose postgres service (byos-c683-wal-test)...
 Container byos-c683-wal-test-pg Creating 
 Container byos-c683-wal-test-pg Created 
 Container byos-c683-wal-test-pg Starting 
 Container byos-c683-wal-test-pg Started 
  Waiting for byos-c683-wal-test-pg to become ready on port 15444...
  -> Container byos-c683-wal-test-pg is query-ready.

[Step 2] Querying runtime PostgreSQL settings...
 wal_level  -----------  replica (1 row)   archive_mode  --------------  on (1 row)                                                                archive_command                                                                --------------------------------------------------------------------------------------------------------------------------------------------  /usr/local/bin/byos-backup archive-wal --source-path %p --wal-name %f --archive-dir /var/byos/archive --key-file /etc/byos/keys/backup.key (1 row)   archive_timeout  -----------------  5min (1 row) 
  -> wal_level: replica
  -> archive_mode: on
  -> archive_command: /usr/local/bin/byos-backup archive-wal --source-path %p --wal-name %f --archive-dir /var/byos/archive --key-file /etc/byos/keys/backup.key
  -> archive_timeout: 5min

[Step 3] Seeding test table & forcing WAL segment switches...

[Step 4] Checking pg_stat_archiver metrics...
-[ RECORD 1 ]------+------------------------------ archived_count     | 2 last_archived_wal  | 000000010000000000000002 last_archived_time | 2026-11-24 16:11:00.036133+00 failed_count       | 0 last_failed_wal    |  last_failed_time   |  stats_reset        | 2026-11-24 16:10:56.335392+00 
  -> archived_count: 2
  -> failed_count: 0

[Step 5] Inspecting archive directory in volume...
total 32M     -rw-------    1 postgres postgres   16.0M Nov 24 16:10 000000010000000000000001.enc -rw-------    1 postgres postgres     396 Nov 24 16:10 000000010000000000000001.meta.json -rw-------    1 postgres postgres   16.0M Nov 24 16:10 000000010000000000000002.enc -rw-------    1 postgres postgres     396 Nov 24 16:11 000000010000000000000002.meta.json
  Found 2 encrypted WAL segments.

[Step 6] Restoring first archived WAL segment and verifying SHA-256...
  Target segment: 000000010000000000000001
  -> Restored size: 16777216 bytes (expected: 16777216)
  -> Metadata Checksum: c909cd544c1dc598bcfff6d361cd5b3fb31f2322c57955ede4e3c96ac78076a6
  -> Restored Checksum: c909cd544c1dc598bcfff6d361cd5b3fb31f2322c57955ede4e3c96ac78076a6
  -> Byte fidelity & SHA-256 integrity: EXACT MATCH

[Step 7] Testing Compose container recreation with persistent volumes...
  Stopping and removing container...
 Container byos-c683-wal-test-pg Stopping 
 Container byos-c683-wal-test-pg Stopped 
 Container byos-c683-wal-test-pg Removing 
 Container byos-c683-wal-test-pg Removed 
  Restarting container via Compose...
 Container byos-c683-wal-test-pg Creating 
 Container byos-c683-wal-test-pg Created 
 Container byos-c683-wal-test-pg Starting 
 Container byos-c683-wal-test-pg Started 
  -> Recreated container is ready.
  -> Archived WAL count in volume after container recreation: 3 (previous: 2)
  -> Recreated container archiver metrics: archived_count=1, failed_count=0
  -> Total encrypted WAL segments on disk: 4

[Step 8] Testing Archive Failure & Recovery Modes...
  [Scenario 8A] Simulating unwritable archive directory (chmod 500)...
    -> Initial failed_count: 0, new failed_count: 3
    Restoring permissions (chmod 700 /var/byos/archive/wal) and verifying archiver recovery...
    -> Archived count after permissions restoration: 1
  [Scenario 8B] Simulating archive-wal with missing / invalid key...
    -> archive-wal exit code with missing key: 1 (Output: ERROR: loading encryption key: reading key file "/etc/byos/keys/nonexistent.key": open /etc/byos/keys/nonexistent.key: no such file or directory)
  [Scenario 8C] Testing duplicate segment archiving with identical content (Idempotency)...
    -> archive-wal idempotency exit code: 0 (Output: SUCCESS: Archived WAL 000000010000000000000001 (Plaintext: 16777216 bytes, Cipher: v1))
  [Scenario 8D] Testing duplicate segment archiving with conflicting content (Fail-Closed)...
    -> archive-wal conflicting duplicate exit code: 1 (Output: ERROR: archiving WAL segment: wal: conflicting archive object already exists with different contents: 000000010000000000000001)
  [Scenario 8E] Testing restore-wal on non-existent object...
    -> restore-wal missing object exit code: 1 (Output: )
  [Scenario 8F] Testing restore-wal on corrupted encrypted segment...
    -> restore-wal corrupt object exit code: 2 (Output: ERROR: restoring WAL segment 000000010000000000000001_corrupt: wal: archive integrity check failed or corrupted: failed to decrypt WAL segment 000000010000000000000001_corrupt: backup decryption failed: authentication tag mismatch or invalid key: cipher: message authentication failed)

[Step 9] Executing Physical PITR from the Compose Deployment...
  Generating physical pg_basebackup from byos-c683-wal-test-pg...
NOTICE:  all required WAL segments have been archived
  Inserting Transaction T1 (Pre-target valid state)...
  -> T1 Committed At: 2026-11-24 16:11:25.934435+00
  -> Target Recovery Timestamp: 2026-11-24 16:11:26 UTC
  Inserting Transaction T2 (Disaster record after target timestamp)...
  -> T2 Committed At: 2026-11-24 16:11:30.313255+00
  All pre-recovery WAL segments archived.
  Preparing isolated recovery volume and base backup extraction...
  Starting PITR Recovery PostgreSQL container (byos-c683-pitr-recovery) on port 15445...
8edd572b0f702120088d4dbda012c1f190fbf8b522731f98721be5e119df6fe0
  -> PITR Recovery succeeded in 2.223 seconds.

[Step 10] Validating PITR Data State & Timeline Promotion...
 id |        label         |         committed_at           ----+----------------------+-------------------------------   1 | TX1_VALID_PRE_TARGET | 2026-11-24 16:11:25.934435+00 (1 row) 
  -> TX1_VALID_PRE_TARGET present: 1 (expected: 1)
  -> TX2_DISASTER_POST_TARGET present: 0 (expected: 0)
 timeline_id  -------------            2 (1 row) 
  -> Restored Timeline ID: 2
  -> Timeline promotion to Timeline 2 verified.

=================================================================
DISPOSABLE COMPOSE INTEGRATION TEST: ALL PHASES SATISFIED
=================================================================
[Teardown] Cleaning up any previous disposable test resources...
```

### 5. Proof of Active Primary Container Protection
Command:
```bash
docker ps -f id=d1e245e8d561
```
Output:
```text
CONTAINER ID   IMAGE                COMMAND                  CREATED        STATUS                 PORTS                      NAMES
d1e245e8d561   postgres:16-alpine   "docker-entrypoint.s…"   29 hours ago   Up 4 hours (healthy)   127.0.0.1:5432->5432/tcp   byos-postgres
```

---

## Manual browser verification
No frontend or browser UI components were modified in this release. Release C6.8.3 was strictly scoped to Compose infrastructure integration, continuous WAL archiving, disaster recovery automation, and operational runbook authoring. Browser verification is therefore **UNTESTED** and listed as not applicable for this infrastructure task.

---

## What did not work or is untested
1. **Active `byos-postgres` Container Restart:** **UNTESTED** on the live cluster by strict invariant. The active PostgreSQL container (`d1e245e8d561`) has `archive_mode = off` and was deliberately kept running without interruption. Manual steps required to activate: Follow `docs/runbooks/deployment_and_migration.md` Section 6 (`docker compose -f infra/docker-compose.yml up -d postgres`) during an authorized maintenance window.
2. **Cloud Object Store Off-Site Replication:** **UNTESTED** against live AWS S3 or GCP Cloud Storage during this run. The archive volume was evaluated using isolated Docker volume mechanics. Manual steps required to evaluate offsite replication: Configure S3 bucket and run `aws s3 sync /var/byos/archive/ s3://$BUCKET/archive/`.
3. **Live Cloud HSM/KMS Integration:** **UNTESTED** against AWS KMS / GCP KMS in local execution; local key provider was evaluated via isolated key files.

---

## Test suite output

### `byos-backup` Test Suite
Command:
```bash
go test -count=1 -v ./tools/byos-backup/...
```
Output:
```text
=== RUN   TestVerify_ValidBundle
--- PASS: TestVerify_ValidBundle (0.05s)
=== RUN   TestVerify_TamperDetection
--- PASS: TestVerify_TamperDetection (0.06s)
=== RUN   TestVerify_CryptoMetadataValidation
--- PASS: TestVerify_CryptoMetadataValidation (0.07s)
=== RUN   TestVerify_RelationalIntegrity
--- PASS: TestVerify_RelationalIntegrity (0.05s)
=== RUN   TestSection23_ComplianceFlags
--- PASS: TestSection23_ComplianceFlags (0.06s)
=== RUN   TestInspect_Summary
--- PASS: TestInspect_Summary (0.05s)
=== RUN   TestBuildInsertParams
--- PASS: TestBuildInsertParams (0.00s)
=== RUN   TestVerify_MissingManifest
--- PASS: TestVerify_MissingManifest (0.00s)
=== RUN   TestVerify_MissingTableFile
--- PASS: TestVerify_MissingTableFile (0.03s)
=== RUN   TestVerify_InvalidJSON
--- PASS: TestVerify_InvalidJSON (0.03s)
=== RUN   TestVerify_BundleAggregateMismatch
--- PASS: TestVerify_BundleAggregateMismatch (0.06s)
=== RUN   TestRestore_SafeHistoricalBackup
    backup_test.go:872: skipping restore integration test: TEST_DATABASE_URL is not set
--- SKIP: TestRestore_SafeHistoricalBackup (0.01s)
=== RUN   TestRestore_RejectsUnsafeMailboxOrgManagedMode
    backup_test.go:911: skipping restore integration test: TEST_DATABASE_URL is not set
--- SKIP: TestRestore_RejectsUnsafeMailboxOrgManagedMode (0.01s)
=== RUN   TestRestore_RejectsUnsafeMailboxWrappedSkOrg
    backup_test.go:931: skipping restore integration test: TEST_DATABASE_URL is not set
--- SKIP: TestRestore_RejectsUnsafeMailboxWrappedSkOrg (0.01s)
=== RUN   TestRestore_RejectsUnsafeInvitationLegacyKeyMaterial
    backup_test.go:951: skipping restore integration test: TEST_DATABASE_URL is not set
--- SKIP: TestRestore_RejectsUnsafeInvitationLegacyKeyMaterial (0.01s)
=== RUN   TestRestore_FailedRestoreLeavesDestinationUnchanged
    backup_test.go:971: skipping restore integration test: TEST_DATABASE_URL is not set
--- SKIP: TestRestore_FailedRestoreLeavesDestinationUnchanged (0.00s)
=== RUN   TestRestore_Post058Backup
    backup_test.go:1020: skipping restore integration test: TEST_DATABASE_URL is not set
--- SKIP: TestRestore_Post058Backup (0.01s)
=== RUN   TestVerify_Post058BackupWithNullOrgRecovery
--- PASS: TestVerify_Post058BackupWithNullOrgRecovery (0.04s)
=== RUN   TestVerify_BackupWithoutOrgRecoveryPrincipals
--- PASS: TestVerify_BackupWithoutOrgRecoveryPrincipals (0.06s)
=== RUN   TestLegacyRecoveryData_NotExposedToApplication
--- PASS: TestLegacyRecoveryData_NotExposedToApplication (0.00s)
=== RUN   TestBaseBackup_PackagingAndManifestRoundtrip
--- PASS: TestBaseBackup_PackagingAndManifestRoundtrip (0.00s)
=== RUN   TestBaseBackup_ComputeWALListForRange
--- PASS: TestBaseBackup_ComputeWALListForRange (0.00s)
=== RUN   TestEncryptDecryptPayloadRoundtrip
--- PASS: TestEncryptDecryptPayloadRoundtrip (0.00s)
=== RUN   TestDecryptWithWrongKeyFails
--- PASS: TestDecryptWithWrongKeyFails (0.00s)
=== RUN   TestTamperedCiphertextFails
--- PASS: TestTamperedCiphertextFails (0.00s)
=== RUN   TestKeyParsingAndValidation
--- PASS: TestKeyParsingAndValidation (0.00s)
=== RUN   TestKeyIsolationFromBackupDirectory
--- PASS: TestKeyIsolationFromBackupDirectory (0.02s)
=== RUN   TestEncryptedArchivePackagingRoundtrip
--- PASS: TestEncryptedArchivePackagingRoundtrip (0.01s)
=== RUN   TestKMS_RotationAndHistoricalAccess
--- PASS: TestKMS_RotationAndHistoricalAccess (0.00s)
=== RUN   TestPITR_GenerateRecoveryConf
--- PASS: TestPITR_GenerateRecoveryConf (0.01s)
=== RUN   TestPITR_SelectBaseBackupForTarget
--- PASS: TestPITR_SelectBaseBackupForTarget (0.00s)
=== RUN   TestRetentionLoneSurvivingBackupNeverPruned
--- PASS: TestRetentionLoneSurvivingBackupNeverPruned (0.00s)
=== RUN   TestRetentionStandardTiers
--- PASS: TestRetentionStandardTiers (0.00s)
=== RUN   TestRetentionAllOlderThanPolicyPreservesNewest
--- PASS: TestRetentionAllOlderThanPolicyPreservesNewest (0.00s)
=== RUN   TestRetention_WALDependencyPreservation
--- PASS: TestRetention_WALDependencyPreservation (0.00s)
=== RUN   TestStorage_FilesystemIdempotencyAndConflict
--- PASS: TestStorage_FilesystemIdempotencyAndConflict (0.03s)
=== RUN   TestStorage_MemoryFaultInjection
--- PASS: TestStorage_MemoryFaultInjection (0.00s)
=== RUN   TestWAL_ArchiveAndRestoreRoundtrip
--- PASS: TestWAL_ArchiveAndRestoreRoundtrip (0.09s)
=== RUN   TestWAL_TamperAndWrongKeyDetection
--- PASS: TestWAL_TamperAndWrongKeyDetection (0.05s)
=== RUN   TestWAL_HistoryFileAndGapDetection
--- PASS: TestWAL_HistoryFileAndGapDetection (0.13s)
PASS
ok  	byos-backup	1.190s
```

### `byos-migrate` Test Suite
Command:
```bash
go test -count=1 -v ./tools/byos-migrate/...
```
Output:
```text
=== RUN   TestPhase4_FreshDatabaseBootstrap
--- PASS: TestPhase4_FreshDatabaseBootstrap (2.42s)
=== RUN   TestPhase4_FreshDatabaseBootstrap_ReExecutionIsIdempotent
--- PASS: TestPhase4_FreshDatabaseBootstrap_ReExecutionIsIdempotent (0.01s)
=== RUN   TestPhase5_ExistingDatabaseUpgrade_Baseline068
--- PASS: TestPhase5_ExistingDatabaseUpgrade_Baseline068 (3.26s)
=== RUN   TestPhase1_Baseline068_PartialSchema_FailsClosed
--- PASS: TestPhase1_Baseline068_PartialSchema_FailsClosed (0.00s)
=== RUN   TestPhase1_Baseline072_Verification
--- PASS: TestPhase1_Baseline072_Verification (0.00s)
=== RUN   TestPhase1_Baseline073_Verification
--- PASS: TestPhase1_Baseline073_Verification (0.00s)
=== RUN   TestPhase1_Baseline074_Verification
--- PASS: TestPhase1_Baseline074_Verification (0.00s)
=== RUN   TestPhase1_Baseline075_Verification
--- PASS: TestPhase1_Baseline075_Verification (0.00s)
=== RUN   TestPhase2_FullLedgerVerification
--- PASS: TestPhase2_FullLedgerVerification (0.00s)
=== RUN   TestPhase2_CheckVersionSequencing
--- PASS: TestPhase2_CheckVersionSequencing (0.00s)
=== RUN   TestPhase2_SchemaMigrationsTableStructure
--- PASS: TestPhase2_SchemaMigrationsTableStructure (0.00s)
=== RUN   TestPhase3_AdvisoryLockIntegrity
--- PASS: TestPhase3_AdvisoryLockIntegrity (0.00s)
=== RUN   TestPhase3_AcquireAdvisoryLock_WithRetry
--- PASS: TestPhase3_AcquireAdvisoryLock_WithRetry (0.00s)
=== RUN   TestPhase6_MigrationInterruptionAndRecovery
--- PASS: TestPhase6_MigrationInterruptionAndRecovery (0.38s)
=== RUN   TestPhase6_NonTransactionalMigrationSupport
--- PASS: TestPhase6_NonTransactionalMigrationSupport (0.32s)
=== RUN   TestPhase6_ChecksumMismatchDetection
--- PASS: TestPhase6_ChecksumMismatchDetection (0.30s)
=== RUN   TestPhase6_MissingRequiredMigrationFile
--- PASS: TestPhase6_MissingRequiredMigrationFile (0.29s)
=== RUN   TestPhase6_DuplicateVersionDetection
--- PASS: TestPhase6_DuplicateVersionDetection (0.02s)
=== RUN   TestPhase6_ConcurrentDeploymentProtection
--- PASS: TestPhase6_ConcurrentDeploymentProtection (0.29s)
=== RUN   TestPhase6_InsufficientPrivilegesFailsClosed
--- PASS: TestPhase6_InsufficientPrivilegesFailsClosed (0.76s)
PASS
ok  	byos-migrate	16.406s
```

### `admin-api` Test Suite
Command:
```bash
go test -count=1 ./services/admin-api/...
```
Output:
```text
ok  	admin-api	1.979s
ok  	admin-api/handlers	4.727s
```

### `api` Test Suite
Command:
```bash
cmd /c "set TEST_UNMIGRATED_DATABASE_URL=postgres://byos:byos_dev_password@127.0.0.1:5432/byos_unmigrated?sslmode=disable && go test -count=1 ./services/api/..."
```
Output:
```text
ok  	byos.email/services/api	14.938s
```

### `outbound-worker` Offline Cargo Check
Command:
```bash
docker run --rm -v "f:/Codex/byos-email:/workspace" -v "byos-cargo-cache:/usr/local/cargo" -v "byos-worker-target:/workspace/services/outbound-worker/target" -w /workspace/services/outbound-worker rustlang/rust:nightly-slim cargo check --offline --all-targets
```
Output:
```text
    Checking byos-crypto-core v0.1.0 (/workspace/packages/crypto-core)
    Checking byos-outbound-worker v0.1.0 (/workspace/services/outbound-worker)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 11.00s
```
