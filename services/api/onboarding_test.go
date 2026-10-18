package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
)

func TestOnboardingWizardEndpoints(t *testing.T) {
	os.Setenv("BYOS_DEV_MODE", "1")
	db := setupTestDB(t)
	defer db.Close()

	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
	token := createTestSession(t, db, ownerID)

	// Clean up created org at end of test
	defer func() {
		_, _ = db.Exec(`DELETE FROM account_invitations WHERE org_id=$1`, orgID)
		_, _ = db.Exec(`DELETE FROM mailbox_storage WHERE mailbox_id IN (SELECT id FROM mailboxes WHERE org_id=$1)`, orgID)
		_, _ = db.Exec(`DELETE FROM mailboxes WHERE org_id=$1`, orgID)
		_, _ = db.Exec(`DELETE FROM domains WHERE org_id=$1`, orgID)
		_, _ = db.Exec(`DELETE FROM storage_connections WHERE org_id=$1`, orgID)
		_, _ = db.Exec(`DELETE FROM sessions WHERE user_id=$1`, ownerID)
		_, _ = db.Exec(`DELETE FROM users WHERE org_id=$1`, orgID)
		_, _ = db.Exec(`DELETE FROM organizations WHERE id=$1`, orgID)
	}()

	// 1. Unauthenticated GET /v1/onboarding/state -> 401
	{
		req := httptest.NewRequest(http.MethodGet, "/v1/onboarding/state", nil)
		rec := httptest.NewRecorder()
		onboardingStateGetHandler(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401 unauthenticated, got %d", rec.Code)
		}
	}

	// 2. Authenticated GET /v1/onboarding/state -> 200 (initial step 1)
	{
		req := httptest.NewRequest(http.MethodGet, "/v1/onboarding/state", nil)
		req.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
		rec := httptest.NewRecorder()
		onboardingStateGetHandler(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 for state, got %d", rec.Code)
		}
		var state OnboardingStateResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &state); err != nil {
			t.Fatalf("failed to decode state json: %v", err)
		}
		if state.Organization.ID != orgID {
			t.Fatalf("expected org ID %s, got %s", orgID, state.Organization.ID)
		}
		if state.CurrentStep != 1 {
			t.Fatalf("expected step 1, got %d", state.CurrentStep)
		}
		if state.Completed {
			t.Fatalf("expected onboarding not completed initially")
		}
	}

	// 3. Step 1: POST /v1/onboarding/step/domain
	var domainID string
	{
		payload := []byte(`{"domain": "test-wizard.local"}`)
		req := httptest.NewRequest(http.MethodPost, "/v1/onboarding/step/domain", bytes.NewReader(payload))
		req.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
		rec := httptest.NewRecorder()
		onboardingStepDomainHandler(rec, req)
		if rec.Code != http.StatusCreated && rec.Code != http.StatusOK {
			t.Fatalf("expected 201 or 200 for domain creation, got %d (body: %s)", rec.Code, rec.Body.String())
		}
		var res map[string]interface{}
		_ = json.Unmarshal(rec.Body.Bytes(), &res)
		domainID = res["id"].(string)
		if res["name"] != "test-wizard.local" {
			t.Fatalf("expected domain name test-wizard.local, got %v", res["name"])
		}
	}

	// 4. Step 1 Verify: POST /v1/onboarding/step/domain/verify
	{
		payload, _ := json.Marshal(map[string]string{"domain_id": domainID})
		req := httptest.NewRequest(http.MethodPost, "/v1/onboarding/step/domain/verify", bytes.NewReader(payload))
		req.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
		rec := httptest.NewRecorder()
		onboardingStepDomainVerifyHandler(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 for domain verify, got %d (body: %s)", rec.Code, rec.Body.String())
		}
		var res map[string]interface{}
		_ = json.Unmarshal(rec.Body.Bytes(), &res)
		if res["status"] != "verified" {
			t.Fatalf("expected status verified, got %v", res["status"])
		}
		if res["verification_type"] != "development" {
			t.Fatalf("expected verification_type development for .local domain, got %v", res["verification_type"])
		}
	}

	// 5. Step 2: POST /v1/onboarding/step/storage (mode selection)
	{
		// Invalid mode -> 400
		badPayload := []byte(`{"storage_mode": "individual"}`)
		req := httptest.NewRequest(http.MethodPost, "/v1/onboarding/step/storage", bytes.NewReader(badPayload))
		req.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
		rec := httptest.NewRecorder()
		onboardingStepStorageHandler(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 for unsupported mode, got %d", rec.Code)
		}

		// Valid mode -> 200
		goodPayload := []byte(`{"storage_mode": "org_managed"}`)
		req = httptest.NewRequest(http.MethodPost, "/v1/onboarding/step/storage", bytes.NewReader(goodPayload))
		req.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
		rec = httptest.NewRecorder()
		onboardingStepStorageHandler(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 for org_managed mode, got %d", rec.Code)
		}
	}

	// Set up an active storage connection for Step 4+ assertions
	var storageConnID string
	err := db.QueryRow(`
		INSERT INTO storage_connections (org_id, provider_type, provider, bucket_name, credentials_enc, config, is_active, encrypted, status, last_checked)
		VALUES ($1, 'minio', 'minio', 'byos-mailbox', ''::bytea, '{"endpoint":"minio:9000"}'::jsonb, true, true, 'active', now())
		RETURNING id::text
	`, orgID).Scan(&storageConnID)
	if err != nil {
		t.Fatalf("failed to insert storage connection: %v", err)
	}
	_, _ = db.Exec(`UPDATE organizations SET default_storage_connection_id=$1, onboarding_current_step=4 WHERE id=$2`, storageConnID, orgID)

	// 6. Step 4: POST /v1/onboarding/step/mailboxes
	{
		payload := []byte(`{"mailboxes":[{"local_part":"owner","name":"Owner Mailbox"}]}`)
		req := httptest.NewRequest(http.MethodPost, "/v1/onboarding/step/mailboxes", bytes.NewReader(payload))
		req.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
		rec := httptest.NewRecorder()
		onboardingStepMailboxesHandler(rec, req)
		if rec.Code != http.StatusCreated && rec.Code != http.StatusOK {
			t.Fatalf("expected 201 for mailbox creation, got %d (body: %s)", rec.Code, rec.Body.String())
		}
	}

	// 7. Step 7 Matrix: GET /v1/onboarding/state/verify
	{
		req := httptest.NewRequest(http.MethodGet, "/v1/onboarding/state/verify", nil)
		req.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
		rec := httptest.NewRecorder()
		onboardingStateVerifyHandler(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 for verify matrix, got %d", rec.Code)
		}
		var mat VerificationMatrixResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &mat); err != nil {
			t.Fatalf("failed to decode verification matrix: %v", err)
		}
		if !mat.ReadyToComplete {
			t.Fatalf("expected ready_to_complete=true, got false")
		}
		// Assert that production infrastructure is honestly marked "not_tested"
		var prodDnsTested, prodCloudTested bool
		for _, c := range mat.Checks {
			if c.ID == "production_dns" && c.Status == "not_tested" {
				prodDnsTested = true
			}
			if c.ID == "cloud_storage_providers" && c.Status == "not_tested" {
				prodCloudTested = true
			}
		}
		if !prodDnsTested || !prodCloudTested {
			t.Fatalf("expected production_dns and cloud_storage_providers to be marked not_tested")
		}
	}

	// 8. Skip test: POST /v1/onboarding/skip
	{
		req := httptest.NewRequest(http.MethodPost, "/v1/onboarding/skip", nil)
		req.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
		rec := httptest.NewRecorder()
		onboardingSkipHandler(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 for skip, got %d", rec.Code)
		}
		var skipped bool
		_ = db.QueryRow(`SELECT onboarding_skipped FROM organizations WHERE id=$1`, orgID).Scan(&skipped)
		if !skipped {
			t.Fatalf("expected onboarding_skipped=true after skip")
		}
	}

	// 9. Completion: POST /v1/onboarding/complete
	// Must verify onboarding_skipped is reset to false!
	{
		req := httptest.NewRequest(http.MethodPost, "/v1/onboarding/complete", nil)
		req.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
		rec := httptest.NewRecorder()
		onboardingCompleteHandler(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("expected 200 for complete, got %d (body: %s)", rec.Code, rec.Body.String())
		}
		var res map[string]interface{}
		_ = json.Unmarshal(rec.Body.Bytes(), &res)
		if res["completed"] != true {
			t.Fatalf("expected completed=true, got %v", res["completed"])
		}
		if res["onboarding_skipped"] != false {
			t.Fatalf("expected onboarding_skipped=false in complete response, got %v", res["onboarding_skipped"])
		}

		// Verify in database directly
		var compAt *string
		var step int
		var skippedInDB bool
		err := db.QueryRow(`
			SELECT onboarding_completed_at::text, onboarding_current_step, onboarding_skipped
			FROM organizations WHERE id=$1`, orgID).Scan(&compAt, &step, &skippedInDB)
		if err != nil || compAt == nil || step != 7 || skippedInDB != false {
			t.Fatalf("expected fully completed org in DB, got compAt=%v, step=%d, skipped=%v", compAt, step, skippedInDB)
		}
	}
}
