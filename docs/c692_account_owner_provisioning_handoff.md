# BYOS C6.9.2A: Account-Owner AWS Provisioning Handoff

**Current Status:** **BLOCKED — AWAITING ACCOUNT-OWNER PROVISIONING**  
**Scope:** Synthetic-only AWS S3 + AWS KMS validation and independent-host disaster recovery verification (Release C6.9.2 Phases B–E).  
**Safety Guarantee:** No AWS resources, IAM roles, KMS keys, or credentials have been created by this repository task. Active `byos-postgres` (`72e2b4cee994`) and `BYOS_BACKUP_REMOTE_ENABLED=false` remain untouched.

---

## 1. Current C6.9.2 Status

C6.9.2 stopped at **Phase A (Preflight)** because this host has no AWS CLI (`Get-Command aws` empty), no `~/.aws/config` or `~/.aws/credentials`, and no `AWS_*` or `BYOS_BACKUP_*` environment variables configured. Running `tests/disaster_recovery_live_offsite_c691.ps1` exited fail-closed with:

```text
BLOCKED: Required live AWS environment variable 'BYOS_BACKUP_REMOTE_ENDPOINT' is not set.
```

All live-cloud phases (**Phases B–E**) remain **UNTESTED** and **BLOCKED** until an authorized adult AWS account owner reviews this handoff, makes the required decisions, and provisions the synthetic AWS resources.

---

## 2. What Has Already Passed Locally (Phase F & Unit Suites)

