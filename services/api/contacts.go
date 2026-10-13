package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var (
	contactEmailRegex = regexp.MustCompile(`^[a-zA-Z0-9.!#$%&'*+/=?^_` + "`" + `{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$`)
	contactGroupRegex = regexp.MustCompile(`^[a-zA-Z0-9 _-]*$`)
)

type ContactRecord struct {
	ID        string `json:"id,omitempty"`
	MailboxID string `json:"mailbox_id,omitempty"`
	Name      string `json:"name"`
	Email     string `json:"email"`
	Notes     string `json:"notes,omitempty"`
	GroupName string `json:"group_name,omitempty"`
	Version   int    `json:"version,omitempty"`
	CreatedAt string `json:"created_at,omitempty"`
	UpdatedAt string `json:"updated_at,omitempty"`
}

func contactResponse(id, mailboxID, name, email, notes, groupName string, envelope []byte, version int, createdAt, updatedAt time.Time) map[string]interface{} {
	resp := map[string]interface{}{
		"id":         id,
		"mailbox_id": mailboxID,
		"name":       name,
		"email":      email,
		"notes":      notes,
		"group_name": groupName,
		"version":    version,
		"created_at": createdAt.Format(time.RFC3339),
		"updated_at": updatedAt.Format(time.RFC3339),
	}
	if len(envelope) > 0 {
		resp["encrypted_envelope"] = base64.StdEncoding.EncodeToString(envelope)
	}
	return resp
}

func validateContactFields(name, email, notes, groupName string, isCreate bool) error {
	if isCreate || name != "" {
		if len(name) < 1 || len(name) > 200 {
			return fmt.Errorf("name must be between 1 and 200 characters")
		}
	}
	if isCreate || email != "" {
		if len(email) < 3 || len(email) > 254 || !contactEmailRegex.MatchString(email) {
			return fmt.Errorf("invalid email format")
		}
	}
	if len(notes) > 2000 {
		return fmt.Errorf("notes must be at most 2000 characters")
	}
	if len(groupName) > 50 || !contactGroupRegex.MatchString(groupName) {
		return fmt.Errorf("group name must be 0-50 alphanumeric, space, hyphen or underscore characters")
	}
	return nil
}

