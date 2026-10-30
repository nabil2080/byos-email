package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math/big"
	"net"
	"net/http"
	"net/smtp"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"
)

// Sentinel errors for OTP lifecycle
var (
	ErrMaxAttemptsExceeded     = errors.New("maximum verification attempts exceeded")
	ErrCooldownActive          = errors.New("resend cooldown active")
	ErrRateLimitExceeded       = errors.New("rate limit exceeded")
	ErrRecipientNotAllowlisted = errors.New("recipient not in development allowlist")
	ErrChallengeExpired        = errors.New("verification challenge expired")
	ErrInvalidOTP              = errors.New("invalid verification code")
	ErrDeliveryFailed          = errors.New("otp delivery failed")
	ErrProviderUnconfigured    = errors.New("delivery provider unconfigured")
)

// OTPDeliveryConfig holds configuration for outbound email & SMS OTP delivery.
type OTPDeliveryConfig struct {
	DeliveryMode           string // "live", "mock", "disabled"
	DevAllowedEmails       []string
	DevAllowedPhoneNumbers []string
	SMTP                   SMTPConfig
	SMS                    SMSConfig
	HMACSecret             []byte
}

// SMTPConfig holds parameters for authenticated outbound transactional email.
type SMTPConfig struct {
	Host        string
	Port        int
	Username    string
	Password    string
	FromAddress string
	FromName    string
	Encryption  string // "starttls", "tls", "none"
}

// SMSConfig holds parameters for outbound SMS OTP delivery.
type SMSConfig struct {
	Provider         string // "twilio", "greenweb", "generic_http", "mock"
	TwilioAccountSid string
	TwilioAuthToken  string
	TwilioFromNumber string
	GreenwebToken    string
	GatewayURL       string
	GatewayKey       string
	SenderID         string
}

// SMSDeliveryReceipt records metadata about an SMS provider submission.
type SMSDeliveryReceipt struct {
	Provider    string    `json:"provider"`
	MessageID   string    `json:"message_id"`
	Status      string    `json:"status"`
	RawResponse string    `json:"raw_response,omitempty"`
	Timestamp   time.Time `json:"timestamp"`
}

// SMSProvider interface abstracts outbound SMS gateways.
type SMSProvider interface {
	SendSMS(ctx context.Context, toE164, message string) (*SMSDeliveryReceipt, error)
	Name() string
}

// MockDeliveryStore holds mock deliveries for tests.
type MockDeliveryStore struct {
	mu     sync.Mutex
	Emails []MockEmailRecord
	SMS    []MockSMSRecord
}

type MockEmailRecord struct {
	To      string
	Subject string
	Code    string
	Time    time.Time
}

type MockSMSRecord struct {
	To      string
	Message string
	Code    string
	Time    time.Time
}

var globalMockStore = &MockDeliveryStore{}

// GetMockStore returns the global mock store for testing assertions.
func GetMockStore() *MockDeliveryStore {
	return globalMockStore
}

func (s *MockDeliveryStore) Reset() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Emails = nil
	s.SMS = nil
}

func (s *MockDeliveryStore) AddEmail(to, subject, code string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.Emails = append(s.Emails, MockEmailRecord{To: to, Subject: subject, Code: code, Time: time.Now()})
}

func (s *MockDeliveryStore) AddSMS(to, msg, code string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.SMS = append(s.SMS, MockSMSRecord{To: to, Message: msg, Code: code, Time: time.Now()})
}

// Global active SMS provider and config
var (
	activeOTPCfg      *OTPDeliveryConfig
	activeSMSProvider SMSProvider
	otpInitOnce       sync.Once
)

// getOTPDeliveryConfig loads and caches the delivery configuration from environment.
func getOTPDeliveryConfig() *OTPDeliveryConfig {
	otpInitOnce.Do(func() {
		activeOTPCfg = loadOTPDeliveryConfig()
		activeSMSProvider = initSMSProvider(activeOTPCfg)
	})
	return activeOTPCfg
}

// setTestOTPDeliveryConfig allows unit tests to inject custom test configurations.
func setTestOTPDeliveryConfig(cfg *OTPDeliveryConfig, provider SMSProvider) {
	activeOTPCfg = cfg
	activeSMSProvider = provider
}

// isProductionEnvironment reports whether the runtime environment is production.
func isProductionEnvironment() bool {
	return strings.EqualFold(os.Getenv("BYOS_ENV"), "production")
}

