package main

// Recovery challenge/verify/change-password flow tests (require PostgreSQL).
// These execute in CI with the compose stack; without a database they fail
// at setup like every other DB test in this package.

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/argon2"
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

func TestMailboxReactivateKeysAuthorization(t *testing.T) {
	requireRecoveryStack(t)
	db := setupTestDB(t)
	defer db.Close()

	orgID, ownerID, adminID, memberID := createTestOrgAndUsers(t, db)

	// Create a second member in the same organization
	var member2ID string
	err := db.QueryRow(`
		INSERT INTO users (org_id, email, display_name, password_hash, is_active, role)
		VALUES ($1, $2, 'Member2', '$2a$10$dummyhashdummyhashdummyhashdummyhashdummyhas', true, 'member')
		RETURNING id
	`, orgID, "member2-"+uuid.New().String()[:8]+"@byos.local").Scan(&member2ID)
	if err != nil {
		t.Fatalf("failed to insert member2: %v", err)
	}

	// Create verified domain
	var domainID string
	err = db.QueryRow(`
		INSERT INTO domains (org_id, name, is_verified)
		VALUES ($1, $2, true)
		RETURNING id
	`, orgID, "test-"+uuid.New().String()[:8]+".local").Scan(&domainID)
	if err != nil {
		t.Fatalf("failed to insert domain: %v", err)
	}

	// Create private mailbox for member1
	var mailboxID string
	initialWrappedSK := `{"salt":"1111","envelope":"initial_envelope_member1"}`
	err = db.QueryRow(`
		INSERT INTO mailboxes (org_id, user_id, domain_id, local_part, mode, is_active, wrapped_sk_user, mailbox_sk_wrapped)
		VALUES ($1, $2, $3, $4, 'private', true, $5, $6)
		RETURNING id
	`, orgID, memberID, domainID, "employee1-"+uuid.New().String()[:8], initialWrappedSK, []byte(initialWrappedSK)).Scan(&mailboxID)
	if err != nil {
		t.Fatalf("failed to insert mailbox: %v", err)
	}

	ownerToken := createTestSession(t, db, ownerID)
	adminToken := createTestSession(t, db, adminID)
	memberToken := createTestSession(t, db, memberID)
	member2Token := createTestSession(t, db, member2ID)

	callReactivate := func(token string, mbID string, newWsk string) *httptest.ResponseRecorder {
		reqBody, _ := json.Marshal(map[string]interface{}{
			"wrapped_sk_user": newWsk,
		})
		req := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mbID+"/reactivate-keys", bytes.NewReader(reqBody))
		req.SetPathValue("mailbox_id", mbID)
		req.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
		rec := httptest.NewRecorder()
		mailboxReactivateKeysHandler(rec, req)
		return rec
	}

	// 1. Organization Owner accessing employee mailbox -> HTTP 403 Forbidden
	recOwner := callReactivate(ownerToken, mailboxID, `{\"salt\":\"2222\",\"envelope\":\"hacked_by_owner\"}`)
	if recOwner.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for org owner, got %d: %s", recOwner.Code, recOwner.Body.String())
	}

	// 2. Organization Administrator accessing employee mailbox -> HTTP 403 Forbidden
	recAdmin := callReactivate(adminToken, mailboxID, `{\"salt\":\"3333\",\"envelope\":\"hacked_by_admin\"}`)
	if recAdmin.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for org admin, got %d: %s", recAdmin.Code, recAdmin.Body.String())
	}

	// 3. Different ordinary employee accessing another employee's mailbox -> HTTP 403 Forbidden
	recMember2 := callReactivate(member2Token, mailboxID, `{\"salt\":\"4444\",\"envelope\":\"hacked_by_member2\"}`)
	if recMember2.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for other member, got %d: %s", recMember2.Code, recMember2.Body.String())
	}

	// 4. Verify database state was NOT modified by unauthorized requests
	var storedWsk string
	if err := db.QueryRow(`SELECT wrapped_sk_user FROM mailboxes WHERE id=$1`, mailboxID).Scan(&storedWsk); err != nil {
		t.Fatalf("failed to query mailbox: %v", err)
	}
	if storedWsk != initialWrappedSK {
		t.Fatalf("cryptographic record was modified by unauthorized requests! got %s, want %s", storedWsk, initialWrappedSK)
	}

	// 5. Non-existent mailbox -> HTTP 404 Not Found
	recNotFound := callReactivate(memberToken, uuid.New().String(), `{\"salt\":\"5555\",\"envelope\":\"new_key\"}`)
	if recNotFound.Code != http.StatusNotFound {
		t.Fatalf("expected 404 Not Found for non-existent mailbox, got %d", recNotFound.Code)
	}

	// 6. Legitimate mailbox owner accessing their own mailbox -> HTTP 200 OK
	legitWsk := `{"salt":"9999","envelope":"legitimate_rewrapped_envelope"}`
	recOwnerLegit := callReactivate(memberToken, mailboxID, legitWsk)
	if recOwnerLegit.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for mailbox owner, got %d: %s", recOwnerLegit.Code, recOwnerLegit.Body.String())
	}

	// 7. Verify database was properly updated by authorized owner
	if err := db.QueryRow(`SELECT wrapped_sk_user FROM mailboxes WHERE id=$1`, mailboxID).Scan(&storedWsk); err != nil {
		t.Fatalf("failed to query mailbox after legitimate update: %v", err)
	}
	if storedWsk != legitWsk {
		t.Fatalf("legitimate update failed to persist key material! got %s, want %s", storedWsk, legitWsk)
	}
}

func TestOwnerOnlyRecoveryContactIsolation(t *testing.T) {
	requireRecoveryStack(t)
	db := setupTestDB(t)
	defer db.Close()

	_, ownerID, adminID, memberID := createTestOrgAndUsers(t, db)

	ownerToken := createTestSession(t, db, ownerID)
	adminToken := createTestSession(t, db, adminID)
	memberToken := createTestSession(t, db, memberID)

	// 1. Owner can access recovery methods
	reqOwnerGet := httptest.NewRequest(http.MethodGet, "/v1/auth/2fa/recovery-methods", nil)
	reqOwnerGet.AddCookie(&http.Cookie{Name: "byos_session", Value: ownerToken})
	recOwnerGet := httptest.NewRecorder()
	recoveryMethodsHandler(recOwnerGet, reqOwnerGet)
	if recOwnerGet.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for owner GET recovery-methods, got %d: %s", recOwnerGet.Code, recOwnerGet.Body.String())
	}

	// 2. Admin cannot access recovery methods -> 403 Forbidden
	reqAdminGet := httptest.NewRequest(http.MethodGet, "/v1/auth/2fa/recovery-methods", nil)
	reqAdminGet.AddCookie(&http.Cookie{Name: "byos_session", Value: adminToken})
	recAdminGet := httptest.NewRecorder()
	recoveryMethodsHandler(recAdminGet, reqAdminGet)
	if recAdminGet.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for admin GET recovery-methods, got %d: %s", recAdminGet.Code, recAdminGet.Body.String())
	}

	// 3. Member cannot access recovery methods -> 403 Forbidden
	reqMemberGet := httptest.NewRequest(http.MethodGet, "/v1/auth/2fa/recovery-methods", nil)
	reqMemberGet.AddCookie(&http.Cookie{Name: "byos_session", Value: memberToken})
	recMemberGet := httptest.NewRecorder()
	recoveryMethodsHandler(recMemberGet, reqMemberGet)
	if recMemberGet.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for member GET recovery-methods, got %d: %s", recMemberGet.Code, recMemberGet.Body.String())
	}

	// 4. Non-owner cannot update recovery methods -> 403 Forbidden
	body := bytes.NewReader([]byte(`{"recovery_email":"attacker@evil.local"}`))
	reqMemberPost := httptest.NewRequest(http.MethodPost, "/v1/auth/2fa/recovery-methods", body)
	reqMemberPost.AddCookie(&http.Cookie{Name: "byos_session", Value: memberToken})
	recMemberPost := httptest.NewRecorder()
	recoveryMethodsHandler(recMemberPost, reqMemberPost)
	if recMemberPost.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for member POST recovery-methods, got %d: %s", recMemberPost.Code, recMemberPost.Body.String())
	}

	// 5. Non-owner cannot send confirmation codes -> 403 Forbidden
	sendBody := bytes.NewReader([]byte(`{"destination":"attacker@evil.local","type":"email"}`))
	reqMemberSend := httptest.NewRequest(http.MethodPost, "/v1/auth/2fa/recovery-methods/send-code", sendBody)
	reqMemberSend.AddCookie(&http.Cookie{Name: "byos_session", Value: memberToken})
	recMemberSend := httptest.NewRecorder()
	recoveryContactSendCodeHandler(recMemberSend, reqMemberSend)
	if recMemberSend.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for member send-code, got %d: %s", recMemberSend.Code, recMemberSend.Body.String())
	}

	// 6. Non-owner requesting recovery options for their email gets "exceptional" and NOT "email" or "phone"
	var memberEmail string
	if err := db.QueryRow(`SELECT email FROM users WHERE id=$1`, memberID).Scan(&memberEmail); err != nil {
		t.Fatal(err)
	}
	optReq := httptest.NewRequest(http.MethodGet, "/v1/auth/recovery/options?email="+memberEmail, nil)
	optRec := httptest.NewRecorder()
	recoveryFlowOptionsHandler(optRec, optReq)
	if optRec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for options, got %d: %s", optRec.Code, optRec.Body.String())
	}
	var optResp struct {
		Email   string `json:"email"`
		Methods []struct {
			Type              string `json:"type"`
			DestinationMasked string `json:"destination_masked"`
		} `json:"methods"`
	}
	if err := json.NewDecoder(optRec.Body).Decode(&optResp); err != nil {
		t.Fatalf("failed to decode options response: %v", err)
	}
	for _, m := range optResp.Methods {
		if m.Type == "email" || m.Type == "phone" {
			t.Fatalf("non-owner email must never expose email or phone recovery methods, got: %s", m.Type)
		}
	}
	hasExceptional := false
	for _, m := range optResp.Methods {
		if m.Type == "exceptional" {
			hasExceptional = true
		}
	}
	if !hasExceptional {
		t.Fatalf("expected 'exceptional' recovery method for non-owner, got %+v", optResp.Methods)
	}

	// 7. Non-owner attempting email recovery request receives 403 Forbidden
	recReqBody := bytes.NewReader([]byte(`{"email":"` + memberEmail + `","method":"email"}`))
	reqRecReq := httptest.NewRequest(http.MethodPost, "/v1/auth/recovery/request", recReqBody)
	recRecReq := httptest.NewRecorder()
	recoveryFlowRequestHandler(recRecReq, reqRecReq)
	if recRecReq.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for non-owner email recovery request, got %d: %s", recRecReq.Code, recRecReq.Body.String())
	}
}

