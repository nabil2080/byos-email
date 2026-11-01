package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"
)

func TestDetectClient(t *testing.T) {
	// 1. Explicit X-BYOS-Client header
	reqWebmail := httptest.NewRequest(http.MethodGet, "/v1/auth/me", nil)
	reqWebmail.Header.Set("X-BYOS-Client", "webmail")
	if client := detectClient(reqWebmail); client != "webmail" {
		t.Errorf("expected webmail, got %s", client)
	}

	reqCP := httptest.NewRequest(http.MethodGet, "/v1/auth/me", nil)
	reqCP.Header.Set("X-BYOS-Client", "control-plane")
	if client := detectClient(reqCP); client != "control-plane" {
		t.Errorf("expected control-plane, got %s", client)
	}

	// 2. Port detection via Origin / Referer
	reqOrigin3001 := httptest.NewRequest(http.MethodGet, "/v1/auth/me", nil)
	reqOrigin3001.Header.Set("Origin", "http://127.0.0.1:3001")
	if client := detectClient(reqOrigin3001); client != "webmail" {
		t.Errorf("expected webmail from origin :3001, got %s", client)
	}

	reqOrigin3000 := httptest.NewRequest(http.MethodGet, "/v1/auth/me", nil)
	reqOrigin3000.Header.Set("Origin", "http://127.0.0.1:3000")
	if client := detectClient(reqOrigin3000); client != "control-plane" {
		t.Errorf("expected control-plane from origin :3000, got %s", client)
	}
}

func TestSetSessionCookie_WebmailAndControlPlane(t *testing.T) {
	oldEnv := os.Getenv("BYOS_ENV")
	oldSec := os.Getenv("BYOS_COOKIE_SECURE")
	defer func() {
		os.Setenv("BYOS_ENV", oldEnv)
		os.Setenv("BYOS_COOKIE_SECURE", oldSec)
	}()

	testExpires := time.Now().Add(24 * time.Hour)

	// Subtest 1: Webmail in development (Secure = false)
	t.Run("Webmail_Development", func(t *testing.T) {
		os.Setenv("BYOS_ENV", "development")
		os.Setenv("BYOS_COOKIE_SECURE", "false")

		req := httptest.NewRequest(http.MethodPost, "/v1/auth/login", nil)
		req.Header.Set("X-BYOS-Client", "webmail")
		rec := httptest.NewRecorder()

		setSessionCookie(rec, req, "test-webmail-token-123", testExpires)

		var cookie *http.Cookie
		for _, c := range rec.Result().Cookies() {
			if c.Name == "byos_webmail_session" {
				cookie = c
				break
			}
		}

		if cookie == nil {
			t.Fatal("expected byos_webmail_session cookie to be set")
		}
		if cookie.Value != "test-webmail-token-123" {
			t.Errorf("expected token value match, got %s", cookie.Value)
		}
		if !cookie.HttpOnly {
			t.Error("expected HttpOnly: true")
		}
		if cookie.SameSite != http.SameSiteLaxMode {
			t.Errorf("expected SameSite: Lax, got %v", cookie.SameSite)
		}
		if cookie.Path != "/" {
			t.Errorf("expected Path: /, got %s", cookie.Path)
		}
		if cookie.Secure {
			t.Error("expected Secure: false in development")
		}
		if cookie.MaxAge <= 0 {
			t.Errorf("expected positive MaxAge, got %d", cookie.MaxAge)
		}
	})

	// Subtest 2: Webmail in production (Secure = true)
	t.Run("Webmail_Production", func(t *testing.T) {
		os.Setenv("BYOS_ENV", "production")
		os.Setenv("BYOS_COOKIE_SECURE", "")

		req := httptest.NewRequest(http.MethodPost, "/v1/auth/login", nil)
		req.Header.Set("X-BYOS-Client", "webmail")
		rec := httptest.NewRecorder()

		setSessionCookie(rec, req, "test-webmail-prod-token", testExpires)

		var cookie *http.Cookie
		for _, c := range rec.Result().Cookies() {
			if c.Name == "byos_webmail_session" {
				cookie = c
				break
			}
		}

		if cookie == nil {
			t.Fatal("expected byos_webmail_session cookie to be set")
		}
		if !cookie.Secure {
			t.Error("expected Secure: true in production environment")
		}
		if !cookie.HttpOnly {
			t.Error("expected HttpOnly: true in production")
		}
	})

	// Subtest 3: Control plane in production (Secure = true)
	t.Run("ControlPlane_Production", func(t *testing.T) {
		os.Setenv("BYOS_ENV", "production")

		req := httptest.NewRequest(http.MethodPost, "/v1/auth/login", nil)
		req.Header.Set("X-BYOS-Client", "control-plane")
		rec := httptest.NewRecorder()

		setSessionCookie(rec, req, "test-cp-prod-token", testExpires)

		var cookie *http.Cookie
		for _, c := range rec.Result().Cookies() {
			if c.Name == "byos_cp_session" {
				cookie = c
				break
			}
		}

		if cookie == nil {
			t.Fatal("expected byos_cp_session cookie to be set")
		}
		if !cookie.Secure {
			t.Error("expected Secure: true for control-plane in production")
		}
		if !cookie.HttpOnly {
			t.Error("expected HttpOnly: true for control-plane")
		}
	})
}

