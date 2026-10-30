package main

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/argon2"
)

// CalDavUser represents an authenticated CalDAV principal.
type CalDavUser struct {
	UserID    string
	OrgID     string
	Email     string
	MailboxID string
	MailboxSk []byte // 32-byte mailbox encryption key (unwrapped with user password)
}

// CalDavAttendee represents an RFC 5545 ATTENDEE property.
type CalDavAttendee struct {
	Name     string `json:"name,omitempty"`
	Email    string `json:"email"`
	Status   string `json:"status,omitempty"` // accepted, declined, tentative, needs-action
	Role     string `json:"role,omitempty"`   // REQ-PARTICIPANT, OPT-PARTICIPANT
	RSVP     bool   `json:"rsvp,omitempty"`
}

// CalDavEventPlaintext represents the zero-knowledge decrypted payload of a calendar event.
type CalDavEventPlaintext struct {
	Title       string           `json:"title"`
	Description string           `json:"description,omitempty"`
	Location    string           `json:"location,omitempty"`
	MeetingURL  string           `json:"meetingUrl,omitempty"`
	Attendees   []CalDavAttendee `json:"attendees,omitempty"`
	Timezone    string           `json:"timezone,omitempty"`
	UID         string           `json:"uid,omitempty"`
	Sequence    int              `json:"sequence,omitempty"`
	RRule       string           `json:"rrule,omitempty"`
}

// CalDavParsedEvent represents an event extracted from RFC 5545 text/calendar.
type CalDavParsedEvent struct {
	UID          string
	Summary      string
	Description  string
	Location     string
	StartTime    time.Time
	EndTime      time.Time
	IsAllDay     bool
	RRule        string
	Status       string
	RecurrenceID string
	IsCancelled  bool
	Sequence     int
	Timezone     string
	Attendees    []CalDavAttendee
}

// -----------------------------------------------------------------------------
// RFC 5545 iCalendar Parser & Formatter
// -----------------------------------------------------------------------------

func unescapeIcs(s string) string {
	var buf strings.Builder
	runes := []rune(s)
	for i := 0; i < len(runes); i++ {
		if runes[i] == '\\' && i+1 < len(runes) {
			next := runes[i+1]
			switch next {
			case 'n', 'N':
				buf.WriteRune('\n')
				i++
			case '\\', ';', ',':
				buf.WriteRune(next)
				i++
			default:
				buf.WriteRune(runes[i])
			}
		} else {
			buf.WriteRune(runes[i])
		}
	}
	return buf.String()
}

func escapeIcs(s string) string {
	s = strings.ReplaceAll(s, "\\", "\\\\")
	s = strings.ReplaceAll(s, ";", "\\;")
	s = strings.ReplaceAll(s, ",", "\\,")
	s = strings.ReplaceAll(s, "\r\n", "\\n")
	s = strings.ReplaceAll(s, "\n", "\\n")
	return s
}

func foldIcsLine(line string) string {
	if len(line) <= 75 {
		return line
	}
	var buf strings.Builder
	rem := line
	for len(rem) > 75 {
		buf.WriteString(rem[:75])
		buf.WriteString("\r\n ")
		rem = rem[75:]
	}
	buf.WriteString(rem)
	return buf.String()
}

func formatIcsTimestampUtc(t time.Time) string {
	return t.UTC().Format("20060102T150405Z")
}

func formatIcsDateOnly(t time.Time) string {
	return t.UTC().Format("20060102")
}

func parseIcsTimestamp(val string) (time.Time, bool, error) {
	val = strings.TrimSpace(val)
	// Check if date-only (YYYYMMDD)
	if len(val) == 8 && !strings.Contains(val, "T") {
		t, err := time.Parse("20060102", val)
		return t, true, err
	}
	// Check if UTC timestamp (YYYYMMDDTHHMMSSZ)
	if strings.HasSuffix(val, "Z") {
		t, err := time.Parse("20060102T150405Z", val)
		return t, false, err
	}
	// Check if standard local (YYYYMMDDTHHMMSS)
	if strings.Contains(val, "T") {
		t, err := time.Parse("20060102T150405", val)
		return t, false, err
	}
	// Fall back to RFC3339
	t, err := time.Parse(time.RFC3339, val)
	return t, false, err
}

func parseICalendar(raw string) ([]CalDavParsedEvent, error) {
	// 1. Unfold lines per RFC 5545 section 3.1
	rawLines := strings.Split(strings.ReplaceAll(raw, "\r\n", "\n"), "\n")
	var unfolded []string
	for _, l := range rawLines {
		if strings.HasPrefix(l, " ") || strings.HasPrefix(l, "\t") {
			if len(unfolded) > 0 {
				unfolded[len(unfolded)-1] += l[1:]
			}
		} else if strings.TrimSpace(l) != "" {
			unfolded = append(unfolded, l)
		}
	}

	var events []CalDavParsedEvent
	var current *CalDavParsedEvent
	inEvent := false

	for _, line := range unfolded {
		line = strings.TrimSpace(line)
		if strings.EqualFold(line, "BEGIN:VEVENT") {
			inEvent = true
			current = &CalDavParsedEvent{
				Status: "busy",
			}
			continue
		}
		if strings.EqualFold(line, "END:VEVENT") {
			if current != nil {
				if current.EndTime.Before(current.StartTime) {
					current.EndTime = current.StartTime.Add(1 * time.Hour)
				}
				events = append(events, *current)
				current = nil
			}
			inEvent = false
			continue
		}
		if !inEvent || current == nil {
			continue
		}

		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 {
			continue
		}
		keyHeader := strings.TrimSpace(parts[0])
		val := strings.TrimSpace(parts[1])

		keyParts := strings.Split(keyHeader, ";")
		propName := strings.ToUpper(strings.TrimSpace(keyParts[0]))

		switch propName {
		case "UID":
			current.UID = val
		case "SUMMARY":
			current.Summary = unescapeIcs(val)
		case "DESCRIPTION":
			current.Description = unescapeIcs(val)
		case "LOCATION":
			current.Location = unescapeIcs(val)
		case "RRULE":
			current.RRule = val
		case "STATUS":
			current.Status = strings.ToLower(val)
			if strings.EqualFold(val, "CANCELLED") {
				current.IsCancelled = true
			}
		case "SEQUENCE":
			if seq, err := strconv.Atoi(val); err == nil {
				current.Sequence = seq
			}
		case "RECURRENCE-ID":
			current.RecurrenceID = val
		case "DTSTART":
			t, isAllDay, err := parseIcsTimestamp(val)
			if err == nil {
				current.StartTime = t
				current.IsAllDay = isAllDay
			}
		case "DTEND":
			t, _, err := parseIcsTimestamp(val)
			if err == nil {
				current.EndTime = t
			}
		case "DURATION":
			// Approximate RFC 5545 duration: PT1H, P1D, etc.
			if current.EndTime.IsZero() && !current.StartTime.IsZero() {
				if strings.Contains(val, "D") {
					current.EndTime = current.StartTime.Add(24 * time.Hour)
				} else {
					current.EndTime = current.StartTime.Add(1 * time.Hour)
				}
			}
		case "ATTENDEE":
			email := val
			if strings.HasPrefix(strings.ToLower(val), "mailto:") {
				email = val[7:]
			}
			var name string
			for _, param := range keyParts[1:] {
				param = strings.TrimSpace(param)
				if strings.HasPrefix(strings.ToUpper(param), "CN=") {
					name = strings.Trim(param[3:], "\"")
				}
			}
			current.Attendees = append(current.Attendees, CalDavAttendee{
				Name:  name,
				Email: email,
			})
		}
	}

	return events, nil
}

