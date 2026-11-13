package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const (
	MaxOutboundPathBPlaintextBytes int64 = 25 * 1024 * 1024 // 25 MiB aggregate plaintext limit for Path B SMTP
	MaxOutboundAttachmentCount           = 100
	AttachmentCryptoVersionV2            = 2
	AttachmentWrapAlgX25519              = "HPKE-X25519-AES256GCM-v1"
)

type OutboundAttachmentGrantInput struct {
	AttachmentID       string `json:"attachment_id"`
	Position           int    `json:"position"`
	Disposition        string `json:"disposition,omitempty"`
	ContentID          string `json:"content_id,omitempty"`
	WrapAlg            string `json:"wrap_alg"`
	OutboundKeyID      string `json:"outbound_key_id"`
	OutboundKeyEpoch   int    `json:"outbound_key_epoch"`
	CekOutboundWrapped string `json:"cek_outbound_wrapped"`
	MetadataSHA256     string `json:"metadata_sha256"`
}

type OutboundKeyRecord struct {
	KeyEpoch   int    `json:"key_epoch"`
	KeyID      string `json:"key_id"`
	PublicKeyB64 string `json:"pk_b64"`
	Status     string `json:"status"`
	ValidUntil string `json:"valid_until,omitempty"`
}

type OutboundPKRing struct {
	MinAcceptedEpoch int                 `json:"min_accepted_epoch"`
	Keys             []OutboundKeyRecord `json:"keys"`
}

type OutboundPubkeyDetailResponse struct {
	OutboundDeliveryPK string `json:"outbound_delivery_pk"`
	KeyID              string `json:"key_id"`
	KeyEpoch           int    `json:"key_epoch"`
	Algorithm          string `json:"algorithm"`
	ValidUntil         string `json:"valid_until,omitempty"`
	MinAcceptedEpoch   int    `json:"min_accepted_epoch"`
}

func computeOutboundKeyIDHex(pk32 []byte) (string, error) {
	if len(pk32) != 32 {
		return "", fmt.Errorf("outbound public key must be 32 bytes, got %d", len(pk32))
	}
	h := sha256.New()
	h.Write([]byte("byos-outbound-pk-v1"))
	h.Write(pk32)
	sum := h.Sum(nil)
	return hex.EncodeToString(sum[:8]), nil
}

func canonicalMimeType(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "application/octet-stream"
	}
	mediaType, _, err := mime.ParseMediaType(trimmed)
	if err != nil || strings.TrimSpace(mediaType) == "" {
		return "application/octet-stream"
	}
	return strings.ToLower(strings.TrimSpace(mediaType))
}

func canonicalAttachmentMetadataSHA256(
	sanitizedFilenameUTF8 string,
	mimeTypeASCII string,
	plaintextSizeBytes int64,
	plaintextSHA256 []byte,
	disposition string,
	contentIDUTF8 string,
) []byte {
	var dispTag byte = 0x01
	if disposition == "inline" {
		dispTag = 0x02
	}
	h := sha256.New()
	h.Write([]byte("byos-att-meta-v2"))
	var lenBuf [8]byte
	binary.BigEndian.PutUint32(lenBuf[:4], uint32(len(sanitizedFilenameUTF8)))
	h.Write(lenBuf[:4])
	h.Write([]byte(sanitizedFilenameUTF8))
	binary.BigEndian.PutUint32(lenBuf[:4], uint32(len(mimeTypeASCII)))
	h.Write(lenBuf[:4])
	h.Write([]byte(mimeTypeASCII))
	binary.BigEndian.PutUint64(lenBuf[:8], uint64(plaintextSizeBytes))
	h.Write(lenBuf[:8])
	h.Write(plaintextSHA256)
	h.Write([]byte{dispTag})
	binary.BigEndian.PutUint32(lenBuf[:4], uint32(len(contentIDUTF8)))
	h.Write(lenBuf[:4])
	h.Write([]byte(contentIDUTF8))
	return h.Sum(nil)
}

