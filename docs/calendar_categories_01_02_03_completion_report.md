# BYOS Calendar Categories 01, 02, and 03 Completion Report

## What was built
We audited and completed Category 01 (Calendar Settings Framework), Category 02 (Calendar Management), and Category 03 (Holiday & Religious Calendars) of the BYOS Calendar roadmap, incorporating all Google Calendar settings designs and full holiday dataset requirements:

1. **Embedded Holiday Discovery in Settings (Eliminated Separate Popup):** Removed `HolidayCatalogueModal` as an independent popup. The entire holiday and religious calendar discovery experience ("Browse calendars of interest") is now embedded seamlessly inside the persistent Calendar Settings modal under the `Add calendar` group (`holiday_calendars`). Clicking "Explore" or "Browse calendars of interest" in the sidebar or menu directly opens the Settings modal at this section.
2. **Google Calendar Settings Architecture:** Replicated Google Calendar's settings modal layout featuring:
   - Header with Back arrow button (`calendar-settings-back-btn`), "Settings" title (`calendar-settings-title`), settings search bar (`calendar-settings-search`), real-time save indicator, and close button (`calendar-settings-close-btn`).
   - Persistent two-column split navigation with grouped sections: `General` (10 core sections per Section 4.1), `Add calendar` (`Browse calendars of interest`, `Create new calendar`, `From URL`, `Subscribe to calendar`), `Settings for my calendars` (listing user-owned calendars), and `Settings for other calendars` (listing subscribed feeds and holiday calendars).
   - Deep-linking and real-time settings search across all labels, descriptions, and keywords.
   - Global versus calendar-level versus event-level preference separation.
3. **Comprehensive Holiday Dataset (Matching Google Calendar):**
   - **Regional Calendars:** Full international coverage across 207 ISO-3166 countries powered by `date-holidays`, organized by continent with searchable filtering, supporting both "Public holidays only" and "Public holidays and other observances".
   - **Authoritative National Calendars:** Preserved Bangladesh national gazetted dataset with UNESCO Language Martyrs' Day and Pohela Boishakh with bilingual titles.
   - **Religious Traditions:** Complete multi-tradition holiday calculations: Christian (Western/Ecumenical), Islamic (Hijri with moon-sighting confirmation honesty banner), Orthodox Christian (Paschal Julian), Jewish (Hebrew), Hindu (Panchang), Buddhist (Theravada/Mahayana), and Shinto & East Asian Traditional.
   - **Phases of the Moon:** Curated lunar astronomical calendar feed.
   - **Multi-Year Dynamic Generation:** Dynamic calculations across 2024–2028.
4. **Individual Holiday Entry Hide/Restore & Active Feed Customization:**
   - Added "Hide from calendar" button (`data-testid="hide-holiday-btn"`) when viewing read-only holiday events in `EventModal`.
   - In Settings under Active Subscriptions, users can pick custom palette colors (`data-testid="color-swatch-..."`), trigger provider refreshes (`data-testid="refresh-holiday-..."`), view all currently hidden entries for any subscription, and restore them individually (`data-testid="restore-holiday-btn-..."`) or with "Restore all" (`data-testid="restore-all-holiday-..."`).
5. **Calendar Management & External Subscriptions:** Unified "Add calendar" popover dropdown menu in the sidebar with 4 actions, full external Webcal/iCalendar URL feed subscriptions with auto-refresh cadence, safe unsubscription that never destroys source calendars or touches owned calendars, and separate owned versus shared calendar display.
6. **Responsive Architecture:** Fully scalable down to a 375px mobile viewport with zero horizontal scrolling.

