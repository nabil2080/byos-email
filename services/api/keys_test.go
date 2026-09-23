package main

import (
	"bytes"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
)

func createTestKeypairBytes() ([]byte, []byte, string, string) {
	xwing := make([]byte, 1216)
	for i := range xwing {
		xwing[i] = byte(i % 251)
	}
	ed25519 := make([]byte, 32)
	for i := range ed25519 {
		ed25519[i] = byte((i * 7) % 251)
	}
	return xwing, ed25519, base64.StdEncoding.EncodeToString(xwing), base64.StdEncoding.EncodeToString(ed25519)
}

func setupKeyDirectoryTestMux() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/keys/{email}", withSecurityHeaders(withCORS(keyLookupHandler)))
	mux.HandleFunc("GET /v1/keys/{email}/history", withSecurityHeaders(withCORS(keyHistoryHandler)))
	mux.HandleFunc("PUT /v1/keys/me", withSecurityHeaders(withCORS(keyPublishHandler)))
	return mux
}

// createTestDirectoryMailbox creates a full user, domain, root_secret, and mailbox for testing.
func createTestDirectoryMailbox(t *testing.T, db *sql.DB, tag, localPart, domainName, status string, xwingPK, ed25519PK []byte, keyEpoch, signingEpoch int) (userID, mailboxID, token string) {
	t.Helper()
	unique := tag + "-" + uuid.New().String()[:8]

	var orgID string
	err := db.QueryRow(`
		INSERT INTO organizations (name, org_recovery_pk)
		VALUES ($1, decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'))
		RETURNING id
	`, "Org "+unique).Scan(&orgID)
	if err != nil {
		t.Fatalf("insert org failed: %v", err)
	}

	err = db.QueryRow(`
		INSERT INTO users (org_id, email, display_name, password_hash, is_active, role)
		VALUES ($1, $2, 'Test User', '$2a$10$dummyhashdummyhashdummyhashdummyhashdummyhas', true, 'owner')
		RETURNING id
	`, orgID, "user-"+unique+"@byos.local").Scan(&userID)
	if err != nil {
		t.Fatalf("insert user failed: %v", err)
	}

	token = createTestSession(t, db, userID)

	var domainID string
	err = db.QueryRow(`
		INSERT INTO domains (org_id, name, is_verified)
		VALUES ($1, $2, true)
		ON CONFLICT (name) DO UPDATE SET is_verified = true
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

	err = db.QueryRow(`
		INSERT INTO mailboxes (
			org_id, user_id, domain_id, local_part, mode,
			root_secret_id, mailbox_sk_wrapped, mailbox_pk,
			mailbox_xwing_pk, mailbox_ed25519_pk,
			key_epoch, signing_key_epoch, key_status, is_active
		) VALUES (
			$1, $2, $3, $4, 'org_managed',
			$5, decode('AA==', 'base64'), decode('AA==', 'base64'),
			$6, $7,
			$8, $9, $10, true
		) RETURNING id
	`, orgID, userID, domainID, localPart, rootSecretID, xwingPK, ed25519PK, keyEpoch, signingEpoch, status).Scan(&mailboxID)
	if err != nil {
		t.Fatalf("insert mailbox failed: %v", err)
	}

	return userID, mailboxID, token
}

// 1. GET /v1/keys/:email returns 200 with correct shape when key exists
func TestKeyLookupSuccess(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	mux := setupKeyDirectoryTestMux()

	xwing, ed25519, xwingB64, ed25519B64 := createTestKeypairBytes()
	tag := "lookup-ok"
	localPart := "alice-" + uuid.New().String()[:6]
	domain := "domain-" + uuid.New().String()[:6] + ".local"
	email := localPart + "@" + domain

	_, mailboxID, token := createTestDirectoryMailbox(t, db, tag, localPart, domain, "active", xwing, ed25519, 1, 1)

	req := httptest.NewRequest("GET", "/v1/keys/"+email, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp struct {
		EmailAddress            string `json:"email_address"`
		KeyID                   string `json:"key_id"`
		KeyEpoch                int    `json:"key_epoch"`
		XWingPublicKey          string `json:"xwing_public_key"`
		Ed25519SigningPublicKey string `json:"ed25519_signing_public_key"`
		SigningKeyEpoch         int    `json:"signing_key_epoch"`
		Status                  string `json:"status"`
		UpdatedAt               string `json:"updated_at"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response JSON: %v", err)
	}

	if resp.EmailAddress != strings.ToLower(email) {
		t.Errorf("expected email %q, got %q", email, resp.EmailAddress)
	}
	if resp.KeyID != mailboxID {
		t.Errorf("expected key_id %q, got %q", mailboxID, resp.KeyID)
	}
	if resp.KeyEpoch != 1 {
		t.Errorf("expected key_epoch 1, got %d", resp.KeyEpoch)
	}
	if resp.SigningKeyEpoch != 1 {
		t.Errorf("expected signing_key_epoch 1, got %d", resp.SigningKeyEpoch)
	}
	if resp.XWingPublicKey != xwingB64 {
		t.Errorf("xwing_public_key mismatch")
	}
	if resp.Ed25519SigningPublicKey != ed25519B64 {
		t.Errorf("ed25519_signing_public_key mismatch")
	}
	if resp.Status != "active" {
		t.Errorf("expected status 'active', got %q", resp.Status)
	}
	if resp.UpdatedAt == "" {
		t.Errorf("expected non-empty updated_at")
	}

	expectedETag := fmt.Sprintf(`"%s:1:1"`, mailboxID)
	if rr.Header().Get("ETag") != expectedETag {
		t.Errorf("expected ETag %q, got %q", expectedETag, rr.Header().Get("ETag"))
	}
	if rr.Header().Get("Cache-Control") != "private, max-age=300" {
		t.Errorf("expected Cache-Control 'private, max-age=300', got %q", rr.Header().Get("Cache-Control"))
	}
}

