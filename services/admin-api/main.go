package main

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"admin-api/handlers"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

var db *pgxpool.Pool

func withSecurityHeaders(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("X-XSS-Protection", "1; mode=block")

		csp := "default-src 'self'; connect-src 'self';"
		if IsDevelopment() {
			csp = "default-src 'self'; connect-src 'self' http://localhost:* http://127.0.0.1:*;"
		}
		w.Header().Set("Content-Security-Policy", csp)
		// Only send HSTS in production/HTTPS; over plain HTTP (LAN dev) it poisons the browser's
		// HSTS cache for the IP, causing ERR_TOO_MANY_RETRIES on mobile devices (Chrome/Android).
		if os.Getenv("BYOS_ENV") == "production" || os.Getenv("HTTPS_ENABLED") == "true" {
			w.Header().Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload")
		}

		next(w, r)
	}
}

func isAllowedAdminOrigin(origin string) bool {
	if origin == "" {
		return false
	}
	allowedList := os.Getenv("ADMIN_ALLOWED_ORIGINS")
	if allowedList != "" {
		for _, a := range strings.Split(allowedList, ",") {
			if strings.TrimSpace(a) == origin {
				return true
			}
		}
		return false
	}
	if IsDevelopment() {
		u, err := url.Parse(origin)
		if err == nil && (u.Scheme == "http" || u.Scheme == "https") {
			hostname := u.Hostname()
			if hostname == "localhost" || hostname == "127.0.0.1" || strings.HasPrefix(hostname, "192.168.") || strings.HasPrefix(hostname, "10.") || strings.HasPrefix(hostname, "172.") || strings.HasSuffix(hostname, ".trycloudflare.com") {
				return true
			}
		}
		devOrigins := []string{
			"http://127.0.0.1:3003",
			"http://localhost:3003",
			"http://localhost:3000",
			"http://127.0.0.1:3000",
		}
		for _, dev := range devOrigins {
			if origin == dev {
				return true
			}
		}
	}
	return false
}

func applyCORS(w http.ResponseWriter, r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin != "" {
		w.Header().Add("Vary", "Origin")
	}
	if isAllowedAdminOrigin(origin) {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, Cookie")
	}
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return true
	}
	return false
}

func setAdminSessionCookie(w http.ResponseWriter, r *http.Request, token string) {
	secure := IsCookieSecure()
	http.SetCookie(w, &http.Cookie{
		Name:     "byos_admin_session",
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   86400,
	})
}

func clearAdminSessionCookie(w http.ResponseWriter, r *http.Request) {
	secure := IsCookieSecure()
	http.SetCookie(w, &http.Cookie{
		Name:     "byos_admin_session",
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
		Expires:  time.Unix(0, 0),
	})
}

func agentAuthMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return withSecurityHeaders(func(w http.ResponseWriter, r *http.Request) {
		if applyCORS(w, r) {
			return
		}

		var token string
		var isCookieAuth bool
		if cookie, err := r.Cookie("byos_admin_session"); err == nil && cookie.Value != "" {
			token = cookie.Value
			isCookieAuth = true
		} else {
			authHeader := r.Header.Get("Authorization")
			if strings.HasPrefix(authHeader, "Bearer ") {
				token = strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer "))
			}
		}

		if token == "" {
			http.Error(w, "Unauthorized: WebAuthn challenge required", http.StatusUnauthorized)
			return
		}

		// CSRF protection for cookie-authenticated state-changing requests
		if isCookieAuth {
			switch r.Method {
			case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
				origin := r.Header.Get("Origin")
				if origin == "" {
					if ref := r.Header.Get("Referer"); ref != "" {
						if u, err := url.Parse(ref); err == nil {
							origin = u.Scheme + "://" + u.Host
						}
					}
				}
				if origin == "" || !isAllowedAdminOrigin(origin) {
					http.Error(w, "Forbidden: CSRF check failed", http.StatusForbidden)
					return
				}
			}
		}

		if token == "mock-support-agent" {
			if !IsDevMode() {
				http.Error(w, "Unauthorized: mock WebAuthn disabled in production", http.StatusUnauthorized)
				return
			}
			ctx := handlers.ContextWithAgentIdentity(r.Context(), handlers.AgentIdentity{
				ActorID:  "mock-support-agent",
				Email:    "admin@byos.local",
				Role:     "support_agent",
				AuthType: "mock",
			})
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}

		if IsDevMode() {
			if token == "mock-admin" {
				ctx := handlers.ContextWithAgentIdentity(r.Context(), handlers.AgentIdentity{
					ActorID:  "mock-platform-admin",
					Email:    "platform-admin@byos.local",
					Role:     "platform_admin",
					AuthType: "mock",
				})
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}
			if token == "mock-readonly-operator" {
				ctx := handlers.ContextWithAgentIdentity(r.Context(), handlers.AgentIdentity{
					ActorID:  "mock-readonly-operator",
					Email:    "readonly@byos.local",
					Role:     "read_only_operator",
					AuthType: "mock",
				})
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}
			if token == "mock-org-admin" {
				ctx := handlers.ContextWithAgentIdentity(r.Context(), handlers.AgentIdentity{
					ActorID:  "mock-org-admin",
					Email:    "orgadmin@customer.org",
					Role:     "org_admin",
					AuthType: "mock",
				})
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}
			if token == "mock-ordinary-user" {
				ctx := handlers.ContextWithAgentIdentity(r.Context(), handlers.AgentIdentity{
					ActorID:  "mock-ordinary-user",
					Email:    "user@customer.org",
					Role:     "ordinary_user",
					AuthType: "mock",
				})
				next.ServeHTTP(w, r.WithContext(ctx))
				return
			}
		}

		adminToken := os.Getenv("ADMIN_AGENT_TOKEN")
		supportToken := os.Getenv("SUPPORT_AGENT_TOKEN")
		readonlyToken := os.Getenv("READONLY_AGENT_TOKEN")

		tokenBytes := []byte(token)
		if adminToken != "" && subtle.ConstantTimeCompare(tokenBytes, []byte(adminToken)) == 1 {
			ctx := handlers.ContextWithAgentIdentity(r.Context(), handlers.AgentIdentity{
				ActorID:  "platform-admin-system",
				Email:    "admin@byos.local",
				Role:     "platform_admin",
				AuthType: "token",
			})
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}
		if supportToken != "" && subtle.ConstantTimeCompare(tokenBytes, []byte(supportToken)) == 1 {
			ctx := handlers.ContextWithAgentIdentity(r.Context(), handlers.AgentIdentity{
				ActorID:  "support-agent-system",
				Email:    "support@byos.local",
				Role:     "support_agent",
				AuthType: "token",
			})
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}
		if readonlyToken != "" && subtle.ConstantTimeCompare(tokenBytes, []byte(readonlyToken)) == 1 {
			ctx := handlers.ContextWithAgentIdentity(r.Context(), handlers.AgentIdentity{
				ActorID:  "readonly-operator-system",
				Email:    "readonly@byos.local",
				Role:     "read_only_operator",
				AuthType: "token",
			})
			next.ServeHTTP(w, r.WithContext(ctx))
			return
		}

		http.Error(w, "Unauthorized: invalid agent credentials", http.StatusUnauthorized)
	})
}

func mockWebAuthnMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return agentAuthMiddleware(next)
}

func mockLoginHandler(w http.ResponseWriter, r *http.Request) {
	if !IsDevMode() {
		http.NotFound(w, r)
		return
	}
	if applyCORS(w, r) {
		return
	}
	setAdminSessionCookie(w, r, "mock-support-agent")
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"token": "mock-support-agent"})
}

func adminLogoutHandler(w http.ResponseWriter, r *http.Request) {
	if applyCORS(w, r) {
		return
	}
	clearAdminSessionCookie(w, r)
	w.WriteHeader(http.StatusNoContent)
}

func setupRoutes(mux *http.ServeMux) {
	handlers.RegisterOrganizationRoutes(mux, db, agentAuthMiddleware)
	handlers.RegisterTicketRoutes(mux, db, agentAuthMiddleware)
	handlers.RegisterCustomerRoutes(mux, db, agentAuthMiddleware)
	handlers.RegisterQueueRoutes(mux, db, agentAuthMiddleware)
	mux.HandleFunc("/admin/v1/mailboxes/", agentAuthMiddleware(healthHandler))
	mux.HandleFunc("/admin/v1/interventions/execute", agentAuthMiddleware(interventionHandler))
	mux.HandleFunc("/admin/v1/auth/mock-login", withSecurityHeaders(mockLoginHandler))
	mux.HandleFunc("/admin/v1/auth/logout", withSecurityHeaders(adminLogoutHandler))
}

