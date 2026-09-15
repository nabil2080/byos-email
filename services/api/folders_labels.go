package main

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type CreateFolderRequest struct {
	Name     string  `json:"name"`
	ParentID *string `json:"parent_id"`
	Notify   *bool   `json:"notify"`
	Color    *string `json:"color"`
}

type CreateLabelRequest struct {
	Name      string  `json:"name"`
	Color     *string `json:"color"`
	ColorName *string `json:"color_name"`
}

func mailboxFoldersHandler(w http.ResponseWriter, r *http.Request) {
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

	_, _, _, mailboxID, ok := resolveDraftMailbox(w, r, conn, ctx)
	if !ok {
		return
	}

	folderID := r.PathValue("folder_id")
	if folderID != "" {
		if _, err := uuid.Parse(folderID); err != nil {
			http.Error(w, "folder ID must be UUID", http.StatusBadRequest)
			return
		}
		if r.Method == http.MethodDelete {
			// Reassign contained messages to inbox before deleting the folder
			_, _ = conn.Exec(ctx, `UPDATE message_metadata SET folder = 'inbox', folder_id = NULL WHERE folder_id=$1 AND mailbox_id=$2`, folderID, mailboxID)
			tag, err := conn.Exec(ctx, `DELETE FROM mailbox_folders WHERE id=$1 AND mailbox_id=$2`, folderID, mailboxID)
			if err != nil {
				http.Error(w, "failed to delete folder", http.StatusInternalServerError)
				return
			}
			if tag.RowsAffected() == 0 {
				http.Error(w, "folder not found", http.StatusNotFound)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method == http.MethodPut {
			var req CreateFolderRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "invalid request body", http.StatusBadRequest)
				return
			}
			name := strings.TrimSpace(req.Name)
			if name == "" || len(name) > 100 {
				http.Error(w, "name must be between 1 and 100 characters", http.StatusBadRequest)
				return
			}
			notify := true
			if req.Notify != nil {
				notify = *req.Notify
			}
			color := "#9E725F"
			if req.Color != nil && strings.TrimSpace(*req.Color) != "" {
				color = strings.TrimSpace(*req.Color)
			}

			var parentUUID *string
			if req.ParentID != nil && strings.TrimSpace(*req.ParentID) != "" {
				pID := strings.TrimSpace(*req.ParentID)
				if pID == folderID {
					http.Error(w, "folder cannot be its own parent", http.StatusBadRequest)
					return
				}
				if _, err := uuid.Parse(pID); err != nil {
					http.Error(w, "parent_id must be valid UUID", http.StatusBadRequest)
					return
				}
				var checkID string
				err := conn.QueryRow(ctx, `SELECT id::text FROM mailbox_folders WHERE id=$1 AND mailbox_id=$2`, pID, mailboxID).Scan(&checkID)
				if err != nil {
					http.Error(w, "parent folder not found in this mailbox", http.StatusBadRequest)
					return
				}
				parentUUID = &pID
			}

			tag, err := conn.Exec(ctx, `
				UPDATE mailbox_folders
				SET name=$1, parent_id=$2, notify=$3, color=$4
				WHERE id=$5 AND mailbox_id=$6`,
				name, parentUUID, notify, color, folderID, mailboxID)
			if err != nil {
				http.Error(w, "failed to update folder", http.StatusInternalServerError)
				return
			}
			if tag.RowsAffected() == 0 {
				http.Error(w, "folder not found", http.StatusNotFound)
				return
			}
			resp := map[string]interface{}{
				"id":         folderID,
				"mailbox_id": mailboxID,
				"name":       name,
				"notify":     notify,
				"color":      color,
			}
			if parentUUID != nil {
				resp["parent_id"] = *parentUUID
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(resp)
			return
		}
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	switch r.Method {
	case http.MethodGet:
		rows, err := conn.Query(ctx, `
			SELECT DISTINCT ON (LOWER(name)) id::text, mailbox_id::text, name, COALESCE(parent_id::text, ''), notify, COALESCE(color, '#9E725F'), created_at
			FROM mailbox_folders
			WHERE mailbox_id=$1
			ORDER BY LOWER(name), created_at ASC`, mailboxID)
		if err != nil {
			http.Error(w, "failed to list folders", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		folders := []map[string]interface{}{}
		for rows.Next() {
			var id, mbID, name, parentID, color string
			var notify bool
			var createdAt time.Time
			if err := rows.Scan(&id, &mbID, &name, &parentID, &notify, &color, &createdAt); err != nil {
				http.Error(w, "failed reading folders", http.StatusInternalServerError)
				return
			}
			item := map[string]interface{}{
				"id":         id,
				"mailbox_id": mbID,
				"name":       name,
				"notify":     notify,
				"color":      color,
				"created_at": createdAt.Format(time.RFC3339),
			}
			if parentID != "" {
				item["parent_id"] = parentID
			}
			folders = append(folders, item)
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"folders": folders})

	case http.MethodPost:
		var req CreateFolderRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		name := strings.TrimSpace(req.Name)
		if name == "" || len(name) > 100 {
			http.Error(w, "name must be between 1 and 100 characters", http.StatusBadRequest)
			return
		}
		notify := true
		if req.Notify != nil {
			notify = *req.Notify
		}
		color := "#9E725F"
		if req.Color != nil && strings.TrimSpace(*req.Color) != "" {
			color = strings.TrimSpace(*req.Color)
		}

		var parentUUID *string
		if req.ParentID != nil && strings.TrimSpace(*req.ParentID) != "" {
			pID := strings.TrimSpace(*req.ParentID)
			if _, err := uuid.Parse(pID); err != nil {
				http.Error(w, "parent_id must be valid UUID", http.StatusBadRequest)
				return
			}
			var checkID string
			err := conn.QueryRow(ctx, `SELECT id::text FROM mailbox_folders WHERE id=$1 AND mailbox_id=$2`, pID, mailboxID).Scan(&checkID)
			if err != nil {
				http.Error(w, "parent folder not found in this mailbox", http.StatusBadRequest)
				return
			}
			parentUUID = &pID
		}

		var existingID string
		err = conn.QueryRow(ctx, `SELECT id::text FROM mailbox_folders WHERE mailbox_id=$1 AND LOWER(name)=LOWER($2)`, mailboxID, name).Scan(&existingID)
		if err == nil {
			http.Error(w, "folder with this name already exists", http.StatusConflict)
			return
		}

		var newID string
		var createdAt time.Time
		err = conn.QueryRow(ctx, `
			INSERT INTO mailbox_folders (mailbox_id, name, parent_id, notify, color)
			VALUES ($1, $2, $3, $4, $5)
			RETURNING id::text, created_at`,
			mailboxID, name, parentUUID, notify, color).Scan(&newID, &createdAt)
		if err != nil {
			if strings.Contains(strings.ToLower(err.Error()), "unique") || strings.Contains(err.Error(), "idx_mailbox_folders_unique_name") {
				http.Error(w, "folder with this name already exists", http.StatusConflict)
				return
			}
			http.Error(w, "failed to create folder", http.StatusInternalServerError)
			return
		}

		resp := map[string]interface{}{
			"id":         newID,
			"mailbox_id": mailboxID,
			"name":       name,
			"notify":     notify,
			"color":      color,
			"created_at": createdAt.Format(time.RFC3339),
		}
		if parentUUID != nil {
			resp["parent_id"] = *parentUUID
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(resp)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func mailboxLabelsHandler(w http.ResponseWriter, r *http.Request) {
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

	_, _, _, mailboxID, ok := resolveDraftMailbox(w, r, conn, ctx)
	if !ok {
		return
	}

	labelID := r.PathValue("label_id")
	if labelID != "" {
		if _, err := uuid.Parse(labelID); err != nil {
			http.Error(w, "label ID must be UUID", http.StatusBadRequest)
			return
		}
		if r.Method == http.MethodDelete {
			tag, err := conn.Exec(ctx, `DELETE FROM mailbox_labels WHERE id=$1 AND mailbox_id=$2`, labelID, mailboxID)
			if err != nil {
				http.Error(w, "failed to delete label", http.StatusInternalServerError)
				return
			}
			if tag.RowsAffected() == 0 {
				http.Error(w, "label not found", http.StatusNotFound)
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method == http.MethodPut {
			var req CreateLabelRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "invalid request body", http.StatusBadRequest)
				return
			}
			name := strings.TrimSpace(req.Name)
			if name == "" || len(name) > 60 {
				http.Error(w, "name must be between 1 and 60 characters", http.StatusBadRequest)
				return
			}
			color := "#9E725F"
			if req.Color != nil && strings.TrimSpace(*req.Color) != "" {
				color = strings.TrimSpace(*req.Color)
			}
			colorName := "Mocha"
			if req.ColorName != nil && strings.TrimSpace(*req.ColorName) != "" {
				colorName = strings.TrimSpace(*req.ColorName)
			}
			tag, err := conn.Exec(ctx, `
				UPDATE mailbox_labels
				SET name=$1, color=$2, color_name=$3
				WHERE id=$4 AND mailbox_id=$5`,
				name, color, colorName, labelID, mailboxID)
			if err != nil {
				http.Error(w, "failed to update label", http.StatusInternalServerError)
				return
			}
			if tag.RowsAffected() == 0 {
				http.Error(w, "label not found", http.StatusNotFound)
				return
			}
			resp := map[string]interface{}{
				"id":         labelID,
				"mailbox_id": mailboxID,
				"name":       name,
				"color":      color,
				"color_name": colorName,
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(resp)
			return
		}
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	switch r.Method {
	case http.MethodGet:
		rows, err := conn.Query(ctx, `
			SELECT DISTINCT ON (LOWER(name)) id::text, mailbox_id::text, name, color, color_name, created_at
			FROM mailbox_labels
			WHERE mailbox_id=$1
			ORDER BY LOWER(name), created_at ASC`, mailboxID)
		if err != nil {
			http.Error(w, "failed to list labels", http.StatusInternalServerError)
			return
		}
		defer rows.Close()

		labels := []map[string]interface{}{}
		for rows.Next() {
			var id, mbID, name, color, colorName string
			var createdAt time.Time
			if err := rows.Scan(&id, &mbID, &name, &color, &colorName, &createdAt); err != nil {
				http.Error(w, "failed reading labels", http.StatusInternalServerError)
				return
			}
			labels = append(labels, map[string]interface{}{
				"id":         id,
				"mailbox_id": mbID,
				"name":       name,
				"color":      color,
				"color_name": colorName,
				"created_at": createdAt.Format(time.RFC3339),
			})
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"labels": labels})

	case http.MethodPost:
		var req CreateLabelRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		name := strings.TrimSpace(req.Name)
		if name == "" || len(name) > 60 {
			http.Error(w, "name must be between 1 and 60 characters", http.StatusBadRequest)
			return
		}
		color := "#9E725F"
		if req.Color != nil && strings.TrimSpace(*req.Color) != "" {
			color = strings.TrimSpace(*req.Color)
		}
		colorName := "Mocha"
		if req.ColorName != nil && strings.TrimSpace(*req.ColorName) != "" {
			colorName = strings.TrimSpace(*req.ColorName)
		}

		var existingLabelID string
		err = conn.QueryRow(ctx, `SELECT id::text FROM mailbox_labels WHERE mailbox_id=$1 AND LOWER(name)=LOWER($2)`, mailboxID, name).Scan(&existingLabelID)
		if err == nil {
			http.Error(w, "label with this name already exists", http.StatusConflict)
			return
		}

		var newID string
		var createdAt time.Time
		err = conn.QueryRow(ctx, `
			INSERT INTO mailbox_labels (mailbox_id, name, color, color_name)
			VALUES ($1, $2, $3, $4)
			RETURNING id::text, created_at`,
			mailboxID, name, color, colorName).Scan(&newID, &createdAt)
		if err != nil {
			if strings.Contains(strings.ToLower(err.Error()), "unique") || strings.Contains(err.Error(), "idx_mailbox_labels_unique_name") {
				http.Error(w, "label with this name already exists", http.StatusConflict)
				return
			}
			http.Error(w, "failed to create label", http.StatusInternalServerError)
			return
		}

		resp := map[string]interface{}{
			"id":         newID,
			"mailbox_id": mailboxID,
			"name":       name,
			"color":      color,
			"color_name": colorName,
			"created_at": createdAt.Format(time.RFC3339),
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(resp)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}
