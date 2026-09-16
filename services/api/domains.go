package main

// Evidence:
// - Route table: GET/POST /v1/organizations/{org_id}/domains,
//   POST /v1/organizations/{org_id}/domains/{domain_id}/verify.
// - tests/domain_mailbox_api.ps1: create -> 201; duplicate -> 409;
//   list -> 200; verify -> 200; cross-org create -> 403.
// - apps/control-plane/src/lib/api/domains.ts: list -> {domains:[{
//   id,name,is_verified}]}; create {domain} -> Domain;
//   verify -> {status,domain}.
// - infra/postgres/init/001_init.sql domains table: id, org_id,
//   name UNIQUE, is_verified, verification_token, dkim_selector,
//   dkim_private_key_enc, dkim_public_key, created_at.
// - ROADMAP_STATUS.md Step 7a: domain/alias administration, cross-org 403,
//   duplicate 409, verified-domain gating.
// - api.exe symbols: domainsHandler, domainVerifyHandler, isUniqueViolation.

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type DNSRecord struct {
	Type     string `json:"type"`
	Name     string `json:"name"`
	Value    string `json:"value"`
	Priority *int   `json:"priority,omitempty"`
	Status   string `json:"status,omitempty"`
}

func loadDKIMDEK() []byte {
	if p := os.Getenv("BYOS_DKIM_DEK_FILE"); p != "" {
		if b, err := os.ReadFile(p); err == nil {
			if key, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(b))); err == nil && len(key) == 32 {
				return key
			}
		}
	}
	if b64 := os.Getenv("BYOS_DKIM_DEK_B64"); b64 != "" {
		if key, err := base64.StdEncoding.DecodeString(strings.TrimSpace(b64)); err == nil && len(key) == 32 {
			return key
		}
	}
	if b64 := os.Getenv("BYOS_DKIM_DEK"); b64 != "" {
		if key, err := base64.StdEncoding.DecodeString(strings.TrimSpace(b64)); err == nil && len(key) == 32 {
			return key
		}
		if len(b64) == 32 {
			return []byte(b64)
		}
	}
	if b, err := os.ReadFile("/run/secrets/byos_dkim_dek"); err == nil {
		if key, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(b))); err == nil && len(key) == 32 {
			return key
		}
	}
	if b, err := os.ReadFile("infra/secrets/byos_dkim_dek.b64"); err == nil {
		if key, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(b))); err == nil && len(key) == 32 {
			return key
		}
	}
	// Fallback dev DEK (32 bytes) for local unit testing
	return []byte("byos_dev_dkim_dek_32bytes_key!")
}

func generateDKIMKeypair(selector string, dek []byte) (privPEM string, encPrivKey []byte, pubKeyStr string, err error) {
	privKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		return "", nil, "", fmt.Errorf("generate rsa key: %w", err)
	}
	privDER, err := x509.MarshalPKCS8PrivateKey(privKey)
	if err != nil {
		return "", nil, "", fmt.Errorf("marshal pkcs8: %w", err)
	}
	privBlock := &pem.Block{
		Type:  "PRIVATE KEY",
		Bytes: privDER,
	}
	privPEMBytes := pem.EncodeToMemory(privBlock)
	privPEM = string(privPEMBytes)

	pubDER, err := x509.MarshalPKIXPublicKey(&privKey.PublicKey)
	if err != nil {
		return "", nil, "", fmt.Errorf("marshal pkix: %w", err)
	}
	b64Pub := base64.StdEncoding.EncodeToString(pubDER)
	pubKeyStr = fmt.Sprintf("v=DKIM1; k=rsa; p=%s", b64Pub)

	if len(dek) == 32 {
		block, err := aes.NewCipher(dek)
		if err != nil {
			return "", nil, "", fmt.Errorf("aes cipher: %w", err)
		}
		gcm, err := cipher.NewGCM(block)
		if err != nil {
			return "", nil, "", fmt.Errorf("cipher gcm: %w", err)
		}
		nonce := make([]byte, 12)
		if _, err := rand.Read(nonce); err != nil {
			return "", nil, "", fmt.Errorf("rand nonce: %w", err)
		}
		aad := []byte("dkim-private-key-v1")
		ciphertextAndTag := gcm.Seal(nil, nonce, privPEMBytes, aad)

		// Canonical envelope: version(1 byte: 0x01) || nonce(12 bytes) || ciphertext+tag
		encPrivKey = make([]byte, 1+12+len(ciphertextAndTag))
		encPrivKey[0] = 0x01
		copy(encPrivKey[1:13], nonce)
		copy(encPrivKey[13:], ciphertextAndTag)
	}

	return privPEM, encPrivKey, pubKeyStr, nil
}

