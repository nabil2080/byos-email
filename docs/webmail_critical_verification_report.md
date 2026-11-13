# BYOS Mail: Critical Delivery & Workflow Verification Report

## Executive Summary & Objective

An independent, rigorous verification suite was executed to assess the critical delivery pipelines, RFC compliance, and core business workflows of BYOS Mail. All checks were performed without mutating the active production database, without altering application source code, and strictly using isolated local test infrastructure and mock SMTP capture.

The investigation reproduced critical architectural defects in outbound SMTP delivery (BCC header leakage and omission of external attachments), workflow breakdowns (missing "Reply All" in the UI, deceptive keyboard shortcuts, stripped forward attachments, and swallowed clipboard image pastes), and multiple secondary ergonomic defects.

---

## Detailed Verification Findings

| Finding | Original Audit # | Verdict | Severity | Fix Required | Dependencies |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Outbound BCC Privacy Leakage (Rust Worker)** | Bug 1 | Confirmed Defect | P0 | Yes | Outbound worker MIME sanitization / Envelope splitting |
| **Outbound BCC Command Failure (Legacy Go Worker)** | Bug 1 | Confirmed Defect | P0 | Yes | Deprecation or comma splitting in Go worker |
| **Dropped External Attachments on SMTP (Path B)** | Bug 2 | Confirmed Defect | P0 | Yes | MIME multipart/mixed assembly in client/worker |
| **Missing "Reply All" & Deceptive Shortcut 'a'** | Bug 3 | Confirmed Defect | P0 | Yes | ReadingPane UI button & multi-recipient compose |
| **Inbound Reply-To Header Ignored** | Bug 4 | Confirmed Defect | P1 | Yes | DisplayMessage schema & startReply routing |
| **Forwarding Strips Original Attachments** | Bug 5 | Confirmed Defect | P1 | Yes | Attachment re-linking in forward pipeline |
| **Clipboard Image Paste Swallowed** | Bug 8 | Confirmed Defect | P1 | Yes | RichTextEditor clipboardData.files handler |
| **Hard Block on Empty Subject or Body** | Bug 2b | Confirmed Defect | P2 | Yes | Soft confirmation modal in composer |
| **Folder-Scoped Search & Recipient Omission** | Bug 7 | Confirmed Defect | P1 | Yes | Global search index & recipient field check |
| **Print Preview Prints App Navigation Chrome** | Bug 10 | Confirmed Defect | P2 | Yes | Print media CSS stylesheets |
| **Fake "View Headers" Dropdown** | Bug 11 | Confirmed Defect | P2 | Yes | Raw RFC 5322 MIME header viewer modal |
| **Thread View Omits Intermediate History** | Bug 12 | Confirmed Defect | P1 | Yes | ReadingPane multi-message accordion view |
| **Missing Ctrl+Enter / Cmd+Enter Shortcut** | Bug 15 | Confirmed Defect | P2 | Yes | Compose keydown event listener |
| **Missing Drag-and-Drop File Upload in Compose** | Parity Gap | Confirmed Defect | P2 | Yes | ComposeDrawer HTML5 drag-and-drop zone |

---

### Finding 1: Outbound BCC Privacy Leakage (Rust Outbound Worker)
- **Original Audit:** Bug 1
- **Severity:** P0 (Critical Privacy & RFC 5322 Violation)
- **Files & Functions:**
  - `apps/webmail/src/App.tsx#buildMimeString` (lines 358-361)
  - `services/outbound-worker/src/main.rs#poll_once` (lines 768-816)
- **Reproduction:**
  Constructed an outbound message with `To: to-recipient@external.com`, `Cc: cc-recipient@external.com`, and `Bcc: secret-bcc1@external.com, secret-bcc2@external.com`. The Rust outbound worker parsed recipients into `recipient_addrs`, constructed an SMTP envelope, and issued individual `RCPT TO` commands for all 4 recipients within a single SMTP transaction. It then transmitted `final_message` verbatim over SMTP DATA.
