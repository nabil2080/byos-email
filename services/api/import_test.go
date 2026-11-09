package main

import (
	"bytes"
	"encoding/base64"
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

	validEnvelope := make([]byte, 29)
	validEnvelope[0] = 0x01
	for i := 1; i < 29; i++ {
		validEnvelope[i] = byte(i)
	}
	validReq := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mailboxID+"/storage/store", bytes.NewReader(validEnvelope))
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

	// Plaintext payload rejected (FINDING-02)
	plainReq := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mailboxID+"/storage/store", bytes.NewReader([]byte("From: user@byos.local\r\n\r\nPlaintext")))
	plainReq.SetPathValue("mailbox_id", mailboxID)
	plainReq.Header.Set("X-Object-Key", fmt.Sprintf("mailboxes/%s/oauth/gmail.enc", mailboxID))
	plainReq.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	plainRec := httptest.NewRecorder()
	mailboxStorageStoreHandler(plainRec, plainReq)
	if plainRec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for plaintext upload, got %d", plainRec.Code)
	}

	// Degenerate binary envelope (all-zero nonce) rejected (FINDING-02)
	degenEnvelope := make([]byte, 29)
	degenEnvelope[0] = 0x01
	degenReq := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mailboxID+"/storage/store", bytes.NewReader(degenEnvelope))
	degenReq.SetPathValue("mailbox_id", mailboxID)
	degenReq.Header.Set("X-Object-Key", fmt.Sprintf("mailboxes/%s/oauth/gmail.enc", mailboxID))
	degenReq.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	degenRec := httptest.NewRecorder()
	mailboxStorageStoreHandler(degenRec, degenReq)
	if degenRec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for degenerate envelope upload, got %d", degenRec.Code)
	}

	// Malformed JSON envelope rejected (FINDING-02)
	badJSONReq := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mailboxID+"/storage/store", bytes.NewReader([]byte(`{"alg":"unknown","data":"bad"}`)))
	badJSONReq.SetPathValue("mailbox_id", mailboxID)
	badJSONReq.Header.Set("X-Object-Key", fmt.Sprintf("mailboxes/%s/oauth/gmail.enc", mailboxID))
	badJSONReq.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	badJSONRec := httptest.NewRecorder()
	mailboxStorageStoreHandler(badJSONRec, badJSONReq)
	if badJSONRec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for malformed JSON envelope upload, got %d", badJSONRec.Code)
	}

	// Unauthorized path for user session rejected (FINDING-02)
	unauthPathReq := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mailboxID+"/storage/store", bytes.NewReader(validEnvelope))
	unauthPathReq.SetPathValue("mailbox_id", mailboxID)
	unauthPathReq.Header.Set("X-Object-Key", fmt.Sprintf("mailboxes/%s/arbitrary_file.txt", mailboxID))
	unauthPathReq.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	unauthPathRec := httptest.NewRecorder()
	mailboxStorageStoreHandler(unauthPathRec, unauthPathReq)
	if unauthPathRec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for unauthorized storage path, got %d", unauthPathRec.Code)
	}
}

