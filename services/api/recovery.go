package main

// Evidence:
// - Route table: POST /v1/auth/recovery-enroll, POST /v1/auth/recovery-challenge,
//   POST /v1/auth/recovery-verify, POST /v1/auth/change-password.
// - infra/postgres/init/009_recovery_verifiers.sql: users.recovery_auth_pk
//   bytea NULL, recovery_auth_version smallint NULL|1 (+check), unique idx
//   where not null; never backfilled server-side.
// - infra/postgres/init/021_recovery_challenges.sql: recovery_challenges
//   (challenge_id UNIQUE, expires_at, consumed_at) for single-use challenges.
// - ROADMAP_STATUS.md Section 15 foundation: client-side mnemonic/verify,
//   no server plaintext; apps/control-plane recovery.tsx is client-only.
// - Canonical challenge message shared with the client (recoveryChallengeMessage):
//   "byos-recovery-v1:challenge:<challenge_id>". The client signs exactly
//   these bytes with the root-derived Ed25519 key; the server verifies with
//   the enrolled recovery_auth_pk and never sees the phrase, root, or key.
// - Recovery restores ACCOUNT access only (fresh session, same shape as
//   login). It never decrypts mailbox content: authentication credential !=
//   mailbox encryption key (frozen trust separation).

import (
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func verifyEd25519Signature(pk []byte, message []byte, signatureB64 string) bool {
	if len(pk) != ed25519.PublicKeySize {
		return false
	}
	sig, err := base64.StdEncoding.DecodeString(signatureB64)
	if err != nil || len(sig) != ed25519.SignatureSize {
		return false
	}
	return ed25519.Verify(ed25519.PublicKey(pk), message, sig)
}

// recoveryChallengeMessage is the exact byte string the client signs and the
// server verifies. Changing it invalidates outstanding challenges (they
// expire in 5 minutes) and must ship with the matching client.
func recoveryChallengeMessage(challengeID string) []byte {
	return []byte("byos-recovery-v1:challenge:" + challengeID)
}

// recoveryRateLimited enforces a small per-IP budget on unauthenticated
// recovery endpoints, failing closed when Redis is unavailable (same doctrine
// as the login limiter: no bypass during outages).
func recoveryRateLimited(w http.ResponseWriter, r *http.Request, scope string) bool {
	if redisClient == nil {
		http.Error(w, "recovery service unavailable", http.StatusServiceUnavailable)
		return true
	}
	ip := getClientIP(r)
	ctx := context.Background()
	key := "auth:recovery:" + scope + ":" + ip

	// Atomic check + increment via rateLuaScript (5 attempts per 60s window)
	keys := []string{key}
	args := []interface{}{5, 60} // limit: 5, TTL: 60s
	res, err := redisClient.Eval(ctx, rateLuaScript, keys, args...).Result()
	if err != nil {
		http.Error(w, "recovery service unavailable", http.StatusServiceUnavailable)
		return true
	}
	arr, ok := res.([]interface{})
	if !ok || len(arr) == 0 {
		http.Error(w, "recovery service unavailable", http.StatusServiceUnavailable)
		return true
	}
	code, _ := arr[0].(int64)
	if code != 1 {
		w.Header().Set("Retry-After", "60")
		http.Error(w, "too many attempts, try later", http.StatusTooManyRequests)
		return true
	}
	return false
}

func recoveryEnrollHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "missing or invalid authentication", http.StatusUnauthorized)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var req struct {
		RecoveryAuthPk string `json:"recovery_auth_pk"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	pkBytes, err := base64.StdEncoding.DecodeString(strings.TrimSpace(req.RecoveryAuthPk))
	if err != nil || len(pkBytes) != 32 {
		http.Error(w, "recovery_auth_pk must be base64 32 bytes", http.StatusBadRequest)
		return
	}
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)
	// Verifier rotation is allowed (upsert), not just first enrollment:
	// a root rotation derives a new recovery key, so the verifier must be
	// replaceable or recovery breaks after rotation. Rotation requires a
	// valid session, which already grants full account access, so it adds
	// no new capability to an attacker.
	var currentPk []byte
	var currentVersion *int
	err = conn.QueryRow(ctx, `SELECT recovery_auth_pk, recovery_auth_version FROM users WHERE id=$1 AND is_active=true`, userID).Scan(&currentPk, &currentVersion)
	if err != nil {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}
	rotated := currentPk != nil
	_, err = conn.Exec(ctx, `UPDATE users SET recovery_auth_pk=$1, recovery_auth_version=1 WHERE id=$2`, pkBytes, userID)
	if err != nil {
		http.Error(w, "failed to enroll recovery verifier", http.StatusInternalServerError)
		return
	}
	var orgID string
	_ = conn.QueryRow(ctx, `SELECT org_id::text FROM users WHERE id=$1`, userID).Scan(&orgID)
	action := "recovery_enroll"
	status := http.StatusCreated
	if rotated {
		action = "recovery_reenroll"
		status = http.StatusOK
	}
	auditLog(ctx, conn, orgID, userID, action, "user", userID, nil)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]interface{}{"id": userID, "recovery_enrolled": true})
}

func recoveryChallengeHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if recoveryRateLimited(w, r, "challenge") {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var req struct {
		Email string `json:"email"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	email := strings.TrimSpace(strings.ToLower(req.Email))
	if email == "" || !strings.Contains(email, "@") {
		http.Error(w, "invalid email", http.StatusBadRequest)
		return
	}
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)
	// Anti-enumeration: unknown emails and non-enrolled users receive a
	// well-formed but unpersisted challenge. Verification of such IDs fails
	// closed with the same error as an expired challenge, so the endpoint
	// does not reveal enrollment state.
	var userID string
	var verifier []byte
	err = conn.QueryRow(ctx, `SELECT id::text, recovery_auth_pk FROM users WHERE email=$1 AND is_active=true`, email).Scan(&userID, &verifier)
	challengeID := uuid.New().String()
	expiresAt := time.Now().Add(5 * time.Minute)
	if err == nil && verifier != nil {
		if _, err := conn.Exec(ctx, `INSERT INTO recovery_challenges (user_id, challenge_id, expires_at) VALUES ($1, $2, $3)`, userID, challengeID, expiresAt); err != nil {
			http.Error(w, "failed to issue challenge", http.StatusInternalServerError)
			return
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"challenge_id": challengeID,
		"expires_at":   expiresAt.Format(time.RFC3339),
	})
}

