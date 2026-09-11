package main

// Expired-credential janitor (Section 15/14 hygiene).
//
// Two tables accumulate dead rows by design and have no other cleaner:
//   - recovery_challenges: 5-minute single-use challenges (expired or
//     consumed-and-old). A challenge that can never verify again is garbage,
//     and the table grows on every recovery attempt (including attacker
//     probing, which the endpoint deliberately answers).
//   - sessions: expired or long-revoked rows. Active sessions are never
//     touched; a 7-day grace preserves recent auditability.
// Deliberately NOT cleaned: root_secrets history (frozen version lineage),
// device grants (explicit revocation only), audit log (compliance record).

import (
	"context"
	"log"
	"os"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
)

// startJanitor runs purgeExpiredCredentials on a ticker. JANITOR_INTERVAL is
// seconds (default 3600); 0 or negative disables. Failures only log; the
// next tick retries.
func startJanitor() {
	interval := janitorInterval()
	if interval <= 0 {
		log.Printf("credential janitor disabled")
		return
	}
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for range ticker.C {
			runJanitorPurge()
		}
	}()
	log.Printf("credential janitor enabled (interval %s)", interval)
}

func janitorInterval() time.Duration {
	raw := os.Getenv("JANITOR_INTERVAL")
	if raw == "" {
		return time.Hour
	}
	seconds, err := strconv.Atoi(raw)
	if err != nil || seconds < 0 {
		log.Printf("invalid JANITOR_INTERVAL %q; using 1h", raw)
		return time.Hour
	}
	return time.Duration(seconds) * time.Second
}

func runJanitorPurge() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		log.Printf("credential janitor database connection failed: %v", err)
		return
	}
	defer conn.Close(ctx)
	challenges, err := purgeExpiredChallenges(ctx, conn)
	if err != nil {
		log.Printf("credential janitor challenge purge failed: %v", err)
		return
	}
	sessions, err := purgeDeadSessions(ctx, conn)
	if err != nil {
		log.Printf("credential janitor session purge failed: %v", err)
		return
	}
	if challenges+sessions > 0 {
		log.Printf("credential janitor purged %d challenges, %d sessions", challenges, sessions)
	}
}

// purgeExpiredChallenges deletes challenges that expired unspent plus
// consumed ones older than an hour (forensic grace for verify disputes).
func purgeExpiredChallenges(ctx context.Context, conn *pgx.Conn) (int64, error) {
	res, err := conn.Exec(ctx, `DELETE FROM recovery_challenges
		WHERE expires_at < now()
		   OR (consumed_at IS NOT NULL AND consumed_at < now() - interval '1 hour')`)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected(), nil
}

// purgeDeadSessions deletes sessions expired beyond a 7-day grace, including
// long-revoked ones. Live and recently-dead sessions are preserved.
func purgeDeadSessions(ctx context.Context, conn *pgx.Conn) (int64, error) {
	var n int64
	err := conn.QueryRow(ctx, `WITH deleted AS (
		DELETE FROM sessions
		WHERE expires_at < now() - interval '7 days'
		   OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '7 days')
		RETURNING id
	) SELECT count(*) FROM deleted`).Scan(&n)
	if err != nil {
		return 0, err
	}
	return n, nil
}
