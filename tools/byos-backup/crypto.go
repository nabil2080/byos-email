package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

var (
	// MagicHeader identifies a BYOS AES-256-GCM encrypted backup package.
	MagicHeader = []byte("BYOSENC1")

	// BackupAAD is the authenticated additional data tied to each backup package.
	BackupAAD = []byte("BYOS_BACKUP_V1")

	ErrInvalidMagicHeader   = errors.New("invalid backup encryption magic header")
	ErrPayloadTooShort      = errors.New("encrypted payload too short")
	ErrDecryptionFailed     = errors.New("backup decryption failed: authentication tag mismatch or invalid key")
	ErrInvalidKeyLength     = errors.New("encryption key must be exactly 32 bytes (256-bit)")
	ErrKeyInBackupDirectory = errors.New("security violation: encryption key file must not reside in the backup target directory")
)

// ParseEncryptionKey decodes a 32-byte key from a 64-char hex string, raw string, or keyfile.
func ParseEncryptionKey(keyInput string) ([]byte, error) {
	keyInput = strings.TrimSpace(keyInput)
	if len(keyInput) == 64 {
		// Try hex decoding first
		if decoded, err := hex.DecodeString(keyInput); err == nil && len(decoded) == 32 {
			return decoded, nil
		}
	}
	if len(keyInput) == 32 {
		return []byte(keyInput), nil
	}
	return nil, fmt.Errorf("%w (got %d bytes/characters)", ErrInvalidKeyLength, len(keyInput))
}

// LoadEncryptionKey loads the 256-bit key from an environment variable or keyfile.
// It enforces that the keyfile does not reside within the backup output directory.
func LoadEncryptionKey(keyEnvOrFile string, backupDir string) ([]byte, error) {
	// First check environment variable
	if envVal := os.Getenv("BYOS_BACKUP_ENCRYPTION_KEY"); envVal != "" {
		return ParseEncryptionKey(envVal)
	}

	if keyEnvOrFile == "" {
		return nil, errors.New("no encryption key specified (set BYOS_BACKUP_ENCRYPTION_KEY or supply --key-file)")
	}

	// Check if keyEnvOrFile is a direct hex key
	if key, err := ParseEncryptionKey(keyEnvOrFile); err == nil {
		return key, nil
	}

	// Treat as a file path
	absKeyPath, err := filepath.Abs(keyEnvOrFile)
	if err != nil {
		return nil, fmt.Errorf("resolving key file path %q: %w", keyEnvOrFile, err)
	}

	if backupDir != "" {
		absBackupDir, err := filepath.Abs(backupDir)
		if err == nil {
			rel, err := filepath.Rel(absBackupDir, absKeyPath)
			if err == nil && !strings.HasPrefix(rel, "..") && !filepath.IsAbs(rel) {
				return nil, fmt.Errorf("%w: key path %q is inside backup directory %q", ErrKeyInBackupDirectory, absKeyPath, absBackupDir)
			}
		}
	}

	data, err := os.ReadFile(absKeyPath)
	if err != nil {
		return nil, fmt.Errorf("reading key file %q: %w", absKeyPath, err)
	}

	return ParseEncryptionKey(string(data))
}

