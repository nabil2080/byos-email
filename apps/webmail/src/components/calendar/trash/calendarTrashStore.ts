/**
 * BYOS Calendar - Category 15: Deleted-Event Trash & Restoration Subsystem
 * 
 * Provides persistent 30-day trash storage for deleted calendar events,
 * with AES-GCM zero-knowledge encryption under `byos_calendar_trash_<mailboxId>`,
 * allowing full restoration, permanent deletion, and empty trash operations.
 */

import { DecryptedEventRecord } from "../CalendarSidebar";
import type { CalendarEventPlaintext } from "../../../calendar_crypto";
import { getMailboxKeyFor } from "../../../session_isolation";
import * as WasmCore from "../../../generated/crypto-core/byos_crypto_core.js";
import { bytesToHex, hexToBytes } from "../../../attachment_crypto";
import { base64ToBytes, bytesToBase64 } from "../../../message_crypto";

export interface TrashEventRecord {
  trashId: string;
  originalEventId: string;
  mailboxId: string;
  calendarId: string;
  calendarName: string;
  deletedAt: string; // ISO 8601
  expiresAt: string; // ISO 8601 (30 days retention)
  event: DecryptedEventRecord;
  encryptedDetails?: string; // AES-GCM Base64 envelope
}

const TRASH_STORAGE_PREFIX = "byos_calendar_trash_";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
export const MAX_TRASH_RECORDS = 200;
const TRASH_AAD_PREFIX = "byos-calendar-trash-v1";

function getTrashKey(mailboxId: string): string {
  return `${TRASH_STORAGE_PREFIX}${mailboxId}`;
}

function resolveTrashKey(mailboxId: string, key?: Uint8Array | null): Uint8Array | null {
  if (key && key instanceof Uint8Array && key.length === 32) {
    return key;
  }
  return getMailboxKeyFor(mailboxId);
}

function encryptTrashDetails(
  mailboxKey: Uint8Array,
  mailboxId: string,
  details: CalendarEventPlaintext
): string | null {
  if (!WasmCore || typeof WasmCore.wasm_aes_gcm_encrypt !== "function") {
    return null;
  }
  try {
    const jsonBytes = new TextEncoder().encode(JSON.stringify(details));
    const aadHex = bytesToHex(new TextEncoder().encode(`${TRASH_AAD_PREFIX}:${mailboxId}`));
    const envHex = WasmCore.wasm_aes_gcm_encrypt(
      bytesToHex(mailboxKey),
      bytesToHex(jsonBytes),
      aadHex
    );
    return bytesToBase64(hexToBytes(envHex));
  } catch (err) {
    console.warn("[calendarTrashStore] Failed to encrypt trash details with WASM AES-GCM:", err);
    return null;
  }
}

function decryptTrashDetails(
  mailboxKey: Uint8Array,
  mailboxId: string,
  ciphertextB64: string
): CalendarEventPlaintext | null {
  if (!WasmCore || typeof WasmCore.wasm_aes_gcm_decrypt !== "function") {
    return null;
  }
  try {
    const rawBytes = base64ToBytes(ciphertextB64);
    const aadHex = bytesToHex(new TextEncoder().encode(`${TRASH_AAD_PREFIX}:${mailboxId}`));
    const decHex = WasmCore.wasm_aes_gcm_decrypt(
      bytesToHex(mailboxKey),
      bytesToHex(rawBytes),
      aadHex
    );
    const jsonStr = new TextDecoder().decode(hexToBytes(decHex));
    return JSON.parse(jsonStr) as CalendarEventPlaintext;
  } catch (err) {
    console.warn("[calendarTrashStore] Failed to decrypt trash details with WASM AES-GCM:", err);
    return null;
  }
}

/**
 * Loads all trash records for a mailbox, cleaning up expired records.
 * Decrypts AES-GCM encrypted event details using active mailbox key when available.
 */