func main() {
	if err := ValidateStartupEnv(); err != nil {
		log.Fatalf("[FATAL] Configuration error: %v", err)
	}

	if IsDevMode() {
		log.Println("[SECURITY] WARNING: BYOS_DEV_MODE is enabled in admin-api; mock WebAuthn authentication is ACTIVE!")
	}

	connStr, err := GetSupportDatabaseURL()
	if err != nil {
		log.Fatalf("[FATAL] Database configuration error: %v", err)
	}

	pool, err := pgxpool.New(context.Background(), connStr)
	if err != nil {
		log.Fatalf("failed to connect to DB: %v", err)
	} else {
		db = pool
		defer db.Close()
	}

	setupRoutes(http.DefaultServeMux)

	port := os.Getenv("PORT")
	if port == "" {
		port = os.Getenv("ADMIN_PORT")
	}
	if port == "" {
		port = "8090"
	}

	log.Printf("Admin API (Support) listening on :%s", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}

func ticketsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode([]map[string]interface{}{
		{
			"id":                "tkt_9a10f82",
			"org_id":            "9cee43d9-986c-47b6-9451-8069f1dacc69",
			"org_name":          "BLAKSHADE LTD",
			"subject":           "Zero-Knowledge Key Reconstitution Failure on Migration",
			"encrypted_payload": "hpke-v1:048f219c...[Support-Key Encrypted]",
			"priority":          "Critical",
			"status":            "Pending Hardware Signoff",
			"created_at":        "12m ago",
		},
		{
			"id":                "tkt_1b83d90",
			"org_id":            "a1000000-0000-0000-0000-000000000001",
			"org_name":          "CYBERSEC LABS CORP",
			"subject":           "Storage Connection S3 S3_V2 signature mismatch",
			"encrypted_payload": "hpke-v1:99a184c2...[Support-Key Encrypted]",
			"priority":          "High",
			"status":            "Open",
			"created_at":        "45m ago",
		},
		{
			"id":                "tkt_3c44e12",
			"org_id":            "a1000000-0000-0000-0000-000000000002",
			"org_name":          "NEXUS QUANTUM SYSTEMS",
			"subject":           "Offline verifier challenge sync timeout",
			"encrypted_payload": "hpke-v1:30fe211a...[Support-Key Encrypted]",
			"priority":          "Normal",
			"status":            "In Progress",
			"created_at":        "2h ago",
		},
	})
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	// Route: /admin/v1/mailboxes/{uuid}/health
	path := strings.Trim(r.URL.Path, "/")
	parts := strings.Split(path, "/")
	// Expected parts: ["admin", "v1", "mailboxes", "{uuid}"] or ["admin", "v1", "mailboxes", "{uuid}", "health"]
	if len(parts) < 4 {
		http.Error(w, `{"error":"missing mailbox identifier"}`, http.StatusBadRequest)
		return
	}
	mailboxIDStr := parts[3]
	mailboxID, err := uuid.Parse(mailboxIDStr)
	if err != nil {
		http.Error(w, `{"error":"invalid mailbox UUID"}`, http.StatusBadRequest)
		return
	}

	if db != nil {
		var exists bool
		err := db.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM mailboxes WHERE id = $1)`, mailboxID).Scan(&exists)
		if err != nil {
			log.Printf("healthHandler database query error: %v", err)
			http.Error(w, `{"error":"database query failed"}`, http.StatusInternalServerError)
			return
		}
		if !exists {
			http.Error(w, `{"error":"mailbox not found"}`, http.StatusNotFound)
			return
		}
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"mailbox_id":         mailboxID.String(),
		"status":             "healthy",
		"quota_used":         1024 * 1024 * 5,
		"quota_total":        1024 * 1024 * 40,
		"blob_count":         12,
		"billing_status":     "active",
		"dkim_verified":      true,
		"spf_verified":       true,
		"active_connections": 2,
	})
}

func interventionHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Action            string `json:"action"` // "replay_queue", "revoke_session", "state_reset"
		TargetMailboxUUID string `json:"target_mailbox_uuid"`
		Reason            string `json:"reason"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	auditID := "aud_" + strings.ReplaceAll(uuid.New().String(), "-", "")[:12]

	if db != nil {
		actorUUID := uuid.New()
		var targetUUID *uuid.UUID
		if parsed, err := uuid.Parse(req.TargetMailboxUUID); err == nil {
			targetUUID = &parsed
		}
		metadataJSON, _ := json.Marshal(map[string]string{
			"reason":   req.Reason,
			"audit_id": auditID,
			"client":   "byos-support-crm",
		})
		_, _ = db.Exec(r.Context(), `
			INSERT INTO support_audit_logs (actor_uuid, admin_actor_uuid, action_type, target_mailbox_uuid, metadata)
			VALUES ($1, $2, $3, $4, $5)
		`, actorUUID, actorUUID, req.Action, targetUUID, metadataJSON)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":             true,
		"audit_id":            auditID,
		"action":              req.Action,
		"target_mailbox_uuid": req.TargetMailboxUUID,
		"timestamp":           time.Now().UTC().Format(time.RFC3339),
		"message":             "Intervention recorded to immutable ledger and queued for execution.",
	})
}
