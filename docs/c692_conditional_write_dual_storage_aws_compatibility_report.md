# BYOS C6.9.2E: S3 Conditional-Write Compatibility and DualStorage Consistency Audit Report

**Phase:** C6.9.2E (Final Local Engineering Audit Prior to AWS Provisioning)  
**C6.9.2E Audit Status:** **CONDITIONAL PASS** (offline/mock checks succeed; `LIVE AWS VERIFICATION REQUIRED` and `ACCOUNT-OWNER DECISION REQUIRED` items remain)  
**Overall C6.9.2 Live-Cloud Status:** **BLOCKED** (no AWS CLI, credentials, or provisioned AWS resources)  

---

## 1. Executive Summary

This report documents the final local engineering audit of the C6.9.2D conditional-write (CAS) and `DualStorage` implementation in `tools/byos-backup/` before AWS account-owner provisioning begins. All offline unit tests, mock S3 HTTP server tests, SigV4 header-signing assertions, and `go vet` checks pass after the final edit; live AWS S3 and AWS KMS behavior remains `UNTESTED` (`LIVE AWS VERIFICATION REQUIRED`).

---

## 2. Files Edited and Created

| File | Reason |
|---|---|
| `tools/byos-backup/catalog.go` | Added fail-closed `errors.Is(err, ErrObjectNotFound)` handling in `PublishBackupToRemote` CAS loop |
| `tools/byos-backup/kms_aws.go` | Added fail-closed `errors.Is(err, ErrObjectNotFound)` handling in `AWSKMSKeyProvider.RotateKey` CAS loop |
| `tools/byos-backup/conditional_write_error_c692e_test.go` | Added offline tests for SigV4 signed headers, 409/412 retry, 404/delete-marker fail-closed, retry exhaustion, and timeout-after-commit idempotency |
| `tools/byos-backup/dual_storage_consistency_c692e_test.go` | Added offline matrix tests for `DualStorage.PutOverwrite` (both succeed, local fail, remote fail required/optional + retry, stale local vs remote, unsupported wrapper) |
| `docs/c692_iam_policy_drafts.md` | Annotated `BackupWriterRole` and `KeyAdminRotationRole` with explicit C6.9.2E CAS (`If-Match` / `If-None-Match`) `s3:GetObject` + `s3:PutObject` rationale |
| `docs/c692_account_owner_provisioning_handoff.md` | Appended `C6.9.2E - Conditional-Write and DualStorage Readiness` section |
| `docs/c692_conditional_write_dual_storage_aws_compatibility_report.md` | Created this C6.9.2E audit report |

---

## 3. SDK Conditional-Write & SigV4 Inspection

1. **Pinned SDK Version:** `github.com/minio/minio-go/v7 v7.0.86` (`tools/byos-backup/go.mod:33`).
2. **Header Construction (`api-put-object.go`):**
   - `PutObjectOptions.SetMatchETag(etag)` sets `opts.customHeaders.Set("If-Match", "\""+etag+"\"")` (or `"*"`).
   - `PutObjectOptions.SetMatchETagExcept(etag)` sets `opts.customHeaders.Set("If-None-Match", "*")` when `etag == "*"`.
   - `PutObjectOptions.Header()` copies `opts.customHeaders` directly into the outgoing `http.Header`.
3. **SigV4 Signing (`pkg/signer/request-signature-v4.go`):**
   - `v4IgnoredHeaders` only ignores `Accept-Encoding`, `Authorization`, and `User-Agent`.
   - Therefore `If-Match` and `If-None-Match` are canonicalized and included in `SignedHeaders` on every AWS SigV4 request.
   - Offline test `TestConditionalWrite_SigV4SignedHeaders` asserts both `If-None-Match: *` and `If-Match: "<etag>"` appear in the request headers and in `Authorization` `SignedHeaders`.
4. **ETag Quoting:**
   - `S3Storage.GetWithETag` (`tools/byos-backup/s3_storage.go:714`) strips surrounding quotes via `strings.Trim(info.ETag, "\"")`.
   - `S3Storage.putMutableObject` (`tools/byos-backup/s3_storage.go:574-579`) normalizes `cleanETag := strings.Trim(strings.TrimSpace(expectedETag), "\"")` before calling `opts.SetMatchETag(cleanETag)`, preventing double-quoting (`""etag""`).
