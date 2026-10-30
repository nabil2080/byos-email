package main

import (
	"bytes"
	"database/sql"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
)

// Helper to create a test user with a password and valid mailbox
func createCalDavTestUser(t *testing.T, db *sql.DB, tag, password string) (orgID, userID, mailboxID, email string) {
	t.Helper()

	err := db.QueryRow(`
		INSERT INTO organizations (name, org_recovery_pk)
		VALUES ($1, decode('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', 'base64'))
		RETURNING id
	`, "CalDav Org "+tag).Scan(&orgID)
	if err != nil {
		t.Fatalf("insert org: %v", err)
	}

	pwHash, err := hashPassword(password)
	if err != nil {
		t.Fatalf("hash password: %v", err)
	}

	email = fmt.Sprintf("caluser-%s@example.com", tag)
	err = db.QueryRow(`
		INSERT INTO users (org_id, email, password_hash, is_active)
		VALUES ($1, $2, $3, true)
		RETURNING id
	`, orgID, email, pwHash).Scan(&userID)
	if err != nil {
		t.Fatalf("insert user: %v", err)
	}

	var domainID string
	err = db.QueryRow(`
		INSERT INTO domains (org_id, name, is_verified)
		VALUES ($1, $2, true)
		RETURNING id
	`, orgID, "example-"+tag+".com").Scan(&domainID)
	if err != nil {
		t.Fatalf("insert domain: %v", err)
	}

	// Generate a valid wrapped_sk_user JSON
	dummySaltHex := "11223344556677889900aabbccddeeff"
	dummyEnvelopeHex := "011fc06bae73261158573361bb6f6bb4820e052533f17005ad9165ddeefd82e16d9068a452dbc12446aa077cc541d6c6997c5a0302db015e780714bde5"
	wrappedSkUserJSON := fmt.Sprintf(`{"salt":"%s","envelope":"%s"}`, dummySaltHex, dummyEnvelopeHex)

	err = db.QueryRow(`
		INSERT INTO mailboxes (org_id, user_id, domain_id, local_part, mode, mailbox_sk_wrapped, mailbox_pk, wrapped_sk_user, is_active)
		VALUES ($1, $2, $3, $4, 'private', decode('AA==','base64'), decode('AA==','base64'), $5, true)
		RETURNING id
	`, orgID, userID, domainID, "calbox-"+tag, wrappedSkUserJSON).Scan(&mailboxID)
	if err != nil {
		t.Fatalf("insert mailbox: %v", err)
	}

	return orgID, userID, mailboxID, email
}

func basicAuthHeader(user, pass string) string {
	cred := user + ":" + pass
	return "Basic " + base64.StdEncoding.EncodeToString([]byte(cred))
}

func calDavRequest(method, targetPath, body, authHeader string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, targetPath, bytes.NewBufferString(body))
	if authHeader != "" {
		req.Header.Set("Authorization", authHeader)
	}
	if strings.HasPrefix(body, "BEGIN:VCALENDAR") {
		req.Header.Set("Content-Type", "text/calendar; charset=utf-8")
	} else if strings.HasPrefix(body, "<") {
		req.Header.Set("Content-Type", "application/xml; charset=utf-8")
	}

	w := httptest.NewRecorder()

	// Dispatch using the exact route patterns registered in main.go
	if targetPath == "/.well-known/caldav" {
		calDavWellKnownHandler(w, req)
	} else if strings.HasPrefix(targetPath, "/dav/principals") {
		calDavPrincipalHandler(w, req)
	} else if strings.HasPrefix(targetPath, "/dav/calendars/") {
		trimmed := strings.TrimPrefix(targetPath, "/dav/calendars/")
		parts := strings.Split(trimmed, "/")
		// parts: [0: mailbox_id, 1: calendar_id, 2: resource_name]
		if len(parts) == 1 || (len(parts) == 2 && parts[1] == "") {
			req.SetPathValue("mailbox_id", parts[0])
			calDavHomeHandler(w, req)
		} else if len(parts) == 2 || (len(parts) == 3 && parts[2] == "") {
			req.SetPathValue("mailbox_id", parts[0])
			req.SetPathValue("calendar_id", parts[1])
			calDavCollectionHandler(w, req)
		} else if len(parts) >= 3 {
			req.SetPathValue("mailbox_id", parts[0])
			req.SetPathValue("calendar_id", parts[1])
			req.SetPathValue("resource_name", parts[2])
			calDavResourceHandler(w, req)
		}
	} else {
		http.NotFound(w, req)
	}

	return w
}

