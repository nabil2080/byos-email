package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"admin-api/handlers"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

var db *pgxpool.Pool

func mockWebAuthnMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "http://127.0.0.1:3003")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Access-Control-Allow-Credentials", "true")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		token := r.Header.Get("Authorization")
		if token != "Bearer mock-support-agent" {
			http.Error(w, "Unauthorized: WebAuthn challenge required", http.StatusUnauthorized)
			return
		}

		next.ServeHTTP(w, r)
	}
}

func main() {
	connStr := os.Getenv("SUPPORT_DB_URL")
	if connStr == "" {
		connStr = "postgres://role_support_agent:support_crm_password@localhost:5432/byos"
	}

	pool, err := pgxpool.New(context.Background(), connStr)
	if err != nil {
		log.Printf("Warning: failed to connect to DB: %v", err)
	} else {
		db = pool
		defer db.Close()
	}

	// Register organization and audit log handlers from handlers/organizations.go
	handlers.RegisterOrganizationRoutes(http.DefaultServeMux, db, mockWebAuthnMiddleware)

	// Auxiliary routes
	http.HandleFunc("/admin/v1/tickets", mockWebAuthnMiddleware(ticketsHandler))
	http.HandleFunc("/admin/v1/mailboxes/", mockWebAuthnMiddleware(healthHandler))
	http.HandleFunc("/admin/v1/interventions/execute", mockWebAuthnMiddleware(interventionHandler))
	http.HandleFunc("/admin/v1/auth/mock-login", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "http://127.0.0.1:3003")
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"token": "mock-support-agent"})
	})

	log.Println("Admin API (Support) listening on :8087")
	log.Fatal(http.ListenAndServe(":8087", nil))
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
