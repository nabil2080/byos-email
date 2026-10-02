package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func insertSnoozeTestMessage(t *testing.T, conn *pgx.Conn, mailboxID, domainID, sender, folder string, snoozedUntil *time.Time) string {
	t.Helper()
	ctx := context.Background()
	var id string
	deliveryID := uuid.New().String()
	threadID := uuid.New().String()
	err := conn.QueryRow(ctx, `
		INSERT INTO message_metadata (
			mailbox_id, domain_id, direction, delivery_identity, sender, recipients,
			storage_object_id, content_key_hpke_wrapped, mailbox_sk_version,
			encryption_version, encryption_iv, aad_version, bundle_hash,
			status, folder, is_read, thread_id, received_at, snoozed_until
		) VALUES (
			$1, $2, 'received', $3, $4, ARRAY['rcpt@test.local'],
			'storage/obj', decode('AA==', 'base64'), 1,
			1, decode('AA==', 'base64'), 1, decode('AA==', 'base64'),
			'received', $5, false, $6::uuid, now(), $7
		) RETURNING id::text
	`, mailboxID, domainID, []byte(deliveryID), sender, folder, threadID, snoozedUntil).Scan(&id)
	if err != nil {
		t.Fatalf("insertSnoozeTestMessage failed: %v", err)
	}
	return id
}

