# Group B Completion Report: Type Integrity, Notes Storage Keys, and Calendar Reminders

## What was built
Completed all Group B items identified in `docs/unfinished_work_investigation_report.md` and resolved all project-wide TypeScript compiler errors:
1. Updated `ConnectedAccount` interface in `apps/webmail/src/api.ts` to allow `mailboxSkHex?: string` and `searchKeyHex?: string` to conform with locked/isolated account state, and updated `App.tsx` lock handler to set `isLocked: true`.
2. Unified storage key routing across all note card quick actions and modal operations in `apps/webmail/src/components/notes/NotesView.tsx` to strictly use `effectiveMailboxId()`, preventing note desynchronization.
3. Moved calendar reminder evaluation loop from `CalendarView.tsx` to `App.tsx` level (with 15s interval, reactive mailbox/module change triggers, and global `<CalendarNotificationBanner>`) so reminders continue firing uninterrupted when users navigate between Mail, Calendar, and Notes. Removed duplicate reminder checks in `CalendarView.tsx` that previously swallowed alerts in `dispatchedLedger`, and wired `selectedCalendarEventId` to open the event in `EventModal` on alert selection.
4. Corrected argument mismatch in `expandEventOccurrences` call within `apps/webmail/src/components/calendar/url/urlCalendarStore.ts` by passing positional parameters and fixing `isAllDay` typing.
5. Resolved missing type imports and type errors across calendar components: `ParsedRRule` in `EventModal.tsx`, `CalendarOverrides` in `CalendarView.tsx`, `ImportSummary` property names (`imported`/`updated`/`skipped`) in `CalendarSettingsPanel.tsx`, and replaced invalid SVG `title` attributes with `<span title="...">` containers in `DayView.tsx`, `WeekView.tsx`, and `MonthView.tsx`.
6. Resolved all TypeScript compilation errors across production and test files so that `npx tsc --noEmit` exits with 0 errors across the entire project.

## Files edited
| File | Reason |
|------|--------|
| `apps/webmail/src/App.tsx` | Added global calendar reminders interval & banner, set isLocked on locked accounts, wired selectedCalendarEventId to CalendarView, and passed onCheckReminders. |
| `apps/webmail/src/api.ts` | Made mailboxSkHex & searchKeyHex optional on ConnectedAccount, exported calendar event input types, added template/description/optional color to UserCalendar, and added has_passkey/is_owner to TwoFactorStatus. |
| `apps/webmail/src/calendar_crypto.ts` | Added optional status, startTime, endTime, and isAllDay fields to CalendarEventPlaintext. |
| `apps/webmail/src/components/calendar/CalendarModal.tsx` | Provided fallback default color when cal.color is undefined. |
| `apps/webmail/src/components/calendar/CalendarSidebar.tsx` | Made status optional on DecryptedEventRecord interface. |
| `apps/webmail/src/components/calendar/CalendarView.tsx` | Imported CalendarOverrides, removed duplicate checkReminders and dead activeAlerts signals to prevent swallowing alerts in dispatchedLedger, added selectedEventId prop and effect, made status optional in handleSaveEvent, and fixed scope and uid arguments. |
| `apps/webmail/src/components/calendar/DayView.tsx` | Wrapped recurring event SVG in a span with title attribute to satisfy JSX SVG typing. |
| `apps/webmail/src/components/calendar/EventModal.tsx` | Imported ParsedRRule from calendarRrule. |
| `apps/webmail/src/components/calendar/MonthView.tsx` | Wrapped recurring event SVG in a span with title attribute to satisfy JSX SVG typing. |
| `apps/webmail/src/components/calendar/WeekView.tsx` | Wrapped recurring event SVGs in a span with title attribute to satisfy JSX SVG typing. |
| `apps/webmail/src/components/calendar/appointments/BookingPageView.tsx` | Rendered timezone option id and label correctly into select options. |
| `apps/webmail/src/components/calendar/appointments/appointmentEngine.ts` | Fixed attendee rsvpStatus to status and reminder method to notification. |
| `apps/webmail/src/components/calendar/settings/CalendarSettingsPanel.tsx` | Corrected ImportSummary property names to imported, updated, and skipped, and fixed url subscription autoRefresh prop. |
| `apps/webmail/src/components/calendar/settings/calendarSettingsStore.ts` | Added note to WorkHoursDateException and eventRemindersDefaultMinutes: 15 to CalendarSettings and DEFAULT_CALENDAR_SETTINGS. |
| `apps/webmail/src/components/calendar/tasks/taskStore.ts` | Coerced null to undefined for scheduledDate to satisfy TaskItem type. |
| `apps/webmail/src/components/calendar/url/urlCalendarStore.ts` | Fixed expandEventOccurrences positional arguments and cleaned up isAllDay on details. |
| `apps/webmail/src/components/notes/NotesView.tsx` | Replaced all props.mailboxId usages with effectiveMailboxId() across note card and modal actions. |
| `apps/webmail/src/utils/calendarContactsIntegration.ts` | Removed format property not in DecryptedEventRecord interface. |
| `apps/webmail/src/utils/calendarIcs.ts` | Used dateObj in formatIcsLocalTime catch block, exported parseIcsText alias, and added reminder method & optional organizer to GenerateIcsParams. |
| `apps/webmail/src/calendar_management.test.ts` | Re-exported CALENDAR_TEMPLATES, CalendarTemplate, and getCalendarTemplate. |
| `apps/webmail/src/calendar_category_06.test.ts` | Added explicit number type annotation to eventReminderOverride. |
| `apps/webmail/src/calendar_recovery.test.ts` | Allowed unknown condition in assert helper and typed closure-captured migration status flags as boolean. |

## Raw evidence

### 1. TypeScript Compiler Whole-Project Verification (`npx tsc --noEmit`)
Command executed:
`cd apps/webmail; npx.cmd tsc --noEmit`

Output:
```
(No errors - exited with code 0)
```

### 2. Test Suite Full Execution (`npm test` in `apps/webmail`)
Command executed:
`cd apps/webmail; npm.cmd test`

Output:
```
OVERALL: 552 passed, 0 failed
```

## Manual browser verification
- Global calendar reminder intervals and the `<CalendarNotificationBanner>` are mounted at the `App.tsx` root and active regardless of the currently selected module (Mail, Calendar, Notes).
- Selecting an alert in the global banner triggers `handleSelectCalendarEventFromAlert`, activating the calendar module and opening the target event in `EventModal`.
- UNTESTED: Background browser tab timer throttling under severe OS battery-saver states and native desktop notification delivery when browser window is minimized without user gesture permissions.

## What did not work or is untested
- URL calendar feed live network fetching against real CORS-restricted third-party CalDAV/ICS endpoints remains subject to Section 2.4 backend proxy implementation (tracked under Group C).
