package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

const (
	s3MetaSHA256Key = "byos-sha256"
	s3PartSizeBytes = 16 * 1024 * 1024 // 16 MiB multipart threshold/part size
)

// RemoteStorageConfig holds non-secret endpoint configuration and resolved credentials
// for any S3-compatible off-site object storage provider.
type RemoteStorageConfig struct {
	Enabled        bool
	Endpoint       string
	Region         string
	Bucket         string
	Prefix         string
	PathStyle      bool
	Required       bool
	UseSSL         bool
	AccessKey      string
	SecretKey      string
	SessionToken   string
	MaxRetries     int
	BaseBackoff    time.Duration
	Timeout        time.Duration
	ObjectLockMode string // "", "GOVERNANCE", or "COMPLIANCE"
	ObjectLockDays int    // retention days applied to immutable wal/ and backups/ objects
}

// resolveSecretFromEnvOrFile reads a secret from a file path env var first, falling back to direct env vars.
func resolveSecretFromEnvOrFile(fileEnv string, directEnvs ...string) (string, error) {
	if path := strings.TrimSpace(os.Getenv(fileEnv)); path != "" {
		b, err := os.ReadFile(path)
		if err != nil {
			return "", fmt.Errorf("reading secret file %s (%q): %w", fileEnv, path, err)
		}
		return strings.TrimSpace(string(b)), nil
	}
	for _, k := range directEnvs {
		if v := strings.TrimSpace(os.Getenv(k)); v != "" {
			return v, nil
		}
	}
	return "", nil
}

func parseBoolEnv(key string, def bool) bool {
	v := strings.TrimSpace(strings.ToLower(os.Getenv(key)))
	if v == "" {
		return def
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return def
	}
	return b
}

// LoadRemoteStorageConfigFromEnv loads remote S3-compatible configuration from environment and secret files.
func LoadRemoteStorageConfigFromEnv() (RemoteStorageConfig, error) {
	cfg := RemoteStorageConfig{
		Enabled:     parseBoolEnv("BYOS_BACKUP_REMOTE_ENABLED", false),
		Endpoint:    strings.TrimSpace(os.Getenv("BYOS_BACKUP_REMOTE_ENDPOINT")),
		Region:      strings.TrimSpace(os.Getenv("BYOS_BACKUP_REMOTE_REGION")),
		Bucket:      strings.TrimSpace(os.Getenv("BYOS_BACKUP_REMOTE_BUCKET")),
		Prefix:      strings.Trim(strings.TrimSpace(os.Getenv("BYOS_BACKUP_REMOTE_PREFIX")), "/"),
		PathStyle:   parseBoolEnv("BYOS_BACKUP_REMOTE_PATH_STYLE", false),
		Required:    parseBoolEnv("BYOS_BACKUP_REMOTE_REQUIRED", false),
		UseSSL:      true,
		MaxRetries:     2,
		BaseBackoff:    200 * time.Millisecond,
		Timeout:        15 * time.Second,
		ObjectLockMode: strings.ToUpper(strings.TrimSpace(os.Getenv("BYOS_BACKUP_REMOTE_OBJECT_LOCK_MODE"))),
	}
	if mr := strings.TrimSpace(os.Getenv("BYOS_BACKUP_REMOTE_MAX_RETRIES")); mr != "" {
		if n, err := strconv.Atoi(mr); err == nil && n >= 0 {
			cfg.MaxRetries = n
		}
	}
	if to := strings.TrimSpace(os.Getenv("BYOS_BACKUP_REMOTE_TIMEOUT")); to != "" {
		if d, err := time.ParseDuration(to); err == nil && d > 0 {
			cfg.Timeout = d
		}
	}
	if ld := strings.TrimSpace(os.Getenv("BYOS_BACKUP_REMOTE_OBJECT_LOCK_DAYS")); ld != "" {
		if d, err := strconv.Atoi(ld); err == nil && d > 0 {
			cfg.ObjectLockDays = d
		}
	}
	if cfg.Region == "" {
		cfg.Region = "us-east-1"
	}

	if cfg.Endpoint != "" {
		if strings.HasPrefix(cfg.Endpoint, "http://") || strings.HasPrefix(cfg.Endpoint, "https://") {
			u, err := url.Parse(cfg.Endpoint)
			if err != nil {
				return cfg, fmt.Errorf("invalid BYOS_BACKUP_REMOTE_ENDPOINT %q: %w", cfg.Endpoint, err)
			}
			cfg.UseSSL = strings.EqualFold(u.Scheme, "https")
			cfg.Endpoint = u.Host
		} else if sslEnv := os.Getenv("BYOS_BACKUP_REMOTE_USE_SSL"); sslEnv != "" {
			cfg.UseSSL = parseBoolEnv("BYOS_BACKUP_REMOTE_USE_SSL", true)
		}
	}

	ak, err := resolveSecretFromEnvOrFile("BYOS_BACKUP_REMOTE_ACCESS_KEY_FILE", "BYOS_BACKUP_REMOTE_ACCESS_KEY", "AWS_ACCESS_KEY_ID")
	if err != nil {
		return cfg, err
	}
	sk, err := resolveSecretFromEnvOrFile("BYOS_BACKUP_REMOTE_SECRET_KEY_FILE", "BYOS_BACKUP_REMOTE_SECRET_KEY", "AWS_SECRET_ACCESS_KEY")
	if err != nil {
		return cfg, err
	}
	st, err := resolveSecretFromEnvOrFile("BYOS_BACKUP_REMOTE_SESSION_TOKEN_FILE", "BYOS_BACKUP_REMOTE_SESSION_TOKEN", "AWS_SESSION_TOKEN")
	if err != nil {
		return cfg, err
	}
	cfg.AccessKey = ak
	cfg.SecretKey = sk
	cfg.SessionToken = st
	return cfg, nil
}

