package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/kms"
)

// --- 1. Credential Provider & Refresh Tests ---

type mockAWSCredProvider struct {
	mu      sync.Mutex
	calls   int
	results []struct {
		creds aws.Credentials
		err   error
	}
}

func (m *mockAWSCredProvider) Retrieve(ctx context.Context) (aws.Credentials, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	idx := m.calls
	if idx >= len(m.results) {
		idx = len(m.results) - 1
	}
	m.calls++
	res := m.results[idx]
	return res.creds, res.err
}

func TestS3CredentialProvider_ResolveExpiredRefreshAndFailClosed(t *testing.T) {
	now := time.Now().UTC()
	mockProv := &mockAWSCredProvider{
		results: []struct {
			creds aws.Credentials
			err   error
		}{
			{
				creds: aws.Credentials{
					AccessKeyID:     "AKIAIOSFODNN7EXAMPLE1",
					SecretAccessKey: "fake-secret-1",
					SessionToken:    "fake-sts-token-1",
					CanExpire:       true,
					Expires:         now.Add(30 * time.Second), // within 5m AWS cache expiry window & 2m IsExpired window
				},
			},
			{
				creds: aws.Credentials{
					AccessKeyID:     "AKIAIOSFODNN7EXAMPLE2",
					SecretAccessKey: "fake-secret-2",
					SessionToken:    "fake-sts-token-2",
					CanExpire:       true,
					Expires:         now.Add(1 * time.Hour),
				},
			},
		},
	}

	adapter := newAWSSDKV2MinioProvider(mockProv)
	if !adapter.IsExpired() {
		t.Fatalf("expected uninitialized credential adapter to report IsExpired()=true")
	}

	v1, err := adapter.RetrieveWithCredContext(nil)
	if err != nil {
		t.Fatalf("initial RetrieveWithCredContext failed: %v", err)
	}
	if v1.AccessKeyID != "AKIAIOSFODNN7EXAMPLE1" || v1.SessionToken != "fake-sts-token-1" {
		t.Fatalf("unexpected initial credentials: %+v", v1)
	}
	// Because Expires is 30s from now (< 2m refresh window), IsExpired() must trigger refresh
	if !adapter.IsExpired() {
		t.Fatalf("expected near-expiry credentials to report IsExpired()=true")
	}

	v2, err := adapter.RetrieveWithCredContext(nil)
	if err != nil {
		t.Fatalf("refreshed RetrieveWithCredContext failed: %v", err)
	}
	if v2.AccessKeyID != "AKIAIOSFODNN7EXAMPLE2" || v2.SessionToken != "fake-sts-token-2" {
		t.Fatalf("expected refreshed credentials, got: %+v", v2)
	}
	if adapter.IsExpired() {
		t.Fatalf("expected fresh 1h credentials to report IsExpired()=false")
	}

	// Missing credentials must fail closed
	missingProv := &mockAWSCredProvider{
		results: []struct {
			creds aws.Credentials
			err   error
		}{
			{creds: aws.Credentials{}},
		},
	}
	missingAdapter := newAWSSDKV2MinioProvider(missingProv)
	if _, err := missingAdapter.RetrieveWithCredContext(nil); !errors.Is(err, ErrStoragePermission) {
		t.Fatalf("expected ErrStoragePermission on empty credentials, got: %v", err)
	}

	// Refresh failure must fail closed
	failRefreshProv := &mockAWSCredProvider{
		results: []struct {
			creds aws.Credentials
			err   error
		}{
			{err: errors.New("STS AssumeRole expired / network failure")},
		},
	}
	failAdapter := newAWSSDKV2MinioProvider(failRefreshProv)
	if _, err := failAdapter.RetrieveWithCredContext(nil); !errors.Is(err, ErrStoragePermission) {
		t.Fatalf("expected ErrStoragePermission on credential refresh failure, got: %v", err)
	}
}

// --- 2. Mock S3 HTTP Server for Prefix, Connectivity, Object Lock & Pruning ---

