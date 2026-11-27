# BYOS C6.9.2B: S3 Credential, Prefix, and IAM Hardening Report

**C6.9.2B Status:** **CONDITIONAL PASS** (Scoped implementation hardening and offline tests succeeded; two account-owner policy choices remain `NEEDS VERIFICATION` prior to AWS provisioning. **C6.9.2 live AWS verification remains BLOCKED**, Phases B–E remain **UNTESTED**, remote backup remains disabled (`BYOS_BACKUP_REMOTE_ENABLED=false`), and active `byos-postgres` was untouched.)

```text
ok  	byos-backup	14.397s
```

---

## 1. Original Findings (From C6.9.2A)

1. Different credential-provider implementations between `S3Storage` (`minio.credentials.NewIAM("")`) and `AWSKMSKeyProvider` (`awsconfig.LoadDefaultConfig`).
2. Double-prefix defect in `tests/disaster_recovery_live_offsite_c691.ps1` (`remote-list --prefix $env:BYOS_BACKUP_REMOTE_PREFIX`), plus missing `..` traversal rejection and trailing-slash stripping in `S3Storage.objectKey`.
3. `CheckConnectivity` calling `HeadBucket` (`BucketExists`), which lacks `s3:prefix` and conflicts with prefix-scoped `s3:ListBucket` IAM policies.
4. Unresolved Governance retention and `RemoveObject` delete-marker semantics in `PruneRemoteBackups` and mutable manifest replacement.
5. Unverified KMS key-policy delegation and historical recoverability boundaries.

## 2. Root Cause of Each Defect

1. **Credential inconsistency:** `NewS3Storage` (`tools/byos-backup/s3_storage.go`) fell back to `minio-go/v7`'s `credentials.NewIAM("")`, which only queries EC2/ECS metadata endpoints and ignores `~/.aws/*` profiles, SSO, and Web Identity (`OIDC`), whereas `NewAWSKMSKeyProviderFromEnv` (`tools/byos-backup/kms_aws.go`) used `aws-sdk-go-v2` `awsconfig.LoadDefaultConfig`.
2. **Double-prefix & path boundary:** `S3Storage.List` already prepended `s.cfg.Prefix` via `objectKey()`, so passing `--prefix $env:BYOS_BACKUP_REMOTE_PREFIX` in `tests/disaster_recovery_live_offsite_c691.ps1` produced `<prefix>/<prefix>/`. Additionally, `objectKey` used `filepath.Clean` without rejecting `..` traversal segments and stripped trailing `/` on directory prefixes.
3. **`HeadBucket` vs `s3:prefix`:** `BucketExists` sends `HEAD /<bucket>` without an `s3:prefix` query parameter, causing `403 AccessDenied` when an IAM policy constrains `s3:ListBucket` with `s3:prefix`.
4. **Object Lock / Pruning:** `S3Storage.Delete` calls `RemoveObject` without `VersionID` or `GovernanceBypass`. On a versioned bucket, this creates a delete marker only and does not reclaim underlying object versions.

## 3. Exact Files Changed

| File | Reason |
|---|---|
| `tools/byos-backup/s3_storage.go` | Unified S3 credential resolution via `awsSDKV2MinioProvider` (`awsconfig.LoadDefaultConfig` + `aws.CredentialsCache` with 5m expiry window), added `resolveObjectKey` (single-prefix + `..` traversal rejection), and replaced `HeadBucket` in `CheckConnectivity` with prefix-scoped `ListObjects` (`MaxKeys: 1`) |
| `tools/byos-backup/s3_hardening_c692b_test.go` | Added offline tests for credential resolution/expiration/refresh/fail-closed, prefix contract & traversal rejection, prefix-scoped `CheckConnectivity`, Object Lock & delete-marker semantics, and KMS encryption-context/error/rotation behavior |
| `tests/disaster_recovery_live_offsite_c691.ps1` | Removed redundant `--prefix $env:BYOS_BACKUP_REMOTE_PREFIX` from `remote-list` |
| `docs/c692_iam_policy_drafts.md` | Reconciled `s3:ListBucket` `s3:prefix` conditions for all 4 roles, documented `DeleteObject` delete-marker semantics, and updated `NEEDS VERIFICATION` items |
| `docs/c692_account_owner_provisioning_handoff.md` | Appended `C6.9.2B - Implementation Hardening Findings` |
| `docs/c692_s3_credential_iam_hardening_report.md` | Created this C6.9.2B hardening report |

