package main

// Evidence:
// - Route table: GET /v1/organizations/{org_id} (organizationGetHandler);
//   GET/POST /v1/organizations/{org_id}/mailboxes; GET /v1/mailboxes/{id};
//   GET/POST /v1/mailboxes/{id}/aliases.
// - tests/domain_mailbox_api.ps1 (10 behaviors): domain-gated mailbox create
//   201 with real WASM payload; DB exact-byte match of mailbox_pk,
//   mailbox_sk_wrapped, root_secrets.root_secret_wrapped; distinct roots per
//   mailbox; missing root_secret_wrapped -> 400; plaintext root_secret ->
//   400; GET mailbox -> 200; list -> 200; alias create -> 201, list -> 200,
//   duplicate -> 409.
// - ROADMAP_STATUS.md Step 7b/7c: mailboxesHandler POST validates
//   hexDecodeString for 162/122/64, rejects plaintext root_secret/mailbox_sk/
//   entropy/mnemonic/org_recovery_sk via raw map, requires id UUID +
//   root_secret_wrapped/mailbox_sk_wrapped/mailbox_pk, checks org_recovery_pk
//   32 bytes, domain verified + same org, active storage else 503
//   {"error":"storage_disconnected"}, INSERT root_secrets then mailboxes with
//   client UUID (AAD binding), no server crypto (no crand/ECDH/AES/HPKE/HKDF).
//   Private mode omits root_secret_wrapped; domain verification applies to
//   both modes; unverified domain -> 400.
// - apps/control-plane/src/lib/api/mailboxes.ts: GET org ->
//   {id,name,org_recovery_pk}; list -> {mailboxes:[...]}; create payload
//   {id,local_part,domain_id,mode,root_secret_wrapped?,mailbox_sk_wrapped,
//   mailbox_pk}; alias create {alias} / list.
// - infra/postgres/init/001_init.sql: mailboxes, aliases, mailbox_storage,
//   root_secrets, domains columns.
// - api.exe symbols: organizationGetHandler, mailboxesHandler,
//   mailboxGetHandler, mailboxAliasesHandler.
// Reconstruction judgments flagged inline.

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func organizationGetHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	orgID := r.PathValue("org_id")
	if orgID == "" {
		http.Error(w, "organization ID required", http.StatusBadRequest)
		return
	}
	if _, err := uuid.Parse(orgID); err != nil {
		http.Error(w, "organization ID must be UUID", http.StatusBadRequest)
		return
	}

	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "missing or invalid X-User-Id", http.StatusUnauthorized)
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

	var memberID string
	err = conn.QueryRow(ctx, `SELECT id::text FROM users WHERE id=$1 AND org_id=$2 AND is_active=true`, userID, orgID).Scan(&memberID)
	if err != nil {
		http.Error(w, "not authorized for this organization", http.StatusForbidden)
		return
	}
	var id, name string
	var recPk []byte
	err = conn.QueryRow(ctx, `SELECT id::text, name, org_recovery_pk FROM organizations WHERE id=$1`, orgID).Scan(&id, &name, &recPk)
	if err != nil {
		http.Error(w, "organization not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"id":              id,
		"name":            name,
		"org_recovery_pk": base64.StdEncoding.EncodeToString(recPk),
	})
}

