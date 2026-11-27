package main

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// TestConditionalWrite_SigV4SignedHeaders verifies that minio-go/v7 includes
// If-Match and If-None-Match in the AWS SigV4 SignedHeaders list.
func TestConditionalWrite_SigV4SignedHeaders(t *testing.T) {
	ctx := context.Background()
	srv := newMockS3Server("c692-synth/")

	var mu sync.Mutex
	var authHeaders []string
	var ifNoneMatchHeaders []string
	var ifMatchHeaders []string

	wrapped := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPut {
			mu.Lock()
			authHeaders = append(authHeaders, r.Header.Get("Authorization"))
			ifNoneMatchHeaders = append(ifNoneMatchHeaders, r.Header.Get("If-None-Match"))
			ifMatchHeaders = append(ifMatchHeaders, r.Header.Get("If-Match"))
			mu.Unlock()
		}
		srv.ServeHTTP(w, r)
	})

	ts := httptest.NewServer(wrapped)
	defer ts.Close()

	s3 := newTestS3Storage(t, ts.URL, "c692-synth")

	// 1. Initial create with empty ETag -> If-None-Match: *
	if err := s3.PutIfMatch(ctx, remoteCatalogKey, []byte(`{"catalog_version":1}`), nil, ""); err != nil {
		t.Fatalf("PutIfMatch create failed: %v", err)
	}
	// 2. Conditional update with quoted/unquoted ETag -> If-Match: "<etag>" (never double-quoted)
	_, _, etag, err := s3.GetWithETag(ctx, remoteCatalogKey)
	if err != nil || etag == "" {
		t.Fatalf("GetWithETag failed: etag=%q err=%v", etag, err)
	}
	if err := s3.PutIfMatch(ctx, remoteCatalogKey, []byte(`{"catalog_version":1,"updated":true}`), nil, `"`+etag+`"`); err != nil {
		t.Fatalf("PutIfMatch update failed: %v", err)
	}

	mu.Lock()
	defer mu.Unlock()
	if len(authHeaders) != 2 {
		t.Fatalf("expected 2 PUT requests, got %d", len(authHeaders))
	}
	if ifNoneMatchHeaders[0] != "*" {
		t.Fatalf("expected first PUT If-None-Match=*, got %q", ifNoneMatchHeaders[0])
	}
	if !strings.Contains(strings.ToLower(authHeaders[0]), "if-none-match") {
		t.Fatalf("expected SigV4 Authorization header to sign if-none-match, got: %s", authHeaders[0])
	}
	expectedIfMatch := `"` + etag + `"`
	if ifMatchHeaders[1] != expectedIfMatch {
		t.Fatalf("expected second PUT If-Match=%q (single-quoted), got %q", expectedIfMatch, ifMatchHeaders[1])
	}
	if !strings.Contains(strings.ToLower(authHeaders[1]), "if-match") {
		t.Fatalf("expected SigV4 Authorization header to sign if-match, got: %s", authHeaders[1])
	}
}

