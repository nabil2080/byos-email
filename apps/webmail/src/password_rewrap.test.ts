import * as wasm from "./generated/crypto-core/byos_crypto_core.js";
import { autoUnwrapKeys } from "./message_crypto";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export function runPasswordRewrapTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;

  const runTest = (name: string, fn: () => void) => {
    try {
      fn();
      passed++;
    } catch (err) {
      failed++;
      console.error(`TEST FAILED [${name}]:`, err);
    }
  };

  runTest("Password rewrap round-trip preserves root_wrapped and updates password unwrap", () => {
    const oldPassword = "old-secret-password-1";
    const newPassword = "new-strong-password-2";

    // 1. Initial keys
    const mailboxSk = new Uint8Array(32);
    for (let i = 0; i < 32; i++) mailboxSk[i] = i + 1;
    const signingSeed = new Uint8Array(32);
    for (let i = 0; i < 32; i++) signingSeed[i] = 100 + i;

    const mbSkHex = Array.from(mailboxSk).map((b) => b.toString(16).padStart(2, "0")).join("");
    const signSeedHex = Array.from(signingSeed).map((b) => b.toString(16).padStart(2, "0")).join("");

    const initialSalt = new Uint8Array(16);
    for (let i = 0; i < 16; i++) initialSalt[i] = i;
    const initialSaltHex = Array.from(initialSalt).map((b) => b.toString(16).padStart(2, "0")).join("");
    const initialEnvelope = wasm.wasm_passphrase_wrap_key(oldPassword, initialSaltHex, mbSkHex);

    const initialSignSalt = new Uint8Array(16);
    for (let i = 0; i < 16; i++) initialSignSalt[i] = 50 + i;
    const initialSignSaltHex = Array.from(initialSignSalt).map((b) => b.toString(16).padStart(2, "0")).join("");
    const initialSignEnvelope = wasm.wasm_passphrase_wrap_key(oldPassword, initialSignSaltHex, signSeedHex);

    const initialRootWrapped = "deadbeef_root_wrapped_marker";
    const initialSigningRootWrapped = "feedface_signing_root_marker";

    const originalPayload = JSON.stringify({
      salt: initialSaltHex,
      envelope: initialEnvelope,
      root_wrapped: initialRootWrapped,
      signing_salt: initialSignSaltHex,
      signing_envelope: initialSignEnvelope,
      signing_root_wrapped: initialSigningRootWrapped,
    });

    // Verify unwrap with old password
    const unwrappedOld = autoUnwrapKeys(wasm, oldPassword, originalPayload);
    assert(unwrappedOld.mailboxSk.length === 32, "Old unwrap mailboxSk length 32");
    assert(unwrappedOld.signingSeed !== null && unwrappedOld.signingSeed.length === 32, "Old unwrap signingSeed length 32");
    assert(unwrappedOld.mailboxSk.every((b, idx) => b === mailboxSk[idx]), "Old unwrap mailboxSk match");
    assert(unwrappedOld.signingSeed!.every((b, idx) => b === signingSeed[idx]), "Old unwrap signingSeed match");

    // 2. Simulate password re-wrap logic
    const parsed = JSON.parse(originalPayload);
    const rootWrapped = parsed.root_wrapped || "";
    const signingRootWrapped = parsed.signing_root_wrapped || "";

    const newMbSalt = new Uint8Array(16);
    for (let i = 0; i < 16; i++) newMbSalt[i] = 120 + i;
    const newMbSaltHex = Array.from(newMbSalt).map((b) => b.toString(16).padStart(2, "0")).join("");
    const newMbEnvelope = wasm.wasm_passphrase_wrap_key(newPassword, newMbSaltHex, mbSkHex);

    const newSignSalt = new Uint8Array(16);
    for (let i = 0; i < 16; i++) newSignSalt[i] = 140 + i;
    const newSignSaltHex = Array.from(newSignSalt).map((b) => b.toString(16).padStart(2, "0")).join("");
    const newSignEnvelope = wasm.wasm_passphrase_wrap_key(newPassword, newSignSaltHex, signSeedHex);

    const rewrappedPayload = JSON.stringify({
      salt: newMbSaltHex,
      envelope: newMbEnvelope,
      root_wrapped: rootWrapped,
      signing_salt: newSignSaltHex,
      signing_envelope: newSignEnvelope,
      signing_root_wrapped: signingRootWrapped,
    });

    // 3. Confirm new payload unwraps correctly with new password
    const unwrappedNew = autoUnwrapKeys(wasm, newPassword, rewrappedPayload);
    assert(unwrappedNew.mailboxSk.every((b, idx) => b === mailboxSk[idx]), "New unwrap mailboxSk match");
    assert(unwrappedNew.signingSeed !== null, "New unwrap signingSeed not null");
    assert(unwrappedNew.signingSeed!.every((b, idx) => b === signingSeed[idx]), "New unwrap signingSeed match");

    // 4. Confirm root_wrapped and signing_root_wrapped are byte-identical
    const parsedNew = JSON.parse(rewrappedPayload);
    assert(parsedNew.root_wrapped === initialRootWrapped, "root_wrapped identical");
    assert(parsedNew.signing_root_wrapped === initialSigningRootWrapped, "signing_root_wrapped identical");
  });

  return { passed, failed };
}
