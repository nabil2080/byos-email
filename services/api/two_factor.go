package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base32"
	"encoding/binary"
	"encoding/json"
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
	RecoveryEmail    string `json:"recovery_email"`
	RecoveryPhone    string `json:"recovery_phone"`
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
	RecoveryEmail string `json:"recovery_email"`
	RecoveryPhone string `json:"recovery_phone"`
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
	err = conn.QueryRow(ctx, `
		SELECT two_factor_enabled, totp_secret, recovery_email, recovery_phone
		FROM users WHERE id=$1 AND is_active=true
	`, userID).Scan(&twoFactorEnabled, &totpSecret, &recEmail, &recPhone)
	if err != nil {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}

	res := TwoFactorStatusResponse{
		TwoFactorEnabled: twoFactorEnabled,
		HasTOTP:          totpSecret != nil && *totpSecret != "",
	}
	if recEmail != nil {
		res.RecoveryEmail = *recEmail
	}
	if recPhone != nil {
		res.RecoveryPhone = *recPhone
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
		SET totp_secret=NULL, two_factor_enabled=false, updated_at=NOW()
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

		_, err = conn.Exec(ctx, `
			UPDATE users
			SET recovery_email=$1, recovery_phone=$2, updated_at=NOW()
			WHERE id=$3 AND is_active=true
		`, strings.TrimSpace(req.RecoveryEmail), strings.TrimSpace(req.RecoveryPhone), userID)
		if err != nil {
			http.Error(w, "failed to update recovery methods", http.StatusInternalServerError)
			return
		}

		auditLog(ctx, conn, "", userID, "update_recovery_methods", "user", userID, map[string]interface{}{
			"has_email": req.RecoveryEmail != "",
			"has_phone": req.RecoveryPhone != "",
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

	// Fetch user details & credentials
	var userEmail, orgID, displayName, role, plan string
	var totpSecret *string
	err = conn.QueryRow(ctx, `
		SELECT u.email, u.org_id::text, COALESCE(u.display_name,''), COALESCE(u.role, 'member'), COALESCE(o.plan, 'solo'), u.totp_secret
		FROM users u
		LEFT JOIN organizations o ON o.id = u.org_id
		WHERE u.id=$1 AND u.is_active=true
	`, userID).Scan(&userEmail, &orgID, &displayName, &role, &plan, &totpSecret)
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

	// If not matched via TOTP, check OTP verification_code
	if !valid && verificationCode != nil && *verificationCode != "" {
		if strings.TrimSpace(*verificationCode) == code {
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

	// Delete used challenge
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
		"plan":                     plan,
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

	otp, err := generate6DigitOTP()
	if err != nil {
		http.Error(w, "failed to generate code", http.StatusInternalServerError)
		return
	}

	masked := maskRecoveryDestination(destination, method)
	expiresAt := time.Now().Add(5 * time.Minute)

	_, err = conn.Exec(ctx, `
		UPDATE auth_challenges
		SET verification_code=$1, destination=$2, expires_at=$3
		WHERE id=$4
	`, otp, masked, expiresAt, challengeID)
	if err != nil {
		http.Error(w, "failed to update challenge", http.StatusInternalServerError)
		return
	}

	log.Printf("[LOGIN 2FA RESEND] %s code for %s (%s): %s", method, userEmail, masked, otp)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":            true,
		"method":             method,
		"destination_masked": masked,
		"debug_code":         otp,
	})
}

