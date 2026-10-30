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
  console.log("   BYOS: UI CONSISTENCY ACROSS MODULES & ADVANCED GOOGLE KEEP NOTES FEATURES    ");
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

    console.log("\n--- [STEP 2] Check UI Consistency & Radius in Mailbox ---");
    await page.waitForSelector('[data-testid="sidebar"]', { timeout: 5000 });
    await page.waitForSelector('[data-testid="top-fixed-bar"]', { timeout: 5000 });
    await page.waitForSelector('[data-testid="right-utility-bar"]', { timeout: 5000 });

    const sidebarRect = await page.$eval('[data-testid="sidebar"]', (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, width: r.width };
    });
    const topBarRect = await page.$eval('[data-testid="top-fixed-bar"]', (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    });
    const rightBarRect = await page.$eval('[data-testid="right-utility-bar"]', (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    });

    console.log(`  Sidebar Right: ${sidebarRect.right}px | TopBar Left: ${topBarRect.left}px | TopBar Right: ${topBarRect.right}px | RightBar Left: ${rightBarRect.left}px`);
    assert(topBarRect.left >= sidebarRect.right - 5, "Mail TopFixedBar sits BESIDE left sidebar");
    assert(topBarRect.right <= rightBarRect.right + 5, "Mail TopFixedBar is strictly inside email section, NOT spanning beyond RightBar");

    // Check card border radius of the email section
    const mailCardRadius = await page.$eval('[data-testid="top-fixed-bar"]', (el) => {
      const card = el.closest('.rounded-2xl') || el.parentElement;
      return window.getComputedStyle(card).borderRadius;
    });
    console.log(`  Email section card borderRadius: ${mailCardRadius}`);
    assert(mailCardRadius === "16px", `Email workspace card has rounded-2xl (16px) radius (got '${mailCardRadius}')`);

    await page.screenshot({ path: path.join(artifactsDir, 'consistency_mailbox_rounded_card.png') });
    console.log("  Saved screenshot: consistency_mailbox_rounded_card.png");

    console.log("\n--- [STEP 3] Check UI Consistency & Radius in Calendar ---");
    await page.click('[data-testid="nav-calendar-tab"]');
    await sleep(600);

    await page.waitForSelector('[data-testid="calendar-sidebar"]', { timeout: 5000 });
    await page.waitForSelector('[data-testid="top-fixed-bar"]', { timeout: 5000 });
    await page.waitForSelector('[data-testid="calendar-toolbar"]', { timeout: 5000 });

    const calCardRadius = await page.$eval('[data-testid="top-fixed-bar"]', (el) => {
      const card = el.closest('.rounded-2xl') || el.parentElement;
      return window.getComputedStyle(card).borderRadius;
    });
    console.log(`  Calendar workspace card borderRadius: ${calCardRadius}`);
    assert(calCardRadius === "16px", `Calendar workspace card has identical rounded-2xl (16px) radius (got '${calCardRadius}')`);

    await page.screenshot({ path: path.join(artifactsDir, 'consistency_calendar_rounded_card.png') });
    console.log("  Saved screenshot: consistency_calendar_rounded_card.png");

    console.log("\n--- [STEP 4] Check UI Consistency & Radius in Notes ---");
    await page.click('[data-testid="nav-notes-tab"]');
    await sleep(600);

    await page.waitForSelector('[data-testid="notes-sidebar"]', { timeout: 5000 });
    await page.waitForSelector('[data-testid="top-fixed-bar"]', { timeout: 5000 });

    const notesCardRadius = await page.$eval('[data-testid="top-fixed-bar"]', (el) => {
      const card = el.closest('.rounded-2xl') || el.parentElement;
      return window.getComputedStyle(card).borderRadius;
    });
    console.log(`  Notes workspace card borderRadius: ${notesCardRadius}`);
    assert(notesCardRadius === "16px", `Notes workspace card has identical rounded-2xl (16px) radius (got '${notesCardRadius}')`);

    // Verify NotesSidebar BYOS Brand System Styling
    const notesActiveStyling = await page.$eval('[data-testid="notes-nav-notes"]', (el) => {
      const cs = window.getComputedStyle(el);
      return {
        borderRadius: cs.borderRadius,
        fontWeight: cs.fontWeight,
      };
    });
    console.log(`  Notes nav item borderRadius: ${notesActiveStyling.borderRadius}, fontWeight: ${notesActiveStyling.fontWeight}`);
    assert(notesActiveStyling.borderRadius === "12px", "Notes sidebar item has rounded-xl (12px) pill (NOT rounded-r-full)");

    await page.screenshot({ path: path.join(artifactsDir, 'consistency_notes_rounded_card.png') });
    console.log("  Saved screenshot: consistency_notes_rounded_card.png");

    console.log("\n--- [STEP 5] Test Note Composer Toolbar & Collaborator (Attachment 4) ---");
    await page.waitForSelector('[data-testid="notes-compose-collapsed"]', { timeout: 5000 });
    await page.click('[data-testid="notes-compose-collapsed"]');
    await sleep(250);

    await page.waitForSelector('[data-testid="notes-compose-expanded"]', { timeout: 5000 });

    // Verify All Toolbar items from Attachment 4
    const formatBtn = await page.$('[data-testid="compose-formatting-btn"]');
    const paletteBtn = await page.$('[data-testid="new-note-color-palette-btn"]');
    const reminderBtn = await page.$('[data-testid="new-note-reminder-btn"]');
    const collabBtn = await page.$('[data-testid="new-note-collaborator-btn"]');
    const imageBtn = await page.$('[data-testid="new-note-image-btn"]');
    const moreMenuBtn = await page.$('[data-testid="new-note-more-menu-btn"]');
    const undoBtn = await page.$('[data-testid="compose-undo-btn"]');
    const redoBtn = await page.$('[data-testid="compose-redo-btn"]');
    const closeBtn = await page.$('[data-testid="new-note-save-btn"]');

    assert(formatBtn !== null, "Toolbar item 1: Formatting 'A' button exists");
    assert(paletteBtn !== null, "Toolbar item 2: Palette button exists");
    assert(reminderBtn !== null, "Toolbar item 3: Reminder button exists");
    assert(collabBtn !== null, "Toolbar item 4: Collaborator button exists");
    assert(imageBtn !== null, "Toolbar item 5: Image attachment button exists");
    assert(moreMenuBtn !== null, "Toolbar item 6: Three-dot menu button exists");
    assert(undoBtn !== null, "Toolbar item 7: Undo button exists");
    assert(redoBtn !== null, "Toolbar item 8: Redo button exists");
    assert(closeBtn !== null, "Toolbar item 9: Close button exists");

    // Type title and content
    await page.type('[data-testid="new-note-title-input"]', "Meeting Architecture Review");
    await page.type('[data-testid="new-note-content-input"]', "Review end-to-end encryption boundaries and drawing sketches.");

    // Add Collaborator
    await collabBtn.click();
    await sleep(150);
    await page.type('input[placeholder="Person or email…"]', "bob@byos.local");
    const addCollabBtns = await page.$$("button");
    for (const b of addCollabBtns) {
      const text = await page.evaluate((el) => el.textContent, b);
      if (text?.trim() === "Add") {
        await b.click();
        await sleep(100);
        break;
      }
    }
    const hasCollabBadge = await page.$eval('[data-testid="notes-compose-expanded"]', (el) => el.textContent.includes("bob@byos.local"));
    assert(hasCollabBadge, "Collaborator badge 'bob@byos.local' added to note");

    console.log("\n--- [STEP 6] Test Three-Dot Menu Options (Attachment 5) & Drawing Modal ---");
    await moreMenuBtn.click();
    await sleep(150);

    await page.waitForSelector('[data-testid="compose-more-menu-popover"]', { timeout: 5000 });
    const addLabelOpt = await page.$('[data-testid="menu-add-label-btn"]');
    const addDrawingOpt = await page.$('[data-testid="menu-add-drawing-btn"]');
    const makeCopyOpt = await page.$('[data-testid="menu-make-copy-btn"]');
    const toggleTickboxesOpt = await page.$('[data-testid="menu-toggle-tickboxes-btn"]');
    const versionHistoryOpt = await page.$('[data-testid="menu-version-history-btn"]');
    const deleteNoteOpt = await page.$('[data-testid="menu-delete-note-btn"]');

    assert(addLabelOpt !== null, "Three-dot menu: 'Add label' option exists");
    assert(addDrawingOpt !== null, "Three-dot menu: 'Add drawing' option exists");
    assert(makeCopyOpt !== null, "Three-dot menu: 'Make a copy' option exists");
    assert(toggleTickboxesOpt !== null, "Three-dot menu: 'Show tick boxes' option exists");
    assert(versionHistoryOpt !== null, "Three-dot menu: 'Version history' option exists");
    assert(deleteNoteOpt !== null, "Three-dot menu: 'Delete note' option exists");

    // Verify 'Copy to Google Docs' is EXCLUDED as requested
    const docsOpt = await page.$eval('[data-testid="compose-more-menu-popover"]', (el) => el.textContent.includes("Google Docs"));
    assert(!docsOpt, "Three-dot menu: 'Copy to Google Docs' is EXCLUDED per requirements");

    // Click 'Add drawing' to launch interactive canvas modal
    await addDrawingOpt.click();
    await sleep(250);

    await page.waitForSelector('[data-testid="drawing-modal"]', { timeout: 5000 });
    await page.waitForSelector('[data-testid="drawing-canvas"]', { timeout: 5000 });
    console.log("  Drawing modal opened successfully.");

    // Perform a sketch on canvas
    const canvas = await page.$('[data-testid="drawing-canvas"]');
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + 50, box.y + 50);
    await page.mouse.down();
    await page.mouse.move(box.x + 150, box.y + 80);
    await page.mouse.move(box.x + 220, box.y + 120);
    await page.mouse.up();

    // Save drawing
    await page.click('[data-testid="save-drawing-btn"]');
    await sleep(300);

    // Verify drawing thumbnail is present in composer
    const drawingImg = await page.$('[data-testid="notes-compose-expanded"] img[alt="Drawing"]');
    assert(drawingImg !== null, "Drawing successfully saved and attached to composer");

    // Save note
    await page.click('[data-testid="new-note-save-btn"]');
    await sleep(400);

    // Verify note is rendered in grid with drawing and collaborator
    const noteTitles = await page.$$eval('[data-testid="notes-view"] h4', (els) => els.map((e) => e.textContent?.trim()));
    assert(noteTitles.includes("Meeting Architecture Review"), "Note 'Meeting Architecture Review' is rendered in grid");

    await page.screenshot({ path: path.join(artifactsDir, 'note_with_drawing_and_collaborator.png') });
    console.log("  Saved screenshot: note_with_drawing_and_collaborator.png");

    console.log("\n--- [STEP 7] Mobile Viewport Responsiveness (375px) ---");
    await page.setViewport({ width: 375, height: 667 });
    await sleep(500);

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    console.log(`  Mobile viewport check: scrollWidth=${scrollWidth}, clientWidth=${clientWidth}`);
    assert(scrollWidth <= clientWidth, "Zero horizontal scroll at 375px mobile viewport");

    await page.screenshot({ path: path.join(artifactsDir, 'mobile_notes_ui_375px.png') });
    console.log("  Saved screenshot: mobile_notes_ui_375px.png");

    assert(pageErrors.length === 0, `Zero uncaught page errors (got ${pageErrors.length})`);

    console.log("\n================================================================================");
    console.log("   ALL UI CONSISTENCY & GOOGLE KEEP NOTES ADVANCED AUDITS PASSED               ");
    console.log("================================================================================");
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error("FATAL ERROR in browser test:", err);
  process.exit(1);
});
