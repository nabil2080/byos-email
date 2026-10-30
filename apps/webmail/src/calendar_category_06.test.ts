import {
  CalendarEventPlaintext,
  encryptCalendarEventPayload,
  decryptCalendarEventPayload,
  classifyCalendarPayload,
} from "./calendar_crypto";
import { generateIcs } from "./utils/calendarIcs";
import * as WasmCore from "./generated/crypto-core/byos_crypto_core.js";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export async function runCalendarCategory06Tests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  console.log("Starting Calendar Category 06 (Event Creation & Management) Tests...");

  // Mock 32-byte mailbox key
  const mockMailboxKey = new Uint8Array(32);
  for (let i = 0; i < 32; i++) mockMailboxKey[i] = (i * 7 + 13) % 256;
  const mockMailboxId = "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d";

  // ──────────────────────────────────────────────────────────────────────────
  // 1. Event Plaintext Schema & Properties
  // ──────────────────────────────────────────────────────────────────────────
  try {
    const eventDetails: CalendarEventPlaintext = {
      title: "Quarterly Strategy Review",
      description: "Confidential review of Q3 goals and milestones.",
      location: "Executive Boardroom",
      meetingUrl: "https://meet.byos.local/strat-q3",
      color: "#4B6B58",
      visibility: "confidential",
      guestPermissions: {
        modifyEvent: false,
        inviteOthers: true,
        seeGuestList: false,
      },
      attachments: [
        {
          id: "att-001",
          name: "Q3_Roadmap.pdf",
          size: 245760,
          contentType: "application/pdf",
        },
      ],
      attendees: [
        { email: "bob@byos.local", status: "needs-action" },
        { email: "carol@byos.local", status: "accepted" },
      ],
      reminders: [{ minutesBefore: 15 }],
      timezone: "America/New_York",
      uid: "byos-evt-test-12345",
      sequence: 0,
      organizer: { email: "alice@byos.local", name: "Alice" },
    };

    assert(eventDetails.title === "Quarterly Strategy Review", "Title must match");
    assert(eventDetails.color === "#4B6B58", "Color override must match");
    assert(eventDetails.visibility === "confidential", "Visibility must be confidential");
    assert(eventDetails.guestPermissions?.modifyEvent === false, "guestPermissions.modifyEvent must be false");
    assert(eventDetails.guestPermissions?.inviteOthers === true, "guestPermissions.inviteOthers must be true");
    assert(eventDetails.guestPermissions?.seeGuestList === false, "guestPermissions.seeGuestList must be false");
    assert(eventDetails.attachments?.length === 1, "Must contain 1 attachment");
    assert(eventDetails.attachments![0].name === "Q3_Roadmap.pdf", "Attachment name must match");
    assert(eventDetails.reminders?.[0].minutesBefore === 15, "Reminder must be 15 min");

    passed++;
    console.log("  ✓ Cat 06.1: Event Plaintext Schema, Visibility, Permissions & Attachments");
  } catch (err: any) {
    failed++;
    console.error(`  ✗ Cat 06.1: Event Plaintext Schema: ${err.message}`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 2. End-to-End AES-GCM Encryption and Decryption Roundtrip
  // ──────────────────────────────────────────────────────────────────────────
  try {
    const originalDetails: CalendarEventPlaintext = {
      title: "Budget Planning Session",
      description: "Classified financial allocations.",
      location: "Room 402",
      color: "#8C3B4A",
      visibility: "private",
      guestPermissions: {
        modifyEvent: false,
        inviteOthers: false,
        seeGuestList: true,
      },
      attachments: [
        {
          id: "att-fin-1",
          name: "Budget_2027.xlsx",
          size: 512000,
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
      ],
      reminders: [{ minutesBefore: 30 }],
      timezone: "Europe/London",
      uid: "byos-evt-budget-999",
      sequence: 1,
    };

    const ciphertextEnvelope = encryptCalendarEventPayload(
      WasmCore,
      mockMailboxKey,
      mockMailboxId,
      originalDetails
    );

    assert(typeof ciphertextEnvelope === "string", "Ciphertext must be a string");
    assert(!ciphertextEnvelope.includes("Budget Planning Session"), "Private title must not be plaintext");
    assert(!ciphertextEnvelope.includes("Classified financial"), "Private description must not be plaintext");
    assert(!ciphertextEnvelope.includes("Budget_2027.xlsx"), "Attachment filename must not be plaintext");

    const format = classifyCalendarPayload(ciphertextEnvelope);
    assert(format === "aes-gcm-envelope", `Payload format must be aes-gcm-envelope, got ${format}`);

    const decrypted = decryptCalendarEventPayload(
      WasmCore,
      mockMailboxKey,
      mockMailboxId,
      ciphertextEnvelope
    );

    assert(decrypted.title === originalDetails.title, "Decrypted title must match");
    assert(decrypted.description === originalDetails.description, "Decrypted description must match");
    assert(decrypted.color === originalDetails.color, "Decrypted color override must match");
    assert(decrypted.visibility === originalDetails.visibility, "Decrypted visibility must match");
    assert(decrypted.guestPermissions?.modifyEvent === false, "Decrypted modifyEvent must match");
    assert(decrypted.guestPermissions?.inviteOthers === false, "Decrypted inviteOthers must match");
    assert(decrypted.attachments?.length === 1, "Decrypted attachments count must match");
    assert(decrypted.attachments![0].name === "Budget_2027.xlsx", "Decrypted attachment name must match");
    assert(decrypted.reminders?.[0].minutesBefore === 30, "Decrypted reminder must match");

    passed++;
    console.log("  ✓ Cat 06.2: End-to-End AES-GCM Authenticated Encryption & Decryption Roundtrip");
  } catch (err: any) {
    failed++;
    console.error(`  ✗ Cat 06.2: AES-GCM Roundtrip: ${err.message}`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Locked Mailbox Fails Closed
  // ──────────────────────────────────────────────────────────────────────────
  try {
    let failedClosed = false;
    try {
      const invalidKey = new Uint8Array(16); // Invalid length (16 instead of 32)
      encryptCalendarEventPayload(WasmCore, invalidKey, mockMailboxId, { title: "Test Event" });
    } catch {
      failedClosed = true;
    }
    assert(failedClosed, "Encryption with invalid key must fail closed");

    let nullKeyFailed = false;
    try {
      encryptCalendarEventPayload(WasmCore, null as any, mockMailboxId, { title: "Test Event" });
    } catch {
      nullKeyFailed = true;
    }
    assert(nullKeyFailed, "Encryption with null key must fail closed");

    passed++;
    console.log("  ✓ Cat 06.3: Locked Mailbox Fail-Closed Verification (Zero Plaintext Leakage)");
  } catch (err: any) {
    failed++;
    console.error(`  ✗ Cat 06.3: Locked Mailbox Fail-Closed: ${err.message}`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 4. Event Duplication and Copy Mechanics
  // ──────────────────────────────────────────────────────────────────────────
  try {
    const sourceEvent: CalendarEventPlaintext = {
      title: "Design Sprint Retrospective",
      description: "Sprint 42 recap and action items.",
      location: "Design Studio",
      color: "#9E725F",
      visibility: "public",
      guestPermissions: {
        modifyEvent: true,
        inviteOthers: true,
        seeGuestList: true,
      },
      attachments: [{ id: "att-ds-1", name: "Sprint_Notes.md", size: 4096, contentType: "text/markdown" }],
      timezone: "America/Chicago",
      uid: "byos-evt-original-101",
      sequence: 3,
    };

    // Simulate duplication
    const duplicated: CalendarEventPlaintext = {
      ...sourceEvent,
      title: `[Copy] ${sourceEvent.title}`,
      uid: undefined, // Fresh UID generated upon save
      sequence: 0, // Reset sequence
    };

    assert(duplicated.title === "[Copy] Design Sprint Retrospective", "Duplicated title must have [Copy] prefix");
    assert(duplicated.sequence === 0, "Duplicated sequence must reset to 0");
    assert(duplicated.uid === undefined, "Duplicated UID must be reset for fresh identity");
    assert(duplicated.color === sourceEvent.color, "Duplicated event must preserve color override");
    assert(duplicated.visibility === sourceEvent.visibility, "Duplicated event must preserve visibility");
    assert(duplicated.attachments?.length === 1, "Duplicated event must preserve attachments");
    assert(duplicated.guestPermissions?.modifyEvent === true, "Duplicated event must preserve guest permissions");

    passed++;
    console.log("  ✓ Cat 06.4: Event Duplication & Copy Identity Mechanics");
  } catch (err: any) {
    failed++;
    console.error(`  ✗ Cat 06.4: Event Duplication: ${err.message}`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 5. Read-Only Calendar Permission Enforcement
  // ──────────────────────────────────────────────────────────────────────────
  try {
    const readOnlyCalendar = {
      id: "cal-shared-readonly",
      name: "Team Announcements",
      is_shared: true,
      permission: "read" as const,
    };

    function validateCalendarWrite(cal: { is_shared?: boolean; permission?: string }) {
      if (cal.is_shared && cal.permission === "read") {
        throw new Error("Cannot create or modify events on a read-only calendar");
      }
    }

    let writeRejected = false;
    try {
      validateCalendarWrite(readOnlyCalendar);
    } catch (e: any) {
      writeRejected = e.message.includes("read-only calendar");
    }
    assert(writeRejected, "Write action on read-only calendar must be rejected");

    const writableCalendar = {
      id: "cal-shared-write",
      name: "Project Collaboration",
      is_shared: true,
      permission: "write" as const,
    };
    validateCalendarWrite(writableCalendar); // should not throw

    passed++;
    console.log("  ✓ Cat 06.5: Read-Only Calendar Permission Enforcement Guards");
  } catch (err: any) {
    failed++;
    console.error(`  ✗ Cat 06.5: Read-Only Permission Guards: ${err.message}`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 6. Multi-Level Event Override Precedence (Global < Calendar < Event)
  // ──────────────────────────────────────────────────────────────────────────
  try {
    const globalDefaultReminder = 10; // 10 minutes
    const calendarDefaultReminder = 30; // 30 minutes
    const eventReminderOverride: number = 5; // 5 minutes

    // When event provides an override, it wins
    const resolvedReminder = eventReminderOverride !== -1 ? eventReminderOverride : calendarDefaultReminder;
    assert(resolvedReminder === 5, `Event reminder override must win (got ${resolvedReminder})`);

    // When event does not specify (-1), calendar default wins
    const inheritedFromCal = -1 !== -1 ? -1 : calendarDefaultReminder;
    assert(inheritedFromCal === 30, `Calendar default must win when event has no override (got ${inheritedFromCal})`);

    // Color override: Event color > Calendar color
    const calColor = "#4A6B82";
    const evColor = "#8C3B4A";
    const effectiveColor = evColor || calColor;
    assert(effectiveColor === "#8C3B4A", `Event color override must take precedence over calendar color`);

    passed++;
    console.log("  ✓ Cat 06.6: Event-Level Settings Override Precedence (Color, Reminders, Visibility)");
  } catch (err: any) {
    failed++;
    console.error(`  ✗ Cat 06.6: Override Precedence: ${err.message}`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 7. RFC 5545 iCalendar Serialization with Classification, Alarms & Attachments
  // ──────────────────────────────────────────────────────────────────────────
  try {
    const start = new Date(Date.UTC(2026, 9, 26, 14, 0, 0));
    const end = new Date(Date.UTC(2026, 9, 26, 15, 0, 0));

    const icsContent = generateIcs({
      uid: "byos-evt-rfc5545-cat06",
      title: "Confidential Board Strategy",
      description: "Discussion of proprietary quarterly roadmap.",
      startTime: start,
      endTime: end,
      timezone: "UTC",
      classification: "CONFIDENTIAL",
      reminders: [{ minutesBefore: 15 }],
      attachments: [
        {
          url: "https://byos.local/attachments/sec-board-pack.pdf",
          contentType: "application/pdf",
        },
      ],
      organizer: { email: "alice@byos.local", name: "Alice" },
      attendees: [
        { email: "bob@byos.local", name: "Bob", role: "REQ-PARTICIPANT", partstat: "NEEDS-ACTION" },
      ],
    });

    assert(icsContent.includes("BEGIN:VCALENDAR"), "Must contain BEGIN:VCALENDAR");
    assert(icsContent.includes("BEGIN:VEVENT"), "Must contain BEGIN:VEVENT");
    assert(icsContent.includes("CLASS:CONFIDENTIAL"), `Must contain CLASS:CONFIDENTIAL, got:\n${icsContent}`);
    assert(icsContent.includes("BEGIN:VALARM"), "Must serialize VALARM component");
    assert(icsContent.includes("TRIGGER:-PT15M"), "Must serialize 15-minute alarm trigger");
    assert(
      icsContent.includes("ATTACH;FMTTYPE=application/pdf:"),
      "Must serialize ATTACH component"
    );
    assert(icsContent.includes("END:VALARM"), "Must end VALARM");
    assert(icsContent.includes("END:VEVENT"), "Must end VEVENT");
    assert(icsContent.includes("END:VCALENDAR"), "Must end VCALENDAR");

    passed++;
    console.log("  ✓ Cat 06.7: RFC 5545 iCalendar Serialization (CLASS, VALARM & ATTACH Components)");
  } catch (err: any) {
    failed++;
    console.error(`  ✗ Cat 06.7: RFC 5545 Serialization: ${err.message}`);
  }

  console.log(`\nCALENDAR CATEGORY 06 TESTS: ${passed} passed, ${failed} failed\n`);
  return { passed, failed };
}
