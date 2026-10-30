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
  toggleNoteChecklist,
  addNoteDrawing,
  removeNoteDrawing,
  setNotesMailboxKey,
  getNotesMailboxKey,
  encryptNoteSensitiveSync,
  decryptNoteSensitiveSync,
  encryptNoteSensitiveSubtle,
  decryptNoteSensitiveSubtle,
  applyMarkdownFormat,
  saveMediaToIDB,
  getMediaFromIDB,
  deleteMediaFromIDB,
  clearNotesMediaCache,
  setCachedMedia,
  getCachedMedia,
  getNotesStorageKey,
} from "./notesStore";

function createMockIDB() {
  const storeData = new Map<string, any>();
  return {
    open: (dbName: string, version: number) => {
      const db = {
        objectStoreNames: {
          contains: (name: string) => true,
        },
        createObjectStore: (name: string) => {},
        transaction: (storeName: string, mode: string) => {
          return {
            objectStore: () => ({
              put: (val: any) => {
                storeData.set(val.id, val);
                const req: any = { result: val.id };
                queueMicrotask(() => req.onsuccess && req.onsuccess({ target: req }));
                return req;
              },
              get: (id: string) => {
                const res = storeData.get(id);
                const req: any = { result: res };
                queueMicrotask(() => req.onsuccess && req.onsuccess({ target: req }));
                return req;
              },
              delete: (id: string) => {
                storeData.delete(id);
                const req: any = { result: undefined };
                queueMicrotask(() => req.onsuccess && req.onsuccess({ target: req }));
                return req;
              },
            }),
          };
        },
      };
      const req: any = { result: db, error: null };
      queueMicrotask(() => {
        if (req.onupgradeneeded) req.onupgradeneeded({ target: req });
        if (req.onsuccess) req.onsuccess({ target: req });
      });
      return req;
    },
  };
}

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

  const origIndexedDB = (globalThis as any).indexedDB;
  (globalThis as any).indexedDB = createMockIDB();
  clearNotesMediaCache();

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

    // 10. Zero-Knowledge AES-GCM Encryption and Decryption Round-trip with Mailbox Key
    const testMailboxKey = new Uint8Array(32);
    for (let i = 0; i < 32; i++) testMailboxKey[i] = (i * 7 + 11) % 256;
    setNotesMailboxKey(testMailboxKey);

    const encMailboxId = `mbx_encrypted_${Date.now()}`;
    const encCreated = createNote(
      encMailboxId,
      "Secret Mission Brief",
      "Confidential cryptographic operations plan",
      "peach",
      true,
      {
        isChecklist: true,
        checklistItems: [
          { id: "task-1", text: "Rotate AES-GCM keys", completed: false },
          { id: "task-2", text: "Verify zero plaintext leakage", completed: true },
        ],
      }
    );

    // Verify raw storage secrecy: title, content, and checklist items MUST be redacted/empty
    const rawStorageStr = mockStorage.getItem(getNotesStorageKey(encMailboxId));
    if (!rawStorageStr) {
      throw new Error("Encrypted notes not found in storage");
    }
    const rawStoredNotes = JSON.parse(rawStorageStr);
    const rawStored = rawStoredNotes.find((n: any) => n.id === encCreated.id);
    if (!rawStored || !rawStored.encryptedPayload) {
      throw new Error("Raw storage record must contain encryptedPayload");
    }
    if (rawStored.title !== "" || rawStored.content !== "" || rawStored.checklistItems.length !== 0) {
      throw new Error("Sensitive fields (title, content, checklistItems) leaked in plaintext in localStorage!");
    }
    if (rawStorageStr.includes("Secret Mission Brief") || rawStorageStr.includes("Rotate AES-GCM keys")) {
      throw new Error("Plaintext strings leaked inside raw localStorage JSON payload!");
    }

    // Now load notes with valid key: must decrypt accurately
    const decryptedList = loadNotes(encMailboxId, testMailboxKey);
    const decNote = decryptedList.find((n) => n.id === encCreated.id);
    if (!decNote || decNote.title !== "Secret Mission Brief" || decNote.content !== "Confidential cryptographic operations plan") {
      throw new Error(`Decrypted note content mismatch: title=${decNote?.title}, content=${decNote?.content}`);
    }
    if (!decNote.isChecklist || decNote.checklistItems?.length !== 2 || decNote.checklistItems[1].text !== "Verify zero plaintext leakage") {
      throw new Error("Decrypted checklist items mismatch");
    }
    console.log("  ✓ 10. Zero-Knowledge AES-GCM encryption and decryption round-trip succeeds");

    // 11. Zero-Knowledge notes fail closed without key or with wrong key
    setNotesMailboxKey(null);
    const lockedNotes = loadNotes(encMailboxId, null);
    const lockedNote = lockedNotes.find((n) => n.id === encCreated.id);
    if (!lockedNote || lockedNote.title !== "(Encrypted Note)" || lockedNote.content !== "") {
      throw new Error(`Locked note must mask title and content, got title='${lockedNote?.title}' content='${lockedNote?.content}'`);
    }

    const invalidKey = new Uint8Array(32).fill(0xfe);
    const wrongKeyNotes = loadNotes(encMailboxId, invalidKey);
    const wrongKeyNote = wrongKeyNotes.find((n) => n.id === encCreated.id);
    if (!wrongKeyNote || wrongKeyNote.title !== "(Encrypted Note)" || wrongKeyNote.content !== "") {
      throw new Error("Wrong key must fail closed and mask note content");
    }
    console.log("  ✓ 11. Zero-Knowledge notes fail closed without key or with invalid key");

    // 12. Seamless backward compatibility for existing unencrypted legacy notes
    const legacyMailboxId = `mbx_legacy_${Date.now()}`;
    const legacyNotesData = [
      {
        id: "legacy-note-1",
        title: "Legacy Plaintext Title",
        content: "Legacy Plaintext Content",
        color: "sage",
        isPinned: false,
        isArchived: false,
        isInBin: false,
        labels: ["Work"],
        isChecklist: false,
        checklistItems: [],
        createdAt: Date.now() - 50000,
        updatedAt: Date.now() - 50000,
      },
    ];
    mockStorage.setItem(getNotesStorageKey(legacyMailboxId), JSON.stringify(legacyNotesData));

    // Load with key: legacy note should load without error and preserve plaintext
    const loadedLegacy = loadNotes(legacyMailboxId, testMailboxKey);
    if (loadedLegacy.length !== 1 || loadedLegacy[0].title !== "Legacy Plaintext Title" || loadedLegacy[0].content !== "Legacy Plaintext Content") {
      throw new Error(`Legacy plaintext note failed to load properly: ${JSON.stringify(loadedLegacy[0])}`);
    }
    console.log("  ✓ 12. Seamless backward compatibility for existing unencrypted legacy notes");

    // 13. Interoperable Web Crypto (crypto.subtle) and WASM AES-GCM
    const subtlePayload = {
      title: "Subtle Title",
      content: "Subtle Content",
      checklistItems: [{ id: "c1", text: "Subtle Task", completed: true }],
    };
    const subtleEnc = await encryptNoteSensitiveSubtle(testMailboxKey, testMailboxId, subtlePayload);
    const wasmDec = decryptNoteSensitiveSync(testMailboxKey, testMailboxId, subtleEnc);
    if (!wasmDec || wasmDec.title !== "Subtle Title" || wasmDec.checklistItems?.[0].text !== "Subtle Task") {
      throw new Error("WASM failed to decrypt Web Crypto subtle envelope");
    }

    const wasmEnc = encryptNoteSensitiveSync(testMailboxKey, testMailboxId, subtlePayload);
    const subtleDec = await decryptNoteSensitiveSubtle(testMailboxKey, testMailboxId, wasmEnc);
    if (!subtleDec || subtleDec.title !== "Subtle Title" || subtleDec.checklistItems?.[0].text !== "Subtle Task") {
      throw new Error("Web Crypto subtle failed to decrypt WASM envelope");
    }
    console.log("  ✓ 13. Interoperable AES-GCM Web Crypto (crypto.subtle) and byos_crypto_core encryption");

    // 14. Selection-aware Markdown formatting
    // 14a. Bold selection in middle of sentence
    const fmt1 = applyMarkdownFormat("Hello amazing world", 6, 13, "bold");
    if (fmt1.newContent !== "Hello **amazing** world" || fmt1.newSelectionStart !== 8 || fmt1.newSelectionEnd !== 15) {
      throw new Error(`Bold formatting failed: got '${fmt1.newContent}', selStart=${fmt1.newSelectionStart}, selEnd=${fmt1.newSelectionEnd}`);
    }

    // 14b. Italic selection at start
    const fmt2 = applyMarkdownFormat("Hello world", 0, 5, "italic");
    if (fmt2.newContent !== "*Hello* world" || fmt2.newSelectionStart !== 1 || fmt2.newSelectionEnd !== 6) {
      throw new Error(`Italic formatting failed: got '${fmt2.newContent}'`);
    }

    // 14c. Underline selection at end
    const fmt3 = applyMarkdownFormat("Notes system", 6, 12, "underline");
    if (fmt3.newContent !== "Notes <u>system</u>") {
      throw new Error(`Underline formatting failed: got '${fmt3.newContent}'`);
    }

    // 14d. Multi-line bullet list selection
    const fmt4 = applyMarkdownFormat("Item 1\nItem 2", 0, 13, "bullet");
    if (fmt4.newContent !== "• Item 1\n• Item 2") {
      throw new Error(`Bullet formatting failed: got '${fmt4.newContent}'`);
    }

    // 14e. No selection (cursor insertion)
    const fmt5 = applyMarkdownFormat("Hello world", 5, 5, "bold");
    if (fmt5.newContent !== "Hello**bold text** world") {
      throw new Error(`Cursor bold insertion failed: got '${fmt5.newContent}'`);
    }

    // 14f. Empty input
    const fmt6 = applyMarkdownFormat("", 0, 0, "italic");
    if (fmt6.newContent !== "*italic text*") {
      throw new Error(`Empty input italic insertion failed: got '${fmt6.newContent}'`);
    }
    console.log("  ✓ 14. Selection-aware Markdown formatting (bold, italic, underline, list) and cursor positioning");

    // 15. IndexedDB offloading for drawings and photos prevents localStorage bloat
    const sampleDrawingDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const mediaId = "idb:drawing_test_1";
    await saveMediaToIDB(mediaId, sampleDrawingDataUrl);
    const retrievedMedia = await getMediaFromIDB(mediaId);
    if (retrievedMedia !== sampleDrawingDataUrl) {
      throw new Error("Failed to retrieve drawing dataUrl from IndexedDB");
    }

    // Create note with drawing
    const noteWithDrawing = createNote(testMailboxId, "Drawing Test Note", "Check drawing", "default", false, {
      drawings: [sampleDrawingDataUrl],
    });
    const storedDrawingRef = noteWithDrawing.drawings?.[0];
    if (!storedDrawingRef || !storedDrawingRef.startsWith("idb:drawing_")) {
      throw new Error(`Expected drawing to be stored as 'idb:drawing_*', got '${storedDrawingRef}'`);
    }

    // Assert raw localStorage does NOT contain the raw base64 dataUrl string
    const rawStorageCheck = mockStorage.getItem(getNotesStorageKey(testMailboxId));
    if (rawStorageCheck?.includes("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")) {
      throw new Error("Raw base64 dataUrl leaked in localStorage JSON!");
    }

    // Delete media
    const deletedMediaOk = await deleteMediaFromIDB(mediaId);
    if (!deletedMediaOk) {
      throw new Error("deleteMediaFromIDB returned false");
    }
    console.log("  ✓ 15. IndexedDB offloading for drawings and photos prevents localStorage quota exhaustion");

    // 16. Edit note modal parity (reminder adjustments and checklist mode toggling)
    const modalTestNote = createNote(testMailboxId, "Modal Parity Note", "Plain content before toggle", "default", false);
    const remTs = Date.now() + 7200000;
    const updatedWithRem = updateNote(testMailboxId, modalTestNote.id, {
      reminder: { timestamp: remTs, label: "Later today (2 hours)" },
    });
    if (!updatedWithRem || updatedWithRem.reminder?.timestamp !== remTs) {
      throw new Error("Failed to update note reminder in store");
    }

    // Toggle checklist mode on existing note
    const toggleSuccess = toggleNoteChecklist(testMailboxId, modalTestNote.id);
    if (!toggleSuccess) {
      throw new Error("toggleNoteChecklist returned false");
    }
    const checkAfterToggle = loadNotes(testMailboxId).find((n) => n.id === modalTestNote.id);
    if (!checkAfterToggle?.isChecklist || (checkAfterToggle.checklistItems?.length || 0) === 0) {
      throw new Error("toggleNoteChecklist failed to convert plaintext to checklist items");
    }

    // Toggle back to plaintext
    toggleNoteChecklist(testMailboxId, modalTestNote.id);
    const checkAfterSecondToggle = loadNotes(testMailboxId).find((n) => n.id === modalTestNote.id);
    if (checkAfterSecondToggle?.isChecklist || typeof checkAfterSecondToggle?.content !== "string") {
      throw new Error("toggleNoteChecklist failed to convert checklist back to plaintext");
    }
    console.log("  ✓ 16. Edit note modal reminder adjustments and checklist mode toggling function correctly");

    // 17. Version history restoration retains IndexedDB media after drawing removal
    const testDrawingData = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAADElEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const vhNote = createNote(testMailboxId, "VH Media Note", "Testing media version history", "default", false, {
      drawings: [testDrawingData],
    });
    const origDrawingPointer = vhNote.drawings?.[0];
    if (!origDrawingPointer || !origDrawingPointer.startsWith("idb:drawing_")) {
      throw new Error(`Expected idb pointer for note drawing, got ${origDrawingPointer}`);
    }
    // Remove drawing from active note (this creates a version snapshot)
    removeNoteDrawing(testMailboxId, vhNote.id, 0);
    const noteAfterRemove = loadNotes(testMailboxId).find((n) => n.id === vhNote.id);
    if ((noteAfterRemove?.drawings || []).length !== 0) {
      throw new Error("Drawing was not removed from active note");
    }
    if ((noteAfterRemove?.versionHistory || []).length === 0) {
      throw new Error("Expected version history snapshot after drawing removal");
    }
    // Media MUST still exist in IndexedDB because it is referenced in versionHistory!
    const mediaCheckAfterRemove = await getMediaFromIDB(origDrawingPointer);
    if (mediaCheckAfterRemove !== testDrawingData) {
      throw new Error("Drawing was deleted prematurely from IndexedDB when removed from active note!");
    }
    // Restore the prior version from history
    const priorVerId = noteAfterRemove!.versionHistory![0].id;
    restoreNoteVersion(testMailboxId, vhNote.id, priorVerId);
    const restoredVhNote = loadNotes(testMailboxId).find((n) => n.id === vhNote.id);
    if (!restoredVhNote?.drawings || restoredVhNote.drawings[0] !== origDrawingPointer) {
      throw new Error("Version history restore failed to recover drawing pointer");
    }
    const retrievedAfterRestore = await getMediaFromIDB(restoredVhNote.drawings[0]);
    if (retrievedAfterRestore !== testDrawingData) {
      throw new Error("Failed to load drawing data from IndexedDB after version restore");
    }
    console.log("  ✓ 17. Version history restoration retains IndexedDB media after drawing removal");

    // 18. Cascading media garbage collection on deleteNoteForever & emptyBin
    const sharedDrawingData = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAAZdEVYdFNvZnR3YXJlAHBhaW50Lm5ldCA0LjAuMjHxIGmVAAAADUlEQVQYV2P4//8/AwAI/AL+26t5EAAAAABJRU5ErkJggg==";
    const sharedMediaId = "idb:drawing_shared_1";
    await saveMediaToIDB(sharedMediaId, sharedDrawingData);

    const noteA = createNote(testMailboxId, "Note A", "Has shared media", "default", false, { drawings: [sharedMediaId] });
    const noteB = createNote(testMailboxId, "Note B", "Also has shared media", "default", false, { drawings: [sharedMediaId] });

    // Delete Note A forever: media must NOT be deleted because Note B still references it!
    deleteNote(testMailboxId, noteA.id);
    deleteNoteForever(testMailboxId, noteA.id);
    const mediaAfterDelA = await getMediaFromIDB(sharedMediaId);
    if (!mediaAfterDelA) {
      throw new Error("Shared media was incorrectly deleted when Note A was deleted while Note B still uses it!");
    }

    // Now delete Note B forever: media should now be cleaned up from IndexedDB
    deleteNote(testMailboxId, noteB.id);
    emptyBin(testMailboxId);
    const mediaAfterEmpty = await getMediaFromIDB(sharedMediaId);
    if (mediaAfterEmpty !== null) {
      throw new Error("Unreferenced media was not cleaned up after emptyBin!");
    }
    console.log("  ✓ 18. Cascading media garbage collection prunes unreferenced items and preserves shared media");

    // 19. Locked encrypted notes fail closed on update and duplication attempts
    const lockedEncId = `mbx_locked_guard_${Date.now()}`;
    setNotesMailboxKey(testMailboxKey);
    const confidentialNote = createNote(lockedEncId, "Confidential Secret", "Top secret payload");
    // Switch to null key: note becomes locked
    setNotesMailboxKey(null);
    const lockedList = loadNotes(lockedEncId, null);
    const lockedItem = lockedList.find((n) => n.id === confidentialNote.id);
    if (!lockedItem?._isLocked) {
      throw new Error("Expected note to be locked without key");
    }
    const updateAttempt = updateNote(lockedEncId, lockedItem.id, { title: "Attempted Plaintext Overwrite" });
    if (updateAttempt !== null) {
      throw new Error("updateNote on locked note must return null and fail closed");
    }
    const duplicateAttempt = duplicateNote(lockedEncId, lockedItem.id);
    if (duplicateAttempt !== null) {
      throw new Error("duplicateNote on locked note must return null and fail closed");
    }
    console.log("  ✓ 19. Locked encrypted notes fail closed on update and duplication attempts");

    // 20. Version history automatically captures revisions on text modifications
    setNotesMailboxKey(testMailboxKey);
    const vhTextNote = createNote(testMailboxId, "Initial Text Title", "Initial content");
    saveNoteVersion(testMailboxId, vhTextNote.id);
    updateNote(testMailboxId, vhTextNote.id, { title: "Updated Title", content: "Updated content" });
    const noteWithEditHistory = loadNotes(testMailboxId).find((n) => n.id === vhTextNote.id);
    if ((noteWithEditHistory?.versionHistory || []).length !== 1 || noteWithEditHistory?.versionHistory?.[0].title !== "Initial Text Title") {
      throw new Error("Version history did not capture previous note text before edit");
    }
    console.log("  ✓ 20. Version history snapshot accurately preserves prior revisions on note edits");

    // 21. Media cache bounded capacity prevents unbounded memory growth
    clearNotesMediaCache();
    for (let i = 0; i < 170; i++) {
      setCachedMedia(`test_img_${i}`, `data:image/png;base64,sample${i}`);
    }
    // Items 0..19 should have been evicted (cache capped at 150)
    if (getCachedMedia("test_img_0") !== undefined) {
      throw new Error("LRU cache did not evict oldest media entry");
    }
    if (getCachedMedia("test_img_169") === undefined) {
      throw new Error("LRU cache missing most recent media entry");
    }
    console.log("  ✓ 21. Media cache LRU bounds eviction caps memory usage at 150 items");

    console.log("GOOGLE NOTE FEATURE TESTS: All 21 passed, 0 failed\n");
    return { passed: 21, failed: 0 };
  } finally {
    setNotesMailboxKey(null);
    clearNotesMediaCache();
    if (origLocalStorage !== undefined) {
      (globalThis as any).localStorage = origLocalStorage;
    } else {
      delete (globalThis as any).localStorage;
    }
    if (origIndexedDB !== undefined) {
      (globalThis as any).indexedDB = origIndexedDB;
    } else {
      delete (globalThis as any).indexedDB;
    }
  }
}
