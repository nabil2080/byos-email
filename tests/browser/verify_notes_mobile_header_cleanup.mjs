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

async function run() {
  console.log("=".repeat(78));
  console.log("  BYOS NOTES: MOBILE HEADER CLEANUP VERIFICATION (VIEWS & CREATE NOTE ICON)");
  console.log("=".repeat(78) + "\n");

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    defaultViewport: { width: 375, height: 667 },
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
    console.log("--- [STEP 1] Login as Alice on 375x667 mobile viewport ---");
    await page.setViewport({ width: 375, height: 667 });
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
    await sleep(1000);
    record("AUTH", "Login as Alice succeeded", true, "account-chip-selector mounted");

    console.log("\n--- [STEP 2] Navigate to Notes Module on Mobile ---");
    const bottomNotesTab = await page.$('[data-testid="bottom-nav-notes-tab"]');
    if (bottomNotesTab) {
      await bottomNotesTab.click();
    } else {
      const notesTab = await page.waitForSelector('[data-testid="nav-notes-tab"]');
      await notesTab.click();
    }
    await page.waitForSelector('[data-testid="notes-list-pane"]', { timeout: 10000 });
    await sleep(1000);

    console.log("\n--- [STEP 3] Assert Views button is completely removed on mobile ---");
    const viewsBtn = await page.$('[data-testid="notes-mobile-categories-btn"]');
    record(
      "VIEWS_REMOVED",
      "Views button (notes-mobile-categories-btn) is completely absent from DOM",
      viewsBtn === null,
      viewsBtn ? "Element was found in DOM" : "Element does not exist in DOM"
    );

    console.log("\n--- [STEP 4] Assert Create Note icon is hidden on mobile viewport ---");
    const mobileHeaderBtnInfo = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="notes-list-new-note-btn"]');
      if (!btn) return { exists: false, display: "none" };
      const cs = window.getComputedStyle(btn);
      return {
        exists: true,
        display: cs.display,
        visibility: cs.visibility,
        rect: btn.getBoundingClientRect(),
      };
    });
    record(
      "CREATE_NOTE_HIDDEN_MOBILE",
      "Create Note icon in header is hidden on 375px mobile viewport",
      mobileHeaderBtnInfo.display === "none",
      `display=${mobileHeaderBtnInfo.display}`
    );

    console.log("\n--- [STEP 5] Assert Floating Action Button is present and visible ---");
    const fabInfo = await page.evaluate(() => {
      const fab = document.querySelector('[data-testid="mobile-notes-fab"]');
      if (!fab) return { exists: false };
      const cs = window.getComputedStyle(fab);
      const rect = fab.getBoundingClientRect();
      return {
        exists: true,
        display: cs.display,
        width: rect.width,
        height: rect.height,
        bottom: rect.bottom,
        right: rect.right,
      };
    });
    record(
      "FAB_VISIBLE_MOBILE",
      "MobileNotesFab is visible at bottom-right",
      fabInfo.exists && fabInfo.display !== "none" && fabInfo.width > 0,
      `width=${fabInfo.width} height=${fabInfo.height}`
    );

    console.log("\n--- [STEP 6] Assert Hamburger Menu in TopFixedBar opens drawer ---");
    const hamburgerBtn = await page.waitForSelector('[data-testid="top-bar-mobile-menu-btn"]');
    await hamburgerBtn.click();
    await sleep(500);

    const drawerOpen = await page.evaluate(() => {
      const shell = document.querySelector('[data-testid="notes-sidebar-shell"]');
      const cs = shell ? window.getComputedStyle(shell) : null;
      return cs ? cs.visibility !== "hidden" : false;
    });
    record(
      "HAMBURGER_DRAWER",
      "TopFixedBar hamburger menu opens mobile navigation drawer",
      drawerOpen === true,
      `drawerOpen=${drawerOpen}`
    );

    // Close drawer via backdrop
    const backdrop = await page.waitForSelector('[data-testid="notes-mobile-nav-backdrop"]');
    await backdrop.click();
    await sleep(500);

    // Save mobile screenshot
    const mobileScreenshotPath = path.join(artifactsDir, "notes_mobile_header_cleaned.png");
    await page.screenshot({ path: mobileScreenshotPath, fullPage: false });
    console.log(`  Saved screenshot: ${mobileScreenshotPath}`);

    console.log("\n--- [STEP 7] Desktop Viewport Verification (1280x800) ---");
    await page.setViewport({ width: 1280, height: 800 });
    await sleep(800);

    const desktopHeaderBtnInfo = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="notes-list-new-note-btn"]');
      if (!btn) return { exists: false, display: "none" };
      const cs = window.getComputedStyle(btn);
      return {
        exists: true,
        display: cs.display,
        visibility: cs.visibility,
        rect: btn.getBoundingClientRect(),
      };
    });
    record(
      "CREATE_NOTE_VISIBLE_DESKTOP",
      "Create Note button in header is visible (flex) on desktop viewport",
      desktopHeaderBtnInfo.exists && desktopHeaderBtnInfo.display === "flex",
      `display=${desktopHeaderBtnInfo.display}`
    );

    const desktopFabInfo = await page.evaluate(() => {
      const fab = document.querySelector('[data-testid="mobile-notes-fab"]');
      if (!fab) return { exists: false, display: "none" };
      const cs = window.getComputedStyle(fab);
      return { exists: true, display: cs.display };
    });
    record(
      "FAB_HIDDEN_DESKTOP",
      "MobileNotesFab is hidden on desktop viewport",
      desktopFabInfo.display === "none",
      `display=${desktopFabInfo.display}`
    );

    // Save desktop screenshot
    const desktopScreenshotPath = path.join(artifactsDir, "notes_desktop_header.png");
    await page.screenshot({ path: desktopScreenshotPath, fullPage: false });
    console.log(`  Saved screenshot: ${desktopScreenshotPath}`);

    console.log("\n--- [STEP 8] DevTools Inspection State ---");
    const storageDump = await page.evaluate(() => {
      return {
        localStorageKeys: Object.keys(localStorage),
        sessionStorageKeys: Object.keys(sessionStorage),
      };
    });
    console.log("  LocalStorage keys:", storageDump.localStorageKeys.join(", "));
    console.log("  SessionStorage keys:", storageDump.sessionStorageKeys.join(", "));
    console.log(`  Console messages logged: ${consoleMessages.length}`);
    console.log(`  Page errors: ${pageErrors.length}`);
    console.log(`  Failed network requests: ${failedRequests.length}`);
    console.log(`  >=400 responses: ${errorResponses.length}`);

    const allPassed = results.every((r) => r.passed);
    console.log("\n" + "=".repeat(78));
    console.log(`  SUMMARY: ${results.filter((r) => r.passed).length}/${results.length} CHECKS PASSED`);
    console.log("=".repeat(78));

    if (!allPassed) {
      process.exit(1);
    }
  } catch (err) {
    console.error("Test execution failed:", err);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

run();
