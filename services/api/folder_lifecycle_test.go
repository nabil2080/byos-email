package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func createTestMessage(t *testing.T, db *sql.DB, mailboxID, domainID, folder string) string {
	t.Helper()
	msgID := uuid.New().String()
	_, err := db.Exec(`
		INSERT INTO message_metadata (
			id, mailbox_id, domain_id, direction, delivery_identity, sender, recipients,
			storage_object_id, content_key_hpke_wrapped, mailbox_sk_version, encryption_version,
			encryption_iv, aad_version, bundle_hash, folder, status, is_read
		) VALUES (
			$1, $2, $3, 'received', gen_random_bytes(32), 'sender@example.com', ARRAY['rcpt@example.com'],
			'local-test-obj', decode('AA==','base64'), 1, 1,
			decode('AA==','base64'), 1, decode('AA==','base64'), $4, 'received', false
		)
	`, msgID, mailboxID, domainID, folder)
	if err != nil {
		t.Fatalf("failed to insert test message: %v", err)
	}
	return msgID
}

func folderRequest(t *testing.T, method, mailboxID, messageID, body, token string) *httptest.ResponseRecorder {
	t.Helper()
	url := "/v1/mailboxes/" + mailboxID + "/messages/" + messageID + "/folder"
	req := httptest.NewRequest(method, url, bytes.NewReader([]byte(body)))
	req.SetPathValue("mailbox_id", mailboxID)
	req.SetPathValue("message_id", messageID)
	if token != "" {
		req.AddCookie(&http.Cookie{Name: "byos_session", Value: token, Path: "/"})
	}
	w := httptest.NewRecorder()
	messageFolderHandler(w, req)
	return w
}

func deleteMessageRequest(t *testing.T, mailboxID, messageID, token string) *httptest.ResponseRecorder {
	t.Helper()
	url := "/v1/mailboxes/" + mailboxID + "/messages/" + messageID
	req := httptest.NewRequest(http.MethodDelete, url, nil)
	req.SetPathValue("mailbox_id", mailboxID)
	req.SetPathValue("message_id", messageID)
	if token != "" {
		req.AddCookie(&http.Cookie{Name: "byos_session", Value: token, Path: "/"})
	}
	w := httptest.NewRecorder()
	messageItemHandler(w, req)
	return w
}

func emptyTrashRequest(t *testing.T, mailboxID, token string) *httptest.ResponseRecorder {
	t.Helper()
	url := "/v1/mailboxes/" + mailboxID + "/messages/trash"
	req := httptest.NewRequest(http.MethodDelete, url, nil)
	req.SetPathValue("mailbox_id", mailboxID)
	if token != "" {
		req.AddCookie(&http.Cookie{Name: "byos_session", Value: token, Path: "/"})
	}
	w := httptest.NewRecorder()
	emptyTrashHandler(w, req)
	return w
}

func TestMoveDraftToTrashAndRestore(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	_, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, mustOrg(t, db, ownerID), ownerID, "mvdraft")
	token := createTestSession(t, db, ownerID)

	// 1. Create a draft
	wCreate := draftRequest(t, http.MethodPost, mailboxID, "", `{"subject":"My Draft","encrypted_envelope":"`+testEnvelopeB64()+`"}`, token)
	if wCreate.Code != http.StatusCreated {
		t.Fatalf("draft create failed: %d: %s", wCreate.Code, wCreate.Body.String())
	}
	var created struct {
		ID     string `json:"id"`
		Folder string `json:"folder"`
	}
	if err := json.Unmarshal(wCreate.Body.Bytes(), &created); err != nil {
		t.Fatalf("unmarshal create resp: %v", err)
	}
	if created.Folder != "drafts" {
		t.Errorf("expected initial folder 'drafts', got %q", created.Folder)
	}

	// 2. Move draft to trash via PUT /v1/mailboxes/{mailbox_id}/messages/{message_id}/folder
	wMove := folderRequest(t, http.MethodPut, mailboxID, created.ID, `{"folder":"trash"}`, token)
	if wMove.Code != http.StatusOK {
		t.Fatalf("move draft to trash failed: %d: %s", wMove.Code, wMove.Body.String())
	}

	// Verify in database that drafts.folder is 'trash'
	var dbFolder string
	if err := db.QueryRow(`SELECT folder FROM drafts WHERE id = $1`, created.ID).Scan(&dbFolder); err != nil {
		t.Fatalf("query draft folder: %v", err)
	}
	if dbFolder != "trash" {
		t.Errorf("expected db folder 'trash', got %q", dbFolder)
	}

	// 3. Restore draft back to drafts
	wRestore := folderRequest(t, http.MethodPut, mailboxID, created.ID, `{"folder":"drafts"}`, token)
	if wRestore.Code != http.StatusOK {
		t.Fatalf("restore draft to drafts failed: %d: %s", wRestore.Code, wRestore.Body.String())
	}
	if err := db.QueryRow(`SELECT folder FROM drafts WHERE id = $1`, created.ID).Scan(&dbFolder); err != nil {
		t.Fatalf("query draft folder: %v", err)
	}
	if dbFolder != "drafts" {
		t.Errorf("expected db folder 'drafts', got %q", dbFolder)
	}
}

