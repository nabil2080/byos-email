# Notes UI Consistency & Mobile Navigation Drawer Report

## What was built

This change set finishes the Notes UI cleanup that was interrupted by an API outage on 2026-11-13 at 19:02 local time, and implements the follow-up request from the same session.

1. **Note color system removed from the UI.** The editor color-palette popover, the per-note editor background tint, the per-note list-row tint, and the list color dot are gone. `getColorTheme()`, `showPaletteMenu`, and the `editorBgClass()` indirection were deleted, along with the now-unused `NOTE_COLORS` import in `NotesEditor.tsx`.
2. **One canvas, one surface.** Mail, Calendar, and Notes now share the same main canvas (`bg-[#F0EEE9] dark:bg-[#18191D]`) and card surface (`bg-white dark:bg-[#18191D]`). The Notes list pane, workspace card, editor pane, and image toolbar no longer use `#1E2025` / `#FAF9F5` / `#14161A`.
3. **Editor opens only on click.** The desktop auto-select-first-note effect was replaced by a deselect-when-filtered-out effect. A fresh load shows the empty state until a note is clicked.
4. **Phone layout matches Mail and Calendar.** Notes now opens on the note list, and the navigation is an overlay drawer: fixed, flush left, `w-72 max-w-[85vw]`, `md:hidden`, dimmed backdrop, closing on backdrop click, nav selection, the existing header close button, and `Escape`.

Scope decision: `color` still exists in the note data model, in sync payloads, and in export code. It no longer drives any UI. Removing it from the model would touch `notesStore.ts`, `notesSync.ts`, `documentExport.ts`, and multiple test fixtures, so it was deliberately left out of this UI-scoped change.

## Files edited

| File | Reason |
|------|--------|
| `apps/webmail/src/components/notes/NotesEditor.tsx` | Removed the color palette popover (prior part of this change set), deleted dead `getColorTheme`/`showPaletteMenu`/`editorBgClass` code, hard-coded the neutral editor surface, aligned the image toolbar bar, removed a stray `Reminder Popover` comment left where the palette used to be. |
| `apps/webmail/src/components/notes/NotesView.tsx` | Mobile navigation is now a fixed overlay drawer with backdrop and Escape handling; content column stays visible under the drawer; sidebar shell exposed as `notes-sidebar-shell` for measurement; card dark surface aligned to `#18191D`; stale JSX comment formatting repaired. |
| `apps/webmail/src/components/notes/NotesList.tsx` | Neutral list pane, header, and search-bar surfaces (`bg-white` / `dark:bg-[#18191D]`) instead of `#1E2025` / `#FAF9F5` (prior part of this change set). |
| `apps/webmail/src/components/notes/NotesListItem.tsx` | Removed per-note background tint, the color swatch dot, `NOTE_COLORS` import, and the `colorTheme()` / `getColorBorder()` helpers (prior part of this change set). |
| `tests/browser/notes_mobile_drawer.mjs` | New browser suite covering list-first mobile entry, zero horizontal scroll at 375px, drawer geometry, backdrop, three dismissal paths, desktop 256px inline sidebar, no desktop backdrop, and editor-on-click; also captures console messages, failed requests, `>=400` responses, and storage keys at the final assertion. |
| `tests/browser/verify_notes_ui_consistency.mjs` | Retired the palette assertions that no longer apply: icon mapping now expects five icons plus the absence of the palette button; STEP 7 asserts the palette UI is absent; STEP 8 asserts neutral surfaces after reload. Approved by the user in this session. |
| `tests/browser/verify_notes_three_pane_redesign.mjs` | Added an explicit click on the first note after the reload, before STEP 5C, because auto-select was removed by request. Approved by the user in this session. |
| `docs/notes_ui_consistency_report.md` | This report. |

## Raw evidence

### Working tree state

```
 M apps/webmail/src/components/notes/NotesEditor.tsx
 M apps/webmail/src/components/notes/NotesList.tsx
 M apps/webmail/src/components/notes/NotesListItem.tsx
 M apps/webmail/src/components/notes/NotesView.tsx
 M tests/browser/verify_notes_three_pane_redesign.mjs
 M tests/browser/verify_notes_ui_consistency.mjs
?? docs/notes_ui_consistency_report.md
?? tests/browser/notes_mobile_drawer.mjs
```

```
 apps/webmail/src/components/notes/NotesEditor.tsx  |  69 +-----------
 apps/webmail/src/components/notes/NotesList.tsx    |   6 +-
 .../webmail/src/components/notes/NotesListItem.tsx |  25 +----
 apps/webmail/src/components/notes/NotesView.tsx    |  61 ++++++-----
 tests/browser/verify_notes_three_pane_redesign.mjs |   5 +
 tests/browser/verify_notes_ui_consistency.mjs      | 121 +++++++--------------
 6 files changed, 89 insertions(+), 198 deletions(-)
```

The four source files were already modified by the previous (interrupted) turn; the two test files and the new browser suite are from this turn.

### TypeScript

Command: `cd apps/webmail; node node_modules\typescript\bin\tsc --noEmit`

```
src/offline.test.ts(460,14): error TS2345: Argument of type 'boolean | undefined' is not assignable to parameter of type 'boolean'.
  Type 'undefined' is not assignable to type 'boolean'.
src/offline.test.ts(619,14): error TS18048: 'storedItem' is possibly 'undefined'.
src/offline.test.ts(620,14): error TS18048: 'storedItem' is possibly 'undefined'.
src/offline.test.ts(621,14): error TS18048: 'storedItem' is possibly 'undefined'.
src/offline.test.ts(622,14): error TS18048: 'storedItem' is possibly 'undefined'.
src/offline.test.ts(623,28): error TS18048: 'storedItem' is possibly 'undefined'.
src/offline.test.ts(624,14): error TS18048: 'storedItem' is possibly 'undefined'.
src/offline.test.ts(625,14): error TS18048: 'storedItem' is possibly 'undefined'.
src/offline.test.ts(626,14): error TS18048: 'storedItem' is possibly 'undefined'.
src/offline.test.ts(626,14): error TS2345: Argument of type 'boolean | undefined' is not assignable to parameter of type 'boolean'.
  Type 'undefined' is not assignable to type 'boolean'.
src/offline.test.ts(861,14): error TS2345: Argument of type 'boolean | undefined' is not assignable to parameter of type 'boolean'.
  Type 'undefined' is not assignable to type 'boolean'.
```

All 12 diagnostics are in `src/offline.test.ts`; none are in `src/components/notes/`. That file is not in the `git status` list above, so it is identical to `HEAD` and none of these diagnostics were introduced by this change.

### Biome (new diagnostics check)

HEAD copies of the four notes components were linted in a temporary directory and compared with the working-tree copies.

```
HEAD copies:
Checked 4 files in 68ms. No fixes applied.
Found 8 errors.
Found 15 warnings.

Working tree:
Checked 4 files in 51ms. No fixes applied.
Found 8 errors.
Found 13 warnings.
```

The working tree adds no errors. The two fewer warnings are the deleted dead helpers. Remaining diagnostics are pre-existing lint debt at lines unrelated to this change (e.g. `NotesView.tsx:6`, `NotesView.tsx:41`, `NotesView.tsx:108`, `NotesEditor.tsx:135`, `NotesEditor.tsx:259`).

`tests/browser/` is outside the Biome scope: `apps/webmail/biome.json` includes only `src/**`, `vite.config.ts`, `vitest.config.ts`, `package.json` and `tsconfig.json`, so linting the new suite reports `No files were processed` rather than diagnostics. The new script is therefore unlinted, consistent with every other file in that directory.

### Unit suite

Command: `cd apps/webmail; npm test` (run via `cmd /c` because PowerShell blocks `npm.ps1`)

Per-suite counters emitted by the runner:

