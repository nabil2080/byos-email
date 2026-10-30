# Group C Completion Report: Calendar Sharing, Appointments, URL Feeds & Storage Safeguards

## What was built
Group C resolves the remaining incomplete architectural gaps and safeguards across Calendar sharing, public appointment scheduling, external URL subscription lifecycles, and storage quota bounds in webmail:
1. **Calendar Sharing HPKE Key Exchange**: Replaced hardcoded dummy strings (`"shared_cal_key_envelope_v1"`) in `ShareCalendarModal.tsx` with dynamic key exchange utilizing `sealCalendarKeyForGrantee`, X-Wing / X25519 grantee public key directory lookup via `lookupMailboxKeys`, and locked mailbox fail-closed validation.
2. **Appointment Booking Architecture & Bug Fixes**:
   - Timezone selector in `BookingPageView.tsx` cleanly renders `<option value={tz.id}>{tz.label}</option>` instead of `[object Object]`.
   - Wired `/book/:slug` routing in `App.tsx` and bypassed authenticated mailbox probing on public booking links so unauthenticated attendees can book slots without login drop-offs.
   - Fixed cancel booking invocation scope mismatch in `CalendarView.tsx` (`handleDeleteEvent(booking.calendarEventId, "series")`).
   - Fixed missing `uid` in booking `generateIcs` params.
3. **External URL Feeds & Storage Safeguards**:
   - In `urlCalendarStore.ts`, added CORS / network error handling with user-facing guidance to use ICS file import for blocked browser fetches, plus added `refreshDueUrlSubscriptions` and `startUrlFeedAutoRefresh` interval lifecycle methods wired to `CalendarView.tsx`.
   - In `taskStore.ts`, bounded task limits (`MAX_TASKS_PER_MAILBOX = 1000`, `MAX_TASK_LISTS_PER_MAILBOX = 50`), added title/description/tag sanitization, and handled `QuotaExceededError` via completed task pruning.
   - In `calendarTrashStore.ts`, bounded trash limits (`MAX_TRASH_RECORDS = 200`), added attachment URI sanitization, and handled `QuotaExceededError` via oldest record pruning.

## Files edited
| File | Reason |
|------|--------|
| `apps/webmail/src/components/calendar/ShareCalendarModal.tsx` | Wired `sealCalendarKeyForGrantee` using grantee public key from `lookupMailboxKeys`, added locked mailbox validation, active key status checks, and support for Base64/hex key formats |
| `apps/webmail/src/components/calendar/appointments/BookingPageView.tsx` | Fixed timezone select object rendering, wired cancellation token / initial appointment resolution, and passed hostEmail to booking creator |
| `apps/webmail/src/components/calendar/appointments/appointmentStore.ts` | Provided fallback schedule in `findAppointmentByCancellationToken` so attendee appointment management succeeds even if schedule was modified |
| `apps/webmail/src/App.tsx` | Wired `/book` and `/book/:slug` route detection, injected host's `existingEvents` and `settings` into `BookingPageView`, and supported attendee cancellation tokens |
| `apps/webmail/src/components/calendar/CalendarView.tsx` | Wired `startUrlFeedAutoRefresh` lifecycle, connected `onBookingCancelled`, and passed `currentUserEmail` to booking ICS and organizer |
| `apps/webmail/src/components/calendar/url/urlCalendarStore.ts` | Added robust CORS error handling diagnostics, auto-refresh lifecycle, Node.js timer unref, and backoff timestamp updates on failure |
| `apps/webmail/src/components/calendar/url/SubscribeFromUrlModal.tsx` | Preserved user-facing CORS diagnostic error message in preview warning rather than masking with generic copy |
| `apps/webmail/src/components/calendar/tasks/taskStore.ts` | Implemented strict task limits (`MAX_TASKS_PER_MAILBOX = 1000`, `MAX_TASK_LISTS_PER_MAILBOX = 50`), input sanitization, and quota exceeded recovery |
| `apps/webmail/src/components/calendar/trash/calendarTrashStore.ts` | Implemented `MAX_TRASH_RECORDS` bounds, attachment URI sanitization, and quota exceeded recovery |
| `apps/webmail/src/calendar_sharing.test.ts` | Added unit tests for calendar sharing key exchange with KeyDirectoryRecord, locked mailbox fail-closed, and alternative key encodings |
| `apps/webmail/src/calendar_category_11.test.ts` | Added Cat 11.10 unit tests for task storage bounds and quota safeguards |
| `apps/webmail/src/calendar_category_12.test.ts` | Added Cat 12.8 tests for `findAppointmentByCancellationToken` resolution across storage |
| `apps/webmail/src/calendar_category_14.test.ts` | Added Cat 14.7 tests for CORS error handling, URL feed auto-refresh intervals, and failed refresh backoff |
| `apps/webmail/src/calendar_category_15.test.ts` | Added trash storage safeguard tests for oversized attachments and retention bounds |

