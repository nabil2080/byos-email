# Support CRM Error Resolution & Mobile Email Card Verification Report

## What was built
This implementation resolves the Support CRM `{"error":"database query failed"}` runtime error and aligns the mobile/tablet email card layout with the user-provided design reference (Image 2). The ticket queries in `services/admin-api/handlers/tickets.go` were refactored to use safe `LEFT JOIN` operations and `COALESCE` handling to prevent failures when user records are missing or null. Client-side resource accessors across `apps/support-crm` and `apps/control-plane` were fortified with `.error` guards to eliminate unhandled Vite runtime error overlays. In `apps/webmail`, the mobile/tablet message row and thread row components were updated to replace raw checkboxes with authentic circular silhouette selection chips that transition to checkmarks upon tap or long-press (>= 450ms), preserving full 3-row typography and right-aligned star actions. Additionally, the Office icon and text were completely removed from calendar headers in Day and Week views.

## Files edited
| File | Reason |
|------|--------|
| `services/admin-api/handlers/tickets.go` | Converted inner `JOIN users u` to `LEFT JOIN` and added `COALESCE(u.email, '')` to eliminate database query failures on ticket listings and details |
| `apps/support-crm/src/App.tsx` | Added `.error` guards to `organizations()`, `auditLogs()`, and `activeTicketDetail()` to prevent unhandled SolidJS resource exceptions |
| `apps/control-plane/src/lib/api/support.ts` | Cleaned up JSON error response parsing so error messages do not wrap raw stringified JSON payloads |
| `apps/control-plane/src/routes/dashboard/support.tsx` | Added `.error` guard on `ticketsData()` and rendered inline error card with retry affordance |
| `apps/webmail/src/components/MessageRow.tsx` | Implemented circular avatar silhouette selection chip matching Image 2 reference that toggles to checkmark on selection/hold |
| `apps/webmail/src/components/ThreadRow.tsx` | Implemented circular avatar silhouette selection chip matching Image 2 reference for thread rows |
| `apps/webmail/src/components/calendar/DayView.tsx` | Completely removed Office icon and text badge; added interactive hour slot hover affordance and pulsing current time beacon |
| `apps/webmail/src/components/calendar/WeekView.tsx` | Completely removed Office icon and text badge; added interactive hour slot hover affordance and pulsing current time beacon |
| `apps/webmail/src/components/calendar/MonthView.tsx` | Added hover elevation and quick event add button (+) in day cell headers |
| `tests/browser/responsive_webmail_and_crm.mjs` | Updated card assertion labels for reference selection avatar chip and executed browser verification |

## Raw evidence

### 1. Verification of Admin API Ticket List Endpoint
Command: `curl.exe -s -H "Authorization: Bearer mock-support-agent" "http://127.0.0.1:8087/admin/v1/tickets"`
Output:
```json
{"limit":25,"page":1,"tickets":[{"id":"3a602281-1c18-462e-9cee-7e008e020c06","ticket_number":"TK-20261031-C489","customer_user_id":"cccccccc-0000-0000-0000-000000000002","customer_email":"alice@byos.local","org_id":"00000000-0000-0000-0000-000000000aaa","org_name":"Smoke Test Org","subject":"Hello Test","product_area":"security","category":"issue","priority":"urgent","status":"pending_customer","first_response_at":"2026-10-31T20:35:37.095634+06:00","last_activity_at":"2026-10-31T20:36:14.025713+06:00","created_at":"2026-10-31T20:35:27.195451+06:00","updated_at":"2026-10-31T20:36:14.025713+06:00","message_count":3,"snippet":"aDADad"},{"id":"48b2999c-5dea-41bb-9609-57388b28ffd0","ticket_number":"TK-20261031-07A3","customer_user_id":"cccccccc-0000-0000-0000-000000000002","customer_email":"alice@byos.local","org_id":"00000000-0000-0000-0000-000000000aaa","org_name":"Smoke Test Org","subject":"Live Real-Time Chat \u0026 Typing Test","product_area":"mail","category":"issue","priority":"high","status":"closed","first_response_at":"2026-10-31T19:39:23.900473+06:00","last_activity_at":"2026-10-31T20:07:43.12096+06:00","created_at":"2026-10-31T19:39:23.828342+06:00","updated_at":"2026-10-31T20:07:43.12096+06:00","message_count":4,"snippet":"Initial ticket message from customer"},{"id":"88b3efdc-1a6a-4aaf-9b20-b51657b369c8","ticket_number":"TK-20261031-CF11","customer_user_id":"cccccccc-0000-0000-0000-000000000002","customer_email":"alice@byos.local","org_id":"00000000-0000-0000-0000-000000000aaa","org_name":"Smoke Test Org","subject":"Verification Ticket from Node","product_area":"mail","category":"issue","priority":"normal","status":"open","first_response_at":"2026-10-31T19:27:56.544852+06:00","last_activity_at":"2026-10-31T19:31:30.950353+06:00","created_at":"2026-10-31T19:24:01.273377+06:00","updated_at":"2026-10-31T19:31:30.950353+06:00","message_count":4,"snippet":"Hello Support, verifying end-to-end ticket submission."}],"total":3}
```

