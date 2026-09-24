export interface ParsedMime {
  textPlain: string | null;
  textHtml: string | null;
}

/**
 * Parses an RFC 822 MIME message and extracts the text/plain and text/html 
 * parts. Handles:
 *   - Simple text/plain or text/html (no multipart)
 *   - multipart/alternative with one text/plain and/or text/html part
 *   - multipart/mixed with nested parts (takes the first text part found)
 *
 * Charset decoding: UTF-8 assumed. If Content-Transfer-Encoding is 
 * quoted-printable or base64, that's NOT handled in this V1 parser — 
 * external mail that uses those encodings will show the raw encoding.
 * This is a known limitation; BYOS-native mail always uses 8bit UTF-8.
 */
export function parseMime(raw: string): ParsedMime {
  // 1. Split headers from body at first blank line
  const headerEnd = raw.search(/\r?\n\r?\n/);
  if (headerEnd === -1) {
    // No headers. Treat the whole thing as plaintext.
    return { textPlain: raw.trim(), textHtml: null };
  }

  const headers = raw.slice(0, headerEnd);
  const body = raw.slice(headerEnd).replace(/^\r?\n\r?\n/, "");

  // 2. Get the Content-Type header (case-insensitive, may span lines)
  const contentType = getHeader(headers, "content-type") || "text/plain";

  // 3. Simple case
  if (contentType.startsWith("text/plain")) {
    return { textPlain: body.trim(), textHtml: null };
  }
  if (contentType.startsWith("text/html")) {
    return { textPlain: null, textHtml: body.trim() };
  }

  // 4. Multipart case
  if (contentType.startsWith("multipart/")) {
    const boundary = extractBoundary(contentType);
    if (!boundary) {
      return { textPlain: body.trim(), textHtml: null };
    }

    const parts = splitMultipart(body, boundary);
    let textPlain: string | null = null;
    let textHtml: string | null = null;

    for (const part of parts) {
      const parsed = parseMime(part);
      if (parsed.textPlain && !textPlain) textPlain = parsed.textPlain;
      if (parsed.textHtml && !textHtml) textHtml = parsed.textHtml;
    }

    return { textPlain, textHtml };
  }

  // 5. Unknown type — dump the body as plaintext
  return { textPlain: body.trim(), textHtml: null };
}

export function getHeader(headers: string, name: string): string | null {
  const lines = headers.split(/\r?\n/);
  const lowerName = name.toLowerCase();
  let value = "";
  let capturing = false;
  for (const line of lines) {
    if (capturing) {
      if (line.startsWith(" ") || line.startsWith("\t")) {
        value += " " + line.trim();
        continue;
      } else {
        break;
      }
    }
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const hName = line.slice(0, colon).toLowerCase();
    if (hName === lowerName) {
      value = line.slice(colon + 1).trim();
      capturing = true;
    }
  }
  return value || null;
}

function extractBoundary(contentType: string): string | null {
  const match = contentType.match(/boundary="?([^";]+)"?/i);
  return match ? match[1] : null;
}

function splitMultipart(body: string, boundary: string): string[] {
  const delimiter = `--${boundary}`;
  const parts: string[] = [];
  const lines = body.split(/\r?\n/);
  let current: string[] = [];
  let inPart = false;

  for (const line of lines) {
    if (line === delimiter) {
      if (inPart && current.length > 0) {
        parts.push(current.join("\n"));
      }
      current = [];
      inPart = true;
    } else if (line === `${delimiter}--`) {
      if (inPart && current.length > 0) {
        parts.push(current.join("\n"));
      }
      break;
    } else if (inPart) {
      current.push(line);
    }
  }

  return parts;
}