func TestMoveMessageToTrashAndRestore(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	_, ownerID, _, _ := createTestOrgAndUsers(t, db)
	domainID, mailboxID := createTestMailbox(t, db, mustOrg(t, db, ownerID), ownerID, "mvmsg")
	token := createTestSession(t, db, ownerID)

	msgID := createTestMessage(t, db, mailboxID, domainID, "inbox")

	// 1. Move message to trash
	wMove := folderRequest(t, http.MethodPut, mailboxID, msgID, `{"folder":"trash"}`, token)
	if wMove.Code != http.StatusOK {
		t.Fatalf("move message to trash failed: %d: %s", wMove.Code, wMove.Body.String())
	}

	var dbFolder string
	if err := db.QueryRow(`SELECT folder FROM message_metadata WHERE id = $1`, msgID).Scan(&dbFolder); err != nil {
		t.Fatalf("query message folder: %v", err)
	}
	if dbFolder != "trash" {
		t.Errorf("expected db folder 'trash', got %q", dbFolder)
	}

	// 2. Restore message to inbox
	wRestore := folderRequest(t, http.MethodPut, mailboxID, msgID, `{"folder":"inbox"}`, token)
	if wRestore.Code != http.StatusOK {
		t.Fatalf("restore message to inbox failed: %d: %s", wRestore.Code, wRestore.Body.String())
	}
	if err := db.QueryRow(`SELECT folder FROM message_metadata WHERE id = $1`, msgID).Scan(&dbFolder); err != nil {
		t.Fatalf("query message folder: %v", err)
	}
	if dbFolder != "inbox" {
		t.Errorf("expected db folder 'inbox', got %q", dbFolder)
	}
}

func TestPermanentDeleteMessageAndDraft(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	_, ownerID, _, _ := createTestOrgAndUsers(t, db)
	domainID, mailboxID := createTestMailbox(t, db, mustOrg(t, db, ownerID), ownerID, "permdelete")
	token := createTestSession(t, db, ownerID)

	// Create test message and test draft
	msgID := createTestMessage(t, db, mailboxID, domainID, "trash")

	wDraft := draftRequest(t, http.MethodPost, mailboxID, "", `{"subject":"Delete me","encrypted_envelope":"`+testEnvelopeB64()+`"}`, token)
	if wDraft.Code != http.StatusCreated {
		t.Fatalf("draft create: %d", wDraft.Code)
	}
	var draftObj struct {
		ID string `json:"id"`
	}
	_ = json.Unmarshal(wDraft.Body.Bytes(), &draftObj)

	// 1. Permanently delete message via DELETE /v1/mailboxes/{mailbox_id}/messages/{message_id}
	wDelMsg := deleteMessageRequest(t, mailboxID, msgID, token)
	if wDelMsg.Code != http.StatusNoContent {
		t.Fatalf("delete message failed: %d: %s", wDelMsg.Code, wDelMsg.Body.String())
	}
	var count int
	_ = db.QueryRow(`SELECT COUNT(*) FROM message_metadata WHERE id = $1`, msgID).Scan(&count)
	if count != 0 {
		t.Errorf("message still exists in database after permanent delete")
	}

	// 2. Permanently delete draft via DELETE /v1/mailboxes/{mailbox_id}/messages/{draft_id}
	wDelDraft := deleteMessageRequest(t, mailboxID, draftObj.ID, token)
	if wDelDraft.Code != http.StatusNoContent {
		t.Fatalf("delete draft failed: %d: %s", wDelDraft.Code, wDelDraft.Body.String())
	}
	_ = db.QueryRow(`SELECT COUNT(*) FROM drafts WHERE id = $1`, draftObj.ID).Scan(&count)
	if count != 0 {
		t.Errorf("draft still exists in database after permanent delete")
	}

	// 3. Deleting non-existent ID returns 404
	wDelNonExistent := deleteMessageRequest(t, mailboxID, uuid.New().String(), token)
	if wDelNonExistent.Code != http.StatusNotFound {
		t.Errorf("expected 404 for nonexistent id, got %d", wDelNonExistent.Code)
	}
}

