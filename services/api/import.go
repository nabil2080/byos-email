package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Fallback in-memory state store if Redis is unavailable
var (
	importStateMemMu sync.Mutex
	importStateMem   = make(map[string]importOAuthState)
)

type importOAuthState struct {
	MailboxID string    `json:"mailbox_id"`
	UserID    string    `json:"user_id"`
	Provider  string    `json:"provider"`
	CreatedAt time.Time `json:"created_at"`
}

func readSecretOrEnv(envVar, secretFile string) string {
	if v := strings.TrimSpace(os.Getenv(envVar)); v != "" {
		return v
	}
	b, err := os.ReadFile(secretFile)
	if err == nil {
		return strings.TrimSpace(string(b))
	}
	return ""
}

func getOAuthRedirectURI(provider string, r *http.Request) string {
	if envURI := os.Getenv("OAUTH_REDIRECT_URI"); envURI != "" {
		return envURI
	}
	if provider == "gmail" {
		if u := os.Getenv("GOOGLE_OAUTH_REDIRECT_URI"); u != "" {
			return u
		}
	} else if provider == "outlook" {
		if u := os.Getenv("OUTLOOK_OAUTH_REDIRECT_URI"); u != "" {
			return u
		}
	}

	proto := "http"
	if r.TLS != nil || r.Header.Get("X-Forwarded-Proto") == "https" {
		proto = "https"
	}
	host := r.Host
	if host == "" {
		host = "localhost:8080"
	}
	return fmt.Sprintf("%s://%s/v1/import/oauth/callback", proto, host)
}

func getWebmailOrigin() string {
	if o := strings.TrimSpace(os.Getenv("WEBMAIL_ORIGIN")); o != "" {
		return o
	}
	return "http://localhost:3001"
}

