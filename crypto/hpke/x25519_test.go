package hpke_test

import (
	"bytes"
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"testing"

	"byos.email/crypto/envelope"
	"byos.email/crypto/hpke"
)

// TestRoundTrip verifies key generation, sealing, and opening roundtrip.
func TestRoundTrip(t *testing.T) {
	privR, pubR, err := hpke.GenerateKeyPairX25519()
	if err != nil {
		t.Fatalf("GenerateKeyPairX25519 failed: %v", err)
	}

	plaintext := []byte("Subject: Confidential\r\n\r\nThis is a sovereign email message payload.")
	keyID := "mbx_client_alpha_001"
	keyEpoch := uint32(1)

	env, err := hpke.SealX25519(pubR, plaintext, keyID, keyEpoch)
	if err != nil {
		t.Fatalf("SealX25519 failed: %v", err)
	}

	// Validate envelope structure per B.2
	if err := envelope.Validate(env); err != nil {
		t.Fatalf("Generated envelope failed Validate: %v", err)
	}

	recovered, err := hpke.OpenX25519(privR, env)
	if err != nil {
		t.Fatalf("OpenX25519 failed: %v", err)
	}

	if !bytes.Equal(plaintext, recovered) {
		t.Fatalf("Decrypted plaintext does not match original:\n  got:  %s\n  want: %s", string(recovered), string(plaintext))
	}
}

// TestRFC9180VectorA11 verifies against RFC 9180 Appendix A.1.1 (Base Setup Information):
// KEM: 32 (DHKEM(X25519, HKDF-SHA256))
// KDF: 1 (HKDF-SHA256)
// AEAD: 1 (AES-128-GCM) / Key schedule primitives
func TestRFC9180VectorA11(t *testing.T) {
	skEmHex := "52c4a758a802cd8b936eceea314432798d5baf2d7e9235dc084ab1b9cfa2f736"
	pkRmHex := "3948cfe0ad1ddb695d780e59077195da6c56506b027329794ab02bca80815c4d"
	skRmHex := "4612c550263fc8ad58375df3f557aac531d26850903e55a9f23f21d8534e8ac8"
	expectedEncHex := "37fda3567bdbd628e88668c3c8d7e97d1d1253b6d4ea6d44c150f741f1bf4431"
	expectedSSHex := "fe0e18c9f024ce43799ae393c7e8fe8fce9d218875e8227b0187c04e7d2ea1fc"
	expectedSecretHex := "12fff91991e93b48de37e7daddb52981084bd8aa64289c3788471d9a9712f397"

	skEm, err := hex.DecodeString(skEmHex)
	if err != nil {
		t.Fatalf("Decode skEm: %v", err)
	}
	pkRm, err := hex.DecodeString(pkRmHex)
	if err != nil {
		t.Fatalf("Decode pkRm: %v", err)
	}
	skRm, err := hex.DecodeString(skRmHex)
	if err != nil {
		t.Fatalf("Decode skRm: %v", err)
	}

	curve := ecdh.X25519()
	privE, err := curve.NewPrivateKey(skEm)
	if err != nil {
		t.Fatalf("curve.NewPrivateKey(skEm): %v", err)
	}

	// 1. Encapsulate with known ephemeral private key skEm
	enc, sharedSecret, err := hpke.EncapsulateX25519WithKey(privE, pkRm)
	if err != nil {
		t.Fatalf("EncapsulateX25519WithKey failed: %v", err)
	}

	actualEncHex := hex.EncodeToString(enc)
	if actualEncHex != expectedEncHex {
		t.Fatalf("enc mismatch:\n  actual:   %s\n  expected: %s", actualEncHex, expectedEncHex)
	}

	actualSSHex := hex.EncodeToString(sharedSecret)
	if actualSSHex != expectedSSHex {
		t.Fatalf("shared_secret mismatch:\n  actual:   %s\n  expected: %s", actualSSHex, expectedSSHex)
	}

	// 2. Decapsulate with recipient private key skRm
	decapSS, err := hpke.DecapsulateX25519(skRm, enc)
	if err != nil {
		t.Fatalf("DecapsulateX25519 failed: %v", err)
	}
	actualDecapSSHex := hex.EncodeToString(decapSS)
	if actualDecapSSHex != expectedSSHex {
		t.Fatalf("Decapsulate shared_secret mismatch:\n  actual:   %s\n  expected: %s", actualDecapSSHex, expectedSSHex)
	}

	// 3. Verify RFC 9180 Section 5.1 secret derivation:
	// secret = LabeledExtract(shared_secret, "secret", psk="")
	suiteIDVector := []byte{0x48, 0x50, 0x4b, 0x45, 0x00, 0x20, 0x00, 0x01, 0x00, 0x01}
	secret := hpke.LabeledExtract(sharedSecret, "secret", nil, suiteIDVector)
	actualSecretHex := hex.EncodeToString(secret)
	if actualSecretHex != expectedSecretHex {
		t.Fatalf("secret mismatch:\n  actual:   %s\n  expected: %s", actualSecretHex, expectedSecretHex)
	}

	t.Logf("RFC 9180 Vector A.1.1 PASSED: enc=%s, ss=%s", actualEncHex, actualSSHex)
}