## Files edited
| File | Reason |
|------|--------|
| `apps/webmail/package.json` | Added `date-holidays` dependency for international 207-country holiday calculations |
| `apps/webmail/package-lock.json` | Locked dependencies including `date-holidays` |
| `apps/webmail/src/components/calendar/settings/calendarSettingsRegistry.ts` | Preserved exactly 10 core settings sections per Section 4.1 specifications and registered duration keywords |
| `apps/webmail/src/components/calendar/settings/CalendarSettingsPanel.tsx` | Implemented Google Calendar settings design (header, persistent grouped navigation, embedded Browse calendars of interest with 207 countries, religious traditions, moon phases, active subscriptions, color picker swatches, provider refresh, and hidden entries restore list) |
| `apps/webmail/src/components/calendar/settings/calendarSettingsStore.ts` | Added default duration and default calendar preference accessors and per-mailbox localStorage persistence |
| `apps/webmail/src/components/calendar/EventModal.tsx` | Wired default duration, default calendar, read-only holiday details banner with provider and date type tags, and "Hide from calendar" button |
| `apps/webmail/src/components/calendar/CalendarSidebar.tsx` | Implemented unified "Add calendar" popover menu (`add-calendar-btn`), Other Calendars section with holiday and URL badges, explore buttons, and `eventId` in `holidayMeta` |
| `apps/webmail/src/components/calendar/url/urlCalendarStore.ts` | Created reactive store for external webcal/iCalendar subscriptions, auto-refresh intervals, safe unsubscription, and DecryptedEventRecord generation |
| `apps/webmail/src/components/calendar/url/SubscribeFromUrlModal.tsx` | Modal component for subscribing to external URL feeds with validation, preview, color selection, and refresh cadence |
| `apps/webmail/src/components/calendar/holidays/holidayCatalogue.ts` | Integrated `date-holidays` with 207 ISO-3166 countries, multi-year range dynamic generation (2024–2028), religious traditions (Christian, Islam, Orthodox, Jewish, Hindu, Buddhist, Shinto), and moon phases |
| `apps/webmail/src/components/calendar/holidays/holidaySubscriptionStore.ts` | Implemented reactive holiday subscription store with multi-year projection, safe unsubscription, robust object/string ID normalization, and `eventId` in `holidayMeta` |
| `apps/webmail/src/components/calendar/holidays/HolidayCatalogueModal.tsx` | Deprecated standalone modal in favor of integrated Settings panel |
| `apps/webmail/src/components/calendar/CalendarSettingsModal.tsx` | Accepted `initialSectionId` prop to open directly to `holiday_calendars` or other sub-sections |
| `apps/webmail/src/components/calendar/CalendarView.tsx` | Wired `onOpenExploreHolidays` to open Settings modal directly to `holiday_calendars`, and wired `onHideHoliday` to hide individual holiday entries |
| `apps/webmail/src/calendar_categories_01_02_03.test.ts` | Added 12 comprehensive unit and integration tests covering Categories 01, 02, and 03 |
| `apps/webmail/src/run_test.node.js` | Registered `runCalendarCategories010203Tests` in test suite runner |
| `tests/browser/test_calendar_categories_01_02_03.mjs` | Created end-to-end browser test script verifying real login, unified add menu, URL feed subscription, embedded 207-country holiday catalogue in settings, preview, Islamic moon-sighting notice, sidebar badges, month view, hiding individual holiday entry, color swatch customization, provider refresh, restoring hidden entry, Google Calendar settings navigation, 375px mobile viewport, and clean unsubscription |

## Raw evidence

Command executed:
`node tests/browser/test_calendar_categories_01_02_03.mjs`

