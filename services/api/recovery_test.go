package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestChangePasswordWithWrappedSkUser(t *testing.T) {
	requireRecoveryStack(t)
	db := setupTestDB(t)
	defer db.Close()

	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
	ownerToken := createTestSession(t, db, ownerID)
	_, mailboxID := createTestMailbox(t, db, orgID, ownerID, "cp-with-wsk")

	initialWsk := `{"salt":"initial_salt","envelope":"initial_envelope"}`
	if _, err := db.Exec(`UPDATE mailboxes SET wrapped_sk_user=$1 WHERE id=$2`, initialWsk, mailboxID); err != nil {
		t.Fatalf("failed setting initial wrapped_sk_user: %v", err)
	}

	newPassword := "new-strong-pass-123"
	newWsk := `{"salt":"newsalt","envelope":"newenv","root_wrapped":"root"}`
	reqPayload := map[string]string{
		"new_password":    newPassword,
		"wrapped_sk_user": newWsk,
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

func TestChangePasswordWithoutWrappedSkUser(t *testing.T) {
	requireRecoveryStack(t)
	db := setupTestDB(t)
	defer db.Close()

	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
	ownerToken := createTestSession(t, db, ownerID)
	_, mailboxID := createTestMailbox(t, db, orgID, ownerID, "cp-no-wsk")

	initialWsk := `{"salt":"initial_salt","envelope":"initial_envelope"}`
	if _, err := db.Exec(`UPDATE mailboxes SET wrapped_sk_user=$1 WHERE id=$2`, initialWsk, mailboxID); err != nil {
		t.Fatalf("failed setting initial wrapped_sk_user: %v", err)
	}

	newPassword := "brand-new-pass-456"
	reqPayload := map[string]string{
		"new_password": newPassword,
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
	if storedWsk != initialWsk {
		t.Fatalf("stored wrapped_sk_user = %q, want preserved %q", storedWsk, initialWsk)
	}
}

func TestChangePasswordInvalidWrappedSkUser(t *testing.T) {
	requireRecoveryStack(t)
	db := setupTestDB(t)
	defer db.Close()

	_, ownerID, _, _ := createTestOrgAndUsers(t, db)
	ownerToken := createTestSession(t, db, ownerID)

	reqPayload := map[string]string{
		"new_password":    "valid-pass-789",
		"wrapped_sk_user": "not-a-valid-json-object",
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