type mockS3Object struct {
	data       []byte
	meta       map[string]string
	lockMode   string
	retainDate string
	versionID  string
	deleted    bool
}

type mockS3Server struct {
	mu                     sync.Mutex
	allowedPrefix          string
	bucketExists           bool
	denyAll                bool
	wrongRegion            bool
	sawHeadBucket          bool
	lastListPrefix         string
	sawBypassHeader        bool
	incompleteAborts       int
	objects                map[string][]mockS3Object // fullKey -> versions
	nextVer                int
}

func newMockS3Server(allowedPrefix string) *mockS3Server {
	return &mockS3Server{
		allowedPrefix: allowedPrefix,
		bucketExists:  true,
		objects:       make(map[string][]mockS3Object),
	}
}

func (m *mockS3Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if r.Header.Get("X-Amz-Bypass-Governance-Retention") != "" {
		m.sawBypassHeader = true
	}

	if m.wrongRegion {
		w.Header().Set("Content-Type", "application/xml")
		w.WriteHeader(http.StatusMovedPermanently)
		_, _ = w.Write([]byte(`<Error><Code>PermanentRedirect</Code><Message>Wrong region</Message></Error>`))
		return
	}
	if m.denyAll {
		w.Header().Set("Content-Type", "application/xml")
		w.WriteHeader(http.StatusForbidden)
		_, _ = w.Write([]byte(`<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>`))
		return
	}
	if !m.bucketExists {
		w.Header().Set("Content-Type", "application/xml")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`<Error><Code>NoSuchBucket</Code><Message>No such bucket</Message></Error>`))
		return
	}

	// Path-style: /<bucket> or /<bucket>/<key>
	trimmed := strings.TrimPrefix(r.URL.Path, "/")
	parts := strings.SplitN(trimmed, "/", 2)
	key := ""
	if len(parts) == 2 {
		key = parts[1]
	}

	if key == "" && r.Method == http.MethodHead {
		m.sawHeadBucket = true
		w.WriteHeader(http.StatusOK)
		return
	}

	if key == "" && r.Method == http.MethodGet {
		reqPrefix := r.URL.Query().Get("prefix")
		m.lastListPrefix = reqPrefix
		if m.allowedPrefix != "" && !strings.HasPrefix(reqPrefix, m.allowedPrefix) {
			w.Header().Set("Content-Type", "application/xml")
			w.WriteHeader(http.StatusForbidden)
			_, _ = w.Write([]byte(`<Error><Code>AccessDenied</Code><Message>Prefix outside allowed scope</Message></Error>`))
			return
		}

		type contentsItem struct {
			Key          string `xml:"Key"`
			LastModified string `xml:"LastModified"`
			ETag         string `xml:"ETag"`
			Size         int    `xml:"Size"`
		}
		var items []contentsItem
		var keys []string
		for k := range m.objects {
			if strings.HasPrefix(k, reqPrefix) {
				keys = append(keys, k)
			}
		}
		sort.Strings(keys)
		for _, k := range keys {
			vers := m.objects[k]
			if len(vers) == 0 || vers[len(vers)-1].deleted {
				continue
			}
			cur := vers[len(vers)-1]
			items = append(items, contentsItem{
				Key:          k,
				LastModified: time.Now().UTC().Format(time.RFC3339),
				ETag:         `"mock-etag"`,
				Size:         len(cur.data),
			})
		}
		type listResp struct {
			XMLName     xml.Name       `xml:"ListBucketResult"`
			Name        string         `xml:"Name"`
			Prefix      string         `xml:"Prefix"`
			IsTruncated bool           `xml:"IsTruncated"`
			Contents    []contentsItem `xml:"Contents"`
		}
		w.Header().Set("Content-Type", "application/xml")
		w.WriteHeader(http.StatusOK)
		_ = xml.NewEncoder(w).Encode(listResp{Name: parts[0], Prefix: reqPrefix, Contents: items})
		return
	}

	if r.Method == http.MethodPut {
		if ifNoneMatch := r.Header.Get("If-None-Match"); ifNoneMatch == "*" {
			vers := m.objects[key]
			if len(vers) > 0 && !vers[len(vers)-1].deleted {
				w.Header().Set("Content-Type", "application/xml")
				w.WriteHeader(http.StatusPreconditionFailed)
				_, _ = w.Write([]byte(`<Error><Code>PreconditionFailed</Code><Message>Object already exists</Message></Error>`))
				return
			}
		}
		if ifMatch := r.Header.Get("If-Match"); ifMatch != "" && ifMatch != "*" {
			expected := strings.Trim(ifMatch, "\"")
			vers := m.objects[key]
			curETag := ""
			if len(vers) > 0 && !vers[len(vers)-1].deleted {
				curETag = "etag-" + vers[len(vers)-1].versionID
			}
			if curETag == "" || curETag != expected {
				w.Header().Set("Content-Type", "application/xml")
				w.WriteHeader(http.StatusPreconditionFailed)
				_, _ = w.Write([]byte(`<Error><Code>PreconditionFailed</Code><Message>ETag mismatch</Message></Error>`))
				return
			}
		}
		body, _ := io.ReadAll(r.Body)
		if strings.HasPrefix(r.Header.Get("X-Amz-Content-Sha256"), "STREAMING-AWS4-HMAC-SHA256-PAYLOAD") {
			var decoded bytes.Buffer
			rem := body
			for len(rem) > 0 {
				idx := bytes.Index(rem, []byte("\r\n"))
				if idx < 0 {
					break
				}
				headerLine := string(rem[:idx])
				semi := strings.IndexByte(headerLine, ';')
				if semi >= 0 {
					headerLine = headerLine[:semi]
				}
				var chunkLen int
				if _, scanErr := fmt.Sscanf(headerLine, "%x", &chunkLen); scanErr != nil || chunkLen == 0 {
					break
				}
				rem = rem[idx+2:]
				if len(rem) < chunkLen {
					break
				}
				decoded.Write(rem[:chunkLen])
				rem = rem[chunkLen:]
				if bytes.HasPrefix(rem, []byte("\r\n")) {
					rem = rem[2:]
				}
			}
			body = decoded.Bytes()
		}
		meta := map[string]string{}
		for hk, hv := range r.Header {
			if strings.HasPrefix(strings.ToLower(hk), "x-amz-meta-") && len(hv) > 0 {
				meta[strings.ToLower(hk)] = hv[0]
			}
		}
		m.nextVer++
		ver := mockS3Object{
			data:       body,
			meta:       meta,
			lockMode:   r.Header.Get("X-Amz-Object-Lock-Mode"),
			retainDate: r.Header.Get("X-Amz-Object-Lock-Retain-Until-Date"),
			versionID:  fmt.Sprintf("v-%d", m.nextVer),
		}
		m.objects[key] = append(m.objects[key], ver)
		w.Header().Set("ETag", fmt.Sprintf(`"etag-%s"`, ver.versionID))
		w.Header().Set("x-amz-version-id", ver.versionID)
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method == http.MethodHead || r.Method == http.MethodGet {
		vers := m.objects[key]
		if len(vers) == 0 || vers[len(vers)-1].deleted {
			w.Header().Set("Content-Type", "application/xml")
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`<Error><Code>NoSuchKey</Code><Message>Not found</Message></Error>`))
			return
		}
		cur := vers[len(vers)-1]
		for mk, mv := range cur.meta {
			w.Header().Set(mk, mv)
		}
		w.Header().Set("Content-Length", fmt.Sprintf("%d", len(cur.data)))
		w.Header().Set("ETag", fmt.Sprintf(`"etag-%s"`, cur.versionID))
		w.Header().Set("Last-Modified", time.Now().UTC().Format(http.TimeFormat))
		w.WriteHeader(http.StatusOK)
		if r.Method == http.MethodGet {
			_, _ = w.Write(cur.data)
		}
		return
	}

	if r.Method == http.MethodDelete {
		if r.URL.Query().Get("uploadId") != "" {
			m.incompleteAborts++
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if reqVer := r.URL.Query().Get("versionId"); reqVer != "" {
			// Locked version deletion without Governance bypass is forbidden
			for _, v := range m.objects[key] {
				if v.versionID == reqVer && v.lockMode != "" && r.Header.Get("X-Amz-Bypass-Governance-Retention") != "true" {
					w.Header().Set("Content-Type", "application/xml")
					w.WriteHeader(http.StatusForbidden)
					_, _ = w.Write([]byte(`<Error><Code>AccessDenied</Code><Message>Object Lock protected</Message></Error>`))
					return
				}
			}
		}
		// Standard RemoveObject without VersionId creates a delete marker in versioned bucket
		m.nextVer++
		m.objects[key] = append(m.objects[key], mockS3Object{
			deleted:   true,
			versionID: fmt.Sprintf("dm-%d", m.nextVer),
		})
		w.WriteHeader(http.StatusNoContent)
		return
	}
}

