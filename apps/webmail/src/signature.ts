// Per-mailbox email signatures (Section 4).
//
// Device-local by design: signatures are non-secret display text stored in
// this browser's localStorage only (never synced, never sent anywhere except
// as part of an encrypted outbound message body). There is deliberately no
// server endpoint: a signature needs no cross-device cryptographic binding,
// and keeping it out of the database avoids a new sync/conflict surface in
// V1. Multi-device sync for settings like this is a future slice.
// Keyed per mailbox ID so different mailboxes keep different signatures.

const KEY_PREFIX = "byos.signature.";
const MAX_SIGNATURE_CHARS = 2000;

function storageKey(mailboxId: string): string {
  return KEY_PREFIX + mailboxId;
}

export function loadSignature(mailboxId: string): string {
  try {
    if (typeof localStorage === "undefined" || !mailboxId) return "";
    return (localStorage.getItem(storageKey(mailboxId)) || "").slice(0, MAX_SIGNATURE_CHARS);
  } catch {
    // Private browsing / disabled storage: behave as no signature.
    return "";
  }
}

export function saveSignature(mailboxId: string, text: string): void {
  try {
    if (typeof localStorage === "undefined" || !mailboxId) return;
    const clean = text.slice(0, MAX_SIGNATURE_CHARS);
    if (!clean.trim()) {
      localStorage.removeItem(storageKey(mailboxId));
      return;
    }
    localStorage.setItem(storageKey(mailboxId), clean);
  } catch {
    // Storage failures are non-fatal: sending still works unsigned.
  }
}

/** Append a signature delimiter block to outbound plaintext. Pure. */
export function applySignature(plaintext: string, signature: string): string {
  const sig = signature.trim();
  if (!sig) return plaintext;
  return `${plaintext}\n\n-- \n${sig}`;
}
