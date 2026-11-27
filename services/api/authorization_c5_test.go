package main

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/google/uuid"
)

// helper to create a verified domain and user-owned mailbox
func createC5TestUserMailbox(t *testing.T, db *sql.DB, orgID, userID string) (domainID, mailboxID string) {
	t.Helper()
	tag := uuid.New().String()
	err := db.QueryRow(`
		INSERT INTO domains (org_id, name, is_verified)
		VALUES ($1, $2, true)
		RETURNING id
	`, orgID, "c5-"+tag+".local").Scan(&domainID)
	if err != nil {
		t.Fatalf("failed to insert domain: %v", err)
	}

	err = db.QueryRow(`
		INSERT INTO mailboxes (org_id, domain_id, user_id, local_part, mode, is_active)
		VALUES ($1, $2, $3, $4, 'private', true)
		RETURNING id
	`, orgID, domainID, userID, "user-"+tag).Scan(&mailboxID)
	if err != nil {
		t.Fatalf("failed to insert mailbox: %v", err)
	}

	t.Cleanup(func() {
		cleanupDB, err := sql.Open("pgx", testDSN)
		if err != nil {
			return
		}
		defer cleanupDB.Close()
		_, _ = cleanupDB.Exec(`DELETE FROM mailbox_folders WHERE mailbox_id = $1`, mailboxID)
		_, _ = cleanupDB.Exec(`DELETE FROM mailbox_labels WHERE mailbox_id = $1`, mailboxID)
		_, _ = cleanupDB.Exec(`DELETE FROM aliases WHERE mailbox_id = $1`, mailboxID)
		_, _ = cleanupDB.Exec(`DELETE FROM contacts WHERE mailbox_id = $1`, mailboxID)
		_, _ = cleanupDB.Exec(`DELETE FROM mailboxes WHERE id = $1`, mailboxID)
		_, _ = cleanupDB.Exec(`DELETE FROM domains WHERE id = $1`, domainID)
	})

	return domainID, mailboxID
}

// buildC5Router instantiates the test mux with security headers & CORS wrapping.
func buildC5Router() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("/v1/organizations/{org_id}/domains", withSecurityHeaders(withCORS(domainsHandler)))
	mux.HandleFunc("/v1/organizations/{org_id}/domains/{domain_id}/verify", withSecurityHeaders(withCORS(domainVerifyHandler)))
	mux.HandleFunc("/v1/domains", withSecurityHeaders(withCORS(domainsHandler)))
	mux.HandleFunc("/v1/domains/{domain_id}/verify", withSecurityHeaders(withCORS(domainVerifyHandler)))
	mux.HandleFunc("/v1/organizations/{org_id}/aliases", withSecurityHeaders(withCORS(organizationAliasesHandler)))

	mux.HandleFunc("/v1/mailboxes/{mailbox_id}", withSecurityHeaders(withCORS(mailboxGetHandler)))
	mux.HandleFunc("/v1/mailboxes/{mailbox_id}/messages", withSecurityHeaders(withCORS(messagesHandler)))
	mux.HandleFunc("/v1/mailboxes/{mailbox_id}/messages/{message_id}", withSecurityHeaders(withCORS(messageItemHandler)))
	mux.HandleFunc("/v1/mailboxes/{mailbox_id}/messages/{message_id}/body", withSecurityHeaders(withCORS(messageBodyHandler)))
	mux.HandleFunc("/v1/mailboxes/{mailbox_id}/folders", withSecurityHeaders(withCORS(mailboxFoldersHandler)))
	mux.HandleFunc("/v1/mailboxes/{mailbox_id}/labels", withSecurityHeaders(withCORS(mailboxLabelsHandler)))
	mux.HandleFunc("/v1/mailboxes/{mailbox_id}/contacts", withSecurityHeaders(withCORS(contactsHandler)))
	mux.HandleFunc("/v1/mailboxes/{mailbox_id}/contacts/export", withSecurityHeaders(withCORS(contactsExportHandler)))
	mux.HandleFunc("/v1/mailboxes/{mailbox_id}/aliases", withSecurityHeaders(withCORS(mailboxAliasesHandler)))
	mux.HandleFunc("/v1/mailboxes/{mailbox_id}/storage/store", withSecurityHeaders(withCORS(mailboxStorageStoreHandler)))
	mux.HandleFunc("/v1/mailboxes/{mailbox_id}/storage/retrieve", withSecurityHeaders(withCORS(mailboxStorageRetrieveHandler)))
	mux.HandleFunc("/v1/mailboxes/{mailbox_id}/storage/list", withSecurityHeaders(withCORS(mailboxStorageListHandler)))
	mux.HandleFunc("/v1/mailboxes/{mailbox_id}/storage/delete", withSecurityHeaders(withCORS(mailboxStorageDeleteHandler)))
	mux.HandleFunc("/v1/internal/contacts/migrate", withSecurityHeaders(withCORS(internalContactMigrationHandler)))
	return mux
}

