# BYOS Attachment Encryption Protocol v2 & Key Lifecycle Architecture

> **Status:** Release B1.1 Reviewed Design Specification (Design-Only — NOT yet implemented or migrated)  
> **Scope:** Path B External SMTP Attachment Delivery & Multi-Device Draft/Scheduled Attachment Support  
> **Frozen Spec Compliance:** Preserves Section 12, Section 13 (`OUTBOUND_DELIVERY_SK` boundary & 32-byte X25519 key constraint), and Section 15 invariants in `docs/08-v5.3-final.md` and canonical AAD/nonce discipline in `docs/crypto/envelope-v1-spec.md`.

---

## 1. Executive Problem Statement

Today, attachment uploads in `apps/webmail/src/api.ts` (`uploadEncryptedAttachment`) encrypt attachment payloads symmetrically under the mailbox secret key (`mailbox_sk`) as **v1 attachments** stored in `attachments` (`infra/postgres/init/020_attachments.sql`) via `services/api/attachments.go`. Meanwhile:

- Path B outbound message bodies already use a dedicated asymmetric outbound transport keypair (`OUTBOUND_DELIVERY_PK` / `OUTBOUND_DELIVERY_SK`) with `encrypt_outbound` / `decrypt_outbound` (`packages/crypto-core/src/lib.rs:970-1017`), keeping `mailbox_sk` strictly absent from `services/outbound-worker/src/main.rs` (`docs/08-v5.3-final.md` §13).
- `services/outbound-worker` is prohibited from holding `mailbox_sk` (`verify_least_privilege`, PostgreSQL `outbound_worker` role), and currently has no key-wrapping or retrieval path to decrypt `attachments` rows during external SMTP MIME assembly.
- `OUTBOUND_DELIVERY_PK` / `OUTBOUND_DELIVERY_SK` currently lack a `key_id` or `key_epoch` rotation mechanism (`services/api/outbound.go:117-145`, `services/outbound-worker/src/main.rs:585-604`).

Protocol **v2 (`crypto_version = 2`)** introduces a fresh **per-attachment 256-bit Content Encryption Key (`CEK`)** wrapped independently for:
1. The **mailbox owner** (`cek_owner_wrapped`, stored at upload time for multi-device access, preview/download, draft sync, forward, and future re-wrap), and
2. An **authorized Path B outbound delivery** (`cek_outbound_wrapped`, minted strictly per delivery reservation/outbox sequence at send/schedule time under an epoch-tracked `OUTBOUND_DELIVERY_PK`).

At **no point** does `outbound-worker` ever receive `mailbox_sk`, nor does the browser or `services/api` ever hold `OUTBOUND_DELIVERY_SK`.

---

## 2. Cryptographic Primitives & Reuse of `packages/crypto-core`

Primitives in Protocol v2 reuse existing audited functions in `packages/crypto-core/Cargo.toml` and `packages/crypto-core/src/lib.rs`:

