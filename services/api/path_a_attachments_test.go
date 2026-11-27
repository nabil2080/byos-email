package main

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"byos.email/crypto/envelope"
	"github.com/google/uuid"
)

type mockStorageStore struct {
	mu      sync.Mutex
	objects map[string][]byte
}

func setupAttachmentMockStorage(t *testing.T) (*httptest.Server, *mockStorageStore) {
	t.Helper()
	t.Setenv("BYOS_ALLOWED_ORIGINS", "http://127.0.0.1:3001")
	store := &mockStorageStore{
		objects: make(map[string][]byte),
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		store.mu.Lock()
		defer store.mu.Unlock()

		switch r.URL.Path {
		case "/api/head":
			var req struct {
				ObjectKey string `json:"object_key"`
				MailboxID string `json:"mailbox_id"`
			}
			_ = json.NewDecoder(r.Body).Decode(&req)
			data, ok := store.objects[req.ObjectKey]
			if !ok {
				http.Error(w, "object not found", http.StatusNotFound)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"key":  req.ObjectKey,
				"size": len(data),
			})

		case "/api/store":
			if r.Header.Get("Content-Type") == "application/octet-stream" {
				key := r.Header.Get("X-Object-Key")
				b, _ := io.ReadAll(r.Body)
				store.objects[key] = b
				w.WriteHeader(http.StatusOK)
				_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
				return
			}
			var req struct {
				ObjectKey string `json:"object_key"`
				MailboxID string `json:"mailbox_id"`
				Data      []byte `json:"data"`
			}
			_ = json.NewDecoder(r.Body).Decode(&req)
			store.objects[req.ObjectKey] = req.Data
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})

		case "/api/retrieve":
			var req struct {
				ObjectKey string `json:"object_key"`
				MailboxID string `json:"mailbox_id"`
			}
			_ = json.NewDecoder(r.Body).Decode(&req)
			data, ok := store.objects[req.ObjectKey]
			if !ok {
				http.Error(w, "object not found", http.StatusNotFound)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]interface{}{
				"data": base64.StdEncoding.EncodeToString(data),
				"size": len(data),
			})

		default:
			http.NotFound(w, r)
		}
	}))

	t.Cleanup(func() { server.Close() })
	t.Setenv("STORAGE_WORKER_URL", server.URL)
	return server, store
}

func createSignedEnvelopes(t *testing.T, db *sql.DB, senderMailboxID string, vec signedVector) (recipientEnvelopeJSON string, senderEnvelopeJSON string) {
	t.Helper()
	pubKey, privKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate ed25519 key: %v", err)
	}

	_, err = db.Exec("UPDATE mailboxes SET mailbox_ed25519_pk = $1 WHERE id = $2", pubKey, senderMailboxID)
	if err != nil {
		t.Fatalf("update sender ed25519 pk: %v", err)
	}

	origEnv, err := envelope.UnmarshalCanonical([]byte(vec.EnvelopeJSON))
	if err != nil {
		t.Fatalf("unmarshal vec envelope: %v", err)
	}

	encBytes, _ := base64.StdEncoding.DecodeString(origEnv.Enc)
	nonceBytes, _ := base64.StdEncoding.DecodeString(origEnv.Nonce)
	var nonce [12]byte
	copy(nonce[:], nonceBytes)
	ciphertextBytes, _ := base64.StdEncoding.DecodeString(origEnv.Ciphertext)

	// 1. Recipient envelope signed by sender
	recEnv := *origEnv
	recAAD, err := envelope.BuildEnvelopeAAD(recEnv.V, recEnv.Alg, recEnv.KeyID, recEnv.KeyEpoch, encBytes, nonce)
	if err != nil {
		t.Fatalf("build rec aad: %v", err)
	}
	recSigData := append(recAAD, ciphertextBytes...)
	recSig := ed25519.Sign(privKey, recSigData)
	b64RecSig := base64.StdEncoding.EncodeToString(recSig)
	recEnv.Sig = &b64RecSig
	recJSONBytes, err := envelope.MarshalCanonical(&recEnv)
	if err != nil {
		t.Fatalf("marshal rec envelope: %v", err)
	}

	// 2. Sender envelope signed by sender with KeyID = senderMailboxID
	senderEnv := *origEnv
	senderEnv.KeyID = senderMailboxID
	senderAAD, err := envelope.BuildEnvelopeAAD(senderEnv.V, senderEnv.Alg, senderEnv.KeyID, senderEnv.KeyEpoch, encBytes, nonce)
	if err != nil {
		t.Fatalf("build sender aad: %v", err)
	}
	senderSigData := append(senderAAD, ciphertextBytes...)
	senderSig := ed25519.Sign(privKey, senderSigData)
	b64SenderSig := base64.StdEncoding.EncodeToString(senderSig)
	senderEnv.Sig = &b64SenderSig
	senderJSONBytes, err := envelope.MarshalCanonical(&senderEnv)
	if err != nil {
		t.Fatalf("marshal sender envelope: %v", err)
	}

	return string(recJSONBytes), string(senderJSONBytes)
}

