/**
 * BYOS Calendar - Category 15: Deleted-Event Trash & Restoration Subsystem
 * 
 * Provides persistent 30-day trash storage for deleted calendar events,
 * allowing full restoration, permanent deletion, and empty trash operations.
 */

import { DecryptedEventRecord } from "../CalendarSidebar";

export interface TrashEventRecord {
  trashId: string;
  originalEventId: string;
  mailboxId: string;
  calendarId: string;
  calendarName: string;
  deletedAt: string; // ISO 8601
  expiresAt: string; // ISO 8601 (30 days retention)
  event: DecryptedEventRecord;
}

const TRASH_STORAGE_PREFIX = "byos_calendar_trash_";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function getTrashKey(mailboxId: string): string {
  return `${TRASH_STORAGE_PREFIX}${mailboxId}`;
}

/**
 * Loads all trash records for a mailbox, cleaning up expired records.
 */
export function getTrashEvents(mailboxId: string): TrashEventRecord[] {
  if (typeof window === "undefined" || !mailboxId) return [];
  try {
    const raw = localStorage.getItem(getTrashKey(mailboxId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const now = Date.now();
    // Filter out expired events (> 30 days)
    const valid = parsed.filter((item: TrashEventRecord) => {
      const exp = new Date(item.expiresAt).getTime();
      return exp > now;
    });

    if (valid.length !== parsed.length) {
      persistTrash(mailboxId, valid);
    }

    return valid;
  } catch (err) {
    console.warn("[calendarTrashStore] Failed to load trash items:", err);
    return [];
  }
}

/**
 * Persists trash records and dispatches update notification.
 */
function persistTrash(mailboxId: string, items: TrashEventRecord[]): void {
  if (typeof window === "undefined" || !mailboxId) return;
  try {
    localStorage.setItem(getTrashKey(mailboxId), JSON.stringify(items));
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
      try {
        const CEvent = (window as any).CustomEvent || (window as any).Event || CustomEvent;
        window.dispatchEvent(new CEvent("byos_calendar_trash_updated"));
      } catch {
        // Non-browser or JSDOM realm mismatch fallback
      }
    }
  } catch (err) {
    console.warn("[calendarTrashStore] Failed to persist trash items:", err);
  }
}

/**
 * Moves a deleted event into the trash bin with 30-day retention countdown.
 */
export function moveEventToTrash(
  mailboxId: string,
  event: DecryptedEventRecord,
  calendarName: string = "Personal"
): TrashEventRecord {
  const current = getTrashEvents(mailboxId);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + THIRTY_DAYS_MS);

  const trashId = `trash-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // Store serializable copy of DecryptedEventRecord
  const serializableEvent: DecryptedEventRecord = {
    ...event,
    startTime: new Date(event.startTime),
    endTime: new Date(event.endTime),
  };

  const record: TrashEventRecord = {
    trashId,
    originalEventId: event.id,
    mailboxId,
    calendarId: event.calendarId,
    calendarName,
    deletedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    event: serializableEvent,
  };

  // Remove previous trash version of this event if any
  const filtered = current.filter((i) => i.originalEventId !== event.id);
  filtered.unshift(record);
  persistTrash(mailboxId, filtered);

  return record;
}

/**
 * Removes an event from trash for restoration. Returns the restored record.
 */
export function restoreEventFromTrash(mailboxId: string, trashId: string): TrashEventRecord | null {
  const current = getTrashEvents(mailboxId);
  const target = current.find((i) => i.trashId === trashId);
  if (!target) return null;

  const remaining = current.filter((i) => i.trashId !== trashId);
  persistTrash(mailboxId, remaining);

  return {
    ...target,
    event: {
      ...target.event,
      startTime: new Date(target.event.startTime),
      endTime: new Date(target.event.endTime),
    },
  };
}

/**
 * Permanently removes an event from trash.
 */
export function deletePermanentlyFromTrash(mailboxId: string, trashId: string): void {
  const current = getTrashEvents(mailboxId);
  const remaining = current.filter((i) => i.trashId !== trashId);
  persistTrash(mailboxId, remaining);
}

/**
 * Empties all items from the trash bin.
 */
export function emptyTrash(mailboxId: string): void {
  if (typeof window === "undefined" || !mailboxId) return;
  localStorage.removeItem(getTrashKey(mailboxId));
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    try {
      const CEvent = (window as any).CustomEvent || (window as any).Event || CustomEvent;
      window.dispatchEvent(new CEvent("byos_calendar_trash_updated"));
    } catch {
      // Non-browser or JSDOM realm mismatch fallback
    }
  }
}

/**
 * Cleans up expired trash items.
 */
export function cleanupExpiredTrash(mailboxId: string): void {
  getTrashEvents(mailboxId); // automatically purges during load
}
