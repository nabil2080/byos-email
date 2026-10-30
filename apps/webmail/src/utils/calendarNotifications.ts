import { DecryptedEventRecord } from "../components/calendar/CalendarSidebar";
import { CalendarUserSettings, CalendarOverrides } from "../components/calendar/settings/calendarSettingsStore";
import { CalendarReminder } from "../calendar_crypto";
import { TaskItem } from "../components/calendar/tasks/taskTypes";

export interface ActiveCalendarReminderAlert {
  alertId: string;
  eventId: string;
  baseEventId: string;
  title: string;
  location?: string;
  startTime: Date;
  endTime: Date;
  isAllDay: boolean;
  isPrivate: boolean;
  minutesBefore: number;
  triggerTime: Date;
  snoozeUntil?: Date;
  isDismissed: boolean;
  method: "notification" | "email";
}

export const SESSION_LEDGER_KEY = "byos_calendar_dispatched_alerts";

// Module-level persistent set surviving component unmount/remount
const globalDispatchedLedger = new Set<string>();

function getSessionStorage(): Storage | null {
  try {
    if (typeof window !== "undefined" && window.sessionStorage) {
      const storage = window.sessionStorage;
      storage.getItem("byos_probe");
      return storage;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Returns the persistent dispatched alert ledger, initialized from sessionStorage if available.
 */
export function getDispatchedLedger(): Set<string> {
  const storage = getSessionStorage();
  if (storage) {
    try {
      const raw = storage.getItem(SESSION_LEDGER_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          arr.forEach((id) => globalDispatchedLedger.add(id));
        }
      }
    } catch {
      // fallback
    }
  }
  return globalDispatchedLedger;
}

/**
 * Marks an alert as dispatched in both memory and sessionStorage so it will not pop up again
 * when switching between Mailbox and Calendar.
 */
export function markAlertDispatched(alertId: string) {
  globalDispatchedLedger.add(alertId);
  const storage = getSessionStorage();
  if (storage) {
    try {
      storage.setItem(
        SESSION_LEDGER_KEY,
        JSON.stringify(Array.from(globalDispatchedLedger))
      );
    } catch {
      // fallback
    }
  }
}

/**
 * Removes an alert from the persistent ledger (e.g. when snoozed).
 */
export function unmarkAlertDispatched(alertId: string) {
  globalDispatchedLedger.delete(alertId);
  const storage = getSessionStorage();
  if (storage) {
    try {
      storage.setItem(
        SESSION_LEDGER_KEY,
        JSON.stringify(Array.from(globalDispatchedLedger))
      );
    } catch {
      // fallback
    }
  }
}

/**
 * Clears the persistent dispatched alert ledger (e.g. for testing or logout).
 */
export function clearDispatchedLedger() {
  globalDispatchedLedger.clear();
  const storage = getSessionStorage();
  if (storage) {
    try {
      storage.removeItem(SESSION_LEDGER_KEY);
    } catch {
      // fallback
    }
  }
}

/**
 * Checks whether the current time falls inside quiet hours.
 * Handles overnight time ranges (e.g. 22:00 to 08:00).
 */
export function isQuietHours(
  now: Date,
  quietEnabled: boolean,
  startStr: string = "22:00",
  endStr: string = "08:00"
): boolean {
  if (!quietEnabled) return false;

  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const [startH, startM] = (startStr || "22:00").split(":").map(Number);
  const [endH, endM] = (endStr || "08:00").split(":").map(Number);

  const startMinutes = (isNaN(startH) ? 22 : startH) * 60 + (isNaN(startM) ? 0 : startM);
  const endMinutes = (isNaN(endH) ? 8 : endH) * 60 + (isNaN(endM) ? 0 : endM);

  if (startMinutes <= endMinutes) {
    // Normal range (e.g. 13:00 to 15:00)
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  } else {
    // Overnight range (e.g. 22:00 to 08:00)
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
}

/**
 * Resolves effective reminders for an event using three-tier precedence:
 * 1. Event-specific reminders (if set and non-empty)
 * 2. Calendar-level default override (if configured >= 0)
 * 3. Global user settings default reminder (if configured >= 0)
 */
export function resolveEventReminders(
  ev: DecryptedEventRecord,
  calOverrides: Record<string, CalendarOverrides> = {},
  globalSettings: CalendarUserSettings
): CalendarReminder[] {
  // 1. Event-level override (if reminders is an array, even empty, it overrides higher tiers)
  if (ev.details && ev.details.reminders !== undefined) {
    return ev.details.reminders;
  }

  // 2. Calendar-level override
  const calOverride = calOverrides[ev.calendarId];
  if (calOverride && calOverride.defaultReminderMinutes !== undefined && calOverride.defaultReminderMinutes >= 0) {
    return [{ minutesBefore: calOverride.defaultReminderMinutes, method: "notification" }];
  }

  // 3. Global default
  if (globalSettings.defaultReminderMinutes !== undefined && globalSettings.defaultReminderMinutes >= 0) {
    return [{ minutesBefore: globalSettings.defaultReminderMinutes, method: "notification" }];
  }

  return [];
}

/**
 * Calculates the exact trigger instant for a reminder.
 */
export function calculateReminderTriggerTime(
  eventStart: Date,
  minutesBefore: number,
  isAllDay: boolean,
  allDayReminderTime: string = "09:00"
): Date {
  if (isAllDay) {
    const trigger = new Date(eventStart);
    if (minutesBefore >= 1440) {
      const days = Math.floor(minutesBefore / 1440);
      trigger.setDate(trigger.getDate() - days);
    }
    const [hh, mm] = (allDayReminderTime || "09:00").split(":").map(Number);
    trigger.setHours(isNaN(hh) ? 9 : hh, isNaN(mm) ? 0 : mm, 0, 0);
    return trigger;
  }

  return new Date(eventStart.getTime() - minutesBefore * 60000);
}

/**
 * Evaluates upcoming events and triggers reminders if their trigger time has arrived.
 * Deduplicates using dispatchedLedger to prevent repeat alerts.
 * Respects quiet hours and sensitive privacy lock boundaries.
 */
export function evaluateUpcomingReminders(
  events: DecryptedEventRecord[],
  now: Date,
  settings: CalendarUserSettings,
  calendarOverrides: Record<string, CalendarOverrides> = {},
  dispatchedLedger: Set<string>,
  isMailboxLocked: boolean
): ActiveCalendarReminderAlert[] {
  // Quiet hours suppression
  if (isQuietHours(now, settings.quietHoursEnabled, settings.quietHoursStart, settings.quietHoursEnd)) {
    return [];
  }

  const triggeredAlerts: ActiveCalendarReminderAlert[] = [];

  for (const ev of events) {
    // Only consider events that have not yet ended
    if (ev.endTime.getTime() <= now.getTime()) continue;

    // Working location and focus status markers are not interactive alarm reminders
    if (ev.details?.eventType === "working_location") continue;

    const reminders = resolveEventReminders(ev, calendarOverrides, settings);

    for (const rem of reminders) {
      const triggerTime = calculateReminderTriggerTime(
        ev.startTime,
        rem.minutesBefore,
        ev.isAllDay,
        settings.allDayReminderTime
      );

      const baseId = ev.baseEventId || ev.id.split("_")[0];
      const recId = ev.recurrenceId || ev.startTime.toISOString();
      const alertId = `${baseId}_${recId}_${rem.minutesBefore}`;

      // Deduplication safeguard
      if (dispatchedLedger.has(alertId)) continue;

      // If an event started more than 15 minutes ago, mark as expired in ledger without spamming toasts
      if (now.getTime() > ev.startTime.getTime() + 15 * 60000) {
        dispatchedLedger.add(alertId);
        markAlertDispatched(alertId);
        continue;
      }

      // Trigger condition: current time is at or after trigger time, but before event ends
      if (now.getTime() >= triggerTime.getTime() && now.getTime() < ev.endTime.getTime()) {
        const isRestricted =
          isMailboxLocked ||
          ev.details.visibility === "private" ||
          ev.details.visibility === "confidential";

        const title = isMailboxLocked
          ? "Upcoming Event"
          : isRestricted
          ? "Busy: Upcoming Event"
          : ev.details.title || "Untitled Event";

        const location = isRestricted ? undefined : ev.details.location;

        triggeredAlerts.push({
          alertId,
          eventId: ev.id,
          baseEventId: baseId,
          title,
          location,
          startTime: ev.startTime,
          endTime: ev.endTime,
          isAllDay: ev.isAllDay,
          isPrivate: isRestricted,
          minutesBefore: rem.minutesBefore,
          triggerTime,
          isDismissed: false,
          method: rem.method || "notification",
        });

        // Record in ledger so it never fires again
        dispatchedLedger.add(alertId);
      }
    }
  }

  return triggeredAlerts;
}

/**
 * Snoozes an active reminder alert for a specified number of minutes.
 */
export function snoozeReminderAlert(
  alert: ActiveCalendarReminderAlert,
  snoozeMinutes: number,
  now: Date = new Date()
): ActiveCalendarReminderAlert {
  const snoozeUntil = new Date(now.getTime() + snoozeMinutes * 60000);
  return {
    ...alert,
    snoozeUntil,
    triggerTime: snoozeUntil,
    isDismissed: false,
  };
}

/**
 * Formats a relative countdown or elapsed string for a reminder.
 */
export function formatRelativeReminderTime(eventStart: Date, now: Date = new Date()): string {
  const diffMs = eventStart.getTime() - now.getTime();
  const diffMinutes = Math.round(diffMs / 60000);

  if (diffMinutes > 120) {
    const hours = Math.round(diffMinutes / 60);
    return `in ${hours} hours`;
  }
  if (diffMinutes > 1) {
    return `in ${diffMinutes} minutes`;
  }
  if (diffMinutes === 1) {
    return "in 1 minute";
  }
  if (diffMinutes >= 0) {
    return "starting now";
  }
  const pastMinutes = Math.abs(diffMinutes);
  return `started ${pastMinutes}m ago`;
}

/**
 * Evaluates reminders for uncompleted tasks with due dates/times.
 * Respects notifyOnTasks preference and quiet hours.
 */
export function evaluateUpcomingTaskReminders(
  tasks: TaskItem[],
  now: Date,
  settings: CalendarUserSettings,
  dispatchedLedger: Set<string>
): ActiveCalendarReminderAlert[] {
  if (!settings.notifyOnTasks) return [];
  if (isQuietHours(now, settings.quietHoursEnabled, settings.quietHoursStart, settings.quietHoursEnd)) {
    return [];
  }

  const alerts: ActiveCalendarReminderAlert[] = [];

  for (const task of tasks) {
    if (task.completed || !task.dueDate) continue;

    const [y, m, d] = task.dueDate.split("-").map(Number);
    let dueInstant: Date;
    if (task.dueTime) {
      const [hh, mm] = task.dueTime.split(":").map(Number);
      dueInstant = new Date(y, m - 1, d, hh, mm, 0);
    } else {
      const [hh, mm] = (settings.allDayReminderTime || "09:00").split(":").map(Number);
      dueInstant = new Date(y, m - 1, d, hh, mm, 0);
    }

    const reminderMinutes = task.reminders && task.reminders.length > 0 ? task.reminders : [0];

    for (const remMin of reminderMinutes) {
      const triggerTime = new Date(dueInstant.getTime() - remMin * 60000);
      const alertId = `task_${task.id}_${remMin}`;

      if (dispatchedLedger.has(alertId)) continue;

      if (now.getTime() >= triggerTime.getTime()) {
        alerts.push({
          alertId,
          eventId: task.id,
          baseEventId: task.id,
          title: `Task Due: ${task.title}`,
          location: undefined,
          startTime: dueInstant,
          endTime: new Date(dueInstant.getTime() + 15 * 60000),
          isAllDay: !task.dueTime,
          isPrivate: false,
          minutesBefore: remMin,
          triggerTime,
          isDismissed: false,
          method: "notification",
        });
        dispatchedLedger.add(alertId);
      }
    }
  }

  return alerts;
}
