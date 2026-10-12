import {
  cacheInboxMessages,
  getCachedInbox,
  saveCachedMessageBody,
  getCachedMessageBody,
  clearOfflineCache,
  openOfflineDB,
  DB_NAME,
} from "./offline_cache";
import {
  enqueueSend,
  getPendingQueue,
  removeFromQueue,
  markFailed,
  replayQueue,
} from "./send_queue";
import type { MessageMetadata, MessageBodyResponse } from "./api";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function createMockRequest<T>(getResult: () => T): any {
  let successFn: any = null;
  let errorFn: any = null;
  const req: any = {
    result: undefined,
    error: null,
    get onsuccess() {
      return successFn;
    },
    set onsuccess(fn: any) {
      successFn = fn;
      if (fn) {
        Promise.resolve().then(() => {
          try {
            req.result = getResult();
            fn({ target: req });
          } catch (e) {
            req.error = e;
            if (errorFn) errorFn(e);
          }
        });
      }
    },
    get onerror() {
      return errorFn;
    },
    set onerror(fn: any) {
      errorFn = fn;
    },
  };
  return req;
}

class MockIDBIndex {
  constructor(private store: MockIDBObjectStore, private keyPath: string) {}

  getAll(query?: any): any {
    return createMockRequest(() => {
      let items = Array.from(this.store.data.values());
      if (query !== undefined) {
        items = items.filter((item) => (item as any)[this.keyPath] === query);
      }
      return items;
    });
  }
}

class MockIDBObjectStore {
  data = new Map<string, any>();
  indexes = new Map<string, MockIDBIndex>();

  constructor(public name: string, public keyPath: string) {}

  createIndex(name: string, keyPath: string, options?: any): MockIDBIndex {
    const idx = new MockIDBIndex(this, keyPath);
    this.indexes.set(name, idx);
    return idx;
  }

  index(name: string): MockIDBIndex {
    const idx = this.indexes.get(name);
    if (!idx) throw new Error(`Index not found: ${name}`);
    return idx;
  }

  get(key: string): any {
    return createMockRequest(() => this.data.get(key));
  }

  put(value: any): any {
    const key = value[this.keyPath];
    this.data.set(key, JSON.parse(JSON.stringify(value)));
    return createMockRequest(() => key);
  }

  delete(key: string): any {
    this.data.delete(key);
    return createMockRequest(() => undefined);
  }

  getAll(): any {
    return createMockRequest(() => Array.from(this.data.values()));
  }

  clear(): any {
    this.data.clear();
    return createMockRequest(() => undefined);
  }
}

class MockIDBDatabase {
  stores = new Map<string, MockIDBObjectStore>();
  objectStoreNames = {
    contains: (name: string) => this.stores.has(name),
  };

  createObjectStore(name: string, options: { keyPath: string }): MockIDBObjectStore {
    const store = new MockIDBObjectStore(name, options.keyPath);
    this.stores.set(name, store);
    return store;
  }

  transaction(storeNames: string | string[], mode: string): any {
    let completeFn: any = null;
    let errorFn: any = null;
    const tx: any = {
      objectStore: (name: string) => this.stores.get(name),
      get oncomplete() {
        return completeFn;
      },
      set oncomplete(fn: any) {
        completeFn = fn;
        if (fn) {
          Promise.resolve().then(() => fn());
        }
      },
      get onerror() {
        return errorFn;
      },
      set onerror(fn: any) {
        errorFn = fn;
      },
    };
    return tx;
  }
}

class MockIDBFactory {
  databases = new Map<string, MockIDBDatabase>();

  open(name: string, version: number): any {
    let db = this.databases.get(name);
    let isNew = false;
    if (!db) {
      db = new MockIDBDatabase();
      this.databases.set(name, db);
      isNew = true;
    }

    let successFn: any = null;
    let upgradeFn: any = null;
    const req: any = {
      result: db,
      get onupgradeneeded() {
        return upgradeFn;
      },
      set onupgradeneeded(fn: any) {
        upgradeFn = fn;
      },
      get onsuccess() {
        return successFn;
      },
      set onsuccess(fn: any) {
        successFn = fn;
        if (fn) {
          Promise.resolve().then(() => {
            if (isNew && upgradeFn) {
              upgradeFn({ target: req, result: db, oldVersion: 0, newVersion: version });
            }
            fn({ target: req, result: db });
          });
        }
      },
      onerror: null,
    };
    return req;
  }
}

