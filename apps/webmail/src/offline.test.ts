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
  getFailedQueue,
  getAllQueuedSends,
  removeFromQueue,
  markFailed,
  replayQueue,
  retryQueuedSend,
  retryFailedSends,
  isPermanentSendError,
  isAuthSendError,
  isNetworkSendError,
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

    // 8. Release B Replay: Successful replay drains queue and reports sent count
    await test("8. Release B Replay: Successful replay drains queue and reports sent count", async () => {
      await clearOfflineCache();
      const id1 = await enqueueSend({
        client_queue_id: "00000000-0000-0000-0000-000000000010",
        mailbox_id: "mailbox-123",
        recipient: "rec1@byos.local",
        payload: { envelope_json: "payload1" },
        is_path_a: true,
      });
      const id2 = await enqueueSend({
        client_queue_id: "00000000-0000-0000-0000-000000000011",
        mailbox_id: "mailbox-123",
        recipient: "rec2@byos.local",
        payload: { envelope_json: "payload2" },
        is_path_a: true,
      });

      const res = await replayQueue({
        sendInternal: async (req) => ({ message_id: "m-" + req.client_queue_id, status: "delivered" }),
      });

      assert(res.sent === 2, `expected 2 sent items, got ${res.sent}`);
      assert(res.failed === 0, `expected 0 failed items, got ${res.failed}`);
      assert(res.pending === 0, `expected 0 pending items, got ${res.pending}`);
      const remaining = await getPendingQueue();
      assert(remaining.length === 0, "queue must be completely drained on successful replay");
    });

    // 9. Release B Replay: Permanent HTTP 400 rejection marks failed, preserves data, and skips future auto-replay
    await test("9. Release B Replay: Permanent HTTP 400 rejection marks failed, preserves data, and skips future auto-replay", async () => {
      await clearOfflineCache();
      const failId = await enqueueSend({
        client_queue_id: "00000000-0000-0000-0000-000000000020",
        mailbox_id: "mailbox-123",
        recipient: "bad-att@byos.local",
        payload: { envelope_json: "bad", attachment_ids: ["att-missing"] },
        is_path_a: false,
      });

      const res = await replayQueue({
        sendOutbound: async () => {
          const err = new Error("API error 400: attachment not found") as any;
          err.status = 400;
          throw err;
        },
      });

      assert(res.failed === 1, `expected 1 failed item, got ${res.failed}`);
      assert(res.sent === 0, `expected 0 sent items, got ${res.sent}`);
      assert(res.pending === 0, `expected 0 pending items, got ${res.pending}`);

      const failedItems = await getFailedQueue();
      assert(failedItems.length === 1, `expected 1 failed queue item, got ${failedItems.length}`);
      assert(failedItems[0].client_queue_id === failId, "failed item ID must match");
      assert(failedItems[0].status === "failed", "item status must be 'failed'");
      assert(failedItems[0].error?.includes("attachment not found"), "error message must be captured");

      const pendingQueue = await getPendingQueue();
      assert(pendingQueue.length === 0, "pending queue must exclude permanently failed items to avoid retry loops");
    });

    // 10. Release B Replay: Temporary HTTP 503 failure keeps pending status and records attempt without marking failed
    await test("10. Release B Replay: Temporary HTTP 503 failure keeps pending status and records attempt without marking failed", async () => {
      await clearOfflineCache();
      const id1 = await enqueueSend({
        client_queue_id: "00000000-0000-0000-0000-000000000030",
        mailbox_id: "mailbox-123",
        recipient: "temp1@byos.local",
        payload: { envelope_json: "temp1" },
        is_path_a: true,
      });
      const id2 = await enqueueSend({
        client_queue_id: "00000000-0000-0000-0000-000000000031",
        mailbox_id: "mailbox-123",
        recipient: "temp2@byos.local",
        payload: { envelope_json: "temp2" },
        is_path_a: true,
      });

      let attemptsCount = 0;
      const res = await replayQueue({
        sendInternal: async () => {
          attemptsCount++;
          const err = new Error("API error 503: Service Unavailable") as any;
          err.status = 503;
          throw err;
        },
      });

      assert(res.failed === 0, `expected 0 permanent failures, got ${res.failed}`);
      assert(res.sent === 0, `expected 0 sent, got ${res.sent}`);
      assert(res.pending === 2, `expected 2 items remaining pending, got ${res.pending}`);
      assert(attemptsCount === 1, "replay loop must break on temporary server failure, not spamming second item");

      const pendingAfter = await getPendingQueue();
      assert(pendingAfter.length === 2, "both items must remain pending for next reconnect retry");
      const item1 = pendingAfter.find((i) => i.client_queue_id === id1);
      assert(item1?.status === "pending", "item 1 status must remain 'pending'");
      assert((item1?.attempts || 0) >= 1, "transient attempt count must be incremented");
    });

    // 11. Release B Replay: Network disconnection during replay keeps pending status for automatic retry
    await test("11. Release B Replay: Network disconnection during replay keeps pending status for automatic retry", async () => {
      await clearOfflineCache();
      const id1 = await enqueueSend({
        client_queue_id: "00000000-0000-0000-0000-000000000040",
        mailbox_id: "mailbox-123",
        recipient: "net1@byos.local",
        payload: { envelope_json: "net1" },
        is_path_a: true,
      });
      const id2 = await enqueueSend({
        client_queue_id: "00000000-0000-0000-0000-000000000041",
        mailbox_id: "mailbox-123",
        recipient: "net2@byos.local",
        payload: { envelope_json: "net2" },
        is_path_a: true,
      });

      let calledCount = 0;
      const res = await replayQueue({
        sendInternal: async () => {
          calledCount++;
          throw new TypeError("Failed to fetch");
        },
      });

      assert(res.failed === 0, "network errors must not be marked permanent failed");
      assert(res.pending === 2, "both items must remain pending");
      assert(calledCount === 1, "replay must abort upon network loss without calling remaining items");

      const pendingAfter = await getPendingQueue();
      assert(pendingAfter.length === 2, "both items must remain in pending queue for future retry");
    });

    // 12. Release B Replay: Manual retry succeeds after correcting underlying issue
    await test("12. Release B Replay: Manual retry succeeds after correcting underlying issue", async () => {
      await clearOfflineCache();
      const retryId = await enqueueSend({
        client_queue_id: "00000000-0000-0000-0000-000000000050",
        mailbox_id: "mailbox-123",
        recipient: "retry-me@byos.local",
        payload: { envelope_json: "initially-broken" },
        is_path_a: true,
      });

      let backendFails = true;
      await replayQueue({
        sendInternal: async () => {
          if (backendFails) {
            const err = new Error("API error 400: bad payload") as any;
            err.status = 400;
            throw err;
          }
          return { message_id: "m-recovered", status: "delivered" };
        },
      });

      const failedQueueBefore = await getFailedQueue();
      assert(failedQueueBefore.some((i) => i.client_queue_id === retryId), "item must be marked failed");

      // Correct issue
      backendFails = false;

      // User triggers manual retry
      const retryOutcome = await retryQueuedSend(retryId, {
        sendInternal: async () => ({ message_id: "m-recovered", status: "delivered" }),
      });

      assert(retryOutcome.success === true, "manual retry must report success");
      const pendingAfter = await getPendingQueue();
      assert(!pendingAfter.some((i) => i.client_queue_id === retryId), "retried item must be removed from queue");
      const failedAfter = await getFailedQueue();
      assert(!failedAfter.some((i) => i.client_queue_id === retryId), "item must no longer be in failed queue");
    });

    // 13. Release B Replay: Queue persistence after failed replay preserves attachments and metadata
    await test("13. Release B Replay: Queue persistence after failed replay preserves attachments and metadata", async () => {
      await clearOfflineCache();
      const richAtt = {
        id: "att-persist-uuid-1",
        filename: "financial_report_2026.pdf",
        content_type: "application/pdf",
        size_bytes: 1048576,
        crypto_version: 2,
        cek_owner_wrapped: "wrapped-cek-base64",
        owner_key_version: 1,
        plaintext_sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      };

      const richId = await enqueueSend({
        client_queue_id: "00000000-0000-0000-0000-000000000060",
        mailbox_id: "mailbox-corp-1",
        recipient: "cfo@partner.example",
        payload: {
          envelope_json: '{"subject":"Q3 Report"}',
          attachment_ids: ["att-persist-uuid-1"],
          offline_attachments: [richAtt],
          mime_message: "MIME-DATA-PRESERVED",
        },
        is_path_a: false,
      });

      await replayQueue({
        sendOutbound: async () => {
          const err = new Error("API error 413: outbound_attachment_limit_exceeded") as any;
          err.status = 413;
          throw err;
        },
      });

      const allSends = await getAllQueuedSends();
      const storedItem = allSends.find((i) => i.client_queue_id === richId);
      assert(storedItem !== undefined, "failed message must be persisted in IndexedDB");
      assert(storedItem.status === "failed", "item status must be 'failed'");
      assert(storedItem.recipient === "cfo@partner.example", "recipient must be preserved");
      assert(storedItem.mailbox_id === "mailbox-corp-1", "mailbox_id must be preserved");
      assert(storedItem.payload.mime_message === "MIME-DATA-PRESERVED", "mime message must be preserved");
      assert(Array.isArray(storedItem.payload.offline_attachments), "offline attachments must be preserved");
      assert(storedItem.payload.offline_attachments![0].filename === "financial_report_2026.pdf", "attachment filename preserved");
      assert(storedItem.payload.offline_attachments![0].cek_owner_wrapped === "wrapped-cek-base64", "wrapped CEK preserved");
      assert(storedItem.error?.includes("outbound_attachment_limit_exceeded"), "exact rejection error preserved");
    });

    // 14. Release B Error Classification: Unit classification of 400, 401, 403, 408, 409, 429, 500, and network errors
    await test("14. Release B Error Classification: Unit classification of 400, 401, 403, 408, 409, 429, 500, and network errors", async () => {
      // 400 Bad Request / Validation errors
      const err400 = Object.assign(new Error("validation failed"), { status: 400 });
      assert(isPermanentSendError(err400) === true, "400 must be classified as permanent");
      assert(isAuthSendError(err400) === false, "400 is not auth error");

      // Missing attachment text error
      const errMissingAtt = new Error("Queued message attachment metadata is incomplete; cannot send without attachments.");
      assert(isPermanentSendError(errMissingAtt) === true, "missing attachment text must be permanent");

      // 401 Unauthorized / Session expired
      const err401 = Object.assign(new Error("API error 401: Unauthorized"), { status: 401 });
      assert(isPermanentSendError(err401) === false, "401 must NOT be permanent (held for re-auth)");
      assert(isAuthSendError(err401) === true, "401 must be classified as auth/session error");

      // 403 Forbidden with session expiration indicator
      const err403Session = Object.assign(new Error("API error 403: session expired"), { status: 403 });
      assert(isPermanentSendError(err403Session) === false, "403 session expired must NOT be permanent");
      assert(isAuthSendError(err403Session) === true, "403 session expired must be auth error");

      // 403 Forbidden (RBAC / mailbox permission)
      const err403Perm = Object.assign(new Error("API error 403: forbidden"), { status: 403 });
      assert(isPermanentSendError(err403Perm) === true, "403 without session context is permanent");

      // 408 Request Timeout
      const err408 = Object.assign(new Error("Request Timeout"), { status: 408 });
      assert(isPermanentSendError(err408) === false, "408 must be recoverable");

      // 409 Conflict (e.g. outbound_key_epoch_expired reaching send_queue)
      const err409 = Object.assign(new Error("outbound_key_epoch_expired"), { status: 409, code: "outbound_key_epoch_expired" });
      assert(isPermanentSendError(err409) === true, "409 in send_queue must be failed to prevent un-recovered loop");

      // 429 Too Many Requests
      const err429 = Object.assign(new Error("Rate limit exceeded"), { status: 429 });
      assert(isPermanentSendError(err429) === false, "429 must be recoverable");

      // 500 / 502 / 503 / 504
      const err500 = Object.assign(new Error("Internal Server Error"), { status: 500 });
      const err502 = Object.assign(new Error("Bad Gateway"), { status: 502 });
      const err503 = Object.assign(new Error("Service Unavailable"), { status: 503 });
      const err504 = Object.assign(new Error("Gateway Timeout"), { status: 504 });
      assert(!isPermanentSendError(err500), "500 must be recoverable");
      assert(!isPermanentSendError(err502), "502 must be recoverable");
      assert(!isPermanentSendError(err503), "503 must be recoverable");
      assert(!isPermanentSendError(err504), "504 must be recoverable");

      // Network errors
      const errNet = new TypeError("Failed to fetch");
      assert(isNetworkSendError(errNet) === true, "Failed to fetch must be network error");
    });

    // 15. Release B Replay: HTTP 429 with Retry-After delays subsequent replay passes until elapsed
    await test("15. Release B Replay: HTTP 429 with Retry-After delays subsequent replay passes until elapsed", async () => {
      await clearOfflineCache();
      const id429 = await enqueueSend({
        client_queue_id: "00000000-0000-0000-0000-000000000070",
        mailbox_id: "mailbox-123",
        recipient: "rate-limited@byos.local",
        payload: { envelope_json: "payload429" },
        is_path_a: true,
      });

      let callCount = 0;
      const res1 = await replayQueue({
        sendInternal: async () => {
          callCount++;
          const err = new Error("API error 429: Too Many Requests") as any;
          err.status = 429;
          err.retryAfter = 60; // 60 seconds backoff
          throw err;
        },
      });

      assert(res1.failed === 0, "429 must not be marked permanent failed");
      assert(res1.sent === 0, "0 sent");
      assert(res1.pending === 1, "1 item pending");
      assert(callCount === 1, "1 call made");

      const pendingAfter = await getPendingQueue();
      const item = pendingAfter.find((i) => i.client_queue_id === id429);
      assert(item !== undefined, "item must remain in pending queue");
      assert(typeof item?.next_retry_at === "number", "next_retry_at must be populated from Retry-After");
      assert(item!.next_retry_at! > Date.now() + 50000, "next_retry_at must be in the future");

      // Second immediate replay pass should respect next_retry_at and skip calling backend
      callCount = 0;
      const res2 = await replayQueue({
        sendInternal: async () => {
          callCount++;
          return { message_id: "m-unexpected", status: "delivered" };
        },
      });

      assert(callCount === 0, "replay pass must skip item with future next_retry_at");
      assert(res2.sent === 0, "0 sent during backoff");

      // User manual retry clears backoff and sends immediately
      const retryOutcome = await retryQueuedSend(id429, {
        sendInternal: async () => {
          callCount++;
          return { message_id: "m-delivered-429", status: "delivered" };
        },
      });

      assert(retryOutcome.success === true, "manual retry must succeed");
      assert(callCount === 1, "manual retry must invoke send immediately bypassing backoff");
      const remaining = await getPendingQueue();
      assert(remaining.length === 0, "queue must be cleared after manual retry success");
    });

    // 16. Release B Replay: HTTP 408 Request Timeout is handled as recoverable transient failure
    await test("16. Release B Replay: HTTP 408 Request Timeout is handled as recoverable transient failure", async () => {
      await clearOfflineCache();
      const id408 = await enqueueSend({
        client_queue_id: "00000000-0000-0000-0000-000000000080",
        mailbox_id: "mailbox-123",
        recipient: "timeout@byos.local",
        payload: { envelope_json: "payload408" },
        is_path_a: true,
      });

      const res = await replayQueue({
        sendInternal: async () => {
          const err = new Error("API error 408: Request Timeout") as any;
          err.status = 408;
          throw err;
        },
      });

      assert(res.failed === 0, "408 must not be marked permanently failed");
      assert(res.pending === 1, "item must remain pending");
      const pendingAfter = await getPendingQueue();
      const item = pendingAfter.find((i) => i.client_queue_id === id408);
      assert(item?.status === "pending", "status must remain pending");
      assert((item?.attempts || 0) >= 1, "attempts must be incremented");
    });

    // 17. Release B Replay: HTTP 401 session expiration holds messages pending and succeeds upon reauthentication
    await test("17. Release B Replay: HTTP 401 session expiration holds messages pending and succeeds upon reauthentication", async () => {
      await clearOfflineCache();
      const id1 = await enqueueSend({
        client_queue_id: "00000000-0000-0000-0000-000000000091",
        mailbox_id: "mailbox-123",
        recipient: "auth1@byos.local",
        payload: { envelope_json: "auth1" },
        is_path_a: true,
      });
      const id2 = await enqueueSend({
        client_queue_id: "00000000-0000-0000-0000-000000000092",
        mailbox_id: "mailbox-123",
        recipient: "auth2@byos.local",
        payload: { envelope_json: "auth2" },
        is_path_a: true,
      });

      let attempts = 0;
      let authenticated = false;

      // First replay attempt when session is expired
      const resUnauth = await replayQueue({
        sendInternal: async (_req, token) => {
          attempts++;
          if (!token || token === "expired-token") {
            const err = new Error("API error 401: Unauthorized") as any;
            err.status = 401;
            throw err;
          }
          return { message_id: "m-authed", status: "delivered" };
        },
        getToken: () => (authenticated ? "fresh-valid-token" : "expired-token"),
      });

      assert(resUnauth.failed === 0, "401 must NOT mark messages permanently failed");
      assert(resUnauth.pending === 2, "both messages must be held pending");
      assert(attempts === 1, "replay loop must halt immediately on 401 without failing subsequent messages");

      const pendingUnauth = await getPendingQueue();
      assert(pendingUnauth.length === 2, "both items preserved in pending queue");
      const failedQueue = await getFailedQueue();
      assert(failedQueue.length === 0, "failed queue must remain empty");

      // User reauthenticates
      authenticated = true;

      // Second replay attempt after reauthentication
      const resAuthed = await replayQueue({
        sendInternal: async (_req, token) => {
          assert(token === "fresh-valid-token", "replay must supply fresh token");
          return { message_id: "m-delivered", status: "delivered" };
        },
        getToken: () => "fresh-valid-token",
      });

      assert(resAuthed.sent === 2, "both messages must be successfully replayed after re-auth");
      assert(resAuthed.failed === 0, "0 failures");
      const pendingAfter = await getPendingQueue();
      assert(pendingAfter.length === 0, "pending queue must be completely drained");
    });

    // 18. Release B Replay: HTTP 409 Conflict without recovery procedure transitions to failed without infinite retry loops
    await test("18. Release B Replay: HTTP 409 Conflict without recovery procedure transitions to failed without infinite retry loops", async () => {
      await clearOfflineCache();
      const id409 = await enqueueSend({
        client_queue_id: "00000000-0000-0000-0000-000000000100",
        mailbox_id: "mailbox-123",
        recipient: "conflict@byos.local",
        payload: { envelope_json: "payload409", attachment_ids: ["att-1"] },
        is_path_a: false,
      });

      let callCount = 0;
      const res = await replayQueue({
        sendOutbound: async () => {
          callCount++;
          const err = new Error("API error 409: outbound_key_epoch_expired") as any;
          err.status = 409;
          err.code = "outbound_key_epoch_expired";
          throw err;
        },
      });

      assert(res.failed === 1, "409 reaching queue must transition to failed status");
      assert(res.pending === 0, "must not remain in auto-retry pending queue");
      assert(callCount === 1, "called exactly once");

      const pendingAfter = await getPendingQueue();
      assert(pendingAfter.length === 0, "must be excluded from background auto-replay");

      const failedAfter = await getFailedQueue();
      assert(failedAfter.length === 1, "must be visible in failed queue");
      assert(failedAfter[0].client_queue_id === id409, "client_queue_id preserved");
      assert(failedAfter[0].error?.includes("outbound_key_epoch_expired"), "rejection reason preserved");
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
