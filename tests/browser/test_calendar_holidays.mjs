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

async function runCalendarHolidaysBrowserTest() {
  console.log("================================================================================");
  console.log("   BYOS HOLIDAY & RELIGIOUS CALENDARS (CATEGORY 03) BROWSER VERIFICATION       ");
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
      if (req.url().includes('/v1/mailboxes')) {
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
    await page.click('button[type="submit"]');

    await page.waitForSelector('[data-testid="account-chip-selector"]', { timeout: 15000 });
    await sleep(1000);

    const activeAccountChip = await page.$eval('[data-testid="account-chip-text"]', (el) => el.textContent.trim());
    console.log(`  Active account: "${activeAccountChip}"`);
    assert(activeAccountChip === "alice@byos.local", "User authenticated as alice@byos.local");

    // Step 3: Switch to Calendar Module
    console.log("\n--- [STEP 3] Switch to Calendar Module ---");
    await page.waitForSelector('[data-testid="nav-calendar-tab"]', { timeout: 5000 });
    await page.click('[data-testid="nav-calendar-tab"]');
    await page.waitForSelector('[data-testid="calendar-view"]', { timeout: 10000 });
    await sleep(800);
    assert(await page.$('[data-testid="calendar-view"]') !== null, "Calendar workspace active");

    // Step 4: Open Holiday Catalogue Modal
    console.log("\n--- [STEP 4] Open Holiday & Religious Catalogue Modal ---");
    await page.waitForSelector('[data-testid="explore-calendars-btn"]', { timeout: 5000 });
    await sleep(300);
    await page.click('[data-testid="explore-calendars-btn"]');
    await page.waitForSelector('[data-testid="holiday-catalogue-modal"]', { timeout: 5000 });
    assert(await page.$('[data-testid="holiday-catalogue-modal"]') !== null, "Holiday catalogue modal rendered");

    // Step 5: Verify Regional Catalogue (Bangladesh Regional Focus)
    console.log("\n--- [STEP 5] Verify Regional Catalogue & Bangladesh Priority Feed ---");
    await page.waitForSelector('[data-testid="feed-item-holiday-bd"]', { timeout: 5000 });
    const bdTitle = await page.$eval('[data-testid="preview-feed-title"]', (el) => el.textContent.trim());
    console.log(`  Selected feed title: "${bdTitle}"`);
    assert(bdTitle === "Bangladesh Holidays", "Bangladesh Holidays is loaded in preview");

    const bdProvider = await page.$eval('[data-testid="provider-attribution"]', (el) => el.textContent.trim());
    console.log(`  Provider attribution: "${bdProvider}"`);
    assert(bdProvider.includes("Ministry of Public Administration"), "Official government provider attribution present");

    const fixedDateBadges = await page.$$('[data-testid="badge-date-fixed"]');
    assert(fixedDateBadges.length > 0, "Fixed date type badges present for national holidays");

    await page.screenshot({ path: path.join(artifactsDir, 'calendar_holidays_catalogue_regional.png') });
    console.log("  Saved screenshot: calendar_holidays_catalogue_regional.png");

    // Step 6: Subscribe to Bangladesh Holidays
    console.log("\n--- [STEP 6] Subscribe to Bangladesh Holidays ---");
    await page.waitForSelector('[data-testid="subscribe-holiday-btn"]', { timeout: 5000 });
    await page.click('[data-testid="subscribe-holiday-btn"]');
    await sleep(500);

    await page.waitForSelector('[data-testid="holiday-action-success"]', { timeout: 5000 });
    const successMsg1 = await page.$eval('[data-testid="holiday-action-success"]', (el) => el.textContent.trim());
    console.log(`  Action feedback: "${successMsg1}"`);
    assert(successMsg1.includes("Subscribed to Bangladesh Holidays"), "Subscription confirmation received");
    assert(await page.$('[data-testid="save-holiday-pref-btn"]') !== null, "Save Preferences button visible after subscribing");
    assert(await page.$('[data-testid="unsubscribe-holiday-feed-btn"]') !== null, "Unsubscribe button visible after subscribing");

    // Step 7: Switch to Religious Traditions & Inspect Islam Feed
    console.log("\n--- [STEP 7] Switch to Religious Traditions Catalogue (Islam Feed) ---");
    await page.click('[data-testid="category-tab-religion"]');
    await sleep(400);

    await page.waitForSelector('[data-testid="feed-item-religion-islam"]', { timeout: 5000 });
    await page.click('[data-testid="feed-item-religion-islam"]');
    await sleep(400);

    const islamTitle = await page.$eval('[data-testid="preview-feed-title"]', (el) => el.textContent.trim());
    console.log(`  Selected religious feed: "${islamTitle}"`);
    assert(islamTitle.includes("Islamic Holidays"), "Islamic Holidays loaded in preview");

    const disclaimerBanner = await page.$('[data-testid="feed-disclaimer-banner"]');
    assert(disclaimerBanner !== null, "Astronomical & moon-sighting disclaimer banner rendered");

    const provisionalBadges = await page.$$('[data-testid="badge-date-provisional"]');
    assert(provisionalBadges.length > 0, "Provisional moon-sighting badges rendered honestly");

    await page.screenshot({ path: path.join(artifactsDir, 'calendar_holidays_catalogue_religious.png') });
    console.log("  Saved screenshot: calendar_holidays_catalogue_religious.png");

    // Step 8: Subscribe to Islamic Holidays
    console.log("\n--- [STEP 8] Subscribe to Islamic Holidays ---");
    await page.waitForSelector('[data-testid="subscribe-holiday-btn"]', { timeout: 5000 });
    await page.click('[data-testid="subscribe-holiday-btn"]');
    await sleep(500);

    const successMsg2 = await page.$eval('[data-testid="holiday-action-success"]', (el) => el.textContent.trim());
    console.log(`  Action feedback: "${successMsg2}"`);
    assert(successMsg2.includes("Subscribed to Islamic Holidays"), "Islamic subscription confirmed");

    // Step 9: Close Modal & Verify Sidebar
    console.log("\n--- [STEP 9] Close Modal & Verify Subscribed Feeds in Sidebar ---");
    await page.click('[data-testid="close-holiday-modal-btn"]');
    await sleep(500);
    assert(await page.$('[data-testid="holiday-catalogue-modal"]') === null, "Modal closed successfully");

    await page.waitForSelector('[data-testid="shared-calendar-row"]', { timeout: 5000 });
    const holidayBadges = await page.$$('[data-testid="holiday-calendar-badge"]');
    console.log(`  Holiday calendar badges in sidebar: ${holidayBadges.length}`);
    assert(holidayBadges.length >= 2, "Both Bangladesh and Islamic feeds appear under Other Calendars");

    await page.screenshot({ path: path.join(artifactsDir, 'calendar_holidays_sidebar_subscribed.png') });
    console.log("  Saved screenshot: calendar_holidays_sidebar_subscribed.png");

    // Step 10: Switch to Month View and Navigate to Holiday Dates
    console.log("\n--- [STEP 10] View Holiday Events on Calendar Grid ---");
    await page.click('[data-testid="view-month-btn"]');
    await sleep(500);

    // Look specifically for holiday event pills
    let holidayPills = await page.$$('[data-testid="calendar-event-pill"][data-is-holiday="true"]');
    let navAttempts = 0;
    while (holidayPills.length === 0 && navAttempts < 12) {
      await page.click('[data-testid="calendar-next-btn"]');
      await sleep(400);
      holidayPills = await page.$$('[data-testid="calendar-event-pill"][data-is-holiday="true"]');
      navAttempts++;
    }

    if (holidayPills.length === 0) {
      for (let i = 0; i < 24; i++) {
        await page.click('[data-testid="calendar-prev-btn"]');
        await sleep(400);
        holidayPills = await page.$$('[data-testid="calendar-event-pill"][data-is-holiday="true"]');
        if (holidayPills.length > 0) break;
      }
    }

    console.log(`  Found ${holidayPills.length} holiday event pills on the visible calendar month`);
    assert(holidayPills.length > 0, "Holiday event pills rendered on month calendar grid");

    // Step 11: Click Holiday Event to inspect Read-Only EventModal
    console.log("\n--- [STEP 11] Inspect Read-Only Holiday EventModal ---");
    const firstHolidayTitle = await page.evaluate((el) => el.getAttribute("data-event-title"), holidayPills[0]);
    console.log(`  Inspecting holiday event: "${firstHolidayTitle}"`);
    await holidayPills[0].click();
    await page.waitForSelector('[data-testid="event-modal"]', { timeout: 5000 });
    assert(await page.$('[data-testid="event-modal"]') !== null, "EventModal opened for holiday event");

    await page.waitForSelector('[data-testid="holiday-detail-banner"]', { timeout: 5000 });
    assert(await page.$('[data-testid="holiday-detail-banner"]') !== null, "Read-only holiday detail banner displayed");

    const isSaveDisabled = await page.$eval('[data-testid="save-event-btn"]', (btn) => btn.disabled);
    assert(isSaveDisabled === true, "Save button is disabled for read-only holiday events");

    const deleteBtn = await page.$('[data-testid="delete-event-btn"]');
    assert(deleteBtn === null, "Delete button is not rendered for read-only holiday events");

    await page.screenshot({ path: path.join(artifactsDir, 'calendar_holidays_event_detail_modal.png') });
    console.log("  Saved screenshot: calendar_holidays_event_detail_modal.png");

    await page.click('[data-testid="close-event-modal"]');
    await sleep(500);

    // Step 12: Calendar Visibility Toggle
    console.log("\n--- [STEP 12] Toggle Holiday Calendar Visibility ---");
    const countBeforeToggle = (await page.$$('[data-testid="calendar-event-pill"][data-is-holiday="true"]')).length;
    console.log(`  Visible holiday event pills before toggle: ${countBeforeToggle}`);

    const visibilityCheckboxes = await page.$$('[data-testid="calendar-visibility-checkbox"]');
    assert(visibilityCheckboxes.length >= 2, "Visibility checkboxes available for shared calendars");

    // Uncheck first holiday calendar
    await visibilityCheckboxes[0].click();
    await sleep(500);

    const countAfterUncheck = (await page.$$('[data-testid="calendar-event-pill"][data-is-holiday="true"]')).length;
    console.log(`  Visible holiday event pills after unchecking one feed: ${countAfterUncheck}`);

    // Re-query fresh handles to avoid stale detached element error in SolidJS
    const boxesToRecheck = await page.$$('[data-testid="calendar-visibility-checkbox"]');
    await boxesToRecheck[0].click();
    await sleep(500);

    const countAfterRecheck = (await page.$$('[data-testid="calendar-event-pill"][data-is-holiday="true"]')).length;
    console.log(`  Visible holiday event pills after re-checking: ${countAfterRecheck}`);
    assert(countAfterRecheck === countBeforeToggle, "All holiday event pills restored after re-checking visibility");

    await page.screenshot({ path: path.join(artifactsDir, 'calendar_holidays_visibility_toggled.png') });
    console.log("  Saved screenshot: calendar_holidays_visibility_toggled.png");

    // Step 13: 375px Mobile Viewport & Responsiveness Check
    console.log("\n--- [STEP 13] 375px Mobile Viewport & Responsiveness Check ---");
    await page.setViewport({ width: 375, height: 667 });
    await sleep(500);

    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    console.log(`  Horizontal overflow on 375px viewport: ${hasHorizontalOverflow ? "YES" : "NO"}`);
    assert(!hasHorizontalOverflow, "Zero horizontal scroll on 375px mobile viewport");

    // Open mobile sidebar drawer
    await page.waitForSelector('[data-testid="calendar-sidebar-toggle-btn"]', { timeout: 5000 });
    await page.click('[data-testid="calendar-sidebar-toggle-btn"]');
    await sleep(500);

    const mobileHolidayBadges = await page.$$('[data-testid="holiday-calendar-badge"]');
    console.log(`  Mobile drawer holiday calendar badges: ${mobileHolidayBadges.length}`);
    assert(mobileHolidayBadges.length >= 2, "Holiday feeds accessible in mobile drawer");

    await page.screenshot({ path: path.join(artifactsDir, 'calendar_holidays_mobile_responsive.png') });
    console.log("  Saved screenshot: calendar_holidays_mobile_responsive.png");

    // Close mobile drawer
    await page.evaluate(() => {
      const backdrop = document.querySelector('.fixed.inset-0.z-40');
      if (backdrop) backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await sleep(400);

    // Restore desktop viewport
    await page.setViewport({ width: 1280, height: 800 });
    await sleep(600);

    // Step 14: Safe Cleanup (Unsubscribe from test feeds)
    console.log("\n--- [STEP 14] Safe Cleanup (Unsubscribe from test feeds) ---");
    await page.waitForSelector('[data-testid="explore-calendars-btn"]', { timeout: 5000 });
    await page.click('[data-testid="explore-calendars-btn"]');
    await page.waitForSelector('[data-testid="holiday-catalogue-modal"]', { timeout: 5000 });
    await sleep(400);

    // Unsubscribe Bangladesh
    await page.waitForSelector('[data-testid="category-tab-country"]', { timeout: 5000 });
    await page.click('[data-testid="category-tab-country"]');
    await sleep(300);
    await page.waitForSelector('[data-testid="feed-item-holiday-bd"]', { timeout: 5000 });
    await page.click('[data-testid="feed-item-holiday-bd"]');
    await sleep(300);
    const unSubBtn1 = await page.$('[data-testid="unsubscribe-holiday-feed-btn"]');
    if (unSubBtn1) {
      await unSubBtn1.click();
      await sleep(300);
    }

    // Unsubscribe Islam
    await page.waitForSelector('[data-testid="category-tab-religion"]', { timeout: 5000 });
    await page.click('[data-testid="category-tab-religion"]');
    await sleep(300);
    await page.waitForSelector('[data-testid="feed-item-religion-islam"]', { timeout: 5000 });
    await page.click('[data-testid="feed-item-religion-islam"]');
    await sleep(300);
    const unSubBtn2 = await page.$('[data-testid="unsubscribe-holiday-feed-btn"]');
    if (unSubBtn2) {
      await unSubBtn2.click();
      await sleep(300);
    }

    await page.click('[data-testid="close-holiday-modal-btn"]');
    await sleep(500);

    const remainingHolidayBadges = await page.$$('[data-testid="holiday-calendar-badge"]');
    console.log(`  Remaining holiday badges after cleanup: ${remainingHolidayBadges.length}`);
    assert(remainingHolidayBadges.length === 0, "All holiday feeds safely unsubscribed");

    await page.screenshot({ path: path.join(artifactsDir, 'calendar_holidays_cleaned_up.png') });
    console.log("  Saved screenshot: calendar_holidays_cleaned_up.png");

    // Step 15: Error & Storage Verification
    console.log("\n--- [STEP 15] Error & DevTools Storage Verification ---");
    assert(uncaughtErrors.length === 0, `Zero uncaught page errors (found: ${uncaughtErrors.length})`);

    const storageDump = await page.evaluate(() => {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.includes('holiday')) {
          keys.push({ key: k, val: localStorage.getItem(k) });
        }
      }
      return keys;
    });
    console.log("  LocalStorage holiday entries after test:", JSON.stringify(storageDump));

    console.log("\n================================================================================");
    console.log("   ALL BROWSER VERIFICATION CHECKS PASSED SUCCESSFULLY                         ");
    console.log("================================================================================\n");

  } finally {
    await browser.close();
  }
}

runCalendarHolidaysBrowserTest().catch((err) => {
  console.error("\nFATAL BROWSER TEST ERROR:", err);
  process.exit(1);
});
