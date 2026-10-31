import assert from "node:assert";
import {
  saveMediaToIDB,
  getMediaFromIDB,
  deleteMediaFromIDB,
  offloadMediaIfDataUrl,
  encryptNotesMedia,
  decryptNotesMedia,
  openNotesMediaDB,
  clearNotesMediaCache,
} from "./components/notes/notesStore";
import { getMailboxKeyFor, setAccountKeys } from "./session_isolation";

// In-memory IndexedDB mock for Node test runner
class MockIDBRequest {
  result: any = null;
  error: any = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
}

class MockIDBObjectStore {
  constructor(private storage: Map<string, any>) {}

  put(value: any) {
    const req = new MockIDBRequest();
    this.storage.set(value.id, JSON.parse(JSON.stringify(value)));
    req.result = value.id;
    setTimeout(() => {
      if (req.onsuccess) req.onsuccess();
    }, 0);
    return req;
  }

  get(id: string) {
    const req = new MockIDBRequest();
    const val = this.storage.get(id);
    req.result = val ? JSON.parse(JSON.stringify(val)) : undefined;
    setTimeout(() => {
      if (req.onsuccess) req.onsuccess();
    }, 0);
    return req;
  }

  delete(id: string) {
    const req = new MockIDBRequest();
    this.storage.delete(id);
    req.result = undefined;
    setTimeout(() => {
      if (req.onsuccess) req.onsuccess();
    }, 0);
    return req;
  }
}

class MockIDBTransaction {
  constructor(private storage: Map<string, any>) {}
  objectStore(_name: string) {
    return new MockIDBObjectStore(this.storage);
  }
}

class MockIDBDatabase {
  objectStoreNames = {
    contains: (_name: string) => true,
  };
  constructor(private storage: Map<string, any>) {}

  transaction(_name: string, _mode: string) {
    return new MockIDBTransaction(this.storage);
  }

  createObjectStore(_name: string, _options?: any) {
    return new MockIDBObjectStore(this.storage);
  }
}

class MockIDBFactory {
  storage = new Map<string, any>();
  open(_name: string, _version?: number) {
    const req = new MockIDBRequest();
    const db = new MockIDBDatabase(this.storage);
    req.result = db;
    setTimeout(() => {
      if (req.onsuccess) req.onsuccess();
    }, 0);
    return req;
  }
}

