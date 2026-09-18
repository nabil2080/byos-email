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
| `HPKE-XWing-AES256GCM-v1` | Post-Quantum Hybrid KEM Suite:<br>&bull; Hybrid KEM: X-Wing (X25519 + ML-KEM-768, KEM ID `0x647a` = 25722)<br>&bull; KDF: `HKDF-SHA256` (`0x0001`)<br>&bull; AEAD: `AES-256-GCM` (`0x0002`)<br>&bull; Combiner: SHA3-256 with 6-byte suffix label `\./^\` | draft-connolly-cfrg-xwing-kem / FIPS 203 / RFC 9180 |

### 5.1 `HPKE-X25519-AES256GCM-v1` (Classical Standard)
- **Library (Go):** `github.com/cloudflare/circl/hpke` or `filippo.io/hpke`
- **Library (Rust):** `hpke` crate (RFC 9180 compliant)
- **Encapsulation (`enc`):** 32 bytes (raw ephemeral X25519 public key).
- **Public Key:** 32 bytes (X25519 public key).
- **Private Key:** 32 bytes (X25519 static secret).

### 5.2 `HPKE-XWing-AES256GCM-v1` (Post-Quantum Hybrid)
- **Classical Component:** X25519 per RFC 7748 (32-byte secret scalar, 32-byte public u-coordinate).
- **Post-Quantum Component:** ML-KEM-768 per NIST FIPS 203:
  - Public Encapsulation Key (`pk_M`): 1184 bytes.
  - Ciphertext (`ct_M`): 1088 bytes.
  - Shared Secret (`ss_M`): 32 bytes.
- **Combined Public Key:** `pk_XWing = pk_M (1184 bytes) || pk_X (32 bytes)` = 1216 bytes.
- **Combined Encapsulation (`enc`):** `enc = ct_M (1088 bytes) || ct_X (32 bytes)` = 1120 bytes.
- **Exact Verbatim Combiner Definition (`draft-connolly-cfrg-xwing-kem` §5.3):**
  ```python
  def Combiner(ss_M, ss_X, ct_X, pk_X):
      return SHA3-256(concat(
          ss_M,        # ML-KEM-768 shared secret (32 bytes)
          ss_X,        # X25519 shared secret (32 bytes)
          ct_X,        # Ephemeral X25519 public key / ciphertext (32 bytes)
          pk_X,        # Recipient classical X25519 public key (32 bytes)
          XWingLabel   # 6-byte domain separation label (suffix)
      ))
  ```
  Where `XWingLabel` is the 6-byte ASCII string `\./` + `/^\`, defined in hexadecimal as:
  ```
  5c 2e 2f 2f 5e 5c
  ```
  Total concatenated input length to `SHA3-256` is exactly $32 + 32 + 32 + 32 + 6 = 134\text{ bytes}$.

  > [!IMPORTANT]
  > **Combiner Invariants:**
  > 1. `XWingLabel` MUST be placed as a **suffix** at the end of the concatenation buffer, matching `draft-connolly-cfrg-xwing-kem` (§5.3).
  > 2. The ML-KEM-768 public key (`pk_M`) and ciphertext (`ct_M`) are **deliberately excluded** from the combiner hash. In X-Wing, ML-KEM's internal Fujisaki-Okamoto transform already provides ciphertext binding for the post-quantum component, making their inclusion redundant.

### 5.3 HPKE Integration Architecture (Strategy Selection)

This specification adopts **Strategy B: Modular KEM + RFC 9180 Key Schedule**:

#### Architectural Comparison & Justification
- **Strategy A ("Black-box HPKE Context"):** High-level HPKE APIs (e.g. `hpke.Seal()` / `sender.Seal()`) encapsulate AEAD nonce generation internally as `base_nonce ^ seq`. In standard HPKE, callers cannot supply an explicit 12-byte CSPRNG random nonce, nor can they access `base_nonce` prior to sealing in order to bind it into an external AAD buffer. Furthermore, in Go, the `filippo.io/hpke.KEM` interface contains unexported methods, preventing third-party KEM implementations, while `circl/hpke` uses a closed ciphersuite registry.
- **Strategy B ("Modular KEM + RFC 9180 Key Schedule"):** Cleanly separates KEM encapsulation from symmetric envelope encryption:
  1. X-Wing encapsulation is executed via standard KEM primitives to produce `(enc, ss_combined)`.
  2. The 32-byte AES-256-GCM symmetric key is derived from `ss_combined` using RFC 9180 Section 5.1 key schedule primitives (`LabeledExtract` / `LabeledExpand`).
  3. The 12-byte random nonce is generated via CSPRNG per Section 4.1.
  4. The deterministic binary AAD is constructed per Section 3.1, binding `v`, `alg`, `key_id`, `key_epoch`, `enc`, and `nonce`.
  5. The payload is encrypted with standard AES-256-GCM (`crypto/cipher` in Go, `aes-gcm` in Rust).

This strategy guarantees 100% adherence to the frozen binary AAD and random nonce policy without requiring patched or unexported HPKE internals in either language.

#### Key Schedule Derivation Steps
1. **Inputs:**
   - `ss_combined`: 32-byte combined shared secret from `Combiner(ss_M, ss_X, ct_X, pk_X)`.
   - `suite_id`: RFC 9180 HPKE suite identifier for X-Wing + HKDF-SHA256 + AES-256-GCM:
     ```
     suite_id = concat("HPKE", I2OSP(0x647a, 2), I2OSP(0x0001, 2), I2OSP(0x0002, 2))
     ```
     Binary (10 bytes): `0x48 0x50 0x4b 0x45 0x64 0x7a 0x00 0x01 0x00 0x02`
2. **Pseudorandom Key (PRK) Extraction:**
   ```
   PRK = HKDF-Extract(salt="", IKM=ss_combined)
   ```
   where `salt` is a zero-filled byte string of hash digest length (32 zero bytes).
3. **AEAD Key Expansion:**
   ```
   key = LabeledExpand(PRK, "key", "", 32)
   ```
   where RFC 9180 `LabeledExpand(PRK, label, info, L)` is defined as:
   ```
   LabeledExpand(PRK, label, info, L) = HKDF-Expand(
       PRK,
       concat(I2OSP(L, 2), "HPKE-v1", suite_id, label, info),
       L
   )
   ```
   The resulting 32-byte `key` is the symmetric key for AES-256-GCM.
4. **Nonce Generation & Role:**
   Per Section 4.1, the 96-bit (12-byte) AES-GCM nonce is generated by a CSPRNG (`crypto/rand.Reader` in Go, `getrandom` in Rust) for each envelope, populated into the JSON `nonce` field, and bound at offset `pos..pos+12` of the binary AAD.
5. **Role of Ephemeral Key:**
   For every sealed envelope, the sender generates fresh ephemeral randomness:
   - Ephemeral X25519 scalar $ek_X \in \mathbb{F}_p$ yielding ephemeral public key $ct_X = X25519(ek_X, 9)$.
   - Ephemeral ML-KEM-768 randomness yielding $(ss_M, ct_M)$.
   The ephemeral outputs are packed into `enc = ct_M || ct_X` (1120 bytes). Because $ek_X$ and $(ss_M, ct_M)$ are unique per message, $ss_{combined}$ and $key$ are unique per envelope, ensuring forward secrecy and preventing key reuse.

### 5.4 X-Wing Wire Layout & Serialization Rules

#### 1. Public Key (Encapsulation Key: 1216 Bytes)
The X-Wing public key `pk_XWing` is the contiguous concatenation of the post-quantum encapsulation key and the classical public key:
```
+-------------------------------------------------------------------------+
| Byte Range      | Component | Size       | Encoding / Format            |
+-------------------------------------------------------------------------+
| 0 .. 1183       | pk_M      | 1184 bytes | ML-KEM-768 Encapsulation Key |
|                 |           |            | (FIPS 203 §7.1 polynomial)   |
+-------------------------------------------------------------------------+
| 1184 .. 1215    | pk_X      | 32 bytes   | X25519 Public Key            |
|                 |           |            | (RFC 7748 little-endian u)   |
+-------------------------------------------------------------------------+
```

#### 2. Ciphertext Wire Layout (`enc`: 1120 Bytes)
The KEM encapsulation output stored in the envelope `enc` field (after Base64 decoding) is the contiguous concatenation of the post-quantum ciphertext and the classical ephemeral public key:
```
+-------------------------------------------------------------------------+
| Byte Range      | Component | Size       | Encoding / Format            |
+-------------------------------------------------------------------------+
| 0 .. 1087       | ct_M      | 1088 bytes | ML-KEM-768 Ciphertext        |
|                 |           |            | (FIPS 203 §7.2 compressed)   |
+-------------------------------------------------------------------------+
| 1088 .. 1119    | ct_X      | 32 bytes   | Ephemeral X25519 Public Key  |
|                 |           |            | (RFC 7748 little-endian u)   |
+-------------------------------------------------------------------------+
```

#### 3. Decapsulation Key (Private Key: 32 Bytes)
In accordance with `draft-connolly-cfrg-xwing-kem` §5.1, the serialized X-Wing private key is a compact 32-byte random seed `sk`. Decapsulation expands this seed deterministically on demand:
```python
def expandDecapsulationKey(sk):
    expanded = SHAKE256(sk, 96 * 8)  # 96 bytes = 768 bits
    d = expanded[0:32]
    z = expanded[32:64]
    (pk_M, sk_M) = ML-KEM-768.KeyGen_internal(d, z)
    sk_X = expanded[64:96]
    pk_X = X25519(sk_X, 9)
    return (sk_M, sk_X, pk_M, pk_X)
