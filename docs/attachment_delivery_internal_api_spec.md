# BYOS Attachment Delivery Internal API & Outbound Integration Specification (Release B1 / B1.1)

> **Status:** Release B1.1 Reviewed Design Specification (NOT yet implemented in `services/api`, `services/storage-worker`, or `services/outbound-worker`)  
> **Scope:** Phase E Internal Service Contract + Phase F End-to-End Reliability & Integration Design for Path B SMTP Attachment Delivery

---

## 1. Service Boundaries & Zero-Knowledge Constraints

This contract enforces strict credential separation across the four runtime components:

| Component | Allowed Secrets / Keys | Prohibited Data |
|---|---|---|
| Browser Webmail (`apps/webmail`) | `mailbox_sk` (session memory / Worker), `OUTBOUND_DELIVERY_PK` (public) | `OUTBOUND_DELIVERY_SK`, `INTERNAL_API_KEY`, `STORAGE_WORKER_INTERNAL_KEY` |
| Control API (`services/api`) | `INTERNAL_API_KEY` (service auth verifier), `STORAGE_WORKER_INTERNAL_KEY` (upstream client to storage-worker), `OUTBOUND_DELIVERY_PK` (public) | `mailbox_sk`, `OUTBOUND_DELIVERY_SK`, plaintext `CEK`, decrypted attachment bytes at rest |
| Storage Worker (`services/storage-worker`) | `STORAGE_WORKER_INTERNAL_KEY`, customer storage backend credentials (`storage_connections`) | `mailbox_sk`, `OUTBOUND_DELIVERY_SK`, `INTERNAL_API_KEY`, attachment plaintext |
| Outbound Worker (`services/outbound-worker`) | `OUTBOUND_DELIVERY_SK` keyring, `BYOS_DKIM_DEK`, `INTERNAL_API_KEY` (or scoped `OUTBOUND_ATTACHMENT_INTERNAL_KEY`) | `mailbox_sk`, `STORAGE_WORKER_INTERNAL_KEY`, `storage_connections` DB rows, customer OAuth/S3 tokens |

Because `outbound_worker` Postgres role is explicitly blocked from `storage_connections` and `mailbox_storage` (`verify_least_privilege`, `services/outbound-worker/src/main.rs:660-688`), **`outbound-worker` MUST fetch encrypted attachment manifests and ciphertexts solely through `services/api` over internal HTTP**, which delegates storage retrieval to `services/storage-worker` (`/api/retrieve-stream` in Release B2; currently JSON `/api/retrieve` at `services/storage-worker/main.go:683, 977-1026`) using `STORAGE_WORKER_INTERNAL_KEY`.

**V1 Trusted Computing Base (TCB) Assumption:** Because `services/api` constructs the delivery manifest and recipient/routing envelope, V1 preserves cryptographic secrecy of `CEK` and attachment payloads at rest while trusting `services/api` + host TLS for manifest integrity and `OUTBOUND_DELIVERY_PK` authenticity (see `docs/attachment_encryption_protocol_v2.md` §4.0).

---

## 2. Internal Authentication & Authorization Model

### 2.1 Credential Scope (`X-Internal-Key`)

Inspected against `services/api/auth.go:1173-1218` and `services/api/multi_account_session_test.go:315-368`:
- `services/api/auth.go` already enforces per-service key separation in `verifyInternalServiceAuth(r, requiredService)`:
  - `"storage"` -> `STORAGE_WORKER_INTERNAL_KEY`
  - `"outbound"` -> `INTERNAL_API_KEY` (`internalAPIKey()`, `services/api/scheduled_completion.go:226-239`)
  - `"migration"` -> `MIGRATION_INTERNAL_KEY`
- Notice `POST /v1/internal/scheduled/complete` currently authorizes the `"outbound"` key (`INTERNAL_API_KEY_FILE=/run/secrets/internal_api_key`), while `mail-router`, `storage-worker`, and user routes (`verifyMailboxSession`) reject or fail closed (`403`) on cross-service keys.
- **Recommended Credential Hardening for Release B2:**
  - Support a dedicated scoped credential **`OUTBOUND_ATTACHMENT_INTERNAL_KEY`** (`OUTBOUND_ATTACHMENT_INTERNAL_KEY_FILE=/run/secrets/outbound_attachment_internal_key`, accepted alongside or replacing `INTERNAL_API_KEY` solely for the `/v1/internal/outbound/*` attachment read service `"outbound_attachments"`), mounted **only** in `services/api` and `services/outbound-worker`.
  - Compare `X-Internal-Key` via `subtle.ConstantTimeCompare`; empty or unconfigured keys fail closed (`401`/`403`).
  - Reject user session cookies / `Authorization: Bearer` / `X-User-Id` on all `/v1/internal/*` routes; enforce reverse-proxy ingress blocking so `/v1/internal/*` is unreachable from public HTTP traffic.

### 2.2 Delivery-Scoped Least-Privilege Authorization

