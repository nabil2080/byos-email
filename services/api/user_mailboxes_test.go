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
	dsn := getValidatedTestDSN(t)
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

	_, err = conn.Exec(ctx, `INSERT INTO organizations (id, name, seat_count, org_recovery_pk) VALUES ($1, $2, 10, decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'))`, orgID, "Multi Mailbox Org")
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
	dsn := getValidatedTestDSN(t)
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

	_, err = conn.Exec(ctx, `INSERT INTO organizations (id, name, seat_count, org_recovery_pk) VALUES ($1, $2, 10, decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'))`, orgID, "SSE Concurrent Org")
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

func TestUserMailboxesIsolation_PrivatePolicy(t *testing.T) {
	dsn := getValidatedTestDSN(t)
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Skipf("skipping test; db unreachable: %v", err)
	}
	defer conn.Close(ctx)

	orgID := uuid.New().String()
	domainID := uuid.New().String()
	domainName := "priv-" + uuid.New().String()[:8] + ".org"
	_, err = conn.Exec(ctx, `INSERT INTO organizations (id, name, seat_count, org_recovery_pk) VALUES ($1, $2, 10, decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'))`, orgID, "Private Isolation Org")
	if err != nil {
		t.Fatalf("insert org: %v", err)
	}
	defer conn.Exec(ctx, `DELETE FROM organizations WHERE id=$1`, orgID)

	_, err = conn.Exec(ctx, `INSERT INTO domains (id, org_id, name, is_verified) VALUES ($1, $2, $3, true)`, domainID, orgID, domainName)
	if err != nil {
		t.Fatalf("insert domain: %v", err)
	}

	pwHash, _ := hashPassword("password123")
	aliceID, bobID, adminID := uuid.New().String(), uuid.New().String(), uuid.New().String()
	_, err = conn.Exec(ctx, `INSERT INTO users (id, org_id, email, password_hash, display_name, role, is_active) VALUES ($1, $2, $3, $4, 'Alice Owner', 'owner', true)`, aliceID, orgID, "alice@"+domainName, pwHash)
	if err != nil {
		t.Fatalf("insert alice: %v", err)
	}
	_, err = conn.Exec(ctx, `INSERT INTO users (id, org_id, email, password_hash, display_name, role, is_active) VALUES ($1, $2, $3, $4, 'Bob Member', 'member', true)`, bobID, orgID, "bob@"+domainName, pwHash)
	if err != nil {
		t.Fatalf("insert bob: %v", err)
	}
	_, err = conn.Exec(ctx, `INSERT INTO users (id, org_id, email, password_hash, display_name, role, is_active) VALUES ($1, $2, $3, $4, 'Carol Admin', 'admin', true)`, adminID, orgID, "carol@"+domainName, pwHash)
	if err != nil {
		t.Fatalf("insert admin: %v", err)
	}

	aliceMbID, bobMbID := uuid.New().String(), uuid.New().String()
	_, err = conn.Exec(ctx, `INSERT INTO mailboxes (id, org_id, user_id, domain_id, local_part, mode, is_active) VALUES ($1, $2, $3, $4, 'alice', 'private', true)`, aliceMbID, orgID, aliceID, domainID)
	if err != nil {
		t.Fatalf("insert alice mb: %v", err)
	}
	_, err = conn.Exec(ctx, `INSERT INTO mailboxes (id, org_id, user_id, domain_id, local_part, mode, is_active) VALUES ($1, $2, $3, $4, 'bob', 'private', true)`, bobMbID, orgID, bobID, domainID)
	if err != nil {
		t.Fatalf("insert bob mb: %v", err)
	}

	expires := time.Now().Add(24 * time.Hour)
	aliceTok, aliceHash := generateSessionToken()
	bobTok, bobHash := generateSessionToken()
	adminTok, adminHash := generateSessionToken()
	for _, s := range []struct {
		uid  string
		hash []byte
	}{{aliceID, aliceHash}, {bobID, bobHash}, {adminID, adminHash}} {
		if _, err := conn.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`, s.uid, s.hash, expires); err != nil {
			t.Fatalf("insert session: %v", err)
		}
	}

	callList := func(tok string, activeHeader string) []UserMailboxItem {
		req := httptest.NewRequest(http.MethodGet, "/v1/users/me/mailboxes?mailbox_id="+bobMbID, nil)
		req.Header.Set("Authorization", "Bearer "+tok)
		if activeHeader != "" {
			req.Header.Set("X-BYOS-Active-Mailbox", activeHeader)
		}
		w := httptest.NewRecorder()
		userMailboxesHandler(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}
		var resp struct {
			Mailboxes []UserMailboxItem `json:"mailboxes"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
			t.Fatalf("decode: %v", err)
		}
		return resp.Mailboxes
	}

	// 1 & 3 & 4 & 6: Alice (owner) sees ONLY Alice's mailbox, never Bob's even with manipulated header/query
	aliceList := callList(aliceTok, bobMbID)
	if len(aliceList) != 1 || aliceList[0].ID != aliceMbID {
		t.Fatalf("owner Alice must see only her own mailbox %s, got %+v", aliceMbID, aliceList)
	}

	// 2: Bob sees ONLY Bob's mailbox, never Alice's
	bobList := callList(bobTok, aliceMbID)
	if len(bobList) != 1 || bobList[0].ID != bobMbID {
		t.Fatalf("Bob must see only his own mailbox %s, got %+v", bobMbID, bobList)
	}

	// 5: Admin sees 0 mailboxes (has no owned mailbox and must not see Bob's or Alice's)
	adminList := callList(adminTok, bobMbID)
	if len(adminList) != 0 {
		t.Fatalf("admin without own mailbox must see 0 mailboxes, got %+v", adminList)
	}
}

