# BYOS Release C1: Email HTML Rendering Isolation Report

## What was built

Release C1 eliminates the direct DOM injection vulnerability in Webmail's email reading pane and hardens both outbound and inbound HTML sanitization policies. Untrusted email HTML (and plain-text messages) is now rendered exclusively inside an isolated `iframe` element configured with `sandbox="allow-popups allow-popups-to-escape-sandbox"`, omitting both `allow-scripts` and `allow-same-origin`. This forces the browser engine to assign a unique, opaque `null` origin to the email body, preventing script execution, cookie access, local storage access, and DOM traversal into the parent Webmail application. Both HTML and plain-text messages now route through the sandboxed frame, completely removing the legacy unsandboxed rendering path. The outbound and inbound sanitizer in `composer_sanitizer.ts` was hardened to forbid SVG data URIs (`data:image/svg+xml`), strip remote CSS resources and `url(...)` declarations from inline `style` attributes, enforce `target="_blank"` and `rel="noopener noreferrer"` on all external links, strip `target="_top"` and `target="_parent"` navigation attempts, and replace scriptable SVG placeholders with inert 1x1 raster PNG data. Zero-knowledge inline attachments (`byos-storage://`) are reactively decrypted client-side and resolved directly to origin-independent `data:` URLs before rendering in the isolated frame.

## Files edited

| File | Reason |
|------|--------|
| `apps/webmail/src/components/ReadingPane.tsx` | Replaced direct `innerHTML` injection with a sandboxed `iframe` (`sandbox="allow-popups allow-popups-to-escape-sandbox"`), added client-side `byos-storage://` data URL resolver, unified HTML and plain-text into a single isolated document pipeline, and removed object URL leaks. |
| `apps/webmail/src/composer_sanitizer.ts` | Hardened sanitizer policy: excluded `data:image/svg+xml`, stripped CSS `url(...)`/expressions/imports in inline styles, enforced `target="_blank"` and `rel="noopener noreferrer"`, forbade `<svg>`/`<math>` tags and all `on*` event handlers, and replaced blocked image placeholder with inert 1x1 raster PNG. |
| `apps/webmail/src/composer_sanitizer.test.ts` | Added comprehensive test suite covering script execution attempts, event handlers, SVG data URIs, CSS `url(...)` leaks, CSS expressions, MathML/SVG tag removal, link protection, parent navigation override, and malformed HTML. |
| `apps/webmail/src/components/notes/NotesEditor.tsx` | Aligned top header actions bar surface styling to match ReadingPane (`bg-[#FAF9F6] dark:bg-[#18191D]`). |

## Sanitizer Policy Before and After

| Policy Dimension | Before (Working Tree Baseline) | After (Release C1 Hardened) |
|------------------|--------------------------------|-----------------------------|
| **Rendering Sink** | `<div ref={readingContentRef} innerHTML={...} />` in main Webmail DOM | `<iframe sandbox="allow-popups allow-popups-to-escape-sandbox" srcdoc={...} />` |
| **Iframe Origin** | None (direct DOM injection into main app window) | Unique opaque origin (`null`), zero access to parent DOM or storage |
| **Script Execution** | Dependent entirely on DOMPurify parser accuracy in main DOM | Blocked at both layers: DOMPurify strips scripts, and browser sandbox forbids `allow-scripts` |
| **SVG Data URIs** | Permitted in `ALLOWED_URI_REGEXP` (`data:image/svg+xml`) | Strictly forbidden; regex restricted to raster formats (`png`, `jpeg`, `jpg`, `gif`, `webp`) |
| **CSS `url(...)` in `style`** | Allowed in inline styles (leaking client IP/User-Agent via CSS background) | Stripped via `sanitizeInlineStyle()`; declarations with `url(...)`, `expression()`, `@import`, `-moz-binding`, `behavior:` removed |
| **External Links** | Unconstrained `target`; lacked automatic `rel="noopener noreferrer"` | All `<a>` tags with `href` forced to `target="_blank"` and `rel="noopener noreferrer"` |
| **Parent Navigation** | Attacker HTML could specify `target="_top"` or `target="_parent"` | Stripped by sanitizer hook and structurally denied by sandbox (`allow-top-navigation` omitted) |
| **Blocked Image Placeholder** | Inline SVG data URI (`data:image/svg+xml;utf8,<svg...`) | Inert 1x1 gray raster PNG data URI (`BLOCKED_IMAGE_PLACEHOLDER`) |
| **SVG & MathML Tags** | Default DOMPurify behavior | Explicitly disabled via `USE_PROFILES: { html: true, svg: false, mathMl: false }` and `FORBID_TAGS_LIST` |
| **Inline Media Decryption** | Generated `blob:` URLs in parent origin (inaccessible to opaque iframes) | Converted client-side via `FileReader.readAsDataURL` to origin-independent `data:` URLs |
| **Plain Text Fallback** | Unsandboxed `<div>` in main document | Unified into sandboxed `iframe` as escaped `<pre>` text (zero unsandboxed path) |

## Iframe Sandbox Configuration

The isolated iframe in `ReadingPane.tsx` is configured with:

```html
<iframe
  data-testid="reading-pane-iframe"
  class="reading-pane-content w-full min-h-[420px] flex-1 border-0 rounded-lg bg-transparent transition-all duration-150"
  sandbox="allow-popups allow-popups-to-escape-sandbox"
  srcdoc={isolatedIframeDoc()}
  title="Email message body"
/>
```

1. **`allow-scripts` OMITTED:** JavaScript, VBScript, and event handlers are completely disabled by the browser rendering engine. Even if an attacker crafts an engine-level DOMPurify bypass, no script can execute.
2. **`allow-same-origin` OMITTED:** The frame is treated as being from a unique opaque origin (`null`). It cannot read or modify the parent window's `window`, `document`, `localStorage`, `sessionStorage`, `indexedDB`, or `document.cookie`.
3. **`allow-top-navigation` OMITTED:** The email cannot navigate the main Webmail application window to phishing or credential-harvesting pages.
4. **`allow-popups allow-popups-to-escape-sandbox` INCLUDED:** Safe external links opened by the user open in a new tab/window without inheriting sandbox restrictions that would break the external destination.
5. **`<base target="_blank">` INCLUDED IN SRCDOC:** Forces any link click to target a new browsing context.
6. **`rel="noopener noreferrer"` ENFORCED:** Outgoing links are severed from the opener browsing context.

## Raw Evidence

### 1. Test Suite Execution (`npm test`)

The complete Webmail test suite was executed:
```
cmd /c "cd apps\webmail && npm test"
```

Output:
```
> test
> npx tsx --experimental-wasm-modules src/run_test.node.js

(node:20864) ExperimentalWarning: Importing WebAssembly modules is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
Running Attachment Crypto Tests...
  ✓ Plaintext is not equal to encrypted ciphertext envelope
  ✓ Decrypt(ciphertext, correct_key) returns original plaintext
  ✓ Tampered ciphertext fails decryption
  ✓ Decrypting with wrong key fails
  ✓ No plaintext file bytes stored or logged
  ✓ test_attachment_encrypt_decrypt_roundtrip: encrypt small file, upload, download, decrypt, verify hash
  ✓ test_attachment_chunking: encrypt 5 MB file, assert 5 chunks, decrypt and reassemble
[Worker Crypto] Decryption failed for attachment_id=85967973-9a5b-412d-9d45-242c3f328857 chunk_index=1
  ✓ test_attachment_corrupt_chunk_isolated: corrupt one chunk, assert other attachments decrypt and corrupted is marked
  ✓ test_attachment_iv_unique_per_chunk: encrypt 5-chunk file, assert all IVs are distinct
[Worker Crypto] Hash mismatch for attachment_id=99e50346-4de7-4496-9fd8-e8116483e96c (expected=dGFtcGVyZWRfaGFz..., actual=XO4NYUR2sCO0/Rlu...)
  ✓ test_attachment_hash_mismatch_marks_corrupted: tampered content hash marks attachment corrupted without producing partial output
  ✓ test_attachment_empty_file_roundtrip: 0-byte file encrypt, upload, download, decrypt returns 0-byte file and no error
  ✓ test_attachment_unicode_filename_roundtrip: non-ASCII unicode filename round-trips byte-for-byte
  ✓ test_attachment_full_flow_roundtrip: key gen -> chunk -> encrypt -> mock upload -> mock download -> decrypt -> hash-match
  ✓ test_wasm_unavailable_throws_not_falls_back: wrapAttachmentContentKey and unwrapAttachmentContentKey throw when WASM is unavailable
  ✓ Content key generation produces 32 bytes
  ✓ Base IV generation produces 12 bytes
  ✓ Chunk IV generation produces 12 bytes
  ✓ Attachment encryption roundtrip: 1 byte
  ✓ Attachment encryption roundtrip: 64 bytes
[Worker Crypto] Decryption failed for attachment_id=81ae114b-6628-458a-80db-720c22ab69d5 chunk_index=0
  ✓ Path A recipient cannot decrypt sender chunks
  ✓ Protocol v2 golden test vectors match Rust crypto-core
  ✓ Protocol v2 owner encrypt/decrypt + outbound grant roundtrip + tamper rejection
ATTACHMENT CRYPTO TESTS: 22 passed, 0 failed

Running Composer Sanitizer Tests...
  ✓ test_sanitize_strips_script_tags
  ✓ test_sanitize_strips_onclick_handlers
  ✓ test_sanitize_strips_javascript_hrefs
  ✓ test_sanitize_allows_safe_tags
  ✓ test_sanitize_allows_byos_storage_images
  ✓ test_sanitize_blocks_remote_images_by_default
  ✓ test_sanitize_preserves_table_structure
  ✓ test_sanitize_preserves_code_blocks
  ✓ test_paste_from_word_strips_wrapper_html
  ✓ test_sanitize_does_not_leak_hooks_across_calls
  ✓ test_sanitize_strips_svg_data_uris
  ✓ test_sanitize_strips_css_url_remote_loading
  ✓ test_sanitize_strips_css_expression_and_import
  ✓ test_sanitize_forbids_svg_and_mathml_tags
  ✓ test_sanitize_strips_all_event_handlers
  ✓ test_sanitize_enforces_target_blank_and_rel_noopener
  ✓ test_sanitize_overwrites_target_top_and_parent
  ✓ test_sanitize_handles_malformed_html_safely
COMPOSER SANITIZER TESTS: 18 passed, 0 failed

OVERALL: 726 passed, 0 failed
```

