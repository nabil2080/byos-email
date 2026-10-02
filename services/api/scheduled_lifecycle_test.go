package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func TestScheduleSubmitUploadsToStorageWorker(t *testing.T) {
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

	t.Cleanup(func() {
		_, _ = conn.Exec(context.Background(), `DELETE FROM scheduled_messages WHERE mailbox_id = $1`, mailboxID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM outbound_reservations WHERE mailbox_id = $1`, mailboxID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM sessions WHERE user_id = $1`, userID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM mailboxes WHERE id = $1`, mailboxID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, userID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM domains WHERE id = $1`, domainID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM organizations WHERE id = $1`, orgID)
	})

	var storedObjectKey string
	var storedData []byte
	var storeCallCount int32

	mockStorageServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/store" {
			atomic.AddInt32(&storeCallCount, 1)
			var req map[string]interface{}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, err.Error(), 400)
				return
			}
			storedObjectKey = fmt.Sprintf("%v", req["object_key"])
			if dataStr, ok := req["data"].(string); ok {
				storedData, _ = base64.StdEncoding.DecodeString(dataStr)
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok"})
			return
		}
		http.NotFound(w, r)
	}))
	defer mockStorageServer.Close()

	origStorageURL := os.Getenv("STORAGE_WORKER_URL")
	os.Setenv("STORAGE_WORKER_URL", mockStorageServer.URL)
	t.Cleanup(func() {
		os.Setenv("STORAGE_WORKER_URL", origStorageURL)
	})

	reservationID := uuid.New().String()
	_, err = conn.Exec(ctx, `
		INSERT INTO outbound_reservations (
			reservation_id, user_id, mailbox_id, outbox_seq,
			encryption_version, aad_version, status, expires_at
		) VALUES ($1, $2, $3, 1, 1, 1, 'reserved', now() + interval '1 hour')
	`, reservationID, userID, mailboxID)
	if err != nil {
		t.Fatalf("insert reservation: %v", err)
	}

	testDraftPayload := []byte("encrypted_draft_envelope_data_123")
	testDraftB64 := base64.StdEncoding.EncodeToString(testDraftPayload)

	iv := make([]byte, 12)
	iv[0] = 0x42
	encMsg := make([]byte, 32)
	encMsg[0] = 0x01
	copy(encMsg[1:13], iv)
	sendToken := make([]byte, 50)
	sendToken[0] = 0x01

	reqData := map[string]interface{}{
		"reservation_id":     reservationID,
		"mailbox_id":         mailboxID,
		"recipient":          "recipient@test.local",
		"encrypted_message":  base64.StdEncoding.EncodeToString(encMsg),
		"send_token_wrapped": base64.StdEncoding.EncodeToString(sendToken),
		"outbox_seq":         1,
		"encryption_version": 1,
		"aad_version":        1,
		"encryption_iv":      base64.StdEncoding.EncodeToString(iv),
		"scheduled_at":       time.Now().Add(2 * time.Hour).Format(time.RFC3339),
		"draft_envelope":     testDraftB64,
		"subject":            "Test Subject",
	}
	bodyJSON, _ := json.Marshal(reqData)
	req := httptest.NewRequest("POST", "/v1/outbound/schedule", bytes.NewReader(bodyJSON))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	outboundScheduleHandler(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	schedID, ok := resp["id"].(string)
	if !ok || schedID == "" {
		t.Fatalf("expected non-empty id in response: %v", resp)
	}

	if atomic.LoadInt32(&storeCallCount) != 1 {
		t.Fatalf("expected storage-worker to be called 1 time, got %d", atomic.LoadInt32(&storeCallCount))
	}

	expectedKey := fmt.Sprintf("mailboxes/%s/scheduled/%s.draft.enc", mailboxID, schedID)
	if storedObjectKey != expectedKey {
		t.Fatalf("expected storage object key %q, got %q", expectedKey, storedObjectKey)
	}
	if !bytes.Equal(storedData, testDraftPayload) {
		t.Fatalf("expected stored data %q, got %q", string(testDraftPayload), string(storedData))
	}

	var dbRef string
	err = conn.QueryRow(ctx, `SELECT draft_storage_ref FROM scheduled_messages WHERE id = $1`, schedID).Scan(&dbRef)
	if err != nil || dbRef != expectedKey {
		t.Fatalf("expected draft_storage_ref in DB to be storage key %q, got %q (err=%v)", expectedKey, dbRef, err)
	}
}

func TestScheduleSubmitAbortsIfStorageFails(t *testing.T) {
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

	t.Cleanup(func() {
		_, _ = conn.Exec(context.Background(), `DELETE FROM scheduled_messages WHERE mailbox_id = $1`, mailboxID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM outbound_reservations WHERE mailbox_id = $1`, mailboxID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM sessions WHERE user_id = $1`, userID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM mailboxes WHERE id = $1`, mailboxID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, userID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM domains WHERE id = $1`, domainID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM organizations WHERE id = $1`, orgID)
	})

	mockStorageServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "customer storage outage", http.StatusInternalServerError)
	}))
	defer mockStorageServer.Close()

	origStorageURL := os.Getenv("STORAGE_WORKER_URL")
	os.Setenv("STORAGE_WORKER_URL", mockStorageServer.URL)
	t.Cleanup(func() {
		os.Setenv("STORAGE_WORKER_URL", origStorageURL)
	})

	reservationID := uuid.New().String()
	_, err = conn.Exec(ctx, `
		INSERT INTO outbound_reservations (
			reservation_id, user_id, mailbox_id, outbox_seq,
			encryption_version, aad_version, status, expires_at
		) VALUES ($1, $2, $3, 1, 1, 1, 'reserved', now() + interval '1 hour')
	`, reservationID, userID, mailboxID)
	if err != nil {
		t.Fatalf("insert reservation: %v", err)
	}

	iv := make([]byte, 12)
	iv[0] = 0x42
	encMsg := make([]byte, 32)
	encMsg[0] = 0x01
	copy(encMsg[1:13], iv)
	sendToken := make([]byte, 50)
	sendToken[0] = 0x01

	reqData := map[string]interface{}{
		"reservation_id":     reservationID,
		"mailbox_id":         mailboxID,
		"recipient":          "recipient@test.local",
		"encrypted_message":  base64.StdEncoding.EncodeToString(encMsg),
		"send_token_wrapped": base64.StdEncoding.EncodeToString(sendToken),
		"outbox_seq":         1,
		"encryption_version": 1,
		"aad_version":        1,
		"encryption_iv":      base64.StdEncoding.EncodeToString(iv),
		"scheduled_at":       time.Now().Add(2 * time.Hour).Format(time.RFC3339),
		"draft_envelope":     base64.StdEncoding.EncodeToString([]byte("payload")),
	}
	bodyJSON, _ := json.Marshal(reqData)
	req := httptest.NewRequest("POST", "/v1/outbound/schedule", bytes.NewReader(bodyJSON))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	outboundScheduleHandler(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 Internal Server Error when storage fails, got %d: %s", w.Code, w.Body.String())
	}

	var rowCount int
	err = conn.QueryRow(ctx, `SELECT count(*) FROM scheduled_messages WHERE mailbox_id = $1`, mailboxID).Scan(&rowCount)
	if err != nil || rowCount != 0 {
		t.Fatalf("expected 0 rows written when storage fails, got %d rows (err=%v)", rowCount, err)
	}
}

