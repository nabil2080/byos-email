package main

import (
	"strings"
	"testing"
)

func TestValidateRecipients_ValidSingle(t *testing.T) {
	recs, err := validateRecipients("alice@byos.local")
	if err != nil {
		t.Fatalf("expected valid recipient, got err: %v", err)
	}
	if len(recs) != 1 || recs[0] != "alice@byos.local" {
		t.Fatalf("unexpected recipients: %v", recs)
	}
}

func TestValidateRecipients_ValidMultiple(t *testing.T) {
	recs, err := validateRecipients("alice@byos.local, bob@byos.local; charlie@byos.local")
	if err != nil {
		t.Fatalf("expected valid recipients, got err: %v", err)
	}
	if len(recs) != 3 {
		t.Fatalf("expected 3 recipients, got %d", len(recs))
	}
	if recs[0] != "alice@byos.local" || recs[1] != "bob@byos.local" || recs[2] != "charlie@byos.local" {
		t.Fatalf("unexpected parsed recipients: %v", recs)
	}
}

func TestValidateRecipients_HeaderInjectionRejected(t *testing.T) {
	injections := []string{
		"alice@byos.local\r\nBcc: evil@attacker.com",
		"alice@byos.local\nBcc: evil@attacker.com",
		"alice@byos.local\rSubject: Injected",
		"alice@byos.local\x00evil@attacker.com",
	}
	for _, inj := range injections {
		_, err := validateRecipients(inj)
		if err == nil {
			t.Fatalf("expected rejection for injection %q, but passed", inj)
		}
	}
}

func TestValidateRecipients_MaxCeilingEnforced(t *testing.T) {
	// Exactly 50 recipients should pass
	var validList []string
	for i := 1; i <= 50; i++ {
		validList = append(validList, "user"+strings.Repeat("a", i%5)+"@example.org")
	}
	recs, err := validateRecipients(strings.Join(validList, ","))
	if err != nil {
		t.Fatalf("expected 50 recipients to pass, got err: %v", err)
	}
	if len(recs) != 50 {
		t.Fatalf("expected 50 parsed recipients, got %d", len(recs))
	}

	// 51 recipients must fail (Section 8 ceiling)
	var tooMany []string
	for i := 1; i <= 51; i++ {
		tooMany = append(tooMany, "user"+strings.Repeat("b", i%5)+"@example.org")
	}
	_, err = validateRecipients(strings.Join(tooMany, ","))
	if err == nil {
		t.Fatal("expected 51 recipients to be rejected under Section 8 ceiling, but passed")
	}
	if !strings.Contains(err.Error(), "exceeds maximum limit") {
		t.Fatalf("unexpected error message: %v", err)
	}
}

func TestValidateRecipients_MalformedRejected(t *testing.T) {
	malformed := []string{
		"",
		"   ",
		"invalid-email",
		"user@",
		"@domain.com",
		"user@domain", // missing TLD dot
		"user@.com",
	}
	for _, m := range malformed {
		_, err := validateRecipients(m)
		if err == nil {
			t.Fatalf("expected malformed recipient %q to be rejected, but passed", m)
		}
	}
}
