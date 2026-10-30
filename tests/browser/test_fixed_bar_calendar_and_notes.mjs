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

async function run() {
  console.log("================================================================================");
  console.log("   BYOS: FIXED TOP BAR BESIDE SIDEBAR & EXACT GOOGLE KEEP AUDIT                ");
  console.log("================================================================================\n");

  const uncaughtErrors = [];
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ['--no-sandbox', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    page.on('pageerror', (err) => {
      console.error(`  [PAGE ERROR]: ${err.message}`);
      uncaughtErrors.push(err.message);
    });

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

    await page.waitForSelector('[data-testid="main-content"]', { timeout: 15000 });
    console.log("  Logged into Webmail successfully.");
    await sleep(800);

    console.log("\n--- [STEP 2] Verify Fixed Top Bar Sits BESIDE the Sidebar in Mailbox ---");
    await page.waitForSelector('[data-testid="sidebar"]', { timeout: 5000 });
    await page.waitForSelector('[data-testid="top-fixed-bar"]', { timeout: 5000 });

    const sidebarRect = await page.$eval('[data-testid="sidebar"]', (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, width: r.width, top: r.top };
    });
    const topBarRect = await page.$eval('[data-testid="top-fixed-bar"]', (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, width: r.width, top: r.top };
    });

    console.log(`  Sidebar right: ${sidebarRect.right}px, TopFixedBar left: ${topBarRect.left}px`);
    assert(
      topBarRect.left >= sidebarRect.right - 5,
      "TopFixedBar sits BESIDE the sidebar in Mailbox (not over it)"
    );

    // Verify search input and navigation pills
    const searchPlaceholder = await page.$eval('#webmail-search-input', (el) => el.getAttribute('placeholder'));
    assert(searchPlaceholder === "Search emails", `Mail search placeholder is 'Search emails' (got '${searchPlaceholder}')`);

    const emailsSelected = await page.$eval('[data-testid="nav-emails-tab"]', (el) => el.getAttribute('aria-selected'));
    assert(emailsSelected === "true", "Emails pill tab is selected in Mailbox view");

    await page.screenshot({ path: path.join(artifactsDir, 'fixed_top_bar_beside_sidebar_mail.png') });
    console.log("  Saved screenshot: fixed_top_bar_beside_sidebar_mail.png");

    console.log("\n--- [STEP 3] Switch to Calendar View & Verify Bar Sits BESIDE Calendar Sidebar ---");
    await page.click('[data-testid="nav-calendar-tab"]');
    await sleep(600);

    await page.waitForSelector('[data-testid="calendar-sidebar"]', { timeout: 5000 });
    await page.waitForSelector('[data-testid="top-fixed-bar"]', { timeout: 5000 });
    await page.waitForSelector('[data-testid="calendar-toolbar"]', { timeout: 5000 });

    const calSidebarRect = await page.$eval('[data-testid="calendar-sidebar"]', (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, width: r.width, top: r.top };
    });
    const calTopBarRect = await page.$eval('[data-testid="top-fixed-bar"]', (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, width: r.width, top: r.top, bottom: r.bottom };
    });
    const calToolbarRect = await page.$eval('[data-testid="calendar-toolbar"]', (el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    });

    console.log(`  CalendarSidebar right: ${calSidebarRect.right}px, Calendar TopFixedBar left: ${calTopBarRect.left}px`);
    assert(
      calTopBarRect.left >= calSidebarRect.right - 5,
      "TopFixedBar sits BESIDE CalendarSidebar in Calendar (not over it)"
    );

    console.log(`  Calendar TopFixedBar bottom: ${calTopBarRect.bottom}px, CalendarToolbar top: ${calToolbarRect.top}px`);
    assert(
      calToolbarRect.top >= calTopBarRect.bottom - 5,
      "CalendarToolbar sits below TopFixedBar in Calendar view"
    );

    await page.screenshot({ path: path.join(artifactsDir, 'fixed_top_bar_beside_calendar_sidebar.png') });
    console.log("  Saved screenshot: fixed_top_bar_beside_calendar_sidebar.png");

    console.log("\n--- [STEP 4] Switch to Notes View & Verify Google Keep Sidebar (Attachment) ---");
    await page.click('[data-testid="nav-notes-tab"]');
    await sleep(600);

    await page.waitForSelector('[data-testid="notes-sidebar"]', { timeout: 5000 });
    await page.waitForSelector('[data-testid="top-fixed-bar"]', { timeout: 5000 });

    const notesSidebarRect = await page.$eval('[data-testid="notes-sidebar"]', (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, width: r.width, top: r.top };
    });
    const notesTopBarRect = await page.$eval('[data-testid="top-fixed-bar"]', (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, width: r.width, top: r.top };
    });

    console.log(`  NotesSidebar right: ${notesSidebarRect.right}px, Notes TopFixedBar left: ${notesTopBarRect.left}px`);
    assert(
      notesTopBarRect.left >= notesSidebarRect.right - 5,
      "TopFixedBar sits BESIDE NotesSidebar in Notes (not over it)"
    );

    // Verify all Google Keep Sidebar items matching attachment
    const navNotes = await page.$('[data-testid="notes-nav-notes"]');
    const navReminders = await page.$('[data-testid="notes-nav-reminders"]');
    const navEditLabels = await page.$('[data-testid="notes-nav-edit-labels"]');
    const navArchive = await page.$('[data-testid="notes-nav-archive"]');
    const navBin = await page.$('[data-testid="notes-nav-bin"]');

    assert(navNotes !== null, "Google Keep 'Notes' lightbulb item is present in sidebar");
    assert(navReminders !== null, "Google Keep 'Reminders' bell item is present in sidebar");
    assert(navEditLabels !== null, "Google Keep 'Edit labels' pencil item is present in sidebar");
    assert(navArchive !== null, "Google Keep 'Archive' item is present in sidebar");
    assert(navBin !== null, "Google Keep 'Bin' item is present in sidebar");

    await page.screenshot({ path: path.join(artifactsDir, 'notes_google_keep_sidebar.png') });
    console.log("  Saved screenshot: notes_google_keep_sidebar.png");

    console.log("\n--- [STEP 5] Create a Google Keep Checklist Note with Pastel Color & Pin ---");
    // Click new list button on collapsed composer
    await page.click('[data-testid="compose-new-list-btn"]');
    await sleep(250);

    await page.waitForSelector('[data-testid="notes-compose-expanded"]', { timeout: 3000 });
    await page.type('[data-testid="new-note-title-input"]', "Sprint Checklist 2026");

    // Enter checklist items
    const listInputs = await page.$$('[data-testid="notes-compose-expanded"] input[placeholder="List item"]');
    if (listInputs.length > 0) {
      await listInputs[0].type("Verify top fixed bar beside sidebar");
    }

    // Toggle pin in composer
    await page.click('[data-testid="new-note-pin-btn"]');

    // Pick Sage color from palette
    await page.click('[data-testid="new-note-color-palette-btn"]');
    await sleep(150);
    const sageBtn = await page.$('[data-testid="compose-palette-popover"] button[title="Sage"]');
    assert(sageBtn !== null, "Sage pastel swatch option exists");
    await sageBtn.click();
    await sleep(100);

    // Close and save
    await page.click('[data-testid="new-note-save-btn"]');
    await sleep(350);

    // Verify pinned checklist note is rendered
    const noteTitles = await page.$$eval('[data-testid="notes-view"] h4', (els) => els.map((e) => e.textContent?.trim()));
    assert(noteTitles.includes("Sprint Checklist 2026"), "Checklist note 'Sprint Checklist 2026' is created and visible");

    console.log("\n--- [STEP 6] Test Google Keep Bin / Trash & Restore Lifecycle ---");
    // Delete note welcome into Bin
    const deleteBtn = await page.$('[data-testid="note-delete-btn-note-welcome"]');
    assert(deleteBtn !== null, "Delete button exists on note card");
    await deleteBtn.click();
    await sleep(300);

    // Navigate to Bin via sidebar
    await page.click('[data-testid="notes-nav-bin"]');
    await sleep(400);

    await page.waitForSelector('[data-testid="notes-bin-banner"]', { timeout: 3000 });
    const binNote = await page.$('[data-testid="note-card-note-welcome"]');
    assert(binNote !== null, "Deleted note is now in Google Keep Bin view");

    // Restore note from Bin
    const restoreBtn = await page.$('[data-testid="note-restore-btn-note-welcome"]');
    assert(restoreBtn !== null, "Restore button is present in Bin view");
    await restoreBtn.click();
    await sleep(300);

    // Return to active Notes view
    await page.click('[data-testid="notes-nav-notes"]');
    await sleep(400);

    const restoredNote = await page.$('[data-testid="note-card-note-welcome"]');
    assert(restoredNote !== null, "Restored note is returned back to active Notes view");

    console.log("\n--- [STEP 7] Test Edit Labels Modal ---");
    await page.click('[data-testid="notes-nav-edit-labels"]');
    await sleep(300);

    await page.waitForSelector('[data-testid="edit-labels-modal"]', { timeout: 3000 });
    await page.type('[data-testid="create-label-input"]', "Roadmap");
    await page.click('[data-testid="create-label-btn"]');
    await sleep(200);

    await page.click('[data-testid="edit-labels-done-btn"]');
    await sleep(300);

    const roadmapNav = await page.$('[data-testid="notes-nav-label-Roadmap"]');
    assert(roadmapNav !== null, "New label 'Roadmap' is displayed in Google Keep sidebar");

    console.log("\n--- [STEP 8] Mobile Viewport Responsiveness (375px) ---");
    await page.setViewport({ width: 375, height: 667 });
    await sleep(400);

    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    assert(!hasHorizontalOverflow, "Zero horizontal scrolling at 375px mobile viewport");

    await page.screenshot({ path: path.join(artifactsDir, 'mobile_notes_google_keep_375px.png') });
    console.log("  Saved screenshot: mobile_notes_google_keep_375px.png");

    assert(uncaughtErrors.length === 0, `Zero uncaught page errors (got ${uncaughtErrors.length})`);
    console.log("\n================================================================================");
    console.log("   ALL FIXED BAR BESIDE SIDEBAR & GOOGLE KEEP AUDITS PASSED                    ");
    console.log("================================================================================\n");
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error("FATAL ERROR in browser test:", err);
  process.exit(1);
});
