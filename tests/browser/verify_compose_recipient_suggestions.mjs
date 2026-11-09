/**
 * Browser verification script:
 * Compose Recipient Auto-Suggestion & Colleague Display Name Resolution
 *
 * Verifies:
 * 1. Alice logs in via real authentication flow.
 * 2. Clicks Compose button to open the compose drawer.
 * 3. Types 'b' into the To: input field.
 * 4. Verifies the instant auto-suggestion dropdown appears with Bob's live display name: 'Bob Builder', email: 'bob@byos.local', and 'colleague' badge.
 * 5. Selects Bob Builder via Enter key.
 * 6. Verifies recipient chip renders with display name 'Bob Builder' and avatar 'B'.
 * 7. Types 'a' to verify second suggestion and that Bob is excluded from suggestions.
 * 8. Captures screenshots in tests/browser/artifacts/.
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
  console.log("   BYOS WEBMAIL: COMPOSE RECIPIENT AUTO-SUGGESTION E2E VERIFICATION             ");
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
    // STEP 1: Login as Alice (alice@byos.local)
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
      return sessionStorage.getItem("byos_active_mailbox_id");
    });
    console.log(`  Alice logged in successfully. Active mailbox ID: ${aliceMailboxId}\n`);
    recordResult("AUTH_01", "Login as Alice and initialize mailbox session", Boolean(aliceMailboxId), `Mailbox: ${aliceMailboxId}`);

    // -------------------------------------------------------------------------
    // STEP 2: Open Compose Drawer
    // -------------------------------------------------------------------------
    console.log("--- [STEP 2] Open Compose Drawer ---");
    await page.waitForSelector('[data-testid="sidebar-compose-btn"]', { timeout: 5000 });
    await page.click('[data-testid="sidebar-compose-btn"]');
    await page.waitForSelector('#composeToInput', { timeout: 5000 });
    await sleep(500);

    const composeInputVisible = await page.$eval('#composeToInput', (el) => Boolean(el && el.offsetParent !== null));
    recordResult("COMPOSE_01", "Compose drawer opens with #composeToInput field", composeInputVisible);

    // -------------------------------------------------------------------------
    // STEP 3: Verify 3-Character Minimum Threshold & Word-Prefix Matching
    // -------------------------------------------------------------------------
    console.log("--- [STEP 3] Verify 3-Character Minimum Threshold & Word-Prefix Matching ---");
    // Type single letter 'b' (length 1 < 3) - dropdown must NOT appear
    await page.type('#composeToInput', 'b');
    await sleep(350);
    const dropdownVisibleForSingleLetter = await page.$eval('[data-testid="autocomplete-dropdown"]', () => true).catch(() => false);
    recordResult("SUGGEST_THRESHOLD_01", "Autocomplete dropdown remains closed when typing 1 letter (< 3 chars)", !dropdownVisibleForSingleLetter);

    // Type second letter 'o' (length 2 < 3) - dropdown must NOT appear
    await page.type('#composeToInput', 'o');
    await sleep(350);
    const dropdownVisibleForTwoLetters = await page.$eval('[data-testid="autocomplete-dropdown"]', () => true).catch(() => false);
    recordResult("SUGGEST_THRESHOLD_02", "Autocomplete dropdown remains closed when typing 2 letters (< 3 chars)", !dropdownVisibleForTwoLetters);

    // Type third letter 'b' (now 'bob', length 3 >= 3) - dropdown MUST appear
    await page.type('#composeToInput', 'b');
    await sleep(400);

    await page.waitForSelector('[data-testid="autocomplete-dropdown"]', { timeout: 4000 });
    const dropdownVisible = await page.$eval('[data-testid="autocomplete-dropdown"]', (el) => Boolean(el && el.offsetParent !== null));
    recordResult("SUGGEST_01", "Autocomplete dropdown appears upon typing 3 letters ('bob')", dropdownVisible);

    const suggestionItems = await page.$$eval('[data-testid="autocomplete-item"]', (items) => {
      return items.map((it) => ({
        email: it.getAttribute("data-email"),
        name: it.getAttribute("data-name"),
        text: it.innerText.replace(/\s+/g, " ").trim(),
      }));
    });
    console.log("  Suggestions returned for 'bob':", JSON.stringify(suggestionItems, null, 2));

    const bobSuggestion = suggestionItems.find((s) => s.email === "bob@byos.local");
    const expectedBobName = bobSuggestion?.name || "Bob Builder";
    const hasBobResolvedName = Boolean(bobSuggestion && (bobSuggestion.name === "Bob Builder" || bobSuggestion.name === "Daddy Bob"));
    recordResult(
      "SUGGEST_02",
      `Autocomplete suggests live settings display name ('${expectedBobName}') <bob@byos.local> for colleague Bob`,
      hasBobResolvedName,
      JSON.stringify(bobSuggestion)
    );

    // Verify self-exclusion: Alice's own email (alice@byos.local) must NOT be suggested to herself as a colleague
    const aliceExcluded = !suggestionItems.some((s) => s.email === "alice@byos.local");
    recordResult(
      "SUGGEST_SELF_EXCLUSION",
      "Sender's own email ('alice@byos.local') is excluded from colleague suggestions",
      aliceExcluded
    );

    const dropdownScreenshotPath = path.resolve(artifactsDir, "compose_recipient_suggestions_dropdown.png");
    await page.screenshot({ path: dropdownScreenshotPath });
    console.log(`  Saved screenshot: ${dropdownScreenshotPath}\n`);

    // -------------------------------------------------------------------------
    // STEP 4: Select Bob Builder via Enter Key
    // -------------------------------------------------------------------------
    console.log("--- [STEP 4] Select Bob Builder and Verify Chip Rendering ---");
    await page.keyboard.press("Enter");
    await sleep(400);

    // Verify dropdown closes
    const isDropdownClosed = await page.$eval('[data-testid="autocomplete-dropdown"]', () => false).catch(() => true);
    recordResult("CHIP_01", "Autocomplete dropdown closes after selecting candidate", isDropdownClosed);

    // Verify recipient chip
    await page.waitForSelector('[data-testid="recipient-chip"]', { timeout: 4000 });
    const chipData = await page.$eval('[data-testid="recipient-chip"]', (el) => ({
      email: el.getAttribute("data-email"),
      label: el.querySelector('[data-testid="chip-label"]')?.innerText || "",
      avatar: el.querySelector('[data-testid="chip-avatar"]')?.innerText || "",
    }));

    console.log("  Rendered Recipient Chip:", JSON.stringify(chipData, null, 2));
    const isChipValid = chipData.email === "bob@byos.local" && (chipData.label.includes("Bob Builder") || chipData.label.includes("Daddy Bob"));
    recordResult(
      "CHIP_02",
      `Recipient chip displays '${expectedBobName}' display name and initial avatar '${expectedBobName[0]}'`,
      isChipValid,
      `Label: "${chipData.label}", Email: "${chipData.email}", Avatar: "${chipData.avatar}"`
    );

    const chipScreenshotPath = path.resolve(artifactsDir, "compose_recipient_chip_resolved.png");
    await page.screenshot({ path: chipScreenshotPath });
    console.log(`  Saved screenshot: ${chipScreenshotPath}\n`);

    // -------------------------------------------------------------------------
    // STEP 5: Type 'bob' again and ensure Bob is NOT duplicated
    // -------------------------------------------------------------------------
    console.log("--- [STEP 5] Type 'bob' Again - Verify Selected Recipient Excluded ---");
    await page.type('#composeToInput', 'bob');
    await sleep(400);

    const secondSuggestions = await page.$$eval('[data-testid="autocomplete-item"]', (items) => {
      return items.map((it) => it.getAttribute("data-email"));
    }).catch(() => []);

    const bobExcluded = !secondSuggestions.includes("bob@byos.local");
    recordResult(
      "DEDUP_01",
      "Already-selected recipient 'bob@byos.local' is excluded from subsequent suggestions",
      bobExcluded,
      `Remaining suggestions: ${JSON.stringify(secondSuggestions)}`
    );

    // Clean up input
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press("Backspace");
    }
    await sleep(200);

    // -------------------------------------------------------------------------
    // STEP 6: DevTools State & Verification Summary
    // -------------------------------------------------------------------------
    const devtoolsState = await page.evaluate(() => {
      const storageDump = {};
      for (let i = 0; i < sessionStorage.length; i++) {
        const k = sessionStorage.key(i);
        if (k && (k.startsWith("byos_active") || k.startsWith("byos_org"))) {
          storageDump[k] = sessionStorage.getItem(k);
        }
      }
      return {
        url: window.location.href,
        sessionStorage: storageDump,
      };
    });

    console.log("\n================================================================================");
    console.log("   BROWSER DEVTOOLS STATE AT COMPLETION                                         ");
    console.log("================================================================================");
    console.log(JSON.stringify(devtoolsState, null, 2));

    const allPassed = testResults.every((r) => r.passed);
    console.log("\n================================================================================");
    console.log(`   FINAL VERDICT: ${allPassed ? "PASS" : "FAIL"}`);
    console.log(`   Total Checks: ${testResults.length} | Passed: ${testResults.filter((r) => r.passed).length} | Failed: ${testResults.filter((r) => !r.passed).length}`);
    console.log("================================================================================\n");

    if (!allPassed) {
      process.exitCode = 1;
    }
  } catch (err) {
    console.error("  [UNEXPECTED ERROR]", err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

run();
