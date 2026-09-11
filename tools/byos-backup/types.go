package main

// DefaultTables lists all control-plane and metadata tables in dependency order.
// Crucial Section 23 constraint: This schema contains control-plane records,
// routing information, and cryptographic metadata. Customer email plaintext
// bodies are stored exclusively in customer-configured object storage (e.g. MinIO/S3/GCS/Drive)
// and are never mirrored as a centralized plaintext archive.
var DefaultTables = []string{
	"organizations",
	"users",
	"domains",
	"root_secrets",
	"mailboxes",
	"aliases",
	"devices",
	"device_mailbox_access",
	"org_recovery_principals",
	"storage_connections",
	"mailbox_storage",
	"message_metadata",
	"attachments",
	"rate_limits",
	"audit_log",
	"search_tokens",
	"bridge_credentials",
	"contacts",
	"scheduled_messages",
	"outbound_queue",
	"drafts",
	"delivery_log",
}

// Manifest represents the top-level metadata and integrity manifest of a BYOS backup bundle.
type Manifest struct {
	Version      int              `json:"version"`
	Timestamp    string           `json:"timestamp"`
	BYOSVersion  string           `json:"byos_version"`
	Mode         string           `json:"mode"`
	Tables       []TableEntry     `json:"tables"`
	TotalRecords int              `json:"total_records"`
	TotalTables  int              `json:"total_tables"`
	BundleSHA256 string           `json:"bundle_sha256"`
	Compliance   ComplianceReport `json:"compliance"`
}

// TableEntry describes an individual table file in the backup bundle.
type TableEntry struct {
	Name      string `json:"name"`
	File      string `json:"file"`
	Records   int    `json:"records"`
	SHA256    string `json:"sha256"`
	SizeBytes int64  `json:"size_bytes"`
}

// ComplianceReport documents adherence to Section 23 specifications.
type ComplianceReport struct {
	Section23NoPlaintextArchives bool     `json:"section23_no_plaintext_archives"`
	CryptoMetadataPreserved      bool     `json:"crypto_metadata_preserved"`
	DisasterRecoveryReady        bool     `json:"disaster_recovery_ready"`
	ProhibitedPlaintextStores    []string `json:"prohibited_plaintext_stores"`
}

// TableVerifyStatus summarizes verification results for a single table.
type TableVerifyStatus struct {
	Name          string `json:"name"`
	Records       int    `json:"records"`
	ChecksumValid bool   `json:"checksum_valid"`
	SchemaValid   bool   `json:"schema_valid"`
	CryptoValid   bool   `json:"crypto_valid"`
}

// VerifyResult contains the comprehensive outcome of backup bundle verification.
type VerifyResult struct {
	Passed           bool                         `json:"passed"`
	Manifest         *Manifest                    `json:"manifest"`
	ValidatedTables  int                          `json:"validated_tables"`
	ValidatedRecords int                          `json:"validated_records"`
	Errors           []string                     `json:"errors"`
	Warnings         []string                     `json:"warnings"`
	TableDetails     map[string]TableVerifyStatus `json:"table_details"`
}

// RestoreResult documents the outcome of a restore operation.
type RestoreResult struct {
	Success         bool           `json:"success"`
	DryRun          bool           `json:"dry_run"`
	RestoredTables  int            `json:"restored_tables"`
	RestoredRecords int            `json:"restored_records"`
	TableCounts     map[string]int `json:"table_counts"`
	Duration        string         `json:"duration"`
}

// InspectReport provides a human-readable high-level inspection summary.
type InspectReport struct {
	Timestamp            string            `json:"timestamp"`
	BYOSVersion          string            `json:"byos_version"`
	IntegrityValid       bool              `json:"integrity_valid"`
	OrganizationsCount   int               `json:"organizations_count"`
	UsersCount           int               `json:"users_count"`
	DomainsCount         int               `json:"domains_count"`
	MailboxesCount       int               `json:"mailboxes_count"`
	StorageConnCount     int               `json:"storage_connections_count"`
	MessageMetadataCount int               `json:"message_metadata_count"`
	TotalSizeBytes       int64             `json:"total_size_bytes"`
	Tables               map[string]int    `json:"tables"`
	Errors               []string          `json:"errors,omitempty"`
}
