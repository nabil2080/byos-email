package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func maskRecoveryDestination(dest, method string) string {
	dest = strings.TrimSpace(dest)
	if dest == "" {
		return "***"
	}
	if method == "email" {
		parts := strings.Split(dest, "@")
		if len(parts) != 2 {
			return "***"
		}
		name := parts[0]
		domain := parts[1]
		if len(name) <= 2 {
			return name[:1] + "***@" + domain
		}
		return name[:1] + "***" + name[len(name)-1:] + "@" + domain
	}
	if method == "phone" {
		if len(dest) <= 4 {
			return "***"
		}
		return "***-***-" + dest[len(dest)-4:]
	}
	return "Authenticator App"
}

func generate6DigitOTP() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(900000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", 100000+n.Int64()), nil
}

// recoveryFlowRequestHandler handles POST /v1/auth/recovery/request
// Initiates Tier 1 Identity Recovery by sending an OTP to recovery email/phone or challenging TOTP.
func recoveryFlowRequestHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Email  string `json:"email"`
		Method string `json:"method"` // "email", "phone", "totp"
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	email := strings.ToLower(strings.TrimSpace(req.Email))
	method := strings.ToLower(strings.TrimSpace(req.Method))
	if email == "" {
		http.Error(w, "email is required", http.StatusBadRequest)
		return
	}
	if method == "" {
		method = "email"
	}
	if method != "email" && method != "phone" && method != "totp" && method != "passkey" {
		http.Error(w, "unsupported recovery method; must be email, phone, totp, or passkey", http.StatusBadRequest)
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

	var userID, role string
	var recEmail, recPhone, totpSecret *string
	err = conn.QueryRow(ctx, `
		SELECT id::text, role, recovery_email, recovery_phone, totp_secret
		FROM users
		WHERE email=$1 AND is_active=true
	`, email).Scan(&userID, &role, &recEmail, &recPhone, &totpSecret)

	// Anti-enumeration: if user not found, generate dummy token so timing/response is indistinguishable
	if err != nil {
		dummyToken := uuid.New().String()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"challenge_token":    dummyToken,
			"method":             method,
			"destination_masked": maskRecoveryDestination("user@example.com", method),
			"expires_at":         time.Now().Add(10 * time.Minute).Format(time.RFC3339),
		})
		return
	}

	// Security invariant: Recovery verification contacts belong exclusively to organization owners.
	// Employees and non-owners are strictly forbidden from initiating password recovery via email or phone OTP.
	if (method == "email" || method == "phone") && role != "owner" {
		http.Error(w, "forbidden: recovery email and phone contacts are reserved exclusively for organization owners", http.StatusForbidden)
		return
	}

	challengeToken := uuid.New().String()
	expiresAt := time.Now().Add(10 * time.Minute)

	var mailboxID, wrappedSkUser string
	_ = conn.QueryRow(ctx, `SELECT id::text, COALESCE(wrapped_sk_user, '') FROM mailboxes WHERE user_id=$1 AND is_active=true LIMIT 1`, userID).Scan(&mailboxID, &wrappedSkUser)

	if method == "passkey" {
		var pkCount int
		_ = conn.QueryRow(ctx, `SELECT COUNT(*) FROM user_passkeys WHERE user_id=$1`, userID).Scan(&pkCount)
		if pkCount == 0 {
			http.Error(w, "no passkeys registered for this account", http.StatusBadRequest)
			return
		}
		_, err = conn.Exec(ctx, `
			INSERT INTO auth_challenges (user_id, challenge_type, challenge_token, destination, expires_at)
			VALUES ($1, 'recovery_reset_passkey', $2, 'passkey', $3)
		`, userID, challengeToken, expiresAt)
		if err != nil {
			http.Error(w, "failed to create recovery challenge", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"challenge_token":    challengeToken,
			"method":             "passkey",
			"destination_masked": "Hardware Security Key / Biometrics",
			"expires_at":         expiresAt.Format(time.RFC3339),
			"mailbox_id":         mailboxID,
			"wrapped_sk_user":    wrappedSkUser,
		})
		return
	}

	if method == "totp" {
		if totpSecret == nil || *totpSecret == "" {
			http.Error(w, "authenticator app is not configured for this account", http.StatusBadRequest)
			return
		}
		_, err = conn.Exec(ctx, `
			INSERT INTO auth_challenges (user_id, challenge_type, challenge_token, destination, expires_at)
			VALUES ($1, 'recovery_reset_totp', $2, 'authenticator_app', $3)
		`, userID, challengeToken, expiresAt)
		if err != nil {
			http.Error(w, "failed to create recovery challenge", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"challenge_token":    challengeToken,
			"method":             "totp",
			"destination_masked": "Authenticator App",
			"expires_at":         expiresAt.Format(time.RFC3339),
			"mailbox_id":         mailboxID,
			"wrapped_sk_user":    wrappedSkUser,
		})
		return
	}

	var destination string
	if method == "phone" {
		if recPhone == nil || *recPhone == "" {
			http.Error(w, "recovery phone is not configured for this account", http.StatusBadRequest)
			return
		}
		destination = *recPhone
	} else {
		// method == "email"
		if recEmail != nil && *recEmail != "" {
			destination = *recEmail
		} else {
			destination = email // fallback to account email if secondary recovery email not explicitly set
		}
	}

	clientIP := getClientIP(r)
	tok, masked, dbg, err := DispatchOTP(ctx, conn, userID, destination, method, "recovery_reset", clientIP)
	if err != nil {
		log.Printf("[RECOVERY REQUEST] Dispatch failed: %v", err)
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	respMap := map[string]interface{}{
		"challenge_token":    tok,
		"method":             method,
		"destination_masked": masked,
		"expires_at":         expiresAt.Format(time.RFC3339),
		"mailbox_id":         mailboxID,
		"wrapped_sk_user":    wrappedSkUser,
	}
	if dbg != "" {
		respMap["debug_code"] = dbg
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(respMap)
}

// recoveryFlowResetPasswordHandler handles POST /v1/auth/recovery/reset-password
// Verifies OTP/TOTP, sets the new password, archives old mailbox keys to previous_wrapped_sk_user,
// and issues a fresh session.
func recoveryFlowResetPasswordHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		ChallengeToken   string `json:"challenge_token"`
		Code             string `json:"code"`
		NewPassword      string `json:"new_password"`
		NewMailboxPk     string `json:"new_mailbox_pk"`
		NewWrappedSkUser string `json:"new_wrapped_sk_user"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	challengeToken := strings.TrimSpace(req.ChallengeToken)
	code := strings.TrimSpace(req.Code)
	newPassword := req.NewPassword

	if challengeToken == "" || code == "" {
		http.Error(w, "challenge_token and code are required", http.StatusBadRequest)
		return
	}
	if len(newPassword) < 8 || len(newPassword) > 128 {
		http.Error(w, "new_password must be between 8 and 128 characters", http.StatusBadRequest)
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

	var challengeID, userID, challengeType string
	var expectedCode *string
	err = conn.QueryRow(ctx, `
		SELECT id::text, user_id::text, challenge_type, verification_code
		FROM auth_challenges
		WHERE challenge_token=$1 AND expires_at > NOW()
	`, challengeToken).Scan(&challengeID, &userID, &challengeType, &expectedCode)
	if err != nil {
		http.Error(w, "invalid or expired recovery challenge", http.StatusBadRequest)
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

	// Verify verification code based on challenge type
	if challengeType == "recovery_reset_totp" {
		var totpSecret *string
		err = conn.QueryRow(ctx, `SELECT totp_secret FROM users WHERE id=$1`, userID).Scan(&totpSecret)
		if err != nil || totpSecret == nil || !validateTOTP(*totpSecret, code) {
			http.Error(w, "invalid authenticator code", http.StatusUnauthorized)
			return
		}
	} else if challengeType == "recovery_reset_passkey" {
		var passkeyFound bool
		err = conn.QueryRow(ctx, `
			SELECT EXISTS(SELECT 1 FROM user_passkeys WHERE user_id=$1 AND (credential_id=$2 OR id::text=$2))
		`, userID, code).Scan(&passkeyFound)
		if err != nil || !passkeyFound {
			http.Error(w, "invalid or unrecognized passkey verification", http.StatusUnauthorized)
			return
		}
	} else if challengeType == "recovery_reset" {
		cfg := getOTPDeliveryConfig()
		if expectedCode == nil || !VerifyOTPHMAC(cfg.HMACSecret, challengeToken, *expectedCode, code) {
			http.Error(w, "invalid verification code", http.StatusUnauthorized)
			return
		}
	} else {
		http.Error(w, "unsupported challenge type", http.StatusBadRequest)
		return
	}

	// Clear attempts and delete challenge immediately to prevent reuse
	ClearOTPAttempts(ctx, challengeToken)
	_, _ = conn.Exec(ctx, `DELETE FROM auth_challenges WHERE id=$1`, challengeID)

	// Hash new password
	hash, err := hashPassword(newPassword)
	if err != nil {
		http.Error(w, "failed to hash password", http.StatusInternalServerError)
		return
	}

	tx, err := conn.Begin(ctx)
	if err != nil {
		http.Error(w, "failed to start transaction", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	// Canonical Lock Order: 1. Lock all active mailbox parent rows for this user FIRST
	mRows, err := tx.Query(ctx, `
		SELECT id::text
		FROM mailboxes
		WHERE user_id = $1 AND is_active = true
		FOR UPDATE
	`, userID)
	if err != nil {
		http.Error(w, "failed to lock mailboxes", http.StatusInternalServerError)
		return
	}
	var userMailboxIDs []string
	for mRows.Next() {
		var mID string
		if err := mRows.Scan(&mID); err == nil {
			userMailboxIDs = append(userMailboxIDs, mID)
		}
	}
	mRows.Close()

	// Update user password
	var orgID, userEmail string
	err = tx.QueryRow(ctx, `
		UPDATE users
		SET password_hash=$1
		WHERE id=$2 AND is_active=true
		RETURNING org_id::text, email
	`, hash, userID).Scan(&orgID, &userEmail)
	if err != nil {
		http.Error(w, "user not found or inactive", http.StatusBadRequest)
		return
	}

	newMailboxPk := strings.TrimSpace(req.NewMailboxPk)
	newWrappedSkUser := strings.TrimSpace(req.NewWrappedSkUser)

	if newWrappedSkUser != "" {
		if newMailboxPk != "" {
			pkBytes, err := hex.DecodeString(newMailboxPk)
			if err == nil && len(pkBytes) == 32 {
				_, err = tx.Exec(ctx, `
					UPDATE mailboxes
					SET previous_wrapped_sk_user = CASE 
					        WHEN wrapped_sk_user IS NOT NULL AND wrapped_sk_user != '' AND wrapped_sk_user != $1 THEN wrapped_sk_user 
					        ELSE previous_wrapped_sk_user 
					    END,
					    previous_key_archived_at = CASE
					        WHEN wrapped_sk_user IS NOT NULL AND wrapped_sk_user != '' AND wrapped_sk_user != $1 THEN NOW()
					        ELSE previous_key_archived_at
					    END,
					    wrapped_sk_user = $1,
					    mailbox_sk_wrapped = $2,
					    mailbox_pk = $3,
					    updated_at = NOW()
					WHERE user_id = $4 AND is_active = true
				`, newWrappedSkUser, []byte(newWrappedSkUser), pkBytes, userID)
			} else {
				_, err = tx.Exec(ctx, `
					UPDATE mailboxes
					SET previous_wrapped_sk_user = CASE 
					        WHEN wrapped_sk_user IS NOT NULL AND wrapped_sk_user != '' AND wrapped_sk_user != $1 THEN wrapped_sk_user 
					        ELSE previous_wrapped_sk_user 
					    END,
					    previous_key_archived_at = CASE
					        WHEN wrapped_sk_user IS NOT NULL AND wrapped_sk_user != '' AND wrapped_sk_user != $1 THEN NOW()
					        ELSE previous_key_archived_at
					    END,
					    wrapped_sk_user = $1,
					    mailbox_sk_wrapped = $2,
					    updated_at = NOW()
					WHERE user_id = $3 AND is_active = true
				`, newWrappedSkUser, []byte(newWrappedSkUser), userID)
			}
		} else {
			// Re-wrapped existing key: clears previous_wrapped_sk_user because historical keys are now unlocked under new password
			_, err = tx.Exec(ctx, `
				UPDATE mailboxes
				SET wrapped_sk_user = $1,
				    mailbox_sk_wrapped = $2,
				    previous_wrapped_sk_user = NULL,
				    previous_key_archived_at = NULL,
				    updated_at = NOW()
				WHERE user_id = $3 AND is_active = true
			`, newWrappedSkUser, []byte(newWrappedSkUser), userID)
		}
	} else {
		// Proton Sweet Spot Rule: Archive current wrapped_sk_user into previous_wrapped_sk_user
		// The mailbox keys are safely preserved, but historical messages remain locked
		// until unlocked by 24-word recovery phrase or old password.
		_, err = tx.Exec(ctx, `
			UPDATE mailboxes
			SET previous_wrapped_sk_user = CASE 
			        WHEN wrapped_sk_user IS NOT NULL AND wrapped_sk_user != '' THEN wrapped_sk_user 
			        ELSE previous_wrapped_sk_user 
			    END,
			    previous_key_archived_at = NOW(),
			    wrapped_sk_user = NULL,
			    updated_at = NOW()
			WHERE user_id = $1 AND is_active = true
		`, userID)
	}
	if err != nil {
		http.Error(w, "failed to update mailbox key material", http.StatusInternalServerError)
		return
	}

	// Canonical Lock Order: 2. Lock & invalidate pending reactivation child rows SECOND
	if len(userMailboxIDs) > 0 {
		_, err = tx.Exec(ctx, `
			UPDATE mailbox_key_reactivations
			SET status = 'rolled_back', rolled_back_at = NOW(), rollback_reason = 'password_reset_during_pending'
			WHERE user_id = $1 AND mailbox_id = ANY($2::uuid[]) AND status = 'pending'
		`, userID, userMailboxIDs)
	} else {
		_, err = tx.Exec(ctx, `
			UPDATE mailbox_key_reactivations
			SET status = 'rolled_back', rolled_back_at = NOW(), rollback_reason = 'password_reset_during_pending'
			WHERE user_id = $1 AND status = 'pending'
		`, userID)
	}
	if err != nil {
		http.Error(w, "failed to invalidate pending key reactivations", http.StatusInternalServerError)
		return
	}

	// Revoke all existing sessions for this user
	_, _ = tx.Exec(ctx, `UPDATE sessions SET revoked_at=NOW() WHERE user_id=$1`, userID)

	// Fetch mailbox info
	var mailboxID, mailboxLocalPart, mailboxMode string
	var currentWrappedSkUser, previousWrappedSkUser *string
	_ = tx.QueryRow(ctx, `
		SELECT id::text, local_part, mode, wrapped_sk_user, previous_wrapped_sk_user
		FROM mailboxes
		WHERE user_id=$1 AND is_active=true
		LIMIT 1
	`, userID).Scan(&mailboxID, &mailboxLocalPart, &mailboxMode, &currentWrappedSkUser, &previousWrappedSkUser)

	var role, subscriptionStatus string
	var seatCount int
	_ = tx.QueryRow(ctx, `
		SELECT COALESCE(u.role, 'member'), COALESCE(o.seat_count, 1), COALESCE(o.subscription_status, 'active')
		FROM users u
		LEFT JOIN organizations o ON o.id = u.org_id
		WHERE u.id=$1
	`, userID).Scan(&role, &seatCount, &subscriptionStatus)

	// Issue fresh session
	userAgent := r.UserAgent()
	ipAddress := getClientIP(r)
	token, expires, err := createSession(ctx, conn, userID, 24*time.Hour, userAgent, ipAddress)
	if err != nil {
		http.Error(w, "failed to create session", http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "failed to commit transaction", http.StatusInternalServerError)
		return
	}

	auditLog(ctx, conn, orgID, userID, "recovery_reset_password", "user", userID, map[string]interface{}{
		"email": userEmail,
	})

	setSessionCookie(w, r, token, expires)

	currWskStr := ""
	if currentWrappedSkUser != nil {
		currWskStr = *currentWrappedSkUser
	}
	prevWskStr := ""
	if previousWrappedSkUser != nil {
		prevWskStr = *previousWrappedSkUser
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"token":                    token,
		"id":                       userID,
		"email":                    userEmail,
		"org_id":                   orgID,
		"organization_id":          orgID,
		"role":                     role,
		"seat_count":               seatCount,
		"subscription_status":      subscriptionStatus,
		"mailbox_id":               mailboxID,
		"mailbox_local_part":       mailboxLocalPart,
		"mailbox_mode":             mailboxMode,
		"wrapped_sk_user":          currWskStr,
		"previous_wrapped_sk_user": prevWskStr,
		"user": map[string]interface{}{
			"id":                       userID,
			"email":                    userEmail,
			"org_id":                   orgID,
			"organization_id":          orgID,
			"role":                     role,
			"seat_count":               seatCount,
			"subscription_status":      subscriptionStatus,
			"mailbox_id":               mailboxID,
			"mailbox_local_part":       mailboxLocalPart,
			"mailbox_mode":             mailboxMode,
			"wrapped_sk_user":          currWskStr,
			"previous_wrapped_sk_user": prevWskStr,
		},
	})
}

// validateCandidateWrappedSk validates candidate key envelope format before database modification.
func validateCandidateWrappedSk(wrappedSkUser string) error {
	trimmed := strings.TrimSpace(wrappedSkUser)
	if trimmed == "" {
		return fmt.Errorf("wrapped_sk_user is required")
	}
	// Normalize escaped JSON if wrapped in escaped quotes
	normalized := trimmed
	if strings.Contains(normalized, `\"`) {
		normalized = strings.ReplaceAll(normalized, `\"`, `"`)
		normalized = strings.TrimPrefix(normalized, `"`)
		normalized = strings.TrimSuffix(normalized, `"`)
	}
	if strings.HasPrefix(normalized, "{") {
		var parsed map[string]interface{}
		if err := json.Unmarshal([]byte(normalized), &parsed); err != nil {
			return fmt.Errorf("malformed candidate envelope: invalid JSON")
		}
		hasSalt := false
		if s, ok := parsed["salt"].(string); ok && strings.TrimSpace(s) != "" {
			hasSalt = true
		} else if s, ok := parsed["salt_hex"].(string); ok && strings.TrimSpace(s) != "" {
			hasSalt = true
		}
		hasEnvelope := false
		if e, ok := parsed["envelope"].(string); ok && strings.TrimSpace(e) != "" {
			hasEnvelope = true
		} else if e, ok := parsed["envelope_hex"].(string); ok && strings.TrimSpace(e) != "" {
			hasEnvelope = true
		}
		hasRoot := false
		if r, ok := parsed["root_wrapped"].(string); ok && strings.TrimSpace(r) != "" {
			hasRoot = true
		}
		if !(hasSalt && hasEnvelope) && !hasRoot {
			return fmt.Errorf("malformed candidate envelope: missing required fields")
		}
		return nil
	}
	if strings.Contains(trimmed, ":") {
		parts := strings.Split(trimmed, ":")
		if len(parts) != 2 || strings.TrimSpace(parts[0]) == "" || strings.TrimSpace(parts[1]) == "" {
			return fmt.Errorf("malformed candidate envelope: invalid salt:envelope pair")
		}
		return nil
	}
	if len(trimmed) >= 32 {
		return nil
	}
	return fmt.Errorf("malformed candidate envelope: unsupported format")
}

