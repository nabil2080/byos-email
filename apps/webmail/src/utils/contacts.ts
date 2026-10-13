import { ContactItem } from "../api";
import { RecipientChip } from "../components/RecipientInput";

/**
 * Validates email address format and field lengths.
 */
export function validateContactInput(
  name: string,
  email: string,
  notes?: string,
  group?: string
): { valid: boolean; error?: string } {
  const trimmedEmail = (email || "").trim();
  if (!trimmedEmail) {
    return { valid: false, error: "Email address is required." };
  }

  // RFC5322 simplified pattern matching backend validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(trimmedEmail)) {
    return { valid: false, error: "Please enter a valid email address (e.g. user@example.com)." };
  }

  if (trimmedEmail.length > 254) {
    return { valid: false, error: "Email address cannot exceed 254 characters." };
  }

  if (name && name.length > 255) {
    return { valid: false, error: "Name cannot exceed 255 characters." };
  }

  if (group && group.length > 50) {
    return { valid: false, error: "Group name cannot exceed 50 characters." };
  }

  if (notes && notes.length > 2000) {
    return { valid: false, error: "Notes cannot exceed 2000 characters." };
  }

  return { valid: true };
}

/**
 * Sorts contacts by display name (or email if name is empty) alphabetically.
 */
export function sortContacts(contacts: ContactItem[]): ContactItem[] {
  return [...contacts].sort((a, b) => {
    const nameA = (a.name || a.email || "").trim().toLowerCase();
    const nameB = (b.name || b.email || "").trim().toLowerCase();
    return nameA.localeCompare(nameB);
  });
}

/**
 * Filters contacts locally by search query and optional group name.
 */
export function filterContacts(
  contacts: ContactItem[],
  query: string = "",
  group: string = ""
): ContactItem[] {
  const q = query.trim().toLowerCase();
  const g = group.trim().toLowerCase();

  return contacts.filter((c) => {
    if (g && g !== "all" && (c.group_name || "").trim().toLowerCase() !== g) {
      return false;
    }
    if (!q) {
      return true;
    }
    const nameMatch = (c.name || "").toLowerCase().includes(q);
    const emailMatch = (c.email || "").toLowerCase().includes(q);
    const notesMatch = (c.notes || "").toLowerCase().includes(q);
    return nameMatch || emailMatch || notesMatch;
  });
}

/**
 * Returns distinct group names from contacts list, sorted.
 */
export function getDistinctGroups(contacts: ContactItem[]): string[] {
  const groups = new Set<string>();
  contacts.forEach((c) => {
    const grp = (c.group_name || "").trim();
    if (grp) {
      groups.add(grp);
    }
  });
  return Array.from(groups).sort();
}

/**
 * Autocomplete matching for Compose To/Cc/Bcc.
 * Requires at least 2 characters. Searches name and email case-insensitively.
 */
export function filterAutocompleteSuggestions(
  contacts: ContactItem[],
  query: string
): ContactItem[] {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length < 2) {
    return [];
  }
  return contacts.filter((c) => {
    const nameMatch = (c.name || "").toLowerCase().includes(trimmed);
    const emailMatch = (c.email || "").toLowerCase().includes(trimmed);
    return nameMatch || emailMatch;
  });
}

/**
 * Adds a chip to the list, preventing duplicates case-insensitively.
 */
export function addRecipientChip(
  existingChips: RecipientChip[],
  candidate: { name?: string; email: string }
): { chips: RecipientChip[]; added: boolean } {
  const email = (candidate.email || "").trim();
  if (!email) {
    return { chips: existingChips, added: false };
  }

  const isDuplicate = existingChips.some(
    (c) => c.email.toLowerCase() === email.toLowerCase()
  );

  if (isDuplicate) {
    return { chips: existingChips, added: false };
  }

  const newChip: RecipientChip = {
    name: candidate.name?.trim() || undefined,
    email,
  };

  return {
    chips: [...existingChips, newChip],
    added: true,
  };
}

/**
 * Removes a chip by index.
 */
export function removeRecipientChip(
  chips: RecipientChip[],
  indexToRemove: number
): RecipientChip[] {
  return chips.filter((_, i) => i !== indexToRemove);
}

/**
 * Parses raw comma-separated email list into chips, associating known contact names if available.
 */
export function parseChipsFromRecipientString(
  raw: string,
  knownContacts: ContactItem[] = []
): RecipientChip[] {
  const parts = (raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const seen = new Set<string>();
  const chips: RecipientChip[] = [];

  for (const part of parts) {
    // Handle format "Name <email@example.com>" or "email@example.com"
    let name: string | undefined;
    let email = part;

    const match = part.match(/^(?:"?([^"]*)"?\s)?<?([^>]+@[^>]+)>?$/);
    if (match) {
      name = match[1]?.trim() || undefined;
      email = match[2]?.trim() || email;
    }

    const lower = email.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      if (!name) {
        const contact = knownContacts.find((c) => c.email?.toLowerCase() === lower);
        if (contact && contact.name) {
          name = contact.name;
        }
      }
      chips.push({ name, email });
    }
  }

  return chips;
}

/**
 * Formats chips array back to a comma-separated email list.
 */
export function formatRecipientChipsToString(chips: RecipientChip[]): string {
  return chips.map((c) => c.email).join(", ");
}
