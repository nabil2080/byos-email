// Package core implements the X-Wing hybrid KEM combiner and key expansion
// as specified in draft-connolly-cfrg-xwing-kem and BYOS-SPEC-CRYPTO-ENV-V1.
package core

import (
	"bytes"
	"crypto/ecdh"
	"crypto/mlkem"
	"crypto/rand"
	"crypto/sha3"
	"errors"
	"fmt"
)

const (
	// DecapsulationKeySize is the 32-byte seed representation of an X-Wing private key.
	DecapsulationKeySize = 32
	// EncapsulationKeySize is the total size of pk_M (1184) + pk_X (32) = 1216 bytes.
	EncapsulationKeySize = 1216
	// CiphertextSize is the total size of ct_M (1088) + ct_X (32) = 1120 bytes.
	CiphertextSize = 1120
	// SharedSecretSize is the 32-byte combined shared secret.
	SharedSecretSize = 32

	// MLKEM768EncapsulationKeySize is 1184 bytes per FIPS 203.
	MLKEM768EncapsulationKeySize = 1184
	// MLKEM768CiphertextSize is 1088 bytes per FIPS 203.
	MLKEM768CiphertextSize = 1088
	// X25519PointSize is 32 bytes per RFC 7748.
	X25519PointSize = 32
)

// XWingLabel is the 6-byte domain separation string \./^\ as defined in
// draft-connolly-cfrg-xwing-kem §5.3. Hex: 5c2e2f2f5e5c.
var XWingLabel = []byte{0x5c, 0x2e, 0x2f, 0x2f, 0x5e, 0x5c}

var (
	ErrInvalidSharedSecretLength = errors.New("core: shared secret component must be 32 bytes")
	ErrInvalidCiphertextLength   = errors.New("core: ciphertext must be 1120 bytes")
	ErrInvalidPublicKeyLength    = errors.New("core: public key must be 1216 bytes")
	ErrInvalidPrivateKeyLength   = errors.New("core: private key seed must be 32 bytes")
)

// Combiner implements the verbatim X-Wing combiner from draft-connolly-cfrg-xwing-kem §5.3:
//
//	def Combiner(ss_M, ss_X, ct_X, pk_X):
//	  return SHA3-256(concat(ss_M, ss_X, ct_X, pk_X, XWingLabel))
//
// Total input length is 32 + 32 + 32 + 32 + 6 = 134 bytes.
// Output is a 32-byte combined shared secret.
func Combiner(ssM, ssX, ctX, pkX []byte) ([]byte, error) {
	if len(ssM) != SharedSecretSize {
		return nil, fmt.Errorf("%w: ss_M length %d != 32", ErrInvalidSharedSecretLength, len(ssM))
	}
	if len(ssX) != SharedSecretSize {
		return nil, fmt.Errorf("%w: ss_X length %d != 32", ErrInvalidSharedSecretLength, len(ssX))
	}
	if len(ctX) != X25519PointSize {
		return nil, fmt.Errorf("%w: ct_X length %d != 32", ErrInvalidSharedSecretLength, len(ctX))
	}
	if len(pkX) != X25519PointSize {
		return nil, fmt.Errorf("%w: pk_X length %d != 32", ErrInvalidSharedSecretLength, len(pkX))
	}

	buf := make([]byte, 0, 134)
	buf = append(buf, ssM...)
	buf = append(buf, ssX...)
	buf = append(buf, ctX...)
	buf = append(buf, pkX...)
	buf = append(buf, XWingLabel...)

	digest := sha3.Sum256(buf)
	return digest[:], nil
}

// ExpandedKey contains the expanded internal keys for ML-KEM-768 and X25519.
type ExpandedKey struct {
	DKM *mlkem.DecapsulationKey768
	SKX *ecdh.PrivateKey
	PKM []byte // 1184 bytes
	PKX []byte // 32 bytes
	PK  []byte // 1216 bytes: PKM || PKX
}

// ExpandDecapsulationKey expands a 32-byte decapsulation key seed into ML-KEM-768
// and X25519 keypairs per draft-connolly-cfrg-xwing-kem §5.2:
//
//	expanded = SHAKE256(sk, 96*8)
//	(pk_M, sk_M) = ML-KEM-768.KeyGen_internal(expanded[0:32], expanded[32:64])
//	sk_X = expanded[64:96]
//	pk_X = X25519(sk_X, X25519_BASE)
func ExpandDecapsulationKey(skSeed []byte) (*ExpandedKey, error) {
	if len(skSeed) != DecapsulationKeySize {
		return nil, fmt.Errorf("%w: got %d bytes, expected 32", ErrInvalidPrivateKeyLength, len(skSeed))
	}

	expanded := sha3.SumSHAKE256(skSeed, 96)

	// expanded[0:64] is (d || z) for ML-KEM-768
	dkM, err := mlkem.NewDecapsulationKey768(expanded[0:64])
	if err != nil {
		return nil, fmt.Errorf("core: mlkem.NewDecapsulationKey768 failed: %w", err)
	}

	// expanded[64:96] is X25519 private scalar
	curve := ecdh.X25519()
	skX, err := curve.NewPrivateKey(expanded[64:96])
	if err != nil {
		return nil, fmt.Errorf("core: ecdh.NewPrivateKey failed: %w", err)
	}

	pkM := dkM.EncapsulationKey().Bytes()
	pkX := skX.PublicKey().Bytes()

	pk := make([]byte, EncapsulationKeySize)
	copy(pk[0:MLKEM768EncapsulationKeySize], pkM)
	copy(pk[MLKEM768EncapsulationKeySize:EncapsulationKeySize], pkX)

	return &ExpandedKey{
		DKM: dkM,
		SKX: skX,
		PKM: pkM,
		PKX: pkX,
		PK:  pk,
	}, nil
}

