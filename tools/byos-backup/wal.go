package main

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

var (
	ErrWALNotFound                = errors.New("wal: segment or history file not found in archive")
	ErrConflictingWALAlreadyExists = errors.New("wal: conflicting archive object already exists with different contents")
	ErrWALCorrupted               = errors.New("wal: archive integrity check failed or corrupted")
	ErrWALSequenceGap             = errors.New("wal: gap detected in archived WAL segment sequence")
)

// WALMetadata records the cryptographic and relational properties of an archived WAL file.
type WALMetadata struct {
	WALName          string    `json:"wal_name"`
	PlaintextSize    int64     `json:"plaintext_size"`
	PlaintextSHA256  string    `json:"plaintext_sha256"`
	CiphertextSHA256 string    `json:"ciphertext_sha256"`
	KeyVersion       string    `json:"key_version"`
	ArchivedAt       time.Time `json:"archived_at"`
	IsHistoryFile    bool      `json:"is_history_file"`
	TimelineID       uint32    `json:"timeline_id"`
	SegmentNo        uint64    `json:"segment_no"`
}

// WALArchiveStatus provides an observability summary of the archived WAL stream.
type WALArchiveStatus struct {
	TotalSegments   int           `json:"total_segments"`
	TotalHistory    int           `json:"total_history"`
	OldestWAL       string        `json:"oldest_wal"`
	NewestWAL       string        `json:"newest_wal"`
	OldestTimestamp time.Time     `json:"oldest_timestamp"`
	NewestTimestamp time.Time     `json:"newest_timestamp"`
	ArchiveLag      time.Duration `json:"archive_lag"`
	SequenceGaps    []string      `json:"sequence_gaps,omitempty"`
	Timelines       []uint32      `json:"timelines"`
	KeyVersions     []string      `json:"key_versions"`
	TotalSizeBytes  int64         `json:"total_size_bytes"`
}

// ParseWALFilename parses a PostgreSQL WAL filename (24 hex characters) into timeline and segment.
func ParseWALFilename(name string) (timeline uint32, segNo uint64, isHistory bool, err error) {
	name = strings.TrimSpace(name)
	if strings.HasSuffix(name, ".history") {
		tlStr := strings.TrimSuffix(name, ".history")
		tl, err := strconv.ParseUint(tlStr, 16, 32)
		if err != nil {
			return 0, 0, true, fmt.Errorf("invalid history file timeline %q: %w", name, err)
		}
		return uint32(tl), 0, true, nil
	}

	if len(name) != 24 {
		return 0, 0, false, fmt.Errorf("invalid WAL filename length %d (expected 24)", len(name))
	}

	tl, err := strconv.ParseUint(name[0:8], 16, 32)
	if err != nil {
		return 0, 0, false, fmt.Errorf("invalid timeline in %q: %w", name, err)
	}

	seg, err := strconv.ParseUint(name[8:24], 16, 64)
	if err != nil {
		return 0, 0, false, fmt.Errorf("invalid segment number in %q: %w", name, err)
	}

	return uint32(tl), seg, false, nil
}

// FormatWALFilename formats a 24-char hex WAL segment name.
func FormatWALFilename(timeline uint32, logNo uint32, segNo uint32) string {
	return fmt.Sprintf("%08X%08X%08X", timeline, logNo, segNo)
}

// computeWALAAD binds the WAL filename and key version as authenticated additional data.
func computeWALAAD(walName, keyVersion string) []byte {
	return []byte(fmt.Sprintf("BYOS_WAL_V1:%s:%s", walName, keyVersion))
}