// TestAdversarialGenericStorageEnvelopes tests adversarial inputs against generic storage upload endpoints
// (/v1/mailboxes/{mailbox_id}/storage/store), asserting structural validation, path bounds, and trust boundaries.
func TestAdversarialGenericStorageEnvelopes(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, orgID, ownerID, "adv-storage")
	token := createTestSession(t, db, ownerID)

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

	validKey := fmt.Sprintf("mailboxes/%s/oauth/gmail.enc", mailboxID)

	// 1. Adversarial binary payload: 0x01 + 12B IV + readable text + 16B tag
	// Passes structural validation (demonstrating format validation vs cryptographic verification)
	advBinary := make([]byte, 1+12+44+16)
	advBinary[0] = 0x01
	for i := 1; i <= 12; i++ {
		advBinary[i] = byte((i * 13) ^ 0x47)
	}
	copy(advBinary[13:], []byte("Arbitrary readable data in ciphertext region"))
	for i := len(advBinary) - 16; i < len(advBinary); i++ {
		advBinary[i] = byte((i * 29) ^ 0x8b)
	}

	req1 := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mailboxID+"/storage/store", bytes.NewReader(advBinary))
	req1.SetPathValue("mailbox_id", mailboxID)
	req1.Header.Set("X-Object-Key", validKey)
	req1.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	rec1 := httptest.NewRecorder()
	mailboxStorageStoreHandler(rec1, req1)
	if rec1.Code != http.StatusOK {
		t.Fatalf("expected 200 for framed readable text (demonstrating structural framing limits), got %d: %s", rec1.Code, rec1.Body.String())
	}
	if !storeCalled {
		t.Fatalf("expected storage worker to be called")
	}

	// 2. Plaintext without 0x01 framing is rejected (400)
	plainReq := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mailboxID+"/storage/store", bytes.NewReader([]byte("Plain text without 0x01 framing byte")))
	plainReq.SetPathValue("mailbox_id", mailboxID)
	plainReq.Header.Set("X-Object-Key", validKey)
	plainReq.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	rec2 := httptest.NewRecorder()
	mailboxStorageStoreHandler(rec2, plainReq)
	if rec2.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for unframed plaintext, got %d", rec2.Code)
	}

	// 3. Truncated binary envelope (< 29 bytes) is rejected (400)
	shortReq := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mailboxID+"/storage/store", bytes.NewReader([]byte{0x01, 0x02, 0x03}))
	shortReq.SetPathValue("mailbox_id", mailboxID)
	shortReq.Header.Set("X-Object-Key", validKey)
	shortReq.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	rec3 := httptest.NewRecorder()
	mailboxStorageStoreHandler(rec3, shortReq)
	if rec3.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for truncated envelope, got %d", rec3.Code)
	}

	// 4. Unsupported binary version is rejected (400)
	badVerReq := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mailboxID+"/storage/store", bytes.NewReader(make([]byte, 30)))
	badVerReq.SetPathValue("mailbox_id", mailboxID)
	badVerReq.Header.Set("X-Object-Key", validKey)
	badVerReq.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	rec4 := httptest.NewRecorder()
	mailboxStorageStoreHandler(rec4, badVerReq)
	if rec4.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for unsupported binary version, got %d", rec4.Code)
	}

	// 5. Malformed JSON envelopes are rejected (400)
	badJSONs := []string{
		`{not-valid-json`,
		`{"alg":"unsupported"}`,
		`{"version":1,"ciphertext":"!not-base64!"}`,
		`{"version":1,"ciphertext":"` + base64.StdEncoding.EncodeToString([]byte("short")) + `"}`, // ciphertext < 16 bytes tag
	}
	for _, bj := range badJSONs {
		bjReq := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mailboxID+"/storage/store", bytes.NewReader([]byte(bj)))
		bjReq.SetPathValue("mailbox_id", mailboxID)
		bjReq.Header.Set("X-Object-Key", validKey)
		bjReq.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
		bjRec := httptest.NewRecorder()
		mailboxStorageStoreHandler(bjRec, bjReq)
		if bjRec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 for bad JSON envelope %s, got %d", bj, bjRec.Code)
		}
	}

	// 6. Path traversal and cross-mailbox namespace violations are rejected (400)
	badKeys := []string{
		fmt.Sprintf("mailboxes/%s/../../etc/passwd", mailboxID),
		fmt.Sprintf("mailboxes/%s/../other/secret.enc", mailboxID),
		"mailboxes/00000000-0000-0000-0000-000000000000/oauth/gmail.enc", // cross-mailbox
		fmt.Sprintf("mailboxes/%s/unknown_prefix/data.enc", mailboxID),    // unauthorized prefix
	}
	for _, bk := range badKeys {
		bkReq := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mailboxID+"/storage/store", bytes.NewReader(advBinary))
		bkReq.SetPathValue("mailbox_id", mailboxID)
		bkReq.Header.Set("X-Object-Key", bk)
		bkReq.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
		bkRec := httptest.NewRecorder()
		mailboxStorageStoreHandler(bkRec, bkReq)
		if bkRec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 for bad key %s, got %d", bk, bkRec.Code)
		}
	}
}

func TestNotesSubpathValidation(t *testing.T) {
	if !isAllowedNotesSubpath("notes/abc-123.enc") {
		t.Fatalf("expected notes/abc-123.enc to be allowed")
	}
	if !isAllowedNotesSubpath("notes/media/drawing_123.enc") {
		t.Fatalf("expected notes/media/drawing_123.enc to be allowed")
	}
	if !isAllowedNotesSubpath("notes/manifest.enc") {
		t.Fatalf("expected notes/manifest.enc to be allowed")
	}
	if isAllowedNotesSubpath("notes/../evil.enc") {
		t.Fatalf("expected notes/../evil.enc to be rejected")
	}
	if isAllowedNotesSubpath("notes/plain.txt") {
		t.Fatalf("expected notes/plain.txt to be rejected")
	}
	if isAllowedNotesSubpath("oauth/gmail.enc") {
		t.Fatalf("expected oauth/gmail.enc to be rejected")
	}
	if isAllowedNotesSubpath("notes/bad$name.enc") {
		t.Fatalf("expected notes/bad$name.enc to be rejected")
	}
}

