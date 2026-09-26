package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func insertThreadListTestMessage(t *testing.T, conn *pgx.Conn, mailboxID, domainID, threadID, sender, folder string, isRead bool, receivedAt time.Time) string {
	t.Helper()
	ctx := context.Background()
	var id string
	deliveryID := uuid.New().String()
	err := conn.QueryRow(ctx, `
		INSERT INTO message_metadata (
			mailbox_id, domain_id, direction, delivery_identity, sender, recipients,
			storage_object_id, content_key_hpke_wrapped, mailbox_sk_version,
			encryption_version, encryption_iv, aad_version, bundle_hash,
			status, folder, is_read, thread_id, received_at
		) VALUES (
			$1, $2, 'received', $3, $4, ARRAY['rcpt@test.local'],
			'storage/obj', decode('AA==', 'base64'), 1,
			1, decode('AA==', 'base64'), 1, decode('AA==', 'base64'),
			'received', $5, $6, $7::uuid, $8
		) RETURNING id::text
	`, mailboxID, domainID, []byte(deliveryID), sender, folder, isRead, threadID, receivedAt).Scan(&id)
	if err != nil {
		t.Fatalf("insertThreadListTestMessage failed: %v", err)
	}
	return id
}

// 1. TestThreadsEndpointGroupsReplies
func TestThreadsEndpointGroupsReplies(t *testing.T) {
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
	t1 := time.Now().Add(-5 * time.Minute)

	id1 := insertThreadListTestMessage(t, conn, mailboxID, domainID, threadID, "alice@test.local", "inbox", false, t0)
	id2 := insertThreadListTestMessage(t, conn, mailboxID, domainID, threadID, "bob@test.local", "inbox", true, t1)

	req := httptest.NewRequest(http.MethodGet, "/v1/mailboxes/"+mailboxID+"/threads", nil)
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

	if len(body.Threads) != 1 {
		t.Fatalf("expected exactly 1 thread, got %d", len(body.Threads))
	}

	th := body.Threads[0]
	if th.ThreadID != threadID {
		t.Errorf("expected thread_id %q, got %q", threadID, th.ThreadID)
	}
	if th.MessageCount != 2 {
		t.Errorf("expected message_count 2, got %d", th.MessageCount)
	}
	if th.UnreadCount != 1 {
		t.Errorf("expected unread_count 1, got %d", th.UnreadCount)
	}
	if len(th.MessageIDs) != 2 {
		t.Fatalf("expected 2 message_ids, got %d", len(th.MessageIDs))
	}
	if th.MessageIDs[0] != id1 || th.MessageIDs[1] != id2 {
		t.Errorf("expected message_ids [%s, %s], got [%s, %s]", id1, id2, th.MessageIDs[0], th.MessageIDs[1])
	}
	if len(th.Participants) != 2 {
		t.Errorf("expected 2 participants, got %d (%v)", len(th.Participants), th.Participants)
	}
}

// 2. TestThreadsEndpointSeparatesUnrelated
func TestThreadsEndpointSeparatesUnrelated(t *testing.T) {
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

	threadID1 := uuid.New().String()
	threadID2 := uuid.New().String()

	insertThreadListTestMessage(t, conn, mailboxID, domainID, threadID1, "user1@test.local", "inbox", false, time.Now().Add(-5*time.Minute))
	insertThreadListTestMessage(t, conn, mailboxID, domainID, threadID2, "user2@test.local", "inbox", false, time.Now())

	req := httptest.NewRequest(http.MethodGet, "/v1/mailboxes/"+mailboxID+"/threads", nil)
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

	if len(body.Threads) != 2 {
		t.Fatalf("expected 2 separate threads, got %d", len(body.Threads))
	}
}

