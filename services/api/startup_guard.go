package main

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/argon2"
)

// Candidate passwords for dev/test environments.
var devCandidatePasswords = []string{
	"test-password-123",
	"BYOSTest2026!",
	"password123",
	"dev_password",
	"byos_dev_password",
}

type wrappedSkUserPayload struct {
	Salt            string `json:"salt"`
	SigningSalt     string `json:"signing_salt"`
	SigningEnvelope string `json:"signing_envelope"`
	SigningSeed     string `json:"signing_seed"`
	KdfParams       struct {
		Algorithm  string `json:"algorithm"`
		Salt       string `json:"salt"`
		TimeCost   uint32 `json:"time_cost"`
		MemoryCost uint32 `json:"memory_cost"`
		Parallel   uint8  `json:"parallelism"`
	} `json:"kdf_params"`
	TimeCost   uint32 `json:"time_cost"`
	MemoryCost uint32 `json:"memory_cost"`
	Parallel   uint8  `json:"parallelism"`
}

// DeriveEd25519PubkeyFromWrappedSeed unwraps the Ed25519 signing seed from wrapped_sk_user
// and computes the corresponding Ed25519 public key.
func DeriveEd25519PubkeyFromWrappedSeed(wrappedJSON string) ([]byte, error) {
	trimmed := strings.TrimSpace(wrappedJSON)
	if trimmed == "" {
		return nil, fmt.Errorf("empty wrapped_sk_user")
	}

	var payload wrappedSkUserPayload
	if err := json.Unmarshal([]byte(trimmed), &payload); err != nil {
		return nil, fmt.Errorf("invalid wrapped_sk_user JSON: %w", err)
	}

	tCost := payload.KdfParams.TimeCost
	if tCost == 0 {
		tCost = payload.TimeCost
	}
	if tCost == 0 {
		tCost = 3
	}

	mCost := payload.KdfParams.MemoryCost
	if mCost == 0 {
		mCost = payload.MemoryCost
	}
	if mCost == 0 {
		mCost = 65536
	}

	pCost := payload.KdfParams.Parallel
	if pCost == 0 {
		pCost = payload.Parallel
	}
	if pCost == 0 {
		pCost = 2
	}

	if tCost > 10 || mCost > 1_048_576 || pCost > 8 {
		return nil, fmt.Errorf("argon2 parameters exceed safety limits")
	}

	if payload.SigningSeed != "" {
		seed, err := hex.DecodeString(payload.SigningSeed)
		if err == nil && len(seed) == 32 {
			priv := ed25519.NewKeyFromSeed(seed)
			return []byte(priv.Public().(ed25519.PublicKey)), nil
		}
	}

	saltHex := payload.SigningSalt
	if saltHex == "" {
		saltHex = payload.KdfParams.Salt
	}
	if saltHex == "" {
		saltHex = payload.Salt
	}

	if saltHex == "" || payload.SigningEnvelope == "" {
		return nil, fmt.Errorf("missing signing_salt or signing_envelope in wrapped_sk_user")
	}

	salt, err := hex.DecodeString(saltHex)
	if err != nil || len(salt) != 16 {
		return nil, fmt.Errorf("invalid signing_salt: %w", err)
	}

	envelope, err := hex.DecodeString(payload.SigningEnvelope)
	if err != nil || len(envelope) < 29 || envelope[0] != 1 {
		return nil, fmt.Errorf("invalid signing_envelope")
	}

	nonce := envelope[1:13]
	ciphertext := envelope[13:]
	aad := []byte("byos-recovery-principal-v1")

	for _, pwd := range devCandidatePasswords {
		key := argon2.IDKey([]byte(pwd), salt, tCost, mCost, pCost, 32)
		block, err := aes.NewCipher(key)
		if err != nil {
			continue
		}
		gcm, err := cipher.NewGCM(block)
		if err != nil {
			continue
		}
		seed, err := gcm.Open(nil, nonce, ciphertext, aad)
		if err == nil && len(seed) == 32 {
			priv := ed25519.NewKeyFromSeed(seed)
			return []byte(priv.Public().(ed25519.PublicKey)), nil
		}
	}

	return nil, fmt.Errorf("unable to unwrap signing seed with candidate passwords")
}