`outbound-worker` MUST NEVER query attachments by arbitrary `attachment_id` or `mailbox_id`:
- Every request MUST address a specific **`delivery_id` UUID** and present the worker's active **`X-Lease-Token: <uuid>`** header obtained when claiming the queue row (`Release A.2`).
- `services/api` authorizes retrieval **only if ALL conditions hold**:
  1. `delivery_id` exists in `outbound_queue` with **`status = 'processing' AND expires_at > now()`** AND **`lease_token = <X-Lease-Token> AND lease_expires_at > now()`** (disallowed once `smtp_phase` reaches `'terminator_in_flight'`/`'accepted_by_mta'` or settled to `'accepted_by_mta'`, `'delivered'`, `'bounced'`, `'outcome_unknown'`, `'cancelled'`, or `'expired'`, and disallowed when `'pending'` without an active worker lease or when a lease has expired or been superseded).
  2. Each requested `attachment_id` exists in `outbound_delivery_attachments` for that exact `delivery_id` AND `outbound_delivery_attachments.mailbox_id = outbound_queue.mailbox_id`, joined to `attachments` with `attachments.mailbox_id = outbound_queue.mailbox_id` AND `attachments.upload_status = 'ready'`.
  3. Storage object lookup passes explicit `(mailbox_id, storage_key)` prefix validation matching `services/api/outbound.go:592-595` and `services/api/attachments.go` (defeating path traversal / cross-tenant storage injection).

---

## 3. HTTP Endpoint Contracts

### 3.1 `GET /v1/internal/outbound/{delivery_id}/attachments` (Manifest)

Retrieves ordered attachment descriptors and `cek_outbound_wrapped` grants for an active queued delivery.

- **Headers (Request):**
  - `X-Internal-Key: <secret>` (Required)
  - `X-Lease-Token: <uuid>` (Required; active `outbound_queue.lease_token` with `lease_expires_at > now()`, held by the claiming `outbound-worker` instance)
  - `Accept: application/json`
- **Path Parameters:**
  - `delivery_id`: UUIDv4 (validated via `uuid.Parse`; non-UUID -> `400 Bad Request`)
- **Success Response (`200 OK`, `Content-Type: application/json`, `Cache-Control: no-store`):**
  ```json
  {
    "delivery_id": "2c8d3f22-91a0-48d8-b4d6-0f23f8a6e211",
    "mailbox_id": "550e8400-e29b-41d4-a716-446655440000",
    "outbox_seq": 42,
    "status": "processing",
    "lease_token": "9e81f4a0-7f53-4a51-9f36-6d2c1b4c2d11",
    "lease_expires_at": "2026-11-12T06:10:00Z",
    "attachments": [
      {
        "attachment_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
        "position": 0,
        "disposition": "attachment",
        "content_id": null,
        "filename": "quarterly-report.pdf",
        "content_type": "application/pdf",
        "plaintext_size_bytes": 1048576,
        "ciphertext_size_bytes": 1048605,
        "plaintext_sha256_b64": "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
        "ciphertext_sha256_b64": "qL+2pT8m7vN1...",
        "crypto_version": 2,
        "aad_version": 2,
        "wrap_alg": "HPKE-X25519-AES256GCM-v1",
        "outbound_key_id_hex": "9f1a77c4e21b0083",
        "outbound_key_epoch": 2,
        "cek_outbound_wrapped_b64": "AQ...",
        "metadata_sha256_b64": "nV8...",
        "blob_path": "/v1/internal/outbound/2c8d3f22-91a0-48d8-b4d6-0f23f8a6e211/attachments/f47ac10b-58cc-4372-a567-0e02b2c3d479/blob"
      }
    ]
  }
  ```
- **Minimization & Size Budget Notes:**
  - `storage_key`, `storage_connections`, `cek_owner_wrapped`, and `owner_pk_sha256` are **omitted** from responses.
  - **Storage Upload Cap vs. Path B External SMTP Cap (Release B1.1 Clarification):**
    - **Storage ciphertext cap:** `MaxAttachmentSize = 40 MiB` (`41,943,040 B`) per encrypted attachment ciphertext uploaded to `POST /v1/mailboxes/{id}/attachments` (matching `services/api/attachments.go:25, 188` and `services/storage-worker/main.go:933`, with `http.MaxBytesReader` multipart ceiling in `attachments.go:171` increased to `40 MiB + 64 KiB` for multipart headers/form fields, while preserving `attachments.size_bytes = ciphertext_size_bytes` for `SEC-005` retrieval verification at `attachments.go:113`).
    - **Path B external SMTP cumulative plaintext cap:** **`25 MiB` (`26,214,400 B`)** total `plaintext_size_bytes` across all attachments on one outbound delivery (`35,872,340 B` / `~34.21 MiB` after RFC 2045 Base64 CRLF expansion at 76 chars/line). This keeps assembled MIME below AWS SES (`40 MB`), standard ESP relays, and Postfix `message_size_limit = 52428800` (`50 MiB`), and avoids the upstream Postfix default `10,240,000 B` cap (`infra/docker-compose.yml:58-74` and `infra/postfix/init/10-byos-routing.sh` currently omit `POSTFIX_message_size_limit` and would reject even an `8 MiB` plaintext attachment -> `11,479,150 B` Base64 CRLF!).
    - Note: `outboundSendHandler` (`outbound.go:191`) and `outboundScheduleHandler` (`outbound.go:469`) keep `4 MiB` (`4<<20`) `MaxBytesReader` on the JSON send request because encrypted attachments are pre-uploaded via `/v1/mailboxes/{id}/attachments`.

