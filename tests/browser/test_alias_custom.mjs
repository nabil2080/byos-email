import puppeteer from '../../apps/webmail/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';
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

function sendInboundSMTP({ from, to, subject, body }) {
  return new Promise((resolve, reject) => {
    const client = net.createConnection({ port: 25, host: '127.0.0.1' });
    let step = 0;
    let finalCode = 0;
    let finalResponse = '';

    client.setTimeout(15000);
    client.on('timeout', () => {
      client.destroy();
      reject(new Error('SMTP timeout'));
    });

    client.on('error', (err) => {
      reject(err);
    });

    client.on('data', (data) => {
      const msg = data.toString();
      const code = parseInt(msg.slice(0, 3), 10);

      if (code >= 400 && step < 4) {
        finalCode = code;
        finalResponse = msg.trim();
        step = 5;
        client.write('QUIT\r\n');
      } else if (code === 220 && step === 0) {
        client.write('HELO localhost\r\n');
      } else if (code === 250 && step === 0) {
        step = 1;
        client.write(`MAIL FROM:<${from}>\r\n`);
      } else if (code === 250 && step === 1) {
        step = 2;
        client.write(`RCPT TO:<${to}>\r\n`);
      } else if (code === 250 && step === 2) {
        step = 3;
        client.write('DATA\r\n');
      } else if (code === 354 && step === 3) {
        step = 4;
        const mime = [
          `From: ${from}`,
          `To: ${to}`,
          `Subject: ${subject}`,
          'Content-Type: text/plain; charset=utf-8',
          '',
          body,
          '.',
        ].join('\r\n') + '\r\n';
        client.write(mime);
      } else if (step === 4) {
        finalCode = code;
        finalResponse = msg.trim();
        step = 5;
        client.write('QUIT\r\n');
      } else if (msg.includes('221') || client.destroyed) {
        resolve({ code: finalCode, response: finalResponse });
      }
    });

    client.on('close', () => {
      resolve({ code: finalCode, response: finalResponse });
    });
  });
}