// XML structures for S3 ListAllMyBucketsResult.
type listAllMyBucketsResult struct {
	XMLName xml.Name   `xml:"ListAllMyBucketsResult"`
	Buckets bucketList `xml:"Buckets"`
}

type bucketList struct {
	Buckets []bucketEntry `xml:"Bucket"`
}

type bucketEntry struct {
	Name string `xml:"Name"`
}

func s3HmacSHA256(key, data []byte) []byte {
	h := hmac.New(sha256.New, key)
	h.Write(data)
	return h.Sum(nil)
}

func s3HashSHA256(data []byte) string {
	h := sha256.Sum256(data)
	return hex.EncodeToString(h[:])
}

// listMinIOBuckets calls MinIO using AWS SigV4 to list all buckets.
func listMinIOBuckets(ctx context.Context, endpointURL, accessKey, secretKey string) ([]string, error) {
	if !strings.HasPrefix(endpointURL, "http://") && !strings.HasPrefix(endpointURL, "https://") {
		endpointURL = "http://" + endpointURL
	}
	if !strings.HasSuffix(endpointURL, "/") {
		endpointURL += "/"
	}

	req, err := http.NewRequestWithContext(ctx, "GET", endpointURL, nil)
	if err != nil {
		return nil, err
	}

	now := time.Now().UTC()
	amzDate := now.Format("20060102T150405Z")
	dateStamp := now.Format("20060102")

	host := req.URL.Host
	payloadHash := s3HashSHA256([]byte(""))
	req.Header.Set("x-amz-date", amzDate)
	req.Header.Set("x-amz-content-sha256", payloadHash)
	req.Header.Set("Host", host)

	canonicalHeaders := fmt.Sprintf("host:%s\nx-amz-content-sha256:%s\nx-amz-date:%s\n", host, payloadHash, amzDate)
	signedHeaders := "host;x-amz-content-sha256;x-amz-date"
	canonicalRequest := fmt.Sprintf("GET\n/\n\n%s\n%s\n%s", canonicalHeaders, signedHeaders, payloadHash)

	credentialScope := fmt.Sprintf("%s/us-east-1/s3/aws4_request", dateStamp)
	stringToSign := fmt.Sprintf("AWS4-HMAC-SHA256\n%s\n%s\n%s", amzDate, credentialScope, s3HashSHA256([]byte(canonicalRequest)))

	kDate := s3HmacSHA256([]byte("AWS4"+secretKey), []byte(dateStamp))
	kRegion := s3HmacSHA256(kDate, []byte("us-east-1"))
	kService := s3HmacSHA256(kRegion, []byte("s3"))
	kSigning := s3HmacSHA256(kService, []byte("aws4_request"))

	signature := hex.EncodeToString(s3HmacSHA256(kSigning, []byte(stringToSign)))
	authHeader := fmt.Sprintf("AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		accessKey, credentialScope, signedHeaders, signature)
	req.Header.Set("Authorization", authHeader)

	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("minio list buckets returned HTTP %d: %s", resp.StatusCode, string(body))
	}

	var res listAllMyBucketsResult
	if err := xml.NewDecoder(resp.Body).Decode(&res); err != nil {
		return nil, fmt.Errorf("failed to parse xml: %w", err)
	}

	var names []string
	for _, b := range res.Buckets.Buckets {
		names = append(names, b.Name)
	}
	return names, nil
}

