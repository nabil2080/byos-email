# BYOS Cryptographic Specification: Versioned Crypto Envelope v1

**Document ID:** `BYOS-SPEC-CRYPTO-ENV-V1`  
**Status:** FROZEN (Pending Approval)  
**Date:** 2026-09-18  
**Scope:** Wire format, authenticated data construction, hybrid KEM interface, and error semantics for all encrypted mailbox objects.  
**Audience:** Go backend engineers, Rust/Wasm crypto engineers, client application engineers.

---

## 1. Objective & Architectural Boundary

In the BYOS zero-knowledge email architecture, customer mailbox objects stored in persistent customer-controlled storage (Amazon S3, Cloudflare R2, Google Drive, or MinIO) MUST be encrypted before transit and storage.

The cryptographic envelope defined in this specification serves as the immutable wire format for:
1. Inbound messages ingested and sealed by server workers to mailbox public keys.
2. Stored mailbox objects downloaded and decrypted client-side inside the Rust WebAssembly module.
3. Client-to-client or device-to-storage encrypted envelopes.

Changing this wire format after deployment requires cryptographic re-encryption of all historical mailbox data. Therefore, this specification is **FROZEN** and serves as the single source of truth across Go and Rust implementations.

---

## 2. Envelope Wire Format (v1)

### 2.1 JSON Schema

Every encrypted mailbox payload is serialized as a single JSON object containing exactly the following 8 fields:

| Field | Type | Encoding | Required | Description |
|---|---|---|---|---|
| `v` | `uint8` | Integer | Yes | Envelope schema version. MUST be exactly `1` for this specification. |
| `alg` | `string` | UTF-8 String | Yes | Cryptographic algorithm identifier (see Section 5). |
| `key_id` | `string` | UTF-8 String | Yes | Stable mailbox identifier (UUID or normalized ID). Never changes across rotations. |
| `key_epoch` | `uint32` | Integer | Yes | Monotonic key rotation counter starting at `1`. Epoch `0` is reserved and rejected. |
| `enc` | `string` | Standard Base64 | Yes | KEM encapsulation output (ephemeral public key or hybrid ciphertext bytes). |
| `nonce` | `string` | Standard Base64 | Yes | 96-bit (12-byte) AES-GCM nonce. |
| `ciphertext` | `string` | Standard Base64 | Yes | AES-256-GCM ciphertext output concatenated with 16-byte authentication tag. |
| `sig` | `base64 or null` | Standard Base64 or null | Yes | Sender signature. Always null in V1. |

### 2.2 Canonical JSON Serialization Rules

When serializing `CryptoEnvelope` for transmission, hashing, or canonical comparison:
1. **Lexicographical Key Ordering:** Keys MUST appear in strict lexicographical order:
   ```
   "alg" -> "ciphertext" -> "enc" -> "key_epoch" -> "key_id" -> "nonce" -> "sig" -> "v"
   ```
2. **No Extraneous Whitespace:** No spaces or tabs between keys, colons, commas, or string delimiters.
3. **No Trailing Newline:** The string terminates immediately after the closing brace `}`.
4. **UTF-8 Encoding:** All strings must be valid, well-formed UTF-8 without byte-order marks (BOM).
5. **Base64 Standard:** All base64 fields (`enc`, `nonce`, `ciphertext`, and `sig` if non-null) MUST use standard Base64 encoding with `=` padding (`RFC 4648 §4`). Unpadded or URL-safe base64 without negotiation is rejected.

#### Canonical Example
```json
{"alg":"HPKE-X25519-AES256GCM-v1","ciphertext":"7q2...w==","enc":"3m1...Q==","key_epoch":1,"key_id":"mbx_01h7abc123","nonce":"dGhpczEyd29yZHM=","sig":null,"v":1}
```

---

## 3. Additional Authenticated Data (AAD) Construction

