// Package hpke implements the post-quantum hybrid HPKE-XWing-AES256GCM-v1 cryptographic suite
// according to draft-connolly-cfrg-xwing-kem and BYOS-SPEC-CRYPTO-ENV-V1.
package hpke

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/mlkem"
	"crypto/mlkem/mlkemtest"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"io"

	"byos.email/crypto/core"
	"byos.email/crypto/envelope"
)

// GenerateKeyPairXWing generates a fresh random X-Wing key pair:
// 32-byte private key seed and 1216-byte public key (pk_M || pk_X).
func GenerateKeyPairXWing() (skSeed, pk []byte, err error) {
	return core.GenerateKeyPair()
}

// EncapsulateXWing encapsulates a shared secret for recipientXWingPub (1216 bytes)
// using X-Wing hybrid KEM (ML-KEM-768 + X25519) per draft-connolly-cfrg-xwing-kem §5.
// Returns enc (1120 bytes: ct_M || ct_X) and 32-byte combined sharedSecret.
func EncapsulateXWing(recipientXWingPub []byte) (enc, sharedSecret []byte, err error) {
	if len(recipientXWingPub) != core.EncapsulationKeySize {
		return nil, nil, envelope.NewEnvelopeError(
			envelope.ErrCodeInvalidKeyLength,
			fmt.Sprintf("recipient X-Wing public key must be %d bytes, got %d", core.EncapsulationKeySize, len(recipientXWingPub)),
		)
	}

	enc, sharedSecret, err = core.Encapsulate(recipientXWingPub)
	if err != nil {
		return nil, nil, envelope.NewEnvelopeError(
			envelope.ErrCodeDecapsulationFailed,
			fmt.Sprintf("X-Wing encapsulation failed: %v", err),
		)
	}

	return enc, sharedSecret, nil
}

// DecapsulateXWing decapsulates an X-Wing enc (1120 bytes) using recipient's 32-byte private key seed
// per draft-connolly-cfrg-xwing-kem §5.5.
func DecapsulateXWing(recipientPrivSeed, enc []byte) ([]byte, error) {
	if len(recipientPrivSeed) != core.DecapsulationKeySize {
		return nil, envelope.NewEnvelopeError(
			envelope.ErrCodeInvalidKeyLength,
			fmt.Sprintf("recipient private key seed must be %d bytes, got %d", core.DecapsulationKeySize, len(recipientPrivSeed)),
		)
	}
	if len(enc) != core.CiphertextSize {
		return nil, envelope.NewEnvelopeError(
			envelope.ErrCodeInvalidKeyLength,
			fmt.Sprintf("enc must be %d bytes, got %d", core.CiphertextSize, len(enc)),
		)
	}

	ss, err := core.Decapsulate(recipientPrivSeed, enc)
	if err != nil {
		return nil, envelope.NewEnvelopeError(
			envelope.ErrCodeDecapsulationFailed,
			fmt.Sprintf("X-Wing decapsulation failed: %v", err),
		)
	}
	return ss, nil
}

