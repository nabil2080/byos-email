package main

import (
	"context"
	"flag"
	"fmt"
	"os"
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
	fmt.Println("  byos-backup backup  [--db-url <url>] [--out-dir <dir>]")
	fmt.Println("  byos-backup verify  [--backup-dir <dir> | <dir>]")
	fmt.Println("  byos-backup restore [--backup-dir <dir> | <dir>] [--db-url <url>] [--dry-run] [--clean]")
	fmt.Println("  byos-backup inspect [--backup-dir <dir> | <dir>]")
	fmt.Println()
	fmt.Println("Section 23 Compliance:")
	fmt.Println("  - Exports control-plane DB, cryptographic metadata, and routing tables.")
	fmt.Println("  - Enforces NO centralized plaintext customer mailbox archives.")
	fmt.Println("  - Pre-flight SHA-256 and relational integrity checks required before restore.")
}

func envOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
