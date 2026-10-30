package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func calRequest(t *testing.T, method, mailboxID, calendarID, body, token string) *httptest.ResponseRecorder {
	t.Helper()
	url := "/v1/mailboxes/" + mailboxID + "/calendars"
	if calendarID != "" {
		url += "/" + calendarID
	}
	req := httptest.NewRequest(method, url, bytes.NewBufferString(body))
	req.SetPathValue("mailbox_id", mailboxID)
	if calendarID != "" {
		req.SetPathValue("calendar_id", calendarID)
	}
	if token != "" {
		req.AddCookie(&http.Cookie{Name: "byos_session", Value: token, Path: "/"})
	}
	w := httptest.NewRecorder()
	calendarsHandler(w, req)
	return w
}

func calEventRequest(t *testing.T, method, mailboxID, eventID, query, body, token string) *httptest.ResponseRecorder {
	t.Helper()
	url := "/v1/mailboxes/" + mailboxID + "/calendar-events"
	if eventID != "" {
		url += "/" + eventID
	}
	if query != "" {
		url += "?" + query
	}
	req := httptest.NewRequest(method, url, bytes.NewBufferString(body))
	req.SetPathValue("mailbox_id", mailboxID)
	if eventID != "" {
		req.SetPathValue("event_id", eventID)
	}
	if token != "" {
		req.AddCookie(&http.Cookie{Name: "byos_session", Value: token, Path: "/"})
	}
	w := httptest.NewRecorder()
	calendarEventsHandler(w, req)
	return w
}