func TestNotesStorageSyncEndpoints(t *testing.T) {
	// Integration with test database if available
	db := setupTestDB(t)
	defer db.Close()
	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, orgID, ownerID, "notes-sync-box")
	token := createTestSession(t, db, ownerID)

	var lastRequestedPath string
	mockStorageWorker := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		lastRequestedPath = r.URL.Path
		if r.URL.Path == "/api/store" {
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
			return
		}
		if r.URL.Path == "/api/list" {
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"objects": []string{
					fmt.Sprintf("mailboxes/%s/notes/note-1.enc", mailboxID),
				},
				"count": 1,
			})
			return
		}
		if r.URL.Path == "/api/delete" {
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(map[string]string{"status": "deleted"})
			return
		}
		http.NotFound(w, r)
	}))
	defer mockStorageWorker.Close()
	t.Setenv("STORAGE_WORKER_URL", mockStorageWorker.URL)

	// Valid Section 12 binary envelope for notes
	noteEnvelope := make([]byte, 45)
	noteEnvelope[0] = 0x01
	for i := 1; i < 45; i++ {
		noteEnvelope[i] = byte(i * 3)
	}

	// 3. Store encrypted note under notes/ namespace
	validReq := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mailboxID+"/storage/store", bytes.NewReader(noteEnvelope))
	validReq.SetPathValue("mailbox_id", mailboxID)
	validReq.Header.Set("X-Object-Key", fmt.Sprintf("mailboxes/%s/notes/note-1.enc", mailboxID))
	validReq.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	validRec := httptest.NewRecorder()
	mailboxStorageStoreHandler(validRec, validReq)

	if validRec.Code != http.StatusOK {
		t.Fatalf("expected 200 for notes store, got %d; body: %s", validRec.Code, validRec.Body.String())
	}
	if lastRequestedPath != "/api/store" {
		t.Fatalf("expected call to /api/store, got %s", lastRequestedPath)
	}

	// 4. List notes via mailboxStorageListHandler
	listReq := httptest.NewRequest(http.MethodGet, "/v1/mailboxes/"+mailboxID+"/storage/list?prefix=notes/", nil)
	listReq.SetPathValue("mailbox_id", mailboxID)
	listReq.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	listRec := httptest.NewRecorder()
	mailboxStorageListHandler(listRec, listReq)

	if listRec.Code != http.StatusOK {
		t.Fatalf("expected 200 for notes list, got %d; body: %s", listRec.Code, listRec.Body.String())
	}
	if lastRequestedPath != "/api/list" {
		t.Fatalf("expected call to /api/list, got %s", lastRequestedPath)
	}

	// List rejection for unauthorized prefix (e.g. attempting to list root or oauth)
	badListReq := httptest.NewRequest(http.MethodGet, "/v1/mailboxes/"+mailboxID+"/storage/list?prefix=oauth/", nil)
	badListReq.SetPathValue("mailbox_id", mailboxID)
	badListReq.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	badListRec := httptest.NewRecorder()
	mailboxStorageListHandler(badListRec, badListReq)

	if badListRec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for unauthorized list prefix, got %d", badListRec.Code)
	}

	// 5. Delete note via mailboxStorageDeleteHandler
	delReq := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mailboxID+"/storage/delete", bytes.NewReader([]byte(fmt.Sprintf(`{"object_key":"mailboxes/%s/notes/note-1.enc"}`, mailboxID))))
	delReq.SetPathValue("mailbox_id", mailboxID)
	delReq.Header.Set("Content-Type", "application/json")
	delReq.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	delRec := httptest.NewRecorder()
	mailboxStorageDeleteHandler(delRec, delReq)

	if delRec.Code != http.StatusOK {
		t.Fatalf("expected 200 for notes delete, got %d; body: %s", delRec.Code, delRec.Body.String())
	}
	if lastRequestedPath != "/api/delete" {
		t.Fatalf("expected call to /api/delete, got %s", lastRequestedPath)
	}

	// Delete rejection for out-of-namespace key
	badDelReq := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mailboxID+"/storage/delete", bytes.NewReader([]byte(fmt.Sprintf(`{"object_key":"mailboxes/%s/oauth/gmail.enc"}`, mailboxID))))
	badDelReq.SetPathValue("mailbox_id", mailboxID)
	badDelReq.Header.Set("Content-Type", "application/json")
	badDelReq.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	badDelRec := httptest.NewRecorder()
	mailboxStorageDeleteHandler(badDelRec, badDelReq)

	if badDelRec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for out-of-namespace delete, got %d", badDelRec.Code)
	}
}