func TestExceptionalRecoveryLifecycle(t *testing.T) {
	requireRecoveryStack(t)
	db := setupTestDB(t)
	defer db.Close()

	orgID, ownerID, adminID, memberID := createTestOrgAndUsers(t, db)

	// Create a second organization and owner for cross-tenant isolation assertion
	org2ID, owner2ID, _, _ := createTestOrgAndUsers(t, db)

	// Create verified domain & private mailbox for member
	var domainID string
	err := db.QueryRow(`
		INSERT INTO domains (org_id, name, is_verified)
		VALUES ($1, $2, true)
		RETURNING id
	`, orgID, "domain-"+uuid.New().String()[:8]+".local").Scan(&domainID)
	if err != nil {
		t.Fatalf("failed to insert domain: %v", err)
	}

	var mailboxID string
	originalWrappedSK := `{"salt":"orig_salt","envelope":"orig_envelope"}`
	err = db.QueryRow(`
		INSERT INTO mailboxes (org_id, user_id, domain_id, local_part, mode, is_active, wrapped_sk_user, mailbox_sk_wrapped)
		VALUES ($1, $2, $3, $4, 'private', true, $5, $6)
		RETURNING id
	`, orgID, memberID, domainID, "user-"+uuid.New().String()[:8], originalWrappedSK, []byte(originalWrappedSK)).Scan(&mailboxID)
	if err != nil {
		t.Fatalf("failed to insert mailbox: %v", err)
	}

	var memberEmail string
	if err := db.QueryRow(`SELECT email FROM users WHERE id=$1`, memberID).Scan(&memberEmail); err != nil {
		t.Fatal(err)
	}

	ownerToken := createTestSession(t, db, ownerID)
	adminToken := createTestSession(t, db, adminID)
	owner2Token := createTestSession(t, db, owner2ID)

	// Step 1: Member initiates exceptional recovery
	reqEx := bytes.NewReader([]byte(`{"email":"` + memberEmail + `","notes":"Lost phone and passkey"}`))
	reqPost := httptest.NewRequest(http.MethodPost, "/v1/auth/recovery/request-exceptional", reqEx)
	recPost := httptest.NewRecorder()
	exceptionalRecoveryRequestHandler(recPost, reqPost)
	if recPost.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for request-exceptional, got %d: %s", recPost.Code, recPost.Body.String())
	}
	var exResp struct {
		Success        bool   `json:"success"`
		RequestID      string `json:"request_id"`
		ChallengeToken string `json:"challenge_token"`
		Message        string `json:"message"`
	}
	if err := json.NewDecoder(recPost.Body).Decode(&exResp); err != nil || exResp.RequestID == "" || exResp.ChallengeToken == "" {
		t.Fatalf("bad request-exceptional body: %s, %v", recPost.Body.String(), err)
	}

	// Step 2: Admin or Member cannot list exceptional recovery requests -> 403 Forbidden
	reqListAdmin := httptest.NewRequest(http.MethodGet, "/v1/organizations/"+orgID+"/exceptional-recovery", nil)
	reqListAdmin.SetPathValue("org_id", orgID)
	reqListAdmin.AddCookie(&http.Cookie{Name: "byos_session", Value: adminToken})
	recListAdmin := httptest.NewRecorder()
	exceptionalRecoveryListHandler(recListAdmin, reqListAdmin)
	if recListAdmin.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for admin list exceptional recovery, got %d: %s", recListAdmin.Code, recListAdmin.Body.String())
	}

	// Step 3: Owner of Org1 lists exceptional recovery -> sees pending request
	reqListOwner := httptest.NewRequest(http.MethodGet, "/v1/organizations/"+orgID+"/exceptional-recovery", nil)
	reqListOwner.SetPathValue("org_id", orgID)
	reqListOwner.AddCookie(&http.Cookie{Name: "byos_session", Value: ownerToken})
	recListOwner := httptest.NewRecorder()
	exceptionalRecoveryListHandler(recListOwner, reqListOwner)
	if recListOwner.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for owner list exceptional recovery, got %d: %s", recListOwner.Code, recListOwner.Body.String())
	}
	var listResp struct {
		Requests []struct {
			ID     string `json:"id"`
			UserID string `json:"user_id"`
			Email  string `json:"email"`
		} `json:"requests"`
	}
	if err := json.NewDecoder(recListOwner.Body).Decode(&listResp); err != nil {
		t.Fatalf("failed to decode list response: %v", err)
	}
	found := false
	for _, r := range listResp.Requests {
		if r.ID == exResp.RequestID {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("pending request %s not found in list %+v", exResp.RequestID, listResp.Requests)
	}

	// Step 3b (Finding F-07): Owner cannot request exceptional recovery (403) and cannot approve their own request (403)
	var ownerEmail string
	_ = db.QueryRow(`SELECT email FROM users WHERE id=$1`, ownerID).Scan(&ownerEmail)
	reqOwnerSelf := httptest.NewRequest(http.MethodPost, "/v1/auth/recovery/request-exceptional", bytes.NewReader([]byte(`{"email":"`+ownerEmail+`"}`)))
	recOwnerSelf := httptest.NewRecorder()
	exceptionalRecoveryRequestHandler(recOwnerSelf, reqOwnerSelf)
	if recOwnerSelf.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for owner exceptional recovery request, got %d: %s", recOwnerSelf.Code, recOwnerSelf.Body.String())
	}

	var ownerSelfReqID string
	_ = db.QueryRow(`
		INSERT INTO auth_challenges (user_id, challenge_type, challenge_token, destination, expires_at)
		VALUES ($1, 'exceptional_reset_pending', $2, $3, NOW() + INTERVAL '1 hour')
		RETURNING id::text
	`, ownerID, uuid.New().String(), ownerEmail).Scan(&ownerSelfReqID)

	reqApproveSelf := httptest.NewRequest(http.MethodPost, "/v1/organizations/"+orgID+"/exceptional-recovery/"+ownerSelfReqID+"/approve", nil)
	reqApproveSelf.SetPathValue("org_id", orgID)
	reqApproveSelf.SetPathValue("id", ownerSelfReqID)
	reqApproveSelf.AddCookie(&http.Cookie{Name: "byos_session", Value: ownerToken})
	recApproveSelf := httptest.NewRecorder()
	exceptionalRecoveryApproveHandler(recApproveSelf, reqApproveSelf)
	if recApproveSelf.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for owner self-approval, got %d: %s", recApproveSelf.Code, recApproveSelf.Body.String())
	}

	// Step 4: Owner of different Org (Org2) cannot approve request -> 404 (or 403)
	reqApproveOther := httptest.NewRequest(http.MethodPost, "/v1/organizations/"+org2ID+"/exceptional-recovery/"+exResp.RequestID+"/approve", nil)
	reqApproveOther.SetPathValue("org_id", org2ID)
	reqApproveOther.SetPathValue("id", exResp.RequestID)
	reqApproveOther.AddCookie(&http.Cookie{Name: "byos_session", Value: owner2Token})
	recApproveOther := httptest.NewRecorder()
	exceptionalRecoveryApproveHandler(recApproveOther, reqApproveOther)
	if recApproveOther.Code != http.StatusNotFound && recApproveOther.Code != http.StatusForbidden {
		t.Fatalf("expected 404/403 for cross-org approval attempt, got %d: %s", recApproveOther.Code, recApproveOther.Body.String())
	}

	// Step 5: Legitimate Owner approves the employee's request
	// Security Invariant (Finding F-01): Owner MUST NOT receive the authorization code
	reqApprove := httptest.NewRequest(http.MethodPost, "/v1/organizations/"+orgID+"/exceptional-recovery/"+exResp.RequestID+"/approve", nil)
	reqApprove.SetPathValue("org_id", orgID)
	reqApprove.SetPathValue("id", exResp.RequestID)
	reqApprove.AddCookie(&http.Cookie{Name: "byos_session", Value: ownerToken})
	recApprove := httptest.NewRecorder()
	exceptionalRecoveryApproveHandler(recApprove, reqApprove)
	if recApprove.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for owner approve, got %d: %s", recApprove.Code, recApprove.Body.String())
	}
	var approveResp struct {
		Success           bool   `json:"success"`
		AuthorizationCode string `json:"authorization_code"`
		TargetEmail       string `json:"target_email"`
	}
	if err := json.NewDecoder(recApprove.Body).Decode(&approveResp); err != nil {
		t.Fatalf("bad approve response: %s, %v", recApprove.Body.String(), err)
	}
	if !approveResp.Success {
		t.Fatalf("expected approveResp.Success to be true")
	}
	if approveResp.AuthorizationCode != "" {
		t.Fatalf("authorization_code was leaked to owner in approval response: %q", approveResp.AuthorizationCode)
	}

	// Step 6: Employee redeems reset using their challenge_token
	resetPayload, _ := json.Marshal(map[string]string{
		"email":           memberEmail,
		"challenge_token": exResp.ChallengeToken,
		"new_password":    "NewStrongPassword123!",
	})
	reqReset := httptest.NewRequest(http.MethodPost, "/v1/auth/recovery/reset-with-approval", bytes.NewReader(resetPayload))
	recReset := httptest.NewRecorder()
	exceptionalRecoveryResetHandler(recReset, reqReset)
	if recReset.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for reset-with-approval, got %d: %s", recReset.Code, recReset.Body.String())
	}

	// Step 7: Verify database state:
	// - users.password_hash is updated and verifies with NewStrongPassword123!
	// - ZERO-KNOWLEDGE INVARIANT: mailboxes.wrapped_sk_user is UNTOUCHED (equals originalWrappedSK)!
	// - ZERO-KNOWLEDGE INVARIANT: mailboxes.previous_wrapped_sk_user is UNTOUCHED!
	var updatedPwdHash string
	if err := db.QueryRow(`SELECT password_hash FROM users WHERE id=$1`, memberID).Scan(&updatedPwdHash); err != nil {
		t.Fatalf("failed to query updated password_hash: %v", err)
	}
	if !verifyPassword(updatedPwdHash, "NewStrongPassword123!") {
		t.Fatalf("password_hash did not verify against new password!")
	}

	var currentWSK, previousWSK *string
	err = db.QueryRow(`
		SELECT wrapped_sk_user, previous_wrapped_sk_user
		FROM mailboxes
		WHERE id=$1
	`, mailboxID).Scan(&currentWSK, &previousWSK)
	if err != nil {
		t.Fatalf("failed to query mailbox: %v", err)
	}
	if currentWSK == nil || *currentWSK != originalWrappedSK {
		t.Fatalf("expected current wrapped_sk_user to remain %s, got %v", originalWrappedSK, currentWSK)
	}
	if previousWSK != nil {
		t.Fatalf("expected previous_wrapped_sk_user to remain nil, got %v", previousWSK)
	}

	// Step 8: Replay attack fails: cannot redeem challenge_token a second time
	resetReplayPayload, _ := json.Marshal(map[string]string{
		"email":           memberEmail,
		"challenge_token": exResp.ChallengeToken,
		"new_password":    "AnotherPassword456!",
	})
	reqResetReplay := httptest.NewRequest(http.MethodPost, "/v1/auth/recovery/reset-with-approval", bytes.NewReader(resetReplayPayload))
	recResetReplay := httptest.NewRecorder()
	exceptionalRecoveryResetHandler(recResetReplay, reqResetReplay)
	if recResetReplay.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized for replayed challenge_token, got %d: %s", recResetReplay.Code, recResetReplay.Body.String())
	}
}

func TestMFAConsistencyAndPasskeyPolicy(t *testing.T) {
	requireRecoveryStack(t)
	db := setupTestDB(t)
	defer db.Close()

	_, _, _, memberID := createTestOrgAndUsers(t, db)
	memberToken := createTestSession(t, db, memberID)

	// Set user password to known hash and set dummy totp_secret
	testPwd := "TestPassword123!"
	pwdHash, _ := hashPassword(testPwd)
	_, err := db.Exec(`UPDATE users SET password_hash=$1, totp_secret='JBSWY3DPEHPK3PXP', two_factor_enabled=true WHERE id=$2`, pwdHash, memberID)
	if err != nil {
		t.Fatal(err)
	}

	// Insert a passkey in user_passkeys
	credID := "cred-" + uuid.New().String()
	_, err = db.Exec(`
		INSERT INTO user_passkeys (user_id, credential_id, public_key, counter, device_name)
		VALUES ($1, $2, decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'), 0, 'Test Security Key')
	`, memberID, credID)
	if err != nil {
		t.Fatalf("failed to insert passkey: %v", err)
	}

	// 1. Disable TOTP while passkey exists
	disBody := bytes.NewReader([]byte(`{"password":"` + testPwd + `"}`))
	reqDis := httptest.NewRequest(http.MethodPost, "/v1/auth/2fa/totp/disable", disBody)
	reqDis.AddCookie(&http.Cookie{Name: "byos_session", Value: memberToken})
	recDis := httptest.NewRecorder()
	totpDisableHandler(recDis, reqDis)
	if recDis.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for disable totp, got %d: %s", recDis.Code, recDis.Body.String())
	}

	// Verify two_factor_enabled is STILL TRUE because passkey exists!
	var tfaEnabled bool
	var totpSec *string
	err = db.QueryRow(`SELECT two_factor_enabled, totp_secret FROM users WHERE id=$1`, memberID).Scan(&tfaEnabled, &totpSec)
	if err != nil {
		t.Fatal(err)
	}
	if !tfaEnabled {
		t.Fatalf("expected two_factor_enabled to remain true while passkeys exist")
	}
	if totpSec != nil {
		t.Fatalf("expected totp_secret to be cleared, got %v", *totpSec)
	}

	// 2. Delete the passkey
	var pkID string
	err = db.QueryRow(`SELECT id::text FROM user_passkeys WHERE user_id=$1 AND credential_id=$2`, memberID, credID).Scan(&pkID)
	if err != nil {
		t.Fatal(err)
	}
	reqDel := httptest.NewRequest(http.MethodDelete, "/v1/auth/passkeys/"+pkID, nil)
	reqDel.SetPathValue("id", pkID)
	reqDel.AddCookie(&http.Cookie{Name: "byos_session", Value: memberToken})
	recDel := httptest.NewRecorder()
	passkeyItemHandler(recDel, reqDel)
	if recDel.Code != http.StatusNoContent {
		t.Fatalf("expected 204 No Content for passkey delete, got %d: %s", recDel.Code, recDel.Body.String())
	}

	// Verify two_factor_enabled is now false because neither factor remains
	err = db.QueryRow(`SELECT two_factor_enabled FROM users WHERE id=$1`, memberID).Scan(&tfaEnabled)
	if err != nil {
		t.Fatal(err)
	}
	if tfaEnabled {
		t.Fatalf("expected two_factor_enabled to be false after all factors removed")
	}
}

func TestSection15OperationBinding(t *testing.T) {
	requireRecoveryStack(t)
	db := setupTestDB(t)
	defer db.Close()

	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}

	var ownerEmail string
	_ = db.QueryRow(`SELECT email FROM users WHERE id=$1`, ownerID).Scan(&ownerEmail)

	// Enroll recovery public key
	ownerToken := createTestSession(t, db, ownerID)
	recEnroll := recoveryPost(t, recoveryEnrollHandler, `{"recovery_auth_pk":"`+base64.StdEncoding.EncodeToString(pub)+`"}`, &http.Cookie{Name: "byos_session", Value: ownerToken})
	if recEnroll.Code != http.StatusCreated && recEnroll.Code != http.StatusOK {
		t.Fatalf("enroll status = %d: %s", recEnroll.Code, recEnroll.Body.String())
	}

	// Request recovery challenge
	recChallenge := recoveryPost(t, recoveryChallengeHandler, `{"email":"`+ownerEmail+`"}`)
	if recChallenge.Code != http.StatusOK {
		t.Fatalf("challenge status = %d: %s", recChallenge.Code, recChallenge.Body.String())
	}
	var ch struct {
		ChallengeID string `json:"challenge_id"`
	}
	if err := json.Unmarshal(recChallenge.Body.Bytes(), &ch); err != nil || ch.ChallengeID == "" {
		t.Fatalf("bad challenge response: %s", recChallenge.Body.String())
	}

	// Sign canonical challenge
	sig := ed25519.Sign(priv, recoveryChallengeMessage(ch.ChallengeID))
	recVerify := recoveryPost(t, recoveryVerifyHandler, `{"challenge_id":"`+ch.ChallengeID+`","signature":"`+base64.StdEncoding.EncodeToString(sig)+`"}`)
	if recVerify.Code != http.StatusOK {
		t.Fatalf("verify status = %d: %s", recVerify.Code, recVerify.Body.String())
	}

	// Extract session cookie from recovery verification
	var sessionCookie *http.Cookie
	for _, c := range recVerify.Result().Cookies() {
		if c.Name == "byos_session" {
			sessionCookie = c
			break
		}
	}
	if sessionCookie == nil {
		t.Fatalf("expected byos_session cookie in recovery verification response")
	}

	// Create a mailbox for the user
	var domainID, mailboxID string
	_ = db.QueryRow(`INSERT INTO domains (org_id, name, is_verified) VALUES ($1, $2, true) RETURNING id`, orgID, "domain-"+uuid.New().String()[:8]+".local").Scan(&domainID)
	initialWsk := `{"salt":"rec_salt","envelope":"rec_env"}`
	_ = db.QueryRow(`INSERT INTO mailboxes (org_id, user_id, domain_id, local_part, mode, is_active, wrapped_sk_user, mailbox_sk_wrapped) VALUES ($1, $2, $3, 'rec-box', 'private', true, $4, $5) RETURNING id`, orgID, ownerID, domainID, initialWsk, []byte(initialWsk)).Scan(&mailboxID)

	// 1. Password change without current_password succeeds on first attempt (bound single-use token)
	firstChangePayload, _ := json.Marshal(map[string]string{
		"current_password": "",
		"new_password":     "NewRecoveredPass123!",
		"wrapped_sk_user":  `{"salt":"new_salt","envelope":"new_env"}`,
	})
	reqFirstChange := httptest.NewRequest(http.MethodPost, "/v1/auth/change-password", bytes.NewReader(firstChangePayload))
	reqFirstChange.AddCookie(sessionCookie)
	recFirstChange := httptest.NewRecorder()
	changePasswordHandler(recFirstChange, reqFirstChange)
	if recFirstChange.Code != http.StatusNoContent {
		t.Fatalf("first change without current_password failed: %d, %s", recFirstChange.Code, recFirstChange.Body.String())
	}

	// 2. Second attempt without current_password MUST fail with 400 Bad Request (single-use consumed!)
	secondChangePayload, _ := json.Marshal(map[string]string{
		"current_password": "",
		"new_password":     "AnotherNewPass456!",
		"wrapped_sk_user":  `{"salt":"new_salt2","envelope":"new_env2"}`,
	})
	reqSecondChange := httptest.NewRequest(http.MethodPost, "/v1/auth/change-password", bytes.NewReader(secondChangePayload))
	reqSecondChange.AddCookie(sessionCookie)
	recSecondChange := httptest.NewRecorder()
	changePasswordHandler(recSecondChange, reqSecondChange)
	if recSecondChange.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request on second change without current_password, got %d: %s", recSecondChange.Code, recSecondChange.Body.String())
	}

	// 3. Attempt from an unrelated session without current_password MUST fail with 400 Bad Request
	unrelatedToken := createTestSession(t, db, ownerID)
	reqUnrelated := httptest.NewRequest(http.MethodPost, "/v1/auth/change-password", bytes.NewReader(secondChangePayload))
	reqUnrelated.AddCookie(&http.Cookie{Name: "byos_session", Value: unrelatedToken})
	recUnrelated := httptest.NewRecorder()
	changePasswordHandler(recUnrelated, reqUnrelated)
	if recUnrelated.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request for unrelated session without current_password, got %d: %s", recUnrelated.Code, recUnrelated.Body.String())
	}

	// 4. Attempt with wrong current_password MUST fail with 401 Unauthorized
	wrongPwdPayload, _ := json.Marshal(map[string]string{
		"current_password": "WrongPassword123!",
		"new_password":     "AnotherNewPass456!",
		"wrapped_sk_user":  `{"salt":"new_salt3","envelope":"new_env3"}`,
	})
	reqWrong := httptest.NewRequest(http.MethodPost, "/v1/auth/change-password", bytes.NewReader(wrongPwdPayload))
	reqWrong.AddCookie(sessionCookie)
	recWrong := httptest.NewRecorder()
	changePasswordHandler(recWrong, reqWrong)
	if recWrong.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized for incorrect current_password, got %d: %s", recWrong.Code, recWrong.Body.String())
	}
}

