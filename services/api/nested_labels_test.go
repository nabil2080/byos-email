package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func setupNestedLabelsTestMailbox(t *testing.T, conn *pgx.Conn) (mailboxID, domainID, token string) {
	t.Helper()
	ctx := context.Background()
	_, userID, domainID, mailboxID := createThreadingTestMailbox(t, conn)

	rawToken, tokenHash := generateSessionToken()
	_, err := conn.Exec(ctx, `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
		userID, tokenHash, time.Now().Add(24*time.Hour))
	if err != nil {
		t.Fatalf("create session: %v", err)
	}

	t.Cleanup(func() {
		_, _ = conn.Exec(context.Background(), `DELETE FROM message_labels WHERE label_id IN (SELECT id FROM mailbox_labels WHERE mailbox_id = $1)`, mailboxID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM mailbox_labels WHERE mailbox_id = $1`, mailboxID)
		_, _ = conn.Exec(context.Background(), `DELETE FROM sessions WHERE user_id = $1`, userID)
	})

	return mailboxID, domainID, rawToken
}

func doCreateLabel(t *testing.T, mailboxID, token, name string, parentLabelID *string) (*httptest.ResponseRecorder, MailboxLabelResponse) {
	t.Helper()
	body := map[string]interface{}{
		"name": name,
	}
	if parentLabelID != nil {
		body["parent_label_id"] = *parentLabelID
	}
	b, _ := json.Marshal(body)

	req := httptest.NewRequest(http.MethodPost, fmt.Sprintf("/v1/mailboxes/%s/labels", mailboxID), bytes.NewReader(b))
	req.SetPathValue("mailbox_id", mailboxID)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	mailboxLabelsHandler(w, req)

	var resp MailboxLabelResponse
	if w.Code == http.StatusCreated {
		_ = json.Unmarshal(w.Body.Bytes(), &resp)
	}
	return w, resp
}

func doUpdateLabel(t *testing.T, mailboxID, token, labelID string, name *string, parentLabelID *string) *httptest.ResponseRecorder {
	t.Helper()
	body := make(map[string]interface{})
	if name != nil {
		body["name"] = *name
	}
	if parentLabelID != nil {
		body["parent_label_id"] = *parentLabelID
	}
	b, _ := json.Marshal(body)

	req := httptest.NewRequest(http.MethodPatch, fmt.Sprintf("/v1/mailboxes/%s/labels/%s", mailboxID, labelID), bytes.NewReader(b))
	req.SetPathValue("mailbox_id", mailboxID)
	req.SetPathValue("label_id", labelID)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	mailboxLabelsHandler(w, req)
	return w
}

func doListLabels(t *testing.T, mailboxID, token string) ([]MailboxLabelResponse, *httptest.ResponseRecorder) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/v1/mailboxes/%s/labels", mailboxID), nil)
	req.SetPathValue("mailbox_id", mailboxID)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	mailboxLabelsHandler(w, req)

	var res struct {
		Labels []MailboxLabelResponse `json:"labels"`
	}
	if w.Code == http.StatusOK {
		_ = json.Unmarshal(w.Body.Bytes(), &res)
	}
	return res.Labels, w
}

func doDeleteLabel(t *testing.T, mailboxID, token, labelID string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodDelete, fmt.Sprintf("/v1/mailboxes/%s/labels/%s", mailboxID, labelID), nil)
	req.SetPathValue("mailbox_id", mailboxID)
	req.SetPathValue("label_id", labelID)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	mailboxLabelsHandler(w, req)
	return w
}

