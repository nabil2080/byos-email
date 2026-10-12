package main

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"byos.email/crypto/envelope"
	"github.com/google/uuid"
)

// Helper to generate a fresh pair of signed envelopes with a random nonce/ciphertext
func generateSignedEnvelopesWithRandomPayload(t *testing.T, db *sql.DB, senderMailboxID string, vec signedVector) (recipientEnvelopeJSON string, senderEnvelopeJSON string) {
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
	var nonce [12]byte
	if _, err := rand.Read(nonce[:]); err != nil {
		t.Fatalf("rand nonce: %v", err)
	}

	randomCiphertext := make([]byte, 32)
	if _, err := rand.Read(randomCiphertext); err != nil {
		t.Fatalf("rand ct: %v", err)
	}

	// 1. Recipient envelope signed by sender
	recEnv := *origEnv
	recEnv.Nonce = base64.StdEncoding.EncodeToString(nonce[:])
	recEnv.Ciphertext = base64.StdEncoding.EncodeToString(randomCiphertext)
	recAAD, err := envelope.BuildEnvelopeAAD(recEnv.V, recEnv.Alg, recEnv.KeyID, recEnv.KeyEpoch, encBytes, nonce)
	if err != nil {
		t.Fatalf("build rec aad: %v", err)
	}
	recSigData := append(recAAD, randomCiphertext...)
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
	senderEnv.Nonce = base64.StdEncoding.EncodeToString(nonce[:])
	senderEnv.Ciphertext = base64.StdEncoding.EncodeToString(randomCiphertext)
	senderAAD, err := envelope.BuildEnvelopeAAD(senderEnv.V, senderEnv.Alg, senderEnv.KeyID, senderEnv.KeyEpoch, encBytes, nonce)
	if err != nil {
		t.Fatalf("build sender aad: %v", err)
	}
	senderSigData := append(senderAAD, randomCiphertext...)
	senderSig := ed25519.Sign(privKey, senderSigData)
	b64SenderSig := base64.StdEncoding.EncodeToString(senderSig)
	senderEnv.Sig = &b64SenderSig
	senderJSONBytes, err := envelope.MarshalCanonical(&senderEnv)
	if err != nil {
		t.Fatalf("marshal sender envelope: %v", err)
	}

	return string(recJSONBytes), string(senderJSONBytes)
}

func TestSendInternalIdempotentByClientQueueId(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	mux := setupInternalDeliveryTestMux()
	vec := loadSignedVector(t)
	_, senderMailboxID, senderToken, _, recipientEmail := setupInternalDeliveryTest(t, db, vec)
	setupMockStorageServer(t)

	recEnvJSON, senderEnvJSON := generateSignedEnvelopesWithRandomPayload(t, db, senderMailboxID, vec)
	clientQueueID := uuid.New().String()

	reqBody, _ := json.Marshal(InternalSendRequest{
		EnvelopeJSON:       recEnvJSON,
		SenderEnvelopeJSON: senderEnvJSON,
		Recipient:          recipientEmail,
		SenderMailboxID:    senderMailboxID,
		ClientQueueID:      &clientQueueID,
	})

	// First send: should be 201 Created and NOT idempotent replay
	req1 := httptest.NewRequest("POST", "/v1/outbound/send-internal", bytes.NewReader(reqBody))
	req1.Header.Set("Authorization", "Bearer "+senderToken)
	req1.Header.Set("Content-Type", "application/json")
	rr1 := httptest.NewRecorder()
	mux.ServeHTTP(rr1, req1)

	if rr1.Code != http.StatusCreated {
		t.Fatalf("first send expected 201 Created, got %d: %s", rr1.Code, rr1.Body.String())
	}
	if replayHdr := rr1.Header().Get("X-Idempotent-Replay"); replayHdr == "true" {
		t.Errorf("first send should not have X-Idempotent-Replay: true")
	}

	var resp1 InternalSendResponse
	if err := json.Unmarshal(rr1.Body.Bytes(), &resp1); err != nil {
		t.Fatalf("unmarshal resp1: %v", err)
	}
	if resp1.MessageID == "" {
		t.Fatal("resp1 message_id is empty")
	}

	// Second send with SAME clientQueueID (even if sent again): should return 200 OK with X-Idempotent-Replay: true
	req2 := httptest.NewRequest("POST", "/v1/outbound/send-internal", bytes.NewReader(reqBody))
	req2.Header.Set("Authorization", "Bearer "+senderToken)
	req2.Header.Set("Content-Type", "application/json")
	rr2 := httptest.NewRecorder()
	mux.ServeHTTP(rr2, req2)

	if rr2.Code != http.StatusOK {
		t.Fatalf("second send expected 200 OK, got %d: %s", rr2.Code, rr2.Body.String())
	}
	if replayHdr := rr2.Header().Get("X-Idempotent-Replay"); replayHdr != "true" {
		t.Errorf("second send expected X-Idempotent-Replay: true, got %q", replayHdr)
	}

	// Verify DB has exactly one row for this client_queue_id
	var count int
	err := db.QueryRow("SELECT count(*) FROM message_metadata WHERE mailbox_id = $1 AND client_queue_id = $2", senderMailboxID, clientQueueID).Scan(&count)
	if err != nil {
		t.Fatalf("query count: %v", err)
	}
	if count != 1 {
		t.Errorf("expected count 1 for client_queue_id, got %d", count)
	}
}

