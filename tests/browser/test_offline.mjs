import puppeteer from '../../apps/webmail/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as wasm from '../../apps/webmail/src/generated/crypto-core/byos_crypto_core.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const artifactsDir = path.resolve(__dirname, 'artifacts');

if (!fs.existsSync(artifactsDir)) {
  fs.mkdirSync(artifactsDir, { recursive: true });
}

function bytesToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
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

const BobToken = 'bob_manual_test_session_token_123';
const BobUserId = 'cccccccc-0000-0000-0000-000000000003';
const BobMailboxId = 'c0000000-0000-0000-0000-000000000002';
const AliceMailboxId = 'c0000000-0000-0000-0000-000000000001';

// Step 0: Ensure Bob session in DB for sending seed message
const sessSql = `INSERT INTO sessions (user_id, token_hash, expires_at, revoked_at) VALUES ('${BobUserId}', digest('${BobToken}', 'sha256'), now() + interval '1 day', NULL) ON CONFLICT (token_hash) DO UPDATE SET expires_at = now() + interval '1 day', revoked_at = NULL;`;
execSync(`docker exec byos-postgres psql -U byos -d byos -c "${sessSql}"`, { encoding: 'utf8' });

// Fetch Alice & Bob cryptographic parameters
const aliceRow = execSync(`docker exec byos-postgres psql -U byos -d byos -t -A -c "SELECT encode(mailbox_xwing_pk, 'hex'), key_epoch FROM mailboxes WHERE id = '${AliceMailboxId}';"`, { encoding: 'utf8' }).trim();
const [aliceXwingPk, aliceEpoch] = aliceRow.split('|');

const bobRow = execSync(`docker exec byos-postgres psql -U byos -d byos -t -A -c "SELECT wrapped_sk_user, encode(mailbox_xwing_pk, 'hex'), key_epoch FROM mailboxes WHERE id = '${BobMailboxId}';"`, { encoding: 'utf8' }).trim();
const [bobWrapped, bobXwingPk, bobEpoch] = bobRow.split('|');
const bobParsed = JSON.parse(bobWrapped);
const bobSigningSeedHex = wasm.wasm_passphrase_unwrap_key('test-password-123', bobParsed.signing_salt, bobParsed.signing_envelope);

