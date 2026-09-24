const MAX_SIGNATURE_CHARS = 2000;

export function loadSignature(mailboxId: string): string {
  if (typeof window === "undefined") return "";
  return (
    localStorage.getItem("byos.signature." + mailboxId) || ""
  ).slice(0, MAX_SIGNATURE_CHARS);
}

export function loadSignatureHtml(mailboxId: string): string {
  if (typeof window === "undefined") return "";
  const stored = localStorage.getItem("byos.signature.html." + mailboxId);
  if (stored) return stored.slice(0, MAX_SIGNATURE_CHARS * 4);
  // Fallback: convert plaintext signature to simple HTML
  const plain = loadSignature(mailboxId);
  if (!plain) return "";
  const escaped = plain
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped
    .split("\n")
    .map((line) => `<p>${line || "<br>"}</p>`)
    .join("");
}

export function saveSignature(mailboxId: string, plain: string): void {
  if (typeof window === "undefined") return;
  if (plain.trim()) {
    localStorage.setItem(
      "byos.signature." + mailboxId,
      plain.slice(0, MAX_SIGNATURE_CHARS),
    );
  } else {
    localStorage.removeItem("byos.signature." + mailboxId);
  }
}

export function saveSignatureHtml(mailboxId: string, html: string): void {
  if (typeof window === "undefined") return;
  if (html.trim()) {
    localStorage.setItem(
      "byos.signature.html." + mailboxId,
      html.slice(0, MAX_SIGNATURE_CHARS * 4),
    );
  } else {
    localStorage.removeItem("byos.signature.html." + mailboxId);
  }
}

export function clearSignature(mailboxId: string): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem("byos.signature." + mailboxId);
  localStorage.removeItem("byos.signature.html." + mailboxId);
}

export function applySignature(plaintext: string, signature: string): string {
  const sig = signature.trim();
  if (!sig) return plaintext;
  if (plaintext.includes(`-- \n${sig}`)) return plaintext;
  return `${plaintext}\n\n-- \n${sig}`;
}

/**
 * Appends the HTML signature to the HTML body. The signature HTML is 
 * already sanitized at Settings save time; do NOT escape it here.
 */
export function applySignatureHtml(html: string, signatureHtml: string): string {
  const sig = signatureHtml.trim();
  if (!sig) return html;
  if (html.includes("byos-signature")) return html;
  return `${html}<div class="byos-signature"><br>-- <br>${sig}</div>`;
}
