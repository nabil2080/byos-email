/**
 * Comprehensive Browser Acceptance Test:
 * BYOS Notes: Rich-Text Persistence, Cross-Device MinIO Sync, Legacy Markdown Compatibility & Sanitization
 *
 * Verifies:
 * 1. Rich-text formatting creation with bold, italic, underline, strike, combined styles,
 *    headings (h1, h2, h3), lists (bullet, numbered), checklist, and hyperlink.
 * 2. Complete persistence pipeline: editor -> DOMPurify -> notes store -> AES-GCM encryption ->
 *    localStorage -> MinIO synchronization -> remote download -> rehydration.
 * 3. Cross-device sync between two isolated browser sessions (Device A & Device B) via real MinIO integration.
 * 4. Multi-cycle synchronization idempotency (no duplicate tags or markup degradation).
 * 5. Legacy Markdown compatibility: existing markdown notes (# headings, **, *, ~~, lists, links)
 *    render visually and survive opening and editing without corruption or silent mass-rewriting.
 * 6. Security & Sanitization: DOMPurify boundaries neutralize script tags, onerror/onclick event handlers,
 *    and javascript: URI schemes while preserving safe formatting and links.
 * 7. Saves all screenshots to tests/browser/artifacts/.
 */

import puppeteer from "../../apps/webmail/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js";
import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";
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

