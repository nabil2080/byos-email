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

async function runCalendarBrowserTests() {
  console.log("================================================================================");
  console.log("             BYOS WEBMAIL CALENDAR SUBSYSTEM BROWSER VERIFICATION               ");
  console.log("================================================================================\n");

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ['--no-sandbox', '--disable-gpu'],
  });

  const unhandledErrors = [];
  const networkRequests = [];

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (
          !text.includes('/v1/auth/me') &&
          !text.includes('favicon') &&
          !text.includes('401 (Unauthorized)') &&
          !text.includes('Failed to load resource') &&
          !text.includes('net::ERR_INTERNET_DISCONNECTED')
        ) {
          unhandledErrors.push(text);
          console.error(`  [CONSOLE ERROR] ${text}`);
        }
      }
    });

    page.on('request', (req) => {
      if (req.url().includes('/v1/mailboxes')) {
        networkRequests.push({
          method: req.method(),
          url: req.url(),
          postData: req.postData(),
        });
      }
    });

    // =========================================================================
    // STEP 1: Real login flow as Alice
    // =========================================================================
    console.log("--- [STEP 1] Real login flow as Alice (alice@byos.local) ---");
    await page.goto('http://127.0.0.1:3001', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1000);

    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.type('input[type="email"]', 'alice@byos.local');
    await page.type('input[type="password"]', 'test-password-123');
    await page.click('button[type="submit"]');

    await sleep(2000);
    const currentUrl = page.url();
    console.log(`  Current page URL after submit: ${currentUrl}`);
    const pageText = await page.evaluate(() => document.body.innerText);
    console.log(`  Page text snippet: ${pageText.slice(0, 300).replace(/\n/g, ' ')}`);

    await page.screenshot({ path: path.join(artifactsDir, 'login_debug.png') });

    await page.waitForSelector('[data-testid="account-chip-selector"]', { timeout: 15000 });
    await sleep(1000);
    console.log("  Successfully logged in as Alice.");

    // =========================================================================
    // STEP 2: Navigate to Calendar Module
    // =========================================================================
    console.log("\n--- [STEP 2] Navigate to Calendar Module ---");
    await page.waitForSelector('[data-testid="nav-calendar-tab"]', { timeout: 5000 });
    await page.click('[data-testid="nav-calendar-tab"]');
    await sleep(1200);

    // Verify CalendarView is rendered
    const calendarViewExists = await page.$('[data-testid="calendar-view"]');
    assert(calendarViewExists !== null, "CalendarView component mounted");

    // Verify Today button and navigation
    const todayBtn = await page.$('[data-testid="calendar-today-btn"]');
    assert(todayBtn !== null, "Today navigation button exists");

    // Take screenshot of initial week view
    const initialScreenshot = path.join(artifactsDir, 'calendar_initial_week_view.png');
    await page.screenshot({ path: initialScreenshot });
    console.log(`  Saved screenshot: ${initialScreenshot}`);

    // =========================================================================
    // STEP 3: View Mode Switching
    // =========================================================================
    console.log("\n--- [STEP 3] View Mode Switching (Day / Week / Month / Agenda) ---");
    
    // Switch to Day
    await page.click('[data-testid="view-day-btn"]');
    await sleep(400);
    const dayBtnClass = await page.$eval('[data-testid="view-day-btn"]', el => el.className);
    assert(dayBtnClass.includes('shadow-2xs'), "Day view mode active");

    // Switch to Month
    await page.click('[data-testid="view-month-btn"]');
    await sleep(400);
    const monthBtnClass = await page.$eval('[data-testid="view-month-btn"]', el => el.className);
    assert(monthBtnClass.includes('shadow-2xs'), "Month view mode active");

    // Switch to Agenda
    await page.click('[data-testid="view-agenda-btn"]');
    await sleep(400);
    const agendaBtnClass = await page.$eval('[data-testid="view-agenda-btn"]', el => el.className);
    assert(agendaBtnClass.includes('shadow-2xs'), "Agenda view mode active");

    // Switch back to Week
    await page.click('[data-testid="view-week-btn"]');
    await sleep(400);
    const weekBtnClass = await page.$eval('[data-testid="view-week-btn"]', el => el.className);
    assert(weekBtnClass.includes('shadow-2xs'), "Week view mode active");

    const switchingScreenshot = path.join(artifactsDir, 'calendar_view_switching.png');
    await page.screenshot({ path: switchingScreenshot });
    console.log(`  Saved screenshot: ${switchingScreenshot}`);

    // =========================================================================
    // STEP 4: Create a Calendar Event
    // =========================================================================
    console.log("\n--- [STEP 4] Create an Event with zero-knowledge envelope ---");
    await page.click('[data-testid="calendar-new-event-btn"]');
    await page.waitForSelector('[data-testid="event-modal"]', { timeout: 5000 });
    await sleep(300);

    await page.type('[data-testid="event-title-input"]', 'BYOS Architecture Review');
    await page.type('[data-testid="event-location-input"]', 'Security Lab 3A');
    await page.type('[data-testid="event-description-input"]', 'Discussion on zero-knowledge encryption guarantees.');

    // Save event
    await page.click('[data-testid="save-event-btn"]');
    await sleep(1500);

    // Verify modal closed
    const modalClosed = await page.$('[data-testid="event-modal"]');
    assert(modalClosed === null, "Event modal closed on save");

    const createdScreenshot = path.join(artifactsDir, 'calendar_event_created.png');
    await page.screenshot({ path: createdScreenshot });
    console.log(`  Saved screenshot: ${createdScreenshot}`);

    // =========================================================================
    // STEP 5: Create a second personal calendar
    // =========================================================================
    console.log("\n--- [STEP 5] Create a Second Calendar ('Engineering') ---");
    await page.click('[data-testid="add-calendar-btn"]');
    await page.waitForSelector('[data-testid="calendar-modal"]', { timeout: 5000 });
    await sleep(300);

    await page.type('[data-testid="calendar-name-input"]', 'Engineering Projects');
    await page.click('[data-testid="save-calendar-btn"]');
    await sleep(1000);

    const multipleCalendarsScreenshot = path.join(artifactsDir, 'calendar_multiple_calendars.png');
    await page.screenshot({ path: multipleCalendarsScreenshot });
    console.log(`  Saved screenshot: ${multipleCalendarsScreenshot}`);

    // =========================================================================
    // STEP 6: Responsive Mobile Viewport (375px)
    // =========================================================================
    console.log("\n--- [STEP 6] Responsive Mobile Viewport (375px) ---");
    await page.setViewport({ width: 375, height: 667 });
    await sleep(500);

    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    assert(!hasHorizontalOverflow, "No horizontal scrolling on 375px mobile viewport");

    const mobileScreenshot = path.join(artifactsDir, 'calendar_mobile_375px.png');
    await page.screenshot({ path: mobileScreenshot });
    console.log(`  Saved screenshot: ${mobileScreenshot}`);

    // =========================================================================
    // STEP 7: Return to Mail
    // =========================================================================
    console.log("\n--- [STEP 7] Return to Mail Module ---");
    await page.setViewport({ width: 1280, height: 800 });
    await sleep(500);

    await page.waitForSelector('[data-testid="back-to-mail-btn"]', { timeout: 5000 });
    await page.click('[data-testid="back-to-mail-btn"]');
    await sleep(1000);

    const messageListExists = await page.$('[data-testid="main-content"]');
    assert(messageListExists !== null, "Successfully returned to Mail view");

    const returnScreenshot = path.join(artifactsDir, 'calendar_return_to_mail.png');
    await page.screenshot({ path: returnScreenshot });
    console.log(`  Saved screenshot: ${returnScreenshot}`);

    // =========================================================================
    // STEP 8: DevTools State Capture
    // =========================================================================
    console.log("\n--- [STEP 8] DevTools Network & Storage State Dump ---");
    const storageDump = await page.evaluate(() => {
      const ls = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        ls[k] = localStorage.getItem(k);
      }
      const ss = {};
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        ss[k] = sessionStorage.getItem(k);
      }
      return { localStorage: ls, sessionStorage: ss };
    });

    console.log("DevTools Storage Dump:");
    console.log("  localStorage keys:", Object.keys(storageDump.localStorage));
    console.log("  sessionStorage keys:", Object.keys(storageDump.sessionStorage));

    console.log(`Captured ${networkRequests.length} calendar network requests.`);
    for (const req of networkRequests.slice(-4)) {
      console.log(`  ${req.method} ${req.url}`);
    }

    assert(unhandledErrors.length === 0, `No console errors: ${unhandledErrors.join(", ")}`);
    console.log("\n================================================================================");
    console.log("           ALL BROWSER CALENDAR VERIFICATION CHECKS PASSED                      ");
    console.log("================================================================================\n");

  } finally {
    await browser.close();
  }
}

runCalendarBrowserTests().catch((err) => {
  console.error("FATAL BROWSER TEST ERROR:", err);
  process.exit(1);
});
