package main

// Evidence:
// - ROADMAP_STATUS.md Section 11 (Storage Management API + Connectivity +
//   Disconnect/Reconnect + Failure Reporting): request/response shapes,
//   one-active-per-org via org-row FOR UPDATE, 201/200/409/404/204 semantics,
//   validation rules, storage-worker /internal/encrypt + /internal/test-encrypted
//   flow, tombstone soft-delete, mailbox_storage preservation,
//   default_storage_connection_id clearing, stale-test 409, PUT reset to
//   active+NULL, error codes verified/authentication_failed/provider_unavailable/
//   configuration_error/configuration_changed.
// - tests/storage_api.ps1 (27 behaviors) + tests/storage_connectivity.ps1
//   (6 behaviors): exact status codes asserted above.
// - apps/control-plane/src/lib/api/storage.ts: StorageConnection,
//   StorageTestResult contracts; POST/GET/PUT/DELETE + POST .../test (no body).
// - infra/postgres/init/001_init.sql + 006_storage_enhancements.sql: exact
//   storage_connections columns.
// - services/storage-worker/main.go (intact surviving source):
//   POST /internal/encrypt {plaintext} -> {ciphertext};
//   POST /internal/test-encrypted {provider,ciphertext} ->
//   {status:"ok",code:"verified"} or {status:"error",code}.
// - api.exe symbols: storageConnectionHandler/Create/Get/Update/Delete/Test,
//   validateStorageConfig, isUniqueViolation, trimSpace, toJSON.
// Reconstruction judgments are flagged inline.

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func googleDriveAuthorizeHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	orgID := r.PathValue("org_id")
	if _, err := uuid.Parse(orgID); err != nil {
		http.Error(w, "organization ID must be UUID", http.StatusBadRequest)
		return
	}
	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "missing or invalid X-User-Id", http.StatusUnauthorized)
		return
	}
	clientID := strings.TrimSpace(os.Getenv("GOOGLE_DRIVE_CLIENT_ID"))
	redirectURI := strings.TrimSpace(os.Getenv("GOOGLE_DRIVE_REDIRECT_URI"))
	if clientID == "" || redirectURI == "" {
		http.Error(w, "Google Drive OAuth is not configured", http.StatusServiceUnavailable)
		return
	}
	state := uuid.NewString()
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "******localhost:5432/byos?sslmode=disable"
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)
	var memberID string
	if err := conn.QueryRow(ctx, `SELECT id::text FROM users WHERE id=$1 AND org_id=$2 AND is_active=true`, userID, orgID).Scan(&memberID); err != nil {
		http.Error(w, "not authorized for this organization", http.StatusForbidden)
		return
	}
	if _, err := conn.Exec(ctx, `INSERT INTO google_drive_oauth_states (state, org_id, user_id, redirect_uri, expires_at) VALUES ($1,$2,$3,$4,now()+interval '10 minutes')`, state, orgID, userID, redirectURI); err != nil {
		http.Error(w, "failed to persist OAuth state", http.StatusInternalServerError)
		return
	}
	authURL := "https://accounts.google.com/o/oauth2/v2/auth?" + url.Values{
		"client_id":     {clientID},
		"redirect_uri":  {redirectURI},
		"response_type": {"code"},
		"scope":         {"https://www.googleapis.com/auth/drive.file"},
		"access_type":   {"offline"},
		"prompt":        {"consent"},
		"state":         {state},
	}.Encode()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"authorization_url": authURL, "state": state})
}

func googleDriveCallbackHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	code := r.URL.Query().Get("code")
	state := r.URL.Query().Get("state")
	if code == "" || state == "" {
		http.Error(w, "missing OAuth code or state", http.StatusBadRequest)
		return
	}
	clientID := strings.TrimSpace(os.Getenv("GOOGLE_DRIVE_CLIENT_ID"))
	clientSecret := strings.TrimSpace(os.Getenv("GOOGLE_DRIVE_CLIENT_SECRET"))
	if clientID == "" || clientSecret == "" {
		http.Error(w, "Google Drive OAuth is not configured", http.StatusServiceUnavailable)
		return
	}
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "******localhost:5432/byos?sslmode=disable"
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)
	tx, err := conn.Begin(ctx)
	if err != nil {
		http.Error(w, "failed to begin OAuth callback", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)
	var orgID, userID, redirectURI string
	if err := tx.QueryRow(ctx, `UPDATE google_drive_oauth_states SET used_at=now() WHERE state=$1 AND used_at IS NULL AND expires_at>now() RETURNING org_id::text, user_id::text, redirect_uri`, state).Scan(&orgID, &userID, &redirectURI); err != nil {
		http.Error(w, "invalid or expired OAuth state", http.StatusBadRequest)
		return
	}
	tokenBody := url.Values{
		"code": {code}, "client_id": {clientID}, "client_secret": {clientSecret},
		"redirect_uri": {redirectURI}, "grant_type": {"authorization_code"},
	}.Encode()
	tokenReq, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://oauth2.googleapis.com/token", strings.NewReader(tokenBody))
	if err != nil {
		http.Error(w, "failed to prepare OAuth exchange", http.StatusInternalServerError)
		return
	}
	tokenReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	tokenResp, err := (&http.Client{Timeout: 20 * time.Second}).Do(tokenReq)
	if err != nil {
		http.Error(w, "Google OAuth exchange unavailable", http.StatusBadGateway)
		return
	}
	defer tokenResp.Body.Close()
	if tokenResp.StatusCode < 200 || tokenResp.StatusCode >= 300 {
		http.Error(w, "Google OAuth exchange failed", http.StatusBadGateway)
		return
	}
	var tokens struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
	}
	if err := json.NewDecoder(tokenResp.Body).Decode(&tokens); err != nil || tokens.AccessToken == "" {
		http.Error(w, "Google OAuth response invalid", http.StatusBadGateway)
		return
	}
	encrypted, err := encryptStorageConfig(ctx, toJSON(map[string]interface{}{"access_token": tokens.AccessToken, "refresh_token": tokens.RefreshToken}))
	if err != nil {
		http.Error(w, "failed to encrypt Google credentials", http.StatusBadGateway)
		return
	}
	tag, err := tx.Exec(ctx, `
		UPDATE storage_connections SET provider='google_drive', provider_type='google_drive',
		  credentials_enc='', config=jsonb_build_object('ciphertext',$1::text),
		  encrypted=true, status='pending', updated_at=now()
		WHERE org_id=$2 AND status <> 'deleted'`, encrypted, orgID)
	if err != nil {
		http.Error(w, "failed to save Google Drive connection", http.StatusInternalServerError)
		return
	}
	if tag.RowsAffected() == 0 {
		if _, err := tx.Exec(ctx, `
			INSERT INTO storage_connections
			  (org_id, provider_type, provider, bucket_name, credentials_enc, config, is_active, encrypted, status)
			VALUES ($1,'google_drive','google_drive','', ''::bytea, jsonb_build_object('ciphertext',$2::text), true, true, 'pending')`,
			orgID, encrypted); err != nil {
			http.Error(w, "failed to create Google Drive connection", http.StatusInternalServerError)
			return
		}
	}
	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "failed to commit Google Drive connection", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "connected", "provider": "google_drive"})
}

type StorageConnectionRequest struct {
	Provider string                 `json:"provider"`
	Config   map[string]interface{} `json:"config"`
}

func storageMigrationCopyHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	orgID := r.PathValue("org_id")
	if _, err := uuid.Parse(orgID); err != nil {
		http.Error(w, "organization ID must be UUID", http.StatusBadRequest)
		return
	}
	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "missing or invalid X-User-Id", http.StatusUnauthorized)
		return
	}
	var request struct {
		Provider string                 `json:"provider"`
		Config   map[string]interface{} `json:"config"`
		Prefix   string                 `json:"prefix"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&request); err != nil {
		http.Error(w, "invalid migration request", http.StatusBadRequest)
		return
	}
	if request.Prefix == "" {
		http.Error(w, "prefix is required", http.StatusBadRequest)
		return
	}
	if _, _, _, err := validateStorageConfig(request.Provider, request.Config); err != nil {
		http.Error(w, "invalid migration target: "+err.Error(), http.StatusBadRequest)
		return
	}
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "******localhost:5432/byos?sslmode=disable"
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Minute)
	defer cancel()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)
	var sourceProvider, sourceCiphertext string
	var sourceConnectionID string
	bucket, _, _, err := validateStorageConfig(request.Provider, request.Config)
	if err != nil {
		http.Error(w, "invalid migration target: "+err.Error(), http.StatusBadRequest)
		return
	}
	if err := conn.QueryRow(ctx, `
		SELECT sc.id::text, sc.provider, sc.config->>'ciphertext'
		FROM users u JOIN storage_connections sc ON sc.org_id=u.org_id
		WHERE u.id=$1 AND u.org_id=$2 AND u.is_active=true
		  AND sc.status IN ('active','error')
		ORDER BY sc.updated_at DESC LIMIT 1`,
		userID, orgID).Scan(&sourceConnectionID, &sourceProvider, &sourceCiphertext); err != nil {
		http.Error(w, "no active storage connection found", http.StatusNotFound)
		return
	}
	targetCiphertext, err := encryptStorageConfig(ctx, toJSON(request.Config))
	if err != nil {
		http.Error(w, "failed to prepare migration target", http.StatusBadGateway)
		return
	}
	var migrationID string
	if err := conn.QueryRow(ctx, `
		INSERT INTO storage_migrations
		  (org_id, source_connection_id, target_provider, target_config_enc, target_bucket_name, object_prefix, status, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,'running',$7)
		RETURNING id::text`, orgID, sourceConnectionID, request.Provider, targetCiphertext, bucket, request.Prefix, userID).Scan(&migrationID); err != nil {
		http.Error(w, "failed to create migration job", http.StatusInternalServerError)
		return
	}
	body, _ := json.Marshal(map[string]string{
		"source_provider": sourceProvider, "source_ciphertext": sourceCiphertext,
		"target_provider": request.Provider, "target_ciphertext": targetCiphertext,
		"prefix": request.Prefix,
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, storageWorkerURL()+"/internal/migrate-encrypted", bytes.NewReader(body))
	if err != nil {
		_, _ = conn.Exec(ctx, `UPDATE storage_migrations SET status='failed', error_code='worker_unavailable', updated_at=now() WHERE id=$1`, migrationID)
		http.Error(w, "failed to prepare migration", http.StatusBadGateway)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{Timeout: 5 * time.Minute}).Do(req)
	if err != nil {
		_, _ = conn.Exec(ctx, `UPDATE storage_migrations SET status='failed', error_code='worker_unavailable', updated_at=now() WHERE id=$1`, migrationID)
		http.Error(w, "storage migration unavailable", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	w.Header().Set("Content-Type", "application/json")
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		var result struct {
			Objects int `json:"objects"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&result); err == nil {
			_, _ = conn.Exec(ctx, `UPDATE storage_migrations SET status='completed', objects_copied=$2, updated_at=now(), completed_at=now() WHERE id=$1`, migrationID, result.Objects)
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{"id": migrationID, "status": "completed", "objects": result.Objects, "changes_applied": false})
			return
		}
	}
	_, _ = conn.Exec(ctx, `UPDATE storage_migrations SET status='failed', error_code='copy_failed', updated_at=now() WHERE id=$1`, migrationID)
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

func storageMigrationRetryHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	orgID, migrationID := r.PathValue("org_id"), r.PathValue("migration_id")
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
		dsn = "******localhost:5432/byos?sslmode=disable"
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Minute)
	defer cancel()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)
	tx, err := conn.Begin(ctx)
	if err != nil {
		http.Error(w, "failed to begin migration retry", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)

	var sourceProvider, sourceCiphertext, targetProvider, targetCiphertext, prefix, status string
	var retryCount int
	err = tx.QueryRow(ctx, `
			SELECT source.provider, source.config->>'ciphertext',
			       sm.target_provider, sm.target_config_enc, sm.object_prefix,
			       sm.status, sm.retry_count
			FROM storage_migrations sm
			JOIN users u ON u.org_id=sm.org_id
			JOIN storage_connections source ON source.id=sm.source_connection_id
			WHERE sm.id=$1 AND sm.org_id=$2 AND u.id=$3 AND u.is_active=true
			FOR UPDATE`, migrationID, orgID, userID).
		Scan(&sourceProvider, &sourceCiphertext, &targetProvider, &targetCiphertext, &prefix, &status, &retryCount)
	if err != nil {
		http.Error(w, "migration not found", http.StatusNotFound)
		return
	}
	if status == "completed" {
		http.Error(w, "migration is already completed", http.StatusConflict)
		return
	}
	if status == "running" {
		http.Error(w, "migration is already running", http.StatusConflict)
		return
	}
	if status != "failed" {
		http.Error(w, "only failed migrations can be retried", http.StatusConflict)
		return
	}
	if _, err := tx.Exec(ctx, `
			UPDATE storage_migrations
			SET status='running', error_code=NULL, retry_count=retry_count+1,
			    started_at=now(), updated_at=now()
			WHERE id=$1`, migrationID); err != nil {
		http.Error(w, "failed to start migration retry", http.StatusInternalServerError)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "failed to commit migration retry", http.StatusInternalServerError)
		return
	}

	body, err := json.Marshal(map[string]string{
		"source_provider": sourceProvider, "source_ciphertext": sourceCiphertext,
		"target_provider": targetProvider, "target_ciphertext": targetCiphertext,
		"prefix": prefix,
	})
	if err != nil {
		http.Error(w, "failed to prepare migration retry", http.StatusInternalServerError)
		return
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, storageWorkerURL()+"/internal/migrate-encrypted", bytes.NewReader(body))
	if err != nil {
		_, _ = conn.Exec(ctx, `UPDATE storage_migrations SET status='failed', error_code='worker_unavailable', updated_at=now() WHERE id=$1`, migrationID)
		http.Error(w, "failed to prepare migration retry", http.StatusBadGateway)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{Timeout: 5 * time.Minute}).Do(req)
	if err != nil {
		_, _ = conn.Exec(ctx, `UPDATE storage_migrations SET status='failed', error_code='worker_unavailable', updated_at=now() WHERE id=$1`, migrationID)
		http.Error(w, "storage migration unavailable", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		var result struct {
			Objects int `json:"objects"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&result); err == nil {
			_, _ = conn.Exec(ctx, `
					UPDATE storage_migrations
					SET status='completed', objects_copied=$2, error_code=NULL,
					    updated_at=now(), completed_at=now()
					WHERE id=$1`, migrationID, result.Objects)
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(map[string]interface{}{"id": migrationID, "status": "completed", "objects": result.Objects, "retry_count": retryCount + 1})
			return
		}
	}
	_, _ = conn.Exec(ctx, `UPDATE storage_migrations SET status='failed', error_code='copy_failed', updated_at=now() WHERE id=$1`, migrationID)
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

func storageMigrationStatusHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	orgID := r.PathValue("org_id")
	migrationID := r.PathValue("migration_id")
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
		dsn = "******localhost:5432/byos?sslmode=disable"
	}
	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)
	var status, errorCode string
	var copied, retryCount int
	if err := conn.QueryRow(ctx, `
		SELECT sm.status, COALESCE(sm.error_code,''), sm.objects_copied, sm.retry_count
		FROM storage_migrations sm JOIN users u ON u.org_id=sm.org_id
		WHERE sm.id=$1 AND sm.org_id=$2 AND u.id=$3 AND u.is_active=true`,
		migrationID, orgID, userID).Scan(&status, &errorCode, &copied, &retryCount); err != nil {
		http.Error(w, "migration not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"id": migrationID, "status": status, "objects": copied, "error_code": errorCode, "retry_count": retryCount})
}

type StorageConnectionResponse struct {
	ID          string     `json:"id"`
	Provider    string     `json:"provider"`
	Encrypted   bool       `json:"encrypted"`
	Status      string     `json:"status"`
	BucketName  string     `json:"bucket_name"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
	LastChecked *time.Time `json:"last_checked,omitempty"`
	ErrorCode   string     `json:"error_code,omitempty"`
}

func trimSpace(s string) string {
	return strings.TrimSpace(s)
}

func toJSON(v map[string]interface{}) string {
	b, err := json.Marshal(v)
	if err != nil {
		return "{}"
	}
	return string(b)
}

func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "duplicate") || strings.Contains(msg, "unique") || strings.Contains(msg, "violates unique")
}

