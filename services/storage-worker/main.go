package main

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

var ErrStorageDisconnected = errors.New("storage_disconnected")

// Internal caller authentication (SEC-001/SEC-002/SEC-003).
// The storage-worker listener is internal-only (docker `expose`, no published
// port), but network isolation alone lets any in-network caller read/write
// mailbox objects and use the /internal/* crypto helpers. API and mail-router
// callers present a shared secret in X-Internal-Key; the worker compares in
// constant time. The secret is provisioned like other service secrets:
// STORAGE_WORKER_INTERNAL_KEY or STORAGE_WORKER_INTERNAL_KEY_FILE
// (default /run/secrets/storage_worker_internal_key). Enforcement is fail
// closed: when the secret is missing the worker refuses the request instead
// of silently operating unauthenticated.

func loadInternalKey() string {
	if v := strings.TrimSpace(os.Getenv("STORAGE_WORKER_INTERNAL_KEY")); v != "" {
		return v
	}
	path := strings.TrimSpace(os.Getenv("STORAGE_WORKER_INTERNAL_KEY_FILE"))
	if path == "" {
		path = "/run/secrets/storage_worker_internal_key"
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

func requireInternalKey(resp http.ResponseWriter, req *http.Request) bool {
	expected := loadInternalKey()
	if expected == "" {
		http.Error(resp, "storage-worker internal auth not configured (set STORAGE_WORKER_INTERNAL_KEY or STORAGE_WORKER_INTERNAL_KEY_FILE)", http.StatusServiceUnavailable)
		return false
	}
	got := strings.TrimSpace(req.Header.Get("X-Internal-Key"))
	if got == "" || subtle.ConstantTimeCompare([]byte(got), []byte(expected)) != 1 {
		http.Error(resp, "forbidden", http.StatusForbidden)
		return false
	}
	return true
}

// Storage interface for BYOS providers
type Storage interface {
	PutObject(ctx context.Context, bucket, key string, r io.Reader, size int64) error
	GetObject(ctx context.Context, bucket, key string) (io.ReadCloser, error)
	DeleteObject(ctx context.Context, bucket, key string) error
	HeadObject(ctx context.Context, bucket, key string) (ObjectInfo, error)
	ListObjects(ctx context.Context, bucket, prefix string) ([]ObjectInfo, error)
	TestConnection(ctx context.Context) error
}

type ObjectInfo struct {
	Key          string    `json:"key"`
	Size         int64     `json:"size"`
	LastModified time.Time `json:"lastModified"`
}

type GoogleDriveStorage struct {
	accessToken string
	folderID    string
	client      *http.Client
}

func NewGoogleDriveStorage(accessToken, folderID string) (*GoogleDriveStorage, error) {
	if strings.TrimSpace(accessToken) == "" {
		return nil, fmt.Errorf("google drive access_token is required")
	}
	return &GoogleDriveStorage{accessToken: accessToken, folderID: folderID, client: &http.Client{Timeout: 2 * time.Minute}}, nil
}

func (g *GoogleDriveStorage) request(ctx context.Context, method, endpoint string, body io.Reader, contentType string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+g.accessToken)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	return g.client.Do(req)
}

func (g *GoogleDriveStorage) PutObject(ctx context.Context, bucket, key string, r io.Reader, size int64) error {
	data, err := io.ReadAll(io.LimitReader(r, size+1))
	if err != nil {
		return err
	}
	if int64(len(data)) != size {
		return fmt.Errorf("object size mismatch")
	}
	meta := map[string]interface{}{"name": filepath.Base(key), "appProperties": map[string]string{"byos_object_key": key}}
	if g.folderID != "" {
		meta["parents"] = []string{g.folderID}
	}
	metaJSON, _ := json.Marshal(meta)
	boundary := "byos-drive-boundary"
	var payload bytes.Buffer
	payload.WriteString("--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n")
	payload.Write(metaJSON)
	payload.WriteString("\r\n--" + boundary + "\r\nContent-Type: application/octet-stream\r\n\r\n")
	payload.Write(data)
	payload.WriteString("\r\n--" + boundary + "--\r\n")
	resp, err := g.request(ctx, http.MethodPost, "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", &payload, "multipart/related; boundary="+boundary)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("google drive upload returned %s", resp.Status)
	}
	return nil
}

func (g *GoogleDriveStorage) find(ctx context.Context, key string) (string, int64, error) {
	q := "trashed = false and appProperties has { key = 'byos_object_key' and value = '" + strings.ReplaceAll(key, "'", "\\'") + "' }"
	endpoint := "https://www.googleapis.com/drive/v3/files?fields=files(id,size,appProperties)&pageSize=10&q=" + url.QueryEscape(q)
	resp, err := g.request(ctx, http.MethodGet, endpoint, nil, "")
	if err != nil {
		return "", 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", 0, fmt.Errorf("google drive list returned %s", resp.Status)
	}
	var result struct {
		Files []struct {
			ID            string            `json:"id"`
			Size          int64             `json:"size,string"`
			AppProperties map[string]string `json:"appProperties"`
		} `json:"files"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", 0, err
	}
	if len(result.Files) == 0 {
		return "", 0, os.ErrNotExist
	}
	return result.Files[0].ID, result.Files[0].Size, nil
}

func (g *GoogleDriveStorage) GetObject(ctx context.Context, bucket, key string) (io.ReadCloser, error) {
	id, _, err := g.find(ctx, key)
	if err != nil {
		return nil, err
	}
	resp, err := g.request(ctx, http.MethodGet, "https://www.googleapis.com/drive/v3/files/"+url.PathEscape(id)+"?alt=media", nil, "")
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		resp.Body.Close()
		return nil, fmt.Errorf("google drive download returned %s", resp.Status)
	}
	return resp.Body, nil
}

func (g *GoogleDriveStorage) DeleteObject(ctx context.Context, bucket, key string) error {
	id, _, err := g.find(ctx, key)
	if err != nil {
		return err
	}
	resp, err := g.request(ctx, http.MethodDelete, "https://www.googleapis.com/drive/v3/files/"+url.PathEscape(id), nil, "")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("google drive delete returned %s", resp.Status)
	}
	return nil
}

func (g *GoogleDriveStorage) HeadObject(ctx context.Context, bucket, key string) (ObjectInfo, error) {
	_, size, err := g.find(ctx, key)
	if err != nil {
		return ObjectInfo{}, err
	}
	return ObjectInfo{Key: key, Size: size}, nil
}

func (g *GoogleDriveStorage) ListObjects(ctx context.Context, bucket, prefix string) ([]ObjectInfo, error) {
	q := "trashed = false and appProperties has { key = 'byos_object_key' }"
	endpoint := "https://www.googleapis.com/drive/v3/files?fields=files(size,appProperties)&pageSize=1000&q=" + url.QueryEscape(q)
	resp, err := g.request(ctx, http.MethodGet, endpoint, nil, "")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("google drive list returned %s", resp.Status)
	}
	var result struct {
		Files []struct {
			Size          int64             `json:"size,string"`
			AppProperties map[string]string `json:"appProperties"`
		} `json:"files"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	objects := []ObjectInfo{}
	for _, file := range result.Files {
		key := file.AppProperties["byos_object_key"]
		if strings.HasPrefix(key, prefix) {
			objects = append(objects, ObjectInfo{Key: key, Size: file.Size})
		}
	}
	return objects, nil
}

func (g *GoogleDriveStorage) TestConnection(ctx context.Context) error {
	resp, err := g.request(ctx, http.MethodGet, "https://www.googleapis.com/drive/v3/about?fields=user", nil, "")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("google drive authentication returned %s", resp.Status)
	}
	return nil
}