func formatEventToICalendar(event CalDavParsedEvent, exceptions []CalDavParsedEvent) string {
	var b strings.Builder
	b.WriteString("BEGIN:VCALENDAR\r\n")
	b.WriteString("VERSION:2.0\r\n")
	b.WriteString("PRODID:-//BYOS//BYOS CalDAV Sync 1.0//EN\r\n")
	b.WriteString("CALSCALE:GREGORIAN\r\n")

	writeVEvent := func(ev CalDavParsedEvent) {
		b.WriteString("BEGIN:VEVENT\r\n")
		b.WriteString(foldIcsLine(fmt.Sprintf("UID:%s", ev.UID)) + "\r\n")
		b.WriteString(fmt.Sprintf("DTSTAMP:%s\r\n", formatIcsTimestampUtc(time.Now())))

		if ev.RecurrenceID != "" {
			b.WriteString(foldIcsLine(fmt.Sprintf("RECURRENCE-ID:%s", ev.RecurrenceID)) + "\r\n")
		}

		if ev.IsAllDay {
			b.WriteString(fmt.Sprintf("DTSTART;VALUE=DATE:%s\r\n", formatIcsDateOnly(ev.StartTime)))
			b.WriteString(fmt.Sprintf("DTEND;VALUE=DATE:%s\r\n", formatIcsDateOnly(ev.EndTime)))
		} else {
			b.WriteString(fmt.Sprintf("DTSTART:%s\r\n", formatIcsTimestampUtc(ev.StartTime)))
			b.WriteString(fmt.Sprintf("DTEND:%s\r\n", formatIcsTimestampUtc(ev.EndTime)))
		}

		if ev.Summary != "" {
			b.WriteString(foldIcsLine(fmt.Sprintf("SUMMARY:%s", escapeIcs(ev.Summary))) + "\r\n")
		}
		if ev.Description != "" {
			b.WriteString(foldIcsLine(fmt.Sprintf("DESCRIPTION:%s", escapeIcs(ev.Description))) + "\r\n")
		}
		if ev.Location != "" {
			b.WriteString(foldIcsLine(fmt.Sprintf("LOCATION:%s", escapeIcs(ev.Location))) + "\r\n")
		}
		if ev.RRule != "" {
			b.WriteString(foldIcsLine(fmt.Sprintf("RRULE:%s", ev.RRule)) + "\r\n")
		}

		st := strings.ToUpper(ev.Status)
		if ev.IsCancelled {
			st = "CANCELLED"
		} else if st == "" || st == "BUSY" {
			st = "CONFIRMED"
		}
		b.WriteString(fmt.Sprintf("STATUS:%s\r\n", st))
		b.WriteString(fmt.Sprintf("SEQUENCE:%d\r\n", ev.Sequence))

		for _, att := range ev.Attendees {
			line := "ATTENDEE"
			if att.Name != "" {
				line += fmt.Sprintf(";CN=%s", escapeIcs(att.Name))
			}
			if att.Status != "" {
				line += fmt.Sprintf(";PARTSTAT=%s", strings.ToUpper(att.Status))
			}
			line += fmt.Sprintf(":mailto:%s", att.Email)
			b.WriteString(foldIcsLine(line) + "\r\n")
		}

		b.WriteString("END:VEVENT\r\n")
	}

	writeVEvent(event)
	for _, exc := range exceptions {
		writeVEvent(exc)
	}

	b.WriteString("END:VCALENDAR\r\n")
	return b.String()
}

// -----------------------------------------------------------------------------
// Section 12 Cryptographic Bridge (Zero-Knowledge Envelope Handling)
// -----------------------------------------------------------------------------

func unwrapMailboxKey(password, wrappedSkUser string) ([]byte, error) {
	trimmed := strings.TrimSpace(wrappedSkUser)
	if trimmed == "" {
		return nil, errors.New("empty wrapped_sk_user")
	}

	var saltHex, envelopeHex string
	if strings.HasPrefix(trimmed, "{") {
		var p struct {
			Salt     string `json:"salt"`
			Envelope string `json:"envelope"`
		}
		if err := json.Unmarshal([]byte(trimmed), &p); err == nil && p.Salt != "" && p.Envelope != "" {
			saltHex = p.Salt
			envelopeHex = p.Envelope
		}
	} else if strings.Contains(trimmed, ":") {
		parts := strings.SplitN(trimmed, ":", 2)
		saltHex = parts[0]
		envelopeHex = parts[1]
	} else if len(trimmed) >= 32 {
		saltHex = trimmed[:32]
		envelopeHex = trimmed[32:]
	}

	if saltHex == "" || envelopeHex == "" {
		return nil, errors.New("unrecognized wrapped_sk_user format")
	}

	salt, err := hex.DecodeString(saltHex)
	if err != nil || len(salt) != 16 {
		return nil, fmt.Errorf("invalid salt: %w", err)
	}

	envelope, err := hex.DecodeString(envelopeHex)
	if err != nil || len(envelope) < 29 || envelope[0] != 1 {
		return nil, errors.New("invalid envelope")
	}

	derivedKey := argon2.IDKey([]byte(password), salt, 3, 64*1024, 2, 32)
	block, err := aes.NewCipher(derivedKey)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	nonce := envelope[1:13]
	ciphertext := envelope[13:]
	aad := []byte("byos-recovery-principal-v1")

	mailboxSk, err := gcm.Open(nil, nonce, ciphertext, aad)
	if err != nil {
		return nil, fmt.Errorf("failed to decrypt mailbox key: %w", err)
	}
	if len(mailboxSk) != 32 {
		return nil, errors.New("unwrapped mailbox key must be 32 bytes")
	}
	return mailboxSk, nil
}

func getEffectiveMailboxKey(mailboxSk []byte, mailboxID string) ([]byte, error) {
	if len(mailboxSk) == 32 {
		return mailboxSk, nil
	}
	// In production, fallback keys are strictly forbidden to preserve zero-knowledge security
	if os.Getenv("BYOS_ENV") == "production" {
		return nil, errors.New("zero-knowledge violation: unwrapped mailbox key required in production")
	}
	// Fallback key permitted solely in non-production test harnesses
	h := sha256.Sum256([]byte("byos-caldav-deterministic-key:" + mailboxID))
	return h[:], nil
}

func encryptCalendarEventPayloadGo(mailboxSk []byte, mailboxID string, pt CalDavEventPlaintext) ([]byte, error) {
	key, err := getEffectiveMailboxKey(mailboxSk, mailboxID)
	if err != nil {
		return nil, err
	}
	rawUUID, err := uuid.Parse(mailboxID)
	if err != nil {
		return nil, fmt.Errorf("invalid mailbox UUID for AAD: %w", err)
	}

	plaintextBytes, err := json.Marshal(pt)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal event plaintext: %w", err)
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	nonce := make([]byte, 12)
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("failed to generate random nonce: %w", err)
	}

	aad := append([]byte("byos-calendar-event-v1"), rawUUID[:]...)
	ciphertextAndTag := gcm.Seal(nil, nonce, plaintextBytes, aad)

	// Section 12 wire envelope: Version (0x01) || Nonce (12) || Ciphertext+Tag
	envelope := make([]byte, 1+12+len(ciphertextAndTag))
	envelope[0] = 0x01
	copy(envelope[1:13], nonce)
	copy(envelope[13:], ciphertextAndTag)

	return envelope, nil
}

func decryptCalendarEventPayloadGo(mailboxSk []byte, mailboxID string, envelope []byte) (CalDavEventPlaintext, error) {
	fallback := CalDavEventPlaintext{
		Title: "(Encrypted Event)",
	}

	if len(envelope) < 29 || envelope[0] != 0x01 {
		return fallback, errors.New("invalid Section 12 envelope header")
	}

	key, err := getEffectiveMailboxKey(mailboxSk, mailboxID)
	if err != nil {
		return fallback, err
	}
	rawUUID, err := uuid.Parse(mailboxID)
	if err != nil {
		return fallback, fmt.Errorf("invalid mailbox UUID for AAD: %w", err)
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return fallback, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return fallback, err
	}

	nonce := envelope[1:13]
	ciphertext := envelope[13:]
	aad := append([]byte("byos-calendar-event-v1"), rawUUID[:]...)

	plaintextBytes, err := gcm.Open(nil, nonce, ciphertext, aad)
	if err != nil {
		return fallback, err
	}

	var pt CalDavEventPlaintext
	if err := json.Unmarshal(plaintextBytes, &pt); err != nil {
		return fallback, err
	}
	return pt, nil
}

