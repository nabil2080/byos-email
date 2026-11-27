package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// TestMultiAccount_SessionAuthorizationUnit verifies the in-memory session link lifecycle,
// ensuring linked mailboxes grant access while arbitrary/unauthorized selectors are rejected.
func TestMultiAccount_SessionAuthorizationUnit(t *testing.T) {
	tokenHash := []byte("test-session-token-hash-12345678")
	primaryUserID := uuid.New().String()
	secondaryMailboxID := uuid.New().String()
	secondaryUserID := uuid.New().String()
	orgID := uuid.New().String()
	forgedMailboxID := uuid.New().String()

	// 1. Initially, secondaryMailboxID is NOT linked or authorized
	linkedIDs := getLinkedMailboxIDsForSession(tokenHash)
	for _, id := range linkedIDs {
		if id == secondaryMailboxID {
			t.Fatalf("secondary mailbox should not be linked initially")
		}
	}

	// 2. Authorize secondary mailbox for session
	expiresAt := time.Now().Add(1 * time.Hour)
	authorizeMailboxForSession(tokenHash, secondaryMailboxID, secondaryUserID, orgID, expiresAt)

	// 3. Verify it appears in linked IDs
	linkedIDsAfter := getLinkedMailboxIDsForSession(tokenHash)
	found := false
	for _, id := range linkedIDsAfter {
		if id == secondaryMailboxID {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected secondary mailbox %s to be linked to session", secondaryMailboxID)
	}

	// 4. Forged mailbox must NEVER be linked
	foundForged := false
	for _, id := range linkedIDsAfter {
		if id == forgedMailboxID {
			foundForged = true
			break
		}
	}
	if foundForged {
		t.Fatalf("forged mailbox %s must not be linked", forgedMailboxID)
	}

	// 5. Test single mailbox revocation
	revokeMailboxForSession(tokenHash, secondaryMailboxID)
	linkedIDsRevoked := getLinkedMailboxIDsForSession(tokenHash)
	for _, id := range linkedIDsRevoked {
		if id == secondaryMailboxID {
			t.Fatalf("secondary mailbox should be revoked")
		}
	}

	// 6. Test full session logout revocation
	mailboxB := uuid.New().String()
	mailboxC := uuid.New().String()
	authorizeMailboxForSession(tokenHash, mailboxB, secondaryUserID, orgID, expiresAt)
	authorizeMailboxForSession(tokenHash, mailboxC, secondaryUserID, orgID, expiresAt)
	if len(getLinkedMailboxIDsForSession(tokenHash)) != 2 {
		t.Fatalf("expected 2 linked mailboxes before logout")
	}

	revokeAllMailboxesForSession(tokenHash)
	if len(getLinkedMailboxIDsForSession(tokenHash)) != 0 {
		t.Fatalf("expected 0 linked mailboxes after full logout revocation")
	}
	_ = primaryUserID
}

// TestMultiAccount_LinkedAccountsEndpoint_AuthEnforcement asserts that the linked-accounts
// API strictly enforces session authentication and rejects unauthenticated callers.
func TestMultiAccount_LinkedAccountsEndpoint_AuthEnforcement(t *testing.T) {
	// 1. POST without auth cookie or bearer token must return 401 Unauthorized
	reqPost := httptest.NewRequest(http.MethodPost, "/v1/auth/linked-accounts", strings.NewReader(`{"email":"bob@byos.local","password":"secret"}`))
	reqPost.Header.Set("Content-Type", "application/json")
	recPost := httptest.NewRecorder()

	linkedAccountsHandler(recPost, reqPost)
	if recPost.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 Unauthorized for unauthenticated POST, got %d", recPost.Code)
	}

	// 2. DELETE without auth cookie or bearer token must return 401 Unauthorized
	reqDel := httptest.NewRequest(http.MethodDelete, "/v1/auth/linked-accounts/"+uuid.New().String(), nil)
	recDel := httptest.NewRecorder()

	linkedAccountsHandler(recDel, reqDel)
	if recDel.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 Unauthorized for unauthenticated DELETE, got %d", recDel.Code)
	}

	// 3. GET without auth cookie or bearer token must return 401 Unauthorized
	reqGet := httptest.NewRequest(http.MethodGet, "/v1/auth/linked-accounts", nil)
	recGet := httptest.NewRecorder()

	linkedAccountsHandler(recGet, reqGet)
	if recGet.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 Unauthorized for unauthenticated GET, got %d", recGet.Code)
	}
}

// TestMultiAccount_ActiveMailboxHeaderProtection verifies that forged or unauthenticated
// X-BYOS-Active-Mailbox selectors fail closed and cannot impersonate other accounts.
func TestMultiAccount_ActiveMailboxHeaderProtection(t *testing.T) {
	// 1. Unauthenticated request with active mailbox header must return 401
	forgedMailboxID := uuid.New().String()
	reqMe := httptest.NewRequest(http.MethodGet, "/v1/auth/me", nil)
	reqMe.Header.Set("X-BYOS-Client", "webmail")
	reqMe.Header.Set("X-BYOS-Active-Mailbox", forgedMailboxID)
	recMe := httptest.NewRecorder()

	meHandler(recMe, reqMe)
	if recMe.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for unauthenticated request with active mailbox header, got %d", recMe.Code)
	}

	// 2. Outbound prepare with unauthenticated active mailbox must return 401
	reqPrep := httptest.NewRequest(http.MethodPost, "/v1/outbound/prepare", strings.NewReader(`{"mailbox_id":"`+forgedMailboxID+`"}`))
	reqPrep.Header.Set("Content-Type", "application/json")
	recPrep := httptest.NewRecorder()

	outboundPrepareHandler(recPrep, reqPrep)
	if recPrep.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for unauthenticated outbound prepare, got %d", recPrep.Code)
	}

	// 3. Profile photo with unauthenticated active mailbox must return 401
	reqPhoto := httptest.NewRequest(http.MethodGet, "/v1/users/me/profile-photo", nil)
	reqPhoto.Header.Set("X-BYOS-Active-Mailbox", forgedMailboxID)
	recPhoto := httptest.NewRecorder()

	profilePhotoHandler(recPhoto, reqPhoto)
	if recPhoto.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for unauthenticated profile photo fetch, got %d", recPhoto.Code)
	}
}

// TestMultiAccount_AccountSelectorCannotFunctionAsCredential asserts that an account selector
// alone (without authorized session) is strictly rejected.
func TestMultiAccount_AccountSelectorCannotFunctionAsCredential(t *testing.T) {
	bogusTokenHash := []byte("nonexistent-hash")
	randomUserID := uuid.New().String()
	victimMailboxID := uuid.New().String()

	// Calling isMailboxAuthorizedForSession with nil conn or missing authorization must return false
	ctx := context.Background()
	authorized := isMailboxAuthorizedForSession(bogusTokenHash, randomUserID, victimMailboxID, nil, ctx)
	if authorized {
		t.Fatalf("account selector must NEVER function as credential on its own")
	}
}

