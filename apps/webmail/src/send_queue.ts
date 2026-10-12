import { openOfflineDB, type QueuedSendItem } from "./offline_cache";
import { sendInternal, type InternalSendRequest } from "./api";
import { isOffline } from "./offline";

function generateUUID(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback UUID v4
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export interface EnqueueSendInput {
  client_queue_id?: string;
  mailbox_id: string;
  recipient: string;
  payload: QueuedSendItem["payload"];
  is_path_a: boolean;
}

/**
 * Enqueues a message for local sending when offline.
 */
export async function enqueueSend(input: EnqueueSendInput): Promise<string> {
  const db = await openOfflineDB();
  const queueId = input.client_queue_id || generateUUID();

  const item: QueuedSendItem = {
    client_queue_id: queueId,
    mailbox_id: input.mailbox_id,
    recipient: input.recipient,
    payload: input.payload,
    is_path_a: input.is_path_a,
    status: "pending",
    created_at: Date.now(),
    attempts: 0,
  };

  const tx = db.transaction("send_queue", "readwrite");
  const store = tx.objectStore("send_queue");

  await new Promise<void>((resolve, reject) => {
    const req = store.put(item);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });

  return queueId;
}

/**
 * Returns all pending queue items in FIFO order (oldest first).
 */
export async function getPendingQueue(mailboxId?: string): Promise<QueuedSendItem[]> {
  const db = await openOfflineDB();
  const tx = db.transaction("send_queue", "readonly");
  const store = tx.objectStore("send_queue");

  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => {
      let items = (req.result as QueuedSendItem[]) || [];
      items = items.filter((i) => i.status === "pending" || i.status === "sending");
      if (mailboxId) {
        items = items.filter((i) => i.mailbox_id === mailboxId);
      }
      items.sort((a, b) => a.created_at - b.created_at);
      resolve(items);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Removes an item from the queue after successful delivery.
 */
export async function removeFromQueue(clientQueueId: string): Promise<void> {
  const db = await openOfflineDB();
  const tx = db.transaction("send_queue", "readwrite");
  const store = tx.objectStore("send_queue");

  return new Promise((resolve, reject) => {
    const req = store.delete(clientQueueId);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Marks a queued item as permanently failed.
 */
export async function markFailed(clientQueueId: string, error: string): Promise<void> {
  const db = await openOfflineDB();
  const tx = db.transaction("send_queue", "readwrite");
  const store = tx.objectStore("send_queue");

  const getReq = store.get(clientQueueId);
  await new Promise<void>((resolve, reject) => {
    getReq.onsuccess = () => {
      const item = getReq.result as QueuedSendItem | undefined;
      if (item) {
        item.status = "failed";
        item.error = error;
        const putReq = store.put(item);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error);
      } else {
        resolve();
      }
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

export interface ReplayQueueDeps {
  sendInternal?: (req: InternalSendRequest, token?: string) => Promise<any>;
  sendOutbound?: (req: any, token?: string) => Promise<any>;
  getToken?: (mailboxId: string) => string | undefined;
}

let isReplaying = false;

/**
 * Replays all pending sends in FIFO order upon reconnect.
 * Deduplicated on server via client_queue_id (Directive D5).
 */
export async function replayQueue(deps?: ReplayQueueDeps): Promise<{ sent: number; failed: number }> {
  if (isReplaying) {
    return { sent: 0, failed: 0 };
  }
  isReplaying = true;
  try {
    const pending = await getPendingQueue();
    let sentCount = 0;
    let failedCount = 0;

    const sendInternalFn = deps?.sendInternal || sendInternal;

    for (const item of pending) {
    const token = deps?.getToken ? deps.getToken(item.mailbox_id) : undefined;
    try {
      if (item.is_path_a) {
        const req: InternalSendRequest = {
          envelope_json: item.payload.envelope_json || "",
          sender_envelope_json: item.payload.sender_envelope_json,
          recipient: item.recipient,
          sender_mailbox_id: item.mailbox_id,
          attachment_envelopes: item.payload.attachment_envelopes,
          sender_attachment_envelopes: item.payload.sender_attachment_envelopes,
          alias_id: item.payload.alias_id,
          sender_email: item.payload.sender_email,
          client_queue_id: item.client_queue_id,
        };
        await sendInternalFn(req, token);
        await removeFromQueue(item.client_queue_id);
        sentCount++;
      } else {
        // Path B outbound
        if (deps?.sendOutbound) {
          await deps.sendOutbound(
            {
              ...item,
              ...item.payload,
              mailbox_id: item.mailbox_id,
              recipient: item.recipient,
              client_queue_id: item.client_queue_id,
              payload: item.payload,
            },
            token,
          );
          await removeFromQueue(item.client_queue_id);
          sentCount++;
        } else {
          // If no outbound sender provided, skip or fail
          await markFailed(item.client_queue_id, "Outbound sender not configured");
          failedCount++;
        }
      }
    } catch (err: any) {
      console.error(`[send_queue] Failed to replay item ${item.client_queue_id}:`, err);
      // If network error, stop replay so remaining items stay queued
      if (isOffline()) {
        break;
      }
      // If server rejected (4xx validation/recipient not found), mark failed
      if (err?.message?.includes("invalid") || err?.message?.includes("rejected")) {
        await markFailed(item.client_queue_id, err.message);
        failedCount++;
      } else {
        // Transient error - keep in queue
        break;
      }
    }
  }

  return { sent: sentCount, failed: failedCount };
  } finally {
    isReplaying = false;
  }
}
