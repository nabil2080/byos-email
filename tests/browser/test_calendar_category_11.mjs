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

async function runCalendarCategory11BrowserTest() {
  console.log("================================================================================");
  console.log("   BYOS CALENDAR: CATEGORY 11 END-TO-END BROWSER VERIFICATION                  ");
  console.log("   (Tasks and Personal Productivity: Lists, Quick-Add, Modal, Grid & Reminders) ");
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

    // Step 4: Toggle Tasks Sidebar Panel
    console.log("\n--- [STEP 4] Toggle Tasks Sidebar Panel ---");
    await page.waitForSelector('[data-testid="toggle-tasks-sidebar-btn"]', { timeout: 8000 });
    await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="toggle-tasks-sidebar-btn"]');
      if (btn) btn.click();
    });
    await page.waitForSelector('[data-testid="tasks-sidebar-panel"]', { timeout: 8000 });
    console.log("  Tasks sidebar panel opened successfully");
    assert(true, "Tasks sidebar panel rendered");

    // Step 5: Quick-Add Task in Tasks Panel
    console.log("\n--- [STEP 5] Quick Add Task in Tasks Sidebar ---");
    const quickInput = await page.waitForSelector('[data-testid="quick-add-task-input"]', { timeout: 5000 });
    await quickInput.focus();
    await page.keyboard.type("Audit KMS Encryption Keys");
    await sleep(300);

    const btnDisabled = await page.$eval('[data-testid="quick-add-task-btn"]', (btn) => btn.disabled);
    console.log(`  Quick-add button disabled: ${btnDisabled}`);

    await page.evaluate(() => {
      const form = document.querySelector('form:has([data-testid="quick-add-task-btn"])');
      if (form) {
        form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      } else {
        const btn = document.querySelector('[data-testid="quick-add-task-btn"]');
        if (btn) btn.click();
      }
    });
    await sleep(800);

    const taskRows = await page.$$eval('[data-testid="task-item-row"]', (rows) =>
      rows.map((r) => r.textContent)
    );
    console.log(`  Task items in sidebar: ${taskRows.length} item(s)`);
    assert(
      taskRows.some((text) => text.includes("Audit KMS Encryption Keys")),
      "Quick-add task 'Audit KMS Encryption Keys' rendered in sidebar"
    );

    // Step 6: Create New Task List
    console.log("\n--- [STEP 6] Create Custom Task List ---");
    await page.waitForSelector('[data-testid="add-task-list-btn"]', { timeout: 5000 });
    await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="add-task-list-btn"]');
      if (btn) btn.click();
    });
    await page.waitForSelector('[data-testid="new-list-name-input"]', { timeout: 5000 });
    await page.focus('[data-testid="new-list-name-input"]');
    await page.keyboard.type("Security Milestones");
    await sleep(300);

    await page.evaluate(() => {
      const form = document.querySelector('form:has([data-testid="save-new-list-btn"])');
      if (form) {
        form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      } else {
        const btn = document.querySelector('[data-testid="save-new-list-btn"]');
        if (btn) btn.click();
      }
    });
    await sleep(600);

    const listOptions = await page.$$eval('[data-testid="active-task-list-select"] option', (opts) =>
      opts.map((o) => o.textContent.trim())
    );
    console.log(`  Available task lists: [${listOptions.join(", ")}]`);
    assert(
      listOptions.includes("Security Milestones"),
      "Custom task list 'Security Milestones' created and present in select"
    );

    // Step 7: Open Detailed Task Modal & Save Calendar Task
    console.log("\n--- [STEP 7] Open Detailed Task Modal & Create Calendar-Bound Task ---");
    await page.waitForSelector('[data-testid="open-task-modal-btn"]', { timeout: 5000 });
    await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="open-task-modal-btn"]');
      if (btn) btn.click();
    });
    await page.waitForSelector('[data-testid="task-modal"]', { timeout: 5000 });
    console.log("  Task modal opened");

    const todayStr = new Date().toISOString().slice(0, 10);
    await page.focus('[data-testid="task-title-input"]');
    await page.keyboard.type("Review Hardware Security Module Firmware");
    await sleep(200);

    await page.evaluate((d) => {
      const el = document.querySelector('[data-testid="task-due-date-input"]');
      if (el) {
        el.value = d;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const p = document.querySelector('[data-testid="task-priority-select"]');
      if (p) {
        p.value = 'high';
        p.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, todayStr);

    await page.focus('[data-testid="task-description-input"]');
    await page.keyboard.type("Verify cryptographic enclave signatures and zero-trust assertions");
    await sleep(300);

    await page.evaluate(() => {
      const form = document.querySelector('form:has([data-testid="save-task-btn"])');
      if (form) {
        form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      } else {
        const btn = document.querySelector('[data-testid="save-task-btn"]');
        if (btn) btn.click();
      }
    });
    await sleep(800);

    // Verify task modal closed
    const modalStillPresent = await page.$('[data-testid="task-modal"]');
    assert(modalStillPresent === null, "Task modal closed after saving");

    // Step 8: Verify Task Overlay in Calendar Grid
    console.log("\n--- [STEP 8] Verify Task Overlay on Calendar Grid ---");
    // Ensure week view to clearly inspect tasks row
    await page.evaluate(() => {
      const weekBtn = document.querySelector('[data-testid="view-week-btn"]');
      if (weekBtn) weekBtn.click();
    });
    await sleep(600);

    await page.waitForSelector('[data-testid="calendar-task-item"]', { timeout: 8000 });
    const calendarTaskTitles = await page.$$eval('[data-testid="calendar-task-item"]', (items) =>
      items.map((i) => i.textContent)
    );
    console.log(`  Calendar task overlay items: [${calendarTaskTitles.map((t) => t.trim()).join("; ")}]`);
    assert(
      calendarTaskTitles.some((t) => t.includes("Review Hardware Security Module")),
      "Task item appears on Calendar Grid overlay"
    );

    // Step 9: Complete and Reopen Task Lifecycle
    console.log("\n--- [STEP 9] Complete and Reopen Task Lifecycle ---");
    await page.waitForSelector('[data-testid="calendar-task-checkbox"]', { timeout: 5000 });
    await page.evaluate(() => {
      const cb = document.querySelector('[data-testid="calendar-task-checkbox"]');
      if (cb) cb.click();
    });
    await sleep(600);

    // Check if task is crossed out or styled as completed
    const taskCompletedClass = await page.$eval('[data-testid="calendar-task-item"]', (el) => el.className);
    console.log(`  Task element class after complete click: "${taskCompletedClass}"`);
    assert(
      taskCompletedClass.includes("line-through") || taskCompletedClass.includes("opacity-60"),
      "Completed task displays strike-through or opacity reduction"
    );

    // Click again to reopen
    await page.evaluate(() => {
      const cb = document.querySelector('[data-testid="calendar-task-checkbox"]');
      if (cb) cb.click();
    });
    await sleep(600);
    const taskReopenedClass = await page.$eval('[data-testid="calendar-task-item"]', (el) => el.className);
    console.log(`  Task element class after reopen click: "${taskReopenedClass}"`);
    assert(
      !taskReopenedClass.includes("line-through"),
      "Reopened task clears completed styling"
    );

    // Step 10: Overdue Task Indicator Verification
    console.log("\n--- [STEP 10] Overdue Task Indicator Verification ---");
    // Add an overdue task (due 3 days ago)
    const yesterdayDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="open-task-modal-btn"]');
      if (btn) btn.click();
    });
    await page.waitForSelector('[data-testid="task-modal"]', { timeout: 5000 });
    await page.focus('[data-testid="task-title-input"]');
    await page.keyboard.type("Overdue Certificate Rotation");
    await page.evaluate((d) => {
      const el = document.querySelector('[data-testid="task-due-date-input"]');
      if (el) {
        el.value = d;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, yesterdayDate);

    await page.evaluate(() => {
      const form = document.querySelector('form:has([data-testid="save-task-btn"])');
      if (form) {
        form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      } else {
        const btn = document.querySelector('[data-testid="save-task-btn"]');
        if (btn) btn.click();
      }
    });
    await sleep(800);

    // Check sidebar overdue badge
    await page.waitForSelector('[data-testid="sidebar-overdue-count"]', { timeout: 5000 });
    const overdueCountText = await page.$eval('[data-testid="sidebar-overdue-count"]', (el) => el.textContent.trim());
    console.log(`  Sidebar overdue badge text: "${overdueCountText}"`);
    assert(overdueCountText.includes("overdue"), "Overdue badge displayed in sidebar panel");

    // Take Desktop Screenshot
    const desktopScreenshotPath = path.resolve(artifactsDir, 'calendar_category_11_desktop.png');
    await page.screenshot({ path: desktopScreenshotPath });
    console.log(`  Desktop screenshot saved: ${desktopScreenshotPath}`);

    // Step 11: 375px Mobile Viewport & Responsiveness
    console.log("\n--- [STEP 11] 375px Mobile Viewport Verification ---");
    await page.setViewport({ width: 375, height: 667 });
    await sleep(600);

    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    console.log(`  375px horizontal overflow detected: ${hasHorizontalOverflow}`);
    assert(!hasHorizontalOverflow, "375px mobile viewport has zero horizontal scroll");

    const mobileScreenshotPath = path.resolve(artifactsDir, 'calendar_category_11_mobile.png');
    await page.screenshot({ path: mobileScreenshotPath });
    console.log(`  Mobile screenshot saved: ${mobileScreenshotPath}`);

    // Step 12: DevTools Storage & Console Verification
    console.log("\n--- [STEP 12] DevTools Storage & Console Verification ---");
    const storageDump = await page.evaluate(() => {
      const keys = Object.keys(localStorage);
      const taskKeys = keys.filter((k) => k.startsWith('byos_calendar_task'));
      const values = {};
      for (const k of taskKeys) {
        values[k] = localStorage.getItem(k);
      }
      return { keys, taskKeys, values };
    });

    console.log(`  All localStorage keys: [${storageDump.keys.join(', ')}]`);
    console.log(`  Task localStorage keys: [${storageDump.taskKeys.join(', ')}]`);
    assert(storageDump.taskKeys.length >= 2, "Task lists and items persisted in localStorage");

    console.log(`  Uncaught console errors: ${uncaughtErrors.length}`);
    if (uncaughtErrors.length > 0) {
      console.error("  Uncaught errors:", uncaughtErrors);
    }
    assert(uncaughtErrors.length === 0, "DevTools console has zero uncaught errors");

    console.log("\n================================================================================");
    console.log("   CATEGORY 11 BROWSER VERIFICATION: ALL 12 STEPS PASSED                       ");
    console.log("================================================================================\n");

  } finally {
    await browser.close();
  }
}

runCalendarCategory11BrowserTest().catch((err) => {
  console.error("\nFATAL ERROR IN CATEGORY 11 BROWSER TEST:", err);
  process.exit(1);
});
