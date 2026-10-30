/**
 * BYOS Calendar - Category 12: Appointment Scheduling and Booking Pages
 * Engine for availability slot computation, conflict detection, booking, cancellation, and rescheduling.
 */

import {
  AppointmentSchedule,
  BookedAppointment,
  AvailableSlot,
} from "./appointmentTypes";
import { DecryptedEventRecord } from "../CalendarSidebar";
import { CalendarSettings } from "../settings/calendarSettingsStore";
import { CalendarEventPlaintext } from "../../../calendar_crypto";
import { utcToZonedParts, zonedTimeToUtc } from "../../../utils/calendarTimezones";

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/**
 * Parses "HH:mm" into minutes from start of day.
 */
function parseTimeToMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Formats minutes from start of day into "HH:mm".
 */
function formatMinutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${pad2(h)}:${pad2(m)}`;
}

/**
 * Formats 24h time "HH:mm" into user-friendly 12h or 24h format.
 */
function formatTimeDisplay(timeStr: string, use12h: boolean = true): string {
  if (!use12h) return timeStr;
  const [hStr, mStr] = timeStr.split(":");
  let h = parseInt(hStr, 10);
  const m = mStr;
  const ampm = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${ampm}`;
}

/**
 * Converts dateStr ("YYYY-MM-DD") and timeStr ("HH:mm") in timeZone to UTC Date.
 */
function parseZonedToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hour, min] = timeStr.split(":").map(Number);
  return zonedTimeToUtc(y, m, d, hour, min, timeZone || "UTC");
}

/**
 * Computes available booking slots for an appointment schedule across a query date range.
 * Respects working hours, custom weekly windows, minimum notice, advance booking limit,
 * before/after buffer times, daily appointment ceilings, and calendar conflicts.
 */
