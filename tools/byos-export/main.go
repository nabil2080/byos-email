package main

// BYOS Independent Mailbox Export & Recovery Tool (Section 24).
//
// Current scope (interim): raw-object export only. The tool walks a local
// customer object-storage directory WITHOUT any live SaaS dependency and
// copies opaque objects byte-for-byte into an output directory with a
// SHA-256 manifest.
//
// Explicit non-goals in this build:
//   - No decryption. Decrypted export requires the Section 12 canonical
//     primitives (BIP39 -> HKDF root -> HPKE mailbox unwrap -> content-key
//     unwrap -> AES-GCM with the 0x01||nonce12||ct+tag envelope), which live
//     in the Rust crypto-core. A local AES-GCM helper must NOT be
//     re-invented here (it would use the wrong envelope convention).
//   - No mnemonic verification. --mnemonic is therefore rejected loudly
//     instead of being accepted and ignored: silently ignoring recovery
//     material in a recovery tool is worse than refusing.

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

// exit codes: 0 success, 1 usage/operational failure, 2 decrypt requested
// (explicitly unimplemented boundary).
const (
	exitOK        = 0
	exitFailure   = 1
	exitNotImpl   = 2
	manifestName  = "manifest.json"
	maxObjectSize = 40 * 1024 * 1024 // Section 20 V1 total message budget
)

type manifestEntry struct {
	Source string `json:"source"` // storage-relative object path
	File   string `json:"file"`   // export-relative output path
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

type manifest struct {
	Version  int             `json:"version"`
	Mode     string          `json:"mode"` // "raw" until decrypted export lands
	Objects  []manifestEntry `json:"objects"`
	Failed   []string        `json:"failed"`
	Exported int             `json:"exported"`
}

type exportStats struct {
	exported int
	failed   []string
}

func main() {
	storageDir := flag.String("storage-dir", "", "Path to local customer object storage directory (e.g. /tmp/byos-drive-mock)")
	mnemonic := flag.String("mnemonic", "", "24-word recovery phrase (NOT YET SUPPORTED: decrypted export is unimplemented)")
	outDir := flag.String("out-dir", "./exported-mailbox", "Output directory for exported objects")
	flag.Parse()

	if *mnemonic != "" {
		fmt.Fprintln(os.Stderr, "ERROR: decrypted export using --mnemonic is not implemented in this build.")
		fmt.Fprintln(os.Stderr, "The tool currently performs raw-object export only; recovery-phrase")
		fmt.Fprintln(os.Stderr, "decryption requires the Section 12 canonical primitives (see manifest mode).")
		fmt.Fprintln(os.Stderr, "Re-run without --mnemonic for a raw export.")
		os.Exit(exitNotImpl)
	}
	if *storageDir == "" {
		fmt.Fprintln(os.Stderr, "BYOS Independent Mailbox Export & Recovery Tool (Section 24, raw-object mode)")
		fmt.Fprintln(os.Stderr, "Usage:")
		fmt.Fprintln(os.Stderr, "  byos-export --storage-dir /path/to/storage --out-dir ./exported-mailbox")
		fmt.Fprintln(os.Stderr, "Notes:")
		fmt.Fprintln(os.Stderr, "  - No live SaaS dependency; reads local storage only.")
		fmt.Fprintln(os.Stderr, "  - Objects are copied byte-for-byte (still encrypted); nothing is decrypted.")
		fmt.Fprintln(os.Stderr, "  - A manifest.json with per-object SHA-256 is written to --out-dir.")
		os.Exit(exitFailure)
	}

	stats, err := runExport(*storageDir, *outDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "ERROR: export failed: %v\n", err)
		os.Exit(exitFailure)
	}
	fmt.Printf("Exported %d object(s) to %s", stats.exported, *outDir)
	if len(stats.failed) > 0 {
		fmt.Printf(" with %d failure(s):\n", len(stats.failed))
		for _, f := range stats.failed {
			fmt.Printf("  - %s\n", f)
		}
		os.Exit(exitFailure)
		return
	}
	fmt.Println(" with 0 failures.")
	if stats.exported == 0 {
		fmt.Fprintln(os.Stderr, "WARNING: storage contained no objects; output holds only manifest.json.")
	}
}

// runExport copies regular files under storageDir into outDir and writes a
// manifest. It fails loudly (non-nil error) when the storage root is
// unreadable or the manifest cannot be written; per-object failures are
// collected in stats.failed so one bad file cannot silently poison the run.
func runExport(storageDir, outDir string) (exportStats, error) {
	var stats exportStats
	rootInfo, err := os.Stat(storageDir)
	if err != nil {
		return stats, fmt.Errorf("storage dir unreadable: %w", err)
	}
	if !rootInfo.IsDir() {
		return stats, fmt.Errorf("storage dir is not a directory: %s", storageDir)
	}
	if err := os.MkdirAll(outDir, 0755); err != nil {
		return stats, fmt.Errorf("create output directory: %w", err)
	}

	m := manifest{Version: 1, Mode: "raw", Objects: []manifestEntry{}, Failed: []string{}}
	index := 0
	walkErr := filepath.WalkDir(storageDir, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			stats.failed = append(stats.failed, path+": "+err.Error())
			return nil
		}
		if d.IsDir() {
			return nil
		}
		if !d.Type().IsRegular() {
			stats.failed = append(stats.failed, path+": not a regular file, skipped")
			return nil
		}
		rel, err := filepath.Rel(storageDir, path)
		if err != nil {
			stats.failed = append(stats.failed, path+": "+err.Error())
			return nil
		}
		info, err := d.Info()
		if err != nil {
			stats.failed = append(stats.failed, path+": "+err.Error())
			return nil
		}
		if info.Size() > maxObjectSize {
			stats.failed = append(stats.failed, path+": exceeds 40 MB V1 object budget, skipped")
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			stats.failed = append(stats.failed, path+": read failed: "+err.Error())
			return nil
		}
		sum := sha256.Sum256(data)
		// .enc suffix: payloads remain encrypted; never imply readable mail.
		outName := fmt.Sprintf("object_%05d.enc", index+1)
		outPath := filepath.Join(outDir, outName)
		if err := os.WriteFile(outPath, data, 0644); err != nil {
			stats.failed = append(stats.failed, path+": write failed: "+err.Error())
			return nil
		}
		m.Objects = append(m.Objects, manifestEntry{
			Source: filepath.ToSlash(rel),
			File:   outName,
			Size:   int64(len(data)),
			SHA256: hex.EncodeToString(sum[:]),
		})
		index++
		stats.exported++
		return nil
	})
	if walkErr != nil {
		return stats, fmt.Errorf("traverse storage: %w", walkErr)
	}
	m.Exported = stats.exported
	m.Failed = append([]string{}, stats.failed...)
	manifestBytes, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return stats, fmt.Errorf("encode manifest: %w", err)
	}
	if err := os.WriteFile(filepath.Join(outDir, manifestName), manifestBytes, 0644); err != nil {
		return stats, fmt.Errorf("write manifest: %w", err)
	}
	return stats, nil
}
