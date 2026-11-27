# Independent Off-Site Backup & Disaster Recovery (Release C6.9) Report

## A. Executive Summary
Release C6.9 implemented a provider-neutral S3-compatible off-site storage adapter (`S3Storage` via `minio-go/v7`), dual-destination WAL replication (`DualStorage` with opt-in `BYOS_BACKUP_REMOTE_ENABLED` and `BYOS_BACKUP_REMOTE_REQUIRED` semantics), an atomic machine-readable recovery catalog (`catalog/recovery_catalog.json`), dependency-aware remote retention (`remote-prune`), and remote CLI subcommands (`remote-status`, `remote-sync`, `remote-verify`, `remote-list`, `remote-fetch`, `recovery-catalog`, `remote-prune`, `remote-recovery-check`) in `tools/byos-backup/`. Local integration with a disposable MinIO S3 container demonstrated remote-required WAL durability, outage retry and 0.73s backlog drain, and full remote-only physical PITR + latest-state recovery (3.525s total RTO) with all original source volumes, local archives, and source keys destroyed. Live off-site cloud provisioning and external KMS activation remain **UNTESTED** and pending Stage B operator approval.

---

## B. Implementation Inventory

| File | Purpose |
|---|---|
| `tools/byos-backup/go.mod`, `go.sum` | Added `github.com/minio/minio-go/v7 v7.0.86` S3-compatible client dependency. |
| `tools/byos-backup/s3_storage.go` | Provider-neutral `S3Storage` adapter implementing `StorageDestination`, multipart streaming (`PutFile`/`GetFile`), SHA-256 metadata integrity, TLS enforcement for non-local endpoints, and bounded retry/backoff. |
| `tools/byos-backup/dual_storage.go` | `DualStorage` orchestrating local-first encrypted writes with optional vs remote-required replication and ciphertext preservation on retry. |
| `tools/byos-backup/catalog.go` | Atomic 7-step recovery catalog publisher, dependency-graph verifier, `SyncLocalToRemote`, `GetRemoteStatus`, and dependency-aware `PruneRemoteBackups`. |
| `tools/byos-backup/remote_cli.go` | CLI handlers for `remote-status`, `remote-sync`, `remote-verify`, `remote-list`, `remote-fetch`, `recovery-catalog`, `remote-prune`, and `remote-recovery-check`. |
| `tools/byos-backup/wal.go` | Fail-closed handling of `ErrKeyRevoked` during `RestoreWALSegment`. |
| `tools/byos-backup/main.go` | Wired `DualStorage` into `archive-wal`, `--remote` into `restore-wal`, and registered C6.9 CLI subcommands. |
| `tools/byos-backup/remote_c69_test.go` | Unit tests for dual-storage semantics, concurrency, catalog completeness, multi-epoch `v1`/`v2` key rotation/revocation, dependency-aware pruning, TLS enforcement, and S3 error mapping. |
| `tests/disaster_recovery_remote_only_c69.ps1` | End-to-end remote-only physical PITR and latest-state DR drill against disposable MinIO. |
| `.env.example` | Documented non-secret `BYOS_BACKUP_REMOTE_*` placeholders (disabled by default). |
| `docs/c69_storage_architecture_decision.md` | Architecture decision for S3-compatible storage, integrity, and auth. |
| `docs/c69_offsite_provider_decision.md` | Provider comparison and Stage B approval gate document. |
| `docs/runbooks/offsite_disaster_recovery.md` | Step-by-step operational runbook for remote replication, outage response, pruning, and remote-only PITR. |
| `docs/runbooks/physical_pitr_recovery.md`, `backup_and_disaster_recovery.md`, `deployment_and_migration.md` | Added C6.9 remote-only PITR and opt-in replication gate references. |
| `docs/independent_offsite_backup_and_disaster_recovery_c6_9_report.md` | Authoritative C6.9 engineering and verification report. |

---

## C. Storage Adapter
`S3Storage` (`tools/byos-backup/s3_storage.go`) implements `StorageDestination` over `minio-go/v7`:
- **Authentication:** Resolves credentials from secret files (`BYOS_BACKUP_REMOTE_ACCESS_KEY_FILE`, `BYOS_BACKUP_REMOTE_SECRET_KEY_FILE`), environment variables, or cloud IAM; rejects partial credentials (`AccessKey` without `SecretKey`).
- **Transport Security:** Enforces HTTPS/TLS for all non-local endpoints; non-TLS HTTP is rejected unless the host is `localhost`/`127.0.0.1` or `BYOS_BACKUP_ALLOW_INSECURE_LOCAL_HTTP=true` is explicitly set for local test containers.
- **Integrity:** Never relies on S3 `ETag`; stores and checks `x-amz-meta-byos-sha256` alongside object size and `.meta.json` sidecars. Rejects conflicting overwrites with `ErrObjectAlreadyExists`.
- **Large Objects & Multipart:** `PutFile` streams with `16 MiB` part size and invokes `RemoveIncompleteUpload` on failure. Custom `http.Transport` dial/header timeouts prevent `archive_command` from hanging during outages.

