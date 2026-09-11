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
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"
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
	ip := r.RemoteAddr
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		ip = strings.Split(fwd, ",")[0]
	}
	ip = strings.TrimSpace(strings.Split(ip, ":")[0])
	ctx := context.Background()
	cnt, err := redisClient.Get(ctx, "auth:recovery:"+scope+":"+ip).Int()
	if err != nil && err != redis.Nil {
		http.Error(w, "recovery service unavailable", http.StatusServiceUnavailable)
		return true
	}
	if cnt >= 5 {
		w.Header().Set("Retry-After", "60")
		http.Error(w, "too many attempts, try later", http.StatusTooManyRequests)
		return true
	}
	redisClient.Incr(ctx, "auth:recovery:"+scope+":"+ip)
	redisClient.Expire(ctx, "auth:recovery:"+scope+":"+ip, time.Minute)
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
	auditLog(ctx, conn, orgID, userID, "recovery_verify", "user", userID, nil)
	setSessionCookie(w, token, expires)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"id": userID, "email": email, "org_id": orgID})
}

// changePasswordHandler sets a new account password for the session owner.
// It exists so a user who recovered access via recovery-verify (without
// knowing the old password) can durably regain login. It changes
// authentication only — never mailbox keys.
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
		NewPassword string `json:"new_password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if len(req.NewPassword) < 8 || len(req.NewPassword) > 128 {
		http.Error(w, "password must be 8-128 characters", http.StatusBadRequest)
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
	var orgID string
	err = tx.QueryRow(ctx, `UPDATE users SET password_hash=$1 WHERE id=$2 AND is_active=true RETURNING org_id::text`, hash, userID).Scan(&orgID)
	if err != nil {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}
	// Revoke every other session so the forgotten/old credential's sessions
	// die; the current session (this request's cookie) stays alive.
	var currentHash []byte
	if cookie, cerr := r.Cookie("byos_session"); cerr == nil {
		currentHash = hashToken(cookie.Value)
	}
	if _, err := tx.Exec(ctx, `UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND token_hash != $2`, userID, currentHash); err != nil {
		http.Error(w, "failed to rotate sessions", http.StatusInternalServerError)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "failed to commit", http.StatusInternalServerError)
		return
	}
	auditLog(ctx, conn, orgID, userID, "change_password", "user", userID, nil)
	w.WriteHeader(http.StatusNoContent)
}
