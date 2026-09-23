package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type keyErrorResponse struct {
	Error   string `json:"error"`
	Message string `json:"message,omitempty"`
}

func writeKeyError(w http.ResponseWriter, statusCode int, errorCode, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(statusCode)
	_ = json.NewEncoder(w).Encode(keyErrorResponse{
		Error:   errorCode,
		Message: message,
	})
}

// keyLookupHandler handles GET /v1/keys/{email}
func keyLookupHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		writeKeyError(w, http.StatusUnauthorized, "unauthorized", "unauthorized")
		return
	}

	if !allowPerUser(userID) {
		w.Header().Set("Retry-After", "60")
		writeKeyError(w, http.StatusTooManyRequests, "rate_limited", "rate limit exceeded")
		return
	}

	email := r.PathValue("email")
	parts := strings.Split(email, "@")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		writeKeyError(w, http.StatusBadRequest, "invalid_request", "invalid email address format")
		return
	}

	localPart := strings.ToLower(parts[0])
	domain := strings.ToLower(parts[1])
	normalizedEmail := localPart + "@" + domain

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	ctx := r.Context()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		writeKeyError(w, http.StatusInternalServerError, "internal_error", "database connection failed")
		return
	}
	defer conn.Close(ctx)

	var (
		mailboxID        string
		keyEpoch         int
		mailboxXwingPK   []byte
		mailboxEd25519PK []byte
		signingKeyEpoch  int
		keyStatus        string
		updatedAt        time.Time
	)

	err = conn.QueryRow(ctx, `
		SELECT m.id::text, m.key_epoch, m.mailbox_xwing_pk, m.mailbox_ed25519_pk,
		       m.signing_key_epoch, m.key_status, m.updated_at
		FROM mailboxes m
		JOIN domains d ON d.id = m.domain_id
		WHERE lower(m.local_part) = $1 AND lower(d.name) = $2
		LIMIT 1
	`, localPart, domain).Scan(&mailboxID, &keyEpoch, &mailboxXwingPK, &mailboxEd25519PK, &signingKeyEpoch, &keyStatus, &updatedAt)

	if err != nil {
		if err == pgx.ErrNoRows {
			writeKeyError(w, http.StatusNotFound, "unknown_mailbox", "unknown mailbox")
			return
		}
		writeKeyError(w, http.StatusInternalServerError, "internal_error", "failed to query mailbox")
		return
	}

	if keyStatus == "disabled" {
		writeKeyError(w, http.StatusGone, "mailbox_disabled", "mailbox is disabled")
		return
	}
	if keyStatus == "unlisted" {
		writeKeyError(w, http.StatusNotFound, "unknown_mailbox", "unknown mailbox")
		return
	}
	if len(mailboxXwingPK) == 0 {
		writeKeyError(w, http.StatusNotFound, "no_public_key", "mailbox has no public key")
		return
	}
	if len(mailboxEd25519PK) == 0 {
		writeKeyError(w, http.StatusNotFound, "no_signing_key", "mailbox has no signing key")
		return
	}

	etag := fmt.Sprintf(`"%s:%d:%d"`, mailboxID, keyEpoch, signingKeyEpoch)
	w.Header().Set("Cache-Control", "private, max-age=300")
	w.Header().Set("ETag", etag)

	if match := r.Header.Get("If-None-Match"); match != "" {
		if match == etag || match == strings.Trim(etag, `"`) {
			w.WriteHeader(http.StatusNotModified)
			return
		}
	}

	resp := struct {
		EmailAddress            string `json:"email_address"`
		KeyID                   string `json:"key_id"`
		KeyEpoch                int    `json:"key_epoch"`
		XWingPublicKey          string `json:"xwing_public_key"`
		Ed25519SigningPublicKey string `json:"ed25519_signing_public_key"`
		SigningKeyEpoch         int    `json:"signing_key_epoch"`
		Status                  string `json:"status"`
		UpdatedAt               string `json:"updated_at"`
	}{
		EmailAddress:            normalizedEmail,
		KeyID:                   mailboxID,
		KeyEpoch:                keyEpoch,
		XWingPublicKey:          base64.StdEncoding.EncodeToString(mailboxXwingPK),
		Ed25519SigningPublicKey: base64.StdEncoding.EncodeToString(mailboxEd25519PK),
		SigningKeyEpoch:         signingKeyEpoch,
		Status:                  keyStatus,
		UpdatedAt:               updatedAt.UTC().Format(time.RFC3339),
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(resp)
}