// -----------------------------------------------------------------------------
// WebDAV / CalDAV XML Multistatus Serializer
// -----------------------------------------------------------------------------

type DavPropStat struct {
	Status string
	Props  map[string]string
}

type DavResponse struct {
	Href      string
	PropStats []DavPropStat
}

func xmlEscape(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	s = strings.ReplaceAll(s, "\"", "&quot;")
	s = strings.ReplaceAll(s, "'", "&apos;")
	return s
}

func writeMultiStatus(w http.ResponseWriter, responses []DavResponse) {
	w.Header().Set("Content-Type", "application/xml; charset=utf-8")
	w.WriteHeader(http.StatusMultiStatus) // 207

	var buf bytes.Buffer
	buf.WriteString("<?xml version=\"1.0\" encoding=\"utf-8\"?>\r\n")
	buf.WriteString("<D:multistatus xmlns:D=\"DAV:\" xmlns:C=\"urn:ietf:params:xml:ns:caldav\" xmlns:CS=\"http://calendarserver.org/ns/\">\r\n")

	for _, resp := range responses {
		buf.WriteString("  <D:response>\r\n")
		buf.WriteString(fmt.Sprintf("    <D:href>%s</D:href>\r\n", xmlEscape(resp.Href)))
		for _, ps := range resp.PropStats {
			buf.WriteString("    <D:propstat>\r\n")
			buf.WriteString("      <D:prop>\r\n")
			for k, v := range ps.Props {
				if v == "" {
					buf.WriteString(fmt.Sprintf("        <%s/>\r\n", k))
				} else if strings.HasPrefix(v, "<") {
					buf.WriteString(fmt.Sprintf("        <%s>%s</%s>\r\n", k, v, k))
				} else {
					buf.WriteString(fmt.Sprintf("        <%s>%s</%s>\r\n", k, xmlEscape(v), k))
				}
			}
			buf.WriteString("      </D:prop>\r\n")
			buf.WriteString(fmt.Sprintf("      <D:status>%s</D:status>\r\n", ps.Status))
			buf.WriteString("    </D:propstat>\r\n")
		}
		buf.WriteString("  </D:response>\r\n")
	}

	buf.WriteString("</D:multistatus>\r\n")
	w.Write(buf.Bytes())
}

func setDavHeaders(w http.ResponseWriter) {
	w.Header().Set("DAV", "1, 2, 3, calendar-access, calendar-schedule")
	w.Header().Set("Allow", "OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, REPORT, MKCALENDAR")
}

// -----------------------------------------------------------------------------
// CalDAV Authentication & Authorization
// -----------------------------------------------------------------------------

func authenticateCalDav(w http.ResponseWriter, r *http.Request, conn *pgx.Conn, ctx context.Context) (*CalDavUser, bool) {
	auth := r.Header.Get("Authorization")

	// 1. HTTP Basic Authentication
	if strings.HasPrefix(auth, "Basic ") {
		encoded := strings.TrimSpace(strings.TrimPrefix(auth, "Basic "))
		raw, err := base64.StdEncoding.DecodeString(encoded)
		if err == nil {
			parts := strings.SplitN(string(raw), ":", 2)
			if len(parts) == 2 {
				username := strings.TrimSpace(parts[0])
				password := parts[1]

				clientIP := getClientIP(r)
				if redisClient != nil {
					ctx2 := context.Background()
					cIP, _ := redisClient.Get(ctx2, "caldav:rate:ip:"+clientIP).Int()
					cUser, _ := redisClient.Get(ctx2, "caldav:rate:user:"+username).Int()
					if cIP >= 10 || cUser >= 10 {
						w.Header().Set("Retry-After", "60")
						http.Error(w, "too many authentication attempts", http.StatusTooManyRequests)
						return nil, false
					}
				}

				var userID, orgID, email, passwordHash string
				var isActive, twoFactorEnabled bool
				var totpSecret *string
				var passkeyCount int
				err := conn.QueryRow(ctx, `
					SELECT u.id::text, u.org_id::text, u.email, u.password_hash, u.is_active,
					       COALESCE(u.two_factor_enabled, false), u.totp_secret,
					       (SELECT COUNT(*) FROM user_passkeys pk WHERE pk.user_id = u.id)
					FROM users u
					WHERE LOWER(u.email) = LOWER($1)
				`, username).Scan(&userID, &orgID, &email, &passwordHash, &isActive, &twoFactorEnabled, &totpSecret, &passkeyCount)

				if err == pgx.ErrNoRows {
					// Fall back to looking up mailbox local_part
					err = conn.QueryRow(ctx, `
						SELECT u.id::text, u.org_id::text, u.email, u.password_hash, u.is_active,
						       COALESCE(u.two_factor_enabled, false), u.totp_secret,
						       (SELECT COUNT(*) FROM user_passkeys pk WHERE pk.user_id = u.id)
						FROM users u
						JOIN mailboxes m ON m.user_id = u.id
						WHERE LOWER(m.local_part) = LOWER($1)
						LIMIT 1
					`, username).Scan(&userID, &orgID, &email, &passwordHash, &isActive, &twoFactorEnabled, &totpSecret, &passkeyCount)
				}

				if err != nil || !isActive || !verifyPassword(passwordHash, password) {
					if redisClient != nil {
						ctx2 := context.Background()
						redisClient.Incr(ctx2, "caldav:rate:ip:"+clientIP)
						redisClient.Expire(ctx2, "caldav:rate:ip:"+clientIP, time.Minute)
						redisClient.Incr(ctx2, "caldav:rate:user:"+username)
						redisClient.Expire(ctx2, "caldav:rate:user:"+username, time.Minute)
					}
					w.Header().Set("WWW-Authenticate", `Basic realm="BYOS CalDAV"`)
					http.Error(w, "invalid credentials", http.StatusUnauthorized)
					return nil, false
				}

				hasMFA := twoFactorEnabled && ((totpSecret != nil && *totpSecret != "") || passkeyCount > 0)
				if hasMFA {
					w.Header().Set("WWW-Authenticate", `Basic realm="BYOS CalDAV (2FA Active: Session Required)"`)
					http.Error(w, "2-step verification is enabled on this account; CalDAV requires session authentication", http.StatusUnauthorized)
					return nil, false
				}

				var mailboxID, wrappedSkUser string
				err = conn.QueryRow(ctx, `
					SELECT id::text, COALESCE(wrapped_sk_user, '')
					FROM mailboxes
					WHERE user_id = $1 AND is_active = true
					ORDER BY created_at ASC
					LIMIT 1
				`, userID).Scan(&mailboxID, &wrappedSkUser)

				if err == nil {
					mailboxSk, _ := unwrapMailboxKey(password, wrappedSkUser)
					return &CalDavUser{
						UserID:    userID,
						OrgID:     orgID,
						Email:     email,
						MailboxID: mailboxID,
						MailboxSk: mailboxSk,
					}, true
				}
			}
		}
	}

	// 2. Bearer Token / Session Cookie Auth
	if uid, ok := getAuthenticatedUserID(r); ok {
		var orgID, email string
		err := conn.QueryRow(ctx, `
			SELECT org_id::text, email FROM users WHERE id = $1 AND is_active = true
		`, uid).Scan(&orgID, &email)

		if err == nil {
			var mailboxID string
			err = conn.QueryRow(ctx, `
				SELECT id::text FROM mailboxes WHERE user_id = $1 AND is_active = true ORDER BY created_at ASC LIMIT 1
			`, uid).Scan(&mailboxID)

			if err == nil {
				return &CalDavUser{
					UserID:    uid,
					OrgID:     orgID,
					Email:     email,
					MailboxID: mailboxID,
					MailboxSk: nil,
				}, true
			}
		}
	}

	w.Header().Set("WWW-Authenticate", `Basic realm="BYOS CalDAV"`)
	http.Error(w, "Unauthorized", http.StatusUnauthorized)
	return nil, false
}

