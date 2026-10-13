# Contact Management Polish (V1) Report

## What was built
Implemented Contact Management Polish (V1) across the BYOS Go backend and SolidJS webmail frontend. Extended the PostgreSQL contacts schema with search and grouping metadata columns (`name`, `email`, `notes`, `group_name`, `idx_contacts_mailbox_email_lower`, `idx_contacts_mailbox_group_name`), added RESTful contact endpoints for listing (with full-text search across name, email, and notes), creation (with duplicate rejection HTTP 409 `contact_exists`), updating, deletion, and bulk import/export for CSV and vCard (.vcf) formats. In the webmail frontend, built a 3-pane responsive Contacts modal with search, contact grouping, inline editing, and CSV/vCard import/export. Replaced raw To/Cc/Bcc inputs in `ComposeDrawer.tsx` with an accessible `RecipientInput` component providing autocomplete chips, debounced suggestions (>= 2 characters, 150ms), keyboard navigation, chip deletion, duplicate prevention, while preserving underlying input element IDs (`#composeToInput`, `#composeSubjectInput`) for backwards compatibility with browser integration tests.

## Files edited
| File | Reason |
|------|--------|
| `infra/postgres/init/052_contacts_metadata.sql` | Migration adding name, email, notes, group_name columns, indices, and updated_at trigger to contacts table |
| `tools/clean-test-data.sql` | Wipes contacts table during test suite reset |
| `services/api/contacts.go` | Implements contact CRUD handlers, CSV/vCard import parser with deduplication, and export handlers |
| `services/api/contacts_test.go` | Implements 9 Go backend unit tests covering search, validation, deduplication, CSV/vCard import, and export |
| `services/api/main.go` | Registers contacts endpoints under `/v1/mailboxes/{mailbox_id}/contacts` and import/export routes |
| `apps/webmail/src/api.ts` | Adds contact API client methods (`fetchContacts`, `createContact`, `updateContact`, `deleteContact`, `importContacts`, `exportContacts`) |
| `apps/webmail/src/utils/contacts.ts` | Provides contact filtering, validation, group extraction, chip parsing, and deduplication utilities |
| `apps/webmail/src/components/RecipientInput.tsx` | Implements accessible recipient chip input with autocomplete dropdown, keyboard navigation, and legacy ID retention |
| `apps/webmail/src/components/modals/ContactsModal.tsx` | Implements 3-pane modal layout for contacts with search, group filter, inline edit, and CSV/vCard import/export |
| `apps/webmail/src/components/Sidebar.tsx` | Adds `data-testid="contacts-nav-btn"` to Contacts navigation button |
| `apps/webmail/src/components/ComposeDrawer.tsx` | Integrates RecipientInput for To, Cc, and Bcc fields while maintaining #composeToInput ID |
| `apps/webmail/src/App.tsx` | Manages contacts state, prefetching, and renders ContactsModal |
| `apps/webmail/src/contacts.test.ts` | Implements 7 frontend unit tests for contact listing, search, validation, deletion, and autocomplete chips |
| `apps/webmail/src/run_test.node.js` | Registers contacts unit test suite in webmail test runner |
| `tests/browser/test_contacts.mjs` | Implements 16-step browser integration test exercising CRUD, CSV import/export, and compose autocomplete |
| `smoke.ps1` | Registers test_contacts.mjs in the 12-test smoke suite |

## Investigation: Grep for Compose Selectors

