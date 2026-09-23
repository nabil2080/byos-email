package envelope

import (
	"encoding/binary"
	"fmt"
)

// BuildEnvelopeAAD constructs the v1 envelope AAD per 
// docs/crypto/envelope-v1-spec.md Section 3.1.
//
// Byte layout:
//   [0]         v (1 byte)
//   [1]         alg_len (1 byte)
//   [2..2+n]    alg (UTF-8)
//   [pos]       key_id_len (1 byte)
//   [..+m]      key_id (UTF-8)
//   [pos]       key_epoch (4 bytes big-endian)
//   [pos]       enc_len (4 bytes big-endian)
//   [..+k]      enc (raw bytes)
//   [pos]       nonce_len (1 byte = 12)
//   [..+12]     nonce (12 raw bytes)
func BuildEnvelopeAAD(
	v uint8,
	alg string,
	keyID string,
	keyEpoch uint32,
	enc []byte,
	nonce [12]byte,
) ([]byte, error) {
	if len(alg) == 0 {
		return nil, NewEnvelopeError(ErrCodeAADMismatch, "alg length must be at least 1 byte")
	}
	if len(alg) > 255 {
		return nil, NewEnvelopeError(ErrCodeAADMismatch, fmt.Sprintf("alg length %d exceeds maximum of 255 bytes", len(alg)))
	}
	if len(keyID) == 0 {
		return nil, NewEnvelopeError(ErrCodeAADMismatch, "key_id length must be at least 1 byte")
	}
	if len(keyID) > 255 {
		return nil, NewEnvelopeError(ErrCodeAADMismatch, fmt.Sprintf("key_id length %d exceeds maximum of 255 bytes", len(keyID)))
	}

	totalLen := 1 + 1 + len(alg) + 1 + len(keyID) + 4 + 4 + len(enc) + 1 + len(nonce)
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
	binary.BigEndian.PutUint32(buf[pos:], uint32(len(enc)))
	pos += 4

	// pos .. pos+k: enc (raw bytes)
	copy(buf[pos:], enc)
	pos += len(enc)

	// pos: nonce_length (uint8 = 12)
	buf[pos] = uint8(len(nonce))
	pos++

	// pos .. pos+12: nonce
	copy(buf[pos:], nonce[:])
	pos += len(nonce)

	return buf, nil
}
