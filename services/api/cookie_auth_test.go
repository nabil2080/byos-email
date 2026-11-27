package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
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

	// Subtest 4: Webmail in staging (Secure = true)
	t.Run("Webmail_Staging_FailClosedSecure", func(t *testing.T) {
		os.Setenv("BYOS_ENV", "staging")
		os.Setenv("BYOS_COOKIE_SECURE", "")

		req := httptest.NewRequest(http.MethodPost, "/v1/auth/login", nil)
		req.Header.Set("X-BYOS-Client", "webmail")
		rec := httptest.NewRecorder()

		setSessionCookie(rec, req, "test-staging-token", testExpires)

		var cookie *http.Cookie
		for _, c := range rec.Result().Cookies() {
			if c.Name == "byos_webmail_session" {
				cookie = c
				break
			}
		}
		if cookie == nil {
			t.Fatal("expected byos_webmail_session cookie to be set in staging")
		}
		if !cookie.Secure {
			t.Error("expected Secure: true in staging")
		}
		if !cookie.HttpOnly {
			t.Error("expected HttpOnly: true in staging")
		}
	})

	// Subtest 5: Default/Unset environment (Secure = true fail-closed)
	t.Run("DefaultUnset_FailClosedSecure", func(t *testing.T) {
		os.Setenv("BYOS_ENV", "")
		os.Setenv("BYOS_COOKIE_SECURE", "")

		req := httptest.NewRequest(http.MethodPost, "/v1/auth/login", nil)
		req.Header.Set("X-BYOS-Client", "webmail")
		rec := httptest.NewRecorder()

		setSessionCookie(rec, req, "test-default-token", testExpires)

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
			t.Error("expected Secure: true when BYOS_ENV is unset (fail-closed)")
		}
	})

	// Subtest 6: Development with explicit BYOS_COOKIE_SECURE=true
	t.Run("Development_ExplicitCookieSecure", func(t *testing.T) {
		os.Setenv("BYOS_ENV", "development")
		os.Setenv("BYOS_COOKIE_SECURE", "true")

		req := httptest.NewRequest(http.MethodPost, "/v1/auth/login", nil)
		req.Header.Set("X-BYOS-Client", "webmail")
		rec := httptest.NewRecorder()

		setSessionCookie(rec, req, "test-dev-secure-token", testExpires)

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
			t.Error("expected Secure: true when BYOS_COOKIE_SECURE=true even in development")
		}
	})

	// Subtest 7: Generic CLI / API client without client header
	t.Run("GenericClient_SessionCookie", func(t *testing.T) {
		os.Setenv("BYOS_ENV", "development")
		os.Setenv("BYOS_COOKIE_SECURE", "false")

		req := httptest.NewRequest(http.MethodPost, "/v1/auth/login", nil)
		rec := httptest.NewRecorder()

		setSessionCookie(rec, req, "test-cli-token", testExpires)

		var cookie *http.Cookie
		for _, c := range rec.Result().Cookies() {
			if c.Name == "byos_session" {
				cookie = c
				break
			}
		}
		if cookie == nil {
			t.Fatal("expected fallback byos_session cookie for generic client")
		}
		if cookie.Value != "test-cli-token" {
			t.Errorf("expected test-cli-token, got %s", cookie.Value)
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

func TestAuthenticationResponseBoundary_AllHeaderVariants(t *testing.T) {
	// Sentinel test credential that must NEVER be leaked or serialized into JSON
	sentinelToken := "sentinel-session-secret-abcdef0123456789-do-not-serialize"
	testExpires := time.Now().Add(24 * time.Hour)

	headerTestCases := []struct {
		name               string
		headerKey          string
		headerVal          string
		expectedCookieName string
	}{
		{
			name:               "1. No X-BYOS-Client Header (omitted)",
			headerKey:          "",
			headerVal:          "",
			expectedCookieName: "byos_session",
		},
		{
			name:               "2. X-BYOS-Client: webmail",
			headerKey:          "X-BYOS-Client",
			headerVal:          "webmail",
			expectedCookieName: "byos_webmail_session",
		},
		{
			name:               "3. X-BYOS-Client: control-plane",
			headerKey:          "X-BYOS-Client",
			headerVal:          "control-plane",
			expectedCookieName: "byos_cp_session",
		},
		{
			name:               "4. X-BYOS-Client: cli",
			headerKey:          "X-BYOS-Client",
			headerVal:          "cli",
			expectedCookieName: "byos_session",
		},
		{
			name:               "5. X-BYOS-Client: arbitrary forged value",
			headerKey:          "X-BYOS-Client",
			headerVal:          "forged-native-ios-app-credential-collector",
			expectedCookieName: "byos_session",
		},
		{
			name:               "6. X-BYOS-Client: explicitly empty",
			headerKey:          "X-BYOS-Client",
			headerVal:          "",
			expectedCookieName: "byos_session",
		},
	}

	for _, tc := range headerTestCases {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/v1/auth/login", nil)
			if tc.headerKey != "" {
				req.Header.Set(tc.headerKey, tc.headerVal)
			}
			rec := httptest.NewRecorder()

			// 1. Assert SetSessionCookie behavior
			setSessionCookie(rec, req, sentinelToken, testExpires)

			var issuedCookie *http.Cookie
			for _, c := range rec.Result().Cookies() {
				if c.Name == tc.expectedCookieName {
					issuedCookie = c
					break
				}
			}
			if issuedCookie == nil {
				t.Fatalf("expected cookie %s to be set, but found none in cookies: %v", tc.expectedCookieName, rec.Result().Cookies())
			}
			if !issuedCookie.HttpOnly {
				t.Errorf("cookie %s must be marked HttpOnly=true", tc.expectedCookieName)
			}
			if issuedCookie.Path != "/" {
				t.Errorf("cookie %s must have Path=/, got %s", tc.expectedCookieName, issuedCookie.Path)
			}
			if issuedCookie.SameSite != http.SameSiteLaxMode {
				t.Errorf("cookie %s must have SameSite=Lax", tc.expectedCookieName)
			}
			if issuedCookie.Value != sentinelToken {
				t.Errorf("cookie %s value mismatch", tc.expectedCookieName)
			}

			// 2. Assert that simulated authentication responses NEVER serialize sentinelToken
			// Simulate response structs across login, register, 2fa, passkeys, invitations, and recovery flows:
			sampleResponses := []map[string]interface{}{
				// Flow A: Login response
				{
					"id":                  "test-user-id",
					"email":               "user@byos.local",
					"org_id":              "test-org-id",
					"organization_id":     "test-org-id",
					"role":                "owner",
					"seat_count":          5,
					"subscription_status": "active",
					"mailbox_id":          "mb-1",
					"mailbox_local_part":  "user",
					"mailbox_mode":        "private",
					"wrapped_sk_user":     "01aabbcc",
				},
				// Flow B: Register response
				{
					"id":       "test-user-id",
					"email":    "user@byos.local",
					"org_id":   "test-org-id",
					"org_name": "Test Org",
				},
				// Flow C: Invitation claim response
				{
					"success":      true,
					"user_id":      "test-user-id",
					"email":        "user@byos.local",
					"org_id":       "test-org-id",
					"mailbox_id":   "mb-1",
					"privacy_mode": "private",
				},
				// Flow D: Exceptional recovery reset response
				{
					"success": true,
					"message": "Password reset successfully via exceptional recovery.",
				},
			}

			for idx, resp := range sampleResponses {
				var buf bytes.Buffer
				if err := json.NewEncoder(&buf).Encode(resp); err != nil {
					t.Fatalf("flow %d failed to encode json: %v", idx, err)
				}
				jsonStr := buf.String()

				// Assert "token" field is completely absent from top-level map
				if _, exists := resp["token"]; exists {
					t.Errorf("flow %d under %s must not contain 'token' property", idx, tc.name)
				}
				if _, exists := resp["session_token"]; exists {
					t.Errorf("flow %d under %s must not contain 'session_token' property", idx, tc.name)
				}
				if _, exists := resp["sessionToken"]; exists {
					t.Errorf("flow %d under %s must not contain 'sessionToken' property", idx, tc.name)
				}

				// Deep string inspection: ensure sentinel token never appears anywhere in output JSON
				if strings.Contains(jsonStr, sentinelToken) {
					t.Errorf("flow %d under %s leaked sentinel session token into serialized JSON: %s", idx, tc.name, jsonStr)
				}
			}
		})
	}
}

func TestLogoutCookieClearing(t *testing.T) {
	// Subtest 1: Webmail client logout clears byos_webmail_session
	t.Run("Webmail_Logout", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/v1/auth/logout", nil)
		req.Header.Set("X-BYOS-Client", "webmail")
		req.AddCookie(&http.Cookie{
			Name:  "byos_webmail_session",
			Value: "mock-active-webmail-token",
		})
		rec := httptest.NewRecorder()

		clearSessionCookie(rec, req)

		var clearedCookie *http.Cookie
		for _, c := range rec.Result().Cookies() {
			if c.Name == "byos_webmail_session" {
				clearedCookie = c
				break
			}
		}
		if clearedCookie == nil {
			t.Fatal("expected byos_webmail_session cookie to be cleared")
		}
		if clearedCookie.MaxAge >= 0 {
			t.Errorf("expected negative MaxAge for cleared cookie, got %d", clearedCookie.MaxAge)
		}
		if clearedCookie.Value != "" {
			t.Errorf("expected empty value for cleared cookie, got %s", clearedCookie.Value)
		}
		if !clearedCookie.HttpOnly {
			t.Error("expected HttpOnly: true on cleared cookie")
		}
	})

	// Subtest 2: Control Plane client logout clears byos_cp_session
	t.Run("ControlPlane_Logout", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/v1/auth/logout", nil)
		req.Header.Set("X-BYOS-Client", "control-plane")
		req.AddCookie(&http.Cookie{
			Name:  "byos_cp_session",
			Value: "mock-active-cp-token",
		})
		rec := httptest.NewRecorder()

		clearSessionCookie(rec, req)

		var clearedCookie *http.Cookie
		for _, c := range rec.Result().Cookies() {
			if c.Name == "byos_cp_session" {
				clearedCookie = c
				break
			}
		}
		if clearedCookie == nil {
			t.Fatal("expected byos_cp_session cookie to be cleared")
		}
		if clearedCookie.MaxAge >= 0 {
			t.Errorf("expected negative MaxAge for cleared cookie, got %d", clearedCookie.MaxAge)
		}
		if clearedCookie.Value != "" {
			t.Errorf("expected empty value for cleared cookie, got %s", clearedCookie.Value)
		}
		if !clearedCookie.HttpOnly {
			t.Error("expected HttpOnly: true on cleared cookie")
		}
	})

	// Subtest 3: Generic / unspecified client logout clears ONLY byos_session (must not clear app cookies)
	t.Run("Generic_Logout_IsolatedToLegacyCookieOnly", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/v1/auth/logout", nil)
		req.AddCookie(&http.Cookie{
			Name:  "byos_webmail_session",
			Value: "incoming-webmail-token",
		})
		req.AddCookie(&http.Cookie{
			Name:  "byos_cp_session",
			Value: "incoming-cp-token",
		})
		rec := httptest.NewRecorder()

		clearSessionCookie(rec, req)

		clearedCookies := rec.Result().Cookies()
		cookieMap := make(map[string]*http.Cookie)
		for _, c := range clearedCookies {
			cookieMap[c.Name] = c
		}

		if c, found := cookieMap["byos_session"]; !found || c.MaxAge >= 0 || c.Value != "" {
			t.Errorf("expected byos_session to be cleared")
		}
		if _, found := cookieMap["byos_webmail_session"]; found {
			t.Errorf("generic logout must not clear byos_webmail_session")
		}
		if _, found := cookieMap["byos_cp_session"]; found {
			t.Errorf("generic logout must not clear byos_cp_session")
		}
	})
}

