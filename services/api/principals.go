package main

// Section 15 org recovery principals.
//
// A principal binds a user to a passphrase-wrapped copy of the org recovery
// secret: the client KDFs the passphrase (Argon2id, frozen cost profile) and
// AES-GCM-wraps the secret locally; the server stores the envelope opaquely
// and never sees the passphrase, the wrapping key, or the secret. Recovery
// unwraps client-side identically.
//
// Frozen parameter pinning: kdf_algorithm MUST be "argon2id", kdf_version 1,
// memory 65536 KiB, iterations 3, parallelism 2 — the single canonical cost
// profile shared with password hashing. Anything else is rejected so a
// weak-parameter principal can never be enrolled.
// Enrollment and revocation are owner-only (same blast radius as
// terminate/role-change); listing additionally allows admins. Rows are never
// deleted (revocation preserves the audit trail).

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Frozen recovery-principal KDF profile (mirrors crypto-core
// RECOVERY_KDF_* and server password hashing — one set to audit).
const (
	recoveryKDFAlgorithm   = "argon2id"
	recoveryKDFVersion     = 1
	recoveryKDFMemoryKiB   = 65536
	recoveryKDFIterations  = 3
	recoveryKDFParallelism = 2
	recoveryKDFSaltBytes   = 16
	// Bound the opaque envelope (an AES-GCM envelope around 32 bytes of key
	// material is ~61 bytes; 4 KiB leaves ample headroom without inviting
	// storage abuse through this endpoint).
	recoveryPrincipalMaxSKB64 = 8192
)

type recoveryPrincipalResponse struct {
	ID               string  `json:"id"`
	UserID           string  `json:"user_id"`
	OrgID            string  `json:"org_id"`
	PrincipalName    string  `json:"principal_name"`
	KDFAlgorithm     string  `json:"kdf_algorithm"`
	KDFVersion       int     `json:"kdf_version"`
	KDFSalt          string  `json:"kdf_salt"`
	KDFMemory        int     `json:"kdf_memory"`
	KDFIterations    int     `json:"kdf_iterations"`
	KDFParallelism   int     `json:"kdf_parallelism"`
	OrgRecoveryPK    string  `json:"org_recovery_pk"`
	OrgRecoverySKEnc *string `json:"org_recovery_sk_encrypted,omitempty"`
	IsActive         bool    `json:"is_active"`
	CreatedAt        string  `json:"created_at"`
	DeactivatedAt    *string `json:"deactivated_at,omitempty"`
}

func scanRecoveryPrincipal(
	id, userID, orgID, name, kdfAlg string,
	kdfVer int,
	salt, wrapped, pk []byte,
	kdfMem, kdfIter, kdfPar int,
	isActive bool,
	createdAt time.Time,
	deactivatedAt *time.Time,
	includeCiphertext bool,
) recoveryPrincipalResponse {
	resp := recoveryPrincipalResponse{
		ID:             id,
		UserID:         userID,
		OrgID:          orgID,
		PrincipalName:  name,
		KDFAlgorithm:   kdfAlg,
		KDFVersion:     kdfVer,
		KDFSalt:        base64.StdEncoding.EncodeToString(salt),
		KDFMemory:      kdfMem,
		KDFIterations:  kdfIter,
		KDFParallelism: kdfPar,
		OrgRecoveryPK:  base64.StdEncoding.EncodeToString(pk),
		IsActive:       isActive,
		CreatedAt:      createdAt.Format(time.RFC3339),
	}
	if includeCiphertext {
		enc := base64.StdEncoding.EncodeToString(wrapped)
		resp.OrgRecoverySKEnc = &enc
	}
	if deactivatedAt != nil {
		formatted := deactivatedAt.Format(time.RFC3339)
		resp.DeactivatedAt = &formatted
	}
	return resp
}

func openPrincipalDB(w http.ResponseWriter, r *http.Request) (*pgx.Conn, string, string, bool) {
	orgID := r.PathValue("org_id")
	if _, err := uuid.Parse(orgID); err != nil {
		http.Error(w, "organization ID must be UUID", http.StatusBadRequest)
		return nil, "", "", false
	}
	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return nil, "", "", false
	}
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	conn, err := pgx.Connect(r.Context(), dsn)
	if err != nil {
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return nil, "", "", false
	}
	return conn, orgID, userID, true
}

