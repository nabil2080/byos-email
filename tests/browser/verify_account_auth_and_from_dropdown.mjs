/**
 * Browser verification test:
 * 1. Multi-account authentication & mailbox loading without 403 Forbidden.
 * 2. Redesigned Compose From: sender dropdown with custom floating popover,
 *    avatar icons, display names, email addresses, and type badges.
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
  console.log("   BYOS WEBMAIL: MULTI-ACCOUNT AUTH & FROM DROPDOWN REDESIGN E2E VERIFICATION    ");
  console.log("================================================================================\n");

  const pageErrors = [];
  const networkErrors = [];

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

  page.on("response", async (resp) => {
    const url = resp.url();
    if (resp.status() >= 400 && !url.includes("/v1/keys/")) {
      const text = await resp.text().catch(() => "");
      networkErrors.push({ url, status: resp.status(), text });
      console.log(`  [HTTP ${resp.status()}] ${resp.request().method()} ${url}: ${text}`);
    }
  });

  try {
    // -------------------------------------------------------------------------
    // STEP 1: Login as Alice
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

    const aliceMailboxId = await page.evaluate(() => {
      const raw = sessionStorage.getItem("byos_connected_accounts") || localStorage.getItem("byos_connected_accounts");
      if (raw) {
        try {
          const accs = JSON.parse(raw);
          if (accs && accs[0]) return accs[0].id;
        } catch {}
      }
      return null;
    });
    recordResult("AUTH_01", "Login as Alice and initialize mailbox session", Boolean(aliceMailboxId), `Alice ID: ${aliceMailboxId}`);

    // -------------------------------------------------------------------------
    // STEP 2: Connect Bob (bob@byos.local) via AddMailboxModal
    // -------------------------------------------------------------------------
    console.log("--- [STEP 2] Connect Bob (bob@byos.local) via AddMailboxModal ---");
    await page.click('[data-testid="account-chip-selector"]');
    await sleep(400);

    const addBtn = await page.waitForSelector('[data-testid="add-mailbox-button"]', { timeout: 5000 });
    await addBtn.click();
    await sleep(500);

    await page.waitForSelector('input[placeholder="user@yourdomain.com"]', { timeout: 5000 });
    await page.type('input[placeholder="user@yourdomain.com"]', "bob@byos.local");
    await page.type('input[placeholder="Account password"]', "test-password-123");

    const submitButtons = await page.$$('button[type="submit"]');
    await submitButtons[submitButtons.length - 1].click();
    await sleep(2000);

    const connectedAccounts = await page.evaluate(() => {
      const raw = sessionStorage.getItem("byos_connected_accounts");
      return raw ? JSON.parse(raw) : [];
    });
    const hasBob = connectedAccounts.some((a) => a.email === "bob@byos.local");
    recordResult("AUTH_02", "Connect secondary account Bob Builder", hasBob, `Connected count: ${connectedAccounts.length}`);

    // -------------------------------------------------------------------------
    // STEP 3: Switch to Bob's Mailbox and Verify No 403 Forbidden
    // -------------------------------------------------------------------------
    console.log("--- [STEP 3] Switch to Bob's Mailbox & Assert Zero Authorization Errors ---");
    await page.click('[data-testid="account-chip-selector"]');
    await sleep(400);

    const bobOption = await page.waitForSelector('[data-testid="account-dropdown-c0000000-0000-0000-0000-000000000002"]', { timeout: 5000 });
    await bobOption.click();
    await sleep(2500);

    // Assert no 403 Forbidden error banner
    const globalError = await page.evaluate(() => {
      const el = document.querySelector('[role="alert"], [data-testid="global-error-banner"], .bg-red-500, .bg-red-50');
      return el ? el.textContent.trim() : null;
    });

    const has403 = networkErrors.some((e) => e.status === 403 && e.text.includes("not authorized"));
    recordResult("AUTH_03", "Bob's mailbox loaded without 'not authorized for this mailbox' error", !has403 && (!globalError || !globalError.includes("not authorized")), `Global error banner: ${globalError || "none"}`);

    // Verify Bob's messages or folders rendered
    const activeChipText = await page.$eval('[data-testid="account-chip-text"]', (el) => el.textContent.trim());
    recordResult("AUTH_04", "Active account switched to Bob", activeChipText.includes("bob") || activeChipText.includes("Bob"), `Active chip: ${activeChipText}`);

    // -------------------------------------------------------------------------
    // STEP 4: Open Compose Drawer and Inspect Redesigned From: Dropdown
    // -------------------------------------------------------------------------
    console.log("--- [STEP 4] Open Compose Drawer & Verify Redesigned From: Dropdown ---");
    await page.waitForSelector('[data-testid="sidebar-compose-btn"]', { timeout: 5000 });
    await page.click('[data-testid="sidebar-compose-btn"]');
    await sleep(600);

    // Verify custom trigger button exists
    const triggerExists = await page.$eval('[data-testid="compose-from-trigger"]', (el) => Boolean(el));
    recordResult("FROM_UI_01", "Custom compose from trigger button rendered", triggerExists);

    // Read trigger button content (should show avatar, display name, email, chevron)
    const triggerContent = await page.$eval('[data-testid="compose-from-trigger"]', (el) => ({
      text: el.textContent.trim(),
      hasAvatar: Boolean(el.querySelector('.rounded-full')),
      hasChevron: Boolean(el.querySelector('svg')),
    }));
    recordResult("FROM_UI_02", "From trigger displays avatar, display name/email, and chevron", triggerContent.hasAvatar && triggerContent.hasChevron, `Trigger text: ${triggerContent.text}`);

    // -------------------------------------------------------------------------
    // STEP 5: Click From Trigger to Open Custom Popover Menu
    // -------------------------------------------------------------------------
    console.log("--- [STEP 5] Open Custom From Popover & Verify Options ---");
    await page.click('[data-testid="compose-from-trigger"]');
    await sleep(400);

    const dropdownVisible = await page.$eval('[data-testid="compose-from-custom-dropdown"]', (el) => el && el.offsetParent !== null);
    recordResult("FROM_UI_03", "Custom floating popover dropdown opens on trigger click", dropdownVisible);

    // Inspect options inside dropdown
    const dropdownOptions = await page.evaluate(() => {
      const opts = Array.from(document.querySelectorAll('[data-testid="compose-from-custom-dropdown"] [role="option"]'));
      return opts.map((o) => ({
        text: o.textContent.trim(),
        selected: o.getAttribute("aria-selected") === "true",
        testId: o.getAttribute("data-testid"),
      }));
    });
    console.log("  Dropdown options rendered:", JSON.stringify(dropdownOptions, null, 2));

    const hasAccounts = dropdownOptions.some((o) => o.text.includes("bob@byos.local") || o.text.includes("Bob")) &&
                        dropdownOptions.some((o) => o.text.includes("alice@byos.local") || o.text.includes("Alice") || o.text.includes("Alexander"));
    recordResult("FROM_UI_04", "Dropdown lists both connected accounts with formatted names and roles", hasAccounts, `Options count: ${dropdownOptions.length}`);

    // Take screenshot of the open redesigned dropdown
    const screenshotPath = path.resolve(artifactsDir, "compose_from_dropdown_redesign.png");
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(`\n  [SCREENSHOT] Saved redesigned From dropdown screenshot: ${screenshotPath}\n`);
    recordResult("FROM_UI_05", "Saved high-fidelity screenshot to tests/browser/artifacts/", fs.existsSync(screenshotPath));

    // -------------------------------------------------------------------------
    // STEP 6: Select Alice from the Custom From Dropdown
    // -------------------------------------------------------------------------
    console.log("--- [STEP 6] Switch Sender to Alice via Custom From Dropdown ---");
    const aliceFromOpt = await page.waitForSelector('[data-testid="compose-from-option-c0000000-0000-0000-0000-000000000001"]', { timeout: 3000 });
    await aliceFromOpt.click();
    await sleep(400);

    // Verify popover closed
    const dropdownClosed = await page.$eval('[data-testid="compose-from-custom-dropdown"]', () => false).catch(() => true);
    recordResult("FROM_UI_06", "Dropdown automatically closes after selecting an account", dropdownClosed);

    // Verify updated trigger content reflects Alice
    const updatedTriggerText = await page.$eval('[data-testid="compose-from-trigger"]', (el) => el.textContent.trim());
    recordResult("FROM_UI_07", "From trigger updated to show Alice as selected sender", updatedTriggerText.includes("alice@byos.local") || updatedTriggerText.includes("Alexander Ham"), `Updated text: ${updatedTriggerText}`);

    // Verify hidden companion select is synced for backwards compatibility
    const hiddenSelectValue = await page.$eval('[data-testid="compose-from-select"]', (el) => el.value);
    recordResult("FROM_UI_08", "Companion hidden select value synchronized with custom selection", hiddenSelectValue === "account:c0000000-0000-0000-0000-000000000001", `Select value: ${hiddenSelectValue}`);

  } catch (err) {
    console.error("Test execution failed:", err);
    recordResult("FATAL", "Test threw unhandled exception", false, err.message);
  } finally {
    await browser.close();
  }

  console.log("\n================================================================================");
  console.log("   TEST SUMMARY                                                                 ");
  console.log("================================================================================");
  const passedCount = testResults.filter((r) => r.passed).length;
  const failedCount = testResults.filter((r) => !r.passed).length;
  console.log(`Passed: ${passedCount} / ${testResults.length}`);
  console.log(`Failed: ${failedCount} / ${testResults.length}`);
  console.log("================================================================================\n");

  if (failedCount > 0) {
    process.exit(1);
  }
}

run();