Selector search output across apps/webmail and tests/browser:
```
apps/webmail/src/components/ComposeDrawer.tsx:286:                    id="composeToInput"
tests/browser/test_account_switch_crypto.mjs:147:      await page.waitForSelector('#composeToInput', { timeout: 5000 });
tests/browser/test_account_switch_crypto.mjs:154:        const toInput = document.querySelector('#composeToInput');
tests/browser/test_account_switch_crypto.mjs:171:      await page.type('#composeToInput', to);
tests/browser/test_browser_audit_items.mjs:170:    await page.focus('#composeToInput');
tests/browser/test_browser_audit_items.mjs:179:      toVal: document.querySelector('#composeToInput')?.value,
tests/browser/test_composer.mjs:115:    await page.type('#composeToInput', 'external@test.local');
tests/browser/test_composer.mjs:398:    await page.type('#composeToInput', 'draft_recipient@example.com');
tests/browser/test_manual_compose_flows.mjs:340:    const toInput = await page.waitForSelector('#composeToInput', { timeout: 5000 });
tests/browser/test_offline.mjs:317:    const toInput = await page.waitForSelector('#composeToInput', { timeout: 5000 });
tests/browser/test_wire_integrity.mjs:259:    await page.waitForSelector('#composeToInput', { timeout: 5000 });
tests/browser/test_wire_integrity.mjs:260:    await page.type('#composeToInput', 'bob@byos.local');
tests/browser/test_wire_integrity.mjs:610:    await page.waitForSelector('#composeToInput', { timeout: 5000 });
tests/browser/test_wire_integrity.mjs:611:    await page.type('#composeToInput', 'external@test.local');
apps/webmail/src/components/ComposeDrawer.tsx:332:                <label for="composeSubjectInput" class="w-16 text-[#55575B] dark:text-[#A1A1AA] font-medium">
apps/webmail/src/components/ComposeDrawer.tsx:336:                  id="composeSubjectInput"
tests/browser/test_account_switch_crypto.mjs:155:        const subInput = document.querySelector('#composeSubjectInput');
tests/browser/test_account_switch_crypto.mjs:172:      await page.type('#composeSubjectInput', subject);
tests/browser/test_browser_audit_items.mjs:172:    await page.focus('#composeSubjectInput');
tests/browser/test_browser_audit_items.mjs:180:      subVal: document.querySelector('#composeSubjectInput')?.value,
tests/browser/test_browser_audit_items.mjs:231:        const byId = document.querySelector('#composeSubjectInput');
tests/browser/test_composer.mjs:117:    await page.type('#composeSubjectInput', msgSubject);
tests/browser/test_composer.mjs:400:    await page.type('#composeSubjectInput', offlineDraftSubject);
tests/browser/test_manual_compose_flows.mjs:342:    const subjInput = await page.waitForSelector('#composeSubjectInput', { timeout: 5000 });
tests/browser/test_offline.mjs:320:    const subjInput = await page.waitForSelector('#composeSubjectInput', { timeout: 5000 });
tests/browser/test_wire_integrity.mjs:261:    await page.type('#composeSubjectInput', scenarioASubject);
tests/browser/test_wire_integrity.mjs:612:    await page.type('#composeSubjectInput', `Wire Test C Non-Alias Outbound ${Date.now()}`);
```

## RecipientInput DOM Structure