// Decapsulate decapsulates an X-Wing ciphertext (enc: 1120 bytes) using the
// 32-byte recipient private seed skSeed per draft-connolly-cfrg-xwing-kem §5.5.
func Decapsulate(skSeed, enc []byte) ([]byte, error) {
	if len(enc) != CiphertextSize {
		return nil, fmt.Errorf("%w: got %d bytes, expected 1120", ErrInvalidCiphertextLength, len(enc))
	}

	expanded, err := ExpandDecapsulationKey(skSeed)
	if err != nil {
		return nil, err
	}

	ctM := enc[0:MLKEM768CiphertextSize]
	ctX := enc[MLKEM768CiphertextSize:CiphertextSize]

	// ML-KEM-768 Decapsulate
	ssM, err := expanded.DKM.Decapsulate(ctM)
	if err != nil {
		return nil, fmt.Errorf("core: ML-KEM-768 decapsulation failed: %w", err)
	}

	// X25519 ECDH
	pubX, err := ecdh.X25519().NewPublicKey(ctX)
	if err != nil {
		return nil, fmt.Errorf("core: invalid X25519 ephemeral public key: %w", err)
	}
	ssX, err := expanded.SKX.ECDH(pubX)
	if err != nil {
		return nil, fmt.Errorf("core: X25519 ECDH failed: %w", err)
	}

	// Combiner
	return Combiner(ssM, ssX, ctX, expanded.PKX)
}

// Encapsulate encapsulates a fresh shared secret for the 1216-byte X-Wing public key pk.
func Encapsulate(pk []byte) (enc []byte, ssCombined []byte, err error) {
	if len(pk) != EncapsulationKeySize {
		return nil, nil, fmt.Errorf("%w: got %d bytes, expected 1216", ErrInvalidPublicKeyLength, len(pk))
	}

	pkM := pk[0:MLKEM768EncapsulationKeySize]
	pkX := pk[MLKEM768EncapsulationKeySize:EncapsulationKeySize]

	// ML-KEM-768 Encapsulate
	ekM, err := mlkem.NewEncapsulationKey768(pkM)
	if err != nil {
		return nil, nil, fmt.Errorf("core: invalid ML-KEM-768 encapsulation key: %w", err)
	}
	ssM, ctM := ekM.Encapsulate()

	// X25519 ephemeral key generation
	ekX, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		return nil, nil, fmt.Errorf("core: generating ephemeral X25519 key failed: %w", err)
	}
	ctX := ekX.PublicKey().Bytes()

	// X25519 shared secret
	pubX, err := ecdh.X25519().NewPublicKey(pkX)
	if err != nil {
		return nil, nil, fmt.Errorf("core: invalid recipient X25519 public key: %w", err)
	}
	ssX, err := ekX.ECDH(pubX)
	if err != nil {
		return nil, nil, fmt.Errorf("core: X25519 ECDH failed: %w", err)
	}

	// Combiner
	ssCombined, err = Combiner(ssM, ssX, ctX, pkX)
	if err != nil {
		return nil, nil, err
	}

	enc = make([]byte, CiphertextSize)
	copy(enc[0:MLKEM768CiphertextSize], ctM)
	copy(enc[MLKEM768CiphertextSize:CiphertextSize], ctX)

	return enc, ssCombined, nil
}

// GenerateKeyPair generates a fresh random X-Wing keypair.
func GenerateKeyPair() (skSeed []byte, pk []byte, err error) {
	skSeed = make([]byte, DecapsulationKeySize)
	if _, err := rand.Read(skSeed); err != nil {
		return nil, nil, fmt.Errorf("core: generating seed failed: %w", err)
	}
	expanded, err := ExpandDecapsulationKey(skSeed)
	if err != nil {
		return nil, nil, err
	}
	return skSeed, expanded.PK, nil
}

// CompareConstantTime compares two byte slices in constant time.
func CompareConstantTime(a, b []byte) bool {
	return bytes.Equal(a, b)
}
