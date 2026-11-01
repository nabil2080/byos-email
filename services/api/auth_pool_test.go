package main

import (
	"context"
	"os"
	"sync"
	"testing"
	"time"
)

func TestAuthDBPool_LifecycleAndConfig(t *testing.T) {
	// Ensure clean starting state
	CloseAuthDBPool()
	defer CloseAuthDBPool()

	// 1. Test configuration parsing with DB_POOL_MIN_CONNS and DB_POOL_MAX_CONNS
	os.Setenv("DB_POOL_MIN_CONNS", "4")
	os.Setenv("DB_POOL_MAX_CONNS", "18")
	defer os.Unsetenv("DB_POOL_MIN_CONNS")
	defer os.Unsetenv("DB_POOL_MAX_CONNS")

	testDSN := "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	if override := os.Getenv("TEST_DATABASE_URL"); override != "" {
		testDSN = override
	}
	os.Setenv("DATABASE_URL", testDSN)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	pool1, err := InitAuthDBPool(ctx)
	if err != nil {
		t.Skipf("skipping live pool test; db not reachable: %v", err)
	}

	if pool1 == nil {
		t.Fatal("expected non-nil pool from InitAuthDBPool")
	}

	// Verify pool configuration options
	stat := pool1.Stat()
	if pool1.Config().MinConns != 4 {
		t.Errorf("expected MinConns = 4, got %d", pool1.Config().MinConns)
	}
	if pool1.Config().MaxConns != 18 {
		t.Errorf("expected MaxConns = 18, got %d", pool1.Config().MaxConns)
	}
	if stat.MaxConns() != 18 {
		t.Errorf("expected stat MaxConns = 18, got %d", stat.MaxConns())
	}

	// 2. Test singleton behavior: repeated InitAuthDBPool returns identical pool instance
	pool2, err := InitAuthDBPool(ctx)
	if err != nil {
		t.Fatalf("unexpected error on repeated init: %v", err)
	}
	if pool1 != pool2 {
		t.Errorf("expected singleton pool pointer equality, got %p != %p", pool1, pool2)
	}

	// 3. Test concurrent pool acquisition
	var wg sync.WaitGroup
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			p, err := InitAuthDBPool(context.Background())
			if err != nil || p != pool1 {
				t.Errorf("concurrent InitAuthDBPool returned mismatch: %v", err)
			}
		}()
	}
	wg.Wait()

	// 4. Test graceful CloseAuthDBPool
	CloseAuthDBPool()
	if authDBPool != nil {
		t.Error("expected authDBPool to be nil after CloseAuthDBPool")
	}

	// 5. Test clean re-initialization after close
	os.Setenv("DB_POOL_MIN_CONNS", "2")
	os.Setenv("DB_POOL_MAX_CONNS", "10")
	pool3, err := InitAuthDBPool(ctx)
	if err != nil {
		t.Fatalf("failed to reinitialize pool after close: %v", err)
	}
	if pool3 == nil {
		t.Fatal("expected non-nil pool after re-initialization")
	}
	if pool3.Config().MaxConns != 10 {
		t.Errorf("expected new MaxConns = 10, got %d", pool3.Config().MaxConns)
	}
}

func TestAuthDBPool_InvalidDSN(t *testing.T) {
	CloseAuthDBPool()
	defer CloseAuthDBPool()

	os.Setenv("DATABASE_URL", "invalid://bad dsn format with spaces")
	defer os.Unsetenv("DATABASE_URL")

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	pool, err := InitAuthDBPool(ctx)
	if err == nil {
		t.Error("expected error for invalid DSN, got nil")
	}
	if pool != nil {
		t.Errorf("expected nil pool for invalid DSN, got %v", pool)
	}
}

func TestAuthDBPool_ConnectionFailureToUnreachableHost(t *testing.T) {
	CloseAuthDBPool()
	defer CloseAuthDBPool()

	os.Setenv("DATABASE_URL", "postgres://byos:wrong@127.0.0.1:1/byos?sslmode=disable&connect_timeout=1")
	defer os.Unsetenv("DATABASE_URL")

	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
	defer cancel()

	pool, err := InitAuthDBPool(ctx)
	if err != nil {
		// Parsing or initial dial failed immediately, which is acceptable
		return
	}
	if pool == nil {
		t.Fatal("expected non-nil pool handle before acquire")
	}

	// Attempting to Ping against unreachable port 1 must fail
	pingErr := pool.Ping(ctx)
	if pingErr == nil {
		t.Error("expected ping failure to unreachable host 127.0.0.1:1, got nil")
	}
}

