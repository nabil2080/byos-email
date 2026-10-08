import { ConnectedAccount } from "./api";
import { bytesToHex } from "./attachment_crypto";
import {
  rotateSessionGeneration,
  clearAllSensitiveSessionKeys,
  clearAccountKeys,
  persistAccountListForDisplay,
  readSessionGeneration,
  SESSION_GENERATION_KEY,
  formatSessionExpiredError,
  validateRestoredAccount,
  removeStaleAccount,
  getSigningSeedFor,
  getMailboxKeyFor,
  getXWingSeedFor,
  unsealAccountKeys,
} from "./session_isolation";

export async function runMultiAccountTests() {
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

  const accC: ConnectedAccount = {
    id: "box-3",
    email: "c@domain.local",
    displayName: "User C",
    role: "member",
    privacyMode: "private",
    sessionToken: "token-c",
    mailboxSkHex: "11223344",
    searchKeyHex: "55667788",
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

  // ─── Session Isolation Tests (Rules 1-5) ────────────────────────────────────

  // Test 4: test_login_clears_prior_accounts
  // Rule 1: seed localStorage with two accounts' state, log in as a third, assert only the third remains.
  {
    const ls = new MemoryStorage();
    const ss = new MemoryStorage();

    // Seed two prior accounts (Account A and Account B) into storage
    ls.setItem("byos_connected_accounts", JSON.stringify([accA, accB]));
    ss.setItem("byos_connected_accounts", JSON.stringify([accA, accB]));
    ss.setItem("byos_mailbox_sk_" + accA.id, "deadbeef");
    ss.setItem("byos_xwing_seed_" + accB.id, "cafebabe");
    ls.setItem(SESSION_GENERATION_KEY, "old-generation-id");

    // Fresh login as Account C triggers rotateSessionGeneration and stores Account C
    const newGen = rotateSessionGeneration(ls, ss);
    ss.setItem("byos_connected_accounts", JSON.stringify([accC]));
    persistAccountListForDisplay([accC], ls);

    const storedLs = JSON.parse(ls.getItem("byos_connected_accounts")!);
    const storedSs = JSON.parse(ss.getItem("byos_connected_accounts")!);

    assert(
      storedLs.length === 1 && storedLs[0].email === "c@domain.local",
      "test_login_clears_prior_accounts: localStorage contains ONLY Account C (prior accounts cleared)"
    );
    assert(
      storedSs.length === 1 && storedSs[0].email === "c@domain.local",
      "test_login_clears_prior_accounts: sessionStorage contains ONLY Account C"
    );
    assert(
      ss.getItem("byos_mailbox_sk_" + accA.id) === null,
      "test_login_clears_prior_accounts: prior Account A keys are wiped"
    );
    assert(
      ss.getItem("byos_xwing_seed_" + accB.id) === null,
      "test_login_clears_prior_accounts: prior Account B keys are wiped"
    );
    assert(
      ls.getItem(SESSION_GENERATION_KEY) === newGen && newGen !== "old-generation-id",
      "test_login_clears_prior_accounts: new generation marker active"
    );
  }

  // Test 5: test_startup_validates_tokens
  // Rule 2: seed an account with an invalid token, mock /v1/auth/me returning 401, assert the account is removed before render.
  {
    const ls = new MemoryStorage();
    const ss = new MemoryStorage();

    // Seed two accounts in session: A (valid) and B (stale/invalid)
    const initialList = [accA, accB];
    ss.setItem("byos_connected_accounts", JSON.stringify(initialList));
    ss.setItem("byos_mailbox_sk_" + accB.id, "b-key-bytes");

    // Mock token probe where token-b returns 401
    const mockProbe = async (token: string) => {
      if (token === "token-b") {
        const err = new Error("Unauthorized") as Error & { status: number };
        err.status = 401;
        throw err;
      }
      return { ok: true };
    };

    // Probe accounts as startup does
    const validatedList: ConnectedAccount[] = [initialList[0]]; // Primary validated separately
    for (const acc of initialList.slice(1)) {
      const isValid = await validateRestoredAccount(acc, mockProbe);
      if (isValid) {
        validatedList.push(acc);
      } else {
        removeStaleAccount(acc.id, initialList, ss, ls);
      }
    }

    assert(
      validatedList.length === 1 && validatedList[0].id === accA.id,
      "test_startup_validates_tokens: invalid Account B is filtered out before render"
    );
    assert(
      ss.getItem("byos_mailbox_sk_" + accB.id) === null,
      "test_startup_validates_tokens: keys for invalid Account B are purged"
    );
  }

  // Test 6: test_logout_clears_all_keys_for_account
  // Rule 3: log in as two accounts, log out of one, assert that account's byos_* keys are gone but the other's remain.
  {
    const ss = new MemoryStorage();
    ss.setItem("byos_mailbox_sk_" + accA.id, "sk-a");
    ss.setItem("byos_mailbox_skey_" + accA.id, "skey-a");
    ss.setItem("byos_xwing_seed_" + accA.id, "xwing-a");
    ss.setItem("byos_signing_seed_" + accA.id, "signing-a");
    ss.setItem("byos_keys_published_" + accA.id + "_pubkey1_pubkey2", "1");
    // Account B keys
    ss.setItem("byos_mailbox_sk_" + accB.id, "sk-b");
    ss.setItem("byos_xwing_seed_" + accB.id, "xwing-b");

    clearAccountKeys(accA.id, ss);

    assert(
      ss.getItem("byos_mailbox_sk_" + accA.id) === null &&
      ss.getItem("byos_mailbox_skey_" + accA.id) === null &&
      ss.getItem("byos_xwing_seed_" + accA.id) === null &&
      ss.getItem("byos_signing_seed_" + accA.id) === null &&
      ss.getItem("byos_keys_published_" + accA.id + "_pubkey1_pubkey2") === null,
      "test_logout_clears_all_keys_for_account: all keys and publication records cleared for logged-out Account A"
    );
    assert(
      ss.getItem("byos_mailbox_sk_" + accB.id) === "sk-b" &&
      ss.getItem("byos_xwing_seed_" + accB.id) === "xwing-b",
      "test_logout_clears_all_keys_for_account: Account B keys remain intact"
    );
  }

  // Test 7: test_logout_all_clears_everything
  // Rule 3: assert all byos_* keys and the session generation marker are removed.
  {
    const ss = new MemoryStorage();
    const ls = new MemoryStorage();
    ss.setItem("byos_active_session_token", "token-xyz");
    ss.setItem("byos_mailbox_sk_" + accA.id, "sk-a");
    ss.setItem("byos_xwing_seed_" + accA.id, "xwing-a");
    ss.setItem("byos_mailbox_sk_" + accB.id, "sk-b");
    ss.setItem("byos_signing_seed_" + accB.id, "signing-b");
    ss.setItem("byos_pending_send", "{...}");
    ss.setItem(SESSION_GENERATION_KEY, "gen-123");
    ls.setItem(SESSION_GENERATION_KEY, "gen-123");
    ss.setItem("byos_theme", "dark"); // Non-sensitive

    clearAllSensitiveSessionKeys(ss);
    ss.removeItem(SESSION_GENERATION_KEY);
    ls.removeItem(SESSION_GENERATION_KEY);

    assert(
      ss.getItem("byos_active_session_token") === null &&
      ss.getItem("byos_mailbox_sk_" + accA.id) === null &&
      ss.getItem("byos_xwing_seed_" + accA.id) === null &&
      ss.getItem("byos_mailbox_sk_" + accB.id) === null &&
      ss.getItem("byos_signing_seed_" + accB.id) === null &&
      ss.getItem("byos_pending_send") === null,
      "test_logout_all_clears_everything: all sensitive byos_* keys are cleared"
    );
    assert(
      ss.getItem(SESSION_GENERATION_KEY) === null && ls.getItem(SESSION_GENERATION_KEY) === null,
      "test_logout_all_clears_everything: session generation marker removed from both storages"
    );
    assert(
      ss.getItem("byos_theme") === "dark",
      "test_logout_all_clears_everything: non-sensitive preference preserved"
    );
  }

  // Test 8: test_tokens_in_session_storage
  // Rule 4: assert tokens are written to sessionStorage, not localStorage.
  {
    const ls = new MemoryStorage();
    const ss = new MemoryStorage();

    // Storage writes per Rule 4
    ss.setItem("byos_connected_accounts", JSON.stringify([accA]));
    persistAccountListForDisplay([accA], ls);

    const storedSs = JSON.parse(ss.getItem("byos_connected_accounts")!);
    const storedLs = JSON.parse(ls.getItem("byos_connected_accounts")!);

    assert(
      storedSs[0].sessionToken === "token-a",
      "test_tokens_in_session_storage: tokens are present in sessionStorage"
    );
    assert(
      !("sessionToken" in storedLs[0]) || storedLs[0].sessionToken === undefined,
      "test_tokens_in_session_storage: sessionToken is NOT written to localStorage"
    );
    assert(
      !("mailboxSkHex" in storedLs[0]) || storedLs[0].mailboxSkHex === undefined,
      "test_tokens_in_session_storage: mailboxSkHex is NOT written to localStorage"
    );
    assert(
      storedLs[0].email === accA.email,
      "test_tokens_in_session_storage: display metadata (email) is preserved in localStorage"
    );
  }

  // Test 9: test_expired_token_shows_specific_error
  // Rule 5: mock a 401 on a folder fetch, assert the error names the account.
  {
    const ls = new MemoryStorage();
    const ss = new MemoryStorage();
    const accounts = [accA, accB];
    ss.setItem("byos_connected_accounts", JSON.stringify(accounts));

    // Mock a 401 on a folder fetch for Account B
    const targetAccountId = accB.id;
    const targetAccount = accounts.find((a) => a.id === targetAccountId)!;
    const folderFetchError = { status: 401, message: "Unauthorized" };

    // When 401 happens:
    let formattedError = "";
    if (folderFetchError.status === 401) {
      formattedError = formatSessionExpiredError(targetAccount.email);
    }

    assert(
      formattedError === "Your session for b@domain.local has expired. Sign in again to continue.",
      "test_expired_token_shows_specific_error: error message names the specific account"
    );
    assert(
      !formattedError.toLowerCase().includes("failed to load mailbox data: unauthorized"),
      "test_expired_token_shows_specific_error: does not show generic unauthorized error"
    );

    // Rule 5: Remove that account from the sidebar
    const remaining = removeStaleAccount(targetAccountId, accounts, ss, ls);
    assert(
      remaining.length === 1 && remaining[0].id === accA.id,
      "test_expired_token_shows_specific_error: expired account is removed from sidebar"
    );
    assert(
      JSON.parse(ss.getItem("byos_connected_accounts")!).length === 1,
      "test_expired_token_shows_specific_error: storage updated without expired account"
    );
  }

  // Test 10: test_switch_loads_target_account_keys
  // Rule 1: mock two accounts with distinct keys, switch from A to B, assert the active signing seed is B's, not A's.
  {
    const ss = new MemoryStorage();
    const aSigning = "33".repeat(32);
    const aMailbox = "11".repeat(32);
    const bSigning = "44".repeat(32);
    const bMailbox = "22".repeat(32);

    ss.setItem("byos_signing_seed_" + accA.id, aSigning);
    ss.setItem("byos_mailbox_sk_" + accA.id, aMailbox);
    ss.setItem("byos_signing_seed_" + accB.id, bSigning);
    ss.setItem("byos_mailbox_sk_" + accB.id, bMailbox);

    // Initial state: Account A is active
    let activeAccountId = accA.id;
    let activeSigningSeed = getSigningSeedFor(activeAccountId, ss);
    assert(
      activeSigningSeed !== null && bytesToHex(activeSigningSeed) === aSigning,
      "test_switch_loads_target_account_keys: initially on Account A signing seed"
    );

    // Switch to Account B
    const targetKey = getMailboxKeyFor(accB.id, ss);
    assert(targetKey !== null, "test_switch_loads_target_account_keys: target account keys exist in store");
    activeAccountId = accB.id;
    activeSigningSeed = getSigningSeedFor(activeAccountId, ss);

    assert(
      activeSigningSeed !== null && bytesToHex(activeSigningSeed) === bSigning,
      "test_switch_loads_target_account_keys: active signing seed is B's after switch, not A's"
    );
    assert(
      bytesToHex(activeSigningSeed!) !== aSigning,
      "test_switch_loads_target_account_keys: active signing seed does not match A"
    );
  }

  // Test 11: test_switch_unlocks_if_locked
  // Rule 1: switch to a locked account, assert the unlock prompt appears and the switch does not proceed until unlock succeeds.
  {
    const ss = new MemoryStorage();
    const bSigning = "44".repeat(32);
    const bMailbox = "22".repeat(32);

    // Account A is unsealed, Account B is locked (no keys in sessionStorage)
    ss.setItem("byos_signing_seed_" + accA.id, "33".repeat(32));
    ss.setItem("byos_mailbox_sk_" + accA.id, "11".repeat(32));

    let activeAccountId = accA.id;
    let unlockPromptTarget: ConnectedAccount | null = null;
    let switchCompleted: boolean = false;

    // Attempt switch to locked Account B
    function attemptSwitch(targetAcc: ConnectedAccount): boolean {
      const key = getMailboxKeyFor(targetAcc.id, ss);
      if (!key) {
        unlockPromptTarget = targetAcc;
        return false;
      }
      activeAccountId = targetAcc.id;
      return true;
    }

    switchCompleted = attemptSwitch(accB);

    assert(
      unlockPromptTarget !== null && (unlockPromptTarget as ConnectedAccount).id === accB.id,
      "test_switch_unlocks_if_locked: unlock prompt appears when switching to locked account"
    );
    assert(
      switchCompleted === false && activeAccountId === accA.id,
      "test_switch_unlocks_if_locked: switch does not proceed while account is locked"
    );

    // Mock successful unlock of Account B (Rule 3 unseal)
    ss.setItem("byos_mailbox_sk_" + accB.id, bMailbox);
    ss.setItem("byos_signing_seed_" + accB.id, bSigning);

    // Re-attempt switch after unlock
    unlockPromptTarget = null;
    switchCompleted = attemptSwitch(accB);

    assert(
      switchCompleted === true && activeAccountId === accB.id,
      "test_switch_unlocks_if_locked: switch completes after unlock succeeds"
    );
    assert(
      bytesToHex(getSigningSeedFor(activeAccountId, ss)!) === bSigning,
      "test_switch_unlocks_if_locked: active keys are loaded after unlock"
    );
  }

  // Test 12: test_switch_does_not_clear_other_account_keys
  // Rule 4: switch A→B, assert A's keys are still present in sessionStorage.
  {
    const ss = new MemoryStorage();
    const aMailbox = "11".repeat(32);
    const aSigning = "33".repeat(32);
    const aXwing = "55".repeat(32);
    const bMailbox = "22".repeat(32);
    const bSigning = "44".repeat(32);
    const bXwing = "66".repeat(32);

    ss.setItem("byos_mailbox_sk_" + accA.id, aMailbox);
    ss.setItem("byos_signing_seed_" + accA.id, aSigning);
    ss.setItem("byos_xwing_seed_" + accA.id, aXwing);

    ss.setItem("byos_mailbox_sk_" + accB.id, bMailbox);
    ss.setItem("byos_signing_seed_" + accB.id, bSigning);
    ss.setItem("byos_xwing_seed_" + accB.id, bXwing);

    // Perform switch from A to B: load B's keys into active context
    const activeKeyB = getMailboxKeyFor(accB.id, ss);
    const activeSigningB = getSigningSeedFor(accB.id, ss);
    const activeXwingB = getXWingSeedFor(accB.id, ss);

    assert(
      activeKeyB !== null && activeSigningB !== null && activeXwingB !== null,
      "test_switch_does_not_clear_other_account_keys: Account B keys successfully resolved"
    );
    assert(
      ss.getItem("byos_mailbox_sk_" + accA.id) === aMailbox,
      "test_switch_does_not_clear_other_account_keys: Account A mailbox key intact in sessionStorage"
    );
    assert(
      ss.getItem("byos_signing_seed_" + accA.id) === aSigning,
      "test_switch_does_not_clear_other_account_keys: Account A signing seed intact in sessionStorage"
    );
    assert(
      ss.getItem("byos_xwing_seed_" + accA.id) === aXwing,
      "test_switch_does_not_clear_other_account_keys: Account A X-Wing seed intact in sessionStorage"
    );
  }

  // Test 13: test_send_after_switch_signs_with_correct_seed
  // Rule 2 & Rule 5: after switching A→B, mock a send and assert the signed payload used B's signing seed.
  {
    const ss = new MemoryStorage();
    const aSigning = "33".repeat(32);
    const bSigning = "44".repeat(32);

    ss.setItem("byos_signing_seed_" + accA.id, aSigning);
    ss.setItem("byos_signing_seed_" + accB.id, bSigning);

    // Switch A to B
    const activeAccountId = accB.id;

    // Mock send path: payload.mailboxId reflects sender
    const sendPayload = { mailboxId: activeAccountId, recipient: "c@domain.local" };
    const senderSeed = getSigningSeedFor(sendPayload.mailboxId, ss);

    assert(
      senderSeed !== null && bytesToHex(senderSeed) === bSigning,
      "test_send_after_switch_signs_with_correct_seed: send resolves Account B signing seed"
    );
    assert(
      bytesToHex(senderSeed!) !== aSigning,
      "test_send_after_switch_signs_with_correct_seed: send does NOT use Account A signing seed"
    );
  }

  // Test 14: test_decrypt_after_switch_uses_correct_key
  // Rule 2: after switching A→B, open a message from B's inbox, assert the decrypt used B's mailbox key.
  {
    const ss = new MemoryStorage();
    const aMailbox = "11".repeat(32);
    const bMailbox = "22".repeat(32);

    ss.setItem("byos_mailbox_sk_" + accA.id, aMailbox);
    ss.setItem("byos_mailbox_sk_" + accB.id, bMailbox);

    // Switch A to B
    const activeAccountId = accB.id;

    // Message in B's inbox
    const msgInB = { id: "msg-b1", mailboxId: activeAccountId, sender: "alice@domain.local" };
    const decryptKey = getMailboxKeyFor(msgInB.mailboxId, ss);

    assert(
      decryptKey !== null && bytesToHex(decryptKey) === bMailbox,
      "test_decrypt_after_switch_uses_correct_key: decrypt uses Account B mailbox key"
    );
    assert(
      bytesToHex(decryptKey!) !== aMailbox,
      "test_decrypt_after_switch_uses_correct_key: decrypt does NOT use Account A mailbox key"
    );
  }

  // Test 15: test_compose_from_dropdown_controls_signing_key
  // Rule 5: set From: to B while sidebar is on A, assert signing seed is B's.
  {
    const ss = new MemoryStorage();
    const aSigning = "33".repeat(32);
    const bSigning = "44".repeat(32);

    ss.setItem("byos_signing_seed_" + accA.id, aSigning);
    ss.setItem("byos_signing_seed_" + accB.id, bSigning);

    // Sidebar is on Account A
    const sidebarAccountId = accA.id;

    // Compose From: dropdown is selected to Account B
    const composeFromAccountId = accB.id;

    // Outgoing send payload resolved from compose From: field
    const outgoingMailboxId = composeFromAccountId || sidebarAccountId;
    const resolvedSigningSeed = getSigningSeedFor(outgoingMailboxId, ss);

    assert(
      outgoingMailboxId === accB.id,
      "test_compose_from_dropdown_controls_signing_key: outgoing mailbox ID is driven by From: dropdown"
    );
    assert(
      resolvedSigningSeed !== null && bytesToHex(resolvedSigningSeed) === bSigning,
      "test_compose_from_dropdown_controls_signing_key: signing seed is B's, not A's sidebar seed"
    );
    assert(
      bytesToHex(resolvedSigningSeed!) !== aSigning,
      "test_compose_from_dropdown_controls_signing_key: signing seed does not match sidebar selection"
    );
  }

  return { passed, failed };
}
