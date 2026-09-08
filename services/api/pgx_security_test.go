package main

// Security regression tests for dependency remediation.
//
// Findings addressed:
//   - GO-2026-4771 / GO-2026-4772 / GO-2026-5004 + GHSA-9jj7-4m8r-rfcm,
//     GHSA-j88v-2chj-qfwx, GHSA-xgrm-4fwx-7qm8 (pgx memory-safety + SQL
//     injection via placeholder confusion with dollar-quoted literals).
//     Fixed in pgx v5.9.2; this module pins v5.10.0.
//   - x/crypto batch (incl. GO-2026-6355), GO-2026-5024 (x/sys),
//     GO-2026-5970 (x/text): pinned at verified-clean versions.
//
// Reachability note: this service never uses pgx simple protocol
// (QueryExecModeSimpleProtocol), which the SQL injection requires, and never
// imports x/crypto/openpgp (subject of GO-2026-5932). The upgrades are
// defense in depth; the tests below pin the floor and prove the PoC shape
// is inert against the linked library.

import (
	"context"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

// minimumVersions pins the floor for dependencies with confirmed advisories.
// TestDependencyMinimums fails if a downgrade reintroduces a known-vulnerable
// version.
var minimumVersions = map[string]string{
	"github.com/jackc/pgx/v5": "v5.9.2",
	"golang.org/x/crypto":     "v0.56.0",
	"golang.org/x/sys":        "v0.47.0",
	"golang.org/x/text":       "v0.41.0",
}

func parseGoModVersions(t *testing.T, path string) map[string]string {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("failed to read %s: %v", path, err)
	}
	vers := map[string]string{}
	for _, line := range strings.Split(string(raw), "\n") {
		fields := strings.Fields(line)
		// Single-line form: `require example.com/mod v1.2.3`
		if len(fields) == 3 && fields[0] == "require" && strings.HasPrefix(fields[2], "v") {
			vers[fields[1]] = fields[2]
			continue
		}
		// Block form entries: `example.com/mod v1.2.3 [// indirect]`
		if len(fields) >= 2 && !strings.HasPrefix(fields[0], "(") &&
			strings.Contains(fields[0], ".") && strings.HasPrefix(fields[1], "v") {
			vers[fields[0]] = fields[1]
		}
	}
	return vers
}

// compareSemver compares release versions of the form vMAJOR.MINOR.PATCH.
// Pre-release suffixes are stripped; missing components compare as zero.
func compareSemver(a, b string) int {
	norm := func(v string) []int {
		v = strings.TrimPrefix(v, "v")
		if i := strings.Index(v, "-"); i >= 0 {
			v = v[:i]
		}
		parts := strings.Split(v, ".")
		out := make([]int, 3)
		for i := 0; i < 3 && i < len(parts); i++ {
			n, _ := strconv.Atoi(parts[i])
			out[i] = n
		}
		return out
	}
	na, nb := norm(a), norm(b)
	for i := 0; i < 3; i++ {
		if na[i] != nb[i] {
			if na[i] < nb[i] {
				return -1
			}
			return 1
		}
	}
	return 0
}

func TestDependencyMinimums(t *testing.T) {
	vers := parseGoModVersions(t, "go.mod")
	for mod, min := range minimumVersions {
		got, ok := vers[mod]
		if !ok {
			t.Errorf("go.mod does not require %s; minimum %s cannot be verified", mod, min)
			continue
		}
		if compareSemver(got, min) < 0 {
			t.Errorf("SECURITY: %s = %s is below the patched floor %s", mod, got, min)
		}
	}
}

// openTestPGX connects with pgx native protocol. Skips (does not fail) when
// postgres is unavailable so unit runs without infrastructure stay green.
func openTestPGX(t *testing.T) (context.Context, *pgx.Conn) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	conn, err := pgx.Connect(ctx, testDSN)
	if err != nil {
		cancel()
		t.Skip("postgres unavailable for DB-gated security test (start local postgres to run)")
	}
	t.Cleanup(func() {
		conn.Close(context.Background())
		cancel()
	})
	return ctx, conn
}

// TestSimpleProtocolDollarQuoteInjectionBlocked replays the pgx GHSA-j88v
// (GO-2026-5004) proof-of-concept shape against the linked library and
// asserts the canary table survives. On a vulnerable pgx the injected
// `drop table` executes and this test fails.
func TestSimpleProtocolDollarQuoteInjectionBlocked(t *testing.T) {
	ctx, conn := openTestPGX(t)
	if _, err := conn.Exec(ctx, `CREATE TEMP TABLE canary(id int)`); err != nil {
		t.Fatalf("setup failed: %v", err)
	}
	attackValue := `$tag$; drop table canary; --`
	// Fixed library: placeholder inside the dollar-quoted literal is not
	// confused for a bind parameter (exec errors or neutralizes safely).
	_, _ = conn.Exec(ctx, `select $tag$ $1 $tag$, $1`, pgx.QueryExecModeSimpleProtocol, attackValue)
	var n int
	if err := conn.QueryRow(ctx, `SELECT count(*) FROM canary`).Scan(&n); err != nil {
		t.Fatalf("SECURITY FAIL: canary table missing, dollar-quote injection succeeded: %v", err)
	}
}

// TestParameterizedRoundTrip is the positive counterpart: attacker-shaped
// values (dollar quotes, comment markers, quotes) round-trip byte-exact
// through parameterized queries on the upgraded pgx.
func TestParameterizedRoundTrip(t *testing.T) {
	ctx, conn := openTestPGX(t)
	if _, err := conn.Exec(ctx, `CREATE TEMP TABLE rt(v text)`); err != nil {
		t.Fatalf("setup failed: %v", err)
	}
	tricky := []string{
		`$tag$; drop table rt; --`,
		`it's a "quoted" value`,
		`$1 $2 $99`,
		"null byte \x00 inside",
		"unicode: \u2028 \u00a0 \U0001f600",
	}
	for _, v := range tricky {
		if _, err := conn.Exec(ctx, `INSERT INTO rt(v) VALUES ($1)`, v); err != nil {
			t.Fatalf("insert failed for %q: %v", v, err)
		}
		var got string
		if err := conn.QueryRow(ctx, `SELECT v FROM rt WHERE v = $1`, v).Scan(&got); err != nil {
			t.Fatalf("select failed for %q: %v", v, err)
		}
		if got != v {
			t.Fatalf("round-trip mismatch: got %q want %q", got, v)
		}
	}
}
