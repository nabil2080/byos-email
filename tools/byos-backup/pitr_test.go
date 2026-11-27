package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestPITR_GenerateRecoveryConf(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "byos_pitr_conf_*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	restoreCmd := "byos-backup restore-wal --wal-name %f --target %p --archive-dir /backups/wal --key-file /etc/byos/backup.key"
	targetTime := time.Date(2026, 11, 24, 14, 30, 0, 0, time.UTC)

	target := PITRTarget{
		TargetTime:   targetTime,
		TargetAction: "promote",
		Inclusive:    true,
	}

	if err := GeneratePostgresRecoveryConf(tempDir, restoreCmd, target); err != nil {
		t.Fatalf("GeneratePostgresRecoveryConf failed: %v", err)
	}

	// 1. Verify recovery.signal exists
	signalPath := filepath.Join(tempDir, "recovery.signal")
	if _, err := os.Stat(signalPath); err != nil {
		t.Errorf("recovery.signal file was not created: %v", err)
	}

	// 2. Verify postgresql.auto.conf contents
	autoConfPath := filepath.Join(tempDir, "postgresql.auto.conf")
	content, err := os.ReadFile(autoConfPath)
	if err != nil {
		t.Fatalf("failed to read postgresql.auto.conf: %v", err)
	}

	contentStr := string(content)
	if !strings.Contains(contentStr, "restore_command = 'byos-backup restore-wal") {
		t.Errorf("missing restore_command in postgresql.auto.conf")
	}
	if !strings.Contains(contentStr, "recovery_target_time = '2026-11-24 14:30:00 UTC'") {
		t.Errorf("missing recovery_target_time in postgresql.auto.conf: %s", contentStr)
	}
	if !strings.Contains(contentStr, "recovery_target_action = 'promote'") {
		t.Errorf("missing recovery_target_action in postgresql.auto.conf")
	}
	if !strings.Contains(contentStr, "recovery_target_inclusive = 'true'") {
		t.Errorf("missing recovery_target_inclusive in postgresql.auto.conf")
	}
}

func TestPITR_SelectBaseBackupForTarget(t *testing.T) {
	ctx := context.Background()
	keyHex, _ := GenerateRandomKeyHex()
	kms, _ := NewEnvKeyProvider(keyHex, "v1")
	kv, _ := kms.GetActiveKey(ctx)

	storage := NewMemoryStorage(10 * 1024 * 1024)

	baseTime := time.Date(2026, 11, 24, 12, 0, 0, 0, time.UTC)

	// Create Backup 1 (at 12:00)
	manifest1 := &PhysicalBackupManifest{
		ManifestVersion:     2,
		BackupID:            "backup_1200",
		StartTime:           baseTime,
		StopTime:            baseTime.Add(2 * time.Minute),
		StartWAL:            "000000010000000000000001",
		StopWAL:             "000000010000000000000001",
		RequiredWALs:        []string{"000000010000000000000001"},
		KeyVersionID:        "v1",
		EncryptionAlgorithm: "AES-256-GCM",
	}
	pkg1, _ := CreateBaseBackupPackage([]byte("data1"), nil, manifest1, kv.Key)
	_ = storage.Put(ctx, "backups/backup_1200.enc", pkg1, nil)
	_ = storage.Put(ctx, "wal/000000010000000000000001.enc", []byte("w1"), nil)

	// Create Backup 2 (at 13:00)
	manifest2 := &PhysicalBackupManifest{
		ManifestVersion:     2,
		BackupID:            "backup_1300",
		StartTime:           baseTime.Add(1 * time.Hour),
		StopTime:            baseTime.Add(1*time.Hour + 2*time.Minute),
		StartWAL:            "000000010000000000000005",
		StopWAL:             "000000010000000000000005",
		RequiredWALs:        []string{"000000010000000000000005"},
		KeyVersionID:        "v1",
		EncryptionAlgorithm: "AES-256-GCM",
	}
	pkg2, _ := CreateBaseBackupPackage([]byte("data2"), nil, manifest2, kv.Key)
	_ = storage.Put(ctx, "backups/backup_1300.enc", pkg2, nil)
	_ = storage.Put(ctx, "wal/000000010000000000000005.enc", []byte("w5"), nil)

	// 1. Target time 12:30 -> Should select Backup 1 (12:00)
	chosenKey, chosenManifest, err := SelectBaseBackupForPITR(ctx, storage, kms, baseTime.Add(30*time.Minute))
	if err != nil {
		t.Fatalf("SelectBaseBackupForPITR failed for 12:30: %v", err)
	}
	if chosenManifest.BackupID != "backup_1200" {
		t.Errorf("expected backup_1200, got %s", chosenManifest.BackupID)
	}
	if chosenKey != "backups/backup_1200.enc" {
		t.Errorf("expected backups/backup_1200.enc, got %s", chosenKey)
	}

	// 2. Target time 13:30 -> Should select Backup 2 (13:00)
	_, chosenManifest2, err := SelectBaseBackupForPITR(ctx, storage, kms, baseTime.Add(90*time.Minute))
	if err != nil {
		t.Fatalf("SelectBaseBackupForPITR failed for 13:30: %v", err)
	}
	if chosenManifest2.BackupID != "backup_1300" {
		t.Errorf("expected backup_1300, got %s", chosenManifest2.BackupID)
	}

	// 3. Target time 11:30 (before any backup) -> Should fail with ErrNoSuitableBaseBackup
	_, _, err = SelectBaseBackupForPITR(ctx, storage, kms, baseTime.Add(-30*time.Minute))
	if err == nil {
		t.Errorf("expected error for target time before all backups, got nil")
	}
}