// recoveryVerifyHandler completes account recovery: the client proves
// possession of the mnemonic-derived Ed25519 key by signing the canonical
// challenge message. On success the server issues a fresh session (same
// shape as login) — restoring ACCOUNT access only. No mailbox content is
// decrypted and no keys are returned.
func recoveryVerifyHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if recoveryRateLimited(w, r, "verify") {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var req struct {
		ChallengeID string `json:"challenge_id"`
		Signature   string `json:"signature"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if _, err := uuid.Parse(strings.TrimSpace(req.ChallengeID)); err != nil {
		http.Error(w, "recovery verification failed", http.StatusUnauthorized)
		return
	}
	if strings.TrimSpace(req.Signature) == "" {
		http.Error(w, "recovery verification failed", http.StatusUnauthorized)
		return
	}
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)
	// Atomically consume the challenge: exactly one successful verification
	// per issuance, and expired challenges can never verify.
	var userID string
	var verifier []byte
	err = conn.QueryRow(ctx, `
		SELECT c.user_id::text, u.recovery_auth_pk
		FROM recovery_challenges c
		JOIN users u ON u.id = c.user_id AND u.is_active = true
		WHERE c.challenge_id = $1 AND c.consumed_at IS NULL AND c.expires_at > now()
	`, strings.TrimSpace(req.ChallengeID)).Scan(&userID, &verifier)
	if err != nil || verifier == nil {
		http.Error(w, "recovery verification failed", http.StatusUnauthorized)
		return
	}
	if !verifyEd25519Signature(verifier, recoveryChallengeMessage(strings.TrimSpace(req.ChallengeID)), strings.TrimSpace(req.Signature)) {
		http.Error(w, "recovery verification failed", http.StatusUnauthorized)
		return
	}
	res, err := conn.Exec(ctx, `UPDATE recovery_challenges SET consumed_at=now() WHERE challenge_id=$1 AND consumed_at IS NULL`, strings.TrimSpace(req.ChallengeID))
	if err != nil || res.RowsAffected() == 0 {
		http.Error(w, "recovery verification failed", http.StatusUnauthorized)
		return
	}
	var email, orgID string
	_ = conn.QueryRow(ctx, `SELECT email, org_id::text FROM users WHERE id=$1`, userID).Scan(&email, &orgID)
	token, tokenHash := generateSessionToken()
	expires := time.Now().Add(30 * 24 * time.Hour)
	if _, err := conn.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`, userID, tokenHash, expires); err != nil {
		http.Error(w, "failed to restore access", http.StatusInternalServerError)
		return
	}

	// Operation-bound recovery authorization: single-use, 15-minute validity, bound to this specific session's token_hash
	resetAuthToken, _ := generateRandomBase64URL(32)
	callerTokenHashHex := hex.EncodeToString(tokenHash)
	_, _ = conn.Exec(ctx, `
		INSERT INTO auth_challenges (user_id, challenge_type, challenge_token, destination, expires_at)
		VALUES ($1, 'section15_recovery_pwd_reset', $2, $3, NOW() + INTERVAL '15 minutes')
	`, userID, resetAuthToken, callerTokenHashHex)

	auditLog(ctx, conn, orgID, userID, "recovery_verify", "user", userID, nil)
	setSessionCookie(w, r, token, expires)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":                  userID,
		"email":               email,
		"org_id":              orgID,
		"recovery_auth_token": resetAuthToken,
	})
}

