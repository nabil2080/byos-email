package envelope_test

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"fmt"
	"strings"
	"testing"

	"byos.email/crypto/envelope"
)

// helper to create a valid X25519 envelope
func makeValidX25519Envelope() *envelope.CryptoEnvelope {
	rawEnc := make([]byte, envelope.X25519EncSize)
	for i := range rawEnc {
		rawEnc[i] = byte(i + 1)
	}

	rawNonce := make([]byte, envelope.NonceSize)
	for i := range rawNonce {
		rawNonce[i] = byte(i + 10)
	}

	rawCiphertext := make([]byte, 32) // 16 bytes payload + 16 bytes tag
	for i := range rawCiphertext {
		rawCiphertext[i] = byte(i + 50)
	}

	return &envelope.CryptoEnvelope{
		Alg:        envelope.AlgX25519,
		Ciphertext: base64.StdEncoding.EncodeToString(rawCiphertext),
		Enc:        base64.StdEncoding.EncodeToString(rawEnc),
		KeyEpoch:   1,
		KeyID:      "mbx_01h7abc123",
		Nonce:      base64.StdEncoding.EncodeToString(rawNonce),
		Sig:        nil,
		V:          1,
	}
}

// helper to create a valid X-Wing envelope
func makeValidXWingEnvelope() *envelope.CryptoEnvelope {
	rawEnc := make([]byte, envelope.XWingEncSize)
	for i := range rawEnc {
		rawEnc[i] = byte((i * 7) % 256)
	}

	rawNonce := make([]byte, envelope.NonceSize)
	for i := range rawNonce {
		rawNonce[i] = byte(i + 20)
	}

	rawCiphertext := make([]byte, 48) // 32 bytes payload + 16 bytes tag
	for i := range rawCiphertext {
		rawCiphertext[i] = byte(i + 80)
	}

	return &envelope.CryptoEnvelope{
		Alg:        envelope.AlgXWing,
		Ciphertext: base64.StdEncoding.EncodeToString(rawCiphertext),
		Enc:        base64.StdEncoding.EncodeToString(rawEnc),
		KeyEpoch:   3,
		KeyID:      "mbx_pqc_target999",
		Nonce:      base64.StdEncoding.EncodeToString(rawNonce),
		Sig:        nil,
		V:          1,
	}
}

// TestCanonicalJSONKeyOrdering verifies that MarshalCanonical produces keys
// in the strict lexicographical order mandated by §2.2:
// "alg" -> "ciphertext" -> "enc" -> "key_epoch" -> "key_id" -> "nonce" -> "sig" -> "v"
func TestCanonicalJSONKeyOrdering(t *testing.T) {
	env := makeValidX25519Envelope()

	canonicalBytes, err := envelope.MarshalCanonical(env)
	if err != nil {
		t.Fatalf("MarshalCanonical failed: %v", err)
	}

	str := string(canonicalBytes)

	// Check no trailing newline
	if strings.HasSuffix(str, "\n") || strings.HasSuffix(str, "\r") {
		t.Errorf("Canonical JSON contains trailing newline: %q", str)
	}

	// Check no whitespace around colons/commas
	if strings.Contains(str, ": ") || strings.Contains(str, ", ") {
		t.Errorf("Canonical JSON contains extraneous whitespace: %q", str)
	}

	// Check null signature serialization
	if !strings.Contains(str, `"sig":null`) {
		t.Errorf("Expected sig:null in output, got: %s", str)
	}

	expectedOrder := []string{
		`"alg"`,
		`"ciphertext"`,
		`"enc"`,
		`"key_epoch"`,
		`"key_id"`,
		`"nonce"`,
		`"sig"`,
		`"v"`,
	}

	lastIdx := -1
	for _, key := range expectedOrder {
		idx := strings.Index(str, key)
		if idx == -1 {
			t.Fatalf("Missing expected key %s in JSON: %s", key, str)
		}
		if idx <= lastIdx {
			t.Fatalf("Key order violation: %s at index %d is not after index %d", key, idx, lastIdx)
		}
		lastIdx = idx
	}

	// Also verify with non-null sig (V1.5 forward compatibility)
	sigVal := base64.StdEncoding.EncodeToString([]byte("ed25519_signature_placeholder_64b"))
	env.Sig = &sigVal

	canonicalWithSig, err := envelope.MarshalCanonical(env)
	if err != nil {
		t.Fatalf("MarshalCanonical with sig failed: %v", err)
	}
	strWithSig := string(canonicalWithSig)
	if !strings.Contains(strWithSig, fmt.Sprintf(`"sig":"%s"`, sigVal)) {
		t.Errorf("Expected populated sig in output, got: %s", strWithSig)
	}
}

