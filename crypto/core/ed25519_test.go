package core

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

type vector struct {
	ID                         string `json:"id"`
	RecoveryRootHex            string `json:"recovery_root_hex"`
	MailboxIDHex               string `json:"mailbox_id_hex"`
	KeyEpoch                   uint32 `json:"key_epoch"`
	ExpectedSigningPublicKeyHex string `json:"expected_signing_public_key_hex"`
	AADHex                     string `json:"aad_hex"`
	CiphertextHex              string `json:"ciphertext_hex"`
	ExpectedSignatureHex       string `json:"expected_signature_hex"`
}

type vectorsFile struct {
	Vectors []vector `json:"vectors"`
}

func loadSigningVectors(t *testing.T) []vector {
	candidates := []string{
		"testdata/ed25519_signing_vectors.json",
		"../../testdata/ed25519_signing_vectors.json",
		filepath.Join("..", "..", "testdata", "ed25519_signing_vectors.json"),
	}

	var data []byte
	var err error
	for _, p := range candidates {
		data, err = os.ReadFile(p)
		if err == nil {
			break
		}
	}
	if err != nil {
		t.Fatalf("failed to locate ed25519_signing_vectors.json: %v", err)
	}

	var vf vectorsFile
	if err := json.Unmarshal(data, &vf); err != nil {
		t.Fatalf("failed to unmarshal vectors: %v", err)
	}
	return vf.Vectors
}

func decodeHexOrEmpty(t *testing.T, s string) []byte {
	if s == "" {
		return []byte{}
	}
	b, err := hex.DecodeString(s)
	if err != nil {
		t.Fatalf("invalid hex: %v", err)
	}
	return b
}

func TestDerivationDeterministic(t *testing.T) {
	root := [32]byte{0x55, 0x55}
	mailboxID := [16]byte{0x77, 0x77}
	epoch := uint32(1)

	sk1, err := DeriveSigningKey(root, mailboxID, epoch)
	if err != nil {
		t.Fatalf("DeriveSigningKey failed: %v", err)
	}
	sk2, err := DeriveSigningKey(root, mailboxID, epoch)
	if err != nil {
		t.Fatalf("DeriveSigningKey failed: %v", err)
	}

	pk1 := SigningPublicKey(sk1)
	pk2 := SigningPublicKey(sk2)
	if !bytes.Equal(pk1[:], pk2[:]) {
		t.Fatalf("expected deterministic public keys, got %x != %x", pk1, pk2)
	}
}

func TestDerivationDifferentEpochs(t *testing.T) {
	root := [32]byte{0x55, 0x55}
	mailboxID := [16]byte{0x77, 0x77}

	sk1, err := DeriveSigningKey(root, mailboxID, 1)
	if err != nil {
		t.Fatalf("DeriveSigningKey failed: %v", err)
	}
	sk2, err := DeriveSigningKey(root, mailboxID, 2)
	if err != nil {
		t.Fatalf("DeriveSigningKey failed: %v", err)
	}

	pk1 := SigningPublicKey(sk1)
	pk2 := SigningPublicKey(sk2)
	if bytes.Equal(pk1[:], pk2[:]) {
		t.Fatalf("expected different public keys for different epochs")
	}
}

func TestDerivationDifferentMailboxes(t *testing.T) {
	root := [32]byte{0x55, 0x55}
	mb1 := [16]byte{0x01}
	mb2 := [16]byte{0x02}

	sk1, err := DeriveSigningKey(root, mb1, 1)
	if err != nil {
		t.Fatalf("DeriveSigningKey failed: %v", err)
	}
	sk2, err := DeriveSigningKey(root, mb2, 1)
	if err != nil {
		t.Fatalf("DeriveSigningKey failed: %v", err)
	}

	pk1 := SigningPublicKey(sk1)
	pk2 := SigningPublicKey(sk2)
	if bytes.Equal(pk1[:], pk2[:]) {
		t.Fatalf("expected different public keys for different mailboxes")
	}
}

func TestSignVerifyRoundTrip(t *testing.T) {
	root := [32]byte{0x12, 0x34}
	mailboxID := [16]byte{0x56, 0x78}
	epoch := uint32(3)

	sk, err := DeriveSigningKey(root, mailboxID, epoch)
	if err != nil {
		t.Fatalf("DeriveSigningKey failed: %v", err)
	}
	pk := SigningPublicKey(sk)

	aad := []byte("test-aad-data")
	ct := []byte("test-ciphertext-data")

	sig, err := SignMessage(sk, aad, ct)
	if err != nil {
		t.Fatalf("SignMessage failed: %v", err)
	}

	if err := VerifyMessageSignature(pk, sig, aad, ct); err != nil {
		t.Fatalf("VerifyMessageSignature failed: %v", err)
	}
}

