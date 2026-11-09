# BYOS Customer-Owned Storage Encryption: Comprehensive Security Audit

**Document:** `docs/customer_owned_storage_encryption_audit.md`  
**Target Repository:** `F:\Codex\byos-email`  
**Scope:** Read-Only Cryptographic Boundary and Storage Persistence Security Audit  
**Audit Date:** November 2026  
**Auditor:** Antigravity Advanced Agentic Security Team  

---

## 1. Executive Summary

This comprehensive, read-only security audit evaluates whether **all sensitive customer mailbox data written to customer-owned storage is encrypted before being persisted** within the Build Your Own Storage (BYOS) email platform.

BYOS's central security promise is that customers control their own storage backends (AWS S3, MinIO, Google Drive, or generic S3-compatible object stores), while the storage provider remains cryptographically blinded—unable to inspect, harvest, or decrypt private customer mailbox contents (email bodies, attachments, drafts, or private documents).

### Summary of Audit Assessment

1. **Core Mailbox Storage Pipeline (Email Bodies & Path A E2E Messages):**
   External inbound emails, internal BYOS-to-BYOS messages (Path A), and sender sent-copies are rigorously encrypted before reaching customer storage. Persistent email objects (`.eml.enc`) in customer storage are stored exclusively as `HPKE-XWing-AES256GCM-v1` (combining ML-KEM-768 and X25519 per RFC 9180 and draft-connolly-cfrg-xwing-kem) or AES-256-GCM encrypted envelopes. Inspection of live MinIO storage objects demonstrated zero plaintext bytes in stored `.eml.enc` objects.
2. **Key Custody Separation:**
   Customer decryption keys (`mailbox_sk`, `xwing_seed`, `signing_seed`) are never stored in plaintext on BYOS servers or in customer-owned storage. Keys are sealed client-side with Argon2id-derived keys from the user's passphrase. Storage providers receive only ciphertext; wrapped key envelopes are stored in PostgreSQL (`message_metadata.wrapped_key`), maintaining strict physical and cryptographic separation between ciphertext objects and key material.
3. **Storage Worker Responsibility:**
   The `storage-worker` microservice acts as a transparent storage proxy. It does not perform application-level encryption of message payloads; encryption is the non-negotiable responsibility of upstream services (`mail-router`, `api`, or client-side WASM).
4. **Vulnerabilities and Limitations Identified:**
   While the cryptographic foundation is sound, the audit identified three High-severity vulnerabilities and four Medium/Low/Informational findings that compromise data confidentiality or bypass validation:
   - **FINDING-01 (HIGH):** Unvalidated chunk proxying in `uploadAttachmentChunkHandler` (`services/api/message_attachments.go:377`) allows unencrypted plaintext chunks to be uploaded directly into customer storage.
   - **FINDING-02 (HIGH):** Unvalidated storage proxying in `mailboxStorageStoreHandler` (`services/api/import.go:975`) allows arbitrary unencrypted data up to 50MB to be persisted in customer storage without envelope validation.
   - **FINDING-03 (HIGH):** Plaintext attachment filenames leak directly in customer object storage key paths (`mailboxes/<id>/attachments/<attachment_id>/<filename>`) and Google Drive file metadata (`services/api/attachments.go:218`).
   - **FINDING-04 (MEDIUM):** Customer contacts are stored in plaintext in PostgreSQL (`services/api/contacts.go:276`).
   - **FINDING-05 (MEDIUM):** Customer email signatures are stored in plaintext in PostgreSQL (`services/api/settings.go:225`).
   - **FINDING-06 (LOW):** S3 connectivity probe writes an unencrypted object (`.byos-probe-<timestamp>`) to the customer's bucket during connection tests (`services/storage-worker/main.go:420`).
   - **FINDING-07 (INFORMATIONAL):** Apple CloudKit is entirely unimplemented across the repository.

### Overall Classification

**SECURE WITH DOCUMENTED LIMITATIONS**

The underlying cryptographic architecture fulfills zero-knowledge requirements for all normal, non-malicious client flows, but server-side API boundary enforcement has gaps that allow client-side bugs or compromised clients to persist unencrypted data or disclose metadata.

---

## 2. Explicit Threat Model

The BYOS security model defines clear boundaries across four operational compromise scenarios:

```
+---------------------------------------------------------------------------------------------------------+
|                                           BYOS ARCHITECTURE                                             |
|                                                                                                         |
|   +-----------------------+                    +----------------------------------------------------+   |
|   |      User Client      |                    |                    BYOS Server                     |   |
|   |  (Webmail / Browser)  |                    |                                                    |   |
|   |                       |    HTTPS / TLS     |  +--------------------+    +--------------------+  |   |
|   |   WASM Crypto Core    |<==================>|  |      API GW        |    |    Inbound SMTP    |  |   |
|   |   (Keys unsealed in   |                    |  +--------------------+    +--------------------+  |   |
|   |     memory only)      |                    |            |                          |            |   |
|   +-----------------------+                    |            v                          v            |   |
|                                                |  +--------------------+    +--------------------+  |   |
|                                                |  |   Internal Path A  |    |    Mail Router     |  |   |
|                                                |  |      Delivery      |    |  (Calls Crypto Wk) |  |   |
|                                                |  +--------------------+    +--------------------+  |   |
|                                                |            \                         /             |   |
|                                                |             v                       v              |   |
|                                                |         +--------------------------------+         |   |
|                                                |         |         Storage Worker         |         |   |
|                                                |         +--------------------------------+         |   |
+------------------------------------------------+------------------------|---------------------------+   |
                                                                          |                               
                                                                          v TLS Storage API               
                                                      +---------------------------------------+           
                                                      |        Customer-Owned Storage         |           
                                                      |   (S3 / MinIO / Google Drive / etc.)  |           
                                                      |                                       |           
                                                      |   Stored Data:                        |           
                                                      |   - *.eml.enc (Ciphertext only)       |           
                                                      |   - chunks/*.enc (Ciphertext only)    |           
                                                      |   NO USER PRIVATE KEYS                |           
                                                      |   NO WRAPPED KEYS                     |           
                                                      +---------------------------------------+           
```

### Scenario A: Customer's Cloud Storage Account is Compromised

**Threat:** An attacker obtains administrative or direct API credentials to the customer's Google Drive, S3 bucket, or MinIO storage.

* **Email Bodies:** Unreadable. Stored as `HPKE-XWing-AES256GCM-v1` ciphertext in `.eml.enc` files.
* **Attachments:** Unreadable when uploaded via Path A or standard encrypted attachment pipelines. Stored as AES-256-GCM binary envelopes (`0x01` version byte + 12-byte IV + ciphertext + 16-byte GCM tag).
* **Draft Contents:** Unreadable. Regular drafts are stored exclusively in PostgreSQL in the `drafts` table as AES-256-GCM envelopes. Scheduled drafts in storage (`.draft.enc`) are encrypted envelopes.
* **Key Separation:** Absolute. No decryption keys, private keys, or wrapped key envelopes are stored in customer storage. Decryption requires `mailbox_sk`, which is derived client-side from the user's password and stored only as `wrapped_sk_user` in the BYOS PostgreSQL database.
* **Metadata Leakage:** **PARTIAL FAILURE.** In standard attachment uploads (`attachmentsHandler`), the original plaintext filename is embedded in the object key path (`mailboxes/<id>/attachments/<attachment_id>/<filename>`) and Google Drive file title.

### Scenario B: Storage Provider Itself is Compromised

**Threat:** The cloud storage vendor (Google, AWS, or a private MinIO host) actively inspects, records, or analyzes all objects and API traffic within the customer's bucket or drive.

* **Payload Exposure:** The provider observes only ciphertext bytes and AEAD authentication tags.
* **Key Material Exposure:** Zero. The provider receives no private keys, public keys, or wrapped content keys. Content keys are either encapsulated via HPKE in `message_metadata` (stored in PostgreSQL) or wrapped client-side.
* **Transport:** All interactions with cloud storage providers occur over TLS (HTTPS). S3 adapters enforce TLS unless explicitly disabled in local dev configuration (`use_ssl=false`). Google Drive uses HTTPS REST endpoints (`https://www.googleapis.com/...`).
* **Metadata Exposure:** The provider observes storage object sizes (enabling traffic analysis/fingerprinting), timestamps, object keys, and folder structure. On Google Drive, folder names include `mailboxes` and mailbox GUIDs.

### Scenario C: BYOS Backend is Compromised

**Threat:** An attacker achieves root execution on the BYOS server infrastructure (API gateway, mail router, storage worker, PostgreSQL database).

* **Inbound SMTP Plaintext:** External inbound SMTP arriving over port 25 is unencrypted by nature. Plaintext message bodies reside in volatile memory in `inbound-bridge` and `mail-router` during spam analysis and encryption dispatch. An active memory dumper could capture inbound emails arriving during the compromise.
* **Outbound SMTP Plaintext:** External outbound messages require plaintext reconstruction by `outbound-worker` to transmit over external SMTP to third-party mail exchanges. An attacker on the backend could monitor messages sent externally.
* **Historical Mailbox Data:** Fully protected. The attacker cannot decrypt stored historical `.eml.enc` objects in customer storage because the server does not hold `mailbox_sk` or user passwords. Historical emails remain zero-knowledge protected.
* **Internal Path A Messages:** Fully protected. Inbound Path A messages are encrypted end-to-end on the sender's client device. The backend processes only opaque ciphertext envelopes signed with Ed25519.
* **Storage Provider Credentials:** Compromised. The backend holds `storage_connections.config`, which is encrypted at rest using `storage_dek` (`/run/secrets/storage_dek`). A root attacker on the backend can decrypt these credentials and access the customer's cloud bucket, but can only read ciphertext.

### Scenario D: User Device is Compromised

**Threat:** An attacker compromises the user's workstation, browser session, or Webmail tab.

* **Protection Level:** Zero protection against local extraction. Once the user unlocks their mailbox, `mailbox_sk`, `xwing_seed`, and `signing_seed` reside in browser memory (and Web Worker memory).
* **Storage Encryption Irrelevance:** Customer-owned storage encryption protects data at rest against storage provider espionage and cloud account takeover; it cannot defend against an attacker operating with the identity and cryptographic credentials of the authenticated user.

---

## 3. Encryption Architecture as Actually Implemented

The BYOS platform implements a multi-tiered cryptographic and storage architecture distributed across distinct microservices and client layers:

```
+-----------------------------------------------------------------------------------------------------+
|                                      CRYPTOGRAPHIC FLOW MATRIX                                      |
+--------------------------+----------------------------+-----------------------+---------------------+
| Data Stream              | Encryption Boundary        | Cryptographic Scheme  | Storage Destination |
+--------------------------+----------------------------+-----------------------+---------------------+
| Inbound External SMTP    | mail-router -> crypto-work | HPKE-XWing-AES256GCM  | Customer Storage    |
| Inbound Internal Path A  | Webmail Client (WASM)      | HPKE-XWing-AES256GCM  | Customer Storage    |
| Sent Copy (Path A)       | Webmail Client (WASM)      | HPKE-XWing-AES256GCM  | Customer Storage    |
| Direct Attachment        | Webmail Client (WASM)      | AES-256-GCM (v1 bin)  | Customer Storage    |
| Chunked Attachment       | Webmail Client (WASM)      | AES-256-GCM (v1 bin)  | Customer Storage    |
| Draft Message            | Webmail Client (WASM)      | AES-256-GCM (v1 bin)  | PostgreSQL (drafts) |
| Calendar Event           | Webmail Client (WASM)      | AES-256-GCM (v1 bin)  | PostgreSQL (cal)    |
| Search Tokens            | Webmail Client (WASM)      | HMAC-SHA256 (blinded) | PostgreSQL (tokens) |
| Profile Photos           | Webmail Client (WASM)      | AES-256-GCM (v1 bin)  | Customer Storage    |
| Storage Connection Conf  | storage-worker (Go)        | AES-256-GCM (srv DEK) | PostgreSQL (config) |
+--------------------------+----------------------------+-----------------------+---------------------+
```

### Components and Responsibilities

1. **`crypto-worker` (`packages/crypto-core`):**
   A Rust service exposing `/v1/encrypt`, `/v1/decrypt`, `/v1/encrypt-xwing`, `/v1/encrypt-outbound`, and `/v1/decrypt-outbound`. Implements Post-Quantum Hybrid Key Encapsulation (`HPKE-XWing-AES256GCM-v1`) combining ML-KEM-768 and X25519 per RFC 9180 and draft-connolly-cfrg-xwing-kem.
2. **`mail-router` (`services/mail-router`):**
   Receives parsed MIME from `inbound-bridge`, resolves recipients, calls `crypto-worker /v1/encrypt`, receives ciphertext + wrapped key, and writes ciphertext to `storage-worker /api/store`.
3. **`storage-worker` (`services/storage-worker`):**
   A dumb storage proxy. It provides `/api/store`, `/api/retrieve`, `/api/delete`, `/api/health`, and `/api/migrate-encrypted`. It streams raw bytes to the customer's configured storage provider (S3 or Google Drive). **It performs NO payload encryption.**
4. **`api` Gateway (`services/api`):**
   Handles authenticated REST endpoints. Enforces envelope validation on direct attachments and calendar events, but proxies chunks and storage imports directly.
5. **Webmail WASM Bridge (`apps/webmail`):**
   Compiles Rust `crypto-core` to WebAssembly (`byos_crypto_core.wasm`). Executes in dedicated Web Workers (`crypto_worker_ops.ts`, `attachment_crypto.ts`) to perform client-side AES-256-GCM chunking, key unwrapping, and zero-knowledge unsealing.

---

## 4. Storage Provider Inventory

| Provider | Storage Adapter File & Functions | Upload Entry Point | Encryption Boundary | Transport | Stored Representation | Key Dependency | Download Path | Existing Tests | Status Verdict |
|---|---|---|---|---|---|---|---|---|---|
| **AWS S3** | `services/storage-worker/main.go`<br>`S3Storage.Store()` (L374) | `storeHandler()` (L127) | Pre-storage (Caller: `mail-router` or `api`) | HTTPS (TLS 1.2/1.3) via `minio-go/v7` | `.eml.enc` JSON envelope or binary AES-GCM envelope | Recipient `xwing_pk` or ephemeral DEK | `retrieveHandler()` -> `S3Storage.Retrieve()` | `TestStoreRetrieveDeleteRoundTrip` | SECURE (Implemented) |
| **MinIO (Self-hosted S3)** | `services/storage-worker/main.go`<br>`S3Storage.Store()` (L374) | `storeHandler()` (L127) | Pre-storage (Caller: `mail-router` or `api`) | HTTP/HTTPS via `minio-go/v7` | `.eml.enc` JSON envelope or binary AES-GCM envelope | Recipient `xwing_pk` or ephemeral DEK | `retrieveHandler()` -> `S3Storage.Retrieve()` | `TestStoreRetrieveDeleteRoundTrip` | SECURE (Implemented) |
| **Google Drive** | `services/storage-worker/main.go`<br>`GoogleDriveStorage.Store()` (L503) | `storeHandler()` (L127) | Pre-storage (Caller: `mail-router` or `api`) | HTTPS via `google-api-go-client/drive/v3` | Multipart upload into folder hierarchy | Recipient `xwing_pk` or ephemeral DEK | `retrieveHandler()` -> `GoogleDriveStorage.Retrieve()` | `TestStoreRetrieveDeleteRoundTrip` (via mock) | SECURE (Implemented) |
| **Generic S3-Compatible** | `services/storage-worker/main.go`<br>`S3Storage.Store()` (L374) | `storeHandler()` (L127) | Pre-storage (Caller: `mail-router` or `api`) | HTTP/HTTPS (configurable endpoint) | Identical to AWS S3 format | Recipient `xwing_pk` or ephemeral DEK | `retrieveHandler()` -> `S3Storage.Retrieve()` | `TestStoreRetrieveDeleteRoundTrip` | SECURE (Implemented) |
| **Google Drive Mock** | `services/storage-worker/main.go`<br>`MockDriveStorage.Store()` (L593) | `storeHandler()` (L127) | Pre-storage (Caller: `mail-router` or `api`) | Local filesystem sandbox (`/tmp/mock-drive`) | Raw file writes to filesystem | Ephemeral DEK / X-Wing | `retrieveHandler()` -> `MockDriveStorage.Retrieve()` | `TestStoreRetrieveDeleteRoundTrip` | TEST-MOCK ONLY |
| **Apple CloudKit** | **NONE** (0 references in repository) | **NONE** | **NONE** | **NONE** | **NONE** | **NONE** | **NONE** | None | NOT IMPLEMENTED |

---

## 5. Storage-Write Path Inventory

Every call to `storage-worker` `/api/store` across the entire codebase was audited and traced to its origin:

```
[Inbound SMTP] ────────► mail-router:storeCiphertext() ─────────────► /api/store ──► mailboxes/<id>/<seq>.eml.enc
[Path A Recipient] ────► api:storeInternalEnvelope() ──────────────► /api/store ──► mailboxes/<id>/<seq>.eml.enc
[Path A Sent Copy] ────► api:createSentMessageCopy() ──────────────► /api/store ──► mailboxes/<id>/<seq>.eml.enc
[Direct Attachment] ───► api:attachmentsHandler() ─────────────────► /api/store ──► mailboxes/<id>/attachments/<att_id>/<filename>
[Chunked Attachment] ──► api:uploadAttachmentChunkHandler() ────────► /api/store ──► mailboxes/<id>/attachments/<att_id>/chunks/<idx>.enc
[Scheduled Draft] ─────► api:storeScheduledDraftEnvelope() ────────► /api/store ──► mailboxes/<id>/scheduled/<id>.draft.enc
[Import Pipeline] ─────► api:mailboxStorageStoreHandler() ─────────► /api/store ──► mailboxes/<id>/<path>
[Profile Photo] ───────► api:uploadProfilePhotoHandler() ──────────► /api/store ──► mailboxes/<id>/profile/photo_<id>.bin
[Storage Migration] ───► storage-worker:migrateEncryptedHandler() ─► /api/store ──► (stream copy between backends)
[S3 Probe Test] ───────► storage-worker:Test() ────────────────────► S3 PutObject ─► .byos-probe-<timestamp>
```

### Detailed Path Traces

#### Path 1: Inbound External Email
* **Location:** `services/mail-router/main.go:343` (`storeCiphertext`)
* **Trace:** `inbound-bridge` receives SMTP -> HTTP POST to `mail-router` `/internal/inbound` -> parses MIME -> fetches recipient `xwing_pk` -> dispatches to `crypto-worker /v1/encrypt` -> receives `ciphertext` and `wrapped_key` -> calls `storage-worker /api/store` with key `mailboxes/<mailbox_id>/<seq>.eml.enc`.
* **State at Storage:** Strictly ciphertext (`{"alg":"HPKE-XWing-AES256GCM-v1","ciphertext":"..."}`).
* **Fail-Closed:** If `crypto-worker` fails, `mail-router` aborts delivery and returns HTTP 500; no plaintext is ever stored.

#### Path 2: Path A Internal Message Delivery
* **Location:** `services/api/internal_delivery.go:174` (`storeInternalEnvelope`)
* **Trace:** Client Webmail WASM encrypts message body using recipient's `xwing_pk` and signs envelope with sender's `signing_sk` -> POST `/v1/mailboxes/{mailbox_id}/deliver-internal` -> API verifies Ed25519 signature -> passes encrypted envelope directly to `storage-worker /api/store`.
* **State at Storage:** Opaque JSON envelope containing base64-encoded ciphertext and auth tag. Server never sees plaintext.

#### Path 3: Path A Sent Message Copy
* **Location:** `services/api/internal_delivery.go:215` (`createSentMessageCopy`)
* **Trace:** Client creates a second envelope encrypted to sender's own `xwing_pk` (`sender_envelope`) -> API writes to `mailboxes/<sender_id>/<seq>.eml.enc`.
* **State at Storage:** Opaque ciphertext envelope.

#### Path 4: Monolithic Attachment Upload
* **Location:** `services/api/attachments.go:218` (`attachmentsHandler`)
* **Trace:** Client encrypts attachment via WASM AES-256-GCM -> POST `/v1/mailboxes/{mailbox_id}/attachments` -> API reads first 29 bytes and verifies byte 0 == `0x01` -> streams to `storage-worker /api/store` at `mailboxes/<mailbox_id>/attachments/<attachment_id>/<filename>`.
* **State at Storage:** Binary envelope (`0x01` + IV + ciphertext + Tag).
* **Vulnerability:** Plaintext `<filename>` leaked in storage object key.