// TestCanonicalJSONExample verifies Section 2.2 Canonical Example structure
func TestCanonicalJSONExample(t *testing.T) {
	rawNonce := []byte("this12bytes!")
	rawEnc := make([]byte, 32)
	rawCt := make([]byte, 20)

	env := &envelope.CryptoEnvelope{
		Alg:        "HPKE-X25519-AES256GCM-v1",
		Ciphertext: base64.StdEncoding.EncodeToString(rawCt),
		Enc:        base64.StdEncoding.EncodeToString(rawEnc),
		KeyEpoch:   1,
		KeyID:      "mbx_01h7abc123",
		Nonce:      base64.StdEncoding.EncodeToString(rawNonce),
		Sig:        nil,
		V:          1,
	}

	b, err := envelope.MarshalCanonical(env)
	if err != nil {
		t.Fatalf("MarshalCanonical failed: %v", err)
	}

	expectedPrefix := `{"alg":"HPKE-X25519-AES256GCM-v1","ciphertext":`
	if !strings.HasPrefix(string(b), expectedPrefix) {
		t.Errorf("Canonical JSON prefix mismatch:\n  got:  %s\n  want: %s...", string(b), expectedPrefix)
	}
}

// TestMarshalCanonicalStructFieldIndependence verifies that manual MarshalCanonical
// outputs fields in the exact canonical order regardless of struct declaration order.
func TestMarshalCanonicalStructFieldIndependence(t *testing.T) {
	env := makeValidX25519Envelope()

	canonicalBytes, err := envelope.MarshalCanonical(env)
	if err != nil {
		t.Fatalf("MarshalCanonical failed: %v", err)
	}

	// Manual expected string constructed from env fields:
	expected := fmt.Sprintf(
		`{"alg":%q,"ciphertext":%q,"enc":%q,"key_epoch":%d,"key_id":%q,"nonce":%q,"sig":null,"v":%d}`,
		env.Alg, env.Ciphertext, env.Enc, env.KeyEpoch, env.KeyID, env.Nonce, env.V,
	)

	if string(canonicalBytes) != expected {
		t.Fatalf("MarshalCanonical mismatch:\n  got:  %s\n  want: %s", string(canonicalBytes), expected)
	}
}

// TestMarshalCanonicalExcludesExtraFields verifies that adding a hypothetical
// new field via an extended struct wrapper does not appear in MarshalCanonical output.
func TestMarshalCanonicalExcludesExtraFields(t *testing.T) {
	env := makeValidX25519Envelope()

	type ExtendedEnvelope struct {
		envelope.CryptoEnvelope
		HypotheticalNewField string `json:"hypothetical_new_field"`
	}

	ext := ExtendedEnvelope{
		CryptoEnvelope:       *env,
		HypotheticalNewField: "should_never_appear_in_wire_format",
	}

	canonicalBytes, err := envelope.MarshalCanonical(&ext.CryptoEnvelope)
	if err != nil {
		t.Fatalf("MarshalCanonical failed: %v", err)
	}

	if strings.Contains(string(canonicalBytes), "hypothetical_new_field") {
		t.Fatalf("Hypothetical new field leaked into canonical JSON: %s", string(canonicalBytes))
	}
	if strings.Contains(string(canonicalBytes), "should_never_appear_in_wire_format") {
		t.Fatalf("Hypothetical new field value leaked into canonical JSON: %s", string(canonicalBytes))
	}
}

