package main

// Recovery challenge/verify/change-password flow tests (require PostgreSQL).
// These execute in CI with the compose stack; without a database they fail
// at setup like every other DB test in this package.

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

// requireRecoveryStack skips when the live stack is unreachable. The flow
// handlers fail closed without Redis (same doctrine as login), and `go test`
// never runs main(), so the package client is wired here instead of
// asserting on a nil limiter. Redis is flushed so per-IP attempt budgets are
// deterministic across reruns.
func requireRecoveryStack(t *testing.T) {
	t.Helper()
	for _, addr := range []string{"127.0.0.1:5432", "127.0.0.1:6379"} {
		c, err := net.DialTimeout("tcp", addr, 2*time.Second)
		if err != nil {
			t.Skipf("stack unavailable at %s: %v", addr, err)
		}
		c.Close()
	}
	redisClient = redis.NewClient(&redis.Options{Addr: "127.0.0.1:6379"})
	if err := redisClient.FlushDB(context.Background()).Err(); err != nil {
		t.Skipf("redis flush failed: %v", err)
	}
}

func recoveryPost(t *testing.T, handler http.HandlerFunc, body string, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/v1/auth/recovery", bytes.NewReader([]byte(body)))
	for _, c := range cookies {
		req.AddCookie(c)
	}
	rec := httptest.NewRecorder()
	handler(rec, req)
	return rec
}

func TestRecoveryVerifyFlow(t *testing.T) {
	requireRecoveryStack(t)
	db := setupTestDB(t)
	defer db.Close()

	_, ownerID, _, _ := createTestOrgAndUsers(t, db)

	// Enroll a deterministic Ed25519 verifier for the owner.
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	pkB64 := base64.StdEncoding.EncodeToString(pub)
	ownerToken := createTestSession(t, db, ownerID)
	enrollReq := httptest.NewRequest(http.MethodPost, "/v1/auth/recovery-enroll",
		bytes.NewReader([]byte(`{"recovery_auth_pk":"`+pkB64+`"}`)))
	enrollReq.AddCookie(&http.Cookie{Name: "byos_session", Value: ownerToken})
	enrollRec := httptest.NewRecorder()
	recoveryEnrollHandler(enrollRec, enrollReq)
	if enrollRec.Code != http.StatusCreated {
		t.Fatalf("enroll status = %d, want 201: %s", enrollRec.Code, enrollRec.Body.String())
	}

	// Look up owner email for the challenge step.
	var email string
	if err := db.QueryRow(`SELECT email FROM users WHERE id=$1`, ownerID).Scan(&email); err != nil {
		t.Fatal(err)
	}

	// Challenge persists a row.
	chRec := recoveryPost(t, recoveryChallengeHandler, `{"email":"`+email+`"}`)
	if chRec.Code != http.StatusOK {
		t.Fatalf("challenge status = %d, want 200: %s", chRec.Code, chRec.Body.String())
	}
	var ch struct {
		ChallengeID string `json:"challenge_id"`
		ExpiresAt   string `json:"expires_at"`
	}
	if err := json.NewDecoder(chRec.Body).Decode(&ch); err != nil || ch.ChallengeID == "" {
		t.Fatalf("bad challenge body: %s, %v", chRec.Body.String(), err)
	}
	var persisted int
	if err := db.QueryRow(`SELECT count(*) FROM recovery_challenges WHERE challenge_id=$1 AND consumed_at IS NULL`, ch.ChallengeID).Scan(&persisted); err != nil || persisted != 1 {
		t.Fatalf("challenge not persisted: count=%d err=%v", persisted, err)
	}

	// Unknown email yields the same shape without persisting.
	chFake := recoveryPost(t, recoveryChallengeHandler, `{"email":"nobody-`+ch.ChallengeID+`@byos.local"}`)
	if chFake.Code != http.StatusOK {
		t.Fatalf("fake challenge status = %d, want 200", chFake.Code)
	}
	var chFakeBody struct {
		ChallengeID string `json:"challenge_id"`
	}
	if err := json.NewDecoder(chFake.Body).Decode(&chFakeBody); err != nil || chFakeBody.ChallengeID == "" {
		t.Fatalf("fake challenge must keep response shape")
	}
	if err := db.QueryRow(`SELECT count(*) FROM recovery_challenges WHERE challenge_id=$1`, chFakeBody.ChallengeID).Scan(&persisted); err != nil || persisted != 0 {
		t.Fatalf("fake challenge must not persist: count=%d", persisted)
	}

	// Verify with a real signature restores access (session cookie).
	sig := ed25519.Sign(priv, recoveryChallengeMessage(ch.ChallengeID))
	verifyRec := recoveryPost(t, recoveryVerifyHandler,
		`{"challenge_id":"`+ch.ChallengeID+`","signature":"`+base64.StdEncoding.EncodeToString(sig)+`"}`)
	if verifyRec.Code != http.StatusOK {
		t.Fatalf("verify status = %d, want 200: %s", verifyRec.Code, verifyRec.Body.String())
	}
	var setCookie bool
	for _, c := range verifyRec.Result().Cookies() {
		if c.Name == "byos_session" && c.Value != "" && c.HttpOnly {
			setCookie = true
		}
	}
	if !setCookie {
		t.Fatal("verify must set HttpOnly byos_session cookie")
	}
	// Single-use: replay fails.
	replayRec := recoveryPost(t, recoveryVerifyHandler,
		`{"challenge_id":"`+ch.ChallengeID+`","signature":"`+base64.StdEncoding.EncodeToString(sig)+`"}`)
	if replayRec.Code == http.StatusOK {
		t.Fatal("challenge replay must fail")
	}

	// Wrong signature fails without distinguishing the reason.
	ch2Rec := recoveryPost(t, recoveryChallengeHandler, `{"email":"`+email+`"}`)
	var ch2 struct {
		ChallengeID string `json:"challenge_id"`
	}
	if err := json.NewDecoder(ch2Rec.Body).Decode(&ch2); err != nil {
		t.Fatal(err)
	}
	badSig := ed25519.Sign(priv, recoveryChallengeMessage("00000000-0000-0000-0000-000000000000"))
	badRec := recoveryPost(t, recoveryVerifyHandler,
		`{"challenge_id":"`+ch2.ChallengeID+`","signature":"`+base64.StdEncoding.EncodeToString(badSig)+`"}`)
	if badRec.Code == http.StatusOK {
		t.Fatal("wrong-message signature must fail")
	}

	// Change password over the recovered session, old sessions die.
	var newSessionCookie *http.Cookie
	for _, c := range verifyRec.Result().Cookies() {
		if c.Name == "byos_session" {
			newSessionCookie = c
		}
	}
	cpRec := recoveryPost(t, changePasswordHandler, `{"new_password":"new-strong-pass-1"}`, newSessionCookie)
	if cpRec.Code != http.StatusNoContent {
		t.Fatalf("change-password status = %d, want 204: %s", cpRec.Code, cpRec.Body.String())
	}
	// Old session revoked.
	meOld := httptest.NewRequest(http.MethodGet, "/v1/auth/me", nil)
	meOld.AddCookie(&http.Cookie{Name: "byos_session", Value: ownerToken})
	meOldRec := httptest.NewRecorder()
	meHandler(meOldRec, meOld)
	if meOldRec.Code == http.StatusOK {
		t.Fatal("pre-recovery session must be revoked after password change")
	}
	// Current session survives.
	meNew := httptest.NewRequest(http.MethodGet, "/v1/auth/me", nil)
	meNew.AddCookie(newSessionCookie)
	meNewRec := httptest.NewRecorder()
	meHandler(meNewRec, meNew)
	if meNewRec.Code != http.StatusOK {
		t.Fatalf("recovered session must survive password change: %d", meNewRec.Code)
	}
}

