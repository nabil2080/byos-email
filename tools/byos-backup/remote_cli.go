package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"
)

func initRemoteStorageAndKMS(keyFile string) (*S3Storage, KeyProvider, RemoteStorageConfig, error) {
	cfg, err := LoadRemoteStorageConfigFromEnv()
	if err != nil {
		return nil, nil, cfg, err
	}
	s3Dest, err := NewS3Storage(cfg)
	if err != nil {
		return nil, nil, cfg, err
	}

	if strings.EqualFold(strings.TrimSpace(os.Getenv("BYOS_BACKUP_KMS_PROVIDER")), "aws") {
		awsKMS, kErr := NewAWSKMSKeyProviderFromEnv(context.Background(), s3Dest)
		if kErr != nil {
			return nil, nil, cfg, kErr
		}
		return s3Dest, awsKMS, cfg, nil
	}

	kms, err := NewEnvKeyProvider("", "v1")
	if err != nil {
		return nil, nil, cfg, err
	}
	if keyFile != "" {
		keyBytes, kErr := LoadEncryptionKey(keyFile, "")
		if kErr != nil {
			return nil, nil, cfg, kErr
		}
		ver := envOrDefault("BYOS_BACKUP_KEY_VERSION", "v1")
		kms.keysByVer[strings.ToLower(ver)] = KeyVersion{
			VersionID: strings.ToLower(ver),
			Key:       keyBytes,
			CreatedAt: time.Now().UTC(),
			Status:    "active",
		}
	}
	return s3Dest, kms, cfg, nil
}

