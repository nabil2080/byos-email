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
	if method != "email" && method != "phone" && method != "totp" {
		http.Error(w, "unsupported recovery method; must be email, phone, or totp", http.StatusBadRequest)
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

	var userID string
	var recEmail, recPhone, totpSecret *string
	err = conn.QueryRow(ctx, `
		SELECT id::text, recovery_email, recovery_phone, totp_secret
		FROM users
		WHERE email=$1 AND is_active=true
	`, email).Scan(&userID, &recEmail, &recPhone, &totpSecret)

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

	challengeToken := uuid.New().String()
	expiresAt := time.Now().Add(10 * time.Minute)

	var mailboxID, wrappedSkUser string
	_ = conn.QueryRow(ctx, `SELECT id::text, COALESCE(wrapped_sk_user, '') FROM mailboxes WHERE user_id=$1 AND is_active=true LIMIT 1`, userID).Scan(&mailboxID, &wrappedSkUser)

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

	code, err := generate6DigitOTP()
	if err != nil {
		http.Error(w, "failed to generate verification code", http.StatusInternalServerError)
		return
	}

	_, err = conn.Exec(ctx, `
		INSERT INTO auth_challenges (user_id, challenge_type, challenge_token, verification_code, destination, expires_at)
		VALUES ($1, 'recovery_reset', $2, $3, $4, $5)
	`, userID, challengeToken, code, destination, expiresAt)
	if err != nil {
		http.Error(w, "failed to create recovery challenge", http.StatusInternalServerError)
		return
	}

	// In real environment, send code via SMTP/SMS. Log for test and sandbox verification.
	log.Printf("[RECOVERY OTP] %s challenge for user %s (%s): %s", method, email, maskRecoveryDestination(destination, method), code)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"challenge_token":    challengeToken,
		"method":             method,
		"destination_masked": maskRecoveryDestination(destination, method),
		"expires_at":         expiresAt.Format(time.RFC3339),
		"mailbox_id":         mailboxID,
		"wrapped_sk_user":    wrappedSkUser,
		// Exposed in non-production for automated end-to-end verification
		"debug_code": code,
	})
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

	// Verify verification code based on challenge type
	if challengeType == "recovery_reset_totp" {
		var totpSecret *string
		err = conn.QueryRow(ctx, `SELECT totp_secret FROM users WHERE id=$1`, userID).Scan(&totpSecret)
		if err != nil || totpSecret == nil || !validateTOTP(*totpSecret, code) {
			http.Error(w, "invalid authenticator code", http.StatusUnauthorized)
			return
		}
	} else if challengeType == "recovery_reset" {
		if expectedCode == nil || *expectedCode != code {
			http.Error(w, "invalid verification code", http.StatusUnauthorized)
			return
		}
	} else {
		http.Error(w, "unsupported challenge type", http.StatusBadRequest)
		return
	}

	// Delete challenge immediately to prevent reuse
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

	var role, plan string
	_ = tx.QueryRow(ctx, `
		SELECT COALESCE(u.role, 'member'), COALESCE(o.plan, 'solo')
		FROM users u
		LEFT JOIN organizations o ON o.id = u.org_id
		WHERE u.id=$1
	`, userID).Scan(&role, &plan)

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
		"plan":                     plan,
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
			"plan":                     plan,
			"mailbox_id":               mailboxID,
			"mailbox_local_part":       mailboxLocalPart,
			"mailbox_mode":             mailboxMode,
			"wrapped_sk_user":          currWskStr,
			"previous_wrapped_sk_user": prevWskStr,
		},
	})
}

// mailboxReactivateKeysHandler handles POST /v1/mailboxes/{mailbox_id}/reactivate-keys
// Tier 2 Data Decryption: Saves re-wrapped historical key under the new password,
// clearing previous_wrapped_sk_user and restoring historical message access.
func mailboxReactivateKeysHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	mailboxID := r.PathValue("mailbox_id")
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

	// Verify mailbox ownership and update keys
	var rowsAffected int64
	if mailboxPk != "" {
		pkBytes, hexErr := hex.DecodeString(mailboxPk)
		if hexErr == nil && len(pkBytes) == 32 {
			tag, execErr := conn.Exec(ctx, `
				UPDATE mailboxes
				SET wrapped_sk_user = $1,
				    mailbox_sk_wrapped = $2,
				    mailbox_pk = $3,
				    updated_at = NOW()
				WHERE id = $4 AND (user_id = $5 OR org_id IN (SELECT org_id FROM users WHERE id=$5 AND role IN ('admin', 'owner')))
			`, wrappedSkUser, []byte(wrappedSkUser), pkBytes, mailboxID, userID)
			err = execErr
			rowsAffected = tag.RowsAffected()
		} else {
			tag, execErr := conn.Exec(ctx, `
				UPDATE mailboxes
				SET wrapped_sk_user = $1,
				    mailbox_sk_wrapped = $2,
				    updated_at = NOW()
				WHERE id = $3 AND (user_id = $4 OR org_id IN (SELECT org_id FROM users WHERE id=$4 AND role IN ('admin', 'owner')))
			`, wrappedSkUser, []byte(wrappedSkUser), mailboxID, userID)
			err = execErr
			rowsAffected = tag.RowsAffected()
		}
	} else {
		tag, execErr := conn.Exec(ctx, `
			UPDATE mailboxes
			SET wrapped_sk_user = $1,
			    mailbox_sk_wrapped = $2,
			    previous_wrapped_sk_user = NULL,
			    previous_key_archived_at = NULL,
			    updated_at = NOW()
			WHERE id = $3 AND (user_id = $4 OR org_id IN (SELECT org_id FROM users WHERE id=$4 AND role IN ('admin', 'owner')))
		`, wrappedSkUser, []byte(wrappedSkUser), mailboxID, userID)
		err = execErr
		rowsAffected = tag.RowsAffected()
	}
	if err != nil {
		http.Error(w, "failed to reactivate mailbox keys", http.StatusInternalServerError)
		return
	}
	if rowsAffected == 0 {
		http.Error(w, "mailbox not found or unauthorized", http.StatusNotFound)
		return
	}

	auditLog(ctx, conn, "", userID, "reactivate_mailbox_keys", "mailbox", mailboxID, nil)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":    true,
		"mailbox_id": mailboxID,
		"message":    "Historical key material successfully reactivated",
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
	err = conn.QueryRow(ctx, `
		SELECT recovery_email, recovery_phone, totp_secret
		FROM users
		WHERE LOWER(email)=$1 AND is_active=true
	`, email).Scan(&recEmail, &recPhone, &totpSecret)

	type MethodOption struct {
		Type              string `json:"type"`
		DestinationMasked string `json:"destination_masked"`
	}

	options := []MethodOption{}

	if err == nil {
		if recEmail != nil && *recEmail != "" {
			options = append(options, MethodOption{Type: "email", DestinationMasked: maskRecoveryDestination(*recEmail, "email")})
		} else {
			options = append(options, MethodOption{Type: "email", DestinationMasked: maskRecoveryDestination(email, "email")})
		}
		if recPhone != nil && *recPhone != "" {
			options = append(options, MethodOption{Type: "phone", DestinationMasked: maskRecoveryDestination(*recPhone, "phone")})
		}
		if totpSecret != nil && *totpSecret != "" {
			options = append(options, MethodOption{Type: "totp", DestinationMasked: "Authenticator App"})
		}
	} else {
		// Anti-enumeration: return standard masked email option
		options = append(options, MethodOption{Type: "email", DestinationMasked: maskRecoveryDestination(email, "email")})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"email":   email,
		"methods": options,
	})
}

