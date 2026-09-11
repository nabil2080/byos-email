package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestBridgeOutboundSend_UnauthorizedNoToken(t *testing.T) {
	reqBody := map[string]string{
		"mailbox_id":  "a0000000-0000-0000-0000-000000000001",
		"recipient":   "user@example.com",
		"raw_message": base64.StdEncoding.EncodeToString([]byte("test")),
	}
	b, _ := json.Marshal(reqBody)
	req := httptest.NewRequest(http.MethodPost, "/v1/bridge/outbound/send", bytes.NewReader(b))
	rec := httptest.NewRecorder()

	bridgeOutboundSendHandler(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized, got %d", rec.Code)
	}
}

func TestBridgeOutboundSend_InvalidUUID(t *testing.T) {
	reqBody := map[string]string{
		"mailbox_id":  "not-a-uuid",
		"recipient":   "user@example.com",
		"raw_message": base64.StdEncoding.EncodeToString([]byte("test")),
	}
	b, _ := json.Marshal(reqBody)
	req := httptest.NewRequest(http.MethodPost, "/v1/bridge/outbound/send", bytes.NewReader(b))
	req.Header.Set("X-BYOS-Bridge-Token", "some-token")
	rec := httptest.NewRecorder()

	bridgeOutboundSendHandler(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request for invalid UUID, got %d", rec.Code)
	}
}

func TestBridgeOutboundSend_InvalidBase64(t *testing.T) {
	reqBody := map[string]string{
		"mailbox_id":  "a0000000-0000-0000-0000-000000000001",
		"recipient":   "user@example.com",
		"raw_message": "not-valid-base64!@#$%",
	}
	b, _ := json.Marshal(reqBody)
	req := httptest.NewRequest(http.MethodPost, "/v1/bridge/outbound/send", bytes.NewReader(b))
	req.Header.Set("X-BYOS-Bridge-Token", "some-token")
	rec := httptest.NewRecorder()

	bridgeOutboundSendHandler(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request for invalid base64, got %d", rec.Code)
	}
}

func TestBridgeOutboundSend_InvalidRecipientInjection(t *testing.T) {
	reqBody := map[string]string{
		"mailbox_id":  "a0000000-0000-0000-0000-000000000001",
		"recipient":   "victim@example.com\r\nbcc: evil@attacker.com",
		"raw_message": base64.StdEncoding.EncodeToString([]byte("test")),
	}
	b, _ := json.Marshal(reqBody)
	req := httptest.NewRequest(http.MethodPost, "/v1/bridge/outbound/send", bytes.NewReader(b))
	req.Header.Set("X-BYOS-Bridge-Token", "some-token")
	rec := httptest.NewRecorder()

	bridgeOutboundSendHandler(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request for injected recipient, got %d", rec.Code)
	}
}

func TestBridgeOutboundSend_RecipientCeilingExceeded(t *testing.T) {
	var recs []string
	for i := 0; i < 51; i++ {
		recs = append(recs, "user"+strings.Repeat("a", i%5)+"@example.com")
	}
	reqBody := map[string]string{
		"mailbox_id":  "a0000000-0000-0000-0000-000000000001",
		"recipient":   strings.Join(recs, ","),
		"raw_message": base64.StdEncoding.EncodeToString([]byte("test")),
	}
	b, _ := json.Marshal(reqBody)
	req := httptest.NewRequest(http.MethodPost, "/v1/bridge/outbound/send", bytes.NewReader(b))
	req.Header.Set("X-BYOS-Bridge-Token", "some-token")
	rec := httptest.NewRecorder()

	bridgeOutboundSendHandler(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request for >50 recipients ceiling, got %d", rec.Code)
	}
}