func newTestS3Storage(t *testing.T, srvURL string, prefix string) *S3Storage {
	t.Helper()
	t.Setenv("BYOS_BACKUP_ALLOW_INSECURE_LOCAL_HTTP", "true")
	prov := &mockAWSCredProvider{
		results: []struct {
			creds aws.Credentials
			err   error
		}{
			{creds: aws.Credentials{AccessKeyID: "AKIAFAKE", SecretAccessKey: "SECRETFAKE", SessionToken: "STSFAKE"}},
		},
	}
	s3, err := NewS3StorageWithAWSProvider(RemoteStorageConfig{
		Enabled:        true,
		Endpoint:       strings.TrimPrefix(srvURL, "http://"),
		Region:         "us-east-1",
		Bucket:         "byos-test-bucket",
		Prefix:         prefix,
		PathStyle:      true,
		UseSSL:         false,
		MaxRetries:     0,
		ObjectLockMode: "GOVERNANCE",
		ObjectLockDays: 7,
	}, prov)
	if err != nil {
		t.Fatalf("NewS3StorageWithAWSProvider failed: %v", err)
	}
	return s3
}

func TestS3PrefixContract_ResolutionAndRoundTrip(t *testing.T) {
	srv := newMockS3Server("c692-synth/")
	ts := httptest.NewServer(srv)
	defer ts.Close()

	s3WithPrefix := newTestS3Storage(t, ts.URL, "c692-synth")
	s3NoPrefix := newTestS3Storage(t, ts.URL, "")

	// 1. Empty argument with configured prefix
	if got, err := s3WithPrefix.resolveObjectKey("", true); err != nil || got != "c692-synth/" {
		t.Fatalf("expected 'c692-synth/', got %q (err=%v)", got, err)
	}
	if _, err := s3WithPrefix.resolveObjectKey("", false); !errors.Is(err, ErrStoragePermission) {
		t.Fatalf("expected empty object key to be rejected, got: %v", err)
	}

	// 2. Relative path & 3. Nested relative path
	if got, err := s3WithPrefix.resolveObjectKey("wal/0001.enc", false); err != nil || got != "c692-synth/wal/0001.enc" {
		t.Fatalf("unexpected relative path key: %q (%v)", got, err)
	}
	if got, err := s3WithPrefix.resolveObjectKey("backups/bkp-1/base.tar.enc", false); err != nil || got != "c692-synth/backups/bkp-1/base.tar.enc" {
		t.Fatalf("unexpected nested path key: %q (%v)", got, err)
	}

	// 4. No configured prefix
	if got, err := s3NoPrefix.resolveObjectKey("wal/0001.enc", false); err != nil || got != "wal/0001.enc" {
		t.Fatalf("unexpected no-prefix key: %q (%v)", got, err)
	}

	// 5. Boundary handling for leading and trailing slashes
	if got, err := s3WithPrefix.resolveObjectKey("/wal/0001.enc", false); err != nil || got != "c692-synth/wal/0001.enc" {
		t.Fatalf("unexpected leading-slash key: %q (%v)", got, err)
	}
	if got, err := s3WithPrefix.resolveObjectKey("wal/", true); err != nil || got != "c692-synth/wal/" {
		t.Fatalf("unexpected trailing-slash list prefix: %q (%v)", got, err)
	}

	// 6. Prefix escape attempts must fail closed
	for _, bad := range []string{"../outside", "wal/../../outside", "/../secret"} {
		if _, err := s3WithPrefix.resolveObjectKey(bad, false); !errors.Is(err, ErrStoragePermission) {
			t.Fatalf("expected ErrStoragePermission for traversal %q, got: %v", bad, err)
		}
	}

	// 7. Put, List, and Get round-trip using single-prefix contract
	ctx := context.Background()
	payload := []byte("encrypted-wal-bytes")
	if err := s3WithPrefix.Put(ctx, "wal/000000010000000000000001.enc", payload, nil); err != nil {
		t.Fatalf("Put failed: %v", err)
	}
	if _, ok := srv.objects["c692-synth/wal/000000010000000000000001.enc"]; !ok {
		t.Fatalf("expected exact key 'c692-synth/wal/000000010000000000000001.enc' on server")
	}
	listed, err := s3WithPrefix.List(ctx, "")
	if err != nil || len(listed) != 1 || listed[0].Key != "wal/000000010000000000000001.enc" {
		t.Fatalf("unexpected List output: %+v (err=%v)", listed, err)
	}
	gotData, _, err := s3WithPrefix.Get(ctx, listed[0].Key)
	if err != nil || !bytes.Equal(gotData, payload) {
		t.Fatalf("Get round-trip mismatch: err=%v", err)
	}
}

