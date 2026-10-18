package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func createRulesTestMailbox(t *testing.T, conn *pgx.Conn) (orgID, userID, domainID, mailboxID string) {
	t.Helper()
	ctx := context.Background()
	orgID = uuid.New().String()
	domainID = uuid.New().String()
	mailboxID = uuid.New().String()
	userID = uuid.New().String()
	tag := orgID[:8]

	_, err := conn.Exec(ctx, `INSERT INTO organizations (id, name, org_recovery_pk) VALUES ($1, $2, decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'))`, orgID, "Rules Org "+tag)
	if err != nil {
		t.Fatalf("insert org: %v", err)
	}

	_, err = conn.Exec(ctx, `INSERT INTO domains (id, org_id, name, is_verified) VALUES ($1, $2, $3, true)`, domainID, orgID, "rules-"+tag+".test")
	if err != nil {
		t.Fatalf("insert domain: %v", err)
	}

	_, err = conn.Exec(ctx, `INSERT INTO users (id, org_id, email, display_name, password_hash, is_active, role) VALUES ($1, $2, $3, 'User', 'hash', true, 'member')`, userID, orgID, "user-"+tag+"@rules.test")
	if err != nil {
		t.Fatalf("insert user: %v", err)
	}

	_, err = conn.Exec(ctx, `INSERT INTO mailboxes (
		id, org_id, user_id, domain_id, local_part, mode,
		mailbox_sk_wrapped, mailbox_pk, wrapped_sk_user,
		key_epoch, signing_key_epoch, key_status, is_active
	) VALUES (
		$1, $2, $3, $4, 'inbox', 'private',
		decode('AA==', 'base64'), decode('AA==', 'base64'), 'test_wrapped_sk_user',
		1, 1, 'active', true
	)`, mailboxID, orgID, userID, domainID)
	if err != nil {
		t.Fatalf("insert mailbox: %v", err)
	}

	t.Cleanup(func() {
		ctx := context.Background()
		dsn := getValidatedTestDSN(t)
		cleanupConn, err := pgx.Connect(ctx, dsn)
		if err != nil {
			t.Errorf("cleanup connect failed: %v", err)
			return
		}
		defer cleanupConn.Close(ctx)

		if _, err := cleanupConn.Exec(ctx, "DELETE FROM mail_rules WHERE mailbox_id = $1", mailboxID); err != nil {
			t.Errorf("cleanup mail_rules failed: %v", err)
		}
		if _, err := cleanupConn.Exec(ctx, "DELETE FROM message_metadata WHERE mailbox_id = $1", mailboxID); err != nil {
			t.Errorf("cleanup message_metadata failed: %v", err)
		}
		if _, err := cleanupConn.Exec(ctx, "DELETE FROM mailboxes WHERE id = $1", mailboxID); err != nil {
			t.Errorf("cleanup mailboxes failed: %v", err)
		}
		if _, err := cleanupConn.Exec(ctx, "DELETE FROM sessions WHERE user_id = $1", userID); err != nil {
			t.Errorf("cleanup sessions failed: %v", err)
		}
		if _, err := cleanupConn.Exec(ctx, "DELETE FROM audit_log WHERE user_id = $1", userID); err != nil {
			t.Errorf("cleanup audit_log failed: %v", err)
		}
		if _, err := cleanupConn.Exec(ctx, "DELETE FROM users WHERE id = $1", userID); err != nil {
			t.Errorf("cleanup users failed: %v", err)
		}
		if _, err := cleanupConn.Exec(ctx, "DELETE FROM domains WHERE id = $1", domainID); err != nil {
			t.Errorf("cleanup domains failed: %v", err)
		}
		if _, err := cleanupConn.Exec(ctx, "DELETE FROM organizations WHERE id = $1", orgID); err != nil {
			t.Errorf("cleanup organizations failed: %v", err)
		}
	})

	return orgID, userID, domainID, mailboxID
}

