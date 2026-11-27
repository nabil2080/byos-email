# BYOS C6.9.2F: Isolated PostgreSQL Restore Integration Validation Report

**Phase:** C6.9.2F (Isolated Local PostgreSQL Restore Integration & Pre-Provisioning Readiness)  
**C6.9.2F Status:** **PASS** (all six `TestRestore_*` PostgreSQL integration tests, full `tools/byos-backup` suite, and `go vet` exited 0 against an isolated disposable PostgreSQL 16.15 container)  
**Overall C6.9.2 Live-Cloud Status:** **BLOCKED** (AWS Phases B–E remain `UNTESTED`; remote backups remain disabled; no production cutover authorized)

---

## 1. Six Previously Skipped `TestRestore_*` Tests & Skip Cause

In C6.9.2E, the following six tests in `tools/byos-backup/backup_test.go` were skipped because `TEST_DATABASE_URL` was not set:

| Test | Required Database State | Synthetic Fixtures | Expected Result |
|---|---|---|---|
| `TestRestore_SafeHistoricalBackup` | Migrated schema (`001`–`075`, without dropped `org_recovery_principals`) | `createSafeHistoricalTestBackupBundle` (`Private` mailboxes, non-null `org_recovery_pk`, `org_recovery_principals.json`) | `RunRestore(..., dryRun=true, cleanExisting=false)` succeeds; emits warnings for skipped `org_recovery_principals` and cleared retired `org_recovery_pk` |
| `TestRestore_RejectsUnsafeMailboxOrgManagedMode` | `TEST_DATABASE_URL` non-empty (fails in `validateRestoreSafety` pre-flight before DB connect) | `createUnsafeOrgManagedMailboxBundle` (`mailboxes.mode = "org_managed"`) | Refuses restore with error naming `mailboxes` and record `55555555-5555-5555-5555-555555555555` |
| `TestRestore_RejectsUnsafeMailboxWrappedSkOrg` | `TEST_DATABASE_URL` non-empty (fails in `validateRestoreSafety` pre-flight) | `createUnsafeWrappedSkOrgMailboxBundle` (`wrapped_sk_org` non-null) | Refuses restore with error naming `mailboxes` and `wrapped_sk_org` |
| `TestRestore_RejectsUnsafeInvitationLegacyKeyMaterial` | `TEST_DATABASE_URL` non-empty (fails in `validateRestoreSafety` pre-flight) | `createUnsafeInvitationBundle` (`account_invitations` with legacy escrow keys) | Refuses restore with error naming `account_invitations` and `88888888-8888-8888-8888-888888888888` |
| `TestRestore_FailedRestoreLeavesDestinationUnchanged` | Migrated schema with `organizations`, `mailboxes`, `root_secrets` tables | `createUnsafeOrgManagedMailboxBundle` | `RunRestore(..., dryRun=false, cleanExisting=true)` fails pre-flight; destination row counts remain identical before/after |
| `TestRestore_Post058Backup` | Migrated schema (`001`–`075`) | `createPost058TestBackupBundle` (`NULL` `org_recovery_pk`, `Private` mailboxes) | `RunRestore(..., dryRun=true, cleanExisting=false)` succeeds with `RestoredTables >= 7` |

---

## 2. Disposable PostgreSQL Environment & Isolation

- **Container Name:** `byos-c692f-restore-test` (ephemeral; stopped and removed with `docker rm -v` after tests)
- **PostgreSQL Version:** `PostgreSQL 16.15 on x86_64-pc-linux-musl, compiled by gcc (Alpine 15.2.0) 15.2.0, 64-bit` (`postgres:16-alpine`)
- **Network / Port Binding:** Loopback-only `127.0.0.1:55433->5432/tcp`
- **Storage:** Container-local ephemeral filesystem (no host bind mount or shared volume with `byos-postgres`)
- **Test Database Configuration (Redacted):** `postgres://<REDACTED_USER>:<REDACTED_PASSWORD>@127.0.0.1:55433/byos?sslmode=disable` (set only in the test process environment via `$env:TEST_DATABASE_URL` and removed immediately after execution)
- **Active `byos-postgres` Isolation:** Untouched (`72e2b4cee994`, `Exited (255)`, `127.0.0.1:5432->5432/tcp` before and after)