// POST /v1/import/begin
func importBeginHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if !allowPerUser(userID) {
		http.Error(w, "rate limited", http.StatusTooManyRequests)
		return
	}

	var req struct {
		Provider  string `json:"provider"`
		MailboxID string `json:"mailbox_id"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	req.Provider = strings.ToLower(strings.TrimSpace(req.Provider))
	if req.Provider != "gmail" && req.Provider != "outlook" {
		http.Error(w, "invalid provider; must be 'gmail' or 'outlook'", http.StatusBadRequest)
		return
	}

	if _, err := uuid.Parse(req.MailboxID); err != nil {
		http.Error(w, "invalid mailbox_id UUID", http.StatusBadRequest)
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

	var authorizedID string
	err = conn.QueryRow(ctx, `
		SELECT m.id::text
		FROM mailboxes m
		JOIN users u ON u.org_id = m.org_id
		WHERE m.id = $1 AND u.id = $2 AND u.is_active = true AND m.is_active = true
	`, req.MailboxID, userID).Scan(&authorizedID)
	if err != nil {
		http.Error(w, "forbidden or mailbox not found", http.StatusForbidden)
		return
	}

	state := uuid.New().String()
	stObj := importOAuthState{
		MailboxID: req.MailboxID,
		UserID:    userID,
		Provider:  req.Provider,
		CreatedAt: time.Now(),
	}

	// Persist state with 10 min TTL
	stBytes, _ := json.Marshal(stObj)
	if redisClient != nil {
		_ = redisClient.Set(ctx, fmt.Sprintf("import:oauth:state:%s", state), string(stBytes), 10*time.Minute).Err()
	} else {
		importStateMemMu.Lock()
		importStateMem[state] = stObj
		importStateMemMu.Unlock()
	}

	redirectURI := getOAuthRedirectURI(req.Provider, r)
	mockURL := strings.TrimRight(strings.TrimSpace(os.Getenv("OAUTH_MOCK_URL")), "/")
	if mockURL == "" {
		mockURL = strings.TrimRight(strings.TrimSpace(os.Getenv("MOCK_PROVIDER_URL")), "/")
	}

	var authURL string
	if mockURL != "" {
		authURL = fmt.Sprintf("%s/oauth/authorize?response_type=code&client_id=%s&redirect_uri=%s&state=%s&provider=%s",
			mockURL, url.QueryEscape("mock-client-id"), url.QueryEscape(redirectURI), state, req.Provider)
	} else if req.Provider == "gmail" {
		clientID := readSecretOrEnv("GOOGLE_OAUTH_CLIENT_ID", "/run/secrets/google_oauth_client_id")
		if clientID == "" {
			clientID = "byos-gmail-client-id.apps.googleusercontent.com"
		}
		authURL = "https://accounts.google.com/o/oauth2/v2/auth?" + url.Values{
			"client_id":     {clientID},
			"redirect_uri":  {redirectURI},
			"response_type": {"code"},
			"scope":         {"https://www.googleapis.com/auth/gmail.readonly"},
			"access_type":   {"offline"},
			"prompt":        {"consent"},
			"state":         {state},
		}.Encode()
	} else {
		clientID := readSecretOrEnv("OUTLOOK_OAUTH_CLIENT_ID", "/run/secrets/outlook_oauth_client_id")
		if clientID == "" {
			clientID = "byos-outlook-client-id"
		}
		authURL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?" + url.Values{
			"client_id":     {clientID},
			"redirect_uri":  {redirectURI},
			"response_type": {"code"},
			"scope":         {"offline_access Mail.Read"},
			"state":         {state},
		}.Encode()
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"auth_url": authURL,
		"state":    state,
	})
}

// GET /v1/import/oauth/callback
func importOAuthCallbackHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	webmailOrigin := getWebmailOrigin()
	if errParam := r.URL.Query().Get("error"); errParam != "" {
		http.Redirect(w, r, fmt.Sprintf("%s/import/callback#error=%s", webmailOrigin, url.QueryEscape(errParam)), http.StatusFound)
		return
	}

	code := r.URL.Query().Get("code")
	state := r.URL.Query().Get("state")
	if code == "" || state == "" {
		http.Redirect(w, r, fmt.Sprintf("%s/import/callback#error=missing_code_or_state", webmailOrigin), http.StatusFound)
		return
	}

	ctx := r.Context()
	var stObj importOAuthState
	var found bool

	if redisClient != nil {
		raw, err := redisClient.Get(ctx, fmt.Sprintf("import:oauth:state:%s", state)).Result()
		if err == nil && raw != "" {
			if json.Unmarshal([]byte(raw), &stObj) == nil {
				found = true
			}
			redisClient.Del(ctx, fmt.Sprintf("import:oauth:state:%s", state))
		}
	} else {
		importStateMemMu.Lock()
		if s, ok := importStateMem[state]; ok {
			if time.Since(s.CreatedAt) <= 10*time.Minute {
				stObj = s
				found = true
			}
			delete(importStateMem, state)
		}
		importStateMemMu.Unlock()
	}

	if !found {
		http.Redirect(w, r, fmt.Sprintf("%s/import/callback#error=invalid_or_expired_state", webmailOrigin), http.StatusFound)
		return
	}

	redirectURI := getOAuthRedirectURI(stObj.Provider, r)
	mockURL := strings.TrimRight(strings.TrimSpace(os.Getenv("OAUTH_MOCK_URL")), "/")
	if mockURL == "" {
		mockURL = strings.TrimRight(strings.TrimSpace(os.Getenv("MOCK_PROVIDER_URL")), "/")
	}

	var tokenEndpoint string
	var clientID, clientSecret string

	if mockURL != "" {
		tokenEndpoint = mockURL + "/oauth/token"
		clientID = "mock-client-id"
		clientSecret = "mock-client-secret"
	} else if stObj.Provider == "gmail" {
		tokenEndpoint = "https://oauth2.googleapis.com/token"
		clientID = readSecretOrEnv("GOOGLE_OAUTH_CLIENT_ID", "/run/secrets/google_oauth_client_id")
		clientSecret = readSecretOrEnv("GOOGLE_OAUTH_CLIENT_SECRET", "/run/secrets/google_oauth_client_secret")
	} else {
		tokenEndpoint = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
		clientID = readSecretOrEnv("OUTLOOK_OAUTH_CLIENT_ID", "/run/secrets/outlook_oauth_client_id")
		clientSecret = readSecretOrEnv("OUTLOOK_OAUTH_CLIENT_SECRET", "/run/secrets/outlook_oauth_client_secret")
	}

	form := url.Values{
		"code":          {code},
		"client_id":     {clientID},
		"client_secret": {clientSecret},
		"redirect_uri":  {redirectURI},
		"grant_type":    {"authorization_code"},
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, tokenEndpoint, strings.NewReader(form.Encode()))
	if err != nil {
		http.Redirect(w, r, fmt.Sprintf("%s/import/callback#error=token_request_failed", webmailOrigin), http.StatusFound)
		return
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		http.Redirect(w, r, fmt.Sprintf("%s/import/callback#error=provider_unavailable", webmailOrigin), http.StatusFound)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		http.Redirect(w, r, fmt.Sprintf("%s/import/callback#error=token_exchange_rejected", webmailOrigin), http.StatusFound)
		return
	}

	var tokens struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
		ExpiresIn    int    `json:"expires_in"`
		TokenType    string `json:"token_type"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tokens); err != nil || tokens.AccessToken == "" {
		http.Redirect(w, r, fmt.Sprintf("%s/import/callback#error=invalid_token_response", webmailOrigin), http.StatusFound)
		return
	}

	// D1 Compliance: Tokens are NEVER persisted to database or disk on the server.
	// They are placed in the URL hash fragment of the redirect.
	redirectTarget := fmt.Sprintf("%s/import/callback#provider=%s&mailbox_id=%s&access_token=%s&refresh_token=%s&expires_in=%d",
		webmailOrigin,
		url.QueryEscape(stObj.Provider),
		url.QueryEscape(stObj.MailboxID),
		url.QueryEscape(tokens.AccessToken),
		url.QueryEscape(tokens.RefreshToken),
		tokens.ExpiresIn,
	)

	http.Redirect(w, r, redirectTarget, http.StatusFound)
}