func TestScheduledListReturnsOnlyRef(t *testing.T) {
	conn := getTestDB(t)
	defer conn.Close(context.Background())
	ctx := context.Background()

	orgID, userID, domainID, mailboxID := createThreadingTestMailbox(t, conn)
	_ = orgID

	token, tokenHash := generateSessionToken()
	_, err := conn.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
		userID, tokenHash, time.Now().Add(24*time.Hour))
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	schedPK := uuid.New().String()
	deliveryID := uuid.New().String()
	futureTime := time.Now().Add(3 * time.Hour)
	storageKey := fmt.Sprintf("mailboxes/%s/scheduled/%s.draft.enc", mailboxID, schedPK)

	_, err = conn.Exec(ctx, `
		INSERT INTO scheduled_messages (
			id, delivery_id, mailbox_id, domain_id, recipient, scheduled_at, send_at, status, expires_at, is_path_a, send_token_hash, draft_storage_ref, subject
		) VALUES (
			$1, $2, $3, $4, 'recipient@test.local', $5, $5, 'pending', $6, false, decode('', 'hex'), $7, 'Secret Subject'
		)
	`, schedPK, deliveryID, mailboxID, domainID, futureTime, futureTime.Add(24*time.Hour), storageKey)
	if err != nil {
		t.Fatalf("insert scheduled message: %v", err)
	}

	t.Cleanup(func() {
		_, _ = conn.Exec(context.Background(), `DELETE FROM scheduled_messages WHERE mailbox_id = $1`, mailboxID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM sessions WHERE user_id = $1`, userID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM mailboxes WHERE id = $1`, mailboxID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, userID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM domains WHERE id = $1`, domainID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM organizations WHERE id = $1`, orgID)
	})

	req := httptest.NewRequest("GET", fmt.Sprintf("/v1/mailboxes/%s/messages?folder=scheduled", mailboxID), nil)
	req.SetPathValue("mailbox_id", mailboxID)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	messagesHandler(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Messages []MessageMetadataResponse `json:"messages"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal list response: %v", err)
	}

	if len(resp.Messages) != 1 {
		t.Fatalf("expected 1 scheduled message in list, got %d", len(resp.Messages))
	}
	item := resp.Messages[0]
	if item.ID != schedPK {
		t.Fatalf("expected item ID %s, got %s", schedPK, item.ID)
	}
	if item.DraftStorageRef != storageKey {
		t.Fatalf("expected draft_storage_ref to be storage key %s, got %s", storageKey, item.DraftStorageRef)
	}
	if item.Subject != "" {
		t.Fatalf("expected subject from list endpoint to be empty (must come from decrypted draft), got %q", item.Subject)
	}
}

func TestScheduledUpdateReuploadOnlyWhenPayloadChanged(t *testing.T) {
	conn := getTestDB(t)
	defer conn.Close(context.Background())
	ctx := context.Background()

	orgID, userID, domainID, mailboxID := createThreadingTestMailbox(t, conn)
	_ = orgID

	token, tokenHash := generateSessionToken()
	_, err := conn.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
		userID, tokenHash, time.Now().Add(24*time.Hour))
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	schedPK := uuid.New().String()
	deliveryID := uuid.New().String()
	initialTime := time.Now().Add(2 * time.Hour).Truncate(time.Second)
	storageKey := fmt.Sprintf("mailboxes/%s/scheduled/%s.draft.enc", mailboxID, schedPK)

	_, err = conn.Exec(ctx, `
		INSERT INTO scheduled_messages (
			id, delivery_id, mailbox_id, domain_id, recipient, scheduled_at, send_at, status, expires_at, is_path_a, send_token_hash, draft_storage_ref, subject
		) VALUES (
			$1, $2, $3, $4, 'recipient@test.local', $5, $5, 'pending', $6, false, decode('', 'hex'), $7, 'Initial Subject'
		)
	`, schedPK, deliveryID, mailboxID, domainID, initialTime, initialTime.Add(24*time.Hour), storageKey)
	if err != nil {
		t.Fatalf("insert scheduled message: %v", err)
	}

	t.Cleanup(func() {
		_, _ = conn.Exec(context.Background(), `DELETE FROM scheduled_messages WHERE mailbox_id = $1`, mailboxID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM sessions WHERE user_id = $1`, userID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM mailboxes WHERE id = $1`, mailboxID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, userID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM domains WHERE id = $1`, domainID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM organizations WHERE id = $1`, orgID)
	})

	var storeCalls int32
	mockStorageServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/store" {
			atomic.AddInt32(&storeCalls, 1)
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]interface{}{"status": "ok"})
			return
		}
		http.NotFound(w, r)
	}))
	defer mockStorageServer.Close()

	origStorageURL := os.Getenv("STORAGE_WORKER_URL")
	os.Setenv("STORAGE_WORKER_URL", mockStorageServer.URL)
	t.Cleanup(func() {
		os.Setenv("STORAGE_WORKER_URL", origStorageURL)
	})

	// 1. Update ONLY send_at (no payload changed)
	newSendAt := time.Now().Add(6 * time.Hour).Truncate(time.Second)
	timeBody := fmt.Sprintf(`{"scheduled_at":%q}`, newSendAt.Format(time.RFC3339))
	reqTime := httptest.NewRequest("PUT", fmt.Sprintf("/v1/mailboxes/%s/scheduled/%s", mailboxID, schedPK), strings.NewReader(timeBody))
	reqTime.SetPathValue("mailbox_id", mailboxID)
	reqTime.SetPathValue("id", schedPK)
	reqTime.Header.Set("Authorization", "Bearer "+token)
	reqTime.Header.Set("Content-Type", "application/json")
	wTime := httptest.NewRecorder()
	mailboxScheduledItemHandler(wTime, reqTime)

	if wTime.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for time update, got %d: %s", wTime.Code, wTime.Body.String())
	}
	if atomic.LoadInt32(&storeCalls) != 0 {
		t.Fatalf("expected 0 storage store calls when only time changed, got %d", atomic.LoadInt32(&storeCalls))
	}

	// 2. Update with NEW payload
	newPayloadB64 := base64.StdEncoding.EncodeToString([]byte("new_updated_draft_payload"))
	updateBody := fmt.Sprintf(`{"draft_envelope":%q,"subject":"Updated Subject"}`, newPayloadB64)
	reqUpdate := httptest.NewRequest("PUT", fmt.Sprintf("/v1/mailboxes/%s/scheduled/%s", mailboxID, schedPK), strings.NewReader(updateBody))
	reqUpdate.SetPathValue("mailbox_id", mailboxID)
	reqUpdate.SetPathValue("id", schedPK)
	reqUpdate.Header.Set("Authorization", "Bearer "+token)
	reqUpdate.Header.Set("Content-Type", "application/json")
	wUpdate := httptest.NewRecorder()
	mailboxScheduledItemHandler(wUpdate, reqUpdate)

	if wUpdate.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for payload update, got %d: %s", wUpdate.Code, wUpdate.Body.String())
	}
	if atomic.LoadInt32(&storeCalls) != 1 {
		t.Fatalf("expected 1 storage store call when payload changed, got %d", atomic.LoadInt32(&storeCalls))
	}
}

func TestScheduledCancelReusesOrCopiesStorageBlob(t *testing.T) {
	conn := getTestDB(t)
	defer conn.Close(context.Background())
	ctx := context.Background()

	orgID, userID, domainID, mailboxID := createThreadingTestMailbox(t, conn)
	_ = orgID

	token, tokenHash := generateSessionToken()
	_, err := conn.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
		userID, tokenHash, time.Now().Add(24*time.Hour))
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	schedPK := uuid.New().String()
	deliveryID := uuid.New().String()
	futureTime := time.Now().Add(2 * time.Hour)
	storageKey := fmt.Sprintf("mailboxes/%s/scheduled/%s.draft.enc", mailboxID, schedPK)
	sampleEnvelope := []byte("encrypted_sample_envelope_payload")

	mockStorageServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/retrieve" {
			b64 := base64.StdEncoding.EncodeToString(sampleEnvelope)
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"data": b64,
				"size": len(sampleEnvelope),
			})
			return
		}
		http.NotFound(w, r)
	}))
	defer mockStorageServer.Close()

	origStorageURL := os.Getenv("STORAGE_WORKER_URL")
	os.Setenv("STORAGE_WORKER_URL", mockStorageServer.URL)
	t.Cleanup(func() {
		os.Setenv("STORAGE_WORKER_URL", origStorageURL)
	})

	_, err = conn.Exec(ctx, `
		INSERT INTO scheduled_messages (
			id, delivery_id, mailbox_id, domain_id, recipient, scheduled_at, send_at, status, expires_at, is_path_a, send_token_hash, draft_storage_ref, subject
		) VALUES (
			$1, $2, $3, $4, 'recipient@test.local', $5, $5, 'pending', $6, false, decode('', 'hex'), $7, 'Test Subject'
		)
	`, schedPK, deliveryID, mailboxID, domainID, futureTime, futureTime.Add(24*time.Hour), storageKey)
	if err != nil {
		t.Fatalf("insert scheduled message: %v", err)
	}

	t.Cleanup(func() {
		_, _ = conn.Exec(context.Background(), `DELETE FROM scheduled_messages WHERE mailbox_id = $1`, mailboxID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM drafts WHERE mailbox_id = $1`, mailboxID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM sessions WHERE user_id = $1`, userID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM mailboxes WHERE id = $1`, mailboxID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, userID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM domains WHERE id = $1`, domainID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM organizations WHERE id = $1`, orgID)
	})

	reqPK := httptest.NewRequest("POST", fmt.Sprintf("/v1/mailboxes/%s/scheduled/%s/cancel", mailboxID, schedPK), nil)
	reqPK.SetPathValue("mailbox_id", mailboxID)
	reqPK.SetPathValue("id", schedPK)
	reqPK.Header.Set("Authorization", "Bearer "+token)
	wPK := httptest.NewRecorder()
	mailboxScheduledCancelHandler(wPK, reqPK)

	if wPK.Code != http.StatusOK {
		t.Fatalf("expected cancel to return 200, got %d: %s", wPK.Code, wPK.Body.String())
	}

	var draftCount int
	err = conn.QueryRow(ctx, `SELECT count(*) FROM drafts WHERE mailbox_id = $1`, mailboxID).Scan(&draftCount)
	if err != nil || draftCount != 1 {
		t.Fatalf("expected 1 draft created upon cancel, got count=%d, err=%v", draftCount, err)
	}
	var draftEnv []byte
	err = conn.QueryRow(ctx, `SELECT encrypted_envelope FROM drafts WHERE mailbox_id = $1 LIMIT 1`, mailboxID).Scan(&draftEnv)
	if err != nil {
		t.Fatalf("fetch draft envelope: %v", err)
	}
	if !bytes.Equal(draftEnv, sampleEnvelope) {
		t.Fatalf("expected draft envelope in DB to match retrieved sample %q, got %q", string(sampleEnvelope), string(draftEnv))
	}
}

