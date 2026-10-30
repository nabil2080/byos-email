import {
  parseRRule,
  buildRRuleString,
  expandEventOccurrences,
  normalizeRecurrenceId,
  EventExceptionInput,
  ParsedRRule,
} from "./utils/calendarRrule";
import {
  encryptCalendarEventPayload,
  decryptCalendarEventPayload,
  CalendarEventPlaintext,
} from "./calendar_crypto";
import { generateIcs, parseIcs, groupSeriesEvents } from "./utils/calendarIcs";
import * as WasmCore from "./generated/crypto-core/byos_crypto_core.js";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

export function runCalendarCategory07Tests() {
  let passed = 0;
  let failed = 0;

  function test(name: string, fn: () => void) {
    try {
      fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (e) {
      console.error(`  ✗ ${name}:`, e);
      failed++;
    }
  }

  console.log("Starting Calendar Category 07 (Recurrence & Advanced Scheduling Rules) Tests...");

  // 1. Cat 07.1: Recurrence Rule Parsing & Building (Daily, Weekly, Monthly, Yearly)
  test("Cat 07.1: Recurrence Rule Parsing & Serialization Roundtrip", () => {
    const dailyRule = parseRRule("FREQ=DAILY;INTERVAL=3");
    assert(dailyRule !== null, "daily rule parsed");
    assert(dailyRule!.freq === "DAILY" && dailyRule!.interval === 3, "daily freq and interval match");
    assert(buildRRuleString(dailyRule!) === "FREQ=DAILY;INTERVAL=3", "daily serialization matches");

    const weeklyRule = parseRRule("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR;COUNT=15");
    assert(weeklyRule !== null, "weekly rule parsed");
    assert(weeklyRule!.freq === "WEEKLY" && weeklyRule!.interval === 2, "weekly interval matches");
    assert(weeklyRule!.byDay?.join(",") === "MO,WE,FR", "weekly byDay matches");
    assert(weeklyRule!.count === 15, "weekly count matches");
    assert(
      buildRRuleString(weeklyRule!) === "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR;COUNT=15",
      "weekly serialization matches"
    );

    const untilDate = new Date(Date.UTC(2026, 11, 31, 23, 59, 59));
    const monthlyRule = parseRRule("FREQ=MONTHLY;INTERVAL=1;UNTIL=20261231T235959Z");
    assert(monthlyRule !== null, "monthly rule parsed");
    assert(monthlyRule!.freq === "MONTHLY", "monthly freq matches");
    assert(monthlyRule!.until?.toISOString() === untilDate.toISOString(), "until date matches UTC");
  });

  // 2. Cat 07.2: Custom Interval & Multi-Day Weekly Rules Expansion
  test("Cat 07.2: Custom Interval & Multi-Day Weekly Rules (Bi-Weekly Tue/Thu)", () => {
    // Starts on Tuesday 2026-10-06
    const start = new Date("2026-10-06T10:00:00Z");
    const end = new Date("2026-10-06T11:00:00Z");
    const windowStart = new Date("2026-10-01T00:00:00Z");
    const windowEnd = new Date("2026-10-31T23:59:59Z"); // 4 full weeks

    const occurrences = expandEventOccurrences(
      "master-biweekly",
      start,
      end,
      "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH",
      windowStart,
      windowEnd,
      50
    );

    // Week 1 (Oct 4 - Oct 10): Tue Oct 6, Thu Oct 8 -> 2 occurrences
    // Week 2 (Oct 11 - Oct 17): Skipped (interval 2) -> 0 occurrences
    // Week 3 (Oct 18 - Oct 24): Tue Oct 20, Thu Oct 22 -> 2 occurrences
    // Week 4 (Oct 25 - Oct 31): Skipped (interval 2) -> 0 occurrences
    assert(occurrences.length === 4, `expected exactly 4 occurrences, got ${occurrences.length}`);
    assert(occurrences[0].startTime.toISOString() === "2026-10-06T10:00:00.000Z", "week 1 Tuesday match");
    assert(occurrences[1].startTime.toISOString() === "2026-10-08T10:00:00.000Z", "week 1 Thursday match");
    assert(occurrences[2].startTime.toISOString() === "2026-10-20T10:00:00.000Z", "week 3 Tuesday match");
    assert(occurrences[3].startTime.toISOString() === "2026-10-22T10:00:00.000Z", "week 3 Thursday match");
  });

  // 3. Cat 07.3: COUNT and UNTIL Bounded Termination & Determinism
  test("Cat 07.3: COUNT and UNTIL Bounded Termination Safeguards", () => {
    const start = new Date("2026-10-01T09:00:00Z");
    const end = new Date("2026-10-01T10:00:00Z");
    const wideWindowStart = new Date("2026-01-01T00:00:00Z");
    const wideWindowEnd = new Date("2035-12-31T23:59:59Z");

    // COUNT = 5
    const countOccurrences = expandEventOccurrences(
      "evt-count",
      start,
      end,
      "FREQ=DAILY;COUNT=5",
      wideWindowStart,
      wideWindowEnd
    );
    assert(countOccurrences.length === 5, `COUNT=5 must produce exactly 5 occurrences, got ${countOccurrences.length}`);
    assert(
      countOccurrences[4].startTime.toISOString() === "2026-10-05T09:00:00.000Z",
      "5th occurrence date match"
    );

    // UNTIL = 2026-10-04T23:59:59Z
    const untilOccurrences = expandEventOccurrences(
      "evt-until",
      start,
      end,
      "FREQ=DAILY;UNTIL=20261004T235959Z",
      wideWindowStart,
      wideWindowEnd
    );
    assert(untilOccurrences.length === 4, `UNTIL must produce exactly 4 occurrences, got ${untilOccurrences.length}`);
    assert(
      untilOccurrences[3].startTime.toISOString() === "2026-10-04T09:00:00.000Z",
      "4th occurrence date match"
    );

    // Max occurrences limit bounds runaway rules
    const boundedOccurrences = expandEventOccurrences(
      "evt-infinite",
      start,
      end,
      "FREQ=DAILY",
      wideWindowStart,
      wideWindowEnd,
      25
    );
    assert(boundedOccurrences.length === 25, `Must cap expansion at maxOccurrences=25, got ${boundedOccurrences.length}`);
  });

  // 4. Cat 07.4: Date Boundary Correctness (Month-End & Leap Years)
  test("Cat 07.4: Date Boundary Correctness (Month-End & Leap Years)", () => {
    // 31st of the month rule (Jan 31, 2026)
    const jan31 = new Date("2026-01-31T12:00:00Z");
    const jan31End = new Date("2026-01-31T13:00:00Z");
    const windowStart = new Date("2026-01-01T00:00:00Z");
    const windowEnd = new Date("2026-05-31T23:59:59Z");

    const monthOccurrences = expandEventOccurrences(
      "evt-month-end",
      jan31,
      jan31End,
      "FREQ=MONTHLY;INTERVAL=1",
      windowStart,
      windowEnd
    );

    assert(monthOccurrences.length === 5, `expected 5 months (Jan-May), got ${monthOccurrences.length}`);
    // Jan 31
    assert(monthOccurrences[0].startTime.getDate() === 31, "Jan has 31 days");
    // Feb 28 (2026 is non-leap year)
    assert(
      monthOccurrences[1].startTime.getMonth() === 1 && monthOccurrences[1].startTime.getDate() === 28,
      "Feb clamped to 28"
    );
    // Mar 31 (restored to 31)
    assert(
      monthOccurrences[2].startTime.getMonth() === 2 && monthOccurrences[2].startTime.getDate() === 31,
      "Mar restored to 31"
    );
    // Apr 30
    assert(
      monthOccurrences[3].startTime.getMonth() === 3 && monthOccurrences[3].startTime.getDate() === 30,
      "Apr clamped to 30"
    );
    // May 31
    assert(
      monthOccurrences[4].startTime.getMonth() === 4 && monthOccurrences[4].startTime.getDate() === 31,
      "May restored to 31"
    );

    // Leap year Feb 29 rule (Feb 29, 2024)
    const leapStart = new Date("2024-02-29T15:00:00Z");
    const leapEnd = new Date("2024-02-29T16:00:00Z");
    const leapWindowEnd = new Date("2028-12-31T23:59:59Z");

    const leapOccurrences = expandEventOccurrences(
      "evt-leap",
      leapStart,
      leapEnd,
      "FREQ=YEARLY;INTERVAL=1",
      new Date("2024-01-01T00:00:00Z"),
      leapWindowEnd
    );

    assert(leapOccurrences.length === 5, `expected 5 years (2024-2028), got ${leapOccurrences.length}`);
    assert(leapOccurrences[0].startTime.getFullYear() === 2024 && leapOccurrences[0].startTime.getDate() === 29, "2024 leap day");
    assert(leapOccurrences[1].startTime.getFullYear() === 2025 && leapOccurrences[1].startTime.getDate() === 28, "2025 clamped to 28");
    assert(leapOccurrences[2].startTime.getFullYear() === 2026 && leapOccurrences[2].startTime.getDate() === 28, "2026 clamped to 28");
    assert(leapOccurrences[3].startTime.getFullYear() === 2027 && leapOccurrences[3].startTime.getDate() === 28, "2027 clamped to 28");
    assert(leapOccurrences[4].startTime.getFullYear() === 2028 && leapOccurrences[4].startTime.getDate() === 29, "2028 restored to 29");
  });

  // 5. Cat 07.5: Detached Modified Occurrences (Time, Title & Color Overrides)
  test("Cat 07.5: Detached Modified Occurrences (Preserves Stable Recurrence-ID)", () => {
    const start = new Date("2026-10-01T10:00:00Z");
    const end = new Date("2026-10-01T11:00:00Z");
    const windowStart = new Date("2026-10-01T00:00:00Z");
    const windowEnd = new Date("2026-10-07T23:59:59Z");

    const masterPlaintext: CalendarEventPlaintext = {
      title: "Daily Standup",
      color: "#9E725F",
    };

    const detachedExceptionPlaintext: CalendarEventPlaintext = {
      title: "Extended Retrospective",
      color: "#059669",
      visibility: "confidential",
    };

    // Detached modified occurrence on Day 3 (2026-10-03) moved to 14:00 - 15:30
    const exceptions: EventExceptionInput[] = [
      {
        id: "exc-day-3",
        parentEventId: "master-standup",
        recurrenceId: "2026-10-03T10:00:00.000Z", // stable original identity
        isCancelled: false,
        startTime: new Date("2026-10-03T14:00:00Z"),
        endTime: new Date("2026-10-03T15:30:00Z"),
        payload: detachedExceptionPlaintext,
      },
    ];

    const occurrences = expandEventOccurrences(
      "master-standup",
      start,
      end,
      "FREQ=DAILY;COUNT=7",
      windowStart,
      windowEnd,
      50,
      exceptions
    );

    assert(occurrences.length === 7, `must contain 7 occurrences, got ${occurrences.length}`);

    // Day 1: normal master
    assert(occurrences[0].startTime.toISOString() === "2026-10-01T10:00:00.000Z", "day 1 start time");
    assert(!occurrences[0].isException, "day 1 is master occurrence");

    // Day 3: detached exception
    const day3 = occurrences.find((o) => o.id === "exc-day-3");
    assert(Boolean(day3), "day 3 detached exception found");
    assert(day3!.isException === true, "day 3 has isException=true");
    assert(day3!.recurrenceId === "2026-10-03T10:00:00.000Z", "day 3 preserves original recurrenceId");
    assert(day3!.startTime.toISOString() === "2026-10-03T14:00:00.000Z", "day 3 moved start time");
    assert(day3!.endTime.toISOString() === "2026-10-03T15:30:00.000Z", "day 3 moved end time");
    assert((day3!.payload as CalendarEventPlaintext).title === "Extended Retrospective", "day 3 title override");
    assert((day3!.payload as CalendarEventPlaintext).color === "#059669", "day 3 color override");
  });

  // 6. Cat 07.6: Persistent Cancelled Occurrences & EXDATE Reconciliation
  test("Cat 07.6: Persistent Cancelled Occurrences & EXDATE Reconciliation", () => {
    const start = new Date("2026-10-01T10:00:00Z");
    const end = new Date("2026-10-01T11:00:00Z");
    const windowStart = new Date("2026-10-01T00:00:00Z");
    const windowEnd = new Date("2026-10-07T23:59:59Z");

    // Cancelled occurrence on Day 4 via exception record
    const cancellationException: EventExceptionInput = {
      id: "exc-cancel-day-4",
      parentEventId: "master-daily",
      recurrenceId: "2026-10-04T10:00:00.000Z",
      isCancelled: true,
      startTime: new Date("2026-10-04T10:00:00Z"),
      endTime: new Date("2026-10-04T11:00:00Z"),
    };

    // Excluded date on Day 6 via RFC 5545 EXDATE
    const exdates = ["2026-10-06T10:00:00.000Z"];

    const occurrences = expandEventOccurrences(
      "master-daily",
      start,
      end,
      "FREQ=DAILY;COUNT=7",
      windowStart,
      windowEnd,
      50,
      [cancellationException],
      exdates
    );

    // 7 initial - 1 cancelled - 1 exdate = 5 active occurrences
    assert(occurrences.length === 5, `expected 5 occurrences after cancellations, got ${occurrences.length}`);

    const hasDay4 = occurrences.some((o) => o.startTime.toISOString().startsWith("2026-10-04"));
    assert(!hasDay4, "cancelled day 4 must be suppressed");

    const hasDay6 = occurrences.some((o) => o.startTime.toISOString().startsWith("2026-10-06"));
    assert(!hasDay6, "exdate day 6 must be suppressed");
  });

  // 7. Cat 07.7: Series Edits & Orphaned Exceptions Cascading Isolation
  test("Cat 07.7: Series Edits & Orphaned Exceptions Cascading Isolation", () => {
    // Simulated master and child exception store
    const masterEvents = new Map<string, { id: string; title: string; rrule: string }>();
    const childExceptions = new Map<string, { id: string; parentId: string; recurrenceId: string }>();

    // 1. Create series with master and 2 exceptions
    const seriesId = "series-uuid-101";
    masterEvents.set(seriesId, {
      id: seriesId,
      title: "Weekly Engineering",
      rrule: "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO",
    });

    childExceptions.set("exc-1", {
      id: "exc-1",
      parentId: seriesId,
      recurrenceId: "2026-10-12T09:00:00.000Z",
    });
    childExceptions.set("exc-2", {
      id: "exc-2",
      parentId: seriesId,
      recurrenceId: "2026-10-19T09:00:00.000Z",
    });

    assert(childExceptions.size === 2, "initial 2 exceptions exist");

    // 2. Modify master series (e.g. title update) -> preserves exceptions
    const existing = masterEvents.get(seriesId)!;
    masterEvents.set(seriesId, {
      ...existing,
      title: "Updated Weekly Engineering Series",
    });
    assert(childExceptions.size === 2, "modifying master title preserves child exceptions");
    assert(childExceptions.get("exc-1")?.parentId === seriesId, "exception 1 maintains valid foreign key");

    // 3. Delete master series -> simulates ON DELETE CASCADE
    masterEvents.delete(seriesId);
    for (const [key, exc] of childExceptions.entries()) {
      if (!masterEvents.has(exc.parentId)) {
        childExceptions.delete(key);
      }
    }

    assert(masterEvents.size === 0, "master event deleted");
    assert(childExceptions.size === 0, "no orphaned exceptions remain after master series deletion");
  });

  // 8. Cat 07.8: Cryptographic Boundary & Zero Plaintext Leakage
  test("Cat 07.8: Cryptographic Boundary & Zero Plaintext Leakage", () => {
    const rawKey = new Uint8Array(32);
    crypto.getRandomValues(rawKey);
    const mailboxId = "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d";

    const masterDetails: CalendarEventPlaintext = {
      title: "Executive Architecture Council",
      description: "Restricted board-level agenda with confidential financial updates",
      visibility: "confidential",
    };

    const exceptionDetails: CalendarEventPlaintext = {
      title: "Executive Architecture Council - Emergency Session",
      description: "Immediate incident remediation and key rollover",
      visibility: "confidential",
      color: "#DC2626",
    };

    // Encrypt master and exception
    const masterCiphertext = encryptCalendarEventPayload(WasmCore, rawKey, mailboxId, masterDetails);
    const exceptionCiphertext = encryptCalendarEventPayload(WasmCore, rawKey, mailboxId, exceptionDetails);

    // Assert zero plaintext in ciphertexts
    assert(!masterCiphertext.includes("Executive Architecture"), "master ciphertext leaks zero plaintext");
    assert(!masterCiphertext.includes("confidential financial"), "master payload leaks zero description");
    assert(!exceptionCiphertext.includes("Emergency Session"), "exception ciphertext leaks zero plaintext");

    // Decrypt with correct key succeeds
    const decryptedMaster = decryptCalendarEventPayload(WasmCore, rawKey, mailboxId, masterCiphertext);
    assert(decryptedMaster.title === masterDetails.title, "decrypted master title matches");
    assert(decryptedMaster.visibility === "confidential", "decrypted master visibility matches");

    const decryptedException = decryptCalendarEventPayload(WasmCore, rawKey, mailboxId, exceptionCiphertext);
    assert(decryptedException.title === exceptionDetails.title, "decrypted exception title matches");
    assert(decryptedException.color === "#DC2626", "decrypted exception color matches");

    // Locked mailbox (wrong key) fails closed
    const wrongKey = new Uint8Array(32);
    crypto.getRandomValues(wrongKey);
    const failClosedResult = decryptCalendarEventPayload(WasmCore, wrongKey, mailboxId, exceptionCiphertext);
    assert(
      failClosedResult.title === "(Encrypted Event - Unable to Decrypt)",
      "decrypting exception with wrong key fails closed with safe fallback"
    );
  });

  // 9. Cat 07.9: RFC 5545 iCalendar Serialization & Reconciliation
  test("Cat 07.9: RFC 5545 iCalendar Serialization & Reconciliation", () => {
    const start = new Date("2026-10-05T09:00:00Z");
    const end = new Date("2026-10-05T10:00:00Z");

    const icsText = generateIcs({
      uid: "byos-evt-recur-12345",
      method: "REQUEST",
      title: "Quarterly OKR Planning",
      startTime: start,
      endTime: end,
      rrule: "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;COUNT=8",
      exdates: ["2026-10-19T09:00:00.000Z"],
      exceptions: [
        {
          recurrenceId: "2026-10-12T09:00:00.000Z",
          startTime: new Date("2026-10-12T13:00:00Z"),
          endTime: new Date("2026-10-12T14:30:00Z"),
          title: "Quarterly OKR Planning (Extended)",
        },
      ],
    });

    assert(icsText.includes("RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;COUNT=8"), "ICS contains RRULE");
    assert(icsText.includes("RECURRENCE-ID:20261012T090000Z"), "ICS contains RECURRENCE-ID");
    assert(icsText.includes("EXDATE:20261019T090000Z"), "ICS contains EXDATE");

    // Parse back
    const parsed = parseIcs(icsText);
    assert(parsed.events.length === 2, `expected master + 1 exception = 2 VEVENTs, got ${parsed.events.length}`);

    const { series } = groupSeriesEvents(parsed.events);
    assert(series.length === 1, `expected 1 recurring series, got ${series.length}`);
    assert(series[0].master.rrule === "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;COUNT=8", "parsed master rrule matches");
    assert(series[0].exceptions.length === 1, "parsed 1 exception");
    assert(series[0].cancelledRecurrenceIds.length >= 1, "parsed cancelled EXDATE");
  });

  console.log(`\nCALENDAR CATEGORY 07 TESTS: ${passed} passed, ${failed} failed\n`);
  return { passed, failed };
}
