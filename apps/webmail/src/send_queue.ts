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
 * Marks a queued item as permanently failed while preserving payload and attachment data.
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
        item.attempts = (item.attempts || 0) + 1;
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

/**
 * Records a transient send attempt without marking the item permanently failed.
 */
export async function recordTransientAttempt(
  clientQueueId: string,
  error?: string,
  nextRetryAt?: number,
): Promise<void> {
  const db = await openOfflineDB();
  const tx = db.transaction("send_queue", "readwrite");
  const store = tx.objectStore("send_queue");

  const getReq = store.get(clientQueueId);
  await new Promise<void>((resolve, reject) => {
    getReq.onsuccess = () => {
      const item = getReq.result as QueuedSendItem | undefined;
      if (item) {
        item.status = "pending";
        item.attempts = (item.attempts || 0) + 1;
        if (error) item.error = error;
        if (nextRetryAt !== undefined) {
          item.next_retry_at = nextRetryAt;
        }
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

/**
 * Returns all failed queue items.
 */
export async function getFailedQueue(mailboxId?: string): Promise<QueuedSendItem[]> {
  const db = await openOfflineDB();
  const tx = db.transaction("send_queue", "readonly");
  const store = tx.objectStore("send_queue");

  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => {
      let items = (req.result as QueuedSendItem[]) || [];
      items = items.filter((i) => i.status === "failed");
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
 * Returns all queue items (pending, sending, failed).
 */
export async function getAllQueuedSends(mailboxId?: string): Promise<QueuedSendItem[]> {
  const db = await openOfflineDB();
  const tx = db.transaction("send_queue", "readonly");
  const store = tx.objectStore("send_queue");

  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => {
      let items = (req.result as QueuedSendItem[]) || [];
      if (mailboxId) {
        items = items.filter((i) => i.mailbox_id === mailboxId);
      }
      items.sort((a, b) => a.created_at - b.created_at);
      resolve(items);
    };
    req.onerror = () => reject(req.error);
  });
}

export interface ReplayQueueDeps {
  sendInternal?: (req: InternalSendRequest, token?: string) => Promise<any>;
  sendOutbound?: (req: any, token?: string) => Promise<any>;
  getToken?: (mailboxId: string) => string | undefined;
}

export interface ReplayResult {
  sent: number;
  failed: number;
  pending: number;
  errors?: Array<{ clientQueueId: string; error: string; permanent: boolean }>;
}

export function isAuthSendError(err: any): boolean {
  if (!err) return false;
  const status = typeof err.status === "number" ? err.status : undefined;
  if (status === 401) return true;
  const msg = String(err.message || err || "").toLowerCase();
  const code = String(err.code || "").toLowerCase();
  if (code === "unauthorized" || code === "session_expired") return true;
  if (
    msg.includes("unauthorized") ||
    msg.includes("session expired") ||
    msg.includes("token expired") ||
    msg.includes("authentication required") ||
    msg.includes("invalid token")
  ) {
    return true;
  }
  if (status === 403 && (msg.includes("session") || msg.includes("csrf") || msg.includes("token"))) {
    return true;
  }
  return false;
}

export function isPermanentSendError(err: any): boolean {
  if (!err) return false;

  // Authentication/session expiration errors are NOT permanent message defects.
  // They are retained as pending until the user re-authenticates.
  if (isAuthSendError(err)) {
    return false;
  }

  const status = typeof err.status === "number" ? err.status : undefined;
  if (status !== undefined) {
    // 408 (Timeout) and 429 (Too Many Requests / Rate limit) are recoverable failures
    if (status === 408 || status === 429) {
      return false;
    }
    // 5xx server errors are transient / recoverable
    if (status >= 500) {
      return false;
    }
    // 400 (Bad Request), 404 (Not Found), 413 (Payload Too Large), 422 (Unprocessable) are permanent client errors.
    // 409 (Conflict): Stale-key or expired-epoch errors cannot be retried without the caller's recovery procedure.
    // Do not automatically retry stale-key or expired-epoch errors in a background loop.
    if (status >= 400 && status < 500) {
      return true;
    }
  }

  const msg = String(err.message || err || "").toLowerCase();
  if (
    msg.includes("invalid") ||
    msg.includes("rejected") ||
    msg.includes("not found") ||
    msg.includes("attachment_not_found") ||
    msg.includes("outbound_attachment_limit_exceeded") ||
    msg.includes("limit exceeded") ||
    msg.includes("cannot send without attachments") ||
    msg.includes("missing protocol v2 metadata") ||
    msg.includes("incomplete")
  ) {
    return true;
  }
  return false;
}

export function isNetworkSendError(err: any): boolean {
  if (isOffline()) return true;
  if (!err) return false;
  const msg = String(err.message || err || "").toLowerCase();
  return (
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("network error") ||
    msg.includes("offline") ||
    msg.includes("enotfound") ||
    msg.includes("econnrefused") ||
    err.name === "AbortError"
  );
}

/**
 * Safely retries a specific queued item by resetting its status to "pending"
 * and executing replayQueue.
 */
export async function retryQueuedSend(
  clientQueueId: string,
  deps?: ReplayQueueDeps,
): Promise<{ success: boolean; error?: string }> {
  const db = await openOfflineDB();
  const tx = db.transaction("send_queue", "readwrite");
  const store = tx.objectStore("send_queue");

  const item = await new Promise<QueuedSendItem | undefined>((resolve, reject) => {
    const req = store.get(clientQueueId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  if (!item) {
    return { success: false, error: "Queued message not found" };
  }

  item.status = "pending";
  delete item.error;
  delete item.next_retry_at;
  await new Promise<void>((resolve, reject) => {
    const req = store.put(item);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });

  const res = await replayQueue(deps);
  if (res.sent > 0) {
    return { success: true };
  }

  const updated = await new Promise<QueuedSendItem | undefined>((resolve, reject) => {
    const req = store.get(clientQueueId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return { success: false, error: updated?.error || "Retry failed" };
}

/**
 * Safely resets all permanently failed items to "pending" and triggers replayQueue.
 */
export async function retryFailedSends(
  deps?: ReplayQueueDeps,
): Promise<ReplayResult> {
  const db = await openOfflineDB();
  const tx = db.transaction("send_queue", "readwrite");
  const store = tx.objectStore("send_queue");

  await new Promise<void>((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => {
      const items = (req.result as QueuedSendItem[]) || [];
      for (const item of items) {
        if (item.status === "failed") {
          item.status = "pending";
          delete item.error;
          delete item.next_retry_at;
          store.put(item);
        }
      }
      resolve();
    };
    req.onerror = () => reject(req.error);
  });

  return replayQueue(deps);
}

let isReplaying = false;

/**
 * Replays all pending sends in FIFO order upon reconnect.
 * Distinguishes permanent 4xx failures (marked 'failed' and preserved)
 * from recoverable network or temporary 5xx errors (retained as 'pending').
 * Deduplicated on server via client_queue_id (Directive D5).
 */
export async function replayQueue(deps?: ReplayQueueDeps): Promise<ReplayResult> {
  if (isReplaying) {
    const pendingNow = await getPendingQueue();
    return { sent: 0, failed: 0, pending: pendingNow.length, errors: [] };
  }
  isReplaying = true;
  try {
    const pending = await getPendingQueue();
    let sentCount = 0;
    let failedCount = 0;
    const errors: Array<{ clientQueueId: string; error: string; permanent: boolean }> = [];

    const sendInternalFn = deps?.sendInternal || sendInternal;

    const now = Date.now();
    for (const item of pending) {
      if (isOffline()) {
        break;
      }

      // Respect Retry-After: skip items whose scheduled next_retry_at is in the future
      if (item.next_retry_at && item.next_retry_at > now) {
        continue;
      }

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
            await markFailed(item.client_queue_id, "Outbound sender not configured");
            failedCount++;
            errors.push({ clientQueueId: item.client_queue_id, error: "Outbound sender not configured", permanent: true });
          }
        }
      } catch (err: any) {
        console.error(`[send_queue] Failed to replay item ${item.client_queue_id}:`, err);
        const errMessage = err?.message || String(err || "Unknown send error");

        // 1. Network disconnection or offline during replay
        if (isNetworkSendError(err)) {
          break;
        }

        // 2. Authentication error / session expired (HTTP 401 / session expiry)
        // Keep in queue as pending so user reauthentication can replay it, but halt current batch.
        if (isAuthSendError(err)) {
          await recordTransientAttempt(item.client_queue_id, "Session expired / Authentication required");
          errors.push({ clientQueueId: item.client_queue_id, error: errMessage, permanent: false });
          break;
        }

        // 3. Permanent client error (HTTP 400 validation, missing attachment, 404, unrecoverable 409)
        if (isPermanentSendError(err)) {
          await markFailed(item.client_queue_id, errMessage);
          failedCount++;
          errors.push({ clientQueueId: item.client_queue_id, error: errMessage, permanent: true });
          continue;
        }

        // 4. Temporary server failure (HTTP 5xx, timeout, 408, 429)
        let nextRetryAt: number | undefined;
        if (err?.status === 429 && typeof err?.retryAfter === "number" && err.retryAfter > 0) {
          nextRetryAt = Date.now() + err.retryAfter * 1000;
        }
        await recordTransientAttempt(item.client_queue_id, errMessage, nextRetryAt);
        errors.push({ clientQueueId: item.client_queue_id, error: errMessage, permanent: false });
        break;
      }
    }

    const remainingPending = await getPendingQueue();
    return {
      sent: sentCount,
      failed: failedCount,
      pending: remainingPending.length,
      errors,
    };
  } finally {
    isReplaying = false;
  }
}
