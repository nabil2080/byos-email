package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	remoteCatalogKey     = "catalog/recovery_catalog.json"
	maxCatalogCASRetries = 5
)

// RecoveryCatalogEntry records a single remotely replicated physical base backup and its full dependency set.
type RecoveryCatalogEntry struct {
	BackupID             string    `json:"backup_id"`
	DatabaseSystemID     string    `json:"database_system_id"`
	ServerVersion        string    `json:"server_version"`
	StartTime            time.Time `json:"start_time"`
	StopTime             time.Time `json:"stop_time"`
	StartLSN             string    `json:"start_lsn"`
	StopLSN              string    `json:"stop_lsn"`
	TimelineID           uint32    `json:"timeline_id"`
	RequiredWALs         []string  `json:"required_wals"`
	RequiredHistoryFiles []string  `json:"required_history_files,omitempty"`
	BackupHistoryFile    string    `json:"backup_history_file,omitempty"`
	EncryptionAlgorithm  string    `json:"encryption_algorithm"`
	KeyVersionID         string    `json:"key_version_id"`
	BaseBackupObjectKey  string    `json:"base_backup_object_key"`
	ManifestObjectKey    string    `json:"manifest_object_key"`
	BaseBackupSizeBytes  int64     `json:"base_backup_size_bytes"`
	CiphertextSHA256     string    `json:"ciphertext_sha256"`
	PlaintextSHA256      string    `json:"plaintext_sha256"`
	CompletedAt          time.Time `json:"completed_at"`
	Status               string    `json:"status"` // "completed"
}

// RecoveryCatalog is the machine-readable catalog committed last after atomic dependency upload.
type RecoveryCatalog struct {
	CatalogVersion int                    `json:"catalog_version"`
	UpdatedAt      time.Time              `json:"updated_at"`
	Entries        []RecoveryCatalogEntry `json:"entries"`
}

// RemoteHealthReport summarizes remote storage connectivity, replication lag, and dependency completeness.
type RemoteHealthReport struct {
	Timestamp             time.Time     `json:"report_timestamp"`
	Endpoint              string        `json:"endpoint"`
	Bucket                string        `json:"bucket"`
	Prefix                string        `json:"prefix"`
	Connected             bool          `json:"connected"`
	TotalRemoteWALs       int           `json:"total_remote_wals"`
	TotalRemoteHistory    int           `json:"total_remote_history"`
	LatestRemoteWAL       string        `json:"latest_remote_wal"`
	LatestRemoteWALTime   time.Time     `json:"latest_remote_wal_time"`
	RemoteLag             time.Duration `json:"remote_lag"`
	PendingLocalObjects   int           `json:"pending_local_objects"`
	PendingLocalBytes     int64         `json:"pending_local_bytes"`
	CompleteRemoteBackups int           `json:"complete_remote_backups"`
	OldestRecoveryPoint   string        `json:"oldest_recovery_point"`
	KeyVersionsAvailable  []string      `json:"key_versions_available"`
	RemoteSequenceGaps    []string      `json:"remote_sequence_gaps,omitempty"`
	Alerts                []string      `json:"alerts,omitempty"`
	Status                string        `json:"status"` // "HEALTHY", "WARNING", "CRITICAL"
}

// SyncSummary captures the result of synchronizing local encrypted archive artifacts to remote storage.
type SyncSummary struct {
	UploadedObjects int      `json:"uploaded_objects"`
	AlreadySynced   int      `json:"already_synced"`
	FailedObjects   int      `json:"failed_objects"`
	BytesUploaded   int64    `json:"bytes_uploaded"`
	Errors          []string `json:"errors,omitempty"`
}

// LoadRemoteCatalog fetches the recovery catalog from remote storage (returning empty catalog if none exists yet).
func LoadRemoteCatalog(ctx context.Context, remote StorageDestination) (*RecoveryCatalog, error) {
	cat, _, err := LoadRemoteCatalogWithETag(ctx, remote)
	return cat, err
}

