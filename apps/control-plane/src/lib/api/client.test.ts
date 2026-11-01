import { getCpHeaders } from "./client.js";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export function runClientTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;

  const test = (name: string, fn: () => void) => {
    try {
      fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}:`, err);
      failed++;
    }
  };

  console.log("Running Control Plane API Client & Secure Header Tests...");

  test("test_get_cp_headers_structure", () => {
    const headers = getCpHeaders();
    assert(headers["X-BYOS-Client"] === "control-plane", "Includes X-BYOS-Client: control-plane");
    assert(!headers["Authorization"], "Does not attach default Authorization header");

    const withExtra = getCpHeaders({ "Content-Type": "application/json" });
    assert(withExtra["X-BYOS-Client"] === "control-plane", "Preserves client header");
    assert(withExtra["Content-Type"] === "application/json", "Merges extra headers");
  });

  test("test_get_cp_headers_never_reads_localstorage_bearer_tokens", () => {
    // Setup mock localStorage in node environment
    const storage = new Map<string, string>();
    (globalThis as any).window = {};
    (globalThis as any).localStorage = {
      getItem: (key: string) => storage.get(key) || null,
      setItem: (key: string, val: string) => storage.set(key, val),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    };

    // Even if a token exists in localStorage (e.g. from legacy session or malicious script),
    // getCpHeaders must NEVER read or attach it. The application relies entirely on HttpOnly cookies.
    storage.set("byos_cp_session_token", "dBjftJeZ4CVP-mB92K27uhbU_09y7P54d8VdUzV7wB8");
    const headers = getCpHeaders();
    assert(headers["Authorization"] === undefined, "Never attaches bearer token from localStorage");
    assert(headers["X-BYOS-Client"] === "control-plane", "Preserves control-plane client tag");
  });

  test("test_no_client_side_shannon_entropy_gating_in_auth_flow", () => {
    // Inappropriate client-side Shannon entropy gating H >= 3.5 has been completely removed.
    // Server-side session verification against SHA-256 token hash is the sole authoritative check.
    const headers = getCpHeaders();
    assert(!("Authorization" in headers), "Authorization is governed by HttpOnly cookies, not client entropy filters");
  });

  return { passed, failed };
}
