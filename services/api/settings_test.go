package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func TestMailboxSettingsRoundtrip(t *testing.T) {
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
	mailboxID := uuid.New().String()
	domainID := uuid.New().String()

	_, err = conn.Exec(ctx, `INSERT INTO organizations (id, name, plan, org_recovery_pk) VALUES ($1, $2, 'business', decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'))`, orgID, "Settings Org")
	if err != nil {
		t.Fatalf("failed to insert org: %v", err)
	}
	defer conn.Exec(ctx, `DELETE FROM organizations WHERE id=$1`, orgID)

	domainName := "settings-" + uuid.New().String()[:8] + ".org"
	_, err = conn.Exec(ctx, `INSERT INTO domains (id, org_id, name, is_verified) VALUES ($1, $2, $3, true)`, domainID, orgID, domainName)
	if err != nil {
		t.Fatalf("failed to insert domain: %v", err)
	}

	pwHash, _ := hashPassword("password123456")
	email := "user-" + uuid.New().String()[:8] + "@" + domainName
	_, err = conn.Exec(ctx, `INSERT INTO users (id, org_id, email, password_hash, role, is_active) VALUES ($1, $2, $3, $4, 'member', true)`, userID, orgID, email, pwHash)
	if err != nil {
		t.Fatalf("failed to insert user: %v", err)
	}

	_, err = conn.Exec(ctx, `INSERT INTO mailboxes (id, org_id, user_id, domain_id, local_part, mode, status, is_active) VALUES ($1, $2, $3, $4, 'user', 'private', 'active', true)`, mailboxID, orgID, userID, domainID)
	if err != nil {
		t.Fatalf("failed to insert mailbox: %v", err)
	}

	token, hash := generateSessionToken()
	_, _ = conn.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day')`, userID, hash)

	// 1. GET settings before any row exists -> should return defaults
	req := httptest.NewRequest(http.MethodGet, "/v1/mailboxes/"+mailboxID+"/settings", nil)
	req.SetPathValue("mailbox_id", mailboxID)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()

	mailboxSettingsHandler(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for default settings, got %d: %s", w.Code, w.Body.String())
	}

	var defaults MailboxSettings
	if err := json.NewDecoder(w.Body).Decode(&defaults); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if defaults.Density != "cozy" || defaults.LayoutMode != "split" || defaults.Theme != "cloud_dancer" {
		t.Errorf("unexpected defaults: %+v", defaults)
	}

	// 2. PUT settings to update
	sigPlain := "Best regards,\nUser"
	sigHTML := "<p>Best regards,<br/>User</p>"
	density := "compact"
	layout := "full"
	theme := "dark"
	dispName := "User Name"
	insertSig := false

	updatePayload := map[string]interface{}{
		"display_name":              dispName,
		"signature_plain":           sigPlain,
		"signature_html":            sigHTML,
		"insert_signature_on_reply": insertSig,
		"density":                   density,
		"layout_mode":               layout,
		"theme":                     theme,
		"recovery_phrase_wrapped":   "wrappedhex123",
		"recovery_phrase_salt":      "salthex123",
	}
	bodyBytes, _ := json.Marshal(updatePayload)

	putReq := httptest.NewRequest(http.MethodPut, "/v1/mailboxes/"+mailboxID+"/settings", bytes.NewReader(bodyBytes))
	putReq.SetPathValue("mailbox_id", mailboxID)
	putReq.Header.Set("Authorization", "Bearer "+token)
	putW := httptest.NewRecorder()

	mailboxSettingsHandler(putW, putReq)
	if putW.Code != http.StatusOK {
		t.Fatalf("expected 200 on PUT settings, got %d: %s", putW.Code, putW.Body.String())
	}

	var updated MailboxSettings
	if err := json.NewDecoder(putW.Body).Decode(&updated); err != nil {
		t.Fatalf("failed to decode updated settings: %v", err)
	}
	if updated.DisplayName != dispName || updated.SignaturePlain != sigPlain || updated.Density != "compact" || updated.Theme != "dark" {
		t.Errorf("mismatch in updated settings: %+v", updated)
	}
	if updated.RecoveryPhraseWrapped != "wrappedhex123" || updated.RecoveryPhraseSalt != "salthex123" {
		t.Errorf("mismatch in recovery phrase wrap: %+v", updated)
	}

	// 3. Partial PUT: update only density -> verify theme, signature, layout are preserved
	partialDensityPayload, _ := json.Marshal(map[string]interface{}{
		"density": "comfortable",
	})
	partReq1 := httptest.NewRequest(http.MethodPut, "/v1/mailboxes/"+mailboxID+"/settings", bytes.NewReader(partialDensityPayload))
	partReq1.SetPathValue("mailbox_id", mailboxID)
	partReq1.Header.Set("Authorization", "Bearer "+token)
	partW1 := httptest.NewRecorder()

	mailboxSettingsHandler(partW1, partReq1)
	if partW1.Code != http.StatusOK {
		t.Fatalf("expected 200 on partial density PUT, got %d: %s", partW1.Code, partW1.Body.String())
	}
	var partUpdated1 MailboxSettings
	if err := json.NewDecoder(partW1.Body).Decode(&partUpdated1); err != nil {
		t.Fatalf("failed to decode: %v", err)
	}
	if partUpdated1.Density != "comfortable" {
		t.Errorf("expected density 'comfortable', got %q", partUpdated1.Density)
	}
	if partUpdated1.Theme != "dark" {
		t.Errorf("expected theme 'dark' to be preserved, got %q", partUpdated1.Theme)
	}
	if partUpdated1.LayoutMode != "full" {
		t.Errorf("expected layout 'full' to be preserved, got %q", partUpdated1.LayoutMode)
	}
	if partUpdated1.SignaturePlain != sigPlain {
		t.Errorf("expected signature to be preserved, got %q", partUpdated1.SignaturePlain)
	}

	// 4. Partial PUT: update only theme -> verify density and layout are preserved
	partialThemePayload, _ := json.Marshal(map[string]interface{}{
		"theme": "cloud_dancer",
	})
	partReq2 := httptest.NewRequest(http.MethodPut, "/v1/mailboxes/"+mailboxID+"/settings", bytes.NewReader(partialThemePayload))
	partReq2.SetPathValue("mailbox_id", mailboxID)
	partReq2.Header.Set("Authorization", "Bearer "+token)
	partW2 := httptest.NewRecorder()

	mailboxSettingsHandler(partW2, partReq2)
	if partW2.Code != http.StatusOK {
		t.Fatalf("expected 200 on partial theme PUT, got %d: %s", partW2.Code, partW2.Body.String())
	}
	var partUpdated2 MailboxSettings
	if err := json.NewDecoder(partW2.Body).Decode(&partUpdated2); err != nil {
		t.Fatalf("failed to decode: %v", err)
	}
	if partUpdated2.Theme != "cloud_dancer" {
		t.Errorf("expected theme 'cloud_dancer', got %q", partUpdated2.Theme)
	}
	if partUpdated2.Density != "comfortable" {
		t.Errorf("expected density 'comfortable' to be preserved, got %q", partUpdated2.Density)
	}
	if partUpdated2.LayoutMode != "full" {
		t.Errorf("expected layout 'full' to be preserved, got %q", partUpdated2.LayoutMode)
	}
}
