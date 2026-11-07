# Test Infrastructure: Webmail Production Refinements & Accessibility

## 1. Test Philosophy & Principles

### 1.1 Opaque-Box & Black-Box Execution
Tests are executed strictly as opaque-box verifications through the user interface (DOM, browser rendering, CSS layout, viewport geometry, network events, and user input simulations). Tests never inspect or manipulate internal SolidJS signals, private component state, or non-exported variables. All assertions are formulated from observable browser behaviors:
- Computed CSS styles (bounding box dimensions, font sizes, transitions, transforms).
- DOM element existence, accessibility roles (`role`, `aria-*`), and test attributes (`data-testid`).
- Viewport and window scroll metrics (`window.scrollY`, `document.documentElement.scrollHeight`, `document.documentElement.clientHeight`).
- Frame timing and interaction latency (60fps animation responsiveness, layout thrashing prevention).
- HTTP network traffic (debounced backend sync, absence of duplicate calls).

### 1.2 Requirement-Driven & Authoritative Derivation
All test specifications are derived directly from the authoritative requirements defined in:
- `ORIGINAL_REQUEST.md` (Approved prompt 2026-11-05T12:12:04Z — Survey R1 to R5).
- `PROJECT.md` (Architecture, Feature Inventory F1 to F15, Interface Contracts).

Every test tier maps explicitly to user requirements:
- **R1 Viewport Height Layout & Scroll Containment** -> Features F1, F2, F3
- **R2 Sizing & Accessibility (Typography, Icons, Tabs)** -> Features F13, F14, F15
- **R3 Email Reading Section Toolbar Simplification** -> Features F11, F12
- **R4 Module Switcher Morphing & Page-Turn Removal** -> Features F4, F5, F6
- **R5 Customization UI Performance Optimization** -> Features F7, F8, F9, F10

### 1.3 Independence & Determinism
Each test scenario runs with clean session isolation:
- Fresh browser page contexts or explicit storage resets (`localStorage.clear()`, `sessionStorage.clear()`).
- Deterministic authentication via real credential flow (`alice@byos.local`).
- Viewport presets configured per test step (375x667 for mobile, 768x1024 for tablet, 1280x800 for desktop).
- No coupling between test case execution order; every tier can be run independently or as part of the full regression suite.

---

## 2. Feature Inventory Mapping to Test Tiers

| Feature ID | Feature Name | Requirement Ref | Target Milestone | Test Tier Mapping |
|------------|--------------|-----------------|------------------|-------------------|
| **F1** | Viewport Height Hardening | R1 | M1 | Tier 1 (T1.1), Tier 2 (T2.1) |
| **F2** | Layout Container Bounding | R1 | M1 | Tier 1 (T1.1), Tier 2 (T2.1) |
| **F3** | Internal Independent Scroll | R1 | M1 | Tier 1 (T1.2), Tier 3 (T3.1) |
| **F4** | 3D Book Page-Turn Removal | R4 | M2 | Tier 1 (T1.5), Tier 2 (T2.3) |
| **F5** | App Switcher Morphing Highlight | R4 | M2 | Tier 1 (T1.6), Tier 3 (T3.1) |
| **F6** | Customization Icon Animation | R4 | M2 | Tier 1 (T1.7), Tier 2 (T2.3) |
| **F7** | Single Panel Mounting | R5 | M3 | Tier 1 (T1.8), Tier 2 (T2.4) |
| **F8** | Direct Reactive Prop Access | R5 | M3 | Tier 1 (T1.9), Tier 3 (T3.2) |
| **F9** | Debounced Backend Persistence | R5 | M3 | Tier 1 (T1.10), Tier 2 (T2.4) |
| **F10** | List Row Layout Thrash Elimination | R5 | M3 | Tier 1 (T1.11), Tier 3 (T3.3) |
| **F11** | Streamlined Email Read Toolbar | R3 | M4 | Tier 1 (T1.3), Tier 3 (T3.2) |
| **F12** | Secondary Actions Overflow Menu | R3 | M4 | Tier 1 (T1.4), Tier 4 (T4.1) |
| **F13** | Desktop A11y Sizing (>=36px targets) | R2 | M5 | Tier 1 (T1.12), Tier 2 (T2.2) |
| **F14** | Mobile A11y Sizing (>=44px touch targets) | R2 | M5 | Tier 1 (T1.13), Tier 2 (T2.2) |
| **F15** | Typography & Micro-text Elimination | R2 | M5 | Tier 1 (T1.14), Tier 2 (T2.2) |

---

## 3. Four-Tier Test Architecture

### 3.1 Tier 1: Core Feature Coverage (Happy Path)
Verifies each individual requirement in isolation under standard desktop and mobile conditions.

