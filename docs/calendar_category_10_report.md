# Calendar Category 10: Working Hours, Availability and Productivity Status Report

## What was built
Category 10 of the BYOS Calendar Roadmap establishes an end-to-end Zero-Knowledge working hours, availability, and productivity system. It adds support for multiple daily work periods (e.g. morning and afternoon split shifts), date-specific working hour exceptions (holidays and special work shifts), and a three-tier working location hierarchy (daily override, date exception, default work location) with visual indicator chips on day headers. It introduces Out of Office (OOO) and Focus Time event types with dedicated badges (`ooo-event-badge`, `focus-time-badge`, `working-location-badge`), configurable automatic invitation declines with custom polite decline messages, and a zero-knowledge Free/Busy interval engine that strips all sensitive titles, descriptions, and participant metadata before calculating availability intervals.

## Files edited
| File | Reason |
|------|--------|
| `apps/webmail/src/calendar_crypto.ts` | Exported `CalendarEventType` union, added Category 10 fields to `CalendarEventPlaintext`, and preserved them in `decryptCalendarEventPayload`. |
| `apps/webmail/src/components/calendar/settings/calendarSettingsStore.ts` | Declared `WorkPeriod` and `WorkHoursDateException` interfaces, added Category 10 settings to `CalendarSettings` and defaults. |
| `apps/webmail/src/components/calendar/settings/calendarSettingsRegistry.ts` | Registered `autoDeclineMessage` in the working hours settings registry. |
| `apps/webmail/src/utils/calendarAvailability.ts` | Implemented timezone-aware working hours check, location hierarchy resolution, zero-knowledge free/busy interval computation, meeting conflict detection, and auto-decline evaluation. |
| `apps/webmail/src/components/calendar/EventModal.tsx` | Added event type tab selector (Default, Focus time, Out of office, Working location), OOO configuration panel, working location panel, and status mapping. |
| `apps/webmail/src/components/calendar/WeekView.tsx` | Connected `isTimeInWorkingHours` for slot shading, rendered day header location chips, and rendered OOO, Focus, and Location event badges. |
| `apps/webmail/src/components/calendar/DayView.tsx` | Connected `isTimeInWorkingHours` for slot shading, rendered day header location badge, and rendered OOO, Focus, and Location event badges. |
| `apps/webmail/src/components/calendar/MonthView.tsx` | Added OOO, Focus, and Location event badge chips to month view event pills. |
| `apps/webmail/src/components/calendar/CalendarView.tsx` | Passed `calendarSettings` store instance into `WeekView` and `DayView`. |
| `apps/webmail/src/calendar_category_10.test.ts` | Implemented 8 unit test suites verifying all availability calculations, timezone conversions, conflict detection, and AES-GCM focus time payloads. |
| `apps/webmail/src/run_test.node.js` | Registered `runCalendarCategory10Tests` in the master test runner. |
| `tests/browser/test_calendar_category_10.mjs` | Implemented 10-step end-to-end browser verification script testing real login, OOO event creation, focus time, working location, settings, and 375px mobile viewport. |
| `docs/calendar_category_10_report.md` | Verification report with raw evidence and file edit accounting. |

## Raw evidence

### Claim: Unit test execution for Category 10 working hours and availability
PASS
```
Running Calendar Category 10 (Working Hours, Availability & Productivity Status) Tests...
CALENDAR CATEGORY 10 TESTS: 8 passed, 0 failed
```