func createTestAttachmentEnvelopes(senderMailboxID, attID, filename string, chunkBytes []byte, storage *mockStorageStore) (recEnv AttachmentEnvelope, senderEnv AttachmentEnvelope) {
	chunkRef := fmt.Sprintf("mailboxes/%s/path-a-attachments/%s/chunk_000.enc", senderMailboxID, attID)
	storage.objects[chunkRef] = chunkBytes

	senderChunkRef := fmt.Sprintf("mailboxes/%s/sent-attachments/sent-1/%s/chunk_000.enc", senderMailboxID, attID)
	senderChunkBytes := append([]byte("sender_distinct_ciphertext_bytes:"), chunkBytes...)
	storage.objects[senderChunkRef] = senderChunkBytes

	hash := sha256.Sum256([]byte("simulated_plaintext_bytes"))
	hashB64 := base64.StdEncoding.EncodeToString(hash[:])

	recEnv = AttachmentEnvelope{
		AttachmentID: attID,
		Filename:     filename,
		MimeType:     "application/pdf",
		SizeBytes:    int64(len(chunkBytes)),
		IV:           base64.StdEncoding.EncodeToString([]byte("12bytesnonce_")),
		WrappedKey: AttachmentWrappedKey{
			X25519Encapsulated: base64.StdEncoding.EncodeToString([]byte("32bytes_encapsulated_key_dummy_")),
			MLKEMEncryptedKey:  base64.StdEncoding.EncodeToString([]byte("mlkem_encrypted_content_key_mock_")),
		},
		ContentHashSHA256: hashB64,
		ChunkCount:        1,
		Chunks: []AttachmentChunk{
			{Index: 0, StorageRef: chunkRef, SizeBytes: int64(len(chunkBytes))},
		},
	}

	senderEnv = AttachmentEnvelope{
		AttachmentID: attID,
		Filename:     filename,
		MimeType:     "application/pdf",
		SizeBytes:    int64(len(chunkBytes)),
		IV:           base64.StdEncoding.EncodeToString([]byte("12senderiv__")),
		WrappedKey: AttachmentWrappedKey{
			X25519Encapsulated: base64.StdEncoding.EncodeToString([]byte("32bytes_sender_encap_key_dummy_")),
			MLKEMEncryptedKey:  base64.StdEncoding.EncodeToString([]byte("mlkem_sender_encrypted_key_mock_")),
		},
		ContentHashSHA256: hashB64,
		ChunkCount:        1,
		Chunks: []AttachmentChunk{
			{Index: 0, StorageRef: senderChunkRef, SizeBytes: int64(len(senderChunkBytes))},
		},
	}
	return recEnv, senderEnv
}

// 1. TestPathAAttachmentSendAcceptsEnvelopes: send a message with one attachment envelope,
// assert the send succeeds and the row is written with attachment_envelopes and sender_attachment_envelopes.
func TestPathAAttachmentSendAcceptsEnvelopes(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	mux := setupInternalDeliveryTestMux()
	vec := loadSignedVector(t)
	_, senderMailboxID, senderToken, recipientMailboxID, recipientEmail := setupInternalDeliveryTest(t, db, vec)
	recJSON, senderJSON := createSignedEnvelopes(t, db, senderMailboxID, vec)
	_, storage := setupAttachmentMockStorage(t)

	attID := uuid.New().String()
	chunkBytes := []byte("encrypted_chunk_data_000")
	recEnv, senderEnv := createTestAttachmentEnvelopes(senderMailboxID, attID, "document.pdf", chunkBytes, storage)

	sendReq := InternalSendRequest{
		EnvelopeJSON:              recJSON,
		SenderEnvelopeJSON:        senderJSON,
		Recipient:                 recipientEmail,
		SenderMailboxID:           senderMailboxID,
		AttachmentEnvelopes:       []AttachmentEnvelope{recEnv},
		SenderAttachmentEnvelopes: []AttachmentEnvelope{senderEnv},
	}
	body, _ := json.Marshal(sendReq)

	req := httptest.NewRequest("POST", "/v1/outbound/send-internal", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://127.0.0.1:3001")
	req.Header.Set("X-BYOS-Client", "webmail")
	req.AddCookie(&http.Cookie{Name: "byos_webmail_session", Value: senderToken})
	rec := httptest.NewRecorder()

	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("send-internal status = %d, body = %s, want 201", rec.Code, rec.Body.String())
	}

	var resp InternalSendResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	// Verify recipient's row has attachment_envelopes and sender_attachment_envelopes populated
	var hasAtts bool
	var attCount int
	var storedEnvsJSON, storedSenderEnvsJSON []byte
	err := db.QueryRow(`
		SELECT has_attachments, attachment_count, COALESCE(attachment_envelopes, '[]'::jsonb), COALESCE(sender_attachment_envelopes, '[]'::jsonb)
		FROM message_metadata
		WHERE id = $1 AND mailbox_id = $2
	`, resp.MessageID, recipientMailboxID).Scan(&hasAtts, &attCount, &storedEnvsJSON, &storedSenderEnvsJSON)
	if err != nil {
		t.Fatalf("query message_metadata recipient: %v", err)
	}

	if !hasAtts {
		t.Errorf("recipient has_attachments = false, want true")
	}
	if attCount != 1 {
		t.Errorf("recipient attachment_count = %d, want 1", attCount)
	}

	var storedEnvs, storedSenderEnvs []AttachmentEnvelope
	if err := json.Unmarshal(storedEnvsJSON, &storedEnvs); err != nil {
		t.Fatalf("failed to unmarshal stored envelopes: %v", err)
	}
	if len(storedEnvs) != 1 {
		t.Fatalf("stored envelopes len = %d, want 1", len(storedEnvs))
	}
	if storedEnvs[0].AttachmentID != attID {
		t.Errorf("stored attachment_id = %s, want %s", storedEnvs[0].AttachmentID, attID)
	}
	if storedEnvs[0].Filename != "document.pdf" {
		t.Errorf("stored filename = %s, want document.pdf", storedEnvs[0].Filename)
	}

	if err := json.Unmarshal(storedSenderEnvsJSON, &storedSenderEnvs); err != nil {
		t.Fatalf("failed to unmarshal stored sender envelopes: %v", err)
	}
	if len(storedSenderEnvs) != 0 {
		t.Fatalf("recipient row sender envelopes len = %d, want 0 (metadata hygiene)", len(storedSenderEnvs))
	}

	// Verify sender's sent copy carries the sender envelopes
	var sentSenderEnvsJSON []byte
	err = db.QueryRow(`
		SELECT COALESCE(sender_attachment_envelopes, '[]'::jsonb)
		FROM message_metadata
		WHERE mailbox_id = $1 AND folder = 'sent'
		ORDER BY message_seq DESC LIMIT 1
	`, senderMailboxID).Scan(&sentSenderEnvsJSON)
	if err != nil {
		t.Fatalf("query sender sent copy: %v", err)
	}
	var sentSenderEnvs []AttachmentEnvelope
	if err := json.Unmarshal(sentSenderEnvsJSON, &sentSenderEnvs); err != nil {
		t.Fatalf("failed to unmarshal sent sender envelopes: %v", err)
	}
	if len(sentSenderEnvs) != 1 {
		t.Fatalf("stored sender envelopes in sent row len = %d, want 1", len(sentSenderEnvs))
	}
}

