package main

import (
	"bytes"
	"context"
	"os"
	"testing"
)

func TestStorage_FilesystemIdempotencyAndConflict(t *testing.T) {
	ctx := context.Background()
	tempDir, err := os.MkdirTemp("", "byos_storage_test_*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	storage, err := NewFilesystemStorage(tempDir)
	if err != nil {
		t.Fatalf("failed to init filesystem storage: %v", err)
	}

	key := "wal/000000010000000000000001.enc"
	dataA := []byte("WAL_SEGMENT_CONTENTS_VERSION_A")
	dataB := []byte("WAL_SEGMENT_CONTENTS_VERSION_B_DIFFERENT")

	// 1. Initial write
	if err := storage.Put(ctx, key, dataA, nil); err != nil {
		t.Fatalf("initial Put failed: %v", err)
	}

	// 2. Idempotent re-write with identical content must succeed
	if err := storage.Put(ctx, key, dataA, nil); err != nil {
		t.Errorf("expected idempotent re-write to succeed, got error: %v", err)
	}

	// 3. Conflicting write with same key but different content must be rejected
	err = storage.Put(ctx, key, dataB, nil)
	if err == nil {
		t.Errorf("expected error on conflicting duplicate write, got nil")
	}

	// 4. Retrieve and verify content is still dataA
	retrieved, _, err := storage.Get(ctx, key)
	if err != nil {
		t.Fatalf("Get failed: %v", err)
	}
	if !bytes.Equal(retrieved, dataA) {
		t.Errorf("retrieved data was corrupted or overwritten")
	}

	// 5. Exists and List
	exists, err := storage.Exists(ctx, key)
	if err != nil || !exists {
		t.Errorf("expected key to exist, err: %v", err)
	}

	list, err := storage.List(ctx, "wal/")
	if err != nil || len(list) != 1 {
		t.Errorf("expected 1 listed object, got %d (err: %v)", len(list), err)
	}

	// 6. Delete
	if err := storage.Delete(ctx, key); err != nil {
		t.Errorf("Delete failed: %v", err)
	}
	exists, _ = storage.Exists(ctx, key)
	if exists {
		t.Errorf("key still exists after delete")
	}
}

func TestStorage_MemoryFaultInjection(t *testing.T) {
	ctx := context.Background()
	storage := NewMemoryStorage(1024) // 1KB capacity

	key := "test.bin"
	data := []byte("sample payload")

	// 1. Normal put and get
	if err := storage.Put(ctx, key, data, nil); err != nil {
		t.Fatalf("normal Put failed: %v", err)
	}
	got, _, err := storage.Get(ctx, key)
	if err != nil || !bytes.Equal(got, data) {
		t.Fatalf("Get failed or data mismatch")
	}

	// 2. Test destination offline
	storage.SetSimulateOffline(true)
	if err := storage.Put(ctx, "offline.bin", data, nil); err != ErrDestinationOffline {
		t.Errorf("expected ErrDestinationOffline, got %v", err)
	}
	if _, _, err := storage.Get(ctx, key); err != ErrDestinationOffline {
		t.Errorf("expected ErrDestinationOffline on Get, got %v", err)
	}
	storage.SetSimulateOffline(false)

	// 3. Test permission denied
	storage.SetSimulatePermissionDenied(true)
	if err := storage.Put(ctx, "perm.bin", data, nil); err != ErrStoragePermission {
		t.Errorf("expected ErrStoragePermission, got %v", err)
	}
	storage.SetSimulatePermissionDenied(false)

	// 4. Test disk/quota full
	oversized := make([]byte, 2048)
	if err := storage.Put(ctx, "large.bin", oversized, nil); err != ErrDiskFull {
		t.Errorf("expected ErrDiskFull, got %v", err)
	}
}