func createTestSessionWithConn(t *testing.T, conn *pgx.Conn, userID string) string {
	t.Helper()
	token, tokenHash := generateSessionToken()
	expires := time.Now().Add(30 * 24 * time.Hour)
	_, err := conn.Exec(context.Background(), `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`, userID, tokenHash, expires)
	if err != nil {
		t.Fatalf("failed to create session: %v", err)
	}
	return token
}

// 1. TestRuleCreationAndList
func TestRuleCreationAndList(t *testing.T) {
	conn := getTestDB(t)
	defer conn.Close(context.Background())

	_, userID, _, mailboxID := createRulesTestMailbox(t, conn)
	token := createTestSessionWithConn(t, conn, userID)

	senderMatch := "spammy.com"
	createPayload := createRuleRequest{
		Name:         "Spam Filter",
		MatchSender:  &senderMatch,
		ActionType:   "move",
		ActionFolder: stringPtr("spam"),
	}
	body, _ := json.Marshal(createPayload)

	req := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mailboxID+"/rules", bytes.NewReader(body))
	req.SetPathValue("mailbox_id", mailboxID)
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: token, Path: "/"})
	w := httptest.NewRecorder()

	mailboxRulesHandler(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created, got %d: %s", w.Code, w.Body.String())
	}

	var created MailRule
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatalf("unmarshal created rule: %v", err)
	}
	if created.Name != "Spam Filter" || created.ActionType != "move" || *created.ActionFolder != "spam" {
		t.Fatalf("created rule mismatch: %+v", created)
	}

	// Now GET the rules
	getReq := httptest.NewRequest(http.MethodGet, "/v1/mailboxes/"+mailboxID+"/rules", nil)
	getReq.SetPathValue("mailbox_id", mailboxID)
	getReq.AddCookie(&http.Cookie{Name: "byos_session", Value: token, Path: "/"})
	getW := httptest.NewRecorder()

	mailboxRulesHandler(getW, getReq)
	if getW.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", getW.Code, getW.Body.String())
	}

	var rules []MailRule
	if err := json.Unmarshal(getW.Body.Bytes(), &rules); err != nil {
		t.Fatalf("unmarshal rules list: %v", err)
	}
	if len(rules) != 1 || rules[0].ID != created.ID {
		t.Fatalf("expected 1 rule with ID %s, got %d rules", created.ID, len(rules))
	}
}

// 2. TestRuleEvaluatesSenderMatch
func TestRuleEvaluatesSenderMatch(t *testing.T) {
	conn := getTestDB(t)
	defer conn.Close(context.Background())
	ctx := context.Background()

	_, _, _, mailboxID := createRulesTestMailbox(t, conn)

	_, err := conn.Exec(ctx, `
		INSERT INTO mail_rules (mailbox_id, name, enabled, priority, match_sender, action_type, action_folder)
		VALUES ($1, 'Sender Alert', true, 0, 'alerts.domain.com', 'move', 'archive')
	`, mailboxID)
	if err != nil {
		t.Fatalf("insert rule: %v", err)
	}

	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatalf("begin tx: %v", err)
	}
	defer tx.Rollback(ctx)

	// Matching sender
	folder, _, _, _, _, err := EvaluateRules(ctx, tx, mailboxID, "bot@alerts.domain.com", []string{"user@test.local"}, 500, false)
	if err != nil {
		t.Fatalf("EvaluateRules: %v", err)
	}
	if folder != "archive" {
		t.Fatalf("expected folder 'archive', got %q", folder)
	}

	// Non-matching sender
	folder, _, _, _, _, err = EvaluateRules(ctx, tx, mailboxID, "other@domain.com", []string{"user@test.local"}, 500, false)
	if err != nil {
		t.Fatalf("EvaluateRules: %v", err)
	}
	if folder != "" {
		t.Fatalf("expected no match (empty folder), got %q", folder)
	}
}