func TestS3CheckConnectivity_PrefixScopedMockResponses(t *testing.T) {
	ctx := context.Background()
	srv := newMockS3Server("c692-synth/")
	ts := httptest.NewServer(srv)
	defer ts.Close()

	// 1. Valid connectivity with non-empty prefix must NOT call HeadBucket
	s3 := newTestS3Storage(t, ts.URL, "c692-synth")
	if err := s3.CheckConnectivity(ctx); err != nil {
		t.Fatalf("expected valid connectivity, got: %v", err)
	}
	if srv.sawHeadBucket {
		t.Fatalf("CheckConnectivity must not issue HeadBucket")
	}
	if srv.lastListPrefix != "c692-synth/" {
		t.Fatalf("expected prefix-scoped ListObjects 'c692-synth/', got %q", srv.lastListPrefix)
	}

	// 2. Listing outside permitted prefix is denied
	srvNoPrefixCheck := newMockS3Server("other-prefix/")
	ts2 := httptest.NewServer(srvNoPrefixCheck)
	defer ts2.Close()
	s3Outside := newTestS3Storage(t, ts2.URL, "c692-synth")
	if err := s3Outside.CheckConnectivity(ctx); !errors.Is(err, ErrStoragePermission) {
		t.Fatalf("expected ErrStoragePermission when listing outside allowed prefix, got: %v", err)
	}

	// 3. Valid connectivity with empty prefix
	srvEmpty := newMockS3Server("")
	ts3 := httptest.NewServer(srvEmpty)
	defer ts3.Close()
	s3Empty := newTestS3Storage(t, ts3.URL, "")
	if err := s3Empty.CheckConnectivity(ctx); err != nil {
		t.Fatalf("expected valid empty-prefix connectivity, got: %v", err)
	}

	// 4. Missing bucket
	srv.bucketExists = false
	if err := s3.CheckConnectivity(ctx); !errors.Is(err, ErrObjectNotFound) {
		t.Fatalf("expected ErrObjectNotFound for missing bucket, got: %v", err)
	}
	srv.bucketExists = true

	// 5. Permission denied
	srv.denyAll = true
	if err := s3.CheckConnectivity(ctx); !errors.Is(err, ErrStoragePermission) {
		t.Fatalf("expected ErrStoragePermission for AccessDenied, got: %v", err)
	}
	srv.denyAll = false

	// 6. Wrong region (301 PermanentRedirect)
	srv.wrongRegion = true
	if err := s3.CheckConnectivity(ctx); err == nil {
		t.Fatalf("expected error on wrong region redirect")
	}
	srv.wrongRegion = false

	// 7. Invalid endpoint
	s3Bad := newTestS3Storage(t, "http://127.0.0.1:1", "c692-synth")
	if err := s3Bad.CheckConnectivity(ctx); !errors.Is(err, ErrDestinationOffline) {
		t.Fatalf("expected ErrDestinationOffline for unreachable endpoint, got: %v", err)
	}
}

