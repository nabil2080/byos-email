# C6.9 Storage Architecture Decision: Provider-Neutral Off-Site Object Storage

## 1. Existing Storage Interface Audit (`StorageDestination`)
The existing C6.8 storage abstraction in `tools/byos-backup/storage.go` defines:
```go
type StorageDestination interface {
	Name() string
	Put(ctx context.Context, key string, data []byte, metadata map[string]string) error
	Get(ctx context.Context, key string) ([]byte, map[string]string, error)
	Delete(ctx context.Context, key string) error
	Exists(ctx context.Context, key string) (bool, error)
	List(ctx context.Context, prefix string) ([]ObjectInfo, error)
	GetInfo(ctx context.Context, key string) (ObjectInfo, error)
}
```
Implemented by:
- `FilesystemStorage`: Atomic write-temp-sync-rename, SHA-256 idempotency/conflict check on `Put`, recursive listing. Ignores `metadata` map.
- `MemoryStorage`: Thread-safe map with fault-injection toggles (`simOffline`, `simPermErr`, `simDiskFull`).

### Gaps Identified for Off-Site Object Storage
1. **Large-Object Streaming & Multipart Uploads:** `Put`/`Get` take `[]byte` in memory. Physical base backups and large archives require streaming (`io.Reader` / `PutFromFile` / `GetToFile`) and automatic multipart upload with incomplete-session cleanup.
2. **Metadata Preservation:** Remote objects must persist `sha256_hex`, `key_version`, and `plaintext_size` in S3 user metadata (`x-amz-meta-*`) alongside `.meta.json` sidecars.
3. **Transient Retry & Backoff:** Network calls to remote S3 endpoints require bounded exponential backoff for transient 5xx/timeout/network errors while failing fast on 401/403 authentication errors and conflict errors (`ErrObjectAlreadyExists`).
4. **Atomic Completion Protocol:** Partial or unverified uploads must never appear as completed recovery points; the recovery catalog (`catalog/recovery_catalog.json`) and `.meta.json` / completion markers are committed only after data upload, size verification, and SHA-256 verification succeed.

---

## 2. Proposed Remote Adapter (`S3Storage` via `minio-go/v7`)
We select `github.com/minio/minio-go/v7` (already present in the repository Go workspace at `v7.0.86`, zero new external dependency trees required) implementing `StorageDestination` plus streaming extensions (`PutFile`, `GetFile`):
- **Endpoint-Configurable:** Supports AWS S3, Cloudflare R2, Backblaze B2, GCS S3-interop, Wasabi, and local MinIO.
- **Addressing Modes:** Supports both virtual-hosted-style and path-style (`BYOS_BACKUP_REMOTE_PATH_STYLE=true`).
- **Transport Security:** TLS enabled by default (`https://`), configurable only for local disposable test endpoints (`http://`).
- **Multipart Upload:** Streaming `PutObject` with configurable `PartSize` (default 16 MiB) and automatic multipart abort on failure.

---

## 3. Authentication & Credential Model
- Credentials are never accepted on CLI flags or stored in Compose YAML / `.env.example`.
- Supported credential resolution order:
  1. Mounted secret files (`BYOS_BACKUP_REMOTE_ACCESS_KEY_FILE`, `BYOS_BACKUP_REMOTE_SECRET_KEY_FILE`).
  2. Standard environment variables (`BYOS_BACKUP_REMOTE_ACCESS_KEY` / `AWS_ACCESS_KEY_ID`, `BYOS_BACKUP_REMOTE_SECRET_KEY` / `AWS_SECRET_ACCESS_KEY`, optional `AWS_SESSION_TOKEN`).
  3. IAM / instance-profile credential chain when running on cloud compute.
- Separate least-privilege IAM roles are specified for:
  - `wal-writer` (`s3:PutObject`, `s3:GetObject` / `s3:HeadObject` only for idempotency; **no** `s3:DeleteObject` or bucket-policy permissions).
  - `backup-writer` (`s3:PutObject`, `s3:GetObject`, `s3:ListBucket`; **no** `s3:DeleteObject`).
  - `recovery-reader` (read-only `s3:GetObject`, `s3:ListBucket`).
  - `retention-admin` (isolated `s3:DeleteObject` for dependency-verified pruning only).

---

## 4. Integrity & Encryption Model
- **Primary Confidentiality:** Application-level **AES-256-GCM** (`BYOSENC1` header + `BYOS_WAL_V1` / `BYOS_BACKUP_V1` AAD) remains mandatory prior to egress. Provider-side SSE (SSE-S3 / SSE-KMS) is defense-in-depth only.
- **ETag Disclaimer:** S3 `ETag` values are **never** treated as cryptographic SHA-256 checksums (especially for multipart uploads, where `ETag` is `<md5>-<partcount>`).
- **Application-Level Integrity:** Every object upload records `plaintext_sha256` and `ciphertext_sha256` in `.meta.json` and `x-amz-meta-byos-sha256`. Post-upload verification checks remote `Size` and `x-amz-meta-byos-sha256` (and full read-back SHA-256 verification during `remote-verify`).
- **Conflict Rejection:** If a remote object already exists with the same key and identical `x-amz-meta-byos-sha256` (or verified byte SHA-256), `Put` is idempotent (`nil`). If the existing remote object has a different checksum, `Put` fails closed with `ErrObjectAlreadyExists`.

---

## 5. Retention & Failure Behavior
- **Dual-Destination Modes:**
  - `BYOS_BACKUP_REMOTE_REQUIRED=false` (Optional / Async): Local archive succeeds independently; remote upload failures are logged and surfaced via `remote-status` lag/pending metrics without halting PostgreSQL WAL archival.
  - `BYOS_BACKUP_REMOTE_REQUIRED=true` (Required / Sync): `archive-wal` returns nonzero to PostgreSQL if remote upload or verification fails, preserving local `.ready` state so PostgreSQL retries and never advances past un-replicated WAL. Local `pg_wal` disk alerts are mandatory in this mode.
- **Retention Safety:** Dependency-aware pruning (`remote-prune`, dry-run by default) inspects all retained `PhysicalBackupManifest` entries in the recovery catalog and refuses to delete any WAL segment or `.history` / `.backup` file required by a retained baseline.

---

## 6. Provider Compatibility Matrix

| Capability | AWS S3 | Cloudflare R2 | Backblaze B2 | Local MinIO (Test Only) |
|---|---|---|---|---|
| S3 Put/Get/List/Head | Supported | Supported | Supported | Supported |
| Path-Style Addressing | Optional | Supported | Supported | Required |
| Multipart Streaming | Supported | Supported | Supported | Supported |
| Custom User Metadata (`x-amz-meta-*`) | Supported | Supported | Supported | Supported |
| Object Lock (WORM Immutability) | Supported (Compliance/Governance) | Supported (Bucket Lock) | Supported (Object Lock) | Supported (with lock-enabled bucket) |
| IAM Role / STS | Native IAM | API Tokens | Application Keys | Access/Secret Keys |

## 7. Outstanding Provider Selection Decision
External provider provisioning is **PENDING OPERATOR APPROVAL** (Stage B). See `docs/c69_offsite_provider_decision.md` for full comparison and recommendation.