// mailboxReactivateKeysPrepareHandler handles POST /v1/mailboxes/{mailbox_id}/reactivate-keys/prepare
// Staged Historical-Key Reactivation Protocol: Step 1 (Prepare)
// Validates mailbox ownership, candidate envelope structure, preserves active and historical envelopes,
// and creates a pending reactivation record with a documented 10-minute expiry.
func mailboxReactivateKeysPrepareHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	mailboxID := r.PathValue("mailbox_id")
	if mailboxID == "" {
		mailboxID = r.PathValue("id")
	}
	if mailboxID == "" {
		http.Error(w, "mailbox_id is required", http.StatusBadRequest)
		return
	}

	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		WrappedSkUser string `json:"wrapped_sk_user"`
		MailboxPk     string `json:"mailbox_pk"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	wrappedSkUser := strings.TrimSpace(req.WrappedSkUser)
	if wrappedSkUser == "" {
		http.Error(w, "wrapped_sk_user is required", http.StatusBadRequest)
		return
	}

	if err := validateCandidateWrappedSk(wrappedSkUser); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	var pkBytes []byte
	mailboxPk := strings.TrimSpace(req.MailboxPk)
	if mailboxPk != "" {
		b, err := hex.DecodeString(mailboxPk)
		if err == nil && len(b) == 32 {
			pkBytes = b
		}
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

	tx, err := conn.Begin(ctx)
	if err != nil {
		http.Error(w, "failed to start transaction", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	// Canonical Lock Order: Mailbox FIRST
	var mailboxUserID string
	var isActive bool
	var activeWrappedSk string
	var prevWrappedSk *string
	err = tx.QueryRow(ctx, `
		SELECT user_id::text, is_active, COALESCE(wrapped_sk_user, ''), previous_wrapped_sk_user
		FROM mailboxes
		WHERE id = $1
		FOR UPDATE
	`, mailboxID).Scan(&mailboxUserID, &isActive, &activeWrappedSk, &prevWrappedSk)
	if err != nil {
		if err == pgx.ErrNoRows {
			http.Error(w, "mailbox not found", http.StatusNotFound)
			return
		}
		http.Error(w, "database query failed", http.StatusInternalServerError)
		return
	}

	if mailboxUserID != userID {
		http.Error(w, "forbidden: only the mailbox owner can reactivate or replace mailbox cryptographic keys", http.StatusForbidden)
		return
	}

	if !isActive {
		http.Error(w, "forbidden: mailbox is deactivated", http.StatusForbidden)
		return
	}

	if prevWrappedSk == nil || strings.TrimSpace(*prevWrappedSk) == "" {
		http.Error(w, "no historical key material to reactivate", http.StatusBadRequest)
		return
	}

	// Canonical Lock Order: Pending Reactivation Child row SECOND
	var existingMigID string
	var existingCand string
	var existingExp time.Time
	err = tx.QueryRow(ctx, `
		SELECT id::text, candidate_wrapped_sk, expires_at
		FROM mailbox_key_reactivations
		WHERE mailbox_id = $1 AND status = 'pending'
		FOR UPDATE
	`, mailboxID).Scan(&existingMigID, &existingCand, &existingExp)

	if err != nil && err != pgx.ErrNoRows {
		log.Printf("[reactivate-keys:prepare] query existing reactivation failed: %v", err)
		http.Error(w, "database query failed", http.StatusInternalServerError)
		return
	}

	if err == nil {
		now := time.Now()
		if existingExp.Before(now) {
			// Expired pending record: roll it back opportunistically
			_, _ = tx.Exec(ctx, `
				UPDATE mailbox_key_reactivations
				SET status = 'rolled_back', rolled_back_at = $1, rollback_reason = 'ttl_expired_opportunistic'
				WHERE id = $2
			`, now, existingMigID)
		} else if existingCand == wrappedSkUser {
			// Idempotent retry: exact same candidate submitted before expiry!
			if err := tx.Commit(ctx); err != nil {
				http.Error(w, "failed to commit transaction", http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{
				"migration_id": existingMigID,
				"mailbox_id":   mailboxID,
				"status":       "pending",
				"expires_at":   existingExp.Format(time.RFC3339),
			})
			return
		} else {
			// Superseded by new candidate preparation
			_, _ = tx.Exec(ctx, `
				UPDATE mailbox_key_reactivations
				SET status = 'rolled_back', rolled_back_at = $1, rollback_reason = 'superseded_by_new_preparation'
				WHERE id = $2
			`, now, existingMigID)
		}
	}

	var newMigID string
	var expiresAt time.Time
	err = tx.QueryRow(ctx, `
		INSERT INTO mailbox_key_reactivations (
			mailbox_id, user_id, candidate_wrapped_sk, candidate_mailbox_pk, status, expires_at
		) VALUES ($1, $2, $3, $4, 'pending', NOW() + INTERVAL '10 minutes')
		RETURNING id::text, expires_at
	`, mailboxID, userID, wrappedSkUser, pkBytes).Scan(&newMigID, &expiresAt)
	if err != nil {
		http.Error(w, "failed to create pending reactivation", http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "failed to commit transaction", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"migration_id": newMigID,
		"mailbox_id":   mailboxID,
		"status":       "pending",
		"expires_at":   expiresAt.Format(time.RFC3339),
	})
}

// mailboxReactivateKeysPendingHandler handles GET /v1/mailboxes/{mailbox_id}/reactivate-keys/pending
// and GET /v1/mailboxes/{mailbox_id}/reactivate-keys/{migration_id}
// Staged Historical-Key Reactivation Protocol: Step 2 (Read Back)
// Returns the exact server-stored candidate envelope to the authenticated mailbox owner for client-side WASM verification.
func mailboxReactivateKeysPendingHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	mailboxID := r.PathValue("mailbox_id")
	if mailboxID == "" {
		mailboxID = r.PathValue("id")
	}
	if mailboxID == "" {
		http.Error(w, "mailbox_id is required", http.StatusBadRequest)
		return
	}

	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	migrationID := r.PathValue("migration_id")
	if migrationID == "" || migrationID == "pending" {
		migrationID = r.URL.Query().Get("migration_id")
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

	// Validate mailbox ownership
	var mailboxUserID string
	var isActive bool
	err = conn.QueryRow(ctx, `SELECT user_id::text, is_active FROM mailboxes WHERE id = $1`, mailboxID).Scan(&mailboxUserID, &isActive)
	if err != nil {
		if err == pgx.ErrNoRows {
			http.Error(w, "mailbox not found", http.StatusNotFound)
			return
		}
		http.Error(w, "database query failed", http.StatusInternalServerError)
		return
	}
	if mailboxUserID != userID {
		http.Error(w, "forbidden: only the mailbox owner can access pending reactivation", http.StatusForbidden)
		return
	}
	if !isActive {
		http.Error(w, "forbidden: mailbox is deactivated", http.StatusForbidden)
		return
	}

	var migID, recUserID, candWrapped, status string
	var candPk []byte
	var expiresAt time.Time

	if migrationID != "" && migrationID != "pending" {
		err = conn.QueryRow(ctx, `
			SELECT id::text, user_id::text, candidate_wrapped_sk, candidate_mailbox_pk, status, expires_at
			FROM mailbox_key_reactivations
			WHERE id = $1 AND mailbox_id = $2
		`, migrationID, mailboxID).Scan(&migID, &recUserID, &candWrapped, &candPk, &status, &expiresAt)
	} else {
		err = conn.QueryRow(ctx, `
			SELECT id::text, user_id::text, candidate_wrapped_sk, candidate_mailbox_pk, status, expires_at
			FROM mailbox_key_reactivations
			WHERE mailbox_id = $1 AND user_id = $2 AND status = 'pending'
			ORDER BY created_at DESC
			LIMIT 1
		`, mailboxID, userID).Scan(&migID, &recUserID, &candWrapped, &candPk, &status, &expiresAt)
	}

	if err != nil {
		if err == pgx.ErrNoRows {
			http.Error(w, "no pending key reactivation found", http.StatusNotFound)
			return
		}
		http.Error(w, "database query failed", http.StatusInternalServerError)
		return
	}

	if recUserID != userID {
		http.Error(w, "forbidden: only the operation owner can read pending candidate envelope", http.StatusForbidden)
		return
	}

	if status == "pending" && expiresAt.Before(time.Now()) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusGone)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":        "pending reactivation expired",
			"status":       "expired",
			"migration_id": migID,
		})
		return
	}

	var pkHex string
	if len(candPk) > 0 {
		pkHex = hex.EncodeToString(candPk)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"migration_id":         migID,
		"mailbox_id":           mailboxID,
		"status":               status,
		"candidate_wrapped_sk": candWrapped,
		"candidate_mailbox_pk": pkHex,
		"expires_at":           expiresAt.Format(time.RFC3339),
	})
}

// mailboxReactivateKeysFinalizeHandler handles POST /v1/mailboxes/{mailbox_id}/reactivate-keys/finalize
// Staged Historical-Key Reactivation Protocol: Step 3 (Finalize)
// Performs one atomic transaction with mailbox-first lock ordering that:
// - Rechecks mailbox ownership and active status.
// - Locks mailbox and pending reactivation record.
// - Verifies that it is still pending and unexpired.
// - Promotes candidate envelope to wrapped_sk_user.
// - Clears previous_wrapped_sk_user.
// - Marks the pending operation finalized.
// - Commits all changes atomically.
func mailboxReactivateKeysFinalizeHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	mailboxID := r.PathValue("mailbox_id")
	if mailboxID == "" {
		mailboxID = r.PathValue("id")
	}
	if mailboxID == "" {
		http.Error(w, "mailbox_id is required", http.StatusBadRequest)
		return
	}

	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		MigrationID string `json:"migration_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	req.MigrationID = strings.TrimSpace(req.MigrationID)
	if req.MigrationID == "" {
		http.Error(w, "migration_id is required", http.StatusBadRequest)
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

	tx, err := conn.Begin(ctx)
	if err != nil {
		http.Error(w, "failed to start transaction", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	// Canonical Lock Order: 1. Mailbox row FIRST
	var mailboxUserID string
	var isActive bool
	var activeWrappedSk string
	var prevWrappedSk *string
	err = tx.QueryRow(ctx, `
		SELECT user_id::text, is_active, COALESCE(wrapped_sk_user, ''), previous_wrapped_sk_user
		FROM mailboxes
		WHERE id = $1
		FOR UPDATE
	`, mailboxID).Scan(&mailboxUserID, &isActive, &activeWrappedSk, &prevWrappedSk)
	if err != nil {
		if err == pgx.ErrNoRows {
			http.Error(w, "mailbox not found", http.StatusNotFound)
			return
		}
		http.Error(w, "database query failed", http.StatusInternalServerError)
		return
	}

	if mailboxUserID != userID {
		http.Error(w, "forbidden: only the mailbox owner can finalize key reactivation", http.StatusForbidden)
		return
	}

	if !isActive {
		http.Error(w, "forbidden: mailbox is deactivated", http.StatusForbidden)
		return
	}

	// Canonical Lock Order: 2. Pending Reactivation Child row SECOND
	var migID, recUserID, status, candWrapped string
	var candPk []byte
	var expiresAt time.Time
	err = tx.QueryRow(ctx, `
		SELECT id::text, user_id::text, status, candidate_wrapped_sk, candidate_mailbox_pk, expires_at
		FROM mailbox_key_reactivations
		WHERE id = $1 AND mailbox_id = $2
		FOR UPDATE
	`, req.MigrationID, mailboxID).Scan(&migID, &recUserID, &status, &candWrapped, &candPk, &expiresAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			http.Error(w, "reactivation record not found", http.StatusNotFound)
			return
		}
		http.Error(w, "database query failed", http.StatusInternalServerError)
		return
	}

	if recUserID != userID {
		http.Error(w, "forbidden: only the operation owner can finalize reactivation", http.StatusForbidden)
		return
	}

	// Idempotent retry: if already finalized, return 200 OK
	if status == "finalized" {
		_ = tx.Commit(ctx)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":      true,
			"migration_id": migID,
			"mailbox_id":   mailboxID,
			"status":       "finalized",
			"message":      "Historical key material successfully reactivated",
		})
		return
	}

	if status == "rolled_back" {
		http.Error(w, "cannot finalize a rolled back reactivation", http.StatusConflict)
		return
	}

	if status != "pending" {
		http.Error(w, "invalid reactivation status: "+status, http.StatusConflict)
		return
	}

	now := time.Now()
	if expiresAt.Before(now) {
		// Operation expired: mark rolled back safely and reject
		_, _ = tx.Exec(ctx, `
			UPDATE mailbox_key_reactivations
			SET status = 'rolled_back', rolled_back_at = $1, rollback_reason = 'ttl_expired_at_finalization'
			WHERE id = $2
		`, now, migID)
		_ = tx.Commit(ctx)
		http.Error(w, "reactivation operation expired and was rolled back", http.StatusConflict)
		return
	}

	if prevWrappedSk == nil || strings.TrimSpace(*prevWrappedSk) == "" {
		http.Error(w, "no historical key material to reactivate", http.StatusConflict)
		return
	}

	// Promote candidate envelope to wrapped_sk_user and clear previous_wrapped_sk_user
	if len(candPk) == 32 {
		_, err = tx.Exec(ctx, `
			UPDATE mailboxes
			SET wrapped_sk_user = $1,
			    mailbox_sk_wrapped = $2,
			    mailbox_pk = $3,
			    previous_wrapped_sk_user = NULL,
			    previous_key_archived_at = NULL,
			    updated_at = $4
			WHERE id = $5 AND user_id = $6
		`, candWrapped, []byte(candWrapped), candPk, now, mailboxID, userID)
	} else {
		_, err = tx.Exec(ctx, `
			UPDATE mailboxes
			SET wrapped_sk_user = $1,
			    mailbox_sk_wrapped = $2,
			    previous_wrapped_sk_user = NULL,
			    previous_key_archived_at = NULL,
			    updated_at = $3
			WHERE id = $4 AND user_id = $5
		`, candWrapped, []byte(candWrapped), now, mailboxID, userID)
	}
	if err != nil {
		http.Error(w, "failed to promote candidate key envelope", http.StatusInternalServerError)
		return
	}

	// Mark pending record finalized
	_, err = tx.Exec(ctx, `
		UPDATE mailbox_key_reactivations
		SET status = 'finalized', finalized_at = $1
		WHERE id = $2
	`, now, migID)
	if err != nil {
		http.Error(w, "failed to finalize reactivation record", http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "failed to commit finalization transaction", http.StatusInternalServerError)
		return
	}

	auditLog(ctx, conn, "", userID, "reactivate_mailbox_keys_finalized", "mailbox", mailboxID, map[string]interface{}{
		"migration_id": migID,
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":      true,
		"migration_id": migID,
		"mailbox_id":   mailboxID,
		"status":       "finalized",
		"message":      "Historical key material successfully reactivated",
	})
}