To mathematically prevent ciphertext-reuse attacks, algorithm substitution, key-epoch downgrade, and cross-mailbox replays, the AES-256-GCM authenticated cipher MUST bind all envelope metadata via Additional Authenticated Data (AAD).

### 3.1 Strict Binary Layout (Immutable)

The AAD is a packed binary buffer constructed deterministically before encryption and verified before decryption:

```
+-------------------------------------------------------------------------+
| Offset (Bytes) | Field            | Type         | Description          |
+-------------------------------------------------------------------------+
| 0              | v                | 1 byte       | uint8 (0x01)         |
| 1              | alg_length       | 1 byte       | uint8 (length of alg)|
| 2 .. 2+n       | alg              | n bytes      | UTF-8 string bytes   |
| pos            | key_id_length    | 1 byte       | uint8 (len of key_id)|
| pos .. pos+m   | key_id           | m bytes      | UTF-8 string bytes   |
| pos            | key_epoch        | 4 bytes      | uint32 (Big-Endian)  |
| pos            | enc_length       | 4 bytes      | uint32 (Big-Endian)  |
| pos .. pos+k   | enc              | k bytes      | Raw decoded bytes    |
| pos            | nonce_length     | 1 byte       | uint8 (= 12, 0x0C)   |
| pos .. pos+12  | nonce            | 12 bytes     | Raw 12 nonce bytes   |
+-------------------------------------------------------------------------+
```

### 3.2 Formal Construction Invariants
1. `alg_length` and `key_id_length` are single unsigned bytes (`uint8`), strictly limiting `alg` to 255 bytes and `key_id` to 255 bytes.
2. `key_epoch` is encoded as a 4-byte big-endian integer (`uint32`).
3. `enc_length` is encoded as a 4-byte big-endian integer (`uint32`) representing the length of `enc` in **raw binary bytes** (not base64 characters).
4. `enc` contains the raw decoded binary bytes of the KEM encapsulation output.
5. `nonce_length` MUST be exactly `12` (`0x0C`). Any other value triggers `InvalidNonceLength (1004)`.
6. `nonce` contains the exact 12 raw bytes used for AES-GCM.
7. Both Go (`internal/crypto`) and Rust (`apps/wasm-crypto`) MUST produce byte-identical AAD buffers for any given envelope. If any single bit in the AAD differs, AES-GCM tag verification fails, returning `AADMismatch (1010)` or `DecryptionFailed (1006)`.

---

## 4. Nonce Generation & Lifecycle Policy

### 4.1 Specification
- **Nonce Size:** 96 bits (12 bytes) strictly.
- **Source:** Cryptographically secure pseudorandom number generator (CSPRNG):
  - Go: `crypto/rand.Reader`
  - Rust: `getrandom` / `OsRng`
- **Construction:** Random nonces are generated per message. Nonce reuse with the same symmetric key destroys AES-GCM authenticity and exposes the XOR of plaintexts.

### 4.2 Mathematical Bound & Security Justification
- For 96-bit random nonces, the probability $P$ of at least one collision after generating $N$ nonces under the same symmetric key is bounded by the birthday paradox:
  $$P \approx 1 - \exp\left(-\frac{N^2}{2 \times 2^{96}}\right) \approx \frac{N^2}{2^{97}}$$
- At $N = 2^{32}$ messages, collision probability reaches $\approx 2^{-33}$, which exceeds NIST SP 800-38D recommended safety thresholds for random nonces.
- **Enforced Policy Limits:**
  1. **Per-Key Message Bound:** No more than $2^{30}$ messages ($1,073,741,824$) may be encrypted under a single `(key_id, key_epoch)` pair. This guarantees a collision probability $P < 2^{-37}$ (over $4\times$ margin of safety below $2^{32}$).
  2. **Monitoring Threshold:** The ingestion telemetry system MUST trigger a high-severity alert when any mailbox key epoch reaches $2^{28}$ messages ($268,435,456$).
  3. **Mandatory Key Rotation:** A key rotation ceremony MUST execute before an epoch exceeds $2^{30}$ messages, producing `key_epoch + 1` with a fresh root-derived key pair.

