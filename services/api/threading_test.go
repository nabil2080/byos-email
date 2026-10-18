package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func getTestDB(t *testing.T) *pgx.Conn {
	t.Helper()
	dsn := getValidatedTestDSN(t)
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Skipf("skipping test; db unreachable: %v", err)
	}
	return conn
}

func createThreadingTestMailbox(t *testing.T, conn *pgx.Conn) (orgID, userID, domainID, mailboxID string) {
	t.Helper()
	ctx := context.Background()
	orgID = uuid.New().String()
	domainID = uuid.New().String()
	mailboxID = uuid.New().String()
	userID = uuid.New().String()
	tag := orgID[:8]

	_, err := conn.Exec(ctx, `INSERT INTO organizations (id, name, org_recovery_pk) VALUES ($1, $2, decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'))`, orgID, "Threading Org "+tag)
	if err != nil {
		t.Fatalf("insert org: %v", err)
	}

	_, err = conn.Exec(ctx, `INSERT INTO domains (id, org_id, name, is_verified) VALUES ($1, $2, $3, true)`, domainID, orgID, "thread-"+tag+".test")
	if err != nil {
		t.Fatalf("insert domain: %v", err)
	}

	_, err = conn.Exec(ctx, `INSERT INTO users (id, org_id, email, display_name, password_hash, is_active, role) VALUES ($1, $2, $3, 'User', 'hash', true, 'member')`, userID, orgID, "user-"+tag+"@thread.test")
	if err != nil {
		t.Fatalf("insert user: %v", err)
	}

	_, err = conn.Exec(ctx, `INSERT INTO mailboxes (
		id, org_id, user_id, domain_id, local_part, mode,
		mailbox_sk_wrapped, mailbox_pk, wrapped_sk_user,
		key_epoch, signing_key_epoch, key_status, is_active
	) VALUES (
		$1, $2, $3, $4, 'inbox', 'private',
		decode('AA==', 'base64'), decode('AA==', 'base64'), 'test_wrapped_sk_user',
		1, 1, 'active', true
	)`, mailboxID, orgID, userID, domainID)
	if err != nil {
		t.Fatalf("insert mailbox: %v", err)
	}

	t.Cleanup(func() {
		ctx := context.Background()
		dsn := getValidatedTestDSN(t)
		cleanupConn, err := pgx.Connect(ctx, dsn)
		if err != nil {
			t.Errorf("cleanup connect failed: %v", err)
			return
		}
		defer cleanupConn.Close(ctx)

		if _, err := cleanupConn.Exec(ctx, "DELETE FROM outbound_queue WHERE mailbox_id = $1", mailboxID); err != nil {
			t.Errorf("cleanup outbound_queue failed: %v", err)
		}
		if _, err := cleanupConn.Exec(ctx, "DELETE FROM scheduled_messages WHERE mailbox_id = $1", mailboxID); err != nil {
			t.Errorf("cleanup scheduled_messages failed: %v", err)
		}
		if _, err := cleanupConn.Exec(ctx, "DELETE FROM outbound_reservations WHERE mailbox_id = $1 OR user_id = $2", mailboxID, userID); err != nil {
			t.Errorf("cleanup outbound_reservations failed: %v", err)
		}
		if _, err := cleanupConn.Exec(ctx, "DELETE FROM message_metadata WHERE mailbox_id = $1", mailboxID); err != nil {
			t.Errorf("cleanup message_metadata failed: %v", err)
		}
		if _, err := cleanupConn.Exec(ctx, "DELETE FROM mail_rules WHERE mailbox_id = $1", mailboxID); err != nil {
			t.Errorf("cleanup mail_rules failed: %v", err)
		}
		if _, err := cleanupConn.Exec(ctx, "DELETE FROM mailbox_labels WHERE mailbox_id = $1", mailboxID); err != nil {
			t.Errorf("cleanup mailbox_labels failed: %v", err)
		}
		if _, err := cleanupConn.Exec(ctx, "DELETE FROM device_mailbox_access WHERE mailbox_id = $1", mailboxID); err != nil {
			t.Errorf("cleanup device_mailbox_access failed: %v", err)
		}
		if _, err := cleanupConn.Exec(ctx, "DELETE FROM mailboxes WHERE id = $1", mailboxID); err != nil {
			t.Errorf("cleanup mailboxes failed: %v", err)
		}
		if _, err := cleanupConn.Exec(ctx, "DELETE FROM sessions WHERE user_id = $1", userID); err != nil {
			t.Errorf("cleanup sessions failed: %v", err)
		}
		if _, err := cleanupConn.Exec(ctx, "DELETE FROM audit_log WHERE user_id = $1", userID); err != nil {
			t.Errorf("cleanup audit_log failed: %v", err)
		}
		if _, err := cleanupConn.Exec(ctx, "DELETE FROM users WHERE id = $1", userID); err != nil {
			t.Errorf("cleanup users failed: %v", err)
		}
		if _, err := cleanupConn.Exec(ctx, "DELETE FROM domains WHERE id = $1", domainID); err != nil {
			t.Errorf("cleanup domains failed: %v", err)
		}
		if _, err := cleanupConn.Exec(ctx, "DELETE FROM organizations WHERE id = $1", orgID); err != nil {
			t.Errorf("cleanup organizations failed: %v", err)
		}
	})

	return orgID, userID, domainID, mailboxID
}

