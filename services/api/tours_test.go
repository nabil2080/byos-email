package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func TestTourStateEndpoints(t *testing.T) {
	os.Setenv("BYOS_DEV_MODE", "1")
	db := setupTestDB(t)
	defer db.Close()

	orgID, ownerID, _, memberID := createTestOrgAndUsers(t, db)
	ownerToken := createTestSession(t, db, ownerID)
	memberToken := createTestSession(t, db, memberID)

	defer func() {
		_, _ = db.Exec(`DELETE FROM sessions WHERE user_id IN ($1, $2)`, ownerID, memberID)
		_, _ = db.Exec(`DELETE FROM users WHERE org_id=$1`, orgID)
		_, _ = db.Exec(`DELETE FROM organizations WHERE id=$1`, orgID)
	}()

	// 1. Unauthenticated GET /v1/tours/state -> 401
	{
		req := httptest.NewRequest(http.MethodGet, "/v1/tours/state", nil)
		rec := httptest.NewRecorder()
		tourStateHandler(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401 unauthenticated, got %d", rec.Code)
		}
	}

	// 2. TestTourStateEmptyByDefault -> 200 with empty tours
	{
		req := httptest.NewRequest(http.MethodGet, "/v1/tours/state", nil)
		req.AddCookie(&http.Cookie{Name: "byos_session", Value: ownerToken})
		rec := httptest.NewRecorder()
		tourStateHandler(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", rec.Code)
		}

		var resp TourStateResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("failed to decode json: %v", err)
		}
		if len(resp.Tours) != 0 {
			t.Fatalf("expected 0 tours, got %d", len(resp.Tours))
		}
	}

	// 3. TestTourRejectsUnknownTourId -> 400
	{
		req := httptest.NewRequest(http.MethodPost, "/v1/tours/invalid_tour/complete", nil)
		req.SetPathValue("tour_id", "invalid_tour")
		req.AddCookie(&http.Cookie{Name: "byos_session", Value: ownerToken})
		rec := httptest.NewRecorder()
		tourCompleteHandler(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 for unknown tour ID, got %d", rec.Code)
		}
	}

	// 4. TestTourComplete -> 200, sets completed_at, skipped_at is nil
	{
		body := bytes.NewBufferString(`{"last_step": 7}`)
		req := httptest.NewRequest(http.MethodPost, "/v1/tours/control_plane_v1/complete", body)
		req.SetPathValue("tour_id", "control_plane_v1")
		req.AddCookie(&http.Cookie{Name: "byos_session", Value: ownerToken})
		rec := httptest.NewRecorder()
		tourCompleteHandler(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d (%s)", rec.Code, rec.Body.String())
		}

		// Verify state via GET
		getReq := httptest.NewRequest(http.MethodGet, "/v1/tours/state", nil)
		getReq.AddCookie(&http.Cookie{Name: "byos_session", Value: ownerToken})
		getRec := httptest.NewRecorder()
		tourStateHandler(getRec, getReq)
		if getRec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", getRec.Code)
		}

		var state TourStateResponse
		if err := json.Unmarshal(getRec.Body.Bytes(), &state); err != nil {
			t.Fatalf("failed to unmarshal: %v", err)
		}
		cpTour, ok := state.Tours["control_plane_v1"]
		if !ok {
			t.Fatalf("expected control_plane_v1 tour in state")
		}
		if cpTour.CompletedAt == nil {
			t.Fatalf("expected completed_at to be non-nil")
		}
		if cpTour.SkippedAt != nil {
			t.Fatalf("expected skipped_at to be nil on complete")
		}
		if cpTour.LastStep != 7 {
			t.Fatalf("expected last_step 7, got %d", cpTour.LastStep)
		}
	}

	// 5. TestTourSkip -> 200, sets skipped_at, completed_at is nil
	{
		body := bytes.NewBufferString(`{"last_step": 2}`)
		req := httptest.NewRequest(http.MethodPost, "/v1/tours/control_plane_v1/skip", body)
		req.SetPathValue("tour_id", "control_plane_v1")
		req.AddCookie(&http.Cookie{Name: "byos_session", Value: ownerToken})
		rec := httptest.NewRecorder()
		tourSkipHandler(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d (%s)", rec.Code, rec.Body.String())
		}

		// Verify state via GET
		getReq := httptest.NewRequest(http.MethodGet, "/v1/tours/state", nil)
		getReq.AddCookie(&http.Cookie{Name: "byos_session", Value: ownerToken})
		getRec := httptest.NewRecorder()
		tourStateHandler(getRec, getReq)

		var state TourStateResponse
		_ = json.Unmarshal(getRec.Body.Bytes(), &state)
		cpTour, ok := state.Tours["control_plane_v1"]
		if !ok {
			t.Fatalf("expected control_plane_v1 tour in state")
		}
		if cpTour.SkippedAt == nil {
			t.Fatalf("expected skipped_at to be non-nil")
		}
		if cpTour.CompletedAt != nil {
			t.Fatalf("expected completed_at to be nil on skip")
		}
		if cpTour.LastStep != 2 {
			t.Fatalf("expected last_step 2, got %d", cpTour.LastStep)
		}
	}

	// 6. TestTourStateScopedToUser -> memberToken should still see empty tours
	{
		req := httptest.NewRequest(http.MethodGet, "/v1/tours/state", nil)
		req.AddCookie(&http.Cookie{Name: "byos_session", Value: memberToken})
		rec := httptest.NewRecorder()
		tourStateHandler(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d", rec.Code)
		}
		var state TourStateResponse
		_ = json.Unmarshal(rec.Body.Bytes(), &state)
		if len(state.Tours) != 0 {
			t.Fatalf("expected member user to have 0 tours, got %d", len(state.Tours))
		}
	}

	// 7. TestTourReset -> removes the tour entry
	{
		req := httptest.NewRequest(http.MethodPost, "/v1/tours/control_plane_v1/reset", nil)
		req.SetPathValue("tour_id", "control_plane_v1")
		req.AddCookie(&http.Cookie{Name: "byos_session", Value: ownerToken})
		rec := httptest.NewRecorder()
		tourResetHandler(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200, got %d (%s)", rec.Code, rec.Body.String())
		}

		// Verify control_plane_v1 is gone
		getReq := httptest.NewRequest(http.MethodGet, "/v1/tours/state", nil)
		getReq.AddCookie(&http.Cookie{Name: "byos_session", Value: ownerToken})
		getRec := httptest.NewRecorder()
		tourStateHandler(getRec, getReq)

		var state TourStateResponse
		_ = json.Unmarshal(getRec.Body.Bytes(), &state)
		if _, ok := state.Tours["control_plane_v1"]; ok {
			t.Fatalf("expected control_plane_v1 to be removed after reset")
		}
	}

	// 8. TestTourCompleteIdempotent -> repeated calls to /complete do not produce inconsistent state
	{
		for i := 0; i < 3; i++ {
			body := bytes.NewBufferString(`{"last_step": 7}`)
			req := httptest.NewRequest(http.MethodPost, "/v1/tours/control_plane_v1/complete", body)
			req.SetPathValue("tour_id", "control_plane_v1")
			req.AddCookie(&http.Cookie{Name: "byos_session", Value: ownerToken})
			rec := httptest.NewRecorder()
			tourCompleteHandler(rec, req)
			if rec.Code != http.StatusOK {
				t.Fatalf("call %d: expected 200, got %d (%s)", i, rec.Code, rec.Body.String())
			}
		}

		// Verify state via GET
		getReq := httptest.NewRequest(http.MethodGet, "/v1/tours/state", nil)
		getReq.AddCookie(&http.Cookie{Name: "byos_session", Value: ownerToken})
		getRec := httptest.NewRecorder()
		tourStateHandler(getRec, getReq)

		var state TourStateResponse
		_ = json.Unmarshal(getRec.Body.Bytes(), &state)
		cpTour, ok := state.Tours["control_plane_v1"]
		if !ok {
			t.Fatalf("expected control_plane_v1 in state after repeated complete calls")
		}
		if cpTour.CompletedAt == nil {
			t.Fatalf("expected completed_at non-nil")
		}
		if cpTour.SkippedAt != nil {
			t.Fatalf("expected skipped_at to remain nil")
		}
		if cpTour.LastStep != 7 {
			t.Fatalf("expected last_step 7, got %d", cpTour.LastStep)
		}
	}

	// 9. TestRetiredWebmailTourRejected -> 400 Bad Request
	{
		req := httptest.NewRequest(http.MethodPost, "/v1/tours/webmail_v1/complete", nil)
		req.SetPathValue("tour_id", "webmail_v1")
		req.AddCookie(&http.Cookie{Name: "byos_session", Value: ownerToken})
		rec := httptest.NewRecorder()
		tourCompleteHandler(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 for retired webmail_v1 tour ID, got %d", rec.Code)
		}
	}
}