func TestExceptionalRecoveryRejectAndExpiry(t *testing.T) {
	requireRecoveryStack(t)
	db := setupTestDB(t)
	defer db.Close()

	orgID, ownerID, _, memberID := createTestOrgAndUsers(t, db)
	ownerToken := createTestSession(t, db, ownerID)

	var memberEmail string
	_ = db.QueryRow(`SELECT email FROM users WHERE id=$1`, memberID).Scan(&memberEmail)

	// Step 1: Member requests exceptional recovery
	reqEx := bytes.NewReader([]byte(`{"email":"` + memberEmail + `","notes":"Locked out"}`))
	reqPost := httptest.NewRequest(http.MethodPost, "/v1/auth/recovery/request-exceptional", reqEx)
	recPost := httptest.NewRecorder()
	exceptionalRecoveryRequestHandler(recPost, reqPost)
	if recPost.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for request-exceptional, got %d", recPost.Code)
	}
	var exResp struct {
		RequestID      string `json:"request_id"`
		ChallengeToken string `json:"challenge_token"`
	}
	_ = json.NewDecoder(recPost.Body).Decode(&exResp)

	// Step 2: Owner rejects request
	reqReject := httptest.NewRequest(http.MethodPost, "/v1/organizations/"+orgID+"/exceptional-recovery/"+exResp.RequestID+"/reject", nil)
	reqReject.SetPathValue("org_id", orgID)
	reqReject.SetPathValue("id", exResp.RequestID)
	reqReject.AddCookie(&http.Cookie{Name: "byos_session", Value: ownerToken})
	recReject := httptest.NewRecorder()
	exceptionalRecoveryRejectHandler(recReject, reqReject)
	if recReject.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for reject, got %d", recReject.Code)
	}

	// Step 3: Member attempts reset on rejected request -> 401 Unauthorized
	resetPayload, _ := json.Marshal(map[string]string{
		"email":           memberEmail,
		"challenge_token": exResp.ChallengeToken,
		"new_password":    "NewPassword123!",
	})
	reqReset := httptest.NewRequest(http.MethodPost, "/v1/auth/recovery/reset-with-approval", bytes.NewReader(resetPayload))
	recReset := httptest.NewRecorder()
	exceptionalRecoveryResetHandler(recReset, reqReset)
	if recReset.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized for rejected request reset, got %d", recReset.Code)
	}

	// Step 4: Test expired request
	var expiredReqID string
	expiredToken := uuid.New().String()
	_ = db.QueryRow(`
		INSERT INTO auth_challenges (user_id, challenge_type, challenge_token, destination, expires_at)
		VALUES ($1, 'exceptional_reset_approved', $2, $3, NOW() - INTERVAL '1 hour')
		RETURNING id::text
	`, memberID, expiredToken, memberEmail).Scan(&expiredReqID)

	resetExpiredPayload, _ := json.Marshal(map[string]string{
		"email":           memberEmail,
		"challenge_token": expiredToken,
		"new_password":    "NewPassword123!",
	})
	reqResetExpired := httptest.NewRequest(http.MethodPost, "/v1/auth/recovery/reset-with-approval", bytes.NewReader(resetExpiredPayload))
	recResetExpired := httptest.NewRecorder()
	exceptionalRecoveryResetHandler(recResetExpired, reqResetExpired)
	if recResetExpired.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized for expired authorization reset, got %d", recResetExpired.Code)
	}
}

func TestPasskeyOnlyUserMFAExperience(t *testing.T) {
	requireRecoveryStack(t)
	db := setupTestDB(t)
	defer db.Close()

	_, _, _, memberID := createTestOrgAndUsers(t, db)
	var memberEmail string
	_ = db.QueryRow(`SELECT email FROM users WHERE id=$1`, memberID).Scan(&memberEmail)

	knownPass := "ValidPassword123!"
	pwdHash, _ := hashPassword(knownPass)
	_, _ = db.Exec(`UPDATE users SET password_hash=$1, totp_secret=NULL, two_factor_enabled=true WHERE id=$2`, pwdHash, memberID)

	// User enrolls a passkey but has no TOTP
	credID := "test-passkey-cred-" + uuid.New().String()[:8]
	_, _ = db.Exec(`
		INSERT INTO user_passkeys (user_id, credential_id, public_key, device_name)
		VALUES ($1, $2, 'dummy-pubkey', 'Test YubiKey')
	`, memberID, credID)

	// 1. Password login must require 2FA challenge with 'passkey' method (never bypass MFA with password alone)
	loginBody, _ := json.Marshal(map[string]string{
		"email":    memberEmail,
		"password": knownPass,
	})
	reqLogin := httptest.NewRequest(http.MethodPost, "/v1/auth/login", bytes.NewReader(loginBody))
	recLogin := httptest.NewRecorder()
	loginHandler(recLogin, reqLogin)
	if recLogin.Code != http.StatusOK {
		t.Fatalf("expected 200 OK with 2FA challenge for passkey-only user login, got %d: %s", recLogin.Code, recLogin.Body.String())
	}
	var loginMfaResp struct {
		TwoFactorRequired bool     `json:"two_factor_required"`
		ChallengeToken    string   `json:"challenge_token"`
		Methods           []string `json:"methods"`
		PreferredMethod   string   `json:"preferred_method"`
	}
	_ = json.NewDecoder(recLogin.Body).Decode(&loginMfaResp)
	if !loginMfaResp.TwoFactorRequired {
		t.Fatalf("expected two_factor_required=true for passkey-only account")
	}
	hasPasskeyMethod := false
	for _, m := range loginMfaResp.Methods {
		if m == "passkey" {
			hasPasskeyMethod = true
		}
	}
	if !hasPasskeyMethod {
		t.Fatalf("expected methods to contain 'passkey', got %v", loginMfaResp.Methods)
	}

	// 2. Existing active session attempting password change without MFA code must be rejected with HTTP 403
	activeSessionToken := createTestSession(t, db, memberID)
	newPass := "NewValidPassword456!"
	changePayload, _ := json.Marshal(map[string]string{
		"current_password": knownPass,
		"new_password":     newPass,
	})
	reqChange := httptest.NewRequest(http.MethodPost, "/v1/auth/change-password", bytes.NewReader(changePayload))
	reqChange.AddCookie(&http.Cookie{Name: "byos_session", Value: activeSessionToken})
	recChange := httptest.NewRecorder()
	changePasswordHandler(recChange, reqChange)
	if recChange.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for passkey-only password change without MFA code, got %d: %s", recChange.Code, recChange.Body.String())
	}

	// 2b. Password change with verified passkey step-up token succeeds with 204 No Content
	stepUpToken, _ := generateRandomBase64URL(32)
	_, _ = db.Exec(`
		INSERT INTO auth_challenges (user_id, challenge_type, challenge_token, destination, expires_at)
		VALUES ($1, 'step_up_mfa', $2, 'passkey', NOW() + INTERVAL '5 minutes')
	`, memberID, stepUpToken)

	changeWithStepUpPayload, _ := json.Marshal(map[string]string{
		"current_password": knownPass,
		"new_password":     newPass,
		"mfa_code":         stepUpToken,
	})
	reqChangeWithStepUp := httptest.NewRequest(http.MethodPost, "/v1/auth/change-password", bytes.NewReader(changeWithStepUpPayload))
	reqChangeWithStepUp.AddCookie(&http.Cookie{Name: "byos_session", Value: activeSessionToken})
	recChangeWithStepUp := httptest.NewRecorder()
	changePasswordHandler(recChangeWithStepUp, reqChangeWithStepUp)
	if recChangeWithStepUp.Code != http.StatusNoContent && recChangeWithStepUp.Code != http.StatusOK {
		t.Fatalf("expected 204 No Content for password change with step-up token, got %d: %s", recChangeWithStepUp.Code, recChangeWithStepUp.Body.String())
	}
	knownPass = newPass

	// 3. User enrolls TOTP in Settings from the active session
	totpSecret := "JBSWY3DPEHPK3PXP"
	_, _ = db.Exec(`UPDATE users SET totp_secret=$1, two_factor_enabled=true WHERE id=$2`, totpSecret, memberID)

	// 4. Password login now challenges with TOTP method
	loginAfterTOTPBody, _ := json.Marshal(map[string]string{
		"email":    memberEmail,
		"password": knownPass,
	})
	reqLoginAfterTOTP := httptest.NewRequest(http.MethodPost, "/v1/auth/login", bytes.NewReader(loginAfterTOTPBody))
	recLoginAfterTOTP := httptest.NewRecorder()
	loginHandler(recLoginAfterTOTP, reqLoginAfterTOTP)
	if recLoginAfterTOTP.Code != http.StatusOK {
		t.Fatalf("expected 200 OK with 2FA challenge after TOTP enrollment, got %d: %s", recLoginAfterTOTP.Code, recLoginAfterTOTP.Body.String())
	}
	var loginChallengeResp struct {
		TwoFactorRequired bool     `json:"two_factor_required"`
		Methods           []string `json:"methods"`
	}
	_ = json.NewDecoder(recLoginAfterTOTP.Body).Decode(&loginChallengeResp)
	if !loginChallengeResp.TwoFactorRequired || len(loginChallengeResp.Methods) == 0 || loginChallengeResp.Methods[0] != "totp" {
		t.Fatalf("expected two_factor_required with 'totp' method, got %+v", loginChallengeResp)
	}

	// 5. Password change now requires mfa_code; without it, 403 Forbidden
	thirdPass := "YetAnotherPassword789!"
	changeWithoutMfaPayload, _ := json.Marshal(map[string]string{
		"current_password": knownPass,
		"new_password":     thirdPass,
	})
	reqMfaRequired := httptest.NewRequest(http.MethodPost, "/v1/auth/change-password", bytes.NewReader(changeWithoutMfaPayload))
	reqMfaRequired.AddCookie(&http.Cookie{Name: "byos_session", Value: activeSessionToken})
	recMfaRequired := httptest.NewRecorder()
	changePasswordHandler(recMfaRequired, reqMfaRequired)
	if recMfaRequired.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden when TOTP is configured and mfa_code omitted, got %d: %s", recMfaRequired.Code, recMfaRequired.Body.String())
	}

	// 6. Password change with valid step-up code succeeds (HTTP 204 No Content)
	validCode := "654321"
	_, _ = db.Exec(`
		INSERT INTO auth_challenges (user_id, challenge_type, challenge_token, destination, expires_at)
		VALUES ($1, 'step_up_mfa', $2, 'totp', NOW() + INTERVAL '5 minutes')
	`, memberID, validCode)

	changeWithCodePayload, _ := json.Marshal(map[string]string{
		"current_password": knownPass,
		"new_password":     thirdPass,
		"mfa_code":         validCode,
	})
	reqChangeWithCode := httptest.NewRequest(http.MethodPost, "/v1/auth/change-password", bytes.NewReader(changeWithCodePayload))
	reqChangeWithCode.AddCookie(&http.Cookie{Name: "byos_session", Value: activeSessionToken})
	recChangeWithCode := httptest.NewRecorder()
	changePasswordHandler(recChangeWithCode, reqChangeWithCode)
	if recChangeWithCode.Code != http.StatusNoContent {
		t.Fatalf("expected 204 No Content for password change with valid MFA code, got %d: %s", recChangeWithCode.Code, recChangeWithCode.Body.String())
	}
}