```
ATTACHMENT CRYPTO TESTS: 22 passed, 0 failed
TOTP TESTS: 5 passed, 0 failed
DATE TIME TESTS: 10 passed, 0 failed
FILE TYPE TESTS: 10 passed, 0 failed
MULTI ACCOUNT TESTS: 70 passed, 0 failed
PASSWORD REWRAP TESTS: 1 passed, 0 failed
PATH A COMPOSE TESTS: 10 passed, 0 failed
PATH A READ TESTS: 9 passed, 0 failed
MIME PARSER TESTS: 11 passed, 0 failed
SIGNATURE TESTS: 11 passed, 0 failed
REPLY SIGNATURE TESTS: 6 passed, 0 failed
MBOX STREAM TESTS: 7 passed, 0 failed
MBOX LABELS TESTS: 8 passed, 0 failed
IMPORT QUEUE TESTS: 3 passed, 0 failed
CONVERSATION THREADING TESTS: 6 passed, 0 failed
UNDO SEND TESTS: 5 passed, 0 failed
KEYBOARD SHORTCUTS TESTS: 5 passed, 0 failed
SNOOZE TESTS: 2 passed, 0 failed
SCHEDULED FOLDER TESTS: 15 passed, 0 failed
DISPLAY PARTY TESTS: 13 passed, 0 failed
NESTED LABELS TESTS: 4 passed, 0 failed
API ERROR HANDLING TESTS: 4 passed, 0 failed
UNIFIED INBOX TESTS: 19 passed, 0 failed
MASKED EMAIL TESTS: 11 passed, 0 failed
FOCUSED INBOX TESTS: 6 passed, 0 failed
OFFLINE SUPPORT TESTS: 18 passed, 0 failed
COMPOSER SANITIZER TESTS: 10 passed, 0 failed
CONTACTS MANAGEMENT TESTS: 7 passed, 0 failed
SIDEBAR BORDERLESS TESTS: 2 passed, 0 failed
PROFILE PHOTO TESTS: 4 passed, 0 failed
PERSISTENT SESSION TESTS: 8 passed, 0 failed
OAUTH IMPORT TESTS: 6 passed, 0 failed
CALENDAR RRULE TESTS: 8 passed, 0 failed
CALENDAR CRYPTO TESTS: 10 passed, 0 failed
CALENDAR ICS TESTS: 36 passed, 0 failed
CALENDAR PERSISTENCE SECURITY TESTS: 10 passed, 0 failed
CALENDAR REPO INTEGRATION TESTS: 5 passed, 0 failed
HISTORICAL KEY REACTIVATION TESTS: 15 passed, 0 failed
CALENDAR RECOVERY TESTS: 10 passed, 0 failed
CALENDAR RECURRENCE EXCEPTIONS TESTS: 5 passed, 0 failed
CALENDAR EXTERNAL INVITATIONS TESTS: 10 passed, 0 failed
CALENDAR SHARING TESTS: 10 passed, 0 failed
CALENDAR SETTINGS TESTS: 7 passed, 0 failed
CALENDAR MANAGEMENT TESTS: 6 passed, 0 failed
CALENDAR HOLIDAY & RELIGIOUS TESTS: 5 passed, 0 failed
CALENDAR YEAR VIEW TESTS: 6 passed, 0 failed
CALENDAR CATEGORIES 01, 02, 03 TESTS: 12 passed, 0 failed
CALENDAR CATEGORIES 01, 02, 03 TESTS: 12 passed, 0 failed
CALENDAR CATEGORY 04 TESTS: 6 passed, 0 failed
CALENDAR CATEGORY 05 TESTS: 7 passed, 0 failed
CALENDAR CATEGORY 05 TESTS: 7 passed, 0 failed
CALENDAR CATEGORY 06 TESTS: 7 passed, 0 failed
CALENDAR CATEGORY 06 TESTS: 7 passed, 0 failed
CALENDAR CATEGORY 07 TESTS: 9 passed, 0 failed
CALENDAR CATEGORY 07 TESTS: 9 passed, 0 failed
CALENDAR CATEGORY 08 TESTS: 8 passed, 0 failed
CALENDAR CATEGORY 10 TESTS: 8 passed, 0 failed
CALENDAR CATEGORY 11 TESTS: 9 passed, 0 failed
CALENDAR CATEGORY 12 TESTS: 9 passed, 0 failed
CALENDAR CATEGORY 13 TESTS: 9 passed, 0 failed
CALENDAR CATEGORY 14 TESTS: 9 passed, 0 failed
CALENDAR CATEGORY 14 TESTS: 9 passed, 0 failed
CALENDAR CATEGORY 15 TESTS: 9 passed, 0 failed
CALENDAR CATEGORY 15 TESTS: 9 passed, 0 failed
WEBMAIL NOTES SYNC TESTS: 11 passed, 0 failed
UNLOCK & 2FA PERSISTENCE TESTS: 5 passed, 0 failed
TRACK 2 & ZERO-KNOWLEDGE SECURITY TESTS: 18 passed, 0 failed
CALENDAR TRACK 3 TESTS: 8 passed, 0 failed
TRACK 4 RESILIENCE TESTS: 7 passed, 0 failed
SUBSCRIPTIONS & UNSUBSCRIBE STORE TESTS: 4 passed, 0 failed
IMAGE PRIVACY STORE TESTS: 4 passed, 0 failed
KASHCAL PARSER TESTS: 6 passed, 0 failed
TRANSLATOR & LOCALIZATION TESTS: 15 passed, 0 failed
FOLDER & TRASH TESTS: 9 passed, 0 failed
OVERALL: 718 passed, 0 failed
```

### Browser suite: notes UI consistency

Command: `node tests/browser/verify_notes_ui_consistency.mjs`

```
================================================================================
   BYOS NOTES: UI CONSISTENCY, SPACING & ACTION TOOLBAR VERIFICATION             
================================================================================

--- [STEP 1] Login Flow as Alice ---
  [PASS] [AUTH_01] Login as Alice succeeded
         Details: Account chip selector mounted

--- [STEP 2] Measure Mail Sidebar & Action Button ---
  Mail sidebar width: 256px, Compose button height: 44px
  [PASS] [SIDEBAR_MAIL_WIDTH] Mail sidebar width is 256px
         Details: Computed width: 256px, Compose button min-height: 44px

--- [STEP 3] Measure Calendar Sidebar & Action Button ---
  Calendar sidebar width: 256px, New Event button height: 44px
  [PASS] [SIDEBAR_CAL_WIDTH] Calendar sidebar width is 256px
         Details: Computed width: 256px, New Event button min-height: 44px

--- [STEP 4] Measure Notes Sidebar & Action Button ---
  Notes sidebar width: 256px, New Note button height: 44px
  [PASS] [SIDEBAR_NOTES_WIDTH] Notes sidebar width is 256px (identical to Mail and Calendar)
         Details: Computed width: 256px, New Note button min-height: 44px
  [PASS] [SIDEBAR_WIDTH_EQUALITY] Sidebar width is identical across Mail, Calendar, and Notes with 0px shift
         Details: Mail: 256px, Calendar: 256px, Notes: 256px
  [PASS] [ACTION_BUTTONS_STANDARDIZED] Sidebar action buttons share identical height (44px) and styling
         Details: Mail btn: 44px, Cal btn: 44px, Notes btn: 44px

--- [STEP 5] Verify Notes Editor Usable Width & Spacing ---
  Editor metrics (1440px): {
  paneWidth: 772,
  containerWidth: 708,
  titleWidth: 708,
  contentWidth: 708,
  leftTitleOffset: 675,
  leftContentOffset: 675
}
  [PASS] [EDITOR_CONTAINER_RATIO] Notes editor usable container width utilizes >90% of available pane width on standard desktop
         Details: Container width: 708px / 772px (91.7%)
  Editor metrics (1920px): { paneWidth: 1252, containerWidth: 1024 }
  [PASS] [EDITOR_WIDE_EXPANSION] Notes editor expands beyond 850px (reaching max-w-5xl / 1024px) on wide desktop screens
         Details: Container width on 1920px viewport: 1024px (pane: 1252px)
  [PASS] [EDITOR_TITLE_BODY_ALIGNMENT] Title textarea and document body editor align consistently with identical left offset
         Details: Title left: 675px, Content left: 675px

--- [STEP 6] Verify Notes Action Toolbar Icons ---
  [PASS] [PIN_ICON_LUCIDE] Pin button displays recognizable clean Lucide Pin icon
         Details: Pin title: "Pin note", contains Lucide pin geometry
  [PASS] [TOOLBAR_ICONS_MAPPING] Active action toolbar icons (Pin, Favorite, Reminder, Label, More) correctly mapped; retired Palette button absent
         Details: Tooltips: "Pin note", "Add to favorites", "Reminder", "Manage labels", "More note actions"; paletteBtnAbsent=true
  [PASS] [PIN_TOGGLE_ACTIVE] Pin button toggles active state and updates tooltip
         Details: Tooltip after click: "Unpin note"

--- [STEP 7] Verify Note Color System Is Retired ---
  [PASS] [COLOR_SYSTEM_RETIRED] Palette button, color picker menu and color options are absent
         Details: paletteBtn=false pickerMenu=false colorOption=false

--- [STEP 8] Verify Neutral Surfaces Across Page Reload ---
  [PASS] [NEUTRAL_SURFACES_PERSIST] Editor and list surfaces stay neutral after reload (no per-note tint or color dot)
         Details: Title: "Enterprise Architecture & Infrastructure Document", paneNeutral=true, cardNotTinted=true, colorDot=false

--- [STEP 9] Verify Save & Sync Status ---
  Save & Sync status: { saveStatus: '✓ Saved', syncStatus: 'Sync: idle' }
  [PASS] [STATUS_HEALTHY_RECOVERY] Save and Sync status report healthy accurate state without stale error
         Details: Save status: "✓ Saved", Sync status: "Sync: idle"

--- [STEP 10] Mobile 375px Viewport Scaling ---
  Mobile metrics (375px): {
  scrollWidth: 375,
  clientWidth: 375,
  hasHorizontalOverflow: false,
  editorVisible: true
}
  [PASS] [MOBILE_375PX_RESPONSIVE] Mobile 375px viewport scales seamlessly with zero horizontal overflow
         Details: ScrollWidth: 375px, ClientWidth: 375px, Overflow: false

================================================================================
   TEST SUMMARY                                                                 
================================================================================
Total checks: 16 | Passed: 16 | Failed: 0
```

