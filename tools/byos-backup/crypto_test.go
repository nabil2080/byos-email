package main

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func generateRandomKey(t *testing.T) []byte {
	k := make([]byte, 32)
	if _, err := rand.Read(k); err != nil {
		t.Fatalf("generating random key: %v", err)
	}
	return k
}

func TestEncryptDecryptPayloadRoundtrip(t *testing.T) {
	key := generateRandomKey(t)
	plaintext := []byte("PostgreSQL database dump payload with secret wrapped tokens and metadata")

	ciphertext, err := EncryptPayload(plaintext, key)
	if err != nil {
		t.Fatalf("EncryptPayload failed: %v", err)
	}

	if bytes.Equal(ciphertext, plaintext) {
		t.Fatal("ciphertext must not equal plaintext")
	}

	// Verify magic header
	if !bytes.HasPrefix(ciphertext, MagicHeader) {
		t.Fatalf("ciphertext missing magic header %s", MagicHeader)
	}

	decrypted, err := DecryptPayload(ciphertext, key)
	if err != nil {
		t.Fatalf("DecryptPayload failed: %v", err)
	}

	if !bytes.Equal(decrypted, plaintext) {
		t.Fatalf("decrypted payload mismatch:\ngot:  %s\nwant: %s", string(decrypted), string(plaintext))
	}
}

func TestDecryptWithWrongKeyFails(t *testing.T) {
	keyA := generateRandomKey(t)
	keyB := generateRandomKey(t)
	plaintext := []byte("Sensitive customer metadata and root secrets")

	ciphertext, err := EncryptPayload(plaintext, keyA)
	if err != nil {
		t.Fatalf("EncryptPayload failed: %v", err)
	}

	_, err = DecryptPayload(ciphertext, keyB)
	if err == nil {
		t.Fatal("DecryptPayload with wrong key MUST fail, but returned success")
	}
}

func TestTamperedCiphertextFails(t *testing.T) {
	key := generateRandomKey(t)
	plaintext := []byte("Immutable audit records and delivery queues")

	ciphertext, err := EncryptPayload(plaintext, key)
	if err != nil {
		t.Fatalf("EncryptPayload failed: %v", err)
	}

	// Tamper with the last byte (part of authentication tag)
	tampered := make([]byte, len(ciphertext))
	copy(tampered, ciphertext)
	tampered[len(tampered)-1] ^= 0xFF

	_, err = DecryptPayload(tampered, key)
	if err == nil {
		t.Fatal("DecryptPayload on tampered ciphertext MUST fail, but returned success")
	}
}

func TestKeyParsingAndValidation(t *testing.T) {
	validRaw := "12345678901234567890123456789012"
	key, err := ParseEncryptionKey(validRaw)
	if err != nil || len(key) != 32 {
		t.Fatalf("failed to parse valid 32-byte raw key: %v", err)
	}

	validHex := hex.EncodeToString(generateRandomKey(t))
	keyHex, err := ParseEncryptionKey(validHex)
	if err != nil || len(keyHex) != 32 {
		t.Fatalf("failed to parse valid 64-hex char key: %v", err)
	}

	invalidShort := "too-short-key"
	_, err = ParseEncryptionKey(invalidShort)
	if err == nil {
		t.Fatal("expected error on short key, got nil")
	}
}

func TestKeyIsolationFromBackupDirectory(t *testing.T) {
	tempDir := t.TempDir()
	backupDir := filepath.Join(tempDir, "backups")
	if err := os.MkdirAll(backupDir, 0755); err != nil {
		t.Fatal(err)
	}

	keyInsideBackup := filepath.Join(backupDir, "backup.key")
	if err := os.WriteFile(keyInsideBackup, []byte(hex.EncodeToString(generateRandomKey(t))), 0600); err != nil {
		t.Fatal(err)
	}

	// Attempting to load key from inside backup dir must be rejected
	_, err := LoadEncryptionKey(keyInsideBackup, backupDir)
	if err == nil {
		t.Fatal("expected security violation when key is inside backup directory, got nil")
	}

	// Key outside backup dir must succeed
	keyOutside := filepath.Join(tempDir, "isolated.key")
	if err := os.WriteFile(keyOutside, []byte(hex.EncodeToString(generateRandomKey(t))), 0600); err != nil {
		t.Fatal(err)
	}

	_, err = LoadEncryptionKey(keyOutside, backupDir)
	if err != nil {
		t.Fatalf("expected success for isolated key outside backup dir, got: %v", err)
	}
}

func TestEncryptedArchivePackagingRoundtrip(t *testing.T) {
	key := generateRandomKey(t)
	bundle := &EncryptedBackupBundle{
		GlobalsSQL:   []byte("CREATE ROLE role_support_agent;"),
		DatabaseDump: []byte("PGDUMP_BINARY_DATA_REPRESENTATION"),
		ManifestJSON: []byte(`{"version":1,"records":100}`),
		CreatedAt:    time.Now().UTC(),
	}

	encryptedArchive, err := CreateEncryptedArchive(bundle, key)
	if err != nil {
		t.Fatalf("CreateEncryptedArchive failed: %v", err)
	}

	unpacked, err := DecryptAndUnpackArchive(encryptedArchive, key)
	if err != nil {
		t.Fatalf("DecryptAndUnpackArchive failed: %v", err)
	}

	if !bytes.Equal(unpacked.GlobalsSQL, bundle.GlobalsSQL) {
		t.Fatalf("globals.sql mismatch: got %s, want %s", string(unpacked.GlobalsSQL), string(bundle.GlobalsSQL))
	}
	if !bytes.Equal(unpacked.DatabaseDump, bundle.DatabaseDump) {
		t.Fatalf("database.dump mismatch: got %s, want %s", string(unpacked.DatabaseDump), string(bundle.DatabaseDump))
	}
	if !bytes.Equal(unpacked.ManifestJSON, bundle.ManifestJSON) {
		t.Fatalf("manifest.json mismatch: got %s, want %s", string(unpacked.ManifestJSON), string(bundle.ManifestJSON))
	}
}
