/**
 * End-to-End Browser Verification for:
 * 1. Language notification suppression on initial load (no spurious "Language updated to EN" toast).
 * 2. Translation bar hidden by default on every email.
 * 3. 3-dot menu -> "Translate message" reveals translation bar.
 * 4. Actual email translation works visibly into target language (Spanish, etc.) and restores via "Show original".
 * 5. Mailbox Settings design alignment (uses TopFixedBar, identical sidebar dimensions/style, and main workspace card).
 * 6. Dynamic UI localization across sidebar folders, search bar, and toolbars when language changes in Settings.
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

async function runVerification() {
  console.log('================================================================================');
  console.log('   BYOS: LANGUAGE NOTIFICATION, TRANSLATION & SETTINGS DESIGN VERIFICATION      ');
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

    // Ensure logged in
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
    // VERIFICATION 1: Suppress spurious "Language updated to EN" on initial load
    // ─────────────────────────────────────────────────────────────────────────
    console.log('--- VERIFICATION 1: Check No Spurious Language Toast on Initial Load ---');
    await sleep(1500); // Wait to see if any toast pops up
    const initialToasts = await page.evaluate(() => {
      const toasts = Array.from(document.querySelectorAll('[data-testid="toast-notification"], [role="status"], [role="alert"]'));
      return toasts.map(t => t.textContent.trim()).filter(text => text.toLowerCase().includes('language updated'));
    });
    console.log(`Initial language toasts detected: ${JSON.stringify(initialToasts)}`);
    assert(initialToasts.length === 0, 'No spurious "Language updated to EN" toast on initial load');
    await page.screenshot({ path: path.join(artifactsDir, 'mailbox_no_spurious_notification.png') });
    console.log('Saved screenshot: mailbox_no_spurious_notification.png\n');

    // ─────────────────────────────────────────────────────────────────────────
    // VERIFICATION 2: Translation Bar is HIDDEN by default on email select
    // ─────────────────────────────────────────────────────────────────────────
    console.log('--- VERIFICATION 2: Translation Bar Hidden by Default on Message Open ---');
    const messageRow = await page.waitForSelector('[data-testid="message-row"], [data-testid="thread-row"]', { timeout: 10000 });
    await messageRow.click();
    await sleep(800);

    const readingPane = await page.waitForSelector('[data-testid="reading-pane"]', { timeout: 5000 });
    assert(readingPane !== null, 'Reading pane is visible');

    const translationBarInitially = await page.$('[data-testid="email-translation-bar"]');
    assert(translationBarInitially === null, 'Translation section is NOT shown by default on email open');
    await page.screenshot({ path: path.join(artifactsDir, 'email_translation_hidden_by_default.png') });
    console.log('Saved screenshot: email_translation_hidden_by_default.png\n');

    // ─────────────────────────────────────────────────────────────────────────
    // VERIFICATION 3: Click 3-dot overflow menu -> Click Translate message
    // ─────────────────────────────────────────────────────────────────────────
    console.log('--- VERIFICATION 3: 3-dot Menu Reveals Translation Bar ---');
    const moreBtn = await page.waitForSelector('[data-testid="reading-pane-overflow-btn"], [data-testid="reading-pane-more-btn"]', { timeout: 5000 });
    await moreBtn.click();
    await sleep(300);

    const translateMenuBtn = await page.waitForSelector('[data-testid="reading-pane-translate-menu-btn"]', { timeout: 5000 });
    assert(translateMenuBtn !== null, 'Found "Translate message" in 3-dot overflow menu');
    await translateMenuBtn.click();
    await sleep(400);

    const translationBarOpened = await page.waitForSelector('[data-testid="email-translation-bar"]', { timeout: 5000 });
    assert(translationBarOpened !== null, 'Translation section appears upon clicking "Translate message" from 3-dot menu');

    // ─────────────────────────────────────────────────────────────────────────
    // VERIFICATION 4: Working Translation into Target Language & Restore
    // ─────────────────────────────────────────────────────────────────────────
    console.log('--- VERIFICATION 4: Email Content Translates Visibly ---');
    // Capture original body text before translation
    const originalBodyText = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="reading-pane"] .whitespace-pre-wrap');
      return el ? el.textContent.trim() : '';
    });
    console.log(`Original email body snippet: "${originalBodyText.slice(0, 80)}..."`);

    // Select Spanish target
    await page.select('[data-testid="translation-target-lang"]', 'es');
    await sleep(200);

    const translateActionBtn = await page.waitForSelector('[data-testid="translate-action-btn"]', { timeout: 5000 });
    await translateActionBtn.click();
    await sleep(500);

    const translatedNotice = await page.waitForSelector('[data-testid="translated-notice"]', { timeout: 5000 });
    assert(translatedNotice !== null, 'Translated notice displayed above email content');

    const noticeText = await page.evaluate(() => document.querySelector('[data-testid="translated-notice"]')?.textContent.trim());
    console.log(`Translation notice: "${noticeText}"`);
    assert(noticeText.includes('Spanish') || noticeText.includes('Español') || noticeText.includes('English'), 'Notice displays language translation pair');

    const translatedBodyText = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="reading-pane"] .whitespace-pre-wrap');
      return el ? el.textContent.trim() : '';
    });
    console.log(`Translated email body snippet: "${translatedBodyText.slice(0, 80)}..."`);
    assert(translatedBodyText !== originalBodyText, 'Email body content changed visibly upon translation');
    assert(
      translatedBodyText.includes('clave') ||
      translatedBodyText.includes('tiempo real') ||
      translatedBodyText.includes('nuevo') ||
      translatedBodyText.includes('gracias') ||
      translatedBodyText.includes('usuario'),
      'Translated email body contains expected Spanish translated vocabulary'
    );

    await page.screenshot({ path: path.join(artifactsDir, 'email_translated_spanish.png') });
    console.log('Saved screenshot: email_translated_spanish.png');

    // Click "Show original"
    const showOriginalBtn = await page.waitForSelector('[data-testid="show-original-inline-btn"]', { timeout: 5000 });
    await showOriginalBtn.click();
    await sleep(400);

    const noticeAfterShowOriginal = await page.$('[data-testid="translated-notice"]');
    assert(noticeAfterShowOriginal === null, 'Clicking "Show original" removes translated notice');

    const restoredBodyText = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="reading-pane"] .whitespace-pre-wrap');
      return el ? el.textContent.trim() : '';
    });
    assert(restoredBodyText === originalBodyText, 'Clicking "Show original" completely restores original English text');
    console.log('Translation toggle and restore verified successfully.\n');

    // ─────────────────────────────────────────────────────────────────────────
    // VERIFICATION 5: Mailbox Settings Design Alignment
    // ─────────────────────────────────────────────────────────────────────────
    console.log('--- VERIFICATION 5: Mailbox Settings Design Alignment ---');
    const settingsBtn = await page.waitForSelector('[data-testid="sidebar-settings-btn"]', { timeout: 5000 });
    await settingsBtn.click();
    await sleep(600);

    const settingsLayout = await page.waitForSelector('[data-testid="settings-layout"]', { timeout: 5000 });
    assert(settingsLayout !== null, 'Settings view rendered');

    // Check TopFixedBar in Settings
    const settingsTopBar = await page.waitForSelector('[data-testid="top-fixed-bar"]', { timeout: 5000 });
    assert(settingsTopBar !== null, 'Settings view contains TopFixedBar matching mailbox design');

    const searchInput = await page.$('[data-testid="top-fixed-search-input"]');
    assert(searchInput !== null, 'TopFixedBar contains search input');

    // Check Settings Sidebar
    const settingsSidebar = await page.waitForSelector('[data-testid="settings-sidebar"]', { timeout: 5000 });
    assert(settingsSidebar !== null, 'Settings view contains dedicated sidebar matching mailbox sidebar');

    const backToInboxBtn = await page.waitForSelector('[data-testid="settings-back-to-inbox-btn"]', { timeout: 5000 });
    assert(backToInboxBtn !== null, 'Settings sidebar contains prominent "Back to Inbox" action button');

    // Check tabs in sidebar
    const tabs = ['account', 'security', 'signatures', 'filters', 'autoreply', 'masked-email', 'bridge', 'import'];
    for (const tid of tabs) {
      const tabEl = await page.$(`[data-testid="settings-tab-${tid}"]`);
      assert(tabEl !== null, `Settings sidebar renders category tab: "${tid}"`);
    }

    // Check main workspace card
    const workspaceCard = await page.waitForSelector('[data-testid="settings-main-content"]', { timeout: 5000 });
    assert(workspaceCard !== null, 'Settings view renders rounded main workspace card matching mailbox canvas');

    await page.screenshot({ path: path.join(artifactsDir, 'mailbox_settings_aligned_design.png') });
    console.log('Saved screenshot: mailbox_settings_aligned_design.png\n');

    // ─────────────────────────────────────────────────────────────────────────
    // VERIFICATION 6: Settings Language Selection Updates Webmail UI
    // ─────────────────────────────────────────────────────────────────────────
    console.log('--- VERIFICATION 6: Language Selection Dynamically Localizes UI ---');
    const accountTab = await page.waitForSelector('[data-testid="settings-tab-account"]', { timeout: 5000 });
    await accountTab.click();
    await sleep(400);

    const langSelect = await page.waitForSelector('[data-testid="settings-language-select"]', { timeout: 5000 });
    assert(langSelect !== null, 'Language selector found in Account tab');

    // Switch to Spanish
    console.log('Selecting Spanish (es) in language selector...');
    await page.select('[data-testid="settings-language-select"]', 'es');
    await sleep(800);

    // Verify notification appeared for this explicit switch
    const toastText = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="toast-notification"], [role="status"], [role="alert"]');
      return el ? el.textContent.trim() : '';
    });
    console.log(`Notification text on explicit switch: "${toastText}"`);
    assert(toastText.toLowerCase().includes('idioma') || toastText.toLowerCase().includes('language'), 'Explicit language switch triggers notification');

    // Check Settings Sidebar tab localization
    const accountTabLabel = await page.evaluate(() => document.querySelector('[data-testid="settings-tab-account"]')?.textContent.trim());
    console.log(`Account tab label in Spanish: "${accountTabLabel}"`);
    assert(accountTabLabel.includes('Cuenta'), 'Settings Account tab is localized to "Cuenta"');

    // Check Account tab inner content localization
    const accountInnerHeadings = await page.evaluate(() => {
      const headings = Array.from(document.querySelectorAll('[data-testid="settings-main-content"] h2, [data-testid="settings-main-content"] h3'));
      return headings.map(h => h.textContent.trim());
    });
    console.log(`Account inner headings in Spanish: ${JSON.stringify(accountInnerHeadings)}`);
    assert(accountInnerHeadings.some(h => h.includes('Configuración de la cuenta')), 'Account main title localized to "Configuración de la cuenta"');
    assert(accountInnerHeadings.some(h => h.includes('Información de identidad')), 'Identity section localized to "Información de identidad"');

    // Return to Mailbox
    await backToInboxBtn.click();
    await sleep(600);

    const mainContent = await page.waitForSelector('[data-testid="main-content"]', { timeout: 5000 });
    assert(mainContent !== null, 'Returned to Mailbox');

    // Check localized folder names in Sidebar
    const folderLabels = await page.evaluate(() => {
      return {
        inbox: document.querySelector('[data-testid="folder-inbox"], [data-testid="unified-inbox-button"]')?.textContent.trim(),
        sent: document.querySelector('[data-testid="folder-sent"]')?.textContent.trim(),
        drafts: document.querySelector('[data-testid="folder-drafts"]')?.textContent.trim(),
        trash: document.querySelector('[data-testid="folder-trash"]')?.textContent.trim(),
        searchPlaceholder: document.querySelector('#webmail-search-input')?.getAttribute('placeholder'),
      };
    });

    console.log('Localized Webmail UI elements:', JSON.stringify(folderLabels, null, 2));
    assert(folderLabels.inbox?.includes('Bandeja') || folderLabels.inbox?.includes('Inbox'), 'Inbox folder localized');
    assert(folderLabels.sent?.includes('Enviados'), 'Sent folder localized to "Enviados"');
    assert(folderLabels.drafts?.includes('Borradores'), 'Drafts folder localized to "Borradores"');
    assert(folderLabels.trash?.includes('Papelera'), 'Trash folder localized to "Papelera"');
    assert(folderLabels.searchPlaceholder?.includes('Buscar'), 'TopFixedBar search placeholder localized to "Buscar correos"');

    await page.screenshot({ path: path.join(artifactsDir, 'webmail_ui_localized_spanish.png') });
    console.log('Saved screenshot: webmail_ui_localized_spanish.png\n');

    // Clean up: switch back to English
    console.log('Restoring language to English...');
    const settingsBtnAgain = await page.waitForSelector('[data-testid="sidebar-settings-btn"]', { timeout: 5000 });
    await settingsBtnAgain.click();
    await sleep(500);

    await page.waitForSelector('[data-testid="settings-tab-account"]', { timeout: 5000 });
    await page.click('[data-testid="settings-tab-account"]');
    await sleep(300);

    await page.select('[data-testid="settings-language-select"]', 'en');
    await sleep(500);

    const backBtnAgain = await page.waitForSelector('[data-testid="settings-back-to-inbox-btn"]', { timeout: 5000 });
    await backBtnAgain.click();
    await sleep(500);

    const restoredFolderLabels = await page.evaluate(() => {
      return {
        sent: document.querySelector('[data-testid="folder-sent"]')?.textContent.trim(),
        drafts: document.querySelector('[data-testid="folder-drafts"]')?.textContent.trim(),
        trash: document.querySelector('[data-testid="folder-trash"]')?.textContent.trim(),
      };
    });
    console.log('Restored English Webmail UI elements:', JSON.stringify(restoredFolderLabels, null, 2));
    assert(restoredFolderLabels.sent?.includes('Sent'), 'Sent folder restored to "Sent"');
    assert(restoredFolderLabels.drafts?.includes('Drafts'), 'Drafts folder restored to "Drafts"');
    assert(restoredFolderLabels.trash?.includes('Trash'), 'Trash folder restored to "Trash"');

    console.log('================================================================================');
    console.log('   ALL VERIFICATION CHECKS PASSED: LANGUAGE, TRANSLATION, & SETTINGS DESIGN    ');
    console.log('================================================================================\n');

  } finally {
    await browser.close();
  }
}

runVerification().catch((err) => {
  console.error('\n[FATAL ERROR IN VERIFICATION]:', err);
  process.exit(1);
});