// S3Storage implements StorageDestination against any S3-compatible object store.
type S3Storage struct {
	client      *minio.Client
	cfg         RemoteStorageConfig
	maxRetries  int
	baseBackoff time.Duration
}

// NewS3Storage constructs a provider-neutral S3-compatible storage adapter.
// When static/file credentials are not explicitly provided, it uses the AWS SDK v2
// default credential chain with automatic caching and refresh.
func NewS3Storage(cfg RemoteStorageConfig) (*S3Storage, error) {
	return NewS3StorageWithAWSProvider(cfg, nil)
}

// awsSDKV2MinioProvider adapts an AWS SDK v2 CredentialsProvider (with CredentialsCache)
// to minio-go's credentials.Provider interface so S3 and KMS share identical credential resolution and refresh.
type awsSDKV2MinioProvider struct {
	mu          sync.Mutex
	cache       *aws.CredentialsCache
	expiresAt   time.Time
	canExpire   bool
	initialized bool
}

func newAWSSDKV2MinioProvider(provider aws.CredentialsProvider) *awsSDKV2MinioProvider {
	return &awsSDKV2MinioProvider{
		cache: aws.NewCredentialsCache(provider, func(o *aws.CredentialsCacheOptions) {
			o.ExpiryWindow = 5 * time.Minute
		}),
	}
}

func (p *awsSDKV2MinioProvider) Retrieve() (credentials.Value, error) {
	return p.RetrieveWithCredContext(nil)
}

func (p *awsSDKV2MinioProvider) RetrieveWithCredContext(cc *credentials.CredContext) (credentials.Value, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	creds, err := p.cache.Retrieve(ctx)
	if err != nil {
		return credentials.Value{}, fmt.Errorf("%w: resolving AWS credentials: %v", ErrStoragePermission, err)
	}
	if creds.AccessKeyID == "" || creds.SecretAccessKey == "" {
		return credentials.Value{}, fmt.Errorf("%w: AWS credential provider returned empty credentials", ErrStoragePermission)
	}

	p.mu.Lock()
	p.expiresAt = creds.Expires
	p.canExpire = creds.CanExpire
	p.initialized = true
	p.mu.Unlock()

	return credentials.Value{
		AccessKeyID:     creds.AccessKeyID,
		SecretAccessKey: creds.SecretAccessKey,
		SessionToken:    creds.SessionToken,
		Expiration:      creds.Expires,
		SignerType:      credentials.SignatureV4,
	}, nil
}

func (p *awsSDKV2MinioProvider) IsExpired() bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	if !p.initialized {
		return true
	}
	if !p.canExpire || p.expiresAt.IsZero() {
		return false
	}
	return time.Now().UTC().After(p.expiresAt.Add(-2 * time.Minute))
}