func TestCalendarLifecycleAndIsolation(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	_, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, mustOrg(t, db, ownerID), ownerID, "calendaruser")
	token := createTestSession(t, db, ownerID)

	// 1. Initial GET calendars should auto-create default "Personal" calendar
	w := calRequest(t, http.MethodGet, mailboxID, "", "", token)
	if w.Code != http.StatusOK {
		t.Fatalf("get calendars: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var calendars []UserCalendar
	if err := json.NewDecoder(w.Body).Decode(&calendars); err != nil {
		t.Fatalf("decode calendars: %v", err)
	}
	if len(calendars) != 1 {
		t.Fatalf("expected 1 auto-created calendar, got %d", len(calendars))
	}
	if calendars[0].Name != "Personal" || !calendars[0].IsDefault {
		t.Fatalf("expected default Personal calendar, got %+v", calendars[0])
	}
	defaultCalID := calendars[0].ID

	// 2. Disallow deleting the only calendar
	w = calRequest(t, http.MethodDelete, mailboxID, defaultCalID, "", token)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("delete only calendar: expected 400, got %d: %s", w.Code, w.Body.String())
	}

	// 3. Create a second calendar "Work"
	w = calRequest(t, http.MethodPost, mailboxID, "", `{"name":"Work","color":"#3C3D3E","is_default":false}`, token)
	if w.Code != http.StatusCreated {
		t.Fatalf("create second calendar: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var workCal UserCalendar
	if err := json.NewDecoder(w.Body).Decode(&workCal); err != nil {
		t.Fatalf("decode workCal: %v", err)
	}
	if workCal.Name != "Work" || workCal.Color != "#3C3D3E" {
		t.Fatalf("unexpected work calendar: %+v", workCal)
	}

	// 4. Create an event in "Work" calendar
	now := time.Now().UTC()
	startStr := now.Add(1 * time.Hour).Format(time.RFC3339)
	endStr := now.Add(2 * time.Hour).Format(time.RFC3339)
	// Valid Section 12 AES-GCM envelope: version(0x01) || nonce(12) || ciphertext+tag(16)
	validEnvelope := make([]byte, 29)
	validEnvelope[0] = 0x01
	for i := 1; i <= 12; i++ {
		validEnvelope[i] = byte(i)
	}
	for i := 13; i < 29; i++ {
		validEnvelope[i] = 0xAA
	}
	payloadB64 := base64.StdEncoding.EncodeToString(validEnvelope)

	createEventJSON := fmt.Sprintf(`{
		"calendar_id": "%s",
		"start_time": "%s",
		"end_time": "%s",
		"is_all_day": false,
		"status": "busy",
		"encrypted_payload": "%s"
	}`, workCal.ID, startStr, endStr, payloadB64)

	w = calEventRequest(t, http.MethodPost, mailboxID, "", "", createEventJSON, token)
	if w.Code != http.StatusCreated {
		t.Fatalf("create event: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var createdEvent CalendarEvent
	if err := json.NewDecoder(w.Body).Decode(&createdEvent); err != nil {
		t.Fatalf("decode event: %v", err)
	}
	if createdEvent.CalendarID != workCal.ID || createdEvent.EncryptedPayload != payloadB64 {
		t.Fatalf("unexpected created event: %+v", createdEvent)
	}

	// 5. Query events within window
	queryWindow := fmt.Sprintf("start=%s&end=%s",
		now.Format(time.RFC3339),
		now.Add(3*time.Hour).Format(time.RFC3339))
	w = calEventRequest(t, http.MethodGet, mailboxID, "", queryWindow, "", token)
	if w.Code != http.StatusOK {
		t.Fatalf("query events: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var events []CalendarEvent
	if err := json.NewDecoder(w.Body).Decode(&events); err != nil {
		t.Fatalf("decode events: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("expected 1 event in window, got %d", len(events))
	}
	if events[0].ID != createdEvent.ID {
		t.Fatalf("expected event %s, got %s", createdEvent.ID, events[0].ID)
	}

	// 6. Update event
	newEndStr := now.Add(3 * time.Hour).Format(time.RFC3339)
	updateJSON := fmt.Sprintf(`{"end_time":"%s"}`, newEndStr)
	w = calEventRequest(t, http.MethodPatch, mailboxID, createdEvent.ID, "", updateJSON, token)
	if w.Code != http.StatusOK {
		t.Fatalf("update event: expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// 7. Reject invalid event timing (end < start)
	badEventJSON := fmt.Sprintf(`{
		"calendar_id": "%s",
		"start_time": "%s",
		"end_time": "%s",
		"encrypted_payload": "%s"
	}`, workCal.ID, endStr, startStr, payloadB64)
	w = calEventRequest(t, http.MethodPost, mailboxID, "", "", badEventJSON, token)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("bad timing event: expected 400, got %d", w.Code)
	}

	// 8. User B (different org) cannot access User A's calendar or events
	_, userB_ID, _, _ := createTestOrgAndUsers(t, db)
	_, userB_Mailbox := createTestMailbox(t, db, mustOrg(t, db, userB_ID), userB_ID, "userb")
	tokenB := createTestSession(t, db, userB_ID)

	w = calRequest(t, http.MethodGet, mailboxID, "", "", tokenB)
	if w.Code != http.StatusForbidden {
		t.Fatalf("unauthorized cal access: expected 403, got %d", w.Code)
	}

	w = calEventRequest(t, http.MethodGet, mailboxID, createdEvent.ID, "", "", tokenB)
	if w.Code != http.StatusForbidden {
		t.Fatalf("unauthorized event access: expected 403, got %d", w.Code)
	}

	// 9. Delete event
	w = calEventRequest(t, http.MethodDelete, mailboxID, createdEvent.ID, "", "", token)
	if w.Code != http.StatusNoContent {
		t.Fatalf("delete event: expected 204, got %d", w.Code)
	}

	_ = userB_Mailbox
}

func TestCalendarEventAPIEnvelopeSecurity(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	ctx := context.Background()
	_, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, mustOrg(t, db, ownerID), ownerID, "cal-sec-user")
	token := createTestSession(t, db, ownerID)

	// Auto-create personal calendar
	w := calRequest(t, http.MethodGet, mailboxID, "", "", token)
	if w.Code != http.StatusOK {
		t.Fatalf("get calendars: expected 200, got %d", w.Code)
	}
	var calendars []UserCalendar
	if err := json.NewDecoder(w.Body).Decode(&calendars); err != nil || len(calendars) == 0 {
		t.Fatalf("failed to decode initial calendar: %v", err)
	}
	calID := calendars[0].ID

	countEvents := func() int {
		var count int
		err := db.QueryRowContext(ctx, `SELECT count(*) FROM calendar_events WHERE mailbox_id=$1`, mailboxID).Scan(&count)
		if err != nil {
			t.Fatalf("failed to count events: %v", err)
		}
		return count
	}

	initialCount := countEvents()
	if initialCount != 0 {
		t.Fatalf("expected initial event count to be 0, got %d", initialCount)
	}

	now := time.Now().UTC()
	startStr := now.Add(1 * time.Hour).Format(time.RFC3339)
	endStr := now.Add(2 * time.Hour).Format(time.RFC3339)

	// Helper to send create event request
	sendCreate := func(payloadStr string) *httptest.ResponseRecorder {
		body := fmt.Sprintf(`{
			"calendar_id": "%s",
			"start_time": "%s",
			"end_time": "%s",
			"is_all_day": false,
			"status": "busy",
			"encrypted_payload": %s
		}`, calID, startStr, endStr, payloadStr)
		return calEventRequest(t, http.MethodPost, mailboxID, "", "", body, token)
	}

	// 1. Plaintext JSON encoded as Base64 rejected
	plaintextB64 := base64.StdEncoding.EncodeToString([]byte(`{"title":"Insecure Plaintext Event","location":"Cleartext"}`))
	w = sendCreate(fmt.Sprintf(`"%s"`, plaintextB64))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("create with Base64 plaintext JSON: expected 400, got %d: %s", w.Code, w.Body.String())
	}
	if countEvents() != initialCount {
		t.Fatalf("database write occurred for Base64 plaintext JSON payload")
	}

	// 2. Raw JSON rejected
	w = sendCreate(`"{\"title\":\"Raw JSON\"}"`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("create with raw JSON in string: expected 400, got %d: %s", w.Code, w.Body.String())
	}
	if countEvents() != initialCount {
		t.Fatalf("database write occurred for raw JSON payload")
	}

	// 3. Empty payload rejected
	w = sendCreate(`""`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("create with empty payload: expected 400, got %d: %s", w.Code, w.Body.String())
	}
	if countEvents() != initialCount {
		t.Fatalf("database write occurred for empty payload")
	}

	// 4. Invalid Base64 rejected
	w = sendCreate(`"not-valid-base64-&&&%%%"`)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("create with invalid base64: expected 400, got %d: %s", w.Code, w.Body.String())
	}
	if countEvents() != initialCount {
		t.Fatalf("database write occurred for invalid base64 payload")
	}

	// 5. Payload shorter than minimum rejected (15 bytes)
	shortBytes := make([]byte, 15)
	shortBytes[0] = 0x01
	w = sendCreate(fmt.Sprintf(`"%s"`, base64.StdEncoding.EncodeToString(shortBytes)))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("create with short payload (15 bytes): expected 400, got %d: %s", w.Code, w.Body.String())
	}
	if countEvents() != initialCount {
		t.Fatalf("database write occurred for short payload")
	}

	// 6. Payload 28 bytes (1 byte short of 29) rejected
	boundary28 := make([]byte, 28)
	boundary28[0] = 0x01
	w = sendCreate(fmt.Sprintf(`"%s"`, base64.StdEncoding.EncodeToString(boundary28)))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("create with 28-byte payload: expected 400, got %d: %s", w.Code, w.Body.String())
	}
	if countEvents() != initialCount {
		t.Fatalf("database write occurred for 28-byte payload")
	}

	// 7. Incorrect version byte rejected (version 0x02, length 30 bytes)
	wrongVerBytes := make([]byte, 30)
	wrongVerBytes[0] = 0x02
	w = sendCreate(fmt.Sprintf(`"%s"`, base64.StdEncoding.EncodeToString(wrongVerBytes)))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("create with wrong version byte (0x02): expected 400, got %d: %s", w.Code, w.Body.String())
	}
	if countEvents() != initialCount {
		t.Fatalf("database write occurred for wrong version payload")
	}

	// 8. Truncated nonce rejected (version 0x01, only 6 bytes of nonce, total 7 bytes)
	truncNonce := make([]byte, 7)
	truncNonce[0] = 0x01
	w = sendCreate(fmt.Sprintf(`"%s"`, base64.StdEncoding.EncodeToString(truncNonce)))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("create with truncated nonce: expected 400, got %d: %s", w.Code, w.Body.String())
	}
	if countEvents() != initialCount {
		t.Fatalf("database write occurred for truncated nonce payload")
	}

	// 9. Truncated authentication tag rejected (version 0x01, 12 nonce bytes, 8 tag bytes, total 21 bytes < 29)
	truncTag := make([]byte, 21)
	truncTag[0] = 0x01
	w = sendCreate(fmt.Sprintf(`"%s"`, base64.StdEncoding.EncodeToString(truncTag)))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("create with truncated auth tag: expected 400, got %d: %s", w.Code, w.Body.String())
	}
	if countEvents() != initialCount {
		t.Fatalf("database write occurred for truncated auth tag payload")
	}

	// 10. Valid encrypted-envelope structure accepted (minimum 29 bytes: 1 ver + 12 nonce + 16 tag)
	validMinEnvelope := make([]byte, 29)
	validMinEnvelope[0] = 0x01
	for i := 1; i <= 12; i++ {
		validMinEnvelope[i] = byte(i)
	}
	for i := 13; i < 29; i++ {
		validMinEnvelope[i] = 0xBB
	}
	validMinB64 := base64.StdEncoding.EncodeToString(validMinEnvelope)
	w = sendCreate(fmt.Sprintf(`"%s"`, validMinB64))
	if w.Code != http.StatusCreated {
		t.Fatalf("create with valid 29-byte envelope: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	if countEvents() != initialCount+1 {
		t.Fatalf("expected event count %d, got %d", initialCount+1, countEvents())
	}
	var createdEv CalendarEvent
	if err := json.NewDecoder(w.Body).Decode(&createdEv); err != nil {
		t.Fatalf("decode created event: %v", err)
	}
	if createdEv.EncryptedPayload != validMinB64 {
		t.Fatalf("expected payload %s, got %s", validMinB64, createdEv.EncryptedPayload)
	}

	// 11. Valid encrypted-envelope structure with ciphertext (e.g. 55 bytes)
	validCipherEnvelope := make([]byte, 55)
	validCipherEnvelope[0] = 0x01
	for i := 1; i <= 12; i++ {
		validCipherEnvelope[i] = byte(i * 2)
	}
	for i := 13; i < 55; i++ {
		validCipherEnvelope[i] = 0xCC
	}
	validCipherB64 := base64.StdEncoding.EncodeToString(validCipherEnvelope)
	w = sendCreate(fmt.Sprintf(`"%s"`, validCipherB64))
	if w.Code != http.StatusCreated {
		t.Fatalf("create with valid 55-byte envelope: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	if countEvents() != initialCount+2 {
		t.Fatalf("expected event count %d, got %d", initialCount+2, countEvents())
	}

	// 12. Update endpoint (PATCH and PUT) rejects the same invalid payloads
	invalidPayloads := []struct {
		name string
		val  string
	}{
		{"Base64 plaintext JSON", plaintextB64},
		{"Raw JSON", "{\"title\":\"Bad\"}"},
		{"Empty string", ""},
		{"Invalid Base64", "not-valid-base64-&&&"},
		{"Short (15 bytes)", base64.StdEncoding.EncodeToString(shortBytes)},
		{"Boundary (28 bytes)", base64.StdEncoding.EncodeToString(boundary28)},
		{"Wrong version (0x02)", base64.StdEncoding.EncodeToString(wrongVerBytes)},
		{"Truncated nonce (7 bytes)", base64.StdEncoding.EncodeToString(truncNonce)},
		{"Truncated tag (21 bytes)", base64.StdEncoding.EncodeToString(truncTag)},
	}

	for _, tc := range invalidPayloads {
		// PATCH
		patchBody := fmt.Sprintf(`{"encrypted_payload": "%s"}`, tc.val)
		w = calEventRequest(t, http.MethodPatch, mailboxID, createdEv.ID, "", patchBody, token)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("PATCH with %s: expected 400, got %d: %s", tc.name, w.Code, w.Body.String())
		}

		// PUT
		w = calEventRequest(t, http.MethodPut, mailboxID, createdEv.ID, "", patchBody, token)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("PUT with %s: expected 400, got %d: %s", tc.name, w.Code, w.Body.String())
		}

		// Verify database payload was NOT modified
		var dbPayload []byte
		err := db.QueryRowContext(ctx, `SELECT encrypted_payload FROM calendar_events WHERE id=$1`, createdEv.ID).Scan(&dbPayload)
		if err != nil {
			t.Fatalf("failed to query event payload: %v", err)
		}
		if base64.StdEncoding.EncodeToString(dbPayload) != validMinB64 {
			t.Fatalf("database payload was modified after invalid %s update", tc.name)
		}
	}

	// 13. Update endpoint accepts valid new envelope
	updatedEnvelope := make([]byte, 40)
	updatedEnvelope[0] = 0x01
	for i := 1; i < 40; i++ {
		updatedEnvelope[i] = 0xDD
	}
	updatedB64 := base64.StdEncoding.EncodeToString(updatedEnvelope)
	patchValidBody := fmt.Sprintf(`{"encrypted_payload": "%s"}`, updatedB64)
	w = calEventRequest(t, http.MethodPatch, mailboxID, createdEv.ID, "", patchValidBody, token)
	if w.Code != http.StatusOK {
		t.Fatalf("PATCH with valid envelope: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var dbUpdatedPayload []byte
	err := db.QueryRowContext(ctx, `SELECT encrypted_payload FROM calendar_events WHERE id=$1`, createdEv.ID).Scan(&dbUpdatedPayload)
	if err != nil {
		t.Fatalf("failed to query updated event: %v", err)
	}
	if base64.StdEncoding.EncodeToString(dbUpdatedPayload) != updatedB64 {
		t.Fatalf("database payload was not updated to valid envelope")
	}

	// 14. Update metadata without sending encrypted_payload keeps existing payload
	metaUpdateBody := `{"status": "tentative"}`
	w = calEventRequest(t, http.MethodPatch, mailboxID, createdEv.ID, "", metaUpdateBody, token)
	if w.Code != http.StatusOK {
		t.Fatalf("PATCH without encrypted_payload: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var currentStatus string
	var currentPayload []byte
	err = db.QueryRowContext(ctx, `SELECT status, encrypted_payload FROM calendar_events WHERE id=$1`, createdEv.ID).Scan(&currentStatus, &currentPayload)
	if err != nil || currentStatus != "tentative" || base64.StdEncoding.EncodeToString(currentPayload) != updatedB64 {
		t.Fatalf("unexpected state after metadata update: status=%s, payloadMatch=%v", currentStatus, base64.StdEncoding.EncodeToString(currentPayload) == updatedB64)
	}

	// 15. GET retrieval returns exact base64 payload
	w = calEventRequest(t, http.MethodGet, mailboxID, createdEv.ID, "", "", token)
	if w.Code != http.StatusOK {
		t.Fatalf("GET event: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var retrievedEv CalendarEvent
	if err := json.NewDecoder(w.Body).Decode(&retrievedEv); err != nil {
		t.Fatalf("decode retrieved event: %v", err)
	}
	if retrievedEv.EncryptedPayload != updatedB64 {
		t.Fatalf("expected retrieved payload %s, got %s", updatedB64, retrievedEv.EncryptedPayload)
	}
}

func calMigrationRequest(t *testing.T, action, mailboxID, eventID, ifMatch, body, token string) *httptest.ResponseRecorder {
	t.Helper()
	var method string
	var path string
	switch action {
	case "stage":
		method = http.MethodPost
		path = fmt.Sprintf("/v1/mailboxes/%s/calendar-events/%s/stage-migration", mailboxID, eventID)
	case "finalize":
		method = http.MethodPost
		path = fmt.Sprintf("/v1/mailboxes/%s/calendar-events/%s/finalize-migration", mailboxID, eventID)
	case "rollback":
		method = http.MethodPost
		path = fmt.Sprintf("/v1/mailboxes/%s/calendar-events/%s/rollback-migration", mailboxID, eventID)
	case "status":
		method = http.MethodGet
		path = fmt.Sprintf("/v1/mailboxes/%s/calendar-events/%s/migration-status", mailboxID, eventID)
	default:
		t.Fatalf("unknown migration action: %s", action)
	}

	req := httptest.NewRequest(method, path, bytes.NewBufferString(body))
	req.SetPathValue("mailbox_id", mailboxID)
	req.SetPathValue("event_id", eventID)
	if ifMatch != "" {
		req.Header.Set("If-Match", ifMatch)
	}
	if token != "" {
		req.AddCookie(&http.Cookie{Name: "byos_session", Value: token, Path: "/"})
	}
	w := httptest.NewRecorder()
	switch action {
	case "stage":
		calendarEventStageMigrationHandler(w, req)
	case "finalize":
		calendarEventFinalizeMigrationHandler(w, req)
	case "rollback":
		calendarEventRollbackMigrationHandler(w, req)
	case "status":
		calendarEventMigrationStatusHandler(w, req)
	}
	return w
}

func TestCalendarLegacyRecoveryLifecycle(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	ctx := context.Background()

	_, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, mustOrg(t, db, ownerID), ownerID, "recoveryuser")
	token := createTestSession(t, db, ownerID)

	// Ensure default calendar exists
	w := calRequest(t, http.MethodGet, mailboxID, "", "", token)
	if w.Code != http.StatusOK {
		t.Fatalf("get calendars: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var calendars []UserCalendar
	if err := json.NewDecoder(w.Body).Decode(&calendars); err != nil || len(calendars) == 0 {
		t.Fatalf("failed to decode default calendar: %v", err)
	}
	calendarID := calendars[0].ID

	// Helper to create a legacy unencrypted event directly in database
	createLegacyEvent := func(title, desc string) string {
		var eventID string
		legacyJSON := fmt.Sprintf(`{"title":"%s","description":"%s","location":"Office 101"}`, title, desc)
		err := db.QueryRowContext(ctx, `
			INSERT INTO calendar_events (mailbox_id, calendar_id, start_time, end_time, is_all_day, status, encrypted_payload)
			VALUES ($1, $2, now(), now() + interval '1 hour', false, 'busy', $3)
			RETURNING id
		`, mailboxID, calendarID, []byte(legacyJSON)).Scan(&eventID)
		if err != nil {
			t.Fatalf("failed to seed legacy event: %v", err)
		}
		return eventID
	}

	// Valid Section 12 AES-GCM envelope fixture (version 0x01 + 12-byte nonce + 16-byte tag)
	validEnvelope := make([]byte, 1+12+16)
	validEnvelope[0] = 0x01
	for i := 1; i < len(validEnvelope); i++ {
		validEnvelope[i] = byte(i)
	}
	validEnvelopeB64 := base64.StdEncoding.EncodeToString(validEnvelope)

	createNonLegacyEvent := func(payloadB64 string) string {
		var eventID string
		decoded, err := base64.StdEncoding.DecodeString(payloadB64)
		if err != nil {
			t.Fatalf("decode b64: %v", err)
		}
		err = db.QueryRowContext(ctx, `
			INSERT INTO calendar_events (mailbox_id, calendar_id, start_time, end_time, is_all_day, status, encrypted_payload)
			VALUES ($1, $2, now(), now() + interval '1 hour', false, 'busy', $3)
			RETURNING id
		`, mailboxID, calendarID, decoded).Scan(&eventID)
		if err != nil {
			t.Fatalf("failed to seed non-legacy event: %v", err)
		}
		return eventID
	}

	// 1. ETag Format & RFC 9110 Strong ETag Determinism
	t.Run("ETag computation determinism", func(t *testing.T) {
		eventID := createLegacyEvent("ETag Test Event", "Initial description")
		w := calEventRequest(t, http.MethodGet, mailboxID, eventID, "", "", token)
		if w.Code != http.StatusOK {
			t.Fatalf("get event: expected 200, got %d", w.Code)
		}
		etag1 := w.Header().Get("ETag")
		if len(etag1) < 10 || etag1[0] != '"' || etag1[len(etag1)-1] != '"' {
			t.Fatalf("invalid ETag format: %s", etag1)
		}

		// Second GET without changes must produce identical ETag
		w2 := calEventRequest(t, http.MethodGet, mailboxID, eventID, "", "", token)
		if w2.Header().Get("ETag") != etag1 {
			t.Fatalf("expected identical ETag %s, got %s", etag1, w2.Header().Get("ETag"))
		}

		// Mutating status directly must change ETag deterministically
		_, err := db.ExecContext(ctx, `UPDATE calendar_events SET status = 'tentative' WHERE id = $1`, eventID)
		if err != nil {
			t.Fatalf("update status: %v", err)
		}
		w3 := calEventRequest(t, http.MethodGet, mailboxID, eventID, "", "", token)
		etag2 := w3.Header().Get("ETag")
		if etag2 == etag1 {
			t.Fatalf("ETag did not change after status update: %s", etag2)
		}
	})

	// 2. Stage Migration Preconditions and Validation
	t.Run("Stage migration input and precondition enforcement", func(t *testing.T) {
		eventID := createLegacyEvent("Precondition Event", "Testing error conditions")
		w := calEventRequest(t, http.MethodGet, mailboxID, eventID, "", "", token)
		correctETag := w.Header().Get("ETag")

		// 2a. Missing If-Match returns 428 Precondition Required
		w = calMigrationRequest(t, "stage", mailboxID, eventID, "", fmt.Sprintf(`{"staged_encrypted_payload":"%s"}`, validEnvelopeB64), token)
		if w.Code != http.StatusPreconditionRequired {
			t.Fatalf("expected 428 for missing If-Match, got %d: %s", w.Code, w.Body.String())
		}

		// 2b. Weak ETag returns 400 Bad Request
		w = calMigrationRequest(t, "stage", mailboxID, eventID, "W/"+correctETag, fmt.Sprintf(`{"staged_encrypted_payload":"%s"}`, validEnvelopeB64), token)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 for weak ETag, got %d: %s", w.Code, w.Body.String())
		}

		// 2c. Mismatched / Stale If-Match returns 412 Precondition Failed
		staleETag := fmt.Sprintf("\"%064x\"", 12345)
		w = calMigrationRequest(t, "stage", mailboxID, eventID, staleETag, fmt.Sprintf(`{"staged_encrypted_payload":"%s"}`, validEnvelopeB64), token)
		if w.Code != http.StatusPreconditionFailed {
			t.Fatalf("expected 412 for stale If-Match, got %d: %s", w.Code, w.Body.String())
		}

		// 2d. Invalid envelope in staged payload returns 400 Bad Request
		w = calMigrationRequest(t, "stage", mailboxID, eventID, correctETag, `{"staged_encrypted_payload":"bm90X2FuX2VudmVsb3Bl"}`, token)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 for invalid envelope, got %d: %s", w.Code, w.Body.String())
		}

		// 2e. Non-legacy payload event rejected from staging
		nonLegacyEventID := createNonLegacyEvent(validEnvelopeB64)
		w = calEventRequest(t, http.MethodGet, mailboxID, nonLegacyEventID, "", "", token)
		nonLegacyETag := w.Header().Get("ETag")
		w = calMigrationRequest(t, "stage", mailboxID, nonLegacyEventID, nonLegacyETag, fmt.Sprintf(`{"staged_encrypted_payload":"%s"}`, validEnvelopeB64), token)
		if w.Code != http.StatusBadRequest {
			t.Fatalf("expected 400 when staging non-legacy event, got %d: %s", w.Code, w.Body.String())
		}
	})

	// 3. Complete Successful Stage -> Finalize Flow
	t.Run("Stage and Finalize successful lifecycle", func(t *testing.T) {
		eventID := createLegacyEvent("Lifecycle Event", "Full happy path test")
		w := calEventRequest(t, http.MethodGet, mailboxID, eventID, "", "", token)
		originalETag := w.Header().Get("ETag")

		// Stage migration
		stageBody := fmt.Sprintf(`{"staged_encrypted_payload":"%s"}`, validEnvelopeB64)
		w = calMigrationRequest(t, "stage", mailboxID, eventID, originalETag, stageBody, token)
		if w.Code != http.StatusOK {
			t.Fatalf("stage migration: expected 200, got %d: %s", w.Code, w.Body.String())
		}
		var stageRes struct {
			Status      string `json:"status"`
			MigrationID string `json:"migration_id"`
			ExpiresAt   string `json:"expires_at"`
		}
		if err := json.NewDecoder(w.Body).Decode(&stageRes); err != nil {
			t.Fatalf("decode stage response: %v", err)
		}
		if stageRes.Status != "staged" || stageRes.MigrationID == "" {
			t.Fatalf("unexpected stage response: %+v", stageRes)
		}

		// Verify calendar_events payload is now the staged ciphertext
		var dbPayload []byte
		err := db.QueryRowContext(ctx, `SELECT encrypted_payload FROM calendar_events WHERE id = $1`, eventID).Scan(&dbPayload)
		if err != nil || base64.StdEncoding.EncodeToString(dbPayload) != validEnvelopeB64 {
			t.Fatalf("calendar_events payload was not updated to staged envelope")
		}

		// 3a. Verify write protection during active migration:
		// Concurrent stage attempt returns 409
		w = calMigrationRequest(t, "stage", mailboxID, eventID, originalETag, stageBody, token)
		if w.Code != http.StatusConflict {
			t.Fatalf("expected 409 for concurrent stage, got %d: %s", w.Code, w.Body.String())
		}

		// Concurrent PATCH event returns 409
		w = calEventRequest(t, http.MethodPatch, mailboxID, eventID, "", `{"status":"tentative"}`, token)
		if w.Code != http.StatusConflict {
			t.Fatalf("expected 409 for PATCH during active migration, got %d: %s", w.Code, w.Body.String())
		}

		// DELETE event returns 409
		w = calEventRequest(t, http.MethodDelete, mailboxID, eventID, "", "", token)
		if w.Code != http.StatusConflict {
			t.Fatalf("expected 409 for DELETE during active migration, got %d: %s", w.Code, w.Body.String())
		}

		// DELETE parent calendar returns 409
		w = calRequest(t, http.MethodDelete, mailboxID, calendarID, "", token)
		if w.Code != http.StatusConflict {
			t.Fatalf("expected 409 for DELETE calendar during active migration, got %d: %s", w.Code, w.Body.String())
		}

		// Finalize migration
		finBody := fmt.Sprintf(`{"migration_id":"%s"}`, stageRes.MigrationID)
		w = calMigrationRequest(t, "finalize", mailboxID, eventID, "", finBody, token)
		if w.Code != http.StatusOK {
			t.Fatalf("finalize migration: expected 200, got %d: %s", w.Code, w.Body.String())
		}

		// Verify legacy_payload is set to NULL on finalization
		var migStatus string
		var legacyPayload []byte
		err = db.QueryRowContext(ctx, `SELECT status, legacy_payload FROM calendar_event_migrations WHERE id = $1`, stageRes.MigrationID).Scan(&migStatus, &legacyPayload)
		if err != nil || migStatus != "finalized" || legacyPayload != nil {
			t.Fatalf("expected finalized status and NULL legacy_payload: status=%s, payload=%v", migStatus, legacyPayload)
		}

		// Idempotent finalize call returns 200
		w = calMigrationRequest(t, "finalize", mailboxID, eventID, "", finBody, token)
		if w.Code != http.StatusOK {
			t.Fatalf("expected idempotent 200 on repeat finalize, got %d: %s", w.Code, w.Body.String())
		}
	})

	// 4. Rollback Lifecycle
	t.Run("Rollback restores legacy payload", func(t *testing.T) {
		eventID := createLegacyEvent("Rollback Event", "Will be rolled back")
		w := calEventRequest(t, http.MethodGet, mailboxID, eventID, "", "", token)
		etag := w.Header().Get("ETag")

		// Stage
		w = calMigrationRequest(t, "stage", mailboxID, eventID, etag, fmt.Sprintf(`{"staged_encrypted_payload":"%s"}`, validEnvelopeB64), token)
		if w.Code != http.StatusOK {
			t.Fatalf("stage failed: %d", w.Code)
		}
		var stageRes struct {
			MigrationID string `json:"migration_id"`
		}
		json.NewDecoder(w.Body).Decode(&stageRes)

		// Rollback
		rollBody := fmt.Sprintf(`{"migration_id":"%s","reason":"test_verification_failure"}`, stageRes.MigrationID)
		w = calMigrationRequest(t, "rollback", mailboxID, eventID, "", rollBody, token)
		if w.Code != http.StatusOK {
			t.Fatalf("rollback: expected 200, got %d: %s", w.Code, w.Body.String())
		}

		// Verify legacy payload restored in calendar_events
		var restoredPayload []byte
		err := db.QueryRowContext(ctx, `SELECT encrypted_payload FROM calendar_events WHERE id = $1`, eventID).Scan(&restoredPayload)
		if err != nil || !strings.Contains(string(restoredPayload), "Will be rolled back") {
			t.Fatalf("expected legacy payload restored in calendar_events, got %s", string(restoredPayload))
		}

		// Finalizing a rolled-back migration must return 409
		w = calMigrationRequest(t, "finalize", mailboxID, eventID, "", fmt.Sprintf(`{"migration_id":"%s"}`, stageRes.MigrationID), token)
		if w.Code != http.StatusConflict {
			t.Fatalf("expected 409 finalizing rolled-back migration, got %d: %s", w.Code, w.Body.String())
		}
	})

	// 5. Opportunistic Expiration Recovery
	t.Run("Opportunistic expiration recovery on read", func(t *testing.T) {
		eventID := createLegacyEvent("Expiry Event", "Will expire")
		w := calEventRequest(t, http.MethodGet, mailboxID, eventID, "", "", token)
		etag := w.Header().Get("ETag")

		w = calMigrationRequest(t, "stage", mailboxID, eventID, etag, fmt.Sprintf(`{"staged_encrypted_payload":"%s"}`, validEnvelopeB64), token)
		if w.Code != http.StatusOK {
			t.Fatalf("stage failed: %d", w.Code)
		}
		var stageRes struct {
			MigrationID string `json:"migration_id"`
		}
		json.NewDecoder(w.Body).Decode(&stageRes)

		// Force expiry by setting expires_at in past
		_, err := db.ExecContext(ctx, `UPDATE calendar_event_migrations SET expires_at = now() - interval '5 minutes' WHERE id = $1`, stageRes.MigrationID)
		if err != nil {
			t.Fatalf("force expiry: %v", err)
		}

		// Calling GET on event must opportunistically roll it back
		w = calEventRequest(t, http.MethodGet, mailboxID, eventID, "", "", token)
		if w.Code != http.StatusOK {
			t.Fatalf("get after expiry: %d", w.Code)
		}

		// Verify migration record status is rolled_back with reason ttl_expired_opportunistic
		var migStatus, rollbackReason string
		err = db.QueryRowContext(ctx, `SELECT status, rollback_reason FROM calendar_event_migrations WHERE id = $1`, stageRes.MigrationID).Scan(&migStatus, &rollbackReason)
		if err != nil || migStatus != "rolled_back" || rollbackReason != "ttl_expired_opportunistic" {
			t.Fatalf("expected opportunistic rollback: status=%s, reason=%s", migStatus, rollbackReason)
		}
	})

	// 6. Backup Restoration Reconciliation
	t.Run("ReconcileRestoredMigrations recovers expired restored migrations", func(t *testing.T) {
		eventID := createLegacyEvent("Backup Restore Event", "Stuck in staged status")
		w := calEventRequest(t, http.MethodGet, mailboxID, eventID, "", "", token)
		etag := w.Header().Get("ETag")

		w = calMigrationRequest(t, "stage", mailboxID, eventID, etag, fmt.Sprintf(`{"staged_encrypted_payload":"%s"}`, validEnvelopeB64), token)
		if w.Code != http.StatusOK {
			t.Fatalf("stage failed: %d", w.Code)
		}
		var stageRes struct {
			MigrationID string `json:"migration_id"`
		}
		json.NewDecoder(w.Body).Decode(&stageRes)

		// Force expiry
		_, err := db.ExecContext(ctx, `UPDATE calendar_event_migrations SET expires_at = now() - interval '1 hour' WHERE id = $1`, stageRes.MigrationID)
		if err != nil {
			t.Fatalf("force expiry: %v", err)
		}

		// Execute backup restoration reconciliation
		conn, err := pgx.Connect(ctx, getValidatedTestDSN(t))
		if err != nil {
			t.Fatalf("connect pgx: %v", err)
		}
		defer conn.Close(ctx)

		reconciledCount, err := ReconcileRestoredMigrations(ctx, conn)
		if err != nil {
			t.Fatalf("ReconcileRestoredMigrations failed: %v", err)
		}
		if reconciledCount < 1 {
			t.Fatalf("expected at least 1 reconciled migration, got %d", reconciledCount)
		}

		// Verify status and restoration
		var status, reason string
		err = db.QueryRowContext(ctx, `SELECT status, rollback_reason FROM calendar_event_migrations WHERE id = $1`, stageRes.MigrationID).Scan(&status, &reason)
		if err != nil || status != "rolled_back" || reason != "backup_restoration_reconciliation" {
			t.Fatalf("expected backup_restoration_reconciliation: status=%s, reason=%s", status, reason)
		}
	})
}

func TestCalendarMailboxOwnerAuthorization(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	ctx := context.Background()

	orgID, ownerID, adminID, memberID := createTestOrgAndUsers(t, db)
	_, ownerMailboxID := createTestMailbox(t, db, orgID, ownerID, "calowner")
	_, memberMailboxID := createTestMailbox(t, db, orgID, memberID, "calmember")

	ownerToken := createTestSession(t, db, ownerID)
	adminToken := createTestSession(t, db, adminID)
	memberToken := createTestSession(t, db, memberID)

	// External org user
	orgB, userBID, _, _ := createTestOrgAndUsers(t, db)
	_, userBMailboxID := createTestMailbox(t, db, orgB, userBID, "userb")
	tokenB := createTestSession(t, db, userBID)
	_ = userBMailboxID

	// Valid Section 12 AES-GCM envelope
	validEnvelope := make([]byte, 1+12+16)
	validEnvelope[0] = 0x01
	for i := 1; i < len(validEnvelope); i++ {
		validEnvelope[i] = byte(i)
	}
	validEnvelopeB64 := base64.StdEncoding.EncodeToString(validEnvelope)

	// Ensure default calendar for owner
	w := calRequest(t, http.MethodGet, ownerMailboxID, "", "", ownerToken)
	if w.Code != http.StatusOK {
		t.Fatalf("owner get calendars failed: %d", w.Code)
	}
	var calendars []UserCalendar
	json.NewDecoder(w.Body).Decode(&calendars)
	ownerCalID := calendars[0].ID

	// Owner creates an event
	createEventJSON := fmt.Sprintf(`{
		"calendar_id": "%s",
		"start_time": "2026-10-25T10:00:00Z",
		"end_time": "2026-10-25T11:00:00Z",
		"status": "busy",
		"encrypted_payload": "%s"
	}`, ownerCalID, validEnvelopeB64)
	w = calEventRequest(t, http.MethodPost, ownerMailboxID, "", "", createEventJSON, ownerToken)
	if w.Code != http.StatusCreated {
		t.Fatalf("owner create event: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	var createdEvent CalendarEvent
	json.NewDecoder(w.Body).Decode(&createdEvent)
	ownerEventID := createdEvent.ID

	// Seed legacy plaintext event for owner
	var legacyEventID string
	err := db.QueryRowContext(ctx, `
		INSERT INTO calendar_events (mailbox_id, calendar_id, start_time, end_time, is_all_day, status, encrypted_payload)
		VALUES ($1, $2, now(), now() + interval '1 hour', false, 'busy', $3)
		RETURNING id`, ownerMailboxID, ownerCalID, []byte(`{"title":"Confidential Meeting"}`)).Scan(&legacyEventID)
	if err != nil {
		t.Fatalf("seed legacy event: %v", err)
	}

	w = calEventRequest(t, http.MethodGet, ownerMailboxID, legacyEventID, "", "", ownerToken)
	ownerETag := w.Header().Get("ETag")

	// 1. Peer employee in same org (memberToken) must be rejected with 403 on all calendar routes
	t.Run("Peer employee in same org rejected from owner calendar and migrations", func(t *testing.T) {
		w := calRequest(t, http.MethodGet, ownerMailboxID, "", "", memberToken)
		if w.Code != http.StatusForbidden {
			t.Fatalf("member get calendars: expected 403, got %d", w.Code)
		}

		w = calEventRequest(t, http.MethodGet, ownerMailboxID, ownerEventID, "", "", memberToken)
		if w.Code != http.StatusForbidden {
			t.Fatalf("member get event: expected 403, got %d", w.Code)
		}

		w = calEventRequest(t, http.MethodPatch, ownerMailboxID, ownerEventID, "", `{"status":"tentative"}`, memberToken)
		if w.Code != http.StatusForbidden {
			t.Fatalf("member patch event: expected 403, got %d", w.Code)
		}

		w = calEventRequest(t, http.MethodDelete, ownerMailboxID, ownerEventID, "", "", memberToken)
		if w.Code != http.StatusForbidden {
			t.Fatalf("member delete event: expected 403, got %d", w.Code)
		}

		w = calMigrationRequest(t, "stage", ownerMailboxID, legacyEventID, ownerETag, fmt.Sprintf(`{"staged_encrypted_payload":"%s"}`, validEnvelopeB64), memberToken)
		if w.Code != http.StatusForbidden {
			t.Fatalf("member stage migration: expected 403, got %d", w.Code)
		}

		w = calMigrationRequest(t, "status", ownerMailboxID, legacyEventID, "", "", memberToken)
		if w.Code != http.StatusForbidden {
			t.Fatalf("member migration status: expected 403, got %d", w.Code)
		}

		w = calMigrationRequest(t, "finalize", ownerMailboxID, legacyEventID, "", `{"migration_id":"00000000-0000-0000-0000-000000000001"}`, memberToken)
		if w.Code != http.StatusForbidden {
			t.Fatalf("member finalize migration: expected 403, got %d", w.Code)
		}

		w = calMigrationRequest(t, "rollback", ownerMailboxID, legacyEventID, "", `{"migration_id":"00000000-0000-0000-0000-000000000001"}`, memberToken)
		if w.Code != http.StatusForbidden {
			t.Fatalf("member rollback migration: expected 403, got %d", w.Code)
		}
	})

	// 2. Org Administrator in same org (adminToken) must be rejected with 403 on private user calendar
	t.Run("Org administrator cannot access or manipulate employee calendar", func(t *testing.T) {
		w := calRequest(t, http.MethodGet, ownerMailboxID, "", "", adminToken)
		if w.Code != http.StatusForbidden {
			t.Fatalf("admin get calendars: expected 403, got %d", w.Code)
		}

		w = calEventRequest(t, http.MethodGet, ownerMailboxID, ownerEventID, "", "", adminToken)
		if w.Code != http.StatusForbidden {
			t.Fatalf("admin get event: expected 403, got %d", w.Code)
		}

		w = calMigrationRequest(t, "stage", ownerMailboxID, legacyEventID, ownerETag, fmt.Sprintf(`{"staged_encrypted_payload":"%s"}`, validEnvelopeB64), adminToken)
		if w.Code != http.StatusForbidden {
			t.Fatalf("admin stage migration: expected 403, got %d", w.Code)
		}

		w = calMigrationRequest(t, "status", ownerMailboxID, legacyEventID, "", "", adminToken)
		if w.Code != http.StatusForbidden {
			t.Fatalf("admin migration status: expected 403, got %d", w.Code)
		}

		w = calMigrationRequest(t, "finalize", ownerMailboxID, legacyEventID, "", `{"migration_id":"00000000-0000-0000-0000-000000000001"}`, adminToken)
		if w.Code != http.StatusForbidden {
			t.Fatalf("admin finalize migration: expected 403, got %d", w.Code)
		}

		w = calMigrationRequest(t, "rollback", ownerMailboxID, legacyEventID, "", `{"migration_id":"00000000-0000-0000-0000-000000000001"}`, adminToken)
		if w.Code != http.StatusForbidden {
			t.Fatalf("admin rollback migration: expected 403, got %d", w.Code)
		}
	})

	// 3. External org user (tokenB) must be rejected with 403
	t.Run("Cross-tenant user rejected from mailbox operations", func(t *testing.T) {
		w := calRequest(t, http.MethodGet, ownerMailboxID, "", "", tokenB)
		if w.Code != http.StatusForbidden {
			t.Fatalf("external get calendars: expected 403, got %d", w.Code)
		}

		w = calMigrationRequest(t, "stage", ownerMailboxID, legacyEventID, ownerETag, fmt.Sprintf(`{"staged_encrypted_payload":"%s"}`, validEnvelopeB64), tokenB)
		if w.Code != http.StatusForbidden {
			t.Fatalf("external stage migration: expected 403, got %d", w.Code)
		}
	})

	// 4. Migration ID belonging to another mailbox cannot be accessed or manipulated
	t.Run("Migration ID cannot cross mailbox boundaries", func(t *testing.T) {
		// Owner stages migration
		w := calMigrationRequest(t, "stage", ownerMailboxID, legacyEventID, ownerETag, fmt.Sprintf(`{"staged_encrypted_payload":"%s"}`, validEnvelopeB64), ownerToken)
		if w.Code != http.StatusOK {
			t.Fatalf("owner stage migration failed: %d: %s", w.Code, w.Body.String())
		}
		var stageRes struct {
			MigrationID string `json:"migration_id"`
		}
		json.NewDecoder(w.Body).Decode(&stageRes)

		// Member sets up default calendar & event in memberMailboxID
		calRequest(t, http.MethodGet, memberMailboxID, "", "", memberToken)
		var memberEventID string
		err := db.QueryRowContext(ctx, `
			INSERT INTO calendar_events (mailbox_id, calendar_id, start_time, end_time, is_all_day, status, encrypted_payload)
			VALUES ($1, (SELECT id FROM user_calendars WHERE mailbox_id=$1 LIMIT 1), now(), now() + interval '1 hour', false, 'busy', $2)
			RETURNING id`, memberMailboxID, []byte(`{"title":"Member Event"}`)).Scan(&memberEventID)
		if err != nil {
			t.Fatalf("seed member event: %v", err)
		}

		// Member attempts to finalize or roll back specifying owner's migration ID against member's event
		w = calMigrationRequest(t, "finalize", memberMailboxID, memberEventID, "", fmt.Sprintf(`{"migration_id":"%s"}`, stageRes.MigrationID), memberToken)
		if w.Code != http.StatusNotFound {
			t.Fatalf("finalize cross-mailbox migration ID: expected 404, got %d", w.Code)
		}

		w = calMigrationRequest(t, "rollback", memberMailboxID, memberEventID, "", fmt.Sprintf(`{"migration_id":"%s"}`, stageRes.MigrationID), memberToken)
		if w.Code != http.StatusNotFound {
			t.Fatalf("rollback cross-mailbox migration ID: expected 404, got %d", w.Code)
		}

		// Clean up owner's staged migration
		calMigrationRequest(t, "rollback", ownerMailboxID, legacyEventID, "", fmt.Sprintf(`{"migration_id":"%s"}`, stageRes.MigrationID), ownerToken)
	})
}

func TestCalendarRecoveryPlaintextCleanupAndRollbackSafety(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	ctx := context.Background()

	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, orgID, ownerID, "rollbackcleanup")
	token := createTestSession(t, db, ownerID)

	calRequest(t, http.MethodGet, mailboxID, "", "", token)

	validEnvelope := make([]byte, 1+12+16)
	validEnvelope[0] = 0x01
	for i := 1; i < len(validEnvelope); i++ {
		validEnvelope[i] = byte(i)
	}
	validEnvelopeB64 := base64.StdEncoding.EncodeToString(validEnvelope)

	legacyRaw := `{"title":"Quarterly Strategy","location":"Boardroom A"}`
	var eventID string
	err := db.QueryRowContext(ctx, `
		INSERT INTO calendar_events (mailbox_id, calendar_id, start_time, end_time, is_all_day, status, encrypted_payload)
		VALUES ($1, (SELECT id FROM user_calendars WHERE mailbox_id=$1 LIMIT 1), now(), now() + interval '1 hour', false, 'busy', $2)
		RETURNING id`, mailboxID, []byte(legacyRaw)).Scan(&eventID)
	if err != nil {
		t.Fatalf("seed event: %v", err)
	}

	w := calEventRequest(t, http.MethodGet, mailboxID, eventID, "", "", token)
	etag := w.Header().Get("ETag")

	// Stage migration
	w = calMigrationRequest(t, "stage", mailboxID, eventID, etag, fmt.Sprintf(`{"staged_encrypted_payload":"%s"}`, validEnvelopeB64), token)
	if w.Code != http.StatusOK {
		t.Fatalf("stage: expected 200, got %d", w.Code)
	}
	var stageRes struct {
		MigrationID string `json:"migration_id"`
	}
	json.NewDecoder(w.Body).Decode(&stageRes)

	// Verify legacy_payload exists in migration row while staged
	var stagedLegacy []byte
	var stagedStatus string
	err = db.QueryRowContext(ctx, `SELECT legacy_payload, status FROM calendar_event_migrations WHERE id = $1`, stageRes.MigrationID).Scan(&stagedLegacy, &stagedStatus)
	if err != nil || stagedStatus != "staged" || len(stagedLegacy) == 0 {
		t.Fatalf("expected staged migration with legacy_payload preserved: %v", err)
	}

	// Rollback
	w = calMigrationRequest(t, "rollback", mailboxID, eventID, "", fmt.Sprintf(`{"migration_id":"%s","reason":"user_requested"}`, stageRes.MigrationID), token)
	if w.Code != http.StatusOK {
		t.Fatalf("rollback: expected 200, got %d", w.Code)
	}

	// Assert: Event payload matches original legacy bytes exactly
	var restoredPayload []byte
	err = db.QueryRowContext(ctx, `SELECT encrypted_payload FROM calendar_events WHERE id = $1`, eventID).Scan(&restoredPayload)
	if err != nil || string(restoredPayload) != legacyRaw {
		t.Fatalf("expected exact restored legacy payload, got: %s", string(restoredPayload))
	}

	// Assert: legacy_payload in calendar_event_migrations is NULL after rollback!
	var postRollbackLegacy []byte
	var postRollbackStatus string
	var rolledBackAt *time.Time
	err = db.QueryRowContext(ctx, `SELECT legacy_payload, status, rolled_back_at FROM calendar_event_migrations WHERE id = $1`, stageRes.MigrationID).Scan(&postRollbackLegacy, &postRollbackStatus, &rolledBackAt)
	if err != nil {
		t.Fatalf("query post-rollback migration: %v", err)
	}
	if postRollbackStatus != "rolled_back" {
		t.Fatalf("expected status 'rolled_back', got: %s", postRollbackStatus)
	}
	if len(postRollbackLegacy) != 0 {
		t.Fatalf("expected legacy_payload to be NULL after rollback, got %d bytes", len(postRollbackLegacy))
	}
	if rolledBackAt == nil {
		t.Fatalf("expected rolled_back_at to be set")
	}

	// Retried rollback request is idempotent and cannot corrupt event
	w2 := calMigrationRequest(t, "rollback", mailboxID, eventID, "", fmt.Sprintf(`{"migration_id":"%s"}`, stageRes.MigrationID), token)
	if w2.Code != http.StatusOK {
		t.Fatalf("retried rollback: expected 200, got %d", w2.Code)
	}
	var checkPayload []byte
	_ = db.QueryRowContext(ctx, `SELECT encrypted_payload FROM calendar_events WHERE id = $1`, eventID).Scan(&checkPayload)
	if string(checkPayload) != legacyRaw {
		t.Fatalf("corrupted payload after retried rollback: %s", string(checkPayload))
	}

	// Distinct terminal state: finalize second event, cannot roll back
	var eventID2 string
	_ = db.QueryRowContext(ctx, `
		INSERT INTO calendar_events (mailbox_id, calendar_id, start_time, end_time, is_all_day, status, encrypted_payload)
		VALUES ($1, (SELECT id FROM user_calendars WHERE mailbox_id=$1 LIMIT 1), now(), now() + interval '1 hour', false, 'busy', $2)
		RETURNING id`, mailboxID, []byte(legacyRaw)).Scan(&eventID2)
	w = calEventRequest(t, http.MethodGet, mailboxID, eventID2, "", "", token)
	etag2 := w.Header().Get("ETag")

	w = calMigrationRequest(t, "stage", mailboxID, eventID2, etag2, fmt.Sprintf(`{"staged_encrypted_payload":"%s"}`, validEnvelopeB64), token)
	var stageRes2 struct {
		MigrationID string `json:"migration_id"`
	}
	json.NewDecoder(w.Body).Decode(&stageRes2)

	w = calMigrationRequest(t, "finalize", mailboxID, eventID2, "", fmt.Sprintf(`{"migration_id":"%s"}`, stageRes2.MigrationID), token)
	if w.Code != http.StatusOK {
		t.Fatalf("finalize failed: %d", w.Code)
	}

	// Cannot rollback a finalized migration
	w = calMigrationRequest(t, "rollback", mailboxID, eventID2, "", fmt.Sprintf(`{"migration_id":"%s"}`, stageRes2.MigrationID), token)
	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409 conflict when rolling back finalized migration, got %d", w.Code)
	}
}

func TestCalendarRecoveryConcurrencyAndLockOrdering(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	ctx := context.Background()

	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, orgID, ownerID, "concurrencyuser")
	token := createTestSession(t, db, ownerID)

	calRequest(t, http.MethodGet, mailboxID, "", "", token)

	validEnvelope := make([]byte, 1+12+16)
	validEnvelope[0] = 0x01
	for i := 1; i < len(validEnvelope); i++ {
		validEnvelope[i] = byte(i)
	}
	validEnvelopeB64 := base64.StdEncoding.EncodeToString(validEnvelope)

	legacyRaw := `{"title":"Concurrent Event","location":"Online"}`
	var eventID string
	err := db.QueryRowContext(ctx, `
		INSERT INTO calendar_events (mailbox_id, calendar_id, start_time, end_time, is_all_day, status, encrypted_payload)
		VALUES ($1, (SELECT id FROM user_calendars WHERE mailbox_id=$1 LIMIT 1), now(), now() + interval '1 hour', false, 'busy', $2)
		RETURNING id`, mailboxID, []byte(legacyRaw)).Scan(&eventID)
	if err != nil {
		t.Fatalf("seed event: %v", err)
	}

	w := calEventRequest(t, http.MethodGet, mailboxID, eventID, "", "", token)
	etag := w.Header().Get("ETag")

	// Stage migration
	w = calMigrationRequest(t, "stage", mailboxID, eventID, etag, fmt.Sprintf(`{"staged_encrypted_payload":"%s"}`, validEnvelopeB64), token)
	if w.Code != http.StatusOK {
		t.Fatalf("stage: expected 200, got %d", w.Code)
	}
	var stageRes struct {
		MigrationID string `json:"migration_id"`
	}
	json.NewDecoder(w.Body).Decode(&stageRes)

	// Concurrency Check 1: PATCH while migration is active must be rejected with 409
	w = calEventRequest(t, http.MethodPatch, mailboxID, eventID, "", `{"status":"tentative"}`, token)
	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409 Conflict for PATCH during active migration, got %d", w.Code)
	}

	// Concurrency Check 2: PUT while migration is active must be rejected with 409
	w = calEventRequest(t, http.MethodPut, mailboxID, eventID, "", `{"status":"tentative"}`, token)
	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409 Conflict for PUT during active migration, got %d", w.Code)
	}

	// Concurrency Check 3: DELETE while migration is active must be rejected with 409
	w = calEventRequest(t, http.MethodDelete, mailboxID, eventID, "", "", token)
	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409 Conflict for DELETE during active migration, got %d", w.Code)
	}

	// Concurrency Check 4: Concurrent staging attempt for same event must be rejected with 409
	w = calMigrationRequest(t, "stage", mailboxID, eventID, etag, fmt.Sprintf(`{"staged_encrypted_payload":"%s"}`, validEnvelopeB64), token)
	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409 Conflict for duplicate staging, got %d", w.Code)
	}

	// Finalize migration
	w = calMigrationRequest(t, "finalize", mailboxID, eventID, "", fmt.Sprintf(`{"migration_id":"%s"}`, stageRes.MigrationID), token)
	if w.Code != http.StatusOK {
		t.Fatalf("finalize failed: %d", w.Code)
	}

	// Concurrency Check 5: Ordinary update after finalization succeeds
	w = calEventRequest(t, http.MethodPatch, mailboxID, eventID, "", `{"status":"tentative"}`, token)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for PATCH after finalization, got %d: %s", w.Code, w.Body.String())
	}
}