### Browser suite: three-pane redesign regression

Command: `node tests/browser/verify_notes_three_pane_redesign.mjs`

```
================================================================================
   BYOS NOTES: NOTESNOOK-INSPIRED THREE-PANE WORKSPACE E2E VERIFICATION        
================================================================================

--- [STEP 1] Login Flow as Alice (alice@byos.local) ---
  [HTTP 401] GET http://127.0.0.1:3001/v1/auth/me: unauthorized

  [HTTP 429] GET http://127.0.0.1:3001/v1/mailboxes/c0000000-0000-0000-0000-000000000001/threads: Rate limit exceeded

  [PASS] [AUTH_01] Login as Alice and load session
         Details: Account chip selector displayed

--- [STEP 2] Switch to Notes Module ---
  Desktop 3-Pane Layout status: {"hasSidebar":true,"hasList":true,"hasEditor":true,"sidebarWidth":256,"listWidth":350,"editorWidth":612}
  [PASS] [LAYOUT_01] Three panes rendered simultaneously on desktop
         Details: Sidebar: 256px, List: 350px, Editor: 612px
  [PASS] [RESP_1440] Desktop 1440px has zero horizontal overflow
         Details: scrollWidth: 1440px, innerWidth: 1440px
  Saved screenshot: tests\browser\artifacts\notes_three_pane_desktop_workspace.png
  Saved screenshot: tests\browser\artifacts\notes_sidebar_and_list.png

--- [STEP 3] Create a New Note in Pane 1 ---
  Saved screenshot: tests\browser\artifacts\notes_selected_opened_in_editor.png
  [PASS] [EDITOR_01] Direct in-canvas note title and content editing
         Details: Saved note content directly

--- [STEP 4] Test Notesnook-Inspired Rich-Text Toolbar ---
  Toolbar capabilities: {"hasHeadings":true,"hasBold":true,"hasItalic":true,"hasUnderline":true,"hasStrikethrough":true,"hasBullet":true,"hasNumbered":true,"hasChecklist":true,"hasQuote":true,"hasCode":true,"hasLink":true}
  [PASS] [TOOLBAR_01] Notesnook rich-text toolbar rendered with all formatting tools
         Details: All formatting buttons present
  Saved screenshot: tests\browser\artifacts\notes_richtext_toolbar_editing.png

--- [STEP 5] Test Pinning & Favoriting Note ---
  [HTTP 404] GET http://127.0.0.1:3001/v1/mailboxes/c0000000-0000-0000-0000-000000000001/storage/retrieve?key=mailboxes%2Fc0000000-0000-0000-0000-000000000001%2Fnotes%2Fmedia%2Fimage_1794327683654_vp78z.enc: object not found in storage

  Favorites category item count: 1
  [PASS] [FAV_01] Favorite action filters note in Favorites view
         Details: Found: true
  Saved screenshot: tests\browser\artifacts\notes_favorites_label_filtering.png
  [PASS] [FAV_02] Unfavorite action removes note from Favorites view
         Details: Count after unfavorite: 0
  [HTTP 429] GET http://127.0.0.1:3001/v1/mailboxes/c0000000-0000-0000-0000-000000000001/threads: Rate limit exceeded

  [PASS] [FAV_PERSIST] Favorite state persists across reload and rehydration
         Details: Found 1 favorite notes after reload

--- [STEP 5B] Test Tablet Viewport (768x1024) ---
  [PASS] [RESP_768] Tablet 768px has zero horizontal overflow
         Details: scrollWidth: 768px, innerWidth: 768px

--- [STEP 5C] Test Existing Functionality Regression ---
  [PASS] [REG_DUP] Duplicate note action creates copy with distinct ID
         Details: Copy detected in list: true
  [PASS] [REG_CHECKLIST] Toggle checklist mode reveals interactive checklist items
         Details: Checklist rendered: true

--- [STEP 6] Test Dark Mode Workspace ---
  Saved screenshot: tests\browser\artifacts\notes_three_pane_dark_mode.png
  [PASS] [DARK_01] Dark mode renders seamlessly across 3 panes
         Details: Captured dark mode screenshot

--- [STEP 7] Test Mobile Viewport (375x667) Single-Pane Flow ---
  [HTTP 429] GET http://127.0.0.1:3001/v1/mailboxes/c0000000-0000-0000-0000-000000000001/threads: Rate limit exceeded

  [PASS] [RESP_375] Mobile 375px has zero horizontal overflow
         Details: scrollWidth: 375px, innerWidth: 375px
  Saved screenshot: tests\browser\artifacts\notes_mobile_list_view.png
  Tapping note item to open mobile editor (Pane 3)...
  Saved screenshot: tests\browser\artifacts\notes_mobile_editor_view.png
  [PASS] [MOBILE_01] Mobile responsive single-pane navigation (Sidebar -> List -> Editor -> List -> Sidebar)
         Details: 375px verified

================================================================================
                           TEST SUMMARY                                         
================================================================================
Results: 14/14 checks passed.
Network errors (5): [
  {
    url: 'http://127.0.0.1:3001/v1/auth/me',
    status: 401,
    text: 'unauthorized\n'
  },
  {
    url: 'http://127.0.0.1:3001/v1/mailboxes/c0000000-0000-0000-0000-000000000001/threads',
    status: 429,
    text: 'Rate limit exceeded\n'
  },
  {
    url: 'http://127.0.0.1:3001/v1/mailboxes/c0000000-0000-0000-0000-000000000001/storage/retrieve?key=mailboxes%2Fc0000000-0000-0000-0000-000000000001%2Fnotes%2Fmedia%2Fimage_1794327683654_vp78z.enc',
    status: 404,
    text: 'object not found in storage\n'
  },
  {
    url: 'http://127.0.0.1:3001/v1/mailboxes/c0000000-0000-0000-0000-000000000001/threads',
    status: 429,
    text: 'Rate limit exceeded\n'
  },
  {
    url: 'http://127.0.0.1:3001/v1/mailboxes/c0000000-0000-0000-0000-000000000001/threads',
    status: 429,
    text: 'Rate limit exceeded\n'
  }
]
```

The `401` on `/v1/auth/me` is the pre-login session probe; the `404` on a note media object is pre-existing test data referencing an image that is no longer in storage. Three `429 Rate limit exceeded` responses on `GET /v1/mailboxes/.../threads` appear at the suite's reload points, where the mailbox thread poller fires repeatedly within the API's per-route window. They are transient — the suite still finishes 14/14 and later polls succeed. No file in this change touches the threads endpoint or the rate limiter; the noise comes from the dev stack's limits plus the suite's reload pattern, not from the Notes UI change.

### Browser suite: mobile drawer (new)

Command: `node tests/browser/notes_mobile_drawer.mjs`

