# BYOS Calendar — Product & Implementation Roadmap

**Document type:** Product scope and implementation roadmap  
**Status:** Proposed master roadmap  
**Audience:** Product owner, Antigravity, engineering and QA  
**Scope:** BYOS Calendar feature set, settings experience, integrations and release acceptance

---

## 1. Purpose

This document defines the intended feature scope and implementation sequence for BYOS Calendar. It uses Google Calendar as a broad product reference while defining a BYOS-specific implementation that respects the platform's privacy, encryption and business-email architecture.

The goal is not to reproduce every Google-only feature. The goal is to deliver a complete, coherent calendar product with:

- A central Settings experience where users can manage calendar behavior and preferences.
- Multiple personal, shared, subscribed and system-provided calendars.
- Regional, religious, alternate and special-interest calendars.
- Reliable event, recurrence, reminder and invitation behavior.
- Collaboration, availability and appointment scheduling.
- Tasks and productivity features.
- Import, export, subscriptions and synchronization.
- Accessibility, offline behavior and a polished calendar experience.

A category is complete only when its user interface, behavior, persistence, permissions, privacy controls and relevant tests work together. A settings screen or visual mockup alone does not count as implementation.

## 2. Product principles

1. **Privacy by default.** Private event content remains encrypted according to the existing BYOS calendar architecture.
2. **Explicit sharing.** Sharing event details must require a deliberate user-authorized permission and cryptographic-access flow. Organization administrators must not gain silent access to private calendar contents.
3. **No plaintext fallback.** A locked mailbox or unavailable encryption key must never cause private event content to be saved as plaintext or Base64-encoded JSON.
4. **User control.** Users can choose which calendars, holidays, notifications, integrations and productivity features they enable.
5. **Predictable time behavior.** Event times and recurrence must remain correct across time zones, daylight-saving transitions and travel.
6. **Interoperability.** ICS import/export and external calendar subscriptions must preserve as much supported event and recurrence semantics as possible.
7. **Bounded implementation.** Work is delivered one category at a time against explicit acceptance criteria. Avoid unrelated refactoring and repeated broad audits.
8. **Honest compatibility claims.** Do not claim full RFC 5545, CalDAV, offline or external-provider compatibility unless it has been implemented and tested.

## 3. Current baseline and known gaps

This baseline reflects implementation reports and code-inspection summaries previously shared in the project conversation. It is not a fresh repository audit. Antigravity must verify the current working tree before changing code.

| Area | Known baseline | Roadmap treatment |
|---|---|---|
| Day, week, month and year views | Reported implemented | Preserve and regression-test |
| Event create, edit, delete and drag/drop | Reported implemented | Preserve and complete edge cases |
| Multiple calendars and colours | Reported implemented | Expand management and permissions |
| Recurrence engine | Work in progress; detached exceptions identified as a gap | Finish current work first |
| Time-zone behavior | Partial; full `VTIMEZONE` generation and DST interoperability were identified as gaps | Dedicated workstream |
| ICS import/export | Basic implementation reported; recurrence and timezone interoperability remain incomplete | Expand and test |
| Invitations and RSVP | Partial; external SMTP invitation flow not fully verified | Complete end-to-end |
| Event private-field encryption | Implemented in reported architecture | Preserve and test every new feature path |
| Holiday catalogue | Not established as implemented | Build |
| Religious holiday subscriptions | Not established as implemented | Build |
| Alternate calendars and moon phases | Not established as implemented | Build |
| Sports calendar catalogue | Not established as implemented | Build |
| Birthday calendar/contact integration | Not established as complete | Build or explicitly defer |
| Shared calendars and granular sharing | Not established as complete | Build with cryptographic access controls |
| Working hours, focus time and working location | Not established as complete | Build |
| Tasks | Not established as complete | Build |
| Appointment booking | Not established as complete | Build |
| Email-to-calendar intelligence | Not established as complete | Build with client-side privacy controls |
| CalDAV | Reported not implemented | Separate synchronization workstream |
| Offline calendar | Not established as complete | Build and specify supported operations |
| Settings framework comparable to Google Calendar | Not established as complete | Build as a foundational category |

