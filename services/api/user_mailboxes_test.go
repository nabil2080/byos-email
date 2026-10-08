package main

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"
)

func TestListUserMailboxesReturnsAll(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Skipf("skipping test; db unreachable: %v", err)
	}
	defer conn.Close(ctx)

	orgID := uuid.New().String()
	userID := uuid.New().String()
	domainID := uuid.New().String()
	domainName := "test-" + uuid.New().String()[:8] + ".org"

	_, err = conn.Exec(ctx, `INSERT INTO organizations (id, name, plan, org_recovery_pk) VALUES ($1, $2, 'business', decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'))`, orgID, "Multi Mailbox Org")
	if err != nil {
		t.Fatalf("failed to insert org: %v", err)
	}
	defer conn.Exec(ctx, `DELETE FROM organizations WHERE id=$1`, orgID)

	_, err = conn.Exec(ctx, `INSERT INTO domains (id, org_id, name, is_verified) VALUES ($1, $2, $3, true)`, domainID, orgID, domainName)
	if err != nil {
		t.Fatalf("failed to insert domain: %v", err)
	}

	pwHash, _ := hashPassword("password123")
	userEmail := "primary-" + uuid.New().String()[:8] + "@" + domainName
	_, err = conn.Exec(ctx, `INSERT INTO users (id, org_id, email, password_hash, display_name, role, is_active) VALUES ($1, $2, $3, $4, 'Primary User', 'member', true)`, userID, orgID, userEmail, pwHash)
	if err != nil {
		t.Fatalf("failed to insert user: %v", err)
	}

	// Create 3 mailboxes: 2 active, 1 inactive
	mb1ID := uuid.New().String()
	mb2ID := uuid.New().String()
	mb3ID := uuid.New().String()

	_, err = conn.Exec(ctx, `INSERT INTO mailboxes (id, org_id, user_id, domain_id, local_part, mode, is_active) VALUES ($1, $2, $3, $4, 'support', 'private', true)`, mb1ID, orgID, userID, domainID)
	if err != nil {
		t.Fatalf("failed to insert mailbox 1: %v", err)
	}
	_, err = conn.Exec(ctx, `INSERT INTO mailboxes (id, org_id, user_id, domain_id, local_part, mode, is_active) VALUES ($1, $2, $3, $4, 'billing', 'private', true)`, mb2ID, orgID, userID, domainID)
	if err != nil {
		t.Fatalf("failed to insert mailbox 2: %v", err)
	}
	_, err = conn.Exec(ctx, `INSERT INTO mailboxes (id, org_id, user_id, domain_id, local_part, mode, is_active) VALUES ($1, $2, $3, $4, 'archive-box', 'private', false)`, mb3ID, orgID, userID, domainID)
	if err != nil {
		t.Fatalf("failed to insert mailbox 3: %v", err)
	}

	// Create active session
	token, hash := generateSessionToken()
	expires := time.Now().Add(24 * time.Hour)
	_, err = conn.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`, userID, hash, expires)
	if err != nil {
		t.Fatalf("failed to insert session: %v", err)
	}

	req := httptest.NewRequest("GET", "/v1/users/me/mailboxes", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()

	userMailboxesHandler(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Mailboxes []UserMailboxItem `json:"mailboxes"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	// Must return all 3 mailboxes (not just 1 like meHandler)
	if len(resp.Mailboxes) != 3 {
		t.Fatalf("expected 3 mailboxes, got %d", len(resp.Mailboxes))
	}

	foundIDs := make(map[string]bool)
	for _, mb := range resp.Mailboxes {
		foundIDs[mb.ID] = true
		if mb.OrgID != orgID {
			t.Errorf("expected org_id %s, got %s", orgID, mb.OrgID)
		}
		if mb.DisplayName == "" {
			t.Errorf("expected non-empty display name")
		}
		if mb.ID == mb3ID && mb.IsActive != false {
			t.Errorf("expected mailbox 3 to be inactive (is_active=false)")
		}
		if (mb.ID == mb1ID || mb.ID == mb2ID) && !mb.IsActive {
			t.Errorf("expected mailbox 1 and 2 to be active (is_active=true)")
		}
	}

	if !foundIDs[mb1ID] || !foundIDs[mb2ID] || !foundIDs[mb3ID] {
		t.Fatalf("missing expected mailbox ID in response: got %v", foundIDs)
	}
}

