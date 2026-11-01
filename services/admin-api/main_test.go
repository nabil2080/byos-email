package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMockLoginEndpointDisabledInProduction(t *testing.T) {
	// Assert that when BYOS_DEV_MODE is unset, /admin/v1/auth/mock-login returns 404
	t.Setenv("BYOS_DEV_MODE", "")

	req := httptest.NewRequest(http.MethodGet, "/admin/v1/auth/mock-login", nil)
	rec := httptest.NewRecorder()

	mockLoginHandler(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 Not Found when BYOS_DEV_MODE unset, got %d", rec.Code)
	}
}

func TestMockWebAuthnMiddlewareBlocksInProduction(t *testing.T) {
	// Assert that when BYOS_DEV_MODE is unset, middleware blocks requests with 401 even with valid mock token
	t.Setenv("BYOS_DEV_MODE", "")

	called := false
	dummyHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	})

	wrapped := mockWebAuthnMiddleware(dummyHandler)

	req := httptest.NewRequest(http.MethodGet, "/admin/v1/tickets", nil)
	req.Header.Set("Authorization", "Bearer mock-support-agent")
	rec := httptest.NewRecorder()

	wrapped(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized when BYOS_DEV_MODE unset, got %d", rec.Code)
	}
	if called {
		t.Fatalf("handler must not be invoked when BYOS_DEV_MODE unset")
	}
	if rec.Body.String() != "Unauthorized: mock WebAuthn disabled in production\n" {
		t.Fatalf("expected error message in body, got: %s", rec.Body.String())
	}
}

func TestMockLoginEndpointEnabledInDevMode(t *testing.T) {
	// Assert that when BYOS_DEV_MODE is "1", /admin/v1/auth/mock-login returns 200 and token
	t.Setenv("BYOS_DEV_MODE", "1")

	req := httptest.NewRequest(http.MethodGet, "/admin/v1/auth/mock-login", nil)
	rec := httptest.NewRecorder()

	mockLoginHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK when BYOS_DEV_MODE=1, got %d", rec.Code)
	}

	var resp map[string]string
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode json response: %v", err)
	}
	if resp["token"] != "mock-support-agent" {
		t.Fatalf("expected token 'mock-support-agent', got '%s'", resp["token"])
	}
}

func TestMockWebAuthnMiddlewareInDevMode(t *testing.T) {
	t.Setenv("BYOS_DEV_MODE", "1")

	dummyHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	wrapped := mockWebAuthnMiddleware(dummyHandler)

	// Without token -> 401
	reqNoToken := httptest.NewRequest(http.MethodGet, "/admin/v1/tickets", nil)
	recNoToken := httptest.NewRecorder()
	wrapped(recNoToken, reqNoToken)
	if recNoToken.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 without token, got %d", recNoToken.Code)
	}

	// With wrong token -> 401
	reqBadToken := httptest.NewRequest(http.MethodGet, "/admin/v1/tickets", nil)
	reqBadToken.Header.Set("Authorization", "Bearer invalid-token")
	recBadToken := httptest.NewRecorder()
	wrapped(recBadToken, reqBadToken)
	if recBadToken.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 with bad token, got %d", recBadToken.Code)
	}

	// With valid mock token -> 200
	reqGoodToken := httptest.NewRequest(http.MethodGet, "/admin/v1/tickets", nil)
	reqGoodToken.Header.Set("Authorization", "Bearer mock-support-agent")
	recGoodToken := httptest.NewRecorder()
	wrapped(recGoodToken, reqGoodToken)
	if recGoodToken.Code != http.StatusOK {
		t.Fatalf("expected 200 with valid mock token, got %d", recGoodToken.Code)
	}
}