```
==============================================================================
  BYOS NOTES: MOBILE NAVIGATION DRAWER VERIFICATION
==============================================================================

--- [STEP 1] Login as Alice ---
  [PASS] [AUTH] Login as Alice succeeded
         Details: account-chip-selector mounted

--- [STEP 2] Open Notes module (desktop first) ---
  [PASS] [DESKTOP_SIDEBAR_INLINE] Desktop sidebar is the 256px in-flow pane
         Details: width=256px position=static
  [PASS] [DESKTOP_NO_BACKDROP] Desktop renders no mobile backdrop
         Details: backdrop=false
  [PASS] [EDITOR_CLICK_ONLY] Editor pane shows the empty state before any note is clicked
         Details: emptyState=true editorPane=true

--- [STEP 3] Resize to 375px phone viewport ---
  [PASS] [MOBILE_LIST_FIRST] Notes opens on the note list, not the navigation sidebar
         Details: listVisible=true sidebarVisible=false
  [PASS] [MOBILE_NO_HSCROLL] No horizontal scroll at 375px
         Details: doc=375 body=375 viewport=375

--- [STEP 4] Open the mobile navigation drawer ---
  [PASS] [MOBILE_DRAWER_OVERLAY] Drawer is a fixed overlay flush to the left edge
         Details: position=fixed left=0px top=0px
  [PASS] [MOBILE_DRAWER_WIDTH] Drawer uses the Mail/Calendar 288px drawer width (max 85vw)
         Details: width=288px (max 319px)
  [PASS] [MOBILE_DRAWER_FULL_HEIGHT] Drawer spans the full viewport height
         Details: height=760px viewport=760px
  [PASS] [MOBILE_DRAWER_BACKDROP] Dimmed backdrop is present while the drawer is open
         Details: backdropVisible=true

--- [STEP 5] Drawer dismissal paths ---
  [PASS] [DRAWER_CLOSES_BACKDROP] Backdrop click closes the drawer and returns to the list
         Details: sidebarVisible=false listVisible=true
  [PASS] [DRAWER_CLOSES_ESCAPE] Escape closes the drawer
         Details: sidebarVisible=false
  [PASS] [DRAWER_CLOSES_NAV] Selecting a navigation item closes the drawer
         Details: sidebarVisible=false listVisible=true

--- [STEP 6] Note selection opens the editor ---
  [PASS] [EDITOR_OPENS_ON_CLICK] Clicking a note opens the editor pane
         Details: noteCount=2 editorVisible=true
  [PASS] [NO_PAGE_ERRORS] No uncaught page errors during the run
         Details: none

--- DevTools state at final assertion ---
console messages: 31 (errors: 17)
  [error] Failed to load resource: the server responded with a status of 401 (Unauthorized)
  [error] Failed to load resource: the server responded with a status of 401 (Unauthorized)
  [error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [error] Failed to load resource: the server responded with a status of 404 (Not Found)
  [error] Failed to load resource: the server responded with a status of 404 (Not Found)
non-error message types: ["debug","warn"]
failed requests: none
localStorage keys: ["byos_notes_sync_queue_c0000000-0000-0000-0000-000000000001","byos_week_start","byos_unified_inbox_excluded","byos_layout","byos_time_format","byos_notes_c0000000-0000-0000-0000-000000000001","byos_note_labels_c0000000-0000-0000-0000-000000000001","byos_language","byos_theme","byos_connected_accounts","byos_session_generation","byos_density","byos_note_labels_init_byos_note_labels_c0000000-0000-0000-0000-000000000001","byos_view_mode"]
sessionStorage keys: ["byos_msg_subject_d5407593-7c3b-45c0-bfd9-15c9a7de09f0","byos_msg_subject_0a1396d2-3cfe-4e0a-a290-82cd6ac048ff","byos_msg_category_e311272b-4ef4-4f8c-87e5-3a581441c82e","byos_msg_category_bcde7268-d542-4e4b-ab31-246b85bace74","byos_msg_sender_name_d5407593-7c3b-45c0-bfd9-15c9a7de09f0","byos_msg_snippet_9e530b46-5847-4583-b1c9-2efbbb714dfc","byos_msg_category_d4a7eb57-c3cc-4970-8b75-bfdf51206b23","byos_msg_snippet_570d721f-0317-4ddd-b66b-cb289bfa99c2","byos_msg_subject_1245b15b-9a66-4376-ab8f-9160e17d7a19","byos_msg_category_c0441042-c574-426f-8495-f1427f4373f1","byos_msg_category_4bb7ab91-994b-4b67-a5ab-db11372795c3","byos_msg_subject_8c41392b-ce7f-49e6-b7a7-b3506cb1e402","byos_msg_snippet_4bb7ab91-994b-4b67-a5ab-db11372795c3","byos_msg_subject_bb06cba8-b0c5-4604-a1ea-346e4cc9f117","byos_msg_category_8c41392b-ce7f-49e6-b7a7-b3506cb1e402","byos_msg_sender_name_570d721f-0317-4ddd-b66b-cb289bfa99c2","byos_msg_snippet_bcde7268-d542-4e4b-ab31-246b85bace74","byos_msg_snippet_7205e5ee-0f40-486d-a2b2-ebca8a275221","byos_msg_subject_722e051d-4667-412d-93d1-b959f578f41b","byos_msg_sender_name_bcde7268-d542-4e4b-ab31-246b85bace74","byos_msg_subject_e311272b-4ef4-4f8c-87e5-3a581441c82e","byos_msg_category_18115ffb-6081-4232-aac9-db77bdfbd0e3","byos_msg_subject_913f61da-db27-4b06-ab01-a3fb02dcdb1e","byos_sender_email_name_invoices@stripe.com","byos_msg_subject_c0441042-c574-426f-8495-f1427f4373f1","byos_msg_snippet_8c41392b-ce7f-49e6-b7a7-b3506cb1e402","byos_sender_email_name_notifications@github.com","byos_msg_sender_name_4bb7ab91-994b-4b67-a5ab-db11372795c3","byos_msg_subject_18115ffb-6081-4232-aac9-db77bdfbd0e3","byos_sender_email_name_dan@tldr.tech","byos_msg_snippet_2e7f2b27-49f0-40a6-a997-f3822eaf21eb","byos_msg_category_23c3c4a0-9fb6-4607-87f1-ca8371b2ad70","byos_msg_subject_4bb7ab91-994b-4b67-a5ab-db11372795c3","byos_org_member_name_bob@byos.local","byos_sender_email_name_devops@byos.local","byos_msg_subject_570d721f-0317-4ddd-b66b-cb289bfa99c2","byos_msg_category_722e051d-4667-412d-93d1-b959f578f41b","byos_msg_sender_name_62547fec-370e-4718-94ec-5fe6ba9339ff","byos_msg_subject_9e530b46-5847-4583-b1c9-2efbbb714dfc","byos_msg_sender_name_23c3c4a0-9fb6-4607-87f1-ca8371b2ad70","byos_sender_email_name_design@byos.local","byos_msg_sender_name_722e051d-4667-412d-93d1-b959f578f41b","byos_msg_category_b798701e-8143-4ddf-8d35-0996015e491a","byos_view_mode","byos_msg_subject_23c3c4a0-9fb6-4607-87f1-ca8371b2ad70","byos_msg_sender_name_545ad8ab-fce0-432f-92db-7c7418e67dd4","byos_sender_email_name_newsletter@pragmaticengineer.com","byos_active_module","byos_msg_snippet_b798701e-8143-4ddf-8d35-0996015e491a","byos_msg_snippet_5f0e1e1b-5387-4f78-a653-ce54c86eda5d","byos_sender_email_name_insights@radar.cloudflare.com","byos_sender_email_name_sarah.jenkins@designsystems.io","byos_msg_subject_c8175dea-21d2-4361-941a-589e330b2d1b","byos_msg_snippet_58230f39-c1f6-4c27-adb2-ac41bf004d1d","byos_msg_snippet_1245b15b-9a66-4376-ab8f-9160e17d7a19","byos_msg_snippet_722e051d-4667-412d-93d1-b959f578f41b","byos_msg_category_9e530b46-5847-4583-b1c9-2efbbb714dfc","byos_keys_published_c0000000-0000-0000-0000-000000000001_66c3f0c7cdad753ece2c6579efbcdcef3c903cd9a87093624be739abb04a1547_77fc3d2d62addcf72bfd0674a92abacc68112f1a79a0ecaef6e3cbef4cbac7c585ec1288a13577627c81dee67c53b345e415c9da382a0aaa6690512ed7b18089514e614383aa91cb2df81918e218ac7bbca61c810ec76dab4729c9921713f27447dc984a81b2aa980f52f23567273159fbc3185111dcc84f177866ba55c2923b52edc67023b30495f78281f9c054879a096445b9764a6286826c46ccfbf9bcc153326b85252c1ca675528e2b446e98da6b3b34718ac70b82a6bfa9f7aa0c8c315b4658e936ad17a2a2391bbaa6a48787a0633a493bd4c29040f32467ec704d08751eec2e4d6b3fdc5586e9f8378f18cdb9b62ca46081e4c17d411b911cac44d1fc26d4b88dc98845133185d55a7a87a168bd354b3009b5a16ab23f15a2303c0557fc4a2c793617e68e1d373a0f0c4270636cac617e86f5616db1a29dba7f93c9ad0671992a0309fcd89ca26a20471acc33d023840ab62200915ce83925d5c8f9d09ed0b83f43c6ca0a234c5fa83b4d16759800a7b32c7d2b7a066e3a3e76e361b98469f20a1701f51a60c6aa5f0a8f291805b64c7070a41f1be65a4b0bbf31579c5d67bea933be7992afa9c8922a6cc07a7b749c4b0711863096697a28d298dad29ccf19a2c2e426871c7a1001a1ad779f3943400fe42a2d8b1f12005b03b927f1279031dc1157453b5574733f0c3dd0576b5a48651679c9bcf1cdbff61b8f06ba7743975a0717c8360b69fa4e7882bd5aaace340159bcf2671b30517ad4bbdd37c1036998312aace9012f3548a358822bc5396fdff8a611a2c6f4809067bc3e45f22254769ecd58ccd0933d65f448b78517856a0d64739e93e79091e83223dc8d4193aa1dcb6c29b24529f7929650c59ee0060b00741fab17a21c9cd1d4543ec26be272183ef5ac6ee0b4c57752dc693c7fca335389c78009631617c5ac272d45e51017728e0c05820480cdaad4659d6693fdf37c55163face41f52b9c0fc1035f79124adfa8ad49a04223b98797521e8a742bb984823d67995351bb8897a23233b7da89166fc435ba76aef710f44e7c1e7d648c011bbd81551bf5aa9c4a7aa2b9030207b27ff15304fc9026ee11fbe6246589b76cd81a51359731edb599dea0cc98957656a8190607e467c88ee01023829ba3da5cb9fd121582b3ed5452b7cc517091b47927b8fd61101e9eb1658e14224a28e58e80ecbf715abf1a23a70c6cdf40d620683e317bc6746961c5a84ff409fa1ba6a26b102a4852a2b058dbe25996c46aded97a11dbb0828708576b411fc19497d60be66f2c5bad31b43e998ab578e0023b349f29cba09af2549a4f3ab518da771a62c0dc2b3244a7830f4b83575c07946659866b17d15f70362bb248eba5758dcb3e16b3c03f726fefa4c38c8852f64aaf03c7d43a36bc332262b635d00bd080f769534b38be64c73ba6b372ecb285d350c8fcabf64e8c869173eda1a571b7896a5db035bb03827334fb56c499ca07e9633ac59099d41f50793947535b4c85f61b864ab51c1784abe52625886a24f2860725b400be67939690f51bc5f11051003c300557a026f027d00d19e9d5a8cc3a628b41b6d0e82a5a3e349125b20c7605fea600a56d51392638c5de83f48a4f408c972fda7ef036b0550eab637af44adcbe0e1372bdd33a45db33e4e7f624de4568a887751db1b5810e25545652a7bd5a53d6b6b1009200e34c3265a5a","byos_msg_sender_name_f1e6a098-a073-4503-a2c4-c9a59de22081","byos_sender_email_name_legal@byos.local","byos_msg_subject_5f0e1e1b-5387-4f78-a653-ce54c86eda5d","byos_msg_subject_545ad8ab-fce0-432f-92db-7c7418e67dd4","byos_msg_sender_name_e311272b-4ef4-4f8c-87e5-3a581441c82e","byos_connected_accounts","byos_msg_subject_f1e6a098-a073-4503-a2c4-c9a59de22081","byos_msg_snippet_e311272b-4ef4-4f8c-87e5-3a581441c82e","byos_msg_category_bb06cba8-b0c5-4604-a1ea-346e4cc9f117","byos_msg_snippet_545ad8ab-fce0-432f-92db-7c7418e67dd4","byos_msg_category_c8175dea-21d2-4361-941a-589e330b2d1b","byos_msg_sender_name_c8175dea-21d2-4361-941a-589e330b2d1b","byos_msg_category_2e7f2b27-49f0-40a6-a997-f3822eaf21eb","byos_msg_category_58230f39-c1f6-4c27-adb2-ac41bf004d1d","byos_sender_email_name_david.chen@byos.local","byos_sender_email_name_bob@byos.local","byos_msg_subject_bcde7268-d542-4e4b-ab31-246b85bace74","byos_msg_category_f1e6a098-a073-4503-a2c4-c9a59de22081","byos_msg_category_02fa1dd8-583a-4953-a28d-2e6b761ca6af","byos_msg_snippet_18115ffb-6081-4232-aac9-db77bdfbd0e3","byos_msg_sender_name_2e7f2b27-49f0-40a6-a997-f3822eaf21eb","byos_msg_subject_ac8f7cee-a837-4893-812f-86d6955cc1d8","byos_msg_subject_58230f39-c1f6-4c27-adb2-ac41bf004d1d","byos_sender_email_name_promotions@crypto-moon-yields-889.xyz","byos_msg_snippet_62547fec-370e-4718-94ec-5fe6ba9339ff","byos_msg_category_d5407593-7c3b-45c0-bfd9-15c9a7de09f0","byos_msg_category_62547fec-370e-4718-94ec-5fe6ba9339ff","byos_msg_category_913f61da-db27-4b06-ab01-a3fb02dcdb1e","byos_msg_category_1245b15b-9a66-4376-ab8f-9160e17d7a19","byos_msg_subject_d4a7eb57-c3cc-4970-8b75-bfdf51206b23","byos_msg_subject_02fa1dd8-583a-4953-a28d-2e6b761ca6af","byos_msg_sender_name_178aa67f-fa69-4b84-9faa-29a88e1219e3","byos_msg_sender_name_913f61da-db27-4b06-ab01-a3fb02dcdb1e","byos_session_generation","byos_msg_snippet_c0441042-c574-426f-8495-f1427f4373f1","byos_msg_snippet_0a1396d2-3cfe-4e0a-a290-82cd6ac048ff","byos_msg_subject_2edb7c58-7024-4f9b-af8c-35fd02cd4277","byos_msg_subject_62547fec-370e-4718-94ec-5fe6ba9339ff","byos_msg_subject_8a52f560-a555-469f-83fc-ea829001eaec","byos_msg_snippet_8a52f560-a555-469f-83fc-ea829001eaec","byos_msg_sender_name_b798701e-8143-4ddf-8d35-0996015e491a","byos_msg_category_570d721f-0317-4ddd-b66b-cb289bfa99c2","byos_msg_category_5f0e1e1b-5387-4f78-a653-ce54c86eda5d","byos_msg_category_967cb198-af02-4847-84af-040d944b2c77","byos_msg_subject_2e7f2b27-49f0-40a6-a997-f3822eaf21eb","byos_sender_email_name_alice@byos.local","byos_msg_subject_178aa67f-fa69-4b84-9faa-29a88e1219e3","byos_msg_category_7205e5ee-0f40-486d-a2b2-ebca8a275221","byos_msg_snippet_f1e6a098-a073-4503-a2c4-c9a59de22081","byos_msg_sender_name_c0441042-c574-426f-8495-f1427f4373f1","byos_msg_category_545ad8ab-fce0-432f-92db-7c7418e67dd4","byos_msg_category_0a1396d2-3cfe-4e0a-a290-82cd6ac048ff","byos_msg_snippet_bb06cba8-b0c5-4604-a1ea-346e4cc9f117","byos_msg_snippet_c8175dea-21d2-4361-941a-589e330b2d1b","byos_msg_snippet_967cb198-af02-4847-84af-040d944b2c77","byos_msg_sender_name_8a52f560-a555-469f-83fc-ea829001eaec","byos_msg_subject_967cb198-af02-4847-84af-040d944b2c77","byos_msg_category_8a52f560-a555-469f-83fc-ea829001eaec","byos_msg_snippet_02fa1dd8-583a-4953-a28d-2e6b761ca6af","byos_msg_snippet_ac8f7cee-a837-4893-812f-86d6955cc1d8","byos_msg_snippet_d4a7eb57-c3cc-4970-8b75-bfdf51206b23","byos_session_vault","byos_sender_email_name_guild@byos.local","byos_msg_snippet_2edb7c58-7024-4f9b-af8c-35fd02cd4277","byos_msg_category_2edb7c58-7024-4f9b-af8c-35fd02cd4277","byos_msg_sender_name_7205e5ee-0f40-486d-a2b2-ebca8a275221","byos_msg_sender_name_02fa1dd8-583a-4953-a28d-2e6b761ca6af","byos_msg_subject_7205e5ee-0f40-486d-a2b2-ebca8a275221","byos_msg_snippet_178aa67f-fa69-4b84-9faa-29a88e1219e3","byos_msg_snippet_913f61da-db27-4b06-ab01-a3fb02dcdb1e","byos_msg_snippet_23c3c4a0-9fb6-4607-87f1-ca8371b2ad70","byos_msg_subject_b798701e-8143-4ddf-8d35-0996015e491a","byos_msg_category_178aa67f-fa69-4b84-9faa-29a88e1219e3","byos_org_member_name_alice@byos.local","byos_msg_category_ac8f7cee-a837-4893-812f-86d6955cc1d8","byos_msg_sender_name_2edb7c58-7024-4f9b-af8c-35fd02cd4277","byos_sender_email_name_hr@byos.local","byos_msg_snippet_d5407593-7c3b-45c0-bfd9-15c9a7de09f0"]
error responses (17):
  2x 401 http://127.0.0.1:3001/v1/auth/me
  1x 404 http://127.0.0.1:3001/v1/keys/notifications%40github.com
  2x 404 http://127.0.0.1:3001/v1/keys/david.chen%40byos.local
  1x 404 http://127.0.0.1:3001/v1/keys/promotions%40crypto-moon-yields-889.xyz
  1x 404 http://127.0.0.1:3001/v1/keys/newsletter%40pragmaticengineer.com
  1x 404 http://127.0.0.1:3001/v1/keys/dan%40tldr.tech
  1x 404 http://127.0.0.1:3001/v1/keys/devops%40byos.local
  1x 404 http://127.0.0.1:3001/v1/keys/insights%40radar.cloudflare.com
  1x 404 http://127.0.0.1:3001/v1/keys/sarah.jenkins%40designsystems.io
  1x 404 http://127.0.0.1:3001/v1/keys/guild%40byos.local
  1x 404 http://127.0.0.1:3001/v1/keys/invoices%40stripe.com
  1x 404 http://127.0.0.1:3001/v1/keys/legal%40byos.local
  1x 404 http://127.0.0.1:3001/v1/keys/design%40byos.local
  1x 404 http://127.0.0.1:3001/v1/keys/hr%40byos.local
  1x 404 http://127.0.0.1:3001/v1/mailboxes/c0000000-0000-0000-0000-000000000001/storage/retrieve

==============================================================================
  SUMMARY: 15/15 checks passed
==============================================================================
```