export async function runOfflineTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  const test = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}:`, err);
      failed++;
    }
  };

  // Setup mock indexedDB in global scope if not present
  const originalIDB = (globalThis as any).indexedDB;
  (globalThis as any).indexedDB = new MockIDBFactory();

  try {
    // 1. Cache stores 50 messages, prunes older
    await test("1. Cache stores 50 messages, prunes older", async () => {
      const mailboxId = "mailbox-123";
      const messages: MessageMetadata[] = [];
      for (let i = 1; i <= 60; i++) {
        messages.push({
          id: `msg-${i}`,
          mailbox_id: mailboxId,
          message_seq: i,
          direction: "received",
          sender: "alice@example.com",
          recipients: ["bob@byos.local"],
          storage_object_id: `mailboxes/${mailboxId}/${i}.eml.enc`,
          content_key_hpke_wrapped: "wrapped",
          encryption_version: 1,
          encryption_iv: "iv",
          aad_version: 1,
          bundle_hash: "hash",
          received_at: new Date(Date.now() + i * 1000).toISOString(),
          status: "received",
          has_attachments: false,
          attachment_count: 0,
          folder: "inbox",
          subject: `Message ${i}`,
        });
      }

      await cacheInboxMessages(mailboxId, messages);
      const cached = await getCachedInbox(mailboxId);

      assert(cached.length === 50, `expected 50 cached messages, got ${cached.length}`);
      assert(cached[0].message_seq === 60, `newest message seq should be 60, got ${cached[0].message_seq}`);
      assert(cached[49].message_seq === 11, `oldest message seq in top 50 should be 11, got ${cached[49].message_seq}`);
      assert(!cached.some((m) => m.message_seq < 11), "messages 1-10 must be pruned");
    });

    // 2. Cached content is ciphertext, not plaintext
    await test("2. Cached content is ciphertext, not plaintext", async () => {
      const mailboxId = "mailbox-123";
      const msgId = "msg-60";
      const ciphertextBody: MessageBodyResponse = {
        encrypted_body: "ENCRYPTED_CIPHERTEXT_BYTES_NOT_PLAINTEXT",
        content_key_hpke_wrapped: "WRAPPED_KEY_CIPHERTEXT",
        encryption_iv: "12_BYTE_IV",
        aad_version: 1,
        bundle_hash: "BUNDLE_HASH",
        encryption_version: 1,
        message_seq: 60,
        xwing_envelope_json: '{"v":1,"alg":"HPKE-XWing-AES256GCM-v1","ciphertext":"ENCRYPTED_XWING"}',
      };

      await saveCachedMessageBody(mailboxId, msgId, ciphertextBody);
      const retrieved = await getCachedMessageBody(msgId);

      assert(retrieved !== undefined, "cached body should exist");
      assert(retrieved?.encrypted_body === "ENCRYPTED_CIPHERTEXT_BYTES_NOT_PLAINTEXT", "stored body must be ciphertext");
      assert(!JSON.stringify(retrieved).includes("Dear Bob, here is plaintext"), "no plaintext in stored ciphertext");
    });

    // 3. Unsealed keys NOT present in IndexedDB
    await test("3. Unsealed keys NOT present in IndexedDB", async () => {
      const db = await openOfflineDB();
      const tx = db.transaction(["messages", "send_queue", "drafts"], "readonly");
      
      const allMessages = await new Promise<any[]>((res) => {
        const req = tx.objectStore("messages").getAll();
        req.onsuccess = () => res(req.result);
      });
      const allQueue = await new Promise<any[]>((res) => {
        const req = tx.objectStore("send_queue").getAll();
        req.onsuccess = () => res(req.result);
      });
      const allDrafts = await new Promise<any[]>((res) => {
        const req = tx.objectStore("drafts").getAll();
        req.onsuccess = () => res(req.result);
      });

      const allDataStr = JSON.stringify({ allMessages, allQueue, allDrafts });
      assert(!allDataStr.includes("byos_mailbox_sk_"), "unsealed mailbox secret keys must not exist in IndexedDB");
      assert(!allDataStr.includes("byos_signing_seed_"), "unsealed signing seed must not exist in IndexedDB");
      assert(!allDataStr.includes("byos_xwing_seed_"), "unsealed xwing seed must not exist in IndexedDB");
    });

    // 4. Send queue persists items with client_queue_id UUID
    await test("4. Send queue persists items with client_queue_id UUID", async () => {
      const queueId = await enqueueSend({
        mailbox_id: "mailbox-123",
        recipient: "recipient@byos.local",
        payload: {
          envelope_json: '{"v":1}',
        },
        is_path_a: true,
      });

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      assert(uuidRegex.test(queueId), `queueId should be valid UUID format, got ${queueId}`);

      const pending = await getPendingQueue("mailbox-123");
      const found = pending.find((i) => i.client_queue_id === queueId);
      assert(found !== undefined, "item should be persisted in pending queue");
      assert(found?.status === "pending", "item status should be pending");
    });

    // 5. Queue replay sends items in FIFO order
    await test("5. Queue replay sends items in FIFO order", async () => {
      // Clear queue first
      await clearOfflineCache();

      const id1 = await enqueueSend({
        client_queue_id: "00000000-0000-0000-0000-000000000001",
        mailbox_id: "mailbox-123",
        recipient: "r1@byos.local",
        payload: { envelope_json: "env1" },
        is_path_a: true,
      });
      const id2 = await enqueueSend({
        client_queue_id: "00000000-0000-0000-0000-000000000002",
        mailbox_id: "mailbox-123",
        recipient: "r2@byos.local",
        payload: { envelope_json: "env2" },
        is_path_a: true,
      });
      const id3 = await enqueueSend({
        client_queue_id: "00000000-0000-0000-0000-000000000003",
        mailbox_id: "mailbox-123",
        recipient: "r3@byos.local",
        payload: { envelope_json: "env3" },
        is_path_a: true,
      });

      const sentOrder: string[] = [];
      const res = await replayQueue({
        sendInternal: async (req) => {
          if (req.client_queue_id) sentOrder.push(req.client_queue_id);
          return { message_id: "m-" + req.client_queue_id, status: "delivered", delivery_id: "d1", message_seq: 1 };
        },
      });

      assert(res.sent === 3, `expected 3 sent items, got ${res.sent}`);
      assert(sentOrder[0] === id1 && sentOrder[1] === id2 && sentOrder[2] === id3, "items must be replayed in FIFO order");
    });

    // 6. Replay handles server 200 (removes item) and server error (marks failed)
    await test("6. Replay handles server 200 (removes item) and server error (marks failed)", async () => {
      await clearOfflineCache();

      const okId = await enqueueSend({
        client_queue_id: "00000000-0000-0000-0000-000000000004",
        mailbox_id: "mailbox-123",
        recipient: "ok@byos.local",
        payload: { envelope_json: "ok" },
        is_path_a: true,
      });
      const failId = await enqueueSend({
        client_queue_id: "00000000-0000-0000-0000-000000000005",
        mailbox_id: "mailbox-123",
        recipient: "fail@byos.local",
        payload: { envelope_json: "fail" },
        is_path_a: true,
      });

      await replayQueue({
        sendInternal: async (req) => {
          if (req.client_queue_id === okId) {
            return { message_id: "m-ok", status: "delivered", delivery_id: "d-ok", message_seq: 1 };
          }
          throw new Error("invalid recipient rejected by server");
        },
      });

      const pendingAfter = await getPendingQueue();
      assert(!pendingAfter.some((i) => i.client_queue_id === okId), "successful item must be removed from queue");

      const db = await openOfflineDB();
      const failItem = await new Promise<any>((res) => {
        const req = db.transaction("send_queue", "readonly").objectStore("send_queue").get(failId);
        req.onsuccess = () => res(req.result);
      });
      assert(failItem !== undefined, "failed item should still exist in store for user visibility");
      assert(failItem.status === "failed", "failed item status must be marked 'failed'");
      assert(failItem.error.includes("invalid recipient"), "failed item should record error message");
    });

    // 7. Clear offline cache deletes all stores and SW caches
    await test("7. Clear offline cache deletes all stores and SW caches", async () => {
      await clearOfflineCache();

      const db = await openOfflineDB();
      const tx = db.transaction(["messages", "send_queue", "drafts"], "readonly");
      const msgs = await new Promise<any[]>((res) => {
        const req = tx.objectStore("messages").getAll();
        req.onsuccess = () => res(req.result);
      });
      const queue = await new Promise<any[]>((res) => {
        const req = tx.objectStore("send_queue").getAll();
        req.onsuccess = () => res(req.result);
      });

      assert(msgs.length === 0, "messages store must be empty after clearOfflineCache");
      assert(queue.length === 0, "send_queue store must be empty after clearOfflineCache");
    });

  } finally {
    (globalThis as any).indexedDB = originalIDB;
  }

  return { passed, failed };
}
