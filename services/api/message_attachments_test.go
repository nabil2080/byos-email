package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func setupAttachmentChunkTestMux() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/mailboxes/{mailbox_id}/attachment-chunks", withSecurityHeaders(withCORS(uploadAttachmentChunkHandler)))
	mux.HandleFunc("OPTIONS /v1/mailboxes/{mailbox_id}/attachment-chunks", withSecurityHeaders(withCORS(uploadAttachmentChunkHandler)))
	return mux
}

// 1. Raw binary application/octet-stream upload
func TestUploadAttachmentChunk_RawBinarySuccess(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	mux := setupAttachmentChunkTestMux()
	vec := loadSignedVector(t)
	_, senderMailboxID, senderToken, _, _ := setupInternalDeliveryTest(t, db, vec)
	_, storage := setupAttachmentMockStorage(t)

	rawPayload := []byte{0xDE, 0xAD, 0xBE, 0xEF, 0xCA, 0xFE, 0xBA, 0xBE}
	objectKey := fmt.Sprintf("mailboxes/%s/attachments/msg-1/chunk_000.enc", senderMailboxID)

	req := httptest.NewRequest("POST", fmt.Sprintf("/v1/mailboxes/%s/attachment-chunks", senderMailboxID), bytes.NewReader(rawPayload))
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set("X-Object-Key", objectKey)
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: senderToken})
	rec := httptest.NewRecorder()

	mux.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code, "Response status should be 200: %s", rec.Body.String())

	var res map[string]interface{}
	err := json.Unmarshal(rec.Body.Bytes(), &res)
	require.NoError(t, err)
	assert.Equal(t, "stored", res["status"])
	assert.Equal(t, objectKey, res["object_key"])
	assert.Equal(t, float64(len(rawPayload)), res["size_bytes"])

	// Assert stored in mock storage exactly
	storedBytes, ok := storage.objects[objectKey]
	require.True(t, ok, "Object must be present in storage")
	assert.Equal(t, rawPayload, storedBytes, "Stored bytes must match raw binary upload exactly")
}

// 2. Base64 JSON fallback backward compatibility
func TestUploadAttachmentChunk_Base64JsonFallback(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	mux := setupAttachmentChunkTestMux()
	vec := loadSignedVector(t)
	_, senderMailboxID, senderToken, _, _ := setupInternalDeliveryTest(t, db, vec)
	_, storage := setupAttachmentMockStorage(t)

	rawPayload := []byte("backward_compat_base64_payload")
	objectKey := fmt.Sprintf("mailboxes/%s/attachments/msg-2/chunk_001.enc", senderMailboxID)

	jsonBody, err := json.Marshal(map[string]string{
		"object_key": objectKey,
		"data":       base64.StdEncoding.EncodeToString(rawPayload),
	})
	require.NoError(t, err)

	req := httptest.NewRequest("POST", fmt.Sprintf("/v1/mailboxes/%s/attachment-chunks", senderMailboxID), bytes.NewReader(jsonBody))
	req.Header.Set("Content-Type", "application/json")
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: senderToken})
	rec := httptest.NewRecorder()

	mux.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code, "Response status should be 200: %s", rec.Body.String())
	assert.Equal(t, rawPayload, storage.objects[objectKey])
}

// 3. Unauthorized request rejection
func TestUploadAttachmentChunk_Unauthorized(t *testing.T) {
	mux := setupAttachmentChunkTestMux()
	mailboxID := uuid.New().String()

	req := httptest.NewRequest("POST", fmt.Sprintf("/v1/mailboxes/%s/attachment-chunks", mailboxID), bytes.NewReader([]byte("data")))
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set("X-Object-Key", fmt.Sprintf("mailboxes/%s/test.enc", mailboxID))
	rec := httptest.NewRecorder()

	mux.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

// 4. Invalid object key outside mailbox scope
func TestUploadAttachmentChunk_ScopeIsolation(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	mux := setupAttachmentChunkTestMux()
	vec := loadSignedVector(t)
	_, senderMailboxID, senderToken, _, _ := setupInternalDeliveryTest(t, db, vec)

	foreignMailboxID := uuid.New().String()
	invalidKey := fmt.Sprintf("mailboxes/%s/victim_secret.enc", foreignMailboxID)

	req := httptest.NewRequest("POST", fmt.Sprintf("/v1/mailboxes/%s/attachment-chunks", senderMailboxID), bytes.NewReader([]byte("exploit")))
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set("X-Object-Key", invalidKey)
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: senderToken})
	rec := httptest.NewRecorder()

	mux.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusForbidden, rec.Code)
}

