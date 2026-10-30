/**
 * BYOS Calendar - Category 12: Appointment Scheduling and Booking Pages
 * Data types, interfaces, and default factories.
 */

export type AppointmentLocationType = "video" | "phone" | "in_person" | "custom";

export type AppointmentAvailabilityMode = "working_hours" | "custom";

export interface CustomWeeklyWindow {
  dayOfWeek: number; // 0=Sunday, 1=Monday, ..., 6=Saturday
  startTime: string; // HH:mm
  endTime: string;   // HH:mm
}

export interface DateAvailabilityOverride {
  date: string; // YYYY-MM-DD
  isUnavailable: boolean;
  windows?: { startTime: string; endTime: string }[];
}

export interface AppointmentSchedule {
  id: string;
  mailboxId: string;
  slug: string;
  title: string;
  description?: string;
  durationMinutes: number; // e.g. 15, 30, 45, 60
  locationType: AppointmentLocationType;
  locationDetails?: string;
  isPublic: boolean;
  accessToken?: string; // Secret token required for private booking links
  isActive: boolean;    // Can be paused or revoked by the user
  targetCalendarId?: string; // Calendar where confirmed events are inserted
  inspectedCalendarIds: string[]; // Calendars checked for conflict detection
  availabilityMode: AppointmentAvailabilityMode;
  customWeeklyWindows?: CustomWeeklyWindow[];
  minNoticeHours: number; // e.g. at least 2 hours or 24 hours notice
  maxAdvanceDays: number; // e.g. up to 14, 30, 60 days in advance
  bufferBeforeMinutes: number; // e.g. 5, 10, 15 minutes before
  bufferAfterMinutes: number;  // e.g. 5, 10, 15 minutes after
  maxDailyAppointments?: number; // e.g. max 3 or 4 bookings per day
  dateOverrides?: DateAvailabilityOverride[];
  timeZone: string;
  createdAt: string;
  updatedAt: string;
}

export interface BookedAppointment {
  id: string;
  scheduleId: string;
  mailboxId: string;
  calendarEventId: string;
  startUtc: string; // ISO 8601 UTC
  endUtc: string;   // ISO 8601 UTC
  attendeeName: string;
  attendeeEmail: string;
  attendeeNotes?: string;
  status: "confirmed" | "cancelled" | "rescheduled";
  cancellationReason?: string;
  cancellationToken: string;
  rescheduledFromId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AvailableSlot {
  startUtc: string;
  endUtc: string;
  dateStr: string;   // YYYY-MM-DD in target display timezone
  timeStr: string;   // HH:mm in target display timezone
  formattedRange: string; // e.g. "10:00 - 10:30"
}

export interface PublicScheduleView {
  id: string;
  slug: string;
  title: string;
  description?: string;
  durationMinutes: number;
  locationType: AppointmentLocationType;
  locationDetails?: string;
  isPublic: boolean;
  isActive: boolean;
  timeZone: string;
}

/**
 * Strips internal host metadata (mailbox ID, target calendar, access tokens)
 * ensuring public booking pages disclose strictly minimum required information.
 */
export function sanitizeScheduleForPublic(schedule: AppointmentSchedule): PublicScheduleView {
  return {
    id: schedule.id,
    slug: schedule.slug,
    title: schedule.title,
    description: schedule.description,
    durationMinutes: schedule.durationMinutes,
    locationType: schedule.locationType,
    locationDetails: schedule.locationDetails,
    isPublic: schedule.isPublic,
    isActive: schedule.isActive,
    timeZone: schedule.timeZone,
  };
}

/**
 * Creates a default appointment schedule with secure, fail-closed defaults.
 */
export function createDefaultAppointmentSchedule(
  mailboxId: string,
  primaryTimeZone: string = "UTC",
  targetCalendarId?: string
): AppointmentSchedule {
  const id = `sched-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  return {
    id,
    mailboxId,
    slug: `meeting-${id.slice(-6)}`,
    title: "30-Minute Consultation",
    description: "One-on-one discussion and technical sync.",
    durationMinutes: 30,
    locationType: "video",
    locationDetails: "BYOS Secure Video Link",
    isPublic: true,
    isActive: true,
    targetCalendarId,
    inspectedCalendarIds: targetCalendarId ? [targetCalendarId] : [],
    availabilityMode: "working_hours",
    customWeeklyWindows: [
      { dayOfWeek: 1, startTime: "09:00", endTime: "17:00" },
      { dayOfWeek: 2, startTime: "09:00", endTime: "17:00" },
      { dayOfWeek: 3, startTime: "09:00", endTime: "17:00" },
      { dayOfWeek: 4, startTime: "09:00", endTime: "17:00" },
      { dayOfWeek: 5, startTime: "09:00", endTime: "17:00" },
    ],
    minNoticeHours: 2,
    maxAdvanceDays: 14,
    bufferBeforeMinutes: 5,
    bufferAfterMinutes: 5,
    maxDailyAppointments: 6,
    timeZone: primaryTimeZone,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}
