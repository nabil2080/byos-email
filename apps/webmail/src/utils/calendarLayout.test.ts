import { layoutDayTimedEvents, getOpaqueEventBg } from "./calendarLayout.js";
import { DecryptedEventRecord } from "../components/calendar/CalendarSidebar.js";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

function makeMockEvent(id: string, startHour: number, startMin: number, endHour: number, endMin: number): DecryptedEventRecord {
  const d = new Date(2026, 9, 29);
  const s = new Date(d);
  s.setHours(startHour, startMin, 0, 0);
  const e = new Date(d);
  e.setHours(endHour, endMin, 0, 0);

  return {
    id,
    calendarId: "cal-1",
    status: "confirmed",
    sequence: 0,
    isAllDay: false,
    startTime: s,
    endTime: e,
    details: {
      title: `Event ${id}`,
      color: "#9E725F",
    },
    clientGeneratedId: `client-${id}`,
  } as DecryptedEventRecord;
}

export function runCalendarLayoutTests() {
  console.log("Running Calendar Interval Scheduling & Layout Tests...");

  // Test 1: Empty input
  {
    const res = layoutDayTimedEvents([], 50);
    assert(res.length === 0, "Empty events array returns empty positioned array");
    console.log("  ✓ 1. Empty input handling");
  }

  // Test 2: Single event takes 100% width
  {
    const ev = makeMockEvent("1", 9, 0, 10, 0);
    const res = layoutDayTimedEvents([ev], 50);
    assert(res.length === 1, "Single event returned");
    assert(res[0].leftPercent === 0, "Single event starts at left 0%");
    assert(res[0].widthPercent === 100, "Single event occupies 100% width");
    console.log("  ✓ 2. Single event spans 100% width");
  }

  // Test 3: Disjoint non-overlapping events each occupy 100% width
  {
    const ev1 = makeMockEvent("1", 9, 0, 10, 0);
    const ev2 = makeMockEvent("2", 11, 0, 12, 0);
    const res = layoutDayTimedEvents([ev1, ev2], 50);
    assert(res.length === 2, "Two disjoint events returned");
    assert(res[0].widthPercent === 100, "Disjoint event 1 occupies 100% width");
    assert(res[1].widthPercent === 100, "Disjoint event 2 occupies 100% width");
    assert(res[0].leftPercent === 0 && res[1].leftPercent === 0, "Both start at left 0%");
    console.log("  ✓ 3. Disjoint non-overlapping events independently span 100% width");
  }

  // Test 4: Two concurrent overlapping events split 50% / 50%
  {
    const ev1 = makeMockEvent("1", 9, 0, 10, 0);
    const ev2 = makeMockEvent("2", 9, 30, 10, 30);
    const res = layoutDayTimedEvents([ev1, ev2], 50);
    assert(res.length === 2, "Two overlapping events returned");
    assert(res[0].widthPercent === 50, "Event 1 gets 50% width");
    assert(res[1].widthPercent === 50, "Event 2 gets 50% width");
    assert(res[0].leftPercent === 0, "Event 1 starts at 0%");
    assert(res[1].leftPercent === 50, "Event 2 starts at 50%");
    console.log("  ✓ 4. Two overlapping events allocate 50/50 parallel non-colliding columns");
  }

  // Test 5: Three concurrent overlapping events split 33.33% each in Week View
  {
    const ev1 = makeMockEvent("1", 9, 0, 10, 0);
    const ev2 = makeMockEvent("2", 9, 0, 10, 0);
    const ev3 = makeMockEvent("3", 9, 0, 10, 0);
    const res = layoutDayTimedEvents([ev1, ev2, ev3], 50, { isDayView: false });
    assert(res.length === 3, "Three events returned");
    const expectedCol = 100 / 3;
    assert(Math.abs(res[0].widthPercent - expectedCol) < 0.01, "Col 1 has 33.33% width");
    assert(Math.abs(res[1].widthPercent - expectedCol) < 0.01, "Col 2 has 33.33% width");
    assert(Math.abs(res[2].widthPercent - expectedCol) < 0.01, "Col 3 has 33.33% width");
    assert(res[0].leftPercent === 0, "Event 1 left is 0%");
    assert(Math.abs(res[1].leftPercent - expectedCol) < 0.01, "Event 2 left is 33.33%");
    assert(Math.abs(res[2].leftPercent - expectedCol * 2) < 0.01, "Event 3 left is 66.66%");
    console.log("  ✓ 5. Three concurrent events allocate 3 parallel columns with 0% collision");
  }

  // Test 6: Greedy Rightward Expansion
  {
    // ev1: 9:00 - 11:00 (Lane 0)
    // ev2: 9:00 - 10:00 (Lane 1)
    // ev3: 10:00 - 11:00 (Lane 1)
    // Both ev2 and ev3 occupy Lane 1 sequentially. Total lanes = 2.
    // Each has widthPercent = 50%.
    const ev1 = makeMockEvent("1", 9, 0, 11, 0);
    const ev2 = makeMockEvent("2", 9, 0, 10, 0);
    const ev3 = makeMockEvent("3", 10, 0, 11, 0);
    const res = layoutDayTimedEvents([ev1, ev2, ev3], 50);
    assert(res.length === 3, "Three events returned");
    assert(res[0].widthPercent === 50, "Event 1 gets 50% width");
    assert(res[1].widthPercent === 50, "Event 2 gets 50% width");
    assert(res[2].widthPercent === 50, "Event 3 gets 50% width");
    console.log("  ✓ 6. Greedy interval scheduling correctly packs sequential sub-intervals");
  }

  // Test 7: High concurrency in Day View (up to 8 lanes side-by-side)
  {
    const events = [
      makeMockEvent("1", 10, 0, 11, 0),
      makeMockEvent("2", 10, 0, 11, 0),
      makeMockEvent("3", 10, 0, 11, 0),
      makeMockEvent("4", 10, 0, 11, 0),
      makeMockEvent("5", 10, 0, 11, 0),
    ];
    const res = layoutDayTimedEvents(events, 50, { isDayView: true });
    assert(res.length === 5, "5 events in Day View returned");
    assert(res[0].widthPercent === 20, "Each event gets 20% width in Day View (5 parallel lanes)");
    assert(res[4].leftPercent === 80, "Event 5 starts at left 80%");
    console.log("  ✓ 7. Day View cleanly allocates 5 parallel non-overlapping lanes");
  }

  // Test 8: High concurrency in Week View (> 3 overlapping events cascade cleanly with >= 60% cardWidth)
  {
    const events = [
      makeMockEvent("1", 10, 0, 11, 0),
      makeMockEvent("2", 10, 0, 11, 0),
      makeMockEvent("3", 10, 0, 11, 0),
      makeMockEvent("4", 10, 0, 11, 0),
      makeMockEvent("5", 10, 0, 11, 0),
    ];
    const res = layoutDayTimedEvents(events, 50, { isDayView: false });
    assert(res.length === 5, "5 events in Week View returned");
    assert(res[0].widthPercent >= 60, "Event cards maintain minimum readable width (>= 60%)");
    assert(res[0].leftPercent === 0, "First card starts at left 0%");
    assert(res[4].leftPercent > 0 && res[4].leftPercent <= 40, "Cascaded cards step within readable bounds");
    assert((res[4].zIndex || 0) > (res[0].zIndex || 0), "Z-index layers chronologically for clear stacking");
    console.log("  ✓ 8. Week View high-concurrency clusters cascade with >= 60% readable card width");
  }

  // Test 9: getOpaqueEventBg produces 100% solid RGB colors with no alpha channel
  {
    const lightBg = getOpaqueEventBg("#9E725F", false);
    const darkBg = getOpaqueEventBg("#9E725F", true);
    assert(lightBg.startsWith("rgb(") && !lightBg.includes("rgba"), "Light background is solid RGB with no alpha");
    assert(darkBg.startsWith("rgb(") && !darkBg.includes("rgba"), "Dark background is solid RGB with no alpha");
    assert(!lightBg.includes("NaN") && !darkBg.includes("NaN"), "RGB numbers are valid and non-NaN");
    console.log("  ✓ 9. getOpaqueEventBg computes 100% solid, fully-opaque surfaces");
  }

  console.log("CALENDAR INTERVAL & LAYOUT TESTS: All 9 passed, 0 failed\n");
}