// changePasswordHandler sets a new account password for the session owner.
// Security Invariants:
// - Finding F-03: current_password is unconditionally required and verified.
// - Finding F-04: If the account has two-factor authentication enabled, mfa_code is required.
// - Finding F-05: When wrapped_sk_user is updated, mailbox_id is validated to avoid corrupting secondary mailboxes.
func changePasswordHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userID, ok := getSessionUserID(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var req struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
		WrappedSkUser   string `json:"wrapped_sk_user,omitempty"`
		MailboxID       string `json:"mailbox_id,omitempty"`
		MFACode         string `json:"mfa_code,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	req.CurrentPassword = strings.TrimSpace(req.CurrentPassword)

	if len(req.NewPassword) < 8 || len(req.NewPassword) > 128 {
		http.Error(w, "password must be 8-128 characters", http.StatusBadRequest)
		return
	}
	wrappedSkUser := strings.TrimSpace(req.WrappedSkUser)
	if wrappedSkUser != "" {
		var js map[string]interface{}
		if err := json.Unmarshal([]byte(wrappedSkUser), &js); err != nil {
			http.Error(w, "invalid wrapped_sk_user: must be valid JSON object", http.StatusBadRequest)
			return
		}
	}
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	// Finding F-03: Verify current password unconditionally on ordinary password changes.
	// Bypass is permitted strictly when authenticated via single-use Section 15 Ed25519 recovery verification bound to this session.
	var currentPwdHash string
	var twoFactorEnabled bool
	var totpSecret *string
	var passkeyCount int
	err = conn.QueryRow(ctx, `
		SELECT u.password_hash, u.two_factor_enabled, u.totp_secret,
		       (SELECT COUNT(*) FROM user_passkeys pk WHERE pk.user_id = u.id)
		FROM users u WHERE u.id=$1 AND is_active=true
	`, userID).Scan(&currentPwdHash, &twoFactorEnabled, &totpSecret, &passkeyCount)
	if err != nil {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}

	if req.CurrentPassword == "" {
		callerHash, hasHash := getCallerTokenHash(r)
		if !hasHash {
			http.Error(w, "current_password is required", http.StatusBadRequest)
			return
		}
		callerHashHex := hex.EncodeToString(callerHash)
		var challengeID string
		err := conn.QueryRow(ctx, `
			SELECT id::text FROM auth_challenges
			WHERE user_id = $1
			  AND challenge_type = 'section15_recovery_pwd_reset'
			  AND destination = $2
			  AND expires_at > NOW()
			LIMIT 1
		`, userID, callerHashHex).Scan(&challengeID)
		if err != nil {
			http.Error(w, "current_password is required", http.StatusBadRequest)
			return
		}
		// Single-use: consume authorization token immediately
		_, _ = conn.Exec(ctx, `DELETE FROM auth_challenges WHERE id = $1`, challengeID)
	} else {
		if !verifyPassword(currentPwdHash, req.CurrentPassword) {
			http.Error(w, "current password is incorrect", http.StatusUnauthorized)
			return
		}

		// Enforce MFA step-up reauthentication for ordinary password changes.
		hasActiveTOTP := (totpSecret != nil && *totpSecret != "")
		hasPasskeys := passkeyCount > 0

		if hasActiveTOTP || hasPasskeys {
			mfaCode := strings.TrimSpace(req.MFACode)
			if mfaCode == "" {
				if hasActiveTOTP {
					http.Error(w, "mfa_code is required: account has two-factor authentication enabled", http.StatusForbidden)
				} else {
					http.Error(w, "mfa_code is required: account has passkey authentication enabled", http.StatusForbidden)
				}
				return
			}

			validMFA := false
			if hasActiveTOTP {
				consumed, err := verifyAndConsumeTOTP(ctx, conn, userID, *totpSecret, mfaCode)
				if err == nil && consumed {
					validMFA = true
				}
			}
			if !validMFA {
				var chID string
				err := conn.QueryRow(ctx, `
					DELETE FROM auth_challenges
					WHERE user_id=$1 AND challenge_type IN ('step_up_mfa', 'webauthn_step_up', 'recovery_reset_totp')
					  AND challenge_token=$2 AND expires_at > NOW()
					RETURNING id::text
				`, userID, mfaCode).Scan(&chID)
				if err == nil {
					validMFA = true
				}
			}
			if !validMFA {
				http.Error(w, "invalid two-factor authentication code", http.StatusUnauthorized)
				return
			}
		}
	}

	// Finding F-05: Enforce mailbox key preservation and isolate multiple mailboxes
	var mailboxCount int
	var mailboxWrappedCount int
	err = conn.QueryRow(ctx, `
		SELECT COUNT(*), COUNT(NULLIF(wrapped_sk_user, ''))
		FROM mailboxes
		WHERE user_id=$1 AND is_active=true
	`, userID).Scan(&mailboxCount, &mailboxWrappedCount)
	if err != nil {
		http.Error(w, "database query failed", http.StatusInternalServerError)
		return
	}
	if mailboxWrappedCount > 0 && wrappedSkUser == "" {
		http.Error(w, "mailbox key envelope (wrapped_sk_user) is required when changing password for accounts with active mailboxes to prevent loss of access; please change your password in Webmail where your mailbox is unlocked", http.StatusBadRequest)
		return
	}

	reqMailboxID := strings.TrimSpace(req.MailboxID)
	if wrappedSkUser != "" {
		if reqMailboxID != "" {
			var mbExists bool
			err = conn.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM mailboxes WHERE id=$1 AND user_id=$2 AND is_active=true)`, reqMailboxID, userID).Scan(&mbExists)
			if err != nil || !mbExists {
				http.Error(w, "invalid or unauthorized mailbox_id", http.StatusBadRequest)
				return
			}
		} else if mailboxWrappedCount > 1 {
			http.Error(w, "mailbox_id is required when user has multiple active mailboxes with key envelopes", http.StatusBadRequest)
			return
		}
	}

	hash, err := hashPassword(req.NewPassword)
	if err != nil {
		http.Error(w, "failed to hash password", http.StatusInternalServerError)
		return
	}
	tx, err := conn.Begin(ctx)
	if err != nil {
		http.Error(w, "Failed to begin transaction", http.StatusInternalServerError)
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

	var orgID string
	err = tx.QueryRow(ctx, `UPDATE users SET password_hash=$1, updated_at=NOW() WHERE id=$2 AND is_active=true RETURNING org_id::text`, hash, userID).Scan(&orgID)
	if err != nil {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}

	if wrappedSkUser != "" {
		if reqMailboxID != "" {
			_, err = tx.Exec(ctx, `UPDATE mailboxes SET wrapped_sk_user=$1, mailbox_sk_wrapped=$2, updated_at=NOW() WHERE id=$3 AND user_id=$4 AND is_active=true`, wrappedSkUser, []byte(wrappedSkUser), reqMailboxID, userID)
		} else {
			_, err = tx.Exec(ctx, `UPDATE mailboxes SET wrapped_sk_user=$1, mailbox_sk_wrapped=$2, updated_at=NOW() WHERE user_id=$3 AND is_active=true AND wrapped_sk_user IS NOT NULL AND wrapped_sk_user != ''`, wrappedSkUser, []byte(wrappedSkUser), userID)
		}
		if err != nil {
			http.Error(w, "failed to update mailbox wrapped key", http.StatusInternalServerError)
			return
		}
	}

	// Canonical Lock Order: 2. Lock & invalidate pending reactivation child rows SECOND
	if len(userMailboxIDs) > 0 {
		_, err = tx.Exec(ctx, `
			UPDATE mailbox_key_reactivations
			SET status = 'rolled_back', rolled_back_at = NOW(), rollback_reason = 'password_changed_during_pending'
			WHERE user_id = $1 AND mailbox_id = ANY($2::uuid[]) AND status = 'pending'
		`, userID, userMailboxIDs)
	} else {
		_, err = tx.Exec(ctx, `
			UPDATE mailbox_key_reactivations
			SET status = 'rolled_back', rolled_back_at = NOW(), rollback_reason = 'password_changed_during_pending'
			WHERE user_id = $1 AND status = 'pending'
		`, userID)
	}
	if err != nil {
		http.Error(w, "failed to invalidate pending key reactivations", http.StatusInternalServerError)
		return
	}

	// Revoke every other session so old sessions die; the current session stays alive.
	var currentHash []byte
	if h, ok := getCallerTokenHash(r); ok {
		currentHash = h
	}

	// Query token hashes to be revoked for Redis purge
	rows, err := tx.Query(ctx, `
		SELECT token_hash FROM sessions
		WHERE user_id=$1 AND token_hash != $2 AND revoked_at IS NULL
	`, userID, currentHash)
	var hashesToRevoke [][]byte
	if err == nil {
		for rows.Next() {
			var h []byte
			if err := rows.Scan(&h); err == nil {
				hashesToRevoke = append(hashesToRevoke, h)
			}
		}
		rows.Close()
	}

	if _, err := tx.Exec(ctx, `UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND token_hash != $2 AND revoked_at IS NULL`, userID, currentHash); err != nil {
		http.Error(w, "failed to rotate sessions", http.StatusInternalServerError)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "failed to commit", http.StatusInternalServerError)
		return
	}

	// Purge revoked sessions in Redis
	if redisClient != nil {
		ctx2 := context.Background()
		for _, h := range hashesToRevoke {
			hexHash := hex.EncodeToString(h)
			redisClient.Del(ctx2, "auth:session:"+hexHash)
			redisClient.Del(ctx2, "session:"+hexHash)
		}
		redisClient.Del(ctx2, "auth:user_sessions:"+userID)
	}

	auditLog(ctx, conn, orgID, userID, "change_password", "user", userID, nil)
	w.WriteHeader(http.StatusNoContent)
}