The following local checks ran without live AWS access (see [live_aws_integration_and_independent_recovery_c6_9_2_report.md](file:///f:/Codex/byos-email/docs/live_aws_integration_and_independent_recovery_c6_9_2_report.md) for verbatim outputs):

- `tools/byos-backup`: `go test -count=1 ./...` and `go vet ./...` exited `0` (`ok byos-backup 0.658s`; 6 `TEST_DATABASE_URL`-gated PG integration tests skipped when `TEST_DATABASE_URL` is unset).
- `tools/byos-migrate`: `go test -count=1 ./tools/byos-migrate/...` exited `0` (`ok byos-migrate 9.199s`).
- `services/admin-api`: `go test -count=1 ./services/admin-api/...` exited `0` (`ok admin-api 0.995s`, `ok admin-api/handlers 2.912s`).
- `services/api` (with `TEST_UNMIGRATED_DATABASE_URL` set): `go test -count=1 ./services/api/...` exited `0` (`ok byos.email/services/api 12.142s`).
- `services/outbound-worker`: `cargo check --offline --all-targets` exited `0` (`Finished 'dev' profile ... in 1.42s`, compile-only check).

---

## 3. What Remains Untested

- **Phase B:** Live AWS S3 connectivity, bucket region, Versioning, Object Lock Governance retention enforcement, synthetic upload, SHA-256 verification, AWS KMS `GenerateDataKey` / `Decrypt`, exact `EncryptionContext` enforcement, and `v1` -> `v2` key rotation.
- **Phase C:** Independent-host physical PITR using only remote AWS S3 + authorized KMS access (zero access to source PG host, local data volume, local WAL archive, or MinIO), including measured RPO and end-to-end RTO.
- **Phase D:** Controlled synthetic failure tests (missing WAL, wrong KMS key, missing historical key access, IAM permission denial, integrity mismatch, expired STS credentials, interrupted transfer/retry).
- **Phase E:** End-to-end evidence and metrics capture.

---

## 4. Account-Owner Decisions Required Before Provisioning

1. Confirm the **actual BYOS production hosting region** and select a **geographically separate AWS region** for backups.
2. Confirm the **S3 Object Lock Governance retention period** (in days) for the synthetic-test bucket.
3. Approve creation of **one synthetic-only S3 bucket** (with Block Public Access, Versioning, and Object Lock Governance).
4. Approve creation of **one AWS KMS Customer Managed Key (CMK)** in the same region as the S3 bucket.
5. Approve creation of **four least-privilege STS IAM roles** (`BackupWriterRole`, `WALArchiverRole`, `RecoveryReaderRole`, `KeyAdminRotationRole`) using temporary credentials only.
6. Approve provisioning of **one independent recovery host** (e.g., isolated EC2 instance in the recovery region) for Phase C testing.

---

## 5. Region Selection Worksheet

| Decision Item | Account-Owner Input | Constraint |
|---|---|---|
| Actual BYOS production hosting region | `<OWNER_TO_SPECIFY>` | Do not guess or invent |
| Proposed AWS S3 backup region | `<OWNER_TO_SPECIFY>` | Must be geographically separate from production host |
| AWS KMS CMK region | `<SAME_AS_S3_REGION>` | Must match S3 backup bucket region |
| Data residency / organizational restrictions | `<OWNER_TO_SPECIFY>` | Confirm compliance/jurisdiction requirements |

---

## 6. S3 Object Lock Configuration Checklist

- [ ] New general-purpose S3 bucket dedicated to synthetic C6.9.2 testing (zero real customer data or existing BYOS backups).
- [ ] **Block Public Access:** All 4 settings enabled (`true`).
- [ ] **Bucket Versioning:** Enabled.
- [ ] **Object Lock:** Enabled **at bucket creation time** (`--object-lock-enabled-for-bucket`).
- [ ] **Default Retention Mode:** `GOVERNANCE` (matches `BYOS_BACKUP_REMOTE_OBJECT_LOCK_MODE=GOVERNANCE` in `tools/byos-backup/s3_storage.go`).
- [ ] **Approved Retention Period:** `<OWNER_TO_SPECIFY_DAYS>` days (`BYOS_BACKUP_REMOTE_OBJECT_LOCK_DAYS`).
- [ ] **Bucket Ownership & Encryption:** Bucket Owner Enforced (`ObjectOwnership=BucketOwnerEnforced`), Default SSE-S3 or SSE-KMS enabled beneath BYOS `BYOSENC1` AES-256-GCM.
- [ ] **Access Boundary:** Strictly private; no public bucket policy; no unintended cross-account access.

**Operational Consequences (Must Be Understood Before Creation):**
- Once Object Lock is enabled on an S3 bucket, **it cannot be disabled**, and **Bucket Versioning cannot be suspended**.
- Governance mode can be bypassed **only** by principals granted `s3:BypassGovernanceRetention`. Ordinary backup writers (`BackupWriterRole`) and WAL archivers (`WALArchiverRole`) must **never** receive `s3:BypassGovernanceRetention`.
- Note from `tools/byos-backup/s3_storage.go`: Object Lock retention headers are applied to `wal/` and `backups/` objects; mutable `catalog/recovery_catalog.json` and `keys/key_envelopes.json` remain unlocked and are protected by Bucket Versioning.

---

## 7. KMS Configuration & Key-Lifecycle Checklist

Inspecting `tools/byos-backup/kms_aws.go` confirms the exact AWS KMS behavior:

- [ ] **Key Type & Usage:** Symmetric `SYMMETRIC_DEFAULT` (`AES_256`), `ENCRYPT_DECRYPT` Customer Managed Key (CMK).
- [ ] **Region:** Same AWS region as the S3 bucket (`BYOS_BACKUP_KMS_REGION`, falls back to `BYOS_BACKUP_REMOTE_REGION`).
- [ ] **Key Identifier:** CMK ARN or Key ID configured in `BYOS_BACKUP_KMS_KEY_ID` (required for `kms-rotate` / `GenerateDataKey`).
- [ ] **API Operations Used:**
  - `kms:GenerateDataKey` (`KeySpec: AES_256`) — called **only** by `RotateKey()` (`byos-backup kms-rotate`) to mint a new 256-bit DEK (`v1`, `v2`, ...).
  - `kms:Decrypt` — called by `unwrapEnvelopeLocked()` during `GetActiveKey()` (`archive-wal`) and `GetKeyVersion()` (`restore-wal`, `remote-verify`, `recovery-catalog`). Plaintext DEKs are cached in memory only and never persisted.
- [ ] **Exact Encryption Context:** Every `GenerateDataKey` and `Decrypt` call sends:
  - `"byos_key_version": "<version_id>"` (e.g., `"v1"`, `"v2"`)
  - `"byos_purpose": "byos_backup"`
- [ ] **Envelope Persistence & Post-Rotation Recovery:** Wrapped DEK ciphertexts are stored in S3 at `<prefix>/keys/key_envelopes.json` (`WrappedKeyManifest`). Rotating via `kms-rotate` marks the prior version `"retired"` and the new version `"active"`. Older backups encrypted under `"v1"` remain recoverable as long as `"v1"` is not `"revoked"` and the AWS KMS CMK remains enabled.
- [ ] **Key Administration Separation:** Only `KeyAdminRotationRole` receives `kms:GenerateDataKey` and scoped CMK inspection/rotation permissions.

**Critical Warning:** Deleting or scheduling deletion of an AWS KMS CMK can make every backup and WAL segment whose DEK was wrapped under that CMK **permanently unrecoverable**. Never delete historical KMS keys merely because a newer DEK version exists; preserve historical key access until retention and backup dependencies have been independently checked.

---

## 8. Four-Role IAM Permissions Matrix

Full draft JSON policies, trust policies, and `NEEDS VERIFICATION` notes are in [c692_iam_policy_drafts.md](file:///f:/Codex/byos-email/docs/c692_iam_policy_drafts.md).

| Role | Required Operations (Derived from Source) | Explicitly Prohibited Operations | Resource Scope |
|---|---|---|---|
| `BackupWriterRole` | `s3:ListBucket` (`s3:prefix`), `s3:PutObject`, `s3:PutObjectRetention`, `s3:GetObject`, `s3:AbortMultipartUpload` (`backups/*`, `wal/*`); `s3:GetObject`/`PutObject` (`catalog/recovery_catalog.json`); `s3:GetObject` (`keys/key_envelopes.json`); `kms:Decrypt` (with EncryptionContext) | Zero `s3:DeleteObject`, zero `s3:DeleteObjectVersion`, `s3:BypassGovernanceRetention`, `kms:GenerateDataKey`, KMS admin | Synthetic bucket + `<REMOTE_PREFIX>` + single CMK |
| `WALArchiverRole` | `s3:ListBucket` (`s3:prefix`), `s3:PutObject`, `s3:PutObjectRetention`, `s3:GetObject`, `s3:AbortMultipartUpload` (`wal/*`); `s3:GetObject` (`keys/key_envelopes.json`); `kms:Decrypt` (with EncryptionContext) | Zero `s3:DeleteObject`, `s3:BypassGovernanceRetention`, `kms:GenerateDataKey`, write access to `backups/*`/`catalog/*`/`keys/*` | Synthetic bucket + `<REMOTE_PREFIX>/wal/*` + `keys/key_envelopes.json` + single CMK |
| `RecoveryReaderRole` | `s3:ListBucket` (`s3:prefix`), `s3:GetObject` (`backups/*`, `wal/*`, `catalog/recovery_catalog.json`, `keys/key_envelopes.json`); `kms:Decrypt` (with EncryptionContext) | All S3 writes (`PutObject`), zero `s3:DeleteObject`, `s3:BypassGovernanceRetention`, `kms:GenerateDataKey`, KMS admin | Synthetic bucket + `<REMOTE_PREFIX>` (read-only) + single CMK |
| `KeyAdminRotationRole` | `s3:ListBucket` (`s3:prefix`), `s3:GetObject`/`PutObject` (`keys/key_envelopes.json`); `kms:GenerateDataKey` (with EncryptionContext); scoped CMK inspect/enable-rotation | Zero `s3:DeleteObject`, `kms:ScheduleKeyDeletion`, `kms:DisableKey`, `s3:BypassGovernanceRetention`, access to `backups/*` or `wal/*`, wildcard `*` resources | Synthetic bucket + `<REMOTE_PREFIX>/keys/key_envelopes.json` + single CMK |

---

## 9. Independent Recovery Host Requirements

- **Isolation:** Must be a separate host (e.g., isolated EC2 instance in `<AWS_REGION>`) with **zero** access to the original PostgreSQL container, local PostgreSQL data volume, local `postgres-archive` volume, or any local MinIO instance.
- **Software:** PostgreSQL 16 (`pg_basebackup`, `pg_ctl`, `psql`), `byos-backup` Linux binary (`tools/byos-backup/byos-backup-linux` or freshly built from `tools/byos-backup`).
- **Identity & Network:** Attached to `RecoveryReaderRole` via EC2 Instance Profile (or temporary STS env vars) with HTTPS (`443`) egress to AWS S3 (`s3.<region>.amazonaws.com`) and AWS KMS (`kms.<region>.amazonaws.com`).
- **Data Constraint:** Synthetic test tables and synthetic backups only.

---

## 10. Cost & Ownership Worksheet

Do **not** treat prior estimates as a fixed total. Actual cost depends on account-owner inputs not yet supplied:

| Cost Category | Billing Driver | Missing Account-Owner Inputs |
|---|---|---|
| **S3 Storage** | Standard GB-month + Versioning + Object Lock retained versions | Synthetic dataset size, production DB size, retention days |
| **S3 Requests** | `PUT`/`LIST`/`PutObjectRetention` (`archive-wal`, `PutFile`), `GET`/`HEAD` (`StatObject`, `remote-verify`, `restore-wal`) | WAL generation rate, verification frequency |
| **AWS KMS** | Monthly CMK base fee + automatic rotation versions + API calls (`GenerateDataKey` / `Decrypt`) | Rotation cadence, request volume |
| **Data Transfer** | Cross-region/internet egress during independent-host restore | Restore frequency and restored GB/month |
| **Recovery Host Compute** | On-demand EC2 + EBS during DR drills vs always-on standby | Instance type, EBS size, drill hours/month |

**Billing Reminder:** AWS Budgets / billing alerts notify on thresholds; **they are not guaranteed spending caps** and do not automatically stop S3, KMS, or EC2 charges.

---

## 11. Environment-Variable Contract & Exact Configuration Values

Verified against `tools/byos-backup/s3_storage.go`, `tools/byos-backup/kms_aws.go`, `.env.example`, and `tests/disaster_recovery_live_offsite_c691.ps1`:

| Variable | Purpose | Example Format (Placeholder) | Secret? | Source |
|---|---|---|---|---|
| `BYOS_BACKUP_REMOTE_ENABLED` | Enable remote S3 replication (`false` locally until live test) | `false` (or `true` in isolated live test shell) | No | `s3_storage.go`, `.env.example` |
| `BYOS_BACKUP_REMOTE_ENDPOINT` | **Required** by `NewS3Storage` & `c691.ps1` even for AWS S3 | `https://s3.<AWS_REGION>.amazonaws.com` | No | `s3_storage.go`, `c691.ps1` |
| `BYOS_BACKUP_REMOTE_REGION` | AWS S3 region (defaults to `us-east-1` if unset) | `<AWS_REGION>` | No | `s3_storage.go`, `c691.ps1` |
| `BYOS_BACKUP_REMOTE_BUCKET` | Target synthetic S3 bucket name | `<BACKUP_BUCKET_NAME>` | No | `s3_storage.go`, `c691.ps1` |
| `BYOS_BACKUP_REMOTE_PREFIX` | Object key prefix inside bucket | `c692-synth` | No | `s3_storage.go`, `.env.example` |
| `BYOS_BACKUP_REMOTE_PATH_STYLE` | Use virtual-hosted style (`false` for AWS S3) | `false` | No | `s3_storage.go`, `.env.example` |
| `BYOS_BACKUP_REMOTE_REQUIRED` | Fail WAL archive if remote upload fails | `true` (live test only) / `false` (default) | No | `dual_storage.go`, `.env.example` |
| `BYOS_BACKUP_REMOTE_OBJECT_LOCK_MODE` | Object Lock mode on `wal/` & `backups/` | `GOVERNANCE` | No | `s3_storage.go`, `.env.example` |
| `BYOS_BACKUP_REMOTE_OBJECT_LOCK_DAYS` | Object Lock retention days | `<OWNER_DAYS>` | No | `s3_storage.go`, `.env.example` |
| `BYOS_BACKUP_REMOTE_MAX_RETRIES` | Retry count (default `2`) | `2` | No | `s3_storage.go` |
| `BYOS_BACKUP_REMOTE_TIMEOUT` | Timeout duration (default `15s`) | `15s` | No | `s3_storage.go` |
| `BYOS_BACKUP_KMS_PROVIDER` | Select AWS KMS (`aws`) vs env key | `aws` | No | `remote_cli.go`, `main.go` |
| `BYOS_BACKUP_KMS_KEY_ID` | CMK ARN or Key ID (required for `kms-rotate` & `c691.ps1`) | `arn:aws:kms:<AWS_REGION>:<ACCOUNT_ID>:key/<KMS_KEY_ID>` | No | `kms_aws.go`, `c691.ps1` |
| `BYOS_BACKUP_KMS_REGION` | KMS region (falls back to `BYOS_BACKUP_REMOTE_REGION`) | `<AWS_REGION>` | No | `kms_aws.go`, `.env.example` |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN` | Ephemeral STS credentials (or EC2 Instance Profile when unset) | `<STS_RUNTIME_ONLY>` | **Yes** | `s3_storage.go`, `kms_aws.go` |

**Important Runtime Credential-Chain Note:** `AWSKMSKeyProvider` uses `aws-sdk-go-v2` `LoadDefaultConfig` (supports EC2 IMDS, `~/.aws/*`, SSO, Web Identity, and env vars). However, `S3Storage` (`minio-go/v7`) uses `credentials.NewIAM("")` when `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` are unset, which works on **EC2 Instance Profiles** but does **not** read `~/.aws/credentials` profiles on a workstation. On a non-EC2 host, temporary STS env vars (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`) must be exported in the runtime shell only (never written to files or chat).

---

## 12. Post-Provisioning Test Gate & Verification Checklist

Phases B–E of C6.9.2 may proceed **only** after every prerequisite above is provisioned and the account owner authorizes live synthetic execution:

- **Phase B (Live S3 & KMS):** Verify S3 connectivity, bucket region, Versioning, Object Lock Governance headers, synthetic backup upload + SHA-256 verification, KMS `GenerateDataKey` + `Decrypt`, exact `EncryptionContext` enforcement, retention behavior, and `v1` -> `v2` key rotation with historical recovery.
- **Phase C (Independent Recovery):** Execute remote-only PITR on the isolated recovery host (zero access to source host/volume/local WAL/MinIO), restore historical key-envelope backups, run DB integrity checks, and measure RPO and end-to-end RTO.
- **Phase D (Synthetic Failure Tests):** Test missing/inaccessible WAL, wrong KMS key, missing historical key access, IAM permission denial, SHA-256 integrity mismatch, expired STS credentials, and interrupted transfer/retry.
- **Phase E (Evidence & Metrics):** Record exact test environment, synthetic dataset size, backup/WAL timestamps, restore start/finish times, RPO, end-to-end RTO, integrity result, post-rotation recovery result, and sanitized logs, classifying each check as `PASS`, `FAIL`, `BLOCKED`, or `NOT TESTED`.

---

## 13. Stop Conditions, Rollback, & Code/Harness Mismatches Found

### Explicit Stop Conditions
Stop immediately if any credential is missing/expired, if any Object Lock or IAM check fails unexpectedly, if real customer data is ever referenced, or if any command touches active `byos-postgres` (`72e2b4cee994`). Rollback is zero-impact locally because `BYOS_BACKUP_REMOTE_ENABLED` remains `false`; on AWS, synthetic objects expire after the Governance retention period and the synthetic CMK/bucket can be decommissioned by the account owner after verification.

### Mismatches Identified During Code Inspection (For Future Fix Before Live Run)
1. **Single-Session Script vs 4-Role Separation:** `tests/disaster_recovery_live_offsite_c691.ps1` runs both `kms-rotate` (`KeyAdminRotationRole`) and `remote-list` in one shell session, which will need role-switching or separate invocations during live testing.
2. **Role Naming & Pruning:** `docs/c691_aws_provisioning_and_setup.md` named `wal-writer`, `backup-writer`, `recovery-reader`, `retention-admin` and gave `wal-writer` `kms:GenerateDataKey`, whereas C6.9.2A/B specifies `BackupWriterRole`, `WALArchiverRole`, `RecoveryReaderRole`, and `KeyAdminRotationRole` (and only `kms-rotate` calls `GenerateDataKey`).

---

## C6.9.2B - Implementation Hardening Findings

1. **Unified Credential-Provider Strategy:** `S3Storage` (`tools/byos-backup/s3_storage.go`) now adapts AWS SDK v2 `awsconfig.LoadDefaultConfig` + `aws.CredentialsCache` (`awsSDKV2MinioProvider`) into `minio-go/v7` whenever static/file credentials are not explicitly set. Both S3 and KMS now share the exact same AWS SDK v2 default credential chain (STS env vars, `~/.aws/*` profiles/SSO, Web Identity/OIDC, ECS task roles, and EC2 IMDSv2) with automatic pre-expiry refresh and fail-closed rejection on missing/expired/invalid credentials.
2. **Prefix Contract:** All CLI paths (`remote-list --prefix`, `remote-fetch --object-key`) and `StorageDestination` keys are logical paths relative to `BYOS_BACKUP_REMOTE_PREFIX`. Prefix application occurs **exactly once** inside `S3Storage.resolveObjectKey`, which rejects `..` path-traversal segments and empty object keys. `tests/disaster_recovery_live_offsite_c691.ps1` was updated to call `remote-list` without duplicating `BYOS_BACKUP_REMOTE_PREFIX`.
3. **Connectivity Check & Prefix-Scoped `s3:ListBucket`:** `S3Storage.CheckConnectivity` now uses prefix-scoped `ListObjects` (`MaxKeys: 1`, `Prefix: <REMOTE_PREFIX>/`) instead of `HeadBucket` (`BucketExists`), allowing all four IAM roles to restrict `s3:ListBucket` using `s3:prefix` conditions.
4. **Object Lock & Pruning Semantics:** `S3Storage.Delete` (`RemoveObject` without `VersionId`) creates delete markers only in a versioned bucket and never sends `x-amz-bypass-governance-retention`. Mutable `catalog/recovery_catalog.json` and `keys/key_envelopes.json` do not receive Object Lock headers. Permanent version-level pruning (`s3:DeleteObjectVersion`) or early Governance bypass remains outside all 4 routine roles and requires either natural retention expiry + S3 Lifecycle rules or an explicit break-glass retention-admin decision by the account owner.
5. **KMS Key Policy Design:** The CMK Key Policy must include account-root IAM delegation (`arn:aws:iam::<ACCOUNT_ID>:root`) so IAM policies on the 4 roles take effect and administrative recovery survives individual role deletion, while keeping `kms:GenerateDataKey` restricted to `KeyAdminRotationRole` and excluding `kms:ScheduleKeyDeletion` / `kms:DisableKey`.
6. **Account-Owner Decisions Still Required:** Production hosting region, backup AWS region, Object Lock Governance retention period, and break-glass pruning preference remain unresolved until supplied by the account owner.

---

## C6.9.2C - Manifest and Retention Lifecycle Design

1. **Manifest Replacement Strategy:** `SaveRemoteCatalog` (`catalog/recovery_catalog.json`) and `AWSKMSKeyProvider.saveManifestLocked` (`keys/key_envelopes.json`) now use `MutableStorageDestination.PutOverwrite` (`tools/byos-backup/s3_storage.go`) to perform direct replacement `PutObject` calls without creating a delete marker first. `PutOverwrite` fails closed if called on immutable `wal/` or `backups/` keys.
2. **Failure Behavior and Guarantees:** If a replacement `PutObject` fails or is interrupted mid-transfer, `RemoveIncompleteUpload` aborts the multipart upload and the previous manifest version remains the current readable version in S3.
3. **Concurrency Assumptions:** `AWSKMSKeyProvider` serializes in-process rotations via `sync.RWMutex`. Across processes, `PublishBackupToRemote` (`SaveRemoteCatalog`) and `kms-rotate` assume a single-writer operational model. (`minio-go/v7` `PutObjectOptions.SetMatchETag` is available if multi-writer conditional `If-Match` is ever required on AWS S3.)
4. **Backup and WAL Deletion-Permission Requirements:** All four routine roles (`BackupWriterRole`, `WALArchiverRole`, `RecoveryReaderRole`, `KeyAdminRotationRole`) now have **zero `s3:DeleteObject`**, **zero `s3:DeleteObjectVersion`**, and **zero `s3:BypassGovernanceRetention`**.
5. **Delete-Marker Behavior:** In a versioned S3 bucket, an ordinary `DeleteObject` creates a delete marker that hides the object from `GetObject`/`ListObjects` while Object Lock continues protecting underlying versions. Removing `s3:DeleteObject` from all routine roles prevents any workload from hiding retained backups.
6. **Lifecycle Cleanup Recommendation (`ACCOUNT-OWNER DECISION REQUIRED`):**
   - Apply `AbortIncompleteMultipartUpload` (e.g., 7 days) across the bucket.
   - Apply prefix-specific `NoncurrentVersionExpiration` + `ExpiredObjectDeleteMarker` on `<REMOTE_PREFIX>/wal/` and `<REMOTE_PREFIX>/backups/` only after Object Lock retention and backup retention policies have elapsed (AWS S3 will not expire locked versions before their `RetainUntilDate`).
   - Do **not** apply aggressive `NoncurrentVersionExpiration` to `<REMOTE_PREFIX>/keys/` or `<REMOTE_PREFIX>/catalog/`; retain historical versions at least as long as the oldest retained backup.
7. **Historical Catalog and Key-Envelope Dependencies:** `keys/key_envelopes.json` accumulates all wrapped DEK versions (`v1`, `v2`, ...). Even if overwritten, prior S3 object versions act as an immutable audit/recovery safety net if an envelope is ever retired/revoked or rolled back.
8. **Break-Glass Requirements:** Routine `remote-prune --confirm-delete` cannot bypass Governance retention or permanently delete object versions without a separate, out-of-band `RetentionAdminRole` (requiring explicit owner approval, MFA/STS, CloudTrail logging, and `s3:DeleteObjectVersion` / `s3:BypassGovernanceRetention` scoped strictly to `<REMOTE_PREFIX>/backups/*` and `<REMOTE_PREFIX>/wal/*`).
9. **Account-Owner Decisions Still Required (`ACCOUNT-OWNER DECISION REQUIRED`):** Confirm Object Lock retention days, confirm S3 Lifecycle `NoncurrentVersionExpiration` days per prefix, and decide whether to rely solely on S3 Lifecycle after retention expiry or also provision a break-glass `RetentionAdminRole`.
10. **Behaviors Requiring `LIVE AWS VERIFICATION REQUIRED`:** Exact AWS S3 Object Lock + Lifecycle `NoncurrentVersionExpiration` interaction, `ExpiredObjectDeleteMarker` cleanup, and `AbortIncompleteMultipartUpload` behavior cannot be proven by local MinIO/mock tests and must be verified on live AWS S3 during C6.9.2 Phases B–E.

---

## C6.9.2D - Manifest Concurrency and Object Lock Findings

1. **Storage Interface Implementation Matrix:**
   - `S3Storage` & `MemoryStorage`: Implement `StorageDestination`, `MutableStorageDestination` (`PutOverwrite`), and `ConditionalMutableStorageDestination` (`GetWithETag`, `PutIfMatch`).
   - `FilesystemStorage` & `DualStorage`: Implement `StorageDestination` and `MutableStorageDestination` (`PutOverwrite`).
   - Any wrapper omitting `MutableStorageDestination` now **fails closed** with `ErrStoragePermission` in `putMutableManifest` (never falls back to delete-before-put).
2. **DualStorage Behavior:** `DualStorage.PutOverwrite` writes `local` first, then `remote`. If `local` succeeds and `remote` fails in `remoteRequired` mode, an error is returned; retrying `PutOverwrite` reconciles `remote` without deleting either copy. Note that `SaveRemoteCatalog` and `AWSKMSKeyProvider` target `S3Storage` directly (`DualStorage` is used for `archive-wal`).
3. **Cross-Process Writer Model & Conditional-Write Decision:** `AWSKMSKeyProvider` (`RotateKey`) and `PublishBackupToRemote` / `PruneRemoteBackups` now enforce **S3 Conditional Writes (`If-Match` / `If-None-Match: *`)** via `minio-go/v7` `PutObjectOptions.SetMatchETag` / `SetMatchETagExcept`, backed by `GetWithETag`.
4. **Conflict-Handling Design:** On HTTP `409`/`412` (`ErrPreconditionFailed`), `withRetry` stops immediately (no stale byte replay), and the caller reloads the latest manifest + ETag, merges its update (or recomputes `nextKeyVersionID`), and retries up to 5 times.
5. **Retention Applied to Newly Written Manifest Versions:** `S3Storage.PutOverwrite` / `PutIfMatch` never sends explicit `X-Amz-Object-Lock-*` headers for `catalog/` or `keys/`. However, if a **bucket-level default Object Lock retention** is configured on the S3 bucket, AWS S3 applies that default retention to every replacement manifest version (`ACCOUNT-OWNER DECISION REQUIRED`: keep bucket default retention unset and rely on per-object retention for `wal/` + `backups/`, or accept small manifest version retention growth under bucket default).
6. **Prefix-Specific Lifecycle & Historical-Key Dependencies:**

| Prefix | Current Versions | Historical Versions | Proposed Cleanup Rule | Recovery Dependency |
|---|---|---|---|---|
| `backups/` | Explicit `GOVERNANCE` retention | Protected until `RetainUntilDate` | `NoncurrentVersionExpiration` > retention + backup policy (`ACCOUNT-OWNER DECISION REQUIRED`) | Base backup + `backup_manifest` for PITR |
| `wal/` | Explicit `GOVERNANCE` retention | Protected until `RetainUntilDate` | `NoncurrentVersionExpiration` > oldest retained backup WAL window (`ACCOUNT-OWNER DECISION REQUIRED`) | Required by retained catalog entries |
| `catalog/` | Unlocked (or bucket-default if set) | Preserved by S3 Versioning | Retain >= oldest retained backup lifetime (`LIVE AWS VERIFICATION REQUIRED`) | Audit/rollback of recovery catalog |
| `keys/` | Unlocked (or bucket-default if set) | Preserved by S3 Versioning | Retain >= oldest retained backup lifetime (`LIVE AWS VERIFICATION REQUIRED`) | `key_envelopes.json` required to unwrap all retained DEKs |

7. **No IAM Permission Changes Required:** `If-Match` / `If-None-Match` on `PutObject` uses standard `s3:PutObject`, and `GetWithETag` uses `s3:GetObject`. All 4 routine roles remain free of `s3:DeleteObject`, `s3:DeleteObjectVersion`, and `s3:BypassGovernanceRetention`.

---

## C6.9.2E - Conditional-Write and DualStorage Readiness

1. **AWS S3 SDK & SigV4 Compatibility:**
   - Pinned SDK: `github.com/minio/minio-go/v7 v7.0.86` (`tools/byos-backup/go.mod`).
   - `PutObjectOptions.SetMatchETag(cleanETag)` sets `If-Match: "<cleanETag>"` and `SetMatchETagExcept("*")` sets `If-None-Match: "*"` in `opts.customHeaders`.
   - `PutObjectOptions.Header()` merges `opts.customHeaders` into the HTTP request headers, and `pkg/signer/request-signature-v4.go` (`v4IgnoredHeaders`) only excludes `Accept-Encoding`, `Authorization`, and `User-Agent`, so both `If-Match` and `If-None-Match` are included in `SignedHeaders` (proven by `TestConditionalWrite_SigV4SignedHeaders`).
   - ETag normalization (`strings.Trim(strings.TrimSpace(expectedETag), "\"")` before `SetMatchETag`) prevents double-quoting (`""etag""`).
   - Multipart threshold (`s3PartSizeBytes = 16 MiB`): JSON manifests (`catalog/recovery_catalog.json`, `keys/key_envelopes.json`) remain single-PUT objects well below 16 MiB.
2. **404 / Delete-Marker Fail-Closed Hardening:**
   - `PublishBackupToRemote` (`tools/byos-backup/catalog.go`) and `AWSKMSKeyProvider.RotateKey` (`tools/byos-backup/kms_aws.go`) now explicitly detect `errors.Is(err, ErrObjectNotFound)` during CAS `PutIfMatch` and fail closed rather than recreating a manifest under a potentially wrong state.
3. **DualStorage & Manifest Consistency Architecture:**
   - `DualStorage` (`tools/byos-backup/dual_storage.go`) is instantiated **only** for `archive-wal` (`tools/byos-backup/main.go:462`).
   - `SaveRemoteCatalogCAS` and `AWSKMSKeyProvider` target `S3Storage` directly (`main.go:421,529`, `remote_cli.go:24`), so manifest CAS writes never split-brain across local and remote copies.
   - If `DualStorage.PutOverwrite` is ever used directly, local is written first and remote second; in `remoteRequired` mode, remote failure returns an error and retrying `PutOverwrite` reconciles both copies without deleting either.
4. **IAM & Object Lock Readiness:**
   - `BackupWriterRole` (`s3:GetObject` + `s3:PutObject` on `catalog/recovery_catalog.json`) and `KeyAdminRotationRole` (`s3:GetObject` + `s3:PutObject` on `keys/key_envelopes.json`) satisfy AWS S3 `If-Match` / `If-None-Match` requirements with zero `s3:DeleteObject`, `s3:DeleteObjectVersion`, or `s3:BypassGovernanceRetention`.
   - **Overall C6.9.2 Status:** Remains **BLOCKED** pending account-owner provisioning and live AWS verification (`LIVE AWS VERIFICATION REQUIRED` items).

---

## C6.9.2F - Isolated Restore Integration Results

1. **Isolated PostgreSQL Restore Execution:** All six previously skipped `TestRestore_*` integration tests (`TestRestore_SafeHistoricalBackup`, `TestRestore_RejectsUnsafeMailboxOrgManagedMode`, `TestRestore_RejectsUnsafeMailboxWrappedSkOrg`, `TestRestore_RejectsUnsafeInvitationLegacyKeyMaterial`, `TestRestore_FailedRestoreLeavesDestinationUnchanged`, `TestRestore_Post058Backup`) were executed individually and as part of the full `tools/byos-backup` suite (`go test -count=1 ./...` in `32.068s`, `go vet ./...` exit `0`) against a disposable `postgres:16-alpine` (`PostgreSQL 16.15`) container (`byos-c692f-restore-test`) with all 74 migrations (`001`–`075`) applied.
2. **Isolation & Cleanup:** `byos-postgres` was never accessed or modified, `byos-c692f-restore-test` was stopped and removed after testing, and `BYOS_BACKUP_REMOTE_ENABLED=false` remains unchanged.
3. **Remaining Live AWS Requirements:** Local PostgreSQL restore tests do not prove live AWS S3, AWS KMS, S3 Object Lock Governance, or independent-host recovery. C6.9.2 live AWS Phases B–E remain **BLOCKED / UNTESTED** until account-owner provisioning is completed.

---

## C6.9.2L - Active Database Migration Baseline Findings

1. **Root Cause of `byos-migrate` `ExitCode: 1`:** `byos-postgres` has `51` user tables (`52` total including empty `schema_migrations`), `8/8` `ExpectedColumns068` (including `drafts.folder`/`folder_id` from `068`), and `4/4` `ProhibitedObjects068` absent (`63/66` checks passed). The 3 missing tables (`support_notification_outbox`, `support_reply_tokens`, `support_inbound_dedup`) belong to `066_support_notifications_and_reply_tokens.sql` and are actively used by `services/api/support_notifications.go` and `services/admin-api/handlers/notifications.go`.
2. **Resolution Blocker:** `byos-migrate` correctly fails closed rather than stamping `068` on an incomplete schema. Under separate operator authorization (after a pre-migration backup), `066` must be applied forward-only before `byos-migrate baseline --version 068 --confirm` and `byos-migrate up` (`069`–`075`) can succeed. The migration blocker remains **unresolved** in this read-only phase.

---

## C6.9.2M - Active Database Migration Repair Rehearsal

1. **PITR Clone & Rehearsal:** Restored `byos_physical_baseline_c684.tar.enc` + continuous WAL archive (`0000000100000000000000A1`–`B4`) into isolated `byos-c692m-migration-rehearsal` (`52` public tables, `63/66` baseline checks). Applying `066_support_notifications_and_reply_tokens.sql` transactionally resolved all 3 missing tables (`66/66`), `byos-migrate baseline --version 068 --confirm` stamped `001`–`068`, and `byos-migrate up` applied `069`–`075` cleanly (`74` `schema_migrations` rows, `byos-migrate verify` succeeded).
2. **Active DB Untouched:** Active `byos-postgres` was not modified; the active migration baseline remains unresolved until separately authorized.

---

## C6.9.2N - Active Database Migration Readiness

1. **Read-Only Preflight:** Active `byos-postgres` (`72e2b4cee994`, `healthy`) and `byos-redis` (`7199c4dceb5f`, `healthy`) verified unchanged; `byos-migrate` (`41e62c251776`) remains `Exited (1)`. `066` objects are completely absent (`0` partial effects), `067` grants (`role_support_agent`) are already present, and `byos_physical_baseline_c684.tar.enc` + continuous WALs (`0000000100000000000000A1`–`B8`, `failed_count = 0`, lag `3m24s`) provide a verified physical PITR recovery path.
2. **Authorization Gate:** Active migration execution plan is documented in `docs/c692_active_database_migration_execution_plan.md` and remains **awaiting explicit operator authorization** (`APPROVE ACTIVE DATABASE MIGRATION C6.9.2N`). Active PostgreSQL has not been modified.

---

## C6.9.2O - Core Application Recovery

1. **Migration & Core Services Verified:** Following C6.9.2N execution, `byos-migrate` (`41e62c251776`) reconciled cleanly to `Exited (0)` (`0` pending migrations, `byos-migrate verify` succeeded). `byos-postgres`, `byos-redis`, `byos-minio` (`byos-mailbox` bucket present), `byos-crypto-worker`, `byos-storage-worker`, `byos-admin-api` (`401` on unauthenticated `/admin/v1/...`), and `byos-support-crm` (`200` on `:3003`) are all running and verified.
2. **Safety & Excluded Services:** No excluded services were started during C6.9.2O (though `byos-api`, `byos-webmail`, `byos-control-plane`, `byos-mail-router`, `byos-rspamd`, `byos-inbound-bridge`, `byos-mailpit`, `byos-postfix`, and `byos-outbound-worker` were already `Up` from the user's earlier `start_dev.bat` run). `BYOS_BACKUP_REMOTE_ENABLED=false` remains unchanged.

---

## C6.9.2P - Runtime Containment Audit

1. **Read-Only Audit (`2026-11-26T10:13:50Z`, `ffd4692`):** Confirmed `outbound_queue` has `0` pending/processing rows (`delivered = 1`), `scheduled_messages` = `0`, `support_notification_outbox` = `0`. However, `byos-inbound-bridge` is actively listening on `0.0.0.0:25` / `[::]:25`, `byos-outbound-worker` is polling every 5s, and `byos-api` is running background workers.
2. **Containment Gate:** No containers were stopped or started in C6.9.2P; explicit operator approval is required before stopping the excluded mail/API containers or cleaning up stray `sweet_napier` and `byos-public-site`. `BYOS_BACKUP_REMOTE_ENABLED=false` remains unchanged.

---

## C6.9.2Q - Controlled Runtime Containment

1. **Containment Executed (`2026-11-26T10:43:44Z`–`10:44:20Z`):** Under explicit approval `APPROVE C6.9.2Q CONTAINMENT`, gracefully stopped `outbound-worker`, `inbound-bridge`, `api`, `webmail`, `control-plane`, `mail-router`, `rspamd`, `postfix`, `mailpit`, and orphaned `sweet_napier` (`f833023698ad`) with `EXIT=0` for all 10 targets.
2. **Verified Core State:** `byos-postgres`, `byos-redis`, `byos-minio`, `byos-crypto-worker`, `byos-storage-worker`, `byos-admin-api`, and `byos-support-crm` remain running/healthy; `byos-migrate` and `byos-minio-init` remain `Exited (0)`; `byos-public-site` remains `Exited (1)`; `BYOS_BACKUP_REMOTE_ENABLED=false` remains unchanged.

---

## C6.9.2R - Application Startup Safety & Readiness Audit

1. **Read-Only Audit (`2026-11-26T11:10:34Z`, `ffd4692`):** Confirmed contained baseline intact (`api`, `webmail`, `control-plane`, and all mail/SMTP services stopped). Traced all 7 `byos-api` startup routines (`startScheduledPathADelivery` delivers only internal Path A rows and never writes `outbound_queue` or connects to Postfix; `RunStartupMigrationReconciliation` runs no DDL). Verified `go vet` (`api`) and `vite build` (`webmail`, `control-plane`) succeed.
2. **Approval Gate:** Staged startup plan for `api` -> `webmail` -> `control-plane` is documented in `docs/c692_application_startup_readiness_c6_9_2r_report.md` and awaits explicit approval (`APPROVE C6.9.2S APPLICATION STARTUP`).

---

## C6.9.2S / C6.9.2T - Staged Application Startup & Read-Only Smoke Tests

1. **C6.9.2S Startup:** Under explicit approval `APPROVE C6.9.2S APPLICATION STARTUP`, `byos-api` (`cf4cf78ae28a`), `byos-webmail` (`382308900a82`), and `byos-control-plane` (`6ad4ea19667f`) were started sequentially and verified.
2. **C6.9.2T Smoke Tests (`2026-11-26T11:32:09Z`):** Verified `api` `/health` (`HTTP 200`, `postgres`/`redis`/`minio` `up`; `postfix`/`rspamd` `down` due to containment), `/v1/auth/me` -> `401`, Webmail (`127.0.0.1:3001`) and Control Plane (`127.0.0.1:3000`) login UIs with zero console errors, `outbound_queue` (`0` pending), `scheduled_messages` (`0`), excluded mail ports closed, and `BYOS_BACKUP_REMOTE_ENABLED=false`.

---

## C6.9.2U - Authenticated Test Readiness & Fixture Audit

1. **Fixtures & Auth Flow:** Verified synthetic local fixtures `alice@byos.local` and `bob@byos.local` (`Smoke Test Org`, `mode: private`, `two_factor_enabled: false`). Traced `loginHandler` -> client-isolated `HttpOnly`, `SameSite=Lax`, `Path=/` cookies (`byos_webmail_session`, `byos_cp_session`, `byos_session`) with no token in JSON responses and no tokens in `localStorage`/`sessionStorage`.
2. **Approval Gate:** Safe read-only authenticated test plan is documented in `docs/c692_authenticated_test_readiness_c6_9_2u_report.md` and awaits explicit approval (`APPROVE C6.9.2V AUTHENTICATED SMOKE TESTS`).

---

## C6.9.2V - Authenticated Smoke Tests

**Verdict:** **PASS** (Report: `docs/c692_authenticated_smoke_tests_c6_9_2v_report.md`)

1. **HTTP API & Proxy Auth Matrix:** Unauthenticated `GET /v1/auth/me` returned `401` across `127.0.0.1:8080`, `3001`, and `3000`. Real `POST /v1/auth/login` for `alice@byos.local` returned `200` with `HttpOnly; SameSite=Lax; Path=/` cookies (`byos_webmail_session`, `byos_cp_session`), no `token` in JSON, `200` on `/v1/auth/me`, `/v1/users/me/mailboxes`, `/v1/domains`, and `/v1/auth/organization-members`, `403` on cross-mailbox access (`alice` -> `bob` `c0000000-...-0002`), `204` on `POST /v1/auth/logout`, and `401` on session reuse.
2. **Browser Verification:** Real headless Chrome logins on Webmail (`http://127.0.0.1:3001/`) and Control Plane (`http://127.0.0.1:3000/dashboard`) succeeded with `HttpOnly` + `SameSite=Lax` cookies, zero auth tokens in `localStorage`/`sessionStorage`, screenshots saved to `tests/browser/artifacts/c6_9_2v_webmail_authenticated.png` and `tests/browser/artifacts/c6_9_2v_control_plane_authenticated.png`, and clean `204` logout -> `401` reuse verification.
3. **Observation:** `GET /v1/users/me/mailboxes` (`services/api/mailboxes.go:1139`) lists `bob`'s private mailbox for `alice` (`owner` role) due to org-owner visibility, though `verifyUserMailboxSession` fails closed with `403` on access. All mail/SMTP ports (`25, 2525, 1025, 8025`) remain closed and `BYOS_BACKUP_REMOTE_ENABLED=false` remains unchanged.

> **C6.9.2W Clarification on C6.9.2V:**
> - **Confirmed:** Authentication flow (`POST /v1/auth/login`, `GET /v1/auth/me`, `POST /v1/auth/logout`) works; message-level cross-mailbox access (`alice` -> `bob`) is denied (`403 Forbidden`).
> - **Open / Audited in C6.9.2W:** Mailbox-directory visibility (`GET /v1/users/me/mailboxes` returning `bob`'s private mailbox to `alice`), two leftover sessions from aborted C6.9.2V runs, unlogged C6.9.2V browser-console errors (3 Webmail, 2 Control Plane), and cross-application cookie fallback ambiguity when `detectClient(r) == ""` are documented in `docs/c692_private_mailbox_authorization_session_hygiene_c6_9_2w_report.md`.

---

## C6.9.2W - Private Mailbox Directory Authorization & Session Hygiene Audit

**Verdict:** **CONDITIONAL PASS** (Report: `docs/c692_private_mailbox_authorization_session_hygiene_c6_9_2w_report.md`)

1. **Private Mailbox Directory (`services/api/mailboxes.go:1139`):** Confirmed `userMailboxesHandler` uses legacy `OR (m.org_id = u.org_id AND u.role IN ('admin', 'owner'))` without `m.mode = 'org_managed'`, exposing Bob's private mailbox ID/email/display name to Alice over the wire (though Webmail filters by `user.mailbox_id` and `isMailboxAuthorizedForSession` fails closed with `403`).
2. **Leftover Sessions:** Positively identified the 2 unrevoked `alice@byos.local` sessions (`ae4a79c7-d267-4a47-917a-acbed2fe212c` and `8385e661-8b1e-4fa9-86dc-8c6572cd3643`, `ua = 'node'`) from the two aborted pre-fix C6.9.2V runs; no sessions revoked during read-only C6.9.2W.
3. **Cookie Isolation & `sessionStorage`:** `byos_webmail_session` and `byos_cp_session` are strictly isolated when `detectClient(r)` matches `webmail` or `control-plane`, but `client == ""` falls back to `byos_session` -> `byos_cp_session` -> `byos_webmail_session`. Webmail `byos_keys_published_*` stores only `"1"` keyed by public key fingerprints (no secrets).
4. **Console Errors & Next Step:** Original C6.9.2V console error strings were not persisted by `scratch/c692v_smoke.mjs`. Recommended a separate **C6.9.2X** remediation milestone.

---

## C6.9.2X - Private Mailbox Authorization & Session Isolation Remediation

**Verdict:** **CONDITIONAL PASS** (Report: `docs/c692_private_mailbox_authorization_session_isolation_c6_9_2x_report.md`)

1. **Authorization Fixes (`services/api/mailboxes.go`):** Restricted `GET /v1/users/me/mailboxes` to `m.user_id = $1` (plus explicit session-linked mailboxes) so `owner`/`admin` roles never expose other users' private mailboxes; enforced `isAdmin(userID, orgID, conn)` on `GET /v1/organizations/{org_id}/mailboxes`.
2. **Cookie Isolation (`services/api/auth.go`, `services/api/sessions.go`):** Added `detectClient` conflict detection (`"conflict"` fails closed) and shared `extractSessionToken(r)` so unknown client contexts accept only `byos_session` (never `byos_cp_session` or `byos_webmail_session`) and `clearSessionCookie` clears only the matching context cookie.
3. **Verification & Console Classification:** `go vet ./...` and targeted Go auth/session/mailbox/TOTP tests passed (`ok byos.email/services/api 12.776s` against `byos_test_isolation`), Webmail `npm.cmd test` passed (`735 passed, 0 failed`), and Control Plane `npm.cmd test` + `vite build` passed. Classified all 5 C6.9.2V browser console errors (4 expected `401`/Permissions Policy; 1 Webmail defect `ReferenceError: setActiveMailboxContext is not defined` at `App.tsx:2503` / `2731`).
4. **Remaining Blockers:** `byos-api` container was not rebuilt/restarted (per C6.9.2X boundaries), 5 pre-existing unrelated tests failed in full `go test ./...`, and the 2 leftover Alice sessions (`ae4a79c7-...`, `8385e661-...`) remain unrevoked for C6.9.2Y.

---

## C6.9.2Y - Webmail Login Repair, Session Boundary Verification & Runtime Validation

**Verdict:** **PASS** (Report: `docs/c692_runtime_validation_webmail_login_c6_9_2y_report.md`)

1. **Task A (Webmail Login):** Confirmed `apps/webmail/src/App.tsx:44` already imports `setActiveMailboxContext` from `api.ts:313` and passes `npm.cmd test` (`735 passed`) + `npm.cmd run build` (`10.14s`). The live error at `App.tsx:2503` came from the stale baked `byos-webmail` image (`Mounts: []`).
2. **Task B (Cookie & Spoofing Isolation):** Added 4 conflict/spoofing subtests to `TestCrossAppCookieIsolationAndConflictFailClosed` in `services/api/cookie_auth_test.go`; `go vet ./...` and targeted Go tests passed (`ok byos.email/services/api 0.599s`).
3. **Task C (5 Full API Failures):** Baseline comparison on isolated `HEAD` (`ffd4692`) worktree proved all 5 failures are pre-existing (`startup_guard.go` `IsDevMode()` vs `BYOS_DEV_MODE=1`, `mailboxes_user_id_fkey` cleanup SQL bug, and `support_tickets_test.go` `"disposable"` DB name guard).
4. **Gate A & Gate B Completed:** Rebuilt and recreated only `api` (`byos-api`) and `webmail` (`byos-webmail`) via `--no-deps --force-recreate`, verified live `/health`, Alice & Bob `/v1/users/me/mailboxes` strict isolation, cross-mailbox `403`, cross-app/conflict/unknown cookie rejection (`401`), clean Webmail browser login (`tests/browser/artifacts/c6_9_2y_webmail_live_login.png`, zero `setActiveMailboxContext` errors), and executed **Gate B** (`UPDATE 2`, setting `revoked_at = 2026-11-26 16:01:24.800048+00` on `ae4a79c7-...` and `8385e661-...` for `alice@byos.local`).

---

## C6.9.2Z - API Test Suite Reliability & Failure Remediation

**Verdict:** **CONDITIONAL PASS** (Report: `docs/c692_api_test_suite_reliability_c6_9_2z_report.md`)

1. **Startup/Key-Mismatch Tests (`services/api/startup_guard_test.go`):** Preserved fail-closed `IsDevMode()` in `startup_guard.go`; updated tests to set both `BYOS_ENV=development` and `BYOS_DEV_MODE=1`, and verified production/staging/unset/invalid modes skip key-mismatch checks.
2. **Cleanup FK Tests (`tools/clean-test-data.sql`):** Excluded users/domains/orgs still referenced by surviving `mailboxes` and cleaned `support_ticket_messages`/`support_tickets` for `target_test_users` before deleting `users` (`mailboxes_user_id_fkey` resolved).
3. **Support Ticket Integration (`services/api/support_tickets_test.go`):** Added `X-BYOS-Client: control-plane` alongside `byos_cp_session` while preserving the `"disposable"` DB guard; verified all 5 targeted tests + `go vet ./...` pass (`ok byos.email/services/api 0.986s`) on `byos_disposable_c692z` with active `byos` untouched. Full `go test ./...` still exits `1` on unrelated `BYOS_ENV`/unmigrated-DB tests.

---

## C6.9.2AA - Full API Test Suite Stabilization

**Verdict:** **PASS** (Report: `docs/c692_full_api_test_suite_stabilization_c6_9_2aa_report.md`)

1. **Attachment CSRF & Cookie Context (`message_attachments_test.go`, `path_a_attachments_test.go`):** Configured test-local `BYOS_ALLOWED_ORIGINS`, supplied `Origin: http://127.0.0.1:3001` + `X-BYOS-Client: webmail` + `byos_webmail_session`, fixed synthetic all-zero IVs, and added `TestUploadAttachmentChunk_CSRFRejection`.
2. **Unmigrated Registration (`byos_unmigrated_c692aa`):** Provisioned disposable DB with migrations `001`–`057` (`org_recovery_pk.is_nullable = 'NO'`) so `TestRegistrationCompatibilityPreAndPostMigration` passes end-to-end.
3. **Recovery MFA & Cookie Fixes (`services/api/recovery.go:430`, `recovery_flow_test.go`):** Fixed passkey-only MFA bypass in `changePasswordHandler` (now returns `403` when `mfa_code` is empty), updated reset tests to read `byos_session` cookie, and used `step_up_mfa` challenge for `TestPasswordModificationInvalidatesPendingReactivations`.
4. **Full Suite Result:** `go vet ./...` and full `go test ./...` in `services/api` passed (`ok byos.email/services/api 92.933s`) against `byos_disposable_c692z` and `byos_unmigrated_c692aa`, with active `byos` untouched.