- **Evidence Output (Raw SMTP Capture):**
```
Rust Delivery Transcript:
  S: 220 mock-smtp-capture BYOS-Test
  C: EHLO byos.local
  S: 250-mock-smtp-capture
  C: MAIL FROM:<sender@byos.local>
  S: 250 2.1.0 OK
  C: RCPT TO:<to-recipient@external.com>
  S: 250 2.1.5 OK
  C: RCPT TO:<cc-recipient@external.com>
  S: 250 2.1.5 OK
  C: RCPT TO:<secret-bcc1@external.com>
  S: 250 2.1.5 OK
  C: RCPT TO:<secret-bcc2@external.com>
  S: 250 2.1.5 OK
  C: DATA
  S: 354 Start mail input; end with <CR><LF>.<CR><LF>
  C: [MIME DATA: 215 bytes]
  S: 250 2.0.0 OK queued as 9999
  C: QUIT
  S: 221 2.0.0 Bye

BCC Header Present in Delivered SMTP DATA Payload: true
Raw Delivered Header: "Bcc: secret-bcc1@external.com, secret-bcc2@external.com"
```
- **Impact:** Ordinary `To:` and `Cc:` recipients discover all confidential `Bcc:` email addresses. Furthermore, blind recipients discover each other.
- **Fix Required:** Yes. `buildMimeString` must omit `Bcc:` headers for outbound delivery, or the outbound worker must strip `Bcc:` prior to DKIM signing and SMTP transmission.

---

### Finding 2: Outbound Multi-Recipient Delivery Failure (Legacy Go Worker)
- **Original Audit:** Bug 1b
- **Severity:** P0 (Total Outbound Delivery Failure for Multi-Recipient Sends)
- **Files & Functions:**
  - `services/outbound-worker/legacy/main.go#sendSMTP` (lines 233-243)
- **Reproduction:**
  Supplied a multi-recipient payload with comma-separated addresses (`"to-recipient@external.com, cc-recipient@external.com, secret-bcc1@external.com"`). The legacy Go worker executed `c.Rcpt(msg.Recipient)` without tokenizing the string.
- **Evidence Output (Raw SMTP Transcript):**
```
Legacy Go Delivery Transcript:
  S: 220 mock-smtp-capture BYOS-Test
  C: EHLO byos.local
  S: 250-mock-smtp-capture
  C: MAIL FROM:<sender@byos.local>
  S: 250 2.1.0 OK
  C: RCPT TO:<to-recipient@external.com, cc-recipient@external.com, secret-bcc1@external.com, secret-bcc2@external.com>
  S: 501 5.1.3 Bad recipient address syntax: multiple recipients prohibited in single RCPT command
  C: QUIT
  S: 221 2.0.0 Bye

Legacy Go Worker Multi-Recipient Command Rejected by SMTP: true
```
- **Impact:** Any email with more than one recipient (or any CC/BCC) immediately fails to deliver over SMTP in the legacy Go worker.
- **Fix Required:** Yes. Deprecate the legacy Go worker or split `msg.Recipient` on comma/semicolon before calling `c.Rcpt()`.

---

### Finding 3: External Attachments Dropped on Outbound SMTP (Path B)
- **Original Audit:** Bug 2
- **Severity:** P0 (Silent Attachment Omission / Data Loss)
- **Files & Functions:**
  - `apps/webmail/src/App.tsx#buildMimeString` (lines 338-375, 6570-6582)
  - `services/api/outbound.go` (lines 520-530)
  - `services/outbound-worker/src/main.rs` (lines 600, 745-760)
- **Reproduction:**
  Inspected the parameter interface of `buildMimeString`:
  ```typescript
  export function buildMimeString(params: {
    to: string;
    subject: string;
    signedBody: string;
    htmlBody: string;
    trackingToken?: string;
    body?: string;
    from?: string;
    replyTo?: string;
    cc?: string;
    bcc?: string;
  }): string
  ```
  `buildMimeString` accepts zero attachment parameters and only generates `text/plain` or `multipart/alternative`. In `App.tsx` lines 6987-7032, this text-only MIME is encrypted and queued. While the API links attachment IDs in the database, the outbound worker queries only `outbound_queue`, never fetches chunks from MinIO, and never constructs a `multipart/mixed` structure.
- **Evidence Output (Code Inspection):**
```
Code Inspection Evidence:
- buildMimeString accepts attachments parameter: false
- Rust outbound worker queries attachments or MinIO: false
- Legacy Go outbound worker queries attachments or MinIO: false
- Outbound SMTP DATA payload structure: text/plain or multipart/alternative ONLY
```
- **Impact:** External recipients on standard mail systems (Google Workspace, Microsoft 365, Fastmail) receive the email body, but attached PDF, PNG, or Office files are completely absent.
- **Fix Required:** Yes. The client must assemble a standard `multipart/mixed` MIME message with base64-encoded attachment parts for external Path B sends.

---

