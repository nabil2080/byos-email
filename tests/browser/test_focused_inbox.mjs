import puppeteer from '../../apps/webmail/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as wasm from '../../apps/webmail/src/generated/crypto-core/byos_crypto_core.js';
import { bytesToHex } from '../../apps/webmail/src/attachment_crypto.ts';

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

const BobToken = 'bob_manual_test_session_token_123';
const BobUserId = 'cccccccc-0000-0000-0000-000000000003';
const BobMailboxId = 'c0000000-0000-0000-0000-000000000002';
const AliceMailboxId = 'c0000000-0000-0000-0000-000000000001';

// Ensure Bob session exists in DB
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

async function runFocusedInboxTests() {
  console.log("================================================================================");
  console.log("               FOCUSED INBOX END-TO-END BROWSER VERIFICATION                   ");
  console.log("================================================================================\n");

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ['--no-sandbox', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    // Track unhandled errors
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (!text.includes('/v1/auth/me') && !text.includes('favicon') && !text.includes('401 (Unauthorized)')) {
          console.error(`  [CONSOLE ERROR] ${text}`);
        }
      }
    });

    // =========================================================================
    // STEP 1: Log in as Alice
    // =========================================================================
    console.log("--- [STEP 1] Log in as Alice (alice@byos.local) ---");
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

    // =========================================================================
    // STEP 2: Navigate to Inbox and Confirm Four Tabs Render
    // =========================================================================
    console.log("\n--- [STEP 2] Verify Four Focused Inbox Tabs ---");
    const inboxFolder = await page.waitForSelector('[data-testid="folder-inbox"]', { timeout: 5000 });
    await inboxFolder.click();
    await sleep(1000);

    await page.waitForSelector('[data-testid="focused-inbox-tabs"]', { timeout: 5000 });
    const tabPrimary = await page.waitForSelector('[data-testid="category-tab-primary"]', { timeout: 5000 });
    const tabNotifications = await page.waitForSelector('[data-testid="category-tab-notifications"]', { timeout: 5000 });
    const tabNewsletters = await page.waitForSelector('[data-testid="category-tab-newsletters"]', { timeout: 5000 });
    const tabSocial = await page.waitForSelector('[data-testid="category-tab-social"]', { timeout: 5000 });

    assert(Boolean(tabPrimary), "Primary tab renders");
    assert(Boolean(tabNotifications), "Notifications tab renders");
    assert(Boolean(tabNewsletters), "Newsletters tab renders");
    assert(Boolean(tabSocial), "Social tab renders");

    // Verify Primary tab is active by default
    const isPrimaryActive = await page.$eval('[data-testid="category-tab-primary"]', (el) => el.getAttribute('aria-selected') === 'true');
    assert(isPrimaryActive, "Primary tab is active by default");

    const shotTabs = path.resolve(artifactsDir, 'focused_inbox_tabs.png');
    await page.screenshot({ path: shotTabs });
    console.log(`  Saved screenshot: ${shotTabs}`);

    // =========================================================================
    // STEP 3: Send Test Messages to Alice
    // =========================================================================
    console.log("\n--- [STEP 3] Send Test Messages via Path A Outbound ---");
    const ts = Date.now();
    const primarySubject = `Team Roadmap Planning ${ts}`;
    const newslettersSubject = `Tech Weekly Digest Issue 92 ${ts}`;
    const notificationsSubject = `Your order confirmation #${ts.toString().slice(-6)}`;
    const socialSubject = `Alice, you appeared in 8 searches ${ts}`;

    // 1. Primary from bob@byos.local
    console.log("  Sending Primary message from bob@byos.local...");
    const resPrimary = await sendPathAMessage({
      from: 'bob@byos.local',
      to: 'alice@byos.local',
      subject: primarySubject,
      body: 'Hi Alice, let us review the sprint roadmap tomorrow morning.',
    });
    assert(Boolean(resPrimary.message_id), "Primary message sent successfully");

    // 2. Newsletters with List-Unsubscribe header
    console.log("  Sending Newsletters message with List-Unsubscribe header...");
    const resNews = await sendPathAMessage({
      from: 'newsletter@techdigest.com',
      to: 'alice@byos.local',
      subject: newslettersSubject,
      headers: {
        'List-Unsubscribe': '<https://techdigest.com/unsub>',
        'List-Id': '<digest.techdigest.com>',
      },
      body: 'Here is your weekly technology newsletter digest with the latest updates.',
    });
    assert(Boolean(resNews.message_id), "Newsletters message sent successfully");

    // 3. Notifications from notifications@external.test with order confirmation subject
    console.log("  Sending Notifications message from notifications@external.test...");
    const resNotif = await sendPathAMessage({
      from: 'notifications@external.test',
      to: 'alice@byos.local',
      subject: notificationsSubject,
      body: 'Thank you for your business. Your order confirmation receipt is enclosed.',
    });
    assert(Boolean(resNotif.message_id), "Notifications message sent successfully");

    // 4. Social from updates@linkedin.com
    console.log("  Sending Social message from updates@linkedin.com...");
    const resSocial = await sendPathAMessage({
      from: 'updates@linkedin.com',
      to: 'alice@byos.local',
      subject: socialSubject,
      body: 'Multiple recruiters and colleagues looked at your profile this week.',
    });
    assert(Boolean(resSocial.message_id), "Social message sent successfully");

    // =========================================================================
    // STEP 4: Confirm Each Message Appears in the Correct Tab
    // =========================================================================
    console.log("\n--- [STEP 4] Verify Categorization Across All Tabs ---");

    // Wait for all 4 messages to be fetched and decrypted
    console.log("  Waiting for background decryption of all 4 inbound messages...");
    let allDecrypted = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      const refreshBtn = await page.$('button[title="Refresh mail"]');
      if (refreshBtn) {
        await refreshBtn.click();
      } else {
        await inboxFolder.click();
      }
      await sleep(1500);

      const decryptedSubjects = await page.evaluate(() => {
        const keys = Object.keys(sessionStorage).filter((k) => k.startsWith('byos_msg_subject_'));
        return keys.map((k) => sessionStorage.getItem(k) || '');
      });

      console.log(`  [Poll ${attempt}] Decrypted subjects in session (${decryptedSubjects.length}):`, JSON.stringify(decryptedSubjects));

      const hasPrimary = decryptedSubjects.some((s) => s.includes(primarySubject));
      const hasNews = decryptedSubjects.some((s) => s.includes(newslettersSubject));
      const hasNotif = decryptedSubjects.some((s) => s.includes(notificationsSubject));
      const hasSocial = decryptedSubjects.some((s) => s.includes(socialSubject));

      console.log(`  Flags: primary=${hasPrimary}, news=${hasNews}, notif=${hasNotif}, social=${hasSocial}`);

      if (hasPrimary && hasNews && hasNotif && hasSocial) {
        allDecrypted = true;
        console.log("  All 4 inbound messages successfully fetched and decrypted.");
        break;
      }
      await sleep(1500);
    }
    assert(allDecrypted, "All 4 test messages arrived and decrypted in session");

    // 4A. Verify Primary tab
    console.log("  Verifying Primary tab content...");
    await page.click('[data-testid="category-tab-primary"]');
    await sleep(800);

    const debugSessionInfo = await page.evaluate(() => {
      const cats = {};
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && (k.startsWith('byos_msg_category_') || k.startsWith('byos_msg_subject_'))) {
          cats[k] = sessionStorage.getItem(k);
        }
      }
      const rows = Array.from(document.querySelectorAll('[data-testid="message-row"]')).map((r) => r.textContent.trim());
      return { cats, rows };
    });
    console.log("  Debug Session Categories & Subjects:", JSON.stringify(debugSessionInfo.cats, null, 2));
    console.log("  Primary Tab Rows Count:", debugSessionInfo.rows.length);
    console.log("  Primary Tab Rows Content:", JSON.stringify(debugSessionInfo.rows, null, 2));

    const primaryRowSubjects = debugSessionInfo.rows;
    assert(
      primaryRowSubjects.some((txt) => txt.includes(primarySubject)),
      "Primary message appears in Primary tab"
    );
    assert(
      !primaryRowSubjects.some((txt) => txt.includes(newslettersSubject)),
      "Newsletters message does NOT appear in Primary tab"
    );
    assert(
      !primaryRowSubjects.some((txt) => txt.includes(notificationsSubject)),
      "Notifications message does NOT appear in Primary tab"
    );
    assert(
      !primaryRowSubjects.some((txt) => txt.includes(socialSubject)),
      "Social message does NOT appear in Primary tab"
    );

    // 4B. Verify Notifications tab and badge
    console.log("  Verifying Notifications tab content and unread badge...");
    await page.click('[data-testid="category-tab-notifications"]');
    await sleep(800);

    const notifRowSubjects = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('[data-testid="message-row"]'));
      return rows.map((r) => r.textContent);
    });
    assert(
      notifRowSubjects.some((txt) => txt.includes(notificationsSubject)),
      "Notifications message appears in Notifications tab"
    );
    assert(
      !notifRowSubjects.some((txt) => txt.includes(primarySubject)),
      "Primary message does NOT appear in Notifications tab"
    );

    const notifBadgeExists = await page.evaluate(() => {
      const badge = document.querySelector('[data-testid="category-badge-notifications"]');
      return badge ? badge.textContent.trim() : null;
    });
    console.log(`  Notifications unread count badge: ${notifBadgeExists}`);
    assert(Boolean(notifBadgeExists) && parseInt(notifBadgeExists, 10) >= 1, "Notifications tab shows unread badge >= 1");

    // 4C. Verify Newsletters tab
    console.log("  Verifying Newsletters tab content...");
    await page.click('[data-testid="category-tab-newsletters"]');
    await sleep(800);

    const newsRowSubjects = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('[data-testid="message-row"]'));
      return rows.map((r) => r.textContent);
    });
    assert(
      newsRowSubjects.some((txt) => txt.includes(newslettersSubject)),
      "Newsletters message appears in Newsletters tab"
    );
    assert(
      !newsRowSubjects.some((txt) => txt.includes(primarySubject)),
      "Primary message does NOT appear in Newsletters tab"
    );

    // 4D. Verify Social tab
    console.log("  Verifying Social tab content...");
    await page.click('[data-testid="category-tab-social"]');
    await sleep(800);

    const socialRowSubjects = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('[data-testid="message-row"]'));
      return rows.map((r) => r.textContent);
    });
    assert(
      socialRowSubjects.some((txt) => txt.includes(socialSubject)),
      "Social message appears in Social tab"
    );
    assert(
      !socialRowSubjects.some((txt) => txt.includes(primarySubject)),
      "Primary message does NOT appear in Social tab"
    );

    const shotCategorized = path.resolve(artifactsDir, 'focused_inbox_categorized.png');
    await page.screenshot({ path: shotCategorized });
    console.log(`  Saved screenshot: ${shotCategorized}`);

    // =========================================================================
    // STEP 5: Right-click Message and "Move to…" Category Override
    // =========================================================================
    console.log("\n--- [STEP 5] Right-click Override: Move Newsletters -> Primary ---");
    // Switch to Newsletters tab to find the message
    await page.click('[data-testid="category-tab-newsletters"]');
    await sleep(800);

    // Locate the Newsletters message row
    const targetRowHandle = await page.evaluateHandle((subj) => {
      const rows = Array.from(document.querySelectorAll('[data-testid="message-row"]'));
      return rows.find((r) => r.textContent.includes(subj)) || rows[0];
    }, newslettersSubject);

    // Trigger right-click context menu
    await page.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const evt = new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: rect.left + 50,
        clientY: rect.top + 15,
      });
      el.dispatchEvent(evt);
    }, targetRowHandle);
    await sleep(800);

    // Verify context menu is visible
    const moveToPrimaryBtn = await page.waitForSelector('[data-testid="move-to-primary"]', { timeout: 5000 });
    assert(Boolean(moveToPrimaryBtn), "'Move to Primary' menu item renders upon right-click");

    const shotOverrideMenu = path.resolve(artifactsDir, 'focused_inbox_override_menu.png');
    await page.screenshot({ path: shotOverrideMenu });
    console.log(`  Saved screenshot: ${shotOverrideMenu}`);

    // Click "Move to Primary"
    console.log("  Clicking 'Move to Primary'...");
    await moveToPrimaryBtn.click();
    await sleep(1200);

    // Verify message removed from Newsletters tab
    const newsRowsAfterMove = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('[data-testid="message-row"]'));
      return rows.map((r) => r.textContent);
    });
    assert(
      !newsRowsAfterMove.some((txt) => txt.includes(newslettersSubject)),
      "Newsletters message disappeared from Newsletters tab after move"
    );

    // Verify message now appears in Primary tab
    await page.click('[data-testid="category-tab-primary"]');
    await sleep(800);
    const primaryRowsAfterMove = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('[data-testid="message-row"]'));
      return rows.map((r) => r.textContent);
    });
    assert(
      primaryRowsAfterMove.some((txt) => txt.includes(newslettersSubject)),
      "Newsletters message now appears in Primary tab via override"
    );

    // =========================================================================
    // STEP 6: Reload and Confirm Override Persists in sessionStorage
    // =========================================================================
    console.log("\n--- [STEP 6] Page Reload: Verify Session Override Persistence ---");
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(2500);

    // Ensure we are in Inbox Primary tab
    await page.waitForSelector('[data-testid="folder-inbox"]', { timeout: 10000 });
    await page.click('[data-testid="folder-inbox"]');
    await sleep(1000);
    await page.click('[data-testid="category-tab-primary"]');
    await sleep(800);

    const primaryRowsAfterReload = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('[data-testid="message-row"]'));
      return rows.map((r) => r.textContent);
    });
    assert(
      primaryRowsAfterReload.some((txt) => txt.includes(newslettersSubject)),
      "Override persists across page reload in sessionStorage"
    );

    // Check sessionStorage contains key
    const sessionOverrideKeys = await page.evaluate(() => {
      const keys = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith('byos_msg_category_override_')) {
          keys.push({ key: k, value: sessionStorage.getItem(k) });
        }
      }
      return keys;
    });
    console.log("  sessionStorage category override entries:", JSON.stringify(sessionOverrideKeys));
    assert(sessionOverrideKeys.length >= 1, "sessionStorage contains category override key");
    assert(sessionOverrideKeys.some((e) => e.value === 'primary'), "sessionStorage override maps to 'primary'");

    // =========================================================================
    // STEP 7: Settings Toggle: Disable Focused Inbox
    // =========================================================================
    console.log("\n--- [STEP 7] Settings Toggle: Disable Focused Inbox ---");
    await page.waitForSelector('[data-testid="sidebar-settings-btn"]', { timeout: 5000 });
    await page.click('[data-testid="sidebar-settings-btn"]');
    await sleep(1000);

    await page.waitForSelector('[data-testid="settings-tab-appearance"]', { timeout: 5000 });
    await page.click('[data-testid="settings-tab-appearance"]');
    await sleep(1000);

    // Find Focused Inbox toggle
    await page.waitForSelector('[data-testid="focused-inbox-toggle"]', { timeout: 5000 });
    const isCurrentlyChecked = await page.$eval('[data-testid="focused-inbox-toggle"]', (el) => el.checked);
    assert(isCurrentlyChecked, "Focused Inbox toggle is initially checked (enabled by default)");

    // Click toggle label or input to toggle off
    await page.click('[data-testid="focused-inbox-toggle-label"]');
    await sleep(1000);

    const isNowChecked = await page.$eval('[data-testid="focused-inbox-toggle"]', (el) => el.checked);
    assert(!isNowChecked, "Focused Inbox toggle is now unchecked");

    // Return to Inbox
    console.log("  Returning to Inbox with Focused Inbox disabled...");
    await page.waitForSelector('[data-testid="settings-back-to-inbox-btn"]', { timeout: 5000 });
    await page.click('[data-testid="settings-back-to-inbox-btn"]');
    await sleep(1500);

    // Confirm tabs are hidden
    const tabsContainerAfterDisable = await page.$('[data-testid="focused-inbox-tabs"]');
    assert(tabsContainerAfterDisable === null, "Focused Inbox category tabs are hidden when feature is disabled");

    // Confirm all messages appear in a single unified list
    const unifiedRows = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('[data-testid="message-row"]'));
      return rows.map((r) => r.textContent);
    });
    assert(
      unifiedRows.some((txt) => txt.includes(primarySubject)),
      "Primary message appears in unified single list"
    );
    assert(
      unifiedRows.some((txt) => txt.includes(newslettersSubject)),
      "Newsletters message appears in unified single list"
    );
    assert(
      unifiedRows.some((txt) => txt.includes(notificationsSubject)),
      "Notifications message appears in unified single list"
    );
    assert(
      unifiedRows.some((txt) => txt.includes(socialSubject)),
      "Social message appears in unified single list"
    );

    const shotDisabled = path.resolve(artifactsDir, 'focused_inbox_disabled.png');
    await page.screenshot({ path: shotDisabled });
    console.log(`  Saved screenshot: ${shotDisabled}`);

    // =========================================================================
    // STEP 8: Re-enable Focused Inbox in Settings
    // =========================================================================
    console.log("\n--- [STEP 8] Re-enable Focused Inbox in Settings ---");
    await page.waitForSelector('[data-testid="sidebar-settings-btn"]', { timeout: 5000 });
    await page.click('[data-testid="sidebar-settings-btn"]');
    await sleep(1000);
    await page.waitForSelector('[data-testid="settings-tab-appearance"]', { timeout: 5000 });
    await page.click('[data-testid="settings-tab-appearance"]');
    await sleep(1000);

    await page.click('[data-testid="focused-inbox-toggle-label"]');
    await sleep(1000);

    const reenabledCheck = await page.$eval('[data-testid="focused-inbox-toggle"]', (el) => el.checked);
    assert(reenabledCheck, "Focused Inbox toggle re-enabled");

    await page.waitForSelector('[data-testid="settings-back-to-inbox-btn"]', { timeout: 5000 });
    await page.click('[data-testid="settings-back-to-inbox-btn"]');
    await sleep(1500);

    const tabsContainerReenabled = await page.$('[data-testid="focused-inbox-tabs"]');
    assert(tabsContainerReenabled !== null, "Focused Inbox category tabs reappear when feature is re-enabled");

    // Confirm previous override to Primary still holds
    await page.click('[data-testid="category-tab-primary"]');
    await sleep(800);
    const primaryRowsFinal = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('[data-testid="message-row"]'));
      return rows.map((r) => r.textContent);
    });
    assert(
      primaryRowsFinal.some((txt) => txt.includes(newslettersSubject)),
      "Previously overridden message remains in Primary tab after re-enabling"
    );

    console.log("\n================================================================================");
    console.log("            ALL FOCUSED INBOX CHECKS PASSED CLEANLY (8/8)                       ");
    console.log("================================================================================\n");
  } finally {
    await browser.close();
  }
}

runFocusedInboxTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("Test execution failed:", err);
    process.exit(1);
  });
