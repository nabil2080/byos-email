# Comprehensive Investigation Report: Unfinished Work in Webmail Applications

**Date**: 2026-10-30  
**Scope**:
1. **Mail / Mailbox Application** (`apps/webmail/src/App.tsx`, `apps/webmail/src/components/`, `apps/webmail/src/routes/settings/`)
2. **Calendar Application** (`apps/webmail/src/components/calendar/`, `apps/webmail/src/utils/`)
3. **Notes Application** (`apps/webmail/src/components/notes/`)

---

## Executive Summary

A deep forensic investigation was performed across all three webmail applications to locate incomplete implementations, broken user flows, hardcoded stubs, architectural gaps, and compilation discrepancies.

The findings fall into five critical domains:
1. **Cryptographic Boundaries & Security Violations**: Core security features (Calendar sharing HPKE exchange, Notes zero-knowledge encryption, and Tasks/Trash storage) use hardcoded dummy keys, store sensitive data in plaintext `localStorage`, or lack encryption pipelines entirely.
2. **Broken & Dropped User Data**: Email CC/BCC inputs are completely dropped before MIME assembly and envelope generation; Note version restorations are immediately overwritten by stale modal state; Notes attachments exhaust browser `localStorage` quotas causing silent data loss.
3. **TypeScript Compilation Divergence**: While `npm test` executes tests via `tsx` (which strips type annotations without type checking), running `npx tsc --noEmit` reveals over 40 distinct compilation errors across 18 source files.
4. **App Isolation & Lifecycle Failures**: Calendar reminder loops terminate whenever the user switches to Mail or Notes; External calendar URL feeds fail in browsers due to CORS without a backend proxy; Appointment booking links route to login because public `/book/:slug` routing does not exist.
5. **Dead & Phantom Components**: `RightBar.tsx` and `StorageStatusPill.tsx` are imported or retained in the tree but never mounted in JSX.

---

## 1. Application 1: Mail / Mailbox

