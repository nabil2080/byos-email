# BYOS Key Directory Specification

**Document ID:** `BYOS-SPEC-KEY-DIR-V1`  
**Status:** DRAFT  
**Date:** 2026-09-20  
**Scope:** Public key directory for internal BYOS-to-BYOS end-to-end encrypted mail.  
**Relationship:** This document describes the directory that publishes keys whose wire format is
defined in `docs/crypto/envelope-v1-spec.md`.

---

## 1. Purpose

Internal BYOS-to-BYOS mail requires the sender's client to know the recipient's
X-Wing public key before encryption. Without this, the client cannot construct
the `enc` field of the cryptographic envelope (Section 2 of `envelope-v1-spec.md`).

The key directory maps email addresses to current public keys. It is the sole
authoritative source for:
- The recipient's current X-Wing public key (`pk_XWing`, 1216 bytes)
- The associated `key_id` and `key_epoch` to populate envelope fields
- The recipient's Ed25519 signing public key for sender signature verification

The directory is **server-hosted**. This introduces a key substitution risk documented
in Section 5 below and in Section 16 of the BYOS Architecture Roadmap.

---

## 2. Directory Record

Each active mailbox has exactly one current directory record. All fields are required
unless noted.

| Field | Type | Size | Description |
|---|---|---|---|
| `email_address` | string | — | Unique, case-insensitive. Normalized to lowercase before storage and lookup. |
| `key_id` | string (UUID) | 36 chars | Stable mailbox identifier. Never changes across key rotations. Matches `key_id` in envelope `envelope-v1-spec.md §2.1`. |
| `key_epoch` | uint32 | 4 bytes | Monotonic key rotation counter, starting at 1. Matches `key_epoch` in envelope. Epoch 0 is reserved and rejected. |
| `xwing_public_key` | bytes | 1216 bytes | X-Wing public key: `pk_M (1184 bytes) \|\| pk_X (32 bytes)` per `envelope-v1-spec.md §5.4`. Encoded as standard Base64 in API responses. |
| `ed25519_signing_public_key` | bytes | 32 bytes | Ed25519 verifying key for sender signature verification. Encoded as standard Base64. |
| `signing_key_epoch` | uint32 | 4 bytes | Monotonic counter for signing key rotations. Independent of `key_epoch`. |
| `status` | enum | — | One of: `active`, `disabled`, `recovering`, `unlisted`. See Section 4. |
| `updated_at` | timestamp (RFC 3339) | — | Last time this record was updated. |

### 2.1 Status Values

| Status | Meaning |
|---|---|
| `active` | Normal. Senders can look up and encrypt to this mailbox. |
| `disabled` | Mailbox is suspended or deactivated. Lookup returns `410 Gone`. |
| `recovering` | Key rotation or recovery is in progress. Callers should retry after 60 seconds. |
| `unlisted` | Mailbox owner has opted out of directory listing. Lookup returns `404 Not Found`. |

> Note: `unlisted` is a directory-listing preference, independent of 
> `mailboxes.mode` (which governs recovery capability). A mailbox with 
> `mode = 'private'` can still be `status = 'active'` in the directory 
> — it means the org cannot recover the mailbox, not that senders 
> cannot encrypt to it.

---

## 3. API

All endpoints require an authenticated BYOS session (JWT bearer token).
Directory lookups are not available unauthenticated — this limits enumeration by
external parties (see Section 6).

### 3.1 Get Current Record

```
GET /v1/keys/:email
```

**Path parameter:** `:email` — the recipient's email address (URL-encoded).

> **Alias resolution:** If the email address resolves to an alias rather 
> than a direct mailbox, the directory returns the directory record of 
> the underlying mailbox. Aliases do not have their own keys — they 
> share the mailbox's keys.

**Success response — 200 OK:**
```json
{
  "key_id": "eeeeeeee-0000-0000-0000-000000000001",
  "key_epoch": 1,
  "xwing_public_key": "<base64, 1216 bytes decoded>",
  "ed25519_signing_public_key": "<base64, 32 bytes decoded>",
  "signing_key_epoch": 1,
  "status": "active",
  "updated_at": "2026-09-20T06:10:00Z"
}
```

**Error responses:**
| Code | Condition |
|---|---|
| `404 Not Found` | Email address not found, or mailbox status is `unlisted`. |
| `410 Gone` | Mailbox is `disabled`. The address existed but is no longer active. |
| `429 Too Many Requests` | Rate limit exceeded. See Section 3.3. |

### 3.2 Get Key History

```
GET /v1/keys/:email/history
```

Returns an ordered list of all key epochs for this mailbox, from epoch 1 to current.
Used by recipients verifying signatures on historical messages after a key rotation.

