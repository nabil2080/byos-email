package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func contactRequest(t *testing.T, method, mailboxID, contactID, body, token string) *httptest.ResponseRecorder {
	t.Helper()
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

func TestContactsCiphertextLifecycle(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	_, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, mustOrg(t, db, ownerID), ownerID, "contacts")
	token := createSession(t, db, ownerID)
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
