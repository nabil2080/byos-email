package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// mailboxInviteHandler handles POST /v1/organizations/{org_id}/mailboxes/invite
// Admins can invite a user to create either an Org-Managed or Private mailbox.
// For Org-Managed: admin client provides provisional keypair, wrapped_sk_org, and temp_wrapped_sk.
// For Private: admin client provides zero key material (mailbox_pk, wrapped_sk_org, temp_wrapped_sk are NULL).
func mailboxInviteHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	orgID := r.PathValue("org_id")
	if orgID == "" {
		http.Error(w, "organization ID required", http.StatusBadRequest)
		return
	}
	if _, err := uuid.Parse(orgID); err != nil {
		http.Error(w, "invalid organization ID", http.StatusBadRequest)
		return
	}
	callerUserID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
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

	if !isAdmin(callerUserID, orgID, conn) {
		http.Error(w, "admin or owner role required", http.StatusForbidden)
		return
	}

	var req struct {
		Address       string `json:"address"`
		LocalPart     string `json:"local_part"`
		DomainID      string `json:"domain_id"`
		Name          string `json:"name"`
		PrivacyMode   string `json:"privacy_mode"`
		Token         string `json:"token"`
		MailboxPk     string `json:"mailbox_pk"`
		WrappedSkOrg  string `json:"wrapped_sk_org"`
		TempWrappedSk string `json:"temp_wrapped_sk"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	privacyMode := strings.TrimSpace(req.PrivacyMode)
	if privacyMode == "" {
		privacyMode = "private"
	}
	if privacyMode != "organization_managed" && privacyMode != "org_managed" && privacyMode != "private" {
		http.Error(w, "unsupported privacy_mode; must be organization_managed or private", http.StatusBadRequest)
		return
	}

	mailboxMode := "private"
	if privacyMode == "organization_managed" || privacyMode == "org_managed" {
		mailboxMode = "org_managed"
	}

	var localPart, domainID, email string
	if strings.Contains(req.Address, "@") {
		email = strings.TrimSpace(strings.ToLower(req.Address))
		parts := strings.SplitN(email, "@", 2)
		localPart = parts[0]
		domainName := parts[1]
		err = conn.QueryRow(ctx, `SELECT id::text FROM domains WHERE org_id=$1 AND name=$2 AND is_verified=true`, orgID, domainName).Scan(&domainID)
		if err != nil {
			http.Error(w, "domain not found or unverified for this organization", http.StatusBadRequest)
			return
		}
	} else {
		localPart = strings.TrimSpace(req.LocalPart)
		domainID = strings.TrimSpace(req.DomainID)
		if localPart == "" || domainID == "" {
			http.Error(w, "address or (local_part and domain_id) required", http.StatusBadRequest)
			return
		}
		var domainName string
		err = conn.QueryRow(ctx, `SELECT name FROM domains WHERE id=$1 AND org_id=$2 AND is_verified=true`, domainID, orgID).Scan(&domainName)
		if err != nil {
			http.Error(w, "domain not found or unverified for this organization", http.StatusBadRequest)
			return
		}
		email = strings.ToLower(localPart + "@" + domainName)
	}

	if localPart == "" || strings.Contains(localPart, "@") || strings.Contains(localPart, " ") {
		http.Error(w, "invalid local_part", http.StatusBadRequest)
		return
	}

	displayName := strings.TrimSpace(req.Name)
	if displayName == "" {
		displayName = localPart
	}

	var mailboxPk *string
	var wrappedSkOrg *string
	var tempWrappedSk *string

	if privacyMode == "organization_managed" {
		mpk := strings.TrimSpace(req.MailboxPk)
		wsk := strings.TrimSpace(req.WrappedSkOrg)
		twsk := strings.TrimSpace(req.TempWrappedSk)
		if mpk != "" {
			mailboxPk = &mpk
		}
		if wsk != "" {
			wrappedSkOrg = &wsk
		}
		if twsk != "" {
			tempWrappedSk = &twsk
		}
	} else {
		// Private mode: Zero key material allowed from admin client
		mailboxPk = nil
		wrappedSkOrg = nil
		tempWrappedSk = nil
	}

	tx, err := conn.Begin(ctx)
	if err != nil {
		http.Error(w, "transaction failed", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	// Enforce plan quota
	var usedMailboxes int
	_ = tx.QueryRow(ctx, `SELECT count(*) FROM mailboxes WHERE org_id=$1 AND is_active=true`, orgID).Scan(&usedMailboxes)
	var currentPlan string
	err = tx.QueryRow(ctx, `SELECT plan FROM organizations WHERE id=$1 FOR UPDATE`, orgID).Scan(&currentPlan)
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

	// Active storage connection
	var storageConnID string
	err = tx.QueryRow(ctx, `SELECT id::text FROM storage_connections WHERE org_id=$1 AND status='active' LIMIT 1`, orgID).Scan(&storageConnID)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]string{"error": "storage_disconnected"})
		return
	}

	// Resolve 32-byte cryptographic invitation token (client-provided or server-generated)
	var rawToken string
	if len(strings.TrimSpace(req.Token)) == 64 {
		rawToken = strings.TrimSpace(req.Token)
	} else {
		rawTokenBytes := make([]byte, 32)
		if _, err := rand.Read(rawTokenBytes); err != nil {
			http.Error(w, "failed to generate token", http.StatusInternalServerError)
			return
		}
		rawToken = hex.EncodeToString(rawTokenBytes)
	}
	tokenHash := fmt.Sprintf("%x", sha256.Sum256([]byte(rawToken)))

	// Check duplicates
	var existingUserID string
	err = tx.QueryRow(ctx, `SELECT id::text FROM users WHERE email=$1`, email).Scan(&existingUserID)
	if err == nil {
		http.Error(w, "user with this email already exists", http.StatusConflict)
		return
	}

	var existingMailboxID string
	err = tx.QueryRow(ctx, `SELECT id::text FROM mailboxes WHERE domain_id=$1 AND local_part=$2`, domainID, localPart).Scan(&existingMailboxID)
	if err == nil {
		http.Error(w, "mailbox already exists for this domain", http.StatusConflict)
		return
	}

	// Insert pending user
	var newUserID string
	err = tx.QueryRow(ctx, `
		INSERT INTO users (org_id, email, display_name, password_hash, role, status, is_active)
		VALUES ($1, $2, $3, NULL, 'member', 'pending_activation', true)
		RETURNING id::text
	`, orgID, email, displayName).Scan(&newUserID)
	if err != nil {
		log.Printf("failed to insert pending user: %v", err)
		http.Error(w, "failed to create user record", http.StatusInternalServerError)
		return
	}

	// Insert pending mailbox
	var newMailboxID string
	var pkBytes []byte
	if mailboxPk != nil && *mailboxPk != "" {
		pkBytes, _ = hex.DecodeString(*mailboxPk)
	}
	err = tx.QueryRow(ctx, `
		INSERT INTO mailboxes (org_id, user_id, domain_id, local_part, mode, status, is_active, mailbox_pk, wrapped_sk_org)
		VALUES ($1, $2, $3, $4, $5, 'pending_activation', true, $6, $7)
		RETURNING id::text
	`, orgID, newUserID, domainID, localPart, mailboxMode, pkBytes, wrappedSkOrg).Scan(&newMailboxID)
	if err != nil {
		log.Printf("failed to insert pending mailbox: %v", err)
		http.Error(w, "failed to create mailbox record", http.StatusInternalServerError)
		return
	}

	// Map storage prefix
	_, err = tx.Exec(ctx, `
		INSERT INTO mailbox_storage (mailbox_id, storage_connection_id, object_prefix, status)
		VALUES ($1, $2, $3, 'active')
	`, newMailboxID, storageConnID, "mailboxes/"+newMailboxID)
	if err != nil {
		log.Printf("failed to map mailbox storage: %v", err)
		http.Error(w, "failed to map mailbox storage", http.StatusInternalServerError)
		return
	}

	// Insert invitation row
	expiresAt := time.Now().Add(7 * 24 * time.Hour)
	var invitationID string
	err = tx.QueryRow(ctx, `
		INSERT INTO account_invitations (org_id, mailbox_id, email, token_hash, privacy_mode, mailbox_pk, wrapped_sk_org, temp_wrapped_sk, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id::text
	`, orgID, newMailboxID, email, tokenHash, privacyMode, mailboxPk, wrappedSkOrg, tempWrappedSk, expiresAt).Scan(&invitationID)
	if err != nil {
		log.Printf("failed to insert account invitation: %v", err)
		http.Error(w, "failed to create invitation", http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "failed to commit transaction", http.StatusInternalServerError)
		return
	}

	auditLog(ctx, conn, orgID, callerUserID, "mailbox_invite", "mailbox", newMailboxID, map[string]interface{}{
		"email": email,
		"mode":  privacyMode,
	})

	webmailBaseURL := os.Getenv("WEBMAIL_BASE_URL")
	if webmailBaseURL == "" {
		webmailBaseURL = "http://127.0.0.1:3001"
	}
	inviteURL := fmt.Sprintf("%s/setup-account?token=%s", webmailBaseURL, rawToken)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"invitation_id": invitationID,
		"invite_url":    inviteURL,
		"mailbox_id":    newMailboxID,
		"email":         email,
		"privacy_mode":  privacyMode,
		"expires_at":    expiresAt.Format(time.RFC3339),
	})
}

// invitationVerifyHandler handles GET /v1/auth/invitations/verify?token=...
// Public endpoint for setup-account onboarding page to validate token and fetch org/mailbox metadata.
func invitationVerifyHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	rawToken := strings.TrimSpace(r.URL.Query().Get("token"))
	if rawToken == "" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"valid": false, "error": "token required"})
		return
	}
	tokenHash := fmt.Sprintf("%x", sha256.Sum256([]byte(rawToken)))

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

	var id, orgID, mailboxID, email, privacyMode string
	var mailboxPk, wrappedSkOrg, tempWrappedSk *string
	var expiresAt time.Time
	var consumedAt *time.Time
	var orgName string

	err = conn.QueryRow(ctx, `
		SELECT i.id::text, i.org_id::text, i.mailbox_id::text, i.email, i.privacy_mode,
		       i.mailbox_pk, i.wrapped_sk_org, i.temp_wrapped_sk, i.expires_at, i.consumed_at,
		       o.name
		FROM account_invitations i
		JOIN organizations o ON o.id = i.org_id
		WHERE i.token_hash = $1
	`, tokenHash).Scan(&id, &orgID, &mailboxID, &email, &privacyMode, &mailboxPk, &wrappedSkOrg, &tempWrappedSk, &expiresAt, &consumedAt, &orgName)

	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"valid": false, "error": "Invalid or expired invitation token"})
		return
	}

	if consumedAt != nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"valid": false, "error": "Invitation has already been claimed"})
		return
	}

	if expiresAt.Before(time.Now()) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{"valid": false, "error": "Invitation has expired"})
		return
	}

	resp := map[string]interface{}{
		"valid":             true,
		"invitation_id":     id,
		"email":             email,
		"organization_id":   orgID,
		"organization_name": orgName,
		"mailbox_id":        mailboxID,
		"privacy_mode":      privacyMode,
		"expires_at":        expiresAt.Format(time.RFC3339),
	}
	if mailboxPk != nil {
		resp["mailbox_pk"] = *mailboxPk
	}
	if wrappedSkOrg != nil {
		resp["wrapped_sk_org"] = *wrappedSkOrg
	}
	if tempWrappedSk != nil {
		resp["temp_wrapped_sk"] = *tempWrappedSk
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

// invitationClaimHandler handles POST /v1/auth/invitations/claim
// Consumes single-use invitation, sets user password, registers wrapped_sk_user, activates account.
func invitationClaimHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var req struct {
		Token           string `json:"token"`
		Password        string `json:"password"`
		PasswordHash    string `json:"password_hash"`
		Salt            string `json:"salt"`
		WrappedSkUser   string `json:"wrapped_sk_user"`
		MailboxPk       string `json:"mailbox_pk"`
		TwoFactorMethod string `json:"two_factor_method"` // "totp", "phone", "email"
		TOTPSecret      string `json:"totp_secret"`
		RecoveryEmail   string `json:"recovery_email"`
		RecoveryPhone   string `json:"recovery_phone"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	rawToken := strings.TrimSpace(req.Token)
	if rawToken == "" {
		http.Error(w, "token required", http.StatusBadRequest)
		return
	}
	tokenHash := fmt.Sprintf("%x", sha256.Sum256([]byte(rawToken)))

	wrappedSkUser := strings.TrimSpace(req.WrappedSkUser)
	if wrappedSkUser == "" {
		http.Error(w, "wrapped_sk_user required", http.StatusBadRequest)
		return
	}

	var passwordHash string
	if req.Password != "" {
		if len(req.Password) < 12 {
			http.Error(w, "password must be at least 12 characters", http.StatusBadRequest)
			return
		}
		var err error
		passwordHash, err = hashPassword(req.Password)
		if err != nil {
			http.Error(w, "failed to hash password", http.StatusInternalServerError)
			return
		}
	} else if req.PasswordHash != "" {
		passwordHash = strings.TrimSpace(req.PasswordHash)
		if req.Salt != "" && !strings.HasPrefix(passwordHash, "$argon2id$") {
			passwordHash = fmt.Sprintf("$argon2id$v=19$m=65536,t=3,p=2$%s$%s", req.Salt, passwordHash)
		}
	} else {
		http.Error(w, "password or password_hash required", http.StatusBadRequest)
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
		http.Error(w, "transaction failed", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	var inviteID, orgID, mailboxID, email, privacyMode string
	var expiresAt time.Time
	var consumedAt *time.Time
	var storedPk *string
	err = tx.QueryRow(ctx, `
		SELECT id::text, org_id::text, mailbox_id::text, email, privacy_mode, expires_at, consumed_at, mailbox_pk
		FROM account_invitations
		WHERE token_hash = $1
		FOR UPDATE
	`, tokenHash).Scan(&inviteID, &orgID, &mailboxID, &email, &privacyMode, &expiresAt, &consumedAt, &storedPk)

	if err != nil {
		http.Error(w, "invalid or expired invitation token", http.StatusBadRequest)
		return
	}
	if consumedAt != nil {
		http.Error(w, "invitation already claimed", http.StatusBadRequest)
		return
	}
	if expiresAt.Before(time.Now()) {
		http.Error(w, "invitation has expired", http.StatusBadRequest)
		return
	}

	finalMailboxPk := strings.TrimSpace(req.MailboxPk)
	if finalMailboxPk == "" && storedPk != nil {
		finalMailboxPk = *storedPk
	}
	if finalMailboxPk == "" {
		http.Error(w, "mailbox_pk required for claiming", http.StatusBadRequest)
		return
	}

	var userID string
	err = tx.QueryRow(ctx, `SELECT user_id::text FROM mailboxes WHERE id=$1`, mailboxID).Scan(&userID)
	if err != nil {
		http.Error(w, "associated mailbox not found", http.StatusInternalServerError)
		return
	}

	// Update user: status 'active', set password_hash, and configure mandatory 2FA
	twoFactorEnabled := req.TwoFactorMethod != "" || req.TOTPSecret != "" || req.RecoveryEmail != "" || req.RecoveryPhone != ""
	totpUpper := strings.ToUpper(strings.TrimSpace(req.TOTPSecret))
	recEmail := strings.TrimSpace(req.RecoveryEmail)
	recPhone := strings.TrimSpace(req.RecoveryPhone)

	_, err = tx.Exec(ctx, `
		UPDATE users
		SET password_hash=$1, status='active', is_active=true,
		    two_factor_enabled=CASE WHEN $3::boolean THEN true ELSE two_factor_enabled END,
		    totp_secret=COALESCE(NULLIF($4::text, ''), totp_secret),
		    recovery_email=COALESCE(NULLIF($5::text, ''), recovery_email),
		    recovery_phone=COALESCE(NULLIF($6::text, ''), recovery_phone),
		    updated_at=now()
		WHERE id=$2
	`, passwordHash, userID, twoFactorEnabled, totpUpper, recEmail, recPhone)
	if err != nil {
		log.Printf("failed to activate user: %v", err)
		http.Error(w, "failed to activate user", http.StatusInternalServerError)
		return
	}

	// Update mailbox: status 'active', set mailbox_pk and wrapped_sk_user
	pkBytes, _ := hex.DecodeString(finalMailboxPk)
	skWrappedBytes, _ := hex.DecodeString(wrappedSkUser)
	if len(skWrappedBytes) == 0 {
		skWrappedBytes = []byte(wrappedSkUser)
	}
	_, err = tx.Exec(ctx, `
		UPDATE mailboxes
		SET status='active', is_active=true, mailbox_pk=$1, wrapped_sk_user=$2, mailbox_sk_wrapped=$3, updated_at=now()
		WHERE id=$4
	`, pkBytes, wrappedSkUser, skWrappedBytes, mailboxID)
	if err != nil {
		log.Printf("failed to activate mailbox: %v", err)
		http.Error(w, "failed to activate mailbox", http.StatusInternalServerError)
		return
	}

	// Mark invitation consumed and wipe temp_wrapped_sk
	_, err = tx.Exec(ctx, `
		UPDATE account_invitations
		SET consumed_at=now(), temp_wrapped_sk=NULL, mailbox_pk=$1
		WHERE id=$2
	`, finalMailboxPk, inviteID)
	if err != nil {
		log.Printf("failed to mark invitation consumed: %v", err)
		http.Error(w, "failed to consume invitation", http.StatusInternalServerError)
		return
	}

	// Issue active session cookie for newly activated user
	token, sessionTokenHash := generateSessionToken()
	sessionExpires := time.Now().Add(30 * 24 * time.Hour)
	clientIP := getClientIP(r)
	userAgent := r.UserAgent()
	_, err = tx.Exec(ctx, `
		INSERT INTO sessions (user_id, token_hash, expires_at, ip_address, user_agent, last_active_at)
		VALUES ($1, $2, $3, $4, $5, now())
	`, userID, sessionTokenHash, sessionExpires, clientIP, userAgent)
	if err != nil {
		http.Error(w, "failed to create session", http.StatusInternalServerError)
		return
	}

	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "failed to commit transaction", http.StatusInternalServerError)
		return
	}

	setSessionCookie(w, r, token, sessionExpires)
	auditLog(ctx, conn, orgID, userID, "invitation_claimed", "user", userID, map[string]interface{}{"email": email})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"success":      true,
		"user_id":      userID,
		"email":        email,
		"org_id":       orgID,
		"mailbox_id":   mailboxID,
		"privacy_mode": privacyMode,
		"token":        token,
	})
}

