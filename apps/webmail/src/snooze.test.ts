import {
  computeLaterToday,
  computeTomorrow,
  computeThisWeekend,
  computeNextWeek,
  formatSnoozeTime,
} from "./snooze.js";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export function runSnoozeTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;

  const test = (name: string, fn: () => void) => {
    try {
      fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}:`, err);
      failed++;
    }
  };

  console.log("Running Snooze Tests...");

  // 1. TestSnoozePresetsComputeCorrectTimes
  test("1. TestSnoozePresetsComputeCorrectTimes", () => {
    // Later today at 2pm (14:00) -> 6pm (18:00) same day
    const at2pm = new Date("2026-09-25T14:00:00");
    const later1 = computeLaterToday(at2pm);
    assert(later1.getHours() === 18, `expected 18:00, got ${later1.getHours()}`);
    assert(later1.getMinutes() === 0, "expected 0 minutes");
    assert(later1.getDate() === at2pm.getDate(), "expected same date");

    // Later today at 8pm (20:00) -> +3 hours (23:00)
    const at8pm = new Date("2026-09-25T20:00:00");
    const later2 = computeLaterToday(at8pm);
    assert(
      later2.getTime() === at8pm.getTime() + 3 * 60 * 60 * 1000,
      "expected +3 hours when already past 6pm"
    );

    // Tomorrow -> 8am next day
    const tomorrow = computeTomorrow(at2pm);
    assert(tomorrow.getHours() === 8, "expected 8:00 AM");
    assert(tomorrow.getMinutes() === 0, "expected 0 minutes");
    assert(
      tomorrow.getDate() === at2pm.getDate() + 1,
      "expected date incremented by 1"
    );

    // This weekend -> Saturday 8am
    // 2026-09-25 is a Friday (day 5) -> Saturday is 2026-09-26
    const weekend = computeThisWeekend(at2pm);
    assert(weekend.getDay() === 6, "expected Saturday (day 6)");
    assert(weekend.getHours() === 8, "expected 8:00 AM");
    assert(weekend.getMinutes() === 0, "expected 0 minutes");

    // Next week -> Monday 8am
    // 2026-09-25 is Friday -> next Monday is 2026-09-28
    const nextWeek = computeNextWeek(at2pm);
    assert(nextWeek.getDay() === 1, "expected Monday (day 1)");
    assert(nextWeek.getHours() === 8, "expected 8:00 AM");
    assert(nextWeek.getMinutes() === 0, "expected 0 minutes");
  });

  // 2. TestFormatSnoozeTime
  test("2. TestFormatSnoozeTime", () => {
    const baseNow = new Date("2026-09-25T14:00:00");

    // Today at 6:00 PM
    const today6pm = new Date("2026-09-25T18:00:00");
    const formattedToday = formatSnoozeTime(today6pm, baseNow);
    assert(
      formattedToday === "Today at 6:00 PM",
      `expected "Today at 6:00 PM", got "${formattedToday}"`
    );

    // Tomorrow at 8:00 AM
    const tomorrow8am = new Date("2026-09-26T08:00:00");
    const formattedTomorrow = formatSnoozeTime(tomorrow8am, baseNow);
    assert(
      formattedTomorrow === "Tomorrow at 8:00 AM",
      `expected "Tomorrow at 8:00 AM", got "${formattedTomorrow}"`
    );

    // Sunday at 8:00 AM (2 days later)
    const sun8am = new Date("2026-09-27T08:00:00");
    const formattedSun = formatSnoozeTime(sun8am, baseNow);
    assert(
      formattedSun === "Sunday at 8:00 AM",
      `expected "Sunday at 8:00 AM", got "${formattedSun}"`
    );
  });

  return { passed, failed };
}