// LoadRemoteCatalogWithETag fetches the recovery catalog and its version ETag (empty string if not yet created).
func LoadRemoteCatalogWithETag(ctx context.Context, remote StorageDestination) (*RecoveryCatalog, string, error) {
	var data []byte
	var etag string
	var err error
	if c, ok := remote.(ConditionalMutableStorageDestination); ok {
		data, _, etag, err = c.GetWithETag(ctx, remoteCatalogKey)
	} else {
		data, _, err = remote.Get(ctx, remoteCatalogKey)
	}
	if err != nil {
		if errors.Is(err, ErrObjectNotFound) {
			return &RecoveryCatalog{CatalogVersion: 1, Entries: []RecoveryCatalogEntry{}}, "", nil
		}
		return nil, "", err
	}
	var cat RecoveryCatalog
	if err := json.Unmarshal(data, &cat); err != nil {
		return nil, "", fmt.Errorf("parsing remote recovery catalog: %w", err)
	}
	return &cat, etag, nil
}

// SaveRemoteCatalog writes the updated recovery catalog atomically without delete-before-put.
func SaveRemoteCatalog(ctx context.Context, remote StorageDestination, cat *RecoveryCatalog) error {
	cat.CatalogVersion = 1
	cat.UpdatedAt = time.Now().UTC()
	raw, err := json.MarshalIndent(cat, "", "  ")
	if err != nil {
		return err
	}
	return putMutableManifest(ctx, remote, remoteCatalogKey, raw, map[string]string{
		"byos-catalog-version": "1",
	})
}

// SaveRemoteCatalogCAS writes the updated recovery catalog using an ETag precondition (If-Match / If-None-Match).
func SaveRemoteCatalogCAS(ctx context.Context, remote StorageDestination, cat *RecoveryCatalog, expectedETag string) error {
	cat.CatalogVersion = 1
	cat.UpdatedAt = time.Now().UTC()
	raw, err := json.MarshalIndent(cat, "", "  ")
	if err != nil {
		return err
	}
	return putMutableManifestCAS(ctx, remote, remoteCatalogKey, raw, map[string]string{
		"byos-catalog-version": "1",
	}, expectedETag)
}

func putLargeOrBytes(ctx context.Context, dest StorageDestination, key string, filePath string, meta map[string]string) (string, int64, error) {
	if s3Dest, ok := dest.(*S3Storage); ok {
		return s3Dest.PutFile(ctx, key, filePath, meta)
	}
	data, err := os.ReadFile(filePath)
	if err != nil {
		return "", 0, err
	}
	sum := sha256.Sum256(data)
	sumHex := hex.EncodeToString(sum[:])
	if meta == nil {
		meta = map[string]string{}
	}
	meta[s3MetaSHA256Key] = sumHex
	err = dest.Put(ctx, key, data, meta)
	return sumHex, int64(len(data)), err
}

