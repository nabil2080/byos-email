package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/aws/aws-sdk-go-v2/service/kms"
)

type mockAWSKMSClient struct {
	blobs map[string]struct {
		plaintext []byte
		encCtx    string
	}
}

func newMockAWSKMSClient() *mockAWSKMSClient {
	return &mockAWSKMSClient{
		blobs: make(map[string]struct {
			plaintext []byte
			encCtx    string
		}),
	}
}

func (m *mockAWSKMSClient) GenerateDataKey(ctx context.Context, params *kms.GenerateDataKeyInput, optFns ...func(*kms.Options)) (*kms.GenerateDataKeyOutput, error) {
	dek := make([]byte, 32)
	if _, err := rand.Read(dek); err != nil {
		return nil, err
	}
	// Prefix ciphertext blob so it is cryptographically distinct from plaintext DEK
	blob := append([]byte("KMS_WRAPPED_BLOB:"), dek...)
	for i := 17; i < len(blob); i++ {
		blob[i] ^= 0xA5
	}
	ctxKey := params.EncryptionContext["byos_key_version"] + ":" + params.EncryptionContext["byos_purpose"]
	m.blobs[string(blob)] = struct {
		plaintext []byte
		encCtx    string
	}{plaintext: dek, encCtx: ctxKey}

	return &kms.GenerateDataKeyOutput{
		KeyId:          params.KeyId,
		Plaintext:      dek,
		CiphertextBlob: blob,
	}, nil
}

func (m *mockAWSKMSClient) Decrypt(ctx context.Context, params *kms.DecryptInput, optFns ...func(*kms.Options)) (*kms.DecryptOutput, error) {
	entry, ok := m.blobs[string(params.CiphertextBlob)]
	if !ok {
		return nil, errors.New("InvalidCiphertextException")
	}
	reqCtx := params.EncryptionContext["byos_key_version"] + ":" + params.EncryptionContext["byos_purpose"]
	if reqCtx != entry.encCtx {
		return nil, fmt.Errorf("InvalidCiphertextException: encryption context mismatch")
	}
	return &kms.DecryptOutput{
		Plaintext: entry.plaintext,
	}, nil
}

func TestAWSKMS_GenerateRotateDecryptAndNoPlaintextPersisted(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStorage(0)
	mockKMS := newMockAWSKMSClient()
	keyARN := "arn:aws:kms:us-east-1:123456789012:key/test-cmk"

	provider, err := NewAWSKMSKeyProvider(ctx, mockKMS, keyARN, store)
	if err != nil {
		t.Fatal(err)
	}

	// Generate v1
	kv1, err := provider.RotateKey(ctx)
	if err != nil {
		t.Fatalf("RotateKey v1 failed: %v", err)
	}
	if kv1.VersionID != "v1" || len(kv1.Key) != 32 {
		t.Fatalf("unexpected v1 key: %+v", kv1)
	}

	// Rotate to v2
	kv2, err := provider.RotateKey(ctx)
	if err != nil {
		t.Fatalf("RotateKey v2 failed: %v", err)
	}
	if kv2.VersionID != "v2" || bytes.Equal(kv1.Key, kv2.Key) {
		t.Fatalf("expected distinct v2 key")
	}

	// Verify ZERO plaintext key bytes or hex exist in stored envelope JSON
	rawEnv, _, err := store.Get(ctx, remoteKeyEnvelopesKey)
	if err != nil {
		t.Fatal(err)
	}
	rawStr := string(rawEnv)
	if strings.Contains(rawStr, hex.EncodeToString(kv1.Key)) ||
		strings.Contains(rawStr, base64.StdEncoding.EncodeToString(kv1.Key)) ||
		strings.Contains(rawStr, hex.EncodeToString(kv2.Key)) {
		t.Fatalf("SECURITY VIOLATION: plaintext DEK found in stored KMS envelope manifest")
	}

	// Simulate fresh recovery host with empty cache loading envelopes independently from store
	recoveryProvider, err := NewAWSKMSKeyProvider(ctx, mockKMS, keyARN, store)
	if err != nil {
		t.Fatal(err)
	}
	recV1, err := recoveryProvider.GetKeyVersion(ctx, "v1")
	if err != nil || !bytes.Equal(recV1.Key, kv1.Key) {
		t.Fatalf("failed independent historical v1 unwrap: %v", err)
	}
	recV2, err := recoveryProvider.GetActiveKey(ctx)
	if err != nil || !bytes.Equal(recV2.Key, kv2.Key) {
		t.Fatalf("failed independent active v2 unwrap: %v", err)
	}

	// Revoke v1 and verify fail-closed rejection
	if err := recoveryProvider.RevokeKey(ctx, "v1"); err != nil {
		t.Fatal(err)
	}
	if _, err := recoveryProvider.GetKeyVersion(ctx, "v1"); !errors.Is(err, ErrKeyRevoked) {
		t.Fatalf("expected ErrKeyRevoked for revoked v1, got: %v", err)
	}
	if _, err := recoveryProvider.GetKeyVersion(ctx, "v99"); !errors.Is(err, ErrKeyNotFound) {
		t.Fatalf("expected ErrKeyNotFound for missing v99, got: %v", err)
	}
}
