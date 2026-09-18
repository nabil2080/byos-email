// Package envelope implements the Versioned Crypto Envelope v1 wire format,
// canonical serialization, Additional Authenticated Data (AAD) construction,
// and validation per BYOS-SPEC-CRYPTO-ENV-V1.
package envelope

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"log"
	"strconv"
)

// Supported cryptographic algorithms per BYOS-SPEC-CRYPTO-ENV-V1 §5.
const (
	AlgX25519 = "HPKE-X25519-AES256GCM-v1"
	AlgXWing  = "HPKE-XWing-AES256GCM-v1"
)

// Specification constants.
const (
	CurrentVersion = 1
	NonceSize      = 12
	TagSize        = 16

	X25519EncSize = 32
	XWingEncSize  = 1120
)

// Standard error codes per BYOS-SPEC-CRYPTO-ENV-V1 §9.
const (
	ErrCodeUnsupportedVersion          = 1001
	ErrCodeUnsupportedAlgorithm        = 1002
	ErrCodeInvalidBase64               = 1003
	ErrCodeInvalidNonceLength          = 1004
	ErrCodeDecapsulationFailed         = 1005
	ErrCodeDecryptionFailed            = 1006
	ErrCodeInvalidKeyLength            = 1007
	ErrCodeUnknownKeyEpoch             = 1008
	ErrCodeSerializationError          = 1009
	ErrCodeAADMismatch                 = 1010
	ErrCodeInvalidSignature            = 1011
	ErrCodeUnknownSenderKey            = 1012
	ErrCodeSignatureVerificationFailed = 1013
)

// WarnLogger is an optional hook invoked when non-fatal warnings occur
// during validation (e.g. forward-compatible fields like non-null sig in V1).
var WarnLogger func(format string, args ...any)

// EnvelopeError represents a standardized envelope error with numeric code.
type EnvelopeError struct {
	Code    int
	Message string
}

func (e *EnvelopeError) Error() string {
	return fmt.Sprintf("envelope error %d (%s): %s", e.Code, e.Identifier(), e.Message)
}

func (e *EnvelopeError) Identifier() string {
	switch e.Code {
	case ErrCodeUnsupportedVersion:
		return "UnsupportedVersion"
	case ErrCodeUnsupportedAlgorithm:
		return "UnsupportedAlgorithm"
	case ErrCodeInvalidBase64:
		return "InvalidBase64"
	case ErrCodeInvalidNonceLength:
		return "InvalidNonceLength"
	case ErrCodeDecapsulationFailed:
		return "DecapsulationFailed"
	case ErrCodeDecryptionFailed:
		return "DecryptionFailed"
	case ErrCodeInvalidKeyLength:
		return "InvalidKeyLength"
	case ErrCodeUnknownKeyEpoch:
		return "UnknownKeyEpoch"
	case ErrCodeSerializationError:
		return "SerializationError"
	case ErrCodeAADMismatch:
		return "AADMismatch"
	case ErrCodeInvalidSignature:
		return "InvalidSignature"
	case ErrCodeUnknownSenderKey:
		return "UnknownSenderKey"
	case ErrCodeSignatureVerificationFailed:
		return "SignatureVerificationFailed"
	default:
		return "UnknownError"
	}
}

// NewEnvelopeError returns an EnvelopeError pointer with code and message.
func NewEnvelopeError(code int, message string) *EnvelopeError {
	return &EnvelopeError{
		Code:    code,
		Message: message,
	}
}

// CryptoEnvelope defines the version 1 cryptographic envelope wire format
// specified in BYOS-SPEC-CRYPTO-ENV-V1 §2.1.
//
// Struct field order strictly matches lexicographical JSON key order:
// "alg" -> "ciphertext" -> "enc" -> "key_epoch" -> "key_id" -> "nonce" -> "sig" -> "v"
type CryptoEnvelope struct {
	Alg        string  `json:"alg"`
	Ciphertext string  `json:"ciphertext"`
	Enc        string  `json:"enc"`
	KeyEpoch   uint32  `json:"key_epoch"`
	KeyID      string  `json:"key_id"`
	Nonce      string  `json:"nonce"`
	Sig        *string `json:"sig"`
	V          uint8   `json:"v"`
}

// DecodedPayload contains the raw binary slices decoded from the envelope fields.
type DecodedPayload struct {
	RawEnc        []byte
	RawNonce      []byte
	RawCiphertext []byte
	RawSig        []byte
}

