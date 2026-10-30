# Web Application Architecture and Tooling Audit Report

## What was built
Comprehensive forensic audit and architectural evaluation of the `byos-email` web application, frontend components, cryptographic lifecycle, storage pipelines, zero-knowledge hygiene, and testing toolchain.

## Files edited
| File | Reason |
|------|--------|
| docs/web_app_architecture_and_tooling_audit_report.md | Comprehensive web application architecture and testing toolchain audit report |

---

## 1. Tooling & Test Harness Discovery

### 1.1 Frontend Component & Unit Testing
* **Vitest:** **Missing**. No `vitest` dependency in `apps/webmail/package.json` or root `package.json`.
* **@solidjs/testing-library:** **Missing**. No SolidJS DOM testing harness is installed.
* **jsdom / happy-dom:** **Partial**. `jsdom` (`^29.1.1`) is installed in `apps/webmail/devDependencies`, but `happy-dom` is missing. `jsdom` is currently used solely as an environment polyfill for ad-hoc node scripts rather than a managed runner.
* **Current Frontend Test Harness:** Custom hand-rolled runner. `npm test` executes:
  ```json
  "test": "npx tsx --experimental-wasm-modules src/run_test.node.js"
  ```
  `src/run_test.node.js` is a 435-line procedural script that manually imports and executes test functions sequentially (`runAttachmentCryptoTests()`, `runTotpTests()`, `runCalendarCategory14Tests()`, etc.) and tallies a `totalPassed` / `totalFailed` integer count.
  - **Limitations:** No test isolation between runs, no watch mode (`--watch`), no test filtering (`-t` / `--filter`), no snapshot testing, no code coverage instrumentation, and no rendering simulation for SolidJS components (`render`, `fireEvent`, `screen`).

### 1.2 End-to-End & Browser Automation
* **Playwright:** **Missing**. Not installed.
* **Cypress:** **Missing**. Not installed.
* **Current Browser Automation Harness:** `puppeteer-core` (`^25.12.0`) is installed in `apps/webmail/devDependencies`. Tests in `tests/browser/*.mjs` launch a headless Google Chrome instance by pointing directly to the host executable (`C:\Program Files\Google\Chrome\Application\chrome.exe`).
  - **Execution Mechanism:** Orchestrated via `smoke.ps1`, which loops through 19 `.mjs` scripts sequentially.
  - **Limitations:** Uses arbitrary sleep delays (`await new Promise(r => setTimeout(r, 3000))`) instead of event-driven auto-waiting, tightly coupled to a specific local Chrome binary path, executes sequential host-level shell operations (`execSync('docker stop byos-api')`), and lacks parallel execution or DOM assertion abstractions.

### 1.3 Cryptographic Test Harness
* **wasm-bindgen-test:** **Partial**. Listed under `[dev-dependencies]` in `packages/crypto-core/Cargo.toml`:
  ```toml
  [dev-dependencies]
  wasm-bindgen-test = "0.3"
  hex = "0.4"
  ```
  However, neither `cargo` nor `wasm-pack` is present in the host system PATH, preventing host-level execution without containerization.
* **Native Rust Unit Tests:** **Partial**. 7 integration test suites exist in `packages/crypto-core/tests/` (`ed25519_signing.rs`, `seed_tool_roundtrip.rs`, `signing_seed.rs`, `worker_dispatch.rs`, `xwing_envelope.rs`, `xwing_seed.rs`, `xwing_storage.rs`).
* **Browser Wasm Integration Runners:** **Partial**. Wasm integration is tested inside Node.js via `--experimental-wasm-modules` inside `src/run_test.node.js` loading `byos_crypto_core.js`. There is no dedicated headless browser test runner (such as `wasm-bindgen-test --headless --firefox/chrome` or a browser-context Vitest/Playwright Wasm runner) verifying memory bounds or WebAssembly SIMD/threading in actual browser engines.

### 1.4 Backend Test Utilities
* **Go `testing` Package:** **Installed**. Fully implemented across all Go services (`services/api`, `services/admin-api`, `services/mail-router`, `services/storage-worker`).
* **`testify` (assert/require/mock):** **Missing**. No `github.com/stretchr/testify` module exists in any `go.mod`. Tests rely entirely on standard library `if got != want { t.Fatalf(...) }`.
* **SQL Query Counters / N+1 Detection:** **Missing**. The backend uses `jackc/pgx/v5` and `database/sql` without any `QueryTracer` or query counter middleware. There is no automated guard against N+1 query regressions in message list or thread expansion endpoints.
* **API Test Harnesses:** **Installed**. Utilizes `net/http/httptest` with DSN isolation safeguards (`validateTestDSNString` enforcing local test database safety).