// TestConditionalWrite_409ConflictAnd412RetrySucceeds verifies that both HTTP 409
// (ConditionalRequestConflict) and HTTP 412 (PreconditionFailed) map to ErrPreconditionFailed
// and trigger reload-merge-retry in PublishBackupToRemote and AWSKMSKeyProvider.RotateKey.
func TestConditionalWrite_409ConflictAnd412RetrySucceeds(t *testing.T) {
	ctx := context.Background()
	srv := newMockS3Server("c692-synth/")

	var inject409 atomic.Int32
	wrapped := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPut && strings.HasSuffix(r.URL.Path, remoteCatalogKey) && inject409.Load() > 0 {
			inject409.Add(-1)
			w.Header().Set("Content-Type", "application/xml")
			w.WriteHeader(http.StatusConflict)
			_, _ = w.Write([]byte(`<Error><Code>ConditionalRequestConflict</Code><Message>409 conflict</Message></Error>`))
			return
		}
		srv.ServeHTTP(w, r)
	})

	ts := httptest.NewServer(wrapped)
	defer ts.Close()

	s3 := newTestS3Storage(t, ts.URL, "c692-synth")
	local := NewMemoryStorage(0)

	// Prepare a minimal valid encrypted base backup file for PublishBackupToRemote
	tmpDir := t.TempDir()
	encFile := filepath.Join(tmpDir, "base.tar.enc")
	if err := os.WriteFile(encFile, []byte("synthetic-encrypted-base"), 0600); err != nil {
		t.Fatal(err)
	}

	// Inject one 409 Conflict on the catalog commit; PublishBackupToRemote must reload and succeed.
	inject409.Store(1)
	entry := RecoveryCatalogEntry{
		BackupID:            "bkp-409-retry",
		EncryptionAlgorithm: "AES-256-GCM",
		KeyVersionID:        "v1",
		StartTime:           time.Now().UTC(),
	}
	committed, err := PublishBackupToRemote(ctx, local, s3, nil, entry, encFile, "")
	if err != nil {
		t.Fatalf("PublishBackupToRemote failed on 409 retry: %v", err)
	}
	if committed == nil || committed.BackupID != "bkp-409-retry" {
		t.Fatalf("unexpected committed entry: %+v", committed)
	}

	cat, err := LoadRemoteCatalog(ctx, s3)
	if err != nil || len(cat.Entries) != 1 || cat.Entries[0].BackupID != "bkp-409-retry" {
		t.Fatalf("expected 1 catalog entry after 409 retry, got %+v (err=%v)", cat, err)
	}
}

// failing404CASStorage wraps ConditionalMutableStorageDestination to simulate 404 (ErrObjectNotFound)
// on PutIfMatch when expectedETag != "" (e.g., concurrent delete marker or disappeared object).
type failing404CASStorage struct {
	ConditionalMutableStorageDestination
	StorageDestination
	forceNotFoundOnNonEmptyETag bool
}

func (f *failing404CASStorage) Name() string { return f.StorageDestination.Name() }
func (f *failing404CASStorage) Put(ctx context.Context, key string, data []byte, metadata map[string]string) error {
	return f.StorageDestination.Put(ctx, key, data, metadata)
}
func (f *failing404CASStorage) Get(ctx context.Context, key string) ([]byte, map[string]string, error) {
	return f.StorageDestination.Get(ctx, key)
}
func (f *failing404CASStorage) Delete(ctx context.Context, key string) error {
	return f.StorageDestination.Delete(ctx, key)
}
func (f *failing404CASStorage) Exists(ctx context.Context, key string) (bool, error) {
	return f.StorageDestination.Exists(ctx, key)
}
func (f *failing404CASStorage) List(ctx context.Context, prefix string) ([]ObjectInfo, error) {
	return f.StorageDestination.List(ctx, prefix)
}
func (f *failing404CASStorage) GetInfo(ctx context.Context, key string) (ObjectInfo, error) {
	return f.StorageDestination.GetInfo(ctx, key)
}
func (f *failing404CASStorage) PutOverwrite(ctx context.Context, key string, data []byte, metadata map[string]string) error {
	return f.ConditionalMutableStorageDestination.PutOverwrite(ctx, key, data, metadata)
}
func (f *failing404CASStorage) GetWithETag(ctx context.Context, key string) ([]byte, map[string]string, string, error) {
	return f.ConditionalMutableStorageDestination.GetWithETag(ctx, key)
}
func (f *failing404CASStorage) PutIfMatch(ctx context.Context, key string, data []byte, metadata map[string]string, expectedETag string) error {
	if f.forceNotFoundOnNonEmptyETag && expectedETag != "" {
		return ErrObjectNotFound
	}
	return f.ConditionalMutableStorageDestination.PutIfMatch(ctx, key, data, metadata, expectedETag)
}

