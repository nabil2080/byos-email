# C6.9.1 AWS S3 + AWS KMS Provisioning & Security Specification

**Status:** `PREPARED_AWAITING_ACCOUNT_OWNER_PROVISIONING`  
**Important:** Do not provision paid resources, configure live credentials, or transfer existing BYOS backups until the account owner confirms the items below.

---

## 1. Pre-Provisioning Confirmations Required from Account Owner
1. **BYOS Hosting Region Confirmation:** Confirm the physical/cloud region where the production BYOS application host runs so the AWS S3 + KMS region can be selected in a **genuinely separate geographic failure domain** (e.g., if BYOS runs in Asia/EU, use `us-east-1` or `eu-west-1`; if BYOS runs in `us-east-1`, use `us-west-2` or `eu-central-1`).
2. **Object Lock Governance Retention Period Confirmation:**
   - **Stage C Synthetic-Test Bucket:** Recommend **`1 day`** (or `7 days`) Governance retention so synthetic test objects are protected by real S3 Object Lock Governance mode during testing without locking test data for months.
   - **Production Bucket (Future Stage D):** Recommend **`30 days`** (daily/WAL) to **`365 days`** (monthly tier) aligned with C6.7 retention policy.

---

## 2. Exact AWS Resources Required for Stage C (Synthetic Integration)
1. **S3 Bucket:** `byos-c691-synthetic-dr-<unique-suffix>`
   - Created with `--object-lock-enabled-for-bucket` (required at creation time).
   - Bucket Versioning: `Enabled`.
   - Default Bucket Encryption: `SSE-S3` (`AES256`) or `SSE-KMS` (defense-in-depth beneath BYOS `BYOSENC1` AES-256-GCM).
   - Default Object Lock: `GOVERNANCE` mode, `1` day (or confirmed retention period).
   - Public Access Block: All 4 settings `true` (strictly private).
2. **AWS KMS Customer Managed Key (CMK):**
   - Alias: `alias/byos-c691-synthetic-backup`
   - Key Spec: `SYMMETRIC_DEFAULT` (`AES_256`), `ENCRYPT_DECRYPT`, in the same AWS region as the S3 bucket.
3. **Separate Recovery Compute Host (Distinct Failure Domain):**
   - A separate EC2 instance (e.g., `t3.small`, Amazon Linux / Ubuntu / Docker) or separate physical host with **zero** network/volume access to the primary BYOS host, attached to the `byos-c691-recovery-reader` IAM Instance Profile.

---

## 3. Least-Privilege IAM Roles & Temporary Credentials (STS)
Use **IAM Roles + STS temporary credentials** (EC2 Instance Profile / EKS IRSA / `aws sts assume-role`), **not** permanent IAM user access keys.

### Role A: `byos-c691-wal-writer` (Source PostgreSQL Archiver)
- Allowed S3: `s3:PutObject`, `s3:PutObjectRetention`, `s3:GetObject`, `s3:ListBucket` on `arn:aws:s3:::<bucket>/c691-synth/wal/*` and `keys/*` (no `s3:DeleteObject`, no `s3:BypassGovernanceRetention`, no `s3:PutBucketPolicy`).
- Allowed KMS: `kms:GenerateDataKey`, `kms:Decrypt` on `<CMK-ARN>` with condition `kms:EncryptionContextKeys = ["byos_key_version", "byos_purpose"]`.

### Role B: `byos-c691-backup-writer` (Base Backup & Catalog Publisher)
- Allowed S3: `s3:PutObject`, `s3:PutObjectRetention`, `s3:GetObject`, `s3:ListBucket`, `s3:AbortMultipartUpload` on `arn:aws:s3:::<bucket>/c691-synth/*` (plus `s3:DeleteObject` scoped **only** to `c691-synth/catalog/recovery_catalog.json` if overwriting mutable catalog, or use versioned puts without delete).

### Role C: `byos-c691-recovery-reader` (Isolated Recovery Host)
- Allowed S3: `s3:GetObject`, `s3:ListBucket` (strictly read-only; **zero** write or delete permissions).
- Allowed KMS: `kms:Decrypt` on `<CMK-ARN>`.

### Role D: `byos-c691-retention-admin` (Isolated Pruning Admin Only)
- Allowed S3: `s3:ListBucket`, `s3:GetObject`, `s3:DeleteObject`, `s3:DeleteObjectVersion`, `s3:BypassGovernanceRetention` (invoked only manually via `byos-backup remote-prune --confirm-delete`).

---

## 4. Secure Environment Configuration (No Hardcoded Secrets)
On the authorized host using STS / Instance Profile:
```bash
export BYOS_BACKUP_REMOTE_ENABLED=true
export BYOS_BACKUP_REMOTE_REQUIRED=true
export BYOS_BACKUP_REMOTE_ENDPOINT=https://s3.<region>.amazonaws.com
export BYOS_BACKUP_REMOTE_REGION=<region>
export BYOS_BACKUP_REMOTE_BUCKET=<bucket-name>
export BYOS_BACKUP_REMOTE_PREFIX=c691-synth
export BYOS_BACKUP_REMOTE_PATH_STYLE=false
export BYOS_BACKUP_REMOTE_OBJECT_LOCK_MODE=GOVERNANCE
export BYOS_BACKUP_REMOTE_OBJECT_LOCK_DAYS=1
export BYOS_BACKUP_KMS_PROVIDER=aws
export BYOS_BACKUP_KMS_KEY_ID=<cmk-arn>
export BYOS_BACKUP_KMS_REGION=<region>
```
If temporary STS credentials are assumed manually into environment (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`), never write them to `.env.example`, Compose YAML, or logs.