// 2. Unknown email returns 404 with {"error":"unknown_mailbox"}
func TestKeyLookupUnknownEmail(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	mux := setupKeyDirectoryTestMux()

	tag := "unknown"
	_, _, token := createTestDirectoryMailbox(t, db, tag, "user-"+uuid.New().String()[:6], "byos.local", "active", nil, nil, 1, 1)

	req := httptest.NewRequest("GET", "/v1/keys/nonexistent-"+uuid.New().String()[:8]+"@byos.local", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("expected 404 Not Found, got %d", rr.Code)
	}

	var errResp keyErrorResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &errResp); err != nil {
		t.Fatalf("failed to decode JSON error: %v", err)
	}
	if errResp.Error != "unknown_mailbox" {
		t.Errorf("expected error 'unknown_mailbox', got %q", errResp.Error)
	}
}

// 3. Disabled mailbox returns 410
func TestKeyLookupDisabledMailbox(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	mux := setupKeyDirectoryTestMux()

	xwing, ed25519, _, _ := createTestKeypairBytes()
	tag := "disabled"
	localPart := "disabled-" + uuid.New().String()[:6]
	domain := "domain-" + uuid.New().String()[:6] + ".local"
	email := localPart + "@" + domain

	_, _, token := createTestDirectoryMailbox(t, db, tag, localPart, domain, "disabled", xwing, ed25519, 1, 1)

	req := httptest.NewRequest("GET", "/v1/keys/"+email, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusGone {
		t.Fatalf("expected 410 Gone, got %d: %s", rr.Code, rr.Body.String())
	}

	var errResp keyErrorResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &errResp); err != nil {
		t.Fatalf("failed to decode JSON error: %v", err)
	}
	if errResp.Error != "mailbox_disabled" {
		t.Errorf("expected error 'mailbox_disabled', got %q", errResp.Error)
	}
}

// 4. Unlisted mailbox returns 404 (same as unknown)
func TestKeyLookupUnlistedMailbox(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	mux := setupKeyDirectoryTestMux()

	xwing, ed25519, _, _ := createTestKeypairBytes()
	tag := "unlisted"
	localPart := "unlisted-" + uuid.New().String()[:6]
	domain := "domain-" + uuid.New().String()[:6] + ".local"
	email := localPart + "@" + domain

	_, _, token := createTestDirectoryMailbox(t, db, tag, localPart, domain, "unlisted", xwing, ed25519, 1, 1)

	req := httptest.NewRequest("GET", "/v1/keys/"+email, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("expected 404 Not Found, got %d: %s", rr.Code, rr.Body.String())
	}

	var errResp keyErrorResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &errResp); err != nil {
		t.Fatalf("failed to decode JSON error: %v", err)
	}
	if errResp.Error != "unknown_mailbox" {
		t.Errorf("expected error 'unknown_mailbox', got %q", errResp.Error)
	}
}

