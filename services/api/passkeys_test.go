package main

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	_ "github.com/jackc/pgx/v5/stdlib"
)

func TestGetRPID(t *testing.T) {
	tests := []struct {
		name     string
		host     string
		origin   string
		expected string
	}{
		{
			name:     "Localhost port 3000 via Host",
			host:     "localhost:3000",
			origin:   "",
			expected: "localhost",
		},
		{
			name:     "127.0.0.1 fallback to localhost RP ID",
			host:     "127.0.0.1:3001",
			origin:   "",
			expected: "localhost",
		},
		{
			name:     "Origin header overrides backend Host port",
			host:     "127.0.0.1:8080",
			origin:   "http://localhost:3001",
			expected: "localhost",
		},
		{
			name:     "Production domain without port",
			host:     "mail.byos.email",
			origin:   "",
			expected: "localhost", // In dev config, returns dev RP ID
		},
		{
			name:     "Empty fallback to localhost",
			host:     "",
			origin:   "",
			expected: "localhost",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "/v1/auth/passkeys/register-options", nil)
			r.Host = tt.host
			if tt.origin != "" {
				r.Header.Set("Origin", tt.origin)
			}
			actual := getRPID(r)
			if actual != tt.expected {
				t.Errorf("getRPID() = %q, want %q", actual, tt.expected)
			}
		})
	}
}

func TestGenerateRandomBase64URL(t *testing.T) {
	b64, err := generateRandomBase64URL(32)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(b64) == 0 {
		t.Fatalf("expected non-empty base64url string")
	}
	decoded, err := base64.RawURLEncoding.DecodeString(b64)
	if err != nil {
		t.Fatalf("failed to decode generated base64url string: %v", err)
	}
	if len(decoded) != 32 {
		t.Fatalf("expected 32 decoded bytes, got %d", len(decoded))
	}
}

func TestWebAuthnConfiguration(t *testing.T) {
	// 1. Development configuration constraints
	t.Setenv("BYOS_ENV", "development")
	t.Setenv("WEBAUTHN_RP_ID", "127.0.0.1") // IP address must be rejected/coerced to localhost
	cfg, err := getWebAuthnConfig()
	if err != nil {
		t.Fatalf("unexpected error in dev config: %v", err)
	}
	if cfg.RPID != "localhost" {
		t.Errorf("expected dev RPID to be 'localhost', got %q", cfg.RPID)
	}
	if cfg.AuthenticatorSelection.UserVerification != protocol.VerificationRequired {
		t.Errorf("expected UserVerification to be Required, got %v", cfg.AuthenticatorSelection.UserVerification)
	}
	hasPort3000 := false
	hasPort3001 := false
	for _, o := range cfg.RPOrigins {
		if o == "http://localhost:3000" {
			hasPort3000 = true
		}
		if o == "http://localhost:3001" {
			hasPort3001 = true
		}
	}
	if !hasPort3000 || !hasPort3001 {
		t.Errorf("dev config must include origins for port 3000 and 3001, got %v", cfg.RPOrigins)
	}

	// 2. Production configuration constraints
	t.Setenv("BYOS_ENV", "production")
	t.Setenv("WEBAUTHN_RP_ID", "localhost")
	_, err = getWebAuthnConfig()
	if err == nil || !strings.Contains(err.Error(), "insecure RP ID disallowed in production") {
		t.Errorf("expected error rejecting localhost RP ID in production, got: %v", err)
	}

	t.Setenv("WEBAUTHN_RP_ID", "byos.email")
	t.Setenv("WEBAUTHN_ORIGINS", "http://insecure.byos.email")
	_, err = getWebAuthnConfig()
	if err == nil || !strings.Contains(err.Error(), "must use HTTPS") {
		t.Errorf("expected error rejecting non-HTTPS origin in production, got: %v", err)
	}

	t.Setenv("WEBAUTHN_ORIGINS", "https://*.byos.email")
	_, err = getWebAuthnConfig()
	if err == nil || !strings.Contains(err.Error(), "wildcard origins not permitted") {
		t.Errorf("expected error rejecting wildcard origin in production, got: %v", err)
	}
}

func TestPasskeyLoginUnauthenticatedFailures(t *testing.T) {
	t.Setenv("BYOS_ENV", "development")

	// 1. Missing request body -> 400 Bad Request
	req := httptest.NewRequest(http.MethodPost, "/v1/auth/passkeys/login", nil)
	rec := httptest.NewRecorder()
	passkeyLoginHandler(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400 Bad Request on empty login body, got %d: %s", rec.Code, rec.Body.String())
	}
	for _, c := range rec.Result().Cookies() {
		if strings.Contains(c.Name, "session") && c.Value != "" {
			t.Fatalf("session cookie set on empty login body: %s", c.Name)
		}
	}

	// 2. Unparseable assertion payload -> 400 Bad Request
	badJSON := bytes.NewReader([]byte(`{"credential_id":"nonexistent","signature":"invalid"}`))
	req = httptest.NewRequest(http.MethodPost, "/v1/auth/passkeys/login", badJSON)
	rec = httptest.NewRecorder()
	passkeyLoginHandler(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("expected 400 Bad Request on malformed WebAuthn payload, got %d: %s", rec.Code, rec.Body.String())
	}
	for _, c := range rec.Result().Cookies() {
		if strings.Contains(c.Name, "session") && c.Value != "" {
			t.Fatalf("session cookie set on malformed WebAuthn payload: %s", c.Name)
		}
	}
}

