import { formatTime, formatMessageDate, formatFullDateTime } from "./dateTime";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEquals(actual: any, expected: any, message: string) {
  if (actual !== expected) {
    throw new Error(`Assertion failed: ${message}. Expected '${expected}', but got '${actual}'`);
  }
}

export function runDateTimeTests(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;

  const runTest = (name: string, fn: () => void) => {
    try {
      fn();
      passed++;
    } catch (err) {
      failed++;
      console.error(`TEST FAILED [${name}]:`, err);
    }
  };

  runTest("formatTime - handles empty input", () => {
    assertEquals(formatTime(""), "", "Should return empty string for empty input");
    assertEquals(formatTime(0 as unknown as string), "", "Should return empty string for 0 input");
  });

  runTest("formatTime - handles invalid date", () => {
    assertEquals(formatTime("invalid-date"), "invalid-date", "Should return the original string if invalid");
  });

  runTest("formatTime - 12h format (default)", () => {
    // using a fixed date string "2024-01-01T15:30:00Z" might be timezone dependent
    // to make it deterministic, we construct a Date and pass it
    const d = new Date(2024, 0, 1, 15, 30, 0); // 3:30 PM local time
    const result = formatTime(d);

    // Some platforms may use AM/PM or a.m./p.m., so we just check it includes 3 and 30
    assert(result.includes("3") && result.includes("30") && (result.toLowerCase().includes("pm") || result.toLowerCase().includes("p.m.")), `Expected 3:30 PM format, got ${result}`);
  });

  runTest("formatTime - 24h format", () => {
    const d = new Date(2024, 0, 1, 15, 30, 0); // 15:30 local time
    const result = formatTime(d, "24h");

    assert(result.includes("15") && result.includes("30"), `Expected 15:30 format, got ${result}`);
  });

  runTest("formatMessageDate - handles today", () => {
    const now = new Date();
    // modify hours to not hit midnight edge cases
    now.setHours(15, 30, 0, 0);
    const result = formatMessageDate(now, "24h");

    assert(result.includes("15") && result.includes("30"), `Expected today's date to be formatted as time (15:30), got ${result}`);
  });

  runTest("formatMessageDate - handles this year (not today)", () => {
    const now = new Date();
    // 5 days ago
    const d = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
    // if today is Jan 1-4, it will go to last year, so we specifically set a date this year that is not today
    const thisYear = now.getFullYear();
    // Safe date: July 15th
    const safeDate = new Date(thisYear, 6, 15);
    // If today is July 15th, change it to July 16th
    if (now.getMonth() === 6 && now.getDate() === 15) {
        safeDate.setDate(16);
    }

    const result = formatMessageDate(safeDate, "12h", "en-US");
    // Expected: "Jul 15" or "Jul 16"
    assert(result.includes("Jul") && (result.includes("15") || result.includes("16")), `Expected this year's date to show month and day, got ${result}`);
  });

  runTest("formatMessageDate - handles previous years", () => {
    const now = new Date();
    const lastYear = now.getFullYear() - 1;
    const d = new Date(lastYear, 6, 15); // July 15th last year

    const result = formatMessageDate(d, "12h", "en-US");
    // Expected: "Jul 15, YYYY"
    assert(result.includes("Jul") && result.includes("15") && result.includes(lastYear.toString()), `Expected previous year's date to include year, got ${result}`);
  });

  runTest("formatMessageDate - handles invalid date", () => {
    assertEquals(formatMessageDate("invalid-date"), "invalid-date", "Should return the original string if invalid");
  });

  runTest("formatFullDateTime - valid date", () => {
    const d = new Date(2024, 0, 1, 15, 30, 0); // Jan 1, 2024, 15:30
    const result = formatFullDateTime(d, "24h", "en-US");

    assert(result.includes("Jan") && result.includes("1") && result.includes("2024") && result.includes("15") && result.includes("30") && result.includes("•"), `Expected full date time string, got ${result}`);
  });

  runTest("formatFullDateTime - handles invalid date", () => {
    assertEquals(formatFullDateTime("invalid-date"), "invalid-date", "Should return the original string if invalid");
  });


  return { passed, failed };
}
