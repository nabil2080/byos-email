package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

func setupAdminTestPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	connStr := strings.TrimSpace(os.Getenv("TEST_DATABASE_URL"))
	if connStr == "" {
		t.Skip("skipping admin integration test: TEST_DATABASE_URL environment variable is not set")
		return nil
	}
	u, err := url.Parse(connStr)
	if err != nil {
		t.Fatalf("invalid TEST_DATABASE_URL: %v", err)
	}
	host := u.Hostname()
	allowedHosts := map[string]bool{
		"localhost":     true,
		"127.0.0.1":     true,
		"::1":           true,
		"postgres":      true,
		"byos-postgres": true,
	}
	if !allowedHosts[host] && os.Getenv("BYOS_ALLOW_REMOTE_TEST_DB") != "true" {
		t.Fatalf("SAFETY VIOLATION: Refusing to run tests against non-local host '%s' (set BYOS_ALLOW_REMOTE_TEST_DB=true to override)", host)
	}
	dbName := strings.TrimPrefix(u.Path, "/")
	if strings.EqualFold(dbName, "byos") && os.Getenv("BYOS_ALLOW_DEV_DB_TEST") != "true" {
		t.Fatalf("SAFETY VIOLATION: Refusing to run tests against development database '%s' (set BYOS_ALLOW_DEV_DB_TEST=true to override)", dbName)
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, connStr)
	if err != nil {
		t.Fatalf("failed to connect to test db: %v", err)
	}
	t.Cleanup(func() { pool.Close() })
	return pool
}