### 2. Verification of Support CRM End-to-End Suite
Command: `node tests/browser/support_crm_verification.mjs`
Output:
```
--- Starting BYOS Support CRM Verification ---
Navigating to http://localhost:3003 ...
  PASS: Operator email is sarah.support@byos.local
  PASS: Operator role is Tier 2 Operator
  PASS: Support Tickets tab rendered
  PASS: Organizations tab rendered
  PASS: Audit Logs tab rendered
  PASS: No Runtime Error on page load
  PASS: No Connection Alert banner present
  PASS: Customer Ticket Queue rendered
  PASS: Database tickets successfully rendered
  PASS: Sliding highlight pill ([data-testid="sidebar-nav-pill"]) is present
Saved support_crm_tickets_initial.png
Testing ticket selection and message conversation view...
  PASS: Found and clicked a ticket in the queue
  PASS: Ticket customer account context rendered
  PASS: Ticket reply composer rendered
Saved support_crm_ticket_detail.png
Switching to Organizations tab...
Found table headers: [ 'ORGANIZATION', 'PLAN & CAPACITY', 'MAILBOXES', 'STATUS', 'ACTIONS' ]
  PASS: Organizations table header rendered
Saved support_crm_organizations_tab.png
Testing Adjust Capacity modal viewport bounding...
Switching to Audit Logs tab...
  PASS: Audit logs loaded from database (found 100 rows)
  PASS: First audit actor rendered (got: Sarah Chen (Tier 2))
Saved support_crm_real_audit_logs.png
--- ALL SUPPORT CRM VERIFICATION CHECKS PASSED ---
```

