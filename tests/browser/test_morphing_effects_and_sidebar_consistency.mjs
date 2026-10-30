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
  console.log("   BYOS: MORPHING EFFECTS, BUTTON CONSISTENCY & REVERT VERIFICATION TEST        ");
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
    // -------------------------------------------------------------------------
    // STEP 1: Login Flow as alice@byos.local
    // -------------------------------------------------------------------------
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

    // -------------------------------------------------------------------------
    // STEP 2: Verify Brand Header in Mailbox (Clean baseline B badge)
    // -------------------------------------------------------------------------
    console.log("\n--- [STEP 2] Verify Clean Brand Header in Mailbox ---");
    const mailBrand = await page.evaluate(() => {
      const sidebar = document.querySelector('[data-testid="sidebar"]');
      if (!sidebar) return null;
      const bBadge = sidebar.querySelector(".w-6.h-6");
      const title = sidebar.querySelector(".text-sm.font-semibold");
      const hasZeroKnowledgeSubtitle = sidebar.textContent?.includes("Zero-Knowledge");
      return {
        hasBadge: !!bBadge && bBadge.textContent?.trim() === "B",
        titleText: title ? title.textContent?.trim() : null,
        hasZeroKnowledgeSubtitle,
      };
    });
    assert(mailBrand && mailBrand.hasBadge, "Mailbox has clean w-6 h-6 'B' badge");
    assert(mailBrand && mailBrand.titleText === "BYOS Mail", "Mailbox displays 'BYOS Mail' title");
    assert(mailBrand && !mailBrand.hasZeroKnowledgeSubtitle, "Artificial 'Zero-Knowledge' subtitle was removed");

    // -------------------------------------------------------------------------
    // STEP 3: Verify New Message Button
    // -------------------------------------------------------------------------
    console.log("\n--- [STEP 3] Verify New Message Button in Mailbox ---");
    const composeBtn = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="sidebar-compose-btn"]');
      if (!btn) return null;
      const text = btn.textContent || "";
      const kbd = btn.querySelector("kbd")?.textContent?.trim();
      const hasPlusSvg = !!btn.querySelector("svg");
      return {
        hasPlusSvg,
        text: text.includes("New Message"),
        kbd,
      };
    });
    assert(composeBtn && composeBtn.text, "Compose button contains 'New Message'");
    assert(composeBtn && composeBtn.kbd === "C", "Compose button displays 'C' keyboard shortcut");
    assert(composeBtn && composeBtn.hasPlusSvg, "Compose button has plus SVG icon");

    // -------------------------------------------------------------------------
    // STEP 4: Verify Morphing Pill in Mailbox Folders
    // -------------------------------------------------------------------------
    console.log("\n--- [STEP 4] Verify Morphing Sliding Pill in Mailbox Folders ---");
    // Click Sent
    await page.click('[data-testid="folder-sent"]');
    await sleep(350);
    const sentPillState = await page.evaluate(() => {
      const nav = document.querySelector('[data-testid="sidebar-folders-nav"]');
      const pill = nav ? nav.firstElementChild : null;
      const sentBtn = document.querySelector('[data-testid="folder-sent"]');
      return {
        pillTop: pill ? pill.style.top : null,
        pillHeight: pill ? pill.style.height : null,
        pillOpacity: pill ? pill.style.opacity : null,
        sentOffsetTop: sentBtn ? sentBtn.offsetTop + "px" : null,
      };
    });
    console.log("  Sent folder pill state:", JSON.stringify(sentPillState));
    assert(sentPillState.pillTop === sentPillState.sentOffsetTop, "Morphing pill matches Sent folder offsetTop");

    // Click Drafts
    await page.click('[data-testid="folder-drafts"]');
    await sleep(350);
    const draftsPillState = await page.evaluate(() => {
      const nav = document.querySelector('[data-testid="sidebar-folders-nav"]');
      const pill = nav ? nav.firstElementChild : null;
      const draftsBtn = document.querySelector('[data-testid="folder-drafts"]');
      return {
        pillTop: pill ? pill.style.top : null,
        draftsOffsetTop: draftsBtn ? draftsBtn.offsetTop + "px" : null,
      };
    });
    console.log("  Drafts folder pill state:", JSON.stringify(draftsPillState));
    assert(draftsPillState.pillTop === draftsPillState.draftsOffsetTop, "Morphing pill smoothly slid to Drafts offsetTop");

    // Return to Inbox
    await page.click('[data-testid="folder-inbox"]');
    await sleep(350);
    await page.screenshot({ path: path.join(artifactsDir, "morphing_mailbox_folders.png") });
    console.log("  Saved screenshot to tests/browser/artifacts/morphing_mailbox_folders.png");

    // -------------------------------------------------------------------------
    // STEP 5: Verify Morphing Tabs in Focused Inbox
    // -------------------------------------------------------------------------
    console.log("\n--- [STEP 5] Verify Morphing Indicator in Focused Inbox Tabs ---");
    const hasTabs = await page.$('[data-testid="focused-inbox-tabs"]');
    if (hasTabs) {
      await page.click('[data-testid="category-tab-notifications"]');
      await sleep(350);
      const notifTabState = await page.evaluate(() => {
        const notifBtn = document.querySelector('[data-testid="category-tab-notifications"]');
        const tabs = document.querySelector('[data-testid="focused-inbox-tabs"]');
        const pill = tabs ? tabs.firstElementChild : null;
        return {
          pillLeft: pill ? pill.style.left : null,
          btnOffsetLeft: notifBtn ? notifBtn.offsetLeft + "px" : null,
        };
      });
      console.log("  Notifications tab pill state:", JSON.stringify(notifTabState));
      assert(notifTabState.pillLeft === notifTabState.btnOffsetLeft, "Morphing tab card matches Notifications offsetLeft");

      // Click Newsletters
      await page.click('[data-testid="category-tab-newsletters"]');
      await sleep(350);
      const newsTabState = await page.evaluate(() => {
        const newsBtn = document.querySelector('[data-testid="category-tab-newsletters"]');
        const tabs = document.querySelector('[data-testid="focused-inbox-tabs"]');
        const pill = tabs ? tabs.firstElementChild : null;
        return {
          pillLeft: pill ? pill.style.left : null,
          btnOffsetLeft: newsBtn ? newsBtn.offsetLeft + "px" : null,
        };
      });
      console.log("  Newsletters tab pill state:", JSON.stringify(newsTabState));
      assert(newsTabState.pillLeft === newsTabState.btnOffsetLeft, "Morphing tab card smoothly slid to Newsletters offsetLeft");

      // Back to Primary
      await page.click('[data-testid="category-tab-primary"]');
      await sleep(350);
      await page.screenshot({ path: path.join(artifactsDir, "morphing_focused_inbox_tabs.png") });
      console.log("  Saved screenshot to tests/browser/artifacts/morphing_focused_inbox_tabs.png");
    }

    // -------------------------------------------------------------------------
    // STEP 6: Verify Right Utility Bar Morphing Effect
    // -------------------------------------------------------------------------
    console.log("\n--- [STEP 6] Verify Right Utility Bar Morphing Effect ---");
    // Switch to Calendar via RightBar
    await page.click('[data-testid="nav-calendar-tab"]');
    await sleep(600);
    const calRightState = await page.evaluate(() => {
      const rightBar = document.querySelector('[data-testid="right-utility-bar"]');
      const pill = rightBar ? (rightBar.querySelector('[data-testid="right-bar-morphing-pill"]') || rightBar.querySelector(".absolute")) : null;
      return {
        pillTop: pill ? pill.style.top : null,
      };
    });
    console.log("  RightBar Calendar state:", JSON.stringify(calRightState));
    assert(calRightState.pillTop === "42px" || calRightState.pillTop === "96px", "RightBar active indicator smoothly morphed to Calendar");

    // -------------------------------------------------------------------------
    // STEP 7: Verify Calendar Brand Header & New Event Button
    // -------------------------------------------------------------------------
    console.log("\n--- [STEP 7] Verify Calendar Brand Header & New Event Button ---");
    const calBrand = await page.evaluate(() => {
      const sidebar = document.querySelector('[data-testid="calendar-sidebar"]');
      if (!sidebar) return null;
      const bBadge = sidebar.querySelector(".w-6.h-6");
      const title = sidebar.querySelector(".text-sm.font-semibold");
      const hasZeroKnowledgeSubtitle = sidebar.textContent?.includes("Zero-Knowledge");
      return {
        hasBadge: !!bBadge && bBadge.textContent?.trim() === "B",
        titleText: title ? title.textContent?.trim() : null,
        hasZeroKnowledgeSubtitle,
      };
    });
    assert(calBrand && calBrand.hasBadge, "Calendar has clean w-6 h-6 'B' badge");
    assert(calBrand && calBrand.titleText === "BYOS Calendar", "Calendar displays 'BYOS Calendar' title");
    assert(calBrand && !calBrand.hasZeroKnowledgeSubtitle, "Artificial subtitle removed from Calendar");

    const eventBtn = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="calendar-new-event-btn"]');
      if (!btn) return null;
      const text = btn.textContent || "";
      const kbd = btn.querySelector("kbd")?.textContent?.trim();
      const hasPlusSvg = !!btn.querySelector("svg");
      return {
        hasPlusSvg,
        text: text.includes("New Event"),
        kbd,
      };
    });
    assert(eventBtn && eventBtn.text, "New Event button contains 'New Event'");
    assert(eventBtn && eventBtn.kbd === "E", "New Event button displays 'E' keyboard shortcut matching Compose 'C'");
    assert(eventBtn && eventBtn.hasPlusSvg, "New Event button has plus SVG icon");

    // -------------------------------------------------------------------------
    // STEP 8: Verify Calendar View Mode Segmented Control Morphing
    // -------------------------------------------------------------------------
    console.log("\n--- [STEP 8] Verify Calendar View Mode Segmented Control Morphing ---");
    await page.click('[data-testid="view-day-btn"]');
    await sleep(350);
    const dayViewPill = await page.evaluate(() => {
      const group = document.querySelector('[aria-label="Calendar view"]');
      const pill = group ? group.firstElementChild : null;
      const dayBtn = document.querySelector('[data-testid="view-day-btn"]');
      return {
        pillLeft: pill ? pill.style.left : null,
        dayOffsetLeft: dayBtn ? dayBtn.offsetLeft + "px" : null,
      };
    });
    console.log("  Day view pill state:", JSON.stringify(dayViewPill));
    assert(dayViewPill.pillLeft === dayViewPill.dayOffsetLeft, "Calendar view pill slides to Day view button");

    await page.click('[data-testid="view-month-btn"]');
    await sleep(350);
    const monthViewPill = await page.evaluate(() => {
      const group = document.querySelector('[aria-label="Calendar view"]');
      const pill = group ? group.firstElementChild : null;
      const monthBtn = document.querySelector('[data-testid="view-month-btn"]');
      return {
        pillLeft: pill ? pill.style.left : null,
        monthOffsetLeft: monthBtn ? monthBtn.offsetLeft + "px" : null,
      };
    });
    console.log("  Month view pill state:", JSON.stringify(monthViewPill));
    assert(monthViewPill.pillLeft === monthViewPill.monthOffsetLeft, "Calendar view pill slides to Month view button");
    await page.screenshot({ path: path.join(artifactsDir, "morphing_calendar_view_modes.png") });
    console.log("  Saved screenshot to tests/browser/artifacts/morphing_calendar_view_modes.png");

    // -------------------------------------------------------------------------
    // STEP 9: Switch to Notes & Verify Brand Header and Three-Dot Menu
    // -------------------------------------------------------------------------
    console.log("\n--- [STEP 9] Verify Notes Module & Three-Dot Options ---");
    await page.click('[data-testid="nav-notes-tab"]');
    await sleep(600);

    const notesBrand = await page.evaluate(() => {
      const sidebar = document.querySelector('[data-testid="notes-sidebar"]');
      if (!sidebar) return null;
      const bBadge = sidebar.querySelector(".w-6.h-6");
      const title = sidebar.querySelector(".text-sm.font-semibold");
      const hasZeroKnowledgeSubtitle = sidebar.textContent?.includes("Zero-Knowledge");
      return {
        hasBadge: !!bBadge && bBadge.textContent?.trim() === "B",
        titleText: title ? title.textContent?.trim() : null,
        hasZeroKnowledgeSubtitle,
      };
    });
    assert(notesBrand && notesBrand.hasBadge, "Notes has clean w-6 h-6 'B' badge");
    assert(notesBrand && notesBrand.titleText === "BYOS Notes", "Notes displays 'BYOS Notes' title");
    assert(notesBrand && !notesBrand.hasZeroKnowledgeSubtitle, "Artificial subtitle removed from Notes");

    // Expand composer & check Three-Dot menu
    await page.click('[data-testid="notes-compose-collapsed"]');
    await sleep(300);
    await page.click('[data-testid="new-note-more-menu-btn"]');
    await sleep(300);

    const menuOptions = await page.evaluate(() => {
      const popover = document.querySelector('[data-testid="compose-more-menu-popover"]');
      if (!popover) return null;
      const items = Array.from(popover.querySelectorAll("button, span")).map((el) => el.textContent?.trim());
      const rawText = popover.textContent || "";
      return {
        hasAddLabel: rawText.includes("Add label"),
        hasAddDrawing: rawText.includes("Add drawing"),
        hasMakeCopy: rawText.includes("Make a copy"),
        hasTickBoxes: rawText.includes("tick boxes"),
        hasVersionHistory: rawText.includes("Version history"),
        hasDeleteNote: rawText.includes("Delete note"),
        hasCopyToGoogleDocs: rawText.includes("Copy to Google Docs"),
      };
    });
    console.log("  Notes 3-dot menu options:", JSON.stringify(menuOptions));
    assert(menuOptions && menuOptions.hasAddLabel, "3-dot menu contains 'Add label'");
    assert(menuOptions && menuOptions.hasAddDrawing, "3-dot menu contains 'Add drawing'");
    assert(menuOptions && menuOptions.hasMakeCopy, "3-dot menu contains 'Make a copy'");
    assert(menuOptions && menuOptions.hasTickBoxes, "3-dot menu contains Show/Hide tick boxes");
    assert(menuOptions && menuOptions.hasVersionHistory, "3-dot menu contains 'Version history'");
    assert(menuOptions && menuOptions.hasDeleteNote, "3-dot menu contains 'Delete note'");
    assert(menuOptions && !menuOptions.hasCopyToGoogleDocs, "3-dot menu excludes 'Copy to Google Docs'");

    await page.screenshot({ path: path.join(artifactsDir, "notes_options_and_consistency.png") });
    console.log("  Saved screenshot to tests/browser/artifacts/notes_options_and_consistency.png");

    console.log("\n================================================================================");
    console.log("   ALL BROWSER ASSERTIONS PASSED SUCCESSFULLY!                                   ");
    console.log("================================================================================");
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