func TestCalDavWellKnown(t *testing.T) {
	// 1. GET returns 301 Moved Permanently redirect to /dav/principals/
	w := calDavRequest("GET", "/.well-known/caldav", "", "")
	if w.Code != http.StatusMovedPermanently {
		t.Fatalf("expected 301, got %d: %s", w.Code, w.Body.String())
	}
	loc := w.Header().Get("Location")
	if loc != "/dav/principals/" {
		t.Fatalf("expected Location /dav/principals/, got %q", loc)
	}

	// 2. OPTIONS returns 200 OK with DAV headers
	wOpt := calDavRequest("OPTIONS", "/.well-known/caldav", "", "")
	if wOpt.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", wOpt.Code)
	}
	dav := wOpt.Header().Get("DAV")
	if !strings.Contains(dav, "calendar-access") {
		t.Fatalf("expected DAV header to contain calendar-access, got %q", dav)
	}
}

func TestCalDavAuthenticationAndPrincipal(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	tag := uuid.New().String()[:8]
	password := "SecretPass123!"
	_, _, mailboxID, email := createCalDavTestUser(t, db, tag, password)

	// 1. Unauthenticated request to /dav/principals/ must return 401 with WWW-Authenticate header
	wUnauth := calDavRequest("PROPFIND", "/dav/principals/", "", "")
	if wUnauth.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 Unauthorized, got %d: %s", wUnauth.Code, wUnauth.Body.String())
	}
	authHdr := wUnauth.Header().Get("WWW-Authenticate")
	if !strings.Contains(authHdr, "Basic") {
		t.Fatalf("expected WWW-Authenticate: Basic, got %q", authHdr)
	}

	// 2. Invalid password returns 401
	badAuth := basicAuthHeader(email, "WrongPassword!")
	wBad := calDavRequest("PROPFIND", "/dav/principals/", "", badAuth)
	if wBad.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for wrong password, got %d", wBad.Code)
	}

	// 3. Valid credentials return 207 Multi-Status with principal and calendar-home-set
	goodAuth := basicAuthHeader(email, password)
	wGood := calDavRequest("PROPFIND", "/dav/principals/", "", goodAuth)
	if wGood.Code != http.StatusMultiStatus {
		t.Fatalf("expected 207 Multi-Status, got %d: %s", wGood.Code, wGood.Body.String())
	}
	body := wGood.Body.String()
	if !strings.Contains(body, "<D:current-user-principal>") || !strings.Contains(body, "<C:calendar-home-set>") {
		t.Fatalf("expected current-user-principal and calendar-home-set in XML, got: %s", body)
	}
	if !strings.Contains(body, "/dav/calendars/"+mailboxID+"/") {
		t.Fatalf("expected calendar home URL for mailbox %s, got: %s", mailboxID, body)
	}
}