**Status vocabulary:**
- **Implemented (reported):** Existing reports say the feature exists. It still needs regression coverage as dependent work is added.
- **In progress:** An implementation task has already been started and should be completed before being reopened or redesigned.
- **Not established:** Available reports do not prove the feature is complete. Verify the repository before implementing it.
- **Deferred:** Explicitly outside the current category or release gate; retain it in this roadmap rather than silently dropping it.

## 4. Settings information architecture

BYOS Calendar should have one central Settings experience with a persistent navigation sidebar and a content panel. Settings must be discoverable, searchable, accessible and consistent across desktop and mobile.

### 4.1 Proposed global Settings navigation

1. General
   - Language and region
   - Date and time formats
   - Week and working-week preferences
   - Default calendar behavior
2. Event settings
   - Default event duration
   - Default calendar
   - Default event visibility
   - Guest permissions and event defaults
3. Notification settings
   - Event reminders
   - Invitation and RSVP notifications
   - Task notifications
   - Per-calendar notification defaults
4. View options
   - Default view
   - Weekends and week numbers
   - Event display and density
   - Alternate calendar display
5. Time zones and world clock
   - Primary time zone
   - Additional time zones
   - Automatic location-based time-zone update, with consent
   - World clock cities and labels
6. Working hours and location
   - Working days and hours
   - Multiple work periods
   - Working location
   - Out-of-office defaults
7. Privacy and sharing
   - Default event visibility
   - Calendar sharing defaults
   - Free/busy visibility
   - Connected access and consent
8. Integrations
   - BYOS Mail
   - Contacts and birthdays
   - Video conferencing
   - External calendar connections
9. Keyboard shortcuts and accessibility
10. Offline and synchronization

### 4.2 Separate calendar-management areas

These are not global preferences and should not be mixed into the Settings sidebar:

- **My calendars:** owned calendars and each calendar's individual settings.
- **Other calendars:** shared calendars, subscribed calendars and external feeds.
- **Add calendar:** create calendar, explore calendars and subscribe by URL.
- **Import & export:** import/export files and manage supported synchronization connections.

### 4.3 Three levels of configuration

Every preference must belong to the correct level:

- **Global preference:** applies to the user's calendar experience, for example date format or default view.
- **Calendar-level setting:** applies to one calendar, for example its name, colour, sharing permissions or default reminders.
- **Event-level setting:** applies to one event, for example visibility, event time zone or a specific reminder.

Avoid duplicate controls that disagree with each other. Define precedence when a global default, calendar default and event-specific override all exist.

---

# 5. Feature categories

Each category below is an independent implementation workstream with its own acceptance gate.

## Category 01 — Calendar Settings Framework

**Priority:** Foundation  
**Dependencies:** Existing authentication, user preferences and calendar UI

### Scope

- Build the Settings page layout with persistent navigation and a selected-settings content panel.
- Provide responsive desktop and mobile layouts.
- Add settings search or filtering.
- Provide consistent controls: toggles, selectors, text inputs, colour pickers, time inputs and multi-select controls.
- Persist preferences to the correct user or calendar scope.
- Restore preferences across reloads and supported devices.
- Provide clear saved, saving and error states.
- Support autosave or explicit save consistently; do not mix patterns unpredictably.
- Add restore-defaults behavior where appropriate, with confirmation for destructive resets.
- Provide an extensible settings registry so new categories can add settings without redesigning the page.
- Enforce permission-aware settings visibility and editability.

### Acceptance criteria

- The complete proposed Settings navigation is usable and accessible.
- A setting can be changed, saved, reloaded and restored correctly.
- Global, calendar-level and event-level preferences are stored separately.
- Failed saves are visible and do not falsely display success.
- Settings work on supported desktop and mobile layouts.
- No empty or decorative settings controls are presented as functional.

## Category 02 — Calendar Management

**Priority:** High  
**Dependencies:** Category 01

### Scope

