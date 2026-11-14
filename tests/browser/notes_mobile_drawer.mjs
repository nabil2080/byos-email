/**
 * Browser verification: BYOS Notes mobile navigation drawer, drawer animation,
 * list-first desktop layout, and editor-on-click.
 *
 * Checks:
 * 1. Desktop opens on the note list only (no editor pane until a note is clicked).
 * 2. Notes opens on the note list at 375px (not the navigation sidebar).
 * 3. The notes navigation opens as an overlay drawer (fixed, w-72, max-w-[85vw],
 *    flush left, full height) with a dimmed backdrop.
 * 4. The drawer and backdrop are animated (transform + visibility, opacity).
 * 5. Drawer closes via backdrop click, nav selection, and Escape; the shell stays
 *    mounted and slides off-canvas.
 * 6. Clicking a note opens the editor; on desktop the list becomes a 320px column.
 * 7. Console messages, failed requests, >=400 responses and storage keys are
 *    dumped at the final assertion.
 *
 * Screenshots: tests/browser/artifacts/notes_mobile_list_375px.png
 *              tests/browser/artifacts/notes_mobile_drawer_open.png
 *              tests/browser/artifacts/notes_mobile_editor_375px.png
 *              tests/browser/artifacts/notes_desktop_sidebar_256px.png
 *              tests/browser/artifacts/notes_desktop_split_editor.png
 */

import puppeteer from "../../apps/webmail/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const artifactsDir = path.resolve(__dirname, "artifacts");
const APP_URL = "http://127.0.0.1:3001";