func TestPasskeyEndpointsRequireAuth(t *testing.T) {
	// Unauthenticated calls must return 401 Unauthorized
	unauthReqs := []*http.Request{
		httptest.NewRequest(http.MethodGet, "/v1/auth/passkeys/register-options", nil),
		httptest.NewRequest(http.MethodPost, "/v1/auth/passkeys/register", nil),
		httptest.NewRequest(http.MethodGet, "/v1/auth/passkeys", nil),
		httptest.NewRequest(http.MethodGet, "/v1/auth/passkeys/step-up-options", nil),
		httptest.NewRequest(http.MethodPost, "/v1/auth/passkeys/step-up-verify", nil),
	}

	handlers := []http.HandlerFunc{
		passkeyRegisterOptionsHandler,
		passkeyRegisterHandler,
		passkeysListHandler,
		passkeyStepUpOptionsHandler,
		passkeyStepUpVerifyHandler,
	}

	for i, r := range unauthReqs {
		rec := httptest.NewRecorder()
		handlers[i](rec, r)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("endpoint %s: expected 401 Unauthorized without session, got %d", r.URL.Path, rec.Code)
		}
	}
}

func TestPasskeyCloneWarningDetection(t *testing.T) {
	// Case 1: Stored counter = 0, new counter = 0 (WebAuthn zero-counter exception).
	// Authenticators that do not implement signature counters (e.g. some platform authenticators)
	// always report counter = 0. This must NOT flag a CloneWarning.
	authZeroZero := &webauthn.Authenticator{SignCount: 0}
	authZeroZero.UpdateCounter(0)
	if authZeroZero.CloneWarning {
		t.Errorf("Case 1 FAILED: unexpected CloneWarning on 0 -> 0 zero-counter exception")
	}
	if authZeroZero.SignCount != 0 {
		t.Errorf("Case 1 FAILED: expected SignCount = 0, got %d", authZeroZero.SignCount)
	}

	// Case 2: Stored counter = 0, new counter = positive -> updates counter, no clone warning.
	authZeroPos := &webauthn.Authenticator{SignCount: 0}
	authZeroPos.UpdateCounter(5)
	if authZeroPos.CloneWarning {
		t.Errorf("Case 2 FAILED: unexpected CloneWarning on 0 -> 5")
	}
	if authZeroPos.SignCount != 5 {
		t.Errorf("Case 2 FAILED: expected SignCount = 5, got %d", authZeroPos.SignCount)
	}

	// Case 3: Stored counter = positive, new counter is greater -> updates counter, no clone warning.
	authPosGreater := &webauthn.Authenticator{SignCount: 5}
	authPosGreater.UpdateCounter(10)
	if authPosGreater.CloneWarning {
		t.Errorf("Case 3 FAILED: unexpected CloneWarning on 5 -> 10")
	}
	if authPosGreater.SignCount != 10 {
		t.Errorf("Case 3 FAILED: expected SignCount = 10, got %d", authPosGreater.SignCount)
	}

	// Case 4a: Stored counter = positive, new counter is equal (stagnant) -> CloneWarning flagged.
	authStagnant := &webauthn.Authenticator{SignCount: 10}
	authStagnant.UpdateCounter(10)
	if !authStagnant.CloneWarning {
		t.Errorf("Case 4a FAILED: expected CloneWarning on stagnant counter (10 -> 10), but got false")
	}

	// Case 4b: Stored counter = positive, new counter is lower (rollback) -> CloneWarning flagged.
	authRollback := &webauthn.Authenticator{SignCount: 20}
	authRollback.UpdateCounter(15)
	if !authRollback.CloneWarning {
		t.Errorf("Case 4b FAILED: expected CloneWarning on decreased counter (20 -> 15), but got false")
	}
}