---

## 3. Migration & Fixture Setup

1. Created isolated database `byos` inside `byos-c692f-restore-test` (required because `002_outbound_reservations.sql` and `030_support_crm.sql` execute `GRANT CONNECT ON DATABASE byos ...`).
2. Applied all 74 SQL migrations from `infra/postgres/migrations/` (`001_init.sql` through `075_support_agent_least_privilege_hardening.sql`) in sorted order with `ON_ERROR_STOP=1`.
3. Note on `049_masked_domain_dkim.sql`: inserts a domain row referencing synthetic seed organization `00000000-0000-0000-0000-000000000aaa`; inserted that single synthetic pre-058 row into `organizations` inside `byos-c692f-restore-test` before applying `049`–`075`, yielding `59` public tables.
4. No source files or migrations were modified.

---

## 4. Individual `TestRestore_*` & Group Results

```
=== INDIVIDUAL: TestRestore_SafeHistoricalBackup ===
=== RUN   TestRestore_SafeHistoricalBackup
Notice: destination table "org_recovery_principals" does not exist, skipping insert.
--- PASS: TestRestore_SafeHistoricalBackup (0.25s)
PASS
ok  	byos-backup	0.496s
=== INDIVIDUAL: TestRestore_RejectsUnsafeMailboxOrgManagedMode ===
=== RUN   TestRestore_RejectsUnsafeMailboxOrgManagedMode
--- PASS: TestRestore_RejectsUnsafeMailboxOrgManagedMode (0.05s)
PASS
ok  	byos-backup	0.297s
=== INDIVIDUAL: TestRestore_RejectsUnsafeMailboxWrappedSkOrg ===
=== RUN   TestRestore_RejectsUnsafeMailboxWrappedSkOrg
--- PASS: TestRestore_RejectsUnsafeMailboxWrappedSkOrg (0.06s)
PASS
ok  	byos-backup	0.300s
=== INDIVIDUAL: TestRestore_RejectsUnsafeInvitationLegacyKeyMaterial ===
=== RUN   TestRestore_RejectsUnsafeInvitationLegacyKeyMaterial
--- PASS: TestRestore_RejectsUnsafeInvitationLegacyKeyMaterial (0.05s)
PASS
ok  	byos-backup	0.299s
=== INDIVIDUAL: TestRestore_FailedRestoreLeavesDestinationUnchanged ===
=== RUN   TestRestore_FailedRestoreLeavesDestinationUnchanged
--- PASS: TestRestore_FailedRestoreLeavesDestinationUnchanged (0.09s)
PASS
ok  	byos-backup	0.345s
=== INDIVIDUAL: TestRestore_Post058Backup ===
=== RUN   TestRestore_Post058Backup
--- PASS: TestRestore_Post058Backup (0.20s)
PASS
ok  	byos-backup	0.443s
=== GROUP: TestRestore_ ===
=== RUN   TestRestore_SafeHistoricalBackup
Notice: destination table "org_recovery_principals" does not exist, skipping insert.
--- PASS: TestRestore_SafeHistoricalBackup (0.20s)
=== RUN   TestRestore_RejectsUnsafeMailboxOrgManagedMode
--- PASS: TestRestore_RejectsUnsafeMailboxOrgManagedMode (0.04s)
=== RUN   TestRestore_RejectsUnsafeMailboxWrappedSkOrg
--- PASS: TestRestore_RejectsUnsafeMailboxWrappedSkOrg (0.04s)
=== RUN   TestRestore_RejectsUnsafeInvitationLegacyKeyMaterial
--- PASS: TestRestore_RejectsUnsafeInvitationLegacyKeyMaterial (0.05s)
=== RUN   TestRestore_FailedRestoreLeavesDestinationUnchanged
--- PASS: TestRestore_FailedRestoreLeavesDestinationUnchanged (0.08s)
=== RUN   TestRestore_Post058Backup
--- PASS: TestRestore_Post058Backup (0.18s)
PASS
ok  	byos-backup	0.845s
```

