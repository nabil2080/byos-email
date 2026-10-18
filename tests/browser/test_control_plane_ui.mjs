import puppeteer from '../../apps/webmail/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const artifactsDir = path.resolve(__dirname, 'artifacts');

if (!fs.existsSync(artifactsDir)) {
  fs.mkdirSync(artifactsDir, { recursive: true });
}

function flushRateLimits() {
  try {
    execSync('docker exec byos-redis redis-cli FLUSHALL', { stdio: 'ignore' });
  } catch {}
}

function ensureAliceReady() {
  try {
    // Mark Alice org complete and tour completed so we test the full operational dashboard shell without interrupting popovers
    execSync(`docker exec byos-postgres psql -U byos -d byos -c "UPDATE organizations SET onboarding_completed_at = now(), onboarding_skipped = false WHERE id = '00000000-0000-0000-0000-000000000aaa';"`, { stdio: 'ignore' });
    execSync(`docker exec byos-postgres psql -U byos -d byos -c "UPDATE users SET tours_seen = '{\\"control_plane_v1\\": {\\"last_step\\": 7, \\"completed_at\\": \\"2026-01-01T00:00:00Z\\"}}'::jsonb WHERE email = 'alice@byos.local';"`, { stdio: 'ignore' });
  } catch (err) {
    console.warn("Could not set Alice org state:", err.message);
  }
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

async function runControlPlaneUISuite() {
  console.log("================================================================================");
  console.log("             CONTROL PANEL GLOBAL UI, HEADER & SEARCH BROWSER SUITE               ");
  console.log("================================================================================\n");

  flushRateLimits();
  ensureAliceReady();

  const cpUrl = "http://localhost:3000";
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ['--no-sandbox', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    // Login as Alice
    console.log("1. Authenticating as Alice (Owner)...");
    await page.goto(`${cpUrl}/login`, { waitUntil: 'networkidle0', timeout: 15000 });
    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.type('input[type="email"]', 'alice@byos.local');
    await page.type('input[type="password"]', 'test-password-123');
    await page.click('button[type="submit"]');

    await page.waitForFunction(() => window.location.pathname === '/dashboard', { timeout: 15000 });
    await sleep(800);
    console.log("  Successfully logged into /dashboard.");

    // -------------------------------------------------------------------------
    // 2. Desktop Expanded Sidebar & Brand Header
    // -------------------------------------------------------------------------
    console.log("\n2. Verifying Desktop Expanded Sidebar...");
    const sidebar = await page.$('[data-testid="sidebar"]');
    assert(!!sidebar, "Sidebar element exists with data-testid='sidebar'");

    const sidebarBox = await sidebar.boundingBox();
    console.log(`  Sidebar width: ${sidebarBox.width}px`);
    assert(Math.round(sidebarBox.width) === 256, `Expanded sidebar width is 256px (got: ${sidebarBox.width}px)`);

    const brandText = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="sidebar"]');
      return el ? el.innerText : '';
    });
    assert(brandText.includes("BYOS"), "Sidebar displays BYOS brand badge");
    assert(brandText.includes("Control Panel"), "Sidebar displays 'Control Panel' label");
    assert(brandText.includes("Self-Sovereign") || brandText.includes("SELF-SOVEREIGN"), "Sidebar displays Self-Sovereign tag");
    assert(brandText.includes("alice@byos.local"), "Sidebar footer displays authenticated user email");
    assert(brandText.includes("Seat"), "Sidebar footer displays seat allocation");

    // Capture control-panel-desktop-expanded.png
    await page.screenshot({ path: path.join(artifactsDir, 'control-panel-desktop-expanded.png') });
    console.log("  Saved screenshot: control-panel-desktop-expanded.png");

    // -------------------------------------------------------------------------
    // 3. Desktop Sidebar Collapse & Persistence
    // -------------------------------------------------------------------------
    console.log("\n3. Testing Sidebar Collapse and LocalStorage Persistence...");
    const collapseToggle = await page.waitForSelector('[data-testid="sidebar-collapse-toggle"]', { timeout: 5000 });
    assert(!!collapseToggle, "Header contains sidebar collapse toggle button");

    await collapseToggle.click();
    await sleep(350);

    const collapsedBox = await sidebar.boundingBox();
    console.log(`  Collapsed sidebar width: ${collapsedBox.width}px`);
    assert(Math.round(collapsedBox.width) === 72, `Collapsed sidebar width is 72px (got: ${collapsedBox.width}px)`);

    const persistedPref = await page.evaluate(() => localStorage.getItem("byos_cp_sidebar_collapsed"));
    assert(persistedPref === "true", "byos_cp_sidebar_collapsed persisted as 'true' in localStorage");

    // Capture control-panel-desktop-collapsed.png
    await page.screenshot({ path: path.join(artifactsDir, 'control-panel-desktop-collapsed.png') });
    console.log("  Saved screenshot: control-panel-desktop-collapsed.png");

    // Reload page and assert persistence
    console.log("  Reloading page to test collapse persistence...");
    await page.reload({ waitUntil: 'networkidle0' });
    await sleep(500);

    const reloadedBox = await page.$eval('[data-testid="sidebar"]', (el) => el.getBoundingClientRect().width);
    assert(Math.round(reloadedBox) === 72, `Sidebar remains collapsed after page reload (got: ${reloadedBox}px)`);

    // Expand sidebar again
    const expandToggle = await page.waitForSelector('[data-testid="sidebar-collapse-toggle"]');
    await expandToggle.click();
    await sleep(350);
    const restoredBox = await page.$eval('[data-testid="sidebar"]', (el) => el.getBoundingClientRect().width);
    assert(Math.round(restoredBox) === 256, `Sidebar restored to 256px on re-toggle (got: ${restoredBox}px)`);

    // -------------------------------------------------------------------------
    // 4. Navigation Links & Dynamic Breadcrumbs
    // -------------------------------------------------------------------------
    console.log("\n4. Verifying Navigation Links & Dynamic Route Breadcrumbs...");
    const navChecks = [
      { testId: "nav-overview", href: "/dashboard", expectedCurrent: "Overview" },
      { testId: "nav-domains", href: "/dashboard/domains", expectedCurrent: "Domains" },
      { testId: "nav-mailboxes", href: "/dashboard/mailboxes", expectedCurrent: "Mailboxes" },
      { testId: "nav-members", href: "/dashboard/members", expectedCurrent: "Team & Access" },
      { testId: "nav-storage", href: "/dashboard/storage", expectedCurrent: "Storage" },
      { testId: "nav-billing", href: "/dashboard/billing", expectedCurrent: "Billing" },
      { testId: "nav-settings", href: "/dashboard/settings", expectedCurrent: "Settings" },
    ];

    for (const item of navChecks) {
      const link = await page.waitForSelector(`[data-testid="${item.testId}"]`);
      await link.click();
      await page.waitForFunction((expectedHref) => window.location.pathname === expectedHref, {}, item.href);
      await sleep(300);

      const breadcrumbText = await page.$eval('[data-testid="header-breadcrumbs"]', (el) => el.innerText.trim());
      assert(
        breadcrumbText.includes(item.expectedCurrent),
        `Breadcrumb for ${item.href} displays '${item.expectedCurrent}' (got: '${breadcrumbText}')`
      );

      // Verify active navigation styling
      const isActive = await page.$eval(`[data-testid="${item.testId}"]`, (el) =>
        el.getAttribute("aria-current") === "page" && el.className.includes("text-white")
      );
      assert(isActive, `Navigation item [data-testid="${item.testId}"] has active styling`);
    }

    // -------------------------------------------------------------------------
    // 5. Global Search Command Palette (Ctrl+K, Categories, Keyboard Nav)
    // -------------------------------------------------------------------------
    console.log("\n5. Testing Global Search Command Palette...");

    // 5.1 Keyboard shortcut Ctrl+K
    console.log("  Testing Ctrl+K shortcut to open search modal...");
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyK');
    await page.keyboard.up('Control');
    await page.waitForSelector('[data-testid="global-search-modal"]', { timeout: 5000 });
    assert(true, "Global search command palette opened via Ctrl+K shortcut");

    // 5.2 Close with Escape
    console.log("  Testing Escape key to dismiss search modal...");
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('[data-testid="global-search-modal"]'), { timeout: 4000 });
    assert(true, "Global search command palette closed via Escape key");

    // 5.3 Click search trigger in header
    console.log("  Opening search via header trigger button...");
    const searchTrigger = await page.waitForSelector('[data-testid="header-search-trigger"]');
    await searchTrigger.click();
    await page.waitForSelector('[data-testid="global-search-modal"]', { timeout: 5000 });
    assert(true, "Global search command palette opened via header search trigger button");

    // 5.4 Empty query displays suggested destinations
    await sleep(200);
    const modalText = await page.$eval('[data-testid="global-search-modal"]', (el) => el.innerText);
    assert(modalText.toUpperCase().includes("SUGGESTED DESTINATIONS"), "Search displays 'Suggested Destinations' when query is empty");

    // 5.5 Type query 'alice' and assert live search results across categories
    console.log("  Typing search query 'alice'...");
    const searchInput = await page.waitForSelector('[data-testid="global-search-input"]');
    await searchInput.type('alice');
    await sleep(800); // Allow debounce and API response

    // Capture control-panel-global-search.png
    await page.screenshot({ path: path.join(artifactsDir, 'control-panel-global-search.png') });
    console.log("  Saved screenshot: control-panel-global-search.png");

    const searchResultsText = await page.$eval('[data-testid="global-search-modal"]', (el) => el.innerText);
    console.log("  Search results text for 'alice':", searchResultsText.replace(/\n/g, ' '));
    assert(searchResultsText.toUpperCase().includes("MAILBOXES") || searchResultsText.includes("alice@"), "Search returned matching mailboxes for 'alice'");
    assert(searchResultsText.toUpperCase().includes("TEAM & MEMBERS") || searchResultsText.includes("alice@byos.local"), "Search returned matching members for 'alice'");

    // 5.6 Keyboard navigation with ArrowDown and Enter
    console.log("  Testing ArrowDown keyboard navigation...");
    await page.keyboard.press('ArrowDown');
    await sleep(200);

    // 5.7 Clear query and type non-existent string to test empty state
    console.log("  Testing non-existent search query empty state...");
    await page.evaluate(() => {
      const input = document.querySelector('[data-testid="global-search-input"]');
      if (input) {
        input.value = "";
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await sleep(200);
    await searchInput.type('xyznonexistent999');
    await sleep(600);

    const noResultsElem = await page.waitForSelector('[data-testid="search-no-results"]', { timeout: 4000 });
    assert(!!noResultsElem, "Search displays clean no-results state for non-existent query");

    // 5.8 Navigation via search result
    console.log("  Testing search navigation selection...");
    await page.evaluate(() => {
      const input = document.querySelector('[data-testid="global-search-input"]');
      if (input) {
        input.value = "";
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await sleep(200);
    await searchInput.type('domains');
    await sleep(600);

    const domainNavResult = await page.waitForSelector('[data-testid="search-result-nav-domains"]', { timeout: 5000 });
    assert(!!domainNavResult, "Search returned navigation destination item for 'domains'");
    await domainNavResult.click();
    await sleep(500);

    assert(page.url().includes('/dashboard/domains'), "Selecting search item navigated to /dashboard/domains");
    const modalClosed = await page.evaluate(() => !document.querySelector('[data-testid="global-search-modal"]'));
    assert(modalClosed, "Search modal closed automatically after selecting item");

    // -------------------------------------------------------------------------
    // 6. Responsive Mobile Navigation & Search (375px Viewport)
    // -------------------------------------------------------------------------
    console.log("\n6. Testing Responsive Mobile Behavior (375px Viewport)...");
    await page.setViewport({ width: 375, height: 667 });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await sleep(500);

    // Desktop sidebar should be hidden
    const desktopSidebarHidden = await page.$eval('[data-testid="sidebar"]', (el) => window.getComputedStyle(el).display === 'none');
    assert(desktopSidebarHidden, "Desktop sidebar is hidden at 375px mobile viewport");

    // Mobile nav toggle (hamburger) should be visible
    const mobileToggle = await page.waitForSelector('[data-testid="mobile-nav-toggle"]', { timeout: 4000 });
    assert(!!mobileToggle, "Mobile navigation hamburger toggle is visible at 375px");

    // Open mobile drawer
    console.log("  Opening mobile navigation drawer...");
    await mobileToggle.click();
    await page.waitForSelector('[data-testid="mobile-nav-drawer"]', { timeout: 4000 });
    assert(true, "Mobile navigation drawer opened successfully");

    // Capture control-panel-mobile-navigation.png
    await page.screenshot({ path: path.join(artifactsDir, 'control-panel-mobile-navigation.png') });
    console.log("  Saved screenshot: control-panel-mobile-navigation.png");

    // Close mobile drawer
    const closeMobileBtn = await page.waitForSelector('[data-testid="close-mobile-nav"]');
    await closeMobileBtn.click();
    await sleep(400);
    const mobileDrawerClosed = await page.evaluate(() => !document.querySelector('[data-testid="mobile-nav-drawer"]'));
    assert(mobileDrawerClosed, "Mobile navigation drawer closed cleanly");

    // Test search at 375px
    console.log("  Opening global search on mobile viewport...");
    const mobileSearchTrigger = await page.waitForSelector('[data-testid="header-search-trigger"]');
    await mobileSearchTrigger.click();
    await page.waitForSelector('[data-testid="global-search-modal"]', { timeout: 4000 });

    const mobileSearchBox = await page.$eval('[data-testid="global-search-modal"] > div:nth-child(2)', (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, width: r.width };
    });
    console.log(`  Mobile search modal bounds: ${JSON.stringify(mobileSearchBox)}`);
    assert(mobileSearchBox.left >= 0, "Mobile search modal left >= 0");
    assert(mobileSearchBox.right <= 375, "Mobile search modal right <= 375px viewport");

    const mobileDocOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    assert(!mobileDocOverflow, "No horizontal document overflow on mobile viewport with search open");

    // Capture control-panel-mobile-search.png
    await page.screenshot({ path: path.join(artifactsDir, 'control-panel-mobile-search.png') });
    console.log("  Saved screenshot: control-panel-mobile-search.png");

    // Close search
    await page.keyboard.press('Escape');
    await sleep(400);

    // -------------------------------------------------------------------------
    // 7. Header User Avatar & Webmail Link
    // -------------------------------------------------------------------------
    console.log("\n7. Verifying Header User Avatar Menu & Webmail Link...");
    await page.setViewport({ width: 1280, height: 900 });
    await page.evaluate(() => window.dispatchEvent(new Event('resize')));
    await sleep(400);

    const webmailLink = await page.$('[data-testid="header-webmail-link"]');
    assert(!!webmailLink, "Header contains Webmail shortcut link");

    const avatarBtn = await page.waitForSelector('[data-testid="header-user-avatar"]');
    await avatarBtn.click();
    await page.waitForSelector('[data-testid="header-account-dropdown"]', { timeout: 3000 });
    assert(true, "Clicking user avatar opened account dropdown menu");

    const dropdownText = await page.$eval('[data-testid="header-account-dropdown"]', (el) => el.innerText);
    assert(dropdownText.includes("alice@byos.local"), "Account dropdown displays user email");
    assert(dropdownText.includes("Sign out"), "Account dropdown provides Sign out action");

    console.log("\n================================================================================");
    console.log("             ALL CONTROL PANEL UI & SEARCH ASSERTIONS PASSED                      ");
    console.log("================================================================================\n");

  } finally {
    await browser.close();
  }
}

runControlPlaneUISuite().catch((err) => {
  console.error("\nFATAL TEST ERROR:", err);
  process.exit(1);
});
