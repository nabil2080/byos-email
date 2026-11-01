package main

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

func TestSupportTicket_RateLimiter_FailClosedOnRedisError(t *testing.T) {
	oldRedis := redisClient
	defer func() { redisClient = oldRedis }()

	// Point redis client to a non-existent port to simulate network failure/outage
	badRedis := redis.NewClient(&redis.Options{
		Addr:        "127.0.0.1:1",
		DialTimeout: 50 * time.Millisecond,
		ReadTimeout: 50 * time.Millisecond,
	})
	defer badRedis.Close()
	redisClient = badRedis

	testUserUUID := uuid.New()
	body := bytes.NewBufferString(`{"subject":"Test ticket outage","message":"Help with issue"}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/support/tickets", body)
	req.Header.Set("Content-Type", "application/json")

	rec := httptest.NewRecorder()
	handleCustomerCreateTicket(rec, req, nil, testUserUUID)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 Service Unavailable on Redis outage, got %d: %s", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("Retry-After") != "60" {
		t.Errorf("expected Retry-After 60, got %q", rec.Header().Get("Retry-After"))
	}
	if !bytes.Contains(rec.Body.Bytes(), []byte("rate limiter unavailable")) {
		t.Errorf("expected fail-closed error message, got %s", rec.Body.String())
	}
}

func TestSupportTicket_RateLimiter_ProductionFailClosedWhenNil(t *testing.T) {
	oldRedis := redisClient
	oldEnv := os.Getenv("BYOS_ENV")
	defer func() {
		redisClient = oldRedis
		os.Setenv("BYOS_ENV", oldEnv)
	}()

	redisClient = nil
	os.Setenv("BYOS_ENV", "production")

	testUserUUID := uuid.New()
	body := bytes.NewBufferString(`{"subject":"Prod ticket test","message":"Testing nil redis in prod"}`)
	req := httptest.NewRequest(http.MethodPost, "/v1/support/tickets", body)
	req.Header.Set("Content-Type", "application/json")

	rec := httptest.NewRecorder()
	handleCustomerCreateTicket(rec, req, nil, testUserUUID)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 on nil Redis in production, got %d: %s", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("Retry-After") != "60" {
		t.Errorf("expected Retry-After 60, got %q", rec.Header().Get("Retry-After"))
	}
}

func TestSupportTicket_RateLimiter_ThresholdAndScopeIsolation(t *testing.T) {
	if redisClient == nil {
		redisClient = redis.NewClient(&redis.Options{Addr: "127.0.0.1:6379"})
	}

	ctx := context.Background()
	if err := redisClient.Ping(ctx).Err(); err != nil {
		t.Skipf("skipping live redis test; redis not reachable: %v", err)
	}

	userA := uuid.New()
	userB := uuid.New()
	keyA := fmt.Sprintf("rate:support:ticket:create:%s", userA.String())
	keyB := fmt.Sprintf("rate:support:ticket:create:%s", userB.String())

	defer func() {
		redisClient.Del(ctx, keyA, keyB)
	}()

	// Simulate 5 allowed creations for userA directly in Redis
	for i := 1; i <= 5; i++ {
		cnt, err := redisClient.Incr(ctx, keyA).Result()
		if err != nil {
			t.Fatalf("redis Incr failed: %v", err)
		}
		if cnt != int64(i) {
			t.Fatalf("expected count %d, got %d", i, cnt)
		}
	}

	// 6th attempt by userA must trigger rate limit (429 Too Many Requests)
	body := bytes.NewBufferString(`{"subject":"Excess ticket","message":"Should be rate limited"}`)
	reqA := httptest.NewRequest(http.MethodPost, "/v1/support/tickets", body)
	reqA.Header.Set("Content-Type", "application/json")
	recA := httptest.NewRecorder()
	handleCustomerCreateTicket(recA, reqA, nil, userA)

	if recA.Code != http.StatusTooManyRequests {
		t.Fatalf("expected 429 Too Many Requests for 6th attempt, got %d: %s", recA.Code, recA.Body.String())
	}
	if recA.Header().Get("Retry-After") != "600" {
		t.Errorf("expected Retry-After 600, got %q", recA.Header().Get("Retry-After"))
	}

	// User B must NOT be blocked (scope isolation)
	cntB, err := redisClient.Get(ctx, keyB).Int()
	if err != nil && err != redis.Nil {
		t.Fatalf("redis error checking userB key: %v", err)
	}
	if cntB > 0 {
		t.Fatalf("expected initial userB count 0, got %d", cntB)
	}
}

func TestSupportTicket_RateLimiter_RecoveryAfterRedisRestored(t *testing.T) {
	oldRedis := redisClient
	defer func() { redisClient = oldRedis }()

	// 1. Simulate outage: point to bad port -> fail closed (503)
	badRedis := redis.NewClient(&redis.Options{
		Addr:        "127.0.0.1:1",
		DialTimeout: 50 * time.Millisecond,
		ReadTimeout: 50 * time.Millisecond,
	})
	redisClient = badRedis

	user := uuid.New()
	body := bytes.NewBufferString(`{"subject":"Outage test","message":"Testing fail closed"}`)
	req1 := httptest.NewRequest(http.MethodPost, "/v1/support/tickets", body)
	rec1 := httptest.NewRecorder()
	handleCustomerCreateTicket(rec1, req1, nil, user)

	if rec1.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 during outage, got %d", rec1.Code)
	}

	badRedis.Close()

	// 2. Simulate recovery: restore live working Redis client -> recovers immediately
	workingRedis := redis.NewClient(&redis.Options{Addr: "127.0.0.1:6379"})
	ctx := context.Background()
	if err := workingRedis.Ping(ctx).Err(); err != nil {
		t.Skipf("skipping live redis recovery test: %v", err)
	}
	redisClient = workingRedis

	key := fmt.Sprintf("rate:support:ticket:create:%s", user.String())
	defer workingRedis.Del(ctx, key)

	bodyRecovered := bytes.NewBufferString(`{"subject":"Post recovery","message":"Testing recovery"}`)
	req2 := httptest.NewRequest(http.MethodPost, "/v1/support/tickets", bodyRecovered)
	rec2 := httptest.NewRecorder()
	handleCustomerCreateTicket(rec2, req2, nil, user)

	// Since redis is restored and db is nil in unit test, it passes rate limit and reaches DB handling (or 500 DB error, NOT 503 rate limiter error)
	if rec2.Code == http.StatusServiceUnavailable {
		t.Fatalf("expected rate limiter to recover, but still got 503: %s", rec2.Body.String())
	}
}

func TestSupportTicket_RateLimiter_ConcurrentRequests(t *testing.T) {
	if redisClient == nil {
		redisClient = redis.NewClient(&redis.Options{Addr: "127.0.0.1:6379"})
	}

	ctx := context.Background()
	if err := redisClient.Ping(ctx).Err(); err != nil {
		t.Skipf("skipping live redis concurrent test; redis not reachable: %v", err)
	}

	user := uuid.New()
	key := fmt.Sprintf("rate:support:ticket:create:%s", user.String())
	defer redisClient.Del(ctx, key)

	// Fire 10 concurrent ticket submissions for the exact same user
	const totalRequests = 10
	results := make(chan int, totalRequests)

	for i := 0; i < totalRequests; i++ {
		go func(idx int) {
			b := bytes.NewBufferString(fmt.Sprintf(`{"subject":"Concurrent %d","message":"Race condition test"}`, idx))
			req := httptest.NewRequest(http.MethodPost, "/v1/support/tickets", b)
			rec := httptest.NewRecorder()
			handleCustomerCreateTicket(rec, req, nil, user)
			results <- rec.Code
		}(i)
	}

	var allowedCount, rateLimitedCount int
	for i := 0; i < totalRequests; i++ {
		code := <-results
		if code == http.StatusTooManyRequests {
			rateLimitedCount++
		} else {
			allowedCount++
		}
	}

	if allowedCount != 5 {
		t.Errorf("expected exactly 5 requests allowed, got %d", allowedCount)
	}
	if rateLimitedCount != 5 {
		t.Errorf("expected exactly 5 requests rate-limited (HTTP 429), got %d", rateLimitedCount)
	}

	// Verify the final counter in Redis is 10
	val, err := redisClient.Get(ctx, key).Int()
	if err != nil {
		t.Fatalf("failed to query redis counter: %v", err)
	}
	if val != totalRequests {
		t.Errorf("expected Redis counter = %d, got %d", totalRequests, val)
	}
}