---

## 5. Full Package Suite & `go vet` Results

Command: `go test -count=1 -v ./...` (with `TEST_DATABASE_URL` set to `byos-c692f-restore-test`) followed by `go vet ./...`:

```
=== RUN   TestVerify_ValidBundle
--- PASS: TestVerify_ValidBundle (0.06s)
=== RUN   TestVerify_TamperDetection
--- PASS: TestVerify_TamperDetection (0.06s)
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
--- PASS: TestVerify_InvalidJSON (0.03s)
=== RUN   TestVerify_BundleAggregateMismatch
--- PASS: TestVerify_BundleAggregateMismatch (0.05s)
=== RUN   TestRestore_SafeHistoricalBackup
Notice: destination table "org_recovery_principals" does not exist, skipping insert.
--- PASS: TestRestore_SafeHistoricalBackup (0.19s)
=== RUN   TestRestore_RejectsUnsafeMailboxOrgManagedMode
--- PASS: TestRestore_RejectsUnsafeMailboxOrgManagedMode (0.04s)
=== RUN   TestRestore_RejectsUnsafeMailboxWrappedSkOrg
--- PASS: TestRestore_RejectsUnsafeMailboxWrappedSkOrg (0.06s)
=== RUN   TestRestore_RejectsUnsafeInvitationLegacyKeyMaterial
--- PASS: TestRestore_RejectsUnsafeInvitationLegacyKeyMaterial (0.05s)
=== RUN   TestRestore_FailedRestoreLeavesDestinationUnchanged
--- PASS: TestRestore_FailedRestoreLeavesDestinationUnchanged (0.07s)
=== RUN   TestRestore_Post058Backup
--- PASS: TestRestore_Post058Backup (0.18s)
=== RUN   TestVerify_Post058BackupWithNullOrgRecovery
--- PASS: TestVerify_Post058BackupWithNullOrgRecovery (0.04s)
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
--- PASS: TestConditionalWrite_TimeoutAfterServerCommit_IdempotentRecovery (0.19s)
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
--- PASS: TestDualStorageConsistency_PutOverwriteMatrix (0.00s)
=== RUN   TestAWSKMS_GenerateRotateDecryptAndNoPlaintextPersisted
--- PASS: TestAWSKMS_GenerateRotateDecryptAndNoPlaintextPersisted (0.00s)
=== RUN   TestKMS_RotationAndHistoricalAccess
--- PASS: TestKMS_RotationAndHistoricalAccess (0.00s)
=== RUN   TestManifestReplacement_NoDeleteBeforePutAndFailurePreservesOldManifest
--- PASS: TestManifestReplacement_NoDeleteBeforePutAndFailurePreservesOldManifest (11.25s)
=== RUN   TestKMSEnvelopeManifest_NoDeleteBeforePutFailureAndConcurrency
--- PASS: TestKMSEnvelopeManifest_NoDeleteBeforePutFailureAndConcurrency (4.32s)
=== RUN   TestPITR_GenerateRecoveryConf
--- PASS: TestPITR_GenerateRecoveryConf (0.01s)
=== RUN   TestPITR_SelectBaseBackupForTarget
--- PASS: TestPITR_SelectBaseBackupForTarget (0.00s)
=== RUN   TestDualStorage_RequiredVsOptionalSemantics
--- PASS: TestDualStorage_RequiredVsOptionalSemantics (0.01s)
=== RUN   TestRemoteCatalog_PublishVerifyAndMissingDependencyCritical
--- PASS: TestRemoteCatalog_PublishVerifyAndMissingDependencyCritical (0.01s)
=== RUN   TestKeyRecoveryDrill_MultiEpochV1AndV2AndRevocation
--- PASS: TestKeyRecoveryDrill_MultiEpochV1AndV2AndRevocation (0.03s)
=== RUN   TestRemotePrune_DependencyAwareDryRunAndAudit
--- PASS: TestRemotePrune_DependencyAwareDryRunAndAudit (0.02s)
=== RUN   TestS3ErrorMappingAndPermanentClassification
--- PASS: TestS3ErrorMappingAndPermanentClassification (0.00s)
=== RUN   TestS3Security_RejectsInsecureNonLocalHTTPAndPartialCreds
--- PASS: TestS3Security_RejectsInsecureNonLocalHTTPAndPartialCreds (0.00s)
=== RUN   TestDualStorage_ConcurrentUploadIdempotency
--- PASS: TestDualStorage_ConcurrentUploadIdempotency (0.01s)
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
--- PASS: TestS3PrefixContract_ResolutionAndRoundTrip (0.00s)
=== RUN   TestS3CheckConnectivity_PrefixScopedMockResponses
--- PASS: TestS3CheckConnectivity_PrefixScopedMockResponses (14.50s)
=== RUN   TestS3ObjectLockAndPruning_MockS3Semantics
--- PASS: TestS3ObjectLockAndPruning_MockS3Semantics (0.01s)
=== RUN   TestAWSKMS_EncryptionContextMismatchUnavailableAndHistoricalRecovery
--- PASS: TestAWSKMS_EncryptionContextMismatchUnavailableAndHistoricalRecovery (0.00s)
=== RUN   TestStorage_FilesystemIdempotencyAndConflict
--- PASS: TestStorage_FilesystemIdempotencyAndConflict (0.01s)
=== RUN   TestStorage_MemoryFaultInjection
--- PASS: TestStorage_MemoryFaultInjection (0.00s)
=== RUN   TestWAL_ArchiveAndRestoreRoundtrip
--- PASS: TestWAL_ArchiveAndRestoreRoundtrip (0.09s)
=== RUN   TestWAL_TamperAndWrongKeyDetection
--- PASS: TestWAL_TamperAndWrongKeyDetection (0.05s)
=== RUN   TestWAL_HistoryFileAndGapDetection
--- PASS: TestWAL_HistoryFileAndGapDetection (0.12s)
PASS
ok  	byos-backup	32.068s
TEST_EXIT=0 VET_EXIT=0
```