func hasAttachmentV2Schema(ctx context.Context, conn *pgx.Conn) bool {
	var exists bool
	err := conn.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM information_schema.columns
			WHERE table_schema = 'public'
			  AND table_name = 'attachments'
			  AND column_name = 'crypto_version'
		)
	`).Scan(&exists)
	return err == nil && exists
}

func hasOutboundDeliveryAttachmentsTable(ctx context.Context, conn *pgx.Conn) bool {
	var exists bool
	err := conn.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM information_schema.tables
			WHERE table_schema = 'public'
			  AND table_name = 'outbound_delivery_attachments'
		)
	`).Scan(&exists)
	return err == nil && exists
}

type queryRower interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func hasPublicTable(ctx context.Context, q queryRower, tableName string) bool {
	if q == nil {
		return false
	}
	var exists bool
	err := q.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM information_schema.tables
			WHERE table_schema = 'public'
			  AND table_name = $1
		)
	`, tableName).Scan(&exists)
	return err == nil && exists
}

func loadActiveOutboundKeyInfo(ctx context.Context, conn *pgx.Conn) (OutboundPubkeyDetailResponse, map[int]OutboundKeyRecord, error) {
	byEpoch := make(map[int]OutboundKeyRecord)
	minAccepted := 1
	var active OutboundPubkeyDetailResponse

	// 1. Check PK ring file if configured.
	ringPath := strings.TrimSpace(os.Getenv("OUTBOUND_DELIVERY_PK_RING_FILE"))
	if ringPath == "" {
		if _, err := os.Stat("/run/secrets/outbound_delivery_pk_ring.json"); err == nil {
			ringPath = "/run/secrets/outbound_delivery_pk_ring.json"
		}
	}
	if ringPath != "" {
		if raw, err := os.ReadFile(ringPath); err == nil {
			var ring OutboundPKRing
			if json.Unmarshal(raw, &ring) == nil && len(ring.Keys) > 0 {
				if ring.MinAcceptedEpoch >= 1 {
					minAccepted = ring.MinAcceptedEpoch
				}
				for _, k := range ring.Keys {
					pkBytes, err := base64.StdEncoding.DecodeString(strings.TrimSpace(k.PublicKeyB64))
					if err != nil || len(pkBytes) != 32 {
						continue
					}
					computedID, err := computeOutboundKeyIDHex(pkBytes)
					if err != nil {
						continue
					}
					if k.KeyID != "" && k.KeyID != computedID {
						continue
					}
					k.KeyID = computedID
					byEpoch[k.KeyEpoch] = k
					if k.Status == "active" {
						active = OutboundPubkeyDetailResponse{
							OutboundDeliveryPK: strings.TrimSpace(k.PublicKeyB64),
							KeyID:              k.KeyID,
							KeyEpoch:           k.KeyEpoch,
							Algorithm:          AttachmentWrapAlgX25519,
							ValidUntil:         k.ValidUntil,
							MinAcceptedEpoch:   minAccepted,
						}
					}
				}
			}
		}
	}

	// 2. Check outbound_delivery_keys table in PostgreSQL when available.
	if conn != nil {
		var tblExists bool
		_ = conn.QueryRow(ctx, `
			SELECT EXISTS (
				SELECT 1 FROM information_schema.tables
				WHERE table_schema = 'public' AND table_name = 'outbound_delivery_keys'
			)
		`).Scan(&tblExists)
		if tblExists {
			rows, err := conn.Query(ctx, `
				SELECT key_epoch, key_id, public_key, status, COALESCE(to_char(valid_until AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), '')
				FROM outbound_delivery_keys
				WHERE status IN ('active', 'decrypt_only')
				ORDER BY key_epoch DESC
			`)
			if err == nil {
				defer rows.Close()
				for rows.Next() {
					var epoch int
					var keyID, status, validUntil string
					var pkRaw []byte
					if scanErr := rows.Scan(&epoch, &keyID, &pkRaw, &status, &validUntil); scanErr == nil && len(pkRaw) == 32 {
						computedID, idErr := computeOutboundKeyIDHex(pkRaw)
						if idErr != nil || computedID != keyID {
							continue
						}
						rec := OutboundKeyRecord{
							KeyEpoch:     epoch,
							KeyID:        keyID,
							PublicKeyB64: base64.StdEncoding.EncodeToString(pkRaw),
							Status:       status,
							ValidUntil:   validUntil,
						}
						byEpoch[epoch] = rec
						if status == "active" {
							active = OutboundPubkeyDetailResponse{
								OutboundDeliveryPK: rec.PublicKeyB64,
								KeyID:              rec.KeyID,
								KeyEpoch:           rec.KeyEpoch,
								Algorithm:          AttachmentWrapAlgX25519,
								ValidUntil:         rec.ValidUntil,
								MinAcceptedEpoch:   minAccepted,
							}
						}
					}
				}
			}
		}
	}

	// 3. Fallback to legacy single static key (epoch 1)
	if active.OutboundDeliveryPK == "" {
		pk := getOutboundDeliveryPK()
		if pk == "" {
			return OutboundPubkeyDetailResponse{}, nil, errors.New("outbound delivery public key not configured")
		}
		pkBytes, err := base64.StdEncoding.DecodeString(pk)
		if err != nil || len(pkBytes) != 32 {
			return OutboundPubkeyDetailResponse{}, nil, errors.New("outbound delivery public key invalid")
		}
		keyID, err := computeOutboundKeyIDHex(pkBytes)
		if err != nil {
			return OutboundPubkeyDetailResponse{}, nil, err
		}
		rec := OutboundKeyRecord{
			KeyEpoch:     1,
			KeyID:        keyID,
			PublicKeyB64: pk,
			Status:       "active",
		}
		byEpoch[1] = rec
		active = OutboundPubkeyDetailResponse{
			OutboundDeliveryPK: pk,
			KeyID:              keyID,
			KeyEpoch:           1,
			Algorithm:          AttachmentWrapAlgX25519,
			MinAcceptedEpoch:   minAccepted,
		}
	}

	if active.MinAcceptedEpoch < 1 {
		active.MinAcceptedEpoch = 1
	}
	return active, byEpoch, nil
}

func validateAndPersistOutboundAttachmentsTx(
	ctx context.Context,
	tx pgx.Tx,
	conn *pgx.Conn,
	mailboxID string,
	deliveryID string,
	outboxSeq int64,
	grants []OutboundAttachmentGrantInput,
	legacyAttachmentIDs []string,
) (int, int, string, int, []byte, error) {
	activeKey, byEpoch, keyErr := loadActiveOutboundKeyInfo(ctx, conn)
	if keyErr != nil {
		// If no attachments and key isn't even needed for validation, tolerate missing key unless grants specify epoch
		activeKey = OutboundPubkeyDetailResponse{KeyEpoch: 1}
	}

	if len(grants) == 0 && len(legacyAttachmentIDs) == 0 {
		return 0, activeKey.KeyEpoch, activeKey.KeyID, 0, nil, nil
	}

	if len(grants) > MaxOutboundAttachmentCount || len(legacyAttachmentIDs) > MaxOutboundAttachmentCount {
		body, _ := json.Marshal(map[string]interface{}{
			"error": "too_many_attachments",
			"max":   MaxOutboundAttachmentCount,
		})
		return 0, 0, "", http.StatusBadRequest, body, errors.New("too many attachments")
	}

	// Enforce v2 upgrade when caller sent legacy attachment_ids without v2 grants.
	if len(grants) == 0 && len(legacyAttachmentIDs) > 0 {
		uniqueIDs := make([]string, 0, len(legacyAttachmentIDs))
		seen := make(map[string]bool)
		for _, id := range legacyAttachmentIDs {
			parsed, err := uuid.Parse(strings.TrimSpace(id))
			if err != nil {
				return 0, 0, "", http.StatusBadRequest, []byte("attachment_ids must be UUIDs"), err
			}
			c := parsed.String()
			if !seen[c] {
				seen[c] = true
				uniqueIDs = append(uniqueIDs, c)
			}
		}

		v1IDs := []string{}
		v2IDs := []string{}
		rows, err := tx.Query(ctx, `
			SELECT id::text, crypto_version
			FROM attachments
			WHERE id = ANY($1) AND mailbox_id = $2 AND message_id IS NULL
		`, uniqueIDs, mailboxID)
		if err != nil {
			return 0, 0, "", http.StatusInternalServerError, []byte("failed to inspect attachments"), err
		}
		foundCount := 0
		for rows.Next() {
			var id string
			var cv int
			if scanErr := rows.Scan(&id, &cv); scanErr == nil {
				foundCount++
				if cv == 1 {
					v1IDs = append(v1IDs, id)
				} else {
					v2IDs = append(v2IDs, id)
				}
			}
		}
		rows.Close()
		if foundCount != len(uniqueIDs) {
			return 0, 0, "", http.StatusBadRequest, []byte("attachment not found, already linked, or not in this mailbox"), errors.New("attachment missing")
		}
		if len(v1IDs) > 0 {
			body, _ := json.Marshal(map[string]interface{}{
				"error":          "attachment_v2_upgrade_required",
				"attachment_ids": v1IDs,
			})
			return 0, 0, "", http.StatusUnprocessableEntity, body, errors.New("attachment v2 upgrade required")
		}
		body, _ := json.Marshal(map[string]interface{}{
			"error":          "attachment_outbound_grants_required",
			"attachment_ids": v2IDs,
		})
		return 0, 0, "", http.StatusUnprocessableEntity, body, errors.New("outbound attachment grants required")
	}

	if keyErr != nil {
		return 0, 0, "", http.StatusServiceUnavailable, []byte("outbound delivery public key unavailable"), keyErr
	}

	// Validate grant list structure, unique IDs, contiguous positions 0..N-1, and epoch acceptance.
	seenAtt := make(map[string]bool, len(grants))
	seenPos := make(map[int]bool, len(grants))
	attIDs := make([]string, 0, len(grants))
	for _, g := range grants {
		parsedID, err := uuid.Parse(strings.TrimSpace(g.AttachmentID))
		if err != nil {
			return 0, 0, "", http.StatusBadRequest, []byte("invalid attachment_id UUID"), err
		}
		canonicalID := parsedID.String()
		if seenAtt[canonicalID] {
			return 0, 0, "", http.StatusBadRequest, []byte("duplicate attachment_id in attachments"), errors.New("duplicate attachment_id")
		}
		seenAtt[canonicalID] = true
		if g.Position < 0 || g.Position >= len(grants) || seenPos[g.Position] {
			return 0, 0, "", http.StatusBadRequest, []byte("attachment positions must be unique 0..N-1"), errors.New("invalid position")
		}
		seenPos[g.Position] = true
		disp := strings.TrimSpace(g.Disposition)
		if disp == "" {
			disp = "attachment"
		}
		if disp != "attachment" && disp != "inline" {
			return 0, 0, "", http.StatusBadRequest, []byte("invalid attachment disposition"), errors.New("invalid disposition")
		}
		if disp == "inline" {
			cid := strings.TrimSpace(g.ContentID)
			if cid == "" || strings.ContainsAny(cid, "\r\n\x00<>\"'") {
				return 0, 0, "", http.StatusBadRequest, []byte("invalid inline content_id"), errors.New("invalid content_id")
			}
		} else if strings.TrimSpace(g.ContentID) != "" {
			return 0, 0, "", http.StatusBadRequest, []byte("content_id only permitted for inline attachments"), errors.New("unexpected content_id")
		}
		if g.WrapAlg != AttachmentWrapAlgX25519 {
			return 0, 0, "", http.StatusBadRequest, []byte("unsupported wrap_alg"), errors.New("unsupported wrap_alg")
		}
		if g.OutboundKeyEpoch < activeKey.MinAcceptedEpoch {
			body, _ := json.Marshal(map[string]interface{}{
				"error":              "outbound_key_epoch_expired",
				"min_accepted_epoch": activeKey.MinAcceptedEpoch,
				"current_key":        activeKey,
			})
			return 0, 0, "", http.StatusConflict, body, errors.New("outbound key epoch expired")
		}
		rec, ok := byEpoch[g.OutboundKeyEpoch]
		if !ok || rec.KeyID != strings.TrimSpace(g.OutboundKeyID) || rec.Status == "pending" || rec.Status == "retired" {
			body, _ := json.Marshal(map[string]interface{}{
				"error":              "outbound_key_epoch_expired",
				"min_accepted_epoch": activeKey.MinAcceptedEpoch,
				"current_key":        activeKey,
			})
			return 0, 0, "", http.StatusConflict, body, errors.New("unknown or retired outbound key epoch")
		}
		attIDs = append(attIDs, canonicalID)
	}

	// Fetch and lock attachment rows inside the transaction, verifying ownership, v2 invariants,
	// aggregate plaintext size <= 25 MiB, and metadata_sha256.
	type attRow struct {
		ID              string
		Filename        string
		ContentType     string
		SizeBytes       int64
		CryptoVersion   int
		PlaintextSHA256 []byte
		UploadState     string
	}
	rows, err := tx.Query(ctx, `
		SELECT id::text, filename, content_type, size_bytes, crypto_version, plaintext_sha256, upload_state
		FROM attachments
		WHERE id = ANY($1) AND mailbox_id = $2 AND message_id IS NULL
		FOR UPDATE
	`, attIDs, mailboxID)
	if err != nil {
		return 0, 0, "", http.StatusInternalServerError, []byte("failed to load attachments"), err
	}
	attMap := make(map[string]attRow, len(attIDs))
	var aggregatePlaintext int64
	v1NeedingUpgrade := []string{}
	for rows.Next() {
		var r attRow
		if scanErr := rows.Scan(&r.ID, &r.Filename, &r.ContentType, &r.SizeBytes, &r.CryptoVersion, &r.PlaintextSHA256, &r.UploadState); scanErr != nil {
			rows.Close()
			return 0, 0, "", http.StatusInternalServerError, []byte("failed to scan attachment"), scanErr
		}
		if r.UploadState != "committed" {
			rows.Close()
			return 0, 0, "", http.StatusBadRequest, []byte("attachment upload not committed"), errors.New("attachment not committed")
		}
		if r.CryptoVersion != AttachmentCryptoVersionV2 {
			v1NeedingUpgrade = append(v1NeedingUpgrade, r.ID)
		}
		aggregatePlaintext += r.SizeBytes
		attMap[r.ID] = r
	}
	rows.Close()

	if len(attMap) != len(attIDs) {
		return 0, 0, "", http.StatusBadRequest, []byte("attachment not found, already linked, or not in this mailbox"), errors.New("attachment missing")
	}
	if len(v1NeedingUpgrade) > 0 {
		body, _ := json.Marshal(map[string]interface{}{
			"error":          "attachment_v2_upgrade_required",
			"attachment_ids": v1NeedingUpgrade,
		})
		return 0, 0, "", http.StatusUnprocessableEntity, body, errors.New("attachment v2 upgrade required")
	}
	if aggregatePlaintext > MaxOutboundPathBPlaintextBytes {
		body, _ := json.Marshal(map[string]interface{}{
			"error":           "outbound_attachment_limit_exceeded",
			"max_bytes":       MaxOutboundPathBPlaintextBytes,
			"aggregate_bytes": aggregatePlaintext,
		})
		return 0, 0, "", http.StatusRequestEntityTooLarge, body, errors.New("outbound attachment limit exceeded")
	}

	// Verify grant cryptographic envelopes and persist outbound_delivery_attachments.
	for _, g := range grants {
		cid := uuid.MustParse(strings.TrimSpace(g.AttachmentID)).String()
		row := attMap[cid]
		disp := strings.TrimSpace(g.Disposition)
		if disp == "" {
			disp = "attachment"
		}
		contentID := strings.TrimSpace(g.ContentID)

		wrappedBytes, err := base64.StdEncoding.DecodeString(strings.TrimSpace(g.CekOutboundWrapped))
		if err != nil || len(wrappedBytes) != 81 || wrappedBytes[0] != 0x01 {
			return 0, 0, "", http.StatusBadRequest, []byte("cek_outbound_wrapped must be 81-byte canonical HPKE envelope"), errors.New("invalid cek_outbound_wrapped")
		}

		metaHex := strings.TrimSpace(g.MetadataSHA256)
		metaBytes, err := hex.DecodeString(metaHex)
		if err != nil || len(metaBytes) != 32 {
			metaBytes, err = base64.StdEncoding.DecodeString(metaHex)
			if err != nil || len(metaBytes) != 32 {
				return 0, 0, "", http.StatusBadRequest, []byte("metadata_sha256 must be 32 bytes"), errors.New("invalid metadata_sha256")
			}
		}

		expectedMeta := canonicalAttachmentMetadataSHA256(
			sanitizeFilename(row.Filename),
			canonicalMimeType(row.ContentType),
			row.SizeBytes,
			row.PlaintextSHA256,
			disp,
			contentID,
		)
		if subtle.ConstantTimeCompare(metaBytes, expectedMeta) != 1 {
			body, _ := json.Marshal(map[string]interface{}{
				"error":         "metadata_sha256_mismatch",
				"attachment_id": cid,
			})
			return 0, 0, "", http.StatusBadRequest, body, errors.New("metadata_sha256 mismatch")
		}

		var cidPtr *string
		if contentID != "" {
			cidPtr = &contentID
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO outbound_delivery_attachments (
				delivery_id, mailbox_id, attachment_id, outbox_seq,
				position, disposition, content_id, wrap_alg,
				outbound_key_id, outbound_key_epoch, cek_outbound_wrapped, metadata_sha256
			) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		`, deliveryID, mailboxID, cid, outboxSeq,
			g.Position, disp, cidPtr, g.WrapAlg,
			strings.TrimSpace(g.OutboundKeyID), g.OutboundKeyEpoch, wrappedBytes, metaBytes)
		if err != nil {
			return 0, 0, "", http.StatusInternalServerError, []byte("failed to store outbound attachment grant"), err
		}
	}

	linkRes, linkErr := tx.Exec(ctx, `
		UPDATE attachments
		SET message_id = $1
		WHERE id = ANY($2) AND mailbox_id = $3 AND message_id IS NULL
	`, deliveryID, attIDs, mailboxID)
	if linkErr != nil {
		return 0, 0, "", http.StatusInternalServerError, []byte("failed to link attachments"), linkErr
	}
	if linkRes.RowsAffected() != int64(len(attIDs)) {
		return 0, 0, "", http.StatusBadRequest, []byte("attachment not found, already linked, or not in this mailbox"), errors.New("link count mismatch")
	}

	return len(grants), activeKey.KeyEpoch, activeKey.KeyID, 0, nil, nil
}