The JSX renders an outer flex container with the `<label>`, a flex chip container, and the real underlying `<input>` element with `id={props.id || "composeToInput"}` and `data-testid="recipient-input"`:
```tsx
  return (
    <div class="relative flex items-center gap-2 text-xs flex-wrap min-h-[32px]">
      <label
        for={props.id || (props.label === "To" ? "composeToInput" : undefined)}
        class="w-16 text-[#55575B] dark:text-[#A1A1AA] font-medium select-none"
      >
        {props.label}:
      </label>

      <div
        class="flex-1 flex flex-wrap items-center gap-1.5 py-1 min-w-0"
        onClick={() => inputRef?.focus()}
      >
        {/* Rendered Chips */}
        <For each={chips()}>
          {(chip, index) => {
            const displayName = chip.name || chip.email;
            return (
              <span
                class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#EFECE6] dark:bg-[#2D3139] text-[#1A1B1E] dark:text-[#F3F4F6] text-xs font-medium border border-[#D5D1C8] dark:border-[#383C45] group select-none shadow-xs transition"
                title={chip.email}
                data-testid="recipient-chip"
                data-email={chip.email}
              >
                <Show when={chip.name}>
                  <span
                    class="w-4 h-4 rounded-full bg-[#A27561] text-white flex items-center justify-center text-[10px] font-bold"
                    data-testid="chip-avatar"
                  >
                    {chip.name![0].toUpperCase()}
                  </span>
                </Show>
                <span class="max-w-[140px] truncate" data-testid="chip-label">{displayName}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeChip(index());
                  }}
                  class="text-[#878A8E] hover:text-[#1A1B1E] dark:hover:text-white rounded-full p-0.5 transition cursor-pointer"
                  aria-label="Remove recipient"
                >
                  <svg class="w-3 h-3 stroke-current fill-none stroke-2" viewBox="0 0 24 24">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </span>
            );
          }}
        </For>

        {/* Text Input */}
        <div class="relative flex-1 min-w-[120px]">
          <input
            id={props.id || (props.label === "To" ? "composeToInput" : undefined)}
            ref={inputRef}
            type="text"
            placeholder={chips().length === 0 ? props.placeholder || "recipient@example.com" : ""}
            value={inputValue()}
            onInput={(e) => handleInputChange(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            required={props.required && chips().length === 0}
            class="w-full bg-transparent text-xs text-[#1A1B1E] dark:text-[#F3F4F6] placeholder-[#878A8E] dark:placeholder-[#71717A] focus:outline-none py-0.5"
            autocomplete="off"
            data-testid="recipient-input"
          />

          {/* Autocomplete Dropdown */}
          <Show when={isOpen() && suggestions().length > 0}>
            <ul
              class="absolute left-0 top-full mt-1 w-72 max-h-60 overflow-y-auto bg-white dark:bg-[#1E2025] rounded-xl shadow-xl border border-[#E2DFD8] dark:border-[#2E3138] py-1 z-50 font-sans"
              role="listbox"
              data-testid="autocomplete-dropdown"
            >
              <For each={suggestions()}>
                {(contact, index) => {
                  const initial = (contact.name ? contact.name[0] : (contact.email || "U")[0]).toUpperCase();
                  const isHighlighted = index() === highlightedIndex();
                  return (
                    <li
                      role="option"
                      aria-selected={isHighlighted}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        if (contact.email) {
                          addChip(contact.name, contact.email);
                        }
                      }}
                      onMouseEnter={() => setHighlightedIndex(index())}
                      class={`px-3 py-2 flex items-center gap-2.5 cursor-pointer text-xs transition ${
                        isHighlighted
                          ? "bg-[#FAF7F2] dark:bg-[#282B32] text-[#A27561] dark:text-[#E5B5A1]"
                          : "text-[#2B2C2D] dark:text-[#F3F4F6] hover:bg-[#F8F7F4] dark:hover:bg-[#26282E]"
                      }`}
                      data-testid="autocomplete-item"
                    >
                      <div class="w-6 h-6 rounded-full bg-[#A27561]/20 text-[#A27561] dark:text-[#E5B5A1] flex items-center justify-center font-bold text-xs flex-shrink-0">
                        {initial}
                      </div>
                      <div class="min-w-0 flex-1">
                        <div class="font-medium truncate">{contact.name || contact.email}</div>
                        <Show when={contact.name && contact.email}>
                          <div class="text-[11px] text-[#6F7173] dark:text-[#878A8E] truncate">
                            {contact.email}
                          </div>
                        </Show>
                      </div>
                      <Show when={contact.group_name}>
                        <span class="text-[10px] px-1.5 py-0.5 rounded bg-[#F0ECE1] dark:bg-[#2E3138] text-[#7A756D] dark:text-[#9A9DA4] font-medium">
                          {contact.group_name}
                        </span>
                      </Show>
                    </li>
                  );
                }}
              </For>
            </ul>
          </Show>
        </div>
      </div>
    </div>
  );
```

## Reverted Test Diff
The diff against HEAD for `tests/browser/test_account_switch_crypto.mjs` is clean and empty:
```
git diff HEAD tests/browser/test_account_switch_crypto.mjs
(empty)
```

## Raw Evidence

### Database Schema Dump
```
docker exec byos-postgres psql -U byos -d byos -c "\d contacts"
                                 Table "public.contacts"
       Column       |           Type           | Collation | Nullable |      Default      
--------------------+--------------------------+-----------+----------+-------------------
 id                 | uuid                     |           | not null | gen_random_uuid()
 mailbox_id         | uuid                     |           | not null | 
 encrypted_envelope | bytea                    |           |          | 
 version            | integer                  |           | not null | 1
 created_at         | timestamp with time zone |           | not null | now()
 updated_at         | timestamp with time zone |           | not null | now()
 name               | text                     |           |          | 
 email              | text                     |           |          | 
 notes              | text                     |           |          | 
 group_name         | text                     |           |          | 
Indexes:
    "contacts_pkey" PRIMARY KEY, btree (id)
    "idx_contacts_mailbox_email_lower" UNIQUE, btree (mailbox_id, lower(email)) WHERE email IS NOT NULL
    "idx_contacts_mailbox_group_name" btree (mailbox_id, group_name)
    "idx_contacts_mailbox_updated" btree (mailbox_id, updated_at DESC, id)
Check constraints:
    "contacts_version_check" CHECK (version >= 1)
Foreign-key constraints:
    "contacts_mailbox_id_fkey" FOREIGN KEY (mailbox_id) REFERENCES mailboxes(id) ON DELETE CASCADE
Triggers:
    contacts_updated_at BEFORE UPDATE ON contacts FOR EACH ROW EXECUTE FUNCTION update_contacts_updated_at()
```

