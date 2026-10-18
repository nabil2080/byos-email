package main

import (
	"bytes"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
)

func createTestStorage(t *testing.T, db *sql.DB, orgID string) string {
	t.Helper()
	var storageID string
	err := db.QueryRow(`
		INSERT INTO storage_connections (org_id, provider_type, bucket_name, credentials_enc, is_active, status)
		VALUES ($1, 's3', 'test-bucket', decode('AA==', 'base64'), true, 'active')
		RETURNING id::text
	`, orgID).Scan(&storageID)
	if err != nil {
		t.Fatalf("failed to insert test storage connection: %v", err)
	}
	return storageID
}

func createTestDomain(t *testing.T, db *sql.DB, orgID, domainName string) string {
	t.Helper()
	var domainID string
	err := db.QueryRow(`
		INSERT INTO domains (org_id, name, is_verified)
		VALUES ($1, $2, true)
		RETURNING id::text
	`, orgID, domainName).Scan(&domainID)
	if err != nil {
		t.Fatalf("failed to insert test domain: %v", err)
	}
	return domainID
}

func TestMailboxInvite(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	orgID, ownerID, adminID, memberID := createTestOrgAndUsers(t, db)
	createTestStorage(t, db, orgID)
	domainName := "invite-test-" + uuid.New().String() + ".com"
	domainID := createTestDomain(t, db, orgID, domainName)

	// Upgrade seat count so multiple mailboxes can be created
	db.Exec(`UPDATE organizations SET seat_count=10 WHERE id=$1`, orgID)

	ownerToken := createTestSession(t, db, ownerID)
	adminToken := createTestSession(t, db, adminID)
	memberToken := createTestSession(t, db, memberID)

	dummyPk := hex.EncodeToString(bytes.Repeat([]byte{0x01}, 32))
	dummyWskOrg := "wrapped_org_key_material_test"

	// 1. Admin attempts to invite with deprecated organization_managed mode -> 400 Bad Request
	{
		body, _ := json.Marshal(map[string]interface{}{
			"address":      "bob@" + domainName,
			"name":         "Bob Builder",
			"privacy_mode": "organization_managed",
		})
		req := httptest.NewRequest(http.MethodPost, "/v1/organizations/"+orgID+"/mailboxes/invite", bytes.NewReader(body))
		req.SetPathValue("org_id", orgID)
		req.AddCookie(&http.Cookie{Name: "byos_session", Value: adminToken})
		w := httptest.NewRecorder()
		mailboxInviteHandler(w, req)

		if w.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 for org_managed invite, got %d: %s", w.Code, w.Body.String())
		}
	}

	// 1b. Admin attempts to provide key material in invite -> 400 Bad Request
	{
		body, _ := json.Marshal(map[string]interface{}{
			"address":        "bob2@" + domainName,
			"name":           "Bob Builder 2",
			"privacy_mode":   "private",
			"mailbox_pk":     dummyPk,
			"wrapped_sk_org": dummyWskOrg,
		})
		req := httptest.NewRequest(http.MethodPost, "/v1/organizations/"+orgID+"/mailboxes/invite", bytes.NewReader(body))
		req.SetPathValue("org_id", orgID)
		req.AddCookie(&http.Cookie{Name: "byos_session", Value: adminToken})
		w := httptest.NewRecorder()
		mailboxInviteHandler(w, req)

		if w.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 for invite with key material, got %d: %s", w.Code, w.Body.String())
		}
	}

	// 2. Owner creates Private mailbox (Client sends zero key material, server enforces NULLs)
	{
		body, _ := json.Marshal(map[string]interface{}{
			"address":      "alice@" + domainName,
			"name":         "Alice Private",
			"privacy_mode": "private",
		})
		req := httptest.NewRequest(http.MethodPost, "/v1/organizations/"+orgID+"/mailboxes/invite", bytes.NewReader(body))
		req.SetPathValue("org_id", orgID)
		req.AddCookie(&http.Cookie{Name: "byos_session", Value: ownerToken})
		w := httptest.NewRecorder()
		mailboxInviteHandler(w, req)

		if w.Code != http.StatusCreated {
			t.Fatalf("expected 201 for private invite, got %d: %s", w.Code, w.Body.String())
		}
		var resp map[string]interface{}
		json.Unmarshal(w.Body.Bytes(), &resp)

		// Verify that in private mode mailbox_pk is strictly NULL
		var mStatus, mMode string
		var storedPk []byte
		err := db.QueryRow(`SELECT status, mode, mailbox_pk FROM mailboxes WHERE id=$1`, resp["mailbox_id"]).Scan(&mStatus, &mMode, &storedPk)
		if err != nil {
			t.Fatalf("failed to query created private mailbox: %v", err)
		}
		if mStatus != "pending_activation" || mMode != "private" {
			t.Fatalf("unexpected mailbox state: status=%s mode=%s", mStatus, mMode)
		}
		if storedPk != nil {
			t.Fatalf("expected mailbox_pk to be NULL for pending private mailbox, got %x", storedPk)
		}

		// Also verify in account_invitations that mailbox_pk is NULL
		var invPk *string
		err = db.QueryRow(`SELECT mailbox_pk FROM account_invitations WHERE id=$1`, resp["invitation_id"]).Scan(&invPk)
		if err != nil {
			t.Fatalf("failed to query invitation row: %v", err)
		}
		if invPk != nil {
			t.Fatalf("expected invitation key field to be NULL for private mailbox, got pk=%v", invPk)
		}
	}

	// 3. Member attempts to invite -> 403 Forbidden
	{
		body, _ := json.Marshal(map[string]interface{}{
			"local_part":   "charlie",
			"domain_id":    domainID,
			"privacy_mode": "private",
		})
		req := httptest.NewRequest(http.MethodPost, "/v1/organizations/"+orgID+"/mailboxes/invite", bytes.NewReader(body))
		req.SetPathValue("org_id", orgID)
		req.AddCookie(&http.Cookie{Name: "byos_session", Value: memberToken})
		w := httptest.NewRecorder()
		mailboxInviteHandler(w, req)

		if w.Code != http.StatusForbidden {
			t.Fatalf("expected 403 Forbidden for member invite, got %d", w.Code)
		}
	}
}