// 3. TestThreadsEndpointFolderFilter
func TestThreadsEndpointFolderFilter(t *testing.T) {
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

	threadInbox := uuid.New().String()
	threadSent := uuid.New().String()

	insertThreadListTestMessage(t, conn, mailboxID, domainID, threadInbox, "inbox@test.local", "inbox", false, time.Now().Add(-5*time.Minute))
	insertThreadListTestMessage(t, conn, mailboxID, domainID, threadSent, "sent@test.local", "sent", true, time.Now())

	// Query ?folder=inbox
	reqInbox := httptest.NewRequest(http.MethodGet, "/v1/mailboxes/"+mailboxID+"/threads?folder=inbox", nil)
	reqInbox.SetPathValue("mailbox_id", mailboxID)
	reqInbox.Header.Set("Authorization", "Bearer "+token)

	wInbox := httptest.NewRecorder()
	threadsHandler(wInbox, reqInbox)
	respInbox := wInbox.Result()
	defer respInbox.Body.Close()

	var bodyInbox struct {
		Threads []ThreadSummary `json:"threads"`
	}
	if err := json.NewDecoder(respInbox.Body).Decode(&bodyInbox); err != nil {
		t.Fatalf("decode inbox response: %v", err)
	}
	if len(bodyInbox.Threads) != 1 {
		t.Fatalf("expected 1 inbox thread, got %d", len(bodyInbox.Threads))
	}
	if bodyInbox.Threads[0].ThreadID != threadInbox {
		t.Errorf("expected inbox thread %q, got %q", threadInbox, bodyInbox.Threads[0].ThreadID)
	}

	// Query ?folder=sent
	reqSent := httptest.NewRequest(http.MethodGet, "/v1/mailboxes/"+mailboxID+"/threads?folder=sent", nil)
	reqSent.SetPathValue("mailbox_id", mailboxID)
	reqSent.Header.Set("Authorization", "Bearer "+token)

	wSent := httptest.NewRecorder()
	threadsHandler(wSent, reqSent)
	respSent := wSent.Result()
	defer respSent.Body.Close()

	var bodySent struct {
		Threads []ThreadSummary `json:"threads"`
	}
	if err := json.NewDecoder(respSent.Body).Decode(&bodySent); err != nil {
		t.Fatalf("decode sent response: %v", err)
	}
	if len(bodySent.Threads) != 1 {
		t.Fatalf("expected 1 sent thread, got %d", len(bodySent.Threads))
	}
	if bodySent.Threads[0].ThreadID != threadSent {
		t.Errorf("expected sent thread %q, got %q", threadSent, bodySent.Threads[0].ThreadID)
	}
}

// 4. TestThreadDetailReturnsChronologicalOrder
func TestThreadDetailReturnsChronologicalOrder(t *testing.T) {
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
	parentTime := time.Now().Add(-10 * time.Minute)
	replyTime := time.Now().Add(-2 * time.Minute)

	parentID := insertThreadListTestMessage(t, conn, mailboxID, domainID, threadID, "alice@test.local", "inbox", false, parentTime)
	replyID := insertThreadListTestMessage(t, conn, mailboxID, domainID, threadID, "bob@test.local", "inbox", true, replyTime)

	req := httptest.NewRequest(http.MethodGet, "/v1/mailboxes/"+mailboxID+"/threads/"+threadID, nil)
	req.SetPathValue("mailbox_id", mailboxID)
	req.SetPathValue("thread_id", threadID)
	req.Header.Set("Authorization", "Bearer "+token)

	w := httptest.NewRecorder()
	threadDetailHandler(w, req)
	resp := w.Result()
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, w.Body.String())
	}

	var body struct {
		Messages []MessageMetadataResponse `json:"messages"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatalf("decode detail response: %v", err)
	}

	if len(body.Messages) != 2 {
		t.Fatalf("expected 2 messages in detail, got %d", len(body.Messages))
	}
	if body.Messages[0].ID != parentID {
		t.Errorf("expected first message to be parent %q, got %q", parentID, body.Messages[0].ID)
	}
	if body.Messages[1].ID != replyID {
		t.Errorf("expected second message to be reply %q, got %q", replyID, body.Messages[1].ID)
	}
}

// 5. TestToggleStarPersists
func TestToggleStarPersists(t *testing.T) {
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
	msgID := insertThreadListTestMessage(t, conn, mailboxID, domainID, threadID, "alice@test.local", "inbox", false, time.Now())

	// Call toggle star endpoint with PATCH
	req := httptest.NewRequest(http.MethodPatch, "/v1/mailboxes/"+mailboxID+"/messages/"+msgID+"/star", strings.NewReader(`{"starred":true}`))
	req.SetPathValue("mailbox_id", mailboxID)
	req.SetPathValue("message_id", msgID)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	w := httptest.NewRecorder()
	messageStarHandler(w, req)
	resp := w.Result()
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", resp.StatusCode, w.Body.String())
	}

	var res struct {
		IsStarred bool `json:"is_starred"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&res); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !res.IsStarred {
		t.Fatalf("expected is_starred=true in response, got false")
	}

	// Query DB to verify persistence
	var dbStarred bool
	err = conn.QueryRow(ctx, `SELECT is_starred FROM message_metadata WHERE id = $1`, msgID).Scan(&dbStarred)
	if err != nil {
		t.Fatalf("query message_metadata: %v", err)
	}
	if !dbStarred {
		t.Fatalf("expected is_starred=true in database, got false")
	}
}

