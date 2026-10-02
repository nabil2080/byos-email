package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"byos.email/crypto/envelope"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	_ "github.com/jackc/pgx/v5/stdlib"
)

type signedVector struct {
	EnvelopeJSON               string `json:"envelope_json"`
	PlaintextHex               string `json:"plaintext_hex"`
	RecipientXWingPublicKeyHex string `json:"recipient_xwing_public_key_hex"`
	RecipientXWingSeedHex      string `json:"recipient_xwing_seed_hex"`
	SenderEd25519PublicKeyHex  string `json:"sender_ed25519_public_key_hex"`
}

func loadSignedVector(t *testing.T) signedVector {
	t.Helper()
	path := filepath.Join("..", "..", "crypto", "envelope", "testdata", "envelope_signed_rust.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("failed to read test vector file: %v", err)
	}
	var vec signedVector
	if err := json.Unmarshal(data, &vec); err != nil {
		t.Fatalf("failed to parse test vector: %v", err)
	}
	return vec
}

func setupInternalDeliveryTestMux() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /v1/outbound/send-internal", withSecurityHeaders(withCORS(internalSendHandler)))
	return mux
}

func setupInternalDeliveryTest(t *testing.T, db *sql.DB, vec signedVector) (senderUserID, senderMailboxID, senderToken, recipientMailboxID, recipientEmail string) {
	t.Helper()

	env, err := envelope.UnmarshalCanonical([]byte(vec.EnvelopeJSON))
	if err != nil {
		t.Fatalf("failed to unmarshal canonical envelope: %v", err)
	}
	recipientMailboxID = env.KeyID
	tag := uuid.New().String()[:8]
	domainName := "test-" + tag + ".local"
	recipientEmail = "recipient@" + domainName

	// Clean up any stale data with this recipient ID
	_, _ = db.Exec("DELETE FROM message_metadata WHERE mailbox_id = $1", recipientMailboxID)
	_, _ = db.Exec("DELETE FROM mailboxes WHERE id = $1", recipientMailboxID)

	var orgID string
	err = db.QueryRow(`
		INSERT INTO organizations (name, org_recovery_pk)
		VALUES ($1, decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'))
		RETURNING id
	`, "Org "+tag).Scan(&orgID)
	if err != nil {
		t.Fatalf("insert org failed: %v", err)
	}

	var domainID string
	err = db.QueryRow(`
		INSERT INTO domains (org_id, name, is_verified)
		VALUES ($1, $2, true)
		RETURNING id
	`, orgID, domainName).Scan(&domainID)
	if err != nil {
		t.Fatalf("insert domain failed: %v", err)
	}

	var rootSecretID string
	err = db.QueryRow(`
		INSERT INTO root_secrets (root_secret_wrapped)
		VALUES (decode('AA==', 'base64'))
		RETURNING id
	`).Scan(&rootSecretID)
	if err != nil {
		t.Fatalf("insert root secret failed: %v", err)
	}

	// Sender user & token
	err = db.QueryRow(`
		INSERT INTO users (org_id, email, display_name, password_hash, is_active, role)
		VALUES ($1, $2, 'Sender User', '$2a$10$dummyhashdummyhashdummyhashdummyhashdummyhas', true, 'owner')
		RETURNING id
	`, orgID, "sender-"+tag+"@byos.local").Scan(&senderUserID)
	if err != nil {
		t.Fatalf("insert sender user failed: %v", err)
	}
	senderToken = createTestSession(t, db, senderUserID)

	senderPKBytes, err := hex.DecodeString(vec.SenderEd25519PublicKeyHex)
	if err != nil {
		t.Fatalf("decode sender PK: %v", err)
	}

	err = db.QueryRow(`
		INSERT INTO mailboxes (
			org_id, user_id, domain_id, local_part, mode,
			root_secret_id, mailbox_sk_wrapped, mailbox_pk,
			mailbox_xwing_pk, mailbox_ed25519_pk,
			key_epoch, signing_key_epoch, key_status, is_active
		) VALUES (
			$1, $2, $3, 'sender', 'org_managed',
			$4, decode('AA==', 'base64'), decode('AA==', 'base64'),
			decode('AA==', 'base64'), $5,
			1, 1, 'active', true
		) RETURNING id
	`, orgID, senderUserID, domainID, rootSecretID, senderPKBytes).Scan(&senderMailboxID)
	if err != nil {
		t.Fatalf("insert sender mailbox failed: %v", err)
	}

	// Recipient user & mailbox (with ID = vector's key_id UUID)
	var recipientUserID string
	err = db.QueryRow(`
		INSERT INTO users (org_id, email, display_name, password_hash, is_active, role)
		VALUES ($1, $2, 'Recipient User', '$2a$10$dummyhashdummyhashdummyhashdummyhashdummyhas', true, 'member')
		RETURNING id
	`, orgID, "recipient-"+tag+"@byos.local").Scan(&recipientUserID)
	if err != nil {
		t.Fatalf("insert recipient user failed: %v", err)
	}

	recipientXWingPKBytes, err := hex.DecodeString(vec.RecipientXWingPublicKeyHex)
	if err != nil {
		t.Fatalf("decode recipient X-Wing PK: %v", err)
	}

	_, err = db.Exec(`
		INSERT INTO mailboxes (
			id, org_id, user_id, domain_id, local_part, mode,
			root_secret_id, mailbox_sk_wrapped, mailbox_pk,
			mailbox_xwing_pk, mailbox_ed25519_pk,
			key_epoch, signing_key_epoch, key_status, is_active
		) VALUES (
			$1, $2, $3, $4, 'recipient', 'org_managed',
			$5, decode('AA==', 'base64'), decode('AA==', 'base64'),
			$6, decode('AA==', 'base64'),
			1, 1, 'active', true
		)
	`, recipientMailboxID, orgID, recipientUserID, domainID, rootSecretID, recipientXWingPKBytes)
	if err != nil {
		t.Fatalf("insert recipient mailbox failed: %v", err)
	}

	t.Cleanup(func() {
		_, _ = db.Exec("DELETE FROM message_metadata WHERE mailbox_id = $1", recipientMailboxID)
		_, _ = db.Exec("DELETE FROM mailboxes WHERE id = $1", recipientMailboxID)
		_, _ = db.Exec("DELETE FROM mailboxes WHERE id = $1", senderMailboxID)
		_, _ = db.Exec("DELETE FROM users WHERE id IN ($1, $2)", senderUserID, recipientUserID)
		_, _ = db.Exec("DELETE FROM domains WHERE id = $1", domainID)
		_, _ = db.Exec("DELETE FROM root_secrets WHERE id = $1", rootSecretID)
		_, _ = db.Exec("DELETE FROM organizations WHERE id = $1", orgID)
	})

	return senderUserID, senderMailboxID, senderToken, recipientMailboxID, recipientEmail
}

