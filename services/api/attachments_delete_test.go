package main

// Attachment deletion tests (require PostgreSQL; the storage worker is
// mocked via httptest). Without a database they skip; skipped is reported,
// never counted as passing.

import (
	"database/sql"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func requirePostgres(t *testing.T) {
	t.Helper()
	c, err := net.DialTimeout("tcp", "127.0.0.1:5432", 2*time.Second)
	if err != nil {
		t.Skipf("postgres unavailable: %v", err)
	}
	c.Close()
}

func deleteAttachmentRequest(t *testing.T, mailboxID, attachmentID, token string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodDelete, "/v1/mailboxes/"+mailboxID+"/attachments/"+attachmentID, nil)
	req.SetPathValue("mailbox_id", mailboxID)
	req.SetPathValue("attachment_id", attachmentID)
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	rec := httptest.NewRecorder()
	attachmentsHandler(rec, req)
	return rec
}

func insertAttachmentRow(t *testing.T, db *sql.DB, mailboxID, messageID, storageKey string) string {
	t.Helper()
	var id string
	var msg interface{}
	if messageID != "" {
		msg = messageID
	}
	if err := db.QueryRow(`INSERT INTO attachments (mailbox_id, message_id, filename, content_type, size_bytes, storage_key, encrypted)
		VALUES ($1, $2, 'f.enc', 'application/octet-stream', 29, $3, true) RETURNING id::text`,
		mailboxID, msg, storageKey).Scan(&id); err != nil {
		t.Fatalf("insert attachment: %v", err)
	}
	return id
}

func TestAttachmentDeleteRemovesObjectAndRow(t *testing.T) {
	requirePostgres(t)
	db := setupTestDB(t)
	defer db.Close()

	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, orgID, ownerID, "del")
	token := createTestSession(t, db, ownerID)
	attID := insertAttachmentRow(t, db, mailboxID, "", "mailboxes/"+mailboxID+"/attachments/a/f.enc")

	var gotKey, gotBox string
	var calls int
	mockWorker := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/delete" && r.Method == http.MethodPost {
			calls++
			var body struct {
				ObjectKey string `json:"object_key"`
				MailboxID string `json:"mailbox_id"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err == nil {
				gotKey, gotBox = body.ObjectKey, body.MailboxID
			}
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{"status":"deleted"}`))
			return
		}
		http.Error(w, "not found", http.StatusNotFound)
	}))
	defer mockWorker.Close()
	t.Setenv("STORAGE_WORKER_URL", mockWorker.URL)

	rec := deleteAttachmentRequest(t, mailboxID, attID, token)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete status = %d, want 204: %s", rec.Code, rec.Body.String())
	}
	if calls != 1 || gotKey != "mailboxes/"+mailboxID+"/attachments/a/f.enc" || gotBox != mailboxID {
		t.Fatalf("worker delete not called correctly: calls=%d key=%q box=%q", calls, gotKey, gotBox)
	}
	var remaining int
	if err := db.QueryRow(`SELECT count(*) FROM attachments WHERE id=$1`, attID).Scan(&remaining); err != nil || remaining != 0 {
		t.Fatalf("row must be gone: count=%d err=%v", remaining, err)
	}
}

func TestAttachmentDeleteLinkedConflict(t *testing.T) {
	requirePostgres(t)
	db := setupTestDB(t)
	defer db.Close()

	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, orgID, ownerID, "linked")
	token := createTestSession(t, db, ownerID)
	attID := insertAttachmentRow(t, db, mailboxID, "delivery-1", "mailboxes/k")

	var calls int
	mockWorker := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.Write([]byte(`{}`))
	}))
	defer mockWorker.Close()
	t.Setenv("STORAGE_WORKER_URL", mockWorker.URL)

	rec := deleteAttachmentRequest(t, mailboxID, attID, token)
	if rec.Code != http.StatusConflict {
		t.Fatalf("linked delete status = %d, want 409", rec.Code)
	}
	if calls != 0 {
		t.Fatal("worker must not be touched for linked attachments")
	}
	var remaining int
	if err := db.QueryRow(`SELECT count(*) FROM attachments WHERE id=$1`, attID).Scan(&remaining); err != nil || remaining != 1 {
		t.Fatalf("linked row must be kept: count=%d", remaining)
	}
}

func TestAttachmentDeleteWorkerFailureKeepsRow(t *testing.T) {
	requirePostgres(t)
	db := setupTestDB(t)
	defer db.Close()

	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, orgID, ownerID, "fail")
	token := createTestSession(t, db, ownerID)
	attID := insertAttachmentRow(t, db, mailboxID, "", "mailboxes/k")

	mockWorker := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
	defer mockWorker.Close()
	t.Setenv("STORAGE_WORKER_URL", mockWorker.URL)

	rec := deleteAttachmentRequest(t, mailboxID, attID, token)
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("worker-failure delete status = %d, want 502", rec.Code)
	}
	var remaining int
	if err := db.QueryRow(`SELECT count(*) FROM attachments WHERE id=$1`, attID).Scan(&remaining); err != nil || remaining != 1 {
		t.Fatalf("row must be kept for retry: count=%d", remaining)
	}
}

func TestAttachmentDeleteMissing(t *testing.T) {
	requirePostgres(t)
	db := setupTestDB(t)
	defer db.Close()

	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, orgID, ownerID, "miss")
	token := createTestSession(t, db, ownerID)

	rec := deleteAttachmentRequest(t, mailboxID, "00000000-0000-0000-0000-000000000000", token)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("missing delete status = %d, want 404", rec.Code)
	}
}
