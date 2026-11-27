package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/emersion/go-smtp"
)

func TestNormalizeSMTPAddress(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"<alice@byos.local>", "alice@byos.local"},
		{"  Bob@EXAMPLE.com  ", "bob@example.com"},
		{"<Carol@Domain.Org> ", "carol@domain.org"},
		{"", ""},
	}

	for _, tc := range tests {
		got := normalizeSMTPAddress(tc.input)
		if got != tc.expected {
			t.Errorf("normalizeSMTPAddress(%q) = %q; want %q", tc.input, got, tc.expected)
		}
	}
}

func TestIsExpectedInternalKey(t *testing.T) {
	if !isExpectedInternalKey("secret123", "secret123") {
		t.Errorf("expected matching keys to return true")
	}
	if isExpectedInternalKey("secret123", "wrongkey") {
		t.Errorf("expected mismatched keys to return false")
	}
	if isExpectedInternalKey("", "secret123") || isExpectedInternalKey("secret123", "") {
		t.Errorf("expected empty keys to return false")
	}
}

func TestSessionRcptVerify_AcceptValid(t *testing.T) {
	mockRouter := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/recipients/verify" {
			http.NotFound(w, r)
			return
		}
		if r.URL.Query().Get("recipient") == "alice@byos.local" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]any{"valid": true, "type": "mailbox"})
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]any{"valid": false, "error": "unknown"})
	}))
	defer mockRouter.Close()

	app := &App{
		cfg: Config{
			RouterURL: mockRouter.URL,
		},
		httpClient: mockRouter.Client(),
	}

	session := &Session{app: app}
	err := session.Rcpt("alice@byos.local", nil)
	if err != nil {
		t.Fatalf("expected Rcpt to succeed for valid recipient, got: %v", err)
	}
	if len(session.to) != 1 || session.to[0] != "alice@byos.local" {
		t.Fatalf("unexpected recipients in session: %v", session.to)
	}
}

func TestSessionRcptVerify_RejectUnknown(t *testing.T) {
	mockRouter := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]any{"valid": false, "error": "unknown"})
	}))
	defer mockRouter.Close()

	app := &App{
		cfg: Config{
			RouterURL: mockRouter.URL,
		},
		httpClient: mockRouter.Client(),
	}

	session := &Session{app: app}
	err := session.Rcpt("nonexistent@byos.local", nil)
	if err == nil {
		t.Fatalf("expected Rcpt to fail for unknown recipient, got nil")
	}

	smtpErr, ok := err.(*smtp.SMTPError)
	if !ok {
		t.Fatalf("expected *smtp.SMTPError, got %T: %v", err, err)
	}
	if smtpErr.Code != 550 {
		t.Fatalf("expected SMTP error code 550, got %d (%s)", smtpErr.Code, smtpErr.Message)
	}
}

func TestSessionRcptVerify_TemporaryFailure(t *testing.T) {
	mockRouter := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer mockRouter.Close()

	app := &App{
		cfg: Config{
			RouterURL: mockRouter.URL,
		},
		httpClient: mockRouter.Client(),
	}

	session := &Session{app: app}
	err := session.Rcpt("alice@byos.local", nil)
	if err == nil {
		t.Fatalf("expected Rcpt to fail for router server error, got nil")
	}

	smtpErr, ok := err.(*smtp.SMTPError)
	if !ok {
		t.Fatalf("expected *smtp.SMTPError, got %T: %v", err, err)
	}
	if smtpErr.Code != 451 {
		t.Fatalf("expected SMTP error code 451, got %d (%s)", smtpErr.Code, smtpErr.Message)
	}
}

func TestSessionData_NoRecipients(t *testing.T) {
	app := &App{
		cfg:        Config{},
		httpClient: &http.Client{},
	}
	session := &Session{app: app}
	err := session.Data(bytes.NewReader([]byte("Subject: test\r\n\r\nbody")))
	if err == nil {
		t.Fatalf("expected error for empty recipients")
	}
	smtpErr, ok := err.(*smtp.SMTPError)
	if !ok || smtpErr.Code != 554 {
		t.Fatalf("expected SMTP error 554, got %v", err)
	}
}

// ----------------------------------------------------------------------------
// Phase 4 Matrix Tests
// ----------------------------------------------------------------------------

// Situation 1: Unknown or permanently invalid recipient -> 550
func TestPhase4_VerifyMatrix_UnknownRecipient_550(t *testing.T) {
	mockRouter := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		json.NewEncoder(w).Encode(map[string]any{"valid": false, "error": "user unknown"})
	}))
	defer mockRouter.Close()

	app := &App{
		cfg:        Config{RouterURL: mockRouter.URL},
		httpClient: mockRouter.Client(),
	}
	session := &Session{app: app}
	err := session.Rcpt("nobody@byos.local", nil)
	if err == nil {
		t.Fatalf("expected error for unknown recipient, got nil")
	}
	smtpErr, ok := err.(*smtp.SMTPError)
	if !ok || smtpErr.Code != 550 {
		t.Fatalf("expected SMTP 550, got %v", err)
	}
}