// POST /v1/import/refresh
func importTokenRefreshHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if !allowPerUser(userID) {
		http.Error(w, "rate limited", http.StatusTooManyRequests)
		return
	}

	var req struct {
		Provider     string `json:"provider"`
		RefreshToken string `json:"refresh_token"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}
	req.Provider = strings.ToLower(strings.TrimSpace(req.Provider))
	if req.RefreshToken == "" {
		http.Error(w, "missing refresh_token", http.StatusBadRequest)
		return
	}

	mockURL := strings.TrimRight(strings.TrimSpace(os.Getenv("OAUTH_MOCK_URL")), "/")
	if mockURL == "" {
		mockURL = strings.TrimRight(strings.TrimSpace(os.Getenv("MOCK_PROVIDER_URL")), "/")
	}

	var tokenEndpoint, clientID, clientSecret string
	if mockURL != "" {
		tokenEndpoint = mockURL + "/oauth/token"
		clientID = "mock-client-id"
		clientSecret = "mock-client-secret"
	} else if req.Provider == "gmail" {
		tokenEndpoint = "https://oauth2.googleapis.com/token"
		clientID = readSecretOrEnv("GOOGLE_OAUTH_CLIENT_ID", "/run/secrets/google_oauth_client_id")
		clientSecret = readSecretOrEnv("GOOGLE_OAUTH_CLIENT_SECRET", "/run/secrets/google_oauth_client_secret")
	} else {
		tokenEndpoint = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
		clientID = readSecretOrEnv("OUTLOOK_OAUTH_CLIENT_ID", "/run/secrets/outlook_oauth_client_id")
		clientSecret = readSecretOrEnv("OUTLOOK_OAUTH_CLIENT_SECRET", "/run/secrets/outlook_oauth_client_secret")
	}

	form := url.Values{
		"refresh_token": {req.RefreshToken},
		"client_id":     {clientID},
		"client_secret": {clientSecret},
		"grant_type":    {"refresh_token"},
	}

	ctx := r.Context()
	postReq, err := http.NewRequestWithContext(ctx, http.MethodPost, tokenEndpoint, strings.NewReader(form.Encode()))
	if err != nil {
		http.Error(w, "failed to prepare refresh request", http.StatusInternalServerError)
		return
	}
	postReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Do(postReq)
	if err != nil {
		http.Error(w, "token refresh service unavailable", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		http.Error(w, "token refresh rejected by provider", http.StatusBadGateway)
		return
	}

	var tokens struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tokens); err != nil || tokens.AccessToken == "" {
		http.Error(w, "invalid token refresh response", http.StatusBadGateway)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(tokens)
}

type ImportMessageRequest struct {
	SourceProvider        string   `json:"source_provider"`
	SourceMessageID       string   `json:"source_message_id"`
	StorageObjectID       string   `json:"storage_object_id"`
	Sender                string   `json:"sender"`
	Recipients            []string `json:"recipients"`
	Direction             string   `json:"direction"`
	Folder                string   `json:"folder"`
	IsRead                bool     `json:"is_read"`
	IsStarred             bool     `json:"is_starred"`
	HasAttachments        bool     `json:"has_attachments"`
	AttachmentCount       int      `json:"attachment_count"`
	SizeBytes             int64    `json:"size_bytes"`
	ReceivedAt            string   `json:"received_at"`
	SentAt                *string  `json:"sent_at,omitempty"`
	ContentKeyHPKEWrapped string   `json:"content_key_hpke_wrapped"`
	EncryptionIV          string   `json:"encryption_iv"`
	BundleHash            string   `json:"bundle_hash"`
	EncryptionVersion     int      `json:"encryption_version"`
	AADVersion            int      `json:"aad_version"`
	WrappedKeyAlgorithm   string   `json:"wrapped_key_algorithm"`
	Labels                []string `json:"labels,omitempty"`
}

// POST /v1/mailboxes/{mailbox_id}/import-message
func importMessageHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	mailboxID := r.PathValue("mailbox_id")
	if _, err := uuid.Parse(mailboxID); err != nil {
		http.Error(w, "invalid mailbox_id UUID", http.StatusBadRequest)
		return
	}
	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	var req ImportMessageRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		http.Error(w, "invalid request body: "+err.Error(), http.StatusBadRequest)
		return
	}

	req.SourceProvider = strings.ToLower(strings.TrimSpace(req.SourceProvider))
	req.SourceMessageID = strings.TrimSpace(req.SourceMessageID)
	req.StorageObjectID = strings.TrimSpace(req.StorageObjectID)
	req.Sender = strings.TrimSpace(req.Sender)

	if req.SourceProvider == "" || req.SourceMessageID == "" || req.StorageObjectID == "" || req.Sender == "" {
		http.Error(w, "source_provider, source_message_id, storage_object_id, and sender are required", http.StatusBadRequest)
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

	// Verify session authorization for target mailbox
	if status, errMsg, authOk := verifyUserMailboxSession(r, userID, mailboxID, conn, ctx); !authOk {
		http.Error(w, errMsg, status)
		return
	}

	var domainID string
	var mailboxSKVersion int
	err = conn.QueryRow(ctx, `
		SELECT m.domain_id::text, m.mailbox_sk_version
		FROM mailboxes m
		WHERE m.id = $1 AND m.is_active = true
	`, mailboxID).Scan(&domainID, &mailboxSKVersion)
	if err != nil {
		http.Error(w, "forbidden or mailbox not found", http.StatusForbidden)
		return
	}

	// Idempotency check: D5 unique constraint on (mailbox_id, source_provider, source_message_id)
	var existingID string
	var existingSeq int64
	err = conn.QueryRow(ctx, `
		SELECT id::text, message_seq
		FROM message_metadata
		WHERE mailbox_id = $1 AND source_provider = $2 AND source_message_id = $3
	`, mailboxID, req.SourceProvider, req.SourceMessageID).Scan(&existingID, &existingSeq)
	if err == nil {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":      "already_imported",
			"imported":    false,
			"reason":      "duplicate",
			"message_id":  existingID,
			"message_seq": existingSeq,
		})
		return
	} else if !errors.Is(err, pgx.ErrNoRows) {
		http.Error(w, "database check failed", http.StatusInternalServerError)
		return
	}

	var messageSeq int64
	if err := conn.QueryRow(ctx, "SELECT nextval('mailbox_message_seq')").Scan(&messageSeq); err != nil {
		http.Error(w, "failed to allocate sequence", http.StatusInternalServerError)
		return
	}

	delivIDBytes := sha256.Sum256([]byte(fmt.Sprintf("oauth_import:%s:%s:%s", mailboxID, req.SourceProvider, req.SourceMessageID)))

	direction := strings.ToLower(strings.TrimSpace(req.Direction))
	if direction == "" {
		direction = "received"
		if strings.ToLower(strings.TrimSpace(req.Folder)) == "sent" {
			direction = "sent"
		}
	}
	folder := strings.ToLower(strings.TrimSpace(req.Folder))
	if folder == "" {
		folder = "inbox"
	}
	alg := strings.TrimSpace(req.WrappedKeyAlgorithm)
	if alg == "" {
		alg = "byos-imported-v1"
	}

	encVer := req.EncryptionVersion
	if encVer == 0 {
		encVer = 1
	}
	aadVer := req.AADVersion
	if aadVer == 0 {
		aadVer = 1
	}

	wrappedKeyBytes := []byte{}
	if req.ContentKeyHPKEWrapped != "" {
		if b, err := base64.StdEncoding.DecodeString(req.ContentKeyHPKEWrapped); err == nil && len(b) > 0 {
			wrappedKeyBytes = b
		}
	}
	ivBytes := []byte{}
	if req.EncryptionIV != "" {
		if b, err := base64.StdEncoding.DecodeString(req.EncryptionIV); err == nil && len(b) > 0 {
			ivBytes = b
		}
	}
	hashBytes := []byte{}
	if req.BundleHash != "" {
		if b, err := base64.StdEncoding.DecodeString(req.BundleHash); err == nil && len(b) > 0 {
			hashBytes = b
		}
	}

	receivedAt := time.Now().UTC()
	if req.ReceivedAt != "" {
		if t, err := time.Parse(time.RFC3339, req.ReceivedAt); err == nil {
			receivedAt = t.UTC()
		}
	}
	var sentAt *time.Time
	if req.SentAt != nil && *req.SentAt != "" {
		if t, err := time.Parse(time.RFC3339, *req.SentAt); err == nil {
			utc := t.UTC()
			sentAt = &utc
		}
	}

	recipients := req.Recipients
	if len(recipients) == 0 {
		recipients = []string{req.Sender}
	}

	tx, err := conn.Begin(ctx)
	if err != nil {
		http.Error(w, "transaction failed", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	var newID string
	err = tx.QueryRow(ctx, `
		INSERT INTO message_metadata (
			mailbox_id, domain_id, message_seq, direction, delivery_identity,
			sender, recipients, has_attachments, attachment_count, storage_object_id,
			content_key_hpke_wrapped, mailbox_sk_version, encryption_version,
			encryption_iv, aad_version, bundle_hash, status, wrapped_key_algorithm,
			is_read, is_starred, received_at, sent_at, folder, size_bytes,
			source, source_provider, source_message_id
		) VALUES (
			$1, $2, $3, $4, $5,
			$6, $7, $8, $9, $10,
			$11, $12, $13,
			$14, $15, $16, $17, $18,
			$19, $20, $21, $22, $23, $24,
			'oauth_import', $25, $26
		) RETURNING id::text
	`,
		mailboxID, domainID, messageSeq, direction, delivIDBytes[:],
		req.Sender, recipients, req.HasAttachments, req.AttachmentCount, req.StorageObjectID,
		wrappedKeyBytes, mailboxSKVersion, encVer,
		ivBytes, aadVer, hashBytes, direction, alg,
		req.IsRead, req.IsStarred, receivedAt, sentAt, folder, req.SizeBytes,
		req.SourceProvider, req.SourceMessageID,
	).Scan(&newID)
	if err != nil {
		// Concurrent duplicate insert check
		if reErr := conn.QueryRow(ctx, `
			SELECT id::text, message_seq
			FROM message_metadata
			WHERE mailbox_id = $1 AND source_provider = $2 AND source_message_id = $3
		`, mailboxID, req.SourceProvider, req.SourceMessageID).Scan(&existingID, &existingSeq); reErr == nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"status":      "already_imported",
				"imported":    false,
				"reason":      "duplicate",
				"message_id":  existingID,
				"message_seq": existingSeq,
			})
			return
		}
		http.Error(w, "insert failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Link labels if specified
	for _, labelNameOrID := range req.Labels {
		clean := strings.TrimSpace(labelNameOrID)
		if clean == "" {
			continue
		}
		var labelID string
		_ = tx.QueryRow(ctx, `
			SELECT id::text FROM mailbox_labels WHERE mailbox_id = $1 AND (id::text = $2 OR lower(name) = lower($2)) LIMIT 1
		`, mailboxID, clean).Scan(&labelID)
		if labelID != "" {
			_, _ = tx.Exec(ctx, `INSERT INTO message_labels (message_id, label_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, newID, labelID)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "commit failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":      "imported",
		"imported":    true,
		"message_id":  newID,
		"message_seq": messageSeq,
	})
}