### 1.1 CC and BCC Form Fields are Non-Functional Stubs
- **Files**: [`apps/webmail/src/components/ComposeDrawer.tsx`](file:///f:/Codex/byos-email/apps/webmail/src/components/ComposeDrawer.tsx#L309-L326), [`apps/webmail/src/App.tsx`](file:///f:/Codex/byos-email/apps/webmail/src/App.tsx#L8190-L8230), [`apps/webmail/src/undo_send.ts`](file:///f:/Codex/byos-email/apps/webmail/src/undo_send.ts#L22-L60)
- **Problem**: In `ComposeDrawer.tsx`, the CC and BCC inputs use fallback empty callbacks `props.onCcChange || (() => {})`. In `App.tsx`, `<ComposeDrawer>` does not pass `cc`, `bcc`, `onCcChange`, or `onBccChange`. Furthermore, `buildMimeString` and `buildPendingSendPayload` accept no CC/BCC parameters.
- **Impact**: Any address typed into CC or BCC is completely dropped before delivery. No envelope recipients or headers are generated for them.

### 1.2 Key Epoch Hardcoded to 1 in Sender Envelope
- **File**: [`apps/webmail/src/App.tsx`](file:///f:/Codex/byos-email/apps/webmail/src/App.tsx#L464-L471)
- **Problem**: When sealing the sender's own copy of an outbound message for the Sent folder, `wasm.wasm_seal_xwing_envelope_signed` is called with hardcoded epoch `1`:
  ```typescript
  1, // TODO: use sender's real key_epoch when rotation is implemented
  ```
- **Impact**: Once key rotation is implemented or if a sender has rotated keys, decrypting sent messages will fail.

### 1.3 Outbound Mock Delivery Public Key in `sealOutboundMessage`
- **File**: [`apps/webmail/src/App.tsx`](file:///f:/Codex/byos-email/apps/webmail/src/App.tsx#L441-L449)
- **Problem**: When `deps.sealSignedEnvelope` dependency injection is supplied, the recipient X-Wing public key is hardcoded to the dummy string `"mock-sender-xwing-pk"`.
- **Impact**: Production code relying on custom envelope sealers sends envelopes sealed to an invalid mock key.

### 1.4 Locking Account Violates `ConnectedAccount` Type Contract
- **File**: [`apps/webmail/src/App.tsx`](file:///f:/Codex/byos-email/apps/webmail/src/App.tsx#L724-L732), [`apps/webmail/src/api.ts`](file:///f:/Codex/byos-email/apps/webmail/src/api.ts#L263-L276)
- **Problem**: `ConnectedAccount.mailboxSkHex` is typed as `string` (required). In `App.tsx`, locking an account sets `{ mailboxSkHex: undefined, searchKeyHex: undefined }`.
- **Impact**: Triggers `TS2769: Types of property 'mailboxSkHex' are incompatible. Type 'undefined' is not assignable to type 'string'`. Downstream functions encounter unexpected `undefined` when reading keys.

### 1.5 Bridge Service Status Indicator is Unconditionally Active
- **File**: [`apps/webmail/src/routes/settings/BridgeTab.tsx`](file:///f:/Codex/byos-email/apps/webmail/src/routes/settings/BridgeTab.tsx#L128-L131)
- **Problem**: Renders a hardcoded green pulsing badge saying "Bridge Service Active" without checking if `localhost:port` or the `byos-bridge` daemon is actually running.
- **Impact**: Misleads users into believing local IMAP/SMTP bridge synchronization is operational when it may be disconnected.

### 1.6 Snooze Limitation: Expired Messages Do Not Re-Appear Until Manual Reload
- **File**: [`apps/webmail/src/snooze.ts`](file:///f:/Codex/byos-email/apps/webmail/src/snooze.ts#L1-L6)
- **Problem**: No active timer or push notification watches for snooze expiration. If a user is viewing the inbox when a snooze expires, the message remains hidden until the page is manually refreshed.

### 1.7 Inactive Folder Unread Counts Stale
- **File**: [`apps/webmail/src/App.tsx`](file:///f:/Codex/byos-email/apps/webmail/src/App.tsx#L6521-L6545)
- **Problem**: `folderCounts()` computes badge numbers solely by iterating over `messages()`, which contains only the messages for the currently open folder.
- **Impact**: Unread badges for Spam, Trash, and Archive show `0` while viewing Inbox.

### 1.8 Pseudo-RFC822 Plaintext EML Export
- **File**: [`apps/webmail/src/components/ReadingPane.tsx`](file:///f:/Codex/byos-email/apps/webmail/src/components/ReadingPane.tsx#L763-L772)
- **Problem**: Export message uses `\n` instead of `\r\n` (RFC 5322), omits Message-ID, MIME structure, boundary definitions, and attachments.

### 1.9 Dead Component: `RightBar.tsx`
- **File**: [`apps/webmail/src/components/RightBar.tsx`](file:///f:/Codex/byos-email/apps/webmail/src/components/RightBar.tsx#L15-L17)
- **Problem**: Returns `null`. Imported in `App.tsx` but never mounted in JSX.

### 1.10 Draft Auto-Save Missing
- **File**: [`apps/webmail/src/App.tsx`](file:///f:/Codex/byos-email/apps/webmail/src/App.tsx#L6138)
- **Problem**: `handleSaveDraft` only triggers on manual click or compose drawer close. No debounced auto-save timer protects against accidental tab closing or crashes.

---

## 2. Application 2: Calendar

### 2.1 Calendar Sharing HPKE Key Exchange Unimplemented
- **Files**: [`apps/webmail/src/components/calendar/ShareCalendarModal.tsx`](file:///f:/Codex/byos-email/apps/webmail/src/components/calendar/ShareCalendarModal.tsx#L71-L75), [`apps/webmail/src/calendar_crypto.ts`](file:///f:/Codex/byos-email/apps/webmail/src/calendar_crypto.ts#L11-L57)
- **Problem**: In `ShareCalendarModal.tsx`, `shareCalendar` sends a hardcoded dummy string:
  ```typescript
  encrypted_key: "shared_cal_key_envelope_v1"
  ```
  `sealCalendarKeyForGrantee` is implemented and tested in `calendar_crypto.ts`, but never invoked in UI code.
- **Impact**: The grantee receives an invalid key payload. When the grantee attempts to decrypt shared calendar events, decryption fails.

### 2.2 Appointment Booking Public Route Missing & `[object Object]` Timezone Select
- **Files**: [`apps/webmail/src/components/calendar/appointments/AppointmentsManagerModal.tsx`](file:///f:/Codex/byos-email/apps/webmail/src/components/calendar/appointments/AppointmentsManagerModal.tsx#L71-L75), [`apps/webmail/src/components/calendar/appointments/appointmentStore.ts`](file:///f:/Codex/byos-email/apps/webmail/src/components/calendar/appointments/appointmentStore.ts#L12-L21), [`apps/webmail/src/components/calendar/appointments/BookingPageView.tsx`](file:///f:/Codex/byos-email/apps/webmail/src/components/calendar/appointments/BookingPageView.tsx#L253-L255)
- **Problems**:
  1. Booking links are generated as `/book/:slug`. `App.tsx` has no route for `/book/:slug`; opening the link lands on the unauthenticated login screen.
  2. Schedules and bookings exist only in the organizer's browser `localStorage`. An external visitor cannot fetch available slots.
  3. In `BookingPageView.tsx`, `<For each={SUPPORTED_TIMEZONES}>` renders objects directly into `<option value={tz}>{tz}</option>`, causing DOM options to render as `[object Object]`.

### 2.3 Reminder Loop Dies When Navigating Away from Calendar
- **Files**: [`apps/webmail/src/components/calendar/CalendarView.tsx`](file:///f:/Codex/byos-email/apps/webmail/src/components/calendar/CalendarView.tsx#L815-L822), [`apps/webmail/src/App.tsx`](file:///f:/Codex/byos-email/apps/webmail/src/App.tsx#L7804-L7850)
- **Problem**: In `CalendarView.tsx`, `checkReminders` runs on a 15-second `setInterval` registered in `onMount` and cleaned up in `onCleanup`. In `App.tsx`, `<CalendarView>` is wrapped in `<Show when={activeModule() === 'calendar'}>`.
- **Impact**: Navigating to Mail or Notes destroys the calendar interval. Reminder notifications stop completely while using the rest of the application.

### 2.4 External URL Calendar Feeds CORS Failure & Missing Auto-Refresh
- **File**: [`apps/webmail/src/components/calendar/url/urlCalendarStore.ts`](file:///f:/Codex/byos-email/apps/webmail/src/components/calendar/url/urlCalendarStore.ts#L106-L111)
- **Problem**: Feeds are fetched directly from the browser with `fetch(url)`. External servers (Google, Apple, Outlook) reject this due to CORS. There is no backend proxy endpoint. Furthermore, `refreshIntervalMinutes` is stored on the feed subscription but never polled by any timer.

### 2.5 Argument Mismatch in `urlCalendarStore.ts`
- **Files**: [`apps/webmail/src/components/calendar/url/urlCalendarStore.ts`](file:///f:/Codex/byos-email/apps/webmail/src/components/calendar/url/urlCalendarStore.ts#L269-L280), [`apps/webmail/src/utils/calendarRrule.ts`](file:///f:/Codex/byos-email/apps/webmail/src/utils/calendarRrule.ts#L183-L193)
- **Problem**: `expandEventOccurrences` takes positional arguments `(baseId, eventStart, eventEnd, rruleStr, windowStart, windowEnd)`. `urlCalendarStore.ts` passes an object as argument 1, causing `TS2554: Expected 6-9 arguments, but got 3` and crashing URL feed recurring event expansion.

### 2.6 Tasks Stored Unencrypted in `localStorage`
- **File**: [`apps/webmail/src/components/calendar/tasks/taskStore.ts`](file:///f:/Codex/byos-email/apps/webmail/src/components/calendar/tasks/taskStore.ts#L79-L82)
- **Problem**: Tasks, descriptions, and subtasks are stored in unencrypted JSON in browser `localStorage`. There is no zero-knowledge encryption using `mailboxKey` and no backend sync endpoint.

### 2.7 Plaintext Leakage in Deleted Event Trash Subsystem
- **File**: [`apps/webmail/src/components/calendar/trash/calendarTrashStore.ts`](file:///f:/Codex/byos-email/apps/webmail/src/components/calendar/trash/calendarTrashStore.ts#L91-L113)
- **Problem**: When an event is deleted from the server, its plaintext decrypted representation (`title`, `description`, `location`, attendees) is written to `localStorage` under `byos_calendar_trash_<mailboxId>`.

### 2.8 Recurring Event Exception Offline Sync Missing
- **Files**: [`apps/webmail/src/components/calendar/CalendarView.tsx`](file:///f:/Codex/byos-email/apps/webmail/src/components/calendar/CalendarView.tsx#L1182-L1200), [`apps/webmail/src/components/calendar/offline/calendarOfflineSync.ts`](file:///f:/Codex/byos-email/apps/webmail/src/components/calendar/offline/calendarOfflineSync.ts#L22)
- **Problem**: Modifying a single occurrence (`scope === 'this'`) does not check `isOnline()` or queue offline actions. Modifying a recurring occurrence offline throws an unhandled network error and loses the edit.

### 2.9 ICS Import Summary Property Name Bug
- **Files**: [`apps/webmail/src/components/calendar/settings/CalendarSettingsPanel.tsx`](file:///f:/Codex/byos-email/apps/webmail/src/components/calendar/settings/CalendarSettingsPanel.tsx#L2582-L2584), [`apps/webmail/src/utils/calendarImportExport.ts`](file:///f:/Codex/byos-email/apps/webmail/src/utils/calendarImportExport.ts#L46-L52)
- **Problem**: `ImportSummary` defines `imported`, `updated`, and `skipped`. `CalendarSettingsPanel.tsx` reads `importedCount`, `updatedCount`, and `skippedCount`. Displays `Successfully imported undefined event(s)`.

### 2.10 Cancel Booking Invocation Scope Argument Mismatch
- **File**: [`apps/webmail/src/components/calendar/CalendarView.tsx`](file:///f:/Codex/byos-email/apps/webmail/src/components/calendar/CalendarView.tsx#L2268)
- **Problem**: `handleDeleteEvent(booking.calendarEventId, allCalendars()[0]?.id || '')` passes a calendar UUID where `"occurrence" | "series"` is expected. Causes the delete scope check to fail and trigger series deletion behavior unexpectedly.

### 2.11 Missing `uid` in Booking `generateIcs`
- **File**: [`apps/webmail/src/components/calendar/CalendarView.tsx`](file:///f:/Codex/byos-email/apps/webmail/src/components/calendar/CalendarView.tsx#L2330-L2338)
- **Problem**: `generateIcs` requires `uid: string`. The invocation omits `uid`, causing compiler error `TS2345`.

### 2.12 Missing Core Type Imports in Calendar Components
- **Files**:
  - `EventModal.tsx:521-522`: Missing `ParsedRRule` import (`TS2304`).
  - `CalendarView.tsx:736`: Missing `CalendarOverrides` import (`TS2304`).
  - `calendarOfflineSync.ts:15-16`: Imports non-existent `CreateCalendarEventInput` from `api.ts` (`TS2724`).

---

## 3. Application 3: Notes

### 3.1 Zero-Knowledge Encryption Completely Missing
- **Files**: [`apps/webmail/src/components/notes/notesStore.ts`](file:///f:/Codex/byos-email/apps/webmail/src/components/notes/notesStore.ts#L260), [`apps/webmail/src/App.tsx`](file:///f:/Codex/byos-email/apps/webmail/src/App.tsx#L7855-L7875), [`apps/webmail/src/components/notes/NotesView.tsx`](file:///f:/Codex/byos-email/apps/webmail/src/components/notes/NotesView.tsx#L36-L65)
- **Problem**: UI welcome copy promises:
  ```typescript
  "Capture thoughts, checklists, meeting briefs, and daily reminders with zero-knowledge encryption."
  ```
  In reality, notes, drawings, checklist items, and revisions are stored in unencrypted JSON in browser `localStorage`. No cryptographic keys are passed to `<NotesView>`, and no functions from `byos_crypto_core` or `message_crypto` are ever called.

### 3.2 Server Persistence / Backend Sync Missing
- **File**: [`apps/webmail/src/api.ts`](file:///f:/Codex/byos-email/apps/webmail/src/api.ts)
- **Problem**: There are zero backend endpoints for Notes (`POST/GET/PUT/DELETE /v1/mailboxes/{id}/notes`). Notes exist entirely in a single browser instance and cannot sync across devices or sessions.

### 3.3 Inconsistent Storage Key Routing in `NotesView.tsx`
- **Files**: [`apps/webmail/src/components/notes/NotesView.tsx`](file:///f:/Codex/byos-email/apps/webmail/src/components/notes/NotesView.tsx#L483), [`apps/webmail/src/components/notes/notesStore.ts`](file:///f:/Codex/byos-email/apps/webmail/src/components/notes/notesStore.ts#L130-L132)
- **Problem**: Card handlers pass `props.mailboxId` directly while the edit modal and creation handlers use `effectiveMailboxId()`. If `props.mailboxId` is undefined while `props.selectedMailbox?.id` is defined, card color and reminder updates write to `"byos_notes_local_default"`, while creation and edits write to `"byos_notes_<id>"`, causing note desynchronization.

### 3.4 Version History Restoration Destroyed on Modal Close
- **File**: [`apps/webmail/src/components/notes/NotesView.tsx`](file:///f:/Codex/byos-email/apps/webmail/src/components/notes/NotesView.tsx#L1584-L1590, L567-L589)
- **Problem**: When a user restores a prior version from the Version History dialog, `restoreNoteVersion()` updates `notesStore`. However, the open Edit Note modal's input signals (`editTitle()`, `editContent()`, `editChecklistItems()`) retain the pre-restoration values. When the user closes the modal, `handleSaveEdit()` executes and immediately overwrites the restored version with the stale modal inputs.

### 3.5 Unbounded `localStorage` Quota Depletion & Silent Data Loss
- **File**: [`apps/webmail/src/components/notes/notesStore.ts`](file:///f:/Codex/byos-email/apps/webmail/src/components/notes/notesStore.ts#L301-L305, L455-L485, L530-L550)
- **Problem**: Images and drawings are embedded as full base64 strings in `note.drawings` and `note.images`. On every modification, `saveNoteVersion` deep-copies the entire note—including all prior base64 images—into `versionHistory`.
- **Impact**: 2–3 photos rapidly exceed the ~5MB `localStorage` browser limit. `saveNotes` catches `QuotaExceededError` and logs a warning with no UI feedback. All subsequent note edits are silently dropped.

### 3.6 DrawingModal Canvas Uninitialized on Open
- **Files**: [`apps/webmail/src/components/notes/DrawingModal.tsx`](file:///f:/Codex/byos-email/apps/webmail/src/components/notes/DrawingModal.tsx#L50-L54), [`apps/webmail/src/components/notes/NotesView.tsx`](file:///f:/Codex/byos-email/apps/webmail/src/components/notes/NotesView.tsx#L1567-L1574)
- **Problem**: `DrawingModal` is rendered unconditionally with `isOpen={isDrawingModalOpen()}` (initially `false`). Its `onMount` checks `if (props.isOpen) initCanvas()`. Because `props.isOpen` is `false` on initial mount, `initCanvas()` never runs when the user later opens the modal. The canvas has no white background and the undo history stack is never initialized.

### 3.7 Formatting Toolbar Wraps Entire Note Instead of Selection
- **File**: [`apps/webmail/src/components/notes/NotesView.tsx`](file:///f:/Codex/byos-email/apps/webmail/src/components/notes/NotesView.tsx#L1037-L1065)
- **Problem**: Clicking Bold executes `setNewContent((c) => '**${c || "bold text"}**')`, wrapping the entire note in `**`, ignoring selected text and cursor position. The edit note modal lacks a formatting toolbar entirely.

### 3.8 Composer History Out-of-Bounds Indexing Bug
- **File**: [`apps/webmail/src/components/notes/NotesView.tsx`](file:///f:/Codex/byos-email/apps/webmail/src/components/notes/NotesView.tsx#L288-L293)
- **Problem**: When `next.length > 20`, `next.slice(-20)` creates an array of length 20 (indices 0..19), but `setComposerHistoryIdx(next.length - 1)` sets the index to 20 or higher. Causes out-of-bounds array reads and breaks undo/redo.

### 3.9 Note Edit Modal Missing Crucial Management Actions
- **File**: [`apps/webmail/src/components/notes/NotesView.tsx`](file:///f:/Codex/byos-email/apps/webmail/src/components/notes/NotesView.tsx#L1793-L1995)
- **Problem**: The edit note modal provides no UI to:
  - Add or edit reminders
  - Add or view collaborators
  - Toggle checklist mode
  - Duplicate note
  - Archive or unarchive note

### 3.10 Dead Collaborator Popover Signal
- **File**: [`apps/webmail/src/components/notes/NotesView.tsx`](file:///f:/Codex/byos-email/apps/webmail/src/components/notes/NotesView.tsx#L131)
- **Problem**: `activeCollabCardId` is declared but never referenced in JSX. Existing note cards have no button to add collaborators. In the composer, adding a collaborator merely appends a string to a local array without sending invites or sharing cryptographic keys.

### 3.11 Zero Cross-Application Integration & Data Portability
- **Problem**: Notes cannot be exported to Markdown, plaintext, or JSON, nor imported from Google Keep or Evernote. Notes cannot be attached to emails or linked to calendar events.

---

## 4. TypeScript Compiler Divergence Evidence

Running `npx tsc --noEmit` demonstrates that type errors exist in production source files even while `npm test` passes:

```
src/App.tsx(729,28): error TS2769: No overload matches this call.
  Types of property 'mailboxSkHex' are incompatible. Type 'undefined' is not assignable to type 'string'.
src/components/calendar/appointments/BookingPageView.tsx(254,34): error TS2322: Type 'TimeZoneOption' is not assignable to type 'string | number | string[] | undefined'.
src/components/calendar/CalendarView.tsx(736,40): error TS2304: Cannot find name 'CalendarOverrides'.
src/components/calendar/CalendarView.tsx(2268,64): error TS2345: Argument of type 'string' is not assignable to parameter of type '"occurrence" | "series" | undefined'.
src/components/calendar/CalendarView.tsx(2330,45): error TS2345: Argument of type '{ ... }' is not assignable to parameter of type 'GenerateIcsParams'.
  Property 'uid' is missing in type '{ ... }' but required in type 'GenerateIcsParams'.
src/components/calendar/EventModal.tsx(521,60): error TS2304: Cannot find name 'ParsedRRule'.
src/components/calendar/offline/calendarOfflineSync.ts(15,3): error TS2724: '"../../../api"' has no exported member named 'CreateCalendarEventInput'.
src/components/calendar/settings/CalendarSettingsPanel.tsx(2582,66): error TS2339: Property 'importedCount' does not exist on type 'ImportSummary'.
src/components/calendar/url/urlCalendarStore.ts(269,29): error TS2554: Expected 6-9 arguments, but got 3.
```