// S3Storage implements Storage via minio-go (S3-compatible)
type S3Storage struct {
	client *minio.Client
	bucket string
}

func NewS3Storage(endpoint, accessKey, secretKey, bucket, region string, pathStyle bool) (*S3Storage, error) {
	opts := &minio.Options{
		Creds:  credentials.NewStaticV4(accessKey, secretKey, ""),
		Secure: false,
		Region: region,
	}
	// path_style is handled via BucketLookup
	if pathStyle {
		opts.BucketLookup = minio.BucketLookupPath
	}
	c, err := minio.New(endpoint, opts)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	exists, err := c.BucketExists(ctx, bucket)
	if err != nil {
		// Try to create bucket if not exists (dev convenience)
		_ = c.MakeBucket(ctx, bucket, minio.MakeBucketOptions{Region: region})
	} else if !exists {
		_ = c.MakeBucket(ctx, bucket, minio.MakeBucketOptions{Region: region})
	}
	return &S3Storage{client: c, bucket: bucket}, nil
}

func (s *S3Storage) PutObject(ctx context.Context, bucket, key string, r io.Reader, size int64) error {
	if bucket == "" {
		bucket = s.bucket
	}
	_, err := s.client.PutObject(ctx, bucket, key, r, size, minio.PutObjectOptions{ContentType: "application/octet-stream"})
	return err
}
func (s *S3Storage) GetObject(ctx context.Context, bucket, key string) (io.ReadCloser, error) {
	if bucket == "" {
		bucket = s.bucket
	}
	obj, err := s.client.GetObject(ctx, bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, err
	}
	return obj, nil
}
func (s *S3Storage) DeleteObject(ctx context.Context, bucket, key string) error {
	if bucket == "" {
		bucket = s.bucket
	}
	return s.client.RemoveObject(ctx, bucket, key, minio.RemoveObjectOptions{})
}
func (s *S3Storage) HeadObject(ctx context.Context, bucket, key string) (ObjectInfo, error) {
	if bucket == "" {
		bucket = s.bucket
	}
	info, err := s.client.StatObject(ctx, bucket, key, minio.StatObjectOptions{})
	if err != nil {
		return ObjectInfo{}, err
	}
	return ObjectInfo{Key: info.Key, Size: info.Size, LastModified: info.LastModified}, nil
}
func (s *S3Storage) ListObjects(ctx context.Context, bucket, prefix string) ([]ObjectInfo, error) {
	if bucket == "" {
		bucket = s.bucket
	}
	opts := minio.ListObjectsOptions{Prefix: prefix, Recursive: true}
	var res []ObjectInfo
	for obj := range s.client.ListObjects(ctx, bucket, opts) {
		if obj.Err != nil {
			return nil, obj.Err
		}
		res = append(res, ObjectInfo{Key: obj.Key, Size: obj.Size, LastModified: obj.LastModified})
	}
	return res, nil
}
func (s *S3Storage) TestConnection(ctx context.Context) error {
	_, err := s.client.ListBuckets(ctx)
	if err != nil {
		// fallback to HeadBucket
		exists, err2 := s.client.BucketExists(ctx, s.bucket)
		if err2 != nil {
			return err2
		}
		if !exists {
			return fmt.Errorf("bucket %s not exists", s.bucket)
		}
	}
	return nil
}

// MockDriveStorage implements Storage via filesystem (Google Drive mock)
type MockDriveStorage struct {
	root string
}

func NewMockDriveStorage(root string) (*MockDriveStorage, error) {
	if root == "" {
		root = "/tmp/byos-drive-mock"
	}
	if err := os.MkdirAll(root, 0755); err != nil {
		return nil, err
	}
	return &MockDriveStorage{root: root}, nil
}

func (m *MockDriveStorage) fullPath(bucket, key string) string {
	// For mock, ignore bucket or use as subdir; key may contain slashes
	// Use bucket as prefix if provided
	cleanKey := filepath.Clean(key)
	if bucket != "" {
		return filepath.Join(m.root, bucket, cleanKey)
	}
	return filepath.Join(m.root, cleanKey)
}