// loadOTPDeliveryConfig reads environment variables.
func loadOTPDeliveryConfig() *OTPDeliveryConfig {
	mode := strings.ToLower(strings.TrimSpace(os.Getenv("OTP_DELIVERY_MODE")))
	if mode == "" {
		if isProductionEnvironment() {
			mode = "disabled"
		} else {
			mode = "mock"
		}
	}

	// Dev allowlists
	allowedEmailsRaw := os.Getenv("OTP_DEV_ALLOWED_EMAILS")
	var allowedEmails []string
	if allowedEmailsRaw != "" {
		for _, em := range strings.Split(allowedEmailsRaw, ",") {
			em = strings.ToLower(strings.TrimSpace(em))
			if em != "" {
				allowedEmails = append(allowedEmails, em)
			}
		}
	} else {
		// Default dev allowlist per user specification
		allowedEmails = []string{"abdullahrawha30@gmail.com"}
	}

	allowedPhonesRaw := os.Getenv("OTP_DEV_ALLOWED_PHONE_NUMBERS")
	var allowedPhones []string
	if allowedPhonesRaw != "" {
		for _, ph := range strings.Split(allowedPhonesRaw, ",") {
			ph = strings.TrimSpace(ph)
			if ph != "" {
				norm, err := NormalizeE164(ph)
				if err == nil {
					allowedPhones = append(allowedPhones, norm)
				} else {
					allowedPhones = append(allowedPhones, ph)
				}
			}
		}
	} else {
		// Default dev allowlist per user specification
		allowedPhones = []string{"+8801617856836"}
	}

	// SMTP Config
	smtpPort := 587
	if p := os.Getenv("SMTP_PORT"); p != "" {
		if parsed, err := strconv.Atoi(p); err == nil && parsed > 0 {
			smtpPort = parsed
		}
	}
	smtpPassword := os.Getenv("SMTP_PASSWORD")
	if pwFile := os.Getenv("SMTP_PASSWORD_FILE"); pwFile != "" && smtpPassword == "" {
		if b, err := os.ReadFile(pwFile); err == nil {
			smtpPassword = strings.TrimSpace(string(b))
		}
	}
	smtpFrom := os.Getenv("SMTP_FROM_ADDRESS")
	if smtpFrom == "" {
		smtpFrom = os.Getenv("OTP_EMAIL_FROM")
	}
	if smtpFrom == "" {
		smtpFrom = "security@byos.local"
	}
	smtpFromName := os.Getenv("SMTP_FROM_NAME")
	if smtpFromName == "" {
		smtpFromName = "BYOS Security"
	}
	smtpEnc := strings.ToLower(strings.TrimSpace(os.Getenv("SMTP_ENCRYPTION")))
	if smtpEnc == "" {
		if smtpPort == 465 {
			smtpEnc = "tls"
		} else {
			smtpEnc = "starttls"
		}
	}

	// SMS Config
	smsProvider := strings.ToLower(strings.TrimSpace(os.Getenv("OTP_SMS_PROVIDER")))
	if smsProvider == "" {
		if mode == "live" {
			smsProvider = "twilio"
		} else {
			smsProvider = "mock"
		}
	}
	twilioToken := os.Getenv("TWILIO_AUTH_TOKEN")
	if tf := os.Getenv("TWILIO_AUTH_TOKEN_FILE"); tf != "" && twilioToken == "" {
		if b, err := os.ReadFile(tf); err == nil {
			twilioToken = strings.TrimSpace(string(b))
		}
	}
	greenwebToken := os.Getenv("GREENWEB_TOKEN")
	if gf := os.Getenv("GREENWEB_TOKEN_FILE"); gf != "" && greenwebToken == "" {
		if b, err := os.ReadFile(gf); err == nil {
			greenwebToken = strings.TrimSpace(string(b))
		}
	}

	// HMAC secret
	hmacSecret := getOTPHMACSecret()

	return &OTPDeliveryConfig{
		DeliveryMode:           mode,
		DevAllowedEmails:       allowedEmails,
		DevAllowedPhoneNumbers: allowedPhones,
		SMTP: SMTPConfig{
			Host:        os.Getenv("SMTP_HOST"),
			Port:        smtpPort,
			Username:    os.Getenv("SMTP_USERNAME"),
			Password:    smtpPassword,
			FromAddress: smtpFrom,
			FromName:    smtpFromName,
			Encryption:  smtpEnc,
		},
		SMS: SMSConfig{
			Provider:         smsProvider,
			TwilioAccountSid: os.Getenv("TWILIO_ACCOUNT_SID"),
			TwilioAuthToken:  twilioToken,
			TwilioFromNumber: os.Getenv("TWILIO_FROM_NUMBER"),
			GreenwebToken:    greenwebToken,
			GatewayURL:       os.Getenv("SMS_GATEWAY_URL"),
			GatewayKey:       os.Getenv("SMS_GATEWAY_KEY"),
			SenderID:         os.Getenv("SMS_SENDER_ID"),
		},
		HMACSecret: hmacSecret,
	}
}

// getOTPHMACSecret resolves the dedicated server-side secret for hashing OTPs.
func getOTPHMACSecret() []byte {
	if sec := os.Getenv("OTP_HMAC_SECRET"); sec != "" {
		return []byte(sec)
	}
	if path := os.Getenv("OTP_HMAC_SECRET_FILE"); path != "" {
		if b, err := os.ReadFile(path); err == nil && len(strings.TrimSpace(string(b))) > 0 {
			return []byte(strings.TrimSpace(string(b)))
		}
	}
	if isProductionEnvironment() {
		log.Fatal("FATAL: OTP_HMAC_SECRET must be set in production")
	}
	return []byte("byos-dev-otp-hmac-secret-32bytes-long-key!")
}