- **T1.1: Outer Window Zero-Scroll Assertion (R1 / F1, F2)**
  - Viewports: Desktop (1280x800), Tablet (768x1024), Mobile (375x667).
  - Modules: Email view, Calendar view, Notes view.
  - Assertions:
    - `window.scrollY === 0` across all views.
    - `document.documentElement.scrollHeight <= window.innerHeight`.
    - Document body computed `overflow` contains `hidden`.
    - No outer document vertical scrollbar present.

- **T1.2: Independent Internal Scrolling (R1 / F3)**
  - Verify `MessageList` scroll container has `overflow-y: auto`, `min-height: 0px`, and can scroll without moving the top fixed bar.
  - Verify Calendar timeline (`DayView`, `WeekView`) and Notes view scroll independently within their bounded containers.

- **T1.3: Streamlined Email Reading Toolbar (R3 / F11)**
  - Open an email to display the Reading Pane.
  - Assertions:
    - Top reading toolbar displays primary actions: Back, Prev/Next chevrons, Reply, Forward, Archive, Trash, Mark Read/Unread, Star, and More options button (`...`).
    - Obsolete cluttered actions are removed from the direct toolbar surface.

- **T1.4: Overflow Menu & Secondary Actions (R3 / F12)**
  - Click the More options (`...`) overflow menu trigger.
  - Assertions:
    - Dropdown opens with ARIA semantics (`aria-expanded="true"`, `role="menu"`).
    - Contains secondary actions: Snooze (`data-testid="reading-pane-snooze-btn"` preserved), Move to folder, Label as, Report spam, Print, Download EML, Headers.
    - Keyboard navigation (ArrowDown, ArrowUp, Escape) works seamlessly.

- **T1.5: 3D Book Page-Turn Animation Removal (R4 / F4)**
  - Switch between Mailbox, Calendar, and Notes modules.
  - Assertions:
    - `.page-turn-viewport` class and 3D `rotateY` transforms are absent.
    - Container does not experience perspective shifts or 3D rotation flippings.

- **T1.6: App Switcher Morphing Highlight (R4 / F5)**
  - Module switcher (`data-testid="top-bar-module-switcher"`).
  - Assertions:
    - Background pill (`data-testid="right-bar-morphing-pill"`) smoothly transitions active position.
    - Uses GPU-accelerated `transform: translateX(...)` with smooth cubic-bezier easing.

- **T1.7: Customization Icon Animation (R4 / F6)**
  - Customizer trigger button (`data-testid="top-bar-appearance-btn"`).
  - Assertions:
    - When clicked to open/close, the trigger icon executes a smooth 90° rotation and cross-fade between palette and close icon.
    - Active badge indicator animates smoothly.

- **T1.8: Single Panel Mounting (R5 / F7)**
  - Inspect DOM tree when QuickSettingsPanel is opened.
  - Assertions:
    - Exactly ONE instance of `[data-testid="quick-settings-panel"]` exists in the DOM.
    - No redundant duplicate instance mounted across hidden media queries.

- **T1.9: Direct Reactive Settings Interaction (R5 / F8)**
  - Toggle density ("compact", "cozy", "comfortable"), layout mode ("split", "full"), and fontScale.
  - Assertions:
    - Settings update instantaneously in UI without signal synchronization cascade delay.

- **T1.10: Debounced Backend Persistence (R5 / F9)**
  - Monitor network traffic while changing settings 5 times within 200ms.
  - Assertions:
    - Network requests to `/v1/mailboxes/.../settings` are debounced (400ms delay).
    - Exactly one consolidated backend PATCH/POST is fired, rather than 5 simultaneous bursts.

- **T1.11: 60fps Row Density Transitions (R5 / F10)**
  - Measure layout thrashing / frame timing during density changes.
  - Assertions:
    - `MessageRow` and `ThreadRow` use `transition-colors` rather than `transition-all`.
    - No involuntary layout reflow cascade across 50+ message rows.

- **T1.12: Desktop Accessibility Sizing (R2 / F13)**
  - Viewport: 1280x800 desktop.
  - Target elements: TopBar buttons, module switcher tabs, toolbar icons, chevron paginators.
  - Assertions:
    - Computed width and height >= 36px (`min-w-[36px]` and `min-h-[36px]`).

- **T1.13: Mobile Accessibility Sizing (R2 / F14)**
  - Viewport: 375x667 mobile.
  - Target elements: Mobile hamburger button, search bar touch trigger, bottom navigation tabs, message star toggles, folder navigation items.
  - Assertions:
    - Computed width and height >= 44px (`min-w-[44px]` and `min-h-[44px]`).