// TestSigNonNullBehaviorV1 tests §7 forward-compatibility requirements:
// 1. Valid base64 sig is accepted with err == nil and logs an observable warning.
// 2. Invalid base64 sig is rejected with code 1003 (InvalidBase64).
func TestSigNonNullBehaviorV1(t *testing.T) {
	t.Run("ValidBase64SigAcceptedWithWarning", func(t *testing.T) {
		var capturedWarning string
		envelope.WarnLogger = func(format string, args ...any) {
			capturedWarning = fmt.Sprintf(format, args...)
		}
		defer func() { envelope.WarnLogger = nil }()

		env := makeValidX25519Envelope()
		validSig := base64.StdEncoding.EncodeToString([]byte("valid_ed25519_signature_64_bytes_test_data"))
		env.Sig = &validSig

		err := envelope.Validate(env)
		if err != nil {
			t.Fatalf("Validate returned unexpected error on valid base64 sig: %v", err)
		}
		if capturedWarning == "" || !strings.Contains(capturedWarning, "non-null sig") {
			t.Fatalf("Expected observable warning logged for non-null sig, got: %q", capturedWarning)
		}
	})

	t.Run("InvalidBase64SigRejected_1003", func(t *testing.T) {
		env := makeValidX25519Envelope()
		badSig := "not-valid-base64!!!"
		env.Sig = &badSig

		err := envelope.Validate(env)
		if err == nil {
			t.Fatalf("Expected validation error for corrupt base64 sig, got nil")
		}
		envErr, ok := err.(*envelope.EnvelopeError)
		if !ok || envErr.Code != envelope.ErrCodeInvalidBase64 {
			t.Fatalf("Expected ErrCodeInvalidBase64 (1003), got %v", err)
		}
	})
}

// TestMissingRequiredFieldRejected verifies that UnmarshalCanonical rejects JSON
// payloads omitting any of the 8 required fields specified in BYOS-SPEC-CRYPTO-ENV-V1 §2.1.
func TestMissingRequiredFieldRejected(t *testing.T) {
	validEnv := makeValidX25519Envelope()
	canonicalBytes, err := envelope.MarshalCanonical(validEnv)
	if err != nil {
		t.Fatalf("MarshalCanonical failed: %v", err)
	}

	// 1. All fields present with sig=null -> expect nil error
	parsed, err := envelope.UnmarshalCanonical(canonicalBytes)
	if err != nil {
		t.Fatalf("Expected nil error for valid canonical JSON with sig=null, got: %v", err)
	}
	if parsed == nil {
		t.Fatalf("Expected non-nil parsed envelope")
	}

	testCases := []struct {
		name         string
		omitField    string
		expectedCode int
	}{
		{"MissingSig", `"sig":null,`, envelope.ErrCodeSerializationError},
		{"MissingAlg", `"alg":"HPKE-X25519-AES256GCM-v1",`, envelope.ErrCodeSerializationError},
		{"MissingV", `,"v":1`, envelope.ErrCodeSerializationError},
		{"MissingNonce", fmt.Sprintf(`"nonce":%q,`, validEnv.Nonce), envelope.ErrCodeSerializationError},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			jsonStr := string(canonicalBytes)
			if !strings.Contains(jsonStr, tc.omitField) {
				t.Fatalf("Substring %q not found in canonical JSON: %s", tc.omitField, jsonStr)
			}
			tamperedJSON := strings.Replace(jsonStr, tc.omitField, "", 1)

			_, err := envelope.UnmarshalCanonical([]byte(tamperedJSON))
			if err == nil {
				t.Fatalf("Expected error for omitted field %s, got nil", tc.name)
			}
			envErr, ok := err.(*envelope.EnvelopeError)
			if !ok || envErr.Code != tc.expectedCode {
				t.Fatalf("Expected error code %d for %s, got %v", tc.expectedCode, tc.name, err)
			}
		})
	}
}