### 3.2 `GET /v1/internal/outbound/{delivery_id}/attachments/{attachment_id}/blob` (Encrypted Ciphertext Stream)

Streams the raw AES-256-GCM ciphertext blob (`0x01 || nonce(12) || ct || tag(16)`) fetched server-side from customer storage.

- **Headers (Request):**
  - `X-Internal-Key: <secret>` (Required)
  - `X-Lease-Token: <uuid>` (Required; must still match active `outbound_queue.lease_token` with `lease_expires_at > now()`)
- **Path Parameters:**
  - `delivery_id`: UUIDv4
  - `attachment_id`: UUIDv4
- **Success Response (`200 OK`):**
  - `Content-Type: application/octet-stream`
  - `Content-Length: <ciphertext_size_bytes>`
  - `Cache-Control: no-store`
  - `X-Attachment-Crypto-Version: 2`
  - `X-Ciphertext-SHA256: <base64>` (sanity digest stored in `attachments.ciphertext_sha256` at upload; `outbound-worker` checks stream hash before AES-GCM open, while true cryptographic integrity is enforced by the AES-GCM tag + `plaintext_sha256_b64` bound into `outbound_wrap_aad`)
  - Body: Raw binary encrypted blob bytes (`0x01 || nonce(12) || ct || tag(16)`).
- **Storage Retrieval Implementation Requirements (`services/storage-worker` & `services/api`):**
  - Today, `services/storage-worker/main.go:683` (`RetrieveResponse`) and `977-1026` (`retrieveHandler`) call `io.ReadAll(rc)` and marshal `Data []byte` as Base64 JSON (~33% serialization expansion + double buffering in Go heap for up to 40 MiB blobs), even though `GoogleDriveStorage.GetObject` (`175-189`) and `S3Storage.GetObject` (`296-305`) already return streaming `io.ReadCloser`.
  - Release B2 MUST add a raw binary streaming endpoint (`POST /api/retrieve-stream`) in `services/storage-worker` writing `io.Copy` with bounded `http.MaxBytesReader`, proxied cleanly through `services/api` with sequential worker retrieval so container RAM stays bounded.
  - Additionally, `services/api/attachments.go:98, 244` currently configure a **`30s` HTTP client timeout** against `storage-worker`; Release B2 MUST raise the upload/retrieval body read timeout (or header + idle stream deadline) to **`>= 120s`** so large multi-megabyte attachments over customer S3/Google Drive backends do not time out prematurely.
- **Upload Pre-Allocation Contract (`POST /v1/mailboxes/{id}/attachments`):**
  - Currently `services/api/attachments.go:217` discards any client ID and assigns `attID := uuid.New()`, and streams to `storage-worker` (`/api/store`) at line `231` BEFORE inserting into PostgreSQL at line `263`.
  - Release B2 MUST validate and honor the client-generated UUIDv4 `attachment_id` (the AAD identifier) by inserting an `upload_status = 'uploading'` reservation row BEFORE writing to storage (returning `409 Conflict` if `(id)` already exists) and committing `upload_status = 'ready'` once storage confirms write.

---

## 4. HTTP Status & Failure Semantics (Permanent Bounce vs Transient Retry)

