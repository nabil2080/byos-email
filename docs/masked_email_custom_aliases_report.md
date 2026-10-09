# Masked Email: Sidebar Entry Removal & Custom Alias Local Parts Report

## What was built
Masked Email V1 was enhanced to align with standard webmail patterns (Fastmail, Proton, iCloud). The quick link button "Masked Aliases" was removed from `Sidebar.tsx` and `App.tsx` so aliases are accessed exclusively via Settings → Masked Email and selected from the Compose drawer `From:` dropdown. The Create Alias modal was updated with a mode toggle `[ Random ] [ Custom ]`. In Random mode, the existing 12-character random generator is retained; in Custom mode, users can specify a custom local part with fixed `@masked.byos.local` suffix, real-time live preview, and live client-side validation against reserved words, character restrictions (a-z, 0-9, ., -, _), boundary punctuation, consecutive punctuation, and length (3-32 characters). The backend API `POST /v1/users/me/aliases` was updated to accept optional `local_part`, enforce all validation rules, check system-wide case-insensitive uniqueness, return JSON error responses (`409 alias_taken` and `400 invalid_local_part`), and enforce the 20/day per-user rate limit across both modes.

## Files edited
| File | Reason |
|------|--------|
| `apps/webmail/src/components/Sidebar.tsx` | Removed "Masked Aliases" navigation button and `onOpenMaskedEmail` prop; added automation testids. |
| `apps/webmail/src/App.tsx` | Removed `onOpenMaskedEmail` prop callbacks and provided active aliases to ComposeDrawer. |
| `apps/webmail/src/routes/settings/SettingsLayout.tsx` | Added `data-testid` to settings tab buttons for automated browser navigation. |
| `apps/webmail/src/routes/settings/MaskedEmailTab.tsx` | Added mode selector toggle, custom local part input, live preview, validation error banner, and modal error display. |
| `apps/webmail/src/api.ts` | Updated `createMaskedAlias` to accept optional `local_part`, handled 409 and 400 JSON errors, and exported `createAlias`. |
| `apps/webmail/src/masked_email.test.ts` | Added unit tests for custom alias validation rules, live preview formatting, 409 friendly error handling, and random mode payload. |
| `services/api/aliases.go` | Added `validateCustomLocalPart` function, reserved name blacklist, uniqueness validation, and JSON responses for 400 and 409. |
| `services/api/aliases_test.go` | Implemented 10 Go unit and integration tests covering custom alias creation, duplicate rejection, reserved names, punctuation rules, length constraints, lowercasing, and rate limits. |
| `tests/browser/test_alias_custom.mjs` | Automated end-to-end browser verification script testing the complete 13-step flow: sidebar removal, random alias, custom alias validation, duplicate alias conflict, creation, inbound SMTP, reading pane badge, reply from custom alias, Mailpit delivery, and reply_count increment. |

---

## Raw Code Diffs & Implementation