func TestS3ObjectLockAndPruning_MockS3Semantics(t *testing.T) {
	ctx := context.Background()
	srv := newMockS3Server("c692-synth/")
	ts := httptest.NewServer(srv)
	defer ts.Close()

	s3 := newTestS3Storage(t, ts.URL, "c692-synth")

	// 1. WAL and backup uploads must carry GOVERNANCE retention headers
	if err := s3.Put(ctx, "wal/000000010000000000000001.enc", []byte("wal-data"), nil); err != nil {
		t.Fatalf("WAL Put failed: %v", err)
	}
	walVers := srv.objects["c692-synth/wal/000000010000000000000001.enc"]
	if len(walVers) != 1 || walVers[0].lockMode != "GOVERNANCE" || walVers[0].retainDate == "" {
		t.Fatalf("expected GOVERNANCE Object Lock headers on wal/, got: %+v", walVers)
	}

	// 2. Mutable catalog and key_envelopes must NOT carry Object Lock headers and can be replaced
	if err := s3.Put(ctx, "catalog/recovery_catalog.json", []byte(`{"v":1}`), nil); err != nil {
		t.Fatalf("catalog Put 1 failed: %v", err)
	}
	catVers := srv.objects["c692-synth/catalog/recovery_catalog.json"]
	if catVers[0].lockMode != "" {
		t.Fatalf("mutable catalog must not have Object Lock headers, got: %q", catVers[0].lockMode)
	}
	if err := s3.Delete(ctx, "catalog/recovery_catalog.json"); err != nil {
		t.Fatalf("catalog Delete failed: %v", err)
	}
	if err := s3.Put(ctx, "catalog/recovery_catalog.json", []byte(`{"v":2}`), nil); err != nil {
		t.Fatalf("catalog Put 2 failed: %v", err)
	}

	// 3. RemoveObject creates a delete marker while preserving underlying locked version; never sends BypassGovernanceRetention
	if err := s3.Delete(ctx, "wal/000000010000000000000001.enc"); err != nil {
		t.Fatalf("Delete failed: %v", err)
	}
	if srv.sawBypassHeader {
		t.Fatalf("SECURITY VIOLATION: S3Storage.Delete sent x-amz-bypass-governance-retention")
	}
	if ok, err := s3.Exists(ctx, "wal/000000010000000000000001.enc"); err != nil || ok {
		t.Fatalf("expected delete-marked object to be hidden from Exists, got ok=%v err=%v", ok, err)
	}
	if len(srv.objects["c692-synth/wal/000000010000000000000001.enc"]) != 2 {
		t.Fatalf("expected underlying locked version + delete marker (2 versions), got %d", len(srv.objects["c692-synth/wal/000000010000000000000001.enc"]))
	}

	// 4. Version-specific deletion of locked object without bypass must be denied (403)
	req, _ := http.NewRequest(http.MethodDelete, ts.URL+"/byos-test-bucket/c692-synth/wal/000000010000000000000001.enc?versionId="+walVers[0].versionID, nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden on versioned delete of Governance-locked object, got %d", resp.StatusCode)
	}
}

