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

async function runTest() {
  console.log("================================================================================");
  console.log("      SENT RESTRICTIONS, FOLDER ICONS & CUSTOM .MBOX IMPORT VERIFICATION        ");
  console.log("================================================================================\n");

  const consoleLogs = [];
  const networkRequests = [];

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ['--no-sandbox', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    page.on('console', (msg) => {
      consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
    });

    page.on('requestfinished', (req) => {
      networkRequests.push({
        url: req.url(),
        method: req.method(),
        status: req.response() ? req.response().status() : null,
      });
    });

    // ── STEP 1: Login as Alice ──
    console.log("--- 1. Login as Alice (alice@byos.local) ---");
    await page.goto('http://127.0.0.1:3001', { waitUntil: 'networkidle2' });
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(500);

    await page.type('input[autocomplete="username"]', 'alice@byos.local');
    await page.type('input[autocomplete="current-password"]', 'test-password-123');
    await page.click('button[type="submit"]');

    await page.waitForSelector('[data-testid="account-chip-selector"]', { timeout: 15000 });
    assert(true, "Alice logged in successfully and session initialized");

    // ── STEP 2: Verify Modernized Folder Icons in Sidebar ──
    console.log("\n--- 2. Inspecting Modernized Folder Icons ---");
    const iconsData = await page.evaluate(() => {
      const scheduledFolder = document.querySelector('[data-testid="folder-scheduled"]');
      const spamFolder = document.querySelector('[data-testid="folder-spam"]');

      return {
        scheduledSvgHtml: scheduledFolder ? scheduledFolder.querySelector('svg')?.innerHTML || '' : '',
        spamSvgHtml: spamFolder ? spamFolder.querySelector('svg')?.innerHTML || '' : '',
      };
    });

    const isScheduledCalendarClock = iconsData.scheduledSvgHtml.includes('circle') && iconsData.scheduledSvgHtml.includes('rect');
    const isSpamOctagon = iconsData.spamSvgHtml.includes('polygon');

    console.log(`  Scheduled folder SVG contains calendar-clock: ${isScheduledCalendarClock}`);
    console.log(`  Spam folder SVG contains alert-octagon: ${isSpamOctagon}`);

    assert(isScheduledCalendarClock, "Scheduled folder icon modernized with calendar-clock SVG");
    assert(isSpamOctagon, "Spam folder icon modernized with alert-octagon SVG");

    const shotIcons = path.join(artifactsDir, "sent_restrictions_and_mbox_icons.png");
    await page.screenshot({ path: shotIcons });
    console.log(`  Saved screenshot: ${path.relative(process.cwd(), shotIcons)}`);

    // ── STEP 3: Verify Sent Folder Restrictions ──
    console.log("\n--- 3. Verifying Sent Folder Action Restrictions ---");
    await page.click('[data-testid="folder-sent"]');
    await sleep(1500);

    // If Sent folder is empty, send an email to Bob first
    let hasSentMessage = await page.evaluate(() => {
      return document.querySelectorAll('[data-testid="message-row"]').length > 0;
    });

    if (!hasSentMessage) {
      console.log("  No sent message found. Sending quick email to Bob...");
      await page.click('[data-testid="sidebar-compose-btn"]');
      await page.waitForSelector('#composeToInput', { timeout: 5000 });
      await page.type('#composeToInput', 'bob@byos.local');
      await page.keyboard.press('Enter');
      await page.type('#composeSubjectInput', `Sent Restrictions Test ${Date.now()}`);
      await page.click('[data-testid="compose-body-input"]');
      await page.type('[data-testid="compose-body-input"]', 'Verifying sent folder immutability.');

      const sendPromise = page.waitForResponse(
        (res) => (res.url().includes('/v1/outbound/send-internal') || res.url().includes('/v1/outbound/send')) &&
                 res.request().method() === 'POST',
        { timeout: 35000 }
      );
      await page.click('[data-testid="compose-send-btn"]');
      await sendPromise;
      await sleep(2000);
      await page.click('[data-testid="folder-sent"]');
      await sleep(1500);
    }

    // Open first message in Sent folder
    await page.waitForSelector('[data-testid="message-row"]', { timeout: 10000 });
    await page.click('[data-testid="message-row"]');
    await sleep(1000);

    // Verify ReadingPane actions for Sent message:
    // 1. Move to folder button must NOT exist
    // 2. Archive button must NOT exist
    // 3. Overflow menu must NOT contain Snooze or Report Spam
    const sentRestrictions = await page.evaluate(() => {
      const moveToBtn = document.querySelector('[data-testid="move-to-folder-btn"]');
      const archiveBtn = document.querySelector('button[title="Archive"]');
      const overflowBtn = document.querySelector('[data-testid="reading-pane-overflow-btn"]');

      return {
        hasMoveToBtn: Boolean(moveToBtn),
        hasArchiveBtn: Boolean(archiveBtn),
        hasOverflowBtn: Boolean(overflowBtn),
      };
    });

    assert(!sentRestrictions.hasMoveToBtn, "Move to folder button is REMOVED from sent message ReadingPane");
    assert(!sentRestrictions.hasArchiveBtn, "Archive button is REMOVED from sent message ReadingPane");

    // Click overflow menu to inspect snooze & report spam
    if (sentRestrictions.hasOverflowBtn) {
      await page.click('[data-testid="reading-pane-overflow-btn"]');
      await sleep(400);

      const overflowActions = await page.evaluate(() => {
        const snoozeBtn = document.querySelector('[data-testid="reading-pane-snooze-btn"]');
        const reportSpamBtn = document.querySelector('[data-testid="reading-pane-report-spam-btn"]');
        return {
          hasSnooze: Boolean(snoozeBtn),
          hasReportSpam: Boolean(reportSpamBtn),
        };
      });

      assert(!overflowActions.hasSnooze, "Snooze option is REMOVED from sent message overflow menu");
      assert(!overflowActions.hasReportSpam, "Report spam option is REMOVED from sent message overflow menu");

      // Close overflow menu
      await page.keyboard.press('Escape');
      await sleep(300);
    }

    const shotSent = path.join(artifactsDir, "sent_restrictions_reading_pane.png");
    await page.screenshot({ path: shotSent });
    console.log(`  Saved screenshot: ${path.relative(process.cwd(), shotSent)}`);

    // ── STEP 4: Navigate to Settings -> Import & Verify 3 Source Cards ──
    console.log("\n--- 4. Verifying Settings -> Mailbox Import & 3 Provider Cards ---");
    await page.click('[data-testid="sidebar-settings-btn"]');
    await page.waitForSelector('[data-testid="settings-layout"]', { timeout: 10000 });
    await sleep(500);

    await page.click('[data-testid="settings-tab-import"]');
    await page.waitForSelector('[data-testid="import-wizard"]', { timeout: 10000 });
    await sleep(500);

    const providerCards = await page.evaluate(() => {
      const gmail = document.querySelector('[data-testid="provider-card-gmail"]');
      const outlook = document.querySelector('[data-testid="provider-card-outlook"]');
      const customMbox = document.querySelector('[data-testid="provider-card-custom-mbox"]');

      return {
        hasGmail: Boolean(gmail),
        hasOutlook: Boolean(outlook),
        hasCustomMbox: Boolean(customMbox),
      };
    });

    console.log("  Provider cards status:", JSON.stringify(providerCards));
    assert(providerCards.hasGmail, "Google Gmail provider card is present");
    assert(providerCards.hasOutlook, "Microsoft Outlook provider card is present");
    assert(providerCards.hasCustomMbox, "Custom .mbox File provider card is present");

    const shotCards = path.join(artifactsDir, "import_wizard_provider_cards.png");
    await page.screenshot({ path: shotCards });
    console.log(`  Saved screenshot: ${path.relative(process.cwd(), shotCards)}`);

    // ── STEP 5: Select Custom .mbox Provider & Ingest .mbox Archive ──
    console.log("\n--- 5. Configuring and Running Custom .mbox File Import ---");
    await page.click('[data-testid="provider-card-custom-mbox"]');
    await sleep(500);

    // Verify it advanced directly to Step 3 (Configure) without OAuth popup!
    await page.waitForSelector('[data-testid="mbox-file-input"]', { timeout: 5000 });
    await page.waitForSelector('[data-testid="mbox-target-folder-select"]', { timeout: 5000 });
    assert(true, "Advanced directly to .mbox configuration step (OAuth authorization bypassed)");

    // Upload test_emails.mbox
    const sampleMboxPath = path.resolve(__dirname, 'test_emails.mbox');
    const fileInput = await page.$('input[data-testid="mbox-file-input"]');
    assert(Boolean(fileInput), "Found mbox file input element");
    await fileInput.uploadFile(sampleMboxPath);
    await sleep(500);

    // Verify file is selected and start button enabled
    const fileSelectedState = await page.evaluate(() => {
      const startBtn = document.querySelector('[data-testid="start-mbox-import-btn"]');
      return {
        disabled: startBtn ? startBtn.disabled : true,
        text: document.querySelector('[data-testid="import-wizard"]')?.innerText || '',
      };
    });

    assert(!fileSelectedState.disabled, "Start .mbox Import button is enabled with selected file");
    assert(fileSelectedState.text.includes('test_emails.mbox'), "File details render uploaded .mbox filename");

    // Click Start Import
    console.log("  Starting in-browser zero-knowledge .mbox import...");
    await page.click('[data-testid="start-mbox-import-btn"]');

    // Wait for Step 5 Summary
    await page.waitForSelector('[data-testid="return-inbox-btn"]', { timeout: 20000 });
    await sleep(1000);

    const summaryData = await page.evaluate(() => {
      const wizardText = document.querySelector('[data-testid="import-wizard"]')?.innerText || '';
      return {
        text: wizardText,
        isCompleted: wizardText.includes('Import Completed'),
      };
    });

    console.log("  Summary text snippet:", summaryData.text.slice(0, 150));
    assert(summaryData.isCompleted, "Import summary indicates 'Import Completed'");

    const shotSummary = path.join(artifactsDir, "custom_mbox_import_summary.png");
    await page.screenshot({ path: shotSummary });
    console.log(`  Saved screenshot: ${path.relative(process.cwd(), shotSummary)}`);

    // ── STEP 6: DevTools State Dump ──
    console.log("\n--- 6. DevTools State Dump ---");
    const storageDump = await page.evaluate(() => {
      const local = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        local[k] = localStorage.getItem(k)?.slice(0, 80);
      }
      const session = {};
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        session[k] = sessionStorage.getItem(k)?.slice(0, 80);
      }
      return { localStorage: local, sessionStorage: session };
    });

    console.log("localStorage keys:", Object.keys(storageDump.localStorage));
    console.log("sessionStorage keys:", Object.keys(storageDump.sessionStorage));
    console.log(`Recorded ${consoleLogs.length} console messages`);
    console.log(`Recorded ${networkRequests.length} network requests`);

    // Click Return to Inbox
    await page.click('[data-testid="return-inbox-btn"]');
    await sleep(1000);

    console.log("\n================================================================================");
    console.log("     ALL SENT RESTRICTIONS & CUSTOM .MBOX IMPORT BROWSER CHECKS PASSED!        ");
    console.log("================================================================================");
  } finally {
    await browser.close();
  }
}

runTest().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