func TestExceptionalRecoveryEndToEndKeyPreservation(t *testing.T) {
	requireRecoveryStack(t)
	db := setupTestDB(t)
	defer db.Close()

	orgID, ownerID, _, memberID := createTestOrgAndUsers(t, db)
	ownerToken := createTestSession(t, db, ownerID)

	var memberEmail string
	_ = db.QueryRow(`SELECT email FROM users WHERE id=$1`, memberID).Scan(&memberEmail)

	var domainID string
	_ = db.QueryRow(`INSERT INTO domains (org_id, name, is_verified) VALUES ($1, $2, true) RETURNING id`, orgID, "domain-"+uuid.New().String()[:8]+".local").Scan(&domainID)

	originalWrappedSK := `{"salt":"orig_salt","envelope":"orig_envelope"}`
	var mailboxID string
	err := db.QueryRow(`
		INSERT INTO mailboxes (org_id, user_id, domain_id, local_part, mode, is_active, wrapped_sk_user, mailbox_sk_wrapped)
		VALUES ($1, $2, $3, 'test-e2e', 'private', true, $4, $5)
		RETURNING id
	`, orgID, memberID, domainID, originalWrappedSK, []byte(originalWrappedSK)).Scan(&mailboxID)
	if err != nil {
		t.Fatalf("failed inserting mailbox: %v", err)
	}

	// 1. Member requests exceptional recovery
	reqEx := bytes.NewReader([]byte(`{"email":"` + memberEmail + `","notes":"Forgot password"}`))
	reqPost := httptest.NewRequest(http.MethodPost, "/v1/auth/recovery/request-exceptional", reqEx)
	recPost := httptest.NewRecorder()
	exceptionalRecoveryRequestHandler(recPost, reqPost)
	if recPost.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for request-exceptional, got %d", recPost.Code)
	}
	var exResp struct {
		RequestID      string `json:"request_id"`
		ChallengeToken string `json:"challenge_token"`
	}
	_ = json.NewDecoder(recPost.Body).Decode(&exResp)

	// 2. Owner approves
	reqApprove := httptest.NewRequest(http.MethodPost, "/v1/organizations/"+orgID+"/exceptional-recovery/"+exResp.RequestID+"/approve", nil)
	reqApprove.SetPathValue("org_id", orgID)
	reqApprove.SetPathValue("id", exResp.RequestID)
	reqApprove.AddCookie(&http.Cookie{Name: "byos_session", Value: ownerToken})
	recApprove := httptest.NewRecorder()
	exceptionalRecoveryApproveHandler(recApprove, reqApprove)
	if recApprove.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for approve, got %d", recApprove.Code)
	}

	// 3. Member resets password with challenge token
	newPassword := "NewResetPass123!"
	resetPayload, _ := json.Marshal(map[string]string{
		"email":           memberEmail,
		"challenge_token": exResp.ChallengeToken,
		"new_password":    newPassword,
	})
	reqReset := httptest.NewRequest(http.MethodPost, "/v1/auth/recovery/reset-with-approval", bytes.NewReader(resetPayload))
	recReset := httptest.NewRecorder()
	exceptionalRecoveryResetHandler(recReset, reqReset)
	if recReset.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for reset-with-approval, got %d", recReset.Code)
	}
	var resetResp struct {
		Token string `json:"token"`
	}
	_ = json.NewDecoder(recReset.Body).Decode(&resetResp)

	// 4. Verify ZERO-KNOWLEDGE: mailboxes.wrapped_sk_user is strictly untouched
	var storedWSK string
	_ = db.QueryRow(`SELECT wrapped_sk_user FROM mailboxes WHERE id=$1`, mailboxID).Scan(&storedWSK)
	if storedWSK != originalWrappedSK {
		t.Fatalf("zero-knowledge violated: wrapped_sk_user altered during reset!")
	}

	// 5. Member unlocks with recovery phrase client-side and re-wraps mailbox key under new password
	newWrappedSK := `{"salt":"new_salt_e2e","envelope":"new_envelope_e2e"}`
	reactivatePayload, _ := json.Marshal(map[string]string{
		"wrapped_sk_user": newWrappedSK,
	})
	reqReactivate := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mailboxID+"/reactivate-keys", bytes.NewReader(reactivatePayload))
	reqReactivate.SetPathValue("mailbox_id", mailboxID)
	reqReactivate.SetPathValue("id", mailboxID)
	var resetCookieToken string
	for _, c := range recReset.Result().Cookies() {
		if c.Name == "byos_session" && c.Value != "" {
			resetCookieToken = c.Value
			break
		}
	}
	if resetCookieToken == "" {
		t.Fatalf("expected byos_session cookie from reset-with-approval")
	}
	reqReactivate.AddCookie(&http.Cookie{Name: "byos_session", Value: resetCookieToken})
	recReactivate := httptest.NewRecorder()
	mailboxReactivateKeysHandler(recReactivate, reqReactivate)
	if recReactivate.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for reactivate-keys by owner, got %d: %s", recReactivate.Code, recReactivate.Body.String())
	}

	// 6. Verify mailbox now holds the re-wrapped key envelope
	_ = db.QueryRow(`SELECT wrapped_sk_user FROM mailboxes WHERE id=$1`, mailboxID).Scan(&storedWSK)
	if storedWSK != newWrappedSK {
		t.Fatalf("expected wrapped_sk_user to be updated to %s, got %s", newWrappedSK, storedWSK)
	}

	// 7. Non-mailbox-owner cannot reactivate keys -> 403 Forbidden
	reqHacker := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mailboxID+"/reactivate-keys", bytes.NewReader(reactivatePayload))
	reqHacker.SetPathValue("mailbox_id", mailboxID)
	reqHacker.SetPathValue("id", mailboxID)
	reqHacker.AddCookie(&http.Cookie{Name: "byos_session", Value: ownerToken})
	recHacker := httptest.NewRecorder()
	mailboxReactivateKeysHandler(recHacker, reqHacker)
	if recHacker.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for non-mailbox-owner key reactivation, got %d", recHacker.Code)
	}
}

func TestSection15NegativeGuards(t *testing.T) {
	requireRecoveryStack(t)
	db := setupTestDB(t)
	defer db.Close()

	orgID, ownerID, _, memberID := createTestOrgAndUsers(t, db)
	_ = orgID

	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	pkB64 := base64.StdEncoding.EncodeToString(pub)

	// Enroll owner recovery verifier
	ownerToken := createTestSession(t, db, ownerID)
	enrollReq := httptest.NewRequest(http.MethodPost, "/v1/auth/recovery-enroll",
		bytes.NewReader([]byte(`{"recovery_auth_pk":"`+pkB64+`"}`)))
	enrollReq.AddCookie(&http.Cookie{Name: "byos_session", Value: ownerToken})
	enrollRec := httptest.NewRecorder()
	recoveryEnrollHandler(enrollRec, enrollReq)
	if enrollRec.Code != http.StatusCreated {
		t.Fatalf("enroll status = %d: %s", enrollRec.Code, enrollRec.Body.String())
	}

	var email string
	_ = db.QueryRow(`SELECT email FROM users WHERE id=$1`, ownerID).Scan(&email)

	// 1. Invalid signature on recovery/verify -> 401 Unauthorized
	chRec := recoveryPost(t, recoveryChallengeHandler, `{"email":"`+email+`"}`)
	var ch struct {
		ChallengeID string `json:"challenge_id"`
	}
	_ = json.NewDecoder(chRec.Body).Decode(&ch)

	invalidSigB64 := base64.StdEncoding.EncodeToString(make([]byte, 64))
	verifyReqBadSig, _ := json.Marshal(map[string]string{
		"challenge_id": ch.ChallengeID,
		"signature":    invalidSigB64,
	})
	recBadSig := recoveryPost(t, recoveryVerifyHandler, string(verifyReqBadSig))
	if recBadSig.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized for invalid signature, got %d", recBadSig.Code)
	}

	// 2. Replay attack on recovery/verify: First call succeeds, second call with same signature fails 401
	chRec2 := recoveryPost(t, recoveryChallengeHandler, `{"email":"`+email+`"}`)
	var ch2 struct {
		ChallengeID string `json:"challenge_id"`
	}
	_ = json.NewDecoder(chRec2.Body).Decode(&ch2)

	msg := recoveryChallengeMessage(ch2.ChallengeID)
	validSig := ed25519.Sign(priv, msg)
	sigB64 := base64.StdEncoding.EncodeToString(validSig)
	verifyReq, _ := json.Marshal(map[string]string{
		"challenge_id": ch2.ChallengeID,
		"signature":    sigB64,
	})

	recVerify1 := recoveryPost(t, recoveryVerifyHandler, string(verifyReq))
	if recVerify1.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for first verify, got %d: %s", recVerify1.Code, recVerify1.Body.String())
	}
	// Replay same verification
	recVerify2 := recoveryPost(t, recoveryVerifyHandler, string(verifyReq))
	if recVerify2.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized for replayed verify, got %d", recVerify2.Code)
	}

	// Extract the recovered session cookie
	var sessionCookie *http.Cookie
	for _, c := range recVerify1.Result().Cookies() {
		if c.Name == "byos_session" {
			sessionCookie = c
			break
		}
	}
	if sessionCookie == nil {
		t.Fatalf("expected byos_session cookie from verifyHandler")
	}

	// 3. Cross-user session reuse: Token generated for ownerID used by memberID session -> 400 Bad Request
	memberToken := createTestSession(t, db, memberID)
	changeReqMember, _ := json.Marshal(map[string]string{
		"new_password": "NewMemberPassword123!",
	})
	reqCrossUser := httptest.NewRequest(http.MethodPost, "/v1/auth/change-password", bytes.NewReader(changeReqMember))
	reqCrossUser.AddCookie(&http.Cookie{Name: "byos_session", Value: memberToken})
	recCrossUser := httptest.NewRecorder()
	changePasswordHandler(recCrossUser, reqCrossUser)
	if recCrossUser.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request for cross-user token reuse, got %d", recCrossUser.Code)
	}

	// 4. Cross-session reuse: Cookie for a different session of the same owner user -> 400 Bad Request
	diffSessionToken := createTestSession(t, db, ownerID)
	reqCrossSession := httptest.NewRequest(http.MethodPost, "/v1/auth/change-password", bytes.NewReader(changeReqMember))
	reqCrossSession.AddCookie(&http.Cookie{Name: "byos_session", Value: diffSessionToken})
	recCrossSession := httptest.NewRecorder()
	changePasswordHandler(recCrossSession, reqCrossSession)
	if recCrossSession.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request for cross-session token reuse, got %d", recCrossSession.Code)
	}

	// 5. Wrong operation type: challenge created for 'step_up_mfa' attempted in change-password without password -> 400
	callerHash := hashToken(sessionCookie.Value)
	callerHashHex := hex.EncodeToString(callerHash)
	fakeToken := uuid.New().String()
	_, _ = db.Exec(`
		INSERT INTO auth_challenges (user_id, challenge_type, challenge_token, destination, expires_at)
		VALUES ($1, 'step_up_mfa', $2, $3, NOW() + INTERVAL '10 minutes')
	`, ownerID, fakeToken, callerHashHex)

	// Delete valid section15 token temporarily to test wrong-op
	_, _ = db.Exec(`DELETE FROM auth_challenges WHERE user_id=$1 AND challenge_type='section15_recovery_pwd_reset'`, ownerID)

	reqWrongOp := httptest.NewRequest(http.MethodPost, "/v1/auth/change-password", bytes.NewReader(changeReqMember))
	reqWrongOp.AddCookie(sessionCookie)
	recWrongOp := httptest.NewRecorder()
	changePasswordHandler(recWrongOp, reqWrongOp)
	if recWrongOp.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request for wrong operation challenge_type, got %d", recWrongOp.Code)
	}

	// 6. Expired challenge: challenge_type='section15_recovery_pwd_reset' but expires_at in past -> 400
	_, _ = db.Exec(`
		INSERT INTO auth_challenges (user_id, challenge_type, challenge_token, destination, expires_at)
		VALUES ($1, 'section15_recovery_pwd_reset', $2, $3, NOW() - INTERVAL '1 minute')
	`, ownerID, uuid.New().String(), callerHashHex)
	reqExpired := httptest.NewRequest(http.MethodPost, "/v1/auth/change-password", bytes.NewReader(changeReqMember))
	reqExpired.AddCookie(sessionCookie)
	recExpired := httptest.NewRecorder()
	changePasswordHandler(recExpired, reqExpired)
	if recExpired.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request for expired challenge, got %d", recExpired.Code)
	}

	// 7. Exceptional recovery token used in change-password -> 400 Bad Request
	_, _ = db.Exec(`DELETE FROM auth_challenges WHERE user_id=$1`, ownerID)
	_, _ = db.Exec(`
		INSERT INTO auth_challenges (user_id, challenge_type, challenge_token, destination, expires_at)
		VALUES ($1, 'exceptional_recovery', $2, $3, NOW() + INTERVAL '10 minutes')
	`, ownerID, uuid.New().String(), callerHashHex)
	reqExceptionalInChange := httptest.NewRequest(http.MethodPost, "/v1/auth/change-password", bytes.NewReader(changeReqMember))
	reqExceptionalInChange.AddCookie(sessionCookie)
	recExceptionalInChange := httptest.NewRecorder()
	changePasswordHandler(recExceptionalInChange, reqExceptionalInChange)
	if recExceptionalInChange.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request when exceptional recovery token used in change-password, got %d", recExceptionalInChange.Code)
	}

	// 8. Replay of valid Section 15 password reset:
	// Insert fresh valid section15 token with unique challenge token
	_, _ = db.Exec(`
		INSERT INTO auth_challenges (user_id, challenge_type, challenge_token, destination, expires_at)
		VALUES ($1, 'section15_recovery_pwd_reset', $2, $3, NOW() + INTERVAL '10 minutes')
	`, ownerID, uuid.New().String(), callerHashHex)

	reqValid := httptest.NewRequest(http.MethodPost, "/v1/auth/change-password", bytes.NewReader(changeReqMember))
	reqValid.AddCookie(sessionCookie)
	recValid := httptest.NewRecorder()
	changePasswordHandler(recValid, reqValid)
	if recValid.Code != http.StatusNoContent {
		t.Fatalf("expected 204 No Content for valid Section 15 password change, got %d: %s", recValid.Code, recValid.Body.String())
	}
	// Replay second time: single-use token consumed -> 400 Bad Request
	reqReplay := httptest.NewRequest(http.MethodPost, "/v1/auth/change-password", bytes.NewReader(changeReqMember))
	reqReplay.AddCookie(sessionCookie)
	recReplay := httptest.NewRecorder()
	changePasswordHandler(recReplay, reqReplay)
	if recReplay.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request for replayed Section 15 password reset, got %d", recReplay.Code)
	}
}

