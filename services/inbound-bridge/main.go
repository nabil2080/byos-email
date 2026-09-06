package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/emersion/go-smtp"
)

type Config struct {
	ListenAddr   string
	HealthAddr   string
	RouterURL    string
	RspamdURL    string
}

type App struct {
	cfg        Config
	httpClient *http.Client
}

type InboundRequest struct {
	EnvelopeFrom  string   `json:"envelope_from"`
	Recipients    []string `json:"recipients"`
	RawMessageB64 string   `json:"raw_message_b64"`
}

type RspamdCheckRequest struct {
	Message string `json:"message"`
}

type RspamdCheckResponse struct {
	Action  string `json:"action"`
	Score   float64 `json:"score"`
	Symbols []RspamdSymbol `json:"symbols"`
}

type RspamdSymbol struct {
	Name  string  `json:"name"`
	Score float64 `json:"score"`
}

type Backend struct {
	app *App
}

type Session struct {
	app  *App
	from string
	to   []string
}

func main() {
	cfg := Config{
		ListenAddr: envOrDefault("INBOUND_LISTEN", ":25"),
		HealthAddr: envOrDefault("INBOUND_HEALTH_LISTEN", ":8085"),
		RouterURL:  strings.TrimRight(envOrDefault("MAIL_ROUTER_URL", "http://localhost:8081"), "/"),
		RspamdURL:  strings.TrimRight(envOrDefault("RSPAMD_URL", "http://localhost:11334"), "/"),
	}
	app := &App{cfg: cfg, httpClient: &http.Client{Timeout: 30 * time.Second}}

	healthMux := http.NewServeMux()
	healthMux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "healthy", "service": "inbound-bridge"})
	})
	go func() {
		log.Printf("inbound bridge health listening on %s", cfg.HealthAddr)
		if err := http.ListenAndServe(cfg.HealthAddr, healthMux); err != nil {
			log.Fatalf("health server: %v", err)
		}
	}()

	server := smtp.NewServer(&Backend{app: app})
	server.Addr = cfg.ListenAddr
	server.Domain = "inbound-bridge.byos.local"
	server.ReadTimeout = 30 * time.Second
	server.WriteTimeout = 30 * time.Second
	server.MaxMessageBytes = 40 * 1024 * 1024
	server.MaxRecipients = 50
	server.AllowInsecureAuth = true

	go func() {
		log.Printf("inbound bridge SMTP listening on %s", cfg.ListenAddr)
		if err := server.ListenAndServe(); err != nil {
			log.Fatalf("smtp server: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("shutting down inbound bridge")
	server.Close()
}

func (b *Backend) NewSession(_ *smtp.Conn) (smtp.Session, error) {
	return &Session{app: b.app}, nil
}

func (s *Session) Mail(from string, _ *smtp.MailOptions) error {
	s.from = normalizeSMTPAddress(from)
	return nil
}

func (s *Session) Rcpt(to string, _ *smtp.RcptOptions) error {
	s.to = append(s.to, normalizeSMTPAddress(to))
	return nil
}

func (s *Session) Reset() {
	s.from = ""
	s.to = nil
}

func (s *Session) Logout() error {
	return nil
}

func (s *Session) Data(r io.Reader) error {
	if len(s.to) == 0 {
		return &smtp.SMTPError{Code: 554, Message: "No recipients"}
	}
	rawMessage, err := io.ReadAll(r)
	if err != nil {
		return fmt.Errorf("read data: %w", err)
	}

	// Check with Rspamd first
	if err := s.checkRspamd(rawMessage); err != nil {
		log.Printf("Rspamd check failed: %v", err)
		return &smtp.SMTPError{Code: 451, Message: "Rspamd unavailable"}
	}

	payload := InboundRequest{
		EnvelopeFrom:  s.from,
		Recipients:    append([]string(nil), s.to...),
		RawMessageB64: base64.StdEncoding.EncodeToString(rawMessage),
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal router request: %w", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.app.cfg.RouterURL+"/v1/inbound", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("build router request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.app.httpClient.Do(req)
	if err != nil {
		log.Printf("router request failed: %v", err)
		return &smtp.SMTPError{Code: 451, Message: "Router unavailable"}
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		log.Printf("router rejected message status=%s body=%s", resp.Status, strings.TrimSpace(string(respBody)))
		return &smtp.SMTPError{Code: 451, Message: "Router rejected message"}
	}
	log.Printf("accepted message from=%s recipients=%d bytes=%d", s.from, len(s.to), len(rawMessage))
	return nil
}

func (s *Session) checkRspamd(rawMessage []byte) error {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	msgB64 := base64.StdEncoding.EncodeToString(rawMessage)
	reqBody, _ := json.Marshal(RspamdCheckRequest{Message: msgB64})

	ctx, cancel = context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.app.cfg.RspamdURL+"/check", bytes.NewReader(reqBody))
	if err != nil {
		return fmt.Errorf("build rspamd request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := s.app.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("rspamd request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == 429 {
		return fmt.Errorf("rspamd rate limited")
	}
	if resp.StatusCode >= 500 {
		return fmt.Errorf("rspamd server error: %d", resp.StatusCode)
	}

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	var rspamdResp RspamdCheckResponse
	if err := json.Unmarshal(body, &rspamdResp); err != nil {
		return fmt.Errorf("rspamd response parse: %w", err)
	}

	// Rspamd actions: "no action", "greylist", "add header", "rewrite subject", "reject"
	// We reject on "reject" action
	if rspamdResp.Action == "reject" {
		return &smtp.SMTPError{Code: 550, Message: "Message rejected by spam filter"}
	}

	return nil
}

func normalizeSMTPAddress(addr string) string {
	addr = strings.TrimSpace(addr)
	addr = strings.Trim(addr, "<>")
	return strings.ToLower(addr)
}

func envOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}