import { createSignal, createMemo, onMount, onCleanup } from "solid-js";
import { updateMailboxSettings } from "../../../api";
import { AlternateCalendarSystem } from "../../../utils/alternateCalendar";

export interface WorldClockCity {
  id: string;
  label: string;
  timeZone: string;
}

export interface WorkPeriod {
  start: string; // "09:00"
  end: string;   // "17:00"
}

export interface WorkHoursDateException {
  date: string; // "YYYY-MM-DD"
  enabled: boolean;
  periods: WorkPeriod[];
  location?: "office" | "home" | "remote" | string;
}

export interface CalendarSettings {
  // ── 1. General ──
  language: string;
  countryPreference: string;
  dateFormat: "YYYY-MM-DD" | "MM/DD/YYYY" | "DD/MM/YYYY";
  timeFormat: "12h" | "24h";
  weekStart: "sunday" | "monday" | "saturday";
  firstWeekOfYear: "four_day_week" | "first_day" | "full_week";
  defaultCalendarId: string;

  // ── 2. Event settings ──
  defaultDuration: number;
  defaultEventVisibility: "default" | "public" | "private" | "confidential";
  guestsCanModify: boolean;
  guestsCanInviteOthers: boolean;
  guestsCanSeeGuestList: boolean;
  autoAddMeetingLink: boolean;

  // ── 3. Notification settings ──
  defaultReminderMinutes: number;
  notifyOnInvitations: boolean;
  notifyOnRsvp: boolean;
  notifyOnTasks: boolean;
  desktopNotificationsEnabled: boolean;
  allDayReminderTime: string;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  snoozeDefaultMinutes: number;

  // ── 4. View options ──
  defaultView: "day" | "week" | "month" | "year" | "agenda";
  showWeekends: boolean;
  showWeekNumbers: boolean;
  density: "compact" | "cozy" | "comfortable";
  showDeclinedEvents: boolean;
  alternateCalendar: AlternateCalendarSystem;
  showTasksInCalendar: boolean;

  // ── 5. Time zones and world clock ──
  primaryTimeZone: string;
  showSecondaryTimeZone: boolean;
  secondaryTimeZone: string;
  secondaryTimeZoneLabel: string;
  autoUpdateTimeZoneWithConsent: boolean;
  showWorldClock: boolean;
  worldClockCities: WorldClockCity[];

  // ── 6. Working hours and location ──
  workingHoursEnabled: boolean;
  workingDays: number[]; // 0=Sunday, 1=Monday, ..., 6=Saturday
  workHoursStart: string; // "09:00"
  workHoursEnd: string; // "17:00"
  workingPeriodsByDay?: Record<number, WorkPeriod[]>;
  workingHoursExceptions?: Record<string, WorkHoursDateException>;
  defaultWorkLocation: "office" | "home" | "remote" | "unspecified";
  dailyWorkLocations?: Record<string, "office" | "home" | "remote" | string>;
  autoDeclineOutOfOffice: boolean;
  autoDeclineMessage?: string;

  // ── 7. Privacy and sharing ──
  defaultEventPrivacy: "normal" | "private" | "confidential";
  freeBusyVisibility: "public" | "internal_only" | "private";
  defaultSharePermission: "free_busy_only" | "read" | "write" | "admin";

  // ── 8. Integrations ──
  mailEventSuggestions: boolean;
  showBirthdaysFromContacts: boolean;
  mailCategoryFlights: boolean;
  mailCategoryHotels: boolean;
  mailCategoryRestaurants: boolean;
  mailCategoryTickets: boolean;
  mailCategoryEvents: boolean;
  videoConferenceProvider: "none" | "byos_room" | "jitsi" | "custom";
  customVideoUrlTemplate: string;

  // ── 9. Keyboard shortcuts and accessibility ──
  keyboardShortcutsEnabled: boolean;
  highContrastCalendar: boolean;
  reducedMotion: boolean;
  screenReaderOptimized: boolean;

  // ── 10. Offline and synchronization ──
  offlineStorageEnabled: boolean;
  cacheRetentionDays: number;
}

export type CalendarUserSettings = CalendarSettings;