func TestCalendarTerminalMigrationDeletionBehavior(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	ctx := context.Background()

	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, orgID, ownerID, "deletionuser")
	token := createTestSession(t, db, ownerID)

	calRequest(t, http.MethodGet, mailboxID, "", "", token)

	validEnvelope := make([]byte, 1+12+16)
	validEnvelope[0] = 0x01
	for i := 1; i < len(validEnvelope); i++ {
		validEnvelope[i] = byte(i)
	}
	validEnvelopeB64 := base64.StdEncoding.EncodeToString(validEnvelope)

	legacyRaw := `{"title":"Deletion Target","location":"Room 4"}`

	// 1. Finalized event can be deleted cleanly without FK error
	t.Run("Finalized event deletion succeeds and cleans up migration rows", func(t *testing.T) {
		var eventID string
		_ = db.QueryRowContext(ctx, `
			INSERT INTO calendar_events (mailbox_id, calendar_id, start_time, end_time, is_all_day, status, encrypted_payload)
			VALUES ($1, (SELECT id FROM user_calendars WHERE mailbox_id=$1 LIMIT 1), now(), now() + interval '1 hour', false, 'busy', $2)
			RETURNING id`, mailboxID, []byte(legacyRaw)).Scan(&eventID)

		w := calEventRequest(t, http.MethodGet, mailboxID, eventID, "", "", token)
		etag := w.Header().Get("ETag")

		w = calMigrationRequest(t, "stage", mailboxID, eventID, etag, fmt.Sprintf(`{"staged_encrypted_payload":"%s"}`, validEnvelopeB64), token)
		var stageRes struct {
			MigrationID string `json:"migration_id"`
		}
		json.NewDecoder(w.Body).Decode(&stageRes)

		w = calMigrationRequest(t, "finalize", mailboxID, eventID, "", fmt.Sprintf(`{"migration_id":"%s"}`, stageRes.MigrationID), token)
		if w.Code != http.StatusOK {
			t.Fatalf("finalize failed: %d", w.Code)
		}

		// Delete event
		w = calEventRequest(t, http.MethodDelete, mailboxID, eventID, "", "", token)
		if w.Code != http.StatusNoContent {
			t.Fatalf("expected 204 No Content for deleting finalized event, got %d: %s", w.Code, w.Body.String())
		}

		// Assert event deleted and migration rows purged
		var evCount, migCount int
		_ = db.QueryRowContext(ctx, `SELECT count(*) FROM calendar_events WHERE id = $1`, eventID).Scan(&evCount)
		_ = db.QueryRowContext(ctx, `SELECT count(*) FROM calendar_event_migrations WHERE event_id = $1`, eventID).Scan(&migCount)
		if evCount != 0 || migCount != 0 {
			t.Fatalf("expected event and terminal migrations to be 0, got ev=%d, mig=%d", evCount, migCount)
		}
	})

	// 2. Rolled back event can be deleted cleanly without FK error
	t.Run("Rolled back event deletion succeeds and cleans up migration rows", func(t *testing.T) {
		var eventID string
		_ = db.QueryRowContext(ctx, `
			INSERT INTO calendar_events (mailbox_id, calendar_id, start_time, end_time, is_all_day, status, encrypted_payload)
			VALUES ($1, (SELECT id FROM user_calendars WHERE mailbox_id=$1 LIMIT 1), now(), now() + interval '1 hour', false, 'busy', $2)
			RETURNING id`, mailboxID, []byte(legacyRaw)).Scan(&eventID)

		w := calEventRequest(t, http.MethodGet, mailboxID, eventID, "", "", token)
		etag := w.Header().Get("ETag")

		w = calMigrationRequest(t, "stage", mailboxID, eventID, etag, fmt.Sprintf(`{"staged_encrypted_payload":"%s"}`, validEnvelopeB64), token)
		var stageRes struct {
			MigrationID string `json:"migration_id"`
		}
		json.NewDecoder(w.Body).Decode(&stageRes)

		w = calMigrationRequest(t, "rollback", mailboxID, eventID, "", fmt.Sprintf(`{"migration_id":"%s"}`, stageRes.MigrationID), token)
		if w.Code != http.StatusOK {
			t.Fatalf("rollback failed: %d", w.Code)
		}

		// Delete event
		w = calEventRequest(t, http.MethodDelete, mailboxID, eventID, "", "", token)
		if w.Code != http.StatusNoContent {
			t.Fatalf("expected 204 No Content for deleting rolled_back event, got %d: %s", w.Code, w.Body.String())
		}

		var evCount, migCount int
		_ = db.QueryRowContext(ctx, `SELECT count(*) FROM calendar_events WHERE id = $1`, eventID).Scan(&evCount)
		_ = db.QueryRowContext(ctx, `SELECT count(*) FROM calendar_event_migrations WHERE event_id = $1`, eventID).Scan(&migCount)
		if evCount != 0 || migCount != 0 {
			t.Fatalf("expected event and terminal migrations to be 0, got ev=%d, mig=%d", evCount, migCount)
		}
	})

	// 3. Calendar deletion with terminal migrations succeeds
	t.Run("Calendar deletion with terminal event migrations succeeds", func(t *testing.T) {
		// Create secondary calendar
		w := calRequest(t, http.MethodPost, mailboxID, "", `{"name":"Secondary Calendar","color":"#336699"}`, token)
		if w.Code != http.StatusCreated {
			t.Fatalf("create secondary calendar: %d", w.Code)
		}
		var secCal UserCalendar
		json.NewDecoder(w.Body).Decode(&secCal)

		var evID string
		_ = db.QueryRowContext(ctx, `
			INSERT INTO calendar_events (mailbox_id, calendar_id, start_time, end_time, is_all_day, status, encrypted_payload)
			VALUES ($1, $2, now(), now() + interval '1 hour', false, 'busy', $3)
			RETURNING id`, mailboxID, secCal.ID, []byte(legacyRaw)).Scan(&evID)

		w = calEventRequest(t, http.MethodGet, mailboxID, evID, "", "", token)
		etag := w.Header().Get("ETag")

		w = calMigrationRequest(t, "stage", mailboxID, evID, etag, fmt.Sprintf(`{"staged_encrypted_payload":"%s"}`, validEnvelopeB64), token)
		var sRes struct {
			MigrationID string `json:"migration_id"`
		}
		json.NewDecoder(w.Body).Decode(&sRes)

		calMigrationRequest(t, "finalize", mailboxID, evID, "", fmt.Sprintf(`{"migration_id":"%s"}`, sRes.MigrationID), token)

		// Delete secondary calendar
		w = calRequest(t, http.MethodDelete, mailboxID, secCal.ID, "", token)
		if w.Code != http.StatusNoContent {
			t.Fatalf("expected 204 for deleting calendar with finalized event, got %d: %s", w.Code, w.Body.String())
		}
	})

	// 4. Five mailbox deletion cases covering referential integrity and staged migration protection
	t.Run("Mailbox deletion Case 1 - No events or migrations succeeds", func(t *testing.T) {
		_, mbCase1 := createTestMailbox(t, db, orgID, ownerID, "mbcase1")
		conn, err := pgx.Connect(ctx, getValidatedTestDSN(t))
		if err != nil {
			t.Fatalf("connect pgx: %v", err)
		}
		defer conn.Close(ctx)

		_, err = deleteMailbox(ctx, conn, orgID, mbCase1, ownerID)
		if err != nil {
			t.Fatalf("expected deleteMailbox to succeed for mailbox without events, got: %v", err)
		}

		var isActive bool
		var mbStatus string
		_ = db.QueryRowContext(ctx, `SELECT is_active, status FROM mailboxes WHERE id = $1`, mbCase1).Scan(&isActive, &mbStatus)
		if isActive || mbStatus != "suspended" {
			t.Fatalf("expected mailbox to be deactivated with status suspended, got is_active=%v, status=%s", isActive, mbStatus)
		}
	})

	t.Run("Mailbox deletion Case 2 - Active staged migration blocks deletion and preserves data", func(t *testing.T) {
		_, mbCase2 := createTestMailbox(t, db, orgID, ownerID, "mbcase2")
		calRequest(t, http.MethodGet, mbCase2, "", "", token)

		var evID string
		_ = db.QueryRowContext(ctx, `
			INSERT INTO calendar_events (mailbox_id, calendar_id, start_time, end_time, is_all_day, status, encrypted_payload)
			VALUES ($1, (SELECT id FROM user_calendars WHERE mailbox_id=$1 LIMIT 1), now(), now() + interval '1 hour', false, 'busy', $2)
			RETURNING id`, mbCase2, []byte(legacyRaw)).Scan(&evID)

		w := calEventRequest(t, http.MethodGet, mbCase2, evID, "", "", token)
		etag := w.Header().Get("ETag")

		calMigrationRequest(t, "stage", mbCase2, evID, etag, fmt.Sprintf(`{"staged_encrypted_payload":"%s"}`, validEnvelopeB64), token)

		conn, err := pgx.Connect(ctx, getValidatedTestDSN(t))
		if err != nil {
			t.Fatalf("connect pgx: %v", err)
		}
		defer conn.Close(ctx)

		_, err = deleteMailbox(ctx, conn, orgID, mbCase2, ownerID)
		if err == nil || !strings.Contains(err.Error(), "active calendar event migrations in progress") {
			t.Fatalf("expected deleteMailbox error for active staged migration, got: %v", err)
		}

		// Verify staged migration and event remain intact
		var migStatus string
		var legacyPayload []byte
		_ = db.QueryRowContext(ctx, `SELECT status, legacy_payload FROM calendar_event_migrations WHERE mailbox_id=$1 AND event_id=$2`, mbCase2, evID).Scan(&migStatus, &legacyPayload)
		if migStatus != "staged" || string(legacyPayload) != legacyRaw {
			t.Fatalf("expected staged migration to remain intact, got status=%s, payload=%s", migStatus, string(legacyPayload))
		}

		var isActive bool
		_ = db.QueryRowContext(ctx, `SELECT is_active FROM mailboxes WHERE id = $1`, mbCase2).Scan(&isActive)
		if !isActive {
			t.Fatalf("expected mailbox to remain active when deletion blocked")
		}
	})

	t.Run("Mailbox deletion Case 3 - Finalized migration history cleaned up and mailbox deactivated", func(t *testing.T) {
		_, mbCase3 := createTestMailbox(t, db, orgID, ownerID, "mbcase3")
		calRequest(t, http.MethodGet, mbCase3, "", "", token)

		var evID string
		_ = db.QueryRowContext(ctx, `
			INSERT INTO calendar_events (mailbox_id, calendar_id, start_time, end_time, is_all_day, status, encrypted_payload)
			VALUES ($1, (SELECT id FROM user_calendars WHERE mailbox_id=$1 LIMIT 1), now(), now() + interval '1 hour', false, 'busy', $2)
			RETURNING id`, mbCase3, []byte(legacyRaw)).Scan(&evID)

		w := calEventRequest(t, http.MethodGet, mbCase3, evID, "", "", token)
		etag := w.Header().Get("ETag")

		wStage := calMigrationRequest(t, "stage", mbCase3, evID, etag, fmt.Sprintf(`{"staged_encrypted_payload":"%s"}`, validEnvelopeB64), token)
		var sRes struct {
			MigrationID string `json:"migration_id"`
		}
		json.NewDecoder(wStage.Body).Decode(&sRes)

		calMigrationRequest(t, "finalize", mbCase3, evID, "", fmt.Sprintf(`{"migration_id":"%s"}`, sRes.MigrationID), token)

		var migCountBefore int
		_ = db.QueryRowContext(ctx, `SELECT count(*) FROM calendar_event_migrations WHERE mailbox_id=$1 AND status='finalized'`, mbCase3).Scan(&migCountBefore)
		if migCountBefore != 1 {
			t.Fatalf("expected 1 finalized migration before deletion, got %d", migCountBefore)
		}

		conn, err := pgx.Connect(ctx, getValidatedTestDSN(t))
		if err != nil {
			t.Fatalf("connect pgx: %v", err)
		}
		defer conn.Close(ctx)

		_, err = deleteMailbox(ctx, conn, orgID, mbCase3, ownerID)
		if err != nil {
			t.Fatalf("expected deleteMailbox to succeed with finalized migration, got: %v", err)
		}

		// Verify terminal migration history was purged
		var migCountAfter int
		_ = db.QueryRowContext(ctx, `SELECT count(*) FROM calendar_event_migrations WHERE mailbox_id=$1`, mbCase3).Scan(&migCountAfter)
		if migCountAfter != 0 {
			t.Fatalf("expected 0 migration records after deleteMailbox, got %d", migCountAfter)
		}

		var isActive bool
		_ = db.QueryRowContext(ctx, `SELECT is_active FROM mailboxes WHERE id = $1`, mbCase3).Scan(&isActive)
		if isActive {
			t.Fatalf("expected mailbox to be deactivated")
		}
	})

	t.Run("Mailbox deletion Case 4 - Rolled-back migration history cleaned up and mailbox deactivated", func(t *testing.T) {
		_, mbCase4 := createTestMailbox(t, db, orgID, ownerID, "mbcase4")
		calRequest(t, http.MethodGet, mbCase4, "", "", token)

		var evID string
		_ = db.QueryRowContext(ctx, `
			INSERT INTO calendar_events (mailbox_id, calendar_id, start_time, end_time, is_all_day, status, encrypted_payload)
			VALUES ($1, (SELECT id FROM user_calendars WHERE mailbox_id=$1 LIMIT 1), now(), now() + interval '1 hour', false, 'busy', $2)
			RETURNING id`, mbCase4, []byte(legacyRaw)).Scan(&evID)

		w := calEventRequest(t, http.MethodGet, mbCase4, evID, "", "", token)
		etag := w.Header().Get("ETag")

		wStage := calMigrationRequest(t, "stage", mbCase4, evID, etag, fmt.Sprintf(`{"staged_encrypted_payload":"%s"}`, validEnvelopeB64), token)
		var sRes struct {
			MigrationID string `json:"migration_id"`
		}
		json.NewDecoder(wStage.Body).Decode(&sRes)

		calMigrationRequest(t, "rollback", mbCase4, evID, "", fmt.Sprintf(`{"migration_id":"%s"}`, sRes.MigrationID), token)

		var migCountBefore int
		_ = db.QueryRowContext(ctx, `SELECT count(*) FROM calendar_event_migrations WHERE mailbox_id=$1 AND status='rolled_back'`, mbCase4).Scan(&migCountBefore)
		if migCountBefore != 1 {
			t.Fatalf("expected 1 rolled_back migration before deletion, got %d", migCountBefore)
		}

		conn, err := pgx.Connect(ctx, getValidatedTestDSN(t))
		if err != nil {
			t.Fatalf("connect pgx: %v", err)
		}
		defer conn.Close(ctx)

		_, err = deleteMailbox(ctx, conn, orgID, mbCase4, ownerID)
		if err != nil {
			t.Fatalf("expected deleteMailbox to succeed with rolled_back migration, got: %v", err)
		}

		// Verify terminal migration history was purged
		var migCountAfter int
		_ = db.QueryRowContext(ctx, `SELECT count(*) FROM calendar_event_migrations WHERE mailbox_id=$1`, mbCase4).Scan(&migCountAfter)
		if migCountAfter != 0 {
			t.Fatalf("expected 0 migration records after deleteMailbox, got %d", migCountAfter)
		}

		var isActive bool
		_ = db.QueryRowContext(ctx, `SELECT is_active FROM mailboxes WHERE id = $1`, mbCase4).Scan(&isActive)
		if isActive {
			t.Fatalf("expected mailbox to be deactivated")
		}
	})

	t.Run("Mailbox deletion Case 5 - Mixed terminal and staged migrations preserves all data and blocks deletion", func(t *testing.T) {
		_, mbCase5 := createTestMailbox(t, db, orgID, ownerID, "mbcase5")
		calRequest(t, http.MethodGet, mbCase5, "", "", token)

		// Event 1: Finalized
		var ev1ID string
		_ = db.QueryRowContext(ctx, `
			INSERT INTO calendar_events (mailbox_id, calendar_id, start_time, end_time, is_all_day, status, encrypted_payload)
			VALUES ($1, (SELECT id FROM user_calendars WHERE mailbox_id=$1 LIMIT 1), now(), now() + interval '1 hour', false, 'busy', $2)
			RETURNING id`, mbCase5, []byte(legacyRaw)).Scan(&ev1ID)

		w1 := calEventRequest(t, http.MethodGet, mbCase5, ev1ID, "", "", token)
		etag1 := w1.Header().Get("ETag")
		wStage1 := calMigrationRequest(t, "stage", mbCase5, ev1ID, etag1, fmt.Sprintf(`{"staged_encrypted_payload":"%s"}`, validEnvelopeB64), token)
		var sRes1 struct {
			MigrationID string `json:"migration_id"`
		}
		json.NewDecoder(wStage1.Body).Decode(&sRes1)
		calMigrationRequest(t, "finalize", mbCase5, ev1ID, "", fmt.Sprintf(`{"migration_id":"%s"}`, sRes1.MigrationID), token)

		// Event 2: Rolled back
		var ev2ID string
		_ = db.QueryRowContext(ctx, `
			INSERT INTO calendar_events (mailbox_id, calendar_id, start_time, end_time, is_all_day, status, encrypted_payload)
			VALUES ($1, (SELECT id FROM user_calendars WHERE mailbox_id=$1 LIMIT 1), now(), now() + interval '1 hour', false, 'busy', $2)
			RETURNING id`, mbCase5, []byte(legacyRaw)).Scan(&ev2ID)

		w2 := calEventRequest(t, http.MethodGet, mbCase5, ev2ID, "", "", token)
		etag2 := w2.Header().Get("ETag")
		wStage2 := calMigrationRequest(t, "stage", mbCase5, ev2ID, etag2, fmt.Sprintf(`{"staged_encrypted_payload":"%s"}`, validEnvelopeB64), token)
		var sRes2 struct {
			MigrationID string `json:"migration_id"`
		}
		json.NewDecoder(wStage2.Body).Decode(&sRes2)
		calMigrationRequest(t, "rollback", mbCase5, ev2ID, "", fmt.Sprintf(`{"migration_id":"%s"}`, sRes2.MigrationID), token)

		// Event 3: Active staged
		var ev3ID string
		_ = db.QueryRowContext(ctx, `
			INSERT INTO calendar_events (mailbox_id, calendar_id, start_time, end_time, is_all_day, status, encrypted_payload)
			VALUES ($1, (SELECT id FROM user_calendars WHERE mailbox_id=$1 LIMIT 1), now(), now() + interval '1 hour', false, 'busy', $2)
			RETURNING id`, mbCase5, []byte(legacyRaw)).Scan(&ev3ID)

		w3 := calEventRequest(t, http.MethodGet, mbCase5, ev3ID, "", "", token)
		etag3 := w3.Header().Get("ETag")
		calMigrationRequest(t, "stage", mbCase5, ev3ID, etag3, fmt.Sprintf(`{"staged_encrypted_payload":"%s"}`, validEnvelopeB64), token)

		// Verify 3 migration rows exist
		var totalMigBefore int
		_ = db.QueryRowContext(ctx, `SELECT count(*) FROM calendar_event_migrations WHERE mailbox_id=$1`, mbCase5).Scan(&totalMigBefore)
		if totalMigBefore != 3 {
			t.Fatalf("expected 3 migration rows before deletion, got %d", totalMigBefore)
		}

		conn, err := pgx.Connect(ctx, getValidatedTestDSN(t))
		if err != nil {
			t.Fatalf("connect pgx: %v", err)
		}
		defer conn.Close(ctx)

		_, err = deleteMailbox(ctx, conn, orgID, mbCase5, ownerID)
		if err == nil || !strings.Contains(err.Error(), "active calendar event migrations in progress") {
			t.Fatalf("expected deleteMailbox error for mixed migrations, got: %v", err)
		}

		// Verify ALL 3 migration rows survived (tx rolled back completely)
		var totalMigAfter int
		_ = db.QueryRowContext(ctx, `SELECT count(*) FROM calendar_event_migrations WHERE mailbox_id=$1`, mbCase5).Scan(&totalMigAfter)
		if totalMigAfter != 3 {
			t.Fatalf("expected all 3 migration rows to survive rolled-back deletion, got %d", totalMigAfter)
		}

		var isActive bool
		_ = db.QueryRowContext(ctx, `SELECT is_active FROM mailboxes WHERE id = $1`, mbCase5).Scan(&isActive)
		if !isActive {
			t.Fatalf("expected mailbox to remain active when deletion aborted")
		}
	})
}

