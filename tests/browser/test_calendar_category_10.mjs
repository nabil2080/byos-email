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

async function runCalendarCategory10BrowserTest() {
  console.log("================================================================================");
  console.log("   BYOS CALENDAR: CATEGORY 10 END-TO-END BROWSER VERIFICATION                  ");
  console.log("   (Working Hours, Availability, Out of Office, Focus Time, Working Location)  ");
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

    page.on('dialog', async (dialog) => {
      console.log(`  [DIALOG] Prompt: "${dialog.message()}", accepting...`);
      await dialog.accept();
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

    // Step 4: Verify Working Location Chip in Day Headers
    console.log("\n--- [STEP 4] Verify Working Location Indicator in Day Header ---");
    // Switch to Week view to ensure week grid is visible
    const viewSelector = await page.$('[data-testid="calendar-view-selector"]');
    if (viewSelector) {
      await page.select('[data-testid="calendar-view-selector"]', 'week');
      await sleep(500);
    }

    const workLocationChips = await page.$$('[data-testid="day-work-location"]');
    console.log(`  Found ${workLocationChips.length} working location header indicators`);
    assert(workLocationChips.length > 0, "Working location chips rendered on day headers");

    const chipText = await page.$eval('[data-testid="day-work-location"]', (el) => el.textContent.trim());
    console.log(`  Sample working location chip text: "${chipText}"`);

    // Step 5: Create Out of Office (OOO) Event with Auto-Decline
    console.log("\n--- [STEP 5] Create Out of Office (OOO) Event with Auto-Decline ---");
    const newEventBtn = await page.waitForSelector('[data-testid="calendar-new-event-btn"]', { timeout: 5000 });
    await newEventBtn.click();
    await page.waitForSelector('[data-testid="event-modal"]', { timeout: 5000 });

    // Verify Event Type Tabs exist
    await page.waitForSelector('[data-testid="event-type-tabs"]', { timeout: 5000 });
    console.log("  Event type selector tabs present");

    // Click 'Out of office' tab
    const oooTab = await page.waitForSelector('[data-testid="event-type-tab-ooo"]', { timeout: 5000 });
    await oooTab.click();
    await sleep(300);

    // Verify OOO Options Panel rendered
    await page.waitForSelector('[data-testid="ooo-options-panel"]', { timeout: 5000 });
    console.log("  Out of office options panel displayed");

    // Fill title
    const oooTitle = `OOO Leave ${Date.now()}`;
    await page.type('[data-testid="event-title-input"]', oooTitle);

    // Verify auto-decline checkbox
    const autoDeclineCb = await page.waitForSelector('[data-testid="ooo-auto-decline-checkbox"]', { timeout: 5000 });
    const isChecked = await autoDeclineCb.evaluate((el) => el.checked);
    if (!isChecked) {
      await autoDeclineCb.click();
    }

    // Set custom decline message
    await page.waitForSelector('[data-testid="ooo-decline-message-input"]', { timeout: 5000 });
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="ooo-decline-message-input"]');
      if (el) {
        el.value = "Out of office for annual summit. Urgent matters please contact security team.";
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });

    // Save OOO Event
    const saveBtn1 = await page.waitForSelector('[data-testid="save-event-btn"]', { timeout: 5000 });
    await saveBtn1.click();
    await sleep(1000);

    // Verify OOO Event Pill and Badge on calendar
    await page.waitForSelector('[data-testid="ooo-event-badge"]', { timeout: 8000 });
    const oooBadgeText = await page.$eval('[data-testid="ooo-event-badge"]', (el) => el.textContent.trim());
    console.log(`  OOO event badge: "${oooBadgeText}"`);
    assert(oooBadgeText.includes("OOO"), "OOO event badge displayed on calendar view");

    // Step 6: Create Focus Time Event
    console.log("\n--- [STEP 6] Create Focus Time Event ---");
    await newEventBtn.click();
    await page.waitForSelector('[data-testid="event-modal"]', { timeout: 5000 });

    const focusTab = await page.waitForSelector('[data-testid="event-type-tab-focus"]', { timeout: 5000 });
    await focusTab.click();
    await sleep(300);

    const focusTitle = `Deep Work Focus ${Date.now()}`;
    await page.type('[data-testid="event-title-input"]', focusTitle);

    const saveBtn2 = await page.waitForSelector('[data-testid="save-event-btn"]', { timeout: 5000 });
    await saveBtn2.click();
    await sleep(1000);

    // Verify Focus Time badge on calendar
    await page.waitForSelector('[data-testid="focus-time-badge"]', { timeout: 8000 });
    const focusBadgeText = await page.$eval('[data-testid="focus-time-badge"]', (el) => el.textContent.trim());
    console.log(`  Focus time badge: "${focusBadgeText}"`);
    assert(focusBadgeText.includes("Focus"), "Focus time badge displayed on calendar view");

    // Step 7: Create Working Location Event
    console.log("\n--- [STEP 7] Create Working Location Event ---");
    await newEventBtn.click();
    await page.waitForSelector('[data-testid="event-modal"]', { timeout: 5000 });

    const locTab = await page.waitForSelector('[data-testid="event-type-tab-location"]', { timeout: 5000 });
    await locTab.click();
    await sleep(300);

    await page.waitForSelector('[data-testid="working-location-panel"]', { timeout: 5000 });
    await page.select('[data-testid="working-location-select"]', 'home');

    const locTitle = `WFH Remote ${Date.now()}`;
    await page.type('[data-testid="event-title-input"]', locTitle);

    const saveBtn3 = await page.waitForSelector('[data-testid="save-event-btn"]', { timeout: 5000 });
    await saveBtn3.click();
    await sleep(1000);

    // Verify Working Location badge on calendar
    await page.waitForSelector('[data-testid="working-location-badge"]', { timeout: 8000 });
    const locBadgeText = await page.$eval('[data-testid="working-location-badge"]', (el) => el.textContent.trim());
    console.log(`  Working location badge: "${locBadgeText}"`);
    assert(locBadgeText.includes("Location"), "Working location badge displayed on calendar view");

    // Take Desktop Screenshot
    const desktopScreenshotPath = path.resolve(artifactsDir, 'calendar_category_10_desktop.png');
    await page.screenshot({ path: desktopScreenshotPath });
    console.log(`  Desktop screenshot saved: ${desktopScreenshotPath}`);

    // Step 8: Open Calendar Settings & Verify Working Hours & Location Section
    console.log("\n--- [STEP 8] Verify Calendar Settings: Working Hours & Location ---");
    const isModalOpen = await page.$('[data-testid="event-modal"]');
    console.log(`  Event modal currently present: ${isModalOpen !== null}`);
    if (isModalOpen) {
      await page.waitForSelector('[data-testid="event-modal"]', { hidden: true, timeout: 5000 });
    }
    await sleep(400);

    await page.waitForSelector('[data-testid="calendar-settings-btn"]', { timeout: 5000 });
    await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="calendar-settings-btn"]');
      if (btn) btn.click();
    });
    await page.waitForSelector('[data-testid="calendar-settings-modal"]', { timeout: 8000 });
    console.log("  Settings modal opened");

    const workingHoursNav = await page.waitForSelector('[data-testid="settings-nav-working_hours"]', { timeout: 5000 });
    await workingHoursNav.click();
    await sleep(500);

    // Verify settings controls present
    const enabledInput = await page.$('[data-testid="setting-input-workingHoursEnabled"]');
    assert(enabledInput !== null, "Working hours enabled setting input rendered");

    const defaultLocSelect = await page.$('[data-testid="setting-input-defaultWorkLocation"]');
    assert(defaultLocSelect !== null, "Default work location setting select rendered");

    const autoDeclineToggle = await page.$('[data-testid="setting-input-autoDeclineOutOfOffice"]');
    assert(autoDeclineToggle !== null, "Auto-decline outside working hours setting toggle rendered");

    // Close Settings Modal
    const closeSettingsBtn = await page.waitForSelector('[data-testid="calendar-settings-close-btn"]', { timeout: 5000 });
    await closeSettingsBtn.click();
    await sleep(500);

    // Step 9: 375px Mobile Viewport & Responsiveness
    console.log("\n--- [STEP 9] 375px Mobile Viewport Verification ---");
    await page.setViewport({ width: 375, height: 667 });
    await sleep(600);

    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    assert(!hasHorizontalOverflow, "375px mobile viewport has zero horizontal scroll");

    const mobileScreenshotPath = path.resolve(artifactsDir, 'calendar_category_10_mobile.png');
    await page.screenshot({ path: mobileScreenshotPath });
    console.log(`  Mobile screenshot saved: ${mobileScreenshotPath}`);

    // Step 10: DevTools Storage & Console Verification
    console.log("\n--- [STEP 10] DevTools Storage & Console Verification ---");
    const storageKeys = await page.evaluate(() => Object.keys(localStorage));
    console.log(`  localStorage keys: [${storageKeys.join(', ')}]`);
    assert(storageKeys.length > 0, "localStorage contains active session data");

    console.log(`  Uncaught console errors: ${uncaughtErrors.length}`);
    if (uncaughtErrors.length > 0) {
      console.error("  Uncaught errors:", uncaughtErrors);
    }
    assert(uncaughtErrors.length === 0, "DevTools console has zero uncaught errors");

    console.log("\n================================================================================");
    console.log("   CATEGORY 10 BROWSER VERIFICATION: ALL 10 STEPS PASSED                       ");
    console.log("================================================================================\n");

  } finally {
    await browser.close();
  }
}

runCalendarCategory10BrowserTest().catch((err) => {
  console.error("\nFATAL ERROR IN CATEGORY 10 BROWSER TEST:", err);
  process.exit(1);
});
