import type { DisplayMessage } from "./App";

/**
 * Validates whether an address string contains a well-formed email address.
 */
export function isValidEmailAddress(addr: string): boolean {
  if (!addr) return false;
  const match = addr.match(/<([^>]+)>/);
  const raw = (match ? match[1] : addr).trim();
  // Standard email validation: local-part @ domain . tld
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(raw);
}

/**
 * Extracts and lowercases the bare email address from an RFC 5322 address.
 */
export function extractEmail(addr: string): string {
  if (!addr) return "";
  const match = addr.match(/<([^>]+)>/);
  return (match ? match[1] : addr).replace(/["']/g, "").trim().toLowerCase();
}

/**
 * Computes recipient lists for Reply and Reply All workflows (RFC 5322 §3.6.2 / §3.6.3).
 *
 * Rules:
 * 1. Primary reply target is Reply-To if present and valid email; otherwise From (msg.sender).
 * 2. If Reply-To is malformed, fail safely and fall back to msg.sender.
 * 3. Reply: To = replyTarget, Cc = empty.
 * 4. Reply All: To = replyTarget, Cc = original To and Cc recipients excluding:
 *    - The primary reply target
 *    - The current user's own mailbox address
 *    - Duplicates
 * 5. BCC recipients are never exposed or copied into Reply All.
 */
export function computeReplyRecipients(
  msg: Partial<DisplayMessage>,
  userEmail?: string,
  isReplyAll = false
): { to: string; cc: string } {
  // 1. Determine primary reply target: Reply-To if valid email, else From (msg.sender)
  let replyTarget = msg.sender ? msg.sender.trim() : "";
  if (msg.replyTo && msg.replyTo.trim()) {
    const candidate = msg.replyTo.trim();
    if (isValidEmailAddress(candidate)) {
      replyTarget = candidate;
    }
  }

  if (!isReplyAll) {
    return { to: replyTarget, cc: "" };
  }

  // 2. Reply All: To is replyTarget, Cc is all original To and Cc recipients
  // excluding replyTarget and the user's own mailbox email.
  const replyTargetEmail = extractEmail(replyTarget);
  const normalizedUserEmail = userEmail ? extractEmail(userEmail) : "";

  const ccList: string[] = [];
  const seenEmails = new Set<string>();
  if (replyTargetEmail) {
    seenEmails.add(replyTargetEmail);
  }
  if (normalizedUserEmail) {
    seenEmails.add(normalizedUserEmail);
  }

  // Collect from msg.recipients (or msg.recipient)
  const candidateRecipients: string[] = [];
  if (msg.recipients && Array.isArray(msg.recipients)) {
    for (const r of msg.recipients) {
      candidateRecipients.push(r);
    }
  } else if (msg.recipient && msg.recipient.trim()) {
    for (const r of msg.recipient.split(",")) {
      candidateRecipients.push(r.trim());
    }
  }

  for (const cand of candidateRecipients) {
    const trimmed = cand.trim();
    if (!trimmed) continue;
    const email = extractEmail(trimmed);
    if (!email || !isValidEmailAddress(trimmed)) continue;
    if (seenEmails.has(email)) continue;
    seenEmails.add(email);
    ccList.push(trimmed);
  }

  return { to: replyTarget, cc: ccList.join(", ") };
}
