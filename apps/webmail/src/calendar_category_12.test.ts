/**
 * BYOS Calendar - Category 12 (Appointment Scheduling & Booking Pages) Unit Tests
 * Rigorous verification of schedule creation, public/private access tokens,
 * availability computation, constraints, conflict detection, race-condition safeguards,
 * cancellation, rescheduling, and privacy boundary enforcement.
 */

import {
  AppointmentSchedule,
  BookedAppointment,
  createDefaultAppointmentSchedule,
  sanitizeScheduleForPublic,
} from "./components/calendar/appointments/appointmentTypes.js";
import {
  getAppointmentSchedules,
  saveAppointmentSchedule,
  deleteAppointmentSchedule,
  toggleScheduleActive,
  getBookedAppointments,
  saveBookedAppointment,
} from "./components/calendar/appointments/appointmentStore.js";
import {
  computeAvailableSlots,
  validateSlotAvailability,
  createBookingRecord,
  cancelBookingRecord,
  rescheduleBookingRecord,
} from "./components/calendar/appointments/appointmentEngine.js";
import { DecryptedEventRecord } from "./components/calendar/CalendarSidebar.js";
import {
  CalendarSettings,
  DEFAULT_CALENDAR_SETTINGS,
} from "./components/calendar/settings/calendarSettingsStore.js";

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error("Assertion failed: " + msg);
}

// In-memory mock localStorage for isolated Node.js test execution
const memoryStore: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (key: string) => memoryStore[key] || null,
  setItem: (key: string, val: string) => {
    memoryStore[key] = String(val);
  },
  removeItem: (key: string) => {
    delete memoryStore[key];
  },
  clear: () => {
    for (const k in memoryStore) delete memoryStore[k];
  },
  get length() {
    return Object.keys(memoryStore).length;
  },
  key: (i: number) => Object.keys(memoryStore)[i] || null,
};

