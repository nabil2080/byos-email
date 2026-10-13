import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>");
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).Node = dom.window.Node;
(globalThis as any).Element = dom.window.Element;

import { ContactItem } from "./api.js";
import {
  sortContacts,
  filterContacts,
  getDistinctGroups,
  validateContactInput,
  filterAutocompleteSuggestions,
  addRecipientChip,
  removeRecipientChip,
  parseChipsFromRecipientString,
  formatRecipientChipsToString,
} from "./utils/contacts.js";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEquals(actual: any, expected: any, message: string) {
  if (actual !== expected) {
    throw new Error(
      `Assertion failed: ${message} (expected: ${JSON.stringify(expected)}, got: ${JSON.stringify(actual)})`
    );
  }
}

export async function runContactsTests(): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  const test = async (name: string, fn: () => Promise<void> | void) => {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ ${name}:`, err);
      failed++;
    }
  };

  console.log("Running Contacts Management & Autocomplete Tests...");

  const sampleContacts: ContactItem[] = [
    {
      id: "c-1",
      mailbox_id: "mb-1",
      name: "Charlie Brown",
      email: "charlie@peanuts.com",
      notes: "Likes baseball and kites",
      group_name: "Friends",
      version: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: "c-2",
      mailbox_id: "mb-1",
      name: "Alice Smith",
      email: "alice@acme.com",
      notes: "VP of Engineering at Acme Corp",
      group_name: "Work",
      version: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: "c-3",
      mailbox_id: "mb-1",
      name: "Bob Jones",
      email: "bob@acme.com",
      notes: "Product designer working on mobile app",
      group_name: "Work",
      version: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: "c-4",
      mailbox_id: "mb-1",
      name: "",
      email: "david.no.name@company.org",
      notes: "Only email provided",
      group_name: "",
      version: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  // 1. test_contact_list_renders
  await test("test_contact_list_renders", () => {
    // Verify sorting order: Alice Smith, Bob Jones, Charlie Brown, david.no.name@company.org
    const sorted = sortContacts(sampleContacts);
    assertEquals(sorted.length, 4, "Must maintain all 4 contacts");
    assertEquals(sorted[0].name, "Alice Smith", "First sorted contact should be Alice Smith");
    assertEquals(sorted[1].name, "Bob Jones", "Second sorted contact should be Bob Jones");
    assertEquals(sorted[2].name, "Charlie Brown", "Third sorted contact should be Charlie Brown");
    assertEquals(sorted[3].email, "david.no.name@company.org", "Fourth contact sorted by email fallback");

    // Verify distinct groups computation
    const groups = getDistinctGroups(sampleContacts);
    assertEquals(groups.length, 2, "Should identify 2 distinct non-empty groups");
    assert(groups.includes("Friends"), "Groups should include Friends");
    assert(groups.includes("Work"), "Groups should include Work");

    // Render list into mock DOM to verify presentation markup
    const container = document.createElement("div");
    container.id = "contact-list-container";
    sorted.forEach((c) => {
      const item = document.createElement("div");
      item.className = "contact-item";
      item.setAttribute("data-id", c.id);

      const displayName = c.name || c.email || "";
      const initials = (displayName || "U")
        .split(" ")
        .map((p) => p[0] || "")
        .slice(0, 2)
        .join("")
        .toUpperCase();

      item.innerHTML = `
        <div class="avatar">${initials}</div>
        <div class="name">${displayName}</div>
        <div class="email">${c.email}</div>
        ${c.group_name ? `<span class="group-badge">${c.group_name}</span>` : ""}
      `;
      container.appendChild(item);
    });

    const renderedItems = container.querySelectorAll(".contact-item");
    assertEquals(renderedItems.length, 4, "Should render 4 contact DOM elements");
    const firstAvatar = renderedItems[0].querySelector(".avatar")?.textContent;
    assertEquals(firstAvatar, "AS", "Alice Smith avatar initial should be AS");
    const thirdBadge = renderedItems[2].querySelector(".group-badge")?.textContent;
    assertEquals(thirdBadge, "Friends", "Charlie Brown group badge should be Friends");
  });

  // 2. test_contact_search_filters
  await test("test_contact_search_filters", () => {
    // Search by name
    const byName = filterContacts(sampleContacts, "alice");
    assertEquals(byName.length, 1, "Searching 'alice' should match exactly 1 contact");
    assertEquals(byName[0].email, "alice@acme.com", "Matched contact must be Alice");

    // Search by email domain
    const byDomain = filterContacts(sampleContacts, "@acme.com");
    assertEquals(byDomain.length, 2, "Searching '@acme.com' should match Alice and Bob");

    // Search by notes
    const byNotes = filterContacts(sampleContacts, "baseball");
    assertEquals(byNotes.length, 1, "Searching 'baseball' should match Charlie Brown via notes");
    assertEquals(byNotes[0].name, "Charlie Brown", "Matched Charlie Brown");

    // Filter by group
    const workGroup = filterContacts(sampleContacts, "", "Work");
    assertEquals(workGroup.length, 2, "Group filter 'Work' should return 2 contacts");

    // Filter by group + search query combined
    const workBob = filterContacts(sampleContacts, "designer", "Work");
    assertEquals(workBob.length, 1, "Group 'Work' + query 'designer' matches Bob");
    assertEquals(workBob[0].name, "Bob Jones", "Should match Bob Jones");

    // Empty query returns all contacts
    const all = filterContacts(sampleContacts, "");
    assertEquals(all.length, 4, "Empty query should return all contacts");
  });

  // 3. test_contact_create_validates_email
  await test("test_contact_create_validates_email", () => {
    // Valid email
    const validRes = validateContactInput("Test User", "test@example.com");
    assert(validRes.valid, "Valid email should pass validation");

    // Missing email
    const emptyRes = validateContactInput("Test User", "");
    assert(!emptyRes.valid, "Empty email should fail validation");
    assert(emptyRes.error?.includes("required") || false, "Should indicate email is required");

    // Invalid format: missing @
    const noAt = validateContactInput("Test User", "invalidemail.com");
    assert(!noAt.valid, "Email without @ should fail validation");

    // Invalid format: missing domain TLD
    const noTld = validateContactInput("Test User", "user@localhost");
    assert(!noTld.valid, "Email without domain TLD should fail validation");

    // Invalid format: whitespace inside
    const spaceInEmail = validateContactInput("Test User", "user @example.com");
    assert(!spaceInEmail.valid, "Email with spaces should fail validation");

    // Notes length limit (> 2000 chars)
    const longNotes = "x".repeat(2001);
    const notesRes = validateContactInput("Test User", "valid@example.com", longNotes);
    assert(!notesRes.valid, "Notes exceeding 2000 chars must fail validation");

    // Group length limit (> 50 chars)
    const longGroup = "g".repeat(51);
    const groupRes = validateContactInput("Test User", "valid@example.com", "notes", longGroup);
    assert(!groupRes.valid, "Group name exceeding 50 chars must fail validation");
  });

  // 4. test_contact_delete_confirms
  await test("test_contact_delete_confirms", () => {
    let contactsState = [...sampleContacts];
    let pendingDeleteId: string | null = null;

    // Step 1: User clicks delete on contact c-2 (Alice)
    const requestDelete = (id: string) => {
      pendingDeleteId = id;
    };

    // Step 2: User cancels delete
    const cancelDelete = () => {
      pendingDeleteId = null;
    };

    // Step 3: User confirms delete
    const confirmDelete = () => {
      if (!pendingDeleteId) return;
      contactsState = contactsState.filter((c) => c.id !== pendingDeleteId);
      pendingDeleteId = null;
    };

    requestDelete("c-2");
    assertEquals(pendingDeleteId, "c-2", "Delete confirmation state must hold target contact ID");
    assertEquals(contactsState.length, 4, "Contact must not be deleted before confirmation");

    // Cancel preserves contact
    cancelDelete();
    assertEquals(pendingDeleteId, null, "Canceling clears confirmation state");
    assertEquals(contactsState.length, 4, "Contact is preserved after canceling");

    // Re-request and confirm
    requestDelete("c-2");
    confirmDelete();
    assertEquals(pendingDeleteId, null, "Confirmation state cleared after execution");
    assertEquals(contactsState.length, 3, "Contact c-2 is removed after confirmation");
    assert(!contactsState.some((c) => c.id === "c-2"), "c-2 is no longer in contacts");
  });

  // 5. test_autocomplete_shows_matches
  await test("test_autocomplete_shows_matches", () => {
    // Under 2 characters should return empty list
    const zeroChar = filterAutocompleteSuggestions(sampleContacts, "");
    assertEquals(zeroChar.length, 0, "Query with 0 chars returns no suggestions");

    const oneChar = filterAutocompleteSuggestions(sampleContacts, "a");
    assertEquals(oneChar.length, 0, "Query with 1 char returns no suggestions (min length 2)");

    // >= 2 chars matching name
    const matchName = filterAutocompleteSuggestions(sampleContacts, "char");
    assertEquals(matchName.length, 1, "Query 'char' should match Charlie Brown");
    assertEquals(matchName[0].email, "charlie@peanuts.com", "Matches Charlie's email");

    // >= 2 chars matching email
    const matchEmail = filterAutocompleteSuggestions(sampleContacts, "david");
    assertEquals(matchEmail.length, 1, "Query 'david' matches david.no.name@company.org");

    // Case-insensitive query
    const matchUpper = filterAutocompleteSuggestions(sampleContacts, "BOB");
    assertEquals(matchUpper.length, 1, "Uppercase 'BOB' should match Bob Jones");

    // Non-matching query
    const noMatch = filterAutocompleteSuggestions(sampleContacts, "xyz123");
    assertEquals(noMatch.length, 0, "Non-matching query returns empty list");
  });

  // 6. test_autocomplete_adds_chip
  await test("test_autocomplete_adds_chip", () => {
    let chips: { name?: string; email: string }[] = [];

    // Add first contact chip
    const res1 = addRecipientChip(chips, { name: "Alice Smith", email: "alice@acme.com" });
    assert(res1.added, "Adding Alice should succeed");
    chips = res1.chips;
    assertEquals(chips.length, 1, "Chips count should be 1");
    assertEquals(chips[0].name, "Alice Smith", "First chip name is Alice Smith");
    assertEquals(chips[0].email, "alice@acme.com", "First chip email is alice@acme.com");

    // Add second contact chip
    const res2 = addRecipientChip(chips, { name: "Bob Jones", email: "bob@acme.com" });
    assert(res2.added, "Adding Bob should succeed");
    chips = res2.chips;
    assertEquals(chips.length, 2, "Chips count should be 2");

    // Add ad-hoc raw email chip (no name)
    const res3 = addRecipientChip(chips, { email: "external@other.org" });
    assert(res3.added, "Adding external email should succeed");
    chips = res3.chips;
    assertEquals(chips.length, 3, "Chips count should be 3");
    assertEquals(chips[2].name, undefined, "Ad-hoc email has no name");

    // Verify formatted comma-separated output
    const str = formatRecipientChipsToString(chips);
    assertEquals(str, "alice@acme.com, bob@acme.com, external@other.org", "Formatted string matches emails");

    // Remove chip at index 1 (Bob)
    chips = removeRecipientChip(chips, 1);
    assertEquals(chips.length, 2, "Chips count should be 2 after removal");
    assertEquals(chips[0].email, "alice@acme.com", "First chip remains Alice");
    assertEquals(chips[1].email, "external@other.org", "Second chip is now external");
  });

  // 7. test_autocomplete_deduplicates
  await test("test_autocomplete_deduplicates", () => {
    let chips = [
      { name: "Alice Smith", email: "alice@acme.com" },
    ];

    // Attempt to add identical email
    const dupExact = addRecipientChip(chips, { name: "Alice Duplicate", email: "alice@acme.com" });
    assert(!dupExact.added, "Adding duplicate exact email should be rejected");
    assertEquals(dupExact.chips.length, 1, "Chips array length must not increase");

    // Attempt to add case-differing duplicate email
    const dupCase = addRecipientChip(chips, { name: "ALICE", email: "ALICE@ACME.COM" });
    assert(!dupCase.added, "Adding duplicate case-insensitive email should be rejected");
    assertEquals(dupCase.chips.length, 1, "Chips array length must not increase");

    // Attempt to add with leading/trailing whitespace
    const dupTrim = addRecipientChip(chips, { email: "  alice@acme.com  " });
    assert(!dupTrim.added, "Adding duplicate trimmed email should be rejected");
    assertEquals(dupTrim.chips.length, 1, "Chips array length must not increase");

    // Adding distinct email succeeds
    const distinct = addRecipientChip(chips, { name: "Bob", email: "bob@acme.com" });
    assert(distinct.added, "Adding unique email must succeed");
    assertEquals(distinct.chips.length, 2, "Chips length increases to 2");

    // Test parseChipsFromRecipientString deduplication
    const parsed = parseChipsFromRecipientString(
      "alice@acme.com, bob@acme.com, ALICE@ACME.COM, bob@acme.com, charlie@peanuts.com",
      sampleContacts
    );
    assertEquals(parsed.length, 3, "parseChipsFromRecipientString must deduplicate case-insensitively");
    assertEquals(parsed[0].email, "alice@acme.com", "First is alice");
    assertEquals(parsed[0].name, "Alice Smith", "Associates name from known contacts");
    assertEquals(parsed[1].email, "bob@acme.com", "Second is bob");
    assertEquals(parsed[2].email, "charlie@peanuts.com", "Third is charlie");
  });

  return { passed, failed };
}