func (m *MockDriveStorage) PutObject(ctx context.Context, bucket, key string, r io.Reader, size int64) error {
	p := m.fullPath(bucket, key)
	dir := filepath.Dir(p)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	f, err := os.Create(p)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = io.Copy(f, r)
	return err
}
func (m *MockDriveStorage) GetObject(ctx context.Context, bucket, key string) (io.ReadCloser, error) {
	p := m.fullPath(bucket, key)
	f, err := os.Open(p)
	if err != nil {
		return nil, err
	}
	return f, nil
}
func (m *MockDriveStorage) DeleteObject(ctx context.Context, bucket, key string) error {
	p := m.fullPath(bucket, key)
	err := os.Remove(p)
	if err != nil && os.IsNotExist(err) {
		return nil
	}
	return err
}
func (m *MockDriveStorage) HeadObject(ctx context.Context, bucket, key string) (ObjectInfo, error) {
	p := m.fullPath(bucket, key)
	fi, err := os.Stat(p)
	if err != nil {
		return ObjectInfo{}, err
	}
	return ObjectInfo{Key: key, Size: fi.Size(), LastModified: fi.ModTime()}, nil
}
func (m *MockDriveStorage) ListObjects(ctx context.Context, bucket, prefix string) ([]ObjectInfo, error) {
	base := m.root
	if bucket != "" {
		base = filepath.Join(base, bucket)
	}
	if prefix != "" {
		base = filepath.Join(base, filepath.Dir(prefix))
		// If prefix contains dir, list that dir; otherwise list base
		if strings.Contains(prefix, "/") {
			base = filepath.Join(m.root, bucket, filepath.Dir(prefix))
		}
	}
	var res []ObjectInfo
	err := filepath.Walk(base, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			return nil
		}
		rel, _ := filepath.Rel(m.root, path)
		// Filter by prefix if provided
		if prefix != "" && !strings.HasPrefix(rel, prefix) && !strings.HasPrefix(filepath.Join(bucket, prefix), rel) {
			// For mock, simple contains check
			if !strings.Contains(rel, prefix) {
				return nil
			}
		}
		res = append(res, ObjectInfo{Key: rel, Size: info.Size(), LastModified: info.ModTime()})
		return nil
	})
	if err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	return res, nil
}
func (m *MockDriveStorage) TestConnection(ctx context.Context) error {
	if err := os.MkdirAll(m.root, 0755); err != nil {
		return err
	}
	// Check writable
	testFile := filepath.Join(m.root, ".test")
	if err := os.WriteFile(testFile, []byte("ok"), 0644); err != nil {
		return err
	}
	os.Remove(testFile)
	return nil
}

// Factory

func storageFromConfig(provider string, config map[string]interface{}) (Storage, error) {
	provider = strings.ToLower(provider)
	// Handle legacy provider_type values
	if provider == "minio" {
		provider = "s3"
	}
	switch provider {
	case "s3", "minio", "s3_compatible":
		endpoint, _ := config["endpoint"].(string)
		bucket, _ := config["bucket"].(string)
		accessKey, _ := config["access_key"].(string)
		if accessKey == "" {
			accessKey, _ = config["accessKey"].(string)
		}
		secretKey, _ := config["secret_key"].(string)
		if secretKey == "" {
			secretKey, _ = config["secretKey"].(string)
		}
		region, _ := config["region"].(string)
		pathStyle := true
		if v, ok := config["path_style"]; ok {
			if b, ok := v.(bool); ok {
				pathStyle = b
			}
		}
		if endpoint == "" {
			endpoint = os.Getenv("MINIO_ENDPOINT")
			if endpoint == "" {
				endpoint = "minio:9000"
			}
		}
		if bucket == "" {
			bucket = os.Getenv("MINIO_BUCKET")
			if bucket == "" {
				bucket = "byos-mailbox"
			}
		}
		if accessKey == "" {
			accessKey = os.Getenv("MINIO_ACCESS_KEY")
			if accessKey == "" {
				accessKey = "byosminio"
			}
		}
		if secretKey == "" {
			secretKey = os.Getenv("MINIO_SECRET_KEY")
			if secretKey == "" {
				secretKey = "byosminio_dev_password"
			}
		}
		return NewS3Storage(endpoint, accessKey, secretKey, bucket, region, pathStyle)
	case "google_drive_mock":
		root, _ := config["root"].(string)
		if root == "" {
			root = os.Getenv("BYOS_GOOGLE_DRIVE_MOCK_ROOT")
			if root == "" {
				root = "/tmp/byos-drive-mock"
			}
		}
		return NewMockDriveStorage(root)
	case "google_drive":
		accessToken, _ := config["access_token"].(string)
		folderID, _ := config["folder_id"].(string)
		return NewGoogleDriveStorage(accessToken, folderID)
	default:
		return nil, fmt.Errorf("unknown provider %s", provider)
	}
}

// Encryption helpers for storage config (DEK only in storage-worker)
// Storage credentials must always be encrypted at rest — no plaintext mode.
// DEK is exactly 32 random bytes, base64 is only transport encoding.

func loadStorageDEK() ([]byte, error) {
	path := os.Getenv("STORAGE_DEK_FILE")
	if path == "" {
		path = os.Getenv("BYOS_STORAGE_DEK_FILE")
	}
	if path == "" {
		path = "/run/secrets/storage_dek"
	}
	b64raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("storage DEK not found at %s: %w", path, err)
	}
	b64 := strings.TrimSpace(string(b64raw))
	dek, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return nil, fmt.Errorf("base64 decode DEK: %w", err)
	}
	if len(dek) != 32 {
		return nil, fmt.Errorf("DEK must be 32 bytes got %d", len(dek))
	}
	return dek, nil
}

func encryptWithDEK(plaintext []byte, dek []byte) (string, error) {
	block, err := aes.NewCipher(dek)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	ct := gcm.Seal(nil, nonce, plaintext, nil)
	combined := append(nonce, ct...)
	return base64.StdEncoding.EncodeToString(combined), nil
}

func decryptWithDEK(b64 string, dek []byte) ([]byte, error) {
	raw, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(dek)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if len(raw) < gcm.NonceSize() {
		return nil, fmt.Errorf("ciphertext too short")
	}
	nonce := raw[:gcm.NonceSize()]
	ct := raw[gcm.NonceSize():]
	return gcm.Open(nil, nonce, ct, nil)
}

// StorageWorker holds default S3 and DB for dynamic lookup

type StorageWorker struct {
	defaultStorage Storage
	defaultBucket  string
	dbURL          string
}

type StoreRequest struct {
	ObjectKey string            `json:"object_key"`
	Data      []byte            `json:"data"`
	Metadata  map[string]string `json:"metadata"`
	MailboxID string            `json:"mailbox_id,omitempty"`
	Bucket    string            `json:"bucket,omitempty"`
}

type RetrieveRequest struct {
	ObjectKey string `json:"object_key"`
	MailboxID string `json:"mailbox_id,omitempty"`
	Bucket    string `json:"bucket,omitempty"`
}

