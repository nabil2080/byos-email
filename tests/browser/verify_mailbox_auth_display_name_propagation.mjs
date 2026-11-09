/**
 * Browser verification script:
 * 1. Mailbox Authorization Error Remediation (no 403 'not authorized for this mailbox' on user switch)
 * 2. Mailbox Settings Display Name Persistence & Immediate UI Propagation
 * 3. Thread Participant Deduplication (no 2 duplicate names for the same sender e.g. 'Alice, Alice')
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
  console.log("   BYOS WEBMAIL: MAILBOX AUTH, DISPLAY NAME & DEDUPLICATION E2E VERIFICATION   ");
  console.log("================================================================================\n");

  const pageErrors = [];
  const networkEvents = [];

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

  page.on("response", (resp) => {
    const url = resp.url();
    if (url.includes("/v1/")) {
      networkEvents.push({
        url,
        method: resp.request().method(),
        status: resp.status(),
      });
    }
  });

  try {
    // -------------------------------------------------------------------------
    // STEP 1: Login as Alice to establish an initial active session and mailbox context
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
    await sleep(1200);

    const aliceMailboxId = await page.evaluate(() => {
      return sessionStorage.getItem("byos_active_mailbox_id") || "c0000000-0000-0000-0000-000000000001";
    });
    console.log(`  Alice logged in successfully. Active mailbox ID: ${aliceMailboxId}\n`);

    // -------------------------------------------------------------------------
    // STEP 2: Sign Out Alice
    // -------------------------------------------------------------------------
    console.log("--- [STEP 2] Alice Logs Out ---");
    const signoutBtn = await page.$('[data-testid="sidebar-signout-btn"]');
    if (signoutBtn) {
      await signoutBtn.click();
    } else {
      const chipSelector = await page.$('[data-testid="account-chip-selector"]');
      if (chipSelector) {
        await chipSelector.click();
        await sleep(400);
        const dropdownLogout = await page.$('button[title*="Sign out"], button[title*="Log out"]');
        if (dropdownLogout) await dropdownLogout.click();
      }
    }
    await sleep(1500);
    console.log("  Alice logged out.\n");

    // -------------------------------------------------------------------------
    // STEP 3: Login as Bob (bob@byos.local) - Verify No 403 Authorization Error
    // -------------------------------------------------------------------------
    console.log("--- [STEP 3] Login Flow as Bob (bob@byos.local) ---");
    const emailInput = await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.evaluate((el) => (el.value = ""), emailInput);
    await emailInput.type("bob@byos.local");

    const pwdInput = await page.waitForSelector('input[type="password"]', { timeout: 10000 });
    await page.evaluate((el) => (el.value = ""), pwdInput);
    await pwdInput.type("test-password-123");

    await page.click('button[type="submit"]');

    // Wait for either account chip or login error
    try {
      await page.waitForSelector('[data-testid="account-chip-selector"]', { timeout: 15000 });
    } catch (e) {
      const loginErr = await page.evaluate(() => {
        const errEl = document.querySelector('[role="alert"], [data-testid="login-error"]');
        return errEl ? errEl.innerText : document.body.innerText.slice(0, 300);
      });
      console.error("  Login failed or timed out. Page text:", loginErr);
      await page.screenshot({ path: path.join(artifactsDir, "bob_login_error_debug.png") });
      throw e;
    }
    await sleep(1500);

    // Check for any error banner mentioning "not authorized for this mailbox"
    const bannerError = await page.evaluate(() => {
      const el = document.querySelector('[role="alert"], [data-testid="error-banner"], .bg-red-50');
      return el ? el.innerText : null;
    });

    // Check recent network responses for 403 status on /v1/auth/me or mailboxes
    const authMe403 = networkEvents.filter(
      (e) => e.status === 403 && (e.url.includes("/v1/auth/me") || e.url.includes("/v1/mailboxes"))
    );

    recordResult(
      "AUTH-1",
      "Bob logs in without 'not authorized for this mailbox' 403 error",
      !bannerError && authMe403.length === 0,
      `bannerError=${bannerError}, authMe403Count=${authMe403.length}`
    );

    const bobLoginScreenshot = path.join(artifactsDir, "bob_login_no_auth_error.png");
    await page.screenshot({ path: bobLoginScreenshot });
    console.log(`  Saved screenshot: ${bobLoginScreenshot}\n`);

    // -------------------------------------------------------------------------
    // STEP 4: Bob Mailbox Settings - Change Display Name & Assert Propagation
    // -------------------------------------------------------------------------
    console.log("--- [STEP 4] Bob Settings Display Name Change ---");
    // Navigate to Settings
    const settingsBtn = await page.$('a[href="/settings"], button[aria-label="Settings"], [data-testid="nav-settings"]');
    if (settingsBtn) {
      await settingsBtn.click();
    } else {
      await page.goto("http://127.0.0.1:3001/settings", { waitUntil: "networkidle2" });
    }
    await sleep(1200);

    // Locate First Name and Last Name inputs
    const firstNameInput = await page.waitForSelector('[data-testid="settings-first-name-input"]', { timeout: 10000 });
    const lastNameInput = await page.waitForSelector('[data-testid="settings-last-name-input"]', { timeout: 10000 });

    if (firstNameInput && lastNameInput) {
      // Clear and type "Bob" and "Builder"
      await page.evaluate((el) => (el.value = ""), firstNameInput);
      await firstNameInput.type("Bob");
      await page.evaluate((el) => (el.value = ""), lastNameInput);
      await lastNameInput.type("Builder");

      // Click Save Name button
      const saveBtn = await page.waitForSelector('[data-testid="settings-save-name-btn"]', { timeout: 5000 });
      if (saveBtn) {
        await saveBtn.click();
        await sleep(2000);
      }
    }

    // Verify session storage has updated display name for Bob
    const bobStorage = await page.evaluate(() => {
      const rawAccounts = sessionStorage.getItem("byos_connected_accounts");
      let accounts = [];
      try { accounts = JSON.parse(rawAccounts || "[]"); } catch {}
      const bobAcc = accounts.find((a) => a.email && a.email.toLowerCase() === "bob@byos.local");
      return {
        displayName: bobAcc ? bobAcc.displayName : null,
        cachedEmailName: sessionStorage.getItem("byos_sender_email_name_bob@byos.local"),
      };
    });

    recordResult(
      "SETTINGS-1",
      "Display name update in Settings persists to Connected Accounts & sessionStorage",
      bobStorage.displayName === "Bob Builder",
      `displayName=${bobStorage.displayName}, cachedEmailName=${bobStorage.cachedEmailName}`
    );

    const bobSettingsScreenshot = path.join(artifactsDir, "bob_settings_display_name_saved.png");
    await page.screenshot({ path: bobSettingsScreenshot });
    console.log(`  Saved screenshot: ${bobSettingsScreenshot}\n`);

    // -------------------------------------------------------------------------
    // STEP 5: Email List Participant Deduplication in Bob's Mailbox
    // -------------------------------------------------------------------------
    console.log("--- [STEP 5] Email List Alice Participant Deduplication Check ---");
    // Return to inbox
    const inboxBtn = await page.$('a[href="/inbox"], [data-testid="nav-inbox"]');
    if (inboxBtn) {
      await inboxBtn.click();
    } else {
      await page.goto("http://127.0.0.1:3001/inbox", { waitUntil: "networkidle2" });
    }
    await sleep(1500);

    // Inspect rendered participant/sender strings in email list
    const renderedSenders = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('[data-testid="message-row"], [data-testid="thread-row"]'));
      return rows.map((r) => {
        const senderEl = r.querySelector('[data-testid="message-sender-name"], [data-testid="thread-sender-name"], [data-testid="message-sender"]');
        return senderEl ? senderEl.innerText.trim().replace(/^To:\s*/, "") : "";
      });
    });

    console.log("  Rendered senders in Bob's email list:", JSON.stringify(renderedSenders));

    // Assert that no row displays "Alice, Alice" or "Alice Smith, Alice" or duplicate names
    const hasDuplicateAlice = renderedSenders.some((s) => {
      const lower = s.toLowerCase();
      // Look for duplicate patterns like "alice, alice" or "alice smith, alice"
      return (
        lower.includes("alice, alice") ||
        lower.includes("alice smith, alice") ||
        lower.includes("alice, alice smith") ||
        lower.includes("alice@byos.local, alice")
      );
    });

    recordResult(
      "DEDUP-1",
      "Threads from alice@byos.local collapse duplicate participant names into a single clean sender",
      !hasDuplicateAlice && renderedSenders.length > 0,
      `hasDuplicateAlice=${hasDuplicateAlice}, sampleCount=${renderedSenders.length}`
    );

    const bobListScreenshot = path.join(artifactsDir, "bob_mailbox_email_list_no_duplicate_sender.png");
    await page.screenshot({ path: bobListScreenshot });
    console.log(`  Saved screenshot: ${bobListScreenshot}\n`);

    // -------------------------------------------------------------------------
    // STEP 6: Bob Logs Out & Alice Logs Back In to Verify Bob's Display Name
    // -------------------------------------------------------------------------
    console.log("--- [STEP 6] Bob Logs Out & Alice Logs In ---");
    const bobSignoutBtn = await page.$('[data-testid="sidebar-signout-btn"]');
    if (bobSignoutBtn) {
      await bobSignoutBtn.click();
    } else {
      const chipSelector = await page.$('[data-testid="account-chip-selector"]');
      if (chipSelector) {
        await chipSelector.click();
        await sleep(400);
        const dropdownLogout = await page.$('button[title*="Sign out"], button[title*="Log out"]');
        if (dropdownLogout) await dropdownLogout.click();
      }
    }
    await sleep(1500);

    const aliceEmailInput = await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.evaluate((el) => (el.value = ""), aliceEmailInput);
    await aliceEmailInput.type("alice@byos.local");

    const alicePwdInput = await page.waitForSelector('input[type="password"]', { timeout: 10000 });
    await page.evaluate((el) => (el.value = ""), alicePwdInput);
    await alicePwdInput.type("test-password-123");

    await page.click('button[type="submit"]');
    await page.waitForSelector('[data-testid="account-chip-selector"]', { timeout: 15000 });
    await sleep(2000);

    // -------------------------------------------------------------------------
    // STEP 7: Assert Bob's Name in Alice's Email List is "Bob Builder" (NOT "Bob Stone")
    // -------------------------------------------------------------------------
    console.log("--- [STEP 7] Alice's Email List: Bob's Sender Resolution ---");
    const aliceInboxBtn = await page.$('a[href="/inbox"], [data-testid="nav-inbox"]');
    if (aliceInboxBtn) {
      await aliceInboxBtn.click();
      await sleep(1500);
    }

    const aliceListSenders = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('[data-testid="message-row"], [data-testid="thread-row"]'));
      return rows.map((r) => {
        const senderEl = r.querySelector('[data-testid="message-sender-name"], [data-testid="thread-sender-name"], [data-testid="message-sender"]');
        return senderEl ? senderEl.innerText.trim().replace(/^To:\s*/, "") : "";
      });
    });

    console.log("  Rendered senders in Alice's email list:", JSON.stringify(aliceListSenders));

    const displaysBobBuilder = aliceListSenders.includes("Bob Builder");
    const displaysBobStone = aliceListSenders.includes("Bob Stone");

    recordResult(
      "NAME-PROPAGATE-1",
      "Alice's email list displays Bob's settings display name ('Bob Builder') and NOT stale 'Bob Stone'",
      displaysBobBuilder && !displaysBobStone,
      `displaysBobBuilder=${displaysBobBuilder}, displaysBobStone=${displaysBobStone}`
    );

    const aliceListScreenshot = path.join(artifactsDir, "alice_email_list_bob_builder_display_name.png");
    await page.screenshot({ path: aliceListScreenshot });
    console.log(`  Saved screenshot: ${aliceListScreenshot}\n`);

    // -------------------------------------------------------------------------
    // STEP 8: Reading Pane Displays "Bob Builder"
    // -------------------------------------------------------------------------
    console.log("--- [STEP 8] Reading Pane Sender Verification ---");
    // Click on Bob's row in Alice's email list
    const bobRowElement = await page.evaluateHandle(() => {
      const rows = Array.from(document.querySelectorAll('[data-testid="message-row"], [data-testid="thread-row"]'));
      return rows.find((r) => {
        const txt = r.innerText || "";
        return txt.includes("Bob Builder");
      });
    });

    let readingPaneSenderText = "";
    if (bobRowElement && bobRowElement.asElement()) {
      await bobRowElement.asElement().click();
      await sleep(2000);

      readingPaneSenderText = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="reading-pane-sender-name"]');
        return el ? el.innerText.trim() : "";
      });
    }

    const readingPaneHasBobBuilder = readingPaneSenderText.includes("Bob Builder");
    recordResult(
      "NAME-PROPAGATE-2",
      "Reading pane resolves sender to Bob's updated display name ('Bob Builder')",
      readingPaneHasBobBuilder,
      `readingPaneSenderText=${readingPaneSenderText}`
    );

    const readingPaneScreenshot = path.join(artifactsDir, "alice_reading_pane_bob_builder.png");
    await page.screenshot({ path: readingPaneScreenshot });
    console.log(`  Saved screenshot: ${readingPaneScreenshot}\n`);

    // -------------------------------------------------------------------------
    // SUMMARY
    // -------------------------------------------------------------------------
    console.log("================================================================================");
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
