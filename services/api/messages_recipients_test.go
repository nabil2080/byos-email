package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
)

// TestMessageListReturnsRecipients verifies that GET /v1/mailboxes/{mailbox_id}/messages?folder=sent
// returns recipients for each row.
func TestMessageListReturnsRecipients(t *testing.T) {
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

	sentMsgID := uuid.New().String()
	deliveryID := uuid.New().String()
	expectedRecipients := []string{"bob@example.com", "carol@example.com"}

	_, err = conn.Exec(ctx, `
		INSERT INTO message_metadata (
			id, mailbox_id, domain_id, direction, delivery_identity, sender, recipients,
			storage_object_id, content_key_hpke_wrapped, mailbox_sk_version,
			encryption_version, encryption_iv, aad_version, bundle_hash,
			status, folder, is_read, sent_at, received_at
		) VALUES (
			$1, $2, $3, 'sent', $4, 'alice@byos.local', $5,
			'storage/obj', decode('AA==', 'base64'), 1,
			1, decode('AA==', 'base64'), 1, decode('AA==', 'base64'),
			'sent', 'sent', true, now(), now()
		)
	`, sentMsgID, mailboxID, domainID, []byte(deliveryID), expectedRecipients)
	if err != nil {
		t.Fatalf("insert sent message: %v", err)
	}

	t.Cleanup(func() {
		_, _ = conn.Exec(context.Background(), "DELETE FROM message_metadata WHERE id = $1", sentMsgID)
	})

	req := httptest.NewRequest(http.MethodGet, "/v1/mailboxes/"+mailboxID+"/messages?folder=sent", nil)
	req.SetPathValue("mailbox_id", mailboxID)
	req.Header.Set("Authorization", "Bearer "+token)

	w := httptest.NewRecorder()
	messagesHandler(w, req)
	resp := w.Result()
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, w.Body.String())
	}

	var body struct {
		Messages []MessageMetadataResponse `json:"messages"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if len(body.Messages) == 0 {
		t.Fatalf("expected at least 1 message in sent folder, got 0")
	}

	var found *MessageMetadataResponse
	for i := range body.Messages {
		if body.Messages[i].ID == sentMsgID {
			found = &body.Messages[i]
			break
		}
	}

	if found == nil {
		t.Fatalf("inserted message %s not found in sent response", sentMsgID)
	}

	if len(found.Recipients) != len(expectedRecipients) {
		t.Fatalf("expected %d recipients, got %d: %v", len(expectedRecipients), len(found.Recipients), found.Recipients)
	}
	for i, r := range expectedRecipients {
		if found.Recipients[i] != r {
			t.Errorf("expected recipient %d to be %q, got %q", i, r, found.Recipients[i])
		}
	}
}

// TestThreadsReturnRecipients verifies that GET /v1/mailboxes/{mailbox_id}/threads?folder=sent
// returns the recipients of each thread's latest message.
func TestThreadsReturnRecipients(t *testing.T) {
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

	threadID := uuid.New().String()
	t0 := time.Now().Add(-10 * time.Minute)
	t1 := time.Now().Add(-2 * time.Minute)

	msg1ID := uuid.New().String()
	deliveryID1 := uuid.New().String()
	_, err = conn.Exec(ctx, `
		INSERT INTO message_metadata (
			id, mailbox_id, domain_id, direction, delivery_identity, sender, recipients,
			storage_object_id, content_key_hpke_wrapped, mailbox_sk_version,
			encryption_version, encryption_iv, aad_version, bundle_hash,
			status, folder, is_read, thread_id, sent_at, received_at
		) VALUES (
			$1, $2, $3, 'sent', $4, 'alice@byos.local', ARRAY['first@example.com'],
			'storage/obj', decode('AA==', 'base64'), 1,
			1, decode('AA==', 'base64'), 1, decode('AA==', 'base64'),
			'sent', 'sent', true, $5::uuid, $6, $6
		)
	`, msg1ID, mailboxID, domainID, []byte(deliveryID1), threadID, t0)
	if err != nil {
		t.Fatalf("insert thread message 1: %v", err)
	}

	msg2ID := uuid.New().String()
	deliveryID2 := uuid.New().String()
	expectedLatestRecipients := []string{"bob@example.com", "carol@example.com"}
	_, err = conn.Exec(ctx, `
		INSERT INTO message_metadata (
			id, mailbox_id, domain_id, direction, delivery_identity, sender, recipients,
			storage_object_id, content_key_hpke_wrapped, mailbox_sk_version,
			encryption_version, encryption_iv, aad_version, bundle_hash,
			status, folder, is_read, thread_id, sent_at, received_at
		) VALUES (
			$1, $2, $3, 'sent', $4, 'alice@byos.local', $5,
			'storage/obj', decode('AA==', 'base64'), 1,
			1, decode('AA==', 'base64'), 1, decode('AA==', 'base64'),
			'sent', 'sent', true, $6::uuid, $7, $7
		)
	`, msg2ID, mailboxID, domainID, []byte(deliveryID2), expectedLatestRecipients, threadID, t1)
	if err != nil {
		t.Fatalf("insert thread message 2: %v", err)
	}

	t.Cleanup(func() {
		_, _ = conn.Exec(context.Background(), "DELETE FROM message_metadata WHERE thread_id = $1::uuid", threadID)
	})

	req := httptest.NewRequest(http.MethodGet, "/v1/mailboxes/"+mailboxID+"/threads?folder=sent", nil)
	req.SetPathValue("mailbox_id", mailboxID)
	req.Header.Set("Authorization", "Bearer "+token)

	w := httptest.NewRecorder()
	threadsHandler(w, req)
	resp := w.Result()
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, w.Body.String())
	}

	var body struct {
		Threads []ThreadSummary `json:"threads"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode response: %v", err)
	}

	if len(body.Threads) == 0 {
		t.Fatalf("expected at least 1 thread, got 0")
	}

	var foundThread *ThreadSummary
	for i := range body.Threads {
		if body.Threads[i].ThreadID == threadID {
			foundThread = &body.Threads[i]
			break
		}
	}

	if foundThread == nil {
		t.Fatalf("thread %s not found in response", threadID)
	}

	if len(foundThread.Recipients) != len(expectedLatestRecipients) {
		t.Fatalf("expected %d recipients for latest thread message, got %d: %v",
			len(expectedLatestRecipients), len(foundThread.Recipients), foundThread.Recipients)
	}

	for i, r := range expectedLatestRecipients {
		if foundThread.Recipients[i] != r {
			t.Errorf("expected thread latest recipient %d to be %q, got %q", i, r, foundThread.Recipients[i])
		}
	}
}
