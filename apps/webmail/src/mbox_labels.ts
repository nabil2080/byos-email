export type ByosFolder = "inbox" | "sent" | "drafts" | "archive" | "spam" | "trash";

/**
 * Extracts a header value from the header block of an RFC822 message.
 * Supports folded multi-line headers according to RFC 2822 / 5322.
 */
function extractHeader(rawMessage: string, headerName: string): string | null {
  const headerEnd = rawMessage.search(/\r?\n\r?\n/);
  const headers = headerEnd !== -1 ? rawMessage.slice(0, headerEnd) : rawMessage;

  const regex = new RegExp(`^${headerName}:([^\r\n]*(?:\\r?\\n[ \\t]+[^\r\n]*)*)`, "im");
  const match = headers.match(regex);
  if (!match) return null;

  return match[1].replace(/\r?\n[ \t]+/g, " ").trim();
}

/**
 * Checks whether the 'From' header contains the user's email address.
 */
function isFromUser(fromHeader: string, userEmail: string): boolean {
  if (!fromHeader || !userEmail) return false;
  const normalizedUser = userEmail.trim().toLowerCase();

  const angleMatch = fromHeader.match(/<([^>]+)>/);
  if (angleMatch) {
    return angleMatch[1].trim().toLowerCase() === normalizedUser;
  }

  // Bare email address or unquoted string
  const cleanFrom = fromHeader.replace(/["']/g, "").trim().toLowerCase();
  return cleanFrom === normalizedUser || cleanFrom.includes(normalizedUser);
}

/**
 * Given a raw mbox message and current user email, returns the target BYOS folder
 * based on Gmail labels (X-Gmail-Labels) or fallback heuristics.
 * Returns null to use the user's default folder selection.
 */
export function resolveTargetFolder(
  rawMessage: string,
  userEmail: string,
): ByosFolder | null {
  const labelsHeader = extractHeader(rawMessage, "X-Gmail-Labels");

  if (labelsHeader !== null) {
    const rawLower = labelsHeader.toLowerCase();
    const labelTokens = rawLower.split(",").map((t) => t.trim());

    const has = (keyword: string) => labelTokens.some((t) => t.includes(keyword));

    // Priority 1: Spam
    if (has("spam")) {
      return "spam";
    }

    // Priority 2: Trash
    if (has("trash")) {
      return "trash";
    }

    // Priority 3: Draft
    if (has("draft")) {
      return "drafts";
    }

    // Priority 4: Sent
    if (has("sent")) {
      return "sent";
    }

    // Priority 5: Contains "Archive" or has no "Inbox" label
    if (has("archive") || !has("inbox")) {
      return "archive";
    }

    // Priority 6: Contains "Inbox"
    if (has("inbox")) {
      return "inbox";
    }

    return null;
  }

  // Fallback heuristic for non-Gmail sources (no X-Gmail-Labels header)
  const fromHeader = extractHeader(rawMessage, "From");
  if (fromHeader && isFromUser(fromHeader, userEmail)) {
    return "sent";
  }

  return null;
}
