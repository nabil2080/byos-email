# BYOS C6.9.2D: Cross-Process Manifest Consistency and Object Lock Validation Report

**C6.9.2D Status:** **CONDITIONAL PASS** (Cross-process S3 conditional-write CAS, fail-closed `MutableStorageDestination` contract, `DualStorage.PutOverwrite`, and Object Lock request behavior all passed offline tests; account-owner bucket-default retention and lifecycle decisions plus live AWS verification remain open. **C6.9.2 live AWS verification remains BLOCKED**, Phases B–E remain **UNTESTED**, `BYOS_BACKUP_REMOTE_ENABLED` remains `false`, and active `byos-postgres` was untouched.)

```text
ok  	byos-backup	31.368s
```

---

## 1. Storage-Interface Implementation Matrix

| Implementation | `StorageDestination` | `MutableStorageDestination` | `ConditionalMutableStorageDestination` | Unsupported / Fail-Closed Behavior |
|---|---|---|---|---|
| `S3Storage` | Yes | Yes (`PutOverwrite`) | Yes (`GetWithETag`, `PutIfMatch`) | `PutOverwrite`/`PutIfMatch` reject non-manifest keys (`wal/`, `backups/`) with `ErrStoragePermission` |
| `MemoryStorage` | Yes | Yes (`PutOverwrite`) | Yes (`GetWithETag`, `PutIfMatch`) | Enforces monotonic version ETags under `sync.RWMutex` |
| `FilesystemStorage` | Yes | Yes (`PutOverwrite`) | No | `putMutableManifest` uses atomic temp+fsync+rename |
| `DualStorage` | Yes | Yes (`PutOverwrite`) | No | Fails closed if `local` or `remote` lacks `MutableStorageDestination` |
| Custom / Other Wrappers | Yes | No | No | `putMutableManifest` **fails closed** with `ErrStoragePermission` (never falls back to delete-before-put) |

## 2. DualStorage Analysis

- `DualStorage.PutOverwrite` writes `local` first, then `remote`.
- If `local` fails, neither copy changes. If `local` succeeds and `remote` fails in `remoteRequired` mode, an error is returned while `local` holds the newer manifest and `remote` retains the older manifest.
- Retrying `PutOverwrite` overwrites `remote` without creating delete markers. (`PublishBackupToRemote` and `AWSKMSKeyProvider` target `S3Storage` directly; `DualStorage` is used by `archive-wal`.)

## 3. Cross-Process Concurrency Findings

- `AWSKMSKeyProvider` previously used an in-process `sync.RWMutex` only, and `SaveRemoteCatalog` had no cross-process coordination, leaving concurrent `PublishBackupToRemote` or `kms-rotate` writers vulnerable to lost-update overwrites.
- `minio-go/v7` (`v7.0.86`) natively supports `PutObjectOptions.SetMatchETag` (`If-Match: "<etag>"`) and `SetMatchETagExcept("*")` (`If-None-Match: *`) in `opts.Header()`, matching AWS S3 conditional writes.

## 4. Single-Writer or Conditional-Write Decision

- Selected **S3 Conditional Writes (`If-Match` / `If-None-Match: *`)** via `ConditionalMutableStorageDestination` (`GetWithETag` + `PutIfMatch`) for both `PublishBackupToRemote` / `PruneRemoteBackups` and `AWSKMSKeyProvider` (`RotateKey`).
- `S3Storage.mapS3Error` maps HTTP `409` / `412` (`PreconditionFailed`, `ConditionalRequestConflict`) to `ErrPreconditionFailed`, which `isPermanentS3Error` marks non-retriable inside `withRetry` so stale bytes are never replayed.

## 5. Conflict and Retry Behavior

- On `ErrPreconditionFailed`, `PublishBackupToRemote` reloads via `LoadRemoteCatalogWithETag`, re-merges the catalog entry by `BackupID`, and retries `SaveRemoteCatalogCAS` (up to `maxCatalogCASRetries = 5`).
- On `ErrPreconditionFailed`, `AWSKMSKeyProvider.RotateKey` reloads `loadManifest`, computes `nextKeyVersionID(p.manifest.Envelopes)`, generates/binds the new DEK, and retries `saveManifestLocked` (up to `maxKMSCASRetries = 5`).

## 6. Manifest Retention Behavior

- `S3Storage.putMutableObject` never calls `applyObjectLockOptions` and never sends `X-Amz-Object-Lock-Mode` or `X-Amz-Object-Lock-Retain-Until-Date` for `catalog/recovery_catalog.json` or `keys/key_envelopes.json`.
- However, if a **bucket-level default Object Lock retention** is configured on the S3 bucket, AWS S3 applies that default retention to every replacement manifest version (`ACCOUNT-OWNER DECISION REQUIRED`: keep bucket default retention unset and rely on per-object retention for `wal/` + `backups/`, or accept small manifest version retention growth under bucket default).

## 7. Prefix-Specific Retention Matrix

| Prefix | Current Versions | Historical Versions | Proposed Cleanup Rule | Recovery Dependency |
|---|---|---|---|---|
| `backups/` | Explicit `GOVERNANCE` retention | Protected until `RetainUntilDate` | `NoncurrentVersionExpiration` > retention + backup policy (`ACCOUNT-OWNER DECISION REQUIRED`) | Base backup + `backup_manifest` for PITR |
| `wal/` | Explicit `GOVERNANCE` retention | Protected until `RetainUntilDate` | `NoncurrentVersionExpiration` > oldest retained backup WAL window (`ACCOUNT-OWNER DECISION REQUIRED`) | Required by retained catalog entries |
| `catalog/` | Unlocked (or bucket-default if set) | Preserved by S3 Versioning | Retain >= oldest retained backup lifetime (`LIVE AWS VERIFICATION REQUIRED`) | Audit/rollback of recovery catalog |
| `keys/` | Unlocked (or bucket-default if set) | Preserved by S3 Versioning | Retain >= oldest retained backup lifetime (`LIVE AWS VERIFICATION REQUIRED`) | `key_envelopes.json` required to unwrap all retained DEKs |

