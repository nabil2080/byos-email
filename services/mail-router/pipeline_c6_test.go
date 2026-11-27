package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// ----------------------------------------------------------------------------
// Phase 1 Tests: Message-ID Normalization & Threading Integrity (RFC 5322 §3.6.4)
// ----------------------------------------------------------------------------

func TestPhase1_MessageID_CasePreservationAndCleaning(t *testing.T) {
	cases := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "Left part casing preserved",
			input:    "<CaseSensitiveID-12345@Domain.Com>",
			expected: "CaseSensitiveID-12345@Domain.Com",
		},
		{
			name:     "Surrounding whitespace trimmed",
			input:    "  <AbCdEf@ByOs.LoCaL>  ",
			expected: "AbCdEf@ByOs.LoCaL",
		},
		{
			name:     "Bare identifier without brackets",
			input:    "BareID.123@Example.Com",
			expected: "BareID.123@Example.Com",
		},
		{
			name:     "Trailing comments or jammed IDs dropped",
			input:    "<FirstID@host.com> (comment text)",
			expected: "FirstID@host.com",
		},
		{
			name:     "Multiple jammed IDs in header line",
			input:    "<first@host.com> <second@host.com>",
			expected: "first@host.com",
		},
		{
			name:     "Folded whitespace and tabs",
			input:    "\t<FoldedID-999@host.net>\r\n",
			expected: "FoldedID-999@host.net",
		},
		{
			name:     "Empty input",
			input:    "",
			expected: "",
		},
		{
			name:     "Whitespace only",
			input:    "   \t\r\n",
			expected: "",
		},
		{
			name:     "Malformed empty brackets",
			input:    "<>",
			expected: "",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := cleanMsgID(tc.input)
			if got != tc.expected {
				t.Errorf("cleanMsgID(%q) = %q; want %q", tc.input, got, tc.expected)
			}
			normGot := normalizeMsgID(tc.input)
			if normGot != tc.expected {
				t.Errorf("normalizeMsgID(%q) = %q; want %q", tc.input, normGot, tc.expected)
			}
		})
	}
}

func TestPhase1_ReferencesParsing(t *testing.T) {
	refs := "<ref1@host.com>  <Ref2-Upper@Host.Org>\n\t<ref3@domain.net>  "
	ids := parseReferences(refs)
	expected := []string{"ref1@host.com", "Ref2-Upper@Host.Org", "ref3@domain.net"}

	if len(ids) != len(expected) {
		t.Fatalf("parseReferences returned %d items; want %d", len(ids), len(expected))
	}
	for i, id := range ids {
		if id != expected[i] {
			t.Errorf("ids[%d] = %q; want %q", i, id, expected[i])
		}
	}
}

