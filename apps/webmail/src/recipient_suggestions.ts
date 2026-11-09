import { OrgMember, ContactItem, ConnectedAccount } from "./api.js";

export interface RecipientChip {
  name?: string;
  email: string;
}

export interface RecipientSuggestion {
  name?: string;
  email: string;
  source?: "colleague" | "contact" | "account" | "recent";
  group_name?: string;
}

export interface StorageShim {
  getItem: (key: string) => string | null;
  length: number;
  key: (index: number) => string | null;
}

/**
 * Splits text into normalized search tokens (delimited by spaces, punctuation, or email separators).
 * Matches Gmail's word-level tokenization.
 */
export function extractSearchTokens(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .split(/[\s,._\-+@/\\()\[\]'"]+/)
    .filter((tok) => tok.length > 0);
}

/**
 * Checks if a candidate matches query words using Gmail-style word-prefix token matching.
 * Each word in the query must match the start of at least one token in the candidate's
 * display name or email local-part. The domain only matches if the query explicitly
 * contains '@' or a period.
 */
export function matchesCandidateTokens(
  candidate: RecipientSuggestion,
  queryWords: string[],
  isDomainQuery: boolean
): boolean {
  if (queryWords.length === 0) return false;

  const nameTokens = extractSearchTokens(candidate.name || "");
  const emailParts = candidate.email.split("@");
  const localTokens = extractSearchTokens(emailParts[0] || "");
  const domainPart = (emailParts[1] || "").toLowerCase();

  for (const qWord of queryWords) {
    if (!qWord) continue;

    // Explicit domain search (e.g. query "@byos" or "@company.com")
    if (qWord.startsWith("@")) {
      const domQuery = qWord.slice(1);
      if (!domQuery || !domainPart.startsWith(domQuery)) {
        return false;
      }
      continue;
    }

    // Word-prefix match: token starts with query word
    const matchesName = nameTokens.some((tok) => tok.startsWith(qWord));
    const matchesLocal = localTokens.some((tok) => tok.startsWith(qWord));
    const matchesDomain = isDomainQuery && domainPart.startsWith(qWord);

    if (!matchesName && !matchesLocal && !matchesDomain) {
      return false;
    }
  }

  return true;
}

/**
 * Aggregates candidate recipients from organization members, contacts, connected accounts,
 * recent senders/recipients, and sessionStorage cached names.
 *
 * Rules:
 * 1. Excludes the current sender's own email (so the user is not suggested to themselves as a colleague).
 * 2. Any address sharing the sender's email domain (e.g. @byos.local) is categorized as "colleague".
 * 3. Priority order:
 *    - Organization members (Colleagues)
 *    - Saved address book contacts
 *    - Connected accounts
 *    - Recent senders / correspondents
 *    - SessionStorage cached names
 */
export function buildRecipientCandidates(params: {
  orgMembers?: OrgMember[];
  contacts?: ContactItem[];
  connectedAccounts?: ConnectedAccount[];
  recentSenders?: Array<{ name?: string; email: string }>;
  senderAddress?: string;
  storage?: StorageShim;
}): RecipientSuggestion[] {
  const candidateMap = new Map<string, RecipientSuggestion>();

  const cleanSender = (params.senderAddress || "")
    .replace(/<[^>]+>/, "")
    .replace(/["']/g, "")
    .trim()
    .toLowerCase();

  const senderDomain = cleanSender.includes("@")
    ? cleanSender.split("@")[1]?.trim().toLowerCase()
    : "";

  const isColleagueEmail = (email: string): boolean => {
    if (!senderDomain) return false;
    const parts = email.toLowerCase().split("@");
    return parts.length === 2 && parts[1] === senderDomain;
  };

  const isSelf = (email: string): boolean => {
    return Boolean(cleanSender && email.toLowerCase() === cleanSender);
  };

  // 1. Organization members (Colleagues) take top priority
  if (params.orgMembers && params.orgMembers.length > 0) {
    for (const m of params.orgMembers) {
      if (!m.email) continue;
      const clean = m.email.trim().toLowerCase();
      if (isSelf(clean)) continue; // Never suggest sender to themselves
      candidateMap.set(clean, {
        name: m.display_name?.trim() || undefined,
        email: m.email.trim(),
        source: "colleague",
      });
    }
  }

  // 2. Saved address book contacts
  if (params.contacts && params.contacts.length > 0) {
    for (const c of params.contacts) {
      if (!c.email) continue;
      const clean = c.email.trim().toLowerCase();
      if (isSelf(clean)) continue;

      const colleague = isColleagueEmail(clean);
      const existing = candidateMap.get(clean);
      if (!existing) {
        candidateMap.set(clean, {
          name: c.name?.trim() || undefined,
          email: c.email.trim(),
          source: colleague ? "colleague" : "contact",
          group_name: c.group_name || undefined,
        });
      } else {
        if (!existing.name && c.name?.trim()) {
          existing.name = c.name.trim();
        }
        if (c.group_name && !existing.group_name) {
          existing.group_name = c.group_name;
        }
        if (colleague) {
          existing.source = "colleague";
        }
      }
    }
  }

  // 3. Connected accounts
  if (params.connectedAccounts && params.connectedAccounts.length > 0) {
    for (const acc of params.connectedAccounts) {
      if (!acc.email) continue;
      const clean = acc.email.trim().toLowerCase();
      if (isSelf(clean)) continue;

      const colleague = isColleagueEmail(clean);
      if (!candidateMap.has(clean)) {
        candidateMap.set(clean, {
          name: acc.displayName?.trim() || undefined,
          email: acc.email.trim(),
          source: colleague ? "colleague" : "account",
        });
      }
    }
  }

  // 4. Recent senders / correspondents
  if (params.recentSenders && params.recentSenders.length > 0) {
    for (const s of params.recentSenders) {
      if (!s.email) continue;
      const clean = s.email.trim().toLowerCase();
      if (isSelf(clean)) continue;

      const colleague = isColleagueEmail(clean);
      if (!candidateMap.has(clean)) {
        candidateMap.set(clean, {
          name: s.name?.trim() || undefined,
          email: s.email.trim(),
          source: colleague ? "colleague" : "recent",
        });
      } else if (colleague && candidateMap.get(clean)!.source !== "colleague") {
        candidateMap.get(clean)!.source = "colleague";
      }
    }
  }

  // 5. Storage cached names (e.g. from decrypted messages or directory)
  const st = params.storage || (typeof sessionStorage !== "undefined" ? (sessionStorage as unknown as StorageShim) : undefined);
  if (st) {
    try {
      for (let i = 0; i < st.length; i++) {
        const key = st.key(i);
        if (key && (key.startsWith("byos_org_member_name_") || key.startsWith("byos_sender_email_name_"))) {
          const email = key.replace(/^byos_(org_member|sender_email)_name_/, "").trim().toLowerCase();
          if (isSelf(email)) continue;
          const val = st.getItem(key)?.trim();
          if (email && email.includes("@")) {
            const colleague = isColleagueEmail(email) || key.startsWith("byos_org_member_name_");
            const existing = candidateMap.get(email);
            if (!existing && val) {
              candidateMap.set(email, {
                name: val,
                email,
                source: colleague ? "colleague" : "recent",
              });
            } else if (existing) {
              if (!existing.name && val) {
                existing.name = val;
              }
              if (colleague) {
                existing.source = "colleague";
              }
            }
          }
        }
      }
    } catch {}
  }

  return Array.from(candidateMap.values());
}

/**
 * Filters and sorts candidates matching the query string using Gmail-style word-prefix matching.
 *
 * Requirements:
 * 1. Minimum character threshold: Only activates when the user has typed at least 3 characters
 *    (or when starting with '@' to explore domains).
 * 2. Word-prefix matching: matches the start of tokens in name or local-part.
 * 3. Exact prefix and colleague prioritization over external contacts.
 */
export function filterAndSortRecipientSuggestions(params: {
  query: string;
  candidates: RecipientSuggestion[];
  selectedEmails?: Set<string>;
  minQueryLength?: number;
  limit?: number;
}): RecipientSuggestion[] {
  const trimmed = params.query.trim();
  const minLen = params.minQueryLength ?? 3;

  // Gmail rule: Require at least minLen (3) characters or an '@' prefix to show suggestions
  if (trimmed.length < minLen && !trimmed.startsWith("@")) {
    return [];
  }

  const queryLower = trimmed.toLowerCase();
  const queryWords = queryLower.split(/\s+/).filter(Boolean);
  const isDomainQuery = trimmed.startsWith("@") || trimmed.includes(".");

  const selected = params.selectedEmails || new Set<string>();

  const matches = params.candidates.filter((item) => {
    if (selected.has(item.email.toLowerCase())) return false;
    return matchesCandidateTokens(item, queryWords, isDomainQuery);
  });

  matches.sort((a, b) => {
    const aName = (a.name || "").toLowerCase();
    const bName = (b.name || "").toLowerCase();
    const aEmail = a.email.toLowerCase();
    const bEmail = b.email.toLowerCase();

    // 1. Exact full match on display name or email local-part
    const aExact = aName === queryLower || aEmail.split("@")[0] === queryLower;
    const bExact = bName === queryLower || bEmail.split("@")[0] === queryLower;
    if (aExact && !bExact) return -1;
    if (!aExact && bExact) return 1;

    // 2. First token starts with query
    const aFirstToken = aName.split(/\s+/)[0] || "";
    const bFirstToken = bName.split(/\s+/)[0] || "";
    const aFirstStarts = aFirstToken.startsWith(queryLower);
    const bFirstStarts = bFirstToken.startsWith(queryLower);
    if (aFirstStarts && !bFirstStarts) return -1;
    if (!aFirstStarts && bFirstStarts) return 1;

    // 3. Colleague priority (users sharing the same domain/organization)
    if (a.source === "colleague" && b.source !== "colleague") return -1;
    if (a.source !== "colleague" && b.source === "colleague") return 1;

    // 4. Alphabetical tie-breaking
    const displayA = a.name || a.email;
    const displayB = b.name || b.email;
    return displayA.localeCompare(displayB);
  });

  return matches.slice(0, params.limit ?? 8);
}

/**
 * Resolves a raw string input into a structured RecipientChip.
 * If raw is a bare email, looks up candidate name.
 * If raw has explicit RFC 5322 name (e.g. "Bob <bob@byos.local>"), preserves the explicit name.
 */
export function resolveRecipientChip(
  raw: string,
  candidates: RecipientSuggestion[]
): RecipientChip {
  const trimmed = raw.trim();
  const match = trimmed.match(/<([^>]+)>/);
  const clean = (match ? match[1] : trimmed).replace(/["']/g, "").trim().toLowerCase();
  const explicitName = match ? trimmed.replace(/<[^>]+>/, "").replace(/["']/g, "").trim() : "";

  const found = candidates.find((c) => c.email.toLowerCase() === clean);
  return {
    name: explicitName || found?.name || undefined,
    email: clean,
  };
}
