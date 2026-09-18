// Package hpke implements the classical HPKE-X25519-AES256GCM-v1 cryptographic suite
// according to RFC 9180 and BYOS-SPEC-CRYPTO-ENV-V1.
package hpke

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"io"

	"byos.email/crypto/envelope"
)

// HPKE Suite Identifiers per RFC 9180 §7.1 - §7.3
const (
	KemID_DHKEM_X25519_HKDF_SHA256 = 0x0020
	KemID_XWing                    = 0x647a
	KdfID_HKDF_SHA256              = 0x0001
	AeadID_AES_256_GCM             = 0x0002
)

// SuiteX25519 is the 10-byte HPKE suite identifier for HPKE-X25519-AES256GCM-v1:
// "HPKE" || 0x0020 (KEM) || 0x0001 (KDF) || 0x0002 (AEAD)
var SuiteX25519 = []byte{'H', 'P', 'K', 'E', 0x00, 0x20, 0x00, 0x01, 0x00, 0x02}

// SuiteXWing is the 10-byte HPKE suite identifier for HPKE-XWing-AES256GCM-v1:
// "HPKE" || 0x647a (KEM) || 0x0001 (KDF) || 0x0002 (AEAD)
var SuiteXWing = []byte{'H', 'P', 'K', 'E', 0x64, 0x7a, 0x00, 0x01, 0x00, 0x02}

// DHKEMX25519SuiteID is the 5-byte KEM suite identifier: "KEM" || 0x0020
var DHKEMX25519SuiteID = []byte{0x4b, 0x45, 0x4d, 0x00, 0x20}

// LabeledExtract implements RFC 9180 §4:
// LabeledExtract(salt, label, ikm) = HMAC-SHA256(salt, "HPKE-v1" || suite_id || label || ikm)
func LabeledExtract(salt []byte, label string, ikm []byte, suiteID []byte) []byte {
	mac := hmac.New(sha256.New, salt)
	mac.Write([]byte("HPKE-v1"))
	mac.Write(suiteID)
	mac.Write([]byte(label))
	if len(ikm) > 0 {
		mac.Write(ikm)
	}
	return mac.Sum(nil)
}

// LabeledExpand implements RFC 9180 §4:
// LabeledExpand(prk, label, info, L) = HKDF-Expand(prk, I2OSP(L,2) || "HPKE-v1" || suite_id || label || info, L)
func LabeledExpand(prk []byte, label string, info []byte, length int, suiteID []byte) []byte {
	labeledInfo := make([]byte, 0, 2+7+len(suiteID)+len(label)+len(info))
	lenBuf := make([]byte, 2)
	binary.BigEndian.PutUint16(lenBuf, uint16(length))
	labeledInfo = append(labeledInfo, lenBuf...)
	labeledInfo = append(labeledInfo, []byte("HPKE-v1")...)
	labeledInfo = append(labeledInfo, suiteID...)
	labeledInfo = append(labeledInfo, []byte(label)...)
	if len(info) > 0 {
		labeledInfo = append(labeledInfo, info...)
	}

	okm, _ := hkdfExpand(prk, labeledInfo, length)
	return okm
}

// hkdfExpand implements RFC 5869 §2.3 HMAC-SHA256 expansion.
func hkdfExpand(prk, info []byte, length int) ([]byte, error) {
	hashLen := sha256.Size // 32 bytes
	if length > 255*hashLen {
		return nil, errors.New("hkdf: requested length exceeds maximum allowed")
	}
	n := (length + hashLen - 1) / hashLen
	okm := make([]byte, 0, n*hashLen)
	var prev []byte
	for i := 1; i <= n; i++ {
		h := hmac.New(sha256.New, prk)
		if len(prev) > 0 {
			h.Write(prev)
		}
		if len(info) > 0 {
			h.Write(info)
		}
		h.Write([]byte{byte(i)})
		prev = h.Sum(nil)
		okm = append(okm, prev...)
	}
	return okm[:length], nil
}

// DHKEMExtractAndExpand derives the shared_secret from raw DH output and kem_context
// per RFC 9180 §4.1:
//
//	eae_prk = LabeledExtract("", "eae_prk", dh)
//	shared_secret = LabeledExpand(eae_prk, "shared_secret", kem_context, Nsecret)
func DHKEMExtractAndExpand(dh, enc, pkR []byte) []byte {
	eaePRK := LabeledExtract(nil, "eae_prk", dh, DHKEMX25519SuiteID)
	kemContext := make([]byte, 0, len(enc)+len(pkR))
	kemContext = append(kemContext, enc...)
	kemContext = append(kemContext, pkR...)
	return LabeledExpand(eaePRK, "shared_secret", kemContext, 32, DHKEMX25519SuiteID)
}