func TestCredentialPersistenceDatabaseRoundTrip(t *testing.T) {
	dsn := getValidatedTestDSN(t)
	t.Setenv("BYOS_ENV", "development")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatalf("failed to connect to test database: %v", err)
	}
	defer conn.Close(ctx)

	orgID := uuid.New().String()
	userID := uuid.New().String()
	userEmail := "passkey.persist." + uuid.New().String()[:8] + "@byos.local"

	_, err = conn.Exec(ctx, `
		INSERT INTO organizations (id, name, created_at, updated_at)
		VALUES ($1, 'Passkey Persistence Org', NOW(), NOW())
		ON CONFLICT (id) DO NOTHING
	`, orgID)
	if err != nil {
		t.Fatalf("failed to insert org: %v", err)
	}

	pwdHash, _ := hashPassword("SecretPass123!")
	_, err = conn.Exec(ctx, `
		INSERT INTO users (id, org_id, email, password_hash, role, is_active, two_factor_enabled, created_at, updated_at)
		VALUES ($1, $2, $3, $4, 'member', true, true, NOW(), NOW())
	`, userID, orgID, userEmail, pwdHash)
	if err != nil {
		t.Fatalf("failed to insert user: %v", err)
	}

	defer func() {
		_, _ = conn.Exec(context.Background(), `DELETE FROM users WHERE id=$1`, userID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM organizations WHERE id=$1`, orgID)
	}()

	// 1. Construct a valid library Credential with realistic fields
	credIDBytes := []byte("test-credential-id-1234567890abcdef")
	credIDStr := base64.RawURLEncoding.EncodeToString(credIDBytes)
	dummyPubKey := []byte("dummy-cose-public-key-bytes-for-p256")
	dummyAAGUID := []byte{0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10}

	initialCred := webauthn.Credential{
		ID:        credIDBytes,
		PublicKey: dummyPubKey,
		AttestationType: "none",
		Transport: []protocol.AuthenticatorTransport{protocol.Internal},
		Flags: webauthn.CredentialFlags{
			UserPresent:    true,
			UserVerified:   true,
			BackupEligible: true,
			BackupState:    false,
		},
		Authenticator: webauthn.Authenticator{
			AAGUID:    dummyAAGUID,
			SignCount: 42,
		},
	}

	// 2. Persist to PostgreSQL user_passkeys table
	credJSON, err := json.Marshal(initialCred)
	if err != nil {
		t.Fatalf("failed to marshal credential: %v", err)
	}

	aaguidHex := hex.EncodeToString(dummyAAGUID)
	_, err = conn.Exec(ctx, `
		INSERT INTO user_passkeys (user_id, credential_id, public_key, counter, device_name, aaguid)
		VALUES ($1, $2, $3, $4, 'MacBook Touch ID', $5)
	`, userID, credIDStr, string(credJSON), 42, aaguidHex)
	if err != nil {
		t.Fatalf("failed to persist credential to user_passkeys: %v", err)
	}

	// 3. Load user and credentials back from PostgreSQL via loadWebAuthnUser
	reloadedUser, err := loadWebAuthnUser(ctx, conn, userID)
	if err != nil {
		t.Fatalf("loadWebAuthnUser failed: %v", err)
	}

	// 4. Assert library credential object reconstruction
	if len(reloadedUser.Credentials) != 1 {
		t.Fatalf("expected exactly 1 credential, got %d", len(reloadedUser.Credentials))
	}

	reconstructed := reloadedUser.Credentials[0]

	// Check ID
	if !bytes.Equal(reconstructed.ID, credIDBytes) {
		t.Errorf("credential ID mismatch: got %x, want %x", reconstructed.ID, credIDBytes)
	}

	// Check Public Key
	if !bytes.Equal(reconstructed.PublicKey, dummyPubKey) {
		t.Errorf("public key mismatch: got %x, want %x", reconstructed.PublicKey, dummyPubKey)
	}

	// Check SignCount
	if reconstructed.Authenticator.SignCount != 42 {
		t.Errorf("sign count mismatch: got %d, want 42", reconstructed.Authenticator.SignCount)
	}

	// Check AAGUID
	if !bytes.Equal(reconstructed.Authenticator.AAGUID, dummyAAGUID) {
		t.Errorf("AAGUID mismatch: got %x, want %x", reconstructed.Authenticator.AAGUID, dummyAAGUID)
	}

	// Check User handle
	userUUID, err := uuid.FromBytes(reloadedUser.WebAuthnID())
	if err != nil || userUUID.String() != userID {
		t.Errorf("user handle mismatch: got %v, want %s", userUUID, userID)
	}
}

func TestPasskeyIntegrationWithDisposableDB(t *testing.T) {
	dsn := getValidatedTestDSN(t)
	t.Setenv("BYOS_ENV", "development")

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatalf("failed to connect to test database: %v", err)
	}
	defer db.Close()

	// Create test user in disposable database
	orgID := uuid.New().String()
	userID := uuid.New().String()
	userEmail := "passkey.test." + uuid.New().String()[:8] + "@byos.local"

	_, err = db.ExecContext(ctx, `
		INSERT INTO organizations (id, name, created_at, updated_at)
		VALUES ($1, 'Passkey Test Org', NOW(), NOW())
		ON CONFLICT (id) DO NOTHING
	`, orgID)
	if err != nil {
		t.Fatalf("failed to insert test organization: %v", err)
	}

	pwdHash, _ := hashPassword("InitialPass123!")
	_, err = db.ExecContext(ctx, `
		INSERT INTO users (id, org_id, email, password_hash, role, is_active, two_factor_enabled, created_at, updated_at)
		VALUES ($1, $2, $3, $4, 'member', true, false, NOW(), NOW())
	`, userID, orgID, userEmail, pwdHash)
	if err != nil {
		t.Fatalf("failed to insert test user: %v", err)
	}

	defer func() {
		_, _ = db.ExecContext(context.Background(), `DELETE FROM users WHERE id=$1`, userID)
		_, _ = db.ExecContext(context.Background(), `DELETE FROM organizations WHERE id=$1`, orgID)
	}()

	// 1. Test passkeyLoginOptionsHandler generates valid options
	req := httptest.NewRequest(http.MethodGet, "/v1/auth/passkeys/login-options?email="+userEmail, nil)
	rec := httptest.NewRecorder()
	passkeyLoginOptionsHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK from passkeyLoginOptionsHandler, got %d: %s", rec.Code, rec.Body.String())
	}

	var optsResp map[string]interface{}
	if err := json.NewDecoder(rec.Body).Decode(&optsResp); err != nil {
		t.Fatalf("failed to decode login options: %v", err)
	}
	challenge, ok := optsResp["challenge"].(string)
	if !ok || challenge == "" {
		t.Fatalf("expected non-empty challenge in login options")
	}

	// Verify challenge was recorded in auth_challenges
	var storedChallengeID string
	err = db.QueryRowContext(ctx, `
		SELECT id::text FROM auth_challenges
		WHERE challenge_type='webauthn_login' AND challenge_token=$1 AND expires_at > NOW()
	`, challenge).Scan(&storedChallengeID)
	if err != nil {
		t.Fatalf("challenge not found in auth_challenges: %v", err)
	}

	// 2. Test passkeyStepUpVerifyHandler: verify single-use consumption and token issuance
	// Create simulated step-up challenge
	stepUpChallengeToken, _ := generateRandomBase64URL(32)
	sessionData := webauthn.SessionData{
		Challenge:        stepUpChallengeToken,
		UserID:           []byte(userID),
		UserVerification: protocol.VerificationRequired,
		Expires:          time.Now().Add(5 * time.Minute),
	}
	sessionJSON, _ := json.Marshal(sessionData)

	var chID string
	err = db.QueryRowContext(ctx, `
		INSERT INTO auth_challenges (user_id, challenge_type, challenge_token, destination, expires_at)
		VALUES ($1, 'webauthn_step_up', $2, $3, NOW() + INTERVAL '5 minutes')
		RETURNING id::text
	`, userID, stepUpChallengeToken, string(sessionJSON)).Scan(&chID)
	if err != nil {
		t.Fatalf("failed to insert step-up challenge: %v", err)
	}

	// Direct step-up MFA token verification in changePasswordHandler
	// Insert verified step_up_mfa token
	stepUpMFAToken, _ := generateRandomBase64URL(32)
	_, err = db.ExecContext(ctx, `
		INSERT INTO auth_challenges (user_id, challenge_type, challenge_token, destination, expires_at)
		VALUES ($1, 'step_up_mfa', $2, 'passkey', NOW() + INTERVAL '5 minutes')
	`, userID, stepUpMFAToken)
	if err != nil {
		t.Fatalf("failed to insert step_up_mfa token: %v", err)
	}

	// Enroll a mock passkey on the user to test password change requirement
	mockCredID, _ := generateRandomBase64URL(32)
	_, err = db.ExecContext(ctx, `
		INSERT INTO user_passkeys (user_id, credential_id, public_key, counter, device_name)
		VALUES ($1, $2, '{"publicKey":"test"}', 0, 'Test Passkey Authenticator')
	`, userID, mockCredID)
	if err != nil {
		t.Fatalf("failed to insert user passkey: %v", err)
	}

	// Create active session for test user
	token, hash := generateSessionToken()
	expires := time.Now().Add(24 * time.Hour)
	_, err = db.ExecContext(ctx, `
		INSERT INTO sessions (user_id, token_hash, expires_at, created_at, user_agent, ip_address)
		VALUES ($1, $2, $3, NOW(), 'Go-Test-Agent', '127.0.0.1')
	`, userID, hash, expires)
	if err != nil {
		t.Fatalf("failed to insert test session: %v", err)
	}

	// Change password using valid step-up MFA token
	changeReqBody := map[string]string{
		"current_password": "InitialPass123!",
		"new_password":     "NewSecurePass456!",
		"mfa_code":         stepUpMFAToken,
	}
	changeBodyBytes, _ := json.Marshal(changeReqBody)
	changeReq := httptest.NewRequest(http.MethodPost, "/v1/auth/change-password", bytes.NewReader(changeBodyBytes))
	changeReq.Header.Set("Authorization", "Bearer "+token)
	changeReq.Header.Set("Content-Type", "application/json")
	changeRec := httptest.NewRecorder()
	changePasswordHandler(changeRec, changeReq)

	if changeRec.Code != http.StatusOK && changeRec.Code != http.StatusNoContent {
		t.Fatalf("expected 200 OK or 204 No Content from changePasswordHandler with step-up MFA, got %d: %s", changeRec.Code, changeRec.Body.String())
	}

	// Verify step_up_mfa token was consumed (single-use)
	var remainingCount int
	_ = db.QueryRowContext(ctx, `SELECT COUNT(*) FROM auth_challenges WHERE challenge_token=$1`, stepUpMFAToken).Scan(&remainingCount)
	if remainingCount != 0 {
		t.Fatalf("step_up_mfa challenge token was not deleted after consumption!")
	}

	// Verify attempting to replay the same step_up_mfa token fails with 401
	changeReq2 := httptest.NewRequest(http.MethodPost, "/v1/auth/change-password", bytes.NewReader(changeBodyBytes))
	changeReq2.Header.Set("Authorization", "Bearer "+token)
	changeReq2.Header.Set("Content-Type", "application/json")
	changeRec2 := httptest.NewRecorder()
	changePasswordHandler(changeRec2, changeReq2)

	if changeRec2.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized when replaying consumed step-up token, got %d: %s", changeRec2.Code, changeRec2.Body.String())
	}
}

func generateTestWebAuthnAttestationPayload(challengeStr, origin string, credID []byte) ([]byte, string) {
	privKey, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	pubKey := privKey.PublicKey

	var coseKey []byte
	coseKey = append(coseKey, 0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01)
	xBytes := pubKey.X.Bytes()
	if len(xBytes) < 32 {
		padded := make([]byte, 32)
		copy(padded[32-len(xBytes):], xBytes)
		xBytes = padded
	}
	coseKey = append(coseKey, 0x21, 0x58, 0x20)
	coseKey = append(coseKey, xBytes...)
	yBytes := pubKey.Y.Bytes()
	if len(yBytes) < 32 {
		padded := make([]byte, 32)
		copy(padded[32-len(yBytes):], yBytes)
		yBytes = padded
	}
	coseKey = append(coseKey, 0x22, 0x58, 0x20)
	coseKey = append(coseKey, yBytes...)

	var attCredData []byte
	aaguid := make([]byte, 16)
	attCredData = append(attCredData, aaguid...)
	credIDLen := make([]byte, 2)
	binary.BigEndian.PutUint16(credIDLen, uint16(len(credID)))
	attCredData = append(attCredData, credIDLen...)
	attCredData = append(attCredData, credID...)
	attCredData = append(attCredData, coseKey...)

	rpIdHash := sha256.Sum256([]byte("localhost"))
	var authData []byte
	authData = append(authData, rpIdHash[:]...)
	authData = append(authData, 0x45) // UP (1) | UV (4) | AT (0x40)
	authData = append(authData, 0x00, 0x00, 0x00, 0x00)
	authData = append(authData, attCredData...)

	var cborBytes []byte
	cborBytes = append(cborBytes, 0xa3)
	cborBytes = append(cborBytes, 0x63, 'f', 'm', 't', 0x64, 'n', 'o', 'n', 'e')
	cborBytes = append(cborBytes, 0x67, 'a', 't', 't', 'S', 't', 'm', 't', 0xa0)
	cborBytes = append(cborBytes, 0x68, 'a', 'u', 't', 'h', 'D', 'a', 't', 'a')
	if len(authData) < 256 {
		cborBytes = append(cborBytes, 0x58, byte(len(authData)))
	} else {
		cborBytes = append(cborBytes, 0x59, byte(len(authData)>>8), byte(len(authData)&0xff))
	}
	cborBytes = append(cborBytes, authData...)

	b64Attestation := base64.RawURLEncoding.EncodeToString(cborBytes)
	clientDataB64 := base64.RawURLEncoding.EncodeToString([]byte(`{"type":"webauthn.create","challenge":"` + challengeStr + `","origin":"` + origin + `"}`))
	credIDB64 := base64.RawURLEncoding.EncodeToString(credID)

	payloadMap := map[string]interface{}{
		"id":              credIDB64,
		"rawId":           credIDB64,
		"type":            "public-key",
		"device_name":     "Hardware Security Key",
		"credential_id":   credIDB64,
		"challenge_token": challengeStr,
		"response": map[string]interface{}{
			"clientDataJSON":    clientDataB64,
			"attestationObject": b64Attestation,
			"transports":        []string{"internal"},
		},
	}
	payloadBytes, _ := json.Marshal(payloadMap)
	return payloadBytes, credIDB64
}

func TestPasskeyRegistrationCeremonyContractAndValidation(t *testing.T) {
	dsn := getValidatedTestDSN(t)
	t.Setenv("BYOS_ENV", "development")

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatalf("failed to connect to test db: %v", err)
	}
	defer conn.Close(ctx)

	orgID := uuid.New().String()
	userAID := uuid.New().String()
	userBID := uuid.New().String()
	emailA := "passkey.reg.a." + uuid.New().String()[:8] + "@byos.local"
	emailB := "passkey.reg.b." + uuid.New().String()[:8] + "@byos.local"

	_, _ = conn.Exec(ctx, `INSERT INTO organizations (id, name, created_at, updated_at) VALUES ($1, 'Reg Org', NOW(), NOW()) ON CONFLICT (id) DO NOTHING`, orgID)
	pwdHash, _ := hashPassword("SecretPass123!")
	_, _ = conn.Exec(ctx, `INSERT INTO users (id, org_id, email, password_hash, role, is_active, two_factor_enabled, created_at, updated_at) VALUES ($1, $2, $3, $4, 'member', true, false, NOW(), NOW())`, userAID, orgID, emailA, pwdHash)
	_, _ = conn.Exec(ctx, `INSERT INTO users (id, org_id, email, password_hash, role, is_active, two_factor_enabled, created_at, updated_at) VALUES ($1, $2, $3, $4, 'member', true, false, NOW(), NOW())`, userBID, orgID, emailB, pwdHash)

	defer func() {
		_, _ = conn.Exec(context.Background(), `DELETE FROM users WHERE id IN ($1, $2)`, userAID, userBID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM organizations WHERE id=$1`, orgID)
	}()

	tokenA, hashA := generateSessionToken()
	tokenB, hashB := generateSessionToken()
	expires := time.Now().Add(24 * time.Hour)
	_, _ = conn.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, expires_at, created_at, user_agent, ip_address) VALUES ($1, $2, $3, NOW(), 'TestAgent', '127.0.0.1')`, userAID, hashA, expires)
	_, _ = conn.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, expires_at, created_at, user_agent, ip_address) VALUES ($1, $2, $3, NOW(), 'TestAgent', '127.0.0.1')`, userBID, hashB, expires)

	// 1. Missing credential creation payload (empty body) -> 400 Bad Request
	reqEmpty := httptest.NewRequest(http.MethodPost, "/v1/auth/passkeys/register", bytes.NewReader([]byte("")))
	reqEmpty.Header.Set("Authorization", "Bearer "+tokenA)
	reqEmpty.Header.Set("Content-Type", "application/json")
	recEmpty := httptest.NewRecorder()
	passkeyRegisterHandler(recEmpty, reqEmpty)
	if recEmpty.Code != http.StatusBadRequest {
		t.Errorf("expected 400 on empty body, got %d: %s", recEmpty.Code, recEmpty.Body.String())
	}

	// 2. Missing credential creation payload (legacy fields without WebAuthn attestation) -> 400 Bad Request
	legacyPayload, _ := json.Marshal(map[string]string{
		"credential_id":   "legacy-cred-id",
		"challenge_token": "legacy-token",
	})
	reqLegacy := httptest.NewRequest(http.MethodPost, "/v1/auth/passkeys/register", bytes.NewReader(legacyPayload))
	reqLegacy.Header.Set("Authorization", "Bearer "+tokenA)
	reqLegacy.Header.Set("Content-Type", "application/json")
	recLegacy := httptest.NewRecorder()
	passkeyRegisterHandler(recLegacy, reqLegacy)
	if recLegacy.Code != http.StatusBadRequest {
		t.Errorf("expected 400 on legacy payload without attestation, got %d: %s", recLegacy.Code, recLegacy.Body.String())
	}

	// 3. Register options endpoint returns challenge and challenge_token
	optsReq := httptest.NewRequest(http.MethodGet, "/v1/auth/passkeys/register-options", nil)
	optsReq.Header.Set("Authorization", "Bearer "+tokenA)
	optsRec := httptest.NewRecorder()
	passkeyRegisterOptionsHandler(optsRec, optsReq)
	if optsRec.Code != http.StatusOK {
		t.Fatalf("expected 200 from register-options, got %d: %s", optsRec.Code, optsRec.Body.String())
	}
	var optsMap map[string]interface{}
	_ = json.NewDecoder(optsRec.Body).Decode(&optsMap)
	challengeStr, _ := optsMap["challenge"].(string)
	challengeTokenStr, _ := optsMap["challenge_token"].(string)
	if challengeStr == "" || challengeTokenStr == "" || challengeStr != challengeTokenStr {
		t.Fatalf("expected identical non-empty challenge and challenge_token, got challenge=%q, challenge_token=%q", challengeStr, challengeTokenStr)
	}

	// Generate valid test attestation payload bound to challengeStr
	testCredID := []byte("fido2-cred-sec-1234567890abcdef")
	validPayload, credIDB64 := generateTestWebAuthnAttestationPayload(challengeStr, "http://localhost:3000", testCredID)

	// 4. Missing challenge identifier in clientDataJSON -> 400 Bad Request
	var parsedValidMap map[string]interface{}
	_ = json.Unmarshal(validPayload, &parsedValidMap)
	respMap := parsedValidMap["response"].(map[string]interface{})
	attB64 := respMap["attestationObject"].(string)
	noChClientDataJSON := base64.RawURLEncoding.EncodeToString([]byte(`{"type":"webauthn.create","challenge":"","origin":"http://localhost:3000"}`))
	noChPayload, _ := json.Marshal(map[string]interface{}{
		"id": credIDB64, "rawId": credIDB64, "type": "public-key",
		"response": map[string]interface{}{"clientDataJSON": noChClientDataJSON, "attestationObject": attB64},
	})
	reqNoCh := httptest.NewRequest(http.MethodPost, "/v1/auth/passkeys/register", bytes.NewReader(noChPayload))
	reqNoCh.Header.Set("Authorization", "Bearer "+tokenA)
	reqNoCh.Header.Set("Content-Type", "application/json")
	recNoCh := httptest.NewRecorder()
	passkeyRegisterHandler(recNoCh, reqNoCh)
	if recNoCh.Code != http.StatusBadRequest || !strings.Contains(recNoCh.Body.String(), "missing challenge identifier") {
		t.Errorf("expected 400 missing challenge identifier, got %d: %s", recNoCh.Code, recNoCh.Body.String())
	}

	// 5. Challenge token mismatch -> 400 Bad Request
	mismatchChPayload, _ := json.Marshal(map[string]interface{}{
		"id": credIDB64, "rawId": credIDB64, "type": "public-key",
		"challenge_token": "tampered-challenge-token",
		"response": respMap,
	})
	reqMismatchCh := httptest.NewRequest(http.MethodPost, "/v1/auth/passkeys/register", bytes.NewReader(mismatchChPayload))
	reqMismatchCh.Header.Set("Authorization", "Bearer "+tokenA)
	reqMismatchCh.Header.Set("Content-Type", "application/json")
	recMismatchCh := httptest.NewRecorder()
	passkeyRegisterHandler(recMismatchCh, reqMismatchCh)
	if recMismatchCh.Code != http.StatusBadRequest || !strings.Contains(recMismatchCh.Body.String(), "challenge token mismatch") {
		t.Errorf("expected 400 challenge token mismatch, got %d: %s", recMismatchCh.Code, recMismatchCh.Body.String())
	}

	// 6. Credential ID mismatch -> 400 Bad Request
	mismatchCredIDPayload, _ := json.Marshal(map[string]interface{}{
		"id": credIDB64, "rawId": credIDB64, "type": "public-key",
		"credential_id": "substituted-credential-id",
		"challenge_token": challengeStr,
		"response": respMap,
	})
	reqMismatchCID := httptest.NewRequest(http.MethodPost, "/v1/auth/passkeys/register", bytes.NewReader(mismatchCredIDPayload))
	reqMismatchCID.Header.Set("Authorization", "Bearer "+tokenA)
	reqMismatchCID.Header.Set("Content-Type", "application/json")
	recMismatchCID := httptest.NewRecorder()
	passkeyRegisterHandler(recMismatchCID, reqMismatchCID)
	if recMismatchCID.Code != http.StatusBadRequest || !strings.Contains(recMismatchCID.Body.String(), "credential ID mismatch") {
		t.Errorf("expected 400 credential ID mismatch, got %d: %s", recMismatchCID.Code, recMismatchCID.Body.String())
	}

	// 7. Wrong-user challenge -> 400 Bad Request
	// User B tries to use challenge created for User A
	reqWrongUser := httptest.NewRequest(http.MethodPost, "/v1/auth/passkeys/register", bytes.NewReader(validPayload))
	reqWrongUser.Header.Set("Authorization", "Bearer "+tokenB) // User B token
	reqWrongUser.Header.Set("Content-Type", "application/json")
	recWrongUser := httptest.NewRecorder()
	passkeyRegisterHandler(recWrongUser, reqWrongUser)
	if recWrongUser.Code != http.StatusBadRequest || !strings.Contains(recWrongUser.Body.String(), "invalid or expired registration challenge") {
		t.Errorf("expected 400 invalid or expired challenge on wrong user, got %d: %s", recWrongUser.Code, recWrongUser.Body.String())
	}

	// 8. Expired challenge -> 400 Bad Request
	expiredChallengeStr, _ := generateRandomBase64URL(32)
	_, _ = conn.Exec(ctx, `INSERT INTO auth_challenges (user_id, challenge_type, challenge_token, destination, expires_at) VALUES ($1, 'webauthn_register', $2, '{}', NOW() - INTERVAL '10 seconds')`, userAID, expiredChallengeStr)
	expiredPayload, _ := generateTestWebAuthnAttestationPayload(expiredChallengeStr, "http://localhost:3000", testCredID)
	reqExpired := httptest.NewRequest(http.MethodPost, "/v1/auth/passkeys/register", bytes.NewReader(expiredPayload))
	reqExpired.Header.Set("Authorization", "Bearer "+tokenA)
	reqExpired.Header.Set("Content-Type", "application/json")
	recExpired := httptest.NewRecorder()
	passkeyRegisterHandler(recExpired, reqExpired)
	if recExpired.Code != http.StatusBadRequest || !strings.Contains(recExpired.Body.String(), "invalid or expired registration challenge") {
		t.Errorf("expected 400 invalid or expired challenge on expired timestamp, got %d: %s", recExpired.Code, recExpired.Body.String())
	}

	// 9. Invalid attestation payload (corrupt CBOR) -> 400 Bad Request
	corruptPayload, _ := json.Marshal(map[string]interface{}{
		"id": credIDB64, "rawId": credIDB64, "type": "public-key",
		"response": map[string]interface{}{
			"clientDataJSON": respMap["clientDataJSON"],
			"attestationObject": base64.RawURLEncoding.EncodeToString([]byte("completely-corrupt-cbor-data")),
		},
	})
	reqInvalidAtt := httptest.NewRequest(http.MethodPost, "/v1/auth/passkeys/register", bytes.NewReader(corruptPayload))
	reqInvalidAtt.Header.Set("Authorization", "Bearer "+tokenA)
	reqInvalidAtt.Header.Set("Content-Type", "application/json")
	recInvalidAtt := httptest.NewRecorder()
	passkeyRegisterHandler(recInvalidAtt, reqInvalidAtt)
	if recInvalidAtt.Code != http.StatusBadRequest {
		t.Errorf("expected 400 on corrupt attestation, got %d: %s", recInvalidAtt.Code, recInvalidAtt.Body.String())
	}

	// 10. Valid registration completion -> 201 Created!
	reqValid := httptest.NewRequest(http.MethodPost, "/v1/auth/passkeys/register", bytes.NewReader(validPayload))
	reqValid.Header.Set("Authorization", "Bearer "+tokenA)
	reqValid.Header.Set("Content-Type", "application/json")
	recValid := httptest.NewRecorder()
	passkeyRegisterHandler(recValid, reqValid)
	if recValid.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created from passkeyRegisterHandler, got %d: %s", recValid.Code, recValid.Body.String())
	}

	// 11. Credential ID was extracted from verified response
	var createdPasskey UserPasskey
	if err := json.NewDecoder(recValid.Body).Decode(&createdPasskey); err != nil {
		t.Fatalf("failed to decode created passkey response: %v", err)
	}
	if createdPasskey.CredentialID != credIDB64 {
		t.Errorf("expected verified credential ID %q, got %q", credIDB64, createdPasskey.CredentialID)
	}
	if createdPasskey.UserID != userAID {
		t.Errorf("expected user ID %q, got %q", userAID, createdPasskey.UserID)
	}

	// 12. Reused challenge -> challenge consumed atomically, replay fails -> 400 Bad Request
	reqReused := httptest.NewRequest(http.MethodPost, "/v1/auth/passkeys/register", bytes.NewReader(validPayload))
	reqReused.Header.Set("Authorization", "Bearer "+tokenA)
	reqReused.Header.Set("Content-Type", "application/json")
	recReused := httptest.NewRecorder()
	passkeyRegisterHandler(recReused, reqReused)
	if recReused.Code != http.StatusBadRequest || !strings.Contains(recReused.Body.String(), "invalid or expired registration challenge") {
		t.Errorf("expected 400 on reused challenge, got %d: %s", recReused.Code, recReused.Body.String())
	}

	// 13. Successful credential persistence in user_passkeys
	var storedCredID, storedDeviceName string
	err = conn.QueryRow(ctx, `SELECT credential_id, device_name FROM user_passkeys WHERE id=$1`, createdPasskey.ID).Scan(&storedCredID, &storedDeviceName)
	if err != nil {
		t.Fatalf("credential not found in user_passkeys: %v", err)
	}
	if storedCredID != credIDB64 {
		t.Errorf("persisted credential ID mismatch: got %q, want %q", storedCredID, credIDB64)
	}
	if storedDeviceName != "Hardware Security Key" {
		t.Errorf("persisted device name mismatch: got %q, want 'Hardware Security Key'", storedDeviceName)
	}

	// 14. Loading saved credential from PostgreSQL via loadWebAuthnUser
	reloadedUser, err := loadWebAuthnUser(ctx, conn, userAID)
	if err != nil {
		t.Fatalf("failed to reload user: %v", err)
	}
	if len(reloadedUser.Credentials) != 1 {
		t.Fatalf("expected 1 credential loaded, got %d", len(reloadedUser.Credentials))
	}
	if !bytes.Equal(reloadedUser.Credentials[0].ID, testCredID) {
		t.Errorf("loaded credential ID bytes mismatch: got %x, want %x", reloadedUser.Credentials[0].ID, testCredID)
	}

	// 15. User MFA flag enabled
	var twoFactorEnabled bool
	_ = conn.QueryRow(ctx, `SELECT two_factor_enabled FROM users WHERE id=$1`, userAID).Scan(&twoFactorEnabled)
	if !twoFactorEnabled {
		t.Errorf("expected two_factor_enabled to be true after successful passkey enrollment")
	}
}
