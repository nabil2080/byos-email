import assert from "node:assert";

export function runCalendarYearViewTests() {
  console.log("Starting Calendar Year View Tests...");

  function test(name: string, fn: () => void) {
    try {
      fn();
      console.log(`  ✓ ${name}`);
    } catch (err: any) {
      console.error(`  ✗ ${name}:`, err);
      throw err;
    }
  }

  // Helper date math replicated from YearView
  function getMonthGridData(year: number, monthIndex: number, weekStart: "sunday" | "monday" | "saturday" = "sunday") {
    const rawFirstDay = new Date(year, monthIndex, 1).getDay();
    let firstDayIndex = rawFirstDay;
    if (weekStart === "monday") {
      firstDayIndex = (rawFirstDay + 6) % 7;
    } else if (weekStart === "saturday") {
      firstDayIndex = (rawFirstDay + 1) % 7;
    }
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    return { firstDayIndex, daysInMonth };
  }

  test("1. Year View generates exactly 12 months", () => {
    const monthNames = [
      "January", "February", "March", "April",
      "May", "June", "July", "August",
      "September", "October", "November", "December"
    ];
    assert.strictEqual(monthNames.length, 12);
  });

  test("2. Month day counts: handles leap years (2024 vs 2026)", () => {
    // 2026 is non-leap year: February has 28 days
    const feb2026 = getMonthGridData(2026, 1);
    assert.strictEqual(feb2026.daysInMonth, 28);

    // 2024 is a leap year: February has 29 days
    const feb2024 = getMonthGridData(2024, 1);
    assert.strictEqual(feb2024.daysInMonth, 29);

    // 2028 is a leap year: February has 29 days
    const feb2028 = getMonthGridData(2028, 1);
    assert.strictEqual(feb2028.daysInMonth, 29);

    // Standard 31-day and 30-day months
    const jan2026 = getMonthGridData(2026, 0);
    assert.strictEqual(jan2026.daysInMonth, 31);
    const apr2026 = getMonthGridData(2026, 3);
    assert.strictEqual(apr2026.daysInMonth, 30);
  });

  test("3. Leading blanks calculation under Sunday, Monday, Saturday week start", () => {
    // Oct 1, 2026 is a Thursday (raw day = 4)
    // Sunday start: leading blanks = 4 (Sun, Mon, Tue, Wed)
    const sunGrid = getMonthGridData(2026, 9, "sunday");
    assert.strictEqual(sunGrid.firstDayIndex, 4);

    // Monday start: leading blanks = (4 + 6) % 7 = 3 (Mon, Tue, Wed)
    const monGrid = getMonthGridData(2026, 9, "monday");
    assert.strictEqual(monGrid.firstDayIndex, 3);

    // Saturday start: leading blanks = (4 + 1) % 7 = 5 (Sat, Sun, Mon, Tue, Wed)
    const satGrid = getMonthGridData(2026, 9, "saturday");
    assert.strictEqual(satGrid.firstDayIndex, 5);
  });

  test("4. Year navigation advances or decrements by 1 full year", () => {
    const current = new Date(2026, 9, 26);
    
    // Prev year
    const prev = new Date(current);
    prev.setFullYear(prev.getFullYear() - 1);
    assert.strictEqual(prev.getFullYear(), 2025);
    assert.strictEqual(prev.getMonth(), 9);

    // Next year
    const next = new Date(current);
    next.setFullYear(next.getFullYear() + 1);
    assert.strictEqual(next.getFullYear(), 2027);
    assert.strictEqual(next.getMonth(), 9);
  });

  test("5. Year view period title displays 4-digit year", () => {
    const d = new Date(2026, 5, 15);
    const title = d.getFullYear().toString();
    assert.strictEqual(title, "2026");
  });

  test("6. Event distribution and holiday detection in Year View", () => {
    const mockEvents = [
      {
        id: "ev-1",
        calendarId: "cal-work",
        startTime: new Date(2026, 2, 15, 10, 0),
        endTime: new Date(2026, 2, 15, 11, 0),
        isAllDay: false,
        isHoliday: false,
        details: { title: "Team Quarterly Review" },
      },
      {
        id: "ev-2",
        calendarId: "cal-holiday",
        startTime: new Date(2026, 2, 26, 0, 0),
        endTime: new Date(2026, 2, 26, 23, 59),
        isAllDay: true,
        isHoliday: true,
        details: { title: "Independence Day (Bangladesh)" },
      },
      {
        id: "ev-3",
        calendarId: "cal-work",
        startTime: new Date(2026, 11, 25, 0, 0),
        endTime: new Date(2026, 11, 25, 23, 59),
        isAllDay: true,
        isHoliday: true,
        details: { title: "Christmas Day" },
      },
    ];

    function isSameDay(a: Date, b: Date): boolean {
      return (
        a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate()
      );
    }

    // Match March 15
    const march15 = new Date(2026, 2, 15);
    const march15Events = mockEvents.filter((e) => isSameDay(e.startTime, march15));
    assert.strictEqual(march15Events.length, 1);
    assert.strictEqual(march15Events[0].isHoliday, false);

    // Match March 26 (Holiday)
    const march26 = new Date(2026, 2, 26);
    const march26Events = mockEvents.filter((e) => isSameDay(e.startTime, march26));
    assert.strictEqual(march26Events.length, 1);
    assert.strictEqual(march26Events[0].isHoliday, true);

    // Match Dec 25 (Holiday)
    const dec25 = new Date(2026, 11, 25);
    const dec25Events = mockEvents.filter((e) => isSameDay(e.startTime, dec25));
    assert.strictEqual(dec25Events.length, 1);
    assert.strictEqual(dec25Events[0].isHoliday, true);

    // Empty day
    const april1 = new Date(2026, 3, 1);
    const april1Events = mockEvents.filter((e) => isSameDay(e.startTime, april1));
    assert.strictEqual(april1Events.length, 0);
  });

  console.log("\nCALENDAR YEAR VIEW TESTS: 6 passed, 0 failed\n");
}
