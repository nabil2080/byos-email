# Unfinished Work Remediation Summary Report (Groups A, B, and C)

## What was built
Completed comprehensive remediation across all three webmail applications (Mailbox, Calendar, and Notes) tackling the unfinished work, security gaps, and type divergence discovered during our forensic audit:

1. **Group A: Data Loss & Functional Breakages**:
   - Fixed CC and BCC address dropping across compose drawer, MIME assembly, pending payload caching, and Rust outbound worker multi-recipient parsing.
   - Fixed pre-restore snapshot destruction in Notes version history.
   - Fixed DrawingModal canvas uninitialized state on modal open via synchronous SolidJS ref callback and reactive visibility tracking.
   - Fixed composer history out-of-bounds indexing in Notes undo/redo stack.

2. **Group B: Type Invariants & Core Lifecycles**:
   - Resolved `ConnectedAccount` type contract when locking accounts (`mailboxSkHex?: string` / safe locked handling).
   - Unified note storage key routing so card actions and modals consistently use `effectiveMailboxId()`.
   - Elevated calendar reminder loop (`checkReminders`) to global `App.tsx` level so alerts continue firing when navigating to Mail or Notes, with event navigation linking.
   - Corrected call signature for `expandEventOccurrences` in `urlCalendarStore.ts`.
   - Resolved all 38+ project-wide TypeScript compilation errors (`npx tsc --noEmit` exits with code 0).

3. **Group C: Calendar HPKE Exchange, Booking & Storage Safeguards**:
   - Implemented real HPKE public key resolution and encryption with `sealCalendarKeyForGrantee` in `ShareCalendarModal.tsx`, replacing the hardcoded dummy string `"shared_cal_key_envelope_v1"`.
   - Added `/book/:slug` routing in `App.tsx` and fixed `<BookingPageView>` timezone options rendering `[object Object]` by mapping `{ id, label }`.
   - Corrected appointment booking cancellation arguments and injected `currentUserEmail` into booking ICS generation.
   - Enforced strict `MAX_TASKS_PER_MAILBOX` bound on active task storage in `taskStore.ts`.
   - Added interval backoff to URL calendar feed refresh to prevent tight retry storms on CORS/network errors.