func TestCalendarLifecycleWorkerAndStartupReconciliation(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	ctx := context.Background()

	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, orgID, ownerID, "lifecycleuser")
	token := createTestSession(t, db, ownerID)

	calRequest(t, http.MethodGet, mailboxID, "", "", token)

	validEnvelope := make([]byte, 1+12+16)
	validEnvelope[0] = 0x01
	for i := 1; i < len(validEnvelope); i++ {
		validEnvelope[i] = byte(i)
	}
	validEnvelopeB64 := base64.StdEncoding.EncodeToString(validEnvelope)

	dsn := getValidatedTestDSN(t)

	// 1. Startup reconciliation recovers expired migration
	t.Run("Startup reconciliation recovers expired staged migrations", func(t *testing.T) {
		legacyRaw := `{"title":"Startup Restore Test"}`
		var eventID string
		_ = db.QueryRowContext(ctx, `
			INSERT INTO calendar_events (mailbox_id, calendar_id, start_time, end_time, is_all_day, status, encrypted_payload)
			VALUES ($1, (SELECT id FROM user_calendars WHERE mailbox_id=$1 LIMIT 1), now(), now() + interval '1 hour', false, 'busy', $2)
			RETURNING id`, mailboxID, []byte(legacyRaw)).Scan(&eventID)

		w := calEventRequest(t, http.MethodGet, mailboxID, eventID, "", "", token)
		etag := w.Header().Get("ETag")

		w = calMigrationRequest(t, "stage", mailboxID, eventID, etag, fmt.Sprintf(`{"staged_encrypted_payload":"%s"}`, validEnvelopeB64), token)
		var sRes struct {
			MigrationID string `json:"migration_id"`
		}
		json.NewDecoder(w.Body).Decode(&sRes)

		// Force expiry
		_, _ = db.ExecContext(ctx, `UPDATE calendar_event_migrations SET expires_at = now() - interval '10 minutes' WHERE id = $1`, sRes.MigrationID)

		// Execute RunStartupMigrationReconciliation
		reconciled, err := RunStartupMigrationReconciliation(ctx, dsn)
		if err != nil || reconciled < 1 {
			t.Fatalf("expected RunStartupMigrationReconciliation to recover at least 1, got %d, err: %v", reconciled, err)
		}

		// Verify event restored and legacy_payload nulled
		var restored []byte
		var migLegacy []byte
		var status string
		_ = db.QueryRowContext(ctx, `SELECT encrypted_payload FROM calendar_events WHERE id = $1`, eventID).Scan(&restored)
		_ = db.QueryRowContext(ctx, `SELECT legacy_payload, status FROM calendar_event_migrations WHERE id = $1`, sRes.MigrationID).Scan(&migLegacy, &status)
		if string(restored) != legacyRaw {
			t.Fatalf("event payload was not restored: %s", string(restored))
		}
		if status != "rolled_back" || len(migLegacy) != 0 {
			t.Fatalf("expected rolled_back with NULL legacy_payload: status=%s, len=%d", status, len(migLegacy))
		}
	})

	// 2. Non-expired staged migration is untouched by reconciliation
	t.Run("Non-expired staged migration is preserved by reconciliation", func(t *testing.T) {
		legacyRaw := `{"title":"Non-Expired Test"}`
		var eventID string
		_ = db.QueryRowContext(ctx, `
			INSERT INTO calendar_events (mailbox_id, calendar_id, start_time, end_time, is_all_day, status, encrypted_payload)
			VALUES ($1, (SELECT id FROM user_calendars WHERE mailbox_id=$1 LIMIT 1), now(), now() + interval '1 hour', false, 'busy', $2)
			RETURNING id`, mailboxID, []byte(legacyRaw)).Scan(&eventID)

		w := calEventRequest(t, http.MethodGet, mailboxID, eventID, "", "", token)
		etag := w.Header().Get("ETag")

		w = calMigrationRequest(t, "stage", mailboxID, eventID, etag, fmt.Sprintf(`{"staged_encrypted_payload":"%s"}`, validEnvelopeB64), token)
		var sRes struct {
			MigrationID string `json:"migration_id"`
		}
		json.NewDecoder(w.Body).Decode(&sRes)

		// Run reconciliation
		reconciled, err := RunStartupMigrationReconciliation(ctx, dsn)
		if err != nil {
			t.Fatalf("reconciliation failed: %v", err)
		}
		if reconciled != 0 {
			t.Fatalf("expected 0 reconciled for non-expired migration, got %d", reconciled)
		}

		var status string
		_ = db.QueryRowContext(ctx, `SELECT status FROM calendar_event_migrations WHERE id = $1`, sRes.MigrationID).Scan(&status)
		if status != "staged" {
			t.Fatalf("expected status 'staged', got: %s", status)
		}

		// Clean up
		calMigrationRequest(t, "rollback", mailboxID, eventID, "", fmt.Sprintf(`{"migration_id":"%s"}`, sRes.MigrationID), token)
	})

	// 3. Ambiguous / inconsistent state handling
	t.Run("Ambiguous state preserves both copies and marks review", func(t *testing.T) {
		legacyRaw := `{"title":"Inconsistent Payload Test"}`
		var eventID string
		_ = db.QueryRowContext(ctx, `
			INSERT INTO calendar_events (mailbox_id, calendar_id, start_time, end_time, is_all_day, status, encrypted_payload)
			VALUES ($1, (SELECT id FROM user_calendars WHERE mailbox_id=$1 LIMIT 1), now(), now() + interval '1 hour', false, 'busy', $2)
			RETURNING id`, mailboxID, []byte(legacyRaw)).Scan(&eventID)

		w := calEventRequest(t, http.MethodGet, mailboxID, eventID, "", "", token)
		etag := w.Header().Get("ETag")

		w = calMigrationRequest(t, "stage", mailboxID, eventID, etag, fmt.Sprintf(`{"staged_encrypted_payload":"%s"}`, validEnvelopeB64), token)
		var sRes struct {
			MigrationID string `json:"migration_id"`
		}
		json.NewDecoder(w.Body).Decode(&sRes)

		// Force expiry
		_, _ = db.ExecContext(ctx, `UPDATE calendar_event_migrations SET expires_at = now() - interval '10 minutes' WHERE id = $1`, sRes.MigrationID)

		// Simulate external mutation / inconsistent backup where event has unexpected content
		unexpectedContent := []byte("unexpected_external_write")
		_, _ = db.ExecContext(ctx, `UPDATE calendar_events SET encrypted_payload = $1 WHERE id = $2`, unexpectedContent, eventID)

		conn, err := pgx.Connect(ctx, dsn)
		if err != nil {
			t.Fatalf("pgx connect: %v", err)
		}
		defer conn.Close(ctx)

		reconciled, err := ReconcileRestoredMigrations(ctx, conn)
		if err != nil || reconciled != 1 {
			t.Fatalf("expected 1 reconciled ambiguous migration, got %d, err: %v", reconciled, err)
		}

		// In ambiguous state:
		// 1. calendar_events.encrypted_payload must NOT be overwritten!
		var evPayload []byte
		_ = db.QueryRowContext(ctx, `SELECT encrypted_payload FROM calendar_events WHERE id = $1`, eventID).Scan(&evPayload)
		if !bytes.Equal(evPayload, unexpectedContent) {
			t.Fatalf("expected preserved unexpected content, got: %s", string(evPayload))
		}

		// 2. migration row legacy_payload must be preserved (not nulled) for operator review!
		var migLegacy []byte
		var status, reason string
		_ = db.QueryRowContext(ctx, `SELECT legacy_payload, status, rollback_reason FROM calendar_event_migrations WHERE id = $1`, sRes.MigrationID).Scan(&migLegacy, &status, &reason)
		if status != "rolled_back" || reason != "ambiguous_inconsistent_state_requires_manual_review" {
			t.Fatalf("expected rollback_reason ambiguous, got status=%s, reason=%s", status, reason)
		}
		if !bytes.Equal(migLegacy, []byte(legacyRaw)) {
			t.Fatalf("expected preserved legacy payload for review, got: %s", string(migLegacy))
		}
	})

	// 4. Background worker sweep and clean stop
	t.Run("StartCalendarExpirationWorker sweeps expired migrations and stops cleanly", func(t *testing.T) {
		workerCtx, workerCancel := context.WithCancel(context.Background())
		defer workerCancel()

		legacyRaw := `{"title":"Worker Sweep Test"}`
		var eventID string
		_ = db.QueryRowContext(ctx, `
			INSERT INTO calendar_events (mailbox_id, calendar_id, start_time, end_time, is_all_day, status, encrypted_payload)
			VALUES ($1, (SELECT id FROM user_calendars WHERE mailbox_id=$1 LIMIT 1), now(), now() + interval '1 hour', false, 'busy', $2)
			RETURNING id`, mailboxID, []byte(legacyRaw)).Scan(&eventID)

		w := calEventRequest(t, http.MethodGet, mailboxID, eventID, "", "", token)
		etag := w.Header().Get("ETag")

		w = calMigrationRequest(t, "stage", mailboxID, eventID, etag, fmt.Sprintf(`{"staged_encrypted_payload":"%s"}`, validEnvelopeB64), token)
		var sRes struct {
			MigrationID string `json:"migration_id"`
		}
		json.NewDecoder(w.Body).Decode(&sRes)

		// Force expiry
		_, _ = db.ExecContext(ctx, `UPDATE calendar_event_migrations SET expires_at = now() - interval '10 minutes' WHERE id = $1`, sRes.MigrationID)

		// Launch worker with short 50ms interval for testing
		StartCalendarExpirationWorker(workerCtx, dsn, 50*time.Millisecond)

		// Wait for worker tick
		time.Sleep(200 * time.Millisecond)

		var status string
		_ = db.QueryRowContext(ctx, `SELECT status FROM calendar_event_migrations WHERE id = $1`, sRes.MigrationID).Scan(&status)
		if status != "rolled_back" {
			t.Fatalf("expected worker to roll back expired migration, got: %s", status)
		}

		// Cancel worker and verify clean shutdown
		workerCancel()
		time.Sleep(50 * time.Millisecond)
	})
}

