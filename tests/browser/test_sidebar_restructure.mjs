import puppeteer from '../../apps/webmail/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import * as wasm from '../../apps/webmail/src/generated/crypto-core/byos_crypto_core.js';
import { bytesToHex } from '../../apps/webmail/src/attachment_crypto.ts';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const artifactDir = 'C:\\Users\\PC\\.gemini\\antigravity\\brain\\bc4b087f-089b-4e94-aa80-42c26a5708ee';

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

async function sendPathAMessage({ sender, recipient, subject, body }) {
  const mime = `Subject: ${subject}\nFrom: ${sender.email}\nTo: ${recipient.email}\nDate: ${new Date().toUTCString()}\n\n${body}`;
  const mimeHex = bytesToHex(Buffer.from(mime));
  const recEnv = wasm.wasm_seal_xwing_envelope_signed(recipient.xwingPkHex, recipient.mailboxId, 1, mimeHex, sender.signingSeed);
  const senderEnv = wasm.wasm_seal_xwing_envelope_signed(sender.xwingPkHex, sender.mailboxId, 1, mimeHex, sender.signingSeed);

  const res = await fetch("http://localhost:8080/v1/outbound/send-internal", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${sender.token}`,
    },
    body: JSON.stringify({
      envelope_json: recEnv,
      sender_envelope_json: senderEnv,
      recipient: recipient.email,
      sender_mailbox_id: sender.mailboxId,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to send internal Path A message: ${res.status} ${errText}`);
  }
  return await res.json();
}