func TestSendInternalWithoutClientQueueIdIsNotIdempotent(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	mux := setupInternalDeliveryTestMux()
	vec := loadSignedVector(t)
	_, senderMailboxID, senderToken, _, recipientEmail := setupInternalDeliveryTest(t, db, vec)
	setupMockStorageServer(t)

	// First send with envelope A without client_queue_id
	recEnvJSON1, senderEnvJSON1 := generateSignedEnvelopesWithRandomPayload(t, db, senderMailboxID, vec)
	reqBody1, _ := json.Marshal(InternalSendRequest{
		EnvelopeJSON:       recEnvJSON1,
		SenderEnvelopeJSON: senderEnvJSON1,
		Recipient:          recipientEmail,
		SenderMailboxID:    senderMailboxID,
	})

	req1 := httptest.NewRequest("POST", "/v1/outbound/send-internal", bytes.NewReader(reqBody1))
	req1.Header.Set("Authorization", "Bearer "+senderToken)
	req1.Header.Set("Content-Type", "application/json")
	rr1 := httptest.NewRecorder()
	mux.ServeHTTP(rr1, req1)

	if rr1.Code != http.StatusCreated {
		t.Fatalf("first send expected 201 Created, got %d: %s", rr1.Code, rr1.Body.String())
	}
	if replayHdr := rr1.Header().Get("X-Idempotent-Replay"); replayHdr == "true" {
		t.Errorf("first send should not have X-Idempotent-Replay: true")
	}

	// Second send with a new envelope B without client_queue_id
	recEnvJSON2, senderEnvJSON2 := generateSignedEnvelopesWithRandomPayload(t, db, senderMailboxID, vec)
	reqBody2, _ := json.Marshal(InternalSendRequest{
		EnvelopeJSON:       recEnvJSON2,
		SenderEnvelopeJSON: senderEnvJSON2,
		Recipient:          recipientEmail,
		SenderMailboxID:    senderMailboxID,
	})

	req2 := httptest.NewRequest("POST", "/v1/outbound/send-internal", bytes.NewReader(reqBody2))
	req2.Header.Set("Authorization", "Bearer "+senderToken)
	req2.Header.Set("Content-Type", "application/json")
	rr2 := httptest.NewRecorder()
	mux.ServeHTTP(rr2, req2)

	if rr2.Code != http.StatusCreated {
		t.Fatalf("second send expected 201 Created (distinct message), got %d: %s", rr2.Code, rr2.Body.String())
	}
	if replayHdr := rr2.Header().Get("X-Idempotent-Replay"); replayHdr == "true" {
		t.Errorf("second send without client_queue_id should not have X-Idempotent-Replay: true")
	}

	// Verify both sent copies were created in DB (total 2 rows for sender)
	var count int
	err := db.QueryRow("SELECT count(*) FROM message_metadata WHERE mailbox_id = $1 AND folder = 'sent'", senderMailboxID).Scan(&count)
	if err != nil {
		t.Fatalf("query count: %v", err)
	}
	if count != 2 {
		t.Errorf("expected 2 distinct sent messages, got %d", count)
	}
}
