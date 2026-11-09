package main

// Handler round-trip tests: store -> retrieve (byte-identical) -> delete ->
// retrieve-fails, plus internal-key enforcement. Uses MockDriveStorage on a
// temp dir with an empty mailbox scope, so no PostgreSQL, MinIO, or Docker
// network is required. The storage-worker HTTP surface is internal-only, so
// this package test (not host curl) is the authoritative wire check.

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func testWorker(t *testing.T) *StorageWorker {
	t.Helper()
	t.Setenv("STORAGE_WORKER_INTERNAL_KEY", "test-internal-key")
	mock, err := NewMockDriveStorage(t.TempDir())
	if err != nil {
		t.Fatalf("mock storage: %v", err)
	}
	return &StorageWorker{defaultStorage: mock, defaultBucket: "test-bucket", dbURL: ""}
}

func doStore(t *testing.T, w *StorageWorker, objectKey string, data []byte, key string) *httptest.ResponseRecorder {
	t.Helper()
	payload, _ := json.Marshal(StoreRequest{ObjectKey: objectKey, Data: data})
	req := httptest.NewRequest(http.MethodPost, "/api/store", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	if key != "" {
		req.Header.Set("X-Internal-Key", key)
	}
	rec := httptest.NewRecorder()
	w.storeHandler(rec, req)
	return rec
}

func doStoreOctetStream(t *testing.T, w *StorageWorker, objectKey string, data []byte, key, mailboxID, contentType string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/store", bytes.NewReader(data))
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("X-Object-Key", objectKey)
	req.Header.Set("X-Mailbox-ID", mailboxID)
	if key != "" {
		req.Header.Set("X-Internal-Key", key)
	}
	rec := httptest.NewRecorder()
	w.storeHandler(rec, req)
	return rec
}

func doRetrieve(t *testing.T, w *StorageWorker, objectKey, key string) *httptest.ResponseRecorder {
	t.Helper()
	payload, _ := json.Marshal(RetrieveRequest{ObjectKey: objectKey})
	req := httptest.NewRequest(http.MethodPost, "/api/retrieve", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	if key != "" {
		req.Header.Set("X-Internal-Key", key)
	}
	rec := httptest.NewRecorder()
	w.retrieveHandler(rec, req)
	return rec
}

func TestStoreRetrieveDeleteRoundTrip(t *testing.T) {
	w := testWorker(t)
	const objectKey = "roundtrip/msg-001.enc"
	original := []byte{0x01, 0x02, 0x03, 0x04, 0x05, 0xAA, 0xFF, 0x00, 0x10, 0x20}

	stored := doStore(t, w, objectKey, original, "test-internal-key")
	if stored.Code != http.StatusOK {
		t.Fatalf("store status = %d, want 200: %s", stored.Code, stored.Body.String())
	}

	got := doRetrieve(t, w, objectKey, "test-internal-key")
	if got.Code != http.StatusOK {
		t.Fatalf("retrieve status = %d, want 200: %s", got.Code, got.Body.String())
	}
	var rr RetrieveResponse
	if err := json.NewDecoder(got.Body).Decode(&rr); err != nil {
		t.Fatalf("decode retrieve: %v", err)
	}
	if !bytes.Equal(rr.Data, original) {
		t.Fatalf("round-trip mismatch: got %v want %v", rr.Data, original)
	}
	if rr.Size != int64(len(original)) {
		t.Fatalf("size = %d, want %d", rr.Size, len(original))
	}

	delPayload, _ := json.Marshal(map[string]string{"object_key": objectKey})
	delReq := httptest.NewRequest(http.MethodPost, "/api/delete", bytes.NewReader(delPayload))
	delReq.Header.Set("Content-Type", "application/json")
	delReq.Header.Set("X-Internal-Key", "test-internal-key")
	delRec := httptest.NewRecorder()
	w.deleteHandler(delRec, delReq)
	if delRec.Code != http.StatusOK {
		t.Fatalf("delete status = %d, want 200: %s", delRec.Code, delRec.Body.String())
	}

	gone := doRetrieve(t, w, objectKey, "test-internal-key")
	if gone.Code == http.StatusOK {
		t.Fatal("retrieve after delete must fail")
	}
}

func TestRetrieveMissingObjectFails(t *testing.T) {
	w := testWorker(t)
	rec := doRetrieve(t, w, "nope/missing.enc", "test-internal-key")
	if rec.Code == http.StatusOK {
		t.Fatal("missing object must not return 200")
	}
}

func TestInternalKeyEnforced(t *testing.T) {
	w := testWorker(t)
	// Wrong key -> 403.
	rec := doStore(t, w, "k", []byte{0x01}, "wrong-key")
	if rec.Code != http.StatusForbidden {
		t.Fatalf("wrong key status = %d, want 403", rec.Code)
	}
	// Missing key -> 403 (secret is configured in this test).
	rec = doRetrieve(t, w, "k", "")
	if rec.Code != http.StatusForbidden {
		t.Fatalf("missing key status = %d, want 403", rec.Code)
	}
}

func TestStoreOctetStreamVariants(t *testing.T) {
	w := testWorker(t)
	const objectKey = "mailboxes/test-mailbox/msg-002.enc"
	original := []byte("raw data test")

	// Store with parameters in media type
	stored := doStoreOctetStream(t, w, objectKey, original, "test-internal-key", "test-mailbox", "application/octet-stream; name=\"f.enc\"")
	if stored.Code != http.StatusOK {
		t.Fatalf("store status = %d, want 200: %s", stored.Code, stored.Body.String())
	}

	got := doRetrieve(t, w, objectKey, "test-internal-key")
	if got.Code != http.StatusOK {
		t.Fatalf("retrieve status = %d, want 200: %s", got.Code, got.Body.String())
	}
	var rr RetrieveResponse
	if err := json.NewDecoder(got.Body).Decode(&rr); err != nil {
		t.Fatalf("decode retrieve: %v", err)
	}
	if !bytes.Equal(rr.Data, original) {
		t.Fatalf("round-trip mismatch: got %v want %v", rr.Data, original)
	}
}

func TestUnreachableMinIOFailsWithoutTmpFallback(t *testing.T) {
	t.Setenv("STORAGE_WORKER_INTERNAL_KEY", "test-internal-key")

	// 1. Storage worker with S3 storage pointing to unreachable MinIO port
	unreachableS3, err := NewS3Storage("127.0.0.1:54321", "baduser", "badpass", "byos-mailbox", "", true)
	if err != nil {
		t.Fatalf("unexpected error creating S3Storage struct: %v", err)
	}

	w := &StorageWorker{
		defaultStorage: unreachableS3,
		defaultBucket:  "byos-mailbox",
		dbURL:          "",
	}

	const objectKey = "mailboxes/test-mailbox/unreachable-test.enc"
	payload := []byte("confidential-email-bytes-do-not-leak")

	rec := doStoreOctetStream(t, w, objectKey, payload, "test-internal-key", "test-mailbox", "application/octet-stream")

	// Must fail loudly with HTTP 500
	if rec.Code == http.StatusOK {
		t.Fatalf("expected storage call to fail when MinIO is unreachable, but got 200 OK")
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected status 500 InternalServerError, got %d", rec.Code)
	}

	// Must contain failure error message
	body := rec.Body.String()
	if !strings.Contains(body, "Failed to store object") {
		t.Fatalf("expected 'Failed to store object' in error body, got: %s", body)
	}

	// Assert that no fallback file was created in /tmp/byos-drive-mock or temp directory
	mockPath := filepath.Join("/tmp", "byos-drive-mock", objectKey)
	if _, err := os.Stat(mockPath); err == nil {
		t.Fatalf("CRITICAL SECURITY FAILURE: object was written to mock fallback path %s instead of returning an error!", mockPath)
	}
}

func TestNilStorageBackendFailsWithoutFallback(t *testing.T) {
	t.Setenv("STORAGE_WORKER_INTERNAL_KEY", "test-internal-key")

	// When default storage is nil (e.g., initial S3 connection failed)
	w := &StorageWorker{
		defaultStorage: nil,
		defaultBucket:  "byos-mailbox",
		dbURL:          "",
	}

	const objectKey = "mailboxes/test-mailbox/nil-backend-test.enc"
	payload := []byte("some-data")

	rec := doStoreOctetStream(t, w, objectKey, payload, "test-internal-key", "test-mailbox", "application/octet-stream")

	if rec.Code == http.StatusOK {
		t.Fatalf("expected store to fail with nil storage backend, got 200 OK")
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected status 500 InternalServerError, got %d", rec.Code)
	}
}

func TestStorageProbeNonPlaintextAndCleanup(t *testing.T) {
	tempDir := t.TempDir()
	mock, err := NewMockDriveStorage(tempDir)
	if err != nil {
		t.Fatalf("failed to create mock storage: %v", err)
	}

	ctx := context.Background()
	if err := mock.TestConnection(ctx); err != nil {
		t.Fatalf("TestConnection failed: %v", err)
	}

	// Verify no probe files were left behind
	entries, err := os.ReadDir(tempDir)
	if err != nil {
		t.Fatalf("failed to read temp dir: %v", err)
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), ".test") || strings.HasPrefix(entry.Name(), ".byos-probe") {
			t.Fatalf("probe object leaked: found %s in storage directory", entry.Name())
		}
	}
}