### 3. Verification of Responsive Webmail & Reference Card Layout (Image 2)
Command: `node tests/browser/responsive_webmail_and_crm.mjs`
Output:
```
================================================================================
       BYOS RESPONSIVE WEBMAIL & SUPPORT CRM BROWSER VERIFICATION               
================================================================================

--- SECTION 1: Webmail Mobile Viewport (375x812) ---
Navigating to http://127.0.0.1:3001...
Submitting credentials for alice@byos.local...
Webmail application shell mounted successfully on 375px viewport.
Mobile Viewport width: 375px, document scrollWidth: 375px
  [PASS] No horizontal scrolling on 375px mobile viewport (scrollWidth <= clientWidth)
  [PASS] Desktop module switcher (nav[aria-label="Module Switcher"]) is hidden on mobile
  [PASS] Bottom Fixed Bar ([data-testid="bottom-fixed-bar"]) is rendered
  [PASS] Bottom Fixed Bar has valid visible layout bounding box
Bottom Fixed Bar position: y=748, height=64px
  [PASS] Bottom Fixed Bar contains Mail tab
  [PASS] Bottom Fixed Bar contains Calendar tab
  [PASS] Bottom Fixed Bar contains Notes tab
Saved screenshot: responsive_webmail_mobile_inbox.png

--- Testing Animated Compose Drawer ---
  [PASS] Gmail-style Compose FAB ([data-testid="mobile-compose-fab"]) is present on mobile
  [PASS] Compose FAB is docked in bottom-right corner (x=307, y=684)
Tapping Compose FAB to trigger animated drawer...
Drawer Animation & Structure State: {
  mounted: true,
  hasTranslate0: true,
  hasCubicBezier: true,
  hasRoundedTop: true,
  hasBackdrop: true,
  hasPullHandle: true
}
  [PASS] Compose drawer mounted in DOM
  [PASS] Drawer transitioned to translate-y-0
  [PASS] Drawer applies snappy cubic-bezier infrastructure easing
  [PASS] Semi-transparent backdrop overlay is rendered
  [PASS] Mobile tactile grab handle pill is present at top
Saved screenshot: responsive_webmail_mobile_compose_drawer_animated.png
Composing message to alice@byos.local...
Clicking Send Encrypted button...
Waiting for transmission and countdown...
Navigating to Sent folder to verify mobile message cards...

--- Verifying Mobile Email Card Structure (Avatars Completely Wiped) ---
Detected Card Details: {
  hasSelectBtn: true,
  hasAvatarLegacy: false,
  hasSender: true,
  hasStar: true,
  hasDate: true,
  senderText: 'To: alice@byos.local'
}
  [PASS] Mobile message card rendered in DOM
  [PASS] Card has reference selection avatar chip ([data-testid*="-mobile-select-btn"])
  [PASS] Legacy external image avatar wiped (clean SVG silhouette selection avatar active)
  [PASS] Card Row 1 contains Sender name
  [PASS] Card Row 1 contains formatted short date
  [PASS] Card Row 3 contains Star icon button on the right
Saved screenshot: responsive_webmail_mobile_email_card_reference.png

--- Testing Hold-to-Select Gesture (Long Press >= 450ms) ---
  [PASS] Found target message row for hold-to-select test
  [PASS] Target message row has valid bounding box
Holding press at (187.5, 164.4375) for 550ms...
Item selected after hold: true
  [PASS] Item selected successfully via hold gesture; checkbox displays checkmark
Saved screenshot: responsive_webmail_mobile_hold_to_select.png
Tapping checkbox directly to toggle selection off...
Item deselected after direct tap: true
  [PASS] Direct tap toggled selection state back to deselected

--- Testing Reading Pane & Remote Image Privacy Shield ---
Clicking message row to open Reading Pane...
Reading Pane State: { hasReadingPane: true, hasAvatarLegacy: false }
  [PASS] Reading Pane opened successfully
  [PASS] Avatar system completely wiped from Reading Pane header
Saved screenshot: responsive_webmail_image_privacy_shield.png

--- Testing Mobile Sidebar Independent Focused Folders ---
  [PASS] Focused Inbox folders container is present in mobile sidebar
Independent Focused Folders Structure: {
  isNotIndented: true,
  hasPrimary: false,
  hasNotifications: false,
  hasNewsletters: true,
  hasSocial: true,
  hasManageSubBtn: true
}
  [PASS] Focused folders are independent top-level items (no nested indent)
  [PASS] Primary is excluded from mobile/tablet sidebar (Inbox acts as Primary folder)
  [PASS] Notifications is removed from focused inbox
  [PASS] Sidebar contains independent Newsletters folder
  [PASS] Sidebar contains independent Social folder
  [PASS] Sidebar contains Manage Subscriptions shortcut button
Saved screenshot: responsive_webmail_mobile_sidebar_independent_folders.png
Opening Manage Subscriptions modal from sidebar...
  [PASS] Manage Subscriptions modal opened via sidebar button
Saved screenshot: responsive_webmail_subscriptions_modal.png

--- Testing Module Switching & Progressive Scroll Indicator ---
Switching to Calendar module via Bottom Fixed Bar...
  [PASS] Calendar module rendered via Bottom Fixed Bar switch
Saved screenshot: responsive_webmail_mobile_calendar.png
Switching back to Mail module via Bottom Fixed Bar...
  [PASS] Progressive message count indicator ([data-testid="inbox-message-count"]) is present
Current message count indicator: "24 messages"
  [PASS] Progressive scroll count displayed without 50-per-page pagination buttons
  [PASS] Rigid previous/next page buttons are completely removed

--- SECTION 2: Webmail Tablet Viewport (768x1024) ---
  [PASS] Bottom Fixed Bar remains visible on 768px tablet viewport
  [PASS] Compose FAB remains visible on 768px tablet viewport
Saved screenshot: responsive_webmail_tablet.png

--- SECTION 3: Support CRM Mobile Viewport (375x812) ---
Navigating to http://localhost:3003...
CRM Mobile Viewport width: 375px, document scrollWidth: 375px
  [PASS] No horizontal scrolling in Support CRM on 375px mobile viewport
  [PASS] No unhandled Runtime Error overlay in Support CRM
  [PASS] No unhandled database query failed error in Support CRM
  [PASS] CRM Mobile Menu hamburger button ([data-testid="crm-mobile-menu-btn"]) is present
  [PASS] CRM Mobile Bottom Navigation Bar ([data-testid="crm-bottom-nav"]) is present
Saved screenshot: responsive_crm_mobile_tickets.png
Opening Support CRM mobile drawer...
Saved screenshot: responsive_crm_mobile_drawer.png
Testing ticket detail adaptive flow on mobile...
  [PASS] Mobile Back to Ticket Queue button ([data-testid="crm-mobile-back-to-queue"]) is present in conversation view
Saved screenshot: responsive_crm_mobile_detail.png
Clicking Back to Ticket Queue...
After clicking back button state: { hasQueueHeader: true, hasDetailHeader: false, hasTickets: true }
  [PASS] Successfully returned to Customer Ticket Queue after clicking Back button
Switching to Organizations tab via bottom navigation...
  [PASS] Clicked Orgs tab in bottom navigation
  [PASS] Organizations table is enclosed in a horizontal overflow container
Saved screenshot: responsive_crm_mobile_orgs.png

================================================================================
  ALL RESPONSIVE WEBMAIL & SUPPORT CRM BROWSER CHECKS COMPLETED SUCCESSFULLY     
================================================================================
```