// CheckTestPollution inspects MinIO and PostgreSQL for test pollution and returns any warning messages.
func CheckTestPollution(ctx context.Context, dsn, minioAddr, minioUser, minioPass string) []string {
	var warnings []string

	// 1. MinIO Bucket check
	// "More than one bucket exists in MinIO and one of them is not byos-mailbox."
	if minioAddr != "" {
		if minioUser == "" {
			minioUser = "byosminio"
		}
		if minioPass == "" {
			minioPass = "byosminio_dev_password"
		}
		buckets, err := listMinIOBuckets(ctx, minioAddr, minioUser, minioPass)
		if err == nil {
			if len(buckets) > 1 {
				hasOther := false
				for _, b := range buckets {
					if b != "byos-mailbox" {
						hasOther = true
						break
					}
				}
				if hasOther {
					warn := fmt.Sprintf("[STARTUP-WARN] test pollution detected: stray MinIO bucket(s) found (%s). Run `make clean-test-data`.", strings.Join(buckets, ", "))
					warnings = append(warnings, warn)
				}
			}
		} else {
			log.Printf("startup pollution check: minio probe skipped (%v)", err)
		}
	}

	// 2. Database checks
	if dsn != "" {
		conn, err := pgx.Connect(ctx, dsn)
		if err == nil {
			defer conn.Close(ctx)

			// 2a. Scheduled messages check:
			// "Any scheduled_messages row is in status = 'pending' and send_at < now() - interval '24 hours'."
			var staleScheduledCount int64
			err := conn.QueryRow(ctx, `
				SELECT COUNT(*) FROM scheduled_messages
				WHERE status = 'pending' AND COALESCE(send_at, scheduled_at) < now() - interval '24 hours'
			`).Scan(&staleScheduledCount)
			if err == nil && staleScheduledCount > 0 {
				warn := fmt.Sprintf("[STARTUP-WARN] test pollution detected: %d orphan pending scheduled message(s) older than 24 hours. Run `make clean-test-data`.", staleScheduledCount)
				warnings = append(warnings, warn)
			}

			// 2b. Mailbox key mismatch check:
			// "Any mailboxes row has mailbox_ed25519_pk that does not match the pubkey the client would derive from the wrapped seed for that mailbox."
			if os.Getenv("BYOS_DEV_MODE") == "1" {
				rows, err := conn.Query(ctx, `
					SELECT id::text, local_part, COALESCE(wrapped_sk_user, ''), mailbox_ed25519_pk
					FROM mailboxes
					WHERE wrapped_sk_user IS NOT NULL AND wrapped_sk_user != '' AND mailbox_ed25519_pk IS NOT NULL
				`)
				if err == nil {
					defer rows.Close()
					for rows.Next() {
						var id, localPart, wrappedSkUser string
						var storedPK []byte
						if err := rows.Scan(&id, &localPart, &wrappedSkUser, &storedPK); err != nil {
							continue
						}
						derivedPK, err := DeriveEd25519PubkeyFromWrappedSeed(wrappedSkUser)
						if err == nil && len(derivedPK) == 32 {
							if !bytes.Equal(derivedPK, storedPK) {
								warn := fmt.Sprintf("[STARTUP-WARN] test pollution detected: mailbox %s (%s) Ed25519 public key does not match derived key from wrapped seed. Run `make clean-test-data`.", localPart, id)
								warnings = append(warnings, warn)
							}
						}
					}
				}
			} else {
				log.Println("[STARTUP] key-mismatch check skipped (BYOS_DEV_MODE not set)")
			}
		} else {
			log.Printf("startup pollution check: postgres probe skipped (%v)", err)
		}
	}

	return warnings
}

// RunStartupPollutionCheck executes CheckTestPollution using environment variables and logs warnings.
func RunStartupPollutionCheck() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	minioAddr := os.Getenv("MINIO_ADDR")
	if minioAddr == "" {
		minioAddr = "127.0.0.1:9000"
	}
	minioUser := os.Getenv("MINIO_ROOT_USER")
	if minioUser == "" {
		minioUser = "byosminio"
	}
	minioPass := os.Getenv("MINIO_ROOT_PASSWORD")
	if minioPass == "" {
		minioPass = "byosminio_dev_password"
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	warnings := CheckTestPollution(ctx, dsn, minioAddr, minioUser, minioPass)
	for _, w := range warnings {
		log.Println(w)
	}
}