func authorizeMailboxAccess(w http.ResponseWriter, user *CalDavUser, targetMailboxID string) bool {
	if user.MailboxID == targetMailboxID {
		return true
	}
	http.Error(w, "Forbidden: not authorized for this mailbox", http.StatusForbidden)
	return false
}

func resolveCalendarAccess(ctx context.Context, conn *pgx.Conn, user *CalDavUser, mailboxID, calendarID string, requireWrite bool) (*UserCalendar, string, error) {
	calUUID, err := uuid.Parse(calendarID)
	if err != nil {
		calUUID = uuid.NewSHA1(uuid.NameSpaceOID, []byte(mailboxID+":"+calendarID))
	}
	cleanCalID := calUUID.String()

	var c UserCalendar
	var createdAt, updatedAt time.Time

	// 1. Check if directly owned
	err = conn.QueryRow(ctx, `
		SELECT id::text, mailbox_id::text, name, color, is_default, created_at, updated_at
		FROM user_calendars
		WHERE id = $1 AND mailbox_id = $2
	`, cleanCalID, user.MailboxID).Scan(&c.ID, &c.MailboxID, &c.Name, &c.Color, &c.IsDefault, &createdAt, &updatedAt)

	if err == nil {
		c.CreatedAt = createdAt.Format(time.RFC3339)
		c.UpdatedAt = updatedAt.Format(time.RFC3339)
		c.Permission = "owner"
		return &c, "owner", nil
	}

	if err != pgx.ErrNoRows {
		return nil, "", err
	}

	// 2. Check if shared with user's mailbox
	var sharePermission string
	err = conn.QueryRow(ctx, `
		SELECT c.id::text, c.mailbox_id::text, c.name, c.color, c.is_default, c.created_at, c.updated_at, cs.permission
		FROM calendar_shares cs
		JOIN user_calendars c ON c.id = cs.calendar_id
		WHERE cs.calendar_id = $1 AND cs.grantee_mailbox_id = $2 AND cs.status = 'active'
	`, cleanCalID, user.MailboxID).Scan(&c.ID, &c.MailboxID, &c.Name, &c.Color, &c.IsDefault, &createdAt, &updatedAt, &sharePermission)

	if err == nil {
		c.CreatedAt = createdAt.Format(time.RFC3339)
		c.UpdatedAt = updatedAt.Format(time.RFC3339)
		c.Permission = sharePermission
		if requireWrite && sharePermission != "write" {
			return nil, "", errors.New("read-only calendar share: write forbidden")
		}
		return &c, sharePermission, nil
	}

	return nil, "", errors.New("calendar not found or access denied")
}

// -----------------------------------------------------------------------------
// CalDAV Endpoint Handlers
// -----------------------------------------------------------------------------

// calDavWellKnownHandler redirects /.well-known/caldav to /dav/principals/ per RFC 6764.
func calDavWellKnownHandler(w http.ResponseWriter, r *http.Request) {
	setDavHeaders(w)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}
	http.Redirect(w, r, "/dav/principals/", http.StatusMovedPermanently)
}