- **T1.14: Typography & Micro-text Elimination (R2 / F15)**
  - Inspect text elements across badges, timestamps, labels, secondary headers.
  - Assertions:
    - No computed font sizes below 12px (elimination of 9px, 10px, 11px micro-text).

---

### 3.2 Tier 2: Boundary & Corner Cases

- **T2.1: Extreme Viewport Bounds (375px, 768px, 1280px, 1920px, 320px Stress)**
  - Zero-scroll assertions verified at exact responsive boundary switch points:
    - 375px (standard mobile)
    - 768px (tablet portrait / desktop breakpoint)
    - 1024px (tablet landscape)
    - 1280px (standard laptop)
    - 1920px (large desktop)
  - Assert: No horizontal or vertical document body overflow across all 5 viewports.

- **T2.2: Rapid Module Switching (Stress & Throttling)**
  - Rapidly switch between Mail -> Calendar -> Notes -> Mail (5 clicks in 250ms).
  - Assert:
    - No animation lockups or stuck transform states.
    - Module switcher pill smoothly settles on final active destination.
    - Zero console exceptions (`pageerror` list remains empty).

- **T2.3: Rapid Customization Toggle & Escape Dismissal**
  - Toggle customizer open and closed 10 times in rapid succession.
  - Press `Escape` key immediately upon opening.
  - Assert:
    - Panel opens and dismisses cleanly.
    - Focus returns appropriately.
    - No memory leaks or orphaned event listeners.

- **T2.4: Empty & Heavy Mailbox Boundary Scroll**
  - Test zero-scroll with 0 messages, 1 message, and 100+ virtualized messages.
  - Assert:
    - Outer window never scrolls under empty state or loaded state.

---

### 3.3 Tier 3: Cross-Feature Combinations

- **T3.1: Switch Modules While Deeply Scrolled**
  - In Email view, scroll message list down 500px.
  - Switch module to Calendar.
  - Assert:
    - Calendar view opens with outer window at `scrollY === 0`.
    - Switching back to Email preserves internal list scroll position without leaking scroll to document body.

- **T3.2: Open Customizer During Active Email Reading**
  - Select an email message; reading pane is displayed with streamlined toolbar.
  - Open Quick Settings customizer panel.
  - Change density and theme while reading pane is active.
  - Assert:
    - Reading pane layout adjusts cleanly to density.
    - Overflow menu (`...`) remains properly positioned and accessible.
    - Customizer closes cleanly without disrupting reading state.

- **T3.3: Split Mode vs. Full Mode Density Switching**
  - Switch layout between Split mode (list + reading pane) and Full mode (single pane).
  - Cycle density (compact -> cozy -> comfortable).
  - Assert:
    - Message row dimensions resize gracefully without overlapping buttons or breaking 36px desktop click boundaries.

---

### 3.4 Tier 4: Real-World Workload Scenarios

- **T4.1: The Morning Executive Triage Journey**
  - Log in as Alice.
  - View inbox with comfortable density at 1280x800.
  - Read email, open overflow menu (`...`), trigger snooze.
  - Switch to Calendar via module switcher morphing pill.
  - Verify calendar Day timeline displays 24 hours with continuous dividing line and zero document scroll.
  - Switch to Notes, view notes list.
  - Return to Mailbox.
  - All operations complete with zero outer window scrolling, smooth 60fps transitions, and accessible touch/click targets.

- **T4.2: Mobile Field Triage Journey**
  - Emulate mobile viewport (375x667).
  - Open mobile webmail.
  - Tap mobile hamburger (verify >=44px touch target).
  - Tap message item (verify >=44px row touch target).
  - Verify top fixed bar and bottom navigation bar stay anchored with 100dvh bounding.
  - Open Quick Settings panel on mobile, toggle theme, close panel.
  - Assert: No horizontal wobble, no vertical document scroll.

---

## 4. Test Tooling, Framework & Artifacts

- **Runner:** Node.js ESM (`node tests/browser/<script>.mjs`).
- **Driver:** Puppeteer Core with real Google Chrome browser (`C:\Program Files\Google\Chrome\Application\chrome.exe`).
- **Headless Mode:** `headless: "new"` with GPU acceleration flags where appropriate.
- **Artifacts:**
  - Screenshots stored in `tests/browser/artifacts/`.
  - Console logs and uncaught errors monitored continuously during execution.
  - Performance metrics (layout duration, RAF frame pacing) recorded during customizer interactions.

---

## 5. Execution & Verification Commands

```powershell
# Run the complete Production Refinements & Accessibility E2E Test Suite
node tests/browser/test_prod_refinements_e2e.mjs

# Run individual tier suites (if executed modularly)
node tests/browser/test_prod_refinements_tier1.mjs
node tests/browser/test_prod_refinements_tier2.mjs
```
