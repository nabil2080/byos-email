package hpke

import (
	"bytes"
	"crypto/ecdh"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"byos.email/crypto/core"
	"byos.email/crypto/envelope"
)

// VectorSuite represents the top-level structure of cross_language_vectors.json.
type VectorSuite struct {
	Warning string                `json:"_warning"`
	Vectors []CrossLanguageVector `json:"vectors"`
}

// CrossLanguageVector represents a deterministic test vector for cross-language verification.
type CrossLanguageVector struct {
	ID                     string `json:"id"`
	Description            string `json:"description"`
	TestOnly               bool   `json:"_test_only"`
	Algorithm              string `json:"algorithm"`
	KeyID                  string `json:"key_id"`
	KeyEpoch               uint32 `json:"key_epoch"`
	RecipientPublicKeyHex  string `json:"recipient_public_key_hex"`
	RecipientPrivateKeyHex string `json:"test_only_recipient_private_key_hex"`
	EphemeralPrivateKeyHex string `json:"test_only_ephemeral_private_key_hex,omitempty"`
	ESeedHex               string `json:"test_only_eseed_hex,omitempty"`
	NonceHex               string `json:"nonce_hex"`

	// Full vector fields (for small payloads)
	Plaintext                 string                  `json:"plaintext,omitempty"`
	PlaintextHex              string                  `json:"plaintext_hex,omitempty"`
	PlaintextLen              int                     `json:"plaintext_len,omitempty"`
	ExpectedAADHex            string                  `json:"expected_aad_hex,omitempty"`
	ExpectedEnvelopeCanonical string                  `json:"expected_envelope_canonical,omitempty"`
	ExpectedEnvelope          *envelope.CryptoEnvelope `json:"expected_envelope,omitempty"`

	// Hash-only vector fields (for large payloads, e.g. 1 MB)
	PlaintextSeedHex       string `json:"plaintext_seed_hex,omitempty"`
	PlaintextSize          int    `json:"plaintext_size,omitempty"`
	PlaintextSHA256        string `json:"plaintext_sha256,omitempty"`
	ExpectedEnvelopeSHA256 string `json:"expected_envelope_sha256,omitempty"`
}

// UnmarshalJSON implements custom unmarshaling to support both new and legacy field names.
func (v *CrossLanguageVector) UnmarshalJSON(data []byte) error {
	type Alias CrossLanguageVector
	aux := &struct {
		*Alias
		LegacyRecipPriv string `json:"recipient_private_key_hex"`
		LegacyEphPriv   string `json:"ephemeral_private_key_hex"`
		LegacyESeed     string `json:"eseed_hex"`
	}{
		Alias: (*Alias)(v),
	}
	if err := json.Unmarshal(data, aux); err != nil {
		return err
	}
	if v.RecipientPrivateKeyHex == "" && aux.LegacyRecipPriv != "" {
		v.RecipientPrivateKeyHex = aux.LegacyRecipPriv
	}
	if v.EphemeralPrivateKeyHex == "" && aux.LegacyEphPriv != "" {
		v.EphemeralPrivateKeyHex = aux.LegacyEphPriv
	}
	if v.ESeedHex == "" && aux.LegacyESeed != "" {
		v.ESeedHex = aux.LegacyESeed
	}
	return nil
}

// expandTestPlaintext derives a deterministic byte slice of the requested size
// from a 32-byte seed using RFC 5869 HKDF-Expand-SHA256 in 4096-byte chunks.
// RFC 5869 §2.3 limits a single Expand call to 255 * 32 = 8160 bytes.
// For chunk index i (0..ceil(size/4096)-1):
//   chunkInfo = fmt.Sprintf("%s-%d", infoPrefix, i)
//   chunk = hkdfExpand(seed, []byte(chunkInfo), chunkSize)
func expandTestPlaintext(seed []byte, infoPrefix string, size int) []byte {
	out := make([]byte, 0, size)
	chunkSize := 4096
	for offset := 0; offset < size; offset += chunkSize {
		curr := chunkSize
		if size-offset < curr {
			curr = size - offset
		}
		chunkIdx := offset / chunkSize
		chunkInfo := fmt.Sprintf("%s-%d", infoPrefix, chunkIdx)
		chunk, err := hkdfExpand(seed, []byte(chunkInfo), curr)
		if err != nil {
			panic(fmt.Sprintf("expandTestPlaintext: %v", err))
		}
		out = append(out, chunk...)
	}
	return out
}

