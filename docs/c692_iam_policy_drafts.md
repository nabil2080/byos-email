# BYOS C6.9.2A: Draft Least-Privilege IAM Policies for Account-Owner Review

**Status:** **DRAFT REVIEW ARTIFACT ONLY — DO NOT APPLY TO AWS WITHOUT ACCOUNT-OWNER REVIEW**  
**Scope:** Synthetic AWS S3 + AWS KMS validation for Release C6.9.2 (Phases B–E).  
**Credential Model:** Temporary STS credentials (`sts:AssumeRole` / EC2 Instance Profile / IRSA). Long-lived IAM user access keys are prohibited.

---

## 1. Placeholders Used Across All Draft Policies

Replace every placeholder below with the account-owner-approved value before creating policies in AWS:

| Placeholder | Meaning |
|---|---|
| `<ACCOUNT_ID>` | 12-digit AWS account ID |
| `<AWS_REGION>` | Account-owner-selected AWS region (same region for S3 bucket and KMS CMK) |
| `<BACKUP_BUCKET_NAME>` | Dedicated synthetic-test S3 bucket name (Versioning + Object Lock Governance enabled) |
| `<REMOTE_PREFIX>` | Object key prefix (matches `BYOS_BACKUP_REMOTE_PREFIX`, e.g., `c692-synth`) |
| `<KMS_KEY_ID>` | AWS KMS Customer Managed Key UUID (from CMK ARN) |
| `<BACKUP_WRITER_PRINCIPAL_ARN>` | Trusted workload/role/admin ARN permitted to assume `BackupWriterRole` |
| `<WAL_ARCHIVER_PRINCIPAL_ARN>` | Trusted workload/role/admin ARN permitted to assume `WALArchiverRole` |
| `<RECOVERY_HOST_PRINCIPAL_ARN>` | Trusted recovery-host EC2/IAM principal permitted to assume `RecoveryReaderRole` |
| `<KEY_ADMIN_PRINCIPAL_ARN>` | Trusted security/key-admin principal permitted to assume `KeyAdminRotationRole` |
| `<EXTERNAL_ID>` | Optional STS ExternalId if assuming roles across accounts or automation boundaries |

---

## 2. Standard STS Trust Policy Template

Each of the four roles uses a scoped trust policy permitting only the designated workload or identity to obtain temporary STS credentials:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowTrustedWorkloadAssumeRole",
      "Effect": "Allow",
      "Principal": {
        "AWS": "<WORKLOAD_PRINCIPAL_ARN>"
      },
      "Action": "sts:AssumeRole",
      "Condition": {
        "StringEquals": {
          "sts:ExternalId": "<EXTERNAL_ID>"
        }
      }
    }
  ]
}
```

- **For an EC2 Instance Profile (recommended for `RecoveryReaderRole` on the independent recovery host):** Replace `"Principal": { "AWS": "<WORKLOAD_PRINCIPAL_ARN>" }` with `"Principal": { "Service": "ec2.amazonaws.com" }` and remove the `sts:ExternalId` condition.

---

## 3. Role 1: `BackupWriterRole`

**Workload:** Authorized backup publisher running `byos-backup recovery-catalog --action publish`, `remote-sync`, `remote-status`, and `remote-verify`.

### Draft Permissions Policy

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowBucketListScopedToPrefixForBackup",
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket"
      ],
      "Resource": "arn:aws:s3:::<BACKUP_BUCKET_NAME>",
      "Condition": {
        "StringLike": {
          "s3:prefix": [
            "<REMOTE_PREFIX>/*",
            "<REMOTE_PREFIX>"
          ]
        }
      }
    },
    {
      "Sid": "AllowPutAndVerifyBackupsAndWALDependencies",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:PutObjectRetention",
        "s3:GetObject",
        "s3:AbortMultipartUpload"
      ],
      "Resource": [
        "arn:aws:s3:::<BACKUP_BUCKET_NAME>/<REMOTE_PREFIX>/backups/*",
        "arn:aws:s3:::<BACKUP_BUCKET_NAME>/<REMOTE_PREFIX>/wal/*"
      ]
    },
    {
      "Sid": "AllowReadAndUpdateCatalog",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject"
      ],
      "Resource": "arn:aws:s3:::<BACKUP_BUCKET_NAME>/<REMOTE_PREFIX>/catalog/recovery_catalog.json"
    },
    {
      "Sid": "AllowReadKeyEnvelopes",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject"
      ],
      "Resource": "arn:aws:s3:::<BACKUP_BUCKET_NAME>/<REMOTE_PREFIX>/keys/key_envelopes.json"
    },
    {
      "Sid": "AllowKMSDecryptForBackupVerification",
      "Effect": "Allow",
      "Action": [
        "kms:Decrypt"
      ],
      "Resource": "arn:aws:kms:<AWS_REGION>:<ACCOUNT_ID>:key/<KMS_KEY_ID>",
      "Condition": {
        "StringEquals": {
          "kms:EncryptionContext:byos_purpose": "byos_backup"
        },
        "ForAllValues:StringEquals": {
          "kms:EncryptionContextKeys": [
            "byos_key_version",
            "byos_purpose"
          ]
        }
      }
    }
  ]
}
```

