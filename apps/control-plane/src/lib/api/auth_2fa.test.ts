import {
  fetch2FAStatus,
  setupTOTP,
  verifyTOTP,
  disableTOTP,
  saveRecoveryMethods,
} from "./auth.js";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export async function runAuth2FATests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  const originalFetch = globalThis.fetch;

  const runTest = async (name: string, fn: () => void | Promise<void>) => {
    try {
      await fn();
      passed++;
    } catch (err) {
      failed++;
      console.error(`TEST FAILED [${name}]:`, err);
    } finally {
      globalThis.fetch = originalFetch;
    }
  };

  // 1. fetch2FAStatus
  await runTest("fetch2FAStatus returns status payload on 200", async () => {
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      assert(url.includes("/v1/auth/2fa/status"), `Expected /v1/auth/2fa/status, got ${url}`);
      return new Response(
        JSON.stringify({
          two_factor_enabled: true,
          has_totp: true,
          recovery_email: "backup@byos.local",
          recovery_phone: "+15551234567",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const status = await fetch2FAStatus();
    assert(status.two_factor_enabled === true, "two_factor_enabled should be true");
    assert(status.has_totp === true, "has_totp should be true");
    assert(status.recovery_email === "backup@byos.local", "recovery_email should match");
  });

  // 2. setupTOTP
  await runTest("setupTOTP calls setup endpoint and returns secret & otpauth_url", async () => {
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      assert(url.includes("/v1/auth/2fa/totp/setup"), `Expected /v1/auth/2fa/totp/setup, got ${url}`);
      assert(init?.method === "POST", "Method should be POST");
      return new Response(
        JSON.stringify({
          secret: "JBSWY3DPEBLW64TMMQQQ",
          otpauth_url: "otpauth://totp/BYOS:admin@byos.local?secret=JBSWY3DPEBLW64TMMQQQ&issuer=BYOS",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const setup = await setupTOTP();
    assert(setup.secret === "JBSWY3DPEBLW64TMMQQQ", "secret should match");
    assert(setup.otpauth_url.startsWith("otpauth://totp/"), "otpauth_url format valid");
  });

  // 3. verifyTOTP
  await runTest("verifyTOTP submits code and secret, returning validity", async () => {
    let capturedBody = "";
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      assert(url.includes("/v1/auth/2fa/totp/verify"), `Expected /v1/auth/2fa/totp/verify, got ${url}`);
      assert(init?.method === "POST", "Method should be POST");
      capturedBody = String(init?.body);
      return new Response(
        JSON.stringify({ valid: true, message: "Two-factor authentication successfully enabled." }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const res = await verifyTOTP("JBSWY3DPEBLW64TMMQQQ", "123456");
    assert(res.valid === true, "Should return valid = true");
    assert(capturedBody.includes("123456"), "Should transmit code in body");
  });

  // 4. disableTOTP
  await runTest("disableTOTP submits password to disable 2FA", async () => {
    let capturedBody = "";
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      assert(url.includes("/v1/auth/2fa/totp/disable"), `Expected /v1/auth/2fa/totp/disable, got ${url}`);
      assert(init?.method === "POST", "Method should be POST");
      capturedBody = String(init?.body);
      return new Response(
        JSON.stringify({ success: true, message: "Two-factor authentication disabled." }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const res = await disableTOTP("test-password-123");
    assert(res.success === true, "Should return success = true");
    assert(capturedBody.includes("test-password-123"), "Should transmit password in body");
  });

  // 5. saveRecoveryMethods
  await runTest("saveRecoveryMethods saves backup email and phone", async () => {
    let capturedBody = "";
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      assert(url.includes("/v1/auth/2fa/recovery-methods"), `Expected /v1/auth/2fa/recovery-methods, got ${url}`);
      assert(init?.method === "POST", "Method should be POST");
      capturedBody = String(init?.body);
      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const res = await saveRecoveryMethods("backup@domain.com", "+1234567890");
    assert(res.success === true, "Should return success = true");
    assert(capturedBody.includes("backup@domain.com"), "Should transmit recovery email");
    assert(capturedBody.includes("+1234567890"), "Should transmit recovery phone");
  });

  return { passed, failed };
}
