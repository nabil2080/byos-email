import puppeteer from '../../apps/webmail/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import * as wasm from '../../apps/webmail/src/generated/crypto-core/byos_crypto_core.js';
import { bytesToHex } from '../../apps/webmail/src/attachment_crypto.ts';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const mboxFilePath = path.resolve(__dirname, 'test_emails.mbox');

const Alice = {
  userId: "cccccccc-0000-0000-0000-000000000002",
  mailboxId: "c0000000-0000-0000-0000-000000000001",
  email: "alice@byos.local",
  token: "alice_manual_test_session_token_123",
  xwingSeed: "11".repeat(32),
  signingSeed: "33".repeat(32),
};

const Bob = {
  userId: "cccccccc-0000-0000-0000-000000000003",
  mailboxId: "c0000000-0000-0000-0000-000000000002",
  email: "bob@byos.local",
  token: "bob_manual_test_session_token_123",
  xwingSeed: "22".repeat(32),
  signingSeed: "44".repeat(32),
};

Alice.xwingPkHex = wasm.wasm_xwing_public_key_from_seed(Alice.xwingSeed);
Alice.signingPkHex = wasm.wasm_signing_public_key_from_seed(Alice.signingSeed);
Bob.xwingPkHex = wasm.wasm_xwing_public_key_from_seed(Bob.xwingSeed);
Bob.signingPkHex = wasm.wasm_signing_public_key_from_seed(Bob.signingSeed);

function execSql(sql) {
  const cmd = `docker exec byos-postgres psql -U byos -d byos -t -A -c "${sql.replace(/"/g, '\\"')}"`;
  return execSync(cmd, { encoding: "utf8" }).trim();
}

async function setupPage(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto('http://localhost:3001', { waitUntil: 'domcontentloaded' });
  await page.evaluate((al) => {
    localStorage.setItem('byos_active_session_token', al.token);
    sessionStorage.setItem('byos_active_session_token', al.token);
    sessionStorage.setItem('byos_mailbox_sk_' + al.mailboxId, al.xwingSeed);
    sessionStorage.setItem('byos_mailbox_skey_' + al.mailboxId, al.xwingSeed);
    sessionStorage.setItem('byos_signing_seed_' + al.mailboxId, al.signingSeed);
    sessionStorage.setItem('byos_xwing_seed_' + al.mailboxId, al.xwingSeed);
  }, Alice);
  await page.reload({ waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1500));
  return page;
}