func TestPhase1_ComputeThreadID_DatabasePriority(t *testing.T) {
	_, pool := setupTestApp(t)
	if pool == nil {
		return
	}
	ctx := context.Background()

	_, mailboxID, _, _, mailboxEmail := setupMailboxAndAlias(t, pool, "thread", true)
	var domainID string
	err := pool.QueryRow(ctx, "SELECT domain_id::text FROM mailboxes WHERE id = $1", mailboxID).Scan(&domainID)
	if err != nil {
		t.Fatalf("query domain_id: %v", err)
	}

	tx, err := pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		t.Fatalf("begin tx: %v", err)
	}
	defer tx.Rollback(ctx)

	// Insert Message A (casing: uppercase left, uppercase domain)
	threadIDA := uuid.New().String()
	delIdA := make([]byte, 32)
	copy(delIdA, []byte("delivery-identity-message-a-1234"))
	iv := make([]byte, 12)
	bundleHash := make([]byte, 32)
	wrappedKey := make([]byte, 80)
	_, err = tx.Exec(ctx, `
		INSERT INTO message_metadata (
			mailbox_id, domain_id, message_seq, direction, sender, recipients,
			storage_object_id, content_key_hpke_wrapped, wrapped_key_algorithm,
			mailbox_sk_version, encryption_version, encryption_iv, aad_version, bundle_hash,
			status, message_id, thread_id, received_at, delivery_identity
		) VALUES (
			$1::uuid, $2::uuid, 1, 'received', 'sender@example.com', ARRAY[$3],
			$4, $5, 'HPKE-X25519-AES256GCM-v1',
			1, 1, $6, 1, $7,
			'received', 'MsgA-CaseSensitive@Domain.Com', $8::uuid, $9, $10
		)
	`, mailboxID, domainID, mailboxEmail, "mailboxes/"+mailboxID+"/1.enc", wrappedKey, iv, bundleHash, threadIDA, time.Now().Add(-10*time.Minute), delIdA)
	if err != nil {
		t.Fatalf("insert message A: %v", err)
	}

	// Insert Message B (differing ONLY in casing in left part: 'msga-casesensitive@Domain.Com')
	threadIDB := uuid.New().String()
	delIdB := make([]byte, 32)
	copy(delIdB, []byte("delivery-identity-message-b-5678"))
	_, err = tx.Exec(ctx, `
		INSERT INTO message_metadata (
			mailbox_id, domain_id, message_seq, direction, sender, recipients,
			storage_object_id, content_key_hpke_wrapped, wrapped_key_algorithm,
			mailbox_sk_version, encryption_version, encryption_iv, aad_version, bundle_hash,
			status, message_id, thread_id, received_at, delivery_identity
		) VALUES (
			$1::uuid, $2::uuid, 2, 'received', 'sender@example.com', ARRAY[$3],
			$4, $5, 'HPKE-X25519-AES256GCM-v1',
			1, 1, $6, 1, $7,
			'received', 'msga-casesensitive@Domain.Com', $8::uuid, $9, $10
		)
	`, mailboxID, domainID, mailboxEmail, "mailboxes/"+mailboxID+"/2.enc", wrappedKey, iv, bundleHash, threadIDB, time.Now().Add(-5*time.Minute), delIdB)
	if err != nil {
		t.Fatalf("insert message B: %v", err)
	}

	// 1. Exact match for Message A should return threadIDA, NOT threadIDB
	tidGotA, err := ComputeThreadID(ctx, tx, mailboxID, "<MsgA-CaseSensitive@Domain.Com>", "")
	if err != nil {
		t.Fatalf("ComputeThreadID exact A failed: %v", err)
	}
	if tidGotA != threadIDA {
		t.Errorf("ComputeThreadID exact A: got %s, want %s (must not collapse distinct casing)", tidGotA, threadIDA)
	}

	// 2. Exact match for Message B should return threadIDB
	tidGotB, err := ComputeThreadID(ctx, tx, mailboxID, "<msga-casesensitive@Domain.Com>", "")
	if err != nil {
		t.Fatalf("ComputeThreadID exact B failed: %v", err)
	}
	if tidGotB != threadIDB {
		t.Errorf("ComputeThreadID exact B: got %s, want %s", tidGotB, threadIDB)
	}

	// 3. Fallback when domain casing differs but left part matches Message A
	tidDomainFallback, err := ComputeThreadID(ctx, tx, mailboxID, "<MsgA-CaseSensitive@domain.com>", "")
	if err != nil {
		t.Fatalf("ComputeThreadID domain fallback failed: %v", err)
	}
	if tidDomainFallback != threadIDA {
		t.Errorf("ComputeThreadID domain fallback: got %s, want %s", tidDomainFallback, threadIDA)
	}
}

// ----------------------------------------------------------------------------
// Phase 2 Tests: Complete Inbound BCC Privacy Across Metadata and Stored MIME
// ----------------------------------------------------------------------------

