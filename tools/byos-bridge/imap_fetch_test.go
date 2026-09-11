package main

import (
	"bufio"
	"encoding/base64"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

// Section 19 IMAP protocol-honesty regression tests. All paths are driven
// over net.Pipe against handleIMAPConnection with an httptest mock API, so
// no database or live stack is required.

type imapTestServer struct {
	t      *testing.T
	client *bufio.Reader
	writer *bufio.Writer
	conn   net.Conn
}

func startIMAPTestSession(t *testing.T, cfg *BridgeConfig) *imapTestServer {
	t.Helper()
	clientConn, serverConn := net.Pipe()
	go handleIMAPConnection(serverConn, cfg)
	s := &imapTestServer{
		t:      t,
		client: bufio.NewReader(clientConn),
		writer: bufio.NewWriter(clientConn),
		conn:   clientConn,
	}
	t.Cleanup(func() { clientConn.Close() })
	// Consume greeting.
	line, err := s.client.ReadString('\n')
	if err != nil || !strings.HasPrefix(line, "* OK") {
		t.Fatalf("bad greeting: %q, %v", line, err)
	}
	return s
}

func (s *imapTestServer) cmd(format string, args ...interface{}) {
	s.t.Helper()
	line := format
	if len(args) > 0 {
		line = fmt.Sprintf(format, args...)
	}
	if _, err := s.writer.WriteString(line + "\r\n"); err != nil {
		s.t.Fatalf("write %q: %v", line, err)
	}
	if err := s.writer.Flush(); err != nil {
		s.t.Fatalf("flush: %v", err)
	}
}

func (s *imapTestServer) readLine() string {
	s.t.Helper()
	line, err := s.client.ReadString('\n')
	if err != nil {
		s.t.Fatalf("read: %v", err)
	}
	return strings.TrimRight(line, "\r\n")
}

func mockBridgeAPI(t *testing.T, messagesJSON, bodyB64 string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/v1/bridge/authenticate" && r.Method == http.MethodPost:
			w.WriteHeader(http.StatusNoContent)
		case strings.HasPrefix(r.URL.Path, "/v1/bridge/messages"):
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(messagesJSON))
		case strings.HasPrefix(r.URL.Path, "/v1/bridge/message-body"):
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"encrypted_body":"` + bodyB64 + `",` +
				`"content_key_hpke_wrapped":"AA==","encryption_iv":"AA==",` +
				`"aad_version":1,"bundle_hash":"AA==","encryption_version":1}`))
		default:
			http.NotFound(w, r)
		}
	}))
}

func loginTestSession(t *testing.T, s *imapTestServer, token string) {
	t.Helper()
	s.cmd("A LOGIN user %s", token)
	if got := s.readLine(); got != "A OK [CAPABILITY IMAP4rev1] LOGIN successful" {
		t.Fatalf("login failed: %q", got)
	}
}

// Unknown commands must be rejected, never fake-OK. Pre-auth, so no API
// dependency: ApiURL is unreachable and any API call would hang/fail.
func TestBridgeUnknownCommandRejected(t *testing.T) {
	cfg := &BridgeConfig{ApiURL: "http://127.0.0.1:1", MailboxID: "m", Token: "tok"}
	s := startIMAPTestSession(t, cfg)
	s.cmd("A UID FETCH 1 BODY[]")
	if got := s.readLine(); got != "A BAD unknown command" {
		t.Fatalf("UID FETCH: got %q", got)
	}
	s.cmd("B STORE 1 +FLAGS (\\Seen)")
	if got := s.readLine(); got != "B BAD unknown command" {
		t.Fatalf("STORE: got %q", got)
	}
	// Session still alive.
	s.cmd("C NOOP")
	if got := s.readLine(); got != "C OK NOOP completed" {
		t.Fatalf("NOOP after BAD: got %q", got)
	}
}

// "A FETCH " (empty item) must not panic the connection: expect BAD and a
// still-usable session.
func TestBridgeFetchEmptyItemRejected(t *testing.T) {
	srv := mockBridgeAPI(t, `{"messages":[]}`, base64.StdEncoding.EncodeToString([]byte{0x01}))
	defer srv.Close()
	cfg := &BridgeConfig{ApiURL: srv.URL, MailboxID: "m", Token: "tok"}
	s := startIMAPTestSession(t, cfg)
	loginTestSession(t, s, "tok")
	s.cmd("A FETCH ")
	if got := s.readLine(); got != "A BAD invalid FETCH command" {
		t.Fatalf("empty FETCH: got %q", got)
	}
	s.cmd("B NOOP")
	if got := s.readLine(); got != "B OK NOOP completed" {
		t.Fatalf("NOOP after empty FETCH: got %q", got)
	}
}

// Ranges/sets must be rejected explicitly instead of silently serving a
// prefix subset with OK.
func TestBridgeFetchRangeRejected(t *testing.T) {
	msgs := `{"messages":[{"message_seq":1,"id":"mid-1","sender":"a@x","recipients":["b@x"],"received_at":"d"}]}`
	srv := mockBridgeAPI(t, msgs, base64.StdEncoding.EncodeToString([]byte{0x01, 0x02}))
	defer srv.Close()
	cfg := &BridgeConfig{ApiURL: srv.URL, MailboxID: "m", Token: "tok"}
	s := startIMAPTestSession(t, cfg)
	loginTestSession(t, s, "tok")
	for _, seq := range []string{"1:5", "1,2", "*"} {
		s.cmd("A FETCH %s BODY[]", seq)
		if got := s.readLine(); got != "A BAD only single message sequence fetch is supported" {
			t.Fatalf("FETCH %s: got %q", seq, got)
		}
	}
}

// Unknown sequence keeps the explicit NO.
func TestBridgeFetchUnknownSequence(t *testing.T) {
	srv := mockBridgeAPI(t, `{"messages":[]}`, base64.StdEncoding.EncodeToString([]byte{0x01}))
	defer srv.Close()
	cfg := &BridgeConfig{ApiURL: srv.URL, MailboxID: "m", Token: "tok"}
	s := startIMAPTestSession(t, cfg)
	loginTestSession(t, s, "tok")
	s.cmd("A FETCH 999 BODY[HEADER]")
	if got := s.readLine(); got != "A NO message not found" {
		t.Fatalf("unknown seq: got %q", got)
	}
}

// Valid single BODY[] fetch keeps exact literal framing end to end.
func TestBridgeFetchBodyLiteralExact(t *testing.T) {
	raw := []byte{0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08}
	b64 := base64.StdEncoding.EncodeToString(raw)
	msgs := `{"messages":[{"message_seq":7,"id":"mid-7","sender":"a@x.y","recipients":["b@x.y"],"received_at":"d"}]}`
	srv := mockBridgeAPI(t, msgs, b64)
	defer srv.Close()
	cfg := &BridgeConfig{ApiURL: srv.URL, MailboxID: "m", Token: "tok"}
	s := startIMAPTestSession(t, cfg)
	loginTestSession(t, s, "tok")
	s.cmd("A FETCH 7 BODY[]")
	untagged := s.readLine()
	open := strings.Index(untagged, "{")
	closeB := strings.Index(untagged, "}")
	if open < 0 || closeB < 0 || !strings.HasPrefix(untagged, "* 7 FETCH") {
		t.Fatalf("bad untagged line: %q", untagged)
	}
	n, err := strconv.Atoi(untagged[open+1 : closeB])
	if err != nil {
		t.Fatalf("bad literal length: %v", err)
	}
	literal := make([]byte, n)
	if _, err := io.ReadFull(s.client, literal); err != nil {
		t.Fatalf("read literal: %v", err)
	}
	if got := s.readLine(); got != ")" {
		t.Fatalf("missing closing paren: %q", got)
	}
	if got := s.readLine(); got != "A OK FETCH completed" {
		t.Fatalf("missing tagged OK: %q", got)
	}
	if !strings.Contains(string(literal), b64) {
		t.Fatalf("encrypted payload altered in transit")
	}
	if !strings.Contains(string(literal), "X-BYOS-Encrypted: true") {
		t.Fatalf("missing encrypted marker")
	}
}

// Valid single BODY[HEADER] fetch exercises the metadata-only branch of the
// same dispatch (no storage retrieval involved).
func TestBridgeFetchHeaderExact(t *testing.T) {
	msgs := `{"messages":[{"message_seq":3,"id":"mid-3","sender":"a@x.y","recipients":["b@x.y"],"received_at":"d"}]}`
	srv := mockBridgeAPI(t, msgs, base64.StdEncoding.EncodeToString([]byte{0x01}))
	defer srv.Close()
	cfg := &BridgeConfig{ApiURL: srv.URL, MailboxID: "m", Token: "tok"}
	s := startIMAPTestSession(t, cfg)
	loginTestSession(t, s, "tok")
	s.cmd("A FETCH 3 BODY[HEADER]")
	untagged := s.readLine()
	open := strings.Index(untagged, "{")
	closeB := strings.Index(untagged, "}")
	if open < 0 || closeB < 0 || !strings.HasPrefix(untagged, "* 3 FETCH") ||
		!strings.Contains(untagged, "BODY[HEADER]") {
		t.Fatalf("bad untagged line: %q", untagged)
	}
	n, err := strconv.Atoi(untagged[open+1 : closeB])
	if err != nil {
		t.Fatalf("bad literal length: %v", err)
	}
	literal := make([]byte, n)
	if _, err := io.ReadFull(s.client, literal); err != nil {
		t.Fatalf("read literal: %v", err)
	}
	if got := s.readLine(); got != ")" {
		t.Fatalf("missing closing paren: %q", got)
	}
	if got := s.readLine(); got != "A OK FETCH completed" {
		t.Fatalf("missing tagged OK: %q", got)
	}
	for _, want := range []string{"From: a@x.y", "To: b@x.y", "Message-ID: <3.3@byos.local>"} {
		if !strings.Contains(string(literal), want) {
			t.Fatalf("header literal missing %q: %q", want, literal)
		}
	}
}