// PublishBackupToRemote executes the 7-step atomic completion protocol for a physical base backup.
func PublishBackupToRemote(
	ctx context.Context,
	local StorageDestination,
	remote StorageDestination,
	kms KeyProvider,
	entry RecoveryCatalogEntry,
	encBaseBackupFile string,
	manifestFile string,
) (*RecoveryCatalogEntry, error) {
	// 1. Ensure required key version is available prior to publishing.
	if kms != nil {
		if _, err := kms.GetKeyVersion(ctx, entry.KeyVersionID); err != nil {
			return nil, fmt.Errorf("required key version %q unavailable: %w", entry.KeyVersionID, err)
		}
	}

	// 2. Upload encrypted base backup first.
	baseKey := fmt.Sprintf("backups/%s/base.tar.enc", entry.BackupID)
	cipherHex, sizeBytes, err := putLargeOrBytes(ctx, remote, baseKey, encBaseBackupFile, map[string]string{
		"byos-backup-id":   entry.BackupID,
		"byos-key-version": entry.KeyVersionID,
	})
	if err != nil {
		return nil, fmt.Errorf("uploading encrypted base backup: %w", err)
	}

	// 3. Upload backup_manifest if provided.
	manifestKey := ""
	if manifestFile != "" {
		manifestKey = fmt.Sprintf("backups/%s/backup_manifest", entry.BackupID)
		if _, _, err := putLargeOrBytes(ctx, remote, manifestKey, manifestFile, map[string]string{
			"byos-backup-id": entry.BackupID,
		}); err != nil {
			return nil, fmt.Errorf("uploading backup_manifest: %w", err)
		}
	}

	// 4. Upload all required WAL segments, .backup history, and .history files from local archive.
	for _, walName := range entry.RequiredWALs {
		for _, suffix := range []string{".enc", ".meta.json"} {
			objKey := "wal/" + walName + suffix
			data, _, getErr := local.Get(ctx, objKey)
			if getErr != nil {
				return nil, fmt.Errorf("reading local WAL dependency %s: %w", objKey, getErr)
			}
			if putErr := remote.Put(ctx, objKey, data, nil); putErr != nil {
				return nil, fmt.Errorf("uploading WAL dependency %s: %w", objKey, putErr)
			}
		}
	}
	if entry.BackupHistoryFile != "" {
		for _, suffix := range []string{".enc", ".meta.json"} {
			objKey := "wal/" + entry.BackupHistoryFile + suffix
			data, _, getErr := local.Get(ctx, objKey)
			if getErr == nil {
				if putErr := remote.Put(ctx, objKey, data, nil); putErr != nil {
					return nil, fmt.Errorf("uploading backup history %s: %w", objKey, putErr)
				}
			}
		}
	}
	for _, histFile := range entry.RequiredHistoryFiles {
		for _, suffix := range []string{".enc", ".meta.json"} {
			objKey := "wal/" + histFile + suffix
			data, _, getErr := local.Get(ctx, objKey)
			if getErr != nil {
				return nil, fmt.Errorf("reading local history dependency %s: %w", objKey, getErr)
			}
			if putErr := remote.Put(ctx, objKey, data, nil); putErr != nil {
				return nil, fmt.Errorf("uploading history dependency %s: %w", objKey, putErr)
			}
		}
	}

	// 5. Populate completed entry fields.
	entry.BaseBackupObjectKey = baseKey
	entry.ManifestObjectKey = manifestKey
	entry.BaseBackupSizeBytes = sizeBytes
	entry.CiphertextSHA256 = cipherHex
	entry.CompletedAt = time.Now().UTC()
	entry.Status = "completed"

	// 6. Verify every remote dependency before committing catalog.
	if err := VerifyRemoteRecoveryPoint(ctx, remote, kms, entry); err != nil {
		return nil, fmt.Errorf("pre-commit remote dependency verification failed: %w", err)
	}

	// 7. Commit catalog last using optimistic concurrency control (reload-merge-retry on 409/412).
	for attempt := 0; attempt < maxCatalogCASRetries; attempt++ {
		cat, etag, err := LoadRemoteCatalogWithETag(ctx, remote)
		if err != nil {
			return nil, err
		}
		replaced := false
		for i := range cat.Entries {
			if cat.Entries[i].BackupID == entry.BackupID {
				cat.Entries[i] = entry
				replaced = true
				break
			}
		}
		if !replaced {
			cat.Entries = append(cat.Entries, entry)
		}
		err = SaveRemoteCatalogCAS(ctx, remote, cat, etag)
		if err == nil {
			return &entry, nil
		}
		if !errors.Is(err, ErrPreconditionFailed) {
			// ErrObjectNotFound during PutIfMatch means the object was deleted by a concurrent
			// writer (e.g. a delete marker was inserted). Fail closed rather than creating a new
			// catalog from scratch under a potentially wrong state.
			if errors.Is(err, ErrObjectNotFound) {
				return nil, fmt.Errorf("committing recovery catalog: object disappeared during CAS (possible concurrent delete marker): %w", err)
			}
			return nil, fmt.Errorf("committing recovery catalog: %w", err)
		}
		// ErrPreconditionFailed: another writer committed first; reload and retry.
	}
	return nil, fmt.Errorf("committing recovery catalog: %w (exceeded %d CAS retries)", ErrPreconditionFailed, maxCatalogCASRetries)
}