// POST /v1/import/jobs
func importJobCreateHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		MailboxID     string `json:"mailbox_id"`
		Provider      string `json:"provider"`
		TotalMessages int    `json:"total_messages"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if _, err := uuid.Parse(req.MailboxID); err != nil {
		http.Error(w, "invalid mailbox_id UUID", http.StatusBadRequest)
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

	var authID string
	err = conn.QueryRow(ctx, `
		SELECT m.id::text FROM mailboxes m JOIN users u ON u.org_id=m.org_id
		WHERE m.id=$1 AND u.id=$2 AND u.is_active=true AND m.is_active=true
	`, req.MailboxID, userID).Scan(&authID)
	if err != nil {
		http.Error(w, "forbidden or mailbox not found", http.StatusForbidden)
		return
	}

	var jobID string
	err = conn.QueryRow(ctx, `
		INSERT INTO import_jobs (mailbox_id, provider, status, total_messages)
		VALUES ($1, $2, 'running', $3)
		RETURNING id::text
	`, req.MailboxID, strings.ToLower(req.Provider), req.TotalMessages).Scan(&jobID)
	if err != nil {
		http.Error(w, "failed to create import job: "+err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"job_id": jobID,
		"status": "running",
	})
}

// POST /v1/import/complete
func importJobCompleteHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	var req struct {
		JobID            string `json:"job_id"`
		Status           string `json:"status"`
		ImportedMessages int    `json:"imported_messages"`
		SkippedMessages  int    `json:"skipped_messages"`
		FailedMessages   int    `json:"failed_messages"`
		ErrorMessage     string `json:"error_message,omitempty"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	if _, err := uuid.Parse(req.JobID); err != nil {
		http.Error(w, "invalid job_id UUID", http.StatusBadRequest)
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

	status := strings.ToLower(strings.TrimSpace(req.Status))
	if status == "" {
		status = "completed"
	}

	tag, err := conn.Exec(ctx, `
		UPDATE import_jobs ij
		SET status = $1,
		    imported_messages = $2,
		    skipped_messages = $3,
		    failed_messages = $4,
		    error_message = NULLIF($5, ''),
		    completed_at = NOW(),
		    updated_at = NOW()
		FROM mailboxes m
		JOIN users u ON u.org_id = m.org_id
		WHERE ij.id = $6 AND ij.mailbox_id = m.id AND u.id = $7 AND u.is_active = true
	`, status, req.ImportedMessages, req.SkippedMessages, req.FailedMessages, req.ErrorMessage, req.JobID, userID)
	if err != nil {
		http.Error(w, "failed to update job: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if tag.RowsAffected() == 0 {
		http.Error(w, "job not found or unauthorized", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"job_id": req.JobID,
		"status": status,
	})
}

// GET /v1/import/jobs
func importJobListHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	mailboxID := r.URL.Query().Get("mailbox_id")
	if mailboxID == "" {
		http.Error(w, "mailbox_id query param required", http.StatusBadRequest)
		return
	}
	if _, err := uuid.Parse(mailboxID); err != nil {
		http.Error(w, "invalid mailbox_id UUID", http.StatusBadRequest)
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

	// Verify session authorization for target mailbox
	if status, errMsg, authOk := verifyUserMailboxSession(r, userID, mailboxID, conn, ctx); !authOk {
		http.Error(w, errMsg, status)
		return
	}

	rows, err := conn.Query(ctx, `
		SELECT id::text, provider, status, total_messages, imported_messages,
		       skipped_messages, failed_messages, COALESCE(error_message, ''),
		       started_at, completed_at, created_at, updated_at
		FROM import_jobs
		WHERE mailbox_id = $1
		ORDER BY created_at DESC
		LIMIT 50
	`, mailboxID)
	if err != nil {
		http.Error(w, "query failed: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer rows.Close()

	type JobItem struct {
		ID               string  `json:"id"`
		Provider         string  `json:"provider"`
		Status           string  `json:"status"`
		TotalMessages    int     `json:"total_messages"`
		ImportedMessages int     `json:"imported_messages"`
		SkippedMessages  int     `json:"skipped_messages"`
		FailedMessages   int     `json:"failed_messages"`
		ErrorMessage     string  `json:"error_message,omitempty"`
		StartedAt        string  `json:"started_at"`
		CompletedAt      *string `json:"completed_at,omitempty"`
		CreatedAt        string  `json:"created_at"`
		UpdatedAt        string  `json:"updated_at"`
	}

	jobs := make([]JobItem, 0)
	for rows.Next() {
		var j JobItem
		var startedAt, createdAt, updatedAt time.Time
		var completedAt *time.Time
		var errMsg string
		if err := rows.Scan(
			&j.ID, &j.Provider, &j.Status, &j.TotalMessages, &j.ImportedMessages,
			&j.SkippedMessages, &j.FailedMessages, &errMsg,
			&startedAt, &completedAt, &createdAt, &updatedAt,
		); err != nil {
			http.Error(w, "scan failed: "+err.Error(), http.StatusInternalServerError)
			return
		}
		j.StartedAt = startedAt.Format(time.RFC3339)
		j.CreatedAt = createdAt.Format(time.RFC3339)
		j.UpdatedAt = updatedAt.Format(time.RFC3339)
		j.ErrorMessage = errMsg
		if completedAt != nil {
			c := completedAt.Format(time.RFC3339)
			j.CompletedAt = &c
		}
		jobs = append(jobs, j)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"jobs": jobs})
}

// POST /v1/mailboxes/{mailbox_id}/storage/store
func mailboxStorageStoreHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	mailboxID := r.PathValue("mailbox_id")
	if _, err := uuid.Parse(mailboxID); err != nil {
		http.Error(w, "invalid mailbox_id UUID", http.StatusBadRequest)
		return
	}
	userID, ok := getAuthenticatedUserID(r)
	if !ok && r.Header.Get("X-Internal-Key") == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	objectKey := r.Header.Get("X-Object-Key")
	expectedPrefix := fmt.Sprintf("mailboxes/%s/", mailboxID)
	if !strings.HasPrefix(objectKey, expectedPrefix) || strings.Contains(objectKey, "..") {
		http.Error(w, "invalid X-Object-Key: must be within mailbox scope", http.StatusBadRequest)
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

	// Authorize storage access: accepts storage-worker credential ("storage") or session-authorized user
	if status, errMsg, authOk := verifyMailboxScopedAccess(r, userID, mailboxID, "storage", conn, ctx); !authOk {
		http.Error(w, errMsg, status)
		return
	}

	rawData, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 50<<20))
	if err != nil {
		http.Error(w, "payload too large or read failed", http.StatusBadRequest)
		return
	}

	storeReq, err := http.NewRequestWithContext(ctx, http.MethodPost, storageWorkerURL()+"/api/store", bytes.NewReader(rawData))
	if err != nil {
		http.Error(w, "failed to prepare storage request", http.StatusInternalServerError)
		return
	}
	storeReq.Header.Set("Content-Type", "application/octet-stream")
	storeReq.Header.Set("X-Object-Key", objectKey)
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
		respBytes, _ := io.ReadAll(storeResp.Body)
		http.Error(w, fmt.Sprintf("storage store failed: %s", string(respBytes)), http.StatusBadGateway)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":     "stored",
		"object_key": objectKey,
		"size_bytes": len(rawData),
	})
}

