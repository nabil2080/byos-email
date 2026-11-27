# C6.9 / C6.9.1 Off-Site Object Storage & KMS Provider Decision (Stage B Gate)

**Research Date:** 2026-11-25  
**Status:** `PENDING_OPERATOR_APPROVAL` (No external cloud resources provisioned; no credentials configured)

---

## 1. Object-Storage Provider Comparison

| Criterion | AWS S3 Standard (`us-east-1`) | Cloudflare R2 | Backblaze B2 |
|---|---|---|---|
| **API Compatibility (`minio-go/v7`)** | Native reference S3 API (virtual-hosted & path-style) | S3-compatible (some S3 headers/APIs omitted) | S3-compatible (path & virtual-hosted) |
| **Geographic Separation** | Multi-AZ & cross-region isolation (`us-east-1`, `eu-west-1`, etc.) | Distributed / regional jurisdiction buckets | Region-isolated datacenters (US-West, US-East, EU-Central) |
| **Versioning** | Full S3 Object Versioning | Supported | Supported |
| **Immutability / Object Lock** | Native S3 Object Lock (Governance & Compliance modes, `$0.00` feature fee) | **No** S3 Object Lock API (`x-amz-bucket-object-lock-enabled` unsupported); uses proprietary R2 Bucket Lock rules via Dashboard/Terraform | Native S3 Object Lock (Governance & Compliance modes, `$0.00` feature fee) |
| **Least-Privilege IAM** | Granular IAM policies per prefix & action (`PutObject`, `GetObject`, `DeleteObject`, `BypassGovernanceRetention`) | Scoped API tokens (bucket/prefix R/W) | Scoped Application Keys (per-bucket, capability-restricted) |
| **TLS & Transport** | Mandatory HTTPS (TLS 1.2/1.3) | Mandatory HTTPS | Mandatory HTTPS |
| **Multipart Upload** | Native S3 Multipart + `AbortMultipartUpload` | Native S3 Multipart | Native S3 Multipart |
| **Storage Pricing** | `$0.023 / GB-month` (first 50 TB) | `$0.015 / GB-month` (10 GB free tier) | `$0.00695 / GB-month` (`$6.95/TB-mo`, 10 GB free tier) |
| **Request Pricing** | PUT/COPY/POST/LIST: `$0.005 / 1,000`; GET/HEAD: `$0.0004 / 1,000` | Class A: `$4.50 / 1M`; Class B: `$0.36 / 1M` (1M A / 10M B free) | Class A/B/C transactions: `$0.00` (free on standard pay-as-you-go) |
| **Egress / Restore Pricing** | `$0.09 / GB` after 100 GB/month free tier | `$0.00 / GB` (free egress) | Free up to 3x average monthly storage; `$0.01 / GB` above 3x |

---

## 2. KMS Provider Comparison

| Criterion | AWS KMS (CMK) | Google Cloud KMS | HashiCorp Vault (HCP Dedicated / Self-Hosted) |
|---|---|---|---|
| **Key Versioning & History** | Native CMK rotation + envelope data keys (`GenerateDataKey` / `Decrypt` preserves all historical versions) | Native `CryptoKeyVersion` (`v1`, `v2`, ...) with historical decryption | Transit Secrets Engine (`v1`, `v2`, ...) with key min_decryption_version |
| **Authorization & Audit** | IAM key policies + CloudTrail immutable audit logs | IAM per-key-version + Cloud Audit Logs | Vault policies / AppRole / OIDC + Vault Audit Device |
| **Monthly Key Cost** | `$1.00 / CMK / month` (`+$1.00/mo` for 1st & 2nd rotation, capped) | `$0.06 / active software version / month` (HSM `~$1–$3+/mo`) | HCP Dedicated: `$0.62–$1.85+/hr` + `~$73/client/mo`; Self-hosted CE: free software + host cost |
| **API Request Cost** | First 20,000 req/mo free; `$0.03 / 10,000` requests | `$0.03 / 10,000` operations (Autokey: 10,000 free/mo) | Included in cluster/host capacity |
| **Compatibility with BYOS Format** | Envelope-encrypts 256-bit AES-GCM DEKs (`KeyProvider` wrapper) without breaking C6.8/C6.9 ciphertext | Envelope-encrypts 256-bit AES-GCM DEKs | Transit wraps/unwraps 256-bit DEKs |

---

## 3. Pricing Assumptions & Corrected Monthly Cost Estimate (Research Date: 2026-11-25)
- **Workload & Overhead Assumptions (50 GB Base + Versioning + Rotations + Recovery Compute):**
  - Current `byos` DB size: `25 MB` (compressed physical base backup `~40 MB`).
  - Assumed steady-state retained storage: `50 GB` across daily/weekly/monthly tiers, plus **`1.25x` retained object-version overhead** (`~62.5 GB` total billed S3 storage due to S3 Versioning + Object Lock Governance retention).
  - Monthly WAL + backup uploads: `~15,000` `PUT`/`LIST`/`PutObjectRetention` calls/month (`~500/day`).
  - Monthly verification reads: `~5,000` `GET`/`HEAD` calls/month.
  - KMS Key Lifecycle: 1 Customer Managed Key with annual/periodic rotations (AWS KMS charges `$1.00/mo` base + `$1.00/mo` for 1st rotation + `$1.00/mo` for 2nd rotation, capped at `$3.00/mo` after 2+ rotations).
  - Recovery-Host Compute (`t3.small` Linux in recovery region + `30 GB gp3` EBS):
    - *On-Demand DR Drill / Failover Only (4 hrs/month):* `4 hrs × $0.0208/hr ≈ $0.08` + ephemeral EBS `~$0.10` = **`~$0.18 / month`**.
    - *Always-On Warm Standby Recovery VM (730 hrs/month):* `~$15.18` EC2 + `$2.40` (`30 GB gp3`) = **`~$17.58 / month`**.
