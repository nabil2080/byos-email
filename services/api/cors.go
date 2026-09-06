package main

// Evidence:
// - Route table: withCORS wraps 25 of 26 routes in main() (all except "/").
// - ROADMAP_STATUS.md Section 14: "withCORS for 8080<->3000", "BYOS_ALLOWED_ORIGINS
//   allowlist", same-origin only, no arbitrary Origin reflection.
// - api.exe symbol table: main.withCORS.func1 (closure evidence).

import (
	"net/http"
	"os"
	"strings"
)

func withCORS(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		// Same-origin via Vite proxy requires no CORS. Only allow credentialed
		// CORS if Origin is in the explicit allowlist.
		allowed := os.Getenv("BYOS_ALLOWED_ORIGINS")
		if origin != "" && allowed != "" {
			for _, a := range strings.Split(allowed, ",") {
				if strings.TrimSpace(a) == origin {
					w.Header().Set("Access-Control-Allow-Origin", origin)
					w.Header().Set("Access-Control-Allow-Credentials", "true")
					w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
					w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-User-Id, X-User-ID, Authorization, Cookie")
					w.Header().Set("Vary", "Origin")
					break
				}
			}
		}
		if r.Method == http.MethodOptions {
			// For same-origin proxy, no CORS headers needed; just handle preflight.
			// Cross-origin not allowed -> still return 204 but without ACAO.
			w.WriteHeader(http.StatusNoContent)
			return
		}
		h(w, r)
	}
}
