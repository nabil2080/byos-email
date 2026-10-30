/**
 * Calendar Settings Registry & Metadata
 * 
 * Declares the 10 sections specified in BYOS_Calendar_Roadmap.md Section 4.1:
 *  1. General
 *  2. Event settings
 *  3. Notification settings
 *  4. View options
 *  5. Time zones and world clock
 *  6. Working hours and location
 *  7. Privacy and sharing
 *  8. Integrations
 *  9. Keyboard shortcuts and accessibility
 *  10. Offline and synchronization
 * 
 * Supports 3 levels of configuration (Section 4.3):
 *  - global: applies across all user calendars
 *  - calendar: per-calendar setting
 *  - event: per-event override
 */

export type CalendarSettingScope = "global" | "calendar" | "event";

export type CalendarSettingSectionId =
  | "general"
  | "event_defaults"
  | "notifications"
  | "view_options"
  | "timezones"
  | "working_hours"
  | "privacy_sharing"
  | "integrations"
  | "shortcuts_a11y"
  | "offline_sync";

export interface CalendarSettingSection {
  id: CalendarSettingSectionId;
  title: string;
  description: string;
  iconName: string;
}

export interface CalendarSettingOption {
  label: string;
  value: string | number | boolean;
  description?: string;
}

export interface CalendarSettingDefinition {
  id: string;
  sectionId: CalendarSettingSectionId;
  label: string;
  description: string;
  scope: CalendarSettingScope;
  type: "toggle" | "select" | "text" | "number" | "time" | "multiselect_days" | "info";
  options?: CalendarSettingOption[];
  keywords: string[];
}

export const CALENDAR_SETTING_SECTIONS: CalendarSettingSection[] = [
  {
    id: "general",
    title: "General",
    description: "Language, region, date & time formats, week start, and default calendar behavior",
    iconName: "globe",
  },
  {
    id: "event_defaults",
    title: "Event settings",
    description: "Default duration, visibility, and guest collaboration permissions",
    iconName: "clock",
  },
  {
    id: "notifications",
    title: "Notification settings",
    description: "Event reminders, invitation responses, task alerts, and browser notifications",
    iconName: "bell",
  },
  {
    id: "view_options",
    title: "View options",
    description: "Default view, weekends, week numbers, density, and declined events",
    iconName: "calendar",
  },
  {
    id: "timezones",
    title: "Time zones & world clock",
    description: "Primary time zone, secondary time zone, location consent, and world clock",
    iconName: "compass",
  },
  {
    id: "working_hours",
    title: "Working hours & location",
    description: "Working days, hours, location defaults, and out-of-office handling",
    iconName: "briefcase",
  },
  {
    id: "privacy_sharing",
    title: "Privacy & sharing",
    description: "Default event privacy, free/busy visibility, and calendar sharing rules",
    iconName: "shield",
  },
  {
    id: "integrations",
    title: "Integrations",
    description: "BYOS Mail intelligence, contacts, birthdays, and external sync",
    iconName: "layers",
  },
  {
    id: "shortcuts_a11y",
    title: "Keyboard & accessibility",
    description: "Keyboard shortcuts, high contrast, reduced motion, and assistive technology",
    iconName: "command",
  },
  {
    id: "offline_sync",
    title: "Offline & synchronization",
    description: "Offline encrypted storage, cache retention, and CalDAV protocol endpoint",
    iconName: "cloud",
  },
];