func mailboxesHandler(w http.ResponseWriter, r *http.Request) {
	orgID := r.PathValue("org_id")
	if orgID == "" {
		http.Error(w, "organization ID required", http.StatusBadRequest)
		return
	}
	if _, err := uuid.Parse(orgID); err != nil {
		http.Error(w, "organization ID must be UUID", http.StatusBadRequest)
		return
	}

	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "missing or invalid X-User-Id", http.StatusUnauthorized)
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

	var memberID string
	err = conn.QueryRow(ctx, `SELECT id::text FROM users WHERE id=$1 AND org_id=$2 AND is_active=true`, userID, orgID).Scan(&memberID)
	if err != nil {
		http.Error(w, "not authorized for this organization", http.StatusForbidden)
		return
	}

	if r.Method == http.MethodGet {
		rows, err := conn.Query(ctx, `
			SELECT m.id::text, m.local_part, m.domain_id::text, m.mode, COALESCE(m.status, 'active'),
			       COALESCE(d.name, ''), COALESCE(m.wrapped_sk_org, ''), COALESCE(m.wrapped_sk_user, '')
			FROM mailboxes m
			LEFT JOIN domains d ON d.id = m.domain_id
			WHERE m.org_id=$1 AND m.is_active=true
			ORDER BY m.local_part
		`, orgID)
		if err != nil {
			http.Error(w, "failed to list mailboxes", http.StatusInternalServerError)
			return
		}
		defer rows.Close()
		mailboxes := []map[string]interface{}{}
		for rows.Next() {
			var id, localPart, domainID, mode, status, domainName, wrappedSkOrg, wrappedSkUser string
			if err := rows.Scan(&id, &localPart, &domainID, &mode, &status, &domainName, &wrappedSkOrg, &wrappedSkUser); err != nil {
				continue
			}
			email := localPart
			if domainName != "" {
				email = localPart + "@" + domainName
			}
			mailboxes = append(mailboxes, map[string]interface{}{
				"id":              id,
				"local_part":      localPart,
				"domain_id":       domainID,
				"domain_name":     domainName,
				"email":           email,
				"mode":            mode,
				"status":          status,
				"wrapped_sk_org":  wrappedSkOrg,
				"wrapped_sk_user": wrappedSkUser,
			})
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"mailboxes": mailboxes})
		return
	}

	if r.Method == http.MethodPost {
		r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
		bodyBytes, err := io.ReadAll(r.Body)
		if err != nil {
			if err.Error() == "http: request body too large" {
				http.Error(w, "request body too large", http.StatusRequestEntityTooLarge)
			} else {
				http.Error(w, "Invalid request body", http.StatusBadRequest)
			}
			return
		}
		var raw map[string]json.RawMessage
		if err := json.Unmarshal(bodyBytes, &raw); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}
		// Never accept plaintext key material; wrapped material only.
		for _, k := range []string{"root_secret", "mailbox_sk", "entropy", "mnemonic", "org_recovery_sk", "org_recovery_secret"} {
			if _, ok := raw[k]; ok {
				http.Error(w, "field "+k+" not allowed, send wrapped material only", http.StatusBadRequest)
				return
			}
		}
		var req struct {
			ID                string `json:"id"`
			LocalPart         string `json:"local_part"`
			DomainID          string `json:"domain_id"`
			Mode              string `json:"mode"`
			RootSecretWrapped string `json:"root_secret_wrapped"`
			MailboxSkWrapped  string `json:"mailbox_sk_wrapped"`
			MailboxPk         string `json:"mailbox_pk"`
		}
		if err := json.Unmarshal(bodyBytes, &req); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}
		localPart := strings.TrimSpace(req.LocalPart)
		domainID := strings.TrimSpace(req.DomainID)
		mode := strings.TrimSpace(req.Mode)
		if localPart == "" || domainID == "" {
			http.Error(w, "local_part and domain_id required", http.StatusBadRequest)
			return
		}
		if strings.Contains(localPart, "@") || strings.Contains(localPart, " ") {
			http.Error(w, "invalid local_part", http.StatusBadRequest)
			return
		}
		if mode == "" {
			mode = "private"
		}
		if mode != "org_managed" && mode != "private" {
			http.Error(w, "unsupported mode; only org_managed and private are supported", http.StatusBadRequest)
			return
		}
		idStr := strings.TrimSpace(req.ID)
		if idStr == "" {
			http.Error(w, "id required", http.StatusBadRequest)
			return
		}
		if _, err := uuid.Parse(idStr); err != nil {
			http.Error(w, "id must be UUID", http.StatusBadRequest)
			return
		}
		if _, err := uuid.Parse(domainID); err != nil {
			http.Error(w, "domain_id must be UUID", http.StatusBadRequest)
			return
		}
		// Validate canonical hex lengths: root wrap 162, sk wrap 122, pk 64.
		var rootWrapped []byte
		if mode == "org_managed" {
			if req.RootSecretWrapped == "" {
				http.Error(w, "root_secret_wrapped required for org_managed mailbox", http.StatusBadRequest)
				return
			}
			var err error
			rootWrapped, err = hexDecodeString(strings.TrimSpace(req.RootSecretWrapped))
			if err != nil || len(rootWrapped) != 81 {
				http.Error(w, "invalid root_secret_wrapped", http.StatusBadRequest)
				return
			}
		} else if req.RootSecretWrapped != "" {
			http.Error(w, "root_secret_wrapped must be omitted for private mailbox", http.StatusBadRequest)
			return
		}
		if req.MailboxSkWrapped == "" || req.MailboxPk == "" {
			http.Error(w, "mailbox_sk_wrapped and mailbox_pk required", http.StatusBadRequest)
			return
		}
		skWrapped, err := hexDecodeString(strings.TrimSpace(req.MailboxSkWrapped))
		if err != nil || len(skWrapped) != 61 {
			http.Error(w, "invalid mailbox_sk_wrapped", http.StatusBadRequest)
			return
		}
		mailboxPk, err := hexDecodeString(strings.TrimSpace(req.MailboxPk))
		if err != nil || len(mailboxPk) != 32 {
			http.Error(w, "invalid mailbox_pk", http.StatusBadRequest)
			return
		}
		// Domain must belong to this org and be verified.
		var verified bool
		err = conn.QueryRow(ctx, `SELECT is_verified FROM domains WHERE id=$1 AND org_id=$2`, domainID, orgID).Scan(&verified)
		if err != nil {
			http.Error(w, "domain not found", http.StatusNotFound)
			return
		}
		if !verified {
			http.Error(w, "domain not verified", http.StatusBadRequest)
			return
		}
		// Org-managed mailboxes require a 32-byte org recovery key for HPKE.
		if mode == "org_managed" {
			var recPk []byte
			err = conn.QueryRow(ctx, `SELECT org_recovery_pk FROM organizations WHERE id=$1`, orgID).Scan(&recPk)
			if err != nil || len(recPk) != 32 {
				http.Error(w, "organization recovery key not available", http.StatusBadRequest)
				return
			}
		}
		tx, err := conn.Begin(ctx)
		if err != nil {
			http.Error(w, "Failed to begin transaction", http.StatusInternalServerError)
			return
		}
		defer tx.Rollback(ctx)
		// Serialize per-org creation: the org row lock makes the quota
		// check below atomic with the inserts, so concurrent creates cannot
		// jointly overrun the plan limit (check-then-insert race).
		var orgExists string
		if err := tx.QueryRow(ctx, `SELECT id::text FROM organizations WHERE id=$1 FOR UPDATE`, orgID).Scan(&orgExists); err != nil {
			http.Error(w, "organization not found", http.StatusNotFound)
			return
		}
		// Quota check: enforce plan mailbox limits
		var usedMailboxes int
		_ = tx.QueryRow(ctx, `SELECT count(*) FROM mailboxes WHERE org_id=$1 AND is_active=true`, orgID).Scan(&usedMailboxes)
		var currentPlan string
		err = tx.QueryRow(ctx, `SELECT plan FROM organizations WHERE id=$1`, orgID).Scan(&currentPlan)
		if err != nil || currentPlan == "" {
			currentPlan = "solo"
		}
		spec, ok := PLAN_SPECS[currentPlan]
		if !ok {
			spec = PLAN_SPECS["solo"]
		}
		if usedMailboxes >= spec.MailboxLimit {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusPaymentRequired)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"error": "mailbox_limit_reached",
				"limit": spec.MailboxLimit,
				"plan":  spec.Plan,
			})
			return
		}

		// Mailbox creation requires an active storage connection; never fall
		// back to a default. Deleted/error connections do not qualify.
		var storageConnID string
		err = tx.QueryRow(ctx, `SELECT id::text FROM storage_connections WHERE org_id=$1 AND status='active' LIMIT 1`, orgID).Scan(&storageConnID)
		if err != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusServiceUnavailable)
			json.NewEncoder(w).Encode(map[string]string{"error": "storage_disconnected"})
			return
		}
		var rootSecretID string
		err = tx.QueryRow(ctx, `INSERT INTO root_secrets (root_secret_wrapped) VALUES ($1) RETURNING id::text`, rootWrapped).Scan(&rootSecretID)
		if err != nil {
			http.Error(w, "failed to store root secret", http.StatusInternalServerError)
			return
		}
		var newID string
		err = tx.QueryRow(ctx, `INSERT INTO mailboxes (id, org_id, user_id, domain_id, local_part, mode, root_secret_id, mailbox_sk_wrapped, mailbox_pk, wrapped_sk_user) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id::text`, idStr, orgID, userID, domainID, localPart, mode, rootSecretID, skWrapped, mailboxPk, strings.TrimSpace(req.MailboxSkWrapped)).Scan(&newID)
		if err != nil {
			if isUniqueViolation(err) {
				http.Error(w, "mailbox already exists", http.StatusConflict)
				return
			}
			http.Error(w, "failed to create mailbox", http.StatusInternalServerError)
			return
		}
		_, err = tx.Exec(ctx, `INSERT INTO mailbox_storage (mailbox_id, storage_connection_id, object_prefix, status) VALUES ($1, $2, $3, 'active')`, newID, storageConnID, "mailboxes/"+newID)
		if err != nil {
			http.Error(w, "failed to map mailbox storage", http.StatusInternalServerError)
			return
		}
		if err := tx.Commit(ctx); err != nil {
			http.Error(w, "failed to commit", http.StatusInternalServerError)
			return
		}
		auditLog(ctx, conn, orgID, userID, "mailbox_create", "mailbox", newID, map[string]interface{}{"local_part": localPart, "mode": mode})
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"id":         newID,
			"local_part": localPart,
			"domain_id":  domainID,
			"mode":       mode,
		})
		return
	}

	http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
}

