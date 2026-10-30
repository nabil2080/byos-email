package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base32"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type TwoFactorStatusResponse struct {
	TwoFactorEnabled bool   `json:"two_factor_enabled"`
	HasTOTP          bool   `json:"has_totp"`
	HasPasskey       bool   `json:"has_passkey"`
	RecoveryEmail    string `json:"recovery_email,omitempty"`
	RecoveryPhone    string `json:"recovery_phone,omitempty"`
	IsOwner          bool   `json:"is_owner"`
}

type TOTPSetupResponse struct {
	Secret     string `json:"secret"`
	OTPAuthURL string `json:"otpauth_url"`
}

type TOTPVerifyRequest struct {
	Secret string `json:"secret"`
	Code   string `json:"code"`
}

type RecoveryMethodsRequest struct {
	RecoveryEmail    string `json:"recovery_email"`
	RecoveryPhone    string `json:"recovery_phone"`
	ChallengeToken   string `json:"challenge_token,omitempty"`
	VerificationCode string `json:"verification_code,omitempty"`
}

// generateTOTPSecret creates a 20-byte cryptographically secure random base32 string (no padding).
func generateTOTPSecret() (string, error) {
	buf := make([]byte, 20)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(buf), nil
}

// computeTOTP computes the RFC 6238 6-digit TOTP code for a given secret at time t.
func computeTOTP(secret string, t time.Time) (string, error) {
	// Clean secret
	secretUpper := strings.ToUpper(strings.TrimSpace(secret))
	key, err := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(secretUpper)
	if err != nil {
		// Try with standard padding
		key, err = base32.StdEncoding.DecodeString(secretUpper)
		if err != nil {
			return "", fmt.Errorf("invalid base32 secret: %w", err)
		}
	}

	counter := uint64(t.Unix() / 30)
	var buf [8]byte
	binary.BigEndian.PutUint64(buf[:], counter)

	mac := hmac.New(sha1.New, key)
	mac.Write(buf[:])
	sum := mac.Sum(nil)

	offset := sum[len(sum)-1] & 0x0F
	binaryCode := binary.BigEndian.Uint32(sum[offset:offset+4]) & 0x7FFFFFFF
	otp := binaryCode % 1000000

	return fmt.Sprintf("%06d", otp), nil
}

// validateTOTP checks the provided code against time windows (now, -30s, +30s).
func validateTOTP(secret, code string) bool {
	cleanCode := strings.TrimSpace(code)
	if len(cleanCode) != 6 {
		return false
	}
	now := time.Now()
	windows := []time.Time{
		now,
		now.Add(-30 * time.Second),
		now.Add(30 * time.Second),
	}
	for _, w := range windows {
		expected, err := computeTOTP(secret, w)
		if err == nil && hmac.Equal([]byte(cleanCode), []byte(expected)) {
			return true
		}
	}
	return false
}

