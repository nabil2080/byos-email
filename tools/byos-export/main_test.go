package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func writeObject(t *testing.T, dir, rel string, data []byte) {
	t.Helper()
	p := filepath.Join(dir, rel)
	if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(p, data, 0644); err != nil {
		t.Fatalf("write: %v", err)
	}
}

func readManifest(t *testing.T, outDir string) manifest {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(outDir, manifestName))
	if err != nil {
		t.Fatalf("read manifest: %v", err)
	}
	var m manifest
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("decode manifest: %v", err)
	}
	return m
}

// Happy path: nested objects exported byte-identical with a correct manifest.
func TestExportRoundTrip(t *testing.T) {
	storage := t.TempDir()
	a := []byte{0x01, 0x02, 0x03, 0x04}
	b := make([]byte, 1024)
	for i := range b {
		b[i] = byte(i)
	}
	writeObject(t, storage, filepath.Join("mailboxes", "m1", "0001.eml.enc"), a)
	writeObject(t, storage, "loose.bin", b)

	out := filepath.Join(t.TempDir(), "out")
	stats, err := runExport(storage, out)
	if err != nil {
		t.Fatalf("runExport: %v", err)
	}
	if stats.exported != 2 || len(stats.failed) != 0 {
		t.Fatalf("stats = %+v, want 2 exported 0 failed", stats)
	}
	m := readManifest(t, out)
	if m.Version != 1 || m.Mode != "raw" || m.Exported != 2 || len(m.Objects) != 2 {
		t.Fatalf("manifest header = %+v", m)
	}
	seen := map[string]bool{}
	for _, e := range m.Objects {
		seen[e.Source] = true
		raw, err := os.ReadFile(filepath.Join(storage, filepath.FromSlash(e.Source)))
		if err != nil {
			t.Fatalf("source missing: %v", err)
		}
		got, err := os.ReadFile(filepath.Join(out, e.File))
		if err != nil {
			t.Fatalf("export missing: %v", err)
		}
		if string(got) != string(raw) {
			t.Fatalf("%s bytes altered", e.Source)
		}
		if int64(len(got)) != e.Size {
			t.Fatalf("%s size mismatch", e.Source)
		}
		sum := sha256.Sum256(raw)
		if e.SHA256 != hex.EncodeToString(sum[:]) {
			t.Fatalf("%s sha mismatch", e.Source)
		}
	}
	if !seen[filepath.ToSlash(filepath.Join("mailboxes", "m1", "0001.eml.enc"))] || !seen["loose.bin"] {
		t.Fatalf("manifest sources = %v", seen)
	}
}

// Empty storage is not "success with 0": manifest is still written so the
// run is auditable, and the caller sees zero exported.
func TestExportEmptyStorage(t *testing.T) {
	storage := t.TempDir()
	out := filepath.Join(t.TempDir(), "out")
	stats, err := runExport(storage, out)
	if err != nil {
		t.Fatalf("runExport: %v", err)
	}
	if stats.exported != 0 || len(stats.failed) != 0 {
		t.Fatalf("stats = %+v", stats)
	}
	m := readManifest(t, out)
	if len(m.Objects) != 0 || m.Exported != 0 {
		t.Fatalf("manifest = %+v", m)
	}
}

// Missing storage root fails loudly instead of reporting success with 0.
func TestExportMissingStorageFails(t *testing.T) {
	out := filepath.Join(t.TempDir(), "out")
	if _, err := runExport(filepath.Join(t.TempDir(), "nope"), out); err == nil {
		t.Fatal("expected error for missing storage root")
	}
}

// Storage path that is a file, not a directory, fails loudly.
func TestExportFileAsStorageFails(t *testing.T) {
	f := filepath.Join(t.TempDir(), "file")
	if err := os.WriteFile(f, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := runExport(f, filepath.Join(t.TempDir(), "out")); err == nil {
		t.Fatal("expected error for file storage root")
	}
}

// Unreadable entries are collected as failures while good objects still
// export; the manifest records both sides.
func TestExportPartialFailure(t *testing.T) {
	storage := t.TempDir()
	writeObject(t, storage, "good.enc", []byte{0x01, 0x02})
	// Oversized object trips the 40 MB budget guard without allocating it:
	// create a sparse file so the test stays cheap.
	big := filepath.Join(storage, "big.enc")
	fh, err := os.Create(big)
	if err != nil {
		t.Fatal(err)
	}
	if err := fh.Truncate(maxObjectSize + 1); err != nil {
		fh.Close()
		t.Fatal(err)
	}
	fh.Close()

	out := filepath.Join(t.TempDir(), "out")
	stats, err := runExport(storage, out)
	if err != nil {
		t.Fatalf("runExport: %v", err)
	}
	if stats.exported != 1 || len(stats.failed) != 1 {
		t.Fatalf("stats = %+v, want 1 exported 1 failed", stats)
	}
	m := readManifest(t, out)
	if len(m.Objects) != 1 || len(m.Failed) != 1 {
		t.Fatalf("manifest = %+v", m)
	}
}