// keyHistoryHandler handles GET /v1/keys/{email}/history
func keyHistoryHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		writeKeyError(w, http.StatusUnauthorized, "unauthorized", "unauthorized")
		return
	}

	if !allowPerUser(userID) {
		w.Header().Set("Retry-After", "60")
		writeKeyError(w, http.StatusTooManyRequests, "rate_limited", "rate limit exceeded")
		return
	}

	email := r.PathValue("email")
	parts := strings.Split(email, "@")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		writeKeyError(w, http.StatusBadRequest, "invalid_request", "invalid email address format")
		return
	}

	localPart := strings.ToLower(parts[0])
	domain := strings.ToLower(parts[1])

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	ctx := r.Context()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		writeKeyError(w, http.StatusInternalServerError, "internal_error", "database connection failed")
		return
	}
	defer conn.Close(ctx)

	var (
		mailboxID        string
		keyEpoch         int
		mailboxXwingPK   []byte
		mailboxEd25519PK []byte
		signingKeyEpoch  int
		keyStatus        string
		updatedAt        time.Time
	)

	err = conn.QueryRow(ctx, `
		SELECT m.id::text, m.key_epoch, m.mailbox_xwing_pk, m.mailbox_ed25519_pk,
		       m.signing_key_epoch, m.key_status, m.updated_at
		FROM mailboxes m
		JOIN domains d ON d.id = m.domain_id
		WHERE lower(m.local_part) = $1 AND lower(d.name) = $2
		LIMIT 1
	`, localPart, domain).Scan(&mailboxID, &keyEpoch, &mailboxXwingPK, &mailboxEd25519PK, &signingKeyEpoch, &keyStatus, &updatedAt)

	if err != nil {
		if err == pgx.ErrNoRows {
			writeKeyError(w, http.StatusNotFound, "unknown_mailbox", "unknown mailbox")
			return
		}
		writeKeyError(w, http.StatusInternalServerError, "internal_error", "failed to query mailbox")
		return
	}

	if keyStatus == "disabled" {
		writeKeyError(w, http.StatusGone, "mailbox_disabled", "mailbox is disabled")
		return
	}
	if keyStatus == "unlisted" {
		writeKeyError(w, http.StatusNotFound, "unknown_mailbox", "unknown mailbox")
		return
	}
	if len(mailboxXwingPK) == 0 {
		writeKeyError(w, http.StatusNotFound, "no_public_key", "mailbox has no public key")
		return
	}
	if len(mailboxEd25519PK) == 0 {
		writeKeyError(w, http.StatusNotFound, "no_signing_key", "mailbox has no signing key")
		return
	}

	etag := fmt.Sprintf(`"%s:%d:%d"`, mailboxID, keyEpoch, signingKeyEpoch)
	w.Header().Set("Cache-Control", "private, max-age=300")
	w.Header().Set("ETag", etag)

	if match := r.Header.Get("If-None-Match"); match != "" {
		if match == etag || match == strings.Trim(etag, `"`) {
			w.WriteHeader(http.StatusNotModified)
			return
		}
	}

	type keyHistoryEntry struct {
		KeyEpoch                int     `json:"key_epoch"`
		XWingPublicKey          string  `json:"xwing_public_key"`
		Ed25519SigningPublicKey string  `json:"ed25519_signing_public_key"`
		SigningKeyEpoch         int     `json:"signing_key_epoch"`
		ValidFrom               string  `json:"valid_from"`
		RotatedAt               *string `json:"rotated_at"`
	}

	// Note: V1 does not track historical epochs in a separate table; V1.5 will add real rotation history.
	resp := struct {
		KeyID   string            `json:"key_id"`
		History []keyHistoryEntry `json:"history"`
	}{
		KeyID: mailboxID,
		History: []keyHistoryEntry{
			{
				KeyEpoch:                keyEpoch,
				XWingPublicKey:          base64.StdEncoding.EncodeToString(mailboxXwingPK),
				Ed25519SigningPublicKey: base64.StdEncoding.EncodeToString(mailboxEd25519PK),
				SigningKeyEpoch:         signingKeyEpoch,
				ValidFrom:               updatedAt.UTC().Format(time.RFC3339),
				RotatedAt:               nil,
			},
		},
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(resp)
}

