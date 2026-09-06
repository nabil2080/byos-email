package main

import (
	"bytes"
	"database/sql"
	_ "github.com/jackc/pgx/v5/stdlib"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

const testDSN = "postgres://byos:byos_dev_password@127.0.0.1:5432/byos?sslmode=disable"

func setupTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("pgx", testDSN)
	if err != nil {
		t.Fatalf("failed to open database: %v", err)
	}
	if err := db.Ping(); err != nil {
		db.Close()
		t.Fatalf("failed to ping database: %v", err)
	}
	// Truncate tables to ensure clean state for each test
	_, err = db.Exec(`TRUNCATE organizations, users, domains, mailboxes, aliases, devices, device_mailbox_access, org_recovery_principals, storage_connections, mailbox_storage, message_metadata, search_index, scheduled_messages, outbound_queue, auto_reply_rules, delivery_log, audit_log, drafts CASCADE`)
	if err != nil {
		db.Close()
		t.Fatalf("failed to truncate tables: %v", err)
	}
	return db
}

// createTestOrgAndUsers creates a test organization with owner, admin, and member users.
// Returns the IDs of the created organization and users.
func createTestOrgAndUsers(t *testing.T, db *sql.DB) (orgID, ownerID, adminID, memberID string) {
	t.Helper()
	var orgIDVal, ownerIDVal, adminIDVal, memberIDVal string

	// Insert organization
	err := db.QueryRow(`
		INSERT INTO organizations (name, org_recovery_pk)
		VALUES ('Test Org', decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'))
		RETURNING id
	`).Scan(&orgIDVal)
	if err != nil {
		t.Fatalf("failed to insert org: %v", err)
	}
	orgID = orgIDVal

	// Insert owner user
	err = db.QueryRow(`
		INSERT INTO users (org_id, email, display_name, password_hash, is_active, role)
		VALUES ($1, 'owner@byos.local', 'Owner', '$2a$10$dummyhashdummyhashdummyhashdummyhashdummyhas', true, 'owner')
		RETURNING id
	`, orgIDVal).Scan(&ownerIDVal)
	if err != nil {
		t.Fatalf("failed to insert owner: %v", err)
	}
	ownerID = ownerIDVal

	// Insert admin user
	err = db.QueryRow(`
		INSERT INTO users (org_id, email, display_name, password_hash, is_active, role)
		VALUES ($1, 'admin@byos.local', 'Admin', '$2a$10$dummyhashdummyhashdummyhashdummyhashdummyhas', true, 'admin')
		RETURNING id
	`, orgIDVal).Scan(&adminIDVal)
	if err != nil {
		t.Fatalf("failed to insert admin: %v", err)
	}
	adminID = adminIDVal

	// Insert member user
	err = db.QueryRow(`
		INSERT INTO users (org_id, email, display_name, password_hash, is_active, role)
		VALUES ($1, 'member@byos.local', 'Member', '$2a$10$dummyhashdummyhashdummyhashdummyhashdummyhas', true, 'member')
		RETURNING id
	`, orgIDVal).Scan(&memberIDVal)
	if err != nil {
		t.Fatalf("failed to insert member: %v", err)
	}
	memberID = memberIDVal

	return orgID, ownerID, adminID, memberID
}

// createSession creates a session for the given user and returns the session token.
func createSession(t *testing.T, db *sql.DB, userID string) string {
	t.Helper()
	token, tokenHash := generateSessionToken()
	expires := time.Now().Add(30 * 24 * time.Hour)
	_, err := db.Exec(`INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`, userID, tokenHash, expires)
	if err != nil {
		t.Fatalf("failed to create session: %v", err)
	}
	return token
}

// TestMemberCannotChangeRole tests that a Member user cannot change another member's role.
// This exercises the actual authorization path through changeMemberRoleHandler.
func TestMemberCannotChangeRole(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	_, _, _, memberID := createTestOrgAndUsers(t, db)

	// Login as member and get session token
	memberToken := createSession(t, db, memberID)

	// Create request as member trying to change another member's role
	req := httptest.NewRequest(http.MethodPatch, "/v1/auth/change-member-role", bytes.NewReader([]byte(`{"target_user_id":"test","new_role":"admin"}`)))
	req.Header.Set("X-User-Id", memberID)
	// Set the session cookie
	cookie := http.Cookie{
		Name:  "byos_session",
		Value: memberToken,
		Path:  "/",
	}
	req.AddCookie(&cookie)

	w := httptest.NewRecorder()
	changeMemberRoleHandler(w, req)

	// Member should not be able to change roles (only Owner can)
	if w.Code != http.StatusForbidden {
		t.Errorf("expected forbidden (403) for member changing role, got %d: %s", w.Code, w.Body.String())
	}
	t.Logf("TestMemberCannotChangeRole: member got %d as expected (403 Forbidden)", w.Code)
}

// TestOwnerCannotSelfDemote tests that an Owner cannot demote themselves to 'admin' or 'member'.
// This exercises the actual authorization path in changeMemberRoleHandler.
func TestOwnerCannotSelfDemote(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	_, ownerID, _, _ := createTestOrgAndUsers(t, db)

	// Login as owner and get session token
	ownerToken := createSession(t, db, ownerID)

	// Create request as owner trying to demote themselves
	req := httptest.NewRequest(http.MethodPatch, "/v1/auth/change-member-role", bytes.NewReader([]byte(`{"target_user_id":"`+ownerID+`","new_role":"admin"}`)))
	req.Header.Set("X-User-Id", ownerID)
	cookie := http.Cookie{
		Name:  "byos_session",
		Value: ownerToken,
		Path:  "/",
	}
	req.AddCookie(&cookie)

	w := httptest.NewRecorder()
	changeMemberRoleHandler(w, req)

	// Owner should not be able to self-demote
	// Handler returns 400 "cannot demote yourself to non-owner role" (correct behavior)
	if w.Code != http.StatusForbidden && w.Code != http.StatusBadRequest {
		t.Errorf("expected forbidden (403) or bad request (400) for owner self-demote, got %d: %s", w.Code, w.Body.String())
	}
	t.Logf("TestOwnerCannotSelfDemote: owner got %d as expected (403 Forbidden or 400 Bad Request)", w.Code)
}

