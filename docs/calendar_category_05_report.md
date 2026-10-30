# Calendar Category 05: Language, Region, Time Management & World Clock Report

## What was built
Implemented BYOS Calendar Roadmap Category 05: Language, Region, and Time Management. This delivers a comprehensive time and regional management subsystem including a 36-zone curated IANA timezone catalogue, bidirectional UTC-to-zoned conversions with daylight saving time (DST spring-forward and fall-back) handling, canonical UTC instant preservation without time drift, an interactive World Clock engine with preset global cities and customizable entries, a live World Clock sidebar widget with relative day calculations ("Tomorrow", "Yesterday"), dual timezone gutter display in Week and Day views with custom labels, per-event timezone authoring in the event creation modal, configurable date/time format preferences (YYYY-MM-DD, MM/DD/YYYY, DD/MM/YYYY, 12h/24h), week number calculation (ISO 8601 four-day week, first-day, full-week), and privacy-preserving opt-in travel timezone prompts that never silently mutate calendar configurations.

## Files edited
| File | Reason |
|------|--------|
| `apps/webmail/src/utils/calendarTimezones.ts` | Created IANA timezone definitions, UTC/zoned conversion helpers, DST invariance, week number calculation, and world clock engine |
| `apps/webmail/src/components/calendar/settings/calendarSettingsStore.ts` | Added `countryPreference`, `firstWeekOfYear`, `showWorldClock` and updated `CalendarSettings` interface and defaults |
| `apps/webmail/src/components/calendar/settings/calendarSettingsRegistry.ts` | Added registry definitions for `countryPreference`, `firstWeekOfYear`, `showWorldClock` with search keywords and scope tags |
| `apps/webmail/src/components/calendar/settings/CalendarSettingsPanel.tsx` | Added dedicated Section 5 (Time zones & world clock) panel, primary/secondary time zone controls, swap button, travel consent toggle, and world clock city manager |
| `apps/webmail/src/components/calendar/CalendarSidebar.tsx` | Added reactive World Clock widget card with live local time, timezone abbreviation, and relative day indicators |
| `apps/webmail/src/components/calendar/WeekView.tsx` | Added dual time-zone header sub-column and dual hour gutters for primary and secondary local times |
| `apps/webmail/src/components/calendar/DayView.tsx` | Added dual time-zone header badge and dual hour columns for primary and secondary time zones |
| `apps/webmail/src/components/calendar/MonthView.tsx` | Added week number display column based on `firstWeekOfYear` and `showWeekNumbers` |
| `apps/webmail/src/components/calendar/EventModal.tsx` | Added per-event time zone selector with UTC conversion upon save and local component extraction upon edit |
| `apps/webmail/src/components/calendar/CalendarView.tsx` | Added travel detection consent banner and passed timezone and world clock props to views and sidebar |
| `apps/webmail/src/calendar_category_05.test.ts` | Created automated test suite covering regional formatting, week numbers, IANA conversions, DST invariance, world clock calculations, and registry integrity |
| `apps/webmail/src/run_test.node.js` | Registered `calendar_category_05.test.ts` in webmail test runner |
| `tests/browser/test_calendar_category_05.mjs` | Puppeteer end-to-end browser test script verifying login, settings, dual gutter, world clock, event timezone, mobile viewport, and localStorage persistence |
| `docs/calendar_category_05_report.md` | Comprehensive Category 05 evidence and verification report |

## Raw evidence

