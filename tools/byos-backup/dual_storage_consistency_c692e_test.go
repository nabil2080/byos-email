package main

import (
	"context"
	"errors"
	"testing"
)

func TestDualStorageConsistency_PutOverwriteMatrix(t *testing.T) {
	ctx := context.Background()

	t.Run("BothSuccess_ExactManifestInBoth", func(t *testing.T) {
		local := NewMemoryStorage(0)
		remote := NewMemoryStorage(0)
		dual := NewDualStorage(local, remote, true)

		payload := []byte(`{"catalog_version":1,"entries":[{"backup_id":"bkp-1"}]}`)
		if err := dual.PutOverwrite(ctx, remoteCatalogKey, payload, map[string]string{"v": "1"}); err != nil {
			t.Fatalf("PutOverwrite failed: %v", err)
		}

		lb, _, lErr := local.Get(ctx, remoteCatalogKey)
		rb, _, rErr := remote.Get(ctx, remoteCatalogKey)
		if lErr != nil || rErr != nil {
			t.Fatalf("reading local/remote failed: localErr=%v remoteErr=%v", lErr, rErr)
		}
		if string(lb) != string(payload) || string(rb) != string(payload) {
			t.Fatalf("manifest mismatch: local=%q remote=%q", string(lb), string(rb))
		}
	})

	t.Run("LocalFails_NeitherCopyChanges", func(t *testing.T) {
		local := NewMemoryStorage(0)
		remote := NewMemoryStorage(0)
		dual := NewDualStorage(local, remote, true)

		v1 := []byte(`{"v":1}`)
		if err := dual.PutOverwrite(ctx, remoteCatalogKey, v1, nil); err != nil {
			t.Fatalf("seed PutOverwrite failed: %v", err)
		}

		local.SetSimulatePermissionDenied(true)
		v2 := []byte(`{"v":2}`)
		if err := dual.PutOverwrite(ctx, remoteCatalogKey, v2, nil); !errors.Is(err, ErrStoragePermission) {
			t.Fatalf("expected ErrStoragePermission when local fails, got: %v", err)
		}
		local.SetSimulatePermissionDenied(false)

		lb, _, _ := local.Get(ctx, remoteCatalogKey)
		rb, _, _ := remote.Get(ctx, remoteCatalogKey)
		if string(lb) != string(v1) || string(rb) != string(v1) {
			t.Fatalf("expected neither copy to change on local failure, got local=%q remote=%q", string(lb), string(rb))
		}
	})

	t.Run("RemoteFailsRequired_LocalUpdated_RemotePreserved_RetryReconciles", func(t *testing.T) {
		local := NewMemoryStorage(0)
		remote := NewMemoryStorage(0)
		dual := NewDualStorage(local, remote, true)

		v1 := []byte(`{"v":1}`)
		if err := dual.PutOverwrite(ctx, remoteCatalogKey, v1, nil); err != nil {
			t.Fatalf("seed PutOverwrite failed: %v", err)
		}

		remote.SetSimulateOffline(true)
		v2 := []byte(`{"v":2}`)
		if err := dual.PutOverwrite(ctx, remoteCatalogKey, v2, nil); !errors.Is(err, ErrDestinationOffline) {
			t.Fatalf("expected ErrDestinationOffline in required mode, got: %v", err)
		}

		// Local has v2, remote still has v1
		lb, _, _ := local.Get(ctx, remoteCatalogKey)
		if string(lb) != string(v2) {
			t.Fatalf("expected local to have v2, got %q", string(lb))
		}
		remote.SetSimulateOffline(false)
		rb, _, _ := remote.Get(ctx, remoteCatalogKey)
		if string(rb) != string(v1) {
			t.Fatalf("expected remote to still have v1, got %q", string(rb))
		}

		// Retry reconciles both
		if err := dual.PutOverwrite(ctx, remoteCatalogKey, v2, nil); err != nil {
			t.Fatalf("retry PutOverwrite failed: %v", err)
		}
		rb2, _, _ := remote.Get(ctx, remoteCatalogKey)
		if string(rb2) != string(v2) {
			t.Fatalf("expected remote to reconcile to v2, got %q", string(rb2))
		}
	})

	t.Run("RemoteFailsOptional_LocalUpdated_RemotePreserved_RetryReconciles", func(t *testing.T) {
		local := NewMemoryStorage(0)
		remote := NewMemoryStorage(0)
		dual := NewDualStorage(local, remote, false)

		v1 := []byte(`{"v":1}`)
		if err := dual.PutOverwrite(ctx, remoteCatalogKey, v1, nil); err != nil {
			t.Fatalf("seed PutOverwrite failed: %v", err)
		}

		remote.SetSimulateOffline(true)
		v2 := []byte(`{"v":2}`)
		if err := dual.PutOverwrite(ctx, remoteCatalogKey, v2, nil); err != nil {
			t.Fatalf("expected nil error in optional mode when remote offline, got: %v", err)
		}
		remote.SetSimulateOffline(false)

		lb, _, _ := local.Get(ctx, remoteCatalogKey)
		rb, _, _ := remote.Get(ctx, remoteCatalogKey)
		if string(lb) != string(v2) || string(rb) != string(v1) {
			t.Fatalf("expected local=v2 and remote=v1, got local=%q remote=%q", string(lb), string(rb))
		}

		if err := dual.PutOverwrite(ctx, remoteCatalogKey, v2, nil); err != nil {
			t.Fatalf("retry PutOverwrite failed: %v", err)
		}
		rb2, _, _ := remote.Get(ctx, remoteCatalogKey)
		if string(rb2) != string(v2) {
			t.Fatalf("expected remote to reconcile to v2, got %q", string(rb2))
		}
	})

	t.Run("StaleLocalVsNewerRemote_RemoteAuthoritativeForRecovery", func(t *testing.T) {
		local := NewMemoryStorage(0)
		remote := NewMemoryStorage(0)
		dual := NewDualStorage(local, remote, true)

		// Local has stale v1, remote has newer v2 (e.g. written directly by S3Storage CAS)
		if err := local.PutOverwrite(ctx, remoteCatalogKey, []byte(`{"catalog_version":1,"entries":[{"backup_id":"bkp-1"}]}`), nil); err != nil {
			t.Fatal(err)
		}
		if err := remote.PutOverwrite(ctx, remoteCatalogKey, []byte(`{"catalog_version":1,"entries":[{"backup_id":"bkp-1"},{"backup_id":"bkp-2"}]}`), nil); err != nil {
			t.Fatal(err)
		}

		// Recovery/status paths read directly from remote StorageDestination, not DualStorage.Get
		catRemote, err := LoadRemoteCatalog(ctx, remote)
		if err != nil || len(catRemote.Entries) != 2 {
			t.Fatalf("expected remote catalog to have 2 entries, got %+v (err=%v)", catRemote, err)
		}
		// Note: DualStorage.Get reads local (stale v1), documenting why catalog/KMS always target S3Storage directly.
		catDualLocal, err := LoadRemoteCatalog(ctx, dual)
		if err != nil || len(catDualLocal.Entries) != 1 {
			t.Fatalf("expected DualStorage.Get to reflect local stale copy (1 entry), got %+v (err=%v)", catDualLocal, err)
		}
	})

	t.Run("FailClosed_UnsupportedLocalOrRemote", func(t *testing.T) {
		unsupported := &unsupportedStorageWrapper{inner: NewMemoryStorage(0)}
		valid := NewMemoryStorage(0)

		if err := NewDualStorage(unsupported, valid, true).PutOverwrite(ctx, remoteCatalogKey, []byte(`{}`), nil); !errors.Is(err, ErrStoragePermission) {
			t.Fatalf("expected ErrStoragePermission when local lacks MutableStorageDestination, got: %v", err)
		}
		if err := NewDualStorage(valid, unsupported, true).PutOverwrite(ctx, remoteCatalogKey, []byte(`{}`), nil); !errors.Is(err, ErrStoragePermission) {
			t.Fatalf("expected ErrStoragePermission when remote lacks MutableStorageDestination, got: %v", err)
		}
	})
}