export function computeAvailableSlots(
  schedule: AppointmentSchedule,
  queryStartDate: Date,
  queryEndDate: Date,
  existingEvents: DecryptedEventRecord[],
  existingBookings: BookedAppointment[],
  settings: CalendarSettings,
  currentTime: Date = new Date(),
  displayTimeZone?: string
): AvailableSlot[] {
  if (!schedule.isActive) {
    return []; // Paused or revoked schedules offer zero available slots
  }

  const targetTz = displayTimeZone || schedule.timeZone || settings.primaryTimeZone || "UTC";
  const slots: AvailableSlot[] = [];

  // Minimum notice cutoff instant
  const minNoticeMs = schedule.minNoticeHours * 60 * 60 * 1000;
  const minNoticeThreshold = new Date(currentTime.getTime() + minNoticeMs);

  // Maximum advance cutoff instant
  const maxAdvanceMs = schedule.maxAdvanceDays * 24 * 60 * 60 * 1000;
  const maxAdvanceThreshold = new Date(currentTime.getTime() + maxAdvanceMs);

  // Filter events to inspected calendars
  const inspectedSet = new Set(schedule.inspectedCalendarIds || []);
  const relevantEvents = existingEvents.filter((ev) => {
    // If specific calendars are designated, filter to those
    if (inspectedSet.size > 0 && !inspectedSet.has(ev.calendarId)) {
      return false;
    }
    // Transparent or free events do not block booking slots
    if (ev.status === "free" || ev.details?.visibility === "confidential") {
      // Confidential events still occupy time unless status is free
      if (ev.status === "free") return false;
    }
    // Cancelled events do not conflict
    if (ev.status === "cancelled") return false;
    return true;
  });

  // Filter confirmed bookings across this mailbox
  const activeBookings = existingBookings.filter(
    (b) => b.status === "confirmed" && b.mailboxId === schedule.mailboxId
  );

  // Build daily counts for max daily appointments check
  const dailyBookingsCount: Record<string, number> = {};
  for (const b of activeBookings) {
    if (b.scheduleId === schedule.id) {
      const bDate = b.startUtc.slice(0, 10);
      dailyBookingsCount[bDate] = (dailyBookingsCount[bDate] || 0) + 1;
    }
  }

  // Iterate day by day from queryStartDate to queryEndDate
  const curr = new Date(queryStartDate);
  curr.setUTCHours(0, 0, 0, 0);
  const end = new Date(queryEndDate);
  end.setUTCHours(23, 59, 59, 999);

  while (curr <= end) {
    const { dateStr } = utcToZonedParts(curr, schedule.timeZone);
    const [y, m, d] = dateStr.split("-").map(Number);
    const dayOfWeek = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();

    // Check daily bookings limit
    if (
      schedule.maxDailyAppointments !== undefined &&
      schedule.maxDailyAppointments > 0 &&
      (dailyBookingsCount[dateStr] || 0) >= schedule.maxDailyAppointments
    ) {
      curr.setUTCDate(curr.getUTCDate() + 1);
      continue;
    }

    // Determine availability windows for this date
    let windows: { start: string; end: string }[] = [];

    // 1. Date-specific overrides
    const override = schedule.dateOverrides?.find((o) => o.date === dateStr);
    if (override) {
      if (override.isUnavailable) {
        // Entire day is unavailable
        curr.setUTCDate(curr.getUTCDate() + 1);
        continue;
      }
      if (override.windows && override.windows.length > 0) {
        windows = override.windows.map((w) => ({ start: w.startTime, end: w.endTime }));
      }
    }

    // 2. Schedule mode
    if (windows.length === 0) {
      if (schedule.availabilityMode === "working_hours") {
        // Use working hours configuration
        if (settings.workingHoursEnabled) {
          const workingDays = settings.workingDays || [1, 2, 3, 4, 5];
          if (workingDays.includes(dayOfWeek)) {
            if (
              settings.workingPeriodsByDay &&
              settings.workingPeriodsByDay[dayOfWeek] &&
              settings.workingPeriodsByDay[dayOfWeek].length > 0
            ) {
              windows = settings.workingPeriodsByDay[dayOfWeek].map((p) => ({
                start: p.start,
                end: p.end,
              }));
            } else {
              windows = [{
                start: settings.workHoursStart || "09:00",
                end: settings.workHoursEnd || "17:00",
              }];
            }
          }
        } else {
          // Working hours disabled: default to 09:00 - 17:00 weekdays
          if (dayOfWeek >= 1 && dayOfWeek <= 5) {
            windows = [{ start: "09:00", end: "17:00" }];
          }
        }
      } else {
        // Custom weekly windows defined on the schedule
        const customWindows = schedule.customWeeklyWindows?.filter(
          (w) => w.dayOfWeek === dayOfWeek
        ) || [];
        windows = customWindows.map((w) => ({ start: w.startTime, end: w.endTime }));
      }
    }

    // Process windows for this day
    const duration = schedule.durationMinutes;
    const bufferBefore = schedule.bufferBeforeMinutes;
    const bufferAfter = schedule.bufferAfterMinutes;

    for (const win of windows) {
      let slotStartMin = parseTimeToMinutes(win.start);
      const winEndMin = parseTimeToMinutes(win.end);

      while (slotStartMin + duration <= winEndMin) {
        const slotEndMin = slotStartMin + duration;
        const slotStartTimeStr = formatMinutesToTime(slotStartMin);
        const slotEndTimeStr = formatMinutesToTime(slotEndMin);

        // Convert slot start and end to UTC Date objects based on schedule timezone
        const slotStartUtc = parseZonedToUtc(dateStr, slotStartTimeStr, schedule.timeZone);
        const slotEndUtc = parseZonedToUtc(dateStr, slotEndTimeStr, schedule.timeZone);

        // Advance booking & notice checks
        if (slotStartUtc >= minNoticeThreshold && slotStartUtc <= maxAdvanceThreshold) {
          // Expand slot window with buffer periods
          const bufferedStartMs = slotStartUtc.getTime() - bufferBefore * 60 * 1000;
          const bufferedEndMs = slotEndUtc.getTime() + bufferAfter * 60 * 1000;

          // Conflict Check 1: Existing Calendar Events
          let hasConflict = false;
          for (const ev of relevantEvents) {
            if (!ev || !ev.startTime || !ev.endTime) continue;
            const evStartMs = ev.startTime instanceof Date ? ev.startTime.getTime() : new Date(ev.startTime).getTime();
            const evEndMs = ev.endTime instanceof Date ? ev.endTime.getTime() : new Date(ev.endTime).getTime();
            if (isNaN(evStartMs) || isNaN(evEndMs)) continue;

            // Check interval overlap: [evStart, evEnd) overlaps [bufferedStart, bufferedEnd)
            if (evStartMs < bufferedEndMs && evEndMs > bufferedStartMs) {
              hasConflict = true;
              break;
            }
          }

          // Conflict Check 2: Existing Confirmed Booked Appointments
          if (!hasConflict) {
            for (const b of activeBookings) {
              const bStartMs = new Date(b.startUtc).getTime();
              const bEndMs = new Date(b.endUtc).getTime();

              if (bStartMs < bufferedEndMs && bEndMs > bufferedStartMs) {
                hasConflict = true;
                break;
              }
            }
          }

          if (!hasConflict) {
            // Format slot in the requested display timezone
            const displayStartParts = utcToZonedParts(slotStartUtc, targetTz);
            const displayEndParts = utcToZonedParts(slotEndUtc, targetTz);

            slots.push({
              startUtc: slotStartUtc.toISOString(),
              endUtc: slotEndUtc.toISOString(),
              dateStr: displayStartParts.dateStr,
              timeStr: displayStartParts.timeStr,
              formattedRange: `${formatTimeDisplay(displayStartParts.timeStr)} - ${formatTimeDisplay(displayEndParts.timeStr)}`,
            });
          }
        }

        // Advance to next candidate slot increment
        slotStartMin += duration >= 30 ? 30 : 15;
      }
    }

    curr.setUTCDate(curr.getUTCDate() + 1);
  }

  return slots;
}

