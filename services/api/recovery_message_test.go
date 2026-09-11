package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"strings"
	"testing"
)

// Pure unit tests for the recovery challenge protocol (no database).
// The Ed25519 client/server interop (Rust dalek <-> Go stdlib) is covered
// by the Node cross-check in the change record; here we pin the server-side
// shape: canonical message construction and verifier strictness.

func TestRecoveryChallengeMessageCanonical(t *testing.T) {
	id := "123e4567-e89b-12d3-a456-426614174000"
	got := string(recoveryChallengeMessage(id))
	want := "byos-recovery-v1:challenge:" + id
	if got != want {
		t.Fatalf("canonical message = %q, want %q", got, want)
	}
	if !strings.HasPrefix(got, "byos-recovery-v1:challenge:") {
		t.Fatalf("missing domain-separation prefix: %q", got)
	}
}

func TestVerifyEd25519SignatureRoundTrip(t *testing.T) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	msg := recoveryChallengeMessage("123e4567-e89b-12d3-a456-426614174000")
	sig := ed25519.Sign(priv, msg)
	sigB64 := base64.StdEncoding.EncodeToString(sig)
	if !verifyEd25519Signature([]byte(pub), msg, sigB64) {
		t.Fatal("valid signature rejected")
	}
	// Tampered message must fail.
	if verifyEd25519Signature([]byte(pub), recoveryChallengeMessage("other"), sigB64) {
		t.Fatal("tampered message accepted")
	}
	// Flipped signature bit must fail.
	sig[0] ^= 0x01
	if verifyEd25519Signature([]byte(pub), msg, base64.StdEncoding.EncodeToString(sig)) {
		t.Fatal("tampered signature accepted")
	}
	// Wrong key must fail.
	pub2, _, _ := ed25519.GenerateKey(rand.Reader)
	if verifyEd25519Signature([]byte(pub2), msg, sigB64) {
		t.Fatal("wrong key accepted")
	}
	// Malformed inputs must fail, never panic.
	if verifyEd25519Signature([]byte("short"), msg, sigB64) {
		t.Fatal("short pk accepted")
	}
	if verifyEd25519Signature([]byte(pub), msg, "!!!not-base64!!!") {
		t.Fatal("bad base64 accepted")
	}
	if verifyEd25519Signature([]byte(pub), msg, base64.StdEncoding.EncodeToString([]byte{0x01})) {
		t.Fatal("short signature accepted")
	}
}
