package main

// Janitor tests (require PostgreSQL via requirePostgres; no Redis needed).
// Without a database they skip; skipped is reported, never counted.

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func janitorConn(t *testing.T) *pgx.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	t.Cleanup(cancel)
	conn, err := pgx.Connect(ctx, testDSN)
	if err != nil {
		t.Skipf("postgres unavailable: %v", err)
	}
	t.Cleanup(func() { conn.Close(context.Background()) })
	return conn
}

func TestJanitorPurgesDeadCredentials(t *testing.T) {
	requirePostgres(t)
	db := setupTestDB(t)
	defer db.Close()
	conn := janitorConn(t)
	ctx := context.Background()
	_, _ = conn.Exec(ctx, `DELETE FROM recovery_challenges; DELETE FROM sessions;`)

	_, ownerID, _, _ := createTestOrgAndUsers(t, db)
	var userID string
	if err := db.QueryRow(`SELECT id FROM users WHERE id=$1`, ownerID).Scan(&userID); err != nil {
		t.Fatal(err)
	}

	// Challenges: expired unspent (purge), live (keep), consumed old (purge),
	// consumed fresh (keep).
	var expiredID, liveID, consumedOldID, consumedFreshID string
	q := `INSERT INTO recovery_challenges (user_id, challenge_id, expires_at, consumed_at)
		VALUES ($1, gen_random_uuid(), $2, $3) RETURNING challenge_id::text`
	if err := db.QueryRow(q, userID, time.Now().Add(-time.Hour), nil).Scan(&expiredID); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(q, userID, time.Now().Add(time.Hour), nil).Scan(&liveID); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(q, userID, time.Now().Add(time.Hour), time.Now().Add(-2*time.Hour)).Scan(&consumedOldID); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow(q, userID, time.Now().Add(time.Hour), time.Now().Add(-time.Minute)).Scan(&consumedFreshID); err != nil {
		t.Fatal(err)
	}

	// Sessions: long-expired (purge), long-revoked (purge), live (keep),
	// recently expired (keep).
	mkSession := func(expires, revoked interface{}) string {
		var tok string
		err := db.QueryRow(`INSERT INTO sessions (user_id, token_hash, expires_at, revoked_at)
			VALUES ($1, decode(md5(random()::text), 'hex'), $2, $3) RETURNING id::text`,
			userID, expires, revoked).Scan(&tok)
		if err != nil {
			t.Fatal(err)
		}
		return tok
	}
	mkSession(time.Now().Add(-8*24*time.Hour), nil)
	mkSession(time.Now().Add(time.Hour), time.Now().Add(-8*24*time.Hour))
	liveSession := mkSession(time.Now().Add(time.Hour), nil)
	recentSession := mkSession(time.Now().Add(-time.Hour), nil)

	nCh, err := purgeExpiredChallenges(ctx, conn)
	if err != nil {
		t.Fatalf("purge challenges: %v", err)
	}
	if nCh != 2 {
		t.Fatalf("purged challenges = %d, want 2 (expired + consumed-old)", nCh)
	}
	for id, want := range map[string]bool{expiredID: false, liveID: true, consumedOldID: false, consumedFreshID: true} {
		var n int
		if err := db.QueryRow(`SELECT count(*) FROM recovery_challenges WHERE challenge_id=$1`, id).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if (n == 1) != want {
			t.Fatalf("challenge %s present=%v, want present=%v", id, n == 1, want)
		}
	}

	nSess, err := purgeDeadSessions(ctx, conn)
	if err != nil {
		t.Fatalf("purge sessions: %v", err)
	}
	if nSess != 2 {
		t.Fatalf("purged sessions = %d, want 2 (long-expired + long-revoked)", nSess)
	}
	for id, want := range map[string]bool{liveSession: true, recentSession: true} {
		var n int
		if err := db.QueryRow(`SELECT count(*) FROM sessions WHERE id=$1`, id).Scan(&n); err != nil {
			t.Fatal(err)
		}
		if (n == 1) != want {
			t.Fatalf("session %s present=%v, want present=%v", id, n == 1, want)
		}
	}
}

func TestJanitorIntervalParsing(t *testing.T) {
	t.Setenv("JANITOR_INTERVAL", "")
	if janitorInterval() != time.Hour {
		t.Fatalf("default = %v, want 1h", janitorInterval())
	}
	t.Setenv("JANITOR_INTERVAL", "0")
	if janitorInterval() != 0 {
		t.Fatal("0 must disable")
	}
	t.Setenv("JANITOR_INTERVAL", "bogus")
	if janitorInterval() != time.Hour {
		t.Fatal("invalid must fall back to 1h")
	}
	t.Setenv("JANITOR_INTERVAL", "30")
	if janitorInterval() != 30*time.Second {
		t.Fatal("30 must parse to 30s")
	}
}
