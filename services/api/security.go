package main

import (
	"net/http"
	"os"
	"sync/atomic"
	"time"
)

var (
	apiRequestsTotal  atomic.Uint64
	apiResponsesError atomic.Uint64
	apiRequestNanos   atomic.Uint64
)

type metricsResponseWriter struct {
	http.ResponseWriter
	status int
}

func (w *metricsResponseWriter) WriteHeader(status int) {
	w.status = status
	w.ResponseWriter.WriteHeader(status)
}

func (w *metricsResponseWriter) Write(body []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	return w.ResponseWriter.Write(body)
}

// withSecurityHeaders wraps an http.Handler to enforce strict security headers (Section 21).
func withSecurityHeaders(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		mw := &metricsResponseWriter{ResponseWriter: w}
		defer func() {
			apiRequestsTotal.Add(1)
			apiRequestNanos.Add(uint64(time.Since(start).Nanoseconds()))
			if mw.status >= 400 {
				apiResponsesError.Add(1)
			}
		}()
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("X-XSS-Protection", "1; mode=block")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self' http: https:;")

		if os.Getenv("BYOS_ENV") == "production" || os.Getenv("HTTPS_ENABLED") == "true" {
			w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}

		next(mw, r)
	}
}