func TestClaimInvitation(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
	createTestStorage(t, db, orgID)
	domainName := "claim-test-" + uuid.New().String() + ".com"
	createTestDomain(t, db, orgID, domainName)
	ownerToken := createTestSession(t, db, ownerID)

	// Create private invite
	body, _ := json.Marshal(map[string]interface{}{
		"address":      "dave@" + domainName,
		"privacy_mode": "private",
	})
	req := httptest.NewRequest(http.MethodPost, "/v1/organizations/"+orgID+"/mailboxes/invite", bytes.NewReader(body))
	req.SetPathValue("org_id", orgID)
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: ownerToken})
	w := httptest.NewRecorder()
	mailboxInviteHandler(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("setup invite failed: %s", w.Body.String())
	}
	var inviteResp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &inviteResp)
	inviteURL := inviteResp["invite_url"].(string)
	rawToken := inviteURL[len(inviteURL)-64:]

	// 1. Verify invitation endpoint
	{
		verifyReq := httptest.NewRequest(http.MethodGet, "/v1/auth/invitations/verify?token="+rawToken, nil)
		rec := httptest.NewRecorder()
		invitationVerifyHandler(rec, verifyReq)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 verify, got %d: %s", rec.Code, rec.Body.String())
		}
		var vResp map[string]interface{}
		json.Unmarshal(rec.Body.Bytes(), &vResp)
		if vResp["valid"] != true || vResp["email"] != "dave@"+domainName {
			t.Fatalf("unexpected verify response: %v", vResp)
		}
	}

	// 2. Claim private invitation: client supplies new password, derived key material
	dummyClientPk := hex.EncodeToString(bytes.Repeat([]byte{0x02}, 32))
	dummyWrappedSkUser := "user_master_wrapped_mailbox_sk_12345"
	{
		claimBody, _ := json.Marshal(map[string]interface{}{
			"token":           rawToken,
			"password":        "SuperSecretPassword123!",
			"mailbox_pk":      dummyClientPk,
			"wrapped_sk_user": dummyWrappedSkUser,
		})
		claimReq := httptest.NewRequest(http.MethodPost, "/v1/auth/invitations/claim", bytes.NewReader(claimBody))
		rec := httptest.NewRecorder()
		invitationClaimHandler(rec, claimReq)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 claim, got %d: %s", rec.Code, rec.Body.String())
		}
		var cResp map[string]interface{}
		json.Unmarshal(rec.Body.Bytes(), &cResp)
		if cResp["success"] != true {
			t.Fatalf("expected claim success, got %v", cResp)
		}
		// Check that session cookie was set
		cookies := rec.Result().Cookies()
		foundSession := false
		for _, c := range cookies {
			if c.Name == "byos_session" && c.Value != "" {
				foundSession = true
				break
			}
		}
		if !foundSession {
			t.Fatal("expected byos_session cookie after successful claim")
		}

		// Verify database state: status 'active' and user password set
		var uStatus string
		var uPass sql.NullString
		err := db.QueryRow(`SELECT status, password_hash FROM users WHERE email=$1`, "dave@"+domainName).Scan(&uStatus, &uPass)
		if err != nil || uStatus != "active" || !uPass.Valid || uPass.String == "" {
			t.Fatalf("user not properly activated: err=%v status=%s pass=%v", err, uStatus, uPass)
		}

		// Verify mailbox: status 'active', mailbox_pk set, wrapped_sk_user set
		var mStatus string
		var mPk []byte
		var mWskUser *string
		err = db.QueryRow(`SELECT status, mailbox_pk, wrapped_sk_user FROM mailboxes WHERE id=$1`, cResp["mailbox_id"]).Scan(&mStatus, &mPk, &mWskUser)
		if err != nil || mStatus != "active" || len(mPk) != 32 || mWskUser == nil || *mWskUser != dummyWrappedSkUser {
			t.Fatalf("mailbox not properly activated: err=%v status=%s pkLen=%d wskUser=%v", err, mStatus, len(mPk), mWskUser)
		}
	}

	// 3. Claiming again fails (single-use constraint)
	{
		claimBody, _ := json.Marshal(map[string]interface{}{
			"token":           rawToken,
			"password":        "SuperSecretPassword123!",
			"mailbox_pk":      dummyClientPk,
			"wrapped_sk_user": dummyWrappedSkUser,
		})
		claimReq := httptest.NewRequest(http.MethodPost, "/v1/auth/invitations/claim", bytes.NewReader(claimBody))
		rec := httptest.NewRecorder()
		invitationClaimHandler(rec, claimReq)

		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 Bad Request when re-claiming consumed token, got %d: %s", rec.Code, rec.Body.String())
		}
	}
}