func TestEmptyTrash(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	_, ownerID, _, _ := createTestOrgAndUsers(t, db)
	domainID, mailboxID := createTestMailbox(t, db, mustOrg(t, db, ownerID), ownerID, "emptytrash")
	token := createTestSession(t, db, ownerID)

	// 1 message in trash, 1 message in inbox
	trashMsgID := createTestMessage(t, db, mailboxID, domainID, "trash")
	inboxMsgID := createTestMessage(t, db, mailboxID, domainID, "inbox")

	// 1 draft in trash, 1 draft in drafts
	wDraft1 := draftRequest(t, http.MethodPost, mailboxID, "", `{"subject":"Draft in trash","encrypted_envelope":"`+testEnvelopeB64()+`"}`, token)
	var d1 struct{ ID string `json:"id"` }
	_ = json.Unmarshal(wDraft1.Body.Bytes(), &d1)
	folderRequest(t, http.MethodPut, mailboxID, d1.ID, `{"folder":"trash"}`, token)

	wDraft2 := draftRequest(t, http.MethodPost, mailboxID, "", `{"subject":"Draft to keep","encrypted_envelope":"`+testEnvelopeB64()+`"}`, token)
	var d2 struct{ ID string `json:"id"` }
	_ = json.Unmarshal(wDraft2.Body.Bytes(), &d2)

	// Empty trash
	wEmpty := emptyTrashRequest(t, mailboxID, token)
	if wEmpty.Code != http.StatusOK {
		t.Fatalf("empty trash failed: %d: %s", wEmpty.Code, wEmpty.Body.String())
	}
	var resp struct {
		Status       string `json:"status"`
		DeletedCount int    `json:"deleted_count"`
	}
	if err := json.Unmarshal(wEmpty.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal resp: %v", err)
	}
	if resp.Status != "ok" || resp.DeletedCount != 2 {
		t.Errorf("unexpected empty trash resp: %+v", resp)
	}

	// Verify trash message is gone, inbox message remains
	var count int
	_ = db.QueryRow(`SELECT COUNT(*) FROM message_metadata WHERE id = $1`, trashMsgID).Scan(&count)
	if count != 0 {
		t.Errorf("trash message was not deleted")
	}
	_ = db.QueryRow(`SELECT COUNT(*) FROM message_metadata WHERE id = $1`, inboxMsgID).Scan(&count)
	if count != 1 {
		t.Errorf("inbox message was deleted unexpectedly")
	}

	// Verify trash draft is gone, normal draft remains
	_ = db.QueryRow(`SELECT COUNT(*) FROM drafts WHERE id = $1`, d1.ID).Scan(&count)
	if count != 0 {
		t.Errorf("trash draft was not deleted")
	}
	_ = db.QueryRow(`SELECT COUNT(*) FROM drafts WHERE id = $1`, d2.ID).Scan(&count)
	if count != 1 {
		t.Errorf("normal draft was deleted unexpectedly")
	}
}

func TestSentMessageFolderRestrictions(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	_, ownerID, _, _ := createTestOrgAndUsers(t, db)
	domainID, mailboxID := createTestMailbox(t, db, mustOrg(t, db, ownerID), ownerID, "sentrest")
	token := createTestSession(t, db, ownerID)

	// Create a message in 'sent' folder
	sentMsgID := createTestMessage(t, db, mailboxID, domainID, "sent")

	// 1. Moving sent message to inbox must fail (400 Bad Request)
	wInbox := folderRequest(t, http.MethodPut, mailboxID, sentMsgID, `{"folder":"inbox"}`, token)
	if wInbox.Code != http.StatusBadRequest {
		t.Errorf("expected 400 when moving sent message to inbox, got %d: %s", wInbox.Code, wInbox.Body.String())
	}

	// 2. Moving sent message to archive must fail (400 Bad Request)
	wArchive := folderRequest(t, http.MethodPut, mailboxID, sentMsgID, `{"folder":"archive"}`, token)
	if wArchive.Code != http.StatusBadRequest {
		t.Errorf("expected 400 when moving sent message to archive, got %d: %s", wArchive.Code, wArchive.Body.String())
	}

	// 3. Moving sent message to trash MUST succeed (200 OK)
	wTrash := folderRequest(t, http.MethodPut, mailboxID, sentMsgID, `{"folder":"trash"}`, token)
	if wTrash.Code != http.StatusOK {
		t.Errorf("expected 200 when moving sent message to trash, got %d: %s", wTrash.Code, wTrash.Body.String())
	}

	// Verify message is now in trash
	var currentFolder string
	err := db.QueryRow(`SELECT folder FROM message_metadata WHERE id = $1`, sentMsgID).Scan(&currentFolder)
	if err != nil {
		t.Fatalf("failed to query message folder: %v", err)
	}
	if currentFolder != "trash" {
		t.Errorf("expected folder 'trash', got '%s'", currentFolder)
	}
}

// Silence unused package warnings if any
var _ = context.Background
var _ = pgx.Connect