func deriveDeterministic32(label string) []byte {
	h := sha256.Sum256([]byte(label))
	h[0] &= 248
	h[31] &= 127
	h[31] |= 64
	return h[:]
}

func deriveDeterministic64(label string) []byte {
	h := sha512.Sum512([]byte(label))
	return h[:]
}

func generateAllVectors(t *testing.T) []CrossLanguageVector {
	t.Helper()
	var vectors []CrossLanguageVector

	// ==========================================
	// X25519 Standard Vectors (5 vectors)
	// ==========================================
	x25519Plaintexts := []string{
		"Subject: First Sovereign Email\r\nFrom: alice@byos.local\r\nTo: bob@byos.local\r\n\r\nWelcome to zero-knowledge email!",
		"Subject: Key Rotation Notice\r\n\r\nMailbox key epoch advanced from 1 to 2.",
		"{\"type\":\"system_event\",\"level\":\"info\",\"event\":\"mailbox_initialized\"}",
		"The quick brown fox jumps over the lazy dog. 1234567890 !@#$%^&*()_+",
		"Short",
	}

	for i, ptStr := range x25519Plaintexts {
		privR := deriveDeterministic32(fmt.Sprintf("byos_x25519_recipient_%d", i+1))
		curve := ecdh.X25519()
		privKeyR, err := curve.NewPrivateKey(privR)
		if err != nil {
			t.Fatalf("NewPrivateKey: %v", err)
		}
		pubR := privKeyR.PublicKey().Bytes()

		ephPriv := deriveDeterministic32(fmt.Sprintf("byos_x25519_ephemeral_%d", i+1))
		nonce := deriveDeterministic32(fmt.Sprintf("byos_x25519_nonce_%d", i+1))[:12]

		keyID := fmt.Sprintf("mbx_x25519_%03d", i+1)
		keyEpoch := uint32(i + 1)
		plaintext := []byte(ptStr)

		env, err := sealX25519Deterministic(pubR, ephPriv, plaintext, nonce, keyID, keyEpoch)
		if err != nil {
			t.Fatalf("sealX25519Deterministic: %v", err)
		}

		canonBytes, err := envelope.MarshalCanonical(env)
		if err != nil {
			t.Fatalf("MarshalCanonical: %v", err)
		}

		aadBytes, err := envelope.BuildAAD(env)
		if err != nil {
			t.Fatalf("BuildAAD: %v", err)
		}

		rec, err := Open(env, privR)
		if err != nil || !bytes.Equal(rec, plaintext) {
			t.Fatalf("Decryption failed for X25519 vector %d: %v", i+1, err)
		}

		vectors = append(vectors, CrossLanguageVector{
			ID:                        fmt.Sprintf("x25519-standard-%02d", i+1),
			Description:               fmt.Sprintf("X25519 standard test vector %d", i+1),
			TestOnly:                  true,
			Algorithm:                 envelope.AlgX25519,
			KeyID:                     keyID,
			KeyEpoch:                  keyEpoch,
			RecipientPublicKeyHex:     hex.EncodeToString(pubR),
			RecipientPrivateKeyHex:    hex.EncodeToString(privR),
			EphemeralPrivateKeyHex:    hex.EncodeToString(ephPriv),
			NonceHex:                  hex.EncodeToString(nonce),
			Plaintext:                 ptStr,
			PlaintextHex:              hex.EncodeToString(plaintext),
			PlaintextLen:              len(plaintext),
			ExpectedAADHex:            hex.EncodeToString(aadBytes),
			ExpectedEnvelopeCanonical: string(canonBytes),
			ExpectedEnvelope:          env,
		})
	}

	// ==========================================
	// X-Wing Standard Vectors (5 vectors)
	// ==========================================
	xwingPlaintexts := []string{
		"Subject: Quantum-Resistant Dispatch\r\nFrom: sec-ops@byos.local\r\n\r\nThis communication is protected by ML-KEM-768 + X25519.",
		"Encrypted Attachment Header\r\nContent-Type: application/pdf; name=\"financial_report.pdf\"\r\nContent-Length: 48912",
		"{\"action\":\"rotate_device_keys\",\"device_id\":\"dev_9981a\",\"fingerprint\":\"sha256-abcdef\"}",
		"A long post-quantum test paragraph with unicode: 🛡️ Sovereign Post-Quantum Cryptography: X-Wing hybrid KEM combines Kyber/ML-KEM and Curve25519.",
		"PQC",
	}

	for i, ptStr := range xwingPlaintexts {
		skSeed := deriveDeterministic32(fmt.Sprintf("byos_xwing_recipient_seed_%d", i+1))
		expanded, err := core.ExpandDecapsulationKey(skSeed)
		if err != nil {
			t.Fatalf("ExpandDecapsulationKey: %v", err)
		}
		pk := expanded.PK // 1216 bytes

		eseed := deriveDeterministic64(fmt.Sprintf("byos_xwing_eseed_%d", i+1))
		nonce := deriveDeterministic32(fmt.Sprintf("byos_xwing_nonce_%d", i+1))[:12]

		keyID := fmt.Sprintf("mbx_xwing_%03d", i+1)
		keyEpoch := uint32((i + 1) * 2)
		plaintext := []byte(ptStr)

		env, err := sealXWingDeterministic(pk, eseed, plaintext, nonce, keyID, keyEpoch)
		if err != nil {
			t.Fatalf("sealXWingDeterministic: %v", err)
		}

		canonBytes, err := envelope.MarshalCanonical(env)
		if err != nil {
			t.Fatalf("MarshalCanonical: %v", err)
		}

		aadBytes, err := envelope.BuildAAD(env)
		if err != nil {
			t.Fatalf("BuildAAD: %v", err)
		}

		rec, err := Open(env, skSeed)
		if err != nil || !bytes.Equal(rec, plaintext) {
			t.Fatalf("Decryption failed for X-Wing vector %d: %v", i+1, err)
		}

		vectors = append(vectors, CrossLanguageVector{
			ID:                        fmt.Sprintf("xwing-standard-%02d", i+1),
			Description:               fmt.Sprintf("X-Wing standard post-quantum test vector %d", i+1),
			TestOnly:                  true,
			Algorithm:                 envelope.AlgXWing,
			KeyID:                     keyID,
			KeyEpoch:                  keyEpoch,
			RecipientPublicKeyHex:     hex.EncodeToString(pk),
			RecipientPrivateKeyHex:    hex.EncodeToString(skSeed),
			ESeedHex:                  hex.EncodeToString(eseed),
			NonceHex:                  hex.EncodeToString(nonce),
			Plaintext:                 ptStr,
			PlaintextHex:              hex.EncodeToString(plaintext),
			PlaintextLen:              len(plaintext),
			ExpectedAADHex:            hex.EncodeToString(aadBytes),
			ExpectedEnvelopeCanonical: string(canonBytes),
			ExpectedEnvelope:          env,
		})
	}

	// ==========================================
	// Edge Case 1: Empty Plaintext (X25519)
	// ==========================================
	{
		privR := deriveDeterministic32("byos_x25519_recipient_empty")
		curve := ecdh.X25519()
		privKeyR, _ := curve.NewPrivateKey(privR)
		pubR := privKeyR.PublicKey().Bytes()

		ephPriv := deriveDeterministic32("byos_x25519_ephemeral_empty")
		nonce := deriveDeterministic32("byos_x25519_nonce_empty")[:12]
		keyID := "mbx_empty_payload"
		keyEpoch := uint32(1)
		plaintext := []byte{}

		env, err := sealX25519Deterministic(pubR, ephPriv, plaintext, nonce, keyID, keyEpoch)
		if err != nil {
			t.Fatalf("seal empty: %v", err)
		}
		canonBytes, _ := envelope.MarshalCanonical(env)
		aadBytes, _ := envelope.BuildAAD(env)

		rec, err := Open(env, privR)
		if err != nil || len(rec) != 0 {
			t.Fatalf("Failed empty plaintext X25519")
		}

		vectors = append(vectors, CrossLanguageVector{
			ID:                        "x25519-edge-empty-plaintext",
			Description:               "Edge case: 0-byte empty plaintext under X25519",
			TestOnly:                  true,
			Algorithm:                 envelope.AlgX25519,
			KeyID:                     keyID,
			KeyEpoch:                  keyEpoch,
			RecipientPublicKeyHex:     hex.EncodeToString(pubR),
			RecipientPrivateKeyHex:    hex.EncodeToString(privR),
			EphemeralPrivateKeyHex:    hex.EncodeToString(ephPriv),
			NonceHex:                  hex.EncodeToString(nonce),
			Plaintext:                 "",
			PlaintextHex:              "",
			PlaintextLen:              0,
			ExpectedAADHex:            hex.EncodeToString(aadBytes),
			ExpectedEnvelopeCanonical: string(canonBytes),
			ExpectedEnvelope:          env,
		})
	}

	// ==========================================
	// Edge Case 2: Empty Plaintext (X-Wing)
	// ==========================================
	{
		skSeed := deriveDeterministic32("byos_xwing_recipient_empty")
		expanded, _ := core.ExpandDecapsulationKey(skSeed)
		pk := expanded.PK
		eseed := deriveDeterministic64("byos_xwing_eseed_empty")
		nonce := deriveDeterministic32("byos_xwing_nonce_empty")[:12]
		keyID := "mbx_empty_payload_xwing"
		keyEpoch := uint32(1)
		plaintext := []byte{}

		env, err := sealXWingDeterministic(pk, eseed, plaintext, nonce, keyID, keyEpoch)
		if err != nil {
			t.Fatalf("seal empty xwing: %v", err)
		}
		canonBytes, _ := envelope.MarshalCanonical(env)
		aadBytes, _ := envelope.BuildAAD(env)

		rec, err := Open(env, skSeed)
		if err != nil || len(rec) != 0 {
			t.Fatalf("Failed empty plaintext X-Wing")
		}

		vectors = append(vectors, CrossLanguageVector{
			ID:                        "xwing-edge-empty-plaintext",
			Description:               "Edge case: 0-byte empty plaintext under X-Wing hybrid",
			TestOnly:                  true,
			Algorithm:                 envelope.AlgXWing,
			KeyID:                     keyID,
			KeyEpoch:                  keyEpoch,
			RecipientPublicKeyHex:     hex.EncodeToString(pk),
			RecipientPrivateKeyHex:    hex.EncodeToString(skSeed),
			ESeedHex:                  hex.EncodeToString(eseed),
			NonceHex:                  hex.EncodeToString(nonce),
			Plaintext:                 "",
			PlaintextHex:              "",
			PlaintextLen:              0,
			ExpectedAADHex:            hex.EncodeToString(aadBytes),
			ExpectedEnvelopeCanonical: string(canonBytes),
			ExpectedEnvelope:          env,
		})
	}

	// ==========================================
	// Edge Case 3: 1 MB Plaintext (X25519) - Hash-Only
	// ==========================================
	{
		privR := deriveDeterministic32("byos_x25519_recipient_1mb")
		curve := ecdh.X25519()
		privKeyR, _ := curve.NewPrivateKey(privR)
		pubR := privKeyR.PublicKey().Bytes()

		ephPriv := deriveDeterministic32("byos_x25519_ephemeral_1mb")
		nonce := deriveDeterministic32("byos_x25519_nonce_1mb")[:12]
		keyID := "mbx_x25519_1mb"
		keyEpoch := uint32(1)

		ptSeed := deriveDeterministic32("byos_plaintext_seed_1mb_x25519")
		size := 1048576
		pt := expandTestPlaintext(ptSeed, "byos-test-plaintext", size)
		ptSHA := sha256.Sum256(pt)

		env, err := sealX25519Deterministic(pubR, ephPriv, pt, nonce, keyID, keyEpoch)
		if err != nil {
			t.Fatalf("seal 1mb x25519: %v", err)
		}
		canonBytes, err := envelope.MarshalCanonical(env)
		if err != nil {
			t.Fatalf("MarshalCanonical 1mb x25519: %v", err)
		}
		envSHA := sha256.Sum256(canonBytes)

		rec, err := Open(env, privR)
		if err != nil || !bytes.Equal(rec, pt) {
			t.Fatalf("Failed 1MB plaintext X25519 decryption")
		}

		vectors = append(vectors, CrossLanguageVector{
			ID:                     "x25519-edge-1mb-plaintext",
			Description:            "X25519 with 1 MB plaintext (deterministic seed)",
			TestOnly:               true,
			Algorithm:              envelope.AlgX25519,
			KeyID:                  keyID,
			KeyEpoch:               keyEpoch,
			RecipientPublicKeyHex:  hex.EncodeToString(pubR),
			RecipientPrivateKeyHex: hex.EncodeToString(privR),
			EphemeralPrivateKeyHex: hex.EncodeToString(ephPriv),
			NonceHex:               hex.EncodeToString(nonce),
			PlaintextSeedHex:       hex.EncodeToString(ptSeed),
			PlaintextSize:          size,
			PlaintextSHA256:        hex.EncodeToString(ptSHA[:]),
			ExpectedEnvelopeSHA256: hex.EncodeToString(envSHA[:]),
		})
	}

	// ==========================================
	// Edge Case 4: 1 MB Plaintext (X-Wing) - Hash-Only
	// ==========================================
	{
		skSeed := deriveDeterministic32("byos_xwing_recipient_1mb")
		expanded, _ := core.ExpandDecapsulationKey(skSeed)
		pk := expanded.PK
		eseed := deriveDeterministic64("byos_xwing_eseed_1mb")
		nonce := deriveDeterministic32("byos_xwing_nonce_1mb")[:12]
		keyID := "mbx_xwing_1mb"
		keyEpoch := uint32(1)

		ptSeed := deriveDeterministic32("byos_plaintext_seed_1mb_xwing")
		size := 1048576
		pt := expandTestPlaintext(ptSeed, "byos-test-plaintext", size)
		ptSHA := sha256.Sum256(pt)

		env, err := sealXWingDeterministic(pk, eseed, pt, nonce, keyID, keyEpoch)
		if err != nil {
			t.Fatalf("seal 1mb xwing: %v", err)
		}
		canonBytes, err := envelope.MarshalCanonical(env)
		if err != nil {
			t.Fatalf("MarshalCanonical 1mb xwing: %v", err)
		}
		envSHA := sha256.Sum256(canonBytes)

		rec, err := Open(env, skSeed)
		if err != nil || !bytes.Equal(rec, pt) {
			t.Fatalf("Failed 1MB plaintext X-Wing decryption")
		}

		vectors = append(vectors, CrossLanguageVector{
			ID:                     "xwing-edge-1mb-plaintext",
			Description:            "X-Wing with 1 MB plaintext (deterministic seed)",
			TestOnly:               true,
			Algorithm:              envelope.AlgXWing,
			KeyID:                  keyID,
			KeyEpoch:               keyEpoch,
			RecipientPublicKeyHex:  hex.EncodeToString(pk),
			RecipientPrivateKeyHex: hex.EncodeToString(skSeed),
			ESeedHex:               hex.EncodeToString(eseed),
			NonceHex:               hex.EncodeToString(nonce),
			PlaintextSeedHex:       hex.EncodeToString(ptSeed),
			PlaintextSize:          size,
			PlaintextSHA256:        hex.EncodeToString(ptSHA[:]),
			ExpectedEnvelopeSHA256: hex.EncodeToString(envSHA[:]),
		})
	}

	return vectors
}