func TestImpersonation(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	orgID, _, adminID, memberID := createTestOrgAndUsers(t, db)
	createTestStorage(t, db, orgID)
	// Upgrade seat count so multiple mailboxes can be created
	db.Exec(`UPDATE organizations SET seat_count=10 WHERE id=$1`, orgID)
	domainName := "impersonate-test-" + uuid.New().String() + ".com"
	createTestDomain(t, db, orgID, domainName)

	adminToken := createTestSession(t, db, adminID)
	memberToken := createTestSession(t, db, memberID)

	// Create Private mailbox
	bodyPriv, _ := json.Marshal(map[string]interface{}{
		"address":      "privuser@" + domainName,
		"privacy_mode": "private",
	})
	reqPriv := httptest.NewRequest(http.MethodPost, "/v1/organizations/"+orgID+"/mailboxes/invite", bytes.NewReader(bodyPriv))
	reqPriv.SetPathValue("org_id", orgID)
	reqPriv.AddCookie(&http.Cookie{Name: "byos_session", Value: adminToken})
	wPriv := httptest.NewRecorder()
	mailboxInviteHandler(wPriv, reqPriv)
	if wPriv.Code != http.StatusCreated {
		t.Fatalf("setup priv invite failed: %s", wPriv.Body.String())
	}
	var privInviteResp map[string]interface{}
	json.Unmarshal(wPriv.Body.Bytes(), &privInviteResp)
	privMailboxID := privInviteResp["mailbox_id"].(string)

	// 1. Admin attempts to access Private mailbox -> strictly 403 Forbidden
	{
		impReq := httptest.NewRequest(http.MethodPost, "/v1/organizations/"+orgID+"/mailboxes/"+privMailboxID+"/impersonate", nil)
		impReq.SetPathValue("org_id", orgID)
		impReq.SetPathValue("mailbox_id", privMailboxID)
		impReq.AddCookie(&http.Cookie{Name: "byos_session", Value: adminToken})
		rec := httptest.NewRecorder()
		mailboxImpersonateHandler(rec, impReq)

		if rec.Code != http.StatusForbidden {
			t.Fatalf("expected 403 Forbidden when admin impersonates private mailbox, got %d: %s", rec.Code, rec.Body.String())
		}
		var errResp map[string]string
		json.Unmarshal(rec.Body.Bytes(), &errResp)
		if errResp["error"] != "Private mailboxes cannot be accessed by administrators" {
			t.Fatalf("unexpected error message: %v", errResp)
		}
	}

	// 2. Member attempts to access any mailbox -> 403 Forbidden
	{
		impReq := httptest.NewRequest(http.MethodPost, "/v1/organizations/"+orgID+"/mailboxes/"+privMailboxID+"/impersonate", nil)
		impReq.SetPathValue("org_id", orgID)
		impReq.SetPathValue("mailbox_id", privMailboxID)
		impReq.AddCookie(&http.Cookie{Name: "byos_session", Value: memberToken})
		rec := httptest.NewRecorder()
		mailboxImpersonateHandler(rec, impReq)

		if rec.Code != http.StatusForbidden {
			t.Fatalf("expected 403 Forbidden for member impersonation, got %d", rec.Code)
		}
	}
}