// 2. TestPathAAttachmentSendRejectsMissingChunk: provide a storage_ref that does not resolve,
// assert the send fails with a specific error.
func TestPathAAttachmentSendRejectsMissingChunk(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	mux := setupInternalDeliveryTestMux()
	vec := loadSignedVector(t)
	_, senderMailboxID, senderToken, _, recipientEmail := setupInternalDeliveryTest(t, db, vec)
	recJSON, senderJSON := createSignedEnvelopes(t, db, senderMailboxID, vec)
	_, _ = setupAttachmentMockStorage(t) // Empty storage - chunk does not exist

	missingRef := fmt.Sprintf("mailboxes/%s/path-a-attachments/missing-id/chunk_000.enc", senderMailboxID)
	sentRef := fmt.Sprintf("mailboxes/%s/sent-attachments/sent-1/missing-id/chunk_000.enc", senderMailboxID)

	attEnv := AttachmentEnvelope{
		AttachmentID: "missing-id",
		Filename:     "ghost.pdf",
		MimeType:     "application/pdf",
		SizeBytes:    1024,
		IV:           base64.StdEncoding.EncodeToString([]byte("12bytesnonce_")),
		WrappedKey: AttachmentWrappedKey{
			X25519Encapsulated: base64.StdEncoding.EncodeToString([]byte("32bytes_encapsulated_key_dummy_")),
			MLKEMEncryptedKey:  base64.StdEncoding.EncodeToString([]byte("mlkem_encrypted_content_key_mock_")),
		},
		ContentHashSHA256: base64.StdEncoding.EncodeToString([]byte("32bytes_sha256_content_hash_mock")),
		ChunkCount:        1,
		Chunks: []AttachmentChunk{
			{Index: 0, StorageRef: missingRef, SizeBytes: 1024},
		},
	}
	sentEnv := AttachmentEnvelope{
		AttachmentID: "missing-id",
		Filename:     "ghost.pdf",
		MimeType:     "application/pdf",
		SizeBytes:    1024,
		IV:           base64.StdEncoding.EncodeToString([]byte("12senderiv__")),
		WrappedKey: AttachmentWrappedKey{
			X25519Encapsulated: base64.StdEncoding.EncodeToString([]byte("32bytes_sender_encap_key_dummy_")),
			MLKEMEncryptedKey:  base64.StdEncoding.EncodeToString([]byte("mlkem_sender_encrypted_key_mock_")),
		},
		ContentHashSHA256: attEnv.ContentHashSHA256,
		ChunkCount:        1,
		Chunks: []AttachmentChunk{
			{Index: 0, StorageRef: sentRef, SizeBytes: 1024},
		},
	}

	sendReq := InternalSendRequest{
		EnvelopeJSON:              recJSON,
		SenderEnvelopeJSON:        senderJSON,
		Recipient:                 recipientEmail,
		SenderMailboxID:           senderMailboxID,
		AttachmentEnvelopes:       []AttachmentEnvelope{attEnv},
		SenderAttachmentEnvelopes: []AttachmentEnvelope{sentEnv},
	}
	body, _ := json.Marshal(sendReq)

	req := httptest.NewRequest("POST", "/v1/outbound/send-internal", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://127.0.0.1:3001")
	req.Header.Set("X-BYOS-Client", "webmail")
	req.AddCookie(&http.Cookie{Name: "byos_webmail_session", Value: senderToken})
	rec := httptest.NewRecorder()

	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("send-internal status = %d, want 400 Bad Request", rec.Code)
	}

	respBody := rec.Body.String()
	if !strings.Contains(respBody, "chunk missing") || !strings.Contains(respBody, missingRef) {
		t.Errorf("expected error naming missing chunk %s, got: %s", missingRef, respBody)
	}
}

// 3. TestPathAAttachmentDeliveryCopiesRefs: deliver a Path A message,
// assert the recipient's row has the same chunk refs.
func TestPathAAttachmentDeliveryCopiesRefs(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	mux := setupInternalDeliveryTestMux()
	vec := loadSignedVector(t)
	_, senderMailboxID, senderToken, recipientMailboxID, recipientEmail := setupInternalDeliveryTest(t, db, vec)
	recJSON, senderJSON := createSignedEnvelopes(t, db, senderMailboxID, vec)
	_, storage := setupAttachmentMockStorage(t)

	attID := uuid.New().String()
	chunkRef0 := fmt.Sprintf("mailboxes/%s/path-a-attachments/%s/chunk_000.enc", senderMailboxID, attID)
	chunkRef1 := fmt.Sprintf("mailboxes/%s/path-a-attachments/%s/chunk_001.enc", senderMailboxID, attID)
	storage.objects[chunkRef0] = []byte("chunk0")
	storage.objects[chunkRef1] = []byte("chunk1")

	sentChunkRef0 := fmt.Sprintf("mailboxes/%s/sent-attachments/sent-msg/%s/chunk_000.enc", senderMailboxID, attID)
	sentChunkRef1 := fmt.Sprintf("mailboxes/%s/sent-attachments/sent-msg/%s/chunk_001.enc", senderMailboxID, attID)
	storage.objects[sentChunkRef0] = []byte("sentchunk0")
	storage.objects[sentChunkRef1] = []byte("sentchunk1")

	attEnv := AttachmentEnvelope{
		AttachmentID: attID,
		Filename:     "multi_chunk.bin",
		MimeType:     "application/octet-stream",
		SizeBytes:    12,
		IV:           base64.StdEncoding.EncodeToString([]byte("12bytesnonce_")),
		WrappedKey: AttachmentWrappedKey{
			X25519Encapsulated: "enc_key_x25519",
			MLKEMEncryptedKey:  "enc_key_mlkem",
		},
		ContentHashSHA256: "hash123",
		ChunkCount:        2,
		Chunks: []AttachmentChunk{
			{Index: 0, StorageRef: chunkRef0, SizeBytes: 6},
			{Index: 1, StorageRef: chunkRef1, SizeBytes: 6},
		},
	}
	sentEnv := AttachmentEnvelope{
		AttachmentID: attID,
		Filename:     "multi_chunk.bin",
		MimeType:     "application/octet-stream",
		SizeBytes:    12,
		IV:           base64.StdEncoding.EncodeToString([]byte("12senderiv__")),
		WrappedKey: AttachmentWrappedKey{
			X25519Encapsulated: "enc_key_sender_x25519",
			MLKEMEncryptedKey:  "enc_key_sender_mlkem",
		},
		ContentHashSHA256: "hash123",
		ChunkCount:        2,
		Chunks: []AttachmentChunk{
			{Index: 0, StorageRef: sentChunkRef0, SizeBytes: 10},
			{Index: 1, StorageRef: sentChunkRef1, SizeBytes: 10},
		},
	}

	sendReq := InternalSendRequest{
		EnvelopeJSON:              recJSON,
		SenderEnvelopeJSON:        senderJSON,
		Recipient:                 recipientEmail,
		SenderMailboxID:           senderMailboxID,
		AttachmentEnvelopes:       []AttachmentEnvelope{attEnv},
		SenderAttachmentEnvelopes: []AttachmentEnvelope{sentEnv},
	}
	body, _ := json.Marshal(sendReq)

	req := httptest.NewRequest("POST", "/v1/outbound/send-internal", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://127.0.0.1:3001")
	req.Header.Set("X-BYOS-Client", "webmail")
	req.AddCookie(&http.Cookie{Name: "byos_webmail_session", Value: senderToken})
	rec := httptest.NewRecorder()

	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("send-internal status = %d, want 201", rec.Code)
	}

	var resp InternalSendResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)

	var storedJSON []byte
	err := db.QueryRow(`
		SELECT COALESCE(attachment_envelopes, '[]'::jsonb)
		FROM message_metadata
		WHERE id = $1 AND mailbox_id = $2
	`, resp.MessageID, recipientMailboxID).Scan(&storedJSON)
	if err != nil {
		t.Fatalf("query recipient row: %v", err)
	}

	var recEnvs []AttachmentEnvelope
	_ = json.Unmarshal(storedJSON, &recEnvs)
	if len(recEnvs) != 1 || len(recEnvs[0].Chunks) != 2 {
		t.Fatalf("recipient chunk count mismatch: %+v", recEnvs)
	}

	if recEnvs[0].Chunks[0].StorageRef != chunkRef0 || recEnvs[0].Chunks[1].StorageRef != chunkRef1 {
		t.Errorf("recipient chunk refs do not match sender refs: got %s, %s; want %s, %s",
			recEnvs[0].Chunks[0].StorageRef, recEnvs[0].Chunks[1].StorageRef, chunkRef0, chunkRef1)
	}
}