// 1. TestCreateNestedLabel — create Work, then Work/ProjectA, assert parent_label_id.
func TestCreateNestedLabel(t *testing.T) {
	conn := getTestDB(t)
	defer conn.Close(context.Background())
	mailboxID, _, token := setupNestedLabelsTestMailbox(t, conn)

	// Create root "Work"
	w1, root := doCreateLabel(t, mailboxID, token, "Work", nil)
	if w1.Code != http.StatusCreated {
		t.Fatalf("expected 201 for root label, got %d: %s", w1.Code, w1.Body.String())
	}
	if root.ParentLabelID != nil {
		t.Fatalf("expected nil parent_label_id for root, got %v", root.ParentLabelID)
	}
	if root.Path != "Work" {
		t.Fatalf("expected path 'Work', got %s", root.Path)
	}

	// Create child "ProjectA" under Work
	w2, child := doCreateLabel(t, mailboxID, token, "ProjectA", &root.ID)
	if w2.Code != http.StatusCreated {
		t.Fatalf("expected 201 for child label, got %d: %s", w2.Code, w2.Body.String())
	}
	if child.ParentLabelID == nil || *child.ParentLabelID != root.ID {
		t.Fatalf("expected parent_label_id to be %s, got %v", root.ID, child.ParentLabelID)
	}
	if child.Path != "Work/ProjectA" {
		t.Fatalf("expected path 'Work/ProjectA', got %s", child.Path)
	}
}

// 2. TestCreateLabelRejectsDuplicateSibling — two Work/ProjectA under same parent -> 400.
func TestCreateLabelRejectsDuplicateSibling(t *testing.T) {
	conn := getTestDB(t)
	defer conn.Close(context.Background())
	mailboxID, _, token := setupNestedLabelsTestMailbox(t, conn)

	_, root := doCreateLabel(t, mailboxID, token, "Work", nil)
	w1, _ := doCreateLabel(t, mailboxID, token, "ProjectA", &root.ID)
	if w1.Code != http.StatusCreated {
		t.Fatalf("expected first child creation to succeed, got %d", w1.Code)
	}

	// Attempt duplicate child with same name under same parent
	w2, _ := doCreateLabel(t, mailboxID, token, "ProjectA", &root.ID)
	if w2.Code != http.StatusBadRequest && w2.Code != http.StatusConflict {
		t.Fatalf("expected 400 or 409 for duplicate sibling, got %d: %s", w2.Code, w2.Body.String())
	}
}

// 3. TestCreateLabelAllowsSameNameDifferentParents — Work/ProjectA and Personal/ProjectA both succeed.
func TestCreateLabelAllowsSameNameDifferentParents(t *testing.T) {
	conn := getTestDB(t)
	defer conn.Close(context.Background())
	mailboxID, _, token := setupNestedLabelsTestMailbox(t, conn)

	_, work := doCreateLabel(t, mailboxID, token, "Work", nil)
	_, personal := doCreateLabel(t, mailboxID, token, "Personal", nil)

	w1, childWork := doCreateLabel(t, mailboxID, token, "ProjectA", &work.ID)
	if w1.Code != http.StatusCreated {
		t.Fatalf("expected 201 for Work/ProjectA, got %d: %s", w1.Code, w1.Body.String())
	}

	w2, childPersonal := doCreateLabel(t, mailboxID, token, "ProjectA", &personal.ID)
	if w2.Code != http.StatusCreated {
		t.Fatalf("expected 201 for Personal/ProjectA, got %d: %s", w2.Code, w2.Body.String())
	}

	if childWork.Path != "Work/ProjectA" {
		t.Fatalf("expected Work/ProjectA, got %s", childWork.Path)
	}
	if childPersonal.Path != "Personal/ProjectA" {
		t.Fatalf("expected Personal/ProjectA, got %s", childPersonal.Path)
	}
}

