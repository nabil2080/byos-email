package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/minio/minio-go/v7"
)

func TestDualStorage_RequiredVsOptionalSemantics(t *testing.T) {
	ctx := context.Background()
	local := NewMemoryStorage(0)
	remote := NewMemoryStorage(0)
	key := make([]byte, 32)
	for i := range key {
		key[i] = byte(i + 1)
	}

	// 1. Remote-required mode must fail when remote is offline, while preserving local encrypted WAL.
	remote.SetSimulateOffline(true)
	dualReq := NewDualStorage(local, remote, true)
	walName := "000000010000000000000001"
	tmpDir := t.TempDir()
	srcPath := filepath.Join(tmpDir, walName)
	if err := os.WriteFile(srcPath, []byte("wal-segment-payload-001"), 0600); err != nil {
		t.Fatal(err)
	}

	if _, err := ArchiveWALSegment(ctx, dualReq, srcPath, walName, key, "v1"); err == nil {
		t.Fatalf("expected error in remote-required mode when remote is offline")
	}
	if ok, _ := local.Exists(ctx, "wal/"+walName+".enc"); !ok {
		t.Fatalf("expected local encrypted WAL to be preserved on remote failure")
	}

	// 2. When remote recovers, retry succeeds idempotently.
	remote.SetSimulateOffline(false)
	if _, err := ArchiveWALSegment(ctx, dualReq, srcPath, walName, key, "v1"); err != nil {
		t.Fatalf("retry after remote recovery failed: %v", err)
	}
	if ok, _ := remote.Exists(ctx, "wal/"+walName+".enc"); !ok {
		t.Fatalf("expected remote encrypted WAL after retry")
	}

	// 3. Optional mode succeeds locally when remote is offline, and GetRemoteStatus flags pending object.
	remote.SetSimulateOffline(true)
	dualOpt := NewDualStorage(local, remote, false)
	walName2 := "000000010000000000000002"
	srcPath2 := filepath.Join(tmpDir, walName2)
	if err := os.WriteFile(srcPath2, []byte("wal-segment-payload-002"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := ArchiveWALSegment(ctx, dualOpt, srcPath2, walName2, key, "v1"); err != nil {
		t.Fatalf("optional remote mode should not fail local archival: %v", err)
	}
	remote.SetSimulateOffline(false)
	rep := GetRemoteStatus(ctx, local, remote, nil, RemoteStorageConfig{Endpoint: "mem", Bucket: "b"}, 15*time.Minute)
	if rep.PendingLocalObjects == 0 {
		t.Fatalf("expected pending local objects > 0 before sync")
	}
	sum, err := SyncLocalToRemote(ctx, local, remote)
	if err != nil {
		t.Fatalf("SyncLocalToRemote failed: %v", err)
	}
	if sum.UploadedObjects == 0 || sum.FailedObjects != 0 {
		t.Fatalf("unexpected sync summary: %+v", sum)
	}
}

func TestRemoteCatalog_PublishVerifyAndMissingDependencyCritical(t *testing.T) {
	ctx := context.Background()
	local := NewMemoryStorage(0)
	remote := NewMemoryStorage(0)

	kHex, err := GenerateRandomKeyHex()
	if err != nil {
		t.Fatal(err)
	}
	kms, err := NewEnvKeyProvider(kHex, "v1")
	if err != nil {
		t.Fatal(err)
	}
	kv, err := kms.GetActiveKey(ctx)
	if err != nil {
		t.Fatal(err)
	}

	tmpDir := t.TempDir()
	wal1 := "000000010000000000000010"
	walPath := filepath.Join(tmpDir, wal1)
	if err := os.WriteFile(walPath, []byte("wal-10-content"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := ArchiveWALSegment(ctx, local, walPath, wal1, kv.Key, "v1"); err != nil {
		t.Fatal(err)
	}

	baseFile := filepath.Join(tmpDir, "base.tar.enc")
	if err := os.WriteFile(baseFile, []byte("BYOSENC1-encrypted-base"), 0600); err != nil {
		t.Fatal(err)
	}
	manifestFile := filepath.Join(tmpDir, "backup_manifest")
	if err := os.WriteFile(manifestFile, []byte(`{"PostgreSQL-Backup-Manifest-Version":1}`), 0600); err != nil {
		t.Fatal(err)
	}

	entry := RecoveryCatalogEntry{
		BackupID:            "bkp-001",
		DatabaseSystemID:    "7691245582692712482",
		ServerVersion:       "16.15",
		StartLSN:            "0/10000028",
		StopLSN:             "0/10000100",
		TimelineID:          1,
		RequiredWALs:        []string{wal1},
		EncryptionAlgorithm: "AES-256-GCM",
		KeyVersionID:        "v1",
	}
	pub, err := PublishBackupToRemote(ctx, local, remote, kms, entry, baseFile, manifestFile)
	if err != nil {
		t.Fatalf("PublishBackupToRemote failed: %v", err)
	}
	if pub.Status != "completed" {
		t.Fatalf("expected completed status, got %s", pub.Status)
	}

	rep := GetRemoteStatus(ctx, local, remote, kms, RemoteStorageConfig{Endpoint: "mem", Bucket: "b"}, 15*time.Minute)
	if rep.Status != "HEALTHY" || rep.CompleteRemoteBackups != 1 {
		t.Fatalf("expected HEALTHY remote status with 1 complete backup, got %s (%v)", rep.Status, rep.Alerts)
	}

	// Delete required WAL on remote and verify status turns CRITICAL.
	_ = remote.Delete(ctx, "wal/"+wal1+".enc")
	repMissing := GetRemoteStatus(ctx, local, remote, kms, RemoteStorageConfig{Endpoint: "mem", Bucket: "b"}, 15*time.Minute)
	if repMissing.Status != "CRITICAL" {
		t.Fatalf("expected CRITICAL status when required WAL is missing, got %s", repMissing.Status)
	}
}

func TestKeyRecoveryDrill_MultiEpochV1AndV2AndRevocation(t *testing.T) {
	ctx := context.Background()
	remote := NewMemoryStorage(0)

	k1Hex, _ := GenerateRandomKeyHex()
	kms, err := NewEnvKeyProvider(k1Hex, "v1")
	if err != nil {
		t.Fatal(err)
	}
	kv1, _ := kms.GetActiveKey(ctx)

	tmpDir := t.TempDir()
	wal1 := "000000010000000000000020"
	p1 := filepath.Join(tmpDir, wal1)
	_ = os.WriteFile(p1, []byte("wal-v1-epoch"), 0600)
	if _, err := ArchiveWALSegment(ctx, remote, p1, wal1, kv1.Key, "v1"); err != nil {
		t.Fatal(err)
	}

	// Rotate to v2
	kv2, err := kms.RotateKey(ctx)
	if err != nil {
		t.Fatal(err)
	}
	wal2 := "000000010000000000000021"
	p2 := filepath.Join(tmpDir, wal2)
	_ = os.WriteFile(p2, []byte("wal-v2-epoch"), 0600)
	if _, err := ArchiveWALSegment(ctx, remote, p2, wal2, kv2.Key, "v2"); err != nil {
		t.Fatal(err)
	}

	// Simulate fresh recovery host retrieving historical keys independently
	out1 := filepath.Join(tmpDir, "restored1")
	out2 := filepath.Join(tmpDir, "restored2")
	if err := RestoreWALSegment(ctx, remote, wal1, out1, kms); err != nil {
		t.Fatalf("restoring v1 WAL after rotation failed: %v", err)
	}
	if err := RestoreWALSegment(ctx, remote, wal2, out2, kms); err != nil {
		t.Fatalf("restoring v2 WAL failed: %v", err)
	}

	// Revoke v1 and confirm fail-closed rejection
	if err := kms.RevokeKey(ctx, "v1"); err != nil {
		t.Fatal(err)
	}
	if err := RestoreWALSegment(ctx, remote, wal1, filepath.Join(tmpDir, "revoked_out"), kms); !errors.Is(err, ErrKeyRevoked) {
		t.Fatalf("expected ErrKeyRevoked for revoked key v1, got: %v", err)
	}
}

func TestRemotePrune_DependencyAwareDryRunAndAudit(t *testing.T) {
	ctx := context.Background()
	local := NewMemoryStorage(0)
	remote := NewMemoryStorage(0)
	kHex, _ := GenerateRandomKeyHex()
	kms, _ := NewEnvKeyProvider(kHex, "v1")
	kv, _ := kms.GetActiveKey(ctx)

	tmpDir := t.TempDir()
	walOld := "000000010000000000000001"
	walNew := "000000010000000000000002"
	for _, w := range []string{walOld, walNew} {
		p := filepath.Join(tmpDir, w)
		_ = os.WriteFile(p, []byte("wal-"+w), 0600)
		_, _ = ArchiveWALSegment(ctx, local, p, w, kv.Key, "v1")
	}

	base1 := filepath.Join(tmpDir, "b1.tar.enc")
	base2 := filepath.Join(tmpDir, "b2.tar.enc")
	_ = os.WriteFile(base1, []byte("b1"), 0600)
	_ = os.WriteFile(base2, []byte("b2"), 0600)

	now := time.Now().UTC()
	eOld := RecoveryCatalogEntry{
		BackupID: "bkp-old", StartTime: now.Add(-400 * 24 * time.Hour), StopTime: now.Add(-400 * 24 * time.Hour),
		RequiredWALs: []string{walOld}, EncryptionAlgorithm: "AES-256-GCM", KeyVersionID: "v1",
	}
	eNew := RecoveryCatalogEntry{
		BackupID: "bkp-new", StartTime: now.Add(-1 * time.Hour), StopTime: now.Add(-1 * time.Hour),
		RequiredWALs: []string{walNew}, EncryptionAlgorithm: "AES-256-GCM", KeyVersionID: "v1",
	}
	if _, err := PublishBackupToRemote(ctx, local, remote, kms, eOld, base1, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := PublishBackupToRemote(ctx, local, remote, kms, eNew, base2, ""); err != nil {
		t.Fatal(err)
	}

	policy := RetentionPolicy{DailyDays: 7, WeeklyWeeks: 4, MonthlyMonths: 12}
	// Dry run must not delete anything
	candidates, err := PruneRemoteBackups(ctx, remote, kms, policy, true, "")
	if err != nil {
		t.Fatalf("dry-run prune failed: %v", err)
	}
	if len(candidates) == 0 {
		t.Fatalf("expected expired backup candidates in dry-run")
	}
	if ok, _ := remote.Exists(ctx, "backups/bkp-old/base.tar.enc"); !ok {
		t.Fatalf("dry-run must not delete remote objects")
	}

	// Execute prune with audit log; retained backup & its required WAL must survive
	auditPath := filepath.Join(tmpDir, "prune_audit.log")
	if _, err := PruneRemoteBackups(ctx, remote, kms, policy, false, auditPath); err != nil {
		t.Fatalf("prune execution failed: %v", err)
	}
	if ok, _ := remote.Exists(ctx, "backups/bkp-new/base.tar.enc"); !ok {
		t.Fatalf("retained backup deleted unexpectedly")
	}
	if ok, _ := remote.Exists(ctx, "wal/"+walNew+".enc"); !ok {
		t.Fatalf("required WAL for retained backup deleted unexpectedly")
	}
	auditData, err := os.ReadFile(auditPath)
	if err != nil || !strings.Contains(string(auditData), "DELETE backup=bkp-old") {
		t.Fatalf("expected audit log entry for bkp-old deletion, got: %q (err=%v)", string(auditData), err)
	}
}

func TestS3ErrorMappingAndPermanentClassification(t *testing.T) {
	permErr := mapS3Error(minio.ErrorResponse{StatusCode: http.StatusForbidden, Code: "AccessDenied"}, "wal/x.enc")
	if !errors.Is(permErr, ErrStoragePermission) || !isPermanentS3Error(permErr) {
		t.Fatalf("expected permanent ErrStoragePermission for 403, got: %v", permErr)
	}
	notFoundErr := mapS3Error(minio.ErrorResponse{StatusCode: http.StatusNotFound, Code: "NoSuchKey"}, "wal/missing.enc")
	if !errors.Is(notFoundErr, ErrObjectNotFound) || !isPermanentS3Error(notFoundErr) {
		t.Fatalf("expected permanent ErrObjectNotFound for 404, got: %v", notFoundErr)
	}
}

func TestS3Security_RejectsInsecureNonLocalHTTPAndPartialCreds(t *testing.T) {
	_, err := NewS3Storage(RemoteStorageConfig{
		Endpoint: "s3.remote-provider.example.com:9000",
		Bucket:   "b",
		UseSSL:   false,
	})
	if !errors.Is(err, ErrStoragePermission) {
		t.Fatalf("expected ErrStoragePermission for non-local HTTP endpoint, got: %v", err)
	}

	_, err = NewS3Storage(RemoteStorageConfig{
		Endpoint:  "s3.remote-provider.example.com:443",
		Bucket:    "b",
		UseSSL:    true,
		AccessKey: "only-ak",
	})
	if !errors.Is(err, ErrStoragePermission) {
		t.Fatalf("expected ErrStoragePermission for partial credentials, got: %v", err)
	}
}

func TestDualStorage_ConcurrentUploadIdempotency(t *testing.T) {
	ctx := context.Background()
	local := NewMemoryStorage(0)
	remote := NewMemoryStorage(0)
	dual := NewDualStorage(local, remote, true)

	key := make([]byte, 32)
	walName := "000000010000000000000030"
	tmpDir := t.TempDir()
	srcPath := filepath.Join(tmpDir, walName)
	_ = os.WriteFile(srcPath, []byte("concurrent-wal-payload"), 0600)

	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			_, errs[idx] = ArchiveWALSegment(ctx, dual, srcPath, walName, key, "v1")
		}(i)
	}
	wg.Wait()

	// At least one must succeed cleanly; if both ran concurrently, idempotency or local preservation must hold
	if errs[0] != nil && errs[1] != nil {
		t.Fatalf("both concurrent workers failed: %v | %v", errs[0], errs[1])
	}
	if ok, _ := remote.Exists(ctx, "wal/"+walName+".enc"); !ok {
		t.Fatalf("expected remote WAL object after concurrent upload")
	}
}

func TestCatalog_RejectsIncompleteStatusAndMissingManifest(t *testing.T) {
	ctx := context.Background()
	remote := NewMemoryStorage(0)
	_ = remote.Put(ctx, "backups/bkp-inc/base.tar.enc", []byte("data"), nil)

	err := VerifyRemoteRecoveryPoint(ctx, remote, nil, RecoveryCatalogEntry{
		BackupID:            "bkp-inc",
		Status:              "uploading",
		BaseBackupObjectKey: "backups/bkp-inc/base.tar.enc",
	})
	if err == nil || !strings.Contains(err.Error(), "incomplete") {
		t.Fatalf("expected incomplete status error, got: %v", err)
	}

	err = VerifyRemoteRecoveryPoint(ctx, remote, nil, RecoveryCatalogEntry{
		BackupID:            "bkp-nomani",
		Status:              "completed",
		BaseBackupObjectKey: "backups/bkp-inc/base.tar.enc",
		ManifestObjectKey:   "backups/bkp-inc/missing_manifest",
	})
	if err == nil || !strings.Contains(err.Error(), "manifest") {
		t.Fatalf("expected missing manifest error, got: %v", err)
	}
}