DevTools notes for this run: 31 console messages, 17 of them errors, and every one of the 17 maps to an HTTP failure captured by the response listener — `2x 401 /v1/auth/me` (pre-login session probe), `14x 404 /v1/keys/<sender>` (key discovery for seeded inbox senders that have no published key), and `1x 404 /v1/mailboxes/.../storage/retrieve` (a note image whose blob is no longer in storage). `failed requests: none`, so nothing was aborted at the network layer. Non-error console types are only `debug` (Vite HMR) and `warn` (Solid dev-mode `createRoot` notices). No `pageerror` was raised (`[NO_PAGE_ERRORS]`). localStorage holds the notes ciphertext (`byos_notes_c0000000-...`), the notes sync queue, note labels, theme/layout/density, connected accounts and the session generation; sessionStorage holds the per-message preview cache and the session vault key.

### Browser suite: WYSIWYG and title wrapping regression

Command: `node tests/browser/test_notes_wysiwyg_and_title_wrapping.mjs`

```
================================================================================
   BYOS NOTES: WYSIWYG RICH-TEXT & MULTILINE TITLE WRAPPING VERIFICATION        
================================================================================

--- [STEP 1] Login Flow as Alice ---
  [PASS] [AUTH_01] Login as Alice succeeded
         Details: Session loaded

--- [STEP 2] Navigate to Notes Module ---

--- [STEP 3] Create a New Note for WYSIWYG & Title Testing ---
  [PASS] [TITLE_TAG] Title input is rendered as textarea element
         Details: Tag: textarea

--- [STEP 4] Test WYSIWYG Inline Formatting ---
  Selected 'zero-knowledge': true
  Selected 'architecture': true
  Selected 'confidentiality': true
  Selected 'absolute': true
  Inline DOM evaluation: {"html":"<p>The <b>zero-knowledge</b> <i>architecture</i> guarantees <u>confidentiality</u> and <strike>absolute</strike> privacy.</p>","text":"The zero-knowledge architecture guarantees confidentiality and absolute privacy.","hasBoldTag":true,"hasItalicTag":true,"hasUnderlineTag":true,"hasStrikeTag":true,"hasRawMarkdownAsterisks":false,"hasRawMarkdownTildes":false}
  [PASS] [WYSIWYG_BOLD] Bold visually renders via <b>/<strong> without literal ** syntax
         Details: Bold tag: true
  [PASS] [WYSIWYG_ITALIC] Italic visually renders via <i>/<em> without literal * syntax
         Details: Italic tag: true
  [PASS] [WYSIWYG_UNDERLINE] Underline visually renders via <u> element
         Details: Underline tag: true
  [PASS] [WYSIWYG_STRIKE] Strikethrough visually renders via <s>/<strike> without literal ~~ syntax
         Details: Strike tag: true
  Saved screenshot: tests\browser\artifacts\notes_wysiwyg_inline_formatting.png

--- [STEP 5] Test Combined Formatting (Bold + Italic) ---
  Selected 'privacy': true
  [PASS] [WYSIWYG_COMBINED] Combined formatting (Bold + Italic) visually applies to identical selection
         Details: HTML contains nested bold & italic tags: true
  Saved screenshot: tests\browser\artifacts\notes_wysiwyg_combined_formatting.png

--- [STEP 6] Test Headings and Lists Formatting ---
  [PASS] [WYSIWYG_H1] Heading 1 formats as native <h1> element
         Details: h1: true
  [PASS] [WYSIWYG_LIST] Bulleted list formats as native <ul><li> elements
         Details: ul: true
  Saved screenshot: tests\browser\artifacts\notes_wysiwyg_headings_and_lists.png

--- [STEP 7] Test Multiline Title Wrapping (Desktop 1440px) ---
  Desktop Title metrics: {"tagName":"textarea","clientHeight":117,"scrollHeight":117,"clientWidth":708,"scrollWidth":708,"whiteSpace":"pre-wrap","wordBreak":"normal","hasHorizontalOverflow":false,"isMultiLine":true}
  [PASS] [TITLE_WRAP_DESKTOP] Long title expands vertically across multiple lines without horizontal overflow on desktop
         Details: Height: 117px, MultiLine: true, HorizOverflow: false
  Saved screenshot: tests\browser\artifacts\notes_title_wrapping_multiline_desktop.png

--- [STEP 8] Test Multiline Title Wrapping (Mobile 375px) ---
  Mobile on list -> tapping note to open editor...
  Mobile Title metrics (375px): {"clientHeight":184,"scrollHeight":184,"clientWidth":329,"scrollWidth":329,"pageScrollWidth":375,"hasPageHorizontalOverflow":false,"hasTitleHorizontalOverflow":false,"heightIncreased":true}
  [PASS] [TITLE_WRAP_MOBILE] Title wraps down seamlessly at 375px mobile viewport with zero page overflow
         Details: Title height: 184px, Page scrollWidth: 375px
  Saved screenshot: tests\browser\artifacts\notes_title_wrapping_mobile_375px.png

--- [STEP 9] Test Auto-Save and Reload Persistence ---
  Reloaded state check: {"titleValue":"Comprehensive End-to-End Cryptographic Protocol and Infrastructure Resilience Audit Report for Autonomous Distributed Workspace Architecture","hasBoldTag":true,"hasItalicTag":true,"hasUnderlineTag":true,"hasH1":true,"hasRawMarkdown":false}
  [PASS] [PERSIST_TITLE] Long multiline title persists accurately after reload
         Details: Title: Comprehensive End-to-End Cryptographic Protocol an...
  [PASS] [PERSIST_FORMAT] WYSIWYG formatting tags (<b>, <i>, <u>, <h1>) persist and rehydrate without raw markdown corruption
         Details: Bold: true, Italic: true, Underline: true, NoRawMarkdown: true

================================================================================
                           TEST SUMMARY                                         
================================================================================
Results: 13/13 checks passed.
```

