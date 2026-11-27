package main

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// RecoveryHealthReport summarizes the complete disaster recovery posture.
type RecoveryHealthReport struct {
	Timestamp            time.Time         `json:"report_timestamp"`
	LatestBackupID       string            `json:"latest_backup_id"`
	LatestBackupTime     time.Time         `json:"latest_backup_time"`
	LatestBackupAge      time.Duration     `json:"latest_backup_age"`
	LatestWALName        string            `json:"latest_wal_name"`
	LatestWALTime        time.Time         `json:"latest_wal_time"`
	ArchiveLag           time.Duration     `json:"archive_lag"`
	TotalBaseBackups     int               `json:"total_base_backups"`
	TotalArchivedWALs    int               `json:"total_archived_wals"`
	EstimatedRPO         time.Duration     `json:"estimated_rpo"`
	RecoverableTimeRange string            `json:"recoverable_time_range"`
	KeyVersions          []string          `json:"key_versions_present"`
	Alerts               []string          `json:"alerts,omitempty"`
	Status               string            `json:"overall_status"` // "HEALTHY", "WARNING", "CRITICAL"
}

// GenerateRecoveryHealthReport evaluates the storage destination and KMS to produce a health report.
func GenerateRecoveryHealthReport(ctx context.Context, storage StorageDestination, kms KeyProvider) (*RecoveryHealthReport, error) {
	report := &RecoveryHealthReport{
		Timestamp: time.Now().UTC(),
		Status:    "HEALTHY",
	}

	// 1. Evaluate WAL stream status
	walStatus, err := GetWALArchiveStatus(ctx, storage)
	if err != nil {
		report.Alerts = append(report.Alerts, fmt.Sprintf("CRITICAL: Failed to inspect WAL archive: %v", err))
		report.Status = "CRITICAL"
	} else {
		report.TotalArchivedWALs = walStatus.TotalSegments
		report.LatestWALName = walStatus.NewestWAL
		report.LatestWALTime = walStatus.NewestTimestamp
		if !walStatus.NewestTimestamp.IsZero() {
			report.ArchiveLag = time.Since(walStatus.NewestTimestamp)
		}
		report.KeyVersions = walStatus.KeyVersions

		for _, gap := range walStatus.SequenceGaps {
			report.Alerts = append(report.Alerts, fmt.Sprintf("CRITICAL: WAL sequence gap: %s", gap))
			report.Status = "CRITICAL"
		}
	}

	// 2. Evaluate Base Backups
	backupObjects, err := storage.List(ctx, "backups/")
	if err != nil {
		report.Alerts = append(report.Alerts, fmt.Sprintf("CRITICAL: Failed to inspect base backups: %v", err))
		report.Status = "CRITICAL"
	} else {
		type baseCandidate struct {
			Key       string
			Timestamp time.Time
			Manifest  *PhysicalBackupManifest
		}
		var candidates []baseCandidate

		activeKV, _ := kms.GetActiveKey(ctx)
		allKVs, _ := kms.ListKeyVersions(ctx)

		for _, obj := range backupObjects {
			if strings.HasSuffix(obj.Key, ".enc") {
				encData, _, getErr := storage.Get(ctx, obj.Key)
				if getErr != nil {
					continue
				}

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
					candidates = append(candidates, baseCandidate{
						Key:       obj.Key,
						Timestamp: manifest.StartTime,
						Manifest:  manifest,
					})
				}
			}
		}

		report.TotalBaseBackups = len(candidates)
		if len(candidates) == 0 {
			report.Alerts = append(report.Alerts, "CRITICAL: Zero valid base backups found in storage destination!")
			report.Status = "CRITICAL"
		} else {
			// Find newest candidate
			newest := candidates[0]
			oldest := candidates[0]
			for _, c := range candidates {
				if c.Timestamp.After(newest.Timestamp) {
					newest = c
				}
				if c.Timestamp.Before(oldest.Timestamp) {
					oldest = c
				}
			}

			report.LatestBackupID = newest.Manifest.BackupID
			report.LatestBackupTime = newest.Timestamp
			report.LatestBackupAge = time.Since(newest.Timestamp)

			// Check completeness of newest base backup
			_, verifyErr := VerifyBaseBackupCompleteness(ctx, storage, newest.Key, kms)
			if verifyErr != nil {
				report.Alerts = append(report.Alerts, fmt.Sprintf("CRITICAL: Latest base backup %s is incomplete: %v", newest.Manifest.BackupID, verifyErr))
				report.Status = "CRITICAL"
			}

			if !report.LatestWALTime.IsZero() {
				report.RecoverableTimeRange = fmt.Sprintf("%s to %s", oldest.Timestamp.Format("2006-01-02 15:04:05 UTC"), report.LatestWALTime.Format("2006-01-02 15:04:05 UTC"))
			} else {
				report.RecoverableTimeRange = fmt.Sprintf("%s (base backup only; no WAL archived)", oldest.Timestamp.Format("2006-01-02 15:04:05 UTC"))
			}
		}
	}

	// 3. Evaluate RPO SLA (< 15 minutes)
	if report.LatestWALTime.IsZero() {
		report.EstimatedRPO = report.LatestBackupAge
		if report.Status != "CRITICAL" {
			report.Alerts = append(report.Alerts, "WARNING: Continuous WAL archiving has not recorded any archived segments; RPO bounded by snapshot age")
			report.Status = "WARNING"
		}
	} else {
		report.EstimatedRPO = report.ArchiveLag
		if report.ArchiveLag > 15*time.Minute {
			if report.Status != "CRITICAL" {
				report.Alerts = append(report.Alerts, fmt.Sprintf("WARNING: Archive lag (%s) exceeds 15-minute RPO target", report.ArchiveLag.Round(time.Second)))
				report.Status = "WARNING"
			}
		}
	}

	return report, nil
}
