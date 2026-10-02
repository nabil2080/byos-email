package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// TestMessagesHandlerRejectsSearchParam verifies that calling
// GET /v1/mailboxes/{mailbox_id}/messages?search=... returns HTTP 400 Bad Request
// with a descriptive error guiding callers to /v1/mailboxes/{id}/search.
func TestMessagesHandlerRejectsSearchParam(t *testing.T) {
	conn := getTestDB(t)
	defer conn.Close(context.Background())
	ctx := context.Background()

	_, userID, _, mailboxID := createThreadingTestMailbox(t, conn)

	token, tokenHash := generateSessionToken()
	_, err := conn.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
		userID, tokenHash, time.Now().Add(24*time.Hour))
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/v1/mailboxes/"+mailboxID+"/messages?search=classified", nil)
	req.SetPathValue("mailbox_id", mailboxID)
	req.Header.Set("Authorization", "Bearer "+token)

	w := httptest.NewRecorder()
	messagesHandler(w, req)
	resp := w.Result()
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request, got %d: %s", resp.StatusCode, w.Body.String())
	}

	var body map[string]string
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode response body: %v", err)
	}

	if body["error"] != "use /v1/mailboxes/{id}/search for search" {
		t.Errorf("unexpected error message: %q", body["error"])
	}
}
