import {
  fetchActiveSessions,
  revokeOtherSessions,
  verifyAccountPassword,
  changeAccountPassword,
  fetchRecoveryOptions,
  requestRecoveryChallenge,
  resetPasswordWithRecovery,
} from "./auth.js";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export async function runAuthSessionsAndPwdTests(): Promise<{ passed: number; failed: number }> {
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

  // 1. fetchActiveSessions
  await runTest("fetchActiveSessions queries /v1/auth/sessions and returns session list", async () => {
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      assert(url.includes("/v1/auth/sessions"), `Expected /v1/auth/sessions, got ${url}`);
      return new Response(
        JSON.stringify({
          sessions: [
            {
              id: "sess-1",
              ip_address: "127.0.0.1",
              user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0",
              created_at: "2026-01-01T00:00:00Z",
              last_active_at: "2026-01-01T01:00:00Z",
              is_current: true,
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const list = await fetchActiveSessions();
    assert(list.length === 1, "Should return 1 session");
    assert(list[0].id === "sess-1", "Session ID should match");
    assert(list[0].is_current === true, "is_current should be true");
  });

  // 2. revokeOtherSessions
  await runTest("revokeOtherSessions posts to /v1/auth/sessions/revoke-others", async () => {
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      assert(url.includes("/v1/auth/sessions/revoke-others"), `Expected revoke endpoint, got ${url}`);
      assert(init?.method === "POST", "Method should be POST");
      return new Response(
        JSON.stringify({ success: true, revoked_count: 2 }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const res = await revokeOtherSessions();
    assert(res.success === true, "success should be true");
    assert(res.revoked_count === 2, "revoked_count should be 2");
  });

  // 3. verifyAccountPassword
  await runTest("verifyAccountPassword returns validation result", async () => {
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || "{}"));
      assert(body.password === "secret-123", "Payload should contain password");
      return new Response(
        JSON.stringify({ valid: true }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const res = await verifyAccountPassword("secret-123");
    assert(res.valid === true, "Password should be valid");
  });

  // 4. changeAccountPassword
  await runTest("changeAccountPassword submits new_password payload", async () => {
    let capturedBody = "";
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = String(init?.body || "");
      return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    await changeAccountPassword("brand-new-pass-999");
    const parsed = JSON.parse(capturedBody);
    assert(parsed.new_password === "brand-new-pass-999", "new_password should be transmitted");
  });

  // 5. fetchRecoveryOptions
  await runTest("fetchRecoveryOptions returns available methods for email", async () => {
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      assert(url.includes("/v1/auth/recovery/options?email=alice%40byos.local"), `Url mismatch: ${url}`);
      return new Response(
        JSON.stringify({
          email: "alice@byos.local",
          methods: [
            { type: "email", destination_masked: "a***e@byos.local" },
            { type: "passkey", destination_masked: "Hardware Security Key / Biometrics" },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const res = await fetchRecoveryOptions("alice@byos.local");
    assert(res.email === "alice@byos.local", "Email should match");
    assert(res.methods.length === 2, "Methods count should match");
  });

  // 6. requestRecoveryChallenge
  await runTest("requestRecoveryChallenge posts email and method and receives challenge_token", async () => {
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || "{}"));
      assert(body.email === "alice@byos.local", "Email should be alice@byos.local");
      assert(body.method === "email", "Method should be email");
      return new Response(
        JSON.stringify({
          challenge_token: "token-abc-123",
          method: "email",
          destination_masked: "a***e@byos.local",
          expires_at: "2026-01-01T00:10:00Z",
          debug_code: "654321",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const res = await requestRecoveryChallenge("alice@byos.local", "email");
    assert(res.challenge_token === "token-abc-123", "challenge_token should match");
    assert(res.debug_code === "654321", "debug_code should match");
  });

  // 7. resetPasswordWithRecovery
  await runTest("resetPasswordWithRecovery submits token, code, and new_password", async () => {
    let capturedBody = "";
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedBody = String(init?.body || "");
      return new Response(
        JSON.stringify({ token: "new-session-jwt" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const res = await resetPasswordWithRecovery("token-abc-123", "654321", "brand-new-pass-999");
    assert(res.token === "new-session-jwt", "Should return fresh token");
    const parsed = JSON.parse(capturedBody);
    assert(parsed.challenge_token === "token-abc-123", "challenge_token match");
    assert(parsed.code === "654321", "code match");
    assert(parsed.new_password === "brand-new-pass-999", "new_password match");
  });

  return { passed, failed };
}