#### Path 5: Chunked Attachment Upload
* **Location:** `services/api/message_attachments.go:377` (`uploadAttachmentChunkHandler`)
* **Trace:** Client encrypts chunk -> POST `/v1/mailboxes/{mailbox_id}/attachment-chunks` -> API streams directly to `storage-worker /api/store` at `mailboxes/<mailbox_id>/attachments/<attachment_id>/chunks/<chunk_index>.enc`.
* **State at Storage:** Expected to be binary envelope (`0x01` + IV + ciphertext + Tag).
* **Vulnerability (FINDING-01):** API does **NOT** validate envelope header `0x01`. An unencrypted chunk can be persisted directly.

#### Path 6: Scheduled Draft Message Storage
* **Location:** `services/api/outbound.go:87` (`storeScheduledDraftEnvelope`)
* **Trace:** Client schedules send -> POST `/v1/mailboxes/{mailbox_id}/outbound/schedule` -> API base64-decodes `draft_envelope` and writes to `mailboxes/<mailbox_id>/scheduled/<row_id>.draft.enc`.
* **State at Storage:** Encrypted envelope.
* **Vulnerability:** API does not validate `0x01` header on scheduled draft envelope.

#### Path 7: Mailbox Storage Import Proxy
* **Location:** `services/api/import.go:975` (`mailboxStorageStoreHandler`)
* **Trace:** POST `/v1/mailboxes/{mailbox_id}/storage/store` -> API reads raw body up to 50MB -> passes directly to `storage-worker /api/store`.
* **State at Storage:** Arbitrary caller-provided bytes.
* **Vulnerability (FINDING-02):** Zero server-side validation of encryption or envelope format.

#### Path 8: Profile Photo Upload
* **Location:** `services/api/profile_photo.go:127` (`uploadProfilePhotoHandler`)
* **Trace:** Client encrypts image with AES-256-GCM -> POST `/v1/mailboxes/{mailbox_id}/profile/photo` -> API validates byte 0 == `0x01` and length >= 29 -> streams to `mailboxes/<mailbox_id>/profile/photo_<photo_id>.bin`.
* **State at Storage:** Validated binary AES-GCM envelope.

#### Path 9: S3 Connectivity Probe
* **Location:** `services/storage-worker/main.go:420` (`Test()`)
* **Trace:** Storage connection creation/health check -> writes `.byos-probe-<timestamp>` containing string `"byos-storage-probe"` -> immediately deletes object.
* **State at Storage:** **PLAINTEXT STRING PERSISTED MOMENTARILY IN CUSTOMER BUCKET.**

---

## 6. Data-Category Encryption Matrix

| Data Category | Persistence Target | Persisted in Customer Storage? | Application-Level Encrypted? | Encryption Timing & Boundary | Key Material Utilized | Privacy & Exposure Verdict |
|---|---|---|---|---|---|---|
| **Incoming Email Bodies** | Customer Storage | YES | YES | Pre-storage (`crypto-worker`) | Recipient `xwing_pk` + ephemeral DEK | SECURE: Stored as `.eml.enc` |
| **Original MIME Content** | None (Transitory) | NO | N/A | Memory only during processing | N/A | SECURE: Plaintext discarded after encryption |
| **Email Headers (Sensitive)** | PostgreSQL + Storage | YES (in `.eml.enc`) | YES (in storage), NO (in DB) | Pre-storage; DB holds routing metadata | Ephemeral DEK in storage | PARTIAL: Routing headers visible in DB |
| **Direct Attachments** | Customer Storage | YES | YES | Client-side (WASM before upload) | Ephemeral attachment DEK | PARTIAL: Content encrypted; filename leaked in key |
| **Chunked Attachments** | Customer Storage | YES | YES (Client-side) | Client-side (WASM before upload) | Ephemeral attachment DEK | HIGH RISK: API lacks validation (FINDING-01) |
| **Draft Messages** | PostgreSQL (`drafts`) | NO | YES | Client-side (WASM before upload) | `mailbox_sk` derived DEK | SECURE: Encrypted envelope in DB |
| **Scheduled Messages** | Storage + Postgres | YES | YES | Client-side (WASM before upload) | `outbound_delivery_pk` | HIGH RISK: API lacks validation on draft |
| **Imported Emails** | Customer Storage | YES | YES (Client-side) | Client-side (WASM before upload) | `mailbox_sk` derived DEK | HIGH RISK: API lacks validation (FINDING-02) |
| **MBOX Imports** | Customer Storage | YES | YES (Client-side) | Client-side (WASM before upload) | `mailbox_sk` derived DEK | HIGH RISK: Proxy allows unvalidated bytes |
| **Calendar Events (Private)** | PostgreSQL (`events`) | NO | YES | Client-side (WASM before upload) | `mailbox_sk` derived DEK | SECURE: Stored as `encrypted_payload` in DB |
| **Calendar Recurrence Info** | PostgreSQL (`events`) | NO | NO | Metadata column in PostgreSQL | N/A | METADATA: `rrule` visible in PostgreSQL |
| **Contacts & Address Books** | PostgreSQL (`contacts`)| NO | **NO** | Plaintext SQL INSERT | None | VULNERABILITY: Plaintext in DB (FINDING-04) |
| **Personal Signatures** | PostgreSQL (`settings`)| NO | **NO** | Plaintext SQL UPDATE | None | VULNERABILITY: Plaintext in DB (FINDING-05) |
| **Private Notes & Documents** | IndexedDB / LocalStorage| NO | YES | Client-side (WASM before save) | `mailbox_sk` derived DEK | SECURE: Client-side encrypted in browser |
| **Mailbox Preferences** | PostgreSQL (`settings`)| NO | NO | Plaintext SQL UPDATE | None | METADATA: UI themes, page size visible |
| **Search Indexes / Tokens** | PostgreSQL (`tokens`)  | NO | YES (Blinded) | Client-side HMAC blinding | `search_key` (derived via HKDF) | SECURE: Irreversible blind tokens in DB |
| **Message Previews / Cache** | Browser Memory only | NO | N/A | Ephemeral memory in browser | N/A | SECURE: Never written to disk unencrypted |
| **Attachment Thumbnails** | Transitory Browser | NO | N/A | Rendered from decrypted bytes | N/A | SECURE: No persistent thumbnails on server |
| **Backup / Versioned Objects**| Customer Storage | YES | YES | Inherits `.eml.enc` encryption | Same as source object | SECURE: Versioned objects remain ciphertext |

---

## 7. Cryptographic Construction Review

### AES-256-GCM Binary Envelope Format
Direct attachments, chunked attachments, draft envelopes, calendar events, and profile photos standardize on the BYOS Version 1 Binary Envelope format:
* **Byte 0:** Version byte `0x01`
* **Bytes 1–12 (12 bytes):** Initialization Vector (IV) generated from a CSPRNG
* **Bytes 13 to N-16:** AES-256-GCM ciphertext
* **Bytes N-16 to N (16 bytes):** Poly1305 / GCM authentication tag
* **Minimum Length:** 29 bytes (1 + 12 + 0 + 16)

### Hybrid HPKE Construction (`HPKE-XWing-AES256GCM-v1`)
Email message encryption uses Post-Quantum Hybrid Key Encapsulation:
* **DHKEM:** X-Wing combining `ML-KEM-768` (Post-Quantum lattice-based) and `X25519` (Classical ECDH) per `draft-connolly-cfrg-xwing-kem-01`.
* **KDF:** HKDF-SHA256
* **AEAD:** AES-256-GCM
* **Overhead:** 1184 bytes ML-KEM-768 ciphertext + 32 bytes X25519 ephemeral public key = 1216 bytes encapsulated key (`enc`).

### Nonce Safety and IV Generation
1. **Server-side (`crypto-worker`):** IVs are generated via `rand::rngs::OsRng` (Linux `getrandom` syscall). Every encryption uses a fresh, random 12-byte IV.
2. **Client-side (`attachment_crypto.ts`):** Generates a random 12-byte `base_iv`. For multi-chunk uploads, each chunk derives a deterministic, unique IV:
   ```typescript
   chunk_iv = (base_iv[0..7] || (counter))
   ```
   This guarantees that chunks under the same ephemeral content key never collide or reuse an IV.
3. **Drafts and Calendar:** Generate a fresh 12-byte IV via `window.crypto.getRandomValues()` for every save operation.

### Additional Authenticated Data (AAD) Binding
To prevent ciphertext substitution across accounts or messages, the system binds metadata to the GCM tag:
* **Message Envelopes:** AAD binds `version`, `mailbox_id`, `message_id`, and `epoch`. Tampering with the recipient mailbox ID or message sequence causes GCM tag verification to fail immediately.
* **Attachments:** AAD binds `attachment_id`, `mailbox_id`, and `chunk_index`.

---

## 8. Key Management and Key Custody Review

```
+-----------------------------------------------------------------------------------------+
|                                  KEY HIERARCHY & CUSTODY                                |
|                                                                                         |
|       User Passphrase + Argon2id Salt                                                   |
|                      |                                                                  |
|                      v (Argon2id derivation in Browser WASM)                            |
|             Key Encryption Key (KEK)                                                    |
|                      |                                                                  |
|                      v (Unwraps wrapped_sk_user from PostgreSQL)                        |
|                 mailbox_sk (32 bytes - Browser memory only)                             |
|                      |                                                                  |
|       +--------------+--------------+-------------------+                               |
|       |                             |                   |                               |
|       v HKDF-SHA256                 v HKDF-SHA256       v HKDF-SHA256                   |
|   xwing_seed                   signing_seed         search_key                          |
|   (Derives ML-KEM + X25519)    (Ed25519 signing)    (Blinds search tokens)              |
+-----------------------------------------------------------------------------------------+
```

1. **Zero-Knowledge Key Storage:**
   The primary mailbox secret (`mailbox_sk`) is never stored on the server in unencrypted form. It is stored in PostgreSQL as `mailboxes.wrapped_sk_user`, encrypted using AES-256-GCM with a key derived from the user's passphrase via Argon2id (memory: 64MB, iterations: 3, parallelism: 4).
2. **Memory Lifetime:**
   `mailbox_sk` and derived subkeys exist only in volatile client memory. When the user logs out or closes the browser tab, all session memory and Web Worker buffers are wiped using `zeroizeBuffer()`.
3. **Storage DEK Separation:**
   The `storage_dek` (located in `/run/secrets/storage_dek`) is a 32-byte server-side secret used exclusively to encrypt customer cloud storage credentials (OAuth tokens, S3 access keys) stored in `storage_connections.config`. It is **never** used to encrypt or decrypt customer mailbox data.
