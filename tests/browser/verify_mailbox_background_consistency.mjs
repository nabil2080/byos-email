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

async function runMailboxBackgroundConsistencyVerification() {
  console.log("================================================================================");
  console.log("       MAILBOX EMAIL LIST SECTION BACKGROUND COLOR CONSISTENCY VERIFICATION     ");
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
    await page.setViewport({ width: 1280, height: 800 });

    console.log("--- [STEP 1] Login as Alice on 1280x800 viewport ---");
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
    await page.waitForSelector('[data-testid="message-list"]', { timeout: 10000 });
    console.log("  Successfully logged in. Message list active in Mailbox.");

    // ── STEP 2: Inspect Mailbox Email List Section Background Color (Light Mode) ──
    console.log("\n--- [STEP 2] Inspect Mailbox Email List Section Background Color (Light Mode) ---");
    const mailColors = await page.evaluate(() => {
      const listEl = document.querySelector('[data-testid="message-list"]');
      const rowEl = document.querySelector('[data-testid="message-row"]');
      const cardEl = listEl ? listEl.closest('.rounded-2xl') : null;
      return {
        messageListBg: listEl ? window.getComputedStyle(listEl).backgroundColor : null,
        messageRowBg: rowEl ? window.getComputedStyle(rowEl).backgroundColor : null,
        workspaceCardBg: cardEl ? window.getComputedStyle(cardEl).backgroundColor : null,
      };
    });

    console.log("  Mailbox light mode colors:", JSON.stringify(mailColors, null, 2));
    assert(mailColors.messageListBg === "rgb(255, 255, 255)", `Mailbox message-list bg is rgb(255, 255, 255) (got ${mailColors.messageListBg})`);
    assert(mailColors.messageRowBg === "rgb(255, 255, 255)", `Mailbox message-row bg is rgb(255, 255, 255) (got ${mailColors.messageRowBg})`);
    assert(mailColors.workspaceCardBg === "rgb(255, 255, 255)", `Mailbox workspace card bg is rgb(255, 255, 255) (got ${mailColors.workspaceCardBg})`);

    const mailLightScreenshot = path.join(artifactsDir, 'mailbox_email_list_bg_light.png');
    await page.screenshot({ path: mailLightScreenshot });
    console.log(`  Saved screenshot: ${mailLightScreenshot}`);

    // ── STEP 3: Inspect Calendar Section Background Color (Light Mode) ──
    console.log("\n--- [STEP 3] Inspect Calendar Section Background Color (Light Mode) ---");
    await page.click('[data-testid="nav-calendar-tab"]');
    await sleep(1500);

    await page.waitForSelector('[data-testid="calendar-toolbar"]', { timeout: 10000 });
    const calColors = await page.evaluate(() => {
      const toolbarEl = document.querySelector('[data-testid="calendar-toolbar"]');
      const cardEl = toolbarEl ? toolbarEl.closest('.rounded-2xl') : null;
      return {
        workspaceCardBg: cardEl ? window.getComputedStyle(cardEl).backgroundColor : null,
      };
    });

    console.log("  Calendar light mode colors:", JSON.stringify(calColors, null, 2));
    assert(calColors.workspaceCardBg === "rgb(255, 255, 255)", `Calendar workspace card bg is rgb(255, 255, 255) (got ${calColors.workspaceCardBg})`);

    const calLightScreenshot = path.join(artifactsDir, 'calendar_bg_light.png');
    await page.screenshot({ path: calLightScreenshot });
    console.log(`  Saved screenshot: ${calLightScreenshot}`);

    // ── STEP 4: Inspect Notes Section Background Color (Light Mode) ──
    console.log("\n--- [STEP 4] Inspect Notes Section Background Color (Light Mode) ---");
    await page.click('[data-testid="nav-notes-tab"]');
    await sleep(1500);

    await page.waitForSelector('[data-testid="notes-list-pane"]', { timeout: 10000 });
    const notesColors = await page.evaluate(() => {
      const listPane = document.querySelector('[data-testid="notes-list-pane"]');
      const noteItem = document.querySelector('[data-testid="notes-list-item"]');
      const cardEl = listPane ? listPane.closest('.rounded-2xl') : null;
      return {
        notesListBg: listPane ? window.getComputedStyle(listPane).backgroundColor : null,
        noteItemBg: noteItem ? window.getComputedStyle(noteItem).backgroundColor : null,
        workspaceCardBg: cardEl ? window.getComputedStyle(cardEl).backgroundColor : null,
      };
    });

    console.log("  Notes light mode colors:", JSON.stringify(notesColors, null, 2));
    assert(notesColors.notesListBg === "rgb(255, 255, 255)", `Notes list pane bg is rgb(255, 255, 255) (got ${notesColors.notesListBg})`);
    assert(notesColors.noteItemBg === "rgb(255, 255, 255)", `Notes item bg is rgb(255, 255, 255) (got ${notesColors.noteItemBg})`);
    assert(notesColors.workspaceCardBg === "rgb(255, 255, 255)", `Notes workspace card bg is rgb(255, 255, 255) (got ${notesColors.workspaceCardBg})`);

    const notesLightScreenshot = path.join(artifactsDir, 'notes_bg_light.png');
    await page.screenshot({ path: notesLightScreenshot });
    console.log(`  Saved screenshot: ${notesLightScreenshot}`);

    // ── STEP 5: Light Mode Background Consistency Assertion ──
    console.log("\n--- [STEP 5] Assert 100% Light Mode Background Consistency Across Modules ---");
    assert(
      mailColors.messageListBg === calColors.workspaceCardBg && calColors.workspaceCardBg === notesColors.notesListBg,
      `Light mode background color is 100% consistent across Mailbox (${mailColors.messageListBg}), Calendar (${calColors.workspaceCardBg}), and Notes (${notesColors.notesListBg})`
    );

    // ── STEP 6: Inspect Dark Mode Background Consistency ──
    console.log("\n--- [STEP 6] Inspect Dark Mode Background Consistency Across Modules ---");
    // Switch to dark theme using TopFixedBar or localStorage
    await page.evaluate(() => {
      document.documentElement.classList.add('dark');
      localStorage.setItem('byos_theme', 'dark');
    });
    await sleep(500);

    // 6a. Check Notes in dark mode
    const notesDarkColors = await page.evaluate(() => {
      const listPane = document.querySelector('[data-testid="notes-list-pane"]');
      return {
        notesListBg: listPane ? window.getComputedStyle(listPane).backgroundColor : null,
      };
    });
    console.log("  Notes dark mode bg:", notesDarkColors.notesListBg);
    assert(notesDarkColors.notesListBg === "rgb(24, 25, 29)", `Notes dark mode bg is rgb(24, 25, 29) (#18191D) (got ${notesDarkColors.notesListBg})`);

    // 6b. Check Calendar in dark mode
    await page.click('[data-testid="nav-calendar-tab"]');
    await sleep(1000);
    const calDarkColors = await page.evaluate(() => {
      const toolbarEl = document.querySelector('[data-testid="calendar-toolbar"]');
      const cardEl = toolbarEl ? toolbarEl.closest('.rounded-2xl') : null;
      return {
        workspaceCardBg: cardEl ? window.getComputedStyle(cardEl).backgroundColor : null,
      };
    });
    console.log("  Calendar dark mode bg:", calDarkColors.workspaceCardBg);
    assert(calDarkColors.workspaceCardBg === "rgb(24, 25, 29)", `Calendar dark mode bg is rgb(24, 25, 29) (#18191D) (got ${calDarkColors.workspaceCardBg})`);

    // 6c. Check Mailbox in dark mode
    await page.click('[data-testid="nav-emails-tab"]');
    await sleep(1000);
    const mailDarkColors = await page.evaluate(() => {
      const listEl = document.querySelector('[data-testid="message-list"]');
      return {
        messageListBg: listEl ? window.getComputedStyle(listEl).backgroundColor : null,
      };
    });
    console.log("  Mailbox dark mode bg:", mailDarkColors.messageListBg);
    assert(mailDarkColors.messageListBg === "rgb(24, 25, 29)", `Mailbox message-list dark mode bg is rgb(24, 25, 29) (#18191D) (got ${mailDarkColors.messageListBg})`);

    const mailDarkScreenshot = path.join(artifactsDir, 'mailbox_email_list_bg_dark.png');
    await page.screenshot({ path: mailDarkScreenshot });
    console.log(`  Saved screenshot: ${mailDarkScreenshot}`);

    // ── STEP 7: Mobile Viewport Check (375x667) ──
    console.log("\n--- [STEP 7] Verify Mailbox Email List Background on Mobile Viewport (375x667) ---");
    await page.setViewport({ width: 375, height: 667, isMobile: true, hasTouch: true });
    await page.evaluate(() => {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('byos_theme', 'cloud_dancer');
    });
    await sleep(500);

    const mobileMailColors = await page.evaluate(() => {
      const listEl = document.querySelector('[data-testid="message-list"]');
      const rowEl = document.querySelector('[data-testid="message-row"]');
      return {
        messageListBg: listEl ? window.getComputedStyle(listEl).backgroundColor : null,
        messageRowBg: rowEl ? window.getComputedStyle(rowEl).backgroundColor : null,
      };
    });
    console.log("  Mobile Mailbox light mode colors:", JSON.stringify(mobileMailColors, null, 2));
    assert(mobileMailColors.messageListBg === "rgb(255, 255, 255)", `Mobile Mailbox message-list bg is rgb(255, 255, 255) (got ${mobileMailColors.messageListBg})`);
    assert(mobileMailColors.messageRowBg === "rgb(255, 255, 255)", `Mobile Mailbox message-row bg is rgb(255, 255, 255) (got ${mobileMailColors.messageRowBg})`);

    const mobileScreenshot = path.join(artifactsDir, 'mailbox_email_list_bg_mobile.png');
    await page.screenshot({ path: mobileScreenshot });
    console.log(`  Saved screenshot: ${mobileScreenshot}`);

    console.log("\n================================================================================");
    console.log(" ALL MAILBOX BACKGROUND CONSISTENCY VERIFICATIONS PASSED SUCCESSFULLY!          ");
    console.log("================================================================================\n");

  } finally {
    await browser.close();
  }
}

runMailboxBackgroundConsistencyVerification().catch((err) => {
  console.error("FATAL ERROR in runMailboxBackgroundConsistencyVerification:", err);
  process.exit(1);
});