- Create, rename, describe, colour and delete calendars.
- Support primary and additional calendars.
- Support useful templates or suggested types such as Personal, Family, Team and Project, without making templates restrictive.
- Set and change the default calendar for new events.
- Show, hide and enable/disable calendars without deleting them.
- Configure individual calendar settings.
- Configure per-calendar notification defaults.
- Display ownership and access status.
- Manage owned, shared and subscribed calendars distinctly.
- Unsubscribe from an external calendar without deleting its source.
- Define safe deletion and ownership-transfer behavior.

### Acceptance criteria

- Users can manage the full lifecycle of calendars they own.
- Shared and subscribed calendars cannot be mistaken for owned calendars.
- Calendar visibility changes do not delete data.
- Deletion and unsubscribe operations clearly explain their effect.
- Calendar ownership, mailbox isolation and access permissions are enforced by the API.

## Category 03 — Holiday and Religious Calendars

**Priority:** High  
**Dependencies:** Categories 01, 02 and 05

### Scope

**Regional holidays**
- Browse supported countries and regions.
- Subscribe to and unsubscribe from a country's holiday calendar.
- Support public-holidays-only and public-holidays-plus-observances choices where the data source allows it.
- Preview a holiday calendar before subscribing.
- Hide or restore individual holiday entries where supported.
- Set the holiday calendar colour.
- Refresh calendar data from the provider.

**Religious holidays**
- Provide a catalogue of traditions for which reliable data is available, initially evaluating Islam, Christianity, Hinduism, Buddhism and Judaism.
- Allow independent subscription and visibility controls for each supported tradition.
- Distinguish fixed-date, calculated and observational/provisional dates.
- Explain regional differences where dates may vary by country or local observation.

**Regional focus**
- Include Bangladesh as an important initial country catalogue.
- Design the provider interface so additional countries can be added without hardcoding each country into the UI.

### Acceptance criteria

- Users can discover, preview, subscribe, hide and unsubscribe from supported holiday calendars.
- Holiday events are provided as read-only provider data unless the product explicitly supports user annotations.
- Provider attribution and last-updated information are available.
- Provisional or observational dates are labelled honestly.
- Duplicate subscriptions are prevented.
- Holiday data does not become plaintext private user-event data or bypass calendar permissions.

## Category 04 — Alternate and Special Calendars

**Priority:** Medium  
**Dependencies:** Categories 01, 02 and 05

### Scope

**Alternate date systems**
- Evaluate and support alternate calendar display systems such as Hijri, Hebrew, Chinese, Indian, Korean and Persian calendars.
- Evaluate Bengali calendar display as a regional enhancement.
- Define whether each system is a secondary date display, a subscribed event calendar, or both.
- Support conversion and date display without altering the underlying event instant or local date semantics.

**Special-interest calendars**
- Moon phases, including new moon, first quarter, full moon and last quarter.
- Sports calendars, initially evaluating cricket, football, basketball, hockey and rugby.
- Additional public calendar feeds where licensing and data quality permit.

### Acceptance criteria

- Users can enable, disable and configure supported alternate displays.
- Alternate dates do not change the stored Gregorian event instant.
- Special-interest calendars can be subscribed to and removed cleanly.
- Data source, update frequency and regional applicability are documented.
- No sport, religious tradition or alternate calendar is advertised before a reliable source is available.

## Category 05 — Language, Region and Time Management

**Priority:** Critical foundation  
**Dependencies:** Category 01; supports Categories 03, 04, 06, 07 and 12

### Scope

**Language and region**
- Application language.
- Country/region preference.
- Date format.
- 12-hour and 24-hour time format.
- First day of week.
- First week-of-year convention.
- Regional number and text formatting as applicable.

**Time zones**
- Primary time zone.
- Additional time zones.
- Per-event time zone.
- Optional automatic time-zone update based on location, with explicit consent and clear controls.
- Time-zone labels and display preferences.
- Daylight-saving transition handling.
- Correct recurring-event local-time preservation.
- Time-zone data updates and behavior when rules change.

**World clock**
- Add and remove cities.
- Display city labels and current local times.
- Reorder and manage the city list.

