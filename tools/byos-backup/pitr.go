package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

var (
	ErrNoSuitableBaseBackup = errors.New("pitr: no base backup found prior to recovery target timestamp")
	ErrRecoverySignalFailed = errors.New("pitr: failed to create recovery.signal in target directory")
)

// PITRTarget defines the target recovery parameters for PostgreSQL.
type PITRTarget struct {
	TargetTime   time.Time
	TargetName   string
	TargetLSN    string
	TargetAction string // "promote" or "pause"
	Inclusive    bool
}

// PITRRecoveryConfig encapsulates the parameters to prepare a recovery instance.
type PITRRecoveryConfig struct {
	BaseBackupKey string
	TargetDataDir string
	RestoreCmd    string
	Target        PITRTarget
}

// GeneratePostgresRecoveryConf writes recovery parameters into postgresql.auto.conf and creates recovery.signal.
func GeneratePostgresRecoveryConf(targetDir string, restoreCommand string, target PITRTarget) error {
	cleanDir, err := filepath.Abs(targetDir)
	if err != nil {
		return err
	}

	if err := os.MkdirAll(cleanDir, 0700); err != nil {
		return fmt.Errorf("ensuring target directory: %w", err)
	}

	// 1. Create recovery.signal file required by PostgreSQL 12+
	signalPath := filepath.Join(cleanDir, "recovery.signal")
	if err := os.WriteFile(signalPath, []byte(""), 0600); err != nil {
		return fmt.Errorf("%w: %v", ErrRecoverySignalFailed, err)
	}

	// 2. Format recovery settings for postgresql.auto.conf
	var sb strings.Builder
	sb.WriteString("\n# === BYOS Disaster Recovery / PITR Configuration ===\n")
	sb.WriteString(fmt.Sprintf("restore_command = '%s'\n", strings.ReplaceAll(restoreCommand, "'", "''")))

	if !target.TargetTime.IsZero() {
		sb.WriteString(fmt.Sprintf("recovery_target_time = '%s'\n", target.TargetTime.UTC().Format("2006-01-02 15:04:05 UTC")))
	} else if target.TargetName != "" {
		sb.WriteString(fmt.Sprintf("recovery_target_name = '%s'\n", target.TargetName))
	} else if target.TargetLSN != "" {
		sb.WriteString(fmt.Sprintf("recovery_target_lsn = '%s'\n", target.TargetLSN))
	}

	action := target.TargetAction
	if action == "" {
		action = "promote"
	}
	sb.WriteString(fmt.Sprintf("recovery_target_action = '%s'\n", action))

	inclusiveStr := "true"
	if !target.Inclusive {
		inclusiveStr = "false"
	}
	sb.WriteString(fmt.Sprintf("recovery_target_inclusive = '%s'\n", inclusiveStr))

	autoConfPath := filepath.Join(cleanDir, "postgresql.auto.conf")
	f, err := os.OpenFile(autoConfPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
	if err != nil {
		return fmt.Errorf("opening postgresql.auto.conf: %w", err)
	}
	defer f.Close()

	if _, err := f.WriteString(sb.String()); err != nil {
		return fmt.Errorf("writing recovery configuration: %w", err)
	}

	return nil
}

// SelectBaseBackupForPITR evaluates available base backups and selects the latest backup preceding targetTime.
func SelectBaseBackupForPITR(ctx context.Context, storage StorageDestination, kms KeyProvider, targetTime time.Time) (string, *PhysicalBackupManifest, error) {
	objects, err := storage.List(ctx, "backups/")
	if err != nil {
		return "", nil, fmt.Errorf("listing backups: %w", err)
	}

	type candidate struct {
		Key      string
		Manifest *PhysicalBackupManifest
	}
	var candidates []candidate

	activeKV, _ := kms.GetActiveKey(ctx)
	allKVs, _ := kms.ListKeyVersions(ctx)

	for _, obj := range objects {
		if strings.HasSuffix(obj.Key, ".enc") {
			encData, _, getErr := storage.Get(ctx, obj.Key)
			if getErr != nil {
				continue
			}

			// Try active key first, then historical keys
			manifest, _, _, decErr := ExtractBaseBackupPackage(encData, activeKV.Key)
			if decErr != nil {
				for _, kv := range allKVs {
					if kv.VersionID != activeKV.VersionID {
						m, _, _, err := ExtractBaseBackupPackage(encData, kv.Key)
						if err == nil {
							manifest = m
							decErr = nil
							break
						}
					}
				}
			}

			if decErr == nil && manifest != nil {
				// Candidate must have started before or at targetTime
				if targetTime.IsZero() || !manifest.StartTime.After(targetTime) {
					candidates = append(candidates, candidate{
						Key:      obj.Key,
						Manifest: manifest,
					})
				}
			}
		}
	}

	if len(candidates) == 0 {
		return "", nil, fmt.Errorf("%w: timestamp %s", ErrNoSuitableBaseBackup, targetTime.Format(time.RFC3339))
	}

	// Sort candidates descending by StartTime to choose the closest base backup
	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].Manifest.StartTime.After(candidates[j].Manifest.StartTime)
	})

	// Verify required WAL availability for chosen candidate
	for _, c := range candidates {
		_, err := VerifyBaseBackupCompleteness(ctx, storage, c.Key, kms)
		if err == nil {
			return c.Key, c.Manifest, nil
		}
	}

	return "", nil, fmt.Errorf("%w: candidates were incomplete or missing required WALs", ErrNoSuitableBaseBackup)
}