func TestNotesStorageListRoundTrip(t *testing.T) {
	w := testWorker(t)
	const mailboxID = "box-notes-test"
	const objectKey = "mailboxes/" + mailboxID + "/notes/test-note.enc"
	data := []byte{0x01, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xAA, 0xBB, 0xCC}

	// Store note object
	stored := doStore(t, w, objectKey, data, "test-internal-key")
	if stored.Code != http.StatusOK {
		t.Fatalf("store status = %d, want 200: %s", stored.Code, stored.Body.String())
	}

	// List objects under mailbox notes prefix
	listReq := httptest.NewRequest(http.MethodGet, "/api/list?prefix=mailboxes/"+mailboxID+"/notes/", nil)
	listReq.Header.Set("X-Internal-Key", "test-internal-key")
	listRec := httptest.NewRecorder()
	w.listHandler(listRec, listReq)

	if listRec.Code != http.StatusOK {
		t.Fatalf("list status = %d, want 200: %s", listRec.Code, listRec.Body.String())
	}

	var lr struct {
		Objects []string `json:"objects"`
		Count   int      `json:"count"`
	}
	if err := json.NewDecoder(listRec.Body).Decode(&lr); err != nil {
		t.Fatalf("decode list: %v", err)
	}

	found := false
	for _, obj := range lr.Objects {
		if strings.Contains(obj, "test-note.enc") {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected test-note.enc in listed objects, got %v", lr.Objects)
	}
}