// =============================================================================
// Internal Lease-Fenced Endpoints for services/outbound-worker
// GET /v1/internal/outbound/{delivery_id}/attachments
// GET /v1/internal/outbound/{delivery_id}/attachments/{attachment_id}/blob
// =============================================================================

func verifyInternalOutboundLease(
	w http.ResponseWriter,
	r *http.Request,
	conn *pgx.Conn,
	ctx context.Context,
	deliveryID string,
) (mailboxID string, outboxSeq int64, attachmentCount int, ok bool) {
	if !verifyInternalServiceAuth(r, "outbound") {
		http.Error(w, "unauthorized internal caller", http.StatusUnauthorized)
		return "", 0, 0, false
	}
	leaseToken := strings.TrimSpace(r.Header.Get("X-Lease-Token"))
	if _, err := uuid.Parse(leaseToken); err != nil {
		http.Error(w, "missing or invalid X-Lease-Token", http.StatusUnauthorized)
		return "", 0, 0, false
	}

	var status string
	var dbLeaseToken *string
	var leaseExpired, queueExpired bool
	err := conn.QueryRow(ctx, `
		SELECT mailbox_id::text, COALESCE(outbox_seq, 0), COALESCE(attachment_count, 0),
		       status, lease_token::text,
		       COALESCE(lease_expires_at <= now(), true),
		       (expires_at <= now())
		FROM outbound_queue
		WHERE delivery_id = $1
	`, deliveryID).Scan(&mailboxID, &outboxSeq, &attachmentCount, &status, &dbLeaseToken, &leaseExpired, &queueExpired)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "outbound delivery not found", http.StatusNotFound)
			return "", 0, 0, false
		}
		http.Error(w, "failed to verify outbound lease", http.StatusInternalServerError)
		return "", 0, 0, false
	}

	if queueExpired {
		http.Error(w, "outbound delivery expired", http.StatusGone)
		return "", 0, 0, false
	}
	if status != "processing" || dbLeaseToken == nil || subtle.ConstantTimeCompare([]byte(*dbLeaseToken), []byte(leaseToken)) != 1 || leaseExpired {
		http.Error(w, "outbound delivery lease not active", http.StatusConflict)
		return "", 0, 0, false
	}

	return mailboxID, outboxSeq, attachmentCount, true
}

func internalOutboundAttachmentsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !verifyInternalServiceAuth(r, "outbound") {
		http.Error(w, "unauthorized internal caller", http.StatusUnauthorized)
		return
	}
	deliveryID := strings.TrimSpace(r.PathValue("delivery_id"))
	if _, err := uuid.Parse(deliveryID); err != nil {
		http.Error(w, "invalid delivery_id UUID", http.StatusBadRequest)
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

	mailboxID, outboxSeq, expectedCount, ok := verifyInternalOutboundLease(w, r, conn, ctx, deliveryID)
	if !ok {
		return
	}

	type manifestItem struct {
		AttachmentID        string `json:"attachment_id"`
		Position            int    `json:"position"`
		Disposition         string `json:"disposition"`
		ContentID           string `json:"content_id"`
		Filename            string `json:"filename"`
		ContentType         string `json:"content_type"`
		CryptoVersion       int    `json:"crypto_version"`
		BlobAADVersion      int    `json:"blob_aad_version"`
		PlaintextSizeBytes  int64  `json:"plaintext_size_bytes"`
		CiphertextSizeBytes int64  `json:"ciphertext_size_bytes"`
		PlaintextSHA256Hex  string `json:"plaintext_sha256_hex"`
		CiphertextSHA256Hex string `json:"ciphertext_sha256_hex"`
		WrapAlg             string `json:"wrap_alg"`
		OutboundKeyID       string `json:"outbound_key_id"`
		OutboundKeyEpoch    int    `json:"outbound_key_epoch"`
		CekOutboundWrapped  string `json:"cek_outbound_wrapped_b64"`
		MetadataSHA256Hex   string `json:"metadata_sha256_hex"`
	}

	rows, err := conn.Query(ctx, `
		SELECT oda.attachment_id::text, oda.position, oda.disposition, COALESCE(oda.content_id, ''),
		       a.filename, a.content_type, a.crypto_version, COALESCE(a.blob_aad_version, 0),
		       a.size_bytes, COALESCE(a.ciphertext_size_bytes, 0),
		       a.plaintext_sha256, a.ciphertext_sha256,
		       oda.wrap_alg, oda.outbound_key_id, oda.outbound_key_epoch,
		       oda.cek_outbound_wrapped, oda.metadata_sha256
		FROM outbound_delivery_attachments oda
		JOIN attachments a ON a.id = oda.attachment_id AND a.mailbox_id = oda.mailbox_id
		WHERE oda.delivery_id = $1 AND oda.mailbox_id = $2 AND oda.outbox_seq = $3 AND a.upload_state = 'committed'
		ORDER BY oda.position ASC
	`, deliveryID, mailboxID, outboxSeq)
	if err != nil {
		http.Error(w, "failed to load attachment manifest", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	items := make([]manifestItem, 0)
	for rows.Next() {
		var m manifestItem
		var ptSHA, ctSHA, cekWrapped, metaSHA []byte
		if scanErr := rows.Scan(
			&m.AttachmentID, &m.Position, &m.Disposition, &m.ContentID,
			&m.Filename, &m.ContentType, &m.CryptoVersion, &m.BlobAADVersion,
			&m.PlaintextSizeBytes, &m.CiphertextSizeBytes,
			&ptSHA, &ctSHA,
			&m.WrapAlg, &m.OutboundKeyID, &m.OutboundKeyEpoch,
			&cekWrapped, &metaSHA,
		); scanErr != nil {
			http.Error(w, "failed to scan attachment manifest", http.StatusInternalServerError)
			return
		}
		if m.CryptoVersion != AttachmentCryptoVersionV2 || len(ptSHA) != 32 || len(ctSHA) != 32 || len(cekWrapped) != 81 || len(metaSHA) != 32 {
			http.Error(w, "attachment does not meet v2 outbound invariants", http.StatusUnprocessableEntity)
			return
		}
		m.PlaintextSHA256Hex = hex.EncodeToString(ptSHA)
		m.CiphertextSHA256Hex = hex.EncodeToString(ctSHA)
		m.CekOutboundWrapped = base64.StdEncoding.EncodeToString(cekWrapped)
		m.MetadataSHA256Hex = hex.EncodeToString(metaSHA)
		items = append(items, m)
	}

	if len(items) != expectedCount {
		http.Error(w, "attachment manifest incomplete for delivery", http.StatusUnprocessableEntity)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"delivery_id":      deliveryID,
		"mailbox_id":       mailboxID,
		"outbox_seq":       outboxSeq,
		"attachment_count": expectedCount,
		"attachments":      items,
	})
}

func internalOutboundAttachmentBlobHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !verifyInternalServiceAuth(r, "outbound") {
		http.Error(w, "unauthorized internal caller", http.StatusUnauthorized)
		return
	}
	deliveryID := strings.TrimSpace(r.PathValue("delivery_id"))
	attachmentID := strings.TrimSpace(r.PathValue("attachment_id"))
	if _, err := uuid.Parse(deliveryID); err != nil {
		http.Error(w, "invalid delivery_id UUID", http.StatusBadRequest)
		return
	}
	if _, err := uuid.Parse(attachmentID); err != nil {
		http.Error(w, "invalid attachment_id UUID", http.StatusBadRequest)
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

	mailboxID, outboxSeq, _, ok := verifyInternalOutboundLease(w, r, conn, ctx, deliveryID)
	if !ok {
		return
	}

	var storageKey string
	var ciphertextSize int64
	var ciphertextSHA []byte
	err = conn.QueryRow(ctx, `
		SELECT a.storage_key, COALESCE(a.ciphertext_size_bytes, 0), a.ciphertext_sha256
		FROM outbound_delivery_attachments oda
		JOIN attachments a ON a.id = oda.attachment_id AND a.mailbox_id = oda.mailbox_id
		WHERE oda.delivery_id = $1
		  AND oda.attachment_id = $2
		  AND oda.mailbox_id = $3
		  AND oda.outbox_seq = $4
		  AND a.crypto_version = 2
		  AND a.upload_state = 'committed'
	`, deliveryID, attachmentID, mailboxID, outboxSeq).Scan(&storageKey, &ciphertextSize, &ciphertextSHA)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "attachment grant not found for active delivery", http.StatusNotFound)
			return
		}
		http.Error(w, "failed to load attachment storage descriptor", http.StatusInternalServerError)
		return
	}
	expectedPrefix := "mailboxes/" + mailboxID + "/"
	if !strings.HasPrefix(storageKey, expectedPrefix) || strings.Contains(storageKey, "..") {
		http.Error(w, "invalid storage key boundary", http.StatusForbidden)
		return
	}

	retPayload, _ := json.Marshal(map[string]string{
		"object_key": storageKey,
		"mailbox_id": mailboxID,
	})
	retReq, err := http.NewRequestWithContext(ctx, http.MethodPost, storageWorkerURL()+"/api/retrieve-stream", bytes.NewReader(retPayload))
	if err != nil {
		http.Error(w, "failed to build storage request", http.StatusInternalServerError)
		return
	}
	retReq.Header.Set("Content-Type", "application/json")
	setStorageInternalAuth(retReq)

	client := &http.Client{Timeout: 180 * time.Second}
	retResp, err := client.Do(retReq)
	if err != nil {
		http.Error(w, "storage-worker unavailable", http.StatusBadGateway)
		return
	}
	defer retResp.Body.Close()

	if retResp.StatusCode == http.StatusNotFound {
		http.Error(w, "attachment ciphertext object missing in storage", http.StatusNotFound)
		return
	}
	if retResp.StatusCode == http.StatusServiceUnavailable {
		http.Error(w, "mailbox storage disconnected", http.StatusServiceUnavailable)
		return
	}
	if retResp.StatusCode != http.StatusOK {
		http.Error(w, "failed to stream ciphertext from storage-worker", http.StatusBadGateway)
		return
	}

	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Cache-Control", "no-store")
	if retResp.ContentLength >= 0 {
		w.Header().Set("Content-Length", fmt.Sprintf("%d", retResp.ContentLength))
	}
	if len(ciphertextSHA) == 32 {
		w.Header().Set("X-Expected-Ciphertext-Sha256", hex.EncodeToString(ciphertextSHA))
	}
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, retResp.Body)
}
