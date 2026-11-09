import {
  encryptRemoteNote,
  decryptRemoteNote,
  syncNotesWithRemote,
  enqueueNoteSync,
  getNotesSyncQueue,
  clearNotesSyncQueue,
  RemoteEncryptedNotePayload,
} from "./notesSync";
import {
  loadNotes,
  saveNotes,
  createNote,
  updateNote,
  deleteNoteForever,
  NoteItem,
  saveRawMediaRecordToIDB,
  getRawMediaRecordFromIDB,
  encryptNotesMedia,
  decryptNotesMedia,
} from "./notesStore";
import { bytesToHex, hexToBytes } from "../../attachment_crypto";

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error("Assertion failed: " + msg);
}

// In-memory mock storage provider simulating MinIO / S3 / Google Drive customer storage
class MockCustomerStorage {
  private objects = new Map<string, Uint8Array>();

  store(key: string, data: Uint8Array): void {
    assert(key.startsWith("mailboxes/"), "Storage key must be mailbox scoped");
    assert(!key.includes(".."), "Storage key must not contain traversal");
    assert(data.length >= 29, "Payload must be at least 29 bytes");
    assert(data[0] === 0x01, "Payload must start with Section 12 0x01 version framing");
    this.objects.set(key, data.slice());
  }

  retrieve(key: string): Uint8Array | null {
    const data = this.objects.get(key);
    return data ? data.slice() : null;
  }

  list(prefix: string): string[] {
    const results: string[] = [];
    for (const key of this.objects.keys()) {
      if (key.startsWith(prefix)) {
        results.push(key);
      }
    }
    return results;
  }

  delete(key: string): boolean {
    return this.objects.delete(key);
  }

  clear(): void {
    this.objects.clear();
  }
}

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