**Alternate dates**
- Integrate with Category 04 without changing the canonical event storage model.

### Acceptance criteria

- A change of display time zone does not unintentionally move an event's intended instant or recurring local time.
- DST boundary tests cover skipped and repeated local times.
- ICS time-zone data is preserved or converted according to documented rules.
- Location-based updates are opt-in and do not silently access location.
- Date, time and week conventions are applied consistently across the calendar UI, event editor, reminders and exports.

## Category 06 — Event Creation and Management

**Priority:** Critical  
**Dependencies:** Categories 01, 02 and 05

### Scope

- Create, view, edit, delete, copy and duplicate events.
- Quick event creation.
- All-day and timed events.
- Event title, description, location and meeting URL.
- Event-specific time zone.
- Event colour and calendar assignment.
- Guests and attendee management.
- Event privacy/visibility controls.
- Guest permissions, including whether guests can modify events, invite others or view guest lists.
- Event attachments, subject to secure storage design.
- Event templates or reusable defaults where useful.
- Event-specific reminder overrides.
- Undo or recovery for accidental edits/deletions where supported.
- Search and filtering across accessible calendars.

### Acceptance criteria

- Event operations work after reload and across supported views.
- All private event content is encrypted before persistence.
- Locked mailboxes fail closed.
- Event permissions are checked by the backend, not only hidden in the UI.
- Attachments do not expose private content through public or guessable URLs.
- Event-level settings correctly override global and calendar defaults.

## Category 07 — Recurrence and Advanced Scheduling Rules

**Priority:** Critical  
**Status:** In progress; complete the current implementation before starting unrelated calendar work.

### Scope

- Daily, weekly, monthly and yearly recurrence.
- Custom interval and selected-weekday rules.
- COUNT and UNTIL end conditions.
- Excluded dates and supported additional recurrence dates.
- Persistent detached modified occurrences.
- Persistent cancelled occurrences.
- Stable original recurrence identity when an occurrence is moved.
- Edit one occurrence, the entire series, and this-and-following occurrences if supported by the UI.
- Preserve or explicitly reconcile exceptions when the master series changes.
- Remove orphaned exceptions when a series is deleted.
- Bounded and deterministic recurrence expansion.
- Recurrence integration with timezone and ICS behavior.

### Acceptance criteria

- A single occurrence can be moved, edited and cancelled without corrupting the master series.
- Detached exceptions and cancellations survive reload, range navigation and ICS round trips within the supported compatibility scope.
- Series edits preserve or deliberately reconcile exceptions.
- Series deletion leaves no visible orphaned occurrences.
- Recurrence expansion is bounded and tested at date boundaries.
- Event private fields remain encrypted in master and exception records.

## Category 08 — Notifications and Reminders

**Priority:** High  
**Dependencies:** Categories 02, 06 and 07; invitation notices also depend on Category 09

### Scope

- Global default event reminders.
- Per-calendar reminder defaults.
- Per-event reminder overrides.
- Multiple reminders per event where supported.
- Email, browser and desktop notification channels where supported by the platform.
- Mobile notifications if/when a mobile client exists.
- All-day event reminder timing.
- Invitation received, updated and cancelled notifications.
- RSVP response notifications.
- Task and overdue-task notifications.
- Snooze, dismiss and mark-read behavior.
- Notification quiet hours and channel preferences where appropriate.

### Acceptance criteria

- Notifications are delivered at the expected time across time zones and DST changes.
- Duplicate reminders are prevented after retries or synchronization.
- Per-event and per-calendar preferences override global defaults predictably.
- Unsupported delivery channels are visibly unavailable rather than simulated as working.
- Notification content respects event privacy and lock state.

## Category 09 — Calendar Sharing and Collaboration

**Priority:** High  
**Dependencies:** Categories 02, 05, 06 and BYOS key-sharing architecture

### Scope

