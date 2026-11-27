package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

var (
	ErrObjectNotFound      = errors.New("storage: object not found")
	ErrObjectAlreadyExists = errors.New("storage: object already exists with different checksum (conflicting write)")
	ErrPreconditionFailed  = errors.New("storage: conditional write precondition failed (409/412 conflict)")
	ErrDestinationOffline  = errors.New("storage: destination is unavailable or offline")
	ErrStoragePermission   = errors.New("storage: permission denied on destination")
	ErrDiskFull            = errors.New("storage: destination disk or quota full")
)

// ObjectInfo holds metadata for a stored backup or WAL object.
type ObjectInfo struct {
	Key          string            `json:"key"`
	SizeBytes    int64             `json:"size_bytes"`
	SHA256Hex    string            `json:"sha256_hex"`
	ETag         string            `json:"etag,omitempty"`
	LastModified time.Time         `json:"last_modified"`
	Metadata     map[string]string `json:"metadata,omitempty"`
}

// StorageDestination is the provider-neutral interface for local and remote disaster-recovery storage.
type StorageDestination interface {
	Name() string
	Put(ctx context.Context, key string, data []byte, metadata map[string]string) error
	Get(ctx context.Context, key string) ([]byte, map[string]string, error)
	Delete(ctx context.Context, key string) error
	Exists(ctx context.Context, key string) (bool, error)
	List(ctx context.Context, prefix string) ([]ObjectInfo, error)
	GetInfo(ctx context.Context, key string) (ObjectInfo, error)
}

// MutableStorageDestination supports direct replacement PUTs for mutable manifests
// (catalog/recovery_catalog.json and keys/key_envelopes.json) without creating a
// delete marker prior to upload.
type MutableStorageDestination interface {
	PutOverwrite(ctx context.Context, key string, data []byte, metadata map[string]string) error
}

// ConditionalMutableStorageDestination extends MutableStorageDestination with
// ETag-based optimistic concurrency control (If-Match / If-None-Match).
type ConditionalMutableStorageDestination interface {
	MutableStorageDestination
	GetWithETag(ctx context.Context, key string) ([]byte, map[string]string, string, error)
	PutIfMatch(ctx context.Context, key string, data []byte, metadata map[string]string, expectedETag string) error
}

// putMutableManifest writes or replaces a mutable manifest atomically without delete-before-put.
// Fails closed if dest does not implement MutableStorageDestination.
func putMutableManifest(ctx context.Context, dest StorageDestination, key string, data []byte, metadata map[string]string) error {
	m, ok := dest.(MutableStorageDestination)
	if !ok {
		return fmt.Errorf("%w: destination %q does not implement MutableStorageDestination for safe manifest replacement", ErrStoragePermission, dest.Name())
	}
	return m.PutOverwrite(ctx, key, data, metadata)
}

// putMutableManifestCAS writes or replaces a mutable manifest using ETag precondition
// when supported by dest, failing closed if dest does not implement MutableStorageDestination.
func putMutableManifestCAS(ctx context.Context, dest StorageDestination, key string, data []byte, metadata map[string]string, expectedETag string) error {
	if c, ok := dest.(ConditionalMutableStorageDestination); ok {
		return c.PutIfMatch(ctx, key, data, metadata, expectedETag)
	}
	return putMutableManifest(ctx, dest, key, data, metadata)
}

// FilesystemStorage stores objects on the local or mounted filesystem.
type FilesystemStorage struct {
	baseDir string
}

func NewFilesystemStorage(baseDir string) (*FilesystemStorage, error) {
	abs, err := filepath.Abs(baseDir)
	if err != nil {
		return nil, fmt.Errorf("resolving filesystem storage path %q: %w", baseDir, err)
	}
	if err := os.MkdirAll(abs, 0750); err != nil {
		return nil, fmt.Errorf("creating filesystem storage directory %q: %w", abs, err)
	}
	return &FilesystemStorage{baseDir: abs}, nil
}

func (s *FilesystemStorage) Name() string {
	return "filesystem"
}

func (s *FilesystemStorage) resolvePath(key string) string {
	clean := filepath.Clean(key)
	clean = strings.TrimPrefix(clean, string(filepath.Separator))
	return filepath.Join(s.baseDir, clean)
}

