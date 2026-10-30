package main

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const maxFeedResponseBytes = 5 * 1024 * 1024 // 5MB maximum response size limit

var forbiddenCIDRs []*net.IPNet

func init() {
	cidrStrings := []string{
		"127.0.0.0/8",          // IPv4 Loopback
		"10.0.0.0/8",           // RFC 1918 Private
		"172.16.0.0/12",        // RFC 1918 Private
		"192.168.0.0/16",       // RFC 1918 Private
		"169.254.0.0/16",       // IPv4 Link-Local (including 169.254.169.254 cloud metadata)
		"0.0.0.0/8",            // Current network
		"100.64.0.0/10",        // Carrier Grade NAT
		"192.0.0.0/24",         // IETF Protocol assignments
		"192.0.2.0/24",         // TEST-NET-1
		"198.18.0.0/15",        // Network benchmark
		"198.51.100.0/24",      // TEST-NET-2
		"203.0.113.0/24",       // TEST-NET-3
		"224.0.0.0/4",          // Multicast
		"240.0.0.0/4",          // Reserved for future use
		"255.255.255.255/32",   // Broadcast
		"::1/128",              // IPv6 Loopback
		"fc00::/7",             // IPv6 Unique Local Address
		"fe80::/10",            // IPv6 Link-Local
		"::/128",               // IPv6 Unspecified
		"ff00::/8",             // IPv6 Multicast
	}

	for _, cidr := range cidrStrings {
		_, ipNet, err := net.ParseCIDR(cidr)
		if err == nil && ipNet != nil {
			forbiddenCIDRs = append(forbiddenCIDRs, ipNet)
		}
	}
}

// isForbiddenIP verifies whether an IP is private, loopback, link-local, or cloud metadata.
func isForbiddenIP(ip net.IP) bool {
	if ip == nil {
		return true
	}

	// If IPv4-mapped IPv6, inspect the underlying IPv4 address
	if ip4 := ip.To4(); ip4 != nil {
		ip = ip4
	}

	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified() {
		return true
	}

	for _, block := range forbiddenCIDRs {
		if block.Contains(ip) {
			return true
		}
	}

	return false
}

// isForbiddenHost verifies whether a host/domain represents a restricted local or metadata destination.
func isForbiddenHost(host string) bool {
	clean := strings.ToLower(strings.TrimSpace(host))
	if clean == "" {
		return true
	}
	if clean == "localhost" || strings.HasSuffix(clean, ".localhost") || clean == "metadata.google.internal" {
		return true
	}
	if ip := net.ParseIP(clean); ip != nil {
		return isForbiddenIP(ip)
	}
	return false
}

// newSSRFSafeHTTPClient constructs an http.Client with strict DNS and IP boundary enforcement.
func newSSRFSafeHTTPClient() *http.Client {
	dialer := &net.Dialer{
		Timeout:   10 * time.Second,
		KeepAlive: 10 * time.Second,
	}

	transport := &http.Transport{
		Proxy: nil, // Prevent routing through untrusted environment proxy
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(addr)
			if err != nil {
				return nil, fmt.Errorf("invalid address: %w", err)
			}

			if isForbiddenHost(host) {
				return nil, fmt.Errorf("SSRF protection: access to restricted host %q is forbidden", host)
			}

			ips, err := net.DefaultResolver.LookupIP(ctx, "ip", host)
			if err != nil {
				return nil, fmt.Errorf("SSRF protection: DNS lookup failed for %s: %w", host, err)
			}
			if len(ips) == 0 {
				return nil, fmt.Errorf("SSRF protection: no IP addresses found for host %s", host)
			}

			for _, ip := range ips {
				if isForbiddenIP(ip) {
					return nil, fmt.Errorf("SSRF protection: connection to %s (%s) is forbidden", host, ip.String())
				}
			}

			// Dial the first verified safe IP explicitly to prevent DNS rebinding TOCTOU
			safeAddr := net.JoinHostPort(ips[0].String(), port)
			return dialer.DialContext(ctx, network, safeAddr)
		},
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          10,
		IdleConnTimeout:       30 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}

	return &http.Client{
		Transport: transport,
		Timeout:   15 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return fmt.Errorf("too many redirects")
			}
			if req.URL.Scheme != "http" && req.URL.Scheme != "https" {
				return fmt.Errorf("invalid redirect scheme: %s", req.URL.Scheme)
			}
			redirectHost := req.URL.Hostname()
			if isForbiddenHost(redirectHost) {
				return fmt.Errorf("SSRF protection: redirect to forbidden host %q", redirectHost)
			}
			ips, err := net.LookupIP(redirectHost)
			if err != nil {
				return fmt.Errorf("SSRF protection: redirect DNS resolution failed: %w", err)
			}
			for _, ip := range ips {
				if isForbiddenIP(ip) {
					return fmt.Errorf("SSRF protection: redirect resolves to forbidden IP %s", ip.String())
				}
			}
			return nil
		},
	}
}

