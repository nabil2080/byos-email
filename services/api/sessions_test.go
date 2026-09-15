package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"
)

func TestSessionsListingAndRevokeOthers(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Skipf("skipping test; db unreachable: %v", err)
	}
	defer conn.Close(ctx)

	if redisClient == nil {
		redisClient = redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	}

	orgID := uuid.New().String()
	userID := uuid.New().String()

	_, err = conn.Exec(ctx, `INSERT INTO organizations (id, name, plan, org_recovery_pk) VALUES ($1, $2, 'business', decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'))`, orgID, "Sessions Org")
	if err != nil {
		t.Fatalf("failed to insert org: %v", err)
	}
	defer conn.Exec(ctx, `DELETE FROM organizations WHERE id=$1`, orgID)

	pwHash, _ := hashPassword("supersecret123")
	email := "user-" + uuid.New().String()[:8] + "@sessions-test.org"
	_, err = conn.Exec(ctx, `INSERT INTO users (id, org_id, email, password_hash, role, is_active) VALUES ($1, $2, $3, $4, 'member', true)`, userID, orgID, email, pwHash)
	if err != nil {
		t.Fatalf("failed to insert user: %v", err)
	}

	// Create 3 active sessions
	token1, hash1 := generateSessionToken()
	_, hash2 := generateSessionToken()
	_, hash3 := generateSessionToken()

	expires := time.Now().Add(24 * time.Hour)
	_, _ = conn.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, expires_at, ip_address, user_agent) VALUES ($1, $2, $3, '127.0.0.1', 'Chrome/Desktop')`, userID, hash1, expires)
	_, _ = conn.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, expires_at, ip_address, user_agent) VALUES ($1, $2, $3, '192.168.1.5', 'Safari/iOS')`, userID, hash2, expires)
	_, _ = conn.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, expires_at, ip_address, user_agent) VALUES ($1, $2, $3, '10.0.0.2', 'Firefox/Linux')`, userID, hash3, expires)

	// 1. GET /v1/auth/sessions using token1
	getReq := httptest.NewRequest(http.MethodGet, "/v1/auth/sessions", nil)
	getReq.Header.Set("Authorization", "Bearer "+token1)
	getW := httptest.NewRecorder()

	sessionsHandler(getW, getReq)
	if getW.Code != http.StatusOK {
		t.Fatalf("expected 200 for sessions list, got %d: %s", getW.Code, getW.Body.String())
	}

	var listResp struct {
		Sessions []SessionItem `json:"sessions"`
	}
	if err := json.NewDecoder(getW.Body).Decode(&listResp); err != nil {
		t.Fatalf("failed to decode sessions: %v", err)
	}
	if len(listResp.Sessions) != 3 {
		t.Fatalf("expected 3 sessions, got %d", len(listResp.Sessions))
	}

	currentFound := false
	for _, s := range listResp.Sessions {
		if s.IsCurrent {
			currentFound = true
			if s.UserAgent != "Chrome/Desktop" {
				t.Errorf("expected current session user agent to be Chrome/Desktop, got %s", s.UserAgent)
			}
		}
	}
	if !currentFound {
		t.Errorf("expected is_current to be true for token1")
	}

	// 2. POST /v1/auth/sessions/revoke-others using token1 (Safeguard 1)
	revReq := httptest.NewRequest(http.MethodPost, "/v1/auth/sessions/revoke-others", nil)
	revReq.Header.Set("Authorization", "Bearer "+token1)
	revW := httptest.NewRecorder()

	revokeOtherSessionsHandler(revW, revReq)
	if revW.Code != http.StatusOK {
		t.Fatalf("expected 200 on revoke-others, got %d: %s", revW.Code, revW.Body.String())
	}

	// Check that other sessions were revoked
	var activeCount int
	err = conn.QueryRow(ctx, `SELECT count(*) FROM sessions WHERE user_id=$1 AND revoked_at IS NULL`, userID).Scan(&activeCount)
	if err != nil {
		t.Fatalf("failed to count sessions: %v", err)
	}
	if activeCount != 1 {
		t.Errorf("expected only 1 active session remaining, got %d", activeCount)
	}
}

func TestVerifyPasswordAndRateLimiter(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Skipf("skipping test; db unreachable: %v", err)
	}
	defer conn.Close(ctx)

	if redisClient == nil {
		redisClient = redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	}

	orgID := uuid.New().String()
	userID := uuid.New().String()

	_, err = conn.Exec(ctx, `INSERT INTO organizations (id, name, plan, org_recovery_pk) VALUES ($1, $2, 'business', decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'))`, orgID, "Verify PW Org")
	if err != nil {
		t.Fatalf("failed to insert org: %v", err)
	}
	defer conn.Exec(ctx, `DELETE FROM organizations WHERE id=$1`, orgID)

	correctPW := "correctpassword123!"
	pwHash, _ := hashPassword(correctPW)
	email := "verify-" + uuid.New().String()[:8] + "@pw-test.org"
	_, err = conn.Exec(ctx, `INSERT INTO users (id, org_id, email, password_hash, role, is_active) VALUES ($1, $2, $3, $4, 'member', true)`, userID, orgID, email, pwHash)
	if err != nil {
		t.Fatalf("failed to insert user: %v", err)
	}

	token, hash := generateSessionToken()
	_, _ = conn.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day')`, userID, hash)

	// Clean redis rate limit keys for this test
	ip := "127.0.0.99"
	redisClient.Del(ctx, fmt.Sprintf("auth:verify_pw:user:%s", userID))
	redisClient.Del(ctx, fmt.Sprintf("auth:verify_pw:ip:%s", ip))

	// 1. Successful verification
	bodyBytes, _ := json.Marshal(map[string]string{"password": correctPW})
	okReq := httptest.NewRequest(http.MethodPost, "/v1/auth/verify-password", bytes.NewReader(bodyBytes))
	okReq.Header.Set("Authorization", "Bearer "+token)
	okReq.RemoteAddr = ip + ":1234"
	okW := httptest.NewRecorder()

	verifyPasswordHandler(okW, okReq)
	if okW.Code != http.StatusOK {
		t.Fatalf("expected 200 on correct password, got %d: %s", okW.Code, okW.Body.String())
	}

	// 2. Incorrect password
	badBytes, _ := json.Marshal(map[string]string{"password": "wrongpassword123!"})
	badReq := httptest.NewRequest(http.MethodPost, "/v1/auth/verify-password", bytes.NewReader(badBytes))
	badReq.Header.Set("Authorization", "Bearer "+token)
	badReq.RemoteAddr = ip + ":1234"
	badW := httptest.NewRecorder()

	verifyPasswordHandler(badW, badReq)
	if badW.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 on wrong password, got %d: %s", badW.Code, badW.Body.String())
	}

	// 3. Strict rate limiting: 5 attempts triggers 429 (Safeguard 2)
	for i := 1; i < 5; i++ {
		req := httptest.NewRequest(http.MethodPost, "/v1/auth/verify-password", bytes.NewReader(badBytes))
		req.Header.Set("Authorization", "Bearer "+token)
		req.RemoteAddr = ip + ":1234"
		w := httptest.NewRecorder()
		verifyPasswordHandler(w, req)
	}

	// The 6th request must be blocked by rate limiter with 429
	limitReq := httptest.NewRequest(http.MethodPost, "/v1/auth/verify-password", bytes.NewReader(bodyBytes))
	limitReq.Header.Set("Authorization", "Bearer "+token)
	limitReq.RemoteAddr = ip + ":1234"
	limitW := httptest.NewRecorder()

	verifyPasswordHandler(limitW, limitReq)
	if limitW.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429 Too Many Requests after 5 failed attempts, got %d: %s", limitW.Code, limitW.Body.String())
	}
	if limitW.Header().Get("Retry-After") != "300" {
		t.Errorf("expected Retry-After: 300, got %s", limitW.Header().Get("Retry-After"))
	}
}
