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
  console.log("   BYOS: MENG TO DESIGN CRAFTSMANSHIP & ANTI-SLOP VERIFICATION AUDIT            ");
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

    console.log("\n--- [STEP 2] Verify Sidebar Monogram Badge, Width & Account Switcher in Mail ---");
    await page.waitForSelector('[data-testid="sidebar"]', { timeout: 5000 });
    const mailSidebarInfo = await page.$eval('[data-testid="sidebar"]', (el) => {
      const rect = el.getBoundingClientRect();
      const title = el.querySelector(".text-sm.font-semibold")?.textContent?.trim();
      const subtitle = el.querySelector(".font-mono")?.textContent?.trim();
      const accountSwitcher = el.querySelector('[data-testid="account-chip-selector"]');
      return {
        width: Math.round(rect.width),
        title,
        subtitle,
        hasAccountSwitcher: Boolean(accountSwitcher),
      };
    });
    console.log("  Mail Sidebar Info:", JSON.stringify(mailSidebarInfo));
    assert(mailSidebarInfo.width === 256, `Mail sidebar width is exactly 256px (got ${mailSidebarInfo.width}px)`);
    assert(mailSidebarInfo.title === "BYOS Mail", "Mail sidebar has title 'BYOS Mail'");
    assert(mailSidebarInfo.subtitle?.toLowerCase() === "zero-knowledge", "Mail sidebar has subtitle 'Zero-Knowledge'");
    assert(mailSidebarInfo.hasAccountSwitcher, "Mail sidebar has AccountSwitcher dropdown");

    console.log("\n--- [STEP 3] Verify Email Row Craftsmanship & Luminous Unread Jewel Dot ---");
    await page.waitForSelector('[data-testid="message-row"]', { timeout: 5000 });
    const rowEffects = await page.evaluate(() => {
      const rows = document.querySelectorAll('[data-testid="message-row"]');
      const firstRow = rows[0];
      const unreadDot = firstRow.querySelector('[title="Unread"]');
      const dotStyles = unreadDot ? window.getComputedStyle(unreadDot) : null;
      return {
        hasRows: rows.length > 0,
        hasUnreadDot: Boolean(unreadDot),
        dotShadow: dotStyles?.boxShadow || "",
        dotBorderRadius: dotStyles?.borderRadius || "",
      };
    });
    console.log("  Email Row Details:", JSON.stringify(rowEffects));
    assert(rowEffects.hasRows, "Email messages rendered in inbox");
    if (rowEffects.hasUnreadDot) {
      assert(rowEffects.dotBorderRadius === "50%", "Unread indicator is a circular jewel dot");
    }

    await page.screenshot({ path: path.join(artifactsDir, "craftsmanship_mailbox_inbox.png") });
    console.log("  Saved screenshot: craftsmanship_mailbox_inbox.png");

    console.log("\n--- [STEP 4] Verify Calendar Sidebar Consistency & Width ---");
    await page.click('[data-testid="nav-calendar-tab"]');
    await sleep(600);
    await page.waitForSelector('[data-testid="calendar-sidebar"]', { timeout: 5000 });
    const calSidebarInfo = await page.$eval('[data-testid="calendar-sidebar"]', (el) => {
      const rect = el.getBoundingClientRect();
      const title = el.querySelector(".text-sm.font-semibold")?.textContent?.trim();
      const subtitle = el.querySelector(".font-mono")?.textContent?.trim();
      const accountSwitcher = el.querySelector('[data-testid="account-chip-selector"]');
      return {
        width: Math.round(rect.width),
        title,
        subtitle,
        hasAccountSwitcher: Boolean(accountSwitcher),
      };
    });
    console.log("  Calendar Sidebar Info:", JSON.stringify(calSidebarInfo));
    assert(calSidebarInfo.width === 256, `Calendar sidebar width is identical 256px (got ${calSidebarInfo.width}px)`);
    assert(calSidebarInfo.title === "BYOS Calendar", "Calendar sidebar has title 'BYOS Calendar'");
    assert(calSidebarInfo.subtitle?.toLowerCase() === "zero-knowledge", "Calendar sidebar has subtitle 'Zero-Knowledge'");
    assert(calSidebarInfo.hasAccountSwitcher, "Calendar sidebar has AccountSwitcher dropdown");

    await page.screenshot({ path: path.join(artifactsDir, "craftsmanship_calendar_sidebar.png") });
    console.log("  Saved screenshot: craftsmanship_calendar_sidebar.png");

    console.log("\n--- [STEP 5] Verify Notes Sidebar Consistency & Width ---");
    await page.click('[data-testid="nav-notes-tab"]');
    await sleep(600);
    await page.waitForSelector('[data-testid="notes-sidebar"]', { timeout: 5000 });
    const notesSidebarInfo = await page.$eval('[data-testid="notes-sidebar"]', (el) => {
      const rect = el.getBoundingClientRect();
      const title = el.querySelector(".text-sm.font-semibold")?.textContent?.trim();
      const subtitle = el.querySelector(".font-mono")?.textContent?.trim();
      const accountSwitcher = el.querySelector('[data-testid="account-chip-selector"]');
      return {
        width: Math.round(rect.width),
        title,
        subtitle,
        hasAccountSwitcher: Boolean(accountSwitcher),
      };
    });
    console.log("  Notes Sidebar Info:", JSON.stringify(notesSidebarInfo));
    assert(notesSidebarInfo.width === 256, `Notes sidebar width is identical 256px (got ${notesSidebarInfo.width}px)`);
    assert(notesSidebarInfo.title === "BYOS Notes", "Notes sidebar has title 'BYOS Notes'");
    assert(notesSidebarInfo.subtitle?.toLowerCase() === "zero-knowledge", "Notes sidebar has subtitle 'Zero-Knowledge'");
    assert(notesSidebarInfo.hasAccountSwitcher, "Notes sidebar has AccountSwitcher dropdown");

    console.log("\n--- [STEP 6] Verify Notes Label Deletion Bug (Delete All & Ensure They Do NOT Return) ---");
    // Open Edit labels modal
    await page.waitForSelector('[data-testid="notes-nav-edit-labels"]', { timeout: 5000 });
    await page.click('[data-testid="notes-nav-edit-labels"]');
    await page.waitForSelector('[data-testid="edit-labels-modal"]', { timeout: 5000 });
    console.log("  Edit labels modal opened.");

    // Delete all existing labels
    let deleteButtons = await page.$$('[data-testid^="delete-label-btn-"]');
    console.log(`  Found ${deleteButtons.length} labels to delete.`);
    while (deleteButtons.length > 0) {
      await deleteButtons[0].click();
      await sleep(200);
      deleteButtons = await page.$$('[data-testid^="delete-label-btn-"]');
    }

    // Close the modal by clicking outside
    await page.click('[data-testid="edit-labels-modal-backdrop"]', { offset: { x: 5, y: 5 } });
    await sleep(400);

    // Verify 0 labels in sidebar
    const labelsAfterDelete = await page.$$eval('[data-testid^="notes-nav-label-"]', (els) => els.length);
    console.log(`  Labels in sidebar immediately after deleting all: ${labelsAfterDelete}`);
    assert(labelsAfterDelete === 0, "Zero labels in sidebar after deleting all labels");

    // Reload page to simulate next session
    console.log("  Reloading page to verify labels do NOT resurrect on reload...");
    await page.reload({ waitUntil: "domcontentloaded" });
    await sleep(800);
    // Navigate back to notes if reloaded on mail
    const hasNotesAfterReload = await page.$('[data-testid="notes-sidebar"]');
    if (!hasNotesAfterReload) {
      await page.waitForSelector('[data-testid="nav-notes-tab"]', { timeout: 5000 });
      await page.click('[data-testid="nav-notes-tab"]');
      await sleep(600);
    }

    await page.waitForSelector('[data-testid="notes-sidebar"]', { timeout: 5000 });
    const labelsAfterReload = await page.$$eval('[data-testid^="notes-nav-label-"]', (els) => els.length);
    console.log(`  Labels in sidebar after page reload: ${labelsAfterReload}`);
    assert(labelsAfterReload === 0, "Labels remain deleted after reload (no resurrection bug!)");

    await page.screenshot({ path: path.join(artifactsDir, "craftsmanship_notes_zero_labels.png") });
    console.log("  Saved screenshot: craftsmanship_notes_zero_labels.png");

    console.log("\n--- [STEP 7] Mobile Responsive Viewport Audit (375px) ---");
    await page.setViewport({ width: 375, height: 667 });
    await sleep(400);
    const mobileMetrics = await page.evaluate(() => {
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    });
    console.log(`  Mobile Viewport Check (375px): scrollWidth=${mobileMetrics.scrollWidth}, clientWidth=${mobileMetrics.clientWidth}`);
    assert(mobileMetrics.scrollWidth <= mobileMetrics.clientWidth, "Zero horizontal scrolling at 375px mobile viewport");

    await page.screenshot({ path: path.join(artifactsDir, "craftsmanship_mobile_375px.png") });
    console.log("  Saved screenshot: craftsmanship_mobile_375px.png");

    assert(pageErrors.length === 0, `Zero page errors during run (got ${pageErrors.length})`);

    console.log("\n================================================================================");
    console.log("   ALL CRAFTSMANSHIP & ANTI-SLOP VERIFICATIONS COMPLETED SUCCESSFULLY!          ");
    console.log("================================================================================");
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error("FATAL ERROR in craftsmanship test:", err);
  process.exit(1);
});
