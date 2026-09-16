import { ConnectedAccount } from "./api";

export function runMultiAccountTests() {
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, message: string) {
    if (condition) {
      console.log(`  ✓ ${message}`);
      passed++;
    } else {
      console.error(`  ✗ ${message}`);
      failed++;
    }
  }

  console.log("Running Multi-Account & Storage Sync Tests...");

  // Mock localStorage and sessionStorage
  class MemoryStorage implements Storage {
    private store: Record<string, string> = {};
    get length() {
      return Object.keys(this.store).length;
    }
    clear(): void {
      this.store = {};
    }
    getItem(key: string): string | null {
      return this.store[key] !== undefined ? this.store[key] : null;
    }
    key(index: number): string | null {
      return Object.keys(this.store)[index] || null;
    }
    removeItem(key: string): void {
      delete this.store[key];
    }
    setItem(key: string, value: string): void {
      this.store[key] = String(value);
    }
  }

  const mockLocalStorage = new MemoryStorage();
  const mockSessionStorage = new MemoryStorage();

  // Test 1: Deduplication and promotion of accounts in storage
  function syncAccount(account: ConnectedAccount, storage: Storage) {
    const existingStr = storage.getItem("byos_connected_accounts");
    let list: ConnectedAccount[] = [];
    if (existingStr) {
      try {
        list = JSON.parse(existingStr);
      } catch {}
    }
    if (!Array.isArray(list)) list = [];
    list = list.filter((a) => a.id !== account.id && a.email.toLowerCase() !== account.email.toLowerCase());
    list.unshift(account);
    storage.setItem("byos_connected_accounts", JSON.stringify(list));
    return list;
  }

  const accA: ConnectedAccount = {
    id: "box-1",
    email: "a@domain.local",
    displayName: "User A",
    role: "member",
    privacyMode: "private",
    sessionToken: "token-a",
    mailboxSkHex: "deadbeef",
    searchKeyHex: "feedface",
  };

  const accB: ConnectedAccount = {
    id: "box-2",
    email: "b@domain.local",
    displayName: "User B",
    role: "member",
    privacyMode: "private",
    sessionToken: "token-b",
    mailboxSkHex: "cafebabe",
    searchKeyHex: "baadf00d",
  };

  syncAccount(accA, mockLocalStorage);
  let stored = JSON.parse(mockLocalStorage.getItem("byos_connected_accounts")!);
  assert(stored.length === 1 && stored[0].email === "a@domain.local", "Added Account A to storage");

  syncAccount(accB, mockLocalStorage);
  stored = JSON.parse(mockLocalStorage.getItem("byos_connected_accounts")!);
  assert(stored.length === 2, "Added Account B, total accounts is 2");
  assert(stored[0].email === "b@domain.local", "Account B is promoted to front");

  // Re-sync Account A (e.g. on account switch)
  syncAccount(accA, mockLocalStorage);
  stored = JSON.parse(mockLocalStorage.getItem("byos_connected_accounts")!);
  assert(stored.length === 2, "Re-syncing Account A does not duplicate");
  assert(stored[0].email === "a@domain.local", "Account A is promoted back to front");

  // Test 2: Selective removal
  function removeAccount(id: string, storage: Storage) {
    const existingStr = storage.getItem("byos_connected_accounts");
    let list: ConnectedAccount[] = [];
    if (existingStr) {
      try {
        list = JSON.parse(existingStr);
      } catch {}
    }
    const remaining = list.filter((a) => a.id !== id);
    storage.setItem("byos_connected_accounts", JSON.stringify(remaining));
    return remaining;
  }

  const remaining = removeAccount("box-2", mockLocalStorage);
  assert(remaining.length === 1 && remaining[0].email === "a@domain.local", "Selective logout removes only Account B");

  // Test 3: Effective RP ID resolution on localhost / 127.0.0.1
  function resolveEffectiveRpId(hostname: string, serverRpId?: string): string {
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return hostname;
    }
    return serverRpId || hostname;
  }

  assert(
    resolveEffectiveRpId("127.0.0.1", "localhost") === "127.0.0.1",
    "Origin 127.0.0.1 overrides mismatched server RP ID 'localhost'"
  );
  assert(
    resolveEffectiveRpId("localhost", "127.0.0.1") === "localhost",
    "Origin localhost overrides mismatched server RP ID '127.0.0.1'"
  );
  assert(
    resolveEffectiveRpId("app.byos.email", "byos.email") === "byos.email",
    "Custom domain preserves server RP ID suffix"
  );

  return { passed, failed };
}
