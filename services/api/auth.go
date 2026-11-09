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
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
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

func parseIPHost(addr string) string {
	addr = strings.TrimSpace(addr)
	if addr == "" {
		return ""
	}
	if host, _, err := net.SplitHostPort(addr); err == nil {
		return strings.Trim(host, "[]")
	}
	// Address has no port attached
	return strings.Trim(addr, "[]")
}

func getClientIP(r *http.Request) string {
	if r == nil {
		return "127.0.0.1"
	}
	directHost := parseIPHost(r.RemoteAddr)

	// Only trust X-Forwarded-For if explicitly configured via BYOS_TRUST_PROXY=true
	// or if the request came from local loopback (127.0.0.1 / ::1) in dev/container mode.
	trustProxy := os.Getenv("BYOS_TRUST_PROXY") == "true" || directHost == "127.0.0.1" || directHost == "::1" || directHost == "localhost"
	if trustProxy {
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			parts := strings.Split(xff, ",")
			if len(parts) > 0 {
				client := parseIPHost(parts[0])
				if client != "" {
					return client
				}
			}
		}
	}
	if directHost != "" {
		return directHost
	}
	return "127.0.0.1"
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

func createSession(ctx context.Context, conn *pgx.Conn, userID string, duration time.Duration, userAgent, ipAddress string) (string, time.Time, error) {
	token, tokenHash := generateSessionToken()
	expires := time.Now().Add(duration)
	_, err := conn.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, expires_at, ip_address, user_agent, last_active_at) VALUES ($1, $2, $3, $4, $5, now())`, userID, tokenHash, expires, ipAddress, userAgent)
	return token, expires, err
}

func detectClient(r *http.Request) string {
	if r == nil {
		return ""
	}
	client := strings.TrimSpace(strings.ToLower(r.Header.Get("X-BYOS-Client")))
	if client == "control-plane" || client == "control_plane" || client == "admin" {
		return "control-plane"
	}
	if client == "webmail" {
		return "webmail"
	}
	origin := strings.ToLower(r.Header.Get("Origin"))
	referer := strings.ToLower(r.Header.Get("Referer"))
	if strings.Contains(origin, ":3000") || strings.Contains(referer, ":3000") {
		return "control-plane"
	}
	if strings.Contains(origin, ":3001") || strings.Contains(referer, ":3001") {
		return "webmail"
	}
	return ""
}

func setSessionCookie(w http.ResponseWriter, r *http.Request, token string, expires time.Time) {
	secure := os.Getenv("BYOS_COOKIE_SECURE") == "true"
	if os.Getenv("BYOS_ENV") == "production" {
		secure = true
	}
	maxAge := int(time.Until(expires).Seconds())
	client := detectClient(r)

	// Set client-specific cookie to strictly isolate control-plane and webmail on localhost
	if client == "control-plane" {
		http.SetCookie(w, &http.Cookie{
			Name:     "byos_cp_session",
			Value:    token,
			Path:     "/",
			Expires:  expires,
			MaxAge:   maxAge,
			HttpOnly: true,
			Secure:   secure,
			SameSite: http.SameSiteLaxMode,
		})
	} else if client == "webmail" {
		http.SetCookie(w, &http.Cookie{
			Name:     "byos_webmail_session",
			Value:    token,
			Path:     "/",
			Expires:  expires,
			MaxAge:   maxAge,
			HttpOnly: true,
			Secure:   secure,
			SameSite: http.SameSiteLaxMode,
		})
	} else {
		// Only set generic byos_session for test scripts/CLI without specific client
		http.SetCookie(w, &http.Cookie{
			Name:     "byos_session",
			Value:    token,
			Path:     "/",
			Expires:  expires,
			MaxAge:   maxAge,
			HttpOnly: true,
			Secure:   secure,
			SameSite: http.SameSiteLaxMode,
		})
	}
}

func clearSessionCookie(w http.ResponseWriter, r *http.Request) {
	secure := os.Getenv("BYOS_COOKIE_SECURE") == "true"
	if os.Getenv("BYOS_ENV") == "production" {
		secure = true
	}
	client := detectClient(r)
	if client == "control-plane" {
		http.SetCookie(w, &http.Cookie{
			Name:     "byos_cp_session",
			Value:    "",
			Path:     "/",
			Expires:  time.Unix(0, 0),
			MaxAge:   -1,
			HttpOnly: true,
			Secure:   secure,
			SameSite: http.SameSiteLaxMode,
		})
	} else if client == "webmail" {
		http.SetCookie(w, &http.Cookie{
			Name:     "byos_webmail_session",
			Value:    "",
			Path:     "/",
			Expires:  time.Unix(0, 0),
			MaxAge:   -1,
			HttpOnly: true,
			Secure:   secure,
			SameSite: http.SameSiteLaxMode,
		})
	} else {
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
}

var (
	authDBPool  *pgxpool.Pool
	authDBOnce  sync.Once
	authDBMutex sync.Mutex
)

// InitAuthDBPool initializes the centralized auth connection pool.
func InitAuthDBPool(ctx context.Context) (*pgxpool.Pool, error) {
	return getAuthDBPool(ctx)
}

// CloseAuthDBPool closes the centralized auth connection pool gracefully.
func CloseAuthDBPool() {
	authDBMutex.Lock()
	defer authDBMutex.Unlock()
	if authDBPool != nil {
		authDBPool.Close()
		authDBPool = nil
		authDBOnce = sync.Once{}
	}
}

func getAuthDBPool(ctx context.Context) (*pgxpool.Pool, error) {
	if authDBPool != nil {
		return authDBPool, nil
	}
	authDBMutex.Lock()
	defer authDBMutex.Unlock()
	if authDBPool != nil {
		return authDBPool, nil
	}

	var initErr error
	authDBOnce.Do(func() {
		dsn := os.Getenv("DATABASE_URL")
		if dsn == "" {
			dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
		}
		cfg, err := pgxpool.ParseConfig(dsn)
		if err != nil {
			initErr = err
			return
		}

		minConns := 2
		if v := os.Getenv("DB_POOL_MIN_CONNS"); v != "" {
			if n, err := strconv.Atoi(v); err == nil && n >= 0 {
				minConns = n
			}
		}
		maxConns := 25
		if v := os.Getenv("DB_POOL_MAX_CONNS"); v != "" {
			if n, err := strconv.Atoi(v); err == nil && n > 0 {
				maxConns = n
			}
		}

		cfg.MinConns = int32(minConns)
		cfg.MaxConns = int32(maxConns)
		cfg.MaxConnLifetime = 30 * time.Minute
		cfg.MaxConnIdleTime = 5 * time.Minute
		authDBPool, initErr = pgxpool.NewWithConfig(context.Background(), cfg)
	})
	if initErr != nil {
		authDBOnce = sync.Once{}
		return nil, initErr
	}
	return authDBPool, nil
}

func getSessionUserID(r *http.Request) (string, bool) {
	var token string
	if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") && strings.TrimSpace(strings.TrimPrefix(auth, "Bearer ")) != "" {
		token = strings.TrimSpace(strings.TrimPrefix(auth, "Bearer "))
	} else {
		client := detectClient(r)
		if client == "control-plane" {
			if cookie, err := r.Cookie("byos_cp_session"); err == nil && cookie.Value != "" {
				token = cookie.Value
			}
		} else if client == "webmail" {
			if cookie, err := r.Cookie("byos_webmail_session"); err == nil && cookie.Value != "" {
				token = cookie.Value
			}
		} else {
			if cookie, err := r.Cookie("byos_session"); err == nil && cookie.Value != "" {
				token = cookie.Value
			} else if cookie, err := r.Cookie("byos_cp_session"); err == nil && cookie.Value != "" {
				token = cookie.Value
			} else if cookie, err := r.Cookie("byos_webmail_session"); err == nil && cookie.Value != "" {
				token = cookie.Value
			}
		}
	}
	if token == "" {
		return "", false
	}
	tokenHash := hashToken(token)

	pool, err := getAuthDBPool(r.Context())
	if err != nil || pool == nil {
		// Fallback to direct connection if pool fails
		dsn := os.Getenv("DATABASE_URL")
		if dsn == "" {
			dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
		}
		ctx := r.Context()
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

	var userID string
	err = pool.QueryRow(r.Context(), `SELECT user_id::text FROM sessions WHERE token_hash=$1 AND expires_at > now() AND revoked_at IS NULL`, tokenHash).Scan(&userID)
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
		OrgName              string `json:"org_name"`
		Name                 string `json:"name"`
		Email                string `json:"email"`
		Password             string `json:"password"`
		RecoveryEmail        string `json:"recovery_email"`
		RecoveryPhone        string `json:"recovery_phone"`
		OrgRecoveryPK        string `json:"org_recovery_pk"`
		WrappedOrgRecoverySK string `json:"wrapped_org_recovery_sk"`
		RecoverySalt         string `json:"recovery_salt"`
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
	recEmail := strings.TrimSpace(strings.ToLower(req.RecoveryEmail))
	if recEmail != "" && recEmail == email {
		http.Error(w, "recovery email must be distinct from primary account email", http.StatusBadRequest)
		return
	}
	recPhone := strings.TrimSpace(req.RecoveryPhone)
	// Deprecated recovery fields in req (org_recovery_pk, wrapped_org_recovery_sk, recovery_salt)
	// are intentionally ignored and never treated as active cryptographic material.
	// In post-migration 058 architecture, all organizations store org_recovery_pk = NULL.
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
	orgName := strings.TrimSpace(req.OrgName)
	if orgName == "" {
		orgName = strings.Split(email, "@")[0] + "'s organization"
	}
	// Migration 058 is frozen and applied: org_recovery_pk is nullable and always stored as NULL.
	// No caller-supplied recovery material is accepted or persisted as active cryptographic material.
	err = tx.QueryRow(ctx, `INSERT INTO organizations (id, name, org_recovery_pk) VALUES ($1, $2, NULL) RETURNING id::text`, orgID, orgName).Scan(&orgID)
	if err != nil {
		http.Error(w, "failed to create organization", http.StatusInternalServerError)
		return
	}
	userID := uuid.New().String()
	displayName := strings.TrimSpace(req.Name)
	if displayName == "" {
		displayName = strings.Split(email, "@")[0]
	}
	err = tx.QueryRow(ctx, `
		INSERT INTO users (id, org_id, email, password_hash, display_name, is_active, role, recovery_email, recovery_phone) 
		VALUES ($1, $2, $3, $4, $5, true, 'owner', NULLIF($6, ''), NULLIF($7, '')) 
		RETURNING id::text
	`, userID, orgID, email, hash, displayName, recEmail, recPhone).Scan(&userID)
	if err != nil {
		http.Error(w, "failed to create user", http.StatusInternalServerError)
		return
	}
	token, tokenHash := generateSessionToken()
	expires := time.Now().Add(30 * 24 * time.Hour)
	clientIP := getClientIP(r)
	userAgent := r.UserAgent()
	_, err = tx.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, expires_at, ip_address, user_agent, last_active_at) VALUES ($1, $2, $3, $4, $5, now())`, userID, tokenHash, expires, clientIP, userAgent)
	if err != nil {
		http.Error(w, "failed to create session", http.StatusInternalServerError)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "failed to commit", http.StatusInternalServerError)
		return
	}
	auditLog(ctx, conn, orgID, userID, "register", "user", userID, map[string]interface{}{"email": email})
	setSessionCookie(w, r, token, expires)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{"id": userID, "email": email, "org_id": orgID, "org_name": orgName, "token": token})
}

func loginHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	// Rate limiting: per-IP and per-email, 5/min
	ip := getClientIP(r)
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
	var userID, orgID, hash, userEmail string
	var isActive bool
	err = conn.QueryRow(ctx, `
		SELECT u.id::text, u.org_id::text, u.password_hash, u.is_active, u.email
		FROM users u
		LEFT JOIN mailboxes m ON m.user_id = u.id AND m.is_active = true
		LEFT JOIN domains d ON d.id = m.domain_id
		LEFT JOIN aliases a ON a.mailbox_id = m.id AND a.is_active = true
		LEFT JOIN domains ad ON ad.id = a.domain_id
		WHERE LOWER(u.email) = $1 
		   OR LOWER(m.local_part || '@' || d.name) = $1
		   OR LOWER(a.local_part || '@' || ad.name) = $1
		ORDER BY (LOWER(u.email) = $1) DESC
		LIMIT 1`, email).Scan(&userID, &orgID, &hash, &isActive, &userEmail)
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

	// Check if multi-factor authentication is active on this account
	var twoFactorEnabled bool
	var totpSecret, recEmail, recPhone *string
	var role string
	var passkeyCount int
	_ = conn.QueryRow(ctx, `
		SELECT u.two_factor_enabled, u.totp_secret, u.recovery_email, u.recovery_phone, u.role,
		       (SELECT COUNT(*) FROM user_passkeys pk WHERE pk.user_id = u.id)
		FROM users u WHERE u.id=$1
	`, userID).Scan(&twoFactorEnabled, &totpSecret, &recEmail, &recPhone, &role, &passkeyCount)

	hasEnrolledFactor := (totpSecret != nil && *totpSecret != "") || passkeyCount > 0
	hasMFA := twoFactorEnabled && hasEnrolledFactor

	if hasMFA {
		methods := []string{}
		preferredMethod := ""
		destinationMasked := ""
		verificationCode := ""
		challengeToken := ""

		if totpSecret != nil && *totpSecret != "" {
			methods = append(methods, "totp")
			if preferredMethod == "" {
				preferredMethod = "totp"
				destinationMasked = "Authenticator App"
			}
		}
		if passkeyCount > 0 {
			methods = append(methods, "passkey")
			if preferredMethod == "" {
				preferredMethod = "passkey"
				destinationMasked = "Hardware Security Key / Passkey"
			}
		}
		// Recovery verification contacts belong exclusively to organization owners
		if role == "owner" {
			if recPhone != nil && *recPhone != "" {
				methods = append(methods, "phone")
				if preferredMethod == "" {
					preferredMethod = "phone"
					destinationMasked = maskRecoveryDestination(*recPhone, "phone")
				}
			}
			if recEmail != nil && *recEmail != "" {
				methods = append(methods, "email")
				if preferredMethod == "" {
					preferredMethod = "email"
					destinationMasked = maskRecoveryDestination(*recEmail, "email")
				}
			}
			if len(methods) == 0 {
				methods = append(methods, "email")
				preferredMethod = "email"
				destinationMasked = maskRecoveryDestination(userEmail, "email")
			}
		}

		if len(methods) > 0 {
			if preferredMethod == "email" || preferredMethod == "phone" {
				dest := ""
				if preferredMethod == "phone" && recPhone != nil {
					dest = *recPhone
				} else if recEmail != nil {
					dest = *recEmail
				} else {
					dest = userEmail
				}
				tok, masked, dbg, err := DispatchOTP(ctx, conn, userID, dest, preferredMethod, "login_2fa", ip)
				if err != nil {
					log.Printf("[LOGIN 2FA] Dispatch failed: %v", err)
					http.Error(w, err.Error(), http.StatusInternalServerError)
					return
				}
				challengeToken = tok
				destinationMasked = masked
				verificationCode = dbg
			} else {
				tok, err := generateRandomBase64URL(32)
				if err != nil {
					http.Error(w, "failed to create 2fa challenge", http.StatusInternalServerError)
					return
				}
				challengeToken = tok
				expiresAt := time.Now().Add(5 * time.Minute)
				_, err = conn.Exec(ctx, `
					INSERT INTO auth_challenges (user_id, challenge_type, challenge_token, destination, expires_at)
					VALUES ($1, 'login_2fa', $2, $3, $4)
				`, userID, challengeToken, destinationMasked, expiresAt)
				if err != nil {
					http.Error(w, "failed to record challenge", http.StatusInternalServerError)
					return
				}
			}

			respMap := map[string]interface{}{
				"two_factor_required": true,
				"challenge_token":     challengeToken,
				"methods":             methods,
				"preferred_method":    preferredMethod,
				"destination_masked":  destinationMasked,
			}
			if verificationCode != "" {
				respMap["debug_code"] = verificationCode
			}

			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(respMap)
			return
		}

		// Account requires MFA, but only has passkey enrolled while assertion verification is paused.
		// Password-only authentication exceptions are strictly forbidden.
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":   "mfa_factor_unavailable",
			"message": "Two-factor authentication is required, but your enrolled passkey cannot be verified while assertion verification is paused. Please use an existing session to enroll an authenticator app (TOTP) in Settings, or use account recovery.",
		})
		return
	}

	token, tokenHash := generateSessionToken()
	expires := time.Now().Add(30 * 24 * time.Hour)
	clientIP := getClientIP(r)
	userAgent := r.UserAgent()
	_, err = conn.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, expires_at, ip_address, user_agent, last_active_at) VALUES ($1, $2, $3, $4, $5, now())`, userID, tokenHash, expires, clientIP, userAgent)
	if err != nil {
		http.Error(w, "failed to create session", http.StatusInternalServerError)
		return
	}
	auditLog(ctx, conn, orgID, userID, "login", "user", userID, map[string]interface{}{"email": email})
	var subscriptionStatus string
	var seatCount int
	_ = conn.QueryRow(ctx, `
		SELECT COALESCE(u.role, 'member'), COALESCE(o.seat_count, 1), COALESCE(o.subscription_status, 'active')
		FROM users u
		LEFT JOIN organizations o ON o.id = u.org_id
		WHERE u.id=$1`, userID).Scan(&role, &seatCount, &subscriptionStatus)

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

	setSessionCookie(w, r, token, expires)
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
	var id, email, orgID, displayName, role, subscriptionStatus string
	var seatCount int
	var isActive bool
	var onboardingCompletedAt *time.Time
	var onboardingCurrentStep int = 1
	var onboardingSkipped bool = false
	err = conn.QueryRow(ctx, `
		SELECT u.id::text, u.email, u.org_id::text, COALESCE(u.display_name,''), COALESCE(u.role, 'member'), u.is_active,
		       COALESCE(o.seat_count, 1), COALESCE(o.subscription_status, 'active'),
		       o.onboarding_completed_at, COALESCE(o.onboarding_current_step, 1), COALESCE(o.onboarding_skipped, false)
		FROM users u
		LEFT JOIN organizations o ON o.id = u.org_id
		WHERE u.id=$1`, userID).Scan(&id, &email, &orgID, &displayName, &role, &isActive, &seatCount, &subscriptionStatus, &onboardingCompletedAt, &onboardingCurrentStep, &onboardingSkipped)
	if err != nil || !isActive {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	var mailboxID, mailboxLocalPart, mailboxMode string
	var wrappedSkUser, previousWrappedSkUser, profilePhotoRef *string
	activeMailboxID := strings.TrimSpace(r.Header.Get("X-BYOS-Active-Mailbox"))
	if activeMailboxID != "" {
		callerHash, _ := getCallerTokenHash(r)
		if !isMailboxAuthorizedForSession(callerHash, userID, activeMailboxID, conn, ctx) {
			activeMailboxID = ""
		}
	}
	if activeMailboxID != "" {
		_ = conn.QueryRow(ctx, `
			SELECT id::text, local_part, mode, wrapped_sk_user, previous_wrapped_sk_user, profile_photo_ref
			FROM mailboxes
			WHERE id=$1 AND is_active=true AND status='active'`, activeMailboxID).Scan(&mailboxID, &mailboxLocalPart, &mailboxMode, &wrappedSkUser, &previousWrappedSkUser, &profilePhotoRef)
	} else {
		_ = conn.QueryRow(ctx, `
			SELECT id::text, local_part, mode, wrapped_sk_user, previous_wrapped_sk_user, profile_photo_ref
			FROM mailboxes
			WHERE user_id=$1 AND is_active=true AND status='active'
			ORDER BY created_at DESC
			LIMIT 1`, userID).Scan(&mailboxID, &mailboxLocalPart, &mailboxMode, &wrappedSkUser, &previousWrappedSkUser, &profilePhotoRef)
	}

	if mailboxID != "" {
		var mbDisplayName string
		_ = conn.QueryRow(ctx, `SELECT COALESCE(display_name, '') FROM mailbox_settings WHERE mailbox_id=$1`, mailboxID).Scan(&mbDisplayName)
		if mbDisplayName != "" {
			displayName = mbDisplayName
		}
	}

	wrappedSkUserStr := ""
	if wrappedSkUser != nil {
		wrappedSkUserStr = *wrappedSkUser
	}
	previousWrappedSkUserStr := ""
	if previousWrappedSkUser != nil {
		previousWrappedSkUserStr = *previousWrappedSkUser
	}
	var profilePhotoRefVal interface{}
	if profilePhotoRef != nil {
		profilePhotoRefVal = *profilePhotoRef
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":                       id,
		"email":                    email,
		"org_id":                   orgID,
		"organization_id":          orgID,
		"display_name":             displayName,
		"role":                     role,
		"seat_count":               seatCount,
		"subscription_status":      subscriptionStatus,
		"onboarding_completed":    onboardingCompletedAt != nil,
		"onboarding_completed_at": onboardingCompletedAt,
		"onboarding_current_step": onboardingCurrentStep,
		"onboarding_skipped":      onboardingSkipped,
		"mailbox_id":               mailboxID,
		"mailbox_local_part":       mailboxLocalPart,
		"mailbox_mode":             mailboxMode,
		"wrapped_sk_user":          wrappedSkUserStr,
		"previous_wrapped_sk_user": previousWrappedSkUserStr,
		"profile_photo_ref":        profilePhotoRefVal,
	})
}

func logoutHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var token string
	if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") && strings.TrimSpace(strings.TrimPrefix(auth, "Bearer ")) != "" {
		token = strings.TrimSpace(strings.TrimPrefix(auth, "Bearer "))
	} else {
		client := detectClient(r)
		if client == "control-plane" {
			if cookie, err := r.Cookie("byos_cp_session"); err == nil && cookie.Value != "" {
				token = cookie.Value
			}
		} else if client == "webmail" {
			if cookie, err := r.Cookie("byos_webmail_session"); err == nil && cookie.Value != "" {
				token = cookie.Value
			}
		} else {
			if cookie, err := r.Cookie("byos_session"); err == nil && cookie.Value != "" {
				token = cookie.Value
			} else if cookie, err := r.Cookie("byos_cp_session"); err == nil && cookie.Value != "" {
				token = cookie.Value
			} else if cookie, err := r.Cookie("byos_webmail_session"); err == nil && cookie.Value != "" {
				token = cookie.Value
			}
		}
	}
	if token == "" {
		clearSessionCookie(w, r)
		w.WriteHeader(http.StatusNoContent)
		return
	}
	tokenHash := hashToken(token)
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
	if len(tokenHash) > 0 {
		revokeAllMailboxesForSession(tokenHash)
	}
	clearSessionCookie(w, r)
	w.WriteHeader(http.StatusNoContent)
}

// -----------------------------------------------------------------------------
// Server-Managed Multi-Account Session Architecture
// -----------------------------------------------------------------------------

type linkedAccountInfo struct {
	MailboxID string    `json:"mailbox_id"`
	UserID    string    `json:"user_id"`
	OrgID     string    `json:"org_id"`
	ExpiresAt time.Time `json:"expires_at"`
}

var (
	linkedSessionsMu  sync.RWMutex
	linkedSessionsMap = make(map[string]map[string]linkedAccountInfo) // tokenHashHex -> mailboxID -> info
)

func authorizeMailboxForSession(tokenHash []byte, mailboxID, secondaryUserID, orgID string, expiresAt time.Time) {
	if len(tokenHash) == 0 || mailboxID == "" {
		return
	}
	tokenHex := hex.EncodeToString(tokenHash)

	// 1. In-memory registry (fallback & fast path)
	linkedSessionsMu.Lock()
	if _, ok := linkedSessionsMap[tokenHex]; !ok {
		linkedSessionsMap[tokenHex] = make(map[string]linkedAccountInfo)
	}
	linkedSessionsMap[tokenHex][mailboxID] = linkedAccountInfo{
		MailboxID: mailboxID,
		UserID:    secondaryUserID,
		OrgID:     orgID,
		ExpiresAt: expiresAt,
	}
	linkedSessionsMu.Unlock()

	// 2. Redis cluster-wide session synchronization (if active)
	if redisClient != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		ttl := time.Until(expiresAt)
		if ttl > 0 {
			redisKey := fmt.Sprintf("byos:session_links:%s", tokenHex)
			payload, _ := json.Marshal(map[string]string{
				"mailbox_id": mailboxID,
				"user_id":    secondaryUserID,
				"org_id":     orgID,
			})
			_ = redisClient.HSet(ctx, redisKey, mailboxID, payload).Err()
			_ = redisClient.Expire(ctx, redisKey, ttl).Err()
		}
	}
}

func revokeMailboxForSession(tokenHash []byte, mailboxID string) {
	if len(tokenHash) == 0 || mailboxID == "" {
		return
	}
	tokenHex := hex.EncodeToString(tokenHash)

	linkedSessionsMu.Lock()
	if sub, ok := linkedSessionsMap[tokenHex]; ok {
		delete(sub, mailboxID)
		if len(sub) == 0 {
			delete(linkedSessionsMap, tokenHex)
		}
	}
	linkedSessionsMu.Unlock()

	if redisClient != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		redisKey := fmt.Sprintf("byos:session_links:%s", tokenHex)
		_ = redisClient.HDel(ctx, redisKey, mailboxID).Err()
	}
}

func revokeAllMailboxesForSession(tokenHash []byte) {
	if len(tokenHash) == 0 {
		return
	}
	tokenHex := hex.EncodeToString(tokenHash)

	linkedSessionsMu.Lock()
	delete(linkedSessionsMap, tokenHex)
	linkedSessionsMu.Unlock()

	if redisClient != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		redisKey := fmt.Sprintf("byos:session_links:%s", tokenHex)
		_ = redisClient.Del(ctx, redisKey).Err()
	}
}

func getLinkedMailboxIDsForSession(tokenHash []byte) []string {
	if len(tokenHash) == 0 {
		return nil
	}
	tokenHex := hex.EncodeToString(tokenHash)
	now := time.Now()
	var ids []string

	linkedSessionsMu.RLock()
	if sub, ok := linkedSessionsMap[tokenHex]; ok {
		for mID, info := range sub {
			if now.Before(info.ExpiresAt) {
				ids = append(ids, mID)
			}
		}
	}
	linkedSessionsMu.RUnlock()

	if len(ids) == 0 && redisClient != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
		defer cancel()
		redisKey := fmt.Sprintf("byos:session_links:%s", tokenHex)
		keys, err := redisClient.HKeys(ctx, redisKey).Result()
		if err == nil && len(keys) > 0 {
			ids = append(ids, keys...)
		}
	}
	return ids
}

func isMailboxAuthorizedForSession(tokenHash []byte, userID, mailboxID string, conn *pgx.Conn, ctx context.Context) bool {
	if mailboxID == "" || userID == "" {
		return false
	}
	// 1. Direct authorization: primary user owns the mailbox or is admin/owner of that org
	if conn != nil {
		var directAuthorized string
		err := conn.QueryRow(ctx, `
			SELECT m.id::text
			FROM mailboxes m
			JOIN users u ON u.org_id = m.org_id
			WHERE m.id = $1 AND u.id = $2 AND u.is_active = true
			  AND (m.user_id = u.id OR (m.mode = 'org_managed' AND u.role IN ('admin', 'owner')))
		`, mailboxID, userID).Scan(&directAuthorized)
		if err == nil && directAuthorized == mailboxID {
			return true
		}
	}

	// 2. Check if linked to caller's active session
	if len(tokenHash) == 0 {
		return false
	}
	tokenHex := hex.EncodeToString(tokenHash)
	var linkedUserID string

	linkedSessionsMu.RLock()
	if sub, ok := linkedSessionsMap[tokenHex]; ok {
		if info, found := sub[mailboxID]; found {
			if time.Now().Before(info.ExpiresAt) {
				linkedUserID = info.UserID
			}
		}
	}
	linkedSessionsMu.RUnlock()

	if linkedUserID == "" && redisClient != nil {
		rCtx, cancel := context.WithTimeout(ctx, 1*time.Second)
		defer cancel()
		redisKey := fmt.Sprintf("byos:session_links:%s", tokenHex)
		val, rErr := redisClient.HGet(rCtx, redisKey, mailboxID).Result()
		if rErr == nil && val != "" {
			var parsed map[string]string
			if err := json.Unmarshal([]byte(val), &parsed); err == nil {
				linkedUserID = parsed["user_id"]
			}
		}
	}

	if linkedUserID == "" {
		return false
	}

	// 3. Confirm the linked user and mailbox are active in the database
	if conn != nil {
		var activeCheck string
		err := conn.QueryRow(ctx, `
			SELECT m.id::text
			FROM mailboxes m
			JOIN users u ON u.id = m.user_id
			WHERE m.id = $1 AND u.id = $2 AND u.is_active = true AND m.is_active = true
		`, mailboxID, linkedUserID).Scan(&activeCheck)
		return err == nil && activeCheck == mailboxID
	}
	return true
}

// verifyUserMailboxSession verifies that the request caller is authorized for the given mailbox via an active user session.
// 1. Enforces that if X-BYOS-Active-Mailbox is present, it matches mailboxID (preventing selector mismatch attacks).
// 2. Verifies isMailboxAuthorizedForSession for the session token and user ID.
// This function does NOT permit internal service bypass.
func verifyUserMailboxSession(r *http.Request, userID, mailboxID string, conn *pgx.Conn, ctx context.Context) (status int, errMsg string, ok bool) {
	// 1. Header selector mismatch check: reject if X-BYOS-Active-Mailbox is present and doesn't match target mailbox
	activeHeader := strings.TrimSpace(r.Header.Get("X-BYOS-Active-Mailbox"))
	if activeHeader != "" && activeHeader != mailboxID {
		return http.StatusForbidden, "X-BYOS-Active-Mailbox mismatch with target mailbox", false
	}

	// 2. Check authorization for this user & session
	callerHash, _ := getCallerTokenHash(r)
	if !isMailboxAuthorizedForSession(callerHash, userID, mailboxID, conn, ctx) {
		return http.StatusForbidden, "not authorized for this mailbox", false
	}

	return 0, "", true
}

// verifyInternalServiceAuth verifies that the caller presents a valid internal service key for the expected service identity.
// Comparisons use constant-time comparison. Unconfigured or empty credentials fail closed.
func verifyInternalServiceAuth(r *http.Request, requiredService string) bool {
	gotKey := strings.TrimSpace(r.Header.Get("X-Internal-Key"))
	if gotKey == "" {
		return false
	}

	switch requiredService {
	case "storage":
		storageKey := storageInternalKey()
		return storageKey != "" && subtle.ConstantTimeCompare([]byte(gotKey), []byte(storageKey)) == 1
	case "outbound":
		expectedKey := internalAPIKey()
		return expectedKey != "" && subtle.ConstantTimeCompare([]byte(gotKey), []byte(expectedKey)) == 1
	case "migration":
		migrationKey := internalMigrationKey()
		return migrationKey != "" && subtle.ConstantTimeCompare([]byte(gotKey), []byte(migrationKey)) == 1
	default:
		return false
	}
}

// internalMigrationKey returns the dedicated server-side migration key from environment or file.
func internalMigrationKey() string {
	if v := strings.TrimSpace(os.Getenv("MIGRATION_INTERNAL_KEY")); v != "" {
		return v
	}
	path := strings.TrimSpace(os.Getenv("MIGRATION_INTERNAL_KEY_FILE"))
	if path == "" {
		path = "/run/secrets/migration_internal_key"
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

// verifyMailboxScopedAccess verifies caller authorization for a mailbox.
// If allowedService is non-empty ("storage" or "outbound"), callers presenting valid matching internal service credentials bypass session checks.
// Otherwise, user-session authorization is strictly enforced via verifyUserMailboxSession.
func verifyMailboxScopedAccess(r *http.Request, userID, mailboxID string, allowedService string, conn *pgx.Conn, ctx context.Context) (status int, errMsg string, ok bool) {
	if allowedService != "" && verifyInternalServiceAuth(r, allowedService) {
		return 0, "", true
	}
	return verifyUserMailboxSession(r, userID, mailboxID, conn, ctx)
}

// verifyMailboxSession provides standard user-session authorization for mailbox routes without internal-service bypass.
func verifyMailboxSession(r *http.Request, userID, mailboxID string, conn *pgx.Conn, ctx context.Context) (status int, errMsg string, ok bool) {
	return verifyUserMailboxSession(r, userID, mailboxID, conn, ctx)
}

// linkedAccountsHandler handles POST, GET, and DELETE /v1/auth/linked-accounts
func linkedAccountsHandler(w http.ResponseWriter, r *http.Request) {
	primaryUserID, ok := getSessionUserID(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	callerHash, ok := getCallerTokenHash(r)
	if !ok || len(callerHash) == 0 {
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
	case http.MethodPost:
		r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
		var req struct {
			Email          string `json:"email"`
			Password       string `json:"password"`
			Code           string `json:"code"`
			ChallengeToken string `json:"challenge_token"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}

		ip := getClientIP(r)

		// Path A: Verification of an existing link_2fa MFA challenge
		challengeTok := strings.TrimSpace(req.ChallengeToken)
		if challengeTok != "" {
			code := strings.TrimSpace(req.Code)
			if code == "" {
				http.Error(w, "verification code required", http.StatusBadRequest)
				return
			}

			// 1. Check rate limits
			if redisClient != nil {
				cnt, err := redisClient.Get(ctx, "auth:link:ip:"+ip).Int()
				if err == nil && cnt >= 5 {
					w.Header().Set("Retry-After", "900")
					http.Error(w, "too many attempts, try later", http.StatusTooManyRequests)
					return
				}
			}

			// 2. Query challenge bound to callerHash
			var challengeID, secUserID string
			var destination *string
			var expiresAt time.Time
			err = conn.QueryRow(ctx, `
				SELECT id::text, user_id::text, destination, expires_at
				FROM auth_challenges
				WHERE challenge_token=$1 AND challenge_type='link_2fa'
			`, challengeTok).Scan(&challengeID, &secUserID, &destination, &expiresAt)
			if err != nil || expiresAt.Before(time.Now()) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				json.NewEncoder(w).Encode(map[string]interface{}{
					"error": "Verification session expired or invalid. Please link account again.",
				})
				return
			}

			// 3. Prevent replay from different primary session: destination MUST equal callerHash hex
			callerHex := hex.EncodeToString(callerHash)
			if destination == nil || *destination != callerHex {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusForbidden)
				json.NewEncoder(w).Encode(map[string]interface{}{
					"error": "forbidden: challenge bound to a different primary session",
				})
				return
			}

			// 4. Query target secondary user
			var secEmail, secOrgID, secDisplayName, secRole string
			var secIsActive bool
			var secTotpSecret *string
			err = conn.QueryRow(ctx, `
				SELECT email, org_id::text, COALESCE(display_name, ''), COALESCE(role, 'member'), is_active, totp_secret
				FROM users
				WHERE id=$1`, secUserID).Scan(&secEmail, &secOrgID, &secDisplayName, &secRole, &secIsActive, &secTotpSecret)
			if err != nil || !secIsActive || secTotpSecret == nil || *secTotpSecret == "" {
				http.Error(w, "account inactive or invalid", http.StatusUnauthorized)
				return
			}

			// 5. Validate and atomically consume TOTP code (single-use step enforcement)
			consumed, err := verifyAndConsumeTOTP(ctx, conn, secUserID, *secTotpSecret, code)
			if err != nil {
				http.Error(w, "internal server error", http.StatusInternalServerError)
				return
			}
			if !consumed {
				if redisClient != nil {
					_ = redisClient.Incr(ctx, "auth:link:ip:"+ip)
					_ = redisClient.Expire(ctx, "auth:link:ip:"+ip, 15*time.Minute)
					_ = redisClient.Incr(ctx, "auth:link:email:"+secEmail)
					_ = redisClient.Expire(ctx, "auth:link:email:"+secEmail, 15*time.Minute)
				}
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				json.NewEncoder(w).Encode(map[string]interface{}{
					"error": "invalid two-factor code",
				})
				return
			}

			// 6. Consume challenge atomically (single use)
			_, _ = conn.Exec(ctx, `DELETE FROM auth_challenges WHERE id=$1`, challengeID)
			ClearOTPAttempts(ctx, challengeTok)
			if redisClient != nil {
				_ = redisClient.Del(ctx, "auth:link:email:"+secEmail)
			}

			// 7. Query active mailbox
			var secMailboxID, secLocalPart, secMode string
			var secWrappedSkUser, secPrevWrappedSkUser, secProfilePhotoRef *string
			err = conn.QueryRow(ctx, `
				SELECT id::text, local_part, mode, wrapped_sk_user, previous_wrapped_sk_user, profile_photo_ref
				FROM mailboxes
				WHERE user_id=$1 AND is_active=true AND status='active'
				ORDER BY created_at DESC
				LIMIT 1`, secUserID).Scan(&secMailboxID, &secLocalPart, &secMode, &secWrappedSkUser, &secPrevWrappedSkUser, &secProfilePhotoRef)
			if err != nil {
				http.Error(w, "no active mailbox found for account", http.StatusNotFound)
				return
			}

			var sessionExpiresAt time.Time
			_ = conn.QueryRow(ctx, `SELECT expires_at FROM sessions WHERE token_hash=$1 AND revoked_at IS NULL`, callerHash).Scan(&sessionExpiresAt)
			if sessionExpiresAt.IsZero() || sessionExpiresAt.Before(time.Now()) {
				sessionExpiresAt = time.Now().Add(7 * 24 * time.Hour)
			}

			// 8. Authorize mailbox for session without modifying session cookie
			authorizeMailboxForSession(callerHash, secMailboxID, secUserID, secOrgID, sessionExpiresAt)
			auditLog(ctx, conn, secOrgID, primaryUserID, "link_mailbox", "mailbox", secMailboxID, map[string]interface{}{
				"linked_user_id": secUserID,
				"email":          secEmail,
			})

			secWrappedSkUserStr := ""
			if secWrappedSkUser != nil {
				secWrappedSkUserStr = *secWrappedSkUser
			}
			secPrevWrappedSkUserStr := ""
			if secPrevWrappedSkUser != nil {
				secPrevWrappedSkUserStr = *secPrevWrappedSkUser
			}
			var secProfilePhotoRefVal interface{}
			if secProfilePhotoRef != nil {
				secProfilePhotoRefVal = *secProfilePhotoRef
			}

			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"mailbox_id":               secMailboxID,
				"id":                       secMailboxID,
				"email":                    secEmail,
				"display_name":             secDisplayName,
				"role":                     secRole,
				"privacy_mode":             secMode,
				"mailbox_mode":             secMode,
				"wrapped_sk_user":          secWrappedSkUserStr,
				"previous_wrapped_sk_user": secPrevWrappedSkUserStr,
				"profile_photo_ref":        secProfilePhotoRefVal,
			})
			return
		}

		// Path B: Initial credentials submission (email + password)
		email := strings.TrimSpace(strings.ToLower(req.Email))
		password := req.Password
		if email == "" || password == "" {
			http.Error(w, "invalid credentials", http.StatusUnauthorized)
			return
		}

		// Rate limiting for account linking attempts
		if redisClient != nil {
			rKeys := []string{"auth:link:ip:" + ip, "auth:link:email:" + email}
			for _, k := range rKeys {
				cnt, err := redisClient.Get(ctx, k).Int()
				if err != nil && err != redis.Nil {
					log.Printf("linked accounts rate check failed: %v", err)
					http.Error(w, "rate limiter unavailable", http.StatusServiceUnavailable)
					return
				}
				if cnt >= 5 {
					w.Header().Set("Retry-After", "900")
					http.Error(w, "too many attempts, try later", http.StatusTooManyRequests)
					return
				}
			}
		}

		recordLinkFailure := func() {
			if redisClient != nil {
				_ = redisClient.Incr(ctx, "auth:link:email:"+email)
				_ = redisClient.Expire(ctx, "auth:link:email:"+email, 15*time.Minute)
				_ = redisClient.Incr(ctx, "auth:link:ip:"+ip)
				_ = redisClient.Expire(ctx, "auth:link:ip:"+ip, 15*time.Minute)
			}
		}

		var secUserID, secPasswordHash, secOrgID, secRole, secDisplayName string
		var secIsActive, secTwoFactorEnabled bool
		var secTotpSecret *string
		err = conn.QueryRow(ctx, `
			SELECT id::text, password_hash, org_id::text, COALESCE(role, 'member'), COALESCE(display_name, ''), is_active,
			       COALESCE(two_factor_enabled, false), totp_secret
			FROM users
			WHERE lower(email)=$1`, email).Scan(&secUserID, &secPasswordHash, &secOrgID, &secRole, &secDisplayName, &secIsActive, &secTwoFactorEnabled, &secTotpSecret)
		if err != nil || !secIsActive || !verifyPassword(secPasswordHash, password) {
			recordLinkFailure()
			http.Error(w, "invalid credentials", http.StatusUnauthorized)
			return
		}

		// MFA enforcement: target accounts with active 2FA require TOTP verification
		hasMFA := secTwoFactorEnabled && secTotpSecret != nil && *secTotpSecret != ""
		if hasMFA {
			code := strings.TrimSpace(req.Code)
			if code == "" {
				// Issue short-lived challenge bound strictly to callerHash (primary session)
				tok, err := generateRandomBase64URL(32)
				if err != nil {
					http.Error(w, "failed to create 2fa challenge", http.StatusInternalServerError)
					return
				}
				callerHex := hex.EncodeToString(callerHash)
				expiresAt := time.Now().Add(5 * time.Minute)
				_, err = conn.Exec(ctx, `
					INSERT INTO auth_challenges (user_id, challenge_type, challenge_token, destination, expires_at)
					VALUES ($1, 'link_2fa', $2, $3, $4)
				`, secUserID, tok, callerHex, expiresAt)
				if err != nil {
					http.Error(w, "failed to record challenge", http.StatusInternalServerError)
					return
				}

				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusOK)
				json.NewEncoder(w).Encode(map[string]interface{}{
					"two_factor_required": true,
					"challenge_token":     tok,
					"methods":             []string{"totp"},
					"preferred_method":    "totp",
				})
				return
			}
			consumed, err := verifyAndConsumeTOTP(ctx, conn, secUserID, *secTotpSecret, code)
			if err != nil {
				http.Error(w, "internal server error", http.StatusInternalServerError)
				return
			}
			if !consumed {
				recordLinkFailure()
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				json.NewEncoder(w).Encode(map[string]interface{}{
					"error": "invalid two-factor code",
				})
				return
			}
		}

		// Clear rate limits on successful authentication
		if redisClient != nil {
			_ = redisClient.Del(ctx, "auth:link:email:"+email)
		}

		var secMailboxID, secLocalPart, secMode string
		var secWrappedSkUser, secPrevWrappedSkUser, secProfilePhotoRef *string
		err = conn.QueryRow(ctx, `
			SELECT id::text, local_part, mode, wrapped_sk_user, previous_wrapped_sk_user, profile_photo_ref
			FROM mailboxes
			WHERE user_id=$1 AND is_active=true AND status='active'
			ORDER BY created_at DESC
			LIMIT 1`, secUserID).Scan(&secMailboxID, &secLocalPart, &secMode, &secWrappedSkUser, &secPrevWrappedSkUser, &secProfilePhotoRef)
		if err != nil {
			http.Error(w, "no active mailbox found for account", http.StatusNotFound)
			return
		}

		var expiresAt time.Time
		_ = conn.QueryRow(ctx, `SELECT expires_at FROM sessions WHERE token_hash=$1 AND revoked_at IS NULL`, callerHash).Scan(&expiresAt)
		if expiresAt.IsZero() || expiresAt.Before(time.Now()) {
			expiresAt = time.Now().Add(7 * 24 * time.Hour)
		}

		authorizeMailboxForSession(callerHash, secMailboxID, secUserID, secOrgID, expiresAt)
		auditLog(ctx, conn, secOrgID, primaryUserID, "link_mailbox", "mailbox", secMailboxID, map[string]interface{}{
			"linked_user_id": secUserID,
			"email":          email,
		})

		secWrappedSkUserStr := ""
		if secWrappedSkUser != nil {
			secWrappedSkUserStr = *secWrappedSkUser
		}
		secPrevWrappedSkUserStr := ""
		if secPrevWrappedSkUser != nil {
			secPrevWrappedSkUserStr = *secPrevWrappedSkUser
		}
		var secProfilePhotoRefVal interface{}
		if secProfilePhotoRef != nil {
			secProfilePhotoRefVal = *secProfilePhotoRef
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"mailbox_id":               secMailboxID,
			"id":                       secMailboxID,
			"email":                    email,
			"display_name":             secDisplayName,
			"role":                     secRole,
			"privacy_mode":             secMode,
			"mailbox_mode":             secMode,
			"wrapped_sk_user":          secWrappedSkUserStr,
			"previous_wrapped_sk_user": secPrevWrappedSkUserStr,
			"profile_photo_ref":        secProfilePhotoRefVal,
		})

	case http.MethodDelete:
		targetID := strings.TrimPrefix(r.URL.Path, "/v1/auth/linked-accounts/")
		targetID = strings.TrimPrefix(targetID, "/v1/auth/linked-accounts")
		targetID = strings.Trim(targetID, "/")
		if targetID == "" {
			http.Error(w, "mailbox ID required", http.StatusBadRequest)
			return
		}
		revokeMailboxForSession(callerHash, targetID)
		w.WriteHeader(http.StatusNoContent)

	case http.MethodGet:
		linkedIDs := getLinkedMailboxIDsForSession(callerHash)
		type LinkedItem struct {
			MailboxID   string `json:"mailbox_id"`
			Email       string `json:"email"`
			DisplayName string `json:"display_name"`
			Role        string `json:"role"`
			Mode        string `json:"mode"`
		}
		items := make([]LinkedItem, 0)
		for _, mID := range linkedIDs {
			var it LinkedItem
			it.MailboxID = mID
			err := conn.QueryRow(ctx, `
				SELECT 
					CASE WHEN d.name IS NOT NULL AND d.name != '' THEN m.local_part || '@' || d.name ELSE m.local_part END,
					COALESCE(u.display_name, m.local_part),
					COALESCE(u.role, 'member'),
					m.mode
				FROM mailboxes m
				JOIN users u ON u.id = m.user_id
				LEFT JOIN domains d ON d.id = m.domain_id
				WHERE m.id = $1 AND u.is_active = true AND m.is_active = true
			`, mID).Scan(&it.Email, &it.DisplayName, &it.Role, &it.Mode)
			if err == nil {
				items = append(items, it)
			}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"linked_mailboxes": items,
		})

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}
