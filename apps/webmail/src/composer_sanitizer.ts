import DOMPurify from "dompurify";

let purifyInstance: any = null;

/**
 * Returns a configured DOMPurify instance.
 * Automatically initializes a JSDOM window if running in Node.js test environment.
 */
export function getPurifier(): any {
  if (purifyInstance && typeof purifyInstance.sanitize === "function") {
    return purifyInstance;
  }

  const raw = DOMPurify as any;
  const factory = typeof raw === "function" ? raw : typeof raw?.default === "function" ? raw.default : null;

  const win = (typeof window !== "undefined" && window.document?.nodeType === 9)
    ? window
    : ((globalThis as any).window?.document?.nodeType === 9 ? (globalThis as any).window : null);

  if (factory && win) {
    purifyInstance = factory(win);
  } else if (typeof raw?.sanitize === "function") {
    purifyInstance = raw;
  } else if (typeof raw?.default?.sanitize === "function") {
    purifyInstance = raw.default;
  }

  return purifyInstance;
}

/**
 * Strips Microsoft Word and Google Docs proprietary wrappers and inline metadata.
 */
export function stripWordDocsWrappers(html: string): string {
  if (!html) return "";

  let cleaned = html;

  // Strip conditional comments <!--[if ...]>...<![endif]-->
  cleaned = cleaned.replace(/<!--\[if[\s\S]*?<!\[endif\]-->/gi, "");
  // Strip XML tags e.g. <o:p>...</o:p>, <w:WordDocument>, etc.
  cleaned = cleaned.replace(/<\/?\w+:[^>]*>/gi, "");
  // Strip <style> blocks and <xml> blocks
  cleaned = cleaned.replace(/<style[\s\S]*?<\/style>/gi, "");
  cleaned = cleaned.replace(/<xml[\s\S]*?<\/xml>/gi, "");
  // Strip <meta> and <link> tags
  cleaned = cleaned.replace(/<meta[^>]*>/gi, "");
  cleaned = cleaned.replace(/<link[^>]*>/gi, "");

  // Strip mso-* CSS styles
  cleaned = cleaned.replace(/style="[^"]*"/gi, (match) => {
    const styleContent = match.slice(7, -1);
    const safeDeclarations = styleContent
      .split(";")
      .map((d) => d.trim())
      .filter((d) => d && !d.toLowerCase().startsWith("mso-") && !d.toLowerCase().startsWith("panose-"))
      .join("; ");
    return safeDeclarations ? `style="${safeDeclarations}"` : "";
  });

  // Strip class names like MsoNormal, MsoListParagraph, etc.
  cleaned = cleaned.replace(/\s*class="[^"]*Mso[^"]*"/gi, "");
  cleaned = cleaned.replace(/\s*class="[^"]*docs-internal-guid[^"]*"/gi, "");

  return cleaned.trim();
}

/**
 * Safe URI regex for email links, inline images, and zero-knowledge storage pointers.
 * SVG data URIs (data:image/svg+xml) are strictly excluded because SVGs can contain executable script payloads.
 */
export const SAFE_URI_REGEXP = /^(?:(?:https?|mailto):|byos-storage:\/\/|data:image\/(?:png|jpeg|jpg|gif|webp)[;,])/i;

/**
 * 1x1 neutral gray PNG data URI placeholder for blocked remote tracking images.
 * Uses inert raster PNG data instead of scriptable SVG to prevent parser differential attacks.
 */
export const BLOCKED_IMAGE_PLACEHOLDER = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mOMjY2tBwAEOQFj8j8UkwAAAABJRU5ErkJggg==";

/**
 * Strips dangerous CSS declarations (such as url(...), expression(...), @import, -moz-binding, behavior)
 * from inline style attributes while preserving benign typography, layout, and colors.
 */