### Claim: Master webmail test suite execution with 489 tests
all tests pass
```
> test
> npx tsx --experimental-wasm-modules src/run_test.node.js

(node:9388) ExperimentalWarning: Importing WebAssembly modules is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
ATTACHMENT CRYPTO TESTS: 20 passed, 0 failed
TOTP TESTS: 5 passed, 0 failed
DATE TIME TESTS: 10 passed, 0 failed
FILE TYPE TESTS: 10 passed, 0 failed
MULTI-ACCOUNT & STORAGE SYNC TESTS: 34 passed, 0 failed
PASSWORD REWRAP TESTS: 14 passed, 0 failed
PATH A COMPOSE TESTS: 12 passed, 0 failed
PATH A READ TESTS: 10 passed, 0 failed
MIME ENVELOPE ENCRYPTION TESTS: 7 passed, 0 failed
SIGNATURE STORAGE & VERIFICATION TESTS: 7 passed, 0 failed
REPLY SIGNATURE STRIPPING & QUOTE TESTS: 9 passed, 0 failed
MBOX STREAM PARSER TESTS: 11 passed, 0 failed
MBOX LABELS PARSER TESTS: 10 passed, 0 failed
IMPORT QUEUE STATE MACHINE TESTS: 12 passed, 0 failed
THREADING LOGIC & COLLAPSED THREAD TESTS: 12 passed, 0 failed
UNDO SEND LIFECYCLE TESTS: 8 passed, 0 failed
KEYBOARD SHORTCUTS TESTS: 24 passed, 0 failed
SNOOZE LIFECYCLE & CRON TRIGGER TESTS: 15 passed, 0 failed
SCHEDULED FOLDER DRAFTS TESTS: 8 passed, 0 failed
DISPLAY PARTY RESOLUTION TESTS: 16 passed, 0 failed
NESTED LABELS DRAG/DROP & TREE TESTS: 14 passed, 0 failed
API ERROR & RECONNECT TESTS: 8 passed, 0 failed
UNIFIED INBOX AGGREGATION TESTS: 12 passed, 0 failed
MASKED EMAIL ALIAS GENERATION TESTS: 9 passed, 0 failed
FOCUSED INBOX SMART SORTING TESTS: 10 passed, 0 failed
OFFLINE ENCRYPTED DRAFTS & QUEUE TESTS: 12 passed, 0 failed
COMPOSER HTML SANITIZER TESTS: 14 passed, 0 failed
CONTACTS AUTOCOMPLETE & GROUPING TESTS: 12 passed, 0 failed
SIDEBAR BORDERLESS LAYOUT TESTS: 12 passed, 0 failed
PROFILE PHOTO UPLOAD & CACHE TESTS: 8 passed, 0 failed
PERSISTENT SESSION RESTORATION TESTS: 10 passed, 0 failed
OAUTH EXTERNAL IMPORT TESTS: 10 passed, 0 failed
CALENDAR RRULE TESTS: 24 passed, 0 failed
CALENDAR CRYPTO TESTS: 12 passed, 0 failed
CALENDAR ICS TESTS: 14 passed, 0 failed
CALENDAR INVITATION REPOSITORY TESTS: 8 passed, 0 failed
CALENDAR PERSISTENCE SECURITY TESTS: 8 passed, 0 failed
CALENDAR RECOVERY TESTS: 10 passed, 0 failed
HISTORICAL KEY REACTIVATION TESTS: 13 passed, 0 failed
CALENDAR RECURRENCE EXCEPTION TESTS: 8 passed, 0 failed
CALENDAR INVITATION EXTERNAL TESTS: 10 passed, 0 failed
CALENDAR SHARING TESTS: 8 passed, 0 failed
CALENDAR SETTINGS TESTS: 11 passed, 0 failed
CALENDAR MANAGEMENT TESTS: 10 passed, 0 failed
CALENDAR HOLIDAYS TESTS: 7 passed, 0 failed
CALENDAR YEAR VIEW TESTS: 6 passed, 0 failed
CALENDAR CATEGORIES 01, 02, 03 TESTS: 12 passed, 0 failed
CALENDAR CATEGORY 04 TESTS: 6 passed, 0 failed
CALENDAR CATEGORY 05 TESTS: 7 passed, 0 failed
CALENDAR CATEGORY 06 TESTS: 7 passed, 0 failed
CALENDAR CATEGORY 07 TESTS: 9 passed, 0 failed
CALENDAR CATEGORY 08 TESTS: 7 passed, 0 failed
CALENDAR CATEGORY 10 TESTS: 8 passed, 0 failed
UNLOCK & 2FA PERSISTENCE TESTS: 5 passed, 0 failed

OVERALL: 489 passed, 0 failed
```

### Claim: Go backend test execution
PASS
```
ok  	byos.email/crypto/core	(cached)
ok  	byos.email/crypto/envelope	(cached)
ok  	byos.email/crypto/hpke	0.754s
?   	byos.email/scratch	[no test files]
```

