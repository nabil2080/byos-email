/**
 * BYOS Email - Remote Image Privacy & Sender Policy Store
 * 
 * Provides zero-knowledge privacy protection against external tracking pixels
 * and remote images by managing per-sender image display preferences.
 */

export type ImagePolicy = "always_allow" | "always_block" | "ask";

const ALWAYS_ALLOW_KEY = "byos_always_allow_images_senders";
const ALWAYS_BLOCK_KEY = "byos_always_block_images_senders";

export function extractCleanEmailAddress(sender: string): string {
  if (!sender) return "";
  const match = sender.match(/<([^>]+)>/);
  const raw = match ? match[1] : sender;
  return raw.trim().toLowerCase();
}

function getStoredSet(key: string): Set<string> {
  if (typeof localStorage === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.map((s: string) => s.toLowerCase().trim()) : []);
  } catch {
    return new Set();
  }
}

function saveStoredSet(key: string, set: Set<string>): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(Array.from(set)));
  } catch {
    // Storage quota or privacy sandbox restriction
  }
}

export function getSenderImagePolicy(sender: string): ImagePolicy {
  const email = extractCleanEmailAddress(sender);
  if (!email) return "ask";

  const allowSet = getStoredSet(ALWAYS_ALLOW_KEY);
  if (allowSet.has(email)) return "always_allow";

  const blockSet = getStoredSet(ALWAYS_BLOCK_KEY);
  if (blockSet.has(email)) return "always_block";

  return "ask";
}

export function setSenderImagePolicy(sender: string, policy: ImagePolicy): void {
  const email = extractCleanEmailAddress(sender);
  if (!email) return;

  const allowSet = getStoredSet(ALWAYS_ALLOW_KEY);
  const blockSet = getStoredSet(ALWAYS_BLOCK_KEY);

  if (policy === "always_allow") {
    allowSet.add(email);
    blockSet.delete(email);
  } else if (policy === "always_block") {
    blockSet.add(email);
    allowSet.delete(email);
  } else {
    allowSet.delete(email);
    blockSet.delete(email);
  }

  saveStoredSet(ALWAYS_ALLOW_KEY, allowSet);
  saveStoredSet(ALWAYS_BLOCK_KEY, blockSet);

  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    try {
      const CustomEventCtor = (window as any).CustomEvent || CustomEvent;
      window.dispatchEvent(new CustomEventCtor("byos_image_policy_updated", { detail: { email, policy } }));
    } catch {
      // Non-fatal if test environment does not support full Event constructor
    }
  }
}

export function isSenderImageAlwaysAllowed(sender: string): boolean {
  return getSenderImagePolicy(sender) === "always_allow";
}

export function isSenderImageAlwaysBlocked(sender: string): boolean {
  return getSenderImagePolicy(sender) === "always_block";
}

export function clearSenderImagePreference(sender: string): void {
  setSenderImagePolicy(sender, "ask");
}