// TestGenerateAndSaveCrossLanguageVectors generates the vector suite and writes
// testdata/cross_language_vectors.json as the single canonical vector file.
func TestGenerateAndSaveCrossLanguageVectors(t *testing.T) {
	vectors := generateAllVectors(t)
	if len(vectors) < 12 {
		t.Fatalf("Expected at least 12 vectors, got %d", len(vectors))
	}

	suite := VectorSuite{
		Warning: "TEST-ONLY KEYS. These are not production secrets. Never use for anything other than test vector verification.",
		Vectors: vectors,
	}

	outJSON, err := json.MarshalIndent(suite, "", "  ")
	if err != nil {
		t.Fatalf("json.MarshalIndent: %v", err)
	}

	p := filepath.Join("..", "..", "testdata", "cross_language_vectors.json")
	if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
		t.Fatalf("os.MkdirAll %s: %v", filepath.Dir(p), err)
	}
	if err := os.WriteFile(p, outJSON, 0644); err != nil {
		t.Fatalf("os.WriteFile %s: %v", p, err)
	}
	t.Logf("Wrote %d vectors to %s (%d bytes)", len(vectors), p, len(outJSON))
}

// TestVerifyCrossLanguageVectors loads cross_language_vectors.json and verifies
// that deterministic sealing produces byte-identical output, matching AAD, and opens cleanly.
func TestVerifyCrossLanguageVectors(t *testing.T) {
	p := filepath.Join("..", "..", "testdata", "cross_language_vectors.json")
	data, err := os.ReadFile(p)
	if err != nil {
		t.Fatalf("Failed to read cross_language_vectors.json from %s: %v", p, err)
	}

	var suite VectorSuite
	if err := json.Unmarshal(data, &suite); err != nil {
		if err2 := json.Unmarshal(data, &suite.Vectors); err2 != nil {
			t.Fatalf("Failed to unmarshal cross_language_vectors.json: %v", err)
		}
	}

	vectors := suite.Vectors
	if len(vectors) < 12 {
		t.Fatalf("Expected at least 12 vectors, got %d", len(vectors))
	}

	for _, vec := range vectors {
		t.Run(vec.ID, func(t *testing.T) {
			pubBytes, err := hex.DecodeString(vec.RecipientPublicKeyHex)
			if err != nil {
				t.Fatalf("Decode pub key: %v", err)
			}
			privBytes, err := hex.DecodeString(vec.RecipientPrivateKeyHex)
			if err != nil {
				t.Fatalf("Decode priv key: %v", err)
			}
			nonceBytes, err := hex.DecodeString(vec.NonceHex)
			if err != nil {
				t.Fatalf("Decode nonce: %v", err)
			}

			var ptBytes []byte
			isHashOnly := vec.PlaintextSize > 0

			if isHashOnly {
				seedBytes, err := hex.DecodeString(vec.PlaintextSeedHex)
				if err != nil {
					t.Fatalf("Decode plaintext_seed_hex: %v", err)
				}
				ptBytes = expandTestPlaintext(seedBytes, "byos-test-plaintext", vec.PlaintextSize)
				ptSHA := sha256.Sum256(ptBytes)
				if hex.EncodeToString(ptSHA[:]) != vec.PlaintextSHA256 {
					t.Fatalf("Plaintext SHA-256 mismatch:\n  got:  %x\n  want: %s", ptSHA, vec.PlaintextSHA256)
				}
			} else {
				if len(vec.PlaintextHex) > 0 {
					ptBytes, err = hex.DecodeString(vec.PlaintextHex)
					if err != nil {
						t.Fatalf("Decode plaintext_hex: %v", err)
					}
				} else {
					ptBytes = []byte{}
				}
			}

			var env *envelope.CryptoEnvelope
			switch vec.Algorithm {
			case envelope.AlgX25519:
				ephPrivBytes, err := hex.DecodeString(vec.EphemeralPrivateKeyHex)
				if err != nil {
					t.Fatalf("Decode eph priv: %v", err)
				}
				env, err = sealX25519Deterministic(pubBytes, ephPrivBytes, ptBytes, nonceBytes, vec.KeyID, vec.KeyEpoch)
				if err != nil {
					t.Fatalf("sealX25519Deterministic failed: %v", err)
				}

			case envelope.AlgXWing:
				eseedBytes, err := hex.DecodeString(vec.ESeedHex)
				if err != nil {
					t.Fatalf("Decode eseed: %v", err)
				}
				env, err = sealXWingDeterministic(pubBytes, eseedBytes, ptBytes, nonceBytes, vec.KeyID, vec.KeyEpoch)
				if err != nil {
					t.Fatalf("sealXWingDeterministic failed: %v", err)
				}

			default:
				t.Fatalf("Unknown algorithm: %s", vec.Algorithm)
			}

			// 1. Verify canonical serialization matches byte-for-byte or SHA-256 matches for hash-only
			canon, err := envelope.MarshalCanonical(env)
			if err != nil {
				t.Fatalf("MarshalCanonical failed: %v", err)
			}

			if isHashOnly {
				envSHA := sha256.Sum256(canon)
				if hex.EncodeToString(envSHA[:]) != vec.ExpectedEnvelopeSHA256 {
					t.Fatalf("Canonical envelope SHA-256 mismatch:\n  got:  %x\n  want: %s", envSHA, vec.ExpectedEnvelopeSHA256)
				}
			} else {
				if string(canon) != vec.ExpectedEnvelopeCanonical {
					t.Fatalf("Canonical JSON mismatch:\n  got:  %s\n  want: %s", string(canon), vec.ExpectedEnvelopeCanonical)
				}

				// 2. Verify AAD matches expected_aad_hex byte-for-byte
				aad, err := envelope.BuildAAD(env)
				if err != nil {
					t.Fatalf("BuildAAD failed: %v", err)
				}
				if hex.EncodeToString(aad) != vec.ExpectedAADHex {
					t.Fatalf("AAD mismatch:\n  got:  %x\n  want: %s", aad, vec.ExpectedAADHex)
				}

				// 3. Verify unmarshaling canonical JSON matches envelope
				unmarshaled, err := envelope.UnmarshalCanonical([]byte(vec.ExpectedEnvelopeCanonical))
				if err != nil {
					t.Fatalf("UnmarshalCanonical failed: %v", err)
				}
				unmarshaledCanon, err := envelope.MarshalCanonical(unmarshaled)
				if err != nil {
					t.Fatalf("MarshalCanonical of unmarshaled failed: %v", err)
				}
				if !bytes.Equal(unmarshaledCanon, canon) {
					t.Fatalf("Unmarshaled canonical mismatch")
				}
			}

			// In both cases, verify Open recovers the exact plaintext
			recovered, err := Open(env, privBytes)
			if err != nil {
				t.Fatalf("Open failed: %v", err)
			}
			if !bytes.Equal(recovered, ptBytes) {
				t.Fatalf("Decrypted plaintext mismatch (len %d vs %d)", len(recovered), len(ptBytes))
			}
		})
	}
}
