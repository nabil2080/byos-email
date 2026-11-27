package main

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	netSmtp "net/smtp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/emersion/go-smtp"
)

// In-memory simulation of mail-router storage & database state for SMTP protocol testing
type mockRouterState struct {
	mu sync.Mutex

	// Controllable failure flags
	failRecipientB   bool
	failBeforeAny    bool
	failAfterAll     bool
	failStorage      bool
	failDatabaseTx   bool

	// Persisted state
	recipientMessages map[string][]string // recipient -> list of message IDs
	deliveryIdentities map[string]string   // delivery_identity -> recipient
	storageObjects    map[string][]byte   // storage_key -> payload bytes
}

func newMockRouterState() *mockRouterState {
	return &mockRouterState{
		recipientMessages:  make(map[string][]string),
		deliveryIdentities: make(map[string]string),
		storageObjects:     make(map[string][]byte),
	}
}

func (s *mockRouterState) handleInbound(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req InboundRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid request body", http.StatusBadRequest)
		return
	}

	rawMsg, err := base64.StdEncoding.DecodeString(req.RawMessageB64)
	if err != nil {
		http.Error(w, "invalid raw message base64", http.StatusBadRequest)
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if s.failBeforeAny {
		http.Error(w, "503 service unavailable (pre-persistence failure)", http.StatusServiceUnavailable)
		return
	}

	if s.failStorage {
		http.Error(w, "503 object storage unreachable", http.StatusServiceUnavailable)
		return
	}

	if s.failDatabaseTx {
		http.Error(w, "500 database transaction serialization failure", http.StatusInternalServerError)
		return
	}

	// Deterministic storage key based on raw content hash
	storageHash := sha256.Sum256(rawMsg)
	storageKey := fmt.Sprintf("objects/%s.eml.enc", hex.EncodeToString(storageHash[:16]))
	if _, exists := s.storageObjects[storageKey]; !exists {
		s.storageObjects[storageKey] = rawMsg
	}

	var firstErr error

	for _, rcpt := range req.Recipients {
		norm := strings.ToLower(strings.TrimSpace(rcpt))

		// Check failure injection for Recipient B
		if s.failRecipientB && strings.HasPrefix(norm, "recipientb@") {
			firstErr = fmt.Errorf("simulated temporary failure for %s", norm)
			continue
		}

		// Compute deterministic delivery identity: SHA-256(sender + norm + storageKey)
		idHash := sha256.Sum256([]byte(req.EnvelopeFrom + ":" + norm + ":" + storageKey))
		delId := hex.EncodeToString(idHash[:])

		if _, exists := s.deliveryIdentities[delId]; exists {
			// Deduplicated! Already committed for this delivery identity
			continue
		}

		// Commit recipient record
		s.deliveryIdentities[delId] = norm
		s.recipientMessages[norm] = append(s.recipientMessages[norm], storageKey)
	}

	if firstErr != nil {
		// Partial failure returns 502/503 forcing inbound-bridge to return SMTP 451
		http.Error(w, fmt.Sprintf("502 partial delivery failure: %v", firstErr), http.StatusBadGateway)
		return
	}

	if s.failAfterAll {
		// Failure after all recipients persisted but before returning 200
		http.Error(w, "500 internal server error after commits", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]any{"status": "delivered", "recipients": len(req.Recipients)})
}