**Success response — 200 OK:**
```json
{
  "key_id": "eeeeeeee-0000-0000-0000-000000000001",
  "history": [
    {
      "key_epoch": 1,
      "xwing_public_key": "<base64>",
      "ed25519_signing_public_key": "<base64>",
      "signing_key_epoch": 1,
      "valid_from": "2026-09-01T00:00:00Z",
      "rotated_at": null
    }
  ]
}
```

### 3.3 Rate Limiting

To limit bulk key harvesting:
- Per authenticated user: 60 lookups per minute, 1000 per hour.
- Per IP: 20 lookups per minute (unauthenticated probes are rejected at auth layer).
- `Retry-After` header is returned on `429` responses.

### 3.4 Error Response Format

All error responses (400, 401, 404, 409, 410, 429) use a consistent 
JSON body:

```json
{
  "error": "short_machine_readable_code",
  "message": "human-readable explanation"
}
```

Codes:
- `not_found` — email not in directory
- `gone` — mailbox disabled
- `unauthorized` — no valid session
- `rate_limited` — rate limit exceeded
- `invalid_key` — malformed key in request
- `stale_epoch` — published epoch not greater than current
- `forbidden` — attempting to publish for another user

### 3.5 HTTP Caching Headers

Directory responses SHOULD include:

```
Cache-Control: private, max-age=300
ETag: "<key_id>:<key_epoch>:<signing_key_epoch>"
```

The 300-second max-age matches the client-side cache TTL in Section 4.1. 
Clients that respect HTTP caching will not need separate cache logic.

When key_epoch or signing_key_epoch changes, the ETag changes and caches 
invalidate naturally.

---

## 4. Update Semantics

### 4.1 Key Rotation

When a mailbox rotates its encryption key:
1. The current record is promoted to history with `rotated_at = now()`.
2. A new record is inserted with `key_epoch = old_epoch + 1` and the new public key.
3. The directory serves the new record immediately on next `GET /v1/keys/:email`.

Senders who cached the old key are notified of the rotation on their next send attempt:
- The outbound worker detects a `key_epoch` mismatch between the cached key and the
  current directory record.
- The client receives a `key_epoch_changed` event and must re-fetch and re-encrypt.

**Cache TTL:** Client-side directory cache MUST NOT exceed **5 minutes**. Stale caches
longer than 5 minutes risk encrypting to a rotated or revoked key.

### 4.2 Key Revocation

Setting a mailbox to `disabled` status takes effect immediately. All cached entries
for that address should be invalidated by the cache TTL (≤5 minutes). There is no
active push invalidation in V1.

### 4.3 Key Publication

When a mailbox is created, or when its keys rotate, the client publishes 
its public keys to the directory.

**Endpoint:**
```
PUT /v1/keys/me
```

**Authentication:** Authenticated BYOS session. The endpoint only accepts 
publication for the caller's own mailbox — you cannot publish keys for 
another user.

**Request body:**
```json
{
  "xwing_public_key": "<base64, 1216 bytes decoded>",
  "ed25519_signing_public_key": "<base64, 32 bytes decoded>",
  "key_epoch": 1,
  "signing_key_epoch": 1
}
```

**Validation:**
- `xwing_public_key` must decode to exactly 1216 bytes
- `ed25519_signing_public_key` must decode to exactly 32 bytes
- First publication (no existing record): `key_epoch >= 1` and 
  `signing_key_epoch >= 1`
- Subsequent publication (record exists): `key_epoch > current_key_epoch` 
  and `signing_key_epoch > current_signing_key_epoch`

**Behavior:**
- On first publication: insert new directory record, status = 'active'
- On rotation: insert new epoch into history, update current record
- On conflict (stale epoch): return 409 Conflict

**Success response — 200 OK:**
```json
{
  "key_id": "<mailbox UUID>",
  "key_epoch": 2,
  "signing_key_epoch": 1,
  "updated_at": "2026-09-23T10:30:00Z"
}
```

**Error responses:**
| Code | Condition |
|---|---|
| 400 Bad Request | Malformed base64, wrong key length, or missing field |
| 401 Unauthorized | No valid session |
| 409 Conflict | Submitted epoch is <= current epoch |
| 429 Too Many Requests | Rate limit exceeded |

**Rate limiting:** 10 publications per hour per mailbox. Publication is 
rare (only on mailbox creation or key rotation).

**Relationship to key generation:** The client generates its X-Wing 
and Ed25519 keys locally (see Section 12 of the roadmap). The keys never 
leave the client in private form. Only public keys are published.

**Atomicity:** Publication is a single transaction. If the history insert 
succeeds but the current-record update fails, the whole operation rolls 
back.

---

## 5. Key Substitution Risk