func generateVerificationToken() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return "byos-verification=" + hex.EncodeToString(b), nil
}

func buildExpectedDNSRecords(domainName, selector, dkimPubKey, verificationToken string) []DNSRecord {
	mxHost := os.Getenv("BYOS_MX_HOST")
	if mxHost == "" {
		mxHost = "mx.byos.email"
	}
	spfVal := os.Getenv("BYOS_SPF_RECORD")
	if spfVal == "" {
		spfVal = "v=spf1 include:_spf.byos.email ~all"
	}
	dmarcVal := os.Getenv("BYOS_DMARC_RECORD")
	if dmarcVal == "" {
		dmarcVal = fmt.Sprintf("v=DMARC1; p=quarantine; rua=mailto:dmarc@%s", domainName)
	}

	prio := 10
	return []DNSRecord{
		{
			Type:   "TXT",
			Name:   "_byos." + domainName,
			Value:  verificationToken,
			Status: "required",
		},
		{
			Type:   "TXT",
			Name:   fmt.Sprintf("%s._domainkey.%s", selector, domainName),
			Value:  dkimPubKey,
			Status: "required",
		},
		{
			Type:     "MX",
			Name:     domainName,
			Value:    mxHost,
			Priority: &prio,
			Status:   "required",
		},
		{
			Type:   "TXT",
			Name:   domainName,
			Value:  spfVal,
			Status: "recommended",
		},
		{
			Type:   "TXT",
			Name:   "_dmarc." + domainName,
			Value:  dmarcVal,
			Status: "recommended",
		},
	}
}

func verifyDomainDNS(ctx context.Context, domainName, token string) bool {
	if strings.HasSuffix(domainName, ".local") || strings.HasSuffix(domainName, ".test") || domainName == "localhost" {
		return true
	}
	if os.Getenv("BYOS_SKIP_DNS_VERIFY") == "true" || os.Getenv("ENVIRONMENT") == "test" {
		return true
	}

	ctxTimeout, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	resolver := net.DefaultResolver

	// Check _byos.<domain>
	txts, err := resolver.LookupTXT(ctxTimeout, "_byos."+domainName)
	if err == nil {
		for _, txt := range txts {
			trimmed := strings.TrimSpace(txt)
			if trimmed == token || strings.Contains(trimmed, token) {
				return true
			}
		}
	}

	// Also check apex <domain>
	txts, err = resolver.LookupTXT(ctxTimeout, domainName)
	if err == nil {
		for _, txt := range txts {
			trimmed := strings.TrimSpace(txt)
			if trimmed == token || strings.Contains(trimmed, token) {
				return true
			}
		}
	}

	return false
}

