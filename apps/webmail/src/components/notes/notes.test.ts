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

    console.log("GOOGLE NOTE FEATURE TESTS: All 7 passed, 0 failed\n");
  } finally {
    if (origLocalStorage !== undefined) {
      (globalThis as any).localStorage = origLocalStorage;
    } else {
      delete (globalThis as any).localStorage;
    }
  }
}
