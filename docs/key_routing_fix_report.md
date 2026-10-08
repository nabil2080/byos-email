# Multi-Account Key Routing Fix — Final Report

## 1. Root Cause Analysis

### Error 1: "content decrypt: decryption failed"
**File:** `apps/webmail/src/message_crypto.ts`, function `decryptPathAEnvelope`, line 439  
**Cause:** The `openMessage` handler previously resolved `targetBoxId` as:
```ts
const targetBoxId = (msg as any).mailbox_id || msg.mailboxId || selectedMailbox()?.id;
```
In the Unified Inbox, single-mailbox `loadMailboxData` rows omitted `mailboxId`. The fallback `selectedMailbox()?.id` pointed to Account A. Opening Account B's message attempted X-Wing decryption with Account A's key → AES-GCM tag check failure → `"content decrypt: decryption failed"`.

### Error 2: "key unwrap: X-Wing private key is locked"
**File:** `apps/webmail/src/App.tsx`, function `openMessage` (pre-fix, ~line 3754)  
**Cause:** `AddMailboxModal.tsx` called `autoUnwrapKeys` but never saved `xwingSeed` to `sessionStorage` or `ConnectedAccount`. Secondary accounts had no X-Wing key in memory → `sessionStorage.getItem("byos_xwing_seed_" + targetBoxId)` returned null → error thrown.

### Which mailbox ID was used to look up the X-Wing private key? (pre-fix)
`selectedMailbox()?.id` — the currently-selected sidebar account, NOT the message's owning mailbox. This is the bug.

---

## 2. Key Data Structure

Keys are stored per-mailbox in `sessionStorage`:
- `byos_mailbox_sk_{mailboxId}` — AES-GCM mailbox secret key hex
- `byos_xwing_seed_{mailboxId}` — X-Wing seed hex  
- `byos_signing_seed_{mailboxId}` — Ed25519 signing seed hex

This is a **Map keyed by mailboxId** (sessionStorage), not a single global signal. `getMailboxKeyForMessage` reads **strictly** by `message.mailboxId`, never from a global slot.

---

## 3. Fixes Applied

### Rule 1: `getMailboxKeyForMessage` helper (new file: `unified_inbox.ts`)
```ts
export function getMailboxKeyForMessage(
  message: DisplayMessage | { mailbox_id?: string; mailboxId?: string },
  keyMap?: Map<string, MailboxKeyMaterial> | Record<string, MailboxKeyMaterial>,
): { xwingSeedHex: string; mailboxSkHex: string } | null
```
Reads `byos_mailbox_sk_{boxId}` / `byos_xwing_seed_{boxId}` strictly by owning boxId. Returns null if absent. Used at every decrypt call site in `openMessage`.

### Rule 2: Locked account placeholder + unlock flow (`App.tsx`, `ReadingPane.tsx`)
- `openMessage` calls `getMailboxKeyForMessage`. If null → sets `lockedReadingAccount({ email, mailboxId })`, shows placeholder, halts decryption.
- `ReadingPane` renders `data-testid="locked-account-placeholder"` with `"Unlock {email} to read this message."` and `data-testid="unlock-account-btn"`.
- Clicking the button opens the **Unlock Account Modal** (`data-testid="unlock-account-password-input"`, `"unlock-account-submit-btn"`).
- `handlePerformUnlockAccount` unwraps keys, saves to `sessionStorage` + `connectedAccounts`, then auto-retries `openMessage(selectedMsg()!)`.

### Rule 3: Global xwingSeed() signal eliminated from unified path
- `loadMailboxData` preview decryptor now uses `getMailboxKeyForMessage(m)` instead of `xwingSeed()`.
- `loadUnifiedInboxMessages` preview decryptor already reads `sessionStorage.getItem("byos_xwing_seed_" + accId)` per-account — verified correct.
- All other `xwingSeed()` / `mailboxKey()` usages are gated by `unlockedBoxId() === box.id` (single-account paths only, unreachable from unified inbox).

