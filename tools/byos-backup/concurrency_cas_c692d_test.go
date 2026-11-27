package main

import (
	"context"
	"errors"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

// unsupportedStorageWrapper implements StorageDestination only (not MutableStorageDestination).
type unsupportedStorageWrapper struct {
	inner StorageDestination
}

func (u *unsupportedStorageWrapper) Name() string { return "unsupported-wrapper" }
func (u *unsupportedStorageWrapper) Put(ctx context.Context, key string, data []byte, metadata map[string]string) error {
	return u.inner.Put(ctx, key, data, metadata)
}
func (u *unsupportedStorageWrapper) Get(ctx context.Context, key string) ([]byte, map[string]string, error) {
	return u.inner.Get(ctx, key)
}
func (u *unsupportedStorageWrapper) Delete(ctx context.Context, key string) error {
	return u.inner.Delete(ctx, key)
}
func (u *unsupportedStorageWrapper) Exists(ctx context.Context, key string) (bool, error) {
	return u.inner.Exists(ctx, key)
}
func (u *unsupportedStorageWrapper) List(ctx context.Context, prefix string) ([]ObjectInfo, error) {
	return u.inner.List(ctx, prefix)
}
func (u *unsupportedStorageWrapper) GetInfo(ctx context.Context, key string) (ObjectInfo, error) {
	return u.inner.GetInfo(ctx, key)
}

func TestStorageInterfaceContract_AndDualStorageReconciliation(t *testing.T) {
	ctx := context.Background()

	// 1. Unsupported wrapper must fail closed (never fall back to delete-before-put)
	unsupported := &unsupportedStorageWrapper{inner: NewMemoryStorage(0)}
	if err := putMutableManifest(ctx, unsupported, remoteCatalogKey, []byte(`{}`), nil); !errors.Is(err, ErrStoragePermission) {
		t.Fatalf("expected ErrStoragePermission for non-MutableStorageDestination, got: %v", err)
	}

	// 2. DualStorage forwards PutOverwrite and reconciles after remote failure
	local := NewMemoryStorage(0)
	remote := NewMemoryStorage(0)
	dualReq := NewDualStorage(local, remote, true)

	if err := putMutableManifest(ctx, dualReq, remoteCatalogKey, []byte(`{"v":1}`), nil); err != nil {
		t.Fatalf("initial DualStorage PutOverwrite failed: %v", err)
	}

	remote.SetSimulateOffline(true)
	if err := putMutableManifest(ctx, dualReq, remoteCatalogKey, []byte(`{"v":2}`), nil); !errors.Is(err, ErrDestinationOffline) {
		t.Fatalf("expected ErrDestinationOffline when remote is offline in required mode, got: %v", err)
	}
	// Local has v2, remote still has v1
	remote.SetSimulateOffline(false)
	remBytes, _, err := remote.Get(ctx, remoteCatalogKey)
	if err != nil || string(remBytes) != `{"v":1}` {
		t.Fatalf("expected remote to preserve v1 on failed write, got %q (err=%v)", string(remBytes), err)
	}

	// Retry reconciles both local and remote to v2
	if err := putMutableManifest(ctx, dualReq, remoteCatalogKey, []byte(`{"v":2}`), nil); err != nil {
		t.Fatalf("DualStorage PutOverwrite retry failed: %v", err)
	}
	remBytes2, _, _ := remote.Get(ctx, remoteCatalogKey)
	if string(remBytes2) != `{"v":2}` {
		t.Fatalf("expected remote to reconcile to v2, got %q", string(remBytes2))
	}
}

func TestCrossProcessCatalogCAS_ConflictReloadMergeAndInitialRace(t *testing.T) {
	ctx := context.Background()
	srv := newMockS3Server("c692-synth/")
	ts := httptest.NewServer(srv)
	defer ts.Close()

	// Two independent S3Storage clients simulating separate OS processes
	clientA := newTestS3Storage(t, ts.URL, "c692-synth")
	clientB := newTestS3Storage(t, ts.URL, "c692-synth")

	// 1. Initial creation race (If-None-Match: *)
	var wg sync.WaitGroup
	initErrs := make([]error, 2)
	for i, cl := range []*S3Storage{clientA, clientB} {
		wg.Add(1)
		go func(idx int, c *S3Storage) {
			defer wg.Done()
			cat := &RecoveryCatalog{Entries: []RecoveryCatalogEntry{{BackupID: "bkp-init-" + string(rune('A'+idx)), Status: "completed", StartTime: time.Now().UTC()}}}
			initErrs[idx] = SaveRemoteCatalogCAS(ctx, c, cat, "")
		}(i, cl)
	}
	wg.Wait()
	successCount := 0
	conflictCount := 0
	for _, e := range initErrs {
		if e == nil {
			successCount++
		} else if errors.Is(e, ErrPreconditionFailed) {
			conflictCount++
		} else {
			t.Fatalf("unexpected initial race error: %v", e)
		}
	}
	if successCount != 1 || conflictCount != 1 {
		t.Fatalf("expected 1 winner and 1 412 conflict on initial creation race, got success=%d conflict=%d", successCount, conflictCount)
	}

	// 2. Stale-ETag conflict, reload, merge, and retry
	catA, etagA, err := LoadRemoteCatalogWithETag(ctx, clientA)
	if err != nil || etagA == "" {
		t.Fatalf("clientA LoadRemoteCatalogWithETag failed: etag=%q err=%v", etagA, err)
	}
	catB, etagB, err := LoadRemoteCatalogWithETag(ctx, clientB)
	if err != nil || etagB != etagA {
		t.Fatalf("clientB LoadRemoteCatalogWithETag failed: etagB=%q etagA=%q err=%v", etagB, etagA, err)
	}

	// Writer A commits first
	catA.Entries = append(catA.Entries, RecoveryCatalogEntry{BackupID: "bkp-A", Status: "completed", StartTime: time.Now().UTC()})
	if err := SaveRemoteCatalogCAS(ctx, clientA, catA, etagA); err != nil {
		t.Fatalf("clientA SaveRemoteCatalogCAS failed: %v", err)
	}

	// Writer B tries to commit with stale etagB -> must fail with ErrPreconditionFailed (412)
	catB.Entries = append(catB.Entries, RecoveryCatalogEntry{BackupID: "bkp-B", Status: "completed", StartTime: time.Now().UTC()})
	if err := SaveRemoteCatalogCAS(ctx, clientB, catB, etagB); !errors.Is(err, ErrPreconditionFailed) {
		t.Fatalf("expected ErrPreconditionFailed for stale clientB write, got: %v", err)
	}

	// Writer B reloads, merges bkp-B, and commits with fresh ETag
	catBReloaded, etagBNew, err := LoadRemoteCatalogWithETag(ctx, clientB)
	if err != nil || etagBNew == etagB {
		t.Fatalf("expected new ETag after clientA write, got old=%q new=%q (err=%v)", etagB, etagBNew, err)
	}
	catBReloaded.Entries = append(catBReloaded.Entries, RecoveryCatalogEntry{BackupID: "bkp-B", Status: "completed", StartTime: time.Now().UTC()})
	if err := SaveRemoteCatalogCAS(ctx, clientB, catBReloaded, etagBNew); err != nil {
		t.Fatalf("clientB CAS retry failed: %v", err)
	}

	finalCat, err := LoadRemoteCatalog(ctx, clientA)
	if err != nil || len(finalCat.Entries) != 3 {
		t.Fatalf("expected 3 merged catalog entries (init + A + B), got %+v (err=%v)", finalCat, err)
	}
}

func TestCrossProcessKMSEnvelopeCAS_ConflictReloadAndObjectLockCheck(t *testing.T) {
	ctx := context.Background()
	srv := newMockS3Server("c692-synth/")
	ts := httptest.NewServer(srv)
	defer ts.Close()

	clientA := newTestS3Storage(t, ts.URL, "c692-synth")
	clientB := newTestS3Storage(t, ts.URL, "c692-synth")
	mockKMS := newMockAWSKMSClient()
	keyARN := "arn:aws:kms:us-east-1:123456789012:key/test-cmk"

	provA, err := NewAWSKMSKeyProvider(ctx, mockKMS, keyARN, clientA)
	if err != nil {
		t.Fatal(err)
	}
	// Seed v1 via provA
	if _, err := provA.RotateKey(ctx); err != nil {
		t.Fatal(err)
	}

	// provB loads v1 (same initial ETag as provA)
	provB, err := NewAWSKMSKeyProvider(ctx, mockKMS, keyARN, clientB)
	if err != nil {
		t.Fatal(err)
	}

	// provA rotates to v2 (advances S3 ETag)
	if _, err := provA.RotateKey(ctx); err != nil {
		t.Fatalf("provA RotateKey v2 failed: %v", err)
	}

	// provB has stale manifestETag, so its RotateKey automatically hits 412, reloads v1+v2, and creates v3!
	kv3, err := provB.RotateKey(ctx)
	if err != nil {
		t.Fatalf("provB RotateKey CAS reload+retry failed: %v", err)
	}
	if kv3.VersionID != "v3" {
		t.Fatalf("expected provB to mint v3 after CAS reload, got %q", kv3.VersionID)
	}

	// Verify all 3 versions (v1, v2, v3) are intact and zero Object Lock headers were sent on keys/key_envelopes.json
	vers := srv.objects["c692-synth/keys/key_envelopes.json"]
	if len(vers) != 3 {
		t.Fatalf("expected 3 envelope versions on S3, got %d", len(vers))
	}
	for i, v := range vers {
		if v.lockMode != "" || v.retainDate != "" {
			t.Fatalf("mutable key_envelopes.json version %d must not send explicit Object Lock headers, got mode=%q", i, v.lockMode)
		}
	}
}