Raw output:
```
================================================================================
   BYOS CALENDAR: CATEGORIES 01, 02 & 03 END-TO-END BROWSER VERIFICATION        
================================================================================


--- [STEP 1] Navigate to Webmail & Clear Storage ---

--- [STEP 2] Real Login Flow for alice@byos.local ---
  Active account: "alice@byos.local"
  PASS: User authenticated as alice@byos.local

--- [STEP 3] Navigate to Calendar View ---
  Calendar interface loaded

--- [STEP 4] Category 02: Unified 'Add Calendar' Popover Menu ---
  PASS: Add calendar dropdown menu opened successfully
  PASS: Dropdown includes 'Create new calendar'
  PASS: Dropdown includes 'Browse calendars of interest'
  PASS: Dropdown includes 'From URL'
  PASS: Dropdown includes 'Subscribe to calendar'
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\calendar_add_dropdown.png

--- [STEP 5] Category 02: Subscribe from URL Modal ---
  PASS: Subscribe from URL modal opened
  PASS: URL Feed badge rendered in Other Calendars section
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\calendar_url_subscribed.png

--- [STEP 6] Category 03: Complete Regional Holiday Catalogue (200+ Countries) Inside Settings ---
  PASS: Settings modal opened directly (no separate popup)
  PASS: Browse calendars of interest rendered inside Settings
  PASS: Continent selector is present for 200+ country catalogue
  PASS: Language Martyrs' Day verified in preview
  PASS: Pohela Boishakh verified in preview
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\calendar_holiday_bangladesh.png

--- [STEP 6b] Category 03: Search international country (Japan) ---
  Successfully subscribed to Japan holiday feed from date-holidays

--- [STEP 7] Category 03: Religious Traditions & Moon-Sighting Honesty ---
  PASS: Islamic moon-sighting disclaimer banner is present
  PASS: Disclaimer explicitly notes lunar crescent moon-sighting confirmation
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\calendar_religious_islam.png
  Successfully subscribed to Phases of the Moon

--- [STEP 8] Verify Other Calendars in Sidebar ---
  PASS: Expected at least 2 holiday badges in sidebar, found 4
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\calendar_month_view_with_holidays.png

--- [STEP 8b] Category 03: Hide Individual Holiday Entry ---
  PASS: Holiday detail banner displayed with provider and date type
  PASS: Hide from calendar button is present on holiday entry
  Successfully hid individual holiday entry from calendar

--- [STEP 9] Category 01: Calendar Settings Framework ---
  PASS: Calendar Settings modal opened
  PASS: Google Calendar style back button is present in header
  PASS: Settings title verified
  PASS: Navigation has General section
  PASS: Navigation has Event settings section
  PASS: Navigation has Time zones section
  PASS: Navigation has Calendar management section
  PASS: Navigation has Holiday & religious section
  PASS: Search for 'duration' matched defaultDuration setting
  PASS: Calendar management panel rendered
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\calendar_settings_management.png
  PASS: Holiday settings panel rendered

--- [STEP 9b] Category 03: Color set, provider refresh & restore hidden entries ---
  Successfully changed holiday subscription color via swatch
  Successfully refreshed holiday feed from provider
  Successfully restored hidden holiday entry back to calendar
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\calendar_settings_holidays.png

--- [STEP 10] Responsive Architecture: 375px Mobile Viewport Check ---
  Mobile viewport (375px): scrollWidth=375, clientWidth=375
  PASS: Zero horizontal overflow at 375px mobile viewport
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\calendar_mobile_375px_responsive.png

--- [STEP 11] Clean Unsubscription - Non-Destructive Verification ---
  Unsubscribed from external feed
  PASS: Owned user calendars remain untouched after unsubscription
  DevTools Storage State: 12 localStorage keys present
  PASS: Zero page errors during full execution (errors: 0)

================================================================================
   ALL BROWSER VERIFICATION CHECKS COMPLETED SUCCESSFULLY                        
================================================================================
```

## Manual browser verification
The end-to-end browser verification script exercised the actual user flows in Chromium:
1. **Real login flow:** Logged in with user account `alice@byos.local` via the live webmail UI.
2. **Unified Add Calendar menu:** Clicked `+` in "My Calendars" header, verified popover dropdown with 4 options (`Create new calendar`, `Browse calendars of interest`, `From URL`, `Subscribe to calendar`). Screenshot: `tests/browser/artifacts/calendar_add_dropdown.png`.
3. **From URL feed subscription:** Subscribed to `https://example.org/engineering-calendar.ics` (`Global Engineering Team`), verified `URL Feed` badge rendered in "Other Calendars" section of sidebar. Screenshot: `tests/browser/artifacts/calendar_url_subscribed.png`.
4. **Embedded Holiday Discovery in Settings:** Clicked `Browse calendars of interest` in menu, confirmed the Google Calendar Settings modal opened directly with `holiday_calendars` active (NO separate modal). Filtered by continent "Asia", verified preview of Bangladesh national holidays including Language Martyrs' Day and Pohela Boishakh, and subscribed via checkbox. Screenshot: `tests/browser/artifacts/calendar_holiday_bangladesh.png`.
5. **Search 200+ country catalogue:** Searched `Japan` from 207-country catalogue and subscribed.
6. **Religious traditions & Moon-sighting notice:** Switched to Religious tab, verified Islamic moon-sighting banner highlighting lunar confirmation, subscribed to Islam feed. Switched to Other tab, subscribed to Phases of the Moon. Screenshot: `tests/browser/artifacts/calendar_religious_islam.png`.
7. **Sidebar other calendars badges & Month view:** Closed settings, verified 4 holiday badges in Other Calendars sidebar. Switched to Month view to inspect all-day holiday pills. Screenshot: `tests/browser/artifacts/calendar_month_view_with_holidays.png`.
8. **Hide individual holiday entry:** Clicked a holiday pill on the month view, inspected the read-only event detail modal, verified "Public Holiday & Observance" badge and provider attribution, clicked "Hide from calendar" (`data-testid="hide-holiday-btn"`), and verified the event was removed from the calendar view.
9. **Active Subscriptions customization & Restore:** Re-opened Settings -> Holiday & religious calendars, switched to "Active Subscriptions" tab:
   - Clicked color picker swatch to set a new feed color.
   - Clicked "Refresh" button to refresh feed data from provider.
   - Inspected hidden entries section listing the hidden holiday, clicked "Restore", and confirmed the holiday returned to the calendar.
   - Screenshot: `tests/browser/artifacts/calendar_settings_holidays.png`.
