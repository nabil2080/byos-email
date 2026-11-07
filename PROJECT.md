# Project: Webmail Production Refinement & Accessibility

## Architecture
- **Application Core:** SolidJS + Vite + TailwindCSS authenticated webmail application (`apps/webmail/`).
- **Module Structure:**
  - Layout & Navigation: `index.html`, `src/App.tsx`, `src/app.css`, `src/components/TopFixedBar.tsx`, `src/components/BottomFixedBar.tsx`, `src/components/Sidebar.tsx`.
  - Email Module: `src/components/InboxToolbar.tsx`, `src/components/MessageList.tsx`, `src/components/MessageRow.tsx`, `src/components/ThreadRow.tsx`, `src/components/ReadingPane.tsx`.
  - Calendar Module: `src/components/calendar/CalendarView.tsx`, `src/components/calendar/CalendarToolbar.tsx`, `src/components/calendar/MobileCalendarHeader.tsx`, `DayView.tsx`, `WeekView.tsx`, `MonthView.tsx`.
  - Notes Module: `src/components/notes/NotesView.tsx`, `src/components/notes/NotesSidebar.tsx`.
  - Customization & Settings: `src/components/QuickSettingsPanel.tsx`, `src/components/AccountSwitcher.tsx`.
- **E2E Testing Track:** Requirement-driven, opaque-box browser test suites running under Node/Puppeteer in `tests/browser/`.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F1 | Viewport Height Hardening | Root html, body, and #root set to 100% / 100dvh, overflow hidden, overscroll-behavior none; app container uses 100dvh to eliminate mobile browser bar scroll | M1 | Survey R1 |
| F2 | Layout Container Bounding | Remove conflicting `h-full` and add `min-h-0` on flex column parents in Email, Calendar, and Notes views so header (48/56px) + gap doesn't overflow | M1 | Survey R1 |
| F3 | Internal Independent Scroll | Constrain internal scroll containers (`MessageList`, `ReadingPane`, `DayView`, `WeekView`, `MonthView`, `NotesView`) with `min-h-0` and `overflow-y-auto` | M1 | Survey R1 |
| F4 | 3D Book Page-Turn Removal | Remove `.page-turn-viewport`, `prevModule`, transition timers, and 3D rotateY keyframes from `App.tsx` and `app.css` | M2 | Survey R4 |
| F5 | App Switcher Morphing Highlight | Replace invisible pill with 100% GPU-accelerated translateX morphing background pill in `TopFixedBar.tsx` | M2 | Survey R4 |
| F6 | Customization Icon Animation | Add 90° rotation and cross-fade between palette and close 'X' SVG icons with animated pop-in badge in `TopFixedBar.tsx` | M2 | Survey R4 |
| F7 | Single Panel Mounting | Prevent dual DOM tree mounting (`hidden lg:flex` and `lg:hidden`) of `QuickSettingsPanel` using reactive viewport check | M3 | Survey R5 |
| F8 | Direct Reactive Prop Access | Eliminate 9 local mirror signals and 9 chained `createEffect` sync blocks in `QuickSettingsPanel.tsx` | M3 | Survey R5 |
| F9 | Debounced Backend Persistence | Debounce `updateMailboxSettings` (400ms) and eliminate duplicate theme save calls between `QuickSettingsPanel` and `App.tsx` | M3 | Survey R5 |
| F10 | List Row Layout Thrash Elimination | Replace `transition-all` with `transition-colors` on `MessageRow.tsx` and `ThreadRow.tsx` to keep density changes at 60fps | M3 | Survey R5 |
| F11 | Streamlined Email Read Toolbar | Display primary actions directly (Reply, Forward, Archive, Trash, Mark Read/Unread, Star, More `...`) in `ReadingPane.tsx` | M4 | Survey R3 |
| F12 | Secondary Actions Overflow Menu | Consolidate Snooze, Move to folder, Label as, Report spam, Print, Download (.eml), and Headers into accessible `...` dropdown with ARIA and keyboard navigation | M4 | Survey R3 |
| F13 | Desktop A11y Sizing (>=36px targets) | Scale up navigation tabs, header buttons, toolbar actions, and chevrons to meet minimum 36x36px desktop click target | M5 | Survey R2 |
| F14 | Mobile A11y Sizing (>=44px touch targets) | Scale up mobile hamburgers, search triggers, bottom tabs, star toggles, and folder rows to meet minimum 44x44px touch target | M5 | Survey R2 |
| F15 | Typography & Micro-text Elimination | Eliminate `text-[9px]`, `text-[10px]`, `text-[11px]` across badges, timestamps, labels, scaling to legible 12px-15px font sizes | M5 | Survey R2 |
| F16 | E2E Testing Suite (Tiers 1-4) | Requirement-driven test suite verifying all 5 requirements across desktop, tablet, and mobile; publishes `TEST_READY.md` | E2E Track | ORIGINAL_REQUEST |
| F17 | Final E2E Pass & Adversarial Hardening | Pass 100% of E2E tests (Tiers 1-4), then run Tier 5 adversarial coverage hardening | M6 | ORIGINAL_REQUEST |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| E2E | E2E Testing Track | Design and publish comprehensive test suite (Tiers 1-4) covering R1-R5; create `TEST_INFRA.md` and `TEST_READY.md` | none | DONE |
| M1 | Viewport Height Layout & Scroll Containment | F1, F2, F3 (`index.html`, `app.css`, `App.tsx`, `MessageList.tsx`, `ReadingPane.tsx`, `CalendarView.tsx`, `DayView.tsx`, `WeekView.tsx`, `MonthView.tsx`, `NotesView.tsx`) | none | DONE |
| M2 | Module Switcher Morphing & Page-Turn Removal | F4, F5, F6 (`App.tsx`, `app.css`, `TopFixedBar.tsx`) | M1 | PLANNED |
| M3 | Customization UI Performance Optimization | F7, F8, F9, F10 (`QuickSettingsPanel.tsx`, `App.tsx`, `MessageRow.tsx`, `ThreadRow.tsx`) | M1 | PLANNED |
| M4 | Email Reading Section Toolbar Simplification | F11, F12 (`ReadingPane.tsx`) | M1 | PLANNED |
| M5 | Typography, Icon & Navigation Tab Scaling | F13, F14, F15 (`TopFixedBar.tsx`, `BottomFixedBar.tsx`, `Sidebar.tsx`, `AccountSwitcher.tsx`, `InboxToolbar.tsx`, `MessageRow.tsx`, `CalendarToolbar.tsx`, `MobileCalendarHeader.tsx`, `NotesSidebar.tsx`) | M2, M4 | PLANNED |
| M6 | 100% E2E Pass & Adversarial Hardening | F17 (Full application verification against `TEST_READY.md`, Tier 5 white-box challenger hardening) | E2E, M1, M2, M3, M4, M5 | PLANNED |