// 4. TestPathAAttachmentSentCopyReEncrypts: assert the Sent copy has new storage refs under
// sent-attachments/ and a different wrapped key.
func TestPathAAttachmentSentCopyReEncrypts(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	mux := setupInternalDeliveryTestMux()
	vec := loadSignedVector(t)
	_, senderMailboxID, senderToken, _, recipientEmail := setupInternalDeliveryTest(t, db, vec)
	recJSON, senderJSON := createSignedEnvelopes(t, db, senderMailboxID, vec)
	_, storage := setupAttachmentMockStorage(t)

	attID := uuid.New().String()
	recEnv, sentEnv := createTestAttachmentEnvelopes(senderMailboxID, attID, "invoice.pdf", []byte("invoice_payload"), storage)

	sendReq := InternalSendRequest{
		EnvelopeJSON:              recJSON,
		SenderEnvelopeJSON:        senderJSON,
		Recipient:                 recipientEmail,
		SenderMailboxID:           senderMailboxID,
		AttachmentEnvelopes:       []AttachmentEnvelope{recEnv},
		SenderAttachmentEnvelopes: []AttachmentEnvelope{sentEnv},
	}
	body, _ := json.Marshal(sendReq)

	req := httptest.NewRequest("POST", "/v1/outbound/send-internal", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://127.0.0.1:3001")
	req.Header.Set("X-BYOS-Client", "webmail")
	req.AddCookie(&http.Cookie{Name: "byos_webmail_session", Value: senderToken})
	rec := httptest.NewRecorder()

	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("send-internal status = %d, body = %s, want 201", rec.Code, rec.Body.String())
	}

	// Query sender's Sent copy row
	var sentEnvsJSON []byte
	err := db.QueryRow(`
		SELECT COALESCE(attachment_envelopes, '[]'::jsonb)
		FROM message_metadata
		WHERE mailbox_id = $1 AND folder = 'sent'
		ORDER BY message_seq DESC LIMIT 1
	`, senderMailboxID).Scan(&sentEnvsJSON)
	if err != nil {
		t.Fatalf("query Sent folder copy: %v", err)
	}

	var sentEnvs []AttachmentEnvelope
	if err := json.Unmarshal(sentEnvsJSON, &sentEnvs); err != nil {
		t.Fatalf("decode sent envelopes: %v", err)
	}
	if len(sentEnvs) != 1 {
		t.Fatalf("sent envelopes len = %d, want 1", len(sentEnvs))
	}

	sentAtt := sentEnvs[0]
	// 1. Assert new storage refs under sent-attachments/
	if len(sentAtt.Chunks) == 0 {
		t.Fatalf("sent copy has no chunks")
	}
	sentRef := sentAtt.Chunks[0].StorageRef
	if !strings.Contains(sentRef, "sent-attachments/") {
		t.Errorf("sent copy storage_ref %s does not contain 'sent-attachments/'", sentRef)
	}

	// 2. Assert different wrapped key
	if sentAtt.WrappedKey.X25519Encapsulated == recEnv.WrappedKey.X25519Encapsulated ||
		sentAtt.WrappedKey.MLKEMEncryptedKey == recEnv.WrappedKey.MLKEMEncryptedKey {
		t.Errorf("sent copy wrapped_key (%+v) identical to recipient wrapped_key (%+v)",
			sentAtt.WrappedKey, recEnv.WrappedKey)
	}
}

