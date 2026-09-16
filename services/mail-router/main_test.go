package main

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func TestNormalizeAddress(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"ALICE@EXAMPLE.COM", "alice@example.com"},
		{"  bob@example.com  ", "bob@example.com"},
		{"<carol@example.com>", "carol@example.com"},
		{"Dave Smith <dave@example.com>", "dave@example.com"},
		{"\"Eve User\" <eve@example.com>", "eve@example.com"},
	}

	for _, tc := range tests {
		got := normalizeAddress(tc.input)
		if got != tc.expected {
			t.Errorf("normalizeAddress(%q) = %q, want %q", tc.input, got, tc.expected)
		}
	}
}

func TestSplitAddress(t *testing.T) {
	tests := []struct {
		input       string
		wantDomain  string
		wantLocal   string
		expectError bool
	}{
		{"alice@example.com", "example.com", "alice", false},
		{"Bob.Jones@sub.domain.org", "sub.domain.org", "bob.jones", false},
		{"<carol@example.com>", "example.com", "carol", false},
		{"invalid-address", "", "", true},
		{"@example.com", "", "", true},
		{"user@", "", "", true},
		{"", "", "", true},
	}

	for _, tc := range tests {
		domain, local, err := splitAddress(tc.input)
		if tc.expectError {
			if err == nil {
				t.Errorf("splitAddress(%q) expected error, got nil", tc.input)
			}
		} else {
			if err != nil {
				t.Errorf("splitAddress(%q) unexpected error: %v", tc.input, err)
			}
			if domain != tc.wantDomain || local != tc.wantLocal {
				t.Errorf("splitAddress(%q) = (%q, %q), want (%q, %q)", tc.input, domain, local, tc.wantDomain, tc.wantLocal)
			}
		}
	}
}

func TestNormalizeMessageID(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"<MSG-1234@EXAMPLE.COM>", "msg-1234@example.com"},
		{"  <abc@xyz>  ", "abc@xyz"},
		{"SIMPLE-ID@DOMAIN", "simple-id@domain"},
		{"", ""},
	}

	for _, tc := range tests {
		got := normalizeMessageID(tc.input)
		if got != tc.expected {
			t.Errorf("normalizeMessageID(%q) = %q, want %q", tc.input, got, tc.expected)
		}
	}
}

func TestDeliveryIdentityDeterminism(t *testing.T) {
	rawMsg := []byte("From: alice@example.com\r\nTo: bob@example.com\r\nSubject: Test\r\nMessage-ID: <msg123@example.com>\r\n\r\nHello")
	recipients1 := []string{"bob@example.com", "carol@example.com"}
	recipients2 := []string{"carol@example.com", "bob@example.com"}

	id1 := deliveryIdentity("alice@example.com", recipients1, rawMsg)
	id2 := deliveryIdentity("ALICE@EXAMPLE.COM", recipients2, rawMsg)

	if id1 != id2 {
		t.Errorf("deliveryIdentity should be deterministic regardless of recipient ordering and sender casing: %x != %x", id1, id2)
	}

	diffMsg := []byte("From: alice@example.com\r\nTo: bob@example.com\r\nSubject: Different\r\nMessage-ID: <msg456@example.com>\r\n\r\nHello")
	id3 := deliveryIdentity("alice@example.com", recipients1, diffMsg)
	if id1 == id3 {
		t.Errorf("distinct messages should have distinct delivery identities")
	}
}

func TestEnvOrDefault(t *testing.T) {
	key := "TEST_ENV_VAR_EXISTS"
	os.Setenv(key, "my_custom_value")
	defer os.Unsetenv(key)

	if got := envOrDefault(key, "default_val"); got != "my_custom_value" {
		t.Errorf("expected %q, got %q", "my_custom_value", got)
	}

	if got := envOrDefault("NON_EXISTENT_VAR_XYZ", "fallback_val"); got != "fallback_val" {
		t.Errorf("expected %q, got %q", "fallback_val", got)
	}
}

func TestHealthHandler(t *testing.T) {
	app := &App{}
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	rec := httptest.NewRecorder()

	app.healthHandler(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 Service Unavailable for uninitialized pool, got %d", rec.Code)
	}
}

func TestInboundHandlerValidation(t *testing.T) {
	app := &App{}

	// 1. Non-POST method -> 405
	req := httptest.NewRequest(http.MethodGet, "/inbound", nil)
	rec := httptest.NewRecorder()
	app.inboundHandler(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 for GET on /inbound, got %d", rec.Code)
	}

	// 2. Unconfigured internal key -> 503
	os.Unsetenv("MAIL_ROUTER_INTERNAL_KEY")
	req = httptest.NewRequest(http.MethodPost, "/inbound", bytes.NewBufferString("{}"))
	rec = httptest.NewRecorder()
	app.inboundHandler(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 when internal key is unconfigured, got %d", rec.Code)
	}

	// Configure test internal key
	testKey := "test-internal-secret-key-123"
	os.Setenv("MAIL_ROUTER_INTERNAL_KEY", testKey)
	defer os.Unsetenv("MAIL_ROUTER_INTERNAL_KEY")

	// 3. Missing or wrong internal key -> 403
	req = httptest.NewRequest(http.MethodPost, "/inbound", bytes.NewBufferString("{}"))
	rec = httptest.NewRecorder()
	app.inboundHandler(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for missing internal key, got %d", rec.Code)
	}

	req = httptest.NewRequest(http.MethodPost, "/inbound", bytes.NewBufferString("{}"))
	req.Header.Set("X-Internal-Key", "wrong-key")
	rec = httptest.NewRecorder()
	app.inboundHandler(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for invalid internal key, got %d", rec.Code)
	}

	// 4. Malformed JSON with valid key -> 400
	req = httptest.NewRequest(http.MethodPost, "/inbound", bytes.NewBufferString("not valid json"))
	req.Header.Set("X-Internal-Key", testKey)
	rec = httptest.NewRecorder()
	app.inboundHandler(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for malformed json, got %d", rec.Code)
	}

	// 5. Invalid base64 in raw_message_b64 -> 400
	payload := `{"envelope_from":"alice@example.com","recipients":["bob@example.com"],"raw_message_b64":"!!!not base64!!!"}`
	req = httptest.NewRequest(http.MethodPost, "/inbound", bytes.NewBufferString(payload))
	req.Header.Set("X-Internal-Key", testKey)
	rec = httptest.NewRecorder()
	app.inboundHandler(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid base64, got %d", rec.Code)
	}
}