// VerifyRemoteRecoveryPoint verifies all remote objects, checksums, and key availability for a catalog entry.
func VerifyRemoteRecoveryPoint(ctx context.Context, remote StorageDestination, kms KeyProvider, entry RecoveryCatalogEntry) error {
	if entry.Status != "completed" {
		return fmt.Errorf("backup %s status is %q (incomplete)", entry.BackupID, entry.Status)
	}
	if kms != nil {
		if _, err := kms.GetKeyVersion(ctx, entry.KeyVersionID); err != nil {
			return fmt.Errorf("key version %q missing or revoked: %w", entry.KeyVersionID, err)
		}
	}

	info, err := remote.GetInfo(ctx, entry.BaseBackupObjectKey)
	if err != nil {
		return fmt.Errorf("base backup object %s unavailable: %w", entry.BaseBackupObjectKey, err)
	}
	if entry.BaseBackupSizeBytes > 0 && info.SizeBytes != entry.BaseBackupSizeBytes {
		return fmt.Errorf("base backup size mismatch on %s: expected %d, got %d", entry.BaseBackupObjectKey, entry.BaseBackupSizeBytes, info.SizeBytes)
	}
	if entry.CiphertextSHA256 != "" && info.SHA256Hex != "" && info.SHA256Hex != entry.CiphertextSHA256 {
		return fmt.Errorf("base backup checksum mismatch on %s", entry.BaseBackupObjectKey)
	}

	if entry.ManifestObjectKey != "" {
		ok, err := remote.Exists(ctx, entry.ManifestObjectKey)
		if err != nil || !ok {
			return fmt.Errorf("manifest object %s missing on remote", entry.ManifestObjectKey)
		}
	}

	for _, walName := range entry.RequiredWALs {
		for _, suffix := range []string{".enc", ".meta.json"} {
			k := "wal/" + walName + suffix
			ok, err := remote.Exists(ctx, k)
			if err != nil || !ok {
				return fmt.Errorf("required WAL object %s missing on remote", k)
			}
		}
		metaBytes, _, err := remote.Get(ctx, "wal/"+walName+".meta.json")
		if err != nil {
			return fmt.Errorf("reading remote metadata %s: %w", walName, err)
		}
		var meta WALMetadata
		if err := json.Unmarshal(metaBytes, &meta); err != nil {
			return fmt.Errorf("invalid WAL metadata %s: %w", walName, err)
		}
		if kms != nil && meta.KeyVersion != "" {
			if _, err := kms.GetKeyVersion(ctx, meta.KeyVersion); err != nil {
				return fmt.Errorf("WAL %s requires unavailable key version %q: %w", walName, meta.KeyVersion, err)
			}
		}
	}

	for _, hist := range entry.RequiredHistoryFiles {
		k := "wal/" + hist + ".enc"
		ok, err := remote.Exists(ctx, k)
		if err != nil || !ok {
			return fmt.Errorf("required history file %s missing on remote", k)
		}
	}
	if entry.BackupHistoryFile != "" {
		k := "wal/" + entry.BackupHistoryFile + ".enc"
		ok, err := remote.Exists(ctx, k)
		if err != nil || !ok {
			return fmt.Errorf("required backup history file %s missing on remote", k)
		}
	}
	return nil
}

