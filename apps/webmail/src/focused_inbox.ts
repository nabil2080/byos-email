export type FocusedCategory = "primary" | "notifications" | "newsletters" | "social";

export interface ClassifierInput {
  senderEmail: string;
  senderDisplayName?: string;
  subject: string;
  headers: Record<string, string>; // lowercased header names
}

export const SOCIAL_DOMAINS: readonly string[] = [
  "facebook.com",
  "twitter.com",
  "x.com",
  "linkedin.com",
  "instagram.com",
  "tiktok.com",
  "pinterest.com",
  "reddit.com",
  "youtube.com",
  "mastodon.social",
  "threads.net",
  "discord.com",
  "snapchat.com",
  "tumblr.com",
  "meetup.com",
] as const;

export const NOTIFICATION_SUBJECT_PATTERNS = [
  "order confirmation",
  "your receipt",
  "password reset",
  "verify your",
  "shipping",
  "delivered",
  "payment received",
  "invoice",
] as const;

const NOTIFICATION_SENDER_REGEX = /^(?:no-?reply|notification|alert|support|billing|receipt|invoice)(?:[+._-].*)?$/i;
const NEWSLETTER_LOCAL_REGEX = /(?:newsletter|digest|bulletin|weekly)/i;

export function extractSenderEmail(fromHeader?: string, fallback: string = ""): string {
  if (!fromHeader) return fallback;
  const match = fromHeader.match(/<([^>]+)>/) || fromHeader.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  if (match && match[1]) {
    return match[1].trim();
  }
  if (!fromHeader.includes("<") && fromHeader.includes("@")) {
    return fromHeader.trim();
  }
  return fallback;
}

function parseSender(sender: string): { localPart: string; domain: string } {
  const clean = (sender || "").trim().toLowerCase();
  const atIdx = clean.lastIndexOf("@");
  if (atIdx === -1) {
    return { localPart: clean, domain: "" };
  }
  return {
    localPart: clean.slice(0, atIdx),
    domain: clean.slice(atIdx + 1),
  };
}

function getHeader(headers: Record<string, string>, name: string): string {
  if (!headers) return "";
  const lower = name.toLowerCase();
  if (headers[lower] !== undefined) return headers[lower];
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return "";
}

/**
 * Pure classification function driven by decrypted headers, sender, and subject.
 * Evaluates rules in order:
 * 1. Newsletters (List-Unsubscribe, List-Id, Precedence: bulk/list, Auto-Submitted + newsletter/digest/etc)
 * 2. Social (social domains list)
 * 3. Notifications (Auto-Submitted, Precedence: bulk + no-reply/alert/etc, transactional subject patterns)
 * 4. Primary (default)
 */
export function classifyMessage(input: ClassifierInput): FocusedCategory {
  const headers = input.headers || {};
  let effectiveSender = input.senderEmail;
  const fromHeader = getHeader(headers, "from");
  if (fromHeader) {
    const extracted = extractSenderEmail(fromHeader, effectiveSender);
    if (extracted) {
      effectiveSender = extracted;
    }
  }
  const { localPart, domain } = parseSender(effectiveSender);
  const subjectLower = (input.subject || "").toLowerCase();


  const listUnsub = getHeader(headers, "list-unsubscribe").trim();
  const listId = getHeader(headers, "list-id").trim();
  const precedence = getHeader(headers, "precedence").trim().toLowerCase();
  const autoSubmitted = getHeader(headers, "auto-submitted").trim().toLowerCase();

  // --- Rule 1: Newsletters ---
  if (listUnsub !== "" || listId !== "") {
    return "newsletters";
  }
  if (precedence === "list") {
    return "newsletters";
  }
  if (precedence === "bulk") {
    // If sender local part explicitly indicates transactional notification (e.g. no-reply, billing, alert),
    // let it fall through to Notifications. Otherwise Precedence: bulk indicates a newsletter/bulk mail.
    if (!NOTIFICATION_SENDER_REGEX.test(localPart)) {
      return "newsletters";
    }
  }
  if (
    autoSubmitted.includes("auto-generated") &&
    NEWSLETTER_LOCAL_REGEX.test(localPart)
  ) {
    return "newsletters";
  }

  // --- Rule 2: Social ---
  if (domain !== "") {
    const isSocial = SOCIAL_DOMAINS.some(
      (d) => domain === d || domain.endsWith("." + d)
    );
    if (isSocial) {
      return "social";
    }
  }

  // --- Rule 3: Notifications ---
  if (autoSubmitted.includes("auto-generated")) {
    return "notifications";
  }
  if (precedence === "bulk" && NOTIFICATION_SENDER_REGEX.test(localPart)) {
    return "notifications";
  }
  for (const pattern of NOTIFICATION_SUBJECT_PATTERNS) {
    if (subjectLower.includes(pattern)) {
      return "notifications";
    }
  }

  // --- Rule 4: Primary (default) ---
  return "primary";
}

