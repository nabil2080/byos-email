import {
  isQuietHours,
  resolveEventReminders,
  calculateReminderTriggerTime,
  evaluateUpcomingReminders,
  snoozeReminderAlert,
  formatRelativeReminderTime,
  getDispatchedLedger,
  markAlertDispatched,
  unmarkAlertDispatched,
  clearDispatchedLedger,
} from "./utils/calendarNotifications.js";
import { generateIcs, parseIcs, parseIcsTriggerMinutes } from "./utils/calendarIcs.js";
import { DEFAULT_CALENDAR_SETTINGS, CalendarUserSettings, CalendarOverrides } from "./components/calendar/settings/calendarSettingsStore.js";
import { DecryptedEventRecord } from "./components/calendar/CalendarSidebar.js";
import { CalendarReminder } from "./calendar_crypto.js";

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error("Assertion failed: " + msg);
}

export async function runCalendarCategory08Tests(): Promise<{ passed: number; failed: number }> {
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

  // 1. Three-tier precedence resolution
  runTest("Cat 08.1: Three-tier reminder precedence (Event -> Calendar -> Global default)", () => {
    const globalSettings: CalendarUserSettings = {
      ...DEFAULT_CALENDAR_SETTINGS,
      defaultReminderMinutes: 15,
    };

    const calOverrides: Record<string, CalendarOverrides> = {
      "cal-work": { calendarId: "cal-work", defaultReminderMinutes: 30 },
      "cal-personal": { calendarId: "cal-personal" }, // No override
    };

    const baseEvent: DecryptedEventRecord = {
      id: "ev-1",
      calendarId: "cal-personal",
      startTime: new Date("2026-11-01T10:00:00Z"),
      endTime: new Date("2026-11-01T11:00:00Z"),
      isAllDay: false,
      status: "confirmed",
      details: {
        title: "Team Sync",
      },
    };

    // Tier 3: Falls back to Global Default (15 mins)
    const tier3 = resolveEventReminders(baseEvent, calOverrides, globalSettings);
    assert(tier3.length === 1, "tier3 should have 1 reminder");
    assert(tier3[0].minutesBefore === 15, "tier3 minutes should be 15");

    // Tier 2: Falls back to Calendar Override (30 mins)
    const tier2 = resolveEventReminders(
      { ...baseEvent, calendarId: "cal-work" },
      calOverrides,
      globalSettings
    );
    assert(tier2.length === 1, "tier2 should have 1 reminder");
    assert(tier2[0].minutesBefore === 30, "tier2 minutes should be 30");

    // Tier 1: Event-specific reminder takes absolute precedence
    const tier1 = resolveEventReminders(
      {
        ...baseEvent,
        calendarId: "cal-work",
        details: {
          title: "VIP Sync",
          reminders: [{ minutesBefore: 5, method: "notification" }],
        },
      },
      calOverrides,
      globalSettings
    );
    assert(tier1.length === 1, "tier1 should have 1 reminder");
    assert(tier1[0].minutesBefore === 5, "tier1 minutes should be 5");

    // Explicitly empty reminders disables reminders
    const disabled = resolveEventReminders(
      {
        ...baseEvent,
        calendarId: "cal-work",
        details: {
          title: "Quiet Focus",
          reminders: [],
        },
      },
      calOverrides,
      globalSettings
    );
    assert(disabled.length === 0, "explicit empty reminders should yield 0 reminders");
  });

  // 2. Trigger time calculation
  runTest("Cat 08.2: Calculate reminder trigger time for timed and all-day events", () => {
    const eventStart = new Date("2026-11-01T15:30:00Z");

    // 10 minutes before
    const trigger10m = calculateReminderTriggerTime(eventStart, 10, false);
    assert(
      trigger10m.getTime() === new Date("2026-11-01T15:20:00Z").getTime(),
      "10m before 15:30:00 should be 15:20:00"
    );

    // 1 day before (1440 mins)
    const trigger1d = calculateReminderTriggerTime(eventStart, 1440, false);
    assert(
      trigger1d.getTime() === new Date("2026-10-31T15:30:00Z").getTime(),
      "1 day before should be 24h prior"
    );

    // All-day event with custom allDayReminderTime ("08:30")
    const allDayStart = new Date("2026-11-05T00:00:00Z");
    const triggerAllDay = calculateReminderTriggerTime(allDayStart, 0, true, "08:30");
    assert(triggerAllDay.getHours() === 8, "all-day hour should match configured 8");
    assert(triggerAllDay.getMinutes() === 30, "all-day minute should match configured 30");

    // All-day event 1 day prior
    const triggerAllDayPrior = calculateReminderTriggerTime(allDayStart, 1440, true, "09:00");
    assert(triggerAllDayPrior.getDate() === 4, "all-day 1 day prior should be on 4th");
    assert(triggerAllDayPrior.getHours() === 9, "all-day prior hour should be 9");
  });

  // 3. Evaluation and Deduplication Ledger
  runTest("Cat 08.3: Reminder evaluation and deduplication ledger safeguard", () => {
    const now = new Date("2026-11-01T10:00:00Z");
    const ledger = new Set<string>();

    const events: DecryptedEventRecord[] = [
      {
        id: "ev-due",
        calendarId: "cal-main",
        startTime: new Date("2026-11-01T10:10:00Z"), // starts in 10 minutes
        endTime: new Date("2026-11-01T11:00:00Z"),
        isAllDay: false,
        status: "confirmed",
        details: {
          title: "Sprint Planning",
          location: "Room 101",
          reminders: [{ minutesBefore: 10, method: "notification" }],
        },
      },
      {
        id: "ev-far",
        calendarId: "cal-main",
        startTime: new Date("2026-11-01T14:00:00Z"), // starts in 4 hours
        endTime: new Date("2026-11-01T15:00:00Z"),
        isAllDay: false,
        status: "confirmed",
        details: {
          title: "Afternoon Review",
          reminders: [{ minutesBefore: 15, method: "notification" }],
        },
      },
      {
        id: "ev-past",
        calendarId: "cal-main",
        startTime: new Date("2026-11-01T08:00:00Z"),
        endTime: new Date("2026-11-01T09:00:00Z"), // already ended
        isAllDay: false,
        status: "confirmed",
        details: {
          title: "Morning Coffee",
          reminders: [{ minutesBefore: 10, method: "notification" }],
        },
      },
    ];

    const alerts1 = evaluateUpcomingReminders(
      events,
      now,
      DEFAULT_CALENDAR_SETTINGS,
      {},
      ledger,
      false
    );

    assert(alerts1.length === 1, "Only ev-due should fire an alert");
    assert(alerts1[0].eventId === "ev-due", "Triggered alert should belong to ev-due");
    assert(alerts1[0].title === "Sprint Planning", "Alert title should match");
    assert(alerts1[0].location === "Room 101", "Alert location should match");
    assert(ledger.size === 1, "Ledger should record exactly 1 dispatched key");

    // Second evaluation at the same instant must deduplicate and return empty
    const alerts2 = evaluateUpcomingReminders(
      events,
      now,
      DEFAULT_CALENDAR_SETTINGS,
      {},
      ledger,
      false
    );
    assert(alerts2.length === 0, "Deduplication ledger must suppress duplicate alerts");
  });

  // 4. Quiet hours suppression
  runTest("Cat 08.4: Quiet hours suppression for overnight and daytime windows", () => {
    // Overnight: 22:00 to 08:00
    const lateNight = new Date("2026-11-01T23:30:00");
    const earlyMorning = new Date("2026-11-02T05:45:00");
    const activeDay = new Date("2026-11-01T14:15:00");

    assert(
      isQuietHours(lateNight, true, "22:00", "08:00") === true,
      "23:30 should be inside overnight quiet hours"
    );
    assert(
      isQuietHours(earlyMorning, true, "22:00", "08:00") === true,
      "05:45 should be inside overnight quiet hours"
    );
    assert(
      isQuietHours(activeDay, true, "22:00", "08:00") === false,
      "14:15 should not be inside overnight quiet hours"
    );

    // Disabled quiet hours always returns false
    assert(
      isQuietHours(lateNight, false, "22:00", "08:00") === false,
      "Disabled quiet hours must return false regardless of time"
    );

    // Daytime window: 13:00 to 15:00
    assert(
      isQuietHours(new Date("2026-11-01T13:30:00"), true, "13:00", "15:00") === true,
      "13:30 is inside 13:00-15:00 quiet hours"
    );
    assert(
      isQuietHours(new Date("2026-11-01T15:30:00"), true, "13:00", "15:00") === false,
      "15:30 is outside 13:00-15:00 quiet hours"
    );
  });

  // 5. Privacy masking under locked mailbox and private/confidential visibility
  runTest("Cat 08.5: Privacy masking when mailbox is locked or visibility is private/confidential", () => {
    const now = new Date("2026-11-01T10:00:00Z");

    const confidentialEvent: DecryptedEventRecord = {
      id: "ev-conf",
      calendarId: "cal-main",
      startTime: new Date("2026-11-01T10:05:00Z"),
      endTime: new Date("2026-11-01T11:00:00Z"),
      isAllDay: false,
      status: "confirmed",
      details: {
        title: "Confidential Strategy Board",
        location: "Executive Suite 4B",
        visibility: "confidential",
        reminders: [{ minutesBefore: 5, method: "notification" }],
      },
    };

    // Case A: Unlocked mailbox, but event is confidential -> Masked to "Busy: Upcoming Event"
    const ledgerA = new Set<string>();
    const alertsA = evaluateUpcomingReminders(
      [confidentialEvent],
      now,
      DEFAULT_CALENDAR_SETTINGS,
      {},
      ledgerA,
      false // unlocked
    );
    assert(alertsA.length === 1, "Should trigger alert");
    assert(
      alertsA[0].title === "Busy: Upcoming Event",
      "Confidential event title must be masked to Busy"
    );
    assert(alertsA[0].location === undefined, "Confidential location must be stripped");
    assert(alertsA[0].isPrivate === true, "isPrivate flag must be true");

    // Case B: Mailbox is LOCKED -> Fails closed to "Upcoming Event"
    const publicEvent: DecryptedEventRecord = {
      id: "ev-pub",
      calendarId: "cal-main",
      startTime: new Date("2026-11-01T10:05:00Z"),
      endTime: new Date("2026-11-01T11:00:00Z"),
      isAllDay: false,
      status: "confirmed",
      details: {
        title: "Public All-Hands",
        location: "Main Auditorium",
        visibility: "public",
        reminders: [{ minutesBefore: 5, method: "notification" }],
      },
    };

    const ledgerB = new Set<string>();
    const alertsB = evaluateUpcomingReminders(
      [publicEvent],
      now,
      DEFAULT_CALENDAR_SETTINGS,
      {},
      ledgerB,
      true // LOCKED
    );
    assert(alertsB.length === 1, "Should trigger alert when locked");
    assert(
      alertsB[0].title === "Upcoming Event",
      "Locked mailbox must fail closed and mask title to 'Upcoming Event'"
    );
    assert(alertsB[0].location === undefined, "Locked mailbox must not expose location");
    assert(alertsB[0].isPrivate === true, "isPrivate must be set to true when locked");
  });

  // 6. Snooze alert calculation and relative formatting
  runTest("Cat 08.6: Snooze calculation and relative countdown formatting", () => {
    const now = new Date("2026-11-01T10:00:00Z");
    const dummyAlert = {
      alertId: "alert-1",
      eventId: "ev-1",
      baseEventId: "ev-1",
      title: "Design Review",
      startTime: new Date("2026-11-01T10:15:00Z"),
      endTime: new Date("2026-11-01T11:00:00Z"),
      isAllDay: false,
      isPrivate: false,
      minutesBefore: 15,
      triggerTime: now,
      isDismissed: false,
      method: "notification" as const,
    };

    const snoozed = snoozeReminderAlert(dummyAlert, 10, now);
    assert(snoozed.snoozeUntil !== undefined, "snoozeUntil should be set");
    assert(
      snoozed.snoozeUntil!.getTime() === new Date("2026-11-01T10:10:00Z").getTime(),
      "Snoozed time must be exactly 10 minutes in the future"
    );

    // Relative formatting tests
    assert(
      formatRelativeReminderTime(new Date(now.getTime() + 15 * 60000), now) === "in 15 minutes",
      "format in 15 minutes"
    );
    assert(
      formatRelativeReminderTime(new Date(now.getTime() + 60000), now) === "in 1 minute",
      "format in 1 minute"
    );
    assert(
      formatRelativeReminderTime(new Date(now.getTime()), now) === "starting now",
      "format starting now"
    );
    assert(
      formatRelativeReminderTime(new Date(now.getTime() - 5 * 60000), now) === "started 5m ago",
      "format started 5m ago"
    );
  });

  // 7. RFC 5545 VALARM export and parse roundtrip
  runTest("Cat 08.7: RFC 5545 VALARM export and parse roundtrip", () => {
    const rawTrigger = parseIcsTriggerMinutes("-PT15M");
    assert(rawTrigger === 15, "parseIcsTriggerMinutes -PT15M should be 15");

    const raw1Day = parseIcsTriggerMinutes("-P1D");
    assert(raw1Day === 1440, "parseIcsTriggerMinutes -P1D should be 1440");

    const rawHours = parseIcsTriggerMinutes("-PT1H30M");
    assert(rawHours === 90, "parseIcsTriggerMinutes -PT1H30M should be 90");

    const start = new Date("2026-11-10T14:00:00Z");
    const end = new Date("2026-11-10T15:00:00Z");

    const icsString = generateIcs({
      uid: "valarm-roundtrip-uid",
      title: "Quarterly Planning",
      startTime: start,
      endTime: end,
      reminders: [
        { minutesBefore: 15, method: "notification" },
        { minutesBefore: 1440, method: "email" },
      ],
    });

    assert(icsString.includes("BEGIN:VALARM"), "ICS output must include BEGIN:VALARM");
    assert(icsString.includes("ACTION:DISPLAY"), "Notification reminder must produce ACTION:DISPLAY");
    assert(icsString.includes("ACTION:EMAIL"), "Email reminder must produce ACTION:EMAIL");
    assert(icsString.includes("TRIGGER:-PT15M"), "15m reminder must produce TRIGGER:-PT15M");
    assert(icsString.includes("TRIGGER:-PT1440M"), "1440m reminder must produce TRIGGER:-PT1440M");

    // Parse the generated ICS back
    const parsed = parseIcs(icsString);
    assert(parsed.events.length === 1, "Parsed ICS should have 1 event");
    const parsedEvent = parsed.events[0];
    assert(parsedEvent.reminders !== undefined, "Parsed event should have reminders");
    assert(parsedEvent.reminders!.length === 2, "Parsed event should have 2 reminders");
    assert(parsedEvent.reminders![0].minutesBefore === 15, "First reminder minutes should be 15");
    assert(parsedEvent.reminders![0].method === "notification", "First reminder method should be notification");
    assert(parsedEvent.reminders![1].minutesBefore === 1440, "Second reminder minutes should be 1440");
    assert(parsedEvent.reminders![1].method === "email", "Second reminder method should be email");
  });

  // 8. Persistent Ledger across component unmount/remount (Switching Mailbox <-> Calendar)
  runTest("Cat 08.8: Persistent ledger survives across simulated mailbox switch / component remount", () => {
    clearDispatchedLedger();
    const ledger = getDispatchedLedger();

    const ev: DecryptedEventRecord = {
      id: "ev-persistent-test",
      calendarId: "cal-main",
      startTime: new Date("2026-11-01T10:10:00Z"),
      endTime: new Date("2026-11-01T11:00:00Z"),
      isAllDay: false,
      status: "confirmed",
      details: {
        title: "Executive Standup",
        reminders: [{ minutesBefore: 10, method: "notification" }],
      },
    };

    const now = new Date("2026-11-01T10:01:00Z");

    // First mount: evaluate upcoming reminders
    const triggered1 = evaluateUpcomingReminders([ev], now, DEFAULT_CALENDAR_SETTINGS, {}, ledger, false);
    assert(triggered1.length === 1, "Alert triggers on first mount");
    assert(ledger.has(triggered1[0].alertId), "Alert ID recorded in ledger");

    // User dismisses alert or auto-dismiss fires
    markAlertDispatched(triggered1[0].alertId);

    // Simulate switching away to Mailbox (component unmounts) and coming back to Calendar (component remounts)
    // New lifecycle retrieves ledger via getDispatchedLedger()
    const remountedLedger = getDispatchedLedger();
    assert(remountedLedger.has(triggered1[0].alertId), "Remounted ledger must retain dismissed alert ID");

    // Second evaluation on remount must NOT trigger the alert again!
    const triggered2 = evaluateUpcomingReminders([ev], now, DEFAULT_CALENDAR_SETTINGS, {}, remountedLedger, false);
    assert(triggered2.length === 0, "Dismissed alert must NOT re-trigger when returning from mailbox to calendar");

    // Clean up
    clearDispatchedLedger();
  });

  return { passed, failed };
}