/**
 * Validates whether a specific slot can be safely booked without conflicts.
 * Fail-closed assertion prevents race conditions and concurrent double-bookings.
 */
export function validateSlotAvailability(
  schedule: AppointmentSchedule,
  slotStartUtcStr: string,
  existingEvents: DecryptedEventRecord[],
  existingBookings: BookedAppointment[],
  settings: CalendarSettings,
  currentTime: Date = new Date()
): { valid: boolean; error?: string } {
  if (!schedule.isActive) {
    return { valid: false, error: "This booking schedule has been paused by the host." };
  }

  const slotStartUtc = new Date(slotStartUtcStr);
  if (isNaN(slotStartUtc.getTime())) {
    return { valid: false, error: "Invalid slot timestamp format." };
  }

  const durationMs = schedule.durationMinutes * 60 * 1000;
  const slotEndUtc = new Date(slotStartUtc.getTime() + durationMs);

  // Notice cutoff
  const minNoticeMs = schedule.minNoticeHours * 60 * 60 * 1000;
  if (slotStartUtc.getTime() < currentTime.getTime() + minNoticeMs) {
    return { valid: false, error: "This time slot violates the minimum scheduling notice requirement." };
  }

  // Advance booking cutoff
  const maxAdvanceMs = schedule.maxAdvanceDays * 24 * 60 * 60 * 1000;
  if (slotStartUtc.getTime() > currentTime.getTime() + maxAdvanceMs) {
    return { valid: false, error: "This time slot exceeds the maximum advance booking window." };
  }

  // Buffer calculation
  const bufferedStartMs = slotStartUtc.getTime() - schedule.bufferBeforeMinutes * 60 * 1000;
  const bufferedEndMs = slotEndUtc.getTime() + schedule.bufferAfterMinutes * 60 * 1000;

  // Inspected calendar events
  const inspectedSet = new Set(schedule.inspectedCalendarIds || []);
  for (const ev of existingEvents) {
    if (!ev || !ev.startTime || !ev.endTime) continue;
    if (inspectedSet.size > 0 && !inspectedSet.has(ev.calendarId)) continue;
    if (ev.status === "free" || ev.status === "cancelled") continue;

    const evStart = ev.startTime instanceof Date ? ev.startTime.getTime() : new Date(ev.startTime).getTime();
    const evEnd = ev.endTime instanceof Date ? ev.endTime.getTime() : new Date(ev.endTime).getTime();
    if (isNaN(evStart) || isNaN(evEnd)) continue;
    if (evStart < bufferedEndMs && evEnd > bufferedStartMs) {
      return { valid: false, error: "The host is no longer available at this time." };
    }
  }

  // Confirmed bookings conflict check
  for (const b of existingBookings) {
    if (b.status !== "confirmed") continue;
    const bStart = new Date(b.startUtc).getTime();
    const bEnd = new Date(b.endUtc).getTime();
    if (bStart < bufferedEndMs && bEnd > bufferedStartMs) {
      return { valid: false, error: "This slot has already been booked by another participant." };
    }
  }

  // Daily limit check
  if (schedule.maxDailyAppointments && schedule.maxDailyAppointments > 0) {
    const slotDateStr = slotStartUtc.toISOString().slice(0, 10);
    const dayCount = existingBookings.filter(
      (b) => b.scheduleId === schedule.id && b.status === "confirmed" && b.startUtc.startsWith(slotDateStr)
    ).length;
    if (dayCount >= schedule.maxDailyAppointments) {
      return { valid: false, error: "The maximum daily appointment limit for this date has been reached." };
    }
  }

  return { valid: true };
}

/**
 * Creates a confirmed booking and corresponding CalendarEventPlaintext.
 */
