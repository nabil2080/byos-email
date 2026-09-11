package main

// Root rotation flow tests (require PostgreSQL + Redis via requireRecoveryStack).
// Without the stack they skip; skipped is reported, never counted as passing.

import (
	"bytes"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
)

func rotateRequest(t *testing.T, orgID, mailboxID, body, userToken string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost,
		"/v1/organizations/"+orgID+"/mailboxes/"+mailboxID+"/rotate-root",
		bytes.NewReader([]byte(body)))
	req.SetPathValue("org_id", orgID)
	req.SetPathValue("mailbox_id", mailboxID)
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: userToken})
	rec := httptest.NewRecorder()
	rootRotationHandler(rec, req)
	return rec
}

func insertPrivateMailbox(t *testing.T, db *sql.DB, orgID, userID string) (mailboxID, rootID string) {
	t.Helper()
	uniqueTag := uuid.New().String()
	var domainID string
	if err := db.QueryRow(`INSERT INTO domains (org_id, name, is_verified) VALUES ($1, $2, true) RETURNING id`,
		orgID, "rot-"+uniqueTag+".local").Scan(&domainID); err != nil {
		t.Fatalf("insert domain: %v", err)
	}
	if err := db.QueryRow(`INSERT INTO root_secrets (root_secret_wrapped) VALUES (NULL) RETURNING id`).Scan(&rootID); err != nil {
		t.Fatalf("insert root: %v", err)
	}
	if err := db.QueryRow(`INSERT INTO mailboxes (org_id, user_id, domain_id, local_part, mode, root_secret_id, mailbox_sk_wrapped, mailbox_pk)
		VALUES ($1, $2, $3, $4, 'private', $5, decode('AA==','base64'), decode('AA==','base64'))
		RETURNING id`, orgID, userID, domainID, "rot-private-"+uniqueTag, rootID).Scan(&mailboxID); err != nil {
		t.Fatalf("insert mailbox: %v", err)
	}
	return mailboxID, rootID
}