// mailboxReactivateKeysRollbackHandler handles POST /v1/mailboxes/{mailbox_id}/reactivate-keys/rollback
// Staged Historical-Key Reactivation Protocol: Step 4 (Rollback)
// Safely cancels/invalidates a pending reactivation:
// - Preserves active envelope.
// - Preserves previous_wrapped_sk_user.
// - Invalidates only the pending candidate.
// - Idempotent on repeated calls.
func mailboxReactivateKeysRollbackHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	mailboxID := r.PathValue("mailbox_id")
	if mailboxID == "" {
		mailboxID = r.PathValue("id")
	}
	if mailboxID == "" {
		http.Error(w, "mailbox_id is required", http.StatusBadRequest)
		return
	}

	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		MigrationID string `json:"migration_id"`
		Reason      string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	req.MigrationID = strings.TrimSpace(req.MigrationID)
	if req.MigrationID == "" {
		http.Error(w, "migration_id is required", http.StatusBadRequest)
		return
	}

	reason := strings.TrimSpace(req.Reason)
	if reason == "" {
		reason = "client_requested_rollback"
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

	tx, err := conn.Begin(ctx)
	if err != nil {
		http.Error(w, "failed to start transaction", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	// Canonical Lock Order: 1. Mailbox row FIRST
	var mailboxUserID string
	err = tx.QueryRow(ctx, `
		SELECT user_id::text
		FROM mailboxes
		WHERE id = $1
		FOR UPDATE
	`, mailboxID).Scan(&mailboxUserID)
	if err != nil {
		if err == pgx.ErrNoRows {
			http.Error(w, "mailbox not found", http.StatusNotFound)
			return
		}
		http.Error(w, "database query failed", http.StatusInternalServerError)
		return
	}

	if mailboxUserID != userID {
		http.Error(w, "forbidden: only the mailbox owner can roll back key reactivation", http.StatusForbidden)
		return
	}

	// Canonical Lock Order: 2. Pending Reactivation Child row SECOND
	var migID, recUserID, status string
	var rolledBackAt *time.Time
	err = tx.QueryRow(ctx, `
		SELECT id::text, user_id::text, status, rolled_back_at
		FROM mailbox_key_reactivations
		WHERE id = $1 AND mailbox_id = $2
		FOR UPDATE
	`, req.MigrationID, mailboxID).Scan(&migID, &recUserID, &status, &rolledBackAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			http.Error(w, "reactivation record not found", http.StatusNotFound)
			return
		}
		http.Error(w, "database query failed", http.StatusInternalServerError)
		return
	}

	if recUserID != userID {
		http.Error(w, "forbidden: only the operation owner can roll back reactivation", http.StatusForbidden)
		return
	}

	// Idempotent: already rolled back
	if status == "rolled_back" {
		_ = tx.Commit(ctx)
		w.Header().Set("Content-Type", "application/json")
		var rStr string
		if rolledBackAt != nil {
			rStr = rolledBackAt.Format(time.RFC3339)
		}
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":      true,
			"migration_id": migID,
			"mailbox_id":   mailboxID,
			"status":       "rolled_back",
			"restored_at":  rStr,
		})
		return
	}

	if status == "finalized" {
		http.Error(w, "cannot roll back a finalized migration", http.StatusConflict)
		return
	}

	now := time.Now()
	_, err = tx.Exec(ctx, `
		UPDATE mailbox_key_reactivations
		SET status = 'rolled_back', rolled_back_at = $1, rollback_reason = $2
		WHERE id = $3
	`, now, reason, migID)
	if err != nil {
		http.Error(w, "failed to roll back reactivation record", http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "failed to commit rollback transaction", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":      true,
		"migration_id": migID,
		"mailbox_id":   mailboxID,
		"status":       "rolled_back",
		"restored_at":  now.Format(time.RFC3339),
	})
}

