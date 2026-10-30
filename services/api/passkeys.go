package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// UserPasskey represents an enrolled WebAuthn/FIDO2 credential
type UserPasskey struct {
	ID           string     `json:"id"`
	UserID       string     `json:"user_id"`
	CredentialID string     `json:"credential_id"`
	PublicKey    string     `json:"public_key"`
	Counter      int64      `json:"counter"`
	DeviceName   string     `json:"device_name"`
	AAGUID       string     `json:"aaguid,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
	LastUsedAt   *time.Time `json:"last_used_at,omitempty"`
}

func getRPID(r *http.Request) string {
	cfg, err := getWebAuthnConfig()
	if err == nil && cfg != nil && cfg.RPID != "" {
		return cfg.RPID
	}
	host := ""
	if origin := r.Header.Get("Origin"); origin != "" {
		if u, err := url.Parse(origin); err == nil && u.Hostname() != "" {
			host = u.Hostname()
		}
	}
	if host == "" {
		host = r.Host
	}
	if strings.Contains(host, ":") {
		host = strings.Split(host, ":")[0]
	}
	if host == "" || host == "localhost" || host == "127.0.0.1" {
		return "localhost"
	}
	return host
}

func generateRandomBase64URL(bytesCount int) (string, error) {
	b := make([]byte, bytesCount)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func passkeyRateLimited(w http.ResponseWriter, r *http.Request, scope string) bool {
	if redisClient == nil {
		return false
	}
	ip := getClientIP(r)
	ctx := context.Background()
	key := "auth:passkey:" + scope + ":" + ip

	keys := []string{key}
	args := []interface{}{15, 60} // 15 attempts per 60s
	res, err := redisClient.Eval(ctx, rateLuaScript, keys, args...).Result()
	if err != nil {
		return false
	}
	arr, ok := res.([]interface{})
	if !ok || len(arr) == 0 {
		return false
	}
	code, _ := arr[0].(int64)
	if code != 1 {
		w.Header().Set("Retry-After", "60")
		http.Error(w, "too many requests, try later", http.StatusTooManyRequests)
		return true
	}
	return false
}

// passkeyRegisterOptionsHandler handles GET /v1/auth/passkeys/register-options
func passkeyRegisterOptionsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	if passkeyRateLimited(w, r, "register_opts") {
		return
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	ctx := r.Context()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		http.Error(w, "database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	user, err := loadWebAuthnUser(ctx, conn, userID)
	if err != nil {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}

	wa, err := getWebAuthn()
	if err != nil {
		http.Error(w, "webauthn configuration error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	creation, sessionData, err := wa.BeginRegistration(user)
	if err != nil {
		http.Error(w, "failed to begin passkey registration: "+err.Error(), http.StatusInternalServerError)
		return
	}

	sessionJSON, err := json.Marshal(sessionData)
	if err != nil {
		http.Error(w, "failed to marshal session data", http.StatusInternalServerError)
		return
	}

	// Store challenge with 5-minute expiry, binding sessionData
	_, err = conn.Exec(ctx, `
		INSERT INTO auth_challenges (user_id, challenge_type, challenge_token, destination, expires_at)
		VALUES ($1, 'webauthn_register', $2, $3, NOW() + INTERVAL '5 minutes')
	`, userID, sessionData.Challenge, string(sessionJSON))
	if err != nil {
		http.Error(w, "failed to store challenge", http.StatusInternalServerError)
		return
	}

	resp := map[string]interface{}{
		"challenge":              creation.Response.Challenge,
		"challenge_token":        creation.Response.Challenge,
		"rp":                     creation.Response.RelyingParty,
		"user":                   creation.Response.User,
		"pubKeyCredParams":       creation.Response.Parameters,
		"authenticatorSelection": creation.Response.AuthenticatorSelection,
		"timeout":                creation.Response.Timeout,
		"attestation":            creation.Response.Attestation,
		"excludeCredentials":     creation.Response.CredentialExcludeList,
		"publicKey":              creation.Response,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// passkeyRegisterHandler handles POST /v1/auth/passkeys/register
func passkeyRegisterHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	if passkeyRateLimited(w, r, "register") {
		return
	}

	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "failed to read request body", http.StatusBadRequest)
		return
	}
	if len(bytes.TrimSpace(bodyBytes)) == 0 {
		http.Error(w, "missing credential payload", http.StatusBadRequest)
		return
	}

	var rawMap map[string]json.RawMessage
	_ = json.Unmarshal(bodyBytes, &rawMap)

	deviceName := "Passkey Authenticator"
	if devRaw, ok := rawMap["device_name"]; ok {
		var dn string
		if err := json.Unmarshal(devRaw, &dn); err == nil && strings.TrimSpace(dn) != "" {
			deviceName = strings.TrimSpace(dn)
		}
	}

	credBytes := bodyBytes
	if credRaw, ok := rawMap["credential"]; ok && len(credRaw) > 0 {
		credBytes = credRaw
	}

	parsedCreation, err := protocol.ParseCredentialCreationResponseBytes(credBytes)
	if err != nil {
		http.Error(w, "invalid credential creation payload: "+err.Error(), http.StatusBadRequest)
		return
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	ctx := r.Context()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		http.Error(w, "database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	// Validate & atomically consume challenge
	challengeToken := parsedCreation.Response.CollectedClientData.Challenge
	if strings.TrimSpace(challengeToken) == "" {
		http.Error(w, "missing challenge identifier", http.StatusBadRequest)
		return
	}

	// If client provided explicit challenge_token, ensure strict cryptographic binding match
	if ctRaw, ok := rawMap["challenge_token"]; ok {
		var explicitCT string
		if err := json.Unmarshal(ctRaw, &explicitCT); err == nil && strings.TrimSpace(explicitCT) != "" {
			if strings.TrimSpace(explicitCT) != challengeToken {
				http.Error(w, "challenge token mismatch", http.StatusBadRequest)
				return
			}
		}
	}

	// If client provided explicit credential_id, ensure strict match with parsed creation ID
	if cidRaw, ok := rawMap["credential_id"]; ok {
		var explicitCID string
		if err := json.Unmarshal(cidRaw, &explicitCID); err == nil && strings.TrimSpace(explicitCID) != "" {
			if strings.TrimSpace(explicitCID) != parsedCreation.ID {
				http.Error(w, "credential ID mismatch", http.StatusBadRequest)
				return
			}
		}
	}

	var challengeID string
	var destJSON string
	err = conn.QueryRow(ctx, `
		DELETE FROM auth_challenges
		WHERE user_id=$1 AND challenge_type='webauthn_register'
		  AND challenge_token=$2 AND expires_at > NOW()
		RETURNING id::text, destination
	`, userID, challengeToken).Scan(&challengeID, &destJSON)
	if err != nil {
		http.Error(w, "invalid or expired registration challenge", http.StatusBadRequest)
		return
	}

	var sessionData webauthn.SessionData
	if err := json.Unmarshal([]byte(destJSON), &sessionData); err != nil {
		http.Error(w, "corrupted registration session data", http.StatusInternalServerError)
		return
	}

	user, err := loadWebAuthnUser(ctx, conn, userID)
	if err != nil {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}

	wa, err := getWebAuthn()
	if err != nil {
		http.Error(w, "webauthn configuration error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	credential, err := wa.CreateCredential(user, sessionData, parsedCreation)
	if err != nil {
		http.Error(w, "passkey attestation verification failed: "+err.Error(), http.StatusBadRequest)
		return
	}

	// Verify User Presence and User Verification
	flags := parsedCreation.Response.AttestationObject.AuthData.Flags
	if !flags.HasUserPresent() {
		http.Error(w, "user presence required", http.StatusBadRequest)
		return
	}
	if !flags.HasUserVerified() {
		http.Error(w, "user verification required", http.StatusBadRequest)
		return
	}

	credJSON, err := json.Marshal(credential)
	if err != nil {
		http.Error(w, "failed to marshal credential record", http.StatusInternalServerError)
		return
	}

	credIDB64 := base64.RawURLEncoding.EncodeToString(credential.ID)
	aaguidHex := hex.EncodeToString(credential.Authenticator.AAGUID)

	var item UserPasskey
	err = conn.QueryRow(ctx, `
		INSERT INTO user_passkeys (user_id, credential_id, public_key, counter, device_name, aaguid)
		VALUES ($1, $2, $3, $4, $5, NULLIF($6, ''))
		ON CONFLICT (credential_id) DO UPDATE
		SET device_name = EXCLUDED.device_name,
		    public_key = EXCLUDED.public_key,
		    counter = EXCLUDED.counter,
		    last_used_at = NOW()
		RETURNING id::text, user_id::text, credential_id, public_key, counter, device_name, COALESCE(aaguid, ''), created_at
	`, userID, credIDB64, string(credJSON), int64(credential.Authenticator.SignCount), deviceName, aaguidHex).Scan(
		&item.ID, &item.UserID, &item.CredentialID, &item.PublicKey, &item.Counter, &item.DeviceName, &item.AAGUID, &item.CreatedAt,
	)
	if err != nil {
		http.Error(w, "failed to store passkey", http.StatusInternalServerError)
		return
	}

	auditLog(ctx, conn, "", userID, "register_passkey", "user_passkey", item.ID, map[string]interface{}{
		"device_name":   deviceName,
		"credential_id": credIDB64,
	})

	// Registering a passkey satisfies MFA and enables two-factor authentication
	_, _ = conn.Exec(ctx, `UPDATE users SET two_factor_enabled=true, updated_at=NOW() WHERE id=$1`, userID)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(item)
}

// passkeyLoginOptionsHandler handles GET /v1/auth/passkeys/login-options
func passkeyLoginOptionsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if passkeyRateLimited(w, r, "login_opts") {
		return
	}

	email := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("email")))

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	ctx := r.Context()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		http.Error(w, "database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	wa, err := getWebAuthn()
	if err != nil {
		http.Error(w, "webauthn configuration error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	var assertion *protocol.CredentialAssertion
	var sessionData *webauthn.SessionData
	var targetUserID *string

	if email != "" {
		var uid string
		if err := conn.QueryRow(ctx, `SELECT id::text FROM users WHERE email=$1 AND is_active=true`, email).Scan(&uid); err == nil {
			targetUserID = &uid
			user, err := loadWebAuthnUser(ctx, conn, uid)
			if err == nil && len(user.Credentials) > 0 {
				assertion, sessionData, err = wa.BeginLogin(user)
			}
		}
	}

	if assertion == nil || sessionData == nil {
		var err2 error
		assertion, sessionData, err2 = wa.BeginDiscoverableLogin()
		if err2 != nil {
			http.Error(w, "failed to begin discoverable passkey login: "+err2.Error(), http.StatusInternalServerError)
			return
		}
	}

	sessionJSON, err := json.Marshal(sessionData)
	if err != nil {
		http.Error(w, "failed to marshal session data", http.StatusInternalServerError)
		return
	}

	_, err = conn.Exec(ctx, `
		INSERT INTO auth_challenges (user_id, challenge_type, challenge_token, destination, expires_at)
		VALUES ($1, 'webauthn_login', $2, $3, NOW() + INTERVAL '5 minutes')
	`, targetUserID, sessionData.Challenge, string(sessionJSON))
	if err != nil {
		http.Error(w, "failed to store challenge", http.StatusInternalServerError)
		return
	}

	resp := map[string]interface{}{
		"challenge":        assertion.Response.Challenge,
		"rpId":             assertion.Response.RelyingPartyID,
		"userVerification": assertion.Response.UserVerification,
		"timeout":          assertion.Response.Timeout,
		"allowCredentials": assertion.Response.AllowedCredentials,
		"publicKey":        assertion.Response,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// passkeyLoginHandler handles POST /v1/auth/passkeys/login
// Cryptographically validates the WebAuthn assertion, validates counter & UV,
// detects clones, and issues an authenticated session upon success.
func passkeyLoginHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	if passkeyRateLimited(w, r, "login") {
		return
	}

	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "failed to read request body", http.StatusBadRequest)
		return
	}
	if len(bytes.TrimSpace(bodyBytes)) == 0 {
		http.Error(w, "missing credential payload", http.StatusBadRequest)
		return
	}

	var rawMap map[string]json.RawMessage
	_ = json.Unmarshal(bodyBytes, &rawMap)

	credBytes := bodyBytes
	if credRaw, ok := rawMap["credential"]; ok && len(credRaw) > 0 {
		credBytes = credRaw
	}

	parsedAssertion, err := protocol.ParseCredentialRequestResponseBytes(credBytes)
	if err != nil {
		http.Error(w, "invalid credential assertion payload: "+err.Error(), http.StatusBadRequest)
		return
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	ctx := r.Context()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		http.Error(w, "database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	challengeToken := parsedAssertion.Response.CollectedClientData.Challenge
	var challengeID string
	var chUserID *string
	var destJSON string

	err = conn.QueryRow(ctx, `
		DELETE FROM auth_challenges
		WHERE challenge_type = 'webauthn_login'
		  AND challenge_token = $1
		  AND expires_at > NOW()
		RETURNING id::text, user_id::text, destination
	`, challengeToken).Scan(&challengeID, &chUserID, &destJSON)
	if err != nil {
		http.Error(w, "invalid or expired login challenge", http.StatusUnauthorized)
		return
	}

	var sessionData webauthn.SessionData
	if err := json.Unmarshal([]byte(destJSON), &sessionData); err != nil {
		http.Error(w, "corrupted login session data", http.StatusInternalServerError)
		return
	}

	wa, err := getWebAuthn()
	if err != nil {
		http.Error(w, "webauthn configuration error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	var authenticatedUser webauthn.User
	var credential *webauthn.Credential

	if len(sessionData.UserID) > 0 {
		// User-specific ceremony
		if chUserID == nil || *chUserID == "" {
			http.Error(w, "user mismatch for session", http.StatusUnauthorized)
			return
		}
		u, err := loadWebAuthnUser(ctx, conn, *chUserID)
		if err != nil {
			http.Error(w, "user not found", http.StatusUnauthorized)
			return
		}
		credential, err = wa.ValidateLogin(u, sessionData, parsedAssertion)
		if err != nil {
			http.Error(w, "passkey verification failed: "+err.Error(), http.StatusUnauthorized)
			return
		}
		authenticatedUser = u
	} else {
		// Discoverable ceremony
		discoverableHandler := func(rawID, userHandle []byte) (webauthn.User, error) {
			var uid string
			if len(userHandle) > 0 {
				if parsedUUID, err := uuid.FromBytes(userHandle); err == nil {
					uid = parsedUUID.String()
				}
			}
			if uid == "" {
				credIDStr := base64.RawURLEncoding.EncodeToString(rawID)
				_ = conn.QueryRow(ctx, `SELECT user_id::text FROM user_passkeys WHERE credential_id=$1`, credIDStr).Scan(&uid)
				if uid == "" {
					credIDStd := base64.StdEncoding.EncodeToString(rawID)
					_ = conn.QueryRow(ctx, `SELECT user_id::text FROM user_passkeys WHERE credential_id=$1`, credIDStd).Scan(&uid)
				}
			}
			if uid == "" {
				return nil, &protocol.ErrorUnknownCredential{Err: protocol.ErrBadRequest.WithDetails("credential not found")}
			}
			return loadWebAuthnUser(ctx, conn, uid)
		}

		authenticatedUser, credential, err = wa.ValidatePasskeyLogin(discoverableHandler, sessionData, parsedAssertion)
		if err != nil {
			http.Error(w, "passkey verification failed: "+err.Error(), http.StatusUnauthorized)
			return
		}
	}

	// Verify UP and UV
	flags := parsedAssertion.Response.AuthenticatorData.Flags
	if !flags.HasUserPresent() {
		http.Error(w, "user presence required", http.StatusUnauthorized)
		return
	}
	if !flags.HasUserVerified() {
		http.Error(w, "user verification required", http.StatusUnauthorized)
		return
	}

	// Detect cloned authenticators
	if credential.Authenticator.CloneWarning {
		auditLog(ctx, conn, "", string(authenticatedUser.WebAuthnID()), "passkey_clone_detected", "user_passkey", base64.RawURLEncoding.EncodeToString(credential.ID), nil)
		http.Error(w, "authenticator clone detected; login rejected", http.StatusUnauthorized)
		return
	}

	// Update counter and last_used_at
	credIDB64 := base64.RawURLEncoding.EncodeToString(credential.ID)
	_, _ = conn.Exec(ctx, `
		UPDATE user_passkeys
		SET counter = $1, last_used_at = NOW()
		WHERE credential_id = $2
	`, int64(credential.Authenticator.SignCount), credIDB64)

	// User handle to UUID string
	userHandle := authenticatedUser.WebAuthnID()
	parsedUID, err := uuid.FromBytes(userHandle)
	if err != nil {
		http.Error(w, "invalid user handle", http.StatusInternalServerError)
		return
	}
	userID := parsedUID.String()

	// Query user details & organization
	var userEmail, orgID, displayName, role, subscriptionStatus string
	var seatCount int
	err = conn.QueryRow(ctx, `
		SELECT u.email, u.org_id::text, COALESCE(u.display_name,''), COALESCE(u.role, 'member'),
		       COALESCE(o.seat_count, 1), COALESCE(o.subscription_status, 'active')
		FROM users u
		LEFT JOIN organizations o ON o.id = u.org_id
		WHERE u.id=$1 AND u.is_active=true
	`, userID).Scan(&userEmail, &orgID, &displayName, &role, &seatCount, &subscriptionStatus)
	if err != nil {
		http.Error(w, "user account not found or inactive", http.StatusUnauthorized)
		return
	}

	// Query mailbox details
	var mailboxID, mailboxLocalPart, mailboxMode string
	var wrappedSkUser, previousWrappedSkUser *string
	_ = conn.QueryRow(ctx, `
		SELECT id::text, local_part, mode, wrapped_sk_user, previous_wrapped_sk_user
		FROM mailboxes
		WHERE user_id=$1 AND is_active=true AND status='active'
		ORDER BY created_at DESC
		LIMIT 1`, userID).Scan(&mailboxID, &mailboxLocalPart, &mailboxMode, &wrappedSkUser, &previousWrappedSkUser)

	wrappedSkUserStr := ""
	if wrappedSkUser != nil {
		wrappedSkUserStr = *wrappedSkUser
	}
	previousWrappedSkUserStr := ""
	if previousWrappedSkUser != nil {
		previousWrappedSkUserStr = *previousWrappedSkUser
	}

	// Issue authenticated session
	userAgent := r.UserAgent()
	clientIP := getClientIP(r)
	token, expires, err := createSession(ctx, conn, userID, 30*24*time.Hour, userAgent, clientIP)
	if err != nil {
		http.Error(w, "failed to create session", http.StatusInternalServerError)
		return
	}

	setSessionCookie(w, r, token, expires)
	auditLog(ctx, conn, orgID, userID, "login_passkey", "user", userID, map[string]interface{}{
		"credential_id": credIDB64,
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":                       userID,
		"email":                    userEmail,
		"org_id":                   orgID,
		"organization_id":          orgID,
		"role":                     role,
		"seat_count":               seatCount,
		"subscription_status":      subscriptionStatus,
		"token":                    token,
		"mailbox_id":               mailboxID,
		"mailbox_local_part":       mailboxLocalPart,
		"mailbox_mode":             mailboxMode,
		"wrapped_sk_user":          wrappedSkUserStr,
		"previous_wrapped_sk_user": previousWrappedSkUserStr,
	})
}

// passkeyStepUpOptionsHandler handles GET /v1/auth/passkeys/step-up-options
func passkeyStepUpOptionsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	if passkeyRateLimited(w, r, "step_up_opts") {
		return
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	ctx := r.Context()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		http.Error(w, "database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	user, err := loadWebAuthnUser(ctx, conn, userID)
	if err != nil {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}

	if len(user.Credentials) == 0 {
		http.Error(w, "no passkeys registered on account", http.StatusBadRequest)
		return
	}

	wa, err := getWebAuthn()
	if err != nil {
		http.Error(w, "webauthn configuration error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	assertion, sessionData, err := wa.BeginLogin(user)
	if err != nil {
		http.Error(w, "failed to begin passkey step-up: "+err.Error(), http.StatusInternalServerError)
		return
	}

	sessionJSON, err := json.Marshal(sessionData)
	if err != nil {
		http.Error(w, "failed to marshal session data", http.StatusInternalServerError)
		return
	}

	_, err = conn.Exec(ctx, `
		INSERT INTO auth_challenges (user_id, challenge_type, challenge_token, destination, expires_at)
		VALUES ($1, 'webauthn_step_up', $2, $3, NOW() + INTERVAL '5 minutes')
	`, userID, sessionData.Challenge, string(sessionJSON))
	if err != nil {
		http.Error(w, "failed to store challenge", http.StatusInternalServerError)
		return
	}

	resp := map[string]interface{}{
		"challenge":        assertion.Response.Challenge,
		"rpId":             assertion.Response.RelyingPartyID,
		"userVerification": assertion.Response.UserVerification,
		"timeout":          assertion.Response.Timeout,
		"allowCredentials": assertion.Response.AllowedCredentials,
		"publicKey":        assertion.Response,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// passkeyStepUpVerifyHandler handles POST /v1/auth/passkeys/step-up-verify
// Verifies assertion and issues a single-use 'step_up_mfa' token stored in auth_challenges.
func passkeyStepUpVerifyHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	if passkeyRateLimited(w, r, "step_up_verify") {
		return
	}

	bodyBytes, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "failed to read request body", http.StatusBadRequest)
		return
	}
	if len(bytes.TrimSpace(bodyBytes)) == 0 {
		http.Error(w, "missing credential payload", http.StatusBadRequest)
		return
	}

	var rawMap map[string]json.RawMessage
	_ = json.Unmarshal(bodyBytes, &rawMap)

	credBytes := bodyBytes
	if credRaw, ok := rawMap["credential"]; ok && len(credRaw) > 0 {
		credBytes = credRaw
	}

	parsedAssertion, err := protocol.ParseCredentialRequestResponseBytes(credBytes)
	if err != nil {
		http.Error(w, "invalid credential assertion payload: "+err.Error(), http.StatusBadRequest)
		return
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	ctx := r.Context()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		http.Error(w, "database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	challengeToken := parsedAssertion.Response.CollectedClientData.Challenge
	var challengeID string
	var destJSON string

	err = conn.QueryRow(ctx, `
		DELETE FROM auth_challenges
		WHERE user_id = $1 AND challenge_type = 'webauthn_step_up'
		  AND challenge_token = $2 AND expires_at > NOW()
		RETURNING id::text, destination
	`, userID, challengeToken).Scan(&challengeID, &destJSON)
	if err != nil {
		http.Error(w, "invalid or expired step-up challenge", http.StatusUnauthorized)
		return
	}

	var sessionData webauthn.SessionData
	if err := json.Unmarshal([]byte(destJSON), &sessionData); err != nil {
		http.Error(w, "corrupted step-up session data", http.StatusInternalServerError)
		return
	}

	user, err := loadWebAuthnUser(ctx, conn, userID)
	if err != nil {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}

	wa, err := getWebAuthn()
	if err != nil {
		http.Error(w, "webauthn configuration error: "+err.Error(), http.StatusInternalServerError)
		return
	}

	credential, err := wa.ValidateLogin(user, sessionData, parsedAssertion)
	if err != nil {
		http.Error(w, "passkey step-up verification failed: "+err.Error(), http.StatusUnauthorized)
		return
	}

	// Verify UP and UV
	flags := parsedAssertion.Response.AuthenticatorData.Flags
	if !flags.HasUserPresent() {
		http.Error(w, "user presence required", http.StatusUnauthorized)
		return
	}
	if !flags.HasUserVerified() {
		http.Error(w, "user verification required", http.StatusUnauthorized)
		return
	}

	// Check clone warning
	if credential.Authenticator.CloneWarning {
		auditLog(ctx, conn, "", userID, "passkey_clone_detected", "user_passkey", base64.RawURLEncoding.EncodeToString(credential.ID), nil)
		http.Error(w, "authenticator clone detected; step-up rejected", http.StatusUnauthorized)
		return
	}

	// Update counter
	credIDB64 := base64.RawURLEncoding.EncodeToString(credential.ID)
	_, _ = conn.Exec(ctx, `
		UPDATE user_passkeys
		SET counter = $1, last_used_at = NOW()
		WHERE credential_id = $2
	`, int64(credential.Authenticator.SignCount), credIDB64)

	// Generate single-use step-up MFA token valid for 5 minutes
	stepUpToken, err := generateRandomBase64URL(32)
	if err != nil {
		http.Error(w, "failed to generate step-up token", http.StatusInternalServerError)
		return
	}

	_, err = conn.Exec(ctx, `
		INSERT INTO auth_challenges (user_id, challenge_type, challenge_token, destination, expires_at)
		VALUES ($1, 'step_up_mfa', $2, 'passkey', NOW() + INTERVAL '5 minutes')
	`, userID, stepUpToken)
	if err != nil {
		http.Error(w, "failed to record step-up authorization", http.StatusInternalServerError)
		return
	}

	auditLog(ctx, conn, "", userID, "passkey_step_up_verified", "user_passkey", credIDB64, nil)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":       true,
		"step_up_token": stepUpToken,
	})
}

// passkeysListHandler handles GET /v1/auth/passkeys
func passkeysListHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	ctx := r.Context()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		http.Error(w, "database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	rows, err := conn.Query(ctx, `
		SELECT id::text, user_id::text, credential_id, public_key, counter, device_name, COALESCE(aaguid, ''), created_at, last_used_at
		FROM user_passkeys
		WHERE user_id=$1
		ORDER BY created_at DESC
	`, userID)
	if err != nil {
		http.Error(w, "failed to query passkeys", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	items := make([]UserPasskey, 0)
	for rows.Next() {
		var item UserPasskey
		if err := rows.Scan(&item.ID, &item.UserID, &item.CredentialID, &item.PublicKey, &item.Counter, &item.DeviceName, &item.AAGUID, &item.CreatedAt, &item.LastUsedAt); err == nil {
			items = append(items, item)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(items)
}

// passkeyItemHandler handles DELETE /v1/auth/passkeys/{id}
func passkeyItemHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	passkeyID := r.PathValue("id")
	if passkeyID == "" {
		http.Error(w, "id required", http.StatusBadRequest)
		return
	}

	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	ctx := r.Context()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		http.Error(w, "database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	res, err := conn.Exec(ctx, `DELETE FROM user_passkeys WHERE id=$1 AND user_id=$2`, passkeyID, userID)
	if err != nil {
		http.Error(w, "failed to delete passkey", http.StatusInternalServerError)
		return
	}
	if res.RowsAffected() == 0 {
		http.Error(w, "passkey not found", http.StatusNotFound)
		return
	}

	auditLog(ctx, conn, "", userID, "delete_passkey", "user_passkey", passkeyID, nil)

	// Update two_factor_enabled based on remaining factors (has TOTP or remaining passkeys)
	_, _ = conn.Exec(ctx, `
		UPDATE users
		SET two_factor_enabled = (totp_secret IS NOT NULL AND totp_secret != '') OR (
			(SELECT COUNT(*) FROM user_passkeys WHERE user_id = $1) > 0
		),
		updated_at = NOW()
		WHERE id = $1
	`, userID)

	w.WriteHeader(http.StatusNoContent)
}