// TestC5_CrossMailboxIsolation verifies that Alice cannot read, list, create, or modify
// any resource belonging to Bob (same org) or Charlie (other org).
func TestC5_CrossMailboxIsolation(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	// Org A: Alice (member) and Bob (member)
	orgA, _, _, memberA := createTestOrgAndUsers(t, db)
	_ = orgA
	aliceID := memberA
	_, aliceMailboxID := createC5TestUserMailbox(t, db, orgA, aliceID)
	aliceToken := createTestSession(t, db, aliceID)

	// Create Bob user in Org A
	tagB := uuid.New().String()
	var bobID string
	err := db.QueryRow(`
		INSERT INTO users (org_id, email, display_name, password_hash, is_active, role)
		VALUES ($1, $2, 'Bob', '$2a$10$dummyhashdummyhashdummyhashdummyhashdummyhas', true, 'member')
		RETURNING id
	`, orgA, "bob-"+tagB+"@byos.local").Scan(&bobID)
	if err != nil {
		t.Fatalf("failed to insert Bob: %v", err)
	}
	_, bobMailboxID := createC5TestUserMailbox(t, db, orgA, bobID)

	// Org B: Charlie
	orgB, ownerB, _, _ := createTestOrgAndUsers(t, db)
	charlieID := ownerB
	_, charlieMailboxID := createC5TestUserMailbox(t, db, orgB, charlieID)

	mux := buildC5Router()

	endpoints := []struct {
		name   string
		method string
		pathFn func(mbID string) string
		bodyFn func(mbID string) []byte
	}{
		{
			name:   "Mailbox Detail",
			method: http.MethodGet,
			pathFn: func(mbID string) string { return "/v1/mailboxes/" + mbID },
		},
		{
			name:   "Messages List",
			method: http.MethodGet,
			pathFn: func(mbID string) string { return "/v1/mailboxes/" + mbID + "/messages" },
		},
		{
			name:   "Delete Message",
			method: http.MethodDelete,
			pathFn: func(mbID string) string { return "/v1/mailboxes/" + mbID + "/messages/" + uuid.NewString() },
		},
		{
			name:   "Message Body",
			method: http.MethodGet,
			pathFn: func(mbID string) string { return "/v1/mailboxes/" + mbID + "/messages/" + uuid.NewString() + "/body" },
		},
		{
			name:   "Folders List",
			method: http.MethodGet,
			pathFn: func(mbID string) string { return "/v1/mailboxes/" + mbID + "/folders" },
		},
		{
			name:   "Create Folder",
			method: http.MethodPost,
			pathFn: func(mbID string) string { return "/v1/mailboxes/" + mbID + "/folders" },
			bodyFn: func(mbID string) []byte { return []byte(`{"name":"HackedFolder"}`) },
		},
		{
			name:   "Labels List",
			method: http.MethodGet,
			pathFn: func(mbID string) string { return "/v1/mailboxes/" + mbID + "/labels" },
		},
		{
			name:   "Contacts List",
			method: http.MethodGet,
			pathFn: func(mbID string) string { return "/v1/mailboxes/" + mbID + "/contacts" },
		},
		{
			name:   "Contacts Export",
			method: http.MethodGet,
			pathFn: func(mbID string) string { return "/v1/mailboxes/" + mbID + "/contacts/export" },
		},
		{
			name:   "Mailbox Aliases List",
			method: http.MethodGet,
			pathFn: func(mbID string) string { return "/v1/mailboxes/" + mbID + "/aliases" },
		},
		{
			name:   "Storage List",
			method: http.MethodGet,
			pathFn: func(mbID string) string { return "/v1/mailboxes/" + mbID + "/storage/list" },
		},
	}

	for _, ep := range endpoints {
		t.Run(ep.name+"_Bob_SameOrg_Rejected", func(t *testing.T) {
			var body *bytes.Buffer
			if ep.bodyFn != nil {
				body = bytes.NewBuffer(ep.bodyFn(bobMailboxID))
			} else {
				body = bytes.NewBuffer(nil)
			}
			req := httptest.NewRequest(ep.method, ep.pathFn(bobMailboxID), body)
			req.Header.Set("Authorization", "Bearer "+aliceToken)
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, req)

			if rec.Code != http.StatusForbidden && rec.Code != http.StatusNotFound {
				t.Fatalf("expected 403 or 404 for cross-mailbox access to Bob, got %d: %s", rec.Code, rec.Body.String())
			}
		})

		t.Run(ep.name+"_Charlie_CrossOrg_Rejected", func(t *testing.T) {
			var body *bytes.Buffer
			if ep.bodyFn != nil {
				body = bytes.NewBuffer(ep.bodyFn(charlieMailboxID))
			} else {
				body = bytes.NewBuffer(nil)
			}
			req := httptest.NewRequest(ep.method, ep.pathFn(charlieMailboxID), body)
			req.Header.Set("Authorization", "Bearer "+aliceToken)
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()
			mux.ServeHTTP(rec, req)

			if rec.Code != http.StatusForbidden && rec.Code != http.StatusNotFound {
				t.Fatalf("expected 403 or 404 for cross-org mailbox access to Charlie, got %d: %s", rec.Code, rec.Body.String())
			}
		})
	}

	// Verify Alice can successfully access her own mailbox resources
	t.Run("Alice_OwnMailbox_Succeeds", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/v1/mailboxes/"+aliceMailboxID+"/folders", nil)
		req.Header.Set("Authorization", "Bearer "+aliceToken)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 for Alice accessing own mailbox, got %d: %s", rec.Code, rec.Body.String())
		}
	})
}

