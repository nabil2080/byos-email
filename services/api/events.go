package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type MailboxEvent struct {
	Type        string `json:"type"` // "message.created" | "message.deleted" | "message.updated" | "message.moved"
	MailboxID   string `json:"mailboxId"`
	Folder      string `json:"folder"`
	MessageID   string `json:"messageId"`
	UnreadDelta int    `json:"unreadDelta"`
}

func publishMailboxEvent(ctx context.Context, ev MailboxEvent) {
	if redisClient == nil {
		return
	}
	data, err := json.Marshal(ev)
	if err != nil {
		log.Printf("[events] failed to marshal event: %v", err)
		return
	}
	channel := fmt.Sprintf("mailbox:%s:events", ev.MailboxID)
	if err := redisClient.Publish(ctx, channel, data).Err(); err != nil {
		log.Printf("[events] failed to publish to %s: %v", channel, err)
	}
}

// mailboxEventsHandler handles GET /v1/mailboxes/{mailbox_id}/events and GET /api/v1/mailboxes/{mailbox_id}/events
func mailboxEventsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	mailboxID := r.PathValue("mailbox_id")
	if mailboxID == "" {
		mailboxID = r.PathValue("id")
	}
	if _, err := uuid.Parse(mailboxID); err != nil {
		http.Error(w, "invalid mailbox_id UUID", http.StatusBadRequest)
		return
	}

	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		// Fall back to query param ?token= for EventSource if needed
		if qToken := r.URL.Query().Get("token"); qToken != "" {
			reqWithToken, _ := http.NewRequest(http.MethodGet, "/", nil)
			reqWithToken.Header.Set("Authorization", "Bearer "+qToken)
			if uid, ok2 := getAuthenticatedUserID(reqWithToken); ok2 {
				userID = uid
				ok = true
			}
		}
	}
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	ctx := r.Context()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	if status, errMsg, authOk := verifyMailboxSession(r, userID, mailboxID, conn, ctx); !authOk {
		http.Error(w, errMsg, status)
		return
	}

	var authorized string
	if err := conn.QueryRow(ctx, `SELECT m.id::text FROM mailboxes m JOIN users u ON u.org_id=m.org_id WHERE m.id=$1 AND u.id=$2 AND u.is_active=true`, mailboxID, userID).Scan(&authorized); err != nil {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	flusher.Flush()

	if redisClient == nil {
		http.Error(w, "event service unavailable", http.StatusServiceUnavailable)
		return
	}

	channel := fmt.Sprintf("mailbox:%s:events", mailboxID)
	pubsub := redisClient.Subscribe(ctx, channel)
	defer pubsub.Close()

	ch := pubsub.Channel()
	ticker := time.NewTicker(25 * time.Second)
	defer ticker.Stop()

	// Initial connected comment
	fmt.Fprintf(w, ": connected\n\n")
	flusher.Flush()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			fmt.Fprintf(w, ": heartbeat\n\n")
			flusher.Flush()
		case msg, ok := <-ch:
			if !ok {
				return
			}
			data := strings.TrimSpace(msg.Payload)
			if data != "" {
				fmt.Fprintf(w, "data: %s\n\n", data)
				flusher.Flush()
			}
		}
	}
}
