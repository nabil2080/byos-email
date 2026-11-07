/**
 * BYOS Webmail Design Refinements & Translation E2E Browser Test Suite
 *
 * Verifies:
 * 1. Sidebar Sent folder suppresses count badge.
 * 2. Focused Inbox tabs render cleanly without duplicate pill/underline glitch, simple counts.
 * 3. Reading Pane header has no sender avatar circle.
 * 4. Gmail-style inline translation bar functions (source/target selector, Translate message, Show original, notice).
 * 5. More actions menu has "Translate message" option.
 * 6. Settings -> Account tab has NO avatar circle / photo upload section, and Language select updates and persists.
 * 7. Settings -> Signatures tab has NO avatar circle / photo section, displays "Identities & Signatures".
 * 8. Captures screenshots to tests/browser/artifacts/webmail_design_refinements_*.png.
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const puppeteer = require('../../apps/webmail/node_modules/puppeteer-core');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const artifactsDir = path.resolve(__dirname, 'artifacts');

if (!fs.existsSync(artifactsDir)) {
  fs.mkdirSync(artifactsDir, { recursive: true });
}

function assert(condition, message) {
  if (!condition) {
    console.error(`  [FAIL] ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  [PASS] ${message}`);
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTest() {
  console.log('================================================================================');
  console.log('   BYOS WEBMAIL: DESIGN CONSISTENCY & TRANSLATION BROWSER VERIFICATION          ');
  console.log('================================================================================\n');

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1280,850',
    ],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 850 });

    const webmailUrl = 'http://127.0.0.1:3001';
    console.log(`Navigating to ${webmailUrl}...`);
    await page.goto(`${webmailUrl}/`, { waitUntil: 'networkidle2', timeout: 25000 });

    // Step 0: Check authentication
    const emailInput = await page.$('input[type="email"]');
    if (emailInput) {
      console.log('Authenticating as alice@byos.local...');
      await page.type('input[type="email"]', 'alice@byos.local');
      await page.type('input[type="password"]', 'test-password-123');
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {}),
        page.click('button[type="submit"]'),
      ]);
      await sleep(2500);
    }

    await page.waitForSelector('[data-testid="main-content"]', { timeout: 15000 });
    console.log('Webmail desktop shell loaded successfully.\n');

    // ─────────────────────────────────────────────────────────────────────────
    // CHECK 1: Sent folder suppresses count badge in Sidebar
    // ─────────────────────────────────────────────────────────────────────────
    console.log('--- CHECK 1: Sent folder suppresses count badge in Sidebar ---');
    const sentButton = await page.waitForSelector('[data-testid="folder-sent"]', { timeout: 5000 });
    assert(sentButton !== null, 'Sidebar contains Sent folder button');

    const sentHasBadge = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="folder-sent"]');
      if (!btn) return false;
      const badge = btn.querySelector('span.font-mono.tabular-nums');
      return badge !== null;
    });
    assert(!sentHasBadge, 'Sent folder button does NOT render count badge (count suppressed)');

    // Verify other folder (e.g. Inbox or drafts) CAN have badge if messages exist
    const inboxHasBadge = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="folder-inbox"], [data-testid="unified-inbox-button"]');
      if (!btn) return false;
      const badge = btn.querySelector('span.font-mono.tabular-nums');
      return badge !== null;
    });
    console.log(`Inbox folder badge presence: ${inboxHasBadge}`);

    await page.screenshot({ path: path.join(artifactsDir, 'webmail_design_refinements_sidebar.png') });
    console.log('Saved screenshot: webmail_design_refinements_sidebar.png\n');

    // ─────────────────────────────────────────────────────────────────────────
    // CHECK 2: Focused Inbox tabs clean styling & message counts
    // ─────────────────────────────────────────────────────────────────────────
    console.log('--- CHECK 2: Focused Inbox tabs clean styling ---');
    const tabsContainer = await page.waitForSelector('[data-testid="focused-inbox-tabs"]', { timeout: 5000 });
    assert(tabsContainer !== null, 'Focused Inbox tabs container is present');

    const tabsEvaluation = await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('[data-testid^="category-tab-"]'));
      const underlineDiv = document.querySelector('[data-testid="focused-inbox-underline"]');
      const pillDiv = document.querySelector('[data-testid="focused-inbox-pill"]');
      return {
        tabCount: tabs.length,
        hasUnderlineDiv: underlineDiv !== null,
        hasPillDiv: pillDiv !== null,
        tabLabels: tabs.map(t => t.textContent.trim()),
      };
    });

    console.log(`Focused tabs found: ${tabsEvaluation.tabCount} (${tabsEvaluation.tabLabels.join(' | ')})`);
    assert(tabsEvaluation.tabCount >= 2, 'At least 2 Focused Inbox tabs rendered');
    assert(!tabsEvaluation.hasUnderlineDiv, 'Conflicting sliding underline indicator div removed');
    assert(!tabsEvaluation.hasPillDiv, 'Conflicting sliding pill div removed');

    // Test tab switching
    const newslettersTab = await page.waitForSelector('[data-testid="category-tab-newsletters"]', { timeout: 5000 });
    assert(newslettersTab !== null, 'Newsletters category tab exists');
    await newslettersTab.click();
    await sleep(400);

    const isNewslettersActive = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="category-tab-newsletters"]');
      return btn?.getAttribute('aria-selected') === 'true' &&
        (btn?.className.includes('bg-[#F2E8E2]') || btn?.className.includes('dark:bg-[#2D2522]'));
    });
    assert(isNewslettersActive, 'Newsletters tab activates with clean warm background and aria-selected=true');

    // Manage subscriptions button should appear in newsletters category
    const manageSubsBtn = await page.$('[data-testid="manage-subscriptions-btn"]');
    assert(manageSubsBtn !== null, 'Manage Subscriptions shortcut button renders when Newsletters tab is selected');

    // Test switching to Social
    const socialTab = await page.waitForSelector('[data-testid="category-tab-social"]', { timeout: 5000 });
    await socialTab.click();
    await sleep(400);

    const isSocialActive = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="category-tab-social"]');
      return btn?.getAttribute('aria-selected') === 'true' &&
        (btn?.className.includes('bg-[#F2E8E2]') || btn?.className.includes('dark:bg-[#2D2522]'));
    });
    assert(isSocialActive, 'Social tab activates cleanly with aria-selected=true');

    // Switch back to Primary
    const primaryTab = await page.waitForSelector('[data-testid="category-tab-primary"]', { timeout: 5000 });
    await primaryTab.click();
    await sleep(400);
    const isPrimaryActive = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="category-tab-primary"]');
      return btn?.getAttribute('aria-selected') === 'true';
    });
    assert(isPrimaryActive, 'Successfully switched back to Primary category');

    await page.screenshot({ path: path.join(artifactsDir, 'webmail_design_refinements_focused_tabs.png') });
    console.log('Saved screenshot: webmail_design_refinements_focused_tabs.png\n');

    // ─────────────────────────────────────────────────────────────────────────
    // CHECK 3: Reading Pane Header Avatar Circle Removed
    // ─────────────────────────────────────────────────────────────────────────
    console.log('--- CHECK 3: Reading Pane Header Avatar Circle Removed ---');
    // Select first message to open reading pane
    const messageRow = await page.waitForSelector('[data-testid="message-row"], [data-testid="thread-row"]', { timeout: 12000 });
    assert(messageRow !== null, 'Found message in message list');
    await messageRow.click();
    await sleep(800);

    const readingPane = await page.waitForSelector('[data-testid="reading-pane"]', { timeout: 5000 });
    assert(readingPane !== null, 'Reading pane displayed');

    const readingPaneAvatarCheck = await page.evaluate(() => {
      const header = document.querySelector('[data-testid="reading-pane"] header') ||
                     document.querySelector('[data-testid="reading-pane"]');
      const avatarCircle = header?.querySelector('[data-testid="reading-pane-avatar"]');
      const profileAvatar = header?.querySelector('[data-testid="profile-avatar"]');
      const senderText = header?.querySelector('.font-semibold, .font-medium');
      return {
        hasAvatarCircle: avatarCircle !== null,
        hasProfileAvatar: profileAvatar !== null,
        senderText: senderText ? senderText.textContent.trim() : null,
      };
    });

    console.log(`Reading pane sender: ${readingPaneAvatarCheck.senderText}`);
    assert(!readingPaneAvatarCheck.hasAvatarCircle, 'Reading Pane header does NOT contain avatar circle');
    assert(!readingPaneAvatarCheck.hasProfileAvatar, 'ProfileAvatar component is absent from Reading Pane header');

    // ─────────────────────────────────────────────────────────────────────────
    // CHECK 4: Gmail-style Inline Translation Bar & Controls
    // ─────────────────────────────────────────────────────────────────────────
    console.log('--- CHECK 4: Gmail-style Inline Translation Bar ---');

    // If translation bar is not auto-opened, open it via More Actions menu
    let translationBar = await page.$('[data-testid="email-translation-bar"]');
    if (!translationBar) {
      console.log('Opening translation bar from More Actions menu...');
      const moreBtn = await page.waitForSelector('[data-testid="reading-pane-overflow-btn"], [data-testid="reading-pane-more-btn"]', { timeout: 5000 });
      await moreBtn.click();
      await sleep(300);

      const translateMenuBtn = await page.waitForSelector('[data-testid="reading-pane-translate-menu-btn"]', { timeout: 5000 });
      assert(translateMenuBtn !== null, 'More Actions menu contains "Translate message" option');
      await translateMenuBtn.click();
      await sleep(400);

      translationBar = await page.waitForSelector('[data-testid="email-translation-bar"]', { timeout: 5000 });
    }
    assert(translationBar !== null, 'Inline email translation bar is visible');

    // Check selectors inside translation bar
    const sourceSelect = await page.$('[data-testid="translation-source-lang"]');
    assert(sourceSelect !== null, 'Source language dropdown is present');
    const targetSelect = await page.$('[data-testid="translation-target-lang"]');
    assert(targetSelect !== null, 'Target language dropdown is present');
    const translateActionBtn = await page.$('[data-testid="translate-action-btn"]');
    assert(translateActionBtn !== null, 'Translate action button is present');

    // Select target language = "es" (Spanish)
    await page.select('[data-testid="translation-target-lang"]', 'es');
    await sleep(200);

    // Test "Always translate" toggle
    const alwaysCheckbox = await page.$('[data-testid="always-translate-checkbox"]');
    if (alwaysCheckbox) {
      await alwaysCheckbox.click();
      await sleep(200);
      const isAlwaysChecked = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="always-translate-checkbox"]');
        return el ? el.checked : false;
      });
      assert(isAlwaysChecked, 'Always translate checkbox toggled on');
      await alwaysCheckbox.click();
      await sleep(200);
    }

    // Click Translate message
    await translateActionBtn.click();
    await sleep(400);

    // Verify translation notice appears
    const translatedNotice = await page.waitForSelector('[data-testid="translated-notice"]', { timeout: 5000 });
    assert(translatedNotice !== null, 'Active translation notice appears in message body');

    const noticeText = await page.evaluate(() => {
      return document.querySelector('[data-testid="translated-notice"]')?.textContent.trim();
    });
    console.log(`Translation notice text: "${noticeText}"`);
    assert(noticeText.includes('Translated to Español') || noticeText.includes('Translated from'), 'Notice states translation direction');

    // Check "Show original" button
    const showOriginalBtn = await page.$('[data-testid="show-original-inline-btn"]');
    assert(showOriginalBtn !== null, '"Show original" inline link is present in translation notice');

    await page.screenshot({ path: path.join(artifactsDir, 'webmail_design_refinements_reading_pane_translation.png') });
    console.log('Saved screenshot: webmail_design_refinements_reading_pane_translation.png');

    // Click "Show original"
    await showOriginalBtn.click();
    await sleep(300);

    const noticeAfterOriginal = await page.$('[data-testid="translated-notice"]');
    assert(noticeAfterOriginal === null, 'Clicking "Show original" restores original message state');

    // Test secondary translation target language (French)
    await page.select('[data-testid="translation-target-lang"]', 'fr');
    await sleep(200);
    await translateActionBtn.click();
    await sleep(400);
    const noticeFr = await page.$('[data-testid="translated-notice"]');
    assert(noticeFr !== null, 'Translation to French displays active translation notice');
    const showOriginalBtnFr = await page.waitForSelector('[data-testid="show-original-inline-btn"]', { timeout: 3000 });
    await showOriginalBtnFr.click();
    await sleep(300);
    console.log('Translation toggle roundtrip confirmed.\n');

    // ─────────────────────────────────────────────────────────────────────────
    // CHECK 5: Mailbox Settings - Account Tab & Language Selection
    // ─────────────────────────────────────────────────────────────────────────
    console.log('--- CHECK 5: Mailbox Settings - Account Tab & Language Selection ---');
    const settingsBtn = await page.waitForSelector('[data-testid="sidebar-settings-btn"]', { timeout: 5000 });
    await settingsBtn.click();
    await sleep(600);

    const settingsLayout = await page.waitForSelector('[data-testid="settings-layout"]', { timeout: 5000 });
    assert(settingsLayout !== null, 'Settings layout opened');

    // Click Account Tab
    const accountTabBtn = await page.waitForSelector('[data-testid="settings-tab-account"]', { timeout: 5000 });
    await accountTabBtn.click();
    await sleep(500);

    // Assert NO avatar circle / photo section exists in Account Tab
    const accountAvatarCheck = await page.evaluate(() => {
      const avatarPreview = document.querySelector('[data-testid="settings-avatar-preview"]');
      const photoUpload = document.querySelector('#avatar-upload, input[type="file"][accept*="image"]');
      const photoSection = document.querySelector('[data-testid="profile-photo-section"]');
      return {
        hasAvatarPreview: avatarPreview !== null,
        hasPhotoUpload: photoUpload !== null,
        hasPhotoSection: photoSection !== null,
      };
    });
    assert(!accountAvatarCheck.hasAvatarPreview, 'Account tab has NO avatar circle preview');
    assert(!accountAvatarCheck.hasPhotoUpload, 'Account tab has NO photo upload input');
    assert(!accountAvatarCheck.hasPhotoSection, 'Account tab has NO profile photo section');

    // Assert Language Select exists
    const langSelect = await page.waitForSelector('[data-testid="settings-language-select"]', { timeout: 5000 });
    assert(langSelect !== null, 'Language selector is present in Account settings');

    // Test changing language to Spanish "es"
    await page.select('[data-testid="settings-language-select"]', 'es');
    await sleep(600);

    // Assert persistence in localStorage and document.documentElement.lang
    const langPersistence = await page.evaluate(() => {
      return {
        storageVal: localStorage.getItem('byos_language'),
        docLang: document.documentElement.lang,
      };
    });
    console.log(`Language set in localStorage: "${langPersistence.storageVal}", html lang: "${langPersistence.docLang}"`);
    assert(langPersistence.storageVal === 'es', 'Language is stored in localStorage as "es"');
    assert(langPersistence.docLang === 'es', 'document.documentElement.lang updated to "es"');

    await page.screenshot({ path: path.join(artifactsDir, 'webmail_design_refinements_settings_account.png') });
    console.log('Saved screenshot: webmail_design_refinements_settings_account.png');

    // Restore language to English
    await page.select('[data-testid="settings-language-select"]', 'en');
    await sleep(400);
    const restoredLang = await page.evaluate(() => localStorage.getItem('byos_language'));
    assert(restoredLang === 'en', 'Restored language setting to "en"');
    console.log('Language persistence and reactivity confirmed.\n');

    // ─────────────────────────────────────────────────────────────────────────
    // CHECK 6: Mailbox Settings - Signatures Tab (No Avatar, Identities & Signatures)
    // ─────────────────────────────────────────────────────────────────────────
    console.log('--- CHECK 6: Mailbox Settings - Signatures Tab ---');
    const signaturesTabBtn = await page.waitForSelector('[data-testid="settings-tab-signatures"]', { timeout: 5000 });
    await signaturesTabBtn.click();
    await sleep(600);

    const signaturesCheck = await page.evaluate(() => {
      const heading = document.querySelector('h3')?.textContent.trim();
      const photoCard = document.querySelector('[data-testid="profile-photo-card"]');
      const avatarCircle = document.querySelector('[data-testid="signatures-avatar-preview"], [data-testid="profile-avatar"]');
      const editor = document.querySelector('.rich-text-editor, [contenteditable="true"]');
      return {
        heading,
        hasPhotoCard: photoCard !== null,
        hasAvatarCircle: avatarCircle !== null,
        hasEditor: editor !== null,
      };
    });

    console.log(`Signatures tab heading: "${signaturesCheck.heading}"`);
    assert(signaturesCheck.heading.includes('Identities & Signatures'), 'Signatures tab is titled "Identities & Signatures"');
    assert(!signaturesCheck.hasPhotoCard, 'Signatures tab has NO profile photo card');
    assert(!signaturesCheck.hasAvatarCircle, 'Signatures tab has NO avatar circle');
    assert(signaturesCheck.hasEditor, 'Signatures tab contains RichTextEditor');

    await page.screenshot({ path: path.join(artifactsDir, 'webmail_design_refinements_settings_signatures.png') });
    console.log('Saved screenshot: webmail_design_refinements_settings_signatures.png\n');

    // Return to Inbox
    const backBtn = await page.waitForSelector('[data-testid="settings-back-to-inbox-btn"]', { timeout: 5000 });
    await backBtn.click();
    await sleep(500);

    const backToMain = await page.$('[data-testid="main-content"]');
    assert(backToMain !== null, 'Successfully returned back to Inbox');

    console.log('================================================================================');
    console.log('   ALL WEBMAIL DESIGN CONSISTENCY & TRANSLATION CHECKS PASSED SUCCESSFULLY      ');
    console.log('================================================================================\n');

  } finally {
    await browser.close();
  }
}

runTest().catch((err) => {
  console.error('\n[FATAL ERROR IN TEST EXECUTION]:', err);
  process.exit(1);
});