// validateStorageConfig enforces provider-specific config rules.
// Returns normalized bucket/endpoint/region for persistence.
func validateStorageConfig(provider string, config map[string]interface{}) (bucket, endpoint, region string, err error) {
	if config == nil {
		config = map[string]interface{}{}
	}
	switch provider {
	case "s3", "minio":
		allowed := map[string]bool{"endpoint": true, "bucket": true, "access_key": true, "secret_key": true, "region": true, "path_style": true}
		for k := range config {
			if !allowed[k] {
				return "", "", "", fmt.Errorf("unknown field %q", k)
			}
		}
		getStr := func(k string) (string, bool) {
			v, ok := config[k]
			if !ok {
				return "", false
			}
			s, ok := v.(string)
			return s, ok
		}
		endpoint, _ = getStr("endpoint")
		bucket, _ = getStr("bucket")
		accessKey, _ := getStr("access_key")
		secretKey, _ := getStr("secret_key")
		if trimSpace(endpoint) == "" || trimSpace(bucket) == "" || trimSpace(accessKey) == "" || trimSpace(secretKey) == "" {
			return "", "", "", fmt.Errorf("endpoint, bucket, access_key and secret_key are required and non-empty")
		}
		if rv, ok := config["region"]; ok {
			rs, ok := rv.(string)
			if !ok {
				return "", "", "", fmt.Errorf("region must be a string")
			}
			region = rs
		}
		if pv, ok := config["path_style"]; ok {
			if _, ok := pv.(bool); !ok {
				return "", "", "", fmt.Errorf("path_style must be a boolean")
			}
		}
		return bucket, endpoint, region, nil
	case "google_drive_mock":
		allowed := map[string]bool{"root": true}
		for k := range config {
			if !allowed[k] {
				return "", "", "", fmt.Errorf("unknown field %q", k)
			}
		}
		if rv, ok := config["root"]; ok {
			rs, ok := rv.(string)
			if !ok {
				return "", "", "", fmt.Errorf("root must be a string")
			}
			bucket = rs
		}
		return bucket, "", "", nil
	case "google_drive":
		allowed := map[string]bool{"access_token": true, "refresh_token": true, "folder_id": true}
		for k := range config {
			if !allowed[k] {
				return "", "", "", fmt.Errorf("unknown field %q", k)
			}
		}
		token, _ := config["access_token"].(string)
		if trimSpace(token) == "" {
			return "", "", "", fmt.Errorf("access_token is required")
		}
		folderID, _ := config["folder_id"].(string)
		return folderID, "", "", nil
	default:
		return "", "", "", fmt.Errorf("invalid provider")
	}
}

func storageWorkerURL() string {
	if u := os.Getenv("STORAGE_WORKER_URL"); u != "" {
		return u
	}
	return "http://storage-worker:8083"
}

