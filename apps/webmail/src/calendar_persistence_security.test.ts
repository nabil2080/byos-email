import {
  encryptCalendarEventPayload,
  decryptCalendarEventPayload,
  classifyCalendarPayload,
  type CalendarEventPlaintext,
} from "./calendar_crypto";
import * as WasmCore from "./generated/crypto-core/byos_crypto_core.js";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

interface StoredEvent {
  id: string;
  mailbox_id: string;
  calendar_id: string;
  start_time: string;
  end_time: string;
  is_all_day: boolean;
  rrule?: string;
  status: string;
  encrypted_payload: string;
  created_at: string;
  updated_at: string;
}

/**
 * Controller executing the exact persistence pipeline implemented in CalendarView.tsx
 */
class CalendarPersistenceController {
  private networkRequestCount = 0;
  private database: Map<string, StoredEvent> = new Map();
  private nextId = 1;

  get networkCalls(): number {
    return this.networkRequestCount;
  }

  get storedRecords(): StoredEvent[] {
    return Array.from(this.database.values());
  }

  getRecord(id: string): StoredEvent | undefined {
    return this.database.get(id);
  }

  seedRecord(record: StoredEvent) {
    this.database.set(record.id, { ...record });
  }

  /**
   * Exact event save handler logic from CalendarView.tsx
   */
  async handleSaveEvent(
    mailboxId: string,
    mailboxKey: Uint8Array | null,
    eventToEditId: string | null,
    payload: {
      calendarId: string;
      startTime: Date;
      endTime: Date;
      isAllDay: boolean;
      rrule?: string;
      status: string;
      sendInvitations?: boolean;
      details: CalendarEventPlaintext;
    },
    customWasm?: typeof WasmCore
  ): Promise<StoredEvent> {
    if (!mailboxId) {
      throw new Error("Missing mailboxId");
    }

    // P0 Security Rule: Locked mailbox or missing key -> reject event creation and updates
    if (!mailboxKey || !(mailboxKey instanceof Uint8Array) || mailboxKey.length !== 32) {
      throw new Error("Mailbox is locked. Unlock your mailbox to create or edit events.");
    }

    // Ensure UID and sequence tracking
    if (!payload.details.uid) {
      payload.details.uid = "evt-test-" + this.nextId;
    }
    if (eventToEditId) {
      payload.details.sequence = ((payload.details.sequence as number) || 0) + 1;
    } else {
      payload.details.sequence = 0;
    }

    const wasm = customWasm || WasmCore;

    // Encrypt payload using WASM AES-GCM-256 (Fail closed, never fall back)
    let encryptedPayload: string;
    try {
      encryptedPayload = encryptCalendarEventPayload(
        wasm,
        mailboxKey,
        mailboxId,
        payload.details
      );
    } catch (err: any) {
      console.error("[CalendarPersistenceController] Event encryption failed:", err);
      throw new Error(`Failed to encrypt event: ${err?.message || "Encryption error"}`);
    }

    // Simulated API persistence layer
    this.networkRequestCount++;
    const now = new Date().toISOString();

    if (eventToEditId) {
      const existing = this.database.get(eventToEditId);
      if (!existing || existing.mailbox_id !== mailboxId) {
        throw new Error("Event not found");
      }
      const updated: StoredEvent = {
        ...existing,
        calendar_id: payload.calendarId,
        start_time: payload.startTime.toISOString(),
        end_time: payload.endTime.toISOString(),
        is_all_day: payload.isAllDay,
        rrule: payload.rrule,
        status: payload.status,
        encrypted_payload: encryptedPayload,
        updated_at: now,
      };
      this.database.set(eventToEditId, updated);
      return updated;
    } else {
      const id = `evt-${this.nextId++}`;
      const created: StoredEvent = {
        id,
        mailbox_id: mailboxId,
        calendar_id: payload.calendarId,
        start_time: payload.startTime.toISOString(),
        end_time: payload.endTime.toISOString(),
        is_all_day: payload.isAllDay,
        rrule: payload.rrule,
        status: payload.status,
        encrypted_payload: encryptedPayload,
        created_at: now,
        updated_at: now,
      };
      this.database.set(id, created);
      return created;
    }
  }
}

export async function runCalendarPersistenceSecurityTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => void | Promise<void>) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (e) {
      console.error(`  ✗ ${name}:`, e);
      failed++;
    }
  }

  console.log("Running Calendar Persistence Security Tests (P0 Remediation)...");

  const mailboxId = "c0000000-0000-0000-0000-000000000001";
  const calendarId = "cal-sec-default-01";
  const validKey = new Uint8Array(32);
  for (let i = 0; i < 32; i++) validKey[i] = (i * 3 + 17) % 256;

  const sampleEventDetails: CalendarEventPlaintext = {
    title: "Executive Security Briefing",
    description: "Review of zero-knowledge client encryption invariants.",
    location: "Command Center Alpha",
    meetingUrl: "https://meet.byos.local/sec-briefing",
    attendees: [
      { name: "Alice", email: "alice@byos.local", status: "accepted", isOrganizer: true },
      { name: "Bob", email: "bob@byos.local", status: "needs-action" },
    ],
    reminders: [{ minutesBefore: 10 }],
    timezone: "UTC",
    uid: "byos-sec-test-evt-001",
  };

  // ---------------------------------------------------------------------------
  // Test 1: Missing mailbox key prevents event creation
  // ---------------------------------------------------------------------------
  await test("1. Missing mailbox key prevents event creation", async () => {
    const controller = new CalendarPersistenceController();
    let threw = false;

    try {
      await controller.handleSaveEvent(mailboxId, null, null, {
        calendarId,
        startTime: new Date("2026-11-01T10:00:00Z"),
        endTime: new Date("2026-11-01T11:00:00Z"),
        isAllDay: false,
        status: "busy",
        details: sampleEventDetails,
      });
    } catch (err: any) {
      threw = true;
      assert(err.message.includes("Mailbox is locked. Unlock your mailbox to create or edit events."), "must reject with unlock prompt");
    }

    assert(threw, "Must throw when mailboxKey is null");
    assert(controller.storedRecords.length === 0, "No event may be created in DB");
  });

  // ---------------------------------------------------------------------------
  // Test 2: Missing mailbox key prevents event updates
  // ---------------------------------------------------------------------------
  await test("2. Missing mailbox key prevents event updates", async () => {
    const controller = new CalendarPersistenceController();
    // First create a legitimate event
    const existing = await controller.handleSaveEvent(mailboxId, validKey, null, {
      calendarId,
      startTime: new Date("2026-11-01T10:00:00Z"),
      endTime: new Date("2026-11-01T11:00:00Z"),
      isAllDay: false,
      status: "busy",
      details: sampleEventDetails,
    });

    const originalCiphertext = existing.encrypted_payload;
    let threw = false;

    // Now attempt update with null key (locked)
    try {
      await controller.handleSaveEvent(mailboxId, null, existing.id, {
        calendarId,
        startTime: new Date("2026-11-01T12:00:00Z"),
        endTime: new Date("2026-11-01T13:00:00Z"),
        isAllDay: false,
        status: "busy",
        details: { ...sampleEventDetails, title: "Tampered Update Attempt" },
      });
    } catch (err: any) {
      threw = true;
      assert(err.message.includes("Mailbox is locked"), "must reject with unlock prompt");
    }

    assert(threw, "Must throw when attempting update without key");
    const stored = controller.getRecord(existing.id)!;
    assert(stored.encrypted_payload === originalCiphertext, "Persisted ciphertext must remain unchanged");
    assert(stored.start_time === "2026-11-01T10:00:00.000Z", "Persisted start time must remain unchanged");
  });

  // ---------------------------------------------------------------------------
  // Test 3: Locked mailbox causes zero persistence requests
  // ---------------------------------------------------------------------------
  await test("3. Locked mailbox causes zero persistence requests", async () => {
    const controller = new CalendarPersistenceController();
    const callsBefore = controller.networkCalls;

    // Attempt creation while locked
    try {
      await controller.handleSaveEvent(mailboxId, null, null, {
        calendarId,
        startTime: new Date(),
        endTime: new Date(),
        isAllDay: false,
        status: "busy",
        details: sampleEventDetails,
      });
    } catch {}

    // Attempt update while locked
    try {
      await controller.handleSaveEvent(mailboxId, null, "evt-nonexistent", {
        calendarId,
        startTime: new Date(),
        endTime: new Date(),
        isAllDay: false,
        status: "busy",
        details: sampleEventDetails,
      });
    } catch {}

    assert(controller.networkCalls === callsBefore, "Zero network or persistence calls when locked");
  });

  // ---------------------------------------------------------------------------
  // Test 4: WASM encryption failure causes zero persistence requests
  // ---------------------------------------------------------------------------
  await test("4. WASM encryption failure causes zero persistence requests", async () => {
    const controller = new CalendarPersistenceController();
    const brokenWasm = {
      ...WasmCore,
      wasm_aes_gcm_encrypt: () => {
        throw new Error("Simulated WASM out of memory");
      },
    };

    let threw = false;
    const callsBefore = controller.networkCalls;

    try {
      await controller.handleSaveEvent(
        mailboxId,
        validKey,
        null,
        {
          calendarId,
          startTime: new Date(),
          endTime: new Date(),
          isAllDay: false,
          status: "busy",
          details: sampleEventDetails,
        },
        brokenWasm as any
      );
    } catch (err: any) {
      threw = true;
      assert(err.message.includes("Failed to encrypt event"), "must surface encryption failure");
    }

    assert(threw, "Must throw on WASM failure");
    assert(controller.networkCalls === callsBefore, "Zero persistence calls when encryption fails");
    assert(controller.storedRecords.length === 0, "Zero records persisted");
  });

  // ---------------------------------------------------------------------------
  // Test 5: No Base64/plaintext fallback exists in the persistence path
  // ---------------------------------------------------------------------------
  await test("5. No Base64/plaintext fallback exists in the persistence path", async () => {
    const controller = new CalendarPersistenceController();

    // Verify all stored records strictly classify as AES-GCM envelopes
    await controller.handleSaveEvent(mailboxId, validKey, null, {
      calendarId,
      startTime: new Date("2026-11-02T10:00:00Z"),
      endTime: new Date("2026-11-02T11:00:00Z"),
      isAllDay: false,
      status: "busy",
      details: sampleEventDetails,
    });

    const records = controller.storedRecords;
    assert(records.length === 1, "Expected 1 record");

    for (const rec of records) {
      const format = classifyCalendarPayload(rec.encrypted_payload);
      assert(format === "aes-gcm-envelope", `Stored payload must be aes-gcm-envelope, got ${format}`);
      assert(format !== "legacy-plaintext-json", "No record may contain legacy Base64 JSON");
      // Double check raw bytes do not start with '{'
      const raw = Buffer.from(rec.encrypted_payload, "base64");
      assert(raw[0] !== 0x7b, "Raw payload bytes must not begin with '{'");
    }
  });

  // ---------------------------------------------------------------------------
  // Test 6: Successful encryption persists the encrypted envelope
  // ---------------------------------------------------------------------------
  await test("6. Successful encryption persists the encrypted envelope", async () => {
    const controller = new CalendarPersistenceController();

    const created = await controller.handleSaveEvent(mailboxId, validKey, null, {
      calendarId,
      startTime: new Date("2026-11-03T14:00:00Z"),
      endTime: new Date("2026-11-03T15:00:00Z"),
      isAllDay: false,
      status: "busy",
      details: sampleEventDetails,
    });

    assert(typeof created.id === "string" && created.id.length > 0, "valid record ID returned");
    assert(typeof created.encrypted_payload === "string" && created.encrypted_payload.length > 0, "non-empty payload");

    // Decrypt and assert all plaintext preserved
    const decrypted = decryptCalendarEventPayload(WasmCore, validKey, mailboxId, created.encrypted_payload);
    assert(decrypted.title === sampleEventDetails.title, "title roundtrip");
    assert(decrypted.description === sampleEventDetails.description, "description roundtrip");
    assert(decrypted.location === sampleEventDetails.location, "location roundtrip");
    assert(decrypted.attendees?.length === 2, "attendees count preserved");
    assert(decrypted.attendees?.[0].email === "alice@byos.local", "attendee email preserved");
  });

  // ---------------------------------------------------------------------------
  // Test 7: Wrong mailbox key cannot decrypt another mailbox's event
  // ---------------------------------------------------------------------------
  await test("7. Wrong mailbox key cannot decrypt another mailbox's event", async () => {
    const controller = new CalendarPersistenceController();
    const created = await controller.handleSaveEvent(mailboxId, validKey, null, {
      calendarId,
      startTime: new Date("2026-11-04T09:00:00Z"),
      endTime: new Date("2026-11-04T10:00:00Z"),
      isAllDay: false,
      status: "busy",
      details: sampleEventDetails,
    });

    // 1. Wrong key on same mailbox
    const wrongKey = new Uint8Array(32);
    wrongKey.fill(0x55);
    const decryptedWrongKey = decryptCalendarEventPayload(WasmCore, wrongKey, mailboxId, created.encrypted_payload);
    assert(decryptedWrongKey.title === "(Encrypted Event - Unable to Decrypt)", "wrong key must return safe placeholder");
    assert(decryptedWrongKey.description === "", "no description leak");

    // 2. Same key on wrong mailbox (AAD binding check)
    const otherMailboxId = "c0000000-0000-0000-0000-000000000002";
    const decryptedWrongBox = decryptCalendarEventPayload(WasmCore, validKey, otherMailboxId, created.encrypted_payload);
    assert(decryptedWrongBox.title === "(Encrypted Event - Unable to Decrypt)", "wrong mailboxId AAD mismatch must return safe placeholder");
  });

  // ---------------------------------------------------------------------------
  // Test 8: Tampered ciphertext fails closed
  // ---------------------------------------------------------------------------
  await test("8. Tampered ciphertext fails closed", async () => {
    const controller = new CalendarPersistenceController();
    const created = await controller.handleSaveEvent(mailboxId, validKey, null, {
      calendarId,
      startTime: new Date("2026-11-05T14:00:00Z"),
      endTime: new Date("2026-11-05T15:00:00Z"),
      isAllDay: false,
      status: "busy",
      details: sampleEventDetails,
    });

    const raw = Buffer.from(created.encrypted_payload, "base64");
    // Flip bit in ciphertext body
    raw[20] ^= 0xff;
    const tamperedB64 = raw.toString("base64");

    const decrypted = decryptCalendarEventPayload(WasmCore, validKey, mailboxId, tamperedB64);
    assert(decrypted.title === "(Encrypted Event - Unable to Decrypt)", "tampered ciphertext must return safe placeholder");
    assert(decrypted.attendees?.length === 0, "attendees must be empty on tamper");
  });

  // ---------------------------------------------------------------------------
  // Test 9: Existing valid encrypted events remain readable
  // ---------------------------------------------------------------------------
  await test("9. Existing valid encrypted events remain readable", async () => {
    // Generate valid encrypted envelope directly with WasmCore
    const envelopeB64 = encryptCalendarEventPayload(WasmCore, validKey, mailboxId, sampleEventDetails);

    // Read back through standard decryption path
    const readBack = decryptCalendarEventPayload(WasmCore, validKey, mailboxId, envelopeB64);
    assert(readBack.title === sampleEventDetails.title, "event title must be readable");
    assert(readBack.meetingUrl === sampleEventDetails.meetingUrl, "meeting URL readable");
    assert(readBack.uid === sampleEventDetails.uid, "UID readable");
  });

  // ---------------------------------------------------------------------------
  // Test 10: Existing legacy records are identified without being silently modified
  // ---------------------------------------------------------------------------
  await test("10. Existing legacy records are identified without being silently modified", async () => {
    const controller = new CalendarPersistenceController();

    // Seed controller with a legacy Base64 JSON record simulating Phase 5 pre-remediation database state
    const legacyDetails = {
      title: "Phase 5 Architecture Sync",
      description: "Legacy unencrypted event created before remediation",
      location: "Room 101",
      timezone: "UTC",
    };
    const legacyPayloadB64 = Buffer.from(JSON.stringify(legacyDetails)).toString("base64");

    const legacyRecord: StoredEvent = {
      id: "evt-legacy-001",
      mailbox_id: mailboxId,
      calendar_id: calendarId,
      start_time: "2026-10-20T08:23:53.000Z",
      end_time: "2026-10-20T09:23:53.000Z",
      is_all_day: false,
      status: "busy",
      encrypted_payload: legacyPayloadB64,
      created_at: "2026-10-20T08:23:53.000Z",
      updated_at: "2026-10-20T08:23:53.000Z",
    };
    controller.seedRecord(legacyRecord);

    // 1. Audit / Identification step: correctly identify as legacy record
    const format = classifyCalendarPayload(legacyRecord.encrypted_payload);
    assert(format === "legacy-plaintext-json", `Must classify as legacy-plaintext-json, got: ${format}`);

    // 2. Immutability check: record remains byte-for-byte untouched
    const fetched = controller.getRecord("evt-legacy-001")!;
    assert(fetched.encrypted_payload === legacyPayloadB64, "Legacy record must not be silently modified");
    assert(fetched.updated_at === legacyRecord.updated_at, "Updated_at must not be modified");

    // 3. Failsafe check: decryptCalendarEventPayload refuses to interpret legacy record as decrypted
    const decrypted = decryptCalendarEventPayload(WasmCore, validKey, mailboxId, fetched.encrypted_payload);
    assert(
      decrypted.title === "(Encrypted Event - Unable to Decrypt)",
      `Legacy record must safely return placeholder, got: ${decrypted.title}`
    );
  });

  return { passed, failed };
}