func contactsHandler(w http.ResponseWriter, r *http.Request) {
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

	contactID := r.PathValue("contact_id")
	if contactID == "import" {
		contactsImportHandler(w, r)
		return
	}
	if contactID == "export" {
		contactsExportHandler(w, r)
		return
	}

	if contactID != "" {
		if _, err := uuid.Parse(contactID); err != nil {
			http.Error(w, "contact ID must be UUID", http.StatusBadRequest)
			return
		}
		switch r.Method {
		case http.MethodGet:
			var id, name, email, notes, groupName string
			var envelope []byte
			var version int
			var createdAt, updatedAt time.Time
			var nameNull, emailNull, notesNull, groupNull *string
			err := conn.QueryRow(ctx, `
				SELECT id::text, COALESCE(name, ''), COALESCE(email, ''), COALESCE(notes, ''), COALESCE(group_name, ''),
				       encrypted_envelope, version, created_at, updated_at
				FROM contacts WHERE id=$1 AND mailbox_id=$2`, contactID, mailboxID).
				Scan(&id, &name, &email, &notes, &groupName, &envelope, &version, &createdAt, &updatedAt)
			_ = nameNull
			_ = emailNull
			_ = notesNull
			_ = groupNull
			if err == pgx.ErrNoRows {
				http.Error(w, "contact not found", http.StatusNotFound)
				return
			}
			if err != nil {
				http.Error(w, "failed to get contact", http.StatusInternalServerError)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(contactResponse(id, mailboxID, name, email, notes, groupName, envelope, version, createdAt, updatedAt))
		case http.MethodPatch, http.MethodPut:
			contactUpdateOrPatchHandler(w, r, conn, ctx, mailboxID, contactID)
		case http.MethodDelete:
			tag, err := conn.Exec(ctx, `DELETE FROM contacts WHERE id=$1 AND mailbox_id=$2`, contactID, mailboxID)
			if err != nil {
				http.Error(w, "failed to delete contact", http.StatusInternalServerError)
				return
			}
			if tag.RowsAffected() == 0 {
				http.Error(w, "contact not found", http.StatusNotFound)
				return
			}
			w.WriteHeader(http.StatusNoContent)
		default:
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		}
		return
	}

	switch r.Method {
	case http.MethodPost:
		contactCreateHandler(w, r, conn, ctx, mailboxID)
	case http.MethodGet:
		searchQuery := strings.TrimSpace(r.URL.Query().Get("search"))
		if searchQuery == "" {
			searchQuery = strings.TrimSpace(r.URL.Query().Get("q"))
		}
		groupQuery := strings.TrimSpace(r.URL.Query().Get("group"))

		baseQuery := `
			SELECT id::text, COALESCE(name, ''), COALESCE(email, ''), COALESCE(notes, ''), COALESCE(group_name, ''),
			       encrypted_envelope, version, created_at, updated_at
			FROM contacts WHERE mailbox_id=$1`
		args := []interface{}{mailboxID}

		if searchQuery != "" {
			args = append(args, "%"+searchQuery+"%")
			baseQuery += fmt.Sprintf(` AND (name ILIKE $%d OR email ILIKE $%d OR notes ILIKE $%d)`, len(args), len(args), len(args))
		}
		if groupQuery != "" {
			args = append(args, groupQuery)
			baseQuery += fmt.Sprintf(` AND group_name=$%d`, len(args))
		}
		baseQuery += ` ORDER BY COALESCE(NULLIF(name, ''), email) ASC, updated_at DESC, id ASC`

		rows, err := conn.Query(ctx, baseQuery, args...)
		if err != nil {
			http.Error(w, "failed to list contacts", http.StatusInternalServerError)
			return
		}
		defer rows.Close()
		contacts := []map[string]interface{}{}
		for rows.Next() {
			var id, name, email, notes, groupName string
			var envelope []byte
			var version int
			var createdAt, updatedAt time.Time
			if err := rows.Scan(&id, &name, &email, &notes, &groupName, &envelope, &version, &createdAt, &updatedAt); err != nil {
				http.Error(w, "failed to read contacts", http.StatusInternalServerError)
				return
			}
			contacts = append(contacts, contactResponse(id, mailboxID, name, email, notes, groupName, envelope, version, createdAt, updatedAt))
		}
		if err := rows.Err(); err != nil {
			http.Error(w, "failed to list contacts", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"contacts": contacts})
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func contactCreateHandler(w http.ResponseWriter, r *http.Request, conn *pgx.Conn, ctx context.Context, mailboxID string) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var raw map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Legacy ciphertext support
	if envRaw, hasEnv := raw["encrypted_envelope"]; hasEnv {
		envStr, _ := envRaw.(string)
		envelope, err := base64.StdEncoding.DecodeString(strings.TrimSpace(envStr))
		if err != nil || len(envelope) < 29 || envelope[0] != 0x01 {
			http.Error(w, "invalid encrypted_envelope", http.StatusBadRequest)
			return
		}
		var id string
		var version int
		var createdAt, updatedAt time.Time
		err = conn.QueryRow(ctx, `
			INSERT INTO contacts (mailbox_id, encrypted_envelope)
			VALUES ($1,$2)
			RETURNING id::text, version, created_at, updated_at`, mailboxID, envelope).
			Scan(&id, &version, &createdAt, &updatedAt)
		if err != nil {
			http.Error(w, "failed to create contact", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(contactResponse(id, mailboxID, "", "", "", "", envelope, version, createdAt, updatedAt))
		return
	}

	name, _ := raw["name"].(string)
	email, _ := raw["email"].(string)
	notes, _ := raw["notes"].(string)
	groupName, _ := raw["group_name"].(string)

	name = strings.TrimSpace(name)
	email = strings.TrimSpace(email)
	notes = strings.TrimSpace(notes)
	groupName = strings.TrimSpace(groupName)

	if err := validateContactFields(name, email, notes, groupName, true); err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	// Check duplicate email (case-insensitive) within this mailbox
	var existingID string
	err := conn.QueryRow(ctx, `SELECT id::text FROM contacts WHERE mailbox_id=$1 AND LOWER(email)=LOWER($2)`, mailboxID, email).Scan(&existingID)
	if err == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]string{"error": "contact_exists"})
		return
	} else if err != pgx.ErrNoRows {
		http.Error(w, "failed to check duplicate contact", http.StatusInternalServerError)
		return
	}

	var id string
	var version int
	var createdAt, updatedAt time.Time
	err = conn.QueryRow(ctx, `
		INSERT INTO contacts (mailbox_id, name, email, notes, group_name)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id::text, version, created_at, updated_at`,
		mailboxID, name, email, notes, groupName).
		Scan(&id, &version, &createdAt, &updatedAt)
	if err != nil {
		http.Error(w, "failed to create contact", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(contactResponse(id, mailboxID, name, email, notes, groupName, nil, version, createdAt, updatedAt))
}

func contactUpdateOrPatchHandler(w http.ResponseWriter, r *http.Request, conn *pgx.Conn, ctx context.Context, mailboxID, contactID string) {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var raw map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Legacy ciphertext support
	if envRaw, hasEnv := raw["encrypted_envelope"]; hasEnv {
		envStr, _ := envRaw.(string)
		envelope, err := base64.StdEncoding.DecodeString(strings.TrimSpace(envStr))
		if err != nil || len(envelope) < 29 || envelope[0] != 0x01 {
			http.Error(w, "invalid encrypted_envelope", http.StatusBadRequest)
			return
		}
		var expectedVersion int
		if v, ok := raw["version"].(float64); ok {
			expectedVersion = int(v)
		}
		if expectedVersion < 1 {
			http.Error(w, "version must be at least 1", http.StatusBadRequest)
			return
		}
		var id string
		var nextVersion int
		var createdAt, updatedAt time.Time
		err = conn.QueryRow(ctx, `
			UPDATE contacts SET encrypted_envelope=$1, version=version+1, updated_at=now()
			WHERE id=$2 AND mailbox_id=$3 AND version=$4
			RETURNING id::text, version, created_at, updated_at`,
			envelope, contactID, mailboxID, expectedVersion).
			Scan(&id, &nextVersion, &createdAt, &updatedAt)
		if err == pgx.ErrNoRows {
			var currentVersion int
			versionErr := conn.QueryRow(ctx, `SELECT version FROM contacts WHERE id=$1 AND mailbox_id=$2`, contactID, mailboxID).Scan(&currentVersion)
			if versionErr == pgx.ErrNoRows {
				http.Error(w, "contact not found", http.StatusNotFound)
				return
			}
			if versionErr != nil {
				http.Error(w, "failed to check contact version", http.StatusInternalServerError)
				return
			}
			http.Error(w, "contact version conflict", http.StatusConflict)
			return
		}
		if err != nil {
			http.Error(w, "failed to update contact", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(contactResponse(id, mailboxID, "", "", "", "", envelope, nextVersion, createdAt, updatedAt))
		return
	}

	// Fetch existing contact to ensure ownership and existence
	var curName, curEmail, curNotes, curGroup string
	var curVersion int
	var curCreatedAt, curUpdatedAt time.Time
	err := conn.QueryRow(ctx, `
		SELECT COALESCE(name, ''), COALESCE(email, ''), COALESCE(notes, ''), COALESCE(group_name, ''),
		       version, created_at, updated_at
		FROM contacts WHERE id=$1 AND mailbox_id=$2`, contactID, mailboxID).
		Scan(&curName, &curEmail, &curNotes, &curGroup, &curVersion, &curCreatedAt, &curUpdatedAt)
	if err == pgx.ErrNoRows {
		http.Error(w, "contact not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, "failed to check contact", http.StatusInternalServerError)
		return
	}

	newName := curName
	if v, exists := raw["name"]; exists {
		s, _ := v.(string)
		newName = strings.TrimSpace(s)
		if len(newName) < 1 || len(newName) > 200 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "name must be between 1 and 200 characters"})
			return
		}
	}

	newEmail := curEmail
	if v, exists := raw["email"]; exists {
		s, _ := v.(string)
		newEmail = strings.TrimSpace(s)
		if len(newEmail) < 3 || len(newEmail) > 254 || !contactEmailRegex.MatchString(newEmail) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "invalid email format"})
			return
		}
		// Duplicate check if changed
		if !strings.EqualFold(newEmail, curEmail) {
			var dupID string
			dupErr := conn.QueryRow(ctx, `SELECT id::text FROM contacts WHERE mailbox_id=$1 AND LOWER(email)=LOWER($2) AND id != $3`, mailboxID, newEmail, contactID).Scan(&dupID)
			if dupErr == nil {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusConflict)
				json.NewEncoder(w).Encode(map[string]string{"error": "contact_exists"})
				return
			} else if dupErr != pgx.ErrNoRows {
				http.Error(w, "failed to check duplicate contact", http.StatusInternalServerError)
				return
			}
		}
	}

	newNotes := curNotes
	if v, exists := raw["notes"]; exists {
		s, _ := v.(string)
		newNotes = strings.TrimSpace(s)
		if len(newNotes) > 2000 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "notes must be at most 2000 characters"})
			return
		}
	}

	newGroup := curGroup
	if v, exists := raw["group_name"]; exists {
		s, _ := v.(string)
		newGroup = strings.TrimSpace(s)
		if len(newGroup) > 50 || !contactGroupRegex.MatchString(newGroup) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(map[string]string{"error": "group name must be 0-50 alphanumeric characters"})
			return
		}
	}

	var updatedVersion int
	var updatedTime time.Time
	err = conn.QueryRow(ctx, `
		UPDATE contacts SET
			name = $1, email = $2, notes = $3, group_name = $4,
			version = version + 1, updated_at = now()
		WHERE id=$5 AND mailbox_id=$6
		RETURNING version, updated_at`,
		newName, newEmail, newNotes, newGroup, contactID, mailboxID).
		Scan(&updatedVersion, &updatedTime)
	if err != nil {
		http.Error(w, "failed to update contact", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(contactResponse(contactID, mailboxID, newName, newEmail, newNotes, newGroup, nil, updatedVersion, curCreatedAt, updatedTime))
}

func contactsImportHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
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

	_, _, _, mailboxID, ok := resolveDraftMailbox(w, r, conn, ctx)
	if !ok {
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 10<<20) // 10MB limit
	var req struct {
		Format string `json:"format"`
		Data   string `json:"data"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	fileBytes, err := base64.StdEncoding.DecodeString(strings.TrimSpace(req.Data))
	if err != nil {
		// Try raw if not base64
		fileBytes = []byte(req.Data)
	}

	var parsedContacts []ContactRecord
	var parseErrors []string

	format := strings.ToLower(strings.TrimSpace(req.Format))
	if format == "csv" {
		parsedContacts, parseErrors = parseCSVContacts(fileBytes)
	} else if format == "vcard" || format == "vcf" {
		parsedContacts, parseErrors = parseVCardContacts(fileBytes)
	} else {
		http.Error(w, "invalid format: must be csv or vcard", http.StatusBadRequest)
		return
	}

	// Fetch existing emails in mailbox to skip duplicates
	existingRows, err := conn.Query(ctx, `SELECT LOWER(email) FROM contacts WHERE mailbox_id=$1 AND email IS NOT NULL`, mailboxID)
	if err != nil {
		http.Error(w, "failed to query existing contacts", http.StatusInternalServerError)
		return
	}
	defer existingRows.Close()

	existingSet := make(map[string]bool)
	for existingRows.Next() {
		var em string
		if err := existingRows.Scan(&em); err == nil {
			existingSet[strings.ToLower(em)] = true
		}
	}

	imported := 0
	skipped := 0
	finalErrors := append([]string{}, parseErrors...)

	for _, c := range parsedContacts {
		lowerEmail := strings.ToLower(strings.TrimSpace(c.Email))
		if lowerEmail == "" {
			finalErrors = append(finalErrors, fmt.Sprintf("invalid contact '%s': missing email", c.Name))
			continue
		}
		if existingSet[lowerEmail] {
			skipped++
			continue
		}
		if err := validateContactFields(c.Name, c.Email, c.Notes, c.GroupName, true); err != nil {
			finalErrors = append(finalErrors, fmt.Sprintf("contact '%s' (%s): %v", c.Name, c.Email, err))
			continue
		}

		_, err := conn.Exec(ctx, `
			INSERT INTO contacts (mailbox_id, name, email, notes, group_name)
			VALUES ($1, $2, $3, $4, $5)`,
			mailboxID, c.Name, c.Email, c.Notes, c.GroupName)
		if err != nil {
			// Might be concurrent duplicate
			skipped++
		} else {
			existingSet[lowerEmail] = true
			imported++
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"imported": imported,
		"skipped":  skipped,
		"errors":   finalErrors,
	})
}

func parseCSVContacts(data []byte) ([]ContactRecord, []string) {
	reader := csv.NewReader(bytes.NewReader(data))
	reader.TrimLeadingSpace = true
	reader.FieldsPerRecord = -1 // Allow variable number of fields

	records, err := reader.ReadAll()
	if err != nil {
		return nil, []string{"csv parse error: " + err.Error()}
	}
	if len(records) == 0 {
		return nil, nil
	}

	nameCol := -1
	emailCol := -1
	notesCol := -1
	groupCol := -1

	firstRow := records[0]
	hasHeader := false
	for i, col := range firstRow {
		norm := strings.ToLower(strings.TrimSpace(col))
		if norm == "name" || norm == "full name" || norm == "fn" || norm == "display name" {
			nameCol = i
			hasHeader = true
		} else if norm == "email" || norm == "e-mail" || norm == "email address" || norm == "mail" {
			emailCol = i
			hasHeader = true
		} else if norm == "notes" || norm == "note" || norm == "comment" || norm == "comments" {
			notesCol = i
			hasHeader = true
		} else if norm == "group" || norm == "group_name" || norm == "category" || norm == "categories" {
			groupCol = i
			hasHeader = true
		}
	}

	startRow := 0
	if hasHeader {
		startRow = 1
	} else {
		if len(firstRow) > 0 {
			nameCol = 0
		}
		if len(firstRow) > 1 {
			emailCol = 1
		}
		if len(firstRow) > 2 {
			notesCol = 2
		}
		if len(firstRow) > 3 {
			groupCol = 3
		}
	}

	var contacts []ContactRecord
	var errs []string

	for idx := startRow; idx < len(records); idx++ {
		row := records[idx]
		rowNum := idx + 1
		var name, email, notes, group string
		if nameCol >= 0 && nameCol < len(row) {
			name = strings.TrimSpace(row[nameCol])
		}
		if emailCol >= 0 && emailCol < len(row) {
			email = strings.TrimSpace(row[emailCol])
		}
		if notesCol >= 0 && notesCol < len(row) {
			notes = strings.TrimSpace(row[notesCol])
		}
		if groupCol >= 0 && groupCol < len(row) {
			group = strings.TrimSpace(row[groupCol])
		}

		if email == "" {
			errs = append(errs, fmt.Sprintf("row %d: missing email", rowNum))
			continue
		}
		if !contactEmailRegex.MatchString(email) {
			errs = append(errs, fmt.Sprintf("row %d: invalid email", rowNum))
			continue
		}
		if name == "" {
			parts := strings.Split(email, "@")
			name = parts[0]
		}
		contacts = append(contacts, ContactRecord{
			Name:      name,
			Email:     email,
			Notes:     notes,
			GroupName: group,
		})
	}
	return contacts, errs
}

func parseVCardContacts(data []byte) ([]ContactRecord, []string) {
	raw := string(data)
	raw = strings.ReplaceAll(raw, "\r\n", "\n")
	raw = strings.ReplaceAll(raw, "\r", "\n")
	lines := strings.Split(raw, "\n")

	var unfolded []string
	for _, line := range lines {
		if len(line) > 0 && (line[0] == ' ' || line[0] == '\t') {
			if len(unfolded) > 0 {
				unfolded[len(unfolded)-1] += strings.TrimLeft(line, " \t")
			}
		} else {
			unfolded = append(unfolded, line)
		}
	}

	var contacts []ContactRecord
	var errs []string
	var curName, curEmail, curNotes, curGroup string
	inVCard := false
	cardIndex := 0

	for _, line := range unfolded {
		line = strings.TrimSpace(line)
		if strings.EqualFold(line, "BEGIN:VCARD") {
			inVCard = true
			curName = ""
			curEmail = ""
			curNotes = ""
			curGroup = ""
			cardIndex++
			continue
		}
		if strings.EqualFold(line, "END:VCARD") {
			if inVCard {
				if curEmail == "" {
					errs = append(errs, fmt.Sprintf("card %d: missing email", cardIndex))
				} else if !contactEmailRegex.MatchString(curEmail) {
					errs = append(errs, fmt.Sprintf("card %d: invalid email", cardIndex))
				} else {
					if curName == "" {
						parts := strings.Split(curEmail, "@")
						curName = parts[0]
					}
					contacts = append(contacts, ContactRecord{
						Name:      curName,
						Email:     curEmail,
						Notes:     curNotes,
						GroupName: curGroup,
					})
				}
				inVCard = false
			}
			continue
		}
		if !inVCard {
			continue
		}

		colonIdx := strings.Index(line, ":")
		if colonIdx == -1 {
			continue
		}
		key := strings.ToUpper(strings.TrimSpace(line[:colonIdx]))
		val := strings.TrimSpace(line[colonIdx+1:])

		// Strip parameters like EMAIL;TYPE=INTERNET:user@domain.com
		if semiIdx := strings.Index(key, ";"); semiIdx != -1 {
			key = key[:semiIdx]
		}

		switch key {
		case "FN":
			curName = val
		case "N":
			if curName == "" {
				parts := strings.Split(val, ";")
				var nameParts []string
				for i := len(parts) - 1; i >= 0; i-- {
					p := strings.TrimSpace(parts[i])
					if p != "" {
						nameParts = append(nameParts, p)
					}
				}
				if len(nameParts) > 0 {
					curName = strings.Join(nameParts, " ")
				}
			}
		case "EMAIL":
			curEmail = val
		case "NOTE":
			curNotes = val
		case "CATEGORIES", "ORG", "X-GROUP":
			curGroup = val
		}
	}

	return contacts, errs
}

func contactsExportHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
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

	_, _, _, mailboxID, ok := resolveDraftMailbox(w, r, conn, ctx)
	if !ok {
		return
	}

	format := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("format")))
	if format == "" {
		format = "csv"
	}

	rows, err := conn.Query(ctx, `
		SELECT COALESCE(name, ''), COALESCE(email, ''), COALESCE(notes, ''), COALESCE(group_name, '')
		FROM contacts WHERE mailbox_id=$1 AND email IS NOT NULL AND email != ''
		ORDER BY COALESCE(NULLIF(name, ''), email) ASC, id ASC`, mailboxID)
	if err != nil {
		http.Error(w, "failed to query contacts", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type exportItem struct {
		name, email, notes, group string
	}
	var items []exportItem
	for rows.Next() {
		var it exportItem
		if err := rows.Scan(&it.name, &it.email, &it.notes, &it.group); err == nil {
			items = append(items, it)
		}
	}

	if format == "vcard" || format == "vcf" {
		w.Header().Set("Content-Type", "text/vcard; charset=utf-8")
		w.Header().Set("Content-Disposition", "attachment; filename=\"contacts.vcf\"")
		var buf bytes.Buffer
		for _, it := range items {
			buf.WriteString("BEGIN:VCARD\r\n")
			buf.WriteString("VERSION:3.0\r\n")
			buf.WriteString(fmt.Sprintf("FN:%s\r\n", it.name))
			buf.WriteString(fmt.Sprintf("EMAIL:%s\r\n", it.email))
			if it.notes != "" {
				buf.WriteString(fmt.Sprintf("NOTE:%s\r\n", it.notes))
			}
			if it.group != "" {
				buf.WriteString(fmt.Sprintf("CATEGORIES:%s\r\n", it.group))
			}
			buf.WriteString("END:VCARD\r\n")
		}
		w.Write(buf.Bytes())
		return
	}

	// Default CSV export
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", "attachment; filename=\"contacts.csv\"")
	csvWriter := csv.NewWriter(w)
	_ = csvWriter.Write([]string{"Name", "Email", "Notes", "Group"})
	for _, it := range items {
		_ = csvWriter.Write([]string{it.name, it.email, it.notes, it.group})
	}
	csvWriter.Flush()
}