// isMockOTPDelivery reports whether OTP delivery is in mock mode.
func isMockOTPDelivery() bool {
	cfg := getOTPDeliveryConfig()
	return cfg.DeliveryMode == "mock"
}

// NormalizeE164 validates and formats a phone number into strict E.164.
// Specifically handles Bangladesh local numbering (+880).
func NormalizeE164(phone string) (string, error) {
	cleaned := strings.Map(func(r rune) rune {
		if (r >= '0' && r <= '9') || r == '+' {
			return r
		}
		return -1
	}, phone)

	if cleaned == "" {
		return "", errors.New("phone number cannot be empty")
	}

	// Bangladesh local format: 01XXXXXXXXX (11 digits starting with 01)
	if strings.HasPrefix(cleaned, "01") && len(cleaned) == 11 {
		cleaned = "+880" + cleaned[1:]
	} else if strings.HasPrefix(cleaned, "8801") && len(cleaned) == 13 {
		cleaned = "+" + cleaned
	} else if strings.HasPrefix(cleaned, "+8801") && len(cleaned) == 14 {
		// already normalized Bangladesh E.164
	} else if !strings.HasPrefix(cleaned, "+") {
		cleaned = "+" + cleaned
	}

	e164Regex := regexp.MustCompile(`^\+[1-9]\d{6,14}$`)
	if !e164Regex.MatchString(cleaned) {
		return "", fmt.Errorf("invalid E.164 format: %s", cleaned)
	}
	return cleaned, nil
}

// ValidateRecipient ensures that in development mode, only explicitly allowlisted
// destinations receive OTPs. In production, this check is bypassed.
func (cfg *OTPDeliveryConfig) ValidateRecipient(dest string, isPhone bool) error {
	if isProductionEnvironment() {
		return nil
	}

	if isPhone {
		norm, err := NormalizeE164(dest)
		if err != nil {
			return fmt.Errorf("invalid phone number: %w", err)
		}
		for _, allowed := range cfg.DevAllowedPhoneNumbers {
			normAllowed, err := NormalizeE164(allowed)
			if err == nil && normAllowed == norm {
				return nil
			}
		}
		return fmt.Errorf("%w: phone number '%s' not permitted in development", ErrRecipientNotAllowlisted, dest)
	}

	normEmail := strings.ToLower(strings.TrimSpace(dest))
	for _, allowed := range cfg.DevAllowedEmails {
		if strings.ToLower(strings.TrimSpace(allowed)) == normEmail {
			return nil
		}
	}
	return fmt.Errorf("%w: email '%s' not permitted in development", ErrRecipientNotAllowlisted, dest)
}

// ComputeOTPHMAC generates an HMAC-SHA256 digest of the challenge token and OTP code.
// Plaintext OTP is NEVER stored in database tables or logs.
func ComputeOTPHMAC(secret []byte, challengeToken, otp string) string {
	h := hmac.New(sha256.New, secret)
	h.Write([]byte(challengeToken + ":" + strings.TrimSpace(otp)))
	return "hmac:" + hex.EncodeToString(h.Sum(nil))
}

// VerifyOTPHMAC compares a candidate OTP against a stored verification_code column using constant-time comparison.
func VerifyOTPHMAC(secret []byte, challengeToken, storedVerificationCode, candidateCode string) bool {
	candidateCode = strings.TrimSpace(candidateCode)
	if strings.HasPrefix(storedVerificationCode, "hmac:") {
		expectedDigest := ComputeOTPHMAC(secret, challengeToken, candidateCode)
		return subtle.ConstantTimeCompare([]byte(storedVerificationCode), []byte(expectedDigest)) == 1
	}
	// Constant-time fallback for non-HMAC or legacy test tokens
	return subtle.ConstantTimeCompare([]byte(storedVerificationCode), []byte(candidateCode)) == 1
}

// CheckOTPCooldown verifies that the destination is not within a 60-second resend cooldown.
func CheckOTPCooldown(ctx context.Context, purpose, destination string) (bool, int, error) {
	if redisClient == nil {
		return false, 0, nil
	}
	key := fmt.Sprintf("otp:cooldown:%s:%s", purpose, destination)
	ttl, err := redisClient.TTL(ctx, key).Result()
	if err != nil {
		if err == redis.Nil {
			return false, 0, nil
		}
		return false, 0, nil
	}
	if ttl > 0 {
		return true, int(ttl.Seconds()), nil
	}
	return false, 0, nil
}

// RecordOTPCooldown records a 60-second cooldown in Redis.
func RecordOTPCooldown(ctx context.Context, purpose, destination string) {
	if redisClient != nil {
		key := fmt.Sprintf("otp:cooldown:%s:%s", purpose, destination)
		_ = redisClient.Set(ctx, key, "1", 60*time.Second).Err()
	}
}

