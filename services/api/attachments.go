package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

const MaxAttachmentSize = 40 * 1024 * 1024 // 40 MB V1 budget

type AttachmentResponse struct {
	ID                  string    `json:"id"`
	MailboxID           string    `json:"mailbox_id"`
	MessageID           string    `json:"message_id,omitempty"`
	Filename            string    `json:"filename"`
	ContentType         string    `json:"content_type"`
	SizeBytes           int64     `json:"size_bytes"`
	Encrypted           bool      `json:"encrypted"`
	CreatedAt           time.Time `json:"created_at"`
	CryptoVersion       int       `json:"crypto_version,omitempty"`
	CekOwnerWrapped     string    `json:"cek_owner_wrapped,omitempty"`
	OwnerWrapAlg        string    `json:"owner_wrap_alg,omitempty"`
	OwnerKeyVersion     int       `json:"owner_key_version,omitempty"`
	OwnerPkSHA256       string    `json:"owner_pk_sha256,omitempty"`
	BlobAADVersion      int       `json:"blob_aad_version,omitempty"`
	PlaintextSizeBytes  int64     `json:"plaintext_size_bytes,omitempty"`
	CiphertextSizeBytes int64     `json:"ciphertext_size_bytes,omitempty"`
	PlaintextSHA256     string    `json:"plaintext_sha256,omitempty"`
	CiphertextSHA256    string    `json:"ciphertext_sha256,omitempty"`
}

func attachmentsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
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

	dsn := getDatabaseDSN()
	ctx := r.Context()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	// Authorize mailbox access for session. The existence check is subsumed
	// by the authorization check: an unauthorized caller must receive 403
	// whether the mailbox exists or not, to prevent mailbox-existence disclosure
	// via distinct response codes.
	if status, errMsg, authOk := verifyMailboxSession(r, userID, mailboxID, conn, ctx); !authOk {
		http.Error(w, errMsg, status)
		return
	}
	var userOrgID string
	_ = conn.QueryRow(ctx, `SELECT org_id::text FROM users WHERE id=$1`, userID).Scan(&userOrgID)

	attachmentID := r.PathValue("attachment_id")

	switch r.Method {
	case http.MethodGet:
		if attachmentID != "" {
			// Single attachment metadata or download
			var a AttachmentResponse
			var msgID *string
			var storageKey string
			hasV2 := hasAttachmentV2Schema(ctx, conn)
			if hasV2 {
				var cv int
				var cekOwner, ownerPkSHA, ptSHA, ctSHA []byte
				var ownerAlg *string
				var ownerKeyVer, blobAADVer *int
				var ctSize *int64
				err = conn.QueryRow(ctx, `
					SELECT id::text, mailbox_id::text, message_id, filename, content_type, size_bytes, encrypted, created_at, storage_key,
					       crypto_version, cek_owner_wrapped, owner_wrap_alg, owner_key_version, owner_pk_sha256,
					       blob_aad_version, plaintext_sha256, ciphertext_sha256, ciphertext_size_bytes
					FROM attachments WHERE id=$1 AND mailbox_id=$2
				`, attachmentID, mailboxID).Scan(
					&a.ID, &a.MailboxID, &msgID, &a.Filename, &a.ContentType, &a.SizeBytes, &a.Encrypted, &a.CreatedAt, &storageKey,
					&cv, &cekOwner, &ownerAlg, &ownerKeyVer, &ownerPkSHA,
					&blobAADVer, &ptSHA, &ctSHA, &ctSize,
				)
				if err == nil && cv == AttachmentCryptoVersionV2 {
					a.CryptoVersion = cv
					a.PlaintextSizeBytes = a.SizeBytes
					if len(cekOwner) > 0 {
						a.CekOwnerWrapped = base64.StdEncoding.EncodeToString(cekOwner)
					}
					if ownerAlg != nil {
						a.OwnerWrapAlg = *ownerAlg
					}
					if ownerKeyVer != nil {
						a.OwnerKeyVersion = *ownerKeyVer
					}
					if len(ownerPkSHA) == 32 {
						a.OwnerPkSHA256 = hex.EncodeToString(ownerPkSHA)
					}
					if blobAADVer != nil {
						a.BlobAADVersion = *blobAADVer
					}
					if len(ptSHA) == 32 {
						a.PlaintextSHA256 = hex.EncodeToString(ptSHA)
					}
					if len(ctSHA) == 32 {
						a.CiphertextSHA256 = hex.EncodeToString(ctSHA)
					}
					if ctSize != nil {
						a.CiphertextSizeBytes = *ctSize
					}
				} else if err == nil {
					a.CryptoVersion = cv
				}
			} else {
				err = conn.QueryRow(ctx, `
					SELECT id::text, mailbox_id::text, message_id, filename, content_type, size_bytes, encrypted, created_at, storage_key
					FROM attachments WHERE id=$1 AND mailbox_id=$2
				`, attachmentID, mailboxID).Scan(&a.ID, &a.MailboxID, &msgID, &a.Filename, &a.ContentType, &a.SizeBytes, &a.Encrypted, &a.CreatedAt, &storageKey)
			}
			if err != nil {
				http.Error(w, "attachment not found", http.StatusNotFound)
				return
			}
			if msgID != nil {
				a.MessageID = *msgID
			}

			if r.URL.Query().Get("download") == "true" {
				expectedBlobSize := a.SizeBytes
				if a.CryptoVersion == AttachmentCryptoVersionV2 && a.CiphertextSizeBytes > 0 {
					expectedBlobSize = a.CiphertextSizeBytes
				}
				retPayload, _ := json.Marshal(map[string]string{
					"object_key": storageKey,
					"mailbox_id": mailboxID,
				})
				retReq, err := http.NewRequestWithContext(ctx, http.MethodPost, storageWorkerURL()+"/api/retrieve", bytes.NewReader(retPayload))
				if err != nil {
					http.Error(w, "failed to create storage retrieval request", http.StatusInternalServerError)
					return
				}
				retReq.Header.Set("Content-Type", "application/json")
				setStorageInternalAuth(retReq)
				client := &http.Client{Timeout: 30 * time.Second}
				retResp, err := client.Do(retReq)
				if err != nil {
					http.Error(w, "storage retrieval failed", http.StatusBadGateway)
					return
				}
				defer retResp.Body.Close()
				if retResp.StatusCode != http.StatusOK {
					http.Error(w, "storage retrieval failed", http.StatusBadGateway)
					return
				}
				// Storage-worker Data is a base64 StdEncoding JSON
				// string (see storageRetrieveResponse): decode
				// exactly once to raw bytes, then serve raw.
				// SEC-005: verify the returned bytes against DB
				// metadata instead of serving any non-empty body.
				rawData, reportedSize, decodeErr := decodeStorageRetrieveBody(retResp.Body)
				if decodeErr == nil && len(rawData) > 0 &&
					int64(len(rawData)) == expectedBlobSize && reportedSize == expectedBlobSize {
					cleanFilename := sanitizeFilename(a.Filename)
					w.Header().Set("Content-Type", a.ContentType)
					w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", cleanFilename))
					w.Header().Set("X-Content-Type-Options", "nosniff")
					w.Write(rawData)
					return
				}
				http.Error(w, "attachment content verification failed", http.StatusBadGateway)
				return
			}

			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(a)
			return
		}

		// List attachments for mailbox
		msgIDParam := r.URL.Query().Get("message_id")
		hasV2 := hasAttachmentV2Schema(ctx, conn)
		var rows pgx.Rows
		if hasV2 {
			if msgIDParam != "" {
				rows, err = conn.Query(ctx, `
					SELECT id::text, mailbox_id::text, message_id, filename, content_type, size_bytes, encrypted, created_at,
					       crypto_version, cek_owner_wrapped, owner_wrap_alg, owner_key_version, owner_pk_sha256,
					       blob_aad_version, plaintext_sha256, ciphertext_sha256, ciphertext_size_bytes
					FROM attachments WHERE mailbox_id=$1 AND message_id=$2
					ORDER BY created_at DESC
				`, mailboxID, msgIDParam)
			} else {
				rows, err = conn.Query(ctx, `
					SELECT id::text, mailbox_id::text, message_id, filename, content_type, size_bytes, encrypted, created_at,
					       crypto_version, cek_owner_wrapped, owner_wrap_alg, owner_key_version, owner_pk_sha256,
					       blob_aad_version, plaintext_sha256, ciphertext_sha256, ciphertext_size_bytes
					FROM attachments WHERE mailbox_id=$1
					ORDER BY created_at DESC LIMIT 100
				`, mailboxID)
			}
		} else {
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
			if hasV2 {
				var cv int
				var cekOwner, ownerPkSHA, ptSHA, ctSHA []byte
				var ownerAlg *string
				var ownerKeyVer, blobAADVer *int
				var ctSize *int64
				if err := rows.Scan(
					&a.ID, &a.MailboxID, &mID, &a.Filename, &a.ContentType, &a.SizeBytes, &a.Encrypted, &a.CreatedAt,
					&cv, &cekOwner, &ownerAlg, &ownerKeyVer, &ownerPkSHA,
					&blobAADVer, &ptSHA, &ctSHA, &ctSize,
				); err == nil {
					if mID != nil {
						a.MessageID = *mID
					}
					a.CryptoVersion = cv
					if cv == AttachmentCryptoVersionV2 {
						a.PlaintextSizeBytes = a.SizeBytes
						if len(cekOwner) > 0 {
							a.CekOwnerWrapped = base64.StdEncoding.EncodeToString(cekOwner)
						}
						if ownerAlg != nil {
							a.OwnerWrapAlg = *ownerAlg
						}
						if ownerKeyVer != nil {
							a.OwnerKeyVersion = *ownerKeyVer
						}
						if len(ownerPkSHA) == 32 {
							a.OwnerPkSHA256 = hex.EncodeToString(ownerPkSHA)
						}
						if blobAADVer != nil {
							a.BlobAADVersion = *blobAADVer
						}
						if len(ptSHA) == 32 {
							a.PlaintextSHA256 = hex.EncodeToString(ptSHA)
						}
						if len(ctSHA) == 32 {
							a.CiphertextSHA256 = hex.EncodeToString(ctSHA)
						}
						if ctSize != nil {
							a.CiphertextSizeBytes = *ctSize
						}
					}
					list = append(list, a)
				}
			} else {
				if err := rows.Scan(&a.ID, &a.MailboxID, &mID, &a.Filename, &a.ContentType, &a.SizeBytes, &a.Encrypted, &a.CreatedAt); err == nil {
					if mID != nil {
						a.MessageID = *mID
					}
					list = append(list, a)
				}
			}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"attachments": list})

	case http.MethodPost:
		// Enforce 40 MB payload budget (+64 KiB multipart form framing margin).
		r.Body = http.MaxBytesReader(w, r.Body, MaxAttachmentSize+64*1024)

		mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if err == nil && mediaType == "multipart/form-data" {
			// Multipart upload
			err := r.ParseMultipartForm(MaxAttachmentSize + 64*1024)
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
			cryptoVerStr := strings.TrimSpace(r.FormValue("crypto_version"))
			if cryptoVerStr == "2" {
				if !hasAttachmentV2Schema(ctx, conn) {
					http.Error(w, "attachment protocol v2 schema not available", http.StatusServiceUnavailable)
					return
				}
				attIDRaw := strings.TrimSpace(r.FormValue("attachment_id"))
				parsedAttID, idErr := uuid.Parse(attIDRaw)
				if idErr != nil {
					http.Error(w, "v2 upload requires valid UUID attachment_id", http.StatusBadRequest)
					return
				}
				attID := parsedAttID.String()

				var exists bool
				if err := conn.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM attachments WHERE id=$1)`, attID).Scan(&exists); err == nil && exists {
					http.Error(w, "attachment_id already exists", http.StatusConflict)
					return
				}

				rawName := header.Filename
				if fOverride := r.FormValue("filename"); fOverride != "" {
					if fOverride != rawName {
						http.Error(w, "filename form field must match file filename", http.StatusBadRequest)
						return
					}
				}
				filename := sanitizeFilename(rawName)
				if filename != rawName {
					http.Error(w, "v2 attachment filename must be canonically normalized before encryption", http.StatusBadRequest)
					return
				}

				rawCT := strings.TrimSpace(r.FormValue("content_type"))
				if rawCT == "" {
					rawCT = strings.TrimSpace(header.Header.Get("Content-Type"))
				}
				cType := canonicalMimeType(rawCT)
				if rawCT != "" && rawCT != cType {
					http.Error(w, "v2 attachment content_type must be canonical lowercase media type", http.StatusBadRequest)
					return
				}

				ptSizeStr := strings.TrimSpace(r.FormValue("plaintext_size_bytes"))
				ptSize, sizeErr := strconv.ParseInt(ptSizeStr, 10, 64)
				if sizeErr != nil || ptSize < 0 || ptSize > MaxAttachmentSize-29 {
					http.Error(w, "invalid plaintext_size_bytes", http.StatusBadRequest)
					return
				}
				if header.Size < 0 || header.Size != ptSize+29 {
					http.Error(w, "ciphertext size does not equal plaintext_size_bytes + 29", http.StatusBadRequest)
					return
				}

				blobAADVerStr := strings.TrimSpace(r.FormValue("blob_aad_version"))
				if blobAADVerStr != "2" {
					http.Error(w, "blob_aad_version must be 2", http.StatusBadRequest)
					return
				}

				ownerWrapAlg := strings.TrimSpace(r.FormValue("owner_wrap_alg"))
				if ownerWrapAlg != AttachmentWrapAlgX25519 {
					http.Error(w, "unsupported owner_wrap_alg", http.StatusBadRequest)
					return
				}

				ownerKeyVer, verErr := strconv.Atoi(strings.TrimSpace(r.FormValue("owner_key_version")))
				if verErr != nil || ownerKeyVer < 1 {
					http.Error(w, "invalid owner_key_version", http.StatusBadRequest)
					return
				}

				cekOwnerBytes, cekErr := base64.StdEncoding.DecodeString(strings.TrimSpace(r.FormValue("cek_owner_wrapped")))
				if cekErr != nil || len(cekOwnerBytes) != 81 || cekOwnerBytes[0] != 0x01 {
					http.Error(w, "cek_owner_wrapped must be 81-byte canonical HPKE envelope", http.StatusBadRequest)
					return
				}

				ownerPkSHA, pkShaErr := decode32ByteDigestParam(r.FormValue("owner_pk_sha256"))
				if pkShaErr != nil {
					http.Error(w, "invalid owner_pk_sha256", http.StatusBadRequest)
					return
				}
				ptSHA, ptShaErr := decode32ByteDigestParam(r.FormValue("plaintext_sha256"))
				if ptShaErr != nil {
					http.Error(w, "invalid plaintext_sha256", http.StatusBadRequest)
					return
				}
				ctSHA, ctShaErr := decode32ByteDigestParam(r.FormValue("ciphertext_sha256"))
				if ctShaErr != nil {
					http.Error(w, "invalid ciphertext_sha256", http.StatusBadRequest)
					return
				}

				var dbKeyVer int
				var dbMailboxPK []byte
				if err := conn.QueryRow(ctx, `SELECT mailbox_sk_version, mailbox_pk FROM mailboxes WHERE id=$1`, mailboxID).Scan(&dbKeyVer, &dbMailboxPK); err != nil {
					http.Error(w, "mailbox not found", http.StatusNotFound)
					return
				}
				if len(dbMailboxPK) == 32 {
					expectedPkSHA := sha256.Sum256(dbMailboxPK)
					if ownerKeyVer != dbKeyVer || subtle.ConstantTimeCompare(ownerPkSHA, expectedPkSHA[:]) != 1 {
						w.Header().Set("Content-Type", "application/json")
						w.WriteHeader(http.StatusConflict)
						_ = json.NewEncoder(w).Encode(map[string]interface{}{
							"error":              "owner_key_version_stale",
							"mailbox_sk_version": dbKeyVer,
						})
						return
					}
				}

				storageKey := fmt.Sprintf("mailboxes/%s/attachments/%s/payload.bin", mailboxID, attID)
				var msgIDPtr *string
				if messageID != "" {
					msgIDPtr = &messageID
				}
				var createdAt time.Time
				err = conn.QueryRow(ctx, `
					INSERT INTO attachments (
						id, mailbox_id, message_id, filename, content_type, size_bytes, storage_key, encrypted,
						crypto_version, cek_owner_wrapped, owner_wrap_alg, owner_key_version, owner_pk_sha256,
						blob_aad_version, plaintext_sha256, ciphertext_sha256, ciphertext_size_bytes, upload_state
					) VALUES (
						$1, $2, $3, $4, $5, $6, $7, true,
						2, $8, $9, $10, $11,
						2, $12, $13, $14, 'pending'
					)
					ON CONFLICT (id) DO NOTHING
					RETURNING created_at
				`, attID, mailboxID, msgIDPtr, filename, cType, ptSize, storageKey,
					cekOwnerBytes, ownerWrapAlg, ownerKeyVer, ownerPkSHA,
					ptSHA, ctSHA, ptSize+29).Scan(&createdAt)
				if err == pgx.ErrNoRows {
					http.Error(w, "attachment_id already exists", http.StatusConflict)
					return
				}
				if err != nil {
					http.Error(w, "failed to reserve attachment upload", http.StatusInternalServerError)
					return
				}

				cleanupPending := func() {
					_, _ = conn.Exec(ctx, `DELETE FROM attachments WHERE id=$1 AND mailbox_id=$2 AND upload_state='pending'`, attID, mailboxID)
				}

				ctHasher := sha256.New()
				var streamedBytes int64
				countingReader := io.TeeReader(streamReader, io.MultiWriter(ctHasher, &byteCountWriter{n: &streamedBytes}))

				storeReq, reqErr := http.NewRequestWithContext(ctx, http.MethodPost, storageWorkerURL()+"/api/store", countingReader)
				if reqErr != nil {
					cleanupPending()
					http.Error(w, "failed to prepare storage request", http.StatusInternalServerError)
					return
				}
				storeReq.Header.Set("Content-Type", "application/octet-stream")
				storeReq.Header.Set("X-Object-Key", storageKey)
				storeReq.Header.Set("X-Mailbox-ID", mailboxID)
				setStorageInternalAuth(storeReq)
				storeReq.ContentLength = header.Size

				storeResp, err := (&http.Client{Timeout: 180 * time.Second}).Do(storeReq)
				if err != nil {
					cleanupPending()
					http.Error(w, "storage-worker unavailable", http.StatusBadGateway)
					return
				}
				defer storeResp.Body.Close()
				if storeResp.StatusCode != http.StatusOK {
					cleanupPending()
					http.Error(w, "failed to store encrypted attachment", http.StatusBadGateway)
					return
				}

				computedCTSHA := ctHasher.Sum(nil)
				if streamedBytes != ptSize+29 || subtle.ConstantTimeCompare(computedCTSHA, ctSHA) != 1 {
					bestEffortDeleteStorageObject(ctx, mailboxID, storageKey)
					cleanupPending()
					http.Error(w, "uploaded ciphertext integrity mismatch", http.StatusBadRequest)
					return
				}

				if _, err := conn.Exec(ctx, `
					UPDATE attachments
					SET upload_state = 'committed'
					WHERE id=$1 AND mailbox_id=$2 AND upload_state='pending'
				`, attID, mailboxID); err != nil {
					bestEffortDeleteStorageObject(ctx, mailboxID, storageKey)
					cleanupPending()
					http.Error(w, "failed to commit attachment", http.StatusInternalServerError)
					return
				}

				auditLog(ctx, conn, userOrgID, userID, "upload_attachment", "attachment", attID, map[string]interface{}{
					"filename":       filename,
					"size_bytes":     ptSize,
					"crypto_version": 2,
				})

				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusCreated)
				json.NewEncoder(w).Encode(AttachmentResponse{
					ID:                  attID,
					MailboxID:           mailboxID,
					MessageID:           messageID,
					Filename:            filename,
					ContentType:         cType,
					SizeBytes:           ptSize,
					Encrypted:           true,
					CreatedAt:           createdAt,
					CryptoVersion:       2,
					CekOwnerWrapped:     base64.StdEncoding.EncodeToString(cekOwnerBytes),
					OwnerWrapAlg:        ownerWrapAlg,
					OwnerKeyVersion:     ownerKeyVer,
					OwnerPkSHA256:       hex.EncodeToString(ownerPkSHA),
					BlobAADVersion:      2,
					PlaintextSizeBytes:  ptSize,
					CiphertextSizeBytes: ptSize + 29,
					PlaintextSHA256:     hex.EncodeToString(ptSHA),
					CiphertextSHA256:    hex.EncodeToString(ctSHA),
				})
				return
			}

			filename := sanitizeFilename(header.Filename)
			cType := header.Header.Get("Content-Type")
			if cType == "" {
				cType = "application/octet-stream"
			}

			// Generate opaque storage key: eliminates plaintext filename from customer-owned storage key and provider metadata
			attID := uuid.New().String()
			storageKey := fmt.Sprintf("mailboxes/%s/attachments/%s/payload.bin", mailboxID, attID)

			// Forward bytes to customer storage via storage-worker streaming connection.
			// Total stream size equals the original multipart file size (headerBytes
			// were read back into streamReader), so ContentLength must be header.Size.
			// Note: Go populates multipart FileHeader.Size while parsing the
			// form, but proxies/clients that yield an unknown size (Size < 0) are
			// rejected here because downstream providers (e.g. GoogleDriveStorage)
			// require an exact non-negative size.
			if header.Size < 0 {
				http.Error(w, "attachment size unknown, upload rejected", http.StatusBadRequest)
				return
			}
			storeReq, reqErr := http.NewRequestWithContext(ctx, http.MethodPost, storageWorkerURL()+"/api/store", streamReader)
			if reqErr != nil {
				// Never create a DB row pointing at an object that was
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
		if hasOutboundDeliveryAttachmentsTable(ctx, conn) {
			var grantRef bool
			if qErr := conn.QueryRow(ctx, `
				SELECT EXISTS (
					SELECT 1
					FROM outbound_delivery_attachments oda
					LEFT JOIN outbound_queue oq ON oq.delivery_id = oda.delivery_id
					LEFT JOIN scheduled_messages sm ON sm.delivery_id = oda.delivery_id
					WHERE oda.attachment_id = $1
					  AND (
						  (oq.id IS NOT NULL AND oq.status NOT IN ('delivered', 'bounced', 'expired'))
						  OR COALESCE(sm.status, '') = 'pending'
					  )
				)
			`, attachmentID).Scan(&grantRef); qErr == nil && grantRef {
				http.Error(w, "attachment is referenced by an active outbound delivery and cannot be deleted", http.StatusConflict)
				return
			}
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

func sanitizeFilename(raw string) string {
	clean := raw
	if idx := strings.LastIndexAny(clean, "/\\"); idx != -1 {
		clean = clean[idx+1:]
	}
	clean = strings.TrimSpace(clean)
	var sb strings.Builder
	for _, r := range clean {
		if r < 32 || r == 127 || r == '/' || r == '\\' || r == '"' || r == '\'' || r == ';' {
			sb.WriteRune('_')
		} else {
			sb.WriteRune(r)
		}
	}
	res := sb.String()
	if res == "" || res == "." || res == ".." {
		return "attachment.bin"
	}
	runes := []rune(res)
	if len(runes) > 255 {
		res = string(runes[:255])
	}
	return res
}

type byteCountWriter struct {
	n *int64
}

func (w *byteCountWriter) Write(p []byte) (int, error) {
	*w.n += int64(len(p))
	return len(p), nil
}

func decode32ByteDigestParam(raw string) ([]byte, error) {
	trimmed := strings.TrimSpace(raw)
	if len(trimmed) == 64 {
		b, err := hex.DecodeString(trimmed)
		if err == nil && len(b) == 32 {
			return b, nil
		}
	}
	b, err := base64.StdEncoding.DecodeString(trimmed)
	if err == nil && len(b) == 32 {
		return b, nil
	}
	return nil, fmt.Errorf("expected 32-byte digest")
}

func bestEffortDeleteStorageObject(ctx context.Context, mailboxID, storageKey string) {
	delPayload, _ := json.Marshal(map[string]string{
		"object_key": storageKey,
		"mailbox_id": mailboxID,
	})
	delReq, err := http.NewRequestWithContext(ctx, http.MethodPost, storageWorkerURL()+"/api/delete", bytes.NewReader(delPayload))
	if err != nil {
		return
	}
	delReq.Header.Set("Content-Type", "application/json")
	setStorageInternalAuth(delReq)
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(delReq)
	if err == nil {
		resp.Body.Close()
	}
}