| HTTP Status / Condition | Cause | `outbound-worker` Disposition | Rationale |
|---|---|---|---|
| `200 OK` | Valid manifest / blob returned | Proceed to cryptographic unwrap & decrypt | Normal path |
| `401 Unauthorized` / `403 Forbidden` | Missing, empty, or mismatched internal API key | **DO NOT bounce customer mail**; retry with backoff + emit `ERROR` alert | Operational secret misconfiguration, not recipient/content error |
| `404 Not Found` (machine code `"delivery_not_found"`) | `delivery_id` unknown / missing | Fail safely / skip without SMTP send | Prevents phantom send |
| `409 Conflict` / `410 Gone` | `outbound_queue.status != 'processing'` (`pending`/`accepted_by_mta`/`delivered`/`bounced`/`outcome_unknown`/`cancelled`/`expired`), missing/mismatched `X-Lease-Token`, `lease_expires_at <= now()`, or `expires_at <= now()` | Stale lease holder aborts immediately without SMTP `DATA` or touching queue state | Prevents superseded workers or post-expiry/settled attempts from reading customer ciphertexts or duplicating sends |
| `404 Not Found` (machine code `"attachment_object_missing"`) | Customer/provider removed object from storage out-of-band before send | **Permanent failure (`bounced`)** + `delivery_log` + scheduled `"failed"` callback (`"attachment_object_missing"`) | Unrecoverable missing customer payload |
| `422 Unprocessable Entity` | `crypto_version = 1` legacy attachment lacking v2 wrap, `upload_status != 'ready'`, aggregate `plaintext_size_bytes > 25 MiB`, or corrupted metadata | **Permanent failure (`bounced`)** + `delivery_log` (`"attachment_v2_grant_invalid"`) | Deterministic client/data error; retrying never fixes it |
| `408 Request Timeout`, `429 Too Many Requests`, `500`/`502`/`503`/`504`, network timeout | Customer storage provider throttle/outage (Google Drive/S3 5xx) or `api`/`storage-worker` restart | **Transient retry** (`record_retry`: increment `attempts`, schedule `next_attempt_at` backoff up to `max_attempts` / `expires_at`) | Matches Release A.1 transient/permanent separation discipline |
| Crypto error (`UnknownKeyEpoch` where epoch $>$ local max) | Worker keyring rollout lag behind API | Short **transient retry** + `ERROR` alert | Allows secret reload without losing user email |
| Crypto error (`hpke_open`, `aes_gcm_decrypt`, `ciphertext_sha256`, `metadata_sha256`, or `plaintext_sha256` mismatch) | Tampered DB metadata, wrong keypair (`key_id`), or corrupted ciphertext | **Fail closed immediately** (`bounced`), zeroize buffers, NEVER transmit partial/unverified attachment | Enforces zero-trust cryptographic integrity |

---

## 5. `outbound-worker` Concurrency, Memory Budget, Decryption, MIME Assembly, and DKIM Ordering

### 5.1 Preconditions in Existing `outbound-worker` (`services/outbound-worker/src/main.rs`)

Independent review identified three pre-existing reliability defects in `main.rs` that Release B2 MUST resolve alongside attachment assembly:
1. **Autocommit `FOR UPDATE SKIP LOCKED` Lock Loss:** `poll_scheduled` (`main.rs:695-701`) and `poll_once` (`main.rs:1025-1030`) execute `SELECT ... FOR UPDATE SKIP LOCKED` directly via `client.query(...)` without a surrounding database transaction (`BEGIN ... COMMIT`), releasing row locks immediately before network or SMTP I/O. Release B2 MUST acquire a leased transaction / `claimed_until` guard so parallel worker instances cannot concurrently process attachments or double-send the same `delivery_id`.
2. **False-Bounce `delivery_log` on Retry (`main.rs:1070-1076`):** `decrypt_outbound` errors with remaining attempts leave `outbound_queue.status = 'pending'` yet insert `'bounced'` into `delivery_log`. Release B2 MUST log non-terminal errors as `'retry'` (recording `'bounced'` only on terminal failure).
3. **Expired Queue Row Starvation:** `poll_once` skips `expires_at <= now()`, leaving expired rows permanently in `'pending'`. Release B2 MUST run an expiration sweep marking `status = 'expired'` once `expires_at <= now()`.

### 5.2 Per-Delivery Execution Sequence & Memory Budget

When `outbound_queue.attachment_count > 0` in `services/outbound-worker/src/main.rs` `poll_once`:

1. **Decrypt Body First:**
   - Unwrap & decrypt `encrypted_message` via `decrypt_outbound` using key selected by `(send_token_key_epoch, send_token_key_id)` (`NULL` -> epoch 1 fallback).
   - Inspect parsed headers (`From`, `To`, `Cc`, `Bcc`); apply recipient limit and rate limits before downloading attachment blobs (avoids wasted storage bandwidth on throttled/bounced sends).
2. **Fetch Manifest & Verify Attachment Budgets:**
   - Call `GET /v1/internal/outbound/{delivery_id}/attachments`.
   - Sort deterministically by `position ASC`.
   - Enforce **`sum(plaintext_size_bytes) <= 26,214,400` (`25 MiB`)** and maximum assembled MIME size `<= 45,000,000` bytes (cleanly below Postfix `52,428,800 B` / `50 MiB`; fail closed before blob download if exceeded).
