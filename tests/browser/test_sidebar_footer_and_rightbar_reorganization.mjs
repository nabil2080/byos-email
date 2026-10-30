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

function assert(condition, message) {
  if (!condition) {
    console.error(`  FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  PASS: ${message}`);
}

async function run() {
  console.log("================================================================================");
  console.log("   BYOS: SIDEBAR FOOTER, RIGHTBAR REORGANIZATION & TOP BAR PLACEMENT TEST       ");
  console.log("================================================================================");

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--window-size=1280,800"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") pageErrors.push(msg.text());
  });

  try {
    // -------------------------------------------------------------------------
    // STEP 1: Login Flow as alice@byos.local
    // -------------------------------------------------------------------------
    console.log("\n--- [STEP 1] Login as alice@byos.local ---");
    await page.goto("http://127.0.0.1:3001", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await sleep(600);

    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.type('input[type="email"]', "alice@byos.local");
    await page.type('input[type="password"]', "test-password-123");
    await page.click('button[type="submit"]');

    await page.waitForSelector('[data-testid="main-content"]', { timeout: 15000 });
    console.log("  Logged into Webmail successfully.");
    await sleep(800);

    // -------------------------------------------------------------------------
    // STEP 2: Verify Mailbox Left Sidebar Footer & Removed Elements
    // -------------------------------------------------------------------------
    console.log("\n--- [STEP 2] Check Mailbox Sidebar Footer & Removed Buttons ---");
    await page.waitForSelector('[data-testid="sidebar"]', { timeout: 5000 });

    const mailboxSidebarCheck = await page.evaluate(() => {
      const sidebar = document.querySelector('[data-testid="sidebar"]');
      if (!sidebar) return null;

      const importBtn = sidebar.querySelector('[data-testid="sidebar-import-btn"]');
      const storagePill = sidebar.querySelector('[data-testid="storage-status-pill"]');
      const syncedS3Text = sidebar.textContent.includes("Synced to S3");
      const contactsBtn = sidebar.querySelector('[data-testid="sidebar-contacts-btn"]');
      const settingsBtn = sidebar.querySelector('[data-testid="sidebar-settings-btn"]');

      return {
        hasImportBtn: Boolean(importBtn),
        hasStoragePill: Boolean(storagePill),
        hasSyncedS3Text: syncedS3Text,
        hasContactsBtn: Boolean(contactsBtn),
        hasSettingsBtn: Boolean(settingsBtn),
      };
    });

    console.log("  Mailbox sidebar checks:", JSON.stringify(mailboxSidebarCheck, null, 2));
    assert(!mailboxSidebarCheck.hasImportBtn, "Import Emails button is completely removed from Mailbox sidebar");
    assert(!mailboxSidebarCheck.hasStoragePill, "StorageStatusPill element is completely removed from Mailbox sidebar");
    assert(!mailboxSidebarCheck.hasSyncedS3Text, "'Synced to S3' text is completely removed from Mailbox sidebar");
    assert(mailboxSidebarCheck.hasContactsBtn, "Contacts button is present in sidebar footer");
    assert(mailboxSidebarCheck.hasSettingsBtn, "Settings button is present in sidebar footer");

    // Take screenshot of Mailbox sidebar with footer
    const footerScreenshot = path.join(artifactsDir, "sidebar_footer_contacts_settings.png");
    await page.screenshot({ path: footerScreenshot });
    console.log("  Saved screenshot: sidebar_footer_contacts_settings.png");

    // Click Contacts in sidebar footer to verify modal opens
    console.log("\n--- [STEP 2.1] Test Contacts & Settings from Sidebar Footer ---");
    await page.click('[data-testid="sidebar-contacts-btn"]');
    await page.waitForSelector('[data-testid="contacts-modal"]', { timeout: 5000 });
    console.log("  Contacts modal opened successfully from sidebar footer.");
    // Close Contacts modal
    const closeContactsBtn = await page.$('[data-testid="contacts-modal"] button[aria-label="Close"]');
    if (closeContactsBtn) {
      await closeContactsBtn.click();
    } else {
      await page.keyboard.press("Escape");
    }
    await sleep(300);

    // Click Settings in sidebar footer to verify settings opens
    await page.click('[data-testid="sidebar-settings-btn"]');
    await page.waitForSelector('[data-testid="settings-layout"]', { timeout: 5000 });
    console.log("  Settings layout opened successfully from sidebar footer.");

    // Check Appearance and Calendar tabs are removed from SettingsLayout
    const settingsTabsCheck = await page.evaluate(() => {
      const layout = document.querySelector('[data-testid="settings-layout"]');
      if (!layout) return null;
      return {
        hasAppearanceTab: Boolean(layout.querySelector('[data-testid="settings-tab-appearance"]')),
        hasCalendarTab: Boolean(layout.querySelector('[data-testid="settings-tab-calendar"]')),
        hasAccountTab: Boolean(layout.querySelector('[data-testid="settings-tab-account"]')),
        hasSecurityTab: Boolean(layout.querySelector('[data-testid="settings-tab-security"]')),
      };
    });
    console.log("  Settings tabs check:", JSON.stringify(settingsTabsCheck, null, 2));
    assert(!settingsTabsCheck.hasAppearanceTab, "Appearance tab is removed from Settings");
    assert(!settingsTabsCheck.hasCalendarTab, "Calendar tab is removed from Settings");
    assert(settingsTabsCheck.hasAccountTab, "Account tab is present in Settings");
    assert(settingsTabsCheck.hasSecurityTab, "Security tab is present in Settings");

    // Close Settings and return to mailbox
    await page.click('[data-testid="settings-back-to-inbox-btn"]');
    await page.waitForSelector('[data-testid="sidebar"]', { timeout: 5000 });
    await sleep(300);

    // -------------------------------------------------------------------------
    // STEP 3: Verify TopFixedBar Placement (Inside Email List div, no header tag)
    // -------------------------------------------------------------------------
    console.log("\n--- [STEP 3] Check TopFixedBar is inside Email List div and uses div instead of header ---");
    const topBarPlacement = await page.evaluate(() => {
      const topBar = document.querySelector('[data-testid="top-fixed-bar"]');
      if (!topBar) return { found: false };

      const messageList = document.querySelector('[data-testid="message-list"]');
      const isInsideMessageList = messageList ? messageList.contains(topBar) : false;

      return {
        found: true,
        topBarTag: topBar.tagName.toLowerCase(),
        messageListTag: messageList?.tagName.toLowerCase(),
        isInsideMessageList,
      };
    });

    console.log("  TopBar placement:", JSON.stringify(topBarPlacement, null, 2));
    assert(topBarPlacement.found, "TopFixedBar is rendered");
    assert(topBarPlacement.topBarTag === "div", `TopFixedBar must be a 'div' without header tag (got '${topBarPlacement.topBarTag}')`);
    assert(topBarPlacement.messageListTag === "div", `Email list container must be a 'div' (got '${topBarPlacement.messageListTag}')`);
    assert(topBarPlacement.isInsideMessageList, "TopFixedBar is situated directly INSIDE the email list div");

    const emailListScreenshot = path.join(artifactsDir, "mailbox_top_bar_inside_email_list.png");
    await page.screenshot({ path: emailListScreenshot });
    console.log("  Saved screenshot: mailbox_top_bar_inside_email_list.png");

    // -------------------------------------------------------------------------
    // STEP 3.1: Verify TopFixedBar Right Section (Customizer & Theme Switcher)
    // -------------------------------------------------------------------------
    console.log("\n--- [STEP 3.1] Check TopFixedBar has Customizer & Theme Switcher, and removed old pills/status ---");
    const topBarRightCheck = await page.evaluate(() => {
      const topBar = document.querySelector('[data-testid="top-fixed-bar"]');
      if (!topBar) return null;

      const moduleSwitcher = topBar.querySelector('[data-testid="top-bar-module-switcher"]');
      const networkStatus = topBar.querySelector('[data-testid="top-bar-network-status"]');
      const hasOnlineText = topBar.textContent.includes("Online") || topBar.textContent.includes("All up to date");
      const appearanceBtn = topBar.querySelector('[data-testid="top-bar-appearance-btn"]');
      const themeToggle = topBar.querySelector('[data-testid="top-bar-theme-toggle"]');

      return {
        hasModuleSwitcher: Boolean(moduleSwitcher),
        hasNetworkStatus: Boolean(networkStatus),
        hasOnlineText,
        hasAppearanceBtn: Boolean(appearanceBtn),
        hasThemeToggle: Boolean(themeToggle),
      };
    });

    console.log("  TopFixedBar right elements check:", JSON.stringify(topBarRightCheck, null, 2));
    assert(!topBarRightCheck.hasModuleSwitcher, "TopFixedBar module switcher pills [Emails|Contacts|Calendar|Notes] REMOVED");
    assert(!topBarRightCheck.hasNetworkStatus, "TopFixedBar network status element REMOVED");
    assert(!topBarRightCheck.hasOnlineText, "TopFixedBar 'Online / All up to date' text REMOVED");
    assert(topBarRightCheck.hasAppearanceBtn, "TopFixedBar Customizer (palette) button PRESENT");
    assert(topBarRightCheck.hasThemeToggle, "TopFixedBar Light/Dark theme toggle PRESENT");

    // Test opening QuickSettingsPanel from TopFixedBar appearance button
    console.log("  Testing Customizer toggle from TopFixedBar...");
    await page.click('[data-testid="top-bar-appearance-btn"]');
    await sleep(400);
    const customizerOpened = await page.evaluate(() => {
      const panel = document.querySelector('[data-testid="quick-settings-panel"]');
      return Boolean(panel);
    });
    assert(customizerOpened, "QuickSettingsPanel opened via TopFixedBar appearance button");

    const customizerScreenshot = path.join(artifactsDir, "top_bar_customizer_opened.png");
    await page.screenshot({ path: customizerScreenshot });
    console.log("  Saved screenshot: top_bar_customizer_opened.png");

    // Close customizer
    await page.click('[data-testid="top-bar-appearance-btn"]');
    await sleep(300);

    // Test Theme toggle from TopFixedBar
    console.log("  Testing Theme toggle from TopFixedBar...");
    const topBarInitialTheme = await page.evaluate(() => document.documentElement.getAttribute("data-theme") || "light");
    await page.click('[data-testid="top-bar-theme-toggle"]');
    await sleep(300);
    const topBarToggledTheme = await page.evaluate(() => document.documentElement.getAttribute("data-theme") || "light");
    console.log(`  TopFixedBar Theme toggled from ${topBarInitialTheme} to ${topBarToggledTheme}`);
    assert(topBarInitialTheme !== topBarToggledTheme, "Theme successfully switched via TopFixedBar theme toggle");

    const themeToggledScreenshot = path.join(artifactsDir, "top_bar_theme_dark_mode.png");
    await page.screenshot({ path: themeToggledScreenshot });
    console.log("  Saved screenshot: top_bar_theme_dark_mode.png");

    // Restore original theme
    await page.click('[data-testid="top-bar-theme-toggle"]');
    await sleep(300);

    // -------------------------------------------------------------------------
    // STEP 4: Verify RightBar Buttons & Exclusions
    // -------------------------------------------------------------------------
    console.log("\n--- [STEP 4] Check RightBar Only Contains Permitted Icons ---");
    await page.waitForSelector('[data-testid="right-utility-bar"]', { timeout: 5000 });

    const rightBarCheck = await page.evaluate(() => {
      const bar = document.querySelector('[data-testid="right-utility-bar"]');
      if (!bar) return null;

      const emailsBtn = bar.querySelector('[data-testid="right-bar-emails-btn"]');
      const calendarBtn = bar.querySelector('[data-testid="right-bar-calendar-btn"]');
      const notesBtn = bar.querySelector('[data-testid="right-bar-notes-btn"]');
      const contactsBtn = bar.querySelector('[data-testid="contacts-nav-btn"]');
      const customizerBtn = bar.querySelector('[data-testid="right-bar-appearance-btn"]');
      const themeToggle = bar.querySelector('[data-testid="right-bar-theme-toggle"]');

      // Prohibited icons
      const shortcutsBtn = bar.querySelector('[data-testid="right-bar-shortcuts-btn"]');
      const securityBtn = bar.querySelector('[data-testid="right-bar-security-btn"]');
      const standaloneSettingsBtn = bar.querySelector('[data-testid="right-bar-settings-btn"]');

      const allButtons = bar.querySelectorAll("button");

      return {
        hasEmailsBtn: Boolean(emailsBtn),
        hasCalendarBtn: Boolean(calendarBtn),
        hasNotesBtn: Boolean(notesBtn),
        hasContactsBtn: Boolean(contactsBtn),
        hasCustomizerBtn: Boolean(customizerBtn),
        hasThemeToggle: Boolean(themeToggle),
        totalButtonsCount: allButtons.length,
        hasShortcutsBtn: Boolean(shortcutsBtn),
        hasSecurityBtn: Boolean(securityBtn),
        hasStandaloneSettingsBtn: Boolean(standaloneSettingsBtn),
      };
    });

    console.log("  RightBar checks:", JSON.stringify(rightBarCheck, null, 2));
    assert(rightBarCheck.hasEmailsBtn, "RightBar includes Emails button");
    assert(rightBarCheck.hasCalendarBtn, "RightBar includes Calendar button");
    assert(rightBarCheck.hasNotesBtn, "RightBar includes Notes button");
    assert(!rightBarCheck.hasContactsBtn, "RightBar does NOT have Contacts button (removed from RightBar)");
    assert(!rightBarCheck.hasCustomizerBtn, "RightBar does NOT have Customizer button (removed from RightBar)");
    assert(!rightBarCheck.hasThemeToggle, "RightBar does NOT have Light/Dark theme toggle (removed from RightBar)");
    assert(!rightBarCheck.hasShortcutsBtn, "RightBar does NOT have shortcuts icon");
    assert(!rightBarCheck.hasSecurityBtn, "RightBar does NOT have security lock indicator");
    assert(!rightBarCheck.hasStandaloneSettingsBtn, "RightBar does NOT have duplicate settings button");
    assert(rightBarCheck.totalButtonsCount === 3, `RightBar has exactly 3 module buttons (got ${rightBarCheck.totalButtonsCount})`);

    const rightBarScreenshot = path.join(artifactsDir, "rightbar_module_switchers_only.png");
    await page.screenshot({ path: rightBarScreenshot });
    console.log("  Saved screenshot: rightbar_module_switchers_only.png");

    // -------------------------------------------------------------------------
    // STEP 5: Switch to Calendar via RightBar & Verify RightBar and Sidebar Footer
    // -------------------------------------------------------------------------
    console.log("\n--- [STEP 5] Switch to Calendar via RightBar ---");
    await page.click('[data-testid="right-bar-calendar-btn"]');
    await sleep(600);
    await page.waitForSelector('[data-testid="calendar-view"]', { timeout: 5000 });
    console.log("  Switched to Calendar View.");

    // Verify RightBar is still visible in Calendar!
    const calRightBarVisible = await page.evaluate(() => {
      const bar = document.querySelector('[data-testid="right-utility-bar"]');
      if (!bar) return false;
      const rect = bar.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    assert(calRightBarVisible, "RightBar is visible beside Workspace Card in Calendar View");

    // Verify Calendar sidebar footer
    const calSidebarFooter = await page.evaluate(() => {
      const sidebar = document.querySelector('[data-testid="calendar-sidebar"]');
      if (!sidebar) return null;
      return {
        hasStoragePill: Boolean(sidebar.querySelector('[data-testid="storage-status-pill"]')),
        hasContactsBtn: Boolean(sidebar.querySelector('[data-testid="sidebar-contacts-btn"]')),
        hasSettingsBtn: Boolean(sidebar.querySelector('[data-testid="sidebar-settings-btn"]')),
        hasSyncedS3: sidebar.textContent.includes("Synced to S3"),
      };
    });
    console.log("  Calendar sidebar footer checks:", JSON.stringify(calSidebarFooter, null, 2));
    assert(!calSidebarFooter.hasStoragePill, "StorageStatusPill removed from Calendar sidebar");
    assert(!calSidebarFooter.hasSyncedS3, "'Synced to S3' removed from Calendar sidebar");
    assert(calSidebarFooter.hasContactsBtn, "Contacts button in Calendar sidebar footer");
    assert(calSidebarFooter.hasSettingsBtn, "Settings button in Calendar sidebar footer");

    const calScreenshot = path.join(artifactsDir, "calendar_with_rightbar_active.png");
    await page.screenshot({ path: calScreenshot });
    console.log("  Saved screenshot: calendar_with_rightbar_active.png");

    // Verify Calendar TopFixedBar has Customizer & Theme Toggle
    const calTopBarCheck = await page.evaluate(() => {
      const topBar = document.querySelector('[data-testid="top-fixed-bar"]');
      if (!topBar) return null;
      return {
        hasAppearanceBtn: Boolean(topBar.querySelector('[data-testid="top-bar-appearance-btn"]')),
        hasThemeToggle: Boolean(topBar.querySelector('[data-testid="top-bar-theme-toggle"]')),
        hasModuleSwitcher: Boolean(topBar.querySelector('[data-testid="top-bar-module-switcher"]')),
      };
    });
    assert(calTopBarCheck.hasAppearanceBtn, "Calendar TopFixedBar has appearance customizer button");
    assert(calTopBarCheck.hasThemeToggle, "Calendar TopFixedBar has light/dark theme toggle");
    assert(!calTopBarCheck.hasModuleSwitcher, "Calendar TopFixedBar does NOT have old module switcher");

    // -------------------------------------------------------------------------
    // STEP 6: Switch to Notes via RightBar & Verify RightBar and Sidebar Footer
    // -------------------------------------------------------------------------
    console.log("\n--- [STEP 6] Switch to Notes via RightBar ---");
    await page.click('[data-testid="right-bar-notes-btn"]');
    await sleep(600);
    await page.waitForSelector('[data-testid="notes-view"]', { timeout: 5000 });
    console.log("  Switched to Notes View.");

    // Verify RightBar is still visible in Notes!
    const notesRightBarVisible = await page.evaluate(() => {
      const bar = document.querySelector('[data-testid="right-utility-bar"]');
      if (!bar) return false;
      const rect = bar.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    assert(notesRightBarVisible, "RightBar is visible beside Workspace Card in Notes View");

    // Verify Notes sidebar footer
    const notesSidebarFooter = await page.evaluate(() => {
      const sidebar = document.querySelector('[data-testid="notes-sidebar"]');
      if (!sidebar) return null;
      return {
        hasStoragePill: Boolean(sidebar.querySelector('[data-testid="storage-status-pill"]')),
        hasContactsBtn: Boolean(sidebar.querySelector('[data-testid="sidebar-contacts-btn"]')),
        hasSettingsBtn: Boolean(sidebar.querySelector('[data-testid="sidebar-settings-btn"]')),
        hasSyncedS3: sidebar.textContent.includes("Synced to S3"),
      };
    });
    console.log("  Notes sidebar footer checks:", JSON.stringify(notesSidebarFooter, null, 2));
    assert(!notesSidebarFooter.hasStoragePill, "StorageStatusPill removed from Notes sidebar");
    assert(!notesSidebarFooter.hasSyncedS3, "'Synced to S3' removed from Notes sidebar");
    assert(notesSidebarFooter.hasContactsBtn, "Contacts button in Notes sidebar footer");
    assert(notesSidebarFooter.hasSettingsBtn, "Settings button in Notes sidebar footer");

    const notesScreenshot = path.join(artifactsDir, "notes_with_rightbar_active.png");
    await page.screenshot({ path: notesScreenshot });
    console.log("  Saved screenshot: notes_with_rightbar_active.png");

    // Verify Notes TopFixedBar has Customizer & Theme Toggle
    const notesTopBarCheck = await page.evaluate(() => {
      const topBar = document.querySelector('[data-testid="top-fixed-bar"]');
      if (!topBar) return null;
      return {
        hasAppearanceBtn: Boolean(topBar.querySelector('[data-testid="top-bar-appearance-btn"]')),
        hasThemeToggle: Boolean(topBar.querySelector('[data-testid="top-bar-theme-toggle"]')),
        hasModuleSwitcher: Boolean(topBar.querySelector('[data-testid="top-bar-module-switcher"]')),
      };
    });
    assert(notesTopBarCheck.hasAppearanceBtn, "Notes TopFixedBar has appearance customizer button");
    assert(notesTopBarCheck.hasThemeToggle, "Notes TopFixedBar has light/dark theme toggle");
    assert(!notesTopBarCheck.hasModuleSwitcher, "Notes TopFixedBar does NOT have old module switcher");

    // -------------------------------------------------------------------------
    // STEP 7: Mobile Viewport 375px Verification (No Horizontal Scroll)
    // -------------------------------------------------------------------------
    console.log("\n--- [STEP 7] Mobile Responsive Test at 375px Viewport ---");
    await page.setViewport({ width: 375, height: 667 });
    await sleep(500);

    const mobileScrollInfo = await page.evaluate(() => {
      return {
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        hasHorizontalScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });

    console.log("  Mobile 375px scroll info:", JSON.stringify(mobileScrollInfo, null, 2));
    assert(!mobileScrollInfo.hasHorizontalScroll, "Zero horizontal scrolling at 375px mobile viewport");

    const mobileScreenshot = path.join(artifactsDir, "mobile_viewport_375px_no_scroll.png");
    await page.screenshot({ path: mobileScreenshot });
    console.log("  Saved screenshot: mobile_viewport_375px_no_scroll.png");

    console.log("\nALL VERIFICATIONS PASSED SUCCESSFULLY.");
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error("FATAL ERROR in browser verification:", err);
  process.exit(1);
});