async function sendPathAMessage({ from, to, subject, headers = {}, body }) {
  let mime = `Subject: ${subject}\nFrom: ${from}\nTo: ${to}\nDate: ${new Date().toUTCString()}\n`;
  for (const [k, v] of Object.entries(headers)) {
    mime += `${k}: ${v}\n`;
  }
  mime += `\n${body}`;

  const mimeHex = bytesToHex(Buffer.from(mime));
  const recEnv = wasm.wasm_seal_xwing_envelope_signed(aliceXwingPk, AliceMailboxId, parseInt(aliceEpoch, 10), mimeHex, bobSigningSeedHex);
  const senderEnv = wasm.wasm_seal_xwing_envelope_signed(bobXwingPk, BobMailboxId, parseInt(bobEpoch, 10), mimeHex, bobSigningSeedHex);

  const res = await fetch('http://localhost:8080/v1/outbound/send-internal', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${BobToken}`,
    },
    body: JSON.stringify({
      envelope_json: recEnv,
      sender_envelope_json: senderEnv,
      recipient: to,
      sender_mailbox_id: BobMailboxId,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`send-internal failed: ${res.status} ${err}`);
  }
  return await res.json();
}

async function runOfflineSupportBrowserTests() {
  console.log("================================================================================");
  console.log("          OFFLINE SUPPORT BROWSER INTEGRATION TEST (E2E)                        ");
  console.log("================================================================================\n");

  // Clear Mailpit messages at setup
  await fetch('http://localhost:8025/api/v1/messages', { method: 'DELETE' }).catch(() => {});

  // Send an initial message from Bob to Alice
  const seedSubject = `Offline Seed Verification ${Date.now()}`;
  console.log(`[Setup] Sending seed message to Alice: "${seedSubject}"...`);
  await sendPathAMessage({
    from: 'bob@byos.local',
    to: 'alice@byos.local',
    subject: seedSubject,
    body: 'This is the plaintext body for testing offline cached reading.',
  });

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ['--no-sandbox', '--disable-gpu'],
  });

  const unhandledErrors = [];

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (
          !text.includes('/v1/auth/me') &&
          !text.includes('favicon') &&
          !text.includes('401 (Unauthorized)') &&
          !text.includes('Failed to load resource') &&
          !text.includes('net::ERR_INTERNET_DISCONNECTED') &&
          !text.includes('failed to connect to websocket')
        ) {
          unhandledErrors.push(text);
          console.error(`  [CONSOLE ERROR] ${text}`);
        }
      }
    });

    // =========================================================================
    // STEP 1: Real login flow as Alice
    // =========================================================================
    console.log("--- [STEP 1] Real login flow as Alice (alice@byos.local) ---");
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

    await page.waitForSelector('[data-testid="account-chip-selector"]', { timeout: 15000 });
    await sleep(1500);

    const activeUser = await page.$eval('[data-testid="account-chip-text"]', (el) => el.textContent.trim());
    console.log(`  Active account: "${activeUser}"`);
    assert(activeUser.includes('alice@byos.local'), "Alice logged in successfully via real credentials");

    // Add Bob as a connected account so Compose has multiple accounts to exercise Directive D3 (lock dropdown offline)
    const BobAccount = {
      id: BobMailboxId,
      email: "bob@byos.local",
      displayName: "Bob",
      sessionToken: BobToken,
      role: "owner",
      privacyMode: "standard",
      mailboxSkHex: "f74ba1810c540588f4ccce97eaa0efc82937c060c63453496147d6430183e376",
      searchKeyHex: "",
      signingSeedHex: "d2f874cbca57aa4df01b579d5fa48a8c3358721f0a73ede153fabadc9c4ee59a",
    };
    await page.evaluate((bo) => {
      let cur = [];
      try {
        cur = JSON.parse(sessionStorage.getItem('byos_connected_accounts') || '[]');
      } catch {}
      if (!cur.some((a) => a.id === bo.id)) {
        cur.push(bo);
        sessionStorage.setItem('byos_connected_accounts', JSON.stringify(cur));
        localStorage.setItem('byos_connected_accounts', JSON.stringify(cur));
      }
    }, BobAccount);

    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(2000);

    // Verify Service Worker is registered and active
    console.log("\n--- [STEP 2] Verify Service Worker registration ---");
    await page.waitForFunction(() => {
      return Boolean(navigator.serviceWorker && navigator.serviceWorker.controller);
    }, { timeout: 10000 }).catch(() => {});

    const isSwActive = await page.evaluate(() => Boolean(navigator.serviceWorker && navigator.serviceWorker.controller));
    assert(isSwActive, "Service worker registered (navigator.serviceWorker.controller non-null)");

    // =========================================================================
    // STEP 3: Verify Inbox loads and caches messages in IndexedDB (Directive D2)
    // =========================================================================
    console.log("\n--- [STEP 3] Verify Inbox loads and caches messages in IndexedDB ---");
    const inboxFolder = await page.waitForSelector('[data-testid="folder-inbox"]', { timeout: 5000 });
    await inboxFolder.click();
    await sleep(2000);

    // Wait for cached messages in IndexedDB 'byos-offline'
    await page.waitForFunction(async () => {
      return new Promise((resolve) => {
        const req = indexedDB.open('byos-offline', 1);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('messages')) return resolve(false);
          const tx = db.transaction('messages', 'readonly');
          const countReq = tx.objectStore('messages').count();
          countReq.onsuccess = () => resolve(countReq.result > 0);
          countReq.onerror = () => resolve(false);
        };
        req.onerror = () => resolve(false);
      });
    }, { timeout: 10000 });

    const cachedMessageCount = await page.evaluate(async () => {
      return new Promise((resolve) => {
        const req = indexedDB.open('byos-offline', 1);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('messages', 'readonly');
          const countReq = tx.objectStore('messages').count();
          countReq.onsuccess = () => resolve(countReq.result);
        };
      });
    });
    console.log(`  Cached messages count in IndexedDB: ${cachedMessageCount}`);
    assert(cachedMessageCount > 0 && cachedMessageCount <= 50, "Inbox messages cached in IndexedDB (max 50)");

    // Open first message online to cache ciphertext body envelope
    const firstRow = await page.waitForSelector('[data-testid="message-row"]', { timeout: 8000 });
    await firstRow.click();
    await sleep(2000);

    // Verify Directives D1 & D4
    const idbDump = await page.evaluate(async () => {
      return new Promise((resolve) => {
        const req = indexedDB.open('byos-offline', 1);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction(['messages', 'send_queue', 'drafts'], 'readonly');
          const mReq = tx.objectStore('messages').getAll();
          const qReq = tx.objectStore('send_queue').getAll();
          const dReq = tx.objectStore('drafts').getAll();
          let m, q, d;
          mReq.onsuccess = () => { m = mReq.result; check(); };
          qReq.onsuccess = () => { q = qReq.result; check(); };
          dReq.onsuccess = () => { d = dReq.result; check(); };
          function check() {
            if (m && q && d) resolve(JSON.stringify({ messages: m, queue: q, drafts: d }));
          }
        };
      });
    });

    assert(!idbDump.includes('byos_mailbox_sk_'), "D1: Unsealed mailbox sk is NOT in IndexedDB");
    assert(!idbDump.includes('byos_signing_seed_'), "D1: Unsealed signing seed is NOT in IndexedDB");
    assert(!idbDump.includes('byos_xwing_seed_'), "D1: Unsealed X-Wing seed is NOT in IndexedDB");
    assert(!idbDump.includes('This is the plaintext body'), "D4: Plaintext body is NOT stored on disk in IndexedDB");

    // =========================================================================
    // STEP 4: Emulate Offline via CDP and Test Shell Cache Reload
    // =========================================================================
    console.log("\n--- [STEP 4] Emulate network offline via CDP ---");
    const cdp = await page.target().createCDPSession();
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
    });
    await page.evaluate(() => {
      window.dispatchEvent(new Event('offline'));
    });
    await sleep(500);

    // Reload while offline to prove Service Worker serves shell
    console.log("  Testing offline reload of app shell from Service Worker cache...");
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="account-chip-selector"]', { timeout: 10000 });
    assert(true, "Reload offline loads the shell (sidebar rendered)");

    // Verify Offline Banner appears
    const offlineBanner = await page.waitForSelector('[data-testid="offline-status-banner"]', { timeout: 8000 });
    const bannerText = await page.$eval('[data-testid="offline-status-banner"]', (el) => el.textContent.trim());
    console.log(`  Offline Banner text: "${bannerText}"`);
    assert(bannerText.includes("You are offline"), "Offline banner appears");

    // Save screenshot
    const shotOffline = path.resolve(artifactsDir, 'offline_support.png');
    await page.screenshot({ path: shotOffline });
    console.log(`  Saved screenshot: ${shotOffline}`);

    // Verify cached message opens and decrypts offline
    const firstRowOffline = await page.waitForSelector('[data-testid="message-row"]', { timeout: 8000 });
    await firstRowOffline.click();
    await sleep(1500);
    const bodyContent = await page.evaluate(() => document.body.innerText);
    assert(bodyContent.includes("This is the plaintext body for testing offline cached reading"), "Cached message opens and decrypts");

    // =========================================================================
    // STEP 5: Verify Compose From dropdown locked offline (Directive D3)
    // =========================================================================
    console.log("\n--- [STEP 5] Verify Compose From dropdown locked offline (Directive D3) ---");
    const composeBtn = await page.waitForSelector('[data-testid="sidebar-compose-btn"]', { timeout: 5000 });
    await composeBtn.click();
    await sleep(800);

    await page.waitForSelector('[data-testid="compose-from-select"]', { timeout: 5000 });
    const isFromDisabled = await page.$eval('[data-testid="compose-from-select"]', (el) => el.disabled);
    const lockTooltip = await page.$eval('[data-testid="offline-from-lock"]', (el) => el.textContent.trim());
    assert(isFromDisabled && lockTooltip.includes("Switch accounts online to change sender"), "Compose From: is locked with a tooltip");

    // =========================================================================
    // STEP 6: Offline Compose and Local Send Queue (Directives D3 & D5)
    // =========================================================================
    console.log("\n--- [STEP 6] Compose and enqueue message offline ---");
    const toInput = await page.waitForSelector('#composeToInput', { timeout: 5000 });
    await toInput.type('offline_recipient@example.com');

    const subjInput = await page.waitForSelector('#composeSubjectInput', { timeout: 5000 });
    const offlineTestSubj = `Offline Queued Outbound Test ${Date.now()}`;
    await subjInput.type(offlineTestSubj);

    const bodyInput = await page.waitForSelector('[data-testid="compose-body-input"]', { timeout: 5000 });
    await bodyInput.type('Hello from offline queue via Service Worker!');

    const sendBtn = await page.waitForSelector('[data-testid="compose-send-btn"]', { timeout: 5000 });
    await sendBtn.click();

    // Verify Send offline shows "queued" toast
    await page.waitForFunction(() => {
      const texts = Array.from(document.querySelectorAll('*')).map((e) => e.textContent || '');
      return texts.some((t) => t.includes("Message queued to send on reconnect"));
    }, { timeout: 8000 });
    assert(true, 'Send offline shows "queued" toast');

    console.log("  Waiting for undo countdown to finish and local enqueue (~6s)...");
    await sleep(6500);

    // Verify item in IndexedDB send_queue
    const queuedItem = await page.evaluate(async () => {
      return new Promise((resolve) => {
        const req = indexedDB.open('byos-offline', 1);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('send_queue', 'readonly');
          const getAllReq = tx.objectStore('send_queue').getAll();
          getAllReq.onsuccess = () => {
            const items = getAllReq.result || [];
            resolve(items[0] || null);
          };
        };
      });
    });

    assert(queuedItem !== null && queuedItem.status === 'pending', "IndexedDB has the queue entry");
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    assert(uuidRegex.test(queuedItem.client_queue_id), "D5: Queued item has valid UUID client_queue_id");

    // =========================================================================
    // STEP 7: Reconnect Network and Verify Auto-Sync Replay (Directive D5)
    // =========================================================================
    console.log("\n--- [STEP 7] Reconnect network and verify queue replay ---");
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    await page.evaluate(() => {
      window.dispatchEvent(new Event('online'));
    });
    assert(true, "Network restored");

    // Verify "Back online" toast appears
    await page.waitForFunction(() => {
      const texts = Array.from(document.querySelectorAll('*')).map((e) => e.textContent || '');
      return texts.some((t) => t.includes("Back online"));
    }, { timeout: 15000 });
    assert(true, '"Back online" toast appears');

    console.log("  Waiting for replay to complete and empty send_queue...");
    await page.waitForFunction(async () => {
      return new Promise((resolve) => {
        const req = indexedDB.open('byos-offline', 1);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('send_queue', 'readonly');
          const getAllReq = tx.objectStore('send_queue').getAll();
          getAllReq.onsuccess = () => {
            const items = getAllReq.result || [];
            const pending = items.filter((i) => i.status === 'pending');
            resolve(pending.length === 0);
          };
          getAllReq.onerror = () => resolve(false);
        };
        req.onerror = () => resolve(false);
      });
    }, { timeout: 15000 });

    assert(true, "Queue is empty");

    // =========================================================================
    // STEP 8: Verify Mailpit Delivery and No Console Errors
    // =========================================================================
    console.log("\n--- [STEP 8] Verify Mailpit delivery ---");
    let mailpitFound = false;
    for (let i = 0; i < 20; i++) {
      await sleep(1000);
      try {
        const mpRes = await fetch('http://localhost:8025/api/v1/messages');
        if (mpRes.ok) {
          const mpData = await mpRes.json();
          const match = (mpData.messages || []).find((m) =>
            m.To?.some((t) => t.Address === 'offline_recipient@example.com')
          );
          if (match) {
            mailpitFound = true;
            break;
          }
        }
      } catch {}
    }
    assert(mailpitFound, "Mailpit shows the delivered message");

    // Check for any unhandled console errors
    assert(unhandledErrors.length === 0, "No console errors");

    console.log("\n================================================================================");
    console.log("          ALL OFFLINE SUPPORT BROWSER TESTS PASSED CLEANLY                      ");
    console.log("================================================================================\n");

  } finally {
    await browser.close();
  }
}

runOfflineSupportBrowserTests().catch((err) => {
  console.error("\nTEST SUITE FAILED WITH EXCEPTION:\n", err);
  process.exit(1);
});