// NewS3StorageWithAWSProvider constructs an S3Storage adapter using an explicit AWS SDK v2
// CredentialsProvider when static credentials are not set (useful for testing credential refresh/expiration).
func NewS3StorageWithAWSProvider(cfg RemoteStorageConfig, awsCreds aws.CredentialsProvider) (*S3Storage, error) {
	if cfg.Endpoint == "" {
		return nil, fmt.Errorf("%w: BYOS_BACKUP_REMOTE_ENDPOINT is required", ErrDestinationOffline)
	}
	if cfg.Bucket == "" {
		return nil, fmt.Errorf("%w: BYOS_BACKUP_REMOTE_BUCKET is required", ErrDestinationOffline)
	}
	if !cfg.UseSSL {
		hostOnly := strings.Split(cfg.Endpoint, ":")[0]
		isLocal := hostOnly == "127.0.0.1" || hostOnly == "localhost" || hostOnly == "::1" || parseBoolEnv("BYOS_BACKUP_ALLOW_INSECURE_LOCAL_HTTP", false)
		if !isLocal {
			return nil, fmt.Errorf("%w: non-TLS HTTP endpoint %q is forbidden for remote storage (set HTTPS or BYOS_BACKUP_ALLOW_INSECURE_LOCAL_HTTP=true for local test containers)", ErrStoragePermission, cfg.Endpoint)
		}
	}
	if (cfg.AccessKey == "") != (cfg.SecretKey == "") {
		return nil, fmt.Errorf("%w: incomplete remote credentials (both access key and secret key are required unless using IAM)", ErrStoragePermission)
	}

	lookup := minio.BucketLookupAuto
	if cfg.PathStyle {
		lookup = minio.BucketLookupPath
	}

	var creds *credentials.Credentials
	if cfg.AccessKey != "" || cfg.SecretKey != "" {
		creds = credentials.NewStaticV4(cfg.AccessKey, cfg.SecretKey, cfg.SessionToken)
	} else {
		if awsCreds == nil {
			var opts []func(*awsconfig.LoadOptions) error
			if cfg.Region != "" {
				opts = append(opts, awsconfig.WithRegion(cfg.Region))
			}
			awsCfg, err := awsconfig.LoadDefaultConfig(context.Background(), opts...)
			if err != nil {
				return nil, fmt.Errorf("%w: loading AWS SDK default config: %v", ErrStoragePermission, err)
			}
			awsCreds = awsCfg.Credentials
		}
		creds = credentials.New(newAWSSDKV2MinioProvider(awsCreds))
	}

	transport := &http.Transport{
		DialContext: (&net.Dialer{
			Timeout:   3 * time.Second,
			KeepAlive: 30 * time.Second,
		}).DialContext,
		TLSHandshakeTimeout:   5 * time.Second,
		ResponseHeaderTimeout: 15 * time.Second,
		IdleConnTimeout:       60 * time.Second,
	}

	client, err := minio.New(cfg.Endpoint, &minio.Options{
		Creds:        creds,
		Secure:       cfg.UseSSL,
		Region:       cfg.Region,
		BucketLookup: lookup,
		Transport:    transport,
	})
	if err != nil {
		return nil, fmt.Errorf("initializing S3 client: %w", err)
	}

	maxRetries := cfg.MaxRetries
	if maxRetries <= 0 {
		maxRetries = 2
	}
	baseBackoff := cfg.BaseBackoff
	if baseBackoff <= 0 {
		baseBackoff = 200 * time.Millisecond
	}

	return &S3Storage{
		client:      client,
		cfg:         cfg,
		maxRetries:  maxRetries,
		baseBackoff: baseBackoff,
	}, nil
}

func (s *S3Storage) Name() string {
	return fmt.Sprintf("s3://%s/%s", s.cfg.Bucket, s.cfg.Prefix)
}

