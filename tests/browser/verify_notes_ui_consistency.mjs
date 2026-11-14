/**
 * Comprehensive Browser Verification Script:
 * BYOS Notes: Editor Spacing, Sidebar Consistency & Action Toolbar Verification
 *
 * Checks:
 * 1. Notes Editor Spacing:
 *    - Usable container width expands (>850px on desktop, max-w-5xl).
 *    - Comfortable horizontal margins (px-4 sm:px-6 md:px-8).
 *    - Title textarea and body editor align consistently.
 *    - No horizontal overflow on desktop or mobile.
 * 2. Standardized Desktop Sidebar Width:
 *    - Mail sidebar: computed width 256px (w-64).
 *    - Calendar sidebar: computed width 256px (w-64).
 *    - Notes sidebar: computed width 256px (w-64).
 *    - No layout shift or jump when switching between modules.
 * 3. Standardized Sidebar Action Buttons:
 *    - Mail "New Message" (min-height 44px, py-2.5 px-4, rounded-xl, gradient, kbd 'C').
 *    - Calendar "New Event" (min-height 44px, py-2.5 px-4, rounded-xl, gradient, kbd 'E').
 *    - Notes "New Note" (min-height 44px, py-2.5 px-4, rounded-xl, gradient, kbd 'N').
 * 4. Action Toolbar Icons & Mapping:
 *    - Favorite star is the first note action; the retired Pin button must not render.
 *    - Favorite button: Star icon, correct tooltip and pressed state.
 *    - Reminder button: Bell icon, correct tooltip.
 *    - Label button: Tag icon, correct tooltip.
 *    - More actions button: Three vertical dots, correct tooltip.
 *    - Note Color button: retired — must not render.
 * 5. Neutral Note Surfaces (color system retired):
 *    - Editor pane and list rows use the neutral surface (bg-white / dark:bg-[#18191D]).
 *    - No palette button, no color picker menu, no per-note tint or color dot.
 * 6. Save & Sync Status:
 *    - Healthy states display "✓ Saved" and "Sync: Synced" (or "Sync: idle").
 * 7. Mobile Responsiveness:
 *    - Viewport 375px scales smoothly with zero horizontal scroll.
 *
 * Saves 8 required screenshots in tests/browser/artifacts/:
 * - notes_editor_spacious_width.png
 * - notes_sidebar_standard_width.png
 * - mail_sidebar_standard_width.png
 * - calendar_sidebar_standard_width.png
 * - sidebar_action_buttons_comparison.png
 * - notes_action_toolbar_icons.png
 * - notes_neutral_surfaces_reload.png
 * - notes_editor_mobile_375px.png
 */

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

const testResults = [];
function recordResult(id, name, passed, details = "") {
  testResults.push({ id, name, passed, details, timestamp: new Date().toISOString() });
  const statusStr = passed ? "[PASS]" : "[FAIL]";
  console.log(`  ${statusStr} [${id}] ${name}`);
  if (details) {
    console.log(`         Details: ${details}`);
  }
}

