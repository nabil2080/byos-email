package envelope_test

import (
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"byos.email/crypto/envelope"
)

// TestBuildEnvelopeAADLayout mirrors the Rust test test_build_envelope_aad_layout
// in packages/crypto-core/src/lib.rs.
func TestBuildEnvelopeAADLayout(t *testing.T) {
	v := uint8(1)
	alg := "HPKE-XWing-AES256GCM-v1"
	keyID := "mbx_test"
	keyEpoch := uint32(1)
	enc := bytes.Repeat([]byte{0xAA}, 1120)
	var nonce [12]byte
	for i := range nonce {
		nonce[i] = 0xBB
	}

	aad, err := envelope.BuildEnvelopeAAD(v, alg, keyID, keyEpoch, enc, nonce)
	if err != nil {
		t.Fatalf("BuildEnvelopeAAD failed: %v", err)
	}

	// Manually construct the expected AAD
	expected := make([]byte, 0, 1+1+len(alg)+1+len(keyID)+4+4+len(enc)+1+12)
	expected = append(expected, 1)
	expected = append(expected, uint8(len(alg)))
	expected = append(expected, []byte(alg)...)
	expected = append(expected, uint8(len(keyID)))
	expected = append(expected, []byte(keyID)...)

	epochBytes := make([]byte, 4)
	binary.BigEndian.PutUint32(epochBytes, 1)
	expected = append(expected, epochBytes...)

	encLenBytes := make([]byte, 4)
	binary.BigEndian.PutUint32(encLenBytes, 1120)
	expected = append(expected, encLenBytes...)

	expected = append(expected, enc...)
	expected = append(expected, 12)
	expected = append(expected, nonce[:]...)

	if !bytes.Equal(aad, expected) {
		t.Fatalf("AAD does not match expected layout.\ngot:  %x\nwant: %x", aad, expected)
	}

	expectedLen := 1 + 1 + 23 + 1 + 8 + 4 + 4 + 1120 + 1 + 12
	if len(aad) != expectedLen {
		t.Fatalf("AAD length mismatch: got %d, want %d", len(aad), expectedLen)
	}
}

func TestBuildEnvelopeAADBounds(t *testing.T) {
	var nonce [12]byte
	enc := []byte("enc")

	// Empty alg
	if _, err := envelope.BuildEnvelopeAAD(1, "", "key", 1, enc, nonce); err == nil {
		t.Errorf("expected error for empty alg")
	}

	// Alg > 255
	longAlg := string(bytes.Repeat([]byte{'a'}, 256))
	if _, err := envelope.BuildEnvelopeAAD(1, longAlg, "key", 1, enc, nonce); err == nil {
		t.Errorf("expected error for alg > 255")
	}

	// Empty keyID
	if _, err := envelope.BuildEnvelopeAAD(1, "alg", "", 1, enc, nonce); err == nil {
		t.Errorf("expected error for empty keyID")
	}

	// KeyID > 255
	longKeyID := string(bytes.Repeat([]byte{'k'}, 256))
	if _, err := envelope.BuildEnvelopeAAD(1, "alg", longKeyID, 1, enc, nonce); err == nil {
		t.Errorf("expected error for keyID > 255")
	}
}

func TestVerifyEnvelopeSignatureSuccess(t *testing.T) {
	seed := bytes.Repeat([]byte{0x42}, 32)
	privKey := ed25519.NewKeyFromSeed(seed)
	pubKey, err := envelope.SigningPublicKeyFromSeed(seed)
	if err != nil {
		t.Fatalf("SigningPublicKeyFromSeed failed: %v", err)
	}

	rawEnc := bytes.Repeat([]byte{0x11}, envelope.XWingEncSize)
	var rawNonce [12]byte
	for i := range rawNonce {
		rawNonce[i] = byte(i + 1)
	}
	rawCiphertext := bytes.Repeat([]byte{0x22}, 64)

	aad, err := envelope.BuildEnvelopeAAD(1, envelope.AlgXWing, "mbx_recipient_123", 1, rawEnc, rawNonce)
	if err != nil {
		t.Fatalf("BuildEnvelopeAAD failed: %v", err)
	}

	sigData := append(append([]byte(nil), aad...), rawCiphertext...)
	sig := ed25519.Sign(privKey, sigData)
	sigB64 := base64.StdEncoding.EncodeToString(sig)

	env := &envelope.CryptoEnvelope{
		Alg:        envelope.AlgXWing,
		Ciphertext: base64.StdEncoding.EncodeToString(rawCiphertext),
		Enc:        base64.StdEncoding.EncodeToString(rawEnc),
		KeyEpoch:   1,
		KeyID:      "mbx_recipient_123",
		Nonce:      base64.StdEncoding.EncodeToString(rawNonce[:]),
		Sig:        &sigB64,
		V:          1,
	}

	if err := envelope.VerifyEnvelopeSignature(pubKey, env); err != nil {
		t.Fatalf("VerifyEnvelopeSignature failed on valid envelope: %v", err)
	}
}

