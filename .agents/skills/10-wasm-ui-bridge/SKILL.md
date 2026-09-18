---
name: 10-wasm-ui-bridge
description: WASM cryptography bridge safeguards and sensitive memory cleanup rules. Use when connecting UI components to client-side cryptographic functions, byos_crypto_core, or asynchronous decrypt/encrypt pipelines.
---

# UI Engineering: WASM & Crypto Bridge Constraints

## Trigger
Load this skill when connecting UI components to client-side cryptographic functions, `byos_crypto_core`, or asynchronous decrypt/encrypt pipelines.

## Core Directives

1. **Zero-Knowledge UI Failsafes:** Never render unencrypted payload states to the DOM, and never log plaintext keys, mnemonics, or email contents to the browser console via `console.log`.
2. **Graceful Degradation:** The WASM module loads asynchronously. Always implement a non-blocking loading state (e.g., skeleton loaders, pulse animations) for components relying on `wasm_argon2id_derive` or decryption functions.
3. **Memory Hygiene:** If a WASM operation requires passing sensitive byte arrays, ensure the UI explicitly clears those JavaScript variables (e.g., `key.fill(0)`) immediately after the WASM boundary transition.
4. **Error Masking:** Cryptographic errors (e.g., failed decryption, tampered payload) must fail gracefully in the UI. Display a generic "Unable to decrypt message" error to the user rather than dumping WASM stack traces or byte offset errors.