### 4. Verification of Google Calendar Mobile Suite
Command: `node tests/browser/calendar_mobile_responsive_verification.mjs`
Output:
```
================================================================================
        GOOGLE CALENDAR MOBILE RESPONSIVE SUBSYSTEM BROWSER VERIFICATION        
================================================================================

--- [STEP 1] Real login flow on 375px mobile viewport ---
  Successfully logged in as Alice on mobile.

--- [STEP 2] Navigate to Calendar via Bottom Bar ---
  PASS: CalendarView mounted on mobile

--- [STEP 3] Assert Zero Horizontal Overflow on 375px ---
  Document scrollWidth: 375px, clientWidth: 375px
  PASS: document.documentElement.scrollWidth <= 375px
  PASS: document.body.scrollWidth <= 375px

--- [STEP 4] Google Calendar Mobile Top Header Verification ---
  PASS: MobileCalendarHeader is rendered
  PASS: Hamburger navigation drawer button exists
  PASS: Interactive Period Title with dropdown chevron exists
  PASS: Dynamic Today date page icon exists
  PASS: Search toggle button exists in mobile header

--- [STEP 5] Google Calendar FAB (+) Verification ---
  PASS: MobileCalendarFab button is rendered
  FAB dimensions: 56x56px, bottom margin: 80px
  PASS: FAB is floating safely above BottomFixedBar

--- [STEP 6] Google Calendar Schedule View (Agenda) Verification ---
  PASS: Google Calendar Schedule (Agenda) view is active by default
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\calendar_mobile_375px_schedule.png

--- [STEP 7] Collapsible Month Dropdown Verification ---
  PASS: Mini-month picker dropdown expands below header
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\calendar_mobile_375px_month_dropdown.png
  PASS: Mini-month picker dropdown dismissed on backdrop tap

--- [STEP 8] Mobile Slide-Out Navigation Drawer Verification ---
  PASS: Slide-out navigation drawer opened
  PASS: Drawer contains Schedule View switcher
  PASS: Drawer contains Day View switcher
  PASS: Drawer contains 3 Days View switcher
  PASS: Drawer contains Week View switcher
  PASS: Drawer contains Month View switcher
  PASS: Drawer contains Google Calendar Tasks toggle row
  PASS: Tasks toggle row label clicked successfully
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\calendar_mobile_375px_drawer.png

--- [STEP 9] Google Calendar Split Month View Verification ---
  PASS: MobileMonthSplitView mounted cleanly on mobile
  PASS: Top half has authentic 7x6 month grid (42 cells)
  Period title before swipe: "November 2026", after swipe: "December 2026"
  PASS: Touch swipe left navigated to next month
  PASS: Zero horizontal overflow in Mobile Split Month view
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\calendar_mobile_375px_month_split.png

--- [STEP 10] 3-Day View Verification ---
  PASS: Zero horizontal overflow in 3-Day view
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\calendar_mobile_375px_3days.png

--- [STEP 11] Day View Verification ---
  PASS: Zero horizontal overflow in Day view
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\calendar_mobile_375px_day.png

--- [STEP 12] FAB Event Creation Sheet Verification ---
  PASS: EventModal opens as mobile bottom sheet on FAB tap
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\calendar_mobile_375px_fab_modal.png
  PASS: Event saved and modal sheet dismissed

--- [STEP 13] DevTools Network & Storage State Capture ---
  localStorage keys: [
  'byos_week_start',
  'byos_unified_inbox_excluded',
  'byos_layout',
  'byos_time_format',
  'byos_calendar_settings_c0000000-0000-0000-0000-000000000001',
  'byos_calendar_offline_cache_c0000000-0000-0000-0000-000000000001',
  'byos_language',
  'byos_theme',
  'byos_connected_accounts',
  'byos_session_generation',
  'byos_density',
  'byos_view_mode'
]
Captured 93 calendar network requests.
  PASS: No console errors: 

================================================================================
       ALL GOOGLE CALENDAR MOBILE RESPONSIVE VERIFICATIONS PASSED               
================================================================================
```