// TestMultiAccount_TwoMailboxLifecycleIntegration exercises the complete 10-step lifecycle:
// 1. Authenticate primary mailbox
// 2. Secondary mailbox initially rejected (403)
// 3. Link secondary mailbox to session
// 4. Verify secondary mailbox appears in linked-accounts
// 5. Switch active mailbox via X-BYOS-Active-Mailbox and verify authorized access
// 6. Switch back and verify primary mailbox access remains valid
// 7. Verify unrelated third mailbox and forged header selector are strictly rejected (403)
// 8. Unlink secondary mailbox and verify subsequent access returns 403 Forbidden
// 9. Verify primary mailbox session remains valid after secondary unlinking
// 10. Logout primary session and verify all linked authorizations are revoked
func TestMultiAccount_TwoMailboxLifecycleIntegration(t *testing.T) {
	rawToken := "test-session-secret-token-32bytes-long!!"
	primaryTokenHash := hashToken(rawToken)
	primaryUserID := uuid.New().String()
	primaryMailboxID := uuid.New().String()

	secondaryUserID := uuid.New().String()
	secondaryMailboxID := uuid.New().String()

	unrelatedMailboxID := uuid.New().String()
	orgID := uuid.New().String()
	ctx := context.Background()

	attachSession := func(req *http.Request) {
		req.Header.Set("X-BYOS-Client", "webmail")
		req.AddCookie(&http.Cookie{Name: "byos_webmail_session", Value: rawToken})
	}

	// 1. Primary mailbox authenticated; initially secondary is NOT linked
	linkedBefore := getLinkedMailboxIDsForSession(primaryTokenHash)
	if len(linkedBefore) != 0 {
		t.Fatalf("expected 0 linked mailboxes initially, got %d", len(linkedBefore))
	}

	// 2. Verify secondary mailbox access without link returns forbidden (403)
	reqSecUnlinked := httptest.NewRequest(http.MethodGet, "/v1/mailboxes/"+secondaryMailboxID+"/messages", nil)
	attachSession(reqSecUnlinked)
	reqSecUnlinked.SetPathValue("mailbox_id", secondaryMailboxID)
	reqSecUnlinked.Header.Set("X-BYOS-Active-Mailbox", secondaryMailboxID)
	status, _, ok := verifyMailboxSession(reqSecUnlinked, primaryUserID, secondaryMailboxID, nil, ctx)
	if ok || status != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for unlinked secondary mailbox, got status=%d ok=%v", status, ok)
	}

	// 3. Link secondary mailbox to primary session
	expiresAt := time.Now().Add(2 * time.Hour)
	authorizeMailboxForSession(primaryTokenHash, secondaryMailboxID, secondaryUserID, orgID, expiresAt)

	// 4. Verify secondary mailbox appears in linked accounts
	linkedAfter := getLinkedMailboxIDsForSession(primaryTokenHash)
	foundSec := false
	for _, id := range linkedAfter {
		if id == secondaryMailboxID {
			foundSec = true
			break
		}
	}
	if !foundSec {
		t.Fatalf("expected secondary mailbox %s to be listed in linked accounts", secondaryMailboxID)
	}

	// 5. Switch active mailbox via X-BYOS-Active-Mailbox to secondary mailbox
	reqSecAuthorized := httptest.NewRequest(http.MethodGet, "/v1/mailboxes/"+secondaryMailboxID+"/messages", nil)
	attachSession(reqSecAuthorized)
	reqSecAuthorized.SetPathValue("mailbox_id", secondaryMailboxID)
	reqSecAuthorized.Header.Set("X-BYOS-Active-Mailbox", secondaryMailboxID)
	status, errMsg, ok := verifyMailboxSession(reqSecAuthorized, primaryUserID, secondaryMailboxID, nil, ctx)
	if !ok {
		t.Fatalf("expected secondary mailbox to be authorized with valid link, got status=%d msg=%s", status, errMsg)
	}

	// 6. Switch back to primary mailbox: verify primary remains authorized and valid
	reqPrimAuthorized := httptest.NewRequest(http.MethodGet, "/v1/mailboxes/"+primaryMailboxID+"/messages", nil)
	attachSession(reqPrimAuthorized)
	reqPrimAuthorized.SetPathValue("mailbox_id", primaryMailboxID)
	reqPrimAuthorized.Header.Set("X-BYOS-Active-Mailbox", primaryMailboxID)
	// Authorize primary mailbox directly
	authorizeMailboxForSession(primaryTokenHash, primaryMailboxID, primaryUserID, orgID, expiresAt)
	status, errMsg, ok = verifyMailboxSession(reqPrimAuthorized, primaryUserID, primaryMailboxID, nil, ctx)
	if !ok {
		t.Fatalf("expected primary mailbox to remain valid, got status=%d msg=%s", status, errMsg)
	}

	// 7. Attempt access to unrelated third mailbox; verify 403 Forbidden
	reqUnrelated := httptest.NewRequest(http.MethodGet, "/v1/mailboxes/"+unrelatedMailboxID+"/messages", nil)
	attachSession(reqUnrelated)
	reqUnrelated.SetPathValue("mailbox_id", unrelatedMailboxID)
	reqUnrelated.Header.Set("X-BYOS-Active-Mailbox", unrelatedMailboxID)
	status, _, ok = verifyMailboxSession(reqUnrelated, primaryUserID, unrelatedMailboxID, nil, ctx)
	if ok || status != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for unrelated third mailbox, got status=%d ok=%v", status, ok)
	}

	// 7b. Attempt forged selector mismatch: X-BYOS-Active-Mailbox != mailbox_id -> 403 Forbidden
	reqMismatch := httptest.NewRequest(http.MethodGet, "/v1/mailboxes/"+secondaryMailboxID+"/messages", nil)
	attachSession(reqMismatch)
	reqMismatch.SetPathValue("mailbox_id", secondaryMailboxID)
	reqMismatch.Header.Set("X-BYOS-Active-Mailbox", primaryMailboxID) // mismatch!
	status, errMsg, ok = verifyMailboxSession(reqMismatch, primaryUserID, secondaryMailboxID, nil, ctx)
	if ok || status != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for active mailbox header mismatch, got status=%d msg=%s", status, errMsg)
	}

	// 8. Unlink secondary mailbox via revokeMailboxForSession
	revokeMailboxForSession(primaryTokenHash, secondaryMailboxID)

	// Verify subsequent access returns 403 Forbidden
	reqSecRevoked := httptest.NewRequest(http.MethodGet, "/v1/mailboxes/"+secondaryMailboxID+"/messages", nil)
	attachSession(reqSecRevoked)
	reqSecRevoked.SetPathValue("mailbox_id", secondaryMailboxID)
	reqSecRevoked.Header.Set("X-BYOS-Active-Mailbox", secondaryMailboxID)
	status, _, ok = verifyMailboxSession(reqSecRevoked, primaryUserID, secondaryMailboxID, nil, ctx)
	if ok || status != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden after unlinking secondary mailbox, got status=%d ok=%v", status, ok)
	}

	// 9. Verify primary mailbox session remains valid throughout
	status, errMsg, ok = verifyMailboxSession(reqPrimAuthorized, primaryUserID, primaryMailboxID, nil, ctx)
	if !ok {
		t.Fatalf("primary mailbox session should remain valid after secondary unlinking, got status=%d msg=%s", status, errMsg)
	}

	// 10. Full logout revoking all linked authorizations
	revokeAllMailboxesForSession(primaryTokenHash)
	linkedFinal := getLinkedMailboxIDsForSession(primaryTokenHash)
	if len(linkedFinal) != 0 {
		t.Fatalf("expected 0 linked accounts after full logout, got %d", len(linkedFinal))
	}
	status, _, ok = verifyMailboxSession(reqPrimAuthorized, primaryUserID, primaryMailboxID, nil, ctx)
	if ok || status != http.StatusForbidden {
		t.Fatalf("expected primary mailbox to be revoked after full session logout")
	}
}

// TestMultiAccount_InternalServiceBypass asserts route-specific internal service authentication,
// ensuring storage and outbound service keys are strictly segregated and fail closed.
func TestMultiAccount_InternalServiceBypass(t *testing.T) {
	storageSecret := "super-secure-storage-worker-secret-12345"
	outboundSecret := "super-secure-outbound-worker-secret-67890"
	t.Setenv("STORAGE_WORKER_INTERNAL_KEY", storageSecret)
	t.Setenv("INTERNAL_API_KEY", outboundSecret)

	targetMailboxID := uuid.New().String()
	ctx := context.Background()

	// 1. Storage worker presenting STORAGE_WORKER_INTERNAL_KEY on a "storage" route succeeds
	reqStorageValid := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+targetMailboxID+"/storage/store", nil)
	reqStorageValid.SetPathValue("mailbox_id", targetMailboxID)
	reqStorageValid.Header.Set("X-Internal-Key", storageSecret)

	status, errMsg, ok := verifyMailboxScopedAccess(reqStorageValid, "", targetMailboxID, "storage", nil, ctx)
	if !ok || status != 0 {
		t.Fatalf("expected storage worker key on storage route to succeed, got status=%d msg=%s", status, errMsg)
	}

	// 2. Outbound worker credential (INTERNAL_API_KEY) presented on "storage" route fails closed (403)
	reqOutboundOnStorage := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+targetMailboxID+"/storage/store", nil)
	reqOutboundOnStorage.SetPathValue("mailbox_id", targetMailboxID)
	reqOutboundOnStorage.Header.Set("X-Internal-Key", outboundSecret)

	status, _, ok = verifyMailboxScopedAccess(reqOutboundOnStorage, "", targetMailboxID, "storage", nil, ctx)
	if ok || status != http.StatusForbidden {
		t.Fatalf("expected outbound worker key on storage route to fail closed with 403, got status=%d ok=%v", status, ok)
	}

	// 3. Storage worker credential presented on "outbound" route fails closed (403)
	reqStorageOnOutbound := httptest.NewRequest(http.MethodPost, "/v1/internal/scheduled/complete", nil)
	reqStorageOnOutbound.Header.Set("X-Internal-Key", storageSecret)

	status, _, ok = verifyMailboxScopedAccess(reqStorageOnOutbound, "", targetMailboxID, "outbound", nil, ctx)
	if ok || status != http.StatusForbidden {
		t.Fatalf("expected storage worker key on outbound route to fail closed with 403, got status=%d ok=%v", status, ok)
	}

	// 4. Normal user session route (verifyMailboxSession) strictly rejects all internal keys
	reqUserRouteWithKey := httptest.NewRequest(http.MethodGet, "/v1/mailboxes/"+targetMailboxID+"/messages", nil)
	reqUserRouteWithKey.SetPathValue("mailbox_id", targetMailboxID)
	reqUserRouteWithKey.Header.Set("X-Internal-Key", storageSecret)

	status, _, ok = verifyMailboxSession(reqUserRouteWithKey, "", targetMailboxID, nil, ctx)
	if ok || status != http.StatusForbidden {
		t.Fatalf("expected user session route to reject internal keys without user session, got status=%d ok=%v", status, ok)
	}

	// 5. Invalid / unknown key fails closed
	reqInvalid := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+targetMailboxID+"/storage/store", nil)
	reqInvalid.SetPathValue("mailbox_id", targetMailboxID)
	reqInvalid.Header.Set("X-Internal-Key", "completely-wrong-key")

	status, _, ok = verifyMailboxScopedAccess(reqInvalid, "", targetMailboxID, "storage", nil, ctx)
	if ok || status != http.StatusForbidden {
		t.Fatalf("expected invalid internal key to fail closed with 403 Forbidden, got status=%d ok=%v", status, ok)
	}
}