// 3. TestRuleEvaluatesRecipientMatch
func TestRuleEvaluatesRecipientMatch(t *testing.T) {
	conn := getTestDB(t)
	defer conn.Close(context.Background())
	ctx := context.Background()

	_, _, _, mailboxID := createRulesTestMailbox(t, conn)

	_, err := conn.Exec(ctx, `
		INSERT INTO mail_rules (mailbox_id, name, enabled, priority, match_recipient, action_type)
		VALUES ($1, 'Billing Read', true, 0, 'billing@', 'mark_read')
	`, mailboxID)
	if err != nil {
		t.Fatalf("insert rule: %v", err)
	}

	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatalf("begin tx: %v", err)
	}
	defer tx.Rollback(ctx)

	// Matching recipient
	_, _, markRead, _, _, err := EvaluateRules(ctx, tx, mailboxID, "vendor@test.com", []string{"billing@company.com"}, 500, false)
	if err != nil {
		t.Fatalf("EvaluateRules: %v", err)
	}
	if !markRead {
		t.Fatalf("expected markRead true, got false")
	}

	// Non-matching recipient
	_, _, markRead, _, _, err = EvaluateRules(ctx, tx, mailboxID, "vendor@test.com", []string{"support@company.com"}, 500, false)
	if err != nil {
		t.Fatalf("EvaluateRules: %v", err)
	}
	if markRead {
		t.Fatalf("expected markRead false, got true")
	}
}

// 4. TestRuleEvaluatesAttachments
func TestRuleEvaluatesAttachments(t *testing.T) {
	conn := getTestDB(t)
	defer conn.Close(context.Background())
	ctx := context.Background()

	_, _, _, mailboxID := createRulesTestMailbox(t, conn)

	_, err := conn.Exec(ctx, `
		INSERT INTO mail_rules (mailbox_id, name, enabled, priority, match_has_attachments, action_type, action_folder)
		VALUES ($1, 'Attachment Rule', true, 0, true, 'move', 'documents')
	`, mailboxID)
	if err != nil {
		t.Fatalf("insert rule: %v", err)
	}

	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatalf("begin tx: %v", err)
	}
	defer tx.Rollback(ctx)

	// Has attachments
	folder, _, _, _, _, err := EvaluateRules(ctx, tx, mailboxID, "s@test.com", []string{"r@test.com"}, 500, true)
	if err != nil {
		t.Fatalf("EvaluateRules: %v", err)
	}
	if folder != "documents" {
		t.Fatalf("expected folder 'documents', got %q", folder)
	}

	// No attachments
	folder, _, _, _, _, err = EvaluateRules(ctx, tx, mailboxID, "s@test.com", []string{"r@test.com"}, 500, false)
	if err != nil {
		t.Fatalf("EvaluateRules: %v", err)
	}
	if folder != "" {
		t.Fatalf("expected empty folder, got %q", folder)
	}
}

// 5. TestRuleEvaluatesMinSize
func TestRuleEvaluatesMinSize(t *testing.T) {
	conn := getTestDB(t)
	defer conn.Close(context.Background())
	ctx := context.Background()

	_, _, _, mailboxID := createRulesTestMailbox(t, conn)

	_, err := conn.Exec(ctx, `
		INSERT INTO mail_rules (mailbox_id, name, enabled, priority, match_min_size_bytes, action_type, action_folder)
		VALUES ($1, 'Large Rule', true, 0, 102400, 'move', 'large_mail')
	`, mailboxID)
	if err != nil {
		t.Fatalf("insert rule: %v", err)
	}

	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatalf("begin tx: %v", err)
	}
	defer tx.Rollback(ctx)

	// Size >= 102400
	folder, _, _, _, _, err := EvaluateRules(ctx, tx, mailboxID, "s@test.com", []string{"r@test.com"}, 150000, false)
	if err != nil {
		t.Fatalf("EvaluateRules: %v", err)
	}
	if folder != "large_mail" {
		t.Fatalf("expected folder 'large_mail', got %q", folder)
	}

	// Size < 102400
	folder, _, _, _, _, err = EvaluateRules(ctx, tx, mailboxID, "s@test.com", []string{"r@test.com"}, 50000, false)
	if err != nil {
		t.Fatalf("EvaluateRules: %v", err)
	}
	if folder != "" {
		t.Fatalf("expected empty folder, got %q", folder)
	}
}

