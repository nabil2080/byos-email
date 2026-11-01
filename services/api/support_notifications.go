package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"html"
	"io"
	"math/big"
	"mime"
	"mime/multipart"
	"net/mail"
	"net/smtp"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

var (
	ErrInvalidReplyToken   = errors.New("invalid or revoked reply token")
	ErrExpiredReplyToken   = errors.New("reply token has expired")
	ErrSenderMismatch      = errors.New("sender email does not match ticket customer")
	ErrDuplicateInboundMsg = errors.New("inbound message already processed")
	ErrTicketClosed        = errors.New("ticket is permanently closed")
)

type ReplyTokenRecord struct {
	ID             uuid.UUID
	TicketID       uuid.UUID
	CustomerUserID uuid.UUID
	CustomerEmail  string
	IsRevoked      bool
	ExpiresAt      time.Time
}

func getSupportEmailDomain() string {
	dom := strings.TrimSpace(os.Getenv("SUPPORT_EMAIL_DOMAIN"))
	if dom != "" {
		return dom
	}
	return "support.byos.local"
}

func getSupportFromAddress() string {
	addr := strings.TrimSpace(os.Getenv("SUPPORT_FROM_EMAIL"))
	if addr != "" {
		return addr
	}
	return fmt.Sprintf("BYOS Support <support@%s>", getSupportEmailDomain())
}

// GenerateReplyToken creates a 256-bit secure cryptographic reply token,
// stores its SHA-256 hash in support_reply_tokens, and constructs the Reply-To address.
// Raw token is NEVER persisted to disk or logged.
func GenerateReplyToken(ctx context.Context, tx pgx.Tx, ticketID uuid.UUID, customerUserID uuid.UUID, customerEmail string, validity time.Duration) (string, string, error) {
	if validity <= 0 {
		validity = 30 * 24 * time.Hour // 30 days default
	}

	rawBytes := make([]byte, 32) // 256 bits of secure random entropy
	if _, err := rand.Read(rawBytes); err != nil {
		return "", "", fmt.Errorf("crypto rand failed: %w", err)
	}
	rawToken := hex.EncodeToString(rawBytes)
	tokenHash := sha256.Sum256([]byte(rawToken))

	expiresAt := time.Now().Add(validity)

	insertSQL := `
		INSERT INTO support_reply_tokens (
			ticket_id, customer_user_id, customer_email, token_hash, is_revoked, expires_at
		) VALUES ($1, $2, $3, $4, false, $5)
	`
	_, err := tx.Exec(ctx, insertSQL, ticketID, customerUserID, strings.ToLower(strings.TrimSpace(customerEmail)), tokenHash[:], expiresAt)
	if err != nil {
		return "", "", fmt.Errorf("failed to persist reply token hash: %w", err)
	}

	replyToAddress := fmt.Sprintf("BYOS Support <reply+%s@%s>", rawToken, getSupportEmailDomain())
	return rawToken, replyToAddress, nil
}

// ValidateReplyToken extracts and verifies a raw reply token against the database,
// checking token hash, expiration, revocation, and sender identity.
func ValidateReplyToken(ctx context.Context, tx pgx.Tx, rawToken string, senderEmail string) (*ReplyTokenRecord, error) {
	cleanToken := strings.TrimSpace(rawToken)
	if len(cleanToken) != 64 {
		return nil, ErrInvalidReplyToken
	}

	tokenHash := sha256.Sum256([]byte(cleanToken))

	var record ReplyTokenRecord
	querySQL := `
		SELECT id, ticket_id, customer_user_id, customer_email, is_revoked, expires_at
		FROM support_reply_tokens
		WHERE token_hash = $1
	`
	err := tx.QueryRow(ctx, querySQL, tokenHash[:]).Scan(
		&record.ID, &record.TicketID, &record.CustomerUserID, &record.CustomerEmail,
		&record.IsRevoked, &record.ExpiresAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrInvalidReplyToken
		}
		return nil, fmt.Errorf("token query failed: %w", err)
	}

	if record.IsRevoked {
		return nil, ErrInvalidReplyToken
	}

	if time.Now().After(record.ExpiresAt) {
		return nil, ErrExpiredReplyToken
	}

	// Strict Sender Identity Validation: From address must match customer email
	normalizedSender := strings.ToLower(strings.TrimSpace(senderEmail))
	normalizedCustomer := strings.ToLower(strings.TrimSpace(record.CustomerEmail))
	if subtle.ConstantTimeCompare([]byte(normalizedSender), []byte(normalizedCustomer)) != 1 {
		return nil, ErrSenderMismatch
	}

	// Update last_used_at timestamp
	_, _ = tx.Exec(ctx, `UPDATE support_reply_tokens SET last_used_at = now() WHERE id = $1`, record.ID)

	return &record, nil
}

