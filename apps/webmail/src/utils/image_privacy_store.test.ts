import {
  extractCleanEmailAddress,
  getSenderImagePolicy,
  setSenderImagePolicy,
  isSenderImageAlwaysAllowed,
  isSenderImageAlwaysBlocked,
  clearSenderImagePreference,
} from "./image_privacy_store";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export async function runImagePrivacyStoreTests(): Promise<{ passed: number; failed: number }> {
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

  console.log("Running Image Privacy Store Tests...");

  // Mock localStorage
  const storage: Record<string, string> = {};
  const mockLocalStorage = {
    getItem: (k: string) => storage[k] || null,
    setItem: (k: string, v: string) => { storage[k] = v; },
    removeItem: (k: string) => { delete storage[k]; },
    clear: () => { Object.keys(storage).forEach((k) => delete storage[k]); },
  };

  const originalLocalStorage = (globalThis as any).localStorage;
  (globalThis as any).localStorage = mockLocalStorage;

  try {
    test("1. TestExtractCleanEmailAddress", () => {
      assert(extractCleanEmailAddress("Alice <alice@byos.local>") === "alice@byos.local", "Extracts email from formatted name");
      assert(extractCleanEmailAddress("bob@example.com") === "bob@example.com", "Normalizes plain email");
      assert(extractCleanEmailAddress("  Carol <CAROL@EXAMPLE.ORG>  ") === "carol@example.org", "Trims and lowercases");
      assert(extractCleanEmailAddress("") === "", "Handles empty string");
    });

    test("2. TestDefaultPolicyIsAsk", () => {
      mockLocalStorage.clear();
      const policy = getSenderImagePolicy("unknown@sender.com");
      assert(policy === "ask", `Expected default policy 'ask', got '${policy}'`);
      assert(!isSenderImageAlwaysAllowed("unknown@sender.com"), "Should not be always allowed by default");
      assert(!isSenderImageAlwaysBlocked("unknown@sender.com"), "Should not be always blocked by default");
    });

    test("3. TestAlwaysAllowLifecycle", () => {
      mockLocalStorage.clear();
      setSenderImagePolicy("newsletter@brand.com", "always_allow");
      assert(getSenderImagePolicy("newsletter@brand.com") === "always_allow", "Policy should be always_allow");
      assert(isSenderImageAlwaysAllowed("newsletter@brand.com"), "isSenderImageAlwaysAllowed should return true");
      assert(!isSenderImageAlwaysBlocked("newsletter@brand.com"), "isSenderImageAlwaysBlocked should return false");

      // Switching to always_block clears always_allow
      setSenderImagePolicy("newsletter@brand.com", "always_block");
      assert(getSenderImagePolicy("newsletter@brand.com") === "always_block", "Policy should be always_block");
      assert(!isSenderImageAlwaysAllowed("newsletter@brand.com"), "Always allow should be cleared");
      assert(isSenderImageAlwaysBlocked("newsletter@brand.com"), "Always block should be true");
    });

    test("4. TestClearSenderPreference", () => {
      mockLocalStorage.clear();
      setSenderImagePolicy("promo@store.com", "always_allow");
      assert(isSenderImageAlwaysAllowed("promo@store.com"), "Initially always allowed");

      clearSenderImagePreference("promo@store.com");
      assert(getSenderImagePolicy("promo@store.com") === "ask", "Policy reverts to ask after clear");
      assert(!isSenderImageAlwaysAllowed("promo@store.com"), "No longer always allowed");
      assert(!isSenderImageAlwaysBlocked("promo@store.com"), "No longer always blocked");
    });
  } finally {
    (globalThis as any).localStorage = originalLocalStorage;
  }

  return { passed, failed };
}
