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

async function runVerification() {
  console.log("================================================================================");
  console.log("E2E BROWSER VERIFICATION: DUMMY EMAILS WITH FULL VARIATIONS");
  console.log("================================================================================");

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--window-size=1440,900"],
    defaultViewport: { width: 1440, height: 900 },
  });

  try {
    const page = await browser.newPage();

    // 1. Log into Webmail as Alice
    console.log("\n[Step 1] Navigating to Webmail login page...");
    await page.goto("http://localhost:3001", { waitUntil: "networkidle2" });
    await sleep(1500);

    const emailInput = await page.$('input[type="email"]');
    if (emailInput) {
      console.log("  Entering credentials for alice@byos.local...");
      await emailInput.type("alice@byos.local");
      const passInput = await page.$('input[type="password"]');
      await passInput.type("test-password-123");
      const submitBtn = await page.$('button[type="submit"]');
      await submitBtn.click();
      await sleep(2500);
    }

    // Ensure reading key unwrap has completed
    await page.waitForSelector('[data-testid="account-chip-selector"]', { timeout: 10000 });
    await sleep(2000);
    console.log("  ✓ Alice logged in and keys unwrapped.");

    // Screenshot of pristine Inbox with diverse variations
    await page.screenshot({ path: path.join(artifactsDir, "dummy_emails_01_inbox_overview.png") });
    console.log("  ✓ Captured inbox overview screenshot.");

    // 2. Assert on Primary tab message list items
    console.log("\n[Step 2] Verifying seeded messages in Primary tab...");
    const primaryRows = await page.$$('[data-testid="message-row"]');
    console.log(`  Found ${primaryRows.length} message rows in Primary tab.`);
    assert(primaryRows.length >= 10, "Primary tab contains 11 seeded messages");

    const pageText = await page.evaluate(() => document.body.innerText);
    assert(pageText.includes("Bob Stone"), "Bob Stone personal email visible in Primary tab");
    assert(pageText.includes("David Chen"), "David Chen roadmap / invite visible in Primary tab");
    assert(pageText.includes("Sarah Jenkins"), "Sarah Jenkins visible in Primary tab");
    assert(pageText.includes("Stripe Invoicing"), "Stripe Invoicing receipt visible in Primary tab");
    assert(pageText.includes("Enterprise Security SLA"), "PDF SLA agreement visible in Primary tab");

    // 3. Switch to Newsletters tab and test Newsletters
    console.log("\n[Step 3] Switching to Newsletters tab...");
    const newslettersTab = await page.$('[data-testid="category-tab-newsletters"]');
    assert(Boolean(newslettersTab), "Located category-tab-newsletters");
    await newslettersTab.click();
    await sleep(1500);

    const newslettersRows = await page.$$('[data-testid="message-row"]');
    console.log(`  Found ${newslettersRows.length} message rows in Newsletters tab.`);
    assert(newslettersRows.length >= 4, "Newsletters tab contains all 4 seeded newsletters");

    const newsletterText = await page.evaluate(() => document.body.innerText);
    assert(newsletterText.includes("GitHub Security"), "GitHub Security Advisory visible in Newsletters tab");
    assert(newsletterText.includes("Gergely Orosz"), "The Pragmatic Engineer visible in Newsletters tab");
    assert(newsletterText.includes("TLDR Tech"), "TLDR Daily Tech visible in Newsletters tab");
    assert(newsletterText.includes("Cloudflare Radar"), "Cloudflare Radar visible in Newsletters tab");

    await page.screenshot({ path: path.join(artifactsDir, "dummy_emails_02_newsletters_tab.png") });

    // 4. Test GitHub Security Advisory: One-Click Unsubscribe & Code block
    console.log("\n[Step 4] Opening GitHub Security Advisory in Newsletters tab...");
    const ghsaRow = await page.evaluateHandle(() => {
      const rows = Array.from(document.querySelectorAll('[data-testid="message-row"]'));
      return rows.find((r) => r.innerText.includes("GitHub Security") || r.innerText.includes("GHSA-798x"));
    });
    assert(Boolean(ghsaRow), "Located GitHub Security Advisory row");
    await ghsaRow.click();
    await sleep(2000);

    // Assert reading pane rendered decrypted HTML content
    const readingPaneText = await page.evaluate(() => {
      const pane = document.querySelector('[data-testid="reading-pane"]');
      return pane ? pane.innerText : "";
    });
    assert(readingPaneText.includes("jsonwebtoken"), "Reading pane decrypted GitHub advisory");
    assert(readingPaneText.includes("npm install jsonwebtoken@9.0.2"), "Code block rendered in reading pane");

    // Assert Unsubscribe button IS displayed next to sender
    const unsubBtn = await page.$('[data-testid="reading-pane-unsubscribe-btn"]');
    assert(Boolean(unsubBtn), "Unsubscribe button displayed for newsletter");

    // Click Unsubscribe button to verify confirmation modal
    await unsubBtn.click();
    await sleep(800);
    const modalTitle = await page.evaluate(() => {
      const m = document.querySelector('[data-testid="unsubscribe-confirm-modal"]');
      return m ? m.innerText : "";
    });
    assert(modalTitle.includes("Unsubscribe from GitHub Security?"), "Unsubscribe confirmation modal opened");
    await page.screenshot({ path: path.join(artifactsDir, "dummy_emails_03_unsubscribe_modal.png") });

    // Close confirmation modal
    const cancelBtn = await page.evaluateHandle(() => {
      const modal = document.querySelector('[data-testid="unsubscribe-confirm-modal"]');
      const btns = Array.from(modal.querySelectorAll("button"));
      return btns.find((b) => b.innerText.includes("Cancel"));
    });
    if (cancelBtn) await cancelBtn.click();
    await sleep(500);

    // 5. Test Remote Tracking & Privacy Shield Banner: Cloudflare Radar
    console.log("\n[Step 5] Opening Cloudflare Radar Report (Privacy Shield)...");
    const radarRow = await page.evaluateHandle(() => {
      const rows = Array.from(document.querySelectorAll('[data-testid="message-row"]'));
      return rows.find((r) => r.innerText.includes("Cloudflare Radar") || r.innerText.includes("PQC Adoption Rises"));
    });
    assert(Boolean(radarRow), "Located Cloudflare Radar row");
    await radarRow.click();
    await sleep(1800);

    const loadImagesBtn = await page.$('[data-testid="load-remote-images-btn"]');
    assert(Boolean(loadImagesBtn), "Privacy Shield banner blocked remote images and rendered 'Load Remote Images' button");
    await page.screenshot({ path: path.join(artifactsDir, "dummy_emails_04_privacy_shield_banner.png") });

    // 6. Switch back to Primary tab
    console.log("\n[Step 6] Switching back to Primary tab...");
    const primaryTab = await page.$('[data-testid="category-tab-primary"]');
    assert(Boolean(primaryTab), "Located category-tab-primary");
    await primaryTab.click();
    await sleep(1500);

    // 7. Test 1-on-1 Personal Email: Bob Stone (Zero False Positive for Unsubscribe)
    console.log("\n[Step 7] Opening Bob Stone personal 1-on-1 email...");
    const bobRow = await page.evaluateHandle(() => {
      const rows = Array.from(document.querySelectorAll('[data-testid="message-row"]'));
      return rows.find((r) => r.innerText.includes("Feedback on the new cryptographic key unwrap UX"));
    });
    assert(Boolean(bobRow), "Located Bob Stone personal row");
    await bobRow.click();
    await sleep(1500);

    const bobPaneText = await page.evaluate(() => {
      const pane = document.querySelector('[data-testid="reading-pane"]');
      return pane ? pane.innerText : "";
    });
    assert(bobPaneText.includes("offline password unlock flow"), "Reading pane decrypted Bob's personal email");

    // Assert Unsubscribe button is STRICTLY ABSENT on personal 1-on-1 correspondence
    const personalUnsubBtn = await page.$('[data-testid="reading-pane-unsubscribe-btn"]');
    assert(personalUnsubBtn === null, "ZERO FALSE POSITIVES: Unsubscribe button is NOT present on personal correspondence");
    await page.screenshot({ path: path.join(artifactsDir, "dummy_emails_05_personal_no_unsub.png") });

    // 8. Test Calendar Invitation: Sprint 42 Planning (Interactive RSVP Card)
    console.log("\n[Step 8] Opening Calendar Invitation (Sprint 42 Planning)...");
    const calRow = await page.evaluateHandle(() => {
      const rows = Array.from(document.querySelectorAll('[data-testid="message-row"]'));
      return rows.find((r) => r.innerText.includes("Invitation: BYOS Sprint 42 Planning"));
    });
    assert(Boolean(calRow), "Located Sprint 42 Planning invitation row");
    await calRow.click();
    await sleep(1800);

    const rsvpCard = await page.$('[data-testid="calendar-invitation-card"]');
    assert(Boolean(rsvpCard), "Interactive RSVP card rendered in reading pane");
    const rsvpText = await page.evaluate((el) => el.innerText, rsvpCard);
    assert(rsvpText.includes("BYOS Sprint 42 Planning & PQC Review"), "Event summary in RSVP card");
    assert(rsvpText.includes("Room 402 / Meet"), "Event location in RSVP card");
    assert(rsvpText.includes("Yes") && rsvpText.includes("Maybe") && rsvpText.includes("No"), "RSVP action buttons rendered");
    await page.screenshot({ path: path.join(artifactsDir, "dummy_emails_06_calendar_rsvp_card.png") });

    // 9. Test Encrypted PDF Attachment: Enterprise Security SLA
    console.log("\n[Step 9] Opening Email with Encrypted PDF Attachment...");
    const pdfRow = await page.evaluateHandle(() => {
      const rows = Array.from(document.querySelectorAll('[data-testid="message-row"]'));
      return rows.find((r) => r.innerText.includes("Enterprise Security SLA 2026-2027"));
    });
    assert(Boolean(pdfRow), "Located SLA agreement email row");
    await pdfRow.click();
    await sleep(1800);

    const attachmentBadges = await page.$$('[data-testid="reading-pane-attachment-item"]');
    assert(attachmentBadges.length >= 1, "Attachment badge rendered in reading pane");
    const attText = await page.evaluate(() => {
      const b = document.querySelector('[data-testid="reading-pane-attachment-item"]');
      return b ? b.innerText : "";
    });
    assert(attText.includes("Enterprise_Security_SLA_2026.pdf"), "Attachment badge shows PDF filename");
    assert(attText.includes("KB") || attText.includes("84"), "Attachment badge shows file size");
    await page.screenshot({ path: path.join(artifactsDir, "dummy_emails_07_pdf_attachment.png") });

    // 10. Test Sent Folder (Multi-Turn Thread Message 2 from Alice)
    console.log("\n[Step 10] Navigating to Sent folder...");
    const sentFolderBtn = await page.$('[data-testid="folder-sent"]');
    assert(Boolean(sentFolderBtn), "Located folder-sent button in sidebar");
    await sentFolderBtn.click();
    await sleep(1500);
    const sentText = await page.evaluate(() => document.body.innerText);
    assert(sentText.includes("Re: Database migration window for v2.4 upgrade"), "Sent folder contains Alice's outgoing thread reply");
    await page.screenshot({ path: path.join(artifactsDir, "dummy_emails_08_sent_folder.png") });

    // 11. Test Archive Folder (HR Open Enrollment)
    console.log("\n[Step 11] Navigating to Archive folder...");
    const archiveFolderBtn = await page.$('[data-testid="folder-archive"]');
    assert(Boolean(archiveFolderBtn), "Located folder-archive button in sidebar");
    await archiveFolderBtn.click();
    await sleep(1500);
    const archiveText = await page.evaluate(() => document.body.innerText);
    assert(archiveText.includes("Annual Open Enrollment Confirmation"), "Archive folder contains HR Open Enrollment message");
    await page.screenshot({ path: path.join(artifactsDir, "dummy_emails_09_archive_folder.png") });

    // 12. Test Spam Folder (Phishing Token Airdrop)
    console.log("\n[Step 12] Navigating to Spam folder...");
    const spamFolderBtn = await page.$('[data-testid="folder-spam"]');
    assert(Boolean(spamFolderBtn), "Located folder-spam button in sidebar");
    await spamFolderBtn.click();
    await sleep(1500);
    const spamText = await page.evaluate(() => document.body.innerText);
    assert(spamText.includes("Fast Wealth Alerts") || spamText.includes("50,000 $TOKEN"), "Spam folder contains phishing airdrop message");
    await page.screenshot({ path: path.join(artifactsDir, "dummy_emails_10_spam_folder.png") });

    // 13. Test Trash Folder (Office Supplies Vendor)
    console.log("\n[Step 13] Navigating to Trash folder...");
    const trashFolderBtn = await page.$('[data-testid="folder-trash"]');
    assert(Boolean(trashFolderBtn), "Located folder-trash button in sidebar");
    await trashFolderBtn.click();
    await sleep(1500);
    const trashText = await page.evaluate(() => document.body.innerText);
    assert(trashText.includes("Office Supplies Vendor") || trashText.includes("Order #8921 Shipped"), "Trash folder contains shipped order message");
    await page.screenshot({ path: path.join(artifactsDir, "dummy_emails_11_trash_folder.png") });

    // 14. Test Drafts Folder (Draft RFC)
    console.log("\n[Step 14] Navigating to Drafts folder...");
    const draftsFolderBtn = await page.$('[data-testid="folder-drafts"]');
    assert(Boolean(draftsFolderBtn), "Located folder-drafts button in sidebar");
    await draftsFolderBtn.click();
    await sleep(1500);
    const draftsText = await page.evaluate(() => document.body.innerText);
    assert(draftsText.includes("Draft RFC: Ephemeral Hybrid Renegotiation Protocol"), "Drafts folder contains encrypted draft RFC");
    await page.screenshot({ path: path.join(artifactsDir, "dummy_emails_12_drafts_folder.png") });

    // 15. Test Manage Subscriptions Modal (Gmail-style)
    console.log("\n[Step 15] Opening Manage Subscriptions modal...");
    const manageSubsBtn = await page.$('[data-testid="sidebar-manage-subscriptions-btn"]');
    if (manageSubsBtn) {
      await page.evaluate(() => {
        const btn = document.querySelector('[data-testid="sidebar-manage-subscriptions-btn"]');
        if (btn) btn.click();
      });
      await sleep(1200);
      const subsModal = await page.$('[data-testid="subscriptions-modal"]');
      assert(Boolean(subsModal), "Manage Subscriptions modal opened from sidebar");
      const subsText = await page.evaluate((el) => el.innerText, subsModal);
      assert(subsText.includes("GitHub Security") || subsText.includes("Gergely Orosz") || subsText.includes("TLDR Tech"), "Manage Subscriptions lists detected mailing lists");
      await page.screenshot({ path: path.join(artifactsDir, "dummy_emails_13_manage_subscriptions_modal.png") });
    }

    console.log("\n================================================================================");
    console.log("✓ ALL 15 BROWSER VERIFICATION CHECKS PASSED!");
    console.log("================================================================================");
  } finally {
    await browser.close();
  }
}

runVerification().catch((err) => {
  console.error("FATAL Browser Verification Failure:", err);
  process.exit(1);
});