---

## 5. Cryptographic Algorithm Suites

To prevent confusion with external draft iterations, algorithm identifiers use BYOS internal versioning:

| Identifier | Cryptographic Suite Definition | Upstream Specification |
|---|---|---|
| `HPKE-X25519-AES256GCM-v1` | RFC 9180 HPKE Mode `0x0000` (Base Mode):<br>&bull; KEM: `DHKEM(X25519, HKDF-SHA256)` (`0x0020`)<br>&bull; KDF: `HKDF-SHA256` (`0x0001`)<br>&bull; AEAD: `AES-256-GCM` (`0x0002`) | RFC 9180 |
| `HPKE-XWing-AES256GCM-v1` | Post-Quantum Hybrid KEM:<br>&bull; Hybrid KEM: X25519 + ML-KEM-768 (FIPS 203)<br>&bull; Key Combiner: SHA3-256 with domain label `\./^`<br>&bull; AEAD: `AES-256-GCM` | draft-connolly-cfrg-xwing-kem-02 / FIPS 203 |

### 5.1 `HPKE-X25519-AES256GCM-v1` (Classical Standard)
- **Library (Go):** `github.com/cloudflare/circl/hpke`
- **Library (Rust):** `hpke` crate (RFC 9180 compliant)
- **Encapsulation (`enc`):** 32 bytes (raw ephemeral X25519 public key).
- **Public Key:** 32 bytes (X25519 public key).
- **Private Key:** 32 bytes (X25519 static secret).

### 5.2 `HPKE-XWing-AES256GCM-v1` (Post-Quantum Hybrid)
- **Classical Primitive:** X25519 (32-byte secret, 32-byte public).
- **Post-Quantum Primitive:** ML-KEM-768 per NIST FIPS 203:
  - Public Key (`pk_M`): 1184 bytes.
  - Ciphertext (`ct_M`): 1088 bytes.
  - Shared Secret (`ss_M`): 32 bytes.
- **Combined Public Key:** `pk_XWing = pk_M (1184 bytes) || pk_X (32 bytes)` = 1216 bytes.
- **Combined Encapsulation (`enc`):** `enc = ct_M (1088 bytes) || ct_X (32 bytes)` = 1120 bytes.
- **Exact Combiner Definition:**
  ```
  ss_combined = SHA3-256(
      "\.//^\" ||          // 6-byte domain separation label (0x5c 0x2e 0x2f 0x2f 0x5e 0x22)
      ss_M ||              // ML-KEM-768 shared secret (32 bytes)
      ss_X ||              // X25519 shared secret (32 bytes)
      ct_X ||              // Ephemeral X25519 public key (32 bytes)
      pk_M ||              // Recipient ML-KEM-768 public key (1184 bytes)
      ct_M                 // ML-KEM-768 ciphertext (1088 bytes)
  )
  ```
  The resulting 32-byte `ss_combined` serves as the symmetric key for AES-256-GCM encryption with the binary AAD defined in Section 3.

---

## 6. Key Epoch Semantics & Lifecycle

1. **Identifier Stability:** `key_id` is assigned upon mailbox creation and remains globally stable for the entire lifecycle of the mailbox. It never changes during key rotation.
2. **Monotonic Epochs:** `key_epoch` starts at `1` on initial mailbox key generation. Every key rotation ceremony increments `key_epoch` monotonically (`2, 3, 4, ...`).
3. **Epoch 0 Reserved:** `key_epoch: 0` is strictly reserved. Any envelope with `key_epoch == 0` MUST be rejected with `UnknownKeyEpoch (1008)`.
4. **Client Key Ring:** Clients index their local private key cache by `(key_id, key_epoch)`.
5. **Unknown Epoch Handling:** If a client encounters an envelope with a higher `key_epoch` than currently present in its local key ring:
   - The client MUST NOT fail silently or corrupt the message.
   - The client MUST invoke the key recovery / sync flow to decrypt the updated epoch key using its stored root secret (`root_secret` or recovery credential).
   - If key derivation fails, return `UnknownKeyEpoch (1008)`.

