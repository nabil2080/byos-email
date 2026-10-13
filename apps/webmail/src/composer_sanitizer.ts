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
 * Enforces safe tags and strips any pasted exploit scripts, dangerous URI schemes, etc.
 */
export function sanitizeOnSend(html: string): string {
  if (!html) return "";

  const purifier = getPurifier();

  // Custom URI hook to allow byos-storage:// and data:image/*
  return purifier.sanitize(html, {
    ALLOWED_TAGS: SAFE_OUTGOING_TAGS,
    ALLOWED_ATTR: SAFE_OUTGOING_ATTRS,
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|byos-storage:\/\/|data:image\/(?:png|jpeg|jpg|gif|webp|svg\+xml)[;,])/i,
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input", "button", "meta", "link", "style"],
    FORBID_ATTR: [
      "onclick", "onerror", "onload", "onmouseover", "onfocus", "onblur",
      "onkeydown", "onkeyup", "onchange", "onsubmit", "onreset"
    ],
    FORCE_BODY: true,
  });
}

export interface ReceiveSanitizeResult {
  sanitized: string;
  hasBlockedImages: boolean;
  blockedCount: number;
}

/**
 * Sanitizes incoming HTML for rendering in the reading pane or composer preview.
 * Strips script tags, form inputs, external styling (<style>), on* event handlers,
 * and blocks remote HTTP(S) images unless explicitly allowed by the user.
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

  // Configure DOMPurify hook to inspect and block remote image sources
  const hookName = "afterSanitizeAttributes";
  const hookFn = (node: Element) => {
    if (node.tagName && node.tagName.toLowerCase() === "img") {
      const src = node.getAttribute("src") || "";
      const isRemote = /^https?:\/\//i.test(src);
      const isByosStorage = /^byos-storage:\/\//i.test(src);
      const isDataImage = /^data:image\//i.test(src);

      if (isRemote && !options.allowRemoteImages) {
        hasBlockedImages = true;
        blockedCount++;
        node.setAttribute("data-byos-blocked-src", src);
        node.setAttribute("src", "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16'><rect width='16' height='16' fill='%23E2DFD8'/></svg>");
      } else if (!isRemote && !isByosStorage && !isDataImage) {
        node.removeAttribute("src");
      }
    }
  };

  try {
    purifier.addHook(hookName, hookFn);
  } catch {}

  const sanitized = purifier.sanitize(preProcessed, {
    ALLOWED_TAGS: SAFE_OUTGOING_TAGS,
    ALLOWED_ATTR: [
      ...SAFE_OUTGOING_ATTRS,
      "data-byos-blocked-src",
      "data-language"
    ],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto):|byos-storage:\/\/|data:image\/(?:png|jpeg|jpg|gif|webp|svg\+xml)[;,])/i,
    FORBID_TAGS: [
      "script", "iframe", "object", "embed", "form", "input",
      "button", "meta", "link", "style"
    ],
    FORBID_ATTR: [
      "onclick", "onerror", "onload", "onmouseover", "onfocus", "onblur",
      "onkeydown", "onkeyup", "onchange", "onsubmit", "onreset"
    ],
    FORCE_BODY: true,
  });

  try {
    purifier.removeHook(hookName);
  } catch {}

  return {
    sanitized,
    hasBlockedImages,
    blockedCount,
  };
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
