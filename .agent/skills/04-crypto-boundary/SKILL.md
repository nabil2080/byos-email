Trigger

Any change involving crypto-core, WASM, AES-GCM, HKDF, X25519, Ed25519, HPKE, keys, roots, recovery, encrypted messages, attachments, or rotation.

Rules
Reuse approved primitives.
Never invent crypto.
Never change frozen wire formats.
Preserve nonce, AAD, version, and domain separation.
Never log/store mnemonic, root, private keys, or plaintext secrets.
Server must not decrypt client-only data unless explicitly specified.
encrypted=true is not proof of encryption.
Workflow
Locate canonical primitive.
Compare with frozen spec.
Trace plaintext → crypto → ciphertext.
Check key/AAD/version.
Test wrong key, tampering, malformed data.
Stop

STOP if:

protocol is ambiguous
new crypto is proposed
plaintext crosses the boundary
rotation is non-atomic
implementation differs from frozen spec
Output
CRYPTO
Primitive:
Format:
Key:
AAD:
Boundary:
Negative tests:
Result: PASS / FAIL / BLOCKED