// 5. TestPathAAttachmentSizeLimit: exceed 40 MB, assert rejection.
func TestPathAAttachmentSizeLimit(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	mux := setupInternalDeliveryTestMux()
	vec := loadSignedVector(t)
	_, senderMailboxID, senderToken, _, recipientEmail := setupInternalDeliveryTest(t, db, vec)
	recJSON, senderJSON := createSignedEnvelopes(t, db, senderMailboxID, vec)
	_, _ = setupAttachmentMockStorage(t)

	overSize := int64(41 * 1024 * 1024) // 41 MB > 40 MB limit

	attEnv := AttachmentEnvelope{
		AttachmentID: uuid.New().String(),
		Filename:     "huge.iso",
		MimeType:     "application/octet-stream",
		SizeBytes:    overSize,
		IV:           "nonce",
		WrappedKey: AttachmentWrappedKey{
			X25519Encapsulated: "dummy_x25519",
			MLKEMEncryptedKey:  "dummy_mlkem",
		},
		ContentHashSHA256: "hash",
		ChunkCount:        1,
		Chunks: []AttachmentChunk{
			{Index: 0, StorageRef: "mailboxes/test/path-a-attachments/test/chunk_000.enc", SizeBytes: overSize},
		},
	}

	sendReq := InternalSendRequest{
		EnvelopeJSON:        recJSON,
		SenderEnvelopeJSON:  senderJSON,
		Recipient:           recipientEmail,
		SenderMailboxID:     senderMailboxID,
		AttachmentEnvelopes: []AttachmentEnvelope{attEnv},
	}
	body, _ := json.Marshal(sendReq)

	req := httptest.NewRequest("POST", "/v1/outbound/send-internal", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://127.0.0.1:3001")
	req.Header.Set("X-BYOS-Client", "webmail")
	req.AddCookie(&http.Cookie{Name: "byos_webmail_session", Value: senderToken})
	rec := httptest.NewRecorder()

	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("send-internal status = %d, want 400 Bad Request", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "40 MB") && !strings.Contains(rec.Body.String(), "limit") {
		t.Errorf("expected size limit rejection message, got: %s", rec.Body.String())
	}
}

// 6. TestPathAAttachmentEndpoints: test GET attachment envelopes and GET chunk endpoints.
func TestPathAAttachmentEndpoints(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/outbound/send-internal", withSecurityHeaders(withCORS(internalSendHandler)))
	mux.HandleFunc("/v1/mailboxes/{mailbox_id}/messages/{message_id}/attachments", withSecurityHeaders(withCORS(messageAttachmentsHandler)))
	mux.HandleFunc("/v1/mailboxes/{mailbox_id}/messages/{message_id}/attachments/{attachment_id}/chunks/{index}", withSecurityHeaders(withCORS(messageAttachmentChunkHandler)))

	vec := loadSignedVector(t)
	_, senderMailboxID, senderToken, recipientMailboxID, recipientEmail := setupInternalDeliveryTest(t, db, vec)
	recJSON, senderJSON := createSignedEnvelopes(t, db, senderMailboxID, vec)
	_, storage := setupAttachmentMockStorage(t)

	// Get recipient user ID to create session for recipient
	var recipientUserID string
	err := db.QueryRow("SELECT user_id::text FROM mailboxes WHERE id = $1", recipientMailboxID).Scan(&recipientUserID)
	if err != nil {
		t.Fatalf("lookup recipient user: %v", err)
	}
	recipientToken := createTestSession(t, db, recipientUserID)

	attID := uuid.New().String()
	rawChunkBytes := []byte("encrypted_raw_chunk_payload_bytes_12345")
	recEnv, sentEnv := createTestAttachmentEnvelopes(senderMailboxID, attID, "report.pdf", rawChunkBytes, storage)

	sendReq := InternalSendRequest{
		EnvelopeJSON:              recJSON,
		SenderEnvelopeJSON:        senderJSON,
		Recipient:                 recipientEmail,
		SenderMailboxID:           senderMailboxID,
		AttachmentEnvelopes:       []AttachmentEnvelope{recEnv},
		SenderAttachmentEnvelopes: []AttachmentEnvelope{sentEnv},
	}
	body, _ := json.Marshal(sendReq)

	req := httptest.NewRequest("POST", "/v1/outbound/send-internal", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://127.0.0.1:3001")
	req.Header.Set("X-BYOS-Client", "webmail")
	req.AddCookie(&http.Cookie{Name: "byos_webmail_session", Value: senderToken})
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("send-internal failed: %d %s", rec.Code, rec.Body.String())
	}
	var resp InternalSendResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)

	// 1. Test GET /v1/mailboxes/{mailbox_id}/messages/{message_id}/attachments
	listReq := httptest.NewRequest("GET", fmt.Sprintf("/v1/mailboxes/%s/messages/%s/attachments", recipientMailboxID, resp.MessageID), nil)
	listReq.SetPathValue("mailbox_id", recipientMailboxID)
	listReq.SetPathValue("message_id", resp.MessageID)
	listReq.AddCookie(&http.Cookie{Name: "byos_session", Value: recipientToken})
	listRec := httptest.NewRecorder()
	mux.ServeHTTP(listRec, listReq)

	if listRec.Code != http.StatusOK {
		t.Fatalf("GET attachments failed: %d %s", listRec.Code, listRec.Body.String())
	}
	var listResp struct {
		Attachments []AttachmentEnvelope `json:"attachments"`
	}
	if err := json.Unmarshal(listRec.Body.Bytes(), &listResp); err != nil {
		t.Fatalf("failed to parse attachments list response: %v", err)
	}
	if len(listResp.Attachments) != 1 || listResp.Attachments[0].AttachmentID != attID {
		t.Fatalf("unexpected attachments list: %+v", listResp)
	}

	// 2. Test GET chunk: /v1/mailboxes/{mailbox_id}/messages/{message_id}/attachments/{attachment_id}/chunks/{index}
	chunkReq := httptest.NewRequest("GET", fmt.Sprintf("/v1/mailboxes/%s/messages/%s/attachments/%s/chunks/0", recipientMailboxID, resp.MessageID, attID), nil)
	chunkReq.SetPathValue("mailbox_id", recipientMailboxID)
	chunkReq.SetPathValue("message_id", resp.MessageID)
	chunkReq.SetPathValue("attachment_id", attID)
	chunkReq.SetPathValue("index", "0")
	chunkReq.AddCookie(&http.Cookie{Name: "byos_session", Value: recipientToken})
	chunkRec := httptest.NewRecorder()
	mux.ServeHTTP(chunkRec, chunkReq)

	if chunkRec.Code != http.StatusOK {
		t.Fatalf("GET chunk failed: %d %s", chunkRec.Code, chunkRec.Body.String())
	}
	if !bytes.Equal(chunkRec.Body.Bytes(), rawChunkBytes) {
		t.Fatalf("downloaded chunk bytes (%q) do not match expected rawChunkBytes (%q)", chunkRec.Body.Bytes(), rawChunkBytes)
	}
}

