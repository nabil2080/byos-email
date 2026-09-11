package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestAutoReply_Validation_ControlCharacters(t *testing.T) {
	invalidSubjects := []string{
		"Out of office\r\nBcc: attacker@evil.com",
		"Away\nSubject: Spoofed",
		"Vacation\x00Injected",
	}

	for _, subj := range invalidSubjects {
		if !strings.ContainsAny(subj, "\r\n\x00") {
			t.Fatalf("expected subject %q to contain control characters", subj)
		}
	}
}

func TestAutoReply_PayloadMarshalRoundtrip(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	end := now.Add(7 * 24 * time.Hour)

	rule := AutoReplyRule{
		MailboxID:       "11111111-1111-1111-1111-111111111111",
		IsActive:        true,
		SubjectTemplate: "Automatic Reply: Out of office",
		BodyTemplate:    "Thank you for your email. I am currently out of the office.",
		ReplyAll:        false,
		AllowedSenders:  []string{"colleague@company.com"},
		BlockedSenders:  []string{"spammer@bad.org"},
		StartTime:       &now,
		EndTime:         &end,
	}

	data, err := json.Marshal(rule)
	if err != nil {
		t.Fatalf("marshal error: %v", err)
	}

	var parsed AutoReplyRule
	if err := json.Unmarshal(data, &parsed); err != nil {
		t.Fatalf("unmarshal error: %v", err)
	}

	if parsed.SubjectTemplate != rule.SubjectTemplate {
		t.Errorf("subject mismatch: expected %q, got %q", rule.SubjectTemplate, parsed.SubjectTemplate)
	}
	if parsed.BodyTemplate != rule.BodyTemplate {
		t.Errorf("body mismatch: expected %q, got %q", rule.BodyTemplate, parsed.BodyTemplate)
	}
	if len(parsed.AllowedSenders) != 1 || parsed.AllowedSenders[0] != "colleague@company.com" {
		t.Errorf("allowed senders mismatch: %v", parsed.AllowedSenders)
	}
}

func TestAutoReply_UnauthorizedWithoutUser(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/v1/mailboxes/11111111-1111-1111-1111-111111111111/auto-reply", nil)
	req.SetPathValue("mailbox_id", "11111111-1111-1111-1111-111111111111")
	w := httptest.NewRecorder()

	autoReplyHandler(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 Unauthorized for missing user header, got %d", w.Code)
	}
}

func TestAutoReply_InvalidMailboxUUID(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/v1/mailboxes/not-a-uuid/auto-reply", nil)
	req.SetPathValue("mailbox_id", "not-a-uuid")
	req.Header.Set("X-User-Id", "22222222-2222-2222-2222-222222222222")
	w := httptest.NewRecorder()

	autoReplyHandler(w, req)
	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 Bad Request for invalid UUID, got %d", w.Code)
	}
}
