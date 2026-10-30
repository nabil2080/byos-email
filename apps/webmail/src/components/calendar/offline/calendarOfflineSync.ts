/**
 * BYOS Calendar - Category 15: Offline and Synchronization Subsystem
 * 
 * Manages network connectivity states, offline event caching, and offline action queuing.
 * 
 * CORE INVARIANT:
 * Never claim an offline change is saved to the server before synchronization succeeds.
 * All queued edits remain strictly in "queued_locally" state until server synchronization
 * returns a verified 2xx response.
 */

import { DecryptedEventRecord } from "../CalendarSidebar";
import {
  CalendarEventItem,
  CreateCalendarEventInput,
  UpdateCalendarEventInput,
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
  createCalendarEventException,
  updateCalendarEventException,
  deleteCalendarEventException,
} from "../../../api";

export type OfflineActionType =
  | "create"
  | "update"
  | "delete"
  | "create_exception"
  | "update_exception"
  | "delete_exception";

export type OfflineSyncStatus = "queued_locally" | "syncing" | "synced" | "conflict";

export interface OfflineQueuedAction {
  queueId: string;
  actionType: OfflineActionType;
  mailboxId: string;
  calendarId: string;
  eventId?: string;
  exceptionId?: string;
  tempId?: string;
  payload?: any;
  queuedAt: string;
  syncStatus: OfflineSyncStatus;
  conflictReason?: string;
}

const QUEUE_STORAGE_PREFIX = "byos_calendar_offline_queue_";
const CACHE_STORAGE_PREFIX = "byos_calendar_offline_cache_";

function getQueueKey(mailboxId: string): string {
  return `${QUEUE_STORAGE_PREFIX}${mailboxId}`;
}

function getCacheKey(mailboxId: string): string {
  return `${CACHE_STORAGE_PREFIX}${mailboxId}`;
}

/**
 * Checks current browser network status.
 */
export function isBrowserOnline(): boolean {
  if (typeof navigator !== "undefined" && typeof navigator.onLine === "boolean") {
    return navigator.onLine;
  }
  return true;
}

/**
 * Loads all queued actions for a mailbox.
 */