// TestPhase3_CompleteSMTPRetry_And_PartialDeliveryVerification tests the real wire protocol
// across SMTP DATA -> inbound-bridge -> mail-router -> per-recipient persistence -> retry.
func TestPhase3_CompleteSMTPRetry_And_PartialDeliveryVerification(t *testing.T) {
	routerState := newMockRouterState()

	mockRouter := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/recipients/verify":
			rcpt := r.URL.Query().Get("recipient")
			if strings.HasPrefix(rcpt, "unknown@") {
				http.Error(w, "not found", http.StatusNotFound)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(map[string]any{"valid": true})
		case "/v1/inbound":
			routerState.handleInbound(w, r)
		default:
			http.NotFound(w, r)
		}
	}))
	defer mockRouter.Close()

	// Helper to start an inbound-bridge SMTP server on a random local port
	startBridgeServer := func() (*smtp.Server, net.Listener, string) {
		app := &App{
			cfg: Config{
				RouterURL: mockRouter.URL,
			},
			httpClient: mockRouter.Client(),
		}
		be := &Backend{app: app}
		srv := smtp.NewServer(be)
		srv.Domain = "byos.local"
		srv.ReadTimeout = 10 * time.Second
		srv.WriteTimeout = 10 * time.Second
		srv.MaxMessageBytes = 10 * 1024 * 1024
		srv.MaxRecipients = 50

		l, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatalf("failed to listen: %v", err)
		}
		go func() { _ = srv.Serve(l) }()
		return srv, l, l.Addr().String()
	}

	sendMsgOverSMTP := func(addr string, from string, to []string, body []byte) error {
		client, err := netSmtp.Dial(addr)
		if err != nil {
			return fmt.Errorf("dial: %w", err)
		}
		defer client.Close()

		if err := client.Mail(from); err != nil {
			return fmt.Errorf("mail: %w", err)
		}
		for _, rcpt := range to {
			if err := client.Rcpt(rcpt); err != nil {
				return fmt.Errorf("rcpt %s: %w", rcpt, err)
			}
		}
		wc, err := client.Data()
		if err != nil {
			return fmt.Errorf("data: %w", err)
		}
		if _, err := wc.Write(body); err != nil {
			return fmt.Errorf("write: %w", err)
		}
		if err := wc.Close(); err != nil {
			return fmt.Errorf("data close: %w", err)
		}
		return client.Quit()
	}

	msgBody := []byte("Message-ID: <multi-rcpt-c62-12345@external.net>\r\n" +
		"From: sender@external.net\r\n" +
		"To: recipientA@byos.local, recipientB@byos.local\r\n" +
		"Subject: Important Test\r\n\r\n" +
		"This is an end-to-end SMTP delivery test payload.")

	recipients := []string{"recipientA@byos.local", "recipientB@byos.local"}

	// --- SCENARIO 1-4: Submit message; Recipient A succeeds, Recipient B fails -> SMTP client gets 451 ---
	srv1, l1, addr1 := startBridgeServer()
	defer srv1.Close()

	routerState.failRecipientB = true // Force partial failure on B

	errAttempt1 := sendMsgOverSMTP(addr1, "sender@external.net", recipients, msgBody)
	if errAttempt1 == nil {
		t.Fatalf("expected SMTP error on attempt 1 with partial failure, got nil")
	}
	if !strings.Contains(errAttempt1.Error(), "451") {
		t.Fatalf("expected SMTP 451 temporary failure, got: %v", errAttempt1)
	}

	routerState.mu.Lock()
	countA1 := len(routerState.recipientMessages["recipienta@byos.local"])
	countB1 := len(routerState.recipientMessages["recipientb@byos.local"])
	storageCount1 := len(routerState.storageObjects)
	routerState.mu.Unlock()

	if countA1 != 1 {
		t.Fatalf("expected recipient A to have 1 persisted record, got %d", countA1)
	}
	if countB1 != 0 {
		t.Fatalf("expected recipient B to have 0 persisted records, got %d", countB1)
	}
	if storageCount1 != 1 {
		t.Fatalf("expected 1 storage object, got %d", storageCount1)
	}

	// --- SCENARIO 10: Restart relevant service between attempts ---
	srv1.Close()
	l1.Close()

	srv2, l2, addr2 := startBridgeServer()
	defer srv2.Close()
	defer l2.Close()

	// --- SCENARIO 5-9: Retry same message; Recipient B succeeds; Recipient A is deduplicated ---
	routerState.failRecipientB = false // Recipient B now succeeds

	errAttempt2 := sendMsgOverSMTP(addr2, "sender@external.net", recipients, msgBody)
	if errAttempt2 != nil {
		t.Fatalf("expected SMTP success on retry attempt 2, got: %v", errAttempt2)
	}

	routerState.mu.Lock()
	countA2 := len(routerState.recipientMessages["recipienta@byos.local"])
	countB2 := len(routerState.recipientMessages["recipientb@byos.local"])
	storageCount2 := len(routerState.storageObjects)
	routerState.mu.Unlock()

	if countA2 != 1 {
		t.Fatalf("DEDUPLICATION FAILURE: recipient A has %d messages, expected exactly 1", countA2)
	}
	if countB2 != 1 {
		t.Fatalf("DELIVERY FAILURE: recipient B has %d messages, expected exactly 1", countB2)
	}
	if storageCount2 != 1 {
		t.Fatalf("STORAGE DUPLICATION FAILURE: expected 1 storage object, got %d", storageCount2)
	}

	// --- ADDITIONAL TEST: Duplicate retry after a successful response ---
	errAttempt3 := sendMsgOverSMTP(addr2, "sender@external.net", recipients, msgBody)
	if errAttempt3 != nil {
		t.Fatalf("expected SMTP success on duplicate retry, got: %v", errAttempt3)
	}

	routerState.mu.Lock()
	countA3 := len(routerState.recipientMessages["recipienta@byos.local"])
	countB3 := len(routerState.recipientMessages["recipientb@byos.local"])
	storageCount3 := len(routerState.storageObjects)
	routerState.mu.Unlock()

	if countA3 != 1 || countB3 != 1 || storageCount3 != 1 {
		t.Fatalf("Idempotency violation after duplicate retry: A=%d, B=%d, storage=%d", countA3, countB3, storageCount3)
	}

	// --- ADDITIONAL TEST: Failure before any recipient is persisted ---
	routerState.failBeforeAny = true
	errBeforeAny := sendMsgOverSMTP(addr2, "sender@external.net", []string{"recipientC@byos.local"}, msgBody)
	if errBeforeAny == nil || !strings.Contains(errBeforeAny.Error(), "451") {
		t.Fatalf("expected SMTP 451 on failure before any recipient, got: %v", errBeforeAny)
	}
	routerState.failBeforeAny = false

	// --- ADDITIONAL TEST: Failure after all persisted but before HTTP 200 response ---
	routerState.failAfterAll = true
	errAfterAll := sendMsgOverSMTP(addr2, "sender@external.net", []string{"recipientD@byos.local"}, msgBody)
	if errAfterAll == nil || !strings.Contains(errAfterAll.Error(), "451") {
		t.Fatalf("expected SMTP 451 on failure after all persisted, got: %v", errAfterAll)
	}
	routerState.failAfterAll = false

	// Client retries recipientD:
	errRetryD := sendMsgOverSMTP(addr2, "sender@external.net", []string{"recipientD@byos.local"}, msgBody)
	if errRetryD != nil {
		t.Fatalf("expected SMTP success on retry after post-commit failure, got: %v", errRetryD)
	}
	routerState.mu.Lock()
	countD := len(routerState.recipientMessages["recipientd@byos.local"])
	routerState.mu.Unlock()
	if countD != 1 {
		t.Fatalf("expected recipient D to have exactly 1 record after retry, got %d", countD)
	}

	// --- ADDITIONAL TEST: Database transaction failure -> 451 ---
	routerState.failDatabaseTx = true
	errDbTx := sendMsgOverSMTP(addr2, "sender@external.net", []string{"recipientE@byos.local"}, msgBody)
	if errDbTx == nil || !strings.Contains(errDbTx.Error(), "451") {
		t.Fatalf("expected SMTP 451 on DB tx failure, got: %v", errDbTx)
	}
	routerState.failDatabaseTx = false

	// --- ADDITIONAL TEST: Object-storage failure -> 451 ---
	routerState.failStorage = true
	errStorage := sendMsgOverSMTP(addr2, "sender@external.net", []string{"recipientF@byos.local"}, msgBody)
	if errStorage == nil || !strings.Contains(errStorage.Error(), "451") {
		t.Fatalf("expected SMTP 451 on storage failure, got: %v", errStorage)
	}
	routerState.failStorage = false

	// --- ADDITIONAL TEST: Two concurrent retransmissions of the same logical message ---
	var wg sync.WaitGroup
	var errConc1, errConc2 error
	wg.Add(2)
	go func() {
		defer wg.Done()
		errConc1 = sendMsgOverSMTP(addr2, "sender@external.net", []string{"recipientG@byos.local"}, msgBody)
	}()
	go func() {
		defer wg.Done()
		errConc2 = sendMsgOverSMTP(addr2, "sender@external.net", []string{"recipientG@byos.local"}, msgBody)
	}()
	wg.Wait()

	if errConc1 != nil || errConc2 != nil {
		t.Fatalf("expected both concurrent deliveries to succeed, got: %v, %v", errConc1, errConc2)
	}
	routerState.mu.Lock()
	countG := len(routerState.recipientMessages["recipientg@byos.local"])
	routerState.mu.Unlock()
	if countG != 1 {
		t.Fatalf("CONCURRENCY DEDUPLICATION FAILURE: expected 1 record for recipient G, got %d", countG)
	}
}
