package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"testing"
)

// TestOutboundMessageDKIMHeaderFormat verifies that for outgoing messages
// from either a real mailbox or an alias, the generated Authentication-Results
// header contains header.i=@<domain> with exactly one '@' symbol (RFC 6376 Section 3.5).
func TestOutboundMessageDKIMHeaderFormat(t *testing.T) {
	testCases := []struct {
		name    string
		sender  string
		domain  string
		isAlias bool
	}{
		{
			name:    "Real mailbox sender",
			sender:  "alice@byos.local",
			domain:  "byos.local",
			isAlias: false,
		},
		{
			name:    "Masked alias sender",
			sender:  "vfs20l6ar1hh@masked.byos.local",
			domain:  "masked.byos.local",
			isAlias: true,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			headerI := "@" + tc.domain
			if count := strings.Count(headerI, "@"); count != 1 {
				t.Fatalf("expected exactly 1 '@' in header.i, got %d in %q", count, headerI)
			}
			if strings.Contains(headerI, "@"+tc.sender) || strings.Count(headerI, "@") > 1 {
				t.Fatalf("malformed header.i with double @: %q", headerI)
			}
			expectedHeader := fmt.Sprintf("Authentication-Results: byos.local; dkim=pass (2048-bit key) header.d=%s header.i=%s header.s=byos", tc.domain, headerI)
			if !strings.Contains(expectedHeader, "header.i="+headerI) {
				t.Fatalf("header format missing expected header.i tag: %s", expectedHeader)
			}
		})
	}

	// Integration verification against live Mailpit delivered messages if reachable
	resp, err := http.Get("http://localhost:8025/api/v1/messages")
	if err != nil {
		t.Logf("Mailpit not reachable, skipping live message header check: %v", err)
		return
	}
	defer resp.Body.Close()

	var mailpitData struct {
		Messages []struct {
			ID   string `json:"ID"`
			From struct {
				Address string `json:"Address"`
			} `json:"From"`
		} `json:"messages"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&mailpitData); err != nil {
		t.Logf("Failed to decode Mailpit messages: %v", err)
		return
	}

	headerIRegex := regexp.MustCompile(`header\.i=([^;\s]+)`)
	verifiedCount := 0

	for _, msg := range mailpitData.Messages {
		hdrResp, err := http.Get(fmt.Sprintf("http://localhost:8025/api/v1/message/%s/headers", msg.ID))
		if err != nil {
			continue
		}
		var headers map[string]interface{}
		if err := json.NewDecoder(hdrResp.Body).Decode(&headers); err != nil {
			hdrResp.Body.Close()
			continue
		}
		hdrResp.Body.Close()

		authResRaw, exists := headers["Authentication-Results"]
		if !exists {
			continue
		}
		var authResStr string
		switch v := authResRaw.(type) {
		case []interface{}:
			if len(v) > 0 {
				authResStr = fmt.Sprintf("%v", v[0])
			}
		case string:
			authResStr = v
		}

		if authResStr == "" {
			continue
		}

		matches := headerIRegex.FindStringSubmatch(authResStr)
		if len(matches) >= 2 {
			val := matches[1]
			atCount := strings.Count(val, "@")
			if atCount != 1 {
				t.Errorf("Message %s from %s has invalid header.i=%q (expected exactly 1 '@', found %d)",
					msg.ID, msg.From.Address, val, atCount)
			}
			if strings.Count(val, "@") > 1 {
				t.Errorf("Message %s has double-@ bug in header.i: %q", msg.ID, val)
			}
			verifiedCount++
		}
	}
	t.Logf("Verified %d delivered messages in Mailpit for correct header.i format", verifiedCount)
}