func TestCalDavHomeSetAndMkcalendar(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	tag := uuid.New().String()[:8]
	password := "SecretPass123!"
	_, _, mailboxID, email := createCalDavTestUser(t, db, tag, password)
	auth := basicAuthHeader(email, password)

	// 1. PROPFIND /dav/calendars/{mailbox_id}/ (Depth 1) should auto-create default Personal calendar
	homePath := fmt.Sprintf("/dav/calendars/%s/", mailboxID)
	wHome := calDavRequest("PROPFIND", homePath, "", auth)
	if wHome.Code != http.StatusMultiStatus {
		t.Fatalf("expected 207, got %d: %s", wHome.Code, wHome.Body.String())
	}
	body := wHome.Body.String()
	if !strings.Contains(body, "Personal") || !strings.Contains(body, "<C:calendar/>") {
		t.Fatalf("expected default Personal calendar collection, got: %s", body)
	}

	// 2. MKCALENDAR /dav/calendars/{mailbox_id}/ creates a new collection
	mkcalPath := fmt.Sprintf("/dav/calendars/%s/newcal", mailboxID)
	mkcalBody := `<?xml version="1.0" encoding="utf-8" ?>
<C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:set>
    <D:prop>
      <D:displayname>Project Work</D:displayname>
    </D:prop>
  </D:set>
</C:mkcalendar>`
	wMk := calDavRequest("MKCALENDAR", mkcalPath, mkcalBody, auth)
	if wMk.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created for MKCALENDAR, got %d: %s", wMk.Code, wMk.Body.String())
	}

	// Verify new calendar appears in PROPFIND
	wList := calDavRequest("PROPFIND", homePath, "", auth)
	if !strings.Contains(wList.Body.String(), "Project Work") {
		t.Fatalf("expected 'Project Work' in home set listing, got: %s", wList.Body.String())
	}
}

func TestCalDavPutGetDeleteEventLifecycle(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	tag := uuid.New().String()[:8]
	password := "SecretPass123!"
	_, _, mailboxID, email := createCalDavTestUser(t, db, tag, password)
	auth := basicAuthHeader(email, password)

	// Trigger default calendar creation
	_ = calDavRequest("PROPFIND", fmt.Sprintf("/dav/calendars/%s/", mailboxID), "", auth)

	var defaultCalID string
	err := db.QueryRow(`SELECT id::text FROM user_calendars WHERE mailbox_id=$1 AND is_default=true`, mailboxID).Scan(&defaultCalID)
	if err != nil {
		t.Fatalf("query default calendar: %v", err)
	}

	eventUID := "event-" + tag + "-100"
	resourcePath := fmt.Sprintf("/dav/calendars/%s/%s/%s.ics", mailboxID, defaultCalID, eventUID)

	vcalendar := fmt.Sprintf(`BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test Corp//CalDAV Test//EN
BEGIN:VEVENT
UID:%s
DTSTART:20261110T090000Z
DTEND:20261110T100000Z
SUMMARY:Architecture Design Review
DESCRIPTION:Review zero-knowledge Section 12 wire envelope
LOCATION:Room 404
STATUS:CONFIRMED
SEQUENCE:0
ATTENDEE;CN=Alice;PARTSTAT=ACCEPTED:mailto:alice@example.com
END:VEVENT
END:VCALENDAR`, eventUID)

	// 1. PUT event: returns 201 Created with ETag
	wPut := calDavRequest("PUT", resourcePath, vcalendar, auth)
	if wPut.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created for PUT, got %d: %s", wPut.Code, wPut.Body.String())
	}
	etag := wPut.Header().Get("ETag")
	if etag == "" {
		t.Fatalf("expected ETag header on PUT response")
	}

	// Verify stored payload in Postgres satisfies Section 12 AES-GCM envelope
	var payload []byte
	err = db.QueryRow(`SELECT encrypted_payload FROM calendar_events WHERE calendar_id=$1`, defaultCalID).Scan(&payload)
	if err != nil {
		t.Fatalf("query encrypted_payload: %v", err)
	}
	if len(payload) < 29 || payload[0] != 0x01 {
		t.Fatalf("stored payload failed Section 12 envelope specification: len=%d, version=0x%02x", len(payload), payload[0])
	}
	b64Payload := base64.StdEncoding.EncodeToString(payload)
	if _, err := validateCalendarEventEnvelope(b64Payload); err != nil {
		t.Fatalf("stored payload failed validateCalendarEventEnvelope: %v", err)
	}

	// 2. GET event: returns 200 OK with Content-Type and matching ETag
	wGet := calDavRequest("GET", resourcePath, "", auth)
	if wGet.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for GET, got %d: %s", wGet.Code, wGet.Body.String())
	}
	if !strings.Contains(wGet.Header().Get("Content-Type"), "text/calendar") {
		t.Fatalf("expected text/calendar Content-Type, got %q", wGet.Header().Get("Content-Type"))
	}
	getBody := wGet.Body.String()
	if !strings.Contains(getBody, "SUMMARY:Architecture Design Review") || !strings.Contains(getBody, "LOCATION:Room 404") {
		t.Fatalf("GET response missing event fields: %s", getBody)
	}

	// 3. Precondition test: If-None-Match: * on existing event returns 412 Precondition Failed
	reqConflict := httptest.NewRequest("PUT", resourcePath, bytes.NewBufferString(vcalendar))
	reqConflict.Header.Set("Authorization", auth)
	reqConflict.Header.Set("If-None-Match", "*")
	reqConflict.SetPathValue("mailbox_id", mailboxID)
	reqConflict.SetPathValue("calendar_id", defaultCalID)
	reqConflict.SetPathValue("resource_name", eventUID+".ics")
	wConflict := httptest.NewRecorder()
	calDavResourceHandler(wConflict, reqConflict)
	if wConflict.Code != http.StatusPreconditionFailed {
		t.Fatalf("expected 412 Precondition Failed for If-None-Match: *, got %d", wConflict.Code)
	}

	// 4. Update event via PUT returns 204 No Content
	vcalUpdated := strings.Replace(vcalendar, "SUMMARY:Architecture Design Review", "SUMMARY:Architecture Design Review (Updated)", 1)
	wUpdate := calDavRequest("PUT", resourcePath, vcalUpdated, auth)
	if wUpdate.Code != http.StatusNoContent {
		t.Fatalf("expected 204 No Content for PUT update, got %d: %s", wUpdate.Code, wUpdate.Body.String())
	}

	// Verify updated summary
	wGet2 := calDavRequest("GET", resourcePath, "", auth)
	if !strings.Contains(wGet2.Body.String(), "SUMMARY:Architecture Design Review (Updated)") {
		t.Fatalf("expected updated summary, got: %s", wGet2.Body.String())
	}

	// 5. DELETE event returns 204 No Content
	wDel := calDavRequest("DELETE", resourcePath, "", auth)
	if wDel.Code != http.StatusNoContent {
		t.Fatalf("expected 204 No Content for DELETE, got %d: %s", wDel.Code, wDel.Body.String())
	}

	// 6. Subsequent GET returns 404 Not Found
	wGet3 := calDavRequest("GET", resourcePath, "", auth)
	if wGet3.Code != http.StatusNotFound {
		t.Fatalf("expected 404 Not Found after delete, got %d", wGet3.Code)
	}
}

