import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).Node = dom.window.Node;
(globalThis as any).Element = dom.window.Element;

import {
  sanitizeOnSend,
  sanitizeOnReceive,
  cleanPastedContent,
  stripWordDocsWrappers,
  getPurifier,
} from "./composer_sanitizer.js";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

export async function runComposerSanitizerTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  const test = async (name: string, fn: () => Promise<void> | void) => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}:`, err);
      failed++;
    }
  };

  // Ensure purifier is warmed up
  getPurifier();

  console.log("Running Composer Sanitizer Tests...");

  await test("test_sanitize_strips_script_tags", () => {
    const dirty = `<p>Safe text</p><script>alert('pwned')</script><script src="https://evil.com/xss.js"></script>`;
    const sendClean = sanitizeOnSend(dirty);
    assert(!sendClean.includes("<script"), "sanitizeOnSend must strip <script> tag");
    assert(!sendClean.includes("alert("), "sanitizeOnSend must strip script content");
    assert(sendClean.includes("Safe text"), "sanitizeOnSend preserves safe paragraph");

    const receiveClean = sanitizeOnReceive(dirty);
    assert(!receiveClean.sanitized.includes("<script"), "sanitizeOnReceive must strip <script> tag");
    assert(!receiveClean.sanitized.includes("evil.com"), "sanitizeOnReceive must strip script src");
  });

  await test("test_sanitize_strips_onclick_handlers", () => {
    const dirty = `<button onclick="doExploit()" onmouseover="stealTokens()">Click me</button><a href="https://example.com" onclick="alert(1)">Link</a>`;
    const clean = sanitizeOnSend(dirty);
    assert(!clean.includes("onclick"), "sanitizeOnSend must strip onclick attribute");
    assert(!clean.includes("onmouseover"), "sanitizeOnSend must strip onmouseover attribute");
    assert(!clean.includes("doExploit"), "sanitizeOnSend must strip inline handler code");
    assert(clean.includes("href=\"https://example.com\""), "sanitizeOnSend preserves safe href");
  });

  await test("test_sanitize_strips_javascript_hrefs", () => {
    const dirty = `<a href="javascript:alert(document.cookie)">Malicious Link</a><a href="JAVASCRIPT:void(0)">Another</a>`;
    const clean = sanitizeOnSend(dirty);
    assert(!clean.includes("javascript:"), "sanitizeOnSend must strip javascript: href");
    assert(!clean.includes("JAVASCRIPT:"), "sanitizeOnSend must strip case-insensitive javascript: href");
  });

  await test("test_sanitize_allows_safe_tags", () => {
    const safeInput = `<h1>Heading 1</h1><p>This is <strong>bold</strong>, <em>italic</em>, <u>underline</u>, <s>strike</s>.</p><blockquote>Quote</blockquote><hr><p><a href="https://byos.local">Valid Link</a></p><ul><li>Item 1</li><li>Item 2</li></ul><ol><li>Num 1</li></ol>`;
    const clean = sanitizeOnSend(safeInput);
    assert(clean.includes("<h1>Heading 1</h1>"), "Preserves h1");
    assert(clean.includes("<strong>bold</strong>"), "Preserves strong");
    assert(clean.includes("<em>italic</em>"), "Preserves em");
    assert(clean.includes("<u>underline</u>"), "Preserves u");
    assert(clean.includes("<s>strike</s>"), "Preserves s");
    assert(clean.includes("<blockquote>Quote</blockquote>"), "Preserves blockquote");
    assert(clean.includes("<hr"), "Preserves hr");
    assert(clean.includes("<a href=\"https://byos.local\""), "Preserves valid link");
    assert(clean.includes("<ul><li>Item 1</li>"), "Preserves ul list");
    assert(clean.includes("<ol><li>Num 1</li>"), "Preserves ol list");
  });

  await test("test_sanitize_allows_byos_storage_images", () => {
    const input = `<p>Inline:</p><img src="byos-storage://c0000000-0000-0000-0000-000000000001/att-12345" alt="photo.png" />`;
    const sendClean = sanitizeOnSend(input);
    assert(sendClean.includes("src=\"byos-storage://c0000000-0000-0000-0000-000000000001/att-12345\""), "sanitizeOnSend must allow byos-storage:// image URL");

    const receiveResult = sanitizeOnReceive(input, { allowRemoteImages: false });
    assert(receiveResult.sanitized.includes("byos-storage://c0000000-0000-0000-0000-000000000001/att-12345"), "sanitizeOnReceive must allow byos-storage:// even when remote images are blocked");
    assert(!receiveResult.hasBlockedImages, "byos-storage:// is customer zero-knowledge storage, not a blocked remote tracker");
  });

  await test("test_sanitize_blocks_remote_images_by_default", () => {
    const input = `<p>Tracker test:</p><img src="https://tracker.example.com/pixel.gif" alt="tracker" />`;
    
    // Default: blocked
    const blockedResult = sanitizeOnReceive(input, { allowRemoteImages: false });
    assert(blockedResult.hasBlockedImages, "Should detect blocked remote images");
    assert(blockedResult.sanitized.includes("data-byos-blocked-src=\"https://tracker.example.com/pixel.gif\""), "Stores original blocked url in data-byos-blocked-src");
    assert(!/<img[^>]*\ssrc=["']https?:\/\//i.test(blockedResult.sanitized), "Original remote url must NOT be rendered in src attribute");

    // Allowed when user clicks "Load images"
    const allowedResult = sanitizeOnReceive(input, { allowRemoteImages: true });
    assert(allowedResult.sanitized.includes("src=\"https://tracker.example.com/pixel.gif\""), "Allows remote image when explicitly permitted");
  });

  await test("test_sanitize_preserves_table_structure", () => {
    const tableHtml = `<table border="1"><thead><tr><th>Header A</th><th>Header B</th></tr></thead><tbody><tr><td>Cell 1</td><td>Cell 2</td></tr><tr><td>Cell 3</td><td>Cell 4</td></tr></tbody></table>`;
    const cleanSend = sanitizeOnSend(tableHtml);
    assert(cleanSend.includes("<table>") || cleanSend.includes("<table border=\"1\">"), "Preserves table tag");
    assert(cleanSend.includes("<thead><tr><th>Header A</th>"), "Preserves thead and th");
    assert(cleanSend.includes("<tbody><tr><td>Cell 1</td>"), "Preserves tbody, tr, and td");

    const cleanReceive = sanitizeOnReceive(tableHtml);
    assert(cleanReceive.sanitized.includes("<th>Header A</th>"), "Preserves header cell in reading pane");
    assert(cleanReceive.sanitized.includes("<td>Cell 4</td>"), "Preserves data cell in reading pane");
  });

  await test("test_sanitize_preserves_code_blocks", () => {
    const codeHtml = `<pre><code class="language-javascript">const x = 42;\nconsole.log(x);</code></pre>`;
    const clean = sanitizeOnSend(codeHtml);
    assert(clean.includes("<pre>"), "Preserves pre tag");
    assert(clean.includes("<code"), "Preserves code tag");
    assert(clean.includes("class=\"language-javascript\""), "Preserves language CSS class on code block");
    assert(clean.includes("const x = 42;"), "Preserves code block text content");
  });

  await test("test_paste_from_word_strips_wrapper_html", () => {
    const wordHtml = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
        <head>
          <!--[if gte mso 9]><xml><w:WordDocument><w:View>Normal</w:View></w:WordDocument></xml><![endif]-->
          <style>
            <!-- /* Style Definitions */
            p.MsoNormal, li.MsoNormal, div.MsoNormal { mso-style-parent: ""; margin: 0cm; font-family: Calibri; }
            -->
          </style>
          <meta name="Generator" content="Microsoft Word 15">
        </head>
        <body lang="EN-US">
          <!--StartFragment-->
          <p class="MsoNormal" style="margin-bottom:0cm;mso-margin-top-alt:auto;line-height:normal;mso-outline-level:1">
            <b><span style="font-size:14.0pt;font-family:&quot;Arial&quot;,sans-serif;mso-fareast-font-family:&quot;Times New Roman&quot;;color:#333333">Word Document Title</span></b>
            <o:p></o:p>
          </p>
          <p class="MsoNormal" style="mso-padding-alt:0cm 0cm 0cm 0cm">
            Here is a paragraph with a <a href="https://example.com"><span style="color:#0563C1;mso-themecolor:hyperlink">clean link</span></a>.
          </p>
          <!--EndFragment-->
        </body>
      </html>
    `;

    const cleaned = cleanPastedContent(wordHtml);
    assert(!cleaned.includes("<!--[if"), "Word conditional comment stripped");
    assert(!cleaned.includes("<w:"), "Word XML elements stripped");
    assert(!cleaned.includes("<o:p>"), "Office paragraph XML tag stripped");
    assert(!cleaned.includes("<style"), "Style block stripped");
    assert(!cleaned.includes("MsoNormal"), "Mso CSS class names stripped");
    assert(!cleaned.includes("mso-"), "mso- style declarations stripped");
    assert(cleaned.includes("Word Document Title"), "Preserved heading text content");
    assert(cleaned.includes("<b") || cleaned.includes("<strong"), "Preserved bold semantics");
    assert(cleaned.includes("<a href=\"https://example.com\""), "Preserved valid link");
    assert(cleaned.includes("clean link"), "Preserved link text");
  });

  return { passed, failed };
}
