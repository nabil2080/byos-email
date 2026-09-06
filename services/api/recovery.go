package main

// Evidence:
// - Route table: POST /v1/auth/recovery-enroll, POST /v1/auth/recovery-challenge.
// - api.exe symbols: recoveryEnrollHandler, recoveryChallengeHandler,
//   verifyEd25519Signature.
// - infra/postgres/init/009_recovery_verifiers.sql: users.recovery_auth_pk
//   bytea NULL, recovery_auth_version smallint NULL|1 (+check), unique idx
//   where not null; never backfilled server-side.
// - ROADMAP_STATUS.md Section 15 foundation: client-side mnemonic/verify,
//   no server plaintext; apps/control-plane recovery.tsx is client-only.
// - No ps1 suite and no frontend client call these endpoints in V1, so the
//   handlers below are minimal server-side verifier storage/challenge helpers.
// Reconstruction judgments flagged inline; no recovery-recover route exists,
// so no challenge-consumption semantics are implemented.

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
	// Reject re-enrollment while a verifier is already enrolled.
	var currentPk []byte
	var currentVersion *int
	err = conn.QueryRow(ctx, `SELECT recovery_auth_pk, recovery_auth_version FROM users WHERE id=$1 AND is_active=true`, userID).Scan(&currentPk, &currentVersion)
	if err != nil {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}
	if currentPk != nil {
		http.Error(w, "recovery verifier already enrolled", http.StatusConflict)
		return
	}
	_, err = conn.Exec(ctx, `UPDATE users SET recovery_auth_pk=$1, recovery_auth_version=1 WHERE id=$2`, pkBytes, userID)
	if err != nil {
		http.Error(w, "failed to enroll recovery verifier", http.StatusInternalServerError)
		return
	}
	var orgID string
	_ = conn.QueryRow(ctx, `SELECT org_id::text FROM users WHERE id=$1`, userID).Scan(&orgID)
	auditLog(ctx, conn, orgID, userID, "recovery_enroll", "user", userID, nil)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{"id": userID, "recovery_enrolled": true})
}

func recoveryChallengeHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
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
	// Do not leak enrollment state beyond a generic not-enrolled response.
	var userID string
	var verifier []byte
	err = conn.QueryRow(ctx, `SELECT id::text, recovery_auth_pk FROM users WHERE email=$1 AND is_active=true`, email).Scan(&userID, &verifier)
	if err != nil || verifier == nil {
		http.Error(w, "recovery not enrolled", http.StatusNotFound)
		return
	}
	challengeID := uuid.New().String()
	expiresAt := time.Now().Add(5 * time.Minute)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"challenge_id": challengeID,
		"expires_at":   expiresAt.Format(time.RFC3339),
	})
}
