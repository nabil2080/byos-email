# BYOS Release C6.9.2: Live AWS S3 + KMS Integration & Independent-Host Disaster Recovery Acceptance Report

**Status:** **BLOCKED** (Phase A preflight halted at the live AWS provisioning gate; Phases B–E are **UNTESTED** pending account owner provisioning and authorization).

## 1. What was built and checked

No production source files, migrations, or active container configurations were modified during C6.9.2. Phase A preflight checks established that no AWS CLI, no `~/.aws/*` profiles, and no `AWS_*` or `BYOS_BACKUP_*` environment variables are present on this machine, and `tests/disaster_recovery_live_offsite_c691.ps1` exited fail-closed with `BLOCKED`. Per the mandatory safety rules, execution stopped at the provisioning gate without improvising credentials or creating paid AWS resources, while Phase F local regression checks were executed against the existing codebase.

## 2. Files edited

| File | Reason |
|---|---|
| `docs/live_aws_integration_and_independent_recovery_c6_9_2_report.md` | Document Phase A preflight block, AWS provisioning checklist, UNTESTED phases, and Phase F regression outputs |

## 3. Raw evidence — Phase A Preflight

### 3.1 Local AWS CLI, credentials, and environment check

Command:
```powershell
Get-Command aws -ErrorAction SilentlyContinue
Get-ChildItem Env: | Where-Object { $_.Name -match '^(AWS_|BYOS_BACKUP_)' }
Test-Path "$HOME/.aws/config"
Test-Path "$HOME/.aws/credentials"
```

Observed output:
- `Get-Command aws`: empty (AWS CLI is not installed on this host).
- `Get-ChildItem Env: | Where-Object { $_.Name -match '^(AWS_|BYOS_BACKUP_)' }`: empty (no `AWS_*` or `BYOS_BACKUP_*` environment variables set).
- `Test-Path "$HOME/.aws/config"`:
```text
False
```
- `Test-Path "$HOME/.aws/credentials"`:
```text
False
```

### 3.2 Fail-closed live off-site drill preflight

Command:
```powershell
powershell -ExecutionPolicy Bypass -File tests/disaster_recovery_live_offsite_c691.ps1
```

Observed output (Exit Code `1`):
```text
BLOCKED: Required live AWS environment variable 'BYOS_BACKUP_REMOTE_ENDPOINT' is not set.
```

### 3.3 Active PostgreSQL container state (untouched)

Command:
```powershell
docker ps -f name=byos-postgres
```

Observed output:
```text
72e2b4cee994   postgres:16-alpine ... Up 36 minutes (healthy)   127.0.0.1:5432->5432/tcp   byos-postgres
```

## 4. Required AWS Provisioning Checklist (Before Re-running C6.9.2)

