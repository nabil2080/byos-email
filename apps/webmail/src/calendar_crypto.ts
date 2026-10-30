import { bytesToHex, hexToBytes } from "./attachment_crypto";
import type * as WasmCore from "./generated/crypto-core/byos_crypto_core.js";
import { base64ToBytes, bytesToBase64, envelopeAadHex } from "./message_crypto";

export const CALENDAR_EVENT_AAD_PREFIX = "byos-calendar-event-v1";
export const CALENDAR_KEY_AAD = "byos-calendar-key-v1";

/**
 * Seals a 32-byte calendar encryption key for a recipient public key (X25519 HPKE).
 */
export function sealCalendarKeyForGrantee(
  wasm: typeof WasmCore,
  recipientPkHex: string,
  calendarKey: Uint8Array
): string {
  if (!wasm || typeof wasm.wasm_hpke_seal !== "function") {
    throw new Error("WASM crypto core unavailable for calendar key sealing");
  }
  if (!recipientPkHex || typeof recipientPkHex !== "string") {
    throw new Error("Invalid recipient public key for calendar key sealing");
  }
  if (!calendarKey || !(calendarKey instanceof Uint8Array) || calendarKey.length !== 32) {
    throw new Error("Invalid calendar key: 32 bytes required");
  }

  const aadHex = bytesToHex(new TextEncoder().encode(CALENDAR_KEY_AAD));
  const sealedHex = wasm.wasm_hpke_seal(recipientPkHex, bytesToHex(calendarKey), aadHex);
  return bytesToBase64(hexToBytes(sealedHex));
}

/**
 * Unseals a calendar encryption key using recipient private key (X25519 HPKE).
 */
export function unsealCalendarKeyForGrantee(
  wasm: typeof WasmCore,
  recipientSkHex: string,
  encryptedKeyB64: string
): Uint8Array {
  if (!wasm || typeof wasm.wasm_hpke_open !== "function") {
    throw new Error("WASM crypto core unavailable for calendar key unsealing");
  }
  if (!recipientSkHex || typeof recipientSkHex !== "string") {
    throw new Error("Invalid recipient private key for calendar key unsealing");
  }
  if (!encryptedKeyB64 || typeof encryptedKeyB64 !== "string") {
    throw new Error("Invalid encrypted calendar key");
  }

  const aadHex = bytesToHex(new TextEncoder().encode(CALENDAR_KEY_AAD));
  const rawBytes = base64ToBytes(encryptedKeyB64);
  const unsealedHex = wasm.wasm_hpke_open(recipientSkHex, bytesToHex(rawBytes), aadHex);
  const keyBytes = hexToBytes(unsealedHex);
  if (keyBytes.length !== 32) {
    throw new Error("Unsealed calendar key must be 32 bytes");
  }
  return keyBytes;
}

export interface CalendarAttendee {
  name?: string;
  email: string;
  status?: "accepted" | "declined" | "tentative" | "needs-action";
  isOrganizer?: boolean;
}

export interface CalendarReminder {
  minutesBefore: number; // e.g. 0 (at time), 5, 10, 15, 30, 60, 1440
  method?: "notification" | "email";
}

export interface CalendarGuestPermissions {
  modifyEvent?: boolean;
  inviteOthers?: boolean;
  seeGuestList?: boolean;
}

export interface CalendarAttachment {
  id: string;
  name: string;
  size: number;
  contentType: string;
  url?: string;
}

export type CalendarEventType = "default" | "focus_time" | "out_of_office" | "working_location";

export interface CalendarEventPlaintext {
  title: string;
  description?: string;
  location?: string;
  meetingUrl?: string;
  color?: string;
  visibility?: "default" | "public" | "private" | "confidential";
  eventType?: CalendarEventType;
  workingLocation?: "office" | "home" | "remote" | string;
  autoDeclineMode?: "none" | "new_invitations" | "all_invitations";
  autoDeclineMessage?: string;
  guestPermissions?: CalendarGuestPermissions;
  attachments?: CalendarAttachment[];
  attendees?: CalendarAttendee[];
  reminders?: CalendarReminder[];
  timezone?: string;
  uid?: string;
  sequence?: number;
  organizer?: { name?: string; email: string };
  myRsvpStatus?: "accepted" | "declined" | "tentative" | "needs-action";
  sourceEmailId?: string;
  sourceMessageSubject?: string;
  sourceCategory?: "flight" | "hotel" | "restaurant" | "ticket" | "event" | "other";
  sourceConfirmationCode?: string;
  sourceProvider?: string;
}

/**
 * Format classification for calendar event persistence payloads.
 * - 'aes-gcm-envelope': Valid authenticated Section 12 AES-GCM envelope
 * - 'legacy-plaintext-json': Unencrypted JSON payload (from legacy Base64 fallback)
 * - 'unknown': Empty, corrupted, or unrecognized payload
 */
export type CalendarPayloadFormat = "aes-gcm-envelope" | "legacy-plaintext-json" | "unknown";

/**
 * Non-destructive format identification helper.
 * Safely inspects payload header and byte structure without leaking private content or mutating state.
 */
export function classifyCalendarPayload(rawPayload: Uint8Array | string): CalendarPayloadFormat {
  let bytes: Uint8Array;
  if (typeof rawPayload === "string") {
    try {
      bytes = base64ToBytes(rawPayload);
    } catch {
      bytes = new TextEncoder().encode(rawPayload);
    }
  } else {
    bytes = rawPayload;
  }

  if (!bytes || bytes.length === 0) {
    return "unknown";
  }

  // Legacy Base64-fallback or plaintext JSON begins with ASCII '{' (0x7B)
  if (bytes[0] === 0x7b) {
    try {
      const text = new TextDecoder().decode(bytes);
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === "object") {
        return "legacy-plaintext-json";
      }
    } catch {
      // Not valid JSON
    }
  }

  // Standard Section 12 AES-GCM envelope: 12-byte IV + ciphertext + 16-byte tag (minimum 28 bytes)
  if (bytes.length >= 28 && bytes[0] !== 0x7b) {
    return "aes-gcm-envelope";
  }

  return "unknown";
}

