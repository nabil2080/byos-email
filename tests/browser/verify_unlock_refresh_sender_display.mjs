/**
 * Browser verification:
 * 1. Mailbox Unlock Persistence Across Refresh (survives page reload without re-locking)
 * 2. Email List Sender Display (Name if available, else clean email)
 * 3. External Sender Warning Removal (no alarming banner for external emails)
 * 4. Key Zeroization on Logout (purges session vault and keys)
 */

import puppeteer from "../../apps/webmail/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const artifactsDir = path.resolve(__dirname, "artifacts");

if (!fs.existsSync(artifactsDir)) {
  fs.mkdirSync(artifactsDir, { recursive: true });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const testResults = [];
function recordResult(id, name, passed, details = "") {
  testResults.push({ id, name, passed, details, timestamp: new Date().toISOString() });
  const statusStr = passed ? "[PASS]" : "[FAIL]";
  console.log(`  ${statusStr} [${id}] ${name}`);
  if (details) {
    console.log(`         Details: ${details}`);
  }
}

async function run() {
  console.log("================================================================================");
  console.log("   BYOS WEBMAIL: UNLOCK REFRESH PERSISTENCE & SENDER DISPLAY E2E VERIFICATION   ");
  console.log("================================================================================\n");

  const pageErrors = [];
  const networkRequests = [];

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--window-size=1280,800",
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  page.on("pageerror", (err) => {
    pageErrors.push(err.message);
    console.error("  [PAGE ERROR]", err.message);
  });

  page.on("request", (req) => {
    if (req.url().includes("/v1/")) {
      networkRequests.push({ url: req.url(), method: req.method() });
    }
  });

  try {
    // -------------------------------------------------------------------------
    // STEP 1: Fresh Login
    // -------------------------------------------------------------------------
    console.log("--- [STEP 1] Login Flow as Alice (alice@byos.local) ---");
    await page.goto("http://127.0.0.1:3001", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload({ waitUntil: "networkidle2" });
    await sleep(800);

    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.type('input[type="email"]', "alice@byos.local");
    await page.type('input[type="password"]', "test-password-123");
    await page.click('button[type="submit"]');

    await page.waitForSelector('[data-testid="account-chip-selector"]', { timeout: 15000 });
    await sleep(1500);
    console.log("  Successfully logged in as Alice.\n");

    // -------------------------------------------------------------------------
    // STEP 2: Assert Initial Mailbox Unlock State
    // -------------------------------------------------------------------------
    console.log("--- [STEP 2] Initial Mailbox Unlock State Verification ---");
    const initialLockedBadge = await page.$('[data-testid="account-chip-locked"]');
    const isLockedInitially = initialLockedBadge !== null;

    const storageDumpInitial = await page.evaluate(() => {
      return {
        sessionVault: sessionStorage.getItem("byos_session_vault"),
        connectedAccounts: sessionStorage.getItem("byos_connected_accounts"),
        activeBoxId: sessionStorage.getItem("byos_active_mailbox_id"),
      };
    });

    const hasVaultInitially = Boolean(storageDumpInitial.sessionVault && storageDumpInitial.sessionVault.length > 20);
    recordResult(
      "VERIFY-1a",
      "Mailbox is unlocked immediately after authentication",
      !isLockedInitially && hasVaultInitially,
      `isLockedInitially=${isLockedInitially}, hasSessionVault=${hasVaultInitially}, vaultLen=${storageDumpInitial.sessionVault?.length || 0}`
    );

    const initialScreenshotPath = path.join(artifactsDir, "mailbox_unlocked_initial.png");
    await page.screenshot({ path: initialScreenshotPath });
    console.log(`  Saved screenshot: ${initialScreenshotPath}`);

    // Ensure Alice has Bob Stone in contacts so we can verify Real Display Name resolution
    const vaultObj = JSON.parse(storageDumpInitial.sessionVault || "{}");
    const activeBoxId = Object.keys(vaultObj)[0];
    if (activeBoxId) {
      console.log(`  Seeding / checking contact 'Bob Stone' <bob@byos.local> for mailbox ${activeBoxId}...`);
      const contactResult = await page.evaluate(async (boxId) => {
        try {
          const res = await fetch(`/v1/mailboxes/${boxId}/contacts`);
          const data = await res.json();
          // Read session vault to get mailboxSkHex
          const vault = JSON.parse(sessionStorage.getItem("byos_session_vault") || "{}");
          const entry = vault[boxId];
          if (!entry || !entry.mailboxSkHex) {
            return { error: "No mailboxSkHex in vault" };
          }

          const wasm = await import("/src/generated/crypto-core/byos_crypto_core.js");
          const { encryptContactEnvelope, decryptContactEnvelope } = await import("/src/message_crypto.ts");
          const keyBytes = new Uint8Array(entry.mailboxSkHex.match(/.{1,2}/g).map((b) => parseInt(b, 16)));

          // Check if contact already exists
          let hasBob = false;
          for (const c of data.contacts || []) {
            if (c.encrypted_envelope) {
              try {
                const dec = decryptContactEnvelope(wasm, keyBytes, boxId, c.encrypted_envelope);
                if (dec.email && dec.email.toLowerCase() === "bob@byos.local") {
                  hasBob = true;
                  break;
                }
              } catch {}
            }
          }

          if (!hasBob) {
            const envelope = encryptContactEnvelope(wasm, keyBytes, boxId, {
              name: "Bob Stone",
              email: "bob@byos.local",
              notes: "Team member",
              group: "Colleagues",
            });
            const createRes = await fetch(`/v1/mailboxes/${boxId}/contacts`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                encrypted_envelope: envelope,
              }),
            });
            return { action: "created", status: createRes.status };
          }
          return { action: "already_exists" };
        } catch (e) {
          return { error: e.message };
        }
      }, activeBoxId);
      console.log("  Contact seed result:", JSON.stringify(contactResult));
      await sleep(500);
    }

    // -------------------------------------------------------------------------
    // STEP 3: Page Reload / Refresh Persistence
    // -------------------------------------------------------------------------
    console.log("\n--- [STEP 3] Page Reload (F5 Refresh) Persistence Check ---");
    await page.reload({ waitUntil: "networkidle2" });
    await sleep(2000);

    await page.waitForSelector('[data-testid="account-chip-selector"]', { timeout: 15000 });

    const reloadLockedBadge = await page.$('[data-testid="account-chip-locked"]');
    const isLockedAfterReload = reloadLockedBadge !== null;

    const reloadUnlockModal = await page.$('[data-testid="unlock-account-modal"]');
    const hasUnlockModalAfterReload = reloadUnlockModal !== null;

    const storageDumpAfterReload = await page.evaluate(() => {
      return {
        sessionVault: sessionStorage.getItem("byos_session_vault"),
        connectedAccounts: sessionStorage.getItem("byos_connected_accounts"),
      };
    });

    const hasVaultAfterReload = Boolean(storageDumpAfterReload.sessionVault && storageDumpAfterReload.sessionVault.length > 20);

    recordResult(
      "VERIFY-1b",
      "Mailbox stays unlocked across browser refresh (no re-lock or prompt)",
      !isLockedAfterReload && !hasUnlockModalAfterReload && hasVaultAfterReload,
      `isLockedAfterReload=${isLockedAfterReload}, hasUnlockModal=${hasUnlockModalAfterReload}, hasVault=${hasVaultAfterReload}`
    );

    const reloadScreenshotPath = path.join(artifactsDir, "mailbox_unlocked_after_refresh.png");
    await page.screenshot({ path: reloadScreenshotPath });
    console.log(`  Saved screenshot: ${reloadScreenshotPath}`);

    // -------------------------------------------------------------------------
    // STEP 4: Email List Sender Display Verification
    // -------------------------------------------------------------------------
    console.log("\n--- [STEP 4] Email List Sender Display Logic Check ---");
    await page.waitForSelector('[data-testid="message-row"], [data-testid="thread-row"]', { timeout: 15000 });
    await sleep(500);

    const senderDisplaySample = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('[data-testid="message-row"], [data-testid="thread-row"]'));
      return rows.slice(0, 10).map((r) => {
        const senderEl = r.querySelector('[data-testid="message-sender-name"], [data-testid="thread-sender-name"], [data-testid="message-sender"]');
        const subjectEl = r.querySelector('[data-testid="message-subject"], [data-testid="thread-subject"]');
        return {
          sender: senderEl ? senderEl.innerText.trim().replace(/^To:\s*/, "") : "",
          subject: subjectEl ? subjectEl.innerText.trim() : "",
        };
      });
    });

    console.log("  Sample rendered senders in message list:", JSON.stringify(senderDisplaySample.slice(0, 5), null, 2));

    const senderRenderClean = senderDisplaySample.length > 0 && senderDisplaySample.every((item) => {
      // Must be present and non-empty
      if (!item.sender || item.sender.length === 0) return false;
      // Should not contain raw unparsed angle brackets like "<bob@byos.local>" or raw empty quotes like '""'
      return !item.sender.startsWith("<") && !item.sender.endsWith(">") && !item.sender.includes('""');
    });

    recordResult(
      "VERIFY-2",
      "Sender column displays clean Name or email without angle brackets or malformed formatting",
      senderRenderClean,
      `Inspected ${senderDisplaySample.length} rows; senderRenderClean=${senderRenderClean}`
    );

    const bobRow = senderDisplaySample.find((item) => item.sender === "Bob Builder" || item.sender === "Bob Stone");
    const displaysBob = Boolean(bobRow);
    recordResult(
      "VERIFY-2b",
      "Sender column resolves bare email to real Display Name ('Bob Builder')",
      displaysBob,
      `displaysBob=${displaysBob}, found sender=${bobRow ? bobRow.sender : "none"}`
    );

    const listScreenshotPath = path.join(artifactsDir, "email_list_sender_display.png");
    await page.screenshot({ path: listScreenshotPath });
    console.log(`  Saved screenshot: ${listScreenshotPath}`);

    // -------------------------------------------------------------------------
    // STEP 5: Reading Pane & External Sender Warning Suppression
    // -------------------------------------------------------------------------
    console.log("\n--- [STEP 5] Reading Pane External Sender Warning Banner Check ---");
    // Click the first message row to open reading pane
    const firstRow = await page.$('[data-testid="message-row"], [data-testid="thread-row"]');
    if (firstRow) {
      await firstRow.click();
      await sleep(1500);

      // Verify that no banner says "This message came from outside BYOS. Its sender cannot be cryptographically verified."
      const paneText = await page.evaluate(() => {
        const pane = document.querySelector('[data-testid="reading-pane"]');
        return pane ? pane.innerText : document.body.innerText;
      });

      const hasOutsideByosWarning = paneText.includes("This message came from outside BYOS") ||
                                    paneText.includes("Its sender cannot be cryptographically verified");

      recordResult(
        "VERIFY-3",
        "External sender warning banner ('outside BYOS / cannot be cryptographically verified') is suppressed",
        !hasOutsideByosWarning,
        `hasOutsideByosWarning=${hasOutsideByosWarning}`
      );

      const readingScreenshotPath = path.join(artifactsDir, "reading_pane_no_external_warning.png");
      await page.screenshot({ path: readingScreenshotPath });
      console.log(`  Saved screenshot: ${readingScreenshotPath}`);
    } else {
      console.warn("  No message rows found to click for Reading Pane check.");
    }

    // -------------------------------------------------------------------------
    // STEP 6: Explicit Logout & Session Vault Key Purge
    // -------------------------------------------------------------------------
    console.log("\n--- [STEP 6] Logout & Cryptographic Key Purge Verification ---");
    const signoutBtn = await page.$('[data-testid="sidebar-signout-btn"]');
    if (signoutBtn) {
      console.log("  Found sidebar signout button, clicking...");
      await signoutBtn.click();
      await sleep(1500);
    } else {
      console.log("  Sidebar signout button not found, falling back to dropdown sign out...");
      const chipSelector = await page.$('[data-testid="account-chip-selector"]');
      if (chipSelector) {
        await chipSelector.click();
        await sleep(500);
        const dropdownLogout = await page.$('button[title*="Sign out"], button[title*="Log out"]');
        if (dropdownLogout) {
          await dropdownLogout.click();
          await sleep(1500);
        }
      }
    }

    // Now inspect storage after logout
    const storageAfterLogout = await page.evaluate(() => {
      // Check session vault and legacy keys
      const vault = sessionStorage.getItem("byos_session_vault");
      const legacyKeys = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && k.startsWith("byos_mailbox_sk_")) legacyKeys.push(k);
      }
      return {
        vault,
        legacyKeys,
        connectedAccounts: sessionStorage.getItem("byos_connected_accounts"),
      };
    });

    const isPurged = storageAfterLogout.vault === null && storageAfterLogout.legacyKeys.length === 0;

    recordResult(
      "VERIFY-4",
      "Explicit logout zeroizes and completely purges byos_session_vault and all private keys",
      isPurged,
      `vaultPurged=${storageAfterLogout.vault === null}, legacyKeysCount=${storageAfterLogout.legacyKeys.length}`
    );

    const logoutScreenshotPath = path.join(artifactsDir, "mailbox_logged_out_vault_cleared.png");
    await page.screenshot({ path: logoutScreenshotPath });
    console.log(`  Saved screenshot: ${logoutScreenshotPath}`);

    // Summary
    console.log("\n================================================================================");
    console.log("                        E2E VERIFICATION SUMMARY                                ");
    console.log("================================================================================");
    const allPassed = testResults.every((t) => t.passed);
    console.log(`TOTAL CHECKS: ${testResults.length} | PASSED: ${testResults.filter(t => t.passed).length} | FAILED: ${testResults.filter(t => !t.passed).length}`);
    if (allPassed) {
      console.log("ALL E2E CHECKS PASSED!");
    } else {
      console.error("SOME E2E CHECKS FAILED!");
    }
  } catch (err) {
    console.error("Unexpected error during E2E verification:", err);
  } finally {
    await browser.close();
  }
}

run();
