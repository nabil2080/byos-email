# Focused Inbox Message Categorization Report

## What was built
Implemented a zero-knowledge, client-side "Focused Inbox" categorization system in BYOS Webmail that organizes inbox emails into four distinct categories: Primary, Notifications, Newsletters, and Social. Classification operates strictly on client-decrypted RFC822 headers with zero plaintext leakage to the backend, following a strict precedence hierarchy (manual sessionStorage override > server mail rule override > pure client classifier fallback to Primary). The presentation layer features four category navigation tabs with live unread count badges, a right-click row context menu enabling instantaneous session-scoped overrides, and an Appearance settings toggle to enable or disable the categorized view in favor of a unified flat list.

## Files edited
| File | Reason |
|------|--------|
| `infra/postgres/init/050_focused_inbox_categories.sql` | Adds category_override column to message_metadata and action_category to mail_rules with check constraints. |
| `services/api/rules_eval.go` | Updates EvaluateRules signature and query to fetch and return action_category as categoryOverride. |
| `services/mail-router/rules_eval.go` | Updates mail-router EvaluateRules query and signature to evaluate and return rule category actions. |
| `services/api/rules.go` | Adds ActionCategory field validation and persistence to MailRule creation and updates. |
| `services/api/messages.go` | Adds category_override to MessageMetadataResponse struct and message selection queries. |
| `services/api/internal_delivery.go` | Evaluates mailbox rules and stores category_override in message_metadata for internal Path A messages. |
| `services/api/scheduled_path_a_delivery.go` | Evaluates mailbox rules and stores category_override in message_metadata for scheduled deliveries. |
| `services/mail-router/main.go` | Evaluates mailbox rules on inbound SMTP deliveries and persists category_override in message_metadata. |
| `services/api/rules_test.go` | Updates rule evaluation test callers and adds unit tests for category rule evaluation and metadata persistence. |
| `apps/webmail/src/focused_inbox.ts` | Implements pure client-side classifier, domain allowlists, header parsing, and session storage override helpers. |
| `apps/webmail/src/focused_inbox.test.ts` | Unit tests covering all 4 message categories, header signals, precedence order, and session overrides. |
| `apps/webmail/src/api.ts` | Adds category_override to MessageMetadata interface and action_category to MailRule. |
| `apps/webmail/src/unified_inbox.ts` | Adds category_override to DisplayMessage interface. |
| `apps/webmail/src/App.tsx` | Implements reactive category filtering, tab counts badge computation, right-click move handler, and settings sync. |
| `apps/webmail/src/components/MessageList.tsx` | Renders 4 category tabs with active state indicators and unread count badges when viewing the inbox folder. |
| `apps/webmail/src/components/MessageRow.tsx` | Adds right-click context menu with Move to Primary/Notifications/Newsletters/Social actions. |
| `apps/webmail/src/routes/settings/AppearanceTab.tsx` | Adds Focused Inbox toggle setting persisting to localStorage and dispatching update event. |
| `apps/webmail/src/routes/settings/FiltersTab.tsx` | Adds Assign category action dropdown to mail filter rule configuration UI. |
| `apps/webmail/src/run_test.node.js` | Registers focused_inbox.test.ts in webmail test runner suite. |
| `tests/browser/test_focused_inbox.mjs` | Puppeteer end-to-end verification script testing 4 tabs, Path A delivery, categorization, overrides, and toggle. |
| `smoke.ps1` | Registers test_focused_inbox.mjs in smoke suite and ensures clean seed state before each test. |

## Raw evidence

