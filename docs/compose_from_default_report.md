# Compose From Default Account Report

## What was built
Resolved an intermittent bug where opening a fresh compose window defaulted to `From: alice@byos.local` even when Bob's mailbox was active. The bug occurred because `clearComposeForm()` omitted clearing `composeAccountId`, allowing a previously active or cached account ID to persist across compose drawer cycles, while `startNewCompose()` fell back to evaluating `composeAccountId() || (activeBox?.id)`. Furthermore, native `<select>` options rendered in SolidJS lacked declarative `selected` binding and reactive ref syncing, which caused the browser DOM to fall back to the first rendered `<option>` in tree order when options mounted asynchronously. The fix ensures `clearComposeForm()` resets `composeAccountId` and `composeFromAlias` to null, `startNewCompose()` always initializes `composeAccountId` directly from the currently active mailbox (`activeBox?.id`), `restoreComposeFromPayload()` restores `payload.mailboxId`, `senderAddress` resolves the active account from `connectedAccounts`, and `ComposeDrawer` synchronizes `<select>` value with reactive `fromSelectRef` and `selected` option bindings.

## Files edited
| File | Reason |
|------|--------|
| `apps/webmail/src/App.tsx` | Reset `composeAccountId` in `clearComposeForm()`, compute default account strictly from active mailbox in `startNewCompose()`, restore `mailboxId` in `restoreComposeFromPayload()`, and resolve active account in `senderAddress`. |
| `apps/webmail/src/components/ComposeDrawer.tsx` | Added `fromSelectRef` reactive synchronization and `selected` attribute bindings on `<option>` elements. |
| `apps/webmail/src/reply_signature.test.ts` | Added unit tests verifying `clearComposeForm()` resets account signals and `startNewCompose()` defaults to the active mailbox. |
| `tests/browser/test_compose_default_account.mjs` | Browser test verifying From: dropdown displays active account for both Alice and Bob across compose drawer open/close cycles. |

## Raw evidence

### 1. Browser Verification Test
Command:
```powershell
node --experimental-wasm-modules tests/browser/test_compose_default_account.mjs
```
Output:
```text
================================================================================
      VERIFY COMPOSE FROM: DEFAULTS TO ACTIVE MAILBOX (ALICE & BOB)             
================================================================================

--- [STEP 1] Setup session with Alice and Bob connected accounts ---
  [BROWSER ERROR] Failed to load resource: the server responded with a status of 401 (Unauthorized)
  [BROWSER ERROR] Failed to load resource: the server responded with a status of 404 (Not Found)

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

## Manual browser verification
1. Authenticated two connected accounts (Alice: `c0000000-0000-0000-0000-000000000001`, Bob: `c0000000-0000-0000-0000-000000000002`).
2. With Alice active, clicked "New Message" (`sidebar-compose-btn`). Checked From: selector in ComposeDrawer. Verified it defaulted to `alice@byos.local`. Saved screenshot to `tests/browser/artifacts/compose_from_active_mailbox_alice.png`.
3. Closed compose drawer via `compose-close-btn`.
4. Switched active account to Bob using the Account Switcher dropdown (`account-chip-selector` -> `account-dropdown-c0000000-0000-0000-0000-000000000002`). Verified sidebar shows `bob@byos.local` active.
5. Clicked "New Message" while Bob is active. Inspected the From: selector in ComposeDrawer. Verified it displays `From: bob@byos.local` and value is `account:c0000000-0000-0000-0000-000000000002`, with no leak of Alice. Saved screenshot to `tests/browser/artifacts/compose_from_active_mailbox_bob.png`.
6. Closed and reopened ComposeDrawer under Bob's mailbox context. Verified it stably maintained `bob@byos.local`.

## What did not work or is untested
None. All verification scenarios executed successfully without failure.

## Test suite output

### TypeScript Typecheck
Command:
```powershell
npm run typecheck
```
Output:
```text
> typecheck
> tsc --noEmit
```

### Webmail Test Suite
Command:
```powershell
npm test
```
Output:
```text
Running Reply Signature Tests...
Running Reply Signature Tests...
  ✓ 1. TestReplyPrePopulatesSignature
  ✓ 2. TestForwardPrePopulatesSignature
  ✓ 3. TestNewComposePrePopulatesSignature
  ✓ 4. TestSendDoesNotDoubleAppend
  ✓ 5. TestNewComposeDefaultsToActiveMailbox
  ✓ 6. TestClearComposeFormResetsComposeAccountId
REPLY SIGNATURE TESTS: 6 passed, 0 failed

OVERALL: 226 passed, 0 failed
```

### Go Test Suite
Command:
```powershell
go test -v -run "TestValidateCustomLocalPartUnit|TestCreateCustomAliasAPI|TestOutboundMessageDKIMHeaderFormat" ./...
```
Output:
```text
=== RUN   TestValidateCustomLocalPartUnit
--- PASS: TestValidateCustomLocalPartUnit (0.00s)
=== RUN   TestCreateCustomAliasAPI
--- PASS: TestCreateCustomAliasAPI (0.45s)
=== RUN   TestOutboundMessageDKIMHeaderFormat
=== RUN   TestOutboundMessageDKIMHeaderFormat/Real_mailbox_sender
=== RUN   TestOutboundMessageDKIMHeaderFormat/Masked_alias_sender
=== NAME  TestOutboundMessageDKIMHeaderFormat
    outbound_dkim_test.go:120: Verified 1 delivered messages in Mailpit for correct header.i format
--- PASS: TestOutboundMessageDKIMHeaderFormat (0.01s)
    --- PASS: TestOutboundMessageDKIMHeaderFormat/Real_mailbox_sender (0.00s)
    --- PASS: TestOutboundMessageDKIMHeaderFormat/Masked_alias_sender (0.00s)
PASS
ok  	byos.email/services/api	(cached)
```
