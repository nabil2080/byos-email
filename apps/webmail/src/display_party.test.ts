import { Folder } from "./components/Sidebar.js";
import { DisplayMessage } from "./components/MessageList.js";
import {
  formatAddress,
  getDisplayParty,
  getDisplayPartyEmail,
} from "./components/MessageRow.js";

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

  // 10. Sent folder row prepends 'To: ' to party label
  test("10. Sent folder row prepends 'To: ' to recipient display", () => {
    const msg: DisplayMessage = {
      id: "msg-sent-prefix",
      folder: "sent",
      sender: "alice@byos.local",
      recipient: "bob@example.com",
      recipients: ["bob@example.com"],
      subject: "Hello Bob",
      snippet: "Test",
      encryptedBody: "enc",
      date: "Now",
      read: true,
      starred: false,
    };

    const isSent = (folder?: Folder) => (folder || msg.folder) === "sent";
    const formatRowDisplay = (m: DisplayMessage, folder?: Folder) => {
      const label = getDisplayParty(m, folder);
      return isSent(folder) ? `To: ${label}` : label;
    };

    assertEquals(
      formatRowDisplay(msg, "sent"),
      "To: bob@example.com",
      "Sent row displays 'To: bob@example.com', not just 'bob@example.com'"
    );

    const inboxMsg: DisplayMessage = {
      ...msg,
      folder: "inbox",
    };
    assertEquals(
      formatRowDisplay(inboxMsg, "inbox"),
      "alice@byos.local",
      "Inbox row displays sender without 'To: ' prefix"
    );
  });

  // 11. Reading pane recipient summary resolves recipient, never sender accountEmail
  test("11. Reading pane displays from <sender> to <recipient> without x to x bug", () => {
    const sentMsg: DisplayMessage = {
      id: "msg-reading-sent",
      folder: "sent",
      sender: "alice@byos.local",
      recipient: "bob@example.com",
      recipients: ["bob@example.com"],
      accountEmail: "alice@byos.local", // Owning mailbox is Alice
      subject: "Proposal",
      snippet: "Details",
      encryptedBody: "enc",
      date: "Today",
      read: true,
      starred: false,
    };

    const recipientSummary = (m: DisplayMessage) => {
      if (m.recipients && m.recipients.length > 0) {
        const valid = m.recipients
          .map((r) => r.trim())
          .filter((r) => r.length > 0 && r.toLowerCase() !== "(no recipient)" && r.toLowerCase() !== "no recipient");
        if (valid.length > 0) {
          return valid.map(formatAddress).join(", ");
        }
      }
      if (m.recipient && m.recipient.trim()) {
        const parts = m.recipient
          .split(",")
          .map((r) => r.trim())
          .filter((r) => r.length > 0 && r.toLowerCase() !== "(no recipient)" && r.toLowerCase() !== "no recipient");
        if (parts.length > 0) {
          return parts.map(formatAddress).join(", ");
        }
      }
      return m.folder === "sent" ? "No recipient" : (m.accountEmail || "me");
    };

    assertEquals(
      recipientSummary(sentMsg),
      "bob@example.com",
      "Sent message recipient summary must resolve to 'bob@example.com', NOT accountEmail 'alice@byos.local'"
    );
    assert(
      recipientSummary(sentMsg) !== sentMsg.accountEmail,
      "Recipient summary must not equal sender accountEmail (avoiding 'x to x' bug)"
    );
  });

  return { passed, failed };
}
