// Package hpke implements unified dispatch for sealing and opening
// version 1 cryptographic envelopes across classical (X25519) and
// post-quantum hybrid (X-Wing) suites per BYOS-SPEC-CRYPTO-ENV-V1.
package hpke

import (
	"fmt"

	"byos.email/crypto/core"
	"byos.email/crypto/envelope"
)

// RecipientKey encapsulates the recipient's algorithm identifier and public key bytes.
type RecipientKey struct {
	Algorithm string // "HPKE-X25519-AES256GCM-v1" or "HPKE-XWing-AES256GCM-v1"
	PublicKey []byte // 32 bytes for X25519, 1216 bytes for X-Wing
}

// Seal encrypts plaintext for recipient using the algorithm specified in recipient.Algorithm.
//
// Dispatches to SealX25519 or SealXWing based on recipient.Algorithm:
//   - Unknown Algorithm returns ErrCodeUnsupportedAlgorithm (1002).
//   - Public key length mismatch returns ErrCodeInvalidKeyLength (1007).
func Seal(recipient RecipientKey, plaintext []byte, keyID string, keyEpoch uint32) (*envelope.CryptoEnvelope, error) {
	switch recipient.Algorithm {
	case envelope.AlgX25519:
		if len(recipient.PublicKey) != envelope.X25519EncSize {
			return nil, envelope.NewEnvelopeError(
				envelope.ErrCodeInvalidKeyLength,
				fmt.Sprintf("X25519 public key must be %d bytes, got %d", envelope.X25519EncSize, len(recipient.PublicKey)),
			)
		}
		return SealX25519(recipient.PublicKey, plaintext, keyID, keyEpoch)

	case envelope.AlgXWing:
		if len(recipient.PublicKey) != core.EncapsulationKeySize {
			return nil, envelope.NewEnvelopeError(
				envelope.ErrCodeInvalidKeyLength,
				fmt.Sprintf("X-Wing public key must be %d bytes, got %d", core.EncapsulationKeySize, len(recipient.PublicKey)),
			)
		}
		return SealXWing(recipient.PublicKey, plaintext, keyID, keyEpoch)

	default:
		return nil, envelope.NewEnvelopeError(
			envelope.ErrCodeUnsupportedAlgorithm,
			fmt.Sprintf("unsupported algorithm: %q", recipient.Algorithm),
		)
	}
}

// Open decrypts and verifies env using recipient's privateKey based on env.Alg.
//
//   - env is validated via envelope.Validate (rejecting malformed envelopes, unpadded base64, etc.).
//   - Unknown Algorithm returns ErrCodeUnsupportedAlgorithm (1002).
//   - Private key length mismatch returns ErrCodeInvalidKeyLength (1007).
//   - Dispatches to OpenX25519 or OpenXWing based on env.Alg.
func Open(env *envelope.CryptoEnvelope, privateKey []byte) ([]byte, error) {
	if env == nil {
		return nil, envelope.NewEnvelopeError(envelope.ErrCodeSerializationError, "envelope is nil")
	}
	if err := envelope.Validate(env); err != nil {
		return nil, err
	}

	switch env.Alg {
	case envelope.AlgX25519:
		if len(privateKey) != envelope.X25519EncSize {
			return nil, envelope.NewEnvelopeError(
				envelope.ErrCodeInvalidKeyLength,
				fmt.Sprintf("X25519 private key must be %d bytes, got %d", envelope.X25519EncSize, len(privateKey)),
			)
		}
		return OpenX25519(privateKey, env)

	case envelope.AlgXWing:
		if len(privateKey) != core.DecapsulationKeySize {
			return nil, envelope.NewEnvelopeError(
				envelope.ErrCodeInvalidKeyLength,
				fmt.Sprintf("X-Wing private key seed must be %d bytes, got %d", core.DecapsulationKeySize, len(privateKey)),
			)
		}
		return OpenXWing(privateKey, env)

	default:
		return nil, envelope.NewEnvelopeError(
			envelope.ErrCodeUnsupportedAlgorithm,
			fmt.Sprintf("unsupported algorithm: %q", env.Alg),
		)
	}
}
