/**
 * BYOS Calendar - Category 12: Appointment Scheduling and Booking Pages
 * Storage repository for schedules and booked appointments per mailbox.
 */

import {
  AppointmentSchedule,
  BookedAppointment,
  createDefaultAppointmentSchedule,
} from "./appointmentTypes";

const SCHEDULES_PREFIX = "byos_calendar_appointment_schedules_";
const BOOKINGS_PREFIX = "byos_calendar_booked_appointments_";

function getSchedulesKey(mailboxId: string): string {
  return `${SCHEDULES_PREFIX}${mailboxId}`;
}

function getBookingsKey(mailboxId: string): string {
  return `${BOOKINGS_PREFIX}${mailboxId}`;
}

export function dispatchAppointmentsUpdated() {
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    try {
      const EventCtor =
        (window as any).CustomEvent ||
        (window as any).Event ||
        (globalThis as any).CustomEvent ||
        (globalThis as any).Event;
      if (EventCtor) {
        window.dispatchEvent(new EventCtor("byos_appointments_updated"));
      }
    } catch (e) {
      // Ignore in non-browser environments
    }
  }
}

/**
 * Retrieves all appointment schedules for a mailbox.
 * Creates an initial default 30-min consultation schedule if none exists.
 */
export function getAppointmentSchedules(
  mailboxId: string,
  primaryTimeZone: string = "UTC",
  defaultCalendarId?: string
): AppointmentSchedule[] {
  if (!mailboxId) return [];

  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(getSchedulesKey(mailboxId)) : null;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (err) {
    console.warn("[appointmentStore] Error loading appointment schedules:", err);
  }

  // Seed default schedule in memory
  const defaultSched = createDefaultAppointmentSchedule(mailboxId, primaryTimeZone, defaultCalendarId);
  return [defaultSched];
}

/**
 * Saves (creates or updates) an appointment schedule.
 */
export function saveAppointmentSchedule(
  mailboxId: string,
  schedule: Partial<AppointmentSchedule> & { title: string }
): AppointmentSchedule {
  if (!mailboxId) throw new Error("Mailbox ID required to save appointment schedule");

  const existing = getAppointmentSchedules(mailboxId);
  const now = new Date().toISOString();

  let target: AppointmentSchedule;
  if (schedule.id) {
    const index = existing.findIndex((s) => s.id === schedule.id);
    if (index >= 0) {
      target = {
        ...existing[index],
        ...schedule,
        updatedAt: now,
      };
      existing[index] = target;
    } else {
      target = {
        ...createDefaultAppointmentSchedule(mailboxId),
        ...schedule,
        id: schedule.id,
        createdAt: now,
        updatedAt: now,
      };
      existing.push(target);
    }
  } else {
    target = {
      ...createDefaultAppointmentSchedule(mailboxId),
      ...schedule,
      id: `sched-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: now,
      updatedAt: now,
    };
    existing.push(target);
  }

  if (typeof window !== "undefined") {
    localStorage.setItem(getSchedulesKey(mailboxId), JSON.stringify(existing));
  }
  dispatchAppointmentsUpdated();
  return target;
}

/**
 * Deletes an appointment schedule.
 */
export function deleteAppointmentSchedule(mailboxId: string, scheduleId: string): boolean {
  if (!mailboxId || !scheduleId) return false;

  const existing = getAppointmentSchedules(mailboxId);
  const filtered = existing.filter((s) => s.id !== scheduleId);
  if (filtered.length === existing.length) return false;

  if (typeof window !== "undefined") {
    localStorage.setItem(getSchedulesKey(mailboxId), JSON.stringify(filtered));
  }
  dispatchAppointmentsUpdated();
  return true;
}

/**
 * Toggles an appointment schedule between active and paused states.
 */
export function toggleScheduleActive(mailboxId: string, scheduleId: string): boolean {
  if (!mailboxId || !scheduleId) return false;

  const existing = getAppointmentSchedules(mailboxId);
  const target = existing.find((s) => s.id === scheduleId);
  if (!target) return false;

  target.isActive = !target.isActive;
  target.updatedAt = new Date().toISOString();

  if (typeof window !== "undefined") {
    localStorage.setItem(getSchedulesKey(mailboxId), JSON.stringify(existing));
  }
  dispatchAppointmentsUpdated();
  return target.isActive;
}

/**
 * Retrieves all booked appointments for a mailbox, optionally filtered by schedule.
 */
export function getBookedAppointments(mailboxId: string, scheduleId?: string): BookedAppointment[] {
  if (!mailboxId) return [];

  try {
    const raw = typeof window !== "undefined" ? localStorage.getItem(getBookingsKey(mailboxId)) : null;
    if (raw) {
      const parsed: BookedAppointment[] = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        if (scheduleId) {
          return parsed.filter((b) => b.scheduleId === scheduleId);
        }
        return parsed;
      }
    }
  } catch (err) {
    console.warn("[appointmentStore] Error loading booked appointments:", err);
  }

  return [];
}

/**
 * Saves or updates a booked appointment.
 */
export function saveBookedAppointment(
  mailboxId: string,
  appointment: BookedAppointment
): BookedAppointment {
  if (!mailboxId) throw new Error("Mailbox ID required to save booked appointment");

  const existing = getBookedAppointments(mailboxId);
  const index = existing.findIndex((b) => b.id === appointment.id);

  if (index >= 0) {
    existing[index] = { ...appointment, updatedAt: new Date().toISOString() };
  } else {
    existing.push(appointment);
  }

  if (typeof window !== "undefined") {
    localStorage.setItem(getBookingsKey(mailboxId), JSON.stringify(existing));
  }
  dispatchAppointmentsUpdated();
  return appointment;
}

/**
 * Searches across local storage to resolve an appointment schedule by its slug.
 * Allows public or embedded booking pages to locate the schedule.
 */
export function findScheduleBySlug(
  slug: string
): { schedule: AppointmentSchedule; mailboxId: string } | null {
  if (!slug || typeof window === "undefined") return null;

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(SCHEDULES_PREFIX)) {
        const raw = localStorage.getItem(key);
        if (raw) {
          const schedules: AppointmentSchedule[] = JSON.parse(raw);
          const found = schedules.find((s) => s.slug === slug);
          if (found) {
            const mailboxId = key.replace(SCHEDULES_PREFIX, "");
            return { schedule: found, mailboxId };
          }
        }
      }
    }
  } catch (err) {
    console.warn("[appointmentStore] Error searching schedule by slug:", err);
  }

  return null;
}

/**
 * Resolves a booked appointment by its cancellation token across storage.
 */
export function findAppointmentByCancellationToken(
  token: string
): { appointment: BookedAppointment; schedule: AppointmentSchedule; mailboxId: string } | null {
  if (!token || typeof window === "undefined") return null;

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(BOOKINGS_PREFIX)) {
        const raw = localStorage.getItem(key);
        if (raw) {
          const bookings: BookedAppointment[] = JSON.parse(raw);
          const found = bookings.find((b) => b.cancellationToken === token);
          if (found) {
            const mailboxId = key.replace(BOOKINGS_PREFIX, "");
            const schedules = getAppointmentSchedules(mailboxId);
            const schedule = schedules.find((s) => s.id === found.scheduleId);
            if (schedule) {
              return { appointment: found, schedule, mailboxId };
            }
          }
        }
      }
    }
  } catch (err) {
    console.warn("[appointmentStore] Error searching appointment by token:", err);
  }

  return null;
}