// SealXWing seals plaintext for recipientXWingPub using HPKE-XWing-AES256GCM-v1:
// 1. Encapsulates with X-Wing to obtain enc (1120 bytes) and sharedSecret (32 bytes).
// 2. Derives 32-byte AES key via DeriveAEADKey(sharedSecret, SuiteXWing).
// 3. Generates 12-byte CSPRNG random nonce.
// 4. Builds deterministic binary AAD binding envelope metadata.
// 5. Encrypts plaintext with AES-256-GCM.
func SealXWing(recipientXWingPub, plaintext []byte, keyID string, keyEpoch uint32) (*envelope.CryptoEnvelope, error) {
	if len(recipientXWingPub) != core.EncapsulationKeySize {
		return nil, envelope.NewEnvelopeError(
			envelope.ErrCodeInvalidKeyLength,
			fmt.Sprintf("recipient X-Wing public key must be %d bytes, got %d", core.EncapsulationKeySize, len(recipientXWingPub)),
		)
	}
	if len(keyID) == 0 || len(keyID) > 255 {
		return nil, envelope.NewEnvelopeError(
			envelope.ErrCodeSerializationError,
			"key_id length must be between 1 and 255 bytes",
		)
	}
	if keyEpoch == 0 {
		return nil, envelope.NewEnvelopeError(
			envelope.ErrCodeUnknownKeyEpoch,
			"key_epoch 0 is reserved",
		)
	}

	enc, sharedSecret, err := EncapsulateXWing(recipientXWingPub)
	if err != nil {
		return nil, err
	}

	aesKey, err := DeriveAEADKey(sharedSecret, SuiteXWing)
	if err != nil {
		return nil, err
	}

	nonce := make([]byte, envelope.NonceSize)
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("generating random nonce: %w", err)
	}

	aad, err := envelope.BuildAADRaw(envelope.CurrentVersion, envelope.AlgXWing, keyID, keyEpoch, enc, nonce)
	if err != nil {
		return nil, err
	}

	block, err := aes.NewCipher(aesKey)
	if err != nil {
		return nil, fmt.Errorf("aes.NewCipher failed: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("cipher.NewGCM failed: %w", err)
	}

	ciphertext := gcm.Seal(nil, nonce, plaintext, aad)

	b64 := base64.StdEncoding
	return &envelope.CryptoEnvelope{
		Alg:        envelope.AlgXWing,
		Ciphertext: b64.EncodeToString(ciphertext),
		Enc:        b64.EncodeToString(enc),
		KeyEpoch:   keyEpoch,
		KeyID:      keyID,
		Nonce:      b64.EncodeToString(nonce),
		Sig:        nil,
		V:          envelope.CurrentVersion,
	}, nil
}