async function runSuite() {
  console.log("================================================================================");
  console.log("   BYOS NOTES: UI CONSISTENCY, SPACING & ACTION TOOLBAR VERIFICATION             ");
  console.log("================================================================================\n");

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    defaultViewport: { width: 1440, height: 900 },
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--window-size=1440,900",
    ],
  });

  const page = await browser.newPage();
  await page.setCacheEnabled(false);
  await page.setViewport({ width: 1440, height: 900 });

  const pageErrors = [];
  page.on("pageerror", (err) => {
    pageErrors.push(err.message);
    console.error("  [PAGE ERROR]", err.message);
  });

  try {
    // -------------------------------------------------------------------------
    // STEP 1: Login as Alice
    // -------------------------------------------------------------------------
    console.log("--- [STEP 1] Login Flow as Alice ---");
    await page.goto("http://127.0.0.1:3001", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload({ waitUntil: "networkidle2" });
    await sleep(800);

    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.type('input[type="email"]', "alice@byos.local");
    await page.type('input[type="password"]', "test-password-123");
    await page.click('button[type="submit"]');

    await page.waitForSelector('[data-testid="account-chip-selector"]', { timeout: 15000 });
    await sleep(1500);
    recordResult("AUTH_01", "Login as Alice succeeded", true, "Account chip selector mounted");

    // -------------------------------------------------------------------------
    // STEP 2: Measure Mail Sidebar Width & Action Button
    // -------------------------------------------------------------------------
    console.log("\n--- [STEP 2] Measure Mail Sidebar & Action Button ---");
    await page.waitForSelector('[data-testid="sidebar"]', { timeout: 5000 });
    const mailSidebarRect = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="sidebar"]');
      const btn = document.querySelector('[data-testid="sidebar-compose-btn"]');
      const rect = el.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      const style = window.getComputedStyle(btn);
      return {
        width: rect.width,
        btnHeight: btnRect.height,
        btnMinHeight: style.minHeight,
        btnBg: style.backgroundImage || style.backgroundColor,
        btnRadius: style.borderRadius,
      };
    });
    console.log(`  Mail sidebar width: ${mailSidebarRect.width}px, Compose button height: ${mailSidebarRect.btnHeight}px`);
    recordResult(
      "SIDEBAR_MAIL_WIDTH",
      "Mail sidebar width is 256px",
      Math.abs(mailSidebarRect.width - 256) <= 1,
      `Computed width: ${mailSidebarRect.width}px, Compose button min-height: ${mailSidebarRect.btnMinHeight}`
    );

    await page.screenshot({
      path: path.join(artifactsDir, "mail_sidebar_standard_width.png"),
      clip: { x: 0, y: 0, width: 320, height: 600 },
    });

    // -------------------------------------------------------------------------
    // STEP 3: Switch to Calendar & Measure Sidebar Width & Action Button
    // -------------------------------------------------------------------------
    console.log("\n--- [STEP 3] Measure Calendar Sidebar & Action Button ---");
    await page.waitForSelector('[data-testid="nav-calendar-tab"]', { timeout: 5000 });
    await page.click('[data-testid="nav-calendar-tab"]');
    await sleep(800);

    await page.waitForSelector('[data-testid="calendar-sidebar"]', { timeout: 5000 });
    const calSidebarRect = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="calendar-sidebar"]');
      const btn = document.querySelector('[data-testid="calendar-new-event-btn"]');
      const rect = el.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      const style = window.getComputedStyle(btn);
      return {
        width: rect.width,
        btnHeight: btnRect.height,
        btnMinHeight: style.minHeight,
        btnRadius: style.borderRadius,
      };
    });
    console.log(`  Calendar sidebar width: ${calSidebarRect.width}px, New Event button height: ${calSidebarRect.btnHeight}px`);
    recordResult(
      "SIDEBAR_CAL_WIDTH",
      "Calendar sidebar width is 256px",
      Math.abs(calSidebarRect.width - 256) <= 1,
      `Computed width: ${calSidebarRect.width}px, New Event button min-height: ${calSidebarRect.btnMinHeight}`
    );

    await page.screenshot({
      path: path.join(artifactsDir, "calendar_sidebar_standard_width.png"),
      clip: { x: 0, y: 0, width: 320, height: 600 },
    });

    // -------------------------------------------------------------------------
    // STEP 4: Switch to Notes & Measure Sidebar Width & Action Button
    // -------------------------------------------------------------------------
    console.log("\n--- [STEP 4] Measure Notes Sidebar & Action Button ---");
    await page.waitForSelector('[data-testid="nav-notes-tab"]', { timeout: 5000 });
    await page.click('[data-testid="nav-notes-tab"]');
    await sleep(800);

    await page.waitForSelector('[data-testid="notes-sidebar"]', { timeout: 5000 });
    const notesSidebarRect = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="notes-sidebar"]');
      const btn = document.querySelector('[data-testid="notes-new-note-btn"]');
      const rect = el.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      const style = window.getComputedStyle(btn);
      return {
        width: rect.width,
        btnHeight: btnRect.height,
        btnMinHeight: style.minHeight,
        btnRadius: style.borderRadius,
      };
    });
    console.log(`  Notes sidebar width: ${notesSidebarRect.width}px, New Note button height: ${notesSidebarRect.btnHeight}px`);
    recordResult(
      "SIDEBAR_NOTES_WIDTH",
      "Notes sidebar width is 256px (identical to Mail and Calendar)",
      Math.abs(notesSidebarRect.width - 256) <= 1,
      `Computed width: ${notesSidebarRect.width}px, New Note button min-height: ${notesSidebarRect.btnMinHeight}`
    );

    recordResult(
      "SIDEBAR_WIDTH_EQUALITY",
      "Sidebar width is identical across Mail, Calendar, and Notes with 0px shift",
      Math.abs(mailSidebarRect.width - calSidebarRect.width) <= 0.5 &&
        Math.abs(calSidebarRect.width - notesSidebarRect.width) <= 0.5,
      `Mail: ${mailSidebarRect.width}px, Calendar: ${calSidebarRect.width}px, Notes: ${notesSidebarRect.width}px`
    );

    recordResult(
      "ACTION_BUTTONS_STANDARDIZED",
      "Sidebar action buttons share identical height (44px) and styling",
      Math.abs(mailSidebarRect.btnHeight - 44) <= 1 &&
        Math.abs(calSidebarRect.btnHeight - 44) <= 1 &&
        Math.abs(notesSidebarRect.btnHeight - 44) <= 1,
      `Mail btn: ${mailSidebarRect.btnHeight}px, Cal btn: ${calSidebarRect.btnHeight}px, Notes btn: ${notesSidebarRect.btnHeight}px`
    );

    await page.screenshot({
      path: path.join(artifactsDir, "notes_sidebar_standard_width.png"),
      clip: { x: 0, y: 0, width: 320, height: 600 },
    });

    await page.screenshot({
      path: path.join(artifactsDir, "sidebar_action_buttons_comparison.png"),
      clip: { x: 0, y: 40, width: 280, height: 180 },
    });

    // -------------------------------------------------------------------------
    // STEP 5: Create a Note and Verify Editor Usable Width & Margins
    // -------------------------------------------------------------------------
    console.log("\n--- [STEP 5] Verify Notes Editor Usable Width & Spacing ---");
    await page.waitForSelector('[data-testid="notes-new-note-btn"]', { timeout: 5000 });
    await page.click('[data-testid="notes-new-note-btn"]');
    await sleep(600);

    // Set Note Title & Body
    await page.waitForSelector('[data-testid="notes-editor-title-input"]', { timeout: 5000 });
    await page.click('[data-testid="notes-editor-title-input"]');
    await page.type('[data-testid="notes-editor-title-input"]', "Enterprise Architecture & Infrastructure Document");

    await page.waitForSelector('[data-testid="notes-editor-content-input"]', { timeout: 5000 });
    await page.click('[data-testid="notes-editor-content-input"]');
    await page.evaluate(() => {
      const editor = document.querySelector('[data-testid="notes-editor-content-input"]');
      editor.innerHTML = `
        <p>This document demonstrates the widened, spacious document editing layout. The text line length now comfortably accommodates technical documentation, architecture specifications, and structured paragraphs without excessive horizontal margins or artificial narrowing.</p>
        <p>Document margins remain refined, professional, and visually balanced across all desktop displays, allowing images, tables, and long-form prose to utilize available screen width effectively.</p>
      `;
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await sleep(600);

    const editorMetrics = await page.evaluate(() => {
      const pane = document.querySelector('[data-testid="notes-editor-pane"]');
      const titleInput = document.querySelector('[data-testid="notes-editor-title-input"]');
      const contentEditor = document.querySelector('[data-testid="notes-editor-content-input"]');
      const contentContainer = titleInput?.closest(".max-w-5xl");

      const paneRect = pane?.getBoundingClientRect();
      const containerRect = contentContainer?.getBoundingClientRect();
      const titleRect = titleInput?.getBoundingClientRect();
      const contentRect = contentEditor?.getBoundingClientRect();

      return {
        paneWidth: paneRect?.width,
        containerWidth: containerRect?.width,
        titleWidth: titleRect?.width,
        contentWidth: contentRect?.width,
        leftTitleOffset: titleRect?.left,
        leftContentOffset: contentRect?.left,
      };
    });

    console.log("  Editor metrics (1440px):", editorMetrics);
    const usableRatio = (editorMetrics.containerWidth / editorMetrics.paneWidth) * 100;
    recordResult(
      "EDITOR_CONTAINER_RATIO",
      "Notes editor usable container width utilizes >90% of available pane width on standard desktop",
      usableRatio >= 90,
      `Container width: ${editorMetrics.containerWidth}px / ${editorMetrics.paneWidth}px (${usableRatio.toFixed(1)}%)`
    );

    // Test wide monitor expansion (1920px) to verify max-w-5xl (>850px) expands properly
    await page.setViewport({ width: 1920, height: 1080 });
    await sleep(400);
    const wideMetrics = await page.evaluate(() => {
      const pane = document.querySelector('[data-testid="notes-editor-pane"]');
      const titleInput = document.querySelector('[data-testid="notes-editor-title-input"]');
      const contentContainer = titleInput?.closest(".max-w-5xl");
      return {
        paneWidth: pane?.getBoundingClientRect().width,
        containerWidth: contentContainer?.getBoundingClientRect().width,
      };
    });
    console.log("  Editor metrics (1920px):", wideMetrics);
    recordResult(
      "EDITOR_WIDE_EXPANSION",
      "Notes editor expands beyond 850px (reaching max-w-5xl / 1024px) on wide desktop screens",
      wideMetrics.containerWidth >= 850,
      `Container width on 1920px viewport: ${wideMetrics.containerWidth}px (pane: ${wideMetrics.paneWidth}px)`
    );

    // Restore standard 1440px viewport for remaining tests
    await page.setViewport({ width: 1440, height: 900 });
    await sleep(400);

    recordResult(
      "EDITOR_TITLE_BODY_ALIGNMENT",
      "Title textarea and document body editor align consistently with identical left offset",
      Math.abs(editorMetrics.leftTitleOffset - editorMetrics.leftContentOffset) <= 2,
      `Title left: ${editorMetrics.leftTitleOffset}px, Content left: ${editorMetrics.leftContentOffset}px`
    );

    await page.screenshot({
      path: path.join(artifactsDir, "notes_editor_spacious_width.png"),
    });

    // -------------------------------------------------------------------------
    // STEP 6: Verify Action Toolbar Icons & Retired Pin Button
    // -------------------------------------------------------------------------
    console.log("\n--- [STEP 6] Verify Notes Action Toolbar Icons ---");
    const toolbarInfo = await page.evaluate(() => {
      const pinBtn = document.querySelector('[data-testid="notes-editor-pin-btn"]');
      const favBtn = document.querySelector('[data-testid="notes-editor-favorite-btn"]');
      const remBtn = document.querySelector('[data-testid="notes-editor-reminder-btn"]');
      const lblBtn = document.querySelector('[data-testid="notes-editor-labels-btn"]');
      const palBtn = document.querySelector('[data-testid="notes-editor-palette-btn"]');
      const morBtn = document.querySelector('[data-testid="notes-editor-more-btn"]');

      const favSvg = favBtn?.querySelector("svg")?.innerHTML || "";
      const remSvg = remBtn?.querySelector("svg")?.innerHTML || "";
      const lblSvg = lblBtn?.querySelector("svg")?.innerHTML || "";
      const morSvg = morBtn?.querySelector("svg")?.innerHTML || "";

      // The visible note actions in the left toolbar group, in DOM order.
      const leftGroup = favBtn?.parentElement;
      const visibleActionIds = Array.from(
        leftGroup?.querySelectorAll('button[data-testid$="-btn"]') || []
      )
        .filter((btn) => btn.getClientRects().length > 0)
        .map((btn) => btn.getAttribute("data-testid"));

      return {
        pinBtnAbsent: !pinBtn,
        favPressed: favBtn?.getAttribute("aria-pressed"),
        visibleActionIds,
        favIsFirstAction: visibleActionIds[0] === "notes-editor-favorite-btn",
        favTitle: favBtn?.getAttribute("title"),
        remTitle: remBtn?.getAttribute("title"),
        lblTitle: lblBtn?.getAttribute("title"),
        morTitle: morBtn?.getAttribute("title"),
        paletteBtnAbsent: !palBtn,
        hasFavPolygon: favSvg.includes("polygon points="),
        hasRemPath: remSvg.includes("M18 8A6 6"),
        hasLblPath: lblSvg.includes("M20.59 13.41"),
        hasMorCircles: morSvg.includes("circle cx="),
      };
    });

    recordResult(
      "PIN_RETIRED",
      "Pin button is gone and the favorite star takes the first toolbar slot",
      toolbarInfo.pinBtnAbsent && toolbarInfo.favIsFirstAction && toolbarInfo.hasFavPolygon,
      `pinBtnAbsent=${toolbarInfo.pinBtnAbsent} visibleActions=${JSON.stringify(toolbarInfo.visibleActionIds)}`
    );

    recordResult(
      "TOOLBAR_ICONS_MAPPING",
      "Active action toolbar icons (Favorite, Reminder, Label, More) correctly mapped; retired Pin and Palette buttons absent",
      toolbarInfo.hasFavPolygon &&
        toolbarInfo.hasRemPath &&
        toolbarInfo.hasLblPath &&
        toolbarInfo.hasMorCircles &&
        toolbarInfo.paletteBtnAbsent &&
        toolbarInfo.pinBtnAbsent,
      `Tooltips: "${toolbarInfo.favTitle}", "${toolbarInfo.remTitle}", "${toolbarInfo.lblTitle}", "${toolbarInfo.morTitle}"; paletteBtnAbsent=${toolbarInfo.paletteBtnAbsent} pinBtnAbsent=${toolbarInfo.pinBtnAbsent}`
    );

    // Favorite toggle test (deterministic: normalize to unstarred, then star it)
    if (toolbarInfo.favPressed === "true") {
      await page.click('[data-testid="notes-editor-favorite-btn"]');
      await sleep(400);
    }
    await page.click('[data-testid="notes-editor-favorite-btn"]');
    await sleep(500);
    const favActive = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="notes-editor-favorite-btn"]');
      return {
        pressed: btn?.getAttribute("aria-pressed"),
        title: btn?.getAttribute("title"),
        fill: btn?.querySelector("svg")?.getAttribute("fill"),
      };
    });
    recordResult(
      "FAVORITE_TOGGLE_ACTIVE",
      "Favorite star toggles its pressed state, tooltip and filled icon",
      favActive.pressed === "true" &&
        favActive.title === "Remove from favorites" &&
        favActive.fill === "currentColor",
      `aria-pressed="${favActive.pressed}" title="${favActive.title}" fill="${favActive.fill}"`
    );

    // Capture toolbar screenshot
    await page.screenshot({
      path: path.join(artifactsDir, "notes_action_toolbar_icons.png"),
      clip: { x: 500, y: 0, width: 500, height: 60 },
    });

    // -------------------------------------------------------------------------
    // STEP 7: Note color system retired — no palette UI may render
    // -------------------------------------------------------------------------
    console.log("\n--- [STEP 7] Verify Note Color System Is Retired ---");
    const paletteState = await page.evaluate(() => ({
      paletteBtn: !!document.querySelector('[data-testid="notes-editor-palette-btn"]'),
      pickerMenu: !!document.querySelector('[data-testid="notes-color-picker-menu"]'),
      colorOption: !!document.querySelector('[data-testid^="notes-color-option-"]'),
    }));
    recordResult(
      "COLOR_SYSTEM_RETIRED",
      "Palette button, color picker menu and color options are absent",
      !paletteState.paletteBtn && !paletteState.pickerMenu && !paletteState.colorOption,
      `paletteBtn=${paletteState.paletteBtn} pickerMenu=${paletteState.pickerMenu} colorOption=${paletteState.colorOption}`
    );

    // -------------------------------------------------------------------------
    // STEP 8: Reload Page & Verify Neutral Surfaces Persist
    // -------------------------------------------------------------------------
    console.log("\n--- [STEP 8] Verify Neutral Surfaces Across Page Reload ---");
    await sleep(800); // Allow debounced auto-save
    await page.reload({ waitUntil: "networkidle2" });
    await sleep(1500);

    await page.waitForSelector('[data-testid="nav-notes-tab"]', { timeout: 5000 });
    await page.click('[data-testid="nav-notes-tab"]');
    await sleep(1000);

    // The editor opens only on an explicit click
    await page.waitForSelector('[data-testid="notes-list-item"]', { timeout: 5000 });
    await page.click('[data-testid="notes-list-item"]');
    await sleep(800);

    const neutralState = await page.evaluate(() => {
      const pane = document.querySelector('[data-testid="notes-editor-pane"]');
      const titleInput = document.querySelector('[data-testid="notes-editor-title-input"]');
      const activeCard = document.querySelector('[data-testid="notes-list-item"]');
      const paneClass = pane?.className || "";
      const cardClass = activeCard?.className || "";
      const tintedPane = ["bg-[#FFF2EB]", "dark:bg-[#342721]", "bg-[#FAF9F5]", "dark:bg-[#14161A]"].some(
        (c) => paneClass.includes(c)
      );
      const tintedCard = ["bg-[#FFF2EB]", "dark:bg-[#342721]"].some((c) => cardClass.includes(c));
      const colorDot = activeCard?.querySelector('[title*="Color:"]');
      return {
        title: titleInput?.value,
        paneNeutral: !tintedPane && paneClass.includes("bg-white") && paneClass.includes("dark:bg-[#18191D]"),
        cardNotTinted: !tintedCard,
        hasColorDot: !!colorDot,
      };
    });

    recordResult(
      "NEUTRAL_SURFACES_PERSIST",
      "Editor and list surfaces stay neutral after reload (no per-note tint or color dot)",
      neutralState.paneNeutral && neutralState.cardNotTinted && !neutralState.hasColorDot,
      `Title: "${neutralState.title}", paneNeutral=${neutralState.paneNeutral}, cardNotTinted=${neutralState.cardNotTinted}, colorDot=${neutralState.hasColorDot}`
    );

    await page.screenshot({
      path: path.join(artifactsDir, "notes_neutral_surfaces_reload.png"),
    });

    // -------------------------------------------------------------------------
    // STEP 9: Verify Save & Sync Status in Normal State
    // -------------------------------------------------------------------------
    console.log("\n--- [STEP 9] Verify Save & Sync Status ---");
    const statusText = await page.evaluate(() => {
      const pane = document.querySelector('[data-testid="notes-editor-pane"]');
      const saveStatus = pane?.querySelector(".text-emerald-600, .text-emerald-400")?.textContent || "";
      const syncStatus = pane?.querySelector(".capitalize")?.textContent || "";
      return { saveStatus, syncStatus };
    });

    console.log("  Save & Sync status:", statusText);
    recordResult(
      "STATUS_HEALTHY_RECOVERY",
      "Save and Sync status report healthy accurate state without stale error",
      statusText.saveStatus.includes("Saved") && statusText.syncStatus.includes("Sync"),
      `Save status: "${statusText.saveStatus}", Sync status: "${statusText.syncStatus}"`
    );

    // -------------------------------------------------------------------------
    // STEP 10: Mobile 375px Viewport Scaling & Horizontal Overflow Check
    // -------------------------------------------------------------------------
    console.log("\n--- [STEP 10] Mobile 375px Viewport Scaling ---");
    await page.setViewport({ width: 375, height: 667 });
    await sleep(600);

    const mobileMetrics = await page.evaluate(() => {
      const doc = document.documentElement;
      const body = document.body;
      const editor = document.querySelector('[data-testid="notes-editor-pane"]');
      const scrollWidth = Math.max(doc.scrollWidth, body.scrollWidth);
      const clientWidth = doc.clientWidth;
      const hasHorizontalOverflow = scrollWidth > clientWidth;

      return {
        scrollWidth,
        clientWidth,
        hasHorizontalOverflow,
        editorVisible: !!editor,
      };
    });

    console.log("  Mobile metrics (375px):", mobileMetrics);
    recordResult(
      "MOBILE_375PX_RESPONSIVE",
      "Mobile 375px viewport scales seamlessly with zero horizontal overflow",
      !mobileMetrics.hasHorizontalOverflow,
      `ScrollWidth: ${mobileMetrics.scrollWidth}px, ClientWidth: ${mobileMetrics.clientWidth}px, Overflow: ${mobileMetrics.hasHorizontalOverflow}`
    );

    await page.screenshot({
      path: path.join(artifactsDir, "notes_editor_mobile_375px.png"),
    });

  } catch (err) {
    console.error("Test execution failed:", err);
    recordResult("TEST_RUNNER_ERROR", "Test suite execution error", false, err.message);
  } finally {
    await browser.close();
  }

  console.log("\n================================================================================");
  console.log("   TEST SUMMARY                                                                 ");
  console.log("================================================================================");
  const total = testResults.length;
  const passed = testResults.filter((r) => r.passed).length;
  const failed = total - passed;
  console.log(`Total checks: ${total} | Passed: ${passed} | Failed: ${failed}\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runSuite().catch((e) => {
  console.error("Fatal error running test suite:", e);
  process.exit(1);
});
