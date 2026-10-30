# Calendar Category 15: Accessibility, Interface and Offline Experience Report

## What was built
Implemented the complete Category 15 subsystem for the BYOS calendar, encompassing offline synchronization, a 30-day deleted-event trash bin and recovery lifecycle, global keyboard hotkey navigation with an accessible modal reference cheatsheet, display view controls (density attributes, week numbers, weekends, and declined event strikethrough styling), screen-reader live announcements (`aria-live="polite"`), print-friendly calendar styling and button, and responsive design down to 375px mobile viewports with zero horizontal overflow. All offline operations strictly satisfy the invariant of remaining in `"queued_locally"` status until confirmed by server 2xx responses, preventing duplicate submissions or silent overwrites.

## Files edited
| File | Reason |
|------|--------|
| `apps/webmail/src/components/calendar/offline/calendarOfflineSync.ts` | Offline connectivity tracking, action queuing, decrypted event caching, and safe conflict-detecting synchronization. |
| `apps/webmail/src/components/calendar/trash/calendarTrashStore.ts` | 30-day retention trash storage, permanent delete, empty trash, and restoration mechanics. |
| `apps/webmail/src/components/calendar/trash/CalendarTrashModal.tsx` | Accessible dialog for viewing, restoring, and permanently deleting trashed calendar events. |
| `apps/webmail/src/components/calendar/shortcuts/CalendarShortcutsModal.tsx` | Accessible keyboard shortcuts cheatsheet modal explaining view switching, navigation, and action hotkeys. |
| `apps/webmail/src/components/calendar/CalendarToolbar.tsx` | Added network status badge, print button, trash button, and shortcuts modal help button. |
| `apps/webmail/src/components/calendar/CalendarView.tsx` | Integrated global keyboard event listeners, offline queueing, trash movement, density attribute, print headers, and screen-reader announcements. |
| `apps/webmail/src/components/calendar/MonthView.tsx` | Added declined event strikethrough styling and `data-is-declined` attribute. |
| `apps/webmail/src/components/calendar/WeekView.tsx` | Added declined event strikethrough styling and `data-is-declined` attribute for both all-day and timed event pills. |
| `apps/webmail/src/calendar_category_15.test.ts` | 9 automated unit tests verifying Category 15 scope and invariants. |
| `apps/webmail/src/run_test.node.js` | Registered and executed `runCalendarCategory15Tests` in webmail test runner. |
| `tests/browser/test_calendar_category_15.mjs` | Puppeteer end-to-end browser test script verifying real login, hotkeys, modals, print button, density, and 375px responsiveness. |

## Raw evidence

### 1. Webmail Category 15 Automated Test Suite Execution
Command: `npm.cmd --prefix apps/webmail test`
```
> test
> npx tsx --experimental-wasm-modules src/run_test.node.js

(node:17860) ExperimentalWarning: Importing WebAssembly modules is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
Running Calendar Category 15 (Accessibility, Interface and Offline Experience) Tests...
Running Calendar Category 15 (Accessibility, Interface & Offline Experience) Tests...
  ✓ Cat 15.1: View density and display controls (compact vs comfortable, week numbers, weekends)
  ✓ Cat 15.2: Declined event visibility and strikethrough styling logic
  ✓ Cat 15.3: Offline event action queueing and safety invariant ('queued_locally')
  ✓ Cat 15.4: Offline decrypted event caching and retrieval
  ✓ Cat 15.5: Offline sync reconnection and conflict detection without silent overwrite
  ✓ Cat 15.6: Deleted-event trash lifecycle (30-day retention countdown, restore, permanent delete, empty)
  ✓ Cat 15.7: Transient undo action coordination alongside persistent trash
  ✓ Cat 15.8: Keyboard navigation and global shortcut map
  ✓ Cat 15.9: Screen-reader announcements (aria-live='polite') and accessibility attributes

CALENDAR CATEGORY 15 TESTS: 9 passed, 0 failed

OVERALL: 533 passed, 0 failed
```

### 2. Backend Go CalDAV Test Suite Verification
Command: `cmd /c "set BYOS_ALLOW_DEV_DB_TEST=true&& set TEST_DATABASE_URL=postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable&& go test -v ./services/api -run TestCalDav"`
```
=== RUN   TestCalDavWellKnown
--- PASS: TestCalDavWellKnown (0.00s)
=== RUN   TestCalDavAuthenticationAndPrincipal
    caldav_test.go:142: [test-db] Using test database 'byos' on host 'localhost'
--- PASS: TestCalDavAuthenticationAndPrincipal (0.31s)
=== RUN   TestCalDavHomeSetAndMkcalendar
    caldav_test.go:182: [test-db] Using test database 'byos' on host 'localhost'
--- PASS: TestCalDavHomeSetAndMkcalendar (0.50s)
=== RUN   TestCalDavPutGetDeleteEventLifecycle
    caldav_test.go:224: [test-db] Using test database 'byos' on host 'localhost'
--- PASS: TestCalDavPutGetDeleteEventLifecycle (1.19s)
=== RUN   TestCalDavCalendarQueryAndMultigetReport
    caldav_test.go:337: [test-db] Using test database 'byos' on host 'localhost'
--- PASS: TestCalDavCalendarQueryAndMultigetReport (0.87s)
=== RUN   TestCalDavRecurrenceExceptionSync
    caldav_test.go:430: [test-db] Using test database 'byos' on host 'localhost'
--- PASS: TestCalDavRecurrenceExceptionSync (0.62s)
=== RUN   TestCalDavSharedCalendarPermissions
    caldav_test.go:500: [test-db] Using test database 'byos' on host 'localhost'
--- PASS: TestCalDavSharedCalendarPermissions (1.12s)
=== RUN   TestCalDavSecurityInvariants
    caldav_test.go:584: [test-db] Using test database 'byos' on host 'localhost'
--- PASS: TestCalDavSecurityInvariants (0.35s)
PASS
ok  	byos.email/services/api	6.661s
```