// TestC5_RoleEnforcement_Domains verifies that only org owner/admin can create and verify domains.
func TestC5_RoleEnforcement_Domains(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	orgID, ownerID, adminID, memberID := createTestOrgAndUsers(t, db)
	ownerToken := createTestSession(t, db, ownerID)
	adminToken := createTestSession(t, db, adminID)
	memberToken := createTestSession(t, db, memberID)

	mux := buildC5Router()

	// 1. Member cannot create domain
	t.Run("Member_CannotCreateDomain", func(t *testing.T) {
		body := bytes.NewBuffer([]byte(`{"domain":"member-denied.local"}`))
		req := httptest.NewRequest(http.MethodPost, "/v1/organizations/"+orgID+"/domains", body)
		req.Header.Set("Authorization", "Bearer "+memberToken)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		if rec.Code != http.StatusForbidden {
			t.Fatalf("expected 403 Forbidden for member creating domain, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	// 2. Admin can create domain
	var createdDomainID string
	t.Run("Admin_CanCreateDomain", func(t *testing.T) {
		domainName := "admin-ok-" + uuid.NewString()[:8] + ".local"
		body := bytes.NewBuffer([]byte(`{"domain":"` + domainName + `"}`))
		req := httptest.NewRequest(http.MethodPost, "/v1/organizations/"+orgID+"/domains", body)
		req.Header.Set("Authorization", "Bearer "+adminToken)
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		if rec.Code != http.StatusCreated {
			t.Fatalf("expected 201 Created for admin creating domain, got %d: %s", rec.Code, rec.Body.String())
		}
		var resp struct {
			ID string `json:"id"`
		}
		json.Unmarshal(rec.Body.Bytes(), &resp)
		createdDomainID = resp.ID
	})

	// 3. Member cannot verify domain
	t.Run("Member_CannotVerifyDomain", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/v1/organizations/"+orgID+"/domains/"+createdDomainID+"/verify", nil)
		req.Header.Set("Authorization", "Bearer "+memberToken)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		if rec.Code != http.StatusForbidden {
			t.Fatalf("expected 403 Forbidden for member verifying domain, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	// 4. Owner can verify domain
	t.Run("Owner_CanVerifyDomain", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/v1/organizations/"+orgID+"/domains/"+createdDomainID+"/verify", nil)
		req.Header.Set("Authorization", "Bearer "+ownerToken)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		// Verification will execute (200 OK or 400 if DNS record not found, but NOT 403 Forbidden)
		if rec.Code == http.StatusForbidden {
			t.Fatalf("owner should not be forbidden from verifying domain, got 403: %s", rec.Body.String())
		}
	})

	// 5. Member CAN list domains (read-only)
	t.Run("Member_CanListDomains", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/v1/organizations/"+orgID+"/domains", nil)
		req.Header.Set("Authorization", "Bearer "+memberToken)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 OK for member listing domains, got %d: %s", rec.Code, rec.Body.String())
		}
	})
}

// TestC5_RoleEnforcement_OrganizationAliases verifies that only admins/owners can view org aliases.
func TestC5_RoleEnforcement_OrganizationAliases(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	orgID, ownerID, adminID, memberID := createTestOrgAndUsers(t, db)
	adminToken := createTestSession(t, db, adminID)
	memberToken := createTestSession(t, db, memberID)
	_ = ownerID

	mux := buildC5Router()

	t.Run("Member_CannotListOrgAliases", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/v1/organizations/"+orgID+"/aliases", nil)
		req.Header.Set("Authorization", "Bearer "+memberToken)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		if rec.Code != http.StatusForbidden {
			t.Fatalf("expected 403 Forbidden for member listing org aliases, got %d: %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("Admin_CanListOrgAliases", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/v1/organizations/"+orgID+"/aliases", nil)
		req.Header.Set("Authorization", "Bearer "+adminToken)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 OK for admin listing org aliases, got %d: %s", rec.Code, rec.Body.String())
		}
	})
}

// TestC5_ActiveMailboxHeaderProtection verifies selector mismatch attacks are rejected.
func TestC5_ActiveMailboxHeaderProtection(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mb1 := createC5TestUserMailbox(t, db, orgID, ownerID)
	_, mb2 := createC5TestUserMailbox(t, db, orgID, ownerID)
	token := createTestSession(t, db, ownerID)

	mux := buildC5Router()

	req := httptest.NewRequest(http.MethodGet, "/v1/mailboxes/"+mb1+"/folders", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("X-BYOS-Active-Mailbox", mb2) // mismatch!
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for active mailbox selector mismatch, got %d: %s", rec.Code, rec.Body.String())
	}
}

// TestC5_InternalServiceKeyEnforcement tests internal authentication boundaries.
func TestC5_InternalServiceKeyEnforcement(t *testing.T) {
	mux := buildC5Router()

	// 1. Without internal key fails closed
	t.Run("MissingKey_FailsClosed", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/v1/internal/contacts/migrate", nil)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		if rec.Code != http.StatusForbidden && rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 403 or 401 for missing internal key, got %d", rec.Code)
		}
	})

	// 2. Invalid internal key fails closed
	t.Run("InvalidKey_FailsClosed", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/v1/internal/contacts/migrate", nil)
		req.Header.Set("X-Internal-Key", "forged-invalid-key-value")
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)

		if rec.Code != http.StatusForbidden && rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 403 or 401 for invalid internal key, got %d", rec.Code)
		}
	})

	// 3. Constant-time verification helper unit check
	t.Run("ConstantTimeCompare_UnitBehavior", func(t *testing.T) {
		os.Setenv("MIGRATION_INTERNAL_KEY", "super-secret-migration-token-42")
		defer os.Unsetenv("MIGRATION_INTERNAL_KEY")

		validReq := httptest.NewRequest(http.MethodPost, "/", nil)
		validReq.Header.Set("X-Internal-Key", "super-secret-migration-token-42")
		if !verifyInternalServiceAuth(validReq, "migration") {
			t.Fatal("expected verifyInternalServiceAuth to succeed for matching migration key")
		}

		wrongReq := httptest.NewRequest(http.MethodPost, "/", nil)
		wrongReq.Header.Set("X-Internal-Key", "super-secret-migration-token-wrong")
		if verifyInternalServiceAuth(wrongReq, "migration") {
			t.Fatal("expected verifyInternalServiceAuth to fail for mismatched migration key")
		}

		serviceMismatchReq := httptest.NewRequest(http.MethodPost, "/", nil)
		serviceMismatchReq.Header.Set("X-Internal-Key", "super-secret-migration-token-42")
		if verifyInternalServiceAuth(serviceMismatchReq, "storage") {
			t.Fatal("expected verifyInternalServiceAuth to fail when requiredService differs")
		}
	})
}

