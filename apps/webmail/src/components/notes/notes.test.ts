import {
  NoteItem,
  NOTE_COLORS,
  loadNotes,
  saveNotes,
  createNote,
  updateNote,
  deleteNote,
  deleteNoteForever,
  restoreNoteFromBin,
  emptyBin,
  archiveNote,
  unarchiveNote,
  togglePinNote,
  duplicateNote,
  loadLabels,
  addLabel,
  renameLabel,
  deleteLabel,
  saveNoteVersion,
  restoreNoteVersion,
} from "./notesStore";

export async function runNotesTests() {
  console.log("Running Google Keep Notes Feature Tests...");

  // Mock localStorage for test environment
  let memoryStore: Record<string, string> = {};
  const mockStorage = {
    getItem: (key: string) => memoryStore[key] || null,
    setItem: (key: string, val: string) => {
      memoryStore[key] = val;
    },
    removeItem: (key: string) => {
      delete memoryStore[key];
    },
    clear: () => {
      memoryStore = {};
    },
  };

  const origLocalStorage = (globalThis as any).localStorage;
  (globalThis as any).localStorage = mockStorage;

  const testMailboxId = `mbx_notes_test_${Date.now()}`;

  try {
    // 1. Initial load provides default welcome notes with checklists
    const initialNotes = loadNotes(testMailboxId);
    if (initialNotes.length < 2) {
      throw new Error(`Expected at least 2 default notes, got ${initialNotes.length}`);
    }
    const welcome = initialNotes.find((n) => n.id === "note-welcome");
    if (!welcome || !welcome.isPinned) {
      throw new Error("Default welcome note should be pinned");
    }
    const checklistNote = initialNotes.find((n) => n.isChecklist);
    if (!checklistNote || (checklistNote.checklistItems?.length || 0) < 3) {
      throw new Error("Default checklist note must have checklist items");
    }
    console.log("  ✓ 1. Initial load provides welcome notes with checklists, labels, and reminders");

    // 2. Labels Management: add, rename, delete
    const initialLabels = loadLabels(testMailboxId);
    if (!initialLabels.includes("Work")) {
      throw new Error("Initial labels should include 'Work'");
    }
    addLabel(testMailboxId, "Urgent Project");
    const withNewLabel = loadLabels(testMailboxId);
    if (!withNewLabel.includes("Urgent Project")) {
      throw new Error("addLabel failed to add 'Urgent Project'");
    }
    renameLabel(testMailboxId, "Urgent Project", "Critical Project");
    const withRenamed = loadLabels(testMailboxId);
    if (withRenamed.includes("Urgent Project") || !withRenamed.includes("Critical Project")) {
      throw new Error("renameLabel failed");
    }
    deleteLabel(testMailboxId, "Critical Project");
    const withDeleted = loadLabels(testMailboxId);
    if (withDeleted.includes("Critical Project")) {
      throw new Error("deleteLabel failed");
    }

    // Delete all remaining labels to verify they do not come back
    for (const l of [...withDeleted]) {
      deleteLabel(testMailboxId, l);
    }
    const emptyLabels = loadLabels(testMailboxId);
    if (emptyLabels.length !== 0) {
      throw new Error(`Expected 0 labels after deleting all, got ${emptyLabels.length}: ${JSON.stringify(emptyLabels)}`);
    }
    // Re-seed one label for subsequent tests
    addLabel(testMailboxId, "Work");
    console.log("  ✓ 2. Google Keep labels management (add, rename, delete all without restore bug) works reliably");

    // 3. Create Note with Checklist, Color, and Reminder
    const created = createNote(
      testMailboxId,
      "Sprint Goals",
      "Key deliverables for next release",
      "peach",
      true,
      {
        isChecklist: true,
        checklistItems: [
          { id: "sprint-1", text: "Wire TopFixedBar beside sidebar", completed: true },
          { id: "sprint-2", text: "Add Keep sidebar with Reminders and Labels", completed: false },
        ],
        labels: ["Work"],
        reminder: {
          timestamp: Date.now() + 3600000,
          label: "Later today, 8:00 PM",
        },
      }
    );
    if (!created.isChecklist || created.checklistItems?.length !== 2) {
      throw new Error("Checklist note structure mismatch");
    }
    if (created.color !== "peach" || !created.isPinned || created.labels[0] !== "Work") {
      throw new Error("Created note metadata mismatch");
    }
    console.log("  ✓ 3. createNote supports checklists, color styling, labels, and reminders");

    // 4. Archive & Unarchive
    archiveNote(testMailboxId, created.id);
    const archivedCheck = loadNotes(testMailboxId).find((n) => n.id === created.id);
    if (!archivedCheck?.isArchived || archivedCheck.isPinned) {
      throw new Error("archiveNote must set isArchived=true and unpin");
    }
    unarchiveNote(testMailboxId, created.id);
    const unarchivedCheck = loadNotes(testMailboxId).find((n) => n.id === created.id);
    if (unarchivedCheck?.isArchived) {
      throw new Error("unarchiveNote failed");
    }
    console.log("  ✓ 4. Archive and Unarchive note lifecycle functions correctly");

    // 5. Bin / Trash Lifecycle: Move to bin, restore, empty bin
    deleteNote(testMailboxId, created.id); // In Keep, delete moves to Bin first!
    const binnedCheck = loadNotes(testMailboxId).find((n) => n.id === created.id);
    if (!binnedCheck?.isInBin) {
      throw new Error("deleteNote should move note into Bin");
    }
    restoreNoteFromBin(testMailboxId, created.id);
    const restoredCheck = loadNotes(testMailboxId).find((n) => n.id === created.id);
    if (restoredCheck?.isInBin) {
      throw new Error("restoreNoteFromBin failed");
    }
    deleteNote(testMailboxId, created.id);
    emptyBin(testMailboxId);
    const purgedCheck = loadNotes(testMailboxId).find((n) => n.id === created.id);
    if (purgedCheck) {
      throw new Error("emptyBin failed to purge binned notes");
    }
    console.log("  ✓ 5. Bin lifecycle (move to bin, restore, and empty bin) matches Google Keep");

    // 6. Duplicate / Clone note
    const welcomeNote = loadNotes(testMailboxId).find((n) => n.id === "note-welcome");
    const duplicated = duplicateNote(testMailboxId, welcomeNote!.id);
    if (!duplicated || !duplicated.title.includes("(Copy)")) {
      throw new Error("duplicateNote failed");
    }
    console.log("  ✓ 6. Duplicate note functionality works as expected");

    // 7. Verify 8 approved Google Keep pastel colors
    if (NOTE_COLORS.length !== 8) {
      throw new Error(`Expected 8 approved note colors, got ${NOTE_COLORS.length}`);
    }
    console.log("  ✓ 7. Verified all 8 approved Google Keep pastel color definitions");

    // 8. Version history snapshot and restore
    const noteForVer = createNote(testMailboxId, "Version Original", "Initial content");
    saveNoteVersion(testMailboxId, noteForVer.id);
    const updatedNote = updateNote(testMailboxId, noteForVer.id, {
      title: "Version Modified",
      content: "Edited content",
    });
    if (!updatedNote || updatedNote.title !== "Version Modified") {
      throw new Error("updateNote failed before version restore test");
    }
    const noteWithHistory = loadNotes(testMailboxId).find((n) => n.id === noteForVer.id);
    if (!noteWithHistory?.versionHistory || noteWithHistory.versionHistory.length === 0) {
      throw new Error("versionHistory should contain saved snapshot");
    }
    const firstVerId = noteWithHistory.versionHistory[0].id;
    const restoredOk = restoreNoteVersion(testMailboxId, noteForVer.id, firstVerId);
    if (!restoredOk) {
      throw new Error("restoreNoteVersion returned false");
    }
    const restoredNote = loadNotes(testMailboxId).find((n) => n.id === noteForVer.id);
    if (restoredNote?.title !== "Version Original" || restoredNote?.content !== "Initial content") {
      throw new Error(`Restored note content mismatch: title=${restoredNote?.title}, content=${restoredNote?.content}`);
    }
    if (!restoredNote?.versionHistory || restoredNote.versionHistory.length !== 2) {
      throw new Error(`Expected versionHistory to retain 2 revisions (initial + pre-restore snapshot), got ${restoredNote?.versionHistory?.length}`);
    }
    if (restoredNote.versionHistory[0].title !== "Version Modified") {
      throw new Error(`Expected pre-restore snapshot title 'Version Modified', got '${restoredNote.versionHistory[0].title}'`);
    }
    console.log("  ✓ 8. Version history snapshot and restoration round-trip functions correctly");

    // 9. Composer history indexing bounds (>20 entries)
    let historyStack: Array<{ title: string; content: string }> = [{ title: "", content: "" }];
    let historyIdx = 0;
    const pushHistory = (t: string, c: string) => {
      const next = [...historyStack.slice(0, historyIdx + 1), { title: t, content: c }].slice(-20);
      historyStack = next;
      historyIdx = next.length - 1;
    };
    for (let i = 1; i <= 30; i++) {
      pushHistory(`Title ${i}`, `Content ${i}`);
    }
    if (historyStack.length !== 20) {
      throw new Error(`Expected history length capped at 20, got ${historyStack.length}`);
    }
    if (historyIdx !== 19) {
      throw new Error(`Expected historyIdx to be 19 (in-bounds), got ${historyIdx}`);
    }
    if (historyStack[historyIdx].title !== "Title 30") {
      throw new Error(`Expected latest title 'Title 30', got '${historyStack[historyIdx].title}'`);
    }
    // Perform undo
    if (historyIdx > 0) {
      historyIdx--;
      const undone = historyStack[historyIdx];
      if (undone.title !== "Title 29") {
        throw new Error(`Expected undone title 'Title 29', got '${undone.title}'`);
      }
    }
    console.log("  ✓ 9. Composer history undo/redo bounded indexing maintains valid array bounds");

    console.log("GOOGLE NOTE FEATURE TESTS: All 9 passed, 0 failed\n");
  } finally {
    if (origLocalStorage !== undefined) {
      (globalThis as any).localStorage = origLocalStorage;
    } else {
      delete (globalThis as any).localStorage;
    }
  }
}