func (s *S3Storage) resolveObjectKey(key string, allowEmpty bool) (string, error) {
	normalized := strings.ReplaceAll(strings.TrimSpace(key), "\\", "/")
	for _, seg := range strings.Split(normalized, "/") {
		if seg == ".." {
			return "", fmt.Errorf("%w: path traversal segment '..' is forbidden in remote key %q", ErrStoragePermission, key)
		}
	}
	hasTrailingSlash := strings.HasSuffix(normalized, "/")
	clean := strings.TrimPrefix(filepath.ToSlash(filepath.Clean(normalized)), "/")
	if clean == "." || clean == "" {
		if !allowEmpty {
			return "", fmt.Errorf("%w: remote object key must not be empty", ErrStoragePermission)
		}
		if s.cfg.Prefix == "" {
			return "", nil
		}
		return s.cfg.Prefix + "/", nil
	}
	if hasTrailingSlash && !strings.HasSuffix(clean, "/") {
		clean += "/"
	}
	if s.cfg.Prefix == "" {
		return clean, nil
	}
	return s.cfg.Prefix + "/" + clean, nil
}

func (s *S3Storage) objectKey(key string) string {
	k, err := s.resolveObjectKey(key, true)
	if err != nil {
		return ""
	}
	return k
}

func (s *S3Storage) stripPrefix(fullKey string) string {
	if s.cfg.Prefix == "" {
		return fullKey
	}
	return strings.TrimPrefix(fullKey, s.cfg.Prefix+"/")
}

func mapS3Error(err error, key string) error {
	if err == nil {
		return nil
	}
	var resp minio.ErrorResponse
	if errors.As(err, &resp) {
		switch resp.StatusCode {
		case http.StatusNotFound:
			return fmt.Errorf("%w: %s (%s)", ErrObjectNotFound, key, resp.Code)
		case http.StatusPreconditionFailed, http.StatusConflict:
			return fmt.Errorf("%w: %s (%s)", ErrPreconditionFailed, key, resp.Code)
		case http.StatusForbidden, http.StatusUnauthorized:
			return fmt.Errorf("%w: %s (%s)", ErrStoragePermission, key, resp.Code)
		}
		switch resp.Code {
		case "NoSuchKey", "NoSuchBucket":
			return fmt.Errorf("%w: %s (%s)", ErrObjectNotFound, key, resp.Code)
		case "PreconditionFailed", "ConditionalRequestConflict":
			return fmt.Errorf("%w: %s (%s)", ErrPreconditionFailed, key, resp.Code)
		case "AccessDenied", "InvalidAccessKeyId", "SignatureDoesNotMatch":
			return fmt.Errorf("%w: %s (%s)", ErrStoragePermission, key, resp.Code)
		}
	}
	return err
}

func isPermanentS3Error(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, ErrObjectNotFound) ||
		errors.Is(err, ErrObjectAlreadyExists) ||
		errors.Is(err, ErrPreconditionFailed) ||
		errors.Is(err, ErrStoragePermission) ||
		errors.Is(err, context.Canceled) {
		return true
	}
	var resp minio.ErrorResponse
	if errors.As(err, &resp) {
		if resp.StatusCode == http.StatusUnauthorized ||
			resp.StatusCode == http.StatusForbidden ||
			resp.StatusCode == http.StatusNotFound ||
			resp.StatusCode == http.StatusConflict ||
			resp.StatusCode == http.StatusPreconditionFailed ||
			resp.StatusCode == http.StatusBadRequest {
			return true
		}
	}
	return false
}

func (s *S3Storage) withRetry(ctx context.Context, op func() error) error {
	var lastErr error
	backoff := s.baseBackoff
	for attempt := 0; attempt <= s.maxRetries; attempt++ {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		err := op()
		if err == nil {
			return nil
		}
		lastErr = err
		if isPermanentS3Error(err) {
			return err
		}
		if attempt < s.maxRetries {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(backoff):
			}
			backoff *= 2
		}
	}
	return fmt.Errorf("%w: %v", ErrDestinationOffline, lastErr)
}

func extractSHA256FromStat(info minio.ObjectInfo) string {
	for k, v := range info.UserMetadata {
		if strings.EqualFold(k, s3MetaSHA256Key) || strings.EqualFold(k, "X-Amz-Meta-"+s3MetaSHA256Key) {
			return strings.ToLower(strings.TrimSpace(v))
		}
	}
	return ""
}

