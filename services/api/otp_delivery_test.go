package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"
)

// setupMockRedis initializes an in-memory or local disposable Redis client for testing.
func setupMockRedis(t *testing.T) *redis.Client {
	t.Helper()
	c, err := net.DialTimeout("tcp", "127.0.0.1:6379", 1*time.Second)
	if err != nil {
		t.Skip("local Redis at 127.0.0.1:6379 unavailable, skipping Redis-dependent tests")
		return nil
	}
	c.Close()

	rClient := redis.NewClient(&redis.Options{Addr: "127.0.0.1:6379"})
	_ = rClient.FlushDB(context.Background()).Err()
	return rClient
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. RECIPIENT ALLOWLIST & BANGLADESH E.164 NORMALIZATION TESTS
// ─────────────────────────────────────────────────────────────────────────────

func TestBangladeshE164Normalization(t *testing.T) {
	testCases := []struct {
		input       string
		expected    string
		expectError bool
	}{
		{"+8801617856836", "+8801617856836", false},
		{"01617856836", "+8801617856836", false},
		{"8801617856836", "+8801617856836", false},
		{"01712345678", "+8801712345678", false},
		{"01812345678", "+8801812345678", false},
		{"01912345678", "+8801912345678", false},
		{"01512345678", "+8801512345678", false},
		{"01312345678", "+8801312345678", false},
		{"01412345678", "+8801412345678", false},
		{"+14155552671", "+14155552671", false},
		{"invalid", "", true},
		{"123", "", true},
		{"", "", true},
	}

	for _, tc := range testCases {
		res, err := NormalizeE164(tc.input)
		if tc.expectError {
			if err == nil {
				t.Errorf("NormalizeE164(%q) expected error, got %q", tc.input, res)
			}
		} else {
			if err != nil {
				t.Errorf("NormalizeE164(%q) unexpected error: %v", tc.input, err)
			}
			if res != tc.expected {
				t.Errorf("NormalizeE164(%q) = %q, expected %q", tc.input, res, tc.expected)
			}
		}
	}
}

func TestDevRecipientAllowlistEnforcement(t *testing.T) {
	t.Setenv("BYOS_ENV", "development")

	cfg := &OTPDeliveryConfig{
		DeliveryMode:           "live",
		DevAllowedEmails:       []string{"abdullahrawha30@gmail.com"},
		DevAllowedPhoneNumbers: []string{"+8801617856836"},
	}

	// Allowed destinations
	if err := cfg.ValidateRecipient("abdullahrawha30@gmail.com", false); err != nil {
		t.Errorf("expected abdullahrawha30@gmail.com to be allowed, got error: %v", err)
	}
	if err := cfg.ValidateRecipient("ABDULLAHRAWHA30@GMAIL.COM", false); err != nil {
		t.Errorf("expected case-insensitive email match, got error: %v", err)
	}
	if err := cfg.ValidateRecipient("+8801617856836", true); err != nil {
		t.Errorf("expected +8801617856836 to be allowed, got error: %v", err)
	}
	if err := cfg.ValidateRecipient("01617856836", true); err != nil {
		t.Errorf("expected 01617856836 (local format) to be normalized and allowed, got: %v", err)
	}

	// Forbidden arbitrary destinations
	if err := cfg.ValidateRecipient("attacker@evil.com", false); err == nil {
		t.Errorf("expected arbitrary email attacker@evil.com to be rejected in development")
	}
	if err := cfg.ValidateRecipient("+8801700000000", true); err == nil {
		t.Errorf("expected arbitrary phone number to be rejected in development")
	}

	// In production, allowlist is bypassed
	t.Setenv("BYOS_ENV", "production")
	if err := cfg.ValidateRecipient("arbitrary-user@company.com", false); err != nil {
		t.Errorf("expected allowlist check to be bypassed in production, got: %v", err)
	}
	if err := cfg.ValidateRecipient("+14155552671", true); err != nil {
		t.Errorf("expected phone allowlist to be bypassed in production, got: %v", err)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. CRYPTOGRAPHIC OTP & HMAC VERIFICATION TESTS
// ─────────────────────────────────────────────────────────────────────────────

func TestCryptographicOTPGenerationAndHMAC(t *testing.T) {
	secret := []byte("test-dedicated-hmac-secret-1234567890!")
	token := "sample_challenge_token_abc123"

	// 1. Generate code
	code, err := generateCryptographicOTP()
	if err != nil {
		t.Fatalf("failed to generate OTP: %v", err)
	}
	if len(code) != 6 {
		t.Fatalf("expected 6-digit code, got %q", code)
	}

	// 2. Compute HMAC
	digest := ComputeOTPHMAC(secret, token, code)
	if !strings.HasPrefix(digest, "hmac:") {
		t.Fatalf("expected digest to start with 'hmac:', got %q", digest)
	}

	// 3. Constant-time verification
	if !VerifyOTPHMAC(secret, token, digest, code) {
		t.Fatalf("expected valid OTP to verify successfully against HMAC")
	}

	// 4. Invalid code rejection
	if VerifyOTPHMAC(secret, token, digest, "999999") {
		t.Fatalf("expected wrong OTP code to be rejected")
	}

	// 5. Wrong token rejection (binding to challenge)
	if VerifyOTPHMAC(secret, "different_token", digest, code) {
		t.Fatalf("expected HMAC check to fail when challenge token differs")
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. SMS PROVIDER SUBMISSION & REJECTION TESTS
// ─────────────────────────────────────────────────────────────────────────────

func TestTwilioSMSProviderSubmissionAndRejection(t *testing.T) {
	var receivedAuthHeader, receivedTo, receivedBody string
	shouldFail := false
	shouldTimeout := false

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if shouldTimeout {
			time.Sleep(200 * time.Millisecond)
			return
		}
		receivedAuthHeader = r.Header.Get("Authorization")
		_ = r.ParseForm()
		receivedTo = r.FormValue("To")
		receivedBody = r.FormValue("Body")

		if shouldFail {
			w.WriteHeader(http.StatusBadRequest)
			w.Write([]byte(`{"code": 21614, "message": "To number is not a valid mobile number"}`))
			return
		}

		w.WriteHeader(http.StatusCreated)
		w.Write([]byte(`{"sid": "SM1234567890abcdef", "status": "queued"}`))
	}))
	defer server.Close()

	provider := &TwilioSMSProvider{
		AccountSid: "AC_TEST_ACCOUNT_SID",
		AuthToken:  "TEST_AUTH_TOKEN",
		FromNumber: "+15017122661",
		BaseURL:    server.URL,
	}

	// 1. Successful submission
	ctx := context.Background()
	receipt, err := provider.SendSMS(ctx, "+8801617856836", "Your BYOS code is 123456")
	if err != nil {
		t.Fatalf("expected Twilio success, got: %v", err)
	}
	if receipt.MessageID != "SM1234567890abcdef" {
		t.Errorf("expected MessageID SM1234567890abcdef, got %s", receipt.MessageID)
	}
	if receipt.Status != "queued" {
		t.Errorf("expected status queued, got %s", receipt.Status)
	}
	if receivedTo != "+8801617856836" {
		t.Errorf("expected To +8801617856836, got %s", receivedTo)
	}
	if !strings.HasPrefix(receivedAuthHeader, "Basic ") {
		t.Errorf("expected Basic Auth header, got %s", receivedAuthHeader)
	}
	if !strings.Contains(receivedBody, "123456") {
		t.Errorf("expected Body to contain 123456, got %s", receivedBody)
	}

	// 2. Provider rejection
	shouldFail = true
	_, err = provider.SendSMS(ctx, "+8801617856836", "Your code")
	if err == nil {
		t.Fatalf("expected Twilio rejection error, got nil")
	}
	if !strings.Contains(err.Error(), "rejected message") {
		t.Errorf("expected rejected message error, got %v", err)
	}

	// 3. Provider timeout
	shouldFail = false
	shouldTimeout = true
	timeoutCtx, cancel := context.WithTimeout(ctx, 50*time.Millisecond)
	defer cancel()
	_, err = provider.SendSMS(timeoutCtx, "+8801617856836", "Your code")
	if err == nil {
		t.Fatalf("expected timeout error, got nil")
	}

	// 4. Unconfigured credentials
	emptyProvider := &TwilioSMSProvider{}
	_, err = emptyProvider.SendSMS(ctx, "+8801617856836", "Your code")
	if err == nil || !strings.Contains(err.Error(), "required") {
		t.Errorf("expected error on missing credentials, got %v", err)
	}
}

func TestGreenwebSMSProviderSubmission(t *testing.T) {
	var receivedToken, receivedTo, receivedMessage string
	shouldFail := false

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		receivedToken = r.FormValue("token")
		receivedTo = r.FormValue("to")
		receivedMessage = r.FormValue("message")

		if shouldFail {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte(`Error: Invalid Token`))
			return
		}

		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`Ok: 1 SMS Sent Successfully`))
	}))
	defer server.Close()

	gw := &GreenwebSMSProvider{
		Token:   "sample_greenweb_api_token",
		BaseURL: server.URL,
	}

	// 1. Success
	ctx := context.Background()
	receipt, err := gw.SendSMS(ctx, "+8801617856836", "Your BYOS code is 654321")
	if err != nil {
		t.Fatalf("expected Greenweb success, got: %v", err)
	}
	if receipt.Provider != "greenweb" {
		t.Errorf("expected provider greenweb, got %s", receipt.Provider)
	}
	if receivedTo != "8801617856836" { // Trimmed +
		t.Errorf("expected To 8801617856836, got %s", receivedTo)
	}
	if receivedToken != "sample_greenweb_api_token" {
		t.Errorf("expected token sample_greenweb_api_token, got %s", receivedToken)
	}
	if !strings.Contains(receivedMessage, "654321") {
		t.Errorf("expected message to contain 654321, got %s", receivedMessage)
	}

	// 2. Rejection
	shouldFail = true
	_, err = gw.SendSMS(ctx, "+8801617856836", "Your code")
	if err == nil || !strings.Contains(err.Error(), "greenweb rejected") {
		t.Errorf("expected rejection error, got %v", err)
	}
}

