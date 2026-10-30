import puppeteer from "../../apps/webmail/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const artifactsDir = path.resolve(__dirname, "artifacts");

if (!fs.existsSync(artifactsDir)) {
  fs.mkdirSync(artifactsDir, { recursive: true });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function assert(condition, message) {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  PASS: ${message}`);
}

async function run() {
  console.log("================================================================================");
  console.log("   BYOS: SIDEBAR DESIGN & WIDTH CONSISTENCY, ACCOUNT SWITCHER, LABELS BUG FIX  ");
  console.log("================================================================================");

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--window-size=1280,800"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") pageErrors.push(msg.text());
  });

  try {
    console.log("\n--- [STEP 1] Login as alice@byos.local ---");
    await page.goto("http://127.0.0.1:3001", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await sleep(600);

    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.type('input[type="email"]', "alice@byos.local");
    await page.type('input[type="password"]', "test-password-123");
    await page.click('button[type="submit"]');

    await page.waitForSelector('[data-testid="main-content"]', { timeout: 15000 });
    console.log("  Logged into Webmail successfully.");
    await sleep(800);

    // --- STEP 2: Mailbox Sidebar Structure & Width ---
    console.log("\n--- [STEP 2] Check Mailbox Sidebar Design, Width, and Account Switcher ---");
    await page.waitForSelector('[data-testid="sidebar"]', { timeout: 5000 });
    const mailSidebarInfo = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="sidebar"]');
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const chip = el.querySelector('[data-testid="account-chip-selector"]');
      const brand = el.textContent.includes("BYOS Mail");
      return {
        width: Math.round(rect.width),
        display: style.display,
        hasAccountChip: Boolean(chip),
        hasBrand: brand,
      };
    });

    console.log(`  Mailbox Sidebar width: ${mailSidebarInfo.width}px`);
    assert(mailSidebarInfo.width === 256, `Mailbox sidebar width must be 256px (got ${mailSidebarInfo.width}px)`);
    assert(mailSidebarInfo.hasAccountChip, "Mailbox sidebar includes AccountSwitcher");
    assert(mailSidebarInfo.hasBrand, "Mailbox sidebar includes BYOS Mail brand header");

    const mailScreenshot = path.join(artifactsDir, "sidebar_mailbox_account_switcher.png");
    await page.screenshot({ path: mailScreenshot });
    console.log("  Saved screenshot: sidebar_mailbox_account_switcher.png");

    // --- STEP 3: Calendar Sidebar Structure & Width ---
    console.log("\n--- [STEP 3] Check Calendar Sidebar Design, Width, and Account Switcher ---");
    // Switch to Calendar module
    const calTab = await page.waitForSelector('[data-testid="nav-calendar-tab"]', { timeout: 5000 });
    await calTab.click();
    await sleep(600);

    await page.waitForSelector('[data-testid="calendar-sidebar"]', { timeout: 5000 });
    const calSidebarInfo = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="calendar-sidebar"]');
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const chip = el.querySelector('[data-testid="account-chip-selector"]');
      const brand = el.textContent.includes("BYOS Calendar");
      const newEventBtn = el.querySelector('[data-testid="calendar-new-event-btn"]');
      return {
        width: Math.round(rect.width),
        hasAccountChip: Boolean(chip),
        hasBrand: brand,
        hasNewEvent: Boolean(newEventBtn),
      };
    });

    console.log(`  Calendar Sidebar width: ${calSidebarInfo.width}px`);
    assert(calSidebarInfo.width === 256, `Calendar sidebar width must be 256px identical to Mailbox (got ${calSidebarInfo.width}px)`);
    assert(calSidebarInfo.hasAccountChip, "Calendar sidebar includes AccountSwitcher");
    assert(calSidebarInfo.hasBrand, "Calendar sidebar includes BYOS Calendar brand header");
    assert(calSidebarInfo.hasNewEvent, "Calendar sidebar includes New Event button");

    // Open Account Switcher dropdown in Calendar
    await page.click('[data-testid="calendar-sidebar"] [data-testid="account-chip-selector"]');
    await sleep(300);
    const calDropdownOpen = await page.evaluate(() => {
      const drop = document.querySelector('[data-testid="account-dropdown-all"]') ||
                   document.querySelector('[data-testid="add-mailbox-button"]');
      return Boolean(drop);
    });
    assert(calDropdownOpen, "AccountSwitcher dropdown successfully opens from Calendar sidebar");
    // Close dropdown
    await page.click('[data-testid="calendar-sidebar"] [data-testid="account-chip-selector"]');
    await sleep(200);

    const calScreenshot = path.join(artifactsDir, "sidebar_calendar_account_switcher.png");
    await page.screenshot({ path: calScreenshot });
    console.log("  Saved screenshot: sidebar_calendar_account_switcher.png");

    // --- STEP 4: Notes Sidebar Structure & Width ---
    console.log("\n--- [STEP 4] Check Notes Sidebar Design, Width, and Account Switcher ---");
    // Switch to Notes module
    const notesTab = await page.waitForSelector('[data-testid="nav-notes-tab"]', { timeout: 5000 });
    await notesTab.click();
    await sleep(600);

    await page.waitForSelector('[data-testid="notes-sidebar"]', { timeout: 5000 });
    const notesSidebarInfo = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="notes-sidebar"]');
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const chip = el.querySelector('[data-testid="account-chip-selector"]');
      const brand = el.textContent.includes("BYOS Notes");
      return {
        width: Math.round(rect.width),
        hasAccountChip: Boolean(chip),
        hasBrand: brand,
      };
    });

    console.log(`  Notes Sidebar width: ${notesSidebarInfo.width}px`);
    assert(notesSidebarInfo.width === 256, `Notes sidebar width must be 256px identical to Mailbox & Calendar (got ${notesSidebarInfo.width}px)`);
    assert(notesSidebarInfo.hasAccountChip, "Notes sidebar includes AccountSwitcher");
    assert(notesSidebarInfo.hasBrand, "Notes sidebar includes BYOS Notes brand header");

    // Open Account Switcher dropdown in Notes
    await page.click('[data-testid="notes-sidebar"] [data-testid="account-chip-selector"]');
    await sleep(300);
    const notesDropdownOpen = await page.evaluate(() => {
      const drop = document.querySelector('[data-testid="account-dropdown-all"]') ||
                   document.querySelector('[data-testid="add-mailbox-button"]');
      return Boolean(drop);
    });
    assert(notesDropdownOpen, "AccountSwitcher dropdown successfully opens from Notes sidebar");
    // Close dropdown
    await page.click('[data-testid="notes-sidebar"] [data-testid="account-chip-selector"]');
    await sleep(200);

    const notesScreenshot = path.join(artifactsDir, "sidebar_notes_account_switcher.png");
    await page.screenshot({ path: notesScreenshot });
    console.log("  Saved screenshot: sidebar_notes_account_switcher.png");

    // --- STEP 5: Verify Note Labels Delete All Bug Fix ---
    console.log("\n--- [STEP 5] Test Deleting All Note Labels Without Them Coming Back ---");
    await page.waitForSelector('[data-testid="notes-nav-edit-labels"]', { timeout: 5000 });
    await page.click('[data-testid="notes-nav-edit-labels"]');
    await sleep(400);

    await page.waitForSelector('[data-testid="edit-labels-modal"]', { timeout: 5000 });
    console.log("  Edit labels modal opened.");

    // Click delete on all labels
    let deletedCount = 0;
    while (true) {
      const deleteButtons = await page.$$('[data-testid^="delete-label-btn-"]');
      if (deleteButtons.length === 0) break;
      await deleteButtons[0].click();
      deletedCount++;
      await sleep(200);
    }
    console.log(`  Deleted ${deletedCount} labels.`);

    // Close the edit labels modal
    await page.click('[data-testid="edit-labels-done-btn"]');
    await sleep(400);

    // Verify sidebar says 'No labels'
    const emptyCheck1 = await page.evaluate(() => {
      const sidebar = document.querySelector('[data-testid="notes-sidebar"]');
      if (!sidebar) return { hasNoLabelsText: false, labelCount: -1 };
      const hasNoLabelsText = sidebar.textContent.includes("No labels");
      const labelButtons = sidebar.querySelectorAll('[data-testid^="notes-nav-label-"]');
      return { hasNoLabelsText, labelCount: labelButtons.length };
    });
    assert(emptyCheck1.labelCount === 0, `All label buttons removed from sidebar (got ${emptyCheck1.labelCount})`);
    assert(emptyCheck1.hasNoLabelsText, "Sidebar displays 'No labels' text");

    // RELOAD PAGE to ensure labels do NOT come back from localStorage
    console.log("  Reloading page to verify persistence...");
    await page.reload({ waitUntil: "domcontentloaded" });
    await sleep(1000);

    // Navigate to Notes
    const notesTabAfterReload = await page.waitForSelector('[data-testid="nav-notes-tab"]', { timeout: 5000 });
    await notesTabAfterReload.click();
    await sleep(600);

    await page.waitForSelector('[data-testid="notes-sidebar"]', { timeout: 5000 });
    const emptyCheckAfterReload = await page.evaluate(() => {
      const sidebar = document.querySelector('[data-testid="notes-sidebar"]');
      if (!sidebar) return { hasNoLabelsText: false, labelCount: -1 };
      const hasNoLabelsText = sidebar.textContent.includes("No labels");
      const labelButtons = sidebar.querySelectorAll('[data-testid^="notes-nav-label-"]');
      return { hasNoLabelsText, labelCount: labelButtons.length };
    });

    console.log(`  After reload label count: ${emptyCheckAfterReload.labelCount}, has 'No labels': ${emptyCheckAfterReload.hasNoLabelsText}`);
    assert(emptyCheckAfterReload.labelCount === 0, "Labels remain deleted after reload (did NOT come back!)");
    assert(emptyCheckAfterReload.hasNoLabelsText, "Sidebar still displays 'No labels' after reload");

    const deletedLabelsScreenshot = path.join(artifactsDir, "notes_labels_deleted_empty.png");
    await page.screenshot({ path: deletedLabelsScreenshot });
    console.log("  Saved screenshot: notes_labels_deleted_empty.png");

    // --- STEP 6: Mobile Responsiveness (375px) ---
    console.log("\n--- [STEP 6] Mobile Responsiveness (375px) ---");
    await page.setViewport({ width: 375, height: 667 });
    await sleep(400);

    const scrollCheck = await page.evaluate(() => {
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    });
    console.log(`  Mobile viewport: scrollWidth=${scrollCheck.scrollWidth}, clientWidth=${scrollCheck.clientWidth}`);
    assert(
      scrollCheck.scrollWidth <= scrollCheck.clientWidth,
      `Zero horizontal scroll on mobile (scrollWidth: ${scrollCheck.scrollWidth}, clientWidth: ${scrollCheck.clientWidth})`
    );

    assert(pageErrors.length === 0, `Zero uncaught page errors (got ${pageErrors.length})`);

    console.log("\n================================================================================");
    console.log("   ALL SIDEBAR CONSISTENCY, ACCOUNT SWITCHER & LABELS TESTS PASSED               ");
    console.log("================================================================================");
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