func deleteMailbox(ctx context.Context, conn *pgx.Conn, orgID, mailboxID, actorUserID string) (string, error) {
	tx, err := conn.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("failed to begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	var localPart, domainID string
	var associatedUserID *string
	err = tx.QueryRow(ctx, `
		SELECT local_part, domain_id::text, user_id::text 
		FROM mailboxes 
		WHERE id=$1 AND org_id=$2 AND is_active=true 
		FOR UPDATE
	`, mailboxID, orgID).Scan(&localPart, &domainID, &associatedUserID)
	if err != nil {
		return "", err
	}

	// Unbind unique constraint: prefix local_part with deleted_<short_id>_<localPart>
	shortID := strings.ReplaceAll(mailboxID, "-", "")
	if len(shortID) > 8 {
		shortID = shortID[:8]
	}
	newLocalPart := fmt.Sprintf("deleted_%s_%s", shortID, localPart)
	if len(newLocalPart) > 100 {
		newLocalPart = newLocalPart[:100]
	}

	// 1. Soft-delete / deactivate the mailbox
	_, err = tx.Exec(ctx, `
		UPDATE mailboxes 
		SET is_active=false, status='suspended', local_part=$1, updated_at=now() 
		WHERE id=$2
	`, newLocalPart, mailboxID)
	if err != nil {
		return "", fmt.Errorf("failed to deactivate mailbox: %w", err)
	}

	// 2. Deactivate / remove aliases for this mailbox
	_, err = tx.Exec(ctx, `
		UPDATE aliases 
		SET is_active=false 
		WHERE mailbox_id=$1
	`, mailboxID)
	if err != nil {
		return "", fmt.Errorf("failed to deactivate aliases: %w", err)
	}

	// 3. Expire any unconsumed invitations for this mailbox
	_, _ = tx.Exec(ctx, `
		UPDATE account_invitations 
		SET expires_at=now() 
		WHERE mailbox_id=$1 AND consumed_at IS NULL
	`, mailboxID)

	// 4. Revoke bridge credentials for this mailbox
	_, _ = tx.Exec(ctx, `
		UPDATE bridge_credentials 
		SET revoked_at=now() 
		WHERE mailbox_id=$1 AND revoked_at IS NULL
	`, mailboxID)

	// 5. Revoke device access for this mailbox
	_, _ = tx.Exec(ctx, `
		UPDATE device_mailbox_access 
		SET is_active=false, revoked_at=now() 
		WHERE mailbox_id=$1 AND is_active=true
	`, mailboxID)

	// 6. Check associated user (if any)
	if associatedUserID != nil && *associatedUserID != "" {
		uID := *associatedUserID
		var otherCount int
		_ = tx.QueryRow(ctx, `
			SELECT count(*) FROM mailboxes 
			WHERE user_id=$1 AND id != $2 AND is_active=true
		`, uID, mailboxID).Scan(&otherCount)

		if otherCount == 0 {
			var uRole, uEmail string
			_ = tx.QueryRow(ctx, `SELECT role, email FROM users WHERE id=$1`, uID).Scan(&uRole, &uEmail)
			if uRole == "member" {
				deletedEmail := fmt.Sprintf("deleted_%s_%s", shortID, uEmail)
				if len(deletedEmail) > 254 {
					deletedEmail = deletedEmail[:254]
				}
				_, _ = tx.Exec(ctx, `
					UPDATE users 
					SET is_active=false, status='suspended', email=$1, updated_at=now() 
					WHERE id=$2
				`, deletedEmail, uID)
				_, _ = tx.Exec(ctx, `
					UPDATE sessions 
					SET revoked_at=now() 
					WHERE user_id=$1 AND revoked_at IS NULL
				`, uID)
			}
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("failed to commit mailbox deletion: %w", err)
	}

	auditLog(ctx, conn, orgID, actorUserID, "delete_mailbox", "mailbox", mailboxID, map[string]interface{}{
		"local_part": localPart,
		"domain_id":  domainID,
	})

	return localPart, nil
}

func mailboxItemHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodDelete {
		orgID := r.PathValue("org_id")
		mailboxID := r.PathValue("mailbox_id")
		if orgID == "" || mailboxID == "" {
			http.Error(w, "organization ID and mailbox ID required", http.StatusBadRequest)
			return
		}
		if _, err := uuid.Parse(orgID); err != nil {
			http.Error(w, "organization ID must be UUID", http.StatusBadRequest)
			return
		}
		if _, err := uuid.Parse(mailboxID); err != nil {
			http.Error(w, "mailbox ID must be UUID", http.StatusBadRequest)
			return
		}

		userID, ok := getAuthenticatedUserID(r)
		if !ok {
			http.Error(w, "missing or invalid X-User-Id", http.StatusUnauthorized)
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

		// Verify caller belongs to org
		var userOrgID string
		err = conn.QueryRow(ctx, `SELECT org_id::text FROM users WHERE id=$1 AND is_active=true`, userID).Scan(&userOrgID)
		if err != nil || userOrgID != orgID {
			http.Error(w, "not authorized for this organization", http.StatusForbidden)
			return
		}

		// Must be admin or owner
		if !isAdmin(userID, orgID, conn) {
			http.Error(w, "admin or owner role required to delete mailbox", http.StatusForbidden)
			return
		}

		_, err = deleteMailbox(ctx, conn, orgID, mailboxID, userID)
		if err != nil {
			if err == pgx.ErrNoRows {
				http.Error(w, "mailbox not found", http.StatusNotFound)
				return
			}
			http.Error(w, "failed to delete mailbox: "+err.Error(), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"id":     mailboxID,
			"status": "deleted",
		})
		return
	}

	http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
}

func mailboxGetHandler(w http.ResponseWriter, r *http.Request) {
	mailboxID := r.PathValue("mailbox_id")
	if mailboxID == "" {
		http.Error(w, "mailbox ID required", http.StatusBadRequest)
		return
	}
	if _, err := uuid.Parse(mailboxID); err != nil {
		http.Error(w, "mailbox ID must be UUID", http.StatusBadRequest)
		return
	}
	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "missing or invalid X-User-Id", http.StatusUnauthorized)
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
	// Verify user and get org
	var userOrgID string
	err = conn.QueryRow(ctx, `SELECT org_id::text FROM users WHERE id=$1 AND is_active=true`, userID).Scan(&userOrgID)
	if err != nil {
		http.Error(w, "not authorized", http.StatusForbidden)
		return
	}

	if r.Method == http.MethodDelete {
		if !isAdmin(userID, userOrgID, conn) {
			http.Error(w, "admin or owner role required to delete mailbox", http.StatusForbidden)
			return
		}
		_, err = deleteMailbox(ctx, conn, userOrgID, mailboxID, userID)
		if err != nil {
			if err == pgx.ErrNoRows {
				http.Error(w, "mailbox not found", http.StatusNotFound)
				return
			}
			http.Error(w, "failed to delete mailbox: "+err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"id":     mailboxID,
			"status": "deleted",
		})
		return
	}

	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var id, localPart, domainID, mode, orgID string
	var rootSecretID *string
	var mailboxSkWrapped []byte
	var mailboxPk []byte
	var mailboxSkVersion int
	var wrappedSkUser, previousWrappedSkUser *string
	err = conn.QueryRow(ctx, `SELECT id::text, local_part, domain_id::text, mode, org_id::text, root_secret_id::text, mailbox_sk_wrapped, mailbox_pk, mailbox_sk_version, wrapped_sk_user, previous_wrapped_sk_user FROM mailboxes WHERE id=$1`, mailboxID).Scan(&id, &localPart, &domainID, &mode, &orgID, &rootSecretID, &mailboxSkWrapped, &mailboxPk, &mailboxSkVersion, &wrappedSkUser, &previousWrappedSkUser)
	if err != nil {
		http.Error(w, "mailbox not found", http.StatusNotFound)
		return
	}
	if orgID != userOrgID {
		http.Error(w, "not authorized for this mailbox", http.StatusForbidden)
		return
	}
	wskStr := ""
	if wrappedSkUser != nil {
		wskStr = *wrappedSkUser
	}
	prevWskStr := ""
	if previousWrappedSkUser != nil {
		prevWskStr = *previousWrappedSkUser
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"mailbox_id":               id,
		"mode":                     mode,
		"mailbox_pk":               base64.StdEncoding.EncodeToString(mailboxPk),
		"mailbox_sk_wrapped":       base64.StdEncoding.EncodeToString(mailboxSkWrapped),
		"mailbox_sk_version":       mailboxSkVersion,
		"wrapped_sk_user":          wskStr,
		"previous_wrapped_sk_user": prevWskStr,
	})
}

