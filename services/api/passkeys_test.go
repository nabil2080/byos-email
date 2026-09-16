package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGetRPID(t *testing.T) {
	tests := []struct {
		name     string
		host     string
		origin   string
		expected string
	}{
		{
			name:     "Localhost port 3000 via Host",
			host:     "localhost:3000",
			origin:   "",
			expected: "localhost",
		},
		{
			name:     "127.0.0.1 port 3001 via Host",
			host:     "127.0.0.1:3001",
			origin:   "",
			expected: "127.0.0.1",
		},
		{
			name:     "Origin header overrides backend Host port",
			host:     "127.0.0.1:8080",
			origin:   "http://localhost:3001",
			expected: "localhost",
		},
		{
			name:     "Origin header 127.0.0.1 preserved",
			host:     "localhost:8080",
			origin:   "http://127.0.0.1:3001",
			expected: "127.0.0.1",
		},
		{
			name:     "Production domain without port",
			host:     "mail.byos.email",
			origin:   "",
			expected: "mail.byos.email",
		},
		{
			name:     "Production domain from origin",
			host:     "api.byos.email",
			origin:   "https://app.byos.email",
			expected: "app.byos.email",
		},
		{
			name:     "Empty fallback to localhost",
			host:     "",
			origin:   "",
			expected: "localhost",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "/v1/auth/passkeys/register-options", nil)
			r.Host = tt.host
			if tt.origin != "" {
				r.Header.Set("Origin", tt.origin)
			}
			actual := getRPID(r)
			if actual != tt.expected {
				t.Errorf("getRPID() = %q, want %q", actual, tt.expected)
			}
		})
	}
}

func TestGenerateRandomBase64URL(t *testing.T) {
	b64, err := generateRandomBase64URL(32)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(b64) == 0 {
		t.Fatalf("expected non-empty base64url string")
	}
}