- Share calendars with individual users and supported groups.
- Define permission levels such as free/busy only, event details read-only, modify events and manage sharing.
- Share with organization members only where permitted by the product's security model.
- Public publishing only if deliberately designed and clearly warned about.
- Revoke and change access.
- Shared Family, Team and Project calendar workflows.
- Calendar invitations and membership management.
- Ownership and transfer flows where supported.
- Private-event handling and free/busy-only disclosure.

### BYOS privacy requirements

- Sharing event details requires explicit user authorization and appropriate cryptographic key access.
- Organization administrators must not obtain automatic decryption access.
- Free/busy sharing must disclose only the intended availability information.
- Revocation behavior and its limits must be documented; do not claim already-downloaded plaintext can be remotely erased.

### Acceptance criteria

- Every permission level is enforced by API and client behavior.
- Unauthorized users cannot read private event ciphertext through an alternative endpoint or calendar path.
- Sharing and revocation are tested across separate mailboxes and tenants.
- Event details are not decrypted for a recipient who has not received authorized key access.

## Category 10 — Working Hours, Availability and Productivity Status

**Priority:** High  
**Dependencies:** Categories 05, 06 and 09

### Scope

- Working days and hours.
- Multiple working periods per day.
- Date-specific exceptions to working hours.
- Working location, such as home, office or a user-defined location.
- Out-of-office events and status.
- Optional automatic invitation declines during configured out-of-office periods.
- Focus-time blocks.
- Free/busy availability rules.
- Availability sharing preferences.
- Meeting availability windows.

### Acceptance criteria

- Working hours are interpreted in the configured time zone.
- Date-specific exceptions override ordinary working hours.
- Free/busy disclosure does not expose private event titles or details.
- Automatic declines are transparent, configurable and idempotent.
- Focus time and working location are distinguishable from ordinary meetings.

## Category 11 — Tasks and Personal Productivity

**Priority:** Medium-high  
**Dependencies:** Categories 01, 05, 08 and calendar view infrastructure

### Scope

- Create and edit tasks.
- Task lists.
- Titles, descriptions and due dates.
- Optional scheduled date/time.
- Repeating tasks.
- Complete, reopen and delete tasks.
- Task reminders and overdue indicators.
- Show/hide tasks in calendar views.
- Synchronize task state across supported devices.

### Acceptance criteria

- Tasks are distinct data objects, not ordinary calendar events with a special label.
- Completion and recurrence state persist correctly.
- Task reminders respect user preferences and time zones.
- Tasks can be filtered and displayed without corrupting event behavior.

## Category 12 — Appointment Scheduling and Booking Pages

**Priority:** Medium-high  
**Dependencies:** Categories 05, 06, 08, 09 and 10

### Scope

- Create appointment schedules.
- Public or private booking links with clear access controls.
- Embeddable booking page where supported.
- Configurable availability windows.
- Appointment duration.
- Minimum scheduling notice.
- Maximum advance booking window.
- Buffer periods before/after appointments.
- Maximum daily appointments.
- Date-specific availability exceptions.
- Conflict detection against calendars the user has authorized the scheduler to inspect.
- Booking confirmation, cancellation and rescheduling.
- Email notifications.

### Acceptance criteria

- Booking prevents conflicting appointments under concurrent requests.
- Availability respects time zones, working hours and out-of-office periods.
- Public booking pages disclose only the minimum required information.
- Users can revoke or pause booking links.
- Cancellation and rescheduling update the calendar and notify affected participants.

## Category 13 — Email and External Integrations

**Priority:** Medium-high  
**Dependencies:** Categories 06, 08, 09 and 14

### Scope

**BYOS Mail integration**
- Detect supported travel reservations, hotel bookings, restaurant reservations, tickets and event registrations.
- Suggest event creation from supported messages.
- Link a calendar event to its source email.
- Support user approval before creating an event.
- Update or remove generated events when a supported source message changes, where reliable.
- Allow users to disable individual extraction categories or all automatic suggestions.

**Other integrations**
- Contacts and birthday information.
- Video-conferencing providers.
- External productivity applications through explicitly supported integrations.
- Resource or room systems where supported.

### Privacy requirements

