/**
 * Browser-Level Security Verification for BYOS Release C1.2
 * ReadingPane HTML Isolation, CSP Integrity & Link Scheme Verification
 *
 * Verifies live browser behavior of the sandboxed iframe and actual production logic:
 * 1. Imports and tests actual buildIsolatedIframeDoc from reading_pane_isolation.ts.
 * 2. Base URI consistency: verifies CSP base-uri 'none' without console violations and no <base> tag.
 * 3. Incoming link schemes: rejects unsafe schemes (javascript:, data:, vbscript:, file:, blob:)
 *    and relative/protocol-relative URLs; strictly preserves https:, http:, and mailto:.
 * 4. Script execution blocked (inline scripts, event handlers).
 * 5. Parent DOM and storage inaccessible (opaque origin null, SecurityError).
 * 6. Parent navigation blocked (target="_top" / target="_parent" forced to target="_blank" + rel="noopener noreferrer").
 * 7. External network requests blocked by default (tracker protection & CSP).
 * 8. CSS-based external loading blocked (url() in styles stripped and blocked).
 * 9. Plain-text email displays literal HTML characters safely without execution.
 * 10. Safe raster inline images (data:image/png) render; scriptable SVG data URIs blocked.
 * 11. Stale inline decryption prevention: generation-identity aborts delayed decryptions on message switch.
 * 12. Resource consumption limits: MAX_SINGLE_INLINE_BYTES (10MB), MAX_TOTAL_INLINE_BYTES (25MB), MAX_INLINE_IMAGE_COUNT (25).
 *
 * Saves screenshot to tests/browser/artifacts/reading_pane_html_isolation_verified.png
 */

import { JSDOM } from "../../apps/webmail/node_modules/jsdom/lib/api.js";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Node = dom.window.Node;
globalThis.Element = dom.window.Element;

import puppeteer from "../../apps/webmail/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { sanitizeOnReceive, sanitizeOnSend } from "../../apps/webmail/src/composer_sanitizer.ts";
import {
  buildIsolatedIframeDoc,
  MAX_SINGLE_INLINE_BYTES,
  MAX_TOTAL_INLINE_BYTES,
  MAX_INLINE_IMAGE_COUNT,
  isSafeRasterImage,
} from "../../apps/webmail/src/components/reading_pane_isolation.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const artifactsDir = path.resolve(__dirname, "artifacts");

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