// TestOwnerCannotSelfTerminate tests that an Owner cannot terminate themselves.
// This exercises the actual authorization path in terminateUserHandler.
func TestOwnerCannotSelfTerminate(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	_, ownerID, _, _ := createTestOrgAndUsers(t, db)

	// Login as owner and get session token
	ownerToken := createSession(t, db, ownerID)

	// Create request as owner trying to terminate themselves
	req := httptest.NewRequest(http.MethodDelete, "/v1/auth/terminate-user", bytes.NewReader([]byte(`{"target_user_id":"`+ownerID+`","reason":"test"}`)))
	req.Header.Set("X-User-Id", ownerID)
	cookie := http.Cookie{
		Name:  "byos_session",
		Value: ownerToken,
		Path:  "/",
	}
	req.AddCookie(&cookie)

	w := httptest.NewRecorder()
	terminateUserHandler(w, req)

	// Owner should not be able to self-terminate
	// Handler returns 400 "cannot terminate yourself" (correct behavior)
	if w.Code != http.StatusForbidden && w.Code != http.StatusBadRequest {
		t.Errorf("expected forbidden (403) or bad request (400) for owner self-terminate, got %d: %s", w.Code, w.Body.String())
	}
	t.Logf("TestOwnerCannotSelfTerminate: owner got %d as expected (403 Forbidden or 400 Bad Request)", w.Code)
}

// TestAdminCannotChangeRole tests that an Admin user cannot change another member's role.
// Under the resolved canonical policy, Admin MUST NOT be able to change roles
// (only Owner can). This test verifies that behavior.
func TestAdminCannotChangeRole(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	_, _, adminID, _ := createTestOrgAndUsers(t, db)

	// Login as admin and get session token
	adminToken := createSession(t, db, adminID)

	// Create request as admin trying to change member's role
	req := httptest.NewRequest(http.MethodPatch, "/v1/auth/change-member-role", bytes.NewReader([]byte(`{"target_user_id":"test","new_role":"member"}`)))
	req.Header.Set("X-User-Id", adminID)
	cookie := http.Cookie{
		Name:  "byos_session",
		Value: adminToken,
		Path:  "/",
	}
	req.AddCookie(&cookie)

	w := httptest.NewRecorder()
	changeMemberRoleHandler(w, req)

	// Admin should not be able to change roles (only Owner can)
	if w.Code != http.StatusForbidden {
		t.Errorf("expected forbidden (403) for admin changing role, got %d: %s", w.Code, w.Body.String())
	}
	t.Logf("TestAdminCannotChangeRole: admin got %d as expected (403 Forbidden)", w.Code)
}

// TestAdminCannotTerminate tests that an Admin user cannot terminate another user.
// Under the resolved canonical policy, Admin MUST NOT be able to terminate users
// (only Owner can). This test verifies that behavior.
func TestAdminCannotTerminate(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	_, _, adminID, _ := createTestOrgAndUsers(t, db)

	// Login as admin and get session token
	adminToken := createSession(t, db, adminID)

	// Create request as admin trying to terminate a member
	req := httptest.NewRequest(http.MethodDelete, "/v1/auth/terminate-user", bytes.NewReader([]byte(`{"target_user_id":"test","reason":"test"}`)))
	req.Header.Set("X-User-Id", adminID)
	cookie := http.Cookie{
		Name:  "byos_session",
		Value: adminToken,
		Path:  "/",
	}
	req.AddCookie(&cookie)

	w := httptest.NewRecorder()
	terminateUserHandler(w, req)

	// Admin should not be able to terminate users (only Owner can)
	if w.Code != http.StatusForbidden {
		t.Errorf("expected forbidden (403) for admin terminating user, got %d: %s", w.Code, w.Body.String())
	}
	t.Logf("TestAdminCannotTerminate: admin got %d as expected (403 Forbidden)", w.Code)
}

// TestMemberCannotTerminate tests that a Member user cannot terminate another user.
func TestMemberCannotTerminate(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	_, _, _, memberID := createTestOrgAndUsers(t, db)

	// Login as member and get session token
	memberToken := createSession(t, db, memberID)

	// Create request as member trying to terminate another user
	req := httptest.NewRequest(http.MethodDelete, "/v1/auth/terminate-user", bytes.NewReader([]byte(`{"target_user_id":"test","reason":"test"}`)))
	req.Header.Set("X-User-Id", memberID)
	cookie := http.Cookie{
		Name:  "byos_session",
		Value: memberToken,
		Path:  "/",
	}
	req.AddCookie(&cookie)

	w := httptest.NewRecorder()
	terminateUserHandler(w, req)

	// Member should not be able to terminate users
	if w.Code != http.StatusForbidden {
		t.Errorf("expected forbidden (403) for member terminating user, got %d: %s", w.Code, w.Body.String())
	}
	t.Logf("TestMemberCannotTerminate: member got %d as expected (403 Forbidden)", w.Code)
}