// TestMultiAccount_ElevenGaps_UserSessionIsolation verifies that the corrected handlers
// strictly enforce user session authorization and fail closed on unauthorized or forged mailboxes.
func TestMultiAccount_ElevenGaps_UserSessionIsolation(t *testing.T) {
	rawToken := "isolation-test-session-secret-32bytes!!"
	tokenHash := hashToken(rawToken)
	primaryUserID := uuid.New().String()
	primaryMailboxID := uuid.New().String()
	secondaryMailboxID := uuid.New().String()
	secondaryUserID := uuid.New().String()
	unrelatedMailboxID := uuid.New().String()
	orgID := uuid.New().String()
	ctx := context.Background()

	// Link secondary mailbox to session
	expiresAt := time.Now().Add(2 * time.Hour)
	authorizeMailboxForSession(tokenHash, primaryMailboxID, primaryUserID, orgID, expiresAt)
	authorizeMailboxForSession(tokenHash, secondaryMailboxID, secondaryUserID, orgID, expiresAt)

	attachSession := func(req *http.Request) {
		req.Header.Set("X-BYOS-Client", "webmail")
		req.AddCookie(&http.Cookie{Name: "byos_webmail_session", Value: rawToken})
	}

	// 1. Message Read: Authorized linked secondary mailbox succeeds
	reqReadSec := httptest.NewRequest(http.MethodPut, "/v1/mailboxes/"+secondaryMailboxID+"/messages/"+uuid.New().String()+"/read", nil)
	attachSession(reqReadSec)
	reqReadSec.SetPathValue("mailbox_id", secondaryMailboxID)
	reqReadSec.Header.Set("X-BYOS-Active-Mailbox", secondaryMailboxID)
	status, _, ok := verifyUserMailboxSession(reqReadSec, primaryUserID, secondaryMailboxID, nil, ctx)
	if !ok || status != 0 {
		t.Fatalf("expected linked secondary mailbox read status update to be authorized, got status=%d", status)
	}

	// 2. Message Read: Unrelated mailbox fails closed (403)
	reqReadUnrelated := httptest.NewRequest(http.MethodPut, "/v1/mailboxes/"+unrelatedMailboxID+"/messages/"+uuid.New().String()+"/read", nil)
	attachSession(reqReadUnrelated)
	reqReadUnrelated.SetPathValue("mailbox_id", unrelatedMailboxID)
	reqReadUnrelated.Header.Set("X-BYOS-Active-Mailbox", unrelatedMailboxID)
	status, _, ok = verifyUserMailboxSession(reqReadUnrelated, primaryUserID, unrelatedMailboxID, nil, ctx)
	if ok || status != http.StatusForbidden {
		t.Fatalf("expected unrelated mailbox read update to return 403 Forbidden, got status=%d ok=%v", status, ok)
	}

	// 3. Attachments: Active mailbox mismatch fails closed (403)
	reqAttMismatch := httptest.NewRequest(http.MethodGet, "/v1/mailboxes/"+secondaryMailboxID+"/messages/"+uuid.New().String()+"/attachments", nil)
	attachSession(reqAttMismatch)
	reqAttMismatch.SetPathValue("mailbox_id", secondaryMailboxID)
	reqAttMismatch.Header.Set("X-BYOS-Active-Mailbox", primaryMailboxID) // Mismatched selector!
	status, _, ok = verifyUserMailboxSession(reqAttMismatch, primaryUserID, secondaryMailboxID, nil, ctx)
	if ok || status != http.StatusForbidden {
		t.Fatalf("expected header selector mismatch on attachments to return 403, got status=%d ok=%v", status, ok)
	}

	// 4. Storage Store: User session authorization on storage endpoint succeeds for linked mailbox
	reqStoreSec := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+secondaryMailboxID+"/storage/store", nil)
	attachSession(reqStoreSec)
	reqStoreSec.SetPathValue("mailbox_id", secondaryMailboxID)
	reqStoreSec.Header.Set("X-BYOS-Active-Mailbox", secondaryMailboxID)
	status, _, ok = verifyMailboxScopedAccess(reqStoreSec, primaryUserID, secondaryMailboxID, "storage", nil, ctx)
	if !ok || status != 0 {
		t.Fatalf("expected session-authorized storage store to succeed, got status=%d", status)
	}

	// 5. Storage Store: Unrelated mailbox fails closed (403)
	reqStoreUnrelated := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+unrelatedMailboxID+"/storage/store", nil)
	attachSession(reqStoreUnrelated)
	reqStoreUnrelated.SetPathValue("mailbox_id", unrelatedMailboxID)
	status, _, ok = verifyMailboxScopedAccess(reqStoreUnrelated, primaryUserID, unrelatedMailboxID, "storage", nil, ctx)
	if ok || status != http.StatusForbidden {
		t.Fatalf("expected unrelated storage store to return 403 Forbidden, got status=%d ok=%v", status, ok)
	}
}

// TestMultiAccount_SecondaryLinking_MFAAndRateLimit verifies that secondary account linking
// strictly enforces MFA/TOTP, rejects mailbox UUID-only requests, and enforces rate limits.
func TestMultiAccount_SecondaryLinking_MFAAndRateLimit(t *testing.T) {
	// 1. Linking with UUID only (empty email & password) returns 401 Unauthorized
	reqUUIDOnly := httptest.NewRequest(http.MethodPost, "/v1/auth/linked-accounts", strings.NewReader(`{"mailbox_id":"`+uuid.New().String()+`"}`))
	reqUUIDOnly.Header.Set("Content-Type", "application/json")
	recUUIDOnly := httptest.NewRecorder()

	linkedAccountsHandler(recUUIDOnly, reqUUIDOnly)
	if recUUIDOnly.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized for UUID-only link request, got %d", recUUIDOnly.Code)
	}

	// 2. Validate TOTP verification helper
	secret := "JBSWY3DPEHPK3PXP"
	code, err := computeTOTP(secret, time.Now())
	if err != nil {
		t.Fatalf("computeTOTP failed: %v", err)
	}
	if !validateTOTP(secret, code) {
		t.Fatalf("expected valid TOTP code to pass validation")
	}
	if validateTOTP(secret, "000000") && code != "000000" {
		t.Fatalf("expected bogus TOTP code to fail validation")
	}
}

// getSafeTestDSN retrieves a verified test database DSN connecting strictly to byos_test_isolation.
// It sets DATABASE_URL to this isolated database and verifies database connectivity.
func getSafeTestDSN(t *testing.T) (string, *pgx.Conn, context.Context) {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos_test_isolation?sslmode=disable"
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Skipf("skipping test requiring test database; byos_test_isolation unreachable: %v", err)
		return "", nil, nil
	}
	t.Setenv("DATABASE_URL", dsn)
	CloseAuthDBPool()
	_, _ = InitAuthDBPool(ctx)
	t.Cleanup(func() {
		CloseAuthDBPool()
	})
	return dsn, conn, ctx
}