func TestSecurityHeaders(t *testing.T) {
	dummyHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	wrapped := withSecurityHeaders(dummyHandler)

	req := httptest.NewRequest(http.MethodGet, "/admin/v1/tickets", nil)
	rec := httptest.NewRecorder()
	wrapped(rec, req)

	if rec.Header().Get("X-Frame-Options") != "DENY" {
		t.Errorf("expected X-Frame-Options: DENY, got: %s", rec.Header().Get("X-Frame-Options"))
	}
	if rec.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Errorf("expected X-Content-Type-Options: nosniff, got: %s", rec.Header().Get("X-Content-Type-Options"))
	}
	if rec.Header().Get("Referrer-Policy") != "strict-origin-when-cross-origin" {
		t.Errorf("expected Referrer-Policy: strict-origin-when-cross-origin, got: %s", rec.Header().Get("Referrer-Policy"))
	}
	if rec.Header().Get("Content-Security-Policy") == "" {
		t.Errorf("expected Content-Security-Policy header to be present")
	}
	if rec.Header().Get("Strict-Transport-Security") != "max-age=63072000; includeSubDomains; preload" {
		t.Errorf("expected Strict-Transport-Security header, got: %s", rec.Header().Get("Strict-Transport-Security"))
	}
}

func TestAdminAllowedOrigins(t *testing.T) {
	dummyHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	wrapped := agentAuthMiddleware(dummyHandler)

	// Subtest 1: Dev mode local origin matching
	t.Run("DevModeLocalOrigins", func(t *testing.T) {
		t.Setenv("BYOS_DEV_MODE", "1")
		t.Setenv("ADMIN_ALLOWED_ORIGINS", "")

		req := httptest.NewRequest(http.MethodOptions, "/admin/v1/tickets", nil)
		req.Header.Set("Origin", "http://127.0.0.1:3003")
		rec := httptest.NewRecorder()
		wrapped(rec, req)

		if rec.Header().Get("Access-Control-Allow-Origin") != "http://127.0.0.1:3003" {
			t.Errorf("expected Access-Control-Allow-Origin for local dev port, got: %s", rec.Header().Get("Access-Control-Allow-Origin"))
		}
		if rec.Header().Get("Vary") != "Origin" {
			t.Errorf("expected Vary: Origin header, got: %s", rec.Header().Get("Vary"))
		}
	})

	// Subtest 2: Dev mode unauthorized origin rejection
	t.Run("DevModeUnauthorizedOrigin", func(t *testing.T) {
		t.Setenv("BYOS_DEV_MODE", "1")
		t.Setenv("ADMIN_ALLOWED_ORIGINS", "")

		req := httptest.NewRequest(http.MethodOptions, "/admin/v1/tickets", nil)
		req.Header.Set("Origin", "https://malicious-site.example.com")
		rec := httptest.NewRecorder()
		wrapped(rec, req)

		if rec.Header().Get("Access-Control-Allow-Origin") != "" {
			t.Errorf("expected Access-Control-Allow-Origin to NOT be set for unauthorized origin, got: %s", rec.Header().Get("Access-Control-Allow-Origin"))
		}
		if rec.Header().Get("Vary") != "Origin" {
			t.Errorf("expected Vary: Origin header, got: %s", rec.Header().Get("Vary"))
		}
	})

	// Subtest 3: Configurable ADMIN_ALLOWED_ORIGINS in production
	t.Run("ConfiguredAllowedOrigins", func(t *testing.T) {
		t.Setenv("BYOS_DEV_MODE", "")
		t.Setenv("BYOS_ENV", "production")
		t.Setenv("ADMIN_ALLOWED_ORIGINS", "https://support.byos.email, https://admin.byos.email")

		// Allowed origin
		req := httptest.NewRequest(http.MethodOptions, "/admin/v1/tickets", nil)
		req.Header.Set("Origin", "https://support.byos.email")
		rec := httptest.NewRecorder()
		wrapped(rec, req)

		if rec.Header().Get("Access-Control-Allow-Origin") != "https://support.byos.email" {
			t.Errorf("expected Access-Control-Allow-Origin to match configured origin, got: %s", rec.Header().Get("Access-Control-Allow-Origin"))
		}

		// Disallowed origin (even local dev ports disallowed when ADMIN_ALLOWED_ORIGINS configured in prod)
		reqLocal := httptest.NewRequest(http.MethodOptions, "/admin/v1/tickets", nil)
		reqLocal.Header.Set("Origin", "http://127.0.0.1:3003")
		recLocal := httptest.NewRecorder()
		wrapped(recLocal, reqLocal)

		if recLocal.Header().Get("Access-Control-Allow-Origin") != "" {
			t.Errorf("expected Access-Control-Allow-Origin to be empty for non-allowed origin, got: %s", recLocal.Header().Get("Access-Control-Allow-Origin"))
		}
	})
}