### 1. Diff for Sidebar Removal
Command: `git diff apps/webmail/src/components/Sidebar.tsx`
```diff
diff --git a/apps/webmail/src/components/Sidebar.tsx b/apps/webmail/src/components/Sidebar.tsx
index 574acb4..1c508ac 100644
--- a/apps/webmail/src/components/Sidebar.tsx
+++ b/apps/webmail/src/components/Sidebar.tsx
@@ -20,7 +20,6 @@ interface SidebarProps {
   onCompose: () => void;
   onOpenContacts: () => void;
   onOpenSettings: () => void;
-  onOpenMaskedEmail?: () => void;
   onOpenImport?: () => void;
   onLogout: (accountId?: string, logOutAll?: boolean) => void;
   isUnlocked?: boolean;
@@ -282,6 +281,7 @@ export const Sidebar: Component<SidebarProps> = (props) => {
         {/* Compose Pill & Quick Actions */}
         <div class="space-y-1.5">
           <button
+            data-testid="sidebar-compose-btn"
             onClick={() => {
               props.onCompose();
               props.onCloseMobile?.();
@@ -333,6 +333,7 @@ export const Sidebar: Component<SidebarProps> = (props) => {
                 props.onOpenSettings();
                 props.onCloseMobile?.();
               }}
+              data-testid="sidebar-settings-btn"
               class="flex items-center justify-center gap-1 py-2 px-1.5 min-h-[36px] rounded-lg text-xs font-medium text-[#5E6063] dark:text-[#A3A3A3] hover:text-[#2B2C2D] dark:hover:text-[#ECEBE8] hover:bg-[#E8E5DF]/60 dark:hover:bg-[#2A2A2E] transition-colors cursor-pointer"
               title="Settings"
             >
@@ -528,28 +529,6 @@ export const Sidebar: Component<SidebarProps> = (props) => {
               </button>
             );
           })}
-
-          {/* Masked Aliases quick link */}
-          <button
-            type="button"
-            onClick={() => {
-              props.onOpenMaskedEmail?.();
-              props.onCloseMobile?.();
-            }}
-            class="w-full flex items-center justify-between px-3 py-1.5 rounded-lg text-xs font-medium text-[#3C3D3E] dark:text-[#A1A1AA] hover:text-[#1F2022] dark:hover:text-[#F3F4F6] hover:bg-[#E8E5DF]/70 dark:hover:bg-[#26282E] transition group cursor-pointer"
-            data-testid="sidebar-masked-aliases-btn"
-          >
-            <div class="flex items-center gap-2.5">
-              <svg class="w-4 h-4 stroke-current fill-none stroke-[1.5] text-[#9E725F]" viewBox="0 0 24 24">
-                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
-                <path d="M9 12l2 2 4-4" />
-              </svg>
-              <span>Masked Aliases</span>
-            </div>
-            <span class="text-[10px] uppercase font-mono px-1.5 py-0.2 rounded bg-[#F2E8E2] dark:bg-[#2D2522] text-[#9E725F] dark:text-[#D4A38F] font-semibold">
-              Aliases
-            </span>
-          </button>
         </nav>
 
         {/* Custom Folders Section */}
```

### 2. Validation Rules & Reserved Names Code (Backend)
Command: `git grep -n -A 40 "func validateCustomLocalPart" services/api/aliases.go`
```go
services/api/aliases.go:64:func validateCustomLocalPart(lp string) (string, error) {
services/api/aliases.go-65-	lp = strings.ToLower(strings.TrimSpace(lp))
services/api/aliases.go-66-	if len(lp) < 3 {
services/api/aliases.go-67-		return "", errors.New("Must be at least 3 characters")
services/api/aliases.go-68-	}
services/api/aliases.go-69-	if len(lp) > 32 {
services/api/aliases.go-70-		return "", errors.New("Must be at most 32 characters")
services/api/aliases.go-71-	}
services/api/aliases.go-72-	for i := 0; i < len(lp); i++ {
services/api/aliases.go-73-		c := lp[i]
services/api/aliases.go-74-		isLower := c >= 'a' && c <= 'z'
services/api/aliases.go-75-		isDigit := c >= '0' && c <= '9'
services/api/aliases.go-76-		isSpecial := c == '.' || c == '-' || c == '_'
services/api/aliases.go-77-		if !isLower && !isDigit && !isSpecial {
services/api/aliases.go-78-			return "", errors.New("Only lowercase letters, numbers, and . - _ are allowed")
services/api/aliases.go-79-		}
services/api/aliases.go-80-	}
services/api/aliases.go-81-	first := lp[0]
services/api/aliases.go-82-	last := lp[len(lp)-1]
services/api/aliases.go-83-	if first == '.' || first == '-' || first == '_' || last == '.' || last == '-' || last == '_' {
services/api/aliases.go-84-		return "", errors.New("Must not start or end with ., -, or _")
services/api/aliases.go-85-	}
services/api/aliases.go-86-	for i := 0; i < len(lp)-1; i++ {
services/api/aliases.go-87-		c1 := lp[i]
services/api/aliases.go-88-		c2 := lp[i+1]
services/api/aliases.go-89-		isSpec1 := c1 == '.' || c1 == '-' || c1 == '_'
services/api/aliases.go-90-		isSpec2 := c2 == '.' || c2 == '-' || c2 == '_'
services/api/aliases.go-91-		if isSpec1 && isSpec2 {
services/api/aliases.go-92-			return "", errors.New("Must not contain two consecutive ., -, or _ characters")
services/api/aliases.go-93-		}
services/api/aliases.go-94-	}
services/api/aliases.go-95-	if reservedAliasLocalParts[lp] {
services/api/aliases.go-96-		return "", errors.New("This alias name is reserved")
services/api/aliases.go-97-	}
services/api/aliases.go-98-	return lp, nil
services/api/aliases.go-99-}
```

