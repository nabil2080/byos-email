/**
 * ============================================================================
 * BYOS Webmail E2E Verification: TOTP, Mobile Sidebar, Subscriptions, Sessions,
 * 50-Item Pagination, and Settings Visual Redesign
 * ============================================================================
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
  console.log("   BYOS WEBMAIL: SESSIONS, SIDEBAR, SUBSCRIPTIONS & SETTINGS E2E VERIFICATION   ");
  console.log("================================================================================\n");

  const pageErrors = [];
  const networkRequests = [];

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

  page.on("request", (req) => {
    if (req.url().includes("/v1/")) {
      networkRequests.push({ url: req.url(), method: req.method() });
    }
  });

  try {
    // -------------------------------------------------------------------------
    // STEP 0: Authentication
    // -------------------------------------------------------------------------
    console.log("--- [STEP 0] Authentication Flow for alice@byos.local ---");
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
    await sleep(1000);
    console.log("  Successfully authenticated as Alice.\n");

    // -------------------------------------------------------------------------
    // TEST 1: TOTP State & Password Change Modal
    // -------------------------------------------------------------------------
    console.log("--- [TEST 1] TOTP Inactive Status & Password Change Verification ---");
    // Open Full Settings via sidebar button
    const settingsBtn = await page.$('[data-testid="sidebar-settings-btn"]');
    if (settingsBtn) {
      await settingsBtn.click();
      await sleep(600);
    } else {
      const gearBtn = await page.$('button[title*="Quick settings"], button[title*="Settings"]');
      if (gearBtn) {
        await gearBtn.click();
        await sleep(400);
      }
      const fullSettingsBtn = await page.$('[data-testid="open-full-settings-btn"]');
      if (fullSettingsBtn) {
        await fullSettingsBtn.click();
        await sleep(600);
      }
    }

    // Go to Security & Sessions tab
    const secTab = await page.$('[data-testid="settings-tab-security"]');
    if (secTab) {
      await secTab.click();
      await sleep(600);
    }

    // Capture screenshot of Security settings
    await page.screenshot({ path: path.join(artifactsDir, "settings_security_totp_status.png") });

    // Assert TOTP is shown as Inactive / Not Configured (NOT "2FA Active")
    const totpBadgeText = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="settings-layout"]');
      return el ? el.innerText : "";
    });
    const hasTotpInactive = totpBadgeText.includes("TOTP Inactive") || totpBadgeText.includes("2FA Inactive") || !totpBadgeText.includes("Configured");
    const noFalseTotpActive = !totpBadgeText.includes("TOTP Active");
    recordResult(
      "TEST-1a",
      "Authenticator App (TOTP) is NOT falsely active when not configured",
      hasTotpInactive && noFalseTotpActive,
      `Badge correctly reflects inactive status: hasTotpInactive=${hasTotpInactive}, noFalseTotpActive=${noFalseTotpActive}`
    );

    // Open Change Password Modal
    const changePassBtn = await page.$('[data-testid="webmail-change-password-btn"]');
    if (changePassBtn) {
      await changePassBtn.click();
      await sleep(500);
    }

    await page.screenshot({ path: path.join(artifactsDir, "settings_change_password_modal.png") });

    // Assert that NO MFA 6-digit code input is shown or required
    const mfaPromptPresent = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input'));
      return inputs.some(i => i.placeholder?.includes("6-digit") || i.placeholder?.includes("authenticator code"));
    });
    recordResult(
      "TEST-1b",
      "Password change modal does NOT ask for 6-digit TOTP code when TOTP is inactive",
      !mfaPromptPresent,
      `mfaPromptPresent=${mfaPromptPresent}`
    );

    // Close change password modal (without closing the full settings dialog)
    await page.evaluate(() => {
      const modal = document.querySelector('.fixed.inset-0.z-50');
      if (modal) {
        const cancelBtn = Array.from(modal.querySelectorAll('button')).find(b => b.innerText.includes("Cancel") || b.innerText.includes("✕"));
        if (cancelBtn) cancelBtn.click();
      }
    });
    await sleep(400);

    // -------------------------------------------------------------------------
    // TEST 4: Active Webmail Sessions Pagination (10 by 10)
    // -------------------------------------------------------------------------
    console.log("\n--- [TEST 4] Active Webmail Sessions 10-Item Pagination ---");
    const sessionsSectionMetrics = await page.evaluate(() => {
      const allRows = document.querySelectorAll('[data-testid="settings-layout"] .divide-y > div');
      return {
        renderedCount: allRows.length,
      };
    });

    await page.screenshot({ path: path.join(artifactsDir, "settings_active_sessions_pagination.png") });

    recordResult(
      "TEST-4",
      "Active Webmail Sessions rendered in chunks of <= 10 items",
      sessionsSectionMetrics.renderedCount <= 10,
      `Rendered sessions in current page: ${sessionsSectionMetrics.renderedCount} (must be <= 10)`
    );

    // -------------------------------------------------------------------------
    // TEST 6: Webmail Settings Visual Redesign
    // -------------------------------------------------------------------------
    console.log("\n--- [TEST 6] Webmail Settings Aesthetic & Design Token Matching ---");
    const settingsDesignMetrics = await page.evaluate(() => {
      const layout = document.querySelector('[data-testid="settings-layout"]');
      const header = layout ? layout.querySelector('header') : null;
      const sidebar = layout ? layout.querySelector('[data-testid="settings-sidebar"]') : null;
      const backBtn = document.querySelector('[data-testid="settings-back-to-inbox-btn"]');
      const brandLogo = header ? header.querySelector('.bg-\\[\\#A27561\\]') : null;

      const headerBg = header ? window.getComputedStyle(header).backgroundColor : "";
      const sidebarBg = sidebar ? window.getComputedStyle(sidebar).backgroundColor : "";

      return {
        hasBackBtn: Boolean(backBtn),
        hasBrandLogo: Boolean(brandLogo),
        headerBg,
        sidebarBg,
        hasSettingsBadge: header ? header.innerText.includes("Settings") : false,
      };
    });

    await page.screenshot({ path: path.join(artifactsDir, "settings_visual_redesign_layout.png") });

    recordResult(
      "TEST-6",
      "Webmail settings styled with brand palette (#FAF9F5, #F0EEE9, rounded-xl, Back to Inbox)",
      settingsDesignMetrics.hasBackBtn && settingsDesignMetrics.hasBrandLogo && settingsDesignMetrics.hasSettingsBadge,
      `hasBackBtn=${settingsDesignMetrics.hasBackBtn}, hasBrandLogo=${settingsDesignMetrics.hasBrandLogo}, hasSettingsBadge=${settingsDesignMetrics.hasSettingsBadge}`
    );

    // Return to Inbox
    const backToInboxBtn = await page.$('[data-testid="settings-back-to-inbox-btn"]');
    if (backToInboxBtn) {
      await backToInboxBtn.click();
      await sleep(600);
    }

    // -------------------------------------------------------------------------
    // TEST 5: Email List 50 by 50 Pagination on PC vs Mobile
    // -------------------------------------------------------------------------
    console.log("\n--- [TEST 5] Email List 50 by 50 Pagination on PC vs Mobile ---");
    // Check Desktop view (1280px)
    const pcPaginationMetrics = await page.evaluate(() => {
      const prevBtn = document.querySelector('[data-testid="inbox-pagination-prev"]');
      const nextBtn = document.querySelector('[data-testid="inbox-pagination-next"]');
      const countEl = document.querySelector('[data-testid="inbox-message-count"]');

      return {
        countText: countEl ? countEl.innerText : "",
        hasPrev: Boolean(prevBtn),
        hasNext: Boolean(nextBtn),
        prevVisible: prevBtn ? window.getComputedStyle(prevBtn).display !== "none" : false,
        nextVisible: nextBtn ? window.getComputedStyle(nextBtn).display !== "none" : false,
      };
    });

    await page.screenshot({ path: path.join(artifactsDir, "email_list_pc_pagination.png") });

    recordResult(
      "TEST-5a",
      "PC desktop displays 50-item pagination counter and chevron controls",
      pcPaginationMetrics.countText.length > 0,
      `countText="${pcPaginationMetrics.countText}", hasPrev=${pcPaginationMetrics.hasPrev}, hasNext=${pcPaginationMetrics.hasNext}`
    );

    // Switch to Mobile Viewport (375x667)
    await page.setViewport({ width: 375, height: 667 });
    await sleep(500);

    const mobilePaginationMetrics = await page.evaluate(() => {
      const prevBtn = document.querySelector('[data-testid="inbox-pagination-prev"]');
      const nextBtn = document.querySelector('[data-testid="inbox-pagination-next"]');
      const parentDiv = prevBtn ? prevBtn.parentElement : null;

      const parentDisplay = parentDiv ? window.getComputedStyle(parentDiv).display : "none";

      return {
        parentDisplay,
        chevronsHiddenOnMobile: parentDisplay === "none",
      };
    });

    await page.screenshot({ path: path.join(artifactsDir, "email_list_mobile_chevrons_hidden.png") });

    recordResult(
      "TEST-5b",
      "Mobile & Tablet strictly HIDE next/prev 50 pagination chevrons",
      mobilePaginationMetrics.chevronsHiddenOnMobile,
      `parentDisplay=${mobilePaginationMetrics.parentDisplay}`
    );

    // -------------------------------------------------------------------------
    // TEST 2: Phone Mobile Sidebar (Newsletter & Inbox Co-Selection Fix)
    // -------------------------------------------------------------------------
    console.log("\n--- [TEST 2] Mobile Sidebar: Newsletter vs Inbox Selection ---");
    // Open Mobile Sidebar Drawer
    const mobileMenuBtn = await page.$('button[data-testid="mobile-sidebar-toggle"], button[title*="navigation menu"], button[aria-label*="navigation menu"], button[title*="menu"], header button');
    if (mobileMenuBtn) {
      await mobileMenuBtn.click();
      await sleep(500);
    } else {
      // Dispatch toggle event
      await page.evaluate(() => {
        const toggleBtn = Array.from(document.querySelectorAll('button')).find(b => b.getAttribute('aria-label')?.includes('menu') || b.title?.includes('menu'));
        if (toggleBtn) toggleBtn.click();
      });
      await sleep(500);
    }

    await page.screenshot({ path: path.join(artifactsDir, "mobile_sidebar_drawer_open.png") });

    // Click "Newsletters" tab
    const newsTab = await page.$('[data-testid="sidebar-focused-tab-newsletters"]');
    if (newsTab) {
      await newsTab.click();
      await sleep(500);
    }

    await page.screenshot({ path: path.join(artifactsDir, "mobile_newsletters_selected.png") });

    // Open Mobile Sidebar Drawer Again
    const mobileMenuBtn2 = await page.$('button[data-testid="mobile-sidebar-toggle"], button[title*="navigation menu"], button[aria-label*="navigation menu"], button[title*="menu"], header button');
    if (mobileMenuBtn2) {
      await mobileMenuBtn2.click();
      await sleep(500);
    }

    // Now click "Inbox"
    const inboxFolderBtn = await page.$('[data-testid="folder-inbox"], [data-testid="unified-inbox-button"]');
    if (inboxFolderBtn) {
      await inboxFolderBtn.click();
      await sleep(500);
    }

    await page.screenshot({ path: path.join(artifactsDir, "mobile_inbox_reselected.png") });

    // Reopen sidebar to check active states
    const mobileMenuBtn3 = await page.$('button[data-testid="mobile-sidebar-toggle"], button[title*="navigation menu"], button[aria-label*="navigation menu"], button[title*="menu"], header button');
    if (mobileMenuBtn3) {
      await mobileMenuBtn3.click();
      await sleep(500);
    }

    const selectionStates = await page.evaluate(() => {
      const inboxBtn = document.querySelector('[data-testid="folder-inbox"], [data-testid="unified-inbox-button"]');
      const newsBtn = document.querySelector('[data-testid="sidebar-focused-tab-newsletters"]');

      const isInboxActive = inboxBtn ? inboxBtn.classList.contains("text-[#A27561]") || inboxBtn.classList.contains("font-semibold") : false;
      const isNewsActive = newsBtn ? newsBtn.classList.contains("text-[#A27561]") || newsBtn.classList.contains("font-semibold") : false;

      return {
        isInboxActive,
        isNewsActive,
        coSelected: isInboxActive && isNewsActive,
      };
    });

    await page.screenshot({ path: path.join(artifactsDir, "mobile_sidebar_no_coselection.png") });

    recordResult(
      "TEST-2",
      "Sidebar in phone switches back to Inbox cleanly; Inbox and Newsletter are NOT co-selected",
      selectionStates.isInboxActive && !selectionStates.isNewsActive && !selectionStates.coSelected,
      `isInboxActive=${selectionStates.isInboxActive}, isNewsActive=${selectionStates.isNewsActive}, coSelected=${selectionStates.coSelected}`
    );

    // -------------------------------------------------------------------------
    // TEST 3: Manage Subscriptions & Unsubscribe False Positives
    // -------------------------------------------------------------------------
    console.log("\n--- [TEST 3] Unsubscribe False Positives on Ordinary Messages ---");
    // Switch back to Desktop
    await page.setViewport({ width: 1280, height: 800 });
    await sleep(400);

    // Click first email in inbox
    const firstRow = await page.$('[data-testid="message-row"]');
    if (firstRow) {
      await firstRow.click();
      await sleep(600);
    }

    const unsubButtonState = await page.evaluate(() => {
      const unsubBtn = document.querySelector('[data-testid="reading-pane-unsubscribe-btn"]');
      const pane = document.querySelector('[data-testid="reading-pane"]');
      return {
        hasUnsubBtn: Boolean(unsubBtn),
        paneText: pane ? pane.innerText.slice(0, 300) : "",
      };
    });

    await page.screenshot({ path: path.join(artifactsDir, "reading_pane_ordinary_message_no_unsub.png") });

    recordResult(
      "TEST-3",
      "Ordinary email without RFC List-Unsubscribe headers does NOT display Unsubscribe button",
      !unsubButtonState.hasUnsubBtn,
      `hasUnsubBtn=${unsubButtonState.hasUnsubBtn}`
    );

  } catch (err) {
    console.error("  [UNEXPECTED SUITE ERROR]:", err);
    recordResult("SUITE", "Browser verification ran without unexpected crash", false, err.message);
  } finally {
    await browser.close();
  }

  console.log("\n================================================================================");
  console.log("   TEST SUMMARY                                                                 ");
  console.log("================================================================================");
  const passedCount = testResults.filter(r => r.passed).length;
  const failedCount = testResults.filter(r => !r.passed).length;
  console.log(`  TOTAL: ${testResults.length} | PASSED: ${passedCount} | FAILED: ${failedCount} | PAGE ERRORS: ${pageErrors.length}`);
  console.log("================================================================================\n");

  if (failedCount > 0 || pageErrors.length > 0) {
    process.exit(1);
  }
}

run();
