package main

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type CreateBridgeCredentialRequest struct {
	Label string `json:"label"`
}

type BridgeCredentialResponse struct {
	ID         string     `json:"id"`
	Label      string     `json:"label"`
	Token      string     `json:"token,omitempty"` // Returned ONLY on creation
	CreatedAt  time.Time  `json:"created_at"`
	LastUsedAt *time.Time `json:"last_used_at,omitempty"`
}

type BridgeAuthenticateRequest struct {
	MailboxID string `json:"mailbox_id"`
	Token     string `json:"token"`
}

type BridgeMessageResponse struct {
	ID         string     `json:"id"`
	MessageSeq int64      `json:"message_seq"`
	Sender     string     `json:"sender"`
	Recipients []string   `json:"recipients"`
	ReceivedAt time.Time  `json:"received_at"`
	SentAt     *time.Time `json:"sent_at,omitempty"`
	Status     string     `json:"status"`
}

type BridgeMessageBodyResponse = MessageBodyResponse

func bridgeMessagesHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	mailboxID := r.URL.Query().Get("mailbox_id")
	token := r.Header.Get("X-BYOS-Bridge-Token")
	if _, err := uuid.Parse(mailboxID); err != nil || token == "" {
		http.Error(w, "invalid credentials", http.StatusUnauthorized)
		return
	}
	hash := sha256.Sum256([]byte(token))
	conn, err := pgx.Connect(r.Context(), bridgeDatabaseURL())
	if err != nil {
		http.Error(w, "authentication unavailable", http.StatusServiceUnavailable)
		return
	}
	defer conn.Close(r.Context())
	var credentialID string
	if err := conn.QueryRow(r.Context(), `
		SELECT b.id::text 
		FROM bridge_credentials b
		JOIN mailboxes m ON m.id = b.mailbox_id
		LEFT JOIN users u ON u.id = m.user_id
		WHERE b.mailbox_id=$1 
		  AND b.token_hash=$2 
		  AND b.revoked_at IS NULL 
		  AND m.is_active=true 
		  AND (u.is_active IS NULL OR u.is_active=true)`, mailboxID, hash[:]).Scan(&credentialID); err != nil {
		http.Error(w, "invalid credentials", http.StatusUnauthorized)
		return
	}
	if _, err := conn.Exec(r.Context(), `UPDATE bridge_credentials SET last_used_at=now() WHERE id=$1`, credentialID); err != nil {
		http.Error(w, "authentication unavailable", http.StatusServiceUnavailable)
		return
	}
	rows, err := conn.Query(r.Context(), `
		SELECT id::text, message_seq, sender, recipients, received_at, sent_at, status
		FROM message_metadata WHERE mailbox_id=$1
		ORDER BY message_seq DESC LIMIT 100`, mailboxID)
	if err != nil {
		http.Error(w, "failed to query messages", http.StatusInternalServerError)
		return
	}
	defer rows.Close()
	messages := make([]BridgeMessageResponse, 0)
	for rows.Next() {
		var message BridgeMessageResponse
		if err := rows.Scan(&message.ID, &message.MessageSeq, &message.Sender, &message.Recipients, &message.ReceivedAt, &message.SentAt, &message.Status); err != nil {
			http.Error(w, "failed to read messages", http.StatusInternalServerError)
			return
		}
		messages = append(messages, message)
	}
	if err := rows.Err(); err != nil {
		http.Error(w, "failed to read messages", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"messages": messages})
}

func bridgeMessageBodyHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	mailboxID := r.URL.Query().Get("mailbox_id")
	messageID := r.URL.Query().Get("message_id")
	token := r.Header.Get("X-BYOS-Bridge-Token")
	if _, err := uuid.Parse(mailboxID); err != nil || token == "" {
		http.Error(w, "invalid credentials", http.StatusUnauthorized)
		return
	}
	if _, err := uuid.Parse(messageID); err != nil {
		http.Error(w, "invalid message_id UUID", http.StatusBadRequest)
		return
	}
	hash := sha256.Sum256([]byte(token))
	conn, err := pgx.Connect(r.Context(), bridgeDatabaseURL())
	if err != nil {
		http.Error(w, "authentication unavailable", http.StatusServiceUnavailable)
		return
	}
	defer conn.Close(r.Context())
	var credentialID string
	if err := conn.QueryRow(r.Context(), `
		SELECT b.id::text 
		FROM bridge_credentials b
		JOIN mailboxes m ON m.id = b.mailbox_id
		LEFT JOIN users u ON u.id = m.user_id
		WHERE b.mailbox_id=$1 
		  AND b.token_hash=$2 
		  AND b.revoked_at IS NULL 
		  AND m.is_active=true 
		  AND (u.is_active IS NULL OR u.is_active=true)`, mailboxID, hash[:]).Scan(&credentialID); err != nil {
		http.Error(w, "invalid credentials", http.StatusUnauthorized)
		return
	}
	if _, err := conn.Exec(r.Context(), `UPDATE bridge_credentials SET last_used_at=now() WHERE id=$1`, credentialID); err != nil {
		http.Error(w, "authentication unavailable", http.StatusServiceUnavailable)
		return
	}

	body, err := loadEncryptedMessageBody(r.Context(), conn, mailboxID, messageID)
	if err != nil {
		var loadErr *messageBodyLoadError
		if errors.As(err, &loadErr) {
			http.Error(w, loadErr.msg, loadErr.status)
			return
		}
		http.Error(w, "message not found", http.StatusNotFound)
		return
	}

	response := BridgeMessageBodyResponse{
		EncryptedBody:         body.EncryptedBody,
		ContentKeyHPKEWrapped: body.ContentKeyHPKEWrapped,
		EncryptionIV:          body.EncryptionIV,
		AADVersion:            body.AADVersion,
		BundleHash:            body.BundleHash,
		EncryptionVersion:     body.EncryptionVersion,
		MessageSeq:            body.MessageSeq,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func bridgeDatabaseURL() string {
	if dsn := os.Getenv("DATABASE_URL"); dsn != "" {
		return dsn
	}
	return "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
}

func bridgeAuthenticateHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var req BridgeAuthenticateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Token == "" {
		http.Error(w, "invalid credentials", http.StatusUnauthorized)
		return
	}
	if _, err := uuid.Parse(req.MailboxID); err != nil {
		http.Error(w, "invalid credentials", http.StatusUnauthorized)
		return
	}
	hash := sha256.Sum256([]byte(req.Token))
	ctx := r.Context()
	conn, err := pgx.Connect(ctx, bridgeDatabaseURL())
	if err != nil {
		http.Error(w, "authentication unavailable", http.StatusServiceUnavailable)
		return
	}
	defer conn.Close(ctx)
	var credentialID string
	if err := conn.QueryRow(ctx, `
		SELECT b.id::text 
		FROM bridge_credentials b
		JOIN mailboxes m ON m.id = b.mailbox_id
		LEFT JOIN users u ON u.id = m.user_id
		WHERE b.mailbox_id=$1 
		  AND b.token_hash=$2 
		  AND b.revoked_at IS NULL 
		  AND m.is_active=true 
		  AND (u.is_active IS NULL OR u.is_active=true)`, req.MailboxID, hash[:]).Scan(&credentialID); err != nil {
		http.Error(w, "invalid credentials", http.StatusUnauthorized)
		return
	}
	if _, err := conn.Exec(ctx, `UPDATE bridge_credentials SET last_used_at=now() WHERE id=$1`, credentialID); err != nil {
		http.Error(w, "authentication unavailable", http.StatusServiceUnavailable)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func bridgeCredentialsHandler(w http.ResponseWriter, r *http.Request) {
	mailboxID := r.PathValue("mailbox_id")
	if mailboxID == "" {
		http.Error(w, "mailbox_id required", http.StatusBadRequest)
		return
	}
	if _, err := uuid.Parse(mailboxID); err != nil {
		http.Error(w, "invalid mailbox_id UUID", http.StatusBadRequest)
		return
	}

	userID, ok := getAuthenticatedUserID(r)
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

	// Authorize org membership
	var userOrgID, mailboxOrgID string
	err = conn.QueryRow(ctx, `SELECT org_id::text FROM users WHERE id=$1 AND is_active=true`, userID).Scan(&userOrgID)
	if err != nil {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	err = conn.QueryRow(ctx, `SELECT org_id::text FROM mailboxes WHERE id=$1`, mailboxID).Scan(&mailboxOrgID)
	if err != nil {
		http.Error(w, "mailbox not found", http.StatusNotFound)
		return
	}
	if userOrgID != mailboxOrgID {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	// Check if path has a specific credential ID for DELETE
	credID := r.PathValue("credential_id")

	switch r.Method {
	case http.MethodGet:
		rows, err := conn.Query(ctx, `
			SELECT id::text, label, created_at, last_used_at
			FROM bridge_credentials
			WHERE mailbox_id=$1 AND revoked_at IS NULL
			ORDER BY created_at DESC
		`, mailboxID)
		if err != nil {
			http.Error(w, "failed to query bridge credentials", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		creds := make([]BridgeCredentialResponse, 0)
		for rows.Next() {
			var c BridgeCredentialResponse
			if err := rows.Scan(&c.ID, &c.Label, &c.CreatedAt, &c.LastUsedAt); err == nil {
				creds = append(creds, c)
			}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"credentials": creds})

	case http.MethodPost:
		r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
		var req CreateBridgeCredentialRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		label := strings.TrimSpace(req.Label)
		if label == "" {
			label = "Desktop Mail Client"
		}

		// Generate random 32-byte token
		rawBytes := make([]byte, 32)
		if _, err := rand.Read(rawBytes); err != nil {
			http.Error(w, "entropy error", http.StatusInternalServerError)
			return
		}
		token := "byos_bridge_" + hex.EncodeToString(rawBytes)
		hash := sha256.Sum256([]byte(token))

		var id string
		var createdAt time.Time
		err = conn.QueryRow(ctx, `
			INSERT INTO bridge_credentials (mailbox_id, label, token_hash)
			VALUES ($1, $2, $3)
			RETURNING id::text, created_at
		`, mailboxID, label, hash[:]).Scan(&id, &createdAt)
		if err != nil {
			http.Error(w, "failed to create bridge credential", http.StatusInternalServerError)
			return
		}

		auditLog(ctx, conn, userOrgID, userID, "create_bridge_credential", "bridge_credential", id, map[string]interface{}{"label": label})

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(BridgeCredentialResponse{
			ID:        id,
			Label:     label,
			Token:     token,
			CreatedAt: createdAt,
		})

	case http.MethodDelete:
		if credID == "" {
			http.Error(w, "credential_id required in URL path", http.StatusBadRequest)
			return
		}
		if _, err := uuid.Parse(credID); err != nil {
			http.Error(w, "invalid credential_id UUID", http.StatusBadRequest)
			return
		}

		res, err := conn.Exec(ctx, `
			UPDATE bridge_credentials
			SET revoked_at=now()
			WHERE id=$1 AND mailbox_id=$2 AND revoked_at IS NULL
		`, credID, mailboxID)
		if err != nil {
			http.Error(w, "failed to revoke bridge credential", http.StatusInternalServerError)
			return
		}
		if res.RowsAffected() == 0 {
			http.Error(w, "credential not found or already revoked", http.StatusNotFound)
			return
		}

		auditLog(ctx, conn, userOrgID, userID, "revoke_bridge_credential", "bridge_credential", credID, nil)

		w.WriteHeader(http.StatusNoContent)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

type BridgeOutboundSendRequest struct {
	MailboxID  string `json:"mailbox_id"`
	Recipient  string `json:"recipient"`
	RawMessage string `json:"raw_message"` // base64 encoded RFC 5322 MIME
}

type BridgeOutboundSendResponse struct {
	DeliveryID string `json:"delivery_id"`
	Status     string `json:"status"`
}

func getCryptoWorkerURL() string {
	if u := os.Getenv("CRYPTO_WORKER_URL"); u != "" {
		return strings.TrimRight(u, "/")
	}
	return "http://localhost:8084"
}

func bridgeOutboundSendHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	token := r.Header.Get("X-BYOS-Bridge-Token")
	if token == "" {
		http.Error(w, "invalid credentials", http.StatusUnauthorized)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 4<<20) // 4MB
	var req BridgeOutboundSendRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		if err.Error() == "http: request body too large" {
			http.Error(w, "request body too large", http.StatusRequestEntityTooLarge)
		} else {
			http.Error(w, "invalid request body", http.StatusBadRequest)
		}
		return
	}

	if _, err := uuid.Parse(req.MailboxID); err != nil {
		http.Error(w, "invalid mailbox_id UUID", http.StatusBadRequest)
		return
	}
	if req.RawMessage == "" {
		http.Error(w, "raw_message required", http.StatusBadRequest)
		return
	}
	// Verify raw message is valid base64
	if _, err := base64.StdEncoding.DecodeString(req.RawMessage); err != nil {
		http.Error(w, "invalid base64 raw_message", http.StatusBadRequest)
		return
	}

	// Validate recipient(s) - adheres to Section 8 ceiling & anti-injection checks
	if _, err := validateRecipients(req.Recipient); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	tokenHash := sha256.Sum256([]byte(token))
	ctx := r.Context()
	conn, err := pgx.Connect(ctx, bridgeDatabaseURL())
	if err != nil {
		http.Error(w, "database unavailable", http.StatusServiceUnavailable)
		return
	}
	defer conn.Close(ctx)

	// Authenticate token, verify mailbox is active, and ensure domain is verified
	var credentialID, mailboxUserID, mailboxOrgID, domainID, mailboxPlan, orgPlan string
	var domainVerified bool
	err = conn.QueryRow(ctx, `
		SELECT b.id::text, COALESCE(m.user_id::text, ''), m.org_id::text, m.domain_id::text, d.is_verified, COALESCE(m.plan, 'solo'), COALESCE(o.plan, 'solo')
		FROM bridge_credentials b
		JOIN mailboxes m ON m.id = b.mailbox_id
		JOIN domains d ON d.id = m.domain_id
		JOIN organizations o ON o.id = m.org_id
		LEFT JOIN users u ON u.id = m.user_id
		WHERE b.mailbox_id=$1 
		  AND b.token_hash=$2 
		  AND b.revoked_at IS NULL 
		  AND m.is_active=true 
		  AND (u.is_active IS NULL OR u.is_active=true)
	`, req.MailboxID, tokenHash[:]).Scan(&credentialID, &mailboxUserID, &mailboxOrgID, &domainID, &domainVerified, &mailboxPlan, &orgPlan)
	if err != nil {
		http.Error(w, "invalid credentials", http.StatusUnauthorized)
		return
	}
	if !domainVerified {
		http.Error(w, "domain not verified", http.StatusForbidden)
		return
	}

	// Rate limit check
	allowed, retryAfter, _ := checkAndIncrRate(ctx, req.MailboxID, mailboxOrgID, mailboxPlan, orgPlan)
	if !allowed {
		w.Header().Set("Retry-After", strconv.Itoa(retryAfter))
		http.Error(w, "rate limit exceeded", http.StatusTooManyRequests)
		return
	}

	// If mailbox has no user_id assigned, pick first active user in org for reservation FK
	if mailboxUserID == "" {
		err = conn.QueryRow(ctx, `SELECT id::text FROM users WHERE org_id=$1 AND is_active=true ORDER BY created_at ASC LIMIT 1`, mailboxOrgID).Scan(&mailboxUserID)
		if err != nil {
			http.Error(w, "no active user for mailbox organization", http.StatusInternalServerError)
			return
		}
	}

	// Create reservation
	var reservationID string
	var outboxSeq int64
	var encVersion, aadVersion int
	var resExpires time.Time
	err = conn.QueryRow(ctx, `
		INSERT INTO outbound_reservations (user_id, mailbox_id)
		VALUES ($1, $2)
		RETURNING reservation_id::text, outbox_seq, encryption_version, aad_version, expires_at
	`, mailboxUserID, req.MailboxID).Scan(&reservationID, &outboxSeq, &encVersion, &aadVersion, &resExpires)
	if err != nil {
		http.Error(w, "failed to create outbound reservation", http.StatusInternalServerError)
		return
	}

	pk := getOutboundDeliveryPK()
	if pk == "" {
		http.Error(w, "outbound public key not configured", http.StatusInternalServerError)
		return
	}

	// Encrypt via crypto-worker
	cryptoPayload := map[string]interface{}{
		"outbound_delivery_pk": pk,
		"mailbox_id":          req.MailboxID,
		"outbox_seq":          outboxSeq,
		"plaintext":           req.RawMessage,
	}
	cryptoJSON, err := json.Marshal(cryptoPayload)
	if err != nil {
		http.Error(w, "failed to marshal crypto request", http.StatusInternalServerError)
		return
	}
	cryptoReq, err := http.NewRequestWithContext(ctx, http.MethodPost, getCryptoWorkerURL()+"/v1/encrypt-outbound", bytes.NewReader(cryptoJSON))
	if err != nil {
		http.Error(w, "failed to create crypto request", http.StatusInternalServerError)
		return
	}
	cryptoReq.Header.Set("Content-Type", "application/json")
	cryptoResp, err := http.DefaultClient.Do(cryptoReq)
	if err != nil || cryptoResp.StatusCode != http.StatusOK {
		if cryptoResp != nil {
			cryptoResp.Body.Close()
		}
		http.Error(w, "crypto service unavailable", http.StatusServiceUnavailable)
		return
	}
	defer cryptoResp.Body.Close()

	var encResp struct {
		EncryptedMessage      string `json:"encrypted_message"`
		SendTokenHPKEWrapped string `json:"send_token_hpke_wrapped"`
		EncryptionIV          string `json:"encryption_iv"`
		EncryptionVersion     int    `json:"encryption_version"`
		AADVersion            int    `json:"aad_version"`
	}
	if err := json.NewDecoder(cryptoResp.Body).Decode(&encResp); err != nil {
		http.Error(w, "invalid crypto response", http.StatusInternalServerError)
		return
	}

	encMsgBytes, err := base64.StdEncoding.DecodeString(encResp.EncryptedMessage)
	if err != nil {
		http.Error(w, "failed to decode encrypted message", http.StatusInternalServerError)
		return
	}
	sendTokenBytes, err := base64.StdEncoding.DecodeString(encResp.SendTokenHPKEWrapped)
	if err != nil {
		http.Error(w, "failed to decode send token", http.StatusInternalServerError)
		return
	}
	encIVBytes, err := base64.StdEncoding.DecodeString(encResp.EncryptionIV)
	if err != nil {
		http.Error(w, "failed to decode iv", http.StatusInternalServerError)
		return
	}

	deliveryID := uuid.New().String()
	expiresAt := time.Now().Add(24 * time.Hour)
	_, err = conn.Exec(ctx, `
		INSERT INTO outbound_queue (
			delivery_id, mailbox_id, domain_id, recipient, 
			encrypted_message, send_token_hpke_wrapped, outbox_seq, 
			encryption_version, aad_version, encryption_iv, 
			reservation_id, status, expires_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending', $12)
	`, deliveryID, req.MailboxID, domainID, req.Recipient, encMsgBytes, sendTokenBytes, outboxSeq, encResp.EncryptionVersion, encResp.AADVersion, encIVBytes, reservationID, expiresAt)
	if err != nil {
		http.Error(w, "failed to queue message", http.StatusInternalServerError)
		return
	}

	_, _ = conn.Exec(ctx, `UPDATE outbound_reservations SET status='consumed', delivery_id=$1 WHERE reservation_id=$2`, deliveryID, reservationID)
	_, _ = conn.Exec(ctx, `UPDATE bridge_credentials SET last_used_at=now() WHERE id=$1`, credentialID)

	auditLog(ctx, conn, mailboxOrgID, mailboxUserID, "bridge_outbound_send", "outbound_queue", deliveryID, map[string]interface{}{"recipient": req.Recipient})

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(BridgeOutboundSendResponse{
		DeliveryID: deliveryID,
		Status:     "queued",
	})
}