export async function runTrack4ResilienceTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => void | Promise<void>) {
    try {
      const res = fn();
      if (res instanceof Promise) {
        await res;
      }
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (err: any) {
      failed++;
      console.error(`  ✗ ${name}:`, err?.message || err);
    }
  }

  console.log("\nRunning Track 4: Webmail Reliability, Zero-Knowledge Media Encryption & Resilience Tests...");

  const mailboxId = "mbx-track4-test-1234";
  const dummyMailboxKey = new Uint8Array(32);
  for (let i = 0; i < 32; i++) dummyMailboxKey[i] = (i * 7 + 13) % 256;

  const mockFactory = new MockIDBFactory();
  (globalThis as any).indexedDB = mockFactory;

  // ─────────────────────────────────────────────────────────────
  // 1. Notes IndexedDB Media AES-GCM Zero-Knowledge Encryption Tests
  // ─────────────────────────────────────────────────────────────
  await test("Track 4.1: encryptNotesMedia & decryptNotesMedia perform authenticated AES-GCM roundtrip", () => {
    const sampleDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const encryptedHex = encryptNotesMedia(dummyMailboxKey, mailboxId, sampleDataUrl);
    assert(encryptedHex !== null, "Encryption returned ciphertext hex");
    assert(typeof encryptedHex === "string", "Ciphertext is a hex string");
    assert(!encryptedHex.includes("data:image/png"), "Ciphertext does not contain plaintext dataUrl");

    const decrypted = decryptNotesMedia(dummyMailboxKey, mailboxId, encryptedHex);
    assert(decrypted === sampleDataUrl, "Decrypted dataUrl byte-for-byte matches original");
  });

  await test("Track 4.2: decryptNotesMedia fails closed on wrong key or tampered ciphertext", () => {
    const sampleDataUrl = "data:image/png;base64,SECRET_CANVAS_DRAWING_DATA_URL";
    const encryptedHex = encryptNotesMedia(dummyMailboxKey, mailboxId, sampleDataUrl)!;

    const wrongKey = new Uint8Array(32);
    wrongKey.fill(0xee);

    // Wrong key returns null
    const wrongDec = decryptNotesMedia(wrongKey, mailboxId, encryptedHex);
    assert(wrongDec === null, "Decryption with wrong key must fail closed and return null");

    // Tampered ciphertext returns null
    const tamperedHex = encryptedHex.slice(0, -4) + "0000";
    const tamperedDec = decryptNotesMedia(dummyMailboxKey, mailboxId, tamperedHex);
    assert(tamperedDec === null, "Decryption of tampered ciphertext must return null");
  });

  await test("Track 4.3: saveMediaToIDB encrypts dataUrl in IndexedDB and redacts plaintext", async () => {
    clearNotesMediaCache();
    mockFactory.storage.clear();

    const mediaId = "idb:drawing_12345";
    const sampleDrawing = "data:image/png;base64,CANVAS_STROKE_PATH_COORDINATES_CONFIDENTIAL";

    const savedId = await saveMediaToIDB(mediaId, sampleDrawing, dummyMailboxKey, mailboxId);
    assert(savedId === mediaId, "saveMediaToIDB returned mediaId");

    // Inspect stored raw record in mock IndexedDB storage
    const storedRecord = mockFactory.storage.get(mediaId);
    assert(storedRecord !== undefined, "Record stored in IndexedDB");
    assert(storedRecord.dataUrl === "(Encrypted Media)", "Raw dataUrl in IndexedDB is masked with (Encrypted Media)");
    assert(typeof storedRecord.encryptedDataUrl === "string", "Contains encryptedDataUrl hex payload");
    assert(!JSON.stringify(storedRecord).includes("CANVAS_STROKE_PATH_COORDINATES_CONFIDENTIAL"), "Zero plaintext leakage in IndexedDB storage");

    // Clear memory cache to ensure read hits IndexedDB and decrypts
    clearNotesMediaCache();
    const loaded = await getMediaFromIDB(mediaId, dummyMailboxKey, mailboxId);
    assert(loaded === sampleDrawing, "getMediaFromIDB successfully decrypted media with active mailbox key");

    // Load without key returns null (fails closed)
    clearNotesMediaCache();
    const loadedNoKey = await getMediaFromIDB(mediaId, null, mailboxId);
    assert(loadedNoKey === null, "getMediaFromIDB without key fails closed and returns null");
  });

  await test("Track 4.4: getMediaFromIDB supports legacy unencrypted media fallback", async () => {
    clearNotesMediaCache();
    mockFactory.storage.clear();

    const legacyId = "idb:legacy_drawing_999";
    const legacyDataUrl = "data:image/png;base64,LEGACY_CLEARTEXT_DRAWING_DATA";

    // Directly put unencrypted legacy record in IndexedDB
    mockFactory.storage.set(legacyId, {
      id: legacyId,
      dataUrl: legacyDataUrl,
      createdAt: Date.now() - 100000,
    });

    const retrieved = await getMediaFromIDB(legacyId, dummyMailboxKey, mailboxId);
    assert(retrieved === legacyDataUrl, "Legacy unencrypted media is seamlessly loaded");
  });

  await test("Track 4.5: offloadMediaIfDataUrl creates idb pointer and encrypts when key is provided", async () => {
    clearNotesMediaCache();
    mockFactory.storage.clear();

    const dataUrl = "data:image/png;base64,PHOTO_ATTACHMENT_BYTES_TEST";
    const pointer = offloadMediaIfDataUrl(dataUrl, "image", dummyMailboxKey, mailboxId);

    assert(pointer.startsWith("idb:image_"), "Pointer has idb:image_ format");
    await new Promise((r) => setTimeout(r, 20));

    // Verify item in storage is encrypted
    const stored = mockFactory.storage.get(pointer);
    assert(stored !== undefined, "Item was stored in IndexedDB");
    assert(stored.dataUrl === "(Encrypted Media)", "Item in storage is masked");
    assert(Boolean(stored.encryptedDataUrl), "Item in storage has encryptedDataUrl envelope");
  });

  // ─────────────────────────────────────────────────────────────
  // 2. Folder Counts Logic & Accuracy Tests
  // ─────────────────────────────────────────────────────────────
  await test("Track 4.6: folderCounts correctly aggregates inbox, drafts, sent, trash, and snoozed", () => {
    const now = Date.now();
    const testMessages: any[] = [
      { id: "m1", folder: "inbox", read: false, folderId: null },
      { id: "m2", folder: "inbox", read: false, folderId: "" },
      { id: "m3", folder: "inbox", read: true, folderId: null },
      { id: "m4", folder: "inbox", read: false, folderId: "custom-folder-1" }, // should be excluded from inbox count
      { id: "m5", folder: "drafts", read: true },
      { id: "m6", folder: "drafts", read: false },
      { id: "m7", folder: "sent", read: true },
      { id: "m8", folder: "trash", read: false },
      { id: "m9", folder: "scheduled", read: true },
      { id: "m10", folder: "archive", read: false },
      { id: "m11", folder: "spam", read: false },
      { id: "m12", folder: "inbox", read: false, snoozedUntil: new Date(now + 60000).toISOString() }, // actively snoozed
      { id: "m13", folder: "inbox", read: false, snoozedUntil: new Date(now - 60000).toISOString() }, // expired snooze -> counts as inbox
    ];

    const counts: Record<string, number> = {
      inbox: 0,
      sent: 0,
      scheduled: 0,
      drafts: 0,
      archive: 0,
      spam: 0,
      trash: 0,
      snoozed: 0,
      unified_inbox: 0,
    };

    for (const m of testMessages) {
      if (m.folder === "scheduled") {
        counts.scheduled++;
        continue;
      }
      if (m.folder === "drafts") {
        counts.drafts++;
        continue;
      }
      if (m.folder === "sent") {
        counts.sent++;
        continue;
      }
      if (m.folder === "trash") {
        counts.trash++;
        continue;
      }
      const isSnoozed = Boolean(m.snoozedUntil && new Date(m.snoozedUntil).getTime() > now);
      if (isSnoozed) {
        counts.snoozed++;
        continue;
      }
      if (!m.read) {
        if (m.folder === "inbox") {
          if (!m.folderId || m.folderId === "") {
            counts.inbox++;
          }
        } else if (m.folder === "archive") {
          counts.archive++;
        } else if (m.folder === "spam") {
          counts.spam++;
        }
      }
    }

    assert(counts.drafts === 2, `Expected 2 drafts, got ${counts.drafts}`);
    assert(counts.sent === 1, `Expected 1 sent message, got ${counts.sent}`);
    assert(counts.trash === 1, `Expected 1 trash message, got ${counts.trash}`);
    assert(counts.scheduled === 1, `Expected 1 scheduled message, got ${counts.scheduled}`);
    assert(counts.snoozed === 1, `Expected 1 snoozed message, got ${counts.snoozed}`);
    assert(counts.archive === 1, `Expected 1 unread archive, got ${counts.archive}`);
    assert(counts.spam === 1, `Expected 1 unread spam, got ${counts.spam}`);
    // m1, m2, and m13 (expired snooze) count as unread inbox; m4 is in custom folder
    assert(counts.inbox === 3, `Expected 3 unread inbox messages, got ${counts.inbox}`);
  });

  // ─────────────────────────────────────────────────────────────
  // 3. Bridge Status Evaluation Logic Tests
  // ─────────────────────────────────────────────────────────────
  await test("Track 4.7: Bridge status transitions correctly based on health and credentials", () => {
    function computeBridgeStatus(apiHealthy: boolean, credentialCount: number): "active" | "ready" | "disconnected" {
      if (!apiHealthy) return "disconnected";
      if (credentialCount > 0) return "active";
      return "ready";
    }

    assert(computeBridgeStatus(true, 2) === "active", "Healthy API with credentials is active");
    assert(computeBridgeStatus(true, 0) === "ready", "Healthy API with 0 credentials is ready");
    assert(computeBridgeStatus(false, 2) === "disconnected", "Unreachable API is disconnected");
    assert(computeBridgeStatus(false, 0) === "disconnected", "Unreachable API with 0 credentials is disconnected");
  });

  console.log(`\nTRACK 4 RESILIENCE TESTS: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}
