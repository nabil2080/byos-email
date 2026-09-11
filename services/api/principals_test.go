package main

// Recovery principal lifecycle tests (require PostgreSQL; no Redis needed).
// Without a database they skip; skipped is reported, never counted.

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func principalRequest(t *testing.T, method, orgID, principalID, action, body, token string) *httptest.ResponseRecorder {
	t.Helper()
	url := "/v1/organizations/" + orgID + "/recovery-principals"
	if principalID != "" {
		url += "/" + principalID
	}
	if action != "" {
		url += "/" + action
	}
	var reader *bytes.Reader
	if body == "" {
		reader = bytes.NewReader(nil)
	} else {
		reader = bytes.NewReader([]byte(body))
	}
	req := httptest.NewRequest(method, url, reader)
	req.SetPathValue("org_id", orgID)
	if principalID != "" {
		req.SetPathValue("principal_id", principalID)
	}
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	rec := httptest.NewRecorder()
	recoveryPrincipalsHandler(rec, req)
	return rec
}

func principalEnrollBody(userID, name string) string {
	sk := base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{0x07}, 61))
	return `{"user_id":"` + userID + `","principal_name":"` + name + `",` +
		`"kdf_algorithm":"argon2id","kdf_version":1,` +
		`"kdf_salt":"` + base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{0x09}, 16)) + `",` +
		`"kdf_memory":65536,"kdf_iterations":3,"kdf_parallelism":2,` +
		`"org_recovery_sk_encrypted":"` + sk + `",` +
		`"org_recovery_pk":"` + base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{0x0b}, 32)) + `"}`
}

