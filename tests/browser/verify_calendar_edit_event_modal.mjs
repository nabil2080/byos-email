import puppeteer from '../../apps/webmail/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const ARTIFACTS_DIR = path.resolve(__dirname, 'artifacts');

if (!fs.existsSync(ARTIFACTS_DIR)) {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
}

function assert(condition, message) {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  PASS: ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  console.log("================================================================================");
  console.log("   BYOS CALENDAR: EDIT EVENT MODAL & PROFESSIONAL ICONS AUDIT                  ");
  console.log("================================================================================\n");

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ['--no-sandbox', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    page.on('pageerror', (err) => {
      console.error(`  [PAGE ERROR]: ${err.message}`);
    });

    // Step 1: Login
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
    console.log("  Authenticated successfully as Alice");

    // Step 2: Switch to Calendar View
    console.log("\n--- [STEP 2] Switch to Calendar View ---");
    await page.waitForSelector('[data-testid="nav-calendar-tab"]', { timeout: 5000 });
    await page.click('[data-testid="nav-calendar-tab"]');
    await page.waitForSelector('[data-testid="calendar-view"]', { timeout: 10000 });
    await sleep(800);

    // Step 3: Create a Working Location event to edit
    console.log("\n--- [STEP 3] Create a Working Location Event to Edit ---");
    const newBtn = await page.waitForSelector('[data-testid="calendar-new-event-btn"]', { timeout: 8000 });
    await newBtn.click();
    await page.waitForSelector('[data-testid="event-modal"]', { timeout: 8000 });

    const locTab = await page.waitForSelector('[data-testid="event-type-tab-location"]', { timeout: 5000 });
    await locTab.click();
    await sleep(300);

    const testTitle = `Office Working Location ${Date.now()}`;
    await page.type('[data-testid="event-title-input"]', testTitle);
    await page.select('[data-testid="working-location-select"]', 'office');

    const saveBtn = await page.waitForSelector('[data-testid="save-event-btn"]', { timeout: 5000 });
    await saveBtn.click();
    await sleep(1500);

    // Step 4: Click the created event to open the EDIT EVENT modal
    console.log("\n--- [STEP 4] Click Event to Open 'Edit Event' Modal ---");
    // Find an event button/pill on the calendar
    const eventPill = await page.waitForSelector('[data-testid="calendar-event-item"], [data-testid="calendar-timed-event"], [data-testid="calendar-allday-event"], [data-testid="working-location-badge"]', { timeout: 8000 });
    await eventPill.click();
    await sleep(800);

    await page.waitForSelector('[data-testid="event-modal"]', { timeout: 5000 });
    const modalTitle = await page.$eval('[data-testid="event-modal"] h3', (el) => el.textContent.trim());
    console.log(`  Modal title: "${modalTitle}"`);
    assert(modalTitle === "Edit Event", "Modal title must be 'Edit Event'");

    // Step 5: Audit Event Type Tabs in Edit Event Modal
    console.log("\n--- [STEP 5] Audit Event Type Tabs and Layout in Edit Event Modal ---");
    const tabsBox = await page.$eval('[data-testid="event-type-tabs"]', (el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return {
        width: rect.width,
        height: rect.height,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        hasHorizontalOverflow: el.scrollWidth > el.clientWidth + 1,
        overflowX: style.overflowX,
        display: style.display,
      };
    });
    console.log("  Event Type Tabs Metrics:", JSON.stringify(tabsBox));
    assert(!tabsBox.hasHorizontalOverflow, "Tabs must not have horizontal overflow causing scrollbars");
    assert(tabsBox.height >= 36, "Tabs height must not be squished or clipped (height >= 36px)");

    // Step 6: Audit Professional SVG Icons vs Emojis
    console.log("\n--- [STEP 6] Audit Professional SVG Icons (Zero Emojis) ---");
    const emojiRegex = /[\uD83C-\uDBFF\uDC00-\uDFFF]|[\u2600-\u27BF]/;
    const modalText = await page.$eval('[data-testid="event-modal"]', (el) => el.innerText);
    const hasEmoji = emojiRegex.test(modalText);
    console.log(`  Modal contains emoji characters: ${hasEmoji}`);
    assert(!hasEmoji, "Edit Event modal must NOT contain any emoji characters");

    // Check SVG icons exist on all tabs
    const svgCount = await page.$$eval('[data-testid="event-type-tabs"] svg', (els) => els.length);
    console.log(`  SVG stroke icons rendered in event type tabs: ${svgCount}`);
    assert(svgCount === 4, "All 4 event type tabs must have professional SVG stroke icons");

    // Step 7: Take Desktop Screenshot
    const desktopScreenshotPath = path.join(ARTIFACTS_DIR, 'calendar_edit_event_clean_desktop.png');
    await page.screenshot({ path: desktopScreenshotPath });
    console.log(`  Saved screenshot: ${desktopScreenshotPath}`);

    // Step 8: Test 375px Mobile Viewport
    console.log("\n--- [STEP 8] Test 375px Mobile Viewport ---");
    await page.setViewport({ width: 375, height: 667 });
    await sleep(500);

    const mobileMetrics = await page.evaluate(() => {
      const doc = document.documentElement;
      const modal = document.querySelector('[data-testid="event-modal"]');
      const tabs = document.querySelector('[data-testid="event-type-tabs"]');
      return {
        docScrollWidth: doc.scrollWidth,
        docClientWidth: doc.clientWidth,
        hasDocOverflow: doc.scrollWidth > doc.clientWidth,
        tabsHeight: tabs ? tabs.getBoundingClientRect().height : 0,
        tabsScrollWidth: tabs ? tabs.scrollWidth : 0,
        tabsClientWidth: tabs ? tabs.clientWidth : 0,
      };
    });
    console.log("  Mobile 375px Metrics:", JSON.stringify(mobileMetrics));
    assert(!mobileMetrics.hasDocOverflow, "Zero horizontal document overflow on 375px mobile viewport");
    assert(mobileMetrics.tabsHeight >= 60, "On mobile, 2x2 grid tabs render with generous height");

    const mobileScreenshotPath = path.join(ARTIFACTS_DIR, 'calendar_edit_event_clean_mobile.png');
    await page.screenshot({ path: mobileScreenshotPath });
    console.log(`  Saved screenshot: ${mobileScreenshotPath}`);

    console.log("\n================================================================================");
    console.log("   ALL EDIT EVENT MODAL & PROFESSIONAL ICON AUDITS PASSED                      ");
    console.log("================================================================================\n");
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error("AUDIT FAILED:", err);
  process.exit(1);
});