Reserved Names map (`services/api/aliases.go:40`):
```go
var reservedAliasLocalParts = map[string]bool{
	"admin":         true,
	"administrator": true,
	"postmaster":    true,
	"abuse":         true,
	"support":       true,
	"help":          true,
	"info":          true,
	"noreply":       true,
	"no-reply":      true,
	"mailer-daemon": true,
	"root":          true,
	"webmaster":     true,
	"security":      true,
	"billing":       true,
	"sales":         true,
	"marketing":     true,
	"system":        true,
	"test":          true,
	"demo":          true,
	"api":           true,
	"www":           true,
}
```

### 3. Diff for Custom Alias API (`apps/webmail/src/api.ts`)
```diff
diff --git a/apps/webmail/src/api.ts b/apps/webmail/src/api.ts
index a868b65..6c56b78 100644
--- a/apps/webmail/src/api.ts
+++ b/apps/webmail/src/api.ts
@@ -1600,10 +1600,69 @@ export async function fetchMaskedAliases(token?: string): Promise<MaskedAliasesR
   return apiRequest<MaskedAliasesResponse>("/v1/users/me/aliases", undefined, token);
 }
 
-export async function createMaskedAlias(label?: string, token?: string): Promise<MaskedAliasItem> {
+export interface CreateMaskedAliasOptions {
+  label?: string;
+  local_part?: string;
+}
+
+export async function createMaskedAlias(
+  arg1?: string | CreateMaskedAliasOptions,
+  arg2?: string,
+  arg3?: string
+): Promise<MaskedAliasItem> {
+  let label = "";
+  let localPart: string | undefined;
+  let token: string | undefined;
+
+  if (typeof arg1 === "object" && arg1 !== null) {
+    label = arg1.label || "";
+    localPart = arg1.local_part;
+    token = arg2;
+  } else {
+    label = arg1 || "";
+    if (arg3 !== undefined) {
+      localPart = arg2;
+      token = arg3;
+    } else {
+      token = arg2;
+    }
+  }
+
+  const payload: { label: string; local_part?: string } = { label };
+  if (localPart && localPart.trim()) {
+    payload.local_part = localPart.trim();
+  }
+
+  try {
+    return await apiRequest<MaskedAliasItem>("/v1/users/me/aliases", {
+      method: "POST",
+      body: JSON.stringify(payload),
+    }, token);
+  } catch (err: any) {
+    if (err?.status === 409) {
+      let parsed: any;
+      try {
+        parsed = JSON.parse(err.message);
+      } catch {}
+      if (parsed?.error === "alias_taken" || err.message?.includes("alias_taken") || err.message?.includes("alias already exists")) {
+        const error = new Error("That alias is already taken. Try a different name.") as Error & { status: number };
+        error.status = 409;
+        throw error;
+      }
+    } else if (err?.status === 400) {
+      let parsed: any;
+      try {
+        parsed = JSON.parse(err.message);
+      } catch {}
+      if (parsed?.error === "invalid_local_part" && parsed?.message) {
+        const error = new Error(parsed.message) as Error & { status: number };
+        error.status = 400;
+        throw error;
+      }
+    }
+    throw err;
+  }
 }
+
+export const createAlias = createMaskedAlias;
```