// 4. TestCreateLabelRejectsDepth6 — 6 levels deep -> 400.
func TestCreateLabelRejectsDepth6(t *testing.T) {
	conn := getTestDB(t)
	defer conn.Close(context.Background())
	mailboxID, _, token := setupNestedLabelsTestMailbox(t, conn)

	// Level 1: L1
	_, l1 := doCreateLabel(t, mailboxID, token, "L1", nil)
	// Level 2: L2
	_, l2 := doCreateLabel(t, mailboxID, token, "L2", &l1.ID)
	// Level 3: L3
	_, l3 := doCreateLabel(t, mailboxID, token, "L3", &l2.ID)
	// Level 4: L4
	_, l4 := doCreateLabel(t, mailboxID, token, "L4", &l3.ID)
	// Level 5: L5 (allowed)
	w5, l5 := doCreateLabel(t, mailboxID, token, "L5", &l4.ID)
	if w5.Code != http.StatusCreated {
		t.Fatalf("expected level 5 to succeed, got %d: %s", w5.Code, w5.Body.String())
	}

	// Level 6: L6 (must be rejected)
	w6, _ := doCreateLabel(t, mailboxID, token, "L6", &l5.ID)
	if w6.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for depth 6, got %d: %s", w6.Code, w6.Body.String())
	}
}

// 5. TestReparentRejectsCycle — reparent a parent into its child -> 400.
func TestReparentRejectsCycle(t *testing.T) {
	conn := getTestDB(t)
	defer conn.Close(context.Background())
	mailboxID, _, token := setupNestedLabelsTestMailbox(t, conn)

	_, parent := doCreateLabel(t, mailboxID, token, "Parent", nil)
	_, child := doCreateLabel(t, mailboxID, token, "Child", &parent.ID)
	_, grandChild := doCreateLabel(t, mailboxID, token, "GrandChild", &child.ID)

	// Reparent Parent to Child (direct cycle)
	w1 := doUpdateLabel(t, mailboxID, token, parent.ID, nil, &child.ID)
	if w1.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 when reparenting to direct child, got %d: %s", w1.Code, w1.Body.String())
	}

	// Reparent Parent to GrandChild (indirect cycle)
	w2 := doUpdateLabel(t, mailboxID, token, parent.ID, nil, &grandChild.ID)
	if w2.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 when reparenting to grandchild, got %d: %s", w2.Code, w2.Body.String())
	}

	// Reparent Parent to itself
	w3 := doUpdateLabel(t, mailboxID, token, parent.ID, nil, &parent.ID)
	if w3.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 when reparenting to itself, got %d: %s", w3.Code, w3.Body.String())
	}
}

// 6. TestDeleteLabelCascadesChildren — delete Work, assert Work/ProjectA and Work/ProjectB gone.
func TestDeleteLabelCascadesChildren(t *testing.T) {
	conn := getTestDB(t)
	defer conn.Close(context.Background())
	mailboxID, _, token := setupNestedLabelsTestMailbox(t, conn)

	_, work := doCreateLabel(t, mailboxID, token, "Work", nil)
	_, pA := doCreateLabel(t, mailboxID, token, "ProjectA", &work.ID)
	_, pB := doCreateLabel(t, mailboxID, token, "ProjectB", &work.ID)

	// Delete Work
	wDel := doDeleteLabel(t, mailboxID, token, work.ID)
	if wDel.Code != http.StatusNoContent {
		t.Fatalf("expected 204 for delete, got %d: %s", wDel.Code, wDel.Body.String())
	}

	// Verify all 3 are gone
	list, _ := doListLabels(t, mailboxID, token)
	for _, l := range list {
		if l.ID == work.ID || l.ID == pA.ID || l.ID == pB.ID {
			t.Fatalf("expected label %s to be deleted by cascade, but found in list", l.Name)
		}
	}
}