// --- 3. KMS Policy, EncryptionContext & Error Tests ---

type failingAWSKMSClient struct {
	inner       *mockAWSKMSClient
	denyDecrypt bool
	disabledKey bool
}

func (f *failingAWSKMSClient) GenerateDataKey(ctx context.Context, params *kms.GenerateDataKeyInput, optFns ...func(*kms.Options)) (*kms.GenerateDataKeyOutput, error) {
	if f.disabledKey {
		return nil, errors.New("DisabledException: KMS key is disabled")
	}
	return f.inner.GenerateDataKey(ctx, params, optFns...)
}

func (f *failingAWSKMSClient) Decrypt(ctx context.Context, params *kms.DecryptInput, optFns ...func(*kms.Options)) (*kms.DecryptOutput, error) {
	if f.disabledKey {
		return nil, errors.New("DisabledException: KMS key is disabled")
	}
	if f.denyDecrypt {
		return nil, errors.New("AccessDeniedException: User is not authorized to perform: kms:Decrypt")
	}
	return f.inner.Decrypt(ctx, params, optFns...)
}

func TestAWSKMS_EncryptionContextMismatchUnavailableAndHistoricalRecovery(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStorage(0)
	baseMock := newMockAWSKMSClient()
	kmsClient := &failingAWSKMSClient{inner: baseMock}
	keyARN := "arn:aws:kms:us-east-1:123456789012:key/test-cmk"

	p, err := NewAWSKMSKeyProvider(ctx, kmsClient, keyARN, store)
	if err != nil {
		t.Fatal(err)
	}
	kv1, err := p.RotateKey(ctx)
	if err != nil {
		t.Fatal(err)
	}
	kv2, err := p.RotateKey(ctx)
	if err != nil {
		t.Fatal(err)
	}

	// Incorrect encryption context must fail Decrypt
	if _, err := baseMock.Decrypt(ctx, &kms.DecryptInput{
		CiphertextBlob:    []byte("KMS_WRAPPED_BLOB:dummy"),
		EncryptionContext: map[string]string{"byos_key_version": "v1", "byos_purpose": "wrong_purpose"},
	}); err == nil {
		t.Fatalf("expected Decrypt to fail with wrong encryption context")
	}

	// Missing KMS permission must fail closed
	kmsClient.denyDecrypt = true
	freshDenied, _ := NewAWSKMSKeyProvider(ctx, kmsClient, keyARN, store)
	if _, err := freshDenied.GetKeyVersion(ctx, "v1"); err == nil {
		t.Fatalf("expected AccessDeniedException on GetKeyVersion")
	}
	kmsClient.denyDecrypt = false

	// Disabled CMK must fail closed for both Decrypt and GenerateDataKey
	kmsClient.disabledKey = true
	if _, err := freshDenied.GetKeyVersion(ctx, "v1"); err == nil {
		t.Fatalf("expected DisabledException on historical Decrypt")
	}
	if _, err := freshDenied.RotateKey(ctx); err == nil {
		t.Fatalf("expected DisabledException on RotateKey")
	}
	kmsClient.disabledKey = false

	// Historical v1 and active v2 recover cleanly when enabled
	freshOK, _ := NewAWSKMSKeyProvider(ctx, kmsClient, keyARN, store)
	r1, err := freshOK.GetKeyVersion(ctx, "v1")
	if err != nil || !bytes.Equal(r1.Key, kv1.Key) {
		t.Fatalf("historical v1 recovery failed: %v", err)
	}
	r2, err := freshOK.GetActiveKey(ctx)
	if err != nil || !bytes.Equal(r2.Key, kv2.Key) {
		t.Fatalf("active v2 recovery failed: %v", err)
	}
	if _, err := freshOK.GetKeyVersion(ctx, "v404"); !errors.Is(err, ErrKeyNotFound) {
		t.Fatalf("expected ErrKeyNotFound, got: %v", err)
	}

	// Verify SHA-256 helper consistency
	sum := sha256.Sum256([]byte("test"))
	if len(hex.EncodeToString(sum[:])) != 64 {
		t.Fatalf("unexpected sha256 length")
	}
}
