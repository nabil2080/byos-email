package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func setupTestApp(t *testing.T) (*App, *pgxpool.Pool) {
	t.Helper()
	dsn := strings.TrimSpace(os.Getenv("TEST_DATABASE_URL"))
	if dsn == "" {
		t.Skip("skipping integration test: TEST_DATABASE_URL environment variable is not set")
		return nil, nil
	}
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatalf("invalid TEST_DATABASE_URL: %v", err)
	}
	host := u.Hostname()
	allowedHosts := map[string]bool{
		"localhost":     true,
		"127.0.0.1":     true,
		"::1":           true,
		"postgres":      true,
		"byos-postgres": true,
	}
	if !allowedHosts[host] && os.Getenv("BYOS_ALLOW_REMOTE_TEST_DB") != "true" {
		t.Fatalf("SAFETY VIOLATION: Refusing to run tests against non-local host '%s' (set BYOS_ALLOW_REMOTE_TEST_DB=true to override)", host)
	}
	dbName := strings.TrimPrefix(u.Path, "/")
	if strings.EqualFold(dbName, "byos") && os.Getenv("BYOS_ALLOW_DEV_DB_TEST") != "true" {
		t.Fatalf("SAFETY VIOLATION: Refusing to run tests against development database '%s' (set BYOS_ALLOW_DEV_DB_TEST=true to override)", dbName)
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Skipf("skipping test; db unreachable: %v", err)
	}
	t.Cleanup(func() { pool.Close() })

	// Mock Crypto Worker
	cryptoServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		resp := cryptoEncryptResponse{
			Ciphertext:            base64.StdEncoding.EncodeToString([]byte("encrypted-ciphertext-data")),
			ContentKeyHPKEWrapped: base64.StdEncoding.EncodeToString([]byte("hpke-wrapped-key-bytes-dummy")),
			EncryptionIV:          base64.StdEncoding.EncodeToString([]byte("123456789012")),
			BundleHash:            base64.StdEncoding.EncodeToString([]byte("32bytesbundlehashdummydata123456")),
			EncryptionVersion:     1,
			AADVersion:            1,
			WrappedKeyAlgorithm:   "HPKE-X25519-AES256GCM-v1",
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}))
	t.Cleanup(func() { cryptoServer.Close() })

	// Mock Storage Worker
	storageServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	}))
	t.Cleanup(func() { storageServer.Close() })

	app := &App{
		pool:       pool,
		httpClient: http.DefaultClient,
		cfg: Config{
			CryptoWorkerURL:    cryptoServer.URL,
			StorageWorkerURL:   storageServer.URL,
			StorageInternalKey: "test-internal-key",
		},
	}

	return app, pool
}