func (s *S3Storage) verifyExistingOrConflict(ctx context.Context, key, fullKey, incomingHex string) (alreadyIdentical bool, err error) {
	statCtx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()
	info, statErr := s.client.StatObject(statCtx, s.cfg.Bucket, fullKey, minio.StatObjectOptions{})
	if statErr != nil {
		mapped := mapS3Error(statErr, key)
		if errors.Is(mapped, ErrObjectNotFound) {
			return false, nil
		}
		return false, mapped
	}

	existingHex := extractSHA256FromStat(info)
	if existingHex == "" {
		// Fall back to reading the existing object to compute SHA-256 rather than trusting S3 ETag.
		data, _, getErr := s.Get(ctx, key)
		if getErr != nil {
			return false, getErr
		}
		sum := sha256.Sum256(data)
		existingHex = hex.EncodeToString(sum[:])
	}

	if existingHex == incomingHex {
		return true, nil
	}
	return false, fmt.Errorf("%w: %s (existing %s, incoming %s)", ErrObjectAlreadyExists, key, existingHex, incomingHex)
}

func (s *S3Storage) applyObjectLockOptions(key string, opts *minio.PutObjectOptions) {
	if s.cfg.ObjectLockMode == "" || s.cfg.ObjectLockDays <= 0 {
		return
	}
	// Apply Object Lock retention only to immutable WAL and base backup objects,
	// leaving mutable catalog/ and keys/ manifests unlocked (protected by Bucket Versioning).
	if !strings.HasPrefix(key, "wal/") && !strings.HasPrefix(key, "backups/") {
		return
	}
	retainUntil := time.Now().UTC().Add(time.Duration(s.cfg.ObjectLockDays) * 24 * time.Hour)
	switch s.cfg.ObjectLockMode {
	case "GOVERNANCE":
		opts.Mode = minio.Governance
		opts.RetainUntilDate = retainUntil
	case "COMPLIANCE":
		opts.Mode = minio.Compliance
		opts.RetainUntilDate = retainUntil
	}
}

func (s *S3Storage) Put(ctx context.Context, key string, data []byte, metadata map[string]string) error {
	fullKey, err := s.resolveObjectKey(key, false)
	if err != nil {
		return err
	}
	sum := sha256.Sum256(data)
	incomingHex := hex.EncodeToString(sum[:])

	userMeta := make(map[string]string, len(metadata)+1)
	for k, v := range metadata {
		userMeta[k] = v
	}
	userMeta[s3MetaSHA256Key] = incomingHex

	return s.withRetry(ctx, func() error {
		identical, err := s.verifyExistingOrConflict(ctx, key, fullKey, incomingHex)
		if err != nil {
			return err
		}
		if identical {
			return nil
		}

		opts := minio.PutObjectOptions{
			ContentType:  "application/octet-stream",
			UserMetadata: userMeta,
			PartSize:     s3PartSizeBytes,
		}
		s.applyObjectLockOptions(key, &opts)
		_, putErr := s.client.PutObject(ctx, s.cfg.Bucket, fullKey, bytes.NewReader(data), int64(len(data)), opts)
		if putErr != nil {
			_ = s.client.RemoveIncompleteUpload(ctx, s.cfg.Bucket, fullKey)
			return mapS3Error(putErr, key)
		}

		// Verify uploaded object size and application SHA-256 metadata.
		statInfo, statErr := s.client.StatObject(ctx, s.cfg.Bucket, fullKey, minio.StatObjectOptions{})
		if statErr != nil {
			return mapS3Error(statErr, key)
		}
		if statInfo.Size != int64(len(data)) {
			return fmt.Errorf("remote size mismatch for %s: expected %d, got %d", key, len(data), statInfo.Size)
		}
		if remoteHex := extractSHA256FromStat(statInfo); remoteHex != "" && remoteHex != incomingHex {
			return fmt.Errorf("remote metadata checksum mismatch for %s: expected %s, got %s", key, incomingHex, remoteHex)
		}
		return nil
	})
}

// PutOverwrite performs a direct replacement PUT for mutable manifests (catalog/recovery_catalog.json
// and keys/key_envelopes.json) without creating a delete marker first.
// Immutable WAL and backup objects are rejected fail-closed.
func (s *S3Storage) PutOverwrite(ctx context.Context, key string, data []byte, metadata map[string]string) error {
	return s.putMutableObject(ctx, key, data, metadata, false, "")
}

