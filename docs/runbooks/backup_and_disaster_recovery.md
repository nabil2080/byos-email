# Operational Runbook: Backup, Continuous Archiving, and Point-In-Time Recovery (PITR)

## 1. Overview
This runbook defines backup procedures, pre-egress authenticated encryption, continuous WAL archiving, Point-In-Time Recovery (PITR), retention lifecycle policies, disaster recovery verification, and Recovery Point Objective (RPO) / Recovery Time Objective (RTO) targets for the BYOS platform.

---

## 2. Recovery Objectives and Operational Status

### Operational Capability (Release C6.8 & C6.8.1)
- **Continuous WAL Archiving:** Fully integrated into running PostgreSQL deployments. PostgreSQL operates with `wal_level = replica`, `archive_mode = on`, and continuous `archive_command` executing `byos-backup archive-wal`.
- **Pre-Egress Encryption:** All WAL segments and base backups are encrypted using **AES-256-GCM** with authenticated headers (`BYOSENC1` / `BYOS_WAL_V1`) prior to landing on disk or remote storage.
- **Physical Point-In-Time Recovery (PITR):** Implemented via `byos-backup prepare-pitr` and on-the-fly decryption with `byos-backup restore-wal`. Verified across target timestamp replay, latest state recovery, timeline branching (Timeline 2), interrupted recovery resumption, and fail-closed corrupt/tampered segment rejection. See dedicated runbook: [`docs/runbooks/physical_pitr_recovery.md`](file:///f:/Codex/byos-email/docs/runbooks/physical_pitr_recovery.md).
- **WAL Dependency Retention:** Automated pruning preserves all WAL segments $\ge \text{StartWAL}$ of the oldest retained base backup, ensuring zero orphaned base backups.
- **Multi-Version KMS Integration:** Keys are managed via `KeyProvider` interface supporting rotation (`v1` to `v2`), historical epoch preservation, and cloud KMS backends.

### Recovery Target Definitions
- **Recovery Point Objective (RPO):**
  - Continuous Archiving Target: **< 5 minutes** (bounded by `archive_timeout = 300` or WAL segment closure).
  - Empirical Measurements across Traffic Profiles (C6.8.1 Benchmark):
    - **Idle Database:** Bounded by `archive_timeout` (300s default; verified under explicit switch at 30.69s).
    - **Low Traffic:** **0.613 seconds** average archiver lag upon segment switch.
    - **High Traffic / Burst Load:** **0.616 seconds** peak backlog lag, sustained archiver throughput of **49.81 MB/s** (48 MB across 3 segments drained in 616 ms).
    - **Storage Outage & Recovery:** During a 4.24s destination outage, all transactions were spooled safely to local `pg_wal` (zero data lost), and drained completely within **1.154 seconds** of restoration.
- **Recovery Time Objective (RTO):**
  - Target: **< 30 minutes** for complete cold-host recovery.
  - **Pure Physical PostgreSQL PITR RTO (C6.8.1 & C6.8.2):** **5.503 - 7.507 seconds** for physical base backup unpack, continuous encrypted WAL replay to exact target timestamp, timeline promotion to Timeline 2, and database readiness.
  - **Full-Stack Physical Disaster Recovery RTO (C6.8.2 Drill):** **39.013 seconds** for complete multi-tier cold recovery (PostgreSQL PITR + Redis dependency + `byos-api` startup + healthcheck stabilization HTTP 200 + application entity queries).
  - **Full-Stack Logical Cold RTO (C6.8 Drill):** **15.426 seconds** for complete cold recovery using logical backup bundle restoration (`database.dump` + `globals.sql`).

---

## 3. Cryptographic Invariants & Key Management (KMS)

All backup and WAL artifacts must undergo authenticated **AES-256-GCM** encryption before leaving host memory boundaries.

### Cryptographic Invariants
1. **Cipher:** AES-256-GCM with 96-bit (12-byte) cryptographically secure random nonce and 128-bit (16-byte) authentication tag.
2. **Magic Headers & AAD:**
   - Database Bundles: Header `BYOSENC1` (8 bytes); Authenticated Additional Data `BYOS_BACKUP_V1`.
   - WAL Segments: Header `BYOSENC1` (8 bytes); Authenticated Additional Data `BYOS_WAL_V1:<wal_name>:<key_version>`.
3. **Fail-Closed Authentication:** Any ciphertext tampering, bit flip, or invalid key immediately triggers an authentication error and produces zero plaintext output.
4. **Key Isolation Enforcement:** Encryption keys MUST NEVER reside within the backup or archive target directories. Key files must be mode `0600` owned by the operational service user.
5. **Key Rotation & Multi-Epoch Decryption:** The KMS provider supports multiple key versions (`v1`, `v2`, ...). Archived WAL segments record their encryption key version in `.meta.json` sidecars; `restore-wal` resolves the appropriate epoch key automatically during replay.
   - **Active Key Configuration:** Set `BYOS_BACKUP_ENCRYPTION_KEY` and `BYOS_BACKUP_KEY_VERSION` (e.g. `v2`).
   - **Historical Key Configuration:** Set `BYOS_BACKUP_KEY_<VERSION>` (e.g. `BYOS_BACKUP_KEY_V1=<hex>`).
   - **Key Retirement vs Revocation:** Retired keys remain available for historical archive decryption. Revoked keys are forbidden from performing decryption and immediately fail closed.

### Key Management System (KMS) Provider Architecture
The `byos-backup` CLI implements a pluggable `KeyProvider` interface:
```go
type KeyProvider interface {
    Name() string
    GetActiveKey(ctx context.Context) (KeyVersion, error)
    GetKeyVersion(ctx context.Context, versionID string) (KeyVersion, error)
    ListKeyVersions(ctx context.Context) ([]KeyVersion, error)
    RotateKey(ctx context.Context) (KeyVersion, error)
    RetireKey(ctx context.Context, versionID string) error
    RevokeKey(ctx context.Context, versionID string) error
}
```

#### Production KMS Integration Guide
- **Local / Environment Provider (`EnvKeyProvider`):** Reads keys from `BYOS_BACKUP_ENCRYPTION_KEY` and versioned environment variables `BYOS_BACKUP_KEY_V*`.
- **AWS KMS / Envelope Encryption:**
  - Active key ID stored in `BYOS_KMS_KEY_ARN`.
  - Data encryption keys (DEKs) generated via `kms:GenerateDataKey` with `AES_256`.
  - Encrypted DEK stored in the archive bundle metadata sidecar.
- **GCP Cloud KMS:**
  - Key ring and crypto key configured via `BYOS_GCP_KMS_KEY`.
  - Key rotation scheduled natively; historical versions queried via `projects/{p}/locations/{l}/keyRings/{r}/cryptoKeys/{k}/cryptoKeyVersions/{v}`.
- **HashiCorp Vault Transit Engine:**
  - Configured via `VAULT_ADDR` and `VAULT_TOKEN`.
  - Transit mount `transit/keys/byos-backup` handles key rotation and multi-version decryption.

---

## 4. Continuous WAL Archiving Configuration

PostgreSQL continuously archives completed 16MB WAL segments by delegating to the `byos-backup` CLI.

### PostgreSQL Configuration (`postgresql.conf`)
```ini
wal_level = replica
archive_mode = on
archive_command = '/usr/local/bin/byos-backup archive-wal --source-path %p --wal-name %f --archive-dir /var/byos/archive --key-file /etc/byos/keys/backup.key'
archive_timeout = 300
```

### Invariants Enforced by `archive-wal`:
- **Idempotency:** Re-archiving an identical WAL segment returns exit code 0 without re-writing or corrupting existing storage.
- **Conflicting Duplicate Detection:** If a WAL segment with identical name but different plaintext hash is submitted, archiving fails immediately (`ErrConflictingWALAlreadyExists`) with non-zero exit code to alert operators to split-brain or timeline divergence.
- **Atomic Persistence:** Segments are encrypted to temporary files, fsynced to persistent media, and atomically renamed.

---

## 5. Physical Base Backup & Manifest v2

Base backups capture the live PostgreSQL cluster filesystem while streaming WAL changes.

### Automated Base Backup Execution
```bash
byos-backup base-backup \
  --db-url "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable" \
  --dest-dir "/var/byos/archive/base" \
  --key-file "/etc/byos/keys/backup.key"
```

### Manifest v2 Schema (`manifest.json`)
Every base backup produces an authenticated manifest recording:
- `manifest_version`: 2
- `system_id`: PostgreSQL cluster identifier
- `start_lsn` & `start_wal`: The WAL segment where backup began
- `stop_lsn` & `stop_wal`: The WAL segment where backup ended
- `required_wal_segments`: Explicit array of all WAL segments required for consistency
- `sha256_checksum`: Cryptographic checksum of the base backup tar payload
- `key_version`: KMS encryption epoch

---

## 6. Point-in-Time Recovery (PITR) Workflow

To recover a database to an exact timestamp or the latest available state following hardware loss, disaster, or operator error:

### Step 1: Base Backup Extraction
Select the newest base backup whose `start_time` is prior to the recovery target:
```bash
mkdir -p /var/lib/postgresql/data
chmod 700 /var/lib/postgresql/data
tar -xf /var/byos/archive/base/basebackup_<timestamp>.tar -C /var/lib/postgresql/data
```

### Step 2: Configure PITR Parameters
Run `prepare-pitr` to write `recovery.signal` and configure `postgresql.auto.conf`:

**Target Timestamp Recovery (Scenario A):**
```bash
byos-backup prepare-pitr \
  --target-dir "/var/lib/postgresql/data" \
  --restore-cmd "/usr/local/bin/byos-backup restore-wal --archive-dir /var/byos/archive --key-file /etc/byos/keys/backup.key --wal-name %f --target-path %p" \
  --target-time "2026-11-24 13:29:05 UTC" \
  --target-action "promote"
```

**Latest State Recovery (Scenario B):**
```bash
byos-backup prepare-pitr \
  --target-dir "/var/lib/postgresql/data" \
  --restore-cmd "/usr/local/bin/byos-backup restore-wal --archive-dir /var/byos/archive --key-file /etc/byos/keys/backup.key --wal-name %f --target-path %p" \
  --target-action "promote"
```

### Step 3: Start PostgreSQL & Monitor Recovery
Start PostgreSQL. PostgreSQL reads `recovery.signal`, begins archive recovery, calls `restore_command` to retrieve and decrypt encrypted WAL files on the fly, applies redo records, and stops at the target timestamp:
```bash
docker start byos-postgres
docker logs -f byos-postgres
```

Expected log events:
1. `LOG: starting point-in-time recovery to <target_time>`
2. `LOG: restored log file "<wal_name>" from archive`
3. `LOG: recovery stopping before commit of transaction <xid>, time <tx_time>`
4. `LOG: selected new timeline ID: 2`
5. `LOG: archive recovery complete`
6. `LOG: database system is ready to accept connections`

---

## 7. Retention Policy with WAL Dependency Preservation

Pruning backup storage must NEVER delete WAL files required by any active or retained base backup.

### Automated Retention Evaluation
```bash
byos-backup prune \
  --backup-dir "/var/byos/archive" \
  --daily-days 7 \
  --weekly-weeks 4 \
  --monthly-months 12
```

### Dependency Preservation Rules:
1. **Oldest Retained Horizon:** The retention engine computes the oldest retained base backup and identifies its `start_wal`.
2. **Strict WAL Shielding:** No WAL segment with sequence index $\ge \text{start\_wal}$ is ever deleted, regardless of timestamp.
3. **Timeline History Protection:** All timeline transition history files (`.history`) are unconditionally preserved.
4. **Lone Surviving Backup Rule:** If only 1 base backup exists, it and all its dependent WAL files are unconditionally retained.

---

## 8. Recovery Observability & Operator Monitoring CLI

Operators can monitor archive continuity and cluster disaster recovery health:

### 1. Check WAL Continuity & Gap Detection
```bash
byos-backup wal-status --archive-dir /var/byos/archive
```
Output reports total segments, archive disk usage, oldest/newest WAL timestamps, archive lag, and continuous sequence verification (`CONTINUOUS (No gaps detected)`).

### 2. Check Overall Disaster Recovery Health & Estimated RPO
```bash
byos-backup recovery-status --archive-dir /var/byos/archive --key-file /etc/byos/keys/backup.key
```
Output reports base backup counts, estimated RPO (time since newest archived WAL), recoverable time range, active key versions, and alerts on missing base backups or archive gaps.

---

## 10. Storage Durability Classification & Production Off-Site Replication

### Storage Durability Classification (C6.8.2 Evidence Closure)
In local and staging environments, independent storage is verified using separate Docker volume mounts or bind mounts on the same host:
- `SAME_HOST_INDEPENDENT_STORAGE: PASS`
- `LIVE_OFFSITE_RECOVERY: NOT TESTED`

> [!WARNING]
> Same-host volume isolation proves process isolation, user/privilege separation, and container-level failure independence. It does **NOT** prove survival of physical disk failure, server chassis destruction, or datacenter loss. Production deployments require physical off-site replication.

### Procedure for Configuring True Off-Site Replication
To protect against complete host or datacenter loss:

1. **S3-Compatible Object Store Replication:**
   Run an asynchronous continuous synchronization daemon alongside the PostgreSQL archive:
   ```bash
   aws s3 sync /var/byos/archive/ s3://${BYOS_BACKUP_S3_BUCKET}/archive/ \
     --sse AES256 \
     --delete
   ```
2. **Dedicated Cloud Storage Replication Daemon:**
   Configure systemd or a sidecar container to monitor `/var/byos/archive/wal` for closed segments and replicate to GCP Cloud Storage (`gsutil rsync`) or Azure Blob Storage (`azcopy sync`).
3. **Immutability & Object Lock:**
   Enable S3 Object Lock (WORM compliance) on the off-site bucket in Governance or Compliance mode to defend against ransomware, accidental deletion, or compromised operator credentials.

### Production KMS Integration Requirements vs. Local Rotation
- **Local Key Rotation (`LOCAL_KEY_ROTATION: PASS`):**
  Uses `EnvKeyProvider` with multi-version environment variables (`BYOS_BACKUP_ENCRYPTION_KEY`, `BYOS_BACKUP_KEY_V1`, `BYOS_BACKUP_KEY_V2`). Suitable for development, staging, and single-host airgapped deployments.
- **Production Cloud KMS (`LIVE_KMS_INTEGRATION: NOT TESTED`):**
  Production deployment requires integrating with a cloud HSM or KMS:
  1. **AWS KMS:** IAM role with `kms:GenerateDataKey` and `kms:Decrypt` permissions on `arn:aws:kms:region:account:key/byos-backup`.
  2. **GCP Cloud KMS:** Service account with `cloudkms.cryptoKeyVersions.useToEncrypt` and `cloudkms.cryptoKeyVersions.useToDecrypt`.
  3. **HashiCorp Vault:** AppRole or Kubernetes service account authenticated to Vault Transit Secrets Engine.


Full-stack cold disaster recovery was tested end-to-end (`tests/disaster_recovery_drill.ps1`) under simulated host loss conditions.

| Stage | Operation | Elapsed (ms) | Elapsed (s) |
|---|---|---|---|
| **Stage 1** | Infrastructure Provisioning (PostgreSQL & Redis isolated containers) | 4,132.89 ms | 4.133 s |
| **Stage 2** | Encrypted Backup Bundle Retrieval | 10.28 ms | 0.010 s |
| **Stage 3** | Decryption & Cryptographic Verification (AES-256-GCM) | 37.86 ms | 0.038 s |
| **Stage 4** | Database Restoration (Globals + Schema + Data) | 4,236.93 ms | 4.237 s |
| **Stage 5** | Schema Migration & RBAC Integrity Check (v075 + least privilege) | 392.57 ms | 0.393 s |
| **Stage 6** | Application Service Startup (`byos-api`) | 21.06 ms | 0.021 s |
| **Stage 7** | Healthcheck Stabilization (`/health` HTTP 200) | 6,390.42 ms | 6.390 s |
| **Stage 8** | Data Query & Zero Data Loss Validation | 204.42 ms | 0.204 s |
| **Total** | **TOTAL RECOVERY TIME OBJECTIVE (RTO)** | **15,426.43 ms** | **15.426 s** |

**RTO Performance:** Full operational restoration achieved in **15.43 seconds** (well within the < 30 minute SLA).
**RPO Performance:** Continuous WAL archiving achieves **< 5 minutes** (bounded by `archive_timeout = 300` or segment switch).

---

## 11. C6.9 Remote S3-Compatible Off-Site Replication
- Dual-destination WAL replication (`BYOS_BACKUP_REMOTE_ENABLED`, `BYOS_BACKUP_REMOTE_REQUIRED`) and machine-readable remote recovery catalog (`catalog/recovery_catalog.json`) are implemented in `tools/byos-backup/` (`S3Storage`, `DualStorage`, `catalog.go`).
- Remote storage remains opt-in and disabled by default (`BYOS_BACKUP_REMOTE_ENABLED=false`, `BYOS_BACKUP_REMOTE_REQUIRED=false`) until an approved off-site provider is provisioned.
- See [`docs/runbooks/offsite_disaster_recovery.md`](file:///f:/Codex/byos-email/docs/runbooks/offsite_disaster_recovery.md) and [`docs/c69_offsite_provider_decision.md`](file:///f:/Codex/byos-email/docs/c69_offsite_provider_decision.md).
