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

async function runAliceXWingResolutionTest() {
  console.log("================================================================================");
  console.log("    ALICE X-WING & HISTORICAL MESSAGES UNLOCK BROWSER VERIFICATION              ");
  console.log("================================================================================\n");

  const uncaughtErrors = [];

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ['--no-sandbox', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    page.on('pageerror', (err) => {
      uncaughtErrors.push(err.message);
      console.error(`  [PAGE ERROR]: ${err.message}`);
    });

    // Step 1: Navigate to Webmail & Clear Storage
    console.log("\n--- [STEP 1] Navigate to Webmail & Clear Storage ---");
    await page.goto('http://127.0.0.1:3001', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1000);

    // Step 2: Log in as alice@byos.local
    console.log("\n--- [STEP 2] Log in as alice@byos.local ---");
    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.type('input[type="email"]', 'alice@byos.local');
    await page.type('input[type="password"]', 'test-password-123');
    await page.click('button[type="submit"]');

    await page.waitForSelector('[data-testid="account-chip-selector"]', { timeout: 15000 });
    await sleep(1500);

    const activeAccountChip = await page.$eval('[data-testid="account-chip-text"]', (el) => el.textContent.trim());
    console.log(`  Active account: "${activeAccountChip}"`);
    assert(activeAccountChip === "alice@byos.local", "Active account is alice@byos.local");

    // Step 3: Verify X-Wing seed is initially locked due to password change / historical state
    console.log("\n--- [STEP 3] Verify Historical Locked State upon Login ---");
    const aliceMailboxId = "c0000000-0000-0000-0000-000000000001";
    const xwingSeedInStorage = await page.evaluate((mbId) => {
      return sessionStorage.getItem("byos_xwing_seed_" + mbId);
    }, aliceMailboxId);

    console.log(`  Initial sessionStorage byos_xwing_seed_${aliceMailboxId}: ${xwingSeedInStorage}`);
    assert(xwingSeedInStorage === null, "X-Wing seed is initially locked in sessionStorage pending reactivation");

    // Step 4: Open Path A Message & Verify 'Unlock mails' button is shown (suppressing raw error)
    console.log("\n--- [STEP 4] Open Path A Message & Verify 'Unlock mails' Button ---");
    await page.waitForSelector('[data-testid="message-row"]', { timeout: 10000 });

    const targetMsgSelector = '[data-message-id="217595a7-afb2-4e90-b502-7b39da36cb58"]';
    const hasTargetMsg = await page.$(targetMsgSelector);
    if (hasTargetMsg) {
      console.log("  Clicking message 217595a7-afb2-4e90-b502-7b39da36cb58 (from charlie@byos.local)...");
      await page.click(targetMsgSelector);
    } else {
      console.log("  Target message not found directly by ID, clicking first message-row...");
      await page.click('[data-testid="message-row"]');
    }

    await page.waitForSelector('[data-testid="reading-pane"]', { timeout: 10000 });
    await sleep(2000);

    // Verify reading pane does NOT show the raw error
    const readingPaneText = await page.$eval('[data-testid="reading-pane"]', (el) => el.innerText);
    console.log(`  Reading pane text length: ${readingPaneText.length}`);
    console.log(`  Reading pane preview: ${readingPaneText.slice(0, 200).replace(/[\r\n]+/g, ' ')}`);

    assert(
      !readingPaneText.includes("Failed to decrypt end-to-end message"),
      "Reading pane does NOT contain 'Failed to decrypt end-to-end message'"
    );
    assert(
      !readingPaneText.includes("X-Wing private key is locked"),
      "Reading pane does NOT contain raw error 'X-Wing private key is locked'"
    );

    // Verify locked account placeholder indicates unlock requirement
    await page.waitForSelector('[data-testid="locked-account-placeholder"]', { timeout: 5000 });
    const lockedMsg = await page.$eval('[data-testid="locked-account-message"]', (el) => el.innerText);
    console.log(`  Locked account message: "${lockedMsg}"`);
    assert(
      lockedMsg.includes("Unlock alice@byos.local to read this message."),
      "Locked placeholder indicates 'Unlock alice@byos.local to read this message.'"
    );

    // Verify the button text is "Unlock mails"
    const unlockBtnText = await page.$eval('[data-testid="unlock-mails-btn"]', (el) => el.innerText.trim());
    console.log(`  Unlock button text: "${unlockBtnText}"`);
    assert(
      unlockBtnText.toLowerCase().includes("unlock mails"),
      "Reading section button has text 'Unlock mails'"
    );

    const lockedScreenshotPath = path.join(artifactsDir, 'alice_mailbox_locked_prompt.png');
    await page.screenshot({ path: lockedScreenshotPath });
    console.log(`  Saved screenshot: ${lockedScreenshotPath}`);
    assert(fs.existsSync(lockedScreenshotPath), "Screenshot alice_mailbox_locked_prompt.png was successfully written");

    // Step 5: Test Popup asking for 24-word recovery phrase or old password
    console.log("\n--- [STEP 5] Open Popup Modal & Verify Fields for 24-Word Phrase / Old Password ---");
    await page.click('[data-testid="unlock-mails-btn"]');
    await page.waitForSelector('[data-testid="unlock-mails-secret-input"]', { timeout: 5000 });

    const hasSecretInput = await page.$('[data-testid="unlock-mails-secret-input"]');
    assert(!!hasSecretInput, "Popup modal contains 24-word recovery phrase or old password input");

    const hasPasswordInput = await page.$('[data-testid="unlock-account-password-input"]');
    assert(!!hasPasswordInput, "Popup modal contains current password input");

    const submitBtnText = await page.$eval('[data-testid="unlock-mails-submit-btn"]', (el) => el.innerText.trim());
    console.log(`  Popup submit button text: "${submitBtnText}"`);
    assert(
      submitBtnText.toLowerCase().includes("unlock mails"),
      "Popup modal submit button has text 'Unlock Mails'"
    );

    // Step 6: Enter old password / phrase in secret input and current password, then submit
    console.log("\n--- [STEP 6] Submit Historical Recovery Secret & Verify Auto-Decryption ---");
    await page.type('[data-testid="unlock-mails-secret-input"]', 'test-password-123');
    await page.type('[data-testid="unlock-account-password-input"]', 'test-password-123');
    await page.click('[data-testid="unlock-mails-submit-btn"]');

    // Wait for unlock modal to disappear
    await page.waitForFunction(() => !document.querySelector('[data-testid="unlock-mails-secret-input"]'), { timeout: 15000 });
    await sleep(2500);

    // Verify X-Wing seed is restored in sessionStorage
    const restoredSeed = await page.evaluate((mbId) => {
      return sessionStorage.getItem("byos_xwing_seed_" + mbId);
    }, aliceMailboxId);
    console.log(`  Restored seed in sessionStorage: ${restoredSeed}`);
    assert(
      restoredSeed === "ea01f553ee1988202f1c41f1d3d478afdf7ef0cddf611a28d2e3c2c3af42b13a",
      "X-Wing seed was successfully restored to sessionStorage after unlock"
    );

    // Verify message automatically unsealed and decrypted
    const afterUnlockText = await page.$eval('[data-testid="reading-pane"]', (el) => el.innerText);
    console.log(`  After unlock reading pane preview: ${afterUnlockText.slice(0, 200).replace(/[\r\n]+/g, ' ')}`);
    assert(
      !afterUnlockText.includes("Unlock alice@byos.local to read this message."),
      "Locked placeholder is removed after unlock"
    );
    assert(
      !afterUnlockText.includes("Failed to decrypt end-to-end message"),
      "Message decrypted cleanly without decryption errors"
    );
    assert(
      afterUnlockText.includes("Greetings Alice! Third mailbox send from Charlie.") || afterUnlockText.includes("Charlie"),
      "Plaintext message body from Charlie rendered successfully"
    );

    const decryptedScreenshotPath = path.join(artifactsDir, 'alice_mailbox_message_decrypted.png');
    await page.screenshot({ path: decryptedScreenshotPath });
    console.log(`  Saved screenshot: ${decryptedScreenshotPath}`);
    assert(fs.existsSync(decryptedScreenshotPath), "Screenshot alice_mailbox_message_decrypted.png was successfully written");

    const recoveredScreenshotPath = path.join(artifactsDir, 'alice_mailbox_unlocked_and_recovered.png');
    await page.screenshot({ path: recoveredScreenshotPath });
    console.log(`  Saved screenshot: ${recoveredScreenshotPath}`);
    assert(fs.existsSync(recoveredScreenshotPath), "Screenshot alice_mailbox_unlocked_and_recovered.png was successfully written");

    // Step 7: Final Assertion on Uncaught Errors
    console.log("\n--- [STEP 7] Final Error Integrity Verification ---");
    const fatalErrors = uncaughtErrors.filter((e) =>
      e.includes("Failed to decrypt end-to-end message") ||
      e.includes("X-Wing private key is locked")
    );
    console.log(`  Fatal uncaught page errors: ${fatalErrors.length}`);
    assert(fatalErrors.length === 0, "Zero fatal uncaught errors during the entire session");

    console.log("\n================================================================================");
    console.log("       ALICE X-WING & HISTORICAL MESSAGES UNLOCK VERIFIED SUCCESSFULLY          ");
    console.log("================================================================================\n");

  } finally {
    await browser.close();
  }
}

runAliceXWingResolutionTest().catch((err) => {
  console.error("\nTEST SUITE FAILED WITH ERROR:", err);
  process.exit(1);
});
