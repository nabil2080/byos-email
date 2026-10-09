import puppeteer from '../../apps/webmail/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import path from 'node:path';
import fs from 'node:fs';
import net from 'node:net';
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

async function runManualComposeFlows() {
  console.log("================================================================================");
  console.log("      COMPREHENSIVE VERIFICATION: DIRECTION, REPLIES, AND RAPID CYCLES          ");
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

    console.log("--- [STEP 0] Real Login Flow: Authenticate as Alice ---");
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

    // Create a masked alias for Alice via Settings while Alice is active
    console.log("--- [STEP 0b] Create a masked alias for Alice ---");
    const settingsBtn = await page.waitForSelector('[data-testid="sidebar-settings-btn"]', { timeout: 5000 });
    await settingsBtn.click();
    await sleep(800);

    const maskedEmailTab = await page.waitForSelector('[data-testid="settings-tab-masked-email"]', { timeout: 5000 });
    await maskedEmailTab.click();
    await sleep(1000);

    const genAliasBtn = await page.waitForSelector('[data-testid="generate-alias-btn"]', { timeout: 5000 });
    await genAliasBtn.click();
    await sleep(800);

    // Enter label and create random alias
    await page.waitForSelector('[data-testid="alias-label-input"]', { timeout: 5000 });
    await page.type('[data-testid="alias-label-input"]', 'Shopping Flow Test');
    const createAliasBtn = await page.waitForSelector('[data-testid="alias-create-submit-btn"]', { timeout: 5000 });
    await createAliasBtn.click();
    await sleep(2000);

    // Read created alias address from table
    const createdAliasAddress = await page.evaluate(() => {
      const row = document.querySelector('table tbody tr');
      const fontMono = row ? row.querySelector('.select-all, font-mono') : null;
      return fontMono ? fontMono.textContent.trim() : '';
    });
    console.log(`  Created masked alias: "${createdAliasAddress}"`);
    assert(createdAliasAddress.includes('@masked.byos.local'), "Masked alias created successfully");

    // Return to Inbox
    const backBtn = await page.waitForSelector('[data-testid="settings-back-to-inbox-btn"]', { timeout: 5000 });
    await backBtn.click();
    await sleep(1500);

    // Connect Bob via Add Mailbox modal
    console.log("--- [STEP 0c] Connect Bob via Add Mailbox modal ---");
    const accountTrigger = await page.waitForSelector('[data-testid="account-chip-selector"]', { timeout: 5000 });
    await accountTrigger.click();
    await sleep(600);

    const addMailboxBtn = await page.waitForSelector('[data-testid="add-mailbox-button"]', { timeout: 5000 });
    await addMailboxBtn.click();
    await sleep(800);

    // Type Bob's credentials into modal
    const emailInputs = await page.$$('input[type="email"]');
    const modalEmailInput = emailInputs[emailInputs.length - 1];
    await modalEmailInput.type('bob@byos.local');

    const passInputs = await page.$$('input[type="password"]');
    const modalPassInput = passInputs[passInputs.length - 1];
    await modalPassInput.type('test-password-123');

    // Submit modal
    const modalSubmitBtn = await page.evaluateHandle(() => {
      const modal = document.querySelector('[role="dialog"], .fixed.inset-0.z-50');
      return modal ? modal.querySelector('button[type="submit"]') : null;
    });
    await modalSubmitBtn.click();
    await sleep(2500);
    console.log("  Bob added to connected accounts successfully.");

    // Retrieve accounts and mailbox IDs
    const accountsInfo = await page.evaluate(() => {
      const stored = sessionStorage.getItem('byos_connected_accounts');
      return stored ? JSON.parse(stored) : [];
    });
    console.log("  Connected accounts in session:", JSON.stringify(accountsInfo.map(a => ({ email: a.email, id: a.id }))));
    const aliceId = accountsInfo.find(a => a.email.includes('alice'))?.id || "c0000000-0000-0000-0000-000000000001";
    const bobId = accountsInfo.find(a => a.email.includes('bob'))?.id || "c0000000-0000-0000-0000-000000000002";

    // Helper functions
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
      await sleep(600);
    }

    // =========================================================================
    // SECTION 1: Reverse the browser test direction manually
    // Open webmail → log in as alice → switch to bob → open compose (From: bob)
    // Close → switch to alice → open compose (From: alice)
    // Close → switch to bob → open compose (From: bob)
    // Close → switch to alice → open compose (From: alice)
    // =========================================================================
    console.log("\n================================================================================");
    console.log("  1. REVERSE BROWSER TEST DIRECTION: BOB -> ALICE -> BOB -> ALICE              ");
    console.log("================================================================================");

    // 1.1 Switch to bob -> open compose (From: bob)
    console.log("\n[Step 1.1] Switch to Bob -> open compose");
    await switchToAccount(bobId, 'bob@byos.local');
    const composeBtn1 = await page.waitForSelector('[data-testid="sidebar-compose-btn"]', { timeout: 5000 });
    await composeBtn1.click();
    await sleep(800);

    const fromState1 = await getComposeFromDetails();
    console.log(`  Step 1.1 Observed From: text="${fromState1.text}" (value: "${fromState1.value}")`);
    assert(fromState1.value === `account:${bobId}`, `Value is account:${bobId}`);
    assert(fromState1.text.includes('bob@byos.local'), `Text is bob@byos.local`);
    assert(!fromState1.text.includes('alice@byos.local'), `Text does NOT leak alice@byos.local`);

    const shot1 = path.resolve(artifactsDir, 'reverse_test_1_bob.png');
    await page.screenshot({ path: shot1 });
    console.log(`  Saved screenshot: ${shot1}`);

    // 1.2 Close -> switch to alice -> open compose (From: alice)
    console.log("\n[Step 1.2] Close compose -> switch to Alice -> open compose");
    await closeCompose();
    await switchToAccount(aliceId, 'alice@byos.local');

    const composeBtn2 = await page.waitForSelector('[data-testid="sidebar-compose-btn"]', { timeout: 5000 });
    await composeBtn2.click();
    await sleep(800);

    const fromState2 = await getComposeFromDetails();
    console.log(`  Step 1.2 Observed From: text="${fromState2.text}" (value: "${fromState2.value}")`);
    assert(fromState2.value === `account:${aliceId}`, `Value is account:${aliceId}`);
    assert(fromState2.text.includes('alice@byos.local'), `Text is alice@byos.local`);
    assert(!fromState2.text.includes('bob@byos.local'), `Text does NOT leak bob@byos.local`);

    const shot2 = path.resolve(artifactsDir, 'reverse_test_2_alice.png');
    await page.screenshot({ path: shot2 });
    console.log(`  Saved screenshot: ${shot2}`);

    // 1.3 Close -> switch to bob -> open compose (From: bob)
    console.log("\n[Step 1.3] Close compose -> switch to Bob -> open compose");
    await closeCompose();
    await switchToAccount(bobId, 'bob@byos.local');

    const composeBtn3 = await page.waitForSelector('[data-testid="sidebar-compose-btn"]', { timeout: 5000 });
    await composeBtn3.click();
    await sleep(800);

    const fromState3 = await getComposeFromDetails();
    console.log(`  Step 1.3 Observed From: text="${fromState3.text}" (value: "${fromState3.value}")`);
    assert(fromState3.value === `account:${bobId}`, `Value is account:${bobId}`);
    assert(fromState3.text.includes('bob@byos.local'), `Text is bob@byos.local`);
    assert(!fromState3.text.includes('alice@byos.local'), `Text does NOT leak alice@byos.local`);

    const shot3 = path.resolve(artifactsDir, 'reverse_test_3_bob.png');
    await page.screenshot({ path: shot3 });
    console.log(`  Saved screenshot: ${shot3}`);

    // 1.4 Close -> switch to alice -> open compose (From: alice)
    console.log("\n[Step 1.4] Close compose -> switch to Alice -> open compose");
    await closeCompose();
    await switchToAccount(aliceId, 'alice@byos.local');

    const composeBtn4 = await page.waitForSelector('[data-testid="sidebar-compose-btn"]', { timeout: 5000 });
    await composeBtn4.click();
    await sleep(800);

    const fromState4 = await getComposeFromDetails();
    console.log(`  Step 1.4 Observed From: text="${fromState4.text}" (value: "${fromState4.value}")`);
    assert(fromState4.value === `account:${aliceId}`, `Value is account:${aliceId}`);
    assert(fromState4.text.includes('alice@byos.local'), `Text is alice@byos.local`);
    assert(!fromState4.text.includes('bob@byos.local'), `Text does NOT leak bob@byos.local`);

    const shot4 = path.resolve(artifactsDir, 'reverse_test_4_alice.png');
    await page.screenshot({ path: shot4 });
    console.log(`  Saved screenshot: ${shot4}`);
    await closeCompose();

    // =========================================================================
    // SECTION 2: Reply path
    // In Alice's inbox, open a message from Bob. Click Reply. Must be alice@byos.local.
    // =========================================================================
    console.log("\n================================================================================");
    console.log("  2. REPLY PATH: OPEN MESSAGE FROM BOB IN ALICE'S INBOX -> CLICK REPLY         ");
    console.log("================================================================================");

    // Ensure Bob is active, compose and send message to Alice
    console.log("  Sending an outbound message from Bob to Alice via webmail...");
    await switchToAccount(bobId, 'bob@byos.local');
    const composeBtnBob = await page.waitForSelector('[data-testid="sidebar-compose-btn"]', { timeout: 5000 });
    await composeBtnBob.click();
    await sleep(800);

    const toInput = await page.waitForSelector('#composeToInput', { timeout: 5000 });
    await toInput.type('alice@byos.local');
    const subjInput = await page.waitForSelector('#composeSubjectInput', { timeout: 5000 });
    const testBobSubj = `Project Proposal ${Date.now().toString(36)}`;
    await subjInput.type(testBobSubj);

    const bodyInput = await page.waitForSelector('[data-testid="compose-body-input"]', { timeout: 5000 });
    await bodyInput.type('Hi Alice, please review the proposal and reply when ready.');

    const sendBtn = await page.waitForSelector('[data-testid="compose-send-btn"]', { timeout: 5000 });
    await sendBtn.click();
    console.log("  Waiting for undo countdown & send dispatch (7.5s)...");
    await sleep(7500);
    console.log(`  Sent message with subject: "${testBobSubj}"`);

    // Switch back to Alice
    await switchToAccount(aliceId, 'alice@byos.local');

    // Refresh inbox
    const inboxFolder = await page.waitForSelector('[data-testid="folder-inbox"]', { timeout: 5000 });
    await inboxFolder.click();
    await sleep(2000);

    // Find message from Bob with retry
    console.log(`  Looking for message from Bob with subject "${testBobSubj}" in Alice's Inbox...`);
    let bobMsgFound = false;
    for (let attempt = 0; attempt < 8; attempt++) {
      bobMsgFound = await page.evaluate((subj) => {
        const rows = document.querySelectorAll('[data-testid="message-row"]');
        for (const row of rows) {
          if (row.textContent.includes(subj) || row.textContent.includes('bob@byos.local')) {
            row.click();
            return true;
          }
        }
        return false;
      }, testBobSubj);
      if (bobMsgFound) break;
      await inboxFolder.click();
      await sleep(1500);
    }
    assert(bobMsgFound, "Message from Bob found in Alice's inbox and opened");
    await sleep(2500);

    // Click Reply
    const replyBtn = await page.waitForSelector('[data-testid="reading-pane-reply-btn"]', { timeout: 12000 });
    await replyBtn.click();
    await sleep(1200);

    const replyFromDetails = await getComposeFromDetails();
    console.log(`  Reply From details: text="${replyFromDetails.text}" (value: "${replyFromDetails.value}")`);
    assert(replyFromDetails.value === `account:${aliceId}`, `Reply From value is account:${aliceId}`);
    assert(replyFromDetails.text.includes('alice@byos.local'), `Reply From text is alice@byos.local`);
    assert(!replyFromDetails.text.includes('bob@byos.local'), `Reply From does NOT leak Bob's address`);

    const shotReply = path.resolve(artifactsDir, 'reply_path_from_alice.png');
    await page.screenshot({ path: shotReply });
    console.log(`  Saved screenshot: ${shotReply}`);
    await closeCompose();

    // =========================================================================
    // SECTION 3: Alias reply path
    // Open a message that arrived via a masked alias. Click Reply. Must be alias address.
    // =========================================================================
    console.log("\n================================================================================");
    console.log("  3. ALIAS REPLY PATH: OPEN ALIAS MESSAGE -> CLICK REPLY                        ");
    console.log("================================================================================");

    // Send inbound SMTP message to createdAliasAddress
    const aliasMailSubj = `Order #${Date.now().toString(36)} Confirmation`;
    console.log(`  Sending inbound SMTP to ${createdAliasAddress} with subject "${aliasMailSubj}"...`);
    const smtpRes = await sendInboundSMTP({
      from: 'orders@external-merchant.com',
      to: createdAliasAddress,
      subject: aliasMailSubj,
      body: 'Your receipt for recent purchase. Reply to contact merchant support.',
    });
    console.log(`  Inbound SMTP delivery result: code=${smtpRes.code}`);
    assert(smtpRes.code === 250, "Inbound SMTP delivered successfully");

    // Refresh Alice inbox
    await inboxFolder.click();
    await sleep(2000);

    // Find alias message in Alice's inbox with retry
    console.log(`  Looking for alias message with subject "${aliasMailSubj}" in Alice's Inbox...`);
    let aliasMsgFound = false;
    for (let attempt = 0; attempt < 8; attempt++) {
      aliasMsgFound = await page.evaluate((subj) => {
        const rows = document.querySelectorAll('[data-testid="message-row"]');
        for (const row of rows) {
          if (row.textContent.includes(subj) || row.textContent.includes('orders@external-merchant.com')) {
            row.click();
            return true;
          }
        }
        return false;
      }, aliasMailSubj);
      if (aliasMsgFound) break;
      await inboxFolder.click();
      await sleep(1500);
    }
    assert(aliasMsgFound, "Alias message found in Alice's inbox and opened");
    await sleep(2000);

    // Verify Reading Pane alias badge
    await page.waitForSelector('[data-testid="reading-pane-alias-badge"]', { timeout: 8000 });
    const badgeText = await page.$eval('[data-testid="reading-pane-alias-badge"]', el => el.textContent.trim());
    console.log(`  Reading Pane alias badge text: "${badgeText}"`);

    // Click Reply
    const aliasReplyBtn = await page.waitForSelector('[data-testid="reading-pane-reply-btn"]', { timeout: 12000 });
    await aliasReplyBtn.click();
    await sleep(1200);

    const aliasReplyFrom = await getComposeFromDetails();
    console.log(`  Alias Reply From details: text="${aliasReplyFrom.text}" (value: "${aliasReplyFrom.value}")`);
    assert(aliasReplyFrom.value === `alias:${createdAliasAddress}`, `Value is alias:${createdAliasAddress}`);
    assert(aliasReplyFrom.text.includes(createdAliasAddress), `Text is alias address ${createdAliasAddress}`);
    assert(!aliasReplyFrom.text.includes('alice@byos.local'), "Text does NOT leak alice's real address");

    const shotAliasReply = path.resolve(artifactsDir, 'reply_path_from_alias.png');
    await page.screenshot({ path: shotAliasReply });
    console.log(`  Saved screenshot: ${shotAliasReply}`);
    await closeCompose();

    // =========================================================================
    // SECTION 4: Rapid cycles
    // Open/close the compose drawer 10 times in a row with Bob active.
    // Report whether From: ever drifts to alice.
    // =========================================================================
    console.log("\n================================================================================");
    console.log("  4. RAPID CYCLES: OPEN/CLOSE COMPOSE 10 TIMES WITH BOB ACTIVE                  ");
    console.log("================================================================================");

    await switchToAccount(bobId, 'bob@byos.local');

    let driftedCount = 0;
    for (let i = 1; i <= 10; i++) {
      const compBtn = await page.waitForSelector('[data-testid="sidebar-compose-btn"]', { timeout: 5000 });
      await compBtn.click();
      await sleep(300);

      const fromState = await getComposeFromDetails();
      const isBob = fromState.value === `account:${bobId}` && fromState.text.includes('bob@byos.local');
      const isAlice = fromState.value.includes(aliceId) || fromState.text.includes('alice@byos.local');

      if (isAlice) {
        driftedCount++;
      }

      console.log(`  Cycle ${i.toString().padStart(2, ' ')}: From = "${fromState.text}" (value: "${fromState.value}") | Drifted to Alice: ${isAlice ? 'YES' : 'NO'}`);
      assert(isBob, `Cycle ${i}: From must be Bob`);
      assert(!isAlice, `Cycle ${i}: From must NOT be Alice`);

      const clsBtn = await page.waitForSelector('[data-testid="compose-close-btn"]', { timeout: 5000 });
      await clsBtn.click();
      await sleep(200);
    }

    console.log(`\n  Rapid cycles summary: 10/10 iterations remained stable as bob@byos.local (Drifted to Alice: ${driftedCount})`);
    assert(driftedCount === 0, "From: never drifted to Alice across 10 rapid open/close cycles");

    const shotRapid = path.resolve(artifactsDir, 'rapid_cycles_bob.png');
    await page.screenshot({ path: shotRapid });
    console.log(`  Saved screenshot: ${shotRapid}`);

    console.log("\n================================================================================");
    console.log("            ALL 4 VERIFICATION REQUIREMENTS PASSED SUCCESSFULLY!               ");
    console.log("================================================================================\n");

  } finally {
    await browser.close();
  }
}

runManualComposeFlows().catch((err) => {
  console.error("\nTEST SUITE FAILED WITH EXCEPTION:\n", err);
  process.exit(1);
});