### Permission Rationale & Omissions
- `s3:ListBucket` on bucket ARN with `s3:prefix` condition: Required by `S3Storage.CheckConnectivity` (prefix-scoped `ListObjects` with `MaxKeys=1`), `S3Storage.List`, and `StatObject` 404 distinction. (If `<REMOTE_PREFIX>` is empty, omit the `s3:prefix` condition.)
- `s3:PutObject` + `s3:PutObjectRetention` on `backups/*` and `wal/*`: Required by `S3Storage.Put` / `PutFile` (`applyObjectLockOptions` attaches `GOVERNANCE` retention headers to `backups/` and `wal/` objects).
- `s3:AbortMultipartUpload` on `backups/*` and `wal/*`: Required by `RemoveIncompleteUpload` on failed 16 MiB multipart uploads.
- `s3:GetObject` on `backups/*`, `wal/*`, `catalog/recovery_catalog.json`, and `keys/key_envelopes.json`: Required by `verifyExistingOrConflict`, `StatObject` post-upload verification, `VerifyRemoteRecoveryPoint`, `LoadRemoteCatalogWithETag`, and AWS S3 `If-Match` conditional writes (AWS S3 requires `s3:GetObject` + `s3:PutObject` for `If-Match` CAS updates on `catalog/recovery_catalog.json`).
- `s3:PutObject` on `catalog/recovery_catalog.json`: Required by `SaveRemoteCatalogCAS` (`tools/byos-backup/catalog.go`) using `PutIfMatch` (`If-None-Match: *` on creation, `If-Match: "<etag>"` on update) directly without creating a delete marker first.
- **Intentionally omitted / denied:** Zero `s3:DeleteObject` permissions anywhere, no `s3:BypassGovernanceRetention`, no `s3:DeleteObjectVersion`, no `kms:GenerateDataKey`, and no KMS key administration actions.
- **C6.9.2E CAS Audit Note:** `s3:GetObject` on `catalog/recovery_catalog.json` is scoped solely to the catalog manifest ARN; `wal/*` and `backups/*` `s3:GetObject` is already required for dependency verification and `verifyExistingOrConflict`, and no wildcard object permissions are granted.

---

## 4. Role 2: `WALArchiverRole`

**Workload:** Source PostgreSQL `archive_command` invoking `byos-backup archive-wal`.

