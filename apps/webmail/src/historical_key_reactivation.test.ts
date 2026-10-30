/**
 * historical_key_reactivation.test.ts
 *
 * Test suite for client-side cryptographic preflight in historical key reactivation.
 */

import * as wasm from "./generated/crypto-core/byos_crypto_core.js";
import {
  constantTimeEqual,
  validatePasswordPolicy,
  executeHistoricalKeyPreflight,
  verifyReadBackCandidateEnvelope,
  executeStagedHistoricalKeyReactivation,
} from "./historical_key_reactivation.js";
import { autoUnwrapMailboxKey } from "./message_crypto.js";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export async function runHistoricalKeyReactivationTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  const test = async (name: string, fn: () => Promise<void> | void) => {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ [FAIL] ${name}:`, err);
    }
  };

  console.log("Running Historical Key Reactivation & Preflight Tests...");

  // 1. Correct historical password and valid new password
  await test("1. Correct historical password and valid new password succeeds", async () => {
    const historicalPassword = "correct-old-password-123";
    const newPassword = "brand-new-strong-password-456";
    const mailboxSk = new Uint8Array(32);
    for (let i = 0; i < 32; i++) mailboxSk[i] = i + 10;

    const salt = new Uint8Array(16);
    for (let i = 0; i < 16; i++) salt[i] = i + 1;
    const saltHex = Array.from(salt, (b) => b.toString(16).padStart(2, "0")).join("");
    const skHex = Array.from(mailboxSk, (b) => b.toString(16).padStart(2, "0")).join("");
    const envelopeHex = wasm.wasm_passphrase_wrap_key(historicalPassword, saltHex, skHex);
    const prevWrapped = JSON.stringify({ salt: saltHex, envelope: envelopeHex });

    const result = await executeHistoricalKeyPreflight(wasm, {
      secret: historicalPassword,
      newPassword,
      confirmPassword: newPassword,
      mailboxId: "c0000000-0000-0000-0000-000000000001",
      previousWrappedSk: prevWrapped,
    });

    assert(result.unwrappedMailboxSk.length === 32, "Unwrapped mailbox key must be 32 bytes");
    assert(constantTimeEqual(result.unwrappedMailboxSk, mailboxSk), "Recovered key must match original key");
    assert(result.candidateWrappedSk.length > 0, "Candidate wrapped envelope must not be empty");

    // Verify candidate envelope can be unwrapped with new password
    const unwrappedWithNew = autoUnwrapMailboxKey(wasm, newPassword, result.candidateWrappedSk);
    assert(constantTimeEqual(unwrappedWithNew, mailboxSk), "Candidate envelope must unwrap with new password");
  });

  // 2. Incorrect historical password
  await test("2. Incorrect historical password fails closed before generating envelope", async () => {
    const historicalPassword = "correct-old-password-123";
    const wrongHistoricalPassword = "wrong-old-password-999";
    const newPassword = "brand-new-strong-password-456";
    const mailboxSk = new Uint8Array(32);
    for (let i = 0; i < 32; i++) mailboxSk[i] = i + 1;

    const salt = new Uint8Array(16);
    for (let i = 0; i < 16; i++) salt[i] = i + 5;
    const saltHex = Array.from(salt, (b) => b.toString(16).padStart(2, "0")).join("");
    const skHex = Array.from(mailboxSk, (b) => b.toString(16).padStart(2, "0")).join("");
    const envelopeHex = wasm.wasm_passphrase_wrap_key(historicalPassword, saltHex, skHex);
    const prevWrapped = `${saltHex}:${envelopeHex}`;

    let threw = false;
    try {
      await executeHistoricalKeyPreflight(wasm, {
        secret: wrongHistoricalPassword,
        newPassword,
        confirmPassword: newPassword,
        mailboxId: "c0000000-0000-0000-0000-000000000001",
        previousWrappedSk: prevWrapped,
      });
    } catch (err: any) {
      threw = true;
      assert(
        err.message.includes("Unable to decrypt historical key"),
        `Expected decryption failure message, got: ${err.message}`
      );
    }
    assert(threw, "Preflight must throw on incorrect historical password");
  });

  // 3. New password and confirmation mismatch
  await test("3. New password and confirmation mismatch is rejected before crypto operations", async () => {
    let threw = false;
    try {
      await executeHistoricalKeyPreflight(wasm, {
        secret: "any-secret",
        newPassword: "password-valid-1",
        confirmPassword: "password-mismatch-2",
        mailboxId: "c0000000-0000-0000-0000-000000000001",
        previousWrappedSk: "dummy_payload",
      });
    } catch (err: any) {
      threw = true;
      assert(
        err.message.includes("confirmation do not match"),
        `Expected mismatch error, got: ${err.message}`
      );
    }
    assert(threw, "Preflight must throw on confirmation mismatch");
  });

  // 4. Invalid password-policy input
  await test("4. Invalid password-policy input is rejected", () => {
    const tooShort = validatePasswordPolicy("short");
    assert(!tooShort.valid, "Password < 8 chars must be rejected");
    assert(tooShort.error!.includes("at least 8 characters"), "Error message must state minimum 8 chars");

    const empty = validatePasswordPolicy("");
    assert(!empty.valid, "Empty password must be rejected");

    const spaces = validatePasswordPolicy("       ");
    assert(!spaces.valid, "Whitespace-only password must be rejected");

    const tooLong = validatePasswordPolicy("a".repeat(129));
    assert(!tooLong.valid, "Password > 128 chars must be rejected");

    const valid = validatePasswordPolicy("strong-password-123");
    assert(valid.valid, "Valid password must pass policy check");
  });

  // 5. Candidate wrapper successfully unwraps to the original mailbox secret
  await test("5. Candidate wrapper successfully unwraps to the original mailbox secret", async () => {
    const password = "valid-target-password-xyz";
    const mailboxSk = new Uint8Array(32);
    for (let i = 0; i < 32; i++) mailboxSk[i] = (i * 7) % 256;

    const salt = new Uint8Array(16);
    crypto.getRandomValues(salt);
    const saltHex = Array.from(salt, (b) => b.toString(16).padStart(2, "0")).join("");
    const skHex = Array.from(mailboxSk, (b) => b.toString(16).padStart(2, "0")).join("");
    const envHex = wasm.wasm_passphrase_wrap_key(password, saltHex, skHex);

    const unwrapped = autoUnwrapMailboxKey(wasm, password, `${saltHex}:${envHex}`);
    assert(unwrapped.length === 32, "Unwrapped key length must be 32");
    assert(constantTimeEqual(unwrapped, mailboxSk), "Unwrapped key must be byte-for-byte identical");
  });

  // 6. Candidate wrapper unwraps to a different secret (constant-time check failure)
  await test("6. Candidate wrapper unwrap mismatch is caught by constantTimeEqual", () => {
    const keyA = new Uint8Array(32);
    const keyB = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      keyA[i] = i;
      keyB[i] = i;
    }
    assert(constantTimeEqual(keyA, keyB), "Identical keys must return true");

    keyB[31] = 99; // Corrupt 1 byte
    assert(!constantTimeEqual(keyA, keyB), "Mismatched keys must return false");

    const shortKey = new Uint8Array(31);
    assert(!constantTimeEqual(keyA, shortKey), "Different length must return false");
  });

  // 7. Invalid candidate envelope format
  await test("7. Malformed candidate envelope fails unwrap closed", () => {
    let threw = false;
    try {
      autoUnwrapMailboxKey(wasm, "some-password", "malformed:envelope");
    } catch (_err) {
      threw = true;
    }
    assert(threw, "Malformed envelope must fail closed");

    threw = false;
    try {
      autoUnwrapMailboxKey(wasm, "some-password", "{ malformed json ");
    } catch (_err) {
      threw = true;
    }
    assert(threw, "Malformed JSON must fail closed");
  });

  // 8. Failed preflight prevents API dispatch
  await test("8. Simulated reactivation controller does not dispatch API when preflight fails", async () => {
    let apiCallCount = 0;
    const mockReactivateApi = async (_mailboxId: string, _candidateWrapped: string) => {
      apiCallCount++;
      return { success: true, message: "OK" };
    };

    const controller = async (input: {
      secret: string;
      newPass: string;
      confirmPass: string;
      mailboxId: string;
      prevWrapped: string;
    }) => {
      // Step A: Preflight
      const preflightRes = await executeHistoricalKeyPreflight(wasm, {
        secret: input.secret,
        newPassword: input.newPass,
        confirmPassword: input.confirmPass,
        mailboxId: input.mailboxId,
        previousWrappedSk: input.prevWrapped,
      });

      // Step B: Only dispatched after successful preflight
      return await mockReactivateApi(input.mailboxId, preflightRes.candidateWrappedSk);
    };

    // Case A: Mismatched password
    try {
      await controller({
        secret: "oldpass",
        newPass: "newpass123",
        confirmPass: "wrongpass123",
        mailboxId: "mb-1",
        prevWrapped: "some_payload",
      });
    } catch {}
    assert(apiCallCount === 0, "API must not be called when password confirmation fails");

    // Case B: Password policy failure (<8 chars)
    try {
      await controller({
        secret: "oldpass",
        newPass: "short",
        confirmPass: "short",
        mailboxId: "mb-1",
        prevWrapped: "some_payload",
      });
    } catch {}
    assert(apiCallCount === 0, "API must not be called when password policy fails");

    // Case C: Wrong historical secret
    const sk = new Uint8Array(32);
    const saltHex = "00".repeat(16);
    const skHex = Array.from(sk, (b) => b.toString(16).padStart(2, "0")).join("");
    const envHex = wasm.wasm_passphrase_wrap_key("real-secret-123", saltHex, skHex);
    try {
      await controller({
        secret: "wrong-secret-999",
        newPass: "new-password-123",
        confirmPass: "new-password-123",
        mailboxId: "mb-1",
        prevWrapped: `${saltHex}:${envHex}`,
      });
    } catch {}
    assert(apiCallCount === 0, "API must not be called when historical secret unwrap fails");
  });

  // 9. Preservation of root_wrapped in candidate envelope
  await test("9. Preflight preserves root_wrapped from historical JSON envelope", async () => {
    const historicalPassword = "old-password-with-root";
    const newPassword = "new-strong-password-789";
    const mailboxSk = new Uint8Array(32);
    for (let i = 0; i < 32; i++) mailboxSk[i] = i + 20;

    const salt = new Uint8Array(16);
    crypto.getRandomValues(salt);
    const saltHex = Array.from(salt, (b) => b.toString(16).padStart(2, "0")).join("");
    const skHex = Array.from(mailboxSk, (b) => b.toString(16).padStart(2, "0")).join("");
    const envelopeHex = wasm.wasm_passphrase_wrap_key(historicalPassword, saltHex, skHex);

    const rootWrappedMarker = "marker_root_wrapped_recovery_phrase_copy";
    const prevWrapped = JSON.stringify({
      salt: saltHex,
      envelope: envelopeHex,
      root_wrapped: rootWrappedMarker,
    });

    const result = await executeHistoricalKeyPreflight(wasm, {
      secret: historicalPassword,
      newPassword,
      confirmPassword: newPassword,
      mailboxId: "c0000000-0000-0000-0000-000000000001",
      previousWrappedSk: prevWrapped,
    });

    const parsedCandidate = JSON.parse(result.candidateWrappedSk);
    assert(parsedCandidate.root_wrapped === rootWrappedMarker, "root_wrapped must be preserved in candidate envelope");
    assert(parsedCandidate.salt !== saltHex, "Candidate envelope must use a fresh random salt");
  });

  // 10. verifyReadBackCandidateEnvelope succeeds when server returns matching candidate envelope
  await test("10. verifyReadBackCandidateEnvelope validates server-returned candidate with proposed password", () => {
    const newPassword = "new-staged-password-123";
    const mailboxSk = new Uint8Array(32);
    for (let i = 0; i < 32; i++) mailboxSk[i] = (i * 3 + 7) % 256;

    const salt = new Uint8Array(16);
    crypto.getRandomValues(salt);
    const saltHex = Array.from(salt, (b) => b.toString(16).padStart(2, "0")).join("");
    const skHex = Array.from(mailboxSk, (b) => b.toString(16).padStart(2, "0")).join("");
    const envHex = wasm.wasm_passphrase_wrap_key(newPassword, saltHex, skHex);
    const serverReturnedCandidate = `${saltHex}:${envHex}`;

    const ok = verifyReadBackCandidateEnvelope(wasm, newPassword, mailboxSk, serverReturnedCandidate);
    assert(ok === true, "Verification must return true for matching candidate envelope");
  });

  // 11. verifyReadBackCandidateEnvelope fails closed when server returns mismatched envelope
  await test("11. verifyReadBackCandidateEnvelope rejects tampered or mismatched candidate secret", () => {
    const newPassword = "new-staged-password-123";
    const originalMailboxSk = new Uint8Array(32);
    for (let i = 0; i < 32; i++) originalMailboxSk[i] = i + 1;

    // Different secret wrapped under newPassword
    const differentSk = new Uint8Array(32);
    for (let i = 0; i < 32; i++) differentSk[i] = i + 50;

    const salt = new Uint8Array(16);
    crypto.getRandomValues(salt);
    const saltHex = Array.from(salt, (b) => b.toString(16).padStart(2, "0")).join("");
    const diffSkHex = Array.from(differentSk, (b) => b.toString(16).padStart(2, "0")).join("");
    const envHex = wasm.wasm_passphrase_wrap_key(newPassword, saltHex, diffSkHex);
    const tamperedServerCandidate = `${saltHex}:${envHex}`;

    let threw = false;
    try {
      verifyReadBackCandidateEnvelope(wasm, newPassword, originalMailboxSk, tamperedServerCandidate);
    } catch (err: any) {
      threw = true;
      assert(
        err.message.includes("does not match historical secret"),
        `Expected mismatch error, got: ${err.message}`
      );
    }
    assert(threw, "Must throw on mismatched read-back candidate secret");
  });

  // 12. verifyReadBackCandidateEnvelope fails closed on malformed read-back
  await test("12. verifyReadBackCandidateEnvelope fails closed on empty or malformed read-back", () => {
    const mailboxSk = new Uint8Array(32);
    let threw = false;
    try {
      verifyReadBackCandidateEnvelope(wasm, "password", mailboxSk, "");
    } catch {
      threw = true;
    }
    assert(threw, "Must throw on empty envelope");

    threw = false;
    try {
      verifyReadBackCandidateEnvelope(wasm, "password", mailboxSk, "not:a:valid:envelope");
    } catch {
      threw = true;
    }
    assert(threw, "Must throw on malformed envelope");
  });

  // 13. executeStagedHistoricalKeyReactivation full 7-step lifecycle succeeds
  await test("13. executeStagedHistoricalKeyReactivation coordinates prepare, read-back, verify, and finalize", async () => {
    const historicalPassword = "correct-old-password-staged";
    const newPassword = "brand-new-staged-password-789";
    const mailboxSk = new Uint8Array(32);
    for (let i = 0; i < 32; i++) mailboxSk[i] = (i * 11) % 256;

    const salt = new Uint8Array(16);
    crypto.getRandomValues(salt);
    const saltHex = Array.from(salt, (b) => b.toString(16).padStart(2, "0")).join("");
    const skHex = Array.from(mailboxSk, (b) => b.toString(16).padStart(2, "0")).join("");
    const envHex = wasm.wasm_passphrase_wrap_key(historicalPassword, saltHex, skHex);
    const prevWrapped = `${saltHex}:${envHex}`;

    let stagedCandidate = "";
    let prepareCalled = 0;
    let fetchPendingCalled = 0;
    let finalizeCalled = 0;
    let rollbackCalled = 0;

    const mockApi = {
      prepare: async (_mailboxId: string, candidate: string) => {
        prepareCalled++;
        stagedCandidate = candidate;
        return { migration_id: "mig-test-1234" };
      },
      fetchPending: async (_mailboxId: string, _migId: string) => {
        fetchPendingCalled++;
        return { candidate_wrapped_sk: stagedCandidate };
      },
      finalize: async (_mailboxId: string, migId: string) => {
        finalizeCalled++;
        assert(migId === "mig-test-1234", "Must finalize with correct migration_id");
        return { success: true, message: "Historical key material successfully reactivated" };
      },
      rollback: async () => {
        rollbackCalled++;
        return { success: true };
      },
    };

    const res = await executeStagedHistoricalKeyReactivation(
      wasm,
      {
        secret: historicalPassword,
        newPassword,
        confirmPassword: newPassword,
        mailboxId: "mb-test-staged",
        previousWrappedSk: prevWrapped,
      },
      mockApi
    );

    assert(prepareCalled === 1, "Prepare must be called once");
    assert(fetchPendingCalled === 1, "FetchPending must be called once");
    assert(finalizeCalled === 1, "Finalize must be called once");
    assert(rollbackCalled === 0, "Rollback must NOT be called on success");
    assert(res.migrationId === "mig-test-1234", "Returned migrationId must match");
    assert(constantTimeEqual(res.unwrappedMailboxSk, mailboxSk), "Recovered key must match original key");
  });

  // 14. executeStagedHistoricalKeyReactivation triggers rollback and never finalizes when read-back differs
  await test("14. Read-back candidate difference triggers rollback and aborts before finalization", async () => {
    const historicalPassword = "correct-old-password-tamper";
    const newPassword = "brand-new-staged-password-tamper";
    const mailboxSk = new Uint8Array(32);
    for (let i = 0; i < 32; i++) mailboxSk[i] = (i + 15) % 256;

    const salt = new Uint8Array(16);
    crypto.getRandomValues(salt);
    const saltHex = Array.from(salt, (b) => b.toString(16).padStart(2, "0")).join("");
    const skHex = Array.from(mailboxSk, (b) => b.toString(16).padStart(2, "0")).join("");
    const envHex = wasm.wasm_passphrase_wrap_key(historicalPassword, saltHex, skHex);
    const prevWrapped = `${saltHex}:${envHex}`;

    let prepareCalled = 0;
    let fetchPendingCalled = 0;
    let finalizeCalled = 0;
    let rollbackCalled = 0;
    let rollbackReason = "";

    // Generate a different candidate envelope (server corruption simulation)
    const diffSk = new Uint8Array(32);
    for (let i = 0; i < 32; i++) diffSk[i] = 99;
    const diffSkHex = Array.from(diffSk, (b) => b.toString(16).padStart(2, "0")).join("");
    const tamperedEnvHex = wasm.wasm_passphrase_wrap_key(newPassword, saltHex, diffSkHex);
    const tamperedCandidate = `${saltHex}:${tamperedEnvHex}`;

    const mockApi = {
      prepare: async () => {
        prepareCalled++;
        return { migration_id: "mig-tamper-5678" };
      },
      fetchPending: async () => {
        fetchPendingCalled++;
        // Server returns corrupted/tampered candidate
        return { candidate_wrapped_sk: tamperedCandidate };
      },
      finalize: async () => {
        finalizeCalled++;
        return { success: true, message: "FAIL_SHOULD_NOT_BE_CALLED" };
      },
      rollback: async (_mailboxId: string, migId: string, reason: string) => {
        rollbackCalled++;
        rollbackReason = reason;
        assert(migId === "mig-tamper-5678", "Rollback must reference migration_id");
        return { success: true };
      },
    };

    let threw = false;
    try {
      await executeStagedHistoricalKeyReactivation(
        wasm,
        {
          secret: historicalPassword,
          newPassword,
          confirmPassword: newPassword,
          mailboxId: "mb-test-tamper",
          previousWrappedSk: prevWrapped,
        },
        mockApi
      );
    } catch (err: any) {
      threw = true;
      assert(err.message.includes("Cryptographic verification"), `Expected verification error, got: ${err.message}`);
    }

    assert(threw, "Workflow must throw on verification failure");
    assert(prepareCalled === 1, "Prepare was called");
    assert(fetchPendingCalled === 1, "FetchPending was called");
    assert(rollbackCalled === 1, "Rollback must be called when read-back verification fails");
    assert(finalizeCalled === 0, "Finalize must NEVER be called when read-back verification fails");
  });

  // 15. executeStagedHistoricalKeyReactivation fails closed before any API call when preflight fails
  await test("15. Preflight failure prevents prepare, read-back, finalize, or rollback from running", async () => {
    let apiCalled = false;
    const mockApi = {
      prepare: async () => { apiCalled = true; return { migration_id: "x" }; },
      fetchPending: async () => { apiCalled = true; return { candidate_wrapped_sk: "x" }; },
      finalize: async () => { apiCalled = true; return { success: true, message: "x" }; },
      rollback: async () => { apiCalled = true; return { success: true }; },
    };

    let threw = false;
    try {
      await executeStagedHistoricalKeyReactivation(
        wasm,
        {
          secret: "wrong-secret",
          newPassword: "valid-password-123",
          confirmPassword: "valid-password-123",
          mailboxId: "mb-1",
          previousWrappedSk: "dummy:payload",
        },
        mockApi
      );
    } catch {
      threw = true;
    }
    assert(threw, "Must throw on preflight failure");
    assert(!apiCalled, "Zero API calls must be made if preflight fails");
  });

  return { passed, failed };
}