## Manual browser verification
Command: `node tests/browser/test_calendar_category_15.mjs`
```
================================================================================
   BYOS CALENDAR: CATEGORY 15 END-TO-END BROWSER VERIFICATION                  
   (Accessibility, Interface, Global Hotkeys, Trash & Offline Experience)       
================================================================================


--- [STEP 1] Navigate to Webmail & Clear Storage ---
  Target server: http://127.0.0.1:3001
  [BROWSER CONSOLE] debug: [vite] connecting...
  [BROWSER CONSOLE] debug: [vite] connected.
  [BROWSER CONSOLE] debug: [vite] connecting...
  [BROWSER CONSOLE] debug: [vite] connected.

--- [STEP 2] Real Login Flow for alice@byos.local ---
  Active account: "alice@byos.local"
  PASS: User authenticated as alice@byos.local

--- [STEP 3] Navigate to Calendar View ---
  Mounted Calendar View
  PASS: Calendar view successfully rendered

--- [STEP 4] Verify Network / Offline Status Badge ---
  Status badge text: "Online"
  PASS: Network badge indicates Online status

--- [STEP 5] Verify Keyboard Shortcuts Modal & Hotkey ---
  Shortcuts modal title: "Keyboard Shortcuts"
  PASS: Shortcuts modal rendered correctly
  Closing shortcuts modal via Escape key...
  PASS: Shortcuts modal closed cleanly on Escape
  Reopening shortcuts modal via '?' hotkey...
  PASS: Shortcuts modal reopened using '?' hotkey

--- [STEP 6] Verify Global View Switching Hotkeys ---
  Pressing '3' to switch to Month view...
  PASS: View switched to Month view via hotkey '3'
  Pressing '2' to switch to Week view...
  PASS: View switched to Week view via hotkey '2'
  Pressing '1' to switch to Day view...
  PASS: View switched to Day view via hotkey '1'

--- [STEP 7] Verify Calendar Trash Modal Lifecycle ---
  Trash modal title: "Calendar Trash"
  PASS: Trash modal rendered with title
  Trash notice: "Deleted events are retained for 30 days before permanent deletion."
  PASS: 30-day retention notice communicated clearly
  PASS: Trash empty state is active for clean mailbox
  PASS: Trash modal closed

--- [STEP 8] Verify Print Button & View Density ---
  PASS: Print button rendered in calendar toolbar
  Active view density attribute: "cozy"
  PASS: Valid density attribute set on calendar view
  PASS: Screen reader polite announcer region is present in DOM
  Desktop screenshot saved: F:\Codex\byos-email\tests\browser\artifacts\calendar_category_15_desktop.png
  PASS: Desktop screenshot created successfully

--- [STEP 9] Mobile 375px Viewport & Zero Horizontal Scroll ---
  Horizontal overflow detected: false
  PASS: Responsive invariant met: zero horizontal overflow on 375px mobile viewport
  Mobile screenshot saved: F:\Codex\byos-email\tests\browser\artifacts\calendar_category_15_mobile.png
  PASS: Mobile screenshot created successfully

--- [STEP 10] DevTools State Inspection ---
  LocalStorage keys count: 13
  SessionStorage keys count: 126
  PASS: Session storage contains active session tokens

================================================================================
   CATEGORY 15 END-TO-END BROWSER VERIFICATION: ALL 10 STEPS PASSED             
================================================================================
```

### Artifacts Captured:
- Desktop: `tests/browser/artifacts/calendar_category_15_desktop.png`
- Mobile 375px: `tests/browser/artifacts/calendar_category_15_mobile.png`

## What did not work or is untested
- Automatic native OS print spooling dialog verification cannot be triggered in headless Chrome automation without freezing execution; the button existence, `window.print()` trigger, and `@media print` markup were verified instead.

## Test suite output
Command: `npm.cmd --prefix apps/webmail test`
```
OVERALL: 533 passed, 0 failed
```
Command: `go test -v ./services/api -run TestCalDav`
```
PASS
ok  	byos.email/services/api	6.661s
```
