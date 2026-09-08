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
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

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
}

type OutboundScheduleResponse struct {
	DeliveryID  string `json:"delivery_id"`
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

func outboundPubkeyHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	pk := os.Getenv("OUTBOUND_DELIVERY_PK_B64")
	if pk == "" {
		if b, err := os.ReadFile(os.Getenv("OUTBOUND_DELIVERY_PK_FILE")); err == nil {
			pk = strings.TrimSpace(string(b))
		} else if b, err := os.ReadFile("/run/secrets/outbound_delivery_pk"); err == nil {
			pk = strings.TrimSpace(string(b))
		}
	}
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

// validateOutboundEnvelope checks structural fields only: envelope format,
// iv==nonce, HPKE wrapper format, versions. Cryptographic AAD verification
// happens in outbound-worker (HPKE-Open + AES-GCM-Decrypt).
func validateOutboundEnvelope(req OutboundSendRequest) (encryptedMsg, sendToken, iv []byte, errMsg string, status int) {
	if req.ReservationID == "" || req.MailboxID == "" || req.Recipient == "" || req.EncryptedMessage == "" || req.SendTokenWrapped == "" {
		return nil, nil, nil, "Missing required fields (reservation_id, mailbox_id, recipient, encrypted_message, send_token_wrapped)", http.StatusBadRequest
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
		// BUG-004 hardening: attachments.message_id stores the outbound
		// delivery_id (text column, see 020_attachments.sql). There is no
		// separate delivery_id column by design for V1; keep the identifier
		// consistent between send and schedule paths. Validate UUID shape,
		// scope to the same mailbox, and only link currently-unlinked rows
		// so one message cannot hijack another message's attachments.
		for _, id := range req.AttachmentIDs {
			if _, err := uuid.Parse(id); err != nil {
				http.Error(w, "attachment_ids must be UUIDs", http.StatusBadRequest)
				return
			}
		}
		// BUG-002: check the link result before consuming the reservation.
		// A short count means an ID is unknown, belongs to another mailbox,
		// or is already linked elsewhere; fail loud instead of queuing a
		// message whose attachments silently stayed unlinked.
		linkRes, linkErr := tx.Exec(ctx, `UPDATE attachments SET message_id = $1 WHERE id = ANY($2) AND mailbox_id = $3 AND message_id IS NULL`, deliveryID, req.AttachmentIDs, req.MailboxID)
		if linkErr != nil {
			http.Error(w, "failed to link attachments", http.StatusInternalServerError)
			return
		}
		if linkRes.RowsAffected() != int64(len(req.AttachmentIDs)) {
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
	auditLog(ctx, conn, mailboxOrgID, userID, "outbound_send", "outbound_queue", deliveryID, map[string]interface{}{"recipient": req.Recipient})
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(OutboundSendResponse{DeliveryID: deliveryID, Status: "queued"})
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
	sendTokenHash := sha256.Sum256(sendTokenBytes)
	expiresAt := scheduledAt.Add(24 * time.Hour)
	_, err = tx.Exec(ctx, `INSERT INTO scheduled_messages (mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped, send_token_hash, scheduled_at, status, delivery_id, reservation_id, outbox_seq, encryption_version, aad_version, encryption_iv, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $9, $10, $11, $12, $13, $14)`, req.MailboxID, domainID, req.Recipient, encryptedMsg, sendTokenBytes, sendTokenHash[:], scheduledAt, deliveryID, req.ReservationID, req.OutboxSeq, req.EncryptionVersion, req.AADVersion, encIV, expiresAt)
	if err != nil {
		if isUniqueViolation(err) {
			var existing string
			_ = tx.QueryRow(ctx, `SELECT delivery_id::text FROM scheduled_messages WHERE reservation_id=$1`, req.ReservationID).Scan(&existing)
			_ = tx.Commit(ctx)
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(OutboundScheduleResponse{DeliveryID: existing, ScheduledAt: scheduledAt.Format(time.RFC3339), Status: "scheduled"})
			return
		}
		http.Error(w, "failed to schedule message", http.StatusInternalServerError)
		return
	}
	// BUG-003: propagate attachment IDs on the schedule path, mirroring the
	// send handler. Uses the same delivery_id-as-message_id convention (see
	// note above) so scheduled messages list attachments consistently.
	if len(req.AttachmentIDs) > 0 {
		for _, id := range req.AttachmentIDs {
			if _, err := uuid.Parse(id); err != nil {
				http.Error(w, "attachment_ids must be UUIDs", http.StatusBadRequest)
				return
			}
		}
		// BUG-002: same strict link check as the send handler (see above).
		linkRes, linkErr := tx.Exec(ctx, `UPDATE attachments SET message_id = $1 WHERE id = ANY($2) AND mailbox_id = $3 AND message_id IS NULL`, deliveryID, req.AttachmentIDs, req.MailboxID)
		if linkErr != nil {
			http.Error(w, "failed to link attachments", http.StatusInternalServerError)
			return
		}
		if linkRes.RowsAffected() != int64(len(req.AttachmentIDs)) {
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
	auditLog(ctx, conn, mailboxOrgID, userID, "outbound_schedule", "scheduled_messages", deliveryID, map[string]interface{}{"recipient": req.Recipient})
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(OutboundScheduleResponse{DeliveryID: deliveryID, ScheduledAt: scheduledAt.Format(time.RFC3339), Status: "scheduled"})
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