// mailboxReactivateKeysHandler handles /v1/mailboxes/{mailbox_id}/reactivate-keys
// Provides full backward-compatibility and routes staged operations:
// - GET: routes to mailboxReactivateKeysPendingHandler
// - POST with migration_id: routes to mailboxReactivateKeysFinalizeHandler
// - POST with wrapped_sk_user: executes staged prepare + atomic finalize
func mailboxReactivateKeysHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		mailboxReactivateKeysPendingHandler(w, r)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	mailboxID := r.PathValue("mailbox_id")
	if mailboxID == "" {
		mailboxID = r.PathValue("id")
	}
	if mailboxID == "" {
		http.Error(w, "mailbox_id is required", http.StatusBadRequest)
		return
	}

	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		MigrationID   string `json:"migration_id"`
		WrappedSkUser string `json:"wrapped_sk_user"`
		MailboxPk     string `json:"mailbox_pk"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	wrappedSkUser := strings.TrimSpace(req.WrappedSkUser)
	if wrappedSkUser == "" && strings.TrimSpace(req.MigrationID) == "" {
		http.Error(w, "wrapped_sk_user or migration_id is required", http.StatusBadRequest)
		return
	}

	if strings.TrimSpace(req.MigrationID) != "" {
		// Route to finalizer
		// Synthesize finalize request
		finReqBody, _ := json.Marshal(map[string]string{"migration_id": strings.TrimSpace(req.MigrationID)})
		r2, _ := http.NewRequestWithContext(r.Context(), http.MethodPost, r.URL.String(), strings.NewReader(string(finReqBody)))
		r2.SetPathValue("mailbox_id", mailboxID)
		for _, cookie := range r.Cookies() {
			r2.AddCookie(cookie)
		}
		mailboxReactivateKeysFinalizeHandler(w, r2)
		return
	}

	mailboxPk := strings.TrimSpace(req.MailboxPk)

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

	// Validate mailbox existence and ownership
	var mailboxUserID string
	err = conn.QueryRow(ctx, `SELECT user_id::text FROM mailboxes WHERE id = $1 AND is_active = true`, mailboxID).Scan(&mailboxUserID)
	if err != nil {
		if err == pgx.ErrNoRows {
			http.Error(w, "mailbox not found", http.StatusNotFound)
			return
		}
		http.Error(w, "database query failed", http.StatusInternalServerError)
		return
	}

	if mailboxUserID != userID {
		http.Error(w, "forbidden: only the mailbox owner can reactivate or replace mailbox cryptographic keys", http.StatusForbidden)
		return
	}

	if err := validateCandidateWrappedSk(wrappedSkUser); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	var pkBytes []byte
	if mailboxPk != "" {
		b, err := hex.DecodeString(mailboxPk)
		if err == nil && len(b) == 32 {
			pkBytes = b
		}
	}

	// Atomic staged execution: locks mailbox, creates record, promotes candidate
	tx, err := conn.Begin(ctx)
	if err != nil {
		http.Error(w, "failed to start transaction", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	var lockedUserID string
	var isActive bool
	err = tx.QueryRow(ctx, `SELECT user_id::text, is_active FROM mailboxes WHERE id = $1 FOR UPDATE`, mailboxID).Scan(&lockedUserID, &isActive)
	if err != nil || lockedUserID != userID || !isActive {
		http.Error(w, "mailbox not found or unauthorized", http.StatusForbidden)
		return
	}

	now := time.Now()
	var migID string
	err = tx.QueryRow(ctx, `
		INSERT INTO mailbox_key_reactivations (
			mailbox_id, user_id, candidate_wrapped_sk, candidate_mailbox_pk, status, expires_at, finalized_at
		) VALUES ($1, $2, $3, $4, 'finalized', $5, $5)
		RETURNING id::text
	`, mailboxID, userID, wrappedSkUser, pkBytes, now).Scan(&migID)
	if err != nil {
		http.Error(w, "failed to record key reactivation", http.StatusInternalServerError)
		return
	}

	if len(pkBytes) == 32 {
		_, err = tx.Exec(ctx, `
			UPDATE mailboxes
			SET wrapped_sk_user = $1,
			    mailbox_sk_wrapped = $2,
			    mailbox_pk = $3,
			    previous_wrapped_sk_user = NULL,
			    previous_key_archived_at = NULL,
			    updated_at = $4
			WHERE id = $5 AND user_id = $6
		`, wrappedSkUser, []byte(wrappedSkUser), pkBytes, now, mailboxID, userID)
	} else {
		_, err = tx.Exec(ctx, `
			UPDATE mailboxes
			SET wrapped_sk_user = $1,
			    mailbox_sk_wrapped = $2,
			    previous_wrapped_sk_user = NULL,
			    previous_key_archived_at = NULL,
			    updated_at = $3
			WHERE id = $4 AND user_id = $5
		`, wrappedSkUser, []byte(wrappedSkUser), now, mailboxID, userID)
	}
	if err != nil {
		http.Error(w, "failed to reactivate mailbox keys", http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "failed to commit reactivation transaction", http.StatusInternalServerError)
		return
	}

	auditLog(ctx, conn, "", userID, "reactivate_mailbox_keys", "mailbox", mailboxID, map[string]interface{}{
		"migration_id": migID,
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":      true,
		"migration_id": migID,
		"mailbox_id":   mailboxID,
		"message":      "Historical key material successfully reactivated",
	})
}

// recoveryFlowOptionsHandler handles GET /v1/auth/recovery/options?email=...
// Queries and returns available recovery methods (with destination masked for privacy).
func recoveryFlowOptionsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	email := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("email")))
	if email == "" {
		http.Error(w, "email is required", http.StatusBadRequest)
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

	var recEmail, recPhone, totpSecret *string
	var role string
	var passkeyCount int
	err = conn.QueryRow(ctx, `
		SELECT u.recovery_email, u.recovery_phone, u.totp_secret, u.role,
		       (SELECT COUNT(*) FROM user_passkeys pk WHERE pk.user_id = u.id)
		FROM users u
		WHERE LOWER(u.email)=$1 AND u.is_active=true
	`, email).Scan(&recEmail, &recPhone, &totpSecret, &role, &passkeyCount)

	type MethodOption struct {
		Type              string `json:"type"`
		DestinationMasked string `json:"destination_masked"`
	}

	options := []MethodOption{}

	if err == nil {
		if role == "owner" {
			if recEmail != nil && *recEmail != "" {
				options = append(options, MethodOption{Type: "email", DestinationMasked: maskRecoveryDestination(*recEmail, "email")})
			} else {
				options = append(options, MethodOption{Type: "email", DestinationMasked: maskRecoveryDestination(email, "email")})
			}
			if recPhone != nil && *recPhone != "" {
				options = append(options, MethodOption{Type: "phone", DestinationMasked: maskRecoveryDestination(*recPhone, "phone")})
			}
		}
		if totpSecret != nil && *totpSecret != "" {
			options = append(options, MethodOption{Type: "totp", DestinationMasked: "Authenticator App"})
		}
		if passkeyCount > 0 {
			options = append(options, MethodOption{Type: "passkey", DestinationMasked: "Hardware Security Key / Biometrics"})
		}
		if role != "owner" {
			// Employees have exceptional recovery requiring organization owner approval
			options = append(options, MethodOption{Type: "exceptional", DestinationMasked: "Organization Owner Approval"})
		}
	} else {
		// Anti-enumeration: return standard options without leaking role or existence
		options = append(options, MethodOption{Type: "exceptional", DestinationMasked: "Organization Owner Approval"})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"email":   email,
		"methods": options,
	})
}

// generateAuthCode generates an un-ambiguous alphanumeric authorization code.
func generateAuthCode(length int) (string, error) {
	const charset = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	bytes := make([]byte, length)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	for i := range bytes {
		bytes[i] = charset[int(bytes[i])%len(charset)]
	}
	return string(bytes), nil
}

// exceptionalRecoveryRequestHandler handles POST /v1/auth/recovery/request-exceptional
// Allows an employee who lost their credentials to request exceptional reset requiring
// organization owner authorization.
func exceptionalRecoveryRequestHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Email string `json:"email"`
		Notes string `json:"notes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	email := strings.ToLower(strings.TrimSpace(req.Email))
	if email == "" {
		http.Error(w, "email is required", http.StatusBadRequest)
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

	var userID, orgID, role string
	err = conn.QueryRow(ctx, `
		SELECT id::text, org_id::text, role
		FROM users
		WHERE LOWER(email)=$1 AND is_active=true
	`, email).Scan(&userID, &orgID, &role)

	// Anti-enumeration: if user not found, return 200 with generic response
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"message": "If this account belongs to an organization, an exceptional reset request has been queued for your organization owner.",
		})
		return
	}

	// Security Invariant (Finding F-07): Organization owner cannot request exceptional recovery; owners must use recovery verification contacts.
	if role == "owner" {
		http.Error(w, "forbidden: organization owners must use owner recovery verification contacts; exceptional employee recovery is reserved for organization members", http.StatusForbidden)
		return
	}

	// Rate limiting / abuse prevention: limit pending requests per account
	var pendingCount int
	_ = conn.QueryRow(ctx, `
		SELECT COUNT(*) FROM auth_challenges
		WHERE user_id = $1 AND challenge_type = 'exceptional_reset_pending' AND expires_at > NOW()
	`, userID).Scan(&pendingCount)
	if pendingCount >= 3 {
		http.Error(w, "too many pending recovery requests; please contact your organization owner directly", http.StatusTooManyRequests)
		return
	}

	challengeToken := uuid.New().String()
	expiresAt := time.Now().Add(7 * 24 * time.Hour)

	var requestID string
	err = conn.QueryRow(ctx, `
		INSERT INTO auth_challenges (user_id, challenge_type, challenge_token, destination, expires_at)
		VALUES ($1, 'exceptional_reset_pending', $2, $3, $4)
		RETURNING id::text
	`, userID, challengeToken, email, expiresAt).Scan(&requestID)
	if err != nil {
		http.Error(w, "failed to submit exceptional reset request", http.StatusInternalServerError)
		return
	}

	auditLog(ctx, conn, orgID, userID, "exceptional_recovery_requested", "user", userID, map[string]interface{}{
		"email": email,
		"notes": req.Notes,
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":         true,
		"request_id":      requestID,
		"challenge_token": challengeToken,
		"expires_at":      expiresAt.Format(time.RFC3339),
		"message":         "Exceptional reset request submitted. Please notify your organization owner to review and approve the request in the Control Panel.",
	})
}