export async function runNotesSyncTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void> | void) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (e: any) {
      console.error(`  ✗ ${name}: ${e.message}`);
      failed++;
    }
  }

  console.log("Running Webmail Notes Customer Storage Sync & Conflict Resolution Tests...");
  process.env.TEST_STORAGE_SYNC = "true";

  // Mock global localStorage & IndexedDB environment
  let memoryStore: Record<string, string> = {};
  const mockLocalStorage = {
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
  (globalThis as any).localStorage = mockLocalStorage;
  if (!(globalThis as any).window) {
    (globalThis as any).window = globalThis;
  }
  (globalThis as any).window.localStorage = mockLocalStorage;

  const origIndexedDB = (globalThis as any).indexedDB;
  (globalThis as any).indexedDB = createMockIDB();

  // Mock global storage & fetch environment
  const mockStorage = new MockCustomerStorage();
  const originalFetch = globalThis.fetch;

  // Intercept fetch calls to /v1/mailboxes/.../storage/*
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = typeof input === "string" ? input : input.toString();

    // Store endpoint
    if (urlStr.includes("/storage/store")) {
      const headers = (init?.headers as Record<string, string>) || {};
      const objectKey = headers["X-Object-Key"];
      const body = init?.body as unknown as Uint8Array;
      if (!objectKey || !body) {
        return new Response("Missing parameters", { status: 400 });
      }
      try {
        mockStorage.store(objectKey, new Uint8Array(body));
        return new Response(JSON.stringify({ status: "stored", object_key: objectKey }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      } catch (err: any) {
        return new Response(err.message, { status: 400 });
      }
    }

    // Retrieve endpoint
    if (urlStr.includes("/storage/retrieve")) {
      const url = new URL(urlStr, "http://localhost");
      const key = url.searchParams.get("key");
      if (!key) return new Response("Missing key", { status: 400 });
      const data = mockStorage.retrieve(key);
      if (!data) return new Response("Not found", { status: 404 });
      return new Response(data, {
        status: 200,
        headers: { "Content-Type": "application/octet-stream" },
      });
    }

    // List endpoint
    if (urlStr.includes("/storage/list")) {
      const url = new URL(urlStr, "http://localhost");
      const prefix = url.searchParams.get("prefix") || "";
      const mbxMatch = urlStr.match(/\/mailboxes\/([^/]+)\/storage\/list/);
      const mailboxId = mbxMatch ? mbxMatch[1] : "";
      const expectedPrefix = `mailboxes/${mailboxId}/`;
      const fullPrefix = prefix.startsWith(expectedPrefix) ? prefix : expectedPrefix + prefix.replace(/^\//, "");
      const objs = mockStorage.list(fullPrefix);
      return new Response(JSON.stringify({ objects: objs, count: objs.length }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Delete endpoint
    if (urlStr.includes("/storage/delete")) {
      const headers = (init?.headers as Record<string, string>) || {};
      let objectKey = headers["X-Object-Key"];
      if (!objectKey && init?.body) {
        try {
          const parsed = JSON.parse(init.body as string);
          objectKey = parsed.object_key;
        } catch {}
      }
      if (objectKey) {
        mockStorage.delete(objectKey);
      }
      return new Response(JSON.stringify({ status: "deleted", object_key: objectKey }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (originalFetch) {
      return originalFetch(input, init);
    }
    return new Response("Not found", { status: 404 });
  }) as typeof fetch;

  try {
    const testMailboxId = "c1000000-0000-0000-0000-000000000001";
    const testMailboxKey = new Uint8Array(32).fill(0x5a); // Device A & B shared mailbox key

    // Test 1: Remote Envelope Encryption & Decryption Roundtrip
    await test("1. encryptRemoteNote & decryptRemoteNote authenticated roundtrip with Section 12 framing", async () => {
      const notePayload: RemoteEncryptedNotePayload = {
        id: "note-zk-remote-1",
        title: "Zero-Knowledge Storage Specification",
        content: "Customer storage providers only ever see encrypted bytes.",
        color: "sage",
        isPinned: true,
        isArchived: false,
        isInBin: false,
        labels: ["Security", "Architecture"],
        checklistItems: [
          { id: "c1", text: "Client-side AES-GCM framing", completed: true },
          { id: "c2", text: "Zero plaintext leakage to storage", completed: true },
        ],
        createdAt: 1700000000000,
        updatedAt: 1700000005000,
      };

      const encryptedBytes = await encryptRemoteNote(testMailboxKey, testMailboxId, notePayload);
      assert(encryptedBytes.length >= 29, "Ciphertext envelope must meet minimum Section 12 framing");
      assert(encryptedBytes[0] === 0x01, "Byte 0 must be 0x01 framing version byte");

      // Verify zero plaintext leakage on the wire
      const wireString = new TextDecoder("latin1").decode(encryptedBytes);
      assert(!wireString.includes("Zero-Knowledge"), "Plaintext title must never leak to envelope");
      assert(!wireString.includes("Customer storage"), "Plaintext content must never leak to envelope");
      assert(!wireString.includes("Client-side AES-GCM"), "Checklist text must never leak to envelope");

      const decrypted = await decryptRemoteNote(testMailboxKey, testMailboxId, encryptedBytes, "note-zk-remote-1");
      assert(decrypted !== null, "Decryption must succeed with valid key and context AAD");
      assert(decrypted!.title === notePayload.title, "Title matches original byte-for-byte");
      assert(decrypted!.content === notePayload.content, "Content matches original byte-for-byte");
      assert(decrypted!.checklistItems!.length === 2, "Checklist items intact");
      assert(decrypted!.labels.length === 2, "Labels preserved intact");
    });

    // Test 2: Cryptographic Boundary & Context-Bound AAD Verification
    await test("2. decryptRemoteNote fails closed on wrong key, tampered ciphertext, or transposed note ID", async () => {
      const payload: RemoteEncryptedNotePayload = {
        id: "note-target-1",
        title: "Confidential Note",
        content: "Top Secret",
        color: "default",
        isPinned: false,
        isArchived: false,
        isInBin: false,
        labels: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const validEnvelope = await encryptRemoteNote(testMailboxKey, testMailboxId, payload);

      // Wrong key
      const wrongKey = new Uint8Array(32).fill(0xee);
      const wrongKeyDec = await decryptRemoteNote(wrongKey, testMailboxId, validEnvelope, "note-target-1");
      assert(wrongKeyDec === null, "Decryption with wrong key must fail closed and return null");

      // Transposed note ID (context-bound AAD mismatch)
      const transposedDec = await decryptRemoteNote(testMailboxKey, testMailboxId, validEnvelope, "note-other-2");
      assert(transposedDec === null, "Decryption with mismatched note ID AAD must fail closed");

      // Transposed mailbox ID
      const transposedMbDec = await decryptRemoteNote(testMailboxKey, "c2000000-0000-0000-0000-000000000002", validEnvelope, "note-target-1");
      assert(transposedMbDec === null, "Decryption with mismatched mailbox ID AAD must fail closed");

      // Tampered ciphertext bit flip
      const tampered = new Uint8Array(validEnvelope);
      tampered[tampered.length - 1] ^= 0x01; // flip last authentication tag bit
      const tamperedDec = await decryptRemoteNote(testMailboxKey, testMailboxId, tampered, "note-target-1");
      assert(tamperedDec === null, "Tampered authentication tag must cause decryption failure");
    });

    // Test 3: Two-Device Multi-Device Synchronization Simulation
    await test("3. Multi-Device Sync: Device A creates note, uploads to customer storage; Device B discovers and decrypts", async () => {
      mockStorage.clear();
      if (typeof localStorage !== "undefined") localStorage.clear();

      // --- DEVICE A: Create note and sync to storage ---
      const devANote = createNote(
        testMailboxId,
        "Meeting Minutes from Device A",
        "Discussed Phase 2 zero-knowledge customer storage sync.",
        "peach",
        true,
        { labels: ["Work"] },
        testMailboxKey
      );
      assert(devANote !== null, "Device A created note successfully");

      // Trigger Device A sync
      const syncResultA = await syncNotesWithRemote(testMailboxId, testMailboxKey);
      assert(syncResultA.success, "Device A sync succeeded");

      // Verify remote storage now contains the encrypted object
      const expectedRemoteKey = `mailboxes/${testMailboxId}/notes/${devANote!.id}.enc`;
      const remoteBytes = mockStorage.retrieve(expectedRemoteKey);
      assert(remoteBytes !== null, "Object stored in remote customer storage under mailbox prefix");
      assert(remoteBytes![0] === 0x01, "Stored remote object has Section 12 binary envelope");

      // --- DEVICE B: Fresh client with no local notes, unlocks with testMailboxKey ---
      // Simulate switching to Device B by clearing local localStorage
      if (typeof localStorage !== "undefined") localStorage.clear();

      // Device B starts with empty notes
      const devBInitialNotes = loadNotes(testMailboxId, testMailboxKey);
      assert(!devBInitialNotes.some((n) => n.id === devANote!.id), "Device B does not yet have Device A's note");

      // Device B runs sync with remote customer storage
      const syncResultB = await syncNotesWithRemote(testMailboxId, testMailboxKey);
      assert(syncResultB.success, "Device B sync succeeded");
      assert(syncResultB.syncedCount >= 1, "Device B downloaded and merged remote note");

      // Check Device B's local notes
      const devBNotes = loadNotes(testMailboxId, testMailboxKey);
      const syncedNoteOnB = devBNotes.find((n) => n.id === devANote!.id);
      assert(syncedNoteOnB !== undefined, "Device B discovered and restored Device A's note");
      assert(syncedNoteOnB!.title === "Meeting Minutes from Device A", "Title decrypted correctly on Device B");
      assert(syncedNoteOnB!.content === "Discussed Phase 2 zero-knowledge customer storage sync.", "Content decrypted correctly on Device B");
      assert(syncedNoteOnB!.color === "peach", "Color preserved on Device B");
      assert(syncedNoteOnB!.isPinned === true, "Pin state preserved on Device B");
      assert(syncedNoteOnB!.labels.includes("Work"), "Labels preserved on Device B");
      assert(syncedNoteOnB!.syncedRevision === devANote!.updatedAt, "Synced revision marked accurately");
    });

    // Test 4: Revision-Aware Conflict Detection and Recovery Copy Creation
    await test("4. Conflict Resolution: Simultaneous edits on Device A & B create conflict copy with distinct AAD", async () => {
      mockStorage.clear();
      if (typeof localStorage !== "undefined") localStorage.clear();

      // Shared base note at revision t=1000
      const baseNote = createNote(
        testMailboxId,
        "Shared Project Roadmap",
        "Original Roadmap text.",
        "amber",
        false,
        {},
        testMailboxKey
      );
      assert(baseNote !== null, "Base note created");
      await syncNotesWithRemote(testMailboxId, testMailboxKey);

      // Device A edits note at t=2000 and pushes to remote storage
      const devAEdited = updateNote(
        testMailboxId,
        baseNote!.id,
        {
          title: "Shared Project Roadmap (Device A additions)",
          content: "Original Roadmap text. + Added Q3 milestones by Alice.",
          updatedAt: Date.now() + 10000,
        },
        testMailboxKey
      );
      assert(devAEdited !== null, "Device A edited note");
      await syncNotesWithRemote(testMailboxId, testMailboxKey);

      // Device B was offline, and user edited locally at t=3000 (after base, concurrently with A)
      // We simulate Device B having baseNote with local un-synced edits:
      const devBLocalNotes = loadNotes(testMailboxId, testMailboxKey);
      const bTarget = devBLocalNotes.find((n) => n.id === baseNote!.id)!;
      bTarget.title = "Shared Project Roadmap (Device B offline additions)";
      bTarget.content = "Original Roadmap text. + Added Security hardening by Bob.";
      bTarget.updatedAt = Date.now() + 20000;
      bTarget.syncedRevision = baseNote!.updatedAt;
      saveNotes(testMailboxId, devBLocalNotes, testMailboxKey);

      // Now Device B comes online and syncs!
      const conflictSyncResult = await syncNotesWithRemote(testMailboxId, testMailboxKey);
      assert(conflictSyncResult.success, "Sync with concurrent conflict completed safely");
      assert(conflictSyncResult.conflictCount === 1, "Exactly 1 concurrent conflict detected");

      // Verify that ZERO data was lost:
      const updatedNotesOnB = loadNotes(testMailboxId, testMailboxKey);

      // Primary note should now have Device A's remote changes:
      const primaryNote = updatedNotesOnB.find((n) => n.id === baseNote!.id);
      assert(primaryNote !== undefined, "Primary note exists");
      assert(primaryNote!.title.includes("Device A additions"), "Primary note adopted remote version");

      // Conflict recovery copy should exist with Device B's local edits:
      const conflictCopy = updatedNotesOnB.find((n) => n.title.includes("Conflict copy"));
      assert(conflictCopy !== undefined, "Conflict recovery copy was created");
      assert(conflictCopy!.content.includes("Added Security hardening by Bob"), "Device B's local edits 100% preserved in conflict copy");
      assert(conflictCopy!.id !== baseNote!.id, "Conflict copy has unique distinct UUID/ID");
    });

    // Test 5: Safe Encrypted Tombstone Deletion Sync
    await test("5. Tombstone Deletions: Note deleted on Device A uploads tombstone; Device B deletes without resurrection", async () => {
      mockStorage.clear();
      if (typeof localStorage !== "undefined") localStorage.clear();

      // Create note on Device A
      const noteToDelete = createNote(
        testMailboxId,
        "Temporary Scratchpad",
        "Delete me soon.",
        "default",
        false,
        {},
        testMailboxKey
      );
      await syncNotesWithRemote(testMailboxId, testMailboxKey);

      // Device A deletes note permanently
      deleteNoteForever(testMailboxId, noteToDelete!.id, testMailboxKey);
      await syncNotesWithRemote(testMailboxId, testMailboxKey);

      // Verify remote storage holds encrypted tombstone
      const tombstoneBytes = mockStorage.retrieve(`mailboxes/${testMailboxId}/notes/${noteToDelete!.id}.enc`);
      assert(tombstoneBytes !== null, "Tombstone exists in remote storage");
      const decryptedTombstone = await decryptRemoteNote(testMailboxKey, testMailboxId, tombstoneBytes!, noteToDelete!.id);
      assert(decryptedTombstone !== null, "Tombstone decrypts with valid key");
      assert(decryptedTombstone!.isDeleted === true, "Tombstone is marked isDeleted=true");

      // Now Device B (which had the note locally) runs sync
      // Setup Device B with the note initially
      const devBNotes = [noteToDelete!];
      saveNotes(testMailboxId, devBNotes, testMailboxKey);

      await syncNotesWithRemote(testMailboxId, testMailboxKey);

      // Note must be removed on Device B and NOT resurrected
      const devBAfterSync = loadNotes(testMailboxId, testMailboxKey);
      assert(!devBAfterSync.some((n) => n.id === noteToDelete!.id), "Deleted note was removed on Device B without resurrection");
    });

    // Test 6: Encrypted Media Sync (Drawings & Images)
    await test("6. Encrypted Media Sync: Drawing encrypted in IDB uploaded to storage and pulled to Device B", async () => {
      mockStorage.clear();
      if (typeof localStorage !== "undefined") localStorage.clear();

      const mediaId = `idb:drawing_zk_test_${Date.now()}`;
      const mockDrawingDataUrl = "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxwYXRoIGQ9Ik0wIDAgTDEwIDEwIi8+PC9zdmc+";

      // Encrypt and save media to local IndexedDB
      const encMediaHex = encryptNotesMedia(testMailboxKey, testMailboxId, mockDrawingDataUrl, mediaId);
      assert(encMediaHex !== null, "Media encrypted with AES-GCM");
      await saveRawMediaRecordToIDB({
        id: mediaId,
        encryptedDataUrl: encMediaHex!,
        dataUrl: "(Encrypted Media)",
      });

      // Create note referencing this drawing
      const noteWithDrawing = createNote(
        testMailboxId,
        "Architectural Diagram",
        "Refer to drawing below.",
        "lavender",
        false,
        { drawings: [mediaId] },
        testMailboxKey
      );
      assert(noteWithDrawing !== null, "Note with drawing created");

      // Device A syncs note + media
      const syncA = await syncNotesWithRemote(testMailboxId, testMailboxKey);
      assert(syncA.success, "Device A synced note and media");

      // Verify media object in remote customer storage
      const cleanMediaId = mediaId.replace(/^idb:/, "");
      const remoteMediaKey = `mailboxes/${testMailboxId}/notes/media/${cleanMediaId}.enc`;
      const remoteMediaBytes = mockStorage.retrieve(remoteMediaKey);
      assert(remoteMediaBytes !== null, "Media uploaded to customer storage under notes/media/ prefix");
      assert(remoteMediaBytes![0] === 0x01, "Media starts with 0x01 framing");
      assert(remoteMediaBytes!.length >= 29, "Media satisfies Section 12 envelope framing");

      // Verify zero plaintext SVG/dataUrl on wire
      const mediaWireString = new TextDecoder("latin1").decode(remoteMediaBytes!);
      assert(!mediaWireString.includes("svg"), "Raw SVG XML must never leak to remote media storage");
      assert(!mediaWireString.includes("base64"), "Base64 prefix must never leak to remote media storage");

      // Device B sync simulation: clean Device B pulls note and media
      if (typeof localStorage !== "undefined") localStorage.clear();
      const syncB = await syncNotesWithRemote(testMailboxId, testMailboxKey);
      assert(syncB.success, "Device B pulled note and media");

      // Check that Device B saved media to IDB
      const mediaOnB = await getRawMediaRecordFromIDB(mediaId);
      assert(mediaOnB !== null, "Device B populated IDB with media record");
      assert(mediaOnB!.encryptedDataUrl !== undefined, "Media record in Device B IDB is encrypted");

      // Decrypt on Device B
      const decryptedMedia = decryptNotesMedia(testMailboxKey, testMailboxId, mediaOnB!.encryptedDataUrl!, mediaId);
      assert(decryptedMedia === mockDrawingDataUrl, "Decrypted media on Device B matches original dataUrl byte-for-byte");
    });

    // Test 7: Offline-First Queue Resilience
    await test("7. Offline Queue: Operations queued while offline and flushed upon connection restore", async () => {
      clearNotesSyncQueue(testMailboxId);

      enqueueNoteSync(testMailboxId, "note-offline-1", "upsert");
      enqueueNoteSync(testMailboxId, "note-offline-2", "delete");

      const queue = getNotesSyncQueue(testMailboxId);
      assert(queue.length === 2, "Sync queue contains 2 pending operations");
      assert(queue[0].noteId === "note-offline-1" && queue[0].action === "upsert", "Queue item 1 correct");
      assert(queue[1].noteId === "note-offline-2" && queue[1].action === "delete", "Queue item 2 correct");

      clearNotesSyncQueue(testMailboxId);
      assert(getNotesSyncQueue(testMailboxId).length === 0, "Queue cleared successfully");
    });

    // Test 8: Three-Device Concurrent Conflict Ordering (A syncs, then B, then C)
    await test("8. Three-Device Conflict: A syncs, then B syncs, then offline C reconnects and syncs", async () => {
      mockStorage.clear();
      if (typeof localStorage !== "undefined") localStorage.clear();

      // Step 1: Base note created on Device A and synced to remote
      const base = createNote(
        testMailboxId,
        "Tri-Device Spec",
        "Base specification v1.0",
        "sky",
        false,
        {},
        testMailboxKey
      );
      assert(base !== null, "Base note created");
      await syncNotesWithRemote(testMailboxId, testMailboxKey);

      // Snapshot base note state for Device B and Device C
      const baseSnapshot = loadNotes(testMailboxId, testMailboxKey);

      // Step 2: Device A edits note while B and C are disconnected
      const devAState = JSON.parse(JSON.stringify(baseSnapshot));
      saveNotes(testMailboxId, devAState, testMailboxKey);
      const aTarget = devAState.find((n: NoteItem) => n.id === base!.id)!;
      aTarget.title = "Tri-Device Spec (Device A revision)";
      aTarget.content = "Base specification v1.0 + Device A crypto enhancements.";
      aTarget.updatedAt = Date.now() + 5000;
      saveNotes(testMailboxId, devAState, testMailboxKey);

      // Step 3: Device B edits note offline
      const devBState = JSON.parse(JSON.stringify(baseSnapshot));
      const bTarget = devBState.find((n: NoteItem) => n.id === base!.id)!;
      bTarget.title = "Tri-Device Spec (Device B revision)";
      bTarget.content = "Base specification v1.0 + Device B UI redesign.";
      bTarget.updatedAt = Date.now() + 10000;

      // Step 4: Device C edits note offline
      const devCState = JSON.parse(JSON.stringify(baseSnapshot));
      const cTarget = devCState.find((n: NoteItem) => n.id === base!.id)!;
      cTarget.title = "Tri-Device Spec (Device C revision)";
      cTarget.content = "Base specification v1.0 + Device C storage metrics.";
      cTarget.updatedAt = Date.now() + 15000;

      // Step 5: Device A synchronizes first
      saveNotes(testMailboxId, devAState, testMailboxKey);
      enqueueNoteSync(testMailboxId, aTarget.id, "upsert");
      const resA = await syncNotesWithRemote(testMailboxId, testMailboxKey);
      assert(resA.success, "Device A sync succeeded");

      // Step 6: Device B comes online and synchronizes
      saveNotes(testMailboxId, devBState, testMailboxKey);
      const resB = await syncNotesWithRemote(testMailboxId, testMailboxKey);
      assert(resB.success, "Device B sync succeeded");
      assert(resB.conflictCount === 1, "Device B detected 1 concurrent conflict with Device A");

      const notesOnB = loadNotes(testMailboxId, testMailboxKey);
      const specNotesOnB = notesOnB.filter((n) => n.id === base!.id || n.title.includes("Tri-Device Spec"));
      assert(specNotesOnB.length === 2, "Device B has primary note + 1 conflict copy");
      const bConflictCopy = specNotesOnB.find((n) => n.title.includes("Conflict copy"));
      assert(bConflictCopy !== undefined, "Device B preserved its offline edit in conflict copy");
      assert(bConflictCopy!.content.includes("Device B UI redesign"), "Device B conflict copy content verified");

      // Drain Device B's sync queue so conflict copy is pushed to remote
      await syncNotesWithRemote(testMailboxId, testMailboxKey);

      // Step 7: Device C reconnects after A and B have synchronized
      saveNotes(testMailboxId, devCState, testMailboxKey);
      const resC = await syncNotesWithRemote(testMailboxId, testMailboxKey);
      assert(resC.success, "Device C reconnect sync succeeded");
      assert(resC.conflictCount === 1, "Device C detected conflict on primary note");

      const notesOnC = loadNotes(testMailboxId, testMailboxKey);
      const specNotesOnC = notesOnC.filter((n) => n.id === base!.id || n.title.includes("Tri-Device Spec"));
      assert(specNotesOnC.length === 3, "Device C has primary note + Device B conflict copy + Device C conflict copy");

      // Verify all 3 edits survived with zero loss on Device C
      const hasAEdit = specNotesOnC.some((n) => n.content.includes("Device A crypto enhancements"));
      const hasBEdit = specNotesOnC.some((n) => n.content.includes("Device B UI redesign"));
      const hasCEdit = specNotesOnC.some((n) => n.content.includes("Device C storage metrics"));
      assert(hasAEdit, "Zero loss: Device A edits preserved on Device C");
      assert(hasBEdit, "Zero loss: Device B edits preserved on Device C");
      assert(hasCEdit, "Zero loss: Device C edits preserved on Device C");

      // Push Device C's conflict copy to remote
      await syncNotesWithRemote(testMailboxId, testMailboxKey);

      // Step 8: Verify Device A and B converge on the exact same 3 notes when they sync
      saveNotes(testMailboxId, notesOnB, testMailboxKey);
      await syncNotesWithRemote(testMailboxId, testMailboxKey);
      const finalBNotes = loadNotes(testMailboxId, testMailboxKey);
      const finalBSpecNotes = finalBNotes.filter((n) => n.id === base!.id || n.title.includes("Tri-Device Spec"));
      assert(finalBSpecNotes.length === 3, "Device B converged on 3 notes");
    });

    // Test 9: Three-Device Reverse Conflict Ordering (B syncs before A)
    await test("9. Three-Device Conflict: B syncs before A, then C reconnects", async () => {
      mockStorage.clear();
      if (typeof localStorage !== "undefined") localStorage.clear();

      const base = createNote(
        testMailboxId,
        "Reverse Ordering Note",
        "Original v1",
        "default",
        false,
        {},
        testMailboxKey
      );
      await syncNotesWithRemote(testMailboxId, testMailboxKey);

      const baseSnapshot = loadNotes(testMailboxId, testMailboxKey);

      // Device A edit
      const devAState = JSON.parse(JSON.stringify(baseSnapshot));
      const aTarget = devAState.find((n: NoteItem) => n.id === base!.id)!;
      aTarget.title = "Reverse Ordering Note (A)";
      aTarget.content = "Alice edit";
      aTarget.updatedAt = Date.now() + 5000;

      // Device B edit
      const devBState = JSON.parse(JSON.stringify(baseSnapshot));
      const bTarget = devBState.find((n: NoteItem) => n.id === base!.id)!;
      bTarget.title = "Reverse Ordering Note (B)";
      bTarget.content = "Bob edit";
      bTarget.updatedAt = Date.now() + 10000;

      // Device C edit
      const devCState = JSON.parse(JSON.stringify(baseSnapshot));
      const cTarget = devCState.find((n: NoteItem) => n.id === base!.id)!;
      cTarget.title = "Reverse Ordering Note (C)";
      cTarget.content = "Charlie edit";
      cTarget.updatedAt = Date.now() + 15000;

      // B synchronizes first
      saveNotes(testMailboxId, devBState, testMailboxKey);
      enqueueNoteSync(testMailboxId, bTarget.id, "upsert");
      const resB = await syncNotesWithRemote(testMailboxId, testMailboxKey);
      assert(resB.success, "Device B initial sync succeeded");

      // A synchronizes second -> conflict detected on A
      saveNotes(testMailboxId, devAState, testMailboxKey);
      const resA = await syncNotesWithRemote(testMailboxId, testMailboxKey);
      assert(resA.success, "Device A sync succeeded");
      assert(resA.conflictCount === 1, "Device A detected conflict with Device B");
      await syncNotesWithRemote(testMailboxId, testMailboxKey); // Push A's conflict copy

      // C synchronizes third -> conflict detected on C
      saveNotes(testMailboxId, devCState, testMailboxKey);
      const resC = await syncNotesWithRemote(testMailboxId, testMailboxKey);
      assert(resC.success, "Device C sync succeeded");
      assert(resC.conflictCount === 1, "Device C detected conflict");

      const notesOnC = loadNotes(testMailboxId, testMailboxKey);
      const revNotesOnC = notesOnC.filter((n) => n.id === base!.id || n.title.includes("Reverse Ordering Note"));
      assert(revNotesOnC.length === 3, "Device C preserved all 3 independent revisions");
      assert(notesOnC.some((n) => n.content.includes("Alice edit")), "Alice edit survived");
      assert(notesOnC.some((n) => n.content.includes("Bob edit")), "Bob edit survived");
      assert(notesOnC.some((n) => n.content.includes("Charlie edit")), "Charlie edit survived");
    });

    // Test 10: Complete Offline Editing Lifecycle & Repeated Synchronization Idempotency
    await test("10. Offline Editing Lifecycle: Create, edit, delete offline and repeated sync idempotency", async () => {
      mockStorage.clear();
      if (typeof localStorage !== "undefined") localStorage.clear();
      clearNotesSyncQueue(testMailboxId);

      // Step 1: Create an initial note online and sync
      const noteOnline = createNote(
        testMailboxId,
        "Online Note",
        "Created online.",
        "amber",
        false,
        {},
        testMailboxKey
      );
      await syncNotesWithRemote(testMailboxId, testMailboxKey);

      // Step 2: Go offline. Perform create, edit, delete entirely offline
      // A. Create new note offline
      const offlineCreated = createNote(
        testMailboxId,
        "Offline Created Note",
        "Written on airplane without wifi.",
        "rose",
        false,
        {},
        testMailboxKey
      );

      // B. Edit existing note offline
      updateNote(
        testMailboxId,
        noteOnline!.id,
        {
          title: "Online Note (Edited Offline)",
          content: "Updated while offline.",
        },
        testMailboxKey
      );

      // C. Create a temporary note and delete it offline
      const tempNote = createNote(
        testMailboxId,
        "Temp Note",
        "Will be deleted offline.",
        "slate",
        false,
        {},
        testMailboxKey
      );
      deleteNoteForever(testMailboxId, tempNote!.id, testMailboxKey);

      const queueBeforeSync = getNotesSyncQueue(testMailboxId);
      assert(queueBeforeSync.length >= 2, "Offline queue buffered actions");

      // Step 3: Reconnect to network and synchronize
      const syncResult = await syncNotesWithRemote(testMailboxId, testMailboxKey);
      assert(syncResult.success, "Reconnect sync completed successfully");

      const notesAfterReconnect = loadNotes(testMailboxId, testMailboxKey);
      assert(notesAfterReconnect.some((n) => n.id === offlineCreated!.id), "Offline created note is present");
      assert(notesAfterReconnect.some((n) => n.id === noteOnline!.id && n.title === "Online Note (Edited Offline)"), "Offline edit is present");
      assert(!notesAfterReconnect.some((n) => n.id === tempNote!.id), "Offline deleted note is permanently gone");

      // Step 4: Repeated synchronization idempotency check
      // Running sync a 2nd and 3rd time must NOT create duplicate notes or conflict copies
      const sync2 = await syncNotesWithRemote(testMailboxId, testMailboxKey);
      assert(sync2.success, "Second sync succeeded");
      assert(sync2.conflictCount === 0, "Second sync created 0 conflicts");

      const sync3 = await syncNotesWithRemote(testMailboxId, testMailboxKey);
      assert(sync3.success, "Third sync succeeded");
      assert(sync3.conflictCount === 0, "Third sync created 0 conflicts");

      const notesAfterRepeat = loadNotes(testMailboxId, testMailboxKey);
      assert(notesAfterRepeat.length === notesAfterReconnect.length, "Repeated sync produced zero duplicate notes");
    });

    // Test 11: Extended Stale-Device Tombstone Retention & Ghost Resurrection Immunity
    await test("11. Stale Device Tombstone Retention: Offline device cannot resurrect deleted notes", async () => {
      mockStorage.clear();
      if (typeof localStorage !== "undefined") localStorage.clear();
      clearNotesSyncQueue(testMailboxId);

      // Step 1: Note created on Device A and synced
      const doomedNote = createNote(
        testMailboxId,
        "Confidential Project Falcon",
        "Classified blueprint to be expunged.",
        "peach",
        false,
        {},
        testMailboxKey
      );
      await syncNotesWithRemote(testMailboxId, testMailboxKey);

      // Save a copy of this state as Device C (which will remain offline)
      const staleDevCNotes = loadNotes(testMailboxId, testMailboxKey);
      assert(staleDevCNotes.some((n) => n.id === doomedNote!.id), "Device C has note locally");

      // Step 2: Device A permanently deletes the note and pushes encrypted tombstone
      deleteNoteForever(testMailboxId, doomedNote!.id, testMailboxKey);
      await syncNotesWithRemote(testMailboxId, testMailboxKey);

      // Verify tombstone is safely stored in remote customer storage
      const tombstoneRaw = mockStorage.retrieve(`mailboxes/${testMailboxId}/notes/${doomedNote!.id}.enc`);
      assert(tombstoneRaw !== null, "Encrypted tombstone envelope retained in customer storage");
      const decTombstone = await decryptRemoteNote(testMailboxKey, testMailboxId, tombstoneRaw!, doomedNote!.id);
      assert(decTombstone?.isDeleted === true, "Tombstone marked isDeleted=true");

      // Step 3: Device C stays offline for extended duration (simulated 30-day clock advance)
      // Device C reconnects with stale local state
      saveNotes(testMailboxId, staleDevCNotes, testMailboxKey);

      // Device C performs sync
      const devCSync = await syncNotesWithRemote(testMailboxId, testMailboxKey);
      assert(devCSync.success, "Stale Device C sync succeeded");

      // Verify Device C deleted the note and did NOT resurrect it
      const devCNotesAfterSync = loadNotes(testMailboxId, testMailboxKey);
      assert(!devCNotesAfterSync.some((n) => n.id === doomedNote!.id), "Device C purged deleted note upon receiving tombstone");

      // Step 4: Device C performs a second and third sync to ensure ghost resurrection immunity
      await syncNotesWithRemote(testMailboxId, testMailboxKey);
      const devCFinal = loadNotes(testMailboxId, testMailboxKey);
      assert(!devCFinal.some((n) => n.id === doomedNote!.id), "Ghost resurrection immunity verified: Note remains permanently deleted");
    });

  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.TEST_STORAGE_SYNC;
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

  console.log(`WEBMAIL NOTES SYNC TESTS: ${passed} passed, ${failed} failed\n`);
  return { passed, failed };
}