// calendarFeedProxyHandler handles GET /v1/calendar/feed-proxy?url=...
func calendarFeedProxyHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Authenticated endpoint: require valid session or bearer token
	_, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "Unauthorized", http.StatusUnauthorized)
		return
	}

	rawURL := strings.TrimSpace(r.URL.Query().Get("url"))
	if rawURL == "" {
		http.Error(w, "Missing required 'url' parameter", http.StatusBadRequest)
		return
	}

	// Normalize webcal:// URLs to https://
	if strings.HasPrefix(rawURL, "webcal://") {
		rawURL = "https://" + strings.TrimPrefix(rawURL, "webcal://")
	}

	targetURL, err := url.Parse(rawURL)
	if err != nil {
		http.Error(w, "Invalid feed URL format", http.StatusBadRequest)
		return
	}

	// Strictly permit only http and https protocols
	if targetURL.Scheme != "http" && targetURL.Scheme != "https" {
		http.Error(w, "Invalid scheme: only http, https, and webcal subscription URLs are permitted", http.StatusBadRequest)
		return
	}

	targetHost := targetURL.Hostname()
	if targetHost == "" {
		http.Error(w, "Missing host in feed URL", http.StatusBadRequest)
		return
	}

	// Upfront SSRF Hostname & IP rejection
	if isForbiddenHost(targetHost) {
		http.Error(w, "SSRF protection: access to private, loopback, or cloud metadata addresses is forbidden", http.StatusForbidden)
		return
	}

	resolvedIPs, err := net.LookupIP(targetHost)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to resolve host %q: %v", targetHost, err), http.StatusBadRequest)
		return
	}
	if len(resolvedIPs) == 0 {
		http.Error(w, fmt.Sprintf("No IP addresses found for host %q", targetHost), http.StatusBadRequest)
		return
	}
	for _, ip := range resolvedIPs {
		if isForbiddenIP(ip) {
			http.Error(w, "SSRF protection: host resolves to private, loopback, or cloud metadata address", http.StatusForbidden)
			return
		}
	}

	client := newSSRFSafeHTTPClient()
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, targetURL.String(), nil)
	if err != nil {
		http.Error(w, "Failed to create upstream request", http.StatusInternalServerError)
		return
	}
	req.Header.Set("User-Agent", "BYOS-Calendar-Feed-Proxy/1.0 (Zero-Knowledge Calendar Subscription)")
	req.Header.Set("Accept", "text/calendar, text/plain, */*")

	resp, err := client.Do(req)
	if err != nil {
		if strings.Contains(err.Error(), "SSRF protection") {
			http.Error(w, err.Error(), http.StatusForbidden)
			return
		}
		http.Error(w, fmt.Sprintf("Failed to fetch external calendar feed: %v", err), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 400 {
		http.Error(w, fmt.Sprintf("External calendar server responded with HTTP %d", resp.StatusCode), http.StatusBadGateway)
		return
	}

	// Check Content-Length header against 5MB maximum response size limit
	if resp.ContentLength > maxFeedResponseBytes {
		http.Error(w, "External calendar feed exceeds maximum allowed size of 5MB", http.StatusBadGateway)
		return
	}

	// Read upstream body with 5MB + 1 byte limit reader to catch chunked responses exceeding 5MB
	bodyBytes, err := io.ReadAll(io.LimitReader(resp.Body, maxFeedResponseBytes+1))
	if err != nil {
		http.Error(w, "Failed to read external feed response body", http.StatusBadGateway)
		return
	}
	if int64(len(bodyBytes)) > maxFeedResponseBytes {
		http.Error(w, "External calendar feed exceeds maximum allowed size of 5MB", http.StatusBadGateway)
		return
	}

	w.Header().Set("Content-Type", "text/calendar; charset=utf-8")
	w.Header().Set("Cache-Control", "private, no-cache, no-store, must-revalidate")
	w.WriteHeader(http.StatusOK)
	w.Write(bodyBytes)
}
