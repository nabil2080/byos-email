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
| `status` | enum | — | One of: `active`, `disabled`, `recovering`, `private`. See Section 4. |
| `updated_at` | timestamp (RFC 3339) | — | Last time this record was updated. |

### 2.1 Status Values

| Status | Meaning |
|---|---|
| `active` | Normal. Senders can look up and encrypt to this mailbox. |
| `disabled` | Mailbox is suspended or deactivated. Lookup returns `410 Gone`. |
| `recovering` | Key rotation or recovery is in progress. Callers should retry after 60 seconds. |
| `private` | Mailbox has opted out of directory listing. Lookup returns `404 Not Found`. |

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
| `404 Not Found` | Email address not found, or mailbox status is `private`. |
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
`private` mailboxes return `404` identical to non-existent addresses to prevent
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