export const CALENDAR_SETTINGS_REGISTRY: CalendarSettingDefinition[] = [
  // ── 1. General ──
  {
    id: "language",
    sectionId: "general",
    label: "Language",
    description: "Display language for calendar headers, day names, and relative dates.",
    scope: "global",
    type: "select",
    options: [
      { label: "English (US)", value: "en" },
      { label: "Français", value: "fr" },
      { label: "Deutsch", value: "de" },
      { label: "Español", value: "es" },
      { label: "日本語", value: "ja" },
      { label: "中文", value: "zh" },
    ],
    keywords: ["language", "locale", "english", "french", "german", "spanish"],
  },
  {
    id: "countryPreference",
    sectionId: "general",
    label: "Country / region",
    description: "Your primary regional context for holidays and local formatting conventions.",
    scope: "global",
    type: "select",
    options: [
      { label: "United States (US)", value: "US" },
      { label: "United Kingdom (GB)", value: "GB" },
      { label: "Bangladesh (BD)", value: "BD" },
      { label: "Canada (CA)", value: "CA" },
      { label: "Australia (AU)", value: "AU" },
      { label: "Germany (DE)", value: "DE" },
      { label: "France (FR)", value: "FR" },
      { label: "Japan (JP)", value: "JP" },
      { label: "India (IN)", value: "IN" },
    ],
    keywords: ["country", "region", "locale", "bangladesh", "united states"],
  },
  {
    id: "dateFormat",
    sectionId: "general",
    label: "Date format",
    description: "Format used to display dates across views and event dialogs.",
    scope: "global",
    type: "select",
    options: [
      { label: "YYYY-MM-DD (ISO 8601)", value: "YYYY-MM-DD" },
      { label: "MM/DD/YYYY (US Standard)", value: "MM/DD/YYYY" },
      { label: "DD/MM/YYYY (UK / EU Standard)", value: "DD/MM/YYYY" },
    ],
    keywords: ["date format", "iso", "year", "month", "day"],
  },
  {
    id: "timeFormat",
    sectionId: "general",
    label: "Time format",
    description: "Display hours in 12-hour AM/PM or 24-hour military notation.",
    scope: "global",
    type: "select",
    options: [
      { label: "12-hour (e.g. 1:00 PM)", value: "12h" },
      { label: "24-hour (e.g. 13:00)", value: "24h" },
    ],
    keywords: ["time format", "12h", "24h", "am", "pm", "hours"],
  },
  {
    id: "weekStart",
    sectionId: "general",
    label: "Start of week",
    description: "First day of the week shown in month, week, and mini-calendar views.",
    scope: "global",
    type: "select",
    options: [
      { label: "Sunday", value: "sunday" },
      { label: "Monday", value: "monday" },
      { label: "Saturday", value: "saturday" },
    ],
    keywords: ["week start", "first day", "sunday", "monday", "saturday"],
  },
  {
    id: "firstWeekOfYear",
    sectionId: "general",
    label: "First week of year",
    description: "Convention used to calculate week numbers (e.g. ISO 8601 vs first day).",
    scope: "global",
    type: "select",
    options: [
      { label: "First 4-day week (ISO 8601 Standard)", value: "four_day_week" },
      { label: "Starts on Jan 1 (US / Google Standard)", value: "first_day" },
      { label: "First full 7-day week", value: "full_week" },
    ],
    keywords: ["first week", "week number", "iso 8601", "week of year"],
  },
  {
    id: "defaultCalendarId",
    sectionId: "general",
    label: "Default calendar for new events",
    description: "Calendar preselected when creating an event from any view.",
    scope: "global",
    type: "select",
    options: [
      { label: "Automatic (Primary calendar)", value: "auto" },
    ],
    keywords: ["default calendar", "target", "primary calendar"],
  },

  // ── 2. Event settings ──
  {
    id: "defaultDuration",
    sectionId: "event_defaults",
    label: "Default event duration",
    description: "Predefined duration when clicking empty time slots to create events.",
    scope: "global",
    type: "select",
    options: [
      { label: "15 minutes", value: 15 },
      { label: "30 minutes", value: 30 },
      { label: "45 minutes", value: 45 },
      { label: "60 minutes (1 hour)", value: 60 },
      { label: "90 minutes (1.5 hours)", value: 90 },
      { label: "120 minutes (2 hours)", value: 120 },
    ],
    keywords: ["duration", "length", "default event length", "meeting time"],
  },
  {
    id: "defaultEventVisibility",
    sectionId: "event_defaults",
    label: "Default event visibility",
    description: "Visibility assigned to events when created.",
    scope: "global",
    type: "select",
    options: [
      { label: "Calendar default (Inherit)", value: "default" },
      { label: "Public (Visible to shared users)", value: "public" },
      { label: "Private (Details hidden, shows as busy)", value: "private" },
      { label: "Confidential (Encrypted, zero metadata)", value: "confidential" },
    ],
    keywords: ["visibility", "privacy", "public", "private", "confidential"],
  },
  {
    id: "guestsCanModify",
    sectionId: "event_defaults",
    label: "Guests can modify events",
    description: "Allow invited attendees to edit title, time, and details.",
    scope: "event",
    type: "toggle",
    keywords: ["guest permissions", "modify", "edit event", "attendee"],
  },
  {
    id: "guestsCanInviteOthers",
    sectionId: "event_defaults",
    label: "Guests can invite others",
    description: "Allow attendees to add more participants to the invitation list.",
    scope: "event",
    type: "toggle",
    keywords: ["guest permissions", "invite", "add attendees"],
  },
  {
    id: "guestsCanSeeGuestList",
    sectionId: "event_defaults",
    label: "Guests can see guest list",
    description: "Show attendee names and RSVP statuses to other invited guests.",
    scope: "event",
    type: "toggle",
    keywords: ["guest list", "attendees", "see guests"],
  },
  {
    id: "autoAddMeetingLink",
    sectionId: "event_defaults",
    label: "Automatically add meeting video room",
    description: "Generate a secure BYOS end-to-end encrypted meeting link for new events.",
    scope: "global",
    type: "toggle",
    keywords: ["video call", "meeting link", "conference"],
  },

  // ── 3. Notification settings ──
  {
    id: "defaultReminderMinutes",
    sectionId: "notifications",
    label: "Default event reminder",
    description: "When to alert you before an event begins.",
    scope: "calendar",
    type: "select",
    options: [
      { label: "No reminder", value: 0 },
      { label: "5 minutes before", value: 5 },
      { label: "10 minutes before", value: 10 },
      { label: "15 minutes before", value: 15 },
      { label: "30 minutes before", value: 30 },
      { label: "1 hour before", value: 60 },
      { label: "1 day before", value: 1440 },
    ],
    keywords: ["reminder", "notification", "alert", "alarm", "before event"],
  },
  {
    id: "notifyOnInvitations",
    sectionId: "notifications",
    label: "Invitation notifications",
    description: "Receive notifications when someone invites you to an event.",
    scope: "global",
    type: "toggle",
    keywords: ["invitation", "invite", "received invitation"],
  },
  {
    id: "notifyOnRsvp",
    sectionId: "notifications",
    label: "RSVP response notifications",
    description: "Receive notifications when invited guests accept, decline, or mark tentative.",
    scope: "global",
    type: "toggle",
    keywords: ["rsvp", "accept", "decline", "tentative"],
  },
  {
    id: "notifyOnTasks",
    sectionId: "notifications",
    label: "Task notifications",
    description: "Notify when scheduled tasks and action items are due.",
    scope: "global",
    type: "toggle",
    keywords: ["task", "todo", "due date"],
  },
  {
    id: "desktopNotificationsEnabled",
    sectionId: "notifications",
    label: "Desktop notifications",
    description: "Display native browser push notifications for upcoming events.",
    scope: "global",
    type: "toggle",
    keywords: ["desktop notification", "browser alert", "push"],
  },
  {
    id: "allDayReminderTime",
    sectionId: "notifications",
    label: "All-day event reminder timing",
    description: "Time of day to trigger notifications for all-day events.",
    scope: "global",
    type: "select",
    options: [
      { label: "08:00 AM", value: "08:00" },
      { label: "09:00 AM (Default)", value: "09:00" },
      { label: "10:00 AM", value: "10:00" },
      { label: "12:00 PM (Noon)", value: "12:00" },
    ],
    keywords: ["all-day", "reminder time", "morning"],
  },
  {
    id: "quietHoursEnabled",
    sectionId: "notifications",
    label: "Notification quiet hours",
    description: "Silence alerts and desktop popups during resting hours (22:00 - 08:00).",
    scope: "global",
    type: "toggle",
    keywords: ["quiet hours", "do not disturb", "silence", "night"],
  },
  {
    id: "snoozeDefaultMinutes",
    sectionId: "notifications",
    label: "Default snooze duration",
    description: "Minutes to wait before repeating a snoozed event reminder.",
    scope: "global",
    type: "select",
    options: [
      { label: "5 minutes", value: 5 },
      { label: "10 minutes (Default)", value: 10 },
      { label: "15 minutes", value: 15 },
      { label: "30 minutes", value: 30 },
    ],
    keywords: ["snooze", "repeat alarm", "postpone"],
  },

  // ── 4. View options ──
  {
    id: "defaultView",
    sectionId: "view_options",
    label: "Default view",
    description: "View mode opened when entering Calendar from the sidebar or reload.",
    scope: "global",
    type: "select",
    options: [
      { label: "Day view", value: "day" },
      { label: "Week view", value: "week" },
      { label: "Month view", value: "month" },
      { label: "Year view", value: "year" },
      { label: "Agenda / Schedule view", value: "agenda" },
    ],
    keywords: ["default view", "day", "week", "month", "year", "agenda"],
  },
  {
    id: "showWeekends",
    sectionId: "view_options",
    label: "Show weekends",
    description: "Include Saturday and Sunday columns in week and month grids.",
    scope: "global",
    type: "toggle",
    keywords: ["weekends", "saturday", "sunday", "5 day", "7 day"],
  },
  {
    id: "showWeekNumbers",
    sectionId: "view_options",
    label: "Show week numbers",
    description: "Display ISO week numbers (e.g. W43) alongside date headers.",
    scope: "global",
    type: "toggle",
    keywords: ["week numbers", "iso week", "w43"],
  },
  {
    id: "density",
    sectionId: "view_options",
    label: "Event display density",
    description: "Adjust row height, font padding, and event bubble spacing.",
    scope: "global",
    type: "select",
    options: [
      { label: "Compact (Maximum information)", value: "compact" },
      { label: "Cozy (Balanced spacing)", value: "cozy" },
      { label: "Comfortable (Spacious touch targets)", value: "comfortable" },
    ],
    keywords: ["density", "compact", "cozy", "spacing", "size"],
  },
  {
    id: "showDeclinedEvents",
    sectionId: "view_options",
    label: "Show declined events",
    description: "Keep events you have declined visible with strike-through styling.",
    scope: "global",
    type: "toggle",
    keywords: ["declined", "strikethrough", "hidden"],
  },
  {
    id: "alternateCalendar",
    sectionId: "view_options",
    label: "Alternate calendar",
    description: "Display secondary dates in month, week, day, and year views alongside Gregorian dates.",
    scope: "global",
    type: "select",
    options: [
      { label: "None", value: "none" },
      { label: "Hijri (Islamic lunar - Umm al-Qura)", value: "islamic" },
      { label: "Hebrew (Jewish lunisolar)", value: "hebrew" },
      { label: "Chinese (Lunar)", value: "chinese" },
      { label: "Indian National (Saka)", value: "indian" },
      { label: "Persian (Solar Hijri / Jalali)", value: "persian" },
      { label: "Korean (Dangi lunar)", value: "korean" },
      { label: "Bengali (Bangabda regional standard)", value: "bengali" },
    ],
    keywords: [
      "alternate calendar",
      "hijri",
      "islamic",
      "hebrew",
      "chinese",
      "indian",
      "saka",
      "persian",
      "jalali",
      "korean",
      "dangi",
      "bengali",
      "bangabda",
      "lunar",
      "secondary date",
    ],
  },
  {
    id: "showTasksInCalendar",
    sectionId: "view_options",
    label: "Show tasks in calendar",
    description: "Display due and scheduled tasks alongside your calendar events.",
    scope: "global",
    type: "toggle",
    keywords: ["show tasks", "tasks overlay", "to-do", "due items"],
  },

  // ── 5. Time zones and world clock ──
  {
    id: "primaryTimeZone",
    sectionId: "timezones",
    label: "Primary time zone",
    description: "Your local time zone used for event scheduling and display.",
    scope: "global",
    type: "select",
    options: [
      { label: "UTC (Coordinated Universal Time)", value: "UTC" },
      { label: "America/New_York (Eastern Time)", value: "America/New_York" },
      { label: "America/Chicago (Central Time)", value: "America/Chicago" },
      { label: "America/Denver (Mountain Time)", value: "America/Denver" },
      { label: "America/Los_Angeles (Pacific Time)", value: "America/Los_Angeles" },
      { label: "Europe/London (GMT / BST)", value: "Europe/London" },
      { label: "Europe/Paris (CET / CEST)", value: "Europe/Paris" },
      { label: "Europe/Berlin (CET / CEST)", value: "Europe/Berlin" },
      { label: "Asia/Dubai (GST)", value: "Asia/Dubai" },
      { label: "Asia/Dhaka (BST)", value: "Asia/Dhaka" },
      { label: "Asia/Singapore (SGT)", value: "Asia/Singapore" },
      { label: "Asia/Tokyo (JST)", value: "Asia/Tokyo" },
      { label: "Australia/Sydney (AEST / AEDT)", value: "Australia/Sydney" },
    ],
    keywords: ["primary timezone", "local time", "iana", "utc", "gmt"],
  },
  {
    id: "showSecondaryTimeZone",
    sectionId: "timezones",
    label: "Display secondary time zone",
    description: "Show a secondary time column in week and day views for remote collaborators.",
    scope: "global",
    type: "toggle",
    keywords: ["secondary timezone", "dual time", "remote team"],
  },
  {
    id: "secondaryTimeZone",
    sectionId: "timezones",
    label: "Secondary time zone",
    description: "Time zone shown in the second column alongside your primary time.",
    scope: "global",
    type: "select",
    options: [
      { label: "UTC", value: "UTC" },
      { label: "America/New_York (ET)", value: "America/New_York" },
      { label: "America/Los_Angeles (PT)", value: "America/Los_Angeles" },
      { label: "Europe/London (UK)", value: "Europe/London" },
      { label: "Europe/Berlin (CET)", value: "Europe/Berlin" },
      { label: "Asia/Tokyo (JST)", value: "Asia/Tokyo" },
    ],
    keywords: ["secondary timezone", "additional timezone"],
  },
  {
    id: "secondaryTimeZoneLabel",
    sectionId: "timezones",
    label: "Secondary time zone label",
    description: "Short tag displayed above the secondary time column (e.g. NYC, LON).",
    scope: "global",
    type: "text",
    keywords: ["timezone label", "short name", "tag"],
  },
  {
    id: "autoUpdateTimeZoneWithConsent",
    sectionId: "timezones",
    label: "Prompt to update time zone when travelling",
    description: "Ask before adjusting your primary time zone when browser location changes.",
    scope: "global",
    type: "toggle",
    keywords: ["travel", "location", "auto timezone", "consent"],
  },
  {
    id: "showWorldClock",
    sectionId: "timezones",
    label: "Show world clock in sidebar",
    description: "Display local times for configured global cities in the calendar sidebar.",
    scope: "global",
    type: "toggle",
    keywords: ["world clock", "cities", "time difference", "sidebar clock"],
  },

  // ── 6. Working hours and location ──
  {
    id: "workingHoursEnabled",
    sectionId: "working_hours",
    label: "Enable working hours",
    description: "Highlight available work periods and inform colleagues of your active schedule.",
    scope: "global",
    type: "toggle",
    keywords: ["working hours", "schedule", "work period"],
  },
  {
    id: "workingDays",
    sectionId: "working_hours",
    label: "Working days",
    description: "Select which days of the week you actively work.",
    scope: "global",
    type: "multiselect_days",
    keywords: ["working days", "monday to friday", "work schedule"],
  },
  {
    id: "workHoursStart",
    sectionId: "working_hours",
    label: "Work start time",
    description: "Beginning of your daily working hours.",
    scope: "global",
    type: "time",
    keywords: ["start time", "morning", "work hours start"],
  },
  {
    id: "workHoursEnd",
    sectionId: "working_hours",
    label: "Work end time",
    description: "Conclusion of your daily working hours.",
    scope: "global",
    type: "time",
    keywords: ["end time", "evening", "work hours end"],
  },
  {
    id: "defaultWorkLocation",
    sectionId: "working_hours",
    label: "Default working location",
    description: "Your default physical or remote location status.",
    scope: "global",
    type: "select",
    options: [
      { label: "Office", value: "office" },
      { label: "Home", value: "home" },
      { label: "Remote", value: "remote" },
      { label: "Unspecified", value: "unspecified" },
    ],
    keywords: ["working location", "office", "home", "remote", "wfh"],
  },
  {
    id: "autoDeclineOutOfOffice",
    sectionId: "working_hours",
    label: "Automatically decline meetings outside working hours",
    description: "Politely decline event invitations scheduled outside your active hours.",
    scope: "global",
    type: "toggle",
    keywords: ["auto decline", "out of office", "ooo"],
  },
  {
    id: "autoDeclineMessage",
    sectionId: "working_hours",
    label: "Default decline message",
    description: "Custom message sent when automatically declining invitations outside working hours or during out of office.",
    scope: "global",
    type: "text",
    keywords: ["decline message", "out of office message", "auto decline note"],
  },

  // ── 7. Privacy and sharing ──
  {
    id: "defaultEventPrivacy",
    sectionId: "privacy_sharing",
    label: "Default event privacy level",
    description: "Baseline encryption & metadata isolation applied to new events.",
    scope: "global",
    type: "select",
    options: [
      { label: "Normal (Zero-knowledge envelope)", value: "normal" },
      { label: "Private (Masked title to shared users)", value: "private" },
      { label: "Confidential (Strict recipient-only HPKE)", value: "confidential" },
    ],
    keywords: ["privacy", "encryption", "confidential", "sharing"],
  },
  {
    id: "freeBusyVisibility",
    sectionId: "privacy_sharing",
    label: "Free/busy schedule visibility",
    description: "Controls who can see when your calendar has booked vs free time.",
    scope: "global",
    type: "select",
    options: [
      { label: "Public (Anyone can see free/busy)", value: "public" },
      { label: "Internal domain only (Organization members)", value: "internal_only" },
      { label: "Private (Free/busy strictly hidden)", value: "private" },
    ],
    keywords: ["free busy", "availability", "schedule visibility"],
  },
  {
    id: "defaultSharePermission",
    sectionId: "privacy_sharing",
    label: "Default calendar sharing permission",
    description: "Default permission granted when sharing a calendar with another user.",
    scope: "calendar",
    type: "select",
    options: [
      { label: "See free/busy only", value: "free_busy_only" },
      { label: "See all event details (Read only)", value: "read" },
      { label: "Make changes to events (Write)", value: "write" },
      { label: "Make changes and manage sharing (Admin)", value: "admin" },
    ],
    keywords: ["share permission", "read only", "write", "admin"],
  },

  // ── 8. Integrations ──
  {
    id: "mailEventSuggestions",
    sectionId: "integrations",
    label: "BYOS Mail event intelligence",
    description: "Locally extract dates, flight reservations, and invitations from decrypted emails.",
    scope: "global",
    type: "toggle",
    keywords: ["mail suggestions", "email intelligence", "extract dates"],
  },
  {
    id: "mailCategoryFlights",
    sectionId: "integrations",
    label: "Extract flight reservations",
    description: "Automatically detect airline flights, routes, departure times, and PNR codes.",
    scope: "global",
    type: "toggle",
    keywords: ["flights", "airlines", "travel", "pnr"],
  },
  {
    id: "mailCategoryHotels",
    sectionId: "integrations",
    label: "Extract hotel & lodging stays",
    description: "Automatically detect hotel bookings, check-in/out times, and property addresses.",
    scope: "global",
    type: "toggle",
    keywords: ["hotels", "lodging", "stays", "check-in"],
  },
  {
    id: "mailCategoryRestaurants",
    sectionId: "integrations",
    label: "Extract restaurant reservations",
    description: "Automatically detect dining reservations, table times, and party sizes.",
    scope: "global",
    type: "toggle",
    keywords: ["restaurants", "dining", "opentable", "resy"],
  },
  {
    id: "mailCategoryTickets",
    sectionId: "integrations",
    label: "Extract tickets & entertainment",
    description: "Automatically detect concert, theater, cinema, and sports ticket admissions.",
    scope: "global",
    type: "toggle",
    keywords: ["tickets", "concerts", "cinema", "events"],
  },
  {
    id: "mailCategoryEvents",
    sectionId: "integrations",
    label: "Extract webinars & virtual conferences",
    description: "Automatically detect online conferences, workshop registrations, and meeting links.",
    scope: "global",
    type: "toggle",
    keywords: ["webinars", "conferences", "zoom", "meet"],
  },
  {
    id: "showBirthdaysFromContacts",
    sectionId: "integrations",
    label: "Show birthdays from Contacts",
    description: "Display an automatic virtual calendar with contact birthdays.",
    scope: "global",
    type: "toggle",
    keywords: ["birthdays", "contacts", "anniversaries"],
  },
  {
    id: "videoConferenceProvider",
    sectionId: "integrations",
    label: "Default video-conferencing provider",
    description: "Choose the default video service used when adding video calls to calendar events.",
    scope: "global",
    type: "select",
    options: [
      { value: "byos_room", label: "BYOS Secure Enclave Room" },
      { value: "jitsi", label: "Jitsi Meet (meet.jit.si)" },
      { value: "custom", label: "Custom Meeting URL Template" },
      { value: "none", label: "Disabled (Manual entry only)" },
    ],
    keywords: ["video call", "conference", "meet", "jitsi", "zoom"],
  },
  {
    id: "customVideoUrlTemplate",
    sectionId: "integrations",
    label: "Custom video URL template",
    description: "Template URL with {roomId} token substituted per meeting.",
    scope: "global",
    type: "text",
    keywords: ["custom video", "meeting url template"],
  },
  {
    id: "caldavSyncInfo",
    sectionId: "integrations",
    label: "CalDAV Synchronization Endpoint",
    description: "Connect Apple Calendar, Thunderbird, and mobile devices via RFC 4791 CalDAV.",
    scope: "global",
    type: "info",
    keywords: ["caldav", "sync", "apple calendar", "thunderbird", "ios", "android"],
  },

  // ── 9. Keyboard shortcuts and accessibility ──
  {
    id: "keyboardShortcutsEnabled",
    sectionId: "shortcuts_a11y",
    label: "Enable keyboard shortcuts",
    description: "Use shortcuts like T (Today), D (Day), W (Week), M (Month), A (Agenda), / (Search).",
    scope: "global",
    type: "toggle",
    keywords: ["keyboard shortcuts", "hotkeys", "keybindings"],
  },
  {
    id: "highContrastCalendar",
    sectionId: "shortcuts_a11y",
    label: "High contrast calendar borders & text",
    description: "Enhance grid lines and text readability for high visibility requirements.",
    scope: "global",
    type: "toggle",
    keywords: ["high contrast", "accessibility", "a11y", "visibility"],
  },
  {
    id: "reducedMotion",
    sectionId: "shortcuts_a11y",
    label: "Reduce motion & animations",
    description: "Minimize animated view transitions and sliding panels.",
    scope: "global",
    type: "toggle",
    keywords: ["reduced motion", "animations", "prefers-reduced-motion"],
  },
  {
    id: "screenReaderOptimized",
    sectionId: "shortcuts_a11y",
    label: "Screen reader announcements",
    description: "Provide live ARIA announcements when navigating dates and selecting slots.",
    scope: "global",
    type: "toggle",
    keywords: ["screen reader", "aria live", "accessibility"],
  },

  // ── 10. Offline and synchronization ──
  {
    id: "offlineStorageEnabled",
    sectionId: "offline_sync",
    label: "Enable offline calendar cache",
    description: "Keep an encrypted local copy of your calendars for offline viewing and editing.",
    scope: "global",
    type: "toggle",
    keywords: ["offline", "cache", "local storage", "sync"],
  },
  {
    id: "cacheRetentionDays",
    sectionId: "offline_sync",
    label: "Offline cache retention period",
    description: "How many past and future days of events to store in offline memory.",
    scope: "global",
    type: "select",
    options: [
      { label: "7 days", value: 7 },
      { label: "14 days", value: 14 },
      { label: "30 days (1 month)", value: 30 },
      { label: "90 days (3 months)", value: 90 },
      { label: "365 days (1 year)", value: 365 },
    ],
    keywords: ["retention", "cache size", "offline period"],
  },
];

/**
 * Filter settings definitions across all 10 sections by search query
 */
export function searchCalendarSettings(query: string): CalendarSettingDefinition[] {
  const q = query.trim().toLowerCase();
  if (!q) return CALENDAR_SETTINGS_REGISTRY;

  return CALENDAR_SETTINGS_REGISTRY.filter((setting) => {
    if (setting.label.toLowerCase().includes(q)) return true;
    if (setting.description.toLowerCase().includes(q)) return true;
    if (setting.keywords.some((k) => k.toLowerCase().includes(q))) return true;
    const section = CALENDAR_SETTING_SECTIONS.find((s) => s.id === setting.sectionId);
    if (section && section.title.toLowerCase().includes(q)) {
      return true;
    }
    return false;
  });
}
