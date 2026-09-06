package main

// Evidence:
// - Route table: GET /health (wrapped in withCORS).
// - api.exe symbol table: main.healthHandler, main.checkPostgres,
//   main.checkRedis, main.checkMinIO, main.checkSMTP, main.checkRspamd.
// - main.go types: HealthStatus{status, services, timestamp}, ServiceHealth.
// - docs/06-v1-vertical-slice.md Stage 1: "API service can report dependency
//   readiness" — services PostgreSQL, Redis, MinIO, Postfix, Rspamd.
// Reconstruction judgment (flagged): exact per-service check mechanics and
// status strings follow the standard dependency-readiness pattern; the
// dependency SET is evidence-backed.

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
)

func checkPostgres() ServiceHealth {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		return ServiceHealth{Name: "postgres", Status: "down", Error: err.Error()}
	}
	defer conn.Close(ctx)
	if err := conn.Ping(ctx); err != nil {
		return ServiceHealth{Name: "postgres", Status: "down", Error: err.Error()}
	}
	return ServiceHealth{Name: "postgres", Status: "up"}
}

func checkRedis() ServiceHealth {
	if redisClient == nil {
		return ServiceHealth{Name: "redis", Status: "down", Error: "not initialized"}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := redisClient.Ping(ctx).Err(); err != nil {
		return ServiceHealth{Name: "redis", Status: "down", Error: err.Error()}
	}
	return ServiceHealth{Name: "redis", Status: "up"}
}

func checkMinIO() ServiceHealth {
	addr := os.Getenv("MINIO_ADDR")
	if addr == "" {
		addr = "minio:9000"
	}
	client := &http.Client{Timeout: 2 * time.Second}
	resp, err := client.Get(fmt.Sprintf("http://%s/minio/health/live", addr))
	if err != nil {
		return ServiceHealth{Name: "minio", Status: "down", Error: err.Error()}
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return ServiceHealth{Name: "minio", Status: "down", Error: fmt.Sprintf("status %d", resp.StatusCode)}
	}
	return ServiceHealth{Name: "minio", Status: "up"}
}

func checkSMTP() ServiceHealth {
	addr := os.Getenv("POSTFIX_ADDR")
	if addr == "" {
		addr = "postfix:25"
	}
	conn, err := net.DialTimeout("tcp", addr, 2*time.Second)
	if err != nil {
		return ServiceHealth{Name: "postfix", Status: "down", Error: err.Error()}
	}
	conn.Close()
	return ServiceHealth{Name: "postfix", Status: "up"}
}

func checkRspamd() ServiceHealth {
	addr := os.Getenv("RSPAMD_ADDR")
	if addr == "" {
		addr = "rspamd:11334"
	}
	conn, err := net.DialTimeout("tcp", addr, 2*time.Second)
	if err != nil {
		return ServiceHealth{Name: "rspamd", Status: "down", Error: err.Error()}
	}
	conn.Close()
	return ServiceHealth{Name: "rspamd", Status: "up"}
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	checks := []ServiceHealth{
		checkPostgres(),
		checkRedis(),
		checkMinIO(),
		checkSMTP(),
		checkRspamd(),
	}
	services := make(map[string]string, len(checks))
	overall := "ok"
	for _, c := range checks {
		services[c.Name] = c.Status
		if c.Status != "up" {
			overall = "degraded"
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(HealthStatus{
		Status:    overall,
		Services:  services,
		Timestamp: time.Now(),
	})
}

var startTime = time.Now()

func metricsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	uptime := time.Since(startTime).Seconds()
	checks := []ServiceHealth{
		checkPostgres(),
		checkRedis(),
		checkMinIO(),
		checkSMTP(),
		checkRspamd(),
	}

	w.Header().Set("Content-Type", "text/plain; version=0.0.4")
	fmt.Fprintf(w, "# HELP byos_uptime_seconds System uptime in seconds.\n")
	fmt.Fprintf(w, "# TYPE byos_uptime_seconds counter\n")
	fmt.Fprintf(w, "byos_uptime_seconds %.2f\n\n", uptime)

	fmt.Fprintf(w, "# HELP byos_service_up Dependency service health status (1 = up, 0 = down).\n")
	fmt.Fprintf(w, "# TYPE byos_service_up gauge\n")
	for _, c := range checks {
		val := 0
		if c.Status == "up" {
			val = 1
		}
		fmt.Fprintf(w, "byos_service_up{service=\"%s\"} %d\n", c.Name, val)
	}
}