// SyncLocalToRemote uploads any missing local WAL/history/metadata objects to remote idempotently.
// It NEVER deletes local files.
func SyncLocalToRemote(ctx context.Context, local StorageDestination, remote StorageDestination) (*SyncSummary, error) {
	summary := &SyncSummary{}
	localObjs, err := local.List(ctx, "wal/")
	if err != nil {
		return summary, fmt.Errorf("listing local wal objects: %w", err)
	}
	sort.Slice(localObjs, func(i, j int) bool { return localObjs[i].Key < localObjs[j].Key })

	remoteObjs, err := remote.List(ctx, "wal/")
	if err != nil {
		return summary, fmt.Errorf("listing remote wal objects: %w", err)
	}
	remoteMap := make(map[string]ObjectInfo, len(remoteObjs))
	for _, ro := range remoteObjs {
		remoteMap[ro.Key] = ro
	}

	for _, lo := range localObjs {
		if ro, exists := remoteMap[lo.Key]; exists {
			if ro.SHA256Hex == lo.SHA256Hex && ro.SizeBytes == lo.SizeBytes {
				summary.AlreadySynced++
				continue
			}
		}
		data, _, getErr := local.Get(ctx, lo.Key)
		if getErr != nil {
			summary.FailedObjects++
			summary.Errors = append(summary.Errors, fmt.Sprintf("%s: %v", lo.Key, getErr))
			continue
		}
		if putErr := remote.Put(ctx, lo.Key, data, map[string]string{s3MetaSHA256Key: lo.SHA256Hex}); putErr != nil {
			summary.FailedObjects++
			summary.Errors = append(summary.Errors, fmt.Sprintf("%s: %v", lo.Key, putErr))
			continue
		}
		summary.UploadedObjects++
		summary.BytesUploaded += int64(len(data))
	}
	return summary, nil
}