const OVERRIDE_STORAGE_PREFIX = "byos_msg_category_override_";
const FOCUSED_INBOX_ENABLED_KEY = "byos_focused_inbox_enabled";

export function getMessageCategoryOverride(messageId: string): FocusedCategory | null {
  if (typeof window === "undefined" || !window.sessionStorage) return null;
  const val = window.sessionStorage.getItem(OVERRIDE_STORAGE_PREFIX + messageId);
  if (val === "primary" || val === "notifications" || val === "newsletters" || val === "social") {
    return val;
  }
  return null;
}

export function setMessageCategoryOverride(messageId: string, category: FocusedCategory): void {
  if (typeof window === "undefined" || !window.sessionStorage) return;
  window.sessionStorage.setItem(OVERRIDE_STORAGE_PREFIX + messageId, category);
}

export function clearMessageCategoryOverride(messageId: string): void {
  if (typeof window === "undefined" || !window.sessionStorage) return;
  window.sessionStorage.removeItem(OVERRIDE_STORAGE_PREFIX + messageId);
}

export function getFocusedInboxEnabled(): boolean {
  if (typeof window === "undefined" || !window.localStorage) return true;
  const val = window.localStorage.getItem(FOCUSED_INBOX_ENABLED_KEY);
  if (val === null) return true; // Default ON
  return val === "true";
}

export function setFocusedInboxEnabled(enabled: boolean): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  window.localStorage.setItem(FOCUSED_INBOX_ENABLED_KEY, enabled ? "true" : "false");
}

export function parseRawHeaders(rawHeaders: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!rawHeaders) return result;
  const lines = rawHeaders.split(/\r?\n/);
  let currentKey = "";
  for (const line of lines) {
    if (line.startsWith(" ") || line.startsWith("\t")) {
      if (currentKey && result[currentKey]) {
        result[currentKey] += " " + line.trim();
      }
      continue;
    }
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim().toLowerCase();
    const val = line.slice(colonIdx + 1).trim();
    currentKey = key;
    result[key] = val;
  }
  return result;
}

export function resolveMessageCategory(
  messageId: string,
  serverOverride: string | null | undefined,
  input?: ClassifierInput
): FocusedCategory {
  // 1. User manual session override wins over everything
  const manual = getMessageCategoryOverride(messageId);
  if (manual) return manual;

  // 2. Server rule override
  if (
    serverOverride &&
    (serverOverride === "primary" ||
      serverOverride === "notifications" ||
      serverOverride === "newsletters" ||
      serverOverride === "social")
  ) {
    return serverOverride as FocusedCategory;
  }

  // 3. If fresh classifier input with decrypted headers is provided, classify and cache
  if (input && Object.keys(input.headers || {}).length > 0) {
    const cat = classifyMessage(input);
    if (typeof window !== "undefined" && window.sessionStorage) {
      window.sessionStorage.setItem("byos_msg_category_" + messageId, cat);
    }
    return cat;
  }

  // 4. Session cache from previous decryption
  if (typeof window !== "undefined" && window.sessionStorage) {
    const cached = window.sessionStorage.getItem("byos_msg_category_" + messageId);
    if (
      cached === "primary" ||
      cached === "notifications" ||
      cached === "newsletters" ||
      cached === "social"
    ) {
      return cached;
    }
  }

  // 5. Fallback classifier if input provided without subject/headers (do not cache premature result)
  if (input) {
    return classifyMessage(input);
  }

  return "primary";
}
