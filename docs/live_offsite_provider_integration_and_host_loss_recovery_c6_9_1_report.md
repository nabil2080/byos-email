# Live Off-Site Provider Integration & Host-Loss Recovery (Release C6.9.1 — Stage C Preparation) Report

## 1. Executive Summary
Release C6.9.1 completed implementation preparation for live **AWS S3 + AWS KMS** off-site backup and host-loss recovery without provisioning paid cloud resources, modifying active `byos-postgres` (`72e2b4cee994`), or transferring real BYOS backups. Implemented `AWSKMSKeyProvider` (`tools/byos-backup/kms_aws.go`) with AWS KMS envelope encryption (`GenerateDataKey` / `Decrypt` bound via `EncryptionContext` to `byos_key_version`), extended `S3Storage` (`tools/byos-backup/s3_storage.go`) with S3 Object Lock (`GOVERNANCE` / `COMPLIANCE`) retention headers on `wal/` and `backups/` objects and configurable timeout/retry flags, wired `BYOS_BACKUP_KMS_PROVIDER=aws` into CLI commands (`archive-wal`, `restore-wal`, `remote-*`, `kms-rotate`), updated the corrected cost estimate in `docs/c69_offsite_provider_decision.md`, authored `docs/c691_aws_provisioning_and_setup.md` with least-privilege IAM Role/STS specifications, and created `tests/disaster_recovery_live_offsite_c691.ps1`. Live AWS S3 + AWS KMS connectivity and separate-host recovery remain **UNTESTED** pending account owner provisioning and authorization.

---

## 2. Files Changed / Created

| File | Reason |
|---|---|
| `tools/byos-backup/go.mod`, `go.sum` | Added `github.com/aws/aws-sdk-go-v2/config` (`v1.33.21`) and `github.com/aws/aws-sdk-go-v2/service/kms` (`v1.63.0`). |
| `tools/byos-backup/kms_aws.go` | Implemented `AWSKMSKeyProvider` wrapping/unwrapping 256-bit DEKs via AWS KMS without persisting plaintext keys. |
| `tools/byos-backup/kms_aws_test.go` | Added unit tests for `AWSKMSKeyProvider` generation, `v1`->`v2` rotation, historical unwrap, zero plaintext persistence, and fail-closed revocation. |
| `tools/byos-backup/s3_storage.go` | Added `BYOS_BACKUP_REMOTE_OBJECT_LOCK_MODE`, `BYOS_BACKUP_REMOTE_OBJECT_LOCK_DAYS`, `BYOS_BACKUP_REMOTE_MAX_RETRIES`, and `BYOS_BACKUP_REMOTE_TIMEOUT`. |
| `tools/byos-backup/remote_cli.go`, `main.go` | Wired `AWSKMSKeyProvider` into `archive-wal`, `restore-wal`, and remote CLI commands; added `kms-rotate`. |
| `.env.example` | Documented non-secret `BYOS_BACKUP_REMOTE_OBJECT_LOCK_*`, `BYOS_BACKUP_KMS_*`, and timeout/retry placeholders. |
| `docs/c69_offsite_provider_decision.md` | Updated cost estimate to include KMS rotations (`$1–$3/mo`), retained object-version storage (`1.25x`), and recovery-host compute/EBS (`~$0.18/mo` on-demand vs `~$17.58/mo` warm standby). |
| `docs/c691_aws_provisioning_and_setup.md` | Documented exact AWS S3 + Object Lock Governance bucket, KMS CMK, 4 least-privilege STS IAM roles, and pre-provisioning confirmations. |
| `tests/disaster_recovery_live_offsite_c691.ps1` | Prepared Stage C live AWS S3 + KMS drill script (fails closed when live AWS env vars are unset). |
| `docs/live_offsite_provider_integration_and_host_loss_recovery_c6_9_1_report.md` | C6.9.1 Stage C preparation and readiness status report. |

---

## 3. Verification Results (Pre-Provisioning)
1. **`tools/byos-backup` Unit Tests, `go vet`, and Windows/Linux Builds:**
   Command: `cd tools/byos-backup; go test -count=1 -v ./... ; go vet ./... ; go build` (Exit Code: `0`, `ok byos-backup 0.892s`; 6 `TEST_DATABASE_URL` integration tests skipped).
2. **Live Drill Fail-Closed Gate:**
   `tests/disaster_recovery_live_offsite_c691.ps1` exited with code `2` (`BLOCKED: Required live AWS environment variable 'BYOS_BACKUP_REMOTE_ENDPOINT' is not set`).
3. **Untested Items Pending Account Owner Provisioning:**
   - Live AWS S3 Object Lock Governance test: **UNTESTED**.
   - Live AWS KMS `GenerateDataKey` / `Decrypt` & STS AssumeRole: **UNTESTED**.
   - Separate-host physical PITR & full-stack BYOS recovery RTO/RPO: **UNTESTED**.
   - Production backup migration & `BYOS_BACKUP_REMOTE_REQUIRED=true` activation: **UNTESTED** (requires separate approval).

---

## 4. Final Verdict (Stage C Preparation)
```text
FAIL (PRE-PROVISIONING GATE): Live AWS S3 provider, independent AWS KMS retrieval, and separate-host recovery remain UNTESTED pending account owner provisioning and authorization. Local unit tests and cross-compiled binaries are ready for Stage C execution.
```
