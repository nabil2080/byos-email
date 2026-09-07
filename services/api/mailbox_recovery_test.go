package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMailboxRecoveryMaterialAuthorizationAndPrivacy(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	orgID, ownerID, _, memberID := createTestOrgAndUsers(t, db)
	var domainID, orgMailboxID, privateMailboxID, orgRootID, privateRootID string
	if err := db.QueryRow(`INSERT INTO domains (org_id, name, is_verified) VALUES ($1, 'recovery.test', true) RETURNING id`, orgID).Scan(&domainID); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`INSERT INTO root_secrets (root_secret_wrapped) VALUES (decode(repeat('11', 81), 'hex')) RETURNING id`).Scan(&orgRootID); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`INSERT INTO root_secrets (root_secret_wrapped) VALUES (NULL) RETURNING id`).Scan(&privateRootID); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`
		INSERT INTO mailboxes (org_id, user_id, domain_id, local_part, mode, root_secret_id, mailbox_sk_wrapped, mailbox_pk)
		VALUES ($1, $2, $3, 'org', 'org_managed', $4, decode(repeat('22', 61), 'hex'), decode(repeat('33', 32), 'hex'))
		RETURNING id
	`, orgID, ownerID, domainID, orgRootID).Scan(&orgMailboxID); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(`
		INSERT INTO mailboxes (org_id, user_id, domain_id, local_part, mode, root_secret_id, mailbox_sk_wrapped, mailbox_pk)
		VALUES ($1, $2, $3, 'private', 'private', $4, decode(repeat('44', 61), 'hex'), decode(repeat('55', 32), 'hex'))
		RETURNING id
	`, orgID, ownerID, domainID, privateRootID).Scan(&privateMailboxID); err != nil {
		t.Fatal(err)
	}

	request := func(userID, mailboxID string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, "/v1/organizations/"+orgID+"/mailboxes/"+mailboxID+"/recovery-material", nil)
		req.SetPathValue("org_id", orgID)
		req.SetPathValue("mailbox_id", mailboxID)
		req.AddCookie(&http.Cookie{Name: "byos_session", Value: createSession(t, db, userID)})
		rec := httptest.NewRecorder()
		mailboxRecoveryMaterialHandler(rec, req)
		return rec
	}

	owner := request(ownerID, orgMailboxID)
	if owner.Code != http.StatusOK || !strings.Contains(owner.Body.String(), "root_secret_wrapped") {
		t.Fatalf("owner org-managed recovery = %d %s", owner.Code, owner.Body.String())
	}
	member := request(memberID, orgMailboxID)
	if member.Code != http.StatusForbidden {
		t.Fatalf("member recovery status = %d, want 403", member.Code)
	}
	private := request(ownerID, privateMailboxID)
	if private.Code != http.StatusForbidden || strings.Contains(private.Body.String(), "root_secret_wrapped") {
		t.Fatalf("private recovery = %d %s", private.Code, private.Body.String())
	}
}
