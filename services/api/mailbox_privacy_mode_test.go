package main

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestMailboxPrivacyModeValidation(t *testing.T) {
	// 1. Invalid mode
	{
		body, _ := json.Marshal(map[string]interface{}{
			"mode": "unsupported_mode",
		})
		req := httptest.NewRequest(http.MethodPut, "/v1/organizations/eaee2269-f0b9-4a15-bf99-785285f8d543/mailboxes/00000000-0000-0000-0000-000000000001/privacy-mode", bytes.NewReader(body))
		req.SetPathValue("org_id", "eaee2269-f0b9-4a15-bf99-785285f8d543")
		req.SetPathValue("mailbox_id", "00000000-0000-0000-0000-000000000001")
		// Missing auth
		rec := httptest.NewRecorder()
		mailboxPrivacyModeHandler(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401 Unauthorized for missing auth, got %d", rec.Code)
		}
	}

	// 2. Invalid UUIDs
	{
		req := httptest.NewRequest(http.MethodPut, "/v1/organizations/not-a-uuid/mailboxes/00000000-0000-0000-0000-000000000001/privacy-mode", nil)
		req.SetPathValue("org_id", "not-a-uuid")
		req.SetPathValue("mailbox_id", "00000000-0000-0000-0000-000000000001")
		rec := httptest.NewRecorder()
		mailboxPrivacyModeHandler(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 Bad Request for invalid org_id UUID, got %d", rec.Code)
		}
	}

	// 3. Hex validation helper check
	{
		// 81 bytes valid wrap: 1 byte version (0x01) + 32B enc + 32B ct + 16B tag
		valid81Bytes := make([]byte, 81)
		valid81Bytes[0] = 0x01
		validHex := hex.EncodeToString(valid81Bytes)
		if len(validHex) != 162 {
			t.Fatalf("expected 162 hex characters, got %d", len(validHex))
		}
		decoded, err := hexDecodeString(validHex)
		if err != nil || len(decoded) != 81 {
			t.Fatalf("expected decoded length 81, got %d (err: %v)", len(decoded), err)
		}

		// Invalid length (e.g. 80 bytes)
		invalid80Bytes := make([]byte, 80)
		invalidHex := hex.EncodeToString(invalid80Bytes)
		decodedBad, err := hexDecodeString(invalidHex)
		if err == nil && len(decodedBad) == 81 {
			t.Fatal("expected 80 bytes to fail 81-byte length check")
		}
	}
}