func TestCalDavCalendarQueryAndMultigetReport(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	tag := uuid.New().String()[:8]
	password := "SecretPass123!"
	_, _, mailboxID, email := createCalDavTestUser(t, db, tag, password)
	auth := basicAuthHeader(email, password)

	_ = calDavRequest("PROPFIND", fmt.Sprintf("/dav/calendars/%s/", mailboxID), "", auth)

	var defaultCalID string
	_ = db.QueryRow(`SELECT id::text FROM user_calendars WHERE mailbox_id=$1 AND is_default=true`, mailboxID).Scan(&defaultCalID)

	calPath := fmt.Sprintf("/dav/calendars/%s/%s/", mailboxID, defaultCalID)

	// Create event in November
	vcalNov := fmt.Sprintf(`BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
BEGIN:VEVENT
UID:ev-nov-%s
DTSTART:20261115T100000Z
DTEND:20261115T110000Z
SUMMARY:November Meeting
STATUS:CONFIRMED
END:VEVENT
END:VCALENDAR`, tag)
	_ = calDavRequest("PUT", calPath+fmt.Sprintf("ev-nov-%s.ics", tag), vcalNov, auth)

	// Create event in December
	vcalDec := fmt.Sprintf(`BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
BEGIN:VEVENT
UID:ev-dec-%s
DTSTART:20261220T100000Z
DTEND:20261220T110000Z
SUMMARY:December Meeting
STATUS:CONFIRMED
END:VEVENT
END:VCALENDAR`, tag)
	_ = calDavRequest("PUT", calPath+fmt.Sprintf("ev-dec-%s.ics", tag), vcalDec, auth)

	// 1. calendar-query REPORT filtering for November only
	reportQuery := `<?xml version="1.0" encoding="utf-8" ?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:time-range start="20261101T000000Z" end="20261130T235959Z"/>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>`

	wQuery := calDavRequest("REPORT", calPath, reportQuery, auth)
	if wQuery.Code != http.StatusMultiStatus {
		t.Fatalf("expected 207 for calendar-query REPORT, got %d: %s", wQuery.Code, wQuery.Body.String())
	}
	bodyQuery := wQuery.Body.String()
	if !strings.Contains(bodyQuery, "November Meeting") {
		t.Fatalf("expected November Meeting in query report, got: %s", bodyQuery)
	}
	if strings.Contains(bodyQuery, "December Meeting") {
		t.Fatalf("December Meeting should not appear in November query report, got: %s", bodyQuery)
	}

	// 2. calendar-multiget REPORT for specific href
	targetHref := calPath + fmt.Sprintf("ev-dec-%s.ics", tag)
	reportMultiget := fmt.Sprintf(`<?xml version="1.0" encoding="utf-8" ?>
<C:calendar-multiget xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <D:href>%s</D:href>
</C:calendar-multiget>`, targetHref)

	wMulti := calDavRequest("REPORT", calPath, reportMultiget, auth)
	if wMulti.Code != http.StatusMultiStatus {
		t.Fatalf("expected 207 for calendar-multiget REPORT, got %d: %s", wMulti.Code, wMulti.Body.String())
	}
	bodyMulti := wMulti.Body.String()
	if !strings.Contains(bodyMulti, "December Meeting") {
		t.Fatalf("expected December Meeting in multiget report, got: %s", bodyMulti)
	}
}

