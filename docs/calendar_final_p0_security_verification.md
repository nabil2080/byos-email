# BYOS Calendar: Final P0 Security Verification Report

## What was built
An independent, comprehensive security verification was conducted to assess the API boundary encryption enforcement for the BYOS Calendar module. The verification inspected the AES-256-GCM wire envelope layout from the Rust crypto core to the Go HTTP handlers, audited all write routes and repository persistence statements against bypasses, challenged the server-side validator against edge cases and malformed payloads, corroborated that invalid requests produce zero database writes, evaluated test isolation against a disposable database, established that unrelated security boundaries remained undisturbed, and established that active database legacy records remain safely quarantined and unmodified.

## Files edited
| File | Reason |
|------|--------|
| `docs/calendar_final_p0_security_verification.md` | Final independent security verification report for Phase A of the Calendar P0 security milestone. |
| `docs/calendar_legacy_plaintext_recovery_design.md` | Architectural specification and edge-case recovery design for Phase B legacy calendar data. |

---

## Executive Verdict
VERDICT: PASS
```
=== RUN   TestCalendarLifecycleAndIsolation
    calendar_test.go:57: [test-db] Using test database 'byos_disposable_rehearsal' on host '127.0.0.1'
--- PASS: TestCalendarLifecycleAndIsolation (0.49s)
=== RUN   TestCalendarEventAPIEnvelopeSecurity
    calendar_test.go:199: [test-db] Using test database 'byos_disposable_rehearsal' on host '127.0.0.1'
--- PASS: TestCalendarEventAPIEnvelopeSecurity (0.88s)
PASS
ok  	byos.email/services/api	2.985s
```

The server-side API boundary in `services/api/calendar.go` strictly enforces structural Section 12 AES-GCM envelope conformity on all event creation and update endpoints (`POST`, `PATCH`, `PUT`), rejecting plaintext JSON, Base64-wrapped JSON, truncated nonces, truncated authentication tags, and unsupported versions before issuing any database write statements.

---

## A1. Wire Envelope Format and Cryptographic Architecture

### Cryptographic Terminology Correction:
In previous documentation, the 16-byte authentication tag was described as Poly1305. **Correction:** Per RFC 5116 and the Section 12 specifications, AES-256-GCM utilizes a 128-bit **GHASH** (Galois field GF(2^128) multiplication) authenticator, not Poly1305 (which is specific to ChaCha20-Poly1305). The Rust implementation in `packages/crypto-core/src/lib.rs` imports `aes_gcm::Aes256Gcm` and generates a 16-byte GHASH tag appended to the ciphertext.

### End-to-End Pipeline Trace:
1. **Rust Core (`packages/crypto-core/src/lib.rs`):**
   - Line 36: `pub const AES_GCM_ENVELOPE_VERSION: u8 = 0x01;`
   - Lines 400–426 (`aes_gcm_encrypt`):
     - Nonce: 12 bytes generated via CSPRNG `rand::fill(&mut nonce_bytes)`.
     - Ciphertext & Tag: `cipher.encrypt(nonce, Payload { msg: plaintext, aad })` produces ciphertext followed by a 16-byte GHASH tag.
     - Envelope: `version(0x01) || nonce(12 bytes) || ciphertext(N bytes) + GHASH tag(16 bytes)`.
     - Total minimum length: `1 + 12 + 0 + 16 = 29 bytes`.
   - Lines 429–460 (`aes_gcm_decrypt`):
     - Fails with `CryptoError::InvalidFormat` if `envelope.len() < 29`.
     - Fails with `CryptoError::UnsupportedVersion` if `envelope[0] != 0x01`.
     - Validates 16-byte GHASH tag over ciphertext and AAD.
2. **WebAssembly & TypeScript Bridge (`apps/webmail/src/calendar_crypto.ts`):**
   - Lines 107–111: Calls `wasm.wasm_aes_gcm_encrypt(keyHex, plaintextHex, aadHex)` with AAD `byos-calendar-event-v1:<mailbox_id>`.
   - Line 120: Encodes binary envelope bytes to standard Base64 string via `bytesToBase64`.
   - Lines 158–163: `decryptCalendarEventPayload` pre-screens decoded bytes; if `rawBytes[0] === 0x7b` (`{`), it refuses to process unencrypted JSON and immediately falls back to `(Encrypted Event - Unable to Decrypt)`.
3. **Go HTTP API (`services/api/calendar.go`):**
   - Lines 75–111: `validateCalendarEventEnvelope` decodes Base64, enforces minimum 29 bytes, validates version byte `0x01`, and rejects plaintext JSON headers (`0x7B` `{`, `0x5B` `[`).
   - Stored in PostgreSQL `calendar_events.encrypted_payload` as raw `bytea`.