---

## 6. Defects Discovered & Changes Made

- No defects were discovered in `tools/byos-backup/*.go`.
- No Go source files or SQL migrations were modified.

---

## 7. Restore Correctness & Remaining Integration Gaps

- **Covered by `TestRestore_*`:** Schema/table compatibility (`org_recovery_principals` skipped cleanly, `org_recovery_pk` cleared), pre-flight zero-knowledge safety rejection (`org_managed`, `wrapped_sk_org`, legacy invitation escrow keys), non-destructive failure (`cleanExisting=true` aborted before `TRUNCATE`), and post-058 dry-run transactional restore (`RestoredTables >= 7`).
- **Remaining Local & Cloud Gaps (`UNTESTED`):**
  - `TestRestore_SafeHistoricalBackup` and `TestRestore_Post058Backup` execute with `dryRun=true` (transaction rolled back) rather than committing rows and querying persisted state.
  - Physical `pg_basebackup` + WAL PITR against live AWS S3 + AWS KMS (`LIVE AWS VERIFICATION REQUIRED`) remains `UNTESTED`.
  - Local PostgreSQL integration tests do not prove live AWS S3, AWS KMS, Object Lock Governance, or independent-host recovery behavior.

---

## 8. Isolation & Non-AWS Confirmation

- **Active PostgreSQL (`byos-postgres`):** Untouched (`72e2b4cee994`, `Exited (255)`).
- **AWS Resources / Credentials:** None created, configured, or invoked; `BYOS_BACKUP_REMOTE_ENABLED=false` in `.env.example`.

---

## 9. Files Edited / Created in C6.9.2F

| File | Reason |
|---|---|
| `docs/c692_isolated_restore_integration_validation_report.md` | Created C6.9.2F isolated PostgreSQL restore integration report |
| `docs/c692_account_owner_provisioning_handoff.md` | Appended `C6.9.2F - Isolated Restore Integration Results` section |
