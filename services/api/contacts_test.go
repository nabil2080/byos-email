package main

import (
	"bytes"
	"encoding/base64"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const testContactMigrationKey = "test-internal-migration-key-xyz"

func contactRequest(t *testing.T, method, mailboxID, contactID, body, token string) *httptest.ResponseRecorder {
	t.Helper()
	t.Setenv("MIGRATION_INTERNAL_KEY", testContactMigrationKey)

	isPlaintextWrite := (method == http.MethodPost || method == http.MethodPut || method == http.MethodPatch) && !strings.Contains(body, "encrypted_envelope")
	if isPlaintextWrite {
		internalURL := "/v1/internal/mailboxes/" + mailboxID + "/contacts/migration"
		if contactID != "" {
			internalURL += "/" + contactID
		}
		req := httptest.NewRequest(method, internalURL, bytes.NewBufferString(body))
		req.SetPathValue("mailbox_id", mailboxID)
		if contactID != "" {
			req.SetPathValue("contact_id", contactID)
		}
		req.Header.Set("X-Internal-Key", testContactMigrationKey)
		w := httptest.NewRecorder()
		internalContactMigrationHandler(w, req)
		return w
	}

	url := "/v1/mailboxes/" + mailboxID + "/contacts"
	if contactID != "" {
		url += "/" + contactID
	}
	req := httptest.NewRequest(method, url, bytes.NewBufferString(body))
	req.SetPathValue("mailbox_id", mailboxID)
	if contactID != "" {
		req.SetPathValue("contact_id", contactID)
	}
	if token != "" {
		req.AddCookie(&http.Cookie{Name: "byos_session", Value: token, Path: "/"})
	}
	w := httptest.NewRecorder()
	contactsHandler(w, req)
	return w
}

func contactRequestWithQuery(t *testing.T, method, mailboxID, query, body, token string) *httptest.ResponseRecorder {
	t.Helper()
	url := "/v1/mailboxes/" + mailboxID + "/contacts"
	if query != "" {
		url += "?" + query
	}
	req := httptest.NewRequest(method, url, bytes.NewBufferString(body))
	req.SetPathValue("mailbox_id", mailboxID)
	if token != "" {
		req.AddCookie(&http.Cookie{Name: "byos_session", Value: token, Path: "/"})
	}
	w := httptest.NewRecorder()
	contactsHandler(w, req)
	return w
}

func TestContactsCiphertextLifecycle(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	_, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, mustOrg(t, db, ownerID), ownerID, "contacts")
	token := createTestSession(t, db, ownerID)
	envelope := testEnvelopeB64()

	w := contactRequest(t, http.MethodPost, mailboxID, "", `{"encrypted_envelope":"`+envelope+`"}`, token)
	if w.Code != http.StatusCreated {
		t.Fatalf("create: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var created struct {
		ID                string `json:"id"`
		EncryptedEnvelope string `json:"encrypted_envelope"`
		Version           int    `json:"version"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.ID == "" || created.EncryptedEnvelope != envelope || created.Version != 1 {
		t.Fatalf("unexpected create response: %+v", created)
	}

	w = contactRequest(t, http.MethodPut, mailboxID, created.ID, `{"encrypted_envelope":"`+envelope+`","version":1}`, token)
	if w.Code != http.StatusOK {
		t.Fatalf("update: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.Version != 2 || created.EncryptedEnvelope != envelope {
		t.Fatalf("unexpected update response: %+v", created)
	}

	w = contactRequest(t, http.MethodGet, mailboxID, created.ID, "", token)
	if w.Code != http.StatusOK || !bytes.Contains(w.Body.Bytes(), []byte(envelope)) {
		t.Fatalf("get: expected opaque envelope, got %d: %s", w.Code, w.Body.String())
	}

	w = contactRequest(t, http.MethodDelete, mailboxID, created.ID, "", token)
	if w.Code != http.StatusNoContent {
		t.Fatalf("delete: expected 204, got %d: %s", w.Code, w.Body.String())
	}
}

func TestContactsUnauthenticated(t *testing.T) {
	w := contactRequest(t, http.MethodGet, "00000000-0000-0000-0000-000000000000", "", "", "")
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d: %s", w.Code, w.Body.String())
	}
}

func TestListContactsSearch(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	_, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, mustOrg(t, db, ownerID), ownerID, "contacts-search")
	token := createTestSession(t, db, ownerID)

	contactRequest(t, http.MethodPost, mailboxID, "", `{"name":"Alice Smith","email":"alice.smith@example.com"}`, token)
	contactRequest(t, http.MethodPost, mailboxID, "", `{"name":"Bob Jones","email":"bob.jones@example.com"}`, token)
	contactRequest(t, http.MethodPost, mailboxID, "", `{"name":"Charlie Brown","email":"charlie@example.com","notes":"special project lead"}`, token)

	// Search by name substring
	w := contactRequestWithQuery(t, http.MethodGet, mailboxID, "search=jones", "", token)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var res struct {
		Contacts []ContactRecord `json:"contacts"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	if len(res.Contacts) != 1 || res.Contacts[0].Name != "Bob Jones" {
		t.Fatalf("expected 1 contact 'Bob Jones', got %d: %+v", len(res.Contacts), res.Contacts)
	}

	// Search by notes substring
	w = contactRequestWithQuery(t, http.MethodGet, mailboxID, "search=special", "", token)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	res.Contacts = nil
	if err := json.Unmarshal(w.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	if len(res.Contacts) != 1 || res.Contacts[0].Name != "Charlie Brown" {
		t.Fatalf("expected 1 contact 'Charlie Brown', got %d: %+v", len(res.Contacts), res.Contacts)
	}
}

func TestListContactsGroupFilter(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	_, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, mustOrg(t, db, ownerID), ownerID, "contacts-group")
	token := createTestSession(t, db, ownerID)

	contactRequest(t, http.MethodPost, mailboxID, "", `{"name":"Engineer One","email":"e1@example.com","group_name":"Engineering"}`, token)
	contactRequest(t, http.MethodPost, mailboxID, "", `{"name":"Sales Rep","email":"sales@example.com","group_name":"Sales"}`, token)
	contactRequest(t, http.MethodPost, mailboxID, "", `{"name":"Engineer Two","email":"e2@example.com","group_name":"Engineering"}`, token)

	w := contactRequestWithQuery(t, http.MethodGet, mailboxID, "group=Engineering", "", token)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var res struct {
		Contacts []ContactRecord `json:"contacts"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	if len(res.Contacts) != 2 {
		t.Fatalf("expected 2 contacts in Engineering, got %d", len(res.Contacts))
	}
	for _, c := range res.Contacts {
		if c.GroupName != "Engineering" {
			t.Fatalf("expected group Engineering, got %s", c.GroupName)
		}
	}
}

func TestCreateContactRejectsDuplicateEmail(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	_, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, mustOrg(t, db, ownerID), ownerID, "contacts-dup")
	token := createTestSession(t, db, ownerID)

	w1 := contactRequest(t, http.MethodPost, mailboxID, "", `{"name":"Original","email":"duplicate@example.com"}`, token)
	if w1.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w1.Code, w1.Body.String())
	}

	w2 := contactRequest(t, http.MethodPost, mailboxID, "", `{"name":"Duplicate","email":"DUPLICATE@EXAMPLE.COM"}`, token)
	if w2.Code != http.StatusConflict {
		t.Fatalf("expected 409 Conflict, got %d: %s", w2.Code, w2.Body.String())
	}
	var errResp map[string]string
	json.Unmarshal(w2.Body.Bytes(), &errResp)
	if errResp["error"] != "contact_exists" {
		t.Fatalf("expected error 'contact_exists', got '%s'", errResp["error"])
	}
}

func TestCreateContactValidation(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	_, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, mustOrg(t, db, ownerID), ownerID, "contacts-valid")
	token := createTestSession(t, db, ownerID)

	// Empty name -> 400
	w := contactRequest(t, http.MethodPost, mailboxID, "", `{"name":"","email":"valid@example.com"}`, token)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("empty name: expected 400, got %d", w.Code)
	}

	// Invalid email -> 400
	w = contactRequest(t, http.MethodPost, mailboxID, "", `{"name":"Valid Name","email":"not-an-email"}`, token)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("invalid email: expected 400, got %d", w.Code)
	}

	// Notes over 2000 chars -> 400
	longNotes := strings.Repeat("A", 2001)
	w = contactRequest(t, http.MethodPost, mailboxID, "", fmt.Sprintf(`{"name":"Valid Name","email":"valid@example.com","notes":"%s"}`, longNotes), token)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("notes over 2000 chars: expected 400, got %d", w.Code)
	}
}

func TestUpdateContactOwnership(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	orgID, ownerID, _, memberID := createTestOrgAndUsers(t, db)
	_, mailboxA := createTestMailbox(t, db, orgID, ownerID, "mailbox-a")
	tokenA := createTestSession(t, db, ownerID)

	_, mailboxB := createTestMailbox(t, db, orgID, memberID, "mailbox-b")
	tokenB := createTestSession(t, db, memberID)

	// Create contact under Mailbox A
	wCreate := contactRequest(t, http.MethodPost, mailboxA, "", `{"name":"User A Contact","email":"a.contact@example.com"}`, tokenA)
	if wCreate.Code != http.StatusCreated {
		t.Fatalf("create contact under mailbox A failed: %d", wCreate.Code)
	}
	var created ContactRecord
	json.Unmarshal(wCreate.Body.Bytes(), &created)

	// User B attempts to update User A's contact under Mailbox B
	wUpdate := contactRequest(t, http.MethodPatch, mailboxB, created.ID, `{"name":"Hacked Name"}`, tokenB)
	if wUpdate.Code != http.StatusNotFound {
		t.Fatalf("expected 404 Not Found for cross-mailbox update, got %d: %s", wUpdate.Code, wUpdate.Body.String())
	}
}

func TestDeleteContact(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	_, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, mustOrg(t, db, ownerID), ownerID, "contacts-del")
	token := createTestSession(t, db, ownerID)

	wCreate := contactRequest(t, http.MethodPost, mailboxID, "", `{"name":"To Delete","email":"delete.me@example.com"}`, token)
	var created ContactRecord
	json.Unmarshal(wCreate.Body.Bytes(), &created)

	wDel := contactRequest(t, http.MethodDelete, mailboxID, created.ID, "", token)
	if wDel.Code != http.StatusNoContent {
		t.Fatalf("delete expected 204, got %d", wDel.Code)
	}

	wGet := contactRequest(t, http.MethodGet, mailboxID, created.ID, "", token)
	if wGet.Code != http.StatusNotFound {
		t.Fatalf("get deleted contact expected 404, got %d", wGet.Code)
	}
}

func TestImportCSV(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	_, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, mustOrg(t, db, ownerID), ownerID, "contacts-csv-import")
	token := createTestSession(t, db, ownerID)

	// Pre-seed 1 contact to test duplication
	contactRequest(t, http.MethodPost, mailboxID, "", `{"name":"Existing User","email":"existing@example.com"}`, token)

	csvData := `Name,Email,Notes,Group
User One,user1@example.com,Notes 1,Group A
Existing User,existing@example.com,Duplicate,Group B
User Three,user3@example.com,Notes 3,Group A
User Four,user4@example.com,Notes 4,Group B
User Five,user5@example.com,Notes 5,Group C`

	b64Data := base64.StdEncoding.EncodeToString([]byte(csvData))
	body := fmt.Sprintf(`{"format":"csv","data":"%s"}`, b64Data)

	// Public import endpoint rejects plaintext import
	pubReq := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mailboxID+"/contacts/import", bytes.NewBufferString(body))
	pubReq.SetPathValue("mailbox_id", mailboxID)
	pubReq.AddCookie(&http.Cookie{Name: "byos_session", Value: token, Path: "/"})
	pubW := httptest.NewRecorder()
	contactsImportHandler(pubW, pubReq)
	if pubW.Code != http.StatusBadRequest {
		t.Fatalf("expected public import to reject plaintext with 400, got %d: %s", pubW.Code, pubW.Body.String())
	}

	t.Setenv("MIGRATION_INTERNAL_KEY", testContactMigrationKey)
	req := httptest.NewRequest(http.MethodPost, "/v1/internal/mailboxes/"+mailboxID+"/contacts/migration", bytes.NewBufferString(body))
	req.SetPathValue("mailbox_id", mailboxID)
	req.Header.Set("X-Internal-Key", testContactMigrationKey)
	w := httptest.NewRecorder()
	internalContactMigrationHandler(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("import csv expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var res struct {
		Imported int      `json:"imported"`
		Skipped  int      `json:"skipped"`
		Errors   []string `json:"errors"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	if res.Imported != 4 || res.Skipped != 1 {
		t.Fatalf("expected imported=4, skipped=1; got imported=%d, skipped=%d, errors=%v", res.Imported, res.Skipped, res.Errors)
	}
}

func TestImportVCard(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	_, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, mustOrg(t, db, ownerID), ownerID, "contacts-vcard-import")
	token := createTestSession(t, db, ownerID)

	vcardData := `BEGIN:VCARD
VERSION:3.0
FN:Person One
EMAIL:p1@example.com
NOTE:First person note
CATEGORIES:VIP
END:VCARD
BEGIN:VCARD
VERSION:3.0
FN:Person Two
EMAIL:p2@example.com
CATEGORIES:Clients
END:VCARD
BEGIN:VCARD
VERSION:3.0
FN:Person Three
EMAIL:p3@example.com
NOTE:Third person note
END:VCARD`

	b64Data := base64.StdEncoding.EncodeToString([]byte(vcardData))
	body := fmt.Sprintf(`{"format":"vcard","data":"%s"}`, b64Data)

	// Public import endpoint rejects plaintext import
	pubReq := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mailboxID+"/contacts/import", bytes.NewBufferString(body))
	pubReq.SetPathValue("mailbox_id", mailboxID)
	pubReq.AddCookie(&http.Cookie{Name: "byos_session", Value: token, Path: "/"})
	pubW := httptest.NewRecorder()
	contactsImportHandler(pubW, pubReq)
	if pubW.Code != http.StatusBadRequest {
		t.Fatalf("expected public import to reject plaintext with 400, got %d: %s", pubW.Code, pubW.Body.String())
	}

	t.Setenv("MIGRATION_INTERNAL_KEY", testContactMigrationKey)
	req := httptest.NewRequest(http.MethodPost, "/v1/internal/mailboxes/"+mailboxID+"/contacts/migration", bytes.NewBufferString(body))
	req.SetPathValue("mailbox_id", mailboxID)
	req.Header.Set("X-Internal-Key", testContactMigrationKey)
	w := httptest.NewRecorder()
	internalContactMigrationHandler(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("import vcard expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var res struct {
		Imported int      `json:"imported"`
		Skipped  int      `json:"skipped"`
		Errors   []string `json:"errors"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	if res.Imported != 3 {
		t.Fatalf("expected imported=3, got %d; errors=%v", res.Imported, res.Errors)
	}
}

func TestExportCSV(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	_, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, mustOrg(t, db, ownerID), ownerID, "contacts-export")
	token := createTestSession(t, db, ownerID)

	contactRequest(t, http.MethodPost, mailboxID, "", `{"name":"Alice Alpha","email":"alice@example.com","notes":"A notes","group_name":"Team"}`, token)
	contactRequest(t, http.MethodPost, mailboxID, "", `{"name":"Bob Beta","email":"bob@example.com","notes":"B notes","group_name":"Team"}`, token)
	contactRequest(t, http.MethodPost, mailboxID, "", `{"name":"Charlie Gamma","email":"charlie@example.com","notes":"C notes","group_name":"Exec"}`, token)

	req := httptest.NewRequest(http.MethodGet, "/v1/mailboxes/"+mailboxID+"/contacts/export?format=csv", nil)
	req.SetPathValue("mailbox_id", mailboxID)
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: token, Path: "/"})
	w := httptest.NewRecorder()
	contactsExportHandler(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("export csv expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if ct := w.Header().Get("Content-Type"); !strings.Contains(ct, "text/csv") {
		t.Fatalf("expected Content-Type text/csv, got %s", ct)
	}

	r := csv.NewReader(bytes.NewReader(w.Body.Bytes()))
	rows, err := r.ReadAll()
	if err != nil {
		t.Fatalf("failed to parse exported csv: %v", err)
	}
	// Header + 3 rows = 4 rows
	if len(rows) != 4 {
		t.Fatalf("expected 4 rows in CSV (header + 3 data rows), got %d", len(rows))
	}
	if rows[0][0] != "Name" || rows[0][1] != "Email" {
		t.Fatalf("unexpected header: %v", rows[0])
	}
}

func TestContactPlaintextRejectionWithoutMigration(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	_, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, mustOrg(t, db, ownerID), ownerID, "contacts-no-migration")
	token := createTestSession(t, db, ownerID)

	// 1. Plaintext create without migration header is rejected (400)
	reqCreate := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mailboxID+"/contacts", bytes.NewBufferString(`{"name":"Plain User","email":"plain@example.com"}`))
	reqCreate.SetPathValue("mailbox_id", mailboxID)
	reqCreate.AddCookie(&http.Cookie{Name: "byos_session", Value: token, Path: "/"})
	wCreate := httptest.NewRecorder()
	contactsHandler(wCreate, reqCreate)
	if wCreate.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for plaintext contact creation without migration header, got %d: %s", wCreate.Code, wCreate.Body.String())
	}
	if !strings.Contains(wCreate.Body.String(), "plaintext contact creation rejected") {
		t.Fatalf("expected rejection error message, got: %s", wCreate.Body.String())
	}

	// 2. Plaintext update without migration header is rejected (400)
	reqUpdate := httptest.NewRequest(http.MethodPut, "/v1/mailboxes/"+mailboxID+"/contacts/00000000-0000-0000-0000-000000000001", bytes.NewBufferString(`{"name":"Updated Name"}`))
	reqUpdate.SetPathValue("mailbox_id", mailboxID)
	reqUpdate.SetPathValue("contact_id", "00000000-0000-0000-0000-000000000001")
	reqUpdate.AddCookie(&http.Cookie{Name: "byos_session", Value: token, Path: "/"})
	wUpdate := httptest.NewRecorder()
	contactsHandler(wUpdate, reqUpdate)
	if wUpdate.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for plaintext contact update without migration header, got %d: %s", wUpdate.Code, wUpdate.Body.String())
	}
	if !strings.Contains(wUpdate.Body.String(), "plaintext contact update rejected") {
		t.Fatalf("expected rejection error message, got: %s", wUpdate.Body.String())
	}

	// 3. Plaintext import without migration header is rejected (400)
	reqImport := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mailboxID+"/contacts/import", bytes.NewBufferString(`{"format":"csv","data":"Name,Email\nUser,user@example.com"}`))
	reqImport.SetPathValue("mailbox_id", mailboxID)
	reqImport.AddCookie(&http.Cookie{Name: "byos_session", Value: token, Path: "/"})
	wImport := httptest.NewRecorder()
	contactsImportHandler(wImport, reqImport)
	if wImport.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for plaintext contacts import without migration header, got %d: %s", wImport.Code, wImport.Body.String())
	}
	if !strings.Contains(wImport.Body.String(), "plaintext contacts import rejected") {
		t.Fatalf("expected rejection error message, got: %s", wImport.Body.String())
	}

	// 4. Plaintext create with bypass headers is STILL rejected (400)
	reqCreateBypass := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mailboxID+"/contacts?migration=true", bytes.NewBufferString(`{"name":"Plain User","email":"plain@example.com"}`))
	reqCreateBypass.SetPathValue("mailbox_id", mailboxID)
	reqCreateBypass.Header.Set("X-BYOS-Migration", "true")
	reqCreateBypass.AddCookie(&http.Cookie{Name: "byos_session", Value: token, Path: "/"})
	wCreateBypass := httptest.NewRecorder()
	contactsHandler(wCreateBypass, reqCreateBypass)
	if wCreateBypass.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for plaintext contact creation with bypass headers, got %d: %s", wCreateBypass.Code, wCreateBypass.Body.String())
	}

	// 5. Plaintext update with bypass headers is STILL rejected (400)
	reqUpdateBypass := httptest.NewRequest(http.MethodPut, "/v1/mailboxes/"+mailboxID+"/contacts/00000000-0000-0000-0000-000000000001?migration=true", bytes.NewBufferString(`{"name":"Updated Name"}`))
	reqUpdateBypass.SetPathValue("mailbox_id", mailboxID)
	reqUpdateBypass.SetPathValue("contact_id", "00000000-0000-0000-0000-000000000001")
	reqUpdateBypass.Header.Set("X-BYOS-Migration", "true")
	reqUpdateBypass.AddCookie(&http.Cookie{Name: "byos_session", Value: token, Path: "/"})
	wUpdateBypass := httptest.NewRecorder()
	contactsHandler(wUpdateBypass, reqUpdateBypass)
	if wUpdateBypass.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for plaintext contact update with bypass headers, got %d: %s", wUpdateBypass.Code, wUpdateBypass.Body.String())
	}

	// 6. Plaintext import with bypass headers is STILL rejected (400)
	reqImportBypass := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mailboxID+"/contacts/import?migration=true", bytes.NewBufferString(`{"format":"csv","data":"Name,Email\nUser,user@example.com"}`))
	reqImportBypass.SetPathValue("mailbox_id", mailboxID)
	reqImportBypass.Header.Set("X-BYOS-Migration", "true")
	reqImportBypass.AddCookie(&http.Cookie{Name: "byos_session", Value: token, Path: "/"})
	wImportBypass := httptest.NewRecorder()
	contactsImportHandler(wImportBypass, reqImportBypass)
	if wImportBypass.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for plaintext contacts import with bypass headers, got %d: %s", wImportBypass.Code, wImportBypass.Body.String())
	}
}

func TestInternalContactMigrationAuth(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	_, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, mustOrg(t, db, ownerID), ownerID, "contacts-migration-auth")
	token := createTestSession(t, db, ownerID)
	t.Setenv("MIGRATION_INTERNAL_KEY", "correct-secret-migration-key")

	body := `{"name":"Migration User","email":"migration.user@example.com"}`

	// 1. Missing X-Internal-Key rejected (403)
	req1 := httptest.NewRequest(http.MethodPost, "/v1/internal/mailboxes/"+mailboxID+"/contacts/migration", bytes.NewBufferString(body))
	req1.SetPathValue("mailbox_id", mailboxID)
	w1 := httptest.NewRecorder()
	internalContactMigrationHandler(w1, req1)
	if w1.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for missing internal key, got %d: %s", w1.Code, w1.Body.String())
	}

	// 2. Regular user session cookie rejected (403)
	req2 := httptest.NewRequest(http.MethodPost, "/v1/internal/mailboxes/"+mailboxID+"/contacts/migration", bytes.NewBufferString(body))
	req2.SetPathValue("mailbox_id", mailboxID)
	req2.AddCookie(&http.Cookie{Name: "byos_session", Value: token, Path: "/"})
	w2 := httptest.NewRecorder()
	internalContactMigrationHandler(w2, req2)
	if w2.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for user session cookie without internal key, got %d: %s", w2.Code, w2.Body.String())
	}

	// 3. Wrong X-Internal-Key rejected (403)
	req3 := httptest.NewRequest(http.MethodPost, "/v1/internal/mailboxes/"+mailboxID+"/contacts/migration", bytes.NewBufferString(body))
	req3.SetPathValue("mailbox_id", mailboxID)
	req3.Header.Set("X-Internal-Key", "wrong-key")
	w3 := httptest.NewRecorder()
	internalContactMigrationHandler(w3, req3)
	if w3.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for wrong internal key, got %d: %s", w3.Code, w3.Body.String())
	}

	// 4. Correct X-Internal-Key succeeds (201)
	req4 := httptest.NewRequest(http.MethodPost, "/v1/internal/mailboxes/"+mailboxID+"/contacts/migration", bytes.NewBufferString(body))
	req4.SetPathValue("mailbox_id", mailboxID)
	req4.Header.Set("X-Internal-Key", "correct-secret-migration-key")
	w4 := httptest.NewRecorder()
	internalContactMigrationHandler(w4, req4)
	if w4.Code != http.StatusCreated {
		t.Fatalf("expected 201 for valid internal migration request, got %d: %s", w4.Code, w4.Body.String())
	}
}