// Check 1: TestPathAAttachmentSentCopyChunksAreReEncrypted asserts that recipient and sender
// chunks in storage have different ciphertext bytes and SHA-256 hashes, while the plaintext content_hash_sha256 matches.
func TestPathAAttachmentSentCopyChunksAreReEncrypted(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	mux := setupInternalDeliveryTestMux()
	vec := loadSignedVector(t)
	_, senderMailboxID, senderToken, recipientMailboxID, recipientEmail := setupInternalDeliveryTest(t, db, vec)
	recJSON, senderJSON := createSignedEnvelopes(t, db, senderMailboxID, vec)
	_, storage := setupAttachmentMockStorage(t)

	attID := uuid.New().String()
	recipientChunkData := []byte("recipient_ciphertext_chunk_data_alpha")
	recEnv, senderEnv := createTestAttachmentEnvelopes(senderMailboxID, attID, "report.pdf", recipientChunkData, storage)

	sendReq := InternalSendRequest{
		EnvelopeJSON:              recJSON,
		SenderEnvelopeJSON:        senderJSON,
		Recipient:                 recipientEmail,
		SenderMailboxID:           senderMailboxID,
		AttachmentEnvelopes:       []AttachmentEnvelope{recEnv},
		SenderAttachmentEnvelopes: []AttachmentEnvelope{senderEnv},
	}
	body, _ := json.Marshal(sendReq)

	req := httptest.NewRequest("POST", "/v1/outbound/send-internal", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://127.0.0.1:3001")
	req.Header.Set("X-BYOS-Client", "webmail")
	req.AddCookie(&http.Cookie{Name: "byos_webmail_session", Value: senderToken})
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("send-internal status = %d, body = %s, want 201", rec.Code, rec.Body.String())
	}

	var resp InternalSendResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)

	// Fetch recipient chunk bytes from storage
	recStorageRef := recEnv.Chunks[0].StorageRef
	recBytes, ok := storage.objects[recStorageRef]
	if !ok {
		t.Fatalf("recipient chunk not found in storage at ref: %s", recStorageRef)
	}

	// Fetch sender chunk bytes from storage
	senderStorageRef := senderEnv.Chunks[0].StorageRef
	senderBytes, ok := storage.objects[senderStorageRef]
	if !ok {
		t.Fatalf("sender chunk not found in storage at ref: %s", senderStorageRef)
	}

	// Assert ciphertext bytes differ
	if bytes.Equal(recBytes, senderBytes) {
		t.Fatalf("recipient and sender chunk bytes are IDENTICAL! Chunks were not re-encrypted!")
	}

	// Assert SHA-256 hashes of ciphertext differ
	recCipherHash := sha256.Sum256(recBytes)
	senderCipherHash := sha256.Sum256(senderBytes)
	if recCipherHash == senderCipherHash {
		t.Fatalf("ciphertext SHA-256 hashes are identical! Must differ")
	}

	// Assert plaintext content hash is identical
	if recEnv.ContentHashSHA256 != senderEnv.ContentHashSHA256 {
		t.Fatalf("content_hash_sha256 mismatch between recipient and sender")
	}

	// Verify database row has both envelopes populated
	var recEnvsStored, senderEnvsStored []byte
	err := db.QueryRow(`
		SELECT COALESCE(attachment_envelopes, '[]'::jsonb), COALESCE(sender_attachment_envelopes, '[]'::jsonb)
		FROM message_metadata
		WHERE id = $1 AND mailbox_id = $2
	`, resp.MessageID, recipientMailboxID).Scan(&recEnvsStored, &senderEnvsStored)
	if err != nil {
		t.Fatalf("query recipient row: %v", err)
	}
	if len(recEnvsStored) == 0 || len(senderEnvsStored) == 0 {
		t.Fatalf("envelopes not stored in database")
	}
}

// Check 2: TestPathAAttachmentStoragePrefixIsNamespaced asserts that recipient chunk refs
// start with path-a-attachments/ and never collide with Path B attachments/
func TestPathAAttachmentStoragePrefixIsNamespaced(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	mux := setupInternalDeliveryTestMux()
	vec := loadSignedVector(t)
	_, senderMailboxID, senderToken, _, recipientEmail := setupInternalDeliveryTest(t, db, vec)
	recJSON, senderJSON := createSignedEnvelopes(t, db, senderMailboxID, vec)
	_, storage := setupAttachmentMockStorage(t)

	attID := uuid.New().String()
	recEnv, senderEnv := createTestAttachmentEnvelopes(senderMailboxID, attID, "data.pdf", []byte("data"), storage)

	// Recipient chunk ref must contain path-a-attachments/
	if !strings.Contains(recEnv.Chunks[0].StorageRef, "path-a-attachments/") {
		t.Errorf("recipient chunk ref does not contain path-a-attachments/: %s", recEnv.Chunks[0].StorageRef)
	}
	// Sender chunk ref must contain sent-attachments/
	if !strings.Contains(senderEnv.Chunks[0].StorageRef, "sent-attachments/") {
		t.Errorf("sender chunk ref does not contain sent-attachments/: %s", senderEnv.Chunks[0].StorageRef)
	}

	// Attempting to deliver with legacy Path B "attachments/" prefix must be rejected
	collidingEnv := recEnv
	collidingEnv.Chunks = []AttachmentChunk{
		{Index: 0, StorageRef: fmt.Sprintf("mailboxes/%s/attachments/%s/chunk_000.enc", senderMailboxID, attID), SizeBytes: 4},
	}
	storage.objects[collidingEnv.Chunks[0].StorageRef] = []byte("data")

	sendReq := InternalSendRequest{
		EnvelopeJSON:              recJSON,
		SenderEnvelopeJSON:        senderJSON,
		Recipient:                 recipientEmail,
		SenderMailboxID:           senderMailboxID,
		AttachmentEnvelopes:       []AttachmentEnvelope{collidingEnv},
		SenderAttachmentEnvelopes: []AttachmentEnvelope{senderEnv},
	}
	body, _ := json.Marshal(sendReq)

	req := httptest.NewRequest("POST", "/v1/outbound/send-internal", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://127.0.0.1:3001")
	req.Header.Set("X-BYOS-Client", "webmail")
	req.AddCookie(&http.Cookie{Name: "byos_webmail_session", Value: senderToken})
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request for non-namespaced prefix, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "path-a-attachments") {
		t.Errorf("expected error mentioning path-a-attachments, got: %s", rec.Body.String())
	}
}

