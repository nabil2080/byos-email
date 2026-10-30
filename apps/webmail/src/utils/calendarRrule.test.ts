import { parseRRule, buildRRuleString, expandEventOccurrences } from "./calendarRrule";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

export function runCalendarRruleTests() {
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

  test("parseRRule parses simple DAILY rule", () => {
    const rule = parseRRule("FREQ=DAILY;INTERVAL=2");
    assert(rule !== null, "rule should not be null");
    assert(rule!.freq === "DAILY", "freq should be DAILY");
    assert(rule!.interval === 2, "interval should be 2");
  });

  test("parseRRule parses WEEKLY with BYDAY and COUNT", () => {
    const rule = parseRRule("RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE,FR;COUNT=10");
    assert(rule !== null, "rule should not be null");
    assert(rule!.freq === "WEEKLY", "freq should be WEEKLY");
    assert(rule!.byDay?.join(",") === "MO,WE,FR", "byday should match");
    assert(rule!.count === 10, "count should be 10");
  });

  test("buildRRuleString formats correctly", () => {
    const str = buildRRuleString({
      freq: "WEEKLY",
      interval: 2,
      byDay: ["TU", "TH"],
      count: 5,
    });
    assert(str === "FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;COUNT=5", `unexpected string: ${str}`);
  });

  test("expandEventOccurrences expands DAILY within window", () => {
    const start = new Date("2026-10-01T10:00:00Z");
    const end = new Date("2026-10-01T11:00:00Z");
    const windowStart = new Date("2026-10-01T00:00:00Z");
    const windowEnd = new Date("2026-10-05T23:59:59Z");

    const occurrences = expandEventOccurrences(
      "event-1",
      start,
      end,
      "FREQ=DAILY;INTERVAL=1",
      windowStart,
      windowEnd
    );

    assert(occurrences.length === 5, `expected 5 occurrences, got ${occurrences.length}`);
    assert(occurrences[0].id === "event-1", "first occurrence should have base id");
    assert(occurrences[1].isOccurrence === true, "second should be an occurrence");
    assert(occurrences[1].startTime.toISOString() === "2026-10-02T10:00:00.000Z", "second date match");
  });

  test("expandEventOccurrences respects COUNT limit", () => {
    const start = new Date("2026-10-01T10:00:00Z");
    const end = new Date("2026-10-01T11:00:00Z");
    const windowStart = new Date("2026-10-01T00:00:00Z");
    const windowEnd = new Date("2026-10-31T23:59:59Z");

    const occurrences = expandEventOccurrences(
      "event-2",
      start,
      end,
      "FREQ=DAILY;COUNT=3",
      windowStart,
      windowEnd
    );

    assert(occurrences.length === 3, `expected 3 occurrences due to COUNT, got ${occurrences.length}`);
  });

  test("expandEventOccurrences suppresses cancelled occurrence", () => {
    const start = new Date("2026-10-01T10:00:00Z");
    const end = new Date("2026-10-01T11:00:00Z");
    const windowStart = new Date("2026-10-01T00:00:00Z");
    const windowEnd = new Date("2026-10-05T23:59:59Z");

    const cancelledOcc = {
      id: "exc-cancel-3",
      recurrenceId: "2026-10-03T10:00:00.000Z",
      isCancelled: true,
      startTime: new Date("2026-10-03T10:00:00Z"),
      endTime: new Date("2026-10-03T11:00:00Z"),
    };

    const occurrences = expandEventOccurrences(
      "event-cancel",
      start,
      end,
      "FREQ=DAILY;COUNT=5",
      windowStart,
      windowEnd,
      200,
      [cancelledOcc]
    );

    assert(occurrences.length === 4, `expected 4 occurrences after cancellation, got ${occurrences.length}`);
    const day3 = occurrences.find((o) => o.startTime.toISOString().startsWith("2026-10-03"));
    assert(!day3, "cancelled occurrence on 2026-10-03 should be suppressed");
  });

  test("expandEventOccurrences replaces modified occurrence with exception details", () => {
    const start = new Date("2026-10-01T10:00:00Z");
    const end = new Date("2026-10-01T11:00:00Z");
    const windowStart = new Date("2026-10-01T00:00:00Z");
    const windowEnd = new Date("2026-10-05T23:59:59Z");

    const modifiedOcc = {
      id: "exc-mod-2",
      recurrenceId: "2026-10-02T10:00:00.000Z",
      isCancelled: false,
      startTime: new Date("2026-10-02T14:30:00Z"),
      endTime: new Date("2026-10-02T15:30:00Z"),
      status: "tentative",
    };

    const occurrences = expandEventOccurrences(
      "event-mod",
      start,
      end,
      "FREQ=DAILY;COUNT=5",
      windowStart,
      windowEnd,
      200,
      [modifiedOcc]
    );

    assert(occurrences.length === 5, `expected 5 occurrences, got ${occurrences.length}`);
    const modItem = occurrences.find((o) => o.id === "exc-mod-2");
    assert(!!modItem, "modified occurrence should be present by exception id");
    assert(modItem!.isException === true, "isException should be true");
    assert(modItem!.startTime.toISOString() === "2026-10-02T14:30:00.000Z", "modified start time should match");
    assert(modItem!.status === "tentative", "modified status should match");
  });

  test("expandEventOccurrences handles weekly BYDAY with exceptions", () => {
    const start = new Date("2026-10-05T09:00:00Z"); // Monday
    const end = new Date("2026-10-05T10:00:00Z");
    const windowStart = new Date("2026-10-05T00:00:00Z");
    const windowEnd = new Date("2026-10-18T23:59:59Z"); // 2 weeks (2 Mondays)

    const cancelMonday2 = {
      id: "exc-mon-2",
      recurrenceId: "2026-10-12T09:00:00.000Z",
      isCancelled: true,
      startTime: new Date("2026-10-12T09:00:00Z"),
      endTime: new Date("2026-10-12T10:00:00Z"),
    };

    const occurrences = expandEventOccurrences(
      "event-weekly",
      start,
      end,
      "FREQ=WEEKLY;BYDAY=MO",
      windowStart,
      windowEnd,
      200,
      [cancelMonday2]
    );

    assert(occurrences.length === 1, `expected 1 occurrence after cancelling second week, got ${occurrences.length}`);
    assert(occurrences[0].startTime.toISOString() === "2026-10-05T09:00:00.000Z", "first week remains");
  });

  return { passed, failed };
}
