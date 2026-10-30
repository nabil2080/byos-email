import {
  encryptCalendarEventPayload,
  decryptCalendarEventPayload,
  type CalendarEventPlaintext,
} from "./calendar_crypto.js";
import {
  verifyInvitationAuthenticity,
  generateRsvpReplyIcs,
  type ParsedIcsEvent,
} from "./utils/calendarIcs.js";
import * as WasmCore from "./generated/crypto-core/byos_crypto_core.js";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

/**
 * In-memory isolated event repository simulating the BYOS PostgreSQL `calendar_events` table.
 * Zero-knowledge: stores only encrypted_payload and query metadata.
 */
export interface StoredCalendarRecord {
  id: string;
  mailbox_id: string;
  calendar_id: string;
  start_time: string;
  end_time: string;
  is_all_day: boolean;
  status: string;
  encrypted_payload: string; // Base64 Section 12 ciphertext
  created_at: string;
  updated_at: string;
}

export class IsolatedCalendarEventRepository {
  private events: Map<string, StoredCalendarRecord> = new Map();
  private idCounter = 1;

  async queryEvents(
    mailboxId: string,
    startWindow: string,
    endWindow: string
  ): Promise<StoredCalendarRecord[]> {
    const start = new Date(startWindow).getTime();
    const end = new Date(endWindow).getTime();
    const results: StoredCalendarRecord[] = [];

    for (const ev of this.events.values()) {
      if (ev.mailbox_id !== mailboxId) continue;
      const evStart = new Date(ev.start_time).getTime();
      const evEnd = new Date(ev.end_time).getTime();
      // Overlap query matching calendarEventsHandler logic
      if (evStart <= end && evEnd >= start) {
        results.push({ ...ev });
      }
    }
    return results;
  }

  async createEvent(
    record: Omit<StoredCalendarRecord, "id" | "created_at" | "updated_at">
  ): Promise<StoredCalendarRecord> {
    const id = `evt-iso-${this.idCounter++}`;
    const now = new Date().toISOString();
    const stored: StoredCalendarRecord = {
      ...record,
      id,
      created_at: now,
      updated_at: now,
    };
    this.events.set(id, stored);
    return { ...stored };
  }

  async updateEvent(
    mailboxId: string,
    eventId: string,
    patch: Partial<StoredCalendarRecord>
  ): Promise<StoredCalendarRecord> {
    const existing = this.events.get(eventId);
    if (!existing || existing.mailbox_id !== mailboxId) {
      throw new Error(`Event not found: ${eventId}`);
    }
    const updated: StoredCalendarRecord = {
      ...existing,
      ...patch,
      updated_at: new Date().toISOString(),
    };
    this.events.set(eventId, updated);
    return { ...updated };
  }

  getRecord(eventId: string): StoredCalendarRecord | undefined {
    const rec = this.events.get(eventId);
    return rec ? { ...rec } : undefined;
  }

  getAllRecords(): StoredCalendarRecord[] {
    return Array.from(this.events.values()).map((r) => ({ ...r }));
  }

  clear() {
    this.events.clear();
  }
}

/**
 * Reusable invitation processing pipeline implementing the exact logic
 * of `handleRsvpInvitation` in App.tsx:
 *
 * 1. Raw incoming event pre-check (negative sequence / invalid policy check)
 * 2. Mailbox key guard (fails closed if mailbox is locked)
 * 3. Query existing events in window from repository
 * 4. Decrypt existing events using WASM
 * 5. Find matching UID
 * 6. Authenticity & sequence validation
 * 7. Duplicate detection
 * 8. Re-encryption & persistence into repository
 * 9. Outbound RSVP reply generation
 */
