package main

// Evidence:
// - docs/08-v5.3-final.md Section 13.1-13.10 (frozen spec, read-only use):
//   reservation model (single-use, user+mailbox bound, 10m expiry);
//   atomic consumption (FOR UPDATE; idempotent same delivery_id; expired
//   410; not found 404); outbound AAD 29B; envelope 0x01||nonce12||ct+tag;
//   encryption_iv == envelope[1..13]; HPKE 0x01||enc32||ct;
//   send_token == content_key (server never receives it unwrapped);
//   pubkey canonical source GET /v1/outbound/pubkey; scheduled send same
//   capability model; SMTP hop postfix:25; UNIQUE(reservation_id).
// - ROADMAP_STATUS.md: prepare (reservation outbox_seq unique, 10m expiry);
//   send (FOR UPDATE, idempotent 1 row); MaxBytesReader 1MB prepare / 4MB
//   send -> 413; per-user 60/min -> 429; GET /pubkey not limited;
//   schedule (4MB, 60/min, X-User-Id + mailbox ownership + envelope +
//   iv==nonce + HPKE + scheduled_at RFC3339 5s..30d + FOR UPDATE
//   reserved->consumed idempotent); cancel (pending->cancelled); send-time
//   Redis check AFTER reservation validation BEFORE queue INSERT ->
//   429 {error,retry_after} + Retry-After without consuming reservation.
// - infra/postgres/init/002_outbound_reservations.sql +
//   003_scheduled_enhancements.sql: exact columns/constraints.
// - api.exe symbols: OutboundPrepareResponse, OutboundScheduleRequest/
//   Response, OutboundScheduledCancelRequest/Response, OutboundSendRequest/
//   Response + all five handlers.
// - tests/outbound_e2e.ps1, outbound_reservation_idempotency.ps1,
//   scheduled_e2e.ps1, rate_limit_e2e.ps1: endpoint behavior evidence.

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/mail"
	"os"
	"strconv"
	"strings"
	"time"

	"byos.email/crypto/envelope"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)


type OutboundPrepareRequest struct {
	MailboxID string `json:"mailbox_id"`
}

type OutboundPrepareResponse struct {
	ReservationID     string `json:"reservation_id"`
	OutboxSeq         int64  `json:"outbox_seq"`
	EncryptionVersion int    `json:"encryption_version"`
	AADVersion        int    `json:"aad_version"`
	ExpiresAt         string `json:"expires_at"`
}

type OutboundSendRequest struct {
	ReservationID     string   `json:"reservation_id"`
	MailboxID         string   `json:"mailbox_id"`
	Recipient         string   `json:"recipient"`
	EncryptedMessage  string   `json:"encrypted_message"`
	SendTokenWrapped  string   `json:"send_token_wrapped"`
	OutboxSeq         int64    `json:"outbox_seq"`
	EncryptionVersion int      `json:"encryption_version"`
	AADVersion        int      `json:"aad_version"`
	EncryptionIV      string   `json:"encryption_iv"`
	AttachmentIDs     []string `json:"attachment_ids,omitempty"`
	AliasID           string   `json:"alias_id,omitempty"`
}

type OutboundSendResponse struct {
	DeliveryID string `json:"delivery_id"`
	Status     string `json:"status"`
}

type OutboundScheduleRequest struct {
	ReservationID     string   `json:"reservation_id"`
	MailboxID         string   `json:"mailbox_id"`
	Recipient         string   `json:"recipient"`
	EncryptedMessage  string   `json:"encrypted_message"`
	SendTokenWrapped  string   `json:"send_token_wrapped"`
	OutboxSeq         int64    `json:"outbox_seq"`
	EncryptionVersion int      `json:"encryption_version"`
	AADVersion        int      `json:"aad_version"`
	EncryptionIV      string   `json:"encryption_iv"`
	ScheduledAt       string   `json:"scheduled_at"`
	AttachmentIDs     []string `json:"attachment_ids,omitempty"`
	DraftEnvelope     string   `json:"draft_envelope,omitempty"`
	DraftStorageRef   string   `json:"draft_storage_ref,omitempty"`
	Subject           string   `json:"subject,omitempty"`
}

type OutboundScheduleResponse struct {
	ID          string `json:"id"`
	DeliveryID  string `json:"delivery_id,omitempty"`
	ScheduledAt string `json:"scheduled_at"`
	Status      string `json:"status"`
}

type OutboundScheduledCancelRequest struct {
	DeliveryID    string `json:"delivery_id"`
	ReservationID string `json:"reservation_id"`
}

type OutboundScheduledCancelResponse struct {
	DeliveryID string `json:"delivery_id"`
	Status     string `json:"status"`
}

type OutboundPubkeyResponse struct {
	OutboundDeliveryPK string `json:"outbound_delivery_pk"`
}

func getOutboundDeliveryPK() string {
	pk := os.Getenv("OUTBOUND_DELIVERY_PK_B64")
	if pk == "" {
		if b, err := os.ReadFile(os.Getenv("OUTBOUND_DELIVERY_PK_FILE")); err == nil {
			pk = strings.TrimSpace(string(b))
		} else if b, err := os.ReadFile("/run/secrets/outbound_delivery_pk"); err == nil {
			pk = strings.TrimSpace(string(b))
		}
	}
	return pk
}

func outboundPubkeyHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	pk := getOutboundDeliveryPK()
	if pk == "" {
		http.Error(w, "outbound public key not configured", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(OutboundPubkeyResponse{OutboundDeliveryPK: pk})
}

func outboundPrepareHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "missing or invalid X-User-Id", http.StatusUnauthorized)
		return
	}
	if !allowPerUser(userID) {
		w.Header().Set("Retry-After", "60")
		http.Error(w, "too many attempts, try later", http.StatusTooManyRequests)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var req OutboundPrepareRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		if err.Error() == "http: request body too large" {
			http.Error(w, "request body too large", http.StatusRequestEntityTooLarge)
		} else {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
		}
		return
	}
	if _, err := uuid.Parse(req.MailboxID); err != nil {
		http.Error(w, "mailbox_id must be UUID", http.StatusBadRequest)
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
	// Verify mailbox belongs to the actor's org and is active.
	var userOrgID string
	err = conn.QueryRow(ctx, `SELECT org_id::text FROM users WHERE id=$1 AND is_active=true`, userID).Scan(&userOrgID)
	if err != nil {
		http.Error(w, "not authorized", http.StatusForbidden)
		return
	}
	var mailboxOrgID string
	var mailboxActive bool
	err = conn.QueryRow(ctx, `SELECT org_id::text, is_active FROM mailboxes WHERE id=$1`, req.MailboxID).Scan(&mailboxOrgID, &mailboxActive)
	if err != nil {
		http.Error(w, "mailbox not found", http.StatusNotFound)
		return
	}
	if mailboxOrgID != userOrgID || !mailboxActive {
		http.Error(w, "not authorized for this mailbox", http.StatusForbidden)
		return
	}
	var reservationID string
	var outboxSeq int64
	var encVersion int
	var aadVersion int
	var expiresAt time.Time
	err = conn.QueryRow(ctx, `INSERT INTO outbound_reservations (user_id, mailbox_id) VALUES ($1, $2) RETURNING reservation_id::text, outbox_seq, encryption_version, aad_version, expires_at`, userID, req.MailboxID).Scan(&reservationID, &outboxSeq, &encVersion, &aadVersion, &expiresAt)
	if err != nil {
		http.Error(w, "failed to create reservation", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(OutboundPrepareResponse{
		ReservationID:     reservationID,
		OutboxSeq:         outboxSeq,
		EncryptionVersion: encVersion,
		AADVersion:        aadVersion,
		ExpiresAt:         expiresAt.Format(time.RFC3339),
	})
}

// maxRecipientsPerMessage defines the V1 ceiling to prevent bulk spam / relay abuse (Section 8).
const maxRecipientsPerMessage = 50

func validateRecipients(recipientStr string) ([]string, error) {
	clean := strings.TrimSpace(recipientStr)
	if clean == "" {
		return nil, fmt.Errorf("recipient required")
	}
	// Anti-injection: reject control characters, newlines, or carriage returns (Section 8 / 21)
	if strings.ContainsAny(clean, "\r\n\x00") {
		return nil, fmt.Errorf("recipient contains invalid control characters")
	}
	// Split on comma or semicolon
	rawList := strings.FieldsFunc(clean, func(r rune) bool {
		return r == ',' || r == ';'
	})
	if len(rawList) == 0 {
		return nil, fmt.Errorf("recipient required")
	}
	if len(rawList) > maxRecipientsPerMessage {
		return nil, fmt.Errorf("recipient count exceeds maximum limit of %d (Section 8)", maxRecipientsPerMessage)
	}
	recipients := make([]string, 0, len(rawList))
	for _, raw := range rawList {
		addr := strings.TrimSpace(raw)
		if addr == "" {
			continue
		}
		parsed, err := mail.ParseAddress(addr)
		if err != nil || parsed.Address == "" || !strings.Contains(parsed.Address, "@") {
			return nil, fmt.Errorf("invalid recipient email address: %s", addr)
		}
		parts := strings.Split(parsed.Address, "@")
		if len(parts) != 2 || len(parts[0]) == 0 || len(parts[1]) < 3 || !strings.Contains(parts[1], ".") {
			return nil, fmt.Errorf("invalid recipient email domain: %s", addr)
		}
		recipients = append(recipients, parsed.Address)
	}
	if len(recipients) == 0 {
		return nil, fmt.Errorf("recipient required")
	}
	return recipients, nil
}

// validateOutboundEnvelope checks structural fields only: envelope format,
// iv==nonce, HPKE wrapper format, versions. Cryptographic AAD verification
// happens in outbound-worker (HPKE-Open + AES-GCM-Decrypt).
func validateOutboundEnvelope(req OutboundSendRequest) (encryptedMsg, sendToken, iv []byte, errMsg string, status int) {
	if req.ReservationID == "" || req.MailboxID == "" || req.Recipient == "" || req.EncryptedMessage == "" || req.SendTokenWrapped == "" {
		return nil, nil, nil, "Missing required fields (reservation_id, mailbox_id, recipient, encrypted_message, send_token_wrapped)", http.StatusBadRequest
	}
	if _, err := validateRecipients(req.Recipient); err != nil {
		return nil, nil, nil, err.Error(), http.StatusBadRequest
	}
	if req.OutboxSeq == 0 {
		return nil, nil, nil, "outbox_seq required", http.StatusBadRequest
	}
	if req.EncryptionVersion != 1 || req.AADVersion != 1 {
		return nil, nil, nil, "unsupported encryption_version/aad_version (only 1)", http.StatusBadRequest
	}
	if _, err := uuid.Parse(req.ReservationID); err != nil {
		return nil, nil, nil, "reservation_id must be UUID", http.StatusBadRequest
	}
	if _, err := uuid.Parse(req.MailboxID); err != nil {
		return nil, nil, nil, "mailbox_id must be UUID", http.StatusBadRequest
	}
	encryptedMsgBytes, err := base64.StdEncoding.DecodeString(req.EncryptedMessage)
	if err != nil {
		return nil, nil, nil, "encrypted_message must be base64", http.StatusBadRequest
	}
	sendTokenBytes, err := base64.StdEncoding.DecodeString(req.SendTokenWrapped)
	if err != nil {
		return nil, nil, nil, "send_token_wrapped must be base64", http.StatusBadRequest
	}
	encIVBytes, err := base64.StdEncoding.DecodeString(req.EncryptionIV)
	if err != nil {
		return nil, nil, nil, "encryption_iv must be base64", http.StatusBadRequest
	}
	if len(encIVBytes) != 12 {
		return nil, nil, nil, "encryption_iv must be 12 bytes", http.StatusBadRequest
	}
	if len(encryptedMsgBytes) < 29 {
		return nil, nil, nil, "encrypted_message too short (need version+nonce+tag)", http.StatusBadRequest
	}
	if encryptedMsgBytes[0] != 0x01 {
		return nil, nil, nil, "unsupported envelope version", http.StatusBadRequest
	}
	envelopeNonce := encryptedMsgBytes[1:13]
	for i := range envelopeNonce {
		if envelopeNonce[i] != encIVBytes[i] {
			return nil, nil, nil, "encryption_iv mismatch (must equal envelope nonce)", http.StatusBadRequest
		}
	}
	if len(sendTokenBytes) < 49 || sendTokenBytes[0] != 0x01 {
		return nil, nil, nil, "send_token_wrapped must be canonical HPKE (1||enc32||ct)", http.StatusBadRequest
	}
	return encryptedMsgBytes, sendTokenBytes, encIVBytes, "", 0
}

func outboundSendHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "missing or invalid X-User-Id", http.StatusUnauthorized)
		return
	}
	if !allowPerUser(userID) {
		w.Header().Set("Retry-After", "60")
		http.Error(w, "too many attempts, try later", http.StatusTooManyRequests)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4<<20)
	var req OutboundSendRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		if err.Error() == "http: request body too large" {
			http.Error(w, "request body too large", http.StatusRequestEntityTooLarge)
		} else {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
		}
		return
	}
	encryptedMsg, sendTokenBytes, encIV, errMsg, errStatus := validateOutboundEnvelope(req)
	if errStatus != 0 {
		http.Error(w, errMsg, errStatus)
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
	tx, err := conn.Begin(ctx)
	if err != nil {
		http.Error(w, "Failed to begin transaction", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)
	var resUserID, resMailboxID string
	var resSeq int64
	var resEnc, resAAD int
	var resStatus string
	var resExpires time.Time
	var resDeliveryID *string
	err = tx.QueryRow(ctx, `SELECT user_id::text, mailbox_id::text, outbox_seq, encryption_version, aad_version, status, expires_at, delivery_id::text FROM outbound_reservations WHERE reservation_id=$1 FOR UPDATE`, req.ReservationID).Scan(&resUserID, &resMailboxID, &resSeq, &resEnc, &resAAD, &resStatus, &resExpires, &resDeliveryID)
	if err != nil {
		http.Error(w, "reservation not found", http.StatusNotFound)
		return
	}
	// Idempotent retry: already consumed -> return existing delivery.
	if resStatus == "consumed" {
		var deliveryID string
		err = tx.QueryRow(ctx, `SELECT delivery_id::text FROM outbound_queue WHERE reservation_id=$1`, req.ReservationID).Scan(&deliveryID)
		if err != nil {
			http.Error(w, "consumed reservation without delivery", http.StatusInternalServerError)
			return
		}
		_ = tx.Commit(ctx)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(OutboundSendResponse{DeliveryID: deliveryID, Status: "queued"})
		return
	}
	if resStatus == "expired" || time.Now().After(resExpires) {
		_, _ = tx.Exec(ctx, `UPDATE outbound_reservations SET status='expired' WHERE reservation_id=$1`, req.ReservationID)
		_ = tx.Commit(ctx)
		http.Error(w, "reservation expired", http.StatusGone)
		return
	}
	if resUserID != userID || resMailboxID != req.MailboxID || resSeq != req.OutboxSeq || resEnc != req.EncryptionVersion || resAAD != req.AADVersion {
		http.Error(w, "reservation mismatch", http.StatusBadRequest)
		return
	}
	// Verify mailbox ownership and fetch domain + plans for rate limiting.
	var userOrgID string
	err = tx.QueryRow(ctx, `SELECT org_id::text FROM users WHERE id=$1 AND is_active=true`, userID).Scan(&userOrgID)
	if err != nil {
		http.Error(w, "not authorized", http.StatusForbidden)
		return
	}
	var mailboxOrgID, domainID, mailboxPlan, orgPlan string
	var mailboxActive bool
	err = tx.QueryRow(ctx, `SELECT m.org_id::text, m.domain_id::text, m.is_active, COALESCE(m.plan,'solo'), COALESCE(o.plan,'solo') FROM mailboxes m JOIN organizations o ON o.id=m.org_id WHERE m.id=$1`, req.MailboxID).Scan(&mailboxOrgID, &domainID, &mailboxActive, &mailboxPlan, &orgPlan)
	if err != nil {
		http.Error(w, "mailbox not found", http.StatusNotFound)
		return
	}
	if mailboxOrgID != userOrgID || !mailboxActive {
		http.Error(w, "not authorized for this mailbox", http.StatusForbidden)
		return
	}
	if req.AliasID != "" {
		var isEnabled bool
		var aliasID string
		if _, err := uuid.Parse(req.AliasID); err == nil {
			err = tx.QueryRow(ctx, `
				SELECT id::text, is_enabled
				FROM masked_aliases
				WHERE id = $1 AND mailbox_id = $2
			`, req.AliasID, req.MailboxID).Scan(&aliasID, &isEnabled)
		} else {
			err = tx.QueryRow(ctx, `
				SELECT id::text, is_enabled
				FROM masked_aliases
				WHERE lower(alias_address) = lower($1) AND mailbox_id = $2
			`, req.AliasID, req.MailboxID).Scan(&aliasID, &isEnabled)
		}
		if err != nil {
			_ = tx.Rollback(ctx)
			http.Error(w, "invalid_alias", http.StatusBadRequest)
			return
		}
		if !isEnabled {
			_ = tx.Rollback(ctx)
			http.Error(w, "alias_disabled", http.StatusBadRequest)
			return
		}
		_, _ = tx.Exec(ctx, `UPDATE masked_aliases SET reply_count = reply_count + 1 WHERE id = $1`, aliasID)
		var aliasDomainID string
		if err := tx.QueryRow(ctx, `SELECT id::text FROM domains WHERE name = 'masked.byos.local'`).Scan(&aliasDomainID); err == nil && aliasDomainID != "" {
			domainID = aliasDomainID
		}
	}
	// Rate check AFTER reservation validation, BEFORE queue INSERT. On
	// failure the reservation stays reserved (not consumed).
	allowed, retryAfter, _ := checkAndIncrRate(ctx, req.MailboxID, mailboxOrgID, mailboxPlan, orgPlan)
	if !allowed {
		_ = tx.Rollback(ctx)
		w.Header().Set("Retry-After", strconv.Itoa(retryAfter))
		http.Error(w, "rate limit exceeded", http.StatusTooManyRequests)
		return
	}
	deliveryID := uuid.New().String()
	expiresAt := time.Now().Add(24 * time.Hour)
	_, err = tx.Exec(ctx, `INSERT INTO outbound_queue (delivery_id, mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped, outbox_seq, encryption_version, aad_version, encryption_iv, reservation_id, status, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending', $12)`, deliveryID, req.MailboxID, domainID, req.Recipient, encryptedMsg, sendTokenBytes, req.OutboxSeq, req.EncryptionVersion, req.AADVersion, encIV, req.ReservationID, expiresAt)
	if err != nil {
		if isUniqueViolation(err) {
			var existing string
			_ = tx.QueryRow(ctx, `SELECT delivery_id::text FROM outbound_queue WHERE reservation_id=$1`, req.ReservationID).Scan(&existing)
			_ = tx.Commit(ctx)
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(OutboundSendResponse{DeliveryID: existing, Status: "queued"})
			return
		}
		http.Error(w, "failed to queue message", http.StatusInternalServerError)
		return
	}
	if len(req.AttachmentIDs) > 0 {
		// Note: attachments.message_id stores the outbound
		// delivery_id (text column, see 020_attachments.sql). There is no
		// separate delivery_id column by design for V1; keep the identifier
		// consistent between send and schedule paths. Validate UUID shape,
		// scope to the same mailbox, and only link currently-unlinked rows
		// so one message cannot hijack another message's attachments.
		uniqueIDsMap := make(map[string]bool)
		uniqueIDs := []string{}
		for _, id := range req.AttachmentIDs {
			parsed, err := uuid.Parse(id)
			if err != nil {
				http.Error(w, "attachment_ids must be UUIDs", http.StatusBadRequest)
				return
			}
			canonicalID := parsed.String()
			if !uniqueIDsMap[canonicalID] {
				uniqueIDsMap[canonicalID] = true
				uniqueIDs = append(uniqueIDs, canonicalID)
			}
		}
		// BUG-002: check the link result before consuming the reservation.
		// A short count means an ID is unknown, belongs to another mailbox,
		// or is already linked elsewhere; fail loud instead of queuing a
		// message whose attachments silently stayed unlinked.
		linkRes, linkErr := tx.Exec(ctx, `UPDATE attachments SET message_id = $1 WHERE id = ANY($2) AND mailbox_id = $3 AND message_id IS NULL`, deliveryID, uniqueIDs, req.MailboxID)
		if linkErr != nil {
			_ = tx.Rollback(ctx)
			http.Error(w, "failed to link attachments", http.StatusInternalServerError)
			return
		}
		if linkRes.RowsAffected() != int64(len(uniqueIDs)) {
			_ = tx.Rollback(ctx)
			http.Error(w, "attachment not found, already linked, or not in this mailbox", http.StatusBadRequest)
			return
		}
	}
	_, err = tx.Exec(ctx, `UPDATE outbound_reservations SET status='consumed', delivery_id=$1 WHERE reservation_id=$2`, deliveryID, req.ReservationID)
	if err != nil {
		http.Error(w, "failed to consume reservation", http.StatusInternalServerError)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "failed to commit", http.StatusInternalServerError)
		return
	}
	publishMailboxEvent(ctx, MailboxEvent{
		Type:        "message.created",
		MailboxID:   req.MailboxID,
		Folder:      "sent",
		MessageID:   deliveryID,
		UnreadDelta: 0,
	})
	auditLog(ctx, conn, mailboxOrgID, userID, "outbound_send", "outbound_queue", deliveryID, map[string]interface{}{"recipient": req.Recipient})
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(OutboundSendResponse{DeliveryID: deliveryID, Status: "queued"})
}