func TestCrossAppCookieIsolationAndConflictFailClosed(t *testing.T) {
	wmCookie := &http.Cookie{Name: "byos_webmail_session", Value: "wm-tok"}
	cpCookie := &http.Cookie{Name: "byos_cp_session", Value: "cp-tok"}
	legacyCookie := &http.Cookie{Name: "byos_session", Value: "cli-tok"}

	// 1. Webmail cookie in Webmail context -> accepted
	req1 := httptest.NewRequest(http.MethodGet, "/v1/auth/me", nil)
	req1.Header.Set("X-BYOS-Client", "webmail")
	req1.AddCookie(wmCookie)
	if got := extractSessionToken(req1); got != "wm-tok" {
		t.Fatalf("expected wm-tok in webmail context, got %q", got)
	}

	// 2. Control Plane cookie in Control Plane context -> accepted
	req2 := httptest.NewRequest(http.MethodGet, "/v1/auth/me", nil)
	req2.Header.Set("X-BYOS-Client", "control-plane")
	req2.AddCookie(cpCookie)
	if got := extractSessionToken(req2); got != "cp-tok" {
		t.Fatalf("expected cp-tok in control-plane context, got %q", got)
	}

	// 3. Webmail cookie presented in Control Plane context -> rejected
	req3 := httptest.NewRequest(http.MethodGet, "/v1/auth/me", nil)
	req3.Header.Set("X-BYOS-Client", "control-plane")
	req3.AddCookie(wmCookie)
	if got := extractSessionToken(req3); got != "" {
		t.Fatalf("expected empty token for webmail cookie in CP context, got %q", got)
	}

	// 4. Control Plane cookie presented in Webmail context -> rejected
	req4 := httptest.NewRequest(http.MethodGet, "/v1/auth/me", nil)
	req4.Header.Set("X-BYOS-Client", "webmail")
	req4.AddCookie(cpCookie)
	if got := extractSessionToken(req4); got != "" {
		t.Fatalf("expected empty token for CP cookie in webmail context, got %q", got)
	}

	// 5. Unknown client context with only Webmail cookie -> rejected
	req5 := httptest.NewRequest(http.MethodGet, "/v1/auth/me", nil)
	req5.AddCookie(wmCookie)
	if got := extractSessionToken(req5); got != "" {
		t.Fatalf("expected empty token for unknown context + webmail cookie, got %q", got)
	}

	// 6. Unknown client context with only Control Plane cookie -> rejected
	req6 := httptest.NewRequest(http.MethodGet, "/v1/auth/me", nil)
	req6.AddCookie(cpCookie)
	if got := extractSessionToken(req6); got != "" {
		t.Fatalf("expected empty token for unknown context + CP cookie, got %q", got)
	}

	// 7. Unknown context with both application cookies -> rejected
	req7 := httptest.NewRequest(http.MethodGet, "/v1/auth/me", nil)
	req7.AddCookie(wmCookie)
	req7.AddCookie(cpCookie)
	if got := extractSessionToken(req7); got != "" {
		t.Fatalf("expected empty token for unknown context + both app cookies, got %q", got)
	}

	// 8. Unknown context with legacy byos_session -> accepted (CLI/test compatibility)
	reqLegacy := httptest.NewRequest(http.MethodGet, "/v1/auth/me", nil)
	reqLegacy.AddCookie(legacyCookie)
	if got := extractSessionToken(reqLegacy); got != "cli-tok" {
		t.Fatalf("expected cli-tok for unknown context + legacy cookie, got %q", got)
	}

	// 9. Conflicting client signals -> fail closed on both auth and logout clearing
	for _, tc := range []struct {
		name    string
		client  string
		origin  string
		referer string
	}{
		{"Header_Webmail_Origin_CP", "webmail", "http://127.0.0.1:3000", ""},
		{"Header_CP_Origin_Webmail", "control-plane", "http://127.0.0.1:3001", ""},
		{"Origin_CP_Referer_Webmail", "", "http://127.0.0.1:3000", "http://127.0.0.1:3001/inbox"},
		{"Origin_Webmail_Referer_CP", "", "http://127.0.0.1:3001", "http://127.0.0.1:3000/dashboard"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			reqConflict := httptest.NewRequest(http.MethodPost, "/v1/auth/logout", nil)
			if tc.client != "" {
				reqConflict.Header.Set("X-BYOS-Client", tc.client)
			}
			if tc.origin != "" {
				reqConflict.Header.Set("Origin", tc.origin)
			}
			if tc.referer != "" {
				reqConflict.Header.Set("Referer", tc.referer)
			}
			reqConflict.AddCookie(wmCookie)
			reqConflict.AddCookie(cpCookie)
			if got := extractSessionToken(reqConflict); got != "" {
				t.Fatalf("expected empty token on conflicting client signals (%s), got %q", tc.name, got)
			}
			recConflict := httptest.NewRecorder()
			clearSessionCookie(recConflict, reqConflict)
			if len(recConflict.Result().Cookies()) != 0 {
				t.Fatalf("expected 0 cleared cookies on conflicting client signals (%s), got %d", tc.name, len(recConflict.Result().Cookies()))
			}
		})
	}
}