// Situation 2: Valid recipient -> Accept RCPT
func TestPhase4_VerifyMatrix_ValidRecipient_Accept(t *testing.T) {
	mockRouter := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]any{"valid": true, "type": "mailbox"})
	}))
	defer mockRouter.Close()

	app := &App{
		cfg:        Config{RouterURL: mockRouter.URL},
		httpClient: mockRouter.Client(),
	}
	session := &Session{app: app}
	err := session.Rcpt("alice@byos.local", nil)
	if err != nil {
		t.Fatalf("expected Rcpt to accept valid recipient, got: %v", err)
	}
	if len(session.to) != 1 || session.to[0] != "alice@byos.local" {
		t.Fatalf("expected recipient in session.to, got: %v", session.to)
	}
}

// Situation 3: Verification service temporarily unavailable -> 451
func TestPhase4_VerifyMatrix_ServiceUnavailable_451(t *testing.T) {
	mockRouter := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer mockRouter.Close()

	app := &App{
		cfg:        Config{RouterURL: mockRouter.URL},
		httpClient: mockRouter.Client(),
	}
	session := &Session{app: app}
	err := session.Rcpt("alice@byos.local", nil)
	if err == nil {
		t.Fatalf("expected error for unavailable service, got nil")
	}
	smtpErr, ok := err.(*smtp.SMTPError)
	if !ok || smtpErr.Code != 451 {
		t.Fatalf("expected SMTP 451 for service unavailable, got %v", err)
	}
}

// Situation 4: Internal authentication failure -> Fail safely without treating legitimate recipient as 550
func TestPhase4_VerifyMatrix_InternalAuthFailure_451(t *testing.T) {
	mockRouter := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Simulates 403 Forbidden due to invalid or missing X-Internal-Key
		w.WriteHeader(http.StatusForbidden)
	}))
	defer mockRouter.Close()

	app := &App{
		cfg:        Config{RouterURL: mockRouter.URL},
		httpClient: mockRouter.Client(),
	}
	session := &Session{app: app}
	err := session.Rcpt("alice@byos.local", nil)
	if err == nil {
		t.Fatalf("expected error for internal auth failure, got nil")
	}
	smtpErr, ok := err.(*smtp.SMTPError)
	if !ok {
		t.Fatalf("expected *smtp.SMTPError, got %T: %v", err, err)
	}
	if smtpErr.Code == 550 {
		t.Fatalf("CRITICAL SECURITY DEFECT: auth failure treated as permanent 550 rejection!")
	}
	if smtpErr.Code != 451 {
		t.Fatalf("expected SMTP 451 for internal auth failure, got %d (%s)", smtpErr.Code, smtpErr.Message)
	}
}

// Situation 5: Invalid internal request -> Reject safely and log appropriately
func TestPhase4_VerifyMatrix_InvalidInternalRequest_SafeReject(t *testing.T) {
	mockRouter := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Simulates 400 Bad Request
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer mockRouter.Close()

	app := &App{
		cfg:        Config{RouterURL: mockRouter.URL},
		httpClient: mockRouter.Client(),
	}
	session := &Session{app: app}

	// Case A: empty recipient string rejected as SMTP 501 syntax error per RFC 5321 §4.1.2
	errEmpty := session.Rcpt("", nil)
	if errEmpty == nil {
		t.Fatalf("expected error for empty recipient")
	}
	smtpErrEmpty, ok := errEmpty.(*smtp.SMTPError)
	if !ok || smtpErrEmpty.Code != 501 {
		t.Fatalf("expected SMTP 501 for empty recipient, got %v", errEmpty)
	}

	// Case B: router returns 400 Bad Request -> safely handled as 451 temporary failure
	errBadReq := session.Rcpt("malformed@address.local", nil)
	if errBadReq == nil {
		t.Fatalf("expected error for bad request")
	}
	smtpErrBadReq, ok := errBadReq.(*smtp.SMTPError)
	if !ok || smtpErrBadReq.Code != 451 {
		t.Fatalf("expected SMTP 451 for router 400 Bad Request, got %v", errBadReq)
	}
}

// Phase 4: Comprehensive Syntactic Syntax Rejections (SMTP 501 / RFC 5321 §4.1.2)
func TestPhase4_VerifyMatrix_SyntacticallyInvalid_501(t *testing.T) {
	app := &App{
		cfg: Config{RouterURL: "http://127.0.0.1:9999"},
	}
	session := &Session{app: app}

	invalidAddresses := []struct {
		input       string
		description string
	}{
		{"", "empty string"},
		{"<>", "empty angle brackets"},
		{"   ", "whitespace only"},
		{"notanemail", "missing @"},
		{"user@domain@extra.com", "multiple @ characters"},
		{"@domain.com", "missing local-part"},
		{"user@", "missing domain"},
		{"user@.domain.com", "domain starting with dot"},
		{"user@-domain.com", "domain starting with hyphen"},
		{"user@domain.com.", "domain ending with dot"},
		{"user space@domain.com", "space in address"},
		{"user\n@domain.com", "newline in address"},
		{"user\t@domain.com", "tab in address"},
		{string(bytes.Repeat([]byte("a"), 65)) + "@domain.com", "local-part > 64 octets"},
		{"user@" + string(bytes.Repeat([]byte("a"), 256)) + ".com", "domain > 255 octets"},
	}

	for _, tc := range invalidAddresses {
		err := session.Rcpt(tc.input, nil)
		if err == nil {
			t.Errorf("expected SMTP 501 syntax error for %s (%q), got nil", tc.description, tc.input)
			continue
		}
		smtpErr, ok := err.(*smtp.SMTPError)
		if !ok || smtpErr.Code != 501 {
			t.Errorf("expected SMTP 501 for %s (%q), got: %v", tc.description, tc.input, err)
		}
	}
}