// PutIfMatch performs a conditional PUT (If-Match: "<etag>" or If-None-Match: * when expectedETag == "")
// for cross-process optimistic concurrency control on mutable manifests.
func (s *S3Storage) PutIfMatch(ctx context.Context, key string, data []byte, metadata map[string]string, expectedETag string) error {
	return s.putMutableObject(ctx, key, data, metadata, true, expectedETag)
}

func (s *S3Storage) putMutableObject(ctx context.Context, key string, data []byte, metadata map[string]string, useCAS bool, expectedETag string) error {
	if key != remoteCatalogKey && key != remoteKeyEnvelopesKey {
		return fmt.Errorf("%w: PutOverwrite is only permitted for mutable manifests, not %q", ErrStoragePermission, key)
	}
	fullKey, err := s.resolveObjectKey(key, false)
	if err != nil {
		return err
	}
	sum := sha256.Sum256(data)
	incomingHex := hex.EncodeToString(sum[:])

	userMeta := make(map[string]string, len(metadata)+1)
	for k, v := range metadata {
		userMeta[k] = v
	}
	userMeta[s3MetaSHA256Key] = incomingHex

	return s.withRetry(ctx, func() error {
		opts := minio.PutObjectOptions{
			ContentType:  "application/octet-stream",
			UserMetadata: userMeta,
			PartSize:     s3PartSizeBytes,
		}
		if useCAS {
			cleanETag := strings.Trim(strings.TrimSpace(expectedETag), "\"")
			if cleanETag == "" {
				opts.SetMatchETagExcept("*")
			} else {
				opts.SetMatchETag(cleanETag)
			}
		}
		// Never apply Object Lock retention to mutable manifests.
		_, putErr := s.client.PutObject(ctx, s.cfg.Bucket, fullKey, bytes.NewReader(data), int64(len(data)), opts)
		if putErr != nil {
			_ = s.client.RemoveIncompleteUpload(ctx, s.cfg.Bucket, fullKey)
			return mapS3Error(putErr, key)
		}

		statInfo, statErr := s.client.StatObject(ctx, s.cfg.Bucket, fullKey, minio.StatObjectOptions{})
		if statErr != nil {
			return mapS3Error(statErr, key)
		}
		if statInfo.Size != int64(len(data)) {
			return fmt.Errorf("remote size mismatch for %s: expected %d, got %d", key, len(data), statInfo.Size)
		}
		if remoteHex := extractSHA256FromStat(statInfo); remoteHex != "" && remoteHex != incomingHex {
			return fmt.Errorf("remote metadata checksum mismatch for %s: expected %s, got %s", key, incomingHex, remoteHex)
		}
		return nil
	})
}

// PutFile streams a large file from disk using multipart upload without loading it fully into memory.
func (s *S3Storage) PutFile(ctx context.Context, key string, filePath string, metadata map[string]string) (string, int64, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return "", 0, fmt.Errorf("opening file %q: %w", filePath, err)
	}
	defer f.Close()

	st, err := f.Stat()
	if err != nil {
		return "", 0, fmt.Errorf("stat file %q: %w", filePath, err)
	}
	fileSize := st.Size()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", 0, fmt.Errorf("hashing file %q: %w", filePath, err)
	}
	incomingHex := hex.EncodeToString(h.Sum(nil))

	fullKey, err := s.resolveObjectKey(key, false)
	if err != nil {
		return "", 0, err
	}
	userMeta := make(map[string]string, len(metadata)+1)
	for k, v := range metadata {
		userMeta[k] = v
	}
	userMeta[s3MetaSHA256Key] = incomingHex

	err = s.withRetry(ctx, func() error {
		identical, checkErr := s.verifyExistingOrConflict(ctx, key, fullKey, incomingHex)
		if checkErr != nil {
			return checkErr
		}
		if identical {
			return nil
		}

		if _, seekErr := f.Seek(0, io.SeekStart); seekErr != nil {
			return seekErr
		}

		opts := minio.PutObjectOptions{
			ContentType:  "application/octet-stream",
			UserMetadata: userMeta,
			PartSize:     s3PartSizeBytes,
		}
		s.applyObjectLockOptions(key, &opts)
		_, putErr := s.client.PutObject(ctx, s.cfg.Bucket, fullKey, f, fileSize, opts)
		if putErr != nil {
			_ = s.client.RemoveIncompleteUpload(ctx, s.cfg.Bucket, fullKey)
			return mapS3Error(putErr, key)
		}

		statInfo, statErr := s.client.StatObject(ctx, s.cfg.Bucket, fullKey, minio.StatObjectOptions{})
		if statErr != nil {
			return mapS3Error(statErr, key)
		}
		if statInfo.Size != fileSize {
			return fmt.Errorf("remote size mismatch for %s: expected %d, got %d", key, fileSize, statInfo.Size)
		}
		if remoteHex := extractSHA256FromStat(statInfo); remoteHex != "" && remoteHex != incomingHex {
			return fmt.Errorf("remote metadata checksum mismatch for %s: expected %s, got %s", key, incomingHex, remoteHex)
		}
		return nil
	})
	return incomingHex, fileSize, err
}

