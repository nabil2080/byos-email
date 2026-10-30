/**
 * historical_key_reactivation.ts
 *
 * Secure historical mailbox-key reactivation and password preflight controller.
 * Implements strict zero-knowledge client-side cryptographic round-trip verification:
 * - Password policy verification (min 8, max 128 chars, non-empty)
 * - Confirmation match verification
 * - Historical secret recovery via recovery phrase or previous password
 * - Candidate envelope generation using production Argon2id KDF & AES-256-GCM
 * - Immediate read-back unwrap and constant-time secret comparison
 * - Zero plaintext password or secret key leakage across the network
 */

import type * as WasmCore from "./generated/crypto-core/byos_crypto_core.js";
import { autoUnwrapMailboxKey, unwrapMailboxKeyWithRecoveryPhrase } from "./message_crypto.js";

/** Constant-time comparison of two byte sequences */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

/** Validates password against platform password policy */
export function validatePasswordPolicy(password: string): { valid: boolean; error?: string } {
  if (!password || password.trim().length === 0) {
    return { valid: false, error: "Password cannot be empty or whitespace only." };
  }
  if (password.length < 8) {
    return { valid: false, error: "New password must be at least 8 characters long." };
  }
  if (password.length > 128) {
    return { valid: false, error: "New password must not exceed 128 characters." };
  }
  return { valid: true };
}

export interface HistoricalKeyPreflightInput {
  secret: string;
  newPassword: string;
  confirmPassword: string;
  mailboxId: string;
  previousWrappedSk: string;
}

export interface HistoricalKeyPreflightResult {
  unwrappedMailboxSk: Uint8Array;
  unwrappedSigningSeed?: Uint8Array | null;
  unwrappedXWingSeed?: Uint8Array | null;
  candidateWrappedSk: string;
}

/**
 * Executes a full client-side cryptographic preflight before requesting historical key reactivation.
 * Enforces policy, unseals the historical key, wraps candidate envelope with the new password,
 * unwraps candidate envelope, and validates 32-byte secret equality via constant-time comparison.
 * Fails closed on any error before any network request can occur.
 */