func getMessagesForFolder(t *testing.T, mailboxID, token, folder string) []MessageMetadataResponse {
	t.Helper()
	req := httptest.NewRequest("GET", fmt.Sprintf("/v1/mailboxes/%s/messages?folder=%s", mailboxID, folder), nil)
	req.SetPathValue("mailbox_id", mailboxID)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	messagesHandler(w, req)
	resp := w.Result()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("getMessagesForFolder %s failed with status %d: %s", folder, resp.StatusCode, w.Body.String())
	}
	var res struct {
		Messages []MessageMetadataResponse `json:"messages"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil {
		t.Fatalf("decode messages response: %v", err)
	}
	return res.Messages
}

func postSnooze(t *testing.T, mailboxID, messageID, token string, snoozedUntil *string) *http.Response {
	t.Helper()
	bodyJSON, _ := json.Marshal(map[string]interface{}{"snoozed_until": snoozedUntil})
	req := httptest.NewRequest("POST", fmt.Sprintf("/v1/mailboxes/%s/messages/%s/snooze", mailboxID, messageID), bytes.NewReader(bodyJSON))
	req.SetPathValue("mailbox_id", mailboxID)
	req.SetPathValue("message_id", messageID)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	messageSnoozeHandler(w, req)
	return w.Result()
}

// 1. TestSnoozeHidesFromInbox
func TestSnoozeHidesFromInbox(t *testing.T) {
	conn := getTestDB(t)
	defer conn.Close(context.Background())
	ctx := context.Background()

	_, userID, domainID, mailboxID := createThreadingTestMailbox(t, conn)

	token, tokenHash := generateSessionToken()
	_, err := conn.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
		userID, tokenHash, time.Now().Add(24*time.Hour))
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	msgID := insertSnoozeTestMessage(t, conn, mailboxID, domainID, "alice@test.local", "inbox", nil)

	// Snooze for +1 hour
	snoozeTime := time.Now().Add(1 * time.Hour).UTC().Format(time.RFC3339)
	resp := postSnooze(t, mailboxID, msgID, token, &snoozeTime)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("postSnooze failed: status %d", resp.StatusCode)
	}

	// GET messages for inbox -> message NOT in list
	inboxMsgs := getMessagesForFolder(t, mailboxID, token, "inbox")
	for _, m := range inboxMsgs {
		if m.ID == msgID {
			t.Fatalf("expected message %s to be hidden from inbox, but found in list", msgID)
		}
	}

	// GET messages for snoozed -> message IS in list
	snoozedMsgs := getMessagesForFolder(t, mailboxID, token, "snoozed")
	found := false
	for _, m := range snoozedMsgs {
		if m.ID == msgID {
			found = true
			if m.SnoozedUntil == nil || *m.SnoozedUntil == "" {
				t.Fatalf("expected SnoozedUntil to be set on message %s", msgID)
			}
			break
		}
	}
	if !found {
		t.Fatalf("expected message %s to be present in snoozed folder, but not found", msgID)
	}
}

// 2. TestSnoozeExpiryRestores
func TestSnoozeExpiryRestores(t *testing.T) {
	conn := getTestDB(t)
	defer conn.Close(context.Background())
	ctx := context.Background()

	_, userID, domainID, mailboxID := createThreadingTestMailbox(t, conn)

	token, tokenHash := generateSessionToken()
	_, err := conn.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
		userID, tokenHash, time.Now().Add(24*time.Hour))
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	msgID := insertSnoozeTestMessage(t, conn, mailboxID, domainID, "bob@test.local", "inbox", nil)

	// Snooze for +600ms
	snoozeTime := time.Now().Add(600 * time.Millisecond).UTC().Format(time.RFC3339Nano)
	resp := postSnooze(t, mailboxID, msgID, token, &snoozeTime)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("postSnooze failed: status %d", resp.StatusCode)
	}

	// Wait 750ms for snooze to expire
	time.Sleep(750 * time.Millisecond)

	// GET inbox -> message IS in list
	inboxMsgs := getMessagesForFolder(t, mailboxID, token, "inbox")
	found := false
	for _, m := range inboxMsgs {
		if m.ID == msgID {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected message %s to return to inbox after expiry, but not found", msgID)
	}

	// GET snoozed -> message NOT in list
	snoozedMsgs := getMessagesForFolder(t, mailboxID, token, "snoozed")
	for _, m := range snoozedMsgs {
		if m.ID == msgID {
			t.Fatalf("expected message %s to be removed from snoozed after expiry, but found", msgID)
		}
	}
}

// 3. TestUnsnoozeRestores
func TestUnsnoozeRestores(t *testing.T) {
	conn := getTestDB(t)
	defer conn.Close(context.Background())
	ctx := context.Background()

	_, userID, domainID, mailboxID := createThreadingTestMailbox(t, conn)

	token, tokenHash := generateSessionToken()
	_, err := conn.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
		userID, tokenHash, time.Now().Add(24*time.Hour))
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	msgID := insertSnoozeTestMessage(t, conn, mailboxID, domainID, "carol@test.local", "inbox", nil)

	// Snooze for 2 hours
	snoozeTime := time.Now().Add(2 * time.Hour).UTC().Format(time.RFC3339)
	resp := postSnooze(t, mailboxID, msgID, token, &snoozeTime)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("postSnooze failed: status %d", resp.StatusCode)
	}

	// Clear snooze by sending null
	respClear := postSnooze(t, mailboxID, msgID, token, nil)
	if respClear.StatusCode != http.StatusOK {
		t.Fatalf("clear snooze failed: status %d", respClear.StatusCode)
	}

	// Verify message returns to inbox
	inboxMsgs := getMessagesForFolder(t, mailboxID, token, "inbox")
	found := false
	for _, m := range inboxMsgs {
		if m.ID == msgID {
			found = true
			if m.SnoozedUntil != nil {
				t.Fatalf("expected SnoozedUntil to be nil after unsnooze, got %v", *m.SnoozedUntil)
			}
			break
		}
	}
	if !found {
		t.Fatalf("expected message %s to return to inbox after clearing snooze, but not found", msgID)
	}
}

// 4. TestSnoozeRejectsPastTime
func TestSnoozeRejectsPastTime(t *testing.T) {
	conn := getTestDB(t)
	defer conn.Close(context.Background())
	ctx := context.Background()

	_, userID, domainID, mailboxID := createThreadingTestMailbox(t, conn)

	token, tokenHash := generateSessionToken()
	_, err := conn.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
		userID, tokenHash, time.Now().Add(24*time.Hour))
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	msgID := insertSnoozeTestMessage(t, conn, mailboxID, domainID, "dave@test.local", "inbox", nil)

	// Send snoozed_until in the past
	pastTime := time.Now().Add(-10 * time.Minute).UTC().Format(time.RFC3339)
	resp := postSnooze(t, mailboxID, msgID, token, &pastTime)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected status 400 for past time, got %d", resp.StatusCode)
	}
}