// 5. Missing X-Wing key returns 404 with {"error":"no_public_key"}
func TestKeyLookupMissingXWingKey(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	mux := setupKeyDirectoryTestMux()

	_, ed25519, _, _ := createTestKeypairBytes()
	tag := "noxwing"
	localPart := "noxwing-" + uuid.New().String()[:6]
	domain := "domain-" + uuid.New().String()[:6] + ".local"
	email := localPart + "@" + domain

	_, _, token := createTestDirectoryMailbox(t, db, tag, localPart, domain, "active", nil, ed25519, 1, 1)

	req := httptest.NewRequest("GET", "/v1/keys/"+email, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("expected 404 Not Found, got %d: %s", rr.Code, rr.Body.String())
	}

	var errResp keyErrorResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &errResp); err != nil {
		t.Fatalf("failed to decode JSON error: %v", err)
	}
	if errResp.Error != "no_public_key" {
		t.Errorf("expected error 'no_public_key', got %q", errResp.Error)
	}
}

// 6. Missing Ed25519 key returns 404 with {"error":"no_signing_key"}
func TestKeyLookupMissingEd25519Key(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	mux := setupKeyDirectoryTestMux()

	xwing, _, _, _ := createTestKeypairBytes()
	tag := "noed"
	localPart := "noed-" + uuid.New().String()[:6]
	domain := "domain-" + uuid.New().String()[:6] + ".local"
	email := localPart + "@" + domain

	_, _, token := createTestDirectoryMailbox(t, db, tag, localPart, domain, "active", xwing, nil, 1, 1)

	req := httptest.NewRequest("GET", "/v1/keys/"+email, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("expected 404 Not Found, got %d: %s", rr.Code, rr.Body.String())
	}

	var errResp keyErrorResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &errResp); err != nil {
		t.Fatalf("failed to decode JSON error: %v", err)
	}
	if errResp.Error != "no_signing_key" {
		t.Errorf("expected error 'no_signing_key', got %q", errResp.Error)
	}
}

