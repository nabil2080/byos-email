package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
)

func TestUpdateSeatCountValid(t *testing.T) {
	pool := setupAdminTestPool(t)
	ctx := context.Background()

	var orgUUID uuid.UUID
	var origSeats int
	err := pool.QueryRow(ctx, `SELECT id, seat_count FROM organizations LIMIT 1`).Scan(&orgUUID, &origSeats)
	if err != nil {
		t.Fatalf("failed to query test org: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `UPDATE organizations SET seat_count = $1 WHERE id = $2`, origSeats, orgUUID)
	})

	body := bytes.NewBufferString(`{"seat_count":20}`)
	req := httptest.NewRequest(http.MethodPatch, "/admin/v1/organizations/"+orgUUID.String()+"/seats", body)
	rec := httptest.NewRecorder()
	HandleUpdateSeatCount(rec, req, pool, orgUUID)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 OK, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp["seat_count"] != float64(20) {
		t.Fatalf("expected seat_count 20, got %v", resp["seat_count"])
	}
	if resp["monthly_total_cents"] != float64(5850) {
		t.Fatalf("expected monthly_total_cents 5850, got %v", resp["monthly_total_cents"])
	}
	if resp["annual_total_cents"] != float64(58500) {
		t.Fatalf("expected annual_total_cents 58500, got %v", resp["annual_total_cents"])
	}

	var dbSeats int
	err = pool.QueryRow(ctx, `SELECT seat_count FROM organizations WHERE id = $1`, orgUUID).Scan(&dbSeats)
	if err != nil {
		t.Fatalf("failed to query DB for seat_count: %v", err)
	}
	if dbSeats != 20 {
		t.Fatalf("expected DB seat_count 20, got %d", dbSeats)
	}
}

func TestUpdateSeatCountBelowMailboxes(t *testing.T) {
	pool := setupAdminTestPool(t)
	ctx := context.Background()

	// Create test org with 18 active mailboxes
	orgUUID := uuid.New()
	_, err := pool.Exec(ctx, `INSERT INTO organizations (id, name, org_recovery_pk, seat_count) VALUES ($1, $2, $3, $4)`,
		orgUUID, "Test Org Below Mailboxes", []byte("01234567890123456789012345678901"), 20)
	if err != nil {
		t.Fatalf("failed to insert test org: %v", err)
	}
	defer func() {
		_, _ = pool.Exec(ctx, `DELETE FROM mailboxes WHERE org_id = $1`, orgUUID)
		_, _ = pool.Exec(ctx, `DELETE FROM domains WHERE org_id = $1`, orgUUID)
		_, _ = pool.Exec(ctx, `DELETE FROM organizations WHERE id = $1`, orgUUID)
	}()

	domainID := uuid.New()
	_, err = pool.Exec(ctx, `INSERT INTO domains (id, org_id, name, is_verified, verification_token, dkim_selector) VALUES ($1, $2, $3, true, 'tok', 'byos')`,
		domainID, orgUUID, fmt.Sprintf("test-%s.org", orgUUID.String()[:8]))
	if err != nil {
		t.Fatalf("failed to insert test domain: %v", err)
	}

	for i := 0; i < 18; i++ {
		_, err = pool.Exec(ctx, `INSERT INTO mailboxes (id, org_id, domain_id, local_part, is_active) VALUES ($1, $2, $3, $4, true)`,
			uuid.New(), orgUUID, domainID, fmt.Sprintf("user%d", i))
		if err != nil {
			t.Fatalf("failed to insert mailbox %d: %v", i, err)
		}
	}

	// PATCH to 17 (below 18 mailboxes) -> MUST return 400 with seat_count_below_active_mailboxes
	body := bytes.NewBufferString(`{"seat_count":17}`)
	req := httptest.NewRequest(http.MethodPatch, "/admin/v1/organizations/"+orgUUID.String()+"/seats", body)
	rec := httptest.NewRecorder()
	HandleUpdateSeatCount(rec, req, pool, orgUUID)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request, got %d: %s", rec.Code, rec.Body.String())
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp["error"] != "seat_count_below_active_mailboxes" {
		t.Fatalf("expected error seat_count_below_active_mailboxes, got %v", resp["error"])
	}
	if resp["current_mailboxes"] != float64(18) {
		t.Fatalf("expected current_mailboxes 18, got %v", resp["current_mailboxes"])
	}
}

func TestUpdateSeatCountZero(t *testing.T) {
	pool := setupAdminTestPool(t)

	orgUUID := uuid.New()

	body := bytes.NewBufferString(`{"seat_count":0}`)
	req := httptest.NewRequest(http.MethodPatch, "/admin/v1/organizations/"+orgUUID.String()+"/seats", body)
	rec := httptest.NewRecorder()
	HandleUpdateSeatCount(rec, req, pool, orgUUID)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 Bad Request for seat_count 0, got %d", rec.Code)
	}
}

func TestCapacityCapsFromSeatCount(t *testing.T) {
	domainsCap, aliasesCap := ComputeCapacityCaps(20)
	if domainsCap != 4 {
		t.Fatalf("expected domainsCap 4 for 20 seats, got %d", domainsCap)
	}
	if aliasesCap != 40 {
		t.Fatalf("expected aliasesCap 40 for 20 seats, got %d", aliasesCap)
	}
}

func TestCapacityCapsMinimums(t *testing.T) {
	domainsCap, aliasesCap := ComputeCapacityCaps(1)
	if domainsCap != 1 {
		t.Fatalf("expected domainsCap 1 for 1 seat, got %d", domainsCap)
	}
	if aliasesCap != 5 {
		t.Fatalf("expected aliasesCap 5 for 1 seat, got %d", aliasesCap)
	}
}

func TestPriceComputationMatches(t *testing.T) {
	expected := []struct {
		seats        int
		monthlyCents int
		annualCents  int
	}{
		{seats: 1, monthlyCents: 300, annualCents: 3000},
		{seats: 10, monthlyCents: 3000, annualCents: 30000},
		{seats: 11, monthlyCents: 3285, annualCents: 32850},
		{seats: 25, monthlyCents: 7275, annualCents: 72750},
		{seats: 26, monthlyCents: 7546, annualCents: 75460},
		{seats: 50, monthlyCents: 14050, annualCents: 140500},
		{seats: 51, monthlyCents: 14307, annualCents: 143070},
		{seats: 100, monthlyCents: 26900, annualCents: 269000},
		{seats: 101, monthlyCents: 27144, annualCents: 271440},
	}

	for _, tc := range expected {
		m, a := CalculateSeatPriceCents(tc.seats)
		if m != tc.monthlyCents {
			t.Errorf("seats %d: expected monthly %d cents, got %d", tc.seats, tc.monthlyCents, m)
		}
		if a != tc.annualCents {
			t.Errorf("seats %d: expected annual %d cents, got %d", tc.seats, tc.annualCents, a)
		}
	}
}