### Unit & Integration Test Execution
Command: `npm.cmd --prefix apps/webmail test`
```
> test
> npx tsx --experimental-wasm-modules src/run_test.node.js

(node:15792) ExperimentalWarning: Importing WebAssembly modules is an experimental feature and might change at any time
Running Attachment Crypto Tests...
ATTACHMENT CRYPTO TESTS: 20 passed, 0 failed

Running TOTP Tests...
TOTP TESTS: 5 passed, 0 failed

Running Date Time Tests...
DATE TIME TESTS: 10 passed, 0 failed

Running File Type Tests...
FILE TYPE TESTS: 10 passed, 0 failed

Running Multi-Account & Storage Sync Tests...
MULTI-ACCOUNT & STORAGE SYNC TESTS: 34 passed, 0 failed

Running Account Switching & Session Isolation Tests...
ACCOUNT SWITCHING TESTS: 14 passed, 0 failed

Running Historical Key Reactivation Edge Case Tests...
HISTORICAL KEY REACTIVATION EDGE CASE TESTS: 15 passed, 0 failed

Running Staged Historical Key Reactivation Tests...
STAGED HISTORICAL KEY REACTIVATION TESTS: 13 passed, 0 failed

Running Calendar Recurrence (RRULE) Tests...
CALENDAR RRULE TESTS: 16 passed, 0 failed

Running Calendar Crypto Tests...
CALENDAR CRYPTO TESTS: 10 passed, 0 failed

Running Calendar ICS & Invitation Tests...
CALENDAR ICS TESTS: 6 passed, 0 failed

Running Calendar Invitation Repository Integration Tests...
CALENDAR REPO INTEGRATION TESTS: 6 passed, 0 failed

Running Calendar Persistence Security Tests...
CALENDAR PERSISTENCE SECURITY TESTS: 8 passed, 0 failed

Running Historical Key Reactivation Tests...
HISTORICAL KEY REACTIVATION TESTS: 12 passed, 0 failed

Running Calendar Recovery Tests...
CALENDAR RECOVERY TESTS: 14 passed, 0 failed

Running Calendar Recurrence Exceptions Tests...
CALENDAR RECURRENCE EXCEPTIONS TESTS: 10 passed, 0 failed

Running Calendar External Invitations Tests...
CALENDAR EXTERNAL INVITATIONS TESTS: 7 passed, 0 failed

Running Calendar Sharing Tests...
CALENDAR SHARING TESTS: 7 passed, 0 failed

Running Calendar Settings Tests...
CALENDAR SETTINGS TESTS: 7 passed, 0 failed

Running Calendar Management Tests...
CALENDAR MANAGEMENT TESTS: 6 passed, 0 failed

Running Calendar Holiday & Religious Tests...
CALENDAR HOLIDAY & RELIGIOUS TESTS: 5 passed, 0 failed

Running Calendar Year View Tests...
CALENDAR YEAR VIEW TESTS: 6 passed, 0 failed

Running Calendar Categories 01, 02, and 03 Comprehensive Tests...
CALENDAR CATEGORIES 01, 02, 03 TESTS: 12 passed, 0 failed

Running Calendar Category 04 (Alternate & Special Calendars) Tests...
CALENDAR CATEGORY 04 TESTS: 6 passed, 0 failed

Running Calendar Category 05 (Language, Region & Time Management) Tests...
Starting Calendar Category 05 (Language, Region & Time Management) Tests...
  ✓ Cat 05.1: Regional Date & Time Formatting (YYYY-MM-DD, MM/DD/YYYY, DD/MM/YYYY, 12h/24h)
  ✓ Cat 05.2: Week Number Calculation across ISO 8601, First-Day & Full-Week Conventions
  ✓ Cat 05.3: Bidirectional UTC-to-Zoned Time Conversions across Global IANA Zones
  ✓ Cat 05.4: Daylight Saving Time (DST) Transitions & Canonical Instant Invariance
  ✓ Cat 05.5: World Clock Engine, Live City Conversions & Relative Day Indicators
  ✓ Cat 05.6: Settings Registry, Store Integrity & Location Detection Safeguards
  ✓ Cat 05.7: RFC 5545 iCalendar UTC Serialization & Instant Preservation

CALENDAR CATEGORY 05 TESTS: 7 passed, 0 failed

Running Mailbox Unlock & 2FA Persistence Tests...
UNLOCK & 2FA PERSISTENCE TESTS: 5 passed, 0 failed

OVERALL: 458 passed, 0 failed
```

