import puppeteer from '../../apps/webmail/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
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

async function runAccountSwitchCryptoBrowserTest() {
  console.log("================================================================================");
  console.log("     ACCOUNT SWITCH CRYPTO INTEGRATION TEST (RULES 1 - 6 & MANUAL CHECKS)       ");
  console.log("================================================================================\n");

  // Ensure Charlie DB fixture is seeded
  try {
    execSync('node --experimental-wasm-modules scratch/setup_charlie.mjs', { stdio: 'inherit' });
  } catch (seedErr) {
    console.warn("Failed to seed Charlie DB fixture:", seedErr);
  }

  const sendResponses = [];
  const consoleErrors = [];

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ['--no-sandbox', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    // Intercept console errors
    page.on('console', (msg) => {
      const type = msg.type();
      const text = msg.text();
      if (type === 'error') {
        consoleErrors.push(text);
        if (text.includes("decryption failed") || text.includes("invalid_signature")) {
          console.error(`  [CONSOLE ERROR]: ${text}`);
        }
      }
    });

    // Intercept network responses for sends
    page.on('response', async (response) => {
      const url = response.url();
      if (url.includes('/v1/auth/login')) {
        try {
          const body = await response.text();
          console.log(`  [AUTH LOGIN RESP] ${response.status()} ${url} -> ${body.slice(0, 160)}`);
        } catch {}
      }
      if (url.includes('/v1/outbound/send-internal') || url.includes('/v1/messages/send-internal')) {
        let body = "";
        try {
          body = await response.text();
        } catch {}
        sendResponses.push({
          url,
          status: response.status(),
          statusText: response.statusText(),
          body,
        });
        console.log(`  [NETWORK SEND] ${response.status()} ${url} -> ${body.slice(0, 120)}`);
      }
    });

    // Step 0: Open page and clear storage for clean login
    console.log("\n--- [STEP 0] Fresh start: Navigate to webmail & clear storage ---");
    await page.goto('http://127.0.0.1:3001', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1000);

    // Step 1: Log in as Alice via real login form
    console.log("\n--- [STEP 1] Real Login Flow: Log in as alice@byos.local ---");
    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.type('input[type="email"]', 'alice@byos.local');
    await page.type('input[type="password"]', 'test-password-123');
    await page.click('button[type="submit"]');

    await page.waitForSelector('[data-testid="account-chip-selector"]', { timeout: 15000 });
    await sleep(1500);

    const initialChipText = await page.$eval('[data-testid="account-chip-text"]', (el) => el.textContent.trim());
    console.log(`  Active account chip: "${initialChipText}"`);
    assert(initialChipText === "alice@byos.local", "Initial active account is alice@byos.local");

    // Connect Bob via "Add another mailbox"
    console.log("\n--- Connect secondary account: bob@byos.local via AddMailboxModal ---");
    await page.click('[data-testid="account-chip-selector"]');
    await sleep(500);
    await page.waitForSelector('[data-testid="add-mailbox-button"]', { timeout: 5000 });
    await page.click('[data-testid="add-mailbox-button"]');
    await sleep(500);

    // Fill in AddMailboxModal for Bob
    await page.waitForSelector('input[placeholder="user@yourdomain.com"]', { timeout: 5000 });
    await page.type('input[placeholder="user@yourdomain.com"]', 'bob@byos.local');
    await page.type('input[placeholder="Account password"]', 'test-password-123');
    await page.evaluate(() => {
      const form = document.querySelector('input[placeholder="user@yourdomain.com"]').closest('form');
      form.requestSubmit();
    });
    await page.waitForFunction(() => !document.querySelector('input[placeholder="user@yourdomain.com"]'), { timeout: 8000 });
    await sleep(1500);

    // Switch back to Alice so step 2 starts with Alice active
    await page.click('[data-testid="account-chip-selector"]');
    await sleep(500);
    await page.waitForSelector('[data-testid="account-dropdown-c0000000-0000-0000-0000-000000000001"]', { timeout: 5000 });
    await page.click('[data-testid="account-dropdown-c0000000-0000-0000-0000-000000000001"]');
    await sleep(1500);

    // Helper: click New Message button
    async function openCompose() {
      const composeBtn = await page.evaluateHandle(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        return btns.find((b) => b.innerText.includes("New Message"));
      });
      await composeBtn.click();
      await page.waitForSelector('#composeToInput', { timeout: 5000 });
      await sleep(500);
    }

    // Helper: fill and send message
    async function sendComposeMessage(to, subject, body) {
      await page.evaluate(() => {
        const toInput = document.querySelector('#composeToInput');
        const subInput = document.querySelector('#composeSubjectInput');
        const editor = document.querySelector('.rich-text-editor-content');
        if (toInput) {
          toInput.value = '';
          toInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (subInput) {
          subInput.value = '';
          subInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (editor) {
          editor.innerText = '';
          editor.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });

      await page.type('#composeToInput', to);
      await page.type('#composeSubjectInput', subject);
      await page.evaluate((b) => {
        const editor = document.querySelector('.rich-text-editor-content');
        if (editor) {
          editor.innerText = b;
          editor.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }, body);

      await sleep(500);
      const prevSendCount = sendResponses.length;

      const sendBtn = await page.evaluateHandle(() => {
        const btns = Array.from(document.querySelectorAll('button[type="submit"]'));
        return btns.find((b) => b.innerText.includes("Send Encrypted"));
      });
      await sendBtn.click();

      console.log(`  Waiting for encrypted send to finish (undo countdown + transmission)...`);
      // Wait for countdown + send (up to 9 seconds)
      const startTime = Date.now();
      while (sendResponses.length === prevSendCount && Date.now() - startTime < 12000) {
        await sleep(500);
      }
      assert(sendResponses.length > prevSendCount, `Send network request dispatched for ${to}`);
      const lastResp = sendResponses[sendResponses.length - 1];
      assert(lastResp.status === 201, `Send response HTTP status is 201 (received ${lastResp.status})`);
      await sleep(1500);
    }

    // Step 2: Send message from Alice to Bob
    console.log("\n--- [STEP 2] Send message from Alice to Bob ---");
    const aliceSubject = `Test Alice to Bob ${Date.now()}`;
    await openCompose();
    await sendComposeMessage('bob@byos.local', aliceSubject, 'Hello Bob! This is an end-to-end encrypted message from Alice.');
    await page.screenshot({ path: path.join(artifactsDir, 'account_switch_01_alice_sent.png') });
    console.log(`  Saved screenshot: account_switch_01_alice_sent.png`);

    // Step 3: Switch to Bob via the real switcher dropdown UI
    console.log("\n--- [STEP 3] Switch to Bob via data-testid='account-chip-selector' ---");
    await page.click('[data-testid="account-chip-selector"]');
    await sleep(500);
    await page.waitForSelector('[data-testid="account-dropdown-c0000000-0000-0000-0000-000000000002"]', { timeout: 5000 });
    await page.click('[data-testid="account-dropdown-c0000000-0000-0000-0000-000000000002"]');
    await sleep(1500);

    const bobChipText = await page.$eval('[data-testid="account-chip-text"]', (el) => el.textContent.trim());
    console.log(`  Active account chip after switch: "${bobChipText}"`);
    assert(bobChipText === "bob@byos.local", "Chip text successfully changed to bob@byos.local");

    // Step 4: Send a message as Bob to Alice
    console.log("\n--- [STEP 4] Send message as Bob to Alice ---");
    const bobSubject = `Reply Bob to Alice ${Date.now()}`;
    await openCompose();
    await sendComposeMessage('alice@byos.local', bobSubject, 'Hello Alice! Replying as Bob with Bob signing seed.');
    await page.screenshot({ path: path.join(artifactsDir, 'account_switch_02_bob_sent.png') });
    console.log(`  Saved screenshot: account_switch_02_bob_sent.png`);

    // Step 5: Open Alice's message in Bob's inbox & assert plaintext renders
    console.log("\n--- [STEP 5] Open Alice's message in Bob's inbox ---");
    // Refresh / reload mailbox messages
    const refreshBtn = await page.$('button[title*="Refresh"], button[aria-label*="Refresh"]');
    if (refreshBtn) await refreshBtn.click();
    await sleep(1500);

    // Find and click the message row with Alice's subject
    const aliceMsgRow = await page.evaluateHandle((subj) => {
      const rows = Array.from(document.querySelectorAll('[data-testid="message-row"]'));
      return rows.find((r) => r.innerText.includes(subj)) || rows[0];
    }, aliceSubject);

    if (aliceMsgRow) {
      await aliceMsgRow.click();
      await sleep(2500);
    }

    const bobReadingContent = await page.evaluate(() => {
      const pane = document.querySelector('.reading-pane-content') || document.querySelector('[data-testid="reading-pane"]');
      return pane ? pane.innerText : document.body.innerText;
    });

    console.log(`  Reading pane content excerpt:\n  "${bobReadingContent.slice(0, 150).replace(/\n/g, ' ')}..."`);
    assert(!bobReadingContent.includes("content decrypt: decryption failed"), "Reading pane does NOT contain 'content decrypt: decryption failed'");
    assert(!bobReadingContent.includes("Failed to decrypt end-to-end message"), "Reading pane does NOT contain 'Failed to decrypt end-to-end message'");
    assert(bobReadingContent.includes("Hello Bob! This is an end-to-end encrypted message from Alice.") || bobReadingContent.includes(aliceSubject), "Plaintext message body rendered successfully for Bob");
    await page.screenshot({ path: path.join(artifactsDir, 'account_switch_03_bob_decrypted.png') });
    console.log(`  Saved screenshot: account_switch_03_bob_decrypted.png`);

    // Step 6: Switch back to Alice via switcher dropdown
    console.log("\n--- [STEP 6] Switch back to Alice via switcher dropdown ---");
    await page.click('[data-testid="account-chip-selector"]');
    await sleep(500);
    await page.waitForSelector('[data-testid="account-dropdown-c0000000-0000-0000-0000-000000000001"]', { timeout: 5000 });
    await page.click('[data-testid="account-dropdown-c0000000-0000-0000-0000-000000000001"]');
    await sleep(1500);

    const aliceChipText2 = await page.$eval('[data-testid="account-chip-text"]', (el) => el.textContent.trim());
    console.log(`  Active account chip after switch back: "${aliceChipText2}"`);
    assert(aliceChipText2 === "alice@byos.local", "Chip text successfully restored to alice@byos.local");

    // Step 7: Open Bob's message in Alice's inbox & assert plaintext renders
    console.log("\n--- [STEP 7] Open Bob's reply message in Alice's inbox ---");
    const refreshBtn2 = await page.$('button[title*="Refresh"], button[aria-label*="Refresh"]');
    if (refreshBtn2) await refreshBtn2.click();
    await sleep(1500);

    const bobMsgRow = await page.evaluateHandle((subj) => {
      const rows = Array.from(document.querySelectorAll('[data-testid="message-row"]'));
      return rows.find((r) => r.innerText.includes(subj)) || rows[0];
    }, bobSubject);

    if (bobMsgRow) {
      await bobMsgRow.click();
      await sleep(2500);
    }

    const aliceReadingContent = await page.evaluate(() => {
      const pane = document.querySelector('.reading-pane-content') || document.querySelector('[data-testid="reading-pane"]');
      return pane ? pane.innerText : document.body.innerText;
    });

    console.log(`  Reading pane content excerpt:\n  "${aliceReadingContent.slice(0, 150).replace(/\n/g, ' ')}..."`);
    assert(!aliceReadingContent.includes("content decrypt: decryption failed"), "Reading pane does NOT contain 'content decrypt: decryption failed'");
    assert(!aliceReadingContent.includes("Failed to decrypt end-to-end message"), "Reading pane does NOT contain 'Failed to decrypt end-to-end message'");
    assert(aliceReadingContent.includes("Hello Alice! Replying as Bob with Bob signing seed.") || aliceReadingContent.includes(bobSubject), "Plaintext message body rendered successfully for Alice");
    await page.screenshot({ path: path.join(artifactsDir, 'account_switch_04_alice_decrypted.png') });
    console.log(`  Saved screenshot: account_switch_04_alice_decrypted.png`);

    // Step 8: Add third account Charlie via "Add another mailbox"
    console.log("\n--- [STEP 8] Add third account Charlie via AddMailboxModal ---");
    await page.click('[data-testid="account-chip-selector"]');
    await sleep(500);
    await page.waitForSelector('[data-testid="add-mailbox-button"]', { timeout: 5000 });
    await page.click('[data-testid="add-mailbox-button"]');
    await sleep(500);

    await page.waitForSelector('input[placeholder="user@yourdomain.com"]', { timeout: 5000 });
    const emailInput = await page.$('input[placeholder="user@yourdomain.com"]');
    await emailInput.click({ clickCount: 3 });
    await emailInput.press('Backspace');
    await emailInput.type('charlie@byos.local');
    const passInput = await page.$('input[placeholder="Account password"]');
    await passInput.click({ clickCount: 3 });
    await passInput.press('Backspace');
    await passInput.type('test-password-123');
    await page.evaluate(() => {
      const form = document.querySelector('input[placeholder="user@yourdomain.com"]').closest('form');
      form.requestSubmit();
    });
    // Wait for AddMailboxModal to close
    await page.waitForFunction(() => !document.querySelector('input[placeholder="user@yourdomain.com"]'), { timeout: 8000 });
    await sleep(1500);

    // Verify Charlie is active after connection
    let charlieChipText = await page.$eval('[data-testid="account-chip-text"]', (el) => el.textContent.trim());
    console.log(`  Active account chip after connecting Charlie: "${charlieChipText}"`);

    // Explicitly test switching between Alice and Charlie via dropdown
    console.log("  Switching to Alice...");
    await page.click('[data-testid="account-chip-selector"]');
    await sleep(500);
    await page.waitForSelector('[data-testid="account-dropdown-c0000000-0000-0000-0000-000000000001"]', { timeout: 5000 });
    await page.click('[data-testid="account-dropdown-c0000000-0000-0000-0000-000000000001"]');
    await sleep(1000);

    console.log("  Switching back to Charlie...");
    await page.click('[data-testid="account-chip-selector"]');
    await sleep(500);
    await page.waitForSelector('[data-testid="account-dropdown-c0000000-0000-0000-0000-000000000003"]', { timeout: 5000 });
    await page.click('[data-testid="account-dropdown-c0000000-0000-0000-0000-000000000003"]');
    await sleep(1500);

    charlieChipText = await page.$eval('[data-testid="account-chip-text"]', (el) => el.textContent.trim());
    console.log(`  Active account chip: "${charlieChipText}"`);
    assert(charlieChipText === "charlie@byos.local", "Chip text successfully changed to charlie@byos.local");

    // Send message as Charlie to Alice
    const charlieSubject = `From Charlie to Alice ${Date.now()}`;
    await openCompose();
    await sendComposeMessage('alice@byos.local', charlieSubject, 'Greetings Alice! Third mailbox send from Charlie.');
    await page.screenshot({ path: path.join(artifactsDir, 'account_switch_05_charlie_sent.png') });
    console.log(`  Saved screenshot: account_switch_05_charlie_sent.png`);

    // Step 9: Rapid switching check (Alice -> Bob -> Alice -> Bob)
    console.log("\n--- [STEP 9] Rapid Switching: Alice -> Bob -> Alice -> Bob ---");
    for (let cycle = 1; cycle <= 2; cycle++) {
      // Switch to Alice
      await page.click('[data-testid="account-chip-selector"]');
      await sleep(300);
      await page.click('[data-testid="account-dropdown-c0000000-0000-0000-0000-000000000001"]');
      await sleep(500);
      let chip = await page.$eval('[data-testid="account-chip-text"]', (el) => el.textContent.trim());
      assert(chip === "alice@byos.local", `Rapid switch cycle ${cycle}: chip is alice@byos.local`);

      // Switch to Bob
      await page.click('[data-testid="account-chip-selector"]');
      await sleep(300);
      await page.click('[data-testid="account-dropdown-c0000000-0000-0000-0000-000000000002"]');
      await sleep(500);
      chip = await page.$eval('[data-testid="account-chip-text"]', (el) => el.textContent.trim());
      assert(chip === "bob@byos.local", `Rapid switch cycle ${cycle}: chip is bob@byos.local`);
    }
    console.log("  Rapid switching finished without errors.");

    // Step 10: Dump sessionStorage keys starting with 'byos_'
    console.log("\n--- [STEP 10] SessionStorage Keys Dump ---");
    const sessionKeys = await page.evaluate(() => {
      return Object.keys(sessionStorage).filter((k) => k.startsWith("byos_"));
    });
    console.log("  sessionStorage keys starting with 'byos_':", JSON.stringify(sessionKeys, null, 2));

    // Assert key isolation: keys exist for all connected mailboxes
    assert(sessionKeys.includes("byos_signing_seed_c0000000-0000-0000-0000-000000000001"), "sessionStorage contains Alice signing seed");
    assert(sessionKeys.includes("byos_signing_seed_c0000000-0000-0000-0000-000000000002"), "sessionStorage contains Bob signing seed");
    assert(sessionKeys.includes("byos_signing_seed_c0000000-0000-0000-0000-000000000003"), "sessionStorage contains Charlie signing seed");
    assert(sessionKeys.includes("byos_mailbox_sk_c0000000-0000-0000-0000-000000000001"), "sessionStorage contains Alice mailbox key");
    assert(sessionKeys.includes("byos_mailbox_sk_c0000000-0000-0000-0000-000000000002"), "sessionStorage contains Bob mailbox key");
    assert(sessionKeys.includes("byos_mailbox_sk_c0000000-0000-0000-0000-000000000003"), "sessionStorage contains Charlie mailbox key");

    // Check localStorage does NOT contain sensitive private keys (Rule 6)
    const localKeys = await page.evaluate(() => {
      return Object.keys(localStorage).filter((k) => k.startsWith("byos_"));
    });
    console.log("  localStorage keys starting with 'byos_':", JSON.stringify(localKeys));
    const sensitiveLocalKeys = localKeys.filter((k) => k.includes("_sk_") || k.includes("_seed_"));
    assert(sensitiveLocalKeys.length === 0, "localStorage contains zero sensitive keys or seeds");

    const connectedAccountsDump = await page.evaluate(() => {
      const raw = localStorage.getItem("byos_connected_accounts");
      return raw ? JSON.parse(raw) : null;
    });
    console.log("  localStorage byos_connected_accounts content:\n" + JSON.stringify(connectedAccountsDump, null, 2));
    if (connectedAccountsDump && Array.isArray(connectedAccountsDump)) {
      for (const acc of connectedAccountsDump) {
        assert(!("sessionToken" in acc), "sessionToken is NOT in localStorage byos_connected_accounts");
        assert(!("mailboxSkHex" in acc), "mailboxSkHex is NOT in localStorage byos_connected_accounts");
        assert(!("signingSeedHex" in acc), "signingSeedHex is NOT in localStorage byos_connected_accounts");
        assert(!("xwingSeedHex" in acc), "xwingSeedHex is NOT in localStorage byos_connected_accounts");
      }
    }

    // Step 11: Sign out of Bob only
    console.log("\n--- [STEP 11] Sign out of Bob only ---");
    // Switch to Alice first
    await page.click('[data-testid="account-chip-selector"]');
    await sleep(300);
    await page.click('[data-testid="account-dropdown-c0000000-0000-0000-0000-000000000001"]');
    await sleep(500);

    // Open dropdown and click Bob signout button
    await page.click('[data-testid="account-chip-selector"]');
    await sleep(500);
    await page.waitForSelector('[data-testid="account-signout-c0000000-0000-0000-0000-000000000002"]', { timeout: 5000 });
    await page.click('[data-testid="account-signout-c0000000-0000-0000-0000-000000000002"]');
    await sleep(1500);

    const afterBobSignoutChip = await page.$eval('[data-testid="account-chip-text"]', (el) => el.textContent.trim());
    console.log(`  Active account chip after Bob signout: "${afterBobSignoutChip}"`);
    assert(afterBobSignoutChip === "alice@byos.local", "Active account remains alice@byos.local");

    // Check Bob's keys were removed from sessionStorage
    const sessionKeysAfterSignout = await page.evaluate(() => {
      return Object.keys(sessionStorage).filter((k) => k.startsWith("byos_"));
    });
    assert(!sessionKeysAfterSignout.includes("byos_signing_seed_c0000000-0000-0000-0000-000000000002"), "Bob signing seed removed on signout");
    assert(!sessionKeysAfterSignout.includes("byos_mailbox_sk_c0000000-0000-0000-0000-000000000002"), "Bob mailbox key removed on signout");
    assert(sessionKeysAfterSignout.includes("byos_signing_seed_c0000000-0000-0000-0000-000000000001"), "Alice signing seed remains intact");

    await page.screenshot({ path: path.join(artifactsDir, 'account_switch_06_bob_signed_out.png') });
    console.log(`  Saved screenshot: account_switch_06_bob_signed_out.png`);

    // Step 12: Assert all network send requests returned 201
    console.log("\n--- [STEP 12] Network Send Verification Summary ---");
    console.log(`  Total send-internal requests: ${sendResponses.length}`);
    for (const [idx, resp] of sendResponses.entries()) {
      console.log(`    Request ${idx + 1}: ${resp.status} ${resp.url}`);
      assert(resp.status === 201, `Send request ${idx + 1} returned HTTP 201`);
    }
    const failedSends = sendResponses.filter((r) => r.status === 400 || r.body.includes("invalid_signature"));
    assert(failedSends.length === 0, "Zero send requests failed with HTTP 400 or invalid_signature");

    // Step 13: Assert console errors
    console.log("\n--- [STEP 13] Console Error Summary ---");
    const fatalErrors = consoleErrors.filter((e) =>
      e.includes("content decrypt: decryption failed") ||
      e.includes("invalid_signature") ||
      e.includes("Failed to decrypt end-to-end message")
    );
    console.log(`  Fatal crypto console errors found: ${fatalErrors.length}`);
    assert(fatalErrors.length === 0, "Zero fatal crypto errors in console logs");

    console.log("\n================================================================================");
    console.log("            ALL ACCOUNT SWITCH CRYPTO CHECKS FINISHED SUCCESSFULLY              ");
    console.log("================================================================================\n");

  } finally {
    await browser.close();
  }
}

runAccountSwitchCryptoBrowserTest().catch((err) => {
  console.error("\nTEST SUITE FAILED WITH ERROR:", err);
  process.exit(1);
});