// 6. TestRuleFirstMatchWins
func TestRuleFirstMatchWins(t *testing.T) {
	conn := getTestDB(t)
	defer conn.Close(context.Background())
	ctx := context.Background()

	_, _, _, mailboxID := createRulesTestMailbox(t, conn)

	// Priority 1: move to spam
	_, err := conn.Exec(ctx, `
		INSERT INTO mail_rules (mailbox_id, name, enabled, priority, match_sender, action_type, action_folder)
		VALUES ($1, 'Spam Rule', true, 1, 'promo', 'move', 'spam')
	`, mailboxID)
	if err != nil {
		t.Fatalf("insert rule 1: %v", err)
	}

	// Priority 2: move to archive
	_, err = conn.Exec(ctx, `
		INSERT INTO mail_rules (mailbox_id, name, enabled, priority, match_sender, action_type, action_folder)
		VALUES ($1, 'Archive Rule', true, 2, 'promo', 'move', 'archive')
	`, mailboxID)
	if err != nil {
		t.Fatalf("insert rule 2: %v", err)
	}

	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatalf("begin tx: %v", err)
	}
	defer tx.Rollback(ctx)

	folder, _, _, _, _, err := EvaluateRules(ctx, tx, mailboxID, "promo@newsletter.com", []string{"r@test.com"}, 500, false)
	if err != nil {
		t.Fatalf("EvaluateRules: %v", err)
	}
	if folder != "spam" {
		t.Fatalf("expected first matching rule (priority 1) to win with 'spam', got %q", folder)
	}
}

// 7. TestRuleOwnershipEnforced
func TestRuleOwnershipEnforced(t *testing.T) {
	conn := getTestDB(t)
	defer conn.Close(context.Background())

	_, _, _, mailbox1ID := createRulesTestMailbox(t, conn)
	_, user2ID, _, _ := createRulesTestMailbox(t, conn)
	token2 := createTestSessionWithConn(t, conn, user2ID)

	// User 2 trying to GET mailbox 1 rules
	req := httptest.NewRequest(http.MethodGet, "/v1/mailboxes/"+mailbox1ID+"/rules", nil)
	req.SetPathValue("mailbox_id", mailbox1ID)
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: token2, Path: "/"})
	w := httptest.NewRecorder()

	mailboxRulesHandler(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for cross-user GET, got %d: %s", w.Code, w.Body.String())
	}

	// User 2 trying to POST to mailbox 1 rules
	postBody, _ := json.Marshal(createRuleRequest{
		Name:         "Hacked Rule",
		ActionType:   "move",
		ActionFolder: stringPtr("spam"),
	})
	postReq := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mailbox1ID+"/rules", bytes.NewReader(postBody))
	postReq.SetPathValue("mailbox_id", mailbox1ID)
	postReq.AddCookie(&http.Cookie{Name: "byos_session", Value: token2, Path: "/"})
	postW := httptest.NewRecorder()

	mailboxRulesHandler(postW, postReq)
	if postW.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for cross-user POST, got %d: %s", postW.Code, postW.Body.String())
	}
}

// 8. TestRuleDisabledSkipped
func TestRuleDisabledSkipped(t *testing.T) {
	conn := getTestDB(t)
	defer conn.Close(context.Background())
	ctx := context.Background()

	_, _, _, mailboxID := createRulesTestMailbox(t, conn)

	// Insert disabled rule
	_, err := conn.Exec(ctx, `
		INSERT INTO mail_rules (mailbox_id, name, enabled, priority, match_sender, action_type, action_folder)
		VALUES ($1, 'Disabled Rule', false, 0, 'badguy.com', 'delete', 'trash')
	`, mailboxID)
	if err != nil {
		t.Fatalf("insert rule: %v", err)
	}

	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatalf("begin tx: %v", err)
	}
	defer tx.Rollback(ctx)

	folder, _, _, deleteMsg, _, err := EvaluateRules(ctx, tx, mailboxID, "hacker@badguy.com", []string{"r@test.com"}, 500, false)
	if err != nil {
		t.Fatalf("EvaluateRules: %v", err)
	}
	if deleteMsg {
		t.Fatalf("expected deleteMsg false for disabled rule, got true")
	}
	if folder != "" {
		t.Fatalf("expected empty folder for disabled rule, got %q", folder)
	}
}