// twoFactorStatusHandler handles GET /v1/auth/2fa/status
func twoFactorStatusHandler(w http.ResponseWriter, r *http.Request) {
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
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	var twoFactorEnabled bool
	var totpSecret, recEmail, recPhone *string
	var role string
	var passkeyCount int
	err = conn.QueryRow(ctx, `
		SELECT u.two_factor_enabled, u.totp_secret, u.recovery_email, u.recovery_phone, u.role,
		       (SELECT COUNT(*) FROM user_passkeys pk WHERE pk.user_id = u.id)
		FROM users u WHERE u.id=$1 AND u.is_active=true
	`, userID).Scan(&twoFactorEnabled, &totpSecret, &recEmail, &recPhone, &role, &passkeyCount)
	if err != nil {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}

	hasTOTP := totpSecret != nil && *totpSecret != ""
	hasPasskey := passkeyCount > 0
	isOwner := role == "owner"

	// Canonical rule: 2-step verification is active if and only if at least one factor (TOTP or passkey) is enrolled.
	effective2FA := hasTOTP || hasPasskey
	if twoFactorEnabled && !effective2FA {
		_, _ = conn.Exec(ctx, `UPDATE users SET two_factor_enabled=false, updated_at=NOW() WHERE id=$1`, userID)
		twoFactorEnabled = false
	}

	res := TwoFactorStatusResponse{
		TwoFactorEnabled: effective2FA,
		HasTOTP:          hasTOTP,
		HasPasskey:       hasPasskey,
		IsOwner:          isOwner,
	}
	// Recovery Verification Contacts belong strictly to organization owners
	if isOwner {
		if recEmail != nil {
			res.RecoveryEmail = *recEmail
		}
		if recPhone != nil {
			res.RecoveryPhone = *recPhone
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(res)
}

// totpSetupHandler handles POST /v1/auth/2fa/totp/setup
func totpSetupHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
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
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	var userEmail string
	err = conn.QueryRow(ctx, `SELECT email FROM users WHERE id=$1 AND is_active=true`, userID).Scan(&userEmail)
	if err != nil {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}

	secret, err := generateTOTPSecret()
	if err != nil {
		http.Error(w, "failed to generate secret", http.StatusInternalServerError)
		return
	}

	// Build otpauth URL: otpauth://totp/BYOS:user@domain.com?secret=...&issuer=BYOS
	issuer := "BYOS"
	otpauthURL := fmt.Sprintf("otpauth://totp/%s:%s?secret=%s&issuer=%s",
		url.PathEscape(issuer),
		url.PathEscape(userEmail),
		secret,
		url.QueryEscape(issuer),
	)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(TOTPSetupResponse{
		Secret:     secret,
		OTPAuthURL: otpauthURL,
	})
}

// totpVerifyHandler handles POST /v1/auth/2fa/totp/verify
func totpVerifyHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	var req TOTPVerifyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if req.Secret == "" || req.Code == "" {
		http.Error(w, "secret and 6-digit code are required", http.StatusBadRequest)
		return
	}

	if !validateTOTP(req.Secret, req.Code) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"valid": false,
			"error": "Invalid verification code. Please check the code in your authenticator app and try again.",
		})
		return
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	ctx := r.Context()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	// Persist TOTP secret and activate 2FA
	_, err = conn.Exec(ctx, `
		UPDATE users
		SET totp_secret=$1, two_factor_enabled=true, updated_at=NOW()
		WHERE id=$2 AND is_active=true
	`, strings.ToUpper(strings.TrimSpace(req.Secret)), userID)
	if err != nil {
		http.Error(w, "failed to update 2fa status", http.StatusInternalServerError)
		return
	}

	auditLog(ctx, conn, "", userID, "enable_totp_2fa", "user", userID, nil)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"valid":   true,
		"message": "Two-factor authentication successfully enabled.",
	})
}

// totpDisableHandler handles POST /v1/auth/2fa/totp/disable
func totpDisableHandler(w http.ResponseWriter, r *http.Request) {
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
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Password) == "" {
		http.Error(w, "password is required to disable 2FA", http.StatusBadRequest)
		return
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	ctx := r.Context()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	// Verify current password first
	var passwordHash string
	err = conn.QueryRow(ctx, `SELECT password_hash FROM users WHERE id=$1 AND is_active=true`, userID).Scan(&passwordHash)
	if err != nil || !verifyPassword(passwordHash, req.Password) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"error":   "Incorrect password.",
		})
		return
	}

	_, err = conn.Exec(ctx, `
		UPDATE users
		SET totp_secret=NULL,
		    two_factor_enabled=((SELECT COUNT(*) FROM user_passkeys WHERE user_id=$1) > 0),
		    updated_at=NOW()
		WHERE id=$1 AND is_active=true
	`, userID)
	if err != nil {
		http.Error(w, "failed to disable 2fa", http.StatusInternalServerError)
		return
	}

	auditLog(ctx, conn, "", userID, "disable_totp_2fa", "user", userID, nil)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Two-factor authentication disabled.",
	})
}