Per [docs/c691_aws_provisioning_and_setup.md](file:///f:/Codex/byos-email/docs/c691_aws_provisioning_and_setup.md) and [docs/c69_offsite_provider_decision.md](file:///f:/Codex/byos-email/docs/c69_offsite_provider_decision.md), the account owner must supply and authorize the following synthetic-only AWS resources before Phases B–E can run:

1. **Hosting Region Confirmation:** Specify the actual BYOS production hosting region so the synthetic S3 bucket and KMS CMK can be placed in a geographically separate AWS region.
2. **Object Lock Retention Confirmation:** Specify the exact Governance-mode Object Lock retention period (for example, 30 days for synthetic validation) before bucket creation.
3. **Synthetic S3 Bucket:** Create a dedicated synthetic-only S3 bucket with **Versioning enabled** and **S3 Object Lock (Governance mode)** enabled (no production backups or customer data).
4. **AWS KMS Customer Managed Key (CMK):** Create a dedicated symmetric `ENCRYPT_DECRYPT` KMS CMK in the same region as the synthetic S3 bucket, with an alias (e.g., `alias/byos-backup-synthetic-c692`).
5. **Least-Privilege STS IAM Roles (4 roles):** Provision temporary-credential STS roles for `BackupWriterRole`, `WALArchiverRole`, `RecoveryReaderRole`, and `KeyAdminRotationRole` with `sts:AssumeRole` instead of long-lived static IAM user keys.
6. **AWS CLI & Environment Configuration:** Install AWS CLI v2, configure temporary STS credentials/profiles, and export `BYOS_BACKUP_REMOTE_ENDPOINT`, `BYOS_BACKUP_REMOTE_BUCKET`, `BYOS_BACKUP_REMOTE_REGION`, `BYOS_BACKUP_KMS_KEY_ID`, and `BYOS_BACKUP_OBJECT_LOCK_MODE=GOVERNANCE` + retention settings.
7. **Independent Recovery Host:** Provision a separate recovery machine (e.g., an isolated EC2 instance or separate host with PostgreSQL 16 + `byos-backup`) that has no access to the source PostgreSQL container, local data volume, or local WAL archive.

## 5. What did not work or is untested (Phases B–E)

All live AWS and independent-host phases are **BLOCKED** and **UNTESTED**:

- **Phase B (Live AWS S3 + KMS Synthetic Integration):** **UNTESTED** — uploading synthetic encrypted `pg_basebackup`, encrypted WAL segments, and catalog/manifest files to live AWS S3; wrapping/unwrapping DEKs with live AWS KMS CMK.
- **Phase C (KMS Key Rotation & Historical Recovery):** **UNTESTED** — rotating the AWS KMS key version via `kms-rotate` and decrypting historical WAL segments encrypted under the prior key version.
- **Phase D (S3 Object Lock & Versioning Enforcement):** **UNTESTED** — validating S3 Object Lock `GOVERNANCE` mode retention headers and verifying unauthorized deletion rejection against live AWS S3.
- **Phase E (Independent-Host Physical PITR):** **UNTESTED** — restoring PostgreSQL 16 on a separate recovery host using only live AWS S3 + authorized KMS access without access to the source host, local volume, or local WAL archive.
- **Manual Browser Verification:** Not applicable (infrastructure/DR release; no UI changes).

## 6. Test suite output (Phase F Regression & Build Checks)

### 6.1 Backup tooling tests & vet (`tools/byos-backup`)

Command:
```powershell
cd tools/byos-backup; go test -count=1 ./... ; go vet ./...
```

Observed output (Exit Code `0`):
```text
ok  	byos-backup	0.658s
```
*(Note: A prior `-v` run of `tools/byos-backup` skipped 6 `TEST_DATABASE_URL`-gated PostgreSQL integration tests because `TEST_DATABASE_URL` was not set in this shell.)*

### 6.2 Go service & migration tests (`tools/byos-migrate`, `services/admin-api`, `services/api`)

Command:
```powershell
go test -count=1 ./tools/byos-migrate/... ; go test -count=1 ./services/admin-api/... ; cmd /c "set TEST_UNMIGRATED_DATABASE_URL=postgres://byos:byos_dev_password@127.0.0.1:5432/byos_unmigrated?sslmode=disable && go test -count=1 ./services/api/..."
```

Observed output (Exit Code `0`):
```text
ok  	byos-migrate	9.199s
ok  	admin-api	0.995s
ok  	admin-api/handlers	2.912s
ok  	byos.email/services/api	12.142s
```

### 6.3 Outbound worker compile check (`services/outbound-worker`)

Command:
```powershell
docker run --rm -v "f:/Codex/byos-email:/workspace" -v "byos-cargo-cache:/usr/local/cargo" -v "byos-worker-target:/workspace/services/outbound-worker/target" -w /workspace/services/outbound-worker rustlang/rust:nightly-slim cargo check --offline --all-targets
```

Observed output (Exit Code `0`, compile-only check — not a runtime Rust test execution):
```text
Finished 'dev' profile [unoptimized + debuginfo] target(s) in 1.42s
```

---

## C6.9.2A - Account-Owner Provisioning Handoff

**Status:** **BLOCKED — AWAITING ACCOUNT-OWNER PROVISIONING** (Phases B–E remain **UNTESTED**).

### Handoff Documents Created
- [docs/c692_account_owner_provisioning_handoff.md](file:///f:/Codex/byos-email/docs/c692_account_owner_provisioning_handoff.md) — Full 13-section provisioning handoff, region & Object Lock worksheets, KMS lifecycle checklist, cost worksheet, environment-variable contract, and post-provisioning test gate.
- [docs/c692_iam_policy_drafts.md](file:///f:/Codex/byos-email/docs/c692_iam_policy_drafts.md) — Draft least-privilege IAM policies, STS trust-policy template, resource placeholders, and omissions for `BackupWriterRole`, `WALArchiverRole`, `RecoveryReaderRole`, and `KeyAdminRotationRole`.

### Decisions Still Awaiting the Account Owner
1. Actual BYOS production hosting region and geographically separate AWS S3 + KMS region (same region for S3 bucket and KMS CMK), plus any data-residency constraints.
2. Approved S3 Object Lock Governance retention period (in days) for the synthetic-test bucket.
3. Approval to provision the synthetic S3 bucket (Block Public Access, Versioning, Object Lock Governance), KMS CMK, 4 STS IAM roles, and isolated recovery host.

### IAM Permissions Checked Against Source Code
- `tools/byos-backup/s3_storage.go`: `S3Storage` calls `BucketExists` (`s3:ListBucket`), `ListObjects` (`s3:ListBucket`), `StatObject` / `GetObject` (`s3:GetObject`), `PutObject` with `applyObjectLockOptions` on `wal/` and `backups/` (`s3:PutObject`, `s3:PutObjectRetention`), `RemoveIncompleteUpload` (`s3:AbortMultipartUpload`), and `RemoveObject` (`s3:DeleteObject`).
- `tools/byos-backup/kms_aws.go`: `AWSKMSKeyProvider` calls `kms:GenerateDataKey` (`KeySpec: AES_256`) only in `RotateKey` (`kms-rotate`), calls `kms:Decrypt` in `unwrapEnvelopeLocked` (`archive-wal`, `restore-wal`, `remote-*`), enforces `EncryptionContext` (`byos_key_version`, `byos_purpose=byos_backup`), and calls `Delete` + `Put` on `keys/key_envelopes.json`.
- `tools/byos-backup/catalog.go`: `SaveRemoteCatalog` calls `Delete` + `Put` on `catalog/recovery_catalog.json`.

### Unresolved Questions (`NEEDS VERIFICATION`)
1. Whether adding an `s3:prefix` condition to `s3:ListBucket` blocks `S3Storage.CheckConnectivity` (`BucketExists` / `HeadBucket`), which sends no prefix parameter.
2. Whether a separate break-glass retention-pruning role is desired for `remote-prune --confirm-delete` on Governance-locked objects (none of the 4 C6.9.2A roles grant `s3:BypassGovernanceRetention`).
3. Confirmation that the KMS CMK Key Policy enables IAM policy evaluation (`arn:aws:iam::<ACCOUNT_ID>:root`).
4. Code/harness mismatches documented in `docs/c692_account_owner_provisioning_handoff.md` Section 13 (double-prefix in `tests/disaster_recovery_live_offsite_c691.ps1` line 44; single-session `kms-rotate` + `remote-list`; `S3Storage` `credentials.NewIAM("")` requiring EC2 IMDS or runtime STS env vars on non-EC2 hosts).

### Safety & Non-Modification Attestation
- Zero AWS resources, S3 buckets, KMS keys, IAM roles, or STS sessions were created or modified.
- Zero AWS CLI, AWS SDK, or AWS API commands were executed, and zero AWS credentials were configured or stored.
- `BYOS_BACKUP_REMOTE_ENABLED` remains `false` in `.env.example`; active `byos-postgres` (`72e2b4cee994`) and local WAL/backup configuration were untouched.