// TestRFC9180VectorA12KeySchedule verifies the key schedule intermediate values
// (secret, key, base_nonce) against RFC 9180 Appendix A.1.1 (referenced as A.1.2 in task).
//
// Technical Context on RFC 9180 Appendix A.1:
// - Appendix A.1.1 specifies Base Mode (mode 0) with DHKEM(X25519, HKDF-SHA256) + HKDF-SHA256 + AES-128-GCM.
// - Inputs:
//     shared_secret = fe0e18c9f024ce43799ae393c7e8fe8fce9d218875e8227b0187c04e7d2ea1fc
//     suite_id      = "HPKE" || 0x0020 || 0x0001 || 0x0001
// - Intermediate values published in RFC 9180 §A.1.1:
//     secret     = 12fff91991e93b48de37e7daddb52981084bd8aa64289c3788471d9a9712f397
//     key        = 4531685d41d65f03dc48f6b8302c05b0 (16 bytes for AES-128-GCM)
//     base_nonce = 56d890e5accaaf011cff4b7d (12 bytes)
func TestRFC9180VectorA12KeySchedule(t *testing.T) {
	sharedSecretHex := "fe0e18c9f024ce43799ae393c7e8fe8fce9d218875e8227b0187c04e7d2ea1fc"
	sharedSecret, err := hex.DecodeString(sharedSecretHex)
	if err != nil {
		t.Fatalf("Decode sharedSecret: %v", err)
	}

	// suite_id = "HPKE" || 0x0020 (DHKEM X25519) || 0x0001 (HKDF-SHA256) || 0x0001 (AES-128-GCM)
	suiteID := []byte{'H', 'P', 'K', 'E', 0x00, 0x20, 0x00, 0x01, 0x00, 0x01}

	// 1. Secret derivation per RFC 9180 §5.1:
	// secret = LabeledExtract(shared_secret, "secret", psk="")
	secret := hpke.LabeledExtract(sharedSecret, "secret", nil, suiteID)
	actualSecretHex := hex.EncodeToString(secret)
	expectedSecretHex := "12fff91991e93b48de37e7daddb52981084bd8aa64289c3788471d9a9712f397"
	if actualSecretHex != expectedSecretHex {
		t.Fatalf("secret mismatch:\n  actual:   %s\n  expected: %s", actualSecretHex, expectedSecretHex)
	}

	// 2. Key schedule context per RFC 9180 §5.1 for Appendix A.1.1 (Base Mode, info = "Ode on a Grecian Urn"):
	info := []byte("Ode on a Grecian Urn")
	pskIDHash := hpke.LabeledExtract(nil, "psk_id_hash", nil, suiteID)
	infoHash := hpke.LabeledExtract(nil, "info_hash", info, suiteID)
	ksContext := append([]byte{0x00}, append(pskIDHash, infoHash...)...)

	// 3. AEAD key (16 bytes for AES-128-GCM)
	key := hpke.LabeledExpand(secret, "key", ksContext, 16, suiteID)
	actualKeyHex := hex.EncodeToString(key)
	expectedKeyHex := "4531685d41d65f03dc48f6b8302c05b0"
	if actualKeyHex != expectedKeyHex {
		t.Fatalf("key mismatch:\n  actual:   %s\n  expected: %s", actualKeyHex, expectedKeyHex)
	}

	// 4. Base nonce (12 bytes)
	baseNonce := hpke.LabeledExpand(secret, "base_nonce", ksContext, 12, suiteID)
	actualNonceHex := hex.EncodeToString(baseNonce)
	expectedNonceHex := "56d890e5accaaf011cff4b7d"
	if actualNonceHex != expectedNonceHex {
		t.Fatalf("base_nonce mismatch:\n  actual:   %s\n  expected: %s", actualNonceHex, expectedNonceHex)
	}

	t.Logf("RFC 9180 Appendix A.1 Key Schedule PASSED:\n  secret:     %s\n  key (16B):  %s\n  base_nonce: %s",
		actualSecretHex, actualKeyHex, actualNonceHex)
}


