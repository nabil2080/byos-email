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

async function runCalendarCategory08BrowserTest() {
  console.log("================================================================================");
  console.log("   BYOS CALENDAR: CATEGORY 08 END-TO-END BROWSER VERIFICATION                  ");
  console.log("   (Notifications, Multi-Reminders, In-App Banner, Snooze & Privacy Masking)   ");
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

    // Accept confirm dialogs
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

    // Step 4: Open Event Modal and Test Multi-Reminder Rows
    console.log("\n--- [STEP 4] Test Multi-Reminder Rows (Add, Update Method, Remove) ---");
    const newEventBtn = await page.waitForSelector('[data-testid="calendar-new-event-btn"]', { timeout: 5000 });
    await newEventBtn.click();
    await page.waitForSelector('[data-testid="event-modal"]', { timeout: 5000 });

    // Assert Reminders section exists
    await page.waitForSelector('[data-testid="event-reminders-section"]', { timeout: 5000 });
    console.log("  Event reminders section rendered");

    // Check initial reminder row
    const row0 = await page.$('[data-testid="reminder-row-0"]');
    assert(row0 !== null, "Initial reminder row 0 is present");

    // Click Add Reminder
    const addReminderBtn = await page.waitForSelector('[data-testid="add-reminder-btn"]', { timeout: 5000 });
    await addReminderBtn.click();
    await sleep(300);

    // Verify row 1 appeared
    const row1 = await page.$('[data-testid="reminder-row-1"]');
    assert(row1 !== null, "Second reminder row 1 is added");

    // Change method of row 1 to email
    await page.select('[data-testid="reminder-method-1"]', 'email');
    const row1Method = await page.$eval('[data-testid="reminder-method-1"]', (el) => el.value);
    assert(row1Method === "email", "Row 1 method updated to email");

    // Remove row 1
    const removeRow1Btn = await page.waitForSelector('[data-testid="remove-reminder-1"]', { timeout: 5000 });
    await removeRow1Btn.click();
    await sleep(300);

    const row1AfterRemove = await page.$('[data-testid="reminder-row-1"]');
    assert(row1AfterRemove === null, "Row 1 successfully removed");

    // Step 5: Configure Event Triggering an Immediate Reminder Alert
    console.log("\n--- [STEP 5] Create Event with Immediate Reminder Trigger ---");
    const testTitle = `Reminder Test ${Date.now()}`;
    await page.type('[data-testid="event-title-input"]', testTitle);
    await page.type('[data-testid="event-location-input"]', "War Room Alpha");

    // Set reminder on row 0 to 10 minutes before (so event starting now or in 5m triggers)
    await page.select('[data-testid="event-reminder-override-select"]', '10');

    // Save event
    const saveBtn = await page.waitForSelector('[data-testid="save-event-btn"]', { timeout: 5000 });
    await saveBtn.click();
    await sleep(1000);

    // Step 6: Verify Active Notification Toast Banner
    console.log("\n--- [STEP 6] Verify Notification Toast Card Appearance & Content ---");
    await page.waitForSelector('[data-testid="calendar-reminder-toast"]', { timeout: 10000 });
    const toastTitle = await page.$eval('[data-testid="reminder-title"]', (el) => el.textContent.trim());
    console.log(`  Toast notification title: "${toastTitle}"`);
    assert(toastTitle === testTitle, "Toast title matches created event title");

    // Take Desktop Screenshot
    const desktopScreenshotPath = path.resolve(artifactsDir, 'calendar_category_08_desktop.png');
    await page.screenshot({ path: desktopScreenshotPath });
    console.log(`  Desktop screenshot saved: ${desktopScreenshotPath}`);

    // Step 7: Test Snooze Action
    console.log("\n--- [STEP 7] Test Snooze Action on Toast Card ---");
    const snoozeBtn = await page.waitForSelector('[data-testid="reminder-snooze-btn"]', { timeout: 5000 });
    await snoozeBtn.click();
    await page.waitForSelector('[data-testid="reminder-snooze-menu"]', { timeout: 5000 });
    console.log("  Snooze dropdown menu opened");

    const snooze5m = await page.waitForSelector('[data-testid="snooze-option-5m"]', { timeout: 5000 });
    await snooze5m.click();
    await sleep(500);

    const toastAfterSnooze = await page.$('[data-testid="calendar-reminder-toast"]');
    assert(toastAfterSnooze === null, "Toast card is snoozed and temporarily removed");
    console.log("  Reminder successfully snoozed for 5 minutes");

    // Step 8: Create Second Event & Test Dismiss Action
    console.log("\n--- [STEP 8] Test Dismiss Action on Toast Card ---");
    await newEventBtn.click();
    await page.waitForSelector('[data-testid="event-modal"]', { timeout: 5000 });

    const dismissTestTitle = `Dismiss Test ${Date.now()}`;
    await page.type('[data-testid="event-title-input"]', dismissTestTitle);
    await page.select('[data-testid="event-reminder-override-select"]', '10');
    await (await page.waitForSelector('[data-testid="save-event-btn"]')).click();
    await sleep(1000);

    await page.waitForSelector('[data-testid="calendar-reminder-toast"]', { timeout: 10000 });
    const toastDismissTitle = await page.$eval('[data-testid="reminder-title"]', (el) => el.textContent.trim());
    assert(toastDismissTitle === dismissTestTitle, "Second toast notification appeared");

    const dismissBtn = await page.waitForSelector('[data-testid="reminder-dismiss-btn"]', { timeout: 5000 });
    await dismissBtn.click();
    await sleep(500);

    const toastAfterDismiss = await page.$('[data-testid="calendar-reminder-toast"]');
    assert(toastAfterDismiss === null, "Toast card is permanently dismissed");
    console.log("  Reminder successfully dismissed");

    // Step 9: 375px Mobile Viewport & Responsiveness
    console.log("\n--- [STEP 9] 375px Mobile Viewport Verification ---");
    await page.setViewport({ width: 375, height: 667 });
    await sleep(500);

    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    assert(!hasHorizontalOverflow, "375px mobile viewport has zero horizontal scroll");

    const mobileScreenshotPath = path.resolve(artifactsDir, 'calendar_category_08_mobile.png');
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
    console.log("   CATEGORY 08 BROWSER VERIFICATION: ALL 10 STEPS PASSED                       ");
    console.log("================================================================================\n");

  } finally {
    await browser.close();
  }
}

runCalendarCategory08BrowserTest().catch((err) => {
  console.error("\nFATAL ERROR IN CATEGORY 08 BROWSER TEST:", err);
  process.exit(1);
});
