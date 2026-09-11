package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// RunInspect parses a backup bundle and returns high-level diagnostic statistics.
func RunInspect(backupDir string) (*InspectReport, error) {
	manifestPath := filepath.Join(backupDir, "manifest.json")
	data, err := os.ReadFile(manifestPath)
	if err != nil {
		return nil, fmt.Errorf("open manifest %s: %w", manifestPath, err)
	}

	var manifest Manifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return nil, fmt.Errorf("parse manifest %s: %w", manifestPath, err)
	}

	report := &InspectReport{
		Timestamp:      manifest.Timestamp,
		BYOSVersion:    manifest.BYOSVersion,
		IntegrityValid: true,
		Tables:         make(map[string]int),
	}

	var totalSize int64
	for _, entry := range manifest.Tables {
		report.Tables[entry.Name] = entry.Records
		totalSize += entry.SizeBytes

		switch entry.Name {
		case "organizations":
			report.OrganizationsCount = entry.Records
		case "users":
			report.UsersCount = entry.Records
		case "domains":
			report.DomainsCount = entry.Records
		case "mailboxes":
			report.MailboxesCount = entry.Records
		case "storage_connections":
			report.StorageConnCount = entry.Records
		case "message_metadata":
			report.MessageMetadataCount = entry.Records
		}
	}
	report.TotalSizeBytes = totalSize

	// Run light verification
	verifyRes, err := RunVerify(backupDir)
	if err != nil || !verifyRes.Passed {
		report.IntegrityValid = false
		if verifyRes != nil {
			report.Errors = verifyRes.Errors
		} else if err != nil {
			report.Errors = []string{err.Error()}
		}
	}

	return report, nil
}
