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

async function run() {
  console.log("================================================================================");
  console.log("   BYOS: INBOX PILL ON LOAD, CALENDAR SCROLLBARS, NOTES LABELS & SIGNOUT AUDIT  ");
  console.log("================================================================================\n");

  const uncaughtErrors = [];
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ['--no-sandbox', '--disable-gpu'],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    page.on('pageerror', (err) => {
      console.error(`  [PAGE ERROR]: ${err.message}`);
      uncaughtErrors.push(err.message);
    });

    page.on('console', (msg) => {
      console.log(`  [BROWSER CONSOLE] ${msg.text()}`);
    });

    console.log("--- [STEP 1] Login as alice@byos.local ---");
    await page.goto('http://127.0.0.1:3001', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(600);

    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.type('input[type="email"]', 'alice@byos.local');
    await page.type('input[type="password"]', 'test-password-123');
    await page.click('button[type="submit"]');

    await page.waitForSelector('[data-testid="main-content"]', { timeout: 15000 });
    console.log("  Logged into Webmail successfully.");
    await sleep(800);

    console.log("\n--- [STEP 2] Verify Inbox Selection Pill on Initial Load ---");
    // Ensure inbox is the active folder
    await page.waitForSelector('[data-testid="sidebar"]', { timeout: 5000 });

    const pillStatus = await page.evaluate(() => {
      const sidebar = document.querySelector('[data-testid="sidebar"]');
      if (!sidebar) return { found: false, error: "sidebar not found" };

      // Look for the absolute positioned sliding pill
      const pill = sidebar.querySelector('[data-testid="sidebar-folder-pill"]');
      if (!pill) return { found: false, error: "pill element not found" };

      const computed = window.getComputedStyle(pill);
      const inboxBtn = sidebar.querySelector('[data-testid="nav-folder-inbox"]') ||
                       sidebar.querySelector('[data-testid="nav-folder-unified_inbox"]');

      const pillRect = pill.getBoundingClientRect();
      const inboxRect = inboxBtn ? inboxBtn.getBoundingClientRect() : null;

      return {
        found: true,
        opacity: computed.opacity,
        height: pillRect.height,
        width: pillRect.width,
        top: pillRect.top,
        inboxTop: inboxRect ? inboxRect.top : null,
        inboxHeight: inboxRect ? inboxRect.height : null,
      };
    });

    console.log("  Pill status on load:", JSON.stringify(pillStatus, null, 2));
    assert(pillStatus.found, "Sliding pill element is found in sidebar");
    assert(parseFloat(pillStatus.opacity) >= 0.8, `Pill opacity is visible (got ${pillStatus.opacity})`);
    assert(pillStatus.height > 20, `Pill has positive height (${pillStatus.height}px)`);
    if (pillStatus.inboxTop !== null) {
      const diff = Math.abs(pillStatus.top - pillStatus.inboxTop);
      assert(diff <= 5, `Pill vertically aligns with Inbox button (diff: ${diff}px)`);
    }

    await page.screenshot({ path: path.join(artifactsDir, 'initial_inbox_pill_selection.png') });
    console.log("  Saved screenshot: initial_inbox_pill_selection.png");

    console.log("\n--- [STEP 3] Verify Mailbox Sidebar Unified Capsule Pill [Contacts | Settings | Sign out] ---");
    const mailCapsule = await page.$('[data-testid="sidebar"] .rounded-full.border');
    assert(mailCapsule !== null, "Unified capsule pill container is present in Mailbox sidebar");

    const mailContactsBtn = await page.$('[data-testid="sidebar"] [data-testid="sidebar-contacts-btn"]');
    assert(mailContactsBtn !== null, "Contacts button is present inside Mailbox capsule");
    const mailContactsText = await page.$eval('[data-testid="sidebar"] [data-testid="sidebar-contacts-btn"]', (el) => el.textContent.trim());
    assert(mailContactsText === "Contacts", `Contacts button text is 'Contacts' (got '${mailContactsText}')`);

    const mailSettingsBtn = await page.$('[data-testid="sidebar"] [data-testid="sidebar-settings-btn"]');
    assert(mailSettingsBtn !== null, "Settings button is present inside Mailbox capsule");
    const mailSettingsText = await page.$eval('[data-testid="sidebar"] [data-testid="sidebar-settings-btn"]', (el) => el.textContent.trim());
    assert(mailSettingsText === "Settings", `Settings button text is 'Settings' (got '${mailSettingsText}')`);

    const mailSignoutBtn = await page.$('[data-testid="sidebar"] [data-testid="sidebar-signout-btn"]');
    assert(mailSignoutBtn !== null, "Sign-out button is present inside Mailbox capsule");
    const mailSignoutText = await page.$eval('[data-testid="sidebar"] [data-testid="sidebar-signout-btn"]', (el) => el.textContent.trim());
    assert(mailSignoutText === "Sign out", `Sign-out button text is 'Sign out' (got '${mailSignoutText}')`);

    // Verify at rest: text is in sr-only (no visible inline text next to the icon)
    const restVisibility = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="sidebar"] [data-testid="sidebar-contacts-btn"]');
      const srSpan = btn ? btn.querySelector('.sr-only') : null;
      return {
        hasSrOnly: Boolean(srSpan),
        srDisplay: srSpan ? window.getComputedStyle(srSpan).position : null,
      };
    });
    assert(restVisibility.hasSrOnly && restVisibility.srDisplay === "absolute", "Text is visually hidden at rest using sr-only");

    await page.screenshot({ path: path.join(artifactsDir, 'sidebar_bottom_capsule_pill.png') });
    console.log("  Saved screenshot: sidebar_bottom_capsule_pill.png");

    // Hover over Contacts button and verify custom tooltip appears
    await page.hover('[data-testid="sidebar"] [data-testid="sidebar-contacts-btn"]');
    await sleep(250);

    const tooltipStatus = await page.evaluate(() => {
      const container = document.querySelector('[data-testid="sidebar"] [data-testid="sidebar-contacts-btn"]')?.closest('.group');
      const tooltip = container ? container.querySelector('[role="tooltip"]') : null;
      if (!tooltip) return { found: false };
      const style = window.getComputedStyle(tooltip);
      return {
        found: true,
        text: tooltip.textContent.trim(),
        opacity: parseFloat(style.opacity),
        display: style.display,
      };
    });
    console.log("  Contacts tooltip on hover:", tooltipStatus);
    assert(tooltipStatus.found, "Contacts tooltip element exists");
    assert(tooltipStatus.opacity > 0.5, `Contacts tooltip becomes visible on hover (opacity: ${tooltipStatus.opacity})`);
    assert(tooltipStatus.text === "Contacts", `Contacts tooltip displays 'Contacts' (got '${tooltipStatus.text}')`);

    await page.screenshot({ path: path.join(artifactsDir, 'sidebar_capsule_tooltip_hover.png') });
    console.log("  Saved screenshot: sidebar_capsule_tooltip_hover.png");

    console.log("\n--- [STEP 4] Verify Calendar View Scrollbars & Unified Capsule Pill ---");
    await page.click('[data-testid="nav-calendar-tab"]');
    await sleep(700);

    await page.waitForSelector('[data-testid="calendar-sidebar"]', { timeout: 5000 });
    const calCapsule = await page.$('[data-testid="calendar-sidebar"] .rounded-full.border');
    assert(calCapsule !== null, "Unified capsule pill container is present in Calendar sidebar");

    const calContactsBtn = await page.$('[data-testid="calendar-sidebar"] [data-testid="sidebar-contacts-btn"]');
    assert(calContactsBtn !== null, "Contacts button is present in Calendar capsule");
    const calSettingsBtn = await page.$('[data-testid="calendar-sidebar"] [data-testid="sidebar-settings-btn"]');
    assert(calSettingsBtn !== null, "Settings button is present in Calendar capsule");
    const calSignoutBtn = await page.$('[data-testid="calendar-sidebar"] [data-testid="sidebar-signout-btn"]');
    assert(calSignoutBtn !== null, "Sign-out button is present in Calendar capsule");

    // Check custom-scrollbar class in Calendar views
    const calCustomScrollbars = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('.custom-scrollbar'));
      return elements.map((el) => ({
        tag: el.tagName,
        testId: el.getAttribute('data-testid'),
        classes: el.className,
      }));
    });
    console.log(`  Found ${calCustomScrollbars.length} elements with .custom-scrollbar in Calendar view.`);
    assert(calCustomScrollbars.length > 0, "Calendar view contains .custom-scrollbar elements");

    // Open Day view and Month view to verify scrollbars
    const dayTab = await page.$('[data-testid="cal-view-day-btn"]');
    if (dayTab) {
      await dayTab.click();
      await sleep(400);
      const dayHasScrollbar = await page.evaluate(() => {
        const grid = document.querySelector('[data-testid="day-time-grid"]');
        return grid && grid.classList.contains('custom-scrollbar');
      });
      assert(dayHasScrollbar, "Day time grid has .custom-scrollbar class");
    }

    await page.screenshot({ path: path.join(artifactsDir, 'calendar_custom_scrollbar_applied.png') });
    console.log("  Saved screenshot: calendar_custom_scrollbar_applied.png");

    console.log("\n--- [STEP 5] Switch to Notes View & Verify Unified Capsule Pill ---");
    await page.click('[data-testid="nav-notes-tab"]');
    await sleep(700);

    await page.waitForSelector('[data-testid="notes-sidebar"]', { timeout: 5000 });
    const notesCapsule = await page.$('[data-testid="notes-sidebar"] .rounded-full.border');
    assert(notesCapsule !== null, "Unified capsule pill container is present in Notes sidebar");
    const notesContactsBtn = await page.$('[data-testid="notes-sidebar"] [data-testid="sidebar-contacts-btn"]');
    assert(notesContactsBtn !== null, "Contacts button is present in Notes capsule");
    const notesSettingsBtn = await page.$('[data-testid="notes-sidebar"] [data-testid="sidebar-settings-btn"]');
    assert(notesSettingsBtn !== null, "Settings button is present in Notes capsule");
    const notesSignoutBtn = await page.$('[data-testid="notes-sidebar"] [data-testid="sidebar-signout-btn"]');
    assert(notesSignoutBtn !== null, "Sign-out button is present in Notes capsule");

    console.log("\n--- [STEP 6] Test Note Composer Label Creation & Assignment ---");
    // Click collapsed composer to expand
    await page.waitForSelector('[data-testid="notes-compose-collapsed"]', { timeout: 5000 });
    await page.click('[data-testid="notes-compose-collapsed"]');
    await sleep(400);

    await page.waitForSelector('[data-testid="notes-compose-expanded"]', { timeout: 5000 });
    await page.type('[data-testid="new-note-title-input"]', "Architecture Decisions");
    await page.type('[data-testid="new-note-content-input"]', "Documenting cryptography and UI boundary invariants.");

    // Open more menu
    await page.click('[data-testid="new-note-more-menu-btn"]');
    await sleep(200);

    await page.waitForSelector('[data-testid="compose-more-menu-popover"]', { timeout: 3000 });
    await page.click('[data-testid="menu-add-label-btn"]');
    await sleep(200);

    await page.waitForSelector('[data-testid="compose-label-input"]', { timeout: 3000 });
    console.log("  Compose label input is open.");

    // Type a new label name
    await page.type('[data-testid="compose-label-input"]', "Core Architecture");
    await sleep(200);

    await page.waitForSelector('[data-testid="compose-create-label-btn"]', { timeout: 3000 });
    await page.click('[data-testid="compose-create-label-btn"]');
    await sleep(400);

    // Verify label chip rendered on composer
    const composeChips = await page.evaluate(() => {
      const container = document.querySelector('[data-testid="notes-compose-expanded"]');
      const chips = container ? Array.from(container.querySelectorAll('span.rounded-full')) : [];
      return chips.map((c) => c.textContent.replace('×', '').trim());
    });
    console.log("  Compose label chips:", composeChips);
    assert(composeChips.includes("Core Architecture"), "Label 'Core Architecture' was created and attached to note in composer");

    // Close/Save note
    await page.click('[data-testid="new-note-save-btn"]');
    await sleep(500);

    // Verify note card rendered with the label
    const cardLabels = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[data-testid^="note-card-"]'));
      for (const card of cards) {
        if (card.textContent.includes("Architecture Decisions")) {
          const chips = Array.from(card.querySelectorAll('span.rounded-full'));
          return {
            title: "Architecture Decisions",
            labels: chips.map((c) => c.textContent.trim()),
          };
        }
      }
      return null;
    });

    console.log("  Saved note card details:", JSON.stringify(cardLabels, null, 2));
    assert(cardLabels !== null, "Note card 'Architecture Decisions' exists");
    assert(
      cardLabels.labels.some((l) => l.includes("Core Architecture")),
      "Note card displays 'Core Architecture' label chip"
    );

    await page.screenshot({ path: path.join(artifactsDir, 'notes_composer_label_created.png') });
    console.log("  Saved screenshot: notes_composer_label_created.png");

    console.log("\n--- [STEP 7] Test Note Edit Modal Label Popover ---");
    // Click the specific "Architecture Decisions" note card to open edit modal
    const cards = await page.$$('[data-testid^="note-card-"]');
    let targetCard = null;
    for (const card of cards) {
      const text = await card.evaluate((el) => el.textContent);
      if (text.includes("Architecture Decisions")) {
        targetCard = card;
        break;
      }
    }
    assert(targetCard !== null, "Found 'Architecture Decisions' note card to click");
    await targetCard.click();
    await sleep(500);

    await page.waitForSelector('[data-testid="edit-note-modal"]', { timeout: 5000 });
    await page.waitForSelector('[data-testid="edit-note-label-btn"]', { timeout: 5000 });

    // Open label menu in Edit modal
    await page.click('[data-testid="edit-note-label-btn"]');
    await sleep(300);

    await page.waitForSelector('[data-testid="edit-label-input"]', { timeout: 3000 });
    await page.type('[data-testid="edit-label-input"]', "Reviewed");
    await sleep(200);

    await page.waitForSelector('[data-testid="edit-create-label-btn"]', { timeout: 3000 });
    await page.click('[data-testid="edit-create-label-btn"]');
    await sleep(300);

    // Verify "Reviewed" is added to edit modal chips
    const editModalChips = await page.evaluate(() => {
      const container = document.querySelector('[data-testid="edit-note-labels-list"]');
      if (!container) return [];
      const chips = Array.from(container.querySelectorAll('span.rounded-full'));
      return chips.map((c) => c.textContent.replace('×', '').trim());
    });

    console.log("  Edit modal label chips:", editModalChips);
    assert(editModalChips.includes("Reviewed"), "Label 'Reviewed' added to edit modal chips list");

    // Close edit modal
    await page.click('[data-testid="edit-note-save-btn"]');
    await sleep(500);

    // Verify note card now displays both labels
    const updatedCardLabels = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[data-testid^="note-card-"]'));
      for (const card of cards) {
        if (card.textContent.includes("Architecture Decisions")) {
          const chips = Array.from(card.querySelectorAll('span.rounded-full'));
          return chips.map((c) => c.textContent.trim());
        }
      }
      return [];
    });
    console.log("  Updated card labels:", updatedCardLabels);
    assert(
      updatedCardLabels.some((l) => l.includes("Core Architecture")) &&
      updatedCardLabels.some((l) => l.includes("Reviewed")),
      "Note card now has both 'Core Architecture' and 'Reviewed' labels"
    );

    await page.screenshot({ path: path.join(artifactsDir, 'notes_edit_modal_label_created.png') });
    console.log("  Saved screenshot: notes_edit_modal_label_created.png");

    console.log("\n================================================================================");
    console.log("   ALL AUDIT CHECKS PASSED WITH RAW VERIFICATION EVIDENCE                      ");
    console.log("================================================================================\n");

  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
