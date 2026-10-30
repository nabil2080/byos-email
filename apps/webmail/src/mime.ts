export interface CalendarMimePart {
  method?: string; // e.g. "REQUEST", "REPLY", "CANCEL", "PUBLISH"
  rawIcs: string;
}

export interface ParsedMime {
  textPlain: string | null;
  textHtml: string | null;
  calendarPart?: CalendarMimePart | null;
}

/**
 * Parses an RFC 822 MIME message and extracts the text/plain, text/html,
 * and text/calendar (iTIP invitations / .ics) parts. Handles:
 *   - Simple text/plain or text/html (no multipart)
 *   - text/calendar or application/ics direct body
 *   - multipart/alternative with text/plain, text/html, and text/calendar
 *   - multipart/mixed with nested parts
 *   - Inline BEGIN:VCALENDAR fallback detection
 */
export function parseMime(raw: string): ParsedMime {
  // 1. Split headers from body at first blank line
  const headerEnd = raw.search(/\r?\n\r?\n/);
  if (headerEnd === -1) {
    // No headers. Treat the whole thing as plaintext, check for inline VCALENDAR
    const vcalMatch = raw.match(/BEGIN:VCALENDAR[\s\S]*?END:VCALENDAR/i);
    return {
      textPlain: raw.trim(),
      textHtml: null,
      calendarPart: vcalMatch ? { rawIcs: vcalMatch[0].trim() } : null,
    };
  }

  const headers = raw.slice(0, headerEnd);
  const body = raw.slice(headerEnd).replace(/^\r?\n\r?\n/, "");

  // 2. Get the Content-Type header (preserve case for boundary)
  const contentType = getHeader(headers, "content-type") || "text/plain";
  const ctLower = contentType.toLowerCase();

  // 3. Calendar direct part
  if (ctLower.startsWith("text/calendar") || ctLower.startsWith("application/ics")) {
    const methodMatch = contentType.match(/method="?([^";]+)"?/i);
    const method = methodMatch ? methodMatch[1].toUpperCase().trim() : undefined;
    return {
      textPlain: null,
      textHtml: null,
      calendarPart: { method, rawIcs: body.trim() },
    };
  }

  // 4. Simple text cases
  if (ctLower.startsWith("text/plain")) {
    const vcalMatch = body.match(/BEGIN:VCALENDAR[\s\S]*?END:VCALENDAR/i);
    return {
      textPlain: body.trim(),
      textHtml: null,
      calendarPart: vcalMatch ? { rawIcs: vcalMatch[0].trim() } : null,
    };
  }
  if (ctLower.startsWith("text/html")) {
    return { textPlain: null, textHtml: body.trim(), calendarPart: null };
  }

  // 5. Multipart case
  if (ctLower.startsWith("multipart/")) {
    const boundary = extractBoundary(contentType);
    if (!boundary) {
      const vcalMatch = body.match(/BEGIN:VCALENDAR[\s\S]*?END:VCALENDAR/i);
      return {
        textPlain: body.trim(),
        textHtml: null,
        calendarPart: vcalMatch ? { rawIcs: vcalMatch[0].trim() } : null,
      };
    }

    const parts = splitMultipart(body, boundary);
    let textPlain: string | null = null;
    let textHtml: string | null = null;
    let calendarPart: CalendarMimePart | null = null;

    for (const part of parts) {
      const parsed = parseMime(part);
      if (parsed.textPlain && !textPlain) textPlain = parsed.textPlain;
      if (parsed.textHtml && !textHtml) textHtml = parsed.textHtml;
      if (parsed.calendarPart && !calendarPart) calendarPart = parsed.calendarPart;
    }

    // Inline fallback if not caught in subparts
    if (!calendarPart) {
      const vcalMatch = body.match(/BEGIN:VCALENDAR[\s\S]*?END:VCALENDAR/i);
      if (vcalMatch) {
        calendarPart = { rawIcs: vcalMatch[0].trim() };
      }
    }

    return { textPlain, textHtml, calendarPart };
  }

  // 6. Unknown type — dump the body as plaintext
  const vcalMatch = body.match(/BEGIN:VCALENDAR[\s\S]*?END:VCALENDAR/i);
  return {
    textPlain: body.trim(),
    textHtml: null,
    calendarPart: vcalMatch ? { rawIcs: vcalMatch[0].trim() } : null,
  };
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