func TestRealAgentTokenValidation(t *testing.T) {
	dummyHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	wrapped := agentAuthMiddleware(dummyHandler)

	// Ensure production mode
	t.Setenv("BYOS_DEV_MODE", "")
	t.Setenv("ADMIN_AGENT_TOKEN", "test-admin-secret-token-value")
	t.Setenv("SUPPORT_AGENT_TOKEN", "test-support-secret-token-value")

	// 1. Admin agent token succeeds
	reqAdmin := httptest.NewRequest(http.MethodGet, "/admin/v1/tickets", nil)
	reqAdmin.Header.Set("Authorization", "Bearer test-admin-secret-token-value")
	recAdmin := httptest.NewRecorder()
	wrapped(recAdmin, reqAdmin)
	if recAdmin.Code != http.StatusOK {
		t.Errorf("expected 200 with ADMIN_AGENT_TOKEN, got %d", recAdmin.Code)
	}

	// 2. Support agent token succeeds
	reqSupport := httptest.NewRequest(http.MethodGet, "/admin/v1/tickets", nil)
	reqSupport.Header.Set("Authorization", "Bearer test-support-secret-token-value")
	recSupport := httptest.NewRecorder()
	wrapped(recSupport, reqSupport)
	if recSupport.Code != http.StatusOK {
		t.Errorf("expected 200 with SUPPORT_AGENT_TOKEN, got %d", recSupport.Code)
	}

	// 3. Mock token in production is rejected
	reqMock := httptest.NewRequest(http.MethodGet, "/admin/v1/tickets", nil)
	reqMock.Header.Set("Authorization", "Bearer mock-support-agent")
	recMock := httptest.NewRecorder()
	wrapped(recMock, reqMock)
	if recMock.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 with mock token in production, got %d", recMock.Code)
	}
	if recMock.Body.String() != "Unauthorized: mock WebAuthn disabled in production\n" {
		t.Errorf("expected mock token rejection message, got: %s", recMock.Body.String())
	}

	// 4. Invalid token is rejected
	reqInvalid := httptest.NewRequest(http.MethodGet, "/admin/v1/tickets", nil)
	reqInvalid.Header.Set("Authorization", "Bearer completely-wrong-token")
	recInvalid := httptest.NewRecorder()
	wrapped(recInvalid, reqInvalid)
	if recInvalid.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 with invalid token, got %d", recInvalid.Code)
	}
}

func TestAdminSessionCookieAuthentication(t *testing.T) {
	dummyHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	wrapped := agentAuthMiddleware(dummyHandler)

	t.Setenv("ADMIN_AGENT_TOKEN", "cookie-admin-secret-token")

	// Authenticate via byos_admin_session HttpOnly cookie
	req := httptest.NewRequest(http.MethodGet, "/admin/v1/tickets", nil)
	req.AddCookie(&http.Cookie{
		Name:  "byos_admin_session",
		Value: "cookie-admin-secret-token",
	})
	rec := httptest.NewRecorder()
	wrapped(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK via cookie authentication, got %d", rec.Code)
	}
}