// TestC5_MailboxProbeElimination verifies that unauthorized callers cannot distinguish
// between non-existent mailboxes and foreign-tenant mailboxes via status code leakage.
func TestC5_MailboxProbeElimination(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	orgA, ownerA, _, _ := createTestOrgAndUsers(t, db)
	_ = orgA
	orgB, ownerB, _, _ := createTestOrgAndUsers(t, db)

	aliceToken := createTestSession(t, db, ownerA)
	_, bobMailboxID := createC5TestUserMailbox(t, db, orgB, ownerB)
	nonExistentMailboxID := uuid.NewString()

	mux := buildC5Router()

	// Probing foreign mailbox
	reqForeign := httptest.NewRequest(http.MethodGet, "/v1/mailboxes/"+bobMailboxID, nil)
	reqForeign.Header.Set("Authorization", "Bearer "+aliceToken)
	recForeign := httptest.NewRecorder()
	mux.ServeHTTP(recForeign, reqForeign)

	// Probing non-existent mailbox
	reqNonExistent := httptest.NewRequest(http.MethodGet, "/v1/mailboxes/"+nonExistentMailboxID, nil)
	reqNonExistent.Header.Set("Authorization", "Bearer "+aliceToken)
	recNonExistent := httptest.NewRecorder()
	mux.ServeHTTP(recNonExistent, reqNonExistent)

	// Both must be rejected with 403 Forbidden (fail closed, no probe leakage)
	if recForeign.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for probing foreign mailbox, got %d", recForeign.Code)
	}
	if recNonExistent.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for probing non-existent mailbox as unauthorized caller, got %d", recNonExistent.Code)
	}
}

