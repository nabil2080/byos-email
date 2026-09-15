package main

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"
	"database/sql"

	"github.com/google/uuid"
)

// Helper for tests to create domain and mailbox
func createTestDomainAndMailbox(t *testing.T, db *sql.DB, orgID string) (domainID, mailboxID string) {
	t.Helper()
	err := db.QueryRow(`
		INSERT INTO domains (org_id, name, is_verified)
		VALUES ($1, $2, true)
		RETURNING id
	`, orgID, "test-"+uuid.NewString()+".local").Scan(&domainID)
	if err != nil {
		t.Fatalf("failed to insert domain: %v", err)
	}

	err = db.QueryRow(`
		INSERT INTO mailboxes (org_id, domain_id, local_part, mode)
		VALUES ($1, $2, $3, 'private')
		RETURNING id
	`, orgID, domainID, "user-"+uuid.NewString()).Scan(&mailboxID)
	if err != nil {
		t.Fatalf("failed to insert mailbox: %v", err)
	}
	return domainID, mailboxID
}

func TestTrackPixelHandler(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	token := uuid.NewString()
	orgID, _, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestDomainAndMailbox(t, db, orgID)

	_, err := db.Exec(`
		INSERT INTO message_tracking (mailbox_id, tracking_token, subject, recipient)
		VALUES ($1, $2, 'sub', 'rec@example.com')
	`, mailboxID, token)
	if err != nil {
		t.Fatalf("failed to insert message_tracking: %v", err)
	}

	t.Run("GET request with query id", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/v1/track?id="+token, nil)

		rr := httptest.NewRecorder()
		mux := http.NewServeMux()

		mux.HandleFunc("/v1/track", trackPixelHandler)

		mux.HandleFunc("/v1/track/{token}", trackPixelHandler)

		mux.ServeHTTP(rr, req)

		if rr.Code != http.StatusOK {
			t.Errorf("expected status %d, got %d", http.StatusOK, rr.Code)
		}
		if rr.Header().Get("Content-Type") != "image/gif" {
			t.Errorf("expected Content-Type image/gif, got %s", rr.Header().Get("Content-Type"))
		}

		var openCount int
		err := db.QueryRow(`SELECT open_count FROM message_tracking WHERE tracking_token = $1`, token).Scan(&openCount)
		if err != nil {
			t.Fatalf("failed to query open_count: %v", err)
		}
		if openCount != 1 {
			t.Errorf("expected open_count 1, got %d", openCount)
		}
	})

	t.Run("GET request with path value", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/v1/track/"+token+".gif", nil)
		req.SetPathValue("token", token+".gif")

		rr := httptest.NewRecorder()
		trackPixelHandler(rr, req)

		if rr.Code != http.StatusOK {
			t.Errorf("expected status %d, got %d", http.StatusOK, rr.Code)
		}

		var openCount int
		err := db.QueryRow(`SELECT open_count FROM message_tracking WHERE tracking_token = $1`, token).Scan(&openCount)
		if err != nil {
			t.Fatalf("failed to query open_count: %v", err)
		}
		if openCount != 2 {
			t.Errorf("expected open_count 2, got %d", openCount)
		}
	})

	t.Run("GET request missing path value and query parameter", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/v1/track/", nil)

		rr := httptest.NewRecorder()
		trackPixelHandler(rr, req)

		if rr.Code != http.StatusBadRequest {
			t.Errorf("expected status %d, got %d", http.StatusBadRequest, rr.Code)
		}
	})
}

