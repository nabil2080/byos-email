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

  await test("test_sanitize_does_not_leak_hooks_across_calls", () => {
    const inputRemote = `<p>Test:</p><img src="https://tracker.example.com/pixel.gif" alt="tracker" />`;
    // First run with allowRemoteImages: false
    const blockedResult = sanitizeOnReceive(inputRemote, { allowRemoteImages: false });
    assert(blockedResult.hasBlockedImages, "First run blocks remote image");

    // Second run with allowRemoteImages: true
    const allowedResult = sanitizeOnReceive(inputRemote, { allowRemoteImages: true });
    assert(!allowedResult.hasBlockedImages, "Second run with allowRemoteImages=true must not be blocked by leaked hook");
    assert(allowedResult.sanitized.includes("src=\"https://tracker.example.com/pixel.gif\""), "Remote image src preserved");
  });

  await test("test_sanitize_strips_svg_data_uris", () => {
    const maliciousSvg = `<p>Test</p><img src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'></svg>" alt="svg" />`;
    const sendClean = sanitizeOnSend(maliciousSvg);
    assert(!sendClean.includes("image/svg+xml"), "sanitizeOnSend must block data:image/svg+xml");
    assert(!sendClean.includes("src="), "sanitizeOnSend must strip src with svg data URI");

    const receiveClean = sanitizeOnReceive(maliciousSvg);
    assert(!receiveClean.sanitized.includes("image/svg+xml"), "sanitizeOnReceive must block data:image/svg+xml");
    assert(!receiveClean.sanitized.includes("onload"), "sanitizeOnReceive must not contain onload payload");

    // Safe PNG data URI must be preserved
    const safePng = `<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mOMjY2tBwAEOQFj8j8UkwAAAABJRU5ErkJggg==" alt="dot" />`;
    const sendSafe = sanitizeOnSend(safePng);
    assert(sendSafe.includes("data:image/png;base64,"), "sanitizeOnSend preserves valid PNG data URI");
  });

  await test("test_sanitize_strips_css_url_remote_loading", () => {
    const dangerousCss = `<div style="background-image: url('https://evil.com/leak.png'); color: #1a1b1e; font-size: 14px;">Styled text</div>`;
    const sendClean = sanitizeOnSend(dangerousCss);
    assert(!sendClean.includes("url("), "sanitizeOnSend must strip CSS url(...) declaration");
    assert(!sendClean.includes("evil.com"), "sanitizeOnSend must remove remote leak URL");
    assert(sendClean.includes("color: #1a1b1e"), "sanitizeOnSend preserves safe color style");
    assert(sendClean.includes("font-size: 14px"), "sanitizeOnSend preserves safe font-size style");

    const receiveClean = sanitizeOnReceive(dangerousCss);
    assert(!receiveClean.sanitized.includes("url("), "sanitizeOnReceive must strip CSS url(...)");
    assert(receiveClean.sanitized.includes("color: #1a1b1e"), "sanitizeOnReceive preserves safe styles");
  });

  await test("test_sanitize_strips_css_expression_and_import", () => {
    const exploitCss = `<div style="width: expression(alert(1)); @import 'https://evil.com/style.css'; behavior: url(x); -moz-binding: url(y); margin: 10px;">Content</div>`;
    const sendClean = sanitizeOnSend(exploitCss);
    assert(!sendClean.includes("expression"), "sanitizeOnSend strips CSS expression");
    assert(!sendClean.includes("@import"), "sanitizeOnSend strips CSS @import");
    assert(!sendClean.includes("behavior"), "sanitizeOnSend strips CSS behavior");
    assert(!sendClean.includes("-moz-binding"), "sanitizeOnSend strips CSS -moz-binding");
    assert(sendClean.includes("margin: 10px"), "sanitizeOnSend preserves benign margin");
  });

  await test("test_sanitize_forbids_svg_and_mathml_tags", () => {
    const svgExploit = `<svg><script>alert('svg-xss')</script><circle r="10"/></svg><p>Safe</p>`;
    const sendClean = sanitizeOnSend(svgExploit);
    assert(!sendClean.includes("<svg"), "sanitizeOnSend strips <svg> tag");
    assert(!sendClean.includes("svg-xss"), "sanitizeOnSend strips svg script content");
    assert(sendClean.includes("Safe"), "sanitizeOnSend preserves benign content");

    const mathMlExploit = `<math><mi xlink:href="javascript:alert(1)">click</mi></math>`;
    const receiveClean = sanitizeOnReceive(mathMlExploit);
    assert(!receiveClean.sanitized.includes("<math"), "sanitizeOnReceive strips <math> tag");
    assert(!receiveClean.sanitized.includes("xlink:href"), "sanitizeOnReceive strips xlink:href attribute");
  });

  await test("test_sanitize_strips_all_event_handlers", () => {
    const eventHandlers = `<img src="https://example.com/pic.jpg" onerror="alert('err')" onload="alert('load')" onanimationstart="alert('anim')" />`;
    const sendClean = sanitizeOnSend(eventHandlers);
    assert(!sendClean.includes("onerror"), "sanitizeOnSend strips onerror");
    assert(!sendClean.includes("onload"), "sanitizeOnSend strips onload");
    assert(!sendClean.includes("onanimationstart"), "sanitizeOnSend strips onanimationstart");

    const receiveClean = sanitizeOnReceive(eventHandlers, { allowRemoteImages: true });
    assert(!receiveClean.sanitized.includes("onerror"), "sanitizeOnReceive strips onerror");
    assert(!receiveClean.sanitized.includes("onload"), "sanitizeOnReceive strips onload");
    assert(!receiveClean.sanitized.includes("onanimationstart"), "sanitizeOnReceive strips onanimationstart");
  });

  await test("test_sanitize_enforces_target_blank_and_rel_noopener", () => {
    const linkInput = `<p><a href="https://example.com">Example</a> and <a href="mailto:test@byos.local">Email</a></p>`;
    const sendClean = sanitizeOnSend(linkInput);
    assert(sendClean.includes('target="_blank"'), "sanitizeOnSend adds target=\"_blank\"");
    assert(sendClean.includes('rel="noopener noreferrer"'), "sanitizeOnSend adds rel=\"noopener noreferrer\"");

    const receiveClean = sanitizeOnReceive(linkInput);
    assert(receiveClean.sanitized.includes('target="_blank"'), "sanitizeOnReceive adds target=\"_blank\"");
    assert(receiveClean.sanitized.includes('rel="noopener noreferrer"'), "sanitizeOnReceive adds rel=\"noopener noreferrer\"");
  });

  await test("test_sanitize_overwrites_target_top_and_parent", () => {
    const topLink = `<a href="https://evil.com" target="_top">Navigate Top</a>`;
    const parentLink = `<a href="https://evil.com" target="_parent">Navigate Parent</a>`;

    const sendTop = sanitizeOnSend(topLink);
    assert(!sendTop.includes('target="_top"'), "sanitizeOnSend overwrites target=\"_top\"");
    assert(sendTop.includes('target="_blank"'), "sanitizeOnSend forces target=\"_blank\"");
    assert(sendTop.includes('rel="noopener noreferrer"'), "sanitizeOnSend enforces rel=\"noopener noreferrer\"");

    const receiveParent = sanitizeOnReceive(parentLink);
    assert(!receiveParent.sanitized.includes('target="_parent"'), "sanitizeOnReceive overwrites target=\"_parent\"");
    assert(receiveParent.sanitized.includes('target="_blank"'), "sanitizeOnReceive forces target=\"_blank\"");
    assert(receiveParent.sanitized.includes('rel="noopener noreferrer"'), "sanitizeOnReceive enforces rel=\"noopener noreferrer\"");
  });

  await test("test_sanitize_handles_malformed_html_safely", () => {
    const malformed = `<<SCRIPT>alert("XSS");//<</SCRIPT><img src="javascript:alert(1)" onerror=alert(2)><a href="jav&#x09;ascript:alert(1)">Click</a>`;
    const sendClean = sanitizeOnSend(malformed);
    assert(!sendClean.includes("<script"), "Malformed script tag eliminated");
    assert(!sendClean.includes("javascript:"), "Malformed javascript URI eliminated");
    assert(!sendClean.includes("onerror"), "Malformed onerror eliminated");

    const receiveClean = sanitizeOnReceive(malformed);
    assert(!receiveClean.sanitized.includes("<script"), "sanitizeOnReceive eliminates malformed script tag");
    assert(!receiveClean.sanitized.includes("javascript:"), "sanitizeOnReceive eliminates malformed javascript URI");
    assert(!receiveClean.sanitized.includes("onerror"), "sanitizeOnReceive eliminates malformed onerror");
  });

  await test("test_sanitize_rejects_unsafe_and_relative_link_schemes", () => {
    const maliciousLinks = `
      <p>
        <a id="l1" href="javascript:alert(1)">JS Link</a>
        <a id="l2" href="data:text/html,<script>alert(1)</script>">Data Link</a>
        <a id="l3" href="vbscript:msgbox(1)">VBScript Link</a>
        <a id="l4" href="file:///C:/Windows/System32">File Link</a>
        <a id="l5" href="blob:https://byos.local/1234">Blob Link</a>
        <a id="l6" href="//evil.com/phish">Protocol-Relative Link</a>
        <a id="l7" href="/relative/inbox">Root-Relative Link</a>
        <a id="l8" href="relative/path.html">Relative Path Link</a>
        <a id="l9" href="#section">Hash Link</a>
        <a id="l10" href="https://example.com/safe">Safe HTTPS</a>
        <a id="l11" href="http://example.com/safe">Safe HTTP</a>
        <a id="l12" href="mailto:support@byos.local">Safe Mailto</a>
      </p>
    `;

    const resReceive = sanitizeOnReceive(maliciousLinks).sanitized;
    // Unsafe and relative schemes must have href completely stripped
    assert(!resReceive.includes('href="javascript:'), "Strips javascript: link");
    assert(!resReceive.includes('href="data:'), "Strips data: link");
    assert(!resReceive.includes('href="vbscript:'), "Strips vbscript: link");
    assert(!resReceive.includes('href="file:'), "Strips file: link");
    assert(!resReceive.includes('href="blob:'), "Strips blob: link");
    assert(!resReceive.includes('href="//evil.com'), "Strips protocol-relative link");
    assert(!resReceive.includes('href="/relative/'), "Strips root-relative link");
    assert(!resReceive.includes('href="relative/'), "Strips relative path link");
    assert(!resReceive.includes('href="#section"'), "Strips hash link");

    // Safe schemes must be preserved and decorated with target="_blank" and rel="noopener noreferrer"
    assert(resReceive.includes('href="https://example.com/safe" target="_blank" rel="noopener noreferrer"'), "Preserves safe HTTPS link with target and rel");
    assert(resReceive.includes('href="http://example.com/safe" target="_blank" rel="noopener noreferrer"'), "Preserves safe HTTP link with target and rel");
    assert(resReceive.includes('href="mailto:support@byos.local" target="_blank" rel="noopener noreferrer"'), "Preserves safe mailto link with target and rel");

    const resSend = sanitizeOnSend(maliciousLinks);
    assert(!resSend.includes('href="javascript:'), "sanitizeOnSend strips javascript: link");
    assert(!resSend.includes('href="data:'), "sanitizeOnSend strips data: link");
    assert(!resSend.includes('href="vbscript:'), "sanitizeOnSend strips vbscript: link");
    assert(!resSend.includes('href="file:'), "sanitizeOnSend strips file: link");
    assert(!resSend.includes('href="blob:'), "sanitizeOnSend strips blob: link");
    assert(!resSend.includes('href="//evil.com'), "sanitizeOnSend strips protocol-relative link");
    assert(!resSend.includes('href="/relative/'), "sanitizeOnSend strips root-relative link");
    assert(!resSend.includes('href="relative/'), "sanitizeOnSend strips relative path link");
    assert(!resSend.includes('href="#section"'), "sanitizeOnSend strips hash link");
    assert(resSend.includes('href="https://example.com/safe" target="_blank" rel="noopener noreferrer"'), "sanitizeOnSend preserves safe HTTPS link");
  });

  return { passed, failed };
}
