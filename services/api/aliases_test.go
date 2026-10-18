package main

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"byos.email/crypto/envelope"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func setupTestUser(t *testing.T, conn *pgx.Conn, orgName, userPrefix string) (string, string, string, string, string) {
	ctx := context.Background()
	orgID := uuid.New().String()
	userID := uuid.New().String()
	domainID := uuid.New().String()
	domainName := "test-" + uuid.New().String()[:8] + ".org"

	_, err := conn.Exec(ctx, `INSERT INTO organizations (id, name, seat_count, org_recovery_pk) VALUES ($1, $2, 10, decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'))`, orgID, orgName)
	if err != nil {
		t.Fatalf("failed to insert org: %v", err)
	}

	_, err = conn.Exec(ctx, `INSERT INTO domains (id, org_id, name, is_verified) VALUES ($1, $2, $3, true)`, domainID, orgID, domainName)
	if err != nil {
		t.Fatalf("failed to insert domain: %v", err)
	}

	pwHash, _ := hashPassword("password123")
	userEmail := userPrefix + "-" + uuid.New().String()[:8] + "@" + domainName
	_, err = conn.Exec(ctx, `INSERT INTO users (id, org_id, email, password_hash, display_name, role, is_active) VALUES ($1, $2, $3, $4, 'Test User', 'member', true)`, userID, orgID, userEmail, pwHash)
	if err != nil {
		t.Fatalf("failed to insert user: %v", err)
	}

	mbID := uuid.New().String()
	_, err = conn.Exec(ctx, `INSERT INTO mailboxes (id, org_id, user_id, domain_id, local_part, mode, is_active) VALUES ($1, $2, $3, $4, $5, 'private', true)`, mbID, orgID, userID, domainID, userPrefix)
	if err != nil {
		t.Fatalf("failed to insert mailbox: %v", err)
	}

	token, hash := generateSessionToken()
	expires := time.Now().Add(24 * time.Hour)
	_, err = conn.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`, userID, hash, expires)
	if err != nil {
		t.Fatalf("failed to insert session: %v", err)
	}

	t.Cleanup(func() {
		dsn := getValidatedTestDSN(t)
		cleanupConn, err := pgx.Connect(context.Background(), dsn)
		if err == nil {
			defer cleanupConn.Close(context.Background())
			cCtx := context.Background()
			_, _ = cleanupConn.Exec(cCtx, `DELETE FROM masked_alias_reply_map WHERE alias_id IN (SELECT id FROM masked_aliases WHERE user_id=$1)`, userID)
			_, _ = cleanupConn.Exec(cCtx, `DELETE FROM masked_aliases WHERE user_id=$1`, userID)
			_, _ = cleanupConn.Exec(cCtx, `DELETE FROM message_metadata WHERE mailbox_id=$1 OR domain_id=$2`, mbID, domainID)
			_, _ = cleanupConn.Exec(cCtx, `DELETE FROM sessions WHERE user_id=$1`, userID)
			_, _ = cleanupConn.Exec(cCtx, `DELETE FROM mailboxes WHERE org_id=$1`, orgID)
			_, _ = cleanupConn.Exec(cCtx, `DELETE FROM users WHERE org_id=$1`, orgID)
			_, _ = cleanupConn.Exec(cCtx, `DELETE FROM domains WHERE org_id=$1`, orgID)
			_, _ = cleanupConn.Exec(cCtx, `DELETE FROM organizations WHERE id=$1`, orgID)
		}
	})

	return orgID, userID, mbID, domainID, token
}

func loadSignedVectorForAlias(t *testing.T) signedVector {
	t.Helper()
	path := filepath.Join("..", "..", "crypto", "envelope", "testdata", "envelope_signed_rust.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("failed to read test vector file: %v", err)
	}
	var vec signedVector
	if err := json.Unmarshal(data, &vec); err != nil {
		t.Fatalf("failed to parse test vector: %v", err)
	}
	return vec
}

func TestCreateAliasGeneratesUniqueAddress(t *testing.T) {
	dsn := getValidatedTestDSN(t)
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Skipf("skipping test; db unreachable: %v", err)
	}
	defer conn.Close(ctx)

	orgID, _, _, _, token := setupTestUser(t, conn, "Unique Address Org", "unique")
	defer conn.Exec(ctx, `DELETE FROM organizations WHERE id=$1`, orgID)

	aliasPattern := regexp.MustCompile(`^[a-z0-9]{12}@masked\.byos\.local$`)
	seen := make(map[string]bool)

	for i := 0; i < 5; i++ {
		body := bytes.NewBufferString(`{"label":"test-alias"}`)
		req := httptest.NewRequest("POST", "/v1/users/me/aliases", body)
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()

		aliasesHandler(w, req)

		if w.Code != http.StatusCreated {
			t.Fatalf("expected 201 Created, got %d: %s", w.Code, w.Body.String())
		}

		var resp MaskedAliasResponse
		if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
			t.Fatalf("failed to parse response: %v", err)
		}

		if !aliasPattern.MatchString(resp.AliasAddress) {
			t.Fatalf("alias %q does not match pattern %s", resp.AliasAddress, aliasPattern.String())
		}

		if seen[resp.AliasAddress] {
			t.Fatalf("duplicate alias generated: %s", resp.AliasAddress)
		}
		seen[resp.AliasAddress] = true
	}
}

func TestCreateAliasRateLimit(t *testing.T) {
	dsn := getValidatedTestDSN(t)
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Skipf("skipping test; db unreachable: %v", err)
	}
	defer conn.Close(ctx)

	orgID, _, _, _, token := setupTestUser(t, conn, "Rate Limit Org", "ratelimit")
	defer conn.Exec(ctx, `DELETE FROM organizations WHERE id=$1`, orgID)

	// Create 20 aliases
	for i := 0; i < 20; i++ {
		body := bytes.NewBufferString(`{"label":"batch"}`)
		req := httptest.NewRequest("POST", "/v1/users/me/aliases", body)
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()

		aliasesHandler(w, req)
		if w.Code != http.StatusCreated {
			t.Fatalf("alias %d: expected 201 Created, got %d: %s", i+1, w.Code, w.Body.String())
		}
	}

	// 21st attempt must be 429
	body := bytes.NewBufferString(`{"label":"excess"}`)
	req := httptest.NewRequest("POST", "/v1/users/me/aliases", body)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()

	aliasesHandler(w, req)
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429 Too Many Requests, got %d: %s", w.Code, w.Body.String())
	}

	var errResp map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&errResp); err != nil {
		t.Fatalf("failed to parse 429 response: %v", err)
	}
	if errResp["error"] != "rate_limit_exceeded" {
		t.Fatalf("expected error='rate_limit_exceeded', got %v", errResp["error"])
	}
}

func TestListAliasesOnlyOwnUser(t *testing.T) {
	dsn := getValidatedTestDSN(t)
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Skipf("skipping test; db unreachable: %v", err)
	}
	defer conn.Close(ctx)

	orgA, _, _, _, tokenA := setupTestUser(t, conn, "Org A", "usera")
	defer conn.Exec(ctx, `DELETE FROM organizations WHERE id=$1`, orgA)
	orgB, _, _, _, tokenB := setupTestUser(t, conn, "Org B", "userb")
	defer conn.Exec(ctx, `DELETE FROM organizations WHERE id=$1`, orgB)

	// Create alias for User A
	bodyA := bytes.NewBufferString(`{"label":"User A Alias"}`)
	reqA := httptest.NewRequest("POST", "/v1/users/me/aliases", bodyA)
	reqA.Header.Set("Authorization", "Bearer "+tokenA)
	wA := httptest.NewRecorder()
	aliasesHandler(wA, reqA)
	if wA.Code != http.StatusCreated {
		t.Fatalf("User A create failed: %d", wA.Code)
	}
	var createdA MaskedAliasResponse
	json.NewDecoder(wA.Body).Decode(&createdA)

	// Create alias for User B
	bodyB := bytes.NewBufferString(`{"label":"User B Alias"}`)
	reqB := httptest.NewRequest("POST", "/v1/users/me/aliases", bodyB)
	reqB.Header.Set("Authorization", "Bearer "+tokenB)
	wB := httptest.NewRecorder()
	aliasesHandler(wB, reqB)
	if wB.Code != http.StatusCreated {
		t.Fatalf("User B create failed: %d", wB.Code)
	}
	var createdB MaskedAliasResponse
	json.NewDecoder(wB.Body).Decode(&createdB)

	// User A lists aliases: should see only A's alias
	listReqA := httptest.NewRequest("GET", "/v1/users/me/aliases", nil)
	listReqA.Header.Set("Authorization", "Bearer "+tokenA)
	listWA := httptest.NewRecorder()
	aliasesHandler(listWA, listReqA)
	if listWA.Code != http.StatusOK {
		t.Fatalf("User A list failed: %d", listWA.Code)
	}

	var listRespA struct {
		Aliases []MaskedAliasResponse `json:"aliases"`
	}
	json.NewDecoder(listWA.Body).Decode(&listRespA)

	for _, a := range listRespA.Aliases {
		if a.ID == createdB.ID || a.AliasAddress == createdB.AliasAddress {
			t.Fatalf("User A can see User B's alias %s!", a.AliasAddress)
		}
	}
	foundA := false
	for _, a := range listRespA.Aliases {
		if a.ID == createdA.ID {
			foundA = true
			break
		}
	}
	if !foundA {
		t.Fatalf("User A did not see their own alias %s", createdA.AliasAddress)
	}
}

func TestDisableAliasStopsRouting(t *testing.T) {
	dsn := getValidatedTestDSN(t)
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Skipf("skipping test; db unreachable: %v", err)
	}
	defer conn.Close(ctx)

	orgID, _, _, _, token := setupTestUser(t, conn, "Disable Routing Org", "routing")
	defer conn.Exec(ctx, `DELETE FROM organizations WHERE id=$1`, orgID)

	// 1. Create alias
	body := bytes.NewBufferString(`{"label":"Will Disable"}`)
	req := httptest.NewRequest("POST", "/v1/users/me/aliases", body)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	aliasesHandler(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("create failed: %d", w.Code)
	}
	var created MaskedAliasResponse
	json.NewDecoder(w.Body).Decode(&created)

	// 2. Disable alias via PATCH
	patchBody := bytes.NewBufferString(`{"is_enabled":false}`)
	patchReq := httptest.NewRequest("PATCH", "/v1/users/me/aliases/"+created.ID, patchBody)
	patchReq.SetPathValue("id", created.ID)
	patchReq.Header.Set("Authorization", "Bearer "+token)
	patchW := httptest.NewRecorder()
	aliasDetailHandler(patchW, patchReq)
	if patchW.Code != http.StatusOK {
		t.Fatalf("patch failed: %d: %s", patchW.Code, patchW.Body.String())
	}

	var updated MaskedAliasResponse
	json.NewDecoder(patchW.Body).Decode(&updated)
	if updated.IsEnabled != false {
		t.Fatalf("expected is_enabled=false, got true")
	}
	if updated.DisabledAt == nil {
		t.Fatalf("expected disabled_at timestamp to be set")
	}

	// 3. Verify in database that is_enabled = false
	var isEnabled bool
	err = conn.QueryRow(ctx, `SELECT is_enabled FROM masked_aliases WHERE id=$1`, created.ID).Scan(&isEnabled)
	if err != nil || isEnabled {
		t.Fatalf("database row not disabled: %v, %v", err, isEnabled)
	}
}

func TestDeleteAliasClearsReplyMap(t *testing.T) {
	dsn := getValidatedTestDSN(t)
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Skipf("skipping test; db unreachable: %v", err)
	}
	defer conn.Close(ctx)

	orgID, _, mbID, domainID, token := setupTestUser(t, conn, "Delete Cascade Org", "delcasc")
	defer conn.Exec(ctx, `DELETE FROM organizations WHERE id=$1`, orgID)

	// 1. Create alias
	body := bytes.NewBufferString(`{"label":"To Be Deleted"}`)
	req := httptest.NewRequest("POST", "/v1/users/me/aliases", body)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	aliasesHandler(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("create failed: %d", w.Code)
	}
	var created MaskedAliasResponse
	json.NewDecoder(w.Body).Decode(&created)

	// 2. Insert dummy message and reply map row
	msgID := uuid.New().String()
	_, err = conn.Exec(ctx, `
		INSERT INTO message_metadata (
			id, mailbox_id, domain_id, message_seq, direction, delivery_identity, sender, recipients,
			storage_object_id, content_key_hpke_wrapped, mailbox_sk_version, encryption_iv, bundle_hash, status
		) VALUES (
			$1, $2, $3, 1, 'received', decode('1122334455667788112233445566778811223344556677881122334455667788', 'hex'),
			'sender@external.com', ARRAY['target@byos.local'], 'obj-1', 'wrapped', 1, 'iv', 'hash', 'received'
		)
	`, msgID, mbID, domainID)
	if err != nil {
		t.Fatalf("insert message failed: %v", err)
	}

	replyMapID := uuid.New().String()
	_, err = conn.Exec(ctx, `
		INSERT INTO masked_alias_reply_map (id, alias_id, message_id, original_sender)
		VALUES ($1, $2, $3, 'sender@external.com')
	`, replyMapID, created.ID, msgID)
	if err != nil {
		t.Fatalf("insert reply map failed: %v", err)
	}

	// 3. Delete alias via DELETE /v1/users/me/aliases/{id}
	delReq := httptest.NewRequest("DELETE", "/v1/users/me/aliases/"+created.ID, nil)
	delReq.SetPathValue("id", created.ID)
	delReq.Header.Set("Authorization", "Bearer "+token)
	delW := httptest.NewRecorder()
	aliasDetailHandler(delW, delReq)
	if delW.Code != http.StatusNoContent {
		t.Fatalf("expected 204 No Content, got %d: %s", delW.Code, delW.Body.String())
	}

	// 4. Assert that reply_map rows for this alias are cascade-deleted
	var count int
	err = conn.QueryRow(ctx, `SELECT COUNT(*) FROM masked_alias_reply_map WHERE alias_id=$1`, created.ID).Scan(&count)
	if err != nil {
		t.Fatalf("query reply map failed: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected 0 reply map rows after delete, got %d", count)
	}
}

func TestReplyFromAliasUsesAliasAddress(t *testing.T) {
	mockStorage := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/store" {
			w.WriteHeader(http.StatusOK)
			_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(func() { mockStorage.Close() })
	t.Setenv("STORAGE_WORKER_URL", mockStorage.URL)

	dsn := getValidatedTestDSN(t)
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Skipf("skipping test; db unreachable: %v", err)
	}
	defer conn.Close(ctx)

	vec := loadSignedVectorForAlias(t)
	env, err := envelope.UnmarshalCanonical([]byte(vec.EnvelopeJSON))
	if err != nil {
		t.Fatalf("unmarshal vector canonical envelope: %v", err)
	}

	recipientMailboxID := env.KeyID
	senderPKBytes, err := hex.DecodeString(vec.SenderEd25519PublicKeyHex)
	if err != nil {
		t.Fatalf("decode sender PK: %v", err)
	}

	// Clean up any stale data for recipientMailboxID
	_, _ = conn.Exec(ctx, "DELETE FROM message_metadata WHERE mailbox_id = $1", recipientMailboxID)
	_, _ = conn.Exec(ctx, "DELETE FROM mailboxes WHERE id = $1", recipientMailboxID)
	t.Cleanup(func() {
		dsn := getValidatedTestDSN(t)
		cleanupConn, err := pgx.Connect(context.Background(), dsn)
		if err == nil {
			defer cleanupConn.Close(context.Background())
			_, _ = cleanupConn.Exec(context.Background(), "DELETE FROM message_metadata WHERE mailbox_id = $1", recipientMailboxID)
			_, _ = cleanupConn.Exec(context.Background(), "DELETE FROM mailboxes WHERE id = $1", recipientMailboxID)
		}
	})

	orgID, userID, mbID, domainID, token := setupTestUser(t, conn, "Reply Alias Org", "replyuser")
	defer conn.Exec(ctx, `DELETE FROM organizations WHERE id=$1`, orgID)

	// Update sender mailbox to use the vector's sender PK
	_, err = conn.Exec(ctx, `UPDATE mailboxes SET mailbox_ed25519_pk = $1 WHERE id = $2`, senderPKBytes, mbID)
	if err != nil {
		t.Fatalf("update sender mailbox PK failed: %v", err)
	}

	// 1. Create alias
	body := bytes.NewBufferString(`{"label":"Reply Source"}`)
	req := httptest.NewRequest("POST", "/v1/users/me/aliases", body)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	aliasesHandler(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("create failed: %d", w.Code)
	}
	var created MaskedAliasResponse
	json.NewDecoder(w.Body).Decode(&created)

	// 2. Set up recipient mailbox with ID = vector's KeyID
	recUserID := uuid.New().String()
	pwHash, _ := hashPassword("password123")
	_, err = conn.Exec(ctx, `INSERT INTO users (id, org_id, email, password_hash, display_name, role, is_active) VALUES ($1, $2, $3, $4, 'Rec User', 'member', true)`, recUserID, orgID, "rec-"+uuid.New().String()[:8]+"@test.org", pwHash)
	if err != nil {
		t.Fatalf("insert recipient user failed: %v", err)
	}

	_, err = conn.Exec(ctx, `
		INSERT INTO mailboxes (id, org_id, user_id, domain_id, local_part, mode, is_active, key_status, mailbox_xwing_pk, mailbox_ed25519_pk)
		VALUES ($1, $2, $3, $4, 'externalrec', 'private', true, 'active', decode('`+dummyXWingPKHex+`', 'hex'), decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'))
	`, recipientMailboxID, orgID, recUserID, domainID)
	if err != nil {
		t.Fatalf("insert recipient mailbox failed: %v", err)
	}

	var recDomainName string
	conn.QueryRow(ctx, `SELECT name FROM domains WHERE id=$1`, domainID).Scan(&recDomainName)
	cleanRecipient := "externalrec@" + recDomainName

	sendReqPayload := InternalSendRequest{
		EnvelopeJSON:    vec.EnvelopeJSON,
		Recipient:       cleanRecipient,
		SenderMailboxID: mbID,
		AliasID:         created.ID,
	}
	sendPayloadBytes, _ := json.Marshal(sendReqPayload)
	sendReq := httptest.NewRequest("POST", "/v1/outbound/send-internal", bytes.NewReader(sendPayloadBytes))
	sendReq.Header.Set("Authorization", "Bearer "+token)
	sendW := httptest.NewRecorder()

	internalSendHandler(sendW, sendReq)
	if sendW.Code != http.StatusOK && sendW.Code != http.StatusCreated {
		t.Fatalf("internal send failed: %d: %s", sendW.Code, sendW.Body.String())
	}

	var sendResp InternalSendResponse
	json.NewDecoder(sendW.Body).Decode(&sendResp)

	// 3. Assert that recipient's message metadata has sender equal to alias address
	var actualSender string
	err = conn.QueryRow(ctx, `SELECT sender FROM message_metadata WHERE id=$1`, sendResp.MessageID).Scan(&actualSender)
	if err != nil {
		t.Fatalf("query delivered message metadata failed: %v", err)
	}
	if actualSender != created.AliasAddress {
		t.Fatalf("expected sender to be alias %s, got %s", created.AliasAddress, actualSender)
	}

	// 4. Assert that reply_count was incremented in masked_aliases
	var replyCount int
	err = conn.QueryRow(ctx, `SELECT reply_count FROM masked_aliases WHERE id=$1`, created.ID).Scan(&replyCount)
	if err != nil {
		t.Fatalf("query reply count failed: %v", err)
	}
	if replyCount != 1 {
		t.Fatalf("expected reply_count=1, got %d", replyCount)
	}
	_ = userID
}

const dummyXWingPKHex = "0000000000000000000000000000000000000000000000000000000000000000"

func TestValidateCustomLocalPartUnit(t *testing.T) {
	// Valid cases
	validCases := []struct {
		input    string
		expected string
	}{
		{"amazon", "amazon"},
		{"Amazon", "amazon"},
		{"AMAZON-123", "amazon-123"},
		{"user.name_123", "user.name_123"},
		{"abc", "abc"},                                // minimum length (3)
		{"a1234567890123456789012345678901", "a1234567890123456789012345678901"}, // max length (32)
	}

	for _, tc := range validCases {
		res, err := validateCustomLocalPart(tc.input)
		if err != nil {
			t.Fatalf("expected valid for %q, got error: %v", tc.input, err)
		}
		if res != tc.expected {
			t.Fatalf("expected %q, got %q", tc.expected, res)
		}
	}

	// Invalid cases
	invalidCases := []struct {
		input string
		desc  string
	}{
		{"ab", "too short"},
		{"a123456789012345678901234567890123", "too long (33 chars)"},
		{".start", "starts with dot"},
		{"-start", "starts with hyphen"},
		{"_start", "starts with underscore"},
		{"end.", "ends with dot"},
		{"end-", "ends with hyphen"},
		{"end_", "ends with underscore"},
		{"con..sec", "consecutive dots"},
		{"con--sec", "consecutive hyphens"},
		{"con__sec", "consecutive underscores"},
		{"con.-sec", "consecutive dot-hyphen"},
		{"con._sec", "consecutive dot-underscore"},
		{"con-_sec", "consecutive hyphen-underscore"},
		{"bad@char", "invalid character @"},
		{"bad char", "invalid space character"},
		{"bad!char", "invalid exclamation mark"},
		{"admin", "reserved name admin"},
		{"ADMIN", "reserved name uppercase ADMIN"},
		{"administrator", "reserved name administrator"},
		{"root", "reserved name root"},
		{"support", "reserved name support"},
		{"security", "reserved name security"},
		{"no-reply", "reserved name no-reply"},
		{"noreply", "reserved name noreply"},
		{"api", "reserved name api"},
		{"www", "reserved name www"},
	}

	for _, tc := range invalidCases {
		_, err := validateCustomLocalPart(tc.input)
		if err == nil {
			t.Fatalf("expected error for %q (%s), but got nil", tc.input, tc.desc)
		}
	}
}

func TestCreateAliasCustomLocalPart(t *testing.T) {
	dsn := getValidatedTestDSN(t)
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Skipf("skipping test; db unreachable: %v", err)
	}
	defer conn.Close(ctx)

	orgID, _, _, _, token := setupTestUser(t, conn, "Custom Local Part Org", "customlp")
	defer conn.Exec(ctx, `DELETE FROM organizations WHERE id=$1`, orgID)

	body := bytes.NewBufferString(`{"label":"Amazon Orders","local_part":"amazon"}`)
	req := httptest.NewRequest("POST", "/v1/users/me/aliases", body)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()

	aliasesHandler(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created, got %d: %s", w.Code, w.Body.String())
	}

	var resp MaskedAliasResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.AliasAddress != "amazon@masked.byos.local" {
		t.Fatalf("expected amazon@masked.byos.local, got %s", resp.AliasAddress)
	}
	if resp.Label != "Amazon Orders" {
		t.Fatalf("expected label 'Amazon Orders', got %s", resp.Label)
	}
}

func TestCreateAliasCustomRejectsDuplicate(t *testing.T) {
	dsn := getValidatedTestDSN(t)
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Skipf("skipping test; db unreachable: %v", err)
	}
	defer conn.Close(ctx)

	orgID, _, _, _, token := setupTestUser(t, conn, "Custom Dup Org", "customdup")
	defer conn.Exec(ctx, `DELETE FROM organizations WHERE id=$1`, orgID)

	customName := "duplicate-" + uuid.New().String()[:8]

	// First creation succeeds
	body1 := bytes.NewBufferString(`{"label":"First","local_part":"` + customName + `"}`)
	req1 := httptest.NewRequest("POST", "/v1/users/me/aliases", body1)
	req1.Header.Set("Authorization", "Bearer "+token)
	w1 := httptest.NewRecorder()
	aliasesHandler(w1, req1)
	if w1.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created, got %d: %s", w1.Code, w1.Body.String())
	}

	// Second creation with uppercase fails with 409 alias_taken
	body2 := bytes.NewBufferString(`{"label":"Second","local_part":"` + strings.ToUpper(customName) + `"}`)
	req2 := httptest.NewRequest("POST", "/v1/users/me/aliases", body2)
	req2.Header.Set("Authorization", "Bearer "+token)
	w2 := httptest.NewRecorder()
	aliasesHandler(w2, req2)
	if w2.Code != http.StatusConflict {
		t.Fatalf("expected 409 Conflict, got %d: %s", w2.Code, w2.Body.String())
	}

	var errResp map[string]string
	if err := json.NewDecoder(w2.Body).Decode(&errResp); err != nil {
		t.Fatalf("failed to decode JSON error: %v", err)
	}
	if errResp["error"] != "alias_taken" {
		t.Fatalf("expected error='alias_taken', got %v", errResp["error"])
	}
}

func TestCreateAliasCustomRejectsReserved(t *testing.T) {
	dsn := getValidatedTestDSN(t)
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Skipf("skipping test; db unreachable: %v", err)
	}
	defer conn.Close(ctx)

	orgID, _, _, _, token := setupTestUser(t, conn, "Custom Reserved Org", "customres")
	defer conn.Exec(ctx, `DELETE FROM organizations WHERE id=$1`, orgID)

	reservedWords := []string{"admin", "support", "root", "api", "www", "noreply", "no-reply"}
	for _, word := range reservedWords {
		body := bytes.NewBufferString(`{"label":"Reserved","local_part":"` + word + `"}`)
		req := httptest.NewRequest("POST", "/v1/users/me/aliases", body)
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		aliasesHandler(w, req)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 for reserved word %q, got %d: %s", word, w.Code, w.Body.String())
		}
		var errResp map[string]string
		if err := json.NewDecoder(w.Body).Decode(&errResp); err != nil {
			t.Fatalf("failed to decode JSON error: %v", err)
		}
		if errResp["error"] != "invalid_local_part" {
			t.Fatalf("expected error='invalid_local_part', got %v", errResp["error"])
		}
		if errResp["message"] != "This alias name is reserved" {
			t.Fatalf("expected message='This alias name is reserved', got %v", errResp["message"])
		}
	}
}

func TestCreateAliasCustomRejectsInvalidChars(t *testing.T) {
	dsn := getValidatedTestDSN(t)
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Skipf("skipping test; db unreachable: %v", err)
	}
	defer conn.Close(ctx)

	orgID, _, _, _, token := setupTestUser(t, conn, "Custom Invalid Chars Org", "custominv")
	defer conn.Exec(ctx, `DELETE FROM organizations WHERE id=$1`, orgID)

	invalidInputs := []string{"bad@alias", "bad alias", "bad!alias", "bad#alias"}
	for _, input := range invalidInputs {
		body := bytes.NewBufferString(`{"label":"Invalid","local_part":"` + input + `"}`)
		req := httptest.NewRequest("POST", "/v1/users/me/aliases", body)
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		aliasesHandler(w, req)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 for input %q, got %d: %s", input, w.Code, w.Body.String())
		}
		var errResp map[string]string
		if err := json.NewDecoder(w.Body).Decode(&errResp); err != nil {
			t.Fatalf("failed to decode JSON error: %v", err)
		}
		if errResp["error"] != "invalid_local_part" {
			t.Fatalf("expected error='invalid_local_part', got %v", errResp["error"])
		}
		if errResp["message"] != "Only lowercase letters, numbers, and . - _ are allowed" {
			t.Fatalf("expected message='Only lowercase letters, numbers, and . - _ are allowed', got %v", errResp["message"])
		}
	}
}

func TestCreateAliasCustomRejectsLeadingTrailingPunct(t *testing.T) {
	dsn := getValidatedTestDSN(t)
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Skipf("skipping test; db unreachable: %v", err)
	}
	defer conn.Close(ctx)

	orgID, _, _, _, token := setupTestUser(t, conn, "Custom Punct Org", "custompunct")
	defer conn.Exec(ctx, `DELETE FROM organizations WHERE id=$1`, orgID)

	cases := []string{".start", "-start", "_start", "end.", "end-", "end_"}
	for _, c := range cases {
		body := bytes.NewBufferString(`{"label":"Punct","local_part":"` + c + `"}`)
		req := httptest.NewRequest("POST", "/v1/users/me/aliases", body)
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		aliasesHandler(w, req)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 for %q, got %d: %s", c, w.Code, w.Body.String())
		}
		var errResp map[string]string
		if err := json.NewDecoder(w.Body).Decode(&errResp); err != nil {
			t.Fatalf("failed to decode JSON error: %v", err)
		}
		if errResp["message"] != "Must not start or end with ., -, or _" {
			t.Fatalf("expected 'Must not start or end with ., -, or _', got %v", errResp["message"])
		}
	}
}

func TestCreateAliasCustomRejectsConsecutivePunct(t *testing.T) {
	dsn := getValidatedTestDSN(t)
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Skipf("skipping test; db unreachable: %v", err)
	}
	defer conn.Close(ctx)

	orgID, _, _, _, token := setupTestUser(t, conn, "Custom Consec Org", "customconsec")
	defer conn.Exec(ctx, `DELETE FROM organizations WHERE id=$1`, orgID)

	cases := []string{"con..sec", "con--sec", "con__sec", "con.-sec", "con._sec", "con-_sec"}
	for _, c := range cases {
		body := bytes.NewBufferString(`{"label":"Consec","local_part":"` + c + `"}`)
		req := httptest.NewRequest("POST", "/v1/users/me/aliases", body)
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		aliasesHandler(w, req)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 for %q, got %d: %s", c, w.Code, w.Body.String())
		}
		var errResp map[string]string
		if err := json.NewDecoder(w.Body).Decode(&errResp); err != nil {
			t.Fatalf("failed to decode JSON error: %v", err)
		}
		if errResp["message"] != "Must not contain two consecutive ., -, or _ characters" {
			t.Fatalf("expected 'Must not contain two consecutive ., -, or _ characters', got %v", errResp["message"])
		}
	}
}

func TestCreateAliasCustomRejectsTooShort(t *testing.T) {
	dsn := getValidatedTestDSN(t)
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Skipf("skipping test; db unreachable: %v", err)
	}
	defer conn.Close(ctx)

	orgID, _, _, _, token := setupTestUser(t, conn, "Custom Short Org", "customshort")
	defer conn.Exec(ctx, `DELETE FROM organizations WHERE id=$1`, orgID)

	body := bytes.NewBufferString(`{"label":"Short","local_part":"ab"}`)
	req := httptest.NewRequest("POST", "/v1/users/me/aliases", body)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	aliasesHandler(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for 'ab', got %d: %s", w.Code, w.Body.String())
	}
	var errResp map[string]string
	if err := json.NewDecoder(w.Body).Decode(&errResp); err != nil {
		t.Fatalf("failed to decode JSON error: %v", err)
	}
	if errResp["message"] != "Must be at least 3 characters" {
		t.Fatalf("expected 'Must be at least 3 characters', got %v", errResp["message"])
	}
}

func TestCreateAliasCustomRejectsTooLong(t *testing.T) {
	dsn := getValidatedTestDSN(t)
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Skipf("skipping test; db unreachable: %v", err)
	}
	defer conn.Close(ctx)

	orgID, _, _, _, token := setupTestUser(t, conn, "Custom Long Org", "customlong")
	defer conn.Exec(ctx, `DELETE FROM organizations WHERE id=$1`, orgID)

	tooLong := "a123456789012345678901234567890123" // 33 chars
	body := bytes.NewBufferString(`{"label":"Long","local_part":"` + tooLong + `"}`)
	req := httptest.NewRequest("POST", "/v1/users/me/aliases", body)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	aliasesHandler(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for 33 chars, got %d: %s", w.Code, w.Body.String())
	}
	var errResp map[string]string
	if err := json.NewDecoder(w.Body).Decode(&errResp); err != nil {
		t.Fatalf("failed to decode JSON error: %v", err)
	}
	if errResp["message"] != "Must be at most 32 characters" {
		t.Fatalf("expected 'Must be at most 32 characters', got %v", errResp["message"])
	}
}

func TestCreateAliasCustomLowercases(t *testing.T) {
	dsn := getValidatedTestDSN(t)
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Skipf("skipping test; db unreachable: %v", err)
	}
	defer conn.Close(ctx)

	orgID, _, _, _, token := setupTestUser(t, conn, "Custom Lowercase Org", "customlower")
	defer conn.Exec(ctx, `DELETE FROM organizations WHERE id=$1`, orgID)

	body := bytes.NewBufferString(`{"label":"Mixed Case","local_part":"MyCustomAlias"}`)
	req := httptest.NewRequest("POST", "/v1/users/me/aliases", body)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	aliasesHandler(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created, got %d: %s", w.Code, w.Body.String())
	}

	var resp MaskedAliasResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.AliasAddress != "mycustomalias@masked.byos.local" {
		t.Fatalf("expected 'mycustomalias@masked.byos.local', got %s", resp.AliasAddress)
	}
}

func TestCreateAliasCustomRespectsRateLimit(t *testing.T) {
	dsn := getValidatedTestDSN(t)
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Skipf("skipping test; db unreachable: %v", err)
	}
	defer conn.Close(ctx)

	orgID, _, _, _, token := setupTestUser(t, conn, "Custom Rate Limit Org", "customrate")
	defer conn.Exec(ctx, `DELETE FROM organizations WHERE id=$1`, orgID)

	// Create 20 aliases
	for i := 0; i < 20; i++ {
		body := bytes.NewBufferString(`{"label":"batch"}`)
		req := httptest.NewRequest("POST", "/v1/users/me/aliases", body)
		req.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()

		aliasesHandler(w, req)
		if w.Code != http.StatusCreated {
			t.Fatalf("alias %d: expected 201 Created, got %d: %s", i+1, w.Code, w.Body.String())
		}
	}

	// 21st attempt with custom local part must be 429
	body := bytes.NewBufferString(`{"label":"excess","local_part":"custom-21"}`)
	req := httptest.NewRequest("POST", "/v1/users/me/aliases", body)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()

	aliasesHandler(w, req)
	if w.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429 Too Many Requests, got %d: %s", w.Code, w.Body.String())
	}

	var errResp map[string]interface{}
	if err := json.NewDecoder(w.Body).Decode(&errResp); err != nil {
		t.Fatalf("failed to parse 429 response: %v", err)
	}
	if errResp["error"] != "rate_limit_exceeded" {
		t.Fatalf("expected error='rate_limit_exceeded', got %v", errResp["error"])
	}
}

