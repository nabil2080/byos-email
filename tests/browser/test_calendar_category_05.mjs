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

async function runCalendarCategory05BrowserTest() {
  console.log("================================================================================");
  console.log("   BYOS CALENDAR: CATEGORY 05 END-TO-END BROWSER VERIFICATION                  ");
  console.log("   (Language, Region, Time Zones, Dual Time Gutter & World Clock)             ");
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

    // Step 4: Verify World Clock Widget in Sidebar
    console.log("\n--- [STEP 4] Verify World Clock Widget in Sidebar ---");
    const worldClockWidget = await page.waitForSelector('[data-testid="calendar-world-clock-widget"]', { timeout: 5000 });
    assert(worldClockWidget !== null, "World Clock widget is displayed in Calendar Sidebar");

    const worldClockCities = await page.$$('[data-testid^="world-clock-city-"]');
    console.log(`  Found ${worldClockCities.length} configured world clock cities in sidebar`);
    assert(worldClockCities.length >= 2, "World clock widget displays preset default cities");

    // Click gear button to open World Clock Settings
    const configureWorldClockBtn = await page.waitForSelector('[data-testid="configure-world-clock-btn"]', { timeout: 5000 });
    await configureWorldClockBtn.click();
    await page.waitForSelector('[data-testid="calendar-settings-modal"]', { timeout: 5000 });
    await sleep(600);

    // Step 5: Configure Time Zones & World Clock in Settings
    console.log("\n--- [STEP 5] Configure Time Zones & World Clock in Settings ---");
    // Verify we landed on Time zones section
    const tzNavSelected = await page.$eval('[data-testid="settings-nav-timezones"]', (el) => el.getAttribute('aria-selected'));
    assert(tzNavSelected === 'true', "Navigated directly to Time zones & world clock section in Settings");

    // Verify Primary Timezone Select exists
    const primaryTzSelect = await page.waitForSelector('[data-testid="settings-primary-tz-select"]', { timeout: 5000 });
    assert(primaryTzSelect !== null, "Primary time zone selector exists");

    // Enable Secondary Timezone
    console.log("  Enabling secondary time zone...");
    const secTzToggle = await page.waitForSelector('[data-testid="settings-secondary-tz-toggle"]', { timeout: 5000 });
    const isSecTzChecked = await page.evaluate((el) => el.checked, secTzToggle);
    if (!isSecTzChecked) {
      await secTzToggle.click();
      await sleep(300);
    }

    // Select America/New_York
    await page.waitForSelector('[data-testid="settings-secondary-tz-select"]', { timeout: 5000 });
    await page.select('[data-testid="settings-secondary-tz-select"]', 'America/New_York');
    await sleep(300);

    // Set custom label NYC
    const secLabelInput = await page.waitForSelector('[data-testid="settings-secondary-tz-label-input"]', { timeout: 5000 });
    await page.evaluate((el) => { el.value = ''; }, secLabelInput);
    await secLabelInput.type('NYC');
    await sleep(300);

    // Add Sydney to World Clock
    console.log("  Adding Sydney to World Clock preset list...");
    await page.select('[data-testid="world-clock-preset-select"]', 'sydney');
    await sleep(200);
    const addCityBtn = await page.waitForSelector('[data-testid="add-city-btn"]', { timeout: 5000 });
    await addCityBtn.click();
    await sleep(400);

    // Verify Sydney is in the manager list
    const sydneyItem = await page.waitForSelector('[data-testid="world-clock-item-sydney"]', { timeout: 5000 });
    assert(sydneyItem !== null, "Sydney added to World Clock manager list");

    // Save screenshot of Settings
    await page.screenshot({
      path: path.join(artifactsDir, 'calendar_category_05_settings_tz_world_clock.png'),
    });
    console.log("  Screenshot saved: calendar_category_05_settings_tz_world_clock.png");

    // Close Settings
    const closeSettingsBtn = await page.waitForSelector('[data-testid="calendar-settings-close-btn"]', { timeout: 5000 });
    await closeSettingsBtn.click();
    await sleep(600);

    // Step 6: Verify Dual Time Zone in Week View
    console.log("\n--- [STEP 6] Verify Dual Time Zone in Week View ---");
    const weekViewBtn = await page.waitForSelector('[data-testid="view-week-btn"]', { timeout: 5000 });
    await weekViewBtn.click();
    await sleep(600);

    // Verify dual header
    const dualTzHeader = await page.waitForSelector('[data-testid="week-dual-timezone-header"]', { timeout: 5000 });
    assert(dualTzHeader !== null, "Week View renders dual time-zone header");
    const headerText = await page.$eval('[data-testid="week-dual-timezone-header"]', (el) => el.textContent.trim());
    console.log(`  Week dual header text: "${headerText}"`);
    assert(headerText.includes("NYC"), "Week dual header displays custom secondary label NYC");

    // Verify dual hours gutter
    const dualGutter = await page.waitForSelector('[data-testid="week-dual-timezone-gutter"]', { timeout: 5000 });
    assert(dualGutter !== null, "Week View renders dual time-zone gutter");

    const secHours = await page.$$('[data-testid="week-secondary-hour"]');
    const priHours = await page.$$('[data-testid="week-primary-hour"]');
    assert(secHours.length === 24, `Week view renders 24 secondary hours (found ${secHours.length})`);
    assert(priHours.length === 24, `Week view renders 24 primary hours (found ${priHours.length})`);

    await page.screenshot({
      path: path.join(artifactsDir, 'calendar_category_05_week_dual_tz.png'),
    });
    console.log("  Screenshot saved: calendar_category_05_week_dual_tz.png");

    // Step 7: Verify Dual Time Zone in Day View
    console.log("\n--- [STEP 7] Verify Dual Time Zone in Day View ---");
    const dayViewBtn = await page.waitForSelector('[data-testid="view-day-btn"]', { timeout: 5000 });
    await dayViewBtn.click();
    await sleep(600);

    const daySecBadge = await page.waitForSelector('[data-testid="day-secondary-tz-badge"]', { timeout: 5000 });
    assert(daySecBadge !== null, "Day View renders secondary time-zone badge");
    const dayBadgeText = await page.$eval('[data-testid="day-secondary-tz-badge"]', (el) => el.textContent.trim());
    console.log(`  Day view badge text: "${dayBadgeText}"`);
    assert(dayBadgeText.includes("NYC") || dayBadgeText.includes("New_York"), "Day view badge indicates NYC / America/New_York");

    const dayDualGutter = await page.waitForSelector('[data-testid="day-dual-timezone-gutter"]', { timeout: 5000 });
    assert(dayDualGutter !== null, "Day View renders dual time-zone gutter");

    await page.screenshot({
      path: path.join(artifactsDir, 'calendar_category_05_day_dual_tz.png'),
    });
    console.log("  Screenshot saved: calendar_category_05_day_dual_tz.png");

    // Step 8: Per-Event Timezone in Event Creation Modal
    console.log("\n--- [STEP 8] Per-Event Timezone in Event Creation Modal ---");
    const createEventBtn = await page.waitForSelector('[data-testid="calendar-new-event-btn"]', { timeout: 5000 });
    await createEventBtn.click();
    await page.waitForSelector('[data-testid="event-modal"]', { timeout: 5000 });
    await sleep(500);

    const eventTzSelect = await page.waitForSelector('[data-testid="event-timezone-select"]', { timeout: 5000 });
    assert(eventTzSelect !== null, "Event modal provides per-event time zone selector");

    // Fill Title and set Event Timezone to America/New_York
    const titleInput = await page.waitForSelector('[data-testid="event-title-input"]', { timeout: 5000 });
    await titleInput.type("Category 05 Multi-TZ Sync");
    await page.select('[data-testid="event-timezone-select"]', 'America/New_York');
    await sleep(300);

    await page.screenshot({
      path: path.join(artifactsDir, 'calendar_category_05_event_tz_modal.png'),
    });
    console.log("  Screenshot saved: calendar_category_05_event_tz_modal.png");

    // Save Event
    const saveEventBtn = await page.waitForSelector('[data-testid="save-event-btn"]', { timeout: 5000 });
    await saveEventBtn.click();
    await sleep(800);

    // Verify event pill is rendered
    const eventPill = await page.waitForSelector('[data-testid="calendar-event-pill"]', { timeout: 8000 });
    assert(eventPill !== null, "Created cross-timezone event is rendered on calendar grid");

    // Step 9: Responsive Viewport Check (375px mobile viewport)
    console.log("\n--- [STEP 9] Responsive Viewport Check (375px) ---");
    await page.setViewport({ width: 375, height: 667 });
    await sleep(600);

    const isHorizontalScrollPresent = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    assert(!isHorizontalScrollPresent, "Strictly NO horizontal scroll permitted on 375px mobile viewport");

    await page.screenshot({
      path: path.join(artifactsDir, 'calendar_category_05_mobile_375px.png'),
    });
    console.log("  Screenshot saved: calendar_category_05_mobile_375px.png");

    // Step 10: Storage & DevTools Verification
    console.log("\n--- [STEP 10] DevTools Storage & State Verification ---");
    const storedSettings = await page.evaluate(() => {
      const keys = Object.keys(localStorage);
      const settingsKey = keys.find((k) => k.startsWith("byos_calendar_settings_"));
      if (!settingsKey) return null;
      return JSON.parse(localStorage.getItem(settingsKey));
    });

    console.log("  Stored Calendar Settings in localStorage:");
    console.log(JSON.stringify(storedSettings, null, 2));

    assert(storedSettings !== null, "Calendar settings persisted in localStorage");
    assert(storedSettings.showSecondaryTimeZone === true, "showSecondaryTimeZone persisted as true");
    assert(storedSettings.secondaryTimeZone === "America/New_York", "secondaryTimeZone persisted as America/New_York");
    assert(storedSettings.secondaryTimeZoneLabel === "NYC", "secondaryTimeZoneLabel persisted as NYC");
    assert(storedSettings.worldClockCities.some((c) => c.id === "sydney"), "Sydney persisted in worldClockCities");

    assert(uncaughtErrors.length === 0, `Zero uncaught page errors (found ${uncaughtErrors.length})`);

    console.log("\n================================================================================");
    console.log("   CATEGORY 05 BROWSER VERIFICATION COMPLETE: ALL CHECKS PASSED               ");
    console.log("================================================================================\n");

  } finally {
    await browser.close();
  }
}

runCalendarCategory05BrowserTest().catch((err) => {
  console.error("FATAL ERROR in runCalendarCategory05BrowserTest:", err);
  process.exit(1);
});