export function createBookingRecord(
  schedule: AppointmentSchedule,
  slotStartUtcStr: string,
  attendee: { name: string; email: string; notes?: string },
  hostEmail: string = "host@byos.local"
): { appointment: BookedAppointment; eventPayload: CalendarEventPlaintext } {
  const slotStartUtc = new Date(slotStartUtcStr);
  const durationMs = schedule.durationMinutes * 60 * 1000;
  const slotEndUtc = new Date(slotStartUtc.getTime() + durationMs);

  const appointmentId = `appt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const cancellationToken = `token-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const calendarEventId = `ev-appt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

  const appointment: BookedAppointment = {
    id: appointmentId,
    scheduleId: schedule.id,
    mailboxId: schedule.mailboxId,
    calendarEventId,
    startUtc: slotStartUtc.toISOString(),
    endUtc: slotEndUtc.toISOString(),
    attendeeName: attendee.name.trim(),
    attendeeEmail: attendee.email.trim().toLowerCase(),
    attendeeNotes: attendee.notes?.trim() || undefined,
    status: "confirmed",
    cancellationToken,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const eventPayload: CalendarEventPlaintext = {
    title: `${schedule.title}: ${attendee.name.trim()}`,
    description: `Booked via BYOS Appointment Scheduling.\n\nAttendee: ${attendee.name.trim()} (${attendee.email.trim()})\nNotes: ${attendee.notes || "None"}\nCancellation Token: ${cancellationToken}`,
    location: schedule.locationType === "custom" || schedule.locationType === "in_person" ? schedule.locationDetails : undefined,
    meetingUrl: schedule.locationType === "video" ? (schedule.locationDetails || "BYOS Secure Video") : undefined,
    startTime: slotStartUtc.toISOString(),
    endTime: slotEndUtc.toISOString(),
    isAllDay: false,
    color: "#9E725F",
    visibility: "default",
    organizer: { email: hostEmail, name: "Host" },
    attendees: [
      {
        email: attendee.email.trim().toLowerCase(),
        name: attendee.name.trim(),
        status: "accepted",
        isOrganizer: false,
      },
      {
        email: hostEmail,
        name: "Host",
        status: "accepted",
        isOrganizer: true,
      },
    ],
    reminders: [{ minutesBefore: 15, method: "notification" }],
    uid: calendarEventId,
  };

  return { appointment, eventPayload };
}

/**
 * Cancels a booked appointment using the cancellation token.
 */
export function cancelBookingRecord(
  appointment: BookedAppointment,
  cancellationToken: string,
  reason?: string
): { success: boolean; cancelledAppointment?: BookedAppointment; error?: string } {
  if (appointment.cancellationToken !== cancellationToken) {
    return { success: false, error: "Invalid cancellation token. Action unauthorized." };
  }

  if (appointment.status === "cancelled") {
    return { success: false, error: "Appointment is already cancelled." };
  }

  const cancelledAppointment: BookedAppointment = {
    ...appointment,
    status: "cancelled",
    cancellationReason: reason?.trim() || "Cancelled by participant",
    updatedAt: new Date().toISOString(),
  };

  return { success: true, cancelledAppointment };
}

/**
 * Reschedules an appointment to a new validated slot start.
 */
export function rescheduleBookingRecord(
  oldAppointment: BookedAppointment,
  cancellationToken: string,
  newSlotStartUtcStr: string,
  schedule: AppointmentSchedule,
  existingEvents: DecryptedEventRecord[],
  existingBookings: BookedAppointment[],
  settings: CalendarSettings,
  hostEmail: string = "host@byos.local"
): {
  success: boolean;
  oldAppointment?: BookedAppointment;
  newAppointment?: BookedAppointment;
  newEventPayload?: CalendarEventPlaintext;
  error?: string;
} {
  if (oldAppointment.cancellationToken !== cancellationToken) {
    return { success: false, error: "Invalid cancellation token. Action unauthorized." };
  }

  // Validate the new slot
  const validation = validateSlotAvailability(
    schedule,
    newSlotStartUtcStr,
    existingEvents,
    // Exclude the current appointment from conflict check
    existingBookings.filter((b) => b.id !== oldAppointment.id),
    settings
  );

  if (!validation.valid) {
    return { success: false, error: validation.error || "Requested reschedule slot is unavailable." };
  }

  // Cancel the previous appointment
  const cancelRes = cancelBookingRecord(oldAppointment, cancellationToken, "Rescheduled to a new time slot");
  if (!cancelRes.success || !cancelRes.cancelledAppointment) {
    return { success: false, error: cancelRes.error };
  }

  // Create new appointment referencing the previous one
  const { appointment: newAppointment, eventPayload } = createBookingRecord(
    schedule,
    newSlotStartUtcStr,
    {
      name: oldAppointment.attendeeName,
      email: oldAppointment.attendeeEmail,
      notes: oldAppointment.attendeeNotes,
    },
    hostEmail
  );

  newAppointment.rescheduledFromId = oldAppointment.id;

  return {
    success: true,
    oldAppointment: cancelRes.cancelledAppointment,
    newAppointment,
    newEventPayload: eventPayload,
  };
}
