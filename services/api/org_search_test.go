package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestOrgSearch(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
	token := createTestSession(t, db, ownerID)
	createTestDomainAndMailbox(t, db, orgID)

	t.Run("Unauthenticated returns 401", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/v1/organizations/"+orgID+"/search?q=test", nil)
		req.SetPathValue("org_id", orgID)
		w := httptest.NewRecorder()

		organizationSearchHandler(w, req)
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401, got %d", w.Code)
		}
	})

	t.Run("Invalid org ID returns 400", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/v1/organizations/not-a-uuid/search?q=test", nil)
		req.SetPathValue("org_id", "not-a-uuid")
		req.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
		w := httptest.NewRecorder()

		organizationSearchHandler(w, req)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d", w.Code)
		}
	})

	t.Run("Cross org returns 403", func(t *testing.T) {
		org2ID, owner2ID, _, _ := createTestOrgWithEmail(t, db, "other-org-search")
		_ = org2ID
		token2 := createTestSession(t, db, owner2ID)

		req := httptest.NewRequest(http.MethodGet, "/v1/organizations/"+orgID+"/search?q=test", nil)
		req.SetPathValue("org_id", orgID)
		req.AddCookie(&http.Cookie{Name: "byos_session", Value: token2})
		w := httptest.NewRecorder()

		organizationSearchHandler(w, req)
		if w.Code != http.StatusForbidden {
			t.Fatalf("expected 403, got %d", w.Code)
		}
	})

	t.Run("Empty query returns empty arrays", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/v1/organizations/"+orgID+"/search?q=", nil)
		req.SetPathValue("org_id", orgID)
		req.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
		w := httptest.NewRecorder()

		organizationSearchHandler(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}

		var res OrganizationSearchResponse
		if err := json.Unmarshal(w.Body.Bytes(), &res); err != nil {
			t.Fatalf("failed to parse json: %v", err)
		}
		if len(res.Domains) != 0 || len(res.Mailboxes) != 0 || len(res.Members) != 0 {
			t.Fatalf("expected empty arrays for empty query, got domains=%d, mailboxes=%d, members=%d",
				len(res.Domains), len(res.Mailboxes), len(res.Members))
		}
	})

	t.Run("Matching query returns org resources and zero sensitive data", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/v1/organizations/"+orgID+"/search?q=test", nil)
		req.SetPathValue("org_id", orgID)
		req.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
		w := httptest.NewRecorder()

		organizationSearchHandler(w, req)
		if w.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
		}

		rawBody := w.Body.String()
		// Security assertions: ensure no sensitive keys or password hashes leaked
		if strings.Contains(rawBody, "password_hash") || strings.Contains(rawBody, "wrapped_sk") ||
			strings.Contains(rawBody, "mailbox_sk") || strings.Contains(rawBody, "recovery_sk") {
			t.Fatalf("SECURITY VIOLATION: sensitive key leaked in search response: %s", rawBody)
		}

		var res OrganizationSearchResponse
		if err := json.Unmarshal(w.Body.Bytes(), &res); err != nil {
			t.Fatalf("failed to parse json: %v", err)
		}

		// createTestDomainAndMailbox created test domain and mailbox matching "test"
		if len(res.Domains) == 0 && len(res.Mailboxes) == 0 && len(res.Members) == 0 {
			t.Fatalf("expected at least one matching domain, mailbox, or member, got 0")
		}
	})
}
