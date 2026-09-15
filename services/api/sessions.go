package main

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type SessionItem struct {
	ID           string    `json:"id"`
	IPAddress    string    `json:"ip_address"`
	UserAgent    string    `json:"user_agent"`
	CreatedAt    time.Time `json:"created_at"`
	LastActiveAt time.Time `json:"last_active_at"`
	IsCurrent    bool      `json:"is_current"`
}

func getCallerTokenHash(r *http.Request) ([]byte, bool) {
	var token string
	if cookie, err := r.Cookie("byos_session"); err == nil && cookie.Value != "" {
		token = cookie.Value
	} else if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") {
		token = strings.TrimPrefix(auth, "Bearer ")
	}
	if token == "" {
		return nil, false
	}
	return hashToken(token), true
}

// sessionsHandler handles GET /v1/auth/sessions
func sessionsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	callerHash, _ := getCallerTokenHash(r)

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

	rows, err := conn.Query(ctx, `
		SELECT id::text, token_hash, COALESCE(ip_address, 'Unknown IP'), COALESCE(user_agent, 'Unknown Device'), created_at, COALESCE(last_active_at, created_at)
		FROM sessions
		WHERE user_id=$1 AND expires_at > now() AND revoked_at IS NULL
		ORDER BY COALESCE(last_active_at, created_at) DESC
	`, userID)
	if err != nil {
		log.Printf("failed to query sessions: %v", err)
		http.Error(w, "failed to query sessions", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	sessions := make([]SessionItem, 0)
	for rows.Next() {
		var s SessionItem
		var tokenHash []byte
		if err := rows.Scan(&s.ID, &tokenHash, &s.IPAddress, &s.UserAgent, &s.CreatedAt, &s.LastActiveAt); err == nil {
			if len(callerHash) > 0 && bytes.Equal(tokenHash, callerHash) {
				s.IsCurrent = true
			}
			sessions = append(sessions, s)
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"sessions": sessions,
	})
}

// revokeOtherSessionsHandler handles POST /v1/auth/sessions/revoke-others
// Safeguard 1: Purges session keys from both PostgreSQL and Redis on revoke-others
func revokeOtherSessionsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	callerHash, ok := getCallerTokenHash(r)
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

	// Query token hashes to be revoked
	rows, err := conn.Query(ctx, `
		SELECT token_hash FROM sessions
		WHERE user_id=$1 AND token_hash != $2 AND revoked_at IS NULL
	`, userID, callerHash)
	if err != nil {
		http.Error(w, "failed to query active sessions", http.StatusInternalServerError)
		return
	}

	var hashesToRevoke [][]byte
	for rows.Next() {
		var h []byte
		if err := rows.Scan(&h); err == nil {
			hashesToRevoke = append(hashesToRevoke, h)
		}
	}
	rows.Close()

	// Revoke in PostgreSQL
	tag, err := conn.Exec(ctx, `
		UPDATE sessions SET revoked_at=now()
		WHERE user_id=$1 AND token_hash != $2 AND revoked_at IS NULL
	`, userID, callerHash)
	if err != nil {
		log.Printf("failed to revoke sessions in db: %v", err)
		http.Error(w, "failed to revoke sessions", http.StatusInternalServerError)
		return
	}

	// Purge in Redis (Safeguard 1)
	if redisClient != nil {
		ctx2 := context.Background()
		for _, h := range hashesToRevoke {
			hexHash := hex.EncodeToString(h)
			redisClient.Del(ctx2, "auth:session:"+hexHash)
			redisClient.Del(ctx2, "session:"+hexHash)
		}
		redisClient.Del(ctx2, "auth:user_sessions:"+userID)
	}

	auditLog(ctx, conn, "", userID, "sessions_revoked_others", "user", userID, map[string]interface{}{
		"revoked_count": tag.RowsAffected(),
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":       true,
		"revoked_count": tag.RowsAffected(),
	})
}

// verifyPasswordHandler handles POST /v1/auth/verify-password
// Safeguard 2: Apply a strict Redis rate limiter (5 attempts / 5 mins)
func verifyPasswordHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	clientIP := getClientIP(r)

	// Strict Redis Rate Limiter: 5 attempts per 5 minutes (Safeguard 2)
	if redisClient != nil {
		ctx := context.Background()
		userKey := fmt.Sprintf("auth:verify_pw:user:%s", userID)
		ipKey := fmt.Sprintf("auth:verify_pw:ip:%s", clientIP)

		cntUser, _ := redisClient.Get(ctx, userKey).Int()
		cntIP, _ := redisClient.Get(ctx, ipKey).Int()

		if cntUser >= 5 || cntIP >= 5 {
			w.Header().Set("Retry-After", "300")
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusTooManyRequests)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"valid": false,
				"error": "Too many password verification attempts. Please wait 5 minutes.",
			})
			return
		}
	}

	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var req struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Password) == "" {
		http.Error(w, "password required", http.StatusBadRequest)
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

	var passwordHash string
	err = conn.QueryRow(ctx, `SELECT password_hash FROM users WHERE id=$1 AND is_active=true`, userID).Scan(&passwordHash)
	if err != nil || passwordHash == "" || !verifyPassword(passwordHash, req.Password) {
		// Increment rate limiter on failure (Safeguard 2)
		if redisClient != nil {
			ctx2 := context.Background()
			userKey := fmt.Sprintf("auth:verify_pw:user:%s", userID)
			ipKey := fmt.Sprintf("auth:verify_pw:ip:%s", clientIP)

			redisClient.Incr(ctx2, userKey)
			redisClient.Expire(ctx2, userKey, 5*time.Minute)
			redisClient.Incr(ctx2, ipKey)
			redisClient.Expire(ctx2, ipKey, 5*time.Minute)
		}

		auditLog(ctx, conn, "", userID, "verify_password_failed", "user", userID, map[string]interface{}{
			"ip": clientIP,
		})

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"valid": false,
			"error": "Incorrect password",
		})
		return
	}

	auditLog(ctx, conn, "", userID, "verify_password_success", "user", userID, map[string]interface{}{
		"ip": clientIP,
	})

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"valid": true,
	})
}