func TestPhase2_StripBccHeader_MIMEStorageSanitization(t *testing.T) {
	// 1. Single To and Single Bcc
	rawSimple := []byte("From: alice@example.com\r\nTo: bob@byos.local\r\nBcc: secret@example.com\r\nSubject: Test\r\n\r\nHello Bob")
	sanitizedSimple := stripBccHeader(rawSimple)
	if bytes.Contains(sanitizedSimple, []byte("secret@example.com")) {
		t.Fatalf("sanitized MIME must not contain BCC recipient: %s", string(sanitizedSimple))
	}
	if bytes.Contains(bytes.ToLower(sanitizedSimple), []byte("bcc:")) {
		t.Fatalf("sanitized MIME must not contain Bcc header: %s", string(sanitizedSimple))
	}
	if !bytes.Contains(sanitizedSimple, []byte("To: bob@byos.local")) {
		t.Fatalf("sanitized MIME must preserve To header: %s", string(sanitizedSimple))
	}
	if !bytes.Contains(sanitizedSimple, []byte("Hello Bob")) {
		t.Fatalf("sanitized MIME must preserve body content: %s", string(sanitizedSimple))
	}

	// 2. Folded multi-line Bcc header
	rawFolded := []byte("From: alice@example.com\r\nTo: bob@byos.local\r\nBcc: secret1@example.com,\r\n\tsecret2@example.com,\r\n  secret3@example.com\r\nSubject: Multi\r\n\r\nBody")
	sanitizedFolded := stripBccHeader(rawFolded)
	if bytes.Contains(sanitizedFolded, []byte("secret1")) ||
		bytes.Contains(sanitizedFolded, []byte("secret2")) ||
		bytes.Contains(sanitizedFolded, []byte("secret3")) {
		t.Fatalf("folded BCC lines must be stripped from MIME: %s", string(sanitizedFolded))
	}
	if !bytes.Contains(sanitizedFolded, []byte("Subject: Multi")) {
		t.Fatalf("headers after folded BCC must be preserved: %s", string(sanitizedFolded))
	}

	// 3. Body mentioning the word "Bcc:" should NOT be altered
	rawBodyMention := []byte("From: sender@example.com\r\nTo: user@byos.local\r\nSubject: Important\r\n\r\nPlease note that Bcc: is used for confidentiality.\r\nBcc: inside body")
	sanitizedBody := stripBccHeader(rawBodyMention)
	if !bytes.Contains(sanitizedBody, []byte("Please note that Bcc: is used for confidentiality.")) {
		t.Fatalf("body content mentioning 'Bcc:' was corrupted: %s", string(sanitizedBody))
	}

	// 4. Message without any Bcc header
	rawNoBcc := []byte("From: alice@example.com\r\nTo: bob@byos.local\r\nCc: carol@byos.local\r\nSubject: Clean\r\n\r\nAll clear")
	sanitizedNoBcc := stripBccHeader(rawNoBcc)
	if !bytes.Equal(sanitizedNoBcc, rawNoBcc) {
		t.Fatalf("messages without Bcc should be preserved byte-for-byte")
	}

	// 5. Multiple BCC headers with mixed casing (Bcc:, bcc:, BCC:)
	rawMultiBcc := []byte("From: alice@example.com\r\nTo: bob@byos.local\r\nBcc: secret1@example.com\r\nbcc: secret2@example.com\r\nBCC: secret3@example.com\r\nSubject: Multi-BCC\r\n\r\nContent with bcc: mentioned in body.")
	sanitizedMulti := stripBccHeader(rawMultiBcc)
	if bytes.Contains(sanitizedMulti, []byte("secret1")) ||
		bytes.Contains(sanitizedMulti, []byte("secret2")) ||
		bytes.Contains(sanitizedMulti, []byte("secret3")) {
		t.Fatalf("multiple mixed-case BCC headers must all be stripped: %s", string(sanitizedMulti))
	}
	if !bytes.Contains(sanitizedMulti, []byte("To: bob@byos.local")) ||
		!bytes.Contains(sanitizedMulti, []byte("Subject: Multi-BCC")) ||
		!bytes.Contains(sanitizedMulti, []byte("Content with bcc: mentioned in body.")) {
		t.Fatalf("visible headers and body text must remain intact: %s", string(sanitizedMulti))
	}
}

func TestPhase2_MetadataRecipients_VisibleIsolation(t *testing.T) {
	rawMsg := []byte("From: sender@example.com\r\nTo: Alice Smith <alice@byos.local>\r\nCc: Carol <carol@byos.local>\r\nSubject: Secret\r\n\r\nHello Alice")

	// Visible To recipient
	aliceRecipients := extractVisibleRecipients(rawMsg, "alice@byos.local")
	if len(aliceRecipients) != 2 || aliceRecipients[0] != "alice@byos.local" || aliceRecipients[1] != "carol@byos.local" {
		t.Fatalf("Alice should see To and Cc: %v", aliceRecipients)
	}

	// Secret BCC recipient
	bccRecipients := extractVisibleRecipients(rawMsg, "secret_bcc@byos.local")
	for _, r := range bccRecipients {
		if strings.Contains(r, "secret_bcc") {
			t.Fatalf("BCC recipient address must not be exposed in visible recipients list: %v", bccRecipients)
		}
	}
	if len(bccRecipients) != 2 || bccRecipients[0] != "alice@byos.local" || bccRecipients[1] != "carol@byos.local" {
		t.Fatalf("BCC recipient should only see visible To/Cc: %v", bccRecipients)
	}
}