func TestVerifyEnvelopeSignatureTamperCiphertext(t *testing.T) {
	seed := bytes.Repeat([]byte{0x42}, 32)
	privKey := ed25519.NewKeyFromSeed(seed)
	pubKey, _ := envelope.SigningPublicKeyFromSeed(seed)

	rawEnc := bytes.Repeat([]byte{0x11}, envelope.XWingEncSize)
	var rawNonce [12]byte
	rawCiphertext := bytes.Repeat([]byte{0x22}, 64)

	aad, _ := envelope.BuildEnvelopeAAD(1, envelope.AlgXWing, "mbx_recipient_123", 1, rawEnc, rawNonce)
	sigData := append(append([]byte(nil), aad...), rawCiphertext...)
	sig := ed25519.Sign(privKey, sigData)
	sigB64 := base64.StdEncoding.EncodeToString(sig)

	tamperedCiphertext := bytes.Repeat([]byte{0x22}, 64)
	tamperedCiphertext[0] ^= 0xFF

	env := &envelope.CryptoEnvelope{
		Alg:        envelope.AlgXWing,
		Ciphertext: base64.StdEncoding.EncodeToString(tamperedCiphertext),
		Enc:        base64.StdEncoding.EncodeToString(rawEnc),
		KeyEpoch:   1,
		KeyID:      "mbx_recipient_123",
		Nonce:      base64.StdEncoding.EncodeToString(rawNonce[:]),
		Sig:        &sigB64,
		V:          1,
	}

	if err := envelope.VerifyEnvelopeSignature(pubKey, env); err == nil {
		t.Fatalf("VerifyEnvelopeSignature should have failed on tampered ciphertext")
	}
}

func TestVerifyEnvelopeSignatureTamperKeyID(t *testing.T) {
	seed := bytes.Repeat([]byte{0x42}, 32)
	privKey := ed25519.NewKeyFromSeed(seed)
	pubKey, _ := envelope.SigningPublicKeyFromSeed(seed)

	rawEnc := bytes.Repeat([]byte{0x11}, envelope.XWingEncSize)
	var rawNonce [12]byte
	rawCiphertext := bytes.Repeat([]byte{0x22}, 64)

	aad, _ := envelope.BuildEnvelopeAAD(1, envelope.AlgXWing, "mbx_recipient_123", 1, rawEnc, rawNonce)
	sigData := append(append([]byte(nil), aad...), rawCiphertext...)
	sig := ed25519.Sign(privKey, sigData)
	sigB64 := base64.StdEncoding.EncodeToString(sig)

	env := &envelope.CryptoEnvelope{
		Alg:        envelope.AlgXWing,
		Ciphertext: base64.StdEncoding.EncodeToString(rawCiphertext),
		Enc:        base64.StdEncoding.EncodeToString(rawEnc),
		KeyEpoch:   1,
		KeyID:      "mbx_tampered_id",
		Nonce:      base64.StdEncoding.EncodeToString(rawNonce[:]),
		Sig:        &sigB64,
		V:          1,
	}

	if err := envelope.VerifyEnvelopeSignature(pubKey, env); err == nil {
		t.Fatalf("VerifyEnvelopeSignature should have failed on tampered key_id")
	}
}

