# BYOS Webmail Calendar: Architecture & Design Audit Report

## 1. Executive Summary

This report documents the architectural audit and implementation plan for the BYOS Webmail Calendar subsystem. The calendar integrates into the BYOS Webmail platform (`apps/webmail` and `services/api`), balancing Google Calendar's intuitive time-grid navigation, Microsoft Outlook's meeting and attendee scheduling, Proton Calendar's zero-knowledge privacy controls, and Tuta's uncluttered event creation ergonomics.

The architecture preserves BYOS's zero-knowledge security guarantees: all event content (titles, notes, descriptions, locations, meeting links, and attendee lists) is encrypted client-side using authenticated AES-GCM-256 before transmission and persistence. The server and organization administrators have zero visibility into personal calendar entries.

---

## 2. Repository & Architectural Forensics

### 2.1 Navigation & Application Routing
- **Current Architecture:** `apps/webmail/src/App.tsx` manages primary navigation state through reactive SolidJS signals without hard page reloads.
- **Sidebar Integration:** `apps/webmail/src/components/Sidebar.tsx` currently houses folder trees, account switcher, sub-actions (Contacts, Import, Settings), and the primary compose button.
- **Calendar Entry Point:** A dedicated primary view switcher (`activeModule: "mail" | "calendar"`) is added to the left navigation. When switched to Calendar mode, the application displays a unified calendar workspace comprising a dedicated calendar sidebar (Mini Month Picker, My Calendars, New Event action) and the active time workspace (Day, Week, Month, Agenda).

### 2.2 Design System & Palette Compliance
- **Brand System (`09-tailwind-brand-system`):**
  - **Canvas Background:** Cloud Dancer Light (`#F0EEE9`) and Dark Mode (`#18191D`).
  - **Surface Panels:** Pure White (`#FFFFFF`) and Soft White (`#FAF9F5`).
  - **Brand Accent:** Mocha Mousse (`#9E725F`), Hover (`#865E4D`), Soft Tint (`#F2E8E2`).
  - **Typography & Borders:** Neutral Charcoal (`#3C3D3E`), Muted (`#6F7173`), Border (`#E2DFD8`).
- **Icons & Motion:** Clean Lucide SVG stroke icons (no emojis). Snappy, deliberate infrastructure motion with CSS easing curves (`cubic-bezier(0.16, 1, 0.3, 1)`).
- **Responsive Requirement:** Responsive architecture scaling cleanly down to a 375px mobile viewport without horizontal scrolling, using container queries and responsive Tailwind modifiers.

### 2.3 Date/Time & Recurrence Utilities
- Native browser `Intl.DateTimeFormat` and JavaScript UTC date manipulation provide locale-aware formatting, timezone offset handling, and 12h/24h time formatting without external dependency bloat.
- An RFC 5545 compliant recurrence engine (`calendarRrule.ts`) expands recurring events (DAILY, WEEKLY, MONTHLY, YEARLY) within the visible viewport window client-side.

---

## 3. Cryptographic & Zero-Knowledge Architecture

### 3.1 Security Invariant
Calendar entries frequently contain sensitive personal appointments, medical visits, business meetings, and confidential notes. In BYOS, the server is an untrusted storage broker. Organization administrators and server root operators must not have access to calendar event details.

### 3.2 Key Custody & AAD Domain Separation
- The active mailbox key (`mailbox_sk`, 256-bit symmetric key) is held only in ephemeral client memory and unwrapped from the recovery mnemonic.
- Encryption and decryption use the WebAssembly cryptographic core (`byos_crypto_core` AES-GCM-256).
- Cryptographic Domain Separation via Additional Authenticated Data (AAD):
  - **Calendar Metadata AAD:** `UTF8("byos-calendar-v1") || mailbox_id16`
  - **Calendar Event AAD:** `UTF8("byos-calendar-event-v1") || mailbox_id16`
- Cross-domain envelope tampering is cryptographically impossible: a draft envelope, contact envelope, or calendar envelope cannot be decrypted in another context.

### 3.3 Server Persistence Boundary
To enable efficient time-window querying without leaking event details, the database stores:
1. `id` (UUID)
2. `mailbox_id` (UUID)
3. `calendar_id` (UUID)
4. `start_time` (TIMESTAMPTZ, UTC) - used strictly for window indexing
5. `end_time` (TIMESTAMPTZ, UTC) - used strictly for window indexing
6. `is_all_day` (BOOLEAN)
7. `rrule` (TEXT, optional recurrence rule for window evaluation)
8. `status` (TEXT: `busy`, `free`, `tentative`)
9. `encrypted_payload` (BYTEA: base64/binary AES-GCM-256 envelope containing encrypted title, description, location, meeting URLs, reminders, and attendee list)
10. `created_at` and `updated_at` (TIMESTAMPTZ)