### 1.5 Linting & Code Quality
* **ESLint / Biome:** **Missing**. No root or app-level `.eslintrc`, `eslint.config.js`, or `biome.json` exists in the repository. (The only ESLint files in the repo are third-party files inside ignored `node_modules`).
* **TypeScript Strictness:** **Partial**. `apps/webmail/tsconfig.json` enables `"strict": true`, but omits strict safety options:
  - Missing: `"noUncheckedIndexedAccess": true`
  - Missing: `"noImplicitReturns": true`
  - Missing: `"exactOptionalPropertyTypes": true`
* **Tailwind Tooling:** **Partial**. `@tailwindcss/vite` (`^4.1.0`) is configured in `vite.config.ts`, but no Tailwind linter or class-sorting tool (e.g. `prettier-plugin-tailwindcss`) is configured. Deprecated configuration files `postcss.config.cjs` and `postcss.config.js` remain in `apps/webmail/`.

---

## 2. Web Application Architecture Audit

### 2.1 Component Modularity & Component Architecture
The web application exhibits extreme monolithic concentration in `apps/webmail/src`:

1. **`App.tsx` Monolith (8,734 lines, 363 KB):**
   - Contains **139 `createSignal` calls** in a single component function (`App: Component`).
   - Tightly couples routing, modal controllers, contact management, calendar views, passkey auth, draft autosave, session isolation, search token indexing, and attachment multi-chunk uploading into a single scope.
   - Embeds core transport logic (`sendMimeWithFallback`, `tryPathASend`) directly above the component definition rather than in dedicated transport services.
2. **Top Oversized Components:**
   - `apps/webmail/src/App.tsx`: 8,734 lines
   - `apps/webmail/src/components/calendar/settings/CalendarSettingsPanel.tsx`: 3,443 lines
   - `apps/webmail/src/components/notes/NotesView.tsx`: 2,742 lines
   - `apps/webmail/src/components/calendar/CalendarView.tsx`: 2,318 lines
   - `apps/webmail/src/routes/settings/SecurityTab.tsx`: 2,270 lines
   - `apps/webmail/src/components/calendar/EventModal.tsx`: 1,756 lines
   - `apps/webmail/src/components/RichTextEditor.tsx`: 1,342 lines
   - `apps/webmail/src/components/ReadingPane.tsx`: 1,312 lines
   - `apps/webmail/src/components/Sidebar.tsx`: 1,039 lines
3. **State Coupling & Prop Drilling:**
   - Global application state is largely held as loose signals in `App.tsx` and threaded down through 5+ levels of props rather than utilizing modular SolidJS Stores (`createStore`) or Solid Context providers (`createContext`).
   - Destructuring or direct coupling risks breaking Solid's fine-grained reactivity tracking when components are split without `splitProps`.

### 2.2 Cryptographic Lifecycle & Wasm Integration
1. **Ad-Hoc Asynchronous Module Loading:**
   `byos_crypto_core.js` is imported dynamically across dozens of call sites via:
   ```ts
   const wasm = await import("./generated/crypto-core/byos_crypto_core.js");
   ```
   There is no centralized Wasm provider or initialized singleton service. Every cryptographic operation redundantly awaits the dynamic import promise.
2. **Main-Thread Cryptographic Blocking (No Web Workers):**
   - **Zero Web Workers** are utilized for client-side cryptographic compute.
   - Intensive cryptographic operations—including Argon2id passphrase derivation (`wasm_argon2id_derive`), ML-KEM-768 key encapsulation, X-Wing hybrid envelope creation, and AES-256-GCM attachment chunk encryption—run synchronously on the browser's UI thread.
   - When encrypting or decrypting multi-megabyte payloads or attachments, the UI thread blocks, causing visible frame drops and freezing user interaction.
3. **Memory Hygiene & Immutable String Keys:**
   - Cryptographic secrets (root secrets, unwrap keys, mailbox secret keys) are returned from Wasm bindings as hex strings (e.g. `rootHex: string = wasm.wasm_recover_root_secret(...)`).
   - JavaScript strings are immutable in V8 and cannot be zeroized (`.fill(0)`). They linger in the JavaScript heap until garbage collected, directly violating Skill `10-wasm-ui-bridge` Rule 3 ("ensure the UI explicitly clears those JavaScript variables immediately after the WASM boundary transition").
   - Typed arrays are created on demand without memory pooling or deterministic deallocation.

