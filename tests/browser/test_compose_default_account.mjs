import puppeteer from '../../apps/webmail/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import * as wasm from '../../apps/webmail/src/generated/crypto-core/byos_crypto_core.js';

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

const Alice = {
  userId: "cccccccc-0000-0000-0000-000000000002",
  mailboxId: "c0000000-0000-0000-0000-000000000001",
  email: "alice@byos.local",
  token: "alice_compose_test_session_token_123",
  xwingSeed: "ea01f553ee1988202f1c41f1d3d478afdf7ef0cddf611a28d2e3c2c3af42b13a",
  signingSeed: "006848f2e6583e34ab8a011d53b48f167c3bb3b50b7f59aa5fef669be8d99eff",
};

const Bob = {
  userId: "cccccccc-0000-0000-0000-000000000003",
  mailboxId: "c0000000-0000-0000-0000-000000000002",
  email: "bob@byos.local",
  token: "bob_compose_test_session_token_123",
  xwingSeed: "f74ba1810c540588f4ccce97eaa0efc82937c060c63453496147d6430183e376",
  signingSeed: "d2f874cbca57aa4df01b579d5fa48a8c3358721f0a73ede153fabadc9c4ee59a",
};

Alice.xwingPkHex = wasm.wasm_xwing_public_key_from_seed(Alice.xwingSeed);
Alice.signingPkHex = wasm.wasm_signing_public_key_from_seed(Alice.signingSeed);
Bob.xwingPkHex = wasm.wasm_xwing_public_key_from_seed(Bob.xwingSeed);
Bob.signingPkHex = wasm.wasm_signing_public_key_from_seed(Bob.signingSeed);

function execSql(sql) {
  const cmd = `docker exec byos-postgres psql -U byos -d byos -t -A -c "${sql.replace(/"/g, '\\"')}"`;
  return execSync(cmd, { encoding: "utf8" }).trim();
}

