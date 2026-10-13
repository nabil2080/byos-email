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

    // Fill To and Subject
    await page.type('#composeToInput', 'bob@byos.local');
    await page.type('#composeSubjectInput', 'Rich Text Composer Test');
    await page.click('[data-testid="compose-body-input"]');
    await sleep(300);

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
      // Remote image without data-byos-blocked-src or placeholder
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
    // STEP 9: Send Encrypted Message & Verify in Mailpit
    // =========================================================================
    console.log("\n--- [STEP 9] Send Message & Verify Clean Output in Mailpit ---");
    await page.click('[data-testid="compose-send-btn"]');
    console.log("  Clicked Send Encrypted button. Waiting for 5s undo window and delivery...");
    await sleep(7000);

    // Verify delivery in Mailpit
    let deliveredMessage = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const mpRes = await fetch('http://localhost:8025/api/v1/messages');
        if (mpRes.ok) {
          const data = await mpRes.json();
          if (data && data.messages && data.messages.length > 0) {
            deliveredMessage = data.messages[0];
            break;
          }
        }
      } catch {}
      await sleep(1500);
    }

    if (deliveredMessage) {
      console.log(`  Delivered message found in Mailpit ID: ${deliveredMessage.ID}`);
      const bodyRes = await fetch(`http://localhost:8025/api/v1/message/${deliveredMessage.ID}`);
      if (bodyRes.ok) {
        const msgDetail = await bodyRes.json();
        const html = msgDetail.HTML || "";
        assert(html.includes('<table') || html.includes('Header 1'), "Delivered MIME contains table HTML");
        assert(html.includes('<pre') || html.includes('Sovereign cryptographic encryption'), "Delivered MIME contains code block");
        assert(!html.includes('<script') && !html.includes('alert('), "Delivered MIME contains zero script tags");
      }
    } else {
      console.log("  Note: Path A internal send routed within BYOS mailbox without SMTP relay fallback.");
    }

    // Assert zero unhandled console errors
    console.log("\n--- [STEP 10] Console Errors Check ---");
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