### Claim: End-to-end browser verification of Category 10 features
verified
```
================================================================================
   BYOS CALENDAR: CATEGORY 10 END-TO-END BROWSER VERIFICATION                  
   (Working Hours, Availability, Out of Office, Focus Time, Working Location)  
================================================================================


--- [STEP 1] Navigate to Webmail & Clear Storage ---
  Target server: http://127.0.0.1:3001

--- [STEP 2] Real Login Flow for alice@byos.local ---
  Active account: "alice@byos.local"
  PASS: User authenticated as alice@byos.local

--- [STEP 3] Navigate to Calendar View ---
  Calendar interface loaded

--- [STEP 4] Verify Working Location Indicator in Day Header ---
  Found 7 working location header indicators
  PASS: Working location chips rendered on day headers
  Sample working location chip text: "🏢Office"

--- [STEP 5] Create Out of Office (OOO) Event with Auto-Decline ---
  Event type selector tabs present
  Out of office options panel displayed
  OOO event badge: "OOO"
  PASS: OOO event badge displayed on calendar view

--- [STEP 6] Create Focus Time Event ---
  Focus time badge: "Focus"
  PASS: Focus time badge displayed on calendar view

--- [STEP 7] Create Working Location Event ---
  Working location badge: "Location"
  PASS: Working location badge displayed on calendar view
  Desktop screenshot saved: F:\Codex\byos-email\tests\browser\artifacts\calendar_category_10_desktop.png

--- [STEP 8] Verify Calendar Settings: Working Hours & Location ---
  Event modal currently present: false
  Settings modal opened
  PASS: Working hours enabled setting input rendered
  PASS: Default work location setting select rendered
  PASS: Auto-decline outside working hours setting toggle rendered

--- [STEP 9] 375px Mobile Viewport Verification ---
  PASS: 375px mobile viewport has zero horizontal scroll
  Mobile screenshot saved: F:\Codex\byos-email\tests\browser\artifacts\calendar_category_10_mobile.png

--- [STEP 10] DevTools Storage & Console Verification ---
  localStorage keys: [byos_week_start, byos_unified_inbox_excluded, byos_layout, byos_time_format, byos_language, byos_theme, byos_connected_accounts, byos_session_generation, byos_density, byos_view_mode]
  PASS: localStorage contains active session data
  Uncaught console errors: 0
  PASS: DevTools console has zero uncaught errors

================================================================================
   CATEGORY 10 BROWSER VERIFICATION: ALL 10 STEPS PASSED                       
================================================================================
```

## Manual browser verification
1. Authenticated using real login flow with credentials for `alice@byos.local` and landed on the unified webmail dashboard.
2. Switched to Calendar view and verified Week View rendering with 7 day headers, each showing the daily work location chip indicator (`🏢Office`).
3. Clicked "New Event" button, clicked the "Out of office" tab in `[data-testid="event-type-tabs"]`, verified the Out of Office options panel opened, verified the auto-decline checkbox was checked and set custom decline message, saved the event, and observed `[data-testid="ooo-event-badge"]` with text `OOO` on the calendar grid.
4. Clicked "New Event" button, clicked "Focus time" tab, typed title "Deep Work Focus", saved the event, and verified `[data-testid="focus-time-badge"]` with text `Focus` on the calendar grid.
5. Clicked "New Event" button, clicked "Working location" tab, selected "home" as location, saved the event, and verified `[data-testid="working-location-badge"]` with text `Location` on the calendar grid.
6. Captured desktop screenshot to `tests/browser/artifacts/calendar_category_10_desktop.png`.
7. Opened Calendar Settings via toolbar button, navigated to "Working hours & location" (`settings-nav-working_hours`), verified setting toggles for `workingHoursEnabled`, `defaultWorkLocation`, and `autoDeclineOutOfOffice`.
8. Scaled the viewport to a 375px mobile dimension (`width: 375, height: 667`), asserted `document.documentElement.scrollWidth <= document.documentElement.clientWidth` (zero horizontal overflow), and captured mobile screenshot to `tests/browser/artifacts/calendar_category_10_mobile.png`.
9. Inspected DevTools console output and confirmed 0 uncaught errors.

## What did not work or is untested
- Live multi-user exchange of automated decline email delivery over IMAP/SMTP during an active OOO block is UNTESTED at the email delivery layer (evaluated and verified at the availability and calendar event layer in `evaluateAutoDeclineForInvitation`).
To verify email dispatch manually:
1. Connect another user account via mail client or Mailpit.
2. Send an event invitation overlapping Alice's active OOO event block.
3. Observe automatic decline reply generated in Mailpit at `http://127.0.0.1:8025`.

## Test suite output
Full output of `go test ./...`:
```
ok  	byos.email/crypto/core	(cached)
ok  	byos.email/crypto/envelope	(cached)
ok  	byos.email/crypto/hpke	0.754s
?   	byos.email/scratch	[no test files]
```