// encryptStorageConfig sends plaintext config JSON to storage-worker for
// DEK encryption. The API never sees the DEK.
func encryptStorageConfig(ctx context.Context, configJSON string) (string, error) {
	body, _ := json.Marshal(map[string]string{"plaintext": configJSON})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, storageWorkerURL()+"/internal/encrypt", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(http.MaxBytesReader(nil, resp.Body, 1<<20))
	if err != nil {
		return "", err
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("storage worker encrypt failed: %s", strings.TrimSpace(string(respBody)))
	}
	var out struct {
		Ciphertext string `json:"ciphertext"`
	}
	if err := json.Unmarshal(respBody, &out); err != nil || out.Ciphertext == "" {
		return "", fmt.Errorf("invalid encrypt response")
	}
	return out.Ciphertext, nil
}

func storageConnectionToResponse(id, provider string, encrypted bool, status, bucket string, createdAt, updatedAt time.Time, lastChecked *time.Time, errorCode string) map[string]interface{} {
	resp := map[string]interface{}{
		"id":          id,
		"provider":    provider,
		"encrypted":   encrypted,
		"status":      status,
		"bucket_name": bucket,
		"created_at":  createdAt.Format(time.RFC3339),
		"updated_at":  updatedAt.Format(time.RFC3339),
	}
	if lastChecked != nil {
		resp["last_checked"] = lastChecked.Format(time.RFC3339)
	}
	if errorCode != "" {
		resp["error_code"] = errorCode
	}
	return resp
}

func storageConnectionHandler(w http.ResponseWriter, r *http.Request) {
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

	switch r.Method {
	case http.MethodGet:
		storageConnectionGetHandler(w, r, orgID, conn, userID)
	case http.MethodPost:
		storageConnectionCreateHandler(w, r, orgID, conn, userID)
	case http.MethodPut:
		storageConnectionUpdateHandler(w, r, orgID, conn, userID)
	case http.MethodDelete:
		storageConnectionDeleteHandler(w, r, orgID, conn, userID)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func storageMigrationPreflightHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	orgID := r.PathValue("org_id")
	if _, err := uuid.Parse(orgID); err != nil {
		http.Error(w, "organization ID must be UUID", http.StatusBadRequest)
		return
	}
	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "missing or invalid X-User-Id", http.StatusUnauthorized)
		return
	}
	var request StorageConnectionRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&request); err != nil {
		http.Error(w, "invalid migration target", http.StatusBadRequest)
		return
	}
	if _, _, _, err := validateStorageConfig(request.Provider, request.Config); err != nil {
		http.Error(w, "invalid migration target: "+err.Error(), http.StatusBadRequest)
		return
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "******localhost:5432/byos?sslmode=disable"
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	var memberID, sourceProvider, sourceCiphertext string
	err = conn.QueryRow(ctx, `
		SELECT u.id::text, sc.provider, sc.config->>'ciphertext'
		FROM users u
		JOIN storage_connections sc ON sc.org_id=u.org_id
		WHERE u.id=$1 AND u.org_id=$2 AND u.is_active=true
		  AND sc.status IN ('active','error')
		ORDER BY sc.updated_at DESC
		LIMIT 1`, userID, orgID).Scan(&memberID, &sourceProvider, &sourceCiphertext)
	if err != nil {
		http.Error(w, "no active storage connection found", http.StatusNotFound)
		return
	}

	targetCiphertext, err := encryptStorageConfig(ctx, toJSON(request.Config))
	if err != nil {
		http.Error(w, "failed to prepare migration target", http.StatusBadGateway)
		return
	}
	sourceCode := testEncryptedStorage(sourceProvider, sourceCiphertext)
	targetCode := testEncryptedStorage(request.Provider, targetCiphertext)
	w.Header().Set("Content-Type", "application/json")
	status := http.StatusOK
	result := "ready"
	if sourceCode != "verified" || targetCode != "verified" {
		status = http.StatusConflict
		result = "blocked"
	}
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":          result,
		"source":          map[string]string{"status": sourceCode},
		"target":          map[string]string{"provider": request.Provider, "status": targetCode},
		"changes_applied": false,
	})
}

func storageMigrationCutoverHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	orgID, migrationID := r.PathValue("org_id"), r.PathValue("migration_id")
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
		dsn = "postgres://postgres:postgres@localhost:5432/byos?sslmode=disable"
	}
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)
	tx, err := conn.Begin(ctx)
	if err != nil {
		http.Error(w, "failed to begin cutover", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)
	var memberID string
	if err := tx.QueryRow(ctx, `SELECT id::text FROM users WHERE id=$1 AND org_id=$2 AND is_active=true`, userID, orgID).Scan(&memberID); err != nil {
		http.Error(w, "not authorized for this organization", http.StatusForbidden)
		return
	}
	var lockedOrgID string
	if err := tx.QueryRow(ctx, `SELECT id::text FROM organizations WHERE id=$1 FOR UPDATE`, orgID).Scan(&lockedOrgID); err != nil {
		http.Error(w, "organization not found", http.StatusNotFound)
		return
	}
	var status, targetProvider, targetConfig, targetBucket, sourceConnectionID string
	var cutoverApplied bool
	var targetConnectionID *string
	err = tx.QueryRow(ctx, `
		SELECT status, target_provider, target_config_enc, target_bucket_name,
		       source_connection_id::text, target_connection_id::text, cutover_applied
		FROM storage_migrations
		WHERE id=$1 AND org_id=$2
		FOR UPDATE`, migrationID, orgID).Scan(&status, &targetProvider, &targetConfig, &targetBucket, &sourceConnectionID, &targetConnectionID, &cutoverApplied)
	if err != nil {
		http.Error(w, "migration not found", http.StatusNotFound)
		return
	}
	if cutoverApplied && targetConnectionID != nil {
		if err := tx.Commit(ctx); err != nil {
			http.Error(w, "failed to commit cutover", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"status": "cutover", "target_connection_id": *targetConnectionID})
		return
	}
	if status != "completed" {
		http.Error(w, "migration is not completed", http.StatusConflict)
		return
	}
	var newConnectionID string
	err = tx.QueryRow(ctx, `
		INSERT INTO storage_connections
		  (org_id, provider_type, provider, bucket_name, credentials_enc, config, is_active, encrypted, status)
		VALUES ($1,$2,$2,$3,''::bytea,jsonb_build_object('ciphertext',$4::text),true,true,'active')
		RETURNING id::text`, orgID, targetProvider, targetBucket, targetConfig).Scan(&newConnectionID)
	if err != nil {
		http.Error(w, "failed to create target connection", http.StatusInternalServerError)
		return
	}
	if _, err := tx.Exec(ctx, `
		UPDATE mailbox_storage SET storage_connection_id=$1, status='active', updated_at=now()
		WHERE storage_connection_id=$2`, newConnectionID, sourceConnectionID); err != nil {
		http.Error(w, "failed to switch mailbox mappings", http.StatusInternalServerError)
		return
	}
	if _, err := tx.Exec(ctx, `
		UPDATE organizations SET default_storage_connection_id=$1
		WHERE id=$2 AND default_storage_connection_id=$3`, newConnectionID, orgID, sourceConnectionID); err != nil {
		http.Error(w, "failed to switch organization default", http.StatusInternalServerError)
		return
	}
	if _, err := tx.Exec(ctx, `
		UPDATE storage_migrations
		SET target_connection_id=$1, cutover_applied=true, updated_at=now()
		WHERE id=$2`, newConnectionID, migrationID); err != nil {
		http.Error(w, "failed to record cutover", http.StatusInternalServerError)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "failed to commit cutover", http.StatusInternalServerError)
		return
	}
	auditLog(ctx, conn, orgID, userID, "storage_migration_cutover", "storage_migration", migrationID, map[string]interface{}{"target_connection_id": newConnectionID})
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"status": "cutover", "target_connection_id": newConnectionID})
}

