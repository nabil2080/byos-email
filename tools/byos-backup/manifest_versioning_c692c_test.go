package main

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

type faultInjectingS3Wrapper struct {
	inner      *mockS3Server
	mu         sync.Mutex
	failPut    bool
	failStatus int
	deleteHits int
}

func (f *faultInjectingS3Wrapper) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	if r.Method == http.MethodDelete && r.URL.Query().Get("uploadId") == "" {
		f.deleteHits++
	}
	if r.Method == http.MethodPut && f.failPut {
		status := f.failStatus
		if status == 0 {
			status = http.StatusInternalServerError
		}
		f.mu.Unlock()
		w.Header().Set("Content-Type", "application/xml")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(`<Error><Code>InternalError</Code><Message>Simulated upload failure</Message></Error>`))
		return
	}
	f.mu.Unlock()
	f.inner.ServeHTTP(w, r)
}

func TestManifestReplacement_NoDeleteBeforePutAndFailurePreservesOldManifest(t *testing.T) {
	ctx := context.Background()
	srv := newMockS3Server("c692-synth/")
	wrapper := &faultInjectingS3Wrapper{inner: srv}
	ts := httptest.NewServer(wrapper)
	defer ts.Close()

	s3 := newTestS3Storage(t, ts.URL, "c692-synth")

	// 1. Initial catalog upload
	cat1 := &RecoveryCatalog{
		Entries: []RecoveryCatalogEntry{
			{BackupID: "bkp-1", Status: "completed", StartTime: time.Now().UTC()},
		},
	}
	if err := SaveRemoteCatalog(ctx, s3, cat1); err != nil {
		t.Fatalf("initial SaveRemoteCatalog failed: %v", err)
	}
	if wrapper.deleteHits != 0 {
		t.Fatalf("expected 0 DELETE calls on initial catalog save, got %d", wrapper.deleteHits)
	}

	// 2. Successful replacement PUT (no delete marker)
	cat2 := &RecoveryCatalog{
		Entries: append(cat1.Entries, RecoveryCatalogEntry{BackupID: "bkp-2", Status: "completed", StartTime: time.Now().UTC()}),
	}
	if err := SaveRemoteCatalog(ctx, s3, cat2); err != nil {
		t.Fatalf("replacement SaveRemoteCatalog failed: %v", err)
	}
	if wrapper.deleteHits != 0 {
		t.Fatalf("expected 0 DELETE calls on replacement catalog save, got %d", wrapper.deleteHits)
	}
	catVersions := srv.objects["c692-synth/catalog/recovery_catalog.json"]
	if len(catVersions) != 2 || catVersions[0].deleted || catVersions[1].deleted {
		t.Fatalf("expected 2 intact versions without delete markers, got: %+v", catVersions)
	}

	// 3. Simulated replacement PUT failure must leave cat2 readable
	wrapper.mu.Lock()
	wrapper.failPut = true
	wrapper.failStatus = http.StatusServiceUnavailable
	wrapper.mu.Unlock()

	cat3 := &RecoveryCatalog{
		Entries: append(cat2.Entries, RecoveryCatalogEntry{BackupID: "bkp-3", Status: "completed", StartTime: time.Now().UTC()}),
	}
	if err := SaveRemoteCatalog(ctx, s3, cat3); err == nil {
		t.Fatalf("expected SaveRemoteCatalog to fail during injected PUT failure")
	}
	loadedAfterFail, err := LoadRemoteCatalog(ctx, s3)
	if err != nil {
		t.Fatalf("existing catalog must remain readable after failed replacement: %v", err)
	}
	if len(loadedAfterFail.Entries) != 2 || loadedAfterFail.Entries[1].BackupID != "bkp-2" {
		t.Fatalf("expected previous catalog (2 entries) to remain intact, got: %+v", loadedAfterFail.Entries)
	}

	// 4. Subsequent retry succeeds
	wrapper.mu.Lock()
	wrapper.failPut = false
	wrapper.mu.Unlock()
	if err := SaveRemoteCatalog(ctx, s3, cat3); err != nil {
		t.Fatalf("retry SaveRemoteCatalog failed: %v", err)
	}
	loadedRetry, err := LoadRemoteCatalog(ctx, s3)
	if err != nil || len(loadedRetry.Entries) != 3 {
		t.Fatalf("expected 3 entries after retry, got %+v (err=%v)", loadedRetry, err)
	}
	if wrapper.deleteHits != 0 {
		t.Fatalf("expected 0 DELETE calls across entire catalog lifecycle, got %d", wrapper.deleteHits)
	}
}