// EncryptWALPayload encrypts a WAL segment using AES-256-GCM with authenticated metadata.
func EncryptWALPayload(plaintext []byte, key []byte, walName string, keyVersion string) ([]byte, error) {
	if len(key) != 32 {
		return nil, ErrInvalidKeyLength
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("creating cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("creating GCM block: %w", err)
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("generating nonce: %w", err)
	}

	aad := computeWALAAD(walName, keyVersion)
	ciphertext := gcm.Seal(nil, nonce, plaintext, aad)

	buf := make([]byte, 0, len(MagicHeader)+len(nonce)+len(ciphertext))
	buf = append(buf, MagicHeader...)
	buf = append(buf, nonce...)
	buf = append(buf, ciphertext...)

	return buf, nil
}

// DecryptWALPayload decrypts a WAL segment and verifies authentication tag and AAD.
func DecryptWALPayload(encryptedData []byte, key []byte, walName string, keyVersion string) ([]byte, error) {
	if len(key) != 32 {
		return nil, ErrInvalidKeyLength
	}

	minLen := len(MagicHeader) + 12 + 16
	if len(encryptedData) < minLen {
		return nil, ErrPayloadTooShort
	}

	if !bytes.Equal(encryptedData[:len(MagicHeader)], MagicHeader) {
		return nil, ErrInvalidMagicHeader
	}

	nonceStart := len(MagicHeader)
	nonceEnd := nonceStart + 12
	nonce := encryptedData[nonceStart:nonceEnd]
	ciphertextWithTag := encryptedData[nonceEnd:]

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("creating cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("creating GCM block: %w", err)
	}

	aad := computeWALAAD(walName, keyVersion)
	plaintext, err := gcm.Open(nil, nonce, ciphertextWithTag, aad)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrDecryptionFailed, err)
	}

	return plaintext, nil
}

// ArchiveWALSegment encrypts and writes a WAL segment into storage with strict idempotency.
func ArchiveWALSegment(ctx context.Context, storage StorageDestination, sourcePath string, walName string, key []byte, keyVersion string) (*WALMetadata, error) {
	walName = strings.TrimSpace(walName)
	if walName == "" {
		walName = filepath.Base(sourcePath)
	}

	// 1. Read plaintext WAL segment from source path
	plaintext, err := os.ReadFile(sourcePath)
	if err != nil {
		return nil, fmt.Errorf("reading source WAL file %q: %w", sourcePath, err)
	}

	tl, seg, isHist, _ := ParseWALFilename(walName)

	plainSum := sha256.Sum256(plaintext)
	plainHex := hex.EncodeToString(plainSum[:])

	encObjectKey := fmt.Sprintf("wal/%s.enc", walName)
	metaObjectKey := fmt.Sprintf("wal/%s.meta.json", walName)

	// 2. Check idempotency: If object already exists in storage, check plaintext checksum
	exists, err := storage.Exists(ctx, encObjectKey)
	if err != nil {
		return nil, fmt.Errorf("checking WAL existence in storage: %w", err)
	}

	if exists {
		// Read metadata if available
		metaData, _, metaErr := storage.Get(ctx, metaObjectKey)
		if metaErr == nil {
			var meta WALMetadata
			if json.Unmarshal(metaData, &meta) == nil && meta.PlaintextSHA256 == plainHex {
				// Idempotent re-archive with identical content: allow and return metadata
				return &meta, nil
			}
		}

		// Decrypt existing archive file to compare contents
		existingCipher, _, getErr := storage.Get(ctx, encObjectKey)
		if getErr == nil {
			decrypted, decErr := DecryptWALPayload(existingCipher, key, walName, keyVersion)
			if decErr == nil {
				existingSum := sha256.Sum256(decrypted)
				if bytes.Equal(plainSum[:], existingSum[:]) {
					// Identical content: return success
					now := time.Now().UTC()
					return &WALMetadata{
						WALName:          walName,
						PlaintextSize:    int64(len(plaintext)),
						PlaintextSHA256:  plainHex,
						CiphertextSHA256: hex.EncodeToString(sha256.New().Sum(existingCipher)),
						KeyVersion:       keyVersion,
						ArchivedAt:       now,
						IsHistoryFile:    isHist,
						TimelineID:       tl,
						SegmentNo:        seg,
					}, nil
				}
			}
		}

		// If contents do not match, fail closed! Never silently overwrite conflicting WAL!
		return nil, fmt.Errorf("%w: %s", ErrConflictingWALAlreadyExists, walName)
	}

	// 3. Encrypt payload
	encrypted, err := EncryptWALPayload(plaintext, key, walName, keyVersion)
	if err != nil {
		return nil, fmt.Errorf("encrypting WAL segment %s: %w", walName, err)
	}

	cipherSum := sha256.Sum256(encrypted)
	cipherHex := hex.EncodeToString(cipherSum[:])

	meta := &WALMetadata{
		WALName:          walName,
		PlaintextSize:    int64(len(plaintext)),
		PlaintextSHA256:  plainHex,
		CiphertextSHA256: cipherHex,
		KeyVersion:       keyVersion,
		ArchivedAt:       time.Now().UTC(),
		IsHistoryFile:    isHist,
		TimelineID:       tl,
		SegmentNo:        seg,
	}

	metaJSON, err := json.MarshalIndent(meta, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("marshalling metadata: %w", err)
	}

	// 4. Store encrypted object first, then metadata
	if err := storage.Put(ctx, encObjectKey, encrypted, map[string]string{
		"wal_name":    walName,
		"key_version": keyVersion,
		"sha256":      cipherHex,
	}); err != nil {
		return nil, fmt.Errorf("storing encrypted WAL object: %w", err)
	}

	if err := storage.Put(ctx, metaObjectKey, metaJSON, nil); err != nil {
		// Attempt cleanup of orphaned encrypted object if metadata fails
		_ = storage.Delete(ctx, encObjectKey)
		return nil, fmt.Errorf("storing WAL metadata: %w", err)
	}

	return meta, nil
}