// 7. TestLabelListReturnsPaths — path computed correctly.
func TestLabelListReturnsPaths(t *testing.T) {
	conn := getTestDB(t)
	defer conn.Close(context.Background())
	mailboxID, _, token := setupNestedLabelsTestMailbox(t, conn)

	_, root := doCreateLabel(t, mailboxID, token, "Engineering", nil)
	_, sub := doCreateLabel(t, mailboxID, token, "Backend", &root.ID)
	_, leaf := doCreateLabel(t, mailboxID, token, "API", &sub.ID)

	list, w := doListLabels(t, mailboxID, token)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 list, got %d", w.Code)
	}

	pathMap := make(map[string]string)
	for _, l := range list {
		pathMap[l.ID] = l.Path
	}

	if pathMap[root.ID] != "Engineering" {
		t.Fatalf("expected 'Engineering', got '%s'", pathMap[root.ID])
	}
	if pathMap[sub.ID] != "Engineering/Backend" {
		t.Fatalf("expected 'Engineering/Backend', got '%s'", pathMap[sub.ID])
	}
	if pathMap[leaf.ID] != "Engineering/Backend/API" {
		t.Fatalf("expected 'Engineering/Backend/API', got '%s'", pathMap[leaf.ID])
	}
}

// 8. TestLabelUnreadCountIncludesDescendants — parent count = sum of children.
func TestLabelUnreadCountIncludesDescendants(t *testing.T) {
	conn := getTestDB(t)
	defer conn.Close(context.Background())
	ctx := context.Background()
	mailboxID, domainID, token := setupNestedLabelsTestMailbox(t, conn)

	_, parent := doCreateLabel(t, mailboxID, token, "Work", nil)
	_, childA := doCreateLabel(t, mailboxID, token, "ProjectA", &parent.ID)
	_, childB := doCreateLabel(t, mailboxID, token, "ProjectB", &parent.ID)

	// Insert unread message 1 for childA
	msg1ID, _ := insertThreadingTestMessage(t, conn, mailboxID, domainID, "msg1@test.local", "")
	_, err := conn.Exec(ctx, `INSERT INTO message_labels (message_id, label_id) VALUES ($1, $2)`, msg1ID, childA.ID)
	if err != nil {
		t.Fatalf("insert label msg1: %v", err)
	}

	// Insert unread message 2 for childB
	msg2ID, _ := insertThreadingTestMessage(t, conn, mailboxID, domainID, "msg2@test.local", "")
	_, err = conn.Exec(ctx, `INSERT INTO message_labels (message_id, label_id) VALUES ($1, $2)`, msg2ID, childB.ID)
	if err != nil {
		t.Fatalf("insert label msg2: %v", err)
	}

	// Insert unread message 3 for parent directly
	msg3ID, _ := insertThreadingTestMessage(t, conn, mailboxID, domainID, "msg3@test.local", "")
	_, err = conn.Exec(ctx, `INSERT INTO message_labels (message_id, label_id) VALUES ($1, $2)`, msg3ID, parent.ID)
	if err != nil {
		t.Fatalf("insert label msg3: %v", err)
	}

	// Also insert a READ message for childA (should NOT be counted)
	msgReadID, _ := insertThreadingTestMessage(t, conn, mailboxID, domainID, "msgRead@test.local", "")
	_, err = conn.Exec(ctx, `UPDATE message_metadata SET is_read = true WHERE id = $1`, msgReadID)
	if err != nil {
		t.Fatalf("update read msg: %v", err)
	}
	_, err = conn.Exec(ctx, `INSERT INTO message_labels (message_id, label_id) VALUES ($1, $2)`, msgReadID, childA.ID)
	if err != nil {
		t.Fatalf("insert read msg label: %v", err)
	}

	list, w := doListLabels(t, mailboxID, token)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 list, got %d", w.Code)
	}

	countMap := make(map[string]int)
	for _, l := range list {
		countMap[l.ID] = l.UnreadCount
	}

	if countMap[childA.ID] != 1 {
		t.Fatalf("expected childA unread_count=1, got %d", countMap[childA.ID])
	}
	if countMap[childB.ID] != 1 {
		t.Fatalf("expected childB unread_count=1, got %d", countMap[childB.ID])
	}
	// Parent should have 3 unread messages (childA + childB + parent own)
	if countMap[parent.ID] != 3 {
		t.Fatalf("expected parent unread_count=3, got %d", countMap[parent.ID])
	}
}