### Go Backend Test Output
```
cd services\api
go test -run "Test.*Contact|TestImport|TestExport" -v
=== RUN   TestContactsCiphertextLifecycle
--- PASS: TestContactsCiphertextLifecycle (0.16s)
=== RUN   TestContactsUnauthenticated
--- PASS: TestContactsUnauthenticated (0.01s)
=== RUN   TestListContactsSearch
--- PASS: TestListContactsSearch (0.18s)
=== RUN   TestListContactsGroupFilter
--- PASS: TestListContactsGroupFilter (0.16s)
=== RUN   TestCreateContactRejectsDuplicateEmail
--- PASS: TestCreateContactRejectsDuplicateEmail (0.09s)
=== RUN   TestCreateContactValidation
--- PASS: TestCreateContactValidation (0.11s)
=== RUN   TestUpdateContactOwnership
--- PASS: TestUpdateContactOwnership (0.10s)
=== RUN   TestDeleteContact
--- PASS: TestDeleteContact (0.13s)
=== RUN   TestImportCSV
--- PASS: TestImportCSV (0.10s)
=== RUN   TestImportVCard
--- PASS: TestImportVCard (0.07s)
=== RUN   TestExportCSV
--- PASS: TestExportCSV (0.15s)
=== RUN   TestImportAssignsThreadID
--- PASS: TestImportAssignsThreadID (0.12s)
PASS
ok  	byos.email/services/api	2.344s
```

Full Go backend test suite:
```
cd services\api
go test ./... -count=1
ok  	byos.email/services/api	31.545s
```

### Webmail Unit Test Output
```
cd apps\webmail
npm.cmd test -- --run
...
Running Contacts Management Tests...
Running Contacts Management & Autocomplete Tests...
  ✓ test_contact_list_renders
  ✓ test_contact_search_filters
  ✓ test_contact_create_validates_email
  ✓ test_contact_delete_confirms
  ✓ test_autocomplete_shows_matches
  ✓ test_autocomplete_adds_chip
  ✓ test_autocomplete_deduplicates
CONTACTS MANAGEMENT TESTS: 7 passed, 0 failed

OVERALL: 258 passed, 0 failed
```

### Standalone Output of Previously Failing/Investigated Tests

1. `test_compose_default_account.mjs`
```
node --experimental-wasm-modules tests/browser/test_compose_default_account.mjs
(node:2784) ExperimentalWarning: Importing WebAssembly modules is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
================================================================================
      VERIFY COMPOSE FROM: DEFAULTS TO ACTIVE MAILBOX (ALICE & BOB)             
================================================================================

--- [STEP 1] Setup session with Alice and Bob connected accounts ---
  [BROWSER ERROR] Failed to load resource: the server responded with a status of 401 (Unauthorized)

--- [STEP 2] Check initial compose with Alice as active mailbox ---
  Alice active compose From state: {"selectValue":"account:c0000000-0000-0000-0000-000000000001","selectedText":"alice@byos.local"}
  PASS: From value is account:c0000000-0000-0000-0000-000000000001
  PASS: From text is alice@byos.local
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\compose_from_active_mailbox_alice.png

--- [STEP 3] Switch active account to Bob (bob@byos.local) ---
  Sidebar active account text: "bob@byos.local"
  PASS: Sidebar shows bob@byos.local active

--- [STEP 4] Click 'New Message' while Bob is active mailbox ---
  Bob active compose From state: {"selectValue":"account:c0000000-0000-0000-0000-000000000002","selectedText":"bob@byos.local"}
  PASS: From value is account:c0000000-0000-0000-0000-000000000002 (NOT Alice)
  PASS: From text is bob@byos.local (NOT Alice)
  PASS: From text does NOT leak alice@byos.local
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\compose_from_active_mailbox_bob.png

--- [STEP 5] Close and reopen compose drawer while Bob is active ---
  Bob reopened compose From state: {"selectValue":"account:c0000000-0000-0000-0000-000000000002","selectedText":"bob@byos.local"}
  PASS: Reopened From value remains Bob (c0000000-0000-0000-0000-000000000002)
  PASS: Reopened From text remains bob@byos.local

================================================================================
   ALL CHECKS PASSED: COMPOSE FROM: DEFAULTS ACCURATELY TO ACTIVE MAILBOX       
================================================================================
```