- **Corrected Estimated Monthly Cost:**
  - **AWS S3 + AWS KMS (On-Demand Recovery Compute — Recommended):**
    - S3 Storage (`62.5 GB` incl. retained versions × `$0.023`): `$1.44`
    - S3 Requests (15k PUT × `$0.005/1k` + 5k GET × `$0.0004/1k`): `$0.08`
    - AWS KMS (1 CMK with 2 rotations = `$3.00/mo` cap; <20k req/mo free): `$3.00`
    - On-Demand Recovery Compute (monthly 4-hr DR drill): `~$0.18`
    - DR Restore Egress (`<=100 GB/mo` AWS free tier; above 100 GB is `$0.09/GB`): `$0.00`
    - **Total (On-Demand Recovery Host):** **`~$4.70 / month`** (or **`~$22.10 / month`** if keeping a 24/7 warm-standby recovery VM; CloudTrail S3 data events optional extra).
  - **Backblaze B2 + AWS KMS Alternative (On-Demand Recovery Compute):**
    - B2 Storage (`52.5 GB` billable after 10 GB free × `$0.00695`): `$0.36` + Transactions `$0.00` + Egress `$0.00` (<=3× storage) + AWS KMS (`$1.00–$3.00`) + On-Demand Compute (`~$0.18`) = **`~$1.54 – $3.54 / month`**.

> **Hosting Region Confirmation Requirement:** The actual production BYOS hosting region must be confirmed by the operator before selecting the AWS S3 + KMS region (e.g., choose `us-east-1` or `eu-west-1` strictly separate from the primary host's region).

---

## 4. Architecture Recommendation
1. **Recommended Object-Storage Provider:** **AWS S3** (region independent from primary host, e.g., `us-east-1` or `eu-central-1`), with **Backblaze B2** as the cost-optimized secondary option.
   - *Rationale:* AWS S3 provides the reference S3 API for `minio-go/v7`, native S3 Object Lock (`COMPLIANCE` / `GOVERNANCE` mode) via API, granular IAM separation across all 4 required roles (`wal-writer`, `backup-writer`, `recovery-reader`, `retention-admin`), and native integration with AWS KMS.
2. **Recommended KMS Provider:** **AWS KMS** (Customer Managed Key with envelope encryption wrapping BYOS 256-bit AES-GCM DEKs).
   - *Rationale:* Preserves existing C6.8/C6.9 `BYOSENC1` ciphertext format while storing wrapped DEK versions independently of the application server, with CloudTrail audit logging and strict `kms:Decrypt` IAM separation for recovery hosts.
3. **S3 Adapter Compatibility:** `tools/byos-backup/s3_storage.go` (`minio-go/v7`) is already compatible with AWS S3 (`BYOS_BACKUP_REMOTE_PATH_STYLE=false`, `UseSSL=true`, `UserMetadata` `x-amz-meta-byos-sha256`, 16 MiB multipart streaming, `AbortMultipartUpload` on error).
4. **Access-Control & Immutability Model:**
   - Enable S3 Versioning + Object Lock (`GOVERNANCE` for synthetic testing, `COMPLIANCE` or `GOVERNANCE` for production).
   - Separate IAM users/roles: `wal-writer` (`PutObject`, `GetObject`/`ListBucket` without `DeleteObject`), `backup-writer`, `recovery-reader` (read-only), and `retention-admin` (`DeleteObject` only, invoked by explicit `remote-prune --confirm-delete`).
5. **Migration Risks:**
   - Enabling Object Lock requires bucket creation with Object Lock enabled at creation time (cannot be added to an existing non-locked bucket without recreation).
   - Historical C6.8.4 backups encrypted with `v1` (`infra/secrets/backup.key`) require importing/wrapping `v1` into the KMS recovery store so older recovery points remain decryptable.

---

## 5. Exact Resources & Synthetic Data Pending Stage B Approval
If approved for Stage C synthetic integration, the operator/provisioning step will create:
1. One dedicated synthetic test bucket (e.g., `byos-c691-synthetic-dr-<suffix>`) in the approved region with Versioning + Object Lock enabled.
2. Four least-privilege IAM identities (`wal-writer`, `backup-writer`, `recovery-reader`, `retention-admin`).
3. One AWS KMS Customer Managed Key (for synthetic test DEK wrapping/unwrapping).
4. Separate isolated recovery compute/VM (in a different failure domain from the development host) to execute `tests/disaster_recovery_live_offsite_c691.ps1`.
5. **Data Transferred in Stage C:** Synthetic PostgreSQL tables (`c691_synthetic_dr_ledger`), synthetic base backups, and synthetic encrypted WAL only. **Zero real BYOS backups or user data will be transferred in Stage C.**
