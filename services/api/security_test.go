package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSecurityMiddlewareRecordsMetrics(t *testing.T) {
	apiRequestsTotal.Store(0)
	apiResponsesError.Store(0)
	apiRequestNanos.Store(0)

	handler := withSecurityHeaders(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "test failure", http.StatusBadRequest)
	})
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	res := httptest.NewRecorder()
	handler(res, req)

	if res.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", res.Code, http.StatusBadRequest)
	}
	if got := apiRequestsTotal.Load(); got != 1 {
		t.Fatalf("requests = %d, want 1", got)
	}
	if got := apiResponsesError.Load(); got != 1 {
		t.Fatalf("errors = %d, want 1", got)
	}
	if got := res.Header().Get("X-Frame-Options"); got != "DENY" {
		t.Fatalf("security header = %q, want DENY", got)
	}
}