func (s *S3Storage) Get(ctx context.Context, key string) ([]byte, map[string]string, error) {
	data, meta, _, err := s.GetWithETag(ctx, key)
	return data, meta, err
}

// GetWithETag retrieves an object, its metadata, and its S3 ETag in a single GetObject request.
func (s *S3Storage) GetWithETag(ctx context.Context, key string) ([]byte, map[string]string, string, error) {
	fullKey, err := s.resolveObjectKey(key, false)
	if err != nil {
		return nil, nil, "", err
	}
	var outData []byte
	var outMeta map[string]string
	var outETag string

	err = s.withRetry(ctx, func() error {
		obj, getErr := s.client.GetObject(ctx, s.cfg.Bucket, fullKey, minio.GetObjectOptions{})
		if getErr != nil {
			return mapS3Error(getErr, key)
		}
		defer obj.Close()

		info, statErr := obj.Stat()
		if statErr != nil {
			return mapS3Error(statErr, key)
		}

		data, readErr := io.ReadAll(obj)
		if readErr != nil {
			return mapS3Error(readErr, key)
		}

		if expectedHex := extractSHA256FromStat(info); expectedHex != "" {
			sum := sha256.Sum256(data)
			actualHex := hex.EncodeToString(sum[:])
			if actualHex != expectedHex {
				return fmt.Errorf("%w: remote SHA-256 mismatch on %s (expected %s, got %s)", ErrWALCorrupted, key, expectedHex, actualHex)
			}
		}

		outData = data
		outMeta = info.UserMetadata
		outETag = strings.Trim(info.ETag, "\"")
		return nil
	})

	return outData, outMeta, outETag, err
}

// GetFile streams a remote object atomically to a local destination path and verifies its SHA-256.
func (s *S3Storage) GetFile(ctx context.Context, key string, destPath string) (string, int64, error) {
	fullKey, err := s.resolveObjectKey(key, false)
	if err != nil {
		return "", 0, err
	}
	var actualHex string
	var actualSize int64

	err = s.withRetry(ctx, func() error {
		obj, getErr := s.client.GetObject(ctx, s.cfg.Bucket, fullKey, minio.GetObjectOptions{})
		if getErr != nil {
			return mapS3Error(getErr, key)
		}
		defer obj.Close()

		info, statErr := obj.Stat()
		if statErr != nil {
			return mapS3Error(statErr, key)
		}

		if mkErr := os.MkdirAll(filepath.Dir(destPath), 0750); mkErr != nil {
			return mkErr
		}
		tmpPath := fmt.Sprintf("%s.tmp.%d", destPath, time.Now().UnixNano())
		f, openErr := os.OpenFile(tmpPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0600)
		if openErr != nil {
			return openErr
		}

		h := sha256.New()
		n, copyErr := io.Copy(io.MultiWriter(f, h), obj)
		syncErr := f.Sync()
		closeErr := f.Close()
		if copyErr != nil || syncErr != nil || closeErr != nil {
			_ = os.Remove(tmpPath)
			if copyErr != nil {
				return mapS3Error(copyErr, key)
			}
			if syncErr != nil {
				return syncErr
			}
			return closeErr
		}

		actualHex = hex.EncodeToString(h.Sum(nil))
		actualSize = n
		if expectedHex := extractSHA256FromStat(info); expectedHex != "" && actualHex != expectedHex {
			_ = os.Remove(tmpPath)
			return fmt.Errorf("%w: remote SHA-256 mismatch on %s (expected %s, got %s)", ErrWALCorrupted, key, expectedHex, actualHex)
		}
		if n != info.Size {
			_ = os.Remove(tmpPath)
			return fmt.Errorf("incomplete remote read for %s: expected %d bytes, got %d", key, info.Size, n)
		}

		if renErr := os.Rename(tmpPath, destPath); renErr != nil {
			_ = os.Remove(tmpPath)
			return renErr
		}
		return nil
	})

	return actualHex, actualSize, err
}