func TestRecoveryPrincipalLifecycle(t *testing.T) {
	requirePostgres(t)
	db := setupTestDB(t)
	defer db.Close()

	orgID, ownerID, adminID, memberID := createTestOrgAndUsers(t, db)
	ownerToken := createSession(t, db, ownerID)
	adminToken := createSession(t, db, adminID)
	memberToken := createSession(t, db, memberID)

	// Enroll happy path (owner).
	rec := principalRequest(t, http.MethodPost, orgID, "", "", principalEnrollBody(memberID, "laptop"), ownerToken)
	if rec.Code != http.StatusCreated {
		t.Fatalf("enroll status = %d, want 201: %s", rec.Code, rec.Body.String())
	}
	var created struct {
		ID               string  `json:"id"`
		KDFAlgorithm     string  `json:"kdf_algorithm"`
		KDFMemory        int     `json:"kdf_memory"`
		OrgRecoveryPK    string  `json:"org_recovery_pk"`
		OrgRecoverySKEnc *string `json:"org_recovery_sk_encrypted"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&created); err != nil || created.ID == "" {
		t.Fatalf("bad enroll body: %s", rec.Body.String())
	}
	if created.KDFAlgorithm != "argon2id" || created.KDFMemory != 65536 {
		t.Fatalf("enroll must echo frozen profile: %+v", created)
	}
	if created.OrgRecoverySKEnc != nil {
		t.Fatal("enroll response must not include ciphertext")
	}

	// Duplicate name -> 409.
	if rec := principalRequest(t, http.MethodPost, orgID, "", "", principalEnrollBody(memberID, "laptop"), ownerToken); rec.Code != http.StatusConflict {
		t.Fatalf("duplicate name = %d, want 409", rec.Code)
	}

	// Weak KDF params rejected.
	weak := strings.Replace(principalEnrollBody(memberID, "weak"), `"kdf_memory":65536`, `"kdf_memory":32768`, 1)
	if rec := principalRequest(t, http.MethodPost, orgID, "", "", weak, ownerToken); rec.Code != http.StatusBadRequest {
		t.Fatalf("weak params = %d, want 400", rec.Code)
	}

	// Member and admin cannot enroll (owner-only).
	if rec := principalRequest(t, http.MethodPost, orgID, "", "", principalEnrollBody(memberID, "x"), memberToken); rec.Code != http.StatusForbidden {
		t.Fatalf("member enroll = %d, want 403", rec.Code)
	}
	if rec := principalRequest(t, http.MethodPost, orgID, "", "", principalEnrollBody(memberID, "x"), adminToken); rec.Code != http.StatusForbidden {
		t.Fatalf("admin enroll = %d, want 403", rec.Code)
	}

	// List as admin: 200 without ciphertext.
	rec = principalRequest(t, http.MethodGet, orgID, "", "", "", adminToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("list status = %d, want 200", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "org_recovery_sk_encrypted") {
		t.Fatal("list must not include ciphertext")
	}
	var list struct {
		Principals []struct {
			ID        string `json:"id"`
			IsActive  bool   `json:"is_active"`
			KDFMemory int    `json:"kdf_memory"`
		} `json:"principals"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&list); err != nil || len(list.Principals) != 1 {
		t.Fatalf("list must contain exactly the enrolled principal: %s", rec.Body.String())
	}

	// List as member -> 403.
	if rec := principalRequest(t, http.MethodGet, orgID, "", "", "", memberToken); rec.Code != http.StatusForbidden {
		t.Fatalf("member list = %d, want 403", rec.Code)
	}

	// Get as admin includes ciphertext for the recovery ceremony.
	rec = principalRequest(t, http.MethodGet, orgID, created.ID, "", "", adminToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("get status = %d, want 200", rec.Code)
	}
	var got struct {
		OrgRecoverySKEnc *string `json:"org_recovery_sk_encrypted"`
		IsActive         bool    `json:"is_active"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil || got.OrgRecoverySKEnc == nil || !got.IsActive {
		t.Fatalf("get must include ciphertext + active: %s", rec.Body.String())
	}

	// Revoke as admin -> 403; as owner -> 200 inactive; repeat -> 200 again.
	if rec := principalRequest(t, http.MethodPost, orgID, created.ID, "revoke", "", adminToken); rec.Code != http.StatusForbidden {
		t.Fatalf("admin revoke = %d, want 403", rec.Code)
	}
	rec = principalRequest(t, http.MethodPost, orgID, created.ID, "revoke", "", ownerToken)
	if rec.Code != http.StatusOK {
		t.Fatalf("revoke status = %d, want 200", rec.Code)
	}
	var revoked struct {
		IsActive bool `json:"is_active"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&revoked); err != nil || revoked.IsActive {
		t.Fatalf("revoke must report inactive: %s", rec.Body.String())
	}
	if rec := principalRequest(t, http.MethodPost, orgID, created.ID, "revoke", "", ownerToken); rec.Code != http.StatusOK {
		t.Fatalf("repeat revoke = %d, want 200 (idempotent)", rec.Code)
	}
	// Revoked row still listed (audit trail, not deletion).
	rec = principalRequest(t, http.MethodGet, orgID, "", "", "", adminToken)
	var relist struct {
		Principals []struct {
			ID       string `json:"id"`
			IsActive bool   `json:"is_active"`
		} `json:"principals"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&relist); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, p := range relist.Principals {
		if p.ID == created.ID {
			found = true
			if p.IsActive {
				t.Fatal("revoked principal must list as inactive")
			}
		}
	}
	if !found {
		t.Fatal("revoked principal must remain listed")
	}
}

func TestRecoveryPrincipalCrossOrg(t *testing.T) {
	requirePostgres(t)
	db := setupTestDB(t)
	defer db.Close()

	org1, owner1, _, _ := createTestOrgWithEmail(t, db, "princ1")
	org2, owner2, _, _ := createTestOrgWithEmail(t, db, "princ2")
	token1 := createSession(t, db, owner1)
	token2 := createSession(t, db, owner2)

	rec := principalRequest(t, http.MethodPost, org1, "", "", principalEnrollBody(owner1, "desk"), token1)
	if rec.Code != http.StatusCreated {
		t.Fatalf("enroll = %d: %s", rec.Code, rec.Body.String())
	}
	var created struct {
		ID string `json:"id"`
	}
	_ = json.NewDecoder(rec.Body).Decode(&created)

	// Org2 owner cannot read, list into, or revoke org1's principal.
	if rec := principalRequest(t, http.MethodGet, org1, created.ID, "", "", token2); rec.Code != http.StatusForbidden {
		t.Fatalf("cross-org get = %d, want 403", rec.Code)
	}
	if rec := principalRequest(t, http.MethodPost, org1, created.ID, "revoke", "", token2); rec.Code == http.StatusOK {
		t.Fatal("cross-org revoke must not succeed")
	}
	// Nonsense UUIDs rejected, not leaked.
	if rec := principalRequest(t, http.MethodGet, org1, "not-a-uuid", "", "", token1); rec.Code != http.StatusBadRequest {
		t.Fatalf("bad uuid = %d, want 400", rec.Code)
	}
	// Org2's own list is empty: no cross-org leakage through listing.
	rec = principalRequest(t, http.MethodGet, org2, "", "", "", token2)
	if rec.Code != http.StatusOK {
		t.Fatalf("org2 list = %d, want 200", rec.Code)
	}
	var org2list struct {
		Principals []interface{} `json:"principals"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&org2list); err != nil || len(org2list.Principals) != 0 {
		t.Fatalf("org2 list must be empty: %s", rec.Body.String())
	}
}
