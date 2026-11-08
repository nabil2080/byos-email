import puppeteer from '../../apps/webmail/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as wasm from '../../apps/webmail/src/generated/crypto-core/byos_crypto_core.js';
import {
  decryptPathAAttachment,
  computeSHA256,
} from '../../apps/webmail/src/attachment_crypto.ts';

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

async function runWireIntegrityTest() {
  console.log("================================================================================");
  console.log("             WIRE INTEGRITY CONSOLIDATION SMOKE TEST (SCENARIOS A-D)            ");
  console.log("================================================================================\n");

  const unallowedErrors = [];

  function registerErrorTracking(page, label) {
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        const isAllowlisted =
          text.includes('/v1/auth/me') ||
          text.includes('favicon') ||
          text.includes('/v1/keys/') ||
          text.includes('401 (Unauthorized)') ||
          text.includes('404 (Not Found)');
        if (!isAllowlisted) {
          console.error(`  [CONSOLE ERROR][${label}] ${text}`);
          unallowedErrors.push({ source: `console-${label}`, text });
        } else {
          console.log(`  [ALLOWLISTED CONSOLE LOG][${label}] ${text}`);
        }
      }
    });

    page.on('response', (res) => {
      const status = res.status();
      const url = res.url();
      if (status >= 400) {
        const isAllowlisted =
          (url.includes('/v1/auth/me') && status === 401) ||
          (url.includes('favicon.ico') && status === 404) ||
          (url.includes('/v1/keys/') && status === 404);
        if (!isAllowlisted) {
          console.error(`  [HTTP ${status}][${label}] ${res.request().method()} ${url}`);
          unallowedErrors.push({ source: `http-${label}`, status, url });
        } else {
          console.log(`  [ALLOWLISTED HTTP ${status}][${label}] ${url}`);
        }
      }
    });
  }

  // Generate 100 KB test payload file
  const testAttachmentSize = 100 * 1024; // 102,400 bytes
  const attachmentBuffer = Buffer.alloc(testAttachmentSize);
  for (let i = 0; i < testAttachmentSize; i++) {
    attachmentBuffer[i] = (i * 37 + 13) & 0xff;
  }
  const expectedAttachmentSha256 = crypto.createHash('sha256').update(attachmentBuffer).digest('hex');
  const tempAttachmentPath = path.resolve(artifactsDir, 'wire_test_attachment_100k.dat');
  fs.writeFileSync(tempAttachmentPath, attachmentBuffer);
  console.log(`Generated 100 KB test attachment at: ${tempAttachmentPath}`);
  console.log(`Expected SHA-256: ${expectedAttachmentSha256}`);

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ['--no-sandbox', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    registerErrorTracking(page, 'Webmail');

    // =========================================================================
    // SETUP: Real login flow for Alice, add Bob as second connected account
    // =========================================================================
    console.log("\n--- [SETUP] Real Login Flow: Alice & Connect Bob ---");
    await page.goto('http://127.0.0.1:3001', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1000);

    // Login Alice
    console.log("  Authenticating Alice (alice@byos.local)...");
    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.type('input[type="email"]', 'alice@byos.local');
    await page.type('input[type="password"]', 'test-password-123');
    await page.click('button[type="submit"]');
    await page.waitForSelector('[data-testid="account-chip-selector"]', { timeout: 15000 });
    await sleep(1500);

    const initialChipText = await page.$eval('[data-testid="account-chip-text"]', (el) => el.textContent.trim());
    console.log(`  Active account chip: "${initialChipText}"`);
    assert(initialChipText.includes("alice@byos.local"), "Alice logged in successfully via real credentials");

    // Connect Bob as second account via AddMailboxModal
    console.log("  Connecting secondary account Bob (bob@byos.local)...");
    await page.click('[data-testid="account-chip-selector"]');
    await sleep(500);
    await page.waitForSelector('[data-testid="add-mailbox-button"]', { timeout: 5000 });
    await page.click('[data-testid="add-mailbox-button"]');
    await sleep(600);

    const emailInputs = await page.$$('input[type="email"]');
    const modalEmailInput = emailInputs[emailInputs.length - 1];
    await modalEmailInput.type('bob@byos.local');

    const passInputs = await page.$$('input[type="password"]');
    const modalPassInput = passInputs[passInputs.length - 1];
    await modalPassInput.type('test-password-123');

    const modalSubmitBtn = await page.evaluateHandle(() => {
      const modal = document.querySelector('[role="dialog"], .fixed.inset-0.z-50');
      return modal ? modal.querySelector('button[type="submit"]') : null;
    });
    await modalSubmitBtn.click();
    await sleep(2500);

    // Verify both accounts in session
    const sessionAccounts = await page.evaluate(() => {
      const stored = sessionStorage.getItem('byos_connected_accounts');
      return stored ? JSON.parse(stored) : [];
    });
    console.log("  Connected accounts in session:", JSON.stringify(sessionAccounts.map(a => ({ email: a.email, id: a.id }))));
    assert(sessionAccounts.some(a => a.email.includes('alice')), "Alice present in connected accounts");
    assert(sessionAccounts.some(a => a.email.includes('bob')), "Bob present in connected accounts");

    const aliceId = sessionAccounts.find(a => a.email.includes('alice'))?.id || "c0000000-0000-0000-0000-000000000001";
    const bobId = sessionAccounts.find(a => a.email.includes('bob'))?.id || "c0000000-0000-0000-0000-000000000002";

    // Verify Bob's keys unsealed in sessionStorage (vault or direct key)
    const bobXwingSeed = await page.evaluate((bId) => {
      const vaultRaw = sessionStorage.getItem('byos_session_vault');
      if (vaultRaw) {
        try {
          const vault = JSON.parse(vaultRaw);
          if (vault[bId]?.xwingSeedHex) return vault[bId].xwingSeedHex;
        } catch {}
      }
      return sessionStorage.getItem(`byos_xwing_seed_${bId}`) ||
             sessionStorage.getItem(`byos_mailbox_sk_${bId}`);
    }, bobId);
    assert(bobXwingSeed && bobXwingSeed.length === 64, "Bob's X-Wing secret seed is unsealed in session");

    // Ensure Alice is the active account
    const curChip = await page.$eval('[data-testid="account-chip-text"]', el => el.textContent.trim());
    if (!curChip.includes('alice@byos.local')) {
      console.log("  Switching back to Alice for Scenario A...");
      await page.click('[data-testid="account-chip-selector"]');
      await sleep(500);
      await page.waitForSelector(`[data-testid="account-dropdown-${aliceId}"]`, { timeout: 5000 });
      await page.click(`[data-testid="account-dropdown-${aliceId}"]`);
      await sleep(1500);
    }
    assert((await page.$eval('[data-testid="account-chip-text"]', el => el.textContent.trim())).includes('alice@byos.local'), "Alice is active account for Scenario A");

    // =========================================================================
    // SCENARIO A — Path A message from Alice to Bob with 100 KB attachment
    // =========================================================================
    console.log("\n================================================================================");
    console.log("  SCENARIO A: PATH A WITH 100 KB ATTACHMENT                                      ");
    console.log("================================================================================");

    const scenarioASubject = `wire_test_a_${Date.now()}`;
    const composeBtnAlice = await page.waitForSelector('[data-testid="sidebar-compose-btn"]', { timeout: 5000 });
    await composeBtnAlice.click();
    await sleep(1000);

    await page.waitForSelector('#composeToInput', { timeout: 5000 });
    await page.type('#composeToInput', 'bob@byos.local');
    await page.type('#composeSubjectInput', scenarioASubject);

    const bodyEl = await page.waitForSelector('[data-testid="compose-body-input"]', { timeout: 5000 });
    await bodyEl.click();
    await bodyEl.type('Hello Bob, this is an end-to-end encrypted Path A message with 100 KB payload.');

    // Upload attachment
    console.log("  Uploading 100 KB attachment in ComposeDrawer...");
    const fileInput = await page.waitForSelector('input[data-testid="compose-file-input"]', { timeout: 5000 });
    await fileInput.uploadFile(tempAttachmentPath);
    await page.waitForSelector('[data-testid="compose-attachment-pill"]', { timeout: 15000 });
    console.log("  Attachment pill rendered in ComposeDrawer.");
    await sleep(800);

    // Set up send promise for Path A internal delivery
    const pathASendPromise = page.waitForResponse(
      (res) => (res.url().includes('/v1/outbound/send-internal') || res.url().includes('/v1/outbound/send')) &&
               res.request().method() === 'POST',
      { timeout: 35000 }
    );

    const sendBtnAlice = await page.waitForSelector('[data-testid="compose-send-btn"]', { timeout: 5000 });
    await sendBtnAlice.click();
    console.log("  Clicked Send button in ComposeDrawer");

    const shotA = path.resolve(artifactsDir, 'wire_a_attachment_sent.png');
    await page.screenshot({ path: shotA });
    console.log(`  Saved screenshot: ${shotA}`);

    const pathASendRes = await pathASendPromise;
    console.log(`  Path A send response HTTP status: ${pathASendRes.status()}`);
    assert(pathASendRes.status() === 201, `Path A send returned HTTP 201 (got ${pathASendRes.status()})`);
    const pathASendJson = await pathASendRes.json();
    console.log("  Path A send response JSON:", JSON.stringify(pathASendJson));
    assert(pathASendJson.message_id, "Path A response contains message_id");
    const pathAMessageId = pathASendJson.message_id;

    // Assert recipient's message_metadata in Postgres: has_attachments = true, jsonb_array_length(attachment_envelopes) = 1
    console.log("\n  [DB Check] Querying recipient's message_metadata in Postgres...");
    const dbMetaRaw = execSync(
      `docker exec -i byos-postgres psql -U byos -d byos -t -A -c "SELECT has_attachments, jsonb_array_length(attachment_envelopes) FROM message_metadata WHERE mailbox_id = '${bobId}' AND id = '${pathAMessageId}';"`,
      { encoding: 'utf8' }
    ).trim();
    console.log(`  recipient message_metadata (has_attachments | envelope_count): "${dbMetaRaw}"`);
    assert(dbMetaRaw === "t|1", `recipient message_metadata has_attachments=true and envelope_count=1 (got "${dbMetaRaw}")`);

    // Extract attachment envelope from Postgres
    const envelopeJsonStr = execSync(
      `docker exec -i byos-postgres psql -U byos -d byos -t -A -c "SELECT attachment_envelopes->0 FROM message_metadata WHERE mailbox_id = '${bobId}' AND id = '${pathAMessageId}';"`,
      { encoding: 'utf8' }
    ).trim();
    const envelope = JSON.parse(envelopeJsonStr);
    console.log(`  Envelope attachment_id: ${envelope.attachment_id}, chunk_count: ${envelope.chunk_count}, size_bytes: ${envelope.size_bytes}`);
    assert(envelope.size_bytes === testAttachmentSize, `Envelope size_bytes equals ${testAttachmentSize}`);

    // Fetch chunk 0 via API using Bob's session token (obtained via real auth)
    const bobLoginResp = await fetch('http://127.0.0.1:8080/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'bob@byos.local', password: 'test-password-123' }),
    });
    assert(bobLoginResp.ok, "Bob authenticated to verify received attachment chunk");
    const bobLoginData = await bobLoginResp.json();
    const bobToken = bobLoginData.token;
    const chunkResp = await fetch(
      `http://127.0.0.1:8080/v1/mailboxes/${bobId}/messages/${pathAMessageId}/attachments/${envelope.attachment_id}/chunks/0`,
      { headers: { Authorization: `Bearer ${bobToken}` } }
    );
    assert(chunkResp.ok, `Fetched encrypted chunk from API: HTTP ${chunkResp.status}`);
    const chunkArrayBuf = await chunkResp.arrayBuffer();
    const chunkBytes = new Uint8Array(chunkArrayBuf);
    console.log(`  Fetched encrypted chunk 0 bytes: ${chunkBytes.length} bytes`);

    // Decrypt Path A attachment client-side
    const decResult = await decryptPathAAttachment(
      envelope,
      [chunkBytes],
      bobXwingSeed,
      bobId
    );
    assert(!decResult.isCorrupted, `Path A decryption succeeded without corruption: ${decResult.error || 'OK'}`);
    assert(decResult.data !== undefined, "Decrypted data is present");
    const decryptedSha256 = crypto.createHash('sha256').update(decResult.data).digest('hex');
    console.log(`  Decrypted bytes size: ${decResult.data.length}`);
    console.log(`  Decrypted SHA-256: ${decryptedSha256}`);
    console.log(`  Expected  SHA-256: ${expectedAttachmentSha256}`);
    assert(decryptedSha256 === expectedAttachmentSha256, "Decrypted attachment SHA-256 matches original 100 KB payload");
    console.log("  Scenario A: Path A attachment wire integrity verified successfully!");

    // Helper function to assert Mailpit outbound headers
    async function assertMailpitOutbound({ expectedRecipient, expectedSender, expectedDomain, label, screenshotName }) {
      console.log(`\n  [Mailpit Check] Polling delivered message for recipient: ${expectedRecipient}...`);
      let mailpitMsgId = null;
      for (let attempt = 0; attempt < 25; attempt++) {
        await sleep(1500);
        try {
          const resp = await fetch('http://localhost:8025/api/v1/messages');
          if (resp.ok) {
            const data = await resp.json();
            const match = (data.messages || []).find((m) =>
              m.To?.some((t) => t.Address === expectedRecipient) &&
              m.From?.Address === expectedSender
            );
            if (match) {
              mailpitMsgId = match.ID;
              break;
            }
          }
        } catch {}
      }
      assert(mailpitMsgId !== null, `Delivered message found in Mailpit for ${expectedRecipient}`);

      const msgResp = await fetch(`http://localhost:8025/api/v1/message/${mailpitMsgId}`);
      assert(msgResp.ok, "Fetched full message from Mailpit");
      const msgJson = await msgResp.json();

      const headersResp = await fetch(`http://localhost:8025/api/v1/message/${mailpitMsgId}/headers`);
      assert(headersResp.ok, "Fetched message headers from Mailpit");
      const headersJson = await headersResp.json();

      const authResultsArr = headersJson['Authentication-Results'] || headersJson['authentication-results'] || [];
      const authResults = Array.isArray(authResultsArr) ? authResultsArr.join(' ') : (authResultsArr || '');
      const returnPathArr = headersJson['Return-Path'] || headersJson['return-path'] || [];
      const returnPath = (Array.isArray(returnPathArr) ? returnPathArr[0] : (returnPathArr || '')).replace(/[<>]/g, '').trim();
      const fromAddr = msgJson.From?.Address || '';
      const replyToArr = (msgJson.ReplyTo || []).map((r) => r.Address);
      const replyToAddr = replyToArr[0] || '';

      console.log(`  --- Outbound Message Headers [${label}] ---`);
      console.log(`  Authentication-Results: "${authResults}"`);
      console.log(`  From: "${fromAddr}"`);
      console.log(`  Reply-To: "${replyToAddr}"`);
      console.log(`  Return-Path: "${returnPath}"`);

      // 1. Authentication-Results contains dkim=pass
      assert(authResults.includes('dkim=pass'), `${label}: Authentication-Results contains dkim=pass`);

      // 2. header.d matches sending domain
      assert(authResults.includes(`header.d=${expectedDomain}`), `${label}: header.d matches sending domain (${expectedDomain})`);

      // 3. header.i contains exactly one @
      const matchI = authResults.match(/header\.i=([^;\s]+)/);
      assert(matchI !== null, `${label}: header.i found in Authentication-Results`);
      const headerI = matchI ? matchI[1] : '';
      console.log(`  Extracted header.i: "${headerI}"`);
      const atCount = (headerI.match(/@/g) || []).length;
      assert(atCount === 1, `${label}: header.i contains exactly one @ (got "${headerI}")`);
      assert(headerI === `@${expectedDomain}`, `${label}: header.i matches @${expectedDomain}`);

      // 4. From matches expected sender
      assert(fromAddr === expectedSender, `${label}: From header matches expected sender (${expectedSender})`);

      // 5. Reply-To matches expected value
      assert(replyToAddr === expectedSender, `${label}: Reply-To header matches expected value (${expectedSender})`);

      // 6. Return-Path matches SMTP envelope sender
      assert(returnPath === expectedSender, `${label}: Return-Path matches envelope sender (${expectedSender})`);

      // Screenshot Mailpit view
      const mailpitPage = await browser.newPage();
      await mailpitPage.setViewport({ width: 1280, height: 800 });
      await mailpitPage.goto(`http://localhost:8025/#/view/${mailpitMsgId}`, { waitUntil: 'networkidle2' });
      await sleep(1500);
      const shotPath = path.resolve(artifactsDir, screenshotName);
      await mailpitPage.screenshot({ path: shotPath });
      console.log(`  Saved screenshot: ${shotPath}`);
      await mailpitPage.close();
    }

    // =========================================================================
    // SCENARIO B — Reply from custom alias
    // =========================================================================
    console.log("\n================================================================================");
    console.log("  SCENARIO B: REPLY FROM CUSTOM ALIAS                                           ");
    console.log("================================================================================");

    const aliasTimestamp = Date.now().toString(36).slice(-6);
    const customAliasLocal = `wiresmoke${aliasTimestamp}`;
    const customAliasAddress = `${customAliasLocal}@masked.byos.local`;
    console.log(`  Target custom alias: "${customAliasAddress}"`);

    // Navigate to Settings > Masked Email
    console.log("  Navigating to Settings > Masked Email...");
    await page.waitForSelector('[data-testid="sidebar-settings-btn"]', { timeout: 5000 });
    await page.click('[data-testid="sidebar-settings-btn"]');
    await sleep(800);

    await page.waitForSelector('[data-testid="settings-tab-masked-email"]', { timeout: 5000 });
    await page.click('[data-testid="settings-tab-masked-email"]');
    await sleep(1200);

    // Open Create Modal & Switch to Custom mode
    await page.waitForSelector('[data-testid="generate-alias-btn"]', { timeout: 5000 });
    await page.click('[data-testid="generate-alias-btn"]');
    await sleep(600);

    await page.waitForSelector('[data-testid="alias-mode-custom"]', { timeout: 5000 });
    await page.click('[data-testid="alias-mode-custom"]');
    await sleep(500);

    await page.waitForSelector('[data-testid="custom-local-part-input"]', { timeout: 5000 });
    await page.type('[data-testid="custom-local-part-input"]', customAliasLocal);
    await page.type('[data-testid="alias-label-input"]', 'Wire Smoke Order Alias');
    await sleep(400);

    await page.click('[data-testid="alias-create-submit-btn"]');
    await sleep(1500);

    const aliasesTableText = await page.evaluate(() => {
      const tbl = document.querySelector('table');
      return tbl ? tbl.innerText : '';
    });
    assert(aliasesTableText.includes(customAliasAddress), `Custom alias ${customAliasAddress} appears in settings table`);

    // Verify initial reply_count is 0 in Postgres
    const initialReplyCountRaw = execSync(
      `docker exec -i byos-postgres psql -U byos -d byos -t -A -c "SELECT reply_count FROM masked_aliases WHERE alias_address = '${customAliasAddress}';"`,
      { encoding: 'utf8' }
    ).trim();
    console.log(`  Initial reply_count in DB: ${initialReplyCountRaw}`);
    assert(parseInt(initialReplyCountRaw, 10) === 0, "Initial reply_count is 0");

    // Return to Inbox
    const backToInboxBtn = await page.waitForSelector('[data-testid="settings-back-to-inbox-btn"]', { timeout: 5000 });
    await backToInboxBtn.click();
    await sleep(1500);

    // Send inbound SMTP to the alias
    console.log(`  Delivering inbound SMTP to alias ${customAliasAddress}...`);
    const inboundSubject = `Wire Smoke Inbound Order #${aliasTimestamp}`;
    const inboundRes = await sendInboundSMTP({
      from: 'merchant@external-store.com',
      to: customAliasAddress,
      subject: inboundSubject,
      body: 'Thank you for your order! Reply to this message to verify delivery.',
    });
    assert(inboundRes.code === 250, "Inbound SMTP delivered to alias successfully (250 OK)");

    // Refresh Inbox and find received message
    const inboxFolderAlice = await page.waitForSelector('[data-testid="folder-inbox"]', { timeout: 5000 });
    await inboxFolderAlice.click();
    await sleep(2500);

    let inboundMsgClicked = false;
    for (let attempt = 0; attempt < 8; attempt++) {
      inboundMsgClicked = await page.evaluate((targetSubj) => {
        const rows = document.querySelectorAll('[data-testid="message-row"]');
        for (const row of rows) {
          if (row.textContent.includes(targetSubj) || row.textContent.includes('merchant@external-store.com')) {
            row.click();
            return true;
          }
        }
        return false;
      }, inboundSubject);
      if (inboundMsgClicked) break;
      await inboxFolderAlice.click();
      await sleep(1500);
    }
    assert(inboundMsgClicked, "Inbound message received via alias opened in Alice's inbox");
    await sleep(2000);

    // Verify Reading Pane alias badge
    await page.waitForSelector('[data-testid="reading-pane-alias-badge"]', { timeout: 8000 });
    const badgeText = await page.$eval('[data-testid="reading-pane-alias-badge"]', el => el.textContent.trim());
    console.log(`  Reading Pane alias badge text: "${badgeText}"`);
    assert(badgeText.includes("Received via"), "Reading Pane displays 'Received via' alias badge");

    // Click Reply
    const replyBtn = await page.waitForSelector('[data-testid="reading-pane-reply-btn"]', { timeout: 8000 });
    await replyBtn.click();
    await sleep(1500);

    // Assert From: is the alias
    await page.waitForSelector('[data-testid="compose-from-select"]', { timeout: 8000 });
    let replyFromDetails = { value: '', text: '' };
    for (let i = 0; i < 10; i++) {
      replyFromDetails = await page.evaluate(() => {
        const select = document.querySelector('[data-testid="compose-from-select"]');
        const opt = select && select.selectedIndex >= 0 ? select.options[select.selectedIndex] : null;
        return {
          value: select ? select.value : '',
          text: opt ? opt.textContent.trim() : '',
        };
      });
      if (replyFromDetails.value && replyFromDetails.value.startsWith('alias:')) break;
      await sleep(300);
    }
    console.log(`  Reply From dropdown: text="${replyFromDetails.text}" value="${replyFromDetails.value}"`);
    assert(replyFromDetails.value === `alias:${customAliasAddress}`, `Reply From value is alias:${customAliasAddress}`);
    assert(replyFromDetails.text.includes(customAliasAddress), `Reply From text contains ${customAliasAddress}`);
    assert(!replyFromDetails.text.includes('alice@byos.local'), "Reply From does NOT leak Alice's real address");

    const shotBCompose = path.resolve(artifactsDir, 'wire_b_alias_reply_compose.png');
    await page.screenshot({ path: shotBCompose });
    console.log(`  Saved screenshot: ${shotBCompose}`);

    // Fill reply body
    const replyBody = await page.waitForSelector('[data-testid="compose-body-input"]', { timeout: 5000 });
    await replyBody.click();
    await replyBody.type("\n\nConfirming order delivery via masked alias reply.");
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="compose-body-input"]');
      if (el) el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(500);

    // Clear Mailpit before alias reply
    await fetch('http://localhost:8025/api/v1/messages', { method: 'DELETE' }).catch(() => {});

    // Send reply
    const replySendPromise = page.waitForResponse(
      (res) => res.url().includes('/v1/outbound/send') && res.request().method() === 'POST',
      { timeout: 30000 }
    );
    const sendBtnReply = await page.waitForSelector('[data-testid="compose-send-btn"]', { timeout: 5000 });
    await sendBtnReply.click();
    const replySendRes = await replySendPromise;
    assert(replySendRes.status() === 201, `Masked alias reply send returned HTTP 201 (got ${replySendRes.status()})`);

    // Verify delivered message in Mailpit
    await assertMailpitOutbound({
      expectedRecipient: 'merchant@external-store.com',
      expectedSender: customAliasAddress,
      expectedDomain: 'masked.byos.local',
      label: 'Scenario B Custom Alias Reply',
      screenshotName: 'wire_b_mailpit_delivered.png',
    });

    // Assert reply_count on the alias incremented by exactly 1 in Postgres
    const afterReplyCountRaw = execSync(
      `docker exec -i byos-postgres psql -U byos -d byos -t -A -c "SELECT reply_count FROM masked_aliases WHERE alias_address = '${customAliasAddress}';"`,
      { encoding: 'utf8' }
    ).trim();
    console.log(`  Updated reply_count in DB: ${afterReplyCountRaw}`);
    assert(parseInt(afterReplyCountRaw, 10) === 1, "reply_count on alias in Postgres incremented by exactly 1 (0 -> 1)");
    console.log("  Scenario B: Reply from custom alias wire integrity verified successfully!");

    // =========================================================================
    // SCENARIO C — Non-alias outbound to external@test.local
    // =========================================================================
    console.log("\n================================================================================");
    console.log("  SCENARIO C: NON-ALIAS OUTBOUND TO external@test.local                          ");
    console.log("================================================================================");

    // Clear Mailpit
    await fetch('http://localhost:8025/api/v1/messages', { method: 'DELETE' }).catch(() => {});

    // Ensure on inbox view
    await inboxFolderAlice.click();
    await sleep(1000);

    const composeBtnC = await page.waitForSelector('[data-testid="sidebar-compose-btn"]', { timeout: 5000 });
    await composeBtnC.click();
    await sleep(800);

    await page.waitForSelector('#composeToInput', { timeout: 5000 });
    await page.type('#composeToInput', 'external@test.local');
    await page.type('#composeSubjectInput', `Wire Test C Non-Alias Outbound ${Date.now()}`);

    const bodyC = await page.waitForSelector('[data-testid="compose-body-input"]', { timeout: 5000 });
    await bodyC.click();
    await bodyC.type('Hello external recipient, this is a non-alias outbound message sent via sovereign outbound.');

    const shotC = path.resolve(artifactsDir, 'wire_c_non_alias_sent.png');
    await page.screenshot({ path: shotC });
    console.log(`  Saved screenshot: ${shotC}`);

    const pathCSendPromise = page.waitForResponse(
      (res) => res.url().includes('/v1/outbound/send') && res.request().method() === 'POST',
      { timeout: 30000 }
    );
    const sendBtnC = await page.waitForSelector('[data-testid="compose-send-btn"]', { timeout: 5000 });
    await sendBtnC.click();
    const pathCSendRes = await pathCSendPromise;
    assert(pathCSendRes.status() === 201, `Non-alias outbound send returned HTTP 201 (got ${pathCSendRes.status()})`);

    await assertMailpitOutbound({
      expectedRecipient: 'external@test.local',
      expectedSender: 'alice@byos.local',
      expectedDomain: 'byos.local',
      label: 'Scenario C Non-Alias Outbound',
      screenshotName: 'wire_c_mailpit_delivered.png',
    });
    console.log("  Scenario C: Non-alias outbound wire integrity verified successfully!");

    // =========================================================================
    // SCENARIO D — Account switch crypto isolation & 10 rapid cycles
    // =========================================================================
    console.log("\n================================================================================");
    console.log("  SCENARIO D: ACCOUNT SWITCH CRYPTO ISOLATION & 10 RAPID CYCLES                 ");
    console.log("================================================================================");

    async function switchToAccount(targetMailboxId, targetEmail) {
      const trigger = await page.waitForSelector('[data-testid="account-chip-selector"]', { timeout: 5000 });
      await trigger.click();
      await sleep(500);
      const opt = await page.waitForSelector(`[data-testid="account-dropdown-${targetMailboxId}"]`, { timeout: 5000 });
      await opt.click();
      await sleep(1500);

      const activeText = await page.evaluate(() => {
        const chip = document.querySelector('[data-testid="account-chip-selector"]');
        return chip ? chip.textContent.trim() : '';
      });
      assert(activeText.includes(targetEmail), `Active account switched to ${targetEmail}`);
    }

    async function getComposeFromDetails() {
      await page.waitForSelector('[data-testid="compose-from-select"]', { timeout: 5000 });
      return await page.evaluate(() => {
        const select = document.querySelector('[data-testid="compose-from-select"]');
        const opt = select ? select.options[select.selectedIndex] : null;
        return {
          value: select ? select.value : '',
          text: opt ? opt.textContent.trim() : '',
        };
      });
    }

    async function closeCompose() {
      const closeBtn = await page.waitForSelector('[data-testid="compose-close-btn"]', { timeout: 5000 });
      await closeBtn.click();
      await sleep(500);
    }

    // Step 1: Switch Alice -> Bob -> Alice, verifying From: dropdown at each step
    console.log("  Testing switch Alice -> Bob -> Alice...");
    await switchToAccount(bobId, 'bob@byos.local');
    const compBtnBob = await page.waitForSelector('[data-testid="sidebar-compose-btn"]', { timeout: 5000 });
    await compBtnBob.click();
    await sleep(600);
    const bobFrom = await getComposeFromDetails();
    console.log(`  Bob active -> Compose From: "${bobFrom.text}" (value: "${bobFrom.value}")`);
    assert(bobFrom.value === `account:${bobId}` && bobFrom.text.includes('bob@byos.local'), "Compose From is Bob when Bob is active");
    await closeCompose();

    await switchToAccount(aliceId, 'alice@byos.local');
    const compBtnAliceAgain = await page.waitForSelector('[data-testid="sidebar-compose-btn"]', { timeout: 5000 });
    await compBtnAliceAgain.click();
    await sleep(600);
    const aliceFrom = await getComposeFromDetails();
    console.log(`  Alice active -> Compose From: "${aliceFrom.text}" (value: "${aliceFrom.value}")`);
    assert(aliceFrom.value === `account:${aliceId}` && aliceFrom.text.includes('alice@byos.local'), "Compose From is Alice when Alice is active");
    await closeCompose();

    // Step 2: Switch to Bob and perform 10 rapid open/close cycles
    console.log("\n  Running 10 rapid open/close compose cycles with Bob active...");
    await switchToAccount(bobId, 'bob@byos.local');

    let driftedCount = 0;
    for (let cycle = 1; cycle <= 10; cycle++) {
      const btn = await page.waitForSelector('[data-testid="sidebar-compose-btn"]', { timeout: 5000 });
      await btn.click();
      await sleep(300);

      const fromState = await getComposeFromDetails();
      const isBob = fromState.value === `account:${bobId}` && fromState.text.includes('bob@byos.local');
      const isAlice = fromState.value.includes(aliceId) || fromState.text.includes('alice@byos.local');

      if (isAlice) {
        driftedCount++;
      }

      console.log(`  Cycle ${cycle.toString().padStart(2, ' ')}: From = "${fromState.text}" | Drifted: ${isAlice ? 'YES' : 'NO'}`);
      assert(isBob, `Cycle ${cycle}: From must be Bob`);
      assert(!isAlice, `Cycle ${cycle}: From must NOT be Alice`);

      if (cycle === 10) {
        const shotD = path.resolve(artifactsDir, 'wire_d_account_switch.png');
        await page.screenshot({ path: shotD });
        console.log(`  Saved screenshot: ${shotD}`);
      }

      await closeCompose();
      await sleep(200);
    }

    console.log(`  Rapid cycles summary: 10/10 iterations remained stable as bob@byos.local (Drifted: ${driftedCount})`);
    assert(driftedCount === 0, "From: never drifted to Alice across 10 rapid open/close cycles");
    console.log("  Scenario D: Account switch crypto isolation verified successfully!");

    // =========================================================================
    // CONSOLE & HTTP ERROR ALLOWLIST ENFORCEMENT
    // =========================================================================
    console.log("\n--- [Console & HTTP Error Allowlist Enforcement] ---");
    console.log(`  Total unallowed errors captured: ${unallowedErrors.length}`);
    if (unallowedErrors.length > 0) {
      console.error("  Unallowed errors detected:\n", JSON.stringify(unallowedErrors, null, 2));
      throw new Error(`Test failed due to ${unallowedErrors.length} unallowed console/HTTP error(s)`);
    }
    assert(unallowedErrors.length === 0, "No unallowed console or HTTP errors occurred during execution");

    console.log("\n================================================================================");
    console.log("             ALL WIRE INTEGRITY CHECKS (SCENARIOS A-D) PASSED CLEANLY           ");
    console.log("================================================================================\n");

  } finally {
    try {
      if (fs.existsSync(tempAttachmentPath)) {
        fs.unlinkSync(tempAttachmentPath);
      }
    } catch {}
    await browser.close();
  }
}

runWireIntegrityTest().catch((err) => {
  console.error("\nTEST SUITE FAILED WITH EXCEPTION:\n", err);
  process.exit(1);
});