func setupMailboxAndAlias(t *testing.T, pool *pgxpool.Pool, prefix string, aliasEnabled bool) (orgID, mailboxID, aliasID, aliasAddress, mailboxEmail string) {
	ctx := context.Background()
	orgID = uuid.New().String()
	domainID := uuid.New().String()
	domainName := prefix + "-" + uuid.New().String()[:8] + ".local"
	mailboxID = uuid.New().String()
	storageConnID := uuid.New().String()

	orgRecoveryPK := make([]byte, 32)
	copy(orgRecoveryPK, []byte("org-recovery-pk-32bytes-12345678"))
	_, err := pool.Exec(ctx, `INSERT INTO organizations (id, name, org_recovery_pk) VALUES ($1, $2, $3)`, orgID, "Alias Org "+prefix, orgRecoveryPK)
	if err != nil {
		t.Fatalf("insert org: %v", err)
	}

	_, err = pool.Exec(ctx, `INSERT INTO domains (id, org_id, name, is_verified) VALUES ($1, $2, $3, true)`, domainID, orgID, domainName)
	if err != nil {
		t.Fatalf("insert domain: %v", err)
	}

	pk32 := make([]byte, 32)
	copy(pk32, []byte("32-byte-dummy-public-key-1234567"))
	_, err = pool.Exec(ctx, `
		INSERT INTO mailboxes (id, org_id, domain_id, local_part, mode, is_active, mailbox_pk, mailbox_sk_version)
		VALUES ($1, $2, $3, $4, 'private', true, $5, 1)
	`, mailboxID, orgID, domainID, prefix, pk32)
	if err != nil {
		t.Fatalf("insert mailbox: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO storage_connections (id, org_id, provider_type, bucket_name, credentials_enc, status)
		VALUES ($1, $2, 's3', 'test-bucket', 'dummy-credentials', 'active')
	`, storageConnID, orgID)
	if err != nil {
		t.Fatalf("insert storage connection: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO mailbox_storage (mailbox_id, storage_connection_id, status, object_prefix)
		VALUES ($1, $2, 'active', 'mailboxes/' || $3)
	`, mailboxID, storageConnID, mailboxID)
	if err != nil {
		t.Fatalf("insert mailbox storage: %v", err)
	}

	aliasID = uuid.New().String()
	aliasAddress = "alias-" + uuid.New().String()[:8] + "@masked.byos.local"
	_, err = pool.Exec(ctx, `
		INSERT INTO masked_aliases (id, mailbox_id, alias_address, label, is_enabled, created_at)
		VALUES ($1, $2, $3, 'Test Inbound Alias', $4, now())
	`, aliasID, mailboxID, aliasAddress, aliasEnabled)
	if err != nil {
		t.Fatalf("insert masked alias: %v", err)
	}

	t.Cleanup(func() {
		cleanupMailboxAndAlias(t, pool, orgID, mailboxID)
	})

	mailboxEmail = prefix + "@" + domainName
	return orgID, mailboxID, aliasID, aliasAddress, mailboxEmail
}

func cleanupMailboxAndAlias(t *testing.T, pool *pgxpool.Pool, orgID, mailboxID string) {
	t.Helper()
	ctx := context.Background()
	_, _ = pool.Exec(ctx, `DELETE FROM masked_alias_reply_map WHERE alias_id IN (SELECT id FROM masked_aliases WHERE mailbox_id = $1)`, mailboxID)
	_, _ = pool.Exec(ctx, `DELETE FROM message_metadata WHERE mailbox_id = $1`, mailboxID)
	_, _ = pool.Exec(ctx, `DELETE FROM masked_aliases WHERE mailbox_id = $1`, mailboxID)
	_, _ = pool.Exec(ctx, `DELETE FROM mailbox_storage WHERE mailbox_id = $1`, mailboxID)
	_, _ = pool.Exec(ctx, `DELETE FROM storage_connections WHERE org_id = $1`, orgID)
	_, _ = pool.Exec(ctx, `DELETE FROM mailboxes WHERE org_id = $1`, orgID)
	_, _ = pool.Exec(ctx, `DELETE FROM domains WHERE org_id = $1`, orgID)
	if _, err := pool.Exec(ctx, `DELETE FROM organizations WHERE id = $1`, orgID); err != nil {
		t.Logf("cleanup organization %s: %v", orgID, err)
	}
}

func TestAliasRoutingRewritesRecipient(t *testing.T) {
	app, pool := setupTestApp(t)

	ctx := context.Background()
	orgID, mailboxID, _, aliasAddress, mailboxEmail := setupMailboxAndAlias(t, pool, "rewritetest", true)
	_ = orgID

	rawMsg := []byte("From: sender@example.com\r\nTo: " + aliasAddress + "\r\nSubject: Hello Alias\r\n\r\nTest body")
	delIdent := deliveryIdentity("sender@example.com", []string{aliasAddress}, rawMsg)

	stored, err := app.processRecipient(ctx, "sender@example.com", aliasAddress, rawMsg, delIdent, []string{aliasAddress}, nil)
	if err != nil {
		t.Fatalf("processRecipient failed: %v", err)
	}

	if stored.MailboxID != mailboxID {
		t.Fatalf("expected message delivered to owning mailbox %s, got %s", mailboxID, stored.MailboxID)
	}
	if strings.ToLower(stored.Recipient) != strings.ToLower(mailboxEmail) {
		t.Fatalf("expected recipient rewritten to %s, got %s", mailboxEmail, stored.Recipient)
	}

	// Verify message in DB
	var dbMailboxID string
	err = pool.QueryRow(ctx, "SELECT mailbox_id::text FROM message_metadata WHERE id = $1", stored.MessageID).Scan(&dbMailboxID)
	if err != nil {
		t.Fatalf("query message metadata: %v", err)
	}
	if dbMailboxID != mailboxID {
		t.Fatalf("expected db mailbox_id %s, got %s", mailboxID, dbMailboxID)
	}
}

func TestAliasRoutingRejectsUnknown(t *testing.T) {
	app, _ := setupTestApp(t)

	ctx := context.Background()
	nonExistentAlias := "nonexistent12345678@masked.byos.local"
	rawMsg := []byte("From: sender@example.com\r\nTo: " + nonExistentAlias + "\r\nSubject: Unknown\r\n\r\nBody")
	delIdent := deliveryIdentity("sender@example.com", []string{nonExistentAlias}, rawMsg)

	_, err := app.processRecipient(ctx, "sender@example.com", nonExistentAlias, rawMsg, delIdent, []string{nonExistentAlias}, nil)
	if err == nil {
		t.Fatalf("expected error for nonexistent alias, got nil")
	}

	if !strings.Contains(err.Error(), "550") || !strings.Contains(strings.ToLower(err.Error()), "unknown recipient") {
		t.Fatalf("expected error containing '550 unknown recipient', got %q", err.Error())
	}
}

func TestAliasRoutingRejectsDisabled(t *testing.T) {
	app, pool := setupTestApp(t)

	ctx := context.Background()
	orgID, _, _, disabledAlias, _ := setupMailboxAndAlias(t, pool, "disabledtest", false)
	_ = orgID

	rawMsg := []byte("From: sender@example.com\r\nTo: " + disabledAlias + "\r\nSubject: Disabled\r\n\r\nBody")
	delIdent := deliveryIdentity("sender@example.com", []string{disabledAlias}, rawMsg)

	_, err := app.processRecipient(ctx, "sender@example.com", disabledAlias, rawMsg, delIdent, []string{disabledAlias}, nil)
	if err == nil {
		t.Fatalf("expected error for disabled alias, got nil")
	}

	if !strings.Contains(err.Error(), "550") || !strings.Contains(strings.ToLower(err.Error()), "alias disabled") {
		t.Fatalf("expected error containing '550 alias disabled', got %q", err.Error())
	}
}

func TestAliasReplyMapInserted(t *testing.T) {
	app, pool := setupTestApp(t)

	ctx := context.Background()
	orgID, mailboxID, aliasID, aliasAddress, _ := setupMailboxAndAlias(t, pool, "replymaptest", true)
	_ = orgID

	sender := "original-sender@external.com"
	rawMsg := []byte("From: " + sender + "\r\nTo: " + aliasAddress + "\r\nSubject: Inbound to Alias\r\n\r\nBody content")
	delIdent := deliveryIdentity(sender, []string{aliasAddress}, rawMsg)

	stored, err := app.processRecipient(ctx, sender, aliasAddress, rawMsg, delIdent, []string{aliasAddress}, nil)
	if err != nil {
		t.Fatalf("processRecipient failed: %v", err)
	}

	// Verify row in masked_alias_reply_map
	var replyMapAliasID, replyMapSender string
	err = pool.QueryRow(ctx, `
		SELECT alias_id::text, original_sender
		FROM masked_alias_reply_map
		WHERE message_id = $1
	`, stored.MessageID).Scan(&replyMapAliasID, &replyMapSender)
	if err != nil {
		t.Fatalf("failed to query masked_alias_reply_map: %v", err)
	}

	if replyMapAliasID != aliasID {
		t.Fatalf("expected reply map alias_id %s, got %s", aliasID, replyMapAliasID)
	}
	if strings.ToLower(replyMapSender) != strings.ToLower(sender) {
		t.Fatalf("expected original_sender %s, got %s", sender, replyMapSender)
	}
	_ = mailboxID
}
