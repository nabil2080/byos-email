package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// profilePhotoHandler serves GET, POST, and DELETE /v1/users/me/profile-photo
func profilePhotoHandler(w http.ResponseWriter, r *http.Request) {
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

	var mailboxID string
	var existingPhotoRef *string
	err = conn.QueryRow(ctx, `
		SELECT id::text, profile_photo_ref
		FROM mailboxes
		WHERE user_id=$1 AND is_active=true AND status='active'
		ORDER BY created_at DESC
		LIMIT 1`, userID).Scan(&mailboxID, &existingPhotoRef)
	if err != nil {
		http.Error(w, "mailbox not found", http.StatusNotFound)
		return
	}

	switch r.Method {
	case http.MethodGet:
		if existingPhotoRef == nil || *existingPhotoRef == "" {
			http.Error(w, "photo not found", http.StatusNotFound)
			return
		}

		retPayload, _ := json.Marshal(map[string]string{
			"object_key": *existingPhotoRef,
			"mailbox_id": mailboxID,
		})
		retReq, err := http.NewRequestWithContext(ctx, http.MethodPost, storageWorkerURL()+"/api/retrieve", bytes.NewReader(retPayload))
		if err != nil {
			http.Error(w, "failed to prepare storage request", http.StatusInternalServerError)
			return
		}
		retReq.Header.Set("Content-Type", "application/json")
		setStorageInternalAuth(retReq)
		client := &http.Client{Timeout: 30 * time.Second}
		retResp, err := client.Do(retReq)
		if err != nil {
			http.Error(w, "storage-worker unavailable", http.StatusBadGateway)
			return
		}
		defer retResp.Body.Close()
		if retResp.StatusCode != http.StatusOK {
			http.Error(w, "failed to retrieve photo", http.StatusBadGateway)
			return
		}

		rawData, _, decodeErr := decodeStorageRetrieveBody(retResp.Body)
		if decodeErr != nil || len(rawData) == 0 {
			http.Error(w, "failed to decode photo", http.StatusBadGateway)
			return
		}

		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Content-Length", strconv.Itoa(len(rawData)))
		w.Write(rawData)

	case http.MethodPost:
		var rawData []byte
		contentType := r.Header.Get("Content-Type")
		if strings.HasPrefix(contentType, "multipart/form-data") {
			if err := r.ParseMultipartForm(4 << 20); err != nil {
				http.Error(w, "failed to parse multipart form", http.StatusBadRequest)
				return
			}
			file, _, err := r.FormFile("photo")
			if err != nil {
				file, _, err = r.FormFile("file")
			}
			if err != nil {
				http.Error(w, "missing photo file", http.StatusBadRequest)
				return
			}
			defer file.Close()
			rawData, err = io.ReadAll(http.MaxBytesReader(w, file, 2<<20+1024))
			if err != nil {
				http.Error(w, "photo exceeds maximum size of 2MB", http.StatusBadRequest)
				return
			}
		} else {
			var readErr error
			rawData, readErr = io.ReadAll(http.MaxBytesReader(w, r.Body, 2<<20+1024))
			if readErr != nil {
				http.Error(w, "photo exceeds maximum size of 2MB", http.StatusBadRequest)
				return
			}
		}

		// Envelope validation: Section 12 AES-GCM envelope (Version 1: 0x01, IV 12 bytes, tag 16 bytes, total >= 29 bytes)
		if len(rawData) < 29 || rawData[0] != 0x01 {
			http.Error(w, "invalid encrypted profile photo envelope", http.StatusBadRequest)
			return
		}

		photoID := uuid.New().String()
		storageKey := fmt.Sprintf("mailboxes/%s/profile/photo_%s.bin", mailboxID, photoID)

		storeReq, err := http.NewRequestWithContext(ctx, http.MethodPost, storageWorkerURL()+"/api/store", bytes.NewReader(rawData))
		if err != nil {
			http.Error(w, "failed to prepare storage request", http.StatusInternalServerError)
			return
		}
		storeReq.Header.Set("Content-Type", "application/octet-stream")
		storeReq.Header.Set("X-Object-Key", storageKey)
		storeReq.Header.Set("X-Mailbox-ID", mailboxID)
		setStorageInternalAuth(storeReq)
		storeReq.ContentLength = int64(len(rawData))

		client := &http.Client{Timeout: 30 * time.Second}
		storeResp, err := client.Do(storeReq)
		if err != nil {
			http.Error(w, "storage-worker unavailable", http.StatusBadGateway)
			return
		}
		defer storeResp.Body.Close()
		if storeResp.StatusCode != http.StatusOK {
			http.Error(w, "failed to store encrypted profile photo", http.StatusBadGateway)
			return
		}

		var updatedAt time.Time
		err = conn.QueryRow(ctx, `
			UPDATE mailboxes
			SET profile_photo_ref = $1, profile_photo_updated_at = NOW(), updated_at = NOW()
			WHERE id = $2
			RETURNING profile_photo_updated_at`, storageKey, mailboxID).Scan(&updatedAt)
		if err != nil {
			http.Error(w, "database update failed", http.StatusInternalServerError)
			return
		}

		// Clean up old photo if present and different
		if existingPhotoRef != nil && *existingPhotoRef != "" && *existingPhotoRef != storageKey {
			delPayload, _ := json.Marshal(map[string]string{
				"object_key": *existingPhotoRef,
				"mailbox_id": mailboxID,
			})
			delReq, _ := http.NewRequestWithContext(context.Background(), http.MethodPost, storageWorkerURL()+"/api/delete", bytes.NewReader(delPayload))
			if delReq != nil {
				delReq.Header.Set("Content-Type", "application/json")
				setStorageInternalAuth(delReq)
				_, _ = client.Do(delReq)
			}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"photo_ref":  storageKey,
			"updated_at": updatedAt.Format(time.RFC3339),
		})

	case http.MethodDelete:
		if existingPhotoRef != nil && *existingPhotoRef != "" {
			delPayload, _ := json.Marshal(map[string]string{
				"object_key": *existingPhotoRef,
				"mailbox_id": mailboxID,
			})
			delReq, _ := http.NewRequestWithContext(ctx, http.MethodPost, storageWorkerURL()+"/api/delete", bytes.NewReader(delPayload))
			if delReq != nil {
				delReq.Header.Set("Content-Type", "application/json")
				setStorageInternalAuth(delReq)
				_, _ = (&http.Client{Timeout: 10 * time.Second}).Do(delReq)
			}
		}

		_, err = conn.Exec(ctx, `
			UPDATE mailboxes
			SET profile_photo_ref = NULL, profile_photo_updated_at = NOW(), updated_at = NOW()
			WHERE id = $1`, mailboxID)
		if err != nil {
			http.Error(w, "database update failed", http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusNoContent)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}