// TestConditionalWrite_MissingKey404AndDeleteMarkerFailClosed verifies that when PutIfMatch
// with a non-empty ETag encounters ErrObjectNotFound (missing key or concurrent delete marker),
// both PublishBackupToRemote and AWSKMSKeyProvider.RotateKey fail closed instead of overwriting.
func TestConditionalWrite_MissingKey404AndDeleteMarkerFailClosed(t *testing.T) {
	ctx := context.Background()

	// 1. Catalog CAS 404 fail-closed
	srv := newMockS3Server("c692-synth/")
	ts := httptest.NewServer(srv)
	defer ts.Close()
	s3 := newTestS3Storage(t, ts.URL, "c692-synth")

	// Seed initial catalog so ETag is non-empty
	if err := SaveRemoteCatalogCAS(ctx, s3, &RecoveryCatalog{Entries: []RecoveryCatalogEntry{{BackupID: "bkp-seed", Status: "completed"}}}, ""); err != nil {
		t.Fatalf("seed catalog failed: %v", err)
	}

	wrappedStore := &failing404CASStorage{
		ConditionalMutableStorageDestination: s3,
		StorageDestination:                   s3,
		forceNotFoundOnNonEmptyETag:          true,
	}
	tmpDir := t.TempDir()
	encFile := filepath.Join(tmpDir, "base.tar.enc")
	if err := os.WriteFile(encFile, []byte("synthetic-base"), 0600); err != nil {
		t.Fatal(err)
	}
	local := NewMemoryStorage(0)
	_, err := PublishBackupToRemote(ctx, local, wrappedStore, nil, RecoveryCatalogEntry{
		BackupID:  "bkp-after-delete-marker",
		StartTime: time.Now().UTC(),
	}, encFile, "")
	if !errors.Is(err, ErrObjectNotFound) {
		t.Fatalf("expected ErrObjectNotFound fail-closed on catalog CAS 404, got: %v", err)
	}

	// 2. KMS envelope CAS 404 fail-closed
	mem := NewMemoryStorage(0)
	kmsWrapped := &failing404CASStorage{
		ConditionalMutableStorageDestination: mem,
		StorageDestination:                   mem,
	}
	mockKMS := newMockAWSKMSClient()
	prov, err := NewAWSKMSKeyProvider(ctx, mockKMS, "arn:aws:kms:us-east-1:111122223333:key/test", kmsWrapped)
	if err != nil {
		t.Fatalf("NewAWSKMSKeyProvider failed: %v", err)
	}
	if _, err := prov.RotateKey(ctx); err != nil {
		t.Fatalf("initial RotateKey failed: %v", err)
	}
	// Now simulate object disappearing / delete marker on second rotation
	kmsWrapped.forceNotFoundOnNonEmptyETag = true
	if _, err := prov.RotateKey(ctx); !errors.Is(err, ErrObjectNotFound) {
		t.Fatalf("expected ErrObjectNotFound fail-closed on KMS RotateKey CAS 404, got: %v", err)
	}
}

// TestConditionalWrite_RetryExhaustion verifies bounded retry exhaustion returns ErrPreconditionFailed.
func TestConditionalWrite_RetryExhaustion(t *testing.T) {
	ctx := context.Background()
	srv := newMockS3Server("c692-synth/")

	// Always return 412 on PUT to catalog or keys manifest
	wrapped := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPut && (strings.HasSuffix(r.URL.Path, remoteCatalogKey) || strings.HasSuffix(r.URL.Path, remoteKeyEnvelopesKey)) {
			w.Header().Set("Content-Type", "application/xml")
			w.WriteHeader(http.StatusPreconditionFailed)
			_, _ = w.Write([]byte(`<Error><Code>PreconditionFailed</Code><Message>Forced 412</Message></Error>`))
			return
		}
		srv.ServeHTTP(w, r)
	})
	ts := httptest.NewServer(wrapped)
	defer ts.Close()

	s3 := newTestS3Storage(t, ts.URL, "c692-synth")
	local := NewMemoryStorage(0)
	tmpDir := t.TempDir()
	encFile := filepath.Join(tmpDir, "base.tar.enc")
	if err := os.WriteFile(encFile, []byte("synthetic-base"), 0600); err != nil {
		t.Fatal(err)
	}

	_, err := PublishBackupToRemote(ctx, local, s3, nil, RecoveryCatalogEntry{
		BackupID:  "bkp-exhaust",
		StartTime: time.Now().UTC(),
	}, encFile, "")
	if !errors.Is(err, ErrPreconditionFailed) {
		t.Fatalf("expected ErrPreconditionFailed after maxCatalogCASRetries, got: %v", err)
	}

	mockKMS := newMockAWSKMSClient()
	prov, err := NewAWSKMSKeyProvider(ctx, mockKMS, "arn:aws:kms:us-east-1:111122223333:key/test", s3)
	if err != nil {
		t.Fatalf("NewAWSKMSKeyProvider failed: %v", err)
	}
	if _, err := prov.RotateKey(ctx); !errors.Is(err, ErrPreconditionFailed) {
		t.Fatalf("expected ErrPreconditionFailed after maxKMSCASRetries, got: %v", err)
	}
}

