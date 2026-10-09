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

async function runMaskedEmailBrowserTest() {
  console.log("================================================================================");
  console.log("             MASKED EMAIL / BURNER ALIASES (V1) INTEGRATION TEST                ");
  console.log("================================================================================\n");

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

    page.on('response', (res) => {
      if (res.status() >= 400) {
        console.log(`  [HTTP ${res.status()}] ${res.request().method()} ${res.url()}`);
      }
    });

    // Step 1: Fresh start & Login as Alice
    console.log("--- [STEP 1] Real Login Flow: Navigate & authenticate as alice@byos.local ---");
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

    // Step 2: Verify Sidebar does NOT have Masked Aliases, then open Settings > Masked Email
    console.log("\n--- [STEP 2] Verify Sidebar and Open Masked Email via Settings ---");
    const sidebarAliasBtn = await page.$('[data-testid="sidebar-masked-aliases-btn"]');
    assert(!sidebarAliasBtn, "Sidebar must NOT have Masked Aliases button");
    console.log("  Confirmed: 'Masked Aliases' is removed from the sidebar.");

    // Screenshot sidebar without Masked Aliases
    const sidebarScreenshotPath = path.resolve(artifactsDir, 'masked_email_sidebar_clean.png');
    await page.screenshot({ path: sidebarScreenshotPath, fullPage: false });
    console.log(`  Captured screenshot: ${sidebarScreenshotPath}`);

    // Navigate to Settings
    await page.waitForSelector('[data-testid="sidebar-settings-btn"]', { timeout: 5000 });
    await page.click('[data-testid="sidebar-settings-btn"]');
    await sleep(800);

    // Click Masked Email tab
    await page.waitForSelector('[data-testid="settings-tab-masked-email"]', { timeout: 5000 });
    await page.click('[data-testid="settings-tab-masked-email"]');
    await sleep(1200);

    const headingText = await page.evaluate(() => {
      const h1 = document.querySelector('h1');
      return h1 ? h1.textContent : '';
    });
    assert(headingText.includes("Masked Email"), "Masked Email header visible");

    // Screenshot 1: Masked Email tab view
    const tabScreenshotPath = path.resolve(artifactsDir, 'masked_email_tab.png');
    await page.screenshot({ path: tabScreenshotPath, fullPage: false });
    console.log(`  Captured screenshot: ${tabScreenshotPath}`);

    // Step 3: Open Create Modal & Test Custom Mode
    console.log("\n--- [STEP 3] Open Create Modal & Test Custom Mode ---");
    const generateBtn = await page.waitForSelector('[data-testid="generate-alias-btn"]', { timeout: 5000 });
    await generateBtn.click();
    await sleep(800);

    // Toggle to Custom mode
    const customModeBtn = await page.waitForSelector('[data-testid="alias-mode-custom"]', { timeout: 5000 });
    await customModeBtn.click();
    await sleep(500);

    // Verify custom input is visible
    await page.waitForSelector('[data-testid="custom-local-part-input"]', { timeout: 5000 });

    // Test invalid characters and validation
    await page.type('[data-testid="custom-local-part-input"]', 'bad@alias!');
    await sleep(500);
    const hasValidationError = await page.evaluate(() => {
      const err = document.querySelector('[data-testid="alias-validation-error"]');
      return err ? err.textContent.trim() : '';
    });
    console.log(`  Validation message for invalid input: "${hasValidationError}"`);
    assert(hasValidationError.length > 0, "Validation error displayed for invalid characters");

    // Check submit button is disabled
    const isSubmitDisabled = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="alias-create-submit-btn"]');
      return btn ? btn.disabled : false;
    });
    assert(isSubmitDisabled, "Create button is disabled while input is invalid");

    const runId = Date.now().toString(36).slice(-6);
    const targetCustomLocal = `amazon-${runId}`;
    const targetCustomAddress = `${targetCustomLocal}@masked.byos.local`;
    const targetSubject = `Order #${runId} Confirmation`;

    // Clear input and enter valid custom name with uppercase to test silent lowercase
    await page.evaluate(() => {
      const input = document.querySelector('[data-testid="custom-local-part-input"]');
      if (input) input.value = '';
    });
    await page.type('[data-testid="custom-local-part-input"]', `AMAZON-${runId.toUpperCase()}`);
    await sleep(500);

    // Verify lowercase
    const inputVal = await page.evaluate(() => {
      const input = document.querySelector('[data-testid="custom-local-part-input"]');
      return input ? input.value : '';
    });
    console.log(`  Input value after typing uppercase: "${inputVal}"`);
    assert(inputVal === targetCustomLocal, "Uppercase characters were silently lowercased");

    // Verify preview
    const previewText = await page.evaluate(() => {
      const prev = document.querySelector('[data-testid="alias-address-preview"]');
      return prev ? prev.textContent.trim() : '';
    });
    console.log(`  Live address preview: "${previewText}"`);
    assert(previewText === targetCustomAddress, "Live preview shows full address");

    // Enter label
    await page.type('[data-testid="alias-label-input"]', 'Amazon Shopping');

    // Screenshot: Custom alias modal
    const customModalScreenshotPath = path.resolve(artifactsDir, 'masked_email_custom_modal.png');
    await page.screenshot({ path: customModalScreenshotPath, fullPage: false });
    console.log(`  Captured screenshot: ${customModalScreenshotPath}`);

    // Step 4: Submit custom alias and verify table row
    console.log("\n--- [STEP 4] Submit custom alias and verify table row ---");
    const submitBtn = await page.waitForSelector('[data-testid="alias-create-submit-btn"]', { timeout: 5000 });
    await submitBtn.click();
    await sleep(2000);

    // Look for alias in table
    await page.waitForSelector('table tbody tr', { timeout: 8000 });
    const aliasAddress = await page.evaluate(() => {
      const firstRow = document.querySelector('table tbody tr');
      const addressSpan = firstRow?.querySelector('td font-mono, td .select-all');
      return addressSpan ? addressSpan.textContent.trim() : '';
    });

    console.log(`  Created custom alias address: "${aliasAddress}"`);
    assert(aliasAddress === targetCustomAddress, "Custom alias address matches created value");

    // Step 5: Test Copy to clipboard
    console.log("\n--- [STEP 5] Copy alias to clipboard ---");
    const copyBtn = await page.$('button[title="Copy to clipboard"]');
    assert(copyBtn !== null, "Copy button exists");
    await copyBtn.click();
    await sleep(500);

    const copiedTooltip = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('div')).some(el => el.textContent.includes("Copied!"));
    });
    assert(copiedTooltip, "Copied! tooltip appeared on click");

    // Step 5b: Verify Compose From: dropdown lists alias
    console.log("\n--- [STEP 5b] Verify Compose From: dropdown lists alias ---");
    const backToInboxBtn = await page.waitForSelector('[data-testid="settings-back-to-inbox-btn"]', { timeout: 5000 });
    await backToInboxBtn.click();
    await sleep(1500);

    // Open Compose drawer
    const composeBtn = await page.waitForSelector('[data-testid="sidebar-compose-btn"]', { timeout: 5000 });
    await composeBtn.click();
    await sleep(1500);

    // Check compose From: select
    await page.waitForSelector('[data-testid="compose-from-select"]', { timeout: 5000 });
    const fromOptions = await page.evaluate(() => {
      const select = document.querySelector('[data-testid="compose-from-select"]');
      if (!select) return [];
      return Array.from(select.querySelectorAll('option')).map(opt => ({
        value: opt.value,
        text: opt.textContent.trim(),
      }));
    });
    console.log("  Compose From options:", JSON.stringify(fromOptions));
    assert(
      fromOptions.some(opt => opt.text.includes(aliasAddress)),
      `Compose From: dropdown includes alias ${aliasAddress}`
    );

    // Screenshot Compose From dropdown
    const composeFromScreenshotPath = path.resolve(artifactsDir, 'masked_email_compose_from_dropdown.png');
    await page.screenshot({ path: composeFromScreenshotPath, fullPage: false });
    console.log(`  Captured screenshot: ${composeFromScreenshotPath}`);

    // Close compose
    const closeComposeBtn = await page.waitForSelector('[data-testid="compose-close-btn"]', { timeout: 5000 });
    await closeComposeBtn.click();
    await sleep(1000);

    // Step 6: Inbound SMTP delivery to alias
    console.log(`\n--- [STEP 6] Inbound SMTP delivery to alias ${aliasAddress} ---`);
    const inboundRes = await sendInboundSMTP({
      from: 'shop@external-merchant.com',
      to: aliasAddress,
      subject: targetSubject,
      body: 'Your purchase has been confirmed via your masked alias!',
    });
    console.log(`  Inbound SMTP result: code=${inboundRes.code} response="${inboundRes.response}"`);
    assert(inboundRes.code === 250, "Inbound SMTP accepted (250 OK)");

    // Step 7: Back to Inbox & Verify Message with Reading Pane Badge
    console.log("\n--- [STEP 7] Navigate to Inbox & Open received message ---");
    // If settings view is open, click Back to Inbox button
    const backBtn = await page.$('[data-testid="settings-back-to-inbox-btn"]');
    if (backBtn) {
      await backBtn.click();
      await sleep(1500);
    }

    // Refresh inbox messages
    const inboxFolderBtn = await page.waitForSelector('[data-testid="folder-inbox"]', { timeout: 5000 });
    await inboxFolderBtn.click();
    await sleep(3000);

    // Find message from sender "shop@external-merchant.com" or subject
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
    assert(messageFound, "Message found in Inbox and clicked");
    await sleep(2000);

    // Verify Reading Pane badge "Received via Shopping Test" or alias address
    await page.waitForSelector('[data-testid="reading-pane-alias-badge"]', { timeout: 8000 });
    const badgeText = await page.$eval('[data-testid="reading-pane-alias-badge"]', el => el.textContent.trim());
    console.log(`  Reading Pane alias badge: "${badgeText}"`);
    assert(badgeText.includes("Received via Shopping Test") || badgeText.includes("Received via Amazon Shopping") || badgeText.includes(aliasAddress), "Alias badge contains label or address");

    // Screenshot 3: Reading Pane badge
    const readingBadgeScreenshotPath = path.resolve(artifactsDir, 'masked_email_reading_pane_badge.png');
    await page.screenshot({ path: readingBadgeScreenshotPath, fullPage: false });
    console.log(`  Captured screenshot: ${readingBadgeScreenshotPath}`);

    // Step 8: Outbound reply-from-alias end-to-end verification
    console.log("\n--- [STEP 8] Outbound Reply from Alias verification ---");
    const replyBtn = await page.waitForSelector('[data-testid="reading-pane-reply-btn"]', { timeout: 5000 });
    await replyBtn.click();
    await sleep(1500);

    const composeSender = await page.evaluate(() => {
      const fromEl = document.querySelector('form .select-all, form select[data-testid="compose-from-select"]');
      return fromEl ? (fromEl.value || fromEl.textContent.trim()) : '';
    });
    console.log(`  Compose From address: "${composeSender}"`);
    assert(composeSender.includes(aliasAddress), `Compose From pre-filled with alias address ${aliasAddress}`);

    // Gap 3: Query reply_count before sending reply
    console.log("\n--- [GAP 3] Query reply_count before sending reply ---");
    const countBeforeRaw = execSync(
      `docker exec -i byos-postgres psql -U byos -d byos -c "SELECT reply_count FROM masked_aliases WHERE alias_address = '${aliasAddress}';"`,
      { encoding: 'utf8' }
    );
    console.log("Raw SQL query output BEFORE send:\n" + countBeforeRaw);
    const countBeforeMatch = countBeforeRaw.match(/\s+(\d+)\s+/);
    const countBefore = countBeforeMatch ? parseInt(countBeforeMatch[1], 10) : 0;
    console.log(`  Parsed reply_count before send: ${countBefore}`);

    // Gap 1: 1. Fill the reply body
    console.log("\n--- [GAP 1] Fill reply body and click Send ---");
    const replyBodyInput = await page.waitForSelector('[data-testid="compose-body-input"]', { timeout: 5000 });
    await replyBodyInput.click();
    await replyBodyInput.type("\n\nThank you for the order! Replying from my masked alias to confirm receipt.");
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="compose-body-input"]');
      if (el) el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(500);

    // Clear out Mailpit messages so only our new outbound message arrives
    try {
      await fetch('http://localhost:8025/api/v1/messages', { method: 'DELETE' });
    } catch {}

    // Gap 1: 2. Click Send & 3. Wait for outbound request, assert HTTP 201
    const outboundSendPromise = page.waitForResponse(
      (res) => res.url().includes('/v1/outbound/send') && res.request().method() === 'POST',
      { timeout: 25000 }
    );

    const sendBtn = await page.waitForSelector('[data-testid="compose-send-btn"]', { timeout: 5000 });
    await sendBtn.click();
    console.log("  Clicked Send button in ComposeDrawer");

    console.log("  Waiting for /v1/outbound/send response (undo send countdown + encryption)...");
    const outboundResponse = await outboundSendPromise;
    const sendStatusCode = outboundResponse.status();
    console.log(`  Outbound send response HTTP status: ${sendStatusCode}`);
    assert(sendStatusCode === 201, `Outbound request returned HTTP 201 (got ${sendStatusCode})`);
    const outboundJson = await outboundResponse.json();
    console.log("  Outbound send response payload:", JSON.stringify(outboundJson));
    assert(outboundJson.delivery_id, "Outbound response contains delivery_id");

    // Gap 3: Query reply_count after sending reply and assert incremented by exactly 1
    console.log("\n--- [GAP 3] Query reply_count after sending reply ---");
    const countAfterRaw = execSync(
      `docker exec -i byos-postgres psql -U byos -d byos -c "SELECT reply_count FROM masked_aliases WHERE alias_address = '${aliasAddress}';"`,
      { encoding: 'utf8' }
    );
    console.log("Raw SQL query output AFTER send:\n" + countAfterRaw);
    const countAfterMatch = countAfterRaw.match(/\s+(\d+)\s+/);
    const countAfter = countAfterMatch ? parseInt(countAfterMatch[1], 10) : 0;
    console.log(`  Parsed reply_count after send: ${countAfter}`);
    assert(countAfter === countBefore + 1, `reply_count increased by exactly 1 (${countBefore} -> ${countAfter})`);

    // Gap 1: 4. Fetch the delivered message from Mailpit at http://localhost:8025/api/v1/message/{id}
    console.log("\n--- [GAP 1] Fetch delivered message from Mailpit ---");
    let mailpitMsgId = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      await sleep(1500);
      try {
        const resp = await fetch('http://localhost:8025/api/v1/messages');
        if (resp.ok) {
          const data = await resp.json();
          const match = (data.messages || []).find((m) =>
            m.To?.some((t) => t.Address === 'shop@external-merchant.com') &&
            m.From?.Address === aliasAddress
          );
          if (match) {
            mailpitMsgId = match.ID;
            break;
          }
        }
      } catch (err) {
        // continue polling
      }
    }
    assert(mailpitMsgId !== null, "Delivered message found in Mailpit for shop@external-merchant.com");

    const fullMsgResp = await fetch(`http://localhost:8025/api/v1/message/${mailpitMsgId}`);
    assert(fullMsgResp.ok, "Fetched full message from Mailpit API");
    const mailpitMessage = await fullMsgResp.json();
    console.log("\nRaw Mailpit message JSON:\n" + JSON.stringify(mailpitMessage, null, 2));

    // Gap 1: 5. Assert From: header is the alias address, not real mailbox address
    console.log(`  Delivered From address: "${mailpitMessage.From?.Address}"`);
    assert(mailpitMessage.From?.Address === aliasAddress, `From header is alias address ${aliasAddress}`);
    assert(!mailpitMessage.From?.Address.includes('alice'), "From header does not leak real mailbox address (alice)");

    // Gap 1: 6. Assert Reply-To: header is the alias address
    const replyToAddresses = (mailpitMessage.ReplyTo || []).map((r) => r.Address);
    console.log(`  Delivered Reply-To addresses:`, replyToAddresses);
    assert(replyToAddresses.includes(aliasAddress), `Reply-To header is alias address ${aliasAddress}`);

    // Gap 2: 3. Verify Authentication-Results shows dkim=pass for masked.byos.local
    console.log("\n--- [GAP 2] Verify Authentication-Results header ---");
    const headersResp = await fetch(`http://localhost:8025/api/v1/message/${mailpitMsgId}/headers`);
    let authResultsHeader = "";
    if (headersResp.ok) {
      const headersJson = await headersResp.json();
      const authResultsArr = headersJson['Authentication-Results'] || headersJson['authentication-results'] || [];
      authResultsHeader = Array.isArray(authResultsArr) ? authResultsArr.join(' ') : (authResultsArr || '');
      console.log(`  Authentication-Results header: "${authResultsHeader}"`);
      const dkimSig = headersJson['Dkim-Signature'] || headersJson['dkim-signature'] || [];
      console.log(`  DKIM-Signature header: "${Array.isArray(dkimSig) ? dkimSig[0] : dkimSig}"`);
    }
    assert(authResultsHeader.includes('dkim=pass'), "Authentication-Results contains dkim=pass");
    assert(authResultsHeader.includes('masked.byos.local'), "Authentication-Results contains masked.byos.local");
    assert(authResultsHeader.includes('header.i=@masked.byos.local'), "Authentication-Results contains header.i=@masked.byos.local");
    assert(!authResultsHeader.match(/header\.i=@[^@]+@/), "Authentication-Results does not contain double @ in header.i");

    // Gap 1: 7. Save a screenshot of the Mailpit-rendered message
    console.log("\n--- [GAP 1] Screenshot Mailpit-rendered message ---");
    const mailpitPage = await browser.newPage();
    await mailpitPage.setViewport({ width: 1280, height: 800 });
    await mailpitPage.goto(`http://localhost:8025/#/view/${mailpitMsgId}`, { waitUntil: 'networkidle2' });
    await sleep(2000);
    const mailpitScreenshotPath = path.resolve(artifactsDir, 'masked_email_mailpit_reply.png');
    await mailpitPage.screenshot({ path: mailpitScreenshotPath, fullPage: false });
    console.log(`  Captured screenshot: ${mailpitScreenshotPath}`);
    await mailpitPage.close();
    await sleep(1000);

    // Step 9: Disable Alias & Verify Inbound 550 Rejection
    console.log("\n--- [STEP 9] Disable alias and assert inbound SMTP 550 rejection ---");
    await page.waitForSelector('[data-testid="sidebar-settings-btn"]', { timeout: 5000 });
    await page.click('[data-testid="sidebar-settings-btn"]');
    await sleep(800);
    await page.waitForSelector('[data-testid="settings-tab-masked-email"]', { timeout: 5000 });
    await page.click('[data-testid="settings-tab-masked-email"]');
    await sleep(1500);

    // Click Disable button in table
    const toggleBtn = await page.waitForSelector('button[title="Disable alias"]', { timeout: 5000 });
    await toggleBtn.click();
    await sleep(1500);

    const statusPillText = await page.evaluate(() => {
      const pill = document.querySelector('table tbody tr td span');
      return pill ? pill.textContent.trim() : '';
    });
    console.log(`  Status after toggle: "${statusPillText}"`);

    // Inbound send to disabled alias must reject with 550
    console.log(`  Sending inbound SMTP to disabled alias ${aliasAddress}...`);
    const disabledRes = await sendInboundSMTP({
      from: 'spammer@external.com',
      to: aliasAddress,
      subject: 'Should be rejected',
      body: 'This message should not be delivered.',
    });
    console.log(`  Disabled alias SMTP result: code=${disabledRes.code} response="${disabledRes.response}"`);
    assert(disabledRes.code === 550, "Inbound SMTP rejected with 550 for disabled alias");
    assert(disabledRes.response.includes("550"), "Response conveys 550 error code");

    // Step 10: Delete Alias with Confirmation Modal
    console.log("\n--- [STEP 10] Delete alias with confirmation modal ---");
    const deleteBtn = await page.waitForSelector('button[title="Delete alias"]', { timeout: 5000 });
    await deleteBtn.click();
    await sleep(800);

    // Screenshot 4: Delete confirmation modal
    const deleteModalScreenshotPath = path.resolve(artifactsDir, 'masked_email_delete_modal.png');
    await page.screenshot({ path: deleteModalScreenshotPath, fullPage: false });
    console.log(`  Captured screenshot: ${deleteModalScreenshotPath}`);

    // Confirm deletion
    const confirmDeleteBtn = await page.waitForSelector('[data-testid="confirm-delete-alias-btn"]', { timeout: 5000 });
    await confirmDeleteBtn.click();
    await sleep(2000);

    // Verify alias removed
    const remainingCount = await page.evaluate((target) => {
      const rows = Array.from(document.querySelectorAll('table tbody tr'));
      return rows.filter(r => r.textContent.includes(target)).length;
    }, aliasAddress);
    console.log(`  Matching rows for deleted alias in table: ${remainingCount}`);
    assert(remainingCount === 0, "Alias deleted from table");

    console.log("\n================================================================================");
    console.log("             ALL MASKED EMAIL BROWSER VERIFICATION STEPS PASSED                 ");
    console.log("================================================================================\n");

  } finally {
    await browser.close();
  }
}

runMaskedEmailBrowserTest().catch((err) => {
  console.error("\nTEST SUITE FAILED WITH EXCEPTION:\n", err);
  process.exit(1);
});