func insertThreadingTestMessage(t *testing.T, conn *pgx.Conn, mailboxID, domainID, msgID, inReplyTo string) (string, string) {
	t.Helper()
	ctx := context.Background()
	var id, tid string
	deliveryID := uuid.New().String()
	err := conn.QueryRow(ctx, `
		INSERT INTO message_metadata (
			mailbox_id, domain_id, direction, delivery_identity, sender, recipients,
			storage_object_id, content_key_hpke_wrapped, mailbox_sk_version,
			encryption_version, encryption_iv, aad_version, bundle_hash,
			status, folder, is_read, message_id, in_reply_to
		) VALUES (
			$1, $2, 'received', $3, 'sender@test.local', ARRAY['rcpt@test.local'],
			'storage/obj', decode('AA==', 'base64'), 1,
			1, decode('AA==', 'base64'), 1, decode('AA==', 'base64'),
			'received', 'inbox', false, NULLIF($4, ''), NULLIF($5, '')
		) RETURNING id::text, thread_id::text
	`, mailboxID, domainID, []byte(deliveryID), msgID, inReplyTo).Scan(&id, &tid)
	if err != nil {
		t.Fatalf("insertTestMessage failed: %v", err)
	}
	return id, tid
}

// Test 1: TestComputeThreadIDFindsParent
func TestComputeThreadIDFindsParent(t *testing.T) {
	conn := getTestDB(t)
	defer conn.Close(context.Background())
	ctx := context.Background()

	_, _, domainID, mailboxID := createThreadingTestMailbox(t, conn)
	_, parentThreadID := insertThreadingTestMessage(t, conn, mailboxID, domainID, "parent@test", "")

	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatalf("conn.Begin: %v", err)
	}
	defer tx.Rollback(ctx)

	replyThreadID, err := ComputeThreadID(ctx, tx, mailboxID, "parent@test", "")
	if err != nil {
		t.Fatalf("ComputeThreadID: %v", err)
	}
	if replyThreadID != parentThreadID {
		t.Errorf("got thread_id %q, want parent thread_id %q", replyThreadID, parentThreadID)
	}
}

// Test 2: TestComputeThreadIDUsesReferencesFallback
func TestComputeThreadIDUsesReferencesFallback(t *testing.T) {
	conn := getTestDB(t)
	defer conn.Close(context.Background())
	ctx := context.Background()

	_, _, domainID, mailboxID := createThreadingTestMailbox(t, conn)
	_, threadA := insertThreadingTestMessage(t, conn, mailboxID, domainID, "A@test", "")

	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatalf("conn.Begin: %v", err)
	}
	defer tx.Rollback(ctx)

	// In-Reply-To is B@test (missing), References has A@test and B@test
	replyThreadID, err := ComputeThreadID(ctx, tx, mailboxID, "B@test", "<A@test> <B@test>")
	if err != nil {
		t.Fatalf("ComputeThreadID: %v", err)
	}
	if replyThreadID != threadA {
		t.Errorf("got thread_id %q, want threadA %q", replyThreadID, threadA)
	}
}

// Test 3: TestComputeThreadIDGeneratesNew
func TestComputeThreadIDGeneratesNew(t *testing.T) {
	conn := getTestDB(t)
	defer conn.Close(context.Background())
	ctx := context.Background()

	_, _, _, mailboxID := createThreadingTestMailbox(t, conn)

	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatalf("conn.Begin: %v", err)
	}
	defer tx.Rollback(ctx)

	replyThreadID, err := ComputeThreadID(ctx, tx, mailboxID, "", "")
	if err != nil {
		t.Fatalf("ComputeThreadID: %v", err)
	}
	if replyThreadID != "" {
		t.Errorf("got thread_id %q, want empty string", replyThreadID)
	}
}

