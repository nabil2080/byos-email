# BYOS C6.9.2C: Versioned Manifest Safety and Retention Lifecycle Hardening Report

**C6.9.2C Status:** **CONDITIONAL PASS** (Manifest delete-before-put failure window removed and all local tests succeeded; account-owner S3 Lifecycle and break-glass retention decisions remain open. **C6.9.2 live AWS verification remains BLOCKED**, Phases B–E remain **UNTESTED**, remote backup remains disabled (`BYOS_BACKUP_REMOTE_ENABLED=false`), and active `byos-postgres` was untouched.)

```text
ok  	byos-backup	31.452s
```

---

## 1. Root Cause of Delete-Before-Put Risk

`SaveRemoteCatalog` (`tools/byos-backup/catalog.go`) and `AWSKMSKeyProvider.saveManifestLocked` (`tools/byos-backup/kms_aws.go`) previously called `Delete` before `Put` on `catalog/recovery_catalog.json` and `keys/key_envelopes.json` because `StorageDestination.Put` enforces immutable-object conflict protection (`ErrObjectAlreadyExists` when an existing object has a different SHA-256). In a versioned S3 bucket, `DeleteObject` creates a delete marker before the replacement `PutObject` runs; if the replacement upload failed or was interrupted, ordinary `GetObject` reads would return `404 NoSuchKey` even though the previous manifest version still existed.

## 2. Manifest Update Implementation Changes

- Added `MutableStorageDestination` (`PutOverwrite`) and `putMutableManifest` in `tools/byos-backup/storage.go`, implemented across `FilesystemStorage`, `MemoryStorage`, and `S3Storage`.
- `S3Storage.PutOverwrite` (`tools/byos-backup/s3_storage.go`) performs a direct `PutObject` without calling `Delete` and without applying Object Lock retention headers, verifies size and `x-amz-meta-byos-sha256` via `StatObject`, aborts incomplete multipart uploads on failure, and **fails closed** (`ErrStoragePermission`) if called on any key other than `catalog/recovery_catalog.json` or `keys/key_envelopes.json`.
- Updated `SaveRemoteCatalog` (`tools/byos-backup/catalog.go`) and `AWSKMSKeyProvider.saveManifestLocked` (`tools/byos-backup/kms_aws.go`) to call `putMutableManifest` directly, eliminating `Delete` from both paths.

## 3. Failure-Injection Test Results

`tools/byos-backup/manifest_versioning_c692c_test.go` tested initial upload, replacement `PutOverwrite`, injected HTTP `503`/`403` `PUT` failures, subsequent retry, historical version preservation without delete markers, and fail-closed rejection on immutable `wal/` and `backups/` keys.

## 4. Concurrency Behavior and Assumptions

- `AWSKMSKeyProvider` serializes in-process `RotateKey`, `RetireKey`, `RevokeKey`, and `saveManifestLocked` calls via `sync.RWMutex` (tested with 3 concurrent `RotateKey` goroutines producing 5 intact versions `v1`–`v5`).
- Across separate OS processes, `PublishBackupToRemote` (`SaveRemoteCatalog`) and `kms-rotate` assume a single-writer operational model. (`minio-go/v7` `PutObjectOptions.SetMatchETag` is noted for future AWS-S3-only conditional `If-Match` enforcement if multi-writer support is ever added.)

## 5. Deletion Call-Site Inventory

| Call Site | Classification | Needs `s3:DeleteObject`? | Notes |
|---|---|---|---|
| `catalog.go` `SaveRemoteCatalog` | Mutable manifest replacement | **No** (removed) | Replaced with `putMutableManifest` (`PutOverwrite`) |
| `kms_aws.go` `saveManifestLocked` | Mutable manifest replacement | **No** (removed) | Replaced with `putMutableManifest` (`PutOverwrite`) |
| `catalog.go` `PruneRemoteBackups` | Backup & WAL pruning | Administrative only | Outside all 4 routine roles; creates delete markers only without `VersionId` |
| `dual_storage.go` `Delete` | Local archive only | **No** | Delegates solely to `d.local.Delete` |
| `wal.go` `ArchiveWALSegment` | Rollback on `.meta.json` write failure | **No** (on S3) | Under `DualStorage`, deletes local only; `WALArchiverRole` has zero `s3:DeleteObject` |

## 6. Final IAM Permission Differences

In `docs/c692_iam_policy_drafts.md`:
- Removed `s3:DeleteObject` from `BackupWriterRole` (`catalog/recovery_catalog.json`) and `KeyAdminRotationRole` (`keys/key_envelopes.json`).
- All four routine roles (`BackupWriterRole`, `WALArchiverRole`, `RecoveryReaderRole`, `KeyAdminRotationRole`) now have **zero `s3:DeleteObject`**, **zero `s3:DeleteObjectVersion`**, and **zero `s3:BypassGovernanceRetention`**.

## 7. Lifecycle Strategy Comparison