---

## D. Dual-Destination Behavior
- **Optional Mode (`BYOS_BACKUP_REMOTE_REQUIRED=false`):** `archive-wal` writes encrypted WAL locally first; remote failures log a warning and appear as pending lag in `remote-status`, while local archiving succeeds.
- **Required Mode (`BYOS_BACKUP_REMOTE_REQUIRED=true`):** `archive-wal` returns nonzero if remote upload or verification fails, preserving the local encrypted WAL and allowing PostgreSQL to retain `.ready` and retry. On retry, `DualStorage.Put` replicates the exact existing local ciphertext bytes (preventing nonce-mismatch conflicts).

---

## E. Recovery Catalog
Representative synthetic `catalog/recovery_catalog.json` structure (excludes all keys, credentials, and mailbox data):
```json
{
  "catalog_version": 1,
  "updated_at": "2026-11-25T08:38:39Z",
  "entries": [
    {
      "backup_id": "c69-base-afbdfa5084b7",
      "database_system_id": "c69-disposable",
      "server_version": "16.15",
      "start_lsn": "0/6000028",
      "stop_lsn": "0/6000100",
      "timeline_id": 1,
      "required_wals": ["000000010000000000000001", "000000010000000000000002", "000000010000000000000003", "000000010000000000000004"],
      "backup_history_file": "000000010000000000000004.00000028.backup",
      "encryption_algorithm": "AES-256-GCM",
      "key_version_id": "v1",
      "base_backup_object_key": "backups/c69-base-afbdfa5084b7/base.tar.enc",
      "manifest_object_key": "backups/c69-base-afbdfa5084b7/backup_manifest",
      "status": "completed"
    }
  ]
}
```

---

## F. Remote-Only Recovery Drill
Command:
```powershell
powershell -ExecutionPolicy Bypass -File tests/disaster_recovery_remote_only_c69.ps1
```
Output (Exit Code 0):
```text
=================================================================
BYOS C6.9: Remote-Only Disaster Recovery Drill
Classification: SAME_HOST_OBJECT_STORAGE_TEST (Disposable MinIO)
=================================================================

[Step 1] Starting disposable MinIO S3 endpoint on port 19000...
  -> MinIO bucket 'byos-c69-dr-bucket' ready.

[Step 2] Starting disposable source PostgreSQL with BYOS_BACKUP_REMOTE_REQUIRED=true...
  -> Source PostgreSQL ready on port 15450.

[Step 3] Seeding synthetic baseline & publishing physical base backup to remote S3...
NOTICE:  all required WAL segments have been archived
PUBLISHED RECOVERY POINT: c69-base-afbdfa5084b7 (key=v1, wals=4, sha256=b6069ba676ae395e83e502293dc5f0a202476740761aae2102a81359d71ac0f9)

[Step 4] Committing TX1 (valid), capturing PITR target, and committing TX2 (disaster)...
  -> TX1 Committed: 2026-11-25 08:38:40.099123+00 | PITR Target: 2026-11-25 08:38:41 UTC
VERIFIED [c69-base-afbdfa5084b7]: base=backups/c69-base-afbdfa5084b7/base.tar.enc wals=4 key=v1
==================================================
BYOS Remote Disaster Recovery Status: [HEALTHY]
==================================================
Endpoint / Bucket:       127.0.0.1:19000 / byos-c69-dr-bucket (prefix: c69-drill)
Connected:               true
Complete Remote Backups: 1
Oldest Recovery Point:   c69-base-afbdfa5084b7
Total Remote WALs:       5 (history: 0)
Latest Remote WAL:       000000010000000000000005 (2026-11-25 08:38:42 UTC, lag: 1s)
Pending Local Objects:   0 (0 bytes)
Available Key Versions:  v1
==================================================
  -> Wrong credentials remote-list exit code: 1 (expected != 0)

[Step 4b] Simulating remote destination outage & measuring backlog drain...
  -> During outage: pg_stat_archiver.failed_count=1, local archived .enc count=7
  -> Outage duration: 24.28s | Backlog drain time after MinIO recovery: 0.73s (drained=True)

[Step 5] Simulating complete loss of original host (destroying source container, volumes, and source keys)...
  -> Strict isolation confirmed: source container, data volume, archive volume, and host keys destroyed.

[Step 6] Executing timed remote-only cold recovery using ONLY MinIO S3 + independent recovery key...

[Step 7] Validating remote-only recovered database state...
 id |    run_id    | seq_no |       tx_label         
----+--------------+--------+-----------------------
  1 | afbdfa5084b7 |      1 | BASELINE_SEED_RECORD
  2 | afbdfa5084b7 |      2 | TX1_VALID_POST_BACKUP
(2 rows) 

[Step 7b] Testing Latest-State Remote-Only Recovery (including TX2)...
  -> Latest-state recovered ledger rows: 3 (expected: 3)

[Step 8] Remote Recovery RTO Breakdown (Total: 3.525s):
  - 1_infra_and_redis_ms                  : 430.97 ms
  - 2_base_backup_fetch_ms                : 71.74 ms
  - 3_decrypt_and_verify_ms               : 38.34 ms
  - 4_extract_and_pitr_conf_ms            : 1092.81 ms
  - 5_remote_wal_replay_and_promote_ms    : 1885.41 ms
  - Promoted Timeline ID                : 2
  - Storage-Domain Classification       : SAME_HOST_OBJECT_STORAGE_TEST
=================================================================
REMOTE-ONLY DISASTER RECOVERY DRILL: CRITERIA MET
=================================================================
```