export async function processIncomingInvitation(params: {
  rsvpStatus: "ACCEPTED" | "TENTATIVE" | "DECLINED";
  incomingEvent: ParsedIcsEvent;
  mailboxId: string;
  calendarId: string;
  mailboxKey: Uint8Array | null;
  currentUserEmail: string;
  repository: IsolatedCalendarEventRepository;
}): Promise<{
  applied: boolean;
  rejected: boolean;
  duplicate: boolean;
  locked: boolean;
  isStale?: boolean;
  isOrganizerMismatch?: boolean;
  isInvalidInput?: boolean;
  reason?: string;
  outboundReplyIcs?: string;
  persistedRecordId?: string;
}> {
  const {
    rsvpStatus,
    incomingEvent,
    mailboxId,
    calendarId,
    mailboxKey,
    currentUserEmail,
    repository,
  } = params;

  // 1. Raw incoming event pre-check (BYOS policy)
  const preCheck = verifyInvitationAuthenticity(incomingEvent, null, rsvpStatus);
  if (!preCheck.valid) {
    return {
      applied: false,
      rejected: true,
      duplicate: false,
      locked: false,
      isInvalidInput: preCheck.isInvalidInput,
      reason: preCheck.reason,
    };
  }

  // 2. Mailbox lock guard: fail closed if key unavailable
  if (!mailboxKey) {
    return {
      applied: false,
      rejected: false,
      duplicate: false,
      locked: true,
      reason: "Mailbox is locked. Unlock to RSVP.",
    };
  }

  // 3. Query events in time window around event (same as App.tsx)
  const startWindow = new Date(incomingEvent.startTime.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const endWindow = new Date(incomingEvent.endTime.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const existingEvents = await repository.queryEvents(mailboxId, startWindow, endWindow);

  // 4. Decrypt candidate events to match UID
  let matchedRecord: StoredCalendarRecord | null = null;
  let matchedDetails: CalendarEventPlaintext | null = null;
  for (const raw of existingEvents) {
    const details = decryptCalendarEventPayload(WasmCore, mailboxKey, mailboxId, raw.encrypted_payload);
    if (details.uid && details.uid === incomingEvent.uid) {
      matchedRecord = raw;
      matchedDetails = details;
      break;
    }
  }

  // 5. Authenticity & sequence validation
  const authCheck = verifyInvitationAuthenticity(incomingEvent, matchedDetails, rsvpStatus);
  if (!authCheck.valid) {
    return {
      applied: false,
      rejected: true,
      duplicate: false,
      locked: false,
      isStale: authCheck.isStale,
      isOrganizerMismatch: authCheck.isOrganizerMismatch,
      isInvalidInput: authCheck.isInvalidInput,
      reason: authCheck.reason,
    };
  }

  // 6. Duplicate check
  if (authCheck.isDuplicate) {
    return {
      applied: false,
      rejected: false,
      duplicate: true,
      locked: false,
      reason: authCheck.reason,
    };
  }

  // 7. Encrypt updated details and persist
  const updatedDetails: CalendarEventPlaintext = {
    title: incomingEvent.summary || "(Untitled Event)",
    description: incomingEvent.description || "",
    location: incomingEvent.location || "",
    meetingUrl: incomingEvent.url || "",
    attendees: incomingEvent.attendees.map((a) => ({
      name: a.name,
      email: a.email,
      status:
        a.email.toLowerCase() === currentUserEmail.toLowerCase()
          ? (rsvpStatus.toLowerCase() as any)
          : (a.partstat?.toLowerCase() as any),
    })),
    reminders: [],
    timezone: incomingEvent.timezone || "UTC",
    uid: incomingEvent.uid,
    sequence: incomingEvent.sequence,
    organizer: incomingEvent.organizer,
    myRsvpStatus: rsvpStatus.toLowerCase() as any,
  };

  const encryptedPayload = encryptCalendarEventPayload(
    WasmCore,
    mailboxKey,
    mailboxId,
    updatedDetails
  );

  let recordId: string;
  if (matchedRecord) {
    const updated = await repository.updateEvent(mailboxId, matchedRecord.id, {
      start_time: incomingEvent.startTime.toISOString(),
      end_time: incomingEvent.endTime.toISOString(),
      is_all_day: incomingEvent.isAllDay,
      status: rsvpStatus === "DECLINED" ? "free" : "busy",
      encrypted_payload: encryptedPayload,
    });
    recordId = updated.id;
  } else {
    const created = await repository.createEvent({
      mailbox_id: mailboxId,
      calendar_id: calendarId,
      start_time: incomingEvent.startTime.toISOString(),
      end_time: incomingEvent.endTime.toISOString(),
      is_all_day: incomingEvent.isAllDay,
      status: rsvpStatus === "DECLINED" ? "free" : "busy",
      encrypted_payload: encryptedPayload,
    });
    recordId = created.id;
  }

  // 8. Generate RSVP reply email if organizer present
  let replyIcs: string | undefined;
  if (incomingEvent.organizer?.email && currentUserEmail) {
    replyIcs = generateRsvpReplyIcs({
      uid: incomingEvent.uid,
      sequence: incomingEvent.sequence,
      title: incomingEvent.summary,
      startTime: incomingEvent.startTime,
      endTime: incomingEvent.endTime,
      organizer: incomingEvent.organizer,
      responder: {
        email: currentUserEmail,
        status: rsvpStatus,
      },
    });
  }

  return {
    applied: true,
    rejected: false,
    duplicate: false,
    locked: false,
    outboundReplyIcs: replyIcs,
    persistedRecordId: recordId,
  };
}

export async function runCalendarInvitationRepositoryTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  function test(name: string, fn: () => void | Promise<void>) {
    try {
      const res = fn();
      if (res instanceof Promise) {
        return res
          .then(() => {
            console.log(`  ✓ ${name}`);
            passed++;
          })
          .catch((e) => {
            console.error(`  ✗ ${name}:`, e);
            failed++;
          });
      } else {
        console.log(`  ✓ ${name}`);
        passed++;
      }
    } catch (e) {
      console.error(`  ✗ ${name}:`, e);
      failed++;
    }
  }

  console.log("Running Calendar Invitation Repository Integration Tests...");

  const mailboxId = "c0000000-0000-0000-0000-000000000001";
  const calendarId = "cal-iso-default-01";
  const currentUserEmail = "alice@byos.local";
  const mailboxKey = new Uint8Array(32);
  for (let i = 0; i < 32; i++) mailboxKey[i] = (i * 7 + 13) % 256;

  const repo = new IsolatedCalendarEventRepository();

  const testUid = "phase51-stale-test@example.invalid";
  const trustedOrganizer = { email: "organizer@example.invalid", name: "Trusted Organizer" };

  // ---------------------------------------------------------------------------
  // STEP 1: Setup existing event in repository at Sequence 3
  // ---------------------------------------------------------------------------
  let initialRecordId = "";
  await test("1. Setup: Create stored event at sequence 3 with trusted organizer", async () => {
    const initialPlaintext: CalendarEventPlaintext = {
      title: "Quarterly Review (v3)",
      description: "Authoritative stored event at sequence 3",
      location: "Boardroom A",
      timezone: "UTC",
      uid: testUid,
      sequence: 3,
      organizer: trustedOrganizer,
      myRsvpStatus: "accepted",
      attendees: [
        { email: currentUserEmail, name: "Alice", status: "accepted" },
      ],
    };

    const encPayload = encryptCalendarEventPayload(WasmCore, mailboxKey, mailboxId, initialPlaintext);
    const stored = await repo.createEvent({
      mailbox_id: mailboxId,
      calendar_id: calendarId,
      start_time: "2026-11-20T10:00:00Z",
      end_time: "2026-11-20T11:00:00Z",
      is_all_day: false,
      status: "busy",
      encrypted_payload: encPayload,
    });

    initialRecordId = stored.id;
    assert(Boolean(initialRecordId), "Record ID generated");

    // Decrypt and verify stored state
    const retrieved = repo.getRecord(initialRecordId);
    assert(retrieved !== undefined, "Record retrieved from repo");
    const decrypted = decryptCalendarEventPayload(WasmCore, mailboxKey, mailboxId, retrieved!.encrypted_payload);
    assert(decrypted.uid === testUid, "UID matches in repo");
    assert(decrypted.sequence === 3, "Sequence is 3 in repo");
    assert(decrypted.organizer?.email === "organizer@example.invalid", "Organizer matches in repo");
    assert(decrypted.title === "Quarterly Review (v3)", "Title matches in repo");
  });

  // ---------------------------------------------------------------------------
  // STEP 2: Stale REQUEST (Sequence 2 < 3) — Must be rejected; DB unchanged
  // ---------------------------------------------------------------------------
  await test("2. Stale REQUEST (seq 2 < stored 3): rejected, stored event sequence remains 3", async () => {
    const staleRequest: ParsedIcsEvent = {
      uid: testUid,
      sequence: 2, // Older than stored 3!
      summary: "Stale Overwrite Attempt (v2)",
      startTime: new Date("2026-11-20T10:00:00Z"),
      endTime: new Date("2026-11-20T11:00:00Z"),
      isAllDay: false,
      status: "CONFIRMED",
      organizer: trustedOrganizer,
      attendees: [{ email: currentUserEmail, partstat: "NEEDS-ACTION" }],
    };

    const result = await processIncomingInvitation({
      rsvpStatus: "ACCEPTED",
      incomingEvent: staleRequest,
      mailboxId,
      calendarId,
      mailboxKey,
      currentUserEmail,
      repository: repo,
    });

    // Assert returned result
    assert(result.applied === false, "Stale update MUST NOT be applied");
    assert(result.rejected === true, "Stale update MUST be rejected");
    assert(result.isStale === true, "isStale flag MUST be true");
    assert(!result.isInvalidInput, "isInvalidInput must NOT be true — seq 2 is a valid number");
    assert(result.reason!.includes("v2"), "Reason must mention incoming sequence v2");
    assert(result.reason!.includes("v3"), "Reason must mention stored sequence v3");
    assert(result.outboundReplyIcs === undefined, "No outbound reply email must be generated");

    // Assert persisted event state after operation
    const persisted = repo.getRecord(initialRecordId);
    assert(persisted !== undefined, "Persisted record still exists");
    const decrypted = decryptCalendarEventPayload(WasmCore, mailboxKey, mailboxId, persisted!.encrypted_payload);
    assert(decrypted.sequence === 3, `Persisted sequence MUST remain 3, got: ${decrypted.sequence}`);
    assert(decrypted.title === "Quarterly Review (v3)", `Persisted title MUST remain v3, got: ${decrypted.title}`);
  });

  // ---------------------------------------------------------------------------
  // STEP 3: Newer Valid REQUEST (Sequence 4 > 3) — Must be applied; DB updated
  // ---------------------------------------------------------------------------
  await test("3. Newer REQUEST (seq 4 > stored 3): accepted, stored event sequence updated to 4", async () => {
    const newerRequest: ParsedIcsEvent = {
      uid: testUid,
      sequence: 4, // Newer than stored 3!
      summary: "Quarterly Review (v4 Rescheduled)",
      startTime: new Date("2026-11-20T14:00:00Z"),
      endTime: new Date("2026-11-20T15:00:00Z"),
      isAllDay: false,
      status: "CONFIRMED",
      organizer: trustedOrganizer,
      attendees: [{ email: currentUserEmail, partstat: "NEEDS-ACTION" }],
    };

    const result = await processIncomingInvitation({
      rsvpStatus: "ACCEPTED",
      incomingEvent: newerRequest,
      mailboxId,
      calendarId,
      mailboxKey,
      currentUserEmail,
      repository: repo,
    });

    // Assert returned result
    assert(result.applied === true, "Newer revision MUST be applied");
    assert(result.rejected === false, "Newer revision must not be rejected");
    assert(result.duplicate === false, "Newer revision is not duplicate");
    assert(result.outboundReplyIcs !== undefined, "Outbound RSVP reply email MUST be generated");
    assert(result.outboundReplyIcs!.includes("PARTSTAT=ACCEPTED"), "Reply has ACCEPTED");
    assert(result.outboundReplyIcs!.includes("SEQUENCE:4"), "Reply carries sequence 4");

    // Assert persisted event state after operation
    const persisted = repo.getRecord(initialRecordId);
    assert(persisted !== undefined, "Persisted record exists");
    const decrypted = decryptCalendarEventPayload(WasmCore, mailboxKey, mailboxId, persisted!.encrypted_payload);
    assert(decrypted.sequence === 4, `Persisted sequence MUST now be 4, got: ${decrypted.sequence}`);
    assert(decrypted.title === "Quarterly Review (v4 Rescheduled)", "Persisted title updated to v4");
    assert(decrypted.myRsvpStatus === "accepted", "RSVP status persisted as accepted");
  });

  // ---------------------------------------------------------------------------
  // STEP 4: Duplicate Delivery of Sequence 4 — Idempotent, no change, no reply
  // ---------------------------------------------------------------------------
  await test("4. Duplicate delivery of seq 4: idempotent detection, no DB change, no re-sent reply", async () => {
    const dupRequest: ParsedIcsEvent = {
      uid: testUid,
      sequence: 4, // Exact same sequence
      summary: "Quarterly Review (v4 Rescheduled)",
      startTime: new Date("2026-11-20T14:00:00Z"),
      endTime: new Date("2026-11-20T15:00:00Z"),
      isAllDay: false,
      status: "CONFIRMED",
      organizer: trustedOrganizer,
      attendees: [{ email: currentUserEmail, partstat: "ACCEPTED" }],
    };

    const result = await processIncomingInvitation({
      rsvpStatus: "ACCEPTED",
      incomingEvent: dupRequest,
      mailboxId,
      calendarId,
      mailboxKey,
      currentUserEmail,
      repository: repo,
    });

    // Assert returned result
    assert(result.applied === false, "Duplicate MUST NOT trigger re-apply");
    assert(result.rejected === false, "Duplicate is not a hard rejection");
    assert(result.duplicate === true, "Must be flagged as duplicate delivery");
    assert(result.outboundReplyIcs === undefined, "No duplicate reply email should be generated");

    // Assert persisted event state after operation
    const persisted = repo.getRecord(initialRecordId);
    const decrypted = decryptCalendarEventPayload(WasmCore, mailboxKey, mailboxId, persisted!.encrypted_payload);
    assert(decrypted.sequence === 4, "Sequence remains 4");
    assert(repo.getAllRecords().length === 1, "No duplicate calendar records created in repo");
  });

  // ---------------------------------------------------------------------------
  // STEP 5: Stale CANCEL (Sequence 2 < 4) — Must be rejected; status remains CONFIRMED
  // ---------------------------------------------------------------------------
  await test("5. Stale CANCEL (seq 2 < stored 4): rejected, event status remains active", async () => {
    const staleCancel: ParsedIcsEvent = {
      uid: testUid,
      sequence: 2, // Older than stored 4!
      summary: "Quarterly Review Cancelled",
      startTime: new Date("2026-11-20T14:00:00Z"),
      endTime: new Date("2026-11-20T15:00:00Z"),
      isAllDay: false,
      status: "CANCELLED",
      organizer: trustedOrganizer,
      attendees: [],
    };

    const result = await processIncomingInvitation({
      rsvpStatus: "DECLINED",
      incomingEvent: staleCancel,
      mailboxId,
      calendarId,
      mailboxKey,
      currentUserEmail,
      repository: repo,
    });

    // Assert returned result
    assert(result.applied === false, "Stale CANCEL MUST NOT be applied");
    assert(result.rejected === true, "Stale CANCEL MUST be rejected");
    assert(result.isStale === true, "isStale flag must be set for stale CANCEL");

    // Assert persisted event state after operation
    const persisted = repo.getRecord(initialRecordId);
    assert(persisted!.status === "busy", "Persisted DB status remains busy (not free)");
    const decrypted = decryptCalendarEventPayload(WasmCore, mailboxKey, mailboxId, persisted!.encrypted_payload);
    assert(decrypted.sequence === 4, "Persisted sequence remains 4");
  });

  // ---------------------------------------------------------------------------
  // STEP 6: Newer Valid CANCEL (Sequence 5 > 4) — Must be applied; status becomes free
  // ---------------------------------------------------------------------------
  await test("6. Valid CANCEL (seq 5 > stored 4): accepted, persisted status updated to free/cancelled", async () => {
    const validCancel: ParsedIcsEvent = {
      uid: testUid,
      sequence: 5, // Incremented above stored 4!
      summary: "Quarterly Review (Cancelled by Organizer)",
      startTime: new Date("2026-11-20T14:00:00Z"),
      endTime: new Date("2026-11-20T15:00:00Z"),
      isAllDay: false,
      status: "CANCELLED",
      organizer: trustedOrganizer,
      attendees: [],
    };

    const result = await processIncomingInvitation({
      rsvpStatus: "DECLINED",
      incomingEvent: validCancel,
      mailboxId,
      calendarId,
      mailboxKey,
      currentUserEmail,
      repository: repo,
    });

    // Assert returned result
    assert(result.applied === true, "Valid CANCEL MUST be applied");
    assert(result.rejected === false, "Valid CANCEL must not be rejected");

    // Assert persisted event state after operation
    const persisted = repo.getRecord(initialRecordId);
    assert(persisted!.status === "free", "Persisted DB status updated to free upon DECLINED/CANCEL");
    const decrypted = decryptCalendarEventPayload(WasmCore, mailboxKey, mailboxId, persisted!.encrypted_payload);
    assert(decrypted.sequence === 5, `Persisted sequence updated to 5, got: ${decrypted.sequence}`);
    assert(decrypted.myRsvpStatus === "declined", "myRsvpStatus updated to declined");
  });

  // ---------------------------------------------------------------------------
  // STEP 7: Organizer Authorization Through Real Path — Hijack attempt rejected
  // ---------------------------------------------------------------------------
  await test("7. Organizer hijack attempt (different organizer): rejected, stored organizer untouched", async () => {
    const hijackAttempt: ParsedIcsEvent = {
      uid: testUid,
      sequence: 6, // Even with higher sequence!
      summary: "Hostile Takeover Meeting",
      startTime: new Date("2026-11-20T14:00:00Z"),
      endTime: new Date("2026-11-20T15:00:00Z"),
      isAllDay: false,
      status: "CONFIRMED",
      organizer: { email: "hijacker@malicious.invalid", name: "Malicious Actor" }, // Impostor!
      attendees: [{ email: currentUserEmail, partstat: "NEEDS-ACTION" }],
    };

    const result = await processIncomingInvitation({
      rsvpStatus: "ACCEPTED",
      incomingEvent: hijackAttempt,
      mailboxId,
      calendarId,
      mailboxKey,
      currentUserEmail,
      repository: repo,
    });

    // Assert returned result
    assert(result.applied === false, "Hijack MUST NOT be applied");
    assert(result.rejected === true, "Hijack MUST be rejected");
    assert(result.isOrganizerMismatch === true, "isOrganizerMismatch flag MUST be set");
    assert(result.reason!.includes("hijacker@malicious.invalid"), "Reason must cite hijacker");
    assert(result.reason!.includes("organizer@example.invalid"), "Reason must cite trusted organizer");
    assert(result.outboundReplyIcs === undefined, "No RSVP reply generated for hijacker");

    // Assert persisted event state: organizer is still the trusted organizer!
    const persisted = repo.getRecord(initialRecordId);
    const decrypted = decryptCalendarEventPayload(WasmCore, mailboxKey, mailboxId, persisted!.encrypted_payload);
    assert(decrypted.organizer?.email === "organizer@example.invalid", "Stored organizer MUST remain trusted organizer");
    assert(decrypted.sequence === 5, "Stored sequence MUST remain 5 (not updated to 6)");
    assert(decrypted.title !== "Hostile Takeover Meeting", "Stored title MUST NOT be overwritten");
  });

  // ---------------------------------------------------------------------------
  // STEP 8: Locked Mailbox Fail-Closed — No decryption key, fails closed safely
  // ---------------------------------------------------------------------------
  await test("8. Locked mailbox fail-closed: returns actionable unlock message, DB untouched, no outbound email", async () => {
    const hijackWhileLocked: ParsedIcsEvent = {
      uid: testUid,
      sequence: 7,
      summary: "Update while locked",
      startTime: new Date("2026-11-20T14:00:00Z"),
      endTime: new Date("2026-11-20T15:00:00Z"),
      isAllDay: false,
      status: "CONFIRMED",
      organizer: { email: "hijacker@malicious.invalid" },
      attendees: [],
    };

    // Mailbox is locked: mailboxKey is null
    const result = await processIncomingInvitation({
      rsvpStatus: "ACCEPTED",
      incomingEvent: hijackWhileLocked,
      mailboxId,
      calendarId,
      mailboxKey: null, // LOCKED MAILBOX!
      currentUserEmail,
      repository: repo,
    });

    // Assert returned result
    assert(result.applied === false, "Locked mailbox MUST NOT apply changes");
    assert(result.locked === true, "Result must indicate locked status");
    assert(result.reason === "Mailbox is locked. Unlock to RSVP.", "Actionable unlock message returned");
    assert(result.outboundReplyIcs === undefined, "No outbound email generated while locked");

    // Assert persisted event state is completely unchanged
    const persisted = repo.getRecord(initialRecordId);
    const decrypted = decryptCalendarEventPayload(WasmCore, mailboxKey, mailboxId, persisted!.encrypted_payload);
    assert(decrypted.sequence === 5, "Persisted sequence remains 5");
    assert(decrypted.organizer?.email === "organizer@example.invalid", "Organizer remains trusted organizer");
  });

  return { passed, failed };
}