func TestGenericHTTPSMSProvider(t *testing.T) {
	var receivedBody map[string]string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(b, &receivedBody)
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status": "ok"}`))
	}))
	defer server.Close()

	provider := &GenericHTTPSMSProvider{
		URL:      server.URL,
		Key:      "sample_generic_key",
		SenderID: "BYOS",
	}

	ctx := context.Background()
	receipt, err := provider.SendSMS(ctx, "+8801617856836", "Test OTP: 112233")
	if err != nil {
		t.Fatalf("expected generic gateway success, got: %v", err)
	}
	if receipt.Provider != "generic_http" {
		t.Errorf("expected generic_http provider, got %s", receipt.Provider)
	}
	if receivedBody["to"] != "+8801617856836" {
		t.Errorf("expected to +8801617856836, got %s", receivedBody["to"])
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. EMAIL PROVIDER SUBMISSION & TEMPLATE TESTS
// ─────────────────────────────────────────────────────────────────────────────

func TestEmailOTPTemplateRendering(t *testing.T) {
	html := renderEmailOTPTemplate("482910", "login_2fa")
	if !strings.Contains(html, "482910") {
		t.Errorf("expected HTML template to contain code 482910")
	}
	if !strings.Contains(html, "#9E725F") {
		t.Errorf("expected HTML template to feature BYOS brand color #9E725F")
	}
	if !strings.Contains(html, "Two-Factor Sign-In") {
		t.Errorf("expected purpose title 'Two-Factor Sign-In', got %s", html)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. RESEND COOLDOWN, ATTEMPT COUNTER, AND RATE LIMITING TESTS
// ─────────────────────────────────────────────────────────────────────────────

func TestResendCooldownEnforcement(t *testing.T) {
	rClient := setupMockRedis(t)
	if rClient == nil {
		return
	}
	redisClient = rClient

	ctx := context.Background()
	purpose := "login_2fa"
	dest := "test_dest@byos.local"

	// 1. Initial check - no cooldown
	active, _, err := CheckOTPCooldown(ctx, purpose, dest)
	if err != nil || active {
		t.Fatalf("expected no cooldown initially, got active=%v, err=%v", active, err)
	}

	// 2. Record cooldown
	RecordOTPCooldown(ctx, purpose, dest)

	// 3. Check again - cooldown should be active
	active, remaining, err := CheckOTPCooldown(ctx, purpose, dest)
	if err != nil || !active {
		t.Fatalf("expected cooldown to be active, got active=%v, err=%v", active, err)
	}
	if remaining <= 0 || remaining > 60 {
		t.Errorf("expected remaining seconds between 1 and 60, got %d", remaining)
	}
}

func TestMaximumVerificationAttemptsInvalidation(t *testing.T) {
	rClient := setupMockRedis(t)
	if rClient == nil {
		return
	}
	redisClient = rClient

	ctx := context.Background()
	token := "challenge_token_attempts_test"

	for i := 1; i <= 5; i++ {
		attempts, exceeded, err := CheckAndIncrementOTPAttempts(ctx, token)
		if err != nil {
			t.Fatalf("increment attempt %d failed: %v", i, err)
		}
		if attempts != i {
			t.Errorf("expected attempt %d, got %d", i, attempts)
		}
		if exceeded {
			t.Errorf("expected exceeded to be false on attempt %d", i)
		}
	}

	// 6th attempt: must exceed max attempts
	attempts, exceeded, err := CheckAndIncrementOTPAttempts(ctx, token)
	if err != nil {
		t.Fatalf("attempt 6 failed: %v", err)
	}
	if attempts != 6 || !exceeded {
		t.Errorf("expected attempt 6 with exceeded=true, got attempts=%d, exceeded=%v", attempts, exceeded)
	}

	// Clear attempts
	ClearOTPAttempts(ctx, token)
	attempts, _, _ = CheckAndIncrementOTPAttempts(ctx, token)
	if attempts != 1 {
		t.Errorf("expected reset attempt count to 1 after clear, got %d", attempts)
	}
}

func TestOTPRateLimiting(t *testing.T) {
	rClient := setupMockRedis(t)
	if rClient == nil {
		return
	}
	redisClient = rClient

	ctx := context.Background()
	ip := "192.168.1.50"
	dest := "ratelimit_dest@byos.local"
	userID := "00000000-0000-0000-0000-000000000099"

	// Destination rate limit: max 3 per 10 minutes
	for i := 1; i <= 3; i++ {
		if err := CheckOTPRateLimits(ctx, ip, dest, userID); err != nil {
			t.Fatalf("expected attempt %d to pass rate limits, got error: %v", i, err)
		}
	}

	// 4th attempt for same destination should be rate limited
	err := CheckOTPRateLimits(ctx, ip, dest, userID)
	if err == nil || !errors.Is(err, ErrRateLimitExceeded) {
		t.Errorf("expected destination rate limit exceeded error on 4th attempt, got %v", err)
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. END-TO-END DISPATCH & VERIFY INTEGRATION TEST (DISPOSABLE DB)
// ─────────────────────────────────────────────────────────────────────────────

func TestDispatchAndVerifyOTPEndToEnd(t *testing.T) {
	testDBURL := os.Getenv("TEST_DATABASE_URL")
	if testDBURL == "" {
		t.Skip("skipping database integration test: TEST_DATABASE_URL environment variable is not set")
	}

	ctx := context.Background()
	conn, err := pgx.Connect(ctx, testDBURL)
	if err != nil {
		t.Fatalf("failed to connect to test database: %v", err)
	}
	defer conn.Close(ctx)

	rClient := setupMockRedis(t)
	if rClient != nil {
		redisClient = rClient
	}

	t.Setenv("BYOS_ENV", "development")
	t.Setenv("OTP_DELIVERY_MODE", "mock")

	globalMockStore.Reset()

	destEmail := "abdullahrawha30@gmail.com"
	clientIP := "127.0.0.1"

	var userID string
	err = conn.QueryRow(ctx, `SELECT id::text FROM users LIMIT 1`).Scan(&userID)
	if err != nil {
		t.Fatalf("failed to query test user from database: %v", err)
	}

	// 1. Dispatch OTP
	token, masked, debugCode, err := DispatchOTP(ctx, conn, userID, destEmail, "email", "login_2fa", clientIP)
	if err != nil {
		t.Fatalf("DispatchOTP failed: %v", err)
	}
	if token == "" || len(token) < 16 {
		t.Fatalf("expected valid challenge token, got %q", token)
	}
	if debugCode == "" || len(debugCode) != 6 {
		t.Fatalf("expected 6-digit debug code in mock mode, got %q", debugCode)
	}
	if !strings.Contains(masked, "***") {
		t.Errorf("expected masked destination, got %q", masked)
	}

	// 2. Assert mock store received message
	if len(globalMockStore.Emails) != 1 {
		t.Fatalf("expected 1 mock email dispatched, got %d", len(globalMockStore.Emails))
	}
	if globalMockStore.Emails[0].To != destEmail {
		t.Errorf("expected mock email to %s, got %s", destEmail, globalMockStore.Emails[0].To)
	}

	// 3. Assert database storage is HMAC-protected (NO PLAINTEXT OTP IN DB!)
	var storedVerificationCode string
	err = conn.QueryRow(ctx, `SELECT verification_code FROM auth_challenges WHERE challenge_token=$1`, token).Scan(&storedVerificationCode)
	if err != nil {
		t.Fatalf("failed to query stored verification code: %v", err)
	}
	if !strings.HasPrefix(storedVerificationCode, "hmac:") {
		t.Fatalf("SECURITY VIOLATION: verification_code must be HMAC-protected, got %q", storedVerificationCode)
	}
	if strings.Contains(storedVerificationCode, debugCode) {
		t.Fatalf("SECURITY VIOLATION: plaintext OTP found inside verification_code column!")
	}

	// 4. Verify with wrong code: should fail with ErrInvalidOTP
	_, _, _, err = VerifyChallengeOTP(ctx, conn, token, "000000", "login_2fa")
	if !errors.Is(err, ErrInvalidOTP) {
		t.Fatalf("expected ErrInvalidOTP on wrong code, got: %v", err)
	}

	// 5. Verify with correct code: must succeed and atomically delete challenge (single-use)
	_, verifiedUID, verifiedDest, err := VerifyChallengeOTP(ctx, conn, token, debugCode, "login_2fa")
	if err != nil {
		t.Fatalf("expected successful OTP verification, got: %v", err)
	}
	if verifiedUID != userID {
		t.Errorf("expected verified userID %s, got %s", userID, verifiedUID)
	}
	if verifiedDest != destEmail {
		t.Errorf("expected verified destination %s, got %s", destEmail, verifiedDest)
	}

	// 6. Assert challenge is consumed and deleted (prevent reuse)
	var count int
	_ = conn.QueryRow(ctx, `SELECT COUNT(*) FROM auth_challenges WHERE challenge_token=$1`, token).Scan(&count)
	if count != 0 {
		t.Fatalf("SECURITY VIOLATION: challenge must be deleted after single-use verification, count=%d", count)
	}

	// 7. Reusing same code on deleted challenge: must fail as expired/consumed
	_, _, _, err = VerifyChallengeOTP(ctx, conn, token, debugCode, "login_2fa")
	if !errors.Is(err, ErrChallengeExpired) {
		t.Fatalf("expected ErrChallengeExpired on reused challenge token, got: %v", err)
	}
}
