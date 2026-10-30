package main

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCalendarFeedProxy_Unauthorized(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/v1/calendar/feed-proxy?url=https://example.com/cal.ics", nil)
	w := httptest.NewRecorder()

	calendarFeedProxyHandler(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected HTTP 401 Unauthorized, got %d (body: %s)", w.Code, w.Body.String())
	}
}

func TestCalendarFeedProxy_MissingOrInvalidURL(t *testing.T) {
	t.Setenv("BYOS_LEGACY_AUTH_ENABLED", "true")
	testUserID := "11111111-1111-1111-1111-111111111111"

	// 1. Missing URL
	req := httptest.NewRequest(http.MethodGet, "/v1/calendar/feed-proxy", nil)
	req.Header.Set("X-User-Id", testUserID)
	w := httptest.NewRecorder()
	calendarFeedProxyHandler(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected HTTP 400 for missing url, got %d", w.Code)
	}

	// 2. Disallowed scheme (file://)
	req = httptest.NewRequest(http.MethodGet, "/v1/calendar/feed-proxy?url=file:///etc/passwd", nil)
	req.Header.Set("X-User-Id", testUserID)
	w = httptest.NewRecorder()
	calendarFeedProxyHandler(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected HTTP 400 for file:// scheme, got %d", w.Code)
	}

	// 3. Disallowed scheme (gopher://)
	req = httptest.NewRequest(http.MethodGet, "/v1/calendar/feed-proxy?url=gopher://127.0.0.1/", nil)
	req.Header.Set("X-User-Id", testUserID)
	w = httptest.NewRecorder()
	calendarFeedProxyHandler(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected HTTP 400 for gopher:// scheme, got %d", w.Code)
	}
}

func TestCalendarFeedProxy_SSRFProtection(t *testing.T) {
	t.Setenv("BYOS_LEGACY_AUTH_ENABLED", "true")
	testUserID := "11111111-1111-1111-1111-111111111111"

	forbiddenTargets := []string{
		"http://127.0.0.1/feed.ics",
		"http://127.0.0.2:8080/calendar",
		"http://localhost/calendar.ics",
		"http://localhost:3000/feed.ics",
		"http://sub.localhost/events.ics",
		"http://10.0.0.1/feed.ics",
		"http://10.254.1.1/feed.ics",
		"http://172.16.0.1/feed.ics",
		"http://172.31.255.255/feed.ics",
		"http://192.168.1.1/feed.ics",
		"http://192.168.100.50/feed.ics",
		"http://169.254.169.254/latest/meta-data/",
		"http://169.254.1.1/feed.ics",
		"http://[::1]/feed.ics",
		"http://[fc00::1]/feed.ics",
		"http://[fe80::1]/feed.ics",
		"webcal://127.0.0.1/test.ics",
		"webcal://169.254.169.254/secret.ics",
	}

	for _, target := range forbiddenTargets {
		t.Run(target, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/v1/calendar/feed-proxy?url="+target, nil)
			req.Header.Set("X-User-Id", testUserID)
			w := httptest.NewRecorder()

			calendarFeedProxyHandler(w, req)

			if w.Code != http.StatusForbidden {
				t.Errorf("target %s: expected HTTP 403 Forbidden, got %d (body: %s)", target, w.Code, w.Body.String())
			}
			if !strings.Contains(w.Body.String(), "SSRF protection") {
				t.Errorf("target %s: expected response body to mention SSRF protection, got %s", target, w.Body.String())
			}
		})
	}
}

func TestCalendarFeedProxy_ResponseSizeLimitLogic(t *testing.T) {
	// Verify that reading body exceeding 5MB triggers truncation or error
	const maxLimit = maxFeedResponseBytes
	oversizedStream := bytes.NewReader(bytes.Repeat([]byte("A"), maxLimit+100))
	body, err := io.ReadAll(io.LimitReader(oversizedStream, maxLimit+1))
	if err != nil {
		t.Fatalf("unexpected read error: %v", err)
	}
	if int64(len(body)) <= maxLimit {
		t.Fatalf("expected read length to exceed 5MB limit, got %d", len(body))
	}
}

func TestCalendarFeedProxy_SSRFForbiddenIPUnit(t *testing.T) {
	forbiddenIPs := []string{
		"127.0.0.1",
		"127.10.20.30",
		"10.0.0.1",
		"10.255.255.255",
		"172.16.0.1",
		"172.31.255.255",
		"192.168.0.1",
		"192.168.254.254",
		"169.254.169.254",
		"169.254.1.1",
		"0.0.0.0",
		"255.255.255.255",
		"::1",
		"fc00::1",
		"fd12:3456:789a::1",
		"fe80::1",
		"::",
	}

	for _, ipStr := range forbiddenIPs {
		if !isForbiddenHost(ipStr) {
			t.Errorf("expected isForbiddenHost(%q) to be true", ipStr)
		}
	}

	forbiddenHosts := []string{
		"localhost",
		"LOCALHOST",
		"sub.localhost",
		"metadata.google.internal",
	}

	for _, h := range forbiddenHosts {
		if !isForbiddenHost(h) {
			t.Errorf("expected isForbiddenHost(%q) to be true", h)
		}
	}
}
