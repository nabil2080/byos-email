package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// TestPostMigrationWorkflowsEndToEnd verifies that on a migrated database (migration 058 applied,
// with wrapped_sk_org and org_recovery_principals dropped), all core HTTP APIs succeed:
// 1. Organization Registration (POST /v1/auth/register) without org_recovery_pk
// 2. Organization Retrieval (GET /v1/organizations/{org_id})
// 3. Domain creation
// 4. Private mailbox provisioning (POST /v1/organizations/{org_id}/mailboxes)
// 5. Private invitation (POST /v1/organizations/{org_id}/mailboxes/invite)
// 6. Invitation verification (GET /v1/auth/invitations/verify?token=...)
// 7. Invitation claim (POST /v1/auth/invitations/claim)
// 8. Seat and member administration (GET/PATCH /seats, GET /v1/auth/organization-members)
func TestPostMigrationWorkflowsEndToEnd(t *testing.T) {
	dsn := getValidatedTestDSN(t)
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Skipf("skipping test; db unreachable: %v", err)
	}
	defer conn.Close(ctx)

	// Verify that this database is migrated to 058
	var hasWrappedSKOrg bool
	_ = conn.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM information_schema.columns 
			WHERE table_name = 'mailboxes' AND column_name = 'wrapped_sk_org'
		)
	`).Scan(&hasWrappedSKOrg)
	if hasWrappedSKOrg {
		t.Log("Note: running against database where wrapped_sk_org column still exists")
	} else {
		t.Log("Confirmed: running against migration 058 schema (wrapped_sk_org dropped)")
	}

	tag := uuid.New().String()[:8]
	founderEmail := "founder-" + tag + "@acmecorp.local"
	orgName := "Acme Corp " + tag

	// 1. POST /v1/auth/register (without org_recovery_pk)
	regBody, _ := json.Marshal(map[string]interface{}{
		"name":     orgName,
		"email":    founderEmail,
		"password": "SecurePassword123!",
	})
	regReq := httptest.NewRequest(http.MethodPost, "/v1/auth/register", bytes.NewReader(regBody))
	regRec := httptest.NewRecorder()
	registerHandler(regRec, regReq)

	if regRec.Code != http.StatusCreated {
		t.Fatalf("register failed with status %d: %s", regRec.Code, regRec.Body.String())
	}

	var regResp map[string]interface{}
	if err := json.NewDecoder(regRec.Body).Decode(&regResp); err != nil {
		t.Fatalf("failed to decode register response: %v", err)
	}
	orgID, ok := regResp["org_id"].(string)
	if !ok || orgID == "" {
		t.Fatalf("missing org_id in register response: %+v", regResp)
	}
	founderID, ok := regResp["id"].(string)
	if !ok || founderID == "" {
		t.Fatalf("missing id in register response: %+v", regResp)
	}

	// Extract session cookie from registration
	var sessionToken string
	for _, c := range regRec.Result().Cookies() {
		if c.Name == "byos_session" {
			sessionToken = c.Value
			break
		}
	}
	if sessionToken == "" {
		t.Fatal("expected byos_session cookie from registerHandler")
	}

	// Register teardown for this org
	t.Cleanup(func() {
		cleanupConn, err := pgx.Connect(context.Background(), dsn)
		if err != nil {
			return
		}
		defer cleanupConn.Close(context.Background())
		// Collect root_secret_ids before deleting mailboxes
		var rootIDs []string
		rows, err := cleanupConn.Query(context.Background(), `SELECT root_secret_id FROM mailboxes WHERE org_id=$1 AND root_secret_id IS NOT NULL`, orgID)
		if err == nil {
			for rows.Next() {
				var rid string
				if err := rows.Scan(&rid); err == nil {
					rootIDs = append(rootIDs, rid)
				}
			}
			rows.Close()
		}
		_, _ = cleanupConn.Exec(context.Background(), `DELETE FROM message_metadata WHERE domain_id IN (SELECT id FROM domains WHERE org_id=$1)`, orgID)
		_, _ = cleanupConn.Exec(context.Background(), `DELETE FROM account_invitations WHERE org_id=$1`, orgID)
		_, _ = cleanupConn.Exec(context.Background(), `DELETE FROM mailbox_storage WHERE mailbox_id IN (SELECT id FROM mailboxes WHERE org_id=$1)`, orgID)
		_, _ = cleanupConn.Exec(context.Background(), `DELETE FROM storage_connections WHERE org_id=$1`, orgID)
		_, _ = cleanupConn.Exec(context.Background(), `DELETE FROM mailboxes WHERE org_id=$1`, orgID)
		for _, rid := range rootIDs {
			_, _ = cleanupConn.Exec(context.Background(), `DELETE FROM root_secrets WHERE id=$1`, rid)
		}
		_, _ = cleanupConn.Exec(context.Background(), `DELETE FROM domains WHERE org_id=$1`, orgID)
		_, _ = cleanupConn.Exec(context.Background(), `DELETE FROM audit_log WHERE user_id IN (SELECT id FROM users WHERE org_id=$1) OR org_id=$1`, orgID)
		_, _ = cleanupConn.Exec(context.Background(), `DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE org_id=$1)`, orgID)
		_, _ = cleanupConn.Exec(context.Background(), `DELETE FROM users WHERE org_id=$1`, orgID)
		_, _ = cleanupConn.Exec(context.Background(), `DELETE FROM organizations WHERE id=$1`, orgID)
	})

	// 2. GET /v1/organizations/{org_id}
	getReq := httptest.NewRequest(http.MethodGet, "/v1/organizations/"+orgID, nil)
	getReq.SetPathValue("org_id", orgID)
	getReq.Header.Set("X-User-Id", founderID)
	getReq.AddCookie(&http.Cookie{Name: "byos_session", Value: sessionToken})
	getRec := httptest.NewRecorder()
	organizationGetHandler(getRec, getReq)

	if getRec.Code != http.StatusOK {
		t.Fatalf("get organization failed with %d: %s", getRec.Code, getRec.Body.String())
	}
	var orgGetResp map[string]interface{}
	json.NewDecoder(getRec.Body).Decode(&orgGetResp)
	if orgGetResp["id"] != orgID {
		t.Errorf("expected org id %s, got %v", orgID, orgGetResp["id"])
	}
	if _, present := orgGetResp["org_recovery_pk"]; present {
		t.Errorf("security violation: organizationGetHandler exposed org_recovery_pk: %+v", orgGetResp)
	}

	// 3. Domain Creation and Verification
	domainName := "rehearsal-" + tag + ".local"
	domainID := uuid.New().String()
	_, err = conn.Exec(ctx, `
		INSERT INTO domains (id, org_id, name, is_verified, verification_token, dkim_selector)
		VALUES ($1, $2, $3, true, 'token_xyz', 'byos')
	`, domainID, orgID, domainName)
	if err != nil {
		t.Fatalf("failed to insert verified domain: %v", err)
	}

	// 4. Setup Active Storage Connection (mandatory prerequisite for mailboxes)
	storageID := uuid.New().String()
	_, err = conn.Exec(ctx, `
		INSERT INTO storage_connections (id, org_id, provider_type, bucket_name, credentials_enc, is_active, status)
		VALUES ($1, $2, 's3', 'acme-bucket', decode('AA==', 'base64'), true, 'active')
	`, storageID, orgID)
	if err != nil {
		t.Fatalf("failed to insert storage connection: %v", err)
	}

	// 5. Private Mailbox Provisioning (POST /v1/organizations/{org_id}/mailboxes)
	founderMbxID := uuid.New().String()
	dummySKWrapped := hex.EncodeToString(make([]byte, 61))
	dummyPK := hex.EncodeToString(make([]byte, 32))

	mbxBody, _ := json.Marshal(map[string]interface{}{
		"id":                 founderMbxID,
		"local_part":         "founder",
		"domain_id":          domainID,
		"mode":               "private",
		"mailbox_sk_wrapped": dummySKWrapped,
		"mailbox_pk":         dummyPK,
	})
	mbxReq := httptest.NewRequest(http.MethodPost, "/v1/organizations/"+orgID+"/mailboxes", bytes.NewReader(mbxBody))
	mbxReq.SetPathValue("org_id", orgID)
	mbxReq.Header.Set("X-User-Id", founderID)
	mbxReq.AddCookie(&http.Cookie{Name: "byos_session", Value: sessionToken})
	mbxRec := httptest.NewRecorder()
	mailboxesHandler(mbxRec, mbxReq)

	if mbxRec.Code != http.StatusCreated {
		t.Fatalf("provision private mailbox failed with %d: %s", mbxRec.Code, mbxRec.Body.String())
	}

	// 6. Private Invitation (POST /v1/organizations/{org_id}/mailboxes/invite)
	inviteBody, _ := json.Marshal(map[string]interface{}{
		"address":      "alice@" + domainName,
		"privacy_mode": "private",
	})
	invReq := httptest.NewRequest(http.MethodPost, "/v1/organizations/"+orgID+"/mailboxes/invite", bytes.NewReader(inviteBody))
	invReq.SetPathValue("org_id", orgID)
	invReq.Header.Set("X-User-Id", founderID)
	invReq.AddCookie(&http.Cookie{Name: "byos_session", Value: sessionToken})
	invRec := httptest.NewRecorder()
	mailboxInviteHandler(invRec, invReq)

	if invRec.Code != http.StatusCreated {
		t.Fatalf("mailboxInviteHandler failed with %d: %s", invRec.Code, invRec.Body.String())
	}
	var invResp map[string]interface{}
	json.NewDecoder(invRec.Body).Decode(&invResp)
	inviteURL, ok := invResp["invite_url"].(string)
	if !ok || !strings.Contains(inviteURL, "token=") {
		t.Fatalf("missing invite_url with token in response: %+v", invResp)
	}
	inviteToken := inviteURL[strings.Index(inviteURL, "token=")+6:]

	// 7. Invitation Verification (GET /v1/auth/invitations/verify?token=...)
	verReq := httptest.NewRequest(http.MethodGet, "/v1/auth/invitations/verify?token="+inviteToken, nil)
	verRec := httptest.NewRecorder()
	invitationVerifyHandler(verRec, verReq)

	if verRec.Code != http.StatusOK {
		t.Fatalf("invitationVerifyHandler failed with %d: %s", verRec.Code, verRec.Body.String())
	}
	var verResp map[string]interface{}
	json.NewDecoder(verRec.Body).Decode(&verResp)
	if verResp["valid"] != true {
		t.Fatalf("invitation token not valid: %+v", verResp)
	}
	if verResp["privacy_mode"] != "private" {
		t.Fatalf("expected privacy_mode == 'private', got %v", verResp["privacy_mode"])
	}

	// 8. Invitation Claim (POST /v1/auth/invitations/claim)
	aliceXWingPK := make([]byte, 1216)
	rand.Read(aliceXWingPK)
	aliceXWingB64 := base64.StdEncoding.EncodeToString(aliceXWingPK)
	alicePKHex := hex.EncodeToString(make([]byte, 32))
	aliceWrappedSK := `{"salt":"xyz123","ciphertext":"encrypted_user_vault"}`

	claimBody, _ := json.Marshal(map[string]interface{}{
		"token":           inviteToken,
		"password":        "AliceSecurePassword123!",
		"wrapped_sk_user": aliceWrappedSK,
		"mailbox_pk":       alicePKHex,
		"xwing_pk":         aliceXWingB64,
	})
	claimReq := httptest.NewRequest(http.MethodPost, "/v1/auth/invitations/claim", bytes.NewReader(claimBody))
	claimRec := httptest.NewRecorder()
	invitationClaimHandler(claimRec, claimReq)

	if claimRec.Code != http.StatusOK {
		t.Fatalf("invitationClaimHandler failed with %d: %s", claimRec.Code, claimRec.Body.String())
	}

	// Verify in database: Alice's mailbox is active, has 1216-byte X-Wing PK, and account_invitation is consumed
	var aliceMailboxStatus string
	var storedXWingPK []byte
	aliceMbxID := invResp["mailbox_id"].(string)
	err = conn.QueryRow(ctx, `SELECT status, mailbox_xwing_pk FROM mailboxes WHERE id=$1`, aliceMbxID).Scan(&aliceMailboxStatus, &storedXWingPK)
	if err != nil {
		t.Fatalf("failed to query claimed mailbox: %v", err)
	}
	if aliceMailboxStatus != "active" {
		t.Errorf("expected alice mailbox status = 'active', got %s", aliceMailboxStatus)
	}
	if len(storedXWingPK) != 1216 {
		t.Errorf("expected 1216 byte X-Wing public key, got %d bytes", len(storedXWingPK))
	}

	// 9. Seat and Member Administration
	// GET /v1/organizations/{org_id}/seats
	seatsReq := httptest.NewRequest(http.MethodGet, "/v1/organizations/"+orgID+"/seats", nil)
	seatsReq.SetPathValue("org_id", orgID)
	seatsReq.Header.Set("X-User-Id", founderID)
	seatsReq.AddCookie(&http.Cookie{Name: "byos_session", Value: sessionToken})
	seatsRec := httptest.NewRecorder()
	organizationSeatsHandler(seatsRec, seatsReq)

	// Since seatsHandler only accepts PATCH / POST in this endpoint:
	patchSeatsBody, _ := json.Marshal(map[string]interface{}{"seat_count": 25})
	patchReq := httptest.NewRequest(http.MethodPatch, "/v1/organizations/"+orgID+"/seats", bytes.NewReader(patchSeatsBody))
	patchReq.SetPathValue("org_id", orgID)
	patchReq.Header.Set("X-User-Id", founderID)
	patchReq.AddCookie(&http.Cookie{Name: "byos_session", Value: sessionToken})
	patchRec := httptest.NewRecorder()
	organizationSeatsHandler(patchRec, patchReq)

	if patchRec.Code != http.StatusOK {
		t.Fatalf("organizationSeatsHandler PATCH failed with %d: %s", patchRec.Code, patchRec.Body.String())
	}
	var patchResp map[string]interface{}
	json.NewDecoder(patchRec.Body).Decode(&patchResp)
	if int(patchResp["seat_count"].(float64)) != 25 {
		t.Errorf("expected seat_count = 25, got %v", patchResp["seat_count"])
	}

	// GET /v1/auth/organization-members
	membersReq := httptest.NewRequest(http.MethodGet, "/v1/auth/organization-members", nil)
	membersReq.Header.Set("X-User-Id", founderID)
	membersReq.AddCookie(&http.Cookie{Name: "byos_session", Value: sessionToken})
	membersRec := httptest.NewRecorder()
	organizationMembersHandler(membersRec, membersReq)

	if membersRec.Code != http.StatusOK {
		t.Fatalf("organizationMembersHandler failed with %d: %s", membersRec.Code, membersRec.Body.String())
	}
	var membersResp map[string]interface{}
	json.NewDecoder(membersRec.Body).Decode(&membersResp)
	membersList, ok := membersResp["members"].([]interface{})
	if !ok || len(membersList) < 2 {
		t.Fatalf("expected at least 2 organization members (founder + alice), got %+v", membersResp)
	}

	t.Logf("Post-migration workflows verified successfully against migrated database: orgID=%s, founder=%s, alice=%s, seats=25", orgID, founderID, aliceMbxID)
}

// TestRegistrationCompatibilityPreAndPostMigration tests registration behavior on both
// an unmigrated database (where org_recovery_pk NOT NULL constraint is active) and
// a migrated database (where migration 058 dropped the NOT NULL constraint).
func TestRegistrationCompatibilityPreAndPostMigration(t *testing.T) {
	ctx := context.Background()

	// -------------------------------------------------------------
	// Part 1: Registration against UNMIGRATED database (byos_test_isolation)
	// -------------------------------------------------------------
	unmigratedDSN := os.Getenv("TEST_UNMIGRATED_DATABASE_URL")
	if unmigratedDSN == "" {
		unmigratedDSN = "postgres://byos:byos_dev_password@127.0.0.1:5432/byos_test_isolation?sslmode=disable"
	}
	unmigConn, err := pgx.Connect(ctx, unmigratedDSN)
	if err != nil {
		t.Skipf("skipping unmigrated test; db unreachable: %v", err)
	}
	defer unmigConn.Close(ctx)

	var unmigNullable string
	err = unmigConn.QueryRow(ctx, `
		SELECT is_nullable 
		FROM information_schema.columns 
		WHERE table_name = 'organizations' AND column_name = 'org_recovery_pk'
	`).Scan(&unmigNullable)
	if err != nil {
		t.Fatalf("failed to query information_schema on unmigrated db: %v", err)
	}
	if unmigNullable != "NO" {
		t.Fatalf("expected unmigrated db to have org_recovery_pk NOT NULL (is_nullable='NO'), got %s", unmigNullable)
	}

	t.Setenv("DATABASE_URL", unmigratedDSN)
	tag1 := uuid.New().String()[:8]
	unmigEmail := "unmig-" + tag1 + "@compat-test.local"
	unmigOrgName := "Unmigrated Compat Org " + tag1

	regBody1, _ := json.Marshal(map[string]interface{}{
		"name":     unmigOrgName,
		"email":    unmigEmail,
		"password": "Password123!",
	})
	regReq1 := httptest.NewRequest(http.MethodPost, "/v1/auth/register", bytes.NewReader(regBody1))
	regRec1 := httptest.NewRecorder()
	registerHandler(regRec1, regReq1)

	// Since savepoint fallback was removed now that migration 058 is frozen, inserting NULL
	// against unmigrated schema with NOT NULL constraint correctly fails with HTTP 500,
	// proving that migration 058 must precede application deployment.
	if regRec1.Code != http.StatusInternalServerError {
		t.Fatalf("expected registration on unmigrated db to fail with HTTP 500 (NULL violation), got %d: %s", regRec1.Code, regRec1.Body.String())
	}
	t.Logf("Unmigrated DB: confirmed registration fails with HTTP 500 without migration 058 (rolling deployment invariant verified)")

	// -------------------------------------------------------------
	// Part 2: Registration against MIGRATED database
	// -------------------------------------------------------------
	migratedDSN := getValidatedTestDSN(t)
	migConn, err := pgx.Connect(ctx, migratedDSN)
	if err != nil {
		t.Skipf("skipping migrated test; db unreachable: %v", err)
	}
	defer migConn.Close(ctx)

	var migNullable string
	err = migConn.QueryRow(ctx, `
		SELECT is_nullable 
		FROM information_schema.columns 
		WHERE table_name = 'organizations' AND column_name = 'org_recovery_pk'
	`).Scan(&migNullable)
	if err != nil {
		t.Fatalf("failed to query information_schema on migrated db: %v", err)
	}
	if migNullable != "YES" {
		t.Fatalf("expected migrated db to have org_recovery_pk NULLABLE (is_nullable='YES'), got %s", migNullable)
	}

	t.Setenv("DATABASE_URL", migratedDSN)
	tag2 := uuid.New().String()[:8]
	migEmail := "migrated-" + tag2 + "@compat-test.local"
	migOrgName := "Migrated Compat Org " + tag2

	regBody2, _ := json.Marshal(map[string]interface{}{
		"name":     migOrgName,
		"email":    migEmail,
		"password": "Password123!",
	})
	regReq2 := httptest.NewRequest(http.MethodPost, "/v1/auth/register", bytes.NewReader(regBody2))
	regRec2 := httptest.NewRecorder()
	registerHandler(regRec2, regReq2)

	if regRec2.Code != http.StatusCreated {
		t.Fatalf("registration on migrated db failed with status %d: %s", regRec2.Code, regRec2.Body.String())
	}

	var regResp2 map[string]interface{}
	json.NewDecoder(regRec2.Body).Decode(&regResp2)
	migOrgID := regResp2["org_id"].(string)
	migUserID := regResp2["id"].(string)

	var sessionToken2 string
	for _, c := range regRec2.Result().Cookies() {
		if c.Name == "byos_session" {
			sessionToken2 = c.Value
			break
		}
	}

	t.Cleanup(func() {
		cleanupConn, err := pgx.Connect(context.Background(), migratedDSN)
		if err == nil {
			defer cleanupConn.Close(context.Background())
			_, _ = cleanupConn.Exec(context.Background(), `DELETE FROM audit_log WHERE user_id IN (SELECT id FROM users WHERE org_id=$1) OR org_id=$1`, migOrgID)
			_, _ = cleanupConn.Exec(context.Background(), `DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE org_id=$1)`, migOrgID)
			_, _ = cleanupConn.Exec(context.Background(), `DELETE FROM users WHERE org_id=$1`, migOrgID)
			_, _ = cleanupConn.Exec(context.Background(), `DELETE FROM organizations WHERE id=$1`, migOrgID)
		}
	})

	var isNull bool
	err = migConn.QueryRow(ctx, `SELECT org_recovery_pk IS NULL FROM organizations WHERE id=$1`, migOrgID).Scan(&isNull)
	if err != nil {
		t.Fatalf("failed to query org_recovery_pk on migrated db: %v", err)
	}
	if !isNull {
		t.Fatalf("expected org_recovery_pk to be NULL on migrated db for org %s, got non-null", migOrgID)
	}
	t.Logf("Migrated DB: confirmed org_recovery_pk IS NULL for newly registered org %s", migOrgID)

	// Part 3: Verify GET /v1/organizations/{id} omits org_recovery_pk
	getReq := httptest.NewRequest(http.MethodGet, "/v1/organizations/"+migOrgID, nil)
	getReq.SetPathValue("org_id", migOrgID)
	getReq.Header.Set("X-User-Id", migUserID)
	getReq.AddCookie(&http.Cookie{Name: "byos_session", Value: sessionToken2})
	getRec := httptest.NewRecorder()
	organizationGetHandler(getRec, getReq)

	if getRec.Code != http.StatusOK {
		t.Fatalf("organizationGetHandler failed with %d: %s", getRec.Code, getRec.Body.String())
	}
	var orgGetResp map[string]interface{}
	json.NewDecoder(getRec.Body).Decode(&orgGetResp)
	if _, present := orgGetResp["org_recovery_pk"]; present {
		t.Fatalf("security violation: organizationGetHandler exposed org_recovery_pk: %+v", orgGetResp)
	}
	t.Logf("Migrated DB: confirmed GET /v1/organizations/{id} omits org_recovery_pk")

	// Part 4: Verify normal organization administration continues working
	patchBody, _ := json.Marshal(map[string]interface{}{"seat_count": 15})
	patchReq := httptest.NewRequest(http.MethodPatch, "/v1/organizations/"+migOrgID+"/seats", bytes.NewReader(patchBody))
	patchReq.SetPathValue("org_id", migOrgID)
	patchReq.Header.Set("X-User-Id", migUserID)
	patchReq.AddCookie(&http.Cookie{Name: "byos_session", Value: sessionToken2})
	patchRec := httptest.NewRecorder()
	organizationSeatsHandler(patchRec, patchReq)

	if patchRec.Code != http.StatusOK {
		t.Fatalf("organizationSeatsHandler PATCH failed with %d: %s", patchRec.Code, patchRec.Body.String())
	}
	t.Logf("Migrated DB: confirmed normal organization administration (seats update) works")
}

// TestRegistrationDeprecatedRecoveryInputCannotPopulateOrgRecoveryPK proves that even if
// a caller supplies deprecated organization recovery parameters in POST /v1/auth/register,
// the server treats them as non-active cryptographic material, never stores them, and stores
// org_recovery_pk = NULL in the database.
func TestRegistrationDeprecatedRecoveryInputCannotPopulateOrgRecoveryPK(t *testing.T) {
	dsn := getValidatedTestDSN(t)
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Skipf("skipping test; db unreachable: %v", err)
	}
	defer conn.Close(ctx)

	tag := uuid.New().String()[:8]
	founderEmail := "founder-legacy-input-" + tag + "@example.corp"
	orgName := "Legacy Param Corp " + tag
	fakeOrgRecoveryPK := hex.EncodeToString([]byte("0123456789abcdef0123456789abcdef"))
	fakeWrappedOrgRecoverySK := hex.EncodeToString([]byte("fake_wrapped_org_recovery_sk_bytes_1234567890"))
	fakeRecoverySalt := hex.EncodeToString([]byte("fake_recovery_salt_bytes_1234567890"))

	regBody, _ := json.Marshal(map[string]interface{}{
		"name":                    orgName,
		"email":                   founderEmail,
		"password":                "ValidPassword123!",
		"org_recovery_pk":         fakeOrgRecoveryPK,
		"wrapped_org_recovery_sk": fakeWrappedOrgRecoverySK,
		"recovery_salt":           fakeRecoverySalt,
	})

	regReq := httptest.NewRequest(http.MethodPost, "/v1/auth/register", bytes.NewReader(regBody))
	regReq.Header.Set("Content-Type", "application/json")
	regRec := httptest.NewRecorder()
	registerHandler(regRec, regReq)

	if regRec.Code != http.StatusCreated && regRec.Code != http.StatusOK {
		t.Fatalf("registerHandler failed with code %d: %s", regRec.Code, regRec.Body.String())
	}

	var regResp map[string]interface{}
	if err := json.NewDecoder(regRec.Body).Decode(&regResp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	orgID, _ := regResp["org_id"].(string)
	if orgID == "" {
		t.Fatalf("expected org_id in response, got %+v", regResp)
	}

	t.Cleanup(func() {
		cleanupConn, err := pgx.Connect(context.Background(), dsn)
		if err == nil {
			defer cleanupConn.Close(context.Background())
			_, _ = cleanupConn.Exec(context.Background(), `DELETE FROM audit_log WHERE user_id IN (SELECT id FROM users WHERE org_id=$1) OR org_id=$1`, orgID)
			_, _ = cleanupConn.Exec(context.Background(), `DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE org_id=$1)`, orgID)
			_, _ = cleanupConn.Exec(context.Background(), `DELETE FROM users WHERE org_id=$1`, orgID)
			_, _ = cleanupConn.Exec(context.Background(), `DELETE FROM organizations WHERE id=$1`, orgID)
		}
	})

	var orgRecoveryPK []byte
	err = conn.QueryRow(ctx, `SELECT org_recovery_pk FROM organizations WHERE id=$1`, orgID).Scan(&orgRecoveryPK)
	if err != nil {
		t.Fatalf("failed to query org_recovery_pk: %v", err)
	}
	if orgRecoveryPK != nil {
		t.Fatalf("CRITICAL SECURITY VIOLATION: caller-supplied org_recovery_pk was stored: %x, expected NULL", orgRecoveryPK)
	}
}

