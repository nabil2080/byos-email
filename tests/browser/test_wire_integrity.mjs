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
  console.log("             WIRE FORMAT INTEGRITY INTEGRATION SMOKE TEST                       ");
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
    // =========================================================================
    // STEP 1: Real login flow for two accounts (Alice & Bob)
    // =========================================================================
    console.log("\n--- [STEP 1] Real Login Flow: Alice and Bob ---");
    const pageAlice = await browser.newPage();
    await pageAlice.setViewport({ width: 1280, height: 800 });
    registerErrorTracking(pageAlice, 'Alice');

    await pageAlice.goto('http://127.0.0.1:3001', { waitUntil: 'domcontentloaded' });
    await pageAlice.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await pageAlice.reload({ waitUntil: 'networkidle2' });
    await sleep(1000);

    // Login Alice
    console.log("  Authenticating Alice (alice@byos.local)...");
    await pageAlice.waitForSelector('input[type="email"]', { timeout: 10000 });
    await pageAlice.type('input[type="email"]', 'alice@byos.local');
    await pageAlice.type('input[type="password"]', 'test-password-123');
    await pageAlice.click('button[type="submit"]');
    await pageAlice.waitForSelector('[data-testid="folder-name-inbox"]', { timeout: 15000 });
    await sleep(1000);

    const shotAliceLogin = path.resolve(artifactsDir, 'wire_integrity_1_alice_logged_in.png');
    await pageAlice.screenshot({ path: shotAliceLogin });
    console.log(`  Saved screenshot: ${shotAliceLogin}`);
    assert(true, "Alice logged in successfully via real credentials");

    // Login Bob in an isolated browser context
    console.log("  Authenticating Bob (bob@byos.local) in isolated context...");
    const contextBob = await browser.createBrowserContext();
    const pageBob = await contextBob.newPage();
    await pageBob.setViewport({ width: 1280, height: 800 });
    registerErrorTracking(pageBob, 'Bob');

    await pageBob.goto('http://127.0.0.1:3001', { waitUntil: 'domcontentloaded' });
    await pageBob.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await pageBob.reload({ waitUntil: 'networkidle2' });
    await sleep(1000);

    await pageBob.waitForSelector('input[type="email"]', { timeout: 10000 });
    await pageBob.type('input[type="email"]', 'bob@byos.local');
    await pageBob.type('input[type="password"]', 'test-password-123');
    await pageBob.click('button[type="submit"]');
    await pageBob.waitForSelector('[data-testid="folder-name-inbox"]', { timeout: 15000 });
    await sleep(1000);

    const shotBobLogin = path.resolve(artifactsDir, 'wire_integrity_2_bob_logged_in.png');
    await pageBob.screenshot({ path: shotBobLogin });
    console.log(`  Saved screenshot: ${shotBobLogin}`);
    assert(true, "Bob logged in successfully via real credentials");

    // =========================================================================
    // STEP 2: Path A message from Alice to Bob with 100 KB attachment
    // =========================================================================
    console.log("\n--- [STEP 2] Path A message from Alice to Bob with 100 KB attachment ---");
    const composeBtnAlice = await pageAlice.waitForSelector('[data-testid="sidebar-compose-btn"]', { timeout: 5000 });
    await composeBtnAlice.click();
    await sleep(1000);

    await pageAlice.waitForSelector('#composeToInput', { timeout: 5000 });
    await pageAlice.type('#composeToInput', 'bob@byos.local');
    await pageAlice.type('#composeSubjectInput', 'Path A Wire Integrity Test 100KB');

    const bodyEl = await pageAlice.waitForSelector('[data-testid="compose-body-input"]', { timeout: 5000 });
    await bodyEl.click();
    await bodyEl.type('Hello Bob, this is an end-to-end encrypted Path A message with 100 KB payload.');

    // Upload attachment
    console.log("  Uploading 100 KB attachment in ComposeDrawer...");
    const fileInput = await pageAlice.waitForSelector('input[data-testid="compose-file-input"]', { timeout: 5000 });
    await fileInput.uploadFile(tempAttachmentPath);
    await pageAlice.waitForSelector('[data-testid="compose-attachment-pill"]', { timeout: 15000 });
    console.log("  Attachment pill rendered in ComposeDrawer.");
    await sleep(1000);

    const shotCompose = path.resolve(artifactsDir, 'wire_integrity_3_path_a_compose.png');
    await pageAlice.screenshot({ path: shotCompose });
    console.log(`  Saved screenshot: ${shotCompose}`);

    // Set up send promise for Path A internal delivery
    const pathASendPromise = pageAlice.waitForResponse(
      (res) => (res.url().includes('/v1/outbound/send-internal') || res.url().includes('/v1/outbound/send')) &&
               res.request().method() === 'POST',
      { timeout: 35000 }
    );

    const sendBtnAlice = await pageAlice.waitForSelector('[data-testid="compose-send-btn"]', { timeout: 5000 });
    await sendBtnAlice.click();
    console.log("  Clicked Send button in ComposeDrawer");

    const pathASendRes = await pathASendPromise;
    console.log(`  Path A send response HTTP status: ${pathASendRes.status()}`);
    assert(pathASendRes.status() === 201, `Path A send returned HTTP 201 (got ${pathASendRes.status()})`);
    const pathASendJson = await pathASendRes.json();
    console.log("  Path A send response JSON:", JSON.stringify(pathASendJson));
    assert(pathASendJson.message_id, "Path A response contains message_id");
    const pathAMessageId = pathASendJson.message_id;

    // Assert recipient's attachment_envelopes in Postgres has one entry
    console.log("\n  [DB Check] Querying recipient's attachment_envelopes in Postgres...");
    const envCountRaw = execSync(
      `docker exec -i byos-postgres psql -U byos -d byos -t -A -c "SELECT jsonb_array_length(attachment_envelopes) FROM message_metadata WHERE mailbox_id = 'c0000000-0000-0000-0000-000000000002' AND folder = 'inbox' AND id = '${pathAMessageId}';"`,
      { encoding: 'utf8' }
    ).trim();
    console.log(`  recipient attachment_envelopes count in DB: ${envCountRaw}`);
    assert(parseInt(envCountRaw, 10) === 1, "The recipient's attachment_envelopes in Postgres has exactly one entry");

    // Fetch Bob's unlocked X-Wing seed from Bob's sessionStorage
    const bobXwingSeedHex = await pageBob.evaluate(() => {
      return sessionStorage.getItem("byos_xwing_seed_c0000000-0000-0000-0000-000000000002") ||
             sessionStorage.getItem("byos_mailbox_sk_c0000000-0000-0000-0000-000000000002");
    });
    console.log(`  Bob unlocked X-Wing seed retrieved from session (length=${bobXwingSeedHex?.length})`);
    assert(bobXwingSeedHex && bobXwingSeedHex.length === 64, "Bob unlocked X-Wing seed is 32 bytes hex");

    // Extract attachment envelope from Postgres
    const envelopeJsonStr = execSync(
      `docker exec -i byos-postgres psql -U byos -d byos -t -A -c "SELECT attachment_envelopes->0 FROM message_metadata WHERE mailbox_id = 'c0000000-0000-0000-0000-000000000002' AND id = '${pathAMessageId}';"`,
      { encoding: 'utf8' }
    ).trim();
    const envelope = JSON.parse(envelopeJsonStr);
    console.log(`  Envelope attachment_id: ${envelope.attachment_id}, chunk_count: ${envelope.chunk_count}, size_bytes: ${envelope.size_bytes}`);
    assert(envelope.size_bytes === testAttachmentSize, `Envelope size_bytes equals ${testAttachmentSize}`);

    // Fetch chunk 0 via API
    const bobToken = await pageBob.evaluate(() => sessionStorage.getItem("byos_active_session_token"));
    const chunkResp = await fetch(
      `http://127.0.0.1:8080/v1/mailboxes/c0000000-0000-0000-0000-000000000002/messages/${pathAMessageId}/attachments/${envelope.attachment_id}/chunks/0`,
      { headers: { Authorization: `Bearer ${bobToken}` } }
    );
    assert(chunkResp.ok, `Fetched encrypted chunk from API: HTTP ${chunkResp.status}`);
    const chunkArrayBuf = await chunkResp.arrayBuffer();
    const chunkBytes = new Uint8Array(chunkArrayBuf);
    console.log(`  Fetched encrypted chunk 0 bytes: ${chunkBytes.length} bytes`);

    // Decrypt Path A attachment
    const decResult = await decryptPathAAttachment(
      envelope,
      [chunkBytes],
      bobXwingSeedHex,
      'c0000000-0000-0000-0000-000000000002'
    );
    assert(!decResult.isCorrupted, `Path A decryption succeeded without corruption: ${decResult.error || 'OK'}`);
    assert(decResult.data !== undefined, "Decrypted data is present");
    const decryptedSha256 = crypto.createHash('sha256').update(decResult.data).digest('hex');
    console.log(`  Decrypted bytes size: ${decResult.data.length}`);
    console.log(`  Decrypted SHA-256: ${decryptedSha256}`);
    console.log(`  Expected  SHA-256: ${expectedAttachmentSha256}`);
    assert(decryptedSha256 === expectedAttachmentSha256, "Fetching encrypted chunk and decrypting yields original bytes (SHA-256 match)");

    // Open message in Bob's UI to verify ReadingPane view and screenshot
    console.log("  Refreshing Bob's inbox and viewing received message...");
    const bobInboxFolder = await pageBob.waitForSelector('[data-testid="folder-inbox"]', { timeout: 5000 });
    await bobInboxFolder.click();
    await sleep(2000);

    const messageClicked = await pageBob.evaluate((targetSubject) => {
      const rows = document.querySelectorAll('[data-testid="message-row"]');
      for (const row of rows) {
        if (row.textContent.includes(targetSubject)) {
          row.click();
          return true;
        }
      }
      return false;
    }, 'Path A Wire Integrity Test 100KB');
    assert(messageClicked, "Clicked Path A message in Bob's inbox");
    await sleep(1500);

    await pageBob.waitForSelector('[data-testid="reading-pane-attachment-item"]', { timeout: 8000 });
    const shotBobReceived = path.resolve(artifactsDir, 'wire_integrity_4_path_a_received_bob.png');
    await pageBob.screenshot({ path: shotBobReceived });
    console.log(`  Saved screenshot: ${shotBobReceived}`);

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
    // STEP 3: Path B message from Alice to external address (external@test.local)
    // =========================================================================
    console.log("\n--- [STEP 3] Path B message from Alice to external@test.local ---");
    // Clear Mailpit
    await fetch('http://localhost:8025/api/v1/messages', { method: 'DELETE' }).catch(() => {});

    const composeBtnPathB = await pageAlice.waitForSelector('[data-testid="sidebar-compose-btn"]', { timeout: 5000 });
    await composeBtnPathB.click();
    await sleep(800);

    await pageAlice.waitForSelector('#composeToInput', { timeout: 5000 });
    await pageAlice.type('#composeToInput', 'external@test.local');
    await pageAlice.type('#composeSubjectInput', 'Path B Wire Integrity External Test');

    const bodyPathB = await pageAlice.waitForSelector('[data-testid="compose-body-input"]', { timeout: 5000 });
    await bodyPathB.click();
    await bodyPathB.type('Hello external recipient, this is a Path B message sent via sovereign outbound.');

    const pathBSendPromise = pageAlice.waitForResponse(
      (res) => res.url().includes('/v1/outbound/send') && res.request().method() === 'POST',
      { timeout: 30000 }
    );
    const sendBtnPathB = await pageAlice.waitForSelector('[data-testid="compose-send-btn"]', { timeout: 5000 });
    await sendBtnPathB.click();
    const pathBSendRes = await pathBSendPromise;
    assert(pathBSendRes.status() === 201, `Path B outbound send returned HTTP 201 (got ${pathBSendRes.status()})`);

    await assertMailpitOutbound({
      expectedRecipient: 'external@test.local',
      expectedSender: 'alice@byos.local',
      expectedDomain: 'byos.local',
      label: 'Step 3 Path B External',
      screenshotName: 'wire_integrity_5_path_b_mailpit.png',
    });

    // =========================================================================
    // STEP 4: Reply from a masked alias to an external sender
    // =========================================================================
    console.log("\n--- [STEP 4] Reply from a masked alias to an external sender ---");
    // Navigate to Settings > Masked Email
    const maskedNavBtn = await pageAlice.waitForSelector('[data-testid="sidebar-masked-aliases-btn"]', { timeout: 5000 });
    await maskedNavBtn.click();
    await sleep(1200);

    const generateBtn = await pageAlice.waitForSelector('[data-testid="generate-alias-btn"]', { timeout: 5000 });
    await generateBtn.click();
    await sleep(800);

    await pageAlice.waitForSelector('#alias-label-input', { timeout: 5000 });
    await pageAlice.type('#alias-label-input', 'Wire Test Merchant');
    await pageAlice.click('button[type="submit"]');
    await sleep(2000);

    await pageAlice.waitForSelector('table tbody tr', { timeout: 8000 });
    const aliasAddress = await pageAlice.evaluate(() => {
      const firstRow = document.querySelector('table tbody tr');
      const addressSpan = firstRow?.querySelector('td font-mono, td .select-all');
      return addressSpan ? addressSpan.textContent.trim() : '';
    });
    console.log(`  Generated alias address: "${aliasAddress}"`);
    assert(aliasAddress.endsWith("@masked.byos.local"), "Alias address has domain @masked.byos.local");

    // Send inbound SMTP to the alias
    console.log(`  Delivering inbound SMTP to alias ${aliasAddress}...`);
    const inboundRes = await sendInboundSMTP({
      from: 'merchant@external-store.com',
      to: aliasAddress,
      subject: 'Wire Test Merchant Order #11223',
      body: 'Thank you for your order! Reply to this message to verify delivery.',
    });
    assert(inboundRes.code === 250, "Inbound SMTP delivered to alias successfully (250 OK)");

    // Back to Inbox and open message
    const backToInboxBtn = await pageAlice.waitForSelector('[data-testid="settings-back-to-inbox-btn"]', { timeout: 5000 });
    await backToInboxBtn.click();
    await sleep(2000);

    const inboxFolderAlice = await pageAlice.waitForSelector('[data-testid="folder-inbox"]', { timeout: 5000 });
    await inboxFolderAlice.click();
    await sleep(2500);

    const inboundMsgClicked = await pageAlice.evaluate((target) => {
      const rows = document.querySelectorAll('[data-testid="message-row"]');
      for (const row of rows) {
        if (row.textContent.includes('merchant@external-store.com') || row.textContent.includes('Wire Test Merchant Order #11223')) {
          row.click();
          return true;
        }
      }
      return false;
    });
    assert(inboundMsgClicked, "Clicked inbound merchant email in Inbox");
    await sleep(1500);

    // Verify Reading Pane alias badge
    await pageAlice.waitForSelector('[data-testid="reading-pane-alias-badge"]', { timeout: 8000 });
    console.log("  Verified alias badge in Reading Pane");

    // Click Reply
    const replyBtn = await pageAlice.waitForSelector('[data-testid="reading-pane-reply-btn"]', { timeout: 5000 });
    await replyBtn.click();
    await sleep(1500);

    // Fill reply body
    const replyBody = await pageAlice.waitForSelector('[data-testid="compose-body-input"]', { timeout: 5000 });
    await replyBody.click();
    await replyBody.type("\n\nConfirming order delivery via masked alias reply.");
    await pageAlice.evaluate(() => {
      const el = document.querySelector('[data-testid="compose-body-input"]');
      if (el) el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await sleep(500);

    // Clear Mailpit before alias reply
    await fetch('http://localhost:8025/api/v1/messages', { method: 'DELETE' }).catch(() => {});

    // Send reply
    const replySendPromise = pageAlice.waitForResponse(
      (res) => res.url().includes('/v1/outbound/send') && res.request().method() === 'POST',
      { timeout: 30000 }
    );
    const sendBtnReply = await pageAlice.waitForSelector('[data-testid="compose-send-btn"]', { timeout: 5000 });
    await sendBtnReply.click();
    const replySendRes = await replySendPromise;
    assert(replySendRes.status() === 201, `Masked alias reply send returned HTTP 201 (got ${replySendRes.status()})`);

    await assertMailpitOutbound({
      expectedRecipient: 'merchant@external-store.com',
      expectedSender: aliasAddress,
      expectedDomain: 'masked.byos.local',
      label: 'Step 4 Masked Alias Reply',
      screenshotName: 'wire_integrity_6_alias_reply_mailpit.png',
    });

    // =========================================================================
    // STEP 5: Send a plain non-alias message to external@test.local
    // =========================================================================
    console.log("\n--- [STEP 5] Send plain non-alias message to external@test.local ---");
    // Clear Mailpit
    await fetch('http://localhost:8025/api/v1/messages', { method: 'DELETE' }).catch(() => {});

    const composeBtnStep5 = await pageAlice.waitForSelector('[data-testid="sidebar-compose-btn"]', { timeout: 5000 });
    await composeBtnStep5.click();
    await sleep(800);

    await pageAlice.waitForSelector('#composeToInput', { timeout: 5000 });
    await pageAlice.type('#composeToInput', 'external@test.local');
    await pageAlice.type('#composeSubjectInput', 'Plain Non-Alias Post-Alias Outbound Test');

    const bodyStep5 = await pageAlice.waitForSelector('[data-testid="compose-body-input"]', { timeout: 5000 });
    await bodyStep5.click();
    await bodyStep5.type('Verifying that sending after alias reply restores standard domain DKIM and headers.');

    const step5SendPromise = pageAlice.waitForResponse(
      (res) => res.url().includes('/v1/outbound/send') && res.request().method() === 'POST',
      { timeout: 30000 }
    );
    const sendBtnStep5 = await pageAlice.waitForSelector('[data-testid="compose-send-btn"]', { timeout: 5000 });
    await sendBtnStep5.click();
    const step5SendRes = await step5SendPromise;
    assert(step5SendRes.status() === 201, `Step 5 plain outbound send returned HTTP 201 (got ${step5SendRes.status()})`);

    await assertMailpitOutbound({
      expectedRecipient: 'external@test.local',
      expectedSender: 'alice@byos.local',
      expectedDomain: 'byos.local',
      label: 'Step 5 Plain Non-Alias Message',
      screenshotName: 'wire_integrity_7_plain_nonalias_mailpit.png',
    });

    // =========================================================================
    // Console error & HTTP failure assertion against allowlist
    // =========================================================================
    console.log("\n--- [Console & HTTP Error Allowlist Enforcement] ---");
    console.log(`  Total unallowed errors captured: ${unallowedErrors.length}`);
    if (unallowedErrors.length > 0) {
      console.error("  Unallowed errors detected:\n", JSON.stringify(unallowedErrors, null, 2));
      throw new Error(`Test failed due to ${unallowedErrors.length} unallowed console/HTTP error(s)`);
    }
    assert(unallowedErrors.length === 0, "No unallowed console or HTTP errors occurred during execution");

    console.log("\n================================================================================");
    console.log("             ALL WIRE INTEGRITY CHECKS PASSED CLEANLY                           ");
    console.log("================================================================================\n");

  } finally {
    // Clean up temporary attachment
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
