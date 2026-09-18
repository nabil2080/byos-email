package hpke_test

import (
	"bytes"
	"errors"
	"testing"

	"byos.email/crypto/envelope"
	"byos.email/crypto/hpke"
)

// TestDispatchRoundTripX25519 verifies round-trip Seal and Open using X25519 dispatch.
func TestDispatchRoundTripX25519(t *testing.T) {
	privR, pubR, err := hpke.GenerateKeyPairX25519()
	if err != nil {
		t.Fatalf("GenerateKeyPairX25519 failed: %v", err)
	}

	recipient := hpke.RecipientKey{
		Algorithm: envelope.AlgX25519,
		PublicKey: pubR,
	}

	plaintext := []byte("Hello, X25519 dispatch world!")
	keyID := "mbx_dispatch_x25519"
	keyEpoch := uint32(1)

	env, err := hpke.Seal(recipient, plaintext, keyID, keyEpoch)
	if err != nil {
		t.Fatalf("Seal failed: %v", err)
	}
	if env.Alg != envelope.AlgX25519 {
		t.Fatalf("Expected alg %s, got %s", envelope.AlgX25519, env.Alg)
	}

	recovered, err := hpke.Open(env, privR)
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	if !bytes.Equal(plaintext, recovered) {
		t.Fatalf("Recovered plaintext mismatch:\n  got:  %s\n  want: %s", string(recovered), string(plaintext))
	}
}

// TestDispatchRoundTripXWing verifies round-trip Seal and Open using X-Wing dispatch.
func TestDispatchRoundTripXWing(t *testing.T) {
	skSeed, pk, err := hpke.GenerateKeyPairXWing()
	if err != nil {
		t.Fatalf("GenerateKeyPairXWing failed: %v", err)
	}

	recipient := hpke.RecipientKey{
		Algorithm: envelope.AlgXWing,
		PublicKey: pk,
	}

	plaintext := []byte("Hello, post-quantum X-Wing dispatch world!")
	keyID := "mbx_dispatch_xwing"
	keyEpoch := uint32(1)

	env, err := hpke.Seal(recipient, plaintext, keyID, keyEpoch)
	if err != nil {
		t.Fatalf("Seal failed: %v", err)
	}
	if env.Alg != envelope.AlgXWing {
		t.Fatalf("Expected alg %s, got %s", envelope.AlgXWing, env.Alg)
	}

	recovered, err := hpke.Open(env, skSeed)
	if err != nil {
		t.Fatalf("Open failed: %v", err)
	}
	if !bytes.Equal(plaintext, recovered) {
		t.Fatalf("Recovered plaintext mismatch:\n  got:  %s\n  want: %s", string(recovered), string(plaintext))
	}
}

// TestDispatchAlgorithmKeyMismatch verifies that declaring an algorithm with mismatched public key
// length fails with ErrCodeInvalidKeyLength (1007).
func TestDispatchAlgorithmKeyMismatch(t *testing.T) {
	_, xwingPub, err := hpke.GenerateKeyPairXWing()
	if err != nil {
		t.Fatalf("GenerateKeyPairXWing failed: %v", err)
	}

	// 1. Seal with X25519 algorithm but pass X-Wing public key (1216 bytes instead of 32 bytes) -> 1007
	recipientMismatch := hpke.RecipientKey{
		Algorithm: envelope.AlgX25519,
		PublicKey: xwingPub,
	}
	_, err = hpke.Seal(recipientMismatch, []byte("payload"), "mbx_1", 1)
	if err == nil {
		t.Fatalf("Expected error for key length mismatch, got nil")
	}
	var envErr *envelope.EnvelopeError
	if !errors.As(err, &envErr) || envErr.Code != envelope.ErrCodeInvalidKeyLength {
		t.Fatalf("Expected code 1007 (InvalidKeyLength), got %v", err)
	}

	// 2. Seal with X-Wing algorithm but pass X25519 public key (32 bytes instead of 1216 bytes) -> 1007
	_, x25519Pub, err := hpke.GenerateKeyPairX25519()
	if err != nil {
		t.Fatalf("GenerateKeyPairX25519 failed: %v", err)
	}
	recipientMismatch2 := hpke.RecipientKey{
		Algorithm: envelope.AlgXWing,
		PublicKey: x25519Pub,
	}
	_, err = hpke.Seal(recipientMismatch2, []byte("payload"), "mbx_1", 1)
	if err == nil {
		t.Fatalf("Expected error for key length mismatch, got nil")
	}
	if !errors.As(err, &envErr) || envErr.Code != envelope.ErrCodeInvalidKeyLength {
		t.Fatalf("Expected code 1007 (InvalidKeyLength), got %v", err)
	}
}

