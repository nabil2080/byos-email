package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// test_profile_photo_upload_stores_ref
func TestProfilePhotoUploadStoresRef(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, orgID, ownerID, "photo-upload")
	token := createTestSession(t, db, ownerID)

	// Valid Section 12 AES-GCM envelope (version 0x01 + 12-byte IV + ciphertext + 16-byte tag)
	validCiphertext := make([]byte, 29+64)
	validCiphertext[0] = 0x01
	for i := 1; i < len(validCiphertext); i++ {
		validCiphertext[i] = byte(i % 256)
	}

	var storedObjectKey string
	var storedMailboxID string
	var storedBytes []byte

	mockStorageWorker := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/store" {
			storedObjectKey = r.Header.Get("X-Object-Key")
			storedMailboxID = r.Header.Get("X-Mailbox-ID")
			storedBytes, _ = io.ReadAll(r.Body)
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(map[string]string{"status": "stored"})
			return
		}
		http.NotFound(w, r)
	}))
	defer mockStorageWorker.Close()
	t.Setenv("STORAGE_WORKER_URL", mockStorageWorker.URL)

	req := httptest.NewRequest(http.MethodPost, "/v1/users/me/profile-photo", bytes.NewReader(validCiphertext))
	req.Header.Set("Content-Type", "application/octet-stream")
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	rec := httptest.NewRecorder()

	profilePhotoHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("test_profile_photo_upload_stores_ref: expected 200, got %d; body: %s", rec.Code, rec.Body.String())
	}

	var resp struct {
		PhotoRef  string `json:"photo_ref"`
		UpdatedAt string `json:"updated_at"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode json response: %v", err)
	}
	if resp.PhotoRef == "" || !strings.HasPrefix(resp.PhotoRef, "mailboxes/"+mailboxID+"/profile/photo_") {
		t.Fatalf("unexpected photo_ref: %q", resp.PhotoRef)
	}
	if resp.UpdatedAt == "" {
		t.Fatalf("expected non-empty updated_at")
	}

	// Verify storage-worker was invoked with exact payload
	if storedMailboxID != mailboxID {
		t.Fatalf("storage-worker received mailbox_id %q, want %q", storedMailboxID, mailboxID)
	}
	if storedObjectKey != resp.PhotoRef {
		t.Fatalf("storage-worker received object_key %q, want %q", storedObjectKey, resp.PhotoRef)
	}
	if !bytes.Equal(storedBytes, validCiphertext) {
		t.Fatalf("storage-worker received payload mismatch")
	}

	// Verify PostgreSQL mailboxes row stores photo_ref
	var dbRef *string
	err := db.QueryRow(`SELECT profile_photo_ref FROM mailboxes WHERE id = $1`, mailboxID).Scan(&dbRef)
	if err != nil {
		t.Fatalf("failed to query profile_photo_ref: %v", err)
	}
	if dbRef == nil || *dbRef != resp.PhotoRef {
		t.Fatalf("DB profile_photo_ref %v, want %q", dbRef, resp.PhotoRef)
	}

	// Verify GET /v1/auth/me includes profile_photo_ref
	meReq := httptest.NewRequest(http.MethodGet, "/v1/auth/me", nil)
	meReq.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	meRec := httptest.NewRecorder()
	meHandler(meRec, meReq)
	if meRec.Code != http.StatusOK {
		t.Fatalf("meHandler status = %d, want 200", meRec.Code)
	}
	var meResp map[string]interface{}
	if err := json.NewDecoder(meRec.Body).Decode(&meResp); err != nil {
		t.Fatalf("failed to decode meHandler response: %v", err)
	}
	if meResp["profile_photo_ref"] != resp.PhotoRef {
		t.Fatalf("auth/me profile_photo_ref = %v, want %q", meResp["profile_photo_ref"], resp.PhotoRef)
	}
}

// test_profile_photo_delete_clears_ref
func TestProfilePhotoDeleteClearsRef(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, orgID, ownerID, "photo-delete")
	token := createTestSession(t, db, ownerID)

	existingRef := fmt.Sprintf("mailboxes/%s/profile/photo_test123.bin", mailboxID)
	_, err := db.Exec(`UPDATE mailboxes SET profile_photo_ref = $1, profile_photo_updated_at = NOW() WHERE id = $2`, existingRef, mailboxID)
	if err != nil {
		t.Fatalf("failed to pre-seed profile_photo_ref: %v", err)
	}

	var deleteCalled bool
	mockStorageWorker := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/delete" {
			deleteCalled = true
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(map[string]string{"status": "deleted"})
			return
		}
		http.NotFound(w, r)
	}))
	defer mockStorageWorker.Close()
	t.Setenv("STORAGE_WORKER_URL", mockStorageWorker.URL)

	req := httptest.NewRequest(http.MethodDelete, "/v1/users/me/profile-photo", nil)
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	rec := httptest.NewRecorder()

	profilePhotoHandler(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("test_profile_photo_delete_clears_ref: expected 204 No Content, got %d; body: %s", rec.Code, rec.Body.String())
	}
	if !deleteCalled {
		t.Fatalf("expected storage-worker /api/delete to be called")
	}

	var dbRef *string
	err = db.QueryRow(`SELECT profile_photo_ref FROM mailboxes WHERE id = $1`, mailboxID).Scan(&dbRef)
	if err != nil {
		t.Fatalf("failed to query profile_photo_ref: %v", err)
	}
	if dbRef != nil {
		t.Fatalf("expected DB profile_photo_ref to be NULL, got %q", *dbRef)
	}

	// Verify GET /v1/users/me/profile-photo returns 404
	getReq := httptest.NewRequest(http.MethodGet, "/v1/users/me/profile-photo", nil)
	getReq.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	getRec := httptest.NewRecorder()
	profilePhotoHandler(getRec, getReq)
	if getRec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 after deletion, got %d", getRec.Code)
	}
}

func TestProfilePhotoGetServesCiphertext(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, orgID, ownerID, "photo-get")
	token := createTestSession(t, db, ownerID)

	fakeCiphertext := []byte("this-is-an-encrypted-photo-envelope-blob-bytes-test")
	existingRef := fmt.Sprintf("mailboxes/%s/profile/photo_get123.bin", mailboxID)
	_, err := db.Exec(`UPDATE mailboxes SET profile_photo_ref = $1, profile_photo_updated_at = NOW() WHERE id = $2`, existingRef, mailboxID)
	if err != nil {
		t.Fatalf("failed to pre-seed profile_photo_ref: %v", err)
	}

	mockStorageWorker := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/retrieve" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"data": base64.StdEncoding.EncodeToString(fakeCiphertext),
				"size": len(fakeCiphertext),
			})
			return
		}
		http.NotFound(w, r)
	}))
	defer mockStorageWorker.Close()
	t.Setenv("STORAGE_WORKER_URL", mockStorageWorker.URL)

	req := httptest.NewRequest(http.MethodGet, "/v1/users/me/profile-photo", nil)
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	rec := httptest.NewRecorder()

	profilePhotoHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d; body: %s", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("Content-Type") != "application/octet-stream" {
		t.Fatalf("Content-Type = %q, want application/octet-stream", rec.Header().Get("Content-Type"))
	}
	if !bytes.Equal(rec.Body.Bytes(), fakeCiphertext) {
		t.Fatalf("returned body mismatch")
	}
}

func TestProfilePhotoRejectsInvalidEnvelope(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, orgID, ownerID, "photo-invalid")
	token := createTestSession(t, db, ownerID)
	_ = mailboxID

	var reachedStorage bool
	mockStorageWorker := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reachedStorage = true
		w.WriteHeader(http.StatusOK)
	}))
	defer mockStorageWorker.Close()
	t.Setenv("STORAGE_WORKER_URL", mockStorageWorker.URL)

	// Plaintext upload
	plaintext := []byte("plain-unencrypted-photo-data")
	req := httptest.NewRequest(http.MethodPost, "/v1/users/me/profile-photo", bytes.NewReader(plaintext))
	req.Header.Set("Content-Type", "application/octet-stream")
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	rec := httptest.NewRecorder()

	profilePhotoHandler(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request for plaintext, got %d", rec.Code)
	}
	if reachedStorage {
		t.Fatalf("plaintext upload must NOT reach storage-worker")
	}
}
