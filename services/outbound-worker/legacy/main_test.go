package main

import (
	"bufio"
	"bytes"
	"net"
	"strings"
	"sync"
	"testing"
)

func TestParseAndValidateRecipients(t *testing.T) {
	// 1. Single recipient
	r, err := parseAndValidateRecipients("alice@example.com")
	if err != nil {
		t.Fatalf("unexpected error for single recipient: %v", err)
	}
	if len(r) != 1 || r[0] != "alice@example.com" {
		t.Fatalf("expected [alice@example.com], got %v", r)
	}

	// 2. Multiple comma-separated recipients
	r, err = parseAndValidateRecipients("alice@example.com, bob@example.com")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(r) != 2 || r[0] != "alice@example.com" || r[1] != "bob@example.com" {
		t.Fatalf("expected 2 comma recipients, got %v", r)
	}

	// 3. Multiple semicolon-separated recipients
	r, err = parseAndValidateRecipients("alice@example.com; bob@example.com")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(r) != 2 || r[0] != "alice@example.com" || r[1] != "bob@example.com" {
		t.Fatalf("expected 2 semicolon recipients, got %v", r)
	}

	// 4. Mixed whitespace and empty entries
	r, err = parseAndValidateRecipients("  alice@example.com , ;  , bob@example.com  ; ")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(r) != 2 || r[0] != "alice@example.com" || r[1] != "bob@example.com" {
		t.Fatalf("expected trimmed 2 recipients, got %v", r)
	}

	// 5. Quoted display name with embedded comma and case-insensitive deduplication
	r, err = parseAndValidateRecipients("\"Doe, Alice\" <Alice@Example.com>, alice@example.com, bob@example.com, \"Bob\" <BOB@EXAMPLE.COM>")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(r) != 2 || strings.ToLower(r[0]) != "alice@example.com" || strings.ToLower(r[1]) != "bob@example.com" {
		t.Fatalf("expected 2 deduplicated recipients, got %v", r)
	}

	// 6. Malformed addresses rejected
	badInputs := []string{
		"",
		"   , ;  ",
		"notanemail",
		"alice@localhost",
		"alice@example.com\r\nBcc: evil@attacker.com",
		"alice@example.com, @bad.com",
	}
	for _, bad := range badInputs {
		if _, err := parseAndValidateRecipients(bad); err == nil {
			t.Fatalf("expected error for malformed/empty recipient %q, got nil", bad)
		}
	}
}

func TestStripBccHeaders(t *testing.T) {
	// 1. Standard CRLF message with Bcc in middle
	raw1 := []byte("From: sender@example.com\r\nTo: alice@example.com\r\nBcc: secret@example.com\r\nSubject: Test\r\n\r\nHello body")
	got1 := string(stripBccHeaders(raw1))
	want1 := "From: sender@example.com\r\nTo: alice@example.com\r\nSubject: Test\r\n\r\nHello body"
	if got1 != want1 {
		t.Fatalf("mismatch middle Bcc:\ngot:  %q\nwant: %q", got1, want1)
	}

	// 2. Bcc as last header before blank line (no double newline artifact)
	raw2 := []byte("From: sender@example.com\r\nTo: alice@example.com\r\nBcc: secret@example.com\r\n\r\nBody line 1")
	got2 := string(stripBccHeaders(raw2))
	want2 := "From: sender@example.com\r\nTo: alice@example.com\r\n\r\nBody line 1"
	if got2 != want2 {
		t.Fatalf("mismatch last Bcc:\ngot:  %q\nwant: %q", got2, want2)
	}

	// 3. Folded multiline & mixed-case & multiple Bcc headers
	raw3 := []byte("From: sender@example.com\r\nbCc: secret1@example.com,\r\n\tsecret2@example.com,\r\n  secret3@example.com\r\nTo: alice@example.com\r\nBCC: another@example.com\r\nSubject: Multi\r\n\r\nBody content")
	got3 := string(stripBccHeaders(raw3))
	want3 := "From: sender@example.com\r\nTo: alice@example.com\r\nSubject: Multi\r\n\r\nBody content"
	if got3 != want3 {
		t.Fatalf("mismatch folded/multi Bcc:\ngot:  %q\nwant: %q", got3, want3)
	}

	// 4. Body containing literal "Bcc:" must remain untouched; LF boundary handled first
	raw4 := []byte("From: sender@example.com\nTo: alice@example.com\nBcc: real-secret@example.com\n\nPlease ignore:\nBcc: literal-in-body@example.com\r\n\r\nMore text")
	got4 := string(stripBccHeaders(raw4))
	want4 := "From: sender@example.com\nTo: alice@example.com\n\nPlease ignore:\nBcc: literal-in-body@example.com\r\n\r\nMore text"
	if got4 != want4 {
		t.Fatalf("mismatch literal body preservation:\ngot:  %q\nwant: %q", got4, want4)
	}

	// 5. No Bcc header -> byte-for-byte identical, including X-Bcc-Debug
	raw5 := []byte("From: sender@example.com\r\nX-Bcc-Debug: keep\r\nTo: alice@example.com\r\n\r\nHi")
	got5 := stripBccHeaders(raw5)
	if !bytes.Equal(got5, raw5) {
		t.Fatalf("expected identical bytes when no Bcc present")
	}

	// 6. Obs-syntax space before colon (`Bcc : ...`) and folded legitimate To/Cc headers preserved
	raw6 := []byte("From: sender@example.com\r\nTo: a@example.com,\r\n b@example.com\r\nBcc : obs@example.com\r\nCc: c1@example.com,\r\n\tc2@example.com\r\n\r\nHi")
	got6 := string(stripBccHeaders(raw6))
	want6 := "From: sender@example.com\r\nTo: a@example.com,\r\n b@example.com\r\nCc: c1@example.com,\r\n\tc2@example.com\r\n\r\nHi"
	if got6 != want6 {
		t.Fatalf("mismatch obs/folded preservation:\ngot:  %q\nwant: %q", got6, want6)
	}
}