// Test 4: TestComputeThreadIDMailboxScoped
func TestComputeThreadIDMailboxScoped(t *testing.T) {
	conn := getTestDB(t)
	defer conn.Close(context.Background())
	ctx := context.Background()

	_, _, domainIDA, mailboxA := createThreadingTestMailbox(t, conn)
	_, _, _, mailboxB := createThreadingTestMailbox(t, conn)

	insertThreadingTestMessage(t, conn, mailboxA, domainIDA, "shared@test", "")

	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatalf("conn.Begin: %v", err)
	}
	defer tx.Rollback(ctx)

	replyThreadID, err := ComputeThreadID(ctx, tx, mailboxB, "shared@test", "")
	if err != nil {
		t.Fatalf("ComputeThreadID: %v", err)
	}
	if replyThreadID != "" {
		t.Errorf("got cross-mailbox thread_id %q, want empty string", replyThreadID)
	}
}

// Test 5: TestNormalizeMsgID
func TestNormalizeMsgID(t *testing.T) {
	cases := []struct {
		input    string
		expected string
	}{
		{"<id@host>", "id@host"},
		{"id@host", "id@host"},
		{" <id@host> ", "id@host"},
		{"<id@host> <other@host>", "id@host"},
		{"\t<id@host>\n", "id@host"},
	}
	for _, tc := range cases {
		got := normalizeMsgID(tc.input)
		if got != tc.expected {
			t.Errorf("normalizeMsgID(%q) = %q; want %q", tc.input, got, tc.expected)
		}
	}
}

// Test 6: TestImportAssignsThreadID
func TestImportAssignsThreadID(t *testing.T) {
	conn := getTestDB(t)
	defer conn.Close(context.Background())
	ctx := context.Background()

	_, userID, _, mailboxID := createThreadingTestMailbox(t, conn)

	// Create session for user
	token, tokenHash := generateSessionToken()
	_, err := conn.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
		userID, tokenHash, time.Now().Add(24*time.Hour))
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	// Mock crypto worker
	cryptoServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"ciphertext":               base64.StdEncoding.EncodeToString([]byte("fake ciphertext")),
			"content_key_hpke_wrapped": base64.StdEncoding.EncodeToString([]byte("fake wrapped key")),
			"encryption_iv":            base64.StdEncoding.EncodeToString([]byte("123456789012")),
			"bundle_hash":              base64.StdEncoding.EncodeToString([]byte("fake bundle hash")),
			"encryption_version":       1,
			"aad_version":              1,
		})
	}))
	defer cryptoServer.Close()
	t.Setenv("CRYPTO_WORKER_URL", cryptoServer.URL)

	// Mock storage worker
	storageServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	}))
	defer storageServer.Close()
	t.Setenv("STORAGE_WORKER_URL", storageServer.URL)

	parentEml := "Message-ID: <parent-import-1@test.local>\r\nFrom: parent@test.local\r\nTo: user@thread.test\r\nSubject: Parent\r\nDate: Fri, 25 Sep 2026 12:00:00 +0000\r\n\r\nParent body"
	replyEml := "Message-ID: <reply-import-1@test.local>\r\nIn-Reply-To: <parent-import-1@test.local>\r\nReferences: <parent-import-1@test.local>\r\nFrom: reply@test.local\r\nTo: user@thread.test\r\nSubject: Re: Parent\r\nDate: Fri, 25 Sep 2026 12:05:00 +0000\r\n\r\nReply body"

	importMessage := func(eml string) {
		reqBody, _ := json.Marshal(map[string]interface{}{
			"raw_eml": base64.StdEncoding.EncodeToString([]byte(eml)),
			"folder":  "inbox",
			"is_read": false,
		})
		req := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mailboxID+"/messages/import", bytes.NewReader(reqBody))
		req.SetPathValue("mailbox_id", mailboxID)
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+token)

		w := httptest.NewRecorder()
		messageImportHandler(w, req)
		resp := w.Result()
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusCreated {
			t.Fatalf("import message failed with status %d: %s", resp.StatusCode, w.Body.String())
		}
	}

	importMessage(parentEml)
	importMessage(replyEml)

	var parentThreadID, replyThreadID string
	err = conn.QueryRow(ctx, `SELECT thread_id::text FROM message_metadata WHERE mailbox_id = $1 AND message_id = 'parent-import-1@test.local'`, mailboxID).Scan(&parentThreadID)
	if err != nil {
		t.Fatalf("query parent thread_id: %v", err)
	}

	err = conn.QueryRow(ctx, `SELECT thread_id::text FROM message_metadata WHERE mailbox_id = $1 AND message_id = 'reply-import-1@test.local'`, mailboxID).Scan(&replyThreadID)
	if err != nil {
		t.Fatalf("query reply thread_id: %v", err)
	}

	if parentThreadID == "" {
		t.Errorf("parent thread_id is empty")
	}
	if replyThreadID == "" {
		t.Errorf("reply thread_id is empty")
	}
	if parentThreadID != replyThreadID {
		t.Errorf("expected parent thread_id %q == reply thread_id %q", parentThreadID, replyThreadID)
	}
}
