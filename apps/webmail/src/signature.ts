const MAX_SIGNATURE_CHARS = 2000;

export function loadSignature(mailboxId: string): string {
  if (typeof window === "undefined") return "";
  const val =
    (typeof sessionStorage !== "undefined" && sessionStorage.getItem("byos.signature." + mailboxId)) ||
    (typeof localStorage !== "undefined" && localStorage.getItem("byos.signature." + mailboxId)) ||
    "";
  return val.slice(0, MAX_SIGNATURE_CHARS);
}

export function loadSignatureHtml(mailboxId: string): string {
  if (typeof window === "undefined") return "";
  const stored =
    (typeof sessionStorage !== "undefined" && sessionStorage.getItem("byos.signature.html." + mailboxId)) ||
    (typeof localStorage !== "undefined" && localStorage.getItem("byos.signature.html." + mailboxId)) ||
    "";
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
  const val = plain.trim() ? plain.slice(0, MAX_SIGNATURE_CHARS) : "";
  if (val) {
    if (typeof localStorage !== "undefined") localStorage.setItem("byos.signature." + mailboxId, val);
    if (typeof sessionStorage !== "undefined") sessionStorage.setItem("byos.signature." + mailboxId, val);
  } else {
    if (typeof localStorage !== "undefined") localStorage.removeItem("byos.signature." + mailboxId);
    if (typeof sessionStorage !== "undefined") sessionStorage.removeItem("byos.signature." + mailboxId);
  }
}

export function saveSignatureHtml(mailboxId: string, html: string): void {
  if (typeof window === "undefined") return;
  const val = html.trim() ? html.slice(0, MAX_SIGNATURE_CHARS * 4) : "";
  if (val) {
    if (typeof localStorage !== "undefined") localStorage.setItem("byos.signature.html." + mailboxId, val);
    if (typeof sessionStorage !== "undefined") sessionStorage.setItem("byos.signature.html." + mailboxId, val);
  } else {
    if (typeof localStorage !== "undefined") localStorage.removeItem("byos.signature.html." + mailboxId);
    if (typeof sessionStorage !== "undefined") sessionStorage.removeItem("byos.signature.html." + mailboxId);
  }
}

export function clearSignature(mailboxId: string): void {
  if (typeof window === "undefined") return;
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem("byos.signature." + mailboxId);
    localStorage.removeItem("byos.signature.html." + mailboxId);
  }
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.removeItem("byos.signature." + mailboxId);
    sessionStorage.removeItem("byos.signature.html." + mailboxId);
  }
}

export function applySignature(plaintext: string, signature: string): string {
  const sig = signature.trim();
  if (!sig) return plaintext;
  return `${plaintext}\n\n-- \n${sig}`;
}

export function applySignatureHtml(html: string, signatureHtml: string): string {
  const sig = signatureHtml.trim();
  if (!sig) return html;
  return `${html}<div class="byos-signature"><br>-- <br>${sig}</div>`;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatQuotedHtml(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "<p><br></p>";
  const lines = trimmed.split("\n");
  const htmlLines = lines
    .map((line) => `<p>${escapeHtml(line) || "<br>"}</p>`)
    .join("");
  return `<p><br></p><div style="color: #6F7173; border-left: 2px solid #ccc; padding-left: 8px; margin: 8px 0;">${htmlLines}</div>`;
}