// GET /v1/mailboxes/{mailbox_id}/storage/retrieve
func mailboxStorageRetrieveHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	mailboxID := r.PathValue("mailbox_id")
	if _, err := uuid.Parse(mailboxID); err != nil {
		http.Error(w, "invalid mailbox_id UUID", http.StatusBadRequest)
		return
	}
	userID, ok := getAuthenticatedUserID(r)
	if !ok && r.Header.Get("X-Internal-Key") == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	objectKey := r.URL.Query().Get("key")
	expectedPrefix := fmt.Sprintf("mailboxes/%s/", mailboxID)
	if !strings.HasPrefix(objectKey, expectedPrefix) || strings.Contains(objectKey, "..") {
		http.Error(w, "invalid key parameter: must be within mailbox scope", http.StatusBadRequest)
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

	// Authorize storage access: accepts storage-worker credential ("storage") or session-authorized user
	if status, errMsg, authOk := verifyMailboxScopedAccess(r, userID, mailboxID, "storage", conn, ctx); !authOk {
		http.Error(w, errMsg, status)
		return
	}

	retPayload, _ := json.Marshal(map[string]string{
		"object_key": objectKey,
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
		http.Error(w, "object not found in storage", http.StatusNotFound)
		return
	}

	rawData, _, decodeErr := decodeStorageRetrieveBody(retResp.Body)
	if decodeErr != nil || len(rawData) == 0 {
		http.Error(w, "failed to decode storage object", http.StatusBadGateway)
		return
	}

	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", fmt.Sprintf("%d", len(rawData)))
	w.WriteHeader(http.StatusOK)
	w.Write(rawData)
}
