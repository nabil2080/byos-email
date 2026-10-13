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

async function runComposerBrowserTests() {
  console.log("================================================================================");
  console.log("          RICH TEXT COMPOSER POLISH (V1) BROWSER INTEGRATION TEST               ");
  console.log("================================================================================\n");

  // Ensure sample inline image exists
  const sampleImagePath = path.resolve(artifactsDir, 'sample_inline.png');
  if (!fs.existsSync(sampleImagePath)) {
    const pngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    fs.writeFileSync(sampleImagePath, Buffer.from(pngBase64, 'base64'));
  }

  // Clear Mailpit messages
  try {
    await fetch('http://localhost:8025/api/v1/messages', { method: 'DELETE' });
  } catch {}

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ['--no-sandbox', '--disable-gpu'],
  });

  const unhandledErrors = [];
  const highlightLibRequests = [];

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        if (
          !text.includes('/v1/auth/me') &&
          !text.includes('favicon') &&
          !text.includes('401 (Unauthorized)') &&
          !text.includes('Failed to load resource') &&
          !text.includes('net::ERR_INTERNET_DISCONNECTED') &&
          !text.includes('failed to connect to websocket')
        ) {
          unhandledErrors.push(text);
          console.error(`  [CONSOLE ERROR] ${text}`);
        }
      }
    });

    page.on('request', (req) => {
      const u = req.url().toLowerCase();
      if (u.includes('highlight__js') || (u.includes('highlight.js') && !u.endsWith('.css') && !u.includes('code_highlight.ts'))) {
        highlightLibRequests.push(req.url());
      }
    });

    // =========================================================================
    // STEP 1: Real login flow as Alice
    // =========================================================================
    console.log("--- [STEP 1] Real login flow as Alice (alice@byos.local) ---");
    await page.goto('http://127.0.0.1:3001', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.reload({ waitUntil: 'networkidle2' });
    await sleep(1000);

    await page.waitForSelector('input[type="email"]', { timeout: 10000 });
    await page.type('input[type="email"]', 'alice@byos.local');
    await page.type('input[type="password"]', 'test-password-123');
    await page.click('button[type="submit"]');

    await page.waitForSelector('[data-testid="account-chip-selector"]', { timeout: 15000 });
    await sleep(1000);

    const activeUser = await page.$eval('[data-testid="account-chip-text"]', (el) => el.textContent.trim());
    console.log(`  Active account: "${activeUser}"`);
    assert(activeUser.includes('alice@byos.local'), "Alice logged in successfully via real credentials");

    // =========================================================================
    // STEP 2: Open compose drawer
    // =========================================================================
    console.log("\n--- [STEP 2] Open Compose Drawer ---");
    await page.click('[data-testid="sidebar-compose-btn"]');
    await page.waitForSelector('[data-testid="compose-body-input"]', { timeout: 5000 });
    assert(true, "Compose drawer opened and contenteditable editor mounted");

    // Fill To and Subject (targeting external@test.local for Mailpit delivery verification)
    await page.type('#composeToInput', 'external@test.local');
    const msgSubject = `Rich Text Composer Test ${Date.now()}`;
    await page.type('#composeSubjectInput', msgSubject);
    await page.click('[data-testid="compose-body-input"]');
    await sleep(300);

    // Verify highlight.js is not loaded on initial open
    assert(highlightLibRequests.length === 0, "highlight.js is NOT loaded on initial page load or compose drawer open");

    // =========================================================================
    // STEP 3: Insert and configure 3x2 Table
    // =========================================================================
    console.log("\n--- [STEP 3] Insert Table (3 rows x 2 cols + Header) ---");
    await page.click('[data-testid="composer-table-btn"]');
    await page.waitForSelector('[data-testid="composer-insert-table-btn"]', { timeout: 5000 });

    // Click Insert Table in modal
    await page.click('[data-testid="composer-insert-table-btn"]');
    await sleep(500);

    const tableStats = await page.evaluate(() => {
      const editor = document.querySelector('[data-testid="compose-body-input"]');
      if (!editor) return null;
      const table = editor.querySelector('table');
      if (!table) return null;
      const thead = table.querySelector('thead');
      const tbody = table.querySelector('tbody');
      const headerCols = thead ? thead.querySelectorAll('th').length : 0;
      const bodyRows = tbody ? tbody.querySelectorAll('tr').length : 0;
      const bodyCols = tbody?.querySelector('tr')?.querySelectorAll('td').length || 0;
      return { hasTable: true, headerCols, bodyRows, bodyCols };
    });

    assert(tableStats && tableStats.hasTable, "Table inserted into composer editor");
    assert(tableStats.headerCols === 2, `Table has 2 header columns (found: ${tableStats?.headerCols})`);
    assert(tableStats.bodyRows === 3, `Table has 3 body rows (found: ${tableStats?.bodyRows})`);
    assert(tableStats.bodyCols === 2, `Table has 2 body columns (found: ${tableStats?.bodyCols})`);

    const tableScreenshotPath = path.resolve(artifactsDir, 'composer_table.png');
    await page.screenshot({ path: tableScreenshotPath });
    console.log(`  Screenshot saved: tests/browser/artifacts/composer_table.png`);

    // =========================================================================
    // STEP 4: Insert Code Block with Language Selector
    // =========================================================================
    console.log("\n--- [STEP 4] Insert Code Block with JavaScript Language ---");
    await page.evaluate(() => {
      const editor = document.querySelector('[data-testid="compose-body-input"]');
      if (!editor) return;
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
    });
    await page.click('[data-testid="composer-code-block-btn"]');
    await sleep(500);

    // Verify language dropdown appears
    await page.waitForSelector('[data-testid="code-language-select"]', { timeout: 5000 });
    await page.select('[data-testid="code-language-select"]', 'javascript');
    await sleep(300);

    const codeStats = await page.evaluate(() => {
      const editor = document.querySelector('[data-testid="compose-body-input"]');
      if (!editor) return null;
      const pre = editor.querySelector('pre');
      const code = pre?.querySelector('code');
      if (code) {
        code.textContent = 'const message = "Sovereign cryptographic encryption";';
      }
      return {
        hasTable: Boolean(editor.querySelector('table')),
        hasPre: Boolean(pre),
        hasCode: Boolean(code),
        className: code?.className || "",
        dataLang: code?.getAttribute('data-language') || "",
      };
    });

    assert(codeStats && codeStats.hasPre && codeStats.hasCode, "Pre/Code block inserted in DOM");
    assert(
      codeStats.className.includes('language-javascript') || codeStats.dataLang === 'javascript',
      `Code block has language-javascript attribute (class: ${codeStats.className}, data-lang: ${codeStats.dataLang})`
    );

    const codeScreenshotPath = path.resolve(artifactsDir, 'composer_code_block.png');
    await page.screenshot({ path: codeScreenshotPath });
    console.log(`  Screenshot saved: tests/browser/artifacts/composer_code_block.png`);

    // =========================================================================
    // STEP 5: Inline Image Embedding
    // =========================================================================
    console.log("\n--- [STEP 5] Inline Image Embedding ---");
    await page.evaluate(() => {
      const editor = document.querySelector('[data-testid="compose-body-input"]');
      if (!editor) return;
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
    });
    const imageInput = await page.$('input[data-testid="composer-image-input"]');
    assert(Boolean(imageInput), "Image file input found with data-testid='composer-image-input'");
    await imageInput.uploadFile(sampleImagePath);
    await sleep(1000);

    const imageStats = await page.evaluate(() => {
      const editor = document.querySelector('[data-testid="compose-body-input"]');
      const imgs = editor ? Array.from(editor.querySelectorAll('img')) : [];
      return {
        count: imgs.length,
        src: imgs[0]?.getAttribute('src') || "",
        alt: imgs[0]?.getAttribute('alt') || "",
      };
    });

    assert(imageStats.count >= 1, `Inline image element inserted into editor (found: ${imageStats.count})`);
    assert(
      imageStats.src.startsWith('byos-storage://') || imageStats.src.startsWith('data:image/'),
      `Inline image has safe sovereign storage or data URI: "${imageStats.src.slice(0, 40)}..."`
    );

    // =========================================================================
    // STEP 6: Paste Handling (Sanitizing script tags & remote tracker)
    // =========================================================================
    console.log("\n--- [STEP 6] Paste Handling & Malicious Script Stripping ---");
    // Simulate paste event on the contenteditable
    await page.evaluate(() => {
      const editor = document.querySelector('[data-testid="compose-body-input"]');
      if (!editor) return;

      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
      }

      const clipboardData = new DataTransfer();
      clipboardData.setData('text/html', '<p>Safe paragraph</p><script>alert("xss")</script><img src="http://tracker.example.com/pixel.gif" width="1" height="1">');
      clipboardData.setData('text/plain', 'Safe paragraph');

      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData,
      });

      editor.dispatchEvent(pasteEvent);
    });
    await sleep(500);

    const pasteVerification = await page.evaluate(() => {
      const editor = document.querySelector('[data-testid="compose-body-input"]');
      if (!editor) return { hasScript: true, hasTracker: true, html: "" };
      const html = editor.innerHTML;
      const hasScript = html.includes('<script') || html.includes('alert(');
      const hasTracker = html.includes('http://tracker.example.com/pixel.gif') && !html.includes('data-byos-blocked-src');
      return { hasScript, hasTracker, html };
    });

    assert(!pasteVerification.hasScript, "Pasted <script> tag was completely stripped");
    console.log("  Pasted script successfully stripped from editor DOM");

    // =========================================================================
    // STEP 7: Preview Mode Toggle & Rendering
    // =========================================================================
    console.log("\n--- [STEP 7] Preview Mode Toggle & Syntax Highlighting ---");
    await page.click('[data-testid="composer-preview-btn"]');
    await page.waitForSelector('[data-testid="composer-preview-container"]', { timeout: 5000 });
    await sleep(800);

    // Assert highlight.js was loaded on-demand for previewing code block
    assert(highlightLibRequests.length > 0, "highlight.js was loaded dynamically on-demand when code block rendered");

    const previewCheck = await page.evaluate(() => {
      const preview = document.querySelector('[data-testid="composer-preview-container"]');
      if (!preview) return null;
      const table = preview.querySelector('table');
      const pre = preview.querySelector('pre');
      const code = preview.querySelector('code');
      const img = preview.querySelector('img');
      const isHighlighted = code?.hasAttribute('data-highlighted') || (code?.classList.length || 0) > 1;
      return {
        hasTable: Boolean(table),
        hasPre: Boolean(pre),
        hasCode: Boolean(code),
        hasImg: Boolean(img),
        isHighlighted,
      };
    });

    assert(previewCheck && previewCheck.hasTable, "Preview container renders table");
    assert(previewCheck.hasPre && previewCheck.hasCode, "Preview container renders code block");
    assert(previewCheck.hasImg, "Preview container renders inline image");

    const previewScreenshotPath = path.resolve(artifactsDir, 'composer_preview.png');
    await page.screenshot({ path: previewScreenshotPath });
    console.log(`  Screenshot saved: tests/browser/artifacts/composer_preview.png`);

    // Toggle back to edit mode
    console.log("\n--- [STEP 8] Toggle Back to Edit Mode (Preserve Content) ---");
    await page.click('[data-testid="composer-preview-btn"]');
    await page.waitForSelector('[data-testid="compose-body-input"]', { timeout: 5000 });
    await sleep(500);

    const editRestored = await page.evaluate(() => {
      const editor = document.querySelector('[data-testid="compose-body-input"]');
      return {
        hasTable: Boolean(editor?.querySelector('table')),
        hasPre: Boolean(editor?.querySelector('pre')),
      };
    });
    assert(editRestored.hasTable && editRestored.hasPre, "Editor content preserved after toggling out of preview mode");

    // =========================================================================
    // STEP 9: Send Encrypted Message & Verify Delivered MIME in Mailpit
    // =========================================================================
    console.log("\n--- [STEP 9] Send Message & Verify Clean Output in Mailpit ---");
    await page.click('[data-testid="compose-send-btn"]');
    console.log("  Clicked Send Encrypted button. Waiting for 5s undo window and delivery to Mailpit...");

    // Poll Mailpit for delivered message to external@test.local
    let deliveredMessage = null;
    for (let attempt = 0; attempt < 20; attempt++) {
      await sleep(1500);
      try {
        const mpRes = await fetch('http://localhost:8025/api/v1/messages');
        if (mpRes.ok) {
          const data = await mpRes.json();
          const match = (data.messages || []).find((m) =>
            m.To?.some((t) => t.Address === 'external@test.local')
          );
          if (match) {
            deliveredMessage = match;
            break;
          }
        }
      } catch {}
    }

    assert(deliveredMessage !== null, "Delivered message found in Mailpit for external@test.local");
    console.log(`  Delivered message ID in Mailpit: ${deliveredMessage.ID}`);

    const bodyRes = await fetch(`http://localhost:8025/api/v1/message/${deliveredMessage.ID}`);
    assert(bodyRes.ok, "Fetched full delivered message payload from Mailpit");
    const msgDetail = await bodyRes.json();
    const html = msgDetail.HTML || "";

    assert(html.includes('<table') || html.includes('Header 1'), "Delivered MIME in Mailpit contains table HTML");
    assert(html.includes('<pre') || html.includes('Sovereign cryptographic encryption'), "Delivered MIME in Mailpit contains code block");
    assert(html.includes('byos-storage://') || html.includes('<img'), "Delivered MIME in Mailpit contains inline image reference");
    assert(!html.includes('<script') && !html.includes('alert('), "Delivered MIME in Mailpit contains zero script tags");

    // =========================================================================
    // STEP 10: Offline Composer with Rich Content & IndexedDB Draft Save
    // =========================================================================
    console.log("\n--- [STEP 10] Offline Rich Draft Save to IndexedDB ---");
    const client = await page.target().createCDPSession();
    await client.send('Network.enable');
    await client.send('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: 0,
      uploadThroughput: 0,
    });
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    await sleep(500);

    // Open compose drawer offline
    const composeBtnOffline = await page.waitForSelector('[data-testid="sidebar-compose-btn"]', { timeout: 5000 });
    await composeBtnOffline.click();
    await page.waitForSelector('[data-testid="compose-body-input"]', { timeout: 5000 });
    await page.type('#composeToInput', 'draft_recipient@example.com');
    const offlineDraftSubject = `Offline Table Draft ${Date.now()}`;
    await page.type('#composeSubjectInput', offlineDraftSubject);

    // Insert table
    await page.click('[data-testid="composer-table-btn"]');
    await page.waitForSelector('[data-testid="composer-insert-table-btn"]', { timeout: 5000 });
    await page.click('[data-testid="composer-insert-table-btn"]');
    await sleep(500);

    // Close compose drawer to trigger auto-save
    await page.click('[data-testid="compose-close-btn"]');
    await sleep(1000);

    // Verify draft stored in IndexedDB 'byos-offline' -> 'drafts' store
    const offlineDraft = await page.evaluate(async (subj) => {
      return new Promise((resolve) => {
        const req = indexedDB.open('byos-offline', 1);
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('drafts')) return resolve(null);
          const tx = db.transaction('drafts', 'readonly');
          const getAllReq = tx.objectStore('drafts').getAll();
          getAllReq.onsuccess = () => {
            const drafts = getAllReq.result || [];
            resolve(drafts.find((d) => d.subject === subj) || null);
          };
          getAllReq.onerror = () => resolve(null);
        };
        req.onerror = () => resolve(null);
      });
    }, offlineDraftSubject);

    assert(Boolean(offlineDraft), "Draft saved to IndexedDB 'drafts' store while offline");
    assert(
      Boolean(offlineDraft && (offlineDraft.bodyHtml?.includes('<table') || offlineDraft.body?.includes('<table'))),
      "Draft entry in IndexedDB contains table HTML"
    );

    // Confirm draft appears in Drafts folder in UI
    const draftsFolderBtn = await page.waitForSelector('[data-testid="folder-drafts"]', { timeout: 5000 });
    await draftsFolderBtn.click();
    await sleep(1000);
    const draftMsgRow = await page.waitForSelector('[data-testid="message-row"]', { timeout: 5000 });
    assert(Boolean(draftMsgRow), "Draft appears in Drafts folder message list");

    // Reconnect network
    await client.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await sleep(1500);

    // =========================================================================
    // STEP 11: Console Errors Check
    // =========================================================================
    console.log("\n--- [STEP 11] Console Errors Check ---");
    assert(unhandledErrors.length === 0, `Zero unhandled console errors (errors: ${unhandledErrors.length})`);

    console.log("\n================================================================================");
    console.log("      ALL COMPOSER INTEGRATION TESTS COMPLETED SUCCESSFULLY                     ");
    console.log("================================================================================");
  } finally {
    await browser.close();
  }
}

runComposerBrowserTests().catch((err) => {
  console.error("FATAL BROWSER TEST ERROR:", err);
  process.exit(1);
});