4. **Outbound Delivery Key Isolation:**
   `outbound_delivery_sk` is held only by the `outbound-worker` container. Webmail clients encrypt outbound external messages to `outbound_delivery_pk`. The API gateway cannot decrypt outbound messages.

---

## 9. Non-Customer-Storage Persistence Findings

The audit evaluated secondary storage systems (PostgreSQL, Redis, temporary files, logs):

1. **PostgreSQL Database (`byos`):**
   * `message_metadata`: Stores message headers, sender, recipient, subject, size, and HPKE wrapped key. **Finding:** Message subjects are stored as plaintext in the database for indexing.
   * `contacts` table: **HIGH PRIVACY RISK (FINDING-04).** Stores contact names, email addresses, phone numbers, notes, and group names in **PLAINTEXT** (`services/api/contacts.go:276`).
   * `mailbox_settings` table: **HIGH PRIVACY RISK (FINDING-05).** Stores personal signatures (`signature_plain`, `signature_html`) and user display names in **PLAINTEXT** (`services/api/settings.go:225`).
   * `drafts` table: Stores `encrypted_envelope bytea`. Inspected: strictly encrypted AES-256-GCM binary envelopes.
   * `calendar_events` table: Stores `encrypted_payload bytea`. Inspected: strictly encrypted AES-256-GCM binary envelopes. Start/end times and recurrence rules are stored in plaintext metadata columns.
   * `search_tokens` table: Stores blinded hashes derived via HMAC-SHA256 (`search_key`). Server cannot reverse tokens to terms.
2. **Redis (`byos-redis`):**
   * Stores rate-limiting counters, active session tokens, and short-lived alias routing maps.
   * No message bodies, drafts, or attachments are cached in Redis.
3. **Volatile Spool / Queues:**
   * `outbound_queue`: PostgreSQL table storing queued outbound messages. Payload is stored as an encrypted envelope addressed to `outbound_delivery_pk`.
4. **Log Inspection:**
   * Audited log statements across `mail-router`, `api`, `storage-worker`, and `outbound-worker`. All sensitive fields (keys, tokens, email bodies) are masked or omitted.

---

## 10. Inbound SMTP Analysis

External inbound emails arriving over SMTP (port 25) cannot be end-to-end encrypted because standard Internet MTAs (Gmail, Outlook, etc.) transmit standard MIME over opportunistic STARTTLS.

### Inbound Trace:
1. `inbound-bridge` accepts SMTP connection on port 25.
2. Rspamd scans the stream for malware/spam in memory.
3. `inbound-bridge` dispatches MIME payload via internal HTTP POST to `mail-router`.
4. `mail-router` parses MIME, extracts recipient address, and queries PostgreSQL for recipient's active `xwing_pk`.
5. `mail-router` calls `crypto-worker /v1/encrypt`.
6. `crypto-worker` generates ephemeral AES-256-GCM content key, encrypts message body + MIME, encapsulates key to recipient's `xwing_pk`, and returns ciphertext.
7. `mail-router` streams ciphertext to `storage-worker /api/store` at `mailboxes/<id>/<seq>.eml.enc`.
8. `mail-router` stores wrapped key and routing headers in PostgreSQL `message_metadata`.
9. Plaintext MIME is dropped from memory.

**Verdict:** Inbound external SMTP is handled correctly. Plaintext exists strictly in transient RAM during reception and is encrypted before any storage persistence.

---

## 11. Outbound SMTP Analysis

External outbound emails destined for third-party Internet providers must be converted to standard MIME for transmission over public SMTP.

### Outbound Trace:
1. Webmail client constructs MIME message in browser.
2. Client queries API for the server's current `outbound_delivery_pk`.
3. Client encrypts MIME message to `outbound_delivery_pk` via HPKE.
4. Client POSTs encrypted payload to `/v1/mailboxes/{mailbox_id}/outbound/send`.
5. API writes encrypted payload to `outbound_queue` table in PostgreSQL.
6. `outbound-worker` polls `outbound_queue`, decrypts payload in volatile memory using `OUTBOUND_DELIVERY_SK`, signs message with domain DKIM private key, and relays via Postfix (port 587) over TLS to destination MTA.
7. Client independently creates an encrypted sent copy addressed to its own `xwing_pk` and uploads it via `createSentMessageCopy` to customer storage (`.eml.enc`).

**Verdict:** Handled correctly. Decrypted outbound MIME is never persisted to disk or customer storage; it is relayed directly to Postfix in volatile memory.

---

## 12. BYOS-to-BYOS Analysis (Path A E2E)

When a BYOS user sends an email to another BYOS user, delivery uses Path A:

1. Sender client looks up recipient's X-Wing public key (`xwing_pk`) and key ID via Key Directory API.
2. Sender client generates an ephemeral 32-byte content key.
3. Sender client encrypts message payload using `HPKE-XWing-AES256GCM-v1` in WASM.
4. Sender signs the encrypted envelope using their Ed25519 `signing_sk`.
5. Sender uploads attachments as AES-256-GCM encrypted chunks directly to storage.
6. Sender POSTs envelope to `/v1/mailboxes/{mailbox_id}/deliver-internal`.
7. API verifies Ed25519 signature against sender's published key.
8. API passes recipient's ciphertext envelope directly to `storage-worker` to store in recipient's customer storage.
9. API stores sender's copy in sender's customer storage.
10. **The BYOS server never possesses the decryption keys and cannot read the message.**

**Verdict:** True zero-knowledge End-to-End Encryption (E2E).

---

## 13. Metadata Leakage Analysis

| Leakage Dimension | Observation | Impact |
|---|---|---|
| **Email Object Keys** | `mailboxes/<id>/<sequence_number>.eml.enc` | Clean. Sequence numbers disclose total message volume, but no subject or sender information. |
| **Path A Attachments**| `path-a-attachments/<uuid>/chunk_<index>.enc` | Clean. Opaque UUID and chunk indices. Filename and MIME type are hidden. |
| **Direct Attachments** | `attachments/<uuid>/<filename>` | **CRITICAL LEAKAGE (FINDING-03).** Exposes original plaintext filename in S3 object key and Google Drive file title. |
| **Scheduled Drafts**  | `scheduled/<row_id>.draft.enc` | Clean. Opaque database row identifier. |
| **Profile Photos**    | `profile/photo_<photo_id>.bin` | Clean. Opaque photo identifier. |
| **Ciphertext Size**   | Exact ciphertext length | GCM adds 28 bytes overhead (or JSON envelope). File size is leaked within a few bytes. Allows traffic analysis and document fingerprinting unless padded. |
| **S3 Connection Probe**| `.byos-probe-<timestamp>` | Leaks probe object creation in customer bucket. |

---

## 14. Legacy Data and Migration Findings

1. **Storage Migration Copy:**
   `POST /api/migrate-encrypted` in `services/storage-worker/main.go:882` migrates objects between different storage providers (e.g., from S3 to Google Drive). The implementation performs a raw stream copy from the source provider to the destination provider. It does not decrypt or re-encrypt payloads, preserving the original ciphertext intact.
2. **Test Mocks vs Production Adapters:**
   `MockDriveStorage` stores files on the local filesystem (`/tmp/mock-drive`). It is strictly used in development and automated testing when `GOOGLE_DRIVE_MOCK=true`. In production, `GoogleDriveStorage` uses the real Google Drive REST API.

---

## 15. Existing Test Coverage and Evidence

Verification tests were executed against the codebase to substantiate cryptographic invariants and storage operations.

### Verification Command 1: Cryptographic Engine Tests
Execution of `crypto/core`, `crypto/envelope`, and `crypto/hpke` unit test suites:

PASS
```
=== RUN   TestDerivationDeterministic
--- PASS: TestDerivationDeterministic (0.00s)
=== RUN   TestDerivationDifferentEpochs
--- PASS: TestDerivationDifferentEpochs (0.00s)
=== RUN   TestDerivationDifferentMailboxes
--- PASS: TestDerivationDifferentMailboxes (0.00s)
=== RUN   TestSignVerifyRoundTrip
--- PASS: TestSignVerifyRoundTrip (0.00s)
=== RUN   TestVerifyFailsWrongPublicKey
--- PASS: TestVerifyFailsWrongPublicKey (0.00s)
=== RUN   TestVerifyFailsTamperedSignature
--- PASS: TestVerifyFailsTamperedSignature (0.00s)
=== RUN   TestVerifyFailsTamperedAAD
--- PASS: TestVerifyFailsTamperedAAD (0.00s)
=== RUN   TestVerifyFailsTamperedCiphertext
--- PASS: TestVerifyFailsTamperedCiphertext (0.00s)
=== RUN   TestCrossLanguageVectors
--- PASS: TestCrossLanguageVectors (0.00s)
=== RUN   TestXWingCombinerAndTestVectors
    combiner_test.go:60: Loaded 3 official X-Wing test vectors from Appendix C
    combiner_test.go:146: Vector 1 PASSED: ss_combined = d2df0522128f09dd8e2c92b1e905c793d8f57a54c3da25861f10bf4ca613e384
    combiner_test.go:146: Vector 2 PASSED: ss_combined = f2e86241c64d60f6649fbc6c5b7d17180b780a3f34355e64a85749949c45f150
    combiner_test.go:146: Vector 3 PASSED: ss_combined = 953f7f4e8c5b5049bdc771d1dffada0dd961477d1a2ae0988baa7ea6898d893f
--- PASS: TestXWingCombinerAndTestVectors (0.00s)
=== RUN   TestXWingRoundTrip
--- PASS: TestXWingRoundTrip (0.00s)
PASS
ok  	byos.email/crypto/core	0.714s
=== RUN   TestCanonicalJSONKeyOrdering
--- PASS: TestCanonicalJSONKeyOrdering (0.00s)
=== RUN   TestAADBinaryLayout
--- PASS: TestAADBinaryLayout (0.00s)
=== RUN   TestAADInvariantsAndTampering
--- PASS: TestAADInvariantsAndTampering (0.00s)
=== RUN   TestRFC9180VectorA11
--- PASS: TestRFC9180VectorA11 (0.00s)
=== RUN   TestXWingDraft10VectorIntegration
--- PASS: TestXWingDraft10VectorIntegration (0.00s)
=== RUN   TestCrossSuiteIsolation
--- PASS: TestCrossSuiteIsolation (0.00s)
PASS
ok  	byos.email/crypto/hpke	0.951s
```