if (!fs.existsSync(artifactsDir)) {
  fs.mkdirSync(artifactsDir, { recursive: true });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function record(id, name, passed, details = "") {
  results.push({ id, name, passed, details });
  console.log(`  ${passed ? "[PASS]" : "[FAIL]"} [${id}] ${name}`);
  if (details) console.log(`         Details: ${details}`);
}

async function measure(page) {
  return page.evaluate(() => {
    const shell = document.querySelector('[data-testid="notes-sidebar-shell"]');
    const backdrop = document.querySelector('[data-testid="notes-mobile-nav-backdrop"]');
    const listPane = document.querySelector('[data-testid="notes-list-pane"]');
    const editorPane = document.querySelector('[data-testid="notes-editor-pane"]');
    const shellRect = shell ? shell.getBoundingClientRect() : null;
    const shellStyle = shell ? window.getComputedStyle(shell) : null;
    const backdropStyle = backdrop ? window.getComputedStyle(backdrop) : null;
    const listRect = listPane ? listPane.getBoundingClientRect() : null;
    const editorRect = editorPane ? editorPane.getBoundingClientRect() : null;
    const tx = (() => {
      const value = shellStyle?.translate || "none";
      if (value === "none") return 0;
      const first = value.split(" ")[0];
      return Number.parseFloat(first) || 0;
    })();
    const shellVisibility = shellStyle?.visibility || null;
    return {
      shellMounted: Boolean(shell),
      shellVisibility,
      shellTransformX: Math.round(tx),
      shellOpen: shellVisibility !== "hidden" && Math.round(tx) === 0,
      shellLeft: shellRect ? Math.round(shellRect.left) : 0,
      shellTop: shellRect ? Math.round(shellRect.top) : 0,
      shellWidth: shellRect ? Math.round(shellRect.width) : 0,
      shellHeight: shellRect ? Math.round(shellRect.height) : 0,
      shellPosition: shellStyle ? shellStyle.position : null,
      shellTransitionProperty: shellStyle ? shellStyle.transitionProperty : null,
      shellTransitionDuration: shellStyle ? shellStyle.transitionDuration : null,
      backdropDisplay: backdropStyle ? backdropStyle.display : null,
      backdropOpacity: backdropStyle ? Number(backdropStyle.opacity) : 0,
      backdropTransitionProperty: backdropStyle ? backdropStyle.transitionProperty : null,
      backdropTransitionDuration: backdropStyle ? backdropStyle.transitionDuration : null,
      backdropShown: Boolean(
        backdropStyle && backdropStyle.display !== "none" && Number(backdropStyle.opacity) > 0.05
      ),
      listVisible: Boolean(listPane && listPane.getClientRects().length > 0),
      listWidth: listRect ? Math.round(listRect.width) : 0,
      editorMounted: Boolean(editorPane),
      editorVisible: Boolean(editorPane && editorPane.getClientRects().length > 0),
      editorWidth: editorRect ? Math.round(editorRect.width) : 0,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      docScrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
    };
  });
}

async function run() {
  console.log("=".repeat(78));
  console.log("  BYOS NOTES: MOBILE DRAWER, ANIMATION & LIST-FIRST LAYOUT VERIFICATION");
  console.log("=".repeat(78) + "\n");

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    defaultViewport: { width: 1440, height: 900 },
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  const page = await browser.newPage();
  const pageErrors = [];
  const consoleMessages = [];
  const failedRequests = [];
  const errorResponses = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("console", (m) => consoleMessages.push({ type: m.type(), text: m.text() }));
  page.on("requestfailed", (r) =>
    failedRequests.push({ url: r.url(), error: r.failure()?.errorText })
  );
  page.on("response", (r) => {
    if (r.status() >= 400) errorResponses.push({ status: r.status(), url: r.url() });
  });

  try {
    console.log("--- [STEP 1] Login as Alice ---");
    await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
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
    await sleep(1200);
    record("AUTH", "Login as Alice succeeded", true, "account-chip-selector mounted");

    console.log("\n--- [STEP 2] Open Notes module (desktop, nothing selected) ---");
    await page.click('[data-testid="nav-notes-tab"]');
    await page.waitForSelector('[data-testid="notes-list-pane"]', { timeout: 10000 });
    await sleep(700);

    const desktopIdle = await measure(page);
    record(
      "DESKTOP_SIDEBAR_INLINE",
      "Desktop sidebar is the 256px in-flow pane",
      desktopIdle.shellWidth === 256 && desktopIdle.shellPosition === "static",
      `width=${desktopIdle.shellWidth}px position=${desktopIdle.shellPosition}`
    );
    record(
      "DESKTOP_NO_BACKDROP",
      "Desktop renders no mobile backdrop",
      desktopIdle.backdropDisplay === "none",
      `backdropDisplay=${desktopIdle.backdropDisplay}`
    );
    record(
      "DESKTOP_LIST_ONLY",
      "Desktop shows the list only until a note is clicked",
      desktopIdle.listVisible &&
        desktopIdle.listWidth > 900 &&
        desktopIdle.editorMounted === false,
      `listWidth=${desktopIdle.listWidth}px editorMounted=${desktopIdle.editorMounted}`
    );
    await page.screenshot({
      path: path.join(artifactsDir, "notes_desktop_sidebar_256px.png"),
    });

    console.log("\n--- [STEP 3] Resize to 375px phone viewport ---");
    await page.setViewport({ width: 375, height: 760 });
    await sleep(700);
    const mobileIdle = await measure(page);
    record(
      "MOBILE_LIST_FIRST",
      "Notes opens on the note list, not the navigation sidebar",
      mobileIdle.listVisible === true && mobileIdle.shellOpen === false,
      `listVisible=${mobileIdle.listVisible} shellOpen=${mobileIdle.shellOpen} transformX=${mobileIdle.shellTransformX}`
    );
    record(
      "MOBILE_NO_HSCROLL",
      "No horizontal scroll at 375px",
      mobileIdle.docScrollWidth <= mobileIdle.viewportWidth + 1 &&
        mobileIdle.bodyScrollWidth <= mobileIdle.viewportWidth + 1,
      `doc=${mobileIdle.docScrollWidth} body=${mobileIdle.bodyScrollWidth} viewport=${mobileIdle.viewportWidth}`
    );
    record(
      "MOBILE_DRAWER_ANIMATION",
      "Drawer slides (transform + visibility) and backdrop fades (opacity)",
      String(mobileIdle.shellTransitionProperty).includes("translate") &&
        String(mobileIdle.shellTransitionProperty).includes("visibility") &&
        String(mobileIdle.shellTransitionDuration).includes("0.2s") &&
        String(mobileIdle.backdropTransitionProperty).includes("opacity") &&
        String(mobileIdle.backdropTransitionDuration).includes("0.2s"),
      `shell=${mobileIdle.shellTransitionProperty} ${mobileIdle.shellTransitionDuration}; backdrop=${mobileIdle.backdropTransitionProperty} ${mobileIdle.backdropTransitionDuration}`
    );
    await page.screenshot({
      path: path.join(artifactsDir, "notes_mobile_list_375px.png"),
    });

    console.log("\n--- [STEP 4] Open the mobile navigation drawer ---");
    await page.click('[data-testid="notes-mobile-categories-btn"]');
    await sleep(500);
    const drawer = await measure(page);
    record(
      "MOBILE_DRAWER_OVERLAY",
      "Drawer is a fixed overlay flush to the left edge",
      drawer.shellOpen === true &&
        drawer.shellPosition === "fixed" &&
        drawer.shellLeft === 0 &&
        drawer.shellTop === 0 &&
        drawer.shellTransformX === 0,
      `open=${drawer.shellOpen} position=${drawer.shellPosition} left=${drawer.shellLeft}px top=${drawer.shellTop}px transformX=${drawer.shellTransformX}`
    );
    record(
      "MOBILE_DRAWER_WIDTH",
      "Drawer uses the Mail/Calendar 288px drawer width (max 85vw)",
      drawer.shellWidth === 288,
      `width=${drawer.shellWidth}px (max ${Math.round(drawer.viewportWidth * 0.85)}px)`
    );
    record(
      "MOBILE_DRAWER_FULL_HEIGHT",
      "Drawer spans the full viewport height",
      Math.abs(drawer.shellHeight - drawer.viewportHeight) <= 1,
      `height=${drawer.shellHeight}px viewport=${drawer.viewportHeight}px`
    );
    record(
      "MOBILE_DRAWER_BACKDROP",
      "Dimmed backdrop is present while the drawer is open",
      drawer.backdropShown === true && drawer.backdropOpacity === 1,
      `backdropShown=${drawer.backdropShown} opacity=${drawer.backdropOpacity}`
    );
    await page.screenshot({
      path: path.join(artifactsDir, "notes_mobile_drawer_open.png"),
    });

    console.log("\n--- [STEP 5] Drawer dismissal paths ---");
    await page.click('[data-testid="notes-mobile-nav-backdrop"]');
    await sleep(400);
    const afterBackdrop = await measure(page);
    record(
      "DRAWER_CLOSES_BACKDROP",
      "Backdrop click closes the drawer and returns to the list",
      afterBackdrop.shellOpen === false &&
        afterBackdrop.listVisible === true &&
        afterBackdrop.backdropShown === false,
      `shellOpen=${afterBackdrop.shellOpen} listVisible=${afterBackdrop.listVisible} transformX=${afterBackdrop.shellTransformX} backdropShown=${afterBackdrop.backdropShown}`
    );
    record(
      "SHELL_STAYS_MOUNTED",
      "Closed drawer stays mounted off-canvas so the slide-out can play",
      afterBackdrop.shellMounted === true && afterBackdrop.shellTransformX < 0,
      `mounted=${afterBackdrop.shellMounted} transformX=${afterBackdrop.shellTransformX}`
    );

    console.log("\n--- [STEP 5B] Sample the close animation frame by frame ---");
    await page.click('[data-testid="notes-mobile-categories-btn"]');
    await sleep(400);
    const closeFrames = await page.evaluate(async () => {
      const shell = document.querySelector('[data-testid="notes-sidebar-shell"]');
      const backdrop = document.querySelector('[data-testid="notes-mobile-nav-backdrop"]');
      const samples = [];
      const start = performance.now();
      backdrop.click();
      await new Promise((resolve) => {
        const tick = () => {
          if (!shell) return resolve(null);
          const style = window.getComputedStyle(shell);
          const tx = Number.parseFloat((style.translate || "none").split(" ")[0]) || 0;
          samples.push(Math.round(tx));
          if (performance.now() - start < 340) requestAnimationFrame(tick);
          else resolve(null);
        };
        requestAnimationFrame(tick);
      });
      return samples;
    });
    record(
      "DRAWER_ANIMATES_CLOSE",
      "Closing the drawer interpolates through intermediate translate positions",
      closeFrames.some((v) => v > -100 && v < 0),
      `samples=${JSON.stringify(closeFrames.slice(0, 14))}`
    );

    await page.click('[data-testid="notes-mobile-categories-btn"]');
    await sleep(400);
    await page.keyboard.press("Escape");
    await sleep(400);
    const afterEscape = await measure(page);
    record(
      "DRAWER_CLOSES_ESCAPE",
      "Escape closes the drawer",
      afterEscape.shellOpen === false,
      `shellOpen=${afterEscape.shellOpen} transformX=${afterEscape.shellTransformX}`
    );

    await page.click('[data-testid="notes-mobile-categories-btn"]');
    await sleep(400);
    await page.click('[data-testid="notes-nav-favorites"]');
    await sleep(500);
    const afterNav = await measure(page);
    record(
      "DRAWER_CLOSES_NAV",
      "Selecting a navigation item closes the drawer",
      afterNav.shellOpen === false && afterNav.listVisible === true,
      `shellOpen=${afterNav.shellOpen} listVisible=${afterNav.listVisible}`
    );

    console.log("\n--- [STEP 6] Note selection opens the editor ---");
    await page.click('[data-testid="notes-mobile-categories-btn"]');
    await sleep(400);
    await page.click('[data-testid="notes-nav-notes"]');
    await sleep(600);

    const countRows = () =>
      page.$$eval('[data-testid="notes-list-pane"] [role="button"]', (els) => els.length);

    let noteCount = await countRows();
    if (noteCount === 0) {
      await page.click('[data-testid="notes-list-new-note-btn"]');
      await sleep(1400);
      const newNoteOpened = await page.evaluate(() => {
        const editor = document.querySelector('[data-testid="notes-editor-pane"]');
        return Boolean(editor && editor.getClientRects().length > 0);
      });
      record(
        "NEW_NOTE_OPENS_EDITOR",
        "New Note creates a note and opens the editor",
        newNoteOpened === true,
        `editorVisible=${newNoteOpened}`
      );
      await page.click('[data-testid="notes-editor-back-btn"]');
      await sleep(700);
      noteCount = await countRows();
    }

    if (noteCount > 0) {
      const beforeClick = await measure(page);
      await page.click('[data-testid="notes-list-pane"] [role="button"]');
      await sleep(800);
      const afterClick = await measure(page);
      record(
        "EDITOR_OPENS_ON_CLICK",
        "Clicking a note opens the editor pane",
        beforeClick.editorMounted === false && afterClick.editorVisible === true,
        `editorBefore=${beforeClick.editorMounted} editorAfter=${afterClick.editorVisible}`
      );
      await page.screenshot({
        path: path.join(artifactsDir, "notes_mobile_editor_375px.png"),
      });
    } else {
      record(
        "EDITOR_OPENS_ON_CLICK",
        "Clicking a note opens the editor pane",
        false,
        "No notes in list and creation did not produce one (mailbox key unavailable?)"
      );
    }

    console.log("\n--- [STEP 7] Desktop split view after selection ---");
    await page.setViewport({ width: 1440, height: 900 });
    await sleep(700);
    const desktopSplit = await measure(page);
    record(
      "DESKTOP_SPLIT_ON_SELECT",
      "Desktop splits into a 320-350px list plus the editor after a note is clicked",
      desktopSplit.listWidth >= 320 &&
        desktopSplit.listWidth <= 350 &&
        desktopSplit.editorVisible === true &&
        desktopSplit.editorWidth > desktopSplit.listWidth,
      `list=${desktopSplit.listWidth}px editor=${desktopSplit.editorWidth}px`
    );
    await page.screenshot({
      path: path.join(artifactsDir, "notes_desktop_split_editor.png"),
    });

    record(
      "NO_PAGE_ERRORS",
      "No uncaught page errors during the run",
      pageErrors.length === 0,
      pageErrors.join(" | ") || "none"
    );

    const storageKeys = await page.evaluate(() => ({
      localStorage: Object.keys(localStorage),
      sessionStorage: Object.keys(sessionStorage),
    }));
    const consoleErrors = consoleMessages.filter((m) => m.type === "error");
    console.log("\n--- DevTools state at final assertion ---");
    console.log(`console messages: ${consoleMessages.length} (errors: ${consoleErrors.length})`);
    for (const m of consoleErrors) {
      console.log(`  [${m.type}] ${m.text}`);
    }
    const nonErrorTypes = [...new Set(consoleMessages.filter((m) => m.type !== "error").map((m) => m.type))];
    console.log(`non-error message types: ${JSON.stringify(nonErrorTypes)}`);
    console.log(
      `failed requests: ${failedRequests.length ? JSON.stringify(failedRequests) : "none"}`
    );
    console.log(`localStorage keys: ${JSON.stringify(storageKeys.localStorage)}`);
    console.log(`sessionStorage keys: ${JSON.stringify(storageKeys.sessionStorage)}`);
    const responseGroups = {};
    for (const r of errorResponses) {
      const key = `${r.status} ${r.url.split("?")[0]}`;
      responseGroups[key] = (responseGroups[key] || 0) + 1;
    }
    console.log(`error responses (${errorResponses.length}):`);
    for (const [key, count] of Object.entries(responseGroups)) {
      console.log(`  ${count}x ${key}`);
    }
  } finally {
    await browser.close();
  }

  const passed = results.filter((r) => r.passed).length;
  console.log("\n" + "=".repeat(78));
  console.log(`  SUMMARY: ${passed}/${results.length} checks passed`);
  console.log("=".repeat(78));
  if (passed !== results.length) process.exitCode = 1;
}

run().catch((err) => {
  console.error("Test execution failed:", err);
  process.exitCode = 1;
});