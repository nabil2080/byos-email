package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	exitOK      = 0
	exitFailure = 1
	exitUsage   = 2

	defaultDBURL = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
)

func main() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(exitUsage)
	}

	command := os.Args[1]

	switch command {
	case "backup":
		backupCmd := flag.NewFlagSet("backup", flag.ExitOnError)
		dbURL := backupCmd.String("db-url", envOrDefault("DATABASE_URL", defaultDBURL), "PostgreSQL connection string")
		outDir := backupCmd.String("out-dir", fmt.Sprintf("./backup-%s", time.Now().Format("20060102_150405")), "Destination directory for backup bundle")
		_ = backupCmd.Parse(os.Args[2:])

		fmt.Printf("Starting BYOS control plane backup to %s...\n", *outDir)
		manifest, err := RunBackup(context.Background(), *dbURL, *outDir, nil)
		if err != nil {
			fmt.Fprintf(os.Stderr, "ERROR: backup failed: %v\n", err)
			os.Exit(exitFailure)
		}

		fmt.Println("==================================================")
		fmt.Printf("SUCCESS: Backup completed successfully!\n")
		fmt.Printf("Destination:    %s\n", *outDir)
		fmt.Printf("Tables:         %d\n", manifest.TotalTables)
		fmt.Printf("Total Records:  %d\n", manifest.TotalRecords)
		fmt.Printf("Bundle SHA-256: %s\n", manifest.BundleSHA256)
		fmt.Println("==================================================")
		os.Exit(exitOK)

	case "verify":
		verifyCmd := flag.NewFlagSet("verify", flag.ExitOnError)
		backupDir := verifyCmd.String("backup-dir", "", "Path to backup directory")
		_ = verifyCmd.Parse(os.Args[2:])

		dir := *backupDir
		if dir == "" && verifyCmd.NArg() > 0 {
			dir = verifyCmd.Arg(0)
		}
		if dir == "" {
			fmt.Fprintln(os.Stderr, "ERROR: --backup-dir or positional directory argument is required.")
			os.Exit(exitUsage)
		}

		fmt.Printf("Verifying backup bundle at %s...\n", dir)
		res, err := RunVerify(dir)
		if err != nil {
			fmt.Fprintf(os.Stderr, "ERROR: verification error: %v\n", err)
			os.Exit(exitFailure)
		}

		if !res.Passed {
			fmt.Fprintf(os.Stderr, "FAILED: Backup bundle verification failed with %d error(s):\n", len(res.Errors))
			for _, errStr := range res.Errors {
				fmt.Fprintf(os.Stderr, "  - %s\n", errStr)
			}
			os.Exit(exitFailure)
		}

		fmt.Println("==================================================")
		fmt.Println("SUCCESS: Backup bundle integrity verified!")
		fmt.Printf("Tables Verified:  %d\n", res.ValidatedTables)
		fmt.Printf("Records Verified: %d\n", res.ValidatedRecords)
		fmt.Printf("Section 23 Check: PASSED (No plaintext customer stores)\n")
		fmt.Println("==================================================")
		os.Exit(exitOK)

	case "restore":
		restoreCmd := flag.NewFlagSet("restore", flag.ExitOnError)
		backupDir := restoreCmd.String("backup-dir", "", "Path to backup directory")
		dbURL := restoreCmd.String("db-url", envOrDefault("DATABASE_URL", defaultDBURL), "Target PostgreSQL connection string")
		dryRun := restoreCmd.Bool("dry-run", false, "Simulate restore in transaction and rollback")
		clean := restoreCmd.Bool("clean", false, "Clean/truncate destination tables before restore")
		_ = restoreCmd.Parse(os.Args[2:])

		dir := *backupDir
		if dir == "" && restoreCmd.NArg() > 0 {
			dir = restoreCmd.Arg(0)
		}
		if dir == "" {
			fmt.Fprintln(os.Stderr, "ERROR: --backup-dir or positional directory argument is required.")
			os.Exit(exitUsage)
		}

		fmt.Printf("Initiating restore from %s (DryRun: %v, Clean: %v)...\n", dir, *dryRun, *clean)
		res, err := RunRestore(context.Background(), dir, *dbURL, *dryRun, *clean)
		if err != nil {
			fmt.Fprintf(os.Stderr, "ERROR: restore failed: %v\n", err)
			os.Exit(exitFailure)
		}

		fmt.Println("==================================================")
		if res.DryRun {
			fmt.Println("SUCCESS: Dry-run restore completed cleanly without errors!")
		} else {
			fmt.Println("SUCCESS: Database restored successfully!")
		}
		fmt.Printf("Restored Tables:  %d\n", res.RestoredTables)
		fmt.Printf("Restored Records: %d\n", res.RestoredRecords)
		fmt.Printf("Duration:         %s\n", res.Duration)
		fmt.Println("==================================================")
		os.Exit(exitOK)

	case "inspect":
		inspectCmd := flag.NewFlagSet("inspect", flag.ExitOnError)
		backupDir := inspectCmd.String("backup-dir", "", "Path to backup directory")
		_ = inspectCmd.Parse(os.Args[2:])

		dir := *backupDir
		if dir == "" && inspectCmd.NArg() > 0 {
			dir = inspectCmd.Arg(0)
		}
		if dir == "" {
			fmt.Fprintln(os.Stderr, "ERROR: --backup-dir or positional directory argument is required.")
			os.Exit(exitUsage)
		}

		report, err := RunInspect(dir)
		if err != nil {
			fmt.Fprintf(os.Stderr, "ERROR: inspect failed: %v\n", err)
			os.Exit(exitFailure)
		}

		fmt.Println("==================================================")
		fmt.Println("BYOS Backup Bundle Inspection Report")
		fmt.Println("==================================================")
		fmt.Printf("Timestamp:          %s\n", report.Timestamp)
		fmt.Printf("BYOS Version:       %s\n", report.BYOSVersion)
		fmt.Printf("Integrity Status:   %v\n", report.IntegrityValid)
		fmt.Printf("Total Size:         %d bytes\n", report.TotalSizeBytes)
		fmt.Printf("Organizations:      %d\n", report.OrganizationsCount)
		fmt.Printf("Users:              %d\n", report.UsersCount)
		fmt.Printf("Domains:            %d\n", report.DomainsCount)
		fmt.Printf("Mailboxes:          %d\n", report.MailboxesCount)
		fmt.Printf("Storage Conns:      %d\n", report.StorageConnCount)
		fmt.Printf("Message Records:    %d\n", report.MessageMetadataCount)
		fmt.Println("--------------------------------------------------")
		fmt.Println("Table Breakdown:")
		for tbl, cnt := range report.Tables {
			fmt.Printf("  - %-25s : %d records\n", tbl, cnt)
		}
		fmt.Println("==================================================")
		os.Exit(exitOK)

	case "encrypt-bundle":
		encCmd := flag.NewFlagSet("encrypt-bundle", flag.ExitOnError)
		globalsFile := encCmd.String("globals-file", "", "Path to globals.sql from pg_dumpall")
		dumpFile := encCmd.String("dump-file", "", "Path to database.dump from pg_dump -Fc")
		manifestFile := encCmd.String("manifest-file", "", "Optional path to manifest.json")
		outFile := encCmd.String("out-file", "", "Output path for the encrypted .enc archive")
		keyFile := encCmd.String("key-file", "", "Path to 256-bit encryption key file")
		_ = encCmd.Parse(os.Args[2:])

		if *dumpFile == "" || *outFile == "" {
			fmt.Fprintln(os.Stderr, "ERROR: --dump-file and --out-file are required.")
			os.Exit(exitUsage)
		}

		key, err := LoadEncryptionKey(*keyFile, filepath.Dir(*outFile))
		if err != nil {
			fmt.Fprintf(os.Stderr, "ERROR: loading encryption key: %v\n", err)
			os.Exit(exitFailure)
		}

		dumpData, err := os.ReadFile(*dumpFile)
		if err != nil {
			fmt.Fprintf(os.Stderr, "ERROR: reading dump file %q: %v\n", *dumpFile, err)
			os.Exit(exitFailure)
		}

		var globalsData []byte
		if *globalsFile != "" {
			globalsData, err = os.ReadFile(*globalsFile)
			if err != nil {
				fmt.Fprintf(os.Stderr, "ERROR: reading globals file %q: %v\n", *globalsFile, err)
				os.Exit(exitFailure)
			}
		}

		var manifestData []byte
		if *manifestFile != "" {
			manifestData, err = os.ReadFile(*manifestFile)
			if err != nil {
				fmt.Fprintf(os.Stderr, "ERROR: reading manifest file %q: %v\n", *manifestFile, err)
				os.Exit(exitFailure)
			}
		} else {
			manifestData = []byte(fmt.Sprintf(`{"created_at":%q,"encrypted":true}`, time.Now().UTC().Format(time.RFC3339)))
		}

		bundle := &EncryptedBackupBundle{
			GlobalsSQL:   globalsData,
			DatabaseDump: dumpData,
			ManifestJSON: manifestData,
			CreatedAt:    time.Now().UTC(),
		}

		encryptedArchive, err := CreateEncryptedArchive(bundle, key)
		if err != nil {
			fmt.Fprintf(os.Stderr, "ERROR: encrypting archive: %v\n", err)
			os.Exit(exitFailure)
		}

		if err := os.MkdirAll(filepath.Dir(*outFile), 0755); err != nil {
			fmt.Fprintf(os.Stderr, "ERROR: creating output directory: %v\n", err)
			os.Exit(exitFailure)
		}

		if err := os.WriteFile(*outFile, encryptedArchive, 0600); err != nil {
			fmt.Fprintf(os.Stderr, "ERROR: writing encrypted archive %q: %v\n", *outFile, err)
			os.Exit(exitFailure)
		}

		fmt.Println("==================================================")
		fmt.Println("SUCCESS: Encrypted backup archive created!")
		fmt.Printf("Output File:    %s\n", *outFile)
		fmt.Printf("Encrypted Size: %d bytes\n", len(encryptedArchive))
		fmt.Printf("Cipher:         AES-256-GCM (Authenticated)\n")
		fmt.Println("==================================================")
		os.Exit(exitOK)

	case "decrypt-bundle":
		decCmd := flag.NewFlagSet("decrypt-bundle", flag.ExitOnError)
		inFile := decCmd.String("in-file", "", "Path to the encrypted .enc archive")
		outDir := decCmd.String("out-dir", "", "Destination directory to unpack decrypted files")
		keyFile := decCmd.String("key-file", "", "Path to 256-bit encryption key file")
		_ = decCmd.Parse(os.Args[2:])

		if *inFile == "" || *outDir == "" {
			fmt.Fprintln(os.Stderr, "ERROR: --in-file and --out-dir are required.")
			os.Exit(exitUsage)
		}

		key, err := LoadEncryptionKey(*keyFile, filepath.Dir(*inFile))
		if err != nil {
			fmt.Fprintf(os.Stderr, "ERROR: loading encryption key: %v\n", err)
			os.Exit(exitFailure)
		}

		encryptedData, err := os.ReadFile(*inFile)
		if err != nil {
			fmt.Fprintf(os.Stderr, "ERROR: reading encrypted archive %q: %v\n", *inFile, err)
			os.Exit(exitFailure)
		}

		bundle, err := DecryptAndUnpackArchive(encryptedData, key)
		if err != nil {
			fmt.Fprintf(os.Stderr, "ERROR: decrypting archive: %v\n", err)
			os.Exit(exitFailure)
		}

		if err := os.MkdirAll(*outDir, 0755); err != nil {
			fmt.Fprintf(os.Stderr, "ERROR: creating output directory: %v\n", err)
			os.Exit(exitFailure)
		}

		dumpPath := filepath.Join(*outDir, "database.dump")
		if err := os.WriteFile(dumpPath, bundle.DatabaseDump, 0600); err != nil {
			fmt.Fprintf(os.Stderr, "ERROR: writing database.dump: %v\n", err)
			os.Exit(exitFailure)
		}

		if len(bundle.GlobalsSQL) > 0 {
			globalsPath := filepath.Join(*outDir, "globals.sql")
			if err := os.WriteFile(globalsPath, bundle.GlobalsSQL, 0600); err != nil {
				fmt.Fprintf(os.Stderr, "ERROR: writing globals.sql: %v\n", err)
				os.Exit(exitFailure)
			}
		}

		if len(bundle.ManifestJSON) > 0 {
			manifestPath := filepath.Join(*outDir, "manifest.json")
			if err := os.WriteFile(manifestPath, bundle.ManifestJSON, 0600); err != nil {
				fmt.Fprintf(os.Stderr, "ERROR: writing manifest.json: %v\n", err)
				os.Exit(exitFailure)
			}
		}

		fmt.Println("==================================================")
		fmt.Println("SUCCESS: Encrypted backup decrypted and unpacked!")
		fmt.Printf("Destination:    %s\n", *outDir)
		fmt.Printf("Database Dump:  %s (%d bytes)\n", dumpPath, len(bundle.DatabaseDump))
		if len(bundle.GlobalsSQL) > 0 {
			fmt.Printf("Globals SQL:    %s (%d bytes)\n", filepath.Join(*outDir, "globals.sql"), len(bundle.GlobalsSQL))
		}
		fmt.Println("==================================================")
		os.Exit(exitOK)

	case "verify-encrypted":
		verEncCmd := flag.NewFlagSet("verify-encrypted", flag.ExitOnError)
		inFile := verEncCmd.String("in-file", "", "Path to the encrypted .enc archive")
		keyFile := verEncCmd.String("key-file", "", "Path to 256-bit encryption key file")
		_ = verEncCmd.Parse(os.Args[2:])

		if *inFile == "" {
			fmt.Fprintln(os.Stderr, "ERROR: --in-file is required.")
			os.Exit(exitUsage)
		}

		key, err := LoadEncryptionKey(*keyFile, filepath.Dir(*inFile))
		if err != nil {
			fmt.Fprintf(os.Stderr, "ERROR: loading encryption key: %v\n", err)
			os.Exit(exitFailure)
		}

		encryptedData, err := os.ReadFile(*inFile)
		if err != nil {
			fmt.Fprintf(os.Stderr, "ERROR: reading encrypted archive %q: %v\n", *inFile, err)
			os.Exit(exitFailure)
		}

		bundle, err := DecryptAndUnpackArchive(encryptedData, key)
		if err != nil {
			fmt.Fprintf(os.Stderr, "FAILED: Verification failed: %v\n", err)
			os.Exit(exitFailure)
		}

		fmt.Println("==================================================")
		fmt.Println("SUCCESS: Encrypted archive integrity and key verified!")
		fmt.Printf("Archive File:   %s\n", *inFile)
		fmt.Printf("Dump Size:      %d bytes\n", len(bundle.DatabaseDump))
		fmt.Printf("Globals Size:   %d bytes\n", len(bundle.GlobalsSQL))
		fmt.Printf("Authentication: AES-256-GCM Tag MATCHED\n")
		fmt.Println("==================================================")
		os.Exit(exitOK)

	case "prune":
		pruneCmd := flag.NewFlagSet("prune", flag.ExitOnError)
		backupDir := pruneCmd.String("backup-dir", "", "Path to backup directory containing .enc or .dump files")
		dailyDays := pruneCmd.Int("daily-days", 7, "Keep daily backups for N days")
		weeklyWeeks := pruneCmd.Int("weekly-weeks", 4, "Keep weekly backups for N weeks")
		monthlyMonths := pruneCmd.Int("monthly-months", 12, "Keep monthly backups for N months")
		dryRun := pruneCmd.Bool("dry-run", false, "Simulate pruning without deleting files")
		_ = pruneCmd.Parse(os.Args[2:])

		if *backupDir == "" {
			fmt.Fprintln(os.Stderr, "ERROR: --backup-dir is required.")
			os.Exit(exitUsage)
		}

		policy := RetentionPolicy{
			DailyDays:     *dailyDays,
			WeeklyWeeks:   *weeklyWeeks,
			MonthlyMonths: *monthlyMonths,
		}

		keep, prune, err := PruneBackups(*backupDir, policy, *dryRun)
		if err != nil {
			fmt.Fprintf(os.Stderr, "ERROR: pruning backups: %v\n", err)
			os.Exit(exitFailure)
		}

		fmt.Println("==================================================")
		if *dryRun {
			fmt.Println("DRY-RUN: Retention Evaluation Report (No files deleted)")
		} else {
			fmt.Println("SUCCESS: Backup Retention Pruning Executed!")
		}
		fmt.Println("==================================================")
		fmt.Printf("Directory:        %s\n", *backupDir)
		fmt.Printf("Backups Retained: %d\n", len(keep))
		for _, b := range keep {
			fmt.Printf("  [KEEP]  %s (%s, %d bytes)\n", b.Filename, b.Timestamp.Format("2006-01-02 15:04:05"), b.SizeBytes)
		}
		fmt.Printf("Backups Pruned:   %d\n", len(prune))
		for _, b := range prune {
			fmt.Printf("  [PRUNE] %s (%s, %d bytes)\n", b.Filename, b.Timestamp.Format("2006-01-02 15:04:05"), b.SizeBytes)
		}
		fmt.Println("==================================================")
		os.Exit(exitOK)

	case "archive-wal":
		walCmd := flag.NewFlagSet("archive-wal", flag.ExitOnError)
		sourcePath := walCmd.String("source-path", "", "Path to WAL segment to archive (%p)")
		walName := walCmd.String("wal-name", "", "WAL segment filename (%f)")
		archiveDir := walCmd.String("archive-dir", "", "Path to archive destination directory")
		keyFile := walCmd.String("key-file", "", "Path to encryption key file")
		keyVersion := walCmd.String("key-version", "v1", "Encryption key version identifier")
		_ = walCmd.Parse(os.Args[2:])

		if *sourcePath == "" || *archiveDir == "" {
			fmt.Fprintln(os.Stderr, "ERROR: --source-path and --archive-dir are required.")
			os.Exit(exitUsage)
		}

		var key []byte
		var err error
		if strings.EqualFold(strings.TrimSpace(os.Getenv("BYOS_BACKUP_KMS_PROVIDER")), "aws") {
			remoteCfgTmp, cfgErr := LoadRemoteStorageConfigFromEnv()
			if cfgErr != nil {
				fmt.Fprintf(os.Stderr, "ERROR: loading remote config for AWS KMS: %v\n", cfgErr)
				os.Exit(exitFailure)
			}
			s3Tmp, s3Err := NewS3Storage(remoteCfgTmp)
			if s3Err != nil {
				fmt.Fprintf(os.Stderr, "ERROR: initializing S3 envelope store for AWS KMS: %v\n", s3Err)
				os.Exit(exitFailure)
			}
			awsKMS, kErr := NewAWSKMSKeyProviderFromEnv(context.Background(), s3Tmp)
			if kErr != nil {
				fmt.Fprintf(os.Stderr, "ERROR: initializing AWS KMS provider: %v\n", kErr)
				os.Exit(exitFailure)
			}
			kv, kvErr := awsKMS.GetActiveKey(context.Background())
			if kvErr != nil {
				fmt.Fprintf(os.Stderr, "ERROR: resolving active AWS KMS DEK: %v\n", kvErr)
				os.Exit(exitFailure)
			}
			key = kv.Key
			*keyVersion = kv.VersionID
		} else {
			key, err = LoadEncryptionKey(*keyFile, *archiveDir)
			if err != nil {
				fmt.Fprintf(os.Stderr, "ERROR: loading encryption key: %v\n", err)
				os.Exit(exitFailure)
			}
		}

		localStorage, err := NewFilesystemStorage(*archiveDir)
		if err != nil {
			fmt.Fprintf(os.Stderr, "ERROR: initializing archive storage: %v\n", err)
			os.Exit(exitFailure)
		}

		var storage StorageDestination = localStorage
		remoteCfg, rCfgErr := LoadRemoteStorageConfigFromEnv()
		if rCfgErr != nil {
			fmt.Fprintf(os.Stderr, "ERROR: loading remote storage config: %v\n", rCfgErr)
			os.Exit(exitFailure)
		}
		if remoteCfg.Enabled {
			s3Dest, s3Err := NewS3Storage(remoteCfg)
			if s3Err != nil {
				if remoteCfg.Required {
					fmt.Fprintf(os.Stderr, "ERROR: remote-required storage initialization failed: %v\n", s3Err)
					os.Exit(exitFailure)
				}
				fmt.Fprintf(os.Stderr, "WARNING: optional remote storage init failed (continuing local-only): %v\n", s3Err)
			} else {
				storage = NewDualStorage(localStorage, s3Dest, remoteCfg.Required)
			}
		}

		meta, err := ArchiveWALSegment(context.Background(), storage, *sourcePath, *walName, key, *keyVersion)
		if err != nil {
			fmt.Fprintf(os.Stderr, "ERROR: archiving WAL segment: %v\n", err)
			os.Exit(exitFailure)
		}

		fmt.Printf("SUCCESS: Archived WAL %s (Plaintext: %d bytes, Cipher: %s)\n", meta.WALName, meta.PlaintextSize, meta.KeyVersion)
		os.Exit(exitOK)

	case "restore-wal":
		walCmd := flag.NewFlagSet("restore-wal", flag.ExitOnError)
		walName := walCmd.String("wal-name", "", "WAL segment filename to restore (%f)")
		targetPath := walCmd.String("target-path", "", "Target destination path for restored WAL (%p)")
		destPath := walCmd.String("dest", "", "Alias for --target-path (%p)")
		archiveDir := walCmd.String("archive-dir", "", "Path to archive source directory")
		keyFile := walCmd.String("key-file", "", "Path to encryption key file")
		useRemote := walCmd.Bool("remote", false, "Restore WAL directly from configured remote S3 storage")
		_ = walCmd.Parse(os.Args[2:])

		if *targetPath == "" && *destPath != "" {
			*targetPath = *destPath
		}

		if *walName == "" || *targetPath == "" || (!*useRemote && *archiveDir == "") {
			fmt.Fprintln(os.Stderr, "ERROR: --wal-name, --target-path, and (--archive-dir or --remote) are required.")
			os.Exit(exitUsage)
		}

		var storage StorageDestination
		var kms KeyProvider
		var err error
		if *useRemote {
			remoteCfg, cfgErr := LoadRemoteStorageConfigFromEnv()
			if cfgErr != nil {
				fmt.Fprintf(os.Stderr, "ERROR: loading remote config: %v\n", cfgErr)
				os.Exit(exitFailure)
			}
			s3Dest, s3Err := NewS3Storage(remoteCfg)
			if s3Err != nil {
				fmt.Fprintf(os.Stderr, "ERROR: initializing remote archive storage: %v\n", s3Err)
				os.Exit(exitFailure)
			}
			storage = s3Dest
		} else {
			storage, err = NewFilesystemStorage(*archiveDir)
			if err != nil {
				fmt.Fprintf(os.Stderr, "ERROR: initializing archive storage: %v\n", err)
				os.Exit(exitFailure)
			}
		}

		if strings.EqualFold(strings.TrimSpace(os.Getenv("BYOS_BACKUP_KMS_PROVIDER")), "aws") {
			envStore := storage
			if s3Env, ok := storage.(*S3Storage); ok {
				envStore = s3Env
			} else {
				remoteCfg, cfgErr := LoadRemoteStorageConfigFromEnv()
				if cfgErr == nil {
					if s3Tmp, s3Err := NewS3Storage(remoteCfg); s3Err == nil {
						envStore = s3Tmp
					}
				}
			}
			kms, err = NewAWSKMSKeyProviderFromEnv(context.Background(), envStore)
			if err != nil {
				fmt.Fprintf(os.Stderr, "ERROR: initializing AWS KMS provider: %v\n", err)
				os.Exit(exitFailure)
			}
		} else {
			envKMS, kErr := NewEnvKeyProvider("", "v1")
			if kErr != nil {
				fmt.Fprintf(os.Stderr, "ERROR: initializing KMS: %v\n", kErr)
				os.Exit(exitFailure)
			}
			if *keyFile != "" {
				keyBytes, lErr := LoadEncryptionKey(*keyFile, "")
				if lErr != nil {
					fmt.Fprintf(os.Stderr, "ERROR: loading encryption key: %v\n", lErr)
					os.Exit(exitFailure)
				}
				ver := strings.ToLower(envOrDefault("BYOS_BACKUP_KEY_VERSION", "v1"))
				envKMS.keysByVer[ver] = KeyVersion{
					VersionID: ver,
					Key:       keyBytes,
					CreatedAt: time.Now().UTC(),
					Status:    "active",
				}
			}
			kms = envKMS
		}

		err = RestoreWALSegment(context.Background(), storage, *walName, *targetPath, kms)
		if err != nil {
			// If not found, exit 1 (PostgreSQL standard to signal end of WAL stream)
			if errors.Is(err, ErrWALNotFound) {
				os.Exit(1)
			}
			fmt.Fprintf(os.Stderr, "ERROR: restoring WAL segment %s: %v\n", *walName, err)
			os.Exit(exitUsage)
		}

		os.Exit(exitOK)

	case "wal-status":
		statusCmd := flag.NewFlagSet("wal-status", flag.ExitOnError)
		archiveDir := statusCmd.String("archive-dir", "", "Path to archive destination directory")
		_ = statusCmd.Parse(os.Args[2:])

		if *archiveDir == "" {
			fmt.Fprintln(os.Stderr, "ERROR: --archive-dir is required.")
			os.Exit(exitUsage)
		}

		storage, err := NewFilesystemStorage(*archiveDir)
		if err != nil {
			fmt.Fprintf(os.Stderr, "ERROR: opening storage %q: %v\n", *archiveDir, err)
			os.Exit(exitFailure)
		}

		status, err := GetWALArchiveStatus(context.Background(), storage)
		if err != nil {
			fmt.Fprintf(os.Stderr, "ERROR: inspecting WAL archive: %v\n", err)
			os.Exit(exitFailure)
		}

		fmt.Println("==================================================")
		fmt.Println("BYOS WAL Archive Status Report")
		fmt.Println("==================================================")
		fmt.Printf("Total Segments:    %d\n", status.TotalSegments)
		fmt.Printf("History Files:     %d\n", status.TotalHistory)
		fmt.Printf("Archive Disk Size: %d bytes (%.2f MB)\n", status.TotalSizeBytes, float64(status.TotalSizeBytes)/(1024*1024))
		fmt.Printf("Oldest WAL:        %s (%s)\n", status.OldestWAL, status.OldestTimestamp.Format("2006-01-02 15:04:05 UTC"))
		fmt.Printf("Newest WAL:        %s (%s)\n", status.NewestWAL, status.NewestTimestamp.Format("2006-01-02 15:04:05 UTC"))
		if !status.NewestTimestamp.IsZero() {
			fmt.Printf("Archive Lag:       %s\n", status.ArchiveLag.Round(time.Second))
		}
		if len(status.SequenceGaps) > 0 {
			fmt.Printf("WARNING: %d sequence gaps detected:\n", len(status.SequenceGaps))
			for _, g := range status.SequenceGaps {
				fmt.Printf("  - %s\n", g)
			}
		} else {
			fmt.Println("Sequence Check:    CONTINUOUS (No gaps detected)")
		}
		fmt.Println("==================================================")
		os.Exit(exitOK)

	case "prepare-pitr":
		pitrCmd := flag.NewFlagSet("prepare-pitr", flag.ExitOnError)
		targetDir := pitrCmd.String("target-dir", "", "Target PostgreSQL data directory")
		restoreCmdStr := pitrCmd.String("restore-cmd", "", "restore_command string for PostgreSQL")
		targetTimeStr := pitrCmd.String("target-time", "", "Optional target timestamp (YYYY-MM-DD HH:MM:SS UTC)")
		targetAction := pitrCmd.String("target-action", "promote", "Recovery target action (promote or pause)")
		_ = pitrCmd.Parse(os.Args[2:])

		if *targetDir == "" || *restoreCmdStr == "" {
			fmt.Fprintln(os.Stderr, "ERROR: --target-dir and --restore-cmd are required.")
			os.Exit(exitUsage)
		}

		var target PITRTarget
		target.TargetAction = *targetAction
		target.Inclusive = true

		if *targetTimeStr != "" {
			t, err := time.Parse("2006-01-02 15:04:05 MST", *targetTimeStr)
			if err != nil {
				t, err = time.Parse(time.RFC3339, *targetTimeStr)
			}
			if err != nil {
				fmt.Fprintf(os.Stderr, "ERROR: invalid target-time %q: %v\n", *targetTimeStr, err)
				os.Exit(exitUsage)
			}
			target.TargetTime = t
		}

		if err := GeneratePostgresRecoveryConf(*targetDir, *restoreCmdStr, target); err != nil {
			fmt.Fprintf(os.Stderr, "ERROR: preparing PITR configuration: %v\n", err)
			os.Exit(exitFailure)
		}

		fmt.Println("==================================================")
		fmt.Println("SUCCESS: PostgreSQL PITR Configuration Prepared!")
		fmt.Printf("Target Data Directory: %s\n", *targetDir)
		fmt.Printf("Restore Command:       %s\n", *restoreCmdStr)
		if !target.TargetTime.IsZero() {
			fmt.Printf("Recovery Target Time:  %s\n", target.TargetTime.Format("2006-01-02 15:04:05 UTC"))
		}
		fmt.Printf("Recovery Action:       %s\n", target.TargetAction)
		fmt.Println("==================================================")
		os.Exit(exitOK)

	case "recovery-status":
		rStatusCmd := flag.NewFlagSet("recovery-status", flag.ExitOnError)
		archiveDir := rStatusCmd.String("archive-dir", "", "Path to storage directory containing backups/ and wal/")
		keyFile := rStatusCmd.String("key-file", "", "Optional encryption key file")
		_ = rStatusCmd.Parse(os.Args[2:])

		if *archiveDir == "" {
			fmt.Fprintln(os.Stderr, "ERROR: --archive-dir is required.")
			os.Exit(exitUsage)
		}

		kms, _ := NewEnvKeyProvider("", "v1")
		if *keyFile != "" {
			keyBytes, err := LoadEncryptionKey(*keyFile, "")
			if err == nil {
				kms.keysByVer["v1"] = KeyVersion{
					VersionID: "v1",
					Key:       keyBytes,
					CreatedAt: time.Now().UTC(),
					Status:    "active",
				}
			}
		}

		storage, err := NewFilesystemStorage(*archiveDir)
		if err != nil {
			fmt.Fprintf(os.Stderr, "ERROR: opening storage %q: %v\n", *archiveDir, err)
			os.Exit(exitFailure)
		}

		report, err := GenerateRecoveryHealthReport(context.Background(), storage, kms)
		if err != nil {
			fmt.Fprintf(os.Stderr, "ERROR: generating recovery health report: %v\n", err)
			os.Exit(exitFailure)
		}

		fmt.Println("==================================================")
		fmt.Printf("BYOS Disaster Recovery Health: [%s]\n", report.Status)
		fmt.Println("==================================================")
		fmt.Printf("Report Timestamp:        %s\n", report.Timestamp.Format("2006-01-02 15:04:05 UTC"))
		fmt.Printf("Total Base Backups:      %d\n", report.TotalBaseBackups)
		if report.LatestBackupID != "" {
			fmt.Printf("Latest Base Backup:      %s (%s, age: %s)\n", report.LatestBackupID, report.LatestBackupTime.Format("2006-01-02 15:04:05 UTC"), report.LatestBackupAge.Round(time.Second))
		}
		fmt.Printf("Total Archived WALs:     %d\n", report.TotalArchivedWALs)
		if report.LatestWALName != "" {
			fmt.Printf("Latest Archived WAL:     %s (%s, lag: %s)\n", report.LatestWALName, report.LatestWALTime.Format("2006-01-02 15:04:05 UTC"), report.ArchiveLag.Round(time.Second))
		}
		fmt.Printf("Estimated RPO:           %s\n", report.EstimatedRPO.Round(time.Second))
		fmt.Printf("Recoverable Time Range:  %s\n", report.RecoverableTimeRange)
		if len(report.KeyVersions) > 0 {
			fmt.Printf("Key Versions Present:    %s\n", strings.Join(report.KeyVersions, ", "))
		}
		if len(report.Alerts) > 0 {
			fmt.Println("Operational Alerts:")
			for _, a := range report.Alerts {
				fmt.Printf("  ! %s\n", a)
			}
		}
		fmt.Println("==================================================")
		os.Exit(exitOK)

	case "remote-status", "remote-sync", "remote-verify", "remote-list", "remote-fetch", "recovery-catalog", "remote-prune", "remote-recovery-check", "kms-rotate":
		os.Exit(handleRemoteCommand(command, os.Args[2:]))

	case "help", "-h", "--help":
		printUsage()
		os.Exit(exitOK)

	default:
		fmt.Fprintf(os.Stderr, "Unknown command %q\n", command)
		printUsage()
		os.Exit(exitUsage)
	}
}

