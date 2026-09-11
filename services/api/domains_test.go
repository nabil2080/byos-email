package main

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/x509"
	"encoding/pem"
	"os"
	"strings"
	"testing"
)

func TestGenerateDKIMKeypair(t *testing.T) {
	dek := []byte("01234567890123456789012345678901") // 32 bytes
	privPEM, encPrivKey, pubKeyStr, err := generateDKIMKeypair("byos", dek)
	if err != nil {
		t.Fatalf("generateDKIMKeypair failed: %v", err)
	}

	// 1. Verify PEM structure
	block, _ := pem.Decode([]byte(privPEM))
	if block == nil || block.Type != "PRIVATE KEY" {
		t.Fatalf("expected PRIVATE KEY PEM block, got %v", block)
	}
	privKey, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		t.Fatalf("failed to parse PKCS8 private key: %v", err)
	}
	if privKey == nil {
		t.Fatal("parsed private key is nil")
	}

	// 2. Verify Public Key string format
	if !strings.HasPrefix(pubKeyStr, "v=DKIM1; k=rsa; p=") {
		t.Fatalf("unexpected dkim pubkey format: %s", pubKeyStr)
	}

	// 3. Verify AES-GCM envelope format (version 0x01 || 12-byte nonce || ciphertext+tag)
	if len(encPrivKey) < 1+12+16 {
		t.Fatalf("encrypted private key too short: %d bytes", len(encPrivKey))
	}
	if encPrivKey[0] != 0x01 {
		t.Fatalf("expected envelope version 0x01, got 0x%02x", encPrivKey[0])
	}
	nonce := encPrivKey[1:13]
	ciphertextAndTag := encPrivKey[13:]

	// 4. Decrypt and verify round-trip matches original privPEM
	aesBlock, err := aes.NewCipher(dek)
	if err != nil {
		t.Fatalf("new cipher: %v", err)
	}
	gcm, err := cipher.NewGCM(aesBlock)
	if err != nil {
		t.Fatalf("new gcm: %v", err)
	}
	decrypted, err := gcm.Open(nil, nonce, ciphertextAndTag, []byte("dkim-private-key-v1"))
	if err != nil {
		t.Fatalf("failed to decrypt dkim envelope: %v", err)
	}
	if string(decrypted) != privPEM {
		t.Fatalf("decrypted PEM did not match original generated PEM")
	}
}

func TestGenerateVerificationToken(t *testing.T) {
	tok1, err := generateVerificationToken()
	if err != nil {
		t.Fatalf("failed to generate verification token: %v", err)
	}
	tok2, err := generateVerificationToken()
	if err != nil {
		t.Fatalf("failed to generate second token: %v", err)
	}

	if !strings.HasPrefix(tok1, "byos-verification=") {
		t.Fatalf("expected token prefix 'byos-verification=', got %s", tok1)
	}
	if tok1 == tok2 {
		t.Fatalf("expected unique tokens, got identical: %s", tok1)
	}
	// byos-verification= (18 chars) + 32 hex chars = 50 chars
	if len(tok1) != 50 {
		t.Fatalf("expected 50 chars, got %d", len(tok1))
	}
}

func TestBuildExpectedDNSRecords(t *testing.T) {
	domain := "example.com"
	selector := "byos"
	pubKey := "v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA..."
	token := "byos-verification=abcdef0123456789"

	records := buildExpectedDNSRecords(domain, selector, pubKey, token)
	if len(records) != 5 {
		t.Fatalf("expected 5 DNS records, got %d", len(records))
	}

	foundVerification := false
	foundDKIM := false
	foundMX := false
	foundSPF := false
	foundDMARC := false

	for _, r := range records {
		switch r.Type {
		case "TXT":
			if r.Name == "_byos.example.com" && r.Value == token {
				foundVerification = true
			}
			if r.Name == "byos._domainkey.example.com" && r.Value == pubKey {
				foundDKIM = true
			}
			if r.Name == "example.com" && strings.HasPrefix(r.Value, "v=spf1") {
				foundSPF = true
			}
			if r.Name == "_dmarc.example.com" && strings.HasPrefix(r.Value, "v=DMARC1") {
				foundDMARC = true
			}
		case "MX":
			if r.Name == "example.com" && r.Priority != nil && *r.Priority == 10 {
				foundMX = true
			}
		}
	}

	if !foundVerification {
		t.Error("missing verification TXT record")
	}
	if !foundDKIM {
		t.Error("missing DKIM TXT record")
	}
	if !foundMX {
		t.Error("missing MX record")
	}
	if !foundSPF {
		t.Error("missing SPF TXT record")
	}
	if !foundDMARC {
		t.Error("missing DMARC TXT record")
	}
}

func TestVerifyDomainDNSBypass(t *testing.T) {
	ctx := context.Background()

	// .local bypass
	if !verifyDomainDNS(ctx, "company.local", "token123") {
		t.Error("expected company.local to bypass DNS verification")
	}

	// .test bypass
	if !verifyDomainDNS(ctx, "sub.test", "token123") {
		t.Error("expected sub.test to bypass DNS verification")
	}

	// localhost bypass
	if !verifyDomainDNS(ctx, "localhost", "token123") {
		t.Error("expected localhost to bypass DNS verification")
	}

	// BYOS_SKIP_DNS_VERIFY=true bypass
	os.Setenv("BYOS_SKIP_DNS_VERIFY", "true")
	defer os.Unsetenv("BYOS_SKIP_DNS_VERIFY")
	if !verifyDomainDNS(ctx, "realdomain.com", "token123") {
		t.Error("expected BYOS_SKIP_DNS_VERIFY=true to bypass DNS verification")
	}
}
