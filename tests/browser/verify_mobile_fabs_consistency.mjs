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

async function runMobileFabsConsistencyVerification() {
  console.log("================================================================================");
  console.log("       MOBILE FLOATING ACTION BUTTONS (FABS) CONSISTENCY VERIFICATION           ");
  console.log("================================================================================\n");

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ['--no-sandbox', '--disable-gpu'],
  });

  const page = await browser.newPage();
  const consoleLogs = [];
  const networkLogs = [];

  page.on('console', (msg) => {
    consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
  });

  page.on('requestfinished', (req) => {
    networkLogs.push(`${req.method()} ${req.url()} -> ${req.response() ? req.response().status() : 'no response'}`);
  });

  try {
    // 1. Mobile Viewport (iPhone 8 / standard 375x667)
    await page.setViewport({ width: 375, height: 667, isMobile: true, hasTouch: true });

    console.log("--- [STEP 1] Login as Alice on 375px mobile viewport ---");
    await page.goto('http://127.0.0.1:3001', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1000);

    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.type('input[type="email"]', 'alice@byos.local');
    await page.type('input[type="password"]', 'test-password-123');
    await page.click('button[type="submit"]');
    await sleep(2500);

    // Verify logged in
    await page.waitForSelector('[data-testid="bottom-fixed-bar"]', { timeout: 10000 });
    console.log("  Successfully logged in. Bottom navigation bar active.");

    // ── STEP 2: Measure Mailbox FAB ──
    console.log("\n--- [STEP 2] Inspect Mailbox Compose FAB ([data-testid=\"mobile-compose-fab\"]) ---");
    await page.waitForSelector('[data-testid="mobile-compose-fab"]', { timeout: 10000 });
    const mailFab = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="mobile-compose-fab"]');
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const svg = el.querySelector('svg');
      const svgRect = svg ? svg.getBoundingClientRect() : null;
      return {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        borderRadius: style.borderRadius,
        backgroundColor: style.backgroundColor,
        bottomOffset: Math.round(window.innerHeight - rect.bottom),
        rightOffset: Math.round(window.innerWidth - rect.right),
        svgWidth: svgRect ? Math.round(svgRect.width) : null,
        svgHeight: svgRect ? Math.round(svgRect.height) : null,
      };
    });

    console.log("  Mailbox FAB metrics:", JSON.stringify(mailFab, null, 2));
    assert(mailFab !== null, "Mailbox Compose FAB exists in DOM");
    assert(mailFab.width === 48, `Mailbox FAB width is 48px (got ${mailFab.width}px)`);
    assert(mailFab.height === 48, `Mailbox FAB height is 48px (got ${mailFab.height}px)`);
    assert(parseFloat(mailFab.borderRadius) === 16, `Mailbox FAB border-radius is 16px (got ${mailFab.borderRadius})`);
    assert(mailFab.backgroundColor === 'rgb(158, 114, 95)', `Mailbox FAB bg is #9E725F (got ${mailFab.backgroundColor})`);
    assert(mailFab.bottomOffset >= 60, `Mailbox FAB bottomOffset is floating above bar (got ${mailFab.bottomOffset}px)`);
    assert(mailFab.svgWidth === 24, `Mailbox FAB SVG width is 24px (got ${mailFab.svgWidth}px)`);
    assert(mailFab.svgHeight === 24, `Mailbox FAB SVG height is 24px (got ${mailFab.svgHeight}px)`);

    const mailScreenshot = path.join(artifactsDir, 'mobile_fab_mail.png');
    await page.screenshot({ path: mailScreenshot });
    console.log(`  Saved screenshot: ${mailScreenshot}`);

    // ── STEP 3: Measure Calendar FAB ──
    console.log("\n--- [STEP 3] Inspect Calendar FAB ([data-testid=\"mobile-calendar-fab\"]) ---");
    await page.click('[data-testid="bottom-nav-calendar-tab"]');
    await sleep(1500);

    await page.waitForSelector('[data-testid="mobile-calendar-fab"]', { timeout: 10000 });
    const calFab = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="mobile-calendar-fab"]');
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const svg = el.querySelector('svg');
      const svgRect = svg ? svg.getBoundingClientRect() : null;
      return {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        borderRadius: style.borderRadius,
        backgroundColor: style.backgroundColor,
        bottomOffset: Math.round(window.innerHeight - rect.bottom),
        rightOffset: Math.round(window.innerWidth - rect.right),
        svgWidth: svgRect ? Math.round(svgRect.width) : null,
        svgHeight: svgRect ? Math.round(svgRect.height) : null,
      };
    });

    console.log("  Calendar FAB metrics:", JSON.stringify(calFab, null, 2));
    assert(calFab !== null, "Calendar FAB exists in DOM");
    assert(calFab.width === 48, `Calendar FAB width is 48px (got ${calFab.width}px)`);
    assert(calFab.height === 48, `Calendar FAB height is 48px (got ${calFab.height}px)`);
    assert(parseFloat(calFab.borderRadius) === 16, `Calendar FAB border-radius is 16px (got ${calFab.borderRadius})`);
    assert(calFab.backgroundColor === 'rgb(158, 114, 95)', `Calendar FAB bg is #9E725F (got ${calFab.backgroundColor})`);
    assert(calFab.bottomOffset >= 60, `Calendar FAB bottomOffset is floating above bar (got ${calFab.bottomOffset}px)`);
    assert(calFab.svgWidth === 24, `Calendar FAB SVG width is 24px (got ${calFab.svgWidth}px)`);
    assert(calFab.svgHeight === 24, `Calendar FAB SVG height is 24px (got ${calFab.svgHeight}px)`);

    const calScreenshot = path.join(artifactsDir, 'mobile_fab_calendar.png');
    await page.screenshot({ path: calScreenshot });
    console.log(`  Saved screenshot: ${calScreenshot}`);

    // ── STEP 4: Measure Notes FAB ──
    console.log("\n--- [STEP 4] Inspect Notes FAB ([data-testid=\"mobile-notes-fab\"]) ---");
    await page.click('[data-testid="bottom-nav-notes-tab"]');
    await sleep(1500);

    await page.waitForSelector('[data-testid="mobile-notes-fab"]', { timeout: 10000 });
    const notesFab = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="mobile-notes-fab"]');
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      const svg = el.querySelector('svg');
      const svgRect = svg ? svg.getBoundingClientRect() : null;
      return {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        borderRadius: style.borderRadius,
        backgroundColor: style.backgroundColor,
        bottomOffset: Math.round(window.innerHeight - rect.bottom),
        rightOffset: Math.round(window.innerWidth - rect.right),
        svgWidth: svgRect ? Math.round(svgRect.width) : null,
        svgHeight: svgRect ? Math.round(svgRect.height) : null,
      };
    });

    console.log("  Notes FAB metrics:", JSON.stringify(notesFab, null, 2));
    assert(notesFab !== null, "Notes FAB exists in DOM");
    assert(notesFab.width === 48, `Notes FAB width is 48px (got ${notesFab.width}px)`);
    assert(notesFab.height === 48, `Notes FAB height is 48px (got ${notesFab.height}px)`);
    assert(parseFloat(notesFab.borderRadius) === 16, `Notes FAB border-radius is 16px (got ${notesFab.borderRadius})`);
    assert(notesFab.backgroundColor === 'rgb(158, 114, 95)', `Notes FAB bg is #9E725F (got ${notesFab.backgroundColor})`);
    assert(notesFab.bottomOffset >= 60, `Notes FAB bottomOffset is floating above bar (got ${notesFab.bottomOffset}px)`);
    assert(notesFab.svgWidth === 24, `Notes FAB SVG width is 24px (got ${notesFab.svgWidth}px)`);
    assert(notesFab.svgHeight === 24, `Notes FAB SVG height is 24px (got ${notesFab.svgHeight}px)`);

    const notesScreenshot = path.join(artifactsDir, 'mobile_fab_notes_list.png');
    await page.screenshot({ path: notesScreenshot });
    console.log(`  Saved screenshot: ${notesScreenshot}`);

    // ── STEP 5: 100% Design Parity Verification Across All 3 FABs ──
    console.log("\n--- [STEP 5] Verify 100% Design Parity Across Mailbox, Calendar, and Notes FABs ---");
    assert(mailFab.width === calFab.width && calFab.width === notesFab.width, `Width identical across all 3: ${notesFab.width}px`);
    assert(mailFab.height === calFab.height && calFab.height === notesFab.height, `Height identical across all 3: ${notesFab.height}px`);
    assert(mailFab.borderRadius === calFab.borderRadius && calFab.borderRadius === notesFab.borderRadius, `Border-radius identical across all 3: ${notesFab.borderRadius}`);
    assert(mailFab.backgroundColor === calFab.backgroundColor && calFab.backgroundColor === notesFab.backgroundColor, `Background color identical across all 3: ${notesFab.backgroundColor}`);
    assert(mailFab.bottomOffset === calFab.bottomOffset && calFab.bottomOffset === notesFab.bottomOffset, `Bottom offset identical across all 3: ${notesFab.bottomOffset}px`);
    assert(mailFab.rightOffset === calFab.rightOffset && calFab.rightOffset === notesFab.rightOffset, `Right offset identical across all 3: ${notesFab.rightOffset}px`);
    assert(mailFab.svgWidth === calFab.svgWidth && calFab.svgWidth === notesFab.svgWidth, `SVG icon width identical across all 3: ${notesFab.svgWidth}px`);
    assert(mailFab.svgHeight === calFab.svgHeight && calFab.svgHeight === notesFab.svgHeight, `SVG icon height identical across all 3: ${notesFab.svgHeight}px`);
    console.log("  100% design parity verified across Mail, Calendar, and Notes FABs!");

    // ── STEP 6: Exercise User Action: Click Notes FAB to Create Note ──
    console.log("\n--- [STEP 6] Exercise Action: Click Notes FAB to Create New Note ---");
    await page.click('[data-testid="mobile-notes-fab"]');
    await sleep(1000);

    // Verify transition into editor view
    await page.waitForSelector('[data-testid="notes-editor-back-btn"]', { timeout: 10000 });
    console.log("  Note created and editor opened successfully.");

    // Assert FAB is hidden in editor view
    const fabInEditor = await page.$('[data-testid="mobile-notes-fab"]');
    assert(fabInEditor === null, "Notes FAB is cleanly hidden while in note editor view");

    const notesEditorScreenshot = path.join(artifactsDir, 'mobile_fab_notes_editor.png');
    await page.screenshot({ path: notesEditorScreenshot });
    console.log(`  Saved screenshot: ${notesEditorScreenshot}`);

    // ── STEP 7: Click Back to List and Verify FAB Reappears ──
    console.log("\n--- [STEP 7] Navigate Back to Notes List and Verify FAB Reappears ---");
    await page.click('[data-testid="notes-editor-back-btn"]');
    await sleep(1000);

    await page.waitForSelector('[data-testid="mobile-notes-fab"]', { timeout: 10000 });
    const fabReappeared = await page.$('[data-testid="mobile-notes-fab"]');
    assert(fabReappeared !== null, "Notes FAB reappears when returning to notes list view");

    // Capture storage & network summary
    const storageKeys = await page.evaluate(() => {
      return {
        sessionStorageKeys: Object.keys(sessionStorage),
        localStorageKeys: Object.keys(localStorage),
      };
    });
    console.log("\n--- DevTools Storage State ---");
    console.log("  sessionStorage keys:", storageKeys.sessionStorageKeys);
    console.log("  localStorage keys:", storageKeys.localStorageKeys);

    console.log("\n--- DevTools Network Request Summary (Sample) ---");
    networkLogs.slice(0, 10).forEach(log => console.log(`  ${log}`));

    console.log("\n================================================================================");
    console.log(" ALL MOBILE FAB CONSISTENCY & FUNCTIONALITY CHECKS PASSED SUCCESSFULLY!          ");
    console.log("================================================================================\n");

  } finally {
    await browser.close();
  }
}

runMobileFabsConsistencyVerification().catch((err) => {
  console.error("FATAL ERROR in runMobileFabsConsistencyVerification:", err);
  process.exit(1);
});
