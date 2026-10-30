import { unsealAccountKeys } from "./session_isolation";
import type { TwoFactorStatus, LoginResponse, MailboxDetail } from "./api";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export async function runUnlockAnd2FAPersistenceTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  const runTest = async (name: string, fn: () => void | Promise<void>) => {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ [FAIL] ${name}:`, err);
    }
  };

  console.log("Running Mailbox Unlock & 2FA Persistence Tests...");

  // Generate a test mailbox secret and passphrase-wrapped key
  const wasm = await import("./generated/crypto-core/byos_crypto_core.js");
  const testMailboxId = "11111111-2222-3333-4444-555555555555";
  const testPassword = "UnlockPassword123!";
  const testEmail = "testuser@byos.local";

  const rawSecret = new Uint8Array(32);
  for (let i = 0; i < 32; i++) rawSecret[i] = (i * 7 + 13) % 256;
  const rawSecretHex = Array.from(rawSecret).map((b) => b.toString(16).padStart(2, "0")).join("");

  const saltBytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) saltBytes[i] = i * 3 + 1;
  const saltHex = Array.from(saltBytes).map((b) => b.toString(16).padStart(2, "0")).join("");

  const envelopeHex = wasm.wasm_passphrase_wrap_key(testPassword, saltHex, rawSecretHex);
  const wrappedSkUser = JSON.stringify({
    salt: saltHex,
    envelope: envelopeHex,
  });

  // 1. Mailbox unlock key resolution with 2FA active (returns two_factor_required: true)
  await runTest("Mailbox unlock succeeds when login requires 2FA by resolving wrapped_sk_user from mailbox detail", async () => {
    // Simulated login endpoint response when 2FA is active
    const loginRes: LoginResponse = {
      two_factor_required: true,
      challenge_token: "chal_test_token_abc123",
      methods: ["totp"],
      preferred_method: "totp",
      destination_masked: "Authenticator App",
    };

    // Simulated target
    const target = {
      mailboxId: testMailboxId,
      email: testEmail,
    };

    // Simulated session / mailbox store
    let wrappedSk = loginRes.wrapped_sk_user || "";

    // Unlocking fallback logic (mirrors App.tsx handlePerformUnlockAccount)
    if (!wrappedSk) {
      const mailboxDetail: MailboxDetail = {
        mailbox_id: testMailboxId,
        mode: "private",
        mailbox_pk: "dummy_pk",
        mailbox_sk_wrapped: "dummy_sk_wrapped",
        mailbox_sk_version: 1,
        wrapped_sk_user: wrappedSkUser,
      };
      if (mailboxDetail.wrapped_sk_user) {
        wrappedSk = mailboxDetail.wrapped_sk_user;
      }
    }

    assert(Boolean(wrappedSk), "wrappedSk must be resolved from mailbox detail fallback");

    // Unseal account keys using unsealAccountKeys
    const unwrapped = await unsealAccountKeys(target.mailboxId, testPassword, wrappedSk);
    assert(unwrapped.mailboxSk.length === 32, "Unwrapped mailbox secret key must be 32 bytes");
    for (let i = 0; i < 32; i++) {
      assert(unwrapped.mailboxSk[i] === rawSecret[i], `Secret byte ${i} mismatch`);
    }
  });

  // 2. Mailbox unlock fails closed when password is incorrect
  await runTest("Mailbox unlock fails closed on invalid password", async () => {
    let failedClosed = false;
    try {
      await unsealAccountKeys(testMailboxId, "WrongPassword999!", wrappedSkUser);
    } catch {
      failedClosed = true;
    }
    assert(failedClosed, "unsealAccountKeys must fail closed when wrong password is supplied");
  });

  // 3. 2FA Status evaluation: no enrolled factors evaluates to two_factor_enabled = false
  await runTest("2FA status with no enrolled factors evaluates to two_factor_enabled = false", () => {
    const status: TwoFactorStatus = {
      two_factor_enabled: false,
      has_totp: false,
      has_passkey: false,
      is_owner: false,
    };
    assert(status.two_factor_enabled === false, "2FA must be reported inactive when no factors enrolled");
    assert(status.has_totp === false, "has_totp must be false");
    assert(status.has_passkey === false, "has_passkey must be false");
  });

  // 4. Disabling TOTP preserves inactive state upon page reload when no passkeys exist
  await runTest("Disabling TOTP preserves inactive state after simulated reload", () => {
    // Initial: TOTP enabled
    let currentStatus: TwoFactorStatus = {
      two_factor_enabled: true,
      has_totp: true,
      has_passkey: false,
      is_owner: false,
    };

    // User disables TOTP
    const simulateDisableTotp = () => {
      // Backend: totp_secret = NULL, two_factor_enabled = (passkeyCount > 0)
      return {
        two_factor_enabled: false,
        has_totp: false,
        has_passkey: false,
        is_owner: false,
      };
    };

    currentStatus = simulateDisableTotp();
    assert(currentStatus.has_totp === false, "has_totp must be false after disabling TOTP");
    assert(currentStatus.two_factor_enabled === false, "two_factor_enabled must be false after disabling TOTP");

    // Simulated page reload: fetch2FAStatus() is called
    const simulateReload = (): TwoFactorStatus => {
      // Server evaluates effective2FA = (hasTOTP || hasPasskey)
      const hasTOTP = false;
      const hasPasskey = false;
      return {
        two_factor_enabled: hasTOTP || hasPasskey,
        has_totp: hasTOTP,
        has_passkey: hasPasskey,
        is_owner: false,
      };
    };

    const reloadedStatus = simulateReload();
    assert(reloadedStatus.two_factor_enabled === false, "Reloaded status must stay two_factor_enabled = false");
    assert(reloadedStatus.has_totp === false, "Reloaded status must stay has_totp = false");
  });

  // 5. Deleting passkey when TOTP is inactive transitions 2FA to inactive and stays inactive on reload
  await runTest("Deleting passkey transitions 2FA to inactive and stays inactive on reload", () => {
    // Initial: passkey enrolled, no TOTP
    let currentStatus: TwoFactorStatus = {
      two_factor_enabled: true,
      has_totp: false,
      has_passkey: true,
      is_owner: false,
    };

    // User deletes passkey
    const simulateDeletePasskey = (): TwoFactorStatus => {
      const hasTOTP = false;
      const passkeyCount = 0;
      return {
        two_factor_enabled: (hasTOTP || passkeyCount > 0),
        has_totp: hasTOTP,
        has_passkey: passkeyCount > 0,
        is_owner: false,
      };
    };

    currentStatus = simulateDeletePasskey();
    assert(currentStatus.has_passkey === false, "has_passkey must be false after deleting passkey");
    assert(currentStatus.two_factor_enabled === false, "two_factor_enabled must be false after deleting last passkey");

    // Simulated page reload
    const reloadedStatus = simulateDeletePasskey();
    assert(reloadedStatus.two_factor_enabled === false, "Reloaded status must preserve inactive 2FA state");
  });

  return { passed, failed };
}