export const DEFAULT_CALENDAR_SETTINGS: CalendarSettings = {
  // 1. General
  language: "en",
  countryPreference: "US",
  dateFormat: "YYYY-MM-DD",
  timeFormat: "12h",
  weekStart: "sunday",
  firstWeekOfYear: "four_day_week",
  defaultCalendarId: "auto",

  // 2. Event settings
  defaultDuration: 30,
  defaultEventVisibility: "default",
  guestsCanModify: false,
  guestsCanInviteOthers: true,
  guestsCanSeeGuestList: true,
  autoAddMeetingLink: false,

  // 3. Notification settings
  defaultReminderMinutes: 10,
  notifyOnInvitations: true,
  notifyOnRsvp: true,
  notifyOnTasks: true,
  desktopNotificationsEnabled: false,
  allDayReminderTime: "09:00",
  quietHoursEnabled: false,
  quietHoursStart: "22:00",
  quietHoursEnd: "08:00",
  snoozeDefaultMinutes: 10,

  // 4. View options
  defaultView: "week",
  showWeekends: true,
  showWeekNumbers: false,
  density: "cozy",
  showDeclinedEvents: false,
  alternateCalendar: "none",
  showTasksInCalendar: true,

  // 5. Time zones and world clock
  primaryTimeZone: "UTC",
  showSecondaryTimeZone: false,
  secondaryTimeZone: "America/New_York",
  secondaryTimeZoneLabel: "NYC",
  autoUpdateTimeZoneWithConsent: true,
  showWorldClock: true,
  worldClockCities: [
    { id: "c1", label: "London", timeZone: "Europe/London" },
    { id: "c2", label: "New York", timeZone: "America/New_York" },
    { id: "c3", label: "Tokyo", timeZone: "Asia/Tokyo" },
  ],

  // 6. Working hours and location
  workingHoursEnabled: false,
  workingDays: [1, 2, 3, 4, 5], // Monday - Friday
  workHoursStart: "09:00",
  workHoursEnd: "17:00",
  workingPeriodsByDay: {
    1: [{ start: "09:00", end: "17:00" }],
    2: [{ start: "09:00", end: "17:00" }],
    3: [{ start: "09:00", end: "17:00" }],
    4: [{ start: "09:00", end: "17:00" }],
    5: [{ start: "09:00", end: "17:00" }],
  },
  workingHoursExceptions: {},
  defaultWorkLocation: "office",
  dailyWorkLocations: {},
  autoDeclineOutOfOffice: false,
  autoDeclineMessage: "I am currently out of the office and unable to attend.",

  // 7. Privacy and sharing
  defaultEventPrivacy: "normal",
  freeBusyVisibility: "public",
  defaultSharePermission: "read",

  // 8. Integrations
  mailEventSuggestions: true,
  showBirthdaysFromContacts: true,
  mailCategoryFlights: true,
  mailCategoryHotels: true,
  mailCategoryRestaurants: true,
  mailCategoryTickets: true,
  mailCategoryEvents: true,
  videoConferenceProvider: "byos_room",
  customVideoUrlTemplate: "https://meet.jit.si/byos-{roomId}",

  // 9. Keyboard shortcuts and accessibility
  keyboardShortcutsEnabled: true,
  highContrastCalendar: false,
  reducedMotion: false,
  screenReaderOptimized: false,

  // 10. Offline and synchronization
  offlineStorageEnabled: true,
  cacheRetentionDays: 30,
};

// ── Calendar-Level Overrides (Section 4.3) ──
export interface CalendarOverrides {
  calendarId: string;
  defaultReminderMinutes?: number;
  defaultEventVisibility?: "default" | "public" | "private" | "confidential";
  showInView?: boolean;
  colorOverride?: string;
  description?: string;
  template?: string;
}

// ── Event-Level Overrides (Section 4.3) ──
export interface EventOverrides {
  timeZone?: string;
  reminderMinutes?: number[];
  visibility?: "default" | "public" | "private" | "confidential";
}

function getStorageKey(mailboxId?: string): string {
  return mailboxId ? `byos_calendar_settings_${mailboxId}` : "byos_calendar_settings_global";
}

function getOverridesStorageKey(mailboxId: string, calendarId: string): string {
  return `byos_calendar_overrides_${mailboxId}_${calendarId}`;
}

/**
 * Load global calendar settings for a mailbox, merging with defaults
 */
export function loadCalendarSettings(mailboxId?: string): CalendarSettings {
  if (typeof window === "undefined") {
    return { ...DEFAULT_CALENDAR_SETTINGS };
  }

  try {
    const key = getStorageKey(mailboxId);
    const raw = localStorage.getItem(key);
    if (!raw) {
      return { ...DEFAULT_CALENDAR_SETTINGS };
    }
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_CALENDAR_SETTINGS,
      ...parsed,
    };
  } catch (err) {
    console.warn("[calendarSettingsStore] Failed to parse calendar settings from localStorage:", err);
    return { ...DEFAULT_CALENDAR_SETTINGS };
  }
}

/**
 * Save calendar settings to local storage and sync relevant server settings
 */
export async function saveCalendarSettings(
  settings: CalendarSettings,
  mailboxId?: string
): Promise<{ success: boolean; error?: string }> {
  if (typeof window === "undefined") {
    return { success: true };
  }

  try {
    const key = getStorageKey(mailboxId);
    localStorage.setItem(key, JSON.stringify(settings));

    // Dispatch a window event so all calendar components synchronize instantly
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
      try {
        const EventCtor = (window as any).CustomEvent || (globalThis as any).CustomEvent;
        if (EventCtor) {
          window.dispatchEvent(
            new EventCtor("byos_calendar_settings_updated", {
              detail: { mailboxId, settings },
            })
          );
        }
      } catch {
        // Suppress dispatch failures in non-standard test runners
      }
    }

    // Sync backend-supported fields (language, time_format, week_start) if authenticated
    if (
      mailboxId &&
      typeof window !== "undefined" &&
      typeof sessionStorage !== "undefined" &&
      sessionStorage.getItem("byos_session_token")
    ) {
      try {
        await updateMailboxSettings(mailboxId, {
          language: settings.language,
          time_format: settings.timeFormat,
          week_start: settings.weekStart,
        });
      } catch (apiErr: any) {
        console.warn("[calendarSettingsStore] API sync failed (localStorage preserved):", apiErr);
        return {
          success: false,
          error: apiErr?.message || "Settings saved locally, but server synchronization failed.",
        };
      }
    }

    return { success: true };
  } catch (err: any) {
    console.error("[calendarSettingsStore] Failed to save calendar settings:", err);
    return {
      success: false,
      error: err?.message || "Failed to persist calendar settings.",
    };
  }
}

