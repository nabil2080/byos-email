package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
)

func TestLegacyAuthGating(t *testing.T) {
	testUUID := uuid.New().String()

	t.Run("DevelopmentWithLegacyAuthEnabled", func(t *testing.T) {
		t.Setenv("BYOS_ENV", "development")
		t.Setenv("BYOS_LEGACY_AUTH_ENABLED", "true")

		if !isLegacyAuthEnabled() {
			t.Fatal("expected isLegacyAuthEnabled() to be true in development with flag set")
		}

		req := httptest.NewRequest(http.MethodGet, "/v1/auth/me", nil)
		req.Header.Set("X-User-Id", testUUID)

		uid, ok := getUserID(req)
		if !ok || uid != testUUID {
			t.Fatalf("expected getUserID to succeed with %q, got %q (ok=%v)", testUUID, uid, ok)
		}

		authUID, ok := getAuthenticatedUserID(req)
		if !ok || authUID != testUUID {
			t.Fatalf("expected getAuthenticatedUserID to succeed with %q, got %q (ok=%v)", testUUID, authUID, ok)
		}
	})

	t.Run("DevelopmentWithLegacyAuthDisabled", func(t *testing.T) {
		t.Setenv("BYOS_ENV", "development")
		t.Setenv("BYOS_LEGACY_AUTH_ENABLED", "false")

		if isLegacyAuthEnabled() {
			t.Fatal("expected isLegacyAuthEnabled() to be false when flag is false")
		}

		req := httptest.NewRequest(http.MethodGet, "/v1/auth/me", nil)
		req.Header.Set("X-User-Id", testUUID)

		_, ok := getAuthenticatedUserID(req)
		if ok {
			t.Fatal("expected getAuthenticatedUserID to fail when legacy auth is disabled")
		}
	})

	t.Run("ProductionWithLegacyAuthFlagAttempted", func(t *testing.T) {
		// Adversary attempts to enable BYOS_LEGACY_AUTH_ENABLED in production
		t.Setenv("BYOS_ENV", "production")
		t.Setenv("BYOS_LEGACY_AUTH_ENABLED", "true")

		if isLegacyAuthEnabled() {
			t.Fatal("CRITICAL: isLegacyAuthEnabled() must NEVER return true in production!")
		}

		req := httptest.NewRequest(http.MethodGet, "/v1/auth/me", nil)
		req.Header.Set("X-User-Id", testUUID)

		_, ok := getAuthenticatedUserID(req)
		if ok {
			t.Fatal("CRITICAL: getAuthenticatedUserID must reject X-User-Id header in production!")
		}
	})

	t.Run("UnsetEnvWithLegacyAuthFlagAttempted", func(t *testing.T) {
		t.Setenv("BYOS_ENV", "")
		t.Setenv("BYOS_LEGACY_AUTH_ENABLED", "1")

		if isLegacyAuthEnabled() {
			t.Fatal("CRITICAL: isLegacyAuthEnabled() must NEVER return true when BYOS_ENV is unset!")
		}

		req := httptest.NewRequest(http.MethodGet, "/v1/auth/me", nil)
		req.Header.Set("X-User-Id", testUUID)

		_, ok := getAuthenticatedUserID(req)
		if ok {
			t.Fatal("CRITICAL: getAuthenticatedUserID must reject X-User-Id header when BYOS_ENV is unset!")
		}
	})
}
