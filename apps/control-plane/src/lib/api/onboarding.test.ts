import {
  getOnboardingState,
  setupDomain,
  verifyDomain,
  selectStorageMode,
  connectStorage,
  createMailboxes,
  inviteEmployees,
  getVerificationMatrix,
  completeOnboarding,
  skipOnboarding,
} from "./onboarding.js";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export async function runOnboardingTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  const runTest = async (name: string, fn: () => void | Promise<void>) => {
    try {
      await fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (err) {
      failed++;
      console.error(`TEST FAILED [${name}]:`, err);
    }
  };

  const originalFetch = globalThis.fetch;

  await runTest("getOnboardingState returns valid state structure", async () => {
    try {
      globalThis.fetch = async () => {
        return {
          ok: true,
          json: async () => ({
            organization: {
              id: "org-test-1",
              name: "Acme Corp",
              seat_count: 5,
              storage_mode: "org_managed",
              completed: false,
              current_step: 1,
              skipped: false,
            },
            owner: { id: "u-1", email: "alice@acme.local", role: "owner" },
            current_step: 1,
            completed_steps: [],
            storage_mode: "org_managed",
            mailbox_count: 0,
            invited_count: 0,
            activated_count: 0,
            completed: false,
            skipped: false,
          }),
        } as Response;
      };

      const res = await getOnboardingState();
      assert(res.current_step === 1, "Expected step 1");
      assert(res.organization.name === "Acme Corp", "Expected org name Acme Corp");
      assert(res.completed === false, "Expected completed false");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await runTest("setupDomain sends domain and receives DNS records preview", async () => {
    try {
      let sentBody = "";
      globalThis.fetch = async (_url, init) => {
        sentBody = init?.body as string;
        return {
          ok: true,
          json: async () => ({
            id: "dom-1",
            name: "acme.local",
            is_verified: false,
            dns_records: [
              { type: "MX", name: "acme.local", value: "mx.byos.email", priority: 10 },
            ],
          }),
        } as Response;
      };

      const res = await setupDomain("acme.local");
      assert(sentBody.includes("acme.local"), "Sent body should contain acme.local");
      assert(res.name === "acme.local", "Expected domain name acme.local");
      assert(res.dns_records.length === 1, "Expected 1 DNS record");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await runTest("verifyDomain handles development verification response", async () => {
    try {
      globalThis.fetch = async () => {
        return {
          ok: true,
          json: async () => ({
            status: "verified",
            domain: "acme.local",
            verification_type: "development",
          }),
        } as Response;
      };

      const res = await verifyDomain("dom-1");
      assert(res.status === "verified", "Expected status verified");
      assert(res.verification_type === "development", "Expected development verification");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await runTest("selectStorageMode verifies org_managed and handles error", async () => {
    try {
      globalThis.fetch = async (_url, init) => {
        const body = JSON.parse(init?.body as string);
        if (body.storage_mode === "org_managed") {
          return {
            ok: true,
            json: async () => ({ storage_mode: "org_managed", current_step: 3 }),
          } as Response;
        }
        return {
          ok: false,
          status: 400,
          json: async () => ({ error: "mode_not_supported" }),
        } as Response;
      };

      const res = await selectStorageMode("org_managed");
      assert(res.current_step === 3, "Expected current_step 3");

      let caught = false;
      try {
        await selectStorageMode("individual");
      } catch {
        caught = true;
      }
      assert(caught, "Individual mode should throw error");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await runTest("connectStorage executes probe and returns verified status", async () => {
    try {
      globalThis.fetch = async () => {
        return {
          ok: true,
          json: async () => ({
            id: "sc-1",
            provider: "minio",
            status: "active",
            bucket_name: "byos-mailbox",
            probe_status: "verified",
            current_step: 4,
          }),
        } as Response;
      };

      const res = await connectStorage("minio", { endpoint: "minio:9000" });
      assert(res.probe_status === "verified", "Expected verified probe");
      assert(res.current_step === 4, "Expected step 4");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await runTest("completeOnboarding resets onboarding_skipped to false", async () => {
    try {
      globalThis.fetch = async () => {
        return {
          ok: true,
          json: async () => ({
            completed: true,
            onboarding_completed_at: "2026-10-17T12:00:00Z",
            onboarding_current_step: 7,
            onboarding_skipped: false,
          }),
        } as Response;
      };

      const res = await completeOnboarding();
      assert(res.completed === true, "Expected completed true");
      assert(res.onboarding_skipped === false, "Expected onboarding_skipped reset to false");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  return { passed, failed };
}