func TestAdminDomainQuotaEnforcement(t *testing.T) {
	pool := setupAdminTestPool(t)
	ctx := context.Background()

	// Find or pick an organization to test
	var orgUUID uuid.UUID
	var origSeats int
	err := pool.QueryRow(ctx, `SELECT id, seat_count FROM organizations LIMIT 1`).Scan(&orgUUID, &origSeats)
	if err != nil {
		t.Fatalf("failed to query test org: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM domains WHERE org_id = $1 AND name LIKE 'admin-test-%'`, orgUUID)
		_, _ = pool.Exec(ctx, `UPDATE organizations SET seat_count = $1 WHERE id = $2`, origSeats, orgUUID)
	})

	// Adjust capacity to 15 seats (max_domains = 3)
	capBody := bytes.NewBufferString(`{"seat_count":15,"reason":"test quota enforcement"}`)
	capReq := httptest.NewRequest(http.MethodPost, "/admin/v1/organizations/"+orgUUID.String()+"/capacity", capBody)
	capRec := httptest.NewRecorder()
	handleAdjustCapacity(capRec, capReq, pool, orgUUID)
	if capRec.Code != http.StatusOK {
		t.Fatalf("failed to adjust capacity: %d %s", capRec.Code, capRec.Body.String())
	}

	// Clean up any pre-existing test domains for this org
	_, _ = pool.Exec(ctx, `DELETE FROM domains WHERE org_id = $1 AND name LIKE 'admin-test-%'`, orgUUID)

	// Count existing domains for this org
	var existingDomains int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM domains WHERE org_id = $1`, orgUUID).Scan(&existingDomains)

	// Fill up to max_domains (3)
	for i := existingDomains; i < 3; i++ {
		domName := fmt.Sprintf("admin-test-%d-%s.test", i, uuid.NewString()[:6])
		body := bytes.NewBufferString(fmt.Sprintf(`{"org_id":"%s","domain":"%s"}`, orgUUID.String(), domName))
		req := httptest.NewRequest(http.MethodPost, "/admin/v1/domains", body)
		rec := httptest.NewRecorder()
		handleAdminCreateDomain(rec, req, pool)
		if rec.Code != http.StatusCreated {
			t.Fatalf("expected 201 Created for domain %d, got %d: %s", i, rec.Code, rec.Body.String())
		}
	}

	// 4th domain MUST be rejected with 403 Forbidden
	overflowName := fmt.Sprintf("admin-test-overflow-%s.test", uuid.NewString()[:6])
	body := bytes.NewBufferString(fmt.Sprintf(`{"org_id":"%s","domain":"%s"}`, orgUUID.String(), overflowName))
	req := httptest.NewRequest(http.MethodPost, "/admin/v1/domains", body)
	rec := httptest.NewRecorder()
	handleAdminCreateDomain(rec, req, pool)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 Forbidden for exceeding domain quota, got %d: %s", rec.Code, rec.Body.String())
	}

	var errResp map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &errResp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if errResp["error"] != "domain_limit_reached" {
		t.Fatalf("expected error domain_limit_reached, got %v", errResp["error"])
	}
	if errResp["limit"] != float64(3) {
		t.Fatalf("expected limit 3, got %v", errResp["limit"])
	}
	if errResp["addon_product_id"] != "pdt_extra_domain_v1" {
		t.Fatalf("expected addon_product_id pdt_extra_domain_v1, got %v", errResp["addon_product_id"])
	}

	// Upgrade capacity to 20 seats (max_domains = 4)
	capBody = bytes.NewBufferString(`{"seat_count":20,"reason":"test upgrade quota"}`)
	capReq = httptest.NewRequest(http.MethodPost, "/admin/v1/organizations/"+orgUUID.String()+"/capacity", capBody)
	capRec = httptest.NewRecorder()
	handleAdjustCapacity(capRec, capReq, pool, orgUUID)
	if capRec.Code != http.StatusOK {
		t.Fatalf("failed to adjust capacity to 20: %d %s", capRec.Code, capRec.Body.String())
	}

	// Now creating the domain should succeed
	body = bytes.NewBufferString(fmt.Sprintf(`{"org_id":"%s","domain":"%s"}`, orgUUID.String(), overflowName))
	req = httptest.NewRequest(http.MethodPost, "/admin/v1/domains", body)
	rec = httptest.NewRecorder()
	handleAdminCreateDomain(rec, req, pool)
	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created after upgrading capacity, got %d: %s", rec.Code, rec.Body.String())
	}

	// Clean up created test domains
	_, _ = pool.Exec(ctx, `DELETE FROM domains WHERE org_id = $1 AND name LIKE 'admin-test-%'`, orgUUID)
}

func TestAdminAdjustCapacityLimits(t *testing.T) {
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

	// Adjust capacity to 30 seats -> max_domains=6, max_aliases=60
	capBody := bytes.NewBufferString(`{"seat_count":30,"reason":"test capacity 30"}`)
	capReq := httptest.NewRequest(http.MethodPost, "/admin/v1/organizations/"+orgUUID.String()+"/capacity", capBody)
	capRec := httptest.NewRecorder()
	handleAdjustCapacity(capRec, capReq, pool, orgUUID)
	if capRec.Code != http.StatusOK {
		t.Fatalf("failed to adjust capacity: %d %s", capRec.Code, capRec.Body.String())
	}

	var resp map[string]interface{}
	if err := json.Unmarshal(capRec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp["seat_count"] != float64(30) {
		t.Fatalf("expected seat_count 30, got %v", resp["seat_count"])
	}
	if resp["max_domains"] != float64(6) {
		t.Fatalf("expected max_domains 6, got %v", resp["max_domains"])
	}
	if resp["max_aliases"] != float64(60) {
		t.Fatalf("expected max_aliases 60, got %v", resp["max_aliases"])
	}

	// Verify in DB
	var seats int
	err = pool.QueryRow(ctx, `SELECT seat_count FROM organizations WHERE id = $1`, orgUUID).Scan(&seats)
	if err != nil {
		t.Fatalf("failed to query org from DB: %v", err)
	}
	if seats != 30 {
		t.Fatalf("expected seat_count 30, got %d", seats)
	}
}

func TestAdminZeroKnowledgeIsolation(t *testing.T) {
	connStr := strings.TrimSpace(os.Getenv("SUPPORT_DB_URL"))
	if connStr == "" {
		t.Skip("skipping support db test: SUPPORT_DB_URL environment variable is not set")
		return
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, connStr)
	if err != nil {
		t.Fatalf("failed to connect to support db: %v", err)
	}
	defer pool.Close()

	// role_support_agent must NEVER have access to org_recovery_pk
	var pk []byte
	err = pool.QueryRow(ctx, `SELECT org_recovery_pk FROM organizations LIMIT 1`).Scan(&pk)
	if err == nil {
		t.Fatalf("CRITICAL SECURITY VIOLATION: role_support_agent was able to SELECT org_recovery_pk!")
	}
}
