import { DisplayMessage } from "./components/MessageList";
import { formatAddress } from "./components/MessageRow";

export interface SubscriptionItem {
  id: string; // normalized email
  senderEmail: string;
  senderName: string;
  listId?: string;
  unsubscribeUrl?: string;
  unsubscribeEmail?: string;
  hasOneClick?: boolean;
  messageCount: number;
  lastReceived: string; // ISO or date string
  status: "subscribed" | "unsubscribed";
  unsubscribedAt?: string;
  subjectSample?: string;
}

const UNSUBSCRIBED_PREFIX = "byos_unsubscribed_senders_";

export function extractCleanEmail(raw: string): string {
  if (!raw) return "";
  const match = raw.match(/<([^>]+)>/) || raw.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  if (match && match[1]) {
    return match[1].trim().toLowerCase();
  }
  return raw.replace(/["']/g, "").trim().toLowerCase();
}

export function extractDisplayName(raw: string): string {
  if (!raw) return "";
  const match = raw.match(/^["']?([^"'<]+)["']?\s*<[^>]+>/);
  if (match && match[1].trim()) {
    return match[1].trim();
  }
  const cleanEmail = extractCleanEmail(raw);
  const local = cleanEmail.split("@")[0] || cleanEmail;
  return local.replace(/[._-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function getUnsubscribedMap(mailboxId: string): Record<string, { unsubscribedAt: string; senderName?: string }> {
  if (typeof window === "undefined" || !window.localStorage) return {};
  try {
    const raw = window.localStorage.getItem(UNSUBSCRIBED_PREFIX + (mailboxId || "default"));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function isSenderUnsubscribed(mailboxId: string, senderEmail: string): boolean {
  if (!senderEmail) return false;
  const clean = extractCleanEmail(senderEmail);
  const map = getUnsubscribedMap(mailboxId);
  return Boolean(map[clean]);
}

export function unsubscribeSender(
  mailboxId: string,
  senderEmail: string,
  senderName?: string,
  unsubscribeUrl?: string
): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  const clean = extractCleanEmail(senderEmail);
  if (!clean) return;

  const map = getUnsubscribedMap(mailboxId);
  map[clean] = {
    unsubscribedAt: new Date().toISOString(),
    senderName: senderName || clean,
  };
  window.localStorage.setItem(UNSUBSCRIBED_PREFIX + (mailboxId || "default"), JSON.stringify(map));
  window.dispatchEvent(new CustomEvent("byos_subscriptions_updated"));
}

export function resubscribeSender(mailboxId: string, senderEmail: string): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  const clean = extractCleanEmail(senderEmail);
  if (!clean) return;

  const map = getUnsubscribedMap(mailboxId);
  delete map[clean];
  window.localStorage.setItem(UNSUBSCRIBED_PREFIX + (mailboxId || "default"), JSON.stringify(map));
  window.dispatchEvent(new CustomEvent("byos_subscriptions_updated"));
}

export function extractUnsubscribeLink(
  headers?: Record<string, string>,
  bodyHtmlOrText?: string
): { url?: string; mailto?: string } | null {
  // 1. Check List-Unsubscribe header (RFC 2369 / RFC 8058 - Gmail & Proton standard)
  if (headers) {
    const listUnsub = (headers["list-unsubscribe"] || headers["List-Unsubscribe"] || "").trim();
    if (listUnsub) {
      const httpMatch = listUnsub.match(/<(https?:\/\/[^>]+)>/i) || listUnsub.match(/(https?:\/\/[^\s,>]+)/i);
      const mailtoMatch = listUnsub.match(/<(mailto:[^>]+)>/i) || listUnsub.match(/(mailto:[^\s,>]+)/i);
      if (httpMatch && httpMatch[1]) {
        return { url: httpMatch[1], mailto: mailtoMatch ? mailtoMatch[1] : undefined };
      }
      if (mailtoMatch && mailtoMatch[1]) {
        return { mailto: mailtoMatch[1] };
      }
    }
  }

  // 2. Check HTML body for explicit unsubscribe anchor tags
  if (bodyHtmlOrText) {
    const anchorTextMatch = bodyHtmlOrText.match(/<a\s+[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>(?:[^<]*(?:unsubscribe|opt-out|manage\s+preferences|manage\s+subscription)[^<]*)<\/a>/i);
    if (anchorTextMatch && anchorTextMatch[1]) {
      return { url: anchorTextMatch[1] };
    }
    const hrefMatch = bodyHtmlOrText.match(/href=["'](https?:\/\/[^"']*(?:unsubscribe|optout|opt-out|manage-preferences)[^"']*)["']/i);
    if (hrefMatch && hrefMatch[1]) {
      return { url: hrefMatch[1] };
    }
    const mailtoMatch = bodyHtmlOrText.match(/href=["'](mailto:[^"']*(?:unsubscribe|optout)[^"']*)["']/i);
    if (mailtoMatch && mailtoMatch[1]) {
      return { mailto: mailtoMatch[1] };
    }
  }

  return null;
}

export function detectSubscriptions(
  messages: DisplayMessage[],
  mailboxId: string
): SubscriptionItem[] {
  const map: Map<string, SubscriptionItem> = new Map();
  const unsubMap = getUnsubscribedMap(mailboxId);

  for (const msg of messages) {
    const email = extractCleanEmail(msg.sender);
    if (!email) continue;

    const headers = (msg as any).headers;
    const unsubInfo = extractUnsubscribeLink(headers, msg.decryptedContent || msg.snippet);
    const hasUnsubHeader = Boolean(
      headers && (headers["list-unsubscribe"] || headers["List-Unsubscribe"] || headers["list-id"] || headers["List-Id"])
    );

    // Gmail & Proton standard: Only detect verified newsletters/mailing lists with RFC headers or unsubscribe links
    const isNewsletter =
      msg.category === "newsletters" ||
      hasUnsubHeader ||
      Boolean(unsubInfo?.url || unsubInfo?.mailto) ||
      Boolean(unsubMap[email]);

    if (!isNewsletter) continue;

    const existing = map.get(email);

    if (existing) {
      existing.messageCount++;
      const curDate = new Date(msg.date).getTime();
      const existDate = new Date(existing.lastReceived).getTime();
      if (!isNaN(curDate) && (isNaN(existDate) || curDate > existDate)) {
        existing.lastReceived = msg.date;
        existing.subjectSample = msg.subject;
      }
      if (!existing.unsubscribeUrl && unsubInfo?.url) {
        existing.unsubscribeUrl = unsubInfo.url;
      }
      if (!existing.unsubscribeEmail && unsubInfo?.mailto) {
        existing.unsubscribeEmail = unsubInfo.mailto;
      }
    } else {
      const isUnsub = Boolean(unsubMap[email]);
      map.set(email, {
        id: email,
        senderEmail: email,
        senderName: extractDisplayName(msg.sender) || formatAddress(msg.sender),
        messageCount: 1,
        lastReceived: msg.date,
        status: isUnsub ? "unsubscribed" : "subscribed",
        unsubscribedAt: unsubMap[email]?.unsubscribedAt,
        unsubscribeUrl: unsubInfo?.url,
        unsubscribeEmail: unsubInfo?.mailto,
        subjectSample: msg.subject,
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => b.messageCount - a.messageCount);
}
