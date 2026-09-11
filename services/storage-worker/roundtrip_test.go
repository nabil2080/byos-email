package main

// Handler round-trip tests: store -> retrieve (byte-identical) -> delete ->
// retrieve-fails, plus internal-key enforcement. Uses MockDriveStorage on a
// temp dir with an empty mailbox scope, so no PostgreSQL, MinIO, or Docker
// network is required. The storage-worker HTTP surface is internal-only, so
// this package test (not host curl) is the authoritative wire check.

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