### Draft Permissions Policy

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowBucketListScopedToPrefixForWALArchiver",
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket"
      ],
      "Resource": "arn:aws:s3:::<BACKUP_BUCKET_NAME>",
      "Condition": {
        "StringLike": {
          "s3:prefix": [
            "<REMOTE_PREFIX>/wal/*",
            "<REMOTE_PREFIX>/"
          ]
        }
      }
    },
    {
      "Sid": "AllowPutAndStatWALObjects",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:PutObjectRetention",
        "s3:GetObject",
        "s3:AbortMultipartUpload"
      ],
      "Resource": "arn:aws:s3:::<BACKUP_BUCKET_NAME>/<REMOTE_PREFIX>/wal/*"
    },
    {
      "Sid": "AllowReadKeyEnvelopes",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject"
      ],
      "Resource": "arn:aws:s3:::<BACKUP_BUCKET_NAME>/<REMOTE_PREFIX>/keys/key_envelopes.json"
    },
    {
      "Sid": "AllowKMSDecryptActiveDEK",
      "Effect": "Allow",
      "Action": [
        "kms:Decrypt"
      ],
      "Resource": "arn:aws:kms:<AWS_REGION>:<ACCOUNT_ID>:key/<KMS_KEY_ID>",
      "Condition": {
        "StringEquals": {
          "kms:EncryptionContext:byos_purpose": "byos_backup"
        },
        "ForAllValues:StringEquals": {
          "kms:EncryptionContextKeys": [
            "byos_key_version",
            "byos_purpose"
          ]
        }
      }
    }
  ]
}
```

### Permission Rationale & Omissions
- `s3:PutObject`, `s3:PutObjectRetention`, `s3:GetObject`, `s3:AbortMultipartUpload` on `wal/*`: Required by `ArchiveWALSegment` -> `S3Storage.Put` (checks idempotency via `StatObject` / `GetObject`, writes `.enc` and `.meta.json` with Object Lock retention headers, and verifies post-upload).
- `s3:GetObject` on `keys/key_envelopes.json` + `kms:Decrypt`: Required by `main.go` (`archive-wal`) calling `awsKMS.GetActiveKey` to unwrap the active DEK envelope.
- **Intentionally omitted / denied:** No `kms:GenerateDataKey` (WAL archiver never rotates or creates DEKs), no `s3:DeleteObject` anywhere, no `s3:BypassGovernanceRetention`, and no write access to `backups/*`, `catalog/*`, or `keys/*`.

---

## 5. Role 3: `RecoveryReaderRole`

**Workload:** Isolated independent recovery host running `byos-backup remote-verify`, `remote-list`, `remote-fetch`, `remote-recovery-check`, and `restore-wal --remote`.

### Draft Permissions Policy

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowBucketListScopedToPrefixReadOnly",
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket"
      ],
      "Resource": "arn:aws:s3:::<BACKUP_BUCKET_NAME>",
      "Condition": {
        "StringLike": {
          "s3:prefix": [
            "<REMOTE_PREFIX>/*",
            "<REMOTE_PREFIX>"
          ]
        }
      }
    },
    {
      "Sid": "AllowReadOnlyRecoveryObjects",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject"
      ],
      "Resource": [
        "arn:aws:s3:::<BACKUP_BUCKET_NAME>/<REMOTE_PREFIX>/backups/*",
        "arn:aws:s3:::<BACKUP_BUCKET_NAME>/<REMOTE_PREFIX>/wal/*",
        "arn:aws:s3:::<BACKUP_BUCKET_NAME>/<REMOTE_PREFIX>/catalog/recovery_catalog.json",
        "arn:aws:s3:::<BACKUP_BUCKET_NAME>/<REMOTE_PREFIX>/keys/key_envelopes.json"
      ]
    },
    {
      "Sid": "AllowKMSDecryptForRecovery",
      "Effect": "Allow",
      "Action": [
        "kms:Decrypt"
      ],
      "Resource": "arn:aws:kms:<AWS_REGION>:<ACCOUNT_ID>:key/<KMS_KEY_ID>",
      "Condition": {
        "StringEquals": {
          "kms:EncryptionContext:byos_purpose": "byos_backup"
        },
        "ForAllValues:StringEquals": {
          "kms:EncryptionContextKeys": [
            "byos_key_version",
            "byos_purpose"
          ]
        }
      }
    }
  ]
}
```

### Permission Rationale & Omissions
- Strictly read-only across `backups/*`, `wal/*`, `catalog/recovery_catalog.json`, and `keys/key_envelopes.json`.
- `kms:Decrypt` with exact `EncryptionContext` conditions allows unwrapping both active and historical (`retired`) DEK envelopes during PITR.
- **Intentionally omitted / denied:** Zero `s3:PutObject`, zero `s3:DeleteObject`, zero `s3:BypassGovernanceRetention`, zero `kms:GenerateDataKey`, and zero KMS administration permissions.

---

## 6. Role 4: `KeyAdminRotationRole`

**Workload:** Authorized security/key-rotation operator running `byos-backup kms-rotate` (and administering the dedicated KMS CMK).

### Draft Permissions Policy

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowBucketListScopedToPrefixForKeyEnvelopes",
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket"
      ],
      "Resource": "arn:aws:s3:::<BACKUP_BUCKET_NAME>",
      "Condition": {
        "StringLike": {
          "s3:prefix": [
            "<REMOTE_PREFIX>/keys/*",
            "<REMOTE_PREFIX>/"
          ]
        }
      }
    },
    {
      "Sid": "AllowManageKeyEnvelopeManifestOnly",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject"
      ],
      "Resource": "arn:aws:s3:::<BACKUP_BUCKET_NAME>/<REMOTE_PREFIX>/keys/key_envelopes.json"
    },
    {
      "Sid": "AllowKMSGenerateDataKeyForRotation",
      "Effect": "Allow",
      "Action": [
        "kms:GenerateDataKey"
      ],
      "Resource": "arn:aws:kms:<AWS_REGION>:<ACCOUNT_ID>:key/<KMS_KEY_ID>",
      "Condition": {
        "StringEquals": {
          "kms:EncryptionContext:byos_purpose": "byos_backup"
        },
        "ForAllValues:StringEquals": {
          "kms:EncryptionContextKeys": [
            "byos_key_version",
            "byos_purpose"
          ]
        }
      }
    },
    {
      "Sid": "AllowScopedCMKLifecycleInspection",
      "Effect": "Allow",
      "Action": [
        "kms:DescribeKey",
        "kms:GetKeyPolicy",
        "kms:GetKeyRotationStatus",
        "kms:ListResourceTags",
        "kms:EnableKeyRotation"
      ],
      "Resource": "arn:aws:kms:<AWS_REGION>:<ACCOUNT_ID>:key/<KMS_KEY_ID>"
    }
  ]
}
```

### Permission Rationale & Omissions
- `kms:GenerateDataKey` with exact `EncryptionContext`: Required by `AWSKMSKeyProvider.RotateKey` (`kms-rotate`) to generate a new 256-bit DEK (`v1`, `v2`, ...).
- `s3:GetObject` and `s3:PutObject` scoped **only** to `keys/key_envelopes.json`: Required by `AWSKMSKeyProvider.loadManifest` (`GetWithETag`) and `saveManifestLocked` (`tools/byos-backup/kms_aws.go`) using `PutIfMatch` (`If-None-Match: *` on creation, `If-Match: "<etag>"` on update) directly without creating a delete marker first. AWS S3 requires both `s3:GetObject` and `s3:PutObject` for `If-Match` conditional writes.
- **Intentionally omitted / denied:** Zero `s3:DeleteObject` permissions anywhere, no `kms:ScheduleKeyDeletion`, no `kms:DisableKey`, no `s3:BypassGovernanceRetention`, no access to `backups/*` or `wal/*`, and no wildcard `"Resource": "*"`. (If the account owner wishes to restrict CMK deletion even for IAM admins, enforce that in the KMS Key Policy.)
- **C6.9.2E CAS Audit Note:** `s3:GetObject` on `keys/key_envelopes.json` does **not** expose plaintext DEKs (only KMS-wrapped `CiphertextBlobB64` envelopes are stored), and `KeyAdminRotationRole` has no `kms:Decrypt` permission.

---

## 7. Unresolved Permission Questions (`NEEDS VERIFICATION`)

1. **Governance Retention & Version-Level Pruning (`remote-prune --confirm-delete`) (`NEEDS VERIFICATION`):**
   - `S3Storage.Delete` (`RemoveObject` without `VersionId`) only creates a **delete marker** on a versioned bucket; it does **not** permanently delete underlying object versions (`s3:DeleteObjectVersion`) and never sends `x-amz-bypass-governance-retention`.
   - None of the 4 routine roles (`BackupWriterRole`, `WALArchiverRole`, `RecoveryReaderRole`, `KeyAdminRotationRole`) grant `s3:BypassGovernanceRetention` or `s3:DeleteObjectVersion`.
   - If permanent version-level cleanup or early Governance-locked pruning is needed, the account owner must decide whether to rely on natural retention expiry + S3 Lifecycle noncurrent-version expiration or provision a separate break-glass retention-admin role outside the routine backup/recovery credential chain.
2. **KMS Key Policy Delegation (`NEEDS VERIFICATION`):**
   - **Key Policy delegation** (`Principal: { "AWS": "arn:aws:iam::<ACCOUNT_ID>:root" }` in the CMK Key Policy) enables IAM policies on the 4 roles to authorize `kms:GenerateDataKey` / `kms:Decrypt` and preserves account-level administrative recovery if an individual role is deleted.
   - Without account-root delegation (or explicit Key Policy grants to each principal), IAM policies alone will be denied by AWS KMS. Account owner must confirm the CMK Key Policy includes account-root delegation while restricting `kms:ScheduleKeyDeletion` / `kms:DisableKey`.

---

## 8. Account-Owner Review Checklist

- [ ] Replaced all `<ACCOUNT_ID>`, `<AWS_REGION>`, `<BACKUP_BUCKET_NAME>`, `<REMOTE_PREFIX>`, `<KMS_KEY_ID>`, and principal ARN placeholders.
- [ ] Confirmed temporary STS credentials (no permanent IAM user access keys).
- [ ] Confirmed `s3:BypassGovernanceRetention` is **not** granted to `BackupWriterRole`, `WALArchiverRole`, `RecoveryReaderRole`, or `KeyAdminRotationRole`.
- [ ] Confirmed `kms:ScheduleKeyDeletion` and `kms:DisableKey` are **not** granted in `KeyAdminRotationRole`.
- [ ] Confirmed KMS Key Policy allows IAM policy evaluation for the scoped CMK.