func TestRootRotationPrivateFlow(t *testing.T) {
	requireRecoveryStack(t)
	db := setupTestDB(t)
	defer db.Close()

	orgID, _, _, memberID := createTestOrgAndUsers(t, db)
	mailboxID, oldRootID := insertPrivateMailbox(t, db, orgID, memberID)

	// Device grant sealed under the old root must die on rotation.
	if _, err := db.Exec(`INSERT INTO devices (user_id, device_name, device_pk) VALUES ($1, 'd', decode('AA==','base64'))`, memberID); err != nil {
		t.Fatal(err)
	}
	var deviceID string
	if err := db.QueryRow(`SELECT id FROM devices WHERE user_id=$1`, memberID).Scan(&deviceID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO device_mailbox_access (device_id, mailbox_id, wrapped_root_secret) VALUES ($1, $2, decode('AA==','base64'))`, deviceID, mailboxID); err != nil {
		t.Fatal(err)
	}

	// Member rotates their OWN private mailbox (no wrap allowed).
	memberToken := createSession(t, db, memberID)
	// A second session simulates a stolen/parallel login: rotation must kill
	// it while the requesting session survives.
	staleToken := createSession(t, db, memberID)
	rec := rotateRequest(t, orgID, mailboxID, `{}`, memberToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("rotate status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	var out struct {
		MailboxID    string `json:"mailbox_id"`
		RootSecretID string `json:"root_secret_id"`
		Version      int    `json:"version"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	if out.Version != 2 || out.RootSecretID == "" || out.RootSecretID == oldRootID {
		t.Fatalf("rotation response = %+v", out)
	}
	var pointer string
	var version int
	if err := db.QueryRow(`SELECT m.root_secret_id::text, r.version
		FROM mailboxes m JOIN root_secrets r ON r.id = m.root_secret_id
		WHERE m.id=$1`, mailboxID).Scan(&pointer, &version); err != nil {
		t.Fatal(err)
	}
	if pointer != out.RootSecretID || version != 2 {
		t.Fatalf("pointer/version not switched: %s v%d", pointer, version)
	}
	var oldRevoked string
	if err := db.QueryRow(`SELECT revoked_at::text FROM root_secrets WHERE id=$1`, oldRootID).Scan(&oldRevoked); err != nil {
		t.Fatalf("old root must be revoked: %v", err)
	}
	var grantActive bool
	if err := db.QueryRow(`SELECT is_active FROM device_mailbox_access WHERE device_id=$1 AND mailbox_id=$2`, deviceID, mailboxID).Scan(&grantActive); err != nil {
		t.Fatal(err)
	}
	if grantActive {
		t.Fatal("old-root device grants must be revoked")
	}
	// Stolen session dies; requesting session lives.
	var staleRevoked *string
	if err := db.QueryRow(`SELECT revoked_at::text FROM sessions WHERE token_hash=$1`, hashToken(staleToken)).Scan(&staleRevoked); err != nil || staleRevoked == nil {
		t.Fatalf("stale session must be revoked: %v", err)
	}
	var currentRevoked *string
	if err := db.QueryRow(`SELECT revoked_at::text FROM sessions WHERE token_hash=$1`, hashToken(memberToken)).Scan(&currentRevoked); err != nil {
		t.Fatal(err)
	}
	if currentRevoked != nil {
		t.Fatal("requesting session must survive rotation")
	}
	// New private root carries no sealed wrap.
	var wrapped []byte
	if err := db.QueryRow(`SELECT root_secret_wrapped FROM root_secrets WHERE id=$1`, out.RootSecretID).Scan(&wrapped); err != nil {
		t.Fatal(err)
	}
	if len(wrapped) != 0 {
		t.Fatal("private rotation must store NULL wrap")
	}
	// Private rotation rejects a supplied wrap.
	if rec := rotateRequest(t, orgID, mailboxID, `{"root_secret_wrapped":"`+hex.EncodeToString(bytes.Repeat([]byte{0x02}, 81))+`"}`, memberToken); rec.Code != http.StatusBadRequest {
		t.Fatalf("private-with-wrap = %d, want 400", rec.Code)
	}
}

func TestRootRotationAuthz(t *testing.T) {
	requireRecoveryStack(t)
	db := setupTestDB(t)
	defer db.Close()

	orgID, ownerID, _, memberID := createTestOrgAndUsers(t, db)
	org2, _, _, _ := createTestOrgWithEmail(t, db, "rot2")
	mailboxID, _ := insertPrivateMailbox(t, db, orgID, memberID)
	ownerToken := createSession(t, db, ownerID)

	// stranger member (not owner of mailbox, not admin) -> 403.
	var stranger string
	if err := db.QueryRow(`INSERT INTO users (org_id, email, display_name, password_hash, is_active, role)
		VALUES ($1, $2, 'S', 'x', true, 'member') RETURNING id`, orgID, "stranger-rot-"+uuid.New().String()+"@byos.local").Scan(&stranger); err != nil {
		t.Fatal(err)
	}
	strangerToken := createSession(t, db, stranger)
	if rec := rotateRequest(t, orgID, mailboxID, `{}`, strangerToken); rec.Code != http.StatusForbidden {
		t.Fatalf("stranger rotate = %d, want 403", rec.Code)
	}
	// Cross-org mailbox id -> 404 (org-scoped lookup).
	if rec := rotateRequest(t, org2, mailboxID, `{}`, ownerToken); rec.Code != http.StatusNotFound {
		t.Fatalf("cross-org rotate = %d, want 404", rec.Code)
	}
	// Owner (admin-equivalent) can rotate member's mailbox.
	if rec := rotateRequest(t, orgID, mailboxID, `{}`, ownerToken); rec.Code != http.StatusOK {
		t.Fatalf("owner rotate = %d, want 200: %s", rec.Code, rec.Body.String())
	}
}