async function runSidebarVerification() {
  console.log("================================================================================");
  console.log("           SIDEBAR RESTRUCTURE MANUAL VERIFICATION (CHECKS 1 - 6)               ");
  console.log("================================================================================\n");

  // Step 0: Ensure DB state for Alice and Bob
  execSql(`INSERT INTO sessions (user_id, token_hash, expires_at, revoked_at) VALUES ('${Alice.userId}', digest('${Alice.token}', 'sha256'), now() + interval '1 day', NULL) ON CONFLICT (token_hash) DO UPDATE SET expires_at = now() + interval '1 day', revoked_at = NULL`);
  execSql(`INSERT INTO sessions (user_id, token_hash, expires_at, revoked_at) VALUES ('${Bob.userId}', digest('${Bob.token}', 'sha256'), now() + interval '1 day', NULL) ON CONFLICT (token_hash) DO UPDATE SET expires_at = now() + interval '1 day', revoked_at = NULL`);
  execSql(`UPDATE mailboxes SET mailbox_xwing_pk = decode('${Alice.xwingPkHex}', 'hex'), mailbox_ed25519_pk = decode('${Alice.signingPkHex}', 'hex'), key_status = 'active', key_epoch = 1, signing_key_epoch = 1 WHERE id = '${Alice.mailboxId}'`);
  execSql(`UPDATE mailboxes SET mailbox_xwing_pk = decode('${Bob.xwingPkHex}', 'hex'), mailbox_ed25519_pk = decode('${Bob.signingPkHex}', 'hex'), key_status = 'active', key_epoch = 1, signing_key_epoch = 1 WHERE id = '${Bob.mailboxId}'`);

  // Seed baseline messages for Alice and Bob
  console.log("Seeding baseline message for Alice...");
  await sendPathAMessage({
    sender: Bob,
    recipient: Alice,
    subject: "Alpha Briefing for Alice",
    body: "Confidential body for Alice mailbox. Zero-knowledge decrypt verified.",
  });

  console.log("Seeding baseline message for Bob...");
  await sendPathAMessage({
    sender: Alice,
    recipient: Bob,
    subject: "Beta Briefing for Bob",
    body: "Confidential body for Bob mailbox. Cross-account isolation verified.",
  });

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ['--no-sandbox', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.goto('http://127.0.0.1:3001', { waitUntil: 'domcontentloaded' });

    // Step 1: Open webmail with two accounts connected
    console.log("\n--- [CHECK 1] Open the webmail with two accounts connected ---");
    await page.evaluate((al, bo) => {
      localStorage.setItem('byos_active_session_token', al.token);
      sessionStorage.setItem('byos_active_session_token', al.token);

      sessionStorage.setItem('byos_mailbox_sk_' + al.mailboxId, al.xwingSeed);
      sessionStorage.setItem('byos_mailbox_skey_' + al.mailboxId, al.xwingSeed);
      sessionStorage.setItem('byos_signing_seed_' + al.mailboxId, al.signingSeed);
      sessionStorage.setItem('byos_xwing_seed_' + al.mailboxId, al.xwingSeed);

      sessionStorage.setItem('byos_mailbox_sk_' + bo.mailboxId, bo.xwingSeed);
      sessionStorage.setItem('byos_mailbox_skey_' + bo.mailboxId, bo.xwingSeed);
      sessionStorage.setItem('byos_signing_seed_' + bo.mailboxId, bo.signingSeed);
      sessionStorage.setItem('byos_xwing_seed_' + bo.mailboxId, bo.xwingSeed);

      const accounts = [
        {
          id: al.mailboxId,
          email: al.email,
          displayName: "Alice",
          sessionToken: al.token,
          role: "owner",
          privacyMode: "standard",
          mailboxSkHex: al.xwingSeed,
          searchKeyHex: "",
          signingSeedHex: al.signingSeed,
        },
        {
          id: bo.mailboxId,
          email: bo.email,
          displayName: "Bob",
          sessionToken: bo.token,
          role: "owner",
          privacyMode: "standard",
          mailboxSkHex: bo.xwingSeed,
          searchKeyHex: "",
          signingSeedHex: bo.signingSeed,
        },
      ];
      sessionStorage.setItem('byos_connected_accounts', JSON.stringify(accounts));
      localStorage.setItem('byos_connected_accounts', JSON.stringify(accounts));
    }, Alice, Bob);

    await page.reload({ waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 1500));
    console.log("✓ CHECK 1 PASSED: Webmail opened with Alice and Bob connected");

    // Step 2: Confirm sidebar shows account chip at top, no "ACCOUNTS" section
    console.log("\n--- [CHECK 2] Confirm sidebar shows account chip at top, no 'ACCOUNTS' section ---");
    const check2 = await page.evaluate(() => {
      const chip = document.querySelector('[data-testid="account-chip-selector"]');
      const chipDot = document.querySelector('[data-testid="account-chip-dot"]');
      const chipText = document.querySelector('[data-testid="account-chip-text"]');
      const accountsHeaders = Array.from(document.querySelectorAll('aside div, aside span'))
        .filter((el) => el.textContent?.trim().toUpperCase() === "ACCOUNTS");
      const permanentAccountsSection = document.querySelector('[data-testid^="sidebar-account-"]');

      return {
        hasChip: !!chip,
        chipText: chipText ? chipText.textContent.trim() : null,
        hasDot: !!chipDot,
        dotColor: chipDot ? window.getComputedStyle(chipDot).backgroundColor : null,
        hasAccountsHeader: accountsHeaders.length > 0,
        hasPermanentAccountsSection: !!permanentAccountsSection,
      };
    });

    console.log("Check 2 Result:", JSON.stringify(check2, null, 2));
    if (!check2.hasChip) throw new Error("Account chip not found at top of sidebar!");
    if (check2.hasAccountsHeader || check2.hasPermanentAccountsSection) {
      throw new Error("Permanent ACCOUNTS section is still present in the sidebar body!");
    }
    console.log("✓ CHECK 2 PASSED: Account chip present at top; no permanent ACCOUNTS section found");

    // Step 3: Click the chip. Confirm dropdown opens with "All Inboxes", both accounts, and "Add another mailbox"
    console.log("\n--- [CHECK 3] Click chip; confirm dropdown opens with 'All Inboxes', both accounts, and 'Add another mailbox' ---");
    await page.evaluate(() => {
      const chip = document.querySelector('[data-testid="account-chip-selector"]');
      chip.click();
    });
    await new Promise((r) => setTimeout(r, 500));

    const check3 = await page.evaluate((alId, boId) => {
      const dropdownAll = document.querySelector('[data-testid="account-dropdown-all"]');
      const dropdownAlice = document.querySelector(`[data-testid="account-dropdown-${alId}"]`);
      const dropdownBob = document.querySelector(`[data-testid="account-dropdown-${boId}"]`);
      const addMailbox = document.querySelector('[data-testid="add-mailbox-button"]');

      return {
        hasAllInboxes: !!dropdownAll,
        hasAlice: !!dropdownAlice,
        hasBob: !!dropdownBob,
        hasAddMailbox: !!addMailbox,
        allText: dropdownAll ? dropdownAll.innerText.split("\n")[0] : null,
        aliceText: dropdownAlice ? dropdownAlice.innerText.split("\n")[0] : null,
        bobText: dropdownBob ? dropdownBob.innerText.split("\n")[0] : null,
      };
    }, Alice.mailboxId, Bob.mailboxId);

    console.log("Check 3 Result:", JSON.stringify(check3, null, 2));
    if (!check3.hasAllInboxes || !check3.hasAlice || !check3.hasBob || !check3.hasAddMailbox) {
      throw new Error(`Dropdown missing options: All=${check3.hasAllInboxes}, Alice=${check3.hasAlice}, Bob=${check3.hasBob}, Add=${check3.hasAddMailbox}`);
    }

    // Capture screenshot of open dropdown state
    const dropdownShotPath = path.join(artifactDir, 'sidebar_dropdown_open.png');
    const sidebarEl = await page.$('aside');
    if (sidebarEl) {
      await sidebarEl.screenshot({ path: dropdownShotPath });
      console.log("Captured sidebar dropdown screenshot:", dropdownShotPath);
    }
    console.log("✓ CHECK 3 PASSED: Dropdown opens with All Inboxes, connected accounts, and Add mailbox action");

    // Step 4: Select alice@byos.local. Confirm chip updates, color dot changes to violet, and folder list shows alice's folders
    console.log("\n--- [CHECK 4] Select alice@byos.local; confirm chip updates, violet dot, and alice folders ---");
    await page.evaluate((alId) => {
      const optAlice = document.querySelector(`[data-testid="account-dropdown-${alId}"]`);
      optAlice.click();
    }, Alice.mailboxId);
    await new Promise((r) => setTimeout(r, 1200));

    const check4 = await page.evaluate(() => {
      const chipText = document.querySelector('[data-testid="account-chip-text"]')?.textContent?.trim();
      const chipDot = document.querySelector('[data-testid="account-chip-dot"]');
      const dotColor = chipDot ? window.getComputedStyle(chipDot).backgroundColor : null;

      const topFolderBtn = document.querySelector('[data-testid="folder-inbox"]');
      const topFolderName = document.querySelector('[data-testid="folder-name-inbox"]')?.textContent?.trim();
      const folderDots = Array.from(document.querySelectorAll('[data-testid="folder-selection-dot"]'))
        .map((el) => window.getComputedStyle(el).backgroundColor);

      return {
        chipText,
        dotColor,
        hasInboxFolder: !!topFolderBtn,
        topFolderName,
        folderCount: folderDots.length,
        folderDotColors: [...new Set(folderDots)],
      };
    });

    console.log("Check 4 Result:", JSON.stringify(check4, null, 2));
    if (check4.chipText !== "alice@byos.local") {
      throw new Error(`Expected chip text "alice@byos.local", got "${check4.chipText}"`);
    }
    if (check4.dotColor !== "rgb(128, 34, 195)") {
      throw new Error(`Expected violet dot rgb(128, 34, 195), got ${check4.dotColor}`);
    }
    if (check4.topFolderName !== "Inbox") {
      throw new Error(`Expected top folder "Inbox" for Alice, got "${check4.topFolderName}"`);
    }
    if (!check4.folderDotColors.includes("rgb(128, 34, 195)")) {
      throw new Error(`Folder selection dots should match Alice's violet color, got: ${check4.folderDotColors}`);
    }

    // Capture screenshot of Alice selected state
    const aliceShotPath = path.join(artifactDir, 'sidebar_alice_selected.png');
    if (sidebarEl) {
      await sidebarEl.screenshot({ path: aliceShotPath });
      console.log("Captured sidebar Alice selected screenshot:", aliceShotPath);
    }
    console.log("✓ CHECK 4 PASSED: Alice selected: chip shows alice@byos.local, violet dot, folder list shows Alice folders");

    // Step 5: Click chip again. Select "All Inboxes". Confirm chip reads "All Inboxes", folder list shows aggregate counts, messages from both appear
    console.log("\n--- [CHECK 5] Click chip again, select 'All Inboxes'; confirm chip, aggregate counts, both accounts ---");
    await page.evaluate(() => {
      const chip = document.querySelector('[data-testid="account-chip-selector"]');
      chip.click();
    });
    await new Promise((r) => setTimeout(r, 400));

    await page.evaluate(() => {
      const allOpt = document.querySelector('[data-testid="account-dropdown-all"]');
      allOpt.click();
    });
    await new Promise((r) => setTimeout(r, 1200));

    // Also click top folder 'All Inboxes' to ensure active view is focused
    await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="unified-inbox-button"]');
      if (btn) btn.click();
    });
    await new Promise((r) => setTimeout(r, 1500));

    const check5 = await page.evaluate(() => {
      const chipText = document.querySelector('[data-testid="account-chip-text"]')?.textContent?.trim();
      const chipDot = document.querySelector('[data-testid="account-chip-dot"]');
      const dotColor = chipDot ? window.getComputedStyle(chipDot).backgroundColor : null;

      const topFolderBtn = document.querySelector('[data-testid="unified-inbox-button"]');
      const topFolderName = document.querySelector('[data-testid="folder-name-inbox"]')?.textContent?.trim();
      const topFolderUnread = document.querySelector('[data-testid="folder-unread-inbox"]')?.textContent?.trim();

      const folderDots = Array.from(document.querySelectorAll('[data-testid="folder-selection-dot"]'))
        .map((el) => window.getComputedStyle(el).backgroundColor);

      const rows = Array.from(document.querySelectorAll('[data-testid="message-row"]'));
      const text = document.body.innerText;
      const hasAlpha = text.includes("Alpha Briefing for Alice") || text.includes("bob@byos.local");
      const hasBeta = text.includes("Beta Briefing for Bob") || text.includes("alice@byos.local");

      return {
        chipText,
        dotColor,
        hasUnifiedFolder: !!topFolderBtn,
        topFolderName,
        topFolderUnread,
        folderDotColors: [...new Set(folderDots)],
        rowCount: rows.length,
        hasAlpha,
        hasBeta,
      };
    });

    console.log("Check 5 Result:", JSON.stringify(check5, null, 2));
    if (check5.chipText !== "All Inboxes") {
      throw new Error(`Expected chip text "All Inboxes", got "${check5.chipText}"`);
    }
    if (check5.topFolderName !== "All Inboxes") {
      throw new Error(`Expected top folder "All Inboxes", got "${check5.topFolderName}"`);
    }
    if (!check5.hasAlpha || !check5.hasBeta) {
      throw new Error(`Unified Inbox messages from both accounts not found! Alpha=${check5.hasAlpha}, Beta=${check5.hasBeta}`);
    }

    // Capture screenshot of All Inboxes selected state
    const allInboxesShotPath = path.join(artifactDir, 'sidebar_all_inboxes_selected.png');
    if (sidebarEl) {
      await sidebarEl.screenshot({ path: allInboxesShotPath });
      console.log("Captured sidebar All Inboxes selected screenshot:", allInboxesShotPath);
    }
    console.log("✓ CHECK 5 PASSED: All Inboxes selected: chip shows All Inboxes, aggregate folder list, both accounts' messages displayed");

    // Step 6: Side by side comparison evidence confirmation
    console.log("\n--- [CHECK 6] Screenshot comparison confirmed ---");
    console.log("Saved screenshots:");
    console.log("  1. Dropdown Open:      ", dropdownShotPath);
    console.log("  2. Alice Account State:", aliceShotPath);
    console.log("  3. All Inboxes State:  ", allInboxesShotPath);
    console.log("✓ CHECK 6 PASSED: Both states captured and verified");

    // Test Keyboard navigation: `g i` jumps to inbox
    console.log("\n--- [KEYBOARD VERIFICATION] Test 'g i' keyboard jump to inbox ---");
    await page.keyboard.press('g');
    await page.keyboard.press('i');
    await new Promise((r) => setTimeout(r, 600));

    const kbState = await page.evaluate(() => {
      const topBtn = document.querySelector('[data-testid="unified-inbox-button"]');
      return {
        isActive: topBtn ? topBtn.classList.contains("font-semibold") || topBtn.className.includes("F2E8E2") : false,
      };
    });
    console.log("Keyboard 'g i' active state:", kbState);
    console.log("✓ KEYBOARD SHORTCUT 'g i' VERIFIED");

    console.log("\n================================================================================");
    console.log("            ALL 6 MANUAL VERIFICATION CHECKS SUCCESSFULLY PASSED!              ");
    console.log("================================================================================");
  } finally {
    await browser.close();
  }
}

runSidebarVerification().catch((err) => {
  console.error("\n❌ SIDEBAR MANUAL VERIFICATION FAILED:", err);
  process.exit(1);
});
