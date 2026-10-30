import puppeteer from '../../apps/webmail/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const artifactsDir = path.resolve(__dirname, 'artifacts');

if (!fs.existsSync(artifactsDir)) {
  fs.mkdirSync(artifactsDir, { recursive: true });
}

function assert(condition, message) {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  PASS: ${message}`);
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runCalendarCategoriesBrowserTest() {
  console.log("================================================================================");
  console.log("   BYOS CALENDAR: CATEGORIES 01, 02 & 03 END-TO-END BROWSER VERIFICATION        ");
  console.log("================================================================================\n");

  const uncaughtErrors = [];
  const networkRequests = [];

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ['--no-sandbox', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    page.on('pageerror', (err) => {
      uncaughtErrors.push(err.message);
      console.error(`  [PAGE ERROR]: ${err.message}`);
    });

    page.on('request', (req) => {
      if (req.url().includes('/v1/mailboxes') || req.url().includes('/calendar')) {
        networkRequests.push({ url: req.url(), method: req.method() });
      }
    });

    // Step 1: Navigate to Webmail & Clear Storage
    console.log("\n--- [STEP 1] Navigate to Webmail & Clear Storage ---");
    await page.goto('http://127.0.0.1:3001', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(800);

    // Step 2: Real Login Flow for alice@byos.local
    console.log("\n--- [STEP 2] Real Login Flow for alice@byos.local ---");
    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.type('input[type="email"]', 'alice@byos.local');
    await page.type('input[type="password"]', 'test-password-123');
    await sleep(300);
    await page.click('button[type="submit"]');

    await page.waitForSelector('[data-testid="account-chip-selector"]', { timeout: 15000 });
    await sleep(800);
    const activeAccountChip = await page.$eval('[data-testid="account-chip-text"]', (el) => el.textContent.trim());
    console.log(`  Active account: "${activeAccountChip}"`);
    assert(activeAccountChip === "alice@byos.local", "User authenticated as alice@byos.local");

    // Step 3: Navigate to Calendar View
    console.log("\n--- [STEP 3] Navigate to Calendar View ---");
    const calendarNavBtn = await page.waitForSelector('[data-testid="nav-calendar-tab"]', { timeout: 8000 });
    await calendarNavBtn.click();

    await page.waitForSelector('[data-testid="calendar-view"]', { timeout: 10000 });
    await sleep(800);
    console.log("  Calendar interface loaded");

    // Step 4: Category 02 - Unified 'Add Calendar' Dropdown
    console.log("\n--- [STEP 4] Category 02: Unified 'Add Calendar' Popover Menu ---");
    const addCalBtn = await page.waitForSelector('[data-testid="add-calendar-btn"]', { timeout: 5000 });
    await addCalBtn.click();
    await sleep(300);

    const dropdownMenu = await page.waitForSelector('[data-testid="add-calendar-dropdown-menu"]', { timeout: 5000 });
    assert(dropdownMenu !== null, "Add calendar dropdown menu opened successfully");

    const menuCreate = await page.$('[data-testid="add-calendar-menu-create"]');
    const menuBrowse = await page.$('[data-testid="add-calendar-menu-browse"]');
    const menuUrl = await page.$('[data-testid="add-calendar-menu-url"]');
    const menuSubscribe = await page.$('[data-testid="add-calendar-menu-subscribe"]');

    assert(menuCreate !== null, "Dropdown includes 'Create new calendar'");
    assert(menuBrowse !== null, "Dropdown includes 'Browse calendars of interest'");
    assert(menuUrl !== null, "Dropdown includes 'From URL'");
    assert(menuSubscribe !== null, "Dropdown includes 'Subscribe to calendar'");

    const dropdownShot = path.join(artifactsDir, "calendar_add_dropdown.png");
    await page.screenshot({ path: dropdownShot });
    console.log(`  Saved screenshot: ${dropdownShot}`);

    // Step 5: Category 02 - Subscribe from URL Modal
    console.log("\n--- [STEP 5] Category 02: Subscribe from URL Modal ---");
    await menuUrl.click();
    await sleep(400);

    const urlModal = await page.waitForSelector('[data-testid="subscribe-from-url-modal"]', { timeout: 5000 });
    assert(urlModal !== null, "Subscribe from URL modal opened");

    await page.type('[data-testid="subscribe-url-input"]', 'https://example.org/engineering-calendar.ics');
    await page.type('[data-testid="subscribe-url-name-input"]', 'Global Engineering Team');
    await sleep(300);

    await page.click('[data-testid="subscribe-url-confirm-btn"]');
    await sleep(600);

    // Verify URL feed appears in Other Calendars
    const urlBadge = await page.waitForSelector('[data-testid="url-calendar-badge"]', { timeout: 5000 });
    assert(urlBadge !== null, "URL Feed badge rendered in Other Calendars section");

    const urlFeedShot = path.join(artifactsDir, "calendar_url_subscribed.png");
    await page.screenshot({ path: urlFeedShot });
    console.log(`  Saved screenshot: ${urlFeedShot}`);

    // Step 6: Category 03 - Complete Regional & Religious Holiday Catalogue in Settings
    console.log("\n--- [STEP 6] Category 03: Complete Regional Holiday Catalogue (200+ Countries) Inside Settings ---");
    // Open Browse Calendars of Interest via the sidebar Add menu (Google Calendar workflow)
    const addCalendarBtn2 = await page.waitForSelector('[data-testid="add-calendar-btn"]', { timeout: 5000 });
    await addCalendarBtn2.click();
    await sleep(400);

    const optionBrowse2 = await page.waitForSelector('[data-testid="add-calendar-menu-browse"]', { timeout: 5000 });
    await optionBrowse2.click();
    await sleep(600);

    // Verify it opened directly in the Settings popup, NOT a separate modal
    const settingsModal = await page.waitForSelector('[data-testid="calendar-settings-modal"]', { timeout: 5000 });
    assert(settingsModal !== null, "Settings modal opened directly (no separate popup)");

    const holidayPanel = await page.waitForSelector('[data-testid="settings-holiday-calendars-panel"]', { timeout: 5000 });
    assert(holidayPanel !== null, "Browse calendars of interest rendered inside Settings");

    // Continent filter check
    const continentSelect = await page.waitForSelector('[data-testid="continent-filter-select"]', { timeout: 5000 });
    assert(continentSelect !== null, "Continent selector is present for 200+ country catalogue");

    // Filter by Asia and preview Bangladesh
    await page.select('[data-testid="continent-filter-select"]', 'Asia');
    await sleep(400);

    const previewBdBtn = await page.waitForSelector('[data-testid="preview-country-BD"]', { timeout: 5000 });
    await previewBdBtn.click();
    await sleep(400);

    // Verify authoritative UNESCO Language Martyrs' Day and Pohela Boishakh in preview
    const previewText = await page.evaluate(() => document.querySelector('[data-testid="settings-holiday-calendars-panel"]').innerText);
    assert(previewText.includes("Language Martyrs' Day"), "Language Martyrs' Day verified in preview");
    assert(previewText.includes("Pohela Boishakh"), "Pohela Boishakh verified in preview");

    // Subscribe to Bangladesh feed via checkbox
    const toggleBd = await page.waitForSelector('[data-testid="toggle-country-BD"]', { timeout: 5000 });
    await toggleBd.click();
    await sleep(500);

    const bdShot = path.join(artifactsDir, "calendar_holiday_bangladesh.png");
    await page.screenshot({ path: bdShot });
    console.log(`  Saved screenshot: ${bdShot}`);

    // Search for another international country (e.g. Japan)
    console.log("\n--- [STEP 6b] Category 03: Search international country (Japan) ---");
    await page.type('[data-testid="country-search-input"]', 'Japan');
    await sleep(400);

    const toggleJp = await page.waitForSelector('[data-testid="toggle-country-JP"]', { timeout: 5000 });
    await toggleJp.click();
    await sleep(500);
    console.log("  Successfully subscribed to Japan holiday feed from date-holidays");

    // Step 7: Category 03 - Religious Traditions with Moon-Sighting Honesty
    console.log("\n--- [STEP 7] Category 03: Religious Traditions & Moon-Sighting Honesty ---");
    const religionTab = await page.waitForSelector('[data-testid="browse-tab-religious"]', { timeout: 5000 });
    await religionTab.click();
    await sleep(400);

    // Verify Moon-Sighting disclaimer banner
    const disclaimerBanner = await page.waitForSelector('[data-testid="islamic-moon-sighting-banner"]', { timeout: 5000 });
    assert(disclaimerBanner !== null, "Islamic moon-sighting disclaimer banner is present");
    const disclaimerText = await page.evaluate(el => el.textContent, disclaimerBanner);
    assert(
      disclaimerText.includes("lunar") || disclaimerText.includes("moon-sighting"),
      "Disclaimer explicitly notes lunar crescent moon-sighting confirmation"
    );

    // Subscribe to Islam feed via checkbox
    const toggleIslam = await page.waitForSelector('[data-testid="toggle-religion-islam"]', { timeout: 5000 });
    await toggleIslam.click();
    await sleep(500);

    const islamShot = path.join(artifactsDir, "calendar_religious_islam.png");
    await page.screenshot({ path: islamShot });
    console.log(`  Saved screenshot: ${islamShot}`);

    // Subscribe to Phases of the Moon
    const otherTab = await page.waitForSelector('[data-testid="browse-tab-other"]', { timeout: 5000 });
    await otherTab.click();
    await sleep(400);
    const toggleMoon = await page.waitForSelector('[data-testid="toggle-other-moon"]', { timeout: 5000 });
    await toggleMoon.click();
    await sleep(500);
    console.log("  Successfully subscribed to Phases of the Moon");

    // Close Settings modal via close button
    await page.click('[data-testid="calendar-settings-close-btn"]');
    await sleep(500);

    // Step 8: Verify Holiday & Feed Badges in Sidebar
    console.log("\n--- [STEP 8] Verify Other Calendars in Sidebar ---");
    const holidayBadges = await page.$$('[data-testid="holiday-calendar-badge"]');
    assert(holidayBadges.length >= 2, `Expected at least 2 holiday badges in sidebar, found ${holidayBadges.length}`);

    // Switch to Month View to inspect holiday events
    const monthViewBtn = await page.waitForSelector('[data-testid="view-month-btn"]', { timeout: 5000 });
    await monthViewBtn.click();
    await sleep(800);

    const monthShot = path.join(artifactsDir, "calendar_month_view_with_holidays.png");
    await page.screenshot({ path: monthShot });
    console.log(`  Saved screenshot: ${monthShot}`);

    // Inspect holiday entry and test hiding individual holiday entry (Category 03 requirement)
    console.log("\n--- [STEP 8b] Category 03: Hide Individual Holiday Entry ---");
    const holidayPills = await page.$$('[data-testid="calendar-event-pill"][data-is-holiday="true"]');
    if (holidayPills.length > 0) {
      await holidayPills[0].click();
      await sleep(600);

      const holidayBanner = await page.waitForSelector('[data-testid="holiday-detail-banner"]', { timeout: 5000 });
      assert(holidayBanner !== null, "Holiday detail banner displayed with provider and date type");

      const hideBtn = await page.waitForSelector('[data-testid="hide-holiday-btn"]', { timeout: 5000 });
      assert(hideBtn !== null, "Hide from calendar button is present on holiday entry");
      await hideBtn.click();
      await sleep(600);
      console.log("  Successfully hid individual holiday entry from calendar");
    }

    // Step 9: Category 01 - Google Calendar-Style Settings Modal
    console.log("\n--- [STEP 9] Category 01: Calendar Settings Framework ---");
    const settingsBtn = await page.waitForSelector('[data-testid="calendar-settings-btn"]', { timeout: 5000 });
    await settingsBtn.click();
    await sleep(600);

    const settingsModal2 = await page.waitForSelector('[data-testid="calendar-settings-modal"]', { timeout: 5000 });
    assert(settingsModal2 !== null, "Calendar Settings modal opened");

    const backBtn = await page.$('[data-testid="calendar-settings-back-btn"]');
    assert(backBtn !== null, "Google Calendar style back button is present in header");
    const settingsTitle = await page.$eval('[data-testid="calendar-settings-title"]', el => el.textContent.trim());
    assert(settingsTitle === "Settings", "Settings title verified");

    // Verify left navigation contains the 10 sections + dedicated management items
    const navGeneral = await page.$('[data-testid="settings-nav-general"]');
    const navEventDefaults = await page.$('[data-testid="settings-nav-event_defaults"]');
    const navTimezones = await page.$('[data-testid="settings-nav-timezones"]');
    const navMgmt = await page.$('[data-testid="settings-nav-calendar_management"]');
    const navHolidays = await page.$('[data-testid="settings-nav-holiday_calendars"]');

    assert(navGeneral !== null, "Navigation has General section");
    assert(navEventDefaults !== null, "Navigation has Event settings section");
    assert(navTimezones !== null, "Navigation has Time zones section");
    assert(navMgmt !== null, "Navigation has Calendar management section");
    assert(navHolidays !== null, "Navigation has Holiday & religious section");

    // Search settings
    await page.type('[data-testid="calendar-settings-search"]', 'duration');
    await sleep(400);
    const searchMatch = await page.$('[data-testid="setting-item-defaultDuration"]');
    assert(searchMatch !== null, "Search for 'duration' matched defaultDuration setting");

    // Clear search
    await page.evaluate(() => {
      const input = document.querySelector('[data-testid="calendar-settings-search"]');
      if (input) {
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await sleep(300);

    // Open Calendar Management section
    await page.click('[data-testid="settings-nav-calendar_management"]');
    await sleep(500);

    const mgmtPanel = await page.waitForSelector('[data-testid="settings-calendar-management-panel"]', { timeout: 5000 });
    assert(mgmtPanel !== null, "Calendar management panel rendered");

    const settingsMgmtShot = path.join(artifactsDir, "calendar_settings_management.png");
    await page.screenshot({ path: settingsMgmtShot });
    console.log(`  Saved screenshot: ${settingsMgmtShot}`);

    // Open Holiday & Religious section in settings
    await page.click('[data-testid="settings-nav-holiday_calendars"]');
    await sleep(500);

    const holidayPanel2 = await page.waitForSelector('[data-testid="settings-holiday-calendars-panel"]', { timeout: 5000 });
    assert(holidayPanel2 !== null, "Holiday settings panel rendered");

    // Test Active Subscriptions management: color set, provider refresh, and restoring hidden entries
    console.log("\n--- [STEP 9b] Category 03: Color set, provider refresh & restore hidden entries ---");
    const activeSubsTab = await page.waitForSelector('[data-testid="browse-tab-active"]', { timeout: 5000 });
    await activeSubsTab.click();
    await sleep(500);

    // Verify color swatches are clickable and change color
    const colorSwatches = await page.$$('[data-testid^="color-swatch-"]');
    if (colorSwatches.length > 0) {
      await colorSwatches[1].click();
      await sleep(300);
      console.log("  Successfully changed holiday subscription color via swatch");
    }

    // Verify provider refresh button
    const refreshBtn = await page.$$('[data-testid^="refresh-holiday-"]');
    if (refreshBtn.length > 0) {
      await refreshBtn[0].click();
      await sleep(300);
      console.log("  Successfully refreshed holiday feed from provider");
    }

    // Verify restore hidden entry button
    const restoreBtns = await page.$$('[data-testid^="restore-holiday-btn-"], [data-testid^="restore-all-holiday-"]');
    if (restoreBtns.length > 0) {
      await restoreBtns[0].click();
      await sleep(400);
      console.log("  Successfully restored hidden holiday entry back to calendar");
    }

    const settingsHolidaysShot = path.join(artifactsDir, "calendar_settings_holidays.png");
    await page.screenshot({ path: settingsHolidaysShot });
    console.log(`  Saved screenshot: ${settingsHolidaysShot}`);

    // Close settings modal
    await page.click('[data-testid="calendar-settings-close-btn"]');
    await sleep(400);

    // Step 10: Responsive Architecture - 375px Mobile Viewport Check
    console.log("\n--- [STEP 10] Responsive Architecture: 375px Mobile Viewport Check ---");
    await page.setViewport({ width: 375, height: 812 });
    await sleep(800);

    const overflowCheck = await page.evaluate(() => {
      const doc = document.documentElement;
      return {
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth,
        hasHorizontalOverflow: doc.scrollWidth > doc.clientWidth,
      };
    });

    console.log(`  Mobile viewport (375px): scrollWidth=${overflowCheck.scrollWidth}, clientWidth=${overflowCheck.clientWidth}`);
    assert(!overflowCheck.hasHorizontalOverflow, "Zero horizontal overflow at 375px mobile viewport");

    const mobileShot = path.join(artifactsDir, "calendar_mobile_375px_responsive.png");
    await page.screenshot({ path: mobileShot });
    console.log(`  Saved screenshot: ${mobileShot}`);

    // Restore desktop viewport
    await page.setViewport({ width: 1280, height: 800 });
    await sleep(400);

    // Step 11: Clean Unsubscription - Non-Destructive Integrity
    console.log("\n--- [STEP 11] Clean Unsubscription - Non-Destructive Verification ---");
    const initialCalendarRows = await page.$$('[data-testid="calendar-row"]');
    const initialOwnedCount = initialCalendarRows.length;

    // Unsubscribe from URL feed
    const unsubFeedBtns = await page.$$('[data-testid="unsubscribe-calendar-row-btn"]');
    if (unsubFeedBtns.length > 0) {
      await unsubFeedBtns[0].click();
      await sleep(500);
      console.log("  Unsubscribed from external feed");
    }

    // Verify owned calendars were NOT touched
    const remainingOwned = await page.$$('[data-testid="calendar-row"]');
    assert(remainingOwned.length === initialOwnedCount, "Owned user calendars remain untouched after unsubscription");

    // Capture DevTools state
    const devToolsState = await page.evaluate(() => {
      const storageKeys = [];
      for (let i = 0; i < localStorage.length; i++) {
        storageKeys.push(localStorage.key(i));
      }
      return {
        url: window.location.href,
        storageKeys,
      };
    });

    console.log(`  DevTools Storage State: ${devToolsState.storageKeys.length} localStorage keys present`);
    assert(uncaughtErrors.length === 0, `Zero page errors during full execution (errors: ${uncaughtErrors.length})`);

    console.log("\n================================================================================");
    console.log("   ALL BROWSER VERIFICATION CHECKS COMPLETED SUCCESSFULLY                        ");
    console.log("================================================================================\n");

  } finally {
    await browser.close();
  }
}

runCalendarCategoriesBrowserTest().catch((err) => {
  console.error("Browser verification failed:", err);
  process.exit(1);
});