// mailboxImpersonateHandler handles POST /v1/organizations/{org_id}/mailboxes/{mailbox_id}/impersonate
// Allows admins to access org_managed mailboxes using org recovery material.
// Private mailboxes strictly reject admin impersonation with HTTP 403 Forbidden.
func mailboxImpersonateHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	orgID := r.PathValue("org_id")
	mailboxID := r.PathValue("mailbox_id")
	if orgID == "" || mailboxID == "" {
		http.Error(w, "org_id and mailbox_id required", http.StatusBadRequest)
		return
	}
	if _, err := uuid.Parse(orgID); err != nil {
		http.Error(w, "invalid org_id", http.StatusBadRequest)
		return
	}
	if _, err := uuid.Parse(mailboxID); err != nil {
		http.Error(w, "invalid mailbox_id", http.StatusBadRequest)
		return
	}
	callerUserID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
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

	if !isAdmin(callerUserID, orgID, conn) {
		http.Error(w, "admin or owner role required", http.StatusForbidden)
		return
	}

	var targetUserID, mode, localPart string
	var wrappedSkOrg *string
	err = conn.QueryRow(ctx, `
		SELECT user_id::text, mode, wrapped_sk_org, local_part
		FROM mailboxes
		WHERE id=$1 AND org_id=$2
	`, mailboxID, orgID).Scan(&targetUserID, &mode, &wrappedSkOrg, &localPart)
	if err != nil {
		http.Error(w, "mailbox not found", http.StatusNotFound)
		return
	}

	// Strict Privacy Boundary: Private mailboxes cannot be accessed or impersonated by admins
	if mode == "private" {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusForbidden)
		json.NewEncoder(w).Encode(map[string]string{
			"error": "Private mailboxes cannot be accessed by administrators",
		})
		return
	}

	if wrappedSkOrg == nil || *wrappedSkOrg == "" {
		var invWsk *string
		_ = conn.QueryRow(ctx, `SELECT wrapped_sk_org FROM account_invitations WHERE mailbox_id=$1 ORDER BY created_at DESC LIMIT 1`, mailboxID).Scan(&invWsk)
		wrappedSkOrg = invWsk
	}

	// Issue short-lived audited impersonation session
	token, sessionTokenHash := generateSessionToken()
	sessionExpires := time.Now().Add(2 * time.Hour)
	clientIP := getClientIP(r)
	impersonateUA := "Administrator Impersonation (" + r.UserAgent() + ")"
	_, err = conn.Exec(ctx, `
		INSERT INTO sessions (user_id, token_hash, expires_at, ip_address, user_agent, last_active_at)
		VALUES ($1, $2, $3, $4, $5, now())
	`, targetUserID, sessionTokenHash, sessionExpires, clientIP, impersonateUA)
	if err != nil {
		http.Error(w, "failed to issue impersonation session", http.StatusInternalServerError)
		return
	}

	auditLog(ctx, conn, orgID, callerUserID, "mailbox_impersonate", "mailbox", mailboxID, map[string]interface{}{
		"target_user_id": targetUserID,
		"local_part":     localPart,
		"mode":           mode,
	})

	webmailBaseURL := os.Getenv("WEBMAIL_BASE_URL")
	if webmailBaseURL == "" {
		webmailBaseURL = "http://127.0.0.1:3001"
	}
	webmailURL := fmt.Sprintf("%s/?impersonate=1&mailbox_id=%s&email=%s&session_token=%s", webmailBaseURL, mailboxID, localPart, token)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"mailbox_id":     mailboxID,
		"target_user_id": targetUserID,
		"wrapped_sk_org": wrappedSkOrg,
		"session_token":  token,
		"webmail_url":    webmailURL,
	})
}
