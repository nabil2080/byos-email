package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"time"

	"github.com/jackc/pgx/v5"
)

var (
	ErrIncompleteWALRange      = errors.New("basebackup: required WAL range is not completely present in archive")
	ErrBaseBackupCorrupted     = errors.New("basebackup: base backup bundle checksum or decryption failed")
	ErrInvalidManifestVersion  = errors.New("basebackup: unsupported manifest format version")
)

// PhysicalBackupManifest is the machine-readable manifest accompanying an encrypted base backup.
type PhysicalBackupManifest struct {
	ManifestVersion     int       `json:"manifest_version"` // 2
	BackupID            string    `json:"backup_id"`
	DatabaseSystemID    string    `json:"database_system_id"`
	ServerVersion       string    `json:"server_version"`
	BackupMethod        string    `json:"backup_method"` // "pg_backup_api" or "pg_basebackup"
	BackupFormat        string    `json:"backup_format"` // "tar" or "custom_archive"
	StartTime           time.Time `json:"start_time"`
	StopTime            time.Time `json:"stop_time"`
	StartLSN            string    `json:"start_lsn"`
	StopLSN             string    `json:"stop_lsn"`
	StartWAL            string    `json:"start_wal"`
	StopWAL             string    `json:"stop_wal"`
	TimelineID          uint32    `json:"timeline_id"`
	EncryptionAlgorithm string    `json:"encryption_algorithm"` // "AES-256-GCM"
	KeyVersionID        string    `json:"key_version_id"`
	PlaintextSHA256     string    `json:"plaintext_sha256"`
	CiphertextSHA256    string    `json:"ciphertext_sha256"`
	ArchiveSizeBytes    int64     `json:"archive_size_bytes"`
	RequiredWALs        []string  `json:"required_wals"`
}

// ComputeWALListForRange computes all consecutive WAL filenames between startWAL and stopWAL inclusive.
func ComputeWALListForRange(startWAL, stopWAL string) ([]string, error) {
	startTL, startSeg, _, err1 := ParseWALFilename(startWAL)
	stopTL, stopSeg, _, err2 := ParseWALFilename(stopWAL)
	if err1 != nil || err2 != nil {
		return []string{startWAL, stopWAL}, nil
	}

	if startTL != stopTL {
		return []string{startWAL, stopWAL}, nil
	}

	if stopSeg < startSeg {
		return nil, fmt.Errorf("stop WAL segment %016X is earlier than start WAL segment %016X", stopSeg, startSeg)
	}

	var list []string
	for seg := startSeg; seg <= stopSeg; seg++ {
		walName := fmt.Sprintf("%08X%016X", startTL, seg)
		list = append(list, walName)
	}
	return list, nil
}

// CreateBaseBackupPackage bundles data files, globals, and manifest into an AES-256-GCM encrypted package.
func CreateBaseBackupPackage(dataPayload []byte, globalsSQL []byte, manifest *PhysicalBackupManifest, key []byte) ([]byte, error) {
	manifestJSON, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("marshalling manifest: %w", err)
	}

	var tarBuf bytes.Buffer
	gw := gzip.NewWriter(&tarBuf)
	tw := tar.NewWriter(gw)

	files := []struct {
		Name string
		Data []byte
	}{
		{"database.tar", dataPayload},
		{"globals.sql", globalsSQL},
		{"manifest.json", manifestJSON},
	}

	for _, f := range files {
		hdr := &tar.Header{
			Name:     f.Name,
			Mode:     0600,
			Size:     int64(len(f.Data)),
			ModTime:  manifest.StopTime,
			Typeflag: tar.TypeReg,
		}
		if err := tw.WriteHeader(hdr); err != nil {
			return nil, fmt.Errorf("writing tar header %s: %w", f.Name, err)
		}
		if _, err := tw.Write(f.Data); err != nil {
			return nil, fmt.Errorf("writing tar data %s: %w", f.Name, err)
		}
	}

	if err := tw.Close(); err != nil {
		return nil, err
	}
	if err := gw.Close(); err != nil {
		return nil, err
	}

	plaintextTar := tarBuf.Bytes()
	plainSum := sha256.Sum256(plaintextTar)
	manifest.PlaintextSHA256 = hex.EncodeToString(plainSum[:])

	// Encrypt bundle using AES-256-GCM
	encrypted, err := EncryptPayload(plaintextTar, key)
	if err != nil {
		return nil, fmt.Errorf("encrypting base backup bundle: %w", err)
	}

	cipherSum := sha256.Sum256(encrypted)
	manifest.CiphertextSHA256 = hex.EncodeToString(cipherSum[:])
	manifest.ArchiveSizeBytes = int64(len(encrypted))

	return encrypted, nil
}

// ExtractBaseBackupPackage decrypts and unpacks a base backup bundle, returning manifest, data, and globals.
func ExtractBaseBackupPackage(encryptedData []byte, key []byte) (*PhysicalBackupManifest, []byte, []byte, error) {
	plaintextTar, err := DecryptPayload(encryptedData, key)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("%w: %v", ErrBaseBackupCorrupted, err)
	}

	gr, err := gzip.NewReader(bytes.NewReader(plaintextTar))
	if err != nil {
		return nil, nil, nil, fmt.Errorf("reading compressed bundle: %w", err)
	}
	defer gr.Close()

	tr := tar.NewReader(gr)

	var dataPayload []byte
	var globalsSQL []byte
	var manifestJSON []byte

	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, nil, nil, fmt.Errorf("reading tar entry: %w", err)
		}

		var buf bytes.Buffer
		if _, err := io.Copy(&buf, tr); err != nil {
			return nil, nil, nil, fmt.Errorf("extracting %s: %w", hdr.Name, err)
		}

		switch hdr.Name {
		case "database.tar", "database.dump":
			dataPayload = buf.Bytes()
		case "globals.sql":
			globalsSQL = buf.Bytes()
		case "manifest.json":
			manifestJSON = buf.Bytes()
		}
	}

	if len(manifestJSON) == 0 {
		return nil, nil, nil, errors.New("invalid base backup bundle: manifest.json missing")
	}

	var manifest PhysicalBackupManifest
	if err := json.Unmarshal(manifestJSON, &manifest); err != nil {
		return nil, nil, nil, fmt.Errorf("parsing manifest: %w", err)
	}

	return &manifest, dataPayload, globalsSQL, nil
}

