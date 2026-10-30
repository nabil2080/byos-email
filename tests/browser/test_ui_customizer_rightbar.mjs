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

async function runUICustomizerTest() {
  console.log("================================================================================");
  console.log("   BYOS REFINED WEBMAIL UI CUSTOMIZER & RIGHT BAR BROWSER VERIFICATION          ");
  console.log("================================================================================\n");

  const uncaughtErrors = [];
  const networkRequests = [];

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ['--no-sandbox', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    page.on('pageerror', (err) => {
      uncaughtErrors.push(err.message);
      console.error(`  [PAGE ERROR]: ${err.message}`);
    });

    page.on('request', (req) => {
      if (req.url().includes('/v1/mailboxes') || req.url().includes('/v1/messages')) {
        networkRequests.push({ url: req.url(), method: req.method() });
      }
    });

    // =========================================================================
    // STEP 1: Login via Real Credentials
    // =========================================================================
    console.log("\n--- [STEP 1] Login Flow for alice@byos.local ---");
    await page.goto('http://127.0.0.1:3001', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(800);

    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.type('input[type="email"]', 'alice@byos.local');
    await page.type('input[type="password"]', 'test-password-123');
    await page.click('button[type="submit"]');

    await page.waitForSelector('[data-testid="account-chip-selector"]', { timeout: 15000 });
    await sleep(1000);

    const activeUser = await page.$eval('[data-testid="account-chip-text"]', (el) => el.textContent.trim());
    console.log(`  Active logged-in account: "${activeUser}"`);
    assert(activeUser.includes('alice@byos.local'), "Alice logged in successfully via real credentials");

    // =========================================================================
    // STEP 2: Verify Removal of Workspace Header
    // =========================================================================
    console.log("\n--- [STEP 2] Verify Removal of Redundant Workspace Header ---");
    const workspaceHeader = await page.$('[data-testid="workspace-header"]');
    assert(workspaceHeader === null, "Top workspace header has been completely removed");

    // =========================================================================
    // STEP 3: Verify Right Utility Bar & Navigation Links
    // =========================================================================
    console.log("\n--- [STEP 3] Verify Right Utility Bar Structure ---");
    await page.waitForSelector('[data-testid="right-utility-bar"]', { timeout: 5000 });
    assert(true, "Right utility bar is rendered on desktop");

    // Primary UI Customizer trigger
    const rightAppearanceBtn = await page.$('[data-testid="right-bar-appearance-btn"]');
    assert(rightAppearanceBtn !== null, "Right Bar appearance & customizer toggle button is present");

    // Calendar toggle moved to Right Bar
    const rightCalendarBtn = await page.$('[data-testid="nav-calendar-tab"]');
    assert(rightCalendarBtn !== null, "Calendar module switcher is present on Right Bar");

    // Contacts moved to Right Bar
    const rightContactsBtn = await page.$('[data-testid="contacts-nav-btn"]');
    assert(rightContactsBtn !== null, "Contacts trigger button is present on Right Bar");

    // Settings moved to Right Bar
    const rightSettingsBtn = await page.$('[data-testid="sidebar-settings-btn"]');
    assert(rightSettingsBtn !== null, "Settings trigger button is present on Right Bar");

    // Shortcuts trigger
    const rightShortcutsBtn = await page.$('[data-testid="right-bar-shortcuts-btn"]');
    assert(rightShortcutsBtn !== null, "Shortcuts help button is present on Right Bar");

    // Zero-knowledge security badge
    const rightSecurityBtn = await page.$('[data-testid="right-bar-security-btn"]');
    assert(rightSecurityBtn !== null, "Security badge is present on Right Bar");

    // =========================================================================
    // STEP 4: Verify Redundant Icon Buttons Removed from Right Bar
    // =========================================================================
    console.log("\n--- [STEP 4] Verify Redundant Icons Removed from Right Bar ---");
    const rightDensityBtn = await page.$('[data-testid="right-bar-density-btn"]');
    assert(rightDensityBtn === null, "Redundant density cycle icon button is removed from right rail");

    const rightLayoutBtn = await page.$('[data-testid="right-bar-layout-btn"]');
    assert(rightLayoutBtn === null, "Redundant layout toggle icon button is removed from right rail");

    const rightThemeBtn = await page.$('[data-testid="right-bar-theme-btn"]');
    assert(rightThemeBtn === null, "Redundant theme toggle icon button is removed from right rail");

    // =========================================================================
    // STEP 5: Verify Left Sidebar Cleaned Up
    // =========================================================================
    console.log("\n--- [STEP 5] Verify Left Sidebar Items Moved Out ---");
    const leftSidebarContent = await page.$eval('[data-testid="sidebar"]', (el) => {
      return {
        hasCompose: el.querySelector('[data-testid="sidebar-compose-btn"]') !== null,
        hasImport: el.querySelector('[data-testid="sidebar-import-btn"]') !== null,
        hasCalendar: el.querySelector('[data-testid="nav-calendar-tab"]') !== null,
        hasContacts: el.querySelector('[data-testid="contacts-nav-btn"]') !== null,
        hasSettings: el.querySelector('[data-testid="sidebar-settings-btn"]') !== null,
      };
    });

    console.log("  Left sidebar structure:", JSON.stringify(leftSidebarContent));
    assert(leftSidebarContent.hasCompose, "Left sidebar retains 'New Message' Compose button");
    assert(leftSidebarContent.hasImport, "Left sidebar retains 'Import Emails' button");
    assert(!leftSidebarContent.hasCalendar, "Calendar button was cleanly moved OUT of left sidebar");
    assert(!leftSidebarContent.hasContacts, "Contacts button was cleanly moved OUT of left sidebar");
    assert(!leftSidebarContent.hasSettings, "Settings button was cleanly moved OUT of left sidebar");

    const initialScreenshotPath = path.resolve(artifactsDir, 'ui_customizer_desktop_initial.png');
    await page.screenshot({ path: initialScreenshotPath });
    console.log(`  Saved screenshot: ${initialScreenshotPath}`);

    // =========================================================================
    // STEP 6: Open UI Customizer Panel & Test Appearance Options
    // =========================================================================
    console.log("\n--- [STEP 6] Open UI Customizer Panel ---");
    await page.click('[data-testid="right-bar-appearance-btn"]');
    await sleep(600);

    await page.waitForSelector('[data-testid="quick-settings-panel"]', { timeout: 5000 });
    assert(true, "UI Customizer panel opened cleanly");

    // Verify key appearance options inside panel
    assert(await page.$('[data-testid="quick-density-compact"]') !== null, "Density 'compact' option exists");
    assert(await page.$('[data-testid="quick-density-cozy"]') !== null, "Density 'cozy' option exists");
    assert(await page.$('[data-testid="quick-density-comfortable"]') !== null, "Density 'comfortable' option exists");
    assert(await page.$('[data-testid="quick-layout-split"]') !== null, "Layout 'split' option exists");
    assert(await page.$('[data-testid="quick-layout-full"]') !== null, "Layout 'full' option exists");
    assert(await page.$('[data-testid="quick-theme-light"]') !== null, "Theme 'Cloud Dancer' option exists");
    assert(await page.$('[data-testid="quick-theme-dark"]') !== null, "Theme 'Midnight Dark' option exists");
    assert(await page.$('[data-testid="font-scale-default"]') !== null, "Font scale 'default' exists");
    assert(await page.$('[data-testid="quick-high-contrast-toggle"]') !== null, "High contrast toggle exists");

    // Ensure calendar-specific settings are not in the UI Customizer panel
    const weekStartInQuick = await page.$('[data-testid="quick-weekstart-select"]');
    assert(weekStartInQuick === null, "Calendar-specific 'week starts on' is NOT in the UI Customizer panel");

    // Test Theme Switching to Dark
    console.log("\n--- [STEP 7] Test Theme Switching via Customizer ---");
    await page.click('[data-testid="quick-theme-dark"]');
    await sleep(500);

    const isDarkClass = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    const dataTheme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    const storedTheme = await page.evaluate(() => localStorage.getItem('byos_theme'));

    console.log(`  Dark mode attributes: classList.dark=${isDarkClass}, data-theme=${dataTheme}, storage=${storedTheme}`);
    assert(isDarkClass, "document.documentElement has 'dark' class applied");
    assert(dataTheme === 'dark', "document.documentElement data-theme is 'dark'");
    assert(storedTheme === 'dark', "localStorage byos_theme is 'dark'");

    const darkModeScreenshotPath = path.resolve(artifactsDir, 'ui_customizer_dark_mode.png');
    await page.screenshot({ path: darkModeScreenshotPath });
    console.log(`  Saved screenshot: ${darkModeScreenshotPath}`);

    // Switch back to light mode
    await page.click('[data-testid="quick-theme-light"]');
    await sleep(500);
    const lightTheme = await page.evaluate(() => localStorage.getItem('byos_theme'));
    assert(lightTheme === 'cloud_dancer', "Switched theme back to Cloud Dancer");

    // Close Customizer panel
    await page.click('[data-testid="close-quick-settings-btn"]');
    await sleep(400);

    // =========================================================================
    // STEP 8: Verify Calendar Tab in Webmail Settings
    // =========================================================================
    console.log("\n--- [STEP 8] Verify Calendar Notice in Webmail Settings ---");
    // Open settings via Right Bar
    await page.click('[data-testid="sidebar-settings-btn"]');
    await sleep(600);

    await page.waitForSelector('[data-testid="settings-tab-calendar"]', { timeout: 5000 });
    await page.click('[data-testid="settings-tab-calendar"]');
    await sleep(600);

    await page.waitForSelector('[data-testid="settings-calendar-tab-content"]', { timeout: 5000 });
    const tabNoticeText = await page.$eval('[data-testid="settings-calendar-tab-content"]', (el) => el.textContent);
    console.log("  Calendar Tab Notice Snippet:", tabNoticeText.slice(0, 160).trim());
    assert(tabNoticeText.includes("Calendar settings are configured in the Calendar tab"), "Calendar tab clearly states settings are in the Calendar tab");

    const goToCalBtn = await page.$('[data-testid="calendar-settings-go-to-calendar-btn"]');
    assert(goToCalBtn !== null, "'Open Calendar Workspace' button is present in Calendar Tab");

    const resetBtn = await page.$('[data-testid="calendar-settings-reset-btn"]');
    assert(resetBtn !== null, "Reset to defaults button is retained in Calendar Tab");

    // Close settings back to inbox
    await page.click('[data-testid="settings-back-to-inbox-btn"]');
    await sleep(500);

    // =========================================================================
    // STEP 9: Test 375px Mobile Viewport Responsiveness
    // =========================================================================
    console.log("\n--- [STEP 9] Test Mobile Responsiveness (375px Viewport) ---");
    await page.setViewport({ width: 375, height: 812 });
    await sleep(800);

    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth;
    });
    console.log(`  document.scrollWidth at 375px viewport: ${await page.evaluate(() => document.documentElement.scrollWidth)}`);
    assert(!hasHorizontalOverflow, "Zero horizontal overflow at 375px mobile viewport");

    const mobileScreenshot = path.resolve(artifactsDir, 'ui_customizer_mobile_375px.png');
    await page.screenshot({ path: mobileScreenshot });
    console.log(`  Saved screenshot: ${mobileScreenshot}`);

    // DevTools Network & Storage Dump
    console.log("\n--- DevTools State Dump ---");
    const storageState = await page.evaluate(() => ({
      byos_theme: localStorage.getItem('byos_theme'),
      byos_density: localStorage.getItem('byos_density'),
      byos_layout_mode: localStorage.getItem('byos_layout_mode'),
      byos_font_scale: localStorage.getItem('byos_font_scale'),
      byos_high_contrast: localStorage.getItem('byos_high_contrast'),
    }));
    console.log("  localStorage state dump:", JSON.stringify(storageState, null, 2));

    console.log("\n--- Browser Console / Error Log Check ---");
    console.log(`  Total uncaught page errors: ${uncaughtErrors.length}`);
    assert(uncaughtErrors.length === 0, "No uncaught runtime errors during test execution");

    console.log("\n================================================================================");
    console.log("   ALL REFINED UI CUSTOMIZER CHECKS PASSED                                     ");
    console.log("================================================================================\n");

  } finally {
    await browser.close();
  }
}

runUICustomizerTest().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