### PostgreSQL Schema Verification
Command: `docker exec byos-postgres psql -U byos -d byos -c "\d message_metadata"`
```
                                             Table "public.message_metadata"
           Column            |           Type           | Collation | Nullable |                 Default                  
-----------------------------+--------------------------+-----------+----------+------------------------------------------
 id                          | uuid                     |           | not null | gen_random_uuid()
 mailbox_id                  | uuid                     |           | not null | 
 domain_id                   | uuid                     |           | not null | 
 message_seq                 | bigint                   |           | not null | nextval('mailbox_message_seq'::regclass)
 direction                   | text                     |           | not null | 
 delivery_identity           | bytea                    |           | not null | 
 sender                      | text                     |           | not null | 
 recipients                  | text[]                   |           | not null | 
 has_attachments             | boolean                  |           | not null | false
 attachment_count            | integer                  |           | not null | 0
 storage_object_id           | text                     |           | not null | 
 content_key_hpke_wrapped    | bytea                    |           | not null | 
 mailbox_sk_version          | integer                  |           | not null | 
 encryption_version          | integer                  |           | not null | 1
 encryption_iv               | bytea                    |           | not null | 
 aad_version                 | smallint                 |           | not null | 1
 bundle_hash                 | bytea                    |           | not null | 
 received_at                 | timestamp with time zone |           | not null | now()
 sent_at                     | timestamp with time zone |           |          | 
 status                      | text                     |           | not null | 'received'::text
 folder                      | character varying(32)    |           | not null | 'inbox'::character varying
 folder_id                   | uuid                     |           |          | 
 is_read                     | boolean                  |           | not null | false
 wrapped_key_algorithm       | text                     |           | not null | 'HPKE-X25519-AES256GCM-v1'::text
 message_id                  | text                     |           |          | 
 in_reply_to                 | text                     |           |          | 
 thread_id                   | uuid                     |           | not null | gen_random_uuid()
 is_starred                  | boolean                  |           | not null | false
 snoozed_until               | timestamp with time zone |           |          | 
 size_bytes                  | bigint                   |           | not null | 0
 attachment_envelopes        | jsonb                    |           |          | '[]'::jsonb
 sender_attachment_envelopes | jsonb                    |           |          | '[]'::jsonb
 category_override           | text                     |           |          | 
Indexes:
    "message_metadata_pkey" PRIMARY KEY, btree (id)
    "idx_message_metadata_attachments" gin (attachment_envelopes) WHERE attachment_envelopes <> '[]'::jsonb
    "idx_message_metadata_folder" btree (mailbox_id, folder)
    "idx_message_metadata_folder_id" btree (mailbox_id, folder_id)
    "idx_message_metadata_identity" btree (mailbox_id, delivery_identity)
    "idx_message_metadata_inreply" btree (mailbox_id, in_reply_to) WHERE in_reply_to IS NOT NULL
    "idx_message_metadata_mailbox" btree (mailbox_id)
    "idx_message_metadata_msgid" btree (mailbox_id, message_id) WHERE message_id IS NOT NULL
    "idx_message_metadata_received" btree (mailbox_id, received_at)
    "idx_message_metadata_snoozed" btree (mailbox_id, snoozed_until) WHERE snoozed_until IS NOT NULL
    "idx_message_metadata_starred" btree (mailbox_id, is_starred) WHERE is_starred = true
    "idx_message_metadata_thread" btree (mailbox_id, thread_id)
    "message_metadata_mailbox_id_delivery_identity_key" UNIQUE CONSTRAINT, btree (mailbox_id, delivery_identity)
    "message_metadata_mailbox_id_message_seq_key" UNIQUE CONSTRAINT, btree (mailbox_id, message_seq)
Check constraints:
    "message_metadata_category_check" CHECK (category_override IS NULL OR (category_override = ANY (ARRAY['primary'::text, 'notifications'::text, 'newsletters'::text, 'social'::text])))
    "message_metadata_direction_check" CHECK (direction = ANY (ARRAY['received'::text, 'sent'::text]))
    "message_metadata_status_check" CHECK (status = ANY (ARRAY['received'::text, 'sent'::text, 'draft'::text]))
```