---

## 13-Step Manual Browser Verification

Executed via Puppeteer in `tests/browser/test_alias_custom.mjs`:

```
================================================================================
             13-STEP CUSTOM ALIAS & SIDEBAR REMOVAL VERIFICATION              
================================================================================

--- [STEP 1] Login as alice@byos.local & Verify Sidebar has no 'Masked Aliases' ---
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

--- [STEP 9 & 10] Create Valid Custom Alias 'amazon-7o6g@masked.byos.local' ---
  PASS: Uppercase entered was silently lowercased
  PASS: Live preview matches expected: "amazon-7o6g@masked.byos.local"
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\alias_create_custom.png
  PASS: Custom alias appears in aliases table
  Custom alias amazon-7o6g@masked.byos.local created and listed.

--- [STEP 8] Test Duplicate Alias Path (Conflict 409) ---
  Modal error on duplicate alias: "That alias is already taken. Try a different name."
  PASS: Friendly duplicate error 'That alias is already taken. Try a different name.' rendered
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\alias_duplicate_error.png

--- [STEP 11] Verify Compose From: dropdown lists Custom Alias ---
  Compose From: options found: [
  'alice@byos.local',
  'amazon-7o6g@masked.byos.local (alias)',
  'c0ptvz5s6y9f@masked.byos.local (alias)',
  'amazon-67u4@masked.byos.local (alias)',
  'n4iowuonp7u3@masked.byos.local (alias)',
  'amazon-6941@masked.byos.local (alias)',
  'zcakxb2ljslb@masked.byos.local (alias)',
  'amazon-4684@masked.byos.local (alias)',
  'nh8fdwnozr4u@masked.byos.local (alias)',
  'amazon-1005@masked.byos.local (alias)',
  '1zbg8tet3vim@masked.byos.local (alias)'
]
  PASS: Compose From: dropdown has more than 1 option
  PASS: Dropdown includes the custom alias amazon-7o6g
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\alias_from_dropdown.png

--- [STEP 12] Inbound SMTP Delivery to 'amazon-7o6g@masked.byos.local' ---
  Inbound SMTP response: code=250 response="250 2.0.0 OK: queued"
  PASS: Inbound SMTP message accepted with 250 OK

--- [STEP 13] Open Message, Verify 'Received via' Badge, Reply from Alias ---
  PASS: Message with subject "Order #7o6g Confirmation" found in Inbox and clicked
  Reading Pane alias badge: "Received via Amazon Shopping"
  PASS: Alias badge shows custom alias label or address
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\alias_reply_badge.png
  Raw SQL query BEFORE send:
reply_count 
-------------
           0
(1 row)
  Parsed reply_count before send: 0
  Reply Compose From address: "alias:amazon-7o6g@masked.byos.local"
  PASS: Compose From is pre-filled with amazon-7o6g@masked.byos.local
  Saved screenshot: F:\Codex\byos-email\tests\browser\artifacts\alias_reply_from.png
  Clicked Send button in ComposeDrawer
  Waiting for /v1/outbound/send HTTP 201 response...
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
  PASS: Delivered message found in Mailpit with From: amazon-7o6g@masked.byos.local
  Confirmed in Mailpit: Subject="Re: Order #7o6g Confirmation" From="amazon-7o6g@masked.byos.local" To="shop@external-merchant.com"

================================================================================
  ALL 13 STEPS VERIFIED END-TO-END WITH ZERO GAPS!                             
================================================================================
```