// TestAADBinaryLayout verifies the exact byte offsets from §3.1:
// Offset 0: v (1 byte)
// Offset 1: alg_length (1 byte)
// Offset 2..2+n: alg (n bytes)
// Offset pos: key_id_length (1 byte)
// Offset pos..pos+m: key_id (m bytes)
// Offset pos: key_epoch (4 bytes BE)
// Offset pos: enc_length (4 bytes BE)
// Offset pos..pos+k: enc (k bytes)
// Offset pos: nonce_length (1 byte = 12)
// Offset pos..pos+12: nonce (12 bytes)
func TestAADBinaryLayout(t *testing.T) {
	testCases := []struct {
		name string
		env  *envelope.CryptoEnvelope
	}{
		{"X25519", makeValidX25519Envelope()},
		{"X-Wing", makeValidXWingEnvelope()},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			env := tc.env
			aad, err := envelope.BuildAAD(env)
			if err != nil {
				t.Fatalf("BuildAAD failed: %v", err)
			}

			decoded, err := env.DecodeBase64()
			if err != nil {
				t.Fatalf("DecodeBase64 failed: %v", err)
			}

			expectedLen := 1 + 1 + len(env.Alg) + 1 + len(env.KeyID) + 4 + 4 + len(decoded.RawEnc) + 1 + 12
			if len(aad) != expectedLen {
				t.Fatalf("AAD length mismatch: got %d, want %d", len(aad), expectedLen)
			}

			pos := 0

			// 0: v
			if aad[pos] != env.V {
				t.Errorf("Offset %d: v mismatch: got %d, want %d", pos, aad[pos], env.V)
			}
			pos++

			// 1: alg_length
			if aad[pos] != uint8(len(env.Alg)) {
				t.Errorf("Offset %d: alg_length mismatch: got %d, want %d", pos, aad[pos], len(env.Alg))
			}
			pos++

			// 2..2+n: alg
			algBytes := aad[pos : pos+len(env.Alg)]
			if string(algBytes) != env.Alg {
				t.Errorf("Offset %d: alg mismatch: got %s, want %s", pos, string(algBytes), env.Alg)
			}
			pos += len(env.Alg)

			// key_id_length
			if aad[pos] != uint8(len(env.KeyID)) {
				t.Errorf("Offset %d: key_id_length mismatch: got %d, want %d", pos, aad[pos], len(env.KeyID))
			}
			pos++

			// key_id
			keyIDBytes := aad[pos : pos+len(env.KeyID)]
			if string(keyIDBytes) != env.KeyID {
				t.Errorf("Offset %d: key_id mismatch: got %s, want %s", pos, string(keyIDBytes), env.KeyID)
			}
			pos += len(env.KeyID)

			// key_epoch (BigEndian uint32)
			epoch := binary.BigEndian.Uint32(aad[pos : pos+4])
			if epoch != env.KeyEpoch {
				t.Errorf("Offset %d: key_epoch mismatch: got %d, want %d", pos, epoch, env.KeyEpoch)
			}
			pos += 4

			// enc_length (BigEndian uint32)
			encLen := binary.BigEndian.Uint32(aad[pos : pos+4])
			if int(encLen) != len(decoded.RawEnc) {
				t.Errorf("Offset %d: enc_length mismatch: got %d, want %d", pos, encLen, len(decoded.RawEnc))
			}
			pos += 4

			// enc (raw bytes)
			encBytes := aad[pos : pos+len(decoded.RawEnc)]
			if !bytes.Equal(encBytes, decoded.RawEnc) {
				t.Errorf("Offset %d: enc raw bytes mismatch", pos)
			}
			pos += len(decoded.RawEnc)

			// nonce_length
			if aad[pos] != 12 {
				t.Errorf("Offset %d: nonce_length mismatch: got %d, want 12", pos, aad[pos])
			}
			pos++

			// nonce (12 raw bytes)
			nonceBytes := aad[pos : pos+12]
			if !bytes.Equal(nonceBytes, decoded.RawNonce) {
				t.Errorf("Offset %d: nonce raw bytes mismatch", pos)
			}
			pos += 12

			if pos != len(aad) {
				t.Errorf("Trailing bytes in AAD: pos %d != len %d", pos, len(aad))
			}
		})
	}
}

