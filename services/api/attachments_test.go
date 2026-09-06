package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestAttachmentsAuthentication verifies that unauthenticated requests or
// requests with invalid session tokens return 401 Unauthorized.
func TestAttachmentsAuthentication(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, orgID, ownerID, "auth")

	// 1. Unauthenticated request (no session cookie)
	req := httptest.NewRequest(http.MethodGet, "/v1/mailboxes/"+mailboxID+"/attachments", nil)
	req.SetPathValue("mailbox_id", mailboxID)
	rec := httptest.NewRecorder()
	attachmentsHandler(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated GET status = %d, want 401", rec.Code)
	}

	// 2. Invalid session cookie
	req = httptest.NewRequest(http.MethodGet, "/v1/mailboxes/"+mailboxID+"/attachments", nil)
	req.SetPathValue("mailbox_id", mailboxID)
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: "invalid-token-value"})
	rec = httptest.NewRecorder()
	attachmentsHandler(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("invalid session GET status = %d, want 401", rec.Code)
	}
}

// TestAttachmentsAuthorization verifies org isolation and mailbox access controls.
func TestAttachmentsAuthorization(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	org1ID, owner1ID, _, _ := createTestOrgWithEmail(t, db, "org1")
	org2ID, owner2ID, _, _ := createTestOrgWithEmail(t, db, "org2")
	_ = org2ID

	_, mailbox1ID := createTestMailbox(t, db, org1ID, owner1ID, "m1")

	token1 := createSession(t, db, owner1ID)
	token2 := createSession(t, db, owner2ID)

	// 1. Nonexistent mailbox -> 404
	fakeMailboxID := "00000000-0000-0000-0000-000000000000"
	req := httptest.NewRequest(http.MethodGet, "/v1/mailboxes/"+fakeMailboxID+"/attachments", nil)
	req.SetPathValue("mailbox_id", fakeMailboxID)
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: token1})
	rec := httptest.NewRecorder()
	attachmentsHandler(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("nonexistent mailbox status = %d, want 404", rec.Code)
	}

	// 2. Cross-org mailbox access -> 403 Forbidden
	req = httptest.NewRequest(http.MethodGet, "/v1/mailboxes/"+mailbox1ID+"/attachments", nil)
	req.SetPathValue("mailbox_id", mailbox1ID)
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: token2})
	rec = httptest.NewRecorder()
	attachmentsHandler(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("cross-org access status = %d, want 403", rec.Code)
	}

	// 3. Authorized owner access -> 200 OK
	req = httptest.NewRequest(http.MethodGet, "/v1/mailboxes/"+mailbox1ID+"/attachments", nil)
	req.SetPathValue("mailbox_id", mailbox1ID)
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: token1})
	rec = httptest.NewRecorder()
	attachmentsHandler(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("authorized GET status = %d, want 200", rec.Code)
	}
}

// TestAttachmentsRequestValidation verifies request parameter and payload validations.
func TestAttachmentsRequestValidation(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, orgID, ownerID, "val")
	token := createSession(t, db, ownerID)

	// 1. Invalid mailbox UUID -> 400
	req := httptest.NewRequest(http.MethodGet, "/v1/mailboxes/not-a-uuid/attachments", nil)
	req.SetPathValue("mailbox_id", "not-a-uuid")
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	rec := httptest.NewRecorder()
	attachmentsHandler(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("invalid UUID status = %d, want 400", rec.Code)
	}

	// 2. Multipart POST missing 'file' field -> 400
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	_ = writer.WriteField("message_id", "some-msg-id")
	writer.Close()

	req = httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mailboxID+"/attachments", &body)
	req.SetPathValue("mailbox_id", mailboxID)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	rec = httptest.NewRecorder()
	attachmentsHandler(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("missing file field status = %d, want 400", rec.Code)
	}

	// 3. Malformed multipart form body -> 400
	badBody := bytes.NewReader([]byte("--invalid-boundary-string"))
	req = httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mailboxID+"/attachments", badBody)
	req.SetPathValue("mailbox_id", mailboxID)
	req.Header.Set("Content-Type", "multipart/form-data; boundary=invalid-boundary-string")
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	rec = httptest.NewRecorder()
	attachmentsHandler(rec, req)
	if rec.Code != http.StatusBadRequest && rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("malformed multipart status = %d, want 400 or 413", rec.Code)
	}

	// 4. JSON metadata creation missing filename -> 400
	jsonReq := bytes.NewReader([]byte(`{"size_bytes":100}`))
	req = httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mailboxID+"/attachments", jsonReq)
	req.SetPathValue("mailbox_id", mailboxID)
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	rec = httptest.NewRecorder()
	attachmentsHandler(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("missing filename JSON status = %d, want 400", rec.Code)
	}
}