The test run produced:
PASS
```
OVERALL: 726 passed, 0 failed
```

### 2. Production Vite Build (`npm run build`)

Command:
```
cmd /c "cd apps\webmail && npm run build"
```

Output:
```
> build
> vite build

vite v6.4.5 building for production...
transforming...
✓ 337 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                                    1.86 kB │ gzip:   0.88 kB
dist/assets/crypto_worker-Djt23sOy.js             11.80 kB
dist/assets/byos_crypto_core-BFtJ6tPk.js          24.57 kB
dist/assets/byos_crypto_core_bg-SpaQFAPe.wasm    600.28 kB │ gzip: 266.63 kB
dist/assets/highlight-BfC0goYb.css                 1.31 kB │ gzip:   0.61 kB
dist/assets/index-D_MgnkLV.css                   172.38 kB │ gzip:  26.12 kB
dist/assets/highlight-jJRd6xAr.js                 73.95 kB │ gzip:  23.65 kB
dist/assets/index-B_KTo82i.js                  3,587.00 kB │ gzip: 777.45 kB
✓ built in 10.19s
```

The build run produced:
PASS
```
✓ built in 10.19s
```

### 3. Git Status and Working Tree Diff Verification

Command:
```
git status --short
```

Output:
```
 M apps/webmail/src/components/ReadingPane.tsx
 M apps/webmail/src/components/notes/NotesEditor.tsx
 M apps/webmail/src/composer_sanitizer.test.ts
 M apps/webmail/src/composer_sanitizer.ts
?? docs/email_html_isolation_release_c1_report.md
```

## Manual Browser Verification

Manual verification in a live browser session is **UNTESTED** in this headless CLI turn because the local dev server (`http://127.0.0.1:3001` / `http://localhost:3000`) was not running during this turn.

Exact manual steps to verify in browser:
1. Start the webmail development server:
   ```bash
   cd apps/webmail && npm run dev
   ```
2. Open Chrome or Chromium DevTools at `http://localhost:3000`.
3. Log in with user credentials and open an email message in the Inbox.
4. Inspect the email content area with DevTools element inspector:
   - Verify the element is an `<iframe>` with `sandbox="allow-popups allow-popups-to-escape-sandbox"`.
   - Verify `<iframe srcdoc="...">` contains `<!DOCTYPE html>` with `<base target="_blank">`.
   - In DevTools console, run:
     ```js
     const iframe = document.querySelector('iframe.reading-pane-content');
     console.log('contentDocument:', iframe.contentDocument);
     ```
     Confirm `iframe.contentDocument` is `null` (opaque origin enforcement).
5. Send a test email containing:
   - `<script>alert('xss')</script>`: Confirm no script executes and alert does not fire.
   - `<a href="https://example.com" target="_top">Link</a>`: Click the link and confirm it opens in a new tab without navigating the parent window.
   - `<img src="byos-storage://...">`: Confirm decrypted image renders properly from data URL.
   - `<img src="https://example.com/tracker.png">`: Confirm tracker is blocked with neutral 1x1 placeholder.

## What Did Not Work or Is Untested

1. **Automatic Content Height Resizing:** Because an opaque sandboxed iframe (`sandbox` without `allow-same-origin`) has a unique null origin, parent JavaScript cannot read `iframe.contentDocument.body.scrollHeight`. Furthermore, because `allow-scripts` is strictly omitted, the iframe cannot execute scripts to post height messages to the parent. The iframe therefore uses a responsive `min-h-[420px]` layout with native container scrolling, which is the standard secure pattern used by privacy-focused webmail clients.
2. **Live Browser End-to-End Test Execution:** Headless browser tests requiring the local dev server on port 3001 were not executed during this turn because no HTTP daemon was active. Unit tests, sanitizer security vectors, and production Vite compilation passed completely.

## Remaining Security Concerns

1. **Parser Differential Between DOMPurify and Browser HTML Parsers:** While DOMPurify runs before `srcdoc` injection, modern browser engines may have subtle parsing quirks. The sandboxed iframe (`sandbox` without `allow-scripts` and without `allow-same-origin`) provides defense-in-depth: even if DOMPurify failed to strip a novel HTML payload, the browser engine strictly disables JavaScript execution inside the iframe.
2. **Data URL Memory Usage on Large Inline Image Sets:** Decrypting dozens of multi-megabyte inline attachments into `data:` base64 strings increases memory overhead relative to streamable resources. However, this is required because Chromium blocks cross-origin `blob:` URLs in opaque-origin iframes.
3. **Phishing Text Content:** HTML isolation prevents DOM manipulation, script execution, and cookie theft, but cannot prevent social engineering or phishing text within the message body. BYOS's sender verification and domain authentication remain the primary controls against spoofing.
