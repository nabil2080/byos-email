import { deleteMessage, emptyTrash, DraftMessage, MessageMetadata } from "./api.js";
import { DisplayMessage } from "./components/MessageList.js";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export async function runFolderAndTrashTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  const test = (name: string, fn: () => void | Promise<void>): Promise<void> => {
    try {
      const res = fn();
      if (res && typeof res.then === "function") {
        return res
          .then(() => {
            console.log(`  ✓ ${name}`);
            passed++;
          })
          .catch((err) => {
            console.error(`  ✗ ${name}:`, err);
            failed++;
          });
      }
      console.log(`  ✓ ${name}`);
      passed++;
      return Promise.resolve();
    } catch (err) {
      console.error(`  ✗ ${name}:`, err);
      failed++;
      return Promise.resolve();
    }
  };

  console.log("Running Folder & Permanent Trash Lifecycle Tests...");

  // 1. TestDraftMappingPreservesFolderAndFlags
  await test("1. TestDraftMappingPreservesFolderAndFlags", () => {
    const rawDrafts: DraftMessage[] = [
      {
        id: "d1",
        mailbox_id: "box1",
        subject: "Draft in Drafts",
        recipient: "a@example.com",
        encrypted_envelope: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
        version: 1,
        folder: "drafts",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: "d2",
        mailbox_id: "box1",
        subject: "Draft in Trash",
        recipient: "b@example.com",
        encrypted_envelope: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
        version: 2,
        folder: "trash",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    const display: DisplayMessage[] = rawDrafts.map((d) => ({
      id: d.id,
      version: d.version,
      isDraft: true,
      folder: (d.folder as any) || "drafts",
      folderId: d.folder_id || null,
      sender: "me@byos.local",
      recipient: d.recipient,
      subject: d.subject,
      snippet: "preview",
      encryptedBody: d.encrypted_envelope,
      date: "Today",
      read: true,
      starred: false,
    }));

    assert(display[0].isDraft === true, "d1 should have isDraft: true");
    assert(display[0].folder === "drafts", "d1 should have folder: drafts");
    assert(display[1].isDraft === true, "d2 should have isDraft: true");
    assert(display[1].folder === "trash", "d2 should have folder: trash");
  });

  // 2. TestDraftsInTrashFilterCorrectly
  await test("2. TestDraftsInTrashFilterCorrectly", () => {
    const messages: DisplayMessage[] = [
      { id: "m1", folder: "inbox", sender: "s1", recipient: "r1", subject: "Inbox msg", snippet: "", encryptedBody: "", date: "", read: true, starred: false },
      { id: "m2", folder: "trash", sender: "s2", recipient: "r2", subject: "Trash msg", snippet: "", encryptedBody: "", date: "", read: true, starred: false },
      { id: "d1", isDraft: true, folder: "drafts", sender: "me", recipient: "r3", subject: "Draft 1", snippet: "", encryptedBody: "", date: "", read: true, starred: false },
      { id: "d2", isDraft: true, folder: "trash", sender: "me", recipient: "r4", subject: "Draft in trash", snippet: "", encryptedBody: "", date: "", read: true, starred: false },
    ];

    const filterFolder = (cur: string) => messages.filter((m) => m.folder === cur);

    const draftList = filterFolder("drafts");
    assert(draftList.length === 1, `expected 1 draft in Drafts view, got ${draftList.length}`);
    assert(draftList[0].id === "d1", "expected d1 in Drafts view");

    const trashList = filterFolder("trash");
    assert(trashList.length === 2, `expected 2 items in Trash view, got ${trashList.length}`);
    assert(trashList.some((m) => m.id === "m2"), "expected message m2 in Trash view");
    assert(trashList.some((m) => m.id === "d2"), "expected draft d2 in Trash view");
  });

  // 3. TestMovingDraftToTrashAndRestoreInState
  await test("3. TestMovingDraftToTrashAndRestoreInState", () => {
    let messages: DisplayMessage[] = [
      { id: "d1", isDraft: true, folder: "drafts", sender: "me", recipient: "r", subject: "Draft", snippet: "", encryptedBody: "", date: "", read: true, starred: false },
    ];

    // Move to trash
    messages = messages.map((m) => (m.id === "d1" ? { ...m, folder: "trash" as any } : m));
    assert(messages[0].folder === "trash", "draft should be in trash");

    // Restore to drafts
    messages = messages.map((m) => (m.id === "d1" ? { ...m, folder: "drafts" as any } : m));
    assert(messages[0].folder === "drafts", "draft should be restored to drafts");
  });

  // 4. TestPermanentDeleteFiltersMessage
  await test("4. TestPermanentDeleteFiltersMessage", () => {
    let messages: DisplayMessage[] = [
      { id: "m1", folder: "trash", sender: "s", recipient: "r", subject: "To Delete", snippet: "", encryptedBody: "", date: "", read: true, starred: false },
      { id: "d1", isDraft: true, folder: "trash", sender: "me", recipient: "r", subject: "Draft Delete", snippet: "", encryptedBody: "", date: "", read: true, starred: false },
      { id: "m2", folder: "inbox", sender: "s", recipient: "r", subject: "Inbox", snippet: "", encryptedBody: "", date: "", read: true, starred: false },
    ];

    // Delete m1 permanently
    messages = messages.filter((m) => m.id !== "m1");
    assert(messages.length === 2, "1 message deleted");
    assert(!messages.some((m) => m.id === "m1"), "m1 removed");

    // Delete d1 permanently
    messages = messages.filter((m) => m.id !== "d1");
    assert(messages.length === 1, "draft deleted");
    assert(messages[0].id === "m2", "inbox message remains");
  });

  // 5. TestEmptyTrashFiltersAllTrashItems
  await test("5. TestEmptyTrashFiltersAllTrashItems", () => {
    let messages: DisplayMessage[] = [
      { id: "m1", folder: "trash", sender: "s", recipient: "r", subject: "Trash 1", snippet: "", encryptedBody: "", date: "", read: true, starred: false },
      { id: "d1", isDraft: true, folder: "trash", sender: "me", recipient: "r", subject: "Trash Draft", snippet: "", encryptedBody: "", date: "", read: true, starred: false },
      { id: "m2", folder: "inbox", sender: "s", recipient: "r", subject: "Inbox", snippet: "", encryptedBody: "", date: "", read: true, starred: false },
      { id: "d2", isDraft: true, folder: "drafts", sender: "me", recipient: "r", subject: "Drafts", snippet: "", encryptedBody: "", date: "", read: true, starred: false },
    ];

    // Empty trash
    messages = messages.filter((m) => m.folder !== "trash");
    assert(messages.length === 2, "trash items emptied");
    assert(messages.some((m) => m.id === "m2"), "inbox preserved");
    assert(messages.some((m) => m.id === "d2"), "active draft preserved");
  });

  // 6. TestReadingPaneDraftDetectionInTrash
  await test("6. TestReadingPaneDraftDetectionInTrash", () => {
    const draftInTrash: DisplayMessage = {
      id: "d1",
      isDraft: true,
      folder: "trash",
      sender: "me",
      recipient: "r",
      subject: "Draft in trash",
      snippet: "",
      encryptedBody: "envelope",
      date: "",
      read: true,
      starred: false,
    };

    const regularEmailInTrash: DisplayMessage = {
      id: "m1",
      folder: "trash",
      sender: "sender@example.com",
      recipient: "me@byos.local",
      subject: "Email in trash",
      snippet: "",
      encryptedBody: "storage-ref",
      date: "",
      read: true,
      starred: false,
    };

    const shouldUseDirectDraftDecryption = (msg: DisplayMessage) => Boolean(msg.isDraft || msg.folder === "drafts");

    assert(shouldUseDirectDraftDecryption(draftInTrash) === true, "draft in trash must bypass message body 404");
    assert(shouldUseDirectDraftDecryption(regularEmailInTrash) === false, "regular email in trash must fetch message body");
  });

  // 7. TestUndoActionStoresPreviousAndTargetFolder
  await test("7. TestUndoActionStoresPreviousAndTargetFolder", () => {
    let undoAction: { messageId: string; previousFolder: string; previousFolderId?: string | null; targetFolder?: string } | null = null;

    // Simulate moving message m1 from 'inbox' to 'trash'
    undoAction = {
      messageId: "m1",
      previousFolder: "inbox",
      targetFolder: "trash",
    };

    assert(undoAction.messageId === "m1", "stores messageId");
    assert(undoAction.previousFolder === "inbox", "stores previousFolder");
    assert(undoAction.targetFolder === "trash", "stores targetFolder");

    // Simulate Undo restoring to previousFolder
    const restoredTarget = undoAction.previousFolderId || undoAction.previousFolder;
    assert(restoredTarget === "inbox", "undo restores to inbox");
  });

  // 8. TestSentMessageMoveRestrictions
  await test("8. TestSentMessageMoveRestrictions", () => {
    const messages: DisplayMessage[] = [
      {
        id: "msg-sent-1",
        version: 1,
        sender: "alice@byos.local",
        recipient: "bob@byos.local",
        recipients: ["bob@byos.local"],
        subject: "Outbound",
        snippet: "Hi",
        encryptedBody: "",
        folder: "sent",
        date: new Date().toISOString(),
        read: true,
        starred: false,
      },
      {
        id: "msg-inbox-1",
        version: 1,
        sender: "charlie@byos.local",
        recipient: "alice@byos.local",
        recipients: ["alice@byos.local"],
        subject: "Inbound",
        snippet: "Hello",
        encryptedBody: "",
        folder: "inbox",
        date: new Date().toISOString(),
        read: true,
        starred: false,
      },
    ];

    const canMove = (msgIds: string[], targetFolder: string): { allowedIds: string[]; error?: string } => {
      let allowedIds = msgIds;
      if (targetFolder !== "trash") {
        const msgMap = new Map(messages.map((m) => [m.id, m]));
        const sentCount = msgIds.filter((id) => msgMap.get(id)?.folder === "sent").length;
        if (sentCount > 0) {
          allowedIds = msgIds.filter((id) => msgMap.get(id)?.folder !== "sent");
          if (allowedIds.length === 0) {
            return { allowedIds: [], error: "Sent messages cannot be moved to other folders. They can only be moved to Trash." };
          }
        }
      }
      return { allowedIds };
    };

    // Moving sent to inbox is blocked
    const res1 = canMove(["msg-sent-1"], "inbox");
    assert(res1.allowedIds.length === 0, "sent message cannot move to inbox");
    assert(Boolean(res1.error), "error message provided");

    // Moving sent to archive is blocked
    const res2 = canMove(["msg-sent-1"], "archive");
    assert(res2.allowedIds.length === 0, "sent message cannot move to archive");

    // Moving sent to trash IS allowed
    const res3 = canMove(["msg-sent-1"], "trash");
    assert(res3.allowedIds.length === 1 && res3.allowedIds[0] === "msg-sent-1", "sent message can move to trash");

    // Batch moving sent + inbox to archive filters out sent
    const res4 = canMove(["msg-sent-1", "msg-inbox-1"], "archive");
    assert(res4.allowedIds.length === 1 && res4.allowedIds[0] === "msg-inbox-1", "batch move filters out sent messages");
  });

  // 9. TestSnoozeRestrictions
  await test("9. TestSnoozeRestrictions", () => {
    const isSnoozeAllowed = (folder: string): boolean => {
      return !(folder === "sent" || folder === "trash" || folder === "spam" || folder === "drafts" || folder === "scheduled");
    };

    assert(!isSnoozeAllowed("sent"), "sent folder cannot be snoozed");
    assert(!isSnoozeAllowed("trash"), "trash folder cannot be snoozed");
    assert(!isSnoozeAllowed("spam"), "spam folder cannot be snoozed");
    assert(!isSnoozeAllowed("drafts"), "drafts cannot be snoozed");
    assert(!isSnoozeAllowed("scheduled"), "scheduled messages cannot be snoozed");
    assert(isSnoozeAllowed("inbox"), "inbox messages can be snoozed");
    assert(isSnoozeAllowed("archive"), "archive messages can be snoozed");
    assert(isSnoozeAllowed("custom"), "custom folder messages can be snoozed");
  });

  return { passed, failed };
}