func (s *FilesystemStorage) Put(ctx context.Context, key string, data []byte, metadata map[string]string) error {
	destPath := s.resolvePath(key)
	destDir := filepath.Dir(destPath)

	if err := os.MkdirAll(destDir, 0750); err != nil {
		return fmt.Errorf("%w: %v", ErrStoragePermission, err)
	}

	incomingSum := sha256.Sum256(data)
	incomingHex := hex.EncodeToString(incomingSum[:])

	// Check idempotency: If file exists, verify checksum
	if info, err := os.Stat(destPath); err == nil {
		existingData, err := os.ReadFile(destPath)
		if err == nil {
			existingSum := sha256.Sum256(existingData)
			existingHex := hex.EncodeToString(existingSum[:])
			if existingHex == incomingHex {
				// Idempotent re-write with identical content: allow and return nil
				return nil
			}
			return fmt.Errorf("%w: %s (existing %s, incoming %s)", ErrObjectAlreadyExists, key, existingHex, incomingHex)
		}
		_ = info
	}

	return s.PutOverwrite(ctx, key, data, metadata)
}

// PutOverwrite atomically replaces a mutable manifest on disk via temp file + fsync + rename.
func (s *FilesystemStorage) PutOverwrite(ctx context.Context, key string, data []byte, metadata map[string]string) error {
	destPath := s.resolvePath(key)
	destDir := filepath.Dir(destPath)

	if err := os.MkdirAll(destDir, 0750); err != nil {
		return fmt.Errorf("%w: %v", ErrStoragePermission, err)
	}

	tmpPath := fmt.Sprintf("%s.tmp.%d", destPath, time.Now().UnixNano())
	f, err := os.OpenFile(tmpPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0640)
	if err != nil {
		return fmt.Errorf("creating temp storage file: %w", err)
	}

	if _, err := f.Write(data); err != nil {
		f.Close()
		_ = os.Remove(tmpPath)
		return fmt.Errorf("writing storage file: %w", err)
	}

	if err := f.Sync(); err != nil {
		f.Close()
		_ = os.Remove(tmpPath)
		return fmt.Errorf("syncing storage file to disk: %w", err)
	}
	f.Close()

	if err := os.Rename(tmpPath, destPath); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("finalizing storage file rename: %w", err)
	}

	return nil
}

func (s *FilesystemStorage) Get(ctx context.Context, key string) ([]byte, map[string]string, error) {
	path := s.resolvePath(key)
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil, fmt.Errorf("%w: %s", ErrObjectNotFound, key)
		}
		return nil, nil, err
	}
	return data, nil, nil
}

func (s *FilesystemStorage) Delete(ctx context.Context, key string) error {
	path := s.resolvePath(key)
	err := os.Remove(path)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func (s *FilesystemStorage) Exists(ctx context.Context, key string) (bool, error) {
	path := s.resolvePath(key)
	_, err := os.Stat(path)
	if err == nil {
		return true, nil
	}
	if os.IsNotExist(err) {
		return false, nil
	}
	return false, err
}

func (s *FilesystemStorage) List(ctx context.Context, prefix string) ([]ObjectInfo, error) {
	var objects []ObjectInfo
	normPrefix := filepath.Clean(prefix)
	if normPrefix == "." {
		normPrefix = ""
	}

	err := filepath.Walk(s.baseDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() {
			return nil
		}
		// Ignore temporary files
		if strings.Contains(info.Name(), ".tmp.") {
			return nil
		}

		rel, err := filepath.Rel(s.baseDir, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)

		if normPrefix == "" || strings.HasPrefix(rel, normPrefix) {
			data, err := os.ReadFile(path)
			var sumHex string
			if err == nil {
				sum := sha256.Sum256(data)
				sumHex = hex.EncodeToString(sum[:])
			}
			objects = append(objects, ObjectInfo{
				Key:          rel,
				SizeBytes:    info.Size(),
				SHA256Hex:    sumHex,
				LastModified: info.ModTime().UTC(),
			})
		}
		return nil
	})

	return objects, err
}

