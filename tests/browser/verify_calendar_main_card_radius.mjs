/**
 * ============================================================================
 * Browser Verification: Calendar Main Section Radius & Consistency with Mail/Notes
 * ============================================================================
 */

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

async function runCardRadiusVerification() {
  console.log("================================================================================");
  console.log("    VERIFICATION: CALENDAR MAIN SECTION RADIUS CONFORMANCE ON MOBILE           ");
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
    // 375px x 667px (iPhone SE viewport)
    await page.setViewport({ width: 375, height: 667, isMobile: true, hasTouch: true });

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
      if (req.url().includes('/v1/mailboxes') || req.url().includes('/v1/calendar')) {
        networkRequests.push({
          method: req.method(),
          url: req.url(),
        });
      }
    });

    // ── STEP 1: Real login flow as Alice ──
    console.log("--- [STEP 1] Real login flow on 375px mobile viewport ---");
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
    console.log("  Successfully logged in as Alice on mobile.");

    // ── STEP 2: Audit Mail Module Main Section Card Radius ──
    console.log("\n--- [STEP 2] Audit Mail Main Section Card Radius ---");
    const mailCardAudit = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="main-content"] .rounded-2xl');
      if (!card) return null;
      const comp = window.getComputedStyle(card);
      return {
        className: card.className,
        borderRadius: comp.borderRadius,
        borderWidth: comp.borderWidth,
        borderStyle: comp.borderStyle,
        borderColor: comp.borderColor,
      };
    });
    console.log("  Mail Main Card:", mailCardAudit);
    assert(mailCardAudit !== null, "Mail main card exists");
    assert(mailCardAudit.borderRadius === "16px", "Mail main card has 16px radius (rounded-2xl)");
    assert(mailCardAudit.borderWidth === "1px", "Mail main card has 1px border");

    // ── STEP 3: Audit Notes Module Main Section Card Radius ──
    console.log("\n--- [STEP 3] Audit Notes Main Section Card Radius ---");
    await page.waitForSelector('[data-testid="bottom-nav-notes-tab"]', { timeout: 10000 });
    await page.click('[data-testid="bottom-nav-notes-tab"]');
    await sleep(1200);

    const notesCardAudit = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="notes-view"] .rounded-2xl');
      if (!card) return null;
      const comp = window.getComputedStyle(card);
      return {
        className: card.className,
        borderRadius: comp.borderRadius,
        borderWidth: comp.borderWidth,
        borderStyle: comp.borderStyle,
        borderColor: comp.borderColor,
      };
    });
    console.log("  Notes Main Card:", notesCardAudit);
    assert(notesCardAudit !== null, "Notes main card exists");
    assert(notesCardAudit.borderRadius === "16px", "Notes main card has 16px radius (rounded-2xl)");
    assert(notesCardAudit.borderWidth === "1px", "Notes main card has 1px border");

    // ── STEP 4: Audit Calendar Module Main Section Card Radius ──
    console.log("\n--- [STEP 4] Audit Calendar Main Section Card Radius on Mobile ---");
    await page.waitForSelector('[data-testid="bottom-nav-calendar-tab"]', { timeout: 10000 });
    await page.click('[data-testid="bottom-nav-calendar-tab"]');
    await sleep(1500);

    const calendarCardAudit = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="calendar-view"] .flex-1.rounded-2xl');
      if (!card) return null;
      const comp = window.getComputedStyle(card);
      return {
        className: card.className,
        borderRadius: comp.borderRadius,
        borderWidth: comp.borderWidth,
        borderStyle: comp.borderStyle,
        borderColor: comp.borderColor,
      };
    });
    console.log("  Calendar Main Card:", calendarCardAudit);
    assert(calendarCardAudit !== null, "Calendar main card exists with rounded-2xl");
    assert(calendarCardAudit.borderRadius === "16px", "Calendar main card has 16px radius (rounded-2xl) on mobile");
    assert(calendarCardAudit.borderWidth === "1px", "Calendar main card has 1px border on mobile");

    // Parity assertion
    assert(
      calendarCardAudit.borderRadius === mailCardAudit.borderRadius &&
      calendarCardAudit.borderRadius === notesCardAudit.borderRadius,
      "Calendar card border radius exactly matches Mail and Notes (16px / rounded-2xl)"
    );
    assert(
      calendarCardAudit.borderColor === mailCardAudit.borderColor &&
      calendarCardAudit.borderColor === notesCardAudit.borderColor,
      "Calendar card border color exactly matches Mail and Notes (#E2DFD8)"
    );

    // Save screenshots
    const calScreenshot = path.resolve(artifactsDir, 'calendar_main_card_radius_mobile.png');
    await page.screenshot({ path: calScreenshot });
    console.log(`  Saved screenshot: ${calScreenshot}`);

    // Switch to Month view and capture screenshot as well
    console.log("\n--- [STEP 5] Capture Month View with Main Card Radius ---");
    await page.click('[data-testid="calendar-sidebar-toggle-btn"]');
    await sleep(600);
    await page.click('[data-testid="drawer-view-month"]');
    await sleep(1000);

    const monthViewScreenshot = path.resolve(artifactsDir, 'calendar_month_view_card_radius_mobile.png');
    await page.screenshot({ path: monthViewScreenshot });
    console.log(`  Saved screenshot: ${monthViewScreenshot}`);

    // ── STEP 6: DevTools State Summary ──
    console.log("\n--- [STEP 6] DevTools State Audit ---");
    console.log(`  Captured ${networkRequests.length} API network requests.`);
    console.log(`  Unhandled console errors: ${unhandledErrors.length}`);
    assert(unhandledErrors.length === 0, "Zero unhandled console errors during test");

    console.log("\n================================================================================");
    console.log("   ALL CHECKS PASSED: CALENDAR RADIUS FULLY CONFORMANT WITH MAIL & NOTES       ");
    console.log("================================================================================\n");

  } finally {
    await browser.close();
  }
}

runCardRadiusVerification().catch((err) => {
  console.error("FATAL ERROR in browser verification:", err);
  process.exit(1);
});
