package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const MaxAttachmentSize = 40 * 1024 * 1024 // 40 MB V1 budget

type AttachmentResponse struct {
	ID          string    `json:"id"`
	MailboxID   string    `json:"mailbox_id"`
	MessageID   string    `json:"message_id,omitempty"`
	Filename    string    `json:"filename"`
	ContentType string    `json:"content_type"`
	SizeBytes   int64     `json:"size_bytes"`
	Encrypted   bool      `json:"encrypted"`
	CreatedAt   time.Time `json:"created_at"`
}

func attachmentsHandler(w http.ResponseWriter, r *http.Request) {
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

	attachmentID := r.PathValue("attachment_id")

	switch r.Method {
	case http.MethodGet:
		if attachmentID != "" {
			// Single attachment metadata or download
			var a AttachmentResponse
			var msgID *string
			var storageKey string
			err := conn.QueryRow(ctx, `
				SELECT id::text, mailbox_id::text, message_id, filename, content_type, size_bytes, encrypted, created_at, storage_key
				FROM attachments WHERE id=$1 AND mailbox_id=$2
			`, attachmentID, mailboxID).Scan(&a.ID, &a.MailboxID, &msgID, &a.Filename, &a.ContentType, &a.SizeBytes, &a.Encrypted, &a.CreatedAt, &storageKey)
			if err != nil {
				http.Error(w, "attachment not found", http.StatusNotFound)
				return
			}
			if msgID != nil {
				a.MessageID = *msgID
			}

			if r.URL.Query().Get("download") == "true" {
				retPayload, _ := json.Marshal(map[string]string{
					"object_key": storageKey,
					"mailbox_id": mailboxID,
				})
				retReq, err := http.NewRequestWithContext(ctx, http.MethodPost, storageWorkerURL()+"/api/retrieve", bytes.NewReader(retPayload))
				if err == nil {
					retReq.Header.Set("Content-Type", "application/json")
					setStorageInternalAuth(retReq)
					client := &http.Client{Timeout: 30 * time.Second}
					retResp, err := client.Do(retReq)
					if err == nil {
						defer retResp.Body.Close()
						if retResp.StatusCode == http.StatusOK {
							// Storage-worker Data is a base64 StdEncoding JSON
							// string (see storageRetrieveResponse): decode
							// exactly once to raw bytes, then serve raw.
							// SEC-005: verify the returned bytes against DB
							// metadata instead of serving any non-empty body.
							// A size mismatch indicates misrouting or a
							// storage bug; fail loud rather than serve bytes
							// that do not belong to this attachment.
							rawData, reportedSize, decodeErr := decodeStorageRetrieveBody(retResp.Body)
							if decodeErr == nil && len(rawData) > 0 &&
								int64(len(rawData)) == a.SizeBytes && reportedSize == a.SizeBytes {
								w.Header().Set("Content-Type", a.ContentType)
								w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", a.Filename))
								w.Write(rawData)
								return
							}
							http.Error(w, "attachment content verification failed", http.StatusBadGateway)
							return
						}
					}
				}
			}

			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(a)
			return
		}

		// List attachments for mailbox
		msgIDParam := r.URL.Query().Get("message_id")
		var rows pgx.Rows
		if msgIDParam != "" {
			rows, err = conn.Query(ctx, `
				SELECT id::text, mailbox_id::text, message_id, filename, content_type, size_bytes, encrypted, created_at
				FROM attachments WHERE mailbox_id=$1 AND message_id=$2
				ORDER BY created_at DESC
			`, mailboxID, msgIDParam)
		} else {
			rows, err = conn.Query(ctx, `
				SELECT id::text, mailbox_id::text, message_id, filename, content_type, size_bytes, encrypted, created_at
				FROM attachments WHERE mailbox_id=$1
				ORDER BY created_at DESC LIMIT 100
			`, mailboxID)
		}
		if err != nil {
			http.Error(w, "failed to query attachments", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		list := make([]AttachmentResponse, 0)
		for rows.Next() {
			var a AttachmentResponse
			var mID *string
			if err := rows.Scan(&a.ID, &a.MailboxID, &mID, &a.Filename, &a.ContentType, &a.SizeBytes, &a.Encrypted, &a.CreatedAt); err == nil {
				if mID != nil {
					a.MessageID = *mID
				}
				list = append(list, a)
			}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"attachments": list})

	case http.MethodPost:
		// Enforce 40 MB total payload budget
		r.Body = http.MaxBytesReader(w, r.Body, MaxAttachmentSize)

		mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if err == nil && mediaType == "multipart/form-data" {
			// Multipart upload
			err := r.ParseMultipartForm(MaxAttachmentSize)
			if err != nil {
				http.Error(w, fmt.Sprintf("payload exceeds limit or invalid form: %v", err), http.StatusRequestEntityTooLarge)
				return
			}
			file, header, err := r.FormFile("file")
			if err != nil {
				http.Error(w, "file field missing in multipart form", http.StatusBadRequest)
				return
			}
			defer file.Close()

			if header.Size > MaxAttachmentSize {
				http.Error(w, "attachment exceeds maximum size limit of 40 MB", http.StatusRequestEntityTooLarge)
				return
			}
			if header.Size >= 0 && header.Size < 29 {
				http.Error(w, "invalid encrypted attachment envelope", http.StatusBadRequest)
				return
			}

			// Validate Section 12 AES-GCM envelope header (first 29 bytes) before accepting.
			// Plaintext uploads must be rejected and must not reach storage-worker.
			headerBytes := make([]byte, 29)
			n, err := io.ReadFull(file, headerBytes)
			if err != nil || n < 29 || headerBytes[0] != 0x01 {
				http.Error(w, "invalid encrypted attachment envelope", http.StatusBadRequest)
				return
			}

			// Reconstruct stream with header read back in
			streamReader := io.MultiReader(bytes.NewReader(headerBytes), file)

			messageID := strings.TrimSpace(r.FormValue("message_id"))
			filename := filepath.Base(header.Filename)
			if filename == "" {
				filename = "attachment.bin"
			}
			cType := header.Header.Get("Content-Type")
			if cType == "" {
				cType = "application/octet-stream"
			}

			// Generate storage key
			attID := uuid.New().String()
			storageKey := fmt.Sprintf("mailboxes/%s/attachments/%s/%s", mailboxID, attID, filename)

			// Forward bytes to customer storage via storage-worker streaming connection.
			// Total stream size equals the original multipart file size (headerBytes
			// were read back into streamReader), so ContentLength must be header.Size.
			// BUG-004 note: Go populates multipart FileHeader.Size while parsing the
			// form, but proxies/clients that yield an unknown size (Size < 0) are
			// rejected here because downstream providers (e.g. GoogleDriveStorage)
			// require an exact non-negative size.
			if header.Size < 0 {
				http.Error(w, "attachment size unknown, upload rejected", http.StatusBadRequest)
				return
			}
			storeReq, reqErr := http.NewRequestWithContext(ctx, http.MethodPost, storageWorkerURL()+"/api/store", streamReader)
			if reqErr != nil {
				// BUG-001: never create a DB row pointing at an object that was
				// never sent; without a store request there is nothing to link.
				http.Error(w, "failed to prepare storage request", http.StatusInternalServerError)
				return
			}
			storeReq.Header.Set("Content-Type", "application/octet-stream")
			storeReq.Header.Set("X-Object-Key", storageKey)
			storeReq.Header.Set("X-Mailbox-ID", mailboxID)
			setStorageInternalAuth(storeReq)
			storeReq.ContentLength = header.Size

			client := &http.Client{Timeout: 30 * time.Second}
			storeResp, err := client.Do(storeReq)
			if err != nil {
				http.Error(w, "storage-worker unavailable", http.StatusBadGateway)
				return
			}
			defer storeResp.Body.Close()
			if storeResp.StatusCode != http.StatusOK {
				http.Error(w, "failed to store encrypted attachment", http.StatusBadGateway)
				return
			}

			var msgIDPtr *string
			if messageID != "" {
				msgIDPtr = &messageID
			}

			var createdAt time.Time
			err = conn.QueryRow(ctx, `
				INSERT INTO attachments (id, mailbox_id, message_id, filename, content_type, size_bytes, storage_key, encrypted)
				VALUES ($1, $2, $3, $4, $5, $6, $7, true)
				RETURNING created_at
			`, attID, mailboxID, msgIDPtr, filename, cType, header.Size, storageKey).Scan(&createdAt)
			if err != nil {
				http.Error(w, "failed to record attachment", http.StatusInternalServerError)
				return
			}

			auditLog(ctx, conn, userOrgID, userID, "upload_attachment", "attachment", attID, map[string]interface{}{
				"filename":   filename,
				"size_bytes": header.Size,
			})

			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			json.NewEncoder(w).Encode(AttachmentResponse{
				ID:          attID,
				MailboxID:   mailboxID,
				MessageID:   messageID,
				Filename:    filename,
				ContentType: cType,
				SizeBytes:   header.Size,
				Encrypted:   true,
				CreatedAt:   createdAt,
			})
			return
		}

		// Metadata-only records would claim encrypted storage without an object.
		// Require the ciphertext multipart path for every attachment.
		http.Error(w, "multipart encrypted attachment required", http.StatusBadRequest)

	case http.MethodDelete:
		if attachmentID == "" {
			http.Error(w, "attachment_id required in URL path", http.StatusBadRequest)
			return
		}
		// Load the row first: we need the storage key for object deletion,
		// and linked attachments (part of a sent/scheduled message record)
		// must not be destroyed out from under that record.
		var storageKey string
		var linkedTo *string
		err = conn.QueryRow(ctx, `SELECT storage_key, message_id FROM attachments WHERE id=$1 AND mailbox_id=$2`, attachmentID, mailboxID).Scan(&storageKey, &linkedTo)
		if err != nil {
			http.Error(w, "attachment not found", http.StatusNotFound)
			return
		}
		if linkedTo != nil {
			http.Error(w, "attachment is linked to a message and cannot be deleted", http.StatusConflict)
			return
		}
		// Delete the stored object BEFORE the row: the worker delete is
		// idempotent (missing objects succeed), so a retry after a partial
		// failure converges instead of stranding an orphaned blob. If the
		// object delete fails, the row is kept and the client can retry.
		delPayload, _ := json.Marshal(map[string]string{
			"object_key": storageKey,
			"mailbox_id": mailboxID,
		})
		delReq, err := http.NewRequestWithContext(ctx, http.MethodPost, storageWorkerURL()+"/api/delete", bytes.NewReader(delPayload))
		if err != nil {
			http.Error(w, "failed to prepare storage request", http.StatusInternalServerError)
			return
		}
		delReq.Header.Set("Content-Type", "application/json")
		setStorageInternalAuth(delReq)
		delResp, err := (&http.Client{Timeout: 30 * time.Second}).Do(delReq)
		if err != nil {
			http.Error(w, "storage-worker unavailable", http.StatusBadGateway)
			return
		}
		defer delResp.Body.Close()
		if delResp.StatusCode == http.StatusServiceUnavailable {
			http.Error(w, "storage disconnected", http.StatusServiceUnavailable)
			return
		}
		if delResp.StatusCode != http.StatusOK {
			http.Error(w, "failed to delete stored object", http.StatusBadGateway)
			return
		}
		res, err := conn.Exec(ctx, `DELETE FROM attachments WHERE id=$1 AND mailbox_id=$2 AND message_id IS NULL`, attachmentID, mailboxID)
		if err != nil {
			http.Error(w, "failed to delete attachment", http.StatusInternalServerError)
			return
		}
		if res.RowsAffected() == 0 {
			// Either vanished or was linked by a concurrent send after the
			// pre-check; both are reported without claiming deletion.
			http.Error(w, "attachment not found or linked to a message", http.StatusConflict)
			return
		}

		auditLog(ctx, conn, userOrgID, userID, "delete_attachment", "attachment", attachmentID, nil)
		w.WriteHeader(http.StatusNoContent)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}
