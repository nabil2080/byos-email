package main

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
)

type storageHealthResult struct {
	Code string `json:"code"`
}

// startStorageHealthMonitor periodically verifies active storage connections
// through the storage-worker's ciphertext-only test boundary.
func startStorageHealthMonitor() {
	interval := storageHealthInterval()
	if interval <= 0 {
		log.Printf("storage health monitor disabled")
		return
	}
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for range ticker.C {
			runStorageHealthCheck()
		}
	}()
	log.Printf("storage health monitor enabled (interval %s)", interval)
}

func storageHealthInterval() time.Duration {
	raw := os.Getenv("STORAGE_HEALTH_INTERVAL")
	if raw == "" {
		return 5 * time.Minute
	}
	seconds, err := strconv.Atoi(raw)
	if err != nil || seconds < 0 {
		log.Printf("invalid STORAGE_HEALTH_INTERVAL %q; using 5m", raw)
		return 5 * time.Minute
	}
	return time.Duration(seconds) * time.Second
}

func runStorageHealthCheck() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "******localhost:5432/byos?sslmode=disable"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		log.Printf("storage health monitor database connection failed: %v", err)
		return
	}
	defer conn.Close(ctx)

	rows, err := conn.Query(ctx, `
		SELECT id::text, provider, config->>'ciphertext'
		FROM storage_connections
		WHERE status IN ('active', 'error')
		ORDER BY updated_at ASC`)
	if err != nil {
		log.Printf("storage health monitor query failed: %v", err)
		return
	}
	type storageConnection struct {
		id, provider, ciphertext string
	}
	var connections []storageConnection
	for rows.Next() {
		var id, provider, ciphertext string
		if err := rows.Scan(&id, &provider, &ciphertext); err != nil {
			log.Printf("storage health monitor row failed: %v", err)
			continue
		}
		connections = append(connections, storageConnection{id: id, provider: provider, ciphertext: ciphertext})
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		log.Printf("storage health monitor rows failed: %v", err)
		return
	}

	for _, connection := range connections {
		id, provider, ciphertext := connection.id, connection.provider, connection.ciphertext
		code := testEncryptedStorage(provider, ciphertext)
		now := time.Now()
		if code == "verified" {
			_, err = conn.Exec(ctx, `
				UPDATE storage_connections
				SET status='active', last_checked=$1, error_message=NULL
				WHERE id=$2 AND status IN ('active', 'error')`, now, id)
		} else {
			_, err = conn.Exec(ctx, `
				UPDATE storage_connections
				SET status='error', last_checked=$1, error_message=$2
				WHERE id=$3 AND status IN ('active', 'error')`, now, code, id)
		}
		if err != nil {
			log.Printf("storage health monitor update failed for connection %s: %v", id, err)
		}
	}
}

func testEncryptedStorage(provider, ciphertext string) string {
	if provider == "" || ciphertext == "" {
		return "configuration_error"
	}
	body, err := json.Marshal(map[string]string{
		"provider":   provider,
		"ciphertext": ciphertext,
	})
	if err != nil {
		return "configuration_error"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, storageWorkerURL()+"/internal/test-encrypted", bytes.NewReader(body))
	if err != nil {
		return "provider_unavailable"
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		return "provider_unavailable"
	}
	defer resp.Body.Close()
	var result storageHealthResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil || result.Code == "" {
		return "provider_unavailable"
	}
	return result.Code
}
