import type { MessageMetadata, MessageBodyResponse } from "./api";

export const DB_NAME = "byos-offline";
export const DB_VERSION = 1;

export interface CachedMessage {
  id: string;
  mailbox_id: string;
  message_seq: number;
  metadata: MessageMetadata;
  body?: MessageBodyResponse;
  cached_at: number;
}

export interface QueuedSendItem {
  client_queue_id: string;
  mailbox_id: string;
  recipient: string;
  payload: {
    envelope_json?: string;
    sender_envelope_json?: string;
    mime_message?: string;
    attachment_envelopes?: any[];
    sender_attachment_envelopes?: any[];
    alias_id?: string;
    sender_email?: string;
    reservation_id?: string;
    encrypted_message?: string;
    send_token_wrapped?: string;
    outbox_seq?: number;
    encryption_version?: number;
    aad_version?: number;
    encryption_iv?: string;
    attachment_ids?: string[];
    offline_attachments?: Array<{
      id: string;
      filename: string;
      content_type: string;
      size_bytes: number;
      crypto_version?: number;
      cek_owner_wrapped?: string;
      owner_key_version?: number;
      plaintext_sha256?: string;
      disposition?: "attachment" | "inline";
      content_id?: string;
    }>;
  };
  is_path_a: boolean;
  status: "pending" | "sending" | "failed";
  error?: string;
  created_at: number;
  attempts: number;
  next_retry_at?: number;
}

export interface CachedDraft {
  id: string;
  mailbox_id: string;
  recipient: string;
  subject: string;
  body: string;
  bodyHtml?: string;
  encrypted_envelope?: string;
  updated_at: number;
}

let dbInstance: IDBDatabase | null = null;

export function getIDBFactory(): IDBFactory | undefined {
  if (typeof indexedDB !== "undefined") {
    return indexedDB;
  }
  if (typeof globalThis !== "undefined" && (globalThis as any).indexedDB) {
    return (globalThis as any).indexedDB;
  }
  return undefined;
}