func TestClaimInvitationWithXWingPK(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	orgID, _, adminID, _ := createTestOrgAndUsers(t, db)
	createTestStorage(t, db, orgID)
	domainName := "xwing-claim-" + uuid.New().String() + ".com"
	createTestDomain(t, db, orgID, domainName)
	adminToken := createTestSession(t, db, adminID)

	// 1. Create a private mailbox invitation
	inviteBody, _ := json.Marshal(map[string]interface{}{
		"address":      "alice@" + domainName,
		"privacy_mode": "private",
	})
	req := httptest.NewRequest(http.MethodPost, "/v1/organizations/"+orgID+"/mailboxes/invite", bytes.NewReader(inviteBody))
	req.SetPathValue("org_id", orgID)
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: adminToken})
	rec := httptest.NewRecorder()
	mailboxInviteHandler(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created, got %d: %s", rec.Code, rec.Body.String())
	}
	var inviteResp map[string]interface{}
	json.Unmarshal(rec.Body.Bytes(), &inviteResp)
	inviteURL := inviteResp["invite_url"].(string)
	rawToken := inviteURL[len(inviteURL)-64:]

	dummyClientPk := hex.EncodeToString(bytes.Repeat([]byte{0x42}, 32))
	dummyWrappedSkUser := `{"salt":"0123456789abcdef0123456789abcdef","envelope":"test"}`
	xwingPkBytes := bytes.Repeat([]byte{0x77}, 1216)
	xwingPkB64 := base64.StdEncoding.EncodeToString(xwingPkBytes)

	// 2. Claim with valid 1216-byte XWingPK
	claimBody, _ := json.Marshal(map[string]interface{}{
		"token":           rawToken,
		"password":        "SuperSecretPassword123!",
		"mailbox_pk":      dummyClientPk,
		"xwing_pk":        xwingPkB64,
		"wrapped_sk_user": dummyWrappedSkUser,
	})
	claimReq := httptest.NewRequest(http.MethodPost, "/v1/auth/invitations/claim", bytes.NewReader(claimBody))
	rec = httptest.NewRecorder()
	invitationClaimHandler(rec, claimReq)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 claim, got %d: %s", rec.Code, rec.Body.String())
	}
	var cResp map[string]interface{}
	json.Unmarshal(rec.Body.Bytes(), &cResp)

	// Verify mailbox_xwing_pk column in database
	var storedXWingPK []byte
	err := db.QueryRow(`SELECT mailbox_xwing_pk FROM mailboxes WHERE id=$1`, cResp["mailbox_id"]).Scan(&storedXWingPK)
	if err != nil {
		t.Fatalf("failed to query mailbox_xwing_pk: %v", err)
	}
	if len(storedXWingPK) != 1216 || !bytes.Equal(storedXWingPK, xwingPkBytes) {
		t.Fatalf("expected 1216 bytes stored xwing pk, got len=%d", len(storedXWingPK))
	}

	// 3. Test invalid length XWingPK rejected with 400
	// Create another invitation
	inviteBody2, _ := json.Marshal(map[string]interface{}{
		"address":      "bob@" + domainName,
		"privacy_mode": "private",
	})
	req2 := httptest.NewRequest(http.MethodPost, "/v1/organizations/"+orgID+"/mailboxes/invite", bytes.NewReader(inviteBody2))
	req2.SetPathValue("org_id", orgID)
	req2.AddCookie(&http.Cookie{Name: "byos_session", Value: adminToken})
	rec2 := httptest.NewRecorder()
	mailboxInviteHandler(rec2, req2)
	json.Unmarshal(rec2.Body.Bytes(), &inviteResp)
	inviteURL2 := inviteResp["invite_url"].(string)
	rawToken2 := inviteURL2[len(inviteURL2)-64:]

	badClaimBody, _ := json.Marshal(map[string]interface{}{
		"token":           rawToken2,
		"password":        "SuperSecretPassword123!",
		"mailbox_pk":      dummyClientPk,
		"xwing_pk":        base64.StdEncoding.EncodeToString([]byte("too-short")),
		"wrapped_sk_user": dummyWrappedSkUser,
	})
	badReq := httptest.NewRequest(http.MethodPost, "/v1/auth/invitations/claim", bytes.NewReader(badClaimBody))
	badRec := httptest.NewRecorder()
	invitationClaimHandler(badRec, badReq)

	if badRec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request for bad length xwing_pk, got %d: %s", badRec.Code, badRec.Body.String())
	}
}
