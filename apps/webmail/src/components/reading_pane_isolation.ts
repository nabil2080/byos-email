/**
 * BYOS Email HTML Isolation & Security Boundaries
 * Pure isolation logic and document generator for ReadingPane.tsx
 */

export const MAX_SINGLE_INLINE_BYTES = 10 * 1024 * 1024; // 10 MB per single image
export const MAX_TOTAL_INLINE_BYTES = 25 * 1024 * 1024;  // 25 MB aggregate binary per message (~33.3 MB base64 heap)
export const MAX_INLINE_IMAGE_COUNT = 25;                // Max 25 inline images per message

export const ALLOWED_INLINE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp"
]);

export function isSafeRasterImage(buffer: ArrayBuffer, declaredType: string): boolean {
  if (declaredType && !ALLOWED_INLINE_MIME_TYPES.has(declaredType.toLowerCase())) {
    return false;
  }
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 4) return false;

  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return true;
  // JPEG: FF D8 FF
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return true;
  // GIF: 47 49 46 38 ("GIF8")
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) return true;
  // WEBP: RIFF .... WEBP
  if (bytes.length >= 12 &&
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return true;
  }

  return false;
}

export interface BuildIsolatedIframeDocOptions {
  contentHtml: string;
  isDark?: boolean;
  fontScale?: "default" | "large" | "xlarge";
  allowRemoteImages?: boolean;
}

/**
 * Builds the isolated HTML document string rendered within the ReadingPane sandboxed iframe srcdoc.
 * Enforces strict Content-Security-Policy with base-uri 'none', script-src 'none', frame-src 'none',
 * and style-src 'unsafe-inline' for layout formatting.
 * Omits any <base> tag to completely eliminate CSP console violation warnings in Chromium.
 */
export function buildIsolatedIframeDoc(options: BuildIsolatedIframeDocOptions): string {
  const isDark = Boolean(options.isDark);
  const scale = options.fontScale;
  const fontSize = scale === "xlarge" ? "18px" : scale === "large" ? "16px" : "14px";
  const textColor = isDark ? "#F3F4F6" : "#1A1B1E";
  const linkColor = isDark ? "#D4A38F" : "#9E725F";

  const allowRemote = Boolean(options.allowRemoteImages);
  const cspDirective = [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    `img-src 'self' data: ${allowRemote ? "https: http:" : ""}`.trim(),
    "media-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "script-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "connect-src 'none'"
  ].join("; ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${cspDirective}">
  <style>
    :root { color-scheme: ${isDark ? "dark" : "light"}; }
    *, *::before, *::after { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      background: transparent;
      color: ${textColor};
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: ${fontSize};
      line-height: 1.6;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }
    img { max-width: 100%; height: auto; border-radius: 6px; }
    pre {
      background: ${isDark ? "#14161A" : "#F7F6F3"};
      border: 1px solid ${isDark ? "#2E3138" : "#E2DFD8"};
      border-radius: 8px;
      padding: 12px 16px;
      overflow-x: auto;
    }
    code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.9em;
      white-space: pre-wrap;
      word-break: break-all;
    }
    a { color: ${linkColor}; text-decoration: underline; }
    blockquote {
      margin: 0.8em 0;
      padding-left: 12px;
      border-left: 3px solid ${isDark ? "#2E3138" : "#E2DFD8"};
      color: ${isDark ? "#878A8E" : "#6E7075"};
    }
    table { max-width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid ${isDark ? "#2E3138" : "#E2DFD8"}; padding: 6px 10px; }
  </style>
</head>
<body>
  ${options.contentHtml}
</body>
</html>`;
}
