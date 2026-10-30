package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestChangePasswordWithWrappedSkUser(t *testing.T) {
	requireRecoveryStack(t)
	db := setupTestDB(t)
	defer db.Close()

	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
	knownOldPass := "known-old-pass-123"
	oldHash, err := hashPassword(knownOldPass)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE users SET password_hash=$1 WHERE id=$2`, oldHash, ownerID); err != nil {
		t.Fatal(err)
	}
	ownerToken := createTestSession(t, db, ownerID)
	_, mailboxID := createTestMailbox(t, db, orgID, ownerID, "cp-with-wsk")

	initialWsk := `{"salt":"initial_salt","envelope":"initial_envelope"}`
	if _, err := db.Exec(`UPDATE mailboxes SET wrapped_sk_user=$1 WHERE id=$2`, initialWsk, mailboxID); err != nil {
		t.Fatalf("failed setting initial wrapped_sk_user: %v", err)
	}

	newPassword := "new-strong-pass-123"
	newWsk := `{"salt":"newsalt","envelope":"newenv","root_wrapped":"root"}`
	reqPayload := map[string]string{
		"current_password": knownOldPass,
		"new_password":     newPassword,
		"wrapped_sk_user":  newWsk,
	}
	bodyBytes, _ := json.Marshal(reqPayload)
	req := httptest.NewRequest(http.MethodPost, "/v1/auth/change-password", bytes.NewReader(bodyBytes))
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: ownerToken})
	rec := httptest.NewRecorder()
	changePasswordHandler(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("change-password status = %d, want 204: %s", rec.Code, rec.Body.String())
	}

	var storedHash string
	if err := db.QueryRow(`SELECT password_hash FROM users WHERE id=$1`, ownerID).Scan(&storedHash); err != nil {
		t.Fatalf("failed querying password_hash: %v", err)
	}
	if !verifyPassword(storedHash, newPassword) {
		t.Fatalf("new password hash did not verify against newPassword")
	}

	var storedWsk string
	if err := db.QueryRow(`SELECT COALESCE(wrapped_sk_user, '') FROM mailboxes WHERE id=$1`, mailboxID).Scan(&storedWsk); err != nil {
		t.Fatalf("failed querying wrapped_sk_user: %v", err)
	}
	if storedWsk != newWsk {
		t.Fatalf("stored wrapped_sk_user = %q, want %q", storedWsk, newWsk)
	}
}

func TestChangePasswordRejectsMissingWrappedSkForMailboxOwner(t *testing.T) {
	requireRecoveryStack(t)
	db := setupTestDB(t)
	defer db.Close()

	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
	knownOldPass := "known-old-pass-123"
	oldHash, err := hashPassword(knownOldPass)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE users SET password_hash=$1 WHERE id=$2`, oldHash, ownerID); err != nil {
		t.Fatal(err)
	}
	ownerToken := createTestSession(t, db, ownerID)
	_, mailboxID := createTestMailbox(t, db, orgID, ownerID, "cp-no-wsk")

	initialWsk := `{"salt":"initial_salt","envelope":"initial_envelope"}`
	if _, err := db.Exec(`UPDATE mailboxes SET wrapped_sk_user=$1 WHERE id=$2`, initialWsk, mailboxID); err != nil {
		t.Fatalf("failed setting initial wrapped_sk_user: %v", err)
	}

	// Changing password without wrapped_sk_user for an account owning a mailbox MUST be rejected (400 Bad Request)
	newPassword := "brand-new-pass-456"
	reqPayload := map[string]string{
		"current_password": knownOldPass,
		"new_password":     newPassword,
	}
	bodyBytes, _ := json.Marshal(reqPayload)
	req := httptest.NewRequest(http.MethodPost, "/v1/auth/change-password", bytes.NewReader(bodyBytes))
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: ownerToken})
	rec := httptest.NewRecorder()
	changePasswordHandler(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("change-password status = %d, want 400 when missing wrapped_sk_user: %s", rec.Code, rec.Body.String())
	}

	// Verify nothing was changed in the database
	var storedHash string
	if err := db.QueryRow(`SELECT password_hash FROM users WHERE id=$1`, ownerID).Scan(&storedHash); err != nil {
		t.Fatalf("failed querying password_hash: %v", err)
	}
	if storedHash != oldHash {
		t.Fatalf("password hash was modified on rejected request!")
	}

	var storedWsk string
	if err := db.QueryRow(`SELECT COALESCE(wrapped_sk_user, '') FROM mailboxes WHERE id=$1`, mailboxID).Scan(&storedWsk); err != nil {
		t.Fatalf("failed querying wrapped_sk_user: %v", err)
	}
	if storedWsk != initialWsk {
		t.Fatalf("stored wrapped_sk_user was altered on rejected request!")
	}
}

