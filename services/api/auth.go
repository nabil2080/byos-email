package main

// Evidence:
// - tests/auth_api.ps1 (13 behaviors): register 201 {id,email,org_id} +
//   HttpOnly/SameSite=Lax/Path cookie, no password leak; duplicate 409;
//   invalid 400; login 200+cookie; wrong/unknown 401 generic; /me 200/401;
//   logout 204 + old session 401; expired 401; rate limit 429; token stored
//   as hash (not plaintext); org isolation 403.
// - ROADMAP_STATUS.md Section 14: Argon2id (m=65536,t=3,p=2,salt 16,hash 32),
//   session 32B base64.RawURLEncoding + SHA256 hash, byos_session HttpOnly
//   SameSite Lax (Secure via BYOS_ENV=production), getSessionUserID /
//   getAuthenticatedUserID with BYOS_LEGACY_AUTH_ENABLED=false default,
//   register/login/me/logout + audit_log + Redis 5/min per IP/email.
// - apps/control-plane/src/lib/api/auth.ts: POST register/login
//   {email,password} -> {id,email,org_id}; POST logout (204 ok);
//   GET me -> {id,email,org_id,display_name}; credentials:include.
// - infra/postgres/init/008_auth_sessions.sql: sessions table.
// - api.exe symbols: getUserID, getSessionUserID, getAuthenticatedUserID,
//   generateSessionToken, setSessionCookie, clearSessionCookie, hashPassword,
//   verifyPassword, registerHandler, loginHandler, meHandler, logoutHandler.

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/argon2"
)

func getUserID(r *http.Request) (string, bool) {
	uid := r.Header.Get("X-User-Id")
	if uid == "" {
		uid = r.Header.Get("X-User-ID")
	}
	if uid == "" {
		return "", false
	}
	if _, err := uuid.Parse(uid); err != nil {
		return "", false
	}
	return uid, true
}

func isLegacyAuthEnabled() bool {
	return os.Getenv("BYOS_LEGACY_AUTH_ENABLED") == "true"
}

func hashPassword(password string) (string, error) {
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	hash := argon2.IDKey([]byte(password), salt, 3, 64*1024, 2, 32)
	b64Salt := base64.RawStdEncoding.EncodeToString(salt)
	b64Hash := base64.RawStdEncoding.EncodeToString(hash)
	return fmt.Sprintf("$argon2id$v=19$m=65536,t=3,p=2$%s$%s", b64Salt, b64Hash), nil
}

func verifyPassword(hash, password string) bool {
	parts := strings.Split(hash, "$")
	if len(parts) != 6 {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false
	}
	expected, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil {
		return false
	}
	computed := argon2.IDKey([]byte(password), salt, 3, 64*1024, 2, 32)
	if len(computed) != len(expected) {
		return false
	}
	// constant time compare
	var diff byte
	for i := range computed {
		diff |= computed[i] ^ expected[i]
	}
	return diff == 0
}

func generateSessionToken() (string, []byte) {
	b := make([]byte, 32)
	rand.Read(b)
	token := base64.RawURLEncoding.EncodeToString(b)
	h := sha256.Sum256([]byte(token))
	return token, h[:]
}

func hashToken(token string) []byte {
	h := sha256.Sum256([]byte(token))
	return h[:]
}

func setSessionCookie(w http.ResponseWriter, token string, expires time.Time) {
	secure := os.Getenv("BYOS_COOKIE_SECURE") == "true"
	if os.Getenv("BYOS_ENV") == "production" {
		secure = true
	}
	http.SetCookie(w, &http.Cookie{
		Name:     "byos_session",
		Value:    token,
		Path:     "/",
		Expires:  expires,
		MaxAge:   int(time.Until(expires).Seconds()),
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	})
}

func clearSessionCookie(w http.ResponseWriter) {
	secure := os.Getenv("BYOS_COOKIE_SECURE") == "true"
	if os.Getenv("BYOS_ENV") == "production" {
		secure = true
	}
	http.SetCookie(w, &http.Cookie{
		Name:     "byos_session",
		Value:    "",
		Path:     "/",
		Expires:  time.Unix(0, 0),
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
	})
}

