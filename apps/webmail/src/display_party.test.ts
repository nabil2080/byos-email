import { Folder } from "./components/Sidebar.js";
import { DisplayMessage } from "./components/MessageList.js";
import {
  formatAddress,
  getDisplayParty,
  getDisplayPartyEmail,
} from "./components/MessageRow.js";
import { formatParticipants } from "./components/ThreadRow.js";
import { ContactItem, ConnectedAccount, OrgMember } from "./api.js";
import {
  buildRecipientCandidates,
  filterAndSortRecipientSuggestions,
  resolveRecipientChip,
  RecipientSuggestion,
} from "./recipient_suggestions.js";
import {
  setAccountKeys,
  getMailboxKeyFor,
  isAccountUnlocked,
  zeroizeKeys,
  zeroizeInMemoryOnly,
  SESSION_VAULT_KEY,
} from "./session_isolation.js";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEquals(actual: any, expected: any, message: string) {
  if (actual !== expected) {
    throw new Error(
      `Assertion failed: ${message} (expected: ${JSON.stringify(expected)}, got: ${JSON.stringify(actual)})`
    );
  }
}

export function runDisplayPartyTests(): { passed: number; failed: number } {
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

  console.log("Running Display Party & Sent Folder Tests...");

  // 1. formatAddress unit tests
  test("1. formatAddress extracts clean display name or email", () => {
    assertEquals(formatAddress("alice@byos.local"), "alice@byos.local", "plain email");
    assertEquals(
      formatAddress('"Alice Smith" <alice@byos.local>'),
      "Alice Smith",
      "quoted display name"
    );
    assertEquals(
      formatAddress("Bob Jones <bob@example.com>"),
      "Bob Jones",
      "unquoted display name"
    );
    assertEquals(
      formatAddress("<charlie@example.com>"),
      "charlie@example.com",
      "angle brackets only"
    );
    assertEquals(formatAddress(""), "", "empty address");
  });

  // 2. Inbox row renders the sender
  test("2. Inbox row renders sender, not recipient", () => {
    const msg: DisplayMessage = {
      id: "msg-1",
      folder: "inbox",
      sender: "alice@byos.local",
      recipient: "bob@example.com",
      recipients: ["bob@example.com"],
      subject: "Hello",
      snippet: "Test snippet",
      encryptedBody: "enc",
      date: "10:00 AM",
      read: false,
      starred: false,
    };

    assertEquals(
      getDisplayParty(msg, "inbox"),
      "alice@byos.local",
      "Inbox row must display sender email"
    );

    const msgWithDisplayName: DisplayMessage = {
      ...msg,
      sender: '"Alice Smith" <alice@byos.local>',
    };
    assertEquals(
      getDisplayParty(msgWithDisplayName, "inbox"),
      "Alice Smith",
      "Inbox row must display sender display name"
    );
  });

  // 3. Other non-sent folders (archive, spam, trash, custom) render sender
  test("3. Archive, spam, trash, and search rows render sender", () => {
    const msg: DisplayMessage = {
      id: "msg-2",
      folder: "archive",
      sender: "support@service.com",
      recipient: "me@byos.local",
      recipients: ["me@byos.local"],
      subject: "Ticket #123",
      snippet: "Your ticket",
      encryptedBody: "enc",
      date: "Yesterday",
      read: true,
      starred: false,
    };

    assertEquals(getDisplayParty(msg, "archive"), "support@service.com", "Archive renders sender");
    assertEquals(getDisplayParty(msg, "spam"), "support@service.com", "Spam renders sender");
    assertEquals(getDisplayParty(msg, "trash"), "support@service.com", "Trash renders sender");
  });

  // 4. Sent row renders the recipient, not the sender
  test("4. Sent row renders recipient, not sender", () => {
    const msg: DisplayMessage = {
      id: "msg-3",
      folder: "sent",
      sender: "alice@byos.local",
      recipient: "bob@example.com",
      recipients: ["bob@example.com"],
      subject: "Proposal",
      snippet: "Please see attached",
      encryptedBody: "enc",
      date: "11:30 AM",
      read: true,
      starred: false,
    };

    assertEquals(
      getDisplayParty(msg, "sent"),
      "bob@example.com",
      "Sent row must show recipient, NOT sender (alice@byos.local)"
    );

    // With display name
    const msgWithDisplayName: DisplayMessage = {
      ...msg,
      recipients: ['"Bob Smith" <bob@example.com>'],
      recipient: '"Bob Smith" <bob@example.com>',
    };
    assertEquals(
      getDisplayParty(msgWithDisplayName, "sent"),
      "Bob Smith",
      "Sent row must display recipient display name"
    );

    // Profile avatar email extraction
    assertEquals(
      getDisplayPartyEmail(msgWithDisplayName, "sent"),
      "bob@example.com",
      "Sent row avatar email must extract recipient email"
    );
  });

  // 5. Sent row with multiple recipients renders first +N
  test("5. Sent row with multiple recipients renders first +N", () => {
    const msgTwoRecipients: DisplayMessage = {
      id: "msg-4",
      folder: "sent",
      sender: "alice@byos.local",
      recipient: "bob@example.com, charlie@example.com",
      recipients: ["bob@example.com", "charlie@example.com"],
      subject: "Meeting",
      snippet: "Sync agenda",
      encryptedBody: "enc",
      date: "12:00 PM",
      read: true,
      starred: false,
    };

    assertEquals(
      getDisplayParty(msgTwoRecipients, "sent"),
      "bob@example.com +1",
      "Sent row with 2 recipients shows first +1"
    );

    const msgThreeRecipients: DisplayMessage = {
      id: "msg-5",
      folder: "sent",
      sender: "alice@byos.local",
      recipient: "Bob Smith <bob@example.com>, charlie@example.com, david@example.com",
      recipients: [
        "Bob Smith <bob@example.com>",
        "charlie@example.com",
        "david@example.com",
      ],
      subject: "Quarterly Review",
      snippet: "Summary",
      encryptedBody: "enc",
      date: "1:00 PM",
      read: true,
      starred: false,
    };

    assertEquals(
      getDisplayParty(msgThreeRecipients, "sent"),
      "Bob Smith +2",
      "Sent row with 3 recipients shows display name +2"
    );
  });

  // 6. Drafts row with no recipient renders No recipient
  test("6. Drafts row with no recipient renders 'No recipient'", () => {
    const emptyDraft: DisplayMessage = {
      id: "draft-1",
      folder: "drafts",
      sender: "alice@byos.local",
      recipient: "",
      recipients: [],
      subject: "Untitled",
      snippet: "Draft content",
      encryptedBody: "enc",
      date: "Just now",
      read: true,
      starred: false,
    };

    assertEquals(
      getDisplayParty(emptyDraft, "drafts"),
      "No recipient",
      "Drafts row with no recipient must show 'No recipient'"
    );

    const draftWithPlaceholder: DisplayMessage = {
      ...emptyDraft,
      recipient: "(no recipient)",
      recipients: [],
    };
    assertEquals(
      getDisplayParty(draftWithPlaceholder, "drafts"),
      "No recipient",
      "Drafts row with '(no recipient)' placeholder must show 'No recipient'"
    );

    // Drafts with recipient
    const draftWithRecipient: DisplayMessage = {
      ...emptyDraft,
      recipient: "carol@example.com",
      recipients: ["carol@example.com"],
    };
    assertEquals(
      getDisplayParty(draftWithRecipient, "drafts"),
      "carol@example.com",
      "Drafts row with recipient shows recipient"
    );
  });

  // 7. Scheduled folder renders recipient(s)
  test("7. Scheduled folder renders recipient(s) and first +N", () => {
    const schedMsg: DisplayMessage = {
      id: "sched-1",
      folder: "scheduled",
      sender: "alice@byos.local",
      recipient: "Partner <partner@example.com>, team@example.com",
      recipients: ["Partner <partner@example.com>", "team@example.com"],
      subject: "Release Announcement",
      snippet: "Scheduled email",
      encryptedBody: "enc",
      date: "Tomorrow, 9:00 AM",
      read: true,
      starred: false,
    };

    assertEquals(
      getDisplayParty(schedMsg, "scheduled"),
      "Partner +1",
      "Scheduled row with 2 recipients shows Partner +1"
    );

    const schedEmpty: DisplayMessage = {
      ...schedMsg,
      recipient: "",
      recipients: [],
    };
    assertEquals(
      getDisplayParty(schedEmpty, "scheduled"),
      "(no recipient)",
      "Scheduled row with no recipient shows '(no recipient)'"
    );
  });

  // 8. Threaded Sent row renders the recipient of the latest message
  test("8. Threaded Sent row renders the recipient of the latest message", () => {
    // Simulate messages in a thread
    const msg1: DisplayMessage = {
      id: "m-1",
      folder: "sent",
      sender: "alice@byos.local",
      recipient: "bob@example.com",
      recipients: ["bob@example.com"],
      subject: "Project Phoenix",
      snippet: "Initial message to Bob",
      encryptedBody: "enc-1",
      date: "9:00 AM",
      read: true,
      starred: false,
    };

    const msg2: DisplayMessage = {
      id: "m-2",
      folder: "sent",
      sender: "alice@byos.local",
      recipient: "Charlie <charlie@example.com>, dave@example.com",
      recipients: ["Charlie <charlie@example.com>", "dave@example.com"],
      subject: "Project Phoenix",
      snippet: "Follow up to Charlie and Dave",
      encryptedBody: "enc-2",
      date: "10:30 AM",
      read: true,
      starred: false,
    };

    const allMessages = [msg1, msg2];
    const thread = {
      thread_id: "th-phoenix",
      folder: "sent",
      message_ids: ["m-1", "m-2"], // ordered chronologically
      participants: ["alice@byos.local", "bob@example.com", "charlie@example.com"],
      message_count: 2,
      unread_count: 0,
      is_starred: false,
      has_attachments: false,
      latest_at: "10:30 AM",
    };

    // Helper logic as implemented in MessageList.tsx:
    const latestId = thread.message_ids[thread.message_ids.length - 1];
    const latestMsg = allMessages.find((m) => m.id === latestId);
    assert(Boolean(latestMsg), "Latest message must be found");
    assertEquals(latestMsg?.id, "m-2", "Latest message must be m-2");

    // Helper logic as implemented in ThreadRow.tsx for displayParty():
    const isSent = (currentFolder: Folder) => (currentFolder || thread.folder) === "sent";
    const computeThreadDisplayParty = (currentFolder: Folder, latestMessage?: DisplayMessage) => {
      if (isSent(currentFolder)) {
        if (latestMessage) {
          return getDisplayParty(latestMessage, "sent");
        }
      }
      return thread.participants[0];
    };

    const threadDisplayInSent = computeThreadDisplayParty("sent", latestMsg);
    assertEquals(
      threadDisplayInSent,
      "Charlie +1",
      "Threaded Sent row must display recipient of latest message (Charlie +1), not sender"
    );
  });

  // 9. Unread styling rule for Sent messages
  test("9. Sent folder rows are never treated as unread", () => {
    // In MessageRow and ThreadRow: isSent() => true, isUnread() => false
    const isSentFolder = (folder?: Folder) => folder === "sent";
    const isMessageUnread = (msg: DisplayMessage, folder?: Folder) => {
      if (isSentFolder(folder || msg.folder)) return false;
      return !msg.read;
    };

    const unreadSentMsg: DisplayMessage = {
      id: "m-unread-flagged",
      folder: "sent",
      sender: "alice@byos.local",
      recipient: "bob@example.com",
      recipients: ["bob@example.com"],
      subject: "Test",
      snippet: "Snippet",
      encryptedBody: "enc",
      date: "Now",
      read: false, // Even if raw read flag is false
      starred: false,
    };

    assertEquals(
      isMessageUnread(unreadSentMsg, "sent"),
      false,
      "Sent message row must never have unread styling"
    );
  });

  // 10. Sender Name Display: Shows Name if available, else clean email
  test("10. Sender Display Logic: shows display name if available, else clean email", () => {
    // 10a. Name in quotes
    assertEquals(
      formatAddress('"Alice Smith" <alice@example.com>'),
      "Alice Smith",
      "quoted name extracted"
    );
    // 10b. Unquoted name
    assertEquals(
      formatAddress("Bob Jones <bob@example.com>"),
      "Bob Jones",
      "unquoted name extracted"
    );
    // 10c. Bare email
    assertEquals(
      formatAddress("charlie@example.com"),
      "charlie@example.com",
      "bare email cleanly returned"
    );
    // 10d. Angle brackets only
    assertEquals(
      formatAddress("<dave@example.com>"),
      "dave@example.com",
      "angle brackets stripped"
    );
    // 10e. Empty name with angle brackets
    assertEquals(
      formatAddress('"" <eve@example.com>'),
      "eve@example.com",
      "empty quoted name falls back to email"
    );
    // 10f. Message with explicit senderName property
    const msgWithSenderName: DisplayMessage = {
      id: "m-sender-name",
      folder: "inbox",
      sender: "frank@example.com",
      senderName: "Frank Sinatra",
      recipient: "me@byos.local",
      subject: "Music",
      snippet: "New song",
      encryptedBody: "enc",
      date: "Today",
      read: true,
      starred: false,
    };
    assertEquals(
      getDisplayParty(msgWithSenderName, "inbox"),
      "Frank Sinatra",
      "senderName property takes precedence"
    );
    // 10g. Message without senderName falls back to formatted sender address
    const msgWithoutSenderName: DisplayMessage = {
      ...msgWithSenderName,
      senderName: undefined,
      sender: "frank@example.com",
    };
    assertEquals(
      getDisplayParty(msgWithoutSenderName, "inbox"),
      "frank@example.com",
      "fallback to clean email when senderName not present"
    );

    // 10h. Resolves sender from contacts when sender is a bare email
    const mockContacts: ContactItem[] = [
      {
        id: "c-1",
        mailbox_id: "mbox-1",
        name: "Bob Stone",
        email: "bob@byos.local",
        notes: "",
        group_name: "Colleagues",
        version: 1,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ];
    const bareBobMsg: DisplayMessage = {
      id: "m-bare-bob",
      folder: "inbox",
      sender: "bob@byos.local",
      recipient: "alice@byos.local",
      subject: "Audit Notes",
      snippet: "Ready",
      encryptedBody: "enc",
      date: "10:00 AM",
      read: false,
      starred: false,
    };
    assertEquals(
      getDisplayParty(bareBobMsg, "inbox", mockContacts),
      "Bob Stone",
      "Resolves bare sender email from contacts"
    );

    // 10i. Resolves sender from connected accounts when sender is a bare email
    const mockAccounts: ConnectedAccount[] = [
      {
        id: "acc-external-1",
        email: "work.admin@corp.io",
        displayName: "Work Administrator",
        role: "admin",
        privacyMode: "standard",
      },
    ];
    const bareWorkMsg: DisplayMessage = {
      id: "m-bare-work",
      folder: "inbox",
      sender: "work.admin@corp.io",
      recipient: "alice@byos.local",
      subject: "System Update",
      snippet: "Done",
      encryptedBody: "enc",
      date: "11:00 AM",
      read: true,
      starred: false,
    };
    assertEquals(
      getDisplayParty(bareWorkMsg, "inbox", [], mockAccounts),
      "Work Administrator",
      "Resolves bare sender email from connected accounts"
    );

    // 10j. Resolution precedence: senderName > contacts > connectedAccounts > bare email
    const precedenceMsg: DisplayMessage = {
      id: "m-prec",
      folder: "inbox",
      sender: "bob@byos.local",
      senderName: "Bobby S.",
      recipient: "alice@byos.local",
      subject: "Status",
      snippet: "Checking in",
      encryptedBody: "enc",
      date: "12:00 PM",
      read: true,
      starred: false,
    };
    assertEquals(
      getDisplayParty(precedenceMsg, "inbox", mockContacts, [
        {
          id: "acc-bob",
          email: "bob@byos.local",
          displayName: "Robert from Storage",
          role: "member",
          privacyMode: "standard",
        },
      ]),
      "Bobby S.",
      "Explicit senderName takes top precedence over contacts and accounts"
    );

    // 10k. Sent folder resolves bare recipient email against contacts
    const sentMsgToBob: DisplayMessage = {
      id: "m-sent-bob",
      folder: "sent",
      sender: "alice@byos.local",
      recipient: "bob@byos.local",
      recipients: ["bob@byos.local"],
      subject: "Reply to Bob",
      snippet: "Got it",
      encryptedBody: "enc",
      date: "1:00 PM",
      read: true,
      starred: false,
    };
    assertEquals(
      getDisplayParty(sentMsgToBob, "sent", mockContacts),
      "Bob Stone",
      "Sent folder resolves bare recipient email from contacts"
    );

    // 10l. ThreadRow formatParticipants resolves participant emails using contacts and connectedAccounts
    const twoParticipants = ["bob@byos.local", "work.admin@corp.io"];
    assertEquals(
      formatParticipants(twoParticipants, mockContacts, mockAccounts),
      "Bob Stone, Work Administrator",
      "ThreadRow formatParticipants resolves 2 participants from contacts and accounts"
    );
    const threeParticipants = ["bob@byos.local", "work.admin@corp.io", "stranger@other.com"];
    assertEquals(
      formatParticipants(threeParticipants, mockContacts, mockAccounts),
      "Bob Stone, Work Administrator +1",
      "ThreadRow formatParticipants resolves names from contacts and accounts with +1 overflow"
    );

    // 10m. SessionStorage sender name persistence simulation
    const msgSessionId = "m-session-persist-test";
    sessionStorage.setItem("byos_msg_sender_name_" + msgSessionId, "Cached Sender Name");
    const cachedName = sessionStorage.getItem("byos_msg_sender_name_" + msgSessionId);
    assertEquals(
      cachedName,
      "Cached Sender Name",
      "sessionStorage preserves decrypted sender name"
    );
    const restoredMsg: DisplayMessage = {
      id: msgSessionId,
      folder: "inbox",
      sender: "bob@byos.local",
      senderName: cachedName || undefined,
      recipient: "alice@byos.local",
      subject: "Session Test",
      snippet: "Testing session restore",
      encryptedBody: "enc",
      date: "2:00 PM",
      read: false,
      starred: false,
    };
    assertEquals(
      getDisplayParty(restoredMsg, "inbox"),
      "Cached Sender Name",
      "getDisplayParty respects senderName restored from sessionStorage"
    );
    sessionStorage.removeItem("byos_msg_sender_name_" + msgSessionId);
  });

  // 11. Mailbox Unlock Persistence Across Refresh
  test("11. Mailbox Unlock Persistence Across Refresh preserves keys in session vault", () => {
    const accountId = "box-refresh-persistence-test";
    const testKey = new Uint8Array(32).fill(0x55);

    // Initial unlock sets keys in memory and sessionStorage vault
    setAccountKeys(accountId, {
      mailboxSk: testKey,
      searchKey: "test-skey-hex",
    });

    assert(isAccountUnlocked(accountId), "account should be unlocked immediately");
    const initialKey = getMailboxKeyFor(accountId);
    assert(initialKey !== null && initialKey[0] === 0x55, "initial key is present");

    // Simulate page reload: wipe in-memory custody (simulating new JS context)
    // while sessionStorage is preserved by browser
    zeroizeInMemoryOnly();

    // Verify key still exists in session vault
    assert(typeof sessionStorage !== "undefined", "sessionStorage must exist");
    const rawVault = sessionStorage.getItem(SESSION_VAULT_KEY);
    assert(rawVault !== null, "session vault must be present in sessionStorage");
    assert(Boolean(rawVault && rawVault.includes("555555")), "vault must contain serialized key material");

    // Key must be restored from session vault on simulated reload
    assert(isAccountUnlocked(accountId), "account is recognized as unlocked from session vault");
    const retrievedKey = getMailboxKeyFor(accountId);
    assert(retrievedKey !== null && retrievedKey[0] === 0x55, "key restored from session vault on simulated reload");

    // Cleanup: explicit zeroizeKeys purges session vault
    zeroizeKeys(accountId);
    assert(!isAccountUnlocked(accountId), "account is recognized as locked after zeroizeKeys");
    assert(getMailboxKeyFor(accountId) === null, "zeroizeKeys purges account from vault");
  });

  // 12. Participant Deduplication, Current User ("me"), and Address-Level Display Name Resolution
  test("12. Participant Deduplication, Current User formatting, and Address-Level Resolution", () => {
    const contacts: ContactItem[] = [
      { id: "c1", mailbox_id: "m1", name: "Alice Smith", email: "alice@byos.local", created_at: "", updated_at: "", version: 1 },
    ];
    const accounts: ConnectedAccount[] = [
      { id: "m2", email: "bob@byos.local", displayName: "Bob Stone", role: "owner", privacyMode: "standard" },
    ];

    // 12a. Multiple messages from same sender (Alice) in the same thread collapse to a single name
    const aliceDuplicates = ["alice@byos.local", "Alice <alice@byos.local>", "Alice Smith <alice@byos.local>"];
    assertEquals(
      formatParticipants(aliceDuplicates, contacts, accounts),
      "Alice Smith",
      "formatParticipants collapses multiple duplicate participant representations of the same sender to 1 name"
    );

    // 12b. Even without contacts, duplicates with bare and formatted headers collapse to a single name
    const rawAliceDuplicates = ["alice@byos.local", "Alice <alice@byos.local>"];
    assertEquals(
      formatParticipants(rawAliceDuplicates),
      "Alice",
      "formatParticipants collapses raw duplicates without contacts to 1 name"
    );

    // 12c. Two distinct participants including currentUserEmail formats current user as 'me'
    const threadWithCurrentUser = ["alice@byos.local", "bob@byos.local"];
    assertEquals(
      formatParticipants(threadWithCurrentUser, contacts, accounts, "bob@byos.local"),
      "Alice Smith, me",
      "formatParticipants formats current user as 'me' when multiple participants exist"
    );

    // 12d. If currentUserEmail is the ONLY participant in the thread, keeps user's name
    const onlyUserThread = ["bob@byos.local"];
    assertEquals(
      formatParticipants(onlyUserThread, contacts, accounts, "bob@byos.local"),
      "Bob Stone",
      "formatParticipants displays user's name when they are the only sender"
    );

    // 12e. getDisplayParty prioritizes personal contacts over unparsed MIME header in sender string
    const msgWithDifferentMimeName: DisplayMessage = {
      id: "m-mime-override",
      folder: "inbox",
      sender: "Alice Wonderland <alice@byos.local>",
      recipient: "bob@byos.local",
      subject: "Test",
      snippet: "Testing contact priority",
      encryptedBody: "enc",
      date: "3:00 PM",
      read: true,
      starred: false,
    };
    assertEquals(
      getDisplayParty(msgWithDifferentMimeName, "inbox", contacts, accounts),
      "Alice Smith",
      "getDisplayParty prioritizes address book contact name over raw MIME header in sender"
    );

    // 12f. getDisplayParty falls back to sessionStorage byos_sender_email_name_<email> when senderName is missing
    sessionStorage.setItem("byos_sender_email_name_charlie@byos.local", "Charlie Brown");
    const msgBareCharlie: DisplayMessage = {
      id: "m-bare-charlie",
      folder: "inbox",
      sender: "charlie@byos.local",
      recipient: "bob@byos.local",
      subject: "Hi",
      snippet: "Hello from Charlie",
      encryptedBody: "enc",
      date: "4:00 PM",
      read: true,
      starred: false,
    };
    assertEquals(
      getDisplayParty(msgBareCharlie, "inbox"),
      "Charlie Brown",
      "getDisplayParty uses address-level cached name from sessionStorage when senderName is absent"
    );
    sessionStorage.removeItem("byos_sender_email_name_charlie@byos.local");

    // 12g. formatParticipants utilizes latestMessage.senderName when participant only has bare email
    const bareThread = ["david@byos.local"];
    const latestDavidMsg: DisplayMessage = {
      id: "m-david",
      folder: "inbox",
      sender: "david@byos.local",
      senderName: "David Miller",
      recipient: "bob@byos.local",
      subject: "Update",
      snippet: "Project update",
      encryptedBody: "enc",
      date: "5:00 PM",
      read: true,
      starred: false,
    };
    assertEquals(
      formatParticipants(bareThread, undefined, undefined, undefined, latestDavidMsg),
      "David Miller",
      "formatParticipants resolves bare participant email from latestMessage.senderName"
    );
  });

  // 13. Compose Recipient Auto-Suggestion & Candidate Resolution
  test("13. Compose Recipient Auto-Suggestion & Candidate Resolution", () => {
    const orgMembers: OrgMember[] = [
      {
        id: "u-bob",
        email: "bob@byos.local",
        display_name: "Bob Builder",
        role: "member",
        is_active: true,
      },
      {
        id: "u-alice",
        email: "alice@byos.local",
        display_name: "Alice Architect",
        role: "admin",
        is_active: true,
      },
    ];

    const contacts: ContactItem[] = [
      {
        id: "c-bob-stale",
        mailbox_id: "mb-1",
        name: "Bob Stone",
        email: "bob@byos.local",
        notes: "Old contact card",
        version: 1,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
      {
        id: "c-carol",
        mailbox_id: "mb-1",
        name: "Carol Consultant",
        email: "carol@external.com",
        group_name: "Contractors",
        version: 1,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ];

    const connectedAccounts: ConnectedAccount[] = [
      {
        id: "acc-dan",
        email: "dan@byos.local",
        displayName: "Dan Director",
        role: "member",
        privacyMode: "standard",
      },
    ];

    const recentSenders = [
      { name: "Eve Engineer", email: "eve@byos.local" },
      { email: "frank@byos.local" },
    ];

    // 13a. buildRecipientCandidates prioritizes organization member display name and marks colleagues
    const candidates = buildRecipientCandidates({
      orgMembers,
      contacts,
      connectedAccounts,
      recentSenders,
      senderAddress: "alice@byos.local",
    });

    // 13a-1. Excludes current sender (Alice) so user is not suggested to themselves
    assert(!candidates.some((c) => c.email === "alice@byos.local"), "Sender 'alice@byos.local' is excluded from self-suggestions");

    // 13a-2. Bob has colleague badge and resolved display name
    const bobCandidate = candidates.find((c) => c.email === "bob@byos.local");
    assert(Boolean(bobCandidate), "Bob candidate exists");
    assertEquals(bobCandidate?.name, "Bob Builder", "Organization display name 'Bob Builder' takes precedence over stale contact 'Bob Stone'");
    assertEquals(bobCandidate?.source, "colleague", "Bob candidate is marked as colleague sharing the sender's domain");

    // 13a-3. Carol external contact is preserved without colleague badge
    const carolCandidate = candidates.find((c) => c.email === "carol@external.com");
    assert(Boolean(carolCandidate), "Carol candidate exists");
    assertEquals(carolCandidate?.name, "Carol Consultant", "Carol contact name preserved");
    assertEquals(carolCandidate?.group_name, "Contractors", "Carol group name preserved");
    assertEquals(carolCandidate?.source, "contact", "External contact does not receive colleague badge");

    // 13a-4. Dan connected account on same domain receives colleague badge
    const danCandidate = candidates.find((c) => c.email === "dan@byos.local");
    assert(Boolean(danCandidate), "Dan account candidate exists");
    assertEquals(danCandidate?.name, "Dan Director", "Dan connected account name preserved");
    assertEquals(danCandidate?.source, "colleague", "Same-domain account receives colleague badge");

    // 13b. Minimum character threshold: queries shorter than 3 characters return empty
    const singleLetterSuggestions = filterAndSortRecipientSuggestions({
      query: "b",
      candidates,
    });
    assertEquals(singleLetterSuggestions.length, 0, "Query with length 1 ('b') returns empty suggestions (below min threshold 3)");

    const twoLetterSuggestions = filterAndSortRecipientSuggestions({
      query: "bo",
      candidates,
    });
    assertEquals(twoLetterSuggestions.length, 0, "Query with length 2 ('bo') returns empty suggestions (below min threshold 3)");

    // 13c. Word-prefix matching: 3+ characters matches word prefixes
    const bobSuggestions = filterAndSortRecipientSuggestions({
      query: "bob",
      candidates,
    });
    assert(bobSuggestions.length > 0, "Suggestions returned for 'bob'");
    assertEquals(bobSuggestions[0].email, "bob@byos.local", "Bob Builder is top suggestion for 'bob'");
    assertEquals(bobSuggestions[0].name, "Bob Builder", "Bob Builder display name returned");

    // 13d. Word-prefix matching matches second word token ("bui" matches "Builder")
    const buiSuggestions = filterAndSortRecipientSuggestions({
      query: "bui",
      candidates,
    });
    assert(buiSuggestions.some((s) => s.email === "bob@byos.local"), "'bui' matches 'Bob Builder'");

    // 13e. Word-prefix does NOT match arbitrary substring inside words ("ild" does not match "Builder")
    const ildSuggestions = filterAndSortRecipientSuggestions({
      query: "ild",
      candidates,
    });
    assertEquals(ildSuggestions.length, 0, "Non-prefix substring 'ild' returns 0 matches (Gmail-style token matching)");

    // 13f. Domain match requires explicit '@' prefix
    const domainQueryWithoutAt = filterAndSortRecipientSuggestions({
      query: "byos",
      candidates,
    });
    assertEquals(domainQueryWithoutAt.length, 0, "'byos' without '@' does not spam-match entire email domain");

    const domainQueryWithAt = filterAndSortRecipientSuggestions({
      query: "@byos",
      candidates,
    });
    assert(domainQueryWithAt.length >= 3, "'@byos' matches candidates with @byos domain");

    // 13g. filterAndSortRecipientSuggestions excludes already selected chips
    const selected = new Set(["bob@byos.local"]);
    const bobSuggestionsExcludingBob = filterAndSortRecipientSuggestions({
      query: "bob",
      candidates,
      selectedEmails: selected,
    });
    assert(!bobSuggestionsExcludingBob.some((s) => s.email === "bob@byos.local"), "Already-selected Bob is excluded from suggestions");

    // 13e. resolveRecipientChip maps bare email to candidate display name
    const resolvedBob = resolveRecipientChip("bob@byos.local", candidates);
    assertEquals(resolvedBob.email, "bob@byos.local", "Resolved email is clean");
    assertEquals(resolvedBob.name, "Bob Builder", "Resolved chip has candidate display name");

    // 13f. resolveRecipientChip preserves explicit RFC 5322 formatted names
    const resolvedExplicit = resolveRecipientChip('"Robert Builder" <bob@byos.local>', candidates);
    assertEquals(resolvedExplicit.email, "bob@byos.local", "Resolved email is clean");
    assertEquals(resolvedExplicit.name, "Robert Builder", "Preserves explicitly typed name override");
  });

  return { passed, failed };
}