// DecodeBase64 decodes and strictly validates all Base64 fields in the envelope.
func (env *CryptoEnvelope) DecodeBase64() (*DecodedPayload, error) {
	if env == nil {
		return nil, NewEnvelopeError(ErrCodeSerializationError, "envelope is nil")
	}

	b64 := base64.StdEncoding.Strict()

	rawEnc, err := b64.DecodeString(env.Enc)
	if err != nil {
		return nil, NewEnvelopeError(ErrCodeInvalidBase64, fmt.Sprintf("invalid base64 in enc: %v", err))
	}

	rawNonce, err := b64.DecodeString(env.Nonce)
	if err != nil {
		return nil, NewEnvelopeError(ErrCodeInvalidBase64, fmt.Sprintf("invalid base64 in nonce: %v", err))
	}

	rawCiphertext, err := b64.DecodeString(env.Ciphertext)
	if err != nil {
		return nil, NewEnvelopeError(ErrCodeInvalidBase64, fmt.Sprintf("invalid base64 in ciphertext: %v", err))
	}

	var rawSig []byte
	if env.Sig != nil {
		decodedSig, err := b64.DecodeString(*env.Sig)
		if err != nil {
			return nil, NewEnvelopeError(ErrCodeInvalidBase64, fmt.Sprintf("invalid base64 in sig: %v", err))
		}
		rawSig = decodedSig
	}

	return &DecodedPayload{
		RawEnc:        rawEnc,
		RawNonce:      rawNonce,
		RawCiphertext: rawCiphertext,
		RawSig:        rawSig,
	}, nil
}

// Validate performs full structural, algorithmic, and cryptographic bounds checks
// on the envelope according to BYOS-SPEC-CRYPTO-ENV-V1.
func Validate(env *CryptoEnvelope) error {
	if env == nil {
		return NewEnvelopeError(ErrCodeSerializationError, "envelope is nil")
	}

	// 1. Version check (§8)
	if env.V != CurrentVersion {
		return NewEnvelopeError(ErrCodeUnsupportedVersion, fmt.Sprintf("unsupported envelope version %d, expected %d", env.V, CurrentVersion))
	}

	// 2. Algorithm check (§5)
	if env.Alg != AlgX25519 && env.Alg != AlgXWing {
		return NewEnvelopeError(ErrCodeUnsupportedAlgorithm, fmt.Sprintf("unsupported algorithm %q", env.Alg))
	}
	if len(env.Alg) == 0 || len(env.Alg) > 255 {
		return NewEnvelopeError(ErrCodeUnsupportedAlgorithm, "alg length must be between 1 and 255 bytes")
	}

	// 3. Key Epoch check (§6)
	if env.KeyEpoch == 0 {
		return NewEnvelopeError(ErrCodeUnknownKeyEpoch, "key_epoch 0 is reserved and rejected")
	}

	// 4. Key ID check (§3.2)
	if len(env.KeyID) == 0 {
		return NewEnvelopeError(ErrCodeSerializationError, "key_id must not be empty")
	}
	if len(env.KeyID) > 255 {
		return NewEnvelopeError(ErrCodeSerializationError, "key_id length exceeds 255 bytes")
	}

	// 5. Base64 decoding & verification (§2.2 rule 5)
	decoded, err := env.DecodeBase64()
	if err != nil {
		return err
	}

	// 6. Nonce length check (§3.2 rule 5, §4.1)
	if len(decoded.RawNonce) != NonceSize {
		return NewEnvelopeError(ErrCodeInvalidNonceLength, fmt.Sprintf("decoded nonce length is %d bytes, expected exactly %d", len(decoded.RawNonce), NonceSize))
	}

	// 7. Ciphertext length check (§2.1, AES-GCM tag is 16 bytes)
	if len(decoded.RawCiphertext) < TagSize {
		return NewEnvelopeError(ErrCodeSerializationError, fmt.Sprintf("ciphertext length %d bytes is less than minimum 16-byte authentication tag", len(decoded.RawCiphertext)))
	}

	// 8. Encapsulation length check per algorithm (§5.1, §5.2)
	switch env.Alg {
	case AlgX25519:
		if len(decoded.RawEnc) != X25519EncSize {
			return NewEnvelopeError(ErrCodeInvalidKeyLength, fmt.Sprintf("enc length %d != %d for %s", len(decoded.RawEnc), X25519EncSize, AlgX25519))
		}
	case AlgXWing:
		if len(decoded.RawEnc) != XWingEncSize {
			return NewEnvelopeError(ErrCodeInvalidKeyLength, fmt.Sprintf("enc length %d != %d for %s", len(decoded.RawEnc), XWingEncSize, AlgXWing))
		}
	}

	// 9. Signature check (§7)
	// In V1, sig is null. Non-null sig is tolerated for forward compatibility, but must be valid base64.
	// Log a warning when a non-null sig is encountered.
	if env.Sig != nil {
		msg := fmt.Sprintf("V1 envelope contains non-null sig (len=%d); signature ignored per V1 forward-compatibility policy", len(*env.Sig))
		if WarnLogger != nil {
			WarnLogger("%s", msg)
		} else {
			log.Printf("[WARN] %s", msg)
		}
	}

	return nil
}