## Manual browser verification

All browser runs used the real login flow (`alice@byos.local` / `test-password-123`) against the running dev stack on `http://127.0.0.1:3001`, with the real API on `:8080`. No tokens were injected and no mocks were used.

| Step | Action | Observed result | Evidence |
|------|--------|-----------------|----------|
| 1 | Log in, switch to Notes at 1440px | Three panes render; sidebar 256px; editor shows the empty state | `notes_desktop_sidebar_256px.png`, `[EDITOR_CLICK_ONLY]` line above |
| 2 | Resize to 375x760 | Note list renders first, sidebar is not mounted in flow; `doc=375 body=375` | `notes_mobile_list_375px.png`, `[MOBILE_LIST_FIRST]`, `[MOBILE_NO_HSCROLL]` |
| 3 | Tap "Views" | Drawer is `position=fixed`, `left=0`, `top=0`, `288px` wide, `760px` tall, backdrop visible | `notes_mobile_drawer_open.png`, `[MOBILE_DRAWER_*]` lines |
| 4 | Tap backdrop, then reopen and press `Escape`, then reopen and select "Favorites" | Drawer closes every time, list returns | `[DRAWER_CLOSES_*]` lines |
| 5 | Tap a note | Editor pane opens | `notes_mobile_editor_375px.png`, `[EDITOR_OPENS_ON_CLICK]` |
| 6 | Reload on desktop, click a note | Editor is neutral (`bg-white dark:bg-[#18191D]`), no tint, no color dot, no palette UI | `notes_neutral_surfaces_reload.png`, `[NEUTRAL_SURFACES_PERSIST]`, `[COLOR_SYSTEM_RETIRED]` |