// TestNegativeKeyLengths tests that public keys with length != 32 fail with ErrCodeInvalidKeyLength (1007).
func TestNegativeKeyLengths(t *testing.T) {
	badLengths := []int{0, 16, 31, 33, 64}
	for _, l := range badLengths {
		badPub := make([]byte, l)
		_, _, err := hpke.EncapsulateX25519(badPub)
		if err == nil {
			t.Fatalf("Expected error for pub key length %d, got nil", l)
		}
		envErr, ok := err.(*envelope.EnvelopeError)
		if !ok || envErr.Code != envelope.ErrCodeInvalidKeyLength {
			t.Errorf("Length %d: expected ErrCodeInvalidKeyLength (1007), got %v", l, err)
		}

		_, errSeal := hpke.SealX25519(badPub, []byte("test"), "mbx_1", 1)
		if errSeal == nil {
			t.Fatalf("Expected SealX25519 error for pub key length %d, got nil", l)
		}
		sealEnvErr, ok := errSeal.(*envelope.EnvelopeError)
		if !ok || sealEnvErr.Code != envelope.ErrCodeInvalidKeyLength {
			t.Errorf("Length %d: SealX25519 expected code 1007, got %v", l, errSeal)
		}
	}
}

// TestEmptyAndLargePlaintexts verifies that empty plaintext (0 bytes) and 1 MB plaintext
// are encrypted and decrypted correctly.
func TestEmptyAndLargePlaintexts(t *testing.T) {
	privR, pubR, err := hpke.GenerateKeyPairX25519()
	if err != nil {
		t.Fatalf("GenerateKeyPairX25519 failed: %v", err)
	}

	// 1. Empty plaintext
	emptyPlaintext := []byte{}
	envEmpty, err := hpke.SealX25519(pubR, emptyPlaintext, "mbx_empty", 1)
	if err != nil {
		t.Fatalf("SealX25519 empty failed: %v", err)
	}
	recoveredEmpty, err := hpke.OpenX25519(privR, envEmpty)
	if err != nil {
		t.Fatalf("OpenX25519 empty failed: %v", err)
	}
	if len(recoveredEmpty) != 0 {
		t.Fatalf("Expected empty recovered plaintext, got %d bytes", len(recoveredEmpty))
	}

	// 2. Large plaintext: 1 MB
	largePlaintext := make([]byte, 1024*1024)
	if _, err := rand.Read(largePlaintext); err != nil {
		t.Fatalf("Generating random 1MB payload: %v", err)
	}
	envLarge, err := hpke.SealX25519(pubR, largePlaintext, "mbx_large", 1)
	if err != nil {
		t.Fatalf("SealX25519 large failed: %v", err)
	}
	recoveredLarge, err := hpke.OpenX25519(privR, envLarge)
	if err != nil {
		t.Fatalf("OpenX25519 large failed: %v", err)
	}
	if !bytes.Equal(largePlaintext, recoveredLarge) {
		t.Fatalf("Large 1MB recovered plaintext mismatch")
	}
}

