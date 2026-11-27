package main

import (
	"context"
	"testing"
)

func TestKMS_RotationAndHistoricalAccess(t *testing.T) {
	ctx := context.Background()

	keyHex, err := GenerateRandomKeyHex()
	if err != nil {
		t.Fatalf("failed to generate random key: %v", err)
	}

	kms, err := NewEnvKeyProvider(keyHex, "v1")
	if err != nil {
		t.Fatalf("failed to create KMS provider: %v", err)
	}

	// 1. Verify initial active key is v1
	active, err := kms.GetActiveKey(ctx)
	if err != nil {
		t.Fatalf("failed to get active key: %v", err)
	}
	if active.VersionID != "v1" {
		t.Errorf("expected version v1, got %s", active.VersionID)
	}
	if active.Status != "active" {
		t.Errorf("expected status active, got %s", active.Status)
	}

	// 2. Rotate key to v2
	rotated, err := kms.RotateKey(ctx)
	if err != nil {
		t.Fatalf("failed to rotate key: %v", err)
	}
	if rotated.VersionID != "v2" {
		t.Errorf("expected version v2 after rotation, got %s", rotated.VersionID)
	}

	// Active key must now be v2
	newActive, err := kms.GetActiveKey(ctx)
	if err != nil {
		t.Fatalf("failed to get new active key: %v", err)
	}
	if newActive.VersionID != "v2" {
		t.Errorf("expected new active version v2, got %s", newActive.VersionID)
	}

	// 3. Historical key v1 must still be retrievable and marked as retired
	historical, err := kms.GetKeyVersion(ctx, "v1")
	if err != nil {
		t.Fatalf("failed to get historical key v1: %v", err)
	}
	if historical.Status != "retired" {
		t.Errorf("expected historical key status 'retired', got %s", historical.Status)
	}

	// 4. Missing key version returns ErrKeyNotFound
	_, err = kms.GetKeyVersion(ctx, "v999")
	if err == nil {
		t.Errorf("expected error for non-existent key version, got nil")
	}

	// 5. Revoking key v1 prevents subsequent access
	if err := kms.RevokeKey(ctx, "v1"); err != nil {
		t.Fatalf("failed to revoke key v1: %v", err)
	}
	_, err = kms.GetKeyVersion(ctx, "v1")
	if err == nil {
		t.Errorf("expected error accessing revoked key, got nil")
	}

	// 6. Cannot revoke active key
	if err := kms.RevokeKey(ctx, "v2"); err == nil {
		t.Errorf("expected error revoking active key, got nil")
	}
}