- **S3 Lifecycle (`NoncurrentVersionExpiration`, `ExpiredObjectDeleteMarker`, `AbortIncompleteMultipartUpload`):** Automatically reclaims noncurrent versions after Object Lock retention expires without granting `s3:DeleteObjectVersion` or `s3:BypassGovernanceRetention` to application roles. Requires prefix-specific rules so manifests are not expired prematurely. (`LIVE AWS VERIFICATION REQUIRED` on live AWS S3.)
- **Break-Glass `RetentionAdminRole`:** Out-of-band administrative role (approval + MFA/STS + CloudTrail) needed only if early Governance bypass or manual version deletion is required.

## 8. Historical Key-Envelope and Catalog Dependencies

`keys/key_envelopes.json` stores all wrapped DEK versions (`v1`, `v2`, ...). Prior S3 versions of `keys/key_envelopes.json` and `catalog/recovery_catalog.json` must not be expired before the oldest retained backup's key dependencies expire.

## 9. Unresolved Account-Owner Decisions (`ACCOUNT-OWNER DECISION REQUIRED`)

1. Object Lock Governance retention period (days) and S3 Lifecycle `NoncurrentVersionExpiration` days per prefix (`wal/`, `backups/`, `catalog/`, `keys/`).
2. Whether to rely solely on S3 Lifecycle after retention expiry or also provision a break-glass `RetentionAdminRole`.
3. Production hosting region, backup AWS region, and CMK Key Policy delegation.

## 10. Exact Test Results

Command:
```powershell
cd tools/byos-backup; go test -count=1 -v -run 'TestManifestReplacement|TestKMSEnvelopeManifest|TestS3|TestAWSKMS|TestRemote' ./... ; if ($LASTEXITCODE -eq 0) { go test -count=1 ./... } ; if ($LASTEXITCODE -eq 0) { go vet ./... }
```

Observed output (Exit Code `0`):
```text
=== RUN   TestAWSKMS_GenerateRotateDecryptAndNoPlaintextPersisted
--- PASS: TestAWSKMS_GenerateRotateDecryptAndNoPlaintextPersisted (0.00s)
=== RUN   TestManifestReplacement_NoDeleteBeforePutAndFailurePreservesOldManifest
--- PASS: TestManifestReplacement_NoDeleteBeforePutAndFailurePreservesOldManifest (12.96s)
=== RUN   TestKMSEnvelopeManifest_NoDeleteBeforePutFailureAndConcurrency
--- PASS: TestKMSEnvelopeManifest_NoDeleteBeforePutFailureAndConcurrency (3.86s)
=== RUN   TestRemoteCatalog_PublishVerifyAndMissingDependencyCritical
--- PASS: TestRemoteCatalog_PublishVerifyAndMissingDependencyCritical (0.04s)
=== RUN   TestRemotePrune_DependencyAwareDryRunAndAudit
--- PASS: TestRemotePrune_DependencyAwareDryRunAndAudit (0.04s)
=== RUN   TestS3ErrorMappingAndPermanentClassification
--- PASS: TestS3ErrorMappingAndPermanentClassification (0.00s)
=== RUN   TestS3Security_RejectsInsecureNonLocalHTTPAndPartialCreds
--- PASS: TestS3Security_RejectsInsecureNonLocalHTTPAndPartialCreds (0.00s)
=== RUN   TestS3CredentialProvider_ResolveExpiredRefreshAndFailClosed
--- PASS: TestS3CredentialProvider_ResolveExpiredRefreshAndFailClosed (0.00s)
=== RUN   TestS3PrefixContract_ResolutionAndRoundTrip
--- PASS: TestS3PrefixContract_ResolutionAndRoundTrip (0.00s)
=== RUN   TestS3CheckConnectivity_PrefixScopedMockResponses
--- PASS: TestS3CheckConnectivity_PrefixScopedMockResponses (15.00s)
=== RUN   TestS3ObjectLockAndPruning_MockS3Semantics
--- PASS: TestS3ObjectLockAndPruning_MockS3Semantics (0.01s)
=== RUN   TestAWSKMS_EncryptionContextMismatchUnavailableAndHistoricalRecovery
--- PASS: TestAWSKMS_EncryptionContextMismatchUnavailableAndHistoricalRecovery (0.00s)
PASS
ok  	byos-backup	32.192s
ok  	byos-backup	31.452s
```

## 11. Remaining Security Risks

- Multi-process concurrent `SaveRemoteCatalog` or `kms-rotate` writers are not coordinated across hosts (single-writer operational model required unless `If-Match` / `SetMatchETag` is added later).
- Live AWS S3 Object Lock + Lifecycle `NoncurrentVersionExpiration` behavior remains `LIVE AWS VERIFICATION REQUIRED`.

## 12. No Live AWS Resources or Credentials Used

Zero AWS resources, buckets, KMS keys, IAM roles, or credentials were created or accessed. Zero AWS CLI or live cloud API calls were executed. `BYOS_BACKUP_REMOTE_ENABLED` remains `false`, and active `byos-postgres` (`72e2b4cee994`) was untouched.
