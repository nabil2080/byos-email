package main

import (
	"context"
	"fmt"
	"os"
)

// DualStorage replicates every write to both a local StorageDestination and a remote StorageDestination.
// When remoteRequired is true, remote failures return an error so PostgreSQL retains .ready WALs and retries.
// When remoteRequired is false, local archival succeeds independently and remote failures are logged as non-fatal lag.
type DualStorage struct {
	local          StorageDestination
	remote         StorageDestination
	remoteRequired bool
}

func NewDualStorage(local StorageDestination, remote StorageDestination, remoteRequired bool) *DualStorage {
	return &DualStorage{
		local:          local,
		remote:         remote,
		remoteRequired: remoteRequired,
	}
}

func (d *DualStorage) Name() string {
	mode := "optional"
	if d.remoteRequired {
		mode = "required"
	}
	return fmt.Sprintf("dual(%s -> %s, mode=%s)", d.local.Name(), d.remote.Name(), mode)
}

func (d *DualStorage) Put(ctx context.Context, key string, data []byte, metadata map[string]string) error {
	payloadToUpload := data

	localExists, err := d.local.Exists(ctx, key)
	if err != nil {
		return fmt.Errorf("checking local archive (%s): %w", key, err)
	}
	if localExists {
		// Preserve already-encrypted local object and replicate its exact ciphertext bytes on retry
		// (AES-256-GCM uses a random nonce per encryption, so re-encrypting plaintext produces different bytes).
		existingData, _, getErr := d.local.Get(ctx, key)
		if getErr != nil {
			return fmt.Errorf("reading existing local archive (%s): %w", key, getErr)
		}
		payloadToUpload = existingData
	} else {
		// Always persist to local encrypted archive first.
		if err := d.local.Put(ctx, key, data, metadata); err != nil {
			return fmt.Errorf("local archive write failed (%s): %w", key, err)
		}
	}

	if err := d.remote.Put(ctx, key, payloadToUpload, metadata); err != nil {
		if d.remoteRequired {
			return fmt.Errorf("remote-required replication failed (%s): %w", key, err)
		}
		fmt.Fprintf(os.Stderr, "WARNING: optional remote replication failed for %s (local archive preserved): %v\n", key, err)
	}
	return nil
}

// PutOverwrite forwards mutable manifest replacement to both local and remote destinations.
// Local is written first; if remote fails in remoteRequired mode, an error is returned so
// the caller can retry without deleting either copy. Fails closed if either destination
// does not implement MutableStorageDestination.
func (d *DualStorage) PutOverwrite(ctx context.Context, key string, data []byte, metadata map[string]string) error {
	localMut, ok := d.local.(MutableStorageDestination)
	if !ok {
		return fmt.Errorf("%w: local destination %q does not implement MutableStorageDestination", ErrStoragePermission, d.local.Name())
	}
	remoteMut, ok := d.remote.(MutableStorageDestination)
	if !ok {
		return fmt.Errorf("%w: remote destination %q does not implement MutableStorageDestination", ErrStoragePermission, d.remote.Name())
	}

	if err := localMut.PutOverwrite(ctx, key, data, metadata); err != nil {
		return fmt.Errorf("local manifest overwrite failed (%s): %w", key, err)
	}
	if err := remoteMut.PutOverwrite(ctx, key, data, metadata); err != nil {
		if d.remoteRequired {
			return fmt.Errorf("remote-required manifest overwrite failed (%s): %w", key, err)
		}
		fmt.Fprintf(os.Stderr, "WARNING: optional remote manifest overwrite failed for %s (local manifest updated): %v\n", key, err)
	}
	return nil
}

func (d *DualStorage) Get(ctx context.Context, key string) ([]byte, map[string]string, error) {
	return d.local.Get(ctx, key)
}

func (d *DualStorage) Delete(ctx context.Context, key string) error {
	return d.local.Delete(ctx, key)
}

func (d *DualStorage) Exists(ctx context.Context, key string) (bool, error) {
	localOk, err := d.local.Exists(ctx, key)
	if err != nil || !localOk {
		return false, err
	}
	if !d.remoteRequired {
		return true, nil
	}
	return d.remote.Exists(ctx, key)
}

func (d *DualStorage) List(ctx context.Context, prefix string) ([]ObjectInfo, error) {
	return d.local.List(ctx, prefix)
}

func (d *DualStorage) GetInfo(ctx context.Context, key string) (ObjectInfo, error) {
	return d.local.GetInfo(ctx, key)
}