export async function executeHistoricalKeyPreflight(
  wasm: typeof WasmCore,
  input: HistoricalKeyPreflightInput
): Promise<HistoricalKeyPreflightResult> {
  const secret = input.secret.trim();
  if (!secret) {
    throw new Error("Recovery phrase or previous password is required.");
  }

  const newPass = input.newPassword;
  const confirmPass = input.confirmPassword;

  // 1. Validate password policy
  const policy = validatePasswordPolicy(newPass);
  if (!policy.valid) {
    throw new Error(policy.error || "Password policy validation failed.");
  }

  // 2. Validate confirmation field match
  if (newPass !== confirmPass) {
    throw new Error("New password and confirmation do not match.");
  }

  const prevWrapped = (input.previousWrappedSk || "").trim();
  if (!prevWrapped) {
    throw new Error("No historical wrapped key material found.");
  }

  // 3. Unseal historical mailbox secret using existing unwrapping process
  let originalSk: Uint8Array;
  try {
    if (secret.split(/\s+/).length >= 12) {
      originalSk = unwrapMailboxKeyWithRecoveryPhrase(wasm, secret, input.mailboxId, prevWrapped);
    } else {
      originalSk = autoUnwrapMailboxKey(wasm, secret, prevWrapped);
    }
  } catch (_err) {
    throw new Error("Unable to decrypt historical key with provided credentials.");
  }

  if (!originalSk || originalSk.length !== 32) {
    throw new Error("Unable to decrypt historical key with provided credentials.");
  }

  // 4. Unseal secondary seeds (Ed25519 signing seed and X-Wing seed) if present
  let unwrappedSigningSeed: Uint8Array | null = null;
  let unwrappedXWingSeed: Uint8Array | null = null;

  if (prevWrapped.startsWith("{")) {
    try {
      const parsed = JSON.parse(prevWrapped);
      const boxIdHex = input.mailboxId.replace(/-/g, "");

      if (secret.split(/\s+/).length >= 12) {
        // Recovery phrase unwrap
        const rootHex = wasm.wasm_recover_root_secret(secret.trim());
        if (parsed.signing_root_wrapped) {
          const sHex = wasm.wasm_unwrap_signing_seed(rootHex, parsed.signing_root_wrapped, boxIdHex);
          unwrappedSigningSeed = new Uint8Array(sHex.match(/.{1,2}/g)!.map((b: string) => parseInt(b, 16)));
        }
        if (parsed.xwing_root_wrapped) {
          const xHex = wasm.wasm_unwrap_xwing_seed(rootHex, parsed.xwing_root_wrapped, boxIdHex);
          unwrappedXWingSeed = new Uint8Array(xHex.match(/.{1,2}/g)!.map((b: string) => parseInt(b, 16)));
        }
      } else {
        // Previous passphrase unwrap
        if (parsed.signing_salt && parsed.signing_envelope) {
          const sHex = wasm.wasm_passphrase_unwrap_key(secret, parsed.signing_salt, parsed.signing_envelope);
          unwrappedSigningSeed = new Uint8Array(sHex.match(/.{1,2}/g)!.map((b: string) => parseInt(b, 16)));
        }
        if (parsed.xwing_salt && parsed.xwing_envelope) {
          const xHex = wasm.wasm_passphrase_unwrap_key(secret, parsed.xwing_salt, parsed.xwing_envelope);
          unwrappedXWingSeed = new Uint8Array(xHex.match(/.{1,2}/g)!.map((b: string) => parseInt(b, 16)));
        }
      }
    } catch (_secErr) {
      // Non-fatal if secondary seeds cannot be unwrapped
    }
  }

  // 5. Derive new wrapping keys & generate candidate envelope using production WASM
  let candidatePayload: string;
  try {
    const salt = new Uint8Array(16);
    crypto.getRandomValues(salt);
    const saltHex = Array.from(salt, (b) => b.toString(16).padStart(2, "0")).join("");
    const skHex = Array.from(originalSk, (b) => b.toString(16).padStart(2, "0")).join("");
    const envelopeHex = wasm.wasm_passphrase_wrap_key(newPass, saltHex, skHex);

    if (prevWrapped.startsWith("{")) {
      try {
        const parsed = JSON.parse(prevWrapped);
        const payloadObj: Record<string, string> = {
          salt: saltHex,
          envelope: envelopeHex,
        };
        if (parsed.root_wrapped) {
          payloadObj.root_wrapped = parsed.root_wrapped;
        }
        if (parsed.signing_root_wrapped) {
          payloadObj.signing_root_wrapped = parsed.signing_root_wrapped;
        }
        if (parsed.xwing_root_wrapped) {
          payloadObj.xwing_root_wrapped = parsed.xwing_root_wrapped;
        }

        // Re-wrap signing seed under newPass if recovered
        if (unwrappedSigningSeed) {
          const sSalt = new Uint8Array(16);
          crypto.getRandomValues(sSalt);
          const sSaltHex = Array.from(sSalt, (b) => b.toString(16).padStart(2, "0")).join("");
          const sHex = Array.from(unwrappedSigningSeed, (b) => b.toString(16).padStart(2, "0")).join("");
          payloadObj.signing_salt = sSaltHex;
          payloadObj.signing_envelope = wasm.wasm_passphrase_wrap_key(newPass, sSaltHex, sHex);
        }

        // Re-wrap xwing seed under newPass if recovered
        if (unwrappedXWingSeed) {
          const xSalt = new Uint8Array(16);
          crypto.getRandomValues(xSalt);
          const xSaltHex = Array.from(xSalt, (b) => b.toString(16).padStart(2, "0")).join("");
          const xHex = Array.from(unwrappedXWingSeed, (b) => b.toString(16).padStart(2, "0")).join("");
          payloadObj.xwing_salt = xSaltHex;
          payloadObj.xwing_envelope = wasm.wasm_passphrase_wrap_key(newPass, xSaltHex, xHex);
        }

        candidatePayload = JSON.stringify(payloadObj);
      } catch {
        candidatePayload = `${saltHex}:${envelopeHex}`;
      }
    } else {
      candidatePayload = `${saltHex}:${envelopeHex}`;
    }
  } catch (_err) {
    throw new Error("Failed to generate candidate wrapped envelope.");
  }

  // 5. Immediately unwrap candidate envelope using proposed new password
  let candidateSk: Uint8Array;
  try {
    candidateSk = autoUnwrapMailboxKey(wasm, newPass, candidatePayload);
  } catch (_err) {
    throw new Error("Candidate envelope round-trip unwrap failed.");
  }

  // 6. Confirm candidate secret is exactly 32 bytes
  if (!candidateSk || candidateSk.length !== 32) {
    throw new Error("Candidate envelope unwrapped to invalid key length.");
  }

  // 7. Constant-time comparison between candidate secret and original secret
  const matches = constantTimeEqual(originalSk, candidateSk);

  // Memory hygiene: wipe candidate verification buffer immediately
  candidateSk.fill(0);

  if (!matches) {
    throw new Error("Candidate envelope round-trip verification failed: recovered key does not match original.");
  }

  return {
    unwrappedMailboxSk: originalSk,
    unwrappedSigningSeed,
    unwrappedXWingSeed,
    candidateWrappedSk: candidatePayload,
  };
}

/**
 * Verifies server-returned candidate envelope using production WASM:
 * - Unwraps envelope using proposed new password
 * - Requires exact 32-byte equality
 * - Constant-time comparison against original historical secret
 * - Memory hygiene: zeroes verification buffer immediately
 * - Fails closed on any error
 */