func requirePrincipalOwner(w http.ResponseWriter, ctx context.Context, conn *pgx.Conn, userID, orgID string) bool {
	var orgExists string
	if err := conn.QueryRow(ctx, `SELECT id::text FROM organizations WHERE id=$1`, orgID).Scan(&orgExists); err != nil {
		http.Error(w, "organization not found", http.StatusNotFound)
		return false
	}
	if !isOwner(userID, orgID, conn) {
		http.Error(w, "only organization owner can manage recovery principals", http.StatusForbidden)
		return false
	}
	return true
}

// recoveryPrincipalsHandler routes collection (POST enroll, GET list) and
// item (GET one, POST revoke) actions.
func recoveryPrincipalsHandler(w http.ResponseWriter, r *http.Request) {
	conn, orgID, userID, ok := openPrincipalDB(w, r)
	if !ok {
		return
	}
	defer conn.Close(r.Context())
	ctx := r.Context()

	principalID := r.PathValue("principal_id")
	isRevoke := r.PathValue("action") == "revoke" || strings.HasSuffix(r.URL.Path, "/revoke")

	switch {
	case principalID == "" && r.Method == http.MethodPost:
		recoveryPrincipalEnrollHandler(w, r, conn, ctx, orgID, userID)
	case principalID == "" && r.Method == http.MethodGet:
		recoveryPrincipalListHandler(w, r, conn, ctx, orgID, userID)
	case principalID != "" && !isRevoke && r.Method == http.MethodGet:
		recoveryPrincipalGetHandler(w, r, conn, ctx, orgID, userID, principalID)
	case principalID != "" && isRevoke && r.Method == http.MethodPost:
		recoveryPrincipalRevokeHandler(w, r, conn, ctx, orgID, userID, principalID)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func recoveryPrincipalEnrollHandler(w http.ResponseWriter, r *http.Request, conn *pgx.Conn, ctx context.Context, orgID, userID string) {
	if !requirePrincipalOwner(w, ctx, conn, userID, orgID) {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var req struct {
		UserID                 string `json:"user_id"`
		PrincipalName          string `json:"principal_name"`
		KDFAlgorithm           string `json:"kdf_algorithm"`
		KDFVersion             int    `json:"kdf_version"`
		KDFSalt                string `json:"kdf_salt"`
		KDFMemory              int    `json:"kdf_memory"`
		KDFIterations          int    `json:"kdf_iterations"`
		KDFParallelism         int    `json:"kdf_parallelism"`
		OrgRecoverySKEncrypted string `json:"org_recovery_sk_encrypted"`
		OrgRecoveryPK          string `json:"org_recovery_pk"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	// Pin the frozen KDF profile: nothing weaker (or merely different) may
	// be enrolled, so clients can rely on a single parameter set.
	if req.KDFAlgorithm != recoveryKDFAlgorithm ||
		req.KDFVersion != recoveryKDFVersion ||
		req.KDFMemory != recoveryKDFMemoryKiB ||
		req.KDFIterations != recoveryKDFIterations ||
		req.KDFParallelism != recoveryKDFParallelism {
		http.Error(w, "kdf parameters must match the frozen profile (argon2id v1 m=65536 t=3 p=2)", http.StatusBadRequest)
		return
	}
	name := strings.TrimSpace(req.PrincipalName)
	if name == "" || len(name) > 128 {
		http.Error(w, "principal_name required (max 128 chars)", http.StatusBadRequest)
		return
	}
	salt, err := base64.StdEncoding.DecodeString(strings.TrimSpace(req.KDFSalt))
	if err != nil || len(salt) != recoveryKDFSaltBytes {
		http.Error(w, "kdf_salt must be base64 16 bytes", http.StatusBadRequest)
		return
	}
	wrapped, err := base64.StdEncoding.DecodeString(strings.TrimSpace(req.OrgRecoverySKEncrypted))
	if err != nil || len(wrapped) == 0 || len(strings.TrimSpace(req.OrgRecoverySKEncrypted)) > recoveryPrincipalMaxSKB64 {
		http.Error(w, "org_recovery_sk_encrypted must be non-empty base64", http.StatusBadRequest)
		return
	}
	pk, err := base64.StdEncoding.DecodeString(strings.TrimSpace(req.OrgRecoveryPK))
	if err != nil || len(pk) != 32 {
		http.Error(w, "org_recovery_pk must be base64 32 bytes", http.StatusBadRequest)
		return
	}
	targetUser := strings.TrimSpace(req.UserID)
	if _, err := uuid.Parse(targetUser); err != nil {
		http.Error(w, "user_id must be UUID", http.StatusBadRequest)
		return
	}
	var targetOrg string
	if err := conn.QueryRow(ctx, `SELECT org_id::text FROM users WHERE id=$1 AND is_active=true`, targetUser).Scan(&targetOrg); err != nil || targetOrg != orgID {
		http.Error(w, "user not found in this organization", http.StatusNotFound)
		return
	}
	var dup string
	if err := conn.QueryRow(ctx, `SELECT id::text FROM org_recovery_principals WHERE org_id=$1 AND principal_name=$2 AND deactivated_at IS NULL`, orgID, name).Scan(&dup); err == nil {
		http.Error(w, "principal name already enrolled", http.StatusConflict)
		return
	}
	var id string
	var createdAt time.Time
	err = conn.QueryRow(ctx, `
		INSERT INTO org_recovery_principals
		  (user_id, org_id, principal_name, kdf_algorithm, kdf_version, kdf_salt,
		   kdf_memory, kdf_iterations, kdf_parallelism,
		   org_recovery_sk_encrypted, org_recovery_pk)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		RETURNING id::text, created_at
	`, targetUser, orgID, name,
		recoveryKDFAlgorithm, recoveryKDFVersion, salt,
		recoveryKDFMemoryKiB, recoveryKDFIterations, recoveryKDFParallelism,
		wrapped, pk).Scan(&id, &createdAt)
	if err != nil {
		http.Error(w, "failed to enroll recovery principal", http.StatusInternalServerError)
		return
	}
	auditLog(ctx, conn, orgID, userID, "recovery_principal_enroll", "recovery_principal", id,
		map[string]interface{}{"principal_name": name})
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(recoveryPrincipalResponse{
		ID: id, UserID: targetUser, OrgID: orgID, PrincipalName: name,
		KDFAlgorithm: recoveryKDFAlgorithm, KDFVersion: recoveryKDFVersion,
		KDFSalt:   base64.StdEncoding.EncodeToString(salt),
		KDFMemory: recoveryKDFMemoryKiB, KDFIterations: recoveryKDFIterations,
		KDFParallelism: recoveryKDFParallelism,
		OrgRecoveryPK:  base64.StdEncoding.EncodeToString(pk),
		IsActive:       true, CreatedAt: createdAt.Format(time.RFC3339),
	})
}

func recoveryPrincipalListHandler(w http.ResponseWriter, r *http.Request, conn *pgx.Conn, ctx context.Context, orgID, userID string) {
	var orgExists string
	if err := conn.QueryRow(ctx, `SELECT id::text FROM organizations WHERE id=$1`, orgID).Scan(&orgExists); err != nil {
		http.Error(w, "organization not found", http.StatusNotFound)
		return
	}
	// Listing additionally allows admins; the ciphertext is never listed.
	var actorOrg string
	if err := conn.QueryRow(ctx, `SELECT org_id::text FROM users WHERE id=$1 AND is_active=true`, userID).Scan(&actorOrg); err != nil || actorOrg != orgID {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	if !isAdmin(userID, orgID, conn) {
		http.Error(w, "administrator role required", http.StatusForbidden)
		return
	}
	rows, err := conn.Query(ctx, `
		SELECT id::text, user_id::text, org_id::text, principal_name,
		       kdf_algorithm, kdf_version, kdf_salt,
		       kdf_memory, kdf_iterations, kdf_parallelism,
		       org_recovery_pk, is_active, created_at, deactivated_at
		FROM org_recovery_principals
		WHERE org_id=$1
		ORDER BY created_at DESC`, orgID)
	if err != nil {
		http.Error(w, "failed to list recovery principals", http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	principals := make([]recoveryPrincipalResponse, 0)
	for rows.Next() {
		var id, uid, oid, name, alg string
		var ver, mem, iters, par int
		var salt, pk []byte
		var active bool
		var created time.Time
		var deactivated *time.Time
		if err := rows.Scan(&id, &uid, &oid, &name, &alg, &ver, &salt,
			&mem, &iters, &par, &pk, &active, &created, &deactivated); err != nil {
			continue
		}
		principals = append(principals, scanRecoveryPrincipal(
			id, uid, oid, name, alg, ver, salt, nil, pk, mem, iters, par,
			active, created, deactivated, false))
	}
	if err := rows.Err(); err != nil {
		http.Error(w, "failed to read recovery principals", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"principals": principals})
}

func recoveryPrincipalGetHandler(w http.ResponseWriter, r *http.Request, conn *pgx.Conn, ctx context.Context, orgID, userID, principalID string) {
	if _, err := uuid.Parse(principalID); err != nil {
		http.Error(w, "principal ID must be UUID", http.StatusBadRequest)
		return
	}
	var actorOrg string
	if err := conn.QueryRow(ctx, `SELECT org_id::text FROM users WHERE id=$1 AND is_active=true`, userID).Scan(&actorOrg); err != nil || actorOrg != orgID {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	if !isAdmin(userID, orgID, conn) {
		http.Error(w, "administrator role required", http.StatusForbidden)
		return
	}
	var id, uid, oid, name, alg string
	var ver, mem, iters, par int
	var salt, wrapped, pk []byte
	var active bool
	var created time.Time
	var deactivated *time.Time
	err := conn.QueryRow(ctx, `
		SELECT id::text, user_id::text, org_id::text, principal_name,
		       kdf_algorithm, kdf_version, kdf_salt,
		       kdf_memory, kdf_iterations, kdf_parallelism,
		       org_recovery_sk_encrypted, org_recovery_pk,
		       is_active, created_at, deactivated_at
		FROM org_recovery_principals
		WHERE id=$1 AND org_id=$2`, principalID, orgID).Scan(
		&id, &uid, &oid, &name, &alg, &ver, &salt,
		&mem, &iters, &par, &wrapped, &pk, &active, &created, &deactivated)
	if err != nil {
		http.Error(w, "recovery principal not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(scanRecoveryPrincipal(
		id, uid, oid, name, alg, ver, salt, wrapped, pk, mem, iters, par,
		active, created, deactivated, true))
}

func recoveryPrincipalRevokeHandler(w http.ResponseWriter, r *http.Request, conn *pgx.Conn, ctx context.Context, orgID, userID, principalID string) {
	if _, err := uuid.Parse(principalID); err != nil {
		http.Error(w, "principal ID must be UUID", http.StatusBadRequest)
		return
	}
	if !requirePrincipalOwner(w, ctx, conn, userID, orgID) {
		return
	}
	// Idempotent: revoking twice is not an error; the row is preserved.
	var id string
	var active bool
	err := conn.QueryRow(ctx, `
		UPDATE org_recovery_principals
		SET is_active=false, deactivated_at=COALESCE(deactivated_at, now())
		WHERE id=$1 AND org_id=$2
		RETURNING id::text, is_active`, principalID, orgID).Scan(&id, &active)
	if err != nil {
		http.Error(w, "recovery principal not found", http.StatusNotFound)
		return
	}
	auditLog(ctx, conn, orgID, userID, "recovery_principal_revoke", "recovery_principal", id, nil)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"id": id, "is_active": active})
}