// GetRemoteStatus inspects connectivity, lag, pending local objects, catalog completeness, and key availability.
func GetRemoteStatus(ctx context.Context, local StorageDestination, remote StorageDestination, kms KeyProvider, cfg RemoteStorageConfig, rpoTarget time.Duration) *RemoteHealthReport {
	rep := &RemoteHealthReport{
		Timestamp: time.Now().UTC(),
		Endpoint:  cfg.Endpoint,
		Bucket:    cfg.Bucket,
		Prefix:    cfg.Prefix,
		Status:    "HEALTHY",
	}
	if rpoTarget <= 0 {
		rpoTarget = 15 * time.Minute
	}

	if s3r, ok := remote.(*S3Storage); ok {
		if err := s3r.CheckConnectivity(ctx); err != nil {
			rep.Connected = false
			rep.Status = "CRITICAL"
			rep.Alerts = append(rep.Alerts, fmt.Sprintf("CRITICAL: Remote destination unreachable: %v", err))
			return rep
		}
	}
	rep.Connected = true

	walStatus, err := GetWALArchiveStatus(ctx, remote)
	if err != nil {
		rep.Status = "CRITICAL"
		rep.Alerts = append(rep.Alerts, fmt.Sprintf("CRITICAL: Failed to inspect remote WAL archive: %v", err))
	} else {
		rep.TotalRemoteWALs = walStatus.TotalSegments
		rep.TotalRemoteHistory = walStatus.TotalHistory
		rep.LatestRemoteWAL = walStatus.NewestWAL
		rep.LatestRemoteWALTime = walStatus.NewestTimestamp
		if !walStatus.NewestTimestamp.IsZero() {
			rep.RemoteLag = time.Since(walStatus.NewestTimestamp)
			if rep.RemoteLag > rpoTarget {
				rep.Status = "CRITICAL"
				rep.Alerts = append(rep.Alerts, fmt.Sprintf("CRITICAL: Remote WAL lag %s exceeds RPO target %s", rep.RemoteLag.Round(time.Second), rpoTarget))
			}
		}
		rep.RemoteSequenceGaps = walStatus.SequenceGaps
		if len(walStatus.SequenceGaps) > 0 {
			rep.Status = "CRITICAL"
			for _, g := range walStatus.SequenceGaps {
				rep.Alerts = append(rep.Alerts, fmt.Sprintf("CRITICAL: Remote WAL sequence gap: %s", g))
			}
		}
	}

	if local != nil {
		localObjs, lErr := local.List(ctx, "wal/")
		remoteObjs, rErr := remote.List(ctx, "wal/")
		if lErr == nil && rErr == nil {
			rSet := make(map[string]ObjectInfo, len(remoteObjs))
			for _, ro := range remoteObjs {
				rSet[ro.Key] = ro
			}
			for _, lo := range localObjs {
				if ro, ok := rSet[lo.Key]; !ok || ro.SizeBytes != lo.SizeBytes {
					rep.PendingLocalObjects++
					rep.PendingLocalBytes += lo.SizeBytes
				}
			}
			if rep.PendingLocalObjects > 0 && rep.Status == "HEALTHY" {
				rep.Status = "WARNING"
				rep.Alerts = append(rep.Alerts, fmt.Sprintf("WARNING: %d local archive objects (%d bytes) pending remote upload", rep.PendingLocalObjects, rep.PendingLocalBytes))
			}
		}
	}

	if kms != nil {
		kvs, kErr := kms.ListKeyVersions(ctx)
		if kErr == nil {
			for _, kv := range kvs {
				if kv.Status != "revoked" {
					rep.KeyVersionsAvailable = append(rep.KeyVersionsAvailable, kv.VersionID)
				}
			}
			sort.Strings(rep.KeyVersionsAvailable)
		}
	}

	cat, err := LoadRemoteCatalog(ctx, remote)
	if err != nil {
		rep.Status = "CRITICAL"
		rep.Alerts = append(rep.Alerts, fmt.Sprintf("CRITICAL: Failed to load remote recovery catalog: %v", err))
		return rep
	}

	var oldestTime time.Time
	for _, entry := range cat.Entries {
		if err := VerifyRemoteRecoveryPoint(ctx, remote, kms, entry); err != nil {
			rep.Status = "CRITICAL"
			rep.Alerts = append(rep.Alerts, fmt.Sprintf("CRITICAL: Remote backup %s dependency verification failed: %v", entry.BackupID, err))
			continue
		}
		rep.CompleteRemoteBackups++
		if oldestTime.IsZero() || entry.StartTime.Before(oldestTime) {
			oldestTime = entry.StartTime
			rep.OldestRecoveryPoint = entry.BackupID
		}
	}

	if rep.CompleteRemoteBackups == 0 {
		rep.Status = "CRITICAL"
		rep.Alerts = append(rep.Alerts, "CRITICAL: Zero complete verified remote physical base backups exist!")
	}
	return rep
}