// TestDispatchUnknownAlgorithm verifies that an unknown algorithm string fails with ErrCodeUnsupportedAlgorithm (1002).
func TestDispatchUnknownAlgorithm(t *testing.T) {
	// 1. Seal with unknown algorithm -> 1002
	recipient := hpke.RecipientKey{
		Algorithm: "HPKE-Kyber1024-ChaCha20Poly1305-v99",
		PublicKey: make([]byte, 32),
	}
	_, err := hpke.Seal(recipient, []byte("payload"), "mbx_1", 1)
	if err == nil {
		t.Fatalf("Expected error for unknown algorithm in Seal, got nil")
	}
	var envErr *envelope.EnvelopeError
	if !errors.As(err, &envErr) || envErr.Code != envelope.ErrCodeUnsupportedAlgorithm {
		t.Fatalf("Expected code 1002 (UnsupportedAlgorithm), got %v", err)
	}

	// 2. Open with unknown algorithm -> 1002
	env := &envelope.CryptoEnvelope{
		Alg:        "HPKE-Unknown-v1",
		Ciphertext: "dGVzdHRlc3R0ZXN0dGVzdA==",
		Enc:        "dGVzdHRlc3R0ZXN0dGVzdHRlc3R0ZXN0dGVzdHRlc3Q=",
		KeyEpoch:   1,
		KeyID:      "mbx_1",
		Nonce:      "MDEyMzQ1Njc4OWFi",
		Sig:        nil,
		V:          1,
	}
	_, err = hpke.Open(env, make([]byte, 32))
	if err == nil {
		t.Fatalf("Expected error for unknown algorithm in Open, got nil")
	}
	if !errors.As(err, &envErr) || envErr.Code != envelope.ErrCodeUnsupportedAlgorithm {
		t.Fatalf("Expected code 1002 (UnsupportedAlgorithm), got %v", err)
	}
}

// TestDispatchCrossAlgorithmIsolation verifies that attempting to open an envelope
// sealed under one algorithm using the other suite's private key produces
// ErrCodeDecryptionFailed (1006) and NEVER panics.
func TestDispatchCrossAlgorithmIsolation(t *testing.T) {
	x25519Priv, x25519Pub, err := hpke.GenerateKeyPairX25519()
	if err != nil {
		t.Fatalf("GenerateKeyPairX25519: %v", err)
	}
	xwingPrivSeed, xwingPub, err := hpke.GenerateKeyPairXWing()
	if err != nil {
		t.Fatalf("GenerateKeyPairXWing: %v", err)
	}

	plaintext := []byte("Top secret cross-suite payload")

	// 1. Seal X25519, open with X-Wing private key seed -> 1006
	envX25519, err := hpke.Seal(hpke.RecipientKey{
		Algorithm: envelope.AlgX25519,
		PublicKey: x25519Pub,
	}, plaintext, "mbx_x25519", 1)
	if err != nil {
		t.Fatalf("Seal X25519: %v", err)
	}

	_, err = hpke.Open(envX25519, xwingPrivSeed)
	if err == nil {
		t.Fatalf("Expected decryption failure opening X25519 envelope with X-Wing key, got nil")
	}
	var envErr *envelope.EnvelopeError
	if !errors.As(err, &envErr) || envErr.Code != envelope.ErrCodeDecryptionFailed {
		t.Fatalf("Expected code 1006 (DecryptionFailed), got %v", err)
	}

	// 2. Seal X-Wing, open with X25519 private key -> 1006
	envXWing, err := hpke.Seal(hpke.RecipientKey{
		Algorithm: envelope.AlgXWing,
		PublicKey: xwingPub,
	}, plaintext, "mbx_xwing", 1)
	if err != nil {
		t.Fatalf("Seal X-Wing: %v", err)
	}

	_, err = hpke.Open(envXWing, x25519Priv)
	if err == nil {
		t.Fatalf("Expected decryption failure opening X-Wing envelope with X25519 key, got nil")
	}
	if !errors.As(err, &envErr) || envErr.Code != envelope.ErrCodeDecryptionFailed {
		t.Fatalf("Expected code 1006 (DecryptionFailed), got %v", err)
	}
}

// TestDispatchPrivateKeyLengthMismatch verifies that passing an invalid private key length
// to Open returns ErrCodeInvalidKeyLength (1007).
func TestDispatchPrivateKeyLengthMismatch(t *testing.T) {
	_, x25519Pub, err := hpke.GenerateKeyPairX25519()
	if err != nil {
		t.Fatalf("GenerateKeyPairX25519: %v", err)
	}
	env, err := hpke.Seal(hpke.RecipientKey{
		Algorithm: envelope.AlgX25519,
		PublicKey: x25519Pub,
	}, []byte("payload"), "mbx_1", 1)
	if err != nil {
		t.Fatalf("Seal: %v", err)
	}

	badPrivKeys := [][]byte{
		nil,
		{},
		make([]byte, 16),
		make([]byte, 31),
		make([]byte, 33),
		make([]byte, 64),
	}

	for _, badPriv := range badPrivKeys {
		_, err := hpke.Open(env, badPriv)
		if err == nil {
			t.Fatalf("Expected error for bad private key length %d, got nil", len(badPriv))
		}
		var envErr *envelope.EnvelopeError
		if !errors.As(err, &envErr) || envErr.Code != envelope.ErrCodeInvalidKeyLength {
			t.Errorf("Length %d: expected ErrCodeInvalidKeyLength (1007), got %v", len(badPriv), err)
		}
	}
}