// DeriveAEADKey derives the 32-byte AES-256-GCM symmetric key from sharedSecret
// using RFC 9180 §5.1 key schedule primitives with the parameterized suiteID:
//
//	psk_id_hash = LabeledExtract("", "psk_id_hash", psk_id)
//	info_hash = LabeledExtract("", "info_hash", info)
//	key_schedule_context = concat(I2OSP(mode, 1), psk_id_hash, info_hash)
//	secret = LabeledExtract(shared_secret, "secret", psk)
//	key = LabeledExpand(secret, "key", key_schedule_context, 32)
func DeriveAEADKey(sharedSecret []byte, suiteID []byte) (key []byte, err error) {
	if len(sharedSecret) == 0 {
		return nil, errors.New("sharedSecret must not be empty")
	}
	if len(suiteID) == 0 {
		return nil, errors.New("suiteID must not be empty")
	}

	pskIDHash := LabeledExtract(nil, "psk_id_hash", nil, suiteID)
	infoHash := LabeledExtract(nil, "info_hash", nil, suiteID)

	ksContext := make([]byte, 0, 1+len(pskIDHash)+len(infoHash))
	ksContext = append(ksContext, 0x00) // Mode Base = 0x00
	ksContext = append(ksContext, pskIDHash...)
	ksContext = append(ksContext, infoHash...)

	secret := LabeledExtract(sharedSecret, "secret", nil, suiteID)
	return LabeledExpand(secret, "key", ksContext, 32, suiteID), nil
}

// GenerateKeyPairX25519 generates a fresh random X25519 key pair.
func GenerateKeyPairX25519() (priv, pub []byte, err error) {
	k, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		return nil, nil, err
	}
	return k.Bytes(), k.PublicKey().Bytes(), nil
}

// EncapsulateX25519 encapsulates a shared secret for recipientPub using
// DHKEM(X25519, HKDF-SHA256) per RFC 9180 §4.1.
// Returns ephemeral public key enc (32 bytes) and combined sharedSecret (32 bytes).
func EncapsulateX25519(recipientPub []byte) (enc, sharedSecret []byte, err error) {
	if len(recipientPub) != envelope.X25519EncSize {
		return nil, nil, envelope.NewEnvelopeError(envelope.ErrCodeInvalidKeyLength, fmt.Sprintf("recipient public key must be %d bytes, got %d", envelope.X25519EncSize, len(recipientPub)))
	}

	curve := ecdh.X25519()
	ephemeralKey, err := curve.GenerateKey(rand.Reader)
	if err != nil {
		return nil, nil, fmt.Errorf("generating ephemeral key: %w", err)
	}

	return EncapsulateX25519WithKey(ephemeralKey, recipientPub)
}

// EncapsulateX25519WithKey encapsulates using a pre-determined ephemeral private key
// (used for deterministic test vector validation per RFC 9180 Appendix A.1).
func EncapsulateX25519WithKey(ephemeralKey *ecdh.PrivateKey, recipientPub []byte) (enc, sharedSecret []byte, err error) {
	if len(recipientPub) != envelope.X25519EncSize {
		return nil, nil, envelope.NewEnvelopeError(envelope.ErrCodeInvalidKeyLength, fmt.Sprintf("recipient public key must be %d bytes, got %d", envelope.X25519EncSize, len(recipientPub)))
	}

	pubR, err := ecdh.X25519().NewPublicKey(recipientPub)
	if err != nil {
		return nil, nil, envelope.NewEnvelopeError(envelope.ErrCodeInvalidKeyLength, fmt.Sprintf("invalid recipient public key: %v", err))
	}

	enc = ephemeralKey.PublicKey().Bytes()

	dh, err := ephemeralKey.ECDH(pubR)
	if err != nil {
		return nil, nil, envelope.NewEnvelopeError(envelope.ErrCodeDecapsulationFailed, fmt.Sprintf("X25519 ECDH failed: %v", err))
	}

	sharedSecret = DHKEMExtractAndExpand(dh, enc, recipientPub)
	return enc, sharedSecret, nil
}

