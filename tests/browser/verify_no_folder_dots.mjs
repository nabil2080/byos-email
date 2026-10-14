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

function assert(condition, message) {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  PASS: ${message}`);
}

function execSql(sql) {
  const cmd = `docker exec byos-postgres psql -U byos -d byos -t -A -c "${sql.replace(/"/g, '\\"')}"`;
  return execSync(cmd, { encoding: "utf8" }).trim();
}

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

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runVerification() {
  console.log("================================================================================");
  console.log("          MANUAL VERIFICATION: REMOVE FOLDER-SELECTION-DOT                       ");
  console.log("================================================================================\n");

  // Ensure DB sessions exist
  execSql(`INSERT INTO sessions (user_id, token_hash, expires_at, revoked_at) VALUES ('${Alice.userId}', digest('${Alice.token}', 'sha256'), now() + interval '1 day', NULL) ON CONFLICT (token_hash) DO UPDATE SET expires_at = now() + interval '1 day', revoked_at = NULL`);
  execSql(`INSERT INTO sessions (user_id, token_hash, expires_at, revoked_at) VALUES ('${Bob.userId}', digest('${Bob.token}', 'sha256'), now() + interval '1 day', NULL) ON CONFLICT (token_hash) DO UPDATE SET expires_at = now() + interval '1 day', revoked_at = NULL`);

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ['--no-sandbox', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    // Step 1: Open webmail with two accounts connected
    await page.goto('http://127.0.0.1:3001', { waitUntil: 'domcontentloaded' });
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
    await sleep(1500);

    const sidebarEl = await page.waitForSelector('aside', { timeout: 5000 });

    // CHECK 1 & 2: Open webmail. Confirm no colored dots appear next to any folder. Confirm account chip shows active account.
    console.log("--- [CHECK 1 & 2] Confirm no dots next to any folder and account chip shows active account (Alice) ---");
    const check1 = await page.evaluate(() => {
      const chipText = document.querySelector('[data-testid="account-chip-text"]')?.textContent?.trim();
      const chipDot = document.querySelector('[data-testid="account-chip-dot"]');
      const chipDotColor = chipDot ? window.getComputedStyle(chipDot).backgroundColor : null;

      const folderDots = document.querySelectorAll('[data-testid="folder-selection-dot"]');
      const folderRows = Array.from(document.querySelectorAll('nav button[data-testid^="folder-"]')).map((el) => {
        const testId = el.getAttribute('data-testid');
        const text = el.textContent?.trim();
        const hasSvgIcon = !!el.querySelector('svg');
        const dotsInside = el.querySelectorAll('[data-testid="folder-selection-dot"]').length;
        return { testId, text, hasSvgIcon, dotsInside };
      });

      return {
        chipText,
        chipDotColor,
        folderDotCount: folderDots.length,
        folderRows,
      };
    });

    console.log("  Observed Chip Text:", check1.chipText);
    console.log("  Observed Chip Dot Color:", check1.chipDotColor);
    console.log("  Observed folder-selection-dot count:", check1.folderDotCount);
    console.log("  Observed Folder Rows count:", check1.folderRows.length);

    assert(check1.chipText === "alice@byos.local", `Account chip displays active account "alice@byos.local"`);
    assert(check1.chipDotColor === "rgb(128, 34, 195)", `Account chip dot retains Alice's violet color rgb(128, 34, 195)`);
    assert(check1.folderDotCount === 0, `Zero folder-selection-dot elements exist in sidebar (got ${check1.folderDotCount})`);
    for (const row of check1.folderRows) {
      assert(row.dotsInside === 0, `Row ${row.testId} has 0 dots inside`);
      assert(row.hasSvgIcon, `Row ${row.testId} has folder SVG icon`);
    }

    const shot1 = path.join(artifactsDir, 'sidebar_no_dots_light.png');
    await sidebarEl.screenshot({ path: shot1 });
    console.log(`  Screenshot saved: ${shot1}`);

    // CHECK 3: Switch to second account (Bob). Confirm folder list updates but no dots appear.
    console.log("\n--- [CHECK 3] Switch to second account (Bob) and confirm no dots appear ---");
    await page.click('[data-testid="account-chip-selector"]');
    await sleep(500);

    await page.evaluate((boId) => {
      const optBob = document.querySelector(`[data-testid="account-dropdown-${boId}"]`);
      if (optBob) optBob.click();
    }, Bob.mailboxId);
    await sleep(1500);

    const check3 = await page.evaluate(() => {
      const chipText = document.querySelector('[data-testid="account-chip-text"]')?.textContent?.trim();
      const chipDot = document.querySelector('[data-testid="account-chip-dot"]');
      const chipDotColor = chipDot ? window.getComputedStyle(chipDot).backgroundColor : null;
      const folderDots = document.querySelectorAll('[data-testid="folder-selection-dot"]');
      const topFolderName = document.querySelector('[data-testid="folder-name-inbox"]')?.textContent?.trim();

      return {
        chipText,
        chipDotColor,
        topFolderName,
        folderDotCount: folderDots.length,
      };
    });

    console.log("  Observed Chip Text for Account 2:", check3.chipText);
    console.log("  Observed Chip Dot Color for Account 2:", check3.chipDotColor);
    console.log("  Observed folder-selection-dot count for Account 2:", check3.folderDotCount);

    assert(check3.chipText === "bob@byos.local", `Account chip switched to "bob@byos.local"`);
    assert(check3.chipDotColor === "rgb(34, 195, 168)", `Account chip shows Bob's teal dot rgb(34, 195, 168)`);
    assert(check3.folderDotCount === 0, `Zero folder-selection-dot elements exist after switching to Bob (got ${check3.folderDotCount})`);

    const shot3 = path.join(artifactsDir, 'sidebar_no_dots_second_account.png');
    await sidebarEl.screenshot({ path: shot3 });
    console.log(`  Screenshot saved: ${shot3}`);

    // CHECK 4: Toggle dark mode. Confirm no dots in either theme.
    console.log("\n--- [CHECK 4] Toggle Dark Mode and confirm no dots in dark theme ---");
    await page.evaluate(() => {
      document.documentElement.classList.add("dark");
      document.documentElement.dataset.theme = "dark";
      localStorage.setItem("byos_theme", "dark");
    });
    await sleep(500);

    const check4Dark = await page.evaluate(() => {
      const isDark = document.documentElement.classList.contains("dark");
      const folderDots = document.querySelectorAll('[data-testid="folder-selection-dot"]');
      return {
        isDark,
        folderDotCount: folderDots.length,
      };
    });

    console.log("  Dark Mode active:", check4Dark.isDark);
    console.log("  Dark Mode folder-selection-dot count:", check4Dark.folderDotCount);
    assert(check4Dark.isDark, "Dark mode class active on documentElement");
    assert(check4Dark.folderDotCount === 0, `Zero folder-selection-dot elements in Dark Mode (got ${check4Dark.folderDotCount})`);

    const shot4Dark = path.join(artifactsDir, 'sidebar_no_dots_dark.png');
    await sidebarEl.screenshot({ path: shot4Dark });
    console.log(`  Screenshot saved: ${shot4Dark}`);

    // Toggle back to light mode to confirm clean state
    await page.evaluate(() => {
      document.documentElement.classList.remove("dark");
      document.documentElement.dataset.theme = "cloud_dancer";
      localStorage.setItem("byos_theme", "cloud_dancer");
    });
    await sleep(500);

    const check4Light = await page.evaluate(() => {
      const isDark = document.documentElement.classList.contains("dark");
      const folderDots = document.querySelectorAll('[data-testid="folder-selection-dot"]');
      return {
        isDark,
        folderDotCount: folderDots.length,
      };
    });
    assert(!check4Light.isDark, "Restored to Light Mode");
    assert(check4Light.folderDotCount === 0, "Zero folder-selection-dot elements after returning to Light Mode");

    console.log("\n================================================================================");
    console.log("         ALL 4 MANUAL UI CHECKS VERIFIED ZERO FOLDER DOTS                       ");
    console.log("================================================================================\n");

  } finally {
    await browser.close();
  }
}

runVerification().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