async function runDeepChecks() {
  console.log("=== STARTING DEEP BEHAVIORAL BROWSER VERIFICATION ===");

  // Ensure DB sessions and keys are active
  execSql(`INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ('${Alice.userId}', digest('${Alice.token}', 'sha256'), now() + interval '1 day') ON CONFLICT (token_hash) DO NOTHING`);
  execSql(`INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ('${Bob.userId}', digest('${Bob.token}', 'sha256'), now() + interval '1 day') ON CONFLICT (token_hash) DO NOTHING`);
  execSql(`UPDATE mailboxes SET mailbox_xwing_pk = decode('${Alice.xwingPkHex}', 'hex'), mailbox_ed25519_pk = decode('${Alice.signingPkHex}', 'hex'), key_status = 'active', key_epoch = 1, signing_key_epoch = 1 WHERE id = '${Alice.mailboxId}'`);
  execSql(`UPDATE mailboxes SET mailbox_xwing_pk = decode('${Bob.xwingPkHex}', 'hex'), mailbox_ed25519_pk = decode('${Bob.signingPkHex}', 'hex'), key_status = 'active', key_epoch = 1, signing_key_epoch = 1 WHERE id = '${Bob.mailboxId}'`);

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ['--no-sandbox', '--disable-gpu'],
  });

  try {
    const page = await setupPage(browser);

    // =========================================================================
    // 1. BEHAVIORAL CHECK: REAL EMAIL IMPORT (.MBOX)
    // =========================================================================
    console.log("\n--- [BEHAVIORAL CHECK 1] Real .mbox File Import ---");
    // Ensure clean state: delete any earlier mbox test messages for Alice
    execSql(`DELETE FROM message_metadata WHERE mailbox_id = '${Alice.mailboxId}' AND sender LIKE '%import-test-%'`);

    // Open Import Modal by clicking sidebar Import button
    const importBtnClicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find(b => b.innerText.trim() === 'Import');
      if (btn) {
        btn.click();
        return true;
      }
      return false;
    });
    console.log("Sidebar Import button clicked:", importBtnClicked);
    await new Promise(r => setTimeout(r, 1000));

    // Wait for the modal file input
    const fileInput = await page.$('#file-import-input');
    if (!fileInput) throw new Error("Could not find #file-import-input in Import modal");

    console.log("Uploading test_emails.mbox into modal...");
    await fileInput.uploadFile(mboxFilePath);

    // Wait for the modal to parse the mbox messages and show the Import action button
    let modalImportBtn = null;
    let selectedText = null;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      const info = await page.evaluate(() => {
        const modal = Array.from(document.querySelectorAll('div')).find(d => d.innerText && d.innerText.includes('Import Emails'));
        if (!modal) return null;
        const btn = Array.from(modal.querySelectorAll('button')).find(b => b.innerText.includes('Import') && b.innerText.includes('Email') && !b.disabled);
        const text = modal.innerText;
        const match = text.match(/(\d+)\s+emails?\s+selected/i);
        return {
          hasBtn: !!btn,
          btnText: btn?.innerText,
          selectedText: match ? match[0] : null,
        };
      });
      if (info && info.hasBtn) {
        modalImportBtn = info.btnText;
        selectedText = info.selectedText;
        break;
      }
    }
    console.log(`Parsed modal state: selected="${selectedText}", button="${modalImportBtn}"`);

    // Click "Import 2 Emails" in modal footer
    console.log("Triggering actual batch import in modal...");
    await page.evaluate(() => {
      const modal = Array.from(document.querySelectorAll('div')).find(d => d.innerText && d.innerText.includes('Import Emails'));
      const btn = Array.from(modal.querySelectorAll('button')).find(b => b.innerText.includes('Import') && b.innerText.includes('Email') && !b.disabled);
      if (btn) btn.click();
    });

    // Wait for modal import completion
    let importDone = false;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 500));
      const state = await page.evaluate(() => {
        const modal = Array.from(document.querySelectorAll('div')).find(d => d.innerText && d.innerText.includes('Import Emails'));
        if (!modal) return false;
        return modal.innerText.includes('Import process complete') || modal.innerText.includes('Import Completed') || modal.innerText.includes('Done');
      });
      if (state) {
        importDone = true;
        break;
      }
    }
    console.log("Modal batch import completed:", importDone);

    // Click "Done" button to close modal and refresh inbox
    await page.evaluate(() => {
      const modal = Array.from(document.querySelectorAll('div')).find(d => d.innerText && d.innerText.includes('Import Emails'));
      const doneBtn = Array.from(modal.querySelectorAll('button')).find(b => b.innerText.trim() === 'Done');
      if (doneBtn) doneBtn.click();
    });
    await new Promise(r => setTimeout(r, 1500));

    // Verify rows in PostgreSQL
    const importedDbCount = execSql(`SELECT count(*) FROM message_metadata WHERE mailbox_id = '${Alice.mailboxId}' AND sender LIKE '%import-test-%'`);
    console.log("PostgreSQL imported rows count:", importedDbCount);

    // Verify messages in Webmail DOM
    const domMessagesFound = await page.evaluate(() => {
      const text = document.body.innerText;
      return text.includes('Mbox Test Message 1') || text.includes('Mbox Test Message 2') || text.includes('import-test-sender');
    });
    console.log("Imported messages rendered in Webmail DOM:", domMessagesFound);

    const emailImportWorking = importDone && parseInt(importedDbCount, 10) >= 2;
    console.log("Email Import Behavioral Result:", emailImportWorking ? "WORKING" : "BROKEN");

    // =========================================================================
    // 2. BEHAVIORAL CHECK: FILTERS / RULES UI
    // =========================================================================
    console.log("\n--- [BEHAVIORAL CHECK 2] Filters / Rules UI End-to-End ---");
    // Ensure clean state and create target label
    execSql(`DELETE FROM mail_rules WHERE mailbox_id = '${Alice.mailboxId}' AND match_sender = 'bob@byos.local'`);
    execSql(`DELETE FROM mailbox_labels WHERE mailbox_id = '${Alice.mailboxId}' AND name = 'BobVIPTag'`);
    const rawLabelOutput = execSql(`INSERT INTO mailbox_labels (mailbox_id, name, color, color_name) VALUES ('${Alice.mailboxId}', 'BobVIPTag', '#10B981', 'Green') RETURNING id`);
    const labelId = rawLabelOutput.split(/\r?\n/).map(s => s.trim()).find(s => /^[0-9a-f-]{36}$/i.test(s));
    console.log("Created target label in DB with ID:", labelId);

    // Open Settings -> Filters & Rules
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button, a')).find(b => b.innerText.trim() === 'Settings');
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 800));

    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('nav button')).find(b => b.innerText.includes('Filters & Rules'));
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 800));

    // Click "Add Rule"
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Add Rule'));
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 600));

    // Type rule name and match sender
    await page.evaluate(() => {
      const modal = Array.from(document.querySelectorAll('div')).find(d => d.innerText && d.innerText.includes('Create Mail Rule'));
      const nameInput = modal.querySelector('input[placeholder*="newsletters"]');
      if (nameInput) {
        nameInput.focus();
        nameInput.value = 'AutoLabel Bob Inbound';
        nameInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const senderInput = modal.querySelector('input[placeholder*="@notifications"]');
      if (senderInput) {
        senderInput.focus();
        senderInput.value = 'bob@byos.local';
        senderInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await new Promise(r => setTimeout(r, 400));

    // Select Action = label
    await page.evaluate(() => {
      const modal = Array.from(document.querySelectorAll('div')).find(d => d.innerText && d.innerText.includes('Create Mail Rule'));
      const selects = Array.from(modal.querySelectorAll('select'));
      const actionSelect = selects.find(s => Array.from(s.options).some(o => o.value === 'label'));
      if (actionSelect) {
        actionSelect.value = 'label';
        actionSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await new Promise(r => setTimeout(r, 600));

    // Now select target label
    await page.evaluate((lId) => {
      const modal = Array.from(document.querySelectorAll('div')).find(d => d.innerText && d.innerText.includes('Create Mail Rule'));
      const selects = Array.from(modal.querySelectorAll('select'));
      const labelSelect = selects.find(s => Array.from(s.options).some(o => o.value === lId));
      if (labelSelect) {
        labelSelect.value = lId;
        labelSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, labelId);
    await new Promise(r => setTimeout(r, 500));

    // Click "Save Rule" button inside modal
    console.log("Clicking Save Rule in browser modal...");
    await page.evaluate(() => {
      const modal = Array.from(document.querySelectorAll('div')).find(d => d.innerText && d.innerText.includes('Create Mail Rule'));
      const saveBtn = Array.from(modal.querySelectorAll('button')).find(b => b.innerText.includes('Save Rule'));
      if (saveBtn) saveBtn.click();
    });
    await new Promise(r => setTimeout(r, 1200));

    // Verify rule created in PostgreSQL
    const ruleCount = execSql(`SELECT count(*) FROM mail_rules WHERE mailbox_id = '${Alice.mailboxId}' AND match_sender = 'bob@byos.local' AND action_label_id = '${labelId}'`);
    console.log("PostgreSQL mail_rules row count matching rule:", ruleCount);

    // Close Settings
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Back to Inbox'));
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 600));

    // Send matching Path A message from Bob to Alice
    console.log("Delivering Path A message from Bob to Alice to trigger rule...");
    const mime = "Subject: Urgent Update From Bob\nFrom: bob@byos.local\nTo: alice@byos.local\n\nHello Alice, this matches your rule!";
    const mimeHex = bytesToHex(Buffer.from(mime));
    const recEnv = wasm.wasm_seal_xwing_envelope_signed(Alice.xwingPkHex, Alice.mailboxId, 1, mimeHex, Bob.signingSeed);
    const senderEnv = wasm.wasm_seal_xwing_envelope_signed(Bob.xwingPkHex, Bob.mailboxId, 1, mimeHex, Bob.signingSeed);

    const bobToken = Bob.token;
    const sendRes = await fetch("http://localhost:8080/v1/outbound/send-internal", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${bobToken}`,
      },
      body: JSON.stringify({
        envelope_json: recEnv,
        sender_envelope_json: senderEnv,
        recipient: Alice.email,
        sender_mailbox_id: Bob.mailboxId,
      }),
    });
    const sendJson = await sendRes.json();
    console.log("Send internal result:", JSON.stringify(sendJson));

    // Verify rule action applied: check message_labels in PostgreSQL
    const labeledMsgId = sendJson.message_id;
    const labelAssignedCount = execSql(`SELECT count(*) FROM message_labels WHERE message_id = '${labeledMsgId}' AND label_id = '${labelId}'`);
    console.log("PostgreSQL message_labels row count for new message:", labelAssignedCount);

    const rulesWorking = parseInt(ruleCount, 10) >= 1 && parseInt(labelAssignedCount, 10) >= 1;
    console.log("Filters / Rules UI Behavioral Result:", rulesWorking ? "WORKING" : "BROKEN");

    // =========================================================================
    // 3. BEHAVIORAL CHECK: DARK MODE SPOT-CHECK
    // =========================================================================
    console.log("\n--- [BEHAVIORAL CHECK 3] Dark Mode Component Spot-Check ---");
    // Switch to dark mode
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === 'Dark');
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 600));

    // Open Compose Drawer to check compose form styling in dark mode
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('New Message'));
      if (btn) btn.click();
    });
    await new Promise(r => setTimeout(r, 800));

    const darkStyles = await page.evaluate(() => {
      const msgList = document.querySelector('section, [data-testid="message-list"], main');
      const composeForm = document.querySelector('form');
      const composeHeader = document.querySelector('header');

      function getRgb(el) {
        if (!el) return null;
        const s = window.getComputedStyle(el);
        return { bgColor: s.backgroundColor, color: s.color, borderColor: s.borderColor };
      }

      return {
        isDarkClass: document.documentElement.classList.contains('dark'),
        themeAttr: document.documentElement.dataset.theme,
        messageList: getRgb(msgList),
        composeForm: getRgb(composeForm),
        composeHeader: getRgb(composeHeader),
      };
    });
    console.log("Dark Mode Component Styles:", JSON.stringify(darkStyles, null, 2));

    const darkModeWorking = darkStyles.isDarkClass &&
      darkStyles.themeAttr === 'dark' &&
      darkStyles.composeForm?.bgColor.includes('30, 32, 37');
    console.log("Dark Mode Component Spot-Check Result:", darkModeWorking ? "WORKING" : "BROKEN");

    // Close compose drawer
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 500));

    console.log("\n=== ALL DEEP BEHAVIORAL CHECKS COMPLETED ===");
  } finally {
    await browser.close();
  }
}

runDeepChecks().catch(err => {
  console.error("Deep browser check error:", err);
  process.exit(1);
});
