# Dummy Emails with Full Variations Report

## What was built
Populated the BYOS Webmail inbox for `alice@byos.local` with 20 rich, realistic zero-knowledge encrypted emails covering full feature variations across modern webmail capabilities: newsletters with RFC 2369 / RFC 8058 one-click headers, personal 1-on-1 correspondence with zero false-positive unsubscribe indicators, interactive calendar invitations with RSVP cards (`text/calendar`), multi-type encrypted attachments (PDF contracts, PNG architecture graphics, dual JSON + ZIP audit archives), remote tracking protection with Privacy Shield banners, multi-turn threaded conversations, folder distribution across Inbox, Sent, Archive, Spam, and Trash, and encrypted compose drafts.

## Files edited
| File | Reason |
|------|--------|
| `apps/webmail/src/components/ReadingPane.tsx` | Added Gmail-style inline Unsubscribe button next to sender for newsletters and wired to `UnsubscribeConfirmModal`. |
| `tools/seed_dummy_emails_full_variations.mjs` | Seeder script generating 20 zero-knowledge Path A encrypted emails across all feature variations. |
| `tests/browser/verify_dummy_emails_full_variations.mjs` | Automated browser verification testing all seeded email variations and features. |

## Raw evidence

### 1. Database folder distribution for `alice@byos.local`
Command: `docker exec byos-postgres psql -U byos -d byos -c "SELECT folder, sender, is_read, is_starred, has_attachments, category_override FROM message_metadata WHERE mailbox_id = 'c0000000-0000-0000-0000-000000000001' ORDER BY folder, received_at DESC;"`
Output:
```
 folder  |                           sender                           | is_read | is_starred | has_attachments | category_override 
---------+------------------------------------------------------------+---------+------------+-----------------+-------------------
 archive | BYOS People Operations <hr@byos.local>                     | t       | f          | f               | 
 inbox   | GitHub Security <notifications@github.com>                 | t       | f          | f               | newsletters
 inbox   | Bob Stone <bob@byos.local>                                 | t       | t          | f               | primary
 inbox   | David Chen <david.chen@byos.local>                         | t       | t          | f               | primary
 inbox   | Gergely Orosz <newsletter@pragmaticengineer.com>           | t       | t          | f               | newsletters
 inbox   | TLDR Tech <dan@tldr.tech>                                  | f       | f          | f               | newsletters
 inbox   | DevOps Automation <devops@byos.local>                      | t       | f          | t               | primary
 inbox   | Cloudflare Radar <insights@radar.cloudflare.com>           | t       | f          | f               | newsletters
 inbox   | Bob Stone <bob@byos.local>                                 | f       | f          | f               | 
 inbox   | Sarah Jenkins <sarah.jenkins@designsystems.io>             | t       | f          | f               | primary
 inbox   | Security Guild <guild@byos.local>                          | t       | f          | f               | primary
 inbox   | Bob Stone <bob@byos.local>                                 | t       | f          | f               | 
 inbox   | Stripe Invoicing <invoices@stripe.com>                     | t       | f          | f               | primary
 inbox   | Legal & Compliance <legal@byos.local>                      | t       | t          | t               | primary
 inbox   | UI Team <design@byos.local>                                | t       | f          | t               | primary
 inbox   | David Chen <david.chen@byos.local>                         | t       | f          | f               | primary
 sent    | alice@byos.local                                           | t       | f          | f               | 
 spam    | Fast Wealth Alerts <promotions@crypto-moon-yields-889.xyz> | f       | f          | f               | 
 trash   | Office Supplies Vendor <orders@office-supplies-vendor.com> | t       | f          | f               | 
(19 rows)
```

### 2. Encrypted Draft in `drafts` table
Command: `docker exec byos-postgres psql -U byos -d byos -c "SELECT id, subject, recipient, version FROM drafts WHERE mailbox_id = 'c0000000-0000-0000-0000-000000000001';"`
Output:
```
                  id                  |                                     subject                                     |            recipient            | version 
--------------------------------------+---------------------------------------------------------------------------------+---------------------------------+---------
 fe8a784a-ab25-44d6-8b47-95ffc280b781 | Draft RFC: Ephemeral Hybrid Renegotiation Protocol for Zero-Knowledge Mailboxes | security-working-group@ietf.org |       1
(1 row)
```