func printUsage() {
	fmt.Println("BYOS Backup & Disaster Recovery Tool (Section 23)")
	fmt.Println()
	fmt.Println("Usage:")
	fmt.Println("  byos-backup backup                 [--db-url <url>] [--out-dir <dir>]")
	fmt.Println("  byos-backup verify                 [--backup-dir <dir> | <dir>]")
	fmt.Println("  byos-backup restore                [--backup-dir <dir> | <dir>] [--db-url <url>] [--dry-run] [--clean]")
	fmt.Println("  byos-backup inspect                [--backup-dir <dir> | <dir>]")
	fmt.Println("  byos-backup encrypt-bundle         --dump-file <path> [--globals-file <path>] --out-file <path> [--key-file <path>]")
	fmt.Println("  byos-backup decrypt-bundle         --in-file <path> --out-dir <dir> [--key-file <path>]")
	fmt.Println("  byos-backup verify-encrypted       --in-file <path> [--key-file <path>]")
	fmt.Println("  byos-backup prune                  --backup-dir <dir> [--daily-days <N>] [--weekly-weeks <N>] [--monthly-months <N>] [--dry-run]")
	fmt.Println("  byos-backup archive-wal            --source-path <path> [--wal-name <name>] --archive-dir <dir> [--key-file <path>] [--key-version <id>]")
	fmt.Println("  byos-backup restore-wal            --wal-name <name> --target-path <path> (--archive-dir <dir> | --remote) [--key-file <path>]")
	fmt.Println("  byos-backup wal-status             --archive-dir <dir>")
	fmt.Println("  byos-backup prepare-pitr           --target-dir <dir> --restore-cmd <cmd> [--target-time <timestamp>] [--target-action <promote|pause>]")
	fmt.Println("  byos-backup recovery-status        --archive-dir <dir> [--key-file <path>]")
	fmt.Println("  byos-backup remote-status          [--archive-dir <dir>] [--key-file <path>] [--json]")
	fmt.Println("  byos-backup remote-sync            --archive-dir <dir>")
	fmt.Println("  byos-backup remote-verify          [--backup-id <id>] [--key-file <path>]")
	fmt.Println("  byos-backup remote-list            [--prefix <prefix>]")
	fmt.Println("  byos-backup remote-fetch           --object-key <key> --out-file <path>")
	fmt.Println("  byos-backup recovery-catalog       --action <list|publish> [...]")
	fmt.Println("  byos-backup remote-prune           [--daily-days <N>] [--weekly-weeks <N>] [--monthly-months <N>] [--confirm-delete]")
	fmt.Println("  byos-backup remote-recovery-check  [--key-file <path>]")
	fmt.Println()
	fmt.Println("Pre-Egress Backup Encryption & Retention:")
	fmt.Println("  - Authenticated AES-256-GCM encryption before host egress.")
	fmt.Println("  - Daily (7d), weekly (4w), and monthly (12m) lifecycle pruning.")
	fmt.Println("  - Strict last-known-good backup protection against accidental deletion.")
	fmt.Println("  - Cryptographic key isolation enforced (key must not reside in backup directory).")
}

func envOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
