package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"testing"
)

func TestRetrieveStreamHandler(t *testing.T) {
	t.Setenv("STORAGE_WORKER_INTERNAL_KEY", "test-storage-internal-secret")

	mockDrive, err := NewMockDriveStorage(t.TempDir())
	if err != nil {
		t.Fatalf("NewMockDriveStorage: %v", err)
	}

	mailboxID := "550e8400-e29b-41d4-a716-446655440000"
	otherMailboxID := "660e8400-e29b-41d4-a716-446655440001"
	objKey := "mailboxes/" + mailboxID + "/attachments/f47ac10b-58cc-4372-a567-0e02b2c3d479"
	ciphertext := append([]byte{0x01, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12}, []byte("encrypted-ciphertext-payload-bytes-123456")...)

	if err := mockDrive.PutObject(context.Background(), "byos-test", objKey, bytes.NewReader(ciphertext), int64(len(ciphertext))); err != nil {
		t.Fatalf("PutObject: %v", err)
	}

	worker := &StorageWorker{
		defaultStorage: mockDrive,
		defaultBucket:  "byos-test",
		dbURL:          "postgres://127.0.0.1:1/nonexistent?sslmode=disable",
	}

	// 1. Missing X-Internal-Key -> 403
	body, _ := json.Marshal(RetrieveRequest{MailboxID: mailboxID, ObjectKey: objKey})
	req := httptest.NewRequest(http.MethodPost, "/api/retrieve-stream", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	worker.retrieveStreamHandler(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("missing key status = %d, want 403", rec.Code)
	}

	// 2. Wrong X-Internal-Key -> 403
	req = httptest.NewRequest(http.MethodPost, "/api/retrieve-stream", bytes.NewReader(body))
	req.Header.Set("X-Internal-Key", "wrong-secret")
	rec = httptest.NewRecorder()
	worker.retrieveStreamHandler(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("wrong key status = %d, want 403", rec.Code)
	}

	// 3. Cross-mailbox object key -> 400
	crossBody, _ := json.Marshal(RetrieveRequest{
		MailboxID: otherMailboxID,
		ObjectKey: objKey,
	})
	req = httptest.NewRequest(http.MethodPost, "/api/retrieve-stream", bytes.NewReader(crossBody))
	req.Header.Set("X-Internal-Key", "test-storage-internal-secret")
	rec = httptest.NewRecorder()
	worker.retrieveStreamHandler(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("cross-mailbox key status = %d, want 400", rec.Code)
	}

	// 4. Path traversal -> 400
	travBody, _ := json.Marshal(RetrieveRequest{
		MailboxID: mailboxID,
		ObjectKey: "mailboxes/" + mailboxID + "/../" + otherMailboxID + "/secret",
	})
	req = httptest.NewRequest(http.MethodPost, "/api/retrieve-stream", bytes.NewReader(travBody))
	req.Header.Set("X-Internal-Key", "test-storage-internal-secret")
	rec = httptest.NewRecorder()
	worker.retrieveStreamHandler(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("traversal key status = %d, want 400", rec.Code)
	}

	// 5. Missing object -> 404
	missBody, _ := json.Marshal(RetrieveRequest{
		MailboxID: mailboxID,
		ObjectKey: "mailboxes/" + mailboxID + "/attachments/missing-object",
	})
	req = httptest.NewRequest(http.MethodPost, "/api/retrieve-stream", bytes.NewReader(missBody))
	req.Header.Set("X-Internal-Key", "test-storage-internal-secret")
	rec = httptest.NewRecorder()
	worker.retrieveStreamHandler(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("missing object status = %d, want 404", rec.Code)
	}

	// 6. Happy path raw octet-stream with exact Content-Length
	req = httptest.NewRequest(http.MethodPost, "/api/retrieve-stream", bytes.NewReader(body))
	req.Header.Set("X-Internal-Key", "test-storage-internal-secret")
	rec = httptest.NewRecorder()
	worker.retrieveStreamHandler(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("happy stream status = %d, body=%s, want 200", rec.Code, rec.Body.String())
	}
	if gotCT := rec.Header().Get("Content-Type"); gotCT != "application/octet-stream" {
		t.Fatalf("Content-Type = %q, want application/octet-stream", gotCT)
	}
	if gotCL := rec.Header().Get("Content-Length"); gotCL != strconv.Itoa(len(ciphertext)) {
		t.Fatalf("Content-Length = %q, want %d", gotCL, len(ciphertext))
	}
	streamed, _ := io.ReadAll(rec.Result().Body)
	if !bytes.Equal(streamed, ciphertext) {
		t.Fatalf("streamed bytes mismatch: got %d bytes, want %d", len(streamed), len(ciphertext))
	}
}

func TestRetrieveStreamLiveMinIOOptIn(t *testing.T) {
	endpoint := os.Getenv("BYOS_TEST_MINIO_ENDPOINT")
	if endpoint == "" {
		t.Skip("BYOS_TEST_MINIO_ENDPOINT not set")
	}
	t.Setenv("STORAGE_WORKER_INTERNAL_KEY", "test-storage-internal-secret")
	accessKey := os.Getenv("BYOS_TEST_MINIO_ACCESS_KEY")
	if accessKey == "" {
		accessKey = "byosminio"
	}
	secretKey := os.Getenv("BYOS_TEST_MINIO_SECRET_KEY")
	if secretKey == "" {
		secretKey = "byosminio_dev_password"
	}
	bucket := "byos-relb-test"
	s3, err := NewS3Storage(endpoint, accessKey, secretKey, bucket, "", true)
	if err != nil {
		t.Fatalf("NewS3Storage(%s, %s): %v", endpoint, bucket, err)
	}
	defer func() {
		_ = s3.client.RemoveBucket(context.Background(), bucket)
	}()

	mailboxID := "550e8400-e29b-41d4-a716-446655440000"
	objKey := "mailboxes/" + mailboxID + "/attachments/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee/payload.bin"
	payload := append([]byte{0x01, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12}, bytes.Repeat([]byte("M"), 1024*64)...)

	if err := s3.PutObject(context.Background(), bucket, objKey, bytes.NewReader(payload), int64(len(payload))); err != nil {
		t.Fatalf("MinIO PutObject: %v", err)
	}
	defer func() {
		_ = s3.DeleteObject(context.Background(), bucket, objKey)
	}()

	worker := &StorageWorker{
		defaultStorage: s3,
		defaultBucket:  bucket,
		dbURL:          "postgres://nonexistent:nonexistent@127.0.0.1:1/nonexistent",
	}

	// 1. Live MinIO retrieve-stream returns exact ciphertext + Content-Length
	body, _ := json.Marshal(RetrieveRequest{MailboxID: mailboxID, ObjectKey: objKey})
	req := httptest.NewRequest(http.MethodPost, "/api/retrieve-stream", bytes.NewReader(body))
	req.Header.Set("X-Internal-Key", "test-storage-internal-secret")
	rec := httptest.NewRecorder()
	worker.retrieveStreamHandler(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("MinIO stream status = %d, want 200, body=%s", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("Content-Length") != strconv.Itoa(len(payload)) {
		t.Fatalf("MinIO Content-Length = %q, want %d", rec.Header().Get("Content-Length"), len(payload))
	}
	got, _ := io.ReadAll(rec.Result().Body)
	if !bytes.Equal(got, payload) {
		t.Fatalf("MinIO streamed bytes mismatch: got %d, want %d", len(got), len(payload))
	}

	// 2. Live MinIO missing object returns 404 (not 500)
	missBody, _ := json.Marshal(RetrieveRequest{MailboxID: mailboxID, ObjectKey: "mailboxes/" + mailboxID + "/attachments/missing/payload.bin"})
	req = httptest.NewRequest(http.MethodPost, "/api/retrieve-stream", bytes.NewReader(missBody))
	req.Header.Set("X-Internal-Key", "test-storage-internal-secret")
	rec = httptest.NewRecorder()
	worker.retrieveStreamHandler(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("MinIO missing object status = %d, want 404, body=%s", rec.Code, rec.Body.String())
	}
}