func TestRecoveryEnrollRotation(t *testing.T) {
	requireRecoveryStack(t)
	db := setupTestDB(t)
	defer db.Close()

	_, ownerID, _, _ := createTestOrgAndUsers(t, db)
	ownerToken := createTestSession(t, db, ownerID)
	enroll := func(pkB64 string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/v1/auth/recovery-enroll",
			bytes.NewReader([]byte(`{"recovery_auth_pk":"`+pkB64+`"}`)))
		req.AddCookie(&http.Cookie{Name: "byos_session", Value: ownerToken})
		rec := httptest.NewRecorder()
		recoveryEnrollHandler(rec, req)
		return rec
	}
	pub1, _, _ := ed25519.GenerateKey(rand.Reader)
	if rec := enroll(base64.StdEncoding.EncodeToString(pub1)); rec.Code != http.StatusCreated {
		t.Fatalf("first enroll = %d, want 201", rec.Code)
	}
	// Rotation (e.g. after root rotation) overwrites instead of 409.
	pub2, _, _ := ed25519.GenerateKey(rand.Reader)
	if rec := enroll(base64.StdEncoding.EncodeToString(pub2)); rec.Code != http.StatusOK {
		t.Fatalf("re-enroll = %d, want 200", rec.Code)
	}
	var stored []byte
	if err := db.QueryRow(`SELECT recovery_auth_pk FROM users WHERE id=$1`, ownerID).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if string(stored) != string(pub2) {
		t.Fatal("rotation must replace the verifier")
	}
}