func (s *FilesystemStorage) GetInfo(ctx context.Context, key string) (ObjectInfo, error) {
	path := s.resolvePath(key)
	info, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return ObjectInfo{}, fmt.Errorf("%w: %s", ErrObjectNotFound, key)
		}
		return ObjectInfo{}, err
	}

	data, err := os.ReadFile(path)
	var sumHex string
	if err == nil {
		sum := sha256.Sum256(data)
		sumHex = hex.EncodeToString(sum[:])
	}

	return ObjectInfo{
		Key:          key,
		SizeBytes:    info.Size(),
		SHA256Hex:    sumHex,
		LastModified: info.ModTime().UTC(),
	}, nil
}

// MemoryStorage is an in-memory storage provider supporting fault injection for testing.
type MemoryStorage struct {
	mu           sync.RWMutex
	objects      map[string][]byte
	metadata     map[string]map[string]string
	timestamps   map[string]time.Time
	etags        map[string]string
	nextETagSeq  uint64
	simOffline   bool
	simPermErr   bool
	simDiskFull  bool
	maxSizeBytes int64
	currentBytes int64
}

func NewMemoryStorage(maxSizeBytes int64) *MemoryStorage {
	if maxSizeBytes <= 0 {
		maxSizeBytes = 100 * 1024 * 1024 // 100MB default
	}
	return &MemoryStorage{
		objects:      make(map[string][]byte),
		metadata:     make(map[string]map[string]string),
		timestamps:   make(map[string]time.Time),
		etags:        make(map[string]string),
		maxSizeBytes: maxSizeBytes,
	}
}

func (m *MemoryStorage) Name() string {
	return "memory-mock"
}

func (m *MemoryStorage) SetSimulateOffline(offline bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.simOffline = offline
}

func (m *MemoryStorage) SetSimulatePermissionDenied(perm bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.simPermErr = perm
}

func (m *MemoryStorage) Put(ctx context.Context, key string, data []byte, metadata map[string]string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.simOffline {
		return ErrDestinationOffline
	}
	if m.simPermErr {
		return ErrStoragePermission
	}
	if m.currentBytes+int64(len(data)) > m.maxSizeBytes {
		return ErrDiskFull
	}

	incomingSum := sha256.Sum256(data)
	if existing, exists := m.objects[key]; exists {
		existingSum := sha256.Sum256(existing)
		if bytes.Equal(incomingSum[:], existingSum[:]) {
			// Idempotent re-write: allow and return nil
			return nil
		}
		return fmt.Errorf("%w: %s", ErrObjectAlreadyExists, key)
	}

	// Copy data to prevent external mutation
	buf := make([]byte, len(data))
	copy(buf, data)
	m.objects[key] = buf
	m.timestamps[key] = time.Now().UTC()
	m.nextETagSeq++
	m.etags[key] = fmt.Sprintf("mem-%d", m.nextETagSeq)
	m.currentBytes += int64(len(data))

	if metadata != nil {
		metaCopy := make(map[string]string)
		for k, v := range metadata {
			metaCopy[k] = v
		}
		m.metadata[key] = metaCopy
	}

	return nil
}

// PutOverwrite atomically replaces a mutable manifest in memory without deleting first.
func (m *MemoryStorage) PutOverwrite(ctx context.Context, key string, data []byte, metadata map[string]string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.simOffline {
		return ErrDestinationOffline
	}
	if m.simPermErr {
		return ErrStoragePermission
	}
	var oldLen int64
	if existing, exists := m.objects[key]; exists {
		oldLen = int64(len(existing))
	}
	if m.currentBytes-oldLen+int64(len(data)) > m.maxSizeBytes {
		return ErrDiskFull
	}

	buf := make([]byte, len(data))
	copy(buf, data)
	m.objects[key] = buf
	m.timestamps[key] = time.Now().UTC()
	m.nextETagSeq++
	m.etags[key] = fmt.Sprintf("mem-%d", m.nextETagSeq)
	m.currentBytes = m.currentBytes - oldLen + int64(len(data))

	if metadata != nil {
		metaCopy := make(map[string]string)
		for k, v := range metadata {
			metaCopy[k] = v
		}
		m.metadata[key] = metaCopy
	}

	return nil
}

// GetWithETag retrieves an object, its metadata, and its version ETag atomically.
func (m *MemoryStorage) GetWithETag(ctx context.Context, key string) ([]byte, map[string]string, string, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if m.simOffline {
		return nil, nil, "", ErrDestinationOffline
	}
	if m.simPermErr {
		return nil, nil, "", ErrStoragePermission
	}
	data, exists := m.objects[key]
	if !exists {
		return nil, nil, "", fmt.Errorf("%w: %s", ErrObjectNotFound, key)
	}
	buf := make([]byte, len(data))
	copy(buf, data)
	return buf, m.metadata[key], m.etags[key], nil
}