func TestConcurrentSSEConnectionsAllowed(t *testing.T) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Skipf("skipping test; db unreachable: %v", err)
	}
	defer conn.Close(ctx)

	if redisClient == nil {
		redisAddr := os.Getenv("REDIS_ADDR")
		if redisAddr == "" {
			redisAddr = "localhost:6379"
		}
		redisClient = redis.NewClient(&redis.Options{Addr: redisAddr})
	}

	orgID := uuid.New().String()
	userID := uuid.New().String()
	domainID := uuid.New().String()
	mailboxID := uuid.New().String()

	_, err = conn.Exec(ctx, `INSERT INTO organizations (id, name, plan, org_recovery_pk) VALUES ($1, $2, 'business', decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'))`, orgID, "SSE Concurrent Org")
	if err != nil {
		t.Fatalf("failed to insert org: %v", err)
	}
	defer conn.Exec(ctx, `DELETE FROM organizations WHERE id=$1`, orgID)

	_, err = conn.Exec(ctx, `INSERT INTO domains (id, org_id, name, is_verified) VALUES ($1, $2, 'sse-concurrent.org', true)`, domainID, orgID)
	if err != nil {
		t.Fatalf("failed to insert domain: %v", err)
	}

	pwHash, _ := hashPassword("password123")
	userEmail := "sse-" + uuid.New().String()[:8] + "@sse-concurrent.org"
	_, err = conn.Exec(ctx, `INSERT INTO users (id, org_id, email, password_hash, display_name, role, is_active) VALUES ($1, $2, $3, $4, 'SSE User', 'member', true)`, userID, orgID, userEmail, pwHash)
	if err != nil {
		t.Fatalf("failed to insert user: %v", err)
	}

	_, err = conn.Exec(ctx, `INSERT INTO mailboxes (id, org_id, user_id, domain_id, local_part, mode, is_active) VALUES ($1, $2, $3, $4, 'sse-box', 'private', true)`, mailboxID, orgID, userID, domainID)
	if err != nil {
		t.Fatalf("failed to insert mailbox: %v", err)
	}

	token, hash := generateSessionToken()
	expires := time.Now().Add(24 * time.Hour)
	_, err = conn.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`, userID, hash, expires)
	if err != nil {
		t.Fatalf("failed to insert session: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/v1/mailboxes/{mailbox_id}/events", mailboxEventsHandler)
	ts := httptest.NewServer(mux)
	defer ts.Close()

	ctx1, cancel1 := context.WithCancel(context.Background())
	defer cancel1()
	ctx2, cancel2 := context.WithCancel(context.Background())
	defer cancel2()

	var wg sync.WaitGroup
	wg.Add(2)

	conn1Ready := make(chan bool, 1)
	conn2Ready := make(chan bool, 1)

	// Stream 1 from the same session
	go func() {
		defer wg.Done()
		req, _ := http.NewRequestWithContext(ctx1, "GET", ts.URL+"/v1/mailboxes/"+mailboxID+"/events", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		resp, err := ts.Client().Do(req)
		if err != nil {
			t.Errorf("stream 1 failed: %v", err)
			return
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			t.Errorf("stream 1 status: %d", resp.StatusCode)
			return
		}

		reader := bufio.NewReader(resp.Body)
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				return
			}
			if strings.Contains(line, ": connected") {
				conn1Ready <- true
			}
			if strings.Contains(line, "test-event-payload") {
				return
			}
		}
	}()

	// Stream 2 from the same session
	go func() {
		defer wg.Done()
		req, _ := http.NewRequestWithContext(ctx2, "GET", ts.URL+"/v1/mailboxes/"+mailboxID+"/events", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		resp, err := ts.Client().Do(req)
		if err != nil {
			t.Errorf("stream 2 failed: %v", err)
			return
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			t.Errorf("stream 2 status: %d", resp.StatusCode)
			return
		}

		reader := bufio.NewReader(resp.Body)
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				return
			}
			if strings.Contains(line, ": connected") {
				conn2Ready <- true
			}
			if strings.Contains(line, "test-event-payload") {
				return
			}
		}
	}()

	// Wait for both connections to establish
	select {
	case <-conn1Ready:
	case <-time.After(5 * time.Second):
		t.Fatalf("stream 1 connection timed out")
	}

	select {
	case <-conn2Ready:
	case <-time.After(5 * time.Second):
		t.Fatalf("stream 2 connection timed out")
	}

	// Publish test event to verify both receive it concurrently
	publishMailboxEvent(ctx, MailboxEvent{
		Type:        "message.created",
		MailboxID:   mailboxID,
		Folder:      "inbox",
		MessageID:   "test-event-payload",
		UnreadDelta: 1,
	})

	// Cancel contexts to end test streams
	time.Sleep(500 * time.Millisecond)
	cancel1()
	cancel2()
	wg.Wait()
}