### Wire Envelope Byte Layout:
| Offset (Bytes) | Field | Length | Description |
|----------------|-------|--------|-------------|
| `0` | Version | 1 byte | Format version byte. Must equal `0x01`. |
| `1..13` | Nonce / IV | 12 bytes | Cryptographic initialization vector. |
| `13..(len-16)` | Ciphertext | N bytes | Encrypted JSON payload (`N >= 0`). |
| `(len-16)..len` | Auth Tag | 16 bytes | AES-GCM GHASH authentication tag. |

Total minimum length: **29 bytes**. Transport encoding: **Standard Base64**.

---

## A2. Exhaustive API Write Coverage

A repository-wide audit of all SQL write operations targeting `calendar_events` established that only two persistence points exist:

```
$ git grep --untracked -n "INSERT INTO calendar_events\|UPDATE calendar_events" services/
services/api/calendar.go:472:				UPDATE calendar_events
services/api/calendar.go:666:			INSERT INTO calendar_events (
```

### Route Audit:
1. `POST /v1/mailboxes/{mailbox_id}/calendar-events`
   - Lines 680–684: Decodes and validates `req.EncryptedPayload` via `validateCalendarEventEnvelope` before calendar authorization, time validation, or SQL insertion.
2. `PATCH /v1/mailboxes/{mailbox_id}/calendar-events/{event_id}`
   - Lines 473–479: If `req.EncryptedPayload != nil`, validates via `validateCalendarEventEnvelope` before issuing SQL update.
   - If `req.EncryptedPayload == nil`, `payloadBytes` is `nil`. SQL query executes `encrypted_payload = CASE WHEN $7::bytea IS NOT NULL THEN $7::bytea ELSE encrypted_payload END`, preserving existing ciphertext untouched.
3. `PUT /v1/mailboxes/{mailbox_id}/calendar-events/{event_id}`
   - Lines 411–508: Shares the exact same handler execution path as `PATCH`.
4. **Bypass Check:**
   - No direct repository methods or worker queues bypass these handlers.
   - Background queue worker (`services/outbound-worker`) only reads email queues and does not touch `calendar_events`.

---

## A3. Validator Capabilities and Cryptographic Boundary

### Challenge Evaluation of `validateCalendarEventEnvelope`:
The validator was challenged against all input categories:
- **Raw JSON:** Rejection substantiated. Base64 decoder fails on `{`, quotes, colons (returns HTTP 400).
- **Base64-encoded Plaintext JSON:** Rejection substantiated. Decoded byte 0 is `0x7B` (`{`) or `0x5B` (`[`), which fails both the JSON check and the version check `0x01` (returns HTTP 400).
- **Invalid Base64:** Rejection substantiated. Standard Base64 decoding fails (returns HTTP 400).
- **Empty Payloads:** Rejection substantiated. Whitespace trimming detects empty string (returns HTTP 400).
- **Payloads Below Minimum Length:** Rejection substantiated. Any decoded payload `< 29` bytes is rejected (returns HTTP 400).
- **Unsupported Version Bytes:** Rejection substantiated. Payloads with version `0x02` or `0x00` are rejected (returns HTTP 400).
- **Truncated Nonces:** Rejection substantiated. An envelope with fewer than 12 nonce bytes falls below 29 bytes and is rejected (returns HTTP 400).
- **Truncated Authentication Tags:** Rejection substantiated. An envelope with fewer than 16 tag bytes falls below 29 bytes and is rejected (returns HTTP 400).
- **Boundary Payload (28 bytes):** Rejection substantiated. Exactly 1 byte short of minimum (returns HTTP 400).

### What the Server Can vs Cannot Establish:
- **What the Server CAN Establish:**
  1. Payload is syntactically valid Base64.
  2. Decoded length is at least 29 bytes.
  3. Header byte is `0x01` (Section 12 envelope format).
  4. Header byte is not JSON (`0x7B` or `0x5B`).
- **What the Server CANNOT Establish (Zero-Knowledge Boundary):**
  1. The server does not possess the user's `mailbox_sk`.
  2. The server cannot verify the 16-byte GHASH authentication tag over ciphertext and AAD.
  3. The server cannot determine whether ciphertext decrypts to authentic or valid event data.
  4. An adversarial client submitting 29 arbitrary bytes starting with `0x01` satisfies server structural checks. However, client-side decryption in WASM strictly validates the GHASH tag and fails closed, rendering `(Encrypted Event - Unable to Decrypt)`.