// TestAADInvariantsAndTampering tests that modifying any field that enters AAD
// changes the AAD, and modifying fields not in AAD (ciphertext, sig) leaves AAD unchanged.
func TestAADInvariantsAndTampering(t *testing.T) {
	env := makeValidX25519Envelope()
	origAAD, err := envelope.BuildAAD(env)
	if err != nil {
		t.Fatalf("BuildAAD failed: %v", err)
	}

	// 1. Modifying ciphertext does NOT affect AAD (§3.1)
	tamperedCt := *env
	tamperedCt.Ciphertext = base64.StdEncoding.EncodeToString([]byte("completely_different_ciphertext_bytes_here!!"))
	ctAAD, err := envelope.BuildAAD(&tamperedCt)
	if err != nil {
		t.Fatalf("BuildAAD failed: %v", err)
	}
	if !bytes.Equal(origAAD, ctAAD) {
		t.Errorf("Ciphertext change unexpectedly changed AAD")
	}

	// 2. Modifying sig does NOT affect AAD (§7)
	tamperedSig := *env
	sigStr := base64.StdEncoding.EncodeToString([]byte("dummy_signature_bytes_12345678901234567890"))
	tamperedSig.Sig = &sigStr
	sigAAD, err := envelope.BuildAAD(&tamperedSig)
	if err != nil {
		t.Fatalf("BuildAAD failed: %v", err)
	}
	if !bytes.Equal(origAAD, sigAAD) {
		t.Errorf("Sig change unexpectedly changed AAD")
	}

	// 3. Modifying key_id changes AAD
	tamperedKeyID := *env
	tamperedKeyID.KeyID = "mbx_other_user_id"
	keyIDAAD, err := envelope.BuildAAD(&tamperedKeyID)
	if err != nil {
		t.Fatalf("BuildAAD failed: %v", err)
	}
	if bytes.Equal(origAAD, keyIDAAD) {
		t.Errorf("Expected AAD to change when key_id changed")
	}

	// 4. Modifying key_epoch changes AAD
	tamperedEpoch := *env
	tamperedEpoch.KeyEpoch = 2
	epochAAD, err := envelope.BuildAAD(&tamperedEpoch)
	if err != nil {
		t.Fatalf("BuildAAD failed: %v", err)
	}
	if bytes.Equal(origAAD, epochAAD) {
		t.Errorf("Expected AAD to change when key_epoch changed")
	}

	// 5. Modifying nonce changes AAD
	tamperedNonce := *env
	rawNonce := make([]byte, 12)
	rawNonce[0] = 0xFF
	tamperedNonce.Nonce = base64.StdEncoding.EncodeToString(rawNonce)
	nonceAAD, err := envelope.BuildAAD(&tamperedNonce)
	if err != nil {
		t.Fatalf("BuildAAD failed: %v", err)
	}
	if bytes.Equal(origAAD, nonceAAD) {
		t.Errorf("Expected AAD to change when nonce changed")
	}
}

// Test20RandomEnvelopesAADConsistency generates 25 random envelopes to verify
// deterministic AAD layout (§11 criterion 1).
func Test20RandomEnvelopesAADConsistency(t *testing.T) {
	for i := 0; i < 25; i++ {
		encSize := envelope.X25519EncSize
		alg := envelope.AlgX25519
		if i%2 == 1 {
			encSize = envelope.XWingEncSize
			alg = envelope.AlgXWing
		}

		rawEnc := make([]byte, encSize)
		rand.Read(rawEnc)

		rawNonce := make([]byte, envelope.NonceSize)
		rand.Read(rawNonce)

		rawCt := make([]byte, 32)
		rand.Read(rawCt)

		env := &envelope.CryptoEnvelope{
			Alg:        alg,
			Ciphertext: base64.StdEncoding.EncodeToString(rawCt),
			Enc:        base64.StdEncoding.EncodeToString(rawEnc),
			KeyEpoch:   uint32(i + 1),
			KeyID:      fmt.Sprintf("mailbox_%04d", i),
			Nonce:      base64.StdEncoding.EncodeToString(rawNonce),
			Sig:        nil,
			V:          1,
		}

		aad1, err := envelope.BuildAAD(env)
		if err != nil {
			t.Fatalf("Iteration %d: BuildAAD failed: %v", i, err)
		}
		aad2, err := envelope.BuildAAD(env)
		if err != nil {
			t.Fatalf("Iteration %d: BuildAAD second call failed: %v", i, err)
		}
		if !bytes.Equal(aad1, aad2) {
			t.Fatalf("Iteration %d: AAD construction is non-deterministic!", i)
		}

		if err := envelope.Validate(env); err != nil {
			t.Fatalf("Iteration %d: Validate failed on valid envelope: %v", i, err)
		}
	}
}