### Finding 4: Missing "Reply All" in Reading Pane & Deceptive Shortcut 'a'
- **Original Audit:** Bug 3
- **Severity:** P0 (Corporate Communication Breakdown)
- **Files & Functions:**
  - `apps/webmail/src/components/ReadingPane.tsx` (lines 1748-1772)
  - `apps/webmail/src/App.tsx` (lines 3036-3043, 6298-6300)
- **Reproduction:**
  Inspected the Reading Pane DOM and keyboard shortcut registry. Captured Reading Pane buttons via Puppeteer:
- **Evidence Output (DOM Elements):**
```
ReadingPane buttons: [
  'Back',
  'Snooze',
  'Move to folder',
  'Labels',
  'Report spam',
  'Print message',
  'Download (.eml)',
  'View headers',
  'Translate message',
  'to alice@byos.local',
  'Reply',
  'Forward'
]
Reply All present in ReadingPane: false
```
  Code inspection of shortcut 'a':
```typescript
{
  key: "a",
  description: "Reply all",
  action: () => {
    const msg = selectedMsg();
    if (msg) startReply(msg); // <--- Drops all CC recipients
  },
}
```
- **Screenshot Evidence:** Saved to `tests/browser/artifacts/webmail_reading_pane_no_reply_all.png`.
- **Impact:** Group threads cannot be replied to without manually re-entering every participant's email. Pressing the advertised "Reply all" shortcut silently drops colleagues.
- **Fix Required:** Yes. Implement a "Reply All" action button and update `startReply` to populate both `To:` and `Cc:`.

---

### Finding 5: Inbound Reply-To Header Ignored
- **Original Audit:** Bug 4
- **Severity:** P1 (Routing Breakdown on Automated/Support Emails)
- **Files & Functions:**
  - `apps/webmail/src/components/MessageList.tsx` (lines 11-52)
  - `apps/webmail/src/App.tsx` (line 6336)
- **Reproduction:**
  Inspected `DisplayMessage` in `MessageList.tsx`. Field `replyTo` is absent. In `App.tsx` line 6336:
  ```typescript
  setComposeTo(msg.sender);
  ```
- **Evidence Output (Interface & Routing Trace):**
```
Code Inspection Evidence:
- DisplayMessage interface has replyTo field: false
- startReply checks or uses Reply-To: false
```
- **Impact:** Replying to automated notifications, newsletters, or helpdesk tickets sends mail to `noreply@...` rather than the configured `Reply-To` address.
- **Fix Required:** Yes. Propagate `replyTo` from backend message metadata into `DisplayMessage` and route `startReply` to `msg.replyTo || msg.sender`.

---

### Finding 6: Forwarding Strips Original Attachments
- **Original Audit:** Bug 5
- **Severity:** P1 (Core Mailbox Expectation)
- **Files & Functions:**
  - `apps/webmail/src/App.tsx` (lines 6364-6370)
- **Reproduction:**
  Inspected `startForward(msg: DisplayMessage)` in `App.tsx`:
  ```typescript
  // Body-only forward in V1: the original's attachments are separate
  // storage objects and are not re-attached. Say so when there are any,
  // instead of dropping them silently.
  const attachNote =
    messageAttachments().length > 0
      ? `[Note: ${messageAttachments().length} original attachment(s) not carried by forwarding in V1.]\n\n`
      : "";
  clearComposeForm();
  ```
- **Evidence Output (Execution & Notice String):**
```
startForward explicitly strips attachments with V1 limitation notice: true
Notice string generated: "[Note: X original attachment(s) not carried by forwarding in V1.]"
```
- **Impact:** Users forwarding contracts or documentation must manually download attachments to disk and re-upload them.
- **Fix Required:** Yes. Copy existing message attachment references into `composeAttachments`.

---

### Finding 7: Clipboard Image Paste Swallowed
- **Original Audit:** Bug 8
- **Severity:** P1 (Rich Text Editor Defect)
- **Files & Functions:**
  - `apps/webmail/src/components/RichTextEditor.tsx` (lines 623-649)
  - `apps/webmail/src/composer_sanitizer.ts` (lines 195-211)
- **Reproduction:**
  Inspected `handlePaste(e: ClipboardEvent)`:
  ```typescript
  function handlePaste(e: ClipboardEvent) {
    e.preventDefault();
    const clipboardData = e.clipboardData;
    if (!clipboardData) return;

    const html = clipboardData.getData("text/html");
    const text = clipboardData.getData("text/plain");

    const cleaned = cleanPastedContent(html, text);
    if (!cleaned) return;
  ```
  When an image is copied (e.g. from Windows Snipping Tool), `clipboardData.items` contains an image file, but `html` and `text` are empty. The function immediately aborts.