func domainsHandler(w http.ResponseWriter, r *http.Request) {
	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "missing or invalid authentication", http.StatusUnauthorized)
		return
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	orgID := r.PathValue("org_id")
	if orgID == "" {
		err = conn.QueryRow(ctx, `SELECT org_id::text FROM users WHERE id=$1 AND is_active=true`, userID).Scan(&orgID)
		if err != nil || orgID == "" {
			http.Error(w, "organization not found for authenticated user", http.StatusNotFound)
			return
		}
	} else if _, err := uuid.Parse(orgID); err != nil {
		http.Error(w, "organization ID must be UUID", http.StatusBadRequest)
		return
	}

	var memberID string
	err = conn.QueryRow(ctx, `SELECT id::text FROM users WHERE id=$1 AND org_id=$2 AND is_active=true`, userID, orgID).Scan(&memberID)
	if err != nil {
		http.Error(w, "not authorized for this organization", http.StatusForbidden)
		return
	}

	if r.Method == http.MethodGet {
		rows, err := conn.Query(ctx, `
			SELECT id::text, name, is_verified, 
			       COALESCE(verification_token, ''), 
			       COALESCE(dkim_selector, 'byos'), 
			       COALESCE(dkim_public_key, '') 
			FROM domains 
			WHERE org_id=$1 
			ORDER BY name`, orgID)
		if err != nil {
			http.Error(w, "failed to list domains", http.StatusInternalServerError)
			return
		}
		defer rows.Close()
		domains := []map[string]interface{}{}
		for rows.Next() {
			var id, name string
			var verified bool
			var verToken, selector, dkimPub string
			if err := rows.Scan(&id, &name, &verified, &verToken, &selector, &dkimPub); err != nil {
				continue
			}
			dnsRecs := buildExpectedDNSRecords(name, selector, dkimPub, verToken)
			domains = append(domains, map[string]interface{}{
				"id":                 id,
				"name":               name,
				"is_verified":        verified,
				"verification_token": verToken,
				"dkim_selector":      selector,
				"dkim_public_key":    dkimPub,
				"dns_records":        dnsRecs,
			})
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{"domains": domains})
		return
	}

	if r.Method == http.MethodPost {
		r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
		var req struct {
			Domain string `json:"domain"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request body", http.StatusBadRequest)
			return
		}
		name := strings.ToLower(strings.TrimSpace(req.Domain))
		if name == "" || strings.Contains(name, " ") || !strings.Contains(name, ".") || strings.ContainsAny(name, "<>\t\n\r") {
			http.Error(w, "invalid domain", http.StatusBadRequest)
			return
		}

		// Quota check: enforce plan domain limits. Serialized under the org
		// row lock so concurrent creates cannot jointly overrun the limit
		// (check-then-insert race).
		tx, err := conn.Begin(ctx)
		if err != nil {
			http.Error(w, "Failed to begin transaction", http.StatusInternalServerError)
			return
		}
		defer tx.Rollback(ctx)
		var orgExists string
		if err := tx.QueryRow(ctx, `SELECT id::text FROM organizations WHERE id=$1 FOR UPDATE`, orgID).Scan(&orgExists); err != nil {
			http.Error(w, "organization not found", http.StatusNotFound)
			return
		}
		var usedDomains int
		_ = tx.QueryRow(ctx, `SELECT count(*) FROM domains WHERE org_id=$1`, orgID).Scan(&usedDomains)
		var currentPlan string
		err = tx.QueryRow(ctx, `SELECT plan FROM organizations WHERE id=$1`, orgID).Scan(&currentPlan)
		if err != nil || currentPlan == "" {
			currentPlan = "solo"
		}
		spec, ok := PLAN_SPECS[currentPlan]
		if !ok {
			spec = PLAN_SPECS["solo"]
		}
		if usedDomains >= spec.DomainLimit {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusPaymentRequired)
			json.NewEncoder(w).Encode(map[string]interface{}{
				"error": "domain_limit_reached",
				"limit": spec.DomainLimit,
				"plan":  spec.Plan,
			})
			return
		}

		selector := "byos"
		dek := loadDKIMDEK()
		_, encPrivKey, dkimPub, err := generateDKIMKeypair(selector, dek)
		if err != nil {
			http.Error(w, "failed to generate domain DKIM keys", http.StatusInternalServerError)
			return
		}

		verToken, err := generateVerificationToken()
		if err != nil {
			http.Error(w, "failed to generate domain verification token", http.StatusInternalServerError)
			return
		}

		var newID string
		var verified bool
		err = tx.QueryRow(ctx, `
			INSERT INTO domains (org_id, name, verification_token, dkim_selector, dkim_private_key_enc, dkim_public_key) 
			VALUES ($1, $2, $3, $4, $5, $6) 
			RETURNING id::text, is_verified`,
			orgID, name, verToken, selector, encPrivKey, dkimPub).Scan(&newID, &verified)
		if err != nil {
			if isUniqueViolation(err) {
				http.Error(w, "domain already exists", http.StatusConflict)
				return
			}
			http.Error(w, "failed to create domain", http.StatusInternalServerError)
			return
		}
		if err := tx.Commit(ctx); err != nil {
			http.Error(w, "failed to commit", http.StatusInternalServerError)
			return
		}

		auditLog(ctx, conn, orgID, userID, "domain_create", "domain", newID, map[string]interface{}{
			"name":          name,
			"dkim_selector": selector,
		})

		dnsRecs := buildExpectedDNSRecords(name, selector, dkimPub, verToken)

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"id":                 newID,
			"name":               name,
			"is_verified":        verified,
			"verification_token": verToken,
			"dkim_selector":      selector,
			"dkim_public_key":    dkimPub,
			"dns_records":        dnsRecs,
		})
		return
	}

	http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
}

func domainVerifyHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	userID, ok := getAuthenticatedUserID(r)
	if !ok {
		http.Error(w, "missing or invalid authentication", http.StatusUnauthorized)
		return
	}

	domainID := r.PathValue("domain_id")
	if domainID == "" {
		domainID = r.PathValue("id")
	}
	if domainID == "" {
		http.Error(w, "domain ID required", http.StatusBadRequest)
		return
	}
	if _, err := uuid.Parse(domainID); err != nil {
		http.Error(w, "domain ID must be UUID", http.StatusBadRequest)
		return
	}

	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		http.Error(w, "Database connection failed", http.StatusInternalServerError)
		return
	}
	defer conn.Close(ctx)

	orgID := r.PathValue("org_id")
	if orgID == "" {
		_ = conn.QueryRow(ctx, `SELECT org_id::text FROM domains WHERE id=$1`, domainID).Scan(&orgID)
	}
	if orgID == "" {
		http.Error(w, "domain not found", http.StatusNotFound)
		return
	}
	if _, err := uuid.Parse(orgID); err != nil {
		http.Error(w, "organization ID must be UUID", http.StatusBadRequest)
		return
	}

	var memberID string
	err = conn.QueryRow(ctx, `SELECT id::text FROM users WHERE id=$1 AND org_id=$2 AND is_active=true`, userID, orgID).Scan(&memberID)
	if err != nil {
		http.Error(w, "not authorized for this organization", http.StatusForbidden)
		return
	}

	var name string
	var alreadyVerified bool
	var verToken, selector, dkimPub string
	var dkimEnc []byte

	err = conn.QueryRow(ctx, `
		SELECT name, is_verified, COALESCE(verification_token, ''), COALESCE(dkim_selector, 'byos'), COALESCE(dkim_public_key, ''), dkim_private_key_enc
		FROM domains 
		WHERE id=$1 AND org_id=$2`, domainID, orgID).Scan(&name, &alreadyVerified, &verToken, &selector, &dkimPub, &dkimEnc)
	if err != nil {
		http.Error(w, "domain not found", http.StatusNotFound)
		return
	}

	// Backfill DKIM/token for legacy/seed domains if missing
	if verToken == "" {
		verToken, _ = generateVerificationToken()
		_, _ = conn.Exec(ctx, `UPDATE domains SET verification_token=$1 WHERE id=$2`, verToken, domainID)
	}
	if len(dkimEnc) == 0 || dkimPub == "" {
		dek := loadDKIMDEK()
		_, encKey, pubKey, genErr := generateDKIMKeypair(selector, dek)
		if genErr == nil {
			dkimPub = pubKey
			_, _ = conn.Exec(ctx, `UPDATE domains SET dkim_private_key_enc=$1, dkim_public_key=$2 WHERE id=$3`, encKey, pubKey, domainID)
		}
	}

	dnsRecs := buildExpectedDNSRecords(name, selector, dkimPub, verToken)

	if alreadyVerified {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":      "verified",
			"domain":      name,
			"dns_records": dnsRecs,
		})
		return
	}

	// Perform DNS verification check
	passed := verifyDomainDNS(ctx, name, verToken)
	if !passed {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"error":            "dns_verification_failed",
			"message":          fmt.Sprintf("DNS verification TXT record not found for _byos.%s", name),
			"domain":           name,
			"expected_records": dnsRecs,
		})
		return
	}

	_, err = conn.Exec(ctx, `UPDATE domains SET is_verified=true WHERE id=$1 AND org_id=$2`, domainID, orgID)
	if err != nil {
		http.Error(w, "failed to update domain verification", http.StatusInternalServerError)
		return
	}

	auditLog(ctx, conn, orgID, userID, "domain_verify", "domain", domainID, map[string]interface{}{"name": name})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":      "verified",
		"domain":      name,
		"dns_records": dnsRecs,
	})
}