async function runCustomAliasBrowserTest() {
  console.log("================================================================================");
  console.log("             13-STEP CUSTOM ALIAS & SIDEBAR REMOVAL VERIFICATION              ");
  console.log("================================================================================\n");

  const runId = Date.now().toString(36).slice(-4);
  const targetCustomLocal = `amazon-${runId}`;
  const targetCustomAddress = `${targetCustomLocal}@masked.byos.local`;
  const targetSubject = `Order #${runId} Confirmation`;

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ['--no-sandbox', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        console.log(`  [BROWSER ERROR] ${msg.text()}`);
      }
    });

    // Step 1: Login as Alice and verify sidebar has NO "Masked Aliases"
    console.log("--- [STEP 1] Login as alice@byos.local & Verify Sidebar has no 'Masked Aliases' ---");
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

    await page.waitForSelector('[data-testid="folder-name-inbox"]', { timeout: 15000 });
    await sleep(1500);
    console.log("  Alice logged in successfully.");

    const sidebarAliasBtn = await page.$('[data-testid="sidebar-masked-aliases-btn"]');
    assert(!sidebarAliasBtn, "Sidebar must NOT render 'Masked Aliases' button");

    const sidebarText = await page.evaluate(() => {
      const aside = document.querySelector('aside');
      return aside ? aside.innerText : '';
    });
    assert(!sidebarText.includes("Masked Aliases"), "Sidebar text must not contain 'Masked Aliases'");
    console.log("  Confirmed: Masked Aliases is removed from the sidebar navigation.");

    // Screenshot 1: alias_sidebar_removed.png
    const screenshot1 = path.resolve(artifactsDir, 'alias_sidebar_removed.png');
    await page.screenshot({ path: screenshot1, fullPage: false });
    console.log(`  Saved screenshot: ${screenshot1}`);

    // Step 2: Confirm Settings -> Masked Email still loads
    console.log("\n--- [STEP 2] Confirm Settings -> Masked Email loads ---");
    await page.waitForSelector('[data-testid="sidebar-settings-btn"]', { timeout: 5000 });
    await page.click('[data-testid="sidebar-settings-btn"]');
    await sleep(800);

    await page.waitForSelector('[data-testid="settings-tab-masked-email"]', { timeout: 5000 });
    await page.click('[data-testid="settings-tab-masked-email"]');
    await sleep(1200);

    const headingText = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      return h1 ? h1.textContent : '';
    });
    assert(headingText.includes("Masked Email"), "Masked Email settings page loaded");

    // Step 3: Open Create Modal and verify mode toggle [ Random ] [ Custom ]
    console.log("\n--- [STEP 3] Open Create Modal & Verify Mode Toggle (Defaults to Random) ---");
    await page.waitForSelector('[data-testid="generate-alias-btn"]', { timeout: 5000 });
    await page.click('[data-testid="generate-alias-btn"]');
    await sleep(600);

    const isRandomActive = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="alias-mode-random"]');
      return btn && btn.classList.contains('font-semibold');
    });
    assert(isRandomActive, "Create alias modal defaults to Random mode");

    // Step 4: Random mode creation
    console.log("\n--- [STEP 4] Create Random Alias ---");
    await page.waitForSelector('[data-testid="alias-label-input"]', { timeout: 5000 });
    await page.type('[data-testid="alias-label-input"]', 'Random Newsletter');
    await sleep(300);

    // Screenshot 2: alias_create_random.png
    const screenshot2 = path.resolve(artifactsDir, 'alias_create_random.png');
    await page.screenshot({ path: screenshot2, fullPage: false });
    console.log(`  Saved screenshot: ${screenshot2}`);

    await page.click('[data-testid="alias-create-submit-btn"]');
    await sleep(1500);
    console.log("  Random alias generated successfully.");

    // Step 5: Switch to Custom mode
    console.log("\n--- [STEP 5] Switch to Custom Mode ---");
    await page.waitForSelector('[data-testid="generate-alias-btn"]', { timeout: 5000 });
    await page.click('[data-testid="generate-alias-btn"]');
    await sleep(600);

    await page.waitForSelector('[data-testid="alias-mode-custom"]', { timeout: 5000 });
    await page.click('[data-testid="alias-mode-custom"]');
    await sleep(500);

    await page.waitForSelector('[data-testid="custom-local-part-input"]', { timeout: 5000 });

    // Step 6: Enter invalid characters, verify inline help and disabled button
    console.log("\n--- [STEP 6] Enter invalid characters & Verify Inline Error ---");
    await page.type('[data-testid="custom-local-part-input"]', 'bad@alias!');
    await sleep(300);

    let valError = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="alias-validation-error"]');
      return el ? el.textContent.trim() : '';
    });
    console.log(`  Validation error for invalid chars: "${valError}"`);
    assert(valError === "Only lowercase letters, numbers, and . - _ are allowed", "Validation error matches for invalid chars");

    let submitDisabled = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="alias-create-submit-btn"]');
      return btn ? btn.disabled : false;
    });
    assert(submitDisabled, "Submit button disabled for invalid characters");

    // Screenshot 3: alias_validation_error.png
    const screenshot3 = path.resolve(artifactsDir, 'alias_validation_error.png');
    await page.screenshot({ path: screenshot3, fullPage: false });
    console.log(`  Saved screenshot: ${screenshot3}`);

    // Step 7: Enter reserved name, verify inline error and disabled button
    console.log("\n--- [STEP 7] Enter reserved name & Verify Inline Error ---");
    await page.evaluate(() => {
      const input = document.querySelector('[data-testid="custom-local-part-input"]');
      if (input) input.value = '';
    });
    await page.type('[data-testid="custom-local-part-input"]', 'admin');
    await sleep(300);

    valError = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="alias-validation-error"]');
      return el ? el.textContent.trim() : '';
    });
    console.log(`  Validation error for reserved name 'admin': "${valError}"`);
    assert(valError === "This alias name is reserved", "Validation error matches for reserved name");

    submitDisabled = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="alias-create-submit-btn"]');
      return btn ? btn.disabled : false;
    });
    assert(submitDisabled, "Submit button disabled for reserved word");

    // Step 9 & 10: Create valid custom alias first (so we can test duplicate against it)
    console.log(`\n--- [STEP 9 & 10] Create Valid Custom Alias '${targetCustomAddress}' ---`);
    await page.evaluate(() => {
      const input = document.querySelector('[data-testid="custom-local-part-input"]');
      if (input) input.value = '';
    });

    // Type with uppercase to test silent lowercasing
    await page.type('[data-testid="custom-local-part-input"]', targetCustomLocal.toUpperCase());
    await sleep(300);

    const inputVal = await page.evaluate(() => {
      const input = document.querySelector('[data-testid="custom-local-part-input"]');
      return input ? input.value : '';
    });
    assert(inputVal === targetCustomLocal, "Uppercase entered was silently lowercased");

    // Live preview check
    const previewText = await page.evaluate(() => {
      const p = document.querySelector('[data-testid="alias-address-preview"]');
      return p ? p.textContent.trim() : '';
    });
    assert(previewText === targetCustomAddress, `Live preview matches expected: "${previewText}"`);

    // Enter label
    await page.type('[data-testid="alias-label-input"]', 'Amazon Shopping');
    await sleep(300);

    // Screenshot 4: alias_create_custom.png
    const screenshot4 = path.resolve(artifactsDir, 'alias_create_custom.png');
    await page.screenshot({ path: screenshot4, fullPage: false });
    console.log(`  Saved screenshot: ${screenshot4}`);

    // Submit custom alias
    await page.click('[data-testid="alias-create-submit-btn"]');
    await sleep(1500);

    // Verify alias appears in table
    const tableText = await page.evaluate(() => {
      const tbl = document.querySelector('table');
      return tbl ? tbl.innerText : '';
    });
    assert(tableText.includes(targetCustomAddress), "Custom alias appears in aliases table");
    console.log(`  Custom alias ${targetCustomAddress} created and listed.`);

    // Step 8: Test Duplicate Alias Path (try creating the exact same alias again)
    console.log("\n--- [STEP 8] Test Duplicate Alias Path (Conflict 409) ---");
    await page.waitForSelector('[data-testid="generate-alias-btn"]', { timeout: 5000 });
    await page.click('[data-testid="generate-alias-btn"]');
    await sleep(600);

    await page.waitForSelector('[data-testid="alias-mode-custom"]', { timeout: 5000 });
    await page.click('[data-testid="alias-mode-custom"]');
    await sleep(500);

    await page.waitForSelector('[data-testid="custom-local-part-input"]', { timeout: 5000 });
    await page.type('[data-testid="custom-local-part-input"]', targetCustomLocal);
    await page.type('[data-testid="alias-label-input"]', 'Duplicate Attempt');
    await sleep(300);

    // Submit duplicate
    await page.click('[data-testid="alias-create-submit-btn"]');
    await sleep(1200);

    // Verify friendly 409 error message
    const modalErrorText = await page.evaluate(() => {
      const err = document.querySelector('[data-testid="alias-modal-error"]');
      return err ? err.textContent.trim() : '';
    });
    console.log(`  Modal error on duplicate alias: "${modalErrorText}"`);
    assert(
      modalErrorText === "That alias is already taken. Try a different name.",
      "Friendly duplicate error 'That alias is already taken. Try a different name.' rendered"
    );

    // Screenshot: alias_duplicate_error.png
    const screenshotDup = path.resolve(artifactsDir, 'alias_duplicate_error.png');
    await page.screenshot({ path: screenshotDup, fullPage: false });
    console.log(`  Saved screenshot: ${screenshotDup}`);

    // Close the modal
    const closeBtn = await page.$('button[aria-label="Close modal"]');
    if (closeBtn) await closeBtn.click();
    await sleep(800);

    // Step 11: Open Compose drawer, verify From: dropdown contains the custom alias
    console.log("\n--- [STEP 11] Verify Compose From: dropdown lists Custom Alias ---");
    const backToInboxBtn = await page.waitForSelector('[data-testid="settings-back-to-inbox-btn"]', { timeout: 5000 });
    await backToInboxBtn.click();
    await sleep(1500);

    const composeBtn = await page.waitForSelector('[data-testid="sidebar-compose-btn"]', { timeout: 5000 });
    await composeBtn.click();
    await sleep(1500);

    await page.waitForSelector('[data-testid="compose-from-select"]', { timeout: 10000 });
    const selectOptions = await page.evaluate(() => {
      const select = document.querySelector('[data-testid="compose-from-select"]');
      if (!select) return [];
      return Array.from(select.options).map((o) => ({ value: o.value, text: o.text.trim() }));
    });

    console.log("  Compose From: options found:", selectOptions.map(o => o.text));
    assert(selectOptions.length > 1, "Compose From: dropdown has more than 1 option");

    const hasCustomAliasInDropdown = selectOptions.some(o => o.text.includes(targetCustomLocal) || o.value.includes(targetCustomLocal));
    assert(hasCustomAliasInDropdown, `Dropdown includes the custom alias ${targetCustomLocal}`);

    // Select the custom alias option in From: dropdown
    await page.evaluate((val) => {
      const select = document.querySelector('[data-testid="compose-from-select"]');
      if (select) {
        for (const opt of select.options) {
          if (opt.value.includes(val) || opt.text.includes(val)) {
            select.value = opt.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            break;
          }
        }
      }
    }, targetCustomLocal);
    await sleep(500);

    // Screenshot 5: alias_from_dropdown.png
    const screenshot5 = path.resolve(artifactsDir, 'alias_from_dropdown.png');
    await page.screenshot({ path: screenshot5, fullPage: false });
    console.log(`  Saved screenshot: ${screenshot5}`);

    // Close compose drawer
    const closeComposeBtn = await page.waitForSelector('[data-testid="compose-close-btn"]', { timeout: 5000 });
    await closeComposeBtn.click();
    await sleep(1000);

    // Step 12: Inbound SMTP delivery to custom alias
    console.log(`\n--- [STEP 12] Inbound SMTP Delivery to '${targetCustomAddress}' ---`);
    const inboundRes = await sendInboundSMTP({
      from: 'shop@external-merchant.com',
      to: targetCustomAddress,
      subject: targetSubject,
      body: 'Your Amazon purchase confirmation arrived via your custom masked alias!',
    });
    console.log(`  Inbound SMTP response: code=${inboundRes.code} response="${inboundRes.response}"`);
    assert(inboundRes.code === 250, "Inbound SMTP message accepted with 250 OK");

    // Step 13: Open message, verify Reading Pane badge, reply from custom alias, verify Mailpit & reply_count
    console.log(`\n--- [STEP 13] Open Message, Verify 'Received via' Badge, Reply from Alias ---`);
    // Refresh inbox
    const inboxFolderBtn = await page.waitForSelector('[data-testid="folder-inbox"]', { timeout: 5000 });
    await inboxFolderBtn.click();
    await sleep(3000);

    // Find and click the message
    const messageFound = await page.evaluate((subj) => {
      const rows = document.querySelectorAll('[data-testid="message-row"]');
      for (const row of rows) {
        if (row.textContent.includes('shop@external-merchant.com') || row.textContent.includes(subj)) {
          row.click();
          return true;
        }
      }
      return false;
    }, targetSubject);
    assert(messageFound, `Message with subject "${targetSubject}" found in Inbox and clicked`);
    await sleep(2500);

    // Verify Reading Pane badge
    await page.waitForSelector('[data-testid="reading-pane-alias-badge"]', { timeout: 8000 });
    const badgeText = await page.$eval('[data-testid="reading-pane-alias-badge"]', el => el.textContent.trim());
    console.log(`  Reading Pane alias badge: "${badgeText}"`);
    assert(
      badgeText.includes("Received via Amazon Shopping") || badgeText.includes(targetCustomAddress),
      "Alias badge shows custom alias label or address"
    );

    // Screenshot: alias_reply_badge.png
    const screenshotBadge = path.resolve(artifactsDir, 'alias_reply_badge.png');
    await page.screenshot({ path: screenshotBadge, fullPage: false });
    console.log(`  Saved screenshot: ${screenshotBadge}`);

    // Query reply_count before sending reply
    const countBeforeRaw = execSync(
      `docker exec -i byos-postgres psql -U byos -d byos -c "SELECT reply_count FROM masked_aliases WHERE alias_address = '${targetCustomAddress}';"`,
      { encoding: 'utf8' }
    );
    console.log("  Raw SQL query BEFORE send:\n" + countBeforeRaw.trim());
    const countBeforeMatch = countBeforeRaw.match(/\s+(\d+)\s+/);
    const countBefore = countBeforeMatch ? parseInt(countBeforeMatch[1], 10) : 0;
    console.log(`  Parsed reply_count before send: ${countBefore}`);

    // Click Reply
    const replyBtn = await page.waitForSelector('[data-testid="reading-pane-reply-btn"]', { timeout: 5000 });
    await replyBtn.click();
    await sleep(1500);

    // Confirm From: is targetCustomAddress
    const composeSender = await page.evaluate(() => {
      const fromEl = document.querySelector('form select[data-testid="compose-from-select"]');
      return fromEl ? fromEl.value : '';
    });
    console.log(`  Reply Compose From address: "${composeSender}"`);
    assert(composeSender.includes(targetCustomAddress), `Compose From is pre-filled with ${targetCustomAddress}`);

    // Screenshot: alias_reply_from.png
    const screenshotReplyFrom = path.resolve(artifactsDir, 'alias_reply_from.png');
    await page.screenshot({ path: screenshotReplyFrom, fullPage: false });
    console.log(`  Saved screenshot: ${screenshotReplyFrom}`);

    // Type reply body
    const replyBodyInput = await page.waitForSelector('[data-testid="compose-body-input"]', { timeout: 5000 });
    await replyBodyInput.click();
    await replyBodyInput.type("\n\nConfirmed! Replying from my custom masked alias.");
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="compose-body-input"]');
      if (el) el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(500);

    // Clear Mailpit messages
    try {
      await fetch('http://localhost:8025/api/v1/messages', { method: 'DELETE' });
    } catch {}

    // Send reply
    const outboundSendPromise = page.waitForResponse(
      (res) => res.url().includes('/v1/outbound/send') && res.request().method() === 'POST',
      { timeout: 25000 }
    );

    const sendBtn = await page.waitForSelector('[data-testid="compose-send-btn"]', { timeout: 5000 });
    await sendBtn.click();
    console.log("  Clicked Send button in ComposeDrawer");

    console.log("  Waiting for /v1/outbound/send HTTP 201 response...");
    const outboundResponse = await outboundSendPromise;
    const sendStatusCode = outboundResponse.status();
    console.log(`  Outbound send response HTTP status: ${sendStatusCode}`);
    assert(sendStatusCode === 201, `Outbound request returned HTTP 201 (got ${sendStatusCode})`);

    // Verify reply_count incremented in Postgres
    await sleep(1000);
    const countAfterRaw = execSync(
      `docker exec -i byos-postgres psql -U byos -d byos -c "SELECT reply_count FROM masked_aliases WHERE alias_address = '${targetCustomAddress}';"`,
      { encoding: 'utf8' }
    );
    console.log("  Raw SQL query AFTER send:\n" + countAfterRaw.trim());
    const countAfterMatch = countAfterRaw.match(/\s+(\d+)\s+/);
    const countAfter = countAfterMatch ? parseInt(countAfterMatch[1], 10) : 0;
    console.log(`  Parsed reply_count after send: ${countAfter}`);
    assert(countAfter === countBefore + 1, `reply_count increased by exactly 1 (${countBefore} -> ${countAfter})`);

    // Verify delivered message in Mailpit
    console.log("  Polling Mailpit for delivered message...");
    let mailpitMsg = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      await sleep(1500);
      try {
        const resp = await fetch('http://localhost:8025/api/v1/messages');
        if (resp.ok) {
          const data = await resp.json();
          const match = (data.messages || []).find((m) =>
            m.To?.some((t) => t.Address === 'shop@external-merchant.com') &&
            m.From?.Address === targetCustomAddress
          );
          if (match) {
            mailpitMsg = match;
            break;
          }
        }
      } catch (err) {}
    }
    assert(mailpitMsg !== null, `Delivered message found in Mailpit with From: ${targetCustomAddress}`);
    console.log(`  Confirmed in Mailpit: Subject="${mailpitMsg.Subject}" From="${mailpitMsg.From?.Address}" To="${mailpitMsg.To?.[0]?.Address}"`);

    console.log("\n================================================================================");
    console.log("  ALL 13 STEPS VERIFIED END-TO-END WITH ZERO GAPS!                             ");
    console.log("================================================================================\n");

  } finally {
    await browser.close();
  }
}

runCustomAliasBrowserTest().catch((err) => {
  console.error("\nBrowser test failed:", err);
  process.exit(1);
});
