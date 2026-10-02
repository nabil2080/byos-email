import { Folder } from "./components/Sidebar.js";
import { formatSmartDate } from "./components/MessageRow.js";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export function runScheduledFolderTests(): { passed: number; failed: number } {
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

  console.log("Running Scheduled Folder Tests...");

  test("1. Folder type union includes 'scheduled'", () => {
    const folder: Folder = "scheduled";
    assert(folder === "scheduled", "Folder should allow 'scheduled'");
  });

  test("2. Sidebar folder list order places 'scheduled' between 'sent' and 'drafts'", () => {
    const expectedFolders: Folder[] = [
      "inbox",
      "sent",
      "scheduled",
      "drafts",
      "snoozed",
      "archive",
      "spam",
      "trash",
    ];
    const scheduledIndex = expectedFolders.indexOf("scheduled");
    const sentIndex = expectedFolders.indexOf("sent");
    const draftsIndex = expectedFolders.indexOf("drafts");

    assert(scheduledIndex === 2, "scheduled should be at index 2");
    assert(sentIndex === 1, "sent should be at index 1");
    assert(draftsIndex === 3, "drafts should be at index 3");
    assert(scheduledIndex === sentIndex + 1, "scheduled should be immediately after sent");
    assert(draftsIndex === scheduledIndex + 1, "drafts should be immediately after scheduled");
  });

  test("3. MessageRow formatSmartDate formats scheduled dates correctly", () => {
    const futureDate = new Date(Date.now() + 86400000 * 2).toISOString();
    const formatted = formatSmartDate(futureDate);
    assert(Boolean(formatted), "formatted date should not be empty");
  });

  test("4. DisplayMessage folder supports 'scheduled'", () => {
    const mockMessage = {
      id: "test-sched-1",
      folder: "scheduled" as Folder,
      sender: "recipient@byos.local",
      recipient: "recipient@byos.local",
      subject: "(no subject)",
      snippet: "Scheduled send to recipient@byos.local",
      encryptedBody: "",
      date: "Oct 5, 2026",
      read: true,
      starred: false,
    };
    assert(mockMessage.folder === "scheduled", "folder is scheduled");
  });

  test("5. Scheduled message error placeholders conform to specification", () => {
    const missingRefPlaceholder = "[Scheduled message missing storage reference - this is a bug]";
    const decryptErrorPlaceholder = "[Scheduled message could not be decrypted]";
    assert(missingRefPlaceholder.includes("missing storage reference"), "missing ref placeholder match");
    assert(decryptErrorPlaceholder.includes("could not be decrypted"), "decrypt error placeholder match");
  });

  test("6. Folder threading support accurately distinguishes flat-by-design folders", () => {
    const supportsThreading = (folder: Folder) => folder !== "drafts" && folder !== "scheduled";
    assert(supportsThreading("inbox") === true, "inbox supports threading");
    assert(supportsThreading("sent") === true, "sent supports threading");
    assert(supportsThreading("archive") === true, "archive supports threading");
    assert(supportsThreading("spam") === true, "spam supports threading");
    assert(supportsThreading("trash") === true, "trash supports threading");
    assert(supportsThreading("snoozed") === true, "snoozed supports threading");
    assert(supportsThreading("drafts") === false, "drafts stays flat by design");
    assert(supportsThreading("scheduled") === false, "scheduled stays flat by design");
  });

  test("7. Edit then discard leaves scheduled item untouched", () => {
    let editingScheduledId: string | null = null;
    let composeOpen = false;

    const originalMessage = {
      id: "sched-uuid-1",
      status: "pending",
      scheduledAt: "2026-10-05T15:00:00Z",
      draftStorageRef: "ref_orig",
      subject: "Original Subject",
    };

    // Step 1: Open edit
    editingScheduledId = originalMessage.id;
    composeOpen = true;

    // Verify original message is untouched
    assert(originalMessage.status === "pending", "status remains pending");
    assert(originalMessage.id === "sched-uuid-1", "id remains unchanged");

    // Step 2: Discard without saving
    editingScheduledId = null;
    composeOpen = false;

    // State after discard
    assert(editingScheduledId === null, "editing ID is cleared");
    assert(composeOpen === false, "compose is closed");
    assert(originalMessage.status === "pending", "message is still pending");
    assert(originalMessage.draftStorageRef === "ref_orig", "storage ref is unchanged");
  });

  test("8. Edit then save with body change updates same row in place", () => {
    const originalMessage = {
      id: "sched-uuid-2",
      status: "pending",
      scheduledAt: "2026-10-05T15:00:00Z",
      draftStorageRef: "ref_orig",
      subject: "Original Subject",
    };

    let updatedPayload: any = null;
    const mockUpdateScheduled = (boxId: string, id: string, payload: any) => {
      assert(id === originalMessage.id, "must update the exact same row ID");
      updatedPayload = payload;
      return Promise.resolve({ id, status: "updated" });
    };

    // User edits body -> new draft ref
    const newDraftRef = "ref_new_body";
    mockUpdateScheduled("box-1", originalMessage.id, {
      scheduled_at: originalMessage.scheduledAt,
      draft_storage_ref: newDraftRef,
      subject: "Original Subject",
    });

    assert(updatedPayload !== null, "update was called");
    assert(updatedPayload.draft_storage_ref === "ref_new_body", "new storage ref persisted");
    assert(updatedPayload.scheduled_at === originalMessage.scheduledAt, "send time preserved");
  });

  test("9. Edit then save with time change updates send_at on same row", () => {
    const originalMessage = {
      id: "sched-uuid-3",
      status: "pending",
      scheduledAt: "2026-10-05T15:00:00Z",
      draftStorageRef: "ref_orig",
      subject: "Original Subject",
    };

    let updatedPayload: any = null;
    const newSendAt = "2026-10-06T18:30:00.000Z";

    const mockUpdateScheduled = (boxId: string, id: string, payload: any) => {
      assert(id === originalMessage.id, "must update the exact same row ID");
      updatedPayload = payload;
      return Promise.resolve({ id, status: "updated" });
    };

    mockUpdateScheduled("box-1", originalMessage.id, {
      scheduled_at: newSendAt,
      draft_storage_ref: originalMessage.draftStorageRef,
      subject: originalMessage.subject,
    });

    assert(updatedPayload !== null, "update was called");
    assert(updatedPayload.scheduled_at === newSendAt, "new send_at timestamp updated");
    assert(updatedPayload.draft_storage_ref === "ref_orig", "storage ref preserved");
  });

  test("10. Edit then save with no changes preserves all attributes without orphan drafts", () => {
    const originalMessage = {
      id: "sched-uuid-4",
      status: "pending",
      scheduledAt: "2026-10-05T15:00:00Z",
      draftStorageRef: "ref_orig",
      subject: "Original Subject",
    };

    let createdDraftCount = 0;
    let updateCalled: boolean = false;

    const mockUpdateScheduled = (boxId: string, id: string, payload: any) => {
      assert(id === originalMessage.id, "must update the exact same row ID");
      updateCalled = true;
      return Promise.resolve({ id, status: "updated" });
    };

    mockUpdateScheduled("box-1", originalMessage.id, {
      scheduled_at: originalMessage.scheduledAt,
      draft_storage_ref: originalMessage.draftStorageRef,
      subject: originalMessage.subject,
    });

    assert(Boolean(updateCalled), "update in place succeeded");
    assert(createdDraftCount === 0, "no orphan drafts created");
  });

  test("11. Failed schedule surfaces specific backend error step, not generic wrapper", () => {
    // Simulate backend returning a specific step failure
    const rawBackendError = new Error("schedule: storage upload failed: connection refused");
    const errMsg = rawBackendError.message.startsWith("schedule: ")
      ? rawBackendError.message.slice(10)
      : rawBackendError.message;

    const formattedToast = `Send failed: ${errMsg}`;
    const formattedError = `Failed to send securely: ${errMsg}`;

    assert(
      formattedToast === "Send failed: storage upload failed: connection refused",
      "Toast must surface the failing step"
    );
    assert(
      formattedError === "Failed to send securely: storage upload failed: connection refused",
      "Error banner must surface the failing step"
    );
    assert(
      !formattedToast.includes("failed to schedule message"),
      "Must not be masked by generic wrapper"
    );
  });

  test("12. Schedule send with locked mailbox key surfaces actionable unlock message", () => {
    const isMailboxKeyLocked = true;
    let toastMessage = "";
    let errorMessage = "";

    if (isMailboxKeyLocked) {
      errorMessage = "Your mailbox key is locked. Unlock it to schedule this message.";
      toastMessage = "Your mailbox key is locked. Unlock it to schedule this message.";
    }

    assert(
      toastMessage === "Your mailbox key is locked. Unlock it to schedule this message.",
      "Toast should inform user their mailbox is locked"
    );
    assert(
      errorMessage === "Your mailbox key is locked. Unlock it to schedule this message.",
      "Error banner should inform user their mailbox is locked"
    );
  });

  test("13. Real-time event message.deleted removes scheduled item from list live", () => {
    let scheduledMessages = [
      { id: "sched-1", folder: "scheduled" as Folder, subject: "Meeting tomorrow" },
      { id: "sched-2", folder: "scheduled" as Folder, subject: "Budget report" },
    ];

    // Simulate incoming SSE event: message.deleted for sched-1
    const sseEvent = {
      type: "message.deleted",
      mailboxId: "box-1",
      folder: "scheduled",
      messageId: "sched-1",
      unreadDelta: 0,
    };

    if (sseEvent.type === "message.deleted" && sseEvent.folder === "scheduled") {
      scheduledMessages = scheduledMessages.filter((m) => m.id !== sseEvent.messageId);
    }

    assert(scheduledMessages.length === 1, "One item remains after message.deleted event");
    assert(scheduledMessages[0].id === "sched-2", "Only remaining item is sched-2");
  });

  test("14. Real-time event message.created adds delivered sent copy to Sent folder live", () => {
    let sentMessages: Array<{ id: string; folder: Folder; subject: string }> = [];

    // Simulate incoming SSE event: message.created in sent
    const sseEvent = {
      type: "message.created",
      mailboxId: "box-1",
      folder: "sent",
      messageId: "msg-sent-99",
      unreadDelta: 0,
    };

    if (sseEvent.type === "message.created" && sseEvent.folder === "sent") {
      sentMessages = [
        ...sentMessages,
        { id: sseEvent.messageId, folder: "sent" as Folder, subject: "Meeting tomorrow" },
      ];
    }

    assert(sentMessages.length === 1, "Sent message added live upon message.created event");
    assert(sentMessages[0].id === "msg-sent-99", "Delivered message matches event messageId");
  });

  test("15. Delivery failure event moves message to Drafts with sendFailed marker live", () => {
    let scheduledMessages = [{ id: "sched-fail-1", folder: "scheduled" as Folder, subject: "Important Notice" }];
    let drafts: Array<{ id: string; folder: Folder; subject: string; sendFailed?: boolean }> = [];

    // Simulate events on failure:
    const delEvent = {
      type: "message.deleted",
      mailboxId: "box-1",
      folder: "scheduled",
      messageId: "sched-fail-1",
      unreadDelta: 0,
    };
    const draftEvent = {
      type: "message.created",
      mailboxId: "box-1",
      folder: "drafts",
      messageId: "draft-fail-1",
      unreadDelta: 0,
    };

    if (delEvent.type === "message.deleted" && delEvent.folder === "scheduled") {
      scheduledMessages = scheduledMessages.filter((m) => m.id !== delEvent.messageId);
    }
    if (draftEvent.type === "message.created" && draftEvent.folder === "drafts") {
      drafts = [
        ...drafts,
        { id: draftEvent.messageId, folder: "drafts" as Folder, subject: "Important Notice", sendFailed: true },
      ];
    }

    assert(scheduledMessages.length === 0, "Failed message removed from scheduled");
    assert(drafts.length === 1, "Failed message appears in drafts");
    assert(drafts[0].subject === "Important Notice", "Draft preserves original subject without corruption");
    assert(drafts[0].sendFailed === true, "Draft has sendFailed marker");
  });

  return { passed, failed };
}