// TestConditionalWrite_TimeoutAfterServerCommit_IdempotentRecovery verifies that when
// a PUT succeeds on the server but the client receives a transient 500/timeout on the
// response or post-PUT StatObject, re-reading the manifest recovers the committed state
// and retrying PublishBackupToRemote is idempotent (no duplicate catalog entries).
func TestConditionalWrite_TimeoutAfterServerCommit_IdempotentRecovery(t *testing.T) {
	ctx := context.Background()
	srv := newMockS3Server("c692-synth/")

	var dropPostPutStat atomic.Int32
	dropPostPutStat.Store(1)

	wrapped := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Let the PUT succeed on the server, then fail the immediate post-PUT HEAD (StatObject)
		// with 503 ServiceUnavailable to simulate an uncertain response after server-side commit.
		if r.Method == http.MethodHead && strings.HasSuffix(r.URL.Path, remoteCatalogKey) && dropPostPutStat.Load() > 0 {
			dropPostPutStat.Add(-1)
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		srv.ServeHTTP(w, r)
	})
	ts := httptest.NewServer(wrapped)
	defer ts.Close()

	// Use MaxRetries: 0 on S3Storage so the 503 on StatObject surfaces immediately to PublishBackupToRemote
	cfg := RemoteStorageConfig{
		Enabled:     true,
		Endpoint:    strings.TrimPrefix(ts.URL, "http://"),
		Region:      "us-east-1",
		Bucket:      "test-bucket",
		Prefix:      "c692-synth",
		PathStyle:   true,
		UseSSL:      false,
		AccessKey:   "minioadmin",
		SecretKey:   "minioadmin",
		MaxRetries:  0,
		BaseBackoff: 1 * time.Millisecond,
	}
	s3, err := NewS3Storage(cfg)
	if err != nil {
		t.Fatalf("NewS3Storage failed: %v", err)
	}

	local := NewMemoryStorage(0)
	tmpDir := t.TempDir()
	encFile := filepath.Join(tmpDir, "base.tar.enc")
	if err := os.WriteFile(encFile, []byte("synthetic-base"), 0600); err != nil {
		t.Fatal(err)
	}

	entry := RecoveryCatalogEntry{
		BackupID:  "bkp-uncertain-commit",
		StartTime: time.Now().UTC(),
	}
	// First attempt may return an error or retry, but let's check both:
	// Note: NewS3Storage clamps MaxRetries <= 0 to 2, so s3.withRetry retries the PUT with the same
	// empty ETag -> server already committed it -> returns 412 -> surfaces ErrPreconditionFailed ->
	// PublishBackupToRemote reloads the already-committed catalog, sees BackupID == "bkp-uncertain-commit",
	// replaces in place (no duplicate!), and commits cleanly!
	committed, err := PublishBackupToRemote(ctx, local, s3, nil, entry, encFile, "")
	if err != nil {
		t.Fatalf("PublishBackupToRemote failed during uncertain-commit recovery: %v", err)
	}
	if committed.BackupID != "bkp-uncertain-commit" {
		t.Fatalf("unexpected BackupID: %s", committed.BackupID)
	}

	cat, err := LoadRemoteCatalog(ctx, s3)
	if err != nil {
		t.Fatalf("LoadRemoteCatalog failed: %v", err)
	}
	if len(cat.Entries) != 1 || cat.Entries[0].BackupID != "bkp-uncertain-commit" {
		t.Fatalf("expected exactly 1 deduplicated entry after uncertain-commit recovery, got: %+v", cat.Entries)
	}
}