### 5. Webmail Unit Test Suite
Command: `npm.cmd test --prefix apps/webmail`
Output:
```
OVERALL: 643 passed, 0 failed
```

## Manual browser verification
1. **Support CRM Verification**: Navigated to `http://localhost:3003`. Verified the ticket queue loaded 3 database tickets without any `Runtime Error: {"error":"database query failed"}`. Verified selecting a ticket loads the conversation thread and reply composer, and navigating to Organizations and Audit Logs tabs loads all rows seamlessly. Screenshots saved:
   - `tests/browser/artifacts/support_crm_tickets_initial.png`
   - `tests/browser/artifacts/support_crm_ticket_detail.png`
   - `tests/browser/artifacts/support_crm_organizations_tab.png`
   - `tests/browser/artifacts/support_crm_real_audit_logs.png`
2. **Mobile Email Card Reference (Image 2) Verification**: Navigated to `http://127.0.0.1:3001` at 375px viewport. Verified the message cards render the circular silhouette avatar chip on the left, Row 1 (Sender + Date), Row 2 (Subject), and Row 3 (Snippet + Star). Verified long-pressing (550ms) selects the item and flips the circular chip to a checkmark, and direct tap deselects. Screenshots saved:
   - `tests/browser/artifacts/responsive_webmail_mobile_email_card_reference.png`
   - `tests/browser/artifacts/responsive_webmail_mobile_hold_to_select.png`
   - `tests/browser/artifacts/responsive_webmail_mobile_inbox.png`
3. **Calendar Verification**: Verified Day and Week views no longer display the building icon or "Office" text. Verified interactive hour slot hover previews with "+ New Event" time indicator pill and pulsing current time beacon. Screenshots saved:
   - `tests/browser/artifacts/calendar_mobile_375px_day.png`
   - `tests/browser/artifacts/calendar_mobile_375px_schedule.png`
   - `tests/browser/artifacts/calendar_mobile_375px_month_split.png`

## What did not work or is untested
- Live production WebAuthn biometrics (simulated via development mock token `mock-support-agent`).
- Postfix SMTP outbound delivery to external DNS MX hosts (verified locally via `byos-mailpit` on port 1025).