10. **Google Calendar Settings navigation:** Asserted Back button, Settings title, search filtering (`duration` matched `defaultDuration`), and Calendar management panel. Screenshot: `tests/browser/artifacts/calendar_settings_management.png`.
11. **Responsive 375px mobile viewport:** Set viewport to 375x812, verified `scrollWidth === clientWidth === 375` (zero horizontal scroll). Screenshot: `tests/browser/artifacts/calendar_mobile_375px_responsive.png`.
12. **Clean unsubscription:** Unsubscribed from external feed, verified owned user calendars were not touched.
13. **DevTools state:** Captured 12 localStorage keys, confirmed 0 uncaught page errors.

## What did not work or is untested
- Live internet network fetch of external `.ics` files during browser tests was mocked to `example.org` dummy URL because network sandbox prevents outbound internet requests in test runners.
- Native mobile swipe gestures (e.g., iOS touch physics) are untested as Puppeteer runs desktop Chromium with viewport emulation.

## Test suite output

### Frontend unit & integration tests (`npm.cmd --prefix apps/webmail test`)
```
> test
> npx tsx --experimental-wasm-modules src/run_test.node.js

(node:6544) ExperimentalWarning: Importing WebAssembly modules is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
Running Attachment Crypto Tests...
  ✓ Plaintext is not equal to encrypted ciphertext envelope
  ✓ Decrypt(ciphertext, correct_key) returns original plaintext
  ✓ Tampered ciphertext fails decryption
  ✓ Decrypting with wrong key fails
  ✓ No plaintext file bytes stored or logged
  ✓ test_attachment_encrypt_decrypt_roundtrip: encrypt small file, upload, download, decrypt, verify hash
  ✓ test_attachment_chunking: encrypt 5 MB file, assert 5 chunks, decrypt and reassemble
  ✓ test_attachment_corrupt_chunk_isolated: corrupt one chunk, assert other attachments decrypt and corrupted is marked
  ✓ test_attachment_iv_unique_per_chunk: encrypt 5-chunk file, assert all IVs are distinct
  ✓ test_attachment_hash_mismatch_marks_corrupted: tampered content hash marks attachment corrupted without producing partial output
  ✓ test_attachment_empty_file_roundtrip: 0-byte file encrypt, upload, download, decrypt returns 0-byte file and no error
  ✓ test_attachment_unicode_filename_roundtrip: non-ASCII unicode filename round-trips byte-for-byte
  ✓ test_attachment_full_flow_roundtrip: key gen -> chunk -> encrypt -> mock upload -> mock download -> decrypt -> hash-match
  ✓ test_wasm_unavailable_throws_not_falls_back: wrapAttachmentContentKey and unwrapAttachmentContentKey throw when WASM is unavailable
  ✓ Content key generation produces 32 bytes
  ✓ Base IV generation produces 12 bytes
  ✓ Chunk IV generation produces 12 bytes
  ✓ Attachment encryption roundtrip: 1 byte
  ✓ Attachment encryption roundtrip: 64 bytes
  ✓ Path A recipient cannot decrypt sender chunks
ATTACHMENT CRYPTO TESTS: 20 passed, 0 failed

Running TOTP Tests...
TOTP TESTS: 5 passed, 0 failed

Running Date Time Tests...
DATE TIME TESTS: 10 passed, 0 failed

Running File Type Tests...
FILE TYPE TESTS: 10 passed, 0 failed

Running Multi-Account & Storage Sync Tests...
MULTI-ACCOUNT & STORAGE SYNC TESTS: 39 passed, 0 failed

Running Historical Key Reactivation Tests...
HISTORICAL KEY REACTIVATION TESTS: 13 passed, 0 failed

Running Calendar Crypto Tests...
CALENDAR CRYPTO TESTS: 9 passed, 0 failed

Running Calendar Recurrence Exceptions Tests...
CALENDAR RECURRENCE EXCEPTIONS TESTS: 16 passed, 0 failed

Running Calendar External Invitations & Fallback Delivery Tests...
CALENDAR EXTERNAL INVITATIONS TESTS: 10 passed, 0 failed

Running Calendar Sharing Tests...
CALENDAR SHARING TESTS: 7 passed, 0 failed

Running Calendar Settings Tests...
  ✓ 1. Registry specifies exactly the 10 sections from Section 4.1
  ✓ 2. Every setting in registry belongs to a valid section and has valid scope
  ✓ 3. Search/filtering finds settings by label, description, and keywords
  ✓ 4. loadCalendarSettings returns default values when storage is empty
  ✓ 5. saveCalendarSettings and loadCalendarSettings persist and restore preferences
  ✓ 6. Three-level configuration scope separation: global vs calendar vs event
  ✓ 7. World clock cities configuration can be modified and restored
CALENDAR SETTINGS TESTS: 7 passed, 0 failed

Running Calendar Management Tests...
Starting Calendar Management (Category 02) Tests...
  ✓ 1. Calendar templates definition and pre-fills
  ✓ 2. Calendar overrides save and load lifecycle
  ✓ 3. Multi-level reminder resolution precedence (Global < Calendar < Event)
  ✓ 4. Owned vs shared calendar separation and identification
  ✓ 5. Safe calendar deletion constraints and permissions
  ✓ 6. Unsubscribe action targets share grant without destroying source calendar
CALENDAR MANAGEMENT TESTS: 6 passed, 0 failed

Running Calendar Holiday & Religious Tests...
Starting Holiday and Religious Calendars (Category 03) Tests...
  ✓ 1. Holiday feeds catalogue completeness & categorisation
  ✓ 2. Bangladesh national holidays and regional observances focus
  ✓ 3. Religious honesty: provisional moon-sighting vs fixed vs calculated dates
  ✓ 4. Subscription store: subscribe, deduplication, color, visibility, hide/restore
  ✓ 5. Projection to UserCalendar & DecryptedEventRecord generation
CALENDAR HOLIDAY & RELIGIOUS TESTS: 5 passed, 0 failed

Running Calendar Year View Tests...
Starting Calendar Year View Tests...
  ✓ 1. Year View generates exactly 12 months
  ✓ 2. Month day counts: handles leap years (2024 vs 2026)
  ✓ 3. Leading blanks calculation under Sunday, Monday, Saturday week start
  ✓ 4. Year navigation advances or decrements by 1 full year
  ✓ 5. Year view period title displays 4-digit year
  ✓ 6. Event distribution and holiday detection in Year View

CALENDAR YEAR VIEW TESTS: 6 passed, 0 failed

Running Calendar Categories 01, 02, and 03 Comprehensive Tests...
Starting Calendar Categories 01, 02, and 03 Integration Tests...
  ✓ Cat 01.1: Settings Registry defines exactly the 10 sections from Section 4.1
  ✓ Cat 01.2: Settings search queries match across labels, descriptions, and keywords
  ✓ Cat 01.3: User preferences persist and restore per mailbox, with default fallbacks
  ✓ Cat 01.4: Per-calendar overrides save and load independently
  ✓ Cat 02.1: URL normalization and validation handles http, https, and webcal
  ✓ Cat 02.2: External URL subscription lifecycle: subscribe, deduplicate, project to UserCalendar
  ✓ Cat 03.1: Complete international country coverage (200+ countries from date-holidays)
  ✓ Cat 03.2: Dynamic generation of holidays for arbitrary international country (e.g. Japan)
  ✓ Cat 03.3: Bangladesh national holidays gazetted accuracy & UNESCO history preservation
  ✓ Cat 03.4: Religious honesty: Islamic moon-sighting caveats and multi-tradition coverage
  ✓ Cat 03.5: Multi-year dynamic generation across year ranges (2025-2027)
  ✓ Cat 03.6: Subscription store: subscribe, color, observances toggle, and safe unsubscription

CALENDAR CATEGORIES 01, 02, 03 TESTS: 12 passed, 0 failed

Running Mailbox Unlock & 2FA Persistence Tests...
UNLOCK & 2FA PERSISTENCE TESTS: 5 passed, 0 failed

OVERALL: 445 passed, 0 failed
```

### Backend test suite (`cd services/api; go test -count=1 ./...`)
```
ok  	byos.email/services/api	2.319s
```