// QueueNotificationEvent inserts an outbound email notification into the transactional outbox.
func QueueNotificationEvent(
	ctx context.Context,
	tx pgx.Tx,
	eventType string,
	ticketID uuid.UUID,
	ticketNumber string,
	recipientEmail string,
	recipientName string,
	subject string,
	bodyText string,
	bodyHTML string,
	replyToAddress string,
) error {
	eventID := uuid.New()
	insertSQL := `
		INSERT INTO support_notification_outbox (
			event_id, event_type, ticket_id, ticket_number,
			recipient_email, recipient_name, subject, body_text, bodyHTML, reply_to_address,
			status, attempts, next_attempt_at
		) VALUES (
			$1, $2, $3, $4,
			$5, $6, $7, $8, $9, $10,
			'pending', 0, now()
		)
	`
	_, err := tx.Exec(ctx, insertSQL,
		eventID, eventType, ticketID, ticketNumber,
		strings.ToLower(strings.TrimSpace(recipientEmail)), strings.TrimSpace(recipientName),
		strings.TrimSpace(subject), bodyText, bodyHTML, replyToAddress,
	)
	if err != nil {
		return fmt.Errorf("failed to queue notification event: %w", err)
	}
	return nil
}

// ─────────────────────────────────────────────────────────────
// Notification Email Templates
// ─────────────────────────────────────────────────────────────