## Raw evidence

### 1. TypeScript Compilation Verification
Command:
```powershell
cd apps/webmail; npx.cmd tsc --noEmit
```
Output:
```
(Exited with code 0, no errors)
```

### 2. Test Suite Execution
Command:
```powershell
cd apps/webmail; npm.cmd test
```
Output:
```
> test
> npx tsx --experimental-wasm-modules src/run_test.node.js

(node:8532) ExperimentalWarning: Importing WebAssembly modules is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
Running Attachment Crypto Tests...
ATTACHMENT CRYPTO TESTS: 20 passed, 0 failed

Running TOTP Tests...
TOTP TESTS: 5 passed, 0 failed

Running Date Time Tests...
DATE TIME TESTS: 10 passed, 0 failed

Running File Type Tests...
FILE TYPE TESTS: 10 passed, 0 failed

Running Multi-Account & Storage Sync Tests...
MULTI ACCOUNT TESTS: 44 passed, 0 failed

Running Password Rewrap Tests...
PASSWORD REWRAP TESTS: 12 passed, 0 failed

Running Path A Compose Tests...
PATH A COMPOSE TESTS: 11 passed, 0 failed

Running Path A Read Tests...
PATH A READ TESTS: 8 passed, 0 failed

Running MIME Parsing Tests...
MIME TESTS: 11 passed, 0 failed

Running Signature Tests...
SIGNATURE TESTS: 8 passed, 0 failed

Running Reply Signature Tests...
REPLY SIGNATURE TESTS: 7 passed, 0 failed

Running Mbox Streaming Tests...
MBOX STREAM TESTS: 12 passed, 0 failed

Running Mbox Labels Tests...
MBOX LABELS TESTS: 10 passed, 0 failed

Running Import Queue Tests...
IMPORT QUEUE TESTS: 15 passed, 0 failed

Running Threading Tests...
THREADING TESTS: 12 passed, 0 failed

Running Undo Send Tests...
UNDO SEND TESTS: 11 passed, 0 failed

Running Keyboard Shortcuts Tests...
KEYBOARD SHORTCUTS TESTS: 10 passed, 0 failed

Running Snooze Tests...
SNOOZE TESTS: 8 passed, 0 failed

Running Scheduled Folder Tests...
SCHEDULED FOLDER TESTS: 8 passed, 0 failed

Running Display Party Tests...
DISPLAY PARTY TESTS: 10 passed, 0 failed

Running Nested Labels Tests...
NESTED LABELS TESTS: 14 passed, 0 failed

Running API Error Tests...
API ERROR TESTS: 12 passed, 0 failed

Running Unified Inbox Tests...
UNIFIED INBOX TESTS: 18 passed, 0 failed

Running Masked Email Tests...
MASKED EMAIL TESTS: 16 passed, 0 failed

Running Focused Inbox Tests...
FOCUSED INBOX TESTS: 12 passed, 0 failed

Running Offline Sync & Persistence Tests...
OFFLINE PERSISTENCE TESTS: 16 passed, 0 failed

Running Composer Sanitizer Tests...
COMPOSER SANITIZER TESTS: 16 passed, 0 failed

Running Contacts Tests...
CONTACTS TESTS: 12 passed, 0 failed

Running Borderless Sidebar Navigation Tests...
SIDEBAR BORDERLESS TESTS: 14 passed, 0 failed

Running Profile Photo Tests...
PROFILE PHOTO TESTS: 14 passed, 0 failed

Running Persistent Session Tests...
PERSISTENT SESSION TESTS: 10 passed, 0 failed

Running OAuth Import Tests...
OAUTH IMPORT TESTS: 12 passed, 0 failed

Running Calendar RRULE Tests...
CALENDAR RRULE TESTS: 16 passed, 0 failed

Running Calendar Crypto Core Tests...
CALENDAR CRYPTO TESTS: 12 passed, 0 failed

Running Calendar ICS Import/Export Tests...
CALENDAR ICS TESTS: 12 passed, 0 failed

Running Calendar Invitation Repository Tests...
CALENDAR INVITATION REPOSITORY TESTS: 8 passed, 0 failed

Running Calendar Persistence & Privacy Security Tests...
CALENDAR PERSISTENCE SECURITY TESTS: 10 passed, 0 failed

Running Calendar Legacy Event Recovery Tests...
CALENDAR RECOVERY TESTS: 10 passed, 0 failed

Running Historical Key Reactivation & Preflight Tests...
HISTORICAL KEY REACTIVATION TESTS: 13 passed, 0 failed

Running Calendar Recurrence Exceptions & Tombstones Tests...
CALENDAR RECURRENCE EXCEPTION TESTS: 8 passed, 0 failed

Running Calendar External Invitation Tests...
CALENDAR INVITATION EXTERNAL TESTS: 4 passed, 0 failed

Running Calendar Sharing Tests...
CALENDAR SHARING TESTS: 7 passed, 0 failed

Running Calendar Settings Tests...
CALENDAR SETTINGS TESTS: 10 passed, 0 failed

Running Calendar Management Tests...
CALENDAR MANAGEMENT TESTS: 12 passed, 0 failed

Running Calendar Holiday System Tests...
CALENDAR HOLIDAYS TESTS: 12 passed, 0 failed

Running Calendar Year View & Mini-Month Tests...
CALENDAR YEAR VIEW TESTS: 10 passed, 0 failed

Running Calendar Categories 01, 02, and 03 Tests...
CALENDAR CATEGORIES 01, 02, 03 TESTS: 10 passed, 0 failed

Running Calendar Category 04 (Week, Multi-Day and Work-Week Views) Tests...
CALENDAR CATEGORY 04 TESTS: 8 passed, 0 failed

Running Calendar Category 05 (Month View, Timezones & Multi-Calendar Coordination) Tests...
CALENDAR CATEGORY 05 TESTS: 9 passed, 0 failed

Running Calendar Category 06 (Search, Filtering and Calendar Query Engine) Tests...
CALENDAR CATEGORY 06 TESTS: 9 passed, 0 failed

Running Calendar Category 07 (Keyboard Shortcuts, Bulk Operations and Event Modification) Tests...
CALENDAR CATEGORY 07 TESTS: 9 passed, 0 failed

Running Calendar Category 08 (Event Types and Extended Behaviors) Tests...
CALENDAR CATEGORY 08 TESTS: 9 passed, 0 failed

Running Calendar Category 10 (Calendar Recovery and Cryptographic Key Migration) Tests...
CALENDAR CATEGORY 10 TESTS: 9 passed, 0 failed

Running Calendar Category 11 (Reminders, Tasks and Notifications) Tests...
CALENDAR CATEGORY 11 TESTS: 10 passed, 0 failed

Running Calendar Category 12 (Appointment Scheduling and Public Booking Pages) Tests...
CALENDAR CATEGORY 12 TESTS: 9 passed, 0 failed

Running Calendar Category 13 (Email and External Integrations) Tests...
CALENDAR CATEGORY 13 TESTS: 9 passed, 0 failed

Running Calendar Category 14 (Import, Export and Synchronization) Tests...
CALENDAR CATEGORY 14 TESTS: 9 passed, 0 failed

Running Calendar Category 15 (Accessibility, Interface and Offline Experience) Tests...
CALENDAR CATEGORY 15 TESTS: 9 passed, 0 failed

Running Calendar Interval Scheduling & Layout Tests...
CALENDAR INTERVAL & LAYOUT TESTS: All 9 passed, 0 failed

Running Google Keep Notes Feature Tests...
GOOGLE NOTE FEATURE TESTS: All 9 passed, 0 failed

Running Mailbox Unlock & 2FA Persistence Tests...
UNLOCK & 2FA PERSISTENCE TESTS: 5 passed, 0 failed

OVERALL: 556 passed, 0 failed
```

## Manual browser verification
**UNTESTED** on a live production browser deployment due to headless execution environment. To verify manually:
1. Start dev server: `npm run dev` in `apps/webmail/`.
2. Open `http://localhost:3001/book/demo-slug`. Assert that the booking schedule view mounts cleanly with interactive timezone selection and date slots, and does not redirect to the sign-in prompt.
3. Log in as an authenticated user, open Calendar -> Calendars sidebar, click "Share" on a personal calendar. Enter a valid user email and share. Observe that HPKE key exchange seals the calendar key with the recipient's public key.
4. Open Calendar Settings -> Subscriptions, add an external URL feed. In DevTools Network, observe auto-refresh polling at the configured intervals.
5. In localStorage, observe tasks and deleted trash items respecting size bounds (`MAX_TASKS_PER_MAILBOX` and `MAX_TRASH_RECORDS`).

## What did not work or is untested
- Third-party calendar servers that disallow CORS headers cannot be fetched directly in-browser without a dedicated backend CalDAV proxy. As designed, clear error diagnostics now direct users to download the `.ics` file and use the ICS import modal.
- End-to-end multi-user calendar event editing across distinct active browsers in a live clustered environment is unverified outside the automated test harness.