func setupMockStorageServer(t *testing.T) (*httptest.Server, *[][]byte) {
	t.Helper()
	var payloads [][]byte
	mockStorage := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/store" {
			b, _ := io.ReadAll(r.Body)
			payloads = append(payloads, b)
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"status":"ok"}`))
			return
		}
		if r.URL.Path == "/api/retrieve" {
			// Retrieve returns the most recently stored envelope data
			if len(payloads) > 0 {
				var storeReq struct {
					Data []byte `json:"data"`
				}
				_ = json.Unmarshal(payloads[len(payloads)-1], &storeReq)
				retResp := map[string]interface{}{
					"data": base64.StdEncoding.EncodeToString(storeReq.Data),
					"size": len(storeReq.Data),
				}
				w.WriteHeader(http.StatusOK)
				_ = json.NewEncoder(w).Encode(retResp)
				return
			}
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(func() { mockStorage.Close() })
	t.Setenv("STORAGE_WORKER_URL", mockStorage.URL)
	return mockStorage, &payloads
}

// 1. TestInternalDeliverSuccess
func TestInternalDeliverSuccess(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	mux := setupInternalDeliveryTestMux()
	vec := loadSignedVector(t)
	_, senderMailboxID, senderToken, recipientMailboxID, recipientEmail := setupInternalDeliveryTest(t, db, vec)
	_, storedPayloads := setupMockStorageServer(t)

	reqBody, _ := json.Marshal(InternalSendRequest{
		EnvelopeJSON:    vec.EnvelopeJSON,
		Recipient:       recipientEmail,
		SenderMailboxID: senderMailboxID,
	})

	req := httptest.NewRequest("POST", "/v1/outbound/send-internal", bytes.NewReader(reqBody))
	req.Header.Set("Authorization", "Bearer "+senderToken)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp InternalSendResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response JSON: %v", err)
	}

	if resp.Status != "delivered" {
		t.Errorf("expected status 'delivered', got %q", resp.Status)
	}
	if resp.MessageID == "" {
		t.Errorf("expected non-empty message_id")
	}
	if resp.DeliveryID == "" {
		t.Errorf("expected non-empty delivery_id")
	}
	if resp.MessageSeq <= 0 {
		t.Errorf("expected message_seq > 0, got %d", resp.MessageSeq)
	}

	// Verify DB row created with correct fields
	var (
		dbDirection       string
		dbStatus          string
		dbWrappedKeyAlg   string
		dbSender          string
		dbHasAttachments  bool
		dbStorageObjectID string
	)
	err := db.QueryRow(`
		SELECT direction, status, wrapped_key_algorithm, sender, has_attachments, storage_object_id
		FROM message_metadata
		WHERE id = $1 AND mailbox_id = $2
	`, resp.MessageID, recipientMailboxID).Scan(
		&dbDirection, &dbStatus, &dbWrappedKeyAlg, &dbSender, &dbHasAttachments, &dbStorageObjectID,
	)
	if err != nil {
		t.Fatalf("failed to query created message_metadata row: %v", err)
	}

	if dbDirection != "received" {
		t.Errorf("expected direction 'received', got %q", dbDirection)
	}
	if dbStatus != "received" {
		t.Errorf("expected status 'received', got %q", dbStatus)
	}
	if dbWrappedKeyAlg != "HPKE-XWing-AES256GCM-v1" {
		t.Errorf("expected wrapped_key_algorithm 'HPKE-XWing-AES256GCM-v1', got %q", dbWrappedKeyAlg)
	}
	if !strings.HasPrefix(dbSender, "sender@") {
		t.Errorf("expected sender to start with 'sender@', got %q", dbSender)
	}
	if dbHasAttachments {
		t.Errorf("expected has_attachments=false")
	}
	expectedStoragePrefix := fmt.Sprintf("mailboxes/%s/", recipientMailboxID)
	if !strings.HasPrefix(dbStorageObjectID, expectedStoragePrefix) {
		t.Errorf("expected storage_object_id to start with %q, got %q", expectedStoragePrefix, dbStorageObjectID)
	}

	// Verify storage worker was called
	if len(*storedPayloads) != 1 {
		t.Fatalf("expected 1 storage-worker call, got %d", len(*storedPayloads))
	}
}

// 2. TestInternalDeliverUnauthenticated -> 401
func TestInternalDeliverUnauthenticated(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	mux := setupInternalDeliveryTestMux()
	vec := loadSignedVector(t)
	_, senderMailboxID, _, _, recipientEmail := setupInternalDeliveryTest(t, db, vec)

	reqBody, _ := json.Marshal(InternalSendRequest{
		EnvelopeJSON:    vec.EnvelopeJSON,
		Recipient:       recipientEmail,
		SenderMailboxID: senderMailboxID,
	})

	req := httptest.NewRequest("POST", "/v1/outbound/send-internal", bytes.NewReader(reqBody))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized, got %d: %s", rr.Code, rr.Body.String())
	}
}

// 3. TestInternalDeliverRecipientNotFound -> 404 recipient_not_found
func TestInternalDeliverRecipientNotFound(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	mux := setupInternalDeliveryTestMux()
	vec := loadSignedVector(t)
	_, senderMailboxID, senderToken, _, _ := setupInternalDeliveryTest(t, db, vec)

	reqBody, _ := json.Marshal(InternalSendRequest{
		EnvelopeJSON:    vec.EnvelopeJSON,
		Recipient:       "nobody@nonexistent-domain-404.local",
		SenderMailboxID: senderMailboxID,
	})

	req := httptest.NewRequest("POST", "/v1/outbound/send-internal", bytes.NewReader(reqBody))
	req.Header.Set("Authorization", "Bearer "+senderToken)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("expected 404 Not Found, got %d: %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "recipient_not_found") {
		t.Errorf("expected recipient_not_found in body, got: %s", rr.Body.String())
	}
}

// 4. TestInternalDeliverRecipientNotXWing -> 400 recipient_not_xwing
func TestInternalDeliverRecipientNotXWing(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	mux := setupInternalDeliveryTestMux()
	vec := loadSignedVector(t)
	_, senderMailboxID, senderToken, recipientMailboxID, recipientEmail := setupInternalDeliveryTest(t, db, vec)

	// Set recipient's mailbox_xwing_pk to NULL
	_, err := db.Exec("UPDATE mailboxes SET mailbox_xwing_pk = NULL WHERE id = $1", recipientMailboxID)
	if err != nil {
		t.Fatalf("update recipient mailbox: %v", err)
	}

	reqBody, _ := json.Marshal(InternalSendRequest{
		EnvelopeJSON:    vec.EnvelopeJSON,
		Recipient:       recipientEmail,
		SenderMailboxID: senderMailboxID,
	})

	req := httptest.NewRequest("POST", "/v1/outbound/send-internal", bytes.NewReader(reqBody))
	req.Header.Set("Authorization", "Bearer "+senderToken)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request, got %d: %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "recipient_not_xwing") {
		t.Errorf("expected recipient_not_xwing in body, got: %s", rr.Body.String())
	}
}

// 5. TestInternalDeliverKeyIDMismatch -> 400 key_id_mismatch
func TestInternalDeliverKeyIDMismatch(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	mux := setupInternalDeliveryTestMux()
	vec := loadSignedVector(t)
	_, senderMailboxID, senderToken, _, recipientEmail := setupInternalDeliveryTest(t, db, vec)

	env, err := envelope.UnmarshalCanonical([]byte(vec.EnvelopeJSON))
	if err != nil {
		t.Fatalf("unmarshal canonical: %v", err)
	}

	// Change key_id to a different UUID
	env.KeyID = "00000000-0000-0000-0000-000000000099"
	canonicalBytes, err := envelope.MarshalCanonical(env)
	if err != nil {
		t.Fatalf("marshal canonical: %v", err)
	}

	reqBody, _ := json.Marshal(InternalSendRequest{
		EnvelopeJSON:    string(canonicalBytes),
		Recipient:       recipientEmail,
		SenderMailboxID: senderMailboxID,
	})

	req := httptest.NewRequest("POST", "/v1/outbound/send-internal", bytes.NewReader(reqBody))
	req.Header.Set("Authorization", "Bearer "+senderToken)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request, got %d: %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "key_id_mismatch") {
		t.Errorf("expected key_id_mismatch in body, got: %s", rr.Body.String())
	}
}

// 6. TestInternalDeliverInvalidSignature -> 400 invalid_signature
func TestInternalDeliverInvalidSignature(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	mux := setupInternalDeliveryTestMux()
	vec := loadSignedVector(t)
	_, senderMailboxID, senderToken, _, recipientEmail := setupInternalDeliveryTest(t, db, vec)

	env, err := envelope.UnmarshalCanonical([]byte(vec.EnvelopeJSON))
	if err != nil {
		t.Fatalf("unmarshal canonical: %v", err)
	}

	// Flip a byte in ciphertext
	ctBytes, err := base64.StdEncoding.DecodeString(env.Ciphertext)
	if err != nil {
		t.Fatalf("decode ciphertext: %v", err)
	}
	ctBytes[0] ^= 0xFF
	env.Ciphertext = base64.StdEncoding.EncodeToString(ctBytes)

	canonicalBytes, err := envelope.MarshalCanonical(env)
	if err != nil {
		t.Fatalf("marshal canonical: %v", err)
	}

	reqBody, _ := json.Marshal(InternalSendRequest{
		EnvelopeJSON:    string(canonicalBytes),
		Recipient:       recipientEmail,
		SenderMailboxID: senderMailboxID,
	})

	req := httptest.NewRequest("POST", "/v1/outbound/send-internal", bytes.NewReader(reqBody))
	req.Header.Set("Authorization", "Bearer "+senderToken)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request, got %d: %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "invalid_signature") {
		t.Errorf("expected invalid_signature in body, got: %s", rr.Body.String())
	}
}

// 7. TestInternalDeliverSenderNoSigningKey -> 400 sender_has_no_signing_key
func TestInternalDeliverSenderNoSigningKey(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	mux := setupInternalDeliveryTestMux()
	vec := loadSignedVector(t)
	_, senderMailboxID, senderToken, _, recipientEmail := setupInternalDeliveryTest(t, db, vec)

	// Remove sender's mailbox_ed25519_pk before test
	_, err := db.Exec("UPDATE mailboxes SET mailbox_ed25519_pk = NULL WHERE id = $1", senderMailboxID)
	if err != nil {
		t.Fatalf("remove sender signing key: %v", err)
	}

	reqBody, _ := json.Marshal(InternalSendRequest{
		EnvelopeJSON:    vec.EnvelopeJSON,
		Recipient:       recipientEmail,
		SenderMailboxID: senderMailboxID,
	})

	req := httptest.NewRequest("POST", "/v1/outbound/send-internal", bytes.NewReader(reqBody))
	req.Header.Set("Authorization", "Bearer "+senderToken)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request, got %d: %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "sender_has_no_signing_key") {
		t.Errorf("expected sender_has_no_signing_key in body, got: %s", rr.Body.String())
	}
}

// 8. TestInternalDeliverIdempotent -> 201 first, 200 second, 1 DB row
func TestInternalDeliverIdempotent(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	mux := setupInternalDeliveryTestMux()
	vec := loadSignedVector(t)
	_, senderMailboxID, senderToken, recipientMailboxID, recipientEmail := setupInternalDeliveryTest(t, db, vec)
	setupMockStorageServer(t)

	reqBody, _ := json.Marshal(InternalSendRequest{
		EnvelopeJSON:    vec.EnvelopeJSON,
		Recipient:       recipientEmail,
		SenderMailboxID: senderMailboxID,
	})

	// First request -> 201 Created
	req1 := httptest.NewRequest("POST", "/v1/outbound/send-internal", bytes.NewReader(reqBody))
	req1.Header.Set("Authorization", "Bearer "+senderToken)
	req1.Header.Set("Content-Type", "application/json")
	rr1 := httptest.NewRecorder()
	mux.ServeHTTP(rr1, req1)

	if rr1.Code != http.StatusCreated {
		t.Fatalf("expected first request 201 Created, got %d: %s", rr1.Code, rr1.Body.String())
	}
	var resp1 InternalSendResponse
	if err := json.Unmarshal(rr1.Body.Bytes(), &resp1); err != nil {
		t.Fatalf("failed to decode response 1: %v", err)
	}
	if resp1.Status != "delivered" {
		t.Errorf("expected first status 'delivered', got %q", resp1.Status)
	}

	// Second request -> 200 OK already_delivered
	req2 := httptest.NewRequest("POST", "/v1/outbound/send-internal", bytes.NewReader(reqBody))
	req2.Header.Set("Authorization", "Bearer "+senderToken)
	req2.Header.Set("Content-Type", "application/json")
	rr2 := httptest.NewRecorder()
	mux.ServeHTTP(rr2, req2)

	if rr2.Code != http.StatusOK {
		t.Fatalf("expected second request 200 OK, got %d: %s", rr2.Code, rr2.Body.String())
	}
	var resp2 InternalSendResponse
	if err := json.Unmarshal(rr2.Body.Bytes(), &resp2); err != nil {
		t.Fatalf("failed to decode response 2: %v", err)
	}
	if resp2.Status != "already_delivered" {
		t.Errorf("expected second status 'already_delivered', got %q", resp2.Status)
	}
	if resp2.MessageID != resp1.MessageID {
		t.Errorf("expected same message_id (%s), got %s", resp1.MessageID, resp2.MessageID)
	}
	if resp2.MessageSeq != resp1.MessageSeq {
		t.Errorf("expected same message_seq (%d), got %d", resp1.MessageSeq, resp2.MessageSeq)
	}

	// Verify only one row in message_metadata
	var rowCount int
	err := db.QueryRow("SELECT count(*) FROM message_metadata WHERE mailbox_id = $1", recipientMailboxID).Scan(&rowCount)
	if err != nil {
		t.Fatalf("count message_metadata rows: %v", err)
	}
	if rowCount != 1 {
		t.Errorf("expected exactly 1 row in message_metadata, got %d", rowCount)
	}
}

// 9. TestInternalDeliverRateLimited -> 429
func TestInternalDeliverRateLimited(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	mux := setupInternalDeliveryTestMux()
	vec := loadSignedVector(t)
	_, senderMailboxID, senderToken, _, recipientEmail := setupInternalDeliveryTest(t, db, vec)
	setupMockStorageServer(t)

	reqBody, _ := json.Marshal(InternalSendRequest{
		EnvelopeJSON:    vec.EnvelopeJSON,
		Recipient:       recipientEmail,
		SenderMailboxID: senderMailboxID,
	})

	hitRateLimit := false
	for i := 0; i < 62; i++ {
		req := httptest.NewRequest("POST", "/v1/outbound/send-internal", bytes.NewReader(reqBody))
		req.Header.Set("Authorization", "Bearer "+senderToken)
		req.Header.Set("Content-Type", "application/json")
		rr := httptest.NewRecorder()
		mux.ServeHTTP(rr, req)

		if rr.Code == http.StatusTooManyRequests {
			hitRateLimit = true
			if !strings.Contains(rr.Body.String(), "rate_limited") {
				t.Errorf("expected rate_limited in body, got: %s", rr.Body.String())
			}
			break
		}
	}

	if !hitRateLimit {
		t.Fatalf("expected at least one 429 Too Many Requests response after 61 calls")
	}
}

// 10. TestInternalDeliverWrongSenderMailbox -> 403 not_sender_mailbox
func TestInternalDeliverWrongSenderMailbox(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	mux := setupInternalDeliveryTestMux()
	vec := loadSignedVector(t)
	_, _, senderToken, _, recipientEmail := setupInternalDeliveryTest(t, db, vec)

	// Use an arbitrary mailbox UUID that the sender does not own
	arbitraryMailboxID := uuid.New().String()

	reqBody, _ := json.Marshal(InternalSendRequest{
		EnvelopeJSON:    vec.EnvelopeJSON,
		Recipient:       recipientEmail,
		SenderMailboxID: arbitraryMailboxID,
	})

	req := httptest.NewRequest("POST", "/v1/outbound/send-internal", bytes.NewReader(reqBody))
	req.Header.Set("Authorization", "Bearer "+senderToken)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden, got %d: %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "not_sender_mailbox") {
		t.Errorf("expected not_sender_mailbox in body, got: %s", rr.Body.String())
	}
}

// 11. TestMessageBodyRetrievalXWing verifies Part 3 message retrieval for Path A envelopes
func TestMessageBodyRetrievalXWing(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	mux := setupInternalDeliveryTestMux()
	vec := loadSignedVector(t)
	_, senderMailboxID, senderToken, recipientMailboxID, recipientEmail := setupInternalDeliveryTest(t, db, vec)
	setupMockStorageServer(t)

	reqBody, _ := json.Marshal(InternalSendRequest{
		EnvelopeJSON:    vec.EnvelopeJSON,
		Recipient:       recipientEmail,
		SenderMailboxID: senderMailboxID,
	})

	req := httptest.NewRequest("POST", "/v1/outbound/send-internal", bytes.NewReader(reqBody))
	req.Header.Set("Authorization", "Bearer "+senderToken)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("send failed with status %d: %s", rr.Code, rr.Body.String())
	}

	var sendResp InternalSendResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &sendResp); err != nil {
		t.Fatalf("unmarshal send response: %v", err)
	}

	// Connect pgx and call loadEncryptedMessageBody directly
	dsn := testDSN
	ctx := context.Background()
	conn, err := connectTestPGX(ctx, dsn)
	if err != nil {
		t.Fatalf("connect pgx failed: %v", err)
	}
	defer conn.Close(ctx)

	bodyResp, err := loadEncryptedMessageBody(ctx, conn, recipientMailboxID, sendResp.MessageID)
	if err != nil {
		t.Fatalf("loadEncryptedMessageBody failed: %v", err)
	}

	if bodyResp.XWingEnvelopeJSON != vec.EnvelopeJSON {
		t.Errorf("XWingEnvelopeJSON mismatch:\nexpected: %s\ngot: %s", vec.EnvelopeJSON, bodyResp.XWingEnvelopeJSON)
	}
	if bodyResp.EncryptedBody != "" {
		t.Errorf("expected empty EncryptedBody, got %q", bodyResp.EncryptedBody)
	}
	if bodyResp.ContentKeyHPKEWrapped != "" {
		t.Errorf("expected empty ContentKeyHPKEWrapped, got %q", bodyResp.ContentKeyHPKEWrapped)
	}
	if bodyResp.EncryptionIV != "" {
		t.Errorf("expected empty EncryptionIV, got %q", bodyResp.EncryptionIV)
	}
	if bodyResp.MessageSeq != sendResp.MessageSeq {
		t.Errorf("expected MessageSeq %d, got %d", sendResp.MessageSeq, bodyResp.MessageSeq)
	}
	if bodyResp.AADVersion != 1 {
		t.Errorf("expected AADVersion 1, got %d", bodyResp.AADVersion)
	}
	if bodyResp.EncryptionVersion != 1 {
		t.Errorf("expected EncryptionVersion 1, got %d", bodyResp.EncryptionVersion)
	}
}

func connectTestPGX(ctx context.Context, dsn string) (*pgx.Conn, error) {
	return pgx.Connect(ctx, dsn)
}

// TestPathASendSignatureRoundTrip signs a payload on the client-side mock,
// includes attachment envelopes in the payload to prove the signed range is stable,
// verifies on the server, and asserts match (201 Created).
func TestPathASendSignatureRoundTrip(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	mux := setupInternalDeliveryTestMux()
	vec := loadSignedVector(t)
	_, senderMailboxID, senderToken, _, recipientEmail := setupInternalDeliveryTest(t, db, vec)
	_, storage := setupAttachmentMockStorage(t)

	recEnvJSON, senderEnvJSON := createSignedEnvelopes(t, db, senderMailboxID, vec)

	attID := uuid.New().String()
	chunkBytes := []byte("roundtrip_test_attachment_chunk_data")
	recAtt, senderAtt := createTestAttachmentEnvelopes(senderMailboxID, attID, "document.pdf", chunkBytes, storage)

	reqBody, _ := json.Marshal(InternalSendRequest{
		EnvelopeJSON:              recEnvJSON,
		SenderEnvelopeJSON:        senderEnvJSON,
		Recipient:                 recipientEmail,
		SenderMailboxID:           senderMailboxID,
		AttachmentEnvelopes:       []AttachmentEnvelope{recAtt},
		SenderAttachmentEnvelopes: []AttachmentEnvelope{senderAtt},
	})

	req := httptest.NewRequest("POST", "/v1/outbound/send-internal", bytes.NewReader(reqBody))
	req.Header.Set("Authorization", "Bearer "+senderToken)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created, got %d: %s", rr.Code, rr.Body.String())
	}
	var resp InternalSendResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if resp.Status != "delivered" {
		t.Errorf("expected status 'delivered', got %s", resp.Status)
	}

	// Verify recipient message in DB has attachments recorded
	var hasAtt bool
	var attCount int
	err := db.QueryRow("SELECT has_attachments, attachment_count FROM message_metadata WHERE id = $1", resp.MessageID).Scan(&hasAtt, &attCount)
	if err != nil {
		t.Fatalf("query message_metadata: %v", err)
	}
	if !hasAtt || attCount != 1 {
		t.Errorf("expected has_attachments=true, count=1; got %v, %d", hasAtt, attCount)
	}
}

// TestPathASendSignatureMismatchRejected signs one payload, verifies a mutated payload,
// and asserts the server returns 400 invalid_signature.
func TestPathASendSignatureMismatchRejected(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	mux := setupInternalDeliveryTestMux()
	vec := loadSignedVector(t)
	_, senderMailboxID, senderToken, _, recipientEmail := setupInternalDeliveryTest(t, db, vec)
	_, storage := setupAttachmentMockStorage(t)

	recEnvJSON, senderEnvJSON := createSignedEnvelopes(t, db, senderMailboxID, vec)

	// Unmarshal and mutate the ciphertext
	env, err := envelope.UnmarshalCanonical([]byte(recEnvJSON))
	if err != nil {
		t.Fatalf("unmarshal recEnv: %v", err)
	}
	ctBytes, _ := base64.StdEncoding.DecodeString(env.Ciphertext)
	ctBytes[0] ^= 0xAA // tamper ciphertext
	env.Ciphertext = base64.StdEncoding.EncodeToString(ctBytes)
	tamperedRecJSONBytes, err := envelope.MarshalCanonical(env)
	if err != nil {
		t.Fatalf("marshal tampered recEnv: %v", err)
	}

	attID := uuid.New().String()
	chunkBytes := []byte("mismatch_test_chunk")
	recAtt, senderAtt := createTestAttachmentEnvelopes(senderMailboxID, attID, "data.pdf", chunkBytes, storage)

	reqBody, _ := json.Marshal(InternalSendRequest{
		EnvelopeJSON:              string(tamperedRecJSONBytes),
		SenderEnvelopeJSON:        senderEnvJSON,
		Recipient:                 recipientEmail,
		SenderMailboxID:           senderMailboxID,
		AttachmentEnvelopes:       []AttachmentEnvelope{recAtt},
		SenderAttachmentEnvelopes: []AttachmentEnvelope{senderAtt},
	})

	req := httptest.NewRequest("POST", "/v1/outbound/send-internal", bytes.NewReader(reqBody))
	req.Header.Set("Authorization", "Bearer "+senderToken)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request, got %d: %s", rr.Code, rr.Body.String())
	}
	if !strings.Contains(rr.Body.String(), "invalid_signature") {
		t.Errorf("expected 'invalid_signature' in error response, got %s", rr.Body.String())
	}
}

// TestPathAAppliesRules verifies that Path A internal delivery evaluates mail_rules
// and applies matching actions (such as assigning a label).
func TestPathAAppliesRules(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	mux := setupInternalDeliveryTestMux()
	vec := loadSignedVector(t)
	_, senderMailboxID, senderToken, recipientMailboxID, recipientEmail := setupInternalDeliveryTest(t, db, vec)
	setupAttachmentMockStorage(t)

	recEnvJSON, senderEnvJSON := createSignedEnvelopes(t, db, senderMailboxID, vec)

	ctx := context.Background()
	conn, err := pgx.Connect(ctx, testDSN)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer conn.Close(ctx)

	senderEmail, err := recipientAddrFromMailboxID(ctx, conn, senderMailboxID)
	if err != nil {
		t.Fatalf("lookup sender email: %v", err)
	}

	labelID := uuid.New().String()
	_, err = conn.Exec(ctx, `
		INSERT INTO mailbox_labels (id, mailbox_id, name, color, color_name)
		VALUES ($1, $2, 'VIP', '#4D6BFE', 'Cobalt')
	`, labelID, recipientMailboxID)
	if err != nil {
		t.Fatalf("create label: %v", err)
	}

	ruleID := uuid.New().String()
	_, err = conn.Exec(ctx, `
		INSERT INTO mail_rules (id, mailbox_id, name, enabled, priority, match_sender, action_type, action_label_id)
		VALUES ($1, $2, 'Label VIP', true, 0, $3, 'label', $4)
	`, ruleID, recipientMailboxID, senderEmail, labelID)
	if err != nil {
		t.Fatalf("create mail rule: %v", err)
	}
	t.Cleanup(func() {
		_, _ = conn.Exec(context.Background(), "DELETE FROM mail_rules WHERE id = $1", ruleID)
		_, _ = conn.Exec(context.Background(), "DELETE FROM mailbox_labels WHERE id = $1", labelID)
	})

	reqBody, _ := json.Marshal(InternalSendRequest{
		EnvelopeJSON:       recEnvJSON,
		SenderEnvelopeJSON: senderEnvJSON,
		Recipient:          recipientEmail,
		SenderMailboxID:    senderMailboxID,
	})

	req := httptest.NewRequest("POST", "/v1/outbound/send-internal", bytes.NewReader(reqBody))
	req.Header.Set("Authorization", "Bearer "+senderToken)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp InternalSendResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal send response: %v", err)
	}

	var count int
	err = conn.QueryRow(ctx, `
		SELECT count(*) FROM message_labels WHERE message_id = $1 AND label_id = $2
	`, resp.MessageID, labelID).Scan(&count)
	if err != nil {
		t.Fatalf("query message_labels: %v", err)
	}
	if count != 1 {
		t.Errorf("expected 1 row in message_labels for message %s and label %s, got %d", resp.MessageID, labelID, count)
	}
}

// TestPathAWithoutRules verifies that Path A internal delivery succeeds normally
// when the recipient has no mail rules configured.
func TestPathAWithoutRules(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	mux := setupInternalDeliveryTestMux()
	vec := loadSignedVector(t)
	_, senderMailboxID, senderToken, recipientMailboxID, recipientEmail := setupInternalDeliveryTest(t, db, vec)
	setupAttachmentMockStorage(t)

	recEnvJSON, senderEnvJSON := createSignedEnvelopes(t, db, senderMailboxID, vec)

	ctx := context.Background()
	conn, err := pgx.Connect(ctx, testDSN)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer conn.Close(ctx)

	// Ensure recipient has no mail rules
	_, _ = conn.Exec(ctx, "DELETE FROM mail_rules WHERE mailbox_id = $1", recipientMailboxID)

	reqBody, _ := json.Marshal(InternalSendRequest{
		EnvelopeJSON:       recEnvJSON,
		SenderEnvelopeJSON: senderEnvJSON,
		Recipient:          recipientEmail,
		SenderMailboxID:    senderMailboxID,
	})

	req := httptest.NewRequest("POST", "/v1/outbound/send-internal", bytes.NewReader(reqBody))
	req.Header.Set("Authorization", "Bearer "+senderToken)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp InternalSendResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal send response: %v", err)
	}

	var folder string
	err = conn.QueryRow(ctx, `SELECT folder FROM message_metadata WHERE id = $1`, resp.MessageID).Scan(&folder)
	if err != nil {
		t.Fatalf("query message folder: %v", err)
	}
	if folder != "inbox" {
		t.Errorf("expected folder=inbox, got %q", folder)
	}
}