func getSessionUserID(r *http.Request) (string, bool) {
	cookie, err := r.Cookie("byos_session")
	if err != nil || cookie.Value == "" {
		return "", false
	}
	tokenHash := hashToken(cookie.Value)
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		return "", false
	}
	defer conn.Close(ctx)
	var userID string
	err = conn.QueryRow(ctx, `SELECT user_id::text FROM sessions WHERE token_hash=$1 AND expires_at > now() AND revoked_at IS NULL`, tokenHash).Scan(&userID)
	if err != nil {
		return "", false
	}
	if _, err := uuid.Parse(userID); err != nil {
		return "", false
	}
	return userID, true
}

func getAuthenticatedUserID(r *http.Request) (string, bool) {
	if uid, ok := getSessionUserID(r); ok {
		return uid, true
	}
	if isLegacyAuthEnabled() {
		if uid, ok := getUserID(r); ok {
			return uid, true
		}
	}
	return "", false
}

func isAuthenticatedForOrg(userID, orgID string, conn *pgx.Conn) bool {
	var count int
	err := conn.QueryRow(context.Background(),
		`SELECT count(*) FROM users WHERE id=$1 AND org_id=$2 AND is_active=true`, userID, orgID).Scan(&count)
	if err != nil || count == 0 {
		return false
	}
	return true
}

func registerHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var req struct {
		Email         string `json:"email"`
		Password      string `json:"password"`
		OrgRecoveryPK string `json:"org_recovery_pk"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	email := strings.TrimSpace(strings.ToLower(req.Email))
	password := req.Password
	if email == "" || !strings.Contains(email, "@") || len(email) > 254 {
		http.Error(w, "invalid email", http.StatusBadRequest)
		return
	}
	if len(password) < 8 || len(password) > 128 {
		http.Error(w, "password must be 8-128 characters", http.StatusBadRequest)
		return
	}
	recPk, err := hex.DecodeString(strings.TrimSpace(req.OrgRecoveryPK))
	if err != nil || len(recPk) != 32 {
		http.Error(w, "org_recovery_pk must be a 32-byte hex public key", http.StatusBadRequest)
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
	// Check duplicate email
	var existing string
	err = conn.QueryRow(ctx, `SELECT id::text FROM users WHERE email=$1`, email).Scan(&existing)
	if err == nil {
		http.Error(w, "email already registered", http.StatusConflict)
		return
	}
	hash, err := hashPassword(password)
	if err != nil {
		http.Error(w, "failed to hash password", http.StatusInternalServerError)
		return
	}
	// Create org and user atomically
	tx, err := conn.Begin(ctx)
	if err != nil {
		http.Error(w, "Failed to begin transaction", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)
	orgID := uuid.New().String()
	orgName := strings.Split(email, "@")[0] + "'s organization"
	err = tx.QueryRow(ctx, `INSERT INTO organizations (id, name, org_recovery_pk) VALUES ($1, $2, $3) RETURNING id::text`, orgID, orgName, recPk).Scan(&orgID)
	if err != nil {
		http.Error(w, "failed to create organization", http.StatusInternalServerError)
		return
	}
	userID := uuid.New().String()
	err = tx.QueryRow(ctx, `INSERT INTO users (id, org_id, email, password_hash, display_name, is_active, role) VALUES ($1, $2, $3, $4, $5, true, 'owner') RETURNING id::text`, userID, orgID, email, hash, strings.Split(email, "@")[0]).Scan(&userID)
	if err != nil {
		http.Error(w, "failed to create user", http.StatusInternalServerError)
		return
	}
	token, tokenHash := generateSessionToken()
	expires := time.Now().Add(30 * 24 * time.Hour)
	_, err = tx.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`, userID, tokenHash, expires)
	if err != nil {
		http.Error(w, "failed to create session", http.StatusInternalServerError)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "failed to commit", http.StatusInternalServerError)
		return
	}
	auditLog(ctx, conn, orgID, userID, "register", "user", userID, map[string]interface{}{"email": email})
	setSessionCookie(w, token, expires)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{"id": userID, "email": email, "org_id": orgID})
}

func loginHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	// Rate limiting: per-IP and per-email, 5/min
	ip := r.RemoteAddr
	if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
		ip = strings.Split(fwd, ",")[0]
	}
	ip = strings.TrimSpace(strings.Split(ip, ":")[0])
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	email := strings.TrimSpace(strings.ToLower(req.Email))
	password := req.Password
	if email == "" || password == "" {
		http.Error(w, "invalid credentials", http.StatusUnauthorized)
		return
	}
	// Authentication rate limiting fails closed so Redis outages cannot bypass
	// brute-force protection.
	if redisClient == nil {
		http.Error(w, "authentication rate limiter unavailable", http.StatusServiceUnavailable)
		return
	}
	ctx := context.Background()
	keys := []string{"auth:login:ip:" + ip, "auth:login:email:" + email}
	for _, k := range keys {
		cnt, err := redisClient.Get(ctx, k).Int()
		if err != nil && err != redis.Nil {
			log.Printf("login rate check failed: %v", err)
			http.Error(w, "authentication rate limiter unavailable", http.StatusServiceUnavailable)
			return
		}
		if cnt >= 5 {
			w.Header().Set("Retry-After", "60")
			http.Error(w, "too many attempts, try later", http.StatusTooManyRequests)
			return
		}
	}
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)
	var userID, orgID, hash string
	var isActive bool
	err = conn.QueryRow(ctx, `SELECT id::text, org_id::text, password_hash, is_active FROM users WHERE email=$1`, email).Scan(&userID, &orgID, &hash, &isActive)
	if err != nil || !isActive || !verifyPassword(hash, password) {
		if redisClient != nil {
			ctx2 := context.Background()
			redisClient.Incr(ctx2, "auth:login:ip:"+ip)
			redisClient.Expire(ctx2, "auth:login:ip:"+ip, time.Minute)
			redisClient.Incr(ctx2, "auth:login:email:"+email)
			redisClient.Expire(ctx2, "auth:login:email:"+email, time.Minute)
		}
		auditLog(ctx, conn, "", "", "failed_login", "user", "", map[string]interface{}{"email": email})
		http.Error(w, "invalid credentials", http.StatusUnauthorized)
		return
	}
	token, tokenHash := generateSessionToken()
	expires := time.Now().Add(30 * 24 * time.Hour)
	_, err = conn.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`, userID, tokenHash, expires)
	if err != nil {
		http.Error(w, "failed to create session", http.StatusInternalServerError)
		return
	}
	auditLog(ctx, conn, orgID, userID, "login", "user", userID, map[string]interface{}{"email": email})
	setSessionCookie(w, token, expires)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"id": userID, "email": email, "org_id": orgID})
}

func meHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userID, ok := getSessionUserID(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
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
	var id, email, orgID, displayName string
	var isActive bool
	err = conn.QueryRow(ctx, `SELECT id::text, email, org_id::text, COALESCE(display_name,''), is_active FROM users WHERE id=$1`, userID).Scan(&id, &email, &orgID, &displayName, &isActive)
	if err != nil || !isActive {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"id": id, "email": email, "org_id": orgID, "display_name": displayName})
}

func logoutHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	cookie, err := r.Cookie("byos_session")
	if err != nil || cookie.Value == "" {
		clearSessionCookie(w)
		w.WriteHeader(http.StatusNoContent)
		return
	}
	tokenHash := hashToken(cookie.Value)
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err == nil {
		defer conn.Close(ctx)
		var userID, orgID string
		_ = conn.QueryRow(ctx, `SELECT user_id::text FROM sessions WHERE token_hash=$1`, tokenHash).Scan(&userID)
		if userID != "" {
			_ = conn.QueryRow(ctx, `SELECT org_id::text FROM users WHERE id=$1`, userID).Scan(&orgID)
			auditLog(ctx, conn, orgID, userID, "logout", "user", userID, nil)
		}
		_, _ = conn.Exec(ctx, `UPDATE sessions SET revoked_at=now() WHERE token_hash=$1`, tokenHash)
	}
	clearSessionCookie(w)
	w.WriteHeader(http.StatusNoContent)
}