// 5. CORS preflight allows X-Object-Key
func TestUploadAttachmentChunk_CORSPreflight(t *testing.T) {
	mux := setupAttachmentChunkTestMux()
	mailboxID := uuid.New().String()

	req := httptest.NewRequest("OPTIONS", fmt.Sprintf("/v1/mailboxes/%s/attachment-chunks", mailboxID), nil)
	req.Header.Set("Origin", "http://localhost:3001")
	req.Header.Set("Access-Control-Request-Method", "POST")
	req.Header.Set("Access-Control-Request-Headers", "Content-Type, X-Object-Key, Authorization")
	rec := httptest.NewRecorder()

	mux.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusNoContent, rec.Code)
	allowHeaders := rec.Header().Get("Access-Control-Allow-Headers")
	assert.Contains(t, allowHeaders, "X-Object-Key", "CORS must allow X-Object-Key header")
}

type repeatZeroReader struct {
	remaining int64
}

func (r *repeatZeroReader) Read(p []byte) (int, error) {
	if r.remaining <= 0 {
		return 0, io.EOF
	}
	n := len(p)
	if int64(n) > r.remaining {
		n = int(r.remaining)
	}
	for i := 0; i < n; i++ {
		p[i] = 0
	}
	r.remaining -= int64(n)
	return n, nil
}

// 6. Oversized chunk (> MaxAttachmentSize = 40 MB) rejected
func TestUploadAttachmentChunk_OversizedChunk(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	mux := setupAttachmentChunkTestMux()
	vec := loadSignedVector(t)
	_, senderMailboxID, senderToken, _, _ := setupInternalDeliveryTest(t, db, vec)
	_, _ = setupAttachmentMockStorage(t)

	// Stream 40 MB + 1 KB without allocating large memory
	oversizedLen := int64(MaxAttachmentSize + 1024)
	oversizedReader := &repeatZeroReader{remaining: oversizedLen}

	objectKey := fmt.Sprintf("mailboxes/%s/attachments/overflow.enc", senderMailboxID)
	req := httptest.NewRequest("POST", fmt.Sprintf("/v1/mailboxes/%s/attachment-chunks", senderMailboxID), oversizedReader)
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set("X-Object-Key", objectKey)
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: senderToken})
	rec := httptest.NewRecorder()

	mux.ServeHTTP(rec, req)

	// Should fail with BadRequest (MaxBytesReader exceeded)
	assert.Equal(t, http.StatusBadRequest, rec.Code)
}

// 7. Storage worker failure propagates as 502 Bad Gateway
func TestUploadAttachmentChunk_StorageWorkerFailure(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	mux := setupAttachmentChunkTestMux()
	vec := loadSignedVector(t)
	_, senderMailboxID, senderToken, _, _ := setupInternalDeliveryTest(t, db, vec)

	// Point storage worker to an unreachable URL
	t.Setenv("STORAGE_WORKER_URL", "http://127.0.0.1:54321/down")

	objectKey := fmt.Sprintf("mailboxes/%s/attachments/msg-fail/chunk_000.enc", senderMailboxID)
	req := httptest.NewRequest("POST", fmt.Sprintf("/v1/mailboxes/%s/attachment-chunks", senderMailboxID), bytes.NewReader([]byte("chunk-data")))
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set("X-Object-Key", objectKey)
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: senderToken})
	rec := httptest.NewRecorder()

	mux.ServeHTTP(rec, req)

	assert.Equal(t, http.StatusBadGateway, rec.Code)
}

// 8. End-to-end ciphertext integrity: verifies storage holds ciphertext and exact bytes match
func TestUploadAttachmentChunk_EndToEndCiphertextIntegrity(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	mux := setupAttachmentChunkTestMux()
	vec := loadSignedVector(t)
	_, senderMailboxID, senderToken, _, _ := setupInternalDeliveryTest(t, db, vec)
	_, storage := setupAttachmentMockStorage(t)

	plaintext := []byte("Strictly Confidential Financial Forecast 2027")
	// Simulate AES-256-GCM ciphertext + 16-byte mock tag
	ciphertext := make([]byte, len(plaintext)+16)
	for i := range plaintext {
		ciphertext[i] = plaintext[i] ^ 0x5a // Simple invertible transform representing ciphertext
	}
	copy(ciphertext[len(plaintext):], []byte("16byte-auth-tag_"))

	// Verify ciphertext does NOT equal plaintext
	require.NotEqual(t, plaintext, ciphertext)

	objectKey := fmt.Sprintf("mailboxes/%s/attachments/forecast/chunk_000.enc", senderMailboxID)
	req := httptest.NewRequest("POST", fmt.Sprintf("/v1/mailboxes/%s/attachment-chunks", senderMailboxID), bytes.NewReader(ciphertext))
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set("X-Object-Key", objectKey)
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: senderToken})
	rec := httptest.NewRecorder()

	mux.ServeHTTP(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)

	// Verify storage object contains ciphertext, NEVER plaintext
	stored, ok := storage.objects[objectKey]
	require.True(t, ok)
	assert.Equal(t, ciphertext, stored)
	assert.NotEqual(t, plaintext, stored)
}