// 6. TestToggleStarRejectsNonOwner
func TestToggleStarRejectsNonOwner(t *testing.T) {
	conn := getTestDB(t)
	defer conn.Close(context.Background())
	ctx := context.Background()

	_, _, domainIDA, mailboxIDA := createThreadingTestMailbox(t, conn)
	_, userIDB, _, _ := createThreadingTestMailbox(t, conn)

	tokenB, tokenHashB := generateSessionToken()
	_, err := conn.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
		userIDB, tokenHashB, time.Now().Add(24*time.Hour))
	if err != nil {
		t.Fatalf("create session for user B: %v", err)
	}

	threadID := uuid.New().String()
	msgIDA := insertThreadListTestMessage(t, conn, mailboxIDA, domainIDA, threadID, "alice@test.local", "inbox", false, time.Now())

	// User B tries to star message in mailbox A
	req := httptest.NewRequest(http.MethodPatch, "/v1/mailboxes/"+mailboxIDA+"/messages/"+msgIDA+"/star", strings.NewReader(`{"starred":true}`))
	req.SetPathValue("mailbox_id", mailboxIDA)
	req.SetPathValue("message_id", msgIDA)
	req.Header.Set("Authorization", "Bearer "+tokenB)
	req.Header.Set("Content-Type", "application/json")

	w := httptest.NewRecorder()
	messageStarHandler(w, req)
	resp := w.Result()
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for non-owner, got %d: %s", resp.StatusCode, w.Body.String())
	}
}

// 7. TestThreadSummaryIncludesStarred
func TestThreadSummaryIncludesStarred(t *testing.T) {
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
	t1 := time.Now().Add(-5 * time.Minute)

	id1 := insertThreadListTestMessage(t, conn, mailboxID, domainID, threadID, "alice@test.local", "inbox", false, t0)
	_ = insertThreadListTestMessage(t, conn, mailboxID, domainID, threadID, "bob@test.local", "inbox", true, t1)

	// Star id1 via PATCH endpoint
	starReq := httptest.NewRequest(http.MethodPatch, "/v1/mailboxes/"+mailboxID+"/messages/"+id1+"/star", strings.NewReader(`{"starred":true}`))
	starReq.SetPathValue("mailbox_id", mailboxID)
	starReq.SetPathValue("message_id", id1)
	starReq.Header.Set("Authorization", "Bearer "+token)
	starReq.Header.Set("Content-Type", "application/json")

	wStar := httptest.NewRecorder()
	messageStarHandler(wStar, starReq)
	if wStar.Result().StatusCode != http.StatusOK {
		t.Fatalf("star request failed: %s", wStar.Body.String())
	}

	// Fetch threads summary
	req := httptest.NewRequest(http.MethodGet, "/v1/mailboxes/"+mailboxID+"/threads", nil)
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
		t.Fatalf("decode threads response: %v", err)
	}

	var found *ThreadSummary
	for i := range body.Threads {
		if body.Threads[i].ThreadID == threadID {
			found = &body.Threads[i]
			break
		}
	}
	if found == nil {
		t.Fatalf("thread %q not found in summary", threadID)
	}
	if !found.IsStarred {
		t.Fatalf("expected thread IsStarred=true when message is starred, got false")
	}
}