func storeScheduledDraftEnvelope(ctx context.Context, mailboxID, objectKey string, envelopeBytes []byte) error {
	payload := map[string]interface{}{
		"object_key": objectKey,
		"mailbox_id": mailboxID,
		"data":       envelopeBytes,
		"metadata": map[string]string{
			"mailbox_id":   mailboxID,
			"content_type": "application/json",
		},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal storage payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, storageWorkerURL()+"/api/store", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create storage request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if k := storageInternalKey(); k != "" {
		req.Header.Set("X-Internal-Key", k)
	}

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("storage request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBytes, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("storage store failed: status %d body %s", resp.StatusCode, string(respBytes))
	}
	return nil
}

func retrieveScheduledDraftEnvelope(ctx context.Context, mailboxID, objectKey string) ([]byte, error) {
	if !strings.HasPrefix(objectKey, "mailboxes/") {
		return nil, fmt.Errorf("invalid storage key prefix: %s", objectKey)
	}
	payload := map[string]string{
		"object_key": objectKey,
		"mailbox_id": mailboxID,
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal storage payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, storageWorkerURL()+"/api/retrieve", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create storage request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if k := storageInternalKey(); k != "" {
		req.Header.Set("X-Internal-Key", k)
	}

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("storage request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("storage retrieve failed with status %d", resp.StatusCode)
	}

	rawBytes, _, err := decodeStorageRetrieveBody(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("decode storage body: %w", err)
	}
	return rawBytes, nil
}

func outboundScheduleHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "missing or invalid X-User-Id", http.StatusUnauthorized)
		return
	}
	if !allowPerUser(userID) {
		w.Header().Set("Retry-After", "60")
		http.Error(w, "too many attempts, try later", http.StatusTooManyRequests)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 4<<20)
	var req OutboundScheduleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		if err.Error() == "http: request body too large" {
			http.Error(w, "request body too large", http.StatusRequestEntityTooLarge)
		} else {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
		}
		return
	}
	sendReq := OutboundSendRequest{
		ReservationID:     req.ReservationID,
		MailboxID:         req.MailboxID,
		Recipient:         req.Recipient,
		EncryptedMessage:  req.EncryptedMessage,
		SendTokenWrapped:  req.SendTokenWrapped,
		OutboxSeq:         req.OutboxSeq,
		EncryptionVersion: req.EncryptionVersion,
		AADVersion:        req.AADVersion,
		EncryptionIV:      req.EncryptionIV,
		AttachmentIDs:     req.AttachmentIDs,
	}
	encryptedMsg, sendTokenBytes, encIV, errMsg, errStatus := validateOutboundEnvelope(sendReq)
	if errStatus != 0 {
		http.Error(w, errMsg, errStatus)
		return
	}
	draftEnvelopeB64 := strings.TrimSpace(req.DraftEnvelope)
	if draftEnvelopeB64 == "" {
		draftEnvelopeB64 = strings.TrimSpace(req.DraftStorageRef)
	}
	if draftEnvelopeB64 == "" {
		http.Error(w, "draft envelope or storage ref required", http.StatusBadRequest)
		return
	}
	if req.ScheduledAt == "" {
		http.Error(w, "scheduled_at required", http.StatusBadRequest)
		return
	}
	scheduledAt, err := time.Parse(time.RFC3339Nano, req.ScheduledAt)
	if err != nil {
		if scheduledAt, err = time.Parse(time.RFC3339, req.ScheduledAt); err != nil {
			http.Error(w, "scheduled_at must be RFC3339", http.StatusBadRequest)
			return
		}
	}
	now := time.Now()
	if scheduledAt.Before(now.Add(5*time.Second)) || scheduledAt.After(now.Add(30*24*time.Hour)) {
		http.Error(w, "scheduled_at must be between 5 seconds and 30 days in the future", http.StatusBadRequest)
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
	tx, err := conn.Begin(ctx)
	if err != nil {
		http.Error(w, "Failed to begin transaction", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)
	var resUserID, resMailboxID string
	var resSeq int64
	var resEnc, resAAD int
	var resStatus string
	var resExpires time.Time
	err = tx.QueryRow(ctx, `SELECT user_id::text, mailbox_id::text, outbox_seq, encryption_version, aad_version, status, expires_at FROM outbound_reservations WHERE reservation_id=$1 FOR UPDATE`, req.ReservationID).Scan(&resUserID, &resMailboxID, &resSeq, &resEnc, &resAAD, &resStatus, &resExpires)
	if err != nil {
		http.Error(w, "reservation not found", http.StatusNotFound)
		return
	}
	if resStatus == "consumed" {
		var deliveryID string
		_ = tx.QueryRow(ctx, `SELECT delivery_id::text FROM scheduled_messages WHERE reservation_id=$1`, req.ReservationID).Scan(&deliveryID)
		_ = tx.Commit(ctx)
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(OutboundScheduleResponse{DeliveryID: deliveryID, ScheduledAt: scheduledAt.Format(time.RFC3339), Status: "scheduled"})
		return
	}
	if resStatus == "expired" || time.Now().After(resExpires) {
		_, _ = tx.Exec(ctx, `UPDATE outbound_reservations SET status='expired' WHERE reservation_id=$1`, req.ReservationID)
		_ = tx.Commit(ctx)
		http.Error(w, "reservation expired", http.StatusGone)
		return
	}
	if resUserID != userID || resMailboxID != req.MailboxID || resSeq != req.OutboxSeq || resEnc != req.EncryptionVersion || resAAD != req.AADVersion {
		http.Error(w, "reservation mismatch", http.StatusBadRequest)
		return
	}
	var userOrgID string
	err = tx.QueryRow(ctx, `SELECT org_id::text FROM users WHERE id=$1 AND is_active=true`, userID).Scan(&userOrgID)
	if err != nil {
		http.Error(w, "not authorized", http.StatusForbidden)
		return
	}
	var mailboxOrgID, domainID string
	var mailboxActive bool
	err = tx.QueryRow(ctx, `SELECT org_id::text, domain_id::text, is_active FROM mailboxes WHERE id=$1`, req.MailboxID).Scan(&mailboxOrgID, &domainID, &mailboxActive)
	if err != nil {
		http.Error(w, "mailbox not found", http.StatusNotFound)
		return
	}
	if mailboxOrgID != userOrgID || !mailboxActive {
		http.Error(w, "not authorized for this mailbox", http.StatusForbidden)
		return
	}
	deliveryID := uuid.New().String()
	rowID := uuid.New().String()
	objectKey := fmt.Sprintf("mailboxes/%s/scheduled/%s.draft.enc", req.MailboxID, rowID)

	if strings.HasPrefix(draftEnvelopeB64, "mailboxes/") {
		objectKey = draftEnvelopeB64
		log.Printf("[SCHEDULE_STEP] step=storage_upload object_key=%s mailbox_id=%s status=200 result=ok (reusing existing key)", objectKey, req.MailboxID)
	} else {
		envelopeBytes, decErr := base64.StdEncoding.DecodeString(draftEnvelopeB64)
		if decErr != nil || len(envelopeBytes) == 0 {
			log.Printf("[SCHEDULE_STEP] step=draft_decode mailbox_id=%s result=err err=%v", req.MailboxID, decErr)
			http.Error(w, "schedule: invalid draft envelope encoding", http.StatusBadRequest)
			return
		}
		if err := storeScheduledDraftEnvelope(ctx, req.MailboxID, objectKey, envelopeBytes); err != nil {
			log.Printf("[SCHEDULE_STEP] step=storage_upload object_key=%s mailbox_id=%s status=500 err=%v", objectKey, req.MailboxID, err)
			log.Printf("[SCHEDULE_WRITE] row_id=%s mailbox_id=%s storage_key=%s error=%v", rowID, req.MailboxID, objectKey, err)
			http.Error(w, "schedule: storage upload failed: "+err.Error(), http.StatusInternalServerError)
			return
		}
		log.Printf("[SCHEDULE_STEP] step=storage_upload object_key=%s mailbox_id=%s status=200 result=ok", objectKey, req.MailboxID)
	}

	sendTokenHash := sha256.Sum256(sendTokenBytes)
	expiresAt := scheduledAt.Add(24 * time.Hour)
	err = tx.QueryRow(ctx, `
		INSERT INTO scheduled_messages (
			id, mailbox_id, domain_id, recipient,
			encrypted_message, send_token_hpke_wrapped, send_token_hash,
			scheduled_at, send_at, status, delivery_id,
			reservation_id, outbox_seq, encryption_version,
			aad_version, encryption_iv, expires_at,
			draft_storage_ref, subject
		) VALUES (
			$1, $2, $3, $4,
			$5, $6, $7,
			$8, $8, 'pending', $9,
			$10, $11, $12,
			$13, $14, $15,
			$16, $17
		) RETURNING id::text
	`, rowID, req.MailboxID, domainID, req.Recipient,
		encryptedMsg, sendTokenBytes, sendTokenHash[:],
		scheduledAt, deliveryID,
		req.ReservationID, req.OutboxSeq, req.EncryptionVersion,
		req.AADVersion, encIV, expiresAt,
		objectKey, req.Subject).Scan(&rowID)
	if err != nil {
		if isUniqueViolation(err) {
			var existingID string
			_ = tx.QueryRow(ctx, `SELECT id::text FROM scheduled_messages WHERE reservation_id=$1`, req.ReservationID).Scan(&existingID)
			_ = tx.Commit(ctx)
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(OutboundScheduleResponse{ID: existingID, DeliveryID: deliveryID, ScheduledAt: scheduledAt.Format(time.RFC3339), Status: "scheduled"})
			return
		}
		log.Printf("[SCHEDULE_STEP] step=db_insert row_id=%s object_key=%s result=err err=%v", rowID, objectKey, err)
		http.Error(w, "schedule: db insert failed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	log.Printf("[SCHEDULE_STEP] step=db_insert row_id=%s object_key=%s result=ok", rowID, objectKey)
	// Propagate attachment IDs on the schedule path, mirroring the
	// send handler. Uses the same delivery_id-as-message_id convention (see
	// note above) so scheduled messages list attachments consistently.
	if len(req.AttachmentIDs) > 0 {
		uniqueIDsMap := make(map[string]bool)
		uniqueIDs := []string{}
		for _, id := range req.AttachmentIDs {
			parsed, err := uuid.Parse(id)
			if err != nil {
				http.Error(w, "attachment_ids must be UUIDs", http.StatusBadRequest)
				return
			}
			canonicalID := parsed.String()
			if !uniqueIDsMap[canonicalID] {
				uniqueIDsMap[canonicalID] = true
				uniqueIDs = append(uniqueIDs, canonicalID)
			}
		}
		// BUG-002: same strict link check as the send handler (see above).
		linkRes, linkErr := tx.Exec(ctx, `UPDATE attachments SET message_id = $1 WHERE id = ANY($2) AND mailbox_id = $3 AND message_id IS NULL`, deliveryID, uniqueIDs, req.MailboxID)
		if linkErr != nil {
			_ = tx.Rollback(ctx)
			http.Error(w, "failed to link attachments", http.StatusInternalServerError)
			return
		}
		if linkRes.RowsAffected() != int64(len(uniqueIDs)) {
			_ = tx.Rollback(ctx)
			http.Error(w, "attachment not found, already linked, or not in this mailbox", http.StatusBadRequest)
			return
		}
	}
	_, err = tx.Exec(ctx, `UPDATE outbound_reservations SET status='consumed', delivery_id=$1 WHERE reservation_id=$2`, deliveryID, req.ReservationID)
	if err != nil {
		http.Error(w, "failed to consume reservation", http.StatusInternalServerError)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "failed to commit", http.StatusInternalServerError)
		return
	}
	publishMailboxEvent(ctx, MailboxEvent{
		Type:        "message.created",
		MailboxID:   req.MailboxID,
		Folder:      "scheduled",
		MessageID:   deliveryID,
		UnreadDelta: 0,
	})
	auditLog(ctx, conn, mailboxOrgID, userID, "outbound_schedule", "scheduled_messages", deliveryID, map[string]interface{}{"recipient": req.Recipient})
	log.Printf("[SCHEDULE_WRITE] row_id=%s mailbox_id=%s storage_key=%s send_at=%s", rowID, req.MailboxID, objectKey, scheduledAt.Format(time.RFC3339))
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(OutboundScheduleResponse{ID: rowID, DeliveryID: deliveryID, ScheduledAt: scheduledAt.Format(time.RFC3339), Status: "scheduled"})
}

func outboundScheduledCancelHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "missing or invalid X-User-Id", http.StatusUnauthorized)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var req OutboundScheduledCancelRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	if req.DeliveryID == "" || req.ReservationID == "" {
		http.Error(w, "delivery_id and reservation_id required", http.StatusBadRequest)
		return
	}
	if _, err := uuid.Parse(req.DeliveryID); err != nil {
		http.Error(w, "delivery_id must be UUID", http.StatusBadRequest)
		return
	}
	if _, err := uuid.Parse(req.ReservationID); err != nil {
		http.Error(w, "reservation_id must be UUID", http.StatusBadRequest)
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
	// Verify the reservation belongs to the actor.
	var resUserID string
	err = conn.QueryRow(ctx, `SELECT user_id::text FROM outbound_reservations WHERE reservation_id=$1`, req.ReservationID).Scan(&resUserID)
	if err != nil {
		http.Error(w, "reservation not found", http.StatusNotFound)
		return
	}
	if resUserID != userID {
		http.Error(w, "not authorized for this reservation", http.StatusForbidden)
		return
	}
	cmd, err := conn.Exec(ctx, `UPDATE scheduled_messages SET status='cancelled' WHERE delivery_id=$1 AND reservation_id=$2 AND status='pending'`, req.DeliveryID, req.ReservationID)
	if err != nil {
		http.Error(w, "failed to cancel scheduled message", http.StatusInternalServerError)
		return
	}
	if cmd.RowsAffected() == 0 {
		http.Error(w, "scheduled message not found or not pending", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(OutboundScheduledCancelResponse{DeliveryID: req.DeliveryID, Status: "cancelled"})
}

// OutboundSchedulePathARequest is the request body for POST /v1/outbound/schedule-path-a.
// The client pre-seals the XWing envelope at compose time; the server stores it opaquely.
type OutboundSchedulePathARequest struct {
	MailboxID                 string               `json:"mailbox_id"`
	Recipient                 string               `json:"recipient"`
	EnvelopeJSON              string               `json:"envelope_json"`
	DeliverAt                 string               `json:"deliver_at"` // RFC3339
	DraftEnvelope             string               `json:"draft_envelope,omitempty"`
	DraftStorageRef           string               `json:"draft_storage_ref,omitempty"`
	Subject                   string               `json:"subject,omitempty"`
	AttachmentEnvelopes       []AttachmentEnvelope `json:"attachment_envelopes,omitempty"`
	SenderAttachmentEnvelopes []AttachmentEnvelope `json:"sender_attachment_envelopes,omitempty"`
}

type OutboundSchedulePathAResponse struct {
	ID          string `json:"id"`
	ScheduledAt string `json:"scheduled_at"`
	Status      string `json:"status"`
}

// outboundSchedulePathAHandler stores a pre-sealed Path A envelope for future delivery.
// POST /v1/outbound/schedule-path-a
func outboundSchedulePathAHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// 1. Auth
	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	// 2. Rate limit (shared per-user limit)
	if !allowPerUser(userID) {
		w.Header().Set("Retry-After", "60")
		http.Error(w, "rate_limited", http.StatusTooManyRequests)
		return
	}

	// 3. Body cap (4 MB)
	r.Body = http.MaxBytesReader(w, r.Body, 4<<20)

	// 4. Parse body
	var req OutboundSchedulePathARequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		if err.Error() == "http: request body too large" {
			http.Error(w, "request body too large", http.StatusRequestEntityTooLarge)
		} else {
			http.Error(w, "invalid request body", http.StatusBadRequest)
		}
		return
	}
	if strings.TrimSpace(req.MailboxID) == "" || strings.TrimSpace(req.Recipient) == "" ||
		strings.TrimSpace(req.EnvelopeJSON) == "" || strings.TrimSpace(req.DeliverAt) == "" {
		http.Error(w, "mailbox_id, recipient, envelope_json, deliver_at required", http.StatusBadRequest)
		return
	}
	if _, err := uuid.Parse(req.MailboxID); err != nil {
		http.Error(w, "invalid mailbox_id", http.StatusBadRequest)
		return
	}

	// 5. Validate deliver_at is 5s–30d in the future
	deliverAt, err := time.Parse(time.RFC3339, req.DeliverAt)
	if err != nil {
		if deliverAt, err = time.Parse(time.RFC3339Nano, req.DeliverAt); err != nil {
			http.Error(w, "deliver_at must be RFC3339", http.StatusBadRequest)
			return
		}
	}
	now := time.Now()
	if deliverAt.Before(now.Add(5*time.Second)) || deliverAt.After(now.Add(30*24*time.Hour)) {
		http.Error(w, "deliver_at must be between 5 seconds and 30 days in the future", http.StatusBadRequest)
		return
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	ctx := r.Context()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		http.Error(w, "database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	// 6. Verify sender owns mailbox_id
	var senderOrgID, senderLocalPart, senderDomainName, senderDomainID string
	var senderEd25519PK []byte
	err = conn.QueryRow(ctx, `
		SELECT m.org_id::text, m.local_part, d.name, m.mailbox_ed25519_pk, d.id::text
		FROM mailboxes m
		JOIN domains d ON d.id = m.domain_id
		WHERE m.id = $1 AND m.user_id = $2 AND m.is_active = true
	`, req.MailboxID, userID).Scan(&senderOrgID, &senderLocalPart, &senderDomainName, &senderEd25519PK, &senderDomainID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "not_sender_mailbox", http.StatusForbidden)
			return
		}
		http.Error(w, "database_error", http.StatusInternalServerError)
		return
	}

	// 7. Look up recipient mailbox (validates recipient is a BYOS user)
	cleanRecipient := strings.TrimSpace(strings.ToLower(req.Recipient))
	parts := strings.Split(cleanRecipient, "@")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		http.Error(w, "invalid_recipient", http.StatusBadRequest)
		return
	}
	var recipientMailboxID, recipientDomainID string
	var recipientXWingPK []byte
	err = conn.QueryRow(ctx, `
		SELECT m.id::text, m.mailbox_xwing_pk, d.id::text
		FROM mailboxes m
		JOIN domains d ON d.id = m.domain_id
		WHERE lower(m.local_part) = $1 AND lower(d.name) = $2
		  AND m.is_active = true AND m.key_status = 'active'
	`, parts[0], parts[1]).Scan(&recipientMailboxID, &recipientXWingPK, &recipientDomainID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "recipient_not_found", http.StatusNotFound)
			return
		}
		http.Error(w, "database_error", http.StatusInternalServerError)
		return
	}
	if len(recipientXWingPK) == 0 {
		http.Error(w, "recipient_not_xwing", http.StatusBadRequest)
		return
	}

	// 8. Parse and validate the envelope (v=1, correct alg, key_id matches)
	env, err := envelope.UnmarshalCanonical([]byte(req.EnvelopeJSON))
	if err != nil {
		http.Error(w, "invalid_envelope", http.StatusBadRequest)
		return
	}
	if env.V != 1 {
		http.Error(w, "unsupported_version", http.StatusBadRequest)
		return
	}
	if env.Alg != "HPKE-XWing-AES256GCM-v1" {
		http.Error(w, "unsupported_algorithm", http.StatusBadRequest)
		return
	}
	if env.KeyID != recipientMailboxID {
		http.Error(w, "key_id_mismatch", http.StatusBadRequest)
		return
	}
	if env.KeyEpoch == 0 {
		http.Error(w, "invalid_key_epoch", http.StatusBadRequest)
		return
	}

	// 9. Verify sender signature
	if len(senderEd25519PK) == 0 {
		http.Error(w, "sender_has_no_signing_key", http.StatusBadRequest)
		return
	}
	if err := envelope.VerifyEnvelopeSignature(senderEd25519PK, env); err != nil {
		http.Error(w, "invalid_signature", http.StatusBadRequest)
		return
	}

	// 10. Process draft envelope and upload to customer storage
	draftEnvelopeB64 := strings.TrimSpace(req.DraftEnvelope)
	if draftEnvelopeB64 == "" {
		draftEnvelopeB64 = strings.TrimSpace(req.DraftStorageRef)
	}
	if draftEnvelopeB64 == "" {
		http.Error(w, "draft envelope or storage ref required", http.StatusBadRequest)
		return
	}

	rowID := uuid.New().String()
	objectKey := fmt.Sprintf("mailboxes/%s/scheduled/%s.draft.enc", req.MailboxID, rowID)

	if strings.HasPrefix(draftEnvelopeB64, "mailboxes/") {
		objectKey = draftEnvelopeB64
		log.Printf("[SCHEDULE_STEP] step=storage_upload (path_a) object_key=%s mailbox_id=%s status=200 result=ok (reusing existing key)", objectKey, req.MailboxID)
	} else {
		envelopeBytes, decErr := base64.StdEncoding.DecodeString(draftEnvelopeB64)
		if decErr != nil || len(envelopeBytes) == 0 {
			log.Printf("[SCHEDULE_STEP] step=draft_decode (path_a) mailbox_id=%s result=err err=%v", req.MailboxID, decErr)
			http.Error(w, "schedule: invalid draft envelope encoding", http.StatusBadRequest)
			return
		}
		if err := storeScheduledDraftEnvelope(ctx, req.MailboxID, objectKey, envelopeBytes); err != nil {
			log.Printf("[SCHEDULE_STEP] step=storage_upload (path_a) object_key=%s mailbox_id=%s status=500 err=%v", objectKey, req.MailboxID, err)
			log.Printf("[SCHEDULE_WRITE] row_id=%s mailbox_id=%s storage_key=%s error=%v", rowID, req.MailboxID, objectKey, err)
			http.Error(w, "schedule: storage upload failed: "+err.Error(), http.StatusInternalServerError)
			return
		}
		log.Printf("[SCHEDULE_STEP] step=storage_upload (path_a) object_key=%s mailbox_id=%s status=200 result=ok", objectKey, req.MailboxID)
	}

	// 11. INSERT into scheduled_messages with is_path_a=true
	// send_token_hash must be NOT NULL per schema — use empty bytes as placeholder (no semantic use for Path A)
	expiresAt := deliverAt.Add(7 * 24 * time.Hour)
	attBytes := []byte("[]")
	if len(req.AttachmentEnvelopes) > 0 {
		var mErr error
		attBytes, mErr = json.Marshal(req.AttachmentEnvelopes)
		if mErr != nil {
			http.Error(w, "schedule: invalid attachment_envelopes", http.StatusBadRequest)
			return
		}
	}
	senderAttBytes := []byte("[]")
	if len(req.SenderAttachmentEnvelopes) > 0 {
		var mErr error
		senderAttBytes, mErr = json.Marshal(req.SenderAttachmentEnvelopes)
		if mErr != nil {
			http.Error(w, "schedule: invalid sender_attachment_envelopes", http.StatusBadRequest)
			return
		}
	}

	err = conn.QueryRow(ctx, `
		INSERT INTO scheduled_messages (
			id,
			mailbox_id, domain_id, recipient,
			send_token_hash,
			scheduled_at, send_at, status,
			expires_at,
			is_path_a, envelope_json,
			draft_storage_ref, subject,
			attachment_envelopes, sender_attachment_envelopes
		) VALUES (
			$1,
			$2, $3, $4,
			$5,
			$6, $6, 'pending',
			$7,
			true, $8,
			$9, $10,
			$11, $12
		) RETURNING id::text
	`, rowID, req.MailboxID, senderDomainID, cleanRecipient,
		[]byte{}, // send_token_hash placeholder
		deliverAt, expiresAt,
		req.EnvelopeJSON,
		objectKey, req.Subject,
		attBytes, senderAttBytes,
	).Scan(&rowID)
	if err != nil {
		log.Printf("[SCHEDULE_STEP] step=db_insert (path_a) row_id=%s object_key=%s result=err err=%v", rowID, objectKey, err)
		http.Error(w, "schedule: db insert failed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	log.Printf("[SCHEDULE_STEP] step=db_insert (path_a) row_id=%s object_key=%s result=ok", rowID, objectKey)

	auditLog(ctx, conn, senderOrgID, userID, "schedule_path_a", "scheduled_messages", rowID, map[string]interface{}{
		"recipient":  cleanRecipient,
		"deliver_at": deliverAt.Format(time.RFC3339),
	})

	publishMailboxEvent(ctx, MailboxEvent{
		Type:        "message.created",
		MailboxID:   req.MailboxID,
		Folder:      "scheduled",
		MessageID:   rowID,
		UnreadDelta: 0,
	})

	log.Printf("[SCHEDULE_WRITE] row_id=%s mailbox_id=%s storage_key=%s send_at=%s", rowID, req.MailboxID, objectKey, deliverAt.Format(time.RFC3339))

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	_ = json.NewEncoder(w).Encode(OutboundSchedulePathAResponse{
		ID:          rowID,
		ScheduledAt: deliverAt.Format(time.RFC3339),
		Status:      "scheduled",
	})
}

// mailboxScheduledCancelHandler handles POST /v1/mailboxes/{mailbox_id}/scheduled/{id}/cancel
// and DELETE /v1/mailboxes/{mailbox_id}/scheduled/{id}
func mailboxScheduledCancelHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost && r.Method != http.MethodDelete {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	mailboxID := r.PathValue("mailbox_id")
	schedID := r.PathValue("id")
	if schedID == "" {
		schedID = r.PathValue("scheduled_id")
	}
	if _, err := uuid.Parse(mailboxID); err != nil {
		http.Error(w, "invalid mailbox_id UUID", http.StatusBadRequest)
		return
	}
	if _, err := uuid.Parse(schedID); err != nil {
		http.Error(w, "invalid id UUID", http.StatusBadRequest)
		return
	}
	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	ctx := r.Context()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		http.Error(w, "database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	// Verify mailbox belongs to user
	var authorized string
	if err := conn.QueryRow(ctx, `SELECT m.id::text FROM mailboxes m JOIN users u ON u.org_id=m.org_id WHERE m.id=$1 AND u.id=$2 AND u.is_active=true`, mailboxID, userID).Scan(&authorized); err != nil {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	tx, err := conn.Begin(ctx)
	if err != nil {
		http.Error(w, "failed to start transaction", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	var subj, rcpt, draftRef string
	var resID *string
	err = tx.QueryRow(ctx, `
		SELECT COALESCE(subject, ''), recipient, COALESCE(draft_storage_ref, ''), reservation_id::text
		FROM scheduled_messages
		WHERE id=$1 AND mailbox_id=$2 AND status='pending'
		FOR UPDATE
	`, schedID, mailboxID).Scan(&subj, &rcpt, &draftRef, &resID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			log.Printf("[SCHEDULE_CANCEL] requested_id=%s mailbox_id=%s status=not_found found=false", schedID, mailboxID)
			http.Error(w, "scheduled message not found or not pending", http.StatusNotFound)
			return
		}
		http.Error(w, "database error", http.StatusInternalServerError)
		return
	}

	// Update scheduled_messages to cancelled
	if _, err := tx.Exec(ctx, `UPDATE scheduled_messages SET status='cancelled', updated_at=now() WHERE id=$1 AND mailbox_id=$2`, schedID, mailboxID); err != nil {
		http.Error(w, "failed to cancel scheduled message", http.StatusInternalServerError)
		return
	}

	// Expire reservation if applicable
	if resID != nil && *resID != "" {
		_, _ = tx.Exec(ctx, `UPDATE outbound_reservations SET status='expired' WHERE reservation_id=$1`, *resID)
	}

	draftID := uuid.New().String()
	// Retrieve encrypted envelope from customer storage and copy into drafts
	if draftRef != "" && strings.HasPrefix(draftRef, "mailboxes/") {
		envBytes, retErr := retrieveScheduledDraftEnvelope(ctx, mailboxID, draftRef)
		if retErr == nil && len(envBytes) > 0 {
			_, _ = tx.Exec(ctx, `
				INSERT INTO drafts (id, mailbox_id, subject, recipient, encrypted_envelope, version, created_at, updated_at)
				VALUES ($1, $2, $3, $4, $5, 1, now(), now())
			`, draftID, mailboxID, subj, rcpt, envBytes)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "failed to commit cancellation", http.StatusInternalServerError)
		return
	}

	log.Printf("[SCHEDULE_CANCEL] row_id=%s mailbox_id=%s draft_id=%s", schedID, mailboxID, draftID)

	// Publish real-time events
	publishMailboxEvent(ctx, MailboxEvent{
		Type:        "message.deleted",
		MailboxID:   mailboxID,
		Folder:      "scheduled",
		MessageID:   schedID,
		UnreadDelta: 0,
	})
	publishMailboxEvent(ctx, MailboxEvent{
		Type:        "message.created",
		MailboxID:   mailboxID,
		Folder:      "drafts",
		MessageID:   draftID,
		UnreadDelta: 0,
	})

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status":   "cancelled",
		"id":       schedID,
		"draft_id": draftID,
	})
}

type OutboundScheduleUpdateRequest struct {
	ScheduledAt     string `json:"scheduled_at,omitempty"`
	DraftEnvelope   string `json:"draft_envelope,omitempty"`
	DraftStorageRef string `json:"draft_storage_ref,omitempty"`
	Subject         string `json:"subject,omitempty"`
}

func mailboxScheduledUpdateHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut && r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	mailboxID := r.PathValue("mailbox_id")
	schedID := r.PathValue("id")
	if schedID == "" {
		schedID = r.PathValue("scheduled_id")
	}
	if _, err := uuid.Parse(mailboxID); err != nil {
		http.Error(w, "invalid mailbox_id UUID", http.StatusBadRequest)
		return
	}
	if _, err := uuid.Parse(schedID); err != nil {
		http.Error(w, "invalid id UUID", http.StatusBadRequest)
		return
	}
	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 4<<20)
	var req OutboundScheduleUpdateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	var scheduledAt *time.Time
	if strings.TrimSpace(req.ScheduledAt) != "" {
		t, err := time.Parse(time.RFC3339Nano, req.ScheduledAt)
		if err != nil {
			if t, err = time.Parse(time.RFC3339, req.ScheduledAt); err != nil {
				http.Error(w, "scheduled_at must be RFC3339", http.StatusBadRequest)
				return
			}
		}
		now := time.Now()
		if t.Before(now.Add(5*time.Second)) || t.After(now.Add(30*24*time.Hour)) {
			http.Error(w, "scheduled_at must be between 5 seconds and 30 days in the future", http.StatusBadRequest)
			return
		}
		scheduledAt = &t
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	ctx := r.Context()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		http.Error(w, "database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	var authorized string
	if err := conn.QueryRow(ctx, `SELECT m.id::text FROM mailboxes m JOIN users u ON u.org_id=m.org_id WHERE m.id=$1 AND u.id=$2 AND u.is_active=true`, mailboxID, userID).Scan(&authorized); err != nil {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	tx, err := conn.Begin(ctx)
	if err != nil {
		http.Error(w, "failed to start transaction", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	var currentID, currentDraftRef string
	err = tx.QueryRow(ctx, `
		SELECT id::text, COALESCE(draft_storage_ref, '')
		FROM scheduled_messages
		WHERE id=$1 AND mailbox_id=$2 AND status='pending'
		FOR UPDATE
	`, schedID, mailboxID).Scan(&currentID, &currentDraftRef)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			log.Printf("[SCHEDULE_UPDATE] requested_id=%s mailbox_id=%s status=not_found found=false", schedID, mailboxID)
			http.Error(w, "scheduled message not found or not pending", http.StatusNotFound)
			return
		}
		http.Error(w, "database error", http.StatusInternalServerError)
		return
	}

	draftEnvelopeB64 := strings.TrimSpace(req.DraftEnvelope)
	if draftEnvelopeB64 == "" && strings.TrimSpace(req.DraftStorageRef) != "" && !strings.HasPrefix(req.DraftStorageRef, "mailboxes/") {
		draftEnvelopeB64 = strings.TrimSpace(req.DraftStorageRef)
	}

	var targetStorageRef = currentDraftRef
	payloadChanged := false
	reuploaded := false

	if draftEnvelopeB64 != "" {
		payloadChanged = true
		envelopeBytes, decErr := base64.StdEncoding.DecodeString(draftEnvelopeB64)
		if decErr != nil || len(envelopeBytes) == 0 {
			http.Error(w, "invalid draft envelope encoding", http.StatusBadRequest)
			return
		}
		if targetStorageRef == "" || !strings.HasPrefix(targetStorageRef, "mailboxes/") {
			targetStorageRef = fmt.Sprintf("mailboxes/%s/scheduled/%s.draft.enc", mailboxID, currentID)
		}
		if err := storeScheduledDraftEnvelope(ctx, mailboxID, targetStorageRef, envelopeBytes); err != nil {
			log.Printf("[SCHEDULE_UPDATE] row_id=%s mailbox_id=%s payload_changed=true reuploaded=false error=%v", currentID, mailboxID, err)
			http.Error(w, "failed to update scheduled message in customer storage", http.StatusInternalServerError)
			return
		}
		reuploaded = true
	} else if strings.HasPrefix(req.DraftStorageRef, "mailboxes/") {
		targetStorageRef = req.DraftStorageRef
	}

	if targetStorageRef == "" || !strings.HasPrefix(targetStorageRef, "mailboxes/") {
		http.Error(w, "invalid or missing draft storage reference", http.StatusBadRequest)
		return
	}

	if scheduledAt != nil {
		expiresAt := (*scheduledAt).Add(7 * 24 * time.Hour)
		_, err = tx.Exec(ctx, `
			UPDATE scheduled_messages
			SET draft_storage_ref = $1,
			    subject = COALESCE($2, subject),
			    scheduled_at = $3,
			    send_at = $3,
			    expires_at = $4,
			    updated_at = now()
			WHERE id = $5 AND mailbox_id = $6 AND status = 'pending'
		`, targetStorageRef, req.Subject, *scheduledAt, expiresAt, currentID, mailboxID)
	} else {
		_, err = tx.Exec(ctx, `
			UPDATE scheduled_messages
			SET draft_storage_ref = $1,
			    subject = COALESCE($2, subject),
			    updated_at = now()
			WHERE id = $3 AND mailbox_id = $4 AND status = 'pending'
		`, targetStorageRef, req.Subject, currentID, mailboxID)
	}
	if err != nil {
		http.Error(w, "failed to update scheduled message", http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "failed to commit update", http.StatusInternalServerError)
		return
	}

	sendAtStr := "unchanged"
	if scheduledAt != nil {
		sendAtStr = scheduledAt.Format(time.RFC3339)
	}
	log.Printf("[SCHEDULE_UPDATE] row_id=%s mailbox_id=%s payload_changed=%t reuploaded=%t send_at=%s status=pending", currentID, mailboxID, payloadChanged, reuploaded, sendAtStr)

	publishMailboxEvent(ctx, MailboxEvent{
		Type:        "message.updated",
		MailboxID:   mailboxID,
		Folder:      "scheduled",
		MessageID:   currentID,
		UnreadDelta: 0,
	})

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "updated",
		"id":     currentID,
	})
}

// mailboxScheduledGetHandler retrieves a scheduled message and its encrypted draft envelope from customer storage.
func mailboxScheduledGetHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	mailboxID := r.PathValue("mailbox_id")
	schedID := r.PathValue("id")
	if schedID == "" {
		schedID = r.PathValue("scheduled_id")
	}
	if _, err := uuid.Parse(mailboxID); err != nil {
		http.Error(w, "invalid mailbox_id UUID", http.StatusBadRequest)
		return
	}
	if _, err := uuid.Parse(schedID); err != nil {
		http.Error(w, "invalid id UUID", http.StatusBadRequest)
		return
	}
	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	ctx := r.Context()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		http.Error(w, "database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	var authorized string
	if err := conn.QueryRow(ctx, `SELECT m.id::text FROM mailboxes m JOIN users u ON u.org_id=m.org_id WHERE m.id=$1 AND u.id=$2 AND u.is_active=true`, mailboxID, userID).Scan(&authorized); err != nil {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	var draftRef string
	var sendAt time.Time
	var status string
	err = conn.QueryRow(ctx, `
		SELECT COALESCE(draft_storage_ref, ''), COALESCE(send_at, scheduled_at), status
		FROM scheduled_messages
		WHERE id=$1 AND mailbox_id=$2
	`, schedID, mailboxID).Scan(&draftRef, &sendAt, &status)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "scheduled message not found", http.StatusNotFound)
			return
		}
		http.Error(w, "database error", http.StatusInternalServerError)
		return
	}

	if draftRef == "" || !strings.HasPrefix(draftRef, "mailboxes/") {
		log.Printf("[SCHEDULE_RETRIEVE] row_id=%s storage_key=%s success=false error=invalid_storage_ref", schedID, draftRef)
		http.Error(w, "scheduled message missing valid customer storage reference", http.StatusNotFound)
		return
	}

	rawBytes, err := retrieveScheduledDraftEnvelope(ctx, mailboxID, draftRef)
	if err != nil {
		log.Printf("[SCHEDULE_RETRIEVE] row_id=%s storage_key=%s success=false error=%v", schedID, draftRef, err)
		http.Error(w, "failed to retrieve scheduled draft from customer storage", http.StatusBadGateway)
		return
	}

	log.Printf("[SCHEDULE_RETRIEVE] row_id=%s storage_key=%s success=true", schedID, draftRef)

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"id":                 schedID,
		"mailbox_id":         mailboxID,
		"draft_storage_ref":  draftRef,
		"encrypted_envelope": base64.StdEncoding.EncodeToString(rawBytes),
		"send_at":            sendAt.Format(time.RFC3339),
		"status":             status,
	})
}

// mailboxScheduledItemHandler handles GET, DELETE, and PUT/POST for scheduled items.
func mailboxScheduledItemHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		mailboxScheduledGetHandler(w, r)
		return
	}
	if r.Method == http.MethodDelete {
		mailboxScheduledCancelHandler(w, r)
		return
	}
	if r.Method == http.MethodPut || r.Method == http.MethodPost {
		mailboxScheduledUpdateHandler(w, r)
		return
	}
	http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
}

// mailboxScheduledListHandler routes to messagesHandler with folder=scheduled.
func mailboxScheduledListHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	q := r.URL.Query()
	q.Set("folder", "scheduled")
	r.URL.RawQuery = q.Encode()
	messagesHandler(w, r)
}