// RestoreWALSegment decrypts and writes an archived WAL segment into PostgreSQL's recovery target path.
func RestoreWALSegment(ctx context.Context, storage StorageDestination, walName string, targetPath string, kms KeyProvider) error {
	walName = strings.TrimSpace(walName)
	encObjectKey := fmt.Sprintf("wal/%s.enc", walName)
	metaObjectKey := fmt.Sprintf("wal/%s.meta.json", walName)

	// 1. Check existence in storage
	exists, err := storage.Exists(ctx, encObjectKey)
	if err != nil {
		return fmt.Errorf("checking WAL object existence: %w", err)
	}
	if !exists {
		return fmt.Errorf("%w: %s", ErrWALNotFound, walName)
	}

	// 2. Fetch metadata to determine key version
	var keyVersion string
	metaData, _, metaErr := storage.Get(ctx, metaObjectKey)
	if metaErr == nil {
		var meta WALMetadata
		if json.Unmarshal(metaData, &meta) == nil {
			keyVersion = meta.KeyVersion
		}
	}
	if keyVersion == "" {
		keyVersion = "v1"
	}

	// 3. Resolve key from KMS
	kv, err := kms.GetKeyVersion(ctx, keyVersion)
	if err != nil {
		if errors.Is(err, ErrKeyRevoked) {
			return fmt.Errorf("resolving key version %s: %w", keyVersion, err)
		}
		// Fallback to active key if specific historical key lookup fails
		active, activeErr := kms.GetActiveKey(ctx)
		if activeErr != nil {
			return fmt.Errorf("resolving key version %s: %w", keyVersion, err)
		}
		kv = active
	}

	// 4. Retrieve encrypted ciphertext
	encryptedData, _, err := storage.Get(ctx, encObjectKey)
	if err != nil {
		return fmt.Errorf("retrieving encrypted WAL %s: %w", walName, err)
	}

	// 5. Decrypt and authenticate
	plaintext, err := DecryptWALPayload(encryptedData, kv.Key, walName, keyVersion)
	if err != nil {
		return fmt.Errorf("%w: failed to decrypt WAL segment %s: %v", ErrWALCorrupted, walName, err)
	}

	// 6. Write atomically to target path
	targetDir := filepath.Dir(targetPath)
	if err := os.MkdirAll(targetDir, 0750); err != nil {
		return fmt.Errorf("creating target directory %q: %w", targetDir, err)
	}

	tmpPath := fmt.Sprintf("%s.tmp.%d", targetPath, time.Now().UnixNano())
	f, err := os.OpenFile(tmpPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0640)
	if err != nil {
		return fmt.Errorf("creating temp target file %q: %w", tmpPath, err)
	}

	if _, err := f.Write(plaintext); err != nil {
		f.Close()
		_ = os.Remove(tmpPath)
		return fmt.Errorf("writing decrypted WAL content: %w", err)
	}

	if err := f.Sync(); err != nil {
		f.Close()
		_ = os.Remove(tmpPath)
		return fmt.Errorf("syncing decrypted WAL file: %w", err)
	}
	f.Close()

	if err := os.Rename(tmpPath, targetPath); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("finalizing target WAL rename: %w", err)
	}

	return nil
}