## Test file changes

Diff of the two existing suites (approved in this session):

```
diff --git a/tests/browser/verify_notes_three_pane_redesign.mjs b/tests/browser/verify_notes_three_pane_redesign.mjs
index 88ff8fe..230fbfd 100644
--- a/tests/browser/verify_notes_three_pane_redesign.mjs
+++ b/tests/browser/verify_notes_three_pane_redesign.mjs
@@ -321,6 +321,11 @@ async function run() {
     await page.setViewport({ width: 1440, height: 900 });
     await sleep(400);
 
+    // Editor opens only on explicit click — select a note so toolbar actions are available.
+    await page.waitForSelector('[data-testid="notes-list-item"]', { timeout: 5000 });
+    await page.click('[data-testid="notes-list-item"]');
+    await sleep(800);
+
     // -------------------------------------------------------------------------
     // STEP 5C: Test Existing Functionality Regression (Checklist, Duplicate, Archive)
     // -------------------------------------------------------------------------
diff --git a/tests/browser/verify_notes_ui_consistency.mjs b/tests/browser/verify_notes_ui_consistency.mjs
index 598c67a..8ac430d 100644
--- a/tests/browser/verify_notes_ui_consistency.mjs
+++ b/tests/browser/verify_notes_ui_consistency.mjs
@@ -22,27 +22,24 @@
  *    - Favorite button: Star icon, correct tooltip.
  *    - Reminder button: Bell icon, correct tooltip.
  *    - Label button: Tag icon, correct tooltip.
- *    - Note Color button: Palette icon, correct tooltip.
  *    - More actions button: Three vertical dots, correct tooltip.
- * 5. Note Color Functionality:
- *    - Palette button opens compact color picker with 8 soft BYOS-branded colors.
- *    - Selecting a color updates store, auto-saves, and applies soft tint to editor and list item.
- *    - Survives page reload.
+ *    - Note Color button: retired — must not render.
+ * 5. Neutral Note Surfaces (color system retired):
+ *    - Editor pane and list rows use the neutral surface (bg-white / dark:bg-[#18191D]).
+ *    - No palette button, no color picker menu, no per-note tint or color dot.
  * 6. Save & Sync Status:
  *    - Healthy states display "✓ Saved" and "Sync: Synced" (or "Sync: idle").
  * 7. Mobile Responsiveness:
  *    - Viewport 375px scales smoothly with zero horizontal scroll.
  *
- * Saves 10 required screenshots in tests/browser/artifacts/:
+ * Saves 8 required screenshots in tests/browser/artifacts/:
  * - notes_editor_spacious_width.png
  * - notes_sidebar_standard_width.png
  * - mail_sidebar_standard_width.png
  * - calendar_sidebar_standard_width.png
  * - sidebar_action_buttons_comparison.png
  * - notes_action_toolbar_icons.png
- * - notes_color_picker_open.png
- * - notes_color_selected_background.png
- * - notes_color_persisted_reload.png
+ * - notes_neutral_surfaces_reload.png
  * - notes_editor_mobile_375px.png
  */
 
@@ -353,7 +350,6 @@ async function runSuite() {
       const favSvg = favBtn?.querySelector("svg")?.innerHTML || "";
       const remSvg = remBtn?.querySelector("svg")?.innerHTML || "";
       const lblSvg = lblBtn?.querySelector("svg")?.innerHTML || "";
-      const palSvg = palBtn?.querySelector("svg")?.innerHTML || "";
       const morSvg = morBtn?.querySelector("svg")?.innerHTML || "";
 
       return {
@@ -361,14 +357,13 @@ async function runSuite() {
         favTitle: favBtn?.getAttribute("title"),
         remTitle: remBtn?.getAttribute("title"),
         lblTitle: lblBtn?.getAttribute("title"),
-        palTitle: palBtn?.getAttribute("title"),
         morTitle: morBtn?.getAttribute("title"),
+        paletteBtnAbsent: !palBtn,
         hasPinLine: pinSvg.includes('line x1="12" y1="17" x2="12" y2="22"'),
         hasPinPath: pinSvg.includes("M5 17h14v-1.76"),
         hasFavPolygon: favSvg.includes("polygon points="),
         hasRemPath: remSvg.includes("M18 8A6 6"),
         hasLblPath: lblSvg.includes("M20.59 13.41"),
-        hasPalCircles: palSvg.includes("circle cx="),
         hasMorCircles: morSvg.includes("circle cx="),
       };
     });
@@ -382,13 +377,13 @@ async function runSuite() {
 
     recordResult(
       "TOOLBAR_ICONS_MAPPING",
-      "All action toolbar icons (Pin, Favorite, Reminder, Label, Palette, More) correctly mapped",
+      "Active action toolbar icons (Pin, Favorite, Reminder, Label, More) correctly mapped; retired Palette button absent",
       toolbarInfo.hasFavPolygon &&
         toolbarInfo.hasRemPath &&
         toolbarInfo.hasLblPath &&
-        toolbarInfo.hasPalCircles &&
-        toolbarInfo.hasMorCircles,
-      `Tooltips: "${toolbarInfo.pinTitle}", "${toolbarInfo.favTitle}", "${toolbarInfo.remTitle}", "${toolbarInfo.lblTitle}", "${toolbarInfo.palTitle}", "${toolbarInfo.morTitle}"`
+        toolbarInfo.hasMorCircles &&
+        toolbarInfo.paletteBtnAbsent,
+      `Tooltips: "${toolbarInfo.pinTitle}", "${toolbarInfo.favTitle}", "${toolbarInfo.remTitle}", "${toolbarInfo.lblTitle}", "${toolbarInfo.morTitle}"; paletteBtnAbsent=${toolbarInfo.paletteBtnAbsent}`
     );
 
     // Pin toggle test
@@ -412,66 +407,25 @@ async function runSuite() {
     });
 
     // -------------------------------------------------------------------------
-    // STEP 7: Verify Note Color Palette Functionality
+    // STEP 7: Note color system retired — no palette UI may render
     // -------------------------------------------------------------------------
-    console.log("\n--- [STEP 7] Verify Note Color Palette Picker ---");
-    await page.click('[data-testid="notes-editor-palette-btn"]');
-    await sleep(400);
-
-    await page.waitForSelector('[data-testid="notes-color-picker-menu"]', { timeout: 3000 });
-    const colorPickerVisible = await page.evaluate(() => {
-      const menu = document.querySelector('[data-testid="notes-color-picker-menu"]');
-      const buttons = menu?.querySelectorAll("button") || [];
-      return {
-        visible: !!menu,
-        count: buttons.length,
-      };
-    });
-
+    console.log("\n--- [STEP 7] Verify Note Color System Is Retired ---");
+    const paletteState = await page.evaluate(() => ({
+      paletteBtn: !!document.querySelector('[data-testid="notes-editor-palette-btn"]'),
+      pickerMenu: !!document.querySelector('[data-testid="notes-color-picker-menu"]'),
+      colorOption: !!document.querySelector('[data-testid^="notes-color-option-"]'),
+    }));
     recordResult(
-      "COLOR_PICKER_MOUNTED",
-      "Color picker opens with 8 approved BYOS color options",
-      colorPickerVisible.visible && colorPickerVisible.count === 8,
-      `Option count: ${colorPickerVisible.count}`
+      "COLOR_SYSTEM_RETIRED",
+      "Palette button, color picker menu and color options are absent",
+      !paletteState.paletteBtn && !paletteState.pickerMenu && !paletteState.colorOption,
+      `paletteBtn=${paletteState.paletteBtn} pickerMenu=${paletteState.pickerMenu} colorOption=${paletteState.colorOption}`
     );
 
-    await page.screenshot({
-      path: path.join(artifactsDir, "notes_color_picker_open.png"),
-      clip: { x: 620, y: 35, width: 300, height: 80 },
-    });
-
-    // Select Peach color
-    await page.waitForSelector('[data-testid="notes-color-option-peach"]', { timeout: 3000 });
-    await page.click('[data-testid="notes-color-option-peach"]');
-    await sleep(600);
-
-    const noteColorApplied = await page.evaluate(() => {
-      const pane = document.querySelector('[data-testid="notes-editor-pane"]');
-      const activeCard = document.querySelector('[data-testid="notes-list-item"]');
-      const paneClass = pane?.className || "";
-      const cardColorDot = activeCard?.querySelector('[title*="Color: peach"]');
-      return {
-        paneHasPeachBg: paneClass.includes("bg-[#FFF2EB]") || paneClass.includes("dark:bg-[#342721]"),
-        hasCardColorDot: !!cardColorDot,
-        paneClass,
-      };
-    });
-
-    recordResult(
-      "NOTE_COLOR_APPLIED",
-      "Selected color applies soft background tint to editor and note indicator in list",
-      noteColorApplied.paneHasPeachBg && noteColorApplied.hasCardColorDot,
-      `Pane background contains peach token: ${noteColorApplied.paneHasPeachBg}, List item dot: ${noteColorApplied.hasCardColorDot}`
-    );
-
-    await page.screenshot({
-      path: path.join(artifactsDir, "notes_color_selected_background.png"),
-    });
-
     // -------------------------------------------------------------------------
-    // STEP 8: Reload Page & Verify Persistence of Spacing & Color
+    // STEP 8: Reload Page & Verify Neutral Surfaces Persist
     // -------------------------------------------------------------------------
-    console.log("\n--- [STEP 8] Verify Persistence Across Page Reload ---");
+    console.log("\n--- [STEP 8] Verify Neutral Surfaces Across Page Reload ---");
     await sleep(800); // Allow debounced auto-save
     await page.reload({ waitUntil: "networkidle2" });
     await sleep(1500);
@@ -480,34 +434,39 @@ async function runSuite() {
     await page.click('[data-testid="nav-notes-tab"]');
     await sleep(1000);
 
-    // Select the note
+    // The editor opens only on an explicit click
     await page.waitForSelector('[data-testid="notes-list-item"]', { timeout: 5000 });
     await page.click('[data-testid="notes-list-item"]');
     await sleep(800);
 
-    const persistedState = await page.evaluate(() => {
+    const neutralState = await page.evaluate(() => {
       const pane = document.querySelector('[data-testid="notes-editor-pane"]');
       const titleInput = document.querySelector('[data-testid="notes-editor-title-input"]');
       const activeCard = document.querySelector('[data-testid="notes-list-item"]');
-      const cardColorDot = activeCard?.querySelector('[title*="Color: peach"]');
       const paneClass = pane?.className || "";
-
+      const cardClass = activeCard?.className || "";
+      const tintedPane = ["bg-[#FFF2EB]", "dark:bg-[#342721]", "bg-[#FAF9F5]", "dark:bg-[#14161A]"].some(
+        (c) => paneClass.includes(c)
+      );
+      const tintedCard = ["bg-[#FFF2EB]", "dark:bg-[#342721]"].some((c) => cardClass.includes(c));
+      const colorDot = activeCard?.querySelector('[title*="Color:"]');
       return {
         title: titleInput?.value,
-        paneHasPeachBg: paneClass.includes("bg-[#FFF2EB]") || paneClass.includes("dark:bg-[#342721]"),
-        hasCardColorDot: !!cardColorDot,
+        paneNeutral: !tintedPane && paneClass.includes("bg-white") && paneClass.includes("dark:bg-[#18191D]"),
+        cardNotTinted: !tintedCard,
+        hasColorDot: !!colorDot,
       };
     });
 
     recordResult(
-      "NOTE_COLOR_PERSISTED",
-      "Note color and content persist completely after page reload",
-      persistedState.paneHasPeachBg && persistedState.hasCardColorDot,
-      `Title: "${persistedState.title}", Peach background: ${persistedState.paneHasPeachBg}`
+      "NEUTRAL_SURFACES_PERSIST",
+      "Editor and list surfaces stay neutral after reload (no per-note tint or color dot)",
+      neutralState.paneNeutral && neutralState.cardNotTinted && !neutralState.hasColorDot,
+      `Title: "${neutralState.title}", paneNeutral=${neutralState.paneNeutral}, cardNotTinted=${neutralState.cardNotTinted}, colorDot=${neutralState.hasColorDot}`
     );
 
     await page.screenshot({
-      path: path.join(artifactsDir, "notes_color_persisted_reload.png"),
+      path: path.join(artifactsDir, "notes_neutral_surfaces_reload.png"),
     });
 
     // -------------------------------------------------------------------------
```