export async function openOfflineDB(): Promise<IDBDatabase> {
  const idb = getIDBFactory();
  if (!idb) {
    throw new Error("IndexedDB is not supported in this environment");
  }

  if (dbInstance) {
    return dbInstance;
  }

  return new Promise((resolve, reject) => {
    const request = idb.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;

      if (!db.objectStoreNames.contains("messages")) {
        const messageStore = db.createObjectStore("messages", { keyPath: "id" });
        messageStore.createIndex("mailbox_id", "mailbox_id", { unique: false });
        messageStore.createIndex("created_at", "cached_at", { unique: false });
        messageStore.createIndex("message_seq", "message_seq", { unique: false });
      }

      if (!db.objectStoreNames.contains("send_queue")) {
        const queueStore = db.createObjectStore("send_queue", { keyPath: "client_queue_id" });
        queueStore.createIndex("mailbox_id", "mailbox_id", { unique: false });
        queueStore.createIndex("created_at", "created_at", { unique: false });
        queueStore.createIndex("status", "status", { unique: false });
      }

      if (!db.objectStoreNames.contains("drafts")) {
        const draftStore = db.createObjectStore("drafts", { keyPath: "id" });
        draftStore.createIndex("mailbox_id", "mailbox_id", { unique: false });
        draftStore.createIndex("updated_at", "updated_at", { unique: false });
      }
    };

    request.onsuccess = () => {
      dbInstance = request.result;
      dbInstance.onclose = () => {
        dbInstance = null;
      };
      resolve(dbInstance);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

/**
 * Caches up to 50 recent Inbox messages per active mailbox.
 * Stores raw ciphertext envelopes as received from the server (Directive D4).
 * Prunes messages beyond the 50 most recent (Directive D2).
 */
export async function cacheInboxMessages(
  mailboxId: string,
  messages: MessageMetadata[],
): Promise<void> {
  const db = await openOfflineDB();
  const tx = db.transaction("messages", "readwrite");
  const store = tx.objectStore("messages");

  // Sort descending by sequence/date to get top 50 newest
  const sorted = [...messages].sort((a, b) => (b.message_seq || 0) - (a.message_seq || 0));
  const top50 = sorted.slice(0, 50);

  const putPromises: Promise<void>[] = [];
  for (const msg of top50) {
    // Preserve existing cached ciphertext body if already stored
    const existingReq = store.get(msg.id);
    putPromises.push(
      new Promise<void>((resolve, reject) => {
        existingReq.onsuccess = () => {
          const existing = existingReq.result as CachedMessage | undefined;
          const entry: CachedMessage = {
            id: msg.id,
            mailbox_id: mailboxId,
            message_seq: msg.message_seq,
            metadata: msg,
            body: existing?.body,
            cached_at: Date.now(),
          };
          const putReq = store.put(entry);
          putReq.onsuccess = () => resolve();
          putReq.onerror = () => reject(putReq.error);
        };
        existingReq.onerror = () => reject(existingReq.error);
      }),
    );
  }

  await Promise.all(putPromises);
  await pruneOldCache(mailboxId, 50);
}

/**
 * Saves ciphertext message body envelope in IndexedDB.
 * Plaintext is never stored on disk (Directive D4).
 */
export async function saveCachedMessageBody(
  mailboxId: string,
  messageId: string,
  body: MessageBodyResponse,
): Promise<void> {
  const db = await openOfflineDB();
  const tx = db.transaction("messages", "readwrite");
  const store = tx.objectStore("messages");

  const getReq = store.get(messageId);
  await new Promise<void>((resolve, reject) => {
    getReq.onsuccess = () => {
      const item = getReq.result as CachedMessage | undefined;
      if (item) {
        item.body = body;
        const putReq = store.put(item);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error);
      } else {
        const putReq = store.put({
          id: messageId,
          mailbox_id: mailboxId,
          message_seq: body.message_seq || 0,
          metadata: { id: messageId, mailbox_id: mailboxId, message_seq: body.message_seq || 0 } as any,
          body: body,
          cached_at: Date.now(),
        });
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error);
      }
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

/**
 * Retrieves the cached ciphertext body for a message.
 */
export async function getCachedMessageBody(
  messageId: string,
): Promise<MessageBodyResponse | undefined> {
  const db = await openOfflineDB();
  const tx = db.transaction("messages", "readonly");
  const store = tx.objectStore("messages");

  return new Promise((resolve, reject) => {
    const req = store.get(messageId);
    req.onsuccess = () => {
      const item = req.result as CachedMessage | undefined;
      resolve(item?.body);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Returns cached inbox messages for a mailbox, sorted newest first (max 50).
 */
export async function getCachedInbox(mailboxId: string): Promise<MessageMetadata[]> {
  const db = await openOfflineDB();
  const tx = db.transaction("messages", "readonly");
  const store = tx.objectStore("messages");
  const index = store.index("mailbox_id");

  return new Promise((resolve, reject) => {
    const req = index.getAll(mailboxId);
    req.onsuccess = () => {
      const items = (req.result as CachedMessage[]) || [];
      // Sort newest sequence / date first
      items.sort((a, b) => (b.message_seq || 0) - (a.message_seq || 0));
      resolve(items.slice(0, 50).map((i) => i.metadata));
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Prunes messages older than the top maxMessages for the mailbox.
 */
export async function pruneOldCache(mailboxId: string, maxMessages = 50): Promise<void> {
  const db = await openOfflineDB();
  const tx = db.transaction("messages", "readwrite");
  const store = tx.objectStore("messages");
  const index = store.index("mailbox_id");

  return new Promise((resolve, reject) => {
    const req = index.getAll(mailboxId);
    req.onsuccess = () => {
      const items = (req.result as CachedMessage[]) || [];
      if (items.length <= maxMessages) {
        resolve();
        return;
      }

      // Sort newest first
      items.sort((a, b) => (b.message_seq || 0) - (a.message_seq || 0));
      const toDelete = items.slice(maxMessages);

      if (toDelete.length === 0) {
        resolve();
        return;
      }

      let remaining = toDelete.length;
      for (const item of toDelete) {
        const delReq = store.delete(item.id);
        delReq.onsuccess = () => {
          remaining--;
          if (remaining === 0) resolve();
        };
        delReq.onerror = () => reject(delReq.error);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Saves a draft to IndexedDB drafts store when offline.
 */
export async function saveOfflineDraft(draft: CachedDraft): Promise<void> {
  const db = await openOfflineDB();
  const tx = db.transaction("drafts", "readwrite");
  const store = tx.objectStore("drafts");
  return new Promise((resolve, reject) => {
    const req = store.put(draft);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Retrieves cached offline drafts.
 */
export async function getOfflineDrafts(mailboxId?: string): Promise<CachedDraft[]> {
  const db = await openOfflineDB();
  const tx = db.transaction("drafts", "readonly");
  const store = tx.objectStore("drafts");
  return new Promise((resolve, reject) => {
    const req = mailboxId ? store.index("mailbox_id").getAll(mailboxId) : store.getAll();
    req.onsuccess = () => resolve((req.result as CachedDraft[]) || []);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Removes a draft from IndexedDB drafts store.
 */
export async function removeOfflineDraft(draftId: string): Promise<void> {
  const db = await openOfflineDB();
  const tx = db.transaction("drafts", "readwrite");
  const store = tx.objectStore("drafts");
  return new Promise((resolve, reject) => {
    const req = store.delete(draftId);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Clears all stores in byos-offline on logout.
 */
export async function clearOfflineCache(): Promise<void> {
  const db = await openOfflineDB();
  const tx = db.transaction(["messages", "send_queue", "drafts"], "readwrite");
  const req1 = tx.objectStore("messages").clear();
  const req2 = tx.objectStore("send_queue").clear();
  const req3 = tx.objectStore("drafts").clear();

  return new Promise((resolve, reject) => {
    let remaining = 3;
    const checkDone = () => {
      remaining--;
      if (remaining === 0) resolve();
    };
    req1.onsuccess = checkDone;
    req2.onsuccess = checkDone;
    req3.onsuccess = checkDone;
    req1.onerror = () => reject(req1.error);
    req2.onerror = () => reject(req2.error);
    req3.onerror = () => reject(req3.error);
  });
}