---

## 7. Sender Signature Semantics (V1 vs V1.5)

To prepare for cryptographic sender authenticity and non-repudiation without breaking wire-format compatibility:

- **V1 Semantics:** The `sig` field MUST be `null`. A non-null `sig` in V1 is a protocol violation but MUST be tolerated (ignored) by V1 clients for forward compatibility.
- **V1.5 Semantics:** The `sig` field MAY be present as standard base64 of an Ed25519 signature:
  $$\text{sig} = \text{base64}\left(\text{Ed25519\_Sign}\left(\text{sender\_signing\_private\_key}, \text{AAD} \parallel \text{ciphertext}\right)\right)$$
  Note that the signature covers the raw binary concatenation of the AAD (defined in Section 3) and the raw ciphertext bytes. The `sig` field itself is strictly outside the AAD.
- **External Mail Boundary:** External internet mail cannot be signed; V1.5 signature verification applies strictly to BYOS-to-BYOS mail.

---

## 8. Version Negotiation & Evolution Policy

To guarantee forward compatibility and safe protocol evolution:

| Change Type | Envelope Schema Impact | Client Action |
|---|---|---|
| New optional metadata field | `v` remains `1` | Clients ignore unrecognized fields during parsing. |
| Field semantics or binary layout modified | `v` bumps to `2` | Clients without v2 support reject with `UnsupportedVersion (1001)`. |
| Field removed or made non-mandatory | `v` bumps to `2` | Clients without v2 support reject with `UnsupportedVersion (1001)`. |
| New algorithm suite added | `v` remains `1`, new `alg` string | Clients inspect `alg`. If unsupported, return `UnsupportedAlgorithm (1002)`. |
| Algorithm deprecated or retired | `v` remains `1` | Clients return `UnsupportedAlgorithm (1002)` with deprecation context. |

> **Forward compatibility:** V1 clients MUST accept envelopes with a non-null `sig` field and ignore it. V1 clients cannot verify signatures and fall back to V1 trust semantics. V1.5 clients MUST verify `sig` when present and reject the envelope with error 1011 (`InvalidSignature`) if verification fails.

**Strict Validation Rule:** Clients MUST NEVER attempt "best-effort" or lenient parsing on unknown versions. If `envelope.v != 1`, the parser MUST immediately halt and return `UnsupportedVersion (1001)`.

---

## 9. Standardized Error Code Table

Both Go backend and Rust/Wasm modules use an identical, unified error code mapping:

| Error Code | Identifier | Meaning & Trigger Condition |
|---|---|---|
| `1001` | `UnsupportedVersion` | Envelope version `v != 1`. |
| `1002` | `UnsupportedAlgorithm` | Algorithm `alg` is not recognized or not supported by this build. |
| `1003` | `InvalidBase64` | Base64 decoding failed on `enc`, `nonce`, `ciphertext`, or `sig`. |
| `1004` | `InvalidNonceLength` | Decoded nonce length is not exactly 12 bytes. |
| `1005` | `DecapsulationFailed` | Classical or post-quantum KEM decapsulation failed. |
| `1006` | `DecryptionFailed` | AES-GCM authenticated tag verification failed (ciphertext or AAD tampered). |
| `1007` | `InvalidKeyLength` | Private key, public key, or seed does not match expected algorithm size. |
| `1008` | `UnknownKeyEpoch` | Key epoch is 0 or client possesses no key material for this `(key_id, key_epoch)`. |
| `1009` | `SerializationError` | Envelope violates canonical JSON or struct schema constraints. |
| `1010` | `AADMismatch` | Internal failure during binary AAD buffer assembly. |
| `1011` | `InvalidSignature` | Sender signature is malformed or invalid (reserved for V1.5). |
| `1012` | `UnknownSenderKey` | Sender public signing key is not recognized or not found (reserved for V1.5). |
| `1013` | `SignatureVerificationFailed` | Cryptographic signature verification failed over AAD \|\| ciphertext (reserved for V1.5). |

