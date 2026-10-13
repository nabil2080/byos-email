package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Test 1: TestImportBegin_Unauthorized
func TestImportBegin_Unauthorized(t *testing.T) {
	req := httptest.NewRequest(http.MethodPost, "/v1/import/begin", bytes.NewReader([]byte(`{"provider":"gmail","mailbox_id":"00000000-0000-0000-0000-000000000000"}`)))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	importBeginHandler(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized, got %d; body: %s", rec.Code, rec.Body.String())
	}
}

// Test 2: TestImportBegin_Success
func TestImportBegin_Success(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, orgID, ownerID, "import-begin")
	token := createTestSession(t, db, ownerID)

	body, _ := json.Marshal(map[string]string{
		"provider":   "gmail",
		"mailbox_id": mailboxID,
	})
	req := httptest.NewRequest(http.MethodPost, "/v1/import/begin", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	rec := httptest.NewRecorder()

	importBeginHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d; body: %s", rec.Code, rec.Body.String())
	}

	var resp struct {
		AuthURL string `json:"auth_url"`
		State   string `json:"state"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.AuthURL == "" || !strings.Contains(resp.AuthURL, "accounts.google.com") {
		t.Fatalf("expected google auth_url, got: %q", resp.AuthURL)
	}
	if resp.State == "" {
		t.Fatalf("expected state token, got empty")
	}
}

// Test 3: TestImportOAuthCallback_TokenExchange
func TestImportOAuthCallback_TokenExchange(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, orgID, ownerID, "import-cb")
	token := createTestSession(t, db, ownerID)

	// Mock token exchange server
	mockOAuth := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth/token" && r.Method == http.MethodPost {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"access_token":  "mock-access-token-12345",
				"refresh_token": "mock-refresh-token-67890",
				"expires_in":    3600,
				"token_type":    "Bearer",
			})
			return
		}
		http.NotFound(w, r)
	}))
	defer mockOAuth.Close()
	t.Setenv("OAUTH_MOCK_URL", mockOAuth.URL)
	t.Setenv("WEBMAIL_ORIGIN", "http://localhost:3001")

	// Begin import to establish state
	beginBody, _ := json.Marshal(map[string]string{
		"provider":   "gmail",
		"mailbox_id": mailboxID,
	})
	beginReq := httptest.NewRequest(http.MethodPost, "/v1/import/begin", bytes.NewReader(beginBody))
	beginReq.Header.Set("Content-Type", "application/json")
	beginReq.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	beginRec := httptest.NewRecorder()
	importBeginHandler(beginRec, beginReq)

	var beginResp struct {
		State string `json:"state"`
	}
	if err := json.NewDecoder(beginRec.Body).Decode(&beginResp); err != nil {
		t.Fatalf("decode begin: %v", err)
	}

	// Trigger callback
	cbReq := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/v1/import/oauth/callback?code=mock-auth-code&state=%s", beginResp.State), nil)
	cbRec := httptest.NewRecorder()
	importOAuthCallbackHandler(cbRec, cbReq)

	if cbRec.Code != http.StatusFound {
		t.Fatalf("expected 302 Found redirect, got %d; body: %s", cbRec.Code, cbRec.Body.String())
	}

	loc := cbRec.Header().Get("Location")
	if !strings.HasPrefix(loc, "http://localhost:3001/import/callback#") {
		t.Fatalf("unexpected redirect location: %q", loc)
	}
	if !strings.Contains(loc, "access_token=mock-access-token-12345") {
		t.Fatalf("location missing access_token: %q", loc)
	}
	if !strings.Contains(loc, "refresh_token=mock-refresh-token-67890") {
		t.Fatalf("location missing refresh_token: %q", loc)
	}
	if !strings.Contains(loc, "provider=gmail") {
		t.Fatalf("location missing provider: %q", loc)
	}
}

// Test 4: TestImportMessage_Idempotent
func TestImportMessage_Idempotent(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, orgID, ownerID, "import-msg")
	token := createTestSession(t, db, ownerID)

	reqPayload := ImportMessageRequest{
		SourceProvider:      "gmail",
		SourceMessageID:     "msg_test_id_999",
		StorageObjectID:     fmt.Sprintf("mailboxes/%s/imported/gmail/msg_test_id_999.eml.enc", mailboxID),
		Sender:              "alice@example.com",
		Recipients:          []string{"user@byos.local"},
		Folder:              "inbox",
		IsRead:              true,
		IsStarred:           false,
		SizeBytes:           4096,
		ReceivedAt:          "2024-03-01T10:00:00Z",
		WrappedKeyAlgorithm: "byos-imported-v1",
	}
	payloadBytes, _ := json.Marshal(reqPayload)

	// First insert: 201 Created
	req1 := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mailboxID+"/import-message", bytes.NewReader(payloadBytes))
	req1.SetPathValue("mailbox_id", mailboxID)
	req1.Header.Set("Content-Type", "application/json")
	req1.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	rec1 := httptest.NewRecorder()
	importMessageHandler(rec1, req1)

	if rec1.Code != http.StatusCreated {
		t.Fatalf("first insert expected 201, got %d; body: %s", rec1.Code, rec1.Body.String())
	}

	var res1 struct {
		Status     string `json:"status"`
		Imported   bool   `json:"imported"`
		MessageID  string `json:"message_id"`
		MessageSeq int64  `json:"message_seq"`
	}
	if err := json.NewDecoder(rec1.Body).Decode(&res1); err != nil {
		t.Fatalf("decode res1: %v", err)
	}
	if !res1.Imported || res1.Status != "imported" || res1.MessageID == "" {
		t.Fatalf("unexpected res1 payload: %+v", res1)
	}

	// Second insert: 200 OK (idempotent duplicate skip)
	req2 := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mailboxID+"/import-message", bytes.NewReader(payloadBytes))
	req2.SetPathValue("mailbox_id", mailboxID)
	req2.Header.Set("Content-Type", "application/json")
	req2.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	rec2 := httptest.NewRecorder()
	importMessageHandler(rec2, req2)

	if rec2.Code != http.StatusOK {
		t.Fatalf("second insert expected 200, got %d; body: %s", rec2.Code, rec2.Body.String())
	}

	var res2 struct {
		Status    string `json:"status"`
		Imported  bool   `json:"imported"`
		Reason    string `json:"reason"`
		MessageID string `json:"message_id"`
	}
	if err := json.NewDecoder(rec2.Body).Decode(&res2); err != nil {
		t.Fatalf("decode res2: %v", err)
	}
	if res2.Imported || res2.Status != "already_imported" || res2.Reason != "duplicate" || res2.MessageID != res1.MessageID {
		t.Fatalf("unexpected duplicate response: %+v (want message_id %s)", res2, res1.MessageID)
	}
}

// Test 5: TestImportJobLifecycle
func TestImportJobLifecycle(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, orgID, ownerID, "import-job")
	token := createTestSession(t, db, ownerID)

	// Create job
	createBody, _ := json.Marshal(map[string]interface{}{
		"mailbox_id":     mailboxID,
		"provider":       "gmail",
		"total_messages": 100,
	})
	createReq := httptest.NewRequest(http.MethodPost, "/v1/import/jobs", bytes.NewReader(createBody))
	createReq.Header.Set("Content-Type", "application/json")
	createReq.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	createRec := httptest.NewRecorder()
	importJobCreateHandler(createRec, createReq)

	if createRec.Code != http.StatusCreated {
		t.Fatalf("create job expected 201, got %d; body: %s", createRec.Code, createRec.Body.String())
	}
	var createRes struct {
		JobID  string `json:"job_id"`
		Status string `json:"status"`
	}
	if err := json.NewDecoder(createRec.Body).Decode(&createRes); err != nil {
		t.Fatalf("decode job: %v", err)
	}
	if createRes.JobID == "" || createRes.Status != "running" {
		t.Fatalf("invalid job created: %+v", createRes)
	}

	// List jobs
	listReq := httptest.NewRequest(http.MethodGet, "/v1/import/jobs?mailbox_id="+mailboxID, nil)
	listReq.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	listRec := httptest.NewRecorder()
	importJobListHandler(listRec, listReq)

	if listRec.Code != http.StatusOK {
		t.Fatalf("list jobs expected 200, got %d; body: %s", listRec.Code, listRec.Body.String())
	}
	var listRes struct {
		Jobs []struct {
			ID     string `json:"id"`
			Status string `json:"status"`
		} `json:"jobs"`
	}
	if err := json.NewDecoder(listRec.Body).Decode(&listRes); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(listRes.Jobs) == 0 || listRes.Jobs[0].ID != createRes.JobID {
		t.Fatalf("job not listed: %+v", listRes)
	}

	// Complete job
	compBody, _ := json.Marshal(map[string]interface{}{
		"job_id":            createRes.JobID,
		"status":            "completed",
		"imported_messages": 95,
		"skipped_messages":  5,
		"failed_messages":   0,
	})
	compReq := httptest.NewRequest(http.MethodPost, "/v1/import/complete", bytes.NewReader(compBody))
	compReq.Header.Set("Content-Type", "application/json")
	compReq.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	compRec := httptest.NewRecorder()
	importJobCompleteHandler(compRec, compReq)

	if compRec.Code != http.StatusOK {
		t.Fatalf("complete job expected 200, got %d; body: %s", compRec.Code, compRec.Body.String())
	}
}

// Test 6: TestMailboxStorage_ScopeEnforcement
func TestMailboxStorage_ScopeEnforcement(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, orgID, ownerID, "storage-scope")
	token := createTestSession(t, db, ownerID)

	// Attempt to store with invalid X-Object-Key (outside mailbox scope)
	badReq := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mailboxID+"/storage/store", bytes.NewReader([]byte("secret")))
	badReq.SetPathValue("mailbox_id", mailboxID)
	badReq.Header.Set("X-Object-Key", "mailboxes/other-mailbox-uuid/oauth/gmail.enc")
	badReq.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	badRec := httptest.NewRecorder()
	mailboxStorageStoreHandler(badRec, badReq)

	if badRec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for out-of-scope store key, got %d; body: %s", badRec.Code, badRec.Body.String())
	}

	// Path traversal attempt
	travReq := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mailboxID+"/storage/store", bytes.NewReader([]byte("secret")))
	travReq.SetPathValue("mailbox_id", mailboxID)
	travReq.Header.Set("X-Object-Key", fmt.Sprintf("mailboxes/%s/../other/secret.enc", mailboxID))
	travReq.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	travRec := httptest.NewRecorder()
	mailboxStorageStoreHandler(travRec, travReq)

	if travRec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for traversal store key, got %d", travRec.Code)
	}

	// Valid store forwarding
	var storeCalled bool
	mockStorageWorker := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/store" {
			storeCalled = true
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
			return
		}
		http.NotFound(w, r)
	}))
	defer mockStorageWorker.Close()
	t.Setenv("STORAGE_WORKER_URL", mockStorageWorker.URL)

	validReq := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mailboxID+"/storage/store", bytes.NewReader([]byte("ciphertext")))
	validReq.SetPathValue("mailbox_id", mailboxID)
	validReq.Header.Set("X-Object-Key", fmt.Sprintf("mailboxes/%s/oauth/gmail.enc", mailboxID))
	validReq.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	validRec := httptest.NewRecorder()
	mailboxStorageStoreHandler(validRec, validReq)

	if validRec.Code != http.StatusOK {
		t.Fatalf("expected 200 for valid store key, got %d; body: %s", validRec.Code, validRec.Body.String())
	}
	if !storeCalled {
		t.Fatalf("expected storage-worker to be invoked for valid store")
	}
}