Full output of `npm test`:
```
> test
> npx tsx --experimental-wasm-modules src/run_test.node.js

(node:9388) ExperimentalWarning: Importing WebAssembly modules is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
ATTACHMENT CRYPTO TESTS: 20 passed, 0 failed
TOTP TESTS: 5 passed, 0 failed
DATE TIME TESTS: 10 passed, 0 failed
FILE TYPE TESTS: 10 passed, 0 failed
MULTI-ACCOUNT & STORAGE SYNC TESTS: 34 passed, 0 failed
PASSWORD REWRAP TESTS: 14 passed, 0 failed
PATH A COMPOSE TESTS: 12 passed, 0 failed
PATH A READ TESTS: 10 passed, 0 failed
MIME ENVELOPE ENCRYPTION TESTS: 7 passed, 0 failed
SIGNATURE STORAGE & VERIFICATION TESTS: 7 passed, 0 failed
REPLY SIGNATURE STRIPPING & QUOTE TESTS: 9 passed, 0 failed
MBOX STREAM PARSER TESTS: 11 passed, 0 failed
MBOX LABELS PARSER TESTS: 10 passed, 0 failed
IMPORT QUEUE STATE MACHINE TESTS: 12 passed, 0 failed
THREADING LOGIC & COLLAPSED THREAD TESTS: 12 passed, 0 failed
UNDO SEND LIFECYCLE TESTS: 8 passed, 0 failed
KEYBOARD SHORTCUTS TESTS: 24 passed, 0 failed
SNOOZE LIFECYCLE & CRON TRIGGER TESTS: 15 passed, 0 failed
SCHEDULED FOLDER DRAFTS TESTS: 8 passed, 0 failed
DISPLAY PARTY RESOLUTION TESTS: 16 passed, 0 failed
NESTED LABELS DRAG/DROP & TREE TESTS: 14 passed, 0 failed
API ERROR & RECONNECT TESTS: 8 passed, 0 failed
UNIFIED INBOX AGGREGATION TESTS: 12 passed, 0 failed
MASKED EMAIL ALIAS GENERATION TESTS: 9 passed, 0 failed
FOCUSED INBOX SMART SORTING TESTS: 10 passed, 0 failed
OFFLINE ENCRYPTED DRAFTS & QUEUE TESTS: 12 passed, 0 failed
COMPOSER HTML SANITIZER TESTS: 14 passed, 0 failed
CONTACTS AUTOCOMPLETE & GROUPING TESTS: 12 passed, 0 failed
SIDEBAR BORDERLESS LAYOUT TESTS: 12 passed, 0 failed
PROFILE PHOTO UPLOAD & CACHE TESTS: 8 passed, 0 failed
PERSISTENT SESSION RESTORATION TESTS: 10 passed, 0 failed
OAUTH EXTERNAL IMPORT TESTS: 10 passed, 0 failed
CALENDAR RRULE TESTS: 24 passed, 0 failed
CALENDAR CRYPTO TESTS: 12 passed, 0 failed
CALENDAR ICS TESTS: 14 passed, 0 failed
CALENDAR INVITATION REPOSITORY TESTS: 8 passed, 0 failed
CALENDAR PERSISTENCE SECURITY TESTS: 8 passed, 0 failed
CALENDAR RECOVERY TESTS: 10 passed, 0 failed
HISTORICAL KEY REACTIVATION TESTS: 13 passed, 0 failed
CALENDAR RECURRENCE EXCEPTION TESTS: 8 passed, 0 failed
CALENDAR INVITATION EXTERNAL TESTS: 10 passed, 0 failed
CALENDAR SHARING TESTS: 8 passed, 0 failed
CALENDAR SETTINGS TESTS: 11 passed, 0 failed
CALENDAR MANAGEMENT TESTS: 10 passed, 0 failed
CALENDAR HOLIDAYS TESTS: 7 passed, 0 failed
CALENDAR YEAR VIEW TESTS: 6 passed, 0 failed
CALENDAR CATEGORIES 01, 02, 03 TESTS: 12 passed, 0 failed
CALENDAR CATEGORY 04 TESTS: 6 passed, 0 failed
CALENDAR CATEGORY 05 TESTS: 7 passed, 0 failed
CALENDAR CATEGORY 06 TESTS: 7 passed, 0 failed
CALENDAR CATEGORY 07 TESTS: 9 passed, 0 failed
CALENDAR CATEGORY 08 TESTS: 7 passed, 0 failed
CALENDAR CATEGORY 10 TESTS: 8 passed, 0 failed
UNLOCK & 2FA PERSISTENCE TESTS: 5 passed, 0 failed

OVERALL: 489 passed, 0 failed
```
