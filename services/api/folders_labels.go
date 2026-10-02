package main

import (
	"context"
	"encoding/json"
	"fmt"
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
	Name          string  `json:"name"`
	ParentLabelID *string `json:"parent_label_id,omitempty"`
	SortOrder     *int    `json:"sort_order,omitempty"`
	Color         *string `json:"color,omitempty"`
	ColorName     *string `json:"color_name,omitempty"`
}

type UpdateLabelRequest struct {
	Name          *string `json:"name,omitempty"`
	ParentLabelID *string `json:"parent_label_id,omitempty"`
	SortOrder     *int    `json:"sort_order,omitempty"`
	Color         *string `json:"color,omitempty"`
	ColorName     *string `json:"color_name,omitempty"`
}

type MailboxLabelResponse struct {
	ID            string  `json:"id"`
	MailboxID     string  `json:"mailbox_id"`
	Name          string  `json:"name"`
	Color         string  `json:"color"`
	ColorName     string  `json:"color_name"`
	CreatedAt     string  `json:"created_at"`
	ParentLabelID *string `json:"parent_label_id,omitempty"`
	SortOrder     int     `json:"sort_order"`
	Path          string  `json:"path"`
	UnreadCount   int     `json:"unread_count"`
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

type rawLabelRecord struct {
	id            string
	mailboxID     string
	name          string
	color         string
	colorName     string
	createdAt     time.Time
	parentLabelID *string
	sortOrder     int
}

func fetchRawLabels(ctx context.Context, conn *pgx.Conn, mailboxID string) ([]rawLabelRecord, map[string]*rawLabelRecord, error) {
	rows, err := conn.Query(ctx, `
		SELECT id::text, mailbox_id::text, name, color, color_name, created_at, parent_label_id::text, sort_order
		FROM mailbox_labels
		WHERE mailbox_id=$1
		ORDER BY sort_order ASC, created_at ASC`, mailboxID)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	var records []rawLabelRecord
	byID := make(map[string]*rawLabelRecord)
	for rows.Next() {
		var r rawLabelRecord
		var pid *string
		if err := rows.Scan(&r.id, &r.mailboxID, &r.name, &r.color, &r.colorName, &r.createdAt, &pid, &r.sortOrder); err != nil {
			return nil, nil, err
		}
		r.parentLabelID = pid
		records = append(records, r)
	}
	for i := range records {
		byID[records[i].id] = &records[i]
	}
	return records, byID, nil
}

// computeLabelDepth returns the 1-indexed depth of a label given its parentLabelID.
// A root-level label (parentLabelID == nil) has depth 1.
func computeLabelDepth(parentID *string, byID map[string]*rawLabelRecord) (int, error) {
	depth := 1
	curID := parentID
	visited := make(map[string]bool)
	for curID != nil && *curID != "" {
		depth++
		if depth > 20 {
			return depth, fmt.Errorf("cycle detected or excessive depth")
		}
		p, exists := byID[*curID]
		if !exists {
			return depth, fmt.Errorf("parent label %s not found", *curID)
		}
		if visited[p.id] {
			return depth, fmt.Errorf("cycle detected in label hierarchy")
		}
		visited[p.id] = true
		curID = p.parentLabelID
	}
	return depth, nil
}

// computeLabelPath returns the '/' separated path e.g. "Work/ProjectA".
func computeLabelPath(lbl rawLabelRecord, byID map[string]*rawLabelRecord) string {
	parts := []string{lbl.name}
	curID := lbl.parentLabelID
	visited := map[string]bool{lbl.id: true}
	for curID != nil && *curID != "" {
		p, exists := byID[*curID]
		if !exists || visited[p.id] {
			break
		}
		visited[p.id] = true
		parts = append([]string{p.name}, parts...)
		curID = p.parentLabelID
	}
	return strings.Join(parts, "/")
}

// getSubtreeLabelIDs collects rootID and all its descendant label IDs.
func getSubtreeLabelIDs(rootID string, childrenMap map[string][]string) []string {
	var ids []string
	var walk func(id string)
	walk = func(id string) {
		ids = append(ids, id)
		for _, childID := range childrenMap[id] {
			walk(childID)
		}
	}
	walk(rootID)
	return ids
}

// getMaxSubtreeHeight returns 0 if id has no children, 1 if direct children have no children, etc.
func getMaxSubtreeHeight(id string, childrenMap map[string][]string) int {
	children := childrenMap[id]
	if len(children) == 0 {
		return 0
	}
	maxH := 0
	for _, ch := range children {
		h := 1 + getMaxSubtreeHeight(ch, childrenMap)
		if h > maxH {
			maxH = h
		}
	}
	return maxH
}

func buildLabelsResponse(ctx context.Context, conn *pgx.Conn, mailboxID string) ([]MailboxLabelResponse, error) {
	records, byID, err := fetchRawLabels(ctx, conn, mailboxID)
	if err != nil {
		return nil, err
	}

	childrenMap := make(map[string][]string)
	for _, r := range records {
		if r.parentLabelID != nil && *r.parentLabelID != "" {
			childrenMap[*r.parentLabelID] = append(childrenMap[*r.parentLabelID], r.id)
		}
	}

	// Fetch unread messages per label (distinct unread messages not in trash)
	unreadRows, err := conn.Query(ctx, `
		SELECT ml.label_id::text, ml.message_id::text
		FROM message_labels ml
		JOIN message_metadata m ON m.id = ml.message_id
		WHERE m.mailbox_id = $1
		  AND COALESCE(m.is_read, false) = false
		  AND COALESCE(m.folder, 'inbox') != 'trash'
	`, mailboxID)
	directUnreadMsgIDs := make(map[string]map[string]bool)
	if err == nil {
		defer unreadRows.Close()
		for unreadRows.Next() {
			var lid, mid string
			if err := unreadRows.Scan(&lid, &mid); err == nil {
				if directUnreadMsgIDs[lid] == nil {
					directUnreadMsgIDs[lid] = make(map[string]bool)
				}
				directUnreadMsgIDs[lid][mid] = true
			}
		}
	}

	resp := make([]MailboxLabelResponse, 0, len(records))
	for _, r := range records {
		path := computeLabelPath(r, byID)
		subtreeIDs := getSubtreeLabelIDs(r.id, childrenMap)
		subtreeMsgs := make(map[string]bool)
		for _, sid := range subtreeIDs {
			for mid := range directUnreadMsgIDs[sid] {
				subtreeMsgs[mid] = true
			}
		}

		resp = append(resp, MailboxLabelResponse{
			ID:            r.id,
			MailboxID:     r.mailboxID,
			Name:          r.name,
			Color:         r.color,
			ColorName:     r.colorName,
			CreatedAt:     r.createdAt.Format(time.RFC3339),
			ParentLabelID: r.parentLabelID,
			SortOrder:     r.sortOrder,
			Path:          path,
			UnreadCount:   len(subtreeMsgs),
		})
	}
	return resp, nil
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
			publishMailboxEvent(ctx, MailboxEvent{
				Type:      "label.deleted",
				MailboxID: mailboxID,
				MessageID: labelID,
			})
			w.WriteHeader(http.StatusNoContent)
			return
		}

		if r.Method == http.MethodPatch || r.Method == http.MethodPut {
			var req UpdateLabelRequest
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				http.Error(w, "invalid request body", http.StatusBadRequest)
				return
			}

			records, byID, err := fetchRawLabels(ctx, conn, mailboxID)
			if err != nil {
				http.Error(w, "failed to inspect labels", http.StatusInternalServerError)
				return
			}
			targetLabel, exists := byID[labelID]
			if !exists {
				http.Error(w, "label not found", http.StatusNotFound)
				return
			}

			childrenMap := make(map[string][]string)
			for _, rec := range records {
				if rec.parentLabelID != nil && *rec.parentLabelID != "" {
					childrenMap[*rec.parentLabelID] = append(childrenMap[*rec.parentLabelID], rec.id)
				}
			}

			name := targetLabel.name
			if req.Name != nil {
				trimmed := strings.TrimSpace(*req.Name)
				if trimmed == "" || len(trimmed) > 60 {
					http.Error(w, "name must be between 1 and 60 characters", http.StatusBadRequest)
					return
				}
				name = trimmed
			}

			color := targetLabel.color
			if req.Color != nil && strings.TrimSpace(*req.Color) != "" {
				color = strings.TrimSpace(*req.Color)
			}
			colorName := targetLabel.colorName
			if req.ColorName != nil && strings.TrimSpace(*req.ColorName) != "" {
				colorName = strings.TrimSpace(*req.ColorName)
			}
			sortOrder := targetLabel.sortOrder
			if req.SortOrder != nil {
				sortOrder = *req.SortOrder
			}

			parentUUID := targetLabel.parentLabelID
			if req.ParentLabelID != nil {
				pVal := strings.TrimSpace(*req.ParentLabelID)
				if pVal == "" || pVal == "null" || pVal == "00000000-0000-0000-0000-000000000000" {
					parentUUID = nil
				} else {
					if _, err := uuid.Parse(pVal); err != nil {
						http.Error(w, "parent_label_id must be a valid UUID", http.StatusBadRequest)
						return
					}
					if pVal == labelID {
						http.Error(w, "cannot reparent label into itself", http.StatusBadRequest)
						return
					}
					newParent, pExists := byID[pVal]
					if !pExists {
						http.Error(w, "parent label not found", http.StatusBadRequest)
						return
					}

					// Cycle check: verify target label is not an ancestor of newParent
					curr := newParent
					visited := map[string]bool{curr.id: true}
					for curr.parentLabelID != nil && *curr.parentLabelID != "" {
						if *curr.parentLabelID == labelID {
							http.Error(w, "cannot reparent label into its own descendant (cycle detected)", http.StatusBadRequest)
							return
						}
						p, ok := byID[*curr.parentLabelID]
						if !ok || visited[p.id] {
							break
						}
						visited[p.id] = true
						curr = p
					}

					// Max depth check: new parent depth + 1 + subtree height of label <= 5
					parentDepth, _ := computeLabelDepth(&pVal, byID)
					subtreeHeight := getMaxSubtreeHeight(labelID, childrenMap)
					if parentDepth+subtreeHeight > 5 {
						http.Error(w, "maximum label nesting depth of 5 exceeded", http.StatusBadRequest)
						return
					}
					parentUUID = &pVal
				}
			}

			// Sibling uniqueness check
			for _, rec := range records {
				if rec.id == labelID {
					continue
				}
				sameParent := false
				if parentUUID == nil && rec.parentLabelID == nil {
					sameParent = true
				} else if parentUUID != nil && rec.parentLabelID != nil && *parentUUID == *rec.parentLabelID {
					sameParent = true
				}
				if sameParent && strings.EqualFold(rec.name, name) {
					http.Error(w, "label with this name already exists under the same parent", http.StatusBadRequest)
					return
				}
			}

			tag, err := conn.Exec(ctx, `
				UPDATE mailbox_labels
				SET name=$1, color=$2, color_name=$3, parent_label_id=$4, sort_order=$5
				WHERE id=$6 AND mailbox_id=$7`,
				name, color, colorName, parentUUID, sortOrder, labelID, mailboxID)
			if err != nil {
				if strings.Contains(strings.ToLower(err.Error()), "sibling_name") || strings.Contains(strings.ToLower(err.Error()), "unique") {
					http.Error(w, "label with this name already exists under the same parent", http.StatusBadRequest)
					return
				}
				http.Error(w, "failed to update label", http.StatusInternalServerError)
				return
			}
			if tag.RowsAffected() == 0 {
				http.Error(w, "label not found", http.StatusNotFound)
				return
			}

			allUpdated, err := buildLabelsResponse(ctx, conn, mailboxID)
			if err != nil {
				http.Error(w, "failed to build updated response", http.StatusInternalServerError)
				return
			}
			var updatedResp MailboxLabelResponse
			for _, l := range allUpdated {
				if l.ID == labelID {
					updatedResp = l
					break
				}
			}

			publishMailboxEvent(ctx, MailboxEvent{
				Type:      "label.updated",
				MailboxID: mailboxID,
				MessageID: labelID,
			})

			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(updatedResp)
			return
		}

		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	switch r.Method {
	case http.MethodGet:
		labels, err := buildLabelsResponse(ctx, conn, mailboxID)
		if err != nil {
			http.Error(w, "failed to list labels", http.StatusInternalServerError)
			return
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

		records, byID, err := fetchRawLabels(ctx, conn, mailboxID)
		if err != nil {
			http.Error(w, "failed to inspect labels", http.StatusInternalServerError)
			return
		}

		var parentUUID *string
		if req.ParentLabelID != nil && strings.TrimSpace(*req.ParentLabelID) != "" {
			pid := strings.TrimSpace(*req.ParentLabelID)
			if _, err := uuid.Parse(pid); err != nil {
				http.Error(w, "parent_label_id must be a valid UUID", http.StatusBadRequest)
				return
			}
			parentRec, exists := byID[pid]
			if !exists {
				http.Error(w, "parent label not found", http.StatusBadRequest)
				return
			}
			// Depth validation: root is 1, child of root is 2, ..., max depth is 5.
			newDepth, err := computeLabelDepth(&parentRec.id, byID)
			if err != nil || newDepth > 5 {
				http.Error(w, "maximum label nesting depth of 5 exceeded", http.StatusBadRequest)
				return
			}
			parentUUID = &pid
		}

		// Sibling uniqueness check: unique among siblings under same parent
		for _, rec := range records {
			sameParent := false
			if parentUUID == nil && rec.parentLabelID == nil {
				sameParent = true
			} else if parentUUID != nil && rec.parentLabelID != nil && *parentUUID == *rec.parentLabelID {
				sameParent = true
			}
			if sameParent && strings.EqualFold(rec.name, name) {
				http.Error(w, "label with this name already exists under the same parent", http.StatusBadRequest)
				return
			}
		}

		sortOrder := 0
		if req.SortOrder != nil {
			sortOrder = *req.SortOrder
		}
		color := "#9E725F"
		if req.Color != nil && strings.TrimSpace(*req.Color) != "" {
			color = strings.TrimSpace(*req.Color)
		}
		colorName := "Mocha"
		if req.ColorName != nil && strings.TrimSpace(*req.ColorName) != "" {
			colorName = strings.TrimSpace(*req.ColorName)
		}

		var newID string
		var createdAt time.Time
		err = conn.QueryRow(ctx, `
			INSERT INTO mailbox_labels (mailbox_id, name, color, color_name, parent_label_id, sort_order)
			VALUES ($1, $2, $3, $4, $5, $6)
			RETURNING id::text, created_at`,
			mailboxID, name, color, colorName, parentUUID, sortOrder).Scan(&newID, &createdAt)
		if err != nil {
			if strings.Contains(strings.ToLower(err.Error()), "sibling_name") || strings.Contains(strings.ToLower(err.Error()), "unique") {
				http.Error(w, "label with this name already exists under the same parent", http.StatusBadRequest)
				return
			}
			http.Error(w, "failed to create label", http.StatusInternalServerError)
			return
		}

		path := name
		if parentUUID != nil {
			if p, ok := byID[*parentUUID]; ok {
				path = computeLabelPath(*p, byID) + "/" + name
			}
		}

		resp := MailboxLabelResponse{
			ID:            newID,
			MailboxID:     mailboxID,
			Name:          name,
			Color:         color,
			ColorName:     colorName,
			CreatedAt:     createdAt.Format(time.RFC3339),
			ParentLabelID: parentUUID,
			SortOrder:     sortOrder,
			Path:          path,
			UnreadCount:   0,
		}

		publishMailboxEvent(ctx, MailboxEvent{
			Type:      "label.created",
			MailboxID: mailboxID,
			MessageID: newID,
		})

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(resp)

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}