// TestAttachmentEncryptedUploadAccepted verifies the accepted flow:
// client-encrypted bytes are validated structurally and stored byte-for-byte
// with encrypted=true. Deterministic 0x01 envelope: 1 + 12 nonce + 16 tag.
func TestAttachmentEncryptedUploadAccepted(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, orgID, ownerID, "enc")
	token := createSession(t, db, ownerID)

	// Deterministic valid envelope: version 0x01 + 12-byte nonce + 16-byte ct+tag
	encryptedBytes := make([]byte, 29)
	encryptedBytes[0] = 0x01
	for i := 1; i < 29; i++ {
		encryptedBytes[i] = byte(i)
	}

	var receivedDownstreamBytes []byte
	mockStorageWorker := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/store" && r.Method == http.MethodPost {
			var body struct {
				ObjectKey string `json:"object_key"`
				Data      []byte `json:"data"`
				MailboxID string `json:"mailbox_id"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err == nil {
				receivedDownstreamBytes = body.Data
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"status":"stored"}`))
			return
		}
		http.Error(w, "not found", http.StatusNotFound)
	}))
	defer mockStorageWorker.Close()
	t.Setenv("STORAGE_WORKER_URL", mockStorageWorker.URL)

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", "test.enc")
	if err != nil {
		t.Fatalf("failed to create form file: %v", err)
	}
	if _, err := part.Write(encryptedBytes); err != nil {
		t.Fatalf("failed to write test payload: %v", err)
	}
	writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mailboxID+"/attachments", &body)
	req.SetPathValue("mailbox_id", mailboxID)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	rec := httptest.NewRecorder()
	attachmentsHandler(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("upload status = %d, want 201 Created. Body: %s", rec.Code, rec.Body.String())
	}
	if !bytes.Equal(receivedDownstreamBytes, encryptedBytes) {
		t.Fatalf("stored bytes must equal submitted encrypted bytes; got %v want %v", receivedDownstreamBytes, encryptedBytes)
	}
	var resp AttachmentResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if !resp.Encrypted {
		t.Fatalf("expected response encrypted=true")
	}
	var isEncrypted bool
	err = db.QueryRow(`SELECT encrypted FROM attachments WHERE id = $1`, resp.ID).Scan(&isEncrypted)
	if err != nil {
		t.Fatalf("failed to query attachments table: %v", err)
	}
	if !isEncrypted {
		t.Fatalf("expected PostgreSQL attachments.encrypted=true for ciphertext")
	}
	if resp.SizeBytes != int64(len(encryptedBytes)) {
		t.Fatalf("size_bytes mismatch: got %d want %d", resp.SizeBytes, len(encryptedBytes))
	}
}

// TestAttachmentPlaintextRejected verifies plaintext multipart uploads are
// rejected and never reach storage-worker.
func TestAttachmentPlaintextRejected(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, orgID, ownerID, "plain")
	token := createSession(t, db, ownerID)

	plaintextBytes := []byte("attachment-test-payload")

	var reachedStorage bool
	mockStorageWorker := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/store" {
			reachedStorage = true
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"stored"}`))
	}))
	defer mockStorageWorker.Close()
	t.Setenv("STORAGE_WORKER_URL", mockStorageWorker.URL)

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, _ := writer.CreateFormFile("file", "test.txt")
	_, _ = part.Write(plaintextBytes)
	writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mailboxID+"/attachments", &body)
	req.SetPathValue("mailbox_id", mailboxID)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	rec := httptest.NewRecorder()
	attachmentsHandler(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("plaintext upload status = %d, want 400. Body: %s", rec.Code, rec.Body.String())
	}
	if reachedStorage {
		t.Fatalf("SECURITY FAIL: plaintext upload reached storage-worker")
	}
	var count int
	err := db.QueryRow(`SELECT count(*) FROM attachments WHERE mailbox_id=$1`, mailboxID).Scan(&count)
	if err != nil {
		t.Fatalf("count query failed: %v", err)
	}
	if count != 0 {
		t.Fatalf("plaintext rejected but DB has %d rows, want 0", count)
	}
}

// TestAttachmentMalformedEncryptedRejected verifies malformed envelope variants
// are rejected and never reach storage-worker.
func TestAttachmentMalformedEncryptedRejected(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, orgID, ownerID, "malformed")
	token := createSession(t, db, ownerID)

	cases := []struct {
		name string
		data []byte
	}{
		{"too short", []byte{0x01, 0x02, 0x03}},
		{"bad version", func() []byte { b := make([]byte, 29); b[0] = 0x02; for i := 1; i < 29; i++ { b[i] = 0xAA }; return b }()},
		{"empty", []byte{}},
		{"not envelope", []byte("not-an-envelope-at-all-plaintext-data")},
	}
	for _, tc := range cases {
		var reachedStorage bool
		mockStorageWorker := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/api/store" {
				reachedStorage = true
			}
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"status":"stored"}`))
		}))
		t.Setenv("STORAGE_WORKER_URL", mockStorageWorker.URL)

		var body bytes.Buffer
		writer := multipart.NewWriter(&body)
		part, _ := writer.CreateFormFile("file", "bad.enc")
		_, _ = part.Write(tc.data)
		writer.Close()

		req := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mailboxID+"/attachments", &body)
		req.SetPathValue("mailbox_id", mailboxID)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		req.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
		rec := httptest.NewRecorder()
		attachmentsHandler(rec, req)
		mockStorageWorker.Close()
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("%s: status = %d, want 400. Body: %s", tc.name, rec.Code, rec.Body.String())
		}
		if reachedStorage {
			t.Fatalf("%s: malformed payload reached storage-worker", tc.name)
		}
	}
}

// TestAttachmentMissingEncryptedPayloadRejected verifies a POST with no file is 400.
func TestAttachmentMissingEncryptedPayloadRejected(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, orgID, ownerID, "missing")
	token := createSession(t, db, ownerID)

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	_ = writer.WriteField("message_id", "some-msg")
	writer.Close()

	req := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mailboxID+"/attachments", &body)
	req.SetPathValue("mailbox_id", mailboxID)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	rec := httptest.NewRecorder()
	attachmentsHandler(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("missing file: status = %d, want 400", rec.Code)
	}
}

// Silence unused imports
var _ = fmt.Sprintf
var _ = io.EOF