| Purpose | Primitive | Implementation Status & Code Reference |
|---|---|---|
| Symmetric payload encryption | **AES-256-GCM** (NIST SP 800-38D), 96-bit CSPRNG nonce, 128-bit auth tag | **Implemented in Rust & WASM:** `byos_crypto_core::aes_gcm_encrypt` / `aes_gcm_decrypt` (`packages/crypto-core/src/lib.rs:399-458`) and `wasm_aes_gcm_encrypt` / `wasm_aes_gcm_decrypt`, wire `0x01 \|\| nonce(12) \|\| ct \|\| tag(16)` |
| Outbound CEK encapsulation | **RFC 9180 HPKE Base Mode** `DHKEM(X25519, HKDF-SHA256) + HKDF-SHA256 + AES-256-GCM` | **Implemented in Rust & WASM:** `byos_crypto_core::hpke_seal` / `hpke_open` (`packages/crypto-core/src/lib.rs:553-635`) and `wasm_hpke_seal` / `wasm_hpke_open` (`lib.rs:1889-1940`), wire `0x01 \|\| enc(32) \|\| ct+tag(48)` (`81 bytes`) |
| Owner CEK encapsulation (V2 required algorithm) | **RFC 9180 HPKE Base Mode X25519** (`HPKE-X25519-AES256GCM-v1`) under `mailbox_pk` (32B X25519 from `wasm_generate_keypair`) | **Implemented in Rust & WASM:** `hpke_seal` / `hpke_open` and `wasm_hpke_seal` / `wasm_hpke_open` (`81 bytes`) accepting raw binary caller `owner_wrap_aad` |
| Future Post-Quantum Owner CEK option (**DEFERRED / UNIMPLEMENTED**) | **X-Wing Hybrid KEM** (`HPKE-XWing-AES256GCM-v1`) under `mailbox_xwing_pk` (1216B) / `xwing_seed` (32B) | **GAP — NOT usable in WASM for Protocol v2 yet:** `byos_crypto_core::xwing_hpke::seal` (`xwing_hpke.rs:91-141`) is Rust-only; existing `wasm_seal_xwing_envelope` / `wasm_open_xwing_envelope` operates on JSON `CryptoEnvelope` with hardcoded `build_envelope_aad` and ignores caller `owner_wrap_aad`. Excluded from initial Release B2 rollout. |
| Digests & future subkey derivation | **SHA-256** (`sha2 = "0.10"`) & **HKDF-SHA256** (`hkdf = "0.12"`) | `packages/crypto-core/Cargo.toml` (Web Worker can use WebCrypto `SHA-256` or new `crypto-core` WASM helpers) |
| Secret memory clearing | **`Zeroize`** on drop in Rust / `.fill(0)` transferable clearing in Worker TS | `zeroize = "1"` in `packages/crypto-core/Cargo.toml:67`, `apps/webmail/src/crypto_worker_ops.ts` |

> **Frozen Section 13 Invariant:** Outbound transport wrapping (`cek_outbound_wrapped`) is strictly **`HPKE-X25519-AES256GCM-v1`** using 32-byte X25519 keys (`OUTBOUND_DELIVERY_PK` / `OUTBOUND_DELIVERY_SK`). Post-quantum X-Wing MUST NOT be added to `outbound_delivery_attachments.wrap_alg` without an explicit amendment to frozen Section 13.

No new cryptographic schemes or custom modes are introduced.

---

## 3. Protocol v2 Wire Format, AAD Construction, and Domain Separation

### 3.1 Key Generation, Client Pre-Allocation & Canonical Metadata Normalization

For every newly uploaded `v=2` attachment in `mailbox_id`:

1. Client generates UUIDv4 `attachment_id` via CSPRNG (`crypto.randomUUID()`), allowing immutable AAD binding prior to upload. **Release B2 Prerequisite (`services/api/attachments.go:217`):** `POST /v1/mailboxes/{mailbox_id}/attachments` MUST accept this client-supplied UUIDv4 `attachment_id` (instead of overwriting it with `uuid.New()`), pre-reserve/check uniqueness BEFORE invoking `storage-worker /api/store` so duplicates fail with `409 Conflict` without overwriting customer storage blobs, and enforce immutability of `(filename, content_type, plaintext_size_bytes, plaintext_sha256, ciphertext_sha256)` after upload commit.
2. Client generates a fresh 256-bit random key `CEK` (`[u8; 32]`) via CSPRNG (`getrandom` in WASM / `crypto.getRandomValues` inside Web Worker). `CEK` MUST NEVER be reused across different `attachment_id`s or derived deterministically from `mailbox_sk`.
3. **Canonical Metadata Normalization Rule (Eliminating Client/Server Sanitization Divergence):**
   - `services/api/attachments.go:210-214, 364-383` currently mutates raw filenames via `sanitizeFilename()` (trims whitespace, replaces ASCII `<32`, `127`, `/`, `\`, `"`, `'`, `;` with `_`, empty -> `"attachment.bin"`) and sets empty `Content-Type` to `"application/octet-stream"`.
   - To prevent `metadata_sha256` AAD mismatches between browser and `outbound-worker`, the client MUST apply the **identical canonical normalization** to `sanitized_filename_utf8` and `mime_type_ascii` (`mediaType` lowercase ASCII via `mime.ParseMediaType` equivalent, default `"application/octet-stream"`) **BEFORE** encrypting/wrapping, send those canonical strings in the upload request, and `POST /attachments` MUST validate that server normalization leaves both fields byte-identical (rejecting non-canonical discrepancy with `400 Bad Request`).
4. Client computes `plaintext_sha256 = SHA-256(plaintext)` (32 bytes) and `plaintext_size_bytes = len(plaintext)`.

### 3.2 Encrypted Attachment Blob (`blob_ciphertext`)

- **Size Budget Tiering (Upload vs External SMTP Relay):**
  - Storage-layer single-object limit (`services/storage-worker/main.go:933`): `40 MiB` (`41,943,040` bytes ciphertext max); `POST /attachments` (`attachments.go:171, 188`) MUST raise `MaxBytesReader` overhead margin (`MAX_STORAGE_CIPHERTEXT_BYTES + 64 KiB`) so multipart framing does not reject valid ciphertext blobs at the boundary.
  - **External SMTP Path B Aggregate Outbound Plaintext Limit:** **`25 MiB` (`26,214,400` bytes)** total plaintext attachments per external SMTP email (`26,214,429 B` single ciphertext `< 40 MiB`; RFC 2045 Base64 76-char + CRLF expands `25 MiB` plaintext to **`35,872,340` bytes / `~34.21 MiB`** MIME payload, fitting beneath Amazon SES 40 MB / major MX limits and updated Postfix `message_size_limit = 52428800` [`50 MiB`]).
  - Encrypt `plaintext` with `aes_gcm_encrypt(CEK, plaintext, blob_aad)`.
  - Wire output: **`0x01 (1B) || nonce (12B CSPRNG) || ciphertext || tag (16B)`** (total size = `plaintext_size_bytes + 29` bytes; well below NIST SP 800-38D single-invocation cap of $2^{39} - 256$ bits and `N = 1` $\ll 2^{30}$ nonce limit per `docs/crypto/envelope-v1-spec.md`).
- **Canonical Binary `blob_aad` (53 bytes, constant-width big-endian):**

| Offset | Length | Field | Value / Encoding |
|---|---|---|---|
| `0..16` | 16 B | `domain_sep` | ASCII `"byos-att-blob-v2"` (`62796f732d6174742d626c6f622d7632`) |
| `16..32` | 16 B | `mailbox_id` | UUID raw 16 bytes |
| `32..48` | 16 B | `attachment_id` | UUID raw 16 bytes |
| `48..52` | 4 B | `crypto_version` | `uint32` big-endian (`0x00000002`) |
| `52..53` | 1 B | `aad_version` | `uint8` (`0x02`) |

- Client also computes `ciphertext_sha256 = SHA-256(blob_ciphertext)` (32 bytes), persisted alongside `attachments` (`ciphertext_size_bytes == size_bytes == plaintext_size_bytes + 29`) to verify object-storage integrity prior to decryption.
- **Future Multi-Chunk Extension Reserve:** If single-attachment streaming limits ever exceed 40 MiB, `crypto_version = 3` (or chunked `aad_version = 3`) MUST derive distinct per-chunk keys `K_i = HKDF-Expand(CEK, "byos-att-chunk-v3" || uint32_be(i), 32)` rather than reusing a single `CEK` across unbounded CSPRNG nonces.

### 3.3 Owner Key Wrap (`cek_owner_wrapped`) — Persisted at Upload Time

At attachment upload (`POST /v1/mailboxes/{mailbox_id}/attachments`), the browser wraps `CEK` to the mailbox owner's 32-byte X25519 public key `mailbox_pk` (`owner_key_version = mailboxes.mailbox_sk_version`, `owner_pk_sha256 = SHA-256(mailbox_pk_32b)`):

- Algorithm identifier: **`owner_wrap_alg = "HPKE-X25519-AES256GCM-v1"`** (`81 bytes` output via `hpke_seal` / `wasm_hpke_seal`). (`"HPKE-XWing-AES256GCM-v1"` is **deferred** pending a raw-AAD X-Wing WASM export targeting `mailbox_xwing_pk`.)
- **Canonical Binary `owner_wrap_aad` (53 bytes, constant-width big-endian):**

| Offset | Length | Field | Value / Encoding |
|---|---|---|---|
| `0..16` | 16 B | `domain_sep` | ASCII `"byos-att-ownr-v2"` (`62796f732d6174742d6f776e722d7632`) |
| `16..32` | 16 B | `mailbox_id` | UUID raw 16 bytes |
| `32..48` | 16 B | `attachment_id` | UUID raw 16 bytes |
| `48..52` | 4 B | `owner_key_version` | `uint32` big-endian (`mailboxes.mailbox_sk_version`) |
| `52..53` | 1 B | `crypto_version` | `uint8` (`0x02`) |

- **Cryptographic Key-Rotation Requirement (`services/api/recovery_flow.go` Defect):** Inspection of `services/api/recovery_flow.go:383-418, 1077-1098, 1428-1445` established that password-reset key regeneration and historical reactivation can currently overwrite `mailboxes.mailbox_pk` **without incrementing `mailbox_sk_version`**. While HPKE base mode already cryptographically binds `mailbox_pk` inside `ks_context`, releasing B2 **MUST**:
  1. Fix `recovery_flow.go` to atomically increment `mailbox_sk_version = mailbox_sk_version + 1` whenever `mailbox_pk` changes; AND
  2. Persist `owner_pk_sha256` (`32B`) on `attachments` so the client selects cleanly between active `mailbox_sk` and archived `previous_wrapped_sk_user` keys without trial decryption failures.
- **Property:** `cek_owner_wrapped` is stored alongside the `attachments` row. Only the mailbox user possessing the matching `mailbox_sk` can unwrap `CEK`. Neither `services/api`, `services/storage-worker`, nor `services/outbound-worker` can open `cek_owner_wrapped`.

### 3.4 Outbound Delivery Key Wrap (`cek_outbound_wrapped`) — Minted Per Delivery at Send / Schedule Time

Unlike `cek_owner_wrapped`, **`cek_outbound_wrapped` MUST NOT be generated at draft/upload time**:
- Generating `cek_outbound_wrapped` during draft upload would prematurely expose draft-only attachments to `OUTBOUND_DELIVERY_SK`, fail across `OUTBOUND_DELIVERY_SK` rotations if a draft sits for days, and prevent binding the grant to a specific send sequence.
- Instead, when the user submits **Send** (`/v1/outbound/send`) or **Schedule** (`/v1/outbound/schedule`):
  1. Client fetches `{ reservation_id, outbox_seq }` from `POST /v1/outbound/prepare`.
  2. Client obtains fresh active `{ outbound_delivery_pk, key_id, key_epoch }` from `GET /v1/outbound/pubkey`.
  3. For each attached `attachment_id`:
     - Client unwraps `CEK` in WASM/Worker from `cek_owner_wrapped` using `mailbox_sk` (or uses the live in-memory `CEK` from current compose session before zeroization).
     - Client computes canonical **Metadata Authenticity Digest (`metadata_sha256`, 32 bytes)**:
       ```text
       metadata_sha256 = SHA-256(
           "byos-att-meta-v2"                        // 16B domain tag
        || uint32_be(len(sanitized_filename_utf8))
        || sanitized_filename_utf8
        || uint32_be(len(mime_type_ascii))
        || mime_type_ascii
        || uint64_be(plaintext_size_bytes)
        || plaintext_sha256                          // 32B raw SHA-256 of plaintext
        || disposition_tag                           // 1B: 0x01=attachment, 0x02=inline
        || uint32_be(len(content_id_utf8))
        || content_id_utf8                           // empty when disposition=attachment
       )
       ```
     - Client constructs **`outbound_wrap_aad` (101 bytes, constant-width big-endian)**:

| Offset | Length | Field | Value / Encoding |
|---|---|---|---|
| `0..16` | 16 B | `domain_sep` | ASCII `"byos-att-outb-v2"` |
| `16..32` | 16 B | `mailbox_id` | UUID raw 16 bytes |
| `32..40` | 8 B | `outbox_seq` | `uint64` big-endian (from `outbound_reservations`) |
| `40..56` | 16 B | `attachment_id` | UUID raw 16 bytes |
| `56..64` | 8 B | `outbound_key_id` | First 8 bytes of `SHA-256("byos-outbound-pk-v1" \|\| outbound_pk_32b)` |
| `64..68` | 4 B | `outbound_key_epoch` | `uint32` big-endian (`>= 1`) |
| `68..69` | 1 B | `crypto_version` | `uint8` (`0x02`) |
| `69..101` | 32 B | `metadata_sha256` | Metadata & plaintext integrity digest computed above |

     - Client calls `hpke_seal(outbound_delivery_pk, CEK, outbound_wrap_aad)` (`81 bytes`), immediately zeroizes plaintext `CEK`, and submits `(attachment_id, position, disposition, content_id, wrap_alg, outbound_key_id, outbound_key_epoch, cek_outbound_wrapped, metadata_sha256)` with the `/v1/outbound/send` or `/v1/outbound/schedule` request.

### 3.5 Security Properties Enforced by Design & Trust Boundary Limits

- **Anti-Cut-and-Paste / Cross-Delivery Splice Protection:** Binding `(mailbox_id, outbox_seq, attachment_id)` in `outbound_wrap_aad` cryptographically ties `cek_outbound_wrapped` 1:1 to `outbound_queue.encrypted_message`'s canonical 29-byte AAD (`canonical_aad(mailbox_id, outbox_seq, 1)`), guaranteeing a compromised API or DB cannot replay a delivery grant from `outbox_seq = 10` into `outbox_seq = 11` or across mailboxes. *(Defense-in-depth note: while `outbound_queue.recipient` stays plaintext for Postfix routing, `outbound-worker` unwraps both the RFC 5322 headers inside `encrypted_message` and `cek_outbound_wrapped` under `(mailbox_id, outbox_seq)`; Release B2 MAY additionally assert envelope/header consistency during assembly.)*
- **Anti-Filename / MIME Type Spoofing Protection:** Because `metadata_sha256` covers exact canonical `filename`, `content_type`, `plaintext_size_bytes`, `plaintext_sha256`, `disposition`, and `content_id`, mutating `"report.pdf"` to `"report.exe"` or altering `application/pdf` to `text/html` in PostgreSQL invalidates `hpke_open` in `outbound-worker`.
- **Dual Integrity Check:** `outbound-worker` first validates AEAD authenticity via `hpke_open` + `aes_gcm_decrypt(blob_aad)`, AND independently validates `SHA-256(plaintext) == plaintext_sha256` and `len(plaintext) == plaintext_size_bytes` before MIME encoding.
- **Non-Disclosure of Customer Data at Rest:** Draft attachments without active Path B send requests carry no `cek_outbound_wrapped`. Scheduled cancellations delete `outbound_delivery_attachments` grants cleanly.

### 3.6 Deterministic Synthetic Test Vectors (Non-Secret)

All test-vector digests, framing offsets, and AES-256-GCM ciphertexts below were programmatically computed using synthetic zero-value/pattern inputs (zero real keys):

- **Inputs:**
  - `mailbox_id`: `550e8400-e29b-41d4-a716-446655440000`
  - `attachment_id`: `f47ac10b-58cc-4372-a567-0e02b2c3d479`
  - `outbox_seq`: `42`, `outbound_key_epoch`: `2`, `owner_key_version`: `1`
  - `outbound_pk_raw` (`32B` synthetic pattern): `1111111111111111111111111111111111111111111111111111111111111111`
  - `owner_pk_raw` (`32B` synthetic pattern): `2222222222222222222222222222222222222222222222222222222222222222`
  - `CEK` (`32B` synthetic pattern): `3333333333333333333333333333333333333333333333333333333333333333`
  - `nonce` (`12B` deterministic fixture): `444444444444444444444444` *(production MUST use CSPRNG)*
  - `plaintext` (`30B` UTF-8): `"BYOS-V2-ATTACHMENT-TEST-VECTOR"`
  - `filename`: `"quarterly-report.pdf"`, `content_type`: `"application/pdf"`, `disposition`: `0x01` (`attachment`), `content_id`: `""`
- **Computed Deterministic Outputs:**
  - `outbound_key_id` (`8B` prefix of `SHA-256("byos-outbound-pk-v1" || outbound_pk_raw)`): `2f85927d7d6955b4` *(full digest: `2f85927d7d6955b4d59137a44ba8f81075ecf62f5be7e6354f78627e88245062`)*
  - `owner_pk_sha256` (`32B`): `9f72ea0cf49536e3c66c787f705186df9a4378083753ae9536d65b3ad7fcddc4`
  - `plaintext_sha256` (`32B`): `10f0d751402a8f3724af9323e7b6afed3b232effea92b90e9eeb383080a47a74`
  - `metadata_sha256` (`32B`, over `104B` canonical preimage): `771f01f61c58580ad77d09bc09aacf651f2c6e69d9cc0f317f53bc467eaa4a8d`
  - `blob_aad` (`53B` hex): `62796f732d6174742d626c6f622d7632550e8400e29b41d4a716446655440000f47ac10b58cc4372a5670e02b2c3d4790000000202`
  - `owner_wrap_aad` (`53B` hex): `62796f732d6174742d6f776e722d7632550e8400e29b41d4a716446655440000f47ac10b58cc4372a5670e02b2c3d4790000000102`
  - `outbound_wrap_aad` (`101B` hex): `62796f732d6174742d6f7574622d7632550e8400e29b41d4a716446655440000000000000000002af47ac10b58cc4372a5670e02b2c3d4792f85927d7d6955b40000000202771f01f61c58580ad77d09bc09aacf651f2c6e69d9cc0f317f53bc467eaa4a8d`
  - `blob_ciphertext` (`59B = 1 + 12 + 30 + 16` hex): `0144444444444444444444444472c88bc1e750bd46e1d6f0d3b5d5873454d83cde258ceb66b30b912751b3530ad6a119598a971fcdb28dd31d2233`
  - `ciphertext_sha256` (`32B`): `c31d9319d755565ae8d3a1be2c116f0389bee1e2a6b17ddf1937f451537a11e7`

*(Note: RFC 9180 HPKE Base mode `hpke_seal` uses ephemeral X25519 randomness per invocation, producing non-deterministic `81`-byte outputs (`0x01 || enc(32) || ct+tag(48)`). Release B2 must execute cross-language WASM `wasm_hpke_seal` <-> Rust `hpke_open` roundtrip unit tests against the exact hex `owner_wrap_aad` and `outbound_wrap_aad` vectors above.)*

---

## 4. `OUTBOUND_DELIVERY_SK` Lifecycle & Key Rotation Architecture

Currently, `services/outbound-worker/src/main.rs:585-604` loads one static `[u8; 32]` from `OUTBOUND_DELIVERY_SK_FILE`, and `services/api/outbound.go:117-145` returns one unversioned `{ "outbound_delivery_pk": "..." }`. Rotating a single unversioned secret would break queued messages in `outbound_queue` (up to 7-day expiry per `services/outbound-worker/src/main.rs:814`) and pending rows in `scheduled_messages` (up to 30-day schedule horizon per `outbound.go:694`).

### 4.0 Origin Authenticity & V1 Trust Boundary (**UNRESOLVED in V1 TCB Model**)

- **`key_id` Is NOT Origin Authentication:** `key_id` (`SHA-256("byos-outbound-pk-v1" || pk)[0..8]`) is strictly a non-secret index/fingerprint to identify *which* `OUTBOUND_DELIVERY_SK` epoch should open a wrap. It provides **zero provenance guarantee** to browsers if `services/api` or `/v1/outbound/pubkey` is compromised and substitutes an attacker X25519 public key.
- **Explicit V1 Trust Boundary Assumption:** Path B external SMTP delivery inherently terminates end-to-end encryption inside the provider's SMTP gateway (`services/api` + `services/outbound-worker` TCB on Docker networks in `infra/docker-compose.yml:137, 166, 335, 346`), transmitting RFC 5322 plaintext to external MX hosts (`postfix:25`). V1 security of `OUTBOUND_DELIVERY_PK` rests on TLS transport authentication, host/container isolation, read-only secret mounts (`/run/secrets/outbound_delivery_pk`), and operational deploy control over `services/api` (`outbound_delivery_keys`).
- **Optional V2+ Hardening Path:** Add an offline-held Ed25519 **Outbound Key Authority signing key** (`signature_b64` over canonical `"byos-outbound-cert-v1" || key_epoch || key_id || outbound_pk_32b || not_before || valid_until`) embedded in `GET /v1/outbound/pubkey` and checked against a build-time pinned public key inside `apps/webmail/`. Until that offline signing ceremony is introduced, key-origin authenticity beyond TLS + host TCB remains **unauthenticated against an active `services/api` compromise** and MUST NOT be misrepresented as trustless end-to-end authentication.

### 4.1 Key Identification & State Machine

Every outbound delivery keypair is uniquely identified by BOTH:
- **`key_epoch` (`uint32 >= 1`):** Monotonic rotation generation.
- **`key_id` (8 bytes / 16 hex chars):** Fingerprint `SHA-256("byos-outbound-pk-v1" || x25519_pk_32b)[0..8]` (collision risk negligible across operational epoch counts; enforced `UNIQUE` in `outbound_delivery_keys`).

Lifecycle states:
1. **`pending`**: Keypair generated; public key staged in `outbound_delivery_keys`; secret key NOT yet rolled to all workers. Never advertised for encryption.
2. **`active`**: Exactly ONE epoch at a time. Worker decrypts; `GET /v1/outbound/pubkey` returns it as primary encryption key.
3. **`decrypt_only`**: Superseded prior epoch. Not advertised for new encryptions; rejected after short grace window (`min_accepted_wrap_epoch`) on `POST /v1/outbound/send` & `/schedule`, EXCEPT retained in `outbound-worker` keyring until all queued/scheduled deliveries wrapped under it settle.
4. **`retired`**: Secret deleted from `outbound-worker` keyring; any lingering attempt referencing it fails closed with `UnknownKeyEpoch`.

### 4.2 Distribution Boundary

- **`outbound-worker` only:** Loads secret keyring JSON `/run/secrets/outbound_delivery_keyring.json` via `OUTBOUND_DELIVERY_SK_RING_FILE` (falling back to single `OUTBOUND_DELIVERY_SK_FILE` mapped to `key_epoch = 1` for backwards-compatible bootstrap):
  ```json
  {
    "keys": [
      { "key_epoch": 2, "key_id": "9f1a...", "sk_b64": "...", "status": "active" },
      { "key_epoch": 1, "key_id": "3c08...", "sk_b64": "...", "status": "decrypt_only" }
    ]
  }
  ```
  On startup, `outbound-worker` derives `pk = x25519_public(sk)` for every non-retired entry and asserts `SHA-256("byos-outbound-pk-v1" || pk)[0..8] == key_id` (fail closed on mismatch). Keys stay strictly out of PostgreSQL, Redis, `services/api`, `storage-worker`, and frontend assets (`docs/08-v5.3-final.md` §13).
- **`services/api` public registry & endpoint:** Holds ONLY public keys (`outbound_delivery_keys` table / `OUTBOUND_DELIVERY_PK_RING_FILE`).
  `GET /v1/outbound/pubkey` remains backward-compatible for `apps/webmail/src/api.ts:159` and `services/api/bridge.go:538`:
  ```json
  {
    "outbound_delivery_pk": "<base64_active_32b_pk>",
    "key_id": "9f1a...",
    "key_epoch": 2,
    "algorithm": "HPKE-X25519-AES256GCM-v1",
    "valid_until": "2027-02-01T00:00:00Z",
    "min_accepted_epoch": 1
  }
  ```
  Response headers include `Cache-Control: public, max-age=300, must-revalidate`.

### 4.3 Client Caching, Pinning & Rotation Protocol (Zero-Disruption Cutover)

1. **Pre-Stage New Key (`T - 1h`):** Generate epoch `E+1` off-host (`byos-crypto-client generate`). Deploy updated `/run/secrets/outbound_delivery_keyring.json` containing `(E: active, E+1: decrypt_only)` to ALL `outbound-worker` replicas and verify health.
2. **Cutover API Advertising (`T = 0`):** Update `api` public key config / `outbound_delivery_keys` to mark `E+1` as `active`, `E` as `decrypt_only`, keeping `min_accepted_epoch = E` for a 60-minute overlap window (covers cached browser sessions & slow offline replays). Also update `outbound-worker` keyring status of `E` -> `decrypt_only`, `E+1` -> `active`.
3. **Grace Window Close (`T + 60m`):** Set `api` `min_accepted_epoch = E+1`. Any client holding a stale cached `E` public key receives HTTP `409 Conflict`:
   ```json
   {
     "error": "outbound_key_epoch_expired",
     "min_accepted_epoch": 2,
     "current_key": { "outbound_delivery_pk": "...", "key_id": "...", "key_epoch": 2, "algorithm": "HPKE-X25519-AES256GCM-v1" }
   }
   ```
   Client clears its in-memory pubkey cache, re-wraps `cek_outbound_wrapped` from `cek_owner_wrapped` using `current_key` (`E+1`), re-encrypts `send_token_wrapped` for the reservation/new sequence, and retries automatically — **no attachment blob re-upload required**.
4. **Epoch Drain & Safe Retirement (`T >= drain`):**
   - `outbound-worker` selects the decryption secret directly by `(outbound_key_epoch, outbound_key_id)` stored in `outbound_delivery_attachments` (and `send_token_key_epoch` / `send_token_key_id` on `outbound_queue` / `scheduled_messages`, defaulting `NULL` pre-B1 rows to `epoch = 1`) — **no blind trial decryption**.
   - **Recommended Routine Cadence:** Rotate every 90 days. Retain `decrypt_only` SK `E` until ALL non-terminal references drain:
     ```sql
     SELECT
       (SELECT count(*) FROM outbound_queue oq
        LEFT JOIN outbound_delivery_attachments oda ON oda.delivery_id = oq.delivery_id
        WHERE oq.status IN ('pending', 'accepted_by_mta')
          AND (COALESCE(oq.send_token_key_epoch, 1) <= $1 OR oda.outbound_key_epoch <= $1))
       +
       (SELECT count(*) FROM scheduled_messages sm
        LEFT JOIN outbound_delivery_attachments oda ON oda.delivery_id = sm.delivery_id
        WHERE sm.status = 'pending' AND sm.is_path_a = false
          AND (COALESCE(sm.send_token_key_epoch, 1) <= $1 OR oda.outbound_key_epoch <= $1))
       AS remaining_active_epoch_refs;
     ```
     Once `remaining_active_epoch_refs = 0`, transition `E` to `retired` and purge `sk_E` from secrets.
5. **Emergency Rotation (Compromised `OUTBOUND_DELIVERY_SK`):**
   - Immediately promote `E+1` on workers & API, set `min_accepted_epoch = E+1`, and mark `E` as `retired` immediately on workers (cease decryption under `E`).
   - Pending `scheduled_messages` / `outbound_queue` items sealed solely under compromised `E` transition cleanly to `status = 'failed'` with structured code `key_epoch_revoked`; because the user still holds `draft_storage_ref` and `cek_owner_wrapped` in `attachments`, the webmail client lets the user re-submit using `E+1` on next unlock.

---

## 5. Legacy `v=1` Attachment Compatibility & Client-Side Upgrade Strategy

1. **Backend Zero-Knowledge Constraint:** Existing `attachments` rows (`crypto_version = 1`) encrypted with `mailbox_sk` MUST NEVER be decrypted or migrated by PostgreSQL triggers, `api`, or background workers. Server-side backfill of `cek_outbound_wrapped` for `v=1` is mathematically impossible without breaking zero-knowledge guarantees.
2. **Legacy Behavior Preserved:**
   - Reading/downloading `v=1` attachments on Inbox, Sent, and Draft items continues identically using `decryptAttachmentBytes` (`apps/webmail/src/api.ts:983`).
   - Legacy `v=1` rows remain `crypto_version = 1` with `cek_owner_wrapped = NULL` and are excluded from `v=2` non-null constraints.
3. **Client-Side Lazy Upgrade (No Bulk Re-Encryption Blocking):**
   - When the browser sends externally (or schedules) an email containing any attachment whose `crypto_version !== 2` (e.g., an older saved draft uploaded before Release B2 or a forwarded legacy attachment):
     - Pre-send orchestration downloads the `v=1` ciphertext while `mailbox_sk` is unlocked, decrypts in the Web Worker (`opDecrypt...`), generates a fresh 256-bit `CEK`, uploads a new `v=2` attachment object (`crypto_version = 2` + `cek_owner_wrapped`), replaces the old `attachment_id` in the draft / send payload (without modifying immutable historical Sent/Received message records!), and wraps `cek_outbound_wrapped` normally.
   - Similarly, opening a Draft with `v=1` attachments while unlocked opportunistically upgrades its draft attachment link to `v=2`.
   - `services/api` rejects any `/v1/outbound/send` or `/v1/outbound/schedule` request referencing a `crypto_version = 1` `attachment_id` with HTTP `422 Unprocessable Entity` (`{"error":"attachment_v2_upgrade_required","attachment_ids":[...]}`), enforcing fail-closed validation.
   - Any pre-B2 `scheduled_messages` rows whose `attachment_ids` lacked `outbound_delivery_attachments` grants fail safely with `"legacy attachment lacks v2 outbound grant"`.
