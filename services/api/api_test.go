package main

import (
	"bytes"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
)

var testDSN string

// validateTestDSNString parses and enforces safety checks on database DSNs for integration tests:
// 1. Explicit DSN is required.
// 2. Refuses development database 'byos' by default unless allowDevDB is true.
// 3. Refuses non-local/production-like hosts unless allowRemote is true.
func validateTestDSNString(rawURL string, allowRemote, allowDevDB bool) (dbName, host string, err error) {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return "", "", errors.New("TEST_DATABASE_URL is not set")
	}

	u, err := url.Parse(rawURL)
	if err != nil {
		return "", "", fmt.Errorf("invalid TEST_DATABASE_URL: %w", err)
	}

	// Host validation: refuse production-like hosts unless explicitly allowed
	host = u.Hostname()
	allowedHosts := map[string]bool{
		"localhost":     true,
		"127.0.0.1":     true,
		"::1":           true,
		"postgres":      true,
		"byos-postgres": true,
	}
	if !allowedHosts[host] && !allowRemote {
		return "", "", fmt.Errorf("SAFETY VIOLATION: Refusing to run tests against non-local host '%s' (set BYOS_ALLOW_REMOTE_TEST_DB=true to override)", host)
	}

	// Database name validation: refuse 'byos' by default
	dbName = strings.TrimPrefix(u.Path, "/")
	if strings.EqualFold(dbName, "byos") && !allowDevDB {
		return "", "", fmt.Errorf("SAFETY VIOLATION: Refusing to run tests against development database '%s' (set BYOS_ALLOW_DEV_DB_TEST=true to override)", dbName)
	}

	return dbName, host, nil
}

// getValidatedTestDSN validates that integration tests do not silently default to
// the real development database 'byos' or production-like hosts without explicit safeguard overrides.
func getValidatedTestDSN(t *testing.T) string {
	t.Helper()
	rawURL := strings.TrimSpace(os.Getenv("TEST_DATABASE_URL"))
	if rawURL == "" {
		t.Skip("skipping database integration test: TEST_DATABASE_URL environment variable is not set")
		return ""
	}

	allowRemote := os.Getenv("BYOS_ALLOW_REMOTE_TEST_DB") == "true"
	allowDevDB := os.Getenv("BYOS_ALLOW_DEV_DB_TEST") == "true"
	dbName, host, err := validateTestDSNString(rawURL, allowRemote, allowDevDB)
	if err != nil {
		t.Fatalf("%v", err)
	}

	t.Logf("[test-db] Using test database '%s' on host '%s'", dbName, host)
	t.Setenv("DATABASE_URL", rawURL)
	testDSN = rawURL
	return rawURL
}

func setupTestDB(t *testing.T) *sql.DB {
	t.Helper()
	dsn := getValidatedTestDSN(t)
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatalf("failed to open database: %v", err)
	}
	if err := db.Ping(); err != nil {
		db.Close()
		t.Fatalf("failed to ping database: %v", err)
	}
	return db
}