// keyPublishHandler handles PUT /v1/keys/me
func keyPublishHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		writeKeyError(w, http.StatusUnauthorized, "unauthorized", "unauthorized")
		return
	}

	if !allowPerUser(userID) {
		w.Header().Set("Retry-After", "60")
		writeKeyError(w, http.StatusTooManyRequests, "rate_limited", "rate limit exceeded")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var req struct {
		XWingPublicKey          string `json:"xwing_public_key"`
		Ed25519SigningPublicKey string `json:"ed25519_signing_public_key"`
		KeyEpoch                *int   `json:"key_epoch,omitempty"`
		SigningKeyEpoch         *int   `json:"signing_key_epoch,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeKeyError(w, http.StatusBadRequest, "invalid_request", "invalid JSON request body")
		return
	}

	xwingBytes, err := base64.StdEncoding.DecodeString(req.XWingPublicKey)
	if err != nil {
		writeKeyError(w, http.StatusBadRequest, "invalid_key", "invalid base64 for xwing_public_key")
		return
	}

	ed25519Bytes, err := base64.StdEncoding.DecodeString(req.Ed25519SigningPublicKey)
	if err != nil {
		writeKeyError(w, http.StatusBadRequest, "invalid_key", "invalid base64 for ed25519_signing_public_key")
		return
	}

	if len(xwingBytes) != 1216 {
		writeKeyError(w, http.StatusBadRequest, "invalid_key", "xwing_public_key must be exactly 1216 bytes")
		return
	}
	if len(ed25519Bytes) != 32 {
		writeKeyError(w, http.StatusBadRequest, "invalid_key", "ed25519_signing_public_key must be exactly 32 bytes")
		return
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	ctx := r.Context()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		writeKeyError(w, http.StatusInternalServerError, "internal_error", "database connection failed")
		return
	}
	defer conn.Close(ctx)

	var (
		mailboxID              string
		currentXwingPK         []byte
		currentEd25519PK       []byte
		currentKeyEpoch        int
		currentSigningKeyEpoch int
	)

	err = conn.QueryRow(ctx, `
		SELECT id::text, mailbox_xwing_pk, mailbox_ed25519_pk, key_epoch, signing_key_epoch
		FROM mailboxes
		WHERE user_id = $1 AND is_active = true
		ORDER BY created_at ASC
		LIMIT 1
	`, userID).Scan(&mailboxID, &currentXwingPK, &currentEd25519PK, &currentKeyEpoch, &currentSigningKeyEpoch)

	if err != nil {
		if err == pgx.ErrNoRows {
			err = conn.QueryRow(ctx, `
				SELECT id::text, mailbox_xwing_pk, mailbox_ed25519_pk, key_epoch, signing_key_epoch
				FROM mailboxes
				WHERE user_id = $1
				ORDER BY created_at ASC
				LIMIT 1
			`, userID).Scan(&mailboxID, &currentXwingPK, &currentEd25519PK, &currentKeyEpoch, &currentSigningKeyEpoch)
		}
		if err != nil {
			writeKeyError(w, http.StatusNotFound, "unknown_mailbox", "no mailbox found for user")
			return
		}
	}

	isFirstPublish := (len(currentXwingPK) == 0 && len(currentEd25519PK) == 0)
	var newKeyEpoch, newSigningKeyEpoch int

	if isFirstPublish {
		newKeyEpoch = 1
		newSigningKeyEpoch = 1
		if req.KeyEpoch != nil {
			if *req.KeyEpoch < 1 {
				writeKeyError(w, http.StatusBadRequest, "invalid_epoch", "key_epoch must be >= 1")
				return
			}
			newKeyEpoch = *req.KeyEpoch
		}
		if req.SigningKeyEpoch != nil {
			if *req.SigningKeyEpoch < 1 {
				writeKeyError(w, http.StatusBadRequest, "invalid_epoch", "signing_key_epoch must be >= 1")
				return
			}
			newSigningKeyEpoch = *req.SigningKeyEpoch
		}
	} else {
		if req.KeyEpoch != nil && *req.KeyEpoch <= currentKeyEpoch {
			writeKeyError(w, http.StatusConflict, "stale_epoch", "key_epoch must be greater than current key_epoch")
			return
		}
		if req.SigningKeyEpoch != nil && *req.SigningKeyEpoch <= currentSigningKeyEpoch {
			writeKeyError(w, http.StatusConflict, "stale_epoch", "signing_key_epoch must be greater than current signing_key_epoch")
			return
		}
		if req.KeyEpoch != nil {
			newKeyEpoch = *req.KeyEpoch
		} else {
			newKeyEpoch = currentKeyEpoch + 1
		}
		if req.SigningKeyEpoch != nil {
			newSigningKeyEpoch = *req.SigningKeyEpoch
		} else {
			newSigningKeyEpoch = currentSigningKeyEpoch + 1
		}
	}

	_, err = conn.Exec(ctx, `
		UPDATE mailboxes
		SET mailbox_xwing_pk = $1,
		    mailbox_ed25519_pk = $2,
		    key_epoch = $3,
		    signing_key_epoch = $4,
		    updated_at = now()
		WHERE id = $5
	`, xwingBytes, ed25519Bytes, newKeyEpoch, newSigningKeyEpoch, mailboxID)
	if err != nil {
		writeKeyError(w, http.StatusInternalServerError, "internal_error", "failed to update mailbox keys")
		return
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status":            "ok",
		"key_epoch":         newKeyEpoch,
		"signing_key_epoch": newSigningKeyEpoch,
	})
}
