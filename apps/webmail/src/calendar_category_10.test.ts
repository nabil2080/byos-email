import {
  isTimeInWorkingHours,
  getEffectiveDailyWorkLocation,
  computeFreeBusyIntervals,
  checkMeetingAvailability,
  evaluateAutoDeclineForInvitation,
} from "./utils/calendarAvailability.js";
import {
  CalendarSettings,
  DEFAULT_CALENDAR_SETTINGS,
} from "./components/calendar/settings/calendarSettingsStore.js";
import { DecryptedEventRecord } from "./components/calendar/CalendarSidebar.js";
import {
  CalendarEventPlaintext,
  encryptCalendarEventPayload,
  decryptCalendarEventPayload,
} from "./calendar_crypto.js";
import * as WasmCore from "./generated/crypto-core/byos_crypto_core.js";

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error("Assertion failed: " + msg);
}

export async function runCalendarCategory10Tests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  function runTest(name: string, fn: () => void | Promise<void>) {
    try {
      fn();
      passed++;
    } catch (err: any) {
      console.error(`  FAIL: ${name} ->`, err.message);
      failed++;
    }
  }

  // 1. Timezone-aware working hours evaluation
  runTest("Cat 10.1: Timezone-aware working hours evaluation", () => {
    const settings: CalendarSettings = {
      ...DEFAULT_CALENDAR_SETTINGS,
      workingHoursEnabled: true,
      workingDays: [1, 2, 3, 4, 5], // Mon - Fri
      workHoursStart: "09:00",
      workHoursEnd: "17:00",
      primaryTimeZone: "America/New_York", // UTC-5
    };

    // 2026-11-02 is Monday.
    // 14:30 UTC is 09:30 America/New_York -> inside working hours
    const mondayMorning = new Date("2026-11-02T14:30:00Z");
    assert(
      isTimeInWorkingHours(mondayMorning, settings, "America/New_York") === true,
      "Monday 09:30 NY time should be within working hours"
    );

    // 05:00 UTC is 00:00 America/New_York -> outside working hours
    const mondayMidnight = new Date("2026-11-02T05:00:00Z");
    assert(
      isTimeInWorkingHours(mondayMidnight, settings, "America/New_York") === false,
      "Monday midnight NY time should be outside working hours"
    );

    // 2026-11-01 is Sunday.
    // 15:00 UTC is 10:00 America/New_York -> Sunday is not in workingDays
    const sundayMorning = new Date("2026-11-01T15:00:00Z");
    assert(
      isTimeInWorkingHours(sundayMorning, settings, "America/New_York") === false,
      "Sunday morning should be outside working hours"
    );

    // When workingHoursEnabled is false, all hours are allowed
    const disabledSettings: CalendarSettings = {
      ...settings,
      workingHoursEnabled: false,
    };
    assert(
      isTimeInWorkingHours(sundayMorning, disabledSettings, "America/New_York") === true,
      "When working hours disabled, any time returns true"
    );
  });

  // 2. Multiple working periods per day
  runTest("Cat 10.2: Multiple working periods per day (split shifts / lunch breaks)", () => {
    const settings: CalendarSettings = {
      ...DEFAULT_CALENDAR_SETTINGS,
      workingHoursEnabled: true,
      workingDays: [1, 2, 3, 4, 5],
      primaryTimeZone: "UTC",
      workingPeriodsByDay: {
        1: [ // Monday split shift: 08:30-12:00, 13:30-17:30
          { start: "08:30", end: "12:00" },
          { start: "13:30", end: "17:30" },
        ],
      },
    };

    // Monday 09:00 UTC -> in period 1
    const morningWork = new Date("2026-11-02T09:00:00Z");
    assert(
      isTimeInWorkingHours(morningWork, settings, "UTC") === true,
      "Monday 09:00 should be in working hours"
    );

    // Monday 12:30 UTC -> in lunch gap (outside periods)
    const lunchBreak = new Date("2026-11-02T12:30:00Z");
    assert(
      isTimeInWorkingHours(lunchBreak, settings, "UTC") === false,
      "Monday 12:30 lunch break should be outside working hours"
    );

    // Monday 15:00 UTC -> in period 2
    const afternoonWork = new Date("2026-11-02T15:00:00Z");
    assert(
      isTimeInWorkingHours(afternoonWork, settings, "UTC") === true,
      "Monday 15:00 should be in working hours"
    );

    // Monday 18:00 UTC -> after period 2
    const evening = new Date("2026-11-02T18:00:00Z");
    assert(
      isTimeInWorkingHours(evening, settings, "UTC") === false,
      "Monday 18:00 should be outside working hours"
    );
  });

  // 3. Date-specific exceptions to working hours
  runTest("Cat 10.3: Date-specific exceptions override standard working days", () => {
    const settings: CalendarSettings = {
      ...DEFAULT_CALENDAR_SETTINGS,
      workingHoursEnabled: true,
      workingDays: [1, 2, 3, 4, 5],
      workHoursStart: "09:00",
      workHoursEnd: "17:00",
      primaryTimeZone: "UTC",
      workingHoursExceptions: {
        "2026-11-09": { // Holiday exception on Monday: disabled
          date: "2026-11-09",
          enabled: false,
          periods: [],
          note: "Company Holiday",
        },
        "2026-11-14": { // Weekend shift on Saturday: enabled 10:00-14:00
          date: "2026-11-14",
          enabled: true,
          periods: [{ start: "10:00", end: "14:00" }],
          note: "Maintenance shift",
        },
      },
    };

    // Monday holiday: 11:00 UTC should be false despite Monday being standard working day
    const holidayWork = new Date("2026-11-09T11:00:00Z");
    assert(
      isTimeInWorkingHours(holidayWork, settings, "UTC") === false,
      "Date exception holiday should disable working hours"
    );

    // Saturday special shift: 11:00 UTC should be true
    const satShiftIn = new Date("2026-11-14T11:00:00Z");
    assert(
      isTimeInWorkingHours(satShiftIn, settings, "UTC") === true,
      "Saturday special shift within 10:00-14:00 should be working hours"
    );

    // Saturday special shift: 15:00 UTC should be false
    const satShiftOut = new Date("2026-11-14T15:00:00Z");
    assert(
      isTimeInWorkingHours(satShiftOut, settings, "UTC") === false,
      "Saturday after 14:00 should be outside working hours"
    );
  });

  // 4. Working location hierarchy
  runTest("Cat 10.4: Working location hierarchy (daily override -> date exception -> default)", () => {
    const settings: CalendarSettings = {
      ...DEFAULT_CALENDAR_SETTINGS,
      defaultWorkLocation: "office",
      dailyWorkLocations: {
        "2026-11-11": "home",
        "2026-11-12": "remote",
      },
      workingHoursExceptions: {
        "2026-11-10": {
          date: "2026-11-10",
          enabled: true,
          periods: [{ start: "09:00", end: "17:00" }],
          location: "remote",
        },
        "2026-11-11": {
          date: "2026-11-11",
          enabled: true,
          periods: [{ start: "09:00", end: "17:00" }],
          location: "office", // will be overridden by dailyWorkLocations
        },
      },
      primaryTimeZone: "UTC",
    };

    // Default fallback
    const normalDay = new Date("2026-11-08T10:00:00Z");
    assert(
      getEffectiveDailyWorkLocation(normalDay, settings, "UTC") === "office",
      "Standard day falls back to defaultWorkLocation office"
    );

    // Date exception location
    const exceptionDay = new Date("2026-11-10T10:00:00Z");
    assert(
      getEffectiveDailyWorkLocation(exceptionDay, settings, "UTC") === "remote",
      "Date exception sets location to remote"
    );

    // Daily override wins over date exception
    const overrideDay = new Date("2026-11-11T10:00:00Z");
    assert(
      getEffectiveDailyWorkLocation(overrideDay, settings, "UTC") === "home",
      "Daily override 'home' supersedes date exception 'office'"
    );

    // Daily override alone
    const overrideDay2 = new Date("2026-11-12T10:00:00Z");
    assert(
      getEffectiveDailyWorkLocation(overrideDay2, settings, "UTC") === "remote",
      "Daily override sets location to remote"
    );
  });

  // 5. Zero-Knowledge Free/Busy interval calculation
  runTest("Cat 10.5: Zero-Knowledge privacy-preserving Free/Busy interval calculation", () => {
    const windowStart = new Date("2026-11-02T08:00:00Z");
    const windowEnd = new Date("2026-11-02T18:00:00Z");

    const events: DecryptedEventRecord[] = [
      {
        id: "ev-1",
        calendarId: "cal-1",
        startTime: new Date("2026-11-02T09:00:00Z"),
        endTime: new Date("2026-11-02T10:30:00Z"),
        isAllDay: false,
        status: "confirmed",
        details: {
          title: "Confidential Project Titan Secret Briefing",
          description: "Top secret crypto strategy details",
          location: "Room 404",
        },
      },
      {
        id: "ev-2", // Overlapping busy event
        calendarId: "cal-1",
        startTime: new Date("2026-11-02T10:00:00Z"),
        endTime: new Date("2026-11-02T11:00:00Z"),
        isAllDay: false,
        status: "confirmed",
        details: {
          title: "Private 1-on-1 Performance Review",
        },
      },
      {
        id: "ev-3", // Transparent free event: should not mark busy
        calendarId: "cal-1",
        startTime: new Date("2026-11-02T12:00:00Z"),
        endTime: new Date("2026-11-02T13:00:00Z"),
        isAllDay: false,
        status: "free",
        details: {
          title: "Working from cafe (available)",
        },
      },
      {
        id: "ev-4", // Out of office block
        calendarId: "cal-1",
        startTime: new Date("2026-11-02T14:00:00Z"),
        endTime: new Date("2026-11-02T16:00:00Z"),
        isAllDay: false,
        status: "out_of_office",
        details: {
          title: "Doctor appointment",
          eventType: "out_of_office",
        },
      },
    ];

    const intervals = computeFreeBusyIntervals(
      events,
      windowStart,
      windowEnd,
      DEFAULT_CALENDAR_SETTINGS,
      "UTC"
    );

    // Verify metadata privacy: returned objects must ONLY contain start, end, status
    for (const interval of intervals) {
      assert(
        (interval as any).title === undefined,
        "Zero-Knowledge Free/Busy interval must NOT contain title"
      );
      assert(
        (interval as any).description === undefined,
        "Zero-Knowledge Free/Busy interval must NOT contain description"
      );
      assert(
        (interval as any).location === undefined,
        "Zero-Knowledge Free/Busy interval must NOT contain location"
      );
    }

    // Interval structure:
    // 08:00 - 09:00 -> free
    // 09:00 - 11:00 -> busy (ev-1 and ev-2 merged)
    // 11:00 - 14:00 -> free (ev-3 is status "free")
    // 14:00 - 16:00 -> out_of_office (ev-4)
    // 16:00 - 18:00 -> free
    assert(intervals.length === 5, `Expected 5 intervals, got ${intervals.length}`);

    assert(intervals[0].status === "free", "Interval 0 should be free");
    assert(intervals[0].start.toISOString() === "2026-11-02T08:00:00.000Z", "Interval 0 start match");
    assert(intervals[0].end.toISOString() === "2026-11-02T09:00:00.000Z", "Interval 0 end match");

    assert(intervals[1].status === "busy", "Interval 1 should be busy (merged ev-1 and ev-2)");
    assert(intervals[1].start.toISOString() === "2026-11-02T09:00:00.000Z", "Interval 1 start match");
    assert(intervals[1].end.toISOString() === "2026-11-02T11:00:00.000Z", "Interval 1 end match");

    assert(intervals[2].status === "free", "Interval 2 should be free");
    assert(intervals[2].start.toISOString() === "2026-11-02T11:00:00.000Z", "Interval 2 start match");
    assert(intervals[2].end.toISOString() === "2026-11-02T14:00:00.000Z", "Interval 2 end match");

    assert(intervals[3].status === "out_of_office", "Interval 3 should be out_of_office");
    assert(intervals[3].start.toISOString() === "2026-11-02T14:00:00.000Z", "Interval 3 start match");
    assert(intervals[3].end.toISOString() === "2026-11-02T16:00:00.000Z", "Interval 3 end match");

    assert(intervals[4].status === "free", "Interval 4 should be free");
    assert(intervals[4].start.toISOString() === "2026-11-02T16:00:00.000Z", "Interval 4 start match");
    assert(intervals[4].end.toISOString() === "2026-11-02T18:00:00.000Z", "Interval 4 end match");
  });

  // 6. Meeting conflict detection
  runTest("Cat 10.6: Meeting conflict detection (OOO, busy overlap, outside working hours)", () => {
    const settings: CalendarSettings = {
      ...DEFAULT_CALENDAR_SETTINGS,
      workingHoursEnabled: true,
      workingDays: [1, 2, 3, 4, 5],
      workHoursStart: "09:00",
      workHoursEnd: "17:00",
      primaryTimeZone: "UTC",
    };

    const events: DecryptedEventRecord[] = [
      {
        id: "ev-busy",
        calendarId: "cal-1",
        startTime: new Date("2026-11-02T10:00:00Z"),
        endTime: new Date("2026-11-02T11:00:00Z"),
        isAllDay: false,
        status: "confirmed",
        details: { title: "Sprint Planning" },
      },
      {
        id: "ev-ooo",
        calendarId: "cal-1",
        startTime: new Date("2026-11-02T14:00:00Z"),
        endTime: new Date("2026-11-02T16:00:00Z"),
        isAllDay: false,
        status: "out_of_office",
        details: { title: "Vacation Day", eventType: "out_of_office" },
      },
    ];

    // Conflict 1: Overlaps busy event
    const busyCheck = checkMeetingAvailability(
      new Date("2026-11-02T10:30:00Z"),
      new Date("2026-11-02T11:30:00Z"),
      events,
      settings,
      "UTC"
    );
    assert(busyCheck.available === false, "Overlapping busy meeting should not be available");
    assert(busyCheck.conflicts.some((c) => c.type === "busy"), "Should have busy conflict");

    // Conflict 2: Overlaps Out of Office event
    const oooCheck = checkMeetingAvailability(
      new Date("2026-11-02T14:30:00Z"),
      new Date("2026-11-02T15:30:00Z"),
      events,
      settings,
      "UTC"
    );
    assert(oooCheck.available === false, "Overlapping OOO should not be available");
    assert(oooCheck.conflicts.some((c) => c.type === "out_of_office"), "Should have out_of_office conflict");

    // Conflict 3: Extends past working hours (17:00 - 18:00)
    const afterHoursCheck = checkMeetingAvailability(
      new Date("2026-11-02T17:00:00Z"),
      new Date("2026-11-02T18:00:00Z"),
      events,
      settings,
      "UTC"
    );
    assert(afterHoursCheck.available === false, "After hours meeting should not be available");
    assert(afterHoursCheck.conflicts.some((c) => c.type === "outside_working_hours"), "Should have outside_working_hours conflict");

    // Available meeting: 11:30 - 12:30 (no conflicts, inside working hours)
    const clearCheck = checkMeetingAvailability(
      new Date("2026-11-02T11:30:00Z"),
      new Date("2026-11-02T12:30:00Z"),
      events,
      settings,
      "UTC"
    );
    assert(clearCheck.available === true, "Free slot within working hours should be available");
    assert(clearCheck.conflicts.length === 0, "No conflicts expected for clear slot");
  });

  // 7. Automatic invitation decline evaluation
  runTest("Cat 10.7: Automatic invitation decline evaluation", () => {
    const settings: CalendarSettings = {
      ...DEFAULT_CALENDAR_SETTINGS,
      workingHoursEnabled: true,
      workingDays: [1, 2, 3, 4, 5],
      workHoursStart: "09:00",
      workHoursEnd: "17:00",
      autoDeclineOutOfOffice: true,
      autoDeclineMessage: "Standard out of office decline note.",
      primaryTimeZone: "UTC",
    };

    const events: DecryptedEventRecord[] = [
      {
        id: "ev-ooo-autodecline",
        calendarId: "cal-1",
        startTime: new Date("2026-11-02T13:00:00Z"),
        endTime: new Date("2026-11-02T17:00:00Z"),
        isAllDay: false,
        status: "out_of_office",
        details: {
          title: "Offsite Conference",
          eventType: "out_of_office",
          autoDeclineMode: "new_invitations",
          autoDeclineMessage: "Attending annual symposium, declines are automated.",
        },
      },
      {
        id: "ev-ooo-nodecline",
        calendarId: "cal-1",
        startTime: new Date("2026-11-03T13:00:00Z"),
        endTime: new Date("2026-11-03T17:00:00Z"),
        isAllDay: false,
        status: "out_of_office",
        details: {
          title: "Personal Errands",
          eventType: "out_of_office",
          autoDeclineMode: "none",
        },
      },
    ];

    // Case 1: Overlaps active OOO with auto-decline enabled
    const oooDecline = evaluateAutoDeclineForInvitation(
      new Date("2026-11-02T14:00:00Z"),
      new Date("2026-11-02T15:00:00Z"),
      events,
      settings,
      "UTC"
    );
    assert(oooDecline.shouldDecline === true, "Should automatically decline during active OOO block");
    assert(
      oooDecline.declineReason === "Attending annual symposium, declines are automated.",
      "Should include custom OOO decline message"
    );

    // Case 2: Overlaps OOO with autoDeclineMode === 'none'
    const oooNoDecline = evaluateAutoDeclineForInvitation(
      new Date("2026-11-03T14:00:00Z"),
      new Date("2026-11-03T15:00:00Z"),
      events,
      settings,
      "UTC"
    );
    assert(oooNoDecline.shouldDecline === false, "Should not decline when autoDeclineMode is none");

    // Case 3: Outside working hours when autoDeclineOutOfOffice is true
    const eveningInvite = evaluateAutoDeclineForInvitation(
      new Date("2026-11-02T19:00:00Z"),
      new Date("2026-11-02T20:00:00Z"),
      events,
      settings,
      "UTC"
    );
    assert(
      eveningInvite.shouldDecline === true,
      "Should automatically decline evening invitation outside working hours"
    );

    // Case 4: Normal invitation inside working hours with no OOO
    const validInvite = evaluateAutoDeclineForInvitation(
      new Date("2026-11-02T10:00:00Z"),
      new Date("2026-11-02T11:00:00Z"),
      events,
      settings,
      "UTC"
    );
    assert(validInvite.shouldDecline === false, "Should not decline valid work hours invitation");
  });

  // 8. Focus-time and Zero-Knowledge cryptographic payload round-trip
  runTest("Cat 10.8: Focus-time event cryptographic round-trip (AES-GCM)", () => {
    const dummyKey = new Uint8Array(32);
    for (let i = 0; i < 32; i++) dummyKey[i] = i + 1;
    const mailboxId = "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d";

    const plaintext: CalendarEventPlaintext = {
      title: "Deep Work: Zero-Knowledge Protocols",
      description: "Do not disturb - uninterrupted engineering",
      location: "Focus Room 1",
      color: "#6366F1",
      visibility: "confidential",
      eventType: "focus_time",
      workingLocation: "home",
      autoDeclineMode: "none",
    };

    const envelopeB64 = encryptCalendarEventPayload(WasmCore, dummyKey, mailboxId, plaintext);
    assert(typeof envelopeB64 === "string" && envelopeB64.length > 0, "Envelope must be non-empty base64 string");

    const decrypted = decryptCalendarEventPayload(WasmCore, dummyKey, mailboxId, envelopeB64);
    assert(decrypted.title === "Deep Work: Zero-Knowledge Protocols", "Title decrypted successfully");
    assert(decrypted.eventType === "focus_time", "Event type focus_time preserved across encryption");
    assert(decrypted.workingLocation === "home", "Working location preserved across encryption");
  });

  return { passed, failed };
}