2. `test_masked_email.mjs`
```
node --experimental-wasm-modules tests/browser/test_masked_email.mjs
================================================================================
             MASKED EMAIL / BURNER ALIASES (V1) INTEGRATION TEST                
================================================================================

--- [STEP 1] Real Login Flow: Navigate & authenticate as alice@byos.local ---
  [HTTP 404] GET http://127.0.0.1:3001/favicon.ico
  [BROWSER ERROR] Failed to load resource: the server responded with a status of 404 (Not Found)
  [HTTP 401] GET http://127.0.0.1:3001/v1/auth/me
  [BROWSER ERROR] Failed to load resource: the server responded with a status of 401 (Unauthorized)
  Alice logged in successfully.

--- [STEP 2] Verify Sidebar and Open Masked Email via Settings ---
  PASS: Sidebar must NOT have Masked Aliases button
  Confirmed: 'Masked Aliases' is removed from the sidebar.
  Captured screenshot: F:\Codex\byos-email\tests\browser\artifacts\masked_email_sidebar_clean.png
  PASS: Masked Email header visible
  Captured screenshot: F:\Codex\byos-email\tests\browser\artifacts\masked_email_tab.png

--- [STEP 3] Open Create Modal & Test Custom Mode ---
  Validation message for invalid input: "Only lowercase letters, numbers, and . - _ are allowed"
  PASS: Validation error displayed for invalid characters
  PASS: Create button is disabled while input is invalid
  Input value after typing uppercase: "amazon-6gyjob"
  PASS: Uppercase characters were silently lowercased
  Live address preview: "amazon-6gyjob@masked.byos.local"
  PASS: Live preview shows full address
  Captured screenshot: F:\Codex\byos-email\tests\browser\artifacts\masked_email_custom_modal.png

--- [STEP 4] Submit custom alias and verify table row ---
  Created custom alias address: "amazon-6gyjob@masked.byos.local"
  PASS: Custom alias address matches created value

--- [STEP 5] Copy alias to clipboard ---
  PASS: Copy button exists
  PASS: Copied! tooltip appeared on click

--- [STEP 5b] Verify Compose From: dropdown lists alias ---
  Compose From options: [{"value":"account:c0000000-0000-0000-0000-000000000001","text":"alice@byos.local"},{"value":"alias:amazon-6gyjob@masked.byos.local","text":"amazon-6gyjob@masked.byos.local (alias)"}]
  PASS: Compose From: dropdown includes alias amazon-6gyjob@masked.byos.local
  Captured screenshot: F:\Codex\byos-email\tests\browser\artifacts\masked_email_compose_from_dropdown.png

--- [STEP 6] Inbound SMTP delivery to alias amazon-6gyjob@masked.byos.local ---
  Inbound SMTP result: code=250 response="250 2.0.0 OK: queued"
  PASS: Inbound SMTP accepted (250 OK)

--- [STEP 7] Navigate to Inbox & Open received message ---
  PASS: Message found in Inbox and clicked
  Reading Pane alias badge: "Received via Amazon Shopping"
  PASS: Alias badge contains label or address
  Captured screenshot: F:\Codex\byos-email\tests\browser\artifacts\masked_email_reading_pane_badge.png

--- [STEP 8] Outbound Reply from Alias verification ---
  Compose From address: "alias:amazon-6gyjob@masked.byos.local"
  PASS: Compose From pre-filled with alias address amazon-6gyjob@masked.byos.local

--- [GAP 3] Query reply_count before sending reply ---
Raw SQL query output BEFORE send:
 reply_count 
-------------
           0
(1 row)

  Parsed reply_count before send: 0

--- [GAP 1] Fill reply body and click Send ---
  Clicked Send button in ComposeDrawer
  Waiting for /v1/outbound/send response (undo send countdown + encryption)...
  [HTTP 404] GET http://127.0.0.1:3001/v1/keys/shop%40external-merchant.com
  [BROWSER ERROR] Failed to load resource: the server responded with a status of 404 (Not Found)
  Outbound send response HTTP status: 201
  PASS: Outbound request returned HTTP 201 (got 201)
  Outbound send response payload: {"delivery_id":"00f8ccf0-498f-4fe2-b209-8b4c9eae8d4b","status":"queued"}
  PASS: Outbound response contains delivery_id

--- [GAP 3] Query reply_count after sending reply ---
Raw SQL query output AFTER send:
 reply_count 
-------------
           1
(1 row)

  Parsed reply_count after send: 1
  PASS: reply_count increased by exactly 1 (0 -> 1)

--- [GAP 1] Fetch delivered message from Mailpit ---
  PASS: Delivered message found in Mailpit for shop@external-merchant.com
  PASS: Fetched full message from Mailpit API

--- [GAP 2] Verify Authentication-Results header ---
  Authentication-Results header: "byos.local; dkim=pass (2048-bit key) header.d=masked.byos.local header.i=@masked.byos.local header.s=byos"
  PASS: Authentication-Results contains dkim=pass
  PASS: Authentication-Results contains masked.byos.local
  PASS: Authentication-Results contains header.i=@masked.byos.local
  PASS: Authentication-Results does not contain double @ in header.i

--- [GAP 1] Screenshot Mailpit-rendered message ---
  Captured screenshot: F:\Codex\byos-email\tests\browser\artifacts\masked_email_mailpit_reply.png

--- [STEP 9] Disable alias and assert inbound SMTP 550 rejection ---
  Status after toggle: "amazon-6gyjob@masked.byos.local"
  Sending inbound SMTP to disabled alias amazon-6gyjob@masked.byos.local...
  Disabled alias SMTP result: code=550 response="550 5.0.0 550 alias disabled"
  PASS: Inbound SMTP rejected with 550 for disabled alias
  PASS: Response conveys 550 error code

--- [STEP 10] Delete alias with confirmation modal ---
  Captured screenshot: F:\Codex\byos-email\tests\browser\artifacts\masked_email_delete_modal.png
  Matching rows for deleted alias in table: 0
  PASS: Alias deleted from table

================================================================================
             ALL MASKED EMAIL BROWSER VERIFICATION STEPS PASSED                 
================================================================================
```