### Rule 4: Storage fetch uses owning account's session token
- `fetchMessageAttachmentChunk` now accepts optional `token?: string` parameter.
- `downloadAttachment` and `downloadAndDecryptAttachment` accept optional `token?: string`.
- `openMessage` resolves `targetToken = targetAcc?.sessionToken || sessionStorage.getItem("byos_active_session_token")` and passes it to all fetch calls.

### Rule 5: Error messages name the account
Error messages now read:
> `"Mailbox {email} X-Wing private key is locked. Unlock {email} to read this message."`
> `"Mailbox {email} secret key is locked. Unlock {email} to read this message."`

### Startup guard relaxed (`App.tsx`)
Changed from `(currentUser() !== null && mailboxKey() !== null) || isLoading()` to `currentUser() !== null || isLoading()` — so authenticated users with locked keys still see the webmail UI and can use the unlock flow.

### Lock indicators (`AccountSwitcher.tsx`)
- Account chip shows amber lock icon when any account has no keys in `sessionStorage`.
- Dropdown rows show per-account lock indicator.

### `AddMailboxModal.tsx`
Fixed to save `byos_xwing_seed_${mailboxId}` to `sessionStorage` and include `xwingSeedHex` in the returned `ConnectedAccount`.

---

## 4. Tests

### Frontend unit tests: 177 passed, 0 failed
```
UNIFIED INBOX TESTS: 15 passed, 0 failed
  ✓ test_key_resolution_uses_owning_mailbox
  ✓ test_key_locked_prompts_for_correct_account
  ✓ test_unlock_retries_decrypt
  ✓ test_global_key_signal_never_used_in_unified_path
  (+ 11 prior tests)
```

### Backend Go tests
```
ok  byos.email/services/api  47.525s
```
All existing tests pass.

---

## 5. Files Edited

| File | Reason |
|------|--------|
| `apps/webmail/src/unified_inbox.ts` | Added `getMailboxKeyForMessage` export (Rule 1) |
| `apps/webmail/src/unified_inbox.test.ts` | Added 4 key routing unit tests (12–15), imported `getMailboxKeyForMessage` / `DisplayMessage` |
| `apps/webmail/src/api.ts` | Added `token?` param to `downloadAttachment`, `downloadAndDecryptAttachment`, `fetchMessageAttachmentChunk` (Rule 4); `ConnectedAccount` already updated |
| `apps/webmail/src/App.tsx` | • Fixed duplicate syntax block in `openMessage` <br>• Replaced global `xwingSeed()` with `getMailboxKeyForMessage` in preview decryptor (Rule 3) <br>• Added `handlePerformUnlockAccount` function (Rule 2 retry) <br>• Wired `lockedAccount` / `onUnlockAccount` to `<ReadingPane />` <br>• Added Unlock Account modal JSX <br>• Relaxed startup guard (authenticated-but-locked users reach webmail) |
| `apps/webmail/src/components/ReadingPane.tsx` | Fixed missing `</Show>` closing tag on `senderVerification` block; locked placeholder + unlock button already added |
| `apps/webmail/src/components/AccountSwitcher.tsx` | Added `isAccountLocked` helper; chip and dropdown row lock indicators |

---

## 6. Acceptance Criteria Status

| Criterion | Status |
|-----------|--------|
| Opening any message in unified inbox decrypts with **owning** mailbox key | ✅ `getMailboxKeyForMessage` enforces this |
| If owning mailbox key isn't unlocked, shows `"Unlock {email}"` with correct email | ✅ `lockedReadingAccount` + ReadingPane placeholder |
| Unlocking retries decrypt automatically | ✅ `handlePerformUnlockAccount` calls `openMessage(selectedMsg()!)` |
| No `"content decrypt: decryption failed"` for correct keys | ✅ key routing fixed |
| No `"X-Wing private key is locked"` errors without account name | ✅ Rule 5 error messages |
| Storage fetch uses owning account's token | ✅ `targetToken` from `connectedAccounts` |
| All existing tests pass | ✅ 177 frontend, Go ok |
