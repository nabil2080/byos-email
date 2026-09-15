package main

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

	// Upgrade plan so multiple mailboxes can be created
	db.Exec(`UPDATE organizations SET plan='business' WHERE id=$1`, orgID)

	ownerToken := createTestSession(t, db, ownerID)
	adminToken := createTestSession(t, db, adminID)
	memberToken := createTestSession(t, db, memberID)

	dummyPk := hex.EncodeToString(bytes.Repeat([]byte{0x01}, 32))
	dummyWskOrg := "wrapped_org_key_material_test"
	dummyTempWsk := "temp_wrapped_sk_material_test"

	// 1. Admin creates Org-Managed mailbox
	{
		body, _ := json.Marshal(map[string]interface{}{
			"address":         "bob@" + domainName,
			"name":            "Bob Builder",
			"privacy_mode":    "organization_managed",
			"mailbox_pk":      dummyPk,
			"wrapped_sk_org":  dummyWskOrg,
			"temp_wrapped_sk": dummyTempWsk,
		})
		req := httptest.NewRequest(http.MethodPost, "/v1/organizations/"+orgID+"/mailboxes/invite", bytes.NewReader(body))
		req.SetPathValue("org_id", orgID)
		req.AddCookie(&http.Cookie{Name: "byos_session", Value: adminToken})
		w := httptest.NewRecorder()
		mailboxInviteHandler(w, req)

		if w.Code != http.StatusCreated {
			t.Fatalf("expected 201 for org_managed invite, got %d: %s", w.Code, w.Body.String())
		}
		var resp map[string]interface{}
		json.Unmarshal(w.Body.Bytes(), &resp)
		if resp["invite_url"] == nil || resp["invitation_id"] == nil {
			t.Fatalf("expected invite_url and invitation_id in response: %v", resp)
		}

		// Verify stored status is pending_activation and keys are stored
		var mStatus, mMode string
		var storedPk []byte
		var storedWskOrg *string
		err := db.QueryRow(`SELECT status, mode, mailbox_pk, wrapped_sk_org FROM mailboxes WHERE id=$1`, resp["mailbox_id"]).Scan(&mStatus, &mMode, &storedPk, &storedWskOrg)
		if err != nil {
			t.Fatalf("failed to query created mailbox: %v", err)
		}
		if mStatus != "pending_activation" || mMode != "org_managed" {
			t.Fatalf("unexpected mailbox state: status=%s mode=%s", mStatus, mMode)
		}
		if storedWskOrg == nil || *storedWskOrg != dummyWskOrg {
			t.Fatalf("expected wrapped_sk_org to match, got %v", storedWskOrg)
		}
	}

	// 2. Owner creates Private mailbox (Client sends zero key material, server enforces NULLs)
	{
		body, _ := json.Marshal(map[string]interface{}{
			"address":      "alice@" + domainName,
			"name":         "Alice Private",
			"privacy_mode": "private",
			// Even if client sent junk keys, private mode must zero them
			"mailbox_pk":     dummyPk,
			"wrapped_sk_org": dummyWskOrg,
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

		// Verify that in private mode mailbox_pk and wrapped_sk_org are strictly NULL
		var mStatus, mMode string
		var storedPk []byte
		var storedWskOrg *string
		err := db.QueryRow(`SELECT status, mode, mailbox_pk, wrapped_sk_org FROM mailboxes WHERE id=$1`, resp["mailbox_id"]).Scan(&mStatus, &mMode, &storedPk, &storedWskOrg)
		if err != nil {
			t.Fatalf("failed to query created private mailbox: %v", err)
		}
		if mStatus != "pending_activation" || mMode != "private" {
			t.Fatalf("unexpected mailbox state: status=%s mode=%s", mStatus, mMode)
		}
		if storedPk != nil {
			t.Fatalf("expected mailbox_pk to be NULL for pending private mailbox, got %x", storedPk)
		}
		if storedWskOrg != nil {
			t.Fatalf("expected wrapped_sk_org to be NULL for private mailbox, got %v", storedWskOrg)
		}

		// Also verify in account_invitations that keys are NULL
		var invPk, invWskOrg, invTempWsk *string
		err = db.QueryRow(`SELECT mailbox_pk, wrapped_sk_org, temp_wrapped_sk FROM account_invitations WHERE id=$1`, resp["invitation_id"]).Scan(&invPk, &invWskOrg, &invTempWsk)
		if err != nil {
			t.Fatalf("failed to query invitation row: %v", err)
		}
		if invPk != nil || invWskOrg != nil || invTempWsk != nil {
			t.Fatalf("expected all invitation key fields to be NULL for private mailbox, got pk=%v wsk=%v temp=%v", invPk, invWskOrg, invTempWsk)
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
	// Upgrade plan so multiple mailboxes can be created
	db.Exec(`UPDATE organizations SET plan='business' WHERE id=$1`, orgID)
	domainName := "impersonate-test-" + uuid.New().String() + ".com"
	createTestDomain(t, db, orgID, domainName)

	adminToken := createTestSession(t, db, adminID)
	memberToken := createTestSession(t, db, memberID)

	dummyPk := hex.EncodeToString(bytes.Repeat([]byte{0x01}, 32))
	dummyWskOrg := "wrapped_org_key_material_test"

	// Create Org-Managed mailbox
	body, _ := json.Marshal(map[string]interface{}{
		"address":        "orguser@" + domainName,
		"privacy_mode":   "organization_managed",
		"mailbox_pk":     dummyPk,
		"wrapped_sk_org": dummyWskOrg,
	})
	req := httptest.NewRequest(http.MethodPost, "/v1/organizations/"+orgID+"/mailboxes/invite", bytes.NewReader(body))
	req.SetPathValue("org_id", orgID)
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: adminToken})
	w := httptest.NewRecorder()
	mailboxInviteHandler(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("setup org invite failed: %s", w.Body.String())
	}
	var orgInviteResp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &orgInviteResp)
	orgMailboxID := orgInviteResp["mailbox_id"].(string)

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

	// 1. Admin accesses Org-Managed mailbox -> 200 OK with wrapped_sk_org and session_token
	{
		impReq := httptest.NewRequest(http.MethodPost, "/v1/organizations/"+orgID+"/mailboxes/"+orgMailboxID+"/impersonate", nil)
		impReq.SetPathValue("org_id", orgID)
		impReq.SetPathValue("mailbox_id", orgMailboxID)
		impReq.AddCookie(&http.Cookie{Name: "byos_session", Value: adminToken})
		rec := httptest.NewRecorder()
		mailboxImpersonateHandler(rec, impReq)

		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 OK for org-managed impersonation, got %d: %s", rec.Code, rec.Body.String())
		}
		var resp map[string]interface{}
		json.Unmarshal(rec.Body.Bytes(), &resp)
		if resp["wrapped_sk_org"] != dummyWskOrg || resp["session_token"] == nil {
			t.Fatalf("unexpected impersonation payload: %v", resp)
		}
	}

	// 2. Admin attempts to access Private mailbox -> strictly 403 Forbidden
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

	// 3. Member attempts to access any mailbox -> 403 Forbidden
	{
		impReq := httptest.NewRequest(http.MethodPost, "/v1/organizations/"+orgID+"/mailboxes/"+orgMailboxID+"/impersonate", nil)
		impReq.SetPathValue("org_id", orgID)
		impReq.SetPathValue("mailbox_id", orgMailboxID)
		impReq.AddCookie(&http.Cookie{Name: "byos_session", Value: memberToken})
		rec := httptest.NewRecorder()
		mailboxImpersonateHandler(rec, impReq)

		if rec.Code != http.StatusForbidden {
			t.Fatalf("expected 403 Forbidden for member impersonation, got %d", rec.Code)
		}
	}
}