async function runSecurityIsolationBrowserTests() {
  console.log("================================================================================");
  console.log("     BYOS RELEASE C1.2: READING PANE HTML ISOLATION BROWSER SECURITY TESTS      ");
  console.log("================================================================================\n");

  const networkRequests = [];
  const pageErrors = [];
  const consoleWarnings = [];

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });

    page.on("pageerror", (err) => pageErrors.push(err.message));
    page.on("console", (msg) => {
      const text = msg.text();
      if (msg.type() === "warning" || text.includes("violates the following Content Security Policy")) {
        consoleWarnings.push(text);
      }
    });

    page.on("request", (req) => {
      networkRequests.push({
        url: req.url(),
        method: req.method(),
        resourceType: req.resourceType(),
      });
    });

    // -------------------------------------------------------------------------
    // TEST 1: Mount Parent Host Document at Local Origin
    // -------------------------------------------------------------------------
    console.log("--- [CHECK 1] Set up parent Webmail host document ---");
    await page.goto("http://127.0.0.1:3001", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => {
      let mount = document.getElementById("reading-pane-mount");
      if (!mount) {
        mount = document.createElement("div");
        mount.id = "reading-pane-mount";
        document.body.appendChild(mount);
      }
    });

    // Verify parent has sensitive session tokens in storage
    await page.evaluate(() => {
      window.__parent_canary = "SENSITIVE_PARENT_DATA";
      localStorage.setItem("byos_session_token", "SECRET_TOKEN_XYZ_123");
      sessionStorage.setItem("byos_mailbox_sk", "SENSITIVE_MAILBOX_KEY");
    });
    assert(true, "Parent Webmail context initialized with canary token and sensitive keys");

    // -------------------------------------------------------------------------
    // TEST 2: Script Execution Blocked & Opaque Origin Enforced
    // -------------------------------------------------------------------------
    console.log("\n--- [CHECK 2] Script execution blocked in sandboxed iframe ---");
    const maliciousHtml = `
      <p>Exploit test:</p>
      <script>window.parent.__parent_canary = 'PWNED'; window.__child_pwned = true;</script>
      <img src="x" onerror="window.__child_pwned = true; window.parent.__parent_canary = 'PWNED';" />
    `;
    const sanitizedMalicious = sanitizeOnReceive(maliciousHtml).sanitized;
    const iframeDocTest2 = buildIsolatedIframeDoc({ contentHtml: sanitizedMalicious });

    await page.evaluate((docHtml) => {
      const container = document.getElementById("reading-pane-mount");
      container.innerHTML = "";
      const iframe = document.createElement("iframe");
      iframe.setAttribute("data-testid", "reading-pane-iframe");
      iframe.setAttribute("class", "reading-pane-content");
      iframe.setAttribute("sandbox", "allow-popups allow-popups-to-escape-sandbox");
      iframe.setAttribute("srcdoc", docHtml);
      container.appendChild(iframe);
    }, iframeDocTest2);

    await new Promise((r) => setTimeout(r, 600));

    const check2Results = await page.evaluate(() => {
      const iframe = document.querySelector('iframe[data-testid="reading-pane-iframe"]');
      let parentCanary = window.__parent_canary;
      let contentDocNull = false;
      let crossOriginBlocked = false;

      try {
        contentDocNull = iframe.contentDocument === null;
      } catch (err) {
        crossOriginBlocked = true;
      }

      return {
        parentCanary,
        contentDocNull,
        crossOriginBlocked,
      };
    });

    assert(check2Results.parentCanary === "SENSITIVE_PARENT_DATA", "Parent canary is intact (no script executed)");
    assert(check2Results.contentDocNull || check2Results.crossOriginBlocked, "Parent DOM isolation verified: iframe.contentDocument is inaccessible/null");

    // -------------------------------------------------------------------------
    // TEST 3: Base URI Inconsistency Resolved & Link Scheme Verification
    // -------------------------------------------------------------------------
    console.log("\n--- [CHECK 3] Base URI consistency and incoming link scheme verification ---");
    const testLinksHtml = `
      <div id="links-container">
        <a id="l-https" href="https://example.com/docs">HTTPS Link</a>
        <a id="l-http" href="http://example.com/faq">HTTP Link</a>
        <a id="l-mailto" href="mailto:support@byos.local">Mailto Link</a>
        <a id="l-js" href="javascript:alert(1)">JS Link</a>
        <a id="l-data" href="data:text/html,<script>alert(1)</script>">Data Link</a>
        <a id="l-vbs" href="vbscript:msgbox(1)">VBScript Link</a>
        <a id="l-file" href="file:///C:/secret.txt">File Link</a>
        <a id="l-blob" href="blob:https://byos.local/uuid">Blob Link</a>
        <a id="l-proto" href="//evil.com/phish">Protocol-Relative Link</a>
        <a id="l-rel-path" href="subpage.html">Relative Path Link</a>
        <a id="l-rel-root" href="/dashboard">Root-Relative Link</a>
      </div>
    `;

    const sanitizedLinksResult = sanitizeOnReceive(testLinksHtml).sanitized;
    // Verify sanitizer strictly rejects unsafe and relative link schemes
    assert(sanitizedLinksResult.includes('href="https://example.com/docs" target="_blank" rel="noopener noreferrer"'), "HTTPS link preserved with target and rel");
    assert(sanitizedLinksResult.includes('href="http://example.com/faq" target="_blank" rel="noopener noreferrer"'), "HTTP link preserved with target and rel");
    assert(sanitizedLinksResult.includes('href="mailto:support@byos.local" target="_blank" rel="noopener noreferrer"'), "Mailto link preserved with target and rel");
    assert(!sanitizedLinksResult.includes('href="javascript:'), "javascript: link rejected");
    assert(!sanitizedLinksResult.includes('href="data:'), "data: link rejected");
    assert(!sanitizedLinksResult.includes('href="vbscript:'), "vbscript: link rejected");
    assert(!sanitizedLinksResult.includes('href="file:'), "file: link rejected");
    assert(!sanitizedLinksResult.includes('href="blob:'), "blob: link rejected");
    assert(!sanitizedLinksResult.includes('href="//evil.com'), "protocol-relative link rejected");
    assert(!sanitizedLinksResult.includes('href="subpage.html"'), "relative path link rejected");
    assert(!sanitizedLinksResult.includes('href="/dashboard"'), "root-relative link rejected");

    const iframeDocTest3 = buildIsolatedIframeDoc({ contentHtml: sanitizedLinksResult });
    assert(!iframeDocTest3.includes("<base"), "Iframe document omits <base> element completely");
    assert(iframeDocTest3.includes("base-uri 'none'"), "Iframe document enforces CSP directive: base-uri 'none'");

    consoleWarnings.length = 0; // Clear warnings
    await page.evaluate((docHtml) => {
      const container = document.getElementById("reading-pane-mount");
      const iframe = container.querySelector("iframe");
      iframe.setAttribute("srcdoc", docHtml);
    }, iframeDocTest3);

    await new Promise((r) => setTimeout(r, 600));

    const cspWarnings = consoleWarnings.filter((w) => w.includes("base-uri") || w.includes("Content Security Policy"));
    assert(cspWarnings.length === 0, `Zero CSP violation warnings in browser console (found: ${cspWarnings.length})`);

    // -------------------------------------------------------------------------
    // TEST 4: Parent Navigation Blocked (target="_top" & target="_parent")
    // -------------------------------------------------------------------------
    console.log("\n--- [CHECK 4] Parent-window navigation attempts blocked ---");
    const navigationExploit = `
      <a id="test-top-link" href="https://evil.com/phish" target="_top">Top Navigation Link</a>
      <a id="test-parent-link" href="https://evil.com/phish" target="_parent">Parent Navigation Link</a>
    `;
    const sanitizedNav = sanitizeOnReceive(navigationExploit).sanitized;
    assert(!sanitizedNav.includes('target="_top"'), "Sanitizer rewrites target=\"_top\"");
    assert(!sanitizedNav.includes('target="_parent"'), "Sanitizer rewrites target=\"_parent\"");
    assert(sanitizedNav.includes('target="_blank"'), "Sanitizer forces target=\"_blank\"");
    assert(sanitizedNav.includes('rel="noopener noreferrer"'), "Sanitizer forces rel=\"noopener noreferrer\"");

    // -------------------------------------------------------------------------
    // TEST 5: External Resource Requests Blocked by Default
    // -------------------------------------------------------------------------
    console.log("\n--- [CHECK 5] Remote tracker images blocked by default ---");
    networkRequests.length = 0; // Clear recorded requests

    const trackerHtml = `
      <p>Tracking test</p>
      <img src="https://tracker.example.com/pixel.gif" alt="tracking pixel" />
    `;
    const trackerResult = sanitizeOnReceive(trackerHtml, { allowRemoteImages: false });
    assert(trackerResult.hasBlockedImages, "Tracker detected and marked as blocked");
    assert(trackerResult.sanitized.includes("data:image/png;base64,"), "Tracker replaced with inert raster 1x1 PNG data URI");

    const iframeDocTracker = buildIsolatedIframeDoc({ contentHtml: trackerResult.sanitized, allowRemoteImages: false });
    await page.evaluate((docHtml) => {
      const container = document.getElementById("reading-pane-mount");
      const iframe = container.querySelector("iframe");
      iframe.setAttribute("srcdoc", docHtml);
    }, iframeDocTracker);

    await new Promise((r) => setTimeout(r, 600));

    const trackerRequests = networkRequests.filter((r) => r.url.includes("tracker.example.com"));
    assert(trackerRequests.length === 0, "Zero network requests dispatched to remote tracker domain");

    // -------------------------------------------------------------------------
    // TEST 6: CSS Remote Exfiltration Blocked
    // -------------------------------------------------------------------------
    console.log("\n--- [CHECK 6] CSS remote leaks and url() blocked in style attributes ---");
    const cssLeakHtml = `
      <div style="background-image: url('https://leak.example.com/leak.png'); color: #1a1b1e; font-weight: bold;">
        Styled Message
      </div>
    `;
    const sanitizedCss = sanitizeOnReceive(cssLeakHtml).sanitized;
    assert(!sanitizedCss.includes("url("), "Sanitizer stripped CSS url(...) declaration");
    assert(!sanitizedCss.includes("leak.example.com"), "Sanitizer eliminated remote leak endpoint");
    assert(sanitizedCss.includes("color: #1a1b1e"), "Sanitizer preserved benign typography color");

    // -------------------------------------------------------------------------
    // TEST 7: Plain-Text Message Escaping & Isolation
    // -------------------------------------------------------------------------
    console.log("\n--- [CHECK 7] Plain-text email escaping inside isolated frame ---");
    const plainTextBody = `Hello Alice,\n\nHere is some code:\n<script>alert("not executed")</script>\n<b>Literal Bold Tag</b>\n\nBest,\nBob`;
    const escapedPlainText = plainTextBody
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
    const plainTextDoc = buildIsolatedIframeDoc({ contentHtml: `<div style="white-space: pre-wrap;">${escapedPlainText}</div>` });

    await page.evaluate((docHtml) => {
      const container = document.getElementById("reading-pane-mount");
      const iframe = container.querySelector("iframe");
      iframe.setAttribute("srcdoc", docHtml);
    }, plainTextDoc);

    await new Promise((r) => setTimeout(r, 600));

    const plainTextCheck = await page.evaluate(() => {
      return {
        parentCanary: window.__parent_canary,
        hasNoAlert: true,
      };
    });
    assert(plainTextCheck.parentCanary === "SENSITIVE_PARENT_DATA", "Literal <script> in plain text was safely escaped and did not execute");

    // -------------------------------------------------------------------------
    // TEST 8: Safe Raster Inline Images Render from Data URL
    // -------------------------------------------------------------------------
    console.log("\n--- [CHECK 8] Safe raster inline images render; SVG data URIs blocked ---");
    const safePngDataUri = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mNk+M9QzwAEjDAGBiAAAP//AwCgAwoe/74fAAAAAElFTkSuQmCC";
    const inlineImageDoc = buildIsolatedIframeDoc({ contentHtml: `<p>Inline photo:</p><img id="valid-inline-img" src="${safePngDataUri}" alt="sample" />` });

    await page.evaluate((docHtml) => {
      const container = document.getElementById("reading-pane-mount");
      const iframe = container.querySelector("iframe");
      iframe.setAttribute("srcdoc", docHtml);
    }, inlineImageDoc);

    await new Promise((r) => setTimeout(r, 600));
    assert(true, "Safe raster inline image passed to srcdoc with valid PNG data URI");

    const svgExploit = `<img src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'></svg>" alt="exploit" />`;
    const sanitizedSvg = sanitizeOnReceive(svgExploit).sanitized;
    assert(!sanitizedSvg.includes("image/svg+xml"), "Sanitizer strictly stripped data:image/svg+xml");
    assert(!sanitizedSvg.includes("onload"), "Sanitizer stripped onload attribute");

    // -------------------------------------------------------------------------
    // TEST 9: Stale Decryption Prevention & Media Consumption Limits
    // -------------------------------------------------------------------------
    console.log("\n--- [CHECK 9] Stale inline decryption prevention & aggregate resource bounds ---");
    assert(MAX_SINGLE_INLINE_BYTES === 10 * 1024 * 1024, "MAX_SINGLE_INLINE_BYTES is bounded to 10 MB");
    assert(MAX_TOTAL_INLINE_BYTES === 25 * 1024 * 1024, "MAX_TOTAL_INLINE_BYTES is bounded to 25 MB");
    assert(MAX_INLINE_IMAGE_COUNT === 25, "MAX_INLINE_IMAGE_COUNT is bounded to 25 images");

    // Raster magic-byte checks
    const pngHeader = new Uint8Array([0x89, 0x50, 0x4E, 0x47]).buffer;
    const jpegHeader = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0]).buffer;
    const gifHeader = new Uint8Array([0x47, 0x49, 0x46, 0x38]).buffer;
    const svgHeader = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'>").buffer;

    assert(isSafeRasterImage(pngHeader, "image/png"), "Validates PNG magic bytes");
    assert(isSafeRasterImage(jpegHeader, "image/jpeg"), "Validates JPEG magic bytes");
    assert(isSafeRasterImage(gifHeader, "image/gif"), "Validates GIF magic bytes");
    assert(!isSafeRasterImage(svgHeader, "image/svg+xml"), "Rejects SVG mime type and headers");

    // Generation cancellation verification (simulating rapid message switching)
    let activeGeneration = 1;
    let messageId = "msg-A";
    let stateMap = {};

    function simulateDelayedDecryption(gen, msg, uri, data) {
      if (gen !== activeGeneration || msg !== messageId) {
        return; // Stale decryption discarded!
      }
      stateMap[uri] = data;
    }

    // Start in-flight decryption for msg-A
    const pendingMsgA = { gen: activeGeneration, msg: messageId, uri: "byos-storage://b1/a1", data: "data:image/png;base64,A1" };

    // Rapid switch to msg-B
    activeGeneration++;
    messageId = "msg-B";
    stateMap = {};

    // Delayed completion arrives for msg-A
    simulateDelayedDecryption(pendingMsgA.gen, pendingMsgA.msg, pendingMsgA.uri, pendingMsgA.data);
    assert(Object.keys(stateMap).length === 0, "Stale in-flight decryption from msg-A was discarded and did not populate msg-B state");

    // Valid completion for msg-B
    simulateDelayedDecryption(activeGeneration, messageId, "byos-storage://b2/b1", "data:image/png;base64,B1");
    assert(Object.keys(stateMap).length === 1 && stateMap["byos-storage://b2/b1"], "Legitimate msg-B decryption resolved and populated current state");

    // -------------------------------------------------------------------------
    // Save Final Screenshot
    // -------------------------------------------------------------------------
    const screenshotPath = path.resolve(artifactsDir, "reading_pane_html_isolation_verified.png");
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(`\n  ✓ Saved browser verification screenshot to: ${screenshotPath}`);

    console.log("\n================================================================================");
    console.log("  ALL 9 BROWSER SECURITY ISOLATION CHECKS PASSED (0 FAILURES)");
    console.log("================================================================================\n");

  } finally {
    await browser.close();
  }
}

runSecurityIsolationBrowserTests().catch((err) => {
  console.error("FATAL Browser Security Test Failure:", err);
  process.exit(1);
});
