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

async function run() {
  console.log("================================================================================");
  console.log("   BYOS CALENDAR: NOTIFICATION AUTO-DISMISS & SCROLLBAR FIX AUDIT              ");
  console.log("================================================================================\n");

  const uncaughtErrors = [];
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ['--no-sandbox', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    page.on('pageerror', (err) => {
      console.error(`  [PAGE ERROR]: ${err.message}`);
      uncaughtErrors.push(err.message);
    });

    console.log("--- [STEP 1] Login as alice@byos.local ---");
    await page.goto('http://127.0.0.1:3001', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(600);

    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.type('input[type="email"]', 'alice@byos.local');
    await page.type('input[type="password"]', 'test-password-123');
    await page.click('button[type="submit"]');

    await page.waitForSelector('[data-testid="account-chip-selector"]', { timeout: 15000 });
    console.log("  Successfully logged in as Alice");

    console.log("\n--- [STEP 2] Navigate to Calendar View ---");
    await page.waitForSelector('[data-testid="nav-calendar-tab"]', { timeout: 5000 });
    await page.click('[data-testid="nav-calendar-tab"]');
    await page.waitForSelector('[data-testid="calendar-view"]', { timeout: 10000 });
    await sleep(800);

    console.log("\n--- [STEP 3] Create an Upcoming Event with 15m Reminder to Trigger Notification ---");
    const createBtn = await page.waitForSelector('[data-testid="calendar-new-event-btn"]', { timeout: 5000 });
    await createBtn.click();
    await page.waitForSelector('[data-testid="event-modal"]', { timeout: 5000 });
    await sleep(400);

    // Set title and time: 5 minutes from now
    const now = new Date();
    const eventTime = new Date(now.getTime() + 5 * 60000);
    const endEventTime = new Date(now.getTime() + 65 * 60000);
    const sH = String(eventTime.getHours()).padStart(2, '0');
    const sM = String(eventTime.getMinutes()).padStart(2, '0');
    const eH = String(endEventTime.getHours()).padStart(2, '0');
    const eM = String(endEventTime.getMinutes()).padStart(2, '0');

    await page.type('[data-testid="event-title-input"]', "Urgent Strategy Debrief");
    await page.evaluate((s, e) => {
      const sInput = document.querySelector('[data-testid="event-start-time-input"]');
      const eInput = document.querySelector('[data-testid="event-end-time-input"]');
      if (sInput) {
        sInput.value = s;
        sInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      if (eInput) {
        eInput.value = e;
        eInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, `${sH}:${sM}`, `${eH}:${eM}`);

    await page.click('[data-testid="save-event-btn"]');
    await page.waitForFunction(() => document.querySelector('[data-testid="event-modal"]') === null, { timeout: 8000 });
    await sleep(1000);

    console.log("\n--- [STEP 4] Verify Notification Popup & Assert No Scrollbar ---");
    const toast = await page.waitForSelector('[data-testid="calendar-reminder-toast"]', { timeout: 10000 });
    assert(toast !== null, "Calendar notification toast is displayed for upcoming event");

    // Inspect container styles for scrollbar
    const containerMetrics = await page.evaluate(() => {
      const c = document.querySelector('[data-testid="calendar-reminder-container"]');
      if (!c) return null;
      const style = window.getComputedStyle(c);
      return {
        overflowY: style.overflowY,
        scrollHeight: c.scrollHeight,
        clientHeight: c.clientHeight,
        hasVerticalScrollbar: c.scrollHeight > c.clientHeight,
      };
    });

    console.log("  Container Metrics:", containerMetrics);
    assert(containerMetrics !== null, "Container exists");
    assert(containerMetrics.overflowY !== 'auto' && containerMetrics.overflowY !== 'scroll', "overflow-y is NOT auto or scroll");
    assert(!containerMetrics.hasVerticalScrollbar, "Zero vertical scrollbar on notification popup container");

    const toastScreenshot = path.resolve(artifactsDir, 'calendar_notification_no_scrollbar.png');
    await page.screenshot({ path: toastScreenshot });
    console.log(`  Saved screenshot: ${toastScreenshot}`);

    console.log("\n--- [STEP 5] Verify Auto-Dismiss After a Few Seconds ---");
    console.log("  Waiting 6.5 seconds for auto-dismiss timer...");
    const beforeDelayToasts = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid="calendar-reminder-toast"]')).map(t => ({
        text: t.textContent?.trim(),
        id: t.getAttribute('data-alert-id'),
      }))
    );
    console.log("  Toasts before delay:", beforeDelayToasts);
    await sleep(7000);

    const afterDelayToasts = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-testid="calendar-reminder-toast"]')).map(t => ({
        text: t.textContent?.trim(),
        id: t.getAttribute('data-alert-id'),
      }))
    );
    console.log("  Toasts after delay:", afterDelayToasts);

    const beforeIds = new Set(beforeDelayToasts.map(t => t.id));
    const stillPresent = afterDelayToasts.filter(t => beforeIds.has(t.id));
    assert(stillPresent.length === 0, "Notification automatically disappeared after a few seconds without user intervention");

    const dismissedScreenshot = path.resolve(artifactsDir, 'calendar_notification_auto_dismissed.png');
    await page.screenshot({ path: dismissedScreenshot });
    console.log(`  Saved screenshot: ${dismissedScreenshot}`);

    console.log("\n--- [STEP 6] Verify Persistence: Switching to Mailbox and Returning Does NOT Re-Trigger ---");
    // Switch to Mailbox
    const backToMailBtn = await page.waitForSelector('[data-testid="back-to-mail-btn"]', { timeout: 5000 });
    await backToMailBtn.click();
    await page.waitForSelector('[data-testid="main-content"]', { timeout: 5000 });
    await sleep(800);
    console.log("  Switched to Mailbox view");

    // Return to Calendar
    const calTabBtn = await page.waitForSelector('[data-testid="nav-calendar-tab"]', { timeout: 5000 });
    await calTabBtn.click();
    await page.waitForSelector('[data-testid="calendar-view"]', { timeout: 10000 });
    await sleep(1200);
    console.log("  Returned to Calendar view");

    // Assert that the dismissed alert does NOT pop up again!
    const retriggeredToast = await page.$('[data-testid="calendar-reminder-toast"]');
    assert(retriggeredToast === null, "Dismissed notification did NOT re-trigger when returning from mailbox to calendar");

    // Final Error Assertion
    assert(uncaughtErrors.length === 0, `Zero uncaught page errors (found ${uncaughtErrors.length})`);

    console.log("\n================================================================================");
    console.log("   ALL NOTIFICATION AUTO-DISMISS & SCROLLBAR FIX AUDITS PASSED                  ");
    console.log("================================================================================\n");
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});