// createTestOrgAndUsers creates a test organization with owner, admin, and member users.
// Returns the IDs of the created organization and users.
func createTestOrgAndUsers(t *testing.T, db *sql.DB) (orgID, ownerID, adminID, memberID string) {
	t.Helper()
	var orgIDVal, ownerIDVal, adminIDVal, memberIDVal string
	tag := uuid.New().String()

	// Insert organization
	err := db.QueryRow(`
		INSERT INTO organizations (name, org_recovery_pk)
		VALUES ($1, decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'))
		RETURNING id
	`, "Test Org "+tag).Scan(&orgIDVal)
	if err != nil {
		t.Fatalf("failed to insert org: %v", err)
	}
	orgID = orgIDVal

	// Insert owner user
	err = db.QueryRow(`
		INSERT INTO users (org_id, email, display_name, password_hash, is_active, role)
		VALUES ($1, $2, 'Owner', '$2a$10$dummyhashdummyhashdummyhashdummyhashdummyhas', true, 'owner')
		RETURNING id
	`, orgIDVal, "owner-"+tag+"@byos.local").Scan(&ownerIDVal)
	if err != nil {
		t.Fatalf("failed to insert owner: %v", err)
	}
	ownerID = ownerIDVal

	// Insert admin user
	err = db.QueryRow(`
		INSERT INTO users (org_id, email, display_name, password_hash, is_active, role)
		VALUES ($1, $2, 'Admin', '$2a$10$dummyhashdummyhashdummyhashdummyhashdummyhas', true, 'admin')
		RETURNING id
	`, orgIDVal, "admin-"+tag+"@byos.local").Scan(&adminIDVal)
	if err != nil {
		t.Fatalf("failed to insert admin: %v", err)
	}
	adminID = adminIDVal

	// Insert member user
	err = db.QueryRow(`
		INSERT INTO users (org_id, email, display_name, password_hash, is_active, role)
		VALUES ($1, $2, 'Member', '$2a$10$dummyhashdummyhashdummyhashdummyhashdummyhas', true, 'member')
		RETURNING id
	`, orgIDVal, "member-"+tag+"@byos.local").Scan(&memberIDVal)
	if err != nil {
		t.Fatalf("failed to insert member: %v", err)
	}
	memberID = memberIDVal

	t.Cleanup(func() {
		cleanupDB, err := sql.Open("pgx", testDSN)
		if err != nil {
			t.Errorf("cleanup open: %v", err)
			return
		}
		defer cleanupDB.Close()

		// Delete child records that might not have ON DELETE CASCADE
		_, _ = cleanupDB.Exec(`DELETE FROM scheduled_messages WHERE org_id = $1 OR mailbox_id IN (SELECT id FROM mailboxes WHERE org_id = $1)`, orgIDVal)
		_, _ = cleanupDB.Exec(`DELETE FROM outbound_reservations WHERE user_id IN ($1, $2, $3) OR mailbox_id IN (SELECT id FROM mailboxes WHERE org_id = $4)`, ownerIDVal, adminIDVal, memberIDVal, orgIDVal)
		_, _ = cleanupDB.Exec(`DELETE FROM delivery_log WHERE domain_id IN (SELECT id FROM domains WHERE org_id = $1) OR mailbox_id IN (SELECT id FROM mailboxes WHERE org_id = $1)`, orgIDVal)
		_, _ = cleanupDB.Exec(`DELETE FROM device_mailbox_access WHERE mailbox_id IN (SELECT id FROM mailboxes WHERE org_id = $1)`, orgIDVal)
		_, _ = cleanupDB.Exec(`DELETE FROM search_index WHERE mailbox_id IN (SELECT id FROM mailboxes WHERE org_id = $1)`, orgIDVal)
		_, _ = cleanupDB.Exec(`DELETE FROM auto_reply_rules WHERE mailbox_id IN (SELECT id FROM mailboxes WHERE org_id = $1)`, orgIDVal)
		_, _ = cleanupDB.Exec(`DELETE FROM message_tracking WHERE mailbox_id IN (SELECT id FROM mailboxes WHERE org_id = $1)`, orgIDVal)

		// Collect any root_secrets created for mailboxes in this org
		var rootIDs []string
		rows, err := cleanupDB.Query(`SELECT root_secret_id FROM mailboxes WHERE org_id = $1 AND root_secret_id IS NOT NULL`, orgIDVal)
		if err == nil {
			for rows.Next() {
				var rID string
				if err := rows.Scan(&rID); err == nil {
					rootIDs = append(rootIDs, rID)
				}
			}
			rows.Close()
		}

		// Delete mailboxes, root_secrets, domains
		_, _ = cleanupDB.Exec(`DELETE FROM mailboxes WHERE org_id = $1`, orgIDVal)
		for _, rID := range rootIDs {
			_, _ = cleanupDB.Exec(`DELETE FROM root_secrets WHERE id = $1`, rID)
		}
		_, _ = cleanupDB.Exec(`DELETE FROM domains WHERE org_id = $1`, orgIDVal)

		// Delete users and org
		_, _ = cleanupDB.Exec(`DELETE FROM audit_log WHERE org_id = $1 OR user_id IN (SELECT id FROM users WHERE org_id = $1)`, orgIDVal)
		_, _ = cleanupDB.Exec(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE org_id = $1)`, orgIDVal)
		_, _ = cleanupDB.Exec(`DELETE FROM devices WHERE user_id IN (SELECT id FROM users WHERE org_id = $1)`, orgIDVal)
		_, _ = cleanupDB.Exec(`DELETE FROM users WHERE org_id = $1`, orgIDVal)
		_, _ = cleanupDB.Exec(`DELETE FROM organizations WHERE id = $1`, orgIDVal)
	})

	return orgID, ownerID, adminID, memberID
}

// createTestSession creates a session for the given user and returns the session token.
func createTestSession(t *testing.T, db *sql.DB, userID string) string {
	t.Helper()
	token, tokenHash := generateSessionToken()
	expires := time.Now().Add(30 * 24 * time.Hour)
	_, err := db.Exec(`INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`, userID, tokenHash, expires)
	if err != nil {
		t.Fatalf("failed to create session: %v", err)
	}
	t.Cleanup(func() {
		cleanupDB, err := sql.Open("pgx", testDSN)
		if err != nil {
			t.Errorf("cleanup open: %v", err)
			return
		}
		defer cleanupDB.Close()
		_, _ = cleanupDB.Exec(`DELETE FROM sessions WHERE token_hash = $1`, tokenHash)
	})
	return token
}

// TestMemberCannotChangeRole tests that a Member user cannot change another member's role.
// This exercises the actual authorization path through changeMemberRoleHandler.
func TestMemberCannotChangeRole(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	_, _, _, memberID := createTestOrgAndUsers(t, db)

	// Login as member and get session token
	memberToken := createTestSession(t, db, memberID)

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
	ownerToken := createTestSession(t, db, ownerID)

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
	ownerToken := createTestSession(t, db, ownerID)

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
	adminToken := createTestSession(t, db, adminID)

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
	adminToken := createTestSession(t, db, adminID)

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
	memberToken := createTestSession(t, db, memberID)

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

// TestValidateTestDSNSafeguards verifies that database integration tests refuse
// silent defaults to 'byos' and refuse non-local hosts without explicit safeguards.
func TestValidateTestDSNSafeguards(t *testing.T) {
	// Case 1: Empty DSN is rejected
	_, _, err := validateTestDSNString("", false, false)
	if err == nil || !strings.Contains(err.Error(), "TEST_DATABASE_URL is not set") {
		t.Fatalf("expected error for empty DSN, got: %v", err)
	}

	// Case 2: Development database 'byos' is refused by default
	_, _, err = validateTestDSNString("postgres://byos:password@127.0.0.1:5432/byos?sslmode=disable", false, false)
	if err == nil || !strings.Contains(err.Error(), "SAFETY VIOLATION: Refusing to run tests against development database 'byos'") {
		t.Fatalf("expected refusal of development database 'byos', got: %v", err)
	}

	// Case 3: 'byos' allowed only when explicitly permitted
	dbName, host, err := validateTestDSNString("postgres://byos:password@127.0.0.1:5432/byos?sslmode=disable", false, true)
	if err != nil {
		t.Fatalf("expected success with allowDevDB=true, got: %v", err)
	}
	if dbName != "byos" || host != "127.0.0.1" {
		t.Fatalf("unexpected parsed result: dbName=%s, host=%s", dbName, host)
	}

	// Case 4: Remote/production-like host is refused by default
	_, _, err = validateTestDSNString("postgres://byos:password@production-db.byos.local:5432/disposable_test?sslmode=disable", false, false)
	if err == nil || !strings.Contains(err.Error(), "SAFETY VIOLATION: Refusing to run tests against non-local host 'production-db.byos.local'") {
		t.Fatalf("expected refusal of remote host, got: %v", err)
	}

	// Case 5: Remote host allowed only when explicitly permitted
	dbName, host, err = validateTestDSNString("postgres://byos:password@production-db.byos.local:5432/disposable_test?sslmode=disable", true, false)
	if err != nil {
		t.Fatalf("expected success with allowRemote=true, got: %v", err)
	}
	if dbName != "disposable_test" || host != "production-db.byos.local" {
		t.Fatalf("unexpected parsed result: dbName=%s, host=%s", dbName, host)
	}

	// Case 6: Local disposable test database is accepted
	dbName, host, err = validateTestDSNString("postgres://byos:password@127.0.0.1:5432/byos_test_isolation?sslmode=disable", false, false)
	if err != nil {
		t.Fatalf("expected valid local test DSN to succeed, got: %v", err)
	}
	if dbName != "byos_test_isolation" || host != "127.0.0.1" {
		t.Fatalf("unexpected parsed result: dbName=%s, host=%s", dbName, host)
	}
}