// writeJSONString writes an RFC 8259 compliant JSON string without HTML escaping.
func writeJSONString(buf *bytes.Buffer, s string) {
	buf.WriteByte('"')
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch c {
		case '"':
			buf.WriteString(`\"`)
		case '\\':
			buf.WriteString(`\\`)
		case '\b':
			buf.WriteString(`\b`)
		case '\f':
			buf.WriteString(`\f`)
		case '\n':
			buf.WriteString(`\n`)
		case '\r':
			buf.WriteString(`\r`)
		case '\t':
			buf.WriteString(`\t`)
		default:
			if c < 0x20 {
				fmt.Fprintf(buf, `\u%04x`, c)
			} else {
				buf.WriteByte(c)
			}
		}
	}
	buf.WriteByte('"')
}

// MarshalCanonical serializes env into canonical JSON per BYOS-SPEC-CRYPTO-ENV-V1 §2.2
// using explicit byte-buffer construction to ensure strict field ordering independent
// of struct declaration order:
// "alg" -> "ciphertext" -> "enc" -> "key_epoch" -> "key_id" -> "nonce" -> "sig" -> "v"
func MarshalCanonical(env *CryptoEnvelope) ([]byte, error) {
	if env == nil {
		return nil, NewEnvelopeError(ErrCodeSerializationError, "envelope is nil")
	}

	var buf bytes.Buffer
	buf.WriteByte('{')

	// 1. alg
	buf.WriteString(`"alg":`)
	writeJSONString(&buf, env.Alg)
	buf.WriteByte(',')

	// 2. ciphertext
	buf.WriteString(`"ciphertext":`)
	writeJSONString(&buf, env.Ciphertext)
	buf.WriteByte(',')

	// 3. enc
	buf.WriteString(`"enc":`)
	writeJSONString(&buf, env.Enc)
	buf.WriteByte(',')

	// 4. key_epoch
	buf.WriteString(`"key_epoch":`)
	buf.WriteString(strconv.FormatUint(uint64(env.KeyEpoch), 10))
	buf.WriteByte(',')

	// 5. key_id
	buf.WriteString(`"key_id":`)
	writeJSONString(&buf, env.KeyID)
	buf.WriteByte(',')

	// 6. nonce
	buf.WriteString(`"nonce":`)
	writeJSONString(&buf, env.Nonce)
	buf.WriteByte(',')

	// 7. sig
	buf.WriteString(`"sig":`)
	if env.Sig == nil {
		buf.WriteString("null")
	} else {
		writeJSONString(&buf, *env.Sig)
	}
	buf.WriteByte(',')

	// 8. v
	buf.WriteString(`"v":`)
	buf.WriteString(strconv.FormatUint(uint64(env.V), 10))

	buf.WriteByte('}')
	return buf.Bytes(), nil
}

// Unmarshal parses JSON data into a CryptoEnvelope without validation.
func Unmarshal(data []byte) (*CryptoEnvelope, error) {
	if len(data) == 0 {
		return nil, NewEnvelopeError(ErrCodeSerializationError, "empty envelope data")
	}

	var env CryptoEnvelope
	dec := json.NewDecoder(bytes.NewReader(data))
	if err := dec.Decode(&env); err != nil {
		return nil, NewEnvelopeError(ErrCodeSerializationError, fmt.Sprintf("json decode failed: %v", err))
	}
	return &env, nil
}

// UnmarshalCanonical parses JSON data into a CryptoEnvelope and runs full validation.
func UnmarshalCanonical(data []byte) (*CryptoEnvelope, error) {
	env, err := Unmarshal(data)
	if err != nil {
		return nil, err
	}
	if err := Validate(env); err != nil {
		return nil, err
	}
	return env, nil
}

