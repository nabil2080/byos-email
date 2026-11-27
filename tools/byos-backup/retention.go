package main

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

var (
	// Regex matching standard backup filenames: byos_backup_YYYYMMDD_HHMMSS.enc or .dump
	backupFileRegex = regexp.MustCompile(`^byos_backup_(\d{8})_(\d{6})\.(enc|dump)$`)
)

// BackupFile represents an existing backup artifact on disk.
type BackupFile struct {
	Path        string
	Filename    string
	Timestamp   time.Time
	IsEncrypted bool
	SizeBytes   int64
}

// RetentionPolicy defines the retention horizons for backup pruning.
type RetentionPolicy struct {
	DailyDays     int // Keep daily backups for N days (default 7)
	WeeklyWeeks   int // Keep weekly backups for N weeks (default 4)
	MonthlyMonths int // Keep monthly backups for N months (default 12)
}

// DefaultRetentionPolicy returns the standard enterprise production retention policy.
func DefaultRetentionPolicy() RetentionPolicy {
	return RetentionPolicy{
		DailyDays:     7,
		WeeklyWeeks:   4,
		MonthlyMonths: 12,
	}
}

// ParseBackupTimestamp parses YYYYMMDD and HHMMSS from a filename.
func ParseBackupTimestamp(dateStr, timeStr string) (time.Time, error) {
	return time.Parse("20060102_150405", fmt.Sprintf("%s_%s", dateStr, timeStr))
}

// ScanBackups searches a directory for recognized BYOS backup artifacts.
func ScanBackups(backupDir string) ([]BackupFile, error) {
	entries, err := os.ReadDir(backupDir)
	if err != nil {
		return nil, fmt.Errorf("reading backup directory %q: %w", backupDir, err)
	}

	var backups []BackupFile
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		filename := entry.Name()
		matches := backupFileRegex.FindStringSubmatch(filename)
		if matches == nil {
			continue
		}

		ts, err := ParseBackupTimestamp(matches[1], matches[2])
		if err != nil {
			continue
		}

		info, err := entry.Info()
		if err != nil {
			continue
		}

		backups = append(backups, BackupFile{
			Path:        filepath.Join(backupDir, filename),
			Filename:    filename,
			Timestamp:   ts.UTC(),
			IsEncrypted: strings.HasSuffix(filename, ".enc"),
			SizeBytes:   info.Size(),
		})
	}

	// Sort newest first
	sort.Slice(backups, func(i, j int) bool {
		return backups[i].Timestamp.After(backups[j].Timestamp)
	})

	return backups, nil
}