func storageConnectionGetHandler(w http.ResponseWriter, r *http.Request, orgID string, conn *pgx.Conn, userID string) {
	ctx := context.Background()
	var id, provider, status, bucket string
	var encrypted bool
	var createdAt, updatedAt time.Time
	var lastChecked *time.Time
	var errorMessage *string
	err := conn.QueryRow(ctx, `SELECT id::text, provider, encrypted, status, bucket_name, created_at, updated_at, last_checked, error_message FROM storage_connections WHERE org_id=$1 AND status IN ('active','error') ORDER BY updated_at DESC LIMIT 1`, orgID).Scan(&id, &provider, &encrypted, &status, &bucket, &createdAt, &updatedAt, &lastChecked, &errorMessage)
	if err != nil {
		http.Error(w, "no storage connection found", http.StatusNotFound)
		return
	}
	var errorCode string
	if status == "error" && errorMessage != nil {
		errorCode = *errorMessage
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(storageConnectionToResponse(id, provider, encrypted, status, bucket, createdAt, updatedAt, lastChecked, errorCode))
}

func storageConnectionCreateHandler(w http.ResponseWriter, r *http.Request, orgID string, conn *pgx.Conn, userID string) {
	ctx := context.Background()
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var req StorageConnectionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	// Serialize creation under the org row lock: exactly one active
	// connection per org (second concurrent POST -> 409).
	tx, err := conn.Begin(ctx)
	if err != nil {
		http.Error(w, "Failed to begin transaction", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)
	var orgExists string
	err = tx.QueryRow(ctx, `SELECT id::text FROM organizations WHERE id=$1 FOR UPDATE`, orgID).Scan(&orgExists)
	if err != nil {
		http.Error(w, "organization not found", http.StatusNotFound)
		return
	}
	var existingID string
	err = tx.QueryRow(ctx, `SELECT id::text FROM storage_connections WHERE org_id=$1 AND status='active' LIMIT 1`, orgID).Scan(&existingID)
	if err == nil {
		http.Error(w, "storage connection already exists", http.StatusConflict)
		return
	}
	bucket, endpoint, region, verr := validateStorageConfig(req.Provider, req.Config)
	if verr != nil {
		http.Error(w, verr.Error(), http.StatusBadRequest)
		return
	}
	configJSON, _ := json.Marshal(req.Config)
	ciphertext, err := encryptStorageConfig(ctx, string(configJSON))
	if err != nil {
		http.Error(w, "storage worker unavailable", http.StatusBadGateway)
		return
	}
	var newID string
	var createdAt, updatedAt time.Time
	err = tx.QueryRow(ctx, `INSERT INTO storage_connections (org_id, provider, provider_type, bucket_name, endpoint, region, config, encrypted, credentials_enc, status) VALUES ($1, $2, $2, $3, $4, $5, jsonb_build_object('ciphertext', $6::text), true, ''::bytea, 'active') RETURNING id::text, created_at, updated_at`, orgID, req.Provider, bucket, endpoint, region, ciphertext).Scan(&newID, &createdAt, &updatedAt)
	if err != nil {
		if isUniqueViolation(err) {
			http.Error(w, "storage connection already exists", http.StatusConflict)
			return
		}
		http.Error(w, "failed to create storage connection", http.StatusInternalServerError)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "failed to commit", http.StatusInternalServerError)
		return
	}
	auditLog(ctx, conn, orgID, userID, "storage_connection_create", "storage_connection", newID, map[string]interface{}{"provider": req.Provider})
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(storageConnectionToResponse(newID, req.Provider, true, "active", bucket, createdAt, updatedAt, nil, ""))
}

func storageConnectionUpdateHandler(w http.ResponseWriter, r *http.Request, orgID string, conn *pgx.Conn, userID string) {
	ctx := context.Background()
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	var req StorageConnectionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}
	tx, err := conn.Begin(ctx)
	if err != nil {
		http.Error(w, "Failed to begin transaction", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)
	var orgExists string
	err = tx.QueryRow(ctx, `SELECT id::text FROM organizations WHERE id=$1 FOR UPDATE`, orgID).Scan(&orgExists)
	if err != nil {
		http.Error(w, "organization not found", http.StatusNotFound)
		return
	}
	var targetID string
	err = tx.QueryRow(ctx, `SELECT id::text FROM storage_connections WHERE org_id=$1 AND status IN ('active','error') ORDER BY updated_at DESC LIMIT 1`, orgID).Scan(&targetID)
	if err != nil {
		http.Error(w, "no storage connection found", http.StatusNotFound)
		return
	}
	bucket, endpoint, region, verr := validateStorageConfig(req.Provider, req.Config)
	if verr != nil {
		http.Error(w, verr.Error(), http.StatusBadRequest)
		return
	}
	configJSON, _ := json.Marshal(req.Config)
	ciphertext, err := encryptStorageConfig(ctx, string(configJSON))
	if err != nil {
		http.Error(w, "storage worker unavailable", http.StatusBadGateway)
		return
	}
	// Rotation resets health to active with no last check.
	var updatedAt time.Time
	var createdAt time.Time
	err = tx.QueryRow(ctx, `UPDATE storage_connections SET provider=$1, provider_type=$1, bucket_name=$2, endpoint=$3, region=$4, config=jsonb_build_object('ciphertext', $5::text), encrypted=true, status='active', last_checked=NULL, error_message=NULL, updated_at=now() WHERE id=$6 RETURNING created_at, updated_at`, req.Provider, bucket, endpoint, region, ciphertext, targetID).Scan(&createdAt, &updatedAt)
	if err != nil {
		http.Error(w, "failed to rotate storage connection", http.StatusInternalServerError)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "failed to commit", http.StatusInternalServerError)
		return
	}
	auditLog(ctx, conn, orgID, userID, "storage_connection_rotate", "storage_connection", targetID, map[string]interface{}{"provider": req.Provider})
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(storageConnectionToResponse(targetID, req.Provider, true, "active", bucket, createdAt, updatedAt, nil, ""))
}