### TypeScript Typecheck Verification
Command: `npm run typecheck` (in `apps/webmail`)
```
> typecheck
> tsc --noEmit
```

### Webmail Pure Unit Test Suite Verification
Command: `npm test -- --run` (in `apps/webmail`)
```
Running Focused Inbox Tests...
Running Focused Inbox Classifier Tests...
  ✓ 1. TestPrimaryClassificationForDirectHumanMail
  ✓ 2. TestNewslettersClassificationHeaders
  ✓ 3. TestSocialClassificationForSocialDomains
  ✓ 4. TestNotificationsClassificationSignals
  ✓ 5. TestClassificationPrecedenceOrder
  ✓ 6. TestOverridesPrecedence
FOCUSED INBOX TESTS: 6 passed, 0 failed

OVERALL: 235 passed, 0 failed
```

### End-to-End Browser Smoke Suite Execution
Command: `& powershell -NoProfile -ExecutionPolicy Bypass -File smoke.ps1`
```
================================================================================
                            SMOKE TEST SUMMARY                                  
================================================================================
  [PASS] test_session_isolation.mjs          PASS (21s)
  [PASS] test_sidebar_restructure.mjs        PASS (12.8s)
  [PASS] test_unified_inbox_browser.mjs      PASS (32.7s)
  [PASS] test_account_switch_crypto.mjs      PASS (66.6s)
  [PASS] test_masked_email.mjs               PASS (46.3s)
  [PASS] test_alias_custom.mjs               PASS (43.2s)
  [PASS] test_compose_default_account.mjs    PASS (14.5s)
  [PASS] test_wire_integrity.mjs             PASS (82.5s)
  [PASS] test_focused_inbox.mjs              PASS (36.7s)
================================================================================

SMOKE SUITE PASSED: All 9 tests passed cleanly.
```

## Manual browser verification
Executed via Puppeteer in `tests/browser/test_focused_inbox.mjs` against live services:

1. **Real User Login:** Logged in as Alice (`alice@byos.local`) using real credentials. Observed active chip: `"alice@byos.local"`.
2. **Category Tabs Initial State:** Inspected tab elements; `Primary`, `Notifications`, `Newsletters`, and `Social` tabs render above message list with `Primary` active by default. Screenshot saved to `tests/browser/artifacts/focused_inbox_tabs.png`.
3. **Path A Inbound Delivery:** Sent 4 encrypted test messages:
   - Primary: direct mail from `bob@byos.local`
   - Newsletters: RFC822 with `List-Unsubscribe: <https://example.com/unsub>`
   - Notifications: RFC822 with `Auto-Submitted: auto-generated` and subject `Your order details #239568`
   - Social: RFC822 from `updates@linkedin.com`
4. **Client-Side Classification:** Observed 4 messages decrypted client-side and placed into designated tabs:
   - Primary: contains `Team Roadmap Planning`, isolates other categories.
   - Notifications: contains `Your order details #239568`, badge count `1`.
   - Newsletters: contains `Tech Weekly Digest Issue 92`.
   - Social: contains `Alice, you appeared in 8 searches`.
   Screenshot saved to `tests/browser/artifacts/focused_inbox_categorized.png`.
5. **Right-Click User Move:** Right-clicked newsletter row, clicked "Move to Primary" in context menu. Observed newsletter item instantly removed from Newsletters tab and moved into Primary tab. Screenshot saved to `tests/browser/artifacts/focused_inbox_override_menu.png`.
6. **Session Persistence:** Reloaded browser page. Inspected `sessionStorage` containing `byos_msg_category_override_<id> = "primary"`; newsletter remains in Primary tab.
7. **Appearance Setting Disable:** Navigated to Settings -> Appearance, toggled "Focused Inbox" OFF. Returned to Inbox and noted tabs are hidden; all 4 messages display in unified flat list. Screenshot saved to `tests/browser/artifacts/focused_inbox_disabled.png`.
8. **Appearance Setting Re-enable:** Re-toggled "Focused Inbox" ON. Returned to Inbox and noted tabs reappear with override preserved.

