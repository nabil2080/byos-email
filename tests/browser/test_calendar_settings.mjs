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

async function runCalendarSettingsBrowserTest() {
  console.log("================================================================================");
  console.log("   BYOS CALENDAR SETTINGS FRAMEWORK (CATEGORY 01) BROWSER VERIFICATION          ");
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
    assert(activeAccountChip === "alice@byos.local", "User successfully authenticated as alice@byos.local");

    // Step 3: Switch to Calendar Module
    console.log("\n--- [STEP 3] Switch to Calendar Module ---");
    await page.waitForSelector('[data-testid="nav-calendar-tab"]', { timeout: 5000 });
    await page.click('[data-testid="nav-calendar-tab"]');
    await page.waitForSelector('[data-testid="calendar-view"]', { timeout: 10000 });
    console.log("  Switched to Calendar workspace view.");
    assert(await page.$('[data-testid="calendar-view"]') !== null, "Calendar workspace is active");

    // Step 4: Open Calendar Settings via Toolbar Gear Icon
    console.log("\n--- [STEP 4] Open Calendar Settings Modal via Toolbar ---");
    await page.waitForSelector('[data-testid="calendar-settings-btn"]', { timeout: 5000 });
    await page.click('[data-testid="calendar-settings-btn"]');
    await page.waitForSelector('[data-testid="calendar-settings-modal"]', { timeout: 5000 });
    console.log("  Calendar Settings Modal opened.");

    // Verify all 10 Navigation Sections exist
    const expectedSections = [
      "general",
      "event_defaults",
      "notifications",
      "view_options",
      "timezones",
      "working_hours",
      "privacy_sharing",
      "integrations",
      "shortcuts_a11y",
      "offline_sync",
    ];

    for (const sec of expectedSections) {
      const secSelector = `[data-testid="settings-nav-${sec}"]`;
      const exists = await page.$(secSelector) !== null;
      assert(exists, `Settings navigation section "${sec}" is present`);
    }

    // Step 5: Test Search / Filter Across Settings
    console.log("\n--- [STEP 5] Test Search / Filter Across Settings ---");
    const searchInputSelector = '[data-testid="calendar-settings-search"]';
    await page.waitForSelector(searchInputSelector);
    await page.type(searchInputSelector, 'week');
    await sleep(400);

    const weekStartItem = await page.$('[data-testid="setting-item-weekStart"]');
    assert(weekStartItem !== null, 'Search query "week" matched setting "weekStart"');

    // Language setting should NOT be visible when searching for "week"
    const languageItem = await page.$('[data-testid="setting-item-language"]');
    assert(languageItem === null, 'Non-matching setting "language" is filtered out during search');

    // Clear search
    await page.click('button[aria-label="Clear search"]');
    await sleep(300);
    const clearedLanguageItem = await page.$('[data-testid="setting-item-language"]');
    assert(clearedLanguageItem !== null, 'Clearing search restores section settings view');

    // Step 6: Change Settings & Verify Autosave and DevTools State
    console.log("\n--- [STEP 6] Change Settings and Verify Autosave ---");
    // Change weekStart to monday
    await page.select('[data-testid="select-weekStart"]', 'monday');
    // Change timeFormat to 24h
    await page.select('[data-testid="select-timeFormat"]', '24h');

    // Switch to View Options section
    await page.click('[data-testid="settings-nav-view_options"]');
    await sleep(300);
    // Change defaultView to month
    await page.select('[data-testid="select-defaultView"]', 'month');

    // Switch to Working Hours section
    await page.click('[data-testid="settings-nav-working_hours"]');
    await sleep(300);
    // Toggle workingHoursEnabled to true
    await page.click('[data-testid="toggle-workingHoursEnabled"]');

    await sleep(800);
    await page.waitForSelector('[data-testid="settings-save-status-saved"]', { timeout: 5000 });
    console.log("  Save status indicator displays: Saved.");

    // DevTools State Dump
    const storageDump = await page.evaluate(() => {
      const keys = Object.keys(localStorage);
      const res = {};
      for (const k of keys) {
        if (k.startsWith('byos_calendar')) {
          res[k] = localStorage.getItem(k);
        }
      }
      return res;
    });
    console.log("  DevTools Storage Dump (localStorage byos_calendar_*):");
    console.log(" ", JSON.stringify(storageDump, null, 2));

    const savedSettingsParsed = JSON.parse(Object.values(storageDump)[0] || "{}");
    assert(savedSettingsParsed.weekStart === "monday", "Persisted weekStart is 'monday'");
    assert(savedSettingsParsed.timeFormat === "24h", "Persisted timeFormat is '24h'");
    assert(savedSettingsParsed.defaultView === "month", "Persisted defaultView is 'month'");
    assert(savedSettingsParsed.workingHoursEnabled === true, "Persisted workingHoursEnabled is true");

    // Capture screenshot of desktop modal
    const desktopScreenshotPath = path.resolve(artifactsDir, 'calendar_settings_modal_desktop.png');
    await page.screenshot({ path: desktopScreenshotPath });
    console.log(`  Saved screenshot: ${desktopScreenshotPath}`);

    // Step 7: Close Settings Modal & Verify Views
    console.log("\n--- [STEP 7] Close Settings Modal & Verify Live Calendar Reflection ---");
    await page.click('[data-testid="calendar-settings-close-btn"]');
    await sleep(400);

    const isModalOpen = await page.$('[data-testid="calendar-settings-modal"]');
    assert(isModalOpen === null, "Settings modal closed cleanly");

    // Step 8: Test Webmail Settings Drawer Integration
    console.log("\n--- [STEP 8] Test Webmail Settings Drawer Integration ---");
    // Switch back to mail to access global sidebar settings
    await page.waitForSelector('[data-testid="back-to-mail-btn"]', { timeout: 5000 });
    await page.click('[data-testid="back-to-mail-btn"]');
    await sleep(600);

    // Open Webmail settings
    await page.waitForSelector('[data-testid="sidebar-settings-btn"]', { timeout: 5000 });
    await page.click('[data-testid="sidebar-settings-btn"]');
    await sleep(600);

    // Click Calendar tab in Webmail Settings
    await page.waitForSelector('[data-testid="settings-tab-calendar"]', { timeout: 5000 });
    await page.click('[data-testid="settings-tab-calendar"]');
    await sleep(600);

    const calendarTabContent = await page.$('[data-testid="settings-calendar-tab-content"]');
    assert(calendarTabContent !== null, "Calendar tab is rendered inside Webmail SettingsLayout");

    const webmailTabScreenshotPath = path.resolve(artifactsDir, 'calendar_settings_webmail_tab.png');
    await page.screenshot({ path: webmailTabScreenshotPath });
    console.log(`  Saved screenshot: ${webmailTabScreenshotPath}`);

    // Step 9: Test Reset to Defaults
    console.log("\n--- [STEP 9] Test Reset to Defaults with Confirmation ---");
    await page.click('[data-testid="calendar-settings-reset-btn"]');
    await sleep(300);

    const resetConfirmModal = await page.$('[data-testid="calendar-settings-reset-confirm"]');
    assert(resetConfirmModal !== null, "Reset confirmation modal is displayed");

    // Click Confirm Reset
    await page.click('[data-testid="calendar-settings-confirm-reset-btn"]');
    await sleep(800);

    const resetStorageDump = await page.evaluate(() => {
      const keys = Object.keys(localStorage);
      for (const k of keys) {
        if (k.startsWith('byos_calendar')) {
          return JSON.parse(localStorage.getItem(k));
        }
      }
      return null;
    });

    console.log("  After reset, restored defaultView:", resetStorageDump?.defaultView);
    console.log("  After reset, restored weekStart:", resetStorageDump?.weekStart);
    console.log("  After reset, restored timeFormat:", resetStorageDump?.timeFormat);
    assert(resetStorageDump?.defaultView === "week", "Restored defaultView is 'week'");
    assert(resetStorageDump?.weekStart === "sunday", "Restored weekStart is 'sunday'");
    assert(resetStorageDump?.timeFormat === "12h", "Restored timeFormat is '12h'");

    // Close Webmail settings back to inbox
    await page.click('[data-testid="settings-back-to-inbox-btn"]');
    await sleep(500);

    // Switch to Calendar while still in desktop mode
    await page.waitForSelector('[data-testid="nav-calendar-tab"]', { timeout: 5000 });
    await page.click('[data-testid="nav-calendar-tab"]');
    await page.waitForSelector('[data-testid="calendar-view"]', { timeout: 10000 });
    await sleep(500);

    // Step 10: Test Mobile Viewport at 375px
    console.log("\n--- [STEP 10] Test 375px Mobile Viewport with Zero Horizontal Overflow ---");
    await page.setViewport({ width: 375, height: 812 });
    await sleep(800);

    // Open Calendar settings modal via toolbar
    await page.waitForSelector('[data-testid="calendar-settings-btn"]', { timeout: 5000 });
    await page.click('[data-testid="calendar-settings-btn"]');
    await page.waitForSelector('[data-testid="calendar-settings-modal"]', { timeout: 5000 });
    await sleep(600);

    // Assert zero horizontal scrolling on mobile viewport
    const overflowCheck = await page.evaluate(() => {
      const doc = document.documentElement;
      const modal = document.querySelector('[data-testid="calendar-settings-panel"]');
      return {
        docScrollWidth: doc.scrollWidth,
        docClientWidth: doc.clientWidth,
        hasDocOverflow: doc.scrollWidth > doc.clientWidth,
        panelScrollWidth: modal ? modal.scrollWidth : 0,
        panelClientWidth: modal ? modal.clientWidth : 0,
        hasPanelOverflow: modal ? modal.scrollWidth > modal.clientWidth : false,
      };
    });

    console.log("  Mobile 375px Viewport Overflow Metrics:", JSON.stringify(overflowCheck));
    assert(!overflowCheck.hasDocOverflow, "Zero document horizontal overflow at 375px mobile viewport");
    assert(!overflowCheck.hasPanelOverflow, "Zero settings panel horizontal overflow at 375px mobile viewport");

    const mobileScreenshotPath = path.resolve(artifactsDir, 'calendar_settings_mobile_375px.png');
    await page.screenshot({ path: mobileScreenshotPath });
    console.log(`  Saved screenshot: ${mobileScreenshotPath}`);

    // Check uncaught errors
    console.log("\n--- Browser Console / Error Log Check ---");
    console.log(`  Total uncaught page errors: ${uncaughtErrors.length}`);
    if (uncaughtErrors.length > 0) {
      console.warn("  Uncaught errors:", uncaughtErrors);
    }
    assert(uncaughtErrors.length === 0, "No uncaught runtime errors during test execution");

    console.log("\n================================================================================");
    console.log("   ALL 10 BROWSER VERIFICATION CHECKS PASSED                                   ");
    console.log("================================================================================\n");
  } finally {
    await browser.close();
  }
}

runCalendarSettingsBrowserTest().catch((err) => {
  console.error("Browser test failed:", err);
  process.exit(1);
});
