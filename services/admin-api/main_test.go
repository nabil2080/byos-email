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