func TestChangePasswordCurrentPasswordVerification(t *testing.T) {
	requireRecoveryStack(t)
	db := setupTestDB(t)
	defer db.Close()

	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
	knownOldPass := "known-old-pass-123"
	oldHash, err := hashPassword(knownOldPass)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE users SET password_hash=$1 WHERE id=$2`, oldHash, ownerID); err != nil {
		t.Fatal(err)
	}
	ownerToken := createTestSession(t, db, ownerID)
	_, mailboxID := createTestMailbox(t, db, orgID, ownerID, "cp-cur-pwd")

	initialWsk := `{"salt":"initial_salt","envelope":"initial_envelope"}`
	if _, err := db.Exec(`UPDATE mailboxes SET wrapped_sk_user=$1 WHERE id=$2`, initialWsk, mailboxID); err != nil {
		t.Fatal(err)
	}

	// 1. Missing current password -> 400 Bad Request (Finding F-03)
	newWsk := `{"salt":"newsalt","envelope":"newenv"}`
	missingPayload := map[string]string{
		"new_password":    "new-strong-pass-789",
		"wrapped_sk_user": newWsk,
	}
	mBytes, _ := json.Marshal(missingPayload)
	reqMissing := httptest.NewRequest(http.MethodPost, "/v1/auth/change-password", bytes.NewReader(mBytes))
	reqMissing.AddCookie(&http.Cookie{Name: "byos_session", Value: ownerToken})
	recMissing := httptest.NewRecorder()
	changePasswordHandler(recMissing, reqMissing)
	if recMissing.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request for missing current password, got %d: %s", recMissing.Code, recMissing.Body.String())
	}

	// 2. Wrong current password -> 401 Unauthorized
	badReqPayload := map[string]string{
		"current_password": "wrong-password",
		"new_password":     "new-strong-pass-789",
		"wrapped_sk_user":  newWsk,
	}
	bBytes, _ := json.Marshal(badReqPayload)
	req := httptest.NewRequest(http.MethodPost, "/v1/auth/change-password", bytes.NewReader(bBytes))
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: ownerToken})
	rec := httptest.NewRecorder()
	changePasswordHandler(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized for wrong current password, got %d", rec.Code)
	}

	// 3. Correct current password -> 204 No Content, both credentials updated atomically
	goodReqPayload := map[string]string{
		"current_password": knownOldPass,
		"new_password":     "new-strong-pass-789",
		"wrapped_sk_user":  newWsk,
	}
	gBytes, _ := json.Marshal(goodReqPayload)
	reqGood := httptest.NewRequest(http.MethodPost, "/v1/auth/change-password", bytes.NewReader(gBytes))
	reqGood.AddCookie(&http.Cookie{Name: "byos_session", Value: ownerToken})
	recGood := httptest.NewRecorder()
	changePasswordHandler(recGood, reqGood)

	if recGood.Code != http.StatusNoContent {
		t.Fatalf("expected 204 No Content for valid current password, got %d: %s", recGood.Code, recGood.Body.String())
	}

	var storedHash string
	if err := db.QueryRow(`SELECT password_hash FROM users WHERE id=$1`, ownerID).Scan(&storedHash); err != nil {
		t.Fatal(err)
	}
	if !verifyPassword(storedHash, "new-strong-pass-789") {
		t.Fatal("new password hash failed verification")
	}
	var storedWsk string
	if err := db.QueryRow(`SELECT wrapped_sk_user FROM mailboxes WHERE id=$1`, mailboxID).Scan(&storedWsk); err != nil {
		t.Fatal(err)
	}
	if storedWsk != newWsk {
		t.Fatalf("stored wrapped_sk_user = %q, want %q", storedWsk, newWsk)
	}
}

func TestChangePasswordAllowsPureAdminWithoutMailbox(t *testing.T) {
	requireRecoveryStack(t)
	db := setupTestDB(t)
	defer db.Close()

	_, _, adminID, _ := createTestOrgAndUsers(t, db)
	knownOldPass := "known-old-pass-admin"
	oldHash, err := hashPassword(knownOldPass)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE users SET password_hash=$1 WHERE id=$2`, oldHash, adminID); err != nil {
		t.Fatal(err)
	}
	adminToken := createTestSession(t, db, adminID)

	newPassword := "admin-new-pass-999"
	reqPayload := map[string]string{
		"current_password": knownOldPass,
		"new_password":     newPassword,
	}
	bodyBytes, _ := json.Marshal(reqPayload)
	req := httptest.NewRequest(http.MethodPost, "/v1/auth/change-password", bytes.NewReader(bodyBytes))
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: adminToken})
	rec := httptest.NewRecorder()
	changePasswordHandler(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("change-password for pure admin status = %d, want 204: %s", rec.Code, rec.Body.String())
	}

	var storedHash string
	if err := db.QueryRow(`SELECT password_hash FROM users WHERE id=$1`, adminID).Scan(&storedHash); err != nil {
		t.Fatalf("failed querying password_hash: %v", err)
	}
	if !verifyPassword(storedHash, newPassword) {
		t.Fatalf("new password hash did not verify against newPassword")
	}
}