5. **Single-PUT vs Multipart Threshold:**
   - `s3PartSizeBytes` is `16 * 1024 * 1024` (16 MiB) (`tools/byos-backup/s3_storage.go:29`).
   - `catalog/recovery_catalog.json` and `keys/key_envelopes.json` are small JSON manifests well below 16 MiB and therefore upload via single-PUT `PutObject` where `If-Match` / `If-None-Match` apply atomically. (`LIVE AWS VERIFICATION REQUIRED` if a manifest ever approached 16 MiB.)

---

## 4. Error Handling & Edge-Case Matrix

| Scenario | Implementation Behavior | Test Coverage |
|---|---|---|
| Initial create race (`If-None-Match: *`) | Winner commits; loser receives `412` (`ErrPreconditionFailed`), reloads, merges, retries | `TestCrossProcessCatalogCAS_ConflictReloadMergeAndInitialRace`, `TestConditionalWrite_SigV4SignedHeaders` |
| Stale ETag (`412 PreconditionFailed`) | `withRetry` stops immediately; caller reloads manifest + ETag, merges, retries (max 5) | `TestCrossProcessCatalogCAS_ConflictReloadMergeAndInitialRace`, `TestCrossProcessKMSEnvelopeCAS_ConflictReloadAndObjectLockCheck` |
| `409 Conflict` (`ConditionalRequestConflict`) | `mapS3Error` maps `409` and `ConditionalRequestConflict` to `ErrPreconditionFailed`; triggers reload-merge-retry | `TestConditionalWrite_409ConflictAnd412RetrySucceeds` |
| `404 NoSuchKey` / concurrent delete marker during `If-Match` | `PublishBackupToRemote` and `AWSKMSKeyProvider.RotateKey` fail closed on `ErrObjectNotFound` | `TestConditionalWrite_MissingKey404AndDeleteMarkerFailClosed` |
| Retry exhaustion (`> 5` conflicts) | Returns wrapped `ErrPreconditionFailed` | `TestConditionalWrite_RetryExhaustion` |
| Network/503 after server-side commit | Retry hits `412`, reloads already-committed entry, deduplicates by `BackupID` | `TestConditionalWrite_TimeoutAfterServerCommit_IdempotentRecovery` |

---

## 5. DualStorage Architectural & Consistency Audit

Source inspection (`Select-String -Path "*.go" -Pattern "NewDualStorage|SaveRemoteCatalog|NewAWSKMSKeyProvider"`) confirms:
- `NewDualStorage` is instantiated in production **only** at `tools/byos-backup/main.go:462` for `archive-wal`.
- `SaveRemoteCatalogCAS` (`tools/byos-backup/catalog.go`) and `NewAWSKMSKeyProviderFromEnv` (`tools/byos-backup/main.go:421,529`, `tools/byos-backup/remote_cli.go:24`) target `S3Storage` **directly**, not `DualStorage`.
- `DualStorage` implements `MutableStorageDestination` (`PutOverwrite`) and does **not** implement `ConditionalMutableStorageDestination` (`PutIfMatch`), so manifest CAS operations remain `S3Storage`-only and cannot silently diverge between a local cache and S3.
- `TestDualStorageConsistency_PutOverwriteMatrix` verifies `DualStorage.PutOverwrite` behavior across: both succeed, local failure (neither changes), remote failure in `remoteRequired` mode (local updated, remote preserved, retry reconciles), remote failure in optional mode, stale local vs newer remote, and fail-closed on unsupported wrappers.

---

## 6. Object Lock Retention Matrix

| Prefix | Explicit Object Lock Headers (`S3Storage`) | Bucket Default Retention Applies | Expected Protection |
|---|---|---|---|
| `backups/` | Yes (`GOVERNANCE` + `RetainUntilDate`) | Yes, if configured | `GOVERNANCE` until `RetainUntilDate` (`LIVE AWS VERIFICATION REQUIRED`) |
| `wal/` | Yes (`GOVERNANCE` + `RetainUntilDate`) | Yes, if configured | `GOVERNANCE` until `RetainUntilDate` (`LIVE AWS VERIFICATION REQUIRED`) |
| `catalog/` | No | Yes, if configured (`ACCOUNT-OWNER DECISION REQUIRED`) | Unlocked / S3 Versioning only unless bucket default set (`LIVE AWS VERIFICATION REQUIRED`) |
| `keys/` | No | Yes, if configured (`ACCOUNT-OWNER DECISION REQUIRED`) | Unlocked / S3 Versioning only unless bucket default set (`LIVE AWS VERIFICATION REQUIRED`) |