func storageConnectionDeleteHandler(w http.ResponseWriter, r *http.Request, orgID string, conn *pgx.Conn, userID string) {
	ctx := context.Background()
	tx, err := conn.Begin(ctx)
	if err != nil {
		http.Error(w, "Failed to begin transaction", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)
	var orgExists string
	err = tx.QueryRow(ctx, `SELECT id::text FROM organizations WHERE id=$1 FOR UPDATE`, orgID).Scan(&orgExists)
	if err != nil {
		http.Error(w, "organization not found", http.StatusNotFound)
		return
	}
	var targetID string
	err = tx.QueryRow(ctx, `SELECT id::text FROM storage_connections WHERE org_id=$1 AND status IN ('active','error') ORDER BY updated_at DESC LIMIT 1`, orgID).Scan(&targetID)
	if err != nil {
		http.Error(w, "no storage connection found", http.StatusNotFound)
		return
	}
	// Soft-delete with tombstone; mailbox_storage rows are preserved so no
	// silent fallback to another connection can occur.
	_, err = tx.Exec(ctx, `UPDATE storage_connections SET status='deleted', config='{"tombstone":true}', credentials_enc=''::bytea, updated_at=now() WHERE id=$1`, targetID)
	if err != nil {
		http.Error(w, "failed to delete storage connection", http.StatusInternalServerError)
		return
	}
	// Clear the org default if it pointed at the deleted connection.
	_, _ = tx.Exec(ctx, `UPDATE organizations SET default_storage_connection_id=NULL WHERE id=$1 AND default_storage_connection_id=$2`, orgID, targetID)
	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "failed to commit", http.StatusInternalServerError)
		return
	}
	auditLog(ctx, conn, orgID, userID, "storage_connection_delete", "storage_connection", targetID, nil)
	w.WriteHeader(http.StatusNoContent)
}

func storageConnectionTestHandler(w http.ResponseWriter, r *http.Request) {
	// Evidence: route POST .../storage/connection/test (no body);
	// storage_connectivity.ps1 (6 behaviors); frontend testStorageConnection
	// (200 with code; 409 configuration_changed; 403; 404).
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
	var connID, provider, ciphertext string
	var capturedAt time.Time
	err = conn.QueryRow(ctx, `SELECT id::text, provider, config->>'ciphertext', updated_at FROM storage_connections WHERE org_id=$1 AND status IN ('active','error') ORDER BY updated_at DESC LIMIT 1`, orgID).Scan(&connID, &provider, &ciphertext, &capturedAt)
	if err != nil {
		http.Error(w, "no storage connection found", http.StatusNotFound)
		return
	}
	// Run the provider test outside any transaction (may take seconds).
	testBody, _ := json.Marshal(map[string]string{"provider": provider, "ciphertext": ciphertext})
	testReq, err := http.NewRequestWithContext(ctx, http.MethodPost, storageWorkerURL()+"/internal/test-encrypted", bytes.NewReader(testBody))
	if err != nil {
		http.Error(w, "storage worker unavailable", http.StatusBadGateway)
		return
	}
	testReq.Header.Set("Content-Type", "application/json")
	testClient := &http.Client{Timeout: 15 * time.Second}
	testResp, err := testClient.Do(testReq)
	if err != nil {
		http.Error(w, "storage worker unavailable", http.StatusBadGateway)
		return
	}
	defer testResp.Body.Close()
	testBytes, err := io.ReadAll(http.MaxBytesReader(nil, testResp.Body, 1<<20))
	if err != nil {
		http.Error(w, "invalid test response", http.StatusBadGateway)
		return
	}
	var testOut struct {
		Status string `json:"status"`
		Code   string `json:"code"`
	}
	if err := json.Unmarshal(testBytes, &testOut); err != nil || testOut.Code == "" {
		http.Error(w, "invalid test response", http.StatusBadGateway)
		return
	}
	// Short transaction: verify the connection row was not rotated while the
	// test was running (stale-test protection).
	tx, err := conn.Begin(ctx)
	if err != nil {
		http.Error(w, "Failed to begin transaction", http.StatusInternalServerError)
		return
	}
	defer tx.Rollback(ctx)
	var orgExists string
	err = tx.QueryRow(ctx, `SELECT id::text FROM organizations WHERE id=$1 FOR UPDATE`, orgID).Scan(&orgExists)
	if err != nil {
		http.Error(w, "organization not found", http.StatusNotFound)
		return
	}
	var currentUpdated time.Time
	err = tx.QueryRow(ctx, `SELECT updated_at FROM storage_connections WHERE id=$1`, connID).Scan(&currentUpdated)
	if err != nil || !currentUpdated.Equal(capturedAt) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusConflict)
		json.NewEncoder(w).Encode(map[string]string{"status": "error", "code": "configuration_changed", "message": "storage configuration changed while the test was running"})
		return
	}
	now := time.Now()
	if testOut.Code == "verified" {
		_, err = tx.Exec(ctx, `UPDATE storage_connections SET status='active', last_checked=$1, error_message=NULL, updated_at=$1 WHERE id=$2`, now, connID)
	} else {
		_, err = tx.Exec(ctx, `UPDATE storage_connections SET status='error', last_checked=$1, error_message=$2, updated_at=$1 WHERE id=$3`, now, testOut.Code, connID)
	}
	if err != nil {
		http.Error(w, "failed to record test result", http.StatusInternalServerError)
		return
	}
	if err := tx.Commit(ctx); err != nil {
		http.Error(w, "failed to commit", http.StatusInternalServerError)
		return
	}
	status := "ok"
	if testOut.Code != "verified" {
		status = "error"
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":       status,
		"code":         testOut.Code,
		"last_checked": now.Format(time.RFC3339),
	})
}
