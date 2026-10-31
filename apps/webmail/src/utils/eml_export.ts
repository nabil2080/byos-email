/**
 * RFC 5322 / MIME .eml message serializer.
 * Reconstructs standard MIME headers, multipart structures, and encodes attachments.
 */

export interface EmlAttachment {
  filename: string;
  contentType: string;
  data: Uint8Array | ArrayBuffer;
}

export interface EmlMessageParams {
  from: string;
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  date?: string | Date;
  messageId?: string;
  bodyPlain?: string;
  bodyHtml?: string;
  attachments?: EmlAttachment[];
}

/**
 * Format a Date object or date string into RFC 2822/5322 date header string.
 */
export function formatRFC2822Date(dateInput?: string | Date): string {
  const d = dateInput ? new Date(dateInput) : new Date();
  if (Number.isNaN(d.getTime())) {
    return new Date().toUTCString();
  }
  return d.toUTCString();
}

/**
 * Encode a Uint8Array into a base64 string with RFC 2045 76-character line wrapping.
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let b64: string;
  if (typeof Buffer !== "undefined") {
    b64 = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
  } else {
    let binary = "";
    const chunkSize = 8192;
    for (let i = 0; i < bytes.byteLength; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
    }
    b64 = btoa(binary);
  }
  // Split into 76-char lines
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 76) {
    lines.push(b64.slice(i, i + 76));
  }
  return lines.join("\r\n");
}

/**
 * Cleanly format recipient address list into RFC 5322 header value.
 */
function formatAddressHeader(value?: string | string[]): string {
  if (!value) return "";
  if (Array.isArray(value)) {
    return value.map((s) => s.trim()).filter(Boolean).join(", ");
  }
  return value.trim();
}

/**
 * Generate a unique boundary string for MIME multiparts.
 */
function generateBoundary(prefix: string): string {
  const rand = Math.random().toString(36).substring(2, 10);
  const time = Date.now().toString(36);
  return `====_${prefix}_${time}_${rand}_====`;
}

/**
 * Build RFC 5322 compliant .eml message string.
 */
export function buildEmlContent(params: EmlMessageParams): string {
  const crlf = "\r\n";
  const headers: string[] = [];

  const from = params.from.trim() || "unknown@byos.local";
  const to = formatAddressHeader(params.to);
  const cc = formatAddressHeader(params.cc);
  const subject = params.subject.trim() || "(no subject)";
  const dateStr = formatRFC2822Date(params.date);
  const messageId =
    params.messageId ||
    `<byos-${Date.now()}-${Math.random().toString(36).substring(2, 8)}@${from.includes("@") ? from.split("@")[1] : "byos.local"}>`;

  headers.push(`MIME-Version: 1.0`);
  headers.push(`Date: ${dateStr}`);
  headers.push(`From: ${from}`);
  if (to) headers.push(`To: ${to}`);
  if (cc) headers.push(`Cc: ${cc}`);
  headers.push(`Subject: ${subject}`);
  headers.push(`Message-ID: ${messageId}`);

  const hasAttachments = params.attachments && params.attachments.length > 0;
  const hasHtml = Boolean(params.bodyHtml && params.bodyHtml.trim());
  const hasPlain = Boolean(params.bodyPlain !== undefined && params.bodyPlain !== null);
  const plainText = params.bodyPlain || (hasHtml ? params.bodyHtml!.replace(/<[^>]+>/g, "") : "");

  let bodyContent = "";

  if (hasAttachments) {
    const mixedBoundary = generateBoundary("mixed");
    headers.push(`Content-Type: multipart/mixed; boundary="${mixedBoundary}"`);

    const mixedParts: string[] = [];

    // Part 1: Content body (alternative or single plain/html)
    if (hasHtml && hasPlain && plainText.trim()) {
      const altBoundary = generateBoundary("alt");
      const altPart = [
        `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
        "",
        `--${altBoundary}`,
        `Content-Type: text/plain; charset=utf-8`,
        `Content-Transfer-Encoding: 8bit`,
        "",
        plainText,
        `--${altBoundary}`,
        `Content-Type: text/html; charset=utf-8`,
        `Content-Transfer-Encoding: 8bit`,
        "",
        params.bodyHtml!,
        `--${altBoundary}--`,
      ].join(crlf);
      mixedParts.push(altPart);
    } else if (hasHtml) {
      mixedParts.push(
        [
          `Content-Type: text/html; charset=utf-8`,
          `Content-Transfer-Encoding: 8bit`,
          "",
          params.bodyHtml!,
        ].join(crlf)
      );
    } else {
      mixedParts.push(
        [
          `Content-Type: text/plain; charset=utf-8`,
          `Content-Transfer-Encoding: 8bit`,
          "",
          plainText,
        ].join(crlf)
      );
    }

    // Attachment parts
    for (const att of params.attachments!) {
      const bytes = att.data instanceof Uint8Array ? att.data : new Uint8Array(att.data);
      const b64Data = uint8ArrayToBase64(bytes);
      const cType = att.contentType || "application/octet-stream";
      const fName = att.filename || "attachment";
      const safeFilename = fName.replace(/"/g, '\\"');

      const attPart = [
        `Content-Type: ${cType}; name="${safeFilename}"`,
        `Content-Disposition: attachment; filename="${safeFilename}"`,
        `Content-Transfer-Encoding: base64`,
        "",
        b64Data,
      ].join(crlf);
      mixedParts.push(attPart);
    }

    bodyContent = `--${mixedBoundary}${crlf}` +
      mixedParts.join(`${crlf}--${mixedBoundary}${crlf}`) +
      `${crlf}--${mixedBoundary}--`;
  } else if (hasHtml && hasPlain && plainText.trim()) {
    const altBoundary = generateBoundary("alt");
    headers.push(`Content-Type: multipart/alternative; boundary="${altBoundary}"`);

    bodyContent = [
      `--${altBoundary}`,
      `Content-Type: text/plain; charset=utf-8`,
      `Content-Transfer-Encoding: 8bit`,
      "",
      plainText,
      `--${altBoundary}`,
      `Content-Type: text/html; charset=utf-8`,
      `Content-Transfer-Encoding: 8bit`,
      "",
      params.bodyHtml!,
      `--${altBoundary}--`,
    ].join(crlf);
  } else if (hasHtml) {
    headers.push(`Content-Type: text/html; charset=utf-8`);
    headers.push(`Content-Transfer-Encoding: 8bit`);
    bodyContent = params.bodyHtml!;
  } else {
    headers.push(`Content-Type: text/plain; charset=utf-8`);
    headers.push(`Content-Transfer-Encoding: 8bit`);
    bodyContent = plainText;
  }

  return headers.join(crlf) + crlf + crlf + bodyContent;
}

/**
 * Trigger a browser download of an .eml file.
 */
export function downloadEmlFile(filename: string, emlContent: string): void {
  const cleanFilename = filename.endsWith(".eml") ? filename : `${filename}.eml`;
  const blob = new Blob([emlContent], { type: "message/rfc822; charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = cleanFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