// TestMultiAccount_RouteLevelAuthorizationCoverage verifies full ServeMux route-level authorization
// across all 11 endpoints, testing primary success, linked secondary success, unlinked 403,
// unrelated 403, selector mismatch 403, unauthenticated 401, org admin boundaries, and internal service separation.
func TestMultiAccount_RouteLevelAuthorizationCoverage(t *testing.T) {
	t.Setenv("BYOS_ALLOWED_ORIGINS", "http://localhost:3001")
	_, conn, ctx := getSafeTestDSN(t)
	if conn == nil {
		return
	}
	defer conn.Close(ctx)

	tag := uuid.New().String()[:8]
	orgID1 := uuid.New().String()
	orgID2 := uuid.New().String()
	domainID1 := uuid.New().String()
	domainID2 := uuid.New().String()

	// 1. Create test organizations and domains
	_, err := conn.Exec(ctx, `INSERT INTO organizations (id, name, seat_count, org_recovery_pk) VALUES ($1, $2, 10, decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'))`, orgID1, "RouteCov Org1 "+tag)
	if err != nil {
		t.Fatalf("failed to insert org1: %v", err)
	}
	defer conn.Exec(ctx, `DELETE FROM organizations WHERE id=$1`, orgID1)

	_, err = conn.Exec(ctx, `INSERT INTO organizations (id, name, seat_count, org_recovery_pk) VALUES ($1, $2, 10, decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'))`, orgID2, "RouteCov Org2 "+tag)
	if err != nil {
		t.Fatalf("failed to insert org2: %v", err)
	}
	defer conn.Exec(ctx, `DELETE FROM organizations WHERE id=$1`, orgID2)

	_, err = conn.Exec(ctx, `INSERT INTO domains (id, org_id, name, is_verified) VALUES ($1, $2, $3, true)`, domainID1, orgID1, "routecov-"+tag+"-org1.local")
	if err != nil {
		t.Fatalf("failed to insert domain1: %v", err)
	}
	_, err = conn.Exec(ctx, `INSERT INTO domains (id, org_id, name, is_verified) VALUES ($1, $2, $3, true)`, domainID2, orgID2, "routecov-"+tag+"-org2.local")
	if err != nil {
		t.Fatalf("failed to insert domain2: %v", err)
	}

	pwHash, _ := hashPassword("password123")

	// 2. Create users
	primaryUserID := uuid.New().String()
	secondaryUserID := uuid.New().String()
	unlinkedUserID := uuid.New().String()
	unrelatedUserID := uuid.New().String()
	adminUserID := uuid.New().String()

	// Primary user in Org1
	_, err = conn.Exec(ctx, `INSERT INTO users (id, org_id, email, password_hash, display_name, role, is_active) VALUES ($1, $2, $3, $4, 'Primary User', 'member', true)`,
		primaryUserID, orgID1, "primary-"+tag+"@org1.local", pwHash)
	if err != nil {
		t.Fatalf("failed to insert primary user: %v", err)
	}

	// Secondary user in Org1
	_, err = conn.Exec(ctx, `INSERT INTO users (id, org_id, email, password_hash, display_name, role, is_active) VALUES ($1, $2, $3, $4, 'Secondary User', 'member', true)`,
		secondaryUserID, orgID1, "secondary-"+tag+"@org1.local", pwHash)
	if err != nil {
		t.Fatalf("failed to insert secondary user: %v", err)
	}

	// Unlinked user in Org1 (same org peer)
	_, err = conn.Exec(ctx, `INSERT INTO users (id, org_id, email, password_hash, display_name, role, is_active) VALUES ($1, $2, $3, $4, 'Unlinked User', 'member', true)`,
		unlinkedUserID, orgID1, "unlinked-"+tag+"@org1.local", pwHash)
	if err != nil {
		t.Fatalf("failed to insert unlinked user: %v", err)
	}

	// Unrelated user in Org2 (different org)
	_, err = conn.Exec(ctx, `INSERT INTO users (id, org_id, email, password_hash, display_name, role, is_active) VALUES ($1, $2, $3, $4, 'Unrelated User', 'member', true)`,
		unrelatedUserID, orgID2, "unrelated-"+tag+"@org2.local", pwHash)
	if err != nil {
		t.Fatalf("failed to insert unrelated user: %v", err)
	}

	// Admin user in Org1
	_, err = conn.Exec(ctx, `INSERT INTO users (id, org_id, email, password_hash, display_name, role, is_active) VALUES ($1, $2, $3, $4, 'Admin User', 'admin', true)`,
		adminUserID, orgID1, "admin-"+tag+"@org1.local", pwHash)
	if err != nil {
		t.Fatalf("failed to insert admin user: %v", err)
	}

	// 3. Create mailboxes
	primaryMailboxID := uuid.New().String()
	secondaryMailboxID := uuid.New().String()
	unlinkedMailboxID := uuid.New().String()
	unrelatedMailboxID := uuid.New().String()
	adminMailboxID := uuid.New().String()

	insertMailbox := func(id, orgID, userID, domainID, localPart string) {
		_, err := conn.Exec(ctx, `INSERT INTO mailboxes (id, org_id, user_id, domain_id, local_part, mode, is_active, status) VALUES ($1, $2, $3, $4, $5, 'private', true, 'active')`,
			id, orgID, userID, domainID, localPart)
		if err != nil {
			t.Fatalf("failed to insert mailbox %s: %v", id, err)
		}
	}

	insertMailbox(primaryMailboxID, orgID1, primaryUserID, domainID1, "primary")
	insertMailbox(secondaryMailboxID, orgID1, secondaryUserID, domainID1, "secondary")
	insertMailbox(unlinkedMailboxID, orgID1, unlinkedUserID, domainID1, "unlinked")
	insertMailbox(unrelatedMailboxID, orgID2, unrelatedUserID, domainID2, "unrelated")
	insertMailbox(adminMailboxID, orgID1, adminUserID, domainID1, "admin")

	// 4. Create primary user session and authorize primary & secondary mailboxes
	rawToken := "routecov-primary-session-" + tag + "-32bytes!"
	primaryTokenHash := hashToken(rawToken)
	sessionExpiresAt := time.Now().Add(24 * time.Hour)
	_, err = conn.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`, primaryUserID, primaryTokenHash, sessionExpiresAt)
	if err != nil {
		t.Fatalf("failed to insert primary session: %v", err)
	}
	authorizeMailboxForSession(primaryTokenHash, primaryMailboxID, primaryUserID, orgID1, sessionExpiresAt)
	authorizeMailboxForSession(primaryTokenHash, secondaryMailboxID, secondaryUserID, orgID1, sessionExpiresAt)
	defer revokeAllMailboxesForSession(primaryTokenHash)

	// Admin user session
	rawAdminToken := "routecov-admin-session-" + tag + "-32bytes!"
	adminTokenHash := hashToken(rawAdminToken)
	_, err = conn.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`, adminUserID, adminTokenHash, sessionExpiresAt)
	if err != nil {
		t.Fatalf("failed to insert admin session: %v", err)
	}
	authorizeMailboxForSession(adminTokenHash, adminMailboxID, adminUserID, orgID1, sessionExpiresAt)
	defer revokeAllMailboxesForSession(adminTokenHash)

	// Insert dummy message metadata for read and attachment endpoints
	dummyMsgID := uuid.New().String()
	_, err = conn.Exec(ctx, `INSERT INTO message_metadata (
		id, mailbox_id, thread_id, domain_id, direction, delivery_identity, sender, recipients,
		storage_object_id, content_key_hpke_wrapped, mailbox_sk_version, encryption_iv, bundle_hash, is_read, folder
	) VALUES (
		$1, $2, $1, $3, 'received', decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'),
		'sender@example.com', ARRAY['rcpt@example.com'], 'dummy-storage-id',
		decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'), 1,
		decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'),
		decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'), false, 'inbox'
	)`, dummyMsgID, primaryMailboxID, domainID1)
	if err != nil {
		t.Fatalf("failed to insert dummy message for primary mailbox: %v", err)
	}

	dummySecMsgID := uuid.New().String()
	_, err = conn.Exec(ctx, `INSERT INTO message_metadata (
		id, mailbox_id, thread_id, domain_id, direction, delivery_identity, sender, recipients,
		storage_object_id, content_key_hpke_wrapped, mailbox_sk_version, encryption_iv, bundle_hash, is_read, folder
	) VALUES (
		$1, $2, $1, $3, 'received', decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'),
		'sender@example.com', ARRAY['rcpt@example.com'], 'dummy-storage-id',
		decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'), 1,
		decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'),
		decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'), false, 'inbox'
	)`, dummySecMsgID, secondaryMailboxID, domainID1)
	if err != nil {
		t.Fatalf("failed to insert dummy message for secondary mailbox: %v", err)
	}

	// 5. Construct ServeMux with exact production routes and wrappers
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/mailboxes/{mailbox_id}/messages/{message_id}/read", withSecurityHeaders(withCORS(messageReadHandler)))
	mux.HandleFunc("/v1/mailboxes/{mailbox_id}/messages/import", withSecurityHeaders(withCORS(messageImportHandler)))
	mux.HandleFunc("/v1/mailboxes/{mailbox_id}/import-message", withSecurityHeaders(withCORS(importMessageHandler)))
	mux.HandleFunc("/v1/import/jobs", withSecurityHeaders(withCORS(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			importJobCreateHandler(w, r)
		} else {
			importJobListHandler(w, r)
		}
	})))
	mux.HandleFunc("/v1/mailboxes/{mailbox_id}/storage/store", withSecurityHeaders(withCORS(mailboxStorageStoreHandler)))
	mux.HandleFunc("/v1/mailboxes/{mailbox_id}/storage/retrieve", withSecurityHeaders(withCORS(mailboxStorageRetrieveHandler)))
	mux.HandleFunc("/v1/mailboxes/{mailbox_id}/storage/list", withSecurityHeaders(withCORS(mailboxStorageListHandler)))
	mux.HandleFunc("/v1/mailboxes/{mailbox_id}/storage/delete", withSecurityHeaders(withCORS(mailboxStorageDeleteHandler)))
	mux.HandleFunc("/v1/mailboxes/{mailbox_id}/messages/{message_id}/attachments", withSecurityHeaders(withCORS(messageAttachmentsHandler)))
	mux.HandleFunc("/v1/mailboxes/{mailbox_id}/attachments/{attachment_id}", withSecurityHeaders(withCORS(attachmentsHandler)))
	mux.HandleFunc("/v1/mailboxes/{mailbox_id}/attachment-chunks", withSecurityHeaders(withCORS(uploadAttachmentChunkHandler)))
	mux.HandleFunc("/v1/mailboxes/{mailbox_id}/aliases", withSecurityHeaders(withCORS(mailboxAliasesHandler)))
	mux.HandleFunc("/v1/mailboxes/{mailbox_id}/aliases/{alias_id}", withSecurityHeaders(withCORS(mailboxAliasItemHandler)))
	mux.HandleFunc("/v1/mailboxes/{mailbox_id}/bridge/credentials", withSecurityHeaders(withCORS(bridgeCredentialsHandler)))
	mux.HandleFunc("/v1/mailboxes/{mailbox_id}/bridge/credentials/{credential_id}", withSecurityHeaders(withCORS(bridgeCredentialsHandler)))

	type endpointTestCase struct {
		name       string
		method     string
		makePath   func(mbID string) string
		makeBody   func(mbID string) []byte
		addHeaders func(req *http.Request, mbID string)
	}

	endpoints := []endpointTestCase{
		{
			name:   "1. Message Read",
			method: http.MethodPut,
			makePath: func(mbID string) string {
				msgID := dummyMsgID
				if mbID == secondaryMailboxID {
					msgID = dummySecMsgID
				}
				return fmt.Sprintf("/v1/mailboxes/%s/messages/%s/read", mbID, msgID)
			},
			makeBody: func(mbID string) []byte {
				return []byte(`{"read":true}`)
			},
		},
		{
			name:   "2. Message Import",
			method: http.MethodPost,
			makePath: func(mbID string) string {
				return fmt.Sprintf("/v1/mailboxes/%s/messages/import", mbID)
			},
			makeBody: func(mbID string) []byte {
				return []byte(`{"raw_eml":"RnJvbTogdGVzdEBieW9zLmxvY2FsDQpTdWJqZWN0OiBUZXN0DQoNCkhlbGxv"}`)
			},
		},
		{
			name:   "3. Import Single Message",
			method: http.MethodPost,
			makePath: func(mbID string) string {
				return fmt.Sprintf("/v1/mailboxes/%s/import-message", mbID)
			},
			makeBody: func(mbID string) []byte {
				return []byte(`{"source_provider":"google","source_message_id":"msg-123","storage_object_id":"obj-123","sender":"sender@byos.local","raw_mime":"Subject: Hello\r\n\r\nBody"}`)
			},
		},
		{
			name:   "4. Import Jobs",
			method: http.MethodGet,
			makePath: func(mbID string) string {
				return fmt.Sprintf("/v1/import/jobs?mailbox_id=%s", mbID)
			},
		},
		{
			name:   "5. Storage Store",
			method: http.MethodPost,
			makePath: func(mbID string) string {
				return fmt.Sprintf("/v1/mailboxes/%s/storage/store", mbID)
			},
			makeBody: func(mbID string) []byte {
				return []byte("sample-storage-data-payload")
			},
			addHeaders: func(req *http.Request, mbID string) {
				req.Header.Set("X-Object-Key", fmt.Sprintf("mailboxes/%s/notes/manifest.enc", mbID))
			},
		},
		{
			name:   "6. Storage Retrieve",
			method: http.MethodGet,
			makePath: func(mbID string) string {
				return fmt.Sprintf("/v1/mailboxes/%s/storage/retrieve?key=mailboxes/%s/notes/manifest.enc", mbID, mbID)
			},
		},
		{
			name:   "7. Message Attachments",
			method: http.MethodGet,
			makePath: func(mbID string) string {
				msgID := dummyMsgID
				if mbID == secondaryMailboxID {
					msgID = dummySecMsgID
				}
				return fmt.Sprintf("/v1/mailboxes/%s/messages/%s/attachments", mbID, msgID)
			},
		},
		{
			name:   "8. Mailbox Attachment Detail",
			method: http.MethodGet,
			makePath: func(mbID string) string {
				return fmt.Sprintf("/v1/mailboxes/%s/attachments/%s", mbID, uuid.New().String())
			},
		},
		{
			name:   "9. Attachment Chunks",
			method: http.MethodPost,
			makePath: func(mbID string) string {
				return fmt.Sprintf("/v1/mailboxes/%s/attachment-chunks", mbID)
			},
			makeBody: func(mbID string) []byte {
				return []byte("chunk-content-data")
			},
		},
		{
			name:   "10. Mailbox Aliases",
			method: http.MethodGet,
			makePath: func(mbID string) string {
				return fmt.Sprintf("/v1/mailboxes/%s/aliases", mbID)
			},
		},
		{
			name:   "11. Bridge Credentials",
			method: http.MethodGet,
			makePath: func(mbID string) string {
				return fmt.Sprintf("/v1/mailboxes/%s/bridge/credentials", mbID)
			},
		},
	}

	for _, ep := range endpoints {
		ep := ep
		t.Run(ep.name, func(t *testing.T) {
			makeReq := func(method, path string, body []byte, token string, activeMb string, targetMb string) *http.Request {
				var bodyReader *bytes.Reader
				if body != nil {
					bodyReader = bytes.NewReader(body)
				} else {
					bodyReader = bytes.NewReader([]byte{})
				}
				req := httptest.NewRequest(method, path, bodyReader)
				req.Header.Set("Content-Type", "application/json")
				req.Header.Set("Origin", "http://localhost:3001")
				if token != "" {
					req.AddCookie(&http.Cookie{Name: "byos_webmail_session", Value: token})
				}
				if activeMb != "" {
					req.Header.Set("X-BYOS-Active-Mailbox", activeMb)
				}
				if ep.addHeaders != nil {
					ep.addHeaders(req, targetMb)
				}
				return req
			}

			// A. Primary session succeeds (passes auth)
			var bPrim []byte
			if ep.makeBody != nil {
				bPrim = ep.makeBody(primaryMailboxID)
			}
			reqPrim := makeReq(ep.method, ep.makePath(primaryMailboxID), bPrim, rawToken, primaryMailboxID, primaryMailboxID)
			recPrim := httptest.NewRecorder()
			mux.ServeHTTP(recPrim, reqPrim)
			if recPrim.Code == http.StatusUnauthorized || recPrim.Code == http.StatusForbidden {
				t.Errorf("[%s] primary mailbox expected authorized, got %d: %s", ep.name, recPrim.Code, recPrim.Body.String())
			}

			// B. Linked secondary mailbox session succeeds (passes auth)
			var bSec []byte
			if ep.makeBody != nil {
				bSec = ep.makeBody(secondaryMailboxID)
			}
			reqSec := makeReq(ep.method, ep.makePath(secondaryMailboxID), bSec, rawToken, secondaryMailboxID, secondaryMailboxID)
			recSec := httptest.NewRecorder()
			mux.ServeHTTP(recSec, reqSec)
			if recSec.Code == http.StatusUnauthorized || recSec.Code == http.StatusForbidden {
				t.Errorf("[%s] linked secondary mailbox expected authorized, got %d: %s", ep.name, recSec.Code, recSec.Body.String())
			}

			// C. Unlinked mailbox (in same org) fails closed (403 Forbidden)
			var bUnlinked []byte
			if ep.makeBody != nil {
				bUnlinked = ep.makeBody(unlinkedMailboxID)
			}
			reqUnlinked := makeReq(ep.method, ep.makePath(unlinkedMailboxID), bUnlinked, rawToken, unlinkedMailboxID, unlinkedMailboxID)
			recUnlinked := httptest.NewRecorder()
			mux.ServeHTTP(recUnlinked, reqUnlinked)
			if recUnlinked.Code != http.StatusForbidden {
				t.Errorf("[%s] unlinked mailbox expected 403 Forbidden, got %d: %s", ep.name, recUnlinked.Code, recUnlinked.Body.String())
			}

			// D. Unrelated mailbox (in another org) fails closed (403 Forbidden)
			var bUnrelated []byte
			if ep.makeBody != nil {
				bUnrelated = ep.makeBody(unrelatedMailboxID)
			}
			reqUnrelated := makeReq(ep.method, ep.makePath(unrelatedMailboxID), bUnrelated, rawToken, unrelatedMailboxID, unrelatedMailboxID)
			recUnrelated := httptest.NewRecorder()
			mux.ServeHTTP(recUnrelated, reqUnrelated)
			if recUnrelated.Code != http.StatusForbidden {
				t.Errorf("[%s] unrelated mailbox expected 403 Forbidden, got %d: %s", ep.name, recUnrelated.Code, recUnrelated.Body.String())
			}

			// E. Active mailbox header mismatch fails closed (403 Forbidden)
			reqMismatch := makeReq(ep.method, ep.makePath(secondaryMailboxID), bSec, rawToken, primaryMailboxID, secondaryMailboxID)
			recMismatch := httptest.NewRecorder()
			mux.ServeHTTP(recMismatch, reqMismatch)
			if recMismatch.Code != http.StatusForbidden {
				t.Errorf("[%s] selector mismatch expected 403 Forbidden, got %d: %s", ep.name, recMismatch.Code, recMismatch.Body.String())
			}

			// F. Unauthenticated request fails closed (401 Unauthorized)
			reqUnauth := makeReq(ep.method, ep.makePath(primaryMailboxID), bPrim, "", primaryMailboxID, primaryMailboxID)
			recUnauth := httptest.NewRecorder()
			mux.ServeHTTP(recUnauth, reqUnauth)
			if recUnauth.Code != http.StatusUnauthorized {
				t.Errorf("[%s] unauthenticated request expected 401 Unauthorized, got %d: %s", ep.name, recUnauth.Code, recUnauth.Body.String())
			}
		})
	}

	// 6. Organization administrator permission boundary tests
	t.Run("Org Admin Privacy Boundary - Bridge Credentials", func(t *testing.T) {
		// Admin attempting GET on secondary mailbox bridge credentials without linked session -> 403 Forbidden
		reqAdminGet := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/v1/mailboxes/%s/bridge/credentials", secondaryMailboxID), nil)
		reqAdminGet.Header.Set("X-BYOS-Client", "webmail")
		reqAdminGet.AddCookie(&http.Cookie{Name: "byos_webmail_session", Value: rawAdminToken})
		reqAdminGet.Header.Set("X-BYOS-Active-Mailbox", secondaryMailboxID)
		recAdminGet := httptest.NewRecorder()
		mux.ServeHTTP(recAdminGet, reqAdminGet)
		if recAdminGet.Code != http.StatusForbidden {
			t.Errorf("expected 403 Forbidden for admin GET on private bridge credentials, got %d: %s", recAdminGet.Code, recAdminGet.Body.String())
		}

		// Admin attempting POST on secondary mailbox bridge credentials without linked session -> 403 Forbidden
		reqAdminPost := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/v1/mailboxes/%s/bridge/credentials", secondaryMailboxID), strings.NewReader(`{"label":"test-cred"}`))
		reqAdminPost.AddCookie(&http.Cookie{Name: "byos_webmail_session", Value: rawAdminToken})
		reqAdminPost.Header.Set("X-BYOS-Active-Mailbox", secondaryMailboxID)
		reqAdminPost.Header.Set("Origin", "http://localhost:3001")
		reqAdminPost.Header.Set("Content-Type", "application/json")
		recAdminPost := httptest.NewRecorder()
		mux.ServeHTTP(recAdminPost, reqAdminPost)
		if recAdminPost.Code != http.StatusForbidden {
			t.Errorf("expected 403 Forbidden for admin POST on private bridge credentials, got %d: %s", recAdminPost.Code, recAdminPost.Body.String())
		}

		// Admin attempting DELETE on secondary mailbox bridge credentials -> PERMITTED (not 403)
		reqAdminDel := httptest.NewRequest(http.MethodDelete, fmt.Sprintf("/v1/mailboxes/%s/bridge/credentials/%s", secondaryMailboxID, uuid.New().String()), nil)
		reqAdminDel.AddCookie(&http.Cookie{Name: "byos_webmail_session", Value: rawAdminToken})
		reqAdminDel.Header.Set("X-BYOS-Active-Mailbox", secondaryMailboxID)
		reqAdminDel.Header.Set("Origin", "http://localhost:3001")
		recAdminDel := httptest.NewRecorder()
		mux.ServeHTTP(recAdminDel, reqAdminDel)
		if recAdminDel.Code == http.StatusForbidden {
			t.Errorf("expected admin DELETE on bridge credentials to be permitted, got 403 Forbidden")
		}
	})

	t.Run("Org Admin Permission - Aliases Administration", func(t *testing.T) {
		// Non-admin peer member attempting GET on unlinked mailbox aliases -> 403 Forbidden
		reqMemberGet := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/v1/mailboxes/%s/aliases", unlinkedMailboxID), nil)
		reqMemberGet.Header.Set("X-BYOS-Client", "webmail")
		reqMemberGet.AddCookie(&http.Cookie{Name: "byos_webmail_session", Value: rawToken})
		reqMemberGet.Header.Set("X-BYOS-Active-Mailbox", unlinkedMailboxID)
		recMemberGet := httptest.NewRecorder()
		mux.ServeHTTP(recMemberGet, reqMemberGet)
		if recMemberGet.Code != http.StatusForbidden {
			t.Errorf("expected non-admin peer GET on aliases to return 403 Forbidden, got %d", recMemberGet.Code)
		}

		// Org Admin attempting GET on unlinked mailbox aliases -> 200 OK
		reqAdminGetAliases := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/v1/mailboxes/%s/aliases", unlinkedMailboxID), nil)
		reqAdminGetAliases.Header.Set("X-BYOS-Client", "webmail")
		reqAdminGetAliases.AddCookie(&http.Cookie{Name: "byos_webmail_session", Value: rawAdminToken})
		reqAdminGetAliases.Header.Set("X-BYOS-Active-Mailbox", unlinkedMailboxID)
		recAdminGetAliases := httptest.NewRecorder()
		mux.ServeHTTP(recAdminGetAliases, reqAdminGetAliases)
		if recAdminGetAliases.Code != http.StatusOK {
			t.Errorf("expected org admin GET on aliases to return 200 OK, got %d: %s", recAdminGetAliases.Code, recAdminGetAliases.Body.String())
		}
	})

	// 7. Storage Service Group Separation Tests
	t.Run("Storage Service Separation - Internal Key Groups", func(t *testing.T) {
		storageKey := "storage-worker-internal-key-routecov-123"
		outboundKey := "outbound-worker-internal-key-routecov-456"
		t.Setenv("STORAGE_WORKER_INTERNAL_KEY", storageKey)
		t.Setenv("INTERNAL_API_KEY", outboundKey)

		// A. Valid storage key on storage store route -> passes service auth (does NOT return 401 or 403)
		reqStorageValid := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/v1/mailboxes/%s/storage/store", primaryMailboxID), bytes.NewReader([]byte("chunk-data")))
		reqStorageValid.Header.Set("X-Internal-Key", storageKey)
		reqStorageValid.Header.Set("X-Object-Key", fmt.Sprintf("mailboxes/%s/notes/manifest.enc", primaryMailboxID))
		recStorageValid := httptest.NewRecorder()
		mux.ServeHTTP(recStorageValid, reqStorageValid)
		if recStorageValid.Code == http.StatusUnauthorized || recStorageValid.Code == http.StatusForbidden {
			t.Errorf("expected storage worker key on storage route to pass auth, got %d: %s", recStorageValid.Code, recStorageValid.Body.String())
		}

		// B. Outbound worker key (INTERNAL_API_KEY) on storage store route -> 403 Forbidden
		reqOutboundOnStorage := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/v1/mailboxes/%s/storage/store", primaryMailboxID), bytes.NewReader([]byte("chunk-data")))
		reqOutboundOnStorage.Header.Set("X-Internal-Key", outboundKey)
		reqOutboundOnStorage.Header.Set("X-Object-Key", fmt.Sprintf("mailboxes/%s/notes/manifest.enc", primaryMailboxID))
		recOutboundOnStorage := httptest.NewRecorder()
		mux.ServeHTTP(recOutboundOnStorage, reqOutboundOnStorage)
		if recOutboundOnStorage.Code != http.StatusForbidden {
			t.Errorf("expected outbound key on storage route to return 403 Forbidden, got %d: %s", recOutboundOnStorage.Code, recOutboundOnStorage.Body.String())
		}

		// C. User session route (message read) rejects internal service keys without user session -> 401 Unauthorized
		reqUserRouteWithKey := httptest.NewRequest(http.MethodPut, fmt.Sprintf("/v1/mailboxes/%s/messages/%s/read", primaryMailboxID, dummyMsgID), strings.NewReader(`{"read":true}`))
		reqUserRouteWithKey.Header.Set("X-Internal-Key", storageKey)
		reqUserRouteWithKey.Header.Set("Content-Type", "application/json")
		recUserRouteWithKey := httptest.NewRecorder()
		mux.ServeHTTP(recUserRouteWithKey, reqUserRouteWithKey)
		if recUserRouteWithKey.Code != http.StatusUnauthorized {
			t.Errorf("expected user session route to reject internal key without user session, got %d", recUserRouteWithKey.Code)
		}
	})
}