---

## 4. Database Schema Design (`059_calendars_and_events.sql`)

### 4.1 Tables
```sql
CREATE TABLE IF NOT EXISTS user_calendars (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    mailbox_id         uuid NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    name               text NOT NULL,
    color              text NOT NULL DEFAULT '#9E725F',
    is_default         boolean NOT NULL DEFAULT false,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS calendar_events (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    mailbox_id         uuid NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE,
    calendar_id        uuid NOT NULL REFERENCES user_calendars(id) ON DELETE CASCADE,
    start_time         timestamptz NOT NULL,
    end_time           timestamptz NOT NULL,
    is_all_day         boolean NOT NULL DEFAULT false,
    rrule              text,
    status             text NOT NULL DEFAULT 'busy',
    encrypted_payload  bytea NOT NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_event_times CHECK (end_time >= start_time)
);
```

### 4.2 Indexing & Performance
- Index on `user_calendars(mailbox_id, is_default)`
- Composite index on `calendar_events(mailbox_id, start_time, end_time)` for efficient viewport range queries.
- Index on `calendar_events(calendar_id)` for calendar deletion cascades.

---

## 5. API Design & Endpoints (`services/api/calendar.go`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/v1/mailboxes/{mailbox_id}/calendars` | List personal calendars for mailbox |
| `POST` | `/v1/mailboxes/{mailbox_id}/calendars` | Create a new personal calendar |
| `PATCH` | `/v1/mailboxes/{mailbox_id}/calendars/{calendar_id}` | Update calendar (name, color, is_default) |
| `DELETE` | `/v1/mailboxes/{mailbox_id}/calendars/{calendar_id}` | Delete calendar (cascades events, prevents deleting only default) |
| `GET` | `/v1/mailboxes/{mailbox_id}/calendar-events` | Query events within `start` and `end` time window |
| `POST` | `/v1/mailboxes/{mailbox_id}/calendar-events` | Create new calendar event |
| `PATCH` | `/v1/mailboxes/{mailbox_id}/calendar-events/{event_id}` | Update existing event |
| `DELETE` | `/v1/mailboxes/{mailbox_id}/calendar-events/{event_id}` | Delete event |

---

## 6. Implementation Sequence

1. **Step 1: Database Migration**: Deploy `infra/postgres/init/059_calendars_and_events.sql` and apply to the local PostgreSQL database.
2. **Step 2: Backend Handlers & Tests**: Implement `services/api/calendar.go`, register routes in `services/api/main.go`, and add unit/integration tests in `services/api/calendar_test.go`.
3. **Step 3: Frontend Cryptography & API Client**: Implement calendar crypto routines in `apps/webmail/src/calendar_crypto.ts` and API client functions in `apps/webmail/src/api.ts`.
4. **Step 4: Recurrence Engine**: Implement `apps/webmail/src/utils/calendarRrule.ts` with recurrence tests.
5. **Step 5: Visual Components & State**:
   - `apps/webmail/src/components/calendar/CalendarView.tsx`
   - `apps/webmail/src/components/calendar/CalendarSidebar.tsx`
   - `apps/webmail/src/components/calendar/MiniMonthPicker.tsx`
   - `apps/webmail/src/components/calendar/CalendarToolbar.tsx`
   - `apps/webmail/src/components/calendar/WeekView.tsx`
   - `apps/webmail/src/components/calendar/DayView.tsx`
   - `apps/webmail/src/components/calendar/MonthView.tsx`
   - `apps/webmail/src/components/calendar/AgendaView.tsx`
   - `apps/webmail/src/components/calendar/EventModal.tsx`
   - `apps/webmail/src/components/calendar/CalendarModal.tsx`
6. **Step 6: Webmail Integration & Navigation**: Wire primary view switcher in `Sidebar.tsx` and `App.tsx`.
7. **Step 7: Verification & Browser Automation**: Build and run Puppeteer browser test suite `tests/browser/test_calendar_browser.mjs` verifying event creation, viewing, dragging, recurrence, and mobile responsiveness. Save screenshots to `tests/browser/artifacts/`.