Screenshots saved:
- `tests/browser/artifacts/alias_sidebar_removed.png`
- `tests/browser/artifacts/alias_create_random.png`
- `tests/browser/artifacts/alias_validation_error.png`
- `tests/browser/artifacts/alias_duplicate_error.png`
- `tests/browser/artifacts/alias_create_custom.png`
- `tests/browser/artifacts/alias_from_dropdown.png`
- `tests/browser/artifacts/alias_reply_badge.png`
- `tests/browser/artifacts/alias_reply_from.png`

---

## What did not work or is untested
None. All 13 steps and all verification requirements have been executed and verified.

---

## Test Suite Output

### Complete Go Test Suite in services/api
Command: `go test -v -count=1 -run "TestCreateAliasCustom|TestValidateCustom" ./...`
```
=== RUN   TestValidateCustomLocalPartUnit
--- PASS: TestValidateCustomLocalPartUnit (0.00s)
=== RUN   TestCreateAliasCustomLocalPart
--- PASS: TestCreateAliasCustomLocalPart (0.29s)
=== RUN   TestCreateAliasCustomRejectsDuplicate
--- PASS: TestCreateAliasCustomRejectsDuplicate (0.37s)
=== RUN   TestCreateAliasCustomRejectsReserved
--- PASS: TestCreateAliasCustomRejectsReserved (0.58s)
=== RUN   TestCreateAliasCustomRejectsInvalidChars
--- PASS: TestCreateAliasCustomRejectsInvalidChars (0.45s)
=== RUN   TestCreateAliasCustomRejectsLeadingTrailingPunct
--- PASS: TestCreateAliasCustomRejectsLeadingTrailingPunct (0.55s)
=== RUN   TestCreateAliasCustomRejectsConsecutivePunct
--- PASS: TestCreateAliasCustomRejectsConsecutivePunct (0.65s)
=== RUN   TestCreateAliasCustomRejectsTooShort
--- PASS: TestCreateAliasCustomRejectsTooShort (0.30s)
=== RUN   TestCreateAliasCustomRejectsTooLong
--- PASS: TestCreateAliasCustomRejectsTooLong (0.38s)
=== RUN   TestCreateAliasCustomLowercases
--- PASS: TestCreateAliasCustomLowercases (0.29s)
=== RUN   TestCreateAliasCustomRespectsRateLimit
--- PASS: TestCreateAliasCustomRespectsRateLimit (1.94s)
PASS
ok  	byos.email/services/api	7.642s
```

Command: `go test -count=1 ./...`
```
ok  	byos.email/services/api	55.073s
```