export function getOfflineQueue(mailboxId: string): OfflineQueuedAction[] {
  if (typeof window === "undefined" || !mailboxId) return [];
  try {
    const raw = localStorage.getItem(getQueueKey(mailboxId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn("[calendarOfflineSync] Failed to load offline queue:", err);
    return [];
  }
}

/**
 * Persists queued actions to storage and notifies subscribers.
 */
function persistQueue(mailboxId: string, queue: OfflineQueuedAction[]): void {
  if (typeof window === "undefined" || !mailboxId) return;
  try {
    localStorage.setItem(getQueueKey(mailboxId), JSON.stringify(queue));
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
      try {
        const CEvent = (window as any).CustomEvent || (window as any).Event || CustomEvent;
        window.dispatchEvent(new CEvent("byos_offline_queue_updated"));
      } catch {
        // Non-browser or JSDOM realm mismatch fallback
      }
    }
  } catch (err) {
    console.warn("[calendarOfflineSync] Failed to persist offline queue:", err);
  }
}

/**
 * Enqueues an event modification while offline.
 * Status is strictly initialized to "queued_locally".
 */
export function enqueueOfflineAction(
  mailboxId: string,
  input: {
    actionType: OfflineActionType;
    calendarId: string;
    eventId?: string;
    exceptionId?: string;
    tempId?: string;
    payload?: any;
  }
): OfflineQueuedAction {
  const current = getOfflineQueue(mailboxId);
  const queueId = `queue-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const item: OfflineQueuedAction = {
    queueId,
    actionType: input.actionType,
    mailboxId,
    calendarId: input.calendarId,
    eventId: input.eventId,
    exceptionId: input.exceptionId,
    tempId: input.tempId,
    payload: input.payload,
    queuedAt: new Date().toISOString(),
    syncStatus: "queued_locally",
  };

  current.push(item);
  persistQueue(mailboxId, current);
  return item;
}

/**
 * Removes an item from the queue once synced.
 */
export function removeQueuedAction(mailboxId: string, queueId: string): void {
  const current = getOfflineQueue(mailboxId);
  const updated = current.filter((q) => q.queueId !== queueId);
  persistQueue(mailboxId, updated);
}

/**
 * Clears the offline queue for a mailbox.
 */
export function clearOfflineQueue(mailboxId: string): void {
  if (typeof window === "undefined" || !mailboxId) return;
  localStorage.removeItem(getQueueKey(mailboxId));
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    try {
      const CEvent = (window as any).CustomEvent || (window as any).Event || CustomEvent;
      window.dispatchEvent(new CEvent("byos_offline_queue_updated"));
    } catch {
      // Non-browser or JSDOM realm mismatch fallback
    }
  }
}

/**
 * Caches decrypted events locally so they can be viewed offline.
 */
export function cacheDecryptedEvents(mailboxId: string, events: DecryptedEventRecord[]): void {
  if (typeof window === "undefined" || !mailboxId) return;
  try {
    // Only cache regular calendar events (not transient occurrences or temporary items)
    const baseEvents = events.filter((e) => !e.isOccurrence);
    localStorage.setItem(getCacheKey(mailboxId), JSON.stringify(baseEvents));
  } catch (err) {
    console.warn("[calendarOfflineSync] Failed to cache decrypted events:", err);
  }
}

/**
 * Retrieves cached decrypted events for offline viewing.
 */
export function getCachedDecryptedEvents(mailboxId: string): DecryptedEventRecord[] {
  if (typeof window === "undefined" || !mailboxId) return [];
  try {
    const raw = localStorage.getItem(getCacheKey(mailboxId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((e: any) => ({
      ...e,
      startTime: new Date(e.startTime),
      endTime: new Date(e.endTime),
    }));
  } catch (err) {
    console.warn("[calendarOfflineSync] Failed to load cached decrypted events:", err);
    return [];
  }
}

export interface SyncResult {
  synced: number;
  conflicts: number;
  errors: number;
  remaining: number;
}

/**
 * Synchronizes queued offline edits with the server.
 * Evaluates conflict detection against known remote records.
 */
export async function syncOfflineQueue(
  mailboxId: string,
  options?: {
    remoteEvents?: CalendarEventItem[];
    createFn?: (mailboxId: string, data: CreateCalendarEventInput) => Promise<CalendarEventItem>;
    updateFn?: (mailboxId: string, eventId: string, data: UpdateCalendarEventInput) => Promise<CalendarEventItem>;
    deleteFn?: (mailboxId: string, eventId: string) => Promise<void>;
    createExceptionFn?: (mailboxId: string, eventId: string, payload: any) => Promise<any>;
    updateExceptionFn?: (mailboxId: string, eventId: string, exceptionId: string, payload: any) => Promise<any>;
    deleteExceptionFn?: (mailboxId: string, eventId: string, exceptionId: string) => Promise<void>;
  }
): Promise<SyncResult> {
  const queue = getOfflineQueue(mailboxId);
  if (queue.length === 0) {
    return { synced: 0, conflicts: 0, errors: 0, remaining: 0 };
  }

  const createFn = options?.createFn || createCalendarEvent;
  const updateFn = options?.updateFn || updateCalendarEvent;
  const deleteFn = options?.deleteFn || deleteCalendarEvent;
  const createExceptionFn = options?.createExceptionFn || createCalendarEventException;
  const updateExceptionFn = options?.updateExceptionFn || updateCalendarEventException;
  const deleteExceptionFn = options?.deleteExceptionFn || deleteCalendarEventException;
  const remoteList = options?.remoteEvents || [];

  let synced = 0;
  let conflicts = 0;
  let errors = 0;

  for (const item of [...queue]) {
    try {
      item.syncStatus = "syncing";

      if (item.actionType === "create") {
        await createFn(mailboxId, item.payload);
        removeQueuedAction(mailboxId, item.queueId);
        synced++;
      } else if (item.actionType === "update" && item.eventId) {
        // Conflict detection: verify remote event has not been modified after local queue time
        const remoteMatch = remoteList.find((r) => r.id === item.eventId);
        if (remoteMatch && remoteMatch.updated_at) {
          const remoteUpdated = new Date(remoteMatch.updated_at).getTime();
          const queuedTime = new Date(item.queuedAt).getTime();
          if (remoteUpdated > queuedTime) {
            // Remote event was modified concurrently
            item.syncStatus = "conflict";
            item.conflictReason = "Event was modified on the server while you were offline.";
            persistQueue(mailboxId, queue);
            conflicts++;
            continue;
          }
        }

        await updateFn(mailboxId, item.eventId, item.payload);
        removeQueuedAction(mailboxId, item.queueId);
        synced++;
      } else if (item.actionType === "delete" && item.eventId) {
        await deleteFn(mailboxId, item.eventId);
        removeQueuedAction(mailboxId, item.queueId);
        synced++;
      } else if (item.actionType === "create_exception" && item.eventId) {
        await createExceptionFn(mailboxId, item.eventId, item.payload);
        removeQueuedAction(mailboxId, item.queueId);
        synced++;
      } else if (item.actionType === "update_exception" && item.eventId) {
        const exId = item.exceptionId || item.payload?.exceptionId;
        if (!exId) {
          throw new Error("Missing exceptionId for update_exception action");
        }
        await updateExceptionFn(mailboxId, item.eventId, exId, item.payload);
        removeQueuedAction(mailboxId, item.queueId);
        synced++;
      } else if (item.actionType === "delete_exception" && item.eventId) {
        const exId = item.exceptionId || item.payload?.exceptionId;
        if (!exId) {
          throw new Error("Missing exceptionId for delete_exception action");
        }
        await deleteExceptionFn(mailboxId, item.eventId, exId);
        removeQueuedAction(mailboxId, item.queueId);
        synced++;
      }
    } catch (err: any) {
      console.warn(`[calendarOfflineSync] Sync failed for action ${item.actionType}:`, err);
      item.syncStatus = "queued_locally";
      item.conflictReason = err?.message || "Sync failed";
      persistQueue(mailboxId, queue);
      errors++;
    }
  }

  const remainingQueue = getOfflineQueue(mailboxId);
  return {
    synced,
    conflicts,
    errors,
    remaining: remainingQueue.length,
  };
}