The new file `tests/browser/notes_mobile_drawer.mjs` is additive and introduces no changes to existing suites.

## What did not work or is untested

- **No commit was made.** All changes are in the working tree.
- **The `color` field is still persisted and synced.** It is dead weight in the UI now; removing it from `NoteItem`, `notesSync.ts`, `documentExport.ts`, and the fixtures would be a separate refactor.
- **Light-theme drawer screenshot was not captured.** The captured drawer is in the account's dark theme. The drawer reuses `NotesSidebar`'s existing `bg-[#F0EEE9] dark:bg-[#18191D]` and the same class set as the Mail drawer, but this specific theme/pairing is not in an assertion.
- **Mail/Calendar vs Notes drawer parity is asserted by geometry, not side-by-side pixels.** The comparison is the shared class set plus the measured `288px` / full-height / fixed-left values.
- **1920px and tablet 768px drawer behaviour is covered only by the three-pane suite's viewport checks**, not by a drawer-specific assertion.
- **Other historical Notes browser scripts were not re-run** beyond `verify_notes_three_pane_redesign.mjs` and `test_notes_wysiwyg_and_title_wrapping.mjs`. Scripts that create a note via "New Note" still select explicitly and were not shown to depend on auto-select, but they were not executed in this turn.
- **Pre-existing TypeScript errors in `src/offline.test.ts` remain.** That file is untouched by this change (it is absent from the `git status` list in the evidence section); fixing it is outside this task's scope.
- **The drawer's in-header close (X) button was not exercised by a script.** It is rendered, but only backdrop click, `Escape`, and nav selection are asserted as dismissal paths.

## Test suite output

The unit runner printed `OVERALL: 718 passed, 0 failed` and exited `0` when invoked as `cmd /c "npm test > ... 2>&1"`. The per-suite breakdown is pasted in the Unit suite section above. Full browser outputs are pasted in their respective sections; each exited `0`:

```
consistency exit=0
three_pane exit=0
drawer exit=0
wysiwyg exit=0
```