// exceptionalRecoveryListHandler handles GET /v1/organizations/{org_id}/exceptional-recovery
// Lists pending employee exceptional recovery requests. Accessible strictly by organization owners.
func exceptionalRecoveryListHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	orgID := r.PathValue("org_id")
	if orgID == "" {
		http.Error(w, "org_id is required", http.StatusBadRequest)
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

	if !isOwner(userID, orgID, conn) {
		http.Error(w, "forbidden: only organization owners may view exceptional recovery requests", http.StatusForbidden)
		return
	}

	rows, err := conn.Query(ctx, `
		SELECT c.id::text, c.user_id::text, u.email, COALESCE(u.display_name, ''), c.created_at, c.expires_at
		FROM auth_challenges c
		JOIN users u ON u.id = c.user_id
		WHERE u.org_id = $1 AND c.challenge_type = 'exceptional_reset_pending' AND c.expires_at > NOW()
		ORDER BY c.created_at DESC
	`, orgID)
	if err != nil {
		http.Error(w, "database query failed", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type PendingRequest struct {
		ID          string    `json:"id"`
		UserID      string    `json:"user_id"`
		Email       string    `json:"email"`
		DisplayName string    `json:"display_name"`
		CreatedAt   time.Time `json:"created_at"`
		ExpiresAt   time.Time `json:"expires_at"`
	}

	requests := []PendingRequest{}
	for rows.Next() {
		var pr PendingRequest
		if err := rows.Scan(&pr.ID, &pr.UserID, &pr.Email, &pr.DisplayName, &pr.CreatedAt, &pr.ExpiresAt); err != nil {
			continue
		}
		requests = append(requests, pr)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"requests": requests,
	})
}

// exceptionalRecoveryApproveHandler handles POST /v1/organizations/{org_id}/exceptional-recovery/{id}/approve
// Generates a single-use 24-hour authorization code for the employee.
// Accessible strictly by organization owners.
func exceptionalRecoveryApproveHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	orgID := r.PathValue("org_id")
	requestID := r.PathValue("id")
	if orgID == "" || requestID == "" {
		http.Error(w, "org_id and request id are required", http.StatusBadRequest)
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

	if !isOwner(userID, orgID, conn) {
		http.Error(w, "forbidden: only organization owners may approve exceptional recovery requests", http.StatusForbidden)
		return
	}

	var targetUserID, targetEmail string
	err = conn.QueryRow(ctx, `
		SELECT c.user_id::text, u.email
		FROM auth_challenges c
		JOIN users u ON u.id = c.user_id
		WHERE c.id = $1 AND u.org_id = $2 AND c.challenge_type = 'exceptional_reset_pending' AND c.expires_at > NOW()
	`, requestID, orgID).Scan(&targetUserID, &targetEmail)
	if err != nil {
		http.Error(w, "pending recovery request not found or expired", http.StatusNotFound)
		return
	}

	// Security Invariant (Finding F-07): Organization owner cannot approve their own exceptional recovery request.
	if targetUserID == userID {
		http.Error(w, "forbidden: organization owners cannot approve their own exceptional recovery request", http.StatusForbidden)
		return
	}

	authCode, err := generateAuthCode(12)
	if err != nil {
		http.Error(w, "failed to generate authorization code", http.StatusInternalServerError)
		return
	}

	expiresAt := time.Now().Add(24 * time.Hour)
	_, err = conn.Exec(ctx, `
		UPDATE auth_challenges
		SET challenge_type = 'exceptional_reset_approved',
		    verification_code = $1,
		    expires_at = $2
		WHERE id = $3
	`, authCode, expiresAt, requestID)
	if err != nil {
		http.Error(w, "failed to approve recovery request", http.StatusInternalServerError)
		return
	}

	auditLog(ctx, conn, orgID, userID, "exceptional_recovery_approved", "user", targetUserID, map[string]interface{}{
		"target_email": targetEmail,
		"request_id":   requestID,
	})

	// Security Invariant (Finding F-01): The owner must NEVER receive the authorization code or key material.
	// The employee who requested reset can directly redeem using their challenge_token once approved,
	// or the code can be transmitted via verified external secure messaging.
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":      true,
		"target_email": targetEmail,
		"expires_at":   expiresAt.Format(time.RFC3339),
		"message":      "Recovery request approved. The employee may now complete their password reset directly in Webmail.",
	})
}