3. **Sequential Unwrap, Download, Decrypt, Integrity-Check & Zeroize (`Semaphore(1)` per delivery):**
   - Select secret key `sk_E` from keyring (`OUTBOUND_DELIVERY_SK_RING_FILE`, validated on startup so derived X25519 public key matches each entry's `key_id`, keeping current + previous overlap epochs for rollout/rollback resilience) by `(outbound_key_epoch, outbound_key_id)`.
   - Recompute canonical `metadata_sha256` locally from returned `(filename, content_type, plaintext_size_bytes, plaintext_sha256_b64, disposition, content_id)` after validating canonical filename/media-type normalization and assert equality with `manifest.metadata_sha256_b64`.
   - Reconstruct canonical 101-byte `outbound_wrap_aad` (`"byos-att-outb-v2" || mailbox_id || outbox_seq || attachment_id || key_id || key_epoch || 0x02 || metadata_sha256`).
   - Call `byos_crypto_core::hpke_open(&sk_E, &cek_outbound_wrapped, &outbound_wrap_aad)` -> yields 32-byte `CEK` wrapped in `Zeroizing<[u8; 32]>`.
   - Stream encrypted blob from `blob_path` (`>= 120s` timeout), computing streaming `SHA-256(ciphertext)` and asserting equality with `ciphertext_sha256_b64` / `X-Ciphertext-SHA256`.
   - Reconstruct canonical 53-byte `blob_aad` (`"byos-att-blob-v2" || mailbox_id || attachment_id || 0x02 || 0x02`).
   - Call `byos_crypto_core::aes_gcm_decrypt(&cek, &blob_ciphertext, &blob_aad)` -> yields `Zeroizing<Vec<u8>>` plaintext; immediately `drop()` ciphertext buffer and `Zeroizing` `CEK`.
   - Verify `plaintext.len() == plaintext_size_bytes` AND `SHA-256(&plaintext) == plaintext_sha256_b64`.
   - Base64-encode (`76-char` CRLF) into the outgoing MIME part buffer and immediately `drop()` / zeroize the raw `Zeroizing<Vec<u8>>` plaintext before fetching the next attachment.
4. **RFC 5322 / RFC 2045 MIME Construction & `dkim_sign` UTF-8 / Memory Safety:**
   - **Mandatory 7-bit ASCII Transfer Encoding:** Audited inspection of `packages/crypto-core/src/lib.rs:1253-1336` showed `dkim_sign(message: &[u8], ...)` runs `String::from_utf8_lossy(message)` over the entire message and allocates ~`3x` message size internally (yielding ~`4x` total transient RAM alongside caller `sanitized_plaintext` and `assemble_final_message` = ~`140-190 MiB` peak for a `25 MiB` plaintext / `35.87 MiB` Base64 MIME message).
   - Accordingly: ALL binary/attachment MIME parts MUST use **`Content-Transfer-Encoding: base64`** (`7-bit` ASCII — raw `8BITMIME` octets are strictly **prohibited** before `dkim_sign`), non-ASCII / arbitrary body octets MUST likewise be ASCII transfer-encoded (`quoted-printable` or `base64`), intermediate plaintext/part buffers MUST be dropped prior to calling `dkim_sign`, and worker container memory limits MUST budget `>= 512 MiB` per large-attachment slot.
   - Construct top-level `multipart/mixed` container preserving original `From`, `To`, `Cc`, `Subject`, `Date`, `Message-ID`, `In-Reply-To`, `References`, and `MIME-Version: 1.0` headers while wrapping the decrypted body part (`text/plain`, `text/html`, or `multipart/alternative`) as part 0.
   - If `disposition == "inline"` with non-empty `content_id`, nest body + inline resources inside `multipart/related` inside `multipart/mixed` with `Content-Disposition: inline` and `Content-ID: <sanitized_cid>` (stripping CR/LF/angle brackets).
   - Append attachment parts in `position` order with RFC 2231 / RFC 5987 safe `filename` / `filename*` parameters (stripping CR/LF/control chars/NUL/quotes to neutralize header injection).
5. **Release A Invariants Preserved (`strip_bcc_headers` + Envelope RCPT TO + DKIM Signing Order + Postfix Limit):**
   - Collect SMTP envelope `RCPT TO` recipients from `To` + `Cc` + `Bcc` BEFORE header stripping.
   - Strip ALL `Bcc:` headers (`strip_bcc_headers`) from final MIME bytes prior to signing and SMTP `DATA`.
   - **Sign DKIM LAST**, over the **fully assembled final RFC 5322 `multipart/mixed` message**, so the `bh=` body hash covers both message body and encoded attachment boundaries cleanly.
   - **Postfix Configuration (`infra/docker-compose.yml`):** Currently `infra/docker-compose.yml:58-74` and `infra/postfix/init/10-byos-routing.sh` set no `POSTFIX_message_size_limit` (defaulting Postfix to `10,240,000 B`, which rejects even an `8 MiB` plaintext attachment -> `11,479,150 B` Base64 CRLF). Release B2 MUST configure `POSTFIX_message_size_limit: "52428800"` (`50 MiB`).
   - Transmit via Postfix SMTP (`lettre`), then zeroize plaintext/MIME payload buffers from worker RAM.

---

## 6. End-to-End Lifecycle Flows & Integration Design (Phase F)

### 6.1 Standard Path B Send (Single & Multiple Attachments)

1. Compose selects attachments -> Web Worker generates UUIDv4 `attachment_id` + random `CEK` -> canonicalizes `filename` (`NFC`, sanitized matching `sanitizeFilename`) and `content_type` (`mime.ParseMediaType` lowercase type/subtype) -> encrypts blob (`v=2`) & wraps `cek_owner_wrapped` via `wasm_hpke_seal` (`mailbox_pk`, `owner_wrap_aad`) -> `POST /v1/mailboxes/{id}/attachments` reserves `upload_status = 'uploading'`, stores ciphertext (`<= 40 MiB`), commits `upload_status = 'ready'`.
   - *Key-Rotation Prerequisite:* Before relying on `owner_key_version` lookup during unwrap on rotated accounts, `services/api/recovery_flow.go:383-418, 1077-1098, 1428-1445` MUST be updated so password-reset key rotation and historical reactivation atomically increment `mailbox_sk_version`.
2. User clicks Send -> `validateAttachmentSendReadiness` checks that all uploads finished (`apps/webmail/src/attachment_upload_pipeline.ts:149`) AND aggregate outbound plaintext size `<= 25 MiB` (`26,214,400 B`).
3. If any attachment is legacy `v=1` (`crypto_version === 1`), client lazily decrypts via `mailbox_sk`, re-encrypts as a fresh `v=2` attachment, and swaps ID in the send payload (historical inbox/sent rows untouched).
4. Client calls `POST /v1/outbound/prepare` -> receives `{ reservation_id, outbox_seq }`.
5. Client refreshes `GET /v1/outbound/pubkey` (`pk`, `key_id`, `key_epoch`), unwraps `CEK` from `cek_owner_wrapped`, computes `metadata_sha256` & `outbound_wrap_aad`, wraps `cek_outbound_wrapped` via `wasm_hpke_seal`, encrypts RFC 5322 body via `wasm_encrypt_outbound`, and submits `POST /v1/outbound/send`.
6. `services/api` atomically inserts `outbound_queue` (`attachment_count = N`, `send_token_key_epoch`, `send_token_key_id`), inserts `outbound_delivery_attachments` (`delivery_id`), sets `attachments.message_id` / linkage, marks reservation `consumed`, and persists Sent folder copy (`sentMsgID`).
7. Worker loop fetches manifest + streaming blobs sequentially, decrypts/verifies, builds 7-bit Base64 `multipart/mixed`, strips `Bcc`, signs DKIM, delivers via Postfix SMTP (`message_size_limit = 50 MiB`).

### 6.2 Scheduled Send, Reschedule, Cancellation, and Completion Reconciliation

- **Schedule (`/v1/outbound/schedule`):** Inserts `scheduled_messages` (`attachment_count = N`, `send_token_key_epoch`, `send_token_key_id`) AND `outbound_delivery_attachments` under the same `delivery_id` + `outbox_seq` inside a single DB transaction (`aggregate plaintext <= 25 MiB`).
- **Reschedule / Edit (`mailboxScheduledUpdateHandler`, `services/api/outbound.go:1375-1536`):**
  - Currently updates `scheduled_at` only while ignoring `encrypted_message` / `attachment_ids`.
  - Release B2 MUST keep existing `outbound_delivery_attachments` intact on timestamp-only updates, and if payload/attachments editing is permitted, atomically replace `encrypted_message`, `attachment_count`, and `outbound_delivery_attachments` grants inside the DB TX (returning `409` on expired epoch so the client refreshes `/v1/outbound/pubkey`).
- **Promotion (`poll_scheduled` -> `outbound_queue`):** Copies `attachment_count`, `send_token_key_epoch`, `send_token_key_id`, `delivery_id`, `outbox_seq`, `reservation_id` verbatim into `outbound_queue`. Zero grant mutation needed.
- **Cancel Scheduled — BOTH Handlers (`services/api/outbound.go:876-937` & `1224-1374`):**
  - `mailboxScheduledCancelHandler` (`1224-1374`): Restores `draft_storage_ref` -> `drafts` row (`draftID`), **MUST migrate `outbound_delivery_attachments` -> `draft_attachments` under `draftID`**, clear/unlink `attachments.message_id` if pointing to `delivery_id`, and delete `outbound_delivery_attachments` for that `delivery_id` inside the same TX.
  - `outboundScheduledCancelHandler` (`876-937`): Currently only executes `UPDATE scheduled_messages SET status = 'cancelled'` and leaves `attachments.message_id = delivery_id` dangling; Release B2 MUST likewise restore `draft_attachments` (when `draftID` exists) or reset `attachments.message_id = NULL` and delete `outbound_delivery_attachments` in the same TX!
- **Sent / Failed Mirror Reconciliation (`services/api/scheduled_completion.go:109-120, 165-180`):**
  - `createSentMessageCopy` creates a fresh `sentMsgID != delivery_id`, and failed scheduled cleanup creates `draftID != delivery_id`.
  - `completeScheduledDeliveryTx` MUST copy/re-link `attachments` references to `sentMsgID` (`sent`) or `draft_attachments` under `draftID` (`failed`) and purge `outbound_delivery_attachments` for `delivery_id`.

### 6.3 Draft Save, Autosave, Multi-Device Resume, and Deletion

Addresses gaps identified in `apps/webmail/src/App.tsx:6284, 7083-7350`:
1. `createDraft` / `updateDraft` (`services/api/drafts.go`) accept `attachment_ids: string[]` (optional empty array to clear), validating ownership `(id, mailbox_id, upload_status = 'ready')` and replacing `draft_attachments` transactionally.
2. `performAutoSaveDraft` and `handleSaveDraft` include finished server `attachment_ids` in both API payloads and `lastSavedDraftSnapshot` so adding or removing attachments triggers dirty detection and saves immediately.
3. `GET /v1/mailboxes/{mailbox_id}/drafts` returns attached descriptors joined via `draft_attachments` (including `crypto_version`, `cek_owner_wrapped`, `owner_wrap_alg`, `owner_key_version`, `owner_pk_sha256`, `plaintext_sha256`, `plaintext_size_bytes`, `ciphertext_size_bytes`, `disposition`, `content_id`); `startEditDraft` populates `composeAttachments` so switching browsers/devices restores attachments seamlessly with preview/download via `cek_owner_wrapped`.
4. Removing an attachment from an unsent draft unlinks from `draft_attachments` / calls `DELETE /v1/mailboxes/{id}/attachments/{att_id}`; `DELETE /drafts/{draft_id}` cascades `draft_attachments`, making unreferenced draft-only blobs eligible for orphan GC.

### 6.4 Offline Queue, Partial Failure, and Undo Send

- **Undo Send (`apps/webmail/src/undo_send.ts`):** Because `POST /v1/outbound/prepare` and `POST /v1/outbound/send` only execute *after* the 5-second undo timer expires (`App.tsx`), `cek_outbound_wrapped` is NOT created before undo; clicking Undo restores `composeAttachments` (`uploadStatus = "completed"`) cleanly without server state cleanup.
- **Offline Send (`apps/webmail/src/send_queue.ts`, `App.tsx:3168-3202, 6624-6639`):**
  - *Current Baseline Defect:* `send_queue.ts` and `replayQueue` Path B (`App.tsx:3174-3202`) do NOT yet include `attachment_ids`, invoke `POST /v1/outbound/prepare` (`outbox_seq`), or mint `cek_outbound_wrapped`.
  - Release B2 MUST fail closed on offline Path B messages with attachments until `replayQueue` is upgraded to: (1) fetch fresh `POST /v1/outbound/prepare` + `GET /v1/outbound/pubkey` on reconnect, (2) verify `mailbox_sk` is unlocked in session memory to unwrap `cek_owner_wrapped` -> mint fresh `cek_outbound_wrapped` bound to the new `outbox_seq` and active `key_epoch`, or (3) pause the queued item with status `"awaiting_unlock"` and prompt the user rather than silently dropping attachments.
  - If a file is selected *while offline*, client holds the local blob handle (or blocks Path B queue submit until online upload produces an `attachment_id`, or stages encrypted upload automatically upon reconnect before calling `send`).
- **Partial Attachment Upload Failure:** `validateAttachmentSendReadiness` blocks sending until failed attachments succeed retry or are removed, preventing partial sends.

### 6.5 Multi-Recipient & BCC Privacy with Attachments

- When a Path B external email addresses multiple external recipients across `To`, `Cc`, and `Bcc`:
  - `outbound_queue` holds one delivery row (`delivery_id`) containing the full recipient header set inside `encrypted_message`, plus `outbound_delivery_attachments` grants for all attachments.
  - `outbound-worker` downloads/decrypts attachments sequentially, constructs the `multipart/mixed` MIME structure, extracts `To + Cc + Bcc` envelope recipients for SMTP `RCPT TO`, executes Release A's `strip_bcc_headers` so zero `Bcc:` lines remain in `DATA`, DKIM-signs the final MIME body, and transmits over SMTP.
  - For mixed Path A + Path B sends (some BYOS internal recipients, some external SMTP recipients), Path A continues creating per-recipient `AttachmentEnvelope` chunks (`crypto_worker_ops.ts`) while Path B receives its dedicated `outbound_delivery_attachments` grants cleanly with distinct content keys (`K_pathA != CEK_pathB` recommended, or separate key-wraps) so external relay exposure remains scoped purely to external delivery grants.

---

## 7. Concrete Release B2 Implementation Plan (Sequence Checklist)

To implement Release B2 cleanly after resolving B1.1 prerequisites:

1. **Key-Rotation Prerequisite (`services/api/recovery_flow.go`):** Update password-reset key rotation & historical reactivation handlers (`383-418, 1077-1098, 1428-1445`) to increment `mailbox_sk_version` atomically alongside `mailbox_pk` updates.
2. **Migration (`infra/postgres/init/070_attachment_encryption_v2_and_delivery.sql` following Release A.2's proposed `069_outbound_queue_lease_and_outcomes.sql`):** Apply additive `attachments` (`upload_status`, `plaintext_size_bytes`, `ciphertext_sha256`, `owner_pk_sha256`, `trg_attachments_v2_immutable`), `outbound_delivery_attachments`, `draft_attachments`, `outbound_delivery_keys`, and `outbound_queue`/`scheduled_messages` schema extensions + `outbound_worker` grants/revokes (`068_draft_folders.sql` baseline + Release A.2 queue leases).
3. **`packages/crypto-core` & WASM Build:** Export helpers `build_attachment_blob_aad_v2`, `build_attachment_owner_wrap_aad_v2`, `build_attachment_metadata_hash_v2`, `build_attachment_outbound_wrap_aad_v2`, compose canonical metadata/HPKE helpers over existing `wasm_hpke_seal`/`wasm_hpke_open` (`lib.rs:1889-1940`), and verify deterministic cross-language SHA-256 / AAD / AES-GCM test vectors.
4. **Infrastructure & Streaming Storage (`infra/docker-compose.yml`, `services/storage-worker/main.go`):** Configure `POSTFIX_message_size_limit: "52428800"` (`50 MiB`); implement `POST /api/retrieve-stream` in `services/storage-worker` alongside `>= 120s` storage HTTP client timeout in `services/api/attachments.go`.
5. **Keyring Bootstrap & Pubkey Endpoint (`services/api/outbound.go`, `services/outbound-worker`):** Upgrade `GET /v1/outbound/pubkey` to serve `key_id`, `key_epoch`, `valid_until`, `min_accepted_epoch`; upgrade `outbound-worker` secret loader to support `OUTBOUND_DELIVERY_SK_RING_FILE` with startup PK/`key_id` validation and dual-epoch rollback overlap.
6. **Go API Upload, Drafts, Cancel, Reschedule, Completion, Send & Internal Endpoints:**
   - Update `services/api/attachments.go` for client UUIDv4 pre-allocation (`upload_status = 'uploading' -> 'ready'`), `+64 KiB` `MaxBytesReader` headroom, canonical filename/MIME validation, `crypto_version=2`, `owner_pk_sha256`, `plaintext_size_bytes`, `plaintext_sha256`, `ciphertext_sha256` (`size_bytes = ciphertext_size_bytes` preserved for SEC-005).
   - Update `services/api/drafts.go`, `services/api/outbound.go` (`outboundSendHandler`, `outboundScheduleHandler`, `outboundScheduledCancelHandler`, `mailboxScheduledCancelHandler`, `mailboxScheduledUpdateHandler`), and `services/api/scheduled_completion.go` (`completeScheduledDeliveryTx`) for `draft_attachments`, `outbound_delivery_attachments`, `25 MiB` outbound aggregate limit, `sentMsgID`/`draftID` attachment reconciliation, `409 outbound_key_epoch_expired`, and `422 attachment_v2_upgrade_required`.
   - Implement `GET /v1/internal/outbound/{delivery_id}/attachments` and `/blob` guarded by scoped `X-Internal-Key`, `X-Lease-Token` active lease matching (`status = 'processing' AND lease_token = $X AND lease_expires_at > now() AND expires_at > now()`).
7. **Rust Outbound Worker (`services/outbound-worker/src/main.rs`):** Build on Release A.2's transactional lease claim / renewal / `'retry'` vs `'bounced'` / `'outcome_unknown'` / expiration reaper lifecycle; add manifest + streaming blob client (passing `X-Lease-Token`), key-epoch lookup, `Zeroizing` HPKE/AES-GCM decryption + SHA-256 verification, sequential `Semaphore(1)` loop, 7-bit Base64 `multipart/mixed` / `multipart/related` MIME assembly, `drop()` before `dkim_sign`, Release A `strip_bcc_headers`, and post-assembly DKIM signing.
8. **Webmail Frontend (`apps/webmail/src/`):** Implement canonical metadata normalization, `v=2` attachment upload pipeline in `crypto_worker_ops.ts` & `api.ts`, `25 MiB` external attachment cap feedback, lazy `v=1 -> v=2` draft/send auto-upgrade, send/schedule `cek_outbound_wrapped` wrapping (with `409` epoch-refresh retry), draft/autosave `attachment_ids` persistence in `App.tsx`, and fail-closed `offline_cache` / `replayQueue` Path B upgrade.
9. **Verification Gate:** Cross-language WASM<->Rust encryption vectors, Go API handler & RBAC tests, Rust SMTP capture end-to-end MIME + attachment byte-integrity + `>= 8 MiB` / `<= 25 MiB` Postfix delivery + BCC strip + DKIM tests, key-rotation drain/rollback tests, and browser E2E checks across standard, scheduled, cancel-to-draft, offline, and legacy upgrade flows.
