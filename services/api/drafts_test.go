package main

// Step 8 Slice B tests: Draft create / list / get-one + authorization +
// ciphertext passthrough. Real PostgreSQL, real handler code paths.
// Slice C (update/versioning) and Slice D (delete) are explicitly out of
// scope here; unsupported methods are asserted as 405.

import (
	"bytes"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// testEnvelope returns a deterministic structurally-valid Section 12
// envelope: 0x01 || 12-byte nonce || 16-byte ciphertext. It is opaque
// ciphertext, never plaintext.
func testEnvelope() []byte {
	env := []byte{0x01}
	env = append(env, []byte("0123456789ab")...)
	env = append(env, []byte("0123456789abcdef")...)
	return env
}

func testEnvelopeB64() string {
	return base64.StdEncoding.EncodeToString(testEnvelope())
}

type draftJSON struct {
	ID                string `json:"id"`
	MailboxID         string `json:"mailbox_id"`
	Subject           string `json:"subject"`
	Recipient         string `json:"recipient"`
	EncryptedEnvelope string `json:"encrypted_envelope"`
	Version           int    `json:"version"`
}

// createTestMailbox creates a verified domain and an org-managed mailbox.
// Returns domain and mailbox IDs.
func createTestMailbox(t *testing.T, db *sql.DB, orgID, userID string) (domainID, mailboxID string) {
	t.Helper()
	if err := db.QueryRow(`INSERT INTO domains (org_id, name, is_verified) VALUES ($1, 'draft-test.local', true) RETURNING id`, orgID).Scan(&domainID); err != nil {
		t.Fatalf("failed to insert domain: %v", err)
	}
	var rootID string
	if err := db.QueryRow(`INSERT INTO root_secrets (root_secret_wrapped) VALUES (decode('AA==','base64')) RETURNING id`).Scan(&rootID); err != nil {
		t.Fatalf("failed to insert root secret: %v", err)
	}
	if err := db.QueryRow(`INSERT INTO mailboxes (org_id, user_id, domain_id, local_part, mode, root_secret_id, mailbox_sk_wrapped, mailbox_pk) VALUES ($1, $2, $3, 'drafter', 'org_managed', $4, decode('AA==','base64'), decode('AA==','base64')) RETURNING id`, orgID, userID, domainID, rootID).Scan(&mailboxID); err != nil {
		t.Fatalf("failed to insert mailbox: %v", err)
	}
	return domainID, mailboxID
}

func draftRequest(t *testing.T, method, url, body, userToken string) *httptest.ResponseRecorder {
	t.Helper()
	var reader *bytes.Reader
	if body == "" {
		reader = bytes.NewReader(nil)
	} else {
		reader = bytes.NewReader([]byte(body))
	}
	req := httptest.NewRequest(method, url, reader)
	if userToken != "" {
		req.AddCookie(&http.Cookie{Name: "byos_session", Value: userToken, Path: "/"})
	}
	w := httptest.NewRecorder()
	draftsHandler(w, req)
	return w
}

func TestDraftCreateListGet(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	_, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, mustOrg(t, db, ownerID), ownerID)
	token := createSession(t, db, ownerID)
	envB64 := testEnvelopeB64()

	// CREATE -> 201 with version 1 and exact envelope echo.
	w := draftRequest(t, http.MethodPost, "/v1/mailboxes/"+mailboxID+"/drafts",
		`{"subject":"Hello","recipient":"a@b.local","encrypted_envelope":"`+envB64+`"}`, token)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var created draftJSON
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatalf("invalid create response: %v", err)
	}
	if created.Version != 1 {
		t.Errorf("expected version 1, got %d", created.Version)
	}
	if created.Subject != "Hello" || created.Recipient != "a@b.local" || created.MailboxID != mailboxID {
		t.Errorf("metadata mismatch: %+v", created)
	}
	if created.EncryptedEnvelope != envB64 {
		t.Errorf("returned envelope does not match submitted bytes")
	}
	if created.ID == "" {
		t.Fatalf("missing draft id")
	}

	// LIST -> 200, exactly this mailbox's draft, envelope preserved.
	w = draftRequest(t, http.MethodGet, "/v1/mailboxes/"+mailboxID+"/drafts", "", token)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var list struct {
		Drafts []draftJSON `json:"drafts"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &list); err != nil {
		t.Fatalf("invalid list response: %v", err)
	}
	if len(list.Drafts) != 1 {
		t.Fatalf("expected 1 draft, got %d", len(list.Drafts))
	}
	if list.Drafts[0].EncryptedEnvelope != envB64 || list.Drafts[0].Version != 1 {
		t.Errorf("list item mismatch: %+v", list.Drafts[0])
	}

	// GET ONE -> 200 with identical envelope.
	w = draftRequest(t, http.MethodGet, "/v1/mailboxes/"+mailboxID+"/drafts/"+created.ID, "", token)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var one draftJSON
	if err := json.Unmarshal(w.Body.Bytes(), &one); err != nil {
		t.Fatalf("invalid get response: %v", err)
	}
	if one.EncryptedEnvelope != envB64 {
		t.Errorf("get-one envelope does not match submitted bytes")
	}

	// DB passthrough: stored bytes must equal submitted bytes exactly, and
	// the response must carry no plaintext body field.
	var storedHex string
	err := db.QueryRow(`SELECT encode(encrypted_envelope,'hex') FROM drafts WHERE id=$1`, created.ID).Scan(&storedHex)
	if err != nil {
		t.Fatalf("draft row missing: %v", err)
	}
	stored, _ := hexDecodeString(storedHex)
	if string(stored) != string(testEnvelope()) {
		t.Errorf("DB envelope differs from submitted bytes")
	}
	var raw map[string]json.RawMessage
	_ = json.Unmarshal(w.Body.Bytes(), &raw)
	for _, k := range []string{"body", "plaintext", "content", "password", "mnemonic", "mailbox_sk", "root_secret"} {
		if _, ok := raw[k]; ok {
			t.Errorf("response leaks forbidden field %q", k)
		}
	}
}

func mustOrg(t *testing.T, db *sql.DB, userID string) string {
	t.Helper()
	var orgID string
	if err := db.QueryRow(`SELECT org_id::text FROM users WHERE id=$1`, userID).Scan(&orgID); err != nil {
		t.Fatalf("failed to resolve org: %v", err)
	}
	return orgID
}

func TestDraftUnauthenticated(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	_, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, mustOrg(t, db, ownerID), ownerID)
	envB64 := testEnvelopeB64()

	w := draftRequest(t, http.MethodPost, "/v1/mailboxes/"+mailboxID+"/drafts",
		`{"subject":"x","encrypted_envelope":"`+envB64+`"}`, "")
	if w.Code != http.StatusUnauthorized {
		t.Errorf("create without session: expected 401, got %d", w.Code)
	}
	w = draftRequest(t, http.MethodGet, "/v1/mailboxes/"+mailboxID+"/drafts", "", "")
	if w.Code != http.StatusUnauthorized {
		t.Errorf("list without session: expected 401, got %d", w.Code)
	}
	w = draftRequest(t, http.MethodGet, "/v1/mailboxes/"+mailboxID+"/drafts/00000000-0000-0000-0000-000000000000", "", "")
	if w.Code != http.StatusUnauthorized {
		t.Errorf("get without session: expected 401, got %d", w.Code)
	}
	// Invalid session token must also fail.
	w = draftRequest(t, http.MethodGet, "/v1/mailboxes/"+mailboxID+"/drafts", "", "bogus-token")
	if w.Code != http.StatusUnauthorized {
		t.Errorf("list with bogus session: expected 401, got %d", w.Code)
	}
}

func TestDraftInvalidMailbox(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	_, ownerID, _, _ := createTestOrgAndUsers(t, db)
	token := createSession(t, db, ownerID)
	envB64 := testEnvelopeB64()

	w := draftRequest(t, http.MethodPost, "/v1/mailboxes/not-a-uuid/drafts",
		`{"encrypted_envelope":"`+envB64+`"}`, token)
	if w.Code != http.StatusBadRequest {
		t.Errorf("bad mailbox UUID: expected 400, got %d", w.Code)
	}
	w = draftRequest(t, http.MethodPost, "/v1/mailboxes/00000000-0000-0000-0000-000000000000/drafts",
		`{"encrypted_envelope":"`+envB64+`"}`, token)
	if w.Code != http.StatusNotFound {
		t.Errorf("missing mailbox: expected 404, got %d", w.Code)
	}
	w = draftRequest(t, http.MethodGet, "/v1/mailboxes/not-a-uuid/drafts", "", token)
	if w.Code != http.StatusBadRequest {
		t.Errorf("list bad mailbox UUID: expected 400, got %d", w.Code)
	}
}

func TestDraftCrossOrgForbidden(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	_, ownerA, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxA := createTestMailbox(t, db, mustOrg(t, db, ownerA), ownerA)
	orgB, ownerB, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxB := createTestMailbox(t, db, orgB, ownerB)
	tokenB := createSession(t, db, ownerB)
	envB64 := testEnvelopeB64()

	// Org B actor on org A mailbox: create/list/get all 403.
	w := draftRequest(t, http.MethodPost, "/v1/mailboxes/"+mailboxA+"/drafts",
		`{"encrypted_envelope":"`+envB64+`"}`, tokenB)
	if w.Code != http.StatusForbidden {
		t.Errorf("cross-org create: expected 403, got %d", w.Code)
	}
	w = draftRequest(t, http.MethodGet, "/v1/mailboxes/"+mailboxA+"/drafts", "", tokenB)
	if w.Code != http.StatusForbidden {
		t.Errorf("cross-org list: expected 403, got %d", w.Code)
	}
	w = draftRequest(t, http.MethodGet, "/v1/mailboxes/"+mailboxA+"/drafts/00000000-0000-0000-0000-000000000000", "", tokenB)
	if w.Code != http.StatusForbidden {
		t.Errorf("cross-org get: expected 403, got %d", w.Code)
	}

	// Draft created in mailbox B must be invisible via mailbox A path (IDOR).
	tokenA := createSession(t, db, ownerA)
	w = draftRequest(t, http.MethodPost, "/v1/mailboxes/"+mailboxB+"/drafts",
		`{"encrypted_envelope":"`+envB64+`"}`, tokenB)
	if w.Code != http.StatusCreated {
		t.Fatalf("setup create failed: %d", w.Code)
	}
	var created draftJSON
	_ = json.Unmarshal(w.Body.Bytes(), &created)
	w = draftRequest(t, http.MethodGet, "/v1/mailboxes/"+mailboxA+"/drafts/"+created.ID, "", tokenA)
	if w.Code != http.StatusNotFound {
		t.Errorf("cross-mailbox draft fetch: expected 404, got %d", w.Code)
	}
}

func TestDraftInvalidPayload(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	_, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, mustOrg(t, db, ownerID), ownerID)
	token := createSession(t, db, ownerID)
	url := "/v1/mailboxes/" + mailboxID + "/drafts"

	cases := []struct {
		name string
		body string
	}{
		{"missing envelope", `{"subject":"x"}`},
		{"bad base64", `{"encrypted_envelope":"!!!not-base64!!!"}`},
		{"too short", `{"encrypted_envelope":"AQI="}`},
		{"bad version byte", `{"encrypted_envelope":"AjAxMjM0NTY3ODlhYjAxMjM0NTY3ODlhYmNkZWY="}`},
		{"bad recipient", `{"recipient":"not-an-email","encrypted_envelope":"` + testEnvelopeB64() + `"}`},
		{"malformed json", `{"subject":`},
	}
	for _, tc := range cases {
		w := draftRequest(t, http.MethodPost, url, tc.body, token)
		if w.Code != http.StatusBadRequest {
			t.Errorf("%s: expected 400, got %d: %s", tc.name, w.Code, w.Body.String())
		}
	}
}

func TestDraftNotFound(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	_, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, mustOrg(t, db, ownerID), ownerID)
	token := createSession(t, db, ownerID)

	w := draftRequest(t, http.MethodGet, "/v1/mailboxes/"+mailboxID+"/drafts/00000000-0000-0000-0000-000000000000", "", token)
	if w.Code != http.StatusNotFound {
		t.Errorf("missing draft: expected 404, got %d", w.Code)
	}
	w = draftRequest(t, http.MethodGet, "/v1/mailboxes/"+mailboxID+"/drafts/not-a-uuid", "", token)
	if w.Code != http.StatusBadRequest {
		t.Errorf("bad draft UUID: expected 400, got %d", w.Code)
	}
}

func TestDraftInactiveUserRejected(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	_, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, mustOrg(t, db, ownerID), ownerID)
	token := createSession(t, db, ownerID)
	if _, err := db.Exec(`UPDATE users SET is_active=false WHERE id=$1`, ownerID); err != nil {
		t.Fatalf("failed to deactivate: %v", err)
	}
	w := draftRequest(t, http.MethodPost, "/v1/mailboxes/"+mailboxID+"/drafts",
		`{"encrypted_envelope":"`+testEnvelopeB64()+`"}`, token)
	if w.Code != http.StatusForbidden {
		t.Errorf("inactive user create: expected 403, got %d", w.Code)
	}
	w = draftRequest(t, http.MethodGet, "/v1/mailboxes/"+mailboxID+"/drafts", "", token)
	if w.Code != http.StatusForbidden {
		t.Errorf("inactive user list: expected 403, got %d", w.Code)
	}
}

func TestDraftSameOrgMemberAllowed(t *testing.T) {
	// Documents the established mailbox access model: any active same-org
	// member may use the mailbox (cf. mailboxGetHandler org check).
	db := setupTestDB(t)
	defer db.Close()
	_, ownerID, _, memberID := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, mustOrg(t, db, ownerID), ownerID)
	memberToken := createSession(t, db, memberID)
	w := draftRequest(t, http.MethodPost, "/v1/mailboxes/"+mailboxID+"/drafts",
		`{"subject":"m","encrypted_envelope":"`+testEnvelopeB64()+`"}`, memberToken)
	if w.Code != http.StatusCreated {
		t.Errorf("same-org member create: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	w = draftRequest(t, http.MethodGet, "/v1/mailboxes/"+mailboxID+"/drafts", "", memberToken)
	if w.Code != http.StatusOK {
		t.Errorf("same-org member list: expected 200, got %d", w.Code)
	}
}

func TestDraftMethodNotAllowed(t *testing.T) {
	// Update (Slice C) and delete (Slice D) are intentionally unimplemented.
	db := setupTestDB(t)
	defer db.Close()
	_, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, mustOrg(t, db, ownerID), ownerID)
	token := createSession(t, db, ownerID)
	envB64 := testEnvelopeB64()
	w := draftRequest(t, http.MethodPost, "/v1/mailboxes/"+mailboxID+"/drafts",
		`{"encrypted_envelope":"`+envB64+`"}`, token)
	if w.Code != http.StatusCreated {
		t.Fatalf("setup create failed: %d", w.Code)
	}
	var created draftJSON
	_ = json.Unmarshal(w.Body.Bytes(), &created)

	for _, tc := range []struct {
		method, url string
	}{
		{http.MethodPut, "/v1/mailboxes/" + mailboxID + "/drafts"},
		{http.MethodDelete, "/v1/mailboxes/" + mailboxID + "/drafts"},
		{http.MethodPatch, "/v1/mailboxes/" + mailboxID + "/drafts"},
		{http.MethodPut, "/v1/mailboxes/" + mailboxID + "/drafts/" + created.ID},
		{http.MethodPatch, "/v1/mailboxes/" + mailboxID + "/drafts/" + created.ID},
		{http.MethodDelete, "/v1/mailboxes/" + mailboxID + "/drafts/" + created.ID},
		{http.MethodPost, "/v1/mailboxes/" + mailboxID + "/drafts/" + created.ID},
	} {
		w := draftRequest(t, tc.method, tc.url, `{"subject":"x"}`, token)
		if w.Code != http.StatusMethodNotAllowed {
			t.Errorf("%s %s: expected 405, got %d", tc.method, tc.url, w.Code)
		}
	}
}
