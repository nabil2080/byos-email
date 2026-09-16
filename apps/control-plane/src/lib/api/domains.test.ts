import { listDomains, createDomain, verifyDomain, Domain } from "./domains.js";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export async function runDomainsTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  const runTest = async (name: string, fn: () => void | Promise<void>) => {
    try {
      await fn();
      passed++;
    } catch (err) {
      failed++;
      console.error(`TEST FAILED [${name}]:`, err);
    }
  };

  const originalFetch = globalThis.fetch;

  await runTest("listDomains returns domains from API", async () => {
    try {
      globalThis.fetch = async (url: string | URL | globalThis.Request, init?: RequestInit) => {
        return {
          ok: true,
          json: async () => ({
            domains: [
              { id: "domain-1", name: "example.com", verified: true },
              { id: "domain-2", name: "test.com", is_verified: false },
            ],
          }),
        } as Response;
      };

      const domains = await listDomains("org-123");
      assert(domains.length === 2, "Should return 2 domains");
      assert(domains[0].id === "domain-1", "First domain id should match");
      assert(domains[0].name === "example.com", "First domain name should match");
      assert(domains[0].is_verified === true, "First domain verified should be true");
      
      assert(domains[1].id === "domain-2", "Second domain id should match");
      assert(domains[1].is_verified === false, "Second domain verified should be false");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await runTest("createDomain sends correct POST request", async () => {
    let capturedUrl = "";
    let capturedMethod = "";
    let capturedBody = "";

    try {
      globalThis.fetch = async (url: string | URL | globalThis.Request, init?: RequestInit) => {
        capturedUrl = url.toString();
        capturedMethod = init?.method || "GET";
        capturedBody = typeof init?.body === "string" ? init.body : "";
        
        return {
          ok: true,
          json: async () => ({
            id: "new-domain-id",
            name: "new.com",
            is_verified: false,
          }),
        } as Response;
      };

      const domain = await createDomain("org-123", "new.com");
      assert(capturedUrl.includes("/v1/organizations/org-123/domains"), "Should use correct URL");
      assert(capturedMethod === "POST", "Should use POST method");
      assert(capturedBody.includes('"domain":"new.com"'), "Should send correct payload");
      assert(domain.id === "new-domain-id", "Should return the new domain");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await runTest("verifyDomain sends correct POST request", async () => {
    let capturedUrl = "";
    let capturedMethod = "";

    try {
      globalThis.fetch = async (url: string | URL | globalThis.Request, init?: RequestInit) => {
        capturedUrl = url.toString();
        capturedMethod = init?.method || "GET";
        
        return {
          ok: true,
          json: async () => ({
            status: "verified",
            domain: "domain-123",
          }),
        } as Response;
      };

      const res = await verifyDomain("org-123", "domain-123");
      assert(capturedUrl.includes("/v1/organizations/org-123/domains/domain-123/verify"), "Should use correct URL");
      assert(capturedMethod === "POST", "Should use POST method");
      assert(res.status === "verified", "Should return the correct status");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await runTest("API request failure throws error", async () => {
    try {
      globalThis.fetch = async (url: string | URL | globalThis.Request, init?: RequestInit) => {
        return {
          ok: false,
          status: 403,
          text: async () => "Forbidden",
        } as Response;
      };

      let threw = false;
      try {
        await listDomains("org-123");
      } catch (err: any) {
        threw = true;
        assert(err.status === 403, "Should set status property on error");
        assert(err.message === "Forbidden", "Should use response text as message");
      }
      assert(threw, "Should throw an error when res.ok is false");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  return { passed, failed };
}