// 9. TestMessageMetadataCategoryOverridePersists
func TestMessageMetadataCategoryOverridePersists(t *testing.T) {
	conn := getTestDB(t)
	defer conn.Close(context.Background())
	ctx := context.Background()

	_, userID, domainID, mailboxID := createRulesTestMailbox(t, conn)
	token := createTestSessionWithConn(t, conn, userID)

	msgID := uuid.New().String()
	deliveryID := uuid.New().String()
	_, err := conn.Exec(ctx, `
		INSERT INTO message_metadata (
			id, mailbox_id, domain_id, direction, delivery_identity, sender, recipients,
			storage_object_id, content_key_hpke_wrapped, mailbox_sk_version,
			encryption_version, encryption_iv, aad_version, bundle_hash,
			status, folder, is_read, category_override, sent_at, received_at
		) VALUES (
			$1, $2, $3, 'received', $4, 'newsletter@example.com', ARRAY['alice@byos.local'],
			'storage/obj', decode('AA==', 'base64'), 1,
			1, decode('AA==', 'base64'), 1, decode('AA==', 'base64'),
			'received', 'inbox', false, 'newsletters', now(), now()
		)
	`, msgID, mailboxID, domainID, []byte(deliveryID))
	if err != nil {
		t.Fatalf("insert message: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/v1/mailboxes/"+mailboxID+"/messages", nil)
	req.SetPathValue("mailbox_id", mailboxID)
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: token, Path: "/"})

	w := httptest.NewRecorder()
	messagesHandler(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Messages []MessageMetadataResponse `json:"messages"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if len(resp.Messages) != 1 {
		t.Fatalf("expected 1 message, got %d", len(resp.Messages))
	}
	if resp.Messages[0].CategoryOverride == nil || *resp.Messages[0].CategoryOverride != "newsletters" {
		t.Fatalf("expected category_override 'newsletters', got %+v", resp.Messages[0].CategoryOverride)
	}
}

// 10. TestRuleAssignsCategory
func TestRuleAssignsCategory(t *testing.T) {
	conn := getTestDB(t)
	defer conn.Close(context.Background())
	ctx := context.Background()

	_, userID, _, mailboxID := createRulesTestMailbox(t, conn)
	token := createTestSessionWithConn(t, conn, userID)

	sender := "digest@daily.com"
	category := "newsletters"
	createPayload := createRuleRequest{
		Name:           "Daily Digest Newsletter",
		MatchSender:    &sender,
		ActionType:     "category",
		ActionCategory: &category,
	}
	body, _ := json.Marshal(createPayload)

	req := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mailboxID+"/rules", bytes.NewReader(body))
	req.SetPathValue("mailbox_id", mailboxID)
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: token, Path: "/"})
	w := httptest.NewRecorder()

	mailboxRulesHandler(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created, got %d: %s", w.Code, w.Body.String())
	}

	var created MailRule
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatalf("unmarshal rule: %v", err)
	}
	if created.ActionType != "category" || created.ActionCategory == nil || *created.ActionCategory != "newsletters" {
		t.Fatalf("expected action_category newsletters, got %+v", created)
	}

	// Test EvaluateRules with matching sender
	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatalf("begin tx: %v", err)
	}
	defer tx.Rollback(ctx)

	folder, labels, markRead, deleteMsg, catOverride, err := EvaluateRules(ctx, tx, mailboxID, "digest@daily.com", []string{"user@test.local"}, 500, false)
	if err != nil {
		t.Fatalf("EvaluateRules: %v", err)
	}
	if catOverride != "newsletters" {
		t.Fatalf("expected category override 'newsletters', got %q", catOverride)
	}
	if folder != "" || len(labels) != 0 || markRead || deleteMsg {
		t.Fatalf("expected only category action, got folder=%q markRead=%v deleteMsg=%v", folder, markRead, deleteMsg)
	}
}

func stringPtr(s string) *string {
	return &s
}
