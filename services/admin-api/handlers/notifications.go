package handlers

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"html"
	"log"
	"math/big"
	"net/smtp"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

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

func getSMTPConfig() (host string, port string, user string, pass string) {
	host = os.Getenv("SUPPORT_SMTP_HOST")
	if host == "" {
		host = "127.0.0.1"
	}
	port = os.Getenv("SUPPORT_SMTP_PORT")
	if port == "" {
		port = "1025"
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

// QueueAgentReplyNotification generates a reply token and queues an agent_reply notification for the customer.
// Called ONLY when message visibility == 'public'. Internal notes must NEVER invoke this.
func QueueAgentReplyNotification(ctx context.Context, tx pgx.Tx, ticketID uuid.UUID, authorName string, replySnippet string) error {
	var custUserID uuid.UUID
	var ticketNum, ticketSubj string
	err := tx.QueryRow(ctx, `
		SELECT customer_user_id, ticket_number, subject
		FROM support_tickets
		WHERE id = $1
	`, ticketID).Scan(&custUserID, &ticketNum, &ticketSubj)
	if err != nil {
		return fmt.Errorf("lookup ticket for notification: %w", err)
	}

	var custEmail, custDisplayName string
	err = tx.QueryRow(ctx, `
		SELECT email, COALESCE(display_name, '')
		FROM users
		WHERE id = $1
	`, custUserID).Scan(&custEmail, &custDisplayName)
	if err != nil {
		return fmt.Errorf("lookup customer user: %w", err)
	}
	if custDisplayName == "" {
		custDisplayName = custEmail
	}

	// 1. Generate 256-bit cryptographically random token
	rawBytes := make([]byte, 32)
	if _, err := rand.Read(rawBytes); err != nil {
		return fmt.Errorf("crypto rand: %w", err)
	}
	rawToken := hex.EncodeToString(rawBytes)
	tokenHash := sha256.Sum256([]byte(rawToken))
	expiresAt := time.Now().Add(30 * 24 * time.Hour)

	_, err = tx.Exec(ctx, `
		INSERT INTO support_reply_tokens (ticket_id, customer_user_id, customer_email, token_hash, is_revoked, expires_at)
		VALUES ($1, $2, $3, $4, false, $5)
	`, ticketID, custUserID, strings.ToLower(custEmail), tokenHash[:], expiresAt)
	if err != nil {
		return fmt.Errorf("insert reply token: %w", err)
	}

	replyToAddr := fmt.Sprintf("BYOS Support <reply+%s@%s>", rawToken, getSupportEmailDomain())
	ticketURL := fmt.Sprintf("http://localhost:3000/dashboard/support?ticket=%s", ticketID)

	subj := fmt.Sprintf("[BYOS Support #%s] Support Response: %s", ticketNum, ticketSubj)

	bodyText := fmt.Sprintf(`Hello %s,

%s from BYOS Support has replied to your ticket (#%s):

"%s"

You can reply directly to this email to continue the conversation, or view the ticket in your Help Desk:
%s

Regards,
BYOS Support Team
`, custDisplayName, authorName, ticketNum, replySnippet, ticketURL)

	bodyHTML := fmt.Sprintf(`<!DOCTYPE html>
<html>
<body style="font-family: -apple-system, sans-serif; padding: 20px; background: #F8F7F4;">
  <div style="max-width: 600px; margin: 0 auto; background: #fff; border: 1px solid #E2DFD8; border-radius: 12px; padding: 24px;">
    <h3 style="color: #9E725F; margin-top: 0;">BYOS Support Update</h3>
    <p>Hello <strong>%s</strong>,</p>
    <p><strong>%s</strong> responded to ticket <span style="font-family: monospace; color: #9E725F;">#%s</span>:</p>
    <blockquote style="background: #F8F7F4; border-left: 4px solid #9E725F; padding: 12px; margin: 16px 0;">%s</blockquote>
    <p>You can <strong>reply directly to this email</strong>, or view the conversation online:</p>
    <p><a href="%s" style="background: #9E725F; color: #fff; padding: 10px 18px; text-decoration: none; border-radius: 8px; display: inline-block;">View in Help Desk</a></p>
  </div>
</body>
</html>`, html.EscapeString(custDisplayName), html.EscapeString(authorName), ticketNum, html.EscapeString(replySnippet), ticketURL)

	insertOutboxSQL := `
		INSERT INTO support_notification_outbox (
			event_id, event_type, ticket_id, ticket_number,
			recipient_email, recipient_name, subject, body_text, body_html, reply_to_address,
			status, attempts, next_attempt_at
		) VALUES (
			$1, 'agent_reply', $2, $3,
			$4, $5, $6, $7, $8, $9,
			'pending', 0, now()
		)
	`
	_, err = tx.Exec(ctx, insertOutboxSQL,
		uuid.New(), ticketID, ticketNum,
		custEmail, custDisplayName, subj, bodyText, bodyHTML, replyToAddr,
	)
	if err != nil {
		return fmt.Errorf("queue outbox record: %w", err)
	}

	return nil
}

// QueueTicketAssignedNotification notifies an agent when a ticket is assigned to them
func QueueTicketAssignedNotification(ctx context.Context, tx pgx.Tx, ticketID uuid.UUID, agentID uuid.UUID) error {
	var agentEmail, agentName string
	err := tx.QueryRow(ctx, `SELECT email, display_name FROM support_agents WHERE id = $1`, agentID).Scan(&agentEmail, &agentName)
	if err != nil {
		return fmt.Errorf("lookup agent: %w", err)
	}

	var ticketNum, ticketSubj string
	err = tx.QueryRow(ctx, `SELECT ticket_number, subject FROM support_tickets WHERE id = $1`, ticketID).Scan(&ticketNum, &ticketSubj)
	if err != nil {
		return fmt.Errorf("lookup ticket: %w", err)
	}

	crmURL := fmt.Sprintf("http://localhost:3003?ticket=%s", ticketID)
	subj := fmt.Sprintf("[Support Staff Alert #%s] Ticket Assigned: %s", ticketNum, ticketSubj)

	bodyText := fmt.Sprintf(`Hello %s,

You have been assigned to support ticket #%s (%s).

Open Support CRM to view details:
%s
`, agentName, ticketNum, ticketSubj, crmURL)

	bodyHTML := fmt.Sprintf(`<!DOCTYPE html>
<html>
<body style="font-family: sans-serif; padding: 20px;">
  <h3>Ticket Assignment</h3>
  <p>Hello <strong>%s</strong>, you have been assigned to ticket <strong style="color: #9E725F;">#%s</strong> (%s).</p>
  <p><a href="%s">View in Support CRM</a></p>
</body>
</html>`, html.EscapeString(agentName), ticketNum, html.EscapeString(ticketSubj), crmURL)

	insertOutboxSQL := `
		INSERT INTO support_notification_outbox (
			event_id, event_type, ticket_id, ticket_number,
			recipient_email, recipient_name, subject, body_text, body_html, reply_to_address,
			status, attempts, next_attempt_at
		) VALUES (
			$1, 'ticket_assigned', $2, $3,
			$4, $5, $6, $7, $8, NULL,
			'pending', 0, now()
		)
	`
	_, err = tx.Exec(ctx, insertOutboxSQL,
		uuid.New(), ticketID, ticketNum,
		agentEmail, agentName, subj, bodyText, bodyHTML,
	)
	return err
}

// QueueTicketResolvedNotification notifies customer when ticket is resolved
func QueueTicketResolvedNotification(ctx context.Context, tx pgx.Tx, ticketID uuid.UUID) error {
	var custUserID uuid.UUID
	var ticketNum, ticketSubj string
	err := tx.QueryRow(ctx, `SELECT customer_user_id, ticket_number, subject FROM support_tickets WHERE id = $1`, ticketID).Scan(&custUserID, &ticketNum, &ticketSubj)
	if err != nil {
		return err
	}

	var custEmail, custDisplayName string
	err = tx.QueryRow(ctx, `SELECT email, COALESCE(display_name, '') FROM users WHERE id = $1`, custUserID).Scan(&custEmail, &custDisplayName)
	if err != nil {
		return err
	}
	if custDisplayName == "" {
		custDisplayName = custEmail
	}

	subj := fmt.Sprintf("[BYOS Support #%s] Resolved: %s", ticketNum, ticketSubj)
	bodyText := fmt.Sprintf(`Hello %s,

Your support ticket #%s (%s) has been marked as resolved.

If you have further questions or if your issue is not resolved, simply reply to this email to reopen your ticket.

Regards,
BYOS Support Team
`, custDisplayName, ticketNum, ticketSubj)

	bodyHTML := fmt.Sprintf(`<!DOCTYPE html>
<html>
<body style="font-family: sans-serif; padding: 20px;">
  <h2>Ticket Resolved</h2>
  <p>Hello <strong>%s</strong>, ticket <strong style="color: #9E725F;">#%s</strong> has been marked as resolved.</p>
  <p>If you need further help, simply reply to this email to reopen it.</p>
</body>
</html>`, html.EscapeString(custDisplayName), ticketNum)

	insertOutboxSQL := `
		INSERT INTO support_notification_outbox (
			event_id, event_type, ticket_id, ticket_number,
			recipient_email, recipient_name, subject, body_text, body_html, reply_to_address,
			status, attempts, next_attempt_at
		) VALUES (
			$1, 'ticket_resolved', $2, $3,
			$4, $5, $6, $7, $8, NULL,
			'pending', 0, now()
		)
	`
	_, err = tx.Exec(ctx, insertOutboxSQL,
		uuid.New(), ticketID, ticketNum,
		custEmail, custDisplayName, subj, bodyText, bodyHTML,
	)
	return err
}

// DeliverAdminPendingNotifications delivers pending notifications from the outbox via SMTP
func DeliverAdminPendingNotifications(ctx context.Context, db *pgxpool.Pool) (int, error) {
	if db == nil {
		return 0, nil
	}

	tx, err := db.Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)

	rows, err := tx.Query(ctx, `
		SELECT id, recipient_email, subject, body_text, body_html, reply_to_address, attempts, max_attempts
		FROM support_notification_outbox
		WHERE status IN ('pending', 'failed') AND next_attempt_at <= now()
		ORDER BY next_attempt_at ASC
		LIMIT 10
		FOR UPDATE SKIP LOCKED
	`)
	if err != nil {
		return 0, err
	}

	type outboxRow struct {
		id       uuid.UUID
		to       string
		subj     string
		text     string
		html     string
		replyTo  *string
		attempts int
		max      int
	}
	var items []outboxRow
	for rows.Next() {
		var it outboxRow
		if err := rows.Scan(&it.id, &it.to, &it.subj, &it.text, &it.html, &it.replyTo, &it.attempts, &it.max); err == nil {
			items = append(items, it)
		}
	}
	rows.Close()

	if len(items) == 0 {
		return 0, nil
	}

	smtpHost, smtpPort, smtpUser, smtpPass := getSMTPConfig()
	smtpAddr := fmt.Sprintf("%s:%s", smtpHost, smtpPort)
	deliveredCount := 0

	for _, it := range items {
		replyTo := ""
		if it.replyTo != nil {
			replyTo = *it.replyTo
		}

		rawEmail := buildRFC822Email(getSupportFromAddress(), it.to, replyTo, it.subj, it.text, it.html)

		var auth smtp.Auth
		if smtpUser != "" {
			auth = smtp.PlainAuth("", smtpUser, smtpPass, smtpHost)
		}

		sendErr := smtp.SendMail(smtpAddr, auth, "support@"+getSupportEmailDomain(), []string{it.to}, rawEmail)
		if sendErr == nil {
			_, _ = tx.Exec(ctx, `
				UPDATE support_notification_outbox
				SET status = 'delivered', delivered_at = now(), attempts = attempts + 1, updated_at = now()
				WHERE id = $1
			`, it.id)
			deliveredCount++
		} else {
			log.Printf("[support-outbox] SMTP delivery failed for %s: %v", it.to, sendErr)
			nextAttempts := it.attempts + 1
			if nextAttempts >= it.max {
				_, _ = tx.Exec(ctx, `
					UPDATE support_notification_outbox
					SET status = 'dead_letter', attempts = $1, last_error = $2, updated_at = now()
					WHERE id = $3
				`, nextAttempts, sendErr.Error(), it.id)
			} else {
				backoffSec := (1 << nextAttempts) * 5
				_, _ = tx.Exec(ctx, `
					UPDATE support_notification_outbox
					SET status = 'failed', attempts = $1, last_error = $2,
					    next_attempt_at = now() + make_interval(secs := $3), updated_at = now()
					WHERE id = $4
				`, nextAttempts, sendErr.Error(), backoffSec, it.id)
			}
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}

	return deliveredCount, nil
}