func TestDeliverToSmtpServerCapture(t *testing.T) {
	// Start local mock SMTP server
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen failed: %v", err)
	}
	defer ln.Close()

	var mu sync.Mutex
	var rcptCommands []string
	var capturedData string

	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				c.Write([]byte("220 mock-go-smtp ESMTP\r\n"))
				reader := bufio.NewReader(c)
				inData := false
				var dataBuf bytes.Buffer
				for {
					line, err := reader.ReadString('\n')
					if err != nil {
						return
					}
					if inData {
						if line == ".\r\n" || line == ".\n" {
							inData = false
							mu.Lock()
							capturedData = dataBuf.String()
							mu.Unlock()
							c.Write([]byte("250 2.0.0 OK\r\n"))
						} else {
							dataBuf.WriteString(line)
						}
						continue
					}
					upper := strings.ToUpper(strings.TrimSpace(line))
					if strings.HasPrefix(upper, "EHLO") || strings.HasPrefix(upper, "HELO") {
						c.Write([]byte("250-mock-go-smtp\r\n250 OK\r\n"))
					} else if strings.HasPrefix(upper, "MAIL FROM:") {
						c.Write([]byte("250 2.1.0 OK\r\n"))
					} else if strings.HasPrefix(upper, "RCPT TO:") {
						arg := strings.TrimSpace(line[8:])
						if strings.Contains(arg, ",") {
							c.Write([]byte("501 5.1.3 Comma-separated addresses rejected in RCPT TO\r\n"))
						} else {
							mu.Lock()
							rcptCommands = append(rcptCommands, strings.TrimSpace(line))
							mu.Unlock()
							c.Write([]byte("250 2.1.5 OK\r\n"))
						}
					} else if upper == "DATA" {
						inData = true
						c.Write([]byte("354 End data with <CR><LF>.<CR><LF>\r\n"))
					} else if upper == "QUIT" {
						c.Write([]byte("221 2.0.0 Bye\r\n"))
						return
					} else {
						c.Write([]byte("250 OK\r\n"))
					}
				}
			}(conn)
		}
	}()

	mimeMsg := []byte("From: sender@byos.local\r\nTo: to@example.com\r\nCc: cc@example.com\r\nBcc: bcc1@example.com,\r\n bcc2@example.com\r\nSubject: Multi Test\r\n\r\nBody with Bcc: secret-note\r\n")
	recipients := "to@example.com, cc@example.com; bcc1@example.com, bcc2@example.com"

	if err := deliverToSmtpServer(ln.Addr().String(), "sender@byos.local", recipients, mimeMsg); err != nil {
		t.Fatalf("deliverToSmtpServer failed: %v", err)
	}

	mu.Lock()
	defer mu.Unlock()

	for _, cmd := range rcptCommands {
		t.Logf("[GO-SMTP-CAPTURE] %s", cmd)
	}
	t.Logf("[GO-SMTP-CAPTURE] DATA Payload:\n%s", strings.ReplaceAll(strings.TrimSpace(capturedData), "\r\n", "\\r\\n\n"))

	if len(rcptCommands) != 4 {
		t.Fatalf("expected 4 separate RCPT TO commands, got %d: %v", len(rcptCommands), rcptCommands)
	}
	expectedRcpts := []string{
		"RCPT TO:<to@example.com>",
		"RCPT TO:<cc@example.com>",
		"RCPT TO:<bcc1@example.com>",
		"RCPT TO:<bcc2@example.com>",
	}
	for i, want := range expectedRcpts {
		if rcptCommands[i] != want {
			t.Fatalf("rcpt[%d]: want %q, got %q", i, want, rcptCommands[i])
		}
	}

	// Verify headers vs body in DATA
	if strings.Contains(capturedData, "bcc1@example.com") || strings.Contains(capturedData, "bcc2@example.com") {
		t.Fatalf("BCC addresses leaked in SMTP DATA payload:\n%s", capturedData)
	}
	if !strings.Contains(capturedData, "To: to@example.com") || !strings.Contains(capturedData, "Cc: cc@example.com") {
		t.Fatalf("To/Cc headers missing from SMTP DATA payload:\n%s", capturedData)
	}
	if !strings.Contains(capturedData, "Body with Bcc: secret-note") {
		t.Fatalf("Body literal text modified or missing:\n%s", capturedData)
	}
}