// EncryptPayload encrypts plaintext with AES-256-GCM and prepends MagicHeader + Nonce.
// Output layout: [8 bytes MagicHeader][12 bytes Nonce][N bytes Ciphertext + 16 bytes GCM Tag]
func EncryptPayload(plaintext []byte, key []byte) ([]byte, error) {
	if len(key) != 32 {
		return nil, ErrInvalidKeyLength
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, fmt.Errorf("creating AES cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("creating GCM block: %w", err)
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("generating cryptographically secure nonce: %w", err)
	}

	// Seal appends the ciphertext and 16-byte tag
	ciphertext := gcm.Seal(nil, nonce, plaintext, BackupAAD)

	buf := make([]byte, 0, len(MagicHeader)+len(nonce)+len(ciphertext))
	buf = append(buf, MagicHeader...)
	buf = append(buf, nonce...)
	buf = append(buf, ciphertext...)

	return buf, nil
}

// DecryptPayload verifies MagicHeader, extracts Nonce, and decrypts AES-256-GCM ciphertext.
// Fails closed if the authentication tag does not match or if the key is incorrect.
func DecryptPayload(encryptedData []byte, key []byte) ([]byte, error) {
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
		return nil, fmt.Errorf("creating AES cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("creating GCM block: %w", err)
	}

	plaintext, err := gcm.Open(nil, nonce, ciphertextWithTag, BackupAAD)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrDecryptionFailed, err)
	}

	return plaintext, nil
}

// EncryptedBackupBundle represents the contents of an unencrypted backup before packaging.
type EncryptedBackupBundle struct {
	GlobalsSQL   []byte
	DatabaseDump []byte
	ManifestJSON []byte
	CreatedAt    time.Time
}

// CreateEncryptedArchive bundles files into a gzip-compressed tar archive and encrypts with AES-256-GCM.
func CreateEncryptedArchive(bundle *EncryptedBackupBundle, key []byte) ([]byte, error) {
	var tarBuf bytes.Buffer
	gw := gzip.NewWriter(&tarBuf)
	tw := tar.NewWriter(gw)

	files := []struct {
		Name string
		Data []byte
	}{
		{"globals.sql", bundle.GlobalsSQL},
		{"database.dump", bundle.DatabaseDump},
		{"manifest.json", bundle.ManifestJSON},
	}

	for _, f := range files {
		hdr := &tar.Header{
			Name:     f.Name,
			Mode:     0600,
			Size:     int64(len(f.Data)),
			ModTime:  bundle.CreatedAt,
			Typeflag: tar.TypeReg,
		}
		if err := tw.WriteHeader(hdr); err != nil {
			return nil, fmt.Errorf("writing tar header for %s: %w", f.Name, err)
		}
		if _, err := tw.Write(f.Data); err != nil {
			return nil, fmt.Errorf("writing tar content for %s: %w", f.Name, err)
		}
	}

	if err := tw.Close(); err != nil {
		return nil, fmt.Errorf("closing tar writer: %w", err)
	}
	if err := gw.Close(); err != nil {
		return nil, fmt.Errorf("closing gzip writer: %w", err)
	}

	return EncryptPayload(tarBuf.Bytes(), key)
}

// DecryptAndUnpackArchive decrypts an AES-256-GCM encrypted backup archive and unpacks the tar bundle.
func DecryptAndUnpackArchive(encryptedData []byte, key []byte) (*EncryptedBackupBundle, error) {
	compressedPlaintext, err := DecryptPayload(encryptedData, key)
	if err != nil {
		return nil, err
	}

	gr, err := gzip.NewReader(bytes.NewReader(compressedPlaintext))
	if err != nil {
		return nil, fmt.Errorf("opening gzip reader: %w", err)
	}
	defer gr.Close()

	tr := tar.NewReader(gr)
	bundle := &EncryptedBackupBundle{
		CreatedAt: time.Now().UTC(),
	}

	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("reading tar entry: %w", err)
		}

		var data bytes.Buffer
		if _, err := io.Copy(&data, tr); err != nil {
			return nil, fmt.Errorf("reading tar entry data for %s: %w", hdr.Name, err)
		}

		switch hdr.Name {
		case "globals.sql":
			bundle.GlobalsSQL = data.Bytes()
		case "database.dump":
			bundle.DatabaseDump = data.Bytes()
		case "manifest.json":
			bundle.ManifestJSON = data.Bytes()
		}
	}

	if len(bundle.DatabaseDump) == 0 {
		return nil, errors.New("invalid backup bundle: database.dump missing or empty")
	}

	return bundle, nil
}