// PruneRemoteBackups performs dependency-aware remote pruning (dry-run by default).
// It never deletes WAL segments or history files required by any retained recovery catalog entry.
func PruneRemoteBackups(ctx context.Context, remote StorageDestination, kms KeyProvider, policy RetentionPolicy, dryRun bool, auditLogPath string) ([]string, error) {
	cat, err := LoadRemoteCatalog(ctx, remote)
	if err != nil {
		return nil, err
	}
	if len(cat.Entries) <= 1 {
		// Last-known-good protection: never prune the sole surviving recovery point.
		return nil, nil
	}

	var recs []BackupFile
	for _, e := range cat.Entries {
		recs = append(recs, BackupFile{
			Path:      e.BackupID,
			Filename:  e.BackupID,
			Timestamp: e.StartTime,
		})
	}
	sort.Slice(recs, func(i, j int) bool {
		return recs[i].Timestamp.After(recs[j].Timestamp)
	})
	keepList, _ := EvaluateRetention(recs, time.Now().UTC(), policy)
	keepSet := make(map[string]bool, len(keepList))
	for _, k := range keepList {
		keepSet[k.Filename] = true
	}

	// Verify that at least one retained backup passes full dependency & key verification before deleting anything.
	verifiedKeep := 0
	protectedWALs := make(map[string]bool)
	var keptEntries []RecoveryCatalogEntry
	for _, e := range cat.Entries {
		if keepSet[e.BackupID] {
			if err := VerifyRemoteRecoveryPoint(ctx, remote, kms, e); err == nil {
				verifiedKeep++
			}
			keptEntries = append(keptEntries, e)
			for _, w := range e.RequiredWALs {
				protectedWALs[w] = true
			}
			if e.BackupHistoryFile != "" {
				protectedWALs[e.BackupHistoryFile] = true
			}
			for _, h := range e.RequiredHistoryFiles {
				protectedWALs[h] = true
			}
		}
	}
	if verifiedKeep == 0 {
		return nil, errors.New("prune aborted: zero retained remote recovery points passed verification")
	}

	var deleted []string
	var auditLines []string
	for _, e := range cat.Entries {
		if keepSet[e.BackupID] {
			continue
		}
		for _, key := range []string{e.BaseBackupObjectKey, e.ManifestObjectKey} {
			if key == "" {
				continue
			}
			deleted = append(deleted, key)
			if !dryRun {
				if err := remote.Delete(ctx, key); err != nil {
					return deleted, fmt.Errorf("deleting remote object %s: %w", key, err)
				}
				auditLines = append(auditLines, fmt.Sprintf("%s DELETE backup=%s key=%s", time.Now().UTC().Format(time.RFC3339), e.BackupID, key))
			}
		}
	}

	// Prune obsolete WALs that are NOT protected by any retained backup and strictly older than oldest retained WAL.
	walObjs, err := remote.List(ctx, "wal/")
	if err == nil && len(keptEntries) > 0 {
		for _, obj := range walObjs {
			base := filepath.Base(obj.Key)
			walName := strings.TrimSuffix(strings.TrimSuffix(base, ".enc"), ".meta.json")
			if protectedWALs[walName] || strings.HasSuffix(walName, ".history") || strings.HasSuffix(walName, ".backup") {
				continue
			}
			// Only prune if strictly older than oldest kept backup's StartTime.
			oldestKeep := keptEntries[0].StartTime
			for _, ke := range keptEntries {
				if ke.StartTime.Before(oldestKeep) {
					oldestKeep = ke.StartTime
				}
			}
			if !obj.LastModified.IsZero() && obj.LastModified.Before(oldestKeep) {
				deleted = append(deleted, obj.Key)
				if !dryRun {
					if err := remote.Delete(ctx, obj.Key); err != nil {
						return deleted, fmt.Errorf("deleting obsolete remote WAL %s: %w", obj.Key, err)
					}
					auditLines = append(auditLines, fmt.Sprintf("%s DELETE obsolete_wal key=%s", time.Now().UTC().Format(time.RFC3339), obj.Key))
				}
			}
		}
	}

	if !dryRun {
		cat, etag, loadErr := LoadRemoteCatalogWithETag(ctx, remote)
		if loadErr != nil {
			return deleted, fmt.Errorf("reloading catalog for prune commit: %w", loadErr)
		}
		prunedIDs := make(map[string]bool)
		for _, e := range cat.Entries {
			if !keepSet[e.BackupID] {
				prunedIDs[e.BackupID] = true
			}
		}
		var merged []RecoveryCatalogEntry
		for _, e := range cat.Entries {
			if !prunedIDs[e.BackupID] {
				merged = append(merged, e)
			}
		}
		cat.Entries = merged
		if err := SaveRemoteCatalogCAS(ctx, remote, cat, etag); err != nil {
			return deleted, fmt.Errorf("updating catalog after prune: %w", err)
		}
		if auditLogPath != "" && len(auditLines) > 0 {
			_ = os.MkdirAll(filepath.Dir(auditLogPath), 0750)
			f, err := os.OpenFile(auditLogPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0640)
			if err == nil {
				_, _ = f.WriteString(strings.Join(auditLines, "\n") + "\n")
				_ = f.Close()
			}
		}
	}
	return deleted, nil
}