// GetWALArchiveStatus analyzes the complete stream of archived WAL objects in storage.
func GetWALArchiveStatus(ctx context.Context, storage StorageDestination) (*WALArchiveStatus, error) {
	objects, err := storage.List(ctx, "wal/")
	if err != nil {
		return nil, fmt.Errorf("listing WAL archive objects: %w", err)
	}

	var walFiles []string
	var histFiles []string
	var totalSize int64
	timelinesMap := make(map[uint32]bool)
	keyVersionsMap := make(map[string]bool)

	type segItem struct {
		Name      string
		Timeline  uint32
		Segment   uint64
		Timestamp time.Time
	}
	var segments []segItem

	for _, obj := range objects {
		if strings.HasSuffix(obj.Key, ".enc") {
			name := strings.TrimPrefix(obj.Key, "wal/")
			name = strings.TrimSuffix(name, ".enc")
			totalSize += obj.SizeBytes

			tl, seg, isHist, pErr := ParseWALFilename(name)
			if pErr == nil {
				timelinesMap[tl] = true
				if isHist {
					histFiles = append(histFiles, name)
				} else {
					walFiles = append(walFiles, name)
					segments = append(segments, segItem{
						Name:      name,
						Timeline:  tl,
						Segment:   seg,
						Timestamp: obj.LastModified,
					})
				}
			}
		} else if strings.HasSuffix(obj.Key, ".meta.json") {
			// Read metadata to inspect key versions
			if metaBytes, _, err := storage.Get(ctx, obj.Key); err == nil {
				var meta WALMetadata
				if json.Unmarshal(metaBytes, &meta) == nil && meta.KeyVersion != "" {
					keyVersionsMap[meta.KeyVersion] = true
				}
			}
		}
	}

	status := &WALArchiveStatus{
		TotalSegments:  len(walFiles),
		TotalHistory:   len(histFiles),
		TotalSizeBytes: totalSize,
	}

	for tl := range timelinesMap {
		status.Timelines = append(status.Timelines, tl)
	}
	sort.Slice(status.Timelines, func(i, j int) bool { return status.Timelines[i] < status.Timelines[j] })

	for kv := range keyVersionsMap {
		status.KeyVersions = append(status.KeyVersions, kv)
	}
	sort.Strings(status.KeyVersions)

	if len(segments) == 0 {
		return status, nil
	}

	// Sort segments by Timeline and Segment number
	sort.Slice(segments, func(i, j int) bool {
		if segments[i].Timeline != segments[j].Timeline {
			return segments[i].Timeline < segments[j].Timeline
		}
		return segments[i].Segment < segments[j].Segment
	})

	status.OldestWAL = segments[0].Name
	status.NewestWAL = segments[len(segments)-1].Name
	status.OldestTimestamp = segments[0].Timestamp
	status.NewestTimestamp = segments[len(segments)-1].Timestamp
	status.ArchiveLag = time.Since(status.NewestTimestamp)

	// Detect sequence gaps within identical timelines
	for i := 1; i < len(segments); i++ {
		prev := segments[i-1]
		curr := segments[i]
		if prev.Timeline == curr.Timeline {
			if curr.Segment > prev.Segment+1 {
				gapStr := fmt.Sprintf("Timeline %08X: missing between %016X and %016X", prev.Timeline, prev.Segment, curr.Segment)
				status.SequenceGaps = append(status.SequenceGaps, gapStr)
			}
		}
	}

	return status, nil
}