// EvaluateRetention evaluates which backups to retain and which to prune.
//
// CRITICAL RESILIENCE INVARIANTS:
// 1. If total backups <= 1, NEVER prune anything (protects lone surviving backup).
// 2. The newest known-good backup is ALWAYS kept, even if older than all retention windows.
// 3. No pruning occurs if evaluation produces zero kept backups.
func EvaluateRetention(backups []BackupFile, now time.Time, policy RetentionPolicy) (keep []BackupFile, prune []BackupFile) {
	if len(backups) == 0 {
		return nil, nil
	}

	// Invariant 1: If only one backup exists, never delete it regardless of age
	if len(backups) == 1 {
		return backups, nil
	}

	now = now.UTC()
	keepMap := make(map[string]BackupFile)

	// Invariant 2: Always retain the absolute latest backup
	newest := backups[0]
	keepMap[newest.Path] = newest

	dailyCutoff := now.AddDate(0, 0, -policy.DailyDays)
	weeklyCutoff := now.AddDate(0, 0, -policy.WeeklyWeeks*7)
	monthlyCutoff := now.AddDate(0, -policy.MonthlyMonths, 0)

	// Track weekly buckets (ISO Year + Week number)
	weeklyBuckets := make(map[string]bool)
	// Track monthly buckets (YYYY-MM)
	monthlyBuckets := make(map[string]bool)

	for _, b := range backups {
		// Tier 1: Daily horizon (keep all backups within DailyDays)
		if b.Timestamp.After(dailyCutoff) {
			keepMap[b.Path] = b
			continue
		}

		// Tier 2: Weekly horizon (keep 1 backup per week within WeeklyWeeks)
		if b.Timestamp.After(weeklyCutoff) {
			year, week := b.Timestamp.ISOWeek()
			weekKey := fmt.Sprintf("%04d-W%02d", year, week)
			if !weeklyBuckets[weekKey] {
				weeklyBuckets[weekKey] = true
				keepMap[b.Path] = b
			}
			continue
		}

		// Tier 3: Monthly horizon (keep 1 backup per month within MonthlyMonths)
		if b.Timestamp.After(monthlyCutoff) {
			monthKey := b.Timestamp.Format("2006-01")
			if !monthlyBuckets[monthKey] {
				monthlyBuckets[monthKey] = true
				keepMap[b.Path] = b
			}
			continue
		}
	}

	// Populate keep and prune slices
	for _, b := range backups {
		if _, ok := keepMap[b.Path]; ok {
			keep = append(keep, b)
		} else {
			prune = append(prune, b)
		}
	}

	// Invariant 3: Safety valve - if keep is somehow empty, keep the newest backup
	if len(keep) == 0 && len(backups) > 0 {
		keep = append(keep, backups[0])
		if len(prune) > 0 && prune[0].Path == backups[0].Path {
			prune = prune[1:]
		}
	}

	return keep, prune
}

// PruneBackups executes backup retention pruning on disk.
func PruneBackups(backupDir string, policy RetentionPolicy, dryRun bool) ([]BackupFile, []BackupFile, error) {
	backups, err := ScanBackups(backupDir)
	if err != nil {
		return nil, nil, err
	}

	keep, prune := EvaluateRetention(backups, time.Now().UTC(), policy)

	if !dryRun {
		for _, b := range prune {
			if err := os.Remove(b.Path); err != nil {
				return keep, prune, fmt.Errorf("deleting expired backup %q: %w", b.Path, err)
			}
		}
	}

	return keep, prune, nil
}

// EvaluateWALRetention evaluates which WAL segments must be retained to ensure PITR
// recoverability for all retained base backups.
//
// CRITICAL INVARIANT:
// A WAL segment is NEVER pruned if its timeline and segment number is >= the StartWAL
// of the oldest retained base backup. All .history files are unconditionally retained.
func EvaluateWALRetention(walObjects []string, oldestRetainedStartWAL string) (keep []string, prune []string) {
	if len(walObjects) == 0 {
		return nil, nil
	}

	// If no valid base backup is retained or specified, keep ALL WAL files (protects recoverability)
	if oldestRetainedStartWAL == "" {
		return walObjects, nil
	}

	reqTL, reqSeg, _, err := ParseWALFilename(oldestRetainedStartWAL)
	if err != nil {
		// If cannot parse start WAL, fail closed and keep all WALs
		return walObjects, nil
	}

	for _, obj := range walObjects {
		walName := filepath.Base(obj)
		walName = strings.TrimSuffix(walName, ".enc")
		walName = strings.TrimSuffix(walName, ".meta.json")

		tl, seg, isHist, pErr := ParseWALFilename(walName)
		if pErr != nil {
			// Unrecognized filename: keep for safety
			keep = append(keep, obj)
			continue
		}

		// Invariant: Always retain timeline history files
		if isHist {
			keep = append(keep, obj)
			continue
		}

		// If segment belongs to a newer timeline, keep it
		if tl > reqTL {
			keep = append(keep, obj)
			continue
		}

		// If segment belongs to an older timeline, it might be pruned only if <= reqTL
		if tl < reqTL {
			prune = append(prune, obj)
			continue
		}

		// Same timeline: keep if segment >= reqSeg
		if seg >= reqSeg {
			keep = append(keep, obj)
		} else {
			prune = append(prune, obj)
		}
	}

	return keep, prune
}