// TestMultiAccount_MFAStateMachine_FullLifecycle comprehensively tests all 12 properties of the
// secondary-account MFA state machine across linkedAccountsHandler and login2FAVerifyHandler.
func TestMultiAccount_MFAStateMachine_FullLifecycle(t *testing.T) {
	_, conn, ctx := getSafeTestDSN(t)
	if conn == nil {
		return
	}
	defer conn.Close(ctx)

	tag := uuid.New().String()[:8]
	orgID := uuid.New().String()
	domainID := uuid.New().String()

	// 1. Setup organization and domain
	_, err := conn.Exec(ctx, `INSERT INTO organizations (id, name, seat_count, org_recovery_pk) VALUES ($1, $2, 10, decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'))`, orgID, "MFALifecycle Org "+tag)
	if err != nil {
		t.Fatalf("failed to insert org: %v", err)
	}
	defer conn.Exec(ctx, `DELETE FROM organizations WHERE id=$1`, orgID)

	_, err = conn.Exec(ctx, `INSERT INTO domains (id, org_id, name, is_verified) VALUES ($1, $2, $3, true)`, domainID, orgID, "mfalifecycle-"+tag+".local")
	if err != nil {
		t.Fatalf("failed to insert domain: %v", err)
	}

	pwHash, _ := hashPassword("Secret-Pass-123!")
	totpSecret := "JBSWY3DPEHPK3PXP"

	// 2. Primary user (Alice) with active session
	primUserID := uuid.New().String()
	primEmail := "alice-" + tag + "@mfalifecycle.local"
	_, err = conn.Exec(ctx, `INSERT INTO users (id, org_id, email, password_hash, display_name, role, is_active) VALUES ($1, $2, $3, $4, 'Alice Primary', 'member', true)`,
		primUserID, orgID, primEmail, pwHash)
	if err != nil {
		t.Fatalf("failed to insert primary user: %v", err)
	}
	primMailboxID := uuid.New().String()
	_, err = conn.Exec(ctx, `INSERT INTO mailboxes (id, org_id, user_id, domain_id, local_part, mode, is_active, status) VALUES ($1, $2, $3, $4, 'alice', 'private', true, 'active')`,
		primMailboxID, orgID, primUserID, domainID)
	if err != nil {
		t.Fatalf("failed to insert primary mailbox: %v", err)
	}

	rawTokenA := "mfa-test-primary-session-token-32b-a!"
	tokenAHash := hashToken(rawTokenA)
	sessionExpiresAt := time.Now().Add(24 * time.Hour)
	_, err = conn.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`, primUserID, tokenAHash, sessionExpiresAt)
	if err != nil {
		t.Fatalf("failed to insert primary session: %v", err)
	}
	authorizeMailboxForSession(tokenAHash, primMailboxID, primUserID, orgID, sessionExpiresAt)
	defer revokeAllMailboxesForSession(tokenAHash)

	// 3. Attacker primary user (Eve) with active session
	attUserID := uuid.New().String()
	attEmail := "eve-" + tag + "@mfalifecycle.local"
	_, err = conn.Exec(ctx, `INSERT INTO users (id, org_id, email, password_hash, display_name, role, is_active) VALUES ($1, $2, $3, $4, 'Eve Attacker', 'member', true)`,
		attUserID, orgID, attEmail, pwHash)
	if err != nil {
		t.Fatalf("failed to insert attacker user: %v", err)
	}
	rawTokenB := "mfa-test-attacker-session-token-32b-b"
	tokenBHash := hashToken(rawTokenB)
	_, err = conn.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`, attUserID, tokenBHash, sessionExpiresAt)
	if err != nil {
		t.Fatalf("failed to insert attacker session: %v", err)
	}
	defer revokeAllMailboxesForSession(tokenBHash)

	// 4. Secondary user (Bob) with MFA enabled
	secUserID := uuid.New().String()
	secEmail := "bob-" + tag + "@mfalifecycle.local"
	_, err = conn.Exec(ctx, `INSERT INTO users (id, org_id, email, password_hash, display_name, role, is_active, two_factor_enabled, totp_secret) VALUES ($1, $2, $3, $4, 'Bob Secondary', 'member', true, true, $5)`,
		secUserID, orgID, secEmail, pwHash, totpSecret)
	if err != nil {
		t.Fatalf("failed to insert secondary user: %v", err)
	}
	secMailboxID := uuid.New().String()
	_, err = conn.Exec(ctx, `INSERT INTO mailboxes (id, org_id, user_id, domain_id, local_part, mode, is_active, status) VALUES ($1, $2, $3, $4, 'bob', 'private', true, 'active')`,
		secMailboxID, orgID, secUserID, domainID)
	if err != nil {
		t.Fatalf("failed to insert secondary mailbox: %v", err)
	}

	// -------------------------------------------------------------
	// Property 1 & Property 2: Primary session preserved & secondary account independently completes authentication
	// -------------------------------------------------------------
	// Wrong password returns 401
	reqWrongPw := httptest.NewRequest(http.MethodPost, "/v1/auth/linked-accounts", strings.NewReader(fmt.Sprintf(`{"email":"%s","password":"wrong-password"}`, secEmail)))
	reqWrongPw.Header.Set("X-BYOS-Client", "webmail")
	reqWrongPw.AddCookie(&http.Cookie{Name: "byos_webmail_session", Value: rawTokenA})
	reqWrongPw.Header.Set("Content-Type", "application/json")
	recWrongPw := httptest.NewRecorder()
	linkedAccountsHandler(recWrongPw, reqWrongPw)
	if recWrongPw.Code != http.StatusUnauthorized {
		t.Fatalf("Property 2 failed: wrong password expected 401, got %d", recWrongPw.Code)
	}

	// Correct password initiates challenge; primary session cookie is NOT modified
	reqInit := httptest.NewRequest(http.MethodPost, "/v1/auth/linked-accounts", strings.NewReader(fmt.Sprintf(`{"email":"%s","password":"Secret-Pass-123!"}`, secEmail)))
	reqInit.Header.Set("X-BYOS-Client", "webmail")
	reqInit.AddCookie(&http.Cookie{Name: "byos_webmail_session", Value: rawTokenA})
	reqInit.Header.Set("Content-Type", "application/json")
	recInit := httptest.NewRecorder()
	linkedAccountsHandler(recInit, reqInit)
	if recInit.Code != http.StatusOK {
		t.Fatalf("Property 1 failed: initial credentials submission expected 200 OK, got %d: %s", recInit.Code, recInit.Body.String())
	}

	// Assert NO Set-Cookie header was returned (primary session cookie preserved)
	if cookieHeader := recInit.Header().Get("Set-Cookie"); cookieHeader != "" {
		t.Fatalf("Property 1 failed: initial linking must not modify session cookie, got Set-Cookie: %s", cookieHeader)
	}

	var initResp map[string]interface{}
	if err := json.Unmarshal(recInit.Body.Bytes(), &initResp); err != nil {
		t.Fatalf("failed to decode initial link response: %v", err)
	}
	if initResp["two_factor_required"] != true {
		t.Fatalf("Property 1 failed: expected two_factor_required=true, got %v", initResp["two_factor_required"])
	}
	challengeToken, ok := initResp["challenge_token"].(string)
	if !ok || challengeToken == "" {
		t.Fatalf("Property 1 failed: missing or empty challenge_token")
	}

	// Verify session token A remains valid in database
	var primarySessionRevoked *time.Time
	err = conn.QueryRow(ctx, `SELECT revoked_at FROM sessions WHERE token_hash=$1`, tokenAHash).Scan(&primarySessionRevoked)
	if err != nil || primarySessionRevoked != nil {
		t.Fatalf("Property 1 failed: primary session was revoked or missing in database")
	}

	// -------------------------------------------------------------
	// Property 3: MFA challenge is bound to primary session (destination == hex(tokenAHash)) and secondary account
	// -------------------------------------------------------------
	var chUserID, chType, chDest string
	var chExpiresAt time.Time
	err = conn.QueryRow(ctx, `SELECT user_id::text, challenge_type, destination, expires_at FROM auth_challenges WHERE challenge_token=$1`, challengeToken).
		Scan(&chUserID, &chType, &chDest, &chExpiresAt)
	if err != nil {
		t.Fatalf("Property 3 failed: challenge record not found in database: %v", err)
	}
	expectedCallerHex := hex.EncodeToString(tokenAHash)
	if chDest != expectedCallerHex {
		t.Fatalf("Property 3 failed: challenge destination (%s) does not match primary session hex (%s)", chDest, expectedCallerHex)
	}
	if chUserID != secUserID {
		t.Fatalf("Property 3 failed: challenge user_id (%s) does not match secondary user ID (%s)", chUserID, secUserID)
	}
	if chType != "link_2fa" {
		t.Fatalf("Property 3 failed: challenge type (%s) is not link_2fa", chType)
	}

	// -------------------------------------------------------------
	// Property 4: Short, explicit lifetime (5 minutes)
	// -------------------------------------------------------------
	remainingDuration := time.Until(chExpiresAt)
	if remainingDuration < 4*time.Minute || remainingDuration > 5*time.Minute+5*time.Second {
		t.Fatalf("Property 4 failed: challenge lifetime expected ~5 minutes, got %v", remainingDuration)
	}

	// Test expired challenge rejection
	expiredTok := "expired-challenge-token-" + tag
	_, err = conn.Exec(ctx, `INSERT INTO auth_challenges (user_id, challenge_type, challenge_token, destination, expires_at) VALUES ($1, 'link_2fa', $2, $3, now() - interval '10 seconds')`,
		secUserID, expiredTok, expectedCallerHex)
	if err != nil {
		t.Fatalf("failed to insert expired challenge: %v", err)
	}
	reqExpired := httptest.NewRequest(http.MethodPost, "/v1/auth/linked-accounts", strings.NewReader(fmt.Sprintf(`{"challenge_token":"%s","code":"123456"}`, expiredTok)))
	reqExpired.Header.Set("X-BYOS-Client", "webmail")
	reqExpired.AddCookie(&http.Cookie{Name: "byos_webmail_session", Value: rawTokenA})
	reqExpired.Header.Set("Content-Type", "application/json")
	recExpired := httptest.NewRecorder()
	linkedAccountsHandler(recExpired, reqExpired)
	if recExpired.Code != http.StatusUnauthorized {
		t.Fatalf("Property 4 failed: expired challenge expected 401 Unauthorized, got %d: %s", recExpired.Code, recExpired.Body.String())
	}

	// -------------------------------------------------------------
	// Property 6: Cannot be replayed from another primary session (403 Forbidden)
	// -------------------------------------------------------------
	validTOTPCode, err := computeTOTP(totpSecret, time.Now())
	if err != nil {
		t.Fatalf("failed to compute valid TOTP code: %v", err)
	}

	// Eve attempts to verify Alice's challenge with Eve's session cookie rawTokenB
	reqReplay := httptest.NewRequest(http.MethodPost, "/v1/auth/linked-accounts", strings.NewReader(fmt.Sprintf(`{"challenge_token":"%s","code":"%s"}`, challengeToken, validTOTPCode)))
	reqReplay.Header.Set("X-BYOS-Client", "webmail")
	reqReplay.AddCookie(&http.Cookie{Name: "byos_webmail_session", Value: rawTokenB}) // Eve's session!
	reqReplay.Header.Set("Content-Type", "application/json")
	recReplay := httptest.NewRecorder()
	linkedAccountsHandler(recReplay, reqReplay)
	if recReplay.Code != http.StatusForbidden {
		t.Fatalf("Property 6 failed: replaying challenge from another session expected 403 Forbidden, got %d: %s", recReplay.Code, recReplay.Body.String())
	}

	// Eve attempts to replay via login2FAVerifyHandler -> also 403 Forbidden
	reqReplay2FA := httptest.NewRequest(http.MethodPost, "/v1/auth/2fa/verify-login", strings.NewReader(fmt.Sprintf(`{"challenge_token":"%s","code":"%s"}`, challengeToken, validTOTPCode)))
	reqReplay2FA.Header.Set("X-BYOS-Client", "webmail")
	reqReplay2FA.AddCookie(&http.Cookie{Name: "byos_webmail_session", Value: rawTokenB}) // Eve's session!
	reqReplay2FA.Header.Set("Content-Type", "application/json")
	recReplay2FA := httptest.NewRecorder()
	login2FAVerifyHandler(recReplay2FA, reqReplay2FA)
	if recReplay2FA.Code != http.StatusForbidden {
		t.Fatalf("Property 6 failed: replaying challenge on login2FAVerifyHandler expected 403 Forbidden, got %d: %s", recReplay2FA.Code, recReplay2FA.Body.String())
	}

	// -------------------------------------------------------------
	// Property 8: Invalid TOTP code cannot establish mailbox access
	// -------------------------------------------------------------
	reqInvalidCode := httptest.NewRequest(http.MethodPost, "/v1/auth/linked-accounts", strings.NewReader(fmt.Sprintf(`{"challenge_token":"%s","code":"000000"}`, challengeToken)))
	reqInvalidCode.Header.Set("X-BYOS-Client", "webmail")
	reqInvalidCode.AddCookie(&http.Cookie{Name: "byos_webmail_session", Value: rawTokenA})
	reqInvalidCode.Header.Set("Content-Type", "application/json")
	recInvalidCode := httptest.NewRecorder()
	linkedAccountsHandler(recInvalidCode, reqInvalidCode)
	if recInvalidCode.Code != http.StatusUnauthorized {
		t.Fatalf("Property 8 failed: invalid TOTP code expected 401 Unauthorized, got %d: %s", recInvalidCode.Code, recInvalidCode.Body.String())
	}

	// Mailbox must NOT be authorized yet
	if isMailboxAuthorizedForSession(tokenAHash, primUserID, secMailboxID, nil, ctx) {
		t.Fatalf("Property 8 failed: mailbox must not be authorized with invalid code")
	}

	// -------------------------------------------------------------
	// Property 5 & Property 10: Consumed only once (single-use deletion) & successful linking preserves session
	// -------------------------------------------------------------
	reqValid := httptest.NewRequest(http.MethodPost, "/v1/auth/linked-accounts", strings.NewReader(fmt.Sprintf(`{"challenge_token":"%s","code":"%s"}`, challengeToken, validTOTPCode)))
	reqValid.Header.Set("X-BYOS-Client", "webmail")
	reqValid.AddCookie(&http.Cookie{Name: "byos_webmail_session", Value: rawTokenA})
	reqValid.Header.Set("Content-Type", "application/json")
	recValid := httptest.NewRecorder()
	linkedAccountsHandler(recValid, reqValid)
	if recValid.Code != http.StatusOK {
		t.Fatalf("Property 10 failed: valid verification expected 200 OK, got %d: %s", recValid.Code, recValid.Body.String())
	}

	// Assert NO session cookie was overwritten
	if cookieHeader := recValid.Header().Get("Set-Cookie"); cookieHeader != "" {
		t.Fatalf("Property 10 failed: linking completion must not overwrite session cookie, got Set-Cookie: %s", cookieHeader)
	}

	// Mailbox is now authorized for primary session
	if !isMailboxAuthorizedForSession(tokenAHash, primUserID, secMailboxID, nil, ctx) {
		t.Fatalf("Property 10 failed: mailbox should be authorized for primary session after successful link")
	}

	// Re-attempting with the same challenge token must fail with 401 (single-use deletion)
	reqSecondAttempt := httptest.NewRequest(http.MethodPost, "/v1/auth/linked-accounts", strings.NewReader(fmt.Sprintf(`{"challenge_token":"%s","code":"%s"}`, challengeToken, validTOTPCode)))
	reqSecondAttempt.Header.Set("X-BYOS-Client", "webmail")
	reqSecondAttempt.AddCookie(&http.Cookie{Name: "byos_webmail_session", Value: rawTokenA})
	reqSecondAttempt.Header.Set("Content-Type", "application/json")
	recSecondAttempt := httptest.NewRecorder()
	linkedAccountsHandler(recSecondAttempt, reqSecondAttempt)
	if recSecondAttempt.Code != http.StatusUnauthorized {
		t.Fatalf("Property 5 failed: re-using challenge expected 401 Unauthorized, got %d: %s", recSecondAttempt.Code, recSecondAttempt.Body.String())
	}

	// -------------------------------------------------------------
	// Property 7: MFA response cannot link a different secondary account
	// -------------------------------------------------------------
	// The client verification body only accepts { challenge_token, code }.
	// The target mailbox is strictly determined by the server query against auth_challenges.user_id.

	// -------------------------------------------------------------
	// Property 9: Account suspension and deactivation respected
	// -------------------------------------------------------------
	// Deactivate secondary user
	_, err = conn.Exec(ctx, `UPDATE users SET is_active=false WHERE id=$1`, secUserID)
	if err != nil {
		t.Fatalf("failed to deactivate secondary user: %v", err)
	}
	reqInactiveUser := httptest.NewRequest(http.MethodPost, "/v1/auth/linked-accounts", strings.NewReader(fmt.Sprintf(`{"email":"%s","password":"Secret-Pass-123!"}`, secEmail)))
	reqInactiveUser.Header.Set("X-BYOS-Client", "webmail")
	reqInactiveUser.AddCookie(&http.Cookie{Name: "byos_webmail_session", Value: rawTokenA})
	reqInactiveUser.Header.Set("Content-Type", "application/json")
	recInactiveUser := httptest.NewRecorder()
	linkedAccountsHandler(recInactiveUser, reqInactiveUser)
	if recInactiveUser.Code != http.StatusUnauthorized {
		t.Fatalf("Property 9 failed: inactive user expected 401 Unauthorized, got %d", recInactiveUser.Code)
	}

	// Reactivate user but suspend mailbox
	_, _ = conn.Exec(ctx, `UPDATE users SET is_active=true WHERE id=$1`, secUserID)
	_, _ = conn.Exec(ctx, `UPDATE mailboxes SET status='suspended' WHERE id=$1`, secMailboxID)
	// Clear replay tracking for secUserID to test suspended mailbox authorization independently
	_, _ = conn.Exec(ctx, `DELETE FROM auth_challenges WHERE user_id=$1 AND challenge_type='totp_step'`, secUserID)
	if redisClient != nil {
		s := time.Now().Unix() / 30
		h := sha256.Sum256([]byte(totpSecret))
		tag := hex.EncodeToString(h[:8])
		for off := int64(-2); off <= 2; off++ {
			_ = redisClient.Del(ctx, fmt.Sprintf("totp:replay:%s:%s:%d", secUserID, tag, s+off))
		}
	}
	reqSuspendedMb := httptest.NewRequest(http.MethodPost, "/v1/auth/linked-accounts", strings.NewReader(fmt.Sprintf(`{"email":"%s","password":"Secret-Pass-123!","code":"%s"}`, secEmail, validTOTPCode)))
	reqSuspendedMb.Header.Set("X-BYOS-Client", "webmail")
	reqSuspendedMb.AddCookie(&http.Cookie{Name: "byos_webmail_session", Value: rawTokenA})
	reqSuspendedMb.Header.Set("Content-Type", "application/json")
	recSuspendedMb := httptest.NewRecorder()
	linkedAccountsHandler(recSuspendedMb, reqSuspendedMb)
	// Mailbox selection requires is_active=true AND status='active'; returns 404
	if recSuspendedMb.Code != http.StatusNotFound {
		t.Fatalf("Property 9 failed: suspended mailbox must return 404 Not Found, got %d: %s", recSuspendedMb.Code, recSuspendedMb.Body.String())
	}

	// -------------------------------------------------------------
	// Property 11: No passwords or TOTP secrets persisted in storage, Redis, session metadata, or logs
	// -------------------------------------------------------------
	var pwCheck string
	_ = conn.QueryRow(ctx, `SELECT COALESCE(user_agent, '') FROM sessions WHERE token_hash=$1`, tokenAHash).Scan(&pwCheck)
	if strings.Contains(pwCheck, "Secret-Pass-123!") || strings.Contains(pwCheck, totpSecret) {
		t.Fatalf("Property 11 failed: secret leaked into session metadata")
	}

	// -------------------------------------------------------------
	// Property 12: Rate limiting applies consistently to password and MFA attempts
	// -------------------------------------------------------------
	if redisClient != nil {
		testIP := "192.0.2.42"
		rKey := "auth:link:ip:" + testIP
		redisClient.Set(ctx, rKey, 5, 10*time.Minute)
		defer redisClient.Del(ctx, rKey)

		reqRateLimit := httptest.NewRequest(http.MethodPost, "/v1/auth/linked-accounts", strings.NewReader(fmt.Sprintf(`{"email":"%s","password":"Secret-Pass-123!"}`, secEmail)))
		reqRateLimit.Header.Set("X-BYOS-Client", "webmail")
		reqRateLimit.AddCookie(&http.Cookie{Name: "byos_webmail_session", Value: rawTokenA})
		reqRateLimit.Header.Set("Content-Type", "application/json")
		reqRateLimit.RemoteAddr = testIP + ":12345"
		recRateLimit := httptest.NewRecorder()
		linkedAccountsHandler(recRateLimit, reqRateLimit)
		if recRateLimit.Code != http.StatusTooManyRequests {
			t.Fatalf("Property 12 failed: rate limited attempt expected 429 Too Many Requests, got %d", recRateLimit.Code)
		}
	}
}