// PutIfMatch atomically replaces a mutable manifest only if its current ETag matches expectedETag
// (or if expectedETag == "", only when the object does not yet exist).
func (m *MemoryStorage) PutIfMatch(ctx context.Context, key string, data []byte, metadata map[string]string, expectedETag string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.simOffline {
		return ErrDestinationOffline
	}
	if m.simPermErr {
		return ErrStoragePermission
	}
	cur, exists := m.objects[key]
	curETag := m.etags[key]
	if expectedETag == "" {
		if exists {
			return fmt.Errorf("%w: %s already exists (create-only conflict)", ErrPreconditionFailed, key)
		}
	} else if !exists || curETag != expectedETag {
		return fmt.Errorf("%w: %s etag mismatch (expected %q, current %q)", ErrPreconditionFailed, key, expectedETag, curETag)
	}
	var oldLen int64
	if exists {
		oldLen = int64(len(cur))
	}
	if m.currentBytes-oldLen+int64(len(data)) > m.maxSizeBytes {
		return ErrDiskFull
	}

	buf := make([]byte, len(data))
	copy(buf, data)
	m.objects[key] = buf
	m.timestamps[key] = time.Now().UTC()
	m.nextETagSeq++
	m.etags[key] = fmt.Sprintf("mem-%d", m.nextETagSeq)
	m.currentBytes = m.currentBytes - oldLen + int64(len(data))

	if metadata != nil {
		metaCopy := make(map[string]string)
		for k, v := range metadata {
			metaCopy[k] = v
		}
		m.metadata[key] = metaCopy
	}
	return nil
}

func (m *MemoryStorage) Get(ctx context.Context, key string) ([]byte, map[string]string, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if m.simOffline {
		return nil, nil, ErrDestinationOffline
	}
	if m.simPermErr {
		return nil, nil, ErrStoragePermission
	}

	data, exists := m.objects[key]
	if !exists {
		return nil, nil, fmt.Errorf("%w: %s", ErrObjectNotFound, key)
	}

	buf := make([]byte, len(data))
	copy(buf, data)
	return buf, m.metadata[key], nil
}

func (m *MemoryStorage) Delete(ctx context.Context, key string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.simOffline {
		return ErrDestinationOffline
	}
	if m.simPermErr {
		return ErrStoragePermission
	}

	if data, exists := m.objects[key]; exists {
		m.currentBytes -= int64(len(data))
		delete(m.objects, key)
		delete(m.metadata, key)
		delete(m.timestamps, key)
	}
	return nil
}

func (m *MemoryStorage) Exists(ctx context.Context, key string) (bool, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if m.simOffline {
		return false, ErrDestinationOffline
	}
	_, exists := m.objects[key]
	return exists, nil
}

func (m *MemoryStorage) List(ctx context.Context, prefix string) ([]ObjectInfo, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if m.simOffline {
		return nil, ErrDestinationOffline
	}

	var list []ObjectInfo
	for k, data := range m.objects {
		if prefix == "" || strings.HasPrefix(k, prefix) {
			sum := sha256.Sum256(data)
			list = append(list, ObjectInfo{
				Key:          k,
				SizeBytes:    int64(len(data)),
				SHA256Hex:    hex.EncodeToString(sum[:]),
				LastModified: m.timestamps[k],
				Metadata:     m.metadata[k],
			})
		}
	}
	return list, nil
}

func (m *MemoryStorage) GetInfo(ctx context.Context, key string) (ObjectInfo, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if m.simOffline {
		return ObjectInfo{}, ErrDestinationOffline
	}

	data, exists := m.objects[key]
	if !exists {
		return ObjectInfo{}, fmt.Errorf("%w: %s", ErrObjectNotFound, key)
	}

	sum := sha256.Sum256(data)
	return ObjectInfo{
		Key:          key,
		SizeBytes:    int64(len(data)),
		SHA256Hex:    hex.EncodeToString(sum[:]),
		LastModified: m.timestamps[key],
		Metadata:     m.metadata[key],
	}, nil
}