## Manual browser verification
Ran automated Chromium browser verification (`tests/browser/verify_dummy_emails_full_variations.mjs`) on `http://localhost:3001`:
1. Logged into `alice@byos.local` with zero-knowledge key unwrap (`test-password-123`).
2. Verified 11 message rows in the Primary category tab (`Bob Stone`, `David Chen`, `Sarah Jenkins`, `Stripe Invoicing`, `Enterprise Security SLA`, etc.).
3. Switched to Newsletters tab: verified all 4 newsletters (`GitHub Security`, `Gergely Orosz`, `TLDR Tech`, `Cloudflare Radar`).
4. Opened GitHub Security Advisory: decrypted HTML content, verified code block syntax, verified inline Unsubscribe button next to `<notifications@github.com>`, verified clicking opened `UnsubscribeConfirmModal`.
5. Opened Cloudflare Radar: verified Privacy Shield banner triggered on remote tracking images and showed "Load Remote Images" button.
6. Opened Bob Stone personal 1-on-1: verified zero false positives—Unsubscribe button was NOT present.
7. Opened Calendar Invitation (`Sprint 42 Planning`): verified interactive RSVP card rendered with "BYOS Sprint 42 Planning & PQC Review", "Room 402 / Meet", and "Yes / Maybe / No" action buttons.
8. Opened Encrypted PDF attachment email: verified attachment badge rendered `Enterprise_Security_SLA_2026.pdf` (84.5 KB).
9. Verified navigation across folders: Sent (Alice's reply), Archive (HR Open Enrollment), Spam (Phishing Airdrop), Trash (Office Supplies), Drafts (Draft RFC).

Screenshots saved to repository:
- `tests/browser/artifacts/dummy_emails_01_inbox_overview.png`
- `tests/browser/artifacts/dummy_emails_02_newsletters_tab.png`
- `tests/browser/artifacts/dummy_emails_03_unsubscribe_modal.png`
- `tests/browser/artifacts/dummy_emails_04_privacy_shield_banner.png`
- `tests/browser/artifacts/dummy_emails_05_personal_no_unsub.png`
- `tests/browser/artifacts/dummy_emails_06_calendar_rsvp_card.png`
- `tests/browser/artifacts/dummy_emails_07_pdf_attachment.png`
- `tests/browser/artifacts/dummy_emails_08_sent_folder.png`
- `tests/browser/artifacts/dummy_emails_09_archive_folder.png`
- `tests/browser/artifacts/dummy_emails_10_spam_folder.png`
- `tests/browser/artifacts/dummy_emails_11_trash_folder.png`
- `tests/browser/artifacts/dummy_emails_12_drafts_folder.png`

## What did not work or is untested
- Live outbound transmission of unsubscribe requests over external SMTP/HTTP was not performed against external third parties (seeded with sandbox safe mock endpoints).

## Test suite output
Command: `npm test --prefix apps/webmail`
Output:
```
> test
> npx tsx --experimental-wasm-modules src/run_test.node.js

(node:20492) ExperimentalWarning: Importing WebAssembly modules is an experimental feature and might change at any time
Running Attachment Crypto Tests...
ATTACHMENT CRYPTO TESTS: 20 passed, 0 failed
Running TOTP Tests...
TOTP TESTS: 5 passed, 0 failed
Running Date Time Tests...
DATE TIME TESTS: 10 passed, 0 failed
Running File Type Tests...
FILE TYPE TESTS: 10 passed, 0 failed
Running Multi-Account & Storage Sync Tests...
MULTI-ACCOUNT & STORAGE SYNC TESTS: 37 passed, 0 failed
Running Password Rewrap Tests...
PASSWORD REWRAP TESTS: 10 passed, 0 failed
Running Path A Compose Tests...
PATH A COMPOSE TESTS: 10 passed, 0 failed
Running Path A Read Tests...
PATH A READ TESTS: 10 passed, 0 failed
Running Mime Tests...
MIME TESTS: 10 passed, 0 failed
Running Signature Tests...
SIGNATURE TESTS: 5 passed, 0 failed
Running Reply Signature Tests...
REPLY SIGNATURE TESTS: 6 passed, 0 failed
Running Mbox Stream Tests...
MBOX STREAM TESTS: 5 passed, 0 failed
Running Mbox Labels Tests...
MBOX LABELS TESTS: 5 passed, 0 failed
Running Import Queue Tests...
IMPORT QUEUE TESTS: 4 passed, 0 failed
Running Threading Tests...
THREADING TESTS: 11 passed, 0 failed
Running Undo Send Tests...
UNDO SEND TESTS: 5 passed, 0 failed
Running Keyboard Shortcuts Tests...
KEYBOARD SHORTCUTS TESTS: 7 passed, 0 failed
Running Snooze Tests...
SNOOZE TESTS: 8 passed, 0 failed
Running Scheduled Folder Tests...
SCHEDULED FOLDER TESTS: 17 passed, 0 failed
Running Display Party Tests...
DISPLAY PARTY TESTS: 18 passed, 0 failed
Running Nested Labels Tests...
NESTED LABELS TESTS: 22 passed, 0 failed
Running Api Error Tests...
API ERROR TESTS: 10 passed, 0 failed
Running Unified Inbox Tests...
UNIFIED INBOX TESTS: 15 passed, 0 failed
Running Masked Email Tests...
MASKED EMAIL TESTS: 14 passed, 0 failed
Running Focused Inbox Tests...
FOCUSED INBOX TESTS: 13 passed, 0 failed
Running Offline Tests...
OFFLINE TESTS: 14 passed, 0 failed
Running Composer Sanitizer Tests...
COMPOSER SANITIZER TESTS: 26 passed, 0 failed
Running Contacts Tests...
CONTACTS TESTS: 8 passed, 0 failed
Running Sidebar Borderless Tests...
SIDEBAR BORDERLESS TESTS: 12 passed, 0 failed
Running Profile Photo Tests...
PROFILE PHOTO TESTS: 8 passed, 0 failed
Running Persistent Session Tests...
PERSISTENT SESSION TESTS: 13 passed, 0 failed
Running OAuth Import Tests...
OAUTH IMPORT TESTS: 4 passed, 0 failed
Running Calendar Rrule Tests...
CALENDAR RRULE TESTS: 13 passed, 0 failed
Running Calendar Crypto Tests...
CALENDAR CRYPTO TESTS: 6 passed, 0 failed
Running Calendar Ics Tests...
CALENDAR ICS TESTS: 10 passed, 0 failed
Running Calendar Invitation Repository Tests...
CALENDAR INVITATION REPOSITORY TESTS: 9 passed, 0 failed
Running Calendar Persistence Security Tests...
CALENDAR PERSISTENCE SECURITY TESTS: 12 passed, 0 failed
Running Calendar Recovery Tests...
CALENDAR RECOVERY TESTS: 10 passed, 0 failed
Running Historical Key Reactivation & Preflight Tests...
HISTORICAL KEY REACTIVATION TESTS: 12 passed, 0 failed
Running Calendar Recurrence Exceptions Tests...
CALENDAR RECURRENCE EXCEPTIONS TESTS: 18 passed, 0 failed
Running Calendar External Invitation Tests...
CALENDAR EXTERNAL INVITATION TESTS: 11 passed, 0 failed
Running Calendar Sharing & Multi-User Tests...
CALENDAR SHARING TESTS: 11 passed, 0 failed
Running Calendar Settings & Timezone Tests...
CALENDAR SETTINGS TESTS: 16 passed, 0 failed
Running Calendar Management Tests...
CALENDAR MANAGEMENT TESTS: 14 passed, 0 failed
Running Calendar Holiday Feed Tests...
CALENDAR HOLIDAY TESTS: 14 passed, 0 failed
Running Calendar Year View Tests...
CALENDAR YEAR VIEW TESTS: 14 passed, 0 failed
Running Calendar Category 01-03 Tests...
CALENDAR CATEGORY 01-03 TESTS: 15 passed, 0 failed
Running Calendar Category 04 Tests...
CALENDAR CATEGORY 04 TESTS: 16 passed, 0 failed
Running Calendar Category 05 Tests...
CALENDAR CATEGORY 05 TESTS: 14 passed, 0 failed
Running Calendar Category 06 Tests...
CALENDAR CATEGORY 06 TESTS: 14 passed, 0 failed
Running Calendar Category 07 Tests...
CALENDAR CATEGORY 07 TESTS: 14 passed, 0 failed
Running Calendar Category 08 Tests...
CALENDAR CATEGORY 08 TESTS: 14 passed, 0 failed
Running Calendar Category 10 Tests...
CALENDAR CATEGORY 10 TESTS: 14 passed, 0 failed
Running Calendar Category 11 Tests...
CALENDAR CATEGORY 11 TESTS: 14 passed, 0 failed
Running Calendar Category 12 Tests...
CALENDAR CATEGORY 12 TESTS: 14 passed, 0 failed
Running Calendar Category 13 Tests...
CALENDAR CATEGORY 13 TESTS: 14 passed, 0 failed
Running Calendar Category 14 Tests...
CALENDAR CATEGORY 14 TESTS: 14 passed, 0 failed
Running Google Note Feature Tests...
GOOGLE NOTE FEATURE TESTS: All 21 passed, 0 failed
Running Mailbox Unlock & 2FA Persistence Tests...
UNLOCK & 2FA PERSISTENCE TESTS: 5 passed, 0 failed
Running Track 2 & Zero-Knowledge Security Tests...
TRACK 2 & ZERO-KNOWLEDGE SECURITY TESTS: 17 passed, 0 failed
Running Calendar Track 3 Verification Tests...
CALENDAR TRACK 3 TESTS: 8 passed, 0 failed
Running Track 4: Webmail Reliability, Zero-Knowledge Media Encryption & Resilience Tests...
TRACK 4 RESILIENCE TESTS: 7 passed, 0 failed
Running Off-Thread Crypto Web Worker & Bridge Tests...
OFF-THREAD CRYPTO WEB WORKER TESTS: All passed, 0 failed
Running Subscriptions & Unsubscribe Store Tests...
SUBSCRIPTIONS & UNSUBSCRIBE STORE TESTS: 4 passed, 0 failed
Running Image Privacy Store Tests...
IMAGE PRIVACY STORE TESTS: 4 passed, 0 failed
Running KashCal Natural Language Event Parser Tests...
KASHCAL PARSER TESTS: 6 passed, 0 failed

OVERALL: 649 passed, 0 failed
```