### Complete NPM Test Suite in apps/webmail
Command: `npm test`
```
Running Attachment Crypto Tests...
  ✓ 1. Small chunked encryption & decryption round-trip
  ✓ 2. Multi-chunk (3 chunks) encryption & decryption round-trip
  ✓ 3. Non-mutating base64 encoding (BUG-002 check)
  ✓ 4. Tampered ciphertext fails authentication check
ATTACHMENT CRYPTO TESTS: 4 passed, 0 failed

Running TOTP Tests...
  ✓ base32Decode parses valid secret
  ✓ base32Decode handles padding
  ✓ base32Decode throws on invalid characters
  ✓ generateTOTP produces 6-digit code
  ✓ generateTOTP matches RFC 6238 test vectors (SHA1, T0=0, step=30)
  ✓ verifyTOTP accepts current code
  ✓ verifyTOTP accepts code in ±1 window
  ✓ verifyTOTP rejects code outside window
  ✓ verifyTOTP rejects invalid string
  ✓ generateTOTP returns 6 digits with leading zeros
TOTP TESTS: 10 passed, 0 failed

Running Date Time Tests...
  ✓ formatTime returns time string
  ✓ formatSmartDate returns time for today
  ✓ formatSmartDate returns 'Yesterday' for yesterday
  ✓ formatSmartDate returns date for older dates
  ✓ formatFullDate returns formatted date string
DATE TIME TESTS: 5 passed, 0 failed

Running File Type Tests...
  ✓ File type detection
FILE TYPE TESTS: 1 passed, 0 failed

MULTI ACCOUNT TESTS: 13 passed, 0 failed

Running Password Rewrap Tests...
  ✓ 1. deriveSymmetricKey: deterministic derivation from password + salt
  ✓ 2. deriveSymmetricKey: different salt produces different key
  ✓ 3. deriveSymmetricKey: different password produces different key
  ✓ 4. rewrapMailboxSk: decrypt with old, encrypt with new -> round-trip
  ✓ 5. rewrapMailboxSk: corrupted old wrapped key throws error
  ✓ 6. rewrapMailboxSk: wrong old password throws error
  ✓ 7. rewrapMailboxSk: empty passwords rejected
PASSWORD REWRAP TESTS: 7 passed, 0 failed

Running Path A Compose Tests...
  ✓ 1. Valid attachment produces well-formed Path A manifest with all required fields
  ✓ 2. Manifest sha256_hash matches raw file content
  ✓ 3. Manifest ciphertext_hash matches raw ciphertext SHA-256
  ✓ 4. Encrypted size matches plaintext size + AES-GCM tag overhead (16 bytes)
  ✓ 5. Attachment key is unique per file (two encryptions of same file produce different keys)
  ✓ 6. Empty file (0 bytes) is rejected with descriptive error
  ✓ 7. Oversized file (>25 MB) is rejected with descriptive error
  ✓ 8. Path A manifest JSON matches required spec schema exactly
  ✓ 9. Multiple attachments produce independent manifests with unique keys
PATH A COMPOSE TESTS: 9 passed, 0 failed

Running Path A Read Tests...
  ✓ 1. Valid Path A manifest decrypts back to original plaintext
  ✓ 2. Tampered ciphertext is rejected (AES-GCM integrity check fails)
  ✓ 3. Wrong decryption key is rejected
  ✓ 4. Manifest with mismatched sha256_hash is rejected
  ✓ 5. Manifest with mismatched ciphertext_hash is rejected
  ✓ 6. Manifest missing required fields is rejected
  ✓ 7. Content-Type and filename are correctly restored from manifest
  ✓ 8. Multi-attachment message: all attachments decrypt independently
  ✓ 9. Corrupted base64 payload is rejected gracefully
PATH A READ TESTS: 9 passed, 0 failed

Running MIME Parser Tests...
  ✓ 1. Plain text message parses correctly
  ✓ 2. HTML-only message parses correctly
  ✓ 3. Multipart/alternative (plain + HTML) extracts both parts
  ✓ 4. Multipart/mixed with inline image parses correctly
  ✓ 5. Tracked pixel detection identifies 1x1 GIF with token
  ✓ 6. Tracked pixel detection ignores normal images
  ✓ 7. Real message with tracked pixel in HTML part — parsed correctly
MIME PARSER TESTS: 7 passed, 0 failed

Running Signature Tests...
  ✓ 1. loadSignature returns stored plaintext
  ✓ 2. loadSignatureHtml returns stored HTML
  ✓ 3. loadSignatureHtml falls back to plaintext conversion when HTML is absent
  ✓ 4. saveSignature with empty string removes the key
  ✓ 5. saveSignatureHtml with empty string removes the key
  ✓ 6. clearSignature removes both keys
  ✓ 7. applySignature appends signature to plaintext
  ✓ 8. applySignatureHtml appends byos-signature div to HTML
  ✓ 9. Server hydration writes both keys to localStorage
  ✓ 10. Server hydration with empty signature_html removes the key
  ✓ 11. Server hydration with only signature_plain leaves signature_html absent
SIGNATURE TESTS: 11 passed, 0 failed

Running Reply Signature Tests...
  ✓ 1. TestReplyPrePopulatesSignature
  ✓ 2. TestForwardPrePopulatesSignature
  ✓ 3. TestNewComposePrePopulatesSignature
  ✓ 4. TestSendDoesNotDoubleAppend
  ✓ 5. TestNewComposeDefaultsToActiveMailbox
  ✓ 6. TestClearComposeFormResetsComposeAccountId
REPLY SIGNATURE TESTS: 6 passed, 0 failed

Running Mbox Stream Tests...
  ✓ 1. Parse a 3-message mbox -> yields 3 messages in order
  ✓ 2. Message boundary detection works with CRLF
  ✓ 3. Message boundary detection works with LF only
  ✓ 4. mboxrd unescaping works (>From -> From)
  ✓ 5. A very large message (simulate 2MB) yields correctly
  ✓ 6. AbortSignal stops iteration cleanly
MBOX STREAM TESTS: 6 passed, 0 failed

Running Mbox Labels Tests...
  ✓ 1. X-Gmail-Labels with "Sent" -> "sent"
  ✓ 2. X-Gmail-Labels with "Spam" -> "spam"
  ✓ 3. X-Gmail-Labels with "Inbox,Important" -> "inbox"
  ✓ 4. X-Gmail-Labels with "Archive" only -> "archive"
  ✓ 5. No X-Gmail-Labels + From matches user email -> "sent"
  ✓ 6. No X-Gmail-Labels + From != user email -> null
  ✓ 7. Priority: message with both "Inbox" and "Spam" -> "spam" (spam wins)
  ✓ 8. Priority: message with both "Trash" and "Sent" -> "trash"
MBOX LABELS TESTS: 8 passed, 0 failed

Running Import Queue Tests...
  ✓ 1. Concurrency limit is respected
  ✓ 2. Continues when item worker throws
  ✓ 3. onProgress tracks completed and total accurately
IMPORT QUEUE TESTS: 3 passed, 0 failed

Running Conversation Threading Tests...
  ✓ 1. TestThreadRowRendersParticipantLabel
  ✓ 2. TestThreadRowShowsUnreadBold
  ✓ 3. TestFetchThreadsFunctionCallsCorrectURL
  ✓ 4. TestToggleMessageStarCallsCorrectURL
  ✓ 5. TestThreadSnoozeFiltering
  ✓ 6. TestThreadMultiSelectHelpers
CONVERSATION THREADING TESTS: 6 passed, 0 failed

Running Undo Send Tests...
  ✓ 1. TestPrepareSendPayloadEmptyRecipient
  ✓ 2. TestPrepareSendPayloadAppliesSignature
  ✓ 3. TestRestoreComposeFromPayload
  ✓ 4. TestUndoRemovesPendingSend
UNDO SEND TESTS: 4 passed, 0 failed

Running Keyboard Shortcuts Tests...
  ✓ 1. isTextInputElement returns true for input, textarea, contenteditable
  ✓ 2. isTextInputElement returns false for div, button, body
  ✓ 3. matchShortcut matches plain keys correctly
  ✓ 4. matchShortcut respects shift, ctrl, meta modifiers
  ✓ 5. matchShortcut rejects when shift state mismatches
KEYBOARD SHORTCUTS TESTS: 5 passed, 0 failed

Running Snooze Tests...
  ✓ 1. TestSnoozePresetsComputeCorrectTimes
  ✓ 2. TestFormatSnoozeTime
SNOOZE TESTS: 2 passed, 0 failed

Running Scheduled Folder Tests...
  ✓ 1. Folder type union includes 'scheduled'
  ✓ 2. Sidebar folder list order places 'scheduled' between 'sent' and 'drafts'
  ✓ 3. MessageRow formatSmartDate formats scheduled dates correctly
  ✓ 4. DisplayMessage folder supports 'scheduled'
  ✓ 5. Scheduled message error placeholders conform to specification
  ✓ 6. Folder threading support accurately distinguishes flat-by-design folders
  ✓ 7. Edit then discard leaves scheduled item untouched
  ✓ 8. Edit then save with body change updates same row in place
  ✓ 9. Edit then save with time change updates send_at on same row
  ✓ 10. Edit then save with no changes preserves all attributes without orphan drafts
  ✓ 11. Failed schedule surfaces specific backend error step, not generic wrapper
  ✓ 12. Schedule send with locked mailbox key surfaces actionable unlock message
  ✓ 13. Real-time event message.deleted removes scheduled item from list live
  ✓ 14. Real-time event message.created adds delivered sent copy to Sent folder live
  ✓ 15. Delivery failure event moves message to Drafts with sendFailed marker live
SCHEDULED FOLDER TESTS: 15 passed, 0 failed

Running Display Party Tests...
  ✓ 1. formatAddress extracts clean display name or email
  ✓ 2. Inbox row renders sender, not recipient
  ✓ 3. Archive, spam, trash, and search rows render sender
  ✓ 4. Sent row renders recipient, not sender
  ✓ 5. Sent row with multiple recipients renders first +N
  ✓ 6. Drafts row with no recipient renders 'No recipient'
  ✓ 7. Scheduled folder renders recipient(s) and first +N
  ✓ 8. Threaded Sent row renders the recipient of the latest message
  ✓ 9. Sent folder rows are never treated as unread
DISPLAY PARTY TESTS: 9 passed, 0 failed

Running Nested Labels Tests...
  PASS: test_sidebar_renders_tree
  PASS: test_parent_click_filters_descendants
  PASS: test_expand_state_persists
  PASS: test_reparent_cycle_blocked_ui
NESTED LABELS TESTS: 4 passed, 0 failed

Running API Error Handling Tests...
  ✓ test_api_error_propagates_not_swallowed: fetchMailboxes throws on 500
  ✓ test_api_error_propagates_not_swallowed: fetchDrafts, fetchFolders, fetchLabels, fetchContacts throw on 500
  ✓ test_successful_return_shape: api client returns data on 200
  ✓ test_global_error_banner_renders: set and clear global error signal
API ERROR HANDLING TESTS: 4 passed, 0 failed

Running Unified Inbox Tests...
  ✓ test_unified_inbox_merges_accounts
  ✓ test_account_chip_renders
  ✓ test_reply_uses_message_account
  ✓ test_unified_search_deduplicates
  ✓ test_snooze_uses_correct_account_endpoint
  ✓ test_multi_sse_routing
  ✓ test_account_chip_shows_current_selection
  ✓ test_dropdown_lists_all_accounts
  ✓ test_selecting_account_updates_folders
  ✓ test_selecting_all_inboxes_shows_aggregate
  ✓ test_account_chip_color_matches_selection
  ✓ test_key_resolution_uses_owning_mailbox
  ✓ test_key_locked_prompts_for_correct_account
  ✓ test_unlock_retries_decrypt
  ✓ test_global_key_signal_never_used_in_unified_path
UNIFIED INBOX TESTS: 15 passed, 0 failed

Running Masked Email Tests...
  ✓ 1. TestBuildMimeStringIncludesAliasHeaders
  ✓ 2. TestBuildPendingSendPayloadWithFromAlias
  ✓ 3. TestRestoreComposeStateWithFromAlias
  ✓ 4. TestMaskedAliasAPIFunctions
  ✓ 5. TestMaskedAliasRateLimitErrorHandling
  ✓ 6. TestMessageMetadataReplyViaAlias
  ✓ 7. test_custom_alias_validation_shows_errors
  ✓ 8. test_custom_alias_preview_updates
  ✓ 9. test_custom_alias_409_shows_friendly_error
  ✓ 10. test_random_mode_hides_custom_input
  ✓ 11. TestCreateCustomAliasAPI
MASKED EMAIL TESTS: 11 passed, 0 failed

OVERALL: 229 passed, 0 failed
```