// DecapsulateX25519 decapsulates an X25519 enc (32 bytes) using recipient's private key (32 bytes)
// per RFC 9180 §4.1.
func DecapsulateX25519(recipientPriv, enc []byte) ([]byte, error) {
	if len(recipientPriv) != envelope.X25519EncSize {
		return nil, envelope.NewEnvelopeError(envelope.ErrCodeInvalidKeyLength, fmt.Sprintf("recipient private key must be %d bytes, got %d", envelope.X25519EncSize, len(recipientPriv)))
	}
	if len(enc) != envelope.X25519EncSize {
		return nil, envelope.NewEnvelopeError(envelope.ErrCodeInvalidKeyLength, fmt.Sprintf("enc must be %d bytes, got %d", envelope.X25519EncSize, len(enc)))
	}

	curve := ecdh.X25519()
	privR, err := curve.NewPrivateKey(recipientPriv)
	if err != nil {
		return nil, envelope.NewEnvelopeError(envelope.ErrCodeInvalidKeyLength, fmt.Sprintf("invalid recipient private key: %v", err))
	}

	pubE, err := curve.NewPublicKey(enc)
	if err != nil {
		return nil, envelope.NewEnvelopeError(envelope.ErrCodeInvalidKeyLength, fmt.Sprintf("invalid ephemeral public key enc: %v", err))
	}

	dh, err := privR.ECDH(pubE)
	if err != nil {
		return nil, envelope.NewEnvelopeError(envelope.ErrCodeDecapsulationFailed, fmt.Sprintf("X25519 ECDH failed: %v", err))
	}

	recipientPub := privR.PublicKey().Bytes()
	return DHKEMExtractAndExpand(dh, enc, recipientPub), nil
}

// SealX25519 seals plaintext for recipientPub using HPKE-X25519-AES256GCM-v1:
// 1. Encapsulates ephemeral key to obtain enc and sharedSecret.
// 2. Derives 32-byte AES key via DeriveAEADKey(sharedSecret, SuiteX25519).
// 3. Generates 12-byte CSPRNG random nonce.
// 4. Builds deterministic binary AAD binding envelope metadata.
// 5. Encrypts plaintext with AES-256-GCM.
func SealX25519(recipientPub, plaintext []byte, keyID string, keyEpoch uint32) (*envelope.CryptoEnvelope, error) {
	if len(recipientPub) != envelope.X25519EncSize {
		return nil, envelope.NewEnvelopeError(envelope.ErrCodeInvalidKeyLength, fmt.Sprintf("recipient public key must be %d bytes, got %d", envelope.X25519EncSize, len(recipientPub)))
	}
	if len(keyID) == 0 || len(keyID) > 255 {
		return nil, envelope.NewEnvelopeError(envelope.ErrCodeSerializationError, "key_id length must be between 1 and 255 bytes")
	}
	if keyEpoch == 0 {
		return nil, envelope.NewEnvelopeError(envelope.ErrCodeUnknownKeyEpoch, "key_epoch 0 is reserved")
	}

	enc, sharedSecret, err := EncapsulateX25519(recipientPub)
	if err != nil {
		return nil, err
	}

	aesKey, err := DeriveAEADKey(sharedSecret, SuiteX25519)
	if err != nil {
		return nil, err
	}

	nonce := make([]byte, envelope.NonceSize)
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("generating random nonce: %w", err)
	}

	aad, err := envelope.BuildAADRaw(envelope.CurrentVersion, envelope.AlgX25519, keyID, keyEpoch, enc, nonce)
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
		Alg:        envelope.AlgX25519,
		Ciphertext: b64.EncodeToString(ciphertext),
		Enc:        b64.EncodeToString(enc),
		KeyEpoch:   keyEpoch,
		KeyID:      keyID,
		Nonce:      b64.EncodeToString(nonce),
		Sig:        nil,
		V:          envelope.CurrentVersion,
	}, nil
}

// OpenX25519 decrypts and verifies a CryptoEnvelope using recipient's 32-byte private key.
func OpenX25519(recipientPriv []byte, env *envelope.CryptoEnvelope) ([]byte, error) {
	if env == nil {
		return nil, envelope.NewEnvelopeError(envelope.ErrCodeSerializationError, "envelope is nil")
	}
	if err := envelope.Validate(env); err != nil {
		return nil, err
	}
	if env.Alg != envelope.AlgX25519 {
		return nil, envelope.NewEnvelopeError(envelope.ErrCodeUnsupportedAlgorithm, fmt.Sprintf("expected %s, got %s", envelope.AlgX25519, env.Alg))
	}

	decoded, err := env.DecodeBase64()
	if err != nil {
		return nil, err
	}

	sharedSecret, err := DecapsulateX25519(recipientPriv, decoded.RawEnc)
	if err != nil {
		return nil, err
	}

	aesKey, err := DeriveAEADKey(sharedSecret, SuiteX25519)
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
		return nil, envelope.NewEnvelopeError(envelope.ErrCodeDecryptionFailed, "AES-GCM tag verification failed (tampered ciphertext or AAD)")
	}

	return plaintext, nil
}