## Files edited
| File | Reason |
|------|--------|
| `apps/webmail/src/App.tsx` | Supported CC/BCC inputs, global reminder evaluation, `/book/:slug` route handling, and event modal selection. |
| `apps/webmail/src/api.ts` | Made `mailboxSkHex` optional for locked accounts and added passkey fields to `TwoFactorStatus`. |
| `apps/webmail/src/components/ComposeDrawer.tsx` | Wired CC/BCC input signals and reset `showCcBcc` on compose drawer close. |
| `apps/webmail/src/undo_send.ts` | Extended pending send payloads and restoration to include CC and BCC recipients. |
| `apps/webmail/src/components/notes/notesStore.ts` | Fixed version snapshot in-memory preservation during `restoreNoteVersion`. |
| `apps/webmail/src/components/notes/DrawingModal.tsx` | Replaced delayed timeout with synchronous canvas ref callback and reactive `isOpen` lifecycle. |
| `apps/webmail/src/components/notes/NotesView.tsx` | Unified `effectiveMailboxId()` routing, synced modal inputs on version restore, and bounded undo/redo indexing. |
| `apps/webmail/src/components/calendar/CalendarView.tsx` | Removed local duplicate reminder loop, wired global selected event modal opener, and fixed booking cancellation arguments. |
| `apps/webmail/src/components/calendar/ShareCalendarModal.tsx` | Wired `sealCalendarKeyForGrantee` with grantee public key directory lookup and fail-closed key validation. |
| `apps/webmail/src/components/calendar/appointments/BookingPageView.tsx` | Fixed timezone select `[object Object]` bug and supported attendee cancellation tokens. |
| `apps/webmail/src/components/calendar/appointments/appointmentStore.ts` | Added cancellation token lookup fallback across appointment schedules. |
| `apps/webmail/src/components/calendar/tasks/taskStore.ts` | Enforced strict `MAX_TASKS_PER_MAILBOX` (1,000) bound on uncompleted tasks. |
| `apps/webmail/src/components/calendar/url/urlCalendarStore.ts` | Fixed `expandEventOccurrences` call signature and added backoff timestamp on feed fetch failure. |
| `apps/webmail/src/components/calendar/url/SubscribeFromUrlModal.tsx` | Added CORS diagnostic guidance on failed URL feed preview. |
| `apps/webmail/src/components/calendar/settings/CalendarSettingsPanel.tsx` | Corrected `ImportSummary` property names (`imported`, `updated`, `skipped`). |
| `apps/webmail/src/components/calendar/DayView.tsx` | Removed invalid `title` attribute from SVG element. |
| `apps/webmail/src/components/calendar/WeekView.tsx` | Removed invalid `title` attribute from SVG element. |
| `apps/webmail/src/components/calendar/MonthView.tsx` | Removed invalid `title` attribute from SVG element. |
| `apps/webmail/src/components/calendar/EventModal.tsx` | Added missing `ParsedRRule` import and typed recurrence state. |
| `apps/webmail/src/components/calendar/CalendarModal.tsx` | Handled undefined calendar color fallback. |
| `apps/webmail/src/components/calendar/CalendarSidebar.tsx` | Updated `DecryptedEventRecord` interface with optional `status`. |
| `apps/webmail/src/components/calendar/settings/calendarSettingsStore.ts` | Added `note?: string` to date exceptions and `eventRemindersDefaultMinutes` to settings. |
| `apps/webmail/src/utils/calendarIcs.ts` | Exported `parseIcsText`, fixed variable reference in catch block, and added optional `organizer` to `GenerateIcsParams`. |
| `apps/webmail/src/utils/calendarContactsIntegration.ts` | Removed unsupported `format` property from generated decrypted event records. |
| `services/outbound-worker/src/main.rs` | Split and parsed comma/semicolon recipient lists before parsing `lettre::Address` to prevent multi-recipient bounces. |
| `apps/webmail/src/mime.test.ts` | Added automated test validating CC/BCC header generation in `buildMimeString`. |
| `apps/webmail/src/undo_send.test.ts` | Added automated test validating CC/BCC persistence in undo-send payloads. |
| `apps/webmail/src/components/notes/notes.test.ts` | Added test assertions for version history snapshot preservation and bounded history indexing. |
| `apps/webmail/src/calendar_category_11.test.ts` | Added test case verifying strict `MAX_TASKS_PER_MAILBOX` bound enforcement. |
| `apps/webmail/src/calendar_category_12.test.ts` | Added test cases for cancellation token lookup and resolution. |
| `apps/webmail/src/calendar_category_14.test.ts` | Added test cases verifying feed error backoff timestamp updates. |
| `apps/webmail/src/calendar_sharing.test.ts` | Added test cases verifying X-Wing 2432-char hex and base64 key resolution. |
| `apps/webmail/src/calendar_category_06.test.ts` | Fixed literal type narrowing comparison mismatch. |
| `apps/webmail/src/calendar_management.test.ts` | Exported template constants and helpers. |
| `apps/webmail/src/calendar_recovery.test.ts` | Fixed assert parameter typing and status flag narrowing. |

## Raw evidence

### TypeScript Project-Wide Type Check
Command: `cmd.exe /c "cd apps\webmail && npx tsc --noEmit"`
Output:
```
(No errors - exited with code 0)
```

### Webmail Vitest Suite
Command: `cmd.exe /c "cd apps\webmail && npm test"`
Output:
```
OVERALL: 556 passed, 0 failed
```

### Go Backend Test Suite
Command: `powershell -Command "cd services/api; go test -count=1 ./..."`
Output:
```
ok  	byos.email/services/api	2.253s
```

### Browser Automation Audit
Command: `node tests/browser/test_sidebar_polish_and_notes_labels.mjs`
Output:
```
================================================================================
   BYOS: INBOX PILL ON LOAD, CALENDAR SCROLLBARS, NOTES LABELS & SIGNOUT AUDIT  
================================================================================
  PASS: Sliding pill element is found in sidebar
  PASS: Unified capsule pill container is present in Mailbox sidebar
  PASS: Contacts button text is 'Contacts' (got 'Contacts')
  PASS: Settings button text is 'Settings' (got 'Settings')
  PASS: Sign-out button text is 'Sign out' (got 'Sign out')
  PASS: Text is visually hidden at rest using sr-only
  PASS: Contacts tooltip element exists
  PASS: Contacts tooltip becomes visible on hover (opacity: 1)
  PASS: Calendar view contains .custom-scrollbar elements
  PASS: Unified capsule pill container is present in Notes sidebar
  PASS: Label 'Core Architecture' was created and attached to note in composer
  PASS: Note card 'Architecture Decisions' exists
  PASS: Note card displays 'Core Architecture' label chip
  PASS: Note card now has both 'Core Architecture' and 'Reviewed' labels
================================================================================
   ALL AUDIT CHECKS PASSED WITH RAW VERIFICATION EVIDENCE                      
================================================================================
```