### Memory & Boundary Hygiene Rules
- **No Plaintext or Key Leakage:** Error descriptions and logs MUST NEVER contain plaintext snippets, private key bytes, or decoded base64 buffers.
- **Wasm Boundary:** In Rust/Wasm, errors are converted into structured JavaScript exceptions with `{ code: number, message: string }`, ensuring no raw Rust stack traces leak across the FFI boundary (`10-wasm-ui-bridge`).
- **Memory Zeroization:** Private keys and intermediate shared secrets MUST implement the `Zeroize` trait in Rust and be explicitly cleared upon drop. In Go, sensitive byte slices must be overwritten with zeros using `subtle` or explicit clearing before garbage collection.

---

## 10. Accepted V1 Metadata Leakage Disclosure

In accordance with Section 16 of the BYOS Architecture Roadmap, persistent mailbox storage protects email content with zero-knowledge encryption, but necessarily exposes specific operational metadata to the storage provider and server workers:

| Exposed Metadata | Visibility | Architectural Rationale & Threat Evaluation |
|---|---|---|
| **Envelope Version (`v`)** | Server & Storage | Required for protocol version routing and migration without decrypting. |
| **Algorithm Identifier (`alg`)** | Server & Storage | Required to direct the payload to the appropriate KEM decapsulator. |
| **Mailbox ID (`key_id`)** | Server & Storage | Required for storage bucket key partitioning (`/org/mbx/...`) and message routing. |
| **Key Epoch (`key_epoch`)** | Server & Storage | Reveals the key rotation index; required for client key lookup and rotation monitoring. |
| **Encapsulation Output (`enc`)** | Server & Storage | Length reveals the algorithm used (32 bytes for X25519 vs 1120 bytes for X-Wing). |
| **Nonce (`nonce`)** | Server & Storage | 12-byte public nonce required for AES-GCM initialization. |
| **Ciphertext Length** | Server & Storage | Reveals approximate message size (plaintext size + 16-byte tag). Mitigated in V2 via padding policies. |

**Zero-Knowledge Boundary Assurance:**  
The server and storage provider CANNOT observe:
- Email subject, headers, body text, or HTML content.
- Attachment filenames, MIME types, or attachment data.
- Recipient private keys, recovery mnemonics, or shared secret material.

---

## 11. Verification & Cross-Language Acceptance Criteria

1. **Byte-Exact AAD Test:** Go and Rust test suites must generate and verify byte-identical AAD buffers across 20+ randomly generated test envelopes.
2. **Cross-Language Round-Trip:**
   - Go seals an envelope with `SealWithX25519` and `SealWithXWing` &rarr; Rust Wasm `decrypt_envelope` successfully recovers plaintext.
   - Rust encapsulates and seals &rarr; Go backend successfully parses and validates the envelope.
3. **Negative Test Vectors:**
   - Envelopes with `v = 0`, `v = 2`, and `v = 255` must fail with `UnsupportedVersion (1001)`.
   - Tampering with any field in the AAD (`alg`, `key_id`, `key_epoch`, `enc`, `nonce`) must fail authentication with `DecryptionFailed (1006)`.
   - Nonces with length $\ne 12$ must fail with `InvalidNonceLength (1004)`.
4. **Official Test Vector Compliance:**
   - ML-KEM-768 Known Answer Tests (NIST FIPS 203).
   - RFC 9180 HPKE test vectors.
   - AES-GCM NIST SP 800-38D test vectors.
