package main

import (
	"path/filepath"
	"testing"
	"time"
)

func TestRetentionLoneSurvivingBackupNeverPruned(t *testing.T) {
	now := time.Date(2026, 11, 24, 12, 0, 0, 0, time.UTC)
	oldTimestamp := now.AddDate(0, 0, -180) // 180 days old!

	backups := []BackupFile{
		{
			Path:        filepath.Join("backups", "byos_backup_20260528_120000.enc"),
			Filename:    "byos_backup_20260528_120000.enc",
			Timestamp:   oldTimestamp,
			IsEncrypted: true,
			SizeBytes:   1024,
		},
	}

	policy := DefaultRetentionPolicy()
	keep, prune := EvaluateRetention(backups, now, policy)

	if len(keep) != 1 {
		t.Fatalf("lone surviving backup must be kept, got len(keep)=%d", len(keep))
	}
	if len(prune) != 0 {
		t.Fatalf("lone surviving backup must never be pruned, got len(prune)=%d", len(prune))
	}
	if keep[0].Path != backups[0].Path {
		t.Fatalf("kept backup mismatch: got %s, want %s", keep[0].Path, backups[0].Path)
	}
}

func TestRetentionStandardTiers(t *testing.T) {
	now := time.Date(2026, 11, 24, 12, 0, 0, 0, time.UTC)

	// Create a series of backups:
	// - 3 daily backups (1, 2, 3 days ago) -> all 3 kept
	// - 2 backups in week 2 (10, 11 days ago) -> 1 kept (weekly), 1 pruned
	// - 2 backups in month 2 (40, 45 days ago) -> 1 kept (monthly), 1 pruned
	// - 1 backup beyond 12 months (400 days ago) -> pruned
	b1 := BackupFile{Path: "b1.enc", Timestamp: now.AddDate(0, 0, -1), IsEncrypted: true}
	b2 := BackupFile{Path: "b2.enc", Timestamp: now.AddDate(0, 0, -2), IsEncrypted: true}
	b3 := BackupFile{Path: "b3.enc", Timestamp: now.AddDate(0, 0, -3), IsEncrypted: true}
	bW1 := BackupFile{Path: "bw1.enc", Timestamp: now.AddDate(0, 0, -10), IsEncrypted: true}
	bW2 := BackupFile{Path: "bw2.enc", Timestamp: now.AddDate(0, 0, -11), IsEncrypted: true}
	bM1 := BackupFile{Path: "bm1.enc", Timestamp: now.AddDate(0, 0, -40), IsEncrypted: true}
	bM2 := BackupFile{Path: "bm2.enc", Timestamp: now.AddDate(0, 0, -45), IsEncrypted: true}
	bOld := BackupFile{Path: "bold.enc", Timestamp: now.AddDate(0, 0, -400), IsEncrypted: true}

	backups := []BackupFile{b1, b2, b3, bW1, bW2, bM1, bM2, bOld}
	policy := DefaultRetentionPolicy()

	keep, prune := EvaluateRetention(backups, now, policy)

	// Expected kept: b1, b2, b3 (daily), bW1 (weekly), bM1 (monthly) = 5
	// Expected pruned: bW2, bM2, bOld = 3
	if len(keep) != 5 {
		t.Fatalf("expected 5 kept backups, got %d", len(keep))
	}
	if len(prune) != 3 {
		t.Fatalf("expected 3 pruned backups, got %d", len(prune))
	}

	keepMap := make(map[string]bool)
	for _, b := range keep {
		keepMap[b.Path] = true
	}

	for _, expectedKeep := range []string{"b1.enc", "b2.enc", "b3.enc", "bw1.enc", "bm1.enc"} {
		if !keepMap[expectedKeep] {
			t.Errorf("expected %s to be kept, but was pruned", expectedKeep)
		}
	}
}

func TestRetentionAllOlderThanPolicyPreservesNewest(t *testing.T) {
	now := time.Date(2026, 11, 24, 12, 0, 0, 0, time.UTC)

	// All backups are older than 12 months
	b1 := BackupFile{Path: "b1.enc", Timestamp: now.AddDate(0, 0, -450), IsEncrypted: true}
	b2 := BackupFile{Path: "b2.enc", Timestamp: now.AddDate(0, 0, -500), IsEncrypted: true}

	backups := []BackupFile{b1, b2} // b1 is newest
	policy := DefaultRetentionPolicy()

	keep, prune := EvaluateRetention(backups, now, policy)

	if len(keep) != 1 || keep[0].Path != "b1.enc" {
		t.Fatalf("newest backup must be kept as fail-safe, got keep=%v", keep)
	}
	if len(prune) != 1 || prune[0].Path != "b2.enc" {
		t.Fatalf("expected b2.enc to be pruned, got prune=%v", prune)
	}
}

func TestRetention_WALDependencyPreservation(t *testing.T) {
	// Base backup requires WAL starting at 000000010000000000000005
	oldestBaseWAL := "000000010000000000000005"

	walList := []string{
		"000000010000000000000002.enc", // older -> prune
		"000000010000000000000003.enc", // older -> prune
		"000000010000000000000004.enc", // older -> prune
		"000000010000000000000005.enc", // required start -> KEEP!
		"000000010000000000000006.enc", // newer -> KEEP!
		"000000010000000000000007.enc", // newer -> KEEP!
		"00000002.history",             // history file -> KEEP!
		"000000020000000000000001.enc", // new timeline -> KEEP!
	}

	keep, prune := EvaluateWALRetention(walList, oldestBaseWAL)

	if len(keep) != 5 {
		t.Errorf("expected 5 kept WAL objects, got %d (%v)", len(keep), keep)
	}
	if len(prune) != 3 {
		t.Errorf("expected 3 pruned WAL objects, got %d (%v)", len(prune), prune)
	}

	keepMap := make(map[string]bool)
	for _, k := range keep {
		keepMap[k] = true
	}

	for _, expected := range []string{
		"000000010000000000000005.enc",
		"000000010000000000000006.enc",
		"000000010000000000000007.enc",
		"00000002.history",
		"000000020000000000000001.enc",
	} {
		if !keepMap[expected] {
			t.Errorf("expected %s to be kept, but was pruned!", expected)
		}
	}

	// Fail-safe: if oldestBaseWAL is empty, all WAL files must be kept
	keepAll, pruneNone := EvaluateWALRetention(walList, "")
	if len(keepAll) != len(walList) || len(pruneNone) != 0 {
		t.Errorf("expected all WALs kept when no base backup specified")
	}
}