// 5. TestThreadsEndpointExcludesSnoozed
func TestThreadsEndpointExcludesSnoozed(t *testing.T) {
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

	threadID1 := uuid.New().String()
	threadID2 := uuid.New().String()
	t0 := time.Now().Add(-10 * time.Minute)

	// Thread 1: normal inbox message
	insertThreadListTestMessage(t, conn, mailboxID, domainID, threadID1, "normal@test.local", "inbox", false, t0)

	// Thread 2: snoozed message (+2 hours)
	deliveryID := uuid.New().String()
	futureSnooze := time.Now().Add(2 * time.Hour).UTC()
	_, err = conn.Exec(ctx, `
		INSERT INTO message_metadata (
			mailbox_id, domain_id, direction, delivery_identity, sender, recipients,
			storage_object_id, content_key_hpke_wrapped, mailbox_sk_version,
			encryption_version, encryption_iv, aad_version, bundle_hash,
			status, folder, is_read, thread_id, received_at, snoozed_until
		) VALUES (
			$1, $2, 'received', $3, 'snoozed@test.local', ARRAY['rcpt@test.local'],
			'storage/obj', decode('AA==', 'base64'), 1,
			1, decode('AA==', 'base64'), 1, decode('AA==', 'base64'),
			'received', 'inbox', false, $4::uuid, $5, $6
		)
	`, mailboxID, domainID, []byte(deliveryID), threadID2, t0, futureSnooze)
	if err != nil {
		t.Fatalf("insert snoozed message: %v", err)
	}

	// 1. GET /v1/mailboxes/{mailbox_id}/threads?folder=inbox -> should include threadID1, exclude threadID2
	reqInbox := httptest.NewRequest(http.MethodGet, "/v1/mailboxes/"+mailboxID+"/threads?folder=inbox", nil)
	reqInbox.SetPathValue("mailbox_id", mailboxID)
	reqInbox.Header.Set("Authorization", "Bearer "+token)

	wInbox := httptest.NewRecorder()
	threadsHandler(wInbox, reqInbox)
	if wInbox.Result().StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", wInbox.Result().StatusCode)
	}

	var bodyInbox struct {
		Threads []ThreadSummary `json:"threads"`
	}
	if err := json.NewDecoder(wInbox.Body).Decode(&bodyInbox); err != nil {
		t.Fatalf("decode inbox response: %v", err)
	}

	var foundThread1, foundThread2 bool
	for _, th := range bodyInbox.Threads {
		if th.ThreadID == threadID1 {
			foundThread1 = true
		}
		if th.ThreadID == threadID2 {
			foundThread2 = true
		}
	}
	if !foundThread1 {
		t.Errorf("expected normal thread %s in inbox threads", threadID1)
	}
	if foundThread2 {
		t.Errorf("expected snoozed thread %s to be excluded from inbox threads", threadID2)
	}

	// 2. GET /v1/mailboxes/{mailbox_id}/threads?folder=snoozed -> should include threadID2
	reqSnoozed := httptest.NewRequest(http.MethodGet, "/v1/mailboxes/"+mailboxID+"/threads?folder=snoozed", nil)
	reqSnoozed.SetPathValue("mailbox_id", mailboxID)
	reqSnoozed.Header.Set("Authorization", "Bearer "+token)

	wSnoozed := httptest.NewRecorder()
	threadsHandler(wSnoozed, reqSnoozed)
	if wSnoozed.Result().StatusCode != http.StatusOK {
		t.Fatalf("expected 200 for snoozed folder, got %d", wSnoozed.Result().StatusCode)
	}

	var bodySnoozed struct {
		Threads []ThreadSummary `json:"threads"`
	}
	if err := json.NewDecoder(wSnoozed.Body).Decode(&bodySnoozed); err != nil {
		t.Fatalf("decode snoozed response: %v", err)
	}

	var foundInSnoozed bool
	for _, th := range bodySnoozed.Threads {
		if th.ThreadID == threadID2 {
			foundInSnoozed = true
			if th.SnoozedUntil == nil {
				t.Errorf("expected SnoozedUntil to be populated on snoozed thread")
			}
		}
	}
	if !foundInSnoozed {
		t.Errorf("expected snoozed thread %s in snoozed folder threads", threadID2)
	}
}