3. `test_alias_custom.mjs`
```
node --experimental-wasm-modules tests/browser/test_alias_custom.mjs
================================================================================
             13-STEP CUSTOM ALIAS & SIDEBAR REMOVAL VERIFICATION              
================================================================================

--- [STEP 1] Login as alice@byos.local & Verify Sidebar has no 'Masked Aliases' ---
  [BROWSER ERROR] Failed to load resource: the server responded with a status of 404 (Not Found)
  [BROWSER ERROR] Failed to load resource: the server responded with a status of 401 (Unauthorized)
  Alice logged in successfully.
  PASS: Sidebar must NOT render 'Masked Aliases' button
  PASS: Sidebar text must not contain 'Masked Aliases'
  Confirmed: Masked Aliases is removed from the sidebar navigation.
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\alias_sidebar_removed.png

--- [STEP 2] Confirm Settings -> Masked Email loads ---
  PASS: Masked Email settings page loaded

--- [STEP 3] Open Create Modal & Verify Mode Toggle (Defaults to Random) ---
  PASS: Create alias modal defaults to Random mode

--- [STEP 4] Create Random Alias ---
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\alias_create_random.png
  Random alias generated successfully.

--- [STEP 5] Switch to Custom Mode ---

--- [STEP 6] Enter invalid characters & Verify Inline Error ---
  Validation error for invalid chars: "Only lowercase letters, numbers, and . - _ are allowed"
  PASS: Validation error matches for invalid chars
  PASS: Submit button disabled for invalid characters
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\alias_validation_error.png

--- [STEP 7] Enter reserved name & Verify Inline Error ---
  Validation error for reserved name 'admin': "This alias name is reserved"
  PASS: Validation error matches for reserved name
  PASS: Submit button disabled for reserved word

--- [STEP 9 & 10] Create Valid Custom Alias 'amazon-zec5@masked.byos.local' ---
  PASS: Uppercase entered was silently lowercased
  PASS: Live preview matches expected: "amazon-zec5@masked.byos.local"
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\alias_create_custom.png
  PASS: Custom alias appears in aliases table
  Custom alias amazon-zec5@masked.byos.local created and listed.

--- [STEP 8] Test Duplicate Alias Path (Conflict 409) ---
  [BROWSER ERROR] Failed to load resource: the server responded with a status of 409 (Conflict)
  Modal error on duplicate alias: "That alias is already taken. Try a different name."
  PASS: Friendly duplicate error 'That alias is already taken. Try a different name.' rendered
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\alias_duplicate_error.png

--- [STEP 11] Verify Compose From: dropdown lists Custom Alias ---
  Compose From: options found: [
  'alice@byos.local',
  'amazon-zec5@masked.byos.local (alias)',
  '5r5kecegum9v@masked.byos.local (alias)'
]
  PASS: Compose From: dropdown has more than 1 option
  PASS: Dropdown includes the custom alias amazon-zec5
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\alias_from_dropdown.png

--- [STEP 12] Inbound SMTP Delivery to 'amazon-zec5@masked.byos.local' ---
  Inbound SMTP response: code=250 response="250 2.0.0 OK: queued"
  PASS: Inbound SMTP message accepted with 250 OK

--- [STEP 13] Open Message, Verify 'Received via' Badge, Reply from Alias ---
  PASS: Message with subject "Order #zec5 Confirmation" found in Inbox and clicked
  Reading Pane alias badge: "Received via Amazon Shopping"
  PASS: Alias badge shows custom alias label or address
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\alias_reply_badge.png
  Raw SQL query BEFORE send:
reply_count 
-------------
           0
(1 row)
  Parsed reply_count before send: 0
  Reply Compose From address: "alias:amazon-zec5@masked.byos.local"
  PASS: Compose From is pre-filled with amazon-zec5@masked.byos.local
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\alias_reply_from.png
  Clicked Send button in ComposeDrawer
  Waiting for /v1/outbound/send HTTP 201 response...
  [BROWSER ERROR] Failed to load resource: the server responded with a status of 404 (Not Found)
  Outbound send response HTTP status: 201
  PASS: Outbound request returned HTTP 201 (got 201)
  Raw SQL query AFTER send:
reply_count 
-------------
           1
(1 row)
  Parsed reply_count after send: 1
  PASS: reply_count increased by exactly 1 (0 -> 1)
  Polling Mailpit for delivered message...
  PASS: Delivered message found in Mailpit with From: amazon-zec5@masked.byos.local
  Confirmed in Mailpit: Subject="Re: Order #zec5 Confirmation" From="amazon-zec5@masked.byos.local" To="shop@external-merchant.com"

================================================================================
  ALL 13 STEPS VERIFIED END-TO-END WITH ZERO GAPS!                             
================================================================================
```

