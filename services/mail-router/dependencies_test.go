package main

// Security regression test for dependency remediation.
//
// Findings addressed:
//   - GO-2026-4771 / GO-2026-4772 / GO-2026-5004 + GHSA-9jj7-4m8r-rfcm,
//     GHSA-j88v-2chj-qfwx, GHSA-xgrm-4fwx-7qm8 (pgx memory-safety + SQL
//     injection via placeholder confusion). Fixed in pgx v5.9.2.
//   - GO-2026-5970 (x/text infinite loop): pinned at verified-clean v0.41.0.
//     x/text is reached via pgx pgconn SCRAM prep (secure/precis).
//
// Reachability note: this service never uses pgx simple protocol
// (QueryExecModeSimpleProtocol), which the SQL injection requires. The
// upgrade is defense in depth; this test pins the floor so a downgrade
// reintroducing a known-vulnerable version fails the build.

import (
	"os"
	"strconv"
	"strings"
	"testing"
)

var minimumVersions = map[string]string{
	"github.com/jackc/pgx/v5": "v5.9.2",
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