// TestValidationNegativeVectors verifies error codes from §9.
func TestValidationNegativeVectors(t *testing.T) {
	t.Run("UnsupportedVersion_1001", func(t *testing.T) {
		for _, v := range []uint8{0, 2, 255} {
			env := makeValidX25519Envelope()
			env.V = v

			err := envelope.Validate(env)
			if err == nil {
				t.Fatalf("Expected validation error for v=%d, got nil", v)
			}
			envErr, ok := err.(*envelope.EnvelopeError)
			if !ok {
				t.Fatalf("Expected *envelope.EnvelopeError, got %T", err)
			}
			if envErr.Code != envelope.ErrCodeUnsupportedVersion {
				t.Errorf("Expected code 1001 for v=%d, got %d", v, envErr.Code)
			}
		}
	})

	t.Run("UnsupportedAlgorithm_1002", func(t *testing.T) {
		for _, alg := range []string{"HPKE-P256-AES128GCM-v1", "UNKNOWN", "", "RSA-OAEP"} {
			env := makeValidX25519Envelope()
			env.Alg = alg

			err := envelope.Validate(env)
			if err == nil {
				t.Fatalf("Expected validation error for alg=%q, got nil", alg)
			}
			envErr, ok := err.(*envelope.EnvelopeError)
			if !ok {
				t.Fatalf("Expected *envelope.EnvelopeError, got %T", err)
			}
			if envErr.Code != envelope.ErrCodeUnsupportedAlgorithm {
				t.Errorf("Expected code 1002 for alg=%q, got %d", alg, envErr.Code)
			}
		}
	})

	t.Run("UnknownKeyEpoch_1008", func(t *testing.T) {
		env := makeValidX25519Envelope()
		env.KeyEpoch = 0

		err := envelope.Validate(env)
		if err == nil {
			t.Fatalf("Expected validation error for key_epoch=0, got nil")
		}
		envErr, ok := err.(*envelope.EnvelopeError)
		if !ok || envErr.Code != envelope.ErrCodeUnknownKeyEpoch {
			t.Errorf("Expected code 1008 for key_epoch=0, got %v", err)
		}
	})

	t.Run("InvalidNonceLength_1004", func(t *testing.T) {
		// Nonces must be strictly 12 bytes
		badLengths := []int{0, 8, 11, 13, 16, 24, 32}
		for _, length := range badLengths {
			env := makeValidX25519Envelope()
			badNonce := make([]byte, length)
			env.Nonce = base64.StdEncoding.EncodeToString(badNonce)

			err := envelope.Validate(env)
			if err == nil {
				t.Fatalf("Expected validation error for nonce length %d, got nil", length)
			}
			envErr, ok := err.(*envelope.EnvelopeError)
			if !ok || envErr.Code != envelope.ErrCodeInvalidNonceLength {
				t.Errorf("Expected code 1004 for nonce length %d, got %v", length, err)
			}

			// Also verify BuildAAD rejects it with 1004
			_, aadErr := envelope.BuildAAD(env)
			if aadErr == nil {
				t.Fatalf("Expected BuildAAD error for nonce length %d, got nil", length)
			}
			aadEnvErr, ok := aadErr.(*envelope.EnvelopeError)
			if !ok || aadEnvErr.Code != envelope.ErrCodeInvalidNonceLength {
				t.Errorf("Expected BuildAAD code 1004 for nonce length %d, got %v", length, aadErr)
			}
		}
	})

	t.Run("InvalidBase64_1003", func(t *testing.T) {
		testCases := []struct {
			name string
			mod  func(e *envelope.CryptoEnvelope)
		}{
			{"enc_corrupt", func(e *envelope.CryptoEnvelope) { e.Enc = "not-valid-base64!!!" }},
			{"nonce_corrupt", func(e *envelope.CryptoEnvelope) { e.Nonce = "??==" }},
			{"ciphertext_corrupt", func(e *envelope.CryptoEnvelope) { e.Ciphertext = "&&&" }},
			{"sig_corrupt", func(e *envelope.CryptoEnvelope) { s := "invalid!"; e.Sig = &s }},
		}

		for _, tc := range testCases {
			t.Run(tc.name, func(t *testing.T) {
				env := makeValidX25519Envelope()
				tc.mod(env)

				err := envelope.Validate(env)
				if err == nil {
					t.Fatalf("Expected validation error for corrupt base64, got nil")
				}
				envErr, ok := err.(*envelope.EnvelopeError)
				if !ok || envErr.Code != envelope.ErrCodeInvalidBase64 {
					t.Errorf("Expected code 1003, got %v", err)
				}
			})
		}
	})

	t.Run("InvalidKeyLength_1007", func(t *testing.T) {
		// X25519 with 33-byte enc instead of 32
		envX25519 := makeValidX25519Envelope()
		envX25519.Enc = base64.StdEncoding.EncodeToString(make([]byte, 33))
		err := envelope.Validate(envX25519)
		if err == nil {
			t.Fatalf("Expected validation error for 33-byte X25519 enc, got nil")
		}
		envErr, ok := err.(*envelope.EnvelopeError)
		if !ok || envErr.Code != envelope.ErrCodeInvalidKeyLength {
			t.Errorf("Expected code 1007, got %v", err)
		}

		// X-Wing with 1119-byte enc instead of 1120
		envXWing := makeValidXWingEnvelope()
		envXWing.Enc = base64.StdEncoding.EncodeToString(make([]byte, 1119))
		errXWing := envelope.Validate(envXWing)
		if errXWing == nil {
			t.Fatalf("Expected validation error for 1119-byte X-Wing enc, got nil")
		}
		envErrXWing, ok := errXWing.(*envelope.EnvelopeError)
		if !ok || envErrXWing.Code != envelope.ErrCodeInvalidKeyLength {
			t.Errorf("Expected code 1007, got %v", errXWing)
		}
	})

	t.Run("CiphertextTooShort_1009", func(t *testing.T) {
		env := makeValidX25519Envelope()
		env.Ciphertext = base64.StdEncoding.EncodeToString(make([]byte, 15)) // Less than 16-byte tag
		err := envelope.Validate(env)
		if err == nil {
			t.Fatalf("Expected error for ciphertext < 16 bytes, got nil")
		}
		envErr, ok := err.(*envelope.EnvelopeError)
		if !ok || envErr.Code != envelope.ErrCodeSerializationError {
			t.Errorf("Expected code 1009, got %v", err)
		}
	})

	t.Run("EmptyKeyID_1009", func(t *testing.T) {
		env := makeValidX25519Envelope()
		env.KeyID = ""
		err := envelope.Validate(env)
		if err == nil {
			t.Fatalf("Expected error for empty key_id, got nil")
		}
		envErr, ok := err.(*envelope.EnvelopeError)
		if !ok || envErr.Code != envelope.ErrCodeSerializationError {
			t.Errorf("Expected code 1009, got %v", err)
		}
	})
}

