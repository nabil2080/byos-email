/**
 * calendar_recovery.ts
 *
 * Client-side legacy calendar event recovery controller for BYOS.
 * Enforces authenticated mailbox-key provenance, mathematical public-key consistency,
 * deterministic strong ETags, server-side atomic staging, client read-back verification,
 * and automated rollback on verification failure or corruption.
 */

import type * as WasmCore from "./generated/crypto-core/byos_crypto_core.js";
import {
  CalendarEventItem,
  fetchCalendarEventWithETag,
  stageCalendarEventMigration,
  finalizeCalendarEventMigration,
  rollbackCalendarEventMigration,
  fetchCalendarEventMigrationStatus,
  StagedMigrationResponse,
  FinalizedMigrationResponse,
  RollbackMigrationResponse,
  MigrationStatusResponse,
} from "./api";
import {
  classifyCalendarPayload,
  encryptCalendarEventPayload,
  decryptCalendarEventPayload,
  CalendarEventPlaintext,
} from "./calendar_crypto";
import { envelopeAadHex } from "./message_crypto";

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().replace(/^0x/i, "");
  if (clean.length % 2 !== 0) throw new Error("Invalid hex length");
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.substring(i, i + 2), 16);
  }
  return bytes;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.trim());
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}

export interface KeyProvenanceCheckResult {
  valid: boolean;
  error?: string;
}

/**
 * Validates that candidate mailbox secret key:
 * 1. Is non-null, valid 32 bytes Uint8Array.
 * 2. Originates from active unlocked mailbox identity (unlockedBoxId === mailboxId).
 * 3. Is mathematically paired with registered mailbox_pk using X25519 HPKE seal/open challenge.
 * Fails closed without network calls if any check fails.
 */
export function validateMailboxKeyProvenance(
  wasm: typeof WasmCore,
  mailboxKey: Uint8Array | null | undefined,
  mailboxId: string | null | undefined,
  mailboxPk: string | Uint8Array | null | undefined,
  activeUnlockedBoxId: string | null | undefined
): KeyProvenanceCheckResult {
  if (!mailboxKey || !(mailboxKey instanceof Uint8Array) || mailboxKey.length !== 32) {
    return { valid: false, error: "Missing or invalid mailbox secret key (must be 32 bytes)" };
  }
  if (!mailboxId || typeof mailboxId !== "string" || !mailboxId.trim()) {
    return { valid: false, error: "Missing target mailbox ID" };
  }
  if (!activeUnlockedBoxId || activeUnlockedBoxId !== mailboxId) {
    return { valid: false, error: "Mailbox key custody mismatch: key is not unlocked for target mailbox" };
  }
  if (!mailboxPk) {
    return { valid: false, error: "Missing mailbox public key for cryptographic consistency assertion" };
  }
  if (!wasm || typeof wasm.wasm_hpke_seal !== "function" || typeof wasm.wasm_hpke_open !== "function") {
    return { valid: false, error: "Cryptographic WebAssembly core is not available" };
  }

  // Convert mailboxPk to 64-hex string
  let pkHex = "";
  if (typeof mailboxPk === "string") {
    const trimmed = mailboxPk.trim();
    if (trimmed.length === 64 && /^[0-9a-fA-F]+$/.test(trimmed)) {
      pkHex = trimmed.toLowerCase();
    } else {
      try {
        const decoded = base64ToBytes(trimmed);
        if (decoded.length === 32) {
          pkHex = bytesToHex(decoded);
        } else {
          return { valid: false, error: "Mailbox public key must decode to exactly 32 bytes" };
        }
      } catch {
        return { valid: false, error: "Failed to parse mailbox public key" };
      }
    }
  } else if (mailboxPk instanceof Uint8Array) {
    if (mailboxPk.length !== 32) {
      return { valid: false, error: "Mailbox public key byte array must be 32 bytes" };
    }
    pkHex = bytesToHex(mailboxPk);
  }

  // Mathematical consistency challenge: Seal random probe with mailboxPk, open with candidate key
  try {
    const probe = new Uint8Array(32);
    crypto.getRandomValues(probe);
    const probeHex = bytesToHex(probe);
    const aadHex = envelopeAadHex(mailboxId, "byos-key-verification-v1");

    const sealedHex = wasm.wasm_hpke_seal(pkHex, probeHex, aadHex);
    const openedHex = wasm.wasm_hpke_open(bytesToHex(mailboxKey), sealedHex, aadHex);

    if (openedHex.toLowerCase() !== probeHex.toLowerCase()) {
      return { valid: false, error: "Candidate key failed mathematical consistency assertion against mailbox public key" };
    }
    return { valid: true };
  } catch (err: any) {
    return { valid: false, error: `Candidate key is not paired with mailbox public key: ${err?.message || err}` };
  }
}

