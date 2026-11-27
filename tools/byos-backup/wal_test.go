package main

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"
)

func TestWAL_ArchiveAndRestoreRoundtrip(t *testing.T) {
	ctx := context.Background()
	tempDir, err := os.MkdirTemp("", "byos_wal_test_*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	storageDir := filepath.Join(tempDir, "archive")
	storage, err := NewFilesystemStorage(storageDir)
	if err != nil {
		t.Fatalf("failed to init storage: %v", err)
	}

	keyHex, _ := GenerateRandomKeyHex()
	kms, _ := NewEnvKeyProvider(keyHex, "v1")
	kv, _ := kms.GetActiveKey(ctx)

	// Create a dummy 16MB WAL segment
	walName := "000000010000000000000001"
	walPath := filepath.Join(tempDir, walName)
	walData := bytes.Repeat([]byte("TEST_POSTGRESQL_WAL_PAYLOAD_16MB_DATA_BLOCK!"), 1000)
	if err := os.WriteFile(walPath, walData, 0640); err != nil {
		t.Fatalf("failed to write dummy WAL file: %v", err)
	}

	// 1. Archive WAL segment
	meta, err := ArchiveWALSegment(ctx, storage, walPath, walName, kv.Key, "v1")
	if err != nil {
		t.Fatalf("ArchiveWALSegment failed: %v", err)
	}
	if meta.WALName != walName {
		t.Errorf("expected WALName %s, got %s", walName, meta.WALName)
	}
	if meta.TimelineID != 1 {
		t.Errorf("expected TimelineID 1, got %d", meta.TimelineID)
	}

	// 2. Idempotent re-archive of identical WAL must succeed
	meta2, err := ArchiveWALSegment(ctx, storage, walPath, walName, kv.Key, "v1")
	if err != nil {
		t.Errorf("expected idempotent re-archive to succeed, got %v", err)
	}
	if meta2.PlaintextSHA256 != meta.PlaintextSHA256 {
		t.Errorf("mismatched plaintext sha256 on idempotent re-archive")
	}

	// 3. Conflicting re-archive with same filename but different content must fail
	conflictingPath := filepath.Join(tempDir, "conflicting")
	if err := os.WriteFile(conflictingPath, []byte("TOTALLY_DIFFERENT_CORRUPTED_WAL"), 0640); err != nil {
		t.Fatalf("failed to write conflicting file: %v", err)
	}
	_, err = ArchiveWALSegment(ctx, storage, conflictingPath, walName, kv.Key, "v1")
	if err == nil {
		t.Errorf("expected error on conflicting WAL re-archive, got nil")
	}

	// 4. Restore WAL segment to target path
	restoredPath := filepath.Join(tempDir, "restored_wal")
	if err := RestoreWALSegment(ctx, storage, walName, restoredPath, kms); err != nil {
		t.Fatalf("RestoreWALSegment failed: %v", err)
	}

	restoredData, err := os.ReadFile(restoredPath)
	if err != nil {
		t.Fatalf("failed to read restored WAL: %v", err)
	}
	if !bytes.Equal(restoredData, walData) {
		t.Errorf("restored WAL content does not match original!")
	}

	// 5. Restore missing WAL returns ErrWALNotFound
	err = RestoreWALSegment(ctx, storage, "000000010000000000000099", filepath.Join(tempDir, "missing"), kms)
	if err == nil {
		t.Errorf("expected error restoring non-existent WAL segment, got nil")
	}
}

func TestWAL_TamperAndWrongKeyDetection(t *testing.T) {
	ctx := context.Background()
	tempDir, err := os.MkdirTemp("", "byos_wal_tamper_*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	storage, _ := NewFilesystemStorage(filepath.Join(tempDir, "archive"))
	keyHex1, _ := GenerateRandomKeyHex()
	keyHex2, _ := GenerateRandomKeyHex()
	kms1, _ := NewEnvKeyProvider(keyHex1, "v1")
	kms2, _ := NewEnvKeyProvider(keyHex2, "v1") // Different key

	walName := "000000010000000000000002"
	walPath := filepath.Join(tempDir, walName)
	_ = os.WriteFile(walPath, []byte("CRITICAL_DATABASE_TRANSACTION_WAL_SEGMENT"), 0640)

	kv1, _ := kms1.GetActiveKey(ctx)
	_, err = ArchiveWALSegment(ctx, storage, walPath, walName, kv1.Key, "v1")
	if err != nil {
		t.Fatalf("archive failed: %v", err)
	}

	// Attempt restore with wrong key provider must fail
	err = RestoreWALSegment(ctx, storage, walName, filepath.Join(tempDir, "target"), kms2)
	if err == nil {
		t.Errorf("expected decryption failure with wrong key, got nil")
	}

	// Tamper with encrypted ciphertext in storage
	encPath := filepath.Join(tempDir, "archive", "wal", walName+".enc")
	encData, _ := os.ReadFile(encPath)
	encData[len(encData)-5] ^= 0xFF // Flip bits in ciphertext
	_ = os.WriteFile(encPath, encData, 0640)

	err = RestoreWALSegment(ctx, storage, walName, filepath.Join(tempDir, "target"), kms1)
	if err == nil {
		t.Errorf("expected integrity authentication failure on tampered WAL, got nil")
	}
}

func TestWAL_HistoryFileAndGapDetection(t *testing.T) {
	ctx := context.Background()
	tempDir, err := os.MkdirTemp("", "byos_wal_gap_*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	storage, _ := NewFilesystemStorage(filepath.Join(tempDir, "archive"))
	keyHex, _ := GenerateRandomKeyHex()
	kms, _ := NewEnvKeyProvider(keyHex, "v1")
	kv, _ := kms.GetActiveKey(ctx)

	// Archive timeline history file 00000002.history
	histName := "00000002.history"
	histPath := filepath.Join(tempDir, histName)
	_ = os.WriteFile(histPath, []byte("1\t0/01000000\tbefore promote\n"), 0640)
	metaHist, err := ArchiveWALSegment(ctx, storage, histPath, histName, kv.Key, "v1")
	if err != nil {
		t.Fatalf("failed to archive history file: %v", err)
	}
	if !metaHist.IsHistoryFile {
		t.Errorf("expected is_history_file to be true")
	}

	// Archive segment 1 and segment 3 (skipping segment 2 to create a gap)
	seg1 := "000000010000000000000001"
	seg3 := "000000010000000000000003"
	p1 := filepath.Join(tempDir, seg1)
	p3 := filepath.Join(tempDir, seg3)
	_ = os.WriteFile(p1, []byte("seg1"), 0640)
	_ = os.WriteFile(p3, []byte("seg3"), 0640)

	_, _ = ArchiveWALSegment(ctx, storage, p1, seg1, kv.Key, "v1")
	_, _ = ArchiveWALSegment(ctx, storage, p3, seg3, kv.Key, "v1")

	// Get status and verify gap was detected
	status, err := GetWALArchiveStatus(ctx, storage)
	if err != nil {
		t.Fatalf("GetWALArchiveStatus failed: %v", err)
	}

	if status.TotalSegments != 2 {
		t.Errorf("expected 2 segments, got %d", status.TotalSegments)
	}
	if status.TotalHistory != 1 {
		t.Errorf("expected 1 history file, got %d", status.TotalHistory)
	}
	if len(status.SequenceGaps) != 1 {
		t.Errorf("expected 1 detected sequence gap, got %d (%v)", len(status.SequenceGaps), status.SequenceGaps)
	}
}