func (s *S3Storage) Delete(ctx context.Context, key string) error {
	fullKey, err := s.resolveObjectKey(key, false)
	if err != nil {
		return err
	}
	return s.withRetry(ctx, func() error {
		err := s.client.RemoveObject(ctx, s.cfg.Bucket, fullKey, minio.RemoveObjectOptions{})
		mapped := mapS3Error(err, key)
		if errors.Is(mapped, ErrObjectNotFound) {
			return nil
		}
		return mapped
	})
}

func (s *S3Storage) Exists(ctx context.Context, key string) (bool, error) {
	fullKey, err := s.resolveObjectKey(key, false)
	if err != nil {
		return false, err
	}
	var exists bool
	err = s.withRetry(ctx, func() error {
		_, statErr := s.client.StatObject(ctx, s.cfg.Bucket, fullKey, minio.StatObjectOptions{})
		if statErr == nil {
			exists = true
			return nil
		}
		mapped := mapS3Error(statErr, key)
		if errors.Is(mapped, ErrObjectNotFound) {
			exists = false
			return nil
		}
		return mapped
	})
	return exists, err
}

func (s *S3Storage) List(ctx context.Context, prefix string) ([]ObjectInfo, error) {
	fullPrefix, err := s.resolveObjectKey(prefix, true)
	if err != nil {
		return nil, err
	}

	var results []ObjectInfo
	err = s.withRetry(ctx, func() error {
		results = nil
		ch := s.client.ListObjects(ctx, s.cfg.Bucket, minio.ListObjectsOptions{
			Prefix:       fullPrefix,
			Recursive:    true,
			WithMetadata: true,
		})
		for obj := range ch {
			if obj.Err != nil {
				return mapS3Error(obj.Err, fullPrefix)
			}
			results = append(results, ObjectInfo{
				Key:          s.stripPrefix(obj.Key),
				SizeBytes:    obj.Size,
				SHA256Hex:    extractSHA256FromStat(obj),
				LastModified: obj.LastModified.UTC(),
				Metadata:     obj.UserMetadata,
			})
		}
		return nil
	})
	return results, err
}

func (s *S3Storage) GetInfo(ctx context.Context, key string) (ObjectInfo, error) {
	fullKey, err := s.resolveObjectKey(key, false)
	if err != nil {
		return ObjectInfo{}, err
	}
	var out ObjectInfo
	err = s.withRetry(ctx, func() error {
		info, statErr := s.client.StatObject(ctx, s.cfg.Bucket, fullKey, minio.StatObjectOptions{})
		if statErr != nil {
			return mapS3Error(statErr, key)
		}
		out = ObjectInfo{
			Key:          key,
			SizeBytes:    info.Size,
			SHA256Hex:    extractSHA256FromStat(info),
			ETag:         strings.Trim(info.ETag, "\""),
			LastModified: info.LastModified.UTC(),
			Metadata:     info.UserMetadata,
		}
		return nil
	})
	return out, err
}

// CheckConnectivity verifies bucket and prefix accessibility using a prefix-scoped ListObjects
// (MaxKeys=1) instead of HeadBucket, allowing IAM policies to restrict s3:ListBucket via s3:prefix.
func (s *S3Storage) CheckConnectivity(ctx context.Context) error {
	fullPrefix, err := s.resolveObjectKey("", true)
	if err != nil {
		return err
	}
	return s.withRetry(ctx, func() error {
		ch := s.client.ListObjects(ctx, s.cfg.Bucket, minio.ListObjectsOptions{
			Prefix:  fullPrefix,
			MaxKeys: 1,
		})
		for obj := range ch {
			if obj.Err != nil {
				return mapS3Error(obj.Err, s.cfg.Bucket)
			}
			break
		}
		return nil
	})
}