// TestAADIntegrationAndTampering verifies that tampering with any field in the envelope
// (including AAD fields like Enc, Nonce, KeyID, KeyEpoch, or Ciphertext) triggers
// DecryptionFailed (1006).
func TestAADIntegrationAndTampering(t *testing.T) {
	privR, pubR, err := hpke.GenerateKeyPairX25519()
	if err != nil {
		t.Fatalf("GenerateKeyPairX25519 failed: %v", err)
	}

	plaintext := []byte("Sensitive mailbox data")
	env, err := hpke.SealX25519(pubR, plaintext, "mbx_tamper_test", 1)
	if err != nil {
		t.Fatalf("SealX25519 failed: %v", err)
	}

	// 1. Tamper with Enc
	t.Run("TamperEnc", func(t *testing.T) {
		tampered := *env
		rawEnc, _ := base64.StdEncoding.DecodeString(tampered.Enc)
		rawEnc[0] ^= 0x01
		tampered.Enc = base64.StdEncoding.EncodeToString(rawEnc)

		_, err := hpke.OpenX25519(privR, &tampered)
		if err == nil {
			t.Fatalf("Expected error when Enc is tampered, got nil")
		}
		envErr, ok := err.(*envelope.EnvelopeError)
		if !ok || envErr.Code != envelope.ErrCodeDecryptionFailed {
			t.Errorf("Expected code 1006 for tampered Enc, got %v", err)
		}
	})

	// 2. Tamper with Ciphertext
	t.Run("TamperCiphertext", func(t *testing.T) {
		tampered := *env
		rawCt, _ := base64.StdEncoding.DecodeString(tampered.Ciphertext)
		rawCt[0] ^= 0x01
		tampered.Ciphertext = base64.StdEncoding.EncodeToString(rawCt)

		_, err := hpke.OpenX25519(privR, &tampered)
		if err == nil {
			t.Fatalf("Expected error when Ciphertext is tampered, got nil")
		}
		envErr, ok := err.(*envelope.EnvelopeError)
		if !ok || envErr.Code != envelope.ErrCodeDecryptionFailed {
			t.Errorf("Expected code 1006 for tampered Ciphertext, got %v", err)
		}
	})

	// 3. Tamper with Nonce
	t.Run("TamperNonce", func(t *testing.T) {
		tampered := *env
		rawNonce, _ := base64.StdEncoding.DecodeString(tampered.Nonce)
		rawNonce[0] ^= 0x01
		tampered.Nonce = base64.StdEncoding.EncodeToString(rawNonce)

		_, err := hpke.OpenX25519(privR, &tampered)
		if err == nil {
			t.Fatalf("Expected error when Nonce is tampered, got nil")
		}
		envErr, ok := err.(*envelope.EnvelopeError)
		if !ok || envErr.Code != envelope.ErrCodeDecryptionFailed {
			t.Errorf("Expected code 1006 for tampered Nonce, got %v", err)
		}
	})

	// 4. Tamper with KeyEpoch
	t.Run("TamperKeyEpoch", func(t *testing.T) {
		tampered := *env
		tampered.KeyEpoch = 2

		_, err := hpke.OpenX25519(privR, &tampered)
		if err == nil {
			t.Fatalf("Expected error when KeyEpoch is tampered, got nil")
		}
		envErr, ok := err.(*envelope.EnvelopeError)
		if !ok || envErr.Code != envelope.ErrCodeDecryptionFailed {
			t.Errorf("Expected code 1006 for tampered KeyEpoch, got %v", err)
		}
	})

	// 5. Tamper with KeyID
	t.Run("TamperKeyID", func(t *testing.T) {
		tampered := *env
		tampered.KeyID = "mbx_different_id"

		_, err := hpke.OpenX25519(privR, &tampered)
		if err == nil {
			t.Fatalf("Expected error when KeyID is tampered, got nil")
		}
		envErr, ok := err.(*envelope.EnvelopeError)
		if !ok || envErr.Code != envelope.ErrCodeDecryptionFailed {
			t.Errorf("Expected code 1006 for tampered KeyID, got %v", err)
		}
	})
}