func TestClearSessionCookie_WebmailAndControlPlane(t *testing.T) {
	// 1. Webmail clear
	reqWM := httptest.NewRequest(http.MethodPost, "/v1/auth/logout", nil)
	reqWM.Header.Set("X-BYOS-Client", "webmail")
	recWM := httptest.NewRecorder()

	clearSessionCookie(recWM, reqWM)

	var cookieWM *http.Cookie
	for _, c := range recWM.Result().Cookies() {
		if c.Name == "byos_webmail_session" {
			cookieWM = c
			break
		}
	}
	if cookieWM == nil {
		t.Fatal("expected byos_webmail_session cookie to be cleared")
	}
	if cookieWM.MaxAge >= 0 {
		t.Errorf("expected negative MaxAge for cleared cookie, got %d", cookieWM.MaxAge)
	}
	if cookieWM.Value != "" {
		t.Errorf("expected empty value for cleared cookie, got %s", cookieWM.Value)
	}
	if !cookieWM.HttpOnly {
		t.Error("expected HttpOnly: true on cleared cookie")
	}

	// 2. Control Plane clear
	reqCP := httptest.NewRequest(http.MethodPost, "/v1/auth/logout", nil)
	reqCP.Header.Set("X-BYOS-Client", "control-plane")
	recCP := httptest.NewRecorder()

	clearSessionCookie(recCP, reqCP)

	var cookieCP *http.Cookie
	for _, c := range recCP.Result().Cookies() {
		if c.Name == "byos_cp_session" {
			cookieCP = c
			break
		}
	}
	if cookieCP == nil {
		t.Fatal("expected byos_cp_session cookie to be cleared")
	}
	if cookieCP.MaxAge >= 0 {
		t.Errorf("expected negative MaxAge for cleared CP cookie, got %d", cookieCP.MaxAge)
	}
}

func TestGetSessionUserID_RejectsMissingOrInvalidCookie(t *testing.T) {
	// Request without any cookie or bearer header must return false
	reqEmpty := httptest.NewRequest(http.MethodGet, "/v1/auth/me", nil)
	reqEmpty.Header.Set("X-BYOS-Client", "webmail")
	userID, ok := getSessionUserID(reqEmpty)
	if ok || userID != "" {
		t.Errorf("expected unauthenticated for empty request, got ok=%v, userID=%s", ok, userID)
	}

	// Request with non-existent token must fail closed and return false
	reqBogus := httptest.NewRequest(http.MethodGet, "/v1/auth/me", nil)
	reqBogus.Header.Set("X-BYOS-Client", "webmail")
	reqBogus.AddCookie(&http.Cookie{
		Name:  "byos_webmail_session",
		Value: "non-existent-token-that-does-not-exist-in-db",
	})
	userID2, ok2 := getSessionUserID(reqBogus)
	if ok2 || userID2 != "" {
		t.Errorf("expected unauthenticated for bogus token, got ok=%v, userID=%s", ok2, userID2)
	}
}