func TestAdminCSRFProtection(t *testing.T) {
	dummyHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	wrapped := agentAuthMiddleware(dummyHandler)

	t.Setenv("ADMIN_AGENT_TOKEN", "csrf-admin-secret-token")
	t.Setenv("ADMIN_ALLOWED_ORIGINS", "http://127.0.0.1:3003,http://localhost:3003")

	// 1. Untrusted Origin on POST is rejected with 403 Forbidden
	reqUntrusted := httptest.NewRequest(http.MethodPost, "/admin/v1/tickets/123/reply", nil)
	reqUntrusted.Header.Set("Origin", "http://evil-attacker.site")
	reqUntrusted.AddCookie(&http.Cookie{
		Name:  "byos_admin_session",
		Value: "csrf-admin-secret-token",
	})
	recUntrusted := httptest.NewRecorder()
	wrapped(recUntrusted, reqUntrusted)

	if recUntrusted.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for untrusted origin CSRF, got %d", recUntrusted.Code)
	}

	// 2. Allowed Origin on POST succeeds with 200 OK
	reqAllowed := httptest.NewRequest(http.MethodPost, "/admin/v1/tickets/123/reply", nil)
	reqAllowed.Header.Set("Origin", "http://localhost:3003")
	reqAllowed.AddCookie(&http.Cookie{
		Name:  "byos_admin_session",
		Value: "csrf-admin-secret-token",
	})
	recAllowed := httptest.NewRecorder()
	wrapped(recAllowed, reqAllowed)

	if recAllowed.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for allowed origin, got %d", recAllowed.Code)
	}

	// 3. Bearer token auth is not subject to cookie CSRF check
	reqBearer := httptest.NewRequest(http.MethodPost, "/admin/v1/tickets/123/reply", nil)
	reqBearer.Header.Set("Authorization", "Bearer csrf-admin-secret-token")
	reqBearer.Header.Set("Origin", "http://any-external-tool.local")
	recBearer := httptest.NewRecorder()
	wrapped(recBearer, reqBearer)

	if recBearer.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for bearer auth regardless of origin, got %d", recBearer.Code)
	}
}

func TestAdminLogoutEndpoint(t *testing.T) {
	mux := http.NewServeMux()
	setupRoutes(mux)

	req := httptest.NewRequest(http.MethodPost, "/admin/v1/auth/logout", nil)
	req.Header.Set("Origin", "http://localhost:3003")
	rec := httptest.NewRecorder()

	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204 No Content from logout, got %d", rec.Code)
	}

	// Check that cookie was cleared (MaxAge < 0)
	var clearedCookie *http.Cookie
	for _, c := range rec.Result().Cookies() {
		if c.Name == "byos_admin_session" {
			clearedCookie = c
			break
		}
	}

	if clearedCookie == nil {
		t.Fatal("expected byos_admin_session cookie to be returned with clearance")
	}
	if clearedCookie.MaxAge >= 0 {
		t.Errorf("expected negative MaxAge for cookie clearance, got %d", clearedCookie.MaxAge)
	}
	if !clearedCookie.HttpOnly {
		t.Errorf("expected cleared cookie to retain HttpOnly: true")
	}
}

func TestAdminCookieSecurityConfiguration(t *testing.T) {
	// 1. In production, Secure must be true
	t.Run("ProductionCookieSecure", func(t *testing.T) {
		t.Setenv("BYOS_ENV", "production")
		t.Setenv("BYOS_COOKIE_SECURE", "")

		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/admin/v1/auth/login", nil)
		setAdminSessionCookie(rec, req, "admin-test-token")

		var c *http.Cookie
		for _, cookie := range rec.Result().Cookies() {
			if cookie.Name == "byos_admin_session" {
				c = cookie
				break
			}
		}
		if c == nil {
			t.Fatal("expected byos_admin_session cookie")
		}
		if !c.Secure {
			t.Error("expected Secure: true in production")
		}
		if !c.HttpOnly {
			t.Error("expected HttpOnly: true")
		}
		if c.SameSite != http.SameSiteLaxMode {
			t.Errorf("expected SameSite: Lax, got %v", c.SameSite)
		}
		if c.Path != "/" {
			t.Errorf("expected Path: /, got %s", c.Path)
		}
	})

	// 2. In development without BYOS_COOKIE_SECURE, Secure must be false
	t.Run("DevelopmentCookieNonSecure", func(t *testing.T) {
		t.Setenv("BYOS_ENV", "development")
		t.Setenv("BYOS_COOKIE_SECURE", "false")

		rec := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/admin/v1/auth/login", nil)
		setAdminSessionCookie(rec, req, "admin-test-token")

		var c *http.Cookie
		for _, cookie := range rec.Result().Cookies() {
			if cookie.Name == "byos_admin_session" {
				c = cookie
				break
			}
		}
		if c == nil {
			t.Fatal("expected byos_admin_session cookie")
		}
		if c.Secure {
			t.Error("expected Secure: false in development")
		}
		if !c.HttpOnly {
			t.Error("expected HttpOnly: true in development")
		}
	})
}


