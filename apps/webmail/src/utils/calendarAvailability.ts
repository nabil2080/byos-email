import { DecryptedEventRecord } from "../components/calendar/CalendarSidebar.js";
import {
  CalendarSettings,
  WorkPeriod,
  WorkHoursDateException,
} from "../components/calendar/settings/calendarSettingsStore.js";
import { utcToZonedParts } from "./calendarTimezones.js";

export interface FreeBusyInterval {
  start: Date;
  end: Date;
  status: "free" | "busy" | "out_of_office" | "outside_working_hours";
}

export interface AvailabilityConflict {
  type: "busy" | "out_of_office" | "outside_working_hours";
  reason: string;
  conflictingEventId?: string;
  start: Date;
  end: Date;
}

export interface MeetingAvailabilityResult {
  available: boolean;
  conflicts: AvailabilityConflict[];
}

export interface AutoDeclineResult {
  shouldDecline: boolean;
  declineReason?: string;
}

/**
 * Evaluates whether a specific instant falls within the user's active working hours.
 * Interprets hours in the configured timezone.
 * Priority: Date-specific exceptions -> Working days & customized daily periods -> Global working hours start/end.
 */
export function isTimeInWorkingHours(
  date: Date,
  settings: CalendarSettings,
  timeZone?: string
): boolean {
  if (!settings.workingHoursEnabled) {
    return true; // No restrictions when working hours are disabled
  }

  const tz = timeZone || settings.primaryTimeZone || "UTC";
  const { dateStr, timeStr } = utcToZonedParts(date, tz);

  // Compute day of week in the target timezone
  const [y, m, d] = dateStr.split("-").map(Number);
  const dayOfWeek = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay();

  // 1. Date-specific exceptions take highest precedence
  if (settings.workingHoursExceptions && settings.workingHoursExceptions[dateStr]) {
    const exc = settings.workingHoursExceptions[dateStr];
    if (!exc.enabled) {
      return false; // Day off exception
    }
    if (exc.periods && exc.periods.length > 0) {
      return exc.periods.some((p) => isTimeWithinPeriod(timeStr, p.start, p.end));
    }
    return false;
  }

  // 2. Working days filter
  const workingDays = settings.workingDays || [1, 2, 3, 4, 5];
  if (!workingDays.includes(dayOfWeek)) {
    return false; // Weekend or scheduled non-working day
  }

  // 3. Multi-period custom day schedule
  if (
    settings.workingPeriodsByDay &&
    settings.workingPeriodsByDay[dayOfWeek] &&
    settings.workingPeriodsByDay[dayOfWeek].length > 0
  ) {
    const periods = settings.workingPeriodsByDay[dayOfWeek];
    return periods.some((p) => isTimeWithinPeriod(timeStr, p.start, p.end));
  }

  // 4. Default single start and end boundary
  const start = settings.workHoursStart || "09:00";
  const end = settings.workHoursEnd || "17:00";
  return isTimeWithinPeriod(timeStr, start, end);
}

/**
 * Helper to test if a time string "HH:mm" falls within [startStr, endStr)
 */
function isTimeWithinPeriod(current: string, start: string, end: string): boolean {
  if (start <= end) {
    return current >= start && current < end;
  } else {
    // Overnight working period (e.g. 21:00 to 05:00)
    return current >= start || current < end;
  }
}

/**
 * Resolves the effective working location for a date.
 * Priority: Daily override -> Date exception -> Default work location.
 */
export function getEffectiveDailyWorkLocation(
  date: Date,
  settings: CalendarSettings,
  timeZone?: string
): "office" | "home" | "remote" | "unspecified" | string {
  const tz = timeZone || settings.primaryTimeZone || "UTC";
  const { dateStr } = utcToZonedParts(date, tz);

  if (settings.dailyWorkLocations && settings.dailyWorkLocations[dateStr]) {
    return settings.dailyWorkLocations[dateStr];
  }

  if (
    settings.workingHoursExceptions &&
    settings.workingHoursExceptions[dateStr] &&
    settings.workingHoursExceptions[dateStr].location
  ) {
    return settings.workingHoursExceptions[dateStr].location!;
  }

  return settings.defaultWorkLocation || "office";
}

/**
 * Computes privacy-preserving free/busy availability intervals across a time window.
 * Strictly strips all sensitive metadata (titles, descriptions, locations, participants)
 * returning purely { start, end, status }.
 */
