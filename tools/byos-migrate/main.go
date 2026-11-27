package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"text/tabwriter"
	"time"

	"github.com/jackc/pgx/v5"
)

const (
	exitOK      = 0
	exitFailure = 1
	exitUsage   = 1

	defaultDBURL = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
)

func envOrDefault(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}

func printUsage() {
	fmt.Println("BYOS Canonical Database Migration Runner")
	fmt.Println("")
	fmt.Println("Usage:")
	fmt.Println("  byos-migrate --help")
	fmt.Println("  byos-migrate up       [--db-url <url>] [--dir <path>] [--baseline <ver>] [--no-auto-baseline]")
	fmt.Println("  byos-migrate status   [--db-url <url>] [--dir <path>]")
	fmt.Println("  byos-migrate verify   [--db-url <url>] [--dir <path>]")
	fmt.Println("  byos-migrate baseline --version <ver> [--confirm] [--db-url <url>] [--dir <path>]")
	fmt.Println("")
	fmt.Println("Environment Variables:")
	fmt.Println("  DATABASE_URL    Database connection URL")
	fmt.Println("  MIGRATIONS_DIR  Path to canonical migrations directory")
}

func main() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(exitUsage)
	}

	command := os.Args[1]

	defaultMigrationsDir := envOrDefault("MIGRATIONS_DIR", "infra/postgres/migrations")
	defaultDatabaseURL := envOrDefault("DATABASE_URL", defaultDBURL)

	switch command {
	case "--help", "-h", "help":
		printUsage()
		os.Exit(exitOK)

	case "up", "run":
		upCmd := flag.NewFlagSet("up", flag.ExitOnError)
		dbURL := upCmd.String("db-url", defaultDatabaseURL, "PostgreSQL connection string")
		dir := upCmd.String("dir", defaultMigrationsDir, "Directory containing SQL migrations")
		baseline := upCmd.String("baseline", "", "Explicitly stamp migrations up to this version before migrating")
		noAutoBaseline := upCmd.Bool("no-auto-baseline", false, "Disable automatic baseline detection for existing databases")
		_ = upCmd.Parse(os.Args[2:])

		migrator := NewMigrator(*dbURL, *dir)
		migrator.BaselineTo = *baseline
		migrator.AutoBaseline = !*noAutoBaseline

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()

		count, err := migrator.Up(ctx)
		if err != nil {
			log.Fatalf("ERROR: Migration failed: %v", err)
		}
		fmt.Printf("SUCCESS: Applied %d migration(s).\n", count)
		os.Exit(exitOK)

	case "status":
		statusCmd := flag.NewFlagSet("status", flag.ExitOnError)
		dbURL := statusCmd.String("db-url", defaultDatabaseURL, "PostgreSQL connection string")
		dir := statusCmd.String("dir", defaultMigrationsDir, "Directory containing SQL migrations")
		_ = statusCmd.Parse(os.Args[2:])

		migrator := NewMigrator(*dbURL, *dir)
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		statuses, err := migrator.Status(ctx)
		if err != nil {
			log.Fatalf("ERROR: Querying migration status failed: %v", err)
		}

		w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
		fmt.Fprintln(w, "VERSION\tNAME\tSTATUS\tAPPLIED AT\tCHECKSUM")
		fmt.Fprintln(w, "-------\t----\t------\t----------\t--------")
		for _, s := range statuses {
			appliedStr := "-"
			if s.AppliedAt != nil {
				appliedStr = s.AppliedAt.Format("2006-01-02 15:04:05")
			}
			csumShort := s.Checksum
			if len(csumShort) > 12 {
				csumShort = csumShort[:12] + "..."
			}
			fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\n", s.Version, s.Name, s.State, appliedStr, csumShort)
		}
		_ = w.Flush()
		os.Exit(exitOK)

	case "verify":
		verifyCmd := flag.NewFlagSet("verify", flag.ExitOnError)
		dbURL := verifyCmd.String("db-url", defaultDatabaseURL, "PostgreSQL connection string")
		dir := verifyCmd.String("dir", defaultMigrationsDir, "Directory containing SQL migrations")
		_ = verifyCmd.Parse(os.Args[2:])

		migrator := NewMigrator(*dbURL, *dir)
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		if err := migrator.Verify(ctx); err != nil {
			log.Fatalf("VERIFICATION FAILED: %v", err)
		}
		fmt.Println("SUCCESS: Database schema is completely up to date and all checksums match.")
		os.Exit(exitOK)

	case "baseline":
		baseCmd := flag.NewFlagSet("baseline", flag.ExitOnError)
		dbURL := baseCmd.String("db-url", defaultDatabaseURL, "PostgreSQL connection string")
		dir := baseCmd.String("dir", defaultMigrationsDir, "Directory containing SQL migrations")
		version := baseCmd.String("version", "", "Target version to baseline up to (e.g. 068)")
		confirm := baseCmd.Bool("confirm", false, "Confirm applying baseline stamping to database")
		_ = baseCmd.Parse(os.Args[2:])

		if *version == "" {
			fmt.Println("ERROR: --version flag is required for baseline command.")
			printUsage()
			os.Exit(exitUsage)
		}

		migrator := NewMigrator(*dbURL, *dir)
		migrator.BaselineTo = *version

		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()

		conn, err := pgx.Connect(ctx, *dbURL)
		if err != nil {
			log.Fatalf("ERROR: connecting to database (%s): %v", SanitizeDBURL(*dbURL), err)
		}
		defer conn.Close(ctx)

		unlock, err := migrator.AcquireAdvisoryLock(ctx, conn)
		if err != nil {
			log.Fatalf("ERROR: %v", err)
		}
		defer unlock()

		if err := migrator.EnsureSchemaMigrationsTable(ctx, conn); err != nil {
			log.Fatalf("ERROR: %v", err)
		}

		report, err := migrator.VerifyBaseline(ctx, conn, *version)
		if err != nil {
			log.Fatalf("ERROR: verifying baseline %s: %v", *version, err)
		}

		fmt.Printf("=== BASELINE PREFLIGHT VERIFICATION (Target: %s) ===\n", *version)
		fmt.Printf("Total Checks: %d | Passed: %d | Failed: %d | IsEmpty: %v | IsMatch: %v\n\n",
			report.TotalChecks, report.PassedCount, report.FailedCount, report.IsEmpty, report.IsMatch)

		w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
		fmt.Fprintln(w, "CHECK\tTYPE\tSTATUS\tDETAILS")
		fmt.Fprintln(w, "-----\t----\t------\t-------")
		for _, c := range report.Checks {
			status := "PASS"
			if !c.Passed {
				status = "FAIL"
			}
			fmt.Fprintf(w, "%s\t%s\t%s\t%s\n", c.Name, c.Type, status, c.Details)
		}
		_ = w.Flush()
		fmt.Println("")

		if !report.IsMatch {
			fmt.Printf("ERROR: Database schema does not match baseline %s manifest (%d checks failed).\n", *version, report.FailedCount)
			fmt.Println("Operator cannot bypass failed schema verification. Baseline aborted.")
			os.Exit(exitFailure)
		}

		if !*confirm {
			fmt.Printf("Preflight verification PASSED. Database is 100%% verified as baseline %s.\n", *version)
			fmt.Println("To commit baseline stamping into schema_migrations, re-run with --confirm.")
			os.Exit(exitOK)
		}

		allMigrations, err := migrator.LoadMigrations()
		if err != nil {
			log.Fatalf("ERROR: loading migrations: %v", err)
		}

		if err := migrator.CheckAndApplyBaseline(ctx, conn, allMigrations); err != nil {
			log.Fatalf("ERROR: applying baseline: %v", err)
		}

		fmt.Printf("SUCCESS: Stamped baseline migrations through version %s in schema_migrations.\n", *version)
		os.Exit(exitOK)

	default:
		fmt.Printf("ERROR: Unknown command %q\n\n", command)
		printUsage()
		os.Exit(exitUsage)
	}
}
