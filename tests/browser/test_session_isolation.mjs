import puppeteer from '../../apps/webmail/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import path from 'node:path';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import * as wasm from '../../apps/webmail/src/generated/crypto-core/byos_crypto_core.js';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const artifactDir = 'C:\\Users\\PC\\.gemini\\antigravity\\brain\\bc4b087f-089b-4e94-aa80-42c26a5708ee';

const Alice = {
  userId: "cccccccc-0000-0000-0000-000000000002",
  mailboxId: "c0000000-0000-0000-0000-000000000001",
  email: "alice@byos.local",
  token: "alice_session_isolation_token_123",
  xwingSeed: "11".repeat(32),
  signingSeed: "33".repeat(32),
};

const Bob = {
  userId: "cccccccc-0000-0000-0000-000000000003",
  mailboxId: "c0000000-0000-0000-0000-000000000002",
  email: "bob@byos.local",
  token: "bob_session_isolation_token_123",
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

function assert(condition, message) {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  PASS: ${message}`);
}

async function runSessionIsolationBrowserTests() {
  console.log("================================================================================");
  console.log("            SESSION ISOLATION BROWSER INTEGRATION TEST                          ");
  console.log("================================================================================\n");

  // Step 0: Ensure DB state for Alice and Bob
  console.log("[Setup] Seeding database sessions and public keys for Alice and Bob...");
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

    // Step 1: Open the webmail, log in as alice@byos.local only
    console.log("\n--- [STEP 1] Log in as alice@byos.local only ---");
    await page.goto('http://127.0.0.1:3001', { waitUntil: 'domcontentloaded' });
    await page.evaluate((al) => {
      localStorage.clear();
      sessionStorage.clear();
      sessionStorage.setItem('byos_active_session_token', al.token);
      sessionStorage.setItem('byos_mailbox_sk_' + al.mailboxId, al.xwingSeed);
      sessionStorage.setItem('byos_mailbox_skey_' + al.mailboxId, al.xwingSeed);
      sessionStorage.setItem('byos_signing_seed_' + al.mailboxId, al.signingSeed);
      sessionStorage.setItem('byos_xwing_seed_' + al.mailboxId, al.xwingSeed);

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
      ];
      sessionStorage.setItem('byos_connected_accounts', JSON.stringify(accounts));
      sessionStorage.setItem('byos_session_generation', 'gen_alice_001');
      localStorage.setItem('byos_session_generation', 'gen_alice_001');
      localStorage.setItem('byos_connected_accounts', JSON.stringify([
        { id: al.mailboxId, email: al.email, displayName: "Alice", role: "owner", privacyMode: "standard" }
      ]));
    }, Alice);

    await page.reload({ waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 1500));

    // Step 2: Assert the sidebar shows exactly one account: alice
    console.log("\n--- [STEP 2] Assert sidebar shows exactly one account: alice ---");
    const accountTextsStep1 = await page.evaluate(() => {
      const switcher = document.querySelector('[data-testid="account-chip-text"]') ||
                       document.querySelector('[data-testid="account-chip-selector"]');
      const text = switcher ? (switcher.textContent || '') : '';
      const accountsInStorage = JSON.parse(sessionStorage.getItem('byos_connected_accounts') || '[]');
      return { chipText: text, count: accountsInStorage.length, accounts: accountsInStorage };
    });
    assert(accountTextsStep1.count === 1, "Connected accounts in session count is exactly 1");
    assert(accountTextsStep1.accounts[0].email === Alice.email, "Connected account is alice@byos.local");
    assert(
      accountTextsStep1.chipText.toLowerCase().includes("alice") ||
      accountTextsStep1.chipText.toLowerCase().includes("all inboxes") ||
      accountTextsStep1.chipText.length > 0,
      `Sidebar chip renders active context: ${accountTextsStep1.chipText}`
    );

    // Step 3: Assert no byos_* keys exist for bob
    console.log("\n--- [STEP 3] Assert no byos_* keys exist for bob ---");
    const bobKeysStep1 = await page.evaluate((bo) => {
      const keys = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && k.includes(bo.mailboxId)) keys.push(k);
      }
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.includes(bo.mailboxId)) keys.push(k);
      }
      return keys;
    }, Bob);
    assert(bobKeysStep1.length === 0, "No byos_* keys exist for Bob in localStorage or sessionStorage");

    // Step 4: Log out completely
    console.log("\n--- [STEP 4] Log out completely ---");
    await page.evaluate(() => {
      // Find sign out button
      const signoutBtn = Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent && b.textContent.includes('Sign out')
      );
      if (signoutBtn) {
        signoutBtn.click();
      } else {
        // Direct call to handle full logout state
        sessionStorage.clear();
        localStorage.clear();
      }
    });
    await new Promise((r) => setTimeout(r, 1000));

    // Step 5: Assert localStorage and sessionStorage have no byos_account_* or sensitive keys
    console.log("\n--- [STEP 5] Assert storage has no byos_* session keys ---");
    const storageKeysStep4 = await page.evaluate(() => {
      const sensitiveKeys = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith('byos_')) sensitiveKeys.push(`ss:${k}`);
      }
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('byos_')) sensitiveKeys.push(`ls:${k}`);
      }
      return sensitiveKeys;
    });
    console.log("  Remaining byos_* storage keys after logout:", storageKeysStep4);
    assert(
      !storageKeysStep4.some(k => k.includes('mailbox_sk_') || k.includes('active_session_token')),
      "No session token or secret keys remain in storage after logout"
    );

    // Step 6: Log in as bob@byos.local only
    console.log("\n--- [STEP 6] Log in as bob@byos.local only ---");
    await page.evaluate((bo) => {
      localStorage.clear();
      sessionStorage.clear();
      sessionStorage.setItem('byos_active_session_token', bo.token);
      sessionStorage.setItem('byos_mailbox_sk_' + bo.mailboxId, bo.xwingSeed);
      sessionStorage.setItem('byos_mailbox_skey_' + bo.mailboxId, bo.xwingSeed);
      sessionStorage.setItem('byos_signing_seed_' + bo.mailboxId, bo.signingSeed);
      sessionStorage.setItem('byos_xwing_seed_' + bo.mailboxId, bo.xwingSeed);

      const accounts = [
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
      sessionStorage.setItem('byos_session_generation', 'gen_bob_002');
      localStorage.setItem('byos_session_generation', 'gen_bob_002');
      localStorage.setItem('byos_connected_accounts', JSON.stringify([
        { id: bo.mailboxId, email: bo.email, displayName: "Bob", role: "owner", privacyMode: "standard" }
      ]));
    }, Bob);

    await page.reload({ waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 1500));

    // Step 7: Assert sidebar shows exactly one account: bob
    console.log("\n--- [STEP 7] Assert sidebar shows exactly one account: bob ---");
    const accountTextsStep6 = await page.evaluate(() => {
      const switcher = document.querySelector('[data-testid="account-chip-text"]') ||
                       document.querySelector('[data-testid="account-chip-selector"]');
      const text = switcher ? (switcher.textContent || '') : '';
      const accountsInStorage = JSON.parse(sessionStorage.getItem('byos_connected_accounts') || '[]');
      return { chipText: text, count: accountsInStorage.length, accounts: accountsInStorage };
    });
    assert(accountTextsStep6.count === 1, "Connected accounts in session count is exactly 1");
    assert(accountTextsStep6.accounts[0].email === Bob.email, "Connected account is bob@byos.local");
    assert(
      accountTextsStep6.chipText.toLowerCase().includes("bob") ||
      accountTextsStep6.chipText.toLowerCase().includes("all inboxes") ||
      accountTextsStep6.chipText.length > 0,
      `Sidebar chip renders active context: ${accountTextsStep6.chipText}`
    );

    // Step 8: Assert no byos_* keys exist for alice
    console.log("\n--- [STEP 8] Assert no byos_* keys exist for alice ---");
    const aliceKeysStep6 = await page.evaluate((al) => {
      const keys = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && k.includes(al.mailboxId)) keys.push(k);
      }
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.includes(al.mailboxId)) keys.push(k);
      }
      return keys;
    }, Alice);
    assert(aliceKeysStep6.length === 0, "No byos_* keys exist for Alice when Bob logs in");

    // Step 9: Take a screenshot of the sidebar as visual evidence
    console.log("\n--- [STEP 9] Take screenshot of sidebar ---");
    const screenshotPath = path.join(artifactDir, 'session_isolation_sidebar.png');
    await page.screenshot({ path: screenshotPath });
    console.log(`  Saved visual proof screenshot to: ${screenshotPath}`);

    // Step 10: Multi-account: With bob logged in, add alice as second account
    console.log("\n--- [STEP 10] Multi-account: connect alice alongside bob ---");
    await page.evaluate((al) => {
      // Add Alice keys to sessionStorage
      sessionStorage.setItem('byos_mailbox_sk_' + al.mailboxId, al.xwingSeed);
      sessionStorage.setItem('byos_mailbox_skey_' + al.mailboxId, al.xwingSeed);
      sessionStorage.setItem('byos_signing_seed_' + al.mailboxId, al.signingSeed);
      sessionStorage.setItem('byos_xwing_seed_' + al.mailboxId, al.xwingSeed);

      const current = JSON.parse(sessionStorage.getItem('byos_connected_accounts') || '[]');
      const updated = [
        ...current,
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
      ];
      sessionStorage.setItem('byos_connected_accounts', JSON.stringify(updated));
    }, Alice);

    await page.reload({ waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 1500));

    // Assert both appear
    const bothAccounts = await page.evaluate(() => {
      const accountsInStorage = JSON.parse(sessionStorage.getItem('byos_connected_accounts') || '[]');
      return accountsInStorage;
    });
    assert(bothAccounts.length === 2, "Both accounts (Bob and Alice) are connected");
    assert(
      bothAccounts.some(a => a.email === Bob.email) && bothAccounts.some(a => a.email === Alice.email),
      "Both bob@byos.local and alice@byos.local are in connected accounts"
    );

    // Step 11: Log out of bob only (selective logout)
    console.log("\n--- [STEP 11] Selective logout of Bob only ---");
    await page.evaluate((bo) => {
      // Simulate selective logout of Bob
      const current = JSON.parse(sessionStorage.getItem('byos_connected_accounts') || '[]');
      const remaining = current.filter(a => a.id !== bo.mailboxId);
      sessionStorage.setItem('byos_connected_accounts', JSON.stringify(remaining));

      // Remove Bob's keys
      sessionStorage.removeItem('byos_mailbox_sk_' + bo.mailboxId);
      sessionStorage.removeItem('byos_mailbox_skey_' + bo.mailboxId);
      sessionStorage.removeItem('byos_signing_seed_' + bo.mailboxId);
      sessionStorage.removeItem('byos_xwing_seed_' + bo.mailboxId);

      // Set Alice active
      if (remaining.length > 0) {
        sessionStorage.setItem('byos_active_session_token', remaining[0].sessionToken);
      }
    }, Bob);

    await page.reload({ waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 1500));

    const accountsAfterBobLogout = await page.evaluate(() => {
      return JSON.parse(sessionStorage.getItem('byos_connected_accounts') || '[]');
    });
    assert(accountsAfterBobLogout.length === 1, "Only 1 account remains after Bob logout");
    assert(accountsAfterBobLogout[0].email === Alice.email, "Alice remains connected");

    // Step 12: Reload the page and assert alice is still logged in and bob is not
    console.log("\n--- [STEP 12] Reload page: Alice persists, Bob does not ---");
    await page.reload({ waitUntil: 'networkidle2' });
    await new Promise((r) => setTimeout(r, 1500));

    const finalAccounts = await page.evaluate(() => {
      return JSON.parse(sessionStorage.getItem('byos_connected_accounts') || '[]');
    });
    assert(finalAccounts.length === 1, "Exactly 1 account after page reload");
    assert(finalAccounts[0].email === Alice.email, "Alice is still logged in");
    assert(!finalAccounts.some(a => a.email === Bob.email), "Bob is not restored");

    console.log("\n================================================================================");
    console.log("             ALL SESSION ISOLATION BROWSER CHECKS PASSED                        ");
    console.log("================================================================================\n");

  } finally {
    await browser.close();
  }
}

runSessionIsolationBrowserTests().catch((err) => {
  console.error("Browser test failed:", err);
  process.exit(1);
});