// CheckOTPRateLimits enforces rate limits:
// - IP: max 5 requests per 1 minute
// - Destination: max 3 requests per 10 minutes
// - User: max 5 requests per 10 minutes
func CheckOTPRateLimits(ctx context.Context, ip, destination, userID string) error {
	if redisClient == nil {
		if isProductionEnvironment() {
			return errors.New("rate limiter unavailable")
		}
		return nil
	}

	cleanIP := strings.TrimSpace(strings.Split(ip, ":")[0])
	if cleanIP != "" {
		ipKey := "auth:otp:ip:" + cleanIP
		cnt, _ := redisClient.Incr(ctx, ipKey).Result()
		if cnt == 1 {
			redisClient.Expire(ctx, ipKey, 1*time.Minute)
		}
		if cnt > 5 {
			return fmt.Errorf("%w: too many verification attempts from this IP", ErrRateLimitExceeded)
		}
	}

	if destination != "" {
		destKey := "auth:otp:dest:" + destination
		cnt, _ := redisClient.Incr(ctx, destKey).Result()
		if cnt == 1 {
			redisClient.Expire(ctx, destKey, 10*time.Minute)
		}
		if cnt > 3 {
			return fmt.Errorf("%w: too many verification attempts for this destination", ErrRateLimitExceeded)
		}
	}

	if userID != "" {
		userKey := "auth:otp:user:" + userID
		cnt, _ := redisClient.Incr(ctx, userKey).Result()
		if cnt == 1 {
			redisClient.Expire(ctx, userKey, 10*time.Minute)
		}
		if cnt > 5 {
			return fmt.Errorf("%w: too many verification attempts for this user", ErrRateLimitExceeded)
		}
	}

	return nil
}

// CheckAndIncrementOTPAttempts increments the attempt counter for a challenge.
// Fails after 5 maximum attempts.
func CheckAndIncrementOTPAttempts(ctx context.Context, challengeToken string) (int, bool, error) {
	if redisClient == nil {
		return 1, false, nil
	}
	key := "otp:attempts:" + challengeToken
	attempts, err := redisClient.Incr(ctx, key).Result()
	if err != nil {
		return 1, false, nil
	}
	if attempts == 1 {
		redisClient.Expire(ctx, key, 10*time.Minute)
	}
	if attempts > 5 {
		return int(attempts), true, nil
	}
	return int(attempts), false, nil
}

// ClearOTPAttempts removes the attempt counter upon successful verification.
func ClearOTPAttempts(ctx context.Context, challengeToken string) {
	if redisClient != nil {
		redisClient.Del(ctx, "otp:attempts:"+challengeToken)
	}
}

// generateCryptographicOTP generates a 6-digit random code using crypto/rand.
func generateCryptographicOTP() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(900000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()+100000), nil
}

// ─────────────────────────────────────────────────────────────────────────────
// EMAIL DELIVERY (SMTP)
// ─────────────────────────────────────────────────────────────────────────────

// SendEmailOTP dispatches a transactional verification email.
func SendEmailOTP(ctx context.Context, cfg *OTPDeliveryConfig, toEmail, otp, purpose string) error {
	toEmail = strings.ToLower(strings.TrimSpace(toEmail))
	if err := cfg.ValidateRecipient(toEmail, false); err != nil {
		return err
	}

	if cfg.DeliveryMode == "mock" {
		globalMockStore.AddEmail(toEmail, "Your BYOS Verification Code", otp)
		log.Printf("[OTP DISPATCH] (MOCK) Email OTP dispatched to %s", maskRecoveryDestination(toEmail, "email"))
		return nil
	}

	if cfg.DeliveryMode != "live" {
		return fmt.Errorf("%w: outbound email delivery is disabled", ErrDeliveryFailed)
	}

	if cfg.SMTP.Host == "" {
		return fmt.Errorf("%w: SMTP_HOST is not configured for live email delivery", ErrProviderUnconfigured)
	}

	subject := fmt.Sprintf("Your BYOS verification code is %s", otp)
	textBody := fmt.Sprintf("Your BYOS single-use verification code is: %s\r\n\r\nThis code will expire in 5 minutes.\r\n\r\nIf you did not request this verification, please secure your account immediately.\r\nBYOS security personnel will never ask you for this code.", otp)
	htmlBody := renderEmailOTPTemplate(otp, purpose)

	return executeSMTPDelivery(ctx, &cfg.SMTP, toEmail, subject, textBody, htmlBody)
}