func TestOrgMailboxesRoleEnforcement(t *testing.T) {
	dsn := getValidatedTestDSN(t)
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Skipf("skipping test; db unreachable: %v", err)
	}
	defer conn.Close(ctx)

	orgID, otherOrgID := uuid.New().String(), uuid.New().String()
	domainID := uuid.New().String()
	domainName := "orgrole-" + uuid.New().String()[:8] + ".org"
	_, err = conn.Exec(ctx, `INSERT INTO organizations (id, name, seat_count, org_recovery_pk) VALUES ($1, 'Role Org', 10, decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'))`, orgID)
	if err != nil {
		t.Fatalf("insert org: %v", err)
	}
	defer conn.Exec(ctx, `DELETE FROM organizations WHERE id=$1`, orgID)
	_, err = conn.Exec(ctx, `INSERT INTO organizations (id, name, seat_count, org_recovery_pk) VALUES ($1, 'Other Org', 10, decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'))`, otherOrgID)
	if err != nil {
		t.Fatalf("insert other org: %v", err)
	}
	defer conn.Exec(ctx, `DELETE FROM organizations WHERE id=$1`, otherOrgID)

	_, err = conn.Exec(ctx, `INSERT INTO domains (id, org_id, name, is_verified) VALUES ($1, $2, $3, true)`, domainID, orgID, domainName)
	if err != nil {
		t.Fatalf("insert domain: %v", err)
	}

	pwHash, _ := hashPassword("password123")
	ownerID, adminID, memberID, outsiderID := uuid.New().String(), uuid.New().String(), uuid.New().String(), uuid.New().String()
	for _, u := range []struct {
		id, oid, email, role string
	}{
		{ownerID, orgID, "owner@" + domainName, "owner"},
		{adminID, orgID, "admin@" + domainName, "admin"},
		{memberID, orgID, "member@" + domainName, "member"},
		{outsiderID, otherOrgID, "outsider@" + domainName, "owner"},
	} {
		if _, err := conn.Exec(ctx, `INSERT INTO users (id, org_id, email, password_hash, display_name, role, is_active) VALUES ($1, $2, $3, $4, $5, $6, true)`, u.id, u.oid, u.email, pwHash, u.role, u.role); err != nil {
			t.Fatalf("insert user %s: %v", u.role, err)
		}
	}

	mbID := uuid.New().String()
	_, err = conn.Exec(ctx, `INSERT INTO mailboxes (id, org_id, user_id, domain_id, local_part, mode, is_active) VALUES ($1, $2, $3, $4, 'member', 'private', true)`, mbID, orgID, memberID, domainID)
	if err != nil {
		t.Fatalf("insert mb: %v", err)
	}

	expires := time.Now().Add(24 * time.Hour)
	mkTok := func(uid string) string {
		tok, h := generateSessionToken()
		if _, err := conn.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`, uid, h, expires); err != nil {
			t.Fatalf("insert session: %v", err)
		}
		return tok
	}
	ownerTok, adminTok, memberTok, outsiderTok := mkTok(ownerID), mkTok(adminID), mkTok(memberID), mkTok(outsiderID)

	callOrg := func(tok string) int {
		req := httptest.NewRequest(http.MethodGet, "/v1/organizations/"+orgID+"/mailboxes", nil)
		req.SetPathValue("org_id", orgID)
		if tok != "" {
			req.Header.Set("Authorization", "Bearer "+tok)
		}
		w := httptest.NewRecorder()
		mailboxesHandler(w, req)
		return w.Code
	}

	if code := callOrg(""); code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated expected 401, got %d", code)
	}
	if code := callOrg(memberTok); code != http.StatusForbidden {
		t.Fatalf("normal member expected 403, got %d", code)
	}
	if code := callOrg(outsiderTok); code != http.StatusForbidden {
		t.Fatalf("unrelated org member expected 403, got %d", code)
	}
	if code := callOrg(adminTok); code != http.StatusOK {
		t.Fatalf("admin expected 200, got %d", code)
	}
	if code := callOrg(ownerTok); code != http.StatusOK {
		t.Fatalf("owner expected 200, got %d", code)
	}
}