func TestMailboxTrackingHandler(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestDomainAndMailbox(t, db, orgID)
	sessionToken := createTestSession(t, db, ownerID)

	otherOrgID, otherOwnerID, _, _ := createTestOrgAndUsers(t, db)
	otherSessionToken := createTestSession(t, db, otherOwnerID)
	_, _ = createTestDomainAndMailbox(t, db, otherOrgID)

	token := uuid.NewString()

	t.Run("POST create tracking token", func(t *testing.T) {
		reqBody := []byte(`{"tracking_token": "` + token + `", "subject": "Test Sub", "recipient": "rec@example.com"}`)
		req := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mailboxID+"/tracking", bytes.NewBuffer(reqBody))
		req.SetPathValue("mailbox_id", mailboxID)
		req.Header.Set("Authorization", "Bearer "+sessionToken)

		rr := httptest.NewRecorder()
		mailboxTrackingHandler(rr, req)

		if rr.Code != http.StatusCreated {
			t.Errorf("expected status %d, got %d. Body: %s", http.StatusCreated, rr.Code, rr.Body.String())
		}
	})

	t.Run("POST create without token", func(t *testing.T) {
		reqBody := []byte(`{"subject": "Test Sub", "recipient": "rec@example.com"}`)
		req := httptest.NewRequest(http.MethodPost, "/v1/mailboxes/"+mailboxID+"/tracking", bytes.NewBuffer(reqBody))
		req.SetPathValue("mailbox_id", mailboxID)
		req.Header.Set("Authorization", "Bearer "+sessionToken)

		rr := httptest.NewRecorder()
		mailboxTrackingHandler(rr, req)

		if rr.Code != http.StatusBadRequest {
			t.Errorf("expected status %d, got %d", http.StatusBadRequest, rr.Code)
		}
	})

	t.Run("GET list tracking tokens", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/v1/mailboxes/"+mailboxID+"/tracking", nil)
		req.SetPathValue("mailbox_id", mailboxID)
		req.Header.Set("Authorization", "Bearer "+sessionToken)

		rr := httptest.NewRecorder()
		mailboxTrackingHandler(rr, req)

		if rr.Code != http.StatusOK {
			t.Errorf("expected status %d, got %d", http.StatusOK, rr.Code)
		}

		if !bytes.Contains(rr.Body.Bytes(), []byte(token)) {
			t.Errorf("expected body to contain %s, got: %s", token, rr.Body.String())
		}
	})

	t.Run("Forbidden - user from different org", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/v1/mailboxes/"+mailboxID+"/tracking", nil)
		req.SetPathValue("mailbox_id", mailboxID)
		req.Header.Set("Authorization", "Bearer "+otherSessionToken)

		rr := httptest.NewRecorder()
		mailboxTrackingHandler(rr, req)

		if rr.Code != http.StatusForbidden {
			t.Errorf("expected status %d, got %d", http.StatusForbidden, rr.Code)
		}
	})
}

func TestMailboxTrackingItemHandler(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestDomainAndMailbox(t, db, orgID)
	sessionToken := createTestSession(t, db, ownerID)

	token := uuid.NewString()
	_, err := db.Exec(`
		INSERT INTO message_tracking (mailbox_id, tracking_token, subject, recipient)
		VALUES ($1, $2, 'Single Item Sub', 'single@example.com')
	`, mailboxID, token)
	if err != nil {
		t.Fatalf("failed to insert message_tracking: %v", err)
	}

	t.Run("GET existing item", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/v1/mailboxes/"+mailboxID+"/tracking/"+token, nil)
		req.SetPathValue("mailbox_id", mailboxID)
		req.SetPathValue("token", token)
		req.Header.Set("Authorization", "Bearer "+sessionToken)

		rr := httptest.NewRecorder()
		mailboxTrackingItemHandler(rr, req)

		if rr.Code != http.StatusOK {
			t.Errorf("expected status %d, got %d", http.StatusOK, rr.Code)
		}

		if !bytes.Contains(rr.Body.Bytes(), []byte(token)) {
			t.Errorf("expected body to contain token, got: %s", rr.Body.String())
		}
		if !bytes.Contains(rr.Body.Bytes(), []byte("Single Item Sub")) {
			t.Errorf("expected body to contain subject, got: %s", rr.Body.String())
		}
	})

	t.Run("GET existing item with .gif extension", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/v1/mailboxes/"+mailboxID+"/tracking/"+token+".gif", nil)
		req.SetPathValue("mailbox_id", mailboxID)
		req.SetPathValue("token", token+".gif")
		req.Header.Set("Authorization", "Bearer "+sessionToken)

		rr := httptest.NewRecorder()
		mailboxTrackingItemHandler(rr, req)

		if rr.Code != http.StatusOK {
			t.Errorf("expected status %d, got %d", http.StatusOK, rr.Code)
		}
	})

	t.Run("GET non-existent item", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/v1/mailboxes/"+mailboxID+"/tracking/nonexistent", nil)
		req.SetPathValue("mailbox_id", mailboxID)
		req.SetPathValue("token", "nonexistent")
		req.Header.Set("Authorization", "Bearer "+sessionToken)

		rr := httptest.NewRecorder()
		mailboxTrackingItemHandler(rr, req)

		if rr.Code != http.StatusNotFound {
			t.Errorf("expected status %d, got %d", http.StatusNotFound, rr.Code)
		}
	})

	t.Run("Forbidden - user from different org", func(t *testing.T) {
		otherOrgID, otherOwnerID, _, _ := createTestOrgAndUsers(t, db)
		otherSessionToken := createTestSession(t, db, otherOwnerID)
		_, _ = createTestDomainAndMailbox(t, db, otherOrgID)

		req := httptest.NewRequest(http.MethodGet, "/v1/mailboxes/"+mailboxID+"/tracking/"+token, nil)
		req.SetPathValue("mailbox_id", mailboxID)
		req.SetPathValue("token", token)
		req.Header.Set("Authorization", "Bearer "+otherSessionToken)

		rr := httptest.NewRecorder()
		mailboxTrackingItemHandler(rr, req)

		if rr.Code != http.StatusForbidden {
			t.Errorf("expected status %d, got %d", http.StatusForbidden, rr.Code)
		}
	})
}
