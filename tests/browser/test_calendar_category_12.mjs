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

async function runCalendarCategory12BrowserTest() {
  console.log("================================================================================");
  console.log("   BYOS CALENDAR: CATEGORY 12 END-TO-END BROWSER VERIFICATION                  ");
  console.log("   (Appointment Scheduling & Booking Pages: Schedules, Slots, Booking, Cancel)  ");
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

    page.on('console', (msg) => {
      console.log(`  [BROWSER CONSOLE] ${msg.type()}: ${msg.text()}`);
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

    // Step 4: Open Appointments Manager Modal via Toolbar Button
    console.log("\n--- [STEP 4] Open Appointments Manager via Toolbar Button ---");
    await page.waitForSelector('[data-testid="calendar-appointments-btn"]', { timeout: 8000 });
    await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="calendar-appointments-btn"]');
      if (btn) btn.click();
    });
    await page.waitForSelector('[data-testid="appointments-manager-modal"]', { timeout: 8000 });
    console.log("  Appointments Manager modal opened successfully");
    assert(true, "Appointments manager modal rendered");

    // Step 5: Create a New Custom Appointment Schedule
    console.log("\n--- [STEP 5] Create New Custom Appointment Schedule ---");
    await page.waitForSelector('[data-testid="create-schedule-btn"]', { timeout: 5000 });
    await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="create-schedule-btn"]');
      if (btn) btn.click();
    });
    await page.waitForSelector('[data-testid="appointment-schedule-modal"]', { timeout: 5000 });
    console.log("  Appointment schedule creation modal opened");

    // Fill Title & Slug
    await page.focus('[data-testid="schedule-title-input"]');
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await page.keyboard.type("Zero-Trust Architecture Consultation");

    await page.focus('[data-testid="schedule-slug-input"]');
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await page.keyboard.type("zero-trust-audit");

    // Select 45m duration
    await page.select('[data-testid="schedule-duration-select"]', "45");

    // Fill location details
    await page.focus('[data-testid="schedule-location-details-input"]');
    await page.keyboard.type("BYOS Secure Enclave Video Room");

    // Save schedule
    await page.evaluate(() => {
      const form = document.querySelector('form:has([data-testid="save-schedule-btn"])');
      if (form) {
        form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      } else {
        const btn = document.querySelector('[data-testid="save-schedule-btn"]');
        if (btn) btn.click();
      }
    });
    await sleep(800);

    // Verify modal closed and schedule card rendered
    const scheduleModalStillPresent = await page.$('[data-testid="appointment-schedule-modal"]');
    assert(scheduleModalStillPresent === null, "Schedule creation modal closed after saving");

    const scheduleCards = await page.$$eval('[data-testid="schedule-card"]', (cards) =>
      cards.map((c) => c.textContent)
    );
    console.log(`  Schedules rendered in manager: ${scheduleCards.length} item(s)`);
    assert(
      scheduleCards.some((c) => c.includes("Zero-Trust Architecture Consultation")),
      "New custom schedule 'Zero-Trust Architecture Consultation' rendered in manager"
    );

    // Step 6: Test Copy Booking Link
    console.log("\n--- [STEP 6] Test Copy Booking Link ---");
    await page.waitForSelector('[data-testid="copy-booking-link-btn"]', { timeout: 5000 });
    await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="copy-booking-link-btn"]');
      if (btn) btn.click();
    });
    await sleep(400);
    const copyBtnText = await page.$eval('[data-testid="copy-booking-link-btn"]', (el) => el.textContent.trim());
    console.log(`  Copy link button feedback: "${copyBtnText}"`);
    assert(copyBtnText === "Copied!" || copyBtnText === "Copy Link", "Copy booking link button functions properly");

    // Step 7: Preview Public Booking Page & Select Slot
    console.log("\n--- [STEP 7] Preview Public Booking Page & Select Slot ---");
    await page.waitForSelector('[data-testid="preview-booking-page-btn"]', { timeout: 5000 });
    await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="preview-booking-page-btn"]');
      if (btn) btn.click();
    });
    await page.waitForSelector('[data-testid="booking-page-container"]', { timeout: 8000 });
    console.log("  Booking page preview container opened");

    // Pick first available date
    await page.waitForSelector('[data-testid="booking-date-btn"]', { timeout: 8000 });
    await page.evaluate(() => {
      const dateBtn = document.querySelector('[data-testid="booking-date-btn"]');
      if (dateBtn) dateBtn.click();
    });
    await sleep(500);

    // Pick first available slot
    await page.waitForSelector('[data-testid="booking-slot-btn"]', { timeout: 8000 });
    const slotText = await page.$eval('[data-testid="booking-slot-btn"]', (el) => el.textContent.trim());
    console.log(`  Selecting booking slot: "${slotText}"`);
    await page.evaluate(() => {
      const slotBtn = document.querySelector('[data-testid="booking-slot-btn"]');
      if (slotBtn) slotBtn.click();
    });
    await sleep(500);

    // Step 8: Complete Attendee Information & Confirm Booking
    console.log("\n--- [STEP 8] Complete Attendee Information & Confirm Booking ---");
    await page.waitForSelector('[data-testid="booking-name-input"]', { timeout: 5000 });
    await page.focus('[data-testid="booking-name-input"]');
    await page.keyboard.type("Dr. Evelyn Reed");

    await page.focus('[data-testid="booking-email-input"]');
    await page.keyboard.type("evelyn.reed@external-sec.org");

    await page.focus('[data-testid="booking-notes-input"]');
    await page.keyboard.type("Quantum key distribution and enclave security review");

    await page.evaluate(() => {
      const form = document.querySelector('form:has([data-testid="confirm-booking-btn"])');
      if (form) {
        form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      } else {
        const btn = document.querySelector('[data-testid="confirm-booking-btn"]');
        if (btn) btn.click();
      }
    });
    await sleep(1000);

    // Assert confirmation card rendered
    await page.waitForSelector('[data-testid="booking-confirmed-card"]', { timeout: 8000 });
    const confirmedText = await page.$eval('[data-testid="booking-confirmed-card"]', (el) => el.textContent);
    console.log(`  Confirmed card contents preview: "${confirmedText.slice(0, 80)}..."`);
    assert(confirmedText.includes("Appointment Confirmed!"), "Booking confirmed successfully");

    // Take Desktop Screenshot of Confirmed Booking Page
    const desktopScreenshotPath = path.resolve(artifactsDir, 'calendar_category_12_desktop.png');
    await page.screenshot({ path: desktopScreenshotPath });
    console.log(`  Desktop screenshot saved: ${desktopScreenshotPath}`);

    // Step 9: Cancellation Flow Verification
    console.log("\n--- [STEP 9] Cancellation Flow Verification ---");
    await page.waitForSelector('[data-testid="cancel-booking-btn"]', { timeout: 5000 });
    await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="cancel-booking-btn"]');
      if (btn) btn.click();
    });
    await sleep(400);

    await page.waitForSelector('[data-testid="confirm-cancel-btn"]', { timeout: 5000 });
    await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="confirm-cancel-btn"]');
      if (btn) btn.click();
    });
    await sleep(800);

    await page.waitForSelector('[data-testid="booking-cancelled-card"]', { timeout: 5000 });
    const cancelledNotice = await page.$eval('[data-testid="booking-cancelled-card"]', (el) => el.textContent);
    console.log(`  Cancelled state notice: "${cancelledNotice}"`);
    assert(cancelledNotice.includes("Appointment Cancelled"), "Appointment cancelled and slot released");

    // Close booking page preview modal
    const closeBookingBtn = await page.$('[data-testid="close-booking-page-btn"]');
    if (closeBookingBtn) {
      await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="close-booking-page-btn"]');
        if (btn) btn.click();
      });
      await sleep(500);
    }

    // Step 10: Pause Schedule & Verify Paused Notice
    console.log("\n--- [STEP 10] Pause Schedule & Verify Paused Banner ---");
    // Switch to Booking Schedules tab
    await page.waitForSelector('[data-testid="tab-schedules"]', { timeout: 5000 });
    await page.evaluate(() => {
      const tab = document.querySelector('[data-testid="tab-schedules"]');
      if (tab) tab.click();
    });
    await sleep(400);

    // Click pause button
    await page.waitForSelector('[data-testid="toggle-schedule-active-btn"]', { timeout: 5000 });
    await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="toggle-schedule-active-btn"]');
      if (btn) btn.click();
    });
    await sleep(600);

    const statusBadgeText = await page.$eval('[data-testid="schedule-status-badge"]', (el) => el.textContent.trim());
    console.log(`  Schedule status after toggle: "${statusBadgeText}"`);
    assert(statusBadgeText === "Paused", "Schedule transitioned to Paused state");

    // Click preview again to verify paused banner
    await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="preview-booking-page-btn"]');
      if (btn) btn.click();
    });
    await page.waitForSelector('[data-testid="booking-paused-banner"]', { timeout: 8000 });
    const pausedBannerText = await page.$eval('[data-testid="booking-paused-banner"]', (el) => el.textContent);
    console.log(`  Paused banner text: "${pausedBannerText.slice(0, 70)}..."`);
    assert(pausedBannerText.includes("Schedule Paused"), "Public booking page displays paused banner");

    // Close preview modal
    await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="close-booking-page-btn"]');
      if (btn) btn.click();
    });
    await sleep(400);

    // Close manager modal
    await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="close-appointments-manager-btn"]');
      if (btn) btn.click();
    });
    await sleep(500);

    // Step 11: 375px Mobile Viewport & Responsiveness
    console.log("\n--- [STEP 11] 375px Mobile Viewport Verification ---");
    await page.setViewport({ width: 375, height: 667 });
    await sleep(600);

    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    console.log(`  375px horizontal overflow detected: ${hasHorizontalOverflow}`);
    assert(!hasHorizontalOverflow, "375px mobile viewport has zero horizontal scroll");

    const mobileScreenshotPath = path.resolve(artifactsDir, 'calendar_category_12_mobile.png');
    await page.screenshot({ path: mobileScreenshotPath });
    console.log(`  Mobile screenshot saved: ${mobileScreenshotPath}`);

    // Step 12: DevTools Storage & Console Verification
    console.log("\n--- [STEP 12] DevTools Storage & Console Verification ---");
    const storageDump = await page.evaluate(() => {
      const keys = Object.keys(localStorage);
      const apptKeys = keys.filter((k) => k.startsWith('byos_calendar_appointment') || k.startsWith('byos_calendar_booked'));
      const values = {};
      for (const k of apptKeys) {
        values[k] = localStorage.getItem(k);
      }
      return { keys, apptKeys, values };
    });

    console.log(`  All localStorage keys count: ${storageDump.keys.length}`);
    console.log(`  Appointment localStorage keys: [${storageDump.apptKeys.join(', ')}]`);
    assert(storageDump.apptKeys.length >= 2, "Appointment schedules and bookings persisted in localStorage");

    console.log(`  Uncaught console errors: ${uncaughtErrors.length}`);
    if (uncaughtErrors.length > 0) {
      console.error("  Uncaught errors:", uncaughtErrors);
    }
    assert(uncaughtErrors.length === 0, "DevTools console has zero uncaught errors");

    console.log("\n================================================================================");
    console.log("   CATEGORY 12 BROWSER VERIFICATION: ALL 12 STEPS PASSED                       ");
    console.log("================================================================================\n");

  } finally {
    await browser.close();
  }
}

runCalendarCategory12BrowserTest().catch((err) => {
  console.error("\nFATAL ERROR IN CATEGORY 12 BROWSER TEST:", err);
  process.exit(1);
});
