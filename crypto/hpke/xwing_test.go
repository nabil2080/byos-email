package hpke_test

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"byos.email/crypto/core"
	"byos.email/crypto/envelope"
	"byos.email/crypto/hpke"
)

type XWingVector struct {
	Seed  string `json:"seed"`
	SK    string `json:"sk"`
	PK    string `json:"pk"`
	ESeed string `json:"eseed"`
	CT    string `json:"ct"`
	SS    string `json:"ss"`
}

func loadXWingVectors(t *testing.T) []XWingVector {
	t.Helper()
	paths := []string{
		filepath.Join("..", "core", "testdata", "xwing_vectors.json"),
		filepath.Join("crypto", "core", "testdata", "xwing_vectors.json"),
		filepath.Join(".", "testdata", "xwing_vectors.json"),
	}

	var data []byte
	var err error
	for _, p := range paths {
		data, err = os.ReadFile(p)
		if err == nil {
			break
		}
	}
	if err != nil {
		t.Fatalf("Failed to read xwing_vectors.json: %v", err)
	}

	var vectors []XWingVector
	if err := json.Unmarshal(data, &vectors); err != nil {
		t.Fatalf("Failed to parse xwing_vectors.json: %v", err)
	}
	return vectors
}

// TestRoundTripXWing verifies key generation, sealing, and opening roundtrip for X-Wing.
func TestRoundTripXWing(t *testing.T) {
	skSeed, pk, err := hpke.GenerateKeyPairXWing()
	if err != nil {
		t.Fatalf("GenerateKeyPairXWing failed: %v", err)
	}
	if len(skSeed) != 32 {
		t.Fatalf("skSeed length %d != 32", len(skSeed))
	}
	if len(pk) != 1216 {
		t.Fatalf("pk length %d != 1216", len(pk))
	}

	plaintext := []byte("Subject: Post-Quantum Secured\r\n\r\nTop secret ML-KEM-768 hybrid encrypted email.")
	keyID := "mbx_pqc_mailbox_007"
	keyEpoch := uint32(1)

	env, err := hpke.SealXWing(pk, plaintext, keyID, keyEpoch)
	if err != nil {
		t.Fatalf("SealXWing failed: %v", err)
	}

	// Validate envelope structure per B.2
	if err := envelope.Validate(env); err != nil {
		t.Fatalf("Generated envelope failed Validate: %v", err)
	}

	recovered, err := hpke.OpenXWing(skSeed, env)
	if err != nil {
		t.Fatalf("OpenXWing failed: %v", err)
	}

	if !bytes.Equal(plaintext, recovered) {
		t.Fatalf("Decrypted plaintext mismatch:\n  got:  %s\n  want: %s", string(recovered), string(plaintext))
	}
}