// Check 3: TestPathAAttachmentPostgresHasNoCiphertext asserts that length(attachment_envelopes::text) < 8192
func TestPathAAttachmentPostgresHasNoCiphertext(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	mux := setupInternalDeliveryTestMux()
	vec := loadSignedVector(t)
	_, senderMailboxID, senderToken, recipientMailboxID, recipientEmail := setupInternalDeliveryTest(t, db, vec)
	recJSON, senderJSON := createSignedEnvelopes(t, db, senderMailboxID, vec)
	_, storage := setupAttachmentMockStorage(t)

	attID := uuid.New().String()
	largePayload := make([]byte, 500*1024) // 500 KB ciphertext in storage
	recEnv, senderEnv := createTestAttachmentEnvelopes(senderMailboxID, attID, "large_file.dat", largePayload, storage)

	sendReq := InternalSendRequest{
		EnvelopeJSON:              recJSON,
		SenderEnvelopeJSON:        senderJSON,
		Recipient:                 recipientEmail,
		SenderMailboxID:           senderMailboxID,
		AttachmentEnvelopes:       []AttachmentEnvelope{recEnv},
		SenderAttachmentEnvelopes: []AttachmentEnvelope{senderEnv},
	}
	body, _ := json.Marshal(sendReq)

	req := httptest.NewRequest("POST", "/v1/outbound/send-internal", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://127.0.0.1:3001")
	req.Header.Set("X-BYOS-Client", "webmail")
	req.AddCookie(&http.Cookie{Name: "byos_webmail_session", Value: senderToken})
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("send-internal status = %d, want 201", rec.Code)
	}

	var resp InternalSendResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)

	// Check length of attachment_envelopes::text in Postgres
	var envTextLen int
	err := db.QueryRow(`
		SELECT length(attachment_envelopes::text)
		FROM message_metadata
		WHERE id = $1 AND mailbox_id = $2
	`, resp.MessageID, recipientMailboxID).Scan(&envTextLen)
	if err != nil {
		t.Fatalf("query envTextLen: %v", err)
	}

	if envTextLen >= 8192 {
		t.Fatalf("attachment_envelopes::text length is %d >= 8192 bytes! Potential ciphertext leak into Postgres", envTextLen)
	}
}

// Check 7: TestPathAAttachmentSizeLimitServerSide asserts that an aggregate size_bytes > 40 MB returns HTTP 400
func TestPathAAttachmentSizeLimitServerSide(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	mux := setupInternalDeliveryTestMux()
	vec := loadSignedVector(t)
	_, senderMailboxID, senderToken, _, recipientEmail := setupInternalDeliveryTest(t, db, vec)
	recJSON, senderJSON := createSignedEnvelopes(t, db, senderMailboxID, vec)
	_, _ = setupAttachmentMockStorage(t)

	overLimit := int64(41 * 1024 * 1024) // 41 MB
	attEnv := AttachmentEnvelope{
		AttachmentID:      uuid.New().String(),
		Filename:          "overflow.bin",
		MimeType:          "application/octet-stream",
		SizeBytes:         overLimit,
		IV:                "nonce",
		WrappedKey:        AttachmentWrappedKey{X25519Encapsulated: "dummy", MLKEMEncryptedKey: "dummy"},
		ContentHashSHA256: "dummy_hash",
		ChunkCount:        1,
		Chunks: []AttachmentChunk{
			{Index: 0, StorageRef: "mailboxes/test/path-a-attachments/test/chunk_000.enc", SizeBytes: overLimit},
		},
	}

	sendReq := InternalSendRequest{
		EnvelopeJSON:        recJSON,
		SenderEnvelopeJSON:  senderJSON,
		Recipient:           recipientEmail,
		SenderMailboxID:     senderMailboxID,
		AttachmentEnvelopes: []AttachmentEnvelope{attEnv},
	}
	body, _ := json.Marshal(sendReq)

	req := httptest.NewRequest("POST", "/v1/outbound/send-internal", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://127.0.0.1:3001")
	req.Header.Set("X-BYOS-Client", "webmail")
	req.AddCookie(&http.Cookie{Name: "byos_webmail_session", Value: senderToken})
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected HTTP 400 Bad Request for > 40 MB attachment, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "40 MB") && !strings.Contains(rec.Body.String(), "limit") {
		t.Errorf("expected 40 MB limit error, got: %s", rec.Body.String())
	}
}