func TestCalDavRecurrenceExceptionSync(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	tag := uuid.New().String()[:8]
	password := "SecretPass123!"
	_, _, mailboxID, email := createCalDavTestUser(t, db, tag, password)
	auth := basicAuthHeader(email, password)

	_ = calDavRequest("PROPFIND", fmt.Sprintf("/dav/calendars/%s/", mailboxID), "", auth)

	var defaultCalID string
	_ = db.QueryRow(`SELECT id::text FROM user_calendars WHERE mailbox_id=$1 AND is_default=true`, mailboxID).Scan(&defaultCalID)

	eventUID := "recurring-" + tag
	resourcePath := fmt.Sprintf("/dav/calendars/%s/%s/%s.ics", mailboxID, defaultCalID, eventUID)

	// VCALENDAR with master weekly event AND a detached recurrence exception
	vcalRecurring := fmt.Sprintf(`BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
BEGIN:VEVENT
UID:%s
DTSTART:20261102T090000Z
DTEND:20261102T100000Z
RRULE:FREQ=WEEKLY;BYDAY=MO
SUMMARY:Weekly Standup
STATUS:CONFIRMED
END:VEVENT
BEGIN:VEVENT
UID:%s
RECURRENCE-ID:20261109T090000Z
DTSTART:20261109T140000Z
DTEND:20261109T150000Z
SUMMARY:Weekly Standup (Rescheduled Afternoon)
STATUS:CONFIRMED
END:VEVENT
END:VCALENDAR`, eventUID, eventUID)

	wPut := calDavRequest("PUT", resourcePath, vcalRecurring, auth)
	if wPut.Code != http.StatusCreated && wPut.Code != http.StatusNoContent {
		t.Fatalf("expected 201/204 for recurring PUT, got %d: %s", wPut.Code, wPut.Body.String())
	}

	// Verify exception is persisted in calendar_event_exceptions table for this calendar
	var count int
	_ = db.QueryRow(`
		SELECT count(*) 
		FROM calendar_event_exceptions e
		JOIN calendar_events ev ON ev.id = e.parent_event_id
		WHERE ev.calendar_id = $1 AND e.recurrence_id = '20261109T090000Z'
	`, defaultCalID).Scan(&count)
	if count != 1 {
		t.Fatalf("expected 1 detached exception persisted in DB, got %d", count)
	}

	// GET resource should return both master and exception VEVENT components
	wGet := calDavRequest("GET", resourcePath, "", auth)
	if wGet.Code != http.StatusOK {
		t.Fatalf("expected 200 OK for GET, got %d", wGet.Code)
	}
	body := wGet.Body.String()
	if !strings.Contains(body, "RRULE:FREQ=WEEKLY;BYDAY=MO") {
		t.Fatalf("missing master RRULE in GET response: %s", body)
	}
	if !strings.Contains(body, "RECURRENCE-ID:20261109T090000Z") || !strings.Contains(body, "Weekly Standup (Rescheduled Afternoon)") {
		t.Fatalf("missing detached exception in GET response: %s", body)
	}
}