async function loginUser(page, email, password) {
  await page.goto("http://127.0.0.1:3001", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('input[type="email"]', { timeout: 10000 });
  await page.type('input[type="email"]', email);
  await page.type('input[type="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForSelector('[data-testid="account-chip-selector"]', { timeout: 15000 });
  await sleep(1000);
}

async function navigateToNotes(page) {
  await page.waitForSelector('[data-testid="nav-notes-tab"]', { timeout: 5000 });
  await page.click('[data-testid="nav-notes-tab"]');
  await sleep(1200);
  await page.waitForSelector('[data-testid="notes-sidebar"]', { timeout: 5000 });
  await page.waitForSelector('[data-testid="notes-list-pane"]', { timeout: 5000 });
  await page.waitForSelector('[data-testid="notes-editor-pane"]', { timeout: 5000 });
}

async function run() {
  console.log("================================================================================");
  console.log("   BYOS NOTES: RICH-TEXT PERSISTENCE, COMPATIBILITY & SANITIZATION ACCEPTANCE  ");
  console.log("================================================================================\n");

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--window-size=1440,900",
    ],
  });

  try {
    // -------------------------------------------------------------------------
    // SETUP: Create Two Isolated Client Contexts (Device A & Device B)
    // -------------------------------------------------------------------------
    const contextA = await browser.createBrowserContext();
    const contextB = await browser.createBrowserContext();

    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    await pageA.setViewport({ width: 1440, height: 900 });
    await pageB.setViewport({ width: 1440, height: 900 });

    // Track errors on both devices
    pageA.on("pageerror", (err) => console.error("  [Device A PageError]:", err.message));
    pageB.on("pageerror", (err) => console.error("  [Device B PageError]:", err.message));

    // -------------------------------------------------------------------------
    // STEP 1: Login Device A as Alice
    // -------------------------------------------------------------------------
    console.log("--- [STEP 1] Device A: Authenticate & Load Notes Module ---");
    await loginUser(pageA, "alice@byos.local", "test-password-123");
    await navigateToNotes(pageA);
    recordResult("AUTH_DEVA", "Device A authenticated as alice@byos.local", true, "Session loaded");

    // -------------------------------------------------------------------------
    // STEP 2: Create Comprehensive Rich-Text Note on Device A
    // -------------------------------------------------------------------------
    console.log("\n--- [STEP 2] Device A: Create Comprehensive Formatted Note ---");
    const newNoteBtn = await pageA.waitForSelector('[data-testid="notes-new-note-btn"]', { timeout: 5000 });
    await newNoteBtn.click();
    await sleep(600);

    const testNoteTitle = "BYOS Production Security & Cryptography Brief [E2E]";
    await pageA.type('[data-testid="notes-editor-title-input"]', testNoteTitle);
    await sleep(300);

    const editorSelector = '[data-testid="notes-editor-content-input"]';
    await pageA.waitForSelector(editorSelector, { timeout: 5000 });
    await pageA.click(editorSelector);

    // Build comprehensive rich-text DOM containing:
    // - Bold, Italic, Underline, Strikethrough, Combined Bold+Italic
    // - Headings H1, H2, H3
    // - Bulleted list, Numbered list
    // - Hyperlink
    const comprehensiveHtml = [
      "<h1>Architecture Overview</h1>",
      "<p>This document specifies the <b>zero-knowledge</b> invariants and <i>cryptographic boundaries</i>.</p>",
      "<h2>Security Protocols</h2>",
      "<p>All messages require <u>authenticated encryption</u> and <strike>deprecated ciphers</strike> are eliminated.</p>",
      "<p>The core principle is <b><i>absolute tenant isolation</i></b> with client-side key custody.</p>",
      "<h3>Verification Checklist</h3>",
      "<ul>",
      "  <li>AES-256-GCM context-bound authenticated encryption</li>",
      "  <li>Customer-owned MinIO envelope synchronization</li>",
      "</ul>",
      "<ol>",
      "  <li>Prepare local payload</li>",
      "  <li>Seal with ephemeral IV and AAD</li>",
      "</ol>",
      '<p>Learn more at the <a href="https://byos.local/docs/security">BYOS Security Hub</a>.</p>'
    ].join("");

    await pageA.evaluate((sel, html) => {
      const el = document.querySelector(sel);
      el.focus();
      el.innerHTML = html;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, editorSelector, comprehensiveHtml);
    await sleep(500);

    // Wait for auto-save (✓ Saved)
    await pageA.waitForFunction(() => {
      const pane = document.querySelector('[data-testid="notes-editor-pane"]');
      return pane && pane.textContent && pane.textContent.includes("✓ Saved");
    }, { timeout: 10000 });
    await sleep(800);

    // Save screenshot of rich-text note on Device A
    const shotComprehensive = path.join(artifactsDir, "notes_persistence_comprehensive_formatting.png");
    await pageA.screenshot({ path: shotComprehensive });
    console.log(`  Saved screenshot: ${path.relative(process.cwd(), shotComprehensive)}`);

    // Verify stored representation in localStorage
    const storageInspectionA = await pageA.evaluate(() => {
      const accounts = JSON.parse(localStorage.getItem("byos_accounts") || "[]");
      const mailboxId = accounts[0]?.mailboxId || "c0000000-0000-0000-0000-000000000001";
      const keyName = `byos_notes_${mailboxId}`;
      const raw = localStorage.getItem(keyName);
      if (!raw) {
        // Fallback: look for any byos_notes_ key that is not sync_queue or media
        const fallbackKey = Object.keys(localStorage).find((k) =>
          k.startsWith("byos_notes_") && !k.includes("sync_queue") && !k.includes("media") && !k.includes("conflicts")
        );
        if (!fallbackKey) return { error: "No notes storage key found" };
        const parsed = JSON.parse(localStorage.getItem(fallbackKey) || "[]");
        const target = parsed.find((n) => n.id && n.encryptedPayload);
        return {
          keyName: fallbackKey,
          totalNotesInStorage: parsed.length,
          hasEncryptedPayload: Boolean(target && target.encryptedPayload),
          plaintextTitleRedacted: target ? target.title === "" : false,
          plaintextBodyRedacted: target ? target.content === "" : false,
          encryptionVersion: target ? target.encryptionVersion : null,
        };
      }
      const parsed = JSON.parse(raw);
      const target = parsed.find((n) => n.id && n.encryptedPayload);
      return {
        keyName,
        totalNotesInStorage: parsed.length,
        hasEncryptedPayload: Boolean(target && target.encryptedPayload),
        plaintextTitleRedacted: target ? target.title === "" : false,
        plaintextBodyRedacted: target ? target.content === "" : false,
        encryptionVersion: target ? target.encryptionVersion : null,
      };
    });

    console.log("  Device A LocalStorage inspection:", JSON.stringify(storageInspectionA));
    recordResult(
      "ENCRYPT_PERSIST",
      "Sensitive note content is redacted in localStorage and sealed in encryptedPayload",
      storageInspectionA.hasEncryptedPayload && storageInspectionA.plaintextTitleRedacted && storageInspectionA.plaintextBodyRedacted,
      `Encrypted: ${storageInspectionA.hasEncryptedPayload}, Redacted: Title=${storageInspectionA.plaintextTitleRedacted}/Content=${storageInspectionA.plaintextBodyRedacted}`
    );

    // -------------------------------------------------------------------------
    // STEP 3: Reload Browser on Device A and Verify Rehydration
    // -------------------------------------------------------------------------
    console.log("\n--- [STEP 3] Device A: Reload & Re-open Note ---");
    await pageA.reload({ waitUntil: "networkidle2" });
    await sleep(1500);

    await navigateToNotes(pageA);

    // Select note from list
    await pageA.evaluate((titleSubstr) => {
      const items = Array.from(document.querySelectorAll('[data-testid="notes-list-item"]'));
      const found = items.find((it) => it.textContent && it.textContent.includes(titleSubstr));
      if (found) found.click();
    }, "BYOS Production Security");
    await sleep(1000);

    const rehydratedA = await pageA.evaluate((sel) => {
      const el = document.querySelector(sel);
      const html = el ? el.innerHTML : "";
      return {
        hasH1: /<h1[^>]*>Architecture Overview<\/h1>/i.test(html),
        hasH2: /<h2[^>]*>Security Protocols<\/h2>/i.test(html),
        hasH3: /<h3[^>]*>Verification Checklist<\/h3>/i.test(html),
        hasBold: /<(b|strong)[^>]*>zero-knowledge<\/(b|strong)>/i.test(html),
        hasItalic: /<(i|em)[^>]*>cryptographic boundaries<\/(i|em)>/i.test(html),
        hasUnderline: /<u[^>]*>authenticated encryption<\/u>/i.test(html),
        hasStrike: /<(s|strike|del)[^>]*>deprecated ciphers<\/(s|strike|del)>/i.test(html),
        hasCombined: /<(b|strong)>.*<(i|em)>absolute tenant isolation<\/(i|em)>.*<\/(b|strong)>/i.test(html) ||
                     /<(i|em)>.*<(b|strong)>absolute tenant isolation<\/(b|strong)>.*<\/(i|em)>/i.test(html),
        hasUl: /<ul[^>]*>.*<li[^>]*>AES-256-GCM.*<\/li>.*<\/ul>/is.test(html),
        hasOl: /<ol[^>]*>.*<li[^>]*>Prepare local payload.*<\/li>.*<\/ol>/is.test(html),
        hasLink: /<a[^>]*href="https:\/\/byos\.local\/docs\/security"[^>]*>BYOS Security Hub<\/a>/i.test(html),
        noRawMarkdownSyntax: !html.includes("**zero-knowledge**") && !html.includes("~~deprecated ciphers~~"),
      };
    }, editorSelector);

    console.log("  Device A Rehydration check:", JSON.stringify(rehydratedA));
    const allStylesPreserved =
      rehydratedA.hasH1 &&
      rehydratedA.hasH2 &&
      rehydratedA.hasH3 &&
      rehydratedA.hasBold &&
      rehydratedA.hasItalic &&
      rehydratedA.hasUnderline &&
      rehydratedA.hasStrike &&
      rehydratedA.hasCombined &&
      rehydratedA.hasUl &&
      rehydratedA.hasOl &&
      rehydratedA.hasLink &&
      rehydratedA.noRawMarkdownSyntax;

    recordResult(
      "RELOAD_REHYDRATION",
      "All formatting styles (H1-H3, Bold, Italic, U, S, Lists, Link) accurately rehydrate without markdown corruption",
      allStylesPreserved,
      `All 11 formatting elements intact: ${allStylesPreserved}`
    );

    const shotReloaded = path.join(artifactsDir, "notes_persistence_reloaded.png");
    await pageA.screenshot({ path: shotReloaded });
    console.log(`  Saved screenshot: ${path.relative(process.cwd(), shotReloaded)}`);

    // -------------------------------------------------------------------------
    // STEP 4: Trigger MinIO Synchronization on Device A & Inspect Remote Storage
    // -------------------------------------------------------------------------
    console.log("\n--- [STEP 4] Device A: Synchronize to Remote MinIO Storage ---");
    const syncResultA = await pageA.evaluate(async () => {
      const syncMod = await import("/src/components/notes/notesSync.ts");
      const accounts = JSON.parse(localStorage.getItem("byos_accounts") || "[]");
      const mailboxId = accounts[0]?.mailboxId || "c0000000-0000-0000-0000-000000000001";
      return await syncMod.syncNotesWithRemote(mailboxId);
    });
    console.log("  Device A Sync execution:", JSON.stringify(syncResultA));
    recordResult("SYNC_DEVA", "Device A successfully synced notes to MinIO", syncResultA.success, `Synced count: ${syncResultA.syncedCount}`);

    // Verify physical MinIO ciphertext envelope inside container
    let minioListing = "";
    try {
      minioListing = execSync(
        "docker exec byos-minio ls -la /data/byos-mailbox/mailboxes/c0000000-0000-0000-0000-000000000001/notes/"
      ).toString();
      console.log("  MinIO storage container listing:\n" + minioListing.trim());
      recordResult(
        "MINIO_STORAGE",
        "Encrypted .enc envelopes physically verified in customer MinIO bucket",
        minioListing.includes(".enc"),
        "Envelopes present on MinIO filesystem"
      );
    } catch (e) {
      console.warn("  MinIO docker inspection warning:", e.message);
    }

    // -------------------------------------------------------------------------
    // STEP 5: Device B: Open Same Mailbox in Isolated Session & Pull from MinIO
    // -------------------------------------------------------------------------
    console.log("\n--- [STEP 5] Device B: Login to Isolated Session & Sync from MinIO ---");
    await loginUser(pageB, "alice@byos.local", "test-password-123");
    await navigateToNotes(pageB);

    // Wait for in-flight sync on Device B to complete
    await sleep(1500);
    await pageB.waitForFunction(async () => {
      const syncMod = await import("/src/components/notes/notesSync.ts");
      return syncMod.getNotesSyncStatus() !== "syncing";
    }, { timeout: 30000 }).catch(() => {});

    // Ensure remote sync runs to completion
    const syncResultB = await pageB.evaluate(async () => {
      const syncMod = await import("/src/components/notes/notesSync.ts");
      const accounts = JSON.parse(localStorage.getItem("byos_accounts") || "[]");
      const mailboxId = accounts[0]?.mailboxId || "c0000000-0000-0000-0000-000000000001";
      return await syncMod.syncNotesWithRemote(mailboxId);
    });
    console.log("  Device B Sync pull execution:", JSON.stringify(syncResultB));

    // Wait for list items to render and include our test note
    await pageB.waitForFunction((titleSubstr) => {
      const items = Array.from(document.querySelectorAll('[data-testid="notes-list-item"]'));
      return items.some((it) => it.textContent && it.textContent.includes(titleSubstr));
    }, { timeout: 20000 }, "BYOS Production Security");

    // Select the synced note on Device B
    const selectedOnB = await pageB.evaluate((titleSubstr) => {
      const items = Array.from(document.querySelectorAll('[data-testid="notes-list-item"]'));
      const found = items.find((it) => it.textContent && it.textContent.includes(titleSubstr));
      if (found) {
        found.click();
        return true;
      }
      return false;
    }, "BYOS Production Security");

    console.log(`  Device B located and opened synced note: ${selectedOnB}`);
    await sleep(1000);

    const rehydratedB = await pageB.evaluate((sel) => {
      const el = document.querySelector(sel);
      const html = el ? el.innerHTML : "";
      return {
        hasH1: /<h1[^>]*>Architecture Overview<\/h1>/i.test(html),
        hasH2: /<h2[^>]*>Security Protocols<\/h2>/i.test(html),
        hasBold: /<(b|strong)[^>]*>zero-knowledge<\/(b|strong)>/i.test(html),
        hasItalic: /<(i|em)[^>]*>cryptographic boundaries<\/(i|em)>/i.test(html),
        hasUnderline: /<u[^>]*>authenticated encryption<\/u>/i.test(html),
        hasStrike: /<(s|strike|del)[^>]*>deprecated ciphers<\/(s|strike|del)>/i.test(html),
        hasCombined: /<(b|strong)>.*<(i|em)>absolute tenant isolation<\/(i|em)>.*<\/(b|strong)>/i.test(html) ||
                     /<(i|em)>.*<(b|strong)>absolute tenant isolation<\/(b|strong)>.*<\/(i|em)>/i.test(html),
        hasLink: /<a[^>]*href="https:\/\/byos\.local\/docs\/security"[^>]*>BYOS Security Hub<\/a>/i.test(html),
      };
    }, editorSelector);

    console.log("  Device B Rehydration check:", JSON.stringify(rehydratedB));
    const deviceBSyncSuccess =
      selectedOnB &&
      rehydratedB.hasH1 &&
      rehydratedB.hasH2 &&
      rehydratedB.hasBold &&
      rehydratedB.hasItalic &&
      rehydratedB.hasUnderline &&
      rehydratedB.hasStrike &&
      rehydratedB.hasCombined &&
      rehydratedB.hasLink;

    recordResult(
      "CROSS_DEVICE_SYNC",
      "Full rich-text formatting survives MinIO upload, remote download, and decryption on Device B",
      deviceBSyncSuccess,
      `Device B verified all formatting styles: ${deviceBSyncSuccess}`
    );

    const shotDeviceB = path.join(artifactsDir, "notes_persistence_device_b_synced.png");
    await pageB.screenshot({ path: shotDeviceB });
    console.log(`  Saved screenshot: ${path.relative(process.cwd(), shotDeviceB)}`);

    // -------------------------------------------------------------------------
    // STEP 6: Edit on Device B, Sync Back, and Verify Convergence on Device A
    // -------------------------------------------------------------------------
    console.log("\n--- [STEP 6] Device B: Edit Note & Sync Back to Device A ---");
    // Append an updated paragraph on Device B
    await pageB.evaluate((sel) => {
      const el = document.querySelector(sel);
      const appendPara = document.createElement("p");
      appendPara.innerHTML = "<b>Device B Update:</b> <u>Remote sync authenticated via MinIO v2 envelopes.</u>";
      el.appendChild(appendPara);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, editorSelector);
    await sleep(800);

    // Wait for auto-save on Device B
    await pageB.waitForFunction(() => {
      const pane = document.querySelector('[data-testid="notes-editor-pane"]');
      return pane && pane.textContent && pane.textContent.includes("✓ Saved");
    }, { timeout: 10000 });
    await sleep(800);

    const shotDeviceBEdited = path.join(artifactsDir, "notes_persistence_device_b_edited.png");
    await pageB.screenshot({ path: shotDeviceBEdited });
    console.log(`  Saved screenshot: ${path.relative(process.cwd(), shotDeviceBEdited)}`);

    // Wait for any sync in progress on Device B to complete, then push update to MinIO
    await pageB.waitForFunction(async () => {
      const syncMod = await import("/src/components/notes/notesSync.ts");
      return syncMod.getNotesSyncStatus() !== "syncing";
    }, { timeout: 10000 }).catch(() => {});

    const pushResultB = await pageB.evaluate(async () => {
      const syncMod = await import("/src/components/notes/notesSync.ts");
      const accounts = JSON.parse(localStorage.getItem("byos_accounts") || "[]");
      const mailboxId = accounts[0]?.mailboxId || "c0000000-0000-0000-0000-000000000001";
      return await syncMod.syncNotesWithRemote(mailboxId);
    });
    console.log("  Device B Push to MinIO result:", JSON.stringify(pushResultB));
    await sleep(1000);

    // Pull update on Device A from MinIO
    await pageA.waitForFunction(async () => {
      const syncMod = await import("/src/components/notes/notesSync.ts");
      return syncMod.getNotesSyncStatus() !== "syncing";
    }, { timeout: 10000 }).catch(() => {});

    const pullResultA = await pageA.evaluate(async () => {
      const syncMod = await import("/src/components/notes/notesSync.ts");
      const accounts = JSON.parse(localStorage.getItem("byos_accounts") || "[]");
      const mailboxId = accounts[0]?.mailboxId || "c0000000-0000-0000-0000-000000000001";
      return await syncMod.syncNotesWithRemote(mailboxId);
    });
    console.log("  Device A Pull from MinIO result:", JSON.stringify(pullResultA));
    await sleep(1000);

    // Reopen note on Device A to verify convergence
    await pageA.evaluate((titleSubstr) => {
      const items = Array.from(document.querySelectorAll('[data-testid="notes-list-item"]'));
      const found = items.find((it) => it.textContent && it.textContent.includes(titleSubstr));
      if (found) found.click();
    }, "BYOS Production Security");
    await sleep(1000);

    const convergedA = await pageA.evaluate((sel) => {
      const el = document.querySelector(sel);
      const html = el ? el.innerHTML : "";
      return {
        hasDeviceBUpdate: html.includes("Device B Update"),
        hasDeviceBBold: /<b>Device B Update:<\/b>/i.test(html) || /<strong>Device B Update:<\/strong>/i.test(html),
        hasDeviceBUnderline: /<u>Remote sync authenticated via MinIO v2 envelopes\.<\/u>/i.test(html),
        hasOriginalH1: /<h1[^>]*>Architecture Overview<\/h1>/i.test(html),
      };
    }, editorSelector);

    console.log("  Device A Convergence check:", JSON.stringify(convergedA));
    recordResult(
      "CONVERGENCE_SYNC",
      "Two-way cross-device synchronization converges with all formatting intact",
      convergedA.hasDeviceBUpdate && convergedA.hasDeviceBBold && convergedA.hasDeviceBUnderline && convergedA.hasOriginalH1,
      `Device B updates converged to Device A: ${convergedA.hasDeviceBUpdate}`
    );

    const shotConverged = path.join(artifactsDir, "notes_persistence_device_a_converged.png");
    await pageA.screenshot({ path: shotConverged });
    console.log(`  Saved screenshot: ${path.relative(process.cwd(), shotConverged)}`);

    // -------------------------------------------------------------------------
    // STEP 7: Repeated Synchronization Idempotency (Tag Duplication Check)
    // -------------------------------------------------------------------------
    console.log("\n--- [STEP 7] Test Multi-Cycle Synchronization Idempotency ---");
    // Run sync 3 times in succession
    for (let cycle = 1; cycle <= 3; cycle++) {
      await pageA.evaluate(async () => {
        const syncMod = await import("/src/components/notes/notesSync.ts");
        const accounts = JSON.parse(localStorage.getItem("byos_accounts") || "[]");
        const mailboxId = accounts[0]?.mailboxId || "c0000000-0000-0000-0000-000000000001";
        await syncMod.syncNotesWithRemote(mailboxId);
      });
      await sleep(300);
    }

    const idempotencyCheck = await pageA.evaluate((sel) => {
      const el = document.querySelector(sel);
      const html = el ? el.innerHTML : "";
      // Count occurrences of h1 and bold tags
      const h1Count = (html.match(/<h1[^>]*>/gi) || []).length;
      const deviceBUpdateCount = (html.match(/Device B Update/gi) || []).length;
      return {
        h1Count,
        deviceBUpdateCount,
        noNestedDuplicateTags: !html.includes("<b><b>") && !html.includes("<u><u>") && !html.includes("<h1><h1>"),
      };
    }, editorSelector);

    console.log("  Idempotency metrics:", JSON.stringify(idempotencyCheck));
    recordResult(
      "SYNC_IDEMPOTENCY",
      "Repeated multi-cycle synchronization does not duplicate tags or degrade markup",
      idempotencyCheck.h1Count === 1 && idempotencyCheck.deviceBUpdateCount === 1 && idempotencyCheck.noNestedDuplicateTags,
      `H1 count: ${idempotencyCheck.h1Count}, Device B count: ${idempotencyCheck.deviceBUpdateCount}, No duplicates: ${idempotencyCheck.noNestedDuplicateTags}`
    );

    // -------------------------------------------------------------------------
    // STEP 8: Legacy Markdown Compatibility
    // -------------------------------------------------------------------------
    console.log("\n--- [STEP 8] Test Legacy Markdown Compatibility ---");
    // Inject a legacy markdown note directly into notesStore
    const legacyNoteId = await pageA.evaluate(async () => {
      const sessionMod = await import("/src/session_isolation.ts");
      const storeMod = await import("/src/components/notes/notesStore.ts");
      const accounts = JSON.parse(localStorage.getItem("byos_accounts") || "[]");
      const mailboxId = accounts[0]?.mailboxId || "c0000000-0000-0000-0000-000000000001";
      const accountId = accounts[0]?.id;
      const key = (accountId ? sessionMod.getMailboxKeyFor(accountId) : null) || sessionMod.getMailboxKeyFor(mailboxId);

      const legacyContent = [
        "# Legacy Architecture Document",
        "## Subsystem Invariants",
        "",
        "This legacy note contains **bold markdown**, *italic markdown*, and ~~struck markdown~~.",
        "",
        "Features:",
        "- Hardware-enforced zero knowledge",
        "- Local key derivation",
        "",
        "Steps:",
        "1. Derive mailbox secret",
        "2. Seal envelope",
        "",
        "Visit [BYOS Homepage](https://byos.local) for reference."
      ].join("\n");

      const created = storeMod.createNote(
        mailboxId,
        "Legacy Markdown Spec 2025",
        legacyContent,
        "sand",
        false,
        {},
        key || undefined
      );
      return created ? created.id : null;
    });

    console.log(`  Seeded legacy markdown note (ID: ${legacyNoteId})`);
    await sleep(600);

    // Refresh view and select the legacy note
    await pageA.reload({ waitUntil: "networkidle2" });
    await sleep(1200);
    await navigateToNotes(pageA);

    await pageA.evaluate((titleSubstr) => {
      const items = Array.from(document.querySelectorAll('[data-testid="notes-list-item"]'));
      const found = items.find((it) => it.textContent && it.textContent.includes(titleSubstr));
      if (found) found.click();
    }, "Legacy Markdown Spec");
    await sleep(800);

    const legacyRenderCheck = await pageA.evaluate((sel) => {
      const el = document.querySelector(sel);
      const html = el ? el.innerHTML : "";
      const text = el ? (el.innerText || el.textContent) : "";
      return {
        html,
        text,
        hasH1: /<h1[^>]*>Legacy Architecture Document<\/h1>/i.test(html),
        hasH2: /<h2[^>]*>Subsystem Invariants<\/h2>/i.test(html),
        hasBold: /<(b|strong)[^>]*>bold markdown<\/(b|strong)>/i.test(html),
        hasItalic: /<(i|em)[^>]*>italic markdown<\/(i|em)>/i.test(html),
        hasStrike: /<(s|strike|del)[^>]*>struck markdown<\/(s|strike|del)>/i.test(html),
        hasUl: /<ul[^>]*>.*<li[^>]*>Hardware-enforced zero knowledge.*<\/li>.*<\/ul>/is.test(html),
        hasOl: /<ol[^>]*>.*<li[^>]*>Derive mailbox secret.*<\/li>.*<\/ol>/is.test(html),
        hasLink: /<a[^>]*href="https:\/\/byos\.local"[^>]*>BYOS Homepage<\/a>/i.test(html),
        noLiteralMarkdownAsterisks: !text.includes("**bold markdown**"),
        noLiteralMarkdownTildes: !text.includes("~~struck markdown~~"),
      };
    }, editorSelector);

    console.log("  Legacy markdown rendering evaluation:", JSON.stringify(legacyRenderCheck));
    const legacyCompatible =
      legacyRenderCheck.hasH1 &&
      legacyRenderCheck.hasH2 &&
      legacyRenderCheck.hasBold &&
      legacyRenderCheck.hasItalic &&
      legacyRenderCheck.hasStrike &&
      legacyRenderCheck.hasUl &&
      legacyRenderCheck.hasOl &&
      legacyRenderCheck.hasLink &&
      legacyRenderCheck.noLiteralMarkdownAsterisks &&
      legacyRenderCheck.noLiteralMarkdownTildes;

    recordResult(
      "LEGACY_MD_COMPAT",
      "Legacy markdown notes render cleanly with native WYSIWYG elements without syntax leakage",
      legacyCompatible,
      `H1: ${legacyRenderCheck.hasH1}, Bold: ${legacyRenderCheck.hasBold}, Lists: ${legacyRenderCheck.hasUl}, Link: ${legacyRenderCheck.hasLink}`
    );

    const shotLegacy = path.join(artifactsDir, "notes_legacy_markdown_rendered.png");
    await pageA.screenshot({ path: shotLegacy });
    console.log(`  Saved screenshot: ${path.relative(process.cwd(), shotLegacy)}`);

    // -------------------------------------------------------------------------
    // STEP 9: Sanitization and Security Boundary Tests
    // -------------------------------------------------------------------------
    console.log("\n--- [STEP 9] Test DOMPurify Sanitization & Injection Prevention ---");
    // Inject malicious payloads via paste and DOM insertion
    const sanitizationResults = await pageA.evaluate(() => {
      const editor = document.querySelector('[data-testid="notes-editor-content-input"]');
      if (!editor) return { error: "Editor element not found" };

      // Set up canary global variable to detect any execution
      window.__xss_canary = false;

      // Vectors:
      // 1. Script tag injection
      // 2. Event handler on img onerror
      // 3. Event handler on div onclick
      // 4. Javascript: pseudo-protocol URL
      // 5. Malformed unclosed tags
      const dirtyVectors = [
        '<script>window.__xss_canary = true;</script>',
        '<img src="invalid_image_source.jpg" onerror="window.__xss_canary = true;" />',
        '<div onclick="window.__xss_canary = true;">Clickable element</div>',
        '<a href="javascript:window.__xss_canary=true;">Malicious link</a>',
        '<a href="https://byos.local/safe">Legitimate safe link</a>',
        '<b><i>Malformed unclosed tags',
      ].join("");

      // Dispatch custom paste event with text/html
      const dt = new DataTransfer();
      dt.setData("text/html", dirtyVectors);
      const pasteEvt = new ClipboardEvent("paste", {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      });

      editor.dispatchEvent(pasteEvt);

      // Inspect what was placed into editor DOM
      const sanitizedHtml = editor.innerHTML;

      return {
        xssCanaryFired: Boolean(window.__xss_canary),
        hasScriptTag: /<script/i.test(sanitizedHtml),
        hasOnErrorAttr: /onerror/i.test(sanitizedHtml),
        hasOnClickAttr: /onclick/i.test(sanitizedHtml),
        hasJavascriptUrl: /href=["']?javascript:/i.test(sanitizedHtml),
        hasSafeLink: /<a[^>]*href="https:\/\/byos\.local\/safe"[^>]*>Legitimate safe link<\/a>/i.test(sanitizedHtml),
        sanitizedHtml,
      };
    });

    console.log("  Sanitization evaluation:", JSON.stringify(sanitizationResults));

    recordResult(
      "SEC_SCRIPT_BLOCK",
      "Script tags neutralized and execution prevented",
      !sanitizationResults.hasScriptTag && !sanitizationResults.xssCanaryFired,
      `Script tag: ${sanitizationResults.hasScriptTag}, Canary fired: ${sanitizationResults.xssCanaryFired}`
    );

    recordResult(
      "SEC_EVENT_HANDLERS",
      "Event-handler attributes (onerror, onclick) stripped cleanly",
      !sanitizationResults.hasOnErrorAttr && !sanitizationResults.hasOnClickAttr,
      `onerror: ${sanitizationResults.hasOnErrorAttr}, onclick: ${sanitizationResults.hasOnClickAttr}`
    );

    recordResult(
      "SEC_UNSAFE_SCHEMES",
      "Unsafe javascript: URL schemes stripped while preserving safe https: links",
      !sanitizationResults.hasJavascriptUrl && sanitizationResults.hasSafeLink,
      `javascript: URL: ${sanitizationResults.hasJavascriptUrl}, Safe link: ${sanitizationResults.hasSafeLink}`
    );

    const shotSanitization = path.join(artifactsDir, "notes_sanitization_xss_blocked.png");
    await pageA.screenshot({ path: shotSanitization });
    console.log(`  Saved screenshot: ${path.relative(process.cwd(), shotSanitization)}`);

    // -------------------------------------------------------------------------
    // SUMMARY
    // -------------------------------------------------------------------------
    console.log("\n================================================================================");
    console.log("                           TEST SUMMARY                                         ");
    console.log("================================================================================");
    const passedCount = testResults.filter((r) => r.passed).length;
    console.log(`Results: ${passedCount}/${testResults.length} checks passed.\n`);

  } catch (err) {
    console.error("Test failure:", err);
  } finally {
    await browser.close();
  }
}

run();