export function getTrashEvents(mailboxId: string, mailboxKey?: Uint8Array | null): TrashEventRecord[] {
  if (typeof window === "undefined" || !mailboxId) return [];
  try {
    const raw = localStorage.getItem(getTrashKey(mailboxId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const now = Date.now();
    const activeKey = resolveTrashKey(mailboxId, mailboxKey);

    // Filter out expired events (> 30 days)
    const valid = parsed.filter((item: TrashEventRecord) => {
      const exp = new Date(item.expiresAt).getTime();
      return exp > now;
    });

    if (valid.length !== parsed.length) {
      persistTrash(mailboxId, valid);
    }

    return valid.map((item: TrashEventRecord) => {
      let details = item.event?.details;
      if (item.encryptedDetails) {
        if (activeKey) {
          const dec = decryptTrashDetails(activeKey, mailboxId, item.encryptedDetails);
          if (dec) {
            details = dec;
          }
        } else {
          details = {
            title: "(Encrypted Trash Event - Key Required)",
            description: "",
            location: "",
            meetingUrl: "",
            attendees: [],
            reminders: [],
            timezone: item.event?.details?.timezone || "UTC",
          };
        }
      }

      return {
        ...item,
        event: {
          ...item.event,
          startTime: new Date(item.event.startTime),
          endTime: new Date(item.event.endTime),
          details,
        },
      };
    });
  } catch (err) {
    console.warn("[calendarTrashStore] Failed to load trash items:", err);
    return [];
  }
}

/**
 * Persists trash records and dispatches update notification.
 * Strips plaintext sensitive fields from local storage when encryptedDetails is present.
 */
function persistTrash(mailboxId: string, items: TrashEventRecord[]): void {
  if (typeof window === "undefined" || !mailboxId) return;
  const key = getTrashKey(mailboxId);
  const boundedItems = items.slice(0, MAX_TRASH_RECORDS);

  // Redact plaintext sensitive fields before persisting to localStorage
  const sanitizedForStorage = boundedItems.map((item) => {
    if (item.encryptedDetails) {
      return {
        ...item,
        event: {
          ...item.event,
          details: {
            title: "(Encrypted Trash Event)",
            description: "",
            location: "",
            meetingUrl: "",
            attendees: [],
            reminders: [],
            timezone: item.event?.details?.timezone || "UTC",
          },
        },
      };
    }
    return item;
  });

  try {
    localStorage.setItem(key, JSON.stringify(sanitizedForStorage));
  } catch (err: any) {
    console.warn("[calendarTrashStore] Storage quota warning, pruning oldest trash items:", err);
    try {
      const pruned = sanitizedForStorage.slice(0, Math.floor(sanitizedForStorage.length / 2));
      localStorage.setItem(key, JSON.stringify(pruned));
    } catch (fallbackErr) {
      console.error("[calendarTrashStore] Failed to persist trash even after pruning:", fallbackErr);
    }
  }

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
 * Moves a deleted event into the trash bin with 30-day retention countdown.
 * Automatically encrypts details with AES-GCM when the active mailbox key is available.
 */
export function moveEventToTrash(
  mailboxId: string,
  event: DecryptedEventRecord,
  calendarName: string = "Personal",
  mailboxKey?: Uint8Array | null
): TrashEventRecord {
  const current = getTrashEvents(mailboxId, mailboxKey);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + THIRTY_DAYS_MS);

  const trashId = `trash-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  // Store serializable copy of DecryptedEventRecord
  // Strip oversized base64 data URIs in attachments to preserve local storage bounds
  const sanitizedDetails = { ...event.details };
  if (sanitizedDetails.attachments && sanitizedDetails.attachments.length > 0) {
    sanitizedDetails.attachments = sanitizedDetails.attachments.map((att) => ({
      ...att,
      url: att.url && att.url.length > 2000 ? att.url.slice(0, 2000) : att.url,
    }));
  }

  const activeKey = resolveTrashKey(mailboxId, mailboxKey);
  let encryptedDetails: string | undefined;

  if (activeKey) {
    const enc = encryptTrashDetails(activeKey, mailboxId, sanitizedDetails);
    if (enc) {
      encryptedDetails = enc;
    }
  }

  const serializableEvent: DecryptedEventRecord = {
    ...event,
    startTime: new Date(event.startTime),
    endTime: new Date(event.endTime),
    details: sanitizedDetails,
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
    encryptedDetails,
  };

  // Remove previous trash version of this event if any
  const filtered = current.filter((i) => i.originalEventId !== event.id);
  // Cap at MAX_TRASH_RECORDS - 1 before unshifting
  if (filtered.length >= MAX_TRASH_RECORDS) {
    filtered.splice(MAX_TRASH_RECORDS - 1);
  }
  filtered.unshift(record);
  persistTrash(mailboxId, filtered);

  return record;
}

/**
 * Removes an event from trash for restoration. Returns the restored record with decrypted details.
 */
export function restoreEventFromTrash(
  mailboxId: string,
  trashId: string,
  mailboxKey?: Uint8Array | null
): TrashEventRecord | null {
  const current = getTrashEvents(mailboxId, mailboxKey);
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
export function cleanupExpiredTrash(mailboxId: string, mailboxKey?: Uint8Array | null): void {
  getTrashEvents(mailboxId, mailboxKey); // automatically purges during load
}