// BuildAAD constructs the deterministic packed binary Additional Authenticated Data (AAD)
// buffer for env according to BYOS-SPEC-CRYPTO-ENV-V1 §3.1.
//
// Binary layout:
//
//	Offset 0:             v             (1 byte, uint8 = 0x01)
//	Offset 1:             alg_length    (1 byte, uint8 = length of alg)
//	Offset 2..2+n:        alg           (n bytes, UTF-8 string)
//	Offset pos:           key_id_length (1 byte, uint8 = length of key_id)
//	Offset pos..pos+m:    key_id        (m bytes, UTF-8 string)
//	Offset pos:           key_epoch     (4 bytes, uint32 Big-Endian)
//	Offset pos:           enc_length    (4 bytes, uint32 Big-Endian, raw binary length)
//	Offset pos..pos+k:    enc           (k bytes, raw decoded KEM encapsulation)
//	Offset pos:           nonce_length  (1 byte, uint8 = 12, 0x0C)
//	Offset pos..pos+12:   nonce         (12 bytes, raw nonce)
func BuildAAD(env *CryptoEnvelope) ([]byte, error) {
	if env == nil {
		return nil, NewEnvelopeError(ErrCodeAADMismatch, "envelope is nil")
	}
	if env.V != CurrentVersion {
		return nil, NewEnvelopeError(ErrCodeUnsupportedVersion, fmt.Sprintf("unsupported version %d", env.V))
	}
	if len(env.Alg) == 0 || len(env.Alg) > 255 {
		return nil, NewEnvelopeError(ErrCodeAADMismatch, "alg length must be between 1 and 255")
	}
	if len(env.KeyID) == 0 || len(env.KeyID) > 255 {
		return nil, NewEnvelopeError(ErrCodeAADMismatch, "key_id length must be between 1 and 255")
	}

	b64 := base64.StdEncoding.Strict()

	rawEnc, err := b64.DecodeString(env.Enc)
	if err != nil {
		return nil, NewEnvelopeError(ErrCodeInvalidBase64, fmt.Sprintf("invalid enc base64: %v", err))
	}

	rawNonce, err := b64.DecodeString(env.Nonce)
	if err != nil {
		return nil, NewEnvelopeError(ErrCodeInvalidBase64, fmt.Sprintf("invalid nonce base64: %v", err))
	}
	if len(rawNonce) != NonceSize {
		return nil, NewEnvelopeError(ErrCodeInvalidNonceLength, fmt.Sprintf("nonce length %d != 12", len(rawNonce)))
	}

	return BuildAADRaw(env.V, env.Alg, env.KeyID, env.KeyEpoch, rawEnc, rawNonce)
}

// BuildAADRaw constructs the deterministic binary AAD from already decoded raw components.
func BuildAADRaw(v uint8, alg, keyID string, keyEpoch uint32, rawEnc, rawNonce []byte) ([]byte, error) {
	if len(alg) == 0 || len(alg) > 255 {
		return nil, NewEnvelopeError(ErrCodeAADMismatch, "alg length must be between 1 and 255")
	}
	if len(keyID) == 0 || len(keyID) > 255 {
		return nil, NewEnvelopeError(ErrCodeAADMismatch, "key_id length must be between 1 and 255")
	}
	if len(rawNonce) != NonceSize {
		return nil, NewEnvelopeError(ErrCodeInvalidNonceLength, fmt.Sprintf("nonce length %d != 12", len(rawNonce)))
	}

	totalLen := 1 + 1 + len(alg) + 1 + len(keyID) + 4 + 4 + len(rawEnc) + 1 + len(rawNonce)
	buf := make([]byte, totalLen)
	pos := 0

	// 0: v
	buf[pos] = v
	pos++

	// 1: alg_length
	buf[pos] = uint8(len(alg))
	pos++

	// 2 .. 2+n: alg
	copy(buf[pos:], alg)
	pos += len(alg)

	// pos: key_id_length
	buf[pos] = uint8(len(keyID))
	pos++

	// pos .. pos+m: key_id
	copy(buf[pos:], keyID)
	pos += len(keyID)

	// pos: key_epoch (Big-Endian uint32)
	binary.BigEndian.PutUint32(buf[pos:], keyEpoch)
	pos += 4

	// pos: enc_length (Big-Endian uint32 raw bytes)
	binary.BigEndian.PutUint32(buf[pos:], uint32(len(rawEnc)))
	pos += 4

	// pos .. pos+k: enc (raw bytes)
	copy(buf[pos:], rawEnc)
	pos += len(rawEnc)

	// pos: nonce_length (uint8 = 12)
	buf[pos] = uint8(len(rawNonce))
	pos++

	// pos .. pos+12: nonce
	copy(buf[pos:], rawNonce)
	pos += len(rawNonce)

	return buf, nil
}