// TestC5_PropertyLevelAuthorization_MassAssignment tests that JSON updates cannot inject
// unauthorized properties such as role, org_id, is_active, or user_id.
func TestC5_PropertyLevelAuthorization_MassAssignment(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	orgA, _, _, memberA := createTestOrgAndUsers(t, db)
	_ = orgA
	_, mbA := createC5TestUserMailbox(t, db, orgA, memberA)
	tokenA := createTestSession(t, db, memberA)

	mux := buildC5Router()

	// 1. Attempting mass-assignment on folder creation: injecting mailbox_id or org_id
	fakeMailboxID := uuid.NewString()
	payload := []byte(`{
		"name": "AuditFolder",
		"mailbox_id": "` + fakeMailboxID + `",
		"org_id": "` + fakeMailboxID + `",
		"role": "admin",
		"is_active": false
	}`)

	req := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mbA+"/folders", bytes.NewBuffer(payload))
	req.Header.Set("Authorization", "Bearer "+tokenA)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created for valid folder creation, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp struct {
		ID        string `json:"id"`
		MailboxID string `json:"mailbox_id"`
		Name      string `json:"name"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	// Verify server ignored injected mailbox_id and bound strictly to URL path mbA
	if resp.MailboxID != mbA {
		t.Fatalf("mass-assignment exploit succeeded: folder mailbox_id bound to %s instead of %s", resp.MailboxID, mbA)
	}

	// Verify database record has not been corrupted
	var dbMailboxID string
	err := db.QueryRow(`SELECT mailbox_id::text FROM mailbox_folders WHERE id=$1`, resp.ID).Scan(&dbMailboxID)
	if err != nil || dbMailboxID != mbA {
		t.Fatalf("database verification failed: expected folder mailbox_id %s, got %s (err: %v)", mbA, dbMailboxID, err)
	}

	// Verify member role has NOT been escalated
	var memberRole string
	err = db.QueryRow(`SELECT role FROM users WHERE id=$1`, memberA).Scan(&memberRole)
	if err != nil || memberRole != "member" {
		t.Fatalf("privilege escalation detected: user role became %s instead of member", memberRole)
	}
}
