package main

// Security regression tests for dependency remediation.
//
// Findings addressed:
//   - GO-2026-4771 / GO-2026-4772 / GO-2026-5004 + GHSA-9jj7-4m8r-rfcm,
//     GHSA-j88v-2chj-qfwx, GHSA-xgrm-4fwx-7qm8 (pgx memory-safety + SQL
//     injection). Fixed in pgx v5.9.2.
//   - GO-2026-5841 (OOB read in klauspost/compress s2 decoder, reached via
//     minio-go on every S3 response). Fixed in v1.18.7.
//   - x/crypto batch (reached via minio-go pkg/encrypt argon2),
//     GO-2026-5024 (x/sys, windows-only; linux runtime),
//     GO-2026-5970 (x/text, via pgx pgconn SCRAM prep),
//     x/net batch (reached via minio-go http transport).
//     All pinned at OSV-verified-clean versions.

import (
	"bytes"
	"os"
	"strconv"
	"strings"
	"testing"

	"github.com/klauspost/compress/s2"
)

var minimumVersions = map[string]string{
	"github.com/jackc/pgx/v5":       "v5.9.2",
	"github.com/klauspost/compress": "v1.18.7",
	"golang.org/x/crypto":           "v0.56.0",
	"golang.org/x/net":              "v0.57.0",
	"golang.org/x/sys":              "v0.47.0",
	"golang.org/x/text":             "v0.41.0",
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

// TestS2CorruptInputRejected is the negative counterpart for GO-2026-5841
// (OOB read in the s2 decoder). Malformed frames must surface as errors,
// never as panics or silent output. The version pin above is the primary
// control; this guards the decode path the worker exercises on every S3
// response body.
func TestS2CorruptInputRejected(t *testing.T) {
	payload := []byte(strings.Repeat("mailbox object plaintext block ", 64))
	valid := s2.Encode(nil, payload)
	if out, err := s2.Decode(nil, valid); err != nil || !bytes.Equal(out, payload) {
		t.Fatalf("s2 sanity round-trip failed: out=%d bytes err=%v", len(out), err)
	}

	corrupt := map[string][]byte{
		"empty trailer":        valid[:len(valid)-1],
		"truncated half":       valid[:len(valid)/2],
		"single byte":          {0xff},
		"empty":                {},
		"garbage":              []byte("not-an-s2-stream-at-all-0123456789"),
		"oversized len header": append([]byte{0x00, 0xff, 0xff, 0xff}, valid[4:]...),
	}
	for name, in := range corrupt {
		func() {
			defer func() {
				if r := recover(); r != nil {
					t.Errorf("SECURITY: s2.Decode panicked on %q: %v", name, r)
				}
			}()
			if len(in) == 0 {
				return
			}
			if _, err := s2.Decode(nil, in); err == nil {
				t.Errorf("expected error decoding %q, got success", name)
			}
		}()
	}
}
