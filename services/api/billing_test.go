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

	if resp.SeatCount < 1 {
		t.Fatalf("expected seat_count >= 1 in response, got %d", resp.SeatCount)
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

	orgID, ownerID, adminID, memberID := createTestOrgAndUsers(t, db)
	ownerToken := createTestSession(t, db, ownerID)
	adminToken := createTestSession(t, db, adminID)
	memberToken := createTestSession(t, db, memberID)

	// 1. Non-owner (member) cannot update seats (403)
	body := bytes.NewBufferString(`{"seat_count":10}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/organizations/"+orgID+"/billing", body)
	req.SetPathValue("org_id", orgID)
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: memberToken})
	rec := httptest.NewRecorder()
	billingHandler(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 when member updates plan, got %d", rec.Code)
	}

	// Non-owner (admin) cannot update seats (403)
	body = bytes.NewBufferString(`{"seat_count":10}`)
	req = httptest.NewRequest(http.MethodPost, "/v1/organizations/"+orgID+"/billing", body)
	req.SetPathValue("org_id", orgID)
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: adminToken})
	rec = httptest.NewRecorder()
	billingHandler(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 when admin updates plan, got %d", rec.Code)
	}

	// 2. Invalid seat count (400)
	body = bytes.NewBufferString(`{"seat_count":0}`)
	req = httptest.NewRequest(http.MethodPost, "/v1/organizations/"+orgID+"/billing", body)
	req.SetPathValue("org_id", orgID)
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: ownerToken})
	rec = httptest.NewRecorder()
	billingHandler(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid seat count, got %d", rec.Code)
	}

	// 3. Owner updates seats successfully (200)
	body = bytes.NewBufferString(`{"seat_count":10}`)
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
	if resp.SeatCount != 10 {
		t.Fatalf("expected seat_count 10, got %d", resp.SeatCount)
	}
	if resp.MailboxLimit != 10 {
		t.Fatalf("expected mailbox limit 10, got %d", resp.MailboxLimit)
	}

	// 4. Unsupported method -> 405
	req = httptest.NewRequest(http.MethodDelete, "/v1/organizations/"+orgID+"/billing", nil)
	req.SetPathValue("org_id", orgID)
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: ownerToken})
	rec = httptest.NewRecorder()
	billingHandler(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("expected 405 Method Not Allowed, got %d", rec.Code)
	}
}

func TestOrganizationSeatsHandler(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
	ownerToken := createTestSession(t, db, ownerID)
	createTestDomainAndMailbox(t, db, orgID) // 1 active mailbox

	// 1. Valid PATCH to 20 seats
	body := bytes.NewBufferString(`{"seat_count":20}`)
	req := httptest.NewRequest(http.MethodPatch, "/v1/organizations/"+orgID+"/seats", body)
	req.SetPathValue("org_id", orgID)
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: ownerToken})
	rec := httptest.NewRecorder()
	organizationSeatsHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp["seat_count"] != float64(20) {
		t.Fatalf("expected seat_count 20, got %v", resp["seat_count"])
	}
	if resp["monthly_total_cents"] != float64(5850) {
		t.Fatalf("expected monthly_total_cents 5850, got %v", resp["monthly_total_cents"])
	}
	if resp["annual_total_cents"] != float64(58500) {
		t.Fatalf("expected annual_total_cents 58500, got %v", resp["annual_total_cents"])
	}

	// 2. Reduce below active mailbox count (1 mailbox -> try 0 seats)
	body = bytes.NewBufferString(`{"seat_count":0}`)
	req = httptest.NewRequest(http.MethodPatch, "/v1/organizations/"+orgID+"/seats", body)
	req.SetPathValue("org_id", orgID)
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: ownerToken})
	rec = httptest.NewRecorder()
	organizationSeatsHandler(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request for seat_count 0, got %d", rec.Code)
	}
}

func TestOrganizationCapacityHandler(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
	ownerToken := createTestSession(t, db, ownerID)
	createTestDomainAndMailbox(t, db, orgID)

	req := httptest.NewRequest(http.MethodGet, "/v1/organizations/"+orgID+"/capacity", nil)
	req.SetPathValue("org_id", orgID)
	req.AddCookie(&http.Cookie{Name: "byos_session", Value: ownerToken})
	rec := httptest.NewRecorder()
	organizationCapacityHandler(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	mailboxes := resp["mailboxes"].(map[string]interface{})
	if mailboxes["used"] != float64(1) {
		t.Fatalf("expected 1 used mailbox, got %v", mailboxes["used"])
	}
	domains := resp["domains"].(map[string]interface{})
	if domains["used"] != float64(1) {
		t.Fatalf("expected 1 used domain, got %v", domains["used"])
	}
}