func TestCalDavSharedCalendarPermissions(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	tagAlice := uuid.New().String()[:8]
	passAlice := "AliceSecret123!"
	_, _, aliceMailboxID, aliceEmail := createCalDavTestUser(t, db, "alice-"+tagAlice, passAlice)
	authAlice := basicAuthHeader(aliceEmail, passAlice)

	tagBob := uuid.New().String()[:8]
	passBob := "BobSecret123!"
	_, _, bobMailboxID, bobEmail := createCalDavTestUser(t, db, "bob-"+tagBob, passBob)
	authBob := basicAuthHeader(bobEmail, passBob)

	// Ensure Alice has a default calendar
	_ = calDavRequest("PROPFIND", fmt.Sprintf("/dav/calendars/%s/", aliceMailboxID), "", authAlice)
	var aliceCalID string
	_ = db.QueryRow(`SELECT id::text FROM user_calendars WHERE mailbox_id=$1 AND is_default=true`, aliceMailboxID).Scan(&aliceCalID)

	// 1. Share Alice's calendar with Bob with "read" permission
	var shareID string
	err := db.QueryRow(`
		INSERT INTO calendar_shares (calendar_id, grantor_mailbox_id, grantee_mailbox_id, permission, status)
		VALUES ($1, $2, $3, 'read', 'active')
		RETURNING id::text
	`, aliceCalID, aliceMailboxID, bobMailboxID).Scan(&shareID)
	if err != nil {
		t.Fatalf("create share: %v", err)
	}

	// 2. Bob runs PROPFIND on his calendar home set: Alice's calendar appears with read privilege
	wBobHome := calDavRequest("PROPFIND", fmt.Sprintf("/dav/calendars/%s/", bobMailboxID), "", authBob)
	if wBobHome.Code != http.StatusMultiStatus {
		t.Fatalf("expected 207 for Bob home PROPFIND, got %d: %s", wBobHome.Code, wBobHome.Body.String())
	}
	bobHomeBody := wBobHome.Body.String()
	if !strings.Contains(bobHomeBody, aliceCalID) {
		t.Fatalf("expected shared calendar %s in Bob's home set, got: %s", aliceCalID, bobHomeBody)
	}

	// 3. Bob attempts PUT on Alice's calendar: must return 403 Forbidden!
	eventPath := fmt.Sprintf("/dav/calendars/%s/%s/bob-meeting.ics", bobMailboxID, aliceCalID)
	vcalBob := `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Bob//EN
BEGIN:VEVENT
UID:bob-shared-write-test
DTSTART:20261120T100000Z
DTEND:20261120T110000Z
SUMMARY:Unauthorized Write
STATUS:CONFIRMED
END:VEVENT
END:VCALENDAR`

	wBobPutFail := calDavRequest("PUT", eventPath, vcalBob, authBob)
	if wBobPutFail.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for read-only grantee PUT, got %d: %s", wBobPutFail.Code, wBobPutFail.Body.String())
	}

	// 4. Update share to 'write' permission
	_, err = db.Exec(`UPDATE calendar_shares SET permission='write' WHERE id=$1`, shareID)
	if err != nil {
		t.Fatalf("update share: %v", err)
	}

	// 5. Bob attempts PUT now: must succeed (201 Created)
	wBobPutSuccess := calDavRequest("PUT", eventPath, vcalBob, authBob)
	if wBobPutSuccess.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created for write-permitted grantee PUT, got %d: %s", wBobPutSuccess.Code, wBobPutSuccess.Body.String())
	}

	// 6. Cross-tenant isolation check: Eve from another mailbox attempts to access Alice's calendar directly
	tagEve := uuid.New().String()[:8]
	passEve := "EveSecret123!"
	_, _, eveMailboxID, eveEmail := createCalDavTestUser(t, db, "eve-"+tagEve, passEve)
	authEve := basicAuthHeader(eveEmail, passEve)

	wEveCross := calDavRequest("PROPFIND", fmt.Sprintf("/dav/calendars/%s/", aliceMailboxID), "", authEve)
	if wEveCross.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for cross-mailbox access attempt, got %d", wEveCross.Code)
	}
	_ = eveMailboxID
}