export function computeFreeBusyIntervals(
  events: DecryptedEventRecord[],
  windowStart: Date,
  windowEnd: Date,
  settings: CalendarSettings,
  timeZone?: string
): FreeBusyInterval[] {
  const rawIntervals: { start: Date; end: Date; status: "busy" | "out_of_office" }[] = [];

  for (const ev of events) {
    // Transparent / free events do not consume availability
    if (ev.status === "free") continue;

    // Check overlap with query window
    if (ev.endTime <= windowStart || ev.startTime >= windowEnd) continue;

    const clampedStart = ev.startTime < windowStart ? windowStart : ev.startTime;
    const clampedEnd = ev.endTime > windowEnd ? windowEnd : ev.endTime;

    const isOoo =
      ev.status === "out_of_office" ||
      ev.details?.eventType === "out_of_office";

    rawIntervals.push({
      start: clampedStart,
      end: clampedEnd,
      status: isOoo ? "out_of_office" : "busy",
    });
  }

  if (rawIntervals.length === 0) {
    return [{ start: windowStart, end: windowEnd, status: "free" }];
  }

  // Sort intervals by start time
  rawIntervals.sort((a, b) => a.start.getTime() - b.start.getTime());

  // Merge overlapping and contiguous intervals
  const merged: { start: Date; end: Date; status: "busy" | "out_of_office" }[] = [];
  for (const current of rawIntervals) {
    if (merged.length === 0) {
      merged.push({ ...current });
      continue;
    }

    const prev = merged[merged.length - 1];
    if (current.start.getTime() <= prev.end.getTime()) {
      // Overlap: extend end if later
      if (current.end.getTime() > prev.end.getTime()) {
        prev.end = current.end;
      }
      // Out of office takes precedence over generic busy
      if (current.status === "out_of_office") {
        prev.status = "out_of_office";
      }
    } else {
      merged.push({ ...current });
    }
  }

  // Fill in free intervals in between busy blocks
  const result: FreeBusyInterval[] = [];
  let cursor = windowStart;

  for (const busy of merged) {
    if (busy.start > cursor) {
      result.push({
        start: cursor,
        end: busy.start,
        status: "free",
      });
    }
    result.push({
      start: busy.start,
      end: busy.end,
      status: busy.status,
    });
    cursor = busy.end;
  }

  if (cursor < windowEnd) {
    result.push({
      start: cursor,
      end: windowEnd,
      status: "free",
    });
  }

  return result;
}

/**
 * Checks if a proposed event interval is available or has conflicts.
 * Evaluates: Out of Office blocks, overlapping busy events, and working hours boundaries.
 */
export function checkMeetingAvailability(
  proposedStart: Date,
  proposedEnd: Date,
  events: DecryptedEventRecord[],
  settings: CalendarSettings,
  timeZone?: string
): MeetingAvailabilityResult {
  const conflicts: AvailabilityConflict[] = [];

  // 1. Check working hours compliance
  if (settings.workingHoursEnabled) {
    const isStartInHours = isTimeInWorkingHours(proposedStart, settings, timeZone);
    const isEndInHours = isTimeInWorkingHours(
      new Date(proposedEnd.getTime() - 1000), // Check instant right before end
      settings,
      timeZone
    );

    if (!isStartInHours || !isEndInHours) {
      conflicts.push({
        type: "outside_working_hours",
        reason: "Proposed meeting extends outside configured working hours",
        start: proposedStart,
        end: proposedEnd,
      });
    }
  }

  // 2. Check event overlaps (OOO and busy)
  for (const ev of events) {
    if (ev.status === "free") continue;
    if (ev.endTime <= proposedStart || ev.startTime >= proposedEnd) continue;

    const isOoo =
      ev.status === "out_of_office" ||
      ev.details?.eventType === "out_of_office";

    if (isOoo) {
      conflicts.push({
        type: "out_of_office",
        reason: `Overlaps with Out of Office block: "${ev.details?.title || "Out of Office"}"`,
        conflictingEventId: ev.id,
        start: ev.startTime,
        end: ev.endTime,
      });
    } else {
      conflicts.push({
        type: "busy",
        reason: `Overlaps with existing busy meeting: "${ev.details?.title || "Busy"}"`,
        conflictingEventId: ev.id,
        start: ev.startTime,
        end: ev.endTime,
      });
    }
  }

  return {
    available: conflicts.length === 0,
    conflicts,
  };
}

/**
 * Evaluates if an incoming invitation or proposed meeting should be automatically declined.
 * Conditions:
 * 1. Overlaps with an active OOO block with autoDeclineMode enabled.
 * 2. Settings autoDeclineOutOfOffice is enabled and meeting is scheduled outside working hours.
 */
export function evaluateAutoDeclineForInvitation(
  incomingStart: Date,
  incomingEnd: Date,
  events: DecryptedEventRecord[],
  settings: CalendarSettings,
  timeZone?: string
): AutoDeclineResult {
  // Check for Out of Office auto-decline
  for (const ev of events) {
    if (ev.endTime <= incomingStart || ev.startTime >= incomingEnd) continue;

    const isOoo =
      ev.status === "out_of_office" ||
      ev.details?.eventType === "out_of_office";

    if (isOoo) {
      const mode = ev.details?.autoDeclineMode || "new_invitations";
      if (mode !== "none") {
        const declineMsg =
          ev.details?.autoDeclineMessage ||
          settings.autoDeclineMessage ||
          "I am currently out of the office and unable to attend.";
        return {
          shouldDecline: true,
          declineReason: declineMsg,
        };
      }
    }
  }

  // Check global auto-decline outside working hours
  if (settings.workingHoursEnabled && settings.autoDeclineOutOfOffice) {
    const isStartInHours = isTimeInWorkingHours(incomingStart, settings, timeZone);
    const isEndInHours = isTimeInWorkingHours(
      new Date(incomingEnd.getTime() - 1000),
      settings,
      timeZone
    );

    if (!isStartInHours || !isEndInHours) {
      return {
        shouldDecline: true,
        declineReason: "Invitation automatically declined: outside configured working hours.",
      };
    }
  }

  return { shouldDecline: false };
}