async function runComposeDefaultAccountTest() {
  console.log("================================================================================");
  console.log("      VERIFY COMPOSE FROM: DEFAULTS TO ACTIVE MAILBOX (ALICE & BOB)             ");
  console.log("================================================================================\n");

  // Step 0: Ensure sessions and keys in DB
  execSql(`INSERT INTO sessions (user_id, token_hash, expires_at, revoked_at) VALUES ('${Alice.userId}', digest('${Alice.token}', 'sha256'), now() + interval '1 day', NULL) ON CONFLICT (token_hash) DO UPDATE SET expires_at = now() + interval '1 day', revoked_at = NULL`);
  execSql(`INSERT INTO sessions (user_id, token_hash, expires_at, revoked_at) VALUES ('${Bob.userId}', digest('${Bob.token}', 'sha256'), now() + interval '1 day', NULL) ON CONFLICT (token_hash) DO UPDATE SET expires_at = now() + interval '1 day', revoked_at = NULL`);
  execSql(`UPDATE mailboxes SET mailbox_xwing_pk = decode('${Alice.xwingPkHex}', 'hex'), mailbox_ed25519_pk = decode('${Alice.signingPkHex}', 'hex'), key_status = 'active', key_epoch = 1, signing_key_epoch = 1 WHERE id = '${Alice.mailboxId}'`);
  execSql(`UPDATE mailboxes SET mailbox_xwing_pk = decode('${Bob.xwingPkHex}', 'hex'), mailbox_ed25519_pk = decode('${Bob.signingPkHex}', 'hex'), key_status = 'active', key_epoch = 1, signing_key_epoch = 1 WHERE id = '${Bob.mailboxId}'`);

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

    console.log("--- [STEP 1] Setup session with Alice and Bob connected accounts ---");
    await page.goto('http://localhost:3001', { waitUntil: 'domcontentloaded' });
    await page.evaluate((al, bo) => {
      localStorage.clear();
      sessionStorage.clear();

      localStorage.setItem('byos_active_session_token', al.token);
      sessionStorage.setItem('byos_active_session_token', al.token);

      // Alice keys
      sessionStorage.setItem('byos_mailbox_sk_' + al.mailboxId, al.xwingSeed);
      sessionStorage.setItem('byos_mailbox_skey_' + al.mailboxId, al.xwingSeed);
      sessionStorage.setItem('byos_signing_seed_' + al.mailboxId, al.signingSeed);
      sessionStorage.setItem('byos_xwing_seed_' + al.mailboxId, al.xwingSeed);

      // Bob keys
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
    await sleep(2000);

    // Verify initial active mailbox is Alice
    console.log("\n--- [STEP 2] Check initial compose with Alice as active mailbox ---");
    const composeBtn1 = await page.waitForSelector('[data-testid="sidebar-compose-btn"]', { timeout: 8000 });
    await composeBtn1.click();
    await sleep(1000);

    // Read From: value in ComposeDrawer
    await page.waitForSelector('[data-testid="compose-from-select"]', { timeout: 5000 });
    const aliceComposeState = await page.evaluate(() => {
      const select = document.querySelector('[data-testid="compose-from-select"]');
      const selectedOption = select ? select.options[select.selectedIndex] : null;
      return {
        selectValue: select ? select.value : '',
        selectedText: selectedOption ? selectedOption.textContent.trim() : '',
      };
    });
    console.log("  Alice active compose From state:", JSON.stringify(aliceComposeState));
    assert(aliceComposeState.selectValue === `account:${Alice.mailboxId}`, `From value is account:${Alice.mailboxId}`);
    assert(aliceComposeState.selectedText.includes('alice@byos.local'), `From text is alice@byos.local`);

    const shotAlice = path.resolve(artifactsDir, 'compose_from_active_mailbox_alice.png');
    await page.screenshot({ path: shotAlice });
    console.log(`  Saved screenshot: ${shotAlice}`);

    // Close compose
    const closeBtn1 = await page.waitForSelector('[data-testid="compose-close-btn"]', { timeout: 5000 });
    await closeBtn1.click();
    await sleep(800);

    // Step 3: Switch to Bob
    console.log("\n--- [STEP 3] Switch active account to Bob (bob@byos.local) ---");
    const accountTrigger = await page.waitForSelector('[data-testid="account-chip-selector"]', { timeout: 5000 });
    await accountTrigger.click();
    await sleep(600);

    const bobOption = await page.waitForSelector(`[data-testid="account-dropdown-${Bob.mailboxId}"]`, { timeout: 5000 });
    await bobOption.click();
    await sleep(2000);

    // Verify sidebar shows Bob active
    const activeSidebarEmail = await page.evaluate(() => {
      const chip = document.querySelector('[data-testid="account-chip-selector"]');
      return chip ? chip.textContent.trim() : '';
    });
    console.log(`  Sidebar active account text: "${activeSidebarEmail}"`);
    assert(activeSidebarEmail.includes('bob@byos.local'), "Sidebar shows bob@byos.local active");

    // Step 4: Open New Message as Bob
    console.log("\n--- [STEP 4] Click 'New Message' while Bob is active mailbox ---");
    const composeBtn2 = await page.waitForSelector('[data-testid="sidebar-compose-btn"]', { timeout: 8000 });
    await composeBtn2.click();
    await sleep(1200);

    // Read From: value in ComposeDrawer
    await page.waitForSelector('[data-testid="compose-from-select"]', { timeout: 5000 });
    const bobComposeState = await page.evaluate(() => {
      const select = document.querySelector('[data-testid="compose-from-select"]');
      const selectedOption = select ? select.options[select.selectedIndex] : null;
      return {
        selectValue: select ? select.value : '',
        selectedText: selectedOption ? selectedOption.textContent.trim() : '',
      };
    });
    console.log("  Bob active compose From state:", JSON.stringify(bobComposeState));
    assert(bobComposeState.selectValue === `account:${Bob.mailboxId}`, `From value is account:${Bob.mailboxId} (NOT Alice)`);
    assert(bobComposeState.selectedText.includes('bob@byos.local'), `From text is bob@byos.local (NOT Alice)`);
    assert(!bobComposeState.selectedText.includes('alice@byos.local'), `From text does NOT leak alice@byos.local`);

    const shotBob = path.resolve(artifactsDir, 'compose_from_active_mailbox_bob.png');
    await page.screenshot({ path: shotBob });
    console.log(`  Saved screenshot: ${shotBob}`);

    // Step 5: Close and Reopen to verify stable default
    console.log("\n--- [STEP 5] Close and reopen compose drawer while Bob is active ---");
    const closeBtn2 = await page.waitForSelector('[data-testid="compose-close-btn"]', { timeout: 5000 });
    await closeBtn2.click();
    await sleep(800);

    const composeBtn3 = await page.waitForSelector('[data-testid="sidebar-compose-btn"]', { timeout: 8000 });
    await composeBtn3.click();
    await sleep(1200);

    const bobReopenState = await page.evaluate(() => {
      const select = document.querySelector('[data-testid="compose-from-select"]');
      const selectedOption = select ? select.options[select.selectedIndex] : null;
      return {
        selectValue: select ? select.value : '',
        selectedText: selectedOption ? selectedOption.textContent.trim() : '',
      };
    });
    console.log("  Bob reopened compose From state:", JSON.stringify(bobReopenState));
    assert(bobReopenState.selectValue === `account:${Bob.mailboxId}`, `Reopened From value remains Bob (${Bob.mailboxId})`);
    assert(bobReopenState.selectedText.includes('bob@byos.local'), "Reopened From text remains bob@byos.local");

    console.log("\n================================================================================");
    console.log("   ALL CHECKS PASSED: COMPOSE FROM: DEFAULTS ACCURATELY TO ACTIVE MAILBOX       ");
    console.log("================================================================================\n");

  } finally {
    await browser.close();
  }
}

runComposeDefaultAccountTest().catch((err) => {
  console.error("\nTEST SUITE FAILED WITH EXCEPTION:\n", err);
  process.exit(1);
});