- Prefer client-side analysis where practical so decrypted email content does not need to be sent to a server for extraction.
- Do not send mailbox passwords, private keys or decrypted message contents to third-party services without explicit, informed authorization.
- Clearly label suggested events and their source.

### Acceptance criteria

- Suggestions are reviewable and do not silently create misleading events.
- Duplicate source messages do not create duplicate events.
- Users can disable and revoke integrations.
- Integration failures do not corrupt calendar data.

## Category 14 — Import, Export and Synchronization

**Priority:** High  
**Dependencies:** Categories 05, 06 and 07; sharing and identity dependencies for CalDAV

### Scope

**ICS import/export**
- Import and export events and calendars.
- Preserve UIDs and supported metadata.
- Preserve RRULE, EXDATE, RDATE and RECURRENCE-ID semantics where supported.
- Preserve or correctly convert time-zone information.
- Detect duplicates and conflicting imports.
- Validate untrusted files and enforce size/complexity limits.

**External calendar subscriptions**
- Subscribe to public ICS/ webcal feeds.
- Refresh feeds on a controlled schedule.
- Show last successful refresh and errors.
- Pause, refresh and unsubscribe.
- Clearly distinguish read-only subscriptions from owned calendars.

**CalDAV**
- Treat two-way CalDAV synchronization as a separate protocol implementation from read-only ICS subscriptions.
- Define supported authentication and client compatibility.
- Implement synchronization tokens, conflict handling and retry behavior as appropriate.
- Document server and client limitations.

### Acceptance criteria

- ICS round trips preserve supported event, recurrence and exception behavior.
- Invalid or malicious input is rejected safely.
- Feed refresh does not duplicate events or delete unrelated local events.
- Subscription errors are visible and recoverable.
- CalDAV is not marked complete until a real interoperable client test passes.

## Category 15 — Accessibility, Interface and Offline Experience

**Priority:** Medium-high  
**Dependencies:** Core calendar view and preference infrastructure

### Scope

**Views and display**
- Day, week, work week, month, year, agenda and custom range where supported.
- Mini calendar.
- Show/hide weekends.
- Week numbers.
- Show/hide declined events.
- Compact and comfortable density.
- Event display preferences and colours.
- Print-friendly calendar views.

**Navigation and accessibility**
- Keyboard shortcuts and shortcut reference.
- Keyboard-only navigation.
- Screen-reader labels and announcements.
- Predictable focus management.
- Contrast and reduced-motion support.
- Responsive desktop and mobile layouts.

**Offline and synchronization**
- View previously synchronized calendar data offline.
- Clearly indicate stale/offline state.
- Define which edits, if any, can be queued offline.
- Synchronize queued changes when connectivity returns.
- Detect and resolve conflicts safely.
- Never claim an offline change is saved to the server before synchronization succeeds.

**Data recovery and convenience**
- Deleted-event trash and restoration, if adopted in the product design.
- Undo accidental changes where safe.
- Print calendar and selected date ranges.

### Acceptance criteria

- Core navigation and event operations are accessible without a mouse.
- Screen-reader behavior is tested on supported browsers.
- Offline capability and its limits are clearly communicated.
- Reconnection does not duplicate events or silently overwrite newer changes.
- Print layouts are readable and preserve timezone/date information.

---

# 6. Recommended implementation sequence

The categories are numbered by product structure, but the implementation sequence below also accounts for dependencies and current work already underway.