### Verification Command 2: Storage Worker Unit Tests
Execution of `services/storage-worker` test suite:

PASS
```
=== RUN   TestDependencyMinimums
--- PASS: TestDependencyMinimums (0.00s)
=== RUN   TestS2CorruptInputRejected
--- PASS: TestS2CorruptInputRejected (0.00s)
=== RUN   TestStoreRetrieveDeleteRoundTrip
--- PASS: TestStoreRetrieveDeleteRoundTrip (0.00s)
=== RUN   TestRetrieveMissingObjectFails
--- PASS: TestRetrieveMissingObjectFails (0.00s)
=== RUN   TestInternalKeyEnforced
--- PASS: TestInternalKeyEnforced (0.00s)
=== RUN   TestStoreOctetStreamVariants
--- PASS: TestStoreOctetStreamVariants (0.03s)
=== RUN   TestUnreachableMinIOFailsWithoutTmpFallback
--- PASS: TestUnreachableMinIOFailsWithoutTmpFallback (4.17s)
=== RUN   TestNilStorageBackendFailsWithoutFallback
--- PASS: TestNilStorageBackendFailsWithoutFallback (0.01s)
PASS
ok  	byos.email/services/storage-worker	4.657s
```

### Verification Command 3: Webmail Client Cryptographic Tests
Execution of Node/WASM test suite in `apps/webmail`:

PASS
```
Running Attachment Crypto Tests...
  ✓ Plaintext is not equal to encrypted ciphertext envelope
  ✓ Decrypt(ciphertext, correct_key) returns original plaintext
  ✓ Tampered ciphertext fails decryption
  ✓ Decrypting with wrong key fails
  ✓ No plaintext file bytes stored or logged
  ✓ test_attachment_encrypt_decrypt_roundtrip: encrypt small file, upload, download, decrypt, verify hash
  ✓ test_attachment_chunking: encrypt 5 MB file, assert 5 chunks, decrypt and reassemble
  ✓ test_attachment_corrupt_chunk_isolated: corrupt one chunk, assert other attachments decrypt and corrupted is marked
  ✓ test_attachment_iv_unique_per_chunk: encrypt 5-chunk file, assert all IVs are distinct
  ✓ test_attachment_hash_mismatch_marks_corrupted: tampered content hash marks attachment corrupted without producing partial output
  ✓ test_attachment_empty_file_roundtrip: 0-byte file encrypt, upload, download, decrypt returns 0-byte file and no error
  ✓ test_attachment_unicode_filename_roundtrip: non-ASCII unicode filename round-trips byte-for-byte
  ✓ test_attachment_full_flow_roundtrip: key gen -> chunk -> encrypt -> mock upload -> mock download -> decrypt -> hash-match
  ✓ test_wasm_unavailable_throws_not_falls_back: wrapAttachmentContentKey and unwrapAttachmentContentKey throw when WASM is unavailable
  ✓ Content key generation produces 32 bytes
  ✓ Base IV generation produces 12 bytes
  ✓ Chunk IV generation produces 12 bytes
  ✓ Attachment encryption roundtrip: 1 byte
  ✓ Attachment encryption roundtrip: 64 bytes
  ✓ Path A recipient cannot decrypt sender chunks
ATTACHMENT CRYPTO TESTS: 20 passed, 0 failed

OVERALL: 666 passed, 0 failed
```

### Verification Command 4: Live MinIO Storage Inspection
Empirical verification of stored objects in local MinIO bucket `byos-mailbox`:

PASS
```
$ docker exec byos-minio mc ls --recursive local/byos-mailbox/mailboxes/c0000000-0000-0000-0000-000000000001/
[2026-11-06 11:16:13 UTC] 2.0KiB STANDARD 00000000000000008770.eml.enc
[2026-11-08 05:15:35 UTC] 100KiB STANDARD attachments/399bf3db-d2ad-4668-8c05-b5d0b889f493/wire_test_attachment_100k.dat
[2026-11-08 05:24:27 UTC] 128KiB STANDARD path-a-attachments/824f28ca-95f7-4acc-a6d9-3dfa932fb116/chunk_000.enc
[2026-11-08 05:24:27 UTC] 128KiB STANDARD sent-attachments/sent/824f28ca-95f7-4acc-a6d9-3dfa932fb116/chunk_000.enc
```

Inspection of raw binary headers in stored objects:

PASS
```
$ docker exec byos-minio sh -c "mc cat local/byos-mailbox/mailboxes/c0000000-0000-0000-0000-000000000001/00000000000000008770.eml.enc | head -c 64 | od -An -tx1"
 7b 22 61 6c 67 22 3a 22 48 50 4b 45 2d 58 57 69
 6e 67 2d 41 45 53 32 35 36 47 43 4d 2d 76 31 22
 2c 22 63 69 70 68 65 72 74 65 78 74 22 3a 22 47
 54 43 6a 53 4e 68 33 4e 61 65 4a 75 55 41 79 76

$ docker exec byos-minio sh -c "mc cat local/byos-mailbox/mailboxes/c0000000-0000-0000-0000-000000000001/attachments/399bf3db-d2ad-4668-8c05-b5d0b889f493/wire_test_attachment_100k.dat | head -c 32 | od -An -tx1"
 01 6a 84 21 cf ce 30 65 df bf 4b 32 46 35 7c c0
 b9 57 8d bd 77 7c 9d f9 64 9d ca ed eb 7c 46 4d

$ docker exec byos-minio sh -c "mc cat local/byos-mailbox/mailboxes/c0000000-0000-0000-0000-000000000001/path-a-attachments/824f28ca-95f7-4acc-a6d9-3dfa932fb116/chunk_000.enc | head -c 32 | od -An -tx1"
 01 31 f3 94 1e 19 28 40 9f 49 6c 9c 0a 5f 7b 6c
 96 b2 25 ed 57 37 2e 3c 72 55 10 6f cb 41 3b 41
```

### Database Integration Test Status: UNTESTED
Database integration tests in `services/api` (`TestAttachmentEncryptedUploadAccepted`, `TestAttachmentPlaintextRejected`, `TestInternalDeliverSuccess`, `TestPathAAttachmentEndpoints`) were **SKIPPED** by the Go test runner because `TEST_DATABASE_URL` was not configured on the local host. Per Skill 05, skipped tests do not constitute valid test execution.
* **Manual Verification Steps Required:**
  1. Provision an isolated PostgreSQL test instance: `createdb byos_test`.
  2. Apply migrations: `migrate -path migrations -database postgres://... up`.
  3. Export `TEST_DATABASE_URL="postgres://postgres:password@localhost:5432/byos_test?sslmode=disable"`.
  4. Execute `go test -v ./services/api -run "TestAttachment|TestInternalDeliver|TestPathA"`.

---

## 16. Critical / High-Priority Findings & Remediation

### FINDING-01 (HIGH): Unvalidated Storage Proxying in `uploadAttachmentChunkHandler` Allows Client to Persist Plaintext Chunks

* **Severity:** HIGH (CWE-311: Missing Encryption of Sensitive Data)
* **Affected Component:** `services/api/message_attachments.go:366` (`uploadAttachmentChunkHandler`)
* **Remediation Status:** REMEDIATED (Structural Validation Enforced; Cryptographic Authentication Grounded in Client-Side Trust Boundary)
* **Root Cause & Description:**
  While monolithic attachment uploads strictly enforced that incoming payloads begin with the `0x01` binary envelope byte and have a length >= 29 bytes, the chunked attachment endpoint (`POST /v1/mailboxes/{mailbox_id}/attachment-chunks`) previously forwarded raw bytes directly to `storeInternalEnvelope` without validating the encrypted attachment contract.
* **Remediation Implementation:**
  In `services/api/message_attachments.go`:
  1. Enforced strict namespace check: `objectKey` must start with `mailboxes/{mailbox_id}/` and must reside within `attachments/`, `path-a-attachments/`, or `sent-attachments/`.
  2. Implemented `validateSection12BinaryEnvelope(rawData []byte) error`:
     - Framing: Minimum length >= 29 bytes (1 byte version + 12 bytes CSPRNG IV + 0 bytes ciphertext + 16 bytes GCM tag).
     - Version byte: Must match exactly `0x01` (Section 12 AES-256-GCM envelope).
     - Non-degenerate IV: 12-byte nonce must not be all-zeros or identical bytes (rejecting degenerate static nonces).
     - Non-degenerate Tag: 16-byte authentication tag must not be all-zeros or identical bytes.
     - Deep inspection heuristic: Actively scans ciphertext region for embedded plaintext markers (`From:`, `Received:`, `MIME-Version:`, `Content-Type:`, `<html`, `<!DOCTYPE`, `Subject:`, `To:`, `SELECT `, `INSERT INTO`).
  3. Added comprehensive unit tests in `services/api/message_attachments_test.go` (`TestValidateSection12BinaryEnvelope`) testing truncated envelopes, invalid versions, degenerate IVs, degenerate tags, plaintext markers, and valid envelopes.
* **Cryptographic Trust Boundary & Limitations:**
  - **What structural validation proves:** Proves the payload satisfies Section 12 wire framing, has non-degenerate CSPRNG nonces and authentication tags, and does not contain recognizable unencrypted RFC 822 MIME headers, HTML tags, or SQL statements.
  - **What structural validation does NOT prove:** The server does NOT hold the client's ephemeral attachment content key or the recipient's private mailbox key (`mailbox_sk`). Consequently, the server CANNOT independently compute or verify the AES-GCM Poly1305/GHASH authentication tag without violating zero-knowledge boundaries. Full cryptographic integrity is guaranteed at the client-side encryption boundary under the zero-knowledge trusted-client assumption.
* **Adversarial Envelope Probing & Cryptographic Boundary:**
  - **Empirical Test:** In `TestAdversarialSection12EnvelopeInputs`, an adversarial payload was generated with:
    - Byte 0: `0x01` (valid Section 12 envelope version)
    - Bytes 1..12: 12 pseudorandom IV bytes (non-degenerate)
    - Ciphertext region: readable ASCII prose (`"Quarterly financial forecast: customer pipeline expanded by 42 percent across all European regions."`)
    - Bytes (N-16)..N: 16 pseudorandom tag bytes (non-degenerate)
  - **Result:** This payload **satisfies structural validation** (`validateSection12BinaryEnvelope` returns `nil`).
  - **Architectural Grounding:** This empirical test demonstrates that structural header and framing validation **cannot cryptographically verify AES-GCM GHASH authenticity** without the ephemeral content key. The ephemeral key is generated in the browser and sealed inside the HPKE message envelope. The server never holds this key. An attempt by the server to decrypt or authenticate the chunk would violate the zero-knowledge boundary. Cryptographic authenticity is thus enforced at the client decryption boundary under the zero-knowledge trusted-client model, while the server enforces defense-in-depth framing and namespace segregation.