func renderEmailOTPTemplate(otp, purpose string) string {
	purposeLabel := "Account Verification"
	switch purpose {
	case "login_2fa":
		purposeLabel = "Two-Factor Sign-In"
	case "verify_recovery_contact":
		purposeLabel = "Recovery Contact Verification"
	case "recovery_reset":
		purposeLabel = "Password Recovery"
	}

	return fmt.Sprintf(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BYOS Verification Code</title>
</head>
<body style="margin: 0; padding: 0; background-color: #F0EEE9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #2C2D2E;">
  <table width="100%%" border="0" cellspacing="0" cellpadding="0" style="background-color: #F0EEE9; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="100%%" border="0" cellspacing="0" cellpadding="0" style="max-width: 520px; background-color: #FAF9F5; border: 1px solid #E2DFD8; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
          <!-- Header -->
          <tr>
            <td style="background-color: #2C2D2E; padding: 24px 32px; text-align: left;">
              <span style="font-family: ui-monospace, Menlo, Monaco, Consolas, monospace; font-size: 20px; font-weight: bold; color: #F0EEE9; letter-spacing: 0.1em;">BYOS</span>
              <span style="font-size: 13px; color: #9E725F; margin-left: 8px; font-weight: 500;">ZERO-KNOWLEDGE EMAIL</span>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding: 32px;">
              <h2 style="margin: 0 0 12px 0; font-size: 20px; color: #2C2D2E; font-weight: 600;">%s</h2>
              <p style="margin: 0 0 24px 0; font-size: 14px; line-height: 1.5; color: #6B6D70;">
                Use the verification code below to complete your authentication. This one-time code expires in <strong>5 minutes</strong>.
              </p>
              
              <!-- Code Card -->
              <div style="background-color: #FFFFFF; border: 1px solid #D6D2CA; border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 24px;">
                <div style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 36px; font-weight: 700; color: #9E725F; letter-spacing: 0.25em; padding: 4px 0;">
                  %s
                </div>
              </div>

              <!-- Security Callout -->
              <div style="border-left: 3px solid #9E725F; padding-left: 14px; margin-bottom: 24px;">
                <p style="margin: 0; font-size: 12px; line-height: 1.4; color: #6B6D70;">
                  <strong>Security notice:</strong> BYOS security staff will never contact you to ask for this code. Never share this code with anyone.
                </p>
              </div>

              <p style="margin: 0; font-size: 12px; color: #9A9895; line-height: 1.4;">
                If you did not initiate this verification request, please secure your credentials immediately.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color: #F0EEE9; padding: 16px 32px; text-align: center; font-size: 11px; color: #9A9895; border-top: 1px solid #E2DFD8;">
              Protected by BYOS Zero-Knowledge Infrastructure &bull; Automated Security Dispatch
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`, purposeLabel, otp)
}

func executeSMTPDelivery(ctx context.Context, cfg *SMTPConfig, toEmail, subject, textBody, htmlBody string) error {
	addr := net.JoinHostPort(cfg.Host, strconv.Itoa(cfg.Port))
	from := cfg.FromAddress
	fromHeader := fmt.Sprintf("%s <%s>", cfg.FromName, cfg.FromAddress)

	boundary := fmt.Sprintf("boundary_%d", time.Now().UnixNano())

	var msg bytes.Buffer
	msg.WriteString(fmt.Sprintf("From: %s\r\n", fromHeader))
	msg.WriteString(fmt.Sprintf("To: %s\r\n", toEmail))
	msg.WriteString(fmt.Sprintf("Subject: %s\r\n", subject))
	msg.WriteString("MIME-Version: 1.0\r\n")
	msg.WriteString(fmt.Sprintf("Content-Type: multipart/alternative; boundary=\"%s\"\r\n\r\n", boundary))

	// Plaintext part
	msg.WriteString(fmt.Sprintf("--%s\r\n", boundary))
	msg.WriteString("Content-Type: text/plain; charset=\"UTF-8\"\r\n")
	msg.WriteString("Content-Transfer-Encoding: 7bit\r\n\r\n")
	msg.WriteString(textBody)
	msg.WriteString("\r\n\r\n")

	// HTML part
	msg.WriteString(fmt.Sprintf("--%s\r\n", boundary))
	msg.WriteString("Content-Type: text/html; charset=\"UTF-8\"\r\n")
	msg.WriteString("Content-Transfer-Encoding: 7bit\r\n\r\n")
	msg.WriteString(htmlBody)
	msg.WriteString("\r\n\r\n")

	msg.WriteString(fmt.Sprintf("--%s--\r\n", boundary))

	dialer := &net.Dialer{Timeout: 10 * time.Second}

	var conn net.Conn
	var err error

	if cfg.Encryption == "tls" || cfg.Port == 465 {
		tlsConfig := &tls.Config{ServerName: cfg.Host}
		conn, err = tls.DialWithDialer(dialer, "tcp", addr, tlsConfig)
	} else {
		conn, err = dialer.DialContext(ctx, "tcp", addr)
	}
	if err != nil {
		return fmt.Errorf("smtp connection failed to %s: %w", addr, err)
	}
	defer conn.Close()

	client, err := smtp.NewClient(conn, cfg.Host)
	if err != nil {
		return fmt.Errorf("smtp client initialization failed: %w", err)
	}
	defer client.Quit()

	if cfg.Encryption == "starttls" {
		if ok, _ := client.Extension("STARTTLS"); ok {
			tlsConfig := &tls.Config{ServerName: cfg.Host}
			if err := client.StartTLS(tlsConfig); err != nil {
				return fmt.Errorf("starttls negotiation failed: %w", err)
			}
		}
	}

	if cfg.Username != "" && cfg.Password != "" {
		auth := smtp.PlainAuth("", cfg.Username, cfg.Password, cfg.Host)
		if err := client.Auth(auth); err != nil {
			return fmt.Errorf("smtp authentication failed: %w", err)
		}
	}

	if err := client.Mail(from); err != nil {
		return fmt.Errorf("smtp MAIL FROM failed: %w", err)
	}
	if err := client.Rcpt(toEmail); err != nil {
		return fmt.Errorf("smtp RCPT TO failed: %w", err)
	}

	w, err := client.Data()
	if err != nil {
		return fmt.Errorf("smtp DATA command failed: %w", err)
	}
	if _, err := w.Write(msg.Bytes()); err != nil {
		return fmt.Errorf("smtp writing data payload failed: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("smtp closing data failed: %w", err)
	}

	log.Printf("[OTP DISPATCH] Dispatched email OTP to %s", maskRecoveryDestination(toEmail, "email"))
	return nil
}

// ─────────────────────────────────────────────────────────────────────────────
// SMS DELIVERY (TWILIO, GREENWEB, GENERIC HTTP, MOCK)
// ─────────────────────────────────────────────────────────────────────────────

func initSMSProvider(cfg *OTPDeliveryConfig) SMSProvider {
	switch cfg.SMS.Provider {
	case "twilio":
		return &TwilioSMSProvider{
			AccountSid: cfg.SMS.TwilioAccountSid,
			AuthToken:  cfg.SMS.TwilioAuthToken,
			FromNumber: cfg.SMS.TwilioFromNumber,
		}
	case "greenweb":
		return &GreenwebSMSProvider{
			Token: cfg.SMS.GreenwebToken,
		}
	case "generic_http":
		return &GenericHTTPSMSProvider{
			URL:      cfg.SMS.GatewayURL,
			Key:      cfg.SMS.GatewayKey,
			SenderID: cfg.SMS.SenderID,
		}
	case "mock":
		fallthrough
	default:
		return &MockSMSProvider{}
	}
}

// SendSMSOTP normalizes the destination and dispatches an outbound SMS OTP.
func SendSMSOTP(ctx context.Context, cfg *OTPDeliveryConfig, provider SMSProvider, toPhone, otp, purpose string) (*SMSDeliveryReceipt, error) {
	norm, err := NormalizeE164(toPhone)
	if err != nil {
		return nil, err
	}
	if err := cfg.ValidateRecipient(norm, true); err != nil {
		return nil, err
	}

	message := fmt.Sprintf("Your BYOS verification code is %s. Valid for 5 minutes. Do not share this code.", otp)

	if cfg.DeliveryMode == "mock" {
		globalMockStore.AddSMS(norm, message, otp)
		log.Printf("[OTP DISPATCH] (MOCK) SMS OTP dispatched to %s", maskRecoveryDestination(norm, "phone"))
		return &SMSDeliveryReceipt{
			Provider:  "mock",
			MessageID: fmt.Sprintf("mock_%d", time.Now().UnixNano()),
			Status:    "accepted",
			Timestamp: time.Now(),
		}, nil
	}

	if cfg.DeliveryMode != "live" {
		return nil, fmt.Errorf("%w: outbound SMS delivery is disabled", ErrDeliveryFailed)
	}

	if provider == nil || provider.Name() == "mock" {
		return nil, fmt.Errorf("%w: SMS provider is unconfigured for live delivery", ErrProviderUnconfigured)
	}

	receipt, err := provider.SendSMS(ctx, norm, message)
	if err != nil {
		return nil, err
	}

	log.Printf("[OTP DISPATCH] Dispatched SMS OTP to %s via %s (msg_id: %s)", maskRecoveryDestination(norm, "phone"), receipt.Provider, receipt.MessageID)
	return receipt, nil
}

// TwilioSMSProvider implements SMSProvider for Twilio.
type TwilioSMSProvider struct {
	AccountSid string
	AuthToken  string
	FromNumber string
	BaseURL    string // Overrideable for tests
}

func (p *TwilioSMSProvider) Name() string { return "twilio" }

func (p *TwilioSMSProvider) SendSMS(ctx context.Context, toE164, message string) (*SMSDeliveryReceipt, error) {
	if p.AccountSid == "" || p.AuthToken == "" {
		return nil, fmt.Errorf("%w: Twilio AccountSid and AuthToken are required", ErrProviderUnconfigured)
	}

	endpoint := p.BaseURL
	if endpoint == "" {
		endpoint = fmt.Sprintf("https://api.twilio.com/2010-04-01/Accounts/%s/Messages.json", p.AccountSid)
	}

	data := url.Values{}
	data.Set("To", toE164)
	if p.FromNumber != "" {
		data.Set("From", p.FromNumber)
	}
	data.Set("Body", message)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(data.Encode()))
	if err != nil {
		return nil, err
	}
	req.SetBasicAuth(p.AccountSid, p.AuthToken)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("twilio API request failed: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, _ := io.ReadAll(resp.Body)
	bodyStr := string(bodyBytes)

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("twilio rejected message (status %d): %s", resp.StatusCode, bodyStr)
	}

	var twilioResp struct {
		Sid    string `json:"sid"`
		Status string `json:"status"`
	}
	_ = json.Unmarshal(bodyBytes, &twilioResp)

	return &SMSDeliveryReceipt{
		Provider:    "twilio",
		MessageID:   twilioResp.Sid,
		Status:      twilioResp.Status,
		RawResponse: bodyStr,
		Timestamp:   time.Now(),
	}, nil
}

// GreenwebSMSProvider implements SMSProvider for Greenweb Bangladesh.
type GreenwebSMSProvider struct {
	Token   string
	BaseURL string // Overrideable for tests
}

func (p *GreenwebSMSProvider) Name() string { return "greenweb" }

func (p *GreenwebSMSProvider) SendSMS(ctx context.Context, toE164, message string) (*SMSDeliveryReceipt, error) {
	if p.Token == "" {
		return nil, fmt.Errorf("%w: Greenweb Token is required", ErrProviderUnconfigured)
	}

	endpoint := p.BaseURL
	if endpoint == "" {
		endpoint = "https://api.greenweb.com.bd/api.php"
	}

	// Greenweb accepts format e.g. 01XXXXXXXXX or 8801XXXXXXXXX
	gwNumber := strings.TrimPrefix(toE164, "+")

	data := url.Values{}
	data.Set("token", p.Token)
	data.Set("to", gwNumber)
	data.Set("message", message)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(data.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("greenweb API request failed: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, _ := io.ReadAll(resp.Body)
	bodyStr := string(bodyBytes)

	if resp.StatusCode < 200 || resp.StatusCode >= 300 || strings.Contains(strings.ToLower(bodyStr), "error") {
		return nil, fmt.Errorf("greenweb rejected message: %s", bodyStr)
	}

	return &SMSDeliveryReceipt{
		Provider:    "greenweb",
		MessageID:   fmt.Sprintf("gw_%d", time.Now().UnixNano()),
		Status:      "submitted",
		RawResponse: bodyStr,
		Timestamp:   time.Now(),
	}, nil
}

// GenericHTTPSMSProvider implements SMSProvider for arbitrary REST gateways.
type GenericHTTPSMSProvider struct {
	URL      string
	Key      string
	SenderID string
}

func (p *GenericHTTPSMSProvider) Name() string { return "generic_http" }

func (p *GenericHTTPSMSProvider) SendSMS(ctx context.Context, toE164, message string) (*SMSDeliveryReceipt, error) {
	if p.URL == "" {
		return nil, fmt.Errorf("%w: generic SMS Gateway URL is unconfigured", ErrProviderUnconfigured)
	}

	payload := map[string]string{
		"to":        toE164,
		"message":   message,
		"sender_id": p.SenderID,
	}
	jsonBytes, _ := json.Marshal(payload)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.URL, bytes.NewReader(jsonBytes))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	if p.Key != "" {
		req.Header.Set("Authorization", "Bearer "+p.Key)
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("generic gateway request failed: %w", err)
	}
	defer resp.Body.Close()

	bodyBytes, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("generic gateway rejected message (status %d): %s", resp.StatusCode, string(bodyBytes))
	}

	return &SMSDeliveryReceipt{
		Provider:    "generic_http",
		MessageID:   fmt.Sprintf("gen_%d", time.Now().UnixNano()),
		Status:      "accepted",
		RawResponse: string(bodyBytes),
		Timestamp:   time.Now(),
	}, nil
}

// MockSMSProvider records SMS messages in-memory for testing.
type MockSMSProvider struct{}

func (p *MockSMSProvider) Name() string { return "mock" }

func (p *MockSMSProvider) SendSMS(ctx context.Context, toE164, message string) (*SMSDeliveryReceipt, error) {
	globalMockStore.AddSMS(toE164, message, "")
	return &SMSDeliveryReceipt{
		Provider:  "mock",
		MessageID: fmt.Sprintf("mock_%d", time.Now().UnixNano()),
		Status:    "accepted",
		Timestamp: time.Now(),
	}, nil
}

// ─────────────────────────────────────────────────────────────────────────────
// CENTRAL OTP DISPATCH & VERIFY PIPELINE
// ─────────────────────────────────────────────────────────────────────────────

// DispatchOTP handles rate limiting, cooldown, allowlist checks, generation, HMAC hashing,
// atomic challenge persistence, and delivery dispatch.
func DispatchOTP(ctx context.Context, conn *pgx.Conn, userID, destination, method, challengeType, clientIP string) (challengeToken, destinationMasked, debugCode string, err error) {
	cfg := getOTPDeliveryConfig()

	// 1. Rate Limiting
	if err := CheckOTPRateLimits(ctx, clientIP, destination, userID); err != nil {
		return "", "", "", err
	}

	// 2. Resend Cooldown
	cooldownActive, remainingSecs, _ := CheckOTPCooldown(ctx, challengeType, destination)
	if cooldownActive {
		return "", "", "", fmt.Errorf("%w: please wait %d seconds before requesting another code", ErrCooldownActive, remainingSecs)
	}

	// 3. Normalize destination
	isPhone := method == "phone"
	normalizedDest := destination
	if isPhone {
		normalizedDest, err = NormalizeE164(destination)
		if err != nil {
			return "", "", "", fmt.Errorf("invalid phone number: %w", err)
		}
	} else {
		normalizedDest = strings.ToLower(strings.TrimSpace(destination))
	}

	// 4. Validate dev recipient allowlist
	if err := cfg.ValidateRecipient(normalizedDest, isPhone); err != nil {
		return "", "", "", err
	}

	// 5. Generate cryptographically secure OTP & challenge token
	otp, err := generateCryptographicOTP()
	if err != nil {
		return "", "", "", fmt.Errorf("failed to generate verification code: %w", err)
	}

	token, err := generateRandomBase64URL(32)
	if err != nil {
		return "", "", "", fmt.Errorf("failed to generate challenge token: %w", err)
	}

	// 6. Invalidate previous active challenges for this user and purpose
	if userID != "" {
		_, _ = conn.Exec(ctx, `DELETE FROM auth_challenges WHERE user_id=$1 AND challenge_type=$2`, userID, challengeType)
	}

	// 7. Compute HMAC digest of OTP
	hmacDigest := ComputeOTPHMAC(cfg.HMACSecret, token, otp)

	// 8. Record challenge with 5-minute expiration
	masked := maskRecoveryDestination(normalizedDest, method)
	expiresAt := time.Now().Add(5 * time.Minute)

	_, err = conn.Exec(ctx, `
		INSERT INTO auth_challenges (user_id, challenge_type, challenge_token, verification_code, destination, expires_at)
		VALUES (NULLIF($1, '')::uuid, $2, $3, $4, $5, $6)
	`, userID, challengeType, token, hmacDigest, normalizedDest, expiresAt)
	if err != nil {
		return "", "", "", fmt.Errorf("failed to store challenge record: %w", err)
	}

	// 9. Dispatch via outbound delivery provider
	if isPhone {
		_, err = SendSMSOTP(ctx, cfg, activeSMSProvider, normalizedDest, otp, challengeType)
	} else {
		err = SendEmailOTP(ctx, cfg, normalizedDest, otp, challengeType)
	}
	if err != nil {
		// Clean up the created challenge if delivery failed
		_, _ = conn.Exec(ctx, `DELETE FROM auth_challenges WHERE challenge_token=$1`, token)
		return "", "", "", fmt.Errorf("%w: %v", ErrDeliveryFailed, err)
	}

	// 10. Record 60-second cooldown in Redis
	RecordOTPCooldown(ctx, challengeType, normalizedDest)

	// Debug code is exposed ONLY in mock mode for unit tests. In live delivery mode, it is NEVER exposed.
	returnTokenCode := ""
	if cfg.DeliveryMode == "mock" {
		returnTokenCode = otp
	}

	return token, masked, returnTokenCode, nil
}

// VerifyChallengeOTP validates an OTP submission against an auth_challenges record.
// Enforces 5 maximum verification attempts, constant-time HMAC check, single-use atomic consumption.
func VerifyChallengeOTP(ctx context.Context, conn *pgx.Conn, challengeToken, candidateCode, expectedType string) (challengeID, userID, destination string, err error) {
	cfg := getOTPDeliveryConfig()
	challengeToken = strings.TrimSpace(challengeToken)
	candidateCode = strings.TrimSpace(candidateCode)

	if challengeToken == "" || candidateCode == "" {
		return "", "", "", errors.New("challenge_token and code are required")
	}

	// 1. Check attempt counter
	attempts, exceeded, _ := CheckAndIncrementOTPAttempts(ctx, challengeToken)
	if exceeded {
		// Invalidate challenge immediately
		_, _ = conn.Exec(ctx, `DELETE FROM auth_challenges WHERE challenge_token=$1`, challengeToken)
		ClearOTPAttempts(ctx, challengeToken)
		return "", "", "", fmt.Errorf("%w: challenge has been invalidated after %d failed attempts", ErrMaxAttemptsExceeded, attempts)
	}

	// 2. Fetch challenge record
	var chID, uid, chType, storedCode, dest string
	var expiresAt time.Time
	var uidNullable *string

	err = conn.QueryRow(ctx, `
		SELECT id::text, user_id::text, challenge_type, verification_code, destination, expires_at
		FROM auth_challenges
		WHERE challenge_token=$1
	`, challengeToken).Scan(&chID, &uidNullable, &chType, &storedCode, &dest, &expiresAt)
	if err != nil {
		return "", "", "", ErrChallengeExpired
	}

	if uidNullable != nil {
		uid = *uidNullable
	}

	// 3. Verify challenge type
	if expectedType != "" && chType != expectedType {
		return "", "", "", fmt.Errorf("unexpected challenge type '%s' (expected '%s')", chType, expectedType)
	}

	// 4. Check expiration
	if time.Now().After(expiresAt) {
		_, _ = conn.Exec(ctx, `DELETE FROM auth_challenges WHERE id=$1`, chID)
		ClearOTPAttempts(ctx, challengeToken)
		return "", "", "", ErrChallengeExpired
	}

	// 5. Constant-time verification
	if !VerifyOTPHMAC(cfg.HMACSecret, challengeToken, storedCode, candidateCode) {
		return "", "", "", ErrInvalidOTP
	}

	// 6. Verification successful! Atomically consume single-use challenge
	_, _ = conn.Exec(ctx, `DELETE FROM auth_challenges WHERE id=$1`, chID)
	ClearOTPAttempts(ctx, challengeToken)

	return chID, uid, dest, nil
}