4. `test_contacts.mjs`
```
node --experimental-wasm-modules tests/browser/test_contacts.mjs
================================================================================
             CONTACT MANAGEMENT POLISH (V1) BROWSER TEST                        
================================================================================

--- [STEP 1] Real login flow as Alice (alice@byos.local) ---
  Active account: "alice@byos.local"
  PASS: Alice logged in successfully via real credentials

--- [STEP 2] Open Contacts Modal ---
  Screenshot saved: tests/browser/artifacts/contacts_list.png
  PASS: Contacts modal opened and contacts_list.png screenshot saved

--- [STEP 3] Create Contact 'Test Person' ---
  Screenshot saved: tests/browser/artifacts/contacts_create.png
  PASS: Contact creation form filled and contacts_create.png saved

--- [STEP 4] Confirm Contact Appears in List & Detail ---
  PASS: Contact detail displays correct name: 'Test Person'
  PASS: Contact detail displays correct email: 'test.person@example.com'
  PASS: Contact detail displays correct notes: 'Automated test contact'

--- [STEP 5] Search Contacts for 'Test' ---
  PASS: Search query 'Test' matches created contact (found 1)
  PASS: Matching contact row email matches search query

--- [STEP 6] Edit Contact Name ---
  PASS: Edited contact name matches: 'Test Person Edited'

--- [STEP 7] Delete Contact with Confirmation Dialog ---
  PASS: Delete confirmation modal appears
  PASS: Deleted contact no longer appears in contact list

--- [STEP 8] Import CSV with 3 Rows ---
  Screenshot saved: tests/browser/artifacts/contacts_import.png
  PASS: CSV imported successfully and contacts_import.png saved

--- [STEP 9] Export CSV & Verify Response Content ---
  PASS: Contacts export returned HTTP 200 (got 200)
  PASS: Exported CSV contains one@imported.local
  PASS: Exported CSV contains two@imported.local
  PASS: Exported CSV contains three@imported.local

--- [STEP 10] Open Compose Modal & Type 'one' ---

--- [STEP 11] Confirm Autocomplete Dropdown Shows 'Imported One' ---
  Screenshot saved: tests/browser/artifacts/compose_autocomplete.png
  PASS: Autocomplete dropdown displayed and screenshot saved
  PASS: Dropdown contains contact name 'Imported One'
  PASS: Dropdown contains contact email 'one@imported.local'

--- [STEP 12] Select Autocomplete via Enter ---
  PASS: Chip 1 display name is 'Imported One' (got: Imported One)
  PASS: Chip 1 avatar initial is 'I' (got: I)

--- [STEP 13] Add Second Recipient via Autocomplete: 'Imported Two' ---
  PASS: Chip 2 display name is 'Imported Two' (got: Imported Two)

--- [STEP 14] Type Raw Email 'external@example.com' (Plain Chip) ---
  PASS: Plain chip display text is 'external@example.com'
  PASS: Plain chip for raw email has no avatar circle

--- [STEP 15] Send Message with Recipient Chips ---
  PASS: Compose drawer closed after message dispatch

--- [STEP 16] Verify Zero Console Errors ---
  PASS: Zero console errors throughout (found: 0)

================================================================================
            ALL 16 CONTACT MANAGEMENT BROWSER CHECKS PASSED                     
================================================================================
```