| Sequence | Workstream | Dependency / reason | Release gate |
|---:|---|---|---|
| 0 | Finish Category 07 — Recurrence | Already in progress; avoid abandoning existing implementation | Detached edits, cancellations and supported ICS round trips pass |
| 1 | Category 01 — Settings Framework | Shared foundation for every settings category | Persisted, searchable, permission-aware Settings framework |
| 2 | Category 02 — Calendar Management | Needed by holiday, alternate and shared calendars | Full owned/shared/subscribed calendar lifecycle |
| 3 | Category 05 — Language, Region and Time | Required by holidays, recurrence, events and scheduling | Correct regional and timezone behavior |
| 4 | Category 03 — Holiday and Religious Calendars | Depends on region and calendar catalogue | Country/religion discovery and subscription work end-to-end |
| 5 | Category 04 — Alternate and Special Calendars | Depends on region and calendar catalogue | Supported alternate dates and special feeds work end-to-end |
| 6 | Category 06 — Event Creation and Management | Core event controls and permissions | Complete event workflow and secure persistence |
| 7 | Category 08 — Notifications and Reminders | Depends on event and recurrence semantics | Reliable, deduplicated notification delivery |
| 8 | Category 09 — Sharing and Collaboration | Requires calendar model and key-sharing design | Permission and cryptographic-sharing tests pass |
| 9 | Category 10 — Working Hours and Availability | Builds on timezone and sharing | Accurate availability and privacy-preserving free/busy |
| 10 | Category 11 — Tasks and Productivity | Uses settings, views and notification infrastructure | Task lifecycle and reminders pass |
| 11 | Category 12 — Appointment Scheduling | Requires availability, events and notifications | Conflict-safe booking lifecycle passes |
| 12 | Category 14 — Import, Export and Synchronization | Depends on stable event and recurrence model | ICS interoperability; separately verified CalDAV if included |
| 13 | Category 13 — Email and External Integrations | Depends on stable event and integration contracts | Consent-based, privacy-preserving integrations pass |
| 14 | Category 15 — Accessibility, Interface and Offline | Final experience and synchronization hardening | Accessibility and offline acceptance passes |
| 15 | Calendar-wide release acceptance | All selected categories complete | Full end-to-end acceptance and documented limitations |

**Sequencing note:** Categories may have small implementation overlaps where a dependency is already available, but Antigravity must not begin a dependent feature using a placeholder contract that will later require destructive redesign.

## 7. Calendar-wide release acceptance

After all selected categories are implemented, perform one consolidated acceptance process. Do not commission repeated broad audits after every category.

### 7.1 Functional journeys

- Create a personal calendar and configure its settings.
- Create additional Family, Team and Project calendars.
- Discover and subscribe to a country's holiday calendar.
- Subscribe to a supported religious holiday calendar.
- Enable an alternate calendar display and a special-interest calendar.
- Create, edit, move, cancel and delete ordinary events.
- Create a recurring series, detach and modify one occurrence, cancel another and modify the series.
- Verify event and recurrence behavior after reload and export/import.
- Configure reminders and verify delivery and deduplication.
- Share a calendar with different permission levels and test revocation.
- Configure working hours, working location and out-of-office.
- Create, complete and repeat tasks.
- Publish an appointment schedule and test conflicts, rescheduling and cancellation.
- Import/export ICS and test external subscriptions.
- Test email-to-calendar suggestions with explicit user consent.
- Test accessibility and supported offline workflows.

### 7.2 Privacy and security acceptance

- Private event fields remain encrypted at rest.
- No plaintext or Base64 plaintext fallback exists.
- Mailbox locking prevents unauthorized decryption and writes.
- Calendar ownership and tenant isolation are enforced by APIs.
- Sharing does not grant administrators undeclared access to private event content.
- Free/busy endpoints do not leak private titles, locations, attendees or descriptions.
- Integration permissions and consent can be revoked.
- Imported ICS and external feeds are treated as untrusted input.
- Logs do not contain passwords, private keys, decrypted event content or sensitive tokens.

### 7.3 Reliability acceptance

- Migrations are rehearsed on disposable databases.
- Backup and restore are tested before any production-like data migration.
- Event and recurrence operations are tested under relevant concurrency conditions.
- Retries do not duplicate events, invitations, reminders or bookings.
- Background jobs have observable failure and retry behavior.
- Time-zone and DST boundary tests pass.
- Browser refresh, multi-device synchronization and reconnection scenarios pass.

## 8. Engineering workflow and scope-control rules

These rules apply to every Antigravity implementation task derived from this roadmap.

### 8.1 One category per implementation task

- Implement one category at a time.
- Start with a short inspection of the relevant existing code and dependencies.
- Reuse working components and preserve established data models where sound.
- Implement UI, API, persistence, permission checks and tests as required by the category.
- Do not return only an audit, plan or report when implementation was requested.
- Do not expand into unrelated categories.