/**
 * Encrypts event details to an opaque AES-GCM-256 base64 envelope keyed with mailbox_sk.
 * Fails closed immediately if key is missing, invalid length, mailbox ID missing, or WASM fails.
 * NEVER falls back to Base64, plaintext JSON, or unauthenticated encoding.
 */
export function encryptCalendarEventPayload(
  wasm: typeof WasmCore,
  mailboxKey: Uint8Array,
  mailboxId: string,
  details: CalendarEventPlaintext
): string {
  if (!mailboxKey || !(mailboxKey instanceof Uint8Array) || mailboxKey.length !== 32) {
    throw new Error("Invalid or missing mailbox encryption key for calendar event encryption");
  }
  if (!mailboxId || typeof mailboxId !== "string" || !mailboxId.trim()) {
    throw new Error("Missing or invalid mailbox ID for calendar event encryption");
  }
  if (!wasm || typeof wasm.wasm_aes_gcm_encrypt !== "function") {
    throw new Error("WASM crypto core unavailable for calendar event encryption");
  }
  if (!details || typeof details !== "object") {
    throw new Error("Invalid calendar event plaintext details");
  }

  let envelopeHex: string;
  try {
    envelopeHex = wasm.wasm_aes_gcm_encrypt(
      bytesToHex(mailboxKey),
      bytesToHex(new TextEncoder().encode(JSON.stringify(details))),
      envelopeAadHex(mailboxId, CALENDAR_EVENT_AAD_PREFIX)
    );
  } catch (err: any) {
    throw new Error(`WASM AES-GCM encryption failed: ${err?.message || "Encryption error"}`);
  }

  if (!envelopeHex || typeof envelopeHex !== "string" || envelopeHex.length < 56) {
    throw new Error("WASM AES-GCM encryption produced invalid envelope");
  }

  return bytesToBase64(hexToBytes(envelopeHex));
}

/**
 * Decrypts a stored event envelope.
 * Fails closed with safe fallback on tampering, key mismatch, or legacy unencrypted records.
 * NEVER interprets arbitrary plaintext or Base64 content as successfully decrypted event content.
 */
export function decryptCalendarEventPayload(
  wasm: typeof WasmCore,
  mailboxKey: Uint8Array,
  mailboxId: string,
  payloadB64: string
): CalendarEventPlaintext {
  const safeFallback: CalendarEventPlaintext = {
    title: "(Encrypted Event - Unable to Decrypt)",
    description: "",
    location: "",
    meetingUrl: "",
    attendees: [],
    reminders: [],
    timezone: "UTC",
  };

  if (!mailboxKey || !(mailboxKey instanceof Uint8Array) || mailboxKey.length !== 32) {
    return safeFallback;
  }
  if (!mailboxId || typeof mailboxId !== "string" || !mailboxId.trim()) {
    return safeFallback;
  }
  if (!payloadB64 || typeof payloadB64 !== "string" || !payloadB64.trim()) {
    return safeFallback;
  }
  if (!wasm || typeof wasm.wasm_aes_gcm_decrypt !== "function") {
    return safeFallback;
  }

  try {
    const rawBytes = base64ToBytes(payloadB64);
    // Defense-in-depth: Never interpret legacy Base64 JSON (starting with '{') as decrypted content
    if (rawBytes.length === 0 || rawBytes[0] === 0x7b) {
      console.warn("[calendar_crypto] Refusing to interpret unencrypted or legacy JSON payload as decrypted ciphertext");
      return safeFallback;
    }

    const plaintextHex = wasm.wasm_aes_gcm_decrypt(
      bytesToHex(mailboxKey),
      bytesToHex(rawBytes),
      envelopeAadHex(mailboxId, CALENDAR_EVENT_AAD_PREFIX)
    );
    const parsed = JSON.parse(new TextDecoder().decode(hexToBytes(plaintextHex))) as Partial<CalendarEventPlaintext>;
    return {
      title: typeof parsed.title === "string" && parsed.title.trim() ? parsed.title : "(Untitled Event)",
      description: typeof parsed.description === "string" ? parsed.description : "",
      location: typeof parsed.location === "string" ? parsed.location : "",
      meetingUrl: typeof parsed.meetingUrl === "string" ? parsed.meetingUrl : "",
      color: typeof parsed.color === "string" ? parsed.color : undefined,
      visibility: parsed.visibility,
      guestPermissions: parsed.guestPermissions,
      attachments: Array.isArray(parsed.attachments) ? parsed.attachments : undefined,
      attendees: Array.isArray(parsed.attendees) ? parsed.attendees : [],
      reminders: Array.isArray(parsed.reminders) ? parsed.reminders : [],
      timezone: typeof parsed.timezone === "string" ? parsed.timezone : "UTC",
      uid: typeof parsed.uid === "string" ? parsed.uid : undefined,
      sequence: typeof parsed.sequence === "number" ? parsed.sequence : undefined,
      organizer: parsed.organizer && typeof parsed.organizer.email === "string" ? parsed.organizer : undefined,
      myRsvpStatus: parsed.myRsvpStatus,
      eventType: parsed.eventType,
      workingLocation: parsed.workingLocation,
      autoDeclineMode: parsed.autoDeclineMode,
      autoDeclineMessage: parsed.autoDeclineMessage,
    };
  } catch (e) {
    console.warn("[calendar_crypto] Decryption failed:", e);
    return safeFallback;
  }
}
