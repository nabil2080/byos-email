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

async function runContactsBrowserTests() {
  console.log("================================================================================");
  console.log("             CONTACT MANAGEMENT POLISH (V1) BROWSER TEST                        ");
  console.log("================================================================================\n");

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ['--no-sandbox', '--disable-gpu'],
  });

  const unhandledErrors = [];

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (
          !text.includes('/v1/auth/me') &&
          !text.includes('favicon') &&
          !text.includes('401 (Unauthorized)') &&
          !text.includes('Failed to load resource') &&
          !text.includes('net::ERR_INTERNET_DISCONNECTED') &&
          !text.includes('failed to connect to websocket')
        ) {
          unhandledErrors.push(text);
          console.error(`  [CONSOLE ERROR] ${text}`);
        }
      }
    });

    // =========================================================================
    // STEP 1: Real login flow as Alice
    // =========================================================================
    console.log("--- [STEP 1] Real login flow as Alice (alice@byos.local) ---");
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
    await sleep(1000);

    const activeUser = await page.$eval('[data-testid="account-chip-text"]', (el) => el.textContent.trim());
    console.log(`  Active account: "${activeUser}"`);
    assert(activeUser.includes('alice@byos.local'), "Alice logged in successfully via real credentials");

    // =========================================================================
    // STEP 2: Open Contacts Modal & Take Initial Screenshot
    // =========================================================================
    console.log("\n--- [STEP 2] Open Contacts Modal ---");
    const contactsBtn = await page.waitForSelector('[data-testid="contacts-nav-btn"]', { timeout: 5000 });
    await contactsBtn.click();
    await page.waitForSelector('[data-testid="contacts-modal"]', { timeout: 5000 });
    await sleep(500);

    const listScreenshotPath = path.resolve(artifactsDir, 'contacts_list.png');
    await page.screenshot({ path: listScreenshotPath });
    console.log(`  Screenshot saved: tests/browser/artifacts/contacts_list.png`);
    assert(fs.existsSync(listScreenshotPath), "Contacts modal opened and contacts_list.png screenshot saved");

    // =========================================================================
    // STEP 3: Create Contact: Test Person
    // =========================================================================
    console.log("\n--- [STEP 3] Create Contact 'Test Person' ---");
    await page.click('[data-testid="contacts-new-btn"]');
    await page.waitForSelector('[data-testid="contact-form-name"]', { timeout: 5000 });

    await page.type('[data-testid="contact-form-name"]', 'Test Person');
    await page.type('[data-testid="contact-form-email"]', 'test.person@example.com');
    await page.type('[data-testid="contact-form-group"]', 'Test');
    await page.type('[data-testid="contact-form-notes"]', 'Automated test contact');

    const createScreenshotPath = path.resolve(artifactsDir, 'contacts_create.png');
    await page.screenshot({ path: createScreenshotPath });
    console.log(`  Screenshot saved: tests/browser/artifacts/contacts_create.png`);
    assert(fs.existsSync(createScreenshotPath), "Contact creation form filled and contacts_create.png saved");

    await page.click('[data-testid="contact-save-btn"]');
    await sleep(1000);

    // =========================================================================
    // STEP 4: Confirm Contact Appears in List & Detail View
    // =========================================================================
    console.log("\n--- [STEP 4] Confirm Contact Appears in List & Detail ---");
    await page.waitForSelector('[data-testid="contact-row"][data-email="test.person@example.com"]', { timeout: 5000 });
    const detailName = await page.$eval('[data-testid="contact-detail-name"]', (el) => el.textContent.trim());
    const detailEmail = await page.$eval('[data-testid="contact-detail-email"]', (el) => el.textContent.trim());
    const detailNotes = await page.$eval('[data-testid="contact-detail-notes"]', (el) => el.textContent.trim());

    assert(detailName === 'Test Person', `Contact detail displays correct name: '${detailName}'`);
    assert(detailEmail === 'test.person@example.com', `Contact detail displays correct email: '${detailEmail}'`);
    assert(detailNotes === 'Automated test contact', `Contact detail displays correct notes: '${detailNotes}'`);

    // =========================================================================
    // STEP 5: Search 'Test', Confirm Only Matching Contact Appears
    // =========================================================================
    console.log("\n--- [STEP 5] Search Contacts for 'Test' ---");
    await page.type('[data-testid="contacts-search-input"]', 'Test');
    await sleep(400); // debounce

    const searchMatchCount = await page.$$eval('[data-testid="contact-row"]', (rows) => rows.length);
    assert(searchMatchCount >= 1, `Search query 'Test' matches created contact (found ${searchMatchCount})`);

    const matchedEmail = await page.$eval('[data-testid="contact-row"]', (el) => el.getAttribute('data-email'));
    assert(matchedEmail === 'test.person@example.com', "Matching contact row email matches search query");

    // Clear search input
    await page.evaluate(() => {
      const input = document.querySelector('[data-testid="contacts-search-input"]');
      if (input) {
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await sleep(400);

    // =========================================================================
    // STEP 6: Edit Contact Name to 'Test Person Edited'
    // =========================================================================
    console.log("\n--- [STEP 6] Edit Contact Name ---");
    await page.click('[data-testid="contact-edit-btn"]');
    await page.waitForSelector('[data-testid="contact-form-name"]', { timeout: 5000 });

    // Clear and replace name
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="contact-form-name"]');
      if (el) {
        el.value = '';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await page.type('[data-testid="contact-form-name"]', 'Test Person Edited');
    await page.click('[data-testid="contact-save-btn"]');
    await sleep(1000);

    const editedName = await page.$eval('[data-testid="contact-detail-name"]', (el) => el.textContent.trim());
    assert(editedName === 'Test Person Edited', `Edited contact name matches: '${editedName}'`);

    // =========================================================================
    // STEP 7: Delete Contact with Confirmation Dialog
    // =========================================================================
    console.log("\n--- [STEP 7] Delete Contact with Confirmation Dialog ---");
    await page.click('[data-testid="contact-delete-btn"]');
    await page.waitForSelector('[data-testid="delete-confirmation-dialog"]', { timeout: 5000 });
    assert(true, "Delete confirmation modal appears");

    await page.click('[data-testid="confirm-delete-btn"]');
    await sleep(1000);

    const existsAfterDelete = await page.evaluate(() => {
      return Boolean(document.querySelector('[data-testid="contact-row"][data-email="test.person@example.com"]'));
    });
    assert(!existsAfterDelete, "Deleted contact no longer appears in contact list");

    // =========================================================================
    // STEP 8: Import CSV with 3 Rows
    // =========================================================================
    console.log("\n--- [STEP 8] Import CSV with 3 Rows ---");
    const csvFixturePath = path.resolve(artifactsDir, 'test_contacts_import.csv');
    const csvContent = [
      'Name,Email,Group,Notes',
      'Imported One,one@imported.local,Team,First imported',
      'Imported Two,two@imported.local,Team,Second imported',
      'Imported Three,three@imported.local,Clients,Third imported',
    ].join('\n') + '\n';
    fs.writeFileSync(csvFixturePath, csvContent, 'utf8');

    const fileInput = await page.waitForSelector('input[data-testid="contacts-import-file-input"]', { timeout: 5000 });
    await fileInput.uploadFile(csvFixturePath);
    await sleep(1500);

    // Wait for the imported contacts to appear in the list
    await page.waitForSelector('[data-testid="contact-row"][data-email="one@imported.local"]', { timeout: 10000 });
    await page.waitForSelector('[data-testid="contact-row"][data-email="two@imported.local"]', { timeout: 5000 });
    await page.waitForSelector('[data-testid="contact-row"][data-email="three@imported.local"]', { timeout: 5000 });

    const importScreenshotPath = path.resolve(artifactsDir, 'contacts_import.png');
    await page.screenshot({ path: importScreenshotPath });
    console.log(`  Screenshot saved: tests/browser/artifacts/contacts_import.png`);
    assert(fs.existsSync(importScreenshotPath), "CSV imported successfully and contacts_import.png saved");

    // =========================================================================
    // STEP 9: Export CSV & Verify Response Contains the 3 Imported Contacts
    // =========================================================================
    console.log("\n--- [STEP 9] Export CSV & Verify Response Content ---");
    const exportResult = await page.evaluate(async () => {
      const accounts = JSON.parse(sessionStorage.getItem('byos_connected_accounts') || '[]');
      const activeToken = sessionStorage.getItem('byos_active_session_token') || (accounts[0] && accounts[0].sessionToken);
      const mailboxId = accounts[0]?.id;
      if (!mailboxId) {
        throw new Error("No active mailboxId found in sessionStorage");
      }
      const res = await fetch(`/v1/mailboxes/${mailboxId}/contacts/export?format=csv`, {
        headers: { Authorization: `Bearer ${activeToken}` },
      });
      return {
        ok: res.ok,
        status: res.status,
        contentType: res.headers.get("content-type"),
        text: await res.text(),
      };
    });

    assert(exportResult.ok, `Contacts export returned HTTP 200 (got ${exportResult.status})`);
    assert(exportResult.text.includes('one@imported.local'), "Exported CSV contains one@imported.local");
    assert(exportResult.text.includes('two@imported.local'), "Exported CSV contains two@imported.local");
    assert(exportResult.text.includes('three@imported.local'), "Exported CSV contains three@imported.local");

    // Close contacts modal
    await page.click('[data-testid="contacts-close-btn"]');
    await sleep(500);

    // =========================================================================
    // STEP 10: Open Compose Modal, Type 'one' in To: Input
    // =========================================================================
    console.log("\n--- [STEP 10] Open Compose Modal & Type 'one' ---");
    await page.click('[data-testid="sidebar-compose-btn"]');
    await page.waitForSelector('#composeToInput', { timeout: 5000 });

    await page.type('#composeToInput', 'one');
    await sleep(400); // 150ms debounce

    // =========================================================================
    // STEP 11: Confirm Autocomplete Dropdown Shows 'Imported One'
    // =========================================================================
    console.log("\n--- [STEP 11] Confirm Autocomplete Dropdown Shows 'Imported One' ---");
    await page.waitForSelector('[data-testid="autocomplete-dropdown"]', { timeout: 5000 });

    const autocompleteScreenshotPath = path.resolve(artifactsDir, 'compose_autocomplete.png');
    await page.screenshot({ path: autocompleteScreenshotPath });
    console.log(`  Screenshot saved: tests/browser/artifacts/compose_autocomplete.png`);
    assert(fs.existsSync(autocompleteScreenshotPath), "Autocomplete dropdown displayed and screenshot saved");

    const optionText = await page.$eval('[data-testid="autocomplete-item"]', (el) => el.textContent);
    assert(optionText.includes('Imported One'), "Dropdown contains contact name 'Imported One'");
    assert(optionText.includes('one@imported.local'), "Dropdown contains contact email 'one@imported.local'");

    // =========================================================================
    // STEP 12: Select via Keyboard / Enter, Confirm Chip Appears with Avatar
    // =========================================================================
    console.log("\n--- [STEP 12] Select Autocomplete via Enter ---");
    await page.keyboard.press('Enter');
    await sleep(300);

    await page.waitForSelector('[data-testid="recipient-chip"][data-email="one@imported.local"]', { timeout: 5000 });
    const chip1Name = await page.$eval(
      '[data-testid="recipient-chip"][data-email="one@imported.local"] [data-testid="chip-label"]',
      (el) => el.textContent.trim()
    );
    const chip1Avatar = await page.$eval(
      '[data-testid="recipient-chip"][data-email="one@imported.local"] [data-testid="chip-avatar"]',
      (el) => el.textContent.trim()
    );
    assert(chip1Name === 'Imported One', `Chip 1 display name is 'Imported One' (got: ${chip1Name})`);
    assert(chip1Avatar === 'I', `Chip 1 avatar initial is 'I' (got: ${chip1Avatar})`);

    // =========================================================================
    // STEP 13: Add Second Recipient via Autocomplete: 'Imported Two'
    // =========================================================================
    console.log("\n--- [STEP 13] Add Second Recipient via Autocomplete: 'Imported Two' ---");
    await page.type('#composeToInput', 'two');
    await sleep(400); // 150ms debounce
    await page.waitForSelector('[data-testid="autocomplete-dropdown"]', { timeout: 5000 });
    await page.keyboard.press('Enter');
    await sleep(300);

    await page.waitForSelector('[data-testid="recipient-chip"][data-email="two@imported.local"]', { timeout: 5000 });
    const chip2Name = await page.$eval(
      '[data-testid="recipient-chip"][data-email="two@imported.local"] [data-testid="chip-label"]',
      (el) => el.textContent.trim()
    );
    assert(chip2Name === 'Imported Two', `Chip 2 display name is 'Imported Two' (got: ${chip2Name})`);

    // =========================================================================
    // STEP 14: Type Raw Email 'external@example.com' and Press Enter
    // =========================================================================
    console.log("\n--- [STEP 14] Type Raw Email 'external@example.com' (Plain Chip) ---");
    await page.type('#composeToInput', 'external@example.com');
    await page.keyboard.press('Enter');
    await sleep(300);

    await page.waitForSelector('[data-testid="recipient-chip"][data-email="external@example.com"]', { timeout: 5000 });
    const chip3Name = await page.$eval(
      '[data-testid="recipient-chip"][data-email="external@example.com"] [data-testid="chip-label"]',
      (el) => el.textContent.trim()
    );
    const chip3HasAvatar = await page.evaluate(() => {
      const chip = document.querySelector('[data-testid="recipient-chip"][data-email="external@example.com"]');
      return Boolean(chip?.querySelector('[data-testid="chip-avatar"]'));
    });
    assert(chip3Name === 'external@example.com', `Plain chip display text is 'external@example.com'`);
    assert(!chip3HasAvatar, "Plain chip for raw email has no avatar circle");

    // =========================================================================
    // STEP 15: Send Message, Confirm Sends Successfully
    // =========================================================================
    console.log("\n--- [STEP 15] Send Message with Recipient Chips ---");
    await page.type('#composeSubjectInput', 'Contact Management Autocomplete Verification');
    await page.click('[data-testid="compose-body-input"]');
    await page.type('[data-testid="compose-body-input"]', 'Hello all recipients!');
    await sleep(300);

    await page.click('[data-testid="compose-send-btn"]');
    await sleep(1000);

    // Verify compose drawer closed and send toast / undo appeared
    const composeOpen = await page.evaluate(() => {
      return Boolean(document.querySelector('[data-testid="compose-body-input"]'));
    });
    assert(!composeOpen, "Compose drawer closed after message dispatch");

    // =========================================================================
    // STEP 16: Assert No Console Errors Throughout
    // =========================================================================
    console.log("\n--- [STEP 16] Verify Zero Console Errors ---");
    assert(unhandledErrors.length === 0, `Zero console errors throughout (found: ${unhandledErrors.length})`);

    console.log("\n================================================================================");
    console.log("            ALL 16 CONTACT MANAGEMENT BROWSER CHECKS PASSED                     ");
    console.log("================================================================================");
  } finally {
    await browser.close();
  }
}

runContactsBrowserTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error("\nTEST SUITE FAILED WITH ERROR:", err);
    process.exit(1);
  });