---

## 7. IAM Policy Verification Summary

Reviewed in `docs/c692_iam_policy_drafts.md`:
- `BackupWriterRole`: Has `s3:GetObject` and `s3:PutObject` on `catalog/recovery_catalog.json` (satisfies AWS `If-Match` and `If-None-Match` CAS).
- `KeyAdminRotationRole`: Has `s3:GetObject` and `s3:PutObject` scoped solely to `keys/key_envelopes.json` (no `kms:Decrypt`, no access to `wal/` or `backups/`).
- All 4 routine roles (`BackupWriterRole`, `WALArchiverRole`, `RecoveryReaderRole`, `KeyAdminRotationRole`) have **zero** `s3:DeleteObject`, **zero** `s3:DeleteObjectVersion`, and **zero** `s3:BypassGovernanceRetention`.

---

## 8. Raw Verification Evidence

### `go test -count=1 -v ./...` and `go vet ./...`
```
=== RUN   TestVerify_ValidBundle
--- PASS: TestVerify_ValidBundle (0.09s)
=== RUN   TestVerify_TamperDetection
--- PASS: TestVerify_TamperDetection (0.05s)
=== RUN   TestVerify_CryptoMetadataValidation
--- PASS: TestVerify_CryptoMetadataValidation (0.06s)
=== RUN   TestVerify_RelationalIntegrity
--- PASS: TestVerify_RelationalIntegrity (0.06s)
=== RUN   TestSection23_ComplianceFlags
--- PASS: TestSection23_ComplianceFlags (0.05s)
=== RUN   TestInspect_Summary
--- PASS: TestInspect_Summary (0.04s)
=== RUN   TestBuildInsertParams
--- PASS: TestBuildInsertParams (0.00s)
=== RUN   TestVerify_MissingManifest
--- PASS: TestVerify_MissingManifest (0.00s)
=== RUN   TestVerify_MissingTableFile
--- PASS: TestVerify_MissingTableFile (0.03s)
=== RUN   TestVerify_InvalidJSON
--- PASS: TestVerify_InvalidJSON (0.04s)
=== RUN   TestVerify_BundleAggregateMismatch
--- PASS: TestVerify_BundleAggregateMismatch (0.05s)
=== RUN   TestRestore_SafeHistoricalBackup
    backup_test.go:872: skipping restore integration test: TEST_DATABASE_URL is not set
--- SKIP: TestRestore_SafeHistoricalBackup (0.01s)
=== RUN   TestRestore_RejectsUnsafeMailboxOrgManagedMode
    backup_test.go:911: skipping restore integration test: TEST_DATABASE_URL is not set
--- SKIP: TestRestore_RejectsUnsafeMailboxOrgManagedMode (0.02s)
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
--- PASS: TestVerify_Post058BackupWithNullOrgRecovery (0.10s)
=== RUN   TestVerify_BackupWithoutOrgRecoveryPrincipals
--- PASS: TestVerify_BackupWithoutOrgRecoveryPrincipals (0.04s)
=== RUN   TestLegacyRecoveryData_NotExposedToApplication
--- PASS: TestLegacyRecoveryData_NotExposedToApplication (0.00s)
=== RUN   TestBaseBackup_PackagingAndManifestRoundtrip
--- PASS: TestBaseBackup_PackagingAndManifestRoundtrip (0.00s)
=== RUN   TestBaseBackup_ComputeWALListForRange
--- PASS: TestBaseBackup_ComputeWALListForRange (0.00s)
=== RUN   TestStorageInterfaceContract_AndDualStorageReconciliation
--- PASS: TestStorageInterfaceContract_AndDualStorageReconciliation (0.00s)
=== RUN   TestCrossProcessCatalogCAS_ConflictReloadMergeAndInitialRace
--- PASS: TestCrossProcessCatalogCAS_ConflictReloadMergeAndInitialRace (0.01s)
=== RUN   TestCrossProcessKMSEnvelopeCAS_ConflictReloadAndObjectLockCheck
--- PASS: TestCrossProcessKMSEnvelopeCAS_ConflictReloadAndObjectLockCheck (0.01s)
=== RUN   TestConditionalWrite_SigV4SignedHeaders
--- PASS: TestConditionalWrite_SigV4SignedHeaders (0.00s)
=== RUN   TestConditionalWrite_409ConflictAnd412RetrySucceeds
--- PASS: TestConditionalWrite_409ConflictAnd412RetrySucceeds (0.01s)
=== RUN   TestConditionalWrite_MissingKey404AndDeleteMarkerFailClosed
--- PASS: TestConditionalWrite_MissingKey404AndDeleteMarkerFailClosed (0.01s)
=== RUN   TestConditionalWrite_RetryExhaustion
--- PASS: TestConditionalWrite_RetryExhaustion (0.02s)
=== RUN   TestConditionalWrite_TimeoutAfterServerCommit_IdempotentRecovery
--- PASS: TestConditionalWrite_TimeoutAfterServerCommit_IdempotentRecovery (0.03s)
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
--- PASS: TestEncryptedArchivePackagingRoundtrip (0.00s)
=== RUN   TestDualStorageConsistency_PutOverwriteMatrix
=== RUN   TestDualStorageConsistency_PutOverwriteMatrix/BothSuccess_ExactManifestInBoth
=== RUN   TestDualStorageConsistency_PutOverwriteMatrix/LocalFails_NeitherCopyChanges
=== RUN   TestDualStorageConsistency_PutOverwriteMatrix/RemoteFailsRequired_LocalUpdated_RemotePreserved_RetryReconciles
=== RUN   TestDualStorageConsistency_PutOverwriteMatrix/RemoteFailsOptional_LocalUpdated_RemotePreserved_RetryReconciles
WARNING: optional remote manifest overwrite failed for catalog/recovery_catalog.json (local manifest updated): storage: destination is unavailable or offline
=== RUN   TestDualStorageConsistency_PutOverwriteMatrix/StaleLocalVsNewerRemote_RemoteAuthoritativeForRecovery
=== RUN   TestDualStorageConsistency_PutOverwriteMatrix/FailClosed_UnsupportedLocalOrRemote
--- PASS: TestDualStorageConsistency_PutOverwriteMatrix (0.00s)
    --- PASS: TestDualStorageConsistency_PutOverwriteMatrix/BothSuccess_ExactManifestInBoth (0.00s)
    --- PASS: TestDualStorageConsistency_PutOverwriteMatrix/LocalFails_NeitherCopyChanges (0.00s)
    --- PASS: TestDualStorageConsistency_PutOverwriteMatrix/RemoteFailsRequired_LocalUpdated_RemotePreserved_RetryReconciles (0.00s)
    --- PASS: TestDualStorageConsistency_PutOverwriteMatrix/RemoteFailsOptional_LocalUpdated_RemotePreserved_RetryReconciles (0.00s)
    --- PASS: TestDualStorageConsistency_PutOverwriteMatrix/StaleLocalVsNewerRemote_RemoteAuthoritativeForRecovery (0.00s)
    --- PASS: TestDualStorageConsistency_PutOverwriteMatrix/FailClosed_UnsupportedLocalOrRemote (0.00s)
=== RUN   TestAWSKMS_GenerateRotateDecryptAndNoPlaintextPersisted
--- PASS: TestAWSKMS_GenerateRotateDecryptAndNoPlaintextPersisted (0.00s)
=== RUN   TestKMS_RotationAndHistoricalAccess
--- PASS: TestKMS_RotationAndHistoricalAccess (0.00s)
=== RUN   TestManifestReplacement_NoDeleteBeforePutAndFailurePreservesOldManifest
--- PASS: TestManifestReplacement_NoDeleteBeforePutAndFailurePreservesOldManifest (13.63s)
=== RUN   TestKMSEnvelopeManifest_NoDeleteBeforePutFailureAndConcurrency
--- PASS: TestKMSEnvelopeManifest_NoDeleteBeforePutFailureAndConcurrency (4.51s)
=== RUN   TestPITR_GenerateRecoveryConf
--- PASS: TestPITR_GenerateRecoveryConf (0.02s)
=== RUN   TestPITR_SelectBaseBackupForTarget
--- PASS: TestPITR_SelectBaseBackupForTarget (0.01s)
=== RUN   TestDualStorage_RequiredVsOptionalSemantics
WARNING: optional remote replication failed for wal/000000010000000000000002.enc (local archive preserved): storage: destination is unavailable or offline
WARNING: optional remote replication failed for wal/000000010000000000000002.meta.json (local archive preserved): storage: destination is unavailable or offline
--- PASS: TestDualStorage_RequiredVsOptionalSemantics (0.01s)
=== RUN   TestRemoteCatalog_PublishVerifyAndMissingDependencyCritical
--- PASS: TestRemoteCatalog_PublishVerifyAndMissingDependencyCritical (0.04s)
=== RUN   TestKeyRecoveryDrill_MultiEpochV1AndV2AndRevocation
--- PASS: TestKeyRecoveryDrill_MultiEpochV1AndV2AndRevocation (0.04s)
=== RUN   TestRemotePrune_DependencyAwareDryRunAndAudit
--- PASS: TestRemotePrune_DependencyAwareDryRunAndAudit (0.05s)
=== RUN   TestS3ErrorMappingAndPermanentClassification
--- PASS: TestS3ErrorMappingAndPermanentClassification (0.00s)
=== RUN   TestS3Security_RejectsInsecureNonLocalHTTPAndPartialCreds
--- PASS: TestS3Security_RejectsInsecureNonLocalHTTPAndPartialCreds (0.00s)
=== RUN   TestDualStorage_ConcurrentUploadIdempotency
--- PASS: TestDualStorage_ConcurrentUploadIdempotency (0.02s)
=== RUN   TestCatalog_RejectsIncompleteStatusAndMissingManifest
--- PASS: TestCatalog_RejectsIncompleteStatusAndMissingManifest (0.00s)
=== RUN   TestRetentionLoneSurvivingBackupNeverPruned
--- PASS: TestRetentionLoneSurvivingBackupNeverPruned (0.00s)
=== RUN   TestRetentionStandardTiers
--- PASS: TestRetentionStandardTiers (0.00s)
=== RUN   TestRetentionAllOlderThanPolicyPreservesNewest
--- PASS: TestRetentionAllOlderThanPolicyPreservesNewest (0.00s)
=== RUN   TestRetention_WALDependencyPreservation
--- PASS: TestRetention_WALDependencyPreservation (0.00s)
=== RUN   TestS3CredentialProvider_ResolveExpiredRefreshAndFailClosed
--- PASS: TestS3CredentialProvider_ResolveExpiredRefreshAndFailClosed (0.00s)
=== RUN   TestS3PrefixContract_ResolutionAndRoundTrip
--- PASS: TestS3PrefixContract_ResolutionAndRoundTrip (0.03s)
=== RUN   TestS3CheckConnectivity_PrefixScopedMockResponses
--- PASS: TestS3CheckConnectivity_PrefixScopedMockResponses (14.50s)
=== RUN   TestS3ObjectLockAndPruning_MockS3Semantics
--- PASS: TestS3ObjectLockAndPruning_MockS3Semantics (0.01s)
=== RUN   TestAWSKMS_EncryptionContextMismatchUnavailableAndHistoricalRecovery
--- PASS: TestAWSKMS_EncryptionContextMismatchUnavailableAndHistoricalRecovery (0.00s)
=== RUN   TestStorage_FilesystemIdempotencyAndConflict
--- PASS: TestStorage_FilesystemIdempotencyAndConflict (0.02s)
=== RUN   TestStorage_MemoryFaultInjection
--- PASS: TestStorage_MemoryFaultInjection (0.00s)
=== RUN   TestWAL_ArchiveAndRestoreRoundtrip
--- PASS: TestWAL_ArchiveAndRestoreRoundtrip (0.09s)
=== RUN   TestWAL_TamperAndWrongKeyDetection
--- PASS: TestWAL_TamperAndWrongKeyDetection (0.06s)
=== RUN   TestWAL_HistoryFileAndGapDetection
--- PASS: TestWAL_HistoryFileAndGapDetection (0.12s)
PASS
ok  	byos-backup	34.181s
```

---

## 9. What Is Untested (`LIVE AWS VERIFICATION REQUIRED`)

- **Live AWS S3 conditional writes (`If-Match` / `If-None-Match`):** `UNTESTED` against real AWS S3; requires account-owner provisioning of the dedicated synthetic bucket and STS roles.
- **Live AWS S3 Object Lock Governance + Lifecycle `NoncurrentVersionExpiration` interaction:** `UNTESTED` against real AWS S3.
- **Live AWS KMS `GenerateDataKey` / `Decrypt` with `EncryptionContext` and IAM policy evaluation:** `UNTESTED` against real AWS KMS.
- **Database restore integration tests (`TestRestore_*`):** Skipped in this run because `TEST_DATABASE_URL is not set`.
