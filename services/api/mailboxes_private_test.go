package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func TestRejectOrgManagedMailboxCreation(t *testing.T) {
	dsn := getValidatedTestDSN(t)
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Skipf("skipping test; db unreachable: %v", err)
	}
	defer conn.Close(ctx)

	orgID := uuid.New().String()
	userID := uuid.New().String()
	domainID := uuid.New().String()
	newMailboxID := uuid.New().String()
	domainName := "test-" + uuid.New().String()[:8] + ".local"

	_, err = conn.Exec(ctx, `INSERT INTO organizations (id, name, seat_count, org_recovery_pk) VALUES ($1, $2, 5, decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'))`, orgID, "Private Org")
	if err != nil {
		t.Fatalf("insert org: %v", err)
	}
	defer func() {
		var rootSecretID string
		_ = conn.QueryRow(ctx, `SELECT root_secret_id FROM mailboxes WHERE id=$1`, newMailboxID).Scan(&rootSecretID)
		_, _ = conn.Exec(ctx, `DELETE FROM mailboxes WHERE id=$1`, newMailboxID)
		if rootSecretID != "" {
			_, _ = conn.Exec(ctx, `DELETE FROM root_secrets WHERE id=$1`, rootSecretID)
		}
		_, _ = conn.Exec(ctx, `DELETE FROM organizations WHERE id=$1`, orgID)
	}()

	_, err = conn.Exec(ctx, `INSERT INTO domains (id, org_id, name, is_verified) VALUES ($1, $2, $3, true)`, domainID, orgID, domainName)
	if err != nil {
		t.Fatalf("insert domain: %v", err)
	}

	pwHash, _ := hashPassword("password123")
	adminEmail := "admin-" + uuid.New().String()[:8] + "@" + domainName
	_, err = conn.Exec(ctx, `INSERT INTO users (id, org_id, email, password_hash, display_name, role, is_active) VALUES ($1, $2, $3, $4, 'Admin', 'admin', true)`, userID, orgID, adminEmail, pwHash)
	if err != nil {
		t.Fatalf("insert user: %v", err)
	}

	token, tokenHash := generateSessionToken()
	_, err = conn.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, expires_at, ip_address, user_agent, last_active_at) VALUES ($1, $2, now() + interval '1 day', '127.0.0.1', 'test-agent', now())`, userID, tokenHash)
	if err != nil {
		t.Fatalf("insert session: %v", err)
	}

	// Insert active storage connection
	storageID := uuid.New().String()
	_, err = conn.Exec(ctx, `INSERT INTO storage_connections (id, org_id, provider_type, bucket_name, credentials_enc, is_active, status) VALUES ($1, $2, 's3', 'test-bucket', decode('AA==', 'base64'), true, 'active')`, storageID, orgID)
	if err != nil {
		t.Fatalf("insert storage: %v", err)
	}

	dummySKWrapped := hex.EncodeToString(make([]byte, 61))
	dummyPK := hex.EncodeToString(make([]byte, 32))
	dummyRootWrapped := hex.EncodeToString(make([]byte, 81))

	// 1. Attempt to create mailbox with mode = "org_managed" -> Must return 400 Bad Request
	body, _ := json.Marshal(map[string]interface{}{
		"id":                  uuid.New().String(),
		"local_part":          "legacy_mbx",
		"domain_id":           domainID,
		"mode":                "org_managed",
		"root_secret_wrapped": dummyRootWrapped,
		"mailbox_sk_wrapped":  dummySKWrapped,
		"mailbox_pk":          dummyPK,
	})
	req := httptest.NewRequest(http.MethodPost, "/v1/organizations/"+orgID+"/mailboxes", bytes.NewReader(body))
	req.SetPathValue("org_id", orgID)
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	req.Header.Set("X-User-Id", userID)
	rec := httptest.NewRecorder()
	mailboxesHandler(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request when attempting to create org_managed mailbox, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "org_managed mode is deprecated") {
		t.Fatalf("expected deprecation error message, got: %s", rec.Body.String())
	}

	// 2. Successful creation of private mailbox (root_secret_wrapped omitted)
	newMailboxID = uuid.New().String()
	privBody, _ := json.Marshal(map[string]interface{}{
		"id":                 newMailboxID,
		"local_part":         "sovereign_mbx",
		"domain_id":          domainID,
		"mode":               "private",
		"mailbox_sk_wrapped": dummySKWrapped,
		"mailbox_pk":         dummyPK,
	})
	reqPriv := httptest.NewRequest(http.MethodPost, "/v1/organizations/"+orgID+"/mailboxes", bytes.NewReader(privBody))
	reqPriv.SetPathValue("org_id", orgID)
	reqPriv.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	reqPriv.Header.Set("X-User-Id", userID)
	recPriv := httptest.NewRecorder()
	mailboxesHandler(recPriv, reqPriv)

	if recPriv.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created for private mailbox, got %d: %s", recPriv.Code, recPriv.Body.String())
	}

	// Verify mailbox mode in database is strictly 'private'
	var mode string
	err = conn.QueryRow(ctx, `SELECT mode FROM mailboxes WHERE id=$1`, newMailboxID).Scan(&mode)
	if err != nil {
		t.Fatalf("query created mailbox: %v", err)
	}
	if mode != "private" {
		t.Fatalf("expected mode = 'private', got '%s'", mode)
	}
}

func TestRejectOrgManagedMailboxInvite(t *testing.T) {
	dsn := getValidatedTestDSN(t)
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Skipf("skipping test; db unreachable: %v", err)
	}
	defer conn.Close(ctx)

	orgID := uuid.New().String()
	userID := uuid.New().String()
	domainID := uuid.New().String()
	domainName := "test-" + uuid.New().String()[:8] + ".local"

	_, err = conn.Exec(ctx, `INSERT INTO organizations (id, name, seat_count, org_recovery_pk) VALUES ($1, $2, 5, decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'))`, orgID, "Invite Org")
	if err != nil {
		t.Fatalf("insert org: %v", err)
	}
	defer conn.Exec(ctx, `DELETE FROM organizations WHERE id=$1`, orgID)

	_, err = conn.Exec(ctx, `INSERT INTO domains (id, org_id, name, is_verified) VALUES ($1, $2, $3, true)`, domainID, orgID, domainName)
	if err != nil {
		t.Fatalf("insert domain: %v", err)
	}

	pwHash, _ := hashPassword("password123")
	adminEmail := "admin-" + uuid.New().String()[:8] + "@" + domainName
	_, err = conn.Exec(ctx, `INSERT INTO users (id, org_id, email, password_hash, display_name, role, is_active) VALUES ($1, $2, $3, $4, 'Admin', 'admin', true)`, userID, orgID, adminEmail, pwHash)
	if err != nil {
		t.Fatalf("insert user: %v", err)
	}

	token, tokenHash := generateSessionToken()
	_, err = conn.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, expires_at, ip_address, user_agent, last_active_at) VALUES ($1, $2, now() + interval '1 day', '127.0.0.1', 'test-agent', now())`, userID, tokenHash)
	if err != nil {
		t.Fatalf("insert session: %v", err)
	}

	// Insert active storage connection
	storageID := uuid.New().String()
	_, err = conn.Exec(ctx, `INSERT INTO storage_connections (id, org_id, provider_type, bucket_name, credentials_enc, is_active, status) VALUES ($1, $2, 's3', 'test-bucket', decode('AA==', 'base64'), true, 'active')`, storageID, orgID)
	if err != nil {
		t.Fatalf("insert storage: %v", err)
	}

	// 1. Attempt to invite with privacy_mode = "org_managed" -> 400 Bad Request
	body1, _ := json.Marshal(map[string]interface{}{
		"address":      "user1@" + domainName,
		"privacy_mode": "org_managed",
	})
	req1 := httptest.NewRequest(http.MethodPost, "/v1/organizations/"+orgID+"/mailboxes/invite", bytes.NewReader(body1))
	req1.SetPathValue("org_id", orgID)
	req1.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	req1.Header.Set("X-User-Id", userID)
	rec1 := httptest.NewRecorder()
	mailboxInviteHandler(rec1, req1)

	if rec1.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request for org_managed invite, got %d: %s", rec1.Code, rec1.Body.String())
	}

	// 2. Attempt to invite with privacy_mode = "organization_managed" -> 400 Bad Request
	body2, _ := json.Marshal(map[string]interface{}{
		"address":      "user2@" + domainName,
		"privacy_mode": "organization_managed",
	})
	req2 := httptest.NewRequest(http.MethodPost, "/v1/organizations/"+orgID+"/mailboxes/invite", bytes.NewReader(body2))
	req2.SetPathValue("org_id", orgID)
	req2.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	req2.Header.Set("X-User-Id", userID)
	rec2 := httptest.NewRecorder()
	mailboxInviteHandler(rec2, req2)

	if rec2.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request for organization_managed invite, got %d: %s", rec2.Code, rec2.Body.String())
	}

	// 3. Attempt to provide admin key material -> 400 Bad Request
	dummyPK := hex.EncodeToString(make([]byte, 32))
	dummyWsk := hex.EncodeToString(make([]byte, 81))
	body3, _ := json.Marshal(map[string]interface{}{
		"address":        "user3@" + domainName,
		"privacy_mode":   "private",
		"mailbox_pk":     dummyPK,
		"wrapped_sk_org": dummyWsk,
	})
	req3 := httptest.NewRequest(http.MethodPost, "/v1/organizations/"+orgID+"/mailboxes/invite", bytes.NewReader(body3))
	req3.SetPathValue("org_id", orgID)
	req3.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	req3.Header.Set("X-User-Id", userID)
	rec3 := httptest.NewRecorder()
	mailboxInviteHandler(rec3, req3)

	if rec3.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request when admin provides key material, got %d: %s", rec3.Code, rec3.Body.String())
	}

	// 4. Clean private invite -> 201 Created
	body4, _ := json.Marshal(map[string]interface{}{
		"address":      "user4@" + domainName,
		"privacy_mode": "private",
	})
	req4 := httptest.NewRequest(http.MethodPost, "/v1/organizations/"+orgID+"/mailboxes/invite", bytes.NewReader(body4))
	req4.SetPathValue("org_id", orgID)
	req4.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	req4.Header.Set("X-User-Id", userID)
	rec4 := httptest.NewRecorder()
	mailboxInviteHandler(rec4, req4)

	if rec4.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created for clean private invite, got %d: %s", rec4.Code, rec4.Body.String())
	}

	var inviteResp map[string]interface{}
	json.Unmarshal(rec4.Body.Bytes(), &inviteResp)
	createdMailboxID := inviteResp["mailbox_id"].(string)

	// Verify mailbox mode is private and mailbox_pk is NULL
	var mode string
	var mailboxPK *string
	err = conn.QueryRow(ctx, `SELECT mode, mailbox_pk::text FROM mailboxes WHERE id=$1`, createdMailboxID).Scan(&mode, &mailboxPK)
	if err != nil {
		t.Fatalf("query created invite mailbox: %v", err)
	}
	if mode != "private" {
		t.Fatalf("expected mode = 'private', got '%s'", mode)
	}
	if mailboxPK != nil {
		t.Fatalf("expected mailbox_pk to be NULL for pending private mailbox, got %v", mailboxPK)
	}
}

func TestAdminCannotAccessMailboxSecretKeys(t *testing.T) {
	dsn := getValidatedTestDSN(t)
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Skipf("skipping test; db unreachable: %v", err)
	}
	defer conn.Close(ctx)

	orgID := uuid.New().String()
	adminID := uuid.New().String()
	memberID := uuid.New().String()
	domainID := uuid.New().String()
	mailboxID := uuid.New().String()
	rootSecretID := uuid.New().String()
	domainName := "test-" + uuid.New().String()[:8] + ".local"

	_, err = conn.Exec(ctx, `INSERT INTO organizations (id, name, seat_count, org_recovery_pk) VALUES ($1, $2, 5, decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'))`, orgID, "Isolation Org")
	if err != nil {
		t.Fatalf("insert org: %v", err)
	}
	defer func() {
		_, _ = conn.Exec(ctx, `DELETE FROM mailboxes WHERE id=$1`, mailboxID)
		_, _ = conn.Exec(ctx, `DELETE FROM root_secrets WHERE id=$1`, rootSecretID)
		_, _ = conn.Exec(ctx, `DELETE FROM organizations WHERE id=$1`, orgID)
	}()

	_, err = conn.Exec(ctx, `INSERT INTO domains (id, org_id, name, is_verified) VALUES ($1, $2, $3, true)`, domainID, orgID, domainName)
	if err != nil {
		t.Fatalf("insert domain: %v", err)
	}

	pwHash, _ := hashPassword("password123")
	adminEmail := "admin-" + uuid.New().String()[:8] + "@" + domainName
	_, err = conn.Exec(ctx, `INSERT INTO users (id, org_id, email, password_hash, display_name, role, is_active) VALUES ($1, $2, $3, $4, 'Admin', 'admin', true)`, adminID, orgID, adminEmail, pwHash)
	if err != nil {
		t.Fatalf("insert admin: %v", err)
	}

	adminToken, adminTokenHash := generateSessionToken()
	_, err = conn.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, expires_at, ip_address, user_agent, last_active_at) VALUES ($1, $2, now() + interval '1 day', '127.0.0.1', 'test-agent', now())`, adminID, adminTokenHash)
	if err != nil {
		t.Fatalf("insert session: %v", err)
	}

	memberEmail := "member-" + uuid.New().String()[:8] + "@" + domainName
	_, err = conn.Exec(ctx, `INSERT INTO users (id, org_id, email, password_hash, display_name, role, is_active) VALUES ($1, $2, $3, $4, 'Member', 'member', true)`, memberID, orgID, memberEmail, pwHash)
	if err != nil {
		t.Fatalf("insert member: %v", err)
	}

	// Create root secret row
	_, err = conn.Exec(ctx, `INSERT INTO root_secrets (id, root_secret_wrapped) VALUES ($1, NULL)`, rootSecretID)
	if err != nil {
		t.Fatalf("insert root_secret: %v", err)
	}

	// Sovereign private mailbox with user-wrapped key
	dummySKWrapped := make([]byte, 61)
	rand.Read(dummySKWrapped)
	dummyPK := make([]byte, 32)
	rand.Read(dummyPK)
	userWrappedSK := `{"salt":"aabbcc","ciphertext":"confidential_vault_data"}`

	_, err = conn.Exec(ctx, `
		INSERT INTO mailboxes (
			id, org_id, user_id, domain_id, local_part, mode,
			root_secret_id, mailbox_sk_wrapped, mailbox_pk, wrapped_sk_user,
			key_epoch, signing_key_epoch, key_status, is_active
		) VALUES (
			$1, $2, $3, $4, 'employee', 'private',
			$5, $6, $7, $8,
			1, 1, 'active', true
		)
	`, mailboxID, orgID, memberID, domainID, rootSecretID, dummySKWrapped, dummyPK, userWrappedSK)
	if err != nil {
		t.Fatalf("insert mailbox: %v", err)
	}

	// 1. Admin attempts to impersonate member mailbox -> 403 Forbidden
	impReq := httptest.NewRequest(http.MethodPost, "/v1/organizations/"+orgID+"/mailboxes/"+mailboxID+"/impersonate", nil)
	impReq.SetPathValue("org_id", orgID)
	impReq.SetPathValue("mailbox_id", mailboxID)
	impReq.AddCookie(&http.Cookie{Name: "byos_session", Value: adminToken})
	impReq.Header.Set("X-User-Id", adminID)
	impRec := httptest.NewRecorder()
	mailboxImpersonateHandler(impRec, impReq)

	if impRec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for admin impersonation, got %d: %s", impRec.Code, impRec.Body.String())
	}

	// 2. Admin lists mailboxes via GET /v1/organizations/{org_id}/mailboxes -> wrapped_sk_user is never exposed
	listReq := httptest.NewRequest(http.MethodGet, "/v1/organizations/"+orgID+"/mailboxes", nil)
	listReq.SetPathValue("org_id", orgID)
	listReq.AddCookie(&http.Cookie{Name: "byos_session", Value: adminToken})
	listReq.Header.Set("X-User-Id", adminID)
	listRec := httptest.NewRecorder()
	mailboxesHandler(listRec, listReq)

	if listRec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for mailbox listing, got %d: %s", listRec.Code, listRec.Body.String())
	}
	bodyStr := listRec.Body.String()
	if strings.Contains(bodyStr, "confidential_vault_data") || strings.Contains(bodyStr, "wrapped_sk_user") {
		t.Fatalf("security violation: admin mailbox list leaked employee wrapped_sk_user: %s", bodyStr)
	}
}

func TestDecommissionedRecoveryRoutesReturn404(t *testing.T) {
	// Verify that deprecated recovery endpoints return 404 Not Found on DefaultServeMux
	routes := []string{
		"/v1/organizations/00000000-0000-0000-0000-000000000001/mailboxes/00000000-0000-0000-0000-000000000002/recovery-material",
		"/v1/organizations/00000000-0000-0000-0000-000000000001/recovery-principals",
		"/v1/organizations/00000000-0000-0000-0000-000000000001/recovery-principals/00000000-0000-0000-0000-000000000002",
		"/v1/organizations/00000000-0000-0000-0000-000000000001/recovery-principals/00000000-0000-0000-0000-000000000002/revoke",
		"/v1/organizations/00000000-0000-0000-0000-000000000001/mailboxes/00000000-0000-0000-0000-000000000002/privacy-mode",
	}

	for _, path := range routes {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		rec := httptest.NewRecorder()
		http.DefaultServeMux.ServeHTTP(rec, req)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("expected 404 Not Found for unregistered route %s, got %d", path, rec.Code)
		}
	}
}

func TestOrganizationGetOmitsOrgRecoveryPK(t *testing.T) {
	dsn := getValidatedTestDSN(t)
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Skipf("skipping test; db unreachable: %v", err)
	}
	defer conn.Close(ctx)

	orgID := uuid.New().String()
	userID := uuid.New().String()
	_, err = conn.Exec(ctx, `INSERT INTO organizations (id, name, seat_count, org_recovery_pk) VALUES ($1, $2, 3, decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'))`, orgID, "Get Org")
	if err != nil {
		t.Fatalf("insert org: %v", err)
	}
	defer conn.Exec(ctx, `DELETE FROM organizations WHERE id=$1`, orgID)

	pwHash, _ := hashPassword("password123")
	_, err = conn.Exec(ctx, `INSERT INTO users (id, org_id, email, password_hash, display_name, role, is_active) VALUES ($1, $2, $3, $4, 'User', 'member', true)`, userID, orgID, "user-"+uuid.New().String()[:8]+"@byos.local", pwHash)
	if err != nil {
		t.Fatalf("insert user: %v", err)
	}

	token, tokenHash := generateSessionToken()
	_, err = conn.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day')`, userID, tokenHash)
	if err != nil {
		t.Fatalf("insert session: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/v1/organizations/"+orgID, nil)
	req.SetPathValue("org_id", orgID)
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	req.Header.Set("X-User-Id", userID)
	rec := httptest.NewRecorder()
	organizationGetHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}

	if _, exists := resp["org_recovery_pk"]; exists {
		t.Fatalf("security violation: organization response must not include org_recovery_pk: %v", resp)
	}
	if resp["id"] != orgID || resp["name"] != "Get Org" || resp["seat_count"] != float64(3) {
		t.Fatalf("unexpected organization response payload: %v", resp)
	}
}