// exceptionalRecoveryRejectHandler handles POST /v1/organizations/{org_id}/exceptional-recovery/{id}/reject
// Rejects a pending recovery request. Accessible strictly by organization owners.
func exceptionalRecoveryRejectHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	orgID := r.PathValue("org_id")
	requestID := r.PathValue("id")
	if orgID == "" || requestID == "" {
		http.Error(w, "org_id and request id are required", http.StatusBadRequest)
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

	if !isOwner(userID, orgID, conn) {
		http.Error(w, "forbidden: only organization owners may reject exceptional recovery requests", http.StatusForbidden)
		return
	}

	var targetUserID, targetEmail string
	err = conn.QueryRow(ctx, `
		SELECT c.user_id::text, u.email
		FROM auth_challenges c
		JOIN users u ON u.id = c.user_id
		WHERE c.id = $1 AND u.org_id = $2 AND c.challenge_type = 'exceptional_reset_pending'
	`, requestID, orgID).Scan(&targetUserID, &targetEmail)
	if err != nil {
		http.Error(w, "pending recovery request not found", http.StatusNotFound)
		return
	}

	_, _ = conn.Exec(ctx, `DELETE FROM auth_challenges WHERE id = $1`, requestID)

	auditLog(ctx, conn, orgID, userID, "exceptional_recovery_rejected", "user", targetUserID, map[string]interface{}{
		"target_email": targetEmail,
		"request_id":   requestID,
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"message": "Exceptional recovery request rejected.",
	})
}