/**
 * Load per-calendar overrides
 */
export function loadCalendarOverrides(mailboxId: string, calendarId: string): CalendarOverrides {
  if (typeof window === "undefined") {
    return { calendarId };
  }
  try {
    const key = getOverridesStorageKey(mailboxId, calendarId);
    const raw = localStorage.getItem(key);
    if (!raw) return { calendarId };
    return { calendarId, ...JSON.parse(raw) };
  } catch {
    return { calendarId };
  }
}

/**
 * Save per-calendar overrides
 */
export function saveCalendarOverrides(
  mailboxId: string,
  calendarId: string,
  overrides: Partial<CalendarOverrides>
): void {
  if (typeof window === "undefined") return;
  try {
    const current = loadCalendarOverrides(mailboxId, calendarId);
    const updated = { ...current, ...overrides, calendarId };
    localStorage.setItem(getOverridesStorageKey(mailboxId, calendarId), JSON.stringify(updated));
    if (typeof window.dispatchEvent === "function") {
      try {
        const EventCtor = (window as any).CustomEvent || (globalThis as any).CustomEvent;
        if (EventCtor) {
          window.dispatchEvent(
            new EventCtor("byos_calendar_overrides_updated", {
              detail: { mailboxId, calendarId, overrides: updated },
            })
          );
        }
      } catch {}
    }
  } catch (err) {
    console.warn("[calendarSettingsStore] Failed to save calendar overrides:", err);
  }
}

/**
 * Resolves effective reminder minutes based on three-tier precedence:
 * Event override -> Calendar override -> Global default
 */
export function resolveEffectiveReminder(
  globalDefault: number,
  calendarOverride?: number,
  eventOverride?: number[]
): number[] {
  if (eventOverride && eventOverride.length > 0) {
    return eventOverride;
  }
  if (typeof calendarOverride === "number" && calendarOverride >= 0) {
    return [calendarOverride];
  }
  return [globalDefault];
}

export type SaveStatus = "saved" | "saving" | "error";

/**
 * SolidJS reactive hook for managing calendar settings
 */
export function createCalendarSettings(getMailboxId?: () => string | undefined) {
  const [settings, setSettings] = createSignal<CalendarSettings>(
    loadCalendarSettings(getMailboxId ? getMailboxId() : undefined)
  );
  const [saveStatus, setSaveStatus] = createSignal<SaveStatus>("saved");
  const [saveError, setSaveError] = createSignal<string | null>(null);

  // Sync when mailbox changes
  let currentMailboxId = getMailboxId ? getMailboxId() : undefined;
  function reloadFromStorage() {
    const mId = getMailboxId ? getMailboxId() : undefined;
    setSettings(loadCalendarSettings(mId));
  }

  onMount(() => {
    if (typeof window === "undefined") return;

    const handleExternalUpdate = (e: any) => {
      const detail = e.detail;
      const mId = getMailboxId ? getMailboxId() : undefined;
      if (!detail || detail.mailboxId === mId) {
        if (detail?.settings) {
          setSettings(detail.settings);
        } else {
          reloadFromStorage();
        }
      }
    };

    window.addEventListener("byos_calendar_settings_updated", handleExternalUpdate);
    onCleanup(() => {
      window.removeEventListener("byos_calendar_settings_updated", handleExternalUpdate);
    });
  });

  let saveTimer: any = null;

  async function persistChanges(newSettings: CalendarSettings) {
    setSaveStatus("saving");
    setSaveError(null);

    const mId = getMailboxId ? getMailboxId() : undefined;
    const res = await saveCalendarSettings(newSettings, mId);
    if (res.success) {
      setSaveStatus("saved");
      setSaveError(null);
    } else {
      setSaveStatus("error");
      setSaveError(res.error || "Save failed");
    }
  }

  function updateSetting<K extends keyof CalendarSettings>(key: K, value: CalendarSettings[K]) {
    const updated = { ...settings(), [key]: value };
    setSettings(updated);

    // Debounced autosave
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      persistChanges(updated);
    }, 250);
  }

  async function resetToDefaults() {
    const reset = { ...DEFAULT_CALENDAR_SETTINGS };
    setSettings(reset);
    await persistChanges(reset);
  }

  async function retrySave() {
    await persistChanges(settings());
  }

  return {
    settings,
    updateSetting,
    resetToDefaults,
    saveStatus,
    saveError,
    retrySave,
    reloadFromStorage,
  };
}