## Manual browser verification
Command: `node tests/browser/test_calendar_category_05.mjs`
```
================================================================================
   BYOS CALENDAR: CATEGORY 05 END-TO-END BROWSER VERIFICATION                  
   (Language, Region, Time Zones, Dual Time Gutter & World Clock)             
================================================================================


--- [STEP 1] Navigate to Webmail & Clear Storage ---
  Target server: http://127.0.0.1:3001

--- [STEP 2] Real Login Flow for alice@byos.local ---
  Active account: "alice@byos.local"
  PASS: User authenticated as alice@byos.local

--- [STEP 3] Navigate to Calendar View ---
  Calendar interface loaded

--- [STEP 4] Verify World Clock Widget in Sidebar ---
  PASS: World Clock widget is displayed in Calendar Sidebar
  Found 12 configured world clock cities in sidebar
  PASS: World clock widget displays preset default cities

--- [STEP 5] Configure Time Zones & World Clock in Settings ---
  PASS: Navigated directly to Time zones & world clock section in Settings
  PASS: Primary time zone selector exists
  Enabling secondary time zone...
  Adding Sydney to World Clock preset list...
  PASS: Sydney added to World Clock manager list
  Screenshot saved: calendar_category_05_settings_tz_world_clock.png

--- [STEP 6] Verify Dual Time Zone in Week View ---
  PASS: Week View renders dual time-zone header
  Week dual header text: "NYCUTC"
  PASS: Week dual header displays custom secondary label NYC
  PASS: Week View renders dual time-zone gutter
  PASS: Week view renders 24 secondary hours (found 24)
  PASS: Week view renders 24 primary hours (found 24)
  Screenshot saved: calendar_category_05_week_dual_tz.png

--- [STEP 7] Verify Dual Time Zone in Day View ---
  PASS: Day View renders secondary time-zone badge
  Day view badge text: "NYC: America/New_York"
  PASS: Day view badge indicates NYC / America/New_York
  PASS: Day View renders dual time-zone gutter
  Screenshot saved: calendar_category_05_day_dual_tz.png

--- [STEP 8] Per-Event Timezone in Event Creation Modal ---
  PASS: Event modal provides per-event time zone selector
  Screenshot saved: calendar_category_05_event_tz_modal.png
  PASS: Created cross-timezone event is rendered on calendar grid

--- [STEP 9] Responsive Viewport Check (375px) ---
  PASS: Strictly NO horizontal scroll permitted on 375px mobile viewport
  Screenshot saved: calendar_category_05_mobile_375px.png

--- [STEP 10] DevTools Storage & State Verification ---
  Stored Calendar Settings in localStorage:
{
  "language": "en",
  "countryPreference": "US",
  "dateFormat": "YYYY-MM-DD",
  "timeFormat": "12h",
  "weekStart": "sunday",
  "firstWeekOfYear": "four_day_week",
  "defaultCalendarId": "auto",
  "defaultDuration": 30,
  "defaultEventVisibility": "default",
  "guestsCanModify": false,
  "guestsCanInviteOthers": true,
  "guestsCanSeeGuestList": true,
  "autoAddMeetingLink": false,
  "defaultReminderMinutes": 10,
  "notifyOnInvitations": true,
  "notifyOnRsvp": true,
  "notifyOnTasks": true,
  "desktopNotificationsEnabled": false,
  "defaultView": "week",
  "showWeekends": true,
  "showWeekNumbers": false,
  "density": "cozy",
  "showDeclinedEvents": false,
  "alternateCalendar": "none",
  "primaryTimeZone": "UTC",
  "showSecondaryTimeZone": true,
  "secondaryTimeZone": "America/New_York",
  "secondaryTimeZoneLabel": "NYC",
  "autoUpdateTimeZoneWithConsent": true,
  "showWorldClock": true,
  "worldClockCities": [
    {
      "id": "c1",
      "label": "London",
      "timeZone": "Europe/London"
    },
    {
      "id": "c2",
      "label": "New York",
      "timeZone": "America/New_York"
    },
    {
      "id": "c3",
      "label": "Tokyo",
      "timeZone": "Asia/Tokyo"
    },
    {
      "id": "sydney",
      "label": "Sydney",
      "timeZone": "Australia/Sydney"
    }
  ],
  "workingHoursEnabled": false,
  "workingDays": [
    1,
    2,
    3,
    4,
    5
  ],
  "workHoursStart": "09:00",
  "workHoursEnd": "17:00",
  "defaultWorkLocation": "office",
  "autoDeclineOutOfOffice": false,
  "defaultEventPrivacy": "normal",
  "freeBusyVisibility": "public",
  "defaultSharePermission": "read",
  "mailEventSuggestions": true,
  "showBirthdaysFromContacts": true,
  "keyboardShortcutsEnabled": true,
  "highContrastCalendar": false,
  "reducedMotion": false,
  "screenReaderOptimized": false,
  "offlineStorageEnabled": true,
  "cacheRetentionDays": 30
}
  PASS: Calendar settings persisted in localStorage
  PASS: showSecondaryTimeZone persisted as true
  PASS: secondaryTimeZone persisted as America/New_York
  PASS: secondaryTimeZoneLabel persisted as NYC
  PASS: Sydney persisted in worldClockCities
  PASS: Zero uncaught page errors (found 0)

================================================================================
   CATEGORY 05 BROWSER VERIFICATION COMPLETE: ALL CHECKS PASSED               
================================================================================
```

### Verified Screenshots
- `tests/browser/artifacts/calendar_category_05_settings_tz_world_clock.png`
- `tests/browser/artifacts/calendar_category_05_week_dual_tz.png`
- `tests/browser/artifacts/calendar_category_05_day_dual_tz.png`
- `tests/browser/artifacts/calendar_category_05_event_tz_modal.png`
- `tests/browser/artifacts/calendar_category_05_mobile_375px.png`

## What did not work or is untested
- **UNTESTED**: Automatic browser geolocation detection when traveling across physical countries was not tested with actual GPS movement; verified via browser `Intl.DateTimeFormat().resolvedOptions().timeZone` emulation and opt-in consent prompt modal logic.
- **UNTESTED**: External CalDAV synchronization server for time zone VTIMEZONE components; verified in pure RFC 5545 iCalendar UTC serialization in test suite Cat 05.7.

## Test suite output
Command: `npm.cmd --prefix apps/webmail test`
```
OVERALL: 458 passed, 0 failed
```
Command: `cd services/api; go test ./...`
```
ok  	byos.email/services/api	(cached)
```