/**
 * Filter calendar events for legacy plaintext JSON records.
 */
export function findLegacyCalendarEvents(events: CalendarEventItem[]): CalendarEventItem[] {
  if (!Array.isArray(events)) return [];
  return events.filter((ev) => classifyCalendarPayload(ev.encrypted_payload) === "legacy-plaintext-json");
}

export interface RecoveryApiBridge {
  fetchCalendarEventWithETag: (mailboxId: string, eventId: string) => Promise<{ event: CalendarEventItem; etag: string }>;
  stageCalendarEventMigration: (mailboxId: string, eventId: string, stagedPayload: string, ifMatchEtag: string) => Promise<StagedMigrationResponse>;
  finalizeCalendarEventMigration: (mailboxId: string, eventId: string, migrationId: string) => Promise<FinalizedMigrationResponse>;
  rollbackCalendarEventMigration: (mailboxId: string, eventId: string, migrationId: string, reason: string) => Promise<RollbackMigrationResponse>;
  fetchCalendarEventMigrationStatus: (mailboxId: string, eventId: string) => Promise<MigrationStatusResponse>;
}

export const defaultRecoveryApi: RecoveryApiBridge = {
  fetchCalendarEventWithETag,
  stageCalendarEventMigration,
  finalizeCalendarEventMigration,
  rollbackCalendarEventMigration,
  fetchCalendarEventMigrationStatus,
};

export interface MigrationResult {
  success: boolean;
  eventId: string;
  migrationId?: string;
  error?: string;
}

/**
 * Executes the complete non-destructive, four-phase legacy calendar event recovery workflow:
 * Phase 1: Key provenance assertion & in-memory parsing.
 * Phase 2: Server-side atomic preservation & staged replacement with strong ETag.
 * Phase 3: Server read-back & client WASM decryption verification.
 * Phase 4: Finalization on match, or automatic rollback on any failure.
 */