type RetrieveResponse struct {
	Data     []byte            `json:"data"`
	Metadata map[string]string `json:"metadata"`
	Size     int64             `json:"size"`
}

func main() {
	endpoint := os.Getenv("MINIO_ENDPOINT")
	if endpoint == "" {
		endpoint = "localhost:9000"
	}
	// In docker, use minio:9000
	if os.Getenv("MINIO_ENDPOINT") == "" && os.Getenv("MINIO_ADDR") != "" {
		endpoint = os.Getenv("MINIO_ADDR")
	}
	accessKey := os.Getenv("MINIO_ACCESS_KEY")
	if accessKey == "" {
		accessKey = "byosminio"
	}
	secretKey := os.Getenv("MINIO_SECRET_KEY")
	if secretKey == "" {
		secretKey = "byosminio_dev_password"
	}
	bucket := os.Getenv("MINIO_BUCKET")
	if bucket == "" {
		bucket = "byos-mailbox"
	}
	// Try to create default storage (S3)
	var defStorage Storage
	var err error
	defStorage, err = NewS3Storage(endpoint, accessKey, secretKey, bucket, "", true)
	if err != nil {
		log.Printf("Warning: failed to create default S3 storage: %v (will try per-request)", err)
		// Fallback to mock for local dev if MinIO not reachable
		mockRoot := os.Getenv("BYOS_GOOGLE_DRIVE_MOCK_ROOT")
		if mockRoot == "" {
			mockRoot = "/tmp/byos-drive-mock"
		}
		var mock Storage
		mock, _ = NewMockDriveStorage(mockRoot)
		defStorage = mock
		// If still nil, keep nil and handle per-request
	}

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		dbURL = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	// In docker, use postgres:5432
	if strings.Contains(dbURL, "localhost") && os.Getenv("DATABASE_URL") == "" {
		// Keep as localhost for host testing
	}

	worker := &StorageWorker{
		defaultStorage: defStorage,
		defaultBucket:  bucket,
		dbURL:          dbURL,
	}

	http.HandleFunc("/health", worker.healthHandler)
	http.HandleFunc("/api/store", worker.storeHandler)
	http.HandleFunc("/api/retrieve", worker.retrieveHandler)
	http.HandleFunc("/api/delete", worker.deleteHandler)
	http.HandleFunc("/api/list", worker.listHandler)
	http.HandleFunc("/api/head", worker.headHandler)
	// Internal endpoints (not exposed to host, but still via internal network)
	http.HandleFunc("/internal/encrypt", worker.encryptHandler)
	http.HandleFunc("/internal/decrypt", worker.decryptHandler)
	http.HandleFunc("/internal/test", worker.testHandler)
	http.HandleFunc("/internal/test-encrypted", worker.testEncryptedHandler)
	http.HandleFunc("/internal/migrate-encrypted", worker.migrateEncryptedHandler)
	http.HandleFunc("/internal/google-drive-refresh", worker.googleDriveRefreshHandler)

	port := os.Getenv("STORAGE_WORKER_PORT")
	if port == "" {
		port = "8083"
	}

	log.Printf("Storage worker starting on port %s (default bucket %s)", port, bucket)
	if loadInternalKey() == "" {
		log.Printf("ERROR: STORAGE_WORKER_INTERNAL_KEY(_FILE) not configured; /api/* and /internal/* will refuse requests until it is set")
	}
	log.Fatal(http.ListenAndServe(":"+port, nil))
}

func (w *StorageWorker) getStorageForMailbox(ctx context.Context, mailboxID string) (Storage, string, error) {
	if mailboxID == "" {
		return w.defaultStorage, w.defaultBucket, nil
	}
	// Lookup mailbox_storage -> storage_connections
	conn, err := pgx.Connect(ctx, w.dbURL)
	if err != nil {
		log.Printf("getStorageForMailbox db connect fail, fallback to default: %v", err)
		return w.defaultStorage, w.defaultBucket, nil
	}
	defer conn.Close(ctx)
	var storageConnID string
	err = conn.QueryRow(ctx, `SELECT storage_connection_id::text FROM mailbox_storage WHERE mailbox_id=$1`, mailboxID).Scan(&storageConnID)
	if err != nil {
		// No mapping, use default
		return w.defaultStorage, w.defaultBucket, nil
	}
	return w.getStorageForConnection(ctx, storageConnID)
}

func (w *StorageWorker) getStorageForConnection(ctx context.Context, connectionID string) (Storage, string, error) {
	conn, err := pgx.Connect(ctx, w.dbURL)
	if err != nil {
		return w.defaultStorage, w.defaultBucket, err
	}
	defer conn.Close(ctx)
	var provider string
	var configBytes []byte
	var encrypted bool
	var bucketName string
	var status string
	// Try new columns first, fallback to legacy
	err = conn.QueryRow(ctx, `SELECT COALESCE(provider, provider_type), COALESCE(config, '{}'::jsonb)::text, COALESCE(encrypted,false), bucket_name, COALESCE(status,'active') FROM storage_connections WHERE id=$1`, connectionID).Scan(&provider, &configBytes, &encrypted, &bucketName, &status)
	if err != nil {
		return w.defaultStorage, w.defaultBucket, err
	}
	if status == "deleted" {
		return nil, "", ErrStorageDisconnected
	}
	var config map[string]interface{}
	if err := json.Unmarshal(configBytes, &config); err != nil {
		config = map[string]interface{}{}
	}
	// Explicit tombstone check — treat as disconnected even if status column lags
	if _, ok := config["tombstone"]; ok {
		return nil, "", ErrStorageDisconnected
	}
	// Storage credentials must always be encrypted at rest — no plaintext mode
	if encrypted {
		// config contains {"ciphertext": "base64(nonce+ct)"} that decrypts to original JSON
		ct, ok := config["ciphertext"].(string)
		if !ok || ct == "" {
			return nil, "", fmt.Errorf("storage credentials must be encrypted at rest (missing ciphertext)")
		}
		dek, err := loadStorageDEK()
		if err != nil {
			return nil, "", fmt.Errorf("load DEK: %w", err)
		}
		plain, err := decryptWithDEK(ct, dek)
		if err != nil {
			return nil, "", err
		}
		var decConfig map[string]interface{}
		if err := json.Unmarshal(plain, &decConfig); err != nil {
			return nil, "", err
		}
		config = decConfig
	} else {
		return nil, "", fmt.Errorf("storage credentials must be encrypted at rest (encrypted=false)")
	}
	// Ensure bucket from config or legacy bucketName
	if bucketName != "" {
		if _, ok := config["bucket"]; !ok {
			config["bucket"] = bucketName
		}
	}
	storage, err := storageFromConfig(provider, config)
	if err != nil {
		return nil, "", err
	}
	bucket, _ := config["bucket"].(string)
	if bucket == "" {
		bucket = bucketName
		if bucket == "" {
			bucket = w.defaultBucket
		}
	}
	return storage, bucket, nil
}

