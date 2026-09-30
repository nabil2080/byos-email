package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestScheduledFolderQuery(t *testing.T) {
	conn := getTestDB(t)
	defer conn.Close(context.Background())
	ctx := context.Background()

	orgID, userID, domainID, mailboxID := createThreadingTestMailbox(t, conn)
	_ = orgID
	_ = domainID

	token, tokenHash := generateSessionToken()
	_, err := conn.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
		userID, tokenHash, time.Now().Add(24*time.Hour))
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	// 1. Pending future scheduled message (should appear in scheduled folder)
	idFuture1 := uuid.New().String()
	rcpt1 := "future1@test.local"
	futureTime1 := time.Now().Add(1 * time.Hour)
	_, err = conn.Exec(ctx, `
		INSERT INTO scheduled_messages (
			id, mailbox_id, domain_id, recipient, scheduled_at, status, expires_at, is_path_a, send_token_hash, envelope_json
		) VALUES (
			$1, $2, $3, $4, $5, 'pending', $6, true, decode('', 'hex'), '{"v":1}'
		)
	`, idFuture1, mailboxID, domainID, rcpt1, futureTime1, futureTime1.Add(24*time.Hour))
	if err != nil {
		t.Fatalf("insert scheduled future 1: %v", err)
	}

	// 2. Another pending future scheduled message (should appear, sorted by scheduled_at)
	idFuture2 := uuid.New().String()
	rcpt2 := "future2@test.local"
	futureTime2 := time.Now().Add(2 * time.Hour)
	_, err = conn.Exec(ctx, `
		INSERT INTO scheduled_messages (
			id, mailbox_id, domain_id, recipient, scheduled_at, status, expires_at, is_path_a, send_token_hash, envelope_json
		) VALUES (
			$1, $2, $3, $4, $5, 'pending', $6, false, decode('', 'hex'), '{"v":1}'
		)
	`, idFuture2, mailboxID, domainID, rcpt2, futureTime2, futureTime2.Add(24*time.Hour))
	if err != nil {
		t.Fatalf("insert scheduled future 2: %v", err)
	}

	// 3. Executed message (should NOT appear)
	idExecuted := uuid.New().String()
	_, err = conn.Exec(ctx, `
		INSERT INTO scheduled_messages (
			id, mailbox_id, domain_id, recipient, scheduled_at, status, expires_at, is_path_a, send_token_hash, envelope_json
		) VALUES (
			$1, $2, $3, 'exec@test.local', $4, 'executed', $5, true, decode('', 'hex'), '{"v":1}'
		)
	`, idExecuted, mailboxID, domainID, futureTime1, futureTime1.Add(24*time.Hour))
	if err != nil {
		t.Fatalf("insert scheduled executed: %v", err)
	}

	// 4. Past-due message (scheduled_at <= now() -> should NOT appear)
	idPast := uuid.New().String()
	pastTime := time.Now().Add(-1 * time.Hour)
	_, err = conn.Exec(ctx, `
		INSERT INTO scheduled_messages (
			id, mailbox_id, domain_id, recipient, scheduled_at, status, expires_at, is_path_a, send_token_hash, envelope_json
		) VALUES (
			$1, $2, $3, 'past@test.local', $4, 'pending', $5, true, decode('', 'hex'), '{"v":1}'
		)
	`, idPast, mailboxID, domainID, pastTime, time.Now().Add(24*time.Hour))
	if err != nil {
		t.Fatalf("insert scheduled past: %v", err)
	}

	// Cleanup at the end
	t.Cleanup(func() {
		_, _ = conn.Exec(context.Background(), `DELETE FROM scheduled_messages WHERE mailbox_id = $1`, mailboxID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM sessions WHERE user_id = $1`, userID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM mailboxes WHERE id = $1`, mailboxID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, userID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM domains WHERE id = $1`, domainID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM organizations WHERE id = $1`, orgID)
	})

	// Query GET /v1/mailboxes/{mailboxID}/messages?folder=scheduled
	req := httptest.NewRequest("GET", fmt.Sprintf("/v1/mailboxes/%s/messages?folder=scheduled", mailboxID), nil)
	req.SetPathValue("mailbox_id", mailboxID)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	messagesHandler(w, req)

	resp := w.Result()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("messagesHandler?folder=scheduled returned %d: %s", resp.StatusCode, w.Body.String())
	}

	var res struct {
		Messages []MessageMetadataResponse `json:"messages"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if len(res.Messages) != 2 {
		t.Fatalf("expected 2 scheduled messages, got %d", len(res.Messages))
	}

	// Verify order and fields of future 1
	m1 := res.Messages[0]
	if m1.ID != idFuture1 {
		t.Errorf("expected m1.ID to be %s, got %s", idFuture1, m1.ID)
	}
	if m1.Sender != rcpt1 {
		t.Errorf("expected m1.Sender to be %s, got %s", rcpt1, m1.Sender)
	}
	if m1.Folder != "scheduled" {
		t.Errorf("expected m1.Folder to be 'scheduled', got %s", m1.Folder)
	}
	if m1.Status != "scheduled" {
		t.Errorf("expected m1.Status to be 'scheduled', got %s", m1.Status)
	}
	if len(m1.Recipients) != 1 || m1.Recipients[0] != rcpt1 {
		t.Errorf("expected m1.Recipients to be [%s], got %v", rcpt1, m1.Recipients)
	}

	// Verify order and fields of future 2
	m2 := res.Messages[1]
	if m2.ID != idFuture2 {
		t.Errorf("expected m2.ID to be %s, got %s", idFuture2, m2.ID)
	}
	if m2.Sender != rcpt2 {
		t.Errorf("expected m2.Sender to be %s, got %s", rcpt2, m2.Sender)
	}

	// Verify GET /v1/mailboxes/{mailboxID}/messages?folder=inbox does not return scheduled rows
	reqInbox := httptest.NewRequest("GET", fmt.Sprintf("/v1/mailboxes/%s/messages?folder=inbox", mailboxID), nil)
	reqInbox.SetPathValue("mailbox_id", mailboxID)
	reqInbox.Header.Set("Authorization", "Bearer "+token)
	wInbox := httptest.NewRecorder()
	messagesHandler(wInbox, reqInbox)
	var resInbox struct {
		Messages []MessageMetadataResponse `json:"messages"`
	}
	_ = json.NewDecoder(wInbox.Body).Decode(&resInbox)
	for _, m := range resInbox.Messages {
		if m.ID == idFuture1 || m.ID == idFuture2 {
			t.Errorf("scheduled message %s should not appear in inbox", m.ID)
		}
	}
}