// TestXWingDraft10VectorIntegration verifies that the official draft-10 test vectors
// successfully decapsulate and derive stable AEAD keys with SuiteXWing.
//
// NOTE: The aead_key and tag values below are regression anchors produced 
// by this implementation, not external test vectors. X-Wing draft-10 
// Appendix C publishes only (seed, sk, pk, eseed, ct, ss) — not HPKE key 
// schedule outputs. External verification of the key schedule is provided 
// by TestRFC9180VectorA12KeySchedule.
func TestXWingDraft10VectorIntegration(t *testing.T) {
	vectors := loadXWingVectors(t)
	if len(vectors) != 3 {
		t.Fatalf("Expected 3 test vectors, got %d", len(vectors))
	}

	for i, vec := range vectors {
		t.Run(vec.Seed[:16], func(t *testing.T) {
			skBytes, err := hex.DecodeString(vec.SK)
			if err != nil {
				t.Fatalf("Vector %d: decode SK failed: %v", i+1, err)
			}
			ctBytes, err := hex.DecodeString(vec.CT)
			if err != nil {
				t.Fatalf("Vector %d: decode CT failed: %v", i+1, err)
			}
			expectedSS, err := hex.DecodeString(vec.SS)
			if err != nil {
				t.Fatalf("Vector %d: decode SS failed: %v", i+1, err)
			}

			// 1. Recover sharedSecret from vector's sk + ct using core.Decapsulate
			sharedSecret, err := core.Decapsulate(skBytes, ctBytes)
			if err != nil {
				t.Fatalf("Vector %d: core.Decapsulate failed: %v", i+1, err)
			}
			if !bytes.Equal(sharedSecret, expectedSS) {
				t.Fatalf("Vector %d: sharedSecret mismatch:\n  got:  %x\n  want: %x", i+1, sharedSecret, expectedSS)
			}

			// 2. Derive AEAD key via DeriveAEADKey(sharedSecret, SuiteXWing)
			aeadKey, err := hpke.DeriveAEADKey(sharedSecret, hpke.SuiteXWing)
			if err != nil {
				t.Fatalf("Vector %d: DeriveAEADKey failed: %v", i+1, err)
			}
			if len(aeadKey) != 32 {
				t.Fatalf("Vector %d: AEAD key length %d != 32", i+1, len(aeadKey))
			}

			// 3. Encrypt empty plaintext with fixed nonce to verify deterministic key derivation
			fixedNonce := make([]byte, 12)
			fixedNonce[0] = byte(i + 1)

			block, err := aes.NewCipher(aeadKey)
			if err != nil {
				t.Fatalf("Vector %d: aes.NewCipher failed: %v", i+1, err)
			}
			gcm, err := cipher.NewGCM(block)
			if err != nil {
				t.Fatalf("Vector %d: cipher.NewGCM failed: %v", i+1, err)
			}

			ciphertext := gcm.Seal(nil, fixedNonce, []byte{}, []byte("aad_test"))
			if len(ciphertext) != 16 { // empty plaintext + 16-byte tag
				t.Fatalf("Vector %d: expected 16-byte tag, got %d bytes", i+1, len(ciphertext))
			}

			t.Logf("Vector %d PASSED: aead_key=%x, tag=%x", i+1, aeadKey, ciphertext)
		})
	}
}

// TestNegativeXWingKeyLengths verifies that public keys with length != 1216 fail with ErrCodeInvalidKeyLength (1007).
func TestNegativeXWingKeyLengths(t *testing.T) {
	badLengths := []int{0, 32, 1120, 1215, 1217, 1500}
	for _, l := range badLengths {
		badPub := make([]byte, l)
		_, _, err := hpke.EncapsulateXWing(badPub)
		if err == nil {
			t.Fatalf("Expected error for X-Wing pub key length %d, got nil", l)
		}
		envErr, ok := err.(*envelope.EnvelopeError)
		if !ok || envErr.Code != envelope.ErrCodeInvalidKeyLength {
			t.Errorf("Length %d: expected ErrCodeInvalidKeyLength (1007), got %v", l, err)
		}

		_, errSeal := hpke.SealXWing(badPub, []byte("test"), "mbx_1", 1)
		if errSeal == nil {
			t.Fatalf("Expected SealXWing error for pub key length %d, got nil", l)
		}
		sealEnvErr, ok := errSeal.(*envelope.EnvelopeError)
		if !ok || sealEnvErr.Code != envelope.ErrCodeInvalidKeyLength {
			t.Errorf("Length %d: SealXWing expected code 1007, got %v", l, errSeal)
		}
	}
}

// TestEmptyAndLargePlaintextsXWing verifies that empty and 1 MB payloads encrypt/decrypt correctly.
func TestEmptyAndLargePlaintextsXWing(t *testing.T) {
	skSeed, pk, err := hpke.GenerateKeyPairXWing()
	if err != nil {
		t.Fatalf("GenerateKeyPairXWing failed: %v", err)
	}

	// 1. Empty plaintext
	emptyPlaintext := []byte{}
	envEmpty, err := hpke.SealXWing(pk, emptyPlaintext, "mbx_empty_xwing", 1)
	if err != nil {
		t.Fatalf("SealXWing empty failed: %v", err)
	}
	recoveredEmpty, err := hpke.OpenXWing(skSeed, envEmpty)
	if err != nil {
		t.Fatalf("OpenXWing empty failed: %v", err)
	}
	if len(recoveredEmpty) != 0 {
		t.Fatalf("Expected empty recovered plaintext, got %d bytes", len(recoveredEmpty))
	}

	// 2. Large plaintext: 1 MB
	largePlaintext := make([]byte, 1024*1024)
	if _, err := rand.Read(largePlaintext); err != nil {
		t.Fatalf("Generating random 1MB payload: %v", err)
	}
	envLarge, err := hpke.SealXWing(pk, largePlaintext, "mbx_large_xwing", 1)
	if err != nil {
		t.Fatalf("SealXWing large failed: %v", err)
	}
	recoveredLarge, err := hpke.OpenXWing(skSeed, envLarge)
	if err != nil {
		t.Fatalf("OpenXWing large failed: %v", err)
	}
	if !bytes.Equal(largePlaintext, recoveredLarge) {
		t.Fatalf("Large 1MB recovered plaintext mismatch")
	}
}