## 8. Historical Key-Envelope Dependencies

`keys/key_envelopes.json` stores all wrapped DEK versions (`v1`, `v2`, ...). Noncurrent versions of `keys/` and `catalog/` must not be expired before all dependent retained backups expire.

## 9. Lifecycle Recommendations

Use bucket-wide `AbortIncompleteMultipartUpload` (e.g. 7 days), prefix-specific `NoncurrentVersionExpiration` + `ExpiredObjectDeleteMarker` on `wal/` and `backups/` strictly after Object Lock retention expires, and preserve `keys/` and `catalog/` versions for the full lifetime of retained backups.

## 10. IAM Draft Changes

No IAM permission additions were needed in `docs/c692_iam_policy_drafts.md`: `If-Match` / `If-None-Match` on `PutObject` uses `s3:PutObject`, and `GetWithETag` uses `s3:GetObject`. All 4 routine roles remain free of `s3:DeleteObject`, `s3:DeleteObjectVersion`, and `s3:BypassGovernanceRetention`.

## 11. Test Results and Exact Output

Command:
```powershell
cd tools/byos-backup; go test -count=1 -v -run 'TestStorageInterface|TestCrossProcess|TestManifestReplacement|TestKMSEnvelopeManifest|TestS3|TestAWSKMS' ./... ; if ($LASTEXITCODE -eq 0) { go test -count=1 ./... } ; if ($LASTEXITCODE -eq 0) { go vet ./... }
```

Observed output (Exit Code `0`):
```text
=== RUN   TestStorageInterfaceContract_AndDualStorageReconciliation
--- PASS: TestStorageInterfaceContract_AndDualStorageReconciliation (0.00s)
=== RUN   TestCrossProcessCatalogCAS_ConflictReloadMergeAndInitialRace
--- PASS: TestCrossProcessCatalogCAS_ConflictReloadMergeAndInitialRace (0.02s)
=== RUN   TestCrossProcessKMSEnvelopeCAS_ConflictReloadAndObjectLockCheck
--- PASS: TestCrossProcessKMSEnvelopeCAS_ConflictReloadAndObjectLockCheck (0.01s)
=== RUN   TestAWSKMS_GenerateRotateDecryptAndNoPlaintextPersisted
--- PASS: TestAWSKMS_GenerateRotateDecryptAndNoPlaintextPersisted (0.00s)
=== RUN   TestManifestReplacement_NoDeleteBeforePutAndFailurePreservesOldManifest
--- PASS: TestManifestReplacement_NoDeleteBeforePutAndFailurePreservesOldManifest (11.25s)
=== RUN   TestKMSEnvelopeManifest_NoDeleteBeforePutFailureAndConcurrency
--- PASS: TestKMSEnvelopeManifest_NoDeleteBeforePutFailureAndConcurrency (3.14s)
=== RUN   TestS3ErrorMappingAndPermanentClassification
--- PASS: TestS3ErrorMappingAndPermanentClassification (0.00s)
=== RUN   TestS3Security_RejectsInsecureNonLocalHTTPAndPartialCreds
--- PASS: TestS3Security_RejectsInsecureNonLocalHTTPAndPartialCreds (0.00s)
=== RUN   TestS3CredentialProvider_ResolveExpiredRefreshAndFailClosed
--- PASS: TestS3CredentialProvider_ResolveExpiredRefreshAndFailClosed (0.00s)
=== RUN   TestS3PrefixContract_ResolutionAndRoundTrip
--- PASS: TestS3PrefixContract_ResolutionAndRoundTrip (0.00s)
=== RUN   TestS3CheckConnectivity_PrefixScopedMockResponses
--- PASS: TestS3CheckConnectivity_PrefixScopedMockResponses (15.66s)
=== RUN   TestS3ObjectLockAndPruning_MockS3Semantics
--- PASS: TestS3ObjectLockAndPruning_MockS3Semantics (0.01s)
=== RUN   TestAWSKMS_EncryptionContextMismatchUnavailableAndHistoricalRecovery
--- PASS: TestAWSKMS_EncryptionContextMismatchUnavailableAndHistoricalRecovery (0.00s)
PASS
ok  	byos-backup	30.353s
ok  	byos-backup	31.368s
```

## 12. Remaining Account-Owner Decisions (`ACCOUNT-OWNER DECISION REQUIRED`)

1. Bucket-default Object Lock retention vs per-object retention only for `wal/` and `backups/`.
2. Object Lock retention period (days) and prefix-specific S3 Lifecycle `NoncurrentVersionExpiration` days.
3. Optional break-glass `RetentionAdminRole` vs S3 Lifecycle-only cleanup after retention expiry.
4. Production hosting region, backup AWS region, and CMK Key Policy delegation.

## 13. Remaining AWS-Only Verification Requirements (`LIVE AWS VERIFICATION REQUIRED`)

1. Live AWS S3 `If-Match` / `If-None-Match` (`409`/`412`) conditional write behavior.
2. Live AWS S3 Object Lock + Lifecycle `NoncurrentVersionExpiration` and `ExpiredObjectDeleteMarker` behavior.
3. Live AWS S3 + KMS + STS + independent-host recovery (C6.9.2 Phases B–E).