func TestExceptionalCryptographicRecoveryEndToEnd(t *testing.T) {
	requireRecoveryStack(t)
	db := setupTestDB(t)
	defer db.Close()

	orgID, ownerID, _, memberID := createTestOrgAndUsers(t, db)
	ownerToken := createTestSession(t, db, ownerID)

	var memberEmail string
	_ = db.QueryRow(`SELECT email FROM users WHERE id=$1`, memberID).Scan(&memberEmail)

	var domainID string
	_ = db.QueryRow(`INSERT INTO domains (org_id, name, is_verified) VALUES ($1, $2, true) RETURNING id`, orgID, "domain-"+uuid.New().String()[:8]+".local").Scan(&domainID)

	// Real Cryptographic Primitives:
	// 1. Generate real ECDH X25519 mailbox keypair
	curve := ecdh.X25519()
	mailboxPriv, err := curve.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("failed generating X25519 mailbox key: %v", err)
	}
	mailboxPub := mailboxPriv.PublicKey()
	mailboxPkHex := hex.EncodeToString(mailboxPub.Bytes())
	mailboxSkBytes := mailboxPriv.Bytes()

	// 2. Generate 32-byte root secret (simulating BIP-39 mnemonic root derivation)
	rootSecret := make([]byte, 32)
	_, _ = rand.Read(rootSecret)

	// 3. Wrap mailbox private key under root secret (AES-256-GCM) -> root_wrapped
	rootBlock, err := aes.NewCipher(rootSecret)
	if err != nil {
		t.Fatal(err)
	}
	rootAead, err := cipher.NewGCM(rootBlock)
	if err != nil {
		t.Fatal(err)
	}
	rootNonce := make([]byte, rootAead.NonceSize())
	_, _ = rand.Read(rootNonce)
	rootCiphertext := rootAead.Seal(nil, rootNonce, mailboxSkBytes, []byte("mailbox-aad"))
	rootWrappedHex := hex.EncodeToString(append(rootNonce, rootCiphertext...))

	// 4. Wrap mailbox private key under initial password using Argon2id + AES-256-GCM -> envelope
	initialPassword := "InitialPass123!"
	pwSalt := make([]byte, 16)
	_, _ = rand.Read(pwSalt)
	pwKey := argon2.IDKey([]byte(initialPassword), pwSalt, 3, 64*1024, 4, 32)
	pwBlock, err := aes.NewCipher(pwKey)
	if err != nil {
		t.Fatal(err)
	}
	pwAead, err := cipher.NewGCM(pwBlock)
	if err != nil {
		t.Fatal(err)
	}
	pwNonce := make([]byte, pwAead.NonceSize())
	_, _ = rand.Read(pwNonce)
	pwCiphertext := pwAead.Seal(nil, pwNonce, mailboxSkBytes, nil)
	passphraseEnvelope := hex.EncodeToString(append(pwNonce, pwCiphertext...))

	wrappedSkPayload, _ := json.Marshal(map[string]string{
		"salt":         hex.EncodeToString(pwSalt),
		"envelope":     passphraseEnvelope,
		"root_wrapped": rootWrappedHex,
	})
	initialWrappedSK := string(wrappedSkPayload)

	var mailboxID string
	err = db.QueryRow(`
		INSERT INTO mailboxes (org_id, user_id, domain_id, local_part, mode, is_active, mailbox_pk, wrapped_sk_user, mailbox_sk_wrapped)
		VALUES ($1, $2, $3, 'crypto-e2e', 'private', true, $4, $5, $6)
		RETURNING id
	`, orgID, memberID, domainID, mailboxPub.Bytes(), initialWrappedSK, []byte(initialWrappedSK)).Scan(&mailboxID)
	if err != nil {
		t.Fatalf("failed inserting mailbox: %v", err)
	}

	// 5. Encrypt synthetic historical message prior to password reset using recipient's X25519 public key
	historicalPlaintext := []byte("Top Secret Sovereign BYOS Communication")
	ephemeralPriv, err := curve.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	ephemeralPub := ephemeralPriv.PublicKey()
	sharedSecret, err := ephemeralPriv.ECDH(mailboxPub)
	if err != nil {
		t.Fatal(err)
	}
	msgSymKey := sha256.Sum256(sharedSecret)
	msgBlock, _ := aes.NewCipher(msgSymKey[:])
	msgAead, _ := cipher.NewGCM(msgBlock)
	msgNonce := make([]byte, msgAead.NonceSize())
	_, _ = rand.Read(msgNonce)
	historicalCiphertext := msgAead.Seal(nil, msgNonce, historicalPlaintext, nil)

	// 6. Exceptional Recovery: Employee loses password and requests exceptional recovery
	reqEx := bytes.NewReader([]byte(`{"email":"` + memberEmail + `","notes":"Lost password and need reset"}`))
	reqPost := httptest.NewRequest(http.MethodPost, "/v1/auth/recovery/request-exceptional", reqEx)
	recPost := httptest.NewRecorder()
	exceptionalRecoveryRequestHandler(recPost, reqPost)
	if recPost.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for request-exceptional, got %d: %s", recPost.Code, recPost.Body.String())
	}
	var exResp struct {
		RequestID      string `json:"request_id"`
		ChallengeToken string `json:"challenge_token"`
	}
	_ = json.NewDecoder(recPost.Body).Decode(&exResp)

	// 7. Organization Owner approves request in Control Panel
	reqApprove := httptest.NewRequest(http.MethodPost, "/v1/organizations/"+orgID+"/exceptional-recovery/"+exResp.RequestID+"/approve", nil)
	reqApprove.SetPathValue("org_id", orgID)
	reqApprove.SetPathValue("id", exResp.RequestID)
	reqApprove.AddCookie(&http.Cookie{Name: "byos_session", Value: ownerToken})
	recApprove := httptest.NewRecorder()
	exceptionalRecoveryApproveHandler(recApprove, reqApprove)
	if recApprove.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for approve, got %d: %s", recApprove.Code, recApprove.Body.String())
	}

	// 8. Employee completes reset with approval token and sets new password
	newPassword := "NewResetPass987!"
	resetPayload, _ := json.Marshal(map[string]string{
		"email":           memberEmail,
		"challenge_token": exResp.ChallengeToken,
		"new_password":    newPassword,
	})
	reqReset := httptest.NewRequest(http.MethodPost, "/v1/auth/recovery/reset-with-approval", bytes.NewReader(resetPayload))
	recReset := httptest.NewRecorder()
	exceptionalRecoveryResetHandler(recReset, reqReset)
	if recReset.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for reset-with-approval, got %d: %s", recReset.Code, recReset.Body.String())
	}
	var resetResp struct {
		Token string `json:"token"`
	}
	_ = json.NewDecoder(recReset.Body).Decode(&resetResp)

	// 9. Zero-Knowledge Verification: DB mailbox_pk and wrapped_sk_user are STRICTLY UNCHANGED
	var dbPk []byte
	var dbWSK string
	_ = db.QueryRow(`SELECT mailbox_pk, wrapped_sk_user FROM mailboxes WHERE id=$1`, mailboxID).Scan(&dbPk, &dbWSK)
	if !bytes.Equal(dbPk, mailboxPub.Bytes()) {
		t.Fatalf("mailbox_pk was modified during exceptional reset! ZK violated")
	}
	if dbWSK != initialWrappedSK {
		t.Fatalf("wrapped_sk_user was modified during exceptional reset! ZK violated")
	}

	// 10. Client Recovery Phase:
	// Employee client parses untouched wrapped_sk_user, extracts root_wrapped,
	// and decrypts it with the root secret.
	var storedEnvelope struct {
		RootWrapped string `json:"root_wrapped"`
	}
	_ = json.Unmarshal([]byte(dbWSK), &storedEnvelope)
	rootWrappedBytes, _ := hex.DecodeString(storedEnvelope.RootWrapped)
	recoveredNonce := rootWrappedBytes[:rootAead.NonceSize()]
	recoveredCiphertext := rootWrappedBytes[rootAead.NonceSize():]
	recoveredSkBytes, err := rootAead.Open(nil, recoveredNonce, recoveredCiphertext, []byte("mailbox-aad"))
	if err != nil {
		t.Fatalf("client failed to unwrap root_wrapped using root secret: %v", err)
	}
	if !bytes.Equal(recoveredSkBytes, mailboxSkBytes) {
		t.Fatalf("recovered secret key does not match original mailbox secret key!")
	}

	// 11. Client re-wraps recovered key under newPassword using Argon2id + AES-256-GCM
	newPwSalt := make([]byte, 16)
	_, _ = rand.Read(newPwSalt)
	newPwKey := argon2.IDKey([]byte(newPassword), newPwSalt, 3, 64*1024, 4, 32)
	newPwBlock, _ := aes.NewCipher(newPwKey)
	newPwAead, _ := cipher.NewGCM(newPwBlock)
	newPwNonce := make([]byte, newPwAead.NonceSize())
	_, _ = rand.Read(newPwNonce)
	newPwCiphertext := newPwAead.Seal(nil, newPwNonce, recoveredSkBytes, nil)
	newPassphraseEnvelope := hex.EncodeToString(append(newPwNonce, newPwCiphertext...))

	newWrappedSkPayload, _ := json.Marshal(map[string]string{
		"salt":         hex.EncodeToString(newPwSalt),
		"envelope":     newPassphraseEnvelope,
		"root_wrapped": storedEnvelope.RootWrapped,
	})

	// 12. Client sends re-wrapped keys to /v1/mailboxes/{id}/reactivate-keys
	reactivatePayload, _ := json.Marshal(map[string]string{
		"wrapped_sk_user": string(newWrappedSkPayload),
		"mailbox_pk":      mailboxPkHex,
	})
	reqReactivate := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mailboxID+"/reactivate-keys", bytes.NewReader(reactivatePayload))
	reqReactivate.SetPathValue("mailbox_id", mailboxID)
	reqReactivate.SetPathValue("id", mailboxID)
	var resetCookieToken string
	for _, c := range recReset.Result().Cookies() {
		if c.Name == "byos_session" && c.Value != "" {
			resetCookieToken = c.Value
			break
		}
	}
	if resetCookieToken == "" {
		t.Fatalf("expected byos_session cookie from reset-with-approval")
	}
	reqReactivate.AddCookie(&http.Cookie{Name: "byos_session", Value: resetCookieToken})
	recReactivate := httptest.NewRecorder()
	mailboxReactivateKeysHandler(recReactivate, reqReactivate)
	if recReactivate.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for reactivate-keys, got %d: %s", recReactivate.Code, recReactivate.Body.String())
	}

	// 13. Verify that the recovered key successfully decrypts the pre-reset synthetic historical message!
	recoveredPriv, err := curve.NewPrivateKey(recoveredSkBytes)
	if err != nil {
		t.Fatalf("failed recreating X25519 private key from recovered bytes: %v", err)
	}
	decSharedSecret, err := recoveredPriv.ECDH(ephemeralPub)
	if err != nil {
		t.Fatalf("ECDH computation failed: %v", err)
	}
	decSymKey := sha256.Sum256(decSharedSecret)
	decBlock, _ := aes.NewCipher(decSymKey[:])
	decAead, _ := cipher.NewGCM(decBlock)
	decryptedPlaintext, err := decAead.Open(nil, msgNonce, historicalCiphertext, nil)
	if err != nil {
		t.Fatalf("failed decrypting pre-reset historical message with recovered key: %v", err)
	}
	if !bytes.Equal(decryptedPlaintext, historicalPlaintext) {
		t.Fatalf("decrypted plaintext '%s' does not match original '%s'", string(decryptedPlaintext), string(historicalPlaintext))
	}
}

// TestMailboxReactivateKeysAtomicPreservationAndIdempotency verifies:
// 1. Malformed candidate envelopes are rejected before DB modifications.
// 2. Failed requests preserve the historical key envelope intact.
// 3. Successful reactivation replaces active envelope and clears historical envelope atomically.
// 4. Repeated/idempotent requests remain safe and do not corrupt mailbox state.
func TestMailboxReactivateKeysAtomicPreservationAndIdempotency(t *testing.T) {
	requireRecoveryStack(t)
	db := setupTestDB(t)
	defer db.Close()

	orgID, _, _, memberID := createTestOrgAndUsers(t, db)
	token := createTestSession(t, db, memberID)

	var domainID string
	err := db.QueryRow(`
		INSERT INTO domains (org_id, name, is_verified)
		VALUES ($1, $2, true)
		RETURNING id
	`, orgID, "test-atomic-"+uuid.New().String()[:8]+".local").Scan(&domainID)
	if err != nil {
		t.Fatalf("failed to insert domain: %v", err)
	}

	initialActiveWSK := `{"salt":"initial_active_salt","envelope":"initial_active_env"}`
	historicalWSK := `{"salt":"historical_salt_marker","envelope":"historical_env_marker","root_wrapped":"marker_root"}`

	// Create test mailbox with explicit historical envelope
	var mailboxID string
	err = db.QueryRow(`
		INSERT INTO mailboxes (org_id, user_id, domain_id, local_part, mode, is_active, wrapped_sk_user, mailbox_sk_wrapped, previous_wrapped_sk_user)
		VALUES ($1, $2, $3, $4, 'private', true, $5, $6, $7)
		RETURNING id
	`, orgID, memberID, domainID, "atomic-"+uuid.New().String()[:8], initialActiveWSK, []byte(initialActiveWSK), historicalWSK).Scan(&mailboxID)
	if err != nil {
		t.Fatalf("failed inserting test mailbox: %v", err)
	}

	callReactivate := func(payload map[string]interface{}) *httptest.ResponseRecorder {
		body, _ := json.Marshal(payload)
		req := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mailboxID+"/reactivate-keys", bytes.NewReader(body))
		req.SetPathValue("mailbox_id", mailboxID)
		req.SetPathValue("id", mailboxID)
		req.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
		rec := httptest.NewRecorder()
		mailboxReactivateKeysHandler(rec, req)
		return rec
	}

	assertEnvelopeState := func(expectedActive string, expectHistoricalNil bool, expectedHistorical string) {
		t.Helper()
		var currentActive string
		var currentHistorical *string
		err := db.QueryRow(`SELECT wrapped_sk_user, previous_wrapped_sk_user FROM mailboxes WHERE id = $1`, mailboxID).Scan(&currentActive, &currentHistorical)
		if err != nil {
			t.Fatalf("failed querying mailbox envelope state: %v", err)
		}
		if currentActive != expectedActive {
			t.Fatalf("expected wrapped_sk_user to be %q, got %q", expectedActive, currentActive)
		}
		if expectHistoricalNil {
			if currentHistorical != nil {
				t.Fatalf("expected previous_wrapped_sk_user to be nil, got %q", *currentHistorical)
			}
		} else {
			if currentHistorical == nil || *currentHistorical != expectedHistorical {
				t.Fatalf("expected previous_wrapped_sk_user to be %q, got %v", expectedHistorical, currentHistorical)
			}
		}
	}

	// 1. Rejection of malformed candidate envelopes (missing, invalid JSON, missing fields)
	rec1 := callReactivate(map[string]interface{}{"wrapped_sk_user": ""})
	if rec1.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request for empty envelope, got %d: %s", rec1.Code, rec1.Body.String())
	}
	assertEnvelopeState(initialActiveWSK, false, historicalWSK)

	rec2 := callReactivate(map[string]interface{}{"wrapped_sk_user": "{ invalid json "})
	if rec2.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request for invalid JSON, got %d: %s", rec2.Code, rec2.Body.String())
	}
	assertEnvelopeState(initialActiveWSK, false, historicalWSK)

	rec3 := callReactivate(map[string]interface{}{"wrapped_sk_user": "{}"})
	if rec3.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request for JSON missing fields, got %d: %s", rec3.Code, rec3.Body.String())
	}
	assertEnvelopeState(initialActiveWSK, false, historicalWSK)

	rec4 := callReactivate(map[string]interface{}{"wrapped_sk_user": ":bad_colon"})
	if rec4.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request for bad colon envelope, got %d: %s", rec4.Code, rec4.Body.String())
	}
	assertEnvelopeState(initialActiveWSK, false, historicalWSK)

	// 2. Successful atomic replacement and historical envelope clearing
	validCandidate := `{"salt":"cand_salt_1111","envelope":"cand_env_2222","root_wrapped":"marker_root"}`
	rec5 := callReactivate(map[string]interface{}{"wrapped_sk_user": validCandidate})
	if rec5.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for valid reactivation, got %d: %s", rec5.Code, rec5.Body.String())
	}
	assertEnvelopeState(validCandidate, true, "")

	// 3. Repeated reactivation / network retry idempotency
	rec6 := callReactivate(map[string]interface{}{"wrapped_sk_user": validCandidate})
	if rec6.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for repeated reactivation retry, got %d: %s", rec6.Code, rec6.Body.String())
	}
	assertEnvelopeState(validCandidate, true, "")

	// 4. Repeated reactivation with updated envelope continues safely
	validCandidate2 := `{"salt":"cand_salt_3333","envelope":"cand_env_4444"}`
	rec7 := callReactivate(map[string]interface{}{"wrapped_sk_user": validCandidate2})
	if rec7.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for repeated reactivation with new envelope, got %d: %s", rec7.Code, rec7.Body.String())
	}
	assertEnvelopeState(validCandidate2, true, "")
}