// TestRoundTripSerialization verifies canonical serialization and unmarshaling roundtrip
func TestRoundTripSerialization(t *testing.T) {
	original := makeValidXWingEnvelope()

	canonicalJSON, err := envelope.MarshalCanonical(original)
	if err != nil {
		t.Fatalf("MarshalCanonical failed: %v", err)
	}

	parsed, err := envelope.UnmarshalCanonical(canonicalJSON)
	if err != nil {
		t.Fatalf("UnmarshalCanonical failed: %v", err)
	}

	if parsed.V != original.V ||
		parsed.Alg != original.Alg ||
		parsed.KeyID != original.KeyID ||
		parsed.KeyEpoch != original.KeyEpoch ||
		parsed.Enc != original.Enc ||
		parsed.Nonce != original.Nonce ||
		parsed.Ciphertext != original.Ciphertext {
		t.Fatalf("Parsed envelope does not match original")
	}

	// Verify re-marshaled canonical JSON matches original byte-for-byte
	reEncoded, err := envelope.MarshalCanonical(parsed)
	if err != nil {
		t.Fatalf("Re-MarshalCanonical failed: %v", err)
	}
	if !bytes.Equal(canonicalJSON, reEncoded) {
		t.Fatalf("Re-encoded canonical JSON does not match original bytes")
	}
}
