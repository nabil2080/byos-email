package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestBillingAuthAndValidation(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
	token := createTestSession(t, db, ownerID)

	// 1. Missing org_id
	req := httptest.NewRequest(http.MethodGet, "/v1/organizations//billing", nil)
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	rec := httptest.NewRecorder()
	billingHandler(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for empty org_id, got %d", rec.Code)
	}

	// 2. Invalid UUID
	req = httptest.NewRequest(http.MethodGet, "/v1/organizations/not-a-uuid/billing", nil)
	req.SetPathValue("org_id", "not-a-uuid")
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	rec = httptest.NewRecorder()
	billingHandler(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid UUID, got %d", rec.Code)
	}

	// 3. Unauthorized (no session)
	req = httptest.NewRequest(http.MethodGet, "/v1/organizations/"+orgID+"/billing", nil)
	req.SetPathValue("org_id", orgID)
	rec = httptest.NewRecorder()
	billingHandler(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for unauthenticated request, got %d", rec.Code)
	}

	// 4. Forbidden (user from another organization)
	org2ID, owner2ID, _, _ := createTestOrgWithEmail(t, db, "other-org")
	_ = org2ID
	token2 := createTestSession(t, db, owner2ID)

	req = httptest.NewRequest(http.MethodGet, "/v1/organizations/"+orgID+"/billing", nil)
	req.SetPathValue("org_id", orgID)
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: token2})
	rec = httptest.NewRecorder()
	billingHandler(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for cross-org user, got %d", rec.Code)
	}
}

func TestBillingGet(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
	token := createTestSession(t, db, ownerID)
	createTestDomainAndMailbox(t, db, orgID)

	req := httptest.NewRequest(http.MethodGet, "/v1/organizations/"+orgID+"/billing", nil)
	req.SetPathValue("org_id", orgID)
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
	rec := httptest.NewRecorder()

	billingHandler(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp BillingResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	if resp.Plan == "" {
		t.Fatalf("expected plan in response, got empty")
	}
	if resp.UsedMailboxes != 1 {
		t.Fatalf("expected 1 used mailbox, got %d", resp.UsedMailboxes)
	}
	if resp.UsedDomains != 1 {
		t.Fatalf("expected 1 used domain, got %d", resp.UsedDomains)
	}
}

func TestBillingPost(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	orgID, ownerID, memberID, _ := createTestOrgAndUsers(t, db)
	ownerToken := createTestSession(t, db, ownerID)
	memberToken := createTestSession(t, db, memberID)

	// 1. Non-owner cannot update plan (403)
	body := bytes.NewBufferString(`{"plan":"starter"}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/organizations/"+orgID+"/billing", body)
	req.SetPathValue("org_id", orgID)
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: memberToken})
	rec := httptest.NewRecorder()
	billingHandler(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 when non-owner updates plan, got %d", rec.Code)
	}

	// 2. Invalid plan name (400)
	body = bytes.NewBufferString(`{"plan":"super_platinum_unlimited"}`)
	req = httptest.NewRequest(http.MethodPost, "/v1/organizations/"+orgID+"/billing", body)
	req.SetPathValue("org_id", orgID)
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: ownerToken})
	rec = httptest.NewRecorder()
	billingHandler(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid plan name, got %d", rec.Code)
	}

	// 3. Owner updates plan successfully (200)
	body = bytes.NewBufferString(`{"plan":"business"}`)
	req = httptest.NewRequest(http.MethodPost, "/v1/organizations/"+orgID+"/billing", body)
	req.SetPathValue("org_id", orgID)
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: ownerToken})
	rec = httptest.NewRecorder()
	billingHandler(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp BillingResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.Plan != "business" {
		t.Fatalf("expected plan business, got %s", resp.Plan)
	}
	if resp.MailboxLimit != 10 {
		t.Fatalf("expected mailbox limit 10 for business plan, got %d", resp.MailboxLimit)
	}

	// 4. Unsupported method -> 405
	req = httptest.NewRequest(http.MethodDelete, "/v1/organizations/"+orgID+"/billing", nil)
	req.SetPathValue("org_id", orgID)
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: ownerToken})
	rec = httptest.NewRecorder()
	billingHandler(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 for DELETE, got %d", rec.Code)
	}
}