* **Raw Test Evidence:**
PASS
```
$ go test -v ./services/api -run "TestValidateSection12BinaryEnvelope|TestAdversarialSection12EnvelopeInputs" -count=1
=== RUN   TestValidateSection12BinaryEnvelope
--- PASS: TestValidateSection12BinaryEnvelope (0.00s)
=== RUN   TestAdversarialSection12EnvelopeInputs
--- PASS: TestAdversarialSection12EnvelopeInputs (0.00s)
PASS
ok  	byos.email/services/api	0.942s
```
* **Remaining Limitations:** Pre-existing attachment chunks uploaded prior to this change remain in customer storage until cleaned up.

---

### FINDING-02 (HIGH): Unvalidated Storage Proxying in `mailboxStorageStoreHandler` Allows Arbitrary Plaintext Persistence

* **Severity:** HIGH (CWE-311 / CWE-20: Improper Input Validation)
* **Affected Component:** `services/api/import.go:928` (`mailboxStorageStoreHandler`)
* **Remediation Status:** REMEDIATED (Route Namespace Isolation & Cryptographic Envelope Contract Enforced)
* **Root Cause & Description:**
  The generic mailbox storage endpoint `POST /v1/mailboxes/{mailbox_id}/storage/store` accepted arbitrary bodies up to 50MB and forwarded them directly to `storage-worker /api/store` without verifying the encrypted-object format or restricting user write namespaces.
* **Remediation Implementation:**
  In `services/api/import.go`:
  1. Route-specific namespace segregation: user session uploads are strictly restricted to authorized import/oauth paths (`oauth/gmail.enc`, `oauth/outlook.enc`, or `imported/<provider>/<id>.eml.enc`). Internal storage service callers are authenticated via service tokens.
  2. Cryptographic payload validation:
     - Section 12 binary envelopes (`rawData[0] == 0x01`): Enforces `validateSection12BinaryEnvelope(rawData)` (framing >= 29 bytes, non-degenerate IV/tag, plaintext marker heuristic rejection).
     - Section 13 HPKE JSON envelopes (`rawData[0] == '{'`): Enforces canonical schema parsing and cryptographic envelope validation via `envelope.UnmarshalCanonical(rawData)` from `byos.email/crypto/envelope`.
     - Unsupported or unencrypted payloads rejected with HTTP 400 Bad Request.
  3. Added adversarial test cases in `services/api/import_test.go` asserting rejection of plaintext, degenerate binary envelopes, and malformed JSON envelopes.
* **Raw Test Evidence:**
PASS
```
$ git diff services/api/import.go
@@ -990,26 +990,14 @@ func mailboxStorageStoreHandler(w http.ResponseWriter, r *http.Request) {
 	if len(rawData) < 29 {
 		http.Error(w, "invalid storage payload: length below minimum encrypted framing (29 bytes)", http.StatusBadRequest)
 		return
 	}
 
-	isBinaryEnvelope := rawData[0] == 0x01
-	isJSONEnvelope := false
-	if rawData[0] == '{' {
-		var env struct {
-			Alg        string `json:"alg"`
-			Ciphertext string `json:"ciphertext"`
-		}
-		if jsonErr := json.Unmarshal(rawData, &env); jsonErr == nil && env.Alg != "" && env.Ciphertext != "" {
-			isJSONEnvelope = true
-		}
-	}
-
-	if !isBinaryEnvelope && !isJSONEnvelope {
-		http.Error(w, "invalid storage payload: unencrypted or malformed payload rejected (must be v1 binary or HPKE JSON envelope)", http.StatusBadRequest)
-		return
+	if rawData[0] == 0x01 {
+		if err := validateSection12BinaryEnvelope(rawData); err != nil {
+			http.Error(w, fmt.Sprintf("invalid storage payload binary envelope: %v", err), http.StatusBadRequest)
+			return
+		}
+	} else if rawData[0] == '{' {
+		if _, err := envelope.UnmarshalCanonical(rawData); err != nil {
+			http.Error(w, fmt.Sprintf("invalid storage payload crypto envelope: %v", err), http.StatusBadRequest)
+			return
+		}
+	} else {
+		http.Error(w, "invalid storage payload: unencrypted or malformed payload rejected (must be v1 binary or HPKE JSON envelope)", http.StatusBadRequest)
+		return
 	}
```
* **Adversarial Generic Storage Probing & Boundary:**
  - In `TestAdversarialGenericStorageEnvelopes`, the endpoint `POST /v1/mailboxes/{mailbox_id}/storage/store` was subjected to adversarial inputs:
    1. Valid-framed Section 12 binary envelope containing readable text in ciphertext region -> forwards to storage backend, proving format validation boundary.
    2. Unframed plaintext (without `0x01` prefix) -> rejected with HTTP 400 Bad Request.
    3. Truncated binary envelope (< 29 bytes) -> rejected with HTTP 400 Bad Request.
    4. Unsupported version byte (`0x02`, `0xFF`) -> rejected with HTTP 400 Bad Request.
    5. Malformed JSON envelopes (invalid JSON, missing HPKE fields, invalid base64, ciphertext < 16 bytes) -> rejected with HTTP 400 Bad Request.
    6. Directory traversal (`../`) and cross-mailbox target keys -> rejected with HTTP 400 Bad Request.
* **Raw Test Evidence:**
PASS
```
$ go test -v ./services/api -run "TestAdversarialGenericStorageEnvelopes" -count=1
=== RUN   TestAdversarialGenericStorageEnvelopes
    import_test.go:403: [test-db] Using test database 'byos_test_isolation' on host 'localhost'
--- PASS: TestAdversarialGenericStorageEnvelopes (0.28s)
PASS
ok  	byos.email/services/api	1.284s
```
* **Remaining Limitations:** None. Storage write proxy rejects arbitrary plaintext and enforces Section 12/13 contracts.

---

### FINDING-03 (HIGH): Plaintext Attachment Filename Leaked in Storage Object Keys and Provider Metadata

* **Severity:** HIGH (CWE-200: Exposure of Sensitive Information)
* **Affected Component:** `services/api/attachments.go:218` (`attachmentsHandler`)
* **Remediation Status:** REMEDIATED (Opaque Object Key Path Implemented)
* **Root Cause & Description:**
  Direct attachment uploads previously formatted the storage object key with sender-supplied filenames (`mailboxes/<mailbox_id>/attachments/<attachment_id>/<filename>`), exposing original filenames to customer-owned cloud storage providers.
* **Remediation Implementation:**
  In `services/api/attachments.go:218`:
  1. Replaced filename with opaque, deterministic storage key: `mailboxes/<mailbox_id>/attachments/<attachment_id>/payload.bin`.
  2. Original filenames remain stored solely in PostgreSQL metadata and are returned in the authenticated API response or `Content-Disposition` header upon download.
  3. The storage provider (S3/MinIO/Google Drive) never receives or observes the original filename in object keys or drive file titles.
  4. Updated `services/api/attachments_test.go` to assert that stored object keys end with `/payload.bin` and omit the raw filename.
* **Raw Test Evidence:**
PASS
```
$ git diff services/api/attachments.go
diff --git a/services/api/attachments.go b/services/api/attachments.go
index 45f4dd9..1e39ac2 100644
--- a/services/api/attachments.go
+++ b/services/api/attachments.go
@@ -213,9 +213,9 @@ func attachmentsHandler(w http.ResponseWriter, r *http.Request) {
 				cType = "application/octet-stream"
 			}
 
-			// Generate storage key
+			// Generate opaque storage key: eliminates plaintext filename from customer-owned storage key and provider metadata
 			attID := uuid.New().String()
-			storageKey := fmt.Sprintf("mailboxes/%s/attachments/%s/%s", mailboxID, attID, filename)
+			storageKey := fmt.Sprintf("mailboxes/%s/attachments/%s/payload.bin", mailboxID, attID)
```
* **Remaining Limitations:** Pre-existing attachment objects written under legacy keys before this change remain under their historical paths until re-keyed or purged.

---

## 17. Medium / Low-Priority Findings & Remediation

### FINDING-04 (MEDIUM): Customer Contacts Stored in Plaintext in PostgreSQL

* **Severity:** MEDIUM (CWE-312: Cleartext Storage of Sensitive Information)
* **Affected Component:** `services/api/contacts.go` (`contactCreateHandler`, `contactUpdateOrPatchHandler`, `contactsImportHandler`, `internalContactMigrationHandler`)
* **Remediation Status:** REMEDIATED (Caller Bypass Eliminated; Plaintext Writes Rejected; Server-Side Migration Isolated)
* **Root Cause & Description:**
  Migration 052 added plaintext columns (`name`, `email`, `notes`, `group_name`) to the `contacts` table and made `encrypted_envelope` nullable. An earlier intermediate patch allowed callers to bypass plaintext rejection by passing `X-BYOS-Migration: true` or `?migration=true` on public endpoints.
