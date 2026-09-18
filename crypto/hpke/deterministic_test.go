package hpke

import (
	"bytes"
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"testing"

	"byos.email/crypto/envelope"
)

// TestDeterministicSealX25519 verifies that sealX25519Deterministic produces
// valid, byte-reproducible envelopes that decrypt correctly and match shared secret derivations.
func TestDeterministicSealX25519(t *testing.T) {
	privR, pubR, err := GenerateKeyPairX25519()
	if err != nil {
		t.Fatalf("GenerateKeyPairX25519: %v", err)
	}

	ephPriv, _, err := GenerateKeyPairX25519()
	if err != nil {
		t.Fatalf("GenerateKeyPairX25519 ephemeral: %v", err)
	}

	nonce := make([]byte, envelope.NonceSize)
	if _, err := rand.Read(nonce); err != nil {
		t.Fatalf("rand.Read nonce: %v", err)
	}

	plaintext := []byte("Subject: Deterministic Parity Check\r\n\r\nPayload for X25519.")
	keyID := "mbx_det_x25519"
	keyEpoch := uint32(1)

	// 1. Seal with fixed ephemeral key and fixed nonce
	env1, err := sealX25519Deterministic(pubR, ephPriv, plaintext, nonce, keyID, keyEpoch)
	if err != nil {
		t.Fatalf("sealX25519Deterministic 1 failed: %v", err)
	}

	// 2. Seal again with exact same inputs -> must be byte-identical
	env2, err := sealX25519Deterministic(pubR, ephPriv, plaintext, nonce, keyID, keyEpoch)
	if err != nil {
		t.Fatalf("sealX25519Deterministic 2 failed: %v", err)
	}

	canon1, err := envelope.MarshalCanonical(env1)
	if err != nil {
		t.Fatalf("MarshalCanonical 1: %v", err)
	}
	canon2, err := envelope.MarshalCanonical(env2)
	if err != nil {
		t.Fatalf("MarshalCanonical 2: %v", err)
	}
	if !bytes.Equal(canon1, canon2) {
		t.Fatalf("Deterministic seal output is not byte-identical:\n  run1: %s\n  run2: %s", string(canon1), string(canon2))
	}

	// 3. Verify envelope opens correctly
	recovered, err := OpenX25519(privR, env1)
	if err != nil {
		t.Fatalf("OpenX25519 failed: %v", err)
	}
	if !bytes.Equal(plaintext, recovered) {
		t.Fatalf("Recovered plaintext mismatch:\n  got:  %s\n  want: %s", string(recovered), string(plaintext))
	}

	// 4. Verify shared secret consistency with EncapsulateX25519WithKey
	curve := ecdh.X25519()
	ephKey, err := curve.NewPrivateKey(ephPriv)
	if err != nil {
		t.Fatalf("curve.NewPrivateKey: %v", err)
	}
	expectedEnc, expectedSS, err := EncapsulateX25519WithKey(ephKey, pubR)
	if err != nil {
		t.Fatalf("EncapsulateX25519WithKey: %v", err)
	}
	rawEnc, err := base64.StdEncoding.DecodeString(env1.Enc)
	if err != nil {
		t.Fatalf("DecodeString enc: %v", err)
	}
	if !bytes.Equal(rawEnc, expectedEnc) {
		t.Fatalf("Enc bytes mismatch:\n  got:  %x\n  want: %x", rawEnc, expectedEnc)
	}

	decapSS, err := DecapsulateX25519(privR, rawEnc)
	if err != nil {
		t.Fatalf("DecapsulateX25519: %v", err)
	}
	if !bytes.Equal(decapSS, expectedSS) {
		t.Fatalf("Shared secret mismatch:\n  got:  %x\n  want: %x", decapSS, expectedSS)
	}

	t.Logf("Deterministic X25519 Seal test PASSED: ss=%x", decapSS)
}

// TestDeterministicSealXWing verifies that sealXWingDeterministic produces
// valid, byte-reproducible envelopes that decrypt correctly.
func TestDeterministicSealXWing(t *testing.T) {
	skSeed, pk, err := GenerateKeyPairXWing()
	if err != nil {
		t.Fatalf("GenerateKeyPairXWing: %v", err)
	}

	eseed := make([]byte, 64)
	if _, err := rand.Read(eseed); err != nil {
		t.Fatalf("rand.Read eseed: %v", err)
	}

	nonce := make([]byte, envelope.NonceSize)
	if _, err := rand.Read(nonce); err != nil {
		t.Fatalf("rand.Read nonce: %v", err)
	}

	plaintext := []byte("Subject: Post-Quantum Parity Check\r\n\r\nDeterministic X-Wing payload.")
	keyID := "mbx_det_xwing"
	keyEpoch := uint32(1)

	// 1. Seal with fixed eseed and fixed nonce
	env1, err := sealXWingDeterministic(pk, eseed, plaintext, nonce, keyID, keyEpoch)
	if err != nil {
		t.Fatalf("sealXWingDeterministic 1 failed: %v", err)
	}

	// 2. Seal again with exact same inputs -> must be byte-identical
	env2, err := sealXWingDeterministic(pk, eseed, plaintext, nonce, keyID, keyEpoch)
	if err != nil {
		t.Fatalf("sealXWingDeterministic 2 failed: %v", err)
	}

	canon1, err := envelope.MarshalCanonical(env1)
	if err != nil {
		t.Fatalf("MarshalCanonical 1: %v", err)
	}
	canon2, err := envelope.MarshalCanonical(env2)
	if err != nil {
		t.Fatalf("MarshalCanonical 2: %v", err)
	}
	if !bytes.Equal(canon1, canon2) {
		t.Fatalf("Deterministic X-Wing seal output is not byte-identical:\n  run1: %s\n  run2: %s", string(canon1), string(canon2))
	}

	// 3. Verify envelope opens correctly
	recovered, err := OpenXWing(skSeed, env1)
	if err != nil {
		t.Fatalf("OpenXWing failed: %v", err)
	}
	if !bytes.Equal(plaintext, recovered) {
		t.Fatalf("Recovered plaintext mismatch:\n  got:  %s\n  want: %s", string(recovered), string(plaintext))
	}

	// 4. Verify decapsulation works on the deterministic enc
	rawEnc, err := base64.StdEncoding.DecodeString(env1.Enc)
	if err != nil {
		t.Fatalf("DecodeString enc: %v", err)
	}
	ss, err := DecapsulateXWing(skSeed, rawEnc)
	if err != nil {
		t.Fatalf("DecapsulateXWing failed: %v", err)
	}
	if len(ss) != 32 {
		t.Fatalf("Expected 32-byte shared secret, got %d", len(ss))
	}

	t.Logf("Deterministic X-Wing Seal test PASSED: ss=%x", ss)
}