func TestVerifyFailsWrongPublicKey(t *testing.T) {
	root := [32]byte{0x12}
	mailboxID := [16]byte{0x34}

	sk, err := DeriveSigningKey(root, mailboxID, 1)
	if err != nil {
		t.Fatalf("DeriveSigningKey failed: %v", err)
	}

	wrongSK, err := DeriveSigningKey(root, mailboxID, 2)
	if err != nil {
		t.Fatalf("DeriveSigningKey failed: %v", err)
	}
	wrongPK := SigningPublicKey(wrongSK)

	aad := []byte("aad")
	ct := []byte("ct")

	sig, err := SignMessage(sk, aad, ct)
	if err != nil {
		t.Fatalf("SignMessage failed: %v", err)
	}

	if err := VerifyMessageSignature(wrongPK, sig, aad, ct); err == nil {
		t.Fatalf("expected verify failure with wrong public key")
	}
}

func TestVerifyFailsTamperedSignature(t *testing.T) {
	root := [32]byte{0x12}
	mailboxID := [16]byte{0x34}

	sk, err := DeriveSigningKey(root, mailboxID, 1)
	if err != nil {
		t.Fatalf("DeriveSigningKey failed: %v", err)
	}
	pk := SigningPublicKey(sk)

	aad := []byte("aad")
	ct := []byte("ct")

	sig, err := SignMessage(sk, aad, ct)
	if err != nil {
		t.Fatalf("SignMessage failed: %v", err)
	}

	sig[0] ^= 0xff

	if err := VerifyMessageSignature(pk, sig, aad, ct); err == nil {
		t.Fatalf("expected verify failure with tampered signature")
	}
}

func TestVerifyFailsTamperedAAD(t *testing.T) {
	root := [32]byte{0x12}
	mailboxID := [16]byte{0x34}

	sk, err := DeriveSigningKey(root, mailboxID, 1)
	if err != nil {
		t.Fatalf("DeriveSigningKey failed: %v", err)
	}
	pk := SigningPublicKey(sk)

	aad := []byte("aad")
	ct := []byte("ct")

	sig, err := SignMessage(sk, aad, ct)
	if err != nil {
		t.Fatalf("SignMessage failed: %v", err)
	}

	if err := VerifyMessageSignature(pk, sig, []byte("tampered_aad"), ct); err == nil {
		t.Fatalf("expected verify failure with tampered AAD")
	}
}

func TestVerifyFailsTamperedCiphertext(t *testing.T) {
	root := [32]byte{0x12}
	mailboxID := [16]byte{0x34}

	sk, err := DeriveSigningKey(root, mailboxID, 1)
	if err != nil {
		t.Fatalf("DeriveSigningKey failed: %v", err)
	}
	pk := SigningPublicKey(sk)

	aad := []byte("aad")
	ct := []byte("ct")

	sig, err := SignMessage(sk, aad, ct)
	if err != nil {
		t.Fatalf("SignMessage failed: %v", err)
	}

	if err := VerifyMessageSignature(pk, sig, aad, []byte("tampered_ciphertext")); err == nil {
		t.Fatalf("expected verify failure with tampered ciphertext")
	}
}

func TestCrossLanguageVectors(t *testing.T) {
	vectors := loadSigningVectors(t)
	if len(vectors) == 0 {
		t.Fatalf("vectors list is empty")
	}

	for _, v := range vectors {
		t.Run(v.ID, func(t *testing.T) {
			rootBytes := decodeHexOrEmpty(t, v.RecoveryRootHex)
			var root [32]byte
			copy(root[:], rootBytes)

			mbBytes := decodeHexOrEmpty(t, v.MailboxIDHex)
			var mbID [16]byte
			copy(mbID[:], mbBytes)

			sk, err := DeriveSigningKey(root, mbID, v.KeyEpoch)
			if err != nil {
				t.Fatalf("DeriveSigningKey error: %v", err)
			}

			pk := SigningPublicKey(sk)
			pkHex := hex.EncodeToString(pk[:])
			if pkHex != v.ExpectedSigningPublicKeyHex {
				t.Fatalf("public key mismatch: got %s, want %s", pkHex, v.ExpectedSigningPublicKeyHex)
			}

			aad := decodeHexOrEmpty(t, v.AADHex)
			ct := decodeHexOrEmpty(t, v.CiphertextHex)

			sig, err := SignMessage(sk, aad, ct)
			if err != nil {
				t.Fatalf("SignMessage error: %v", err)
			}

			sigHex := hex.EncodeToString(sig[:])
			if sigHex != v.ExpectedSignatureHex {
				t.Fatalf("signature mismatch: got %s, want %s", sigHex, v.ExpectedSignatureHex)
			}

			sigBytes := decodeHexOrEmpty(t, v.ExpectedSignatureHex)
			var expectedSig [64]byte
			copy(expectedSig[:], sigBytes)

			if err := VerifyMessageSignature(pk, expectedSig, aad, ct); err != nil {
				t.Fatalf("VerifyMessageSignature error: %v", err)
			}
		})
	}
}
