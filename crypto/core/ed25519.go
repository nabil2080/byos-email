package core

import (
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"io"

	"golang.org/x/crypto/hkdf"
)

var (
	// ErrSignatureInvalid indicates the Ed25519 signature did not verify.
	ErrSignatureInvalid = errors.New("signature invalid")
)

// DeriveSigningKey derives the mailbox Ed25519 signing key from the
// recovery root, mailbox ID, and key epoch. Must match the Rust
// implementation byte-for-byte.
func DeriveSigningKey(
	recoveryRoot [32]byte,
	mailboxID [16]byte,
	keyEpoch uint32,
) (ed25519.PrivateKey, error) {
	salt := []byte("byos-mailbox-signing-v1")
	infoPrefix := []byte("byos-mailbox-signing-ed25519-v1")

	info := make([]byte, 0, len(infoPrefix)+len(mailboxID)+4)
	info = append(info, infoPrefix...)
	info = append(info, mailboxID[:]...)
	epochBytes := make([]byte, 4)
	binary.BigEndian.PutUint32(epochBytes, keyEpoch)
	info = append(info, epochBytes...)

	// HKDF-SHA256 with salt and info
	reader := hkdf.New(sha256.New, recoveryRoot[:], salt, info)
	seed := make([]byte, 32)
	if _, err := io.ReadFull(reader, seed); err != nil {
		return nil, err
	}
	return ed25519.NewKeyFromSeed(seed), nil
}

// SigningPublicKey returns the 32-byte Ed25519 public key corresponding
// to the signing key.
func SigningPublicKey(signingKey ed25519.PrivateKey) [32]byte {
	pub := signingKey.Public().(ed25519.PublicKey)
	var pubBytes [32]byte
	copy(pubBytes[:], pub)
	return pubBytes
}

// SignMessage signs AAD || ciphertext with standard Ed25519.
func SignMessage(
	signingKey ed25519.PrivateKey,
	aad, ciphertext []byte,
) ([64]byte, error) {
	payload := make([]byte, 0, len(aad)+len(ciphertext))
	payload = append(payload, aad...)
	payload = append(payload, ciphertext...)
	sig := ed25519.Sign(signingKey, payload)
	var sigBytes [64]byte
	copy(sigBytes[:], sig)
	return sigBytes, nil
}

// VerifyMessageSignature verifies a signature over AAD || ciphertext.
func VerifyMessageSignature(
	publicKey [32]byte,
	signature [64]byte,
	aad, ciphertext []byte,
) error {
	payload := make([]byte, 0, len(aad)+len(ciphertext))
	payload = append(payload, aad...)
	payload = append(payload, ciphertext...)
	if !ed25519.Verify(publicKey[:], payload, signature[:]) {
		return ErrSignatureInvalid
	}
	return nil
}