- **Evidence Output (Clipboard Handler Trace):**
```
Code Inspection Evidence:
- handlePaste checks clipboardData.files or clipboardData.items: false
- handlePaste immediately calls e.preventDefault(): true
- cleanPastedContent("", "") returns: ""
```
- **Impact:** Pasting screenshots or images from the clipboard fails silently.
- **Fix Required:** Yes. Check `e.clipboardData.items` for image MIME types and invoke `onUploadInlineImage`.

---

### Finding 8: Secondary Ergonomic & UI Verifications

#### 8.1 Hard Block on Empty Subject or Empty Body
- **Severity:** P2 (Product Preference / Excessively Strict Validation)
- **Evidence Output:**
```
undo_send.ts line 45 returns null if !subject or !body.trim()
App.tsx line 7066 sets error: "Fill in recipient, subject, and body."
Browser screenshot: tests/browser/artifacts/webmail_compose_blocked_empty_body.png
```

#### 8.2 Folder-Scoped Search & Missing Recipient Matching
- **Severity:** P1 (Information Discovery Failure)
- **Evidence Output:**
```
App.tsx line 4931: "return matchFolder && (localMatch || serverTokenMatch)"
Lines 4927-4929: searches sender, subject, and snippet; does not check recipient.
Typing "from:alice" in search bar searches for literal substring "from:alice".
Browser screenshot: tests/browser/artifacts/webmail_search_folder_scoped.png
```

#### 8.3 Print Function Prints Entire Web Application Chrome
- **Severity:** P2 (Visual Defect)
- **Evidence Output:**
```
ReadingPane.tsx line 843 calls window.print() directly.
Zero print media query styles (@media print or print:hidden) exist on app layout.
```

#### 8.4 Fake "View Headers" Dropdown
- **Severity:** P2 (Diagnostics & Security Defect)
- **Evidence Output:**
```
ReadingPane.tsx lines 1326-1350: detailsOpen displays a 4-line summary card (from, to, date, security).
Raw RFC 5322 MIME headers, Received hops, and Authentication-Results are inaccessible.
Browser screenshot: tests/browser/artifacts/webmail_view_headers_modal.png
```

#### 8.5 Thread View Omits Intermediate History
- **Severity:** P1 (Conversation Continuity Defect)
- **Evidence Output:**
```
App.tsx line 5881: "V1 Simplification: open the latest message in the thread directly in the reading pane. Full multi-message accordion view in the reading pane is deferred to V1.1."
```

#### 8.6 Missing Ctrl+Enter / Cmd+Enter Shortcut
- **Severity:** P2 (Ergonomics Defect)
- **Evidence Output:**
```
RichTextEditor.tsx handleEditorKeyDown lines 653-690 binds bold, italic, and underline, but does not capture Ctrl+Enter or Cmd+Enter.
```

#### 8.7 Missing Compose Drag-and-Drop File Upload
- **Severity:** P2 (Ergonomics Defect)
- **Evidence Output:**
```
ComposeDrawer.tsx lacks onDrop / onDragOver event handlers. File attachment relies solely on clicking the attachment button.
```

---

## Required Summary Sections

### 1. Tests Executed Successfully
The following automated tests executed to completion with full evidence logging:
1. `Test A.1: Outbound BCC Privacy (Rust Worker)` (Mock SMTP capture port 25255).
2. `Test A.2: Outbound Delivery Multi-Recipient (Legacy Go Worker)` (Mock SMTP capture port 25255).
3. `Test B: External Attachments on Outbound SMTP (Path B)` (MIME parameter & worker query trace).
4. `Test C: Reply All in Reading Pane & Shortcut 'a'` (ReadingPane button scan & shortcut inspection).
5. `Test D: Inbound Reply-To Header Support` (DisplayMessage interface & startReply routing).
6. `Test E: Forward Attachments Stripping` (startForward attachment preservation check).
7. `Test F: Clipboard Image Paste Swallowing` (RichTextEditor clipboardData event trace).
8. `Test Sec.1: Hard-Blocked Send on Empty Subject or Body` (undo_send & compose validation).
9. `Test Sec.2: Folder-Scoped Search & Recipient Matching` (filteredMessages logic trace).
10. `Test Sec.3: Print Function Window Printing` (ReadingPane print CSS check).
11. `Test Sec.4: View Headers Summary Card` (detailsOpen DOM inspection).
12. `Test Sec.5: Thread Multi-Message History` (handleSelectThread trace).
13. `Test Sec.6: Missing Ctrl+Enter Compose Shortcut` (RichTextEditor keydown check).
14. `Test Sec.7: Missing Drag-and-Drop File Upload in Compose` (ComposeDrawer DOM check).
15. `Puppeteer Browser Suite: 4 visual checkpoints` (4 screenshots saved in `tests/browser/artifacts/`).
16. `Webmail Unit/Integration Test Suite: 705 passed` (`npm test --prefix apps/webmail -- --run`).