### 2.3 Storage & API Layer
1. **Attachment Upload Architecture:**
   - In `apps/webmail/src/attachment_crypto.ts` (`preparePathAAttachment`, lines 322-380), the entire file (up to 40 MB) is loaded into a single `Uint8Array`.
   - Dual-encryption creates two copies of ciphertext in memory: one for recipient delivery and one for sender Sent-folder storage.
   - Chunks (1 MB each) are converted to base64 strings inside JSON objects (`{ object_key, data: bytesToBase64(...) }`), adding 33% JSON serialization memory overhead.
   - In `App.tsx` (lines 5975-5981), chunks are uploaded to `/v1/mailboxes/{mailbox_id}/attachment-chunks` via a sequential `for` loop:
     ```ts
     for (const ch of prep.recipientChunks) {
       await uploadAttachmentChunk(box.id, ch.storageRef, ch.data);
     }
     for (const ch of prep.senderChunks) {
       await uploadAttachmentChunk(box.id, ch.storageRef, ch.data);
     }
     ```
     A 40 MB attachment triggers 80 serial HTTP requests with no concurrency, no retry backoff, and no chunk resumability.
   - Attachments are proxied through the Go API rather than uploaded directly to MinIO via presigned S3 URLs.
2. **Error Boundaries:**
   - **Zero `<ErrorBoundary>` components** exist across `apps/webmail/src`. Any unhandled runtime exception during decryption or rendering causes a fatal application crash resulting in a blank white screen.

### 2.4 Zero-Knowledge Hygiene & Data Leakage Risks
1. **Critical: Private Keys Persisted to `sessionStorage`:**
   In `apps/webmail/src/session_isolation.ts` (lines 40-49, 215, 234, 249):
   ```ts
   const hex = store.getItem("byos_mailbox_sk_" + accountId);
   // ...
   const hex = store.getItem("byos_signing_seed_" + accountId);
   // ...
   const hex = store.getItem("byos_xwing_seed_" + accountId);
   ```
   Unwrapped private keys and signing seeds are serialized to hex and stored in browser `sessionStorage`. Any Cross-Site Scripting (XSS) vulnerability or malicious third-party script can read `sessionStorage` and exfiltrate the user's master keys.
2. **High: Unencrypted Contacts Plaintext Transmission:**
   In `apps/webmail/src/components/modals/ContactsModal.tsx` (lines 159-164):
   ```ts
   const created = await createContact(props.mailboxId, {
     name,
     email,
     notes,
     group_name: groupName,
   });
   ```
   Although `encryptContactEnvelope` is defined in `message_crypto.ts`, `ContactsModal.tsx` transmits `name`, `email`, `notes`, and `group_name` in plain unencrypted JSON to `/v1/mailboxes/{id}/contacts`.
3. **High: Draft Metadata Plaintext Exposure:**
   In `App.tsx` (lines 6359-6403) and `services/api/drafts.go` (lines 10-14, 184-212), draft message bodies are encrypted, but `subject` and `recipient` are stored in plaintext in the PostgreSQL `drafts` table.
4. **Medium: Notes Local Storage Plaintext Fallback:**
   In `apps/webmail/src/components/notes/notesStore.ts` (lines 740-750), if `mailboxKey` is undefined or not 32 bytes, notes fall back to saving plaintext titles and contents directly into `localStorage`.
5. **Medium: Notes Media / Drawings Unencrypted in IndexedDB:**
   In `apps/webmail/src/components/notes/notesStore.ts` (lines 441-461, 509-514), user sketches and photo attachments are stored in cleartext base64 (`data:image/...`) inside IndexedDB (`notes_media_db_v1`).

---

## 3. Benefits & Impact Analysis

| Tooling / Architectural Pattern | Concrete Benefit to Current Development Phase | Trade-offs & Overhead |
|---|---|---|
| **Vitest + `@solidjs/testing-library` + `happy-dom`** | Replaces the brittle 435-line `run_test.node.js` script with standard test discovery, file watch mode (`--watch`), selective test execution (`-t`), and true SolidJS component rendering verification. Ensures refactoring of `App.tsx` does not break UI bindings. | Requires adding ~4 devDependencies; minimal test execution overhead (~50-100ms per file). |
| **Playwright Browser Runner** | Replaces custom Puppeteer scripts and hardcoded `setTimeout` sleeps with deterministic auto-waiting, parallel test execution, and screenshot/video artifact capture on failure. | Higher initial installation footprint (~150MB browser binaries); slightly slower cold startup in CI than lightweight Node unit tests. |
| **Dedicated Web Worker Crypto Bridge (`byos-crypto-worker`)** | Offloads Argon2id derivation, X-Wing encapsulation, and AES-GCM chunk processing from the UI thread, eliminating UI stutter, freeze frames, and main-thread latency during message/attachment decryption. | Requires establishing a message-passing channel with transferable `ArrayBuffer` objects; introduces asynchronous coordination overhead. |
| **In-Memory Secure Key Custody (Zeroize buffers, purge `sessionStorage`)** | Closes critical zero-knowledge vulnerabilities by preventing private key material from resting in unencrypted browser storage (`sessionStorage`). Keeps keys strictly in memory-managed typed arrays with `.fill(0)` on lock/logout. | Page reload requires re-entering credentials or unsealing via WebAuthn passkey PRF extension. |
| **SQL Query Counter / Tracer (`pgx` middleware)** | Detects N+1 query patterns in Go API integration tests (e.g., verifying that `/v1/mailboxes/{id}/messages` executes an exact constant number of queries regardless of message count). | Minor boilerplate setup in Go test helpers. |
| **Biome (Linter + Formatter)** | Instantaneous (<10ms) linting, import sorting, and code formatting across TypeScript and SolidJS files with zero configuration fatigue. | Requires one-time adoption and running formatting across the repo. |