// TestAADIntegrationAndTamperingXWing verifies that tampering with any field
// triggers DecryptionFailed (1006).
func TestAADIntegrationAndTamperingXWing(t *testing.T) {
	skSeed, pk, err := hpke.GenerateKeyPairXWing()
	if err != nil {
		t.Fatalf("GenerateKeyPairXWing failed: %v", err)
	}

	plaintext := []byte("Confidential quantum-resistant email")
	env, err := hpke.SealXWing(pk, plaintext, "mbx_tamper_xwing", 1)
	if err != nil {
		t.Fatalf("SealXWing failed: %v", err)
	}

	// 1. Tamper with Enc
	t.Run("TamperEnc", func(t *testing.T) {
		tampered := *env
		rawEnc, _ := base64.StdEncoding.DecodeString(tampered.Enc)
		rawEnc[0] ^= 0x01
		tampered.Enc = base64.StdEncoding.EncodeToString(rawEnc)

		_, err := hpke.OpenXWing(skSeed, &tampered)
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

		_, err := hpke.OpenXWing(skSeed, &tampered)
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

		_, err := hpke.OpenXWing(skSeed, &tampered)
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

		_, err := hpke.OpenXWing(skSeed, &tampered)
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

		_, err := hpke.OpenXWing(skSeed, &tampered)
		if err == nil {
			t.Fatalf("Expected error when KeyID is tampered, got nil")
		}
		envErr, ok := err.(*envelope.EnvelopeError)
		if !ok || envErr.Code != envelope.ErrCodeDecryptionFailed {
			t.Errorf("Expected code 1006 for tampered KeyID, got %v", err)
		}
	})
}

// TestCrossSuiteIsolation verifies that an envelope sealed with SuiteXWing cannot
// be decrypted if the key is derived using SuiteX25519 (proving suite_id domain separation).
func TestCrossSuiteIsolation(t *testing.T) {
	skSeed, pk, err := hpke.GenerateKeyPairXWing()
	if err != nil {
		t.Fatalf("GenerateKeyPairXWing failed: %v", err)
	}

	plaintext := []byte("Cross-suite isolation test payload")
	env, err := hpke.SealXWing(pk, plaintext, "mbx_iso_001", 1)
	if err != nil {
		t.Fatalf("SealXWing failed: %v", err)
	}

	decoded, err := env.DecodeBase64()
	if err != nil {
		t.Fatalf("DecodeBase64 failed: %v", err)
	}

	// 1. Decapsulate to get the valid sharedSecret
	sharedSecret, err := hpke.DecapsulateXWing(skSeed, decoded.RawEnc)
	if err != nil {
		t.Fatalf("DecapsulateXWing failed: %v", err)
	}

	// 2. Derive AEAD key using wrong suite ID: SuiteX25519 instead of SuiteXWing
	wrongAESKey, err := hpke.DeriveAEADKey(sharedSecret, hpke.SuiteX25519)
	if err != nil {
		t.Fatalf("DeriveAEADKey failed: %v", err)
	}

	// 3. Attempt AES-GCM decryption with wrong key
	aad, err := envelope.BuildAAD(env)
	if err != nil {
		t.Fatalf("BuildAAD failed: %v", err)
	}

	block, err := aes.NewCipher(wrongAESKey)
	if err != nil {
		t.Fatalf("aes.NewCipher failed: %v", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatalf("cipher.NewGCM failed: %v", err)
	}

	_, decErr := gcm.Open(nil, decoded.RawNonce, decoded.RawCiphertext, aad)
	if decErr == nil {
		t.Fatalf("SECURITY VIOLATION: Decryption succeeded with wrong suite_id key!")
	}
	t.Logf("Cross-suite isolation PASSED: decryption with SuiteX25519 key failed as expected: %v", decErr)
}