## Classifier Rules and Precedence Reference

### Precedence Hierarchy
1. **Manual User Override:** Stored strictly in `sessionStorage` under `byos_msg_category_override_<messageId>`. Zero leakage to server.
2. **Server Rule Override:** Stored in `message_metadata.category_override` when explicitly evaluated from a user-created mail rule action.
3. **Client-Side Classifier:** Pure function `classifyMessage` evaluated on decrypted MIME headers:
   - **Newsletters:** `List-Unsubscribe` or `List-Id` present; `Precedence: list`; `Precedence: bulk` (unless transactional sender); `Auto-Submitted: auto-generated` with local part matching `newsletter|digest|bulletin|weekly`.
   - **Social:** Sender domain matches `SOCIAL_DOMAINS` allowlist (`facebook.com`, `twitter.com`, `x.com`, `linkedin.com`, `instagram.com`, `tiktok.com`, `pinterest.com`, `reddit.com`, `youtube.com`, `mastodon.social`, `threads.net`, `discord.com`, `snapchat.com`, `tumblr.com`, `meetup.com`).
   - **Notifications:** `Auto-Submitted: auto-generated`; `Precedence: bulk` with sender local part `no-?reply|notification|alert|support|billing|receipt|invoice`; or subject containing transactional keywords (`order confirmation`, `your receipt`, `password reset`, `verify your`, `shipping`, `delivered`, `payment received`, `invoice`).
   - **Primary:** Default fallback for peer human correspondence and unmatched items.

## What did not work or is untested
- **UNTESTED:** Manual cross-tab synchronization of category overrides via broadcast channels (manual moves are currently scoped to the active browser tab's `sessionStorage` session as specified by zero-knowledge constraints). To verify across sessions, open an incognito session and confirm independent categorization.

## Test suite output

### Backend API Go Test Suite (`services/api`)
Command: `go test -v ./... -count=1`
```
=== RUN   TestListUserMailboxesReturnsAll
--- PASS: TestListUserMailboxesReturnsAll (1.44s)
=== RUN   TestConcurrentSSEConnectionsAllowed
--- PASS: TestConcurrentSSEConnectionsAllowed (1.42s)
PASS
ok  	byos.email/services/api	83.747s
```

### Backend Mail-Router Go Test Suite (`services/mail-router`)
Command: `go test -v ./... -count=1`
```
=== RUN   TestAliasRoutingRewritesRecipient
--- PASS: TestAliasRoutingRewritesRecipient (0.46s)
=== RUN   TestAliasRoutingRejectsUnknown
--- PASS: TestAliasRoutingRejectsUnknown (0.04s)
=== RUN   TestAliasRoutingRejectsDisabled
--- PASS: TestAliasRoutingRejectsDisabled (0.31s)
=== RUN   TestAliasReplyMapInserted
--- PASS: TestAliasReplyMapInserted (0.21s)
=== RUN   TestDependencyMinimums
--- PASS: TestDependencyMinimums (0.00s)
=== RUN   TestNormalizeAddress
--- PASS: TestNormalizeAddress (0.00s)
=== RUN   TestSplitAddress
--- PASS: TestSplitAddress (0.00s)
=== RUN   TestNormalizeMessageID
--- PASS: TestNormalizeMessageID (0.00s)
=== RUN   TestDeliveryIdentityDeterminism
--- PASS: TestDeliveryIdentityDeterminism (0.00s)
=== RUN   TestEnvOrDefault
--- PASS: TestEnvOrDefault (0.00s)
=== RUN   TestHealthHandler
--- PASS: TestHealthHandler (0.00s)
=== RUN   TestInboundHandlerValidation
--- PASS: TestInboundHandlerValidation (0.00s)
PASS
ok  	byos.email/services/mail-router	3.554s
```
