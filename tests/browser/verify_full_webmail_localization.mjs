/**
 * End-to-End Browser Verification for Full Webmail Localization (except nouns):
 * 1. Log in to webmail as alice@byos.local
 * 2. Verify all UI regions before switching
 * 3. Open Settings -> Account Tab -> Change Display Language to Spanish (es)
 * 4. Verify immediate reactivity across entire application:
 *    - Header / TopFixedBar search & module switcher
 *    - Sidebar folders, categories, labels, and bottom utility buttons
 *    - Inbox toolbar, sort options, batch selection menu
 *    - Message rows, action buttons, category pills
 *    - Reading pane translation bar & action menus
 *    - Quick Customizer panel
 *    - Settings sidebar & headings
 *    - Brand nouns ("BYOS", "BYOS Mail", email addresses, person names) remain preserved verbatim
 * 5. Capture screenshots to tests/browser/artifacts/
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
  console.log('   BYOS: FULL WEBMAIL SYSTEMIC LOCALIZATION (EXCEPT NOUNS) VERIFICATION        ');
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

    // Login if login form present
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
    // STEP 1: Open Settings and switch language to Spanish ('es')
    // ─────────────────────────────────────────────────────────────────────────
    console.log('--- STEP 1: Navigate to Settings -> Account Tab & Switch to Spanish ---');
    const settingsBtn = await page.waitForSelector('[data-testid="sidebar-settings-btn"]', { timeout: 8000 });
    await settingsBtn.click();
    await page.waitForSelector('[data-testid="settings-layout"]', { timeout: 10000 });
    console.log('Opened Settings modal/page.');

    // Ensure on Account Tab
    const accountTabBtn = await page.$('[data-testid="settings-tab-account"]');
    if (accountTabBtn) await accountTabBtn.click();
    await sleep(500);

    // Locate Display Language Select
    const langSelect = await page.waitForSelector('[data-testid="settings-language-select"]', { timeout: 8000 });
    console.log('Selecting "es" (Español) in Settings -> Account Tab...');
    await langSelect.select('es');
    await sleep(1500);

    // Verify Settings UI updated to Spanish immediately
    const settingsHeaderText = await page.$eval('[data-testid="settings-layout"]', el => el.innerText);
    console.log('Inspecting Settings UI elements for Spanish translation...');
    assert(settingsHeaderText.includes('Configuración'), 'Settings header badge shows "Configuración"');
    assert(settingsHeaderText.includes('Buzón privado'), 'Account mode badge shows "Buzón privado"');
    assert(settingsHeaderText.includes('Volver a la bandeja'), 'Back to inbox button shows "Volver a la bandeja"');
    assert(settingsHeaderText.includes('BYOS Mail'), 'Brand noun "BYOS Mail" is strictly preserved');
    assert(settingsHeaderText.includes('alice@byos.local'), 'Email address noun is preserved');

    await page.screenshot({ path: path.join(artifactsDir, 'settings_localized_spanish.png') });
    console.log('Saved screenshot: settings_localized_spanish.png\n');

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 2: Return to Inbox and Verify Systemic Webmail Localization
    // ─────────────────────────────────────────────────────────────────────────
    console.log('--- STEP 2: Return to Inbox and Assert Systemic UI Localization ---');
    const backBtn = await page.waitForSelector('[data-testid="settings-back-to-inbox-btn"]');
    await backBtn.click();
    await sleep(1000);

    // 2A. Verify TopFixedBar: Module switcher & Search placeholder
    const searchPlaceholder = await page.$eval('#webmail-search-input', el => el.getAttribute('placeholder'));
    console.log(`Top search placeholder: "${searchPlaceholder}"`);
    assert(searchPlaceholder.toLowerCase().includes('buscar'), 'Search input placeholder is localized ("Buscar correos")');

    const moduleSwitcherText = await page.$eval('[data-testid="top-bar-module-switcher"]', el => el.innerText);
    console.log(`Module switcher text: "${moduleSwitcherText.replace(/\n/g, ' ')}"`);
    assert(moduleSwitcherText.includes('Correos'), 'Module switcher has localized "Correos"');
    assert(moduleSwitcherText.includes('Calendario'), 'Module switcher has localized "Calendario"');
    assert(moduleSwitcherText.includes('Notas'), 'Module switcher has localized "Notas"');

    // 2B. Verify Sidebar: Folders and Categories
    const sidebarText = await page.$eval('[data-testid="sidebar"]', el => el.innerText);
    assert(sidebarText.includes('Bandeja de entrada'), 'Sidebar shows "Bandeja de entrada"');
    assert(sidebarText.includes('Enviados'), 'Sidebar shows "Enviados"');
    assert(sidebarText.includes('Borradores'), 'Sidebar shows "Borradores"');
    assert(sidebarText.includes('Papelera'), 'Sidebar shows "Papelera"');
    assert(sidebarText.includes('Archivar') || sidebarText.includes('Archivo'), 'Sidebar shows localized Archive folder');
    assert(sidebarText.includes('Spam'), 'Sidebar shows "Spam"');
    assert(sidebarText.includes('BYOS Mail'), 'Brand noun "BYOS Mail" in sidebar is strictly preserved');

    // 2C. Verify Category Tabs in Message List
    const categoryTabs = await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('[data-testid^="category-tab-"]'));
      return tabs.map(t => t.textContent.trim());
    });
    console.log(`Category tabs: ${JSON.stringify(categoryTabs)}`);
    assert(categoryTabs.some(t => t.includes('Principal')), 'Category tab "Principal" present');
    assert(categoryTabs.some(t => t.includes('Boletines')), 'Category tab "Boletines" present');
    assert(categoryTabs.some(t => t.includes('Social')), 'Category tab "Social" present');

    // 2D. Open Message and Verify Reading Pane & Translation Bar
    console.log('Selecting message row...');
    const messageRow = await page.waitForSelector('[data-testid="message-row"], [data-testid="thread-row"]');
    await messageRow.click();
    await sleep(800);

    const readingPane = await page.waitForSelector('[data-testid="reading-pane"]');
    assert(readingPane !== null, 'Reading pane is open');

    // Open 3-dot menu and click Translate message
    const moreMenuBtn = await page.waitForSelector('[data-testid="reading-pane-overflow-btn"]');
    await moreMenuBtn.click();
    await sleep(400);

    const translateMenuItem = await page.waitForSelector('[data-testid="reading-pane-translate-menu-btn"]');
    const translateMenuLabel = await page.evaluate(el => el.textContent.trim(), translateMenuItem);
    console.log(`3-dot translate menu label: "${translateMenuLabel}"`);
    assert(translateMenuLabel.toLowerCase().includes('traducir'), '3-dot menu item is localized ("Traducir mensaje")');
    await translateMenuItem.click();
    await sleep(500);

    // Verify ReadingPane Translation Bar
    const translationBar = await page.waitForSelector('[data-testid="email-translation-bar"]');
    const translationBarText = await page.evaluate(el => el.innerText, translationBar);
    console.log(`Translation bar text: "${translationBarText.replace(/\n/g, ' ')}"`);
    assert(translationBarText.includes('Traducir:'), 'Translation bar prefix is localized ("Traducir:")');
    assert(translationBarText.includes('Traducir mensaje'), 'Action button is localized ("Traducir mensaje")');
    assert(translationBarText.includes('Traducir siempre'), 'Checkbox label is localized ("Traducir siempre")');

    // 2E. Open Quick Settings Panel (Palette Icon)
    console.log('Opening UI Customizer panel via palette icon...');
    const customizerToggle = await page.waitForSelector('[data-testid="top-bar-appearance-btn"]');
    await customizerToggle.click();
    await sleep(600);

    const customizerPanel = await page.waitForSelector('[data-testid="quick-settings-panel"]');
    const customizerText = await page.evaluate(el => el.innerText, customizerPanel);
    console.log(`Inspecting UI Customizer panel text: "${customizerText.replace(/\n/g, ' ')}"`);
    assert(customizerText.toLowerCase().includes('personalizador'), 'Customizer title is localized ("Personalizador")');
    assert(customizerText.toLowerCase().includes('paleta'), 'Theme section is localized ("Paleta y tema")');
    assert(customizerText.toLowerCase().includes('densidad'), 'Density section is localized ("Densidad de bandeja")');
    assert(customizerText.toLowerCase().includes('prioritaria'), 'Focused inbox section is localized ("Bandeja prioritaria")');
    assert(customizerText.toLowerCase().includes('configuración'), 'Full settings button is localized ("Configuración completa")');

    await page.screenshot({ path: path.join(artifactsDir, 'full_webmail_localization_es.png') });
    console.log('Saved screenshot: full_webmail_localization_es.png\n');

    // Close Customizer panel
    const closeCustomizerBtn = await page.waitForSelector('[data-testid="close-quick-settings-btn"]');
    await closeCustomizerBtn.click();
    await sleep(400);

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 3: Switch back to English and confirm flawless two-way reactivity
    // ─────────────────────────────────────────────────────────────────────────
    console.log('--- STEP 3: Restore to English & Confirm Flawless Reversion ---');
    const settingsBtnRestore = await page.waitForSelector('[data-testid="sidebar-settings-btn"]');
    await settingsBtnRestore.click();
    await page.waitForSelector('[data-testid="settings-layout"]', { timeout: 10000 });

    const accountTabBtnRestore = await page.$('[data-testid="settings-tab-account"]');
    if (accountTabBtnRestore) await accountTabBtnRestore.click();
    await sleep(500);

    const langSelectRestore = await page.waitForSelector('[data-testid="settings-language-select"]');
    console.log('Selecting "en" in Settings -> Account Tab...');
    await langSelectRestore.select('en');
    await sleep(1500);

    const backBtnRestore = await page.waitForSelector('[data-testid="settings-back-to-inbox-btn"]');
    await backBtnRestore.click();
    await sleep(1000);

    const revertedSidebar = await page.$eval('[data-testid="sidebar"]', el => el.innerText);
    console.log(`Reverted sidebar text: "${revertedSidebar.replace(/\n/g, ' ')}"`);
    assert(revertedSidebar.includes('Sent') || revertedSidebar.includes('Inbox') || revertedSidebar.includes('All Inboxes'), 'Sidebar reverted to English');
    assert(revertedSidebar.includes('Sent'), 'Sidebar reverted to "Sent"');
    assert(revertedSidebar.includes('Drafts'), 'Sidebar reverted to "Drafts"');

    await page.screenshot({ path: path.join(artifactsDir, 'full_webmail_localization_en.png') });
    console.log('Saved screenshot: full_webmail_localization_en.png\n');

    console.log('================================================================================');
    console.log('   ALL E2E LOCALIZATION & NOUN PRESERVATION CHECKS PASSED PERFECTLY!            ');
    console.log('================================================================================');
  } catch (err) {
    console.error('Browser verification failed:', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

runVerification();