func TestCalendarETagFieldSensitivityAndDeterminism(t *testing.T) {
	id := "b8b63e6e-21ef-425b-ae84-b0445d0bda50"
	mailboxID := "c0000000-0000-0000-0000-000000000001"
	calendarID := "c0000000-0000-0000-0000-000000000002"
	startTime := time.Date(2026, 10, 24, 10, 0, 0, 0, time.UTC)
	endTime := time.Date(2026, 10, 24, 11, 0, 0, 0, time.UTC)
	isAllDay := false
	rruleVal := "FREQ=WEEKLY"
	status := "busy"
	payload := []byte("encrypted-payload-bytes")
	updatedAt := time.Date(2026, 10, 24, 9, 30, 0, 0, time.UTC)

	baseETag := computeCalendarEventETag(id, mailboxID, calendarID, startTime, endTime, isAllDay, &rruleVal, status, payload, updatedAt)
	if len(baseETag) < 10 || !strings.HasPrefix(baseETag, "\"") || !strings.HasSuffix(baseETag, "\"") {
		t.Fatalf("malformed base ETag: %s", baseETag)
	}

	// 1. Stable serialization across repeated calls with identical inputs
	for i := 0; i < 5; i++ {
		repeatETag := computeCalendarEventETag(id, mailboxID, calendarID, startTime, endTime, isAllDay, &rruleVal, status, payload, updatedAt)
		if repeatETag != baseETag {
			t.Fatalf("repeated call produced different ETag: %s vs %s", repeatETag, baseETag)
		}
	}

	// 2. Field sensitivity: Changing each mutable field independently must produce a different ETag
	cases := []struct {
		name string
		etag string
	}{
		{"different id", computeCalendarEventETag("different-id", mailboxID, calendarID, startTime, endTime, isAllDay, &rruleVal, status, payload, updatedAt)},
		{"different mailboxID", computeCalendarEventETag(id, "different-mailbox", calendarID, startTime, endTime, isAllDay, &rruleVal, status, payload, updatedAt)},
		{"different calendarID", computeCalendarEventETag(id, mailboxID, "different-cal", startTime, endTime, isAllDay, &rruleVal, status, payload, updatedAt)},
		{"different startTime", computeCalendarEventETag(id, mailboxID, calendarID, startTime.Add(time.Second), endTime, isAllDay, &rruleVal, status, payload, updatedAt)},
		{"different endTime", computeCalendarEventETag(id, mailboxID, calendarID, startTime, endTime.Add(time.Second), isAllDay, &rruleVal, status, payload, updatedAt)},
		{"different isAllDay", computeCalendarEventETag(id, mailboxID, calendarID, startTime, endTime, true, &rruleVal, status, payload, updatedAt)},
		{"different rrule", computeCalendarEventETag(id, mailboxID, calendarID, startTime, endTime, isAllDay, func() *string { s := "FREQ=DAILY"; return &s }(), status, payload, updatedAt)},
		{"different status", computeCalendarEventETag(id, mailboxID, calendarID, startTime, endTime, isAllDay, &rruleVal, "tentative", payload, updatedAt)},
		{"different payload", computeCalendarEventETag(id, mailboxID, calendarID, startTime, endTime, isAllDay, &rruleVal, status, []byte("altered-payload"), updatedAt)},
		{"different updatedAt", computeCalendarEventETag(id, mailboxID, calendarID, startTime, endTime, isAllDay, &rruleVal, status, payload, updatedAt.Add(time.Second))},
	}

	for _, tc := range cases {
		if tc.etag == baseETag {
			t.Errorf("field sensitivity failure: %s produced identical ETag %s", tc.name, tc.etag)
		}
	}

	// 3. Null versus empty string versus literal null sentinels
	rruleCases := []struct {
		name string
		val  *string
	}{
		{"nil pointer", nil},
		{"empty string", func() *string { s := ""; return &s }()},
		{"magic <null>", func() *string { s := "<null>"; return &s }()},
		{"literal null", func() *string { s := "null"; return &s }()},
		{"literal N", func() *string { s := "N"; return &s }()},
		{"literal S0:", func() *string { s := "S0:"; return &s }()},
		{"literal |N", func() *string { s := "|N"; return &s }()},
	}
	etagMap := make(map[string]string)
	for _, rc := range rruleCases {
		et := computeCalendarEventETag(id, mailboxID, calendarID, startTime, endTime, isAllDay, rc.val, status, payload, updatedAt)
		if prevName, exists := etagMap[et]; exists {
			t.Fatalf("collision between %s and %s: both produced ETag %s", rc.name, prevName, et)
		}
		etagMap[et] = rc.name
	}

	// 4. Delimiter injection and field boundary collision resistance
	// Test that values containing delimiters or length prefixes cannot spoof adjacent field boundaries
	etagFieldBoundaryA := computeCalendarEventETag("prefix|S4:fake", mailboxID, calendarID, startTime, endTime, isAllDay, &rruleVal, status, payload, updatedAt)
	etagFieldBoundaryB := computeCalendarEventETag("prefix", "fake|S36:"+mailboxID, calendarID, startTime, endTime, isAllDay, &rruleVal, status, payload, updatedAt)
	if etagFieldBoundaryA == etagFieldBoundaryB {
		t.Fatalf("delimiter injection produced colliding ETags across field boundaries")
	}

	// 5. Timezone normalization: equivalent instant with different timezone offsets produces identical ETag
	locDhaka := time.FixedZone("Asia/Dhaka", 6*3600)
	locNY := time.FixedZone("America/New_York", -4*3600)

	startDhaka := startTime.In(locDhaka)
	endDhaka := endTime.In(locDhaka)
	updatedDhaka := updatedAt.In(locDhaka)

	startNY := startTime.In(locNY)
	endNY := endTime.In(locNY)
	updatedNY := updatedAt.In(locNY)

	etagUTC := computeCalendarEventETag(id, mailboxID, calendarID, startTime, endTime, isAllDay, &rruleVal, status, payload, updatedAt)
	etagDhaka := computeCalendarEventETag(id, mailboxID, calendarID, startDhaka, endDhaka, isAllDay, &rruleVal, status, payload, updatedDhaka)
	etagNY := computeCalendarEventETag(id, mailboxID, calendarID, startNY, endNY, isAllDay, &rruleVal, status, payload, updatedNY)

	if etagUTC != etagDhaka || etagUTC != etagNY {
		t.Fatalf("expected timezone-independent ETags, got UTC=%s, Dhaka=%s, NY=%s", etagUTC, etagDhaka, etagNY)
	}
}