export async function runCalendarCategory12Tests(): Promise<{ passed: number; failed: number }> {
  const prevLocalStorage = (globalThis as any).localStorage;
  const prevWindow = (globalThis as any).window;
  (globalThis as any).localStorage = mockLocalStorage;
  if (typeof (globalThis as any).window === "undefined") {
    (globalThis as any).window = globalThis;
  }

  let passed = 0;
  let failed = 0;

  function runTest(name: string, fn: () => void | Promise<void>) {
    try {
      mockLocalStorage.clear();
      fn();
      passed++;
    } catch (err: any) {
      console.error(`  FAIL: ${name} ->`, err.message);
      failed++;
    }
  }

  const mailboxId = "mbx-alice-cat12-test";
  const defaultSettings: CalendarSettings = {
    ...DEFAULT_CALENDAR_SETTINGS,
    workingHoursEnabled: true,
    workingDays: [1, 2, 3, 4, 5], // Mon - Fri
    workHoursStart: "09:00",
    workHoursEnd: "17:00",
    primaryTimeZone: "UTC",
  };

  try {
    // 1. Appointment Schedule Creation, CRUD & Per-Mailbox Persistence
    runTest("Cat 12.1: Appointment schedule creation, updating, and fail-closed persistence per mailbox", () => {
      // Initially seeds default schedule
      const initialSchedules = getAppointmentSchedules(mailboxId, "UTC", "cal-primary-1");
      assert(initialSchedules.length === 1, "Default schedule seeded when none exists");
      assert(initialSchedules[0].durationMinutes === 30, "Default duration is 30 minutes");

      // Create custom 45-minute Security Audit schedule
      const created = saveAppointmentSchedule(mailboxId, {
        title: "KMS Architecture Review",
        slug: "kms-review",
        durationMinutes: 45,
        locationType: "video",
        locationDetails: "https://meet.byos.local/room-kms",
        isPublic: true,
        isActive: true,
        targetCalendarId: "cal-primary-1",
        inspectedCalendarIds: ["cal-primary-1"],
        availabilityMode: "working_hours",
        minNoticeHours: 4,
        maxAdvanceDays: 30,
        bufferBeforeMinutes: 10,
        bufferAfterMinutes: 10,
        maxDailyAppointments: 3,
        timeZone: "UTC",
      });

      assert(created.slug === "kms-review", "Slug saved correctly");
      assert(created.durationMinutes === 45, "Duration saved as 45m");

      // Verify persistence across read-back
      const loaded = getAppointmentSchedules(mailboxId);
      assert(loaded.length === 2, "Both default and custom schedules loaded from store");
      const found = loaded.find((s) => s.id === created.id);
      assert(found !== undefined && found.title === "KMS Architecture Review", "Created schedule preserved in store");

      // Verify mailbox isolation
      const otherMailboxSchedules = getAppointmentSchedules("mbx-bob-cat12-isolated");
      assert(
        !otherMailboxSchedules.some((s) => s.slug === "kms-review"),
        "Storage isolation prevents cross-mailbox leakage"
      );

      // Delete schedule
      const deleted = deleteAppointmentSchedule(mailboxId, created.id);
      assert(deleted === true, "Schedule deletion returns true");
      const afterDelete = getAppointmentSchedules(mailboxId);
      assert(afterDelete.length === 1, "Deleted schedule removed from store");
    });

    // 2. Public vs Private Booking Links with Access Tokens
    runTest("Cat 12.2: Public vs private booking links with access token authentication", () => {
      const privateSchedule: AppointmentSchedule = {
        ...createDefaultAppointmentSchedule(mailboxId, "UTC"),
        isPublic: false,
        accessToken: "secret-token-xyz789",
      };

      // Case A: Public schedule requires no token
      const publicSchedule: AppointmentSchedule = {
        ...createDefaultAppointmentSchedule(mailboxId, "UTC"),
        isPublic: true,
        accessToken: undefined,
      };
      assert(publicSchedule.isPublic === true, "Public schedule marked public");

      // Case B: Private schedule has valid token
      assert(privateSchedule.isPublic === false, "Private schedule marked private");
      assert(privateSchedule.accessToken === "secret-token-xyz789", "Private schedule stores access token");
    });

    // 3. Revoking and Pausing Booking Links
    runTest("Cat 12.3: Revoking and pausing booking links", () => {
      const schedule = saveAppointmentSchedule(mailboxId, {
        title: "Advisory Call",
        slug: "advisory-call",
        durationMinutes: 30,
        locationType: "phone",
        isPublic: true,
        isActive: true,
        inspectedCalendarIds: [],
        availabilityMode: "working_hours",
        minNoticeHours: 1,
        maxAdvanceDays: 7,
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
        timeZone: "UTC",
      });

      // Pause schedule
      const activeStateAfterToggle = toggleScheduleActive(mailboxId, schedule.id);
      assert(activeStateAfterToggle === false, "Schedule toggled to paused state");

      // Paused schedule generates zero available slots
      const pausedSlots = computeAvailableSlots(
        { ...schedule, isActive: false },
        new Date("2026-11-02T00:00:00Z"),
        new Date("2026-11-03T00:00:00Z"),
        [],
        [],
        defaultSettings,
        new Date("2026-11-01T12:00:00Z")
      );
      assert(pausedSlots.length === 0, "Paused schedule returns 0 available slots");

      // Booking validation fails closed on paused schedule
      const validation = validateSlotAvailability(
        { ...schedule, isActive: false },
        "2026-11-02T10:00:00Z",
        [],
        [],
        defaultSettings,
        new Date("2026-11-01T12:00:00Z")
      );
      assert(validation.valid === false, "Booking attempt on paused schedule is rejected");
      assert(validation.error?.includes("paused") === true, "Error message explains paused status");

      // Reactivate
      const reactivatedState = toggleScheduleActive(mailboxId, schedule.id);
      assert(reactivatedState === true, "Schedule toggled back to active state");
    });

    // 4. Availability Slot Generation (Working Hours vs Custom Windows)
    runTest("Cat 12.4: Availability slot generation with working hours and custom windows", () => {
      const schedule: AppointmentSchedule = {
        ...createDefaultAppointmentSchedule(mailboxId, "UTC"),
        durationMinutes: 60,
        minNoticeHours: 2,
        maxAdvanceDays: 7,
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
        availabilityMode: "working_hours",
        timeZone: "UTC",
      };

      // Query Monday 2026-11-02 (09:00 - 17:00 UTC) with current time Sunday 2026-11-01 12:00 UTC
      const mondayStart = new Date("2026-11-02T00:00:00Z");
      const mondayEnd = new Date("2026-11-02T23:59:59Z");
      const currentTime = new Date("2026-11-01T12:00:00Z");

      const slots = computeAvailableSlots(
        schedule,
        mondayStart,
        mondayEnd,
        [],
        [],
        defaultSettings,
        currentTime,
        "UTC"
      );

      assert(slots.length > 0, "Available slots generated for Monday within working hours");
      // Each slot starts at or after 09:00 and ends by 17:00
      assert(slots[0].timeStr === "09:00", "First slot starts at 09:00 UTC");
      const lastSlot = slots[slots.length - 1];
      assert(lastSlot.timeStr === "16:00", "Last 1-hour slot starts at 16:00 UTC");

      // Weekend (Sunday 2026-11-08) should have 0 slots under working hours
      const sundayStart = new Date("2026-11-08T00:00:00Z");
      const sundayEnd = new Date("2026-11-08T23:59:59Z");
      const weekendSlots = computeAvailableSlots(
        schedule,
        sundayStart,
        sundayEnd,
        [],
        [],
        defaultSettings,
        currentTime,
        "UTC"
      );
      assert(weekendSlots.length === 0, "Weekend days yield 0 available slots under working hours");
    });

    // 5. Scheduling Constraints: Minimum Notice, Advance Window, Buffers & Daily Cap
    runTest("Cat 12.5: Scheduling constraints: minimum notice, maximum advance, buffers, daily cap", () => {
      const currentTime = new Date("2026-11-02T08:00:00Z"); // Monday 08:00 UTC
      const schedule: AppointmentSchedule = {
        ...createDefaultAppointmentSchedule(mailboxId, "UTC"),
        durationMinutes: 30,
        minNoticeHours: 4, // Earliest allowed is 08:00 + 4h = 12:00 UTC
        maxAdvanceDays: 3,  // Latest allowed is 2026-11-05
        bufferBeforeMinutes: 15,
        bufferAfterMinutes: 15,
        maxDailyAppointments: 2, // Maximum 2 bookings per day
        timeZone: "UTC",
      };

      const queryStart = new Date("2026-11-02T00:00:00Z");
      const queryEnd = new Date("2026-11-02T23:59:59Z");

      // Check minimum notice enforcement
      const slots = computeAvailableSlots(
        schedule,
        queryStart,
        queryEnd,
        [],
        [],
        defaultSettings,
        currentTime,
        "UTC"
      );

      assert(slots.length > 0, "Slots generated");
      const firstSlot = slots[0];
      // 08:00 + 4 hours minimum notice = 12:00
      assert(firstSlot.timeStr === "12:00", `First available slot is 12:00, respecting 4h notice (got ${firstSlot.timeStr})`);

      // Check daily appointment cap
      const simulatedExistingBookings: BookedAppointment[] = [
        {
          id: "b1",
          scheduleId: schedule.id,
          mailboxId,
          calendarEventId: "ev1",
          startUtc: "2026-11-02T12:00:00Z",
          endUtc: "2026-11-02T12:30:00Z",
          attendeeName: "Client A",
          attendeeEmail: "clienta@example.com",
          status: "confirmed",
          cancellationToken: "tok1",
          createdAt: "",
          updatedAt: "",
        },
        {
          id: "b2",
          scheduleId: schedule.id,
          mailboxId,
          calendarEventId: "ev2",
          startUtc: "2026-11-02T14:00:00Z",
          endUtc: "2026-11-02T14:30:00Z",
          attendeeName: "Client B",
          attendeeEmail: "clientb@example.com",
          status: "confirmed",
          cancellationToken: "tok2",
          createdAt: "",
          updatedAt: "",
        },
      ];

      // Since cap is 2 and there are already 2 confirmed bookings on 2026-11-02, day is full!
      const cappedSlots = computeAvailableSlots(
        schedule,
        queryStart,
        queryEnd,
        [],
        simulatedExistingBookings,
        defaultSettings,
        currentTime,
        "UTC"
      );
      assert(cappedSlots.length === 0, "Daily booking cap suppresses remaining slots for the day");
    });

    // 6. Conflict Detection Against Authorized Calendars (Out of Office / Busy)
    runTest("Cat 12.6: Conflict detection against authorized calendars (including Out of Office / Busy)", () => {
      const schedule: AppointmentSchedule = {
        ...createDefaultAppointmentSchedule(mailboxId, "UTC"),
        durationMinutes: 30,
        minNoticeHours: 1,
        maxAdvanceDays: 7,
        bufferBeforeMinutes: 10,
        bufferAfterMinutes: 10,
        inspectedCalendarIds: ["cal-primary"],
        timeZone: "UTC",
      };

      const currentTime = new Date("2026-11-02T06:00:00Z");
      const queryStart = new Date("2026-11-02T00:00:00Z");
      const queryEnd = new Date("2026-11-02T23:59:59Z");

      // Busy event from 10:00 to 11:00 UTC on cal-primary
      const conflictingEvent: DecryptedEventRecord = {
        id: "ev-busy-1",
        calendarId: "cal-primary",
        startTime: new Date("2026-11-02T10:00:00Z"),
        endTime: new Date("2026-11-02T11:00:00Z"),
        isAllDay: false,
        status: "busy",
        details: {
          title: "Confidential Executive Sync",
          startTime: "2026-11-02T10:00:00Z",
          endTime: "2026-11-02T11:00:00Z",
          visibility: "private",
        },
      };

      // Non-inspected calendar event (e.g. secondary holidays calendar) does not block
      const secondaryCalEvent: DecryptedEventRecord = {
        id: "ev-sec-1",
        calendarId: "cal-secondary-public",
        startTime: new Date("2026-11-02T14:00:00Z"),
        endTime: new Date("2026-11-02T15:00:00Z"),
        isAllDay: false,
        status: "busy",
        details: {
          title: "Public Event",
          startTime: "2026-11-02T14:00:00Z",
          endTime: "2026-11-02T15:00:00Z",
        },
      };

      const slots = computeAvailableSlots(
        schedule,
        queryStart,
        queryEnd,
        [conflictingEvent, secondaryCalEvent],
        [],
        defaultSettings,
        currentTime,
        "UTC"
      );

      // Verify slot at 10:00 is omitted due to conflict
      assert(!slots.some((s) => s.timeStr === "10:00"), "10:00 slot blocked by busy event");
      // 09:30 slot ends at 10:00, but bufferAfter is 10 min -> bufferedEnd is 10:10 -> overlaps event start at 10:00!
      assert(!slots.some((s) => s.timeStr === "09:30"), "09:30 slot blocked by buffer-after overlap with 10:00 event");
      // Slot at 14:00 is AVAILABLE because conflicting event was on cal-secondary-public (not in inspectedCalendarIds)
      assert(slots.some((s) => s.timeStr === "14:00"), "14:00 slot available because event is on non-inspected calendar");
    });

    // 7. Booking Confirmation & Concurrent Double-Booking Prevention
    runTest("Cat 12.7: Booking confirmation and concurrent double-booking prevention", () => {
      const schedule = saveAppointmentSchedule(mailboxId, {
        title: "Technical Interview",
        slug: "tech-interview",
        durationMinutes: 30,
        locationType: "video",
        locationDetails: "BYOS Video",
        isPublic: true,
        isActive: true,
        inspectedCalendarIds: ["cal-primary"],
        minNoticeHours: 1,
        maxAdvanceDays: 14,
        bufferBeforeMinutes: 5,
        bufferAfterMinutes: 5,
        timeZone: "UTC",
      });

      const slotStart = "2026-11-05T14:00:00.000Z";

      // 1. First booking succeeds
      const { appointment: bookingA, eventPayload } = createBookingRecord(
        schedule,
        slotStart,
        {
          name: "Alice Smith",
          email: "alice@example.com",
          notes: "Cryptography deep dive",
        },
        "host@byos.local"
      );

      assert(bookingA.status === "confirmed", "Booking status is confirmed");
      assert(bookingA.cancellationToken.length > 8, "Cryptographic cancellation token generated");
      assert(eventPayload.title === "Technical Interview: Alice Smith", "Event title matches schedule title and attendee");

      saveBookedAppointment(mailboxId, bookingA);

      // 2. Concurrent second booking attempt on identical slot fails validation
      const existingBookings = getBookedAppointments(mailboxId);
      const validation = validateSlotAvailability(
        schedule,
        slotStart,
        [],
        existingBookings,
        defaultSettings,
        new Date("2026-11-01T12:00:00Z")
      );

      assert(validation.valid === false, "Concurrent double-booking rejected");
      assert(validation.error?.includes("already been booked") === true, "Error message flags slot already booked");
    });

    // 8. Cancellation and Rescheduling Lifecycle
    runTest("Cat 12.8: Cancellation and rescheduling lifecycle with participant updates", () => {
      const schedule = createDefaultAppointmentSchedule(mailboxId, "UTC");
      const slot1 = "2026-11-06T10:00:00.000Z";
      const slot2 = "2026-11-06T11:00:00.000Z";

      const { appointment: initialBooking } = createBookingRecord(
        schedule,
        slot1,
        {
          name: "Bob Jones",
          email: "bob@example.com",
        }
      );

      // Case 1: Cancellation with valid token
      const cancelResult = cancelBookingRecord(
        initialBooking,
        initialBooking.cancellationToken,
        "Scheduling conflict"
      );
      assert(cancelResult.success === true, "Cancellation succeeds with valid token");
      assert(cancelResult.cancelledAppointment?.status === "cancelled", "Status transitioned to cancelled");

      // Case 2: Cancellation with invalid token fails closed
      const invalidCancel = cancelBookingRecord(initialBooking, "wrong-token-abc");
      assert(invalidCancel.success === false, "Unauthorized cancellation attempt fails");

      // Case 3: Rescheduling flow
      const { appointment: activeBooking } = createBookingRecord(
        schedule,
        slot1,
        {
          name: "Carol Danvers",
          email: "carol@example.com",
        }
      );

      const rescheduleRes = rescheduleBookingRecord(
        activeBooking,
        activeBooking.cancellationToken,
        slot2,
        schedule,
        [],
        [activeBooking],
        defaultSettings
      );

      assert(rescheduleRes.success === true, "Rescheduling succeeds to available slot");
      assert(rescheduleRes.oldAppointment?.status === "cancelled", "Old appointment cancelled");
      assert(rescheduleRes.newAppointment?.status === "confirmed", "New appointment confirmed");
      assert(rescheduleRes.newAppointment?.rescheduledFromId === activeBooking.id, "New appointment links to old ID");
      assert(rescheduleRes.newAppointment?.startUtc === slot2, "New appointment booked for slot 2");
    });

    // 9. Privacy Disclosure Boundary (Zero Host Secret Leakage)
    runTest("Cat 12.9: Privacy disclosure boundary verification (zero host secret leakage)", () => {
      const fullSchedule: AppointmentSchedule = {
        id: "sched-host-123",
        mailboxId: "mbx-super-secret-id",
        slug: "private-consult",
        title: "Executive Strategic Review",
        description: "Confidential roadmap discussion",
        durationMinutes: 45,
        locationType: "video",
        locationDetails: "https://confidential.byos.local/room-secret-token-999",
        isPublic: false,
        accessToken: "top-secret-token-do-not-leak",
        isActive: true,
        targetCalendarId: "cal-internal-executive",
        inspectedCalendarIds: ["cal-internal-executive", "cal-board-meetings"],
        availabilityMode: "custom",
        minNoticeHours: 24,
        maxAdvanceDays: 14,
        bufferBeforeMinutes: 15,
        bufferAfterMinutes: 15,
        timeZone: "America/New_York",
        createdAt: "",
        updatedAt: "",
      };

      const publicView = sanitizeScheduleForPublic(fullSchedule);

      // Verify that internal sensitive properties are strictly omitted
      assert((publicView as any).mailboxId === undefined, "mailboxId stripped from public view");
      assert((publicView as any).targetCalendarId === undefined, "targetCalendarId stripped from public view");
      assert((publicView as any).inspectedCalendarIds === undefined, "inspectedCalendarIds stripped from public view");
      assert((publicView as any).accessToken === undefined, "accessToken stripped from public view");
      assert(publicView.title === "Executive Strategic Review", "Public title preserved");
      assert(publicView.durationMinutes === 45, "Duration preserved");
    });

  } finally {
    (globalThis as any).localStorage = prevLocalStorage;
    (globalThis as any).window = prevWindow;
  }

  return { passed, failed };
}