## 4. Credential-Provider Decision & Refresh Behavior

- `S3Storage` now uses `NewS3StorageWithAWSProvider` / `awsSDKV2MinioProvider` (`tools/byos-backup/s3_storage.go`), adapting `aws-sdk-go-v2` `awsconfig.LoadDefaultConfig` and `aws.NewCredentialsCache(..., ExpiryWindow: 5m)` into `minio-go/v7`'s `credentials.Provider` (`RetrieveWithCredContext`, `IsExpired`).
- Both S3 and KMS now support the identical AWS SDK v2 default credential chain: runtime STS env vars (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`), shared `~/.aws/config` & `~/.aws/credentials` profiles/SSO, Web Identity / OIDC (`AWS_WEB_IDENTITY_TOKEN_FILE`), ECS task roles, and EC2 IMDSv2.
- Explicit `BYOS_BACKUP_REMOTE_ACCESS_KEY_FILE` / `SECRET_KEY_FILE` / `SESSION_TOKEN_FILE` remain supported for local/MinIO tests. Empty or failed credential lookups fail closed with `ErrStoragePermission`.

## 5. Prefix Contract & Exact Path Examples

- **Contract:** CLI arguments and `StorageDestination` keys are logical paths relative to `BYOS_BACKUP_REMOTE_PREFIX`; prefixing occurs **once** in `S3Storage.resolveObjectKey`.
- Examples (with `BYOS_BACKUP_REMOTE_PREFIX=c692-synth`):
  - `List("")` -> `c692-synth/`
  - `Put("wal/0001.enc")` -> `c692-synth/wal/0001.enc`
  - `Put("backups/bkp-1/base.tar.enc")` -> `c692-synth/backups/bkp-1/base.tar.enc`
  - `List("wal/")` -> `c692-synth/wal/`
  - `Put("/wal/0001.enc")` -> `c692-synth/wal/0001.enc`
  - `Put("../outside")` or `Put("wal/../../outside")` -> rejected with `ErrStoragePermission`
  - No configured prefix (`""`) + `"wal/0001.enc"` -> `"wal/0001.enc"`

## 6. Connectivity & IAM Permission Decision

- Selected **Option A**: `S3Storage.CheckConnectivity` now executes `ListObjects` with `Prefix: <REMOTE_PREFIX>/` and `MaxKeys: 1` instead of `HeadBucket` (`BucketExists`).
- All 4 IAM roles in `docs/c692_iam_policy_drafts.md` now scope `s3:ListBucket` on `arn:aws:s3:::<BACKUP_BUCKET_NAME>` with `"Condition": { "StringLike": { "s3:prefix": [...] } }`.

## 7. Object Lock & Deletion Semantics

- `wal/` and `backups/` objects receive `GOVERNANCE` (or `COMPLIANCE`) Object Lock retention headers; mutable `catalog/recovery_catalog.json` and `keys/key_envelopes.json` do not.
- `S3Storage.Delete` (`RemoveObject` without `VersionId`) creates a delete marker only in a versioned bucket and never sends `x-amz-bypass-governance-retention`.
- Ordinary roles (`BackupWriterRole`, `WALArchiverRole`, `RecoveryReaderRole`, `KeyAdminRotationRole`) do not receive `s3:BypassGovernanceRetention` or `s3:DeleteObjectVersion`. Permanent version-level pruning requires either natural retention expiry + S3 Lifecycle noncurrent-version expiration or a separate break-glass retention-admin role outside the routine credential chain.

## 8. KMS Policy Analysis

- `AWSKMSKeyProvider` uses `kms:GenerateDataKey` (`KeySpec: AES_256`) only in `kms-rotate` (`KeyAdminRotationRole`) and `kms:Decrypt` in `archive-wal`, `restore-wal`, and `remote-*`, always binding `EncryptionContext` to `byos_key_version` and `byos_purpose=byos_backup`.
- The CMK Key Policy must include account-root IAM delegation (`arn:aws:iam::<ACCOUNT_ID>:root`) so IAM policies on the 4 roles take effect and administrative recovery survives individual role deletion, while omitting `kms:ScheduleKeyDeletion` and `kms:DisableKey` from routine roles.

## 9. IAM Policy Changes

- Updated all 4 role policies in `docs/c692_iam_policy_drafts.md` to add `s3:prefix` conditions on `s3:ListBucket`, preserve `s3:DeleteObject` scoped solely to `catalog/recovery_catalog.json` (`BackupWriterRole`) and `keys/key_envelopes.json` (`KeyAdminRotationRole`), and mark Governance version-level pruning and KMS Key Policy delegation as `NEEDS VERIFICATION`.

## 10. Tests Executed & Exact Outcomes

Command:
```powershell
cd tools/byos-backup; go test -count=1 -v -run 'TestS3|TestAWSKMS' ./... ; if ($LASTEXITCODE -eq 0) { go test -count=1 ./... } ; if ($LASTEXITCODE -eq 0) { go vet ./... }
```

Observed output (Exit Code `0`):
```text
=== RUN   TestAWSKMS_GenerateRotateDecryptAndNoPlaintextPersisted
--- PASS: TestAWSKMS_GenerateRotateDecryptAndNoPlaintextPersisted (0.00s)
=== RUN   TestS3ErrorMappingAndPermanentClassification
--- PASS: TestS3ErrorMappingAndPermanentClassification (0.00s)
=== RUN   TestS3Security_RejectsInsecureNonLocalHTTPAndPartialCreds
--- PASS: TestS3Security_RejectsInsecureNonLocalHTTPAndPartialCreds (0.00s)
=== RUN   TestS3CredentialProvider_ResolveExpiredRefreshAndFailClosed
--- PASS: TestS3CredentialProvider_ResolveExpiredRefreshAndFailClosed (0.00s)
=== RUN   TestS3PrefixContract_ResolutionAndRoundTrip
--- PASS: TestS3PrefixContract_ResolutionAndRoundTrip (0.01s)
=== RUN   TestS3CheckConnectivity_PrefixScopedMockResponses
--- PASS: TestS3CheckConnectivity_PrefixScopedMockResponses (15.89s)
=== RUN   TestS3ObjectLockAndPruning_MockS3Semantics
--- PASS: TestS3ObjectLockAndPruning_MockS3Semantics (0.01s)
=== RUN   TestAWSKMS_EncryptionContextMismatchUnavailableAndHistoricalRecovery
--- PASS: TestAWSKMS_EncryptionContextMismatchUnavailableAndHistoricalRecovery (0.00s)
PASS
ok  	byos-backup	16.171s
ok  	byos-backup	14.397s
```

## 11. Remaining Unresolved Risks

1. Permanent version-level pruning vs S3 Lifecycle noncurrent-version expiration / break-glass retention-admin role (`NEEDS VERIFICATION` by account owner).
2. Confirming CMK Key Policy account-root delegation during AWS provisioning (`NEEDS VERIFICATION` by account owner).
3. Account-owner region and Object Lock retention period selections remain pending.

## 12. No Live AWS Provisioning or Cloud Tests Performed

Zero AWS resources, buckets, KMS keys, IAM roles, or credentials were created or accessed. Zero AWS CLI, AWS SDK, or live cloud API calls were executed. `BYOS_BACKUP_REMOTE_ENABLED` remains `false`, and active `byos-postgres` (`72e2b4cee994`) was untouched.