func TestCalendarMailboxDeletionVsMigrationStagingConcurrency(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	ctx := context.Background()

	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
	token := createTestSession(t, db, ownerID)

	validEnvelope := make([]byte, 1+12+16)
	validEnvelope[0] = 0x01
	for i := 1; i < len(validEnvelope); i++ {
		validEnvelope[i] = byte(i)
	}
	validEnvelopeB64 := base64.StdEncoding.EncodeToString(validEnvelope)
	legacyRaw := `{"title":"Race Test Event","location":"Conf Room 1"}`

	// 1. Staging begins before mailbox deletion
	t.Run("Staging begins before mailbox deletion - Staging succeeds, deletion rejected", func(t *testing.T) {
		_, mbID := createTestMailbox(t, db, orgID, ownerID, "stagebefore")
		calRequest(t, http.MethodGet, mbID, "", "", token)

		var evID string
		_ = db.QueryRowContext(ctx, `
			INSERT INTO calendar_events (mailbox_id, calendar_id, start_time, end_time, is_all_day, status, encrypted_payload)
			VALUES ($1, (SELECT id FROM user_calendars WHERE mailbox_id=$1 LIMIT 1), now(), now() + interval '1 hour', false, 'busy', $2)
			RETURNING id`, mbID, []byte(legacyRaw)).Scan(&evID)

		w := calEventRequest(t, http.MethodGet, mbID, evID, "", "", token)
		etag := w.Header().Get("ETag")

		wStage := calMigrationRequest(t, "stage", mbID, evID, etag, fmt.Sprintf(`{"staged_encrypted_payload":"%s"}`, validEnvelopeB64), token)
		if wStage.Code != http.StatusOK {
			t.Fatalf("staging failed: %d: %s", wStage.Code, wStage.Body.String())
		}

		conn, err := pgx.Connect(ctx, getValidatedTestDSN(t))
		if err != nil {
			t.Fatalf("connect pgx: %v", err)
		}
		defer conn.Close(ctx)

		_, err = deleteMailbox(ctx, conn, orgID, mbID, ownerID)
		if err == nil || !strings.Contains(err.Error(), "active calendar event migrations in progress") {
			t.Fatalf("expected deleteMailbox error when staged migration exists, got: %v", err)
		}

		// Verify staged migration and event preserved, mailbox active
		var migStatus string
		var legacyPayload []byte
		_ = db.QueryRowContext(ctx, `SELECT status, legacy_payload FROM calendar_event_migrations WHERE mailbox_id=$1 AND event_id=$2`, mbID, evID).Scan(&migStatus, &legacyPayload)
		if migStatus != "staged" || string(legacyPayload) != legacyRaw {
			t.Fatalf("expected staged migration intact, got status=%s, payload=%s", migStatus, string(legacyPayload))
		}

		var isActive bool
		_ = db.QueryRowContext(ctx, `SELECT is_active FROM mailboxes WHERE id = $1`, mbID).Scan(&isActive)
		if !isActive {
			t.Fatalf("expected mailbox to remain active")
		}
	})

	// 2. Mailbox deletion begins before staging
	t.Run("Mailbox deletion begins before staging - Deletion succeeds, staging rejected", func(t *testing.T) {
		_, mbID := createTestMailbox(t, db, orgID, ownerID, "delbefore")
		calRequest(t, http.MethodGet, mbID, "", "", token)

		var evID string
		_ = db.QueryRowContext(ctx, `
			INSERT INTO calendar_events (mailbox_id, calendar_id, start_time, end_time, is_all_day, status, encrypted_payload)
			VALUES ($1, (SELECT id FROM user_calendars WHERE mailbox_id=$1 LIMIT 1), now(), now() + interval '1 hour', false, 'busy', $2)
			RETURNING id`, mbID, []byte(legacyRaw)).Scan(&evID)

		w := calEventRequest(t, http.MethodGet, mbID, evID, "", "", token)
		etag := w.Header().Get("ETag")

		conn, err := pgx.Connect(ctx, getValidatedTestDSN(t))
		if err != nil {
			t.Fatalf("connect pgx: %v", err)
		}
		defer conn.Close(ctx)

		_, err = deleteMailbox(ctx, conn, orgID, mbID, ownerID)
		if err != nil {
			t.Fatalf("deleteMailbox failed: %v", err)
		}

		// Attempt staging on deactivated mailbox
		wStage := calMigrationRequest(t, "stage", mbID, evID, etag, fmt.Sprintf(`{"staged_encrypted_payload":"%s"}`, validEnvelopeB64), token)
		if wStage.Code != http.StatusNotFound {
			t.Fatalf("expected 404 for staging on deactivated mailbox, got: %d: %s", wStage.Code, wStage.Body.String())
		}

		// Verify zero migration rows created
		var migCount int
		_ = db.QueryRowContext(ctx, `SELECT count(*) FROM calendar_event_migrations WHERE mailbox_id=$1`, mbID).Scan(&migCount)
		if migCount != 0 {
			t.Fatalf("expected 0 migration rows for deactivated mailbox, got %d", migCount)
		}
	})

	// 3. Both operations execute concurrently
	t.Run("Concurrent execution - Deterministic outcome without orphaned staged migration", func(t *testing.T) {
		_, mbID := createTestMailbox(t, db, orgID, ownerID, "concurrentmb")
		calRequest(t, http.MethodGet, mbID, "", "", token)

		var evID string
		_ = db.QueryRowContext(ctx, `
			INSERT INTO calendar_events (mailbox_id, calendar_id, start_time, end_time, is_all_day, status, encrypted_payload)
			VALUES ($1, (SELECT id FROM user_calendars WHERE mailbox_id=$1 LIMIT 1), now(), now() + interval '1 hour', false, 'busy', $2)
			RETURNING id`, mbID, []byte(legacyRaw)).Scan(&evID)

		w := calEventRequest(t, http.MethodGet, mbID, evID, "", "", token)
		etag := w.Header().Get("ETag")

		var wg sync.WaitGroup
		wg.Add(2)

		var stageCode int
		var stageBody string
		var deleteErr error

		startBarrier := make(chan struct{})

		// Goroutine A: Staging
		go func() {
			defer wg.Done()
			<-startBarrier
			res := calMigrationRequest(t, "stage", mbID, evID, etag, fmt.Sprintf(`{"staged_encrypted_payload":"%s"}`, validEnvelopeB64), token)
			stageCode = res.Code
			stageBody = res.Body.String()
		}()

		// Goroutine B: Deletion
		go func() {
			defer wg.Done()
			conn, err := pgx.Connect(ctx, getValidatedTestDSN(t))
			if err != nil {
				deleteErr = err
				return
			}
			defer conn.Close(ctx)

			<-startBarrier
			_, deleteErr = deleteMailbox(ctx, conn, orgID, mbID, ownerID)
		}()

		close(startBarrier)
		wg.Wait()

		var isActive bool
		_ = db.QueryRowContext(ctx, `SELECT is_active FROM mailboxes WHERE id = $1`, mbID).Scan(&isActive)

		var stagedCount int
		_ = db.QueryRowContext(ctx, `SELECT count(*) FROM calendar_event_migrations WHERE mailbox_id=$1 AND status='staged'`, mbID).Scan(&stagedCount)

		// Deterministic assertion:
		// Outcome 1: Staging committed first -> Staging was 200, deletion failed with error, mailbox is active, stagedCount == 1.
		// Outcome 2: Deletion committed first -> Deletion succeeded (err == nil), staging was 404, mailbox is inactive, stagedCount == 0.
		if isActive {
			if stageCode != http.StatusOK {
				t.Fatalf("active mailbox but staging failed: %d: %s", stageCode, stageBody)
			}
			if deleteErr == nil || !strings.Contains(deleteErr.Error(), "active calendar event migrations in progress") {
				t.Fatalf("active mailbox with staged migration expected deletion error, got: %v", deleteErr)
			}
			if stagedCount != 1 {
				t.Fatalf("expected exactly 1 staged migration, got %d", stagedCount)
			}
		} else {
			if deleteErr != nil {
				t.Fatalf("mailbox deactivated but deletion failed: %v", deleteErr)
			}
			if stageCode != http.StatusNotFound {
				t.Fatalf("mailbox deactivated but staging did not return 404, got: %d: %s", stageCode, stageBody)
			}
			if stagedCount != 0 {
				t.Fatalf("INVARIANT VIOLATION: deactivated mailbox received %d staged migration(s)!", stagedCount)
			}
		}
	})

	// 4. Mailbox deletion is retried after a staged migration exists
	t.Run("Mailbox deletion is retried after a staged migration exists", func(t *testing.T) {
		_, mbID := createTestMailbox(t, db, orgID, ownerID, "retrydel")
		calRequest(t, http.MethodGet, mbID, "", "", token)

		var evID string
		_ = db.QueryRowContext(ctx, `
			INSERT INTO calendar_events (mailbox_id, calendar_id, start_time, end_time, is_all_day, status, encrypted_payload)
			VALUES ($1, (SELECT id FROM user_calendars WHERE mailbox_id=$1 LIMIT 1), now(), now() + interval '1 hour', false, 'busy', $2)
			RETURNING id`, mbID, []byte(legacyRaw)).Scan(&evID)

		w := calEventRequest(t, http.MethodGet, mbID, evID, "", "", token)
		etag := w.Header().Get("ETag")

		wStage := calMigrationRequest(t, "stage", mbID, evID, etag, fmt.Sprintf(`{"staged_encrypted_payload":"%s"}`, validEnvelopeB64), token)
		if wStage.Code != http.StatusOK {
			t.Fatalf("staging failed: %d", wStage.Code)
		}

		conn, err := pgx.Connect(ctx, getValidatedTestDSN(t))
		if err != nil {
			t.Fatalf("connect pgx: %v", err)
		}
		defer conn.Close(ctx)

		// Initial deletion attempt
		_, err1 := deleteMailbox(ctx, conn, orgID, mbID, ownerID)
		if err1 == nil || !strings.Contains(err1.Error(), "active calendar event migrations in progress") {
			t.Fatalf("attempt 1: expected deletion error, got: %v", err1)
		}

		// Retry 1
		_, err2 := deleteMailbox(ctx, conn, orgID, mbID, ownerID)
		if err2 == nil || !strings.Contains(err2.Error(), "active calendar event migrations in progress") {
			t.Fatalf("retry 1: expected deletion error, got: %v", err2)
		}

		// Retry 2
		_, err3 := deleteMailbox(ctx, conn, orgID, mbID, ownerID)
		if err3 == nil || !strings.Contains(err3.Error(), "active calendar event migrations in progress") {
			t.Fatalf("retry 2: expected deletion error, got: %v", err3)
		}

		// Assert mailbox is still active and staged migration preserved
		var isActive bool
		_ = db.QueryRowContext(ctx, `SELECT is_active FROM mailboxes WHERE id = $1`, mbID).Scan(&isActive)
		if !isActive {
			t.Fatalf("expected mailbox to remain active after retried deletions")
		}

		var migStatus string
		_ = db.QueryRowContext(ctx, `SELECT status FROM calendar_event_migrations WHERE mailbox_id=$1 AND event_id=$2`, mbID, evID).Scan(&migStatus)
		if migStatus != "staged" {
			t.Fatalf("expected migration to remain staged, got %s", migStatus)
		}
	})

	// 5. A deactivated mailbox cannot begin a new migration, check status, finalize, or rollback
	t.Run("Deactivated mailbox rejects stage, status, finalize, and rollback", func(t *testing.T) {
		_, mbID := createTestMailbox(t, db, orgID, ownerID, "deactivatedall")
		calRequest(t, http.MethodGet, mbID, "", "", token)

		var evID string
		_ = db.QueryRowContext(ctx, `
			INSERT INTO calendar_events (mailbox_id, calendar_id, start_time, end_time, is_all_day, status, encrypted_payload)
			VALUES ($1, (SELECT id FROM user_calendars WHERE mailbox_id=$1 LIMIT 1), now(), now() + interval '1 hour', false, 'busy', $2)
			RETURNING id`, mbID, []byte(legacyRaw)).Scan(&evID)

		w := calEventRequest(t, http.MethodGet, mbID, evID, "", "", token)
		etag := w.Header().Get("ETag")

		conn, err := pgx.Connect(ctx, getValidatedTestDSN(t))
		if err != nil {
			t.Fatalf("connect pgx: %v", err)
		}
		defer conn.Close(ctx)

		// Deactivate mailbox
		_, err = deleteMailbox(ctx, conn, orgID, mbID, ownerID)
		if err != nil {
			t.Fatalf("deleteMailbox failed: %v", err)
		}

		// 1. Stage
		wStage := calMigrationRequest(t, "stage", mbID, evID, etag, fmt.Sprintf(`{"staged_encrypted_payload":"%s"}`, validEnvelopeB64), token)
		if wStage.Code != http.StatusNotFound {
			t.Fatalf("expected 404 for stage on deactivated mailbox, got: %d: %s", wStage.Code, wStage.Body.String())
		}

		// 2. Status
		wStatus := calMigrationRequest(t, "status", mbID, evID, "", "", token)
		if wStatus.Code != http.StatusNotFound {
			t.Fatalf("expected 404 for status on deactivated mailbox, got: %d: %s", wStatus.Code, wStatus.Body.String())
		}

		// 3. Finalize
		wFinalize := calMigrationRequest(t, "finalize", mbID, evID, "", `{"migration_id":"00000000-0000-0000-0000-000000000001"}`, token)
		if wFinalize.Code != http.StatusNotFound {
			t.Fatalf("expected 404 for finalize on deactivated mailbox, got: %d: %s", wFinalize.Code, wFinalize.Body.String())
		}

		// 4. Rollback
		wRollback := calMigrationRequest(t, "rollback", mbID, evID, "", `{"migration_id":"00000000-0000-0000-0000-000000000001"}`, token)
		if wRollback.Code != http.StatusNotFound {
			t.Fatalf("expected 404 for rollback on deactivated mailbox, got: %d: %s", wRollback.Code, wRollback.Body.String())
		}

		// Verify zero migration records exist
		var totalMigs int
		_ = db.QueryRowContext(ctx, `SELECT count(*) FROM calendar_event_migrations WHERE mailbox_id=$1`, mbID).Scan(&totalMigs)
		if totalMigs != 0 {
			t.Fatalf("expected 0 migration records for deactivated mailbox, got %d", totalMigs)
		}
	})
}