// recoveryMethodsHandler handles POST and GET /v1/auth/2fa/recovery-methods
func recoveryMethodsHandler(w http.ResponseWriter, r *http.Request) {
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
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	var role, userEmail string
	err = conn.QueryRow(ctx, `SELECT role, email FROM users WHERE id=$1 AND is_active=true`, userID).Scan(&role, &userEmail)
	if err != nil {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}
	if role != "owner" {
		http.Error(w, "forbidden: recovery verification contacts belong exclusively to organization owners", http.StatusForbidden)
		return
	}

	switch r.Method {
	case http.MethodGet:
		var recEmail, recPhone *string
		err = conn.QueryRow(ctx, `SELECT recovery_email, recovery_phone FROM users WHERE id=$1 AND is_active=true`, userID).Scan(&recEmail, &recPhone)
		if err != nil {
			http.Error(w, "user not found", http.StatusNotFound)
			return
		}
		var email, phone string
		if recEmail != nil {
			email = *recEmail
		}
		if recPhone != nil {
			phone = *recPhone
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"recovery_email": email,
			"recovery_phone": phone,
		})

	case http.MethodPost:
		var req RecoveryMethodsRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		newEmail := strings.TrimSpace(req.RecoveryEmail)
		newPhone := strings.TrimSpace(req.RecoveryPhone)

		if newEmail != "" && strings.EqualFold(newEmail, userEmail) {
			http.Error(w, "recovery email must be distinct from primary account email", http.StatusBadRequest)
			return
		}

		// If verification code is provided, verify it before activating
		if req.VerificationCode != "" && req.ChallengeToken != "" {
			var challengeID string
			err = conn.QueryRow(ctx, `
				SELECT id::text FROM auth_challenges
				WHERE user_id=$1 AND challenge_token=$2 AND verification_code=$3
				  AND challenge_type='verify_recovery_contact' AND expires_at > NOW()
			`, userID, strings.TrimSpace(req.ChallengeToken), strings.TrimSpace(req.VerificationCode)).Scan(&challengeID)
			if err != nil {
				http.Error(w, "invalid or expired verification code", http.StatusUnauthorized)
				return
			}
			_, _ = conn.Exec(ctx, `DELETE FROM auth_challenges WHERE id=$1`, challengeID)
		}

		_, err = conn.Exec(ctx, `
			UPDATE users
			SET recovery_email=NULLIF($1, ''), recovery_phone=NULLIF($2, ''), updated_at=NOW()
			WHERE id=$3 AND is_active=true
		`, newEmail, newPhone, userID)
		if err != nil {
			http.Error(w, "failed to update recovery methods", http.StatusInternalServerError)
			return
		}

		auditLog(ctx, conn, "", userID, "update_recovery_methods", "user", userID, map[string]interface{}{
			"has_email": newEmail != "",
			"has_phone": newPhone != "",
		})

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"message": "Recovery verification options updated.",
		})

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// recoveryContactSendCodeHandler sends a 6-digit verification code to a candidate recovery contact for owner verification.
func recoveryContactSendCodeHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
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
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	var role, userEmail string
	err = conn.QueryRow(ctx, `SELECT role, email FROM users WHERE id=$1 AND is_active=true`, userID).Scan(&role, &userEmail)
	if err != nil {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}
	if role != "owner" {
		http.Error(w, "forbidden: recovery verification contacts belong exclusively to organization owners", http.StatusForbidden)
		return
	}

	var req struct {
		Type        string `json:"type"` // "email" or "phone"
		Destination string `json:"destination"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	destination := strings.TrimSpace(req.Destination)
	if destination == "" {
		http.Error(w, "destination is required", http.StatusBadRequest)
		return
	}
	if req.Type == "email" && strings.EqualFold(destination, userEmail) {
		http.Error(w, "recovery email must be distinct from primary account email", http.StatusBadRequest)
		return
	}

	clientIP := getClientIP(r)
	tok, masked, dbg, err := DispatchOTP(ctx, conn, userID, destination, req.Type, "verify_recovery_contact", clientIP)
	if err != nil {
		log.Printf("[RECOVERY CONTACT] Dispatch failed: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	respMap := map[string]interface{}{
		"success":            true,
		"challenge_token":    tok,
		"destination_masked": masked,
	}
	if dbg != "" {
		respMap["debug_code"] = dbg
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(respMap)
}

// recoveryContactConfirmHandler verifies the OTP and activates the recovery contact on the owner account.
func recoveryContactConfirmHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
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
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	var role string
	err = conn.QueryRow(ctx, `SELECT role FROM users WHERE id=$1 AND is_active=true`, userID).Scan(&role)
	if err != nil {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}
	if role != "owner" {
		http.Error(w, "forbidden: recovery verification contacts belong exclusively to organization owners", http.StatusForbidden)
		return
	}

	var req struct {
		Type           string `json:"type"` // "email" or "phone"
		ChallengeToken string `json:"challenge_token"`
		Code           string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	_, _, dest, err := VerifyChallengeOTP(ctx, conn, req.ChallengeToken, req.Code, "verify_recovery_contact")
	if err != nil {
		if errors.Is(err, ErrMaxAttemptsExceeded) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusTooManyRequests)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"error": err.Error(),
			})
			return
		}
		http.Error(w, "invalid or expired verification code", http.StatusUnauthorized)
		return
	}

	if req.Type == "phone" {
		_, err = conn.Exec(ctx, `UPDATE users SET recovery_phone=$1, updated_at=NOW() WHERE id=$2`, dest, userID)
	} else {
		_, err = conn.Exec(ctx, `UPDATE users SET recovery_email=$1, updated_at=NOW() WHERE id=$2`, dest, userID)
	}
	if err != nil {
		http.Error(w, "failed to update recovery contact", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Recovery contact successfully verified and activated.",
	})
}

// login2FAVerifyHandler handles POST /v1/auth/2fa/verify-login
// Verifies 2FA challenge code (TOTP or Email/SMS OTP), issues authenticated session, and returns LoginResponse.
func login2FAVerifyHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		ChallengeToken string `json:"challenge_token"`
		Code           string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	challengeToken := strings.TrimSpace(req.ChallengeToken)
	code := strings.TrimSpace(req.Code)
	if challengeToken == "" || code == "" {
		http.Error(w, "challenge_token and code are required", http.StatusBadRequest)
		return
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	ctx := r.Context()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	var challengeID, userID string
	var verificationCode *string
	var expiresAt time.Time

	err = conn.QueryRow(ctx, `
		SELECT id::text, user_id::text, verification_code, expires_at
		FROM auth_challenges
		WHERE challenge_token=$1 AND challenge_type='login_2fa'
	`, challengeToken).Scan(&challengeID, &userID, &verificationCode, &expiresAt)

	if err != nil || expiresAt.Before(time.Now()) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error": "Verification session expired or invalid. Please sign in again.",
		})
		return
	}

	// 1. Check attempt counter
	_, exceeded, _ := CheckAndIncrementOTPAttempts(ctx, challengeToken)
	if exceeded {
		_, _ = conn.Exec(ctx, `DELETE FROM auth_challenges WHERE challenge_token=$1`, challengeToken)
		ClearOTPAttempts(ctx, challengeToken)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusTooManyRequests)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error": "Maximum verification attempts exceeded. Please request a new verification code.",
		})
		return
	}

	// Fetch user details & credentials
	var userEmail, orgID, displayName, role, subscriptionStatus string
	var seatCount int
	var totpSecret *string
	err = conn.QueryRow(ctx, `
		SELECT u.email, u.org_id::text, COALESCE(u.display_name,''), COALESCE(u.role, 'member'), COALESCE(o.seat_count, 1), COALESCE(o.subscription_status, 'active'), u.totp_secret
		FROM users u
		LEFT JOIN organizations o ON o.id = u.org_id
		WHERE u.id=$1 AND u.is_active=true
	`, userID).Scan(&userEmail, &orgID, &displayName, &role, &seatCount, &subscriptionStatus, &totpSecret)
	if err != nil {
		http.Error(w, "user not found or inactive", http.StatusUnauthorized)
		return
	}

	// Validate code: Check TOTP first if user has totp_secret
	valid := false
	if totpSecret != nil && *totpSecret != "" && len(code) == 6 {
		if validateTOTP(*totpSecret, code) {
			valid = true
		}
	}

	// If not matched via TOTP, check OTP verification_code using HMAC
	cfg := getOTPDeliveryConfig()
	if !valid && verificationCode != nil && *verificationCode != "" {
		if VerifyOTPHMAC(cfg.HMACSecret, challengeToken, *verificationCode, code) {
			valid = true
		}
	}

	if !valid {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error": "Invalid verification code. Please check and try again.",
		})
		return
	}

	// Clear attempts & Delete used challenge atomically
	ClearOTPAttempts(ctx, challengeToken)
	_, _ = conn.Exec(ctx, `DELETE FROM auth_challenges WHERE id=$1`, challengeID)

	// Issue session
	userAgent := r.UserAgent()
	clientIP := getClientIP(r)
	token, expires, err := createSession(ctx, conn, userID, 30*24*time.Hour, userAgent, clientIP)
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

	auditLog(ctx, conn, orgID, userID, "login_2fa", "user", userID, nil)

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

// login2FASendCodeHandler handles POST /v1/auth/2fa/send-code
// Allows resending an OTP code or switching 2FA challenge method to email or phone during login.
func login2FASendCodeHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		ChallengeToken string `json:"challenge_token"`
		Method         string `json:"method"` // "email" or "phone"
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	challengeToken := strings.TrimSpace(req.ChallengeToken)
	method := strings.ToLower(strings.TrimSpace(req.Method))
	if challengeToken == "" {
		http.Error(w, "challenge_token is required", http.StatusBadRequest)
		return
	}
	if method != "email" && method != "phone" {
		method = "email"
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	ctx := r.Context()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	var challengeID, userID string
	err = conn.QueryRow(ctx, `
		SELECT id::text, user_id::text
		FROM auth_challenges
		WHERE challenge_token=$1 AND challenge_type='login_2fa' AND expires_at > NOW()
	`, challengeToken).Scan(&challengeID, &userID)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error": "Verification session expired or invalid. Please sign in again.",
		})
		return
	}

	var userEmail string
	var recEmail, recPhone *string
	err = conn.QueryRow(ctx, `
		SELECT email, recovery_email, recovery_phone
		FROM users WHERE id=$1 AND is_active=true
	`, userID).Scan(&userEmail, &recEmail, &recPhone)
	if err != nil {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}

	var destination string
	if method == "phone" {
		if recPhone == nil || *recPhone == "" {
			http.Error(w, "recovery phone not configured", http.StatusBadRequest)
			return
		}
		destination = *recPhone
	} else {
		if recEmail != nil && *recEmail != "" {
			destination = *recEmail
		} else {
			destination = userEmail
		}
	}

	clientIP := getClientIP(r)
	cfg := getOTPDeliveryConfig()

	// 1. Rate Limiting
	if err := CheckOTPRateLimits(ctx, clientIP, destination, userID); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusTooManyRequests)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error()})
		return
	}

	// 2. Resend Cooldown (60 seconds)
	cooldownActive, remainingSecs, _ := CheckOTPCooldown(ctx, "login_2fa", destination)
	if cooldownActive {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusTooManyRequests)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":               fmt.Sprintf("Please wait %d seconds before requesting another verification code.", remainingSecs),
			"retry_after_seconds": remainingSecs,
		})
		return
	}

	// 3. Normalization & Dev allowlist check
	isPhone := method == "phone"
	normalizedDest := destination
	if isPhone {
		normalizedDest, err = NormalizeE164(destination)
		if err != nil {
			http.Error(w, "invalid phone number format", http.StatusBadRequest)
			return
		}
	} else {
		normalizedDest = strings.ToLower(strings.TrimSpace(destination))
	}
	if err := cfg.ValidateRecipient(normalizedDest, isPhone); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]interface{}{"error": err.Error()})
		return
	}

	otp, err := generateCryptographicOTP()
	if err != nil {
		http.Error(w, "failed to generate code", http.StatusInternalServerError)
		return
	}

	masked := maskRecoveryDestination(normalizedDest, method)
	expiresAt := time.Now().Add(5 * time.Minute)
	hmacDigest := ComputeOTPHMAC(cfg.HMACSecret, challengeToken, otp)

	_, err = conn.Exec(ctx, `
		UPDATE auth_challenges
		SET verification_code=$1, destination=$2, expires_at=$3
		WHERE id=$4
	`, hmacDigest, normalizedDest, expiresAt, challengeID)
	if err != nil {
		http.Error(w, "failed to update challenge", http.StatusInternalServerError)
		return
	}

	if isPhone {
		_, err = SendSMSOTP(ctx, cfg, activeSMSProvider, normalizedDest, otp, "login_2fa")
	} else {
		err = SendEmailOTP(ctx, cfg, normalizedDest, otp, "login_2fa")
	}
	if err != nil {
		http.Error(w, fmt.Sprintf("delivery failed: %v", err), http.StatusInternalServerError)
		return
	}

	RecordOTPCooldown(ctx, "login_2fa", normalizedDest)

	respMap := map[string]interface{}{
		"success":            true,
		"method":             method,
		"destination_masked": masked,
	}
	if isMockOTPDelivery() {
		respMap["debug_code"] = otp
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(respMap)
}

