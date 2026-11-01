package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func TestIsAllowedOrigin(t *testing.T) {
	oldEnv := os.Getenv("BYOS_ENV")
	defer func() {
		if oldEnv != "" {
			os.Setenv("BYOS_ENV", oldEnv)
		} else {
			os.Unsetenv("BYOS_ENV")
		}
	}()

	allowedList := "https://example.com,https://byos.local"

	cases := []struct {
		origin   string
		env      string
		expected bool
	}{
		{"https://example.com", "production", true},
		{"https://byos.local", "production", true},
		{"https://evil.com", "production", false},
		{"", "production", false},
		{"http://localhost:3000", "development", true},
		{"http://127.0.0.1:8080", "development", true},
		{"http://evil.com", "development", false},
		{"http://localhost:3000", "production", false},
	}

	for _, tc := range cases {
		os.Setenv("BYOS_ENV", tc.env)
		got := isAllowedOrigin(tc.origin, allowedList)
		if got != tc.expected {
			t.Errorf("isAllowedOrigin(%q, env=%s) = %v; want %v", tc.origin, tc.env, got, tc.expected)
		}
	}
}

func TestWithCORS_PreflightAndHeaders(t *testing.T) {
	oldEnv := os.Getenv("BYOS_ENV")
	oldAllowed := os.Getenv("BYOS_ALLOWED_ORIGINS")
	defer func() {
		if oldEnv != "" {
			os.Setenv("BYOS_ENV", oldEnv)
		} else {
			os.Unsetenv("BYOS_ENV")
		}
		if oldAllowed != "" {
			os.Setenv("BYOS_ALLOWED_ORIGINS", oldAllowed)
		} else {
			os.Unsetenv("BYOS_ALLOWED_ORIGINS")
		}
	}()

	os.Setenv("BYOS_ENV", "production")
	os.Setenv("BYOS_ALLOWED_ORIGINS", "https://app.byos.local")

	dummyHandler := func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	}

	// 1. Preflight OPTIONS from allowed origin
	req := httptest.NewRequest(http.MethodOptions, "/v1/test", nil)
	req.Header.Set("Origin", "https://app.byos.local")
	rec := httptest.NewRecorder()
	withCORS(dummyHandler)(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected preflight 204, got %d", rec.Code)
	}
	if rec.Header().Get("Access-Control-Allow-Origin") != "https://app.byos.local" {
		t.Fatalf("expected allow origin header set, got %q", rec.Header().Get("Access-Control-Allow-Origin"))
	}
	if rec.Header().Get("Access-Control-Allow-Credentials") != "true" {
		t.Fatalf("expected credentials true")
	}

	// 2. Preflight OPTIONS from untrusted origin
	reqBad := httptest.NewRequest(http.MethodOptions, "/v1/test", nil)
	reqBad.Header.Set("Origin", "https://attacker.evil")
	recBad := httptest.NewRecorder()
	withCORS(dummyHandler)(recBad, reqBad)

	if recBad.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("expected empty allow origin header for untrusted origin, got %q", recBad.Header().Get("Access-Control-Allow-Origin"))
	}
}

func TestWithCORS_CSRFProtection(t *testing.T) {
	oldEnv := os.Getenv("BYOS_ENV")
	oldAllowed := os.Getenv("BYOS_ALLOWED_ORIGINS")
	defer func() {
		if oldEnv != "" {
			os.Setenv("BYOS_ENV", oldEnv)
		} else {
			os.Unsetenv("BYOS_ENV")
		}
		if oldAllowed != "" {
			os.Setenv("BYOS_ALLOWED_ORIGINS", oldAllowed)
		} else {
			os.Unsetenv("BYOS_ALLOWED_ORIGINS")
		}
	}()

	os.Setenv("BYOS_ENV", "production")
	os.Setenv("BYOS_ALLOWED_ORIGINS", "https://controlplane.byos.local,https://webmail.byos.local")

	dummyHandler := func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"success":true}`))
	}

	tests := []struct {
		name         string
		method       string
		cookieName   string
		cookieValue  string
		authHeader   string
		origin       string
		referer      string
		expectedCode int
	}{
		{
			name:         "Cookie auth POST without Origin or Referer blocked",
			method:       http.MethodPost,
			cookieName:   "byos_cp_session",
			cookieValue:  "session-token-123",
			expectedCode: http.StatusForbidden,
		},
		{
			name:         "Cookie auth POST with untrusted Origin blocked",
			method:       http.MethodPost,
			cookieName:   "byos_webmail_session",
			cookieValue:  "session-token-123",
			origin:       "https://evil-phishing.com",
			expectedCode: http.StatusForbidden,
		},
		{
			name:         "Cookie auth POST with untrusted Referer blocked",
			method:       http.MethodPost,
			cookieName:   "byos_session",
			cookieValue:  "session-token-123",
			referer:      "https://evil-phishing.com/exploit.html",
			expectedCode: http.StatusForbidden,
		},
		{
			name:         "Cookie auth POST with allowed Origin allowed",
			method:       http.MethodPost,
			cookieName:   "byos_cp_session",
			cookieValue:  "session-token-123",
			origin:       "https://controlplane.byos.local",
			expectedCode: http.StatusOK,
		},
		{
			name:         "Cookie auth POST with allowed Referer allowed",
			method:       http.MethodPost,
			cookieName:   "byos_webmail_session",
			cookieValue:  "session-token-123",
			referer:      "https://webmail.byos.local/mail/inbox",
			expectedCode: http.StatusOK,
		},
		{
			name:         "Bearer auth POST without Origin allowed (not ambient cookie)",
			method:       http.MethodPost,
			authHeader:   "Bearer cli-token-123",
			expectedCode: http.StatusOK,
		},
		{
			name:         "Cookie auth GET without Origin allowed (safe method)",
			method:       http.MethodGet,
			cookieName:   "byos_cp_session",
			cookieValue:  "session-token-123",
			expectedCode: http.StatusOK,
		},
		{
			name:         "Cookie auth DELETE with allowed Origin allowed",
			method:       http.MethodDelete,
			cookieName:   "byos_cp_session",
			cookieValue:  "session-token-123",
			origin:       "https://controlplane.byos.local",
			expectedCode: http.StatusOK,
		},
		{
			name:         "Cookie auth PUT with untrusted Origin blocked",
			method:       http.MethodPut,
			cookieName:   "byos_cp_session",
			cookieValue:  "session-token-123",
			origin:       "https://evil.com",
			expectedCode: http.StatusForbidden,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, "/v1/test-state", nil)
			if tc.cookieName != "" {
				req.AddCookie(&http.Cookie{
					Name:  tc.cookieName,
					Value: tc.cookieValue,
				})
			}
			if tc.authHeader != "" {
				req.Header.Set("Authorization", tc.authHeader)
			}
			if tc.origin != "" {
				req.Header.Set("Origin", tc.origin)
			}
			if tc.referer != "" {
				req.Header.Set("Referer", tc.referer)
			}

			rec := httptest.NewRecorder()
			withCORS(dummyHandler)(rec, req)

			if rec.Code != tc.expectedCode {
				t.Errorf("got status %d, want %d (body: %s)", rec.Code, tc.expectedCode, rec.Body.String())
			}
		})
	}
}