export function verifyReadBackCandidateEnvelope(
  wasm: typeof WasmCore,
  newPassword: string,
  originalMailboxSk: Uint8Array,
  readBackCandidateWrappedSk: string
): boolean {
  if (!originalMailboxSk || originalMailboxSk.length !== 32) {
    throw new Error("Invalid original mailbox secret for verification.");
  }
  const trimmed = (readBackCandidateWrappedSk || "").trim();
  if (!trimmed) {
    throw new Error("Server returned empty candidate envelope.");
  }

  let candidateSk: Uint8Array;
  try {
    candidateSk = autoUnwrapMailboxKey(wasm, newPassword, trimmed);
  } catch (_err) {
    throw new Error("Server candidate envelope failed client-side unwrap.");
  }

  if (!candidateSk || candidateSk.length !== 32) {
    throw new Error("Server candidate envelope unwrapped to invalid key length.");
  }

  const matches = constantTimeEqual(originalMailboxSk, candidateSk);
  candidateSk.fill(0); // Memory hygiene

  if (!matches) {
    throw new Error("Server candidate envelope verification failed: unsealed key does not match historical secret.");
  }

  return true;
}

export interface StagedReactivationApi {
  prepare: (mailboxId: string, candidate: string, mailboxPk?: string) => Promise<{ migration_id: string }>;
  fetchPending: (mailboxId: string, migrationId: string) => Promise<{ candidate_wrapped_sk: string }>;
  finalize: (mailboxId: string, migrationId: string) => Promise<{ success: boolean; message: string }>;
  rollback: (mailboxId: string, migrationId: string, reason: string) => Promise<any>;
}

export interface StagedHistoricalKeyReactivationInput extends HistoricalKeyPreflightInput {
  mailboxPk?: string;
}

export interface StagedHistoricalKeyReactivationResult {
  unwrappedMailboxSk: Uint8Array;
  unwrappedSigningSeed?: Uint8Array | null;
  unwrappedXWingSeed?: Uint8Array | null;
  migrationId: string;
  message: string;
}

/**
 * Orchestrates the full staged historical-key reactivation lifecycle:
 * 1. Validate new password and confirmation.
 * 2. Perform local candidate-envelope preflight (unseal historical secret, derive candidate, verify locally).
 * 3. Prepare pending reactivation record on server.
 * 4. Read the exact candidate envelope back from the server API.
 * 5. Verify the server-returned candidate envelope using WASM (fails closed, rolls back if mismatch).
 * 6. Finalize the operation atomically on the server.
 * 7. Confirm successful reactivation to caller.
 */
export async function executeStagedHistoricalKeyReactivation(
  wasm: typeof WasmCore,
  input: StagedHistoricalKeyReactivationInput,
  api: StagedReactivationApi
): Promise<StagedHistoricalKeyReactivationResult> {
  // Step 1 & 2: Local Preflight
  const preflight = await executeHistoricalKeyPreflight(wasm, input);

  // Step 3: Prepare
  let migrationId: string;
  try {
    const prepRes = await api.prepare(input.mailboxId, preflight.candidateWrappedSk, input.mailboxPk);
    migrationId = prepRes.migration_id;
  } catch (err: any) {
    throw new Error(`Reactivation preparation failed: ${err?.message || "server error"}`);
  }

  // Step 4: Read back
  let serverCandidate: string;
  try {
    const pendingRes = await api.fetchPending(input.mailboxId, migrationId);
    serverCandidate = pendingRes.candidate_wrapped_sk;
  } catch (err: any) {
    // If read-back fails, attempt rollback
    try {
      await api.rollback(input.mailboxId, migrationId, "read_back_retrieval_failed");
    } catch {}
    throw new Error(`Reactivation read-back failed: ${err?.message || "server error"}`);
  }

  // Step 5: Client verification of server candidate envelope using WASM
  try {
    verifyReadBackCandidateEnvelope(wasm, input.newPassword, preflight.unwrappedMailboxSk, serverCandidate);
  } catch (verifyErr: any) {
    // Verification failed! Never finalize! Rollback on server and fail closed
    try {
      await api.rollback(input.mailboxId, migrationId, "client_read_back_verification_failed");
    } catch {}
    throw new Error(`Cryptographic verification of server candidate failed: ${verifyErr?.message || "secret mismatch"}`);
  }

  // Step 6: Finalize
  let finMessage = "Historical key material successfully reactivated";
  try {
    const finRes = await api.finalize(input.mailboxId, migrationId);
    if (finRes.message) {
      finMessage = finRes.message;
    }
  } catch (err: any) {
    throw new Error(`Reactivation finalization failed: ${err?.message || "server error"}`);
  }

  // Step 7: Return confirmed result
  return {
    unwrappedMailboxSk: preflight.unwrappedMailboxSk,
    unwrappedSigningSeed: preflight.unwrappedSigningSeed || null,
    unwrappedXWingSeed: preflight.unwrappedXWingSeed || null,
    migrationId,
    message: finMessage,
  };
}