The key directory is server-hosted. A compromised or legally coerced BYOS server
could substitute a different public key for a recipient, causing the sender to
encrypt to a key controlled by the attacker rather than the intended recipient.

**This is the fundamental limitation of a server-hosted directory.** Post-quantum
cryptography (X-Wing) does not mitigate this — the attack is against the directory
trust model, not the cryptographic algorithm.

**V1 position:** Accepted. This risk is documented here and in Section 16 of the
BYOS Architecture Roadmap. Users who require stronger guarantees should be informed
of this limitation.

**V1.5 mitigation:** An append-only cryptographic transparency log. Every key
publication and rotation is appended to a public, tamper-evident log. Senders can
verify that the public key they received is consistent with what the log recorded,
making undetected substitution significantly harder.

---

## 6. Privacy Considerations

### 6.1 Lookup Metadata Leakage

Every directory lookup reveals:
- That an authenticated BYOS user looked up a specific email address.
- The timestamp of the lookup.
- The IP address of the requester.

This is **accepted V1 metadata leakage**. The server learns communication patterns
(who looked up whom) even though it cannot read message content.

**V1 position:** Documented and accepted. Authenticated-only lookups reduce exposure
compared to open directories, but do not eliminate metadata leakage.

**V1.5 mitigation:** Private Information Retrieval (PIR) or oblivious lookups.
These are complex and out of scope for V1.

### 6.2 Directory Enumeration

The directory does not support listing or search — only exact-match lookup by email
address. Combined with authentication requirements, this limits bulk enumeration.
`unlisted` mailboxes return `404` identical to non-existent addresses to prevent
probing.

---

## 7. External Mail

Path B (BYOS to external recipients, e.g. Gmail, Outlook) does **not** use the
key directory. External recipients have no BYOS public keys; their mail is delivered
via SMTP with a transient plaintext window as described in Section 7 of the Roadmap.

The key directory is exclusively for Path A (internal BYOS-to-BYOS) mail.

---

## 8. Relationship to Envelope Spec

The key directory publishes the inputs that the sender's client uses to populate
the cryptographic envelope (`docs/crypto/envelope-v1-spec.md`):

| Envelope field | Source in directory record |
|---|---|
| `key_id` | `key_id` from directory record |
| `key_epoch` | `key_epoch` from directory record |
| `alg` | Derived from key type: 1216-byte key → `HPKE-XWing-AES256GCM-v1` |
| `enc` | Computed by client during encapsulation; not stored in directory |
| `nonce` | Generated by client CSPRNG; not stored in directory |
| `ciphertext` | Computed by client; not stored in directory |
| `sig` | Computed using `ed25519_signing_public_key` (V1.5) |

The **envelope spec** (`envelope-v1-spec.md`) remains the sole source of truth for
wire format. This directory spec describes only the key publication mechanism.

---

## 9. Out of Scope (V1)

The following are explicitly deferred to V1.5 or later:

- Transparency log for key substitution detection
- PIR / oblivious directory lookups
- Cross-organization key federation
- Key revocation push notifications (V1 relies on TTL)
- Multi-device key synchronization (handled by mailbox key wrapping, not directory)

---

## 10. Implementation Notes

This spec defines the interface but not the storage. Implementation must:

1. Add `mailboxes.mailbox_signing_pk bytea` (32-byte Ed25519 public key)
2. Add `mailboxes.signing_key_epoch integer NOT NULL DEFAULT 1`
3. Create `mailbox_key_history` table with columns:
   - mailbox_id (UUID, references mailboxes)
   - key_epoch (integer)
   - xwing_public_key (bytea, 1216 bytes)
   - ed25519_signing_public_key (bytea, 32 bytes)
   - signing_key_epoch (integer)
   - valid_from (timestamp)
   - rotated_at (timestamp, nullable)
   - PRIMARY KEY (mailbox_id, key_epoch)

4. Backfill existing mailboxes: for each mailbox with a non-null 
   `mailbox_xwing_pk`, insert a `mailbox_key_history` row with:
   - `key_epoch` = current `mailboxes.mailbox_sk_version`
   - `xwing_public_key` = current `mailboxes.mailbox_xwing_pk`
   - `ed25519_signing_public_key` = NULL
   - `signing_key_epoch` = 0
   - `valid_from` = `mailboxes.created_at` (or now() if unknown)
   - `rotated_at` = NULL
   
   Also update `mailboxes.mailbox_signing_pk` to NULL and 
   `mailboxes.signing_key_epoch` to 0.
   
   Interpretation: `signing_key_epoch = 0` means "no signing key has 
   been published." Clients generate and publish signing keys on next 
   login, at which point `signing_key_epoch` increments to 1 or higher.