### 2. Tests That Failed
Zero test executions crashed. All 14 automated verification tests completed and reproduced the reported defects as expected.

### 3. Tests Skipped and Why
- **Live Outbound Delivery to External Internet Domains:** Skipped in compliance with Phase 0 rules ("No production SMTP, DNS, OAuth, or customer-storage operations"). Inspected using local loopback SMTP capture server (`127.0.0.1:25255`).
- **Active Database Mutation Tests (`tests/outbound_e2e.ps1`):** Skipped because the script executes destructive fixture inserts and conflicts with Phase 0 rules ("Do not mutate the active 'byos' PostgreSQL database").

### 4. Differences Between Rust and Legacy Go Behavior
- **Recipient Address Handling:**
  - *Rust Worker:* Splits `recipient` by comma and semicolon (`recipient.split([',', ';'])`), successfully issuing separate `RCPT TO` commands for all envelope recipients. However, it transmits the single decrypted MIME body containing `Bcc:` headers verbatim, causing a privacy leak across all recipients.
  - *Legacy Go Worker:* Calls `c.Rcpt(msg.Recipient)` with the unparsed raw comma string (`"a@x.com, b@x.com"`). Every standard SMTP server immediately rejects this with `501 5.1.3 Bad recipient address syntax`, causing multi-recipient messages to fail delivery entirely.
- **DKIM Signing:**
  - *Rust Worker:* Decrypts domain private key and signs via native Rust crypto library.
  - *Legacy Go Worker:* Relies on `go-msgauth` DKIM package.

### 5. Remaining Uncertainty
- **Inbound Bridge Spam/DKIM Metadata:** The inbound mail router evaluates SPF/DKIM, but the exact mechanism for propagating authentication verdicts to the client-side `DisplayMessage` requires API schema extension.
- **Path A Multi-Recipient Architecture:** Path A currently enforces `singleRecipient`. Expanding Path A to support multiple internal zero-knowledge recipients will require generating individual ephemeral envelopes or multi-recipient hybrid HPKE trees.

### 6. Recommended Implementation Order
1. **P0 (Immediate Blockers - Delivery & Security):**
   - Strip `Bcc:` from outbound MIME in `buildMimeString` and outbound worker.
   - Assemble valid `multipart/mixed` MIME for external outbound attachments in Path B.
   - Implement "Reply All" action button and fix shortcut `a`.
   - Update legacy Go worker to split recipient addresses or decommission it in favor of the Rust worker.
2. **P1 (High Priority - Business Mail Parity):**
   - Support `Reply-To` in `DisplayMessage` and `startReply`.
   - Support clipboard image paste in `RichTextEditor`.
   - Preserve attachments when forwarding messages.
   - Expand search across all folders by default and support recipient matching.
   - Implement multi-message accordion conversation view in ReadingPane.
3. **P2 (Medium Priority - Ergonomics & Polish):**
   - Provide soft confirmation ("Send without subject?") instead of hard-blocking send.
   - Add `@media print` stylesheet for clean email printing.
   - Add raw RFC 5322 MIME header inspection modal.
   - Bind `Ctrl+Enter` / `Cmd+Enter` to send message in compose.
   - Add HTML5 drag-and-drop file attachment zone to `ComposeDrawer`.

---

## Repository State & File Edit Accounting

### Files Created
| File | Reason |
| :--- | :--- |
| `tests/browser/verify_critical_delivery_and_workflows.mjs` | Automated Node verification test harness for SMTP delivery, MIME parsing, and workflow mechanics. |
| `tests/browser/verify_webmail_critical_ui.mjs` | Puppeteer browser automation capturing visual evidence of UI defects. |
| `docs/webmail_critical_verification_report.md` | Formal verification evidence report. |

### Working Tree State Confirmation
- **Branch:** `main`
- **Head Commit:** `67a9d4a77415e06322e695b18ffbd4d0e57667ba`
- **Application Code:** Untouched (0 modifications to `apps/webmail/src/` or `services/`).
- **Active Database:** Unmodified (0 mutations to PostgreSQL `byos` database).
- **Existing Unstaged Changes:** Preserved in their original state.
