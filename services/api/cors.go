package main

// Evidence:
// - Route table: withCORS wraps 25 of 26 routes in main() (all except "/").
// - ROADMAP_STATUS.md Section 14: "withCORS for 8080<->3000", "BYOS_ALLOWED_ORIGINS
//   allowlist", same-origin only, no arbitrary Origin reflection.
// - api.exe symbol table: main.withCORS.func1 (closure evidence).

import (
	"net/http"
	"net/url"
	"os"
	"strings"
)

func isAllowedOrigin(origin string, allowedList string) bool {
	if origin == "" {
		return false
	}
	for _, a := range strings.Split(allowedList, ",") {
		if strings.TrimSpace(a) == origin {
			return true
		}
	}
	// In non-production environments, permit any localhost / 127.0.0.1 port
	if os.Getenv("BYOS_ENV") != "production" {
		u, err := url.Parse(origin)
		if err == nil && (u.Scheme == "http" || u.Scheme == "https") {
			hostname := u.Hostname()
			if hostname == "localhost" || hostname == "127.0.0.1" {
				return true
			}
		}
	}
	return false
}

func withCORS(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		// Same-origin via Vite proxy requires no CORS. Only allow credentialed
		// CORS if Origin is in the explicit allowlist.
		allowed := os.Getenv("BYOS_ALLOWED_ORIGINS")
		if allowed == "" && os.Getenv("BYOS_ENV") != "production" {
			allowed = "http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001,http://localhost:3002,http://127.0.0.1:3002,http://localhost:4173,http://127.0.0.1:4173,http://localhost:4321,http://127.0.0.1:4321,http://localhost:5173,http://127.0.0.1:5173,https://localhost:5173,https://127.0.0.1:5173"
		}
		if isAllowedOrigin(origin, allowed) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-User-Id, X-User-ID, Authorization, Cookie, X-BYOS-Client, x-byos-client, Accept, Origin, X-Requested-With, X-Object-Key, x-object-key")
			w.Header().Set("Access-Control-Expose-Headers", "ETag, If-Match")
			w.Header().Set("Access-Control-Max-Age", "86400")
			w.Header().Set("Vary", "Origin")
		}
		if r.Method == http.MethodOptions {
			// Preflight request response
			w.WriteHeader(http.StatusNoContent)
			return
		}

		// CSRF protection for cookie-authenticated state-changing requests
		isCookieAuth := false
		for _, cookieName := range []string{"byos_session", "byos_cp_session", "byos_webmail_session"} {
			if c, err := r.Cookie(cookieName); err == nil && c.Value != "" {
				isCookieAuth = true
				break
			}
		}
		if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") && strings.TrimSpace(strings.TrimPrefix(auth, "Bearer ")) != "" {
			isCookieAuth = false
		}

		if isCookieAuth {
			switch r.Method {
			case http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete:
				checkOrigin := origin
				if checkOrigin == "" {
					if ref := r.Header.Get("Referer"); ref != "" {
						if u, err := url.Parse(ref); err == nil {
							checkOrigin = u.Scheme + "://" + u.Host
						}
					}
				}
				if checkOrigin == "" || !isAllowedOrigin(checkOrigin, allowed) {
					w.Header().Set("Content-Type", "application/json")
					w.WriteHeader(http.StatusForbidden)
					w.Write([]byte(`{"error":"CSRF origin validation failed"}`))
					return
				}
			}
		}

		h(w, r)
	}
}
