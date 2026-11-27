package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestParseTrustedProxies(t *testing.T) {
	t.Run("ValidCIDRsAndSingleIPs", func(t *testing.T) {
		spec := "127.0.0.1/32, 10.0.0.0/8, 192.168.1.1, ::1, 2001:db8::/32"
		nets, err := ParseTrustedProxies(spec)
		if err != nil {
			t.Fatalf("unexpected error parsing valid spec: %v", err)
		}
		if len(nets) != 5 {
			t.Fatalf("expected 5 nets, got %d", len(nets))
		}
	})

	t.Run("InvalidCIDR", func(t *testing.T) {
		spec := "127.0.0.1/32, invalid-cidr"
		_, err := ParseTrustedProxies(spec)
		if err == nil {
			t.Fatal("expected error parsing invalid CIDR, got nil")
		}
	})

	t.Run("EmptySpec", func(t *testing.T) {
		nets, err := ParseTrustedProxies(" , , ")
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(nets) != 0 {
			t.Fatalf("expected 0 nets, got %d", len(nets))
		}
	})
}

func TestGetClientIP_Resolution(t *testing.T) {
	cases := []struct {
		name           string
		trustedProxies string
		remoteAddr     string
		xffHeader      string
		expectedIP     string
	}{
		{
			name:           "no trusted proxies configured - ignores XFF and returns peer IP",
			trustedProxies: "",
			remoteAddr:     "198.51.100.5:45678",
			xffHeader:      "203.0.113.195",
			expectedIP:     "198.51.100.5",
		},
		{
			name:           "immediate peer is not trusted - rejects forged XFF header",
			trustedProxies: "10.0.0.0/8, 127.0.0.1/32",
			remoteAddr:     "203.0.113.50:12345",
			xffHeader:      "1.1.1.1, 8.8.8.8",
			expectedIP:     "203.0.113.50",
		},
		{
			name:           "immediate peer is trusted - accepts single client XFF",
			trustedProxies: "10.0.0.0/8, 127.0.0.1/32",
			remoteAddr:     "10.0.0.1:54321",
			xffHeader:      "198.51.100.25",
			expectedIP:     "198.51.100.25",
		},
		{
			name:           "immediate peer is trusted - walks right to left skipping intermediary trusted proxy",
			trustedProxies: "10.0.0.0/8, 172.16.0.0/12, 127.0.0.1/32",
			remoteAddr:     "10.0.0.1:54321",
			xffHeader:      "198.51.100.40, 172.16.5.99",
			expectedIP:     "198.51.100.40",
		},
		{
			name:           "forged client hop ignored - right-to-left stops at first untrusted hop",
			trustedProxies: "10.0.0.0/8",
			remoteAddr:     "10.0.0.1:54321",
			// Attacker sent XFF: 8.8.8.8. Reverse proxy appended actual client IP 198.51.100.77.
			xffHeader:      "8.8.8.8, 198.51.100.77",
			expectedIP:     "198.51.100.77",
		},
		{
			name:           "all hops are trusted proxies - falls back to socket peer IP",
			trustedProxies: "10.0.0.0/8",
			remoteAddr:     "10.0.0.1:54321",
			xffHeader:      "10.0.0.5, 10.0.0.4, 10.0.0.2",
			expectedIP:     "10.0.0.1",
		},
		{
			name:           "no usable forwarded address (whitespace only) - falls back to socket peer IP",
			trustedProxies: "10.0.0.0/8",
			remoteAddr:     "10.0.0.1:54321",
			xffHeader:      " , , ",
			expectedIP:     "10.0.0.1",
		},
		{
			name:           "malformed forwarded chain - falls back to socket peer IP",
			trustedProxies: "10.0.0.0/8",
			remoteAddr:     "10.0.0.1:54321",
			xffHeader:      "garbage, not-an-ip, ::::",
			expectedIP:     "10.0.0.1",
		},
		{
			name:           "normal single-proxy resolution",
			trustedProxies: "10.0.0.0/8",
			remoteAddr:     "10.0.0.1:54321",
			xffHeader:      "198.51.100.25",
			expectedIP:     "198.51.100.25",
		},
		{
			name:           "multiple trusted proxies with an untrusted client",
			trustedProxies: "10.0.0.0/8, 172.16.0.0/12",
			remoteAddr:     "10.0.0.1:54321",
			xffHeader:      "203.0.113.10, 172.16.0.5, 10.0.0.2",
			expectedIP:     "203.0.113.10",
		},
		{
			name:           "trusted proxy with empty XFF - returns peer IP",
			trustedProxies: "10.0.0.0/8",
			remoteAddr:     "10.0.0.1:54321",
			xffHeader:      "",
			expectedIP:     "10.0.0.1",
		},
		{
			name:           "trusted proxy with whitespace/port in XFF",
			trustedProxies: "127.0.0.1/32",
			remoteAddr:     "127.0.0.1:50000",
			xffHeader:      " 203.0.113.88:8080 ",
			expectedIP:     "203.0.113.88",
		},
		{
			name:           "IPv6 trusted proxy and IPv6 client",
			trustedProxies: "::1/128, 2001:db8:cafe::/64",
			remoteAddr:     "[2001:db8:cafe::1]:51234",
			xffHeader:      "2001:db8:beef::42",
			expectedIP:     "2001:db8:beef::42",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("BYOS_TRUSTED_PROXIES", tc.trustedProxies)

			req := httptest.NewRequest(http.MethodGet, "/health", nil)
			req.RemoteAddr = tc.remoteAddr
			if tc.xffHeader != "" {
				req.Header.Set("X-Forwarded-For", tc.xffHeader)
			}

			resolved := GetClientIP(req)
			if resolved != tc.expectedIP {
				t.Errorf("GetClientIP() = %q, want %q", resolved, tc.expectedIP)
			}
		})
	}
}