### Full Smoke Suite Output (12/12)
```
$env:BYOS_LOCAL_DEV = "1"
.\make.bat smoke
================================================================================
                            SMOKE TEST SUMMARY                                  
================================================================================
  [PASS] test_session_isolation.mjs          PASS (14.5s)
  [PASS] test_sidebar_restructure.mjs        PASS (10s)
  [PASS] test_unified_inbox_browser.mjs      PASS (25.8s)
  [PASS] test_account_switch_crypto.mjs      PASS (62.1s)
  [PASS] test_masked_email.mjs               PASS (44.5s)
  [PASS] test_alias_custom.mjs               PASS (37.8s)
  [PASS] test_compose_default_account.mjs    PASS (12.3s)
  [PASS] test_wire_integrity.mjs             PASS (71.9s)
  [PASS] test_focused_inbox.mjs              PASS (31.1s)
  [PASS] test_offline.mjs                    PASS (30.5s)
  [PASS] test_composer.mjs                   PASS (21.6s)
  [PASS] test_contacts.mjs                   PASS (14.5s)
================================================================================

SMOKE SUITE PASSED: All 12 tests passed cleanly.
```

## Manual Browser Verification
Manual browser checks performed via Puppeteer automation using real authentication, real backend DB persistence, and real user action flows:
1. `tests/browser/artifacts/contacts_list.png`: Contacts modal opened displaying contacts list, search bar, and action buttons.
2. `tests/browser/artifacts/contacts_create.png`: Create contact form filled with name, email, group, notes, and validated.
3. `tests/browser/artifacts/contacts_import.png`: CSV batch import of 3 contacts with real-time table refresh.
4. `tests/browser/artifacts/compose_autocomplete.png`: Compose modal recipient input typing `one`, displaying debounced dropdown containing `Imported One <one@imported.local>`, and converting to recipient chips.

## What did not work or is untested
- Nested contact groups: explicitly out of scope per feature specification.
- External contact sync (CardDAV / Google Contacts / iCloud): deferred to future milestone.
- Contact sharing / delegation between mailboxes: contacts remain private to the owning mailbox.
