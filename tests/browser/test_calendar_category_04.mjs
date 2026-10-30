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

async function runCalendarCategory04BrowserTest() {
  console.log("================================================================================");
  console.log("   BYOS CALENDAR: CATEGORY 04 END-TO-END BROWSER VERIFICATION                  ");
  console.log("   (Alternate Date Systems & Special-Interest / Sports Calendars)             ");
  console.log("================================================================================\n");

  const uncaughtErrors = [];
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

    // Step 1: Navigate to Webmail & Clear Storage
    console.log("\n--- [STEP 1] Navigate to Webmail & Clear Storage ---");
    let baseUrl = 'http://127.0.0.1:3001';
    for (const port of [3001, 3002, 3003]) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}`);
        if (res.ok) {
          baseUrl = `http://127.0.0.1:${port}`;
          break;
        }
      } catch {}
    }
    console.log(`  Target server: ${baseUrl}`);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
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

    // Step 4: Open Settings & Configure Alternate Calendar (Bengali)
    console.log("\n--- [STEP 4] Open Calendar Settings & Configure Alternate Calendar ---");
    const settingsBtn = await page.waitForSelector('[data-testid="calendar-settings-btn"]', { timeout: 5000 });
    await settingsBtn.click();
    await page.waitForSelector('[data-testid="calendar-settings-modal"]', { timeout: 5000 });
    await sleep(600);

    // Click "View options" in settings navigation
    const viewOptionsNav = await page.waitForSelector('[data-testid="settings-nav-view_options"]', { timeout: 5000 });
    await viewOptionsNav.click();
    await sleep(500);

    // Select "bengali" from alternateCalendar dropdown
    const altCalSelect = await page.waitForSelector('select[data-testid="setting-input-alternateCalendar"]', { timeout: 5000 });
    assert(altCalSelect !== null, "Alternate calendar select dropdown is present under View options");
    await page.select('select[data-testid="setting-input-alternateCalendar"]', 'bengali');
    await sleep(500);

    // Close settings modal
    const closeSettingsBtn = await page.waitForSelector('[data-testid="calendar-settings-close-btn"]', { timeout: 5000 });
    await closeSettingsBtn.click();
    await sleep(600);
    console.log("  Configured alternate calendar to 'bengali' and saved");

    // Step 5: Verify Alternate Dates in Month View
    console.log("\n--- [STEP 5] Verify Secondary Alternate Dates in Month View ---");
    // Switch to month view if not already
    const monthViewBtn = await page.waitForSelector('[data-testid="view-month-btn"]', { timeout: 5000 });
    await monthViewBtn.click();
    await sleep(600);

    const monthAltBadges = await page.$$('[data-testid="month-alternate-date"]');
    assert(monthAltBadges.length > 0, `Month view renders secondary alternate date badges (${monthAltBadges.length} found)`);

    const firstMonthAlt = await page.$eval('[data-testid="month-alternate-date"]', (el) => el.textContent.trim());
    console.log(`  Sample Month View alternate badge: "${firstMonthAlt}"`);
    assert(firstMonthAlt.length > 0, "Alternate date badge has text content");

    await page.screenshot({
      path: path.join(artifactsDir, 'calendar_category_04_bengali_month.png'),
    });
    console.log("  Screenshot saved: calendar_category_04_bengali_month.png");

    // Step 6: Verify Alternate Dates in Week View
    console.log("\n--- [STEP 6] Verify Secondary Alternate Dates in Week View ---");
    const weekViewBtn = await page.waitForSelector('[data-testid="view-week-btn"]', { timeout: 5000 });
    await weekViewBtn.click();
    await sleep(600);

    const weekAltBadges = await page.$$('[data-testid="week-alternate-date"]');
    assert(weekAltBadges.length > 0, `Week view day headers display secondary alternate date badges (${weekAltBadges.length} found)`);
    const sampleWeekAlt = await page.$eval('[data-testid="week-alternate-date"]', (el) => el.textContent.trim());
    console.log(`  Sample Week View alternate badge: "${sampleWeekAlt}"`);
    assert(sampleWeekAlt.length > 0, "Week view alternate badge is populated");

    // Step 7: Verify Alternate Dates in Day View
    console.log("\n--- [STEP 7] Verify Secondary Alternate Dates in Day View ---");
    const dayViewBtn = await page.waitForSelector('[data-testid="view-day-btn"]', { timeout: 5000 });
    await dayViewBtn.click();
    await sleep(600);

    const dayAltHeader = await page.waitForSelector('[data-testid="day-alternate-date"]', { timeout: 5000 });
    assert(dayAltHeader !== null, "Day view header displays secondary alternate date");
    const dayAltText = await page.$eval('[data-testid="day-alternate-date"]', (el) => el.textContent.trim());
    console.log(`  Day View alternate date: "${dayAltText}"`);
    assert(dayAltText.includes("BE") || dayAltText.includes("বঙ্গাব্দ"), "Day View alternate date includes Bangabda era indicator");

    // Step 8: Verify Alternate Dates in Year View
    console.log("\n--- [STEP 8] Verify Secondary Alternate Dates in Year View Day Inspector ---");
    const yearViewBtn = await page.waitForSelector('[data-testid="view-year-btn"]', { timeout: 5000 });
    await yearViewBtn.click();
    await sleep(600);

    // Click on a day button in Year View to open Inspector
    await page.waitForSelector('[data-testid="year-day-cell"]', { timeout: 5000 });
    const yearDayBtns = await page.$$('[data-testid="year-day-cell"]');
    assert(yearDayBtns.length > 0, "Year view rendered interactive day cells");
    await yearDayBtns[15].click(); // click 15th cell
    await sleep(500);

    const yearInspector = await page.waitForSelector('[data-testid="year-day-inspector"]', { timeout: 5000 });
    assert(yearInspector !== null, "Day inspector opened in Year View");

    const yearAltText = await page.$eval('[data-testid="year-inspector-alternate-date"]', (el) => el.textContent.trim());
    console.log(`  Year View Inspector alternate date: "${yearAltText}"`);
    assert(yearAltText.includes("BE") || yearAltText.includes("বঙ্গাব্দ"), "Year View inspector displays secondary Bangabda date");

    await page.screenshot({
      path: path.join(artifactsDir, 'calendar_category_04_bengali_day_year.png'),
    });
    console.log("  Screenshot saved: calendar_category_04_bengali_day_year.png");

    // Close Day Inspector
    const closeInspectorBtn = await page.waitForSelector('[data-testid="year-day-inspector-close"]', { timeout: 5000 });
    await closeInspectorBtn.click();
    await sleep(400);

    // Step 9: Browse Calendars of Interest -> Special & Sports Tab
    console.log("\n--- [STEP 9] Browse Calendars of Interest: Special & Sports Tab ---");
    const openSettingsAgain = await page.waitForSelector('[data-testid="calendar-settings-btn"]', { timeout: 5000 });
    await openSettingsAgain.click();
    await page.waitForSelector('[data-testid="calendar-settings-modal"]', { timeout: 5000 });
    await sleep(600);

    // Click "Browse calendars of interest" in settings navigation
    const browseNavBtn = await page.waitForSelector('[data-testid="settings-nav-holiday_calendars"]', { timeout: 5000 });
    await browseNavBtn.click();
    await sleep(600);

    // Click "Special & Sports" sub-tab
    const specialTabBtn = await page.waitForSelector('[data-testid="browse-tab-other"]', { timeout: 5000 });
    await specialTabBtn.click();
    await sleep(600);

    // Verify Moon Phases feed is visible
    const moonToggle = await page.waitForSelector('[data-testid="toggle-other-moon"]', { timeout: 5000 });
    assert(moonToggle !== null, "Phases of the Moon feed is present in Special & Sports catalogue");

    // Verify ICC Cricket card is visible
    const iccCard = await page.waitForSelector('[data-testid="settings-sports-card-sports-cricket-icc"]', { timeout: 5000 });
    assert(iccCard !== null, "ICC Cricket feed card is present in Special & Sports catalogue");

    // Click Preview on ICC Cricket
    const previewIccBtn = await page.waitForSelector('[data-testid="preview-sports-sports-cricket-icc"]', { timeout: 5000 });
    await previewIccBtn.click();
    await sleep(500);

    await page.screenshot({
      path: path.join(artifactsDir, 'calendar_category_04_sports_catalogue.png'),
    });
    console.log("  Screenshot saved: calendar_category_04_sports_catalogue.png");

    // Step 10: Subscribe to Moon phases & ICC Cricket
    console.log("\n--- [STEP 10] Subscribe to Moon Phases and ICC Cricket Feeds ---");
    await moonToggle.click();
    await sleep(400);

    const iccToggle = await page.waitForSelector('[data-testid="toggle-sports-sports-cricket-icc"]', { timeout: 5000 });
    await iccToggle.click();
    await sleep(500);

    // Close Settings
    const closeSettings2 = await page.waitForSelector('[data-testid="calendar-settings-close-btn"]', { timeout: 5000 });
    await closeSettings2.click();
    await sleep(800);

    // Step 11: Verify Badges in Calendar Sidebar "Other Calendars"
    console.log("\n--- [STEP 11] Verify Badges in Calendar Sidebar 'Other Calendars' ---");
    const moonBadge = await page.waitForSelector('[data-testid="moon-calendar-badge"]', { timeout: 8000 });
    assert(moonBadge !== null, "Sidebar renders 'Moon' badge for Phases of the Moon calendar");

    const sportsBadge = await page.waitForSelector('[data-testid="sports-calendar-badge"]', { timeout: 8000 });
    assert(sportsBadge !== null, "Sidebar renders 'Sports' badge for ICC Cricket calendar");

    await page.screenshot({
      path: path.join(artifactsDir, 'calendar_category_04_sidebar_badges.png'),
    });
    console.log("  Screenshot saved: calendar_category_04_sidebar_badges.png");

    // Step 12: Mobile Viewport 375px Responsiveness (Zero Horizontal Overflow)
    console.log("\n--- [STEP 12] Mobile Viewport 375px Responsiveness Check ---");
    await page.setViewport({ width: 375, height: 667 });
    await sleep(800);

    const overflowCheck = await page.evaluate(() => {
      return {
        docScrollWidth: document.documentElement.scrollWidth,
        docClientWidth: document.documentElement.clientWidth,
        bodyScrollWidth: document.body.scrollWidth,
        bodyClientWidth: document.body.clientWidth,
      };
    });

    console.log(`  375px Viewport Dimensions: scrollWidth=${overflowCheck.docScrollWidth}, clientWidth=${overflowCheck.docClientWidth}`);
    assert(overflowCheck.docScrollWidth <= overflowCheck.docClientWidth + 1, "Zero horizontal overflow on 375px mobile viewport");

    await page.screenshot({
      path: path.join(artifactsDir, 'calendar_category_04_mobile_375px.png'),
    });
    console.log("  Screenshot saved: calendar_category_04_mobile_375px.png");

    // Step 13: Clean Unsubscription
    console.log("\n--- [STEP 13] Clean Unsubscription ---");
    await page.setViewport({ width: 1280, height: 800 });
    await sleep(400);

    const openSettings3 = await page.waitForSelector('[data-testid="calendar-settings-btn"]', { timeout: 5000 });
    await openSettings3.click();
    await page.waitForSelector('[data-testid="calendar-settings-modal"]', { timeout: 5000 });
    await sleep(600);

    const browseNavBtn2 = await page.waitForSelector('[data-testid="settings-nav-holiday_calendars"]', { timeout: 5000 });
    await browseNavBtn2.click();
    await sleep(600);

    const specialTabBtn2 = await page.waitForSelector('[data-testid="browse-tab-other"]', { timeout: 5000 });
    await specialTabBtn2.click();
    await sleep(600);

    // Uncheck moon & sports
    const moonToggle2 = await page.waitForSelector('[data-testid="toggle-other-moon"]', { timeout: 5000 });
    await moonToggle2.click();
    await sleep(300);

    const iccToggle2 = await page.waitForSelector('[data-testid="toggle-sports-sports-cricket-icc"]', { timeout: 5000 });
    await iccToggle2.click();
    await sleep(500);

    const closeSettings3 = await page.waitForSelector('[data-testid="calendar-settings-close-btn"]', { timeout: 5000 });
    await closeSettings3.click();
    await sleep(600);

    console.log("  Feeds cleanly unsubscribed");
    console.log("\n================================================================================");
    console.log("   CATEGORY 04 BROWSER VERIFICATION: ALL CHECKS PASSED SUCCESSFULLY             ");
    console.log("================================================================================\n");

  } finally {
    await browser.close();
  }
}

runCalendarCategory04BrowserTest().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
