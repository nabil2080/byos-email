package main

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"time"

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
	host := r.Host
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

	var email, displayName string
	err = conn.QueryRow(ctx, `SELECT email, COALESCE(display_name, email) FROM users WHERE id=$1 AND is_active=true`, userID).Scan(&email, &displayName)
	if err != nil {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}

	challenge, err := generateRandomBase64URL(32)
	if err != nil {
		http.Error(w, "failed to generate challenge", http.StatusInternalServerError)
		return
	}

	// Store challenge with 5-minute expiry
	_, err = conn.Exec(ctx, `
		INSERT INTO auth_challenges (user_id, challenge_type, challenge_token, expires_at)
		VALUES ($1, 'webauthn_register', $2, NOW() + INTERVAL '5 minutes')
	`, userID, challenge)
	if err != nil {
		http.Error(w, "failed to store challenge", http.StatusInternalServerError)
		return
	}

	rpID := getRPID(r)
	userIDBytes := []byte(userID)
	userIDB64 := base64.RawURLEncoding.EncodeToString(userIDBytes)

	resp := map[string]interface{}{
		"challenge": challenge,
		"rp": map[string]string{
			"name": "BYOS Secure Email",
			"id":   rpID,
		},
		"user": map[string]string{
			"id":          userIDB64,
			"name":        email,
			"displayName": displayName,
		},
		"pubKeyCredParams": []map[string]interface{}{
			{"type": "public-key", "alg": -7},   // ES256
			{"type": "public-key", "alg": -257}, // RS256
			{"type": "public-key", "alg": -8},   // Ed25519
		},
		"authenticatorSelection": map[string]interface{}{
			"residentKey":        "required",
			"requireResidentKey": true,
			"userVerification":   "preferred",
		},
		"timeout": 60000,
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

	var req struct {
		CredentialID   string `json:"credential_id"`
		PublicKey      string `json:"public_key"`
		DeviceName     string `json:"device_name"`
		ChallengeToken string `json:"challenge_token"`
		AAGUID         string `json:"aaguid,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	req.CredentialID = strings.TrimSpace(req.CredentialID)
	req.ChallengeToken = strings.TrimSpace(req.ChallengeToken)
	if req.CredentialID == "" || req.ChallengeToken == "" {
		http.Error(w, "credential_id and challenge_token are required", http.StatusBadRequest)
		return
	}

	deviceName := strings.TrimSpace(req.DeviceName)
	if deviceName == "" {
		deviceName = "Passkey Authenticator"
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

	// Validate challenge
	var challengeID string
	err = conn.QueryRow(ctx, `
		SELECT id::text FROM auth_challenges
		WHERE user_id=$1 AND challenge_type='webauthn_register'
		  AND challenge_token=$2 AND expires_at > NOW()
	`, userID, req.ChallengeToken).Scan(&challengeID)
	if err != nil {
		http.Error(w, "invalid or expired registration challenge", http.StatusBadRequest)
		return
	}
	_, _ = conn.Exec(ctx, `DELETE FROM auth_challenges WHERE id=$1`, challengeID)

	var item UserPasskey
	err = conn.QueryRow(ctx, `
		INSERT INTO user_passkeys (user_id, credential_id, public_key, device_name, aaguid)
		VALUES ($1, $2, $3, $4, NULLIF($5, ''))
		ON CONFLICT (credential_id) DO UPDATE
		SET device_name = EXCLUDED.device_name, public_key = EXCLUDED.public_key, last_used_at = NOW()
		RETURNING id::text, user_id::text, credential_id, public_key, counter, device_name, COALESCE(aaguid, ''), created_at
	`, userID, req.CredentialID, req.PublicKey, deviceName, req.AAGUID).Scan(
		&item.ID, &item.UserID, &item.CredentialID, &item.PublicKey, &item.Counter, &item.DeviceName, &item.AAGUID, &item.CreatedAt,
	)
	if err != nil {
		http.Error(w, "failed to store passkey", http.StatusInternalServerError)
		return
	}

	auditLog(ctx, conn, "", userID, "register_passkey", "user_passkey", item.ID, map[string]interface{}{
		"device_name": deviceName,
	})

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

	challenge, err := generateRandomBase64URL(32)
	if err != nil {
		http.Error(w, "failed to generate challenge", http.StatusInternalServerError)
		return
	}

	var targetUserID *string
	allowCredentials := make([]map[string]interface{}, 0)

	if email != "" {
		var uid string
		if err := conn.QueryRow(ctx, `SELECT id::text FROM users WHERE email=$1 AND is_active=true`, email).Scan(&uid); err == nil {
			targetUserID = &uid
			rows, err := conn.Query(ctx, `SELECT credential_id FROM user_passkeys WHERE user_id=$1`, uid)
			if err == nil {
				defer rows.Close()
				for rows.Next() {
					var credID string
					if err := rows.Scan(&credID); err == nil {
						allowCredentials = append(allowCredentials, map[string]interface{}{
							"type": "public-key",
							"id":   credID,
						})
					}
				}
			}
		}
	}

	_, err = conn.Exec(ctx, `
		INSERT INTO auth_challenges (user_id, challenge_type, challenge_token, expires_at)
		VALUES ($1, 'webauthn_login', $2, NOW() + INTERVAL '5 minutes')
	`, targetUserID, challenge)
	if err != nil {
		http.Error(w, "failed to store challenge", http.StatusInternalServerError)
		return
	}

	rpID := getRPID(r)
	resp := map[string]interface{}{
		"challenge":        challenge,
		"rpId":             rpID,
		"userVerification": "preferred",
		"timeout":          60000,
	}
	if len(allowCredentials) > 0 {
		resp["allowCredentials"] = allowCredentials
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// passkeyLoginHandler handles POST /v1/auth/passkeys/login
func passkeyLoginHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		CredentialID   string `json:"credential_id"`
		ChallengeToken string `json:"challenge_token"`
		Signature      string `json:"signature"`
		ClientDataJSON string `json:"client_data_json"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	req.CredentialID = strings.TrimSpace(req.CredentialID)
	req.ChallengeToken = strings.TrimSpace(req.ChallengeToken)
	if req.CredentialID == "" || req.ChallengeToken == "" {
		http.Error(w, "credential_id and challenge_token are required", http.StatusBadRequest)
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

	// Validate login challenge
	var challengeID string
	err = conn.QueryRow(ctx, `
		SELECT id::text FROM auth_challenges
		WHERE challenge_type='webauthn_login' AND challenge_token=$1 AND expires_at > NOW()
	`, req.ChallengeToken).Scan(&challengeID)
	if err != nil {
		http.Error(w, "invalid or expired login challenge", http.StatusUnauthorized)
		return
	}
	_, _ = conn.Exec(ctx, `DELETE FROM auth_challenges WHERE id=$1`, challengeID)

	// Find registered passkey
	var passkeyID, userID string
	err = conn.QueryRow(ctx, `
		SELECT p.id::text, p.user_id::text
		FROM user_passkeys p
		JOIN users u ON u.id = p.user_id
		WHERE p.credential_id=$1 AND u.is_active=true
	`, req.CredentialID).Scan(&passkeyID, &userID)
	if err != nil {
		http.Error(w, "passkey credential not recognized", http.StatusUnauthorized)
		return
	}

	// Update passkey last used timestamp & counter
	_, _ = conn.Exec(ctx, `
		UPDATE user_passkeys
		SET last_used_at = NOW(), counter = counter + 1
		WHERE id=$1
	`, passkeyID)

	// Fetch full user details
	var userEmail, orgID, displayName, role, plan string
	err = conn.QueryRow(ctx, `
		SELECT u.email, u.org_id::text, COALESCE(u.display_name,''), COALESCE(u.role, 'member'), COALESCE(o.plan, 'solo')
		FROM users u
		LEFT JOIN organizations o ON o.id = u.org_id
		WHERE u.id=$1 AND u.is_active=true`, userID).Scan(&userEmail, &orgID, &displayName, &role, &plan)
	if err != nil {
		http.Error(w, "user inactive or not found", http.StatusUnauthorized)
		return
	}

	// Issue standard session
	userAgent := r.UserAgent()
	ipAddress := getClientIP(r)
	token, expires, err := createSession(ctx, conn, userID, 24*time.Hour, userAgent, ipAddress)
	if err != nil {
		http.Error(w, "failed to create session", http.StatusInternalServerError)
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

	// Set session cookie
	setSessionCookie(w, r, token, expires)

	auditLog(ctx, conn, orgID, userID, "login_passkey", "user", userID, map[string]interface{}{
		"passkey_id": passkeyID,
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"token":                    token,
		"id":                       userID,
		"email":                    userEmail,
		"org_id":                   orgID,
		"organization_id":          orgID,
		"display_name":             displayName,
		"role":                     role,
		"plan":                     plan,
		"mailbox_id":               mailboxID,
		"mailbox_local_part":       mailboxLocalPart,
		"mailbox_mode":             mailboxMode,
		"wrapped_sk_user":          wrappedSkUserStr,
		"previous_wrapped_sk_user": previousWrappedSkUserStr,
		"user": map[string]interface{}{
			"id":                       userID,
			"email":                    userEmail,
			"org_id":                   orgID,
			"organization_id":          orgID,
			"display_name":             displayName,
			"role":                     role,
			"plan":                     plan,
			"mailbox_id":               mailboxID,
			"mailbox_local_part":       mailboxLocalPart,
			"mailbox_mode":             mailboxMode,
			"wrapped_sk_user":          wrappedSkUserStr,
			"previous_wrapped_sk_user": previousWrappedSkUserStr,
		},
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
	w.WriteHeader(http.StatusNoContent)
}