### 8.2 Database safety

- Verify the target database name before every migration or integration test.
- Use disposable databases only for new migration and integration work.
- Never apply migrations to active `byos` without separate explicit approval.
- Never run cleanup scripts or broad data deletion commands.
- Do not modify existing legacy calendar records as part of ordinary feature implementation.
- Provide exact migration and test commands in the completion report.

### 8.3 Working-tree safety

- Preserve all existing modified and untracked files.
- Do not reset, checkout, clean, discard or overwrite unrelated changes.
- Do not use broad staging such as `git add .`.
- Do not commit, amend or push unless explicitly requested.
- Report the exact files changed by the category.

### 8.4 Verification discipline

- Run focused tests first, followed by relevant regression tests.
- Run integration tests against a verified disposable database.
- Capture exact command outputs and distinguish code failures from environment failures.
- Do not report a test suite as passing when it was skipped or failed to start.
- Do not fix unrelated pre-existing failures silently.
- Do not create a new broad security audit unless implementation evidence reveals a concrete vulnerability.

### 8.5 Definition of category completion

A category may be marked **Complete** only when:

1. All agreed functionality in its scope is implemented.
2. UI controls are connected to real behavior.
3. Data persists and reloads correctly.
4. Authorization and privacy requirements pass.
5. Relevant automated tests pass.
6. Relevant regression tests pass.
7. Known limitations are documented honestly.
8. The completion report identifies exact files, migrations and test evidence.

If an external credential, provider or infrastructure dependency is unavailable, implement the supported local contract and mark the integration as blocked or unavailable. Do not simulate success.

## 9. Per-category completion report template

Each category should produce one concise report containing:

- Category number and name.
- Scope completed.
- User-visible functionality implemented.
- Settings added and their persistence scope.
- API, data model and migration changes.
- Privacy, encryption and permission behavior.
- Exact test commands and results.
- Known limitations or blocked dependencies.
- Exact changed files.
- Confirmation that active `byos` was not modified.
- Confirmation that unrelated working-tree changes were preserved.

Avoid separate reports about the same implementation unless a genuine defect or new evidence requires follow-up.

## 10. Explicitly deferred or conditional features

The following items should remain visible in the roadmap but must not be represented as complete until their scope and dependencies are resolved:

- Full CalDAV server/client compatibility.
- Public calendar publishing.
- Calendar ownership transfer across accounts or organizations.
- Video-conferencing provider integrations.
- Room and resource booking.
- Mobile push notifications, if no mobile client exists.
- Advanced sports and community calendar catalogues.
- Any holiday or religious date provider without verified licensing, regional accuracy and update guarantees.
- Automatic email event extraction until the privacy-preserving implementation and consent model are approved.

These are conditional scope items, not permission to silently remove them from product planning.

## 11. Product completion definition

BYOS Calendar is ready for its planned release when:

- The central Settings experience allows users to manage all implemented calendar behavior.
- Users can manage owned, shared and subscribed calendars.
- Regional and religious holiday discovery works for the supported catalogue.
- Supported alternate and special-interest calendars work.
- Events, recurrence, time zones, reminders and invitations behave reliably.
- Calendar sharing respects user authorization and BYOS encryption boundaries.
- Availability, tasks and appointment scheduling work for the supported scope.
- Import/export and supported synchronization preserve event semantics.
- Accessibility and offline behavior match the documented support level.
- The consolidated release acceptance process passes.
- Remaining limitations are explicit and accepted, not hidden behind an inaccurate “complete” label.

---

## 12. Immediate next action

**Continue the recurrence-engine and detached-exception implementation already in progress.** Do not restart its inspection from scratch and do not abandon it to build unrelated settings pages.

After recurrence passes its acceptance criteria, implement Category 01 (Settings Framework), then follow the sequence in Section 6.

The roadmap is the master scope. Each Antigravity prompt should select one category from this document and include only that category's requirements, applicable safety rules and acceptance criteria.