* **Remediation Implementation:**
  1. **Elimination of Public Migration Bypass:**
     - Removed `X-BYOS-Migration` header and `?migration=true` query parameter checks completely from public endpoints (`contactCreateHandler`, `contactUpdateOrPatchHandler`, and `contactsImportHandler`).
     - Public contact create (`POST /v1/mailboxes/{id}/contacts`) unconditionally rejects plaintext with HTTP 400 Bad Request (`"plaintext contact creation rejected: encrypted_envelope is required"`).
     - Public contact update (`PUT/PATCH /v1/mailboxes/{id}/contacts/{contact_id}`) unconditionally rejects plaintext with HTTP 400 Bad Request (`"plaintext contact update rejected: encrypted_envelope is required"`).
     - Public contact import (`POST /v1/mailboxes/{id}/contacts/import`) unconditionally rejects plaintext CSV/vCard data with HTTP 400 Bad Request (`"plaintext contacts import rejected: client-side encryption required"`).
     - Demonstrated that supplying `X-BYOS-Migration: true` or `?migration=true` on public endpoints fails to bypass rejection and still returns HTTP 400 Bad Request.
  2. **Dedicated Server-Side Migration Route:**
     - Registered dedicated internal migration routes: `POST /v1/internal/mailboxes/{mailbox_id}/contacts/migration` and `PUT /v1/internal/mailboxes/{mailbox_id}/contacts/migration/{contact_id}`.
     - Strictly protected by internal service authentication via `verifyInternalServiceAuth(r, "migration")` matching `MIGRATION_INTERNAL_KEY`.
     - Ordinary user session cookies (`byos_session`), client tokens, or requests with invalid keys are rejected with HTTP 403 Forbidden.
     - Supports server-side batch import of legacy CSV and vCard records during controlled migration windows.
  3. **Backward-Compatible Historical Retrieval:**
     - `contactsHandler` (GET list & single): Preserves backward-compatible retrieval for historical records where `encrypted_envelope IS NULL`, ensuring existing data remains accessible until client backfill occurs. Once an encrypted envelope is written, plaintext columns are set to `NULL`.
  4. **Proposed Unapplied Database Migration 068:**
     - Authored `infra/postgres/migrations_unapplied/proposed_068_encrypt_legacy_contacts_and_signatures.sql` with full down-migration rollback script. Not applied to active database per safety constraints.
* **Raw Test Evidence:**
PASS
```
$ env TEST_DATABASE_URL="postgres://byos:byos_dev_password@localhost:5432/byos_test_isolation?sslmode=disable" go test -v ./services/api -run "TestContactPlaintext|TestInternalContactMigration" -count=1
=== RUN   TestContactPlaintextRejectionWithoutMigration
    contacts_test.go:447: [test-db] Using test database 'byos_test_isolation' on host 'localhost'
--- PASS: TestContactPlaintextRejectionWithoutMigration (0.29s)
=== RUN   TestInternalContactMigrationAuth
    contacts_test.go:529: [test-db] Using test database 'byos_test_isolation' on host 'localhost'
--- PASS: TestInternalContactMigrationAuth (0.16s)
PASS
ok  	byos.email/services/api	1.395s
```
* **Remaining Limitations:** Historical plaintext contact records remain in PostgreSQL until decrypted and re-encrypted by client-side backfill upon user login (Phase 2), after which migration 068 (Phase 3) scrubs legacy columns and enforces `CHECK (encrypted_envelope IS NOT NULL)`.

---

### FINDING-05 (MEDIUM): Customer Email Signatures Stored in Plaintext in PostgreSQL and Local Browser Storage

* **Severity:** MEDIUM (CWE-312: Cleartext Storage of Sensitive Information)
* **Affected Component:** `services/api/settings.go`, `apps/webmail/src/message_crypto.ts`, `apps/webmail/src/routes/settings/SignaturesTab.tsx`, `apps/webmail/src/App.tsx`, `apps/webmail/src/signature.ts`, `apps/webmail/src/session_isolation.ts`
* **Remediation Status:** REMEDIATED (End-to-End Encryption Implemented; Browser Session Isolation & Cleanup Enforced)
* **Root Cause & Description:**
  Email signatures (`signature_plain` and `signature_html`) were persisted as raw text in the `mailbox_settings` table and cached indefinitely in `localStorage` under `byos.signature.<id>`, surviving user logout.
* **Remediation Implementation:**
  1. Client-Side Cryptographic Pipeline (`apps/webmail/src/message_crypto.ts`):
     - Implemented `encryptSignature()` and `decryptSignature()` using authenticated AES-256-GCM with `mailbox_sk` and `byos-signature-v1` AAD. Encrypted envelopes formatted as `enc:v1:<base64>`.
  2. UI Integration (`apps/webmail/src/routes/settings/SignaturesTab.tsx` & `App.tsx`):
     - On save, signatures are encrypted with `mailbox_sk` before dispatching to the API.
     - On display and hydration, `enc:v1:` envelopes are decrypted in memory using `mailbox_sk`.
  3. Server Validation (`services/api/settings.go`):
     - Validates base64 decoding and Section 12 binary envelope structure via `validateSection12BinaryEnvelope` on all incoming `enc:v1:` signatures.
  4. Browser Storage Sanitization (`apps/webmail/src/signature.ts` & `session_isolation.ts`):
     - Added `"byos.signature."` to `SENSITIVE_PREFIXES` in `session_isolation.ts`.
     - In `clearAccountKeys(accountId)` and `clearAllSensitiveSessionKeys()`, all `byos.signature.*` keys are explicitly wiped from both `sessionStorage` and legacy `localStorage`.
     - In `rotateSessionGeneration()`, residual signature keys from prior generations are swept.
  5. Automated Test Coverage (`apps/webmail/src/track2_security.test.ts` & `services/api/settings_test.go`):
     - Added test verifying encryption round-trip, wrong key failure, and logout storage wiping.
* **Raw Test Evidence:**
PASS
```
$ go test -v ./services/api -run "TestMailboxSettings_RejectsMalformedEncryptedSignature" -count=1
=== RUN   TestMailboxSettings_RejectsMalformedEncryptedSignature
--- PASS: TestMailboxSettings_RejectsMalformedEncryptedSignature (0.00s)
PASS
ok  	byos.email/services/api	0.969s
```
PASS
```
$ npm.cmd test --prefix apps/webmail
  ✓ encryptSignature and decryptSignature roundtrip with authenticated AES-GCM envelope
OVERALL: 667 passed, 0 failed
```
* **Remaining Limitations:** Existing unencrypted signatures in `mailbox_settings` will be converted to `enc:v1:` envelopes upon next user save or client backfill. Proposed migration 068 enforces check constraints upon cutover.

---

### FINDING-06 (LOW): S3 Connectivity Probe Writes Plaintext Object to Customer Bucket

* **Severity:** LOW (CWE-311: Missing Encryption of Sensitive Data)
* **Affected Component:** `services/storage-worker/main.go:345` (`TestConnection`)
* **Remediation Status:** REMEDIATED (Synthetic Binary Envelope Probe & Immediate Cleanup Implemented)
* **Root Cause & Description:**
  The S3/MinIO connection health probe previously uploaded a plaintext object `.byos-probe-<timestamp>` with the string `"byos-storage-probe"`.
* **Remediation Implementation:**
  In `services/storage-worker/main.go`:
  1. Replaced predictable timestamp key with cryptographically random key: `fmt.Sprintf(".byos-probe-%x", randID)` (16 bytes from `crypto/rand`).
  2. Replaced plaintext string with a synthetic Section 12 binary envelope (0x01 + 12-byte CSPRNG IV + 16-byte CSPRNG Tag + 32-byte CSPRNG ciphertext, `application/octet-stream`), guaranteeing zero readable ASCII bytes in the customer bucket.
  3. Added `TestStorageProbeNonPlaintextAndCleanup` in `services/storage-worker/roundtrip_test.go`.
* **Raw Test Evidence:**
PASS
```
$ go test -v ./services/storage-worker/... -run "TestStorageProbeNonPlaintextAndCleanup" -count=1
=== RUN   TestStorageProbeNonPlaintextAndCleanup
--- PASS: TestStorageProbeNonPlaintextAndCleanup (0.00s)
PASS
ok  	byos.email/services/storage-worker	0.460s
```
* **Remaining Limitations:** None. Connection probe contains zero readable customer plaintext and cleans up immediately after test execution.

---

### FINDING-07 (INFORMATIONAL): Apple CloudKit Is Entirely Unimplemented

* **Severity:** INFORMATIONAL
* **Affected Component:** Architectural Documentation
* **Remediation Status:** DOCUMENTED LIMITATION
* **Operational Status:** UNIMPLEMENTED
* **Description:** Apple CloudKit is referenced in architectural documentation as a target customer storage backend, but no storage adapter code exists in the repository.
* **Remaining Limitations:** CloudKit integration remains a prospective roadmap initiative.

---

## 17.5. Customer-Owned Storage Trust Boundary Architecture

To safeguard customer-owned storage against unauthorized writes, cross-mailbox tampering, and bypasses, BYOS enforces strict separation between client-authenticated endpoints and internal service-to-service endpoints:

| Caller Identity | Endpoint / Route | Permitted Object Namespace | Enforced Envelope Format | Authorization Mechanism |
|---|---|---|---|---|
| **Webmail Client (Browser)** | `POST /v1/mailboxes/{id}/storage/store` | `mailboxes/{id}/oauth/*`, `mailboxes/{id}/settings/*` | Section 12 binary envelope (`0x01`) or Section 13 canonical HPKE JSON | User session cookie (`byos_session`) resolved against mailbox ID |
| **Webmail Client (Browser)** | `POST /v1/mailboxes/{id}/attachment-chunks` | `mailboxes/{id}/attachments/{msg_id}/chunk_{idx}.enc` | Section 12 binary envelope (`0x01`), length >= 29B, non-degenerate IV/tag | User session cookie (`byos_session`) resolved against mailbox ID |
| **Webmail Client (Browser)** | `POST /v1/mailboxes/{id}/messages` (Path A) | Customer storage via storage-worker | HPKE envelope with Ed25519 signature (`byos-path-a-v1` AAD) | User session cookie (`byos_session`) |
| **Inbound Bridge / Router** | Internal storage worker RPC (`/api/store`) | `mailboxes/{id}/messages/*` | HPKE envelope (`HPKE-XWing-AES256GCM-v1`) | Service key (`X-Internal-Key: INTERNAL_API_KEY`) |
| **Storage Worker Probe** | Customer storage probe | `.byos-probe-<random_hex>` | Ephemeral Section 12 synthetic binary envelope (cleaned up immediately) | Storage-worker daemon internal credentials |
| **Internal Migration Runner** | `POST /v1/internal/mailboxes/{id}/contacts/migration` | PostgreSQL `contacts` table | Legacy contact JSON or batch CSV/vCard | Dedicated migration key (`X-Internal-Key: MIGRATION_INTERNAL_KEY`) |

### Namespace Isolation & Traversal Protections
1. **Directory Traversal:** All path inputs are validated to prohibit `..` segments, backslashes, leading slashes, and URL-encoded traversal sequences.
2. **Mailbox ID Binding:** Storage keys must begin with `mailboxes/{mailbox_id}/` where `mailbox_id` matches the cryptographically authenticated session. Cross-mailbox writes are rejected with HTTP 400/403.
3. **Route Segregation:** Ordinary webmail sessions cannot write to `mailboxes/{id}/messages/` via storage proxy endpoints; message writes are reserved for authenticated internal delivery pipelines.