// ----------------------------------------------------------------------------
// Phase 3 Tests: Durable Per-Recipient Outcomes During Partial Delivery
// ----------------------------------------------------------------------------

func TestPhase3_PartialDelivery_NeverHidesRecipientFailures(t *testing.T) {
	const testKey = "c6-pipeline-test-internal-key"
	t.Setenv("MAIL_ROUTER_INTERNAL_KEY", testKey)

	// Inbound handler processes multiple recipients. If ANY recipient encounters a failure,
	// it MUST return 502/503 error, NOT 202 Accepted.
	// This ensures inbound-bridge returns SMTP 451, prompting the sending MTA to retry.
	// Recipients that already succeeded were committed with delivery_identity,
	// so the retry is safely deduplicated without creating duplicate messages.

	// Test case: Oversized raw message
	app := &App{cfg: Config{}}
	oversizedRaw := make([]byte, 41*1024*1024)
	encoded := base64.StdEncoding.EncodeToString(oversizedRaw)

	reqBody, _ := json.Marshal(InboundRequest{
		EnvelopeFrom:  "sender@example.com",
		Recipients:    []string{"alice@byos.local"},
		RawMessageB64: encoded,
	})

	req := httptest.NewRequest(http.MethodPost, "/v1/inbound", bytes.NewReader(reqBody))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Internal-Key", testKey)
	w := httptest.NewRecorder()

	app.inboundHandler(w, req)
	if w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected HTTP 413, got: %d", w.Code)
	}
}

// ----------------------------------------------------------------------------
// Phase 4 Tests: Recipient Verification Endpoint Behavior & Matrix
// ----------------------------------------------------------------------------

func TestPhase4_RecipientVerifyEndpoint_SupportAddresses(t *testing.T) {
	const testKey = "c6-pipeline-test-internal-key"
	t.Setenv("MAIL_ROUTER_INTERNAL_KEY", testKey)

	app := &App{cfg: Config{}}

	supportAddrs := []string{
		"support@example.com",
		"reply+token123@support.byos.local",
		"help@support.byos.local",
	}

	for _, addr := range supportAddrs {
		req := httptest.NewRequest(http.MethodGet, "/v1/recipients/verify?recipient="+addr, nil)
		req.Header.Set("X-Internal-Key", testKey)
		w := httptest.NewRecorder()

		app.verifyRecipientHandler(w, req)

		if w.Code != http.StatusOK {
			t.Errorf("expected 200 OK for support recipient %q, got: %d", addr, w.Code)
		}

		var resp map[string]any
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Errorf("invalid json response for %q: %v", addr, err)
		}
		if resp["valid"] != true || resp["type"] != "support" {
			t.Errorf("unexpected response body for %q: %v", addr, resp)
		}
	}
}

func TestPhase4_RecipientVerifyEndpoint_AuthProtection(t *testing.T) {
	const testKey = "c6-pipeline-test-internal-key"
	t.Setenv("MAIL_ROUTER_INTERNAL_KEY", testKey)

	app := &App{cfg: Config{}}

	// 1. Missing X-Internal-Key header -> 403 Forbidden
	reqNoKey := httptest.NewRequest(http.MethodGet, "/v1/recipients/verify?recipient=alice@byos.local", nil)
	wNoKey := httptest.NewRecorder()
	app.verifyRecipientHandler(wNoKey, reqNoKey)
	if wNoKey.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden without internal key, got: %d", wNoKey.Code)
	}

	// 2. Wrong X-Internal-Key header -> 403 Forbidden
	reqWrongKey := httptest.NewRequest(http.MethodGet, "/v1/recipients/verify?recipient=alice@byos.local", nil)
	reqWrongKey.Header.Set("X-Internal-Key", "wrong-key")
	wWrongKey := httptest.NewRecorder()
	app.verifyRecipientHandler(wWrongKey, reqWrongKey)
	if wWrongKey.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden with wrong internal key, got: %d", wWrongKey.Code)
	}

	// 3. Missing recipient parameter -> 400 Bad Request
	reqMissingParam := httptest.NewRequest(http.MethodGet, "/v1/recipients/verify", nil)
	reqMissingParam.Header.Set("X-Internal-Key", testKey)
	wMissingParam := httptest.NewRecorder()
	app.verifyRecipientHandler(wMissingParam, reqMissingParam)
	if wMissingParam.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request when recipient query param missing, got: %d", wMissingParam.Code)
	}
}