func calExceptionRequest(t *testing.T, method, mailboxID, eventID, exceptionID, body, token string) *httptest.ResponseRecorder {
	t.Helper()
	url := "/v1/mailboxes/" + mailboxID + "/calendar-events/" + eventID + "/exceptions"
	if exceptionID != "" {
		url += "/" + exceptionID
	}
	req := httptest.NewRequest(method, url, bytes.NewBufferString(body))
	req.SetPathValue("mailbox_id", mailboxID)
	req.SetPathValue("event_id", eventID)
	if exceptionID != "" {
		req.SetPathValue("exception_id", exceptionID)
	}
	if token != "" {
		req.AddCookie(&http.Cookie{Name: "byos_session", Value: token, Path: "/"})
	}
	w := httptest.NewRecorder()
	calendarEventExceptionsHandler(w, req)
	return w
}

func TestCalendarRecurrenceExceptionsLifecycle(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()
	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
	_, mailboxID := createTestMailbox(t, db, orgID, ownerID, "recurexcuser")
	token := createTestSession(t, db, ownerID)

	// Ensure default calendar
	wCal := calRequest(t, http.MethodGet, mailboxID, "", "", token)
	if wCal.Code != http.StatusOK {
		t.Fatalf("get calendars: expected 200, got %d", wCal.Code)
	}
	var calendars []UserCalendar
	_ = json.NewDecoder(wCal.Body).Decode(&calendars)
	calID := calendars[0].ID

	// Create a recurring parent event (every Monday)
	now := time.Now().UTC().Truncate(time.Hour)
	startStr := now.Format(time.RFC3339)
	endStr := now.Add(1 * time.Hour).Format(time.RFC3339)

	validEnvelope := make([]byte, 29)
	validEnvelope[0] = 0x01
	for i := 1; i <= 12; i++ {
		validEnvelope[i] = byte(i)
	}
	for i := 13; i < 29; i++ {
		validEnvelope[i] = 0xAA
	}
	payloadB64 := base64.StdEncoding.EncodeToString(validEnvelope)

	createEventJSON := fmt.Sprintf(`{
		"calendar_id": "%s",
		"start_time": "%s",
		"end_time": "%s",
		"is_all_day": false,
		"rrule": "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO",
		"status": "busy",
		"encrypted_payload": "%s"
	}`, calID, startStr, endStr, payloadB64)

	wEv := calEventRequest(t, http.MethodPost, mailboxID, "", "", createEventJSON, token)
	if wEv.Code != http.StatusCreated {
		t.Fatalf("create recurring event: expected 201, got %d: %s", wEv.Code, wEv.Body.String())
	}
	var parentEv CalendarEvent
	_ = json.NewDecoder(wEv.Body).Decode(&parentEv)
	eventID := parentEv.ID

	// 1. Create modified exception for occurrence 1
	recurrenceID1 := now.AddDate(0, 0, 7).Format(time.RFC3339)
	modStart1 := now.AddDate(0, 0, 7).Add(2 * time.Hour).Format(time.RFC3339)
	modEnd1 := now.AddDate(0, 0, 7).Add(3 * time.Hour).Format(time.RFC3339)

	createExc1JSON := fmt.Sprintf(`{
		"recurrence_id": "%s",
		"is_cancelled": false,
		"start_time": "%s",
		"end_time": "%s",
		"is_all_day": false,
		"status": "busy",
		"encrypted_payload": "%s"
	}`, recurrenceID1, modStart1, modEnd1, payloadB64)

	wExc1 := calExceptionRequest(t, http.MethodPost, mailboxID, eventID, "", createExc1JSON, token)
	if wExc1.Code != http.StatusCreated {
		t.Fatalf("create exception 1: expected 201, got %d: %s", wExc1.Code, wExc1.Body.String())
	}
	var exc1 CalendarEventException
	_ = json.NewDecoder(wExc1.Body).Decode(&exc1)
	if exc1.RecurrenceID != recurrenceID1 || exc1.IsCancelled != false {
		t.Fatalf("unexpected exception 1: %+v", exc1)
	}

	// 2. Create cancelled exception for occurrence 2
	recurrenceID2 := now.AddDate(0, 0, 14).Format(time.RFC3339)
	createExc2JSON := fmt.Sprintf(`{
		"recurrence_id": "%s",
		"is_cancelled": true,
		"start_time": "%s",
		"end_time": "%s",
		"is_all_day": false,
		"status": "free",
		"encrypted_payload": "%s"
	}`, recurrenceID2, recurrenceID2, now.AddDate(0, 0, 14).Add(1*time.Hour).Format(time.RFC3339), payloadB64)

	wExc2 := calExceptionRequest(t, http.MethodPost, mailboxID, eventID, "", createExc2JSON, token)
	if wExc2.Code != http.StatusCreated {
		t.Fatalf("create exception 2: expected 201, got %d: %s", wExc2.Code, wExc2.Body.String())
	}
	var exc2 CalendarEventException
	_ = json.NewDecoder(wExc2.Body).Decode(&exc2)
	if exc2.RecurrenceID != recurrenceID2 || exc2.IsCancelled != true {
		t.Fatalf("unexpected exception 2: %+v", exc2)
	}

	// 3. GET parent event directly - must embed both exceptions
	wGetEv := calEventRequest(t, http.MethodGet, mailboxID, eventID, "", "", token)
	if wGetEv.Code != http.StatusOK {
		t.Fatalf("get parent event: expected 200, got %d: %s", wGetEv.Code, wGetEv.Body.String())
	}
	var gotParentEv CalendarEvent
	_ = json.NewDecoder(wGetEv.Body).Decode(&gotParentEv)
	if len(gotParentEv.Exceptions) != 2 {
		t.Fatalf("expected 2 exceptions embedded in parent event, got %d", len(gotParentEv.Exceptions))
	}

	// 4. GET list events - must embed exceptions for recurring events
	wList := calEventRequest(t, http.MethodGet, mailboxID, "", fmt.Sprintf("start=%s&end=%s", now.AddDate(0, 0, -1).Format(time.RFC3339), now.AddDate(0, 0, 30).Format(time.RFC3339)), "", token)
	if wList.Code != http.StatusOK {
		t.Fatalf("list events: expected 200, got %d", wList.Code)
	}
	var evList []CalendarEvent
	_ = json.NewDecoder(wList.Body).Decode(&evList)
	foundParent := false
	for _, e := range evList {
		if e.ID == eventID {
			foundParent = true
			if len(e.Exceptions) != 2 {
				t.Fatalf("expected 2 exceptions in list query, got %d", len(e.Exceptions))
			}
		}
	}
	if !foundParent {
		t.Fatalf("parent event not found in list events response")
	}

	// 5. GET exceptions endpoint directly
	wListExc := calExceptionRequest(t, http.MethodGet, mailboxID, eventID, "", "", token)
	if wListExc.Code != http.StatusOK {
		t.Fatalf("list exceptions endpoint: expected 200, got %d", wListExc.Code)
	}
	var excList []CalendarEventException
	_ = json.NewDecoder(wListExc.Body).Decode(&excList)
	if len(excList) != 2 {
		t.Fatalf("expected 2 exceptions from endpoint, got %d", len(excList))
	}

	// 6. Idempotent upsert: POST with existing recurrence_id updates rather than fails
	updateExc1JSON := fmt.Sprintf(`{
		"recurrence_id": "%s",
		"is_cancelled": false,
		"start_time": "%s",
		"end_time": "%s",
		"is_all_day": false,
		"status": "tentative",
		"encrypted_payload": "%s"
	}`, recurrenceID1, modStart1, modEnd1, payloadB64)

	wUpsert := calExceptionRequest(t, http.MethodPost, mailboxID, eventID, "", updateExc1JSON, token)
	if wUpsert.Code != http.StatusCreated {
		t.Fatalf("upsert exception 1: expected 201, got %d: %s", wUpsert.Code, wUpsert.Body.String())
	}
	var upsertedExc CalendarEventException
	_ = json.NewDecoder(wUpsert.Body).Decode(&upsertedExc)
	if upsertedExc.ID != exc1.ID || upsertedExc.Status != "tentative" {
		t.Fatalf("unexpected upserted exception: %+v", upsertedExc)
	}

	// 7. Isolation check: another org/user cannot access exceptions
	_, otherOwnerID, _, _ := createTestOrgAndUsers(t, db)
	otherToken := createTestSession(t, db, otherOwnerID)
	wForbidden := calExceptionRequest(t, http.MethodGet, mailboxID, eventID, "", "", otherToken)
	if wForbidden.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for cross-org user, got %d", wForbidden.Code)
	}

	// 8. Delete individual exception reverts occurrence back to series
	wDelExc := calExceptionRequest(t, http.MethodDelete, mailboxID, eventID, exc1.ID, "", token)
	if wDelExc.Code != http.StatusNoContent {
		t.Fatalf("delete exception 1: expected 204, got %d: %s", wDelExc.Code, wDelExc.Body.String())
	}
	// Verify only 1 exception remains
	wCheckExc := calExceptionRequest(t, http.MethodGet, mailboxID, eventID, "", "", token)
	var remainExc []CalendarEventException
	_ = json.NewDecoder(wCheckExc.Body).Decode(&remainExc)
	if len(remainExc) != 1 || remainExc[0].ID != exc2.ID {
		t.Fatalf("expected 1 remaining exception (exc2), got %d", len(remainExc))
	}

	// 9. Cascade check: deleting parent event cascades to delete all child exceptions
	wDelParent := calEventRequest(t, http.MethodDelete, mailboxID, eventID, "", "", token)
	if wDelParent.Code != http.StatusNoContent {
		t.Fatalf("delete parent event: expected 204, got %d: %s", wDelParent.Code, wDelParent.Body.String())
	}

	var excCount int
	_ = db.QueryRow(`SELECT count(*) FROM calendar_event_exceptions WHERE parent_event_id=$1`, eventID).Scan(&excCount)
	if excCount != 0 {
		t.Fatalf("expected 0 orphaned exceptions after parent deletion cascade, got %d", excCount)
	}
}