## Interface Contracts
### Layout Containers ↔ View Components
- Parents provide `flex flex-1 min-h-0 min-w-0 overflow-hidden` bounding box.
- View components must not apply `h-full` if preceded by sibling headers in flex column.
- Internal scroll containers must specify `min-h-0 overflow-y-auto`.

### Module Switcher ↔ App Router
- `TopFixedBar` receives `activeModule: AppModule` ("mail" | "calendar" | "notes") and triggers `onSwitchModule(module: AppModule)`.
- Background morphing pill smoothly translates using `translateX(0% | 100% | 200%)` with `duration-250 ease-[cubic-bezier(0.16,1,0.3,1)]`.
- `data-testid="right-bar-morphing-pill"` and `data-testid="top-bar-module-switcher"` preserved.

### Customization Panel ↔ State Store
- `QuickSettingsPanel` reads reactive settings directly from `props.*`.
- Setting changes invoke prop callbacks (`props.onDensityChange`, `props.onThemeChange`, etc.) and queue debounced backend sync (400ms) without triggering duplicate requests.

### Reading Pane Toolbar ↔ Actions
- Primary actions: Reply, Forward, Archive, Trash, Mark Read/Unread, Star, More `...`.
- Secondary actions inside overflow menu: Snooze, Move to folder, Label as, Report spam, Print, Download (.eml), Headers.
- `[data-testid="reading-pane-snooze-btn"]` preserved inside overflow dropdown for automated test compatibility.

## Code Layout
- `apps/webmail/index.html` — Root HTML document configuration.
- `apps/webmail/src/app.css` — Global CSS variables, viewport rules, scrollbars, animations.
- `apps/webmail/src/App.tsx` — Main application component, module switching, drawer mounting.
- `apps/webmail/src/components/TopFixedBar.tsx` — Top header, module switcher, customization trigger.
- `apps/webmail/src/components/BottomFixedBar.tsx` — Mobile bottom navigation bar.
- `apps/webmail/src/components/Sidebar.tsx` — Desktop/mobile navigation sidebar, folders, compose.
- `apps/webmail/src/components/AccountSwitcher.tsx` — Account selection dropdown and avatar chip.
- `apps/webmail/src/components/InboxToolbar.tsx` — Email message list toolbar, bulk actions.
- `apps/webmail/src/components/MessageList.tsx` — Message list container and virtualized scroll.
- `apps/webmail/src/components/MessageRow.tsx` / `ThreadRow.tsx` — Email item row components.
- `apps/webmail/src/components/ReadingPane.tsx` — Email detail view and action toolbar.
- `apps/webmail/src/components/QuickSettingsPanel.tsx` — Customization and appearance panel.
- `apps/webmail/src/components/calendar/` — Calendar view, toolbars, headers, Day/Week/Month grids.
- `apps/webmail/src/components/notes/` — Notes view, toolbars, sidebar, list.
- `tests/browser/` — Opaque-box E2E test scripts and verification artifacts.