func TestKMSEnvelopeManifest_NoDeleteBeforePutFailureAndConcurrency(t *testing.T) {
	ctx := context.Background()
	srv := newMockS3Server("c692-synth/")
	wrapper := &faultInjectingS3Wrapper{inner: srv}
	ts := httptest.NewServer(wrapper)
	defer ts.Close()

	s3 := newTestS3Storage(t, ts.URL, "c692-synth")
	mockKMS := newMockAWSKMSClient()
	keyARN := "arn:aws:kms:us-east-1:123456789012:key/test-cmk"

	provider, err := NewAWSKMSKeyProvider(ctx, mockKMS, keyARN, s3)
	if err != nil {
		t.Fatal(err)
	}

	// 1. Initial key v1 + rotation to v2 without delete markers
	kv1, err := provider.RotateKey(ctx)
	if err != nil {
		t.Fatalf("RotateKey v1 failed: %v", err)
	}
	kv2, err := provider.RotateKey(ctx)
	if err != nil {
		t.Fatalf("RotateKey v2 failed: %v", err)
	}
	if wrapper.deleteHits != 0 {
		t.Fatalf("expected 0 DELETE calls on KMS envelope updates, got %d", wrapper.deleteHits)
	}
	envVersions := srv.objects["c692-synth/keys/key_envelopes.json"]
	if len(envVersions) != 2 || envVersions[0].deleted || envVersions[1].deleted {
		t.Fatalf("expected 2 non-deleted envelope versions, got: %+v", envVersions)
	}

	// 2. Inject PUT failure during v3 rotation -> v1 and v2 must remain readable on fresh provider
	wrapper.mu.Lock()
	wrapper.failPut = true
	wrapper.failStatus = http.StatusForbidden
	wrapper.mu.Unlock()

	if _, err := provider.RotateKey(ctx); err == nil {
		t.Fatalf("expected RotateKey v3 to fail when PUT is denied")
	}

	wrapper.mu.Lock()
	wrapper.failPut = false
	wrapper.mu.Unlock()

	freshProvider, err := NewAWSKMSKeyProvider(ctx, mockKMS, keyARN, s3)
	if err != nil {
		t.Fatalf("fresh recovery provider failed to load key_envelopes.json after failed v3 rotation: %v", err)
	}
	gotV1, err := freshProvider.GetKeyVersion(ctx, "v1")
	if err != nil || !bytes.Equal(gotV1.Key, kv1.Key) {
		t.Fatalf("v1 must remain recoverable after failed v3 rotation: %v", err)
	}
	gotV2, err := freshProvider.GetActiveKey(ctx)
	if err != nil || !bytes.Equal(gotV2.Key, kv2.Key) {
		t.Fatalf("v2 must remain active and recoverable after failed v3 rotation: %v", err)
	}

	// 3. In-process concurrent RotateKey calls must serialize cleanly
	var wg sync.WaitGroup
	errs := make([]error, 3)
	for i := 0; i < 3; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			_, errs[idx] = freshProvider.RotateKey(ctx)
		}(i)
	}
	wg.Wait()
	for i, e := range errs {
		if e != nil {
			t.Fatalf("concurrent RotateKey[%d] failed: %v", i, e)
		}
	}
	versions, err := freshProvider.ListKeyVersions(ctx)
	if err != nil || len(versions) != 5 {
		t.Fatalf("expected 5 serialized key versions (v1..v5), got %d (err=%v)", len(versions), err)
	}

	// 4. PutOverwrite must fail closed on immutable WAL or backup keys
	for _, immutableKey := range []string{"wal/000000010000000000000001.enc", "backups/bkp-1/base.tar.enc"} {
		err := s3.PutOverwrite(ctx, immutableKey, []byte("tamper"), nil)
		if !errors.Is(err, ErrStoragePermission) || !strings.Contains(err.Error(), "mutable manifests") {
			t.Fatalf("expected PutOverwrite on %q to fail closed with ErrStoragePermission, got: %v", immutableKey, err)
		}
	}
}
