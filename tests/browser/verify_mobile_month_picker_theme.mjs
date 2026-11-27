/**
 * ============================================================================
 * Browser Verification: Mobile Calendar Month Date Picker Design Theme Alignment
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

async function runMobileMonthPickerThemeVerification() {
  console.log("================================================================================");
  console.log("   VERIFICATION: MOBILE CALENDAR MONTH DATE PICKER DESIGN THEME ALIGNMENT       ");
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

    // ── STEP 3: Switch to Month View via Mobile Drawer ──
    console.log("\n--- [STEP 3] Switch to Month Split View via Drawer ---");
    await page.waitForSelector('[data-testid="calendar-sidebar-toggle-btn"]', { timeout: 10000 });
    await page.click('[data-testid="calendar-sidebar-toggle-btn"]');
    await sleep(600);

    await page.waitForSelector('[data-testid="drawer-view-month"]', { timeout: 10000 });
    await page.click('[data-testid="drawer-view-month"]');
    await sleep(1000);

    await page.waitForSelector('[data-testid="mobile-month-split-view"]', { timeout: 10000 });
    console.log("  MobileMonthSplitView mounted.");

    // ── STEP 4: Audit Date Picker Cells for Design Theme Conformance ──
    console.log("\n--- [STEP 4] Conformance Audit of Date Picker Cells ---");
    const cellAudit = await page.evaluate(() => {
      const cells = Array.from(document.querySelectorAll('[data-testid="month-cell"]'));
      const selectedCell = cells.find(c => c.getAttribute('aria-selected') === 'true');
      
      if (!selectedCell) {
        return { error: "No selected cell found", cellCount: cells.length };
      }

      const buttonComputed = window.getComputedStyle(selectedCell);
      const badge = selectedCell.querySelector('span');
      const badgeComputed = badge ? window.getComputedStyle(badge) : null;
      const dots = Array.from(selectedCell.querySelectorAll('div > span'));

      // Check if button has the forbidden solid charcoal background
      // #3C3D3E in rgb is rgb(60, 61, 62)
      const isCharcoal = buttonComputed.backgroundColor.includes('60, 61, 62');
      // Mocha Mousse #9E725F in rgb is rgb(158, 114, 95)
      const isMochaBadge = badgeComputed ? badgeComputed.backgroundColor.includes('158, 114, 95') : false;
      const borderRadiusVal = parseFloat(badgeComputed?.borderRadius || '0');
      const isBadgeCircle = borderRadiusVal >= 12 || badgeComputed?.borderRadius.includes('50%') || badgeComputed?.borderRadius.includes('9999px');

      return {
        cellCount: cells.length,
        selectedDayText: badge ? badge.textContent.trim() : "",
        buttonBgColor: buttonComputed.backgroundColor,
        hasCharcoalBox: isCharcoal,
        badgeBgColor: badgeComputed ? badgeComputed.backgroundColor : "",
        badgeTextColor: badgeComputed ? badgeComputed.color : "",
        borderRadius: badgeComputed ? badgeComputed.borderRadius : "",
        isMochaBadge,
        isBadgeCircle,
        dotCount: dots.length,
      };
    });

    console.log("  Selected Date Cell Audit:", cellAudit);
    assert(cellAudit.cellCount === 42, "Grid has 42 cells (7x6 full month layout)");
    assert(!cellAudit.hasCharcoalBox, "Selected date is NOT a heavy solid charcoal box (#3C3D3E)");
    assert(cellAudit.isMochaBadge, "Selected date number badge uses Mocha Mousse (#9E725F / rgb(158, 114, 95))");
    assert(cellAudit.isBadgeCircle, "Selected date number badge has circular geometry (rounded-full)");

    const initialScreenshot = path.resolve(artifactsDir, 'mobile_month_date_picker_theme_verified.png');
    await page.screenshot({ path: initialScreenshot });
    console.log(`  Saved screenshot: ${initialScreenshot}`);

    // ── STEP 5: Click Another Day and Verify Theme Updates Consistently ──
    console.log("\n--- [STEP 5] Select Another Date and Assert Style Updates ---");
    const monthCells = await page.$$('[data-testid="month-cell"]');
    if (monthCells[20]) {
      await monthCells[20].click();
      await sleep(400);

      const updateAudit = await page.evaluate(() => {
        const cells = Array.from(document.querySelectorAll('[data-testid="month-cell"]'));
        const selectedCell = cells.find(c => c.getAttribute('aria-selected') === 'true');
        const badge = selectedCell?.querySelector('span');
        const badgeComputed = badge ? window.getComputedStyle(badge) : null;
        const brVal = parseFloat(badgeComputed?.borderRadius || '0');
        return {
          dayNum: badge ? badge.textContent.trim() : "",
          isMocha: badgeComputed?.backgroundColor.includes('158, 114, 95'),
          isCircle: brVal >= 12 || badgeComputed?.borderRadius.includes('50%') || badgeComputed?.borderRadius.includes('9999px'),
        };
      });

      console.log("  New selected day audit:", updateAudit);
      assert(updateAudit.isMocha, "Newly selected date correctly inherits Mocha Mousse badge");
      assert(updateAudit.isCircle, "Newly selected date badge maintains circular geometry");
    }

    const nextScreenshot = path.resolve(artifactsDir, 'mobile_month_date_picker_selected_day.png');
    await page.screenshot({ path: nextScreenshot });
    console.log(`  Saved screenshot: ${nextScreenshot}`);

    // ── STEP 6: DevTools Network, Storage, Console Summary ──
    console.log("\n--- [STEP 6] DevTools State Audit ---");
    console.log(`  Captured ${networkRequests.length} API network requests.`);
    console.log(`  Unhandled console errors: ${unhandledErrors.length}`);
    assert(unhandledErrors.length === 0, "Zero unhandled console errors during test");

    console.log("\n================================================================================");
    console.log("  ALL CHECKS PASSED: MOBILE MONTH DATE PICKER ALIGNED WITH BRAND DESIGN THEME   ");
    console.log("================================================================================\n");

  } finally {
    await browser.close();
  }
}

runMobileMonthPickerThemeVerification().catch((err) => {
  console.error("FATAL ERROR in browser verification:", err);
  process.exit(1);
});