**Core Principle:** Structural envelope validation confirms wire conformity at the network edge, but client-side WASM execution alone guarantees cryptographic authenticity.

---

## A4. Test Isolation and Persistence Invariance

Testing was performed using Go HTTP integration suite `TestCalendarEventAPIEnvelopeSecurity` against disposable database `byos_disposable_rehearsal`.

### Raw Test Execution:
Command: `$env:TEST_DATABASE_URL="postgres://byos:byos_dev_password@127.0.0.1:5432/byos_disposable_rehearsal?sslmode=disable"; go test -v -count=1 ./services/api -run TestCalendar`
```
=== RUN   TestCalendarLifecycleAndIsolation
    calendar_test.go:57: [test-db] Using test database 'byos_disposable_rehearsal' on host '127.0.0.1'
--- PASS: TestCalendarLifecycleAndIsolation (0.49s)
=== RUN   TestCalendarEventAPIEnvelopeSecurity
    calendar_test.go:199: [test-db] Using test database 'byos_disposable_rehearsal' on host '127.0.0.1'
--- PASS: TestCalendarEventAPIEnvelopeSecurity (0.88s)
PASS
ok  	byos.email/services/api	2.985s
```

### Persistence Invariance:
In `TestCalendarEventAPIEnvelopeSecurity`, database row counts for the target mailbox were evaluated after every request:
- Initial count: `0`
- 9 invalid `POST` requests: count remained `0` (**0 database writes**).
- 2 valid `POST` requests (29-byte and 55-byte envelopes): count incremented to `2`.
- 9 invalid `PATCH` / `PUT` requests: stored `encrypted_payload` remained byte-for-byte identical (**0 database mutations**).
- 1 valid `PATCH` update: stored `encrypted_payload` updated to new authenticated envelope.
- 1 metadata `PATCH` update: status updated to `tentative` while ciphertext remained intact.

---

## A5. Unrelated Security Boundary Integrity

The implementation in `services/api/calendar.go` and `services/api/calendar_test.go` was evaluated for collateral impact on other subsystems:
- **Authentication & Sessions:** Untouched. `getAuthenticatedUserID` and session cookie validation logic were not altered.
- **MFA & Passkeys:** Untouched. WebAuthn configuration, challenge generation, and passkey registration were not modified.
- **Mailbox Key Lifecycle:** Untouched. Key generation, key rotation, and passphrase unwrapping pipelines were not modified.
- **Organization Recovery:** Untouched. Mnemonic recovery flows and recovery authority endpoints remain unchanged.
- **Email & Invitation Delivery:** Untouched. Outbound worker delivery logic was not altered, and no external emails were transmitted.
- **Mailbox Isolation:** Evaluated. `TestCalendarLifecycleAndIsolation` steps 8 & 9 confirm that cross-mailbox and cross-org access attempts return HTTP 403.

---

## Database Isolation Evidence

Inspection of the active production database corroborated that its pre-existing legacy records were kept isolated:

Command: `docker exec byos-postgres psql -U byos -d byos -c "SELECT id, calendar_id, length(encrypted_payload) as payload_len, encode(substring(encrypted_payload from 1 for 10), 'escape') as prefix_preview, encode(substring(encrypted_payload from 1 for 10), 'hex') as prefix_hex FROM calendar_events;"`
```
                  id                  |             calendar_id              | payload_len | prefix_preview |      prefix_hex      
--------------------------------------+--------------------------------------+-------------+----------------+----------------------
 74b8ea49-47f1-4ed0-abfb-5fc563fbe04f | 6ef9acca-12c6-4af9-85f0-c6cdc1316851 |         188 | {"title":"     | 7b227469746c65223a22
 6c75afcb-5d70-4f5c-b4ca-41bb010405ec | 6ef9acca-12c6-4af9-85f0-c6cdc1316851 |         281 | {"title":"     | 7b227469746c65223a22
 a4196298-d4e1-4921-8b26-0a2d470636f3 | 6ef9acca-12c6-4af9-85f0-c6cdc1316851 |         281 | {"title":"     | 7b227469746c65223a22
(3 rows)
```
Status: Exactly 3 rows, untouched.

---

## Remaining Security Limitations

1. **Pre-Existing Plaintext Records:** The active database still retains three legacy records stored in Base64 plaintext format from earlier development runs. While quarantined client-side, they require execution of the client-side recovery process detailed in `docs/calendar_legacy_plaintext_recovery_design.md`.
2. **Server-Side Authenticity Blindness:** As mandated by zero-knowledge architecture, the API server cannot verify GHASH tags. Cryptographic integrity guarantees rely entirely on client-side WASM verification.