func calShareRequest(t *testing.T, method, mailboxID, calendarID, shareID, body, token string) *httptest.ResponseRecorder {
	t.Helper()
	url := "/v1/mailboxes/" + mailboxID + "/calendars/" + calendarID + "/shares"
	if shareID != "" {
		url += "/" + shareID
	}
	req := httptest.NewRequest(method, url, bytes.NewBufferString(body))
	req.SetPathValue("mailbox_id", mailboxID)
	req.SetPathValue("calendar_id", calendarID)
	if shareID != "" {
		req.SetPathValue("share_id", shareID)
	}
	if token != "" {
		req.AddCookie(&http.Cookie{Name: "byos_session", Value: token, Path: "/"})
	}
	w := httptest.NewRecorder()
	calendarSharesHandler(w, req)
	return w
}

func TestCalendarSharingAndPermissions(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	// 1. Create Organization 1 with Alice and Bob
	orgID, aliceUserID, _, _ := createTestOrgAndUsers(t, db)
	domainID, aliceMailboxID := createTestMailbox(t, db, orgID, aliceUserID, "alice")
	tokenAlice := createTestSession(t, db, aliceUserID)

	// Create Bob in Org 1
	var bobUserID string
	err := db.QueryRow(`
		INSERT INTO users (org_id, email, password_hash, role, is_active)
		VALUES ($1, 'bob@test.local', 'hash', 'member', true)
		RETURNING id::text`, orgID).Scan(&bobUserID)
	if err != nil {
		t.Fatalf("create bob user: %v", err)
	}
	var bobMailboxID string
	err = db.QueryRow(`
		INSERT INTO mailboxes (org_id, user_id, domain_id, local_part, is_active)
		VALUES ($1, $2, $3, 'bob', true)
		RETURNING id::text`, orgID, bobUserID, domainID).Scan(&bobMailboxID)
	if err != nil {
		t.Fatalf("create bob mailbox: %v", err)
	}
	tokenBob := createTestSession(t, db, bobUserID)

	// 2. Create Organization 2 with Carol (Cross-tenant user)
	orgID2, carolUserID, _, _ := createTestOrgAndUsers(t, db)
	_, carolMailboxID := createTestMailbox(t, db, orgID2, carolUserID, "carol")
	_ = createTestSession(t, db, carolUserID)

	// 3. Alice creates a calendar "Engineering Roadmap"
	wCal := calRequest(t, http.MethodPost, aliceMailboxID, "", `{"name":"Engineering Roadmap","color":"#2C4C6E","is_default":false}`, tokenAlice)
	if wCal.Code != http.StatusCreated {
		t.Fatalf("create calendar: expected 201, got %d: %s", wCal.Code, wCal.Body.String())
	}
	var sharedCal UserCalendar
	if err := json.NewDecoder(wCal.Body).Decode(&sharedCal); err != nil {
		t.Fatalf("decode sharedCal: %v", err)
	}
	calendarID := sharedCal.ID

	// 4. Test Cross-Tenant Sharing Rejection:
	// Alice attempts to share with Carol (different org) -> must fail with 403 Forbidden
	var carolEmail string
	_ = db.QueryRow(`SELECT m.local_part || '@' || d.name FROM mailboxes m JOIN domains d ON d.id=m.domain_id WHERE m.id=$1`, carolMailboxID).Scan(&carolEmail)
	wCross := calShareRequest(t, http.MethodPost, aliceMailboxID, calendarID, "", fmt.Sprintf(`{"grantee_email":%q,"permission":"read"}`, carolEmail), tokenAlice)
	if wCross.Code != http.StatusForbidden {
		t.Fatalf("cross-org share: expected 403, got %d: %s", wCross.Code, wCross.Body.String())
	}

	// 5. Test Self-Sharing Rejection:
	// Alice attempts to share calendar with herself -> must fail with 400 Bad Request
	var aliceEmail string
	_ = db.QueryRow(`SELECT m.local_part || '@' || d.name FROM mailboxes m JOIN domains d ON d.id=m.domain_id WHERE m.id=$1`, aliceMailboxID).Scan(&aliceEmail)
	wSelf := calShareRequest(t, http.MethodPost, aliceMailboxID, calendarID, "", fmt.Sprintf(`{"grantee_email":%q,"permission":"read"}`, aliceEmail), tokenAlice)
	if wSelf.Code != http.StatusBadRequest {
		t.Fatalf("self share: expected 400, got %d: %s", wSelf.Code, wSelf.Body.String())
	}

	// 6. Alice shares calendar with Bob with "read" permission and zero-knowledge key envelope
	var bobEmail string
	_ = db.QueryRow(`SELECT m.local_part || '@' || d.name FROM mailboxes m JOIN domains d ON d.id=m.domain_id WHERE m.id=$1`, bobMailboxID).Scan(&bobEmail)
	wShare := calShareRequest(t, http.MethodPost, aliceMailboxID, calendarID, "", fmt.Sprintf(`{"grantee_email":%q,"permission":"read","encrypted_key":"test_sealed_cal_key_envelope"}`, bobEmail), tokenAlice)
	if wShare.Code != http.StatusCreated {
		t.Fatalf("share calendar with bob: expected 201, got %d: %s", wShare.Code, wShare.Body.String())
	}
	var share CalendarShare
	if err := json.NewDecoder(wShare.Body).Decode(&share); err != nil {
		t.Fatalf("decode share: %v", err)
	}
	if share.Permission != "read" || share.GranteeEmail != bobEmail || share.EncryptedKey != "test_sealed_cal_key_envelope" {
		t.Fatalf("unexpected share response: %+v", share)
	}

	// 7. Bob lists calendars: Bob sees "Engineering Roadmap" in his calendars as shared with read permission
	wBobCals := calRequest(t, http.MethodGet, bobMailboxID, "", "", tokenBob)
	if wBobCals.Code != http.StatusOK {
		t.Fatalf("bob get calendars: expected 200, got %d: %s", wBobCals.Code, wBobCals.Body.String())
	}
	var bobCals []UserCalendar
	_ = json.NewDecoder(wBobCals.Body).Decode(&bobCals)
	var foundSharedCal *UserCalendar
	for _, c := range bobCals {
		if c.ID == calendarID {
			foundSharedCal = &c
			break
		}
	}
	if foundSharedCal == nil {
		t.Fatalf("shared calendar not found in bob's calendar list: %+v", bobCals)
	}
	if !foundSharedCal.IsShared || foundSharedCal.Permission != "read" || foundSharedCal.EncryptedKey == nil || *foundSharedCal.EncryptedKey != "test_sealed_cal_key_envelope" {
		t.Fatalf("bob's view of shared calendar has invalid metadata: %+v", *foundSharedCal)
	}

	// 8. Alice creates an event on "Engineering Roadmap" ("Sprint Planning")
	now := time.Now().UTC().Truncate(time.Second)
	validEnvelope := make([]byte, 29)
	validEnvelope[0] = 0x01
	for i := 1; i < 29; i++ {
		validEnvelope[i] = byte(i)
	}
	payloadB64 := base64.StdEncoding.EncodeToString(validEnvelope)
	wEv := calEventRequest(t, http.MethodPost, aliceMailboxID, "", "", fmt.Sprintf(`{
		"calendar_id": %q,
		"start_time": %q,
		"end_time": %q,
		"status": "busy",
		"encrypted_payload": %q
	}`, calendarID, now.Format(time.RFC3339), now.Add(time.Hour).Format(time.RFC3339), payloadB64), tokenAlice)
	if wEv.Code != http.StatusCreated {
		t.Fatalf("alice create event on shared cal: expected 201, got %d: %s", wEv.Code, wEv.Body.String())
	}
	var eventAlice CalendarEvent
	_ = json.NewDecoder(wEv.Body).Decode(&eventAlice)

	// 9. Bob queries events: Bob sees Alice's event on the shared calendar
	wBobEvs := calEventRequest(t, http.MethodGet, bobMailboxID, "", "", "", tokenBob)
	if wBobEvs.Code != http.StatusOK {
		t.Fatalf("bob get events: expected 200, got %d: %s", wBobEvs.Code, wBobEvs.Body.String())
	}
	var bobEvs []CalendarEvent
	_ = json.NewDecoder(wBobEvs.Body).Decode(&bobEvs)
	foundBobEv := false
	for _, e := range bobEvs {
		if e.ID == eventAlice.ID {
			foundBobEv = true
			break
		}
	}
	if !foundBobEv {
		t.Fatalf("expected bob to see alice's event on shared calendar, got %d events: %+v", len(bobEvs), bobEvs)
	}

	// 10. Read-Only Enforcement:
	// 10a. Bob attempts to create an event on the read-only shared calendar -> MUST return 403 Forbidden
	wBobCreate := calEventRequest(t, http.MethodPost, bobMailboxID, "", "", fmt.Sprintf(`{
		"calendar_id": %q,
		"start_time": %q,
		"end_time": %q,
		"status": "busy",
		"encrypted_payload": %q
	}`, calendarID, now.Add(2*time.Hour).Format(time.RFC3339), now.Add(3*time.Hour).Format(time.RFC3339), payloadB64), tokenBob)
	if wBobCreate.Code != http.StatusForbidden {
		t.Fatalf("bob create on read-only cal: expected 403, got %d: %s", wBobCreate.Code, wBobCreate.Body.String())
	}
	if !strings.Contains(wBobCreate.Body.String(), "read_only_calendar") {
		t.Fatalf("expected read_only_calendar error, got %s", wBobCreate.Body.String())
	}

	// 10b. Bob attempts to update Alice's event -> MUST return 403 Forbidden
	wBobUpdate := calEventRequest(t, http.MethodPatch, bobMailboxID, eventAlice.ID, "", `{"status":"free"}`, tokenBob)
	if wBobUpdate.Code != http.StatusForbidden {
		t.Fatalf("bob update on read-only cal: expected 403, got %d: %s", wBobUpdate.Code, wBobUpdate.Body.String())
	}

	// 10c. Bob attempts to delete Alice's event -> MUST return 403 Forbidden
	wBobDel := calEventRequest(t, http.MethodDelete, bobMailboxID, eventAlice.ID, "", "", tokenBob)
	if wBobDel.Code != http.StatusForbidden {
		t.Fatalf("bob delete on read-only cal: expected 403, got %d: %s", wBobDel.Code, wBobDel.Body.String())
	}

	// 10d. Bob attempts to delete Alice's calendar -> MUST return 403 Forbidden
	wBobDelCal := calRequest(t, http.MethodDelete, bobMailboxID, calendarID, "", tokenBob)
	if wBobDelCal.Code != http.StatusForbidden {
		t.Fatalf("bob delete alice's calendar: expected 403, got %d: %s", wBobDelCal.Code, wBobDelCal.Body.String())
	}

	// 11. Read-Write Permissions Upgrade:
	// Alice promotes Bob to "write" permission
	wUpgrade := calShareRequest(t, http.MethodPatch, aliceMailboxID, calendarID, share.ID, `{"permission":"write"}`, tokenAlice)
	if wUpgrade.Code != http.StatusOK {
		t.Fatalf("upgrade share to write: expected 200, got %d: %s", wUpgrade.Code, wUpgrade.Body.String())
	}

	// 12. Bob can now create an event on "Engineering Roadmap" ("Architecture Review")
	bobEnvelope := make([]byte, 29)
	bobEnvelope[0] = 0x01
	for i := 1; i < 29; i++ {
		bobEnvelope[i] = byte(0xF0 + i)
	}
	bobPayloadB64 := base64.StdEncoding.EncodeToString(bobEnvelope)
	wBobWrite := calEventRequest(t, http.MethodPost, bobMailboxID, "", "", fmt.Sprintf(`{
		"calendar_id": %q,
		"start_time": %q,
		"end_time": %q,
		"status": "busy",
		"encrypted_payload": %q
	}`, calendarID, now.Add(4*time.Hour).Format(time.RFC3339), now.Add(5*time.Hour).Format(time.RFC3339), bobPayloadB64), tokenBob)
	if wBobWrite.Code != http.StatusCreated {
		t.Fatalf("bob create event on write cal: expected 201, got %d: %s", wBobWrite.Code, wBobWrite.Body.String())
	}
	var bobEvent CalendarEvent
	_ = json.NewDecoder(wBobWrite.Body).Decode(&bobEvent)

	// 13. Alice queries events: Alice sees Bob's created event!
	wAliceEvs := calEventRequest(t, http.MethodGet, aliceMailboxID, "", "", "", tokenAlice)
	if wAliceEvs.Code != http.StatusOK {
		t.Fatalf("alice get events: expected 200, got %d", wAliceEvs.Code)
	}
	var aliceEvs []CalendarEvent
	_ = json.NewDecoder(wAliceEvs.Body).Decode(&aliceEvs)
	foundAliceSeesBob := false
	for _, e := range aliceEvs {
		if e.ID == bobEvent.ID {
			foundAliceSeesBob = true
			break
		}
	}
	if !foundAliceSeesBob {
		t.Fatalf("expected alice to see bob's event on shared calendar, got %+v", aliceEvs)
	}

	// 14. Bob updates the event
	wBobPatch := calEventRequest(t, http.MethodPatch, bobMailboxID, bobEvent.ID, "", `{"status":"tentative"}`, tokenBob)
	if wBobPatch.Code != http.StatusOK {
		t.Fatalf("bob patch on write cal: expected 200, got %d: %s", wBobPatch.Code, wBobPatch.Body.String())
	}

	// 15. Bob deletes the event
	wBobDeleteEv := calEventRequest(t, http.MethodDelete, bobMailboxID, bobEvent.ID, "", "", tokenBob)
	if wBobDeleteEv.Code != http.StatusNoContent {
		t.Fatalf("bob delete on write cal: expected 204, got %d: %s", wBobDeleteEv.Code, wBobDeleteEv.Body.String())
	}

	// 16. Alice revokes Bob's share
	wRevoke := calShareRequest(t, http.MethodDelete, aliceMailboxID, calendarID, share.ID, "", tokenAlice)
	if wRevoke.Code != http.StatusNoContent {
		t.Fatalf("revoke share: expected 204, got %d: %s", wRevoke.Code, wRevoke.Body.String())
	}

	// 17. Bob verifies revoked state:
	// Calendar is no longer in Bob's calendar list
	wBobCalsPost := calRequest(t, http.MethodGet, bobMailboxID, "", "", tokenBob)
	var bobCalsPost []UserCalendar
	_ = json.NewDecoder(wBobCalsPost.Body).Decode(&bobCalsPost)
	for _, c := range bobCalsPost {
		if c.ID == calendarID {
			t.Fatalf("revoked calendar still present in bob's calendar list: %+v", c)
		}
	}
	// Alice's events are no longer visible in Bob's events query
	wBobEvsPost := calEventRequest(t, http.MethodGet, bobMailboxID, "", "", "", tokenBob)
	var bobEvsPost []CalendarEvent
	_ = json.NewDecoder(wBobEvsPost.Body).Decode(&bobEvsPost)
	for _, e := range bobEvsPost {
		if e.ID == eventAlice.ID {
			t.Fatalf("alice's event still visible to bob after share revocation: %+v", e)
		}
	}
}
