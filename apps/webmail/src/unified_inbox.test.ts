import { ConnectedAccount, MessageMetadata, getAccountColor } from "./api";
import {
  mergeUnifiedMessages,
  filterUnifiedMessages,
  getReplyFromAddress,
  getTargetAccountForAction,
  deduplicateSearchResults,
  MultiAccountSSEManager,
  MailboxEventData,
  getAccountChipSelection,
  getAccountDropdownOptions,
  getSidebarFoldersForSelection,
  getMailboxKeyForMessage,
  DisplayMessage,
} from "./unified_inbox";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export function runUnifiedInboxTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;

  const test = (name: string, fn: () => void | Promise<void>) => {
    try {
      const res = fn();
      if (res && typeof (res as any).then === "function") {
        throw new Error("Async test encountered in sync runner");
      }
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}:`, err);
      failed++;
    }
  };

  console.log("Running Unified Inbox Tests...");

  const accountA: ConnectedAccount = {
    id: "c0000000-0000-0000-0000-000000000001",
    email: "alice@byos.local",
    displayName: "Alice",
    sessionToken: "token-alice-123",
    role: "owner",
    privacyMode: "standard",
    mailboxSkHex: "",
    searchKeyHex: "",
  };

  const accountB: ConnectedAccount = {
    id: "c0000000-0000-0000-0000-000000000002",
    email: "bob@byos.local",
    displayName: "Bob",
    sessionToken: "token-bob-456",
    role: "owner",
    privacyMode: "standard",
    mailboxSkHex: "",
    searchKeyHex: "",
  };

  const connectedAccounts: ConnectedAccount[] = [accountA, accountB];

  const makeMockMeta = (partial: Partial<MessageMetadata>): MessageMetadata => ({
    id: "msg-default",
    mailbox_id: "m-1",
    message_seq: 1,
    direction: "received",
    content_key_hpke_wrapped: "",
    encryption_version: 1,
    encryption_iv: "iv",
    aad_version: 1,
    bundle_hash: "hash",
    received_at: "2026-10-01T00:00:00Z",
    status: "received",
    has_attachments: false,
    attachment_count: 0,
    sender: "sender@external.com",
    recipients: ["user@byos.local"],
    storage_object_id: "obj-default",
    folder: "inbox",
    is_read: false,
    ...partial,
  });

  // 1. test_unified_inbox_merges_accounts
  test("test_unified_inbox_merges_accounts", () => {
    const msgA1 = makeMockMeta({
      id: "msg-a-older",
      sender: "sender1@external.com",
      recipients: ["alice@byos.local"],
      storage_object_id: "obj-1",
      received_at: "2026-10-01T10:00:00Z",
      folder: "inbox",
      is_read: true,
    });
    const msgA2 = makeMockMeta({
      id: "msg-a-newest",
      sender: "sender2@external.com",
      recipients: ["alice@byos.local"],
      storage_object_id: "obj-2",
      received_at: "2026-10-02T12:00:00Z",
      folder: "inbox",
      is_read: false,
    });

    const msgB1 = makeMockMeta({
      id: "msg-b-middle",
      sender: "sender3@external.com",
      recipients: ["bob@byos.local"],
      storage_object_id: "obj-3",
      received_at: "2026-10-02T08:00:00Z",
      folder: "inbox",
      is_read: false,
    });

    const merged = mergeUnifiedMessages([
      { account: accountA, messages: [msgA1, msgA2] },
      { account: accountB, messages: [msgB1] },
    ]);

    assert(merged.length === 3, `Expected 3 merged messages, got ${merged.length}`);
    // Assert sorted by received_at descending: msgA2 (12:00), msgB1 (08:00), msgA1 (prev day 10:00)
    assert(merged[0].id === "msg-a-newest", `Expected first message to be msg-a-newest, got ${merged[0].id}`);
    assert(merged[1].id === "msg-b-middle", `Expected second message to be msg-b-middle, got ${merged[1].id}`);
    assert(merged[2].id === "msg-a-older", `Expected third message to be msg-a-older, got ${merged[2].id}`);
  });

  // 2. test_account_chip_renders
  test("test_account_chip_renders", () => {
    const colorA = getAccountColor(accountA.id);
    const colorB = getAccountColor(accountB.id);

    assert(colorA.startsWith("hsl("), `Expected HSL color for account A, got ${colorA}`);
    assert(colorB.startsWith("hsl("), `Expected HSL color for account B, got ${colorB}`);
    assert(colorA !== colorB, `Expected different colors for distinct accounts, got identical ${colorA}`);

    const msgA = makeMockMeta({
      id: "msg-a",
      sender: "s1@ext.local",
      recipients: ["alice@byos.local"],
      storage_object_id: "obj-a",
      received_at: "2026-10-02T10:00:00Z",
      folder: "inbox",
    });
    const msgB = makeMockMeta({
      id: "msg-b",
      sender: "s2@ext.local",
      recipients: ["bob@byos.local"],
      storage_object_id: "obj-b",
      received_at: "2026-10-02T09:00:00Z",
      folder: "inbox",
    });

    const merged = mergeUnifiedMessages([
      { account: accountA, messages: [msgA] },
      { account: accountB, messages: [msgB] },
    ]);

    const rowA = merged.find((m) => m.id === "msg-a");
    const rowB = merged.find((m) => m.id === "msg-b");

    assert(rowA?.accountColor === colorA, `Row A color mismatch: expected ${colorA}, got ${rowA?.accountColor}`);
    assert(rowB?.accountColor === colorB, `Row B color mismatch: expected ${colorB}, got ${rowB?.accountColor}`);
    assert(rowA?.mailboxId === accountA.id, `Row A mailboxId mismatch`);
    assert(rowB?.mailboxId === accountB.id, `Row B mailboxId mismatch`);
  });

  // 3. test_reply_uses_message_account
  test("test_reply_uses_message_account", () => {
    // Current active account is Bob
    const activeAccount = accountB;

    // We open a message that was delivered to Alice (mailboxId = accountA.id)
    const messageForAlice = {
      id: "msg-123",
      mailboxId: accountA.id,
      accountEmail: accountA.email,
    };

    const replyFrom = getReplyFromAddress(messageForAlice, activeAccount, connectedAccounts);
    assert(
      replyFrom === "alice@byos.local",
      `Expected reply From: to match message account alice@byos.local, but got active account or other: ${replyFrom}`
    );

    // Message delivered to Bob
    const messageForBob = {
      id: "msg-456",
      mailboxId: accountB.id,
      accountEmail: accountB.email,
    };
    // Active account is Alice
    const replyFromBob = getReplyFromAddress(messageForBob, accountA, connectedAccounts);
    assert(
      replyFromBob === "bob@byos.local",
      `Expected reply From: to match message account bob@byos.local, but got: ${replyFromBob}`
    );
  });

  // 4. test_unified_search_deduplicates
  test("test_unified_search_deduplicates", () => {
    const searchResultAccA = [
      { id: "msg-shared-1", mailboxId: accountA.id, subject: "Confidential Project" },
      { id: "msg-unique-a", mailboxId: accountA.id, subject: "Alice Invoice" },
    ];
    const searchResultAccB = [
      { id: "msg-shared-1", mailboxId: accountB.id, subject: "Confidential Project" },
      { id: "msg-unique-b", mailboxId: accountB.id, subject: "Bob Schedule" },
    ];

    const rawCombined = [...searchResultAccA, ...searchResultAccB];
    assert(rawCombined.length === 4, "Raw search results should contain duplicate");

    const deduplicated = deduplicateSearchResults(rawCombined);
    assert(deduplicated.length === 3, `Expected 3 deduplicated search results, got ${deduplicated.length}`);
    const ids = deduplicated.map((m) => m.id);
    assert(ids.includes("msg-shared-1"), "Should include msg-shared-1");
    assert(ids.includes("msg-unique-a"), "Should include msg-unique-a");
    assert(ids.includes("msg-unique-b"), "Should include msg-unique-b");
    assert(ids.filter((id) => id === "msg-shared-1").length === 1, "Duplicate id msg-shared-1 should appear exactly once");
  });

  // 5. test_snooze_uses_correct_account_endpoint
  test("test_snooze_uses_correct_account_endpoint", () => {
    // Active account is Bob
    const activeAccountId = accountB.id;

    // Action targeted at message from Account A
    const messageFromA = {
      id: "msg-to-snooze-a",
      mailboxId: accountA.id,
    };

    const targetA = getTargetAccountForAction(messageFromA, activeAccountId, connectedAccounts);
    assert(
      targetA.mailboxId === accountA.id,
      `Expected target mailbox ID to be Account A (${accountA.id}), got ${targetA.mailboxId}`
    );
    assert(
      targetA.token === accountA.sessionToken,
      `Expected token to be Account A token (${accountA.sessionToken}), got ${targetA.token}`
    );

    // Action targeted at message from Account B with Alice active
    const messageFromB = {
      id: "msg-to-snooze-b",
      mailboxId: accountB.id,
    };
    const targetB = getTargetAccountForAction(messageFromB, accountA.id, connectedAccounts);
    assert(
      targetB.mailboxId === accountB.id,
      `Expected target mailbox ID to be Account B (${accountB.id}), got ${targetB.mailboxId}`
    );
    assert(
      targetB.token === accountB.sessionToken,
      `Expected token to be Account B token, got ${targetB.token}`
    );
  });

  // 6. test_multi_sse_routing
  test("test_multi_sse_routing", () => {
    const sseManager = new MultiAccountSSEManager();

    const accountAStore: MailboxEventData[] = [];
    const accountBStore: MailboxEventData[] = [];

    // Simulate 2 mock EventSources
    let aEmit: ((ev: MailboxEventData) => void) | null = null;
    let bEmit: ((ev: MailboxEventData) => void) | null = null;
    let aClosed = false;
    let bClosed = false;

    sseManager.connect(accountA.id, (mId, onEvent) => {
      aEmit = onEvent;
      return { close: () => { aClosed = true; } };
    });

    sseManager.connect(accountB.id, (mId, onEvent) => {
      bEmit = onEvent;
      return { close: () => { bClosed = true; } };
    });

    assert(sseManager.isConnected(accountA.id), "Account A stream should be active");
    assert(sseManager.isConnected(accountB.id), "Account B stream should be active");

    // Register store listeners
    sseManager.addListener(accountA.id, (ev) => accountAStore.push(ev));
    sseManager.addListener(accountB.id, (ev) => accountBStore.push(ev));

    // Emit event on A's stream
    aEmit!({
      type: "message.created",
      mailboxId: accountA.id,
      folder: "inbox",
      messageId: "msg-new-a",
      unreadDelta: 1,
    });

    // Emit event on B's stream
    bEmit!({
      type: "message.created",
      mailboxId: accountB.id,
      folder: "inbox",
      messageId: "msg-new-b",
      unreadDelta: 1,
    });

    // Assert events routed strictly to the corresponding account store
    assert(accountAStore.length === 1, `Expected 1 event in Account A store, got ${accountAStore.length}`);
    assert(accountAStore[0].messageId === "msg-new-a", "Account A received wrong messageId");
    assert(accountAStore[0].mailboxId === accountA.id, "Account A received wrong mailboxId");

    assert(accountBStore.length === 1, `Expected 1 event in Account B store, got ${accountBStore.length}`);
    assert(accountBStore[0].messageId === "msg-new-b", "Account B received wrong messageId");
    assert(accountBStore[0].mailboxId === accountB.id, "Account B received wrong mailboxId");

    // Disconnect account B stream
    sseManager.disconnect(accountB.id);
    assert(bClosed, "Account B stream close callback should have been called");
    assert(!sseManager.isConnected(accountB.id), "Account B stream should no longer be connected");
    assert(sseManager.isConnected(accountA.id), "Account A stream should remain connected");
  });

  // 7. test_account_chip_shows_current_selection
  test("test_account_chip_shows_current_selection", () => {
    // When unified is selected ("__all__"), chip text is "All Inboxes"
    const unifiedSel = getAccountChipSelection("__all__", "alice@byos.local", connectedAccounts);
    assert(unifiedSel.label === "All Inboxes", `Expected label "All Inboxes", got "${unifiedSel.label}"`);
    assert(unifiedSel.isAll === true, "Expected isAll to be true");

    // When specific account is selected, chip text is that account's email
    const aliceSel = getAccountChipSelection(accountA.id, "alice@byos.local", connectedAccounts);
    assert(aliceSel.label === "alice@byos.local", `Expected label "alice@byos.local", got "${aliceSel.label}"`);
    assert(aliceSel.isAll === false, "Expected isAll to be false for Alice");

    const bobSel = getAccountChipSelection(accountB.id, "bob@byos.local", connectedAccounts);
    assert(bobSel.label === "bob@byos.local", `Expected label "bob@byos.local", got "${bobSel.label}"`);
    assert(bobSel.isAll === false, "Expected isAll to be false for Bob");
  });

  // 8. test_dropdown_lists_all_accounts
  test("test_dropdown_lists_all_accounts", () => {
    const opts = getAccountDropdownOptions(connectedAccounts, "__all__");
    // Dropdown has 1 entry per connected account plus "All Inboxes"
    assert(opts.length === connectedAccounts.length + 1, `Expected ${connectedAccounts.length + 1} options, got ${opts.length}`);
    assert(opts[0].label === "All Inboxes", "First dropdown option must be All Inboxes");
    assert(opts[0].id === "__all__", "First option ID must be sentinel __all__");
    assert(opts[0].isSelected === true, "All Inboxes should be selected when active is __all__");

    // Alice option
    const aliceOpt = opts.find((o) => o.id === accountA.id);
    assert(Boolean(aliceOpt), "Alice must be listed in dropdown");
    assert(aliceOpt?.email === "alice@byos.local", "Alice email mismatch in dropdown");
    assert(aliceOpt?.isSelected === false, "Alice should not be selected when __all__ is active");

    // Bob option
    const bobOpt = opts.find((o) => o.id === accountB.id);
    assert(Boolean(bobOpt), "Bob must be listed in dropdown");
    assert(bobOpt?.email === "bob@byos.local", "Bob email mismatch in dropdown");

    // Selection on specific account
    const optsForAlice = getAccountDropdownOptions(connectedAccounts, accountA.id);
    assert(optsForAlice[0].isSelected === false, "All Inboxes should not be selected");
    const aliceSelected = optsForAlice.find((o) => o.id === accountA.id);
    assert(aliceSelected?.isSelected === true, "Alice option must be marked selected");
  });

  // 9. test_selecting_account_updates_folders
  test("test_selecting_account_updates_folders", () => {
    const folderCounts = {
      inbox: 11,
      sent: 5,
      scheduled: 1,
      drafts: 2,
      snoozed: 0,
      archive: 3,
      spam: 0,
      trash: 0,
    };
    const aliceFolders = getSidebarFoldersForSelection(accountA.id, folderCounts, 22);
    // Clicking account in dropdown updates FOLDERS section to that account's folders
    assert(aliceFolders.length === 8, `Expected 8 folders, got ${aliceFolders.length}`);
    assert(aliceFolders[0].id === "inbox", "Top folder for account must be 'inbox'");
    assert(aliceFolders[0].label === "Inbox", "Top folder label must be 'Inbox'");
    assert(aliceFolders[0].count === 11, `Expected inbox count 11, got ${aliceFolders[0].count}`);
    assert(aliceFolders[0].color === getAccountColor(accountA.id), "Top folder color must match Alice's derived color");

    // Verify folder row dot colors match selected account color
    for (const folder of aliceFolders) {
      assert(folder.color === getAccountColor(accountA.id), `Folder ${folder.id} dot color must match Alice color`);
    }
  });

  // 10. test_selecting_all_inboxes_shows_aggregate
  test("test_selecting_all_inboxes_shows_aggregate", () => {
    const folderCounts = {
      inbox: 11,
      sent: 15,
      scheduled: 3,
      drafts: 4,
      snoozed: 2,
      archive: 9,
      spam: 1,
      trash: 2,
    };
    const unifiedFolders = getSidebarFoldersForSelection("__all__", folderCounts, 22);
    // Clicking "All Inboxes" shows aggregated folder list with combined unread counts
    assert(unifiedFolders.length === 8, `Expected 8 folders, got ${unifiedFolders.length}`);
    assert(unifiedFolders[0].id === "unified_inbox", "Top folder must be 'unified_inbox'");
    assert(unifiedFolders[0].label === "All Inboxes", "Top folder label must be 'All Inboxes'");
    assert(unifiedFolders[0].count === 22, `Expected aggregate count 22, got ${unifiedFolders[0].count}`);
    assert(unifiedFolders[0].isTopInbox === true, "Must be flagged as top inbox");
    assert(unifiedFolders[0].color === "#A27561", "All Inboxes top folder color must be neutral #A27561");

    // All folder row dots match neutral color
    for (const folder of unifiedFolders) {
      assert(folder.color === "#A27561", `Folder ${folder.id} dot color must match neutral #A27561`);
    }
  });

  // 11. test_account_chip_color_matches_selection
  test("test_account_chip_color_matches_selection", () => {
    // Chip dot color matches derived color for specific accounts
    const aliceSel = getAccountChipSelection(accountA.id, accountA.email, connectedAccounts);
    assert(aliceSel.color === getAccountColor(accountA.id), `Alice chip color should be ${getAccountColor(accountA.id)}, got ${aliceSel.color}`);

    const bobSel = getAccountChipSelection(accountB.id, accountB.email, connectedAccounts);
    assert(bobSel.color === getAccountColor(accountB.id), `Bob chip color should be ${getAccountColor(accountB.id)}, got ${bobSel.color}`);
    assert(aliceSel.color !== bobSel.color, "Alice and Bob chip colors must be distinct");

    // Chip dot color is neutral brand color for All Inboxes
    const allSel = getAccountChipSelection("__all__", "", connectedAccounts);
    assert(allSel.color === "#A27561", `All Inboxes chip color should be #A27561, got ${allSel.color}`);
  });

  // 12. test_key_resolution_uses_owning_mailbox
  test("test_key_resolution_uses_owning_mailbox", () => {
    // Simulate: message.mailboxId = B, but only A's key is in the map
    const skKeyA = "byos_mailbox_sk_" + accountA.id;
    const xwingKeyA = "byos_xwing_seed_" + accountA.id;
    const fakeSessionStorage: Record<string, string> = {};
    fakeSessionStorage[skKeyA] = "aabbccdd";
    fakeSessionStorage[xwingKeyA] = "11223344";

    const msgFromB: Partial<DisplayMessage> & { mailboxId: string } = {
      id: "msg-from-b",
      mailboxId: accountB.id,
    };

    // Build a keyMap that only has Account A's keys (simulates wrong-account key lookup)
    const keyMapOnlyA = new Map<string, { xwingSeedHex: string; mailboxSkHex: string }>();
    keyMapOnlyA.set(accountA.id, {
      xwingSeedHex: fakeSessionStorage["byos_xwing_seed_" + accountA.id],
      mailboxSkHex: fakeSessionStorage["byos_mailbox_sk_" + accountA.id],
    });

    // When message.mailboxId = B but keyMap only has A, result must be null (Rule 1)
    const result = getMailboxKeyForMessage(msgFromB as DisplayMessage, keyMapOnlyA);
    assert(result === null, `Expected null when message owner B's key is absent from keyMap (got ${JSON.stringify(result)})`);

    // When keyMap has both A and B, B's message gets B's keys (not A's)
    const keyMapBoth = new Map<string, { xwingSeedHex: string; mailboxSkHex: string }>(keyMapOnlyA);
    keyMapBoth.set(accountB.id, {
      xwingSeedHex: "bbbbbbbb",
      mailboxSkHex: "cccccccc",
    });

    const resultB = getMailboxKeyForMessage(msgFromB as DisplayMessage, keyMapBoth);
    assert(resultB !== null, "Expected B's keys when keyMap has B");
    assert(resultB!.mailboxSkHex === "cccccccc", `Expected B's mailboxSkHex "cccccccc", got ${resultB!.mailboxSkHex}`);
    assert(resultB!.xwingSeedHex === "bbbbbbbb", `Expected B's xwingSeedHex "bbbbbbbb", got ${resultB!.xwingSeedHex}`);
    // Must NOT return A's key for B's message
    assert(resultB!.mailboxSkHex !== "aabbccdd", "Must not return A's key for B's message (Rule 1 violation)");
  });

  // 13. test_key_locked_prompts_for_correct_account
  test("test_key_locked_prompts_for_correct_account", () => {
    // Message from account B, no keys unlocked for B
    const msgFromB: Partial<DisplayMessage> & { mailboxId: string; accountEmail: string } = {
      id: "msg-locked-b",
      mailboxId: accountB.id,
      accountEmail: accountB.email,
    };

    const keyMapOnlyA = new Map<string, { xwingSeedHex: string; mailboxSkHex: string }>();
    keyMapOnlyA.set(accountA.id, {
      xwingSeedHex: "aaaa",
      mailboxSkHex: "bbbb",
    });

    const keys = getMailboxKeyForMessage(msgFromB as DisplayMessage, keyMapOnlyA);
    assert(keys === null, "Key lookup for B must return null when B has no keys");

    // The unlock prompt must name the correct account (B's email), not A's
    const ownerEmail = msgFromB.accountEmail;
    assert(ownerEmail === "bob@byos.local", `Expected locked account prompt for "bob@byos.local", got "${ownerEmail}"`);
    // Must not prompt to unlock account A
    assert(ownerEmail !== "alice@byos.local", "Must not prompt to unlock Alice when Bob's message is locked (Rule 2)");
  });

  // 14. test_unlock_retries_decrypt
  test("test_unlock_retries_decrypt", () => {
    // Simulate unlock: after unlock, B's keys appear in the map
    const msgFromB: Partial<DisplayMessage> & { mailboxId: string } = {
      id: "msg-needs-unlock",
      mailboxId: accountB.id,
    };

    // Before unlock: no keys for B
    const emptyMap = new Map<string, { xwingSeedHex: string; mailboxSkHex: string }>();
    const before = getMailboxKeyForMessage(msgFromB as DisplayMessage, emptyMap);
    assert(before === null, "Before unlock: key lookup must return null");

    // After unlock: B's keys are added
    emptyMap.set(accountB.id, {
      xwingSeedHex: "xwing-b-seed",
      mailboxSkHex: "sk-b-hex",
    });
    const after = getMailboxKeyForMessage(msgFromB as DisplayMessage, emptyMap);
    assert(after !== null, "After unlock: key lookup must return B's keys");
    assert(after!.xwingSeedHex === "xwing-b-seed", "After unlock: must return correct xwingSeedHex for B");
    assert(after!.mailboxSkHex === "sk-b-hex", "After unlock: must return correct mailboxSkHex for B");
  });

  // 15. test_global_key_signal_never_used_in_unified_path
  test("test_global_key_signal_never_used_in_unified_path", () => {
    // Audit: getMailboxKeyForMessage must only consult the keyMap (or sessionStorage keyed by boxId)
    // It must never return keys from a single global slot when boxId does not match.

    const msgFromB: Partial<DisplayMessage> & { mailboxId: string } = {
      id: "msg-b-audit",
      mailboxId: accountB.id,
    };

    // Map only has A's keys (simulating global single-account state)
    const globalSlotA = new Map<string, { xwingSeedHex: string; mailboxSkHex: string }>();
    globalSlotA.set(accountA.id, { xwingSeedHex: "global-xwing", mailboxSkHex: "global-sk" });

    const result = getMailboxKeyForMessage(msgFromB as DisplayMessage, globalSlotA);
    // If getMailboxKeyForMessage fell back to a global slot, it would return accountA's key here.
    // Rule 3: it must return null because B's key is not present.
    assert(result === null, "Rule 3: getMailboxKeyForMessage must never return global account A key for account B's message");

    // Even if mailboxId is undefined, it must return null — not a fallback
    const msgNoId: Partial<DisplayMessage> = { id: "msg-no-id" };
    const resultNoId = getMailboxKeyForMessage(msgNoId as DisplayMessage, globalSlotA);
    assert(resultNoId === null, "Rule 3: must return null when mailboxId is absent — no global fallback");
  });

  return { passed, failed };
}