---

## 4. Actionable Deliverables & Remediation Plan

### 4.1 Tooling & Harness Inventory Table

| Tool Name | Current Status | Priority for Local Dev | Purpose / Target |
|---|---|---|---|
| **Vitest** | Missing | **Must-Have** | Unit and component test runner for `apps/webmail` |
| **@solidjs/testing-library** | Missing | **Must-Have** | Reactive DOM testing for SolidJS components |
| **happy-dom** | Missing | **Must-Have** | Fast, lightweight DOM environment for Vitest |
| **Biome** | Missing | **Must-Have** | Lightning-fast TypeScript linting, formatting, import organization |
| **Playwright** | Missing | **Nice-to-Have** | Unified cross-browser E2E suite replacing `tests/browser/*.mjs` |
| **Web Worker Crypto Pipeline** | Missing | **Must-Have** | Off-main-thread Wasm crypto execution |
| **Go SQL Query Tracer** | Missing | **Nice-to-Have** | N+1 query regression detection in `services/api` tests |
| **`testify`** | Missing | **Defer** | Go tests function reliably with standard library `testing` |
| **`wasm-bindgen-test` runner** | Partial (in Cargo, not on PATH) | **Nice-to-Have** | Browser Wasm integration test container |

### 4.2 Architectural Gaps & Technical Debt

| Area | File & Line Reference | Issue Description | Remediation |
|---|---|---|---|
| **Monolith** | `apps/webmail/src/App.tsx:615-8734` | 8,734 lines with 139 signals managing entire app state and routing | Decompose into feature contexts: `MailContext`, `CalendarContext`, `ModalContext`, `AuthContext`. |
| **Crypto UI Thread** | `apps/webmail/src/App.tsx:469, 587, 1248...` | Wasm crypto executes directly on UI thread inside component signal handlers | Move Wasm calls into a dedicated Web Worker service using transferable `ArrayBuffer`s. |
| **Memory Hygiene** | `apps/webmail/src/message_crypto.ts:64-70` | Hex strings used for root secrets and private keys | Pass `Uint8Array` directly through Wasm memory and zeroize buffers with `.fill(0)`. |
| **Storage Security** | `apps/webmail/src/session_isolation.ts:215-250` | Private keys and seeds saved in `sessionStorage` | Remove key serialization to `sessionStorage`. Keep keys strictly in runtime memory. |
| **Contact Leakage** | `apps/webmail/src/components/modals/ContactsModal.tsx:159-164` | `createContact` sends plaintext name/email/notes to server | Encrypt contact fields via `encryptContactEnvelope` before API dispatch. |
| **Draft Leakage** | `apps/webmail/src/App.tsx:6359-6403` | Draft subject and recipient transmitted in plaintext | Encrypt draft metadata or mandate end-to-end envelope encapsulation for drafts. |
| **Notes Leakage** | `apps/webmail/src/components/notes/notesStore.ts:441-461, 740-750` | Media stored unencrypted in IndexedDB; fallback to plaintext in localStorage | Require valid mailbox key before saving; encrypt IDB media blobs with AES-GCM. |
| **Error Handling** | `apps/webmail/src/` (Entire app) | Zero `<ErrorBoundary>` components | Wrap views, modals, and reading pane in Solid `<ErrorBoundary fallback={...}>`. |
| **Upload Pipeline** | `apps/webmail/src/App.tsx:5975-5981` | Serial blocking chunk upload in `for` loop with 33% base64 JSON overhead | Implement concurrent chunk upload worker pool with retry backoff and binary payload streaming. |

---