func RenderTicketCreatedNotification(ticketNumber, ticketSubject, customerName, ticketURL string) (string, string, string) {
	escapedSubject := html.EscapeString(ticketSubject)
	escapedName := html.EscapeString(customerName)
	if escapedName == "" {
		escapedName = "Valued Customer"
	}

	subj := fmt.Sprintf("[BYOS Support #%s] Ticket Received: %s", ticketNumber, ticketSubject)

	bodyText := fmt.Sprintf(`Hello %s,

Thank you for reaching out to BYOS Support. We have received your request and a member of our support team will review it shortly.

Ticket Details:
- Ticket Number: %s
- Subject: %s

You can view your ticket and follow updates directly in the BYOS Control Panel:
%s

You can also reply directly to this email at any time to add more information to your ticket.

Regards,
BYOS Support Team
`, customerName, ticketNumber, ticketSubject, ticketURL)

	bodyHTML := fmt.Sprintf(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #2B2C2D; line-height: 1.5; padding: 20px; background-color: #F8F7F4;">
  <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #E2DFD8; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
    <div style="background-color: #9E725F; padding: 18px 24px; color: #ffffff;">
      <h2 style="margin: 0; font-size: 18px; font-weight: 700;">BYOS Support</h2>
    </div>
    <div style="padding: 24px;">
      <p style="font-size: 15px;">Hello <strong>%s</strong>,</p>
      <p style="font-size: 14px;">We have received your support request. Our team will review it promptly.</p>
      <div style="background: #F0EEE9; border-radius: 8px; padding: 14px; margin: 18px 0; font-size: 13px;">
        <p style="margin: 0 0 6px 0;"><strong>Ticket Number:</strong> <span style="font-family: monospace; color: #9E725F;">%s</span></p>
        <p style="margin: 0;"><strong>Subject:</strong> %s</p>
      </div>
      <p style="font-size: 14px;">You can view the ticket in your Help Desk or simply <strong>reply to this email</strong> to add details.</p>
      <div style="margin: 24px 0 12px 0;">
        <a href="%s" style="background-color: #9E725F; color: #ffffff; text-decoration: none; font-size: 13px; font-weight: 600; padding: 10px 18px; border-radius: 8px; display: inline-block;">View Ticket in Help Desk</a>
      </div>
    </div>
    <div style="border-top: 1px solid #E2DFD8; padding: 14px 24px; font-size: 11px; color: #878A8E; background-color: #FAF9F6;">
      🔒 Zero-Knowledge Platform: This email never contains private key material or encrypted mailbox data.
    </div>
  </div>
</body>
</html>`, escapedName, ticketNumber, escapedSubject, ticketURL)

	return subj, bodyText, bodyHTML
}

func RenderAgentReplyNotification(ticketNumber, ticketSubject, customerName, agentName, replySnippet, ticketURL string) (string, string, string) {
	escapedCustomer := html.EscapeString(customerName)
	if escapedCustomer == "" {
		escapedCustomer = "Valued Customer"
	}
	escapedAgent := html.EscapeString(agentName)
	escapedSnippet := html.EscapeString(replySnippet)

	subj := fmt.Sprintf("[BYOS Support #%s] Support Response: %s", ticketNumber, ticketSubject)

	bodyText := fmt.Sprintf(`Hello %s,

%s from BYOS Support has replied to your ticket (#%s):

"%s"

You can reply directly to this email to continue the conversation, or view the full thread in your BYOS Control Panel:
%s

Regards,
BYOS Support Team
`, customerName, agentName, ticketNumber, replySnippet, ticketURL)

	bodyHTML := fmt.Sprintf(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #2B2C2D; line-height: 1.5; padding: 20px; background-color: #F8F7F4;">
  <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #E2DFD8; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
    <div style="background-color: #9E725F; padding: 18px 24px; color: #ffffff;">
      <h2 style="margin: 0; font-size: 18px; font-weight: 700;">BYOS Support Update</h2>
    </div>
    <div style="padding: 24px;">
      <p style="font-size: 15px;">Hello <strong>%s</strong>,</p>
      <p style="font-size: 14px;"><strong>%s</strong> has responded to your ticket <span style="font-family: monospace; color: #9E725F;">#%s</span>:</p>
      <blockquote style="margin: 16px 0; padding: 12px 16px; background: #F8F7F4; border-left: 4px solid #9E725F; border-radius: 4px; font-size: 13px; color: #3C3D3E;">
        %s
      </blockquote>
      <p style="font-size: 14px;">You can <strong>reply directly to this email</strong> to respond, or view the full conversation online:</p>
      <div style="margin: 20px 0 10px 0;">
        <a href="%s" style="background-color: #9E725F; color: #ffffff; text-decoration: none; font-size: 13px; font-weight: 600; padding: 10px 18px; border-radius: 8px; display: inline-block;">Open Ticket Online</a>
      </div>
    </div>
    <div style="border-top: 1px solid #E2DFD8; padding: 14px 24px; font-size: 11px; color: #878A8E; background-color: #FAF9F6;">
      Reply-To is authenticated specifically for your ticket. Replies are automatically associated with ticket #%s.
    </div>
  </div>
</body>
</html>`, escapedCustomer, escapedAgent, ticketNumber, escapedSnippet, ticketURL, ticketNumber)

	return subj, bodyText, bodyHTML
}

func RenderCustomerReplyAlertForStaff(ticketNumber, ticketSubject, customerEmail, replySnippet, crmURL string) (string, string, string) {
	subj := fmt.Sprintf("[Support Staff Alert #%s] Inbound reply from %s", ticketNumber, customerEmail)

	bodyText := fmt.Sprintf(`Customer %s has replied to ticket #%s (%s):

"%s"

Open Support CRM to view and manage:
%s
`, customerEmail, ticketNumber, ticketSubject, replySnippet, crmURL)

	bodyHTML := fmt.Sprintf(`<!DOCTYPE html>
<html>
<body style="font-family: sans-serif; padding: 20px;">
  <h3>Staff Alert: New Customer Reply</h3>
  <p><strong>Customer:</strong> %s<br><strong>Ticket:</strong> #%s - %s</p>
  <blockquote style="background: #f0f0f0; padding: 10px; border-left: 3px solid #9E725F;">%s</blockquote>
  <p><a href="%s">Open in Support CRM</a></p>
</body>
</html>`, html.EscapeString(customerEmail), ticketNumber, html.EscapeString(ticketSubject), html.EscapeString(replySnippet), crmURL)

	return subj, bodyText, bodyHTML
}

func RenderTicketResolvedNotification(ticketNumber, ticketSubject, customerName, ticketURL string) (string, string, string) {
	escapedCustomer := html.EscapeString(customerName)
	if escapedCustomer == "" {
		escapedCustomer = "Valued Customer"
	}
	escapedSubject := html.EscapeString(ticketSubject)

	subj := fmt.Sprintf("[BYOS Support #%s] Resolved: %s", ticketNumber, ticketSubject)

	bodyText := fmt.Sprintf(`Hello %s,

Your support ticket #%s (%s) has been marked as resolved.

If you have further questions or if your issue is not completely resolved, simply reply to this email to automatically reopen the ticket.

Thank you for choosing BYOS.

Regards,
BYOS Support Team
`, customerName, ticketNumber, ticketSubject)

	bodyHTML := fmt.Sprintf(`<!DOCTYPE html>
<html>
<body style="font-family: sans-serif; padding: 20px;">
  <h2>BYOS Support - Ticket Resolved</h2>
  <p>Hello <strong>%s</strong>,</p>
  <p>Ticket <strong style="color: #9E725F;">#%s</strong> (<em>%s</em>) has been marked as resolved.</p>
  <p>If you need further assistance, you can reopen it at any time by simply replying to this email.</p>
</body>
</html>`, escapedCustomer, ticketNumber, escapedSubject)

	return subj, bodyText, bodyHTML
}

func RenderTicketAssignedNotification(ticketNumber, ticketSubject, agentName, crmURL string) (string, string, string) {
	subj := fmt.Sprintf("[Support Staff Alert #%s] Ticket Assigned: %s", ticketNumber, ticketSubject)

	bodyText := fmt.Sprintf(`Hello %s,

You have been assigned to support ticket #%s (%s).

Open Support CRM to view details:
%s
`, agentName, ticketNumber, ticketSubject, crmURL)

	bodyHTML := fmt.Sprintf(`<!DOCTYPE html>
<html>
<body style="font-family: sans-serif; padding: 20px;">
  <h3>Ticket Assignment</h3>
  <p>Hello <strong>%s</strong>, you have been assigned to ticket <strong style="color: #9E725F;">#%s</strong> (%s).</p>
  <p><a href="%s">View in Support CRM</a></p>
</body>
</html>`, html.EscapeString(agentName), ticketNumber, html.EscapeString(ticketSubject), crmURL)

	return subj, bodyText, bodyHTML
}

// ─────────────────────────────────────────────────────────────
// Outbox Worker & SMTP Delivery
// ─────────────────────────────────────────────────────────────

type OutboxNotificationItem struct {
	ID             uuid.UUID
	EventID        uuid.UUID
	EventType      string
	TicketID       uuid.UUID
	TicketNumber   string
	RecipientEmail string
	RecipientName  string
	Subject        string
	BodyText       string
	BodyHTML       string
	ReplyToAddress *string
	Status         string
	Attempts       int
	MaxAttempts    int
}

func getSMTPConfig() (host string, port string, user string, pass string) {
	host = os.Getenv("SUPPORT_SMTP_HOST")
	if host == "" {
		host = "127.0.0.1" // Mailpit default
	}
	port = os.Getenv("SUPPORT_SMTP_PORT")
	if port == "" {
		port = "1025" // Mailpit SMTP port
	}
	user = os.Getenv("SUPPORT_SMTP_USER")
	pass = os.Getenv("SUPPORT_SMTP_PASS")
	return
}

func buildRFC822Email(fromAddr, toAddr, replyToAddr, subject, bodyText, bodyHTML string) []byte {
	boundary := fmt.Sprintf("=_byos_%d_%x", time.Now().UnixNano(), randInt())

	var buf bytes.Buffer
	buf.WriteString(fmt.Sprintf("From: %s\r\n", fromAddr))
	buf.WriteString(fmt.Sprintf("To: %s\r\n", toAddr))
	if replyToAddr != "" {
		buf.WriteString(fmt.Sprintf("Reply-To: %s\r\n", replyToAddr))
	}
	buf.WriteString(fmt.Sprintf("Subject: %s\r\n", subject))
	buf.WriteString(fmt.Sprintf("Date: %s\r\n", time.Now().Format(time.RFC1123Z)))
	buf.WriteString(fmt.Sprintf("Message-ID: <%s@%s>\r\n", uuid.New().String(), getSupportEmailDomain()))
	buf.WriteString("MIME-Version: 1.0\r\n")
	buf.WriteString(fmt.Sprintf("Content-Type: multipart/alternative; boundary=\"%s\"\r\n", boundary))
	buf.WriteString("\r\n")

	// Text part
	buf.WriteString(fmt.Sprintf("--%s\r\n", boundary))
	buf.WriteString("Content-Type: text/plain; charset=UTF-8\r\n")
	buf.WriteString("Content-Transfer-Encoding: 7bit\r\n\r\n")
	buf.WriteString(bodyText)
	buf.WriteString("\r\n\r\n")

	// HTML part
	buf.WriteString(fmt.Sprintf("--%s\r\n", boundary))
	buf.WriteString("Content-Type: text/html; charset=UTF-8\r\n")
	buf.WriteString("Content-Transfer-Encoding: 7bit\r\n\r\n")
	buf.WriteString(bodyHTML)
	buf.WriteString("\r\n\r\n")

	// End boundary
	buf.WriteString(fmt.Sprintf("--%s--\r\n", boundary))

	return buf.Bytes()
}

func randInt() int64 {
	n, _ := rand.Int(rand.Reader, big.NewInt(1000000000))
	return n.Int64()
}

// DeliverPendingNotifications claims and sends pending outbox notifications via SMTP.
// Returns the number of successfully delivered messages.
func DeliverPendingNotifications(ctx context.Context, conn *pgx.Conn) (int, error) {
	tx, err := conn.Begin(ctx)
	if err != nil {
		return 0, fmt.Errorf("begin outbox tx: %w", err)
	}
	defer tx.Rollback(ctx)

	selectSQL := `
		SELECT 
			id, event_id, event_type, ticket_id, ticket_number,
			recipient_email, recipient_name, subject, body_text, bodyHTML, reply_to_address,
			status, attempts, max_attempts
		FROM support_notification_outbox
		WHERE status IN ('pending', 'failed')
		  AND next_attempt_at <= now()
		ORDER BY next_attempt_at ASC
		LIMIT 10
		FOR UPDATE SKIP LOCKED
	`
	rows, err := tx.Query(ctx, selectSQL)
	if err != nil {
		return 0, fmt.Errorf("query pending notifications: %w", err)
	}

	var items []OutboxNotificationItem
	for rows.Next() {
		var it OutboxNotificationItem
		err := rows.Scan(
			&it.ID, &it.EventID, &it.EventType, &it.TicketID, &it.TicketNumber,
			&it.RecipientEmail, &it.RecipientName, &it.Subject, &it.BodyText, &it.BodyHTML, &it.ReplyToAddress,
			&it.Status, &it.Attempts, &it.MaxAttempts,
		)
		if err == nil {
			items = append(items, it)
		}
	}
	rows.Close()

	if len(items) == 0 {
		return 0, nil
	}

	deliveredCount := 0
	smtpHost, smtpPort, smtpUser, smtpPass := getSMTPConfig()
	smtpAddr := fmt.Sprintf("%s:%s", smtpHost, smtpPort)

	for _, item := range items {
		replyTo := ""
		if item.ReplyToAddress != nil {
			replyTo = *item.ReplyToAddress
		}

		rawEmail := buildRFC822Email(
			getSupportFromAddress(),
			item.RecipientEmail,
			replyTo,
			item.Subject,
			item.BodyText,
			item.BodyHTML,
		)

		var auth smtp.Auth
		if smtpUser != "" {
			auth = smtp.PlainAuth("", smtpUser, smtpPass, smtpHost)
		}

		sendErr := smtp.SendMail(smtpAddr, auth, "support@"+getSupportEmailDomain(), []string{item.RecipientEmail}, rawEmail)
		if sendErr == nil {
			// Delivery succeeded
			_, err = tx.Exec(ctx, `
				UPDATE support_notification_outbox
				SET status = 'delivered', delivered_at = now(), attempts = attempts + 1, updated_at = now()
				WHERE id = $1
			`, item.ID)
			if err == nil {
				deliveredCount++
			}
		} else {
			// Delivery failed -> calculate exponential backoff with jitter
			nextAttempts := item.Attempts + 1
			if nextAttempts >= item.MaxAttempts {
				_, _ = tx.Exec(ctx, `
					UPDATE support_notification_outbox
					SET status = 'dead_letter', attempts = $1, last_error = $2, updated_at = now()
					WHERE id = $3
				`, nextAttempts, sendErr.Error(), item.ID)
			} else {
				backoffSec := (1 << nextAttempts) * 5
				_, _ = tx.Exec(ctx, `
					UPDATE support_notification_outbox
					SET status = 'failed', attempts = $1, last_error = $2,
					    next_attempt_at = now() + make_interval(secs := $3), updated_at = now()
					WHERE id = $4
				`, nextAttempts, sendErr.Error(), backoffSec, item.ID)
			}
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("commit outbox tx: %w", err)
	}

	return deliveredCount, nil
}

// ─────────────────────────────────────────────────────────────
// Inbound Support Email Reply Processing & MIME Parsing
// ─────────────────────────────────────────────────────────────

type InboundSupportResult struct {
	TicketID      uuid.UUID `json:"ticket_id"`
	TicketNumber  string    `json:"ticket_number"`
	MessageID     uuid.UUID `json:"message_id"`
	CustomerEmail string    `json:"customer_email"`
	CleanSnippet  string    `json:"clean_snippet"`
	IsDuplicate   bool      `json:"is_duplicate"`
}

var (
	replyTokenRegex = regexp.MustCompile(`(?i)reply\+([a-fA-F0-9]{64})@`)
)

// ExtractReplyTokenFromAddress scans recipient email addresses for reply+<64-hex>@ token
func ExtractReplyTokenFromAddress(toHeader string) string {
	matches := replyTokenRegex.FindStringSubmatch(toHeader)
	if len(matches) >= 2 {
		return strings.ToLower(matches[1])
	}
	return ""
}

// CleanQuotedEmailReply removes standard email reply chains and quote history
func CleanQuotedEmailReply(rawBody string) string {
	lines := strings.Split(rawBody, "\n")
	var cleaned []string

	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		// Check for common reply headers
		if strings.HasPrefix(trimmed, "On ") && (strings.Contains(trimmed, " wrote:") || strings.Contains(trimmed, " wrote :")) {
			break
		}
		if strings.HasPrefix(trimmed, "-----Original Message-----") {
			break
		}
		if strings.HasPrefix(trimmed, "________________________________") {
			break
		}
		if strings.HasPrefix(trimmed, ">") {
			continue // Skip quoted line
		}
		cleaned = append(cleaned, line)
	}

	result := strings.TrimSpace(strings.Join(cleaned, "\n"))
	if result == "" {
		// Defensive fallback: If aggressive cleaning emptied the text, preserve original rather than dropping
		return strings.TrimSpace(rawBody)
	}
	return result
}

// ParseRawMIMEMessage extracts From, To, Message-ID, Subject, and clean Text Body from RFC 822 data
func ParseRawMIMEMessage(r io.Reader) (sender, recipient, messageID, subject, body string, err error) {
	msg, err := mail.ReadMessage(r)
	if err != nil {
		return "", "", "", "", "", fmt.Errorf("read mail: %w", err)
	}

	sender = msg.Header.Get("From")
	recipient = msg.Header.Get("To")
	messageID = msg.Header.Get("Message-ID")
	subject = msg.Header.Get("Subject")

	mediaType, params, err := mime.ParseMediaType(msg.Header.Get("Content-Type"))
	if err != nil || mediaType == "" {
		mediaType = "text/plain"
	}

	if strings.HasPrefix(mediaType, "text/") {
		content, _ := io.ReadAll(msg.Body)
		body = string(content)
	} else if strings.HasPrefix(mediaType, "multipart/") {
		mr := multipart.NewReader(msg.Body, params["boundary"])
		var textPart, htmlPart string
		for {
			p, err := mr.NextPart()
			if err == io.EOF {
				break
			}
			if err != nil {
				break
			}
			partType, _, _ := mime.ParseMediaType(p.Header.Get("Content-Type"))
			slurp, _ := io.ReadAll(p)
			if partType == "text/plain" && textPart == "" {
				textPart = string(slurp)
			} else if partType == "text/html" && htmlPart == "" {
				htmlPart = string(slurp)
			}
		}
		if textPart != "" {
			body = textPart
		} else if htmlPart != "" {
			// Strip HTML tags for safe plain text
			body = regexp.MustCompile(`<[^>]*>`).ReplaceAllString(htmlPart, " ")
		}
	} else {
		content, _ := io.ReadAll(msg.Body)
		body = string(content)
	}

	body = CleanQuotedEmailReply(body)
	return
}

// ProcessInboundSupportEmail parses, validates, deduplicates, and ingests an inbound customer email reply.
func ProcessInboundSupportEmail(ctx context.Context, conn *pgx.Conn, rawMessage []byte, envelopeFrom string, envelopeTo string) (*InboundSupportResult, error) {
	sender, recipient, messageIDHeader, _, cleanBody, err := ParseRawMIMEMessage(bytes.NewReader(rawMessage))
	if err != nil {
		return nil, fmt.Errorf("failed to parse email: %w", err)
	}

	effectiveSender := envelopeFrom
	if effectiveSender == "" {
		parsedFrom, err := mail.ParseAddress(sender)
		if err == nil {
			effectiveSender = parsedFrom.Address
		} else {
			effectiveSender = sender
		}
	}
	effectiveSender = strings.ToLower(strings.TrimSpace(effectiveSender))

	effectiveRecipient := envelopeTo
	if effectiveRecipient == "" {
		effectiveRecipient = recipient
	}

	// 1. Extract reply token from address
	rawToken := ExtractReplyTokenFromAddress(effectiveRecipient)
	if rawToken == "" {
		return nil, errors.New("no valid reply token found in recipient address")
	}

	tx, err := conn.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin inbound tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// 2. Validate reply token & verify sender identity
	tokenRecord, err := ValidateReplyToken(ctx, tx, rawToken, effectiveSender)
	if err != nil {
		return nil, fmt.Errorf("token validation failed: %w", err)
	}

	// 3. Verify ticket status
	var ticketNumber, currentStatus, ticketSubject string
	var assignedAgentID *uuid.UUID
	err = tx.QueryRow(ctx, `
		SELECT ticket_number, status, subject, assigned_agent_id
		FROM support_tickets
		WHERE id = $1
	`, tokenRecord.TicketID).Scan(&ticketNumber, &currentStatus, &ticketSubject, &assignedAgentID)
	if err != nil {
		return nil, fmt.Errorf("ticket lookup failed: %w", err)
	}

	if currentStatus == "closed" {
		// Defensive policy: If ticket permanently closed, reject reply
		return nil, ErrTicketClosed
	}

	// 4. Inbound Deduplication Check
	var messageIDHash [32]byte
	if messageIDHeader != "" {
		messageIDHash = sha256.Sum256([]byte(strings.TrimSpace(messageIDHeader)))
	} else {
		// Synthetic hash if Message-ID header is missing
		messageIDHash = sha256.Sum256([]byte(fmt.Sprintf("%s:%s:%s", tokenRecord.TicketID, effectiveSender, cleanBody)))
	}

	var existingMsgID uuid.UUID
	err = tx.QueryRow(ctx, `
		SELECT ticket_message_id FROM support_inbound_dedup WHERE message_id_hash = $1
	`, messageIDHash[:]).Scan(&existingMsgID)
	if err == nil {
		// Idempotent duplicate: already ingested
		return &InboundSupportResult{
			TicketID:      tokenRecord.TicketID,
			TicketNumber:  ticketNumber,
			MessageID:     existingMsgID,
			CustomerEmail: effectiveSender,
			CleanSnippet:  cleanBody,
			IsDuplicate:   true,
		}, nil
	}

	// 5. Insert new message with source = 'email'
	var newMsgID uuid.UUID
	insertMsgSQL := `
		INSERT INTO support_ticket_messages (
			ticket_id, author_type, author_id, author_name, body, visibility, source
		) VALUES (
			$1, 'customer', $2, $3, $4, 'public', 'email'
		)
		RETURNING id
	`
	err = tx.QueryRow(ctx, insertMsgSQL,
		tokenRecord.TicketID, tokenRecord.CustomerUserID, effectiveSender, cleanBody,
	).Scan(&newMsgID)
	if err != nil {
		return nil, fmt.Errorf("failed to insert ticket message: %w", err)
	}

	// 6. Record deduplication entry
	_, err = tx.Exec(ctx, `
		INSERT INTO support_inbound_dedup (message_id_hash, ticket_id, ticket_message_id, sender_email)
		VALUES ($1, $2, $3, $4)
	`, messageIDHash[:], tokenRecord.TicketID, newMsgID, effectiveSender)
	if err != nil {
		return nil, fmt.Errorf("failed to record dedup entry: %w", err)
	}

	// 7. Update ticket lifecycle
	newStatus := currentStatus
	if currentStatus == "resolved" || currentStatus == "pending_customer" {
		newStatus = "in_progress"
	}

	_, err = tx.Exec(ctx, `
		UPDATE support_tickets
		SET status = $1, customer_typing_at = NULL, last_activity_at = now(), updated_at = now()
		WHERE id = $2
	`, newStatus, tokenRecord.TicketID)
	if err != nil {
		return nil, fmt.Errorf("failed to update ticket lifecycle: %w", err)
	}

	// 8. Queue staff alert notification if agent assigned
	crmURL := fmt.Sprintf("http://localhost:3003?ticket=%s", tokenRecord.TicketID)
	staffSubj, staffText, staffHTML := RenderCustomerReplyAlertForStaff(
		ticketNumber, ticketSubject, effectiveSender, cleanBody, crmURL,
	)

	// Deliver to assigned agent email if available, else generic support staff queue
	staffRecipient := "support-staff@byos.local"
	if assignedAgentID != nil {
		var agentEmail string
		if err := tx.QueryRow(ctx, `SELECT email FROM support_agents WHERE id = $1`, *assignedAgentID).Scan(&agentEmail); err == nil {
			staffRecipient = agentEmail
		}
	}

	_ = QueueNotificationEvent(
		ctx, tx, "customer_reply", tokenRecord.TicketID, ticketNumber,
		staffRecipient, "Support Staff", staffSubj, staffText, staffHTML, "",
	)

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit inbound reply failed: %w", err)
	}

	return &InboundSupportResult{
		TicketID:      tokenRecord.TicketID,
		TicketNumber:  ticketNumber,
		MessageID:     newMsgID,
		CustomerEmail: effectiveSender,
		CleanSnippet:  cleanBody,
		IsDuplicate:   false,
	}, nil
}