// 7. Case insensitivity — Test@BYOS.local matches test@byos.local
func TestKeyLookupCaseInsensitivity(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	mux := setupKeyDirectoryTestMux()

	xwing, ed25519, _, _ := createTestKeypairBytes()
	tag := "case"
	localPart := "caser-" + uuid.New().String()[:6]
	domain := "domain-" + uuid.New().String()[:6] + ".local"

	_, _, token := createTestDirectoryMailbox(t, db, tag, strings.ToLower(localPart), strings.ToLower(domain), "active", xwing, ed25519, 1, 1)

	mixedCaseEmail := strings.ToUpper(localPart[:2]) + localPart[2:] + "@" + strings.ToUpper(domain)
	req := httptest.NewRequest("GET", "/v1/keys/"+mixedCaseEmail, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for mixed-case email, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp struct {
		EmailAddress string `json:"email_address"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode JSON: %v", err)
	}
	expected := strings.ToLower(mixedCaseEmail)
	if resp.EmailAddress != expected {
		t.Errorf("expected normalized email %q, got %q", expected, resp.EmailAddress)
	}
}

// 8. Unauthenticated request returns 401
func TestKeyLookupUnauthenticated(t *testing.T) {
	mux := setupKeyDirectoryTestMux()

	req := httptest.NewRequest("GET", "/v1/keys/someone@byos.local", nil)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized, got %d", rr.Code)
	}

	var errResp keyErrorResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &errResp); err != nil {
		t.Fatalf("failed to decode JSON error: %v", err)
	}
	if errResp.Error != "unauthorized" {
		t.Errorf("expected error 'unauthorized', got %q", errResp.Error)
	}
}

// 9. Rate limit exceeded returns 429
func TestKeyLookupRateLimitExceeded(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	mux := setupKeyDirectoryTestMux()

	tag := "ratelimit"
	userID, _, token := createTestDirectoryMailbox(t, db, tag, "rate-"+uuid.New().String()[:6], "byos.local", "active", nil, nil, 1, 1)

	rateMu.Lock()
	rateBuckets[userID] = &rateBucket{
		count:       60,
		windowStart: time.Now(),
	}
	rateMu.Unlock()
	defer func() {
		rateMu.Lock()
		delete(rateBuckets, userID)
		rateMu.Unlock()
	}()

	req := httptest.NewRequest("GET", "/v1/keys/any@byos.local", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429 Too Many Requests, got %d: %s", rr.Code, rr.Body.String())
	}
	if rr.Header().Get("Retry-After") != "60" {
		t.Errorf("expected Retry-After 60, got %q", rr.Header().Get("Retry-After"))
	}

	var errResp keyErrorResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &errResp); err != nil {
		t.Fatalf("failed to decode JSON error: %v", err)
	}
	if errResp.Error != "rate_limited" {
		t.Errorf("expected error 'rate_limited', got %q", errResp.Error)
	}
}

// 10. ETag match returns 304
func TestKeyLookupETagMatch(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	mux := setupKeyDirectoryTestMux()

	xwing, ed25519, _, _ := createTestKeypairBytes()
	tag := "etag"
	localPart := "etag-" + uuid.New().String()[:6]
	domain := "domain-" + uuid.New().String()[:6] + ".local"
	email := localPart + "@" + domain

	_, mailboxID, token := createTestDirectoryMailbox(t, db, tag, localPart, domain, "active", xwing, ed25519, 1, 1)

	req1 := httptest.NewRequest("GET", "/v1/keys/"+email, nil)
	req1.Header.Set("Authorization", "Bearer "+token)
	rr1 := httptest.NewRecorder()
	mux.ServeHTTP(rr1, req1)

	if rr1.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d", rr1.Code)
	}
	etag := rr1.Header().Get("ETag")
	expectedETag := fmt.Sprintf(`"%s:1:1"`, mailboxID)
	if etag != expectedETag {
		t.Fatalf("expected ETag %q, got %q", expectedETag, etag)
	}

	// Request with If-None-Match matching etag
	req2 := httptest.NewRequest("GET", "/v1/keys/"+email, nil)
	req2.Header.Set("Authorization", "Bearer "+token)
	req2.Header.Set("If-None-Match", etag)
	rr2 := httptest.NewRecorder()
	mux.ServeHTTP(rr2, req2)

	if rr2.Code != http.StatusNotModified {
		t.Fatalf("expected 304 Not Modified, got %d", rr2.Code)
	}
	if rr2.Body.Len() > 0 {
		t.Errorf("expected empty body on 304, got %q", rr2.Body.String())
	}
}

// 11. PUT /v1/keys/me with valid body updates the mailbox
func TestKeyPublishValidBody(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	mux := setupKeyDirectoryTestMux()

	tag := "publish-ok"
	_, mailboxID, token := createTestDirectoryMailbox(t, db, tag, "pub-"+uuid.New().String()[:6], "byos.local", "active", nil, nil, 1, 1)

	_, _, xwingB64, ed25519B64 := createTestKeypairBytes()
	bodyJSON, _ := json.Marshal(map[string]string{
		"xwing_public_key":           xwingB64,
		"ed25519_signing_public_key": ed25519B64,
	})

	// First publish: epochs set to 1
	req := httptest.NewRequest("PUT", "/v1/keys/me", bytes.NewReader(bodyJSON))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on first publish, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp struct {
		Status          string `json:"status"`
		KeyEpoch        int    `json:"key_epoch"`
		SigningKeyEpoch int    `json:"signing_key_epoch"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response JSON: %v", err)
	}
	if resp.Status != "ok" || resp.KeyEpoch != 1 || resp.SigningKeyEpoch != 1 {
		t.Errorf("unexpected first publish response: %+v", resp)
	}

	// Verify in DB
	var dbXWing, dbEd25519 []byte
	var dbEpoch, dbSigningEpoch int
	err := db.QueryRow(`
		SELECT mailbox_xwing_pk, mailbox_ed25519_pk, key_epoch, signing_key_epoch
		FROM mailboxes WHERE id = $1
	`, mailboxID).Scan(&dbXWing, &dbEd25519, &dbEpoch, &dbSigningEpoch)
	if err != nil {
		t.Fatalf("failed to query updated mailbox: %v", err)
	}
	if len(dbXWing) != 1216 || len(dbEd25519) != 32 {
		t.Errorf("stored key lengths mismatch: xwing=%d, ed=%d", len(dbXWing), len(dbEd25519))
	}
	if dbEpoch != 1 || dbSigningEpoch != 1 {
		t.Errorf("expected DB epochs 1, 1; got %d, %d", dbEpoch, dbSigningEpoch)
	}

	// Second publish (key rotation): epochs increment to 2
	req2 := httptest.NewRequest("PUT", "/v1/keys/me", bytes.NewReader(bodyJSON))
	req2.Header.Set("Authorization", "Bearer "+token)
	req2.Header.Set("Content-Type", "application/json")
	rr2 := httptest.NewRecorder()
	mux.ServeHTTP(rr2, req2)

	if rr2.Code != http.StatusOK {
		t.Fatalf("expected 200 OK on second publish, got %d: %s", rr2.Code, rr2.Body.String())
	}
	if err := json.Unmarshal(rr2.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response JSON: %v", err)
	}
	if resp.KeyEpoch != 2 || resp.SigningKeyEpoch != 2 {
		t.Errorf("expected rotated epochs 2, 2; got %d, %d", resp.KeyEpoch, resp.SigningKeyEpoch)
	}
}

// 12. PUT /v1/keys/me with wrong-size X-Wing key returns 400
func TestKeyPublishWrongSizeXWingKey(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	mux := setupKeyDirectoryTestMux()

	tag := "bad-xwing"
	_, _, token := createTestDirectoryMailbox(t, db, tag, "badx-"+uuid.New().String()[:6], "byos.local", "active", nil, nil, 1, 1)

	_, _, _, ed25519B64 := createTestKeypairBytes()
	badXWingB64 := base64.StdEncoding.EncodeToString(make([]byte, 500)) // 500 bytes instead of 1216

	bodyJSON, _ := json.Marshal(map[string]string{
		"xwing_public_key":           badXWingB64,
		"ed25519_signing_public_key": ed25519B64,
	})

	req := httptest.NewRequest("PUT", "/v1/keys/me", bytes.NewReader(bodyJSON))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request, got %d: %s", rr.Code, rr.Body.String())
	}

	var errResp keyErrorResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &errResp); err != nil {
		t.Fatalf("failed to decode JSON error: %v", err)
	}
	if errResp.Error != "invalid_key" {
		t.Errorf("expected error 'invalid_key', got %q", errResp.Error)
	}
}