// OpenXWing decrypts and verifies a CryptoEnvelope using recipient's 32-byte private key seed.
func OpenXWing(recipientPrivSeed []byte, env *envelope.CryptoEnvelope) ([]byte, error) {
	if env == nil {
		return nil, envelope.NewEnvelopeError(envelope.ErrCodeSerializationError, "envelope is nil")
	}
	if err := envelope.Validate(env); err != nil {
		return nil, err
	}
	if env.Alg != envelope.AlgXWing {
		return nil, envelope.NewEnvelopeError(
			envelope.ErrCodeUnsupportedAlgorithm,
			fmt.Sprintf("expected %s, got %s", envelope.AlgXWing, env.Alg),
		)
	}

	decoded, err := env.DecodeBase64()
	if err != nil {
		return nil, err
	}

	sharedSecret, err := DecapsulateXWing(recipientPrivSeed, decoded.RawEnc)
	if err != nil {
		return nil, err
	}

	aesKey, err := DeriveAEADKey(sharedSecret, SuiteXWing)
	if err != nil {
		return nil, err
	}

	aad, err := envelope.BuildAAD(env)
	if err != nil {
		return nil, err
	}

	block, err := aes.NewCipher(aesKey)
	if err != nil {
		return nil, fmt.Errorf("aes.NewCipher failed: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("cipher.NewGCM failed: %w", err)
	}

	plaintext, err := gcm.Open(nil, decoded.RawNonce, decoded.RawCiphertext, aad)
	if err != nil {
		return nil, envelope.NewEnvelopeError(
			envelope.ErrCodeDecryptionFailed,
			"AES-GCM tag verification failed (tampered ciphertext or AAD)",
		)
	}

	return plaintext, nil
}

// sealXWingDeterministic is a test-only helper. It accepts an externally
// supplied e_seed (64 bytes for ML-KEM-768 + X25519 expansion) and nonce.
func sealXWingDeterministic(
	recipientXWingPub []byte,
	eseed []byte,
	plaintext []byte,
	nonce []byte,
	keyID string,
	keyEpoch uint32,
) (*envelope.CryptoEnvelope, error) {
	if len(recipientXWingPub) != core.EncapsulationKeySize {
		return nil, envelope.NewEnvelopeError(
			envelope.ErrCodeInvalidKeyLength,
			fmt.Sprintf("recipient X-Wing public key must be %d bytes, got %d", core.EncapsulationKeySize, len(recipientXWingPub)),
		)
	}
	if len(eseed) != 64 {
		return nil, envelope.NewEnvelopeError(
			envelope.ErrCodeInvalidKeyLength,
			fmt.Sprintf("eseed must be 64 bytes, got %d", len(eseed)),
		)
	}
	if len(nonce) != envelope.NonceSize {
		return nil, envelope.NewEnvelopeError(
			envelope.ErrCodeInvalidNonceLength,
			fmt.Sprintf("nonce must be %d bytes, got %d", envelope.NonceSize, len(nonce)),
		)
	}
	if len(keyID) == 0 || len(keyID) > 255 {
		return nil, envelope.NewEnvelopeError(
			envelope.ErrCodeSerializationError,
			"key_id length must be between 1 and 255 bytes",
		)
	}
	if keyEpoch == 0 {
		return nil, envelope.NewEnvelopeError(
			envelope.ErrCodeUnknownKeyEpoch,
			"key_epoch 0 is reserved",
		)
	}

	pkM := recipientXWingPub[0:core.MLKEM768EncapsulationKeySize]
	pkX := recipientXWingPub[core.MLKEM768EncapsulationKeySize:core.EncapsulationKeySize]
	mSeed := eseed[0:32]
	xSeed := eseed[32:64]

	// 1. ML-KEM-768 derandomized encapsulation
	ekM, err := mlkem.NewEncapsulationKey768(pkM)
	if err != nil {
		return nil, envelope.NewEnvelopeError(
			envelope.ErrCodeInvalidKeyLength,
			fmt.Sprintf("invalid ML-KEM-768 public key: %v", err),
		)
	}
	ssM, ctM, err := mlkemtest.Encapsulate768(ekM, mSeed)
	if err != nil {
		return nil, envelope.NewEnvelopeError(
			envelope.ErrCodeDecapsulationFailed,
			fmt.Sprintf("ML-KEM-768 derandomized encapsulation failed: %v", err),
		)
	}

	// 2. X25519 ephemeral key and ECDH
	curve := ecdh.X25519()
	ekX, err := curve.NewPrivateKey(xSeed)
	if err != nil {
		return nil, envelope.NewEnvelopeError(
			envelope.ErrCodeInvalidKeyLength,
			fmt.Sprintf("invalid X25519 ephemeral private scalar: %v", err),
		)
	}
	ctX := ekX.PublicKey().Bytes()

	pubX, err := curve.NewPublicKey(pkX)
	if err != nil {
		return nil, envelope.NewEnvelopeError(
			envelope.ErrCodeInvalidKeyLength,
			fmt.Sprintf("invalid recipient X25519 public key: %v", err),
		)
	}
	ssX, err := ekX.ECDH(pubX)
	if err != nil {
		return nil, envelope.NewEnvelopeError(
			envelope.ErrCodeDecapsulationFailed,
			fmt.Sprintf("X25519 ECDH failed: %v", err),
		)
	}

	// 3. Combiner
	ssCombined, err := core.Combiner(ssM, ssX, ctX, pkX)
	if err != nil {
		return nil, envelope.NewEnvelopeError(
			envelope.ErrCodeDecapsulationFailed,
			fmt.Sprintf("Combiner failed: %v", err),
		)
	}

	enc := make([]byte, core.CiphertextSize)
	copy(enc[0:core.MLKEM768CiphertextSize], ctM)
	copy(enc[core.MLKEM768CiphertextSize:core.CiphertextSize], ctX)

	// 4. Derive AEAD Key
	aesKey, err := DeriveAEADKey(ssCombined, SuiteXWing)
	if err != nil {
		return nil, err
	}

	// 5. Build AAD
	aad, err := envelope.BuildAADRaw(envelope.CurrentVersion, envelope.AlgXWing, keyID, keyEpoch, enc, nonce)
	if err != nil {
		return nil, err
	}

	block, err := aes.NewCipher(aesKey)
	if err != nil {
		return nil, fmt.Errorf("aes.NewCipher failed: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("cipher.NewGCM failed: %w", err)
	}

	ciphertext := gcm.Seal(nil, nonce, plaintext, aad)

	b64 := base64.StdEncoding
	return &envelope.CryptoEnvelope{
		Alg:        envelope.AlgXWing,
		Ciphertext: b64.EncodeToString(ciphertext),
		Enc:        b64.EncodeToString(enc),
		KeyEpoch:   keyEpoch,
		KeyID:      keyID,
		Nonce:      b64.EncodeToString(nonce),
		Sig:        nil,
		V:          envelope.CurrentVersion,
	}, nil
}

