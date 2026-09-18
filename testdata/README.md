# Test Data: Cross-Language Parity Vectors

This directory contains deterministic test vector suites used to verify cryptographic parity across implementations (Go backend and Rust workers/libraries).

## File: `cross_language_vectors.json`

### Purpose and Usage
`cross_language_vectors.json` provides deterministic end-to-end test vectors for BYOS crypto envelopes (`BYOS-SPEC-CRYPTO-ENV-V1`):
1. **Go Test Suite**: Executed in `crypto/hpke/cross_language_test.go` (`TestVerifyCrossLanguageVectors`).
2. **Rust Test Suite**: Consumed in Phase 2 cross-language parity integration tests to ensure byte-for-byte interoperability between Go and Rust implementations.

### Test-Only Warning
> **WARNING: TEST-ONLY KEYS.**
> All private keys, seeds (`plaintext_seed_hex`, `test_only_eseed_hex`), and keypairs in this file are deterministically generated fixtures for testing and verification only. They MUST NEVER be used as production secrets.

Every test vector includes `"_test_only": true`, and all private key fields are explicitly prefixed with `test_only_` (`test_only_recipient_private_key_hex`, `test_only_ephemeral_private_key_hex`, `test_only_eseed_hex`).

---

## Vector Schema & Structure

The file is structured as a top-level JSON object:
```json
{
  "_warning": "TEST-ONLY KEYS...",
  "vectors": [ ... ]
}
```

Each vector contains common envelope metadata and test inputs:
- `id`: Unique identifier (e.g. `x25519-standard-01`, `xwing-edge-1mb-plaintext`).
- `description`: Human-readable description of the vector.
- `_test_only`: Boolean flag indicating test-only data.
- `algorithm`: Cryptographic suite (`HPKE-X25519-AES256GCM-v1` or `HPKE-XWing-AES256GCM-v1`).
- `key_id`: Sovereign mailbox key identifier (e.g. `mbx_x25519_001`).
- `key_epoch`: Sovereign key epoch number.
- `recipient_public_key_hex`: Recipient public key (32 bytes for X25519; 1216 bytes for X-Wing).
- `test_only_recipient_private_key_hex`: Recipient private key (32 bytes for X25519; 32-byte seed for X-Wing).
- `test_only_ephemeral_private_key_hex`: Ephemeral private key (32 bytes, for X25519).
- `test_only_eseed_hex`: Ephemeral seed (64 bytes, for X-Wing ML-KEM-768 + X25519).
- `nonce_hex`: 12-byte deterministic AEAD nonce.

### Full Vectors vs. Hash-Only Vectors

To keep the repository and test vector file lightweight (< 200 KB) while supporting large payload verification (such as 1 MB message envelopes), vectors are divided into two formats:

#### 1. Full Vectors (Standard & Small Payloads)
Used for standard messages and 0-byte edge cases:
- `plaintext`: String representation of plaintext (if UTF-8).
- `plaintext_hex`: Hex-encoded plaintext payload.
- `plaintext_len`: Length of plaintext in bytes.
- `expected_aad_hex`: Hex-encoded canonical Additional Authenticated Data (AAD).
- `expected_envelope_canonical`: Exact canonical JSON serialized envelope string.
- `expected_envelope`: Parsed JSON object of the envelope.

Test verification asserts exact string and byte equality for canonical JSON, AAD, and decrypted plaintext.

#### 2. Hash-Only Vectors (Large Payloads, e.g. 1 MB)
Used for 1,048,576 byte (1 MB) payload edge cases (`x25519-edge-1mb-plaintext` and `xwing-edge-1mb-plaintext`):
- `plaintext_seed_hex`: 32-byte seed used to derive the plaintext dynamically.
- `plaintext_size`: Expected size in bytes (`1048576`).
- `plaintext_sha256`: SHA-256 hex digest of the dynamically expanded plaintext.
- `expected_envelope_sha256`: SHA-256 hex digest of the canonical JSON serialized envelope.

The plaintext and canonical envelope JSON are NOT stored in the file, keeping the vector under 1 KB.

---

## Plaintext Derivation Algorithm (Hash-Only Vectors)

RFC 5869 limits a single `HKDF-Expand` call to `255 * HashLen = 8160` bytes for SHA-256. To generate deterministic large payloads without exceeding RFC 5869 limits or relying on non-standard chunking:

1. Divide the requested `plaintext_size` into 4096-byte chunks (256 chunks for 1 MB).
2. For each chunk index `i` from `0` to `ceil(size / 4096) - 1`:
   - Compute `chunk_info = fmt.Sprintf("byos-test-plaintext-%d", i)` (UTF-8 bytes of `"byos-test-plaintext-{i}"`).
   - Derive `chunk = HKDF-Expand-SHA256(PRK=seed, info=chunk_info, length=min(4096, remaining))`.
3. Concatenate all chunks in order to obtain the complete plaintext.
4. Verify `SHA256(plaintext) == plaintext_sha256`.

### Verification Procedure (Hash-Only Vectors)
1. Derive plaintext from `plaintext_seed_hex` and assert `SHA256(plaintext) == plaintext_sha256`.
2. Deterministically seal the plaintext using the specified keys, algorithm, and nonce.
3. Serialize the resulting envelope to canonical JSON (`MarshalCanonical`).
4. Assert `SHA256(canonical_json) == expected_envelope_sha256`.
5. Decrypt the envelope using recipient private key / seed (`Open`) and assert byte-for-byte equality with derived plaintext.

---

## Regenerating Vector Suite

To regenerate `cross_language_vectors.json`:

```bash
go test -run TestGenerateAndSaveCrossLanguageVectors ./crypto/hpke
```