// 13. PUT /v1/keys/me with wrong-size Ed25519 key returns 400
func TestKeyPublishWrongSizeEd25519Key(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	mux := setupKeyDirectoryTestMux()

	tag := "bad-ed"
	_, _, token := createTestDirectoryMailbox(t, db, tag, "baded-"+uuid.New().String()[:6], "byos.local", "active", nil, nil, 1, 1)

	_, _, xwingB64, _ := createTestKeypairBytes()
	badEdB64 := base64.StdEncoding.EncodeToString(make([]byte, 64)) // 64 bytes instead of 32

	bodyJSON, _ := json.Marshal(map[string]string{
		"xwing_public_key":           xwingB64,
		"ed25519_signing_public_key": badEdB64,
	})

	req := httptest.NewRequest("PUT", "/v1/keys/me", bytes.NewReader(bodyJSON))
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request, got %d: %s", rr.Code, rr.Body.String())
	}

	var errResp keyErrorResponse
	if err := json.Unmarshal(rr.Body.Bytes(), &errResp); err != nil {
		t.Fatalf("failed to decode JSON error: %v", err)
	}
	if errResp.Error != "invalid_key" {
		t.Errorf("expected error 'invalid_key', got %q", errResp.Error)
	}
}

// Additional test: GET /v1/keys/:email/history returns 200 with history array
func TestKeyHistorySuccess(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	mux := setupKeyDirectoryTestMux()

	xwing, ed25519, xwingB64, ed25519B64 := createTestKeypairBytes()
	tag := "history-ok"
	localPart := "hist-" + uuid.New().String()[:6]
	domain := "domain-" + uuid.New().String()[:6] + ".local"
	email := localPart + "@" + domain

	_, mailboxID, token := createTestDirectoryMailbox(t, db, tag, localPart, domain, "active", xwing, ed25519, 1, 1)

	req := httptest.NewRequest("GET", "/v1/keys/"+email+"/history", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	mux.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", rr.Code, rr.Body.String())
	}

	var resp struct {
		KeyID   string `json:"key_id"`
		History []struct {
			KeyEpoch                int     `json:"key_epoch"`
			XWingPublicKey          string  `json:"xwing_public_key"`
			Ed25519SigningPublicKey string  `json:"ed25519_signing_public_key"`
			SigningKeyEpoch         int     `json:"signing_key_epoch"`
			ValidFrom               string  `json:"valid_from"`
			RotatedAt               *string `json:"rotated_at"`
		} `json:"history"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response JSON: %v", err)
	}

	if resp.KeyID != mailboxID {
		t.Errorf("expected key_id %q, got %q", mailboxID, resp.KeyID)
	}
	if len(resp.History) != 1 {
		t.Fatalf("expected 1 history record, got %d", len(resp.History))
	}
	if resp.History[0].KeyEpoch != 1 || resp.History[0].SigningKeyEpoch != 1 {
		t.Errorf("expected epochs 1, 1; got %d, %d", resp.History[0].KeyEpoch, resp.History[0].SigningKeyEpoch)
	}
	if resp.History[0].XWingPublicKey != xwingB64 {
		t.Errorf("xwing_public_key mismatch")
	}
	if resp.History[0].Ed25519SigningPublicKey != ed25519B64 {
		t.Errorf("ed25519_signing_public_key mismatch")
	}
	if resp.History[0].RotatedAt != nil {
		t.Errorf("expected rotated_at to be nil in V1")
	}
}