func TestStagedHistoricalKeyReactivationLifecycle(t *testing.T) {
	requireRecoveryStack(t)
	db := setupTestDB(t)
	defer db.Close()

	orgID, ownerID, adminID, memberID := createTestOrgAndUsers(t, db)
	memberToken := createTestSession(t, db, memberID)
	ownerToken := createTestSession(t, db, ownerID)
	adminToken := createTestSession(t, db, adminID)

	// Additional non-owner user for cross-user tests
	var member2ID string
	err := db.QueryRow(`
		INSERT INTO users (org_id, email, password_hash, role, is_active)
		VALUES ($1, $2, 'hash', 'member', true)
		RETURNING id
	`, orgID, "member2-"+uuid.New().String()[:8]+"@test.local").Scan(&member2ID)
	if err != nil {
		t.Fatalf("failed inserting member2: %v", err)
	}
	member2Token := createTestSession(t, db, member2ID)

	var domainID string
	err = db.QueryRow(`
		INSERT INTO domains (org_id, name, is_verified)
		VALUES ($1, $2, true)
		RETURNING id
	`, orgID, "test-staged-"+uuid.New().String()[:8]+".local").Scan(&domainID)
	if err != nil {
		t.Fatalf("failed inserting domain: %v", err)
	}

	initialActiveWSK := `{"salt":"active_salt_001","envelope":"active_env_001"}`
	historicalWSK := `{"salt":"hist_salt_001","envelope":"hist_env_001","root_wrapped":"marker_root_original"}`

	// Create test mailbox
	var mailboxID string
	err = db.QueryRow(`
		INSERT INTO mailboxes (org_id, user_id, domain_id, local_part, mode, is_active, wrapped_sk_user, mailbox_sk_wrapped, previous_wrapped_sk_user)
		VALUES ($1, $2, $3, $4, 'private', true, $5, $6, $7)
		RETURNING id
	`, orgID, memberID, domainID, "staged-mb-"+uuid.New().String()[:8], initialActiveWSK, []byte(initialActiveWSK), historicalWSK).Scan(&mailboxID)
	if err != nil {
		t.Fatalf("failed inserting mailbox: %v", err)
	}

	callPrepare := func(token string, mbID string, payload map[string]interface{}) *httptest.ResponseRecorder {
		body, _ := json.Marshal(payload)
		req := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mbID+"/reactivate-keys/prepare", bytes.NewReader(body))
		req.SetPathValue("mailbox_id", mbID)
		req.SetPathValue("id", mbID)
		req.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
		rec := httptest.NewRecorder()
		mailboxReactivateKeysPrepareHandler(rec, req)
		return rec
	}

	callPending := func(token string, mbID string, migrationID string) *httptest.ResponseRecorder {
		url := "/v1/mailboxes/" + mbID + "/reactivate-keys/pending"
		if migrationID != "" {
			url = "/v1/mailboxes/" + mbID + "/reactivate-keys/" + migrationID
		}
		req := httptest.NewRequest(http.MethodGet, url, nil)
		req.SetPathValue("mailbox_id", mbID)
		req.SetPathValue("id", mbID)
		if migrationID != "" {
			req.SetPathValue("migration_id", migrationID)
		}
		req.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
		rec := httptest.NewRecorder()
		mailboxReactivateKeysPendingHandler(rec, req)
		return rec
	}

	callFinalize := func(token string, mbID string, migID string) *httptest.ResponseRecorder {
		body, _ := json.Marshal(map[string]string{"migration_id": migID})
		req := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mbID+"/reactivate-keys/finalize", bytes.NewReader(body))
		req.SetPathValue("mailbox_id", mbID)
		req.SetPathValue("id", mbID)
		req.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
		rec := httptest.NewRecorder()
		mailboxReactivateKeysFinalizeHandler(rec, req)
		return rec
	}

	callRollback := func(token string, mbID string, migID string, reason string) *httptest.ResponseRecorder {
		body, _ := json.Marshal(map[string]string{"migration_id": migID, "reason": reason})
		req := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mbID+"/reactivate-keys/rollback", bytes.NewReader(body))
		req.SetPathValue("mailbox_id", mbID)
		req.SetPathValue("id", mbID)
		req.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
		rec := httptest.NewRecorder()
		mailboxReactivateKeysRollbackHandler(rec, req)
		return rec
	}

	assertMailboxEnvelopes := func(expectedActive string, expectHistoricalNil bool, expectedHist string) {
		t.Helper()
		var currActive string
		var currHist *string
		err := db.QueryRow(`SELECT wrapped_sk_user, previous_wrapped_sk_user FROM mailboxes WHERE id = $1`, mailboxID).Scan(&currActive, &currHist)
		if err != nil {
			t.Fatalf("failed querying mailbox: %v", err)
		}
		if currActive != expectedActive {
			t.Fatalf("active envelope mismatch: got %q, want %q", currActive, expectedActive)
		}
		if expectHistoricalNil {
			if currHist != nil {
				t.Fatalf("expected previous_wrapped_sk_user to be nil, got %q", *currHist)
			}
		} else {
			if currHist == nil || *currHist != expectedHist {
				t.Fatalf("historical envelope mismatch: got %v, want %q", currHist, expectedHist)
			}
		}
	}

	// 1. Structural envelope validation on prepare
	recBad1 := callPrepare(memberToken, mailboxID, map[string]interface{}{"wrapped_sk_user": ""})
	if recBad1.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for empty envelope, got %d", recBad1.Code)
	}
	recBad2 := callPrepare(memberToken, mailboxID, map[string]interface{}{"wrapped_sk_user": "{ invalid "})
	if recBad2.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid JSON envelope, got %d", recBad2.Code)
	}
	recBad3 := callPrepare(memberToken, mailboxID, map[string]interface{}{"wrapped_sk_user": "{}"})
	if recBad3.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing fields in envelope, got %d", recBad3.Code)
	}
	assertMailboxEnvelopes(initialActiveWSK, false, historicalWSK)

	// 2. Cross-user authorization checks
	validCandidate1 := `{"salt":"cand_salt_001","envelope":"cand_env_001","root_wrapped":"marker_root_001"}`
	recOwner := callPrepare(ownerToken, mailboxID, map[string]interface{}{"wrapped_sk_user": validCandidate1})
	if recOwner.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for org owner prepare, got %d", recOwner.Code)
	}
	recAdmin := callPrepare(adminToken, mailboxID, map[string]interface{}{"wrapped_sk_user": validCandidate1})
	if recAdmin.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for org admin prepare, got %d", recAdmin.Code)
	}
	recOther := callPrepare(member2Token, mailboxID, map[string]interface{}{"wrapped_sk_user": validCandidate1})
	if recOther.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for other member prepare, got %d", recOther.Code)
	}
	assertMailboxEnvelopes(initialActiveWSK, false, historicalWSK)

	// 3. Correct candidate preparation preserves envelopes and returns migration_id
	recPrep := callPrepare(memberToken, mailboxID, map[string]interface{}{"wrapped_sk_user": validCandidate1})
	if recPrep.Code != http.StatusCreated && recPrep.Code != http.StatusOK {
		t.Fatalf("expected 201/200 for valid prepare, got %d: %s", recPrep.Code, recPrep.Body.String())
	}
	var prepResp struct {
		MigrationID string `json:"migration_id"`
		Status      string `json:"status"`
		ExpiresAt   string `json:"expires_at"`
	}
	json.NewDecoder(recPrep.Body).Decode(&prepResp)
	if prepResp.MigrationID == "" || prepResp.Status != "pending" {
		t.Fatalf("invalid prepare response: %+v", prepResp)
	}
	// Crucial check: Prepare must NEVER touch active or historical envelopes!
	assertMailboxEnvelopes(initialActiveWSK, false, historicalWSK)

	// 4. Cross-user read-back rejection
	recOtherPending := callPending(member2Token, mailboxID, prepResp.MigrationID)
	if recOtherPending.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for cross-user pending read-back, got %d", recOtherPending.Code)
	}

	// 5. Authorized read-back returns exact candidate envelope
	recPending := callPending(memberToken, mailboxID, prepResp.MigrationID)
	if recPending.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for pending read-back, got %d: %s", recPending.Code, recPending.Body.String())
	}
	var pendingResp struct {
		MigrationID        string `json:"migration_id"`
		CandidateWrappedSk string `json:"candidate_wrapped_sk"`
		Status             string `json:"status"`
	}
	json.NewDecoder(recPending.Body).Decode(&pendingResp)
	if pendingResp.CandidateWrappedSk != validCandidate1 {
		t.Fatalf("read-back envelope mismatch: got %q, want %q", pendingResp.CandidateWrappedSk, validCandidate1)
	}

	// 6. Rollback preserves original active and historical envelopes
	recRoll := callRollback(memberToken, mailboxID, prepResp.MigrationID, "verification_mismatch_test")
	if recRoll.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for rollback, got %d: %s", recRoll.Code, recRoll.Body.String())
	}
	assertMailboxEnvelopes(initialActiveWSK, false, historicalWSK)

	// 7. Repeated rollback is idempotent
	recRollAgain := callRollback(memberToken, mailboxID, prepResp.MigrationID, "verification_mismatch_test")
	if recRollAgain.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for repeated rollback, got %d: %s", recRollAgain.Code, recRollAgain.Body.String())
	}
	assertMailboxEnvelopes(initialActiveWSK, false, historicalWSK)

	// 8. Cannot finalize a rolled back reactivation
	recFinRolled := callFinalize(memberToken, mailboxID, prepResp.MigrationID)
	if recFinRolled.Code != http.StatusConflict {
		t.Fatalf("expected 409 Conflict when finalizing rolled-back migration, got %d", recFinRolled.Code)
	}
	assertMailboxEnvelopes(initialActiveWSK, false, historicalWSK)

	// 9. Lost-response retry on prepare with identical candidate returns existing migration_id
	validCandidate2 := `{"salt":"cand_salt_002","envelope":"cand_env_002","root_wrapped":"marker_root_002"}`
	recPrep2A := callPrepare(memberToken, mailboxID, map[string]interface{}{"wrapped_sk_user": validCandidate2})
	if recPrep2A.Code != http.StatusCreated && recPrep2A.Code != http.StatusOK {
		t.Fatalf("expected 201/200 for prepare 2A, got %d: %s", recPrep2A.Code, recPrep2A.Body.String())
	}
	var prepResp2A struct {
		MigrationID string `json:"migration_id"`
	}
	json.NewDecoder(recPrep2A.Body).Decode(&prepResp2A)

	recPrep2B := callPrepare(memberToken, mailboxID, map[string]interface{}{"wrapped_sk_user": validCandidate2})
	if recPrep2B.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for repeated prepare retry, got %d: %s", recPrep2B.Code, recPrep2B.Body.String())
	}
	var prepResp2B struct {
		MigrationID string `json:"migration_id"`
	}
	json.NewDecoder(recPrep2B.Body).Decode(&prepResp2B)
	if prepResp2A.MigrationID != prepResp2B.MigrationID {
		t.Fatalf("expected identical migration_id for idempotent prepare retry, got %s vs %s", prepResp2A.MigrationID, prepResp2B.MigrationID)
	}

	// 10. Successful finalization atomically promotes candidate and clears historical envelope
	recFin := callFinalize(memberToken, mailboxID, prepResp2A.MigrationID)
	if recFin.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for finalize, got %d: %s", recFin.Code, recFin.Body.String())
	}
	assertMailboxEnvelopes(validCandidate2, true, "")

	// 11. Repeated finalization after success is idempotent (lost response recovery)
	recFinRetry := callFinalize(memberToken, mailboxID, prepResp2A.MigrationID)
	if recFinRetry.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for repeated finalize retry, got %d: %s", recFinRetry.Code, recFinRetry.Body.String())
	}
	assertMailboxEnvelopes(validCandidate2, true, "")

	// 12. Cannot rollback a finalized migration
	recRollFinal := callRollback(memberToken, mailboxID, prepResp2A.MigrationID, "attempt_rollback_finalized")
	if recRollFinal.Code != http.StatusConflict {
		t.Fatalf("expected 409 Conflict when rolling back finalized migration, got %d", recRollFinal.Code)
	}

	// 13. Expired preparation cleanup test
	// Setup fresh historical envelope
	freshHistorical := `{"salt":"hist_003","envelope":"env_003"}`
	_, err = db.Exec(`UPDATE mailboxes SET previous_wrapped_sk_user = $1 WHERE id = $2`, freshHistorical, mailboxID)
	if err != nil {
		t.Fatalf("failed updating historical envelope: %v", err)
	}

	cand3 := `{"salt":"cand_003","envelope":"cand_003"}`
	recPrep3 := callPrepare(memberToken, mailboxID, map[string]interface{}{"wrapped_sk_user": cand3})
	if recPrep3.Code != http.StatusCreated && recPrep3.Code != http.StatusOK {
		t.Fatalf("failed prepare 3: %d", recPrep3.Code)
	}
	var prepResp3 struct {
		MigrationID string `json:"migration_id"`
	}
	json.NewDecoder(recPrep3.Body).Decode(&prepResp3)

	// Simulate expiration by setting expires_at to 1 hour in the past
	_, err = db.Exec(`UPDATE mailbox_key_reactivations SET expires_at = NOW() - INTERVAL '1 hour' WHERE id = $1`, prepResp3.MigrationID)
	if err != nil {
		t.Fatalf("failed forcing expiration: %v", err)
	}

	// Read-back reflects expired status (410 Gone)
	recExpPending := callPending(memberToken, mailboxID, prepResp3.MigrationID)
	if recExpPending.Code != http.StatusGone {
		t.Fatalf("expected 410 Gone for expired pending read-back, got %d", recExpPending.Code)
	}

	// Finalizing an expired migration fails with 409 Conflict and preserves original historical envelope
	recExpFin := callFinalize(memberToken, mailboxID, prepResp3.MigrationID)
	if recExpFin.Code != http.StatusConflict {
		t.Fatalf("expected 409 Conflict when finalizing expired operation, got %d", recExpFin.Code)
	}
	assertMailboxEnvelopes(validCandidate2, false, freshHistorical)

	// 14. Mailbox deactivation during pending reactivation
	cand4 := `{"salt":"cand_004","envelope":"cand_004"}`
	recPrep4 := callPrepare(memberToken, mailboxID, map[string]interface{}{"wrapped_sk_user": cand4})
	if recPrep4.Code != http.StatusCreated && recPrep4.Code != http.StatusOK {
		t.Fatalf("failed prepare 4: %d", recPrep4.Code)
	}
	var prepResp4 struct {
		MigrationID string `json:"migration_id"`
	}
	json.NewDecoder(recPrep4.Body).Decode(&prepResp4)

	// Deactivate mailbox
	_, err = db.Exec(`UPDATE mailboxes SET is_active = false WHERE id = $1`, mailboxID)
	if err != nil {
		t.Fatalf("failed deactivating mailbox: %v", err)
	}

	// Finalize fails with 403 Forbidden because mailbox is deactivated
	recDeactFin := callFinalize(memberToken, mailboxID, prepResp4.MigrationID)
	if recDeactFin.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden when finalizing deactivated mailbox, got %d", recDeactFin.Code)
	}

	// Restore is_active for cleanup
	_, _ = db.Exec(`UPDATE mailboxes SET is_active = true WHERE id = $1`, mailboxID)
}