```
- Implementations MAY cache the expanded keys in memory during an active session.
- Expanded private keys MUST NOT be serialized or transmitted across process boundaries.

## 5.5 Decapsulation

Given the 32-byte private key seed `sk_seed` and the envelope's raw `enc` 
bytes (1120 bytes), the recipient reconstructs the combined shared secret:

    Decapsulate(sk_seed, enc, pk_XWing):
      (sk_M, sk_X, pk_M, pk_X) = expandDecapsulationKey(sk_seed)
      ct_M = enc[0:1088]
      ct_X = enc[1088:1120]
      ss_M = ML-KEM-768.Decapsulate(sk_M, ct_M)
      ss_X = X25519(sk_X, ct_X)
      return Combiner(ss_M, ss_X, ct_X, pk_X)

Where expandDecapsulationKey is defined in Section 5.4.

Note: The recipient's pk_XWing (public key) is needed by the Combiner, but 
it is not stored in the envelope. It must be derived from the recipient's 
own private key during decapsulation.

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
   - X-Wing hybrid KEM test vectors (`draft-connolly-cfrg-xwing-kem` Appendix C).
   - AES-GCM NIST SP 800-38D test vectors.

---

## 12. Test Vectors & Upstream Reference

Implementations in both Go and Rust MUST validate their X-Wing combiner and key derivation against the official test vectors published in `draft-connolly-cfrg-xwing-kem` (Appendix C).

### 12.1 Derandomized Test Vector 1 (`draft-connolly-cfrg-xwing-kem` Appendix C)

Full test vectors are published in draft-connolly-cfrg-xwing-kem Appendix C. 
Implementations MUST pass the derandomized test vector before any other 
integration. During Phase 1, create testdata/xwing_vectors.json containing 
the complete byte values from the draft's Appendix C. The truncated values 
previously shown in this section are illustrative only.

---

## 13. Normative References

1. **RFC 9180:** Hybrid Public Key Encryption (HPKE), February 2022.
2. **NIST FIPS 203:** Module-Lattice-Based Key-Encapsulation Mechanism Standard (ML-KEM), August 2024.
3. **draft-connolly-cfrg-xwing-kem-10:** X-Wing: general-purpose hybrid post-quantum KEM, March 2026.
4. **RFC 7748:** Elliptic Curves for Security (X25519), January 2016.
5. **NIST SP 800-38D:** Recommendation for Block Cipher Modes of Operation: Galois/Counter Mode (GCM).
6. **RFC 5869:** HMAC-based Extract-and-Expand Key Derivation Function (HKDF), May 2010.