export function sanitizeInlineStyle(styleStr: string): string {
  if (!styleStr) return "";

  return styleStr
    .split(";")
    .map((declaration) => declaration.trim())
    .filter((declaration) => {
      if (!declaration) return false;
      // Strip any declaration containing CSS url(...) or remote resource loading
      if (/url\s*\(/i.test(declaration)) return false;
      // Strip expression, @import, behavior, -moz-binding, and javascript:
      if (/expression\s*\(/i.test(declaration)) return false;
      if (/@import/i.test(declaration)) return false;
      if (/-moz-binding/i.test(declaration)) return false;
      if (/behavior\s*:/i.test(declaration)) return false;
      if (/javascript\s*:/i.test(declaration)) return false;
      return true;
    })
    .join("; ");
}

/**
 * Comprehensive list of forbidden event handler and executable attributes.
 */
export const FORBID_ATTR_LIST = [
  "onclick", "ondblclick", "onmousedown", "onmouseup", "onmouseover", "onmousemove",
  "onmouseout", "onmouseenter", "onmouseleave", "onkeydown", "onkeypress", "onkeyup",
  "onload", "onerror", "onunload", "onresize", "onscroll", "onfocus", "onblur",
  "onchange", "onsubmit", "onreset", "onselect", "oncontextmenu", "oninput", "oninvalid",
  "onanimationstart", "onanimationend", "onanimationiteration", "ontransitionend",
  "ontoggle", "onwheel", "oncopy", "oncut", "onpaste", "onpointerdown", "onpointerup",
  "onpointerover", "onpointerout", "onpointerenter", "onpointerleave", "onpointermove",
  "formaction", "action", "xlink:href"
];

/**
 * Tags that must never appear in either incoming or outgoing email HTML.
 * Includes executable tags, nested framing, forms, style blocks, and scriptable XML (SVG, MathML).
 */
export const FORBID_TAGS_LIST = [
  "script", "iframe", "object", "embed", "form", "input",
  "button", "meta", "link", "style", "svg", "math", "base", "applet"
];

/**
 * Safe tag subset allowed on send (composer outgoing messages).
 */
export const SAFE_OUTGOING_TAGS = [
  "p", "br", "strong", "b", "em", "i", "u", "s", "strike", "del",
  "a", "ul", "ol", "li", "blockquote", "pre", "code",
  "table", "thead", "tbody", "tfoot", "tr", "td", "th",
  "img", "hr", "h1", "h2", "h3", "h4", "h5", "h6",
  "span", "div"
];

/**
 * Safe attributes allowed on send.
 */
export const SAFE_OUTGOING_ATTRS = [
  "href", "target", "rel", "src", "alt", "title", "class",
  "style", "colspan", "rowspan", "border", "align", "width", "height"
];

/**
 * Sanitizes outgoing HTML before client-side encryption.
 * Enforces safe tags, strips exploit scripts, CSS url() leaks, SVG data URIs,
 * and ensures all external links open safely with target="_blank" and rel="noopener noreferrer".
 */
export function sanitizeOnSend(html: string): string {
  if (!html) return "";

  const purifier = getPurifier();

  const hookName = "afterSanitizeAttributes";
  const hookFn = (node: Element) => {
    // 1. Sanitize inline style: strip any url(...) or CSS exfiltration
    if (node.hasAttribute("style")) {
      const cleaned = sanitizeInlineStyle(node.getAttribute("style") || "");
      if (cleaned) {
        node.setAttribute("style", cleaned);
      } else {
        node.removeAttribute("style");
      }
    }

    // 2. Enforce target="_blank" and rel="noopener noreferrer" on external links
    // Strictly restrict link schemes to http, https, and mailto.
    // Explicitly reject javascript:, data:, vbscript:, file:, blob:, protocol-relative (//...),
    // and relative URLs so they cannot resolve unexpectedly or execute payloads.
    if (node.tagName && node.tagName.toLowerCase() === "a") {
      const href = (node.getAttribute("href") || "").trim();
      const isSafeLink = /^(?:https?:|mailto:)/i.test(href);
      if (isSafeLink) {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      } else {
        node.removeAttribute("href");
        node.removeAttribute("target");
        node.removeAttribute("rel");
      }
    }

    // 3. Forbid SVG data URIs on images
    if (node.tagName && node.tagName.toLowerCase() === "img") {
      const src = node.getAttribute("src") || "";
      if (/^data:image\/svg\+xml/i.test(src)) {
        node.removeAttribute("src");
      }
    }

    // 4. Strip any attribute starting with "on"
    const attrs = Array.from(node.attributes);
    for (const attr of attrs) {
      if (/^on/i.test(attr.name)) {
        node.removeAttribute(attr.name);
      }
    }
  };

  try {
    purifier.addHook(hookName, hookFn);

    return purifier.sanitize(html, {
      USE_PROFILES: { html: true, svg: false, mathMl: false },
      ALLOWED_TAGS: SAFE_OUTGOING_TAGS,
      ALLOWED_ATTR: SAFE_OUTGOING_ATTRS,
      ALLOWED_URI_REGEXP: SAFE_URI_REGEXP,
      FORBID_TAGS: FORBID_TAGS_LIST,
      FORBID_ATTR: FORBID_ATTR_LIST,
      FORCE_BODY: true,
    });
  } finally {
    try {
      purifier.removeHook(hookName, hookFn);
    } catch {}
  }
}

export interface ReceiveSanitizeResult {
  sanitized: string;
  hasBlockedImages: boolean;
  blockedCount: number;
}

/**
 * Sanitizes incoming HTML for rendering in the isolated reading pane iframe.
 * Strips script tags, form inputs, external styling (<style>), on* event handlers,
 * strips CSS url() exfiltration, blocks SVG data URIs, blocks remote HTTP(S) images
 * unless explicitly allowed, and enforces target="_blank" and rel="noopener noreferrer"
 * on all external links.
 */
export function sanitizeOnReceive(
  html: string,
  options: { allowRemoteImages?: boolean } = {}
): ReceiveSanitizeResult {
  if (!html) {
    return { sanitized: "", hasBlockedImages: false, blockedCount: 0 };
  }

  const purifier = getPurifier();

  let hasBlockedImages = false;
  let blockedCount = 0;

  // First pass: strip <style> blocks completely and normalize HTML
  const preProcessed = html.replace(/<style[\s\S]*?<\/style>/gi, "");

  // Configure DOMPurify hook to inspect and block remote image sources, CSS url(), and links
  const hookName = "afterSanitizeAttributes";
  const hookFn = (node: Element) => {
    // 1. Sanitize inline style: strip any url(...) or CSS exfiltration
    if (node.hasAttribute("style")) {
      const cleaned = sanitizeInlineStyle(node.getAttribute("style") || "");
      if (cleaned) {
        node.setAttribute("style", cleaned);
      } else {
        node.removeAttribute("style");
      }
    }

    // 2. Enforce target="_blank" and rel="noopener noreferrer" on all external links
    // Strictly restrict link schemes to http, https, and mailto.
    // Explicitly reject javascript:, data:, vbscript:, file:, blob:, protocol-relative (//...),
    // and relative paths so they cannot resolve against the parent or host origin.
    if (node.tagName && node.tagName.toLowerCase() === "a") {
      const href = (node.getAttribute("href") || "").trim();
      const isSafeLink = /^(?:https?:|mailto:)/i.test(href);
      if (isSafeLink) {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
      } else {
        node.removeAttribute("href");
        node.removeAttribute("target");
        node.removeAttribute("rel");
      }
    }

    // 3. Inspect image sources and block remote images or SVG data URIs
    if (node.tagName && node.tagName.toLowerCase() === "img") {
      const src = node.getAttribute("src") || "";
      const isRemote = /^https?:\/\//i.test(src);
      const isByosStorage = /^byos-storage:\/\//i.test(src);
      const isSafeDataImage = /^data:image\/(?:png|jpeg|jpg|gif|webp)[;,]/i.test(src);

      // Block srcset if remote images are disallowed
      if (!options.allowRemoteImages && node.hasAttribute("srcset")) {
        node.removeAttribute("srcset");
      }

      if (isRemote && !options.allowRemoteImages) {
        hasBlockedImages = true;
        blockedCount++;
        node.setAttribute("data-byos-blocked-src", src);
        node.setAttribute("src", BLOCKED_IMAGE_PLACEHOLDER);
      } else if (!isRemote && !isByosStorage && !isSafeDataImage) {
        node.removeAttribute("src");
      }
    }

    // 4. Strip any attribute starting with "on"
    const attrs = Array.from(node.attributes);
    for (const attr of attrs) {
      if (/^on/i.test(attr.name)) {
        node.removeAttribute(attr.name);
      }
    }
  };

  try {
    purifier.addHook(hookName, hookFn);

    const sanitized = purifier.sanitize(preProcessed, {
      USE_PROFILES: { html: true, svg: false, mathMl: false },
      ALLOWED_TAGS: SAFE_OUTGOING_TAGS,
      ALLOWED_ATTR: [
        ...SAFE_OUTGOING_ATTRS,
        "data-byos-blocked-src",
        "data-language"
      ],
      ALLOWED_URI_REGEXP: SAFE_URI_REGEXP,
      FORBID_TAGS: FORBID_TAGS_LIST,
      FORBID_ATTR: FORBID_ATTR_LIST,
      FORCE_BODY: true,
    });

    return {
      sanitized,
      hasBlockedImages,
      blockedCount,
    };
  } finally {
    try {
      purifier.removeHook(hookName, hookFn);
    } catch {}
  }
}

/**
 * Cleans pasted clipboard content (handling Word/Docs wrapper HTML or raw text).
 */
export function cleanPastedContent(html: string, plainText?: string): string {
  if (html && html.trim()) {
    const stripped = stripWordDocsWrappers(html);
    return sanitizeOnSend(stripped);
  }

  if (plainText && plainText.trim()) {
    // Convert plain text newlines to <br> or paragraphs
    return plainText
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\r?\n/g, "<br>");
  }

  return "";
}