func splitCSV(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

func handleRemoteCommand(command string, args []string) int {
	ctx := context.Background()

	switch command {
	case "remote-status":
		fs := flag.NewFlagSet("remote-status", flag.ExitOnError)
		archiveDir := fs.String("archive-dir", "", "Optional local archive directory to compare pending objects")
		keyFile := fs.String("key-file", "", "Optional encryption key file")
		rpoMins := fs.Int("rpo-minutes", 15, "RPO alert threshold in minutes")
		asJSON := fs.Bool("json", false, "Output JSON")
		_ = fs.Parse(args)

		s3Dest, kms, cfg, err := initRemoteStorageAndKMS(*keyFile)
		if err != nil {
			fmt.Fprintf(os.Stderr, "ERROR: initializing remote storage: %v\n", err)
			return exitFailure
		}
		var local StorageDestination
		if *archiveDir != "" {
			local, err = NewFilesystemStorage(*archiveDir)
			if err != nil {
				fmt.Fprintf(os.Stderr, "ERROR: opening local archive %q: %v\n", *archiveDir, err)
				return exitFailure
			}
		}

		rep := GetRemoteStatus(ctx, local, s3Dest, kms, cfg, time.Duration(*rpoMins)*time.Minute)
		if *asJSON {
			b, _ := json.MarshalIndent(rep, "", "  ")
			fmt.Println(string(b))
		} else {
			fmt.Println("==================================================")
			fmt.Printf("BYOS Remote Disaster Recovery Status: [%s]\n", rep.Status)
			fmt.Println("==================================================")
			fmt.Printf("Endpoint / Bucket:       %s / %s (prefix: %s)\n", rep.Endpoint, rep.Bucket, rep.Prefix)
			fmt.Printf("Connected:               %v\n", rep.Connected)
			fmt.Printf("Complete Remote Backups: %d\n", rep.CompleteRemoteBackups)
			if rep.OldestRecoveryPoint != "" {
				fmt.Printf("Oldest Recovery Point:   %s\n", rep.OldestRecoveryPoint)
			}
			fmt.Printf("Total Remote WALs:       %d (history: %d)\n", rep.TotalRemoteWALs, rep.TotalRemoteHistory)
			if rep.LatestRemoteWAL != "" {
				fmt.Printf("Latest Remote WAL:       %s (%s, lag: %s)\n", rep.LatestRemoteWAL, rep.LatestRemoteWALTime.Format("2006-01-02 15:04:05 UTC"), rep.RemoteLag.Round(time.Second))
			}
			fmt.Printf("Pending Local Objects:   %d (%d bytes)\n", rep.PendingLocalObjects, rep.PendingLocalBytes)
			if len(rep.KeyVersionsAvailable) > 0 {
				fmt.Printf("Available Key Versions:  %s\n", strings.Join(rep.KeyVersionsAvailable, ", "))
			}
			if len(rep.Alerts) > 0 {
				fmt.Println("Alerts:")
				for _, a := range rep.Alerts {
					fmt.Printf("  ! %s\n", a)
				}
			}
			fmt.Println("==================================================")
		}
		if rep.Status == "CRITICAL" {
			return exitFailure
		}
		return exitOK

	case "remote-sync":
		fs := flag.NewFlagSet("remote-sync", flag.ExitOnError)
		archiveDir := fs.String("archive-dir", "", "Local archive directory to sync")
		_ = fs.Parse(args)
		if *archiveDir == "" {
			fmt.Fprintln(os.Stderr, "ERROR: --archive-dir is required.")
			return exitUsage
		}
		local, err := NewFilesystemStorage(*archiveDir)
		if err != nil {
			fmt.Fprintf(os.Stderr, "ERROR: opening local archive: %v\n", err)
			return exitFailure
		}
		s3Dest, _, _, err := initRemoteStorageAndKMS("")
		if err != nil {
			fmt.Fprintf(os.Stderr, "ERROR: initializing remote storage: %v\n", err)
			return exitFailure
		}
		sum, err := SyncLocalToRemote(ctx, local, s3Dest)
		if err != nil {
			fmt.Fprintf(os.Stderr, "ERROR: remote sync failed: %v\n", err)
			return exitFailure
		}
		fmt.Printf("SYNC COMPLETE: uploaded=%d already_synced=%d failed=%d bytes=%d\n",
			sum.UploadedObjects, sum.AlreadySynced, sum.FailedObjects, sum.BytesUploaded)
		if sum.FailedObjects > 0 {
			for _, e := range sum.Errors {
				fmt.Fprintf(os.Stderr, "  - %s\n", e)
			}
			return exitFailure
		}
		return exitOK

	case "remote-verify":
		fs := flag.NewFlagSet("remote-verify", flag.ExitOnError)
		keyFile := fs.String("key-file", "", "Optional encryption key file")
		backupID := fs.String("backup-id", "", "Optional specific backup ID to verify")
		_ = fs.Parse(args)

		s3Dest, kms, _, err := initRemoteStorageAndKMS(*keyFile)
		if err != nil {
			fmt.Fprintf(os.Stderr, "ERROR: initializing remote storage: %v\n", err)
			return exitFailure
		}
		cat, err := LoadRemoteCatalog(ctx, s3Dest)
		if err != nil {
			fmt.Fprintf(os.Stderr, "ERROR: loading remote catalog: %v\n", err)
			return exitFailure
		}
		if len(cat.Entries) == 0 {
			fmt.Fprintln(os.Stderr, "CRITICAL: remote recovery catalog contains 0 entries.")
			return exitFailure
		}
		verifiedCount := 0
		for _, entry := range cat.Entries {
			if *backupID != "" && entry.BackupID != *backupID {
				continue
			}
			if err := VerifyRemoteRecoveryPoint(ctx, s3Dest, kms, entry); err != nil {
				fmt.Fprintf(os.Stderr, "FAILED [%s]: %v\n", entry.BackupID, err)
				return exitFailure
			}
			fmt.Printf("VERIFIED [%s]: base=%s wals=%d key=%s\n",
				entry.BackupID, entry.BaseBackupObjectKey, len(entry.RequiredWALs), entry.KeyVersionID)
			verifiedCount++
		}
		if verifiedCount == 0 {
			fmt.Fprintf(os.Stderr, "ERROR: no matching backup found (backup-id=%q)\n", *backupID)
			return exitFailure
		}
		return exitOK

	case "remote-list":
		fs := flag.NewFlagSet("remote-list", flag.ExitOnError)
		prefix := fs.String("prefix", "", "Optional key prefix filter")
		_ = fs.Parse(args)

		s3Dest, _, _, err := initRemoteStorageAndKMS("")
		if err != nil {
			fmt.Fprintf(os.Stderr, "ERROR: initializing remote storage: %v\n", err)
			return exitFailure
		}
		objs, err := s3Dest.List(ctx, *prefix)
		if err != nil {
			fmt.Fprintf(os.Stderr, "ERROR: listing remote objects: %v\n", err)
			return exitFailure
		}
		for _, o := range objs {
			fmt.Printf("%s\t%d\t%s\t%s\n", o.Key, o.SizeBytes, o.SHA256Hex, o.LastModified.Format(time.RFC3339))
		}
		return exitOK

	case "remote-fetch":
		fs := flag.NewFlagSet("remote-fetch", flag.ExitOnError)
		objectKey := fs.String("object-key", "", "Remote object key to fetch")
		outFile := fs.String("out-file", "", "Local output file path")
		_ = fs.Parse(args)
		if *objectKey == "" || *outFile == "" {
			fmt.Fprintln(os.Stderr, "ERROR: --object-key and --out-file are required.")
			return exitUsage
		}
		s3Dest, _, _, err := initRemoteStorageAndKMS("")
		if err != nil {
			fmt.Fprintf(os.Stderr, "ERROR: initializing remote storage: %v\n", err)
			return exitFailure
		}
		sumHex, sizeBytes, err := s3Dest.GetFile(ctx, *objectKey, *outFile)
		if err != nil {
			fmt.Fprintf(os.Stderr, "ERROR: fetching %s: %v\n", *objectKey, err)
			return exitFailure
		}
		fmt.Printf("FETCHED: %s -> %s (%d bytes, sha256=%s)\n", *objectKey, *outFile, sizeBytes, sumHex)
		return exitOK

	case "recovery-catalog":
		fs := flag.NewFlagSet("recovery-catalog", flag.ExitOnError)
		action := fs.String("action", "list", "Action: list or publish")
		archiveDir := fs.String("archive-dir", "", "Local archive directory (for publish)")
		backupID := fs.String("backup-id", "", "Backup ID")
		systemID := fs.String("system-id", "", "PostgreSQL system identifier")
		pgVersion := fs.String("pg-version", "16", "PostgreSQL version")
		startLSN := fs.String("start-lsn", "", "Backup start LSN")
		stopLSN := fs.String("stop-lsn", "", "Backup stop LSN")
		timeline := fs.Uint("timeline", 1, "Timeline ID")
		requiredWALs := fs.String("required-wals", "", "Comma-separated required WAL segments")
		backupHistory := fs.String("backup-history", "", "Backup history .backup filename")
		historyFiles := fs.String("history-files", "", "Comma-separated timeline .history files")
		keyVersion := fs.String("key-version", "v1", "Key version ID")
		keyFile := fs.String("key-file", "", "Optional key file")
		baseFile := fs.String("base-file", "", "Path to encrypted base backup file")
		manifestFile := fs.String("manifest-file", "", "Path to backup_manifest file")
		_ = fs.Parse(args)

		s3Dest, kms, _, err := initRemoteStorageAndKMS(*keyFile)
		if err != nil {
			fmt.Fprintf(os.Stderr, "ERROR: initializing remote storage: %v\n", err)
			return exitFailure
		}
		if *action == "list" {
			cat, err := LoadRemoteCatalog(ctx, s3Dest)
			if err != nil {
				fmt.Fprintf(os.Stderr, "ERROR: loading catalog: %v\n", err)
				return exitFailure
			}
			b, _ := json.MarshalIndent(cat, "", "  ")
			fmt.Println(string(b))
			return exitOK
		}
		if *action == "publish" {
			if *backupID == "" || *baseFile == "" || *archiveDir == "" {
				fmt.Fprintln(os.Stderr, "ERROR: --backup-id, --base-file, and --archive-dir are required for publish.")
				return exitUsage
			}
			local, err := NewFilesystemStorage(*archiveDir)
			if err != nil {
				fmt.Fprintf(os.Stderr, "ERROR: opening local archive: %v\n", err)
				return exitFailure
			}
			now := time.Now().UTC()
			entry := RecoveryCatalogEntry{
				BackupID:             *backupID,
				DatabaseSystemID:     *systemID,
				ServerVersion:        *pgVersion,
				StartTime:            now,
				StopTime:             now,
				StartLSN:             *startLSN,
				StopLSN:              *stopLSN,
				TimelineID:           uint32(*timeline),
				RequiredWALs:         splitCSV(*requiredWALs),
				RequiredHistoryFiles: splitCSV(*historyFiles),
				BackupHistoryFile:    *backupHistory,
				EncryptionAlgorithm:  "AES-256-GCM",
				KeyVersionID:         *keyVersion,
			}
			published, err := PublishBackupToRemote(ctx, local, s3Dest, kms, entry, *baseFile, *manifestFile)
			if err != nil {
				fmt.Fprintf(os.Stderr, "ERROR: publishing recovery point: %v\n", err)
				return exitFailure
			}
			fmt.Printf("PUBLISHED RECOVERY POINT: %s (key=%s, wals=%d, sha256=%s)\n",
				published.BackupID, published.KeyVersionID, len(published.RequiredWALs), published.CiphertextSHA256)
			return exitOK
		}
		fmt.Fprintf(os.Stderr, "ERROR: unknown --action %q\n", *action)
		return exitUsage

	case "remote-prune":
		fs := flag.NewFlagSet("remote-prune", flag.ExitOnError)
		daily := fs.Int("daily-days", 7, "Daily retention days")
		weekly := fs.Int("weekly-weeks", 4, "Weekly retention weeks")
		monthly := fs.Int("monthly-months", 12, "Monthly retention months")
		confirmDelete := fs.Bool("confirm-delete", false, "Actually delete expired objects (default is dry-run)")
		auditLog := fs.String("audit-log", "", "Path to append deletion audit log")
		keyFile := fs.String("key-file", "", "Optional encryption key file")
		_ = fs.Parse(args)

		s3Dest, kms, _, err := initRemoteStorageAndKMS(*keyFile)
		if err != nil {
			fmt.Fprintf(os.Stderr, "ERROR: initializing remote storage: %v\n", err)
			return exitFailure
		}
		dryRun := !*confirmDelete
		policy := RetentionPolicy{DailyDays: *daily, WeeklyWeeks: *weekly, MonthlyMonths: *monthly}
		deleted, err := PruneRemoteBackups(ctx, s3Dest, kms, policy, dryRun, *auditLog)
		if err != nil {
			fmt.Fprintf(os.Stderr, "ERROR: remote prune failed: %v\n", err)
			return exitFailure
		}
		fmt.Printf("REMOTE PRUNE (dry_run=%v): candidates=%d\n", dryRun, len(deleted))
		for _, k := range deleted {
			fmt.Printf("  - %s\n", k)
		}
		return exitOK

	case "remote-recovery-check":
		fs := flag.NewFlagSet("remote-recovery-check", flag.ExitOnError)
		keyFile := fs.String("key-file", "", "Optional encryption key file")
		_ = fs.Parse(args)

		s3Dest, kms, cfg, err := initRemoteStorageAndKMS(*keyFile)
		if err != nil {
			fmt.Fprintf(os.Stderr, "ERROR: initializing remote storage: %v\n", err)
			return exitFailure
		}
		rep := GetRemoteStatus(ctx, nil, s3Dest, kms, cfg, 15*time.Minute)
		if rep.Status == "CRITICAL" || rep.CompleteRemoteBackups == 0 {
			fmt.Fprintf(os.Stderr, "RECOVERY CHECK CRITICAL: complete_backups=%d alerts=%v\n", rep.CompleteRemoteBackups, rep.Alerts)
			return exitFailure
		}
		fmt.Printf("REMOTE RECOVERY READY: complete_backups=%d wals=%d oldest=%s latest_wal=%s\n",
			rep.CompleteRemoteBackups, rep.TotalRemoteWALs, rep.OldestRecoveryPoint, rep.LatestRemoteWAL)
		return exitOK

	case "kms-rotate":
		fs := flag.NewFlagSet("kms-rotate", flag.ExitOnError)
		_ = fs.Parse(args)

		_, kms, _, err := initRemoteStorageAndKMS("")
		if err != nil {
			fmt.Fprintf(os.Stderr, "ERROR: initializing KMS: %v\n", err)
			return exitFailure
		}
		kv, err := kms.RotateKey(ctx)
		if err != nil {
			fmt.Fprintf(os.Stderr, "ERROR: rotating key: %v\n", err)
			return exitFailure
		}
		fmt.Printf("KMS KEY ROTATED: provider=%s active_version=%s status=%s\n", kms.Name(), kv.VersionID, kv.Status)
		return exitOK
	}

	return exitUsage
}
