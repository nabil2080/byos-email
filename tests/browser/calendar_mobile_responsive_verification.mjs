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

async function runMobileResponsiveVerification() {
  console.log("================================================================================");
  console.log("        GOOGLE CALENDAR MOBILE RESPONSIVE SUBSYSTEM BROWSER VERIFICATION        ");
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

    // ── STEP 3: Verify Zero Horizontal Scroll on 375px ──
    console.log("\n--- [STEP 3] Assert Zero Horizontal Overflow on 375px ---");
    const overflowMetrics = await page.evaluate(() => {
      return {
        docScrollWidth: document.documentElement.scrollWidth,
        docClientWidth: document.documentElement.clientWidth,
        bodyScrollWidth: document.body.scrollWidth,
        bodyClientWidth: document.body.clientWidth,
      };
    });
    console.log(`  Document scrollWidth: ${overflowMetrics.docScrollWidth}px, clientWidth: ${overflowMetrics.docClientWidth}px`);
    assert(overflowMetrics.docScrollWidth <= 375, "document.documentElement.scrollWidth <= 375px");
    assert(overflowMetrics.bodyScrollWidth <= 375, "document.body.scrollWidth <= 375px");

    // ── STEP 4: Google Calendar Mobile Top Header Verification ──
    console.log("\n--- [STEP 4] Google Calendar Mobile Top Header Verification ---");
    const mobileHeader = await page.$('[data-testid="mobile-calendar-header"]');
    assert(mobileHeader !== null, "MobileCalendarHeader is rendered");

    const hamburgerBtn = await page.$('[data-testid="calendar-sidebar-toggle-btn"]');
    assert(hamburgerBtn !== null, "Hamburger navigation drawer button exists");

    const monthDropdownBtn = await page.$('[data-testid="calendar-month-dropdown-btn"]');
    assert(monthDropdownBtn !== null, "Interactive Period Title with dropdown chevron exists");

    const todayBtn = await page.$('[data-testid="calendar-today-btn"]');
    assert(todayBtn !== null, "Dynamic Today date page icon exists");

    const searchToggleBtn = await page.$('[data-testid="calendar-mobile-search-toggle-btn"]');
    assert(searchToggleBtn !== null, "Search toggle button exists in mobile header");

    // ── STEP 5: Floating Action Button (FAB) Verification ──
    console.log("\n--- [STEP 5] Google Calendar FAB (+) Verification ---");
    const fabBtn = await page.$('[data-testid="mobile-calendar-fab"]');
    assert(fabBtn !== null, "MobileCalendarFab button is rendered");

    const fabBox = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="mobile-calendar-fab"]');
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return {
        bottom: window.innerHeight - rect.bottom,
        right: window.innerWidth - rect.right,
        width: rect.width,
        height: rect.height,
      };
    });
    console.log(`  FAB dimensions: ${fabBox?.width}x${fabBox?.height}px, bottom margin: ${fabBox?.bottom}px`);
    assert(fabBox !== null && fabBox.bottom >= 64, "FAB is floating safely above BottomFixedBar");

    // ── STEP 6: Schedule View (Google Calendar Default Mobile Feed) ──
    console.log("\n--- [STEP 6] Google Calendar Schedule View (Agenda) Verification ---");
    const agendaView = await page.$('[data-testid="calendar-agenda-view"]');
    assert(agendaView !== null, "Google Calendar Schedule (Agenda) view is active by default");

    const scheduleScreenshot = path.join(artifactsDir, 'calendar_mobile_375px_schedule.png');
    await page.screenshot({ path: scheduleScreenshot });
    console.log(`  Saved screenshot: ${scheduleScreenshot}`);

    // ── STEP 7: Collapsible Mini-Month Dropdown Picker ──
    console.log("\n--- [STEP 7] Collapsible Month Dropdown Verification ---");
    await page.click('[data-testid="calendar-month-dropdown-btn"]');
    await sleep(400);

    const monthDropdown = await page.$('[data-testid="mobile-month-picker-dropdown"]');
    assert(monthDropdown !== null, "Mini-month picker dropdown expands below header");

    const dropdownScreenshot = path.join(artifactsDir, 'calendar_mobile_375px_month_dropdown.png');
    await page.screenshot({ path: dropdownScreenshot });
    console.log(`  Saved screenshot: ${dropdownScreenshot}`);

    // Tap backdrop to dismiss
    await page.evaluate(() => {
      const backdrop = document.querySelector('[data-testid="mobile-month-picker-backdrop"]');
      if (backdrop) backdrop.click();
    });
    await sleep(300);
    const dropdownClosed = await page.$('[data-testid="mobile-month-picker-dropdown"]');
    assert(dropdownClosed === null, "Mini-month picker dropdown dismissed on backdrop tap");

    // ── STEP 8: Mobile Slide-Out Navigation Drawer Verification ──
    console.log("\n--- [STEP 8] Mobile Slide-Out Navigation Drawer Verification ---");
    await page.click('[data-testid="calendar-sidebar-toggle-btn"]');
    await sleep(500);

    const drawerSidebar = await page.$('[data-testid="calendar-sidebar"]');
    assert(drawerSidebar !== null, "Slide-out navigation drawer opened");

    const drawerAgendaBtn = await page.$('[data-testid="drawer-view-agenda"]');
    const drawerDayBtn = await page.$('[data-testid="drawer-view-day"]');
    const drawer3DaysBtn = await page.$('[data-testid="drawer-view-3days"]');
    const drawerWeekBtn = await page.$('[data-testid="drawer-view-week"]');
    const drawerMonthBtn = await page.$('[data-testid="drawer-view-month"]');

    assert(drawerAgendaBtn !== null, "Drawer contains Schedule View switcher");
    assert(drawerDayBtn !== null, "Drawer contains Day View switcher");
    assert(drawer3DaysBtn !== null, "Drawer contains 3 Days View switcher");
    assert(drawerWeekBtn !== null, "Drawer contains Week View switcher");
    assert(drawerMonthBtn !== null, "Drawer contains Month View switcher");

    // Verify R2: Feature UI Removal for Tasks (tasks toggle row removed from drawer)
    const tasksToggleRow = await page.$('[data-testid="calendar-tasks-toggle-row"]');
    assert(tasksToggleRow === null, "Drawer does not contain removed tasks toggle row (R2)");

    const drawerScreenshot = path.join(artifactsDir, 'calendar_mobile_375px_drawer.png');
    await page.screenshot({ path: drawerScreenshot });
    console.log(`  Saved screenshot: ${drawerScreenshot}`);

    // ── STEP 9: Split Month View Verification ──
    console.log("\n--- [STEP 9] Google Calendar Split Month View Verification ---");
    await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="drawer-view-month"]');
      if (btn) btn.click();
    });
    await sleep(800);

    const splitMonthView = await page.$('[data-testid="mobile-month-split-view"]');
    assert(splitMonthView !== null, "MobileMonthSplitView mounted cleanly on mobile");

    const monthCells = await page.$$('[data-testid="month-cell"]');
    assert(monthCells.length === 42, `Top half has authentic 7x6 month grid (${monthCells.length} cells)`);

    // Click on a date cell in top half to verify date selection updates
    if (monthCells[15]) {
      await monthCells[15].click();
      await sleep(300);
    }

    // Touch swipe gesture simulation on month grid to navigate month
    const titleBeforeSwipe = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="calendar-month-dropdown-btn"] span');
      return el ? el.textContent.trim() : "";
    });

    await page.evaluate(() => {
      const target = document.querySelector('[data-testid="mobile-month-split-view"] > div');
      if (!target) return;
      const startTouch = new Touch({ identifier: 1, target, clientX: 280, clientY: 150 });
      const endTouch = new Touch({ identifier: 1, target, clientX: 80, clientY: 150 });
      target.dispatchEvent(new TouchEvent('touchstart', { touches: [startTouch], changedTouches: [startTouch], bubbles: true }));
      target.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [endTouch], bubbles: true }));
    });
    await sleep(500);

    const titleAfterSwipe = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="calendar-month-dropdown-btn"] span');
      return el ? el.textContent.trim() : "";
    });
    console.log(`  Period title before swipe: "${titleBeforeSwipe}", after swipe: "${titleAfterSwipe}"`);
    assert(titleBeforeSwipe !== titleAfterSwipe, "Touch swipe left navigated to next month");

    const monthSplitOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= 375);
    assert(monthSplitOverflow, "Zero horizontal overflow in Mobile Split Month view");

    const monthSplitScreenshot = path.join(artifactsDir, 'calendar_mobile_375px_month_split.png');
    await page.screenshot({ path: monthSplitScreenshot });
    console.log(`  Saved screenshot: ${monthSplitScreenshot}`);

    // ── STEP 10: 3-Day View Verification ──
    console.log("\n--- [STEP 10] 3-Day View Verification ---");
    // Open drawer via sidebar toggle button (header avatar button removed per R4)
    await page.click('[data-testid="calendar-sidebar-toggle-btn"]');
    await sleep(400);
    await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="drawer-view-3days"]');
      if (btn) btn.click();
    });
    await sleep(500);

    const threeDayOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= 375);
    assert(threeDayOverflow, "Zero horizontal overflow in 3-Day view");

    const threeDayScreenshot = path.join(artifactsDir, 'calendar_mobile_375px_3days.png');
    await page.screenshot({ path: threeDayScreenshot });
    console.log(`  Saved screenshot: ${threeDayScreenshot}`);

    // ── STEP 11: Day View Verification ──
    console.log("\n--- [STEP 11] Day View Verification ---");
    await page.click('[data-testid="calendar-sidebar-toggle-btn"]');
    await sleep(400);
    await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="drawer-view-day"]');
      if (btn) btn.click();
    });
    await sleep(500);

    const dayOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= 375);
    assert(dayOverflow, "Zero horizontal overflow in Day view");

    const dayScreenshot = path.join(artifactsDir, 'calendar_mobile_375px_day.png');
    await page.screenshot({ path: dayScreenshot });
    console.log(`  Saved screenshot: ${dayScreenshot}`);

    // ── STEP 12: FAB Event Creation Sheet Verification ──
    console.log("\n--- [STEP 12] FAB Event Creation Sheet Verification ---");
    await page.click('[data-testid="mobile-calendar-fab"]');
    await sleep(600);

    const eventModal = await page.$('[data-testid="event-modal"]');
    assert(eventModal !== null, "EventModal opens as mobile bottom sheet on FAB tap");

    const fabModalScreenshot = path.join(artifactsDir, 'calendar_mobile_375px_fab_modal.png');
    await page.screenshot({ path: fabModalScreenshot });
    console.log(`  Saved screenshot: ${fabModalScreenshot}`);

    await page.type('[data-testid="event-title-input"]', 'Mobile Strategy Sync');
    await sleep(200);

    await page.click('[data-testid="save-event-btn"]');
    await sleep(1500);

    const eventModalAfterSave = await page.$('[data-testid="event-modal"]');
    assert(eventModalAfterSave === null, "Event saved and modal sheet dismissed");

    // ── STEP 13: DevTools State Dump ──
    console.log("\n--- [STEP 13] DevTools Network & Storage State Capture ---");
    const storageDump = await page.evaluate(() => {
      const ls = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        ls[k] = localStorage.getItem(k);
      }
      return { localStorageKeys: Object.keys(ls) };
    });
    console.log("  localStorage keys:", storageDump.localStorageKeys);
    console.log(`Captured ${networkRequests.length} calendar network requests.`);

    assert(unhandledErrors.length === 0, `No console errors: ${unhandledErrors.join(", ")}`);

    console.log("\n================================================================================");
    console.log("       ALL GOOGLE CALENDAR MOBILE RESPONSIVE VERIFICATIONS PASSED               ");
    console.log("================================================================================\n");

  } finally {
    await browser.close();
  }
}

runMobileResponsiveVerification().catch((err) => {
  console.error("FATAL MOBILE RESPONSIVE VERIFICATION ERROR:", err);
  process.exit(1);
});