// Defect 2 verification: TestPathAAttachmentSizeLimitCountsSenderEnvelopes asserts that multiple sender envelopes
// summing to > 40 MB are rejected even if each individual envelope is <= 40 MB.
func TestPathAAttachmentSizeLimitCountsSenderEnvelopes(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	mux := setupInternalDeliveryTestMux()
	vec := loadSignedVector(t)
	_, senderMailboxID, senderToken, _, recipientEmail := setupInternalDeliveryTest(t, db, vec)
	recJSON, senderJSON := createSignedEnvelopes(t, db, senderMailboxID, vec)
	_, _ = setupAttachmentMockStorage(t)

	size25MB := int64(25 * 1024 * 1024) // 25 MB each, sum = 50 MB > 40 MB limit
	recEnv1 := AttachmentEnvelope{
		AttachmentID:      uuid.New().String(),
		Filename:          "part1.bin",
		MimeType:          "application/octet-stream",
		SizeBytes:         size25MB,
		IV:                "nonce1",
		WrappedKey:        AttachmentWrappedKey{X25519Encapsulated: "dummy1", MLKEMEncryptedKey: "dummy1"},
		ContentHashSHA256: "dummy_hash1",
		ChunkCount:        1,
		Chunks: []AttachmentChunk{
			{Index: 0, StorageRef: "mailboxes/" + senderMailboxID + "/path-a-attachments/part1/chunk_000.enc", SizeBytes: size25MB},
		},
	}
	senderEnv1 := AttachmentEnvelope{
		AttachmentID:      recEnv1.AttachmentID,
		Filename:          "part1.bin",
		MimeType:          "application/octet-stream",
		SizeBytes:         size25MB,
		IV:                "nonce1_s",
		WrappedKey:        AttachmentWrappedKey{X25519Encapsulated: "dummy1_s", MLKEMEncryptedKey: "dummy1_s"},
		ContentHashSHA256: "dummy_hash1",
		ChunkCount:        1,
		Chunks: []AttachmentChunk{
			{Index: 0, StorageRef: "mailboxes/" + senderMailboxID + "/sent-attachments/part1/chunk_000.enc", SizeBytes: size25MB},
		},
	}

	senderEnv2 := AttachmentEnvelope{
		AttachmentID:      uuid.New().String(),
		Filename:          "part2.bin",
		MimeType:          "application/octet-stream",
		SizeBytes:         size25MB,
		IV:                "nonce2_s",
		WrappedKey:        AttachmentWrappedKey{X25519Encapsulated: "dummy2_s", MLKEMEncryptedKey: "dummy2_s"},
		ContentHashSHA256: "dummy_hash2",
		ChunkCount:        1,
		Chunks: []AttachmentChunk{
			{Index: 0, StorageRef: "mailboxes/" + senderMailboxID + "/sent-attachments/part2/chunk_000.enc", SizeBytes: size25MB},
		},
	}

	sendReq := InternalSendRequest{
		EnvelopeJSON:              recJSON,
		SenderEnvelopeJSON:        senderJSON,
		Recipient:                 recipientEmail,
		SenderMailboxID:           senderMailboxID,
		AttachmentEnvelopes:       []AttachmentEnvelope{recEnv1},
		SenderAttachmentEnvelopes: []AttachmentEnvelope{senderEnv1, senderEnv2},
	}
	body, _ := json.Marshal(sendReq)

	req := httptest.NewRequest("POST", "/v1/outbound/send-internal", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://127.0.0.1:3001")
	req.Header.Set("X-BYOS-Client", "webmail")
	req.AddCookie(&http.Cookie{Name: "byos_webmail_session", Value: senderToken})
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected HTTP 400 Bad Request for sender attachments summing to > 40 MB, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "40 MB") && !strings.Contains(rec.Body.String(), "limit") {
		t.Errorf("expected 40 MB limit error, got: %s", rec.Body.String())
	}
}

// Defect 3 verification: TestPathAAttachmentRecipientRowHasNoSenderEnvelopes asserts that recipient's
// inbox row stores sender_attachment_envelopes = '[]'::jsonb and does not leak sender wrapped keys.
func TestPathAAttachmentRecipientRowHasNoSenderEnvelopes(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	mux := setupInternalDeliveryTestMux()
	vec := loadSignedVector(t)
	_, senderMailboxID, senderToken, recipientMailboxID, recipientEmail := setupInternalDeliveryTest(t, db, vec)
	recJSON, senderJSON := createSignedEnvelopes(t, db, senderMailboxID, vec)
	_, storage := setupAttachmentMockStorage(t)

	attID := uuid.New().String()
	payload := []byte("confidential report contents")
	recEnv, senderEnv := createTestAttachmentEnvelopes(senderMailboxID, attID, "report.pdf", payload, storage)

	sendReq := InternalSendRequest{
		EnvelopeJSON:              recJSON,
		SenderEnvelopeJSON:        senderJSON,
		Recipient:                 recipientEmail,
		SenderMailboxID:           senderMailboxID,
		AttachmentEnvelopes:       []AttachmentEnvelope{recEnv},
		SenderAttachmentEnvelopes: []AttachmentEnvelope{senderEnv},
	}
	body, _ := json.Marshal(sendReq)

	req := httptest.NewRequest("POST", "/v1/outbound/send-internal", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://127.0.0.1:3001")
	req.Header.Set("X-BYOS-Client", "webmail")
	req.AddCookie(&http.Cookie{Name: "byos_webmail_session", Value: senderToken})
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("send-internal status = %d, want 201; body: %s", rec.Code, rec.Body.String())
	}

	var resp InternalSendResponse
	_ = json.Unmarshal(rec.Body.Bytes(), &resp)

	// Verify recipient's inbox row has rec_len = 1, send_len = 0, and sender_attachment_envelopes = '[]'
	var recLen, sendLen int
	var senderEnvText string
	err := db.QueryRow(`
		SELECT jsonb_array_length(attachment_envelopes),
		       jsonb_array_length(sender_attachment_envelopes),
		       sender_attachment_envelopes::text
		FROM message_metadata
		WHERE id = $1 AND mailbox_id = $2
	`, resp.MessageID, recipientMailboxID).Scan(&recLen, &sendLen, &senderEnvText)
	if err != nil {
		t.Fatalf("query recipient message_metadata: %v", err)
	}

	if recLen != 1 {
		t.Errorf("recipient attachment_envelopes length = %d, want 1", recLen)
	}
	if sendLen != 0 {
		t.Errorf("recipient sender_attachment_envelopes length = %d, want 0 (metadata leak!)", sendLen)
	}
	if senderEnvText != "[]" {
		t.Errorf("recipient sender_attachment_envelopes = %q, want '[]'", senderEnvText)
	}

	// Verify sender's sent row has both rec_len = 1 and send_len = 1
	var sentRecLen, sentSendLen int
	err = db.QueryRow(`
		SELECT jsonb_array_length(attachment_envelopes),
		       jsonb_array_length(sender_attachment_envelopes)
		FROM message_metadata
		WHERE mailbox_id = $1 AND folder = 'sent'
		ORDER BY message_seq DESC LIMIT 1
	`, senderMailboxID).Scan(&sentRecLen, &sentSendLen)
	if err != nil {
		t.Fatalf("query sender message_metadata: %v", err)
	}

	if sentRecLen != 1 {
		t.Errorf("sender sent row attachment_envelopes length = %d, want 1", sentRecLen)
	}
	if sentSendLen != 1 {
		t.Errorf("sender sent row sender_attachment_envelopes length = %d, want 1", sentSendLen)
	}
}