func TestVerifyEnvelopeSignatureWrongPublicKey(t *testing.T) {
	seed := bytes.Repeat([]byte{0x42}, 32)
	privKey := ed25519.NewKeyFromSeed(seed)

	wrongSeed := bytes.Repeat([]byte{0x99}, 32)
	wrongPubKey, _ := envelope.SigningPublicKeyFromSeed(wrongSeed)

	rawEnc := bytes.Repeat([]byte{0x11}, envelope.XWingEncSize)
	var rawNonce [12]byte
	rawCiphertext := bytes.Repeat([]byte{0x22}, 64)

	aad, _ := envelope.BuildEnvelopeAAD(1, envelope.AlgXWing, "mbx_recipient_123", 1, rawEnc, rawNonce)
	sigData := append(append([]byte(nil), aad...), rawCiphertext...)
	sig := ed25519.Sign(privKey, sigData)
	sigB64 := base64.StdEncoding.EncodeToString(sig)

	env := &envelope.CryptoEnvelope{
		Alg:        envelope.AlgXWing,
		Ciphertext: base64.StdEncoding.EncodeToString(rawCiphertext),
		Enc:        base64.StdEncoding.EncodeToString(rawEnc),
		KeyEpoch:   1,
		KeyID:      "mbx_recipient_123",
		Nonce:      base64.StdEncoding.EncodeToString(rawNonce[:]),
		Sig:        &sigB64,
		V:          1,
	}

	if err := envelope.VerifyEnvelopeSignature(wrongPubKey, env); err == nil {
		t.Fatalf("VerifyEnvelopeSignature should have failed with wrong public key")
	}
}

func TestVerifyEnvelopeSignatureMissingSig(t *testing.T) {
	pubKey := make([]byte, ed25519.PublicKeySize)
	env := &envelope.CryptoEnvelope{
		Sig: nil,
	}
	if err := envelope.VerifyEnvelopeSignature(pubKey, env); err == nil {
		t.Fatalf("VerifyEnvelopeSignature should fail when Sig is nil")
	}
}

func TestVerifyRustSignedEnvelope(t *testing.T) {
	path := filepath.Join("testdata", "envelope_signed_rust.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("failed to read %s: %v", path, err)
	}

	var vec struct {
		EnvelopeJSON              string `json:"envelope_json"`
		SenderEd25519PublicKeyHex string `json:"sender_ed25519_public_key_hex"`
		RecipientXWingPublicKeyHex string `json:"recipient_xwing_public_key_hex"`
		PlaintextHex              string `json:"plaintext_hex"`
		RecipientXWingSeedHex     string `json:"recipient_xwing_seed_hex"`
	}
	if err := json.Unmarshal(data, &vec); err != nil {
		t.Fatalf("failed to unmarshal test vector: %v", err)
	}

	env, err := envelope.UnmarshalCanonical([]byte(vec.EnvelopeJSON))
	if err != nil {
		t.Fatalf("UnmarshalCanonical failed: %v", err)
	}

	senderPK, err := hex.DecodeString(vec.SenderEd25519PublicKeyHex)
	if err != nil {
		t.Fatalf("hex.DecodeString(senderPK) failed: %v", err)
	}

	if err := envelope.VerifyEnvelopeSignature(senderPK, env); err != nil {
		t.Fatalf("VerifyEnvelopeSignature failed on Rust-signed vector: %v", err)
	}
}

func TestVerifyRustSignedEnvelopeTampered(t *testing.T) {
	path := filepath.Join("testdata", "envelope_signed_rust.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("failed to read %s: %v", path, err)
	}

	var vec struct {
		EnvelopeJSON              string `json:"envelope_json"`
		SenderEd25519PublicKeyHex string `json:"sender_ed25519_public_key_hex"`
	}
	if err := json.Unmarshal(data, &vec); err != nil {
		t.Fatalf("failed to unmarshal test vector: %v", err)
	}

	env, err := envelope.UnmarshalCanonical([]byte(vec.EnvelopeJSON))
	if err != nil {
		t.Fatalf("UnmarshalCanonical failed: %v", err)
	}

	senderPK, err := hex.DecodeString(vec.SenderEd25519PublicKeyHex)
	if err != nil {
		t.Fatalf("hex.DecodeString(senderPK) failed: %v", err)
	}

	// Modify the ciphertext base64 (flip one byte in raw ciphertext, re-encode)
	rawCt, err := base64.StdEncoding.DecodeString(env.Ciphertext)
	if err != nil {
		t.Fatalf("decode ciphertext failed: %v", err)
	}
	rawCt[0] ^= 0x01
	env.Ciphertext = base64.StdEncoding.EncodeToString(rawCt)

	// Re-canonicalize
	canonicalBytes, err := envelope.MarshalCanonical(env)
	if err != nil {
		t.Fatalf("MarshalCanonical failed: %v", err)
	}
	tamperedEnv, err := envelope.UnmarshalCanonical(canonicalBytes)
	if err != nil {
		t.Fatalf("UnmarshalCanonical on tampered envelope failed: %v", err)
	}

	if err := envelope.VerifyEnvelopeSignature(senderPK, tamperedEnv); err == nil {
		t.Fatalf("VerifyEnvelopeSignature should have failed on tampered ciphertext")
	}
}