func TestMigration042BackfillsOrDeletes(t *testing.T) {
	conn := getTestDB(t)
	defer conn.Close(context.Background())
	ctx := context.Background()

	var invalidRowCount int
	err := conn.QueryRow(ctx, `
		SELECT count(*) FROM scheduled_messages
		WHERE draft_storage_ref IS NULL OR draft_storage_ref = '' OR draft_storage_ref NOT LIKE 'mailboxes/%'
	`).Scan(&invalidRowCount)
	if err != nil {
		t.Fatalf("check migration constraint: %v", err)
	}
	if invalidRowCount != 0 {
		t.Fatalf("expected 0 invalid or empty draft_storage_ref rows in database, got %d", invalidRowCount)
	}
}

func TestScheduledCancelOnlyByID(t *testing.T) {
	conn := getTestDB(t)
	defer conn.Close(context.Background())
	ctx := context.Background()

	orgID, userID, domainID, mailboxID := createThreadingTestMailbox(t, conn)
	_ = orgID

	token, tokenHash := generateSessionToken()
	_, err := conn.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
		userID, tokenHash, time.Now().Add(24*time.Hour))
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	schedPK := uuid.New().String()
	deliveryID := uuid.New().String()
	futureTime := time.Now().Add(2 * time.Hour)
	storageKey := fmt.Sprintf("mailboxes/%s/scheduled/%s.draft.enc", mailboxID, schedPK)

	_, err = conn.Exec(ctx, `
		INSERT INTO scheduled_messages (
			id, delivery_id, mailbox_id, domain_id, recipient, scheduled_at, send_at, status, expires_at, is_path_a, send_token_hash, draft_storage_ref, subject
		) VALUES (
			$1, $2, $3, $4, 'recipient@test.local', $5, $5, 'pending', $6, false, decode('', 'hex'), $7, 'Test Subject'
		)
	`, schedPK, deliveryID, mailboxID, domainID, futureTime, futureTime.Add(24*time.Hour), storageKey)
	if err != nil {
		t.Fatalf("insert scheduled message: %v", err)
	}

	t.Cleanup(func() {
		_, _ = conn.Exec(context.Background(), `DELETE FROM scheduled_messages WHERE mailbox_id = $1`, mailboxID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM drafts WHERE mailbox_id = $1`, mailboxID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM sessions WHERE user_id = $1`, userID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM mailboxes WHERE id = $1`, mailboxID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, userID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM domains WHERE id = $1`, domainID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM organizations WHERE id = $1`, orgID)
	})

	// 1. Regression test: Attempt cancel by delivery_id MUST FAIL with 404
	reqDelivery := httptest.NewRequest("POST", fmt.Sprintf("/v1/mailboxes/%s/scheduled/%s/cancel", mailboxID, deliveryID), nil)
	reqDelivery.SetPathValue("mailbox_id", mailboxID)
	reqDelivery.SetPathValue("id", deliveryID)
	reqDelivery.Header.Set("Authorization", "Bearer "+token)
	wDelivery := httptest.NewRecorder()
	mailboxScheduledCancelHandler(wDelivery, reqDelivery)

	if wDelivery.Code != http.StatusNotFound {
		t.Fatalf("expected cancel by delivery_id to return 404, got %d: %s", wDelivery.Code, wDelivery.Body.String())
	}

	// 2. Cancel by scheduled_messages.id (UUID primary key) MUST SUCCEED with 200
	reqPK := httptest.NewRequest("POST", fmt.Sprintf("/v1/mailboxes/%s/scheduled/%s/cancel", mailboxID, schedPK), nil)
	reqPK.SetPathValue("mailbox_id", mailboxID)
	reqPK.SetPathValue("id", schedPK)
	reqPK.Header.Set("Authorization", "Bearer "+token)
	wPK := httptest.NewRecorder()
	mailboxScheduledCancelHandler(wPK, reqPK)

	if wPK.Code != http.StatusOK {
		t.Fatalf("expected cancel by primary key id to return 200, got %d: %s", wPK.Code, wPK.Body.String())
	}
}

func TestScheduledUpdateOnlyByID(t *testing.T) {
	conn := getTestDB(t)
	defer conn.Close(context.Background())
	ctx := context.Background()

	orgID, userID, domainID, mailboxID := createThreadingTestMailbox(t, conn)
	_ = orgID

	token, tokenHash := generateSessionToken()
	_, err := conn.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
		userID, tokenHash, time.Now().Add(24*time.Hour))
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	schedPK := uuid.New().String()
	deliveryID := uuid.New().String()
	initialTime := time.Now().Add(2 * time.Hour).Truncate(time.Second)
	storageKey := fmt.Sprintf("mailboxes/%s/scheduled/%s.draft.enc", mailboxID, schedPK)

	_, err = conn.Exec(ctx, `
		INSERT INTO scheduled_messages (
			id, delivery_id, mailbox_id, domain_id, recipient, scheduled_at, send_at, status, expires_at, is_path_a, send_token_hash, draft_storage_ref, subject
		) VALUES (
			$1, $2, $3, $4, 'recipient@test.local', $5, $5, 'pending', $6, false, decode('', 'hex'), $7, 'Initial Subject'
		)
	`, schedPK, deliveryID, mailboxID, domainID, initialTime, initialTime.Add(24*time.Hour), storageKey)
	if err != nil {
		t.Fatalf("insert scheduled message: %v", err)
	}

	t.Cleanup(func() {
		_, _ = conn.Exec(context.Background(), `DELETE FROM scheduled_messages WHERE mailbox_id = $1`, mailboxID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM sessions WHERE user_id = $1`, userID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM mailboxes WHERE id = $1`, mailboxID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, userID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM domains WHERE id = $1`, domainID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM organizations WHERE id = $1`, orgID)
	})

	// 1. Attempt update by delivery_id MUST FAIL with 404
	updateBody := fmt.Sprintf(`{"draft_storage_ref":%q,"subject":"New Subject"}`, storageKey)
	reqDelivery := httptest.NewRequest("PUT", fmt.Sprintf("/v1/mailboxes/%s/scheduled/%s", mailboxID, deliveryID), strings.NewReader(updateBody))
	reqDelivery.SetPathValue("mailbox_id", mailboxID)
	reqDelivery.SetPathValue("id", deliveryID)
	reqDelivery.Header.Set("Authorization", "Bearer "+token)
	reqDelivery.Header.Set("Content-Type", "application/json")
	wDelivery := httptest.NewRecorder()
	mailboxScheduledItemHandler(wDelivery, reqDelivery)

	if wDelivery.Code != http.StatusNotFound {
		t.Fatalf("expected update by delivery_id to return 404, got %d: %s", wDelivery.Code, wDelivery.Body.String())
	}

	// 2. Update with body/subject change by primary key id MUST SUCCEED (200)
	reqPK := httptest.NewRequest("PUT", fmt.Sprintf("/v1/mailboxes/%s/scheduled/%s", mailboxID, schedPK), strings.NewReader(updateBody))
	reqPK.SetPathValue("mailbox_id", mailboxID)
	reqPK.SetPathValue("id", schedPK)
	reqPK.Header.Set("Authorization", "Bearer "+token)
	reqPK.Header.Set("Content-Type", "application/json")
	wPK := httptest.NewRecorder()
	mailboxScheduledItemHandler(wPK, reqPK)

	if wPK.Code != http.StatusOK {
		t.Fatalf("expected update by PK to return 200, got %d: %s", wPK.Code, wPK.Body.String())
	}
}

func TestScheduleEndToEndPathA(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	vec := loadSignedVector(t)
	_, senderMailboxID, senderToken, recipientMailboxID, _ := setupInternalDeliveryTest(t, db, vec)

	var recordedObjectKey string
	var recordedMailboxID string
	mockStorage := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/store" {
			var body map[string]interface{}
			_ = json.NewDecoder(r.Body).Decode(&body)
			recordedObjectKey = fmt.Sprintf("%v", body["object_key"])
			recordedMailboxID = fmt.Sprintf("%v", body["mailbox_id"])
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]string{"status": "stored", "object_key": recordedObjectKey})
			return
		}
		http.NotFound(w, r)
	}))
	defer mockStorage.Close()

	origStorageURL := os.Getenv("STORAGE_WORKER_URL")
	os.Setenv("STORAGE_WORKER_URL", mockStorage.URL)
	t.Cleanup(func() {
		os.Setenv("STORAGE_WORKER_URL", origStorageURL)
	})

	ctx := context.Background()
	conn, err := pgx.Connect(ctx, testDSN)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer conn.Close(ctx)

	recipientEmail, err := recipientAddrFromMailboxID(ctx, conn, recipientMailboxID)
	if err != nil {
		t.Fatalf("lookup recipient addr: %v", err)
	}

	testDraftPayload := []byte(`{"to":"recipient@test.local","subject":"Scheduled Subject","body":"Scheduled Body"}`)
	testDraftB64 := base64.StdEncoding.EncodeToString(testDraftPayload)

	deliverAt := time.Now().Add(10 * time.Minute).UTC().Format(time.RFC3339)
	reqBody := map[string]string{
		"mailbox_id":     senderMailboxID,
		"recipient":      recipientEmail,
		"envelope_json":  vec.EnvelopeJSON,
		"deliver_at":     deliverAt,
		"draft_envelope": testDraftB64,
		"subject":        "Scheduled Subject",
	}
	bodyJSON, _ := json.Marshal(reqBody)
	req := httptest.NewRequest(http.MethodPost, "/v1/outbound/schedule-path-a", bytes.NewReader(bodyJSON))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+senderToken)

	mux := setupSchedulePathAMux()
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp struct {
		ID          string `json:"id"`
		ScheduledAt string `json:"scheduled_at"`
		Status      string `json:"status"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.ID == "" {
		t.Fatal("expected non-empty id")
	}

	// 1. Assert storage-worker was called with the correct object_key
	expectedObjectKey := fmt.Sprintf("mailboxes/%s/scheduled/%s.draft.enc", senderMailboxID, resp.ID)
	if recordedObjectKey != expectedObjectKey {
		t.Errorf("expected storage object_key=%s, got %s", expectedObjectKey, recordedObjectKey)
	}
	if recordedMailboxID != senderMailboxID {
		t.Errorf("expected storage mailbox_id=%s, got %s", senderMailboxID, recordedMailboxID)
	}

	// 2. Assert DB row written with the correct ref and UUID primary key
	var storedRef string
	var isPathA bool
	err = conn.QueryRow(ctx, `SELECT draft_storage_ref, is_path_a FROM scheduled_messages WHERE id = $1`, resp.ID).Scan(&storedRef, &isPathA)
	if err != nil {
		t.Fatalf("query scheduled_messages: %v", err)
	}
	if storedRef != expectedObjectKey {
		t.Errorf("expected DB draft_storage_ref=%s, got %s", expectedObjectKey, storedRef)
	}
	if !isPathA {
		t.Error("expected is_path_a=true")
	}
}

func TestScheduleFailsWhenStorageWorkerDown(t *testing.T) {
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

	t.Cleanup(func() {
		_, _ = conn.Exec(context.Background(), `DELETE FROM scheduled_messages WHERE mailbox_id = $1`, mailboxID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM outbound_reservations WHERE mailbox_id = $1`, mailboxID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM sessions WHERE user_id = $1`, userID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM mailboxes WHERE id = $1`, mailboxID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, userID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM domains WHERE id = $1`, domainID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM organizations WHERE id = $1`, orgID)
	})

	// Storage worker server unreachable / closed
	mockStorageDown := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "customer storage outage", http.StatusInternalServerError)
	}))
	mockStorageDown.Close()

	origStorageURL := os.Getenv("STORAGE_WORKER_URL")
	os.Setenv("STORAGE_WORKER_URL", mockStorageDown.URL)
	t.Cleanup(func() {
		os.Setenv("STORAGE_WORKER_URL", origStorageURL)
	})

	reservationID := uuid.New().String()
	_, err = conn.Exec(ctx, `
		INSERT INTO outbound_reservations (
			reservation_id, user_id, mailbox_id, outbox_seq,
			encryption_version, aad_version, status, expires_at
		) VALUES ($1, $2, $3, 1, 1, 1, 'reserved', now() + interval '1 hour')
	`, reservationID, userID, mailboxID)
	if err != nil {
		t.Fatalf("insert reservation: %v", err)
	}

	iv := make([]byte, 12)
	iv[0] = 0x42
	encMsg := make([]byte, 32)
	encMsg[0] = 0x01
	copy(encMsg[1:13], iv)
	sendToken := make([]byte, 50)
	sendToken[0] = 0x01

	reqData := map[string]interface{}{
		"reservation_id":     reservationID,
		"mailbox_id":         mailboxID,
		"recipient":          "recipient@test.local",
		"encrypted_message":  base64.StdEncoding.EncodeToString(encMsg),
		"send_token_wrapped": base64.StdEncoding.EncodeToString(sendToken),
		"outbox_seq":         1,
		"encryption_version": 1,
		"aad_version":        1,
		"encryption_iv":      base64.StdEncoding.EncodeToString(iv),
		"scheduled_at":       time.Now().Add(2 * time.Hour).Format(time.RFC3339),
		"draft_envelope":     base64.StdEncoding.EncodeToString([]byte("payload")),
	}
	bodyJSON, _ := json.Marshal(reqData)
	req := httptest.NewRequest("POST", "/v1/outbound/schedule", bytes.NewReader(bodyJSON))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	outboundScheduleHandler(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 Internal Server Error when storage fails, got %d: %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "schedule: storage upload failed") {
		t.Fatalf("expected error message to identify failing step 'schedule: storage upload failed', got: %s", w.Body.String())
	}

	// Assert no row committed to scheduled_messages
	var count int
	_ = conn.QueryRow(ctx, `SELECT count(*) FROM scheduled_messages WHERE reservation_id = $1`, reservationID).Scan(&count)
	if count != 0 {
		t.Errorf("expected 0 scheduled_messages rows on storage failure, got %d", count)
	}
}

func TestScheduleFailsWhenDBInsertRejectsRef(t *testing.T) {
	conn := getTestDB(t)
	defer conn.Close(context.Background())
	ctx := context.Background()

	orgID, _, domainID, mailboxID := createThreadingTestMailbox(t, conn)
	_ = orgID
	invalidID := uuid.New().String()

	// Malformed ref that does NOT start with 'mailboxes/' MUST fail the CHECK constraint
	_, err := conn.Exec(ctx, `
		INSERT INTO scheduled_messages (
			id, mailbox_id, domain_id, recipient,
			scheduled_at, status, expires_at, is_path_a, send_token_hash, envelope_json, draft_storage_ref
		) VALUES (
			$1, $2, $3, 'rcpt@test.local', now() + interval '1 hour', 'pending', now() + interval '24 hours', true, decode('', 'hex'), '{"v":1}', 'invalid_non_prefixed_ref'
		)
	`, invalidID, mailboxID, domainID)

	if err == nil {
		t.Fatal("expected CHECK constraint violation for malformed draft_storage_ref, but insert succeeded")
	}
	if !strings.Contains(err.Error(), "scheduled_messages_draft_storage_ref_valid") && !strings.Contains(err.Error(), "check constraint") {
		t.Fatalf("expected check constraint error, got: %v", err)
	}
}

func TestScheduleUUIDConsistency(t *testing.T) {
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

	t.Cleanup(func() {
		_, _ = conn.Exec(context.Background(), `DELETE FROM scheduled_messages WHERE mailbox_id = $1`, mailboxID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM outbound_reservations WHERE mailbox_id = $1`, mailboxID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM sessions WHERE user_id = $1`, userID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM mailboxes WHERE id = $1`, mailboxID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, userID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM domains WHERE id = $1`, domainID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM organizations WHERE id = $1`, orgID)
	})

	var uploadedObjectKey string
	mockStorage := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req map[string]interface{}
		_ = json.NewDecoder(r.Body).Decode(&req)
		uploadedObjectKey = fmt.Sprintf("%v", req["object_key"])
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "stored", "object_key": uploadedObjectKey})
	}))
	defer mockStorage.Close()

	origStorageURL := os.Getenv("STORAGE_WORKER_URL")
	os.Setenv("STORAGE_WORKER_URL", mockStorage.URL)
	t.Cleanup(func() {
		os.Setenv("STORAGE_WORKER_URL", origStorageURL)
	})

	reservationID := uuid.New().String()
	_, err = conn.Exec(ctx, `
		INSERT INTO outbound_reservations (
			reservation_id, user_id, mailbox_id, outbox_seq,
			encryption_version, aad_version, status, expires_at
		) VALUES ($1, $2, $3, 1, 1, 1, 'reserved', now() + interval '1 hour')
	`, reservationID, userID, mailboxID)
	if err != nil {
		t.Fatalf("insert reservation: %v", err)
	}

	iv := make([]byte, 12)
	iv[0] = 0x42
	encMsg := make([]byte, 32)
	encMsg[0] = 0x01
	copy(encMsg[1:13], iv)
	sendToken := make([]byte, 50)
	sendToken[0] = 0x01

	reqData := map[string]interface{}{
		"reservation_id":     reservationID,
		"mailbox_id":         mailboxID,
		"recipient":          "recipient@test.local",
		"encrypted_message":  base64.StdEncoding.EncodeToString(encMsg),
		"send_token_wrapped": base64.StdEncoding.EncodeToString(sendToken),
		"outbox_seq":         1,
		"encryption_version": 1,
		"aad_version":        1,
		"encryption_iv":      base64.StdEncoding.EncodeToString(iv),
		"scheduled_at":       time.Now().Add(2 * time.Hour).Format(time.RFC3339),
		"draft_envelope":     base64.StdEncoding.EncodeToString([]byte("payload")),
	}
	bodyJSON, _ := json.Marshal(reqData)
	req := httptest.NewRequest("POST", "/v1/outbound/schedule", bytes.NewReader(bodyJSON))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	outboundScheduleHandler(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(w.Body.Bytes(), &resp)
	if resp.ID == "" {
		t.Fatal("response ID is empty")
	}

	// Assert the exact same UUID appears in the storage object_key
	expectedObjectKey := fmt.Sprintf("mailboxes/%s/scheduled/%s.draft.enc", mailboxID, resp.ID)
	if uploadedObjectKey != expectedObjectKey {
		t.Fatalf("expected storage object_key=%s, got %s", expectedObjectKey, uploadedObjectKey)
	}

	// Assert the exact same UUID appears in the DB row and points to that object key
	var dbRef string
	err = conn.QueryRow(ctx, `SELECT draft_storage_ref FROM scheduled_messages WHERE id = $1`, resp.ID).Scan(&dbRef)
	if err != nil {
		t.Fatalf("failed to query row by resp.ID %s: %v", resp.ID, err)
	}
	if dbRef != expectedObjectKey {
		t.Fatalf("expected DB draft_storage_ref=%s, got %s", expectedObjectKey, dbRef)
	}
}
