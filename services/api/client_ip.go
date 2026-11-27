package main

import (
	"fmt"
	"net"
	"net/http"
	"os"
	"strings"
)

// ParseTrustedProxies parses a comma-separated list of CIDR subnets or IP addresses.
// Single IP addresses are automatically expanded to /32 (IPv4) or /128 (IPv6) subnets.
func ParseTrustedProxies(spec string) ([]*net.IPNet, error) {
	tokens := strings.Split(spec, ",")
	var nets []*net.IPNet
	for _, raw := range tokens {
		item := strings.TrimSpace(raw)
		if item == "" {
			continue
		}
		if strings.Contains(item, "/") {
			_, ipNet, err := net.ParseCIDR(item)
			if err != nil {
				return nil, fmt.Errorf("invalid CIDR %q: %w", item, err)
			}
			nets = append(nets, ipNet)
		} else {
			ip := net.ParseIP(item)
			if ip == nil {
				return nil, fmt.Errorf("invalid IP address %q", item)
			}
			if ip.To4() != nil {
				_, ipNet, _ := net.ParseCIDR(item + "/32")
				nets = append(nets, ipNet)
			} else {
				_, ipNet, _ := net.ParseCIDR(item + "/128")
				nets = append(nets, ipNet)
			}
		}
	}
	return nets, nil
}

// isIPInNets reports whether ip belongs to any subnet in nets.
func isIPInNets(ip net.IP, nets []*net.IPNet) bool {
	for _, n := range nets {
		if n.Contains(ip) {
			return true
		}
	}
	return false
}

// GetClientIP resolves the authentic client IP address using right-to-left
// untrusted-hop selection over configured trusted reverse proxies.
//
// Rules:
// 1. If BYOS_TRUSTED_PROXIES is not set or empty, NO proxy is trusted;
//    forwarded headers are ignored and the immediate peer IP is returned.
// 2. If the immediate peer (r.RemoteAddr) is not within the trusted proxy CIDRs,
//    all forwarded headers (X-Forwarded-For) are ignored and immediate peer IP is returned.
// 3. If immediate peer is trusted, X-Forwarded-For is parsed from right to left.
//    Trusted intermediary proxies are skipped. The first untrusted IP encountered is returned.
// 4. If no untrusted client address can be established (e.g., all forwarded hops are trusted
//    or X-Forwarded-For contains no valid IP addresses), fall back to the actual socket peer.
func GetClientIP(r *http.Request) string {
	if r == nil {
		return "127.0.0.1"
	}

	peerStr := parseIPHost(r.RemoteAddr)
	peerIP := net.ParseIP(peerStr)
	if peerIP == nil {
		return "127.0.0.1"
	}

	trustedSpec := strings.TrimSpace(os.Getenv("BYOS_TRUSTED_PROXIES"))
	if trustedSpec == "" {
		// No proxies are trusted; ignore all forwarded headers
		return peerIP.String()
	}

	trustedNets, err := ParseTrustedProxies(trustedSpec)
	if err != nil || len(trustedNets) == 0 {
		return peerIP.String()
	}

	// Verify immediate connecting peer is a trusted proxy
	if !isIPInNets(peerIP, trustedNets) {
		return peerIP.String()
	}

	// Immediate peer is trusted; parse X-Forwarded-For
	xff := r.Header.Get("X-Forwarded-For")
	if strings.TrimSpace(xff) == "" {
		return peerIP.String()
	}

	parts := strings.Split(xff, ",")
	var validHops []net.IP
	for _, p := range parts {
		clean := parseIPHost(p)
		if ip := net.ParseIP(clean); ip != nil {
			validHops = append(validHops, ip)
		}
	}

	if len(validHops) == 0 {
		return peerIP.String()
	}

	// Walk right-to-left: the first untrusted IP from the right is the true client IP
	for i := len(validHops) - 1; i >= 0; i-- {
		hop := validHops[i]
		if !isIPInNets(hop, trustedNets) {
			return hop.String()
		}
	}

	// If all hops in X-Forwarded-For are trusted proxies (no untrusted client address established),
	// fall back to the actual socket peer.
	return peerIP.String()
}