func (w *StorageWorker) healthHandler(resp http.ResponseWriter, req *http.Request) {
	ctx, cancel := context.WithTimeout(req.Context(), 5*time.Second)
	defer cancel()
	// Test default storage
	if w.defaultStorage != nil {
		if err := w.defaultStorage.TestConnection(ctx); err != nil {
			resp.WriteHeader(http.StatusServiceUnavailable)
			json.NewEncoder(resp).Encode(map[string]string{"status": "unhealthy", "error": err.Error()})
			return
		}
	}
	resp.Header().Set("Content-Type", "application/json")
	json.NewEncoder(resp).Encode(map[string]string{"status": "healthy", "service": "storage-worker"})
}

func (w *StorageWorker) storeHandler(resp http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		http.Error(resp, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !requireInternalKey(resp, req) {
		return
	}

	var objectKey, mailboxID string
	var reader io.Reader
	var size int64
	var isOctetStream bool

	// BUG-003: parse the media type instead of exact-matching the header so
	// variants like `application/octet-stream; name="f.enc"` still take the
	// raw-upload path instead of failing JSON decode.
	if mediaType, _, _ := mime.ParseMediaType(req.Header.Get("Content-Type")); mediaType == "application/octet-stream" {
		isOctetStream = true
		objectKey = req.Header.Get("X-Object-Key")
		mailboxID = req.Header.Get("X-Mailbox-ID")
		reader = req.Body
		size = req.ContentLength
		// Octet-stream uploads must always carry an explicit mailbox scope so
		// the object key can be constrained to that mailbox's prefix.
		if strings.TrimSpace(mailboxID) == "" {
			http.Error(resp, "X-Mailbox-ID required", http.StatusBadRequest)
			return
		}
	} else {
		var storeReq StoreRequest
		if err := json.NewDecoder(req.Body).Decode(&storeReq); err != nil {
			http.Error(resp, "Invalid request body", http.StatusBadRequest)
			return
		}
		objectKey = storeReq.ObjectKey
		mailboxID = storeReq.MailboxID
		reader = bytes.NewReader(storeReq.Data)
		size = int64(len(storeReq.Data))
		// SEC-004: no bucket override on store. The bucket always comes from
		// the mailbox's storage connection (or the worker default), so even
		// an authenticated caller cannot redirect writes to arbitrary buckets
		// via X-Bucket/StoreRequest.Bucket.
	}

	// Validate object key and sizes before touching storage (BUG-002/SEC-002).
	objectKey = strings.TrimSpace(objectKey)
	if objectKey == "" {
		http.Error(resp, "object_key required", http.StatusBadRequest)
		return
	}
	if strings.Contains(objectKey, "..") || strings.HasPrefix(objectKey, "/") || strings.Contains(objectKey, "\\") {
		http.Error(resp, "invalid object_key", http.StatusBadRequest)
		return
	}
	if size < 0 {
		// Downstream providers (notably GoogleDriveStorage) require an exact
		// non-negative size; chunked/unknown lengths would fail with
		// "object size mismatch" after partial writes.
		http.Error(resp, "Content-Length required", http.StatusLengthRequired)
		return
	}
	const maxStoreObjectSize = 40 * 1024 * 1024
	if size > maxStoreObjectSize {
		http.Error(resp, "object exceeds maximum size limit of 40 MB", http.StatusRequestEntityTooLarge)
		return
	}
	if strings.TrimSpace(mailboxID) != "" {
		// Constrain writes to the caller's mailbox prefix to prevent
		// arbitrary cross-mailbox object writes via forged headers.
		expectedPrefix := "mailboxes/" + strings.TrimSpace(mailboxID) + "/"
		if !strings.HasPrefix(objectKey, expectedPrefix) {
			http.Error(resp, "object_key must be within caller mailbox prefix", http.StatusBadRequest)
			return
		}
	} else if isOctetStream {
		// Already rejected above; defensive: never allow unscoped raw writes.
		http.Error(resp, "X-Mailbox-ID required", http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(req.Context(), 30*time.Second)
	defer cancel()
	st, bucket, err := w.getStorageForMailbox(ctx, mailboxID)
	if err != nil {
		if errors.Is(err, ErrStorageDisconnected) {
			resp.Header().Set("Content-Type", "application/json")
			resp.WriteHeader(http.StatusServiceUnavailable)
			json.NewEncoder(resp).Encode(map[string]string{"status": "error", "code": "storage_disconnected", "message": "Mailbox storage is currently unavailable. Please reconnect storage."})
			return
		}
		http.Error(resp, fmt.Sprintf("Failed to get storage: %v", err), http.StatusInternalServerError)
		return
	}
	if st == nil {
		http.Error(resp, "No storage available", http.StatusInternalServerError)
		return
	}
	if err := st.PutObject(ctx, bucket, objectKey, reader, size); err != nil {
		http.Error(resp, fmt.Sprintf("Failed to store object: %v", err), http.StatusInternalServerError)
		return
	}
	resp.Header().Set("Content-Type", "application/json")
	json.NewEncoder(resp).Encode(map[string]string{"status": "stored", "object_key": objectKey})
}

func (w *StorageWorker) retrieveHandler(resp http.ResponseWriter, req *http.Request) {
	if !requireInternalKey(resp, req) {
		return
	}
	if req.Method != http.MethodPost {
		http.Error(resp, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var retrieveReq RetrieveRequest
	if err := json.NewDecoder(req.Body).Decode(&retrieveReq); err != nil {
		http.Error(resp, "Invalid request body", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(req.Context(), 30*time.Second)
	defer cancel()
	st, bucket, err := w.getStorageForMailbox(ctx, retrieveReq.MailboxID)
	if err != nil {
		if errors.Is(err, ErrStorageDisconnected) {
			resp.Header().Set("Content-Type", "application/json")
			resp.WriteHeader(http.StatusServiceUnavailable)
			json.NewEncoder(resp).Encode(map[string]string{"status": "error", "code": "storage_disconnected", "message": "Mailbox storage is currently unavailable. Please reconnect storage."})
			return
		}
		http.Error(resp, fmt.Sprintf("Failed to get storage: %v", err), http.StatusInternalServerError)
		return
	}
	if st == nil {
		http.Error(resp, "No storage available", http.StatusInternalServerError)
		return
	}
	if retrieveReq.Bucket != "" {
		bucket = retrieveReq.Bucket
	}
	rc, err := st.GetObject(ctx, bucket, retrieveReq.ObjectKey)
	if err != nil {
		http.Error(resp, fmt.Sprintf("Failed to retrieve object: %v", err), http.StatusInternalServerError)
		return
	}
	defer rc.Close()
	data, err := io.ReadAll(rc)
	if err != nil {
		http.Error(resp, fmt.Sprintf("Failed to read object: %v", err), http.StatusInternalServerError)
		return
	}
	resp.Header().Set("Content-Type", "application/json")
	json.NewEncoder(resp).Encode(RetrieveResponse{
		Data: data,
		Size: int64(len(data)),
	})
}

func (w *StorageWorker) deleteHandler(resp http.ResponseWriter, req *http.Request) {
	if !requireInternalKey(resp, req) {
		return
	}
	if req.Method != http.MethodPost {
		http.Error(resp, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var deleteReq struct {
		ObjectKey string `json:"object_key"`
		MailboxID string `json:"mailbox_id,omitempty"`
		Bucket    string `json:"bucket,omitempty"`
	}
	if err := json.NewDecoder(req.Body).Decode(&deleteReq); err != nil {
		http.Error(resp, "Invalid request body", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(req.Context(), 30*time.Second)
	defer cancel()
	st, bucket, err := w.getStorageForMailbox(ctx, deleteReq.MailboxID)
	if err != nil {
		if errors.Is(err, ErrStorageDisconnected) {
			resp.Header().Set("Content-Type", "application/json")
			resp.WriteHeader(http.StatusServiceUnavailable)
			json.NewEncoder(resp).Encode(map[string]string{"status": "error", "code": "storage_disconnected", "message": "Mailbox storage is currently unavailable. Please reconnect storage."})
			return
		}
		http.Error(resp, fmt.Sprintf("Failed to get storage: %v", err), http.StatusInternalServerError)
		return
	}
	if deleteReq.Bucket != "" {
		bucket = deleteReq.Bucket
	}
	if err := st.DeleteObject(ctx, bucket, deleteReq.ObjectKey); err != nil {
		http.Error(resp, fmt.Sprintf("Failed to delete object: %v", err), http.StatusInternalServerError)
		return
	}
	resp.Header().Set("Content-Type", "application/json")
	json.NewEncoder(resp).Encode(map[string]string{"status": "deleted", "object_key": deleteReq.ObjectKey})
}

func (w *StorageWorker) listHandler(resp http.ResponseWriter, req *http.Request) {
	if !requireInternalKey(resp, req) {
		return
	}
	if req.Method != http.MethodGet && req.Method != http.MethodPost {
		http.Error(resp, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	// Support both GET ?prefix= and POST body
	var prefix string
	var mailboxID string
	var bucket string
	if req.Method == http.MethodGet {
		prefix = req.URL.Query().Get("prefix")
		mailboxID = req.URL.Query().Get("mailbox_id")
		bucket = req.URL.Query().Get("bucket")
	} else {
		var body struct {
			Prefix    string `json:"prefix"`
			MailboxID string `json:"mailbox_id"`
			Bucket    string `json:"bucket"`
		}
		json.NewDecoder(req.Body).Decode(&body)
		prefix = body.Prefix
		mailboxID = body.MailboxID
		bucket = body.Bucket
	}
	ctx, cancel := context.WithTimeout(req.Context(), 30*time.Second)
	defer cancel()
	st, bucketResolved, err := w.getStorageForMailbox(ctx, mailboxID)
	if err != nil {
		if errors.Is(err, ErrStorageDisconnected) {
			resp.Header().Set("Content-Type", "application/json")
			resp.WriteHeader(http.StatusServiceUnavailable)
			json.NewEncoder(resp).Encode(map[string]string{"status": "error", "code": "storage_disconnected", "message": "Mailbox storage is currently unavailable. Please reconnect storage."})
			return
		}
		http.Error(resp, fmt.Sprintf("Failed to get storage: %v", err), http.StatusInternalServerError)
		return
	}
	if bucket != "" {
		bucketResolved = bucket
	}
	objs, err := st.ListObjects(ctx, bucketResolved, prefix)
	if err != nil {
		http.Error(resp, fmt.Sprintf("Failed to list: %v", err), http.StatusInternalServerError)
		return
	}
	var keys []string
	for _, o := range objs {
		keys = append(keys, o.Key)
	}
	resp.Header().Set("Content-Type", "application/json")
	json.NewEncoder(resp).Encode(map[string]interface{}{"objects": keys, "count": len(keys), "details": objs})
}

func (w *StorageWorker) headHandler(resp http.ResponseWriter, req *http.Request) {
	if !requireInternalKey(resp, req) {
		return
	}
	if req.Method != http.MethodPost {
		http.Error(resp, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var r struct {
		ObjectKey string `json:"object_key"`
		MailboxID string `json:"mailbox_id,omitempty"`
		Bucket    string `json:"bucket,omitempty"`
	}
	if err := json.NewDecoder(req.Body).Decode(&r); err != nil {
		http.Error(resp, "Invalid request body", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(req.Context(), 10*time.Second)
	defer cancel()
	st, bucket, err := w.getStorageForMailbox(ctx, r.MailboxID)
	if err != nil {
		if errors.Is(err, ErrStorageDisconnected) {
			resp.Header().Set("Content-Type", "application/json")
			resp.WriteHeader(http.StatusServiceUnavailable)
			json.NewEncoder(resp).Encode(map[string]string{"status": "error", "code": "storage_disconnected", "message": "Mailbox storage is currently unavailable. Please reconnect storage."})
			return
		}
		http.Error(resp, fmt.Sprintf("Failed to get storage: %v", err), http.StatusInternalServerError)
		return
	}
	if r.Bucket != "" {
		bucket = r.Bucket
	}
	info, err := st.HeadObject(ctx, bucket, r.ObjectKey)
	if err != nil {
		http.Error(resp, fmt.Sprintf("Head failed: %v", err), http.StatusNotFound)
		return
	}
	resp.Header().Set("Content-Type", "application/json")
	json.NewEncoder(resp).Encode(info)
}

// Internal encryption endpoints

func (w *StorageWorker) encryptHandler(resp http.ResponseWriter, req *http.Request) {
	if !requireInternalKey(resp, req) {
		return
	}
	if req.Method != http.MethodPost {
		http.Error(resp, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var r struct {
		Plaintext string `json:"plaintext"`
	}
	if err := json.NewDecoder(req.Body).Decode(&r); err != nil {
		http.Error(resp, "Invalid request body", http.StatusBadRequest)
		return
	}
	dek, err := loadStorageDEK()
	if err != nil {
		http.Error(resp, fmt.Sprintf("DEK load failed: %v", err), http.StatusInternalServerError)
		return
	}
	ct, err := encryptWithDEK([]byte(r.Plaintext), dek)
	if err != nil {
		http.Error(resp, fmt.Sprintf("encrypt failed: %v", err), http.StatusInternalServerError)
		return
	}
	resp.Header().Set("Content-Type", "application/json")
	json.NewEncoder(resp).Encode(map[string]string{"ciphertext": ct, "encrypted": "true"})
}

func (w *StorageWorker) decryptHandler(resp http.ResponseWriter, req *http.Request) {
	if !requireInternalKey(resp, req) {
		return
	}
	if req.Method != http.MethodPost {
		http.Error(resp, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var r struct {
		Ciphertext string `json:"ciphertext"`
	}
	if err := json.NewDecoder(req.Body).Decode(&r); err != nil {
		http.Error(resp, "Invalid request body", http.StatusBadRequest)
		return
	}
	dek, err := loadStorageDEK()
	if err != nil {
		http.Error(resp, fmt.Sprintf("DEK load failed: %v", err), http.StatusInternalServerError)
		return
	}
	pt, err := decryptWithDEK(r.Ciphertext, dek)
	if err != nil {
		http.Error(resp, fmt.Sprintf("decrypt failed: %v", err), http.StatusInternalServerError)
		return
	}
	resp.Header().Set("Content-Type", "application/json")
	json.NewEncoder(resp).Encode(map[string]string{"plaintext": string(pt)})
}

func (w *StorageWorker) testHandler(resp http.ResponseWriter, req *http.Request) {
	if !requireInternalKey(resp, req) {
		return
	}
	if req.Method != http.MethodPost {
		http.Error(resp, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var r struct {
		Provider string                 `json:"provider"`
		Config   map[string]interface{} `json:"config"`
	}
	if err := json.NewDecoder(req.Body).Decode(&r); err != nil {
		http.Error(resp, "Invalid request body", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(req.Context(), 10*time.Second)
	defer cancel()
	st, err := storageFromConfig(r.Provider, r.Config)
	if err != nil {
		resp.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(resp).Encode(map[string]string{"status": "error", "error": err.Error()})
		return
	}
	if err := st.TestConnection(ctx); err != nil {
		resp.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(resp).Encode(map[string]string{"status": "error", "error": err.Error()})
		return
	}
	resp.Header().Set("Content-Type", "application/json")
	json.NewEncoder(resp).Encode(map[string]string{"status": "ok"})
}

func (w *StorageWorker) testEncryptedHandler(resp http.ResponseWriter, req *http.Request) {
	if !requireInternalKey(resp, req) {
		return
	}
	if req.Method != http.MethodPost {
		http.Error(resp, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var r struct {
		Provider   string `json:"provider"`
		Ciphertext string `json:"ciphertext"`
	}
	if err := json.NewDecoder(req.Body).Decode(&r); err != nil {
		http.Error(resp, "Invalid request body", http.StatusBadRequest)
		return
	}
	if r.Provider == "" || r.Ciphertext == "" {
		http.Error(resp, "provider and ciphertext required", http.StatusBadRequest)
		return
	}
	dek, err := loadStorageDEK()
	if err != nil {
		http.Error(resp, "DEK load failed", http.StatusInternalServerError)
		return
	}
	plain, err := decryptWithDEK(r.Ciphertext, dek)
	if err != nil {
		// Do not expose decrypt error details
		resp.Header().Set("Content-Type", "application/json")
		resp.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(resp).Encode(map[string]string{"status": "error", "code": "configuration_error"})
		return
	}
	var config map[string]interface{}
	if err := json.Unmarshal(plain, &config); err != nil {
		resp.Header().Set("Content-Type", "application/json")
		resp.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(resp).Encode(map[string]string{"status": "error", "code": "configuration_error"})
		return
	}
	ctx, cancel := context.WithTimeout(req.Context(), 10*time.Second)
	defer cancel()
	st, err := storageFromConfig(r.Provider, config)
	if err != nil {
		resp.Header().Set("Content-Type", "application/json")
		resp.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(resp).Encode(map[string]string{"status": "error", "code": "configuration_error"})
		return
	}
	if err := st.TestConnection(ctx); err != nil {
		lower := strings.ToLower(err.Error())
		code := "provider_unavailable"
		// Authentication failures contain auth-like keywords (minio-go returns 403/401)
		if strings.Contains(lower, "auth") || strings.Contains(lower, "signature") || strings.Contains(lower, "credential") || strings.Contains(lower, "unauthorized") || strings.Contains(lower, "forbidden") || strings.Contains(lower, "invalid") && strings.Contains(lower, "key") {
			code = "authentication_failed"
		} else if strings.Contains(lower, "config") || strings.Contains(lower, "unknown provider") || strings.Contains(lower, "bucket") && strings.Contains(lower, "invalid") {
			code = "configuration_error"
		}
		resp.Header().Set("Content-Type", "application/json")
		// Use 200 with error code, not 500, to keep sanitized contract; API maps code
		json.NewEncoder(resp).Encode(map[string]string{"status": "error", "code": code})
		return
	}
	resp.Header().Set("Content-Type", "application/json")
	json.NewEncoder(resp).Encode(map[string]string{"status": "ok", "code": "verified"})
}

func (w *StorageWorker) migrateEncryptedHandler(resp http.ResponseWriter, req *http.Request) {
	if !requireInternalKey(resp, req) {
		return
	}
	if req.Method != http.MethodPost {
		http.Error(resp, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var r struct {
		SourceProvider   string `json:"source_provider"`
		SourceCiphertext string `json:"source_ciphertext"`
		TargetProvider   string `json:"target_provider"`
		TargetCiphertext string `json:"target_ciphertext"`
		Prefix           string `json:"prefix"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(resp, req.Body, 1<<20)).Decode(&r); err != nil {
		http.Error(resp, "Invalid request body", http.StatusBadRequest)
		return
	}
	dek, err := loadStorageDEK()
	if err != nil {
		http.Error(resp, "DEK load failed", http.StatusInternalServerError)
		return
	}
	decodeConfig := func(provider, ciphertext string) (Storage, error) {
		plain, err := decryptWithDEK(ciphertext, dek)
		if err != nil {
			return nil, err
		}
		var config map[string]interface{}
		if err := json.Unmarshal(plain, &config); err != nil {
			return nil, err
		}
		return storageFromConfig(provider, config)
	}
	source, err := decodeConfig(r.SourceProvider, r.SourceCiphertext)
	if err != nil {
		http.Error(resp, "source configuration error", http.StatusBadRequest)
		return
	}
	target, err := decodeConfig(r.TargetProvider, r.TargetCiphertext)
	if err != nil {
		http.Error(resp, "target configuration error", http.StatusBadRequest)
		return
	}
	ctx, cancel := context.WithTimeout(req.Context(), 5*time.Minute)
	defer cancel()
	objects, err := source.ListObjects(ctx, "", r.Prefix)
	if err != nil {
		http.Error(resp, "source listing failed", http.StatusBadGateway)
		return
	}
	copied := 0
	for _, object := range objects {
		reader, err := source.GetObject(ctx, "", object.Key)
		if err != nil {
			http.Error(resp, "source read failed", http.StatusBadGateway)
			return
		}
		err = target.PutObject(ctx, "", object.Key, reader, object.Size)
		reader.Close()
		if err != nil {
			http.Error(resp, "target write failed", http.StatusBadGateway)
			return
		}
		targetInfo, err := target.HeadObject(ctx, "", object.Key)
		if err != nil || targetInfo.Size != object.Size {
			http.Error(resp, "target verification failed", http.StatusBadGateway)
			return
		}
		copied++
	}
	resp.Header().Set("Content-Type", "application/json")
	json.NewEncoder(resp).Encode(map[string]interface{}{
		"status": "copied", "objects": copied, "changes_applied": false,
	})
}

func (w *StorageWorker) googleDriveRefreshHandler(resp http.ResponseWriter, req *http.Request) {
	if !requireInternalKey(resp, req) {
		return
	}
	if req.Method != http.MethodPost {
		http.Error(resp, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var request struct {
		Ciphertext string `json:"ciphertext"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(resp, req.Body, 1<<20)).Decode(&request); err != nil || request.Ciphertext == "" {
		http.Error(resp, "invalid request body", http.StatusBadRequest)
		return
	}
	dek, err := loadStorageDEK()
	if err != nil {
		http.Error(resp, "DEK load failed", http.StatusInternalServerError)
		return
	}
	plain, err := decryptWithDEK(request.Ciphertext, dek)
	if err != nil {
		http.Error(resp, "credential decryption failed", http.StatusBadRequest)
		return
	}
	var config struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
	}
	if err := json.Unmarshal(plain, &config); err != nil || config.RefreshToken == "" {
		http.Error(resp, "refresh token unavailable", http.StatusBadRequest)
		return
	}
	clientID := os.Getenv("GOOGLE_DRIVE_CLIENT_ID")
	clientSecret := os.Getenv("GOOGLE_DRIVE_CLIENT_SECRET")
	if clientID == "" || clientSecret == "" {
		http.Error(resp, "Google OAuth is not configured", http.StatusServiceUnavailable)
		return
	}
	form := url.Values{"client_id": {clientID}, "client_secret": {clientSecret}, "refresh_token": {config.RefreshToken}, "grant_type": {"refresh_token"}}
	refreshReq, err := http.NewRequestWithContext(req.Context(), http.MethodPost, "https://oauth2.googleapis.com/token", strings.NewReader(form.Encode()))
	if err != nil {
		http.Error(resp, "failed to prepare refresh", http.StatusInternalServerError)
		return
	}
	refreshReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	refreshResp, err := (&http.Client{Timeout: 20 * time.Second}).Do(refreshReq)
	if err != nil {
		http.Error(resp, "Google OAuth refresh unavailable", http.StatusBadGateway)
		return
	}
	defer refreshResp.Body.Close()
	if refreshResp.StatusCode < 200 || refreshResp.StatusCode >= 300 {
		http.Error(resp, "Google OAuth refresh failed", http.StatusBadGateway)
		return
	}
	var token struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(refreshResp.Body).Decode(&token); err != nil || token.AccessToken == "" {
		http.Error(resp, "Google OAuth refresh response invalid", http.StatusBadGateway)
		return
	}
	config.AccessToken = token.AccessToken
	updated, err := json.Marshal(config)
	if err != nil {
		http.Error(resp, "failed to encode refreshed credentials", http.StatusInternalServerError)
		return
	}
	updatedCiphertext, err := encryptWithDEK(updated, dek)
	if err != nil {
		http.Error(resp, "failed to encrypt refreshed credentials", http.StatusInternalServerError)
		return
	}
	resp.Header().Set("Content-Type", "application/json")
	json.NewEncoder(resp).Encode(map[string]string{"ciphertext": updatedCiphertext, "status": "refreshed"})
}
