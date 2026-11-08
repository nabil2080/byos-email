import puppeteer from '../../apps/webmail/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import path from 'node:path';
import fs from 'node:fs';
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

async function runBrowserVerification() {
  console.log("================================================================================");
  console.log("   E2E BROWSER VERIFICATION: SETTINGS, TRANSLATOR, COMPOSE & GMAIL SPLIT LAYOUT   ");
  console.log("================================================================================\n");

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ['--no-sandbox', '--disable-gpu'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  try {
    // ── STEP 0: Log in as Alice via real login flow ──
    console.log("--- [STEP 0] Real login flow: alice@byos.local ---");
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

    await page.waitForSelector('[data-testid="account-chip-selector"]', { timeout: 15000 });
    await sleep(1500);

    const activeUser = await page.$eval('[data-testid="account-chip-text"]', (el) => el.textContent.trim());
    console.log(`  Logged in account: "${activeUser}"`);
    assert(activeUser.includes("alice@byos.local"), "Logged in as alice@byos.local");

    // ── STEP 1: Verify Full Email Translation in Browser Runtime ──
    console.log("\n--- [STEP 1] Full Email Translation Verification ---");
    const translationResult = await page.evaluate(async () => {
      const { translateEmail } = await import('/src/utils/translator.ts');

      const emailParagraph =
        "<p>Hello team, I have attached the meeting notes and presentation for the team to review before tomorrow's call. Let me know if you have any questions or feedback. Best regards, Alice</p>";

      const es = translateEmail(emailParagraph, "en", "es");
      const fr = translateEmail(emailParagraph, "en", "fr");
      const de = translateEmail(emailParagraph, "en", "de");
      const ja = translateEmail(emailParagraph, "en", "ja");

      const corporateEmail =
        "<p>Dear team, please review our company policy and server migration schedule before tomorrow. Urgent action required!</p>";
      const zh = translateEmail(corporateEmail, "en", "zh");
      const ru = translateEmail(corporateEmail, "en", "ru");

      return {
        original: emailParagraph,
        es,
        fr,
        de,
        ja,
        zh,
        ru,
        esHasMeetingNotes: es.includes("notas de la reunión"),
        esHasPresentation: es.includes("presentación"),
        esHasEnglishMeetingNotes: es.includes("meeting notes"),
        esHasEnglishPresentation: es.includes("presentation"),
        jaHasMeetingNotes: ja.includes("会議メモ"),
        jaHasEnglishMeetingNotes: ja.includes("meeting notes"),
        zhHasCompany: zh.includes("公司"),
        zhHasPolicy: zh.includes("政策"),
        zhHasEnglishCompany: zh.includes("company"),
        zhHasEnglishPolicy: zh.includes("policy"),
        zhHasEnglishServer: zh.includes("server"),
      };
    });

    console.log("  Original: ", translationResult.original);
    console.log("  Spanish:  ", translationResult.es);
    console.log("  French:   ", translationResult.fr);
    console.log("  German:   ", translationResult.de);
    console.log("  Japanese: ", translationResult.ja);
    console.log("  Chinese:  ", translationResult.zh);
    console.log("  Russian:  ", translationResult.ru);

    assert(translationResult.esHasMeetingNotes, "Spanish contains translated 'notas de la reunión'");
    assert(translationResult.esHasPresentation, "Spanish contains translated 'presentación'");
    assert(!translationResult.esHasEnglishMeetingNotes, "Spanish does NOT contain untranslated 'meeting notes'");
    assert(!translationResult.esHasEnglishPresentation, "Spanish does NOT contain untranslated 'presentation'");
    assert(translationResult.jaHasMeetingNotes, "Japanese contains translated '会議メモ'");
    assert(!translationResult.jaHasEnglishMeetingNotes, "Japanese does NOT contain untranslated 'meeting notes'");
    assert(translationResult.zhHasCompany, "Chinese contains translated '公司'");
    assert(translationResult.zhHasPolicy, "Chinese contains translated '政策'");
    assert(!translationResult.zhHasEnglishCompany, "Chinese does NOT contain untranslated 'company'");
    assert(!translationResult.zhHasEnglishPolicy, "Chinese does NOT contain untranslated 'policy'");
    assert(!translationResult.zhHasEnglishServer, "Chinese does NOT contain untranslated 'server'");

    // ── STEP 2: Settings Header Cleanup (Module Switcher, Palette & Subheader Banner Removed) ──
    console.log("\n--- [STEP 2] Settings Header Cleanup ---");
    // Open Settings via sidebar gear/settings button
    await page.waitForSelector('[data-testid="sidebar-settings-btn"]', { timeout: 5000 });
    await page.click('[data-testid="sidebar-settings-btn"]');
    await page.waitForSelector('[data-testid="settings-layout"]', { timeout: 5000 });
    await sleep(800);

    // Assert module switcher [Emails] [Calendar] [Notes] does NOT exist in Settings header
    const moduleSwitcherInSettings = await page.$('[data-testid="settings-layout"] [data-testid="top-bar-module-switcher"]');
    assert(moduleSwitcherInSettings === null, "Module switcher is NOT rendered in Settings header (Screenshot 2 section removed)");

    // Assert palette toggle button is NOT rendered in Settings header
    const paletteInSettings = await page.$('[data-testid="settings-layout"] [data-testid="top-bar-appearance-btn"]');
    assert(paletteInSettings === null, "Palette toggle button is NOT rendered in Settings header");

    // Assert Screenshot 3 banner (redundant subheader banner with Account title & Private Mailbox) is NOT rendered
    const subheaderBanner = await page.$('[data-testid="settings-layout"] .h-14.border-b.bg-\\[\\#FAF9F6\\]\\/80');
    assert(subheaderBanner === null, "Settings card header banner is NOT rendered in Settings (Screenshot 3 section removed)");

    const headerCleanedScreenshot = path.join(artifactsDir, 'settings_header_cleaned.png');
    await page.screenshot({ path: headerCleanedScreenshot });
    console.log(`  Saved screenshot: ${headerCleanedScreenshot}`);

    // ── STEP 3: Settings Function Search ──
    console.log("\n--- [STEP 3] Settings Function Search Verification ---");
    const searchInput = await page.$('[data-testid="settings-layout"] #webmail-search-input');
    assert(searchInput !== null, "Settings search input exists");

    const placeholder = await page.evaluate((el) => el.placeholder, searchInput);
    console.log(`  Search input placeholder: "${placeholder}"`);
    assert(placeholder.toLowerCase().includes("settings"), "Search input has settings-specific placeholder");

    // Type "password" to search for password/security settings
    await searchInput.click();
    await searchInput.type("password");
    await sleep(500);

    // Check search results dropdown appeared
    const dropdown = await page.$('[data-testid="settings-search-results-dropdown"]');
    assert(dropdown !== null, "Settings search results dropdown appears when typing query");

    const searchResultSecurity = await page.$('[data-testid="settings-search-result-security"]');
    assert(searchResultSecurity !== null, "Search for 'password' yields Security & Sessions result");

    // Click on the security search result
    await searchResultSecurity.click();
    await sleep(500);

    // Verify active tab switched to security
    const activeTabText = await page.$eval('[data-testid="settings-main-content"]', (el) => el.innerText);
    assert(activeTabText.includes("Security") || activeTabText.includes("Password"), "Navigated to Security tab from search result");

    // Now test search for "theme"
    await searchInput.click();
    await page.keyboard.down('Control');
    await page.keyboard.press('A');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await searchInput.type("theme");
    await sleep(500);

    const searchResultTheme = await page.$('[data-testid="settings-search-result-account"]');
    assert(searchResultTheme !== null, "Search for 'theme' yields Account (Appearance & Theme) result");
    await searchResultTheme.click();
    await sleep(500);

    const themeLightBtn = await page.$('[data-testid="settings-theme-light-btn"]');
    const themeDarkBtn = await page.$('[data-testid="settings-theme-dark-btn"]');
    assert(themeLightBtn !== null && themeDarkBtn !== null, "Theme controls exist in Account settings");

    const searchScreenshot = path.join(artifactsDir, 'settings_search_functional.png');
    await page.screenshot({ path: searchScreenshot });
    console.log(`  Saved screenshot: ${searchScreenshot}`);

    // ── STEP 4: Undo Back to Inbox Button Design ──
    console.log("\n--- [STEP 4] Restored Back to Inbox Button Design ---");
    const backBtn = await page.$('[data-testid="settings-sidebar"] [data-testid="settings-back-to-inbox-btn"]');
    assert(backBtn !== null, "Back to Inbox button exists in Settings sidebar");

    const backBtnClasses = await page.evaluate((el) => el.className, backBtn);
    console.log(`  Back to Inbox button classes: "${backBtnClasses}"`);
    assert(!backBtnClasses.includes("bg-gradient-to-b"), "Back to Inbox button does NOT have oversized gradient");
    assert(backBtnClasses.includes("border"), "Back to Inbox button has restored clean border design");

    const backBtnScreenshot = path.join(artifactsDir, 'back_to_inbox_restored.png');
    await page.screenshot({ path: backBtnScreenshot });
    console.log(`  Saved screenshot: ${backBtnScreenshot}`);

    // ── STEP 5: Editable First & Last Name in Account Tab ──
    console.log("\n--- [STEP 5] Editable First & Last Name in Account Tab ---");
    // Switch to Account tab
    await page.click('[data-testid="settings-tab-account"]');
    await sleep(500);

    const firstNameInput = await page.$('[data-testid="settings-first-name-input"]');
    const lastNameInput = await page.$('[data-testid="settings-last-name-input"]');
    assert(firstNameInput !== null, "First Name input field exists in Account Tab");
    assert(lastNameInput !== null, "Last Name input field exists in Account Tab");

    // Clear and enter new names
    await firstNameInput.click();
    await page.keyboard.down('Control');
    await page.keyboard.press('A');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await firstNameInput.type("Alexander");

    await lastNameInput.click();
    await page.keyboard.down('Control');
    await page.keyboard.press('A');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await lastNameInput.type("Hamilton");
    await sleep(300);

    // Verify effective display name preview reactively shows "Alexander Hamilton"
    const previewName = await page.$eval('[data-testid="settings-display-name-preview"] span', (el) => el.textContent.trim());
    console.log(`  Effective display name preview: "${previewName}"`);
    assert(previewName === "Alexander Hamilton", "Effective display name preview reactively updates to 'Alexander Hamilton'");

    // Click Save Display Name button
    const saveNameBtn = await page.$('[data-testid="settings-save-name-btn"]');
    assert(saveNameBtn !== null, "Save Display Name button exists");
    await saveNameBtn.click();
    await sleep(1500);

    const nameScreenshot = path.join(artifactsDir, 'account_name_editable.png');
    await page.screenshot({ path: nameScreenshot });
    console.log(`  Saved screenshot: ${nameScreenshot}`);

    // ── STEP 6: Remove Duplicate Identity Section from Signatures ──
    console.log("\n--- [STEP 6] Remove Duplicate Identity from Signatures Tab ---");
    await page.click('[data-testid="settings-tab-signatures"]');
    await sleep(500);

    // Verify Tab Title is "Signatures"
    const signaturesHeading = await page.$eval('[data-testid="settings-main-content"] h3', (el) => el.textContent.trim());
    console.log(`  Signatures tab heading: "${signaturesHeading}"`);
    assert(signaturesHeading === "Signatures", "Signatures tab is titled 'Signatures'");

    // Verify Sender Identity card is NOT present
    const senderIdentityCard = await page.$('[data-testid="settings-main-content"] input[placeholder="e.g. Jane Doe"]');
    assert(senderIdentityCard === null, "Sender Identity display name input is NOT in Signatures tab");

    // Verify signature editor exists
    const richEditor = await page.$('[data-testid="settings-main-content"] [contenteditable="true"]');
    assert(richEditor !== null, "WYSIWYG signature editor is present in Signatures tab");

    const signaturesScreenshot = path.join(artifactsDir, 'signatures_tab_clean.png');
    await page.screenshot({ path: signaturesScreenshot });
    console.log(`  Saved screenshot: ${signaturesScreenshot}`);

    // ── STEP 7: Remove 'Sovereign Outbound' Label from Compose ──
    console.log("\n--- [STEP 7] Remove 'Sovereign Outbound' Label from Compose ---");
    // Click Back to Inbox
    await page.click('[data-testid="settings-sidebar"] [data-testid="settings-back-to-inbox-btn"]');
    await sleep(1000);

    // Open Compose drawer
    await page.waitForSelector('[data-testid="sidebar-compose-btn"]', { timeout: 5000 });
    await page.click('[data-testid="sidebar-compose-btn"]');
    await page.waitForSelector('[data-testid="compose-drawer"]', { timeout: 5000 });
    await sleep(600);

    const composeContent = await page.$eval('[data-testid="compose-drawer"]', (el) => el.innerText);
    assert(!composeContent.includes("Sovereign Outbound"), "Compose drawer does NOT contain 'Sovereign Outbound' label");

    const composeScreenshot = path.join(artifactsDir, 'compose_drawer_no_sovereign_label.png');
    await page.screenshot({ path: composeScreenshot });
    console.log(`  Saved screenshot: ${composeScreenshot}`);

    // Close compose drawer
    const closeComposeBtn = await page.$('[data-testid="compose-close-btn"]') || await page.$('[data-testid="compose-minimize-button"]') || await page.$('[data-testid="compose-drawer"] button[aria-label="Close"]');
    if (closeComposeBtn) {
      await closeComposeBtn.click();
      await sleep(300);
    }

    // ── STEP 8: Fixed Email List & Focused Inbox Filters (Gmail Layout Standard) ──
    console.log("\n--- [STEP 8] Fixed Email List & Focused Inbox Filters ---");
    // Ensure focused inbox tabs exist
    const focusedTabs = await page.$('[data-testid="focused-inbox-tabs"]');
    assert(focusedTabs !== null, "Focused inbox category tabs exist");

    // Click on the first message to enter Split view
    await page.waitForSelector('[data-testid="message-row"]', { timeout: 10000 });
    const firstMessageRow = await page.$('[data-testid="message-row"]');
    assert(firstMessageRow !== null, "Message row exists to test split layout");
    await firstMessageRow.click();
    await page.waitForSelector('[data-testid="reading-pane"]', { timeout: 10000 });
    await sleep(1000);

    // Measure message list width in split mode
    const msgListWidth = await page.$eval('[data-testid="message-list"]', (el) => el.parentElement.getBoundingClientRect().width);
    console.log(`  Message list column width in split mode at 1440px: ${msgListWidth}px`);
    assert(msgListWidth >= 380 && msgListWidth <= 420, `Message list width is fixed between 380px and 420px, got ${msgListWidth}px`);

    // Resize viewport down to 1100px (reading pane should shrink, email list stays fixed!)
    await page.setViewport({ width: 1100, height: 900 });
    await sleep(500);

    const resizedMsgListWidth = await page.$eval('[data-testid="message-list"]', (el) => el.parentElement.getBoundingClientRect().width);
    console.log(`  Message list column width after viewport shrink (1100px): ${resizedMsgListWidth}px`);
    assert(resizedMsgListWidth >= 380 && resizedMsgListWidth <= 420, `Message list column did NOT get squished, maintained width: ${resizedMsgListWidth}px`);

    const gmailScreenshot = path.join(artifactsDir, 'gmail_fixed_split_layout.png');
    await page.screenshot({ path: gmailScreenshot });
    console.log(`  Saved screenshot: ${gmailScreenshot}`);

    console.log("\n================================================================================");
    console.log("   ALL 8 USER REQUIREMENTS CONFIRMED AND VERIFIED WITH REAL EVIDENCE!   ");
    console.log("================================================================================\n");

  } finally {
    await browser.close();
  }
}

runBrowserVerification().catch((err) => {
  console.error("FATAL BROWSER TEST ERROR:", err);
  process.exit(1);
});
