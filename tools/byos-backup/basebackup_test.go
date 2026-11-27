package main

import (
	"bytes"
	"context"
	"testing"
	"time"
)

func TestBaseBackup_PackagingAndManifestRoundtrip(t *testing.T) {
	ctx := context.Background()
	keyHex, _ := GenerateRandomKeyHex()
	kms, _ := NewEnvKeyProvider(keyHex, "v1")
	kv, _ := kms.GetActiveKey(ctx)

	manifest := &PhysicalBackupManifest{
		ManifestVersion:     2,
		BackupID:            "byos_test_base_001",
		DatabaseSystemID:    "7431289410984124",
		ServerVersion:       "16.15",
		BackupMethod:        "pg_backup_api",
		BackupFormat:        "tar",
		StartTime:           time.Now().UTC().Add(-10 * time.Minute),
		StopTime:            time.Now().UTC(),
		StartLSN:            "0/01000060",
		StopLSN:             "0/01000120",
		StartWAL:            "000000010000000000000001",
		StopWAL:             "000000010000000000000002",
		TimelineID:          1,
		EncryptionAlgorithm: "AES-256-GCM",
		KeyVersionID:        "v1",
		RequiredWALs:        []string{"000000010000000000000001", "000000010000000000000002"},
	}

	dummyData := []byte("PHYSICAL_BASE_BACKUP_TAR_PAYLOAD_CLUSTER_DATA")
	dummyGlobals := []byte("CREATE ROLE byos; ALTER ROLE byos SUPERUSER;")

	// 1. Create encrypted base backup package
	encPackage, err := CreateBaseBackupPackage(dummyData, dummyGlobals, manifest, kv.Key)
	if err != nil {
		t.Fatalf("CreateBaseBackupPackage failed: %v", err)
	}

	if manifest.PlaintextSHA256 == "" || manifest.CiphertextSHA256 == "" {
		t.Errorf("manifest checksums were not calculated")
	}

	// 2. Extract and verify roundtrip
	extractedManifest, extractedData, extractedGlobals, err := ExtractBaseBackupPackage(encPackage, kv.Key)
	if err != nil {
		t.Fatalf("ExtractBaseBackupPackage failed: %v", err)
	}

	if extractedManifest.BackupID != manifest.BackupID {
		t.Errorf("expected backup ID %s, got %s", manifest.BackupID, extractedManifest.BackupID)
	}
	if !bytes.Equal(extractedData, dummyData) {
		t.Errorf("extracted data does not match original dummy data")
	}
	if !bytes.Equal(extractedGlobals, dummyGlobals) {
		t.Errorf("extracted globals do not match original")
	}

	// 3. Completeness check with MemoryStorage
	storage := NewMemoryStorage(10 * 1024 * 1024)
	backupKey := "backups/base_001.enc"
	_ = storage.Put(ctx, backupKey, encPackage, nil)

	// Missing required WALs in storage must trigger ErrIncompleteWALRange
	_, err = VerifyBaseBackupCompleteness(ctx, storage, backupKey, kms)
	if err == nil {
		t.Errorf("expected error when required WAL segments are missing, got nil")
	}

	// Archive the required WAL segments in storage
	_ = storage.Put(ctx, "wal/000000010000000000000001.enc", []byte("wal1"), nil)
	_ = storage.Put(ctx, "wal/000000010000000000000002.enc", []byte("wal2"), nil)

	// Now verification must succeed
	verifiedManifest, err := VerifyBaseBackupCompleteness(ctx, storage, backupKey, kms)
	if err != nil {
		t.Fatalf("VerifyBaseBackupCompleteness failed after archiving WALs: %v", err)
	}
	if len(verifiedManifest.RequiredWALs) != 2 {
		t.Errorf("expected 2 required WALs, got %d", len(verifiedManifest.RequiredWALs))
	}
}

func TestBaseBackup_ComputeWALListForRange(t *testing.T) {
	startWAL := "00000001000000000000000A"
	stopWAL := "00000001000000000000000E"

	list, err := ComputeWALListForRange(startWAL, stopWAL)
	if err != nil {
		t.Fatalf("ComputeWALListForRange failed: %v", err)
	}

	expectedCount := 5 // A, B, C, D, E
	if len(list) != expectedCount {
		t.Errorf("expected %d WALs in range, got %d (%v)", expectedCount, len(list), list)
	}
	if list[0] != startWAL || list[len(list)-1] != stopWAL {
		t.Errorf("start or stop WAL does not match bounds: %v", list)
	}
}