---

## G. RPO, RTO, and Storage-Domain Classification
- **Storage-Domain Classification:**
```text
S3_COMPATIBLE_INTEGRATION: PASS
REMOTE_ONLY_RECOVERY_WITH_TEST_STORAGE: PASS
SAME_HOST_OBJECT_STORAGE_TEST: PASS
LIVE_OFFSITE_RECOVERY: NOT TESTED
```
- **Remote RPO (MinIO Drill):** Steady-state remote WAL lag `1s` (within < 15 min target); during simulated `24.28s` MinIO outage, `pg_stat_archiver.failed_count` incremented to `1` while local encrypted WAL was preserved, draining in `0.73s` upon reconnection.
- **Remote RTO (MinIO Drill):** `3.525s` total cold PITR recovery (`430.97 ms` infra/Redis + `71.74 ms` base backup fetch + `38.34 ms` decrypt/verify + `1092.81 ms` extract/PITR config + `1885.41 ms` remote WAL replay & Timeline 2 promotion).

---

## H. Key Management
```text
LOCAL_HISTORICAL_KEY_RECOVERY: PASS
LIVE_KMS_INTEGRATION: NOT TESTED
```
Multi-epoch `v1` -> `v2` rotation and `ErrKeyRevoked` fail-closed enforcement are exercised by `TestKeyRecoveryDrill_MultiEpochV1AndV2AndRevocation` using `EnvKeyProvider`. Production cloud KMS integration remains **UNTESTED**.

---

## I. Retention and Access Boundaries
`TestRemotePrune_DependencyAwareDryRunAndAudit` exercises dry-run default behavior, sole-backup protection, WAL dependency preservation, and deletion audit logging. Normal archive writers are designed without `s3:DeleteObject` or bucket-policy permissions (`docs/c69_storage_architecture_decision.md`).

---

## J. Build and Regression Results
1. **`tools/byos-backup` Unit Tests & `go vet`:**
   - `go test -count=1 -v ./...`: Exit Code 0 (`ok byos-backup 0.979s`, 6 `TEST_DATABASE_URL` tests skipped).
   - `go vet ./...`: Exit Code 0.
   - `go test -race -count=1 ./...`: Failed to build on Windows host because `gcc` is not installed (`cgo: C compiler "gcc" not found`).
2. **Windows & Linux Cross-Compilation Builds:**
   - `GOOS=windows GOARCH=amd64 go build -trimpath -o byos-backup.exe .`: Exit Code 0.
   - `GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -o byos-backup-linux .`: Exit Code 0.
3. **`tools/byos-migrate`:**
   - Initial run immediately after host restart failed (`FATAL: the database system is starting up`).
   - Retry after `byos-postgres` readiness: `go test -count=1 ./tools/byos-migrate/...` -> Exit Code 0 (`ok byos-migrate 9.809s`).
4. **`services/admin-api`:**
   - `go test -count=1 ./services/admin-api/...` -> Exit Code 0 (`ok admin-api 1.107s`, `ok admin-api/handlers 3.040s`).
5. **`services/api`:**
   - Initial run before `docker start byos-redis` failed (`dial tcp 127.0.0.1:6379: connectex`).
   - Retry after starting `byos-redis` with `TEST_UNMIGRATED_DATABASE_URL`: Exit Code 0 (`ok byos.email/services/api 12.335s`).
6. **`services/outbound-worker` (Compile Check Only — Not Runtime Test Suite):**
   - `cargo check --offline --all-targets`: Exit Code 0 (`Finished dev profile in 0.77s`).

---

## K. Known Limitations
1. **Live Off-Site Cloud Storage:** **UNTESTED** against AWS S3, Cloudflare R2, or Backblaze B2 (pending Stage B operator approval).
2. **Live External KMS / HSM:** **UNTESTED**; only local/env key provider tested.
3. **Same-Host Failure Domain:** Disposable MinIO container ran on the same physical host; this proves S3 API integration and remote-only recovery mechanics, not physical host-loss protection.
4. **Go `-race` Detector on Windows:** **UNTESTED** due to missing `gcc` on host PATH.
5. **Active `byos-postgres`:** Intentionally kept with `BYOS_BACKUP_REMOTE_ENABLED=false` (`archive_mode = on` local archiving preserved).

---

## L. Final Verdict
```text
CONDITIONAL PASS: S3-compatible integration and remote-only recovery work in local test infrastructure; real off-site deployment remains untested.
```