func TestCalDavSecurityInvariants(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	tag := uuid.New().String()[:8]
	password := "SecretPass123!"
	_, userID, mailboxID, email := createCalDavTestUser(t, db, tag, password)
	auth := basicAuthHeader(email, password)

	// 1. SEC-04: User without enrolled 2FA factor succeeds via Basic Auth
	wNoMFA := calDavRequest("PROPFIND", "/dav/principals/", "", auth)
	if wNoMFA.Code != http.StatusMultiStatus {
		t.Fatalf("expected 207 for account without enrolled 2FA, got %d: %s", wNoMFA.Code, wNoMFA.Body.String())
	}

	// Enroll a TOTP factor and enable 2FA
	_, err := db.Exec(`UPDATE users SET two_factor_enabled = true, totp_secret = 'JBSWY3DPEHPK3PXP' WHERE id = $1`, userID)
	if err != nil {
		t.Fatalf("update two_factor_enabled and totp_secret: %v", err)
	}

	// CalDAV Basic Auth attempt must fail with 401 Unauthorized because 2FA requires session authentication
	w2FA := calDavRequest("PROPFIND", "/dav/principals/", "", auth)
	if w2FA.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for 2FA-enabled account over Basic auth, got %d: %s", w2FA.Code, w2FA.Body.String())
	}
	if !strings.Contains(w2FA.Body.String(), "2-step verification is enabled on this account") {
		t.Fatalf("expected 2FA notification in error body, got: %s", w2FA.Body.String())
	}

	// 2. SEC-03: getEffectiveMailboxKey zero-knowledge boundary in production
	origEnv := os.Getenv("BYOS_ENV")
	defer os.Setenv("BYOS_ENV", origEnv)

	os.Setenv("BYOS_ENV", "production")
	_, err = getEffectiveMailboxKey(nil, mailboxID)
	if err == nil {
		t.Fatalf("expected getEffectiveMailboxKey to fail in production when mailboxSk is nil")
	}

	// 3. SEC-03: Distinct fallback keys per mailbox (preventing cross-user collisions)
	os.Setenv("BYOS_ENV", "development")
	key1, err := getEffectiveMailboxKey(nil, "mailbox-1")
	if err != nil {
		t.Fatalf("unexpected error for mailbox-1: %v", err)
	}
	key2, err := getEffectiveMailboxKey(nil, "mailbox-2")
	if err != nil {
		t.Fatalf("unexpected error for mailbox-2: %v", err)
	}
	if bytes.Equal(key1, key2) {
		t.Fatalf("expected distinct fallback keys for different mailboxes, but got identical keys")
	}
}