func TestChangePasswordInvalidWrappedSkUser(t *testing.T) {
	requireRecoveryStack(t)
	db := setupTestDB(t)
	defer db.Close()

	_, ownerID, _, _ := createTestOrgAndUsers(t, db)
	knownOldPass := "known-old-pass-invalid"
	oldHash, err := hashPassword(knownOldPass)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE users SET password_hash=$1 WHERE id=$2`, oldHash, ownerID); err != nil {
		t.Fatal(err)
	}
	ownerToken := createTestSession(t, db, ownerID)

	reqPayload := map[string]string{
		"current_password": knownOldPass,
		"new_password":     "valid-pass-789",
		"wrapped_sk_user":  "not-a-valid-json-object",
	}
	bodyBytes, _ := json.Marshal(reqPayload)
	req := httptest.NewRequest(http.MethodPost, "/v1/auth/change-password", bytes.NewReader(bodyBytes))
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: ownerToken})
	rec := httptest.NewRecorder()
	changePasswordHandler(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("change-password status = %d, want 400 for invalid JSON: %s", rec.Code, rec.Body.String())
	}
}

func TestChangePasswordMFAEnforcement(t *testing.T) {
	requireRecoveryStack(t)
	db := setupTestDB(t)
	defer db.Close()

	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
	knownOldPass := "known-old-pass-mfa"
	oldHash, _ := hashPassword(knownOldPass)
	totpSecret := "JBSWY3DPEHPK3PXP"
	if _, err := db.Exec(`UPDATE users SET password_hash=$1, two_factor_enabled=true, totp_secret=$2 WHERE id=$3`, oldHash, totpSecret, ownerID); err != nil {
		t.Fatal(err)
	}
	ownerToken := createTestSession(t, db, ownerID)
	_, mailboxID := createTestMailbox(t, db, orgID, ownerID, "cp-mfa")

	initialWsk := `{"salt":"initial_salt","envelope":"initial_envelope"}`
	if _, err := db.Exec(`UPDATE mailboxes SET wrapped_sk_user=$1 WHERE id=$2`, initialWsk, mailboxID); err != nil {
		t.Fatal(err)
	}

	newWsk := `{"salt":"newsalt","envelope":"newenv"}`

	// 1. Missing mfa_code when 2FA is active -> 403 Forbidden
	noMfaPayload := map[string]string{
		"current_password": knownOldPass,
		"new_password":     "brand-new-pass-mfa-1",
		"wrapped_sk_user":  newWsk,
	}
	noMfaBytes, _ := json.Marshal(noMfaPayload)
	reqNoMfa := httptest.NewRequest(http.MethodPost, "/v1/auth/change-password", bytes.NewReader(noMfaBytes))
	reqNoMfa.AddCookie(&http.Cookie{Name: "byos_session", Value: ownerToken})
	recNoMfa := httptest.NewRecorder()
	changePasswordHandler(recNoMfa, reqNoMfa)
	if recNoMfa.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for missing mfa_code, got %d: %s", recNoMfa.Code, recNoMfa.Body.String())
	}

	// 2. Invalid mfa_code -> 401 Unauthorized
	badMfaPayload := map[string]string{
		"current_password": knownOldPass,
		"new_password":     "brand-new-pass-mfa-2",
		"wrapped_sk_user":  newWsk,
		"mfa_code":         "000000",
	}
	badMfaBytes, _ := json.Marshal(badMfaPayload)
	reqBadMfa := httptest.NewRequest(http.MethodPost, "/v1/auth/change-password", bytes.NewReader(badMfaBytes))
	reqBadMfa.AddCookie(&http.Cookie{Name: "byos_session", Value: ownerToken})
	recBadMfa := httptest.NewRecorder()
	changePasswordHandler(recBadMfa, reqBadMfa)
	if recBadMfa.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized for invalid mfa_code, got %d: %s", recBadMfa.Code, recBadMfa.Body.String())
	}

	// 3. Valid mfa_code -> 204 No Content
	validCode, err := computeTOTP(totpSecret, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	goodMfaPayload := map[string]string{
		"current_password": knownOldPass,
		"new_password":     "brand-new-pass-mfa-3",
		"wrapped_sk_user":  newWsk,
		"mfa_code":         validCode,
	}
	goodMfaBytes, _ := json.Marshal(goodMfaPayload)
	reqGoodMfa := httptest.NewRequest(http.MethodPost, "/v1/auth/change-password", bytes.NewReader(goodMfaBytes))
	reqGoodMfa.AddCookie(&http.Cookie{Name: "byos_session", Value: ownerToken})
	recGoodMfa := httptest.NewRecorder()
	changePasswordHandler(recGoodMfa, reqGoodMfa)
	if recGoodMfa.Code != http.StatusNoContent {
		t.Fatalf("expected 204 No Content for valid mfa_code, got %d: %s", recGoodMfa.Code, recGoodMfa.Body.String())
	}
}

func TestChangePasswordMultiMailboxIsolation(t *testing.T) {
	requireRecoveryStack(t)
	db := setupTestDB(t)
	defer db.Close()

	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
	knownOldPass := "known-old-pass-multi"
	oldHash, _ := hashPassword(knownOldPass)
	if _, err := db.Exec(`UPDATE users SET password_hash=$1 WHERE id=$2`, oldHash, ownerID); err != nil {
		t.Fatal(err)
	}
	ownerToken := createTestSession(t, db, ownerID)

	// Create 2 separate mailboxes for ownerID
	_, mb1ID := createTestMailbox(t, db, orgID, ownerID, "multi-box-1")
	_, mb2ID := createTestMailbox(t, db, orgID, ownerID, "multi-box-2")

	wsk1 := `{"salt":"salt1","envelope":"env1"}`
	wsk2 := `{"salt":"salt2","envelope":"env2"}`
	if _, err := db.Exec(`UPDATE mailboxes SET wrapped_sk_user=$1 WHERE id=$2`, wsk1, mb1ID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`UPDATE mailboxes SET wrapped_sk_user=$1 WHERE id=$2`, wsk2, mb2ID); err != nil {
		t.Fatal(err)
	}

	newWsk1 := `{"salt":"salt1_new","envelope":"env1_new"}`

	// 1. Omitting mailbox_id when multiple mailboxes have key envelopes -> 400 Bad Request
	noMbPayload := map[string]string{
		"current_password": knownOldPass,
		"new_password":     "new-pass-multi-1",
		"wrapped_sk_user":  newWsk1,
	}
	noMbBytes, _ := json.Marshal(noMbPayload)
	reqNoMb := httptest.NewRequest(http.MethodPost, "/v1/auth/change-password", bytes.NewReader(noMbBytes))
	reqNoMb.AddCookie(&http.Cookie{Name: "byos_session", Value: ownerToken})
	recNoMb := httptest.NewRecorder()
	changePasswordHandler(recNoMb, reqNoMb)
	if recNoMb.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request when multiple mailboxes exist without mailbox_id, got %d: %s", recNoMb.Code, recNoMb.Body.String())
	}

	// 2. Providing mailbox_id for mb1ID -> updates mb1ID, leaves mb2ID unchanged
	targetMbPayload := map[string]string{
		"current_password": knownOldPass,
		"new_password":     "new-pass-multi-2",
		"wrapped_sk_user":  newWsk1,
		"mailbox_id":       mb1ID,
	}
	targetMbBytes, _ := json.Marshal(targetMbPayload)
	reqTargetMb := httptest.NewRequest(http.MethodPost, "/v1/auth/change-password", bytes.NewReader(targetMbBytes))
	reqTargetMb.AddCookie(&http.Cookie{Name: "byos_session", Value: ownerToken})
	recTargetMb := httptest.NewRecorder()
	changePasswordHandler(recTargetMb, reqTargetMb)
	if recTargetMb.Code != http.StatusNoContent {
		t.Fatalf("expected 204 No Content when specifying mailbox_id, got %d: %s", recTargetMb.Code, recTargetMb.Body.String())
	}

	// Verify database: mb1 is updated, mb2 is preserved byte-for-byte
	var storedWsk1, storedWsk2 string
	if err := db.QueryRow(`SELECT wrapped_sk_user FROM mailboxes WHERE id=$1`, mb1ID).Scan(&storedWsk1); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`SELECT wrapped_sk_user FROM mailboxes WHERE id=$1`, mb2ID).Scan(&storedWsk2); err != nil {
		t.Fatal(err)
	}
	if storedWsk1 != newWsk1 {
		t.Fatalf("expected mb1 wrapped_sk_user to be updated to %s, got %s", newWsk1, storedWsk1)
	}
	if storedWsk2 != wsk2 {
		t.Fatalf("expected mb2 wrapped_sk_user to remain %s, got %s (corruption detected!)", wsk2, storedWsk2)
	}
}

