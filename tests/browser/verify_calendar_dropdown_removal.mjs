/**
 * ============================================================================
 * Browser Verification: Mobile Calendar Month Dropdown Complete Removal
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

async function runDropdownRemovalVerification() {
  console.log("================================================================================");
  console.log("      VERIFICATION: MOBILE CALENDAR MONTH DROPDOWN COMPLETE REMOVAL             ");
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

    // ── STEP 2: Navigate to Calendar via Mobile Bottom Navigation Bar ──
    console.log("\n--- [STEP 2] Navigate to Calendar via Bottom Bar ---");
    await page.waitForSelector('[data-testid="bottom-nav-calendar-tab"]', { timeout: 10000 });
    await page.click('[data-testid="bottom-nav-calendar-tab"]');
    await sleep(1500);

    await page.waitForSelector('[data-testid="calendar-view"]', { timeout: 10000 });
    assert(true, "CalendarView mounted on mobile");

    // ── STEP 3: Verify Mobile Header & Assert Dropdown is Completely Removed ──
    console.log("\n--- [STEP 3] Assert Dropdown & Chevron Elements Are Completely Absent ---");
    await page.waitForSelector('[data-testid="mobile-calendar-header"]', { timeout: 5000 });

    const headerAudit = await page.evaluate(() => {
      const header = document.querySelector('[data-testid="mobile-calendar-header"]');
      if (!header) return { error: "Header not found" };

      const dropdown = document.querySelector('[data-testid="mobile-month-picker-dropdown"]');
      const backdrop = document.querySelector('[data-testid="mobile-month-picker-backdrop"]');
      const periodTitle = header.querySelector('[data-testid="calendar-period-title"]');
      const hamburger = header.querySelector('[data-testid="calendar-sidebar-toggle-btn"]');
      const searchToggle = header.querySelector('[data-testid="calendar-mobile-search-toggle-btn"]');
      const todayBtn = header.querySelector('[data-testid="calendar-today-btn"]');

      // Check for any chevron SVGs inside the period title
      const chevronsInsideTitle = periodTitle ? periodTitle.querySelectorAll('polyline, polygon, path') : [];

      return {
        hasDropdown: dropdown !== null,
        hasBackdrop: backdrop !== null,
        hasPeriodTitle: periodTitle !== null,
        periodTitleText: periodTitle ? periodTitle.textContent.trim() : "",
        hasHamburger: hamburger !== null,
        hasSearchToggle: searchToggle !== null,
        hasTodayBtn: todayBtn !== null,
        chevronCountInTitle: chevronsInsideTitle.length,
      };
    });

    console.log("  Header Audit Result:", headerAudit);
    assert(!headerAudit.hasDropdown, "Mini-month picker dropdown is ABSENT from DOM");
    assert(!headerAudit.hasBackdrop, "Mini-month picker backdrop is ABSENT from DOM");
    assert(headerAudit.hasPeriodTitle, "Period title is rendered cleanly in header");
    assert(headerAudit.chevronCountInTitle === 0, "No chevron icon exists in period title");
    assert(headerAudit.hasHamburger, "Hamburger navigation drawer button is present");
    assert(headerAudit.hasSearchToggle, "Search toggle button is present");
    assert(headerAudit.hasTodayBtn, "Dynamic today button is present");

    // ── STEP 4: Attempt to Click Period Title and Confirm No Dropdown Appears ──
    console.log("\n--- [STEP 4] Click Period Title and Confirm No Dropdown Opens ---");
    const titleEl = await page.$('[data-testid="calendar-period-title"]');
    assert(titleEl !== null, "Found calendar period title element");
    await titleEl.click();
    await sleep(500);

    const dropdownAfterClick = await page.$('[data-testid="mobile-month-picker-dropdown"]');
    assert(dropdownAfterClick === null, "Dropdown does NOT appear after tapping period title");

    const backdropAfterClick = await page.$('[data-testid="mobile-month-picker-backdrop"]');
    assert(backdropAfterClick === null, "Backdrop does NOT appear after tapping period title");

    // Capture screenshot at 375px
    const screenshot375 = path.resolve(artifactsDir, 'calendar_dropdown_removed_375px.png');
    await page.screenshot({ path: screenshot375 });
    console.log(`  Saved screenshot: ${screenshot375}`);

    // ── STEP 5: Verify Responsive Behavior Across Breakpoints (375px, 414px, 640px) ──
    console.log("\n--- [STEP 5] Multi-Breakpoint Verification ---");
    for (const width of [375, 414, 640]) {
      await page.setViewport({ width, height: 667, isMobile: true, hasTouch: true });
      await sleep(200);

      const audit = await page.evaluate(() => {
        const dd = document.querySelector('[data-testid="mobile-month-picker-dropdown"]');
        const overflow = document.documentElement.scrollWidth > window.innerWidth;
        return { hasDropdown: dd !== null, hasOverflow: overflow };
      });

      assert(!audit.hasDropdown, `Dropdown absent at ${width}px viewport`);
      assert(!audit.hasOverflow, `No horizontal overflow at ${width}px viewport`);
    }

    const screenshot414 = path.resolve(artifactsDir, 'calendar_header_clean_mobile.png');
    await page.screenshot({ path: screenshot414 });
    console.log(`  Saved screenshot: ${screenshot414}`);

    // ── STEP 6: DevTools State Dump ──
    console.log("\n--- [STEP 6] DevTools State Dump ---");
    const storageDump = await page.evaluate(() => {
      const lsKeys = Object.keys(localStorage);
      const ssKeys = Object.keys(sessionStorage);
      return {
        localStorageKeys: lsKeys,
        sessionStorageKeys: ssKeys,
      };
    });
    console.log("  Storage Keys:", JSON.stringify(storageDump, null, 2));

    console.log(`  Captured ${networkRequests.length} API network requests.`);
    console.log(`  Unhandled console errors: ${unhandledErrors.length}`);
    assert(unhandledErrors.length === 0, "Zero unhandled console errors during test");

    console.log("\n================================================================================");
    console.log("       ALL CHECKS PASSED: DROPDOWN REMOVAL FULLY VERIFIED IN BROWSER            ");
    console.log("================================================================================\n");

  } finally {
    await browser.close();
  }
}

runDropdownRemovalVerification().catch((err) => {
  console.error("FATAL ERROR in browser verification:", err);
  process.exit(1);
});