## 5. Raw Evidence

### 5.1 Frontend Unit Test Suite Execution
Command:
```powershell
cmd /c "npm --prefix apps/webmail test"
```
Output:
```
> test
> npx tsx --experimental-wasm-modules src/run_test.node.js

(node:21876) ExperimentalWarning: Importing WebAssembly modules is an experimental feature and might change at any time
Running Attachment Crypto Tests...
  ✓ Plaintext is not equal to encrypted ciphertext envelope
  ✓ Decrypt(ciphertext, correct_key) returns original plaintext
  ✓ Tampered ciphertext fails decryption
  ✓ Decrypting with wrong key fails
  ✓ No plaintext file bytes stored or logged
  ✓ test_attachment_encrypt_decrypt_roundtrip: encrypt small file, upload, download, decrypt, verify hash
  ✓ test_attachment_chunking: encrypt 5 MB file, assert 5 chunks, decrypt and reassemble
  ✓ test_attachment_corrupt_chunk_isolated: corrupt one chunk, assert other attachments decrypt and corrupted is marked
  ✓ test_attachment_iv_unique_per_chunk: encrypt 5-chunk file, assert all IVs are distinct
  ✓ test_attachment_hash_mismatch_marks_corrupted: tampered content hash marks attachment corrupted without producing partial output
  ✓ test_attachment_empty_file_roundtrip: 0-byte file encrypt, upload, download, decrypt returns 0-byte file and no error
  ✓ test_attachment_unicode_filename_roundtrip: non-ASCII unicode filename round-trips byte-for-byte
  ✓ test_attachment_full_flow_roundtrip: key gen -> chunk -> encrypt -> mock upload -> mock download -> decrypt -> hash-match
  ✓ test_wasm_unavailable_throws_not_falls_back: wrapAttachmentContentKey and unwrapAttachmentContentKey throw when WASM is unavailable
  ✓ Content key generation produces 32 bytes
  ✓ Base IV generation produces 12 bytes
  ✓ Chunk IV generation produces 12 bytes
  ✓ Attachment encryption roundtrip: 1 byte
  ✓ Attachment encryption roundtrip: 64 bytes
  ✓ Path A recipient cannot decrypt sender chunks
ATTACHMENT CRYPTO TESTS: 20 passed, 0 failed

Running TOTP Tests...
TOTP TESTS: 5 passed, 0 failed

Running Date Time Tests...
DATE TIME TESTS: 10 passed, 0 failed

Running File Type Tests...
FILE TYPE TESTS: 10 passed, 0 failed

Running Multi-Account & Storage Sync Tests...
MULTI ACCOUNT & STORAGE SYNC TESTS: 34 passed, 0 failed

OVERALL: 565 passed, 0 failed
```

### 5.2 TypeScript Typecheck Execution
Command:
```powershell
cmd /c "npm --prefix apps/webmail run typecheck"
```
Output:
```
> typecheck
> tsc --noEmit
```

### 5.3 Go API Test Suite Verification
Command:
```powershell
cmd /c "cd services\api && go test -list . -count=1"
```
Output:
```
TestCreateAliasGeneratesUniqueAddress
TestCreateAliasRateLimit
TestListAliasesOnlyOwnUser
TestDisableAliasStopsRouting
TestDeleteAliasClearsReplyMap
TestReplyFromAliasUsesAliasAddress
TestValidateCustomLocalPartUnit
TestCreateAliasCustomLocalPart
TestCreateAliasCustomRejectsDuplicate
TestCreateAliasCustomRejectsReserved
TestCreateAliasCustomRejectsInvalidChars
TestCreateAliasCustomRejectsLeadingTrailingPunct
TestCreateAliasCustomRejectsConsecutivePunct
TestCreateAliasCustomRejectsTooShort
TestCreateAliasCustomRejectsTooLong
TestCreateAliasCustomLowercases
TestCreateAliasCustomRespectsRateLimit
...
ok  	byos.email/services/api	2.223s
```

---

## 6. What did not work or is untested
* **Cargo / Rust host test execution:** **UNTESTED**. `cargo` is not installed on the host system PATH. Rust unit tests for `packages/crypto-core` must be executed within the `byos-crypto-worker` Docker container or after installing Rust on the host environment.
* **Full Playwright E2E Suite:** **UNTESTED**. Playwright is not yet installed in `apps/webmail/package.json`. Browser tests currently run via `tests/browser/*.mjs` using Puppeteer.
* **SQL Query Trace / N+1 Detection:** **UNTESTED**. No query tracer exists in `services/api`. N+1 query analysis currently requires manual inspection of PostgreSQL statement logs.