// calDavPrincipalHandler handles /dav/principals/ and /dav/principals/{email}
func calDavPrincipalHandler(w http.ResponseWriter, r *http.Request) {
	setDavHeaders(w)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	ctx := r.Context()
	conn, err := getDBConn(ctx)
	if err != nil {
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	user, ok := authenticateCalDav(w, r, conn, ctx)
	if !ok {
		return
	}

	if r.Method == "PROPFIND" {
		principalURL := fmt.Sprintf("/dav/principals/%s/", user.Email)
		homeURL := fmt.Sprintf("/dav/calendars/%s/", user.MailboxID)

		resp := DavResponse{
			Href: principalURL,
			PropStats: []DavPropStat{
				{
					Status: "HTTP/1.1 200 OK",
					Props: map[string]string{
						"D:resourcetype":           "<D:principal/>",
						"D:current-user-principal": fmt.Sprintf("<D:href>%s</D:href>", principalURL),
						"C:calendar-home-set":      fmt.Sprintf("<D:href>%s</D:href>", homeURL),
						"D:displayname":            user.Email,
					},
				},
			},
		}
		writeMultiStatus(w, []DavResponse{resp})
		return
	}

	http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
}

// calDavHomeHandler handles /dav/calendars/{mailbox_id}/
func calDavHomeHandler(w http.ResponseWriter, r *http.Request) {
	setDavHeaders(w)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	ctx := r.Context()
	conn, err := getDBConn(ctx)
	if err != nil {
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	user, ok := authenticateCalDav(w, r, conn, ctx)
	if !ok {
		return
	}

	mailboxID := r.PathValue("mailbox_id")
	if mailboxID == "" {
		mailboxID = user.MailboxID
	}
	if !authorizeMailboxAccess(w, user, mailboxID) {
		return
	}

	_ = ensureDefaultCalendar(ctx, conn, mailboxID)

	switch r.Method {
	case "PROPFIND":
		depth := r.Header.Get("Depth")
		homeURL := fmt.Sprintf("/dav/calendars/%s/", mailboxID)

		var responses []DavResponse

		// Home collection properties
		responses = append(responses, DavResponse{
			Href: homeURL,
			PropStats: []DavPropStat{
				{
					Status: "HTTP/1.1 200 OK",
					Props: map[string]string{
						"D:resourcetype": "<D:collection/>",
						"D:displayname":  "Calendar Home",
					},
				},
			},
		})

		if depth != "0" {
			// Query owned calendars
			rows, err := conn.Query(ctx, `
				SELECT id::text, name, updated_at
				FROM user_calendars
				WHERE mailbox_id = $1
				ORDER BY is_default DESC, name ASC
			`, mailboxID)
			if err == nil {
				defer rows.Close()
				for rows.Next() {
					var id, name string
					var updatedAt time.Time
					if err := rows.Scan(&id, &name, &updatedAt); err == nil {
						calURL := fmt.Sprintf("/dav/calendars/%s/%s/", mailboxID, id)
						ctag := fmt.Sprintf("\"%d\"", updatedAt.UnixNano())
						syncToken := fmt.Sprintf("data:sync,%d", updatedAt.UnixNano())

						privileges := "<D:privilege><D:read/></D:privilege><D:privilege><D:write/></D:privilege><D:privilege><D:write-content/></D:privilege>"

						responses = append(responses, DavResponse{
							Href: calURL,
							PropStats: []DavPropStat{
								{
									Status: "HTTP/1.1 200 OK",
									Props: map[string]string{
										"D:resourcetype":                     "<D:collection/><C:calendar/>",
										"D:displayname":                      name,
										"CS:getctag":                         ctag,
										"D:sync-token":                       syncToken,
										"C:supported-calendar-component-set": "<C:comp name=\"VEVENT\"/>",
										"D:current-user-privilege-set":       privileges,
									},
								},
							},
						})
					}
				}
			}

			// Query shared calendars
			sRows, err := conn.Query(ctx, `
				SELECT c.id::text, c.name, c.updated_at, cs.permission, m.local_part || '@' || d.name as owner_email
				FROM calendar_shares cs
				JOIN user_calendars c ON c.id = cs.calendar_id
				JOIN mailboxes m ON m.id = c.mailbox_id
				JOIN domains d ON d.id = m.domain_id
				WHERE cs.grantee_mailbox_id = $1 AND cs.status = 'active'
			`, mailboxID)
			if err == nil {
				defer sRows.Close()
				for sRows.Next() {
					var id, name, perm, ownerEmail string
					var updatedAt time.Time
					if err := sRows.Scan(&id, &name, &updatedAt, &perm, &ownerEmail); err == nil {
						calURL := fmt.Sprintf("/dav/calendars/%s/%s/", mailboxID, id)
						ctag := fmt.Sprintf("\"%d\"", updatedAt.UnixNano())
						syncToken := fmt.Sprintf("data:sync,%d", updatedAt.UnixNano())

						privileges := "<D:privilege><D:read/></D:privilege>"
						if perm == "write" {
							privileges += "<D:privilege><D:write/></D:privilege><D:privilege><D:write-content/></D:privilege>"
						}

						responses = append(responses, DavResponse{
							Href: calURL,
							PropStats: []DavPropStat{
								{
									Status: "HTTP/1.1 200 OK",
									Props: map[string]string{
										"D:resourcetype":                     "<D:collection/><C:calendar/>",
										"D:displayname":                      fmt.Sprintf("%s (%s)", name, ownerEmail),
										"CS:getctag":                         ctag,
										"D:sync-token":                       syncToken,
										"C:supported-calendar-component-set": "<C:comp name=\"VEVENT\"/>",
										"D:current-user-privilege-set":       privileges,
									},
								},
							},
						})
					}
				}
			}
		}

		writeMultiStatus(w, responses)
		return

	case "MKCALENDAR":
		bodyBytes, _ := io.ReadAll(io.LimitReader(r.Body, 64*1024))
		displayName := "New Calendar"
		re := regexp.MustCompile(`(?i)<(?:D:)?displayname>([^<]+)</(?:D:)?displayname>`)
		if m := re.FindSubmatch(bodyBytes); len(m) > 1 {
			displayName = strings.TrimSpace(string(m[1]))
		}

		newCalID := uuid.New().String()
		_, err := conn.Exec(ctx, `
			INSERT INTO user_calendars (id, mailbox_id, name, color, is_default)
			VALUES ($1, $2, $3, '#9E725F', false)
		`, newCalID, mailboxID, displayName)
		if err != nil {
			http.Error(w, "Failed to create calendar", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Location", fmt.Sprintf("/dav/calendars/%s/%s/", mailboxID, newCalID))
		w.WriteHeader(http.StatusCreated)
		return

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// calDavCollectionHandler handles /dav/calendars/{mailbox_id}/{calendar_id}/
func calDavCollectionHandler(w http.ResponseWriter, r *http.Request) {
	setDavHeaders(w)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	ctx := r.Context()
	conn, err := getDBConn(ctx)
	if err != nil {
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	user, ok := authenticateCalDav(w, r, conn, ctx)
	if !ok {
		return
	}

	mailboxID := r.PathValue("mailbox_id")
	calendarID := r.PathValue("calendar_id")
	if mailboxID == "" {
		mailboxID = user.MailboxID
	}

	if r.Method == "MKCALENDAR" {
		if !authorizeMailboxAccess(w, user, mailboxID) {
			return
		}
		calUUID, err := uuid.Parse(calendarID)
		if err != nil {
			calUUID = uuid.NewSHA1(uuid.NameSpaceOID, []byte(mailboxID+":"+calendarID))
		}
		bodyBytes, _ := io.ReadAll(io.LimitReader(r.Body, 64*1024))
		displayName := calendarID
		re := regexp.MustCompile(`(?i)<(?:D:)?displayname>([^<]+)</(?:D:)?displayname>`)
		if m := re.FindSubmatch(bodyBytes); len(m) > 1 {
			displayName = strings.TrimSpace(string(m[1]))
		}

		_, err = conn.Exec(ctx, `
			INSERT INTO user_calendars (id, mailbox_id, name, color, is_default)
			VALUES ($1, $2, $3, '#9E725F', false)
			ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
		`, calUUID.String(), mailboxID, displayName)
		if err != nil {
			http.Error(w, fmt.Sprintf("Failed to create calendar: %v", err), http.StatusInternalServerError)
			return
		}

		w.Header().Set("Location", fmt.Sprintf("/dav/calendars/%s/%s/", mailboxID, calUUID.String()))
		w.WriteHeader(http.StatusCreated)
		return
	}

	cal, perm, err := resolveCalendarAccess(ctx, conn, user, mailboxID, calendarID, r.Method == "DELETE" || r.Method == "PROPPATCH")
	if err != nil {
		if strings.Contains(err.Error(), "forbidden") {
			http.Error(w, err.Error(), http.StatusForbidden)
		} else {
			http.Error(w, err.Error(), http.StatusNotFound)
		}
		return
	}

	calURL := fmt.Sprintf("/dav/calendars/%s/%s/", mailboxID, calendarID)

	switch r.Method {
	case "PROPFIND":
		depth := r.Header.Get("Depth")
		ctag := fmt.Sprintf("\"%s\"", cal.UpdatedAt)
		t, _ := time.Parse(time.RFC3339, cal.UpdatedAt)
		syncToken := fmt.Sprintf("data:sync,%d", t.UnixNano())

		privileges := "<D:privilege><D:read/></D:privilege>"
		if perm == "owner" || perm == "write" {
			privileges += "<D:privilege><D:write/></D:privilege><D:privilege><D:write-content/></D:privilege>"
		}

		var responses []DavResponse
		responses = append(responses, DavResponse{
			Href: calURL,
			PropStats: []DavPropStat{
				{
					Status: "HTTP/1.1 200 OK",
					Props: map[string]string{
						"D:resourcetype":                     "<D:collection/><C:calendar/>",
						"D:displayname":                      cal.Name,
						"CS:getctag":                         ctag,
						"D:sync-token":                       syncToken,
						"C:supported-calendar-component-set": "<C:comp name=\"VEVENT\"/>",
						"D:current-user-privilege-set":       privileges,
					},
				},
			},
		})

		if depth != "0" {
			rows, err := conn.Query(ctx, `
				SELECT id::text, mailbox_id::text, calendar_id::text, start_time, end_time, is_all_day, rrule, status, encrypted_payload, updated_at
				FROM calendar_events
				WHERE calendar_id = $1
				ORDER BY start_time ASC
			`, calendarID)
			if err == nil {
				defer rows.Close()
				for rows.Next() {
					var id, mID, cID, status string
					var startTime, endTime, updatedAt time.Time
					var isAllDay bool
					var rrule *string
					var payload []byte

					if err := rows.Scan(&id, &mID, &cID, &startTime, &endTime, &isAllDay, &rrule, &status, &payload, &updatedAt); err == nil {
						etag := computeCalendarEventETag(id, mID, cID, startTime, endTime, isAllDay, rrule, status, payload, updatedAt)
						eventHref := fmt.Sprintf("/dav/calendars/%s/%s/%s.ics", mailboxID, calendarID, id)

						responses = append(responses, DavResponse{
							Href: eventHref,
							PropStats: []DavPropStat{
								{
									Status: "HTTP/1.1 200 OK",
									Props: map[string]string{
										"D:getetag":        fmt.Sprintf("\"%s\"", etag),
										"D:getcontenttype": "text/calendar; charset=utf-8",
										"D:resourcetype":   "",
									},
								},
							},
						})
					}
				}
			}
		}

		writeMultiStatus(w, responses)
		return

	case "REPORT":
		bodyBytes, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		bodyStr := string(bodyBytes)

		// 1. Calendar Query REPORT
		if strings.Contains(bodyStr, "calendar-query") {
			var filterStart, filterEnd time.Time
			reTime := regexp.MustCompile(`(?i)<(?:C:)?time-range\s+start="([^"]+)"\s+end="([^"]+)"`)
			if m := reTime.FindStringSubmatch(bodyStr); len(m) == 3 {
				filterStart, _, _ = parseIcsTimestamp(m[1])
				filterEnd, _, _ = parseIcsTimestamp(m[2])
			}

			query := `
				SELECT id::text, mailbox_id::text, calendar_id::text, start_time, end_time, is_all_day, rrule, status, encrypted_payload, updated_at
				FROM calendar_events
				WHERE calendar_id = $1
			`
			args := []interface{}{calendarID}
			if !filterStart.IsZero() && !filterEnd.IsZero() {
				query += ` AND start_time <= $3 AND end_time >= $2`
				args = append(args, filterStart, filterEnd)
			}
			query += ` ORDER BY start_time ASC`

			rows, err := conn.Query(ctx, query, args...)
			if err != nil {
				http.Error(w, "Query failed", http.StatusInternalServerError)
				return
			}
			defer rows.Close()

			var responses []DavResponse
			for rows.Next() {
				var id, mID, cID, status string
				var startTime, endTime, updatedAt time.Time
				var isAllDay bool
				var rrule *string
				var payload []byte

				if err := rows.Scan(&id, &mID, &cID, &startTime, &endTime, &isAllDay, &rrule, &status, &payload, &updatedAt); err == nil {
					etag := computeCalendarEventETag(id, mID, cID, startTime, endTime, isAllDay, rrule, status, payload, updatedAt)
					eventHref := fmt.Sprintf("/dav/calendars/%s/%s/%s.ics", mailboxID, calendarID, id)

					pt, _ := decryptCalendarEventPayloadGo(user.MailboxSk, mID, payload)
					rruleStr := ""
					if rrule != nil {
						rruleStr = *rrule
					}
					uid := pt.UID
					if uid == "" {
						uid = id
					}

					master := CalDavParsedEvent{
						UID:         uid,
						Summary:     pt.Title,
						Description: pt.Description,
						Location:    pt.Location,
						StartTime:   startTime,
						EndTime:     endTime,
						IsAllDay:    isAllDay,
						RRule:       rruleStr,
						Status:      status,
						Attendees:   pt.Attendees,
					}

					// Query exceptions
					var exceptions []CalDavParsedEvent
					excRows, excErr := conn.Query(ctx, `
						SELECT recurrence_id, is_cancelled, start_time, end_time, is_all_day, status, encrypted_payload
						FROM calendar_event_exceptions
						WHERE parent_event_id = $1
					`, id)
					if excErr == nil {
						for excRows.Next() {
							var recID, eStatus string
							var isCanc, isAll bool
							var eStart, eEnd time.Time
							var ePayload []byte
							if excRows.Scan(&recID, &isCanc, &eStart, &eEnd, &isAll, &eStatus, &ePayload) == nil {
								ePt, _ := decryptCalendarEventPayloadGo(user.MailboxSk, mID, ePayload)
								exceptions = append(exceptions, CalDavParsedEvent{
									UID:          uid,
									RecurrenceID: recID,
									IsCancelled:  isCanc,
									StartTime:    eStart,
									EndTime:      eEnd,
									IsAllDay:     isAll,
									Status:       eStatus,
									Summary:      ePt.Title,
									Description:  ePt.Description,
									Location:     ePt.Location,
								})
							}
						}
						excRows.Close()
					}

					icsData := formatEventToICalendar(master, exceptions)

					responses = append(responses, DavResponse{
						Href: eventHref,
						PropStats: []DavPropStat{
							{
								Status: "HTTP/1.1 200 OK",
								Props: map[string]string{
									"D:getetag":       fmt.Sprintf("\"%s\"", etag),
									"C:calendar-data": "<![CDATA[" + icsData + "]]>",
								},
							},
						},
					})
				}
			}

			writeMultiStatus(w, responses)
			return
		}

		// 2. Calendar Multiget REPORT
		if strings.Contains(bodyStr, "calendar-multiget") {
			reHref := regexp.MustCompile(`(?i)<(?:D:)?href>([^<]+)</(?:D:)?href>`)
			matches := reHref.FindAllStringSubmatch(bodyStr, -1)

			var responses []DavResponse
			for _, m := range matches {
				href := m[1]
				resName := path.Base(href)
				resUUIDStr := strings.TrimSuffix(resName, ".ics")
				eventUUID, err := uuid.Parse(resUUIDStr)
				if err != nil {
					eventUUID = uuid.NewSHA1(uuid.NameSpaceOID, []byte(cal.ID+":"+resUUIDStr))
				}

				var id, mID, cID, status string
				var startTime, endTime, updatedAt time.Time
				var isAllDay bool
				var rrule *string
				var payload []byte

				err = conn.QueryRow(ctx, `
					SELECT id::text, mailbox_id::text, calendar_id::text, start_time, end_time, is_all_day, rrule, status, encrypted_payload, updated_at
					FROM calendar_events
					WHERE id = $1 AND calendar_id = $2
				`, eventUUID.String(), calendarID).Scan(&id, &mID, &cID, &startTime, &endTime, &isAllDay, &rrule, &status, &payload, &updatedAt)

				if err == pgx.ErrNoRows {
					responses = append(responses, DavResponse{
						Href: href,
						PropStats: []DavPropStat{
							{
								Status: "HTTP/1.1 404 Not Found",
							},
						},
					})
					continue
				}

				etag := computeCalendarEventETag(id, mID, cID, startTime, endTime, isAllDay, rrule, status, payload, updatedAt)
				pt, _ := decryptCalendarEventPayloadGo(user.MailboxSk, mID, payload)
				rruleStr := ""
				if rrule != nil {
					rruleStr = *rrule
				}
				uid := pt.UID
				if uid == "" {
					uid = id
				}

				master := CalDavParsedEvent{
					UID:         uid,
					Summary:     pt.Title,
					Description: pt.Description,
					Location:    pt.Location,
					StartTime:   startTime,
					EndTime:     endTime,
					IsAllDay:    isAllDay,
					RRule:       rruleStr,
					Status:      status,
					Attendees:   pt.Attendees,
				}

				icsData := formatEventToICalendar(master, nil)
				responses = append(responses, DavResponse{
					Href: href,
					PropStats: []DavPropStat{
						{
							Status: "HTTP/1.1 200 OK",
							Props: map[string]string{
								"D:getetag":       fmt.Sprintf("\"%s\"", etag),
								"C:calendar-data": "<![CDATA[" + icsData + "]]>",
							},
						},
					},
				})
			}

			writeMultiStatus(w, responses)
			return
		}

		// 3. Collection Synchronization REPORT (RFC 6578)
		if strings.Contains(bodyStr, "sync-collection") {
			reToken := regexp.MustCompile(`(?i)<(?:D:)?sync-token>([^<]*)</(?:D:)?sync-token>`)
			syncSinceNano := int64(0)
			if m := reToken.FindStringSubmatch(bodyStr); len(m) > 1 {
				tokenVal := strings.TrimSpace(m[1])
				if strings.HasPrefix(tokenVal, "data:sync,") {
					syncSinceNano, _ = strconv.ParseInt(strings.TrimPrefix(tokenVal, "data:sync,"), 10, 64)
				}
			}

			query := `
				SELECT id::text, mailbox_id::text, calendar_id::text, start_time, end_time, is_all_day, rrule, status, encrypted_payload, updated_at
				FROM calendar_events
				WHERE calendar_id = $1
			`
			args := []interface{}{calendarID}
			if syncSinceNano > 0 {
				query += ` AND updated_at > to_timestamp($2 / 1000000000.0)`
				args = append(args, syncSinceNano)
			}
			query += ` ORDER BY updated_at ASC`

			rows, err := conn.Query(ctx, query, args...)
			if err != nil {
				http.Error(w, "Query failed", http.StatusInternalServerError)
				return
			}
			defer rows.Close()

			var responses []DavResponse
			for rows.Next() {
				var id, mID, cID, status string
				var startTime, endTime, updatedAt time.Time
				var isAllDay bool
				var rrule *string
				var payload []byte

				if rows.Scan(&id, &mID, &cID, &startTime, &endTime, &isAllDay, &rrule, &status, &payload, &updatedAt) == nil {
					etag := computeCalendarEventETag(id, mID, cID, startTime, endTime, isAllDay, rrule, status, payload, updatedAt)
					eventHref := fmt.Sprintf("/dav/calendars/%s/%s/%s.ics", mailboxID, calendarID, id)

					pt, _ := decryptCalendarEventPayloadGo(user.MailboxSk, mID, payload)
					rruleStr := ""
					if rrule != nil {
						rruleStr = *rrule
					}
					uid := pt.UID
					if uid == "" {
						uid = id
					}

					master := CalDavParsedEvent{
						UID:         uid,
						Summary:     pt.Title,
						Description: pt.Description,
						Location:    pt.Location,
						StartTime:   startTime,
						EndTime:     endTime,
						IsAllDay:    isAllDay,
						RRule:       rruleStr,
						Status:      status,
						Attendees:   pt.Attendees,
					}

					icsData := formatEventToICalendar(master, nil)
					responses = append(responses, DavResponse{
						Href: eventHref,
						PropStats: []DavPropStat{
							{
								Status: "HTTP/1.1 200 OK",
								Props: map[string]string{
									"D:getetag":       fmt.Sprintf("\"%s\"", etag),
									"C:calendar-data": "<![CDATA[" + icsData + "]]>",
								},
							},
						},
					})
				}
			}

			// Add updated sync-token to multistatus
			t, _ := time.Parse(time.RFC3339, cal.UpdatedAt)
			newSyncToken := fmt.Sprintf("data:sync,%d", t.UnixNano())
			responses = append(responses, DavResponse{
				Href: calURL,
				PropStats: []DavPropStat{
					{
						Status: "HTTP/1.1 200 OK",
						Props: map[string]string{
							"D:sync-token": newSyncToken,
						},
					},
				},
			})

			writeMultiStatus(w, responses)
			return
		}

		http.Error(w, "Unsupported REPORT query", http.StatusBadRequest)
		return

	case "PROPPATCH":
		bodyBytes, _ := io.ReadAll(io.LimitReader(r.Body, 64*1024))
		reName := regexp.MustCompile(`(?i)<(?:D:)?displayname>([^<]+)</(?:D:)?displayname>`)
		if m := reName.FindSubmatch(bodyBytes); len(m) > 1 {
			newName := strings.TrimSpace(string(m[1]))
			_, _ = conn.Exec(ctx, `UPDATE user_calendars SET name = $1, updated_at = now() WHERE id = $2`, newName, calendarID)
		}
		writeMultiStatus(w, []DavResponse{
			{
				Href: calURL,
				PropStats: []DavPropStat{
					{
						Status: "HTTP/1.1 200 OK",
					},
				},
			},
		})
		return

	case "DELETE":
		if perm != "owner" {
			http.Error(w, "Forbidden: only calendar owner can delete collection", http.StatusForbidden)
			return
		}
		var count int
		_ = conn.QueryRow(ctx, `SELECT count(*) FROM user_calendars WHERE mailbox_id = $1`, mailboxID).Scan(&count)
		if count <= 1 {
			http.Error(w, "Cannot delete only remaining calendar", http.StatusBadRequest)
			return
		}

		_, err = conn.Exec(ctx, `DELETE FROM user_calendars WHERE id = $1 AND mailbox_id = $2`, calendarID, mailboxID)
		if err != nil {
			http.Error(w, "Delete failed", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

// calDavResourceHandler handles /dav/calendars/{mailbox_id}/{calendar_id}/{resource_name}
func calDavResourceHandler(w http.ResponseWriter, r *http.Request) {
	setDavHeaders(w)
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}

	ctx := r.Context()
	conn, err := getDBConn(ctx)
	if err != nil {
		http.Error(w, "Database error", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	user, ok := authenticateCalDav(w, r, conn, ctx)
	if !ok {
		return
	}

	mailboxID := r.PathValue("mailbox_id")
	calendarID := r.PathValue("calendar_id")
	resourceName := r.PathValue("resource_name")
	if mailboxID == "" {
		mailboxID = user.MailboxID
	}

	cal, perm, err := resolveCalendarAccess(ctx, conn, user, mailboxID, calendarID, r.Method == "PUT" || r.Method == "DELETE")
	if err != nil {
		if strings.Contains(err.Error(), "forbidden") {
			http.Error(w, err.Error(), http.StatusForbidden)
		} else {
			http.Error(w, err.Error(), http.StatusNotFound)
		}
		return
	}

	cleanName := strings.TrimSuffix(resourceName, ".ics")
	eventUUID, err := uuid.Parse(cleanName)
	if err != nil {
		eventUUID = uuid.NewSHA1(uuid.NameSpaceOID, []byte(cal.ID+":"+cleanName))
	}

	switch r.Method {
	case http.MethodGet, http.MethodHead:
		var id, mID, cID, status string
		var startTime, endTime, updatedAt time.Time
		var isAllDay bool
		var rrule *string
		var payload []byte

		err = conn.QueryRow(ctx, `
			SELECT id::text, mailbox_id::text, calendar_id::text, start_time, end_time, is_all_day, rrule, status, encrypted_payload, updated_at
			FROM calendar_events
			WHERE id = $1 AND calendar_id = $2
		`, eventUUID.String(), cal.ID).Scan(&id, &mID, &cID, &startTime, &endTime, &isAllDay, &rrule, &status, &payload, &updatedAt)

		if err == pgx.ErrNoRows {
			http.Error(w, "Event not found", http.StatusNotFound)
			return
		}
		if err != nil {
			http.Error(w, "Database error", http.StatusInternalServerError)
			return
		}

		etag := computeCalendarEventETag(id, mID, cID, startTime, endTime, isAllDay, rrule, status, payload, updatedAt)
		w.Header().Set("ETag", fmt.Sprintf("\"%s\"", etag))
		w.Header().Set("Content-Type", "text/calendar; charset=utf-8")

		if match := r.Header.Get("If-None-Match"); match != "" {
			if match == "*" || match == fmt.Sprintf("\"%s\"", etag) || match == etag {
				w.WriteHeader(http.StatusNotModified)
				return
			}
		}

		pt, _ := decryptCalendarEventPayloadGo(user.MailboxSk, mID, payload)
		rruleStr := ""
		if rrule != nil {
			rruleStr = *rrule
		}
		uid := pt.UID
		if uid == "" {
			uid = id
		}

		master := CalDavParsedEvent{
			UID:         uid,
			Summary:     pt.Title,
			Description: pt.Description,
			Location:    pt.Location,
			StartTime:   startTime,
			EndTime:     endTime,
			IsAllDay:    isAllDay,
			RRule:       rruleStr,
			Status:      status,
			Attendees:   pt.Attendees,
		}

		var exceptions []CalDavParsedEvent
		excRows, excErr := conn.Query(ctx, `
			SELECT recurrence_id, is_cancelled, start_time, end_time, is_all_day, status, encrypted_payload
			FROM calendar_event_exceptions
			WHERE parent_event_id = $1
		`, id)
		if excErr == nil {
			for excRows.Next() {
				var recID, eStatus string
				var isCanc, isAll bool
				var eStart, eEnd time.Time
				var ePayload []byte
				if excRows.Scan(&recID, &isCanc, &eStart, &eEnd, &isAll, &eStatus, &ePayload) == nil {
					ePt, _ := decryptCalendarEventPayloadGo(user.MailboxSk, mID, ePayload)
					exceptions = append(exceptions, CalDavParsedEvent{
						UID:          uid,
						RecurrenceID: recID,
						IsCancelled:  isCanc,
						StartTime:    eStart,
						EndTime:      eEnd,
						IsAllDay:     isAll,
						Status:       eStatus,
						Summary:      ePt.Title,
						Description:  ePt.Description,
						Location:     ePt.Location,
					})
				}
			}
			excRows.Close()
		}

		ics := formatEventToICalendar(master, exceptions)
		if r.Method == http.MethodHead {
			w.WriteHeader(http.StatusOK)
			return
		}
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(ics))
		return

	case http.MethodPut:
		if perm != "owner" && perm != "write" {
			http.Error(w, "Forbidden: read-only calendar access", http.StatusForbidden)
			return
		}

		bodyBytes, err := io.ReadAll(io.LimitReader(r.Body, 512*1024))
		if err != nil || len(bodyBytes) == 0 {
			http.Error(w, "Missing or empty iCalendar body", http.StatusBadRequest)
			return
		}

		parsedEvents, err := parseICalendar(string(bodyBytes))
		if err != nil || len(parsedEvents) == 0 {
			http.Error(w, "Invalid RFC 5545 iCalendar content", http.StatusBadRequest)
			return
		}

		// Find master event (no recurrence-id)
		var master *CalDavParsedEvent
		var exceptions []CalDavParsedEvent
		for i := range parsedEvents {
			if parsedEvents[i].RecurrenceID == "" {
				master = &parsedEvents[i]
			} else {
				exceptions = append(exceptions, parsedEvents[i])
			}
		}

		if master == nil && len(exceptions) > 0 {
			// Single exception event update
			master = &exceptions[0]
		}
		if master == nil {
			http.Error(w, "No valid VEVENT component found", http.StatusBadRequest)
			return
		}

		// Precondition checks
		var existingID, existingMID, existingCID, existingStatus string
		var existingStart, existingEnd, existingUpdated time.Time
		var existingAllDay bool
		var existingRrule *string
		var existingPayload []byte

		err = conn.QueryRow(ctx, `
			SELECT id::text, mailbox_id::text, calendar_id::text, start_time, end_time, is_all_day, rrule, status, encrypted_payload, updated_at
			FROM calendar_events
			WHERE id = $1 AND calendar_id = $2
		`, eventUUID.String(), cal.ID).Scan(&existingID, &existingMID, &existingCID, &existingStart, &existingEnd, &existingAllDay, &existingRrule, &existingStatus, &existingPayload, &existingUpdated)

		exists := err == nil
		if ifNoneMatch := r.Header.Get("If-None-Match"); ifNoneMatch == "*" && exists {
			http.Error(w, "Precondition Failed: event already exists", http.StatusPreconditionFailed)
			return
		}

		if ifMatch := r.Header.Get("If-Match"); ifMatch != "" && exists {
			curETag := computeCalendarEventETag(existingID, existingMID, existingCID, existingStart, existingEnd, existingAllDay, existingRrule, existingStatus, existingPayload, existingUpdated)
			if ifMatch != fmt.Sprintf("\"%s\"", curETag) && ifMatch != curETag {
				http.Error(w, "Precondition Failed: ETag mismatch", http.StatusPreconditionFailed)
				return
			}
		}

		pt := CalDavEventPlaintext{
			Title:       master.Summary,
			Description: master.Description,
			Location:    master.Location,
			Timezone:    master.Timezone,
			UID:         master.UID,
			Sequence:    master.Sequence,
			Attendees:   master.Attendees,
			RRule:       master.RRule,
		}

		encPayload, err := encryptCalendarEventPayloadGo(user.MailboxSk, cal.MailboxID, pt)
		if err != nil {
			http.Error(w, fmt.Sprintf("Encryption error: %v", err), http.StatusInternalServerError)
			return
		}

		// Save in transaction
		tx, err := conn.Begin(ctx)
		if err != nil {
			http.Error(w, "Transaction start failed", http.StatusInternalServerError)
			return
		}
		defer tx.Rollback(ctx)

		var rrulePtr *string
		if master.RRule != "" {
			rrulePtr = &master.RRule
		}

		_, err = tx.Exec(ctx, `
			INSERT INTO calendar_events (
				id, mailbox_id, calendar_id, start_time, end_time, is_all_day, rrule, status, encrypted_payload
			) VALUES (
				$1, $2, $3, $4, $5, $6, $7, $8, $9
			)
			ON CONFLICT (id) DO UPDATE SET
				calendar_id = EXCLUDED.calendar_id,
				start_time = EXCLUDED.start_time,
				end_time = EXCLUDED.end_time,
				is_all_day = EXCLUDED.is_all_day,
				rrule = EXCLUDED.rrule,
				status = EXCLUDED.status,
				encrypted_payload = EXCLUDED.encrypted_payload,
				updated_at = now()
		`, eventUUID.String(), cal.MailboxID, cal.ID, master.StartTime, master.EndTime, master.IsAllDay, rrulePtr, master.Status, encPayload)

		if err != nil {
			http.Error(w, fmt.Sprintf("Failed to persist event: %v", err), http.StatusInternalServerError)
			return
		}

		// Persist exceptions
		for _, exc := range exceptions {
			excPt := CalDavEventPlaintext{
				Title:       exc.Summary,
				Description: exc.Description,
				Location:    exc.Location,
				UID:         master.UID,
				Sequence:    exc.Sequence,
			}
			excEnc, excErr := encryptCalendarEventPayloadGo(user.MailboxSk, cal.MailboxID, excPt)
			if excErr == nil {
				_, _ = tx.Exec(ctx, `
					INSERT INTO calendar_event_exceptions (
						parent_event_id, mailbox_id, calendar_id, recurrence_id, is_cancelled,
						start_time, end_time, is_all_day, status, encrypted_payload
					) VALUES (
						$1, $2, $3, $4, $5, $6, $7, $8, $9, $10
					)
					ON CONFLICT (parent_event_id, recurrence_id) DO UPDATE SET
						is_cancelled = EXCLUDED.is_cancelled,
						start_time = EXCLUDED.start_time,
						end_time = EXCLUDED.end_time,
						is_all_day = EXCLUDED.is_all_day,
						status = EXCLUDED.status,
						encrypted_payload = EXCLUDED.encrypted_payload,
						updated_at = now()
				`, eventUUID.String(), cal.MailboxID, cal.ID, exc.RecurrenceID, exc.IsCancelled, exc.StartTime, exc.EndTime, exc.IsAllDay, exc.Status, excEnc)
			}
		}

		// Touch calendar updated_at
		_, _ = tx.Exec(ctx, `UPDATE user_calendars SET updated_at = now() WHERE id = $1`, cal.ID)

		if err := tx.Commit(ctx); err != nil {
			http.Error(w, "Commit failed", http.StatusInternalServerError)
			return
		}

		// Re-query updated_at for strong ETag
		var newUpdatedAt time.Time
		_ = conn.QueryRow(ctx, `SELECT updated_at FROM calendar_events WHERE id = $1`, eventUUID.String()).Scan(&newUpdatedAt)

		etag := computeCalendarEventETag(eventUUID.String(), cal.MailboxID, cal.ID, master.StartTime, master.EndTime, master.IsAllDay, rrulePtr, master.Status, encPayload, newUpdatedAt)
		w.Header().Set("ETag", fmt.Sprintf("\"%s\"", etag))
		w.Header().Set("Location", r.URL.Path)

		if exists {
			w.WriteHeader(http.StatusNoContent)
		} else {
			w.WriteHeader(http.StatusCreated)
		}
		return

	case http.MethodDelete:
		if perm != "owner" && perm != "write" {
			http.Error(w, "Forbidden: read-only calendar access", http.StatusForbidden)
			return
		}

		var id, mID, cID, status string
		var startTime, endTime, updatedAt time.Time
		var isAllDay bool
		var rrule *string
		var payload []byte

		err = conn.QueryRow(ctx, `
			SELECT id::text, mailbox_id::text, calendar_id::text, start_time, end_time, is_all_day, rrule, status, encrypted_payload, updated_at
			FROM calendar_events
			WHERE id = $1 AND calendar_id = $2
		`, eventUUID.String(), cal.ID).Scan(&id, &mID, &cID, &startTime, &endTime, &isAllDay, &rrule, &status, &payload, &updatedAt)

		if err == pgx.ErrNoRows {
			http.Error(w, "Event not found", http.StatusNotFound)
			return
		}

		if ifMatch := r.Header.Get("If-Match"); ifMatch != "" {
			curETag := computeCalendarEventETag(id, mID, cID, startTime, endTime, isAllDay, rrule, status, payload, updatedAt)
			if ifMatch != fmt.Sprintf("\"%s\"", curETag) && ifMatch != curETag {
				http.Error(w, "Precondition Failed: ETag mismatch", http.StatusPreconditionFailed)
				return
			}
		}

		_, err = conn.Exec(ctx, `DELETE FROM calendar_events WHERE id = $1 AND calendar_id = $2`, eventUUID.String(), cal.ID)
		if err != nil {
			http.Error(w, "Delete failed", http.StatusInternalServerError)
			return
		}
		_, _ = conn.Exec(ctx, `UPDATE user_calendars SET updated_at = now() WHERE id = $1`, cal.ID)

		w.WriteHeader(http.StatusNoContent)
		return

	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}