// TestPasswordModificationInvalidatesPendingReactivations covers:
// - Normal password change invalidates pending reactivation
// - Exceptional recovery password reset invalidates pending reactivation
// - Recovery flow password reset invalidates pending reactivation
// - Failed password change leaves pending reactivation and password state unchanged
// - Invalidation for one user does not affect another user's pending reactivation
// - Concurrency race between finalize and password change produces a consistent outcome without deadlock
// - Historical and active envelopes remain byte-for-byte unchanged during invalidation
func TestPasswordModificationInvalidatesPendingReactivations(t *testing.T) {
	requireRecoveryStack(t)
	db := setupTestDB(t)
	defer db.Close()

	orgID, ownerID, adminID, memberID := createTestOrgAndUsers(t, db)
	_ = ownerID
	_ = adminID

	initialPassword := "initial-secure-password-123"
	pwdHash, err := hashPassword(initialPassword)
	if err != nil {
		t.Fatalf("failed hashing password: %v", err)
	}
	_, err = db.Exec(`UPDATE users SET password_hash = $1 WHERE id = $2`, pwdHash, memberID)
	if err != nil {
		t.Fatalf("failed setting member password: %v", err)
	}
	memberToken := createTestSession(t, db, memberID)

	var domainID string
	err = db.QueryRow(`
		INSERT INTO domains (org_id, name, is_verified)
		VALUES ($1, $2, true)
		RETURNING id
	`, orgID, "test-inval-"+uuid.New().String()[:8]+".local").Scan(&domainID)
	if err != nil {
		t.Fatalf("failed inserting domain: %v", err)
	}

	initialActiveWSK := `{"salt":"active_salt_inval_01","envelope":"active_env_inval_01"}`
	historicalWSK := `{"salt":"hist_salt_inval_01","envelope":"hist_env_inval_01","root_wrapped":"root_marker_inval_01"}`

	var mailboxID string
	err = db.QueryRow(`
		INSERT INTO mailboxes (org_id, user_id, domain_id, local_part, mode, is_active, wrapped_sk_user, mailbox_sk_wrapped, previous_wrapped_sk_user)
		VALUES ($1, $2, $3, $4, 'private', true, $5, $6, $7)
		RETURNING id
	`, orgID, memberID, domainID, "inval-mb-"+uuid.New().String()[:8], initialActiveWSK, []byte(initialActiveWSK), historicalWSK).Scan(&mailboxID)
	if err != nil {
		t.Fatalf("failed inserting mailbox: %v", err)
	}

	callPrepare := func(token string, mbID string, payload map[string]interface{}) *httptest.ResponseRecorder {
		body, _ := json.Marshal(payload)
		req := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mbID+"/reactivate-keys/prepare", bytes.NewReader(body))
		req.SetPathValue("mailbox_id", mbID)
		req.SetPathValue("id", mbID)
		req.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
		rec := httptest.NewRecorder()
		mailboxReactivateKeysPrepareHandler(rec, req)
		return rec
	}

	callFinalize := func(token string, mbID string, migID string) *httptest.ResponseRecorder {
		body, _ := json.Marshal(map[string]string{"migration_id": migID})
		req := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mbID+"/reactivate-keys/finalize", bytes.NewReader(body))
		req.SetPathValue("mailbox_id", mbID)
		req.SetPathValue("id", mbID)
		req.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
		rec := httptest.NewRecorder()
		mailboxReactivateKeysFinalizeHandler(rec, req)
		return rec
	}

	// -------------------------------------------------------------------------
	// Scenario 1: Normal password change invalidates pending reactivation
	// -------------------------------------------------------------------------
	cand1 := `{"salt":"cand_salt_inval_01","envelope":"cand_env_inval_01","root_wrapped":"cand_root_inval_01"}`
	recPrep1 := callPrepare(memberToken, mailboxID, map[string]interface{}{"wrapped_sk_user": cand1})
	if recPrep1.Code != http.StatusCreated && recPrep1.Code != http.StatusOK {
		t.Fatalf("prepare failed: %d: %s", recPrep1.Code, recPrep1.Body.String())
	}
	var prepResp1 struct {
		MigrationID string `json:"migration_id"`
		Status      string `json:"status"`
	}
	json.NewDecoder(recPrep1.Body).Decode(&prepResp1)
	if prepResp1.Status != "pending" || prepResp1.MigrationID == "" {
		t.Fatalf("expected pending status, got %+v", prepResp1)
	}

	// Verify active and historical envelopes are byte-for-byte untouched after prepare
	var preChangeActive string
	var preChangeHist *string
	err = db.QueryRow(`SELECT wrapped_sk_user, previous_wrapped_sk_user FROM mailboxes WHERE id = $1`, mailboxID).Scan(&preChangeActive, &preChangeHist)
	if err != nil {
		t.Fatalf("failed querying mailbox: %v", err)
	}
	if preChangeActive != initialActiveWSK {
		t.Fatalf("active envelope changed on prepare: got %q, want %q", preChangeActive, initialActiveWSK)
	}
	if preChangeHist == nil || *preChangeHist != historicalWSK {
		t.Fatalf("historical envelope changed on prepare: got %v, want %q", preChangeHist, historicalWSK)
	}

	// Normal password change with re-wrapped envelope
	newPassword1 := "new-password-changed-123"
	newWsk1 := `{"salt":"new_salt_cp_01","envelope":"new_env_cp_01","root_wrapped":"root_cp_01"}`
	cpPayload := map[string]string{
		"current_password": initialPassword,
		"new_password":     newPassword1,
		"wrapped_sk_user":  newWsk1,
		"mailbox_id":       mailboxID,
	}
	bodyBytes, _ := json.Marshal(cpPayload)
	reqCP := httptest.NewRequest(http.MethodPost, "/v1/auth/change-password", bytes.NewReader(bodyBytes))
	reqCP.AddCookie(&http.Cookie{Name: "byos_session", Value: memberToken})
	recCP := httptest.NewRecorder()
	changePasswordHandler(recCP, reqCP)
	if recCP.Code != http.StatusNoContent {
		t.Fatalf("change-password failed: %d: %s", recCP.Code, recCP.Body.String())
	}

	// Assert reactivation record is rolled back with exact reason
	var status1, reason1 string
	var rolledBackAt1 *time.Time
	err = db.QueryRow(`
		SELECT status, rollback_reason, rolled_back_at
		FROM mailbox_key_reactivations
		WHERE id = $1
	`, prepResp1.MigrationID).Scan(&status1, &reason1, &rolledBackAt1)
	if err != nil {
		t.Fatalf("failed querying reactivation record: %v", err)
	}
	if status1 != "rolled_back" {
		t.Fatalf("expected status rolled_back, got %s", status1)
	}
	if reason1 != "password_changed_during_pending" {
		t.Fatalf("expected rollback_reason 'password_changed_during_pending', got %q", reason1)
	}
	if rolledBackAt1 == nil {
		t.Fatalf("expected rolled_back_at to be non-nil")
	}

	// Assert historical envelope remains byte-for-byte unchanged
	var postChangeActive string
	var postChangeHist *string
	err = db.QueryRow(`SELECT wrapped_sk_user, previous_wrapped_sk_user FROM mailboxes WHERE id = $1`, mailboxID).Scan(&postChangeActive, &postChangeHist)
	if err != nil {
		t.Fatalf("failed querying mailbox post-change: %v", err)
	}
	if postChangeHist == nil || *postChangeHist != historicalWSK {
		t.Fatalf("historical envelope altered during password change invalidation! got %v, want %q", postChangeHist, historicalWSK)
	}
	if postChangeActive != newWsk1 {
		t.Fatalf("active envelope was not updated to new wrapped key: got %q, want %q", postChangeActive, newWsk1)
	}

	// Finalize must fail with 409 Conflict
	recFin1 := callFinalize(memberToken, mailboxID, prepResp1.MigrationID)
	if recFin1.Code != http.StatusConflict {
		t.Fatalf("expected 409 Conflict finalizing rolled-back reactivation, got %d: %s", recFin1.Code, recFin1.Body.String())
	}

	// -------------------------------------------------------------------------
	// Scenario 2: Failed password modification leaves pending operation untouched
	// -------------------------------------------------------------------------
	cand2 := `{"salt":"cand_salt_inval_02","envelope":"cand_env_inval_02"}`
	recPrep2 := callPrepare(memberToken, mailboxID, map[string]interface{}{"wrapped_sk_user": cand2})
	if recPrep2.Code != http.StatusCreated && recPrep2.Code != http.StatusOK {
		t.Fatalf("prepare 2 failed: %d", recPrep2.Code)
	}
	var prepResp2 struct {
		MigrationID string `json:"migration_id"`
	}
	json.NewDecoder(recPrep2.Body).Decode(&prepResp2)

	// Attempt password change with wrong current password
	badCPPayload := map[string]string{
		"current_password": "wrong-incorrect-password-999",
		"new_password":     "attempted-new-password-456",
		"wrapped_sk_user":  `{"salt":"bad_salt","envelope":"bad_env"}`,
	}
	badBody, _ := json.Marshal(badCPPayload)
	reqBadCP := httptest.NewRequest(http.MethodPost, "/v1/auth/change-password", bytes.NewReader(badBody))
	reqBadCP.AddCookie(&http.Cookie{Name: "byos_session", Value: memberToken})
	recBadCP := httptest.NewRecorder()
	changePasswordHandler(recBadCP, reqBadCP)
	if recBadCP.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized for bad password change, got %d", recBadCP.Code)
	}

	// Assert pending record is STILL pending and un-rolled-back
	var status2 string
	var rolledBackAt2 *time.Time
	err = db.QueryRow(`
		SELECT status, rolled_back_at
		FROM mailbox_key_reactivations
		WHERE id = $1
	`, prepResp2.MigrationID).Scan(&status2, &rolledBackAt2)
	if err != nil {
		t.Fatalf("failed querying reactivation 2: %v", err)
	}
	if status2 != "pending" {
		t.Fatalf("expected status to remain pending on failed password change, got %s", status2)
	}
	if rolledBackAt2 != nil {
		t.Fatalf("rolled_back_at must be nil when password change fails")
	}

	// -------------------------------------------------------------------------
	// Scenario 3: Exceptional recovery reset invalidates pending reactivation
	// -------------------------------------------------------------------------
	var memberEmail string
	err = db.QueryRow(`SELECT email FROM users WHERE id = $1`, memberID).Scan(&memberEmail)
	if err != nil {
		t.Fatalf("failed querying member email: %v", err)
	}
	challengeTokenEx := "ex-auth-tok-" + uuid.New().String()
	_, err = db.Exec(`
		INSERT INTO auth_challenges (user_id, challenge_token, challenge_type, expires_at)
		VALUES ($1, $2, 'exceptional_reset_approved', NOW() + INTERVAL '10 minutes')
	`, memberID, challengeTokenEx)
	if err != nil {
		t.Fatalf("failed inserting exceptional challenge: %v", err)
	}

	exResetPayload := map[string]string{
		"email":              memberEmail,
		"authorization_code": challengeTokenEx,
		"new_password":       "ExceptionalNewPassword123!",
	}
	exBody, _ := json.Marshal(exResetPayload)
	reqExReset := httptest.NewRequest(http.MethodPost, "/v1/auth/recovery/reset-with-approval", bytes.NewReader(exBody))
	recExReset := httptest.NewRecorder()
	exceptionalRecoveryResetHandler(recExReset, reqExReset)
	if recExReset.Code != http.StatusOK {
		t.Fatalf("exceptional reset failed: %d: %s", recExReset.Code, recExReset.Body.String())
	}

	// Assert reactivation 2 was rolled back by exceptional recovery
	var status3, reason3 string
	err = db.QueryRow(`
		SELECT status, rollback_reason
		FROM mailbox_key_reactivations
		WHERE id = $1
	`, prepResp2.MigrationID).Scan(&status3, &reason3)
	if err != nil {
		t.Fatalf("failed querying reactivation 3: %v", err)
	}
	if status3 != "rolled_back" {
		t.Fatalf("expected status rolled_back, got %s", status3)
	}
	if reason3 != "exceptional_recovery_reset_during_pending" {
		t.Fatalf("expected rollback_reason 'exceptional_recovery_reset_during_pending', got %q", reason3)
	}

	// Finalize candidate 2 must fail with 409
	memberTokenPostEx := createTestSession(t, db, memberID)
	recFin2 := callFinalize(memberTokenPostEx, mailboxID, prepResp2.MigrationID)
	if recFin2.Code != http.StatusConflict {
		t.Fatalf("expected 409 Conflict for finalized rolled-back candidate 2, got %d", recFin2.Code)
	}

	// -------------------------------------------------------------------------
	// Scenario 4: Recovery flow reset password invalidates pending reactivation
	// -------------------------------------------------------------------------
	cand3 := `{"salt":"cand_salt_inval_03","envelope":"cand_env_inval_03"}`
	recPrep3 := callPrepare(memberTokenPostEx, mailboxID, map[string]interface{}{"wrapped_sk_user": cand3})
	if recPrep3.Code != http.StatusCreated && recPrep3.Code != http.StatusOK {
		t.Fatalf("prepare 3 failed: %d", recPrep3.Code)
	}
	var prepResp3 struct {
		MigrationID string `json:"migration_id"`
	}
	json.NewDecoder(recPrep3.Body).Decode(&prepResp3)

	totpSecret := "JBSWY3DPEHPK3PXP"
	_, err = db.Exec(`UPDATE users SET totp_secret = $1, two_factor_enabled = true WHERE id = $2`, totpSecret, memberID)
	if err != nil {
		t.Fatalf("failed setting totp_secret: %v", err)
	}

	totpCode, err := computeTOTP(totpSecret, time.Now())
	if err != nil {
		t.Fatalf("failed computing TOTP code: %v", err)
	}
	challengeTokenRec := "rec-flow-tok-" + uuid.New().String()
	_, err = db.Exec(`
		INSERT INTO auth_challenges (user_id, challenge_token, challenge_type, expires_at)
		VALUES ($1, $2, 'recovery_reset_totp', NOW() + INTERVAL '10 minutes')
	`, memberID, challengeTokenRec)
	if err != nil {
		t.Fatalf("failed inserting recovery challenge: %v", err)
	}

	recResetPayload := map[string]string{
		"challenge_token": challengeTokenRec,
		"code":            totpCode,
		"new_password":    "RecFlowNewPassword123!",
	}
	recBody, _ := json.Marshal(recResetPayload)
	reqRecReset := httptest.NewRequest(http.MethodPost, "/v1/auth/recovery/reset-password", bytes.NewReader(recBody))
	recRecReset := httptest.NewRecorder()
	recoveryFlowResetPasswordHandler(recRecReset, reqRecReset)
	if recRecReset.Code != http.StatusOK {
		t.Fatalf("recovery flow reset password failed: %d: %s", recRecReset.Code, recRecReset.Body.String())
	}

	// Assert reactivation 3 was rolled back by recovery flow reset
	var status4, reason4 string
	err = db.QueryRow(`
		SELECT status, rollback_reason
		FROM mailbox_key_reactivations
		WHERE id = $1
	`, prepResp3.MigrationID).Scan(&status4, &reason4)
	if err != nil {
		t.Fatalf("failed querying reactivation 4: %v", err)
	}
	if status4 != "rolled_back" {
		t.Fatalf("expected status rolled_back, got %s", status4)
	}
	if reason4 != "password_reset_during_pending" {
		t.Fatalf("expected rollback_reason 'password_reset_during_pending', got %q", reason4)
	}

	// Finalize candidate 3 must fail with 409
	memberTokenPostRec := createTestSession(t, db, memberID)
	recFin3 := callFinalize(memberTokenPostRec, mailboxID, prepResp3.MigrationID)
	if recFin3.Code != http.StatusConflict {
		t.Fatalf("expected 409 Conflict for finalized rolled-back candidate 3, got %d", recFin3.Code)
	}

	// -------------------------------------------------------------------------
	// Scenario 5: Multi-user isolation: Password change for User A does NOT affect User B
	// -------------------------------------------------------------------------
	var userB_ID string
	userB_Pass := "user-b-password-123"
	bHash, _ := hashPassword(userB_Pass)
	err = db.QueryRow(`
		INSERT INTO users (org_id, email, password_hash, role, is_active)
		VALUES ($1, $2, $3, 'member', true)
		RETURNING id
	`, orgID, "user-b-"+uuid.New().String()[:8]+"@test.local", bHash).Scan(&userB_ID)
	if err != nil {
		t.Fatalf("failed inserting user B: %v", err)
	}
	userBToken := createTestSession(t, db, userB_ID)

	var mbB_ID string
	bHistWSK := `{"salt":"b_hist_salt","envelope":"b_hist_env","root_wrapped":"b_root"}`
	err = db.QueryRow(`
		INSERT INTO mailboxes (org_id, user_id, domain_id, local_part, mode, is_active, wrapped_sk_user, mailbox_sk_wrapped, previous_wrapped_sk_user)
		VALUES ($1, $2, $3, $4, 'private', true, 'b_active_env', decode('AA==','base64'), $5)
		RETURNING id
	`, orgID, userB_ID, domainID, "mb-b-"+uuid.New().String()[:8], bHistWSK).Scan(&mbB_ID)
	if err != nil {
		t.Fatalf("failed inserting mailbox B: %v", err)
	}

	// Prepare reactivation for User A (restore historical envelope first so prepare succeeds)
	_, _ = db.Exec(`UPDATE mailboxes SET previous_wrapped_sk_user = $1 WHERE id = $2`, historicalWSK, mailboxID)
	candA := `{"salt":"cand_a_salt","envelope":"cand_a_env"}`
	recPrepA := callPrepare(memberTokenPostRec, mailboxID, map[string]interface{}{"wrapped_sk_user": candA})
	if recPrepA.Code != http.StatusCreated && recPrepA.Code != http.StatusOK {
		t.Fatalf("prepare A failed: %d", recPrepA.Code)
	}
	var prepRespA struct {
		MigrationID string `json:"migration_id"`
	}
	json.NewDecoder(recPrepA.Body).Decode(&prepRespA)

	// Prepare reactivation for User B
	candB := `{"salt":"cand_b_salt","envelope":"cand_b_env"}`
	recPrepB := callPrepare(userBToken, mbB_ID, map[string]interface{}{"wrapped_sk_user": candB})
	if recPrepB.Code != http.StatusCreated && recPrepB.Code != http.StatusOK {
		t.Fatalf("prepare B failed: %d", recPrepB.Code)
	}
	var prepRespB struct {
		MigrationID string `json:"migration_id"`
	}
	json.NewDecoder(recPrepB.Body).Decode(&prepRespB)

	// User A changes password (use fresh step-up MFA token to avoid 30s TOTP replay collision with earlier steps)
	stepUpTokA, _ := generateRandomBase64URL(32)
	_, _ = db.Exec(`INSERT INTO auth_challenges (user_id, challenge_type, challenge_token, destination, expires_at) VALUES ($1, 'step_up_mfa', $2, 'totp', NOW() + INTERVAL '5 minutes')`, memberID, stepUpTokA)
	newPassA := "new-password-user-a-999"
	cpPayloadA := map[string]string{
		"current_password": "RecFlowNewPassword123!",
		"new_password":     newPassA,
		"wrapped_sk_user":  `{"salt":"a_new_salt","envelope":"a_new_env"}`,
		"mailbox_id":       mailboxID,
		"mfa_code":         stepUpTokA,
	}
	cpBodyA, _ := json.Marshal(cpPayloadA)
	reqCPA := httptest.NewRequest(http.MethodPost, "/v1/auth/change-password", bytes.NewReader(cpBodyA))
	reqCPA.AddCookie(&http.Cookie{Name: "byos_session", Value: memberTokenPostRec})
	recCPA := httptest.NewRecorder()
	changePasswordHandler(recCPA, reqCPA)
	if recCPA.Code != http.StatusNoContent {
		t.Fatalf("change-password user A failed: %d: %s", recCPA.Code, recCPA.Body.String())
	}

	// Assert Reactivation A is rolled back
	var statusA string
	err = db.QueryRow(`SELECT status FROM mailbox_key_reactivations WHERE id = $1`, prepRespA.MigrationID).Scan(&statusA)
	if err != nil || statusA != "rolled_back" {
		t.Fatalf("expected reactivation A to be rolled_back, got %s (err: %v)", statusA, err)
	}

	// Assert Reactivation B is STILL pending!
	var statusB string
	err = db.QueryRow(`SELECT status FROM mailbox_key_reactivations WHERE id = $1`, prepRespB.MigrationID).Scan(&statusB)
	if err != nil || statusB != "pending" {
		t.Fatalf("expected reactivation B to remain pending, got %s (err: %v)", statusB, err)
	}

	// User B successfully finalizes Reactivation B!
	recFinB := callFinalize(userBToken, mbB_ID, prepRespB.MigrationID)
	if recFinB.Code != http.StatusOK {
		t.Fatalf("finalize B failed: %d: %s", recFinB.Code, recFinB.Body.String())
	}

	// -------------------------------------------------------------------------
	// Scenario 6: Concurrency race: Finalize racing with password change
	// -------------------------------------------------------------------------
	// Setup User C and Mailbox C
	var userC_ID string
	userC_Pass := "user-c-password-123"
	cHash, _ := hashPassword(userC_Pass)
	err = db.QueryRow(`
		INSERT INTO users (org_id, email, password_hash, role, is_active)
		VALUES ($1, $2, $3, 'member', true)
		RETURNING id
	`, orgID, "user-c-"+uuid.New().String()[:8]+"@test.local", cHash).Scan(&userC_ID)
	if err != nil {
		t.Fatalf("failed inserting user C: %v", err)
	}
	userCToken := createTestSession(t, db, userC_ID)

	var mbC_ID string
	cHistWSK := `{"salt":"c_hist_salt","envelope":"c_hist_env","root_wrapped":"c_root"}`
	err = db.QueryRow(`
		INSERT INTO mailboxes (org_id, user_id, domain_id, local_part, mode, is_active, wrapped_sk_user, mailbox_sk_wrapped, previous_wrapped_sk_user)
		VALUES ($1, $2, $3, $4, 'private', true, 'c_active_env', decode('AA==','base64'), $5)
		RETURNING id
	`, orgID, userC_ID, domainID, "mb-c-"+uuid.New().String()[:8], cHistWSK).Scan(&mbC_ID)
	if err != nil {
		t.Fatalf("failed inserting mailbox C: %v", err)
	}

	candC := `{"salt":"cand_c_salt","envelope":"cand_c_env"}`
	recPrepC := callPrepare(userCToken, mbC_ID, map[string]interface{}{"wrapped_sk_user": candC})
	if recPrepC.Code != http.StatusCreated && recPrepC.Code != http.StatusOK {
		t.Fatalf("prepare C failed: %d", recPrepC.Code)
	}
	var prepRespC struct {
		MigrationID string `json:"migration_id"`
	}
	json.NewDecoder(recPrepC.Body).Decode(&prepRespC)

	// Race Goroutine 1 (password change) and Goroutine 2 (finalize)
	var wg sync.WaitGroup
	wg.Add(2)
	var cpCode, finCode int

	newPassC := "new-password-user-c-456"
	newWskC := `{"salt":"c_new_salt","envelope":"c_new_env"}`

	go func() {
		defer wg.Done()
		cpPayloadC := map[string]string{
			"current_password": userC_Pass,
			"new_password":     newPassC,
			"wrapped_sk_user":  newWskC,
			"mailbox_id":       mbC_ID,
		}
		cpBodyC, _ := json.Marshal(cpPayloadC)
		reqCPC := httptest.NewRequest(http.MethodPost, "/v1/auth/change-password", bytes.NewReader(cpBodyC))
		reqCPC.AddCookie(&http.Cookie{Name: "byos_session", Value: userCToken})
		recCPC := httptest.NewRecorder()
		changePasswordHandler(recCPC, reqCPC)
		cpCode = recCPC.Code
	}()

	go func() {
		defer wg.Done()
		recFinC := callFinalize(userCToken, mbC_ID, prepRespC.MigrationID)
		finCode = recFinC.Code
	}()

	wg.Wait()

	// Under canonical lock order (mailbox parent row locked first):
	// Outcome A: Finalize wins lock -> Finalize returns 200, CP returns 204.
	// Outcome B: Password Change wins lock -> CP returns 204, Finalize returns 409 Conflict.
	// In NEITHER case does a deadlock occur, and in NEITHER case is stale candC left as active under newPassC!
	if cpCode != http.StatusNoContent {
		t.Fatalf("expected password change to succeed with 204, got %d", cpCode)
	}
	if finCode != http.StatusOK && finCode != http.StatusConflict {
		t.Fatalf("unexpected finalize race code: got %d, want 200 or 409", finCode)
	}

	// Verify consistent final state in database
	var finalActiveC string
	var finalHistC *string
	err = db.QueryRow(`SELECT wrapped_sk_user, previous_wrapped_sk_user FROM mailboxes WHERE id = $1`, mbC_ID).Scan(&finalActiveC, &finalHistC)
	if err != nil {
		t.Fatalf("failed querying mailbox C final state: %v", err)
	}

	if finCode == http.StatusConflict {
		// Password change won lock first: candidate was rolled back, active envelope is newWskC, historical envelope preserved
		if finalActiveC != newWskC {
			t.Fatalf("expected active envelope to be newWskC, got %q", finalActiveC)
		}
		if finalHistC == nil || *finalHistC != cHistWSK {
			t.Fatalf("expected historical envelope to be preserved as cHistWSK, got %v", finalHistC)
		}
	} else {
		// Finalize won lock first: candidate was promoted, then password change re-wrapped it to newWskC
		if finalActiveC != newWskC {
			t.Fatalf("expected active envelope to be re-wrapped to newWskC, got %q", finalActiveC)
		}
	}
}

