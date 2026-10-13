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

async function runSentDisplayTest() {
  console.log("================================================================================");
  console.log("             SENT FOLDER & READING PANE RECIPIENT DISPLAY TEST                  ");
  console.log("================================================================================\n");

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ['--no-sandbox', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    // Step 1: Login as Alice
    console.log("--- [STEP 1] Login as Alice (alice@byos.local) ---");
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
    assert(true, "Alice logged in successfully");

    // Step 2: Compose and send an email to Bob
    console.log("\n--- [STEP 2] Compose and send email to Bob (bob@byos.local) ---");
    await page.click('[data-testid="sidebar-compose-btn"]');
    await page.waitForSelector('#composeToInput', { timeout: 5000 });
    await page.type('#composeToInput', 'bob@byos.local');
    await page.keyboard.press('Enter');

    const uniqueSubject = `Sent Display Verification ${Date.now()}`;
    await page.type('#composeSubjectInput', uniqueSubject);

    // Focus editor and type body
    await page.click('[data-testid="compose-body-input"]');
    await page.type('[data-testid="compose-body-input"]', 'Testing from Alice to Bob in sent folder.');

    // Set up send promise for internal delivery (undo window is 5s, so send occurs after ~5s)
    const sendPromise = page.waitForResponse(
      (res) => (res.url().includes('/v1/outbound/send-internal') || res.url().includes('/v1/outbound/send')) &&
               res.request().method() === 'POST',
      { timeout: 35000 }
    );

    await page.click('[data-testid="compose-send-btn"]');
    console.log("  Sent clicked; waiting for 5s undo window + outbound dispatch...");
    const sendRes = await sendPromise;
    console.log(`  Outbound send response status: ${sendRes.status()}`);
    assert(sendRes.status() === 201 || sendRes.status() === 200, "Sent message dispatched successfully");
    await sleep(2000);

    // Step 3: Navigate to Sent folder
    console.log("\n--- [STEP 3] Navigate to Sent folder ---");
    await page.click('[data-testid="folder-sent"]');
    await sleep(2000);

    // Wait for message row with uniqueSubject
    await page.waitForSelector('[data-testid="message-row"]', { timeout: 10000 });
    const rowElements = await page.$$('[data-testid="message-row"]');
    assert(rowElements.length > 0, "Found message rows in Sent folder");

    // Check row text for 'To: bob@byos.local'
    const allRows = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('[data-testid="message-row"]')).map((r) => r.textContent);
    });
    console.log("Sent folder rows:", JSON.stringify(allRows, null, 2));

    const targetRowData = await page.evaluate((subj) => {
      const rows = Array.from(document.querySelectorAll('[data-testid="message-row"]'));
      for (const row of rows) {
        if (row.textContent?.includes(subj)) {
          return {
            text: row.textContent || '',
            hasToPrefix: row.textContent?.includes('To: bob@byos.local') || row.textContent?.includes('To: Bob'),
          };
        }
      }
      return null;
    }, uniqueSubject);

    assert(targetRowData !== null, "Found sent message row for target subject");
    assert(targetRowData.hasToPrefix, `Message row includes 'To: ' prefix (got text: "${targetRowData.text.slice(0, 80)}")`);

    const shot1 = path.join(artifactsDir, "sent_folder_list.png");
    await page.screenshot({ path: shot1 });
    console.log(`  Screenshot saved: ${shot1}`);

    // Step 4: Click the message row to open in ReadingPane
    console.log("\n--- [STEP 4] Open Sent message in ReadingPane ---");
    const targetRowHandle = await page.evaluateHandle((subj) => {
      const rows = Array.from(document.querySelectorAll('[data-testid="message-row"]'));
      return rows.find((r) => r.textContent?.includes(subj));
    }, uniqueSubject);

    if (targetRowHandle && targetRowHandle.asElement()) {
      await targetRowHandle.asElement().click();
    }
    await page.waitForSelector('[data-testid="reading-pane"]', { timeout: 8000 });
    await sleep(1000);

    // Step 5: Assert ReadingPane shows 'from Alice' and 'to bob@byos.local' (NOT 'to alice@byos.local')
    console.log("\n--- [STEP 5] Assert ReadingPane sender & recipient headers ---");
    const headerInfo = await page.evaluate(() => {
      const pane = document.querySelector('[data-testid="reading-pane"]');
      if (!pane) return null;
      const text = pane.textContent || '';
      return {
        text,
        hasFromAlice: text.includes('from') && (text.includes('Alice') || text.includes('alice@byos.local')),
        hasToBob: text.includes('to bob@byos.local') || text.includes('to Bob'),
        hasIncorrectToAlice: text.includes('to alice@byos.local'),
      };
    });

    assert(headerInfo !== null, "Reading pane loaded");
    assert(headerInfo.hasFromAlice, "Reading pane indicates 'from' Alice");
    assert(headerInfo.hasToBob, "Reading pane indicates 'to' Bob");
    assert(!headerInfo.hasIncorrectToAlice, "Reading pane does NOT say 'to alice@byos.local' (no x to x bug)");

    // Step 6: Expand details dropdown to verify from: and to: fields
    console.log("\n--- [STEP 6] Expand details dropdown and verify from / to fields ---");
    // Click the recipient summary button to open details dropdown
    await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="reading-pane"] .relative.mt-0\\.5 button');
      if (btn) btn.click();
    });
    await sleep(500);

    const dropdownInfo = await page.evaluate(() => {
      const pane = document.querySelector('[data-testid="reading-pane"]');
      if (!pane) return null;
      const text = pane.textContent || '';
      return {
        hasFromField: text.includes('from:') && text.includes('alice@byos.local'),
        hasToField: text.includes('to:') && text.includes('bob@byos.local'),
        hasWrongToField: text.includes('to:') && text.includes('to:\nalice@byos.local'),
      };
    });

    assert(dropdownInfo?.hasFromField, "Dropdown displays 'from: alice@byos.local'");
    assert(dropdownInfo?.hasToField, "Dropdown displays 'to: bob@byos.local'");

    const shot2 = path.join(artifactsDir, "sent_reading_pane.png");
    await page.screenshot({ path: shot2 });
    console.log(`  Screenshot saved: ${shot2}`);

    console.log("\n================================================================================");
    console.log("            SENT FOLDER DISPLAY VERIFICATION PASSED PERFECTLY                   ");
    console.log("================================================================================\n");

  } finally {
    await browser.close();
  }
}

runSentDisplayTest().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