// VerifyBaseBackupCompleteness checks that an encrypted base backup and all its required WAL files exist in storage.
func VerifyBaseBackupCompleteness(ctx context.Context, storage StorageDestination, backupKey string, kms KeyProvider) (*PhysicalBackupManifest, error) {
	encData, _, err := storage.Get(ctx, backupKey)
	if err != nil {
		return nil, fmt.Errorf("retrieving base backup %q: %w", backupKey, err)
	}

	// Read manifest without full extraction if possible, or extract with active/historical key
	activeKV, err := kms.GetActiveKey(ctx)
	if err != nil {
		return nil, fmt.Errorf("getting active key: %w", err)
	}

	manifest, _, _, err := ExtractBaseBackupPackage(encData, activeKV.Key)
	if err != nil {
		// Try historical keys if active key fails
		versions, listErr := kms.ListKeyVersions(ctx)
		if listErr == nil {
			for _, v := range versions {
				if v.VersionID != activeKV.VersionID {
					m, _, _, decErr := ExtractBaseBackupPackage(encData, v.Key)
					if decErr == nil {
						manifest = m
						err = nil
						break
					}
				}
			}
		}
	}
	if err != nil {
		return nil, fmt.Errorf("decrypting base backup package: %w", err)
	}

	// Verify required WAL range in storage
	for _, walName := range manifest.RequiredWALs {
		walObjectKey := fmt.Sprintf("wal/%s.enc", walName)
		exists, err := storage.Exists(ctx, walObjectKey)
		if err != nil || !exists {
			return manifest, fmt.Errorf("%w: required segment %s is missing from archive", ErrIncompleteWALRange, walName)
		}
	}

	return manifest, nil
}

// ExecuteLiveBaseBackup connects to PostgreSQL, starts backup, collects metadata, stops backup, and produces package.
func ExecuteLiveBaseBackup(ctx context.Context, dbURL string, key []byte, keyVersion string, label string) ([]byte, *PhysicalBackupManifest, error) {
	conn, err := pgx.Connect(ctx, dbURL)
	if err != nil {
		return nil, nil, fmt.Errorf("connecting to PostgreSQL: %w", err)
	}
	defer conn.Close(ctx)

	// 1. Gather server version and database system identifier
	var serverVersion string
	_ = conn.QueryRow(ctx, "SHOW server_version;").Scan(&serverVersion)

	var systemID string
	_ = conn.QueryRow(ctx, "SELECT system_identifier::text FROM pg_control_system();").Scan(&systemID)

	startTime := time.Now().UTC()
	if label == "" {
		label = fmt.Sprintf("byos_backup_%s", startTime.Format("20060102_150405"))
	}

	// 2. Start PostgreSQL Backup via API
	var startLSN string
	err = conn.QueryRow(ctx, "SELECT pg_backup_start($1, true);", label).Scan(&startLSN)
	if err != nil {
		return nil, nil, fmt.Errorf("executing pg_backup_start: %w", err)
	}

	var startWAL string
	_ = conn.QueryRow(ctx, "SELECT pg_walfile_name($1);", startLSN).Scan(&startWAL)

	var tl uint32 = 1
	if startWAL != "" {
		tlParsed, _, _, _ := ParseWALFilename(startWAL)
		if tlParsed > 0 {
			tl = tlParsed
		}
	}

	// 3. Stop PostgreSQL Backup via API to capture stop LSN and WAL
	var stopLSN, labelfile, spcmapfile string
	err = conn.QueryRow(ctx, "SELECT lsn::text, labelfile, spcmapfile FROM pg_backup_stop(true);").Scan(&stopLSN, &labelfile, &spcmapfile)
	if err != nil {
		return nil, nil, fmt.Errorf("executing pg_backup_stop: %w", err)
	}
	stopTime := time.Now().UTC()

	var stopWAL string
	_ = conn.QueryRow(ctx, "SELECT pg_walfile_name($1);", stopLSN).Scan(&stopWAL)
	if stopWAL == "" {
		stopWAL = startWAL
	}

	requiredWALs, _ := ComputeWALListForRange(startWAL, stopWAL)

	manifest := &PhysicalBackupManifest{
		ManifestVersion:     2,
		BackupID:            label,
		DatabaseSystemID:    systemID,
		ServerVersion:       serverVersion,
		BackupMethod:        "pg_backup_api",
		BackupFormat:        "tar",
		StartTime:           startTime,
		StopTime:            stopTime,
		StartLSN:            startLSN,
		StopLSN:             stopLSN,
		StartWAL:            startWAL,
		StopWAL:             stopWAL,
		TimelineID:          tl,
		EncryptionAlgorithm: "AES-256-GCM",
		KeyVersionID:        keyVersion,
		RequiredWALs:        requiredWALs,
	}

	// Include backup label in the payload
	bundle, err := CreateBaseBackupPackage([]byte(labelfile), nil, manifest, key)
	if err != nil {
		return nil, nil, err
	}

	return bundle, manifest, nil
}