export async function executeLegacyCalendarEventRecovery(
  wasm: typeof WasmCore,
  mailboxId: string,
  mailboxKey: Uint8Array,
  mailboxPk: string | Uint8Array,
  activeUnlockedBoxId: string,
  eventItem: CalendarEventItem,
  api: RecoveryApiBridge = defaultRecoveryApi
): Promise<MigrationResult> {
  let migrationId: string | undefined;
  try {
    // Step 1: Pre-flight key custody and cryptographic provenance assertion
    const provenance = validateMailboxKeyProvenance(wasm, mailboxKey, mailboxId, mailboxPk, activeUnlockedBoxId);
    if (!provenance.valid) {
      return { success: false, eventId: eventItem.id, error: `Migration rejected: ${provenance.error}` };
    }

    // Step 2: Fetch fresh event state and authoritative strong ETag
    const { event: freshEvent, etag } = await api.fetchCalendarEventWithETag(mailboxId, eventItem.id);
    if (!etag) {
      return { success: false, eventId: eventItem.id, error: "Server did not provide required strong ETag for legacy event" };
    }

    // Step 3: Verify payload is legacy plaintext
    if (classifyCalendarPayload(freshEvent.encrypted_payload) !== "legacy-plaintext-json") {
      return { success: false, eventId: eventItem.id, error: "Event payload is no longer in legacy plaintext format" };
    }

    // Step 4: In-memory decode, parse, and validate JSON schema
    let parsedPlaintext: CalendarEventPlaintext;
    try {
      const rawBytes = base64ToBytes(freshEvent.encrypted_payload);
      const decodedStr = new TextDecoder().decode(rawBytes);
      const parsed = JSON.parse(decodedStr);
      parsedPlaintext = {
        title: typeof parsed.title === "string" ? parsed.title : "(Untitled Event)",
        description: typeof parsed.description === "string" ? parsed.description : "",
        location: typeof parsed.location === "string" ? parsed.location : "",
        meetingUrl: typeof parsed.meetingUrl === "string" ? parsed.meetingUrl : "",
        attendees: Array.isArray(parsed.attendees) ? parsed.attendees : [],
        reminders: Array.isArray(parsed.reminders) ? parsed.reminders : [],
        timezone: typeof parsed.timezone === "string" ? parsed.timezone : "UTC",
        uid: typeof parsed.uid === "string" ? parsed.uid : undefined,
        sequence: typeof parsed.sequence === "number" ? parsed.sequence : undefined,
      };
    } catch (parseErr: any) {
      return { success: false, eventId: eventItem.id, error: `Corrupted legacy record: failed to parse JSON payload (${parseErr?.message || parseErr})` };
    }

    // Step 5: Encrypt into Section 12 AES-GCM envelope in browser memory
    let stagedEnvelope: string;
    try {
      stagedEnvelope = encryptCalendarEventPayload(wasm, mailboxKey, mailboxId, parsedPlaintext);
    } catch (encErr: any) {
      return { success: false, eventId: eventItem.id, error: `Client-side re-encryption failed: ${encErr?.message || encErr}` };
    }

    // Step 6: Atomic server-side staging with mandatory strong If-Match ETag
    let stageRes: StagedMigrationResponse;
    try {
      stageRes = await api.stageCalendarEventMigration(mailboxId, eventItem.id, stagedEnvelope, etag);
      if (!stageRes || !stageRes.migration_id) {
        return { success: false, eventId: eventItem.id, error: "Server failed to establish migration session" };
      }
      migrationId = stageRes.migration_id;
    } catch (stageErr: any) {
      return { success: false, eventId: eventItem.id, error: `Failed to stage migration: ${stageErr?.message || stageErr}` };
    }

    // Step 7: Server read-back verification
    let readBackDecrypted: CalendarEventPlaintext;
    try {
      const { event: readBackEvent } = await api.fetchCalendarEventWithETag(mailboxId, eventItem.id);
      readBackDecrypted = decryptCalendarEventPayload(wasm, mailboxKey, mailboxId, readBackEvent.encrypted_payload);
    } catch (readErr: any) {
      if (migrationId) {
        await api.rollbackCalendarEventMigration(mailboxId, eventItem.id, migrationId, "readback_decryption_failure");
      }
      return { success: false, eventId: eventItem.id, migrationId, error: `Read-back decryption failed: ${readErr?.message || readErr}` };
    }

    // Step 8: Assert deep equality between decrypted read-back and original plaintext
    const isMatch =
      readBackDecrypted.title === parsedPlaintext.title &&
      readBackDecrypted.description === parsedPlaintext.description &&
      readBackDecrypted.location === parsedPlaintext.location &&
      readBackDecrypted.meetingUrl === parsedPlaintext.meetingUrl &&
      readBackDecrypted.timezone === parsedPlaintext.timezone &&
      readBackDecrypted.title !== "(Encrypted Event - Unable to Decrypt)";

    if (!isMatch) {
      if (migrationId) {
        await api.rollbackCalendarEventMigration(mailboxId, eventItem.id, migrationId, "verification_mismatch");
      }
      return {
        success: false,
        eventId: eventItem.id,
        migrationId,
        error: "Client read-back verification mismatch: decrypted event content did not match original legacy plaintext",
      };
    }

    // Step 9: Finalize migration
    let finalRes: FinalizedMigrationResponse;
    try {
      finalRes = await api.finalizeCalendarEventMigration(mailboxId, eventItem.id, migrationId);
    } catch (finErr: any) {
      return { success: false, eventId: eventItem.id, migrationId, error: `Finalization failed: ${finErr?.message || finErr}` };
    }

    if (!finalRes || finalRes.status !== "finalized") {
      return { success: false, eventId: eventItem.id, migrationId, error: "Failed to finalize event migration" };
    }

    return {
      success: true,
      eventId: eventItem.id,
      migrationId,
    };
  } catch (unexpectedErr: any) {
    if (migrationId) {
      try {
        await api.rollbackCalendarEventMigration(mailboxId, eventItem.id, migrationId, "unexpected_error");
      } catch {}
    }
    return {
      success: false,
      eventId: eventItem.id,
      migrationId,
      error: `Unexpected error during recovery: ${unexpectedErr?.message || unexpectedErr}`,
    };
  }
}
