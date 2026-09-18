package core_test

import (
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"byos.email/crypto/core"
)

type XWingTestVector struct {
	Seed  string `json:"seed"`
	SK    string `json:"sk"`
	PK    string `json:"pk"`
	ESeed string `json:"eseed"`
	CT    string `json:"ct"`
	SS    string `json:"ss"`
}

func loadTestVectors(t *testing.T) []XWingTestVector {
	t.Helper()
	paths := []string{
		filepath.Join("testdata", "xwing_vectors.json"),
		filepath.Join("..", "testdata", "xwing_vectors.json"),
		filepath.Join("..", "..", "testdata", "xwing_vectors.json"),
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
		t.Fatalf("Failed to load testdata/xwing_vectors.json from candidate paths: %v", err)
	}

	var vectors []XWingTestVector
	if err := json.Unmarshal(data, &vectors); err != nil {
		t.Fatalf("Failed to parse xwing_vectors.json: %v", err)
	}
	if len(vectors) == 0 {
		t.Fatalf("xwing_vectors.json contains 0 test vectors")
	}
	return vectors
}

// TestXWingCombinerAndTestVectors executes the mandatory Step B.1 verification:
// 1. Loads testdata/xwing_vectors.json
// 2. Runs ML-KEM-768 decapsulation to get ss_M
// 3. Computes X25519 to get ss_X
// 4. Runs the Combiner(ss_M, ss_X, ct_X, pk_X)
// 5. Verifies the output matches the expected ss_combined
func TestXWingCombinerAndTestVectors(t *testing.T) {
	vectors := loadTestVectors(t)
	t.Logf("Loaded %d official X-Wing test vectors from Appendix C", len(vectors))

	for i, vec := range vectors {
		t.Run(vec.Seed[:16], func(t *testing.T) {
			skBytes, err := hex.DecodeString(vec.SK)
			if err != nil {
				t.Fatalf("Vector %d: failed to decode SK: %v", i+1, err)
			}
			pkBytes, err := hex.DecodeString(vec.PK)
			if err != nil {
				t.Fatalf("Vector %d: failed to decode PK: %v", i+1, err)
			}
			ctBytes, err := hex.DecodeString(vec.CT)
			if err != nil {
				t.Fatalf("Vector %d: failed to decode CT: %v", i+1, err)
			}
			expectedSSBytes, err := hex.DecodeString(vec.SS)
			if err != nil {
				t.Fatalf("Vector %d: failed to decode SS: %v", i+1, err)
			}

			// 1. Expand decapsulation key
			expanded, err := core.ExpandDecapsulationKey(skBytes)
			if err != nil {
				t.Fatalf("Vector %d: ExpandDecapsulationKey failed: %v", i+1, err)
			}

			// Verify public key derived from seed matches the test vector PK
			derivedPK := expanded.PK
			if hex.EncodeToString(derivedPK) != vec.PK {
				t.Fatalf("Vector %d: derived PK mismatch\n  actual:   %s\n  expected: %s",
					i+1, hex.EncodeToString(derivedPK), vec.PK)
			}

			// 2. ML-KEM-768 decapsulation to get ss_M
			ctM := ctBytes[0:core.MLKEM768CiphertextSize]
			ctX := ctBytes[core.MLKEM768CiphertextSize:core.CiphertextSize]
			pkX := pkBytes[core.MLKEM768EncapsulationKeySize:core.EncapsulationKeySize]

			ssM, err := expanded.DKM.Decapsulate(ctM)
			if err != nil {
				t.Fatalf("Vector %d: ML-KEM-768 decapsulation failed: %v", i+1, err)
			}
			if len(ssM) != 32 {
				t.Fatalf("Vector %d: ss_M length %d != 32", i+1, len(ssM))
			}

			// 3. X25519 scalar multiplication to get ss_X
			pubX, err := core.ExpandDecapsulationKey(skBytes)
			_ = pubX
			ctXPub, err := expanded.SKX.Curve().NewPublicKey(ctX)
			if err != nil {
				t.Fatalf("Vector %d: invalid ct_X public key: %v", i+1, err)
			}
			ssX, err := expanded.SKX.ECDH(ctXPub)
			if err != nil {
				t.Fatalf("Vector %d: X25519 ECDH failed: %v", i+1, err)
			}
			if len(ssX) != 32 {
				t.Fatalf("Vector %d: ss_X length %d != 32", i+1, len(ssX))
			}

			// 4. Run Combiner(ss_M, ss_X, ct_X, pk_X)
			actualSSCombined, err := core.Combiner(ssM, ssX, ctX, pkX)
			if err != nil {
				t.Fatalf("Vector %d: Combiner failed: %v", i+1, err)
			}

			// 5. Verify output matches expected ss_combined
			actualHex := hex.EncodeToString(actualSSCombined)
			expectedHex := hex.EncodeToString(expectedSSBytes)
			if actualHex != expectedHex {
				t.Fatalf("CRITICAL FAILURE in Vector %d: Combiner output mismatch!\n  actual:   %s\n  expected: %s",
					i+1, actualHex, expectedHex)
			}

			// Also verify the Decapsulate convenience function end-to-end
			decapSS, err := core.Decapsulate(skBytes, ctBytes)
			if err != nil {
				t.Fatalf("Vector %d: core.Decapsulate failed: %v", i+1, err)
			}
			if hex.EncodeToString(decapSS) != expectedHex {
				t.Fatalf("Vector %d: core.Decapsulate output mismatch!\n  actual:   %s\n  expected: %s",
					i+1, hex.EncodeToString(decapSS), expectedHex)
			}

			t.Logf("Vector %d PASSED: ss_combined = %s", i+1, actualHex)
		})
	}
}

// TestXWingRoundTrip verifies key generation, encapsulation, and decapsulation round-trip.
func TestXWingRoundTrip(t *testing.T) {
	skSeed, pk, err := core.GenerateKeyPair()
	if err != nil {
		t.Fatalf("GenerateKeyPair failed: %v", err)
	}
	if len(skSeed) != 32 {
		t.Fatalf("skSeed length %d != 32", len(skSeed))
	}
	if len(pk) != 1216 {
		t.Fatalf("pk length %d != 1216", len(pk))
	}

	enc, senderSS, err := core.Encapsulate(pk)
	if err != nil {
		t.Fatalf("Encapsulate failed: %v", err)
	}
	if len(enc) != 1120 {
		t.Fatalf("enc length %d != 1120", len(enc))
	}
	if len(senderSS) != 32 {
		t.Fatalf("senderSS length %d != 32", len(senderSS))
	}

	recipientSS, err := core.Decapsulate(skSeed, enc)
	if err != nil {
		t.Fatalf("Decapsulate failed: %v", err)
	}

	if hex.EncodeToString(senderSS) != hex.EncodeToString(recipientSS) {
		t.Fatalf("Round-trip mismatch!\n  senderSS:    %s\n  recipientSS: %s",
			hex.EncodeToString(senderSS), hex.EncodeToString(recipientSS))
	}
	t.Logf("X-Wing Encapsulate -> Decapsulate round-trip PASSED: shared_secret = %s", hex.EncodeToString(recipientSS))
}
