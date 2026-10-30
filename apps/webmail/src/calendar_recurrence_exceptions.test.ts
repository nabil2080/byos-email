import {
  encryptCalendarEventPayload,
  decryptCalendarEventPayload,
  type CalendarEventPlaintext,
} from "./calendar_crypto";
import {
  expandEventOccurrences,
  normalizeRecurrenceId,
  type EventExceptionInput,
} from "./utils/calendarRrule";
import {
  generateIcs,
  parseIcs,
  groupSeriesEvents,
} from "./utils/calendarIcs";
import * as WasmCore from "./generated/crypto-core/byos_crypto_core.js";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

interface StoredExceptionRecord {
  id: string;
  parent_event_id: string;
  mailbox_id: string;
  calendar_id: string;
  recurrence_id: string;
  is_cancelled: boolean;
  start_time: string;
  end_time: string;
  is_all_day: boolean;
  status: string;
  encrypted_payload: string;
}

interface StoredEventRecord {
  id: string;
  mailbox_id: string;
  calendar_id: string;
  start_time: string;
  end_time: string;
  is_all_day: boolean;
  rrule?: string;
  status: string;
  encrypted_payload: string;
  exceptions?: StoredExceptionRecord[];
}

/**
 * Controller executing the recurrence exception persistence workflow from CalendarView.tsx
 */
class RecurrencePersistenceController {
  private events: Map<string, StoredEventRecord> = new Map();
  private exceptions: Map<string, StoredExceptionRecord> = new Map();
  private nextId = 1;

  get storedEvents(): StoredEventRecord[] {
    return Array.from(this.events.values()).map((ev) => ({
      ...ev,
      exceptions: Array.from(this.exceptions.values()).filter(
        (ex) => ex.parent_event_id === ev.id
      ),
    }));
  }

  seedEvent(ev: StoredEventRecord) {
    this.events.set(ev.id, { ...ev });
  }

  async createException(
    mailboxId: string,
    mailboxKey: Uint8Array | null,
    parentId: string,
    params: {
      recurrenceId: string;
      isCancelled: boolean;
      startTime: Date;
      endTime: Date;
      isAllDay?: boolean;
      status?: string;
      details?: CalendarEventPlaintext;
    }
  ): Promise<StoredExceptionRecord> {
    if (!mailboxKey || mailboxKey.length !== 32) {
      throw new Error("Mailbox is locked. Unlock your mailbox to create or edit events.");
    }
    const parent = this.events.get(parentId);
    if (!parent || parent.mailbox_id !== mailboxId) {
      throw new Error("Parent event not found");
    }

    const payloadDetails = params.details || {
      title: params.isCancelled ? "(Cancelled)" : "(Modified Event)",
      description: "",
      location: "",
      attendees: [],
    };

    const encryptedPayload = encryptCalendarEventPayload(
      WasmCore,
      mailboxKey,
      mailboxId,
      payloadDetails
    );

    const id = `exc-${this.nextId++}`;
    const excRecord: StoredExceptionRecord = {
      id,
      parent_event_id: parentId,
      mailbox_id: mailboxId,
      calendar_id: parent.calendar_id,
      recurrence_id: normalizeRecurrenceId(params.recurrenceId),
      is_cancelled: params.isCancelled,
      start_time: params.startTime.toISOString(),
      end_time: params.endTime.toISOString(),
      is_all_day: Boolean(params.isAllDay),
      status: params.status || (params.isCancelled ? "free" : "busy"),
      encrypted_payload: encryptedPayload,
    };

    // Unique constraint: upsert on (parent_event_id, recurrence_id)
    for (const [existingId, existing] of this.exceptions.entries()) {
      if (
        existing.parent_event_id === parentId &&
        existing.recurrence_id === excRecord.recurrence_id
      ) {
        this.exceptions.set(existingId, { ...excRecord, id: existingId });
        return { ...excRecord, id: existingId };
      }
    }

    this.exceptions.set(id, excRecord);
    return excRecord;
  }

  deleteEvent(parentId: string) {
    this.events.delete(parentId);
    // ON DELETE CASCADE
    for (const [excId, exc] of this.exceptions.entries()) {
      if (exc.parent_event_id === parentId) {
        this.exceptions.delete(excId);
      }
    }
  }

  deleteException(exceptionId: string) {
    this.exceptions.delete(exceptionId);
  }
}

export async function runCalendarRecurrenceExceptionTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  function test(name: string, fn: () => void | Promise<void>) {
    try {
      const res = fn();
      if (res && typeof (res as any).then === "function") {
        return (res as any).then(
          () => {
            console.log(`  ✓ ${name}`);
            passed++;
          },
          (err: any) => {
            console.error(`  ✗ ${name}:`, err);
            failed++;
          }
        );
      }
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (e) {
      console.error(`  ✗ ${name}:`, e);
      failed++;
    }
  }

  console.log("Running Calendar Recurrence Exceptions & Interoperability Tests...");

  const mailboxId = "12345678-1234-1234-1234-1234567890ab";
  const mailboxKey = new Uint8Array(32);
  mailboxKey.fill(0x77);

  await test("1. Modifying a single occurrence creates encrypted detached exception without altering parent series", async () => {
    const controller = new RecurrencePersistenceController();
    const parentStart = new Date("2026-10-05T10:00:00Z");
    const parentEnd = new Date("2026-10-05T11:00:00Z");

    const parentPayload = encryptCalendarEventPayload(WasmCore, mailboxKey, mailboxId, {
      title: "Weekly Staff Sync",
      description: "Standard weekly meeting",
      location: "Room 101",
    });

    controller.seedEvent({
      id: "series-1",
      mailbox_id: mailboxId,
      calendar_id: "cal-1",
      start_time: parentStart.toISOString(),
      end_time: parentEnd.toISOString(),
      is_all_day: false,
      rrule: "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO",
      status: "busy",
      encrypted_payload: parentPayload,
    });

    // Occurrence 2 is on 2026-10-12T10:00:00Z. Reschedule to 14:00-15:00 with modified title.
    const recurrenceId = "2026-10-12T10:00:00.000Z";
    const modStart = new Date("2026-10-12T14:00:00Z");
    const modEnd = new Date("2026-10-12T15:00:00Z");

    const exc = await controller.createException(mailboxId, mailboxKey, "series-1", {
      recurrenceId,
      isCancelled: false,
      startTime: modStart,
      endTime: modEnd,
      details: {
        title: "Rescheduled Staff Sync (Afternoon)",
        description: "Moved to afternoon for offsite guests",
        location: "Auditorium",
      },
    });

    assert(exc.recurrence_id === recurrenceId, "Exception retains original recurrence identity");
    assert(exc.parent_event_id === "series-1", "Exception points to parent event");
    assert(exc.is_cancelled === false, "is_cancelled is false");

    // Decrypt exception payload
    const decryptedExc = decryptCalendarEventPayload(WasmCore, mailboxKey, mailboxId, exc.encrypted_payload);
    assert(decryptedExc.title === "Rescheduled Staff Sync (Afternoon)", "Exception payload contains modified title");
    assert(decryptedExc.location === "Auditorium", "Exception payload contains modified location");

    // Verify parent event payload is untouched
    const parentEvent = controller.storedEvents.find((e) => e.id === "series-1")!;
    const decryptedParent = decryptCalendarEventPayload(WasmCore, mailboxKey, mailboxId, parentEvent.encrypted_payload);
    assert(decryptedParent.title === "Weekly Staff Sync", "Parent event payload remains intact");
  });

  await test("2. Cancelling an occurrence creates a cancellation exception and suppresses it from recurrence expansion", async () => {
    const controller = new RecurrencePersistenceController();
    const parentStart = new Date("2026-10-05T09:00:00Z");
    const parentEnd = new Date("2026-10-05T10:00:00Z");

    controller.seedEvent({
      id: "series-2",
      mailbox_id: mailboxId,
      calendar_id: "cal-1",
      start_time: parentStart.toISOString(),
      end_time: parentEnd.toISOString(),
      is_all_day: false,
      rrule: "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO",
      status: "busy",
      encrypted_payload: encryptCalendarEventPayload(WasmCore, mailboxKey, mailboxId, {
        title: "Sprint Planning",
      }),
    });

    // Cancel occurrence 3 on 2026-10-19T09:00:00Z
    const recurrenceId = "2026-10-19T09:00:00.000Z";
    await controller.createException(mailboxId, mailboxKey, "series-2", {
      recurrenceId,
      isCancelled: true,
      startTime: new Date("2026-10-19T09:00:00Z"),
      endTime: new Date("2026-10-19T10:00:00Z"),
    });

    // Expand series across October (4 Mondays: Oct 5, Oct 12, Oct 19, Oct 26)
    const windowStart = new Date("2026-10-01T00:00:00Z");
    const windowEnd = new Date("2026-10-31T23:59:59Z");

    const exceptions: EventExceptionInput[] = controller.storedEvents[0].exceptions!.map((ex) => ({
      id: ex.id,
      recurrenceId: ex.recurrence_id,
      isCancelled: ex.is_cancelled,
      startTime: new Date(ex.start_time),
      endTime: new Date(ex.end_time),
    }));

    const occurrences = expandEventOccurrences(
      "series-2",
      parentStart,
      parentEnd,
      "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO",
      windowStart,
      windowEnd,
      200,
      exceptions
    );

    assert(occurrences.length === 3, `Expected 3 occurrences after 1 cancellation, got ${occurrences.length}`);
    const oct19 = occurrences.find((o) => o.startTime.toISOString().startsWith("2026-10-19"));
    assert(!oct19, "Cancelled occurrence on 2026-10-19 must be completely excluded");
  });

  await test("3. Deleting the parent series cascades to delete all detached exceptions", async () => {
    const controller = new RecurrencePersistenceController();
    controller.seedEvent({
      id: "series-3",
      mailbox_id: mailboxId,
      calendar_id: "cal-1",
      start_time: "2026-10-01T10:00:00Z",
      end_time: "2026-10-01T11:00:00Z",
      is_all_day: false,
      rrule: "FREQ=DAILY;INTERVAL=1",
      status: "busy",
      encrypted_payload: encryptCalendarEventPayload(WasmCore, mailboxKey, mailboxId, { title: "Daily Standup" }),
    });

    await controller.createException(mailboxId, mailboxKey, "series-3", {
      recurrenceId: "2026-10-02T10:00:00.000Z",
      isCancelled: false,
      startTime: new Date("2026-10-02T12:00:00Z"),
      endTime: new Date("2026-10-02T12:30:00Z"),
    });

    await controller.createException(mailboxId, mailboxKey, "series-3", {
      recurrenceId: "2026-10-03T10:00:00.000Z",
      isCancelled: true,
      startTime: new Date("2026-10-03T10:00:00Z"),
      endTime: new Date("2026-10-03T11:00:00Z"),
    });

    assert(controller.storedEvents[0].exceptions!.length === 2, "Expected 2 exceptions before deletion");

    // Delete parent event
    controller.deleteEvent("series-3");
    assert(controller.storedEvents.length === 0, "Parent event deleted");
    assert(controller.storedEvents.every((e) => (e.exceptions?.length || 0) === 0), "All exceptions cascade deleted");
  });

  await test("4. Locked mailbox fails closed and rejects exception creation before persistence", async () => {
    const controller = new RecurrencePersistenceController();
    controller.seedEvent({
      id: "series-4",
      mailbox_id: mailboxId,
      calendar_id: "cal-1",
      start_time: "2026-10-01T10:00:00Z",
      end_time: "2026-10-01T11:00:00Z",
      is_all_day: false,
      rrule: "FREQ=DAILY",
      status: "busy",
      encrypted_payload: "valid-envelope",
    });

    let failed = false;
    try {
      await controller.createException(mailboxId, null, "series-4", {
        recurrenceId: "2026-10-02T10:00:00.000Z",
        isCancelled: false,
        startTime: new Date(),
        endTime: new Date(),
      });
    } catch (err: any) {
      failed = true;
      assert(err.message.includes("Mailbox is locked"), "Error message indicates locked mailbox");
    }
    assert(failed, "Exception creation with null mailbox key must fail closed");
    assert(controller.storedEvents[0].exceptions!.length === 0, "No exception stored in locked mailbox");
  });

  await test("5. RFC 5545 iCalendar export and import preserves series and detached exception linkage", async () => {
    const start = new Date("2026-10-05T10:00:00Z");
    const end = new Date("2026-10-05T11:00:00Z");
    const recId = new Date("2026-10-12T10:00:00Z");
    const excStart = new Date("2026-10-12T15:00:00Z");
    const excEnd = new Date("2026-10-12T16:00:00Z");

    const icsContent = generateIcs({
      uid: "series-ical-test-99",
      title: "Weekly Architecture Review",
      description: "Core team review",
      location: "Room A",
      startTime: start,
      endTime: end,
      rrule: "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO",
      exdates: [new Date("2026-10-19T10:00:00Z")],
      exceptions: [
        {
          recurrenceId: recId,
          startTime: excStart,
          endTime: excEnd,
          title: "Architecture Review (Special Session)",
          status: "CONFIRMED",
        },
      ],
      organizer: { name: "Bob Arch", email: "bob@byos.local" },
    });

    const parsed = parseIcs(icsContent);
    assert(parsed.events.length === 2, `Expected 2 events parsed from ICS, got ${parsed.events.length}`);

    const { series } = groupSeriesEvents(parsed.events);
    assert(series.length === 1, "Grouped into 1 recurring series");
    assert(series[0].master.summary === "Weekly Architecture Review", "Master summary match");
    assert(series[0].cancelledRecurrenceIds.length >= 1, "EXDATE recorded as cancellation");
    assert(series[0].exceptions.length === 1, "Detached exception attached");
    assert(series[0].exceptions[0].summary === "Architecture Review (Special Session)", "Exception summary match");
  });

  return { passed, failed };
}
