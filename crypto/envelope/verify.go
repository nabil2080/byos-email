package envelope

import (
	"crypto/ed25519"
	"encoding/base64"
	"errors"
	"fmt"
)

// VerifyEnvelopeSignature verifies an Ed25519 signature over 
// AAD || raw ciphertext bytes.
//
// canonical form is AAD || ciphertext (raw bytes). Attachment envelopes are excluded from message envelope signature.
//
// The signature is decoded from the envelope's base64 sig field.
// The ciphertext is decoded from the envelope's base64 ciphertext field.
func VerifyEnvelopeSignature(
	senderEd25519PK []byte, // 32 bytes
	env *CryptoEnvelope,
) error {
	// 1. Validate senderEd25519PK is 32 bytes
	if len(senderEd25519PK) != ed25519.PublicKeySize {
		return NewEnvelopeError(ErrCodeInvalidKeyLength, fmt.Sprintf("invalid sender public key length %d, expected %d", len(senderEd25519PK), ed25519.PublicKeySize))
	}

	if env == nil {
		return NewEnvelopeError(ErrCodeSerializationError, "envelope is nil")
	}

	// 2. Return error if env.Sig is nil
	if env.Sig == nil {
		return NewEnvelopeError(ErrCodeInvalidSignature, "envelope signature is missing (sig is null)")
	}

	// 3. Base64-decode: env.Enc, env.Nonce, env.Ciphertext, *env.Sig
	b64 := base64.StdEncoding.Strict()

	encBytes, err := b64.DecodeString(env.Enc)
	if err != nil {
		return NewEnvelopeError(ErrCodeInvalidBase64, fmt.Sprintf("invalid base64 in enc: %v", err))
	}

	nonceBytes, err := b64.DecodeString(env.Nonce)
	if err != nil {
		return NewEnvelopeError(ErrCodeInvalidBase64, fmt.Sprintf("invalid base64 in nonce: %v", err))
	}

	ciphertextBytes, err := b64.DecodeString(env.Ciphertext)
	if err != nil {
		return NewEnvelopeError(ErrCodeInvalidBase64, fmt.Sprintf("invalid base64 in ciphertext: %v", err))
	}

	sigBytes, err := b64.DecodeString(*env.Sig)
	if err != nil {
		return NewEnvelopeError(ErrCodeInvalidBase64, fmt.Sprintf("invalid base64 in sig: %v", err))
	}

	// 4. Validate nonce is 12 bytes, enc is 1120 bytes for X-Wing (or 32 bytes for X25519)
	if len(nonceBytes) != NonceSize {
		return NewEnvelopeError(ErrCodeInvalidNonceLength, fmt.Sprintf("invalid nonce length %d, expected %d", len(nonceBytes), NonceSize))
	}
	var nonce [12]byte
	copy(nonce[:], nonceBytes)

	if env.Alg == AlgXWing && len(encBytes) != XWingEncSize {
		return NewEnvelopeError(ErrCodeInvalidKeyLength, fmt.Sprintf("invalid enc length %d for X-Wing, expected %d", len(encBytes), XWingEncSize))
	} else if env.Alg == AlgX25519 && len(encBytes) != X25519EncSize {
		return NewEnvelopeError(ErrCodeInvalidKeyLength, fmt.Sprintf("invalid enc length %d for X25519, expected %d", len(encBytes), X25519EncSize))
	}

	// 7. Validate sig is 64 bytes
	if len(sigBytes) != ed25519.SignatureSize {
		return NewEnvelopeError(ErrCodeInvalidSignature, fmt.Sprintf("invalid signature length %d, expected %d", len(sigBytes), ed25519.SignatureSize))
	}

	// 5. Build AAD via BuildEnvelopeAAD(env.V, env.Alg, env.KeyID, env.KeyEpoch, enc, nonce)
	aad, err := BuildEnvelopeAAD(env.V, env.Alg, env.KeyID, env.KeyEpoch, encBytes, nonce)
	if err != nil {
		return err
	}

	// 6. Construct the signing message: sigData = AAD || ciphertext (raw bytes)
	sigData := make([]byte, 0, len(aad)+len(ciphertextBytes))
	sigData = append(sigData, aad...)
	sigData = append(sigData, ciphertextBytes...)

	// 8. Use ed25519.Verify(senderEd25519PK, sigData, sigBytes)
	if !ed25519.Verify(senderEd25519PK, sigData, sigBytes) {
		return NewEnvelopeError(ErrCodeSignatureVerificationFailed, "ed25519 signature verification failed")
	}

	// 9. Return nil on success
	return nil
}

// SigningPublicKeyFromSeed derives the 32-byte Ed25519 public key from a 32-byte seed.
func SigningPublicKeyFromSeed(seed []byte) ([]byte, error) {
	if len(seed) != ed25519.SeedSize {
		return nil, errors.New("invalid seed length: must be 32 bytes")
	}
	privKey := ed25519.NewKeyFromSeed(seed)
	pubKey := privKey.Public().(ed25519.PublicKey)
	res := make([]byte, ed25519.PublicKeySize)
	copy(res, pubKey)
	return res, nil
}