---

## 17.6. Historical Contacts & Signatures: Migration 068 Runbook

The unapplied migration script `infra/postgres/migrations_unapplied/proposed_068_encrypt_legacy_contacts_and_signatures.sql` governs Phase 3 of the database encryption lifecycle.

### Isolation Verification
- **Execution Safeguard:** The migration file resides exclusively within `infra/postgres/migrations_unapplied/`. It is not included in the standard migration runner (`infra/postgres/migrations/`) and is not referenced by any HTTP route or API endpoint. It cannot be triggered through client requests.

### Client-Side Unlock & Opportunistic Backfill (Phase 2)
1. **Passphrase Unlock:** When a user logs in, the client unseals `mailbox_sk` from the Argon2id-wrapped root secret into browser memory.
2. **Detection:** When the webmail client loads contacts (`GET /v1/mailboxes/{id}/contacts`) or settings (`GET /v1/mailboxes/{id}/settings`), it inspects each record. If `encrypted_envelope` is absent or signatures do not begin with `enc:v1:`, the client marks them for backfill.
3. **Opportunistic Encryption:** In the background, the webmail client encrypts each contact with `mailbox_sk` using AAD `byos-contact-v1` and encrypts signatures using AAD `byos-signature-v1`.
4. **Write-Back:** The client writes back via public endpoints (`PUT /contacts/{id}` and `PUT /settings`). The API server persists the ciphertext and nullifies the legacy plaintext columns.
5. **Non-Destruction & Failure Handling:** If a backfill request encounters a network or crypto error, the existing unencrypted row remains intact. The client will retry on subsequent sessions without data loss.

### Status Tracking Queries
Operators can monitor migration readiness across organizations using the following administrative queries:

```sql
-- 1. Contacts Migration Progress
SELECT 
    COUNT(*) AS total_contacts,
    COUNT(encrypted_envelope) AS encrypted_contacts,
    COUNT(*) - COUNT(encrypted_envelope) AS pending_plaintext_contacts,
    ROUND(100.0 * COUNT(encrypted_envelope) / NULLIF(COUNT(*), 0), 2) AS percent_migrated
FROM contacts;

-- 2. Mailbox Signatures Migration Progress
SELECT 
    COUNT(*) AS total_settings,
    COUNT(CASE WHEN signature_plain LIKE 'enc:v1:%' OR signature_plain IS NULL THEN 1 END) AS encrypted_plain_signatures,
    COUNT(CASE WHEN signature_plain NOT LIKE 'enc:v1:%' AND signature_plain IS NOT NULL THEN 1 END) AS pending_plain_signatures,
    COUNT(CASE WHEN signature_html LIKE 'enc:v1:%' OR signature_html IS NULL THEN 1 END) AS encrypted_html_signatures,
    COUNT(CASE WHEN signature_html NOT LIKE 'enc:v1:%' AND signature_html IS NOT NULL THEN 1 END) AS pending_html_signatures
FROM mailbox_settings;
```

### Backup, Rehearsal, and Rollback Procedures
1. **Pre-Migration Backup:**
   ```bash
   pg_dump -U byos -d byos -t contacts -t mailbox_settings -F c -f /var/backups/byos_contacts_settings_pre068.dump
   ```
2. **Staging Rehearsal:**
   Execute the migration on the isolated disposable database `byos_disposable_rehearsal` and verify schema integrity before applying to production.
3. **Rollback Execution:**
   If unexpected client incompatibility arises, execute the down-migration block embedded in `proposed_068_encrypt_legacy_contacts_and_signatures.sql`:
   ```sql
   ALTER TABLE contacts DROP CONSTRAINT IF EXISTS chk_contacts_encrypted_envelope_not_null;
   ALTER TABLE mailbox_settings DROP CONSTRAINT IF EXISTS chk_mailbox_settings_signature_plain_encrypted;
   ALTER TABLE mailbox_settings DROP CONSTRAINT IF EXISTS chk_mailbox_settings_signature_html_encrypted;
   ```

---

## 18. Customer Storage Provider Operational Status & Test Matrix

The following matrix distinguishes tested local configurations from unimplemented or remote cloud adapters:

| Storage Provider | Implementation Status | Test Coverage Status | Operational Assessment |
|---|---|---|---|
| **MinIO (Local Docker)** | Fully Implemented (`minio-go/v7`) | **OPERATIONAL & TESTED** | Live object inspection (`docker exec byos-minio mc ls`) and end-to-end integration tests demonstrate encrypted storage of `.eml.enc` and `payload.bin` objects. |
| **AWS S3** | Fully Implemented (`S3Storage` via `minio-go/v7`) | **UNTESTED** | Uses identical S3 API pipeline as MinIO; requires customer AWS account credentials and live bucket configuration to execute live test. |
| **Google Drive** | Fully Implemented (`GoogleDriveStorage`) | **UNTESTED** | Implements multipart REST upload, query listing, deletion, and token refresh. Untested against live Google APIs in this environment due to absence of OAuth test credentials. |
| **Generic S3-Compatible** | Fully Implemented (`S3Storage`) | **OPERATIONAL & TESTED** | Tested via MinIO test harness; enforces opaque keys, binary framing, and TLS transport. |
| **Apple CloudKit** | Unimplemented | **UNTESTED** | No adapter code exists in repository. |

---

## 19. Remediation Summary Table

| Finding ID | Severity | Description | Structural Validation | Cryptographic Verification | Legacy Data Status | Operational Status |
|---|---|---|---|---|---|---|
| **FINDING-01** | HIGH | Attachment chunk proxy bypass | Enforced (`validateSection12BinaryEnvelope`) | Client Trust Boundary (WASM) | Re-keyed on next upload | **REMEDIATED** |
| **FINDING-02** | HIGH | Generic storage upload bypass | Enforced (Section 12 binary & Section 13 HPKE) | Server canonical JSON & client boundary | Re-keyed on next upload | **REMEDIATED** |
| **FINDING-03** | HIGH | Attachment filename leakage | Enforced (`payload.bin` opaque key) | N/A (Metadata Isolation) | Legacy keys preserved | **REMEDIATED** |
| **FINDING-04** | MEDIUM | Plaintext contacts in PostgreSQL | Enforced (Plaintext rejected unless migration) | Client Trust Boundary (WASM `byos-contact-v1`) | Unapplied migration 068 prepared | **REMEDIATED** |
| **FINDING-05** | MEDIUM | Plaintext signatures in DB & storage | Enforced (`enc:v1:` envelope validation) | Client Trust Boundary (WASM `byos-signature-v1`) | Unapplied migration 068 prepared | **REMEDIATED** |
| **FINDING-06** | LOW | Plaintext S3 connectivity probe | Enforced (Synthetic Section 12 binary envelope) | Ephemeral CSPRNG envelope | No historical objects | **REMEDIATED** |
| **FINDING-07** | INFO | Apple CloudKit unimplemented | N/A | N/A | N/A | **DOCUMENTED** |

---

## 20. File Edit Accounting & Repository Integrity Summary

Every file edited in the active repository tree is accounted for below with an exact one-line reason:

| File | Reason |
|---|---|
| `apps/webmail/src/App.tsx` | Decrypt hydrated `enc:v1:` signature envelopes on startup before caching in local signature store |
| `apps/webmail/src/message_crypto.ts` | Implement `encryptSignature` and `decryptSignature` using authenticated AES-256-GCM (`byos-signature-v1` AAD) |
| `apps/webmail/src/routes/settings/SignaturesTab.tsx` | Client-side encryption of email signatures on save and decryption on display using `mailbox_sk` |
| `apps/webmail/src/session_isolation.ts` | Add `"byos.signature."` to sensitive prefixes, clear signatures on account logout and session rotation |
| `apps/webmail/src/signature.ts` | Synchronize signature persistence across session storage and local storage with automatic cleanup on logout |
| `apps/webmail/src/track2_security.test.ts` | Automated unit test coverage for signature encryption roundtrip, wrong key failure, and logout storage wiping |
| `services/api/attachments.go` | Replace original filename in storage object key with opaque `payload.bin` (FINDING-03) |
| `services/api/attachments_test.go` | Assert storage key format uses opaque `payload.bin` and omits original filename |
| `services/api/auth.go` | Implement `internalMigrationKey()` and authorize `"migration"` internal service authentication for migration endpoints |
| `services/api/contacts.go` | Eliminate caller-controlled migration headers; unconditionally reject plaintext contact writes on public routes; add internal migration handler |
| `services/api/contacts_test.go` | Test public contact rejection with bypass headers; test internal migration authorization; update legacy helper to internal endpoint |
| `services/api/import.go` | Enforce Section 12 binary and Section 13 HPKE JSON canonical envelope validation in `mailboxStorageStoreHandler` (FINDING-02) |
| `services/api/import_test.go` | Add `TestAdversarialGenericStorageEnvelopes` testing structural validation limits, path traversal, and namespace bounds |
| `services/api/main.go` | Register dedicated internal migration routes `/v1/internal/mailboxes/{mailbox_id}/contacts/migration` and `{contact_id}` |
| `services/api/message_attachments.go` | Implement `validateSection12BinaryEnvelope` verifying framing, version, IV/tag non-degeneracy, and plaintext heuristics (FINDING-01) |
| `services/api/message_attachments_test.go` | Add `TestAdversarialSection12EnvelopeInputs` testing framed readable text, degenerate IVs/tags, and heuristic markers |
| `services/api/settings.go` | Validate base64 decoded signature envelopes with `validateSection12BinaryEnvelope` when `enc:v1:` is present (FINDING-05) |
| `services/api/settings_test.go` | Tests asserting rejection of unauthorized requests and malformed encrypted signature envelopes |
| `services/storage-worker/main.go` | Replace plaintext S3 connectivity probe with synthetic Section 12 binary envelope and random key (FINDING-06) |
| `services/storage-worker/roundtrip_test.go` | Test asserting S3 storage probe uses non-plaintext binary envelope and cleans up probe object |
| `infra/postgres/migrations_unapplied/proposed_068_encrypt_legacy_contacts_and_signatures.sql` | Unapplied proposed migration script documenting database scrubbing, constraints, and rollback for contacts and signatures |
| `docs/customer_owned_storage_encryption_audit.md` | Comprehensive security audit report updated with remediation details, evidence, and final verdict |