func mailboxAliasesHandler(w http.ResponseWriter, r *http.Request) {
	mailboxID := r.PathValue("mailbox_id")
	if mailboxID == "" {
		http.Error(w, "mailbox ID required", http.StatusBadRequest)
		return
	}
	if _, err := uuid.Parse(mailboxID); err != nil {
		http.Error(w, "mailbox ID must be UUID", http.StatusBadRequest)
		return
	}
	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "missing or invalid X-User-Id", http.StatusUnauthorized)
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

	var userOrgID string
	err = conn.QueryRow(ctx, `SELECT org_id::text FROM users WHERE id=$1 AND is_active=true`, userID).Scan(&userOrgID)
	if err != nil {
		http.Error(w, "not authorized", http.StatusForbidden)
		return
	}
	var mailboxOrgID, mailboxDomainID string
	err = conn.QueryRow(ctx, `SELECT org_id::text, domain_id::text FROM mailboxes WHERE id=$1`, mailboxID).Scan(&mailboxOrgID, &mailboxDomainID)
	if err != nil {
		http.Error(w, "mailbox not found", http.StatusNotFound)
		return
	}
	if mailboxOrgID != userOrgID {
		http.Error(w, "not authorized for this mailbox", http.StatusForbidden)
		return
	}

	if r.Method == http.MethodGet {
		rows, err := conn.Query(ctx, `SELECT id::text, local_part, domain_id::text, is_active FROM aliases WHERE mailbox_id=$1 ORDER BY local_part`, mailboxID)
		if err != nil {
			http.Error(w, "failed to list aliases", http.StatusInternalServerError)
			return
		}
		defer rows.Close()
		aliases := []map[string]interface{}{}
		for rows.Next() {
			var id, localPart, domainID string
			var isActive bool
			if err := rows.Scan(&id, &localPart, &domainID, &isActive); err != nil {
				continue
			}
			aliases = append(aliases, map[string]interface{}{
				"id":         id,
				"local_part": localPart,
				"domain_id":  domainID,
				"is_active":  isActive,
			})
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{"aliases": aliases})
		return
	}

	if r.Method == http.MethodPost {
		r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
		var req struct {
			Alias     string `json:"alias"`
			LocalPart string `json:"local_part"`
			DomainID  string `json:"domain_id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}
		var aliasLocal, aliasDomainID string
		if strings.TrimSpace(req.Alias) != "" {
			aliasStr := strings.TrimSpace(req.Alias)
			parts := strings.SplitN(aliasStr, "@", 2)
			if len(parts) != 2 {
				http.Error(w, "invalid alias format", http.StatusBadRequest)
				return
			}
			aliasLocal = strings.TrimSpace(parts[0])
			aliasDomainName := strings.ToLower(strings.TrimSpace(parts[1]))
			if aliasLocal == "" || aliasDomainName == "" {
				http.Error(w, "invalid alias format", http.StatusBadRequest)
				return
			}
			// Lookup domain by name for same org
			err = conn.QueryRow(ctx, `SELECT id::text FROM domains WHERE name=$1 AND org_id=$2`, aliasDomainName, mailboxOrgID).Scan(&aliasDomainID)
			if err != nil {
				http.Error(w, "alias domain not found or not owned by organization", http.StatusBadRequest)
				return
			}
		} else {
			aliasLocal = strings.TrimSpace(req.LocalPart)
			aliasDomainID = strings.TrimSpace(req.DomainID)
			if aliasLocal == "" || aliasDomainID == "" {
				http.Error(w, "alias and domain required", http.StatusBadRequest)
				return
			}
			if _, err := uuid.Parse(aliasDomainID); err != nil {
				http.Error(w, "domain_id must be UUID", http.StatusBadRequest)
				return
			}
			var domOrg string
			err = conn.QueryRow(ctx, `SELECT org_id::text FROM domains WHERE id=$1`, aliasDomainID).Scan(&domOrg)
			if err != nil {
				http.Error(w, "domain not found", http.StatusNotFound)
				return
			}
			if domOrg != mailboxOrgID {
				http.Error(w, "domain does not belong to mailbox organization", http.StatusForbidden)
				return
			}
		}
		if len(aliasLocal) < 1 || len(aliasLocal) > 64 || strings.Contains(aliasLocal, "@") || strings.Contains(aliasLocal, " ") {
			http.Error(w, "invalid alias local_part", http.StatusBadRequest)
			return
		}

		// Quota check: enforce aliases per mailbox limit. Serialized under
		// the mailbox row lock so concurrent creates cannot jointly overrun
		// the limit (check-then-insert race).
		tx, err := conn.Begin(ctx)
		if err != nil {
			http.Error(w, "Failed to begin transaction", http.StatusInternalServerError)
			return
		}
		defer tx.Rollback(ctx)
		var mailboxExists string
		if err := tx.QueryRow(ctx, `SELECT id::text FROM mailboxes WHERE id=$1 FOR UPDATE`, mailboxID).Scan(&mailboxExists); err != nil {
			http.Error(w, "mailbox not found", http.StatusNotFound)
			return
		}
		var usedAliases int
		_ = tx.QueryRow(ctx, `SELECT count(*) FROM aliases WHERE mailbox_id=$1 AND is_active=true`, mailboxID).Scan(&usedAliases)
		var currentPlan string
		err = tx.QueryRow(ctx, `SELECT plan FROM organizations WHERE id=$1`, mailboxOrgID).Scan(&currentPlan)
		if err != nil || currentPlan == "" {
			currentPlan = "solo"
		}
		spec, ok := PLAN_SPECS[currentPlan]
		if !ok {
			spec = PLAN_SPECS["solo"]
		}
		if usedAliases >= spec.AliasesPerMail {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusPaymentRequired)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"error": "alias_limit_reached",
				"limit": spec.AliasesPerMail,
				"plan":  spec.Plan,
			})
			return
		}

		var newAliasID string
		err = tx.QueryRow(ctx, `INSERT INTO aliases (mailbox_id, local_part, domain_id) VALUES ($1, $2, $3) RETURNING id::text`, mailboxID, aliasLocal, aliasDomainID).Scan(&newAliasID)
		if err != nil {
			if isUniqueViolation(err) {
				http.Error(w, "alias already exists", http.StatusConflict)
				return
			}
			http.Error(w, "failed to create alias", http.StatusInternalServerError)
			return
		}
		if err := tx.Commit(ctx); err != nil {
			http.Error(w, "failed to commit", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"id":         newAliasID,
			"local_part": aliasLocal,
			"domain_id":  aliasDomainID,
		})
		return
	}

	http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
}

func organizationAliasesHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	orgID := r.PathValue("org_id")
	if orgID == "" {
		http.Error(w, "organization ID required", http.StatusBadRequest)
		return
	}
	if _, err := uuid.Parse(orgID); err != nil {
		http.Error(w, "organization ID must be UUID", http.StatusBadRequest)
		return
	}
	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "missing or invalid X-User-Id", http.StatusUnauthorized)
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

	var memberID string
	err = conn.QueryRow(ctx, `SELECT id::text FROM users WHERE id=$1 AND org_id=$2 AND is_active=true`, userID, orgID).Scan(&memberID)
	if err != nil {
		http.Error(w, "not authorized for this organization", http.StatusForbidden)
		return
	}

	rows, err := conn.Query(ctx, `
		SELECT 
			a.id::text, 
			a.mailbox_id::text, 
			m.local_part, 
			md.name,
			a.local_part, 
			a.domain_id::text, 
			ad.name, 
			a.is_active, 
			a.created_at
		FROM aliases a
		JOIN mailboxes m ON a.mailbox_id = m.id
		JOIN domains md ON m.domain_id = md.id
		JOIN domains ad ON a.domain_id = ad.id
		WHERE m.org_id = $1 AND m.is_active = true
		ORDER BY a.created_at DESC`, orgID)
	if err != nil {
		http.Error(w, "failed to list organization aliases", http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	aliases := []map[string]interface{}{}
	for rows.Next() {
		var id, mailboxID, mbLocal, mbDom, aliasLocal, domainID, aliasDom string
		var isActive bool
		var createdAt time.Time
		if err := rows.Scan(&id, &mailboxID, &mbLocal, &mbDom, &aliasLocal, &domainID, &aliasDom, &isActive, &createdAt); err != nil {
			continue
		}
		aliases = append(aliases, map[string]interface{}{
			"id":                 id,
			"mailbox_id":         mailboxID,
			"mailbox_local_part": mbLocal,
			"mailbox_address":    mbLocal + "@" + mbDom,
			"local_part":         aliasLocal,
			"domain_id":          domainID,
			"domain_name":        aliasDom,
			"alias_address":      aliasLocal + "@" + aliasDom,
			"is_active":          isActive,
			"created_at":         createdAt.Format(time.RFC3339),
		})
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{"aliases": aliases})
}

func mailboxAliasItemHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	mailboxID := r.PathValue("mailbox_id")
	aliasID := r.PathValue("alias_id")
	if mailboxID == "" || aliasID == "" {
		http.Error(w, "mailbox_id and alias_id required", http.StatusBadRequest)
		return
	}
	if _, err := uuid.Parse(mailboxID); err != nil {
		http.Error(w, "mailbox_id must be UUID", http.StatusBadRequest)
		return
	}
	if _, err := uuid.Parse(aliasID); err != nil {
		http.Error(w, "alias_id must be UUID", http.StatusBadRequest)
		return
	}

	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "missing or invalid X-User-Id", http.StatusUnauthorized)
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

	var userOrgID string
	err = conn.QueryRow(ctx, `SELECT org_id::text FROM users WHERE id=$1 AND is_active=true`, userID).Scan(&userOrgID)
	if err != nil {
		http.Error(w, "not authorized", http.StatusForbidden)
		return
	}

	var mailboxOrgID string
	err = conn.QueryRow(ctx, `SELECT org_id::text FROM mailboxes WHERE id=$1`, mailboxID).Scan(&mailboxOrgID)
	if err != nil {
		http.Error(w, "mailbox not found", http.StatusNotFound)
		return
	}
	if mailboxOrgID != userOrgID {
		http.Error(w, "not authorized for this mailbox", http.StatusForbidden)
		return
	}

	cmdTag, err := conn.Exec(ctx, `DELETE FROM aliases WHERE id=$1 AND mailbox_id=$2`, aliasID, mailboxID)
	if err != nil {
		http.Error(w, "failed to delete alias", http.StatusInternalServerError)
		return
	}
	if cmdTag.RowsAffected() == 0 {
		http.Error(w, "alias not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{"status": "deleted", "id": aliasID})
}

func mailboxPrivacyModeHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPut && r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	orgID := r.PathValue("org_id")
	mailboxID := r.PathValue("mailbox_id")
	if orgID == "" || mailboxID == "" {
		http.Error(w, "organization ID and mailbox ID required", http.StatusBadRequest)
		return
	}
	if _, err := uuid.Parse(orgID); err != nil {
		http.Error(w, "organization ID must be UUID", http.StatusBadRequest)
		return
	}
	if _, err := uuid.Parse(mailboxID); err != nil {
		http.Error(w, "mailbox ID must be UUID", http.StatusBadRequest)
		return
	}

	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "missing or invalid X-User-Id", http.StatusUnauthorized)
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

	// Verify caller belongs to organization and is active
	var memberID string
	err = conn.QueryRow(ctx, `SELECT id::text FROM users WHERE id=$1 AND org_id=$2 AND is_active=true`, userID, orgID).Scan(&memberID)
	if err != nil {
		http.Error(w, "not authorized for this organization", http.StatusForbidden)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var req struct {
		Mode              string `json:"mode"`
		RootSecretWrapped string `json:"root_secret_wrapped,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	targetMode := strings.TrimSpace(req.Mode)
	if targetMode != "org_managed" && targetMode != "private" {
		http.Error(w, "invalid mode: must be 'org_managed' or 'private'", http.StatusBadRequest)
		return
	}

	tx, err := conn.Begin(ctx)
	if err != nil {
		http.Error(w, "failed to begin transaction", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	var currentMode string
	var rootSecretID *string
	err = tx.QueryRow(ctx, `
		SELECT mode, root_secret_id::text 
		FROM mailboxes 
		WHERE id=$1 AND org_id=$2 AND is_active=true FOR UPDATE`, mailboxID, orgID).Scan(&currentMode, &rootSecretID)
	if err != nil {
		http.Error(w, "mailbox not found", http.StatusNotFound)
		return
	}

	if currentMode == targetMode {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":     "unchanged",
			"mailbox_id": mailboxID,
			"mode":       targetMode,
		})
		return
	}

	if targetMode == "org_managed" {
		// Private -> Org Managed: Requires wrapped root secret for org recovery key
		if req.RootSecretWrapped == "" {
			http.Error(w, "root_secret_wrapped required when migrating to org_managed mode", http.StatusBadRequest)
			return
		}
		rootWrapped, err := hexDecodeString(strings.TrimSpace(req.RootSecretWrapped))
		if err != nil || len(rootWrapped) != 81 {
			http.Error(w, "invalid root_secret_wrapped: must be 81 bytes (162 hex characters)", http.StatusBadRequest)
			return
		}

		// Verify organization recovery key is configured
		var recPk []byte
		err = tx.QueryRow(ctx, `SELECT org_recovery_pk FROM organizations WHERE id=$1`, orgID).Scan(&recPk)
		if err != nil || len(recPk) != 32 {
			http.Error(w, "organization recovery key not available", http.StatusBadRequest)
			return
		}

		if rootSecretID != nil && *rootSecretID != "" {
			_, err = tx.Exec(ctx, `UPDATE root_secrets SET root_secret_wrapped=$1, revoked_at=NULL WHERE id=$2`, rootWrapped, *rootSecretID)
		} else {
			var newRootID string
			err = tx.QueryRow(ctx, `INSERT INTO root_secrets (root_secret_wrapped) VALUES ($1) RETURNING id::text`, rootWrapped).Scan(&newRootID)
			if err == nil {
				_, err = tx.Exec(ctx, `UPDATE mailboxes SET root_secret_id=$1 WHERE id=$2`, newRootID, mailboxID)
			}
		}
		if err != nil {
			http.Error(w, "failed to update root secret", http.StatusInternalServerError)
			return
		}

		_, err = tx.Exec(ctx, `UPDATE mailboxes SET mode='org_managed' WHERE id=$1`, mailboxID)
		if err != nil {
			http.Error(w, "failed to update mailbox mode", http.StatusInternalServerError)
			return
		}
	} else {
		// Org Managed -> Private: Sever org recovery link, revoke wrapped root secret
		if req.RootSecretWrapped != "" {
			http.Error(w, "root_secret_wrapped must be omitted when migrating to private mode", http.StatusBadRequest)
			return
		}

		if rootSecretID != nil && *rootSecretID != "" {
			_, err = tx.Exec(ctx, `UPDATE root_secrets SET root_secret_wrapped=NULL, revoked_at=now() WHERE id=$1`, *rootSecretID)
			if err != nil {
				http.Error(w, "failed to revoke root secret", http.StatusInternalServerError)
				return
			}
		}

		_, err = tx.Exec(ctx, `UPDATE mailboxes SET mode='private' WHERE id=$1`, mailboxID)
		if err != nil {
			http.Error(w, "failed to update mailbox mode", http.StatusInternalServerError)
			return
		}
	}

	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "failed to commit transaction", http.StatusInternalServerError)
		return
	}

	auditLog(ctx, conn, orgID, userID, "migrate_mailbox_privacy_mode", "mailbox", mailboxID, map[string]interface{}{
		"from_mode": currentMode,
		"to_mode":   targetMode,
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":     "migrated",
		"mailbox_id": mailboxID,
		"mode":       targetMode,
	})
}