// exceptionalRecoveryResetHandler handles POST /v1/auth/recovery/reset-with-approval
// Employee redeems approved recovery challenge (using their challenge_token or single-use authorization code)
// and sets a new account login password.
// ZERO-KNOWLEDGE INVARIANT (Finding F-01): The mailboxes table is strictly NOT modified by this handler.
// Existing mailbox keys (wrapped_sk_user and mailbox_pk) remain intact (wrapped under the old password)
// until the employee independently completes cryptographic recovery via their 24-word recovery phrase.
func exceptionalRecoveryResetHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Email             string `json:"email"`
		ChallengeToken    string `json:"challenge_token,omitempty"`
		AuthorizationCode string `json:"authorization_code,omitempty"`
		NewPassword       string `json:"new_password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	email := strings.ToLower(strings.TrimSpace(req.Email))
	codeOrToken := strings.TrimSpace(req.AuthorizationCode)
	if codeOrToken == "" {
		codeOrToken = strings.TrimSpace(req.ChallengeToken)
	}
	newPassword := req.NewPassword

	if email == "" || codeOrToken == "" {
		http.Error(w, "email and authorization_code (or challenge_token) are required", http.StatusBadRequest)
		return
	}
	if len(newPassword) < 8 || len(newPassword) > 128 {
		http.Error(w, "new_password must be between 8 and 128 characters", http.StatusBadRequest)
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

	var challengeID, userID, orgID string
	err = conn.QueryRow(ctx, `
		SELECT c.id::text, c.user_id::text, u.org_id::text
		FROM auth_challenges c
		JOIN users u ON u.id = c.user_id
		WHERE LOWER(u.email) = $1 AND c.challenge_type = 'exceptional_reset_approved'
		  AND (c.challenge_token = $2 OR (c.verification_code IS NOT NULL AND UPPER(c.verification_code) = UPPER($2)))
		  AND c.expires_at > NOW()
	`, email, codeOrToken).Scan(&challengeID, &userID, &orgID)
	if err != nil {
		http.Error(w, "invalid or expired authorization code", http.StatusUnauthorized)
		return
	}

	// Delete challenge immediately to ensure single-use
	_, _ = conn.Exec(ctx, `DELETE FROM auth_challenges WHERE id = $1`, challengeID)

	hash, err := hashPassword(newPassword)
	if err != nil {
		http.Error(w, "failed to hash password", http.StatusInternalServerError)
		return
	}

	tx, err := conn.Begin(ctx)
	if err != nil {
		http.Error(w, "failed to start transaction", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	// Canonical Lock Order: 1. Lock all active mailbox parent rows for this user FIRST
	mRows, err := tx.Query(ctx, `
		SELECT id::text
		FROM mailboxes
		WHERE user_id = $1 AND is_active = true
		FOR UPDATE
	`, userID)
	if err != nil {
		http.Error(w, "failed to lock mailboxes", http.StatusInternalServerError)
		return
	}
	var userMailboxIDs []string
	for mRows.Next() {
		var mID string
		if err := mRows.Scan(&mID); err == nil {
			userMailboxIDs = append(userMailboxIDs, mID)
		}
	}
	mRows.Close()

	_, err = tx.Exec(ctx, `
		UPDATE users
		SET password_hash = $1, updated_at = NOW()
		WHERE id = $2 AND is_active = true
	`, hash, userID)
	if err != nil {
		http.Error(w, "failed to update user password", http.StatusInternalServerError)
		return
	}

	// Strictly zero-knowledge: The mailboxes table is NOT touched.
	// The employee's existing mailbox keys remain unchanged (wrapped under the old password)
	// until the employee independently completes cryptographic recovery via their 24-word recovery phrase.

	// Canonical Lock Order: 2. Lock & invalidate pending reactivation child rows SECOND
	if len(userMailboxIDs) > 0 {
		_, err = tx.Exec(ctx, `
			UPDATE mailbox_key_reactivations
			SET status = 'rolled_back', rolled_back_at = NOW(), rollback_reason = 'exceptional_recovery_reset_during_pending'
			WHERE user_id = $1 AND mailbox_id = ANY($2::uuid[]) AND status = 'pending'
		`, userID, userMailboxIDs)
	} else {
		_, err = tx.Exec(ctx, `
			UPDATE mailbox_key_reactivations
			SET status = 'rolled_back', rolled_back_at = NOW(), rollback_reason = 'exceptional_recovery_reset_during_pending'
			WHERE user_id = $1 AND status = 'pending'
		`, userID)
	}
	if err != nil {
		http.Error(w, "failed to invalidate pending key reactivations", http.StatusInternalServerError)
		return
	}

	// Revoke existing sessions
	_, _ = tx.Exec(ctx, `UPDATE sessions SET revoked_at=NOW() WHERE user_id=$1`, userID)

	userAgent := r.UserAgent()
	ipAddress := getClientIP(r)
	token, expires, err := createSession(ctx, conn, userID, 24*time.Hour, userAgent, ipAddress)
	if err != nil {
		http.Error(w, "failed to create session", http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "failed to commit transaction", http.StatusInternalServerError)
		return
	}

	auditLog(ctx, conn, orgID, userID, "exceptional_recovery_reset", "user", userID, map[string]interface{}{
		"email": email,
	})

	setSessionCookie(w, r, token, expires)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success": true,
		"token":   token,
		"message": "Password reset successfully via exceptional recovery.",
	})
}

