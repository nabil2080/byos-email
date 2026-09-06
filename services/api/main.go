package main

// Evidence: surviving route table (pre-corruption main.go HandleFunc block),
// ROADMAP_STATUS.md (route inventory across Step 3-8 slices), api.exe symbol
// table (main.main + handler symbols), frontend API clients
// (apps/control-plane/src/lib/api/*.ts). Rate-limit infra preserved verbatim
// from quarantined main.go.corrupt-backup (SHA-256 recorded in report).

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"
)

var (
	rateMu      sync.Mutex
	rateBuckets = make(map[string]*rateBucket)
	redisClient *redis.Client
	rateCache   = &rateLimitCache{limits: make(map[string]map[string]map[string]int)}
)

func hexDecodeString(s string) ([]byte, error) {
	if len(s)%2 != 0 {
		return nil, fmt.Errorf("odd hex length")
	}
	out := make([]byte, 0, len(s)/2)
	for i := 0; i < len(s); i += 2 {
		var high, low byte
		if s[i] >= '0' && s[i] <= '9' {
			high = s[i] - '0'
		} else if s[i] >= 'a' && s[i] <= 'f' {
			high = s[i] - 'a' + 10
		} else if s[i] >= 'A' && s[i] <= 'F' {
			high = s[i] - 'A' + 10
		} else {
			return nil, fmt.Errorf("invalid hex character at %d", i)
		}
		if s[i+1] >= '0' && s[i+1] <= '9' {
			low = s[i+1] - '0'
		} else if s[i+1] >= 'a' && s[i+1] <= 'f' {
			low = s[i+1] - 'a' + 10
		} else if s[i+1] >= 'A' && s[i+1] <= 'F' {
			low = s[i+1] - 'A' + 10
		} else {
			return nil, fmt.Errorf("invalid hex character at %d+1", i)
		}
		out = append(out, high<<4|low)
	}
	return out, nil
}

var rateLuaScript = `
local n = #KEYS
local half = n
-- ARGV[1..half] = limits, ARGV[half+1..n*2] = ttls
for i=1, half do
  local cur = redis.call('GET', KEYS[i])
  if cur then
    if tonumber(cur) >= tonumber(ARGV[i]) then
      return {0, i}
    end
  end
end
local res = {1}
for i=1, half do
  local ttl = tonumber(ARGV[half+i])
  local newval = redis.call('INCR', KEYS[i])
  if newval == 1 then
    redis.call('EXPIRE', KEYS[i], ttl)
  end
  res[i+1] = newval
end
return res
`

type rateLimitCache struct {
	mu     sync.RWMutex
	limits map[string]map[string]map[string]int // plan -> scope -> window -> value
}

func (c *rateLimitCache) get(plan, scope, window string) int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if m1, ok := c.limits[plan]; ok {
		if m2, ok := m1[scope]; ok {
			if v, ok := m2[window]; ok {
				return v
			}
		}
	}
	// fallback to solo
	if m1, ok := c.limits["solo"]; ok {
		if m2, ok := m1[scope]; ok {
			if v, ok := m2[window]; ok {
				return v
			}
		}
	}
	// hard defaults
	defaults := map[string]int{"minute": 5, "hour": 50, "day": 200, "recipients": 100}
	if v, ok := defaults[window]; ok {
		return v
	}
	return 100
}

func initRedis() {
	addr := os.Getenv("REDIS_ADDR")
	if addr == "" {
		addr = os.Getenv("REDIS_URL")
	}
	if addr == "" {
		addr = "redis:6379"
	}
	// support redis:// prefix
	if len(addr) > 8 && addr[:8] == "redis://" {
		addr = addr[8:]
	}
	redisClient = redis.NewClient(&redis.Options{Addr: addr})
}

func loadRateLimits() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://byos:byos_dev_password@localhost:5432/byos?sslmode=disable"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		log.Printf("rate cache load: db connect fail: %v", err)
		return
	}
	defer conn.Close(ctx)
	rows, err := conn.Query(ctx, `SELECT plan_name, scope, time_window, limit_value FROM rate_limits`)
	if err != nil {
		log.Printf("rate cache load: query fail: %v", err)
		return
	}
	defer rows.Close()
	tmp := make(map[string]map[string]map[string]int)
	for rows.Next() {
		var plan, scope, window string
		var val int
		if err := rows.Scan(&plan, &scope, &window, &val); err != nil {
			continue
		}
		if tmp[plan] == nil {
			tmp[plan] = make(map[string]map[string]int)
		}
		if tmp[plan][scope] == nil {
			tmp[plan][scope] = make(map[string]int)
		}
		tmp[plan][scope][window] = val
	}
	if len(tmp) > 0 {
		rateCache.mu.Lock()
		rateCache.limits = tmp
		rateCache.mu.Unlock()
		log.Printf("rate cache loaded %d plans", len(tmp))
	}
}

func startRateCacheRefresh() {
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		for range ticker.C {
			loadRateLimits()
		}
	}()
}

func checkAndIncrRate(ctx context.Context, mailboxID, orgID, mailboxPlan, orgPlan string) (bool, int, string) {
	if redisClient == nil {
		return true, 0, ""
	}
	now := time.Now().Unix()
	minuteWindow := now / 60
	hourWindow := now / 3600
	dayWindow := now / 86400
	keys := []string{
		fmt.Sprintf("rate:mailbox:%s:minute:%d", mailboxID, minuteWindow),
		fmt.Sprintf("rate:mailbox:%s:hour:%d", mailboxID, hourWindow),
		fmt.Sprintf("rate:mailbox:%s:day:%d", mailboxID, dayWindow),
		fmt.Sprintf("rate:org:%s:minute:%d", orgID, minuteWindow),
		fmt.Sprintf("rate:org:%s:hour:%d", orgID, hourWindow),
		fmt.Sprintf("rate:org:%s:day:%d", orgID, dayWindow),
	}
	limits := []interface{}{
		rateCache.get(mailboxPlan, "mailbox", "minute"),
		rateCache.get(mailboxPlan, "mailbox", "hour"),
		rateCache.get(mailboxPlan, "mailbox", "day"),
		rateCache.get(orgPlan, "org", "minute"),
		rateCache.get(orgPlan, "org", "hour"),
		rateCache.get(orgPlan, "org", "day"),
	}
	ttls := []interface{}{70, 3610, 86410, 70, 3610, 86410}
	args := append(limits, ttls...)
	// Use Eval
	res, err := redisClient.Eval(ctx, rateLuaScript, keys, args...).Result()
	if err != nil {
		log.Printf("rate check redis error (fail open): %v", err)
		return true, 0, ""
	}
	arr, ok := res.([]interface{})
	if !ok || len(arr) == 0 {
		log.Printf("rate lua unexpected result %v", res)
		return true, 0, ""
	}
	code, _ := arr[0].(int64)
	if code == 1 {
		return true, 0, ""
	}
	// failed at index
	idx, _ := arr[1].(int64)
	windowNames := []string{"mailbox:minute", "mailbox:hour", "mailbox:day", "org:minute", "org:hour", "org:day"}
	failed := ""
	if idx >= 1 && idx <= int64(len(windowNames)) {
		failed = windowNames[idx-1]
	}
	// compute retry_after as min reset
	var retry int
	if failed == "mailbox:minute" || failed == "org:minute" {
		retry = int(60 - (now % 60) + 1)
	} else if failed == "mailbox:hour" || failed == "org:hour" {
		retry = int(3600 - (now % 3600) + 1)
	} else {
		retry = int(86400 - (now % 86400) + 1)
	}
	if retry < 1 {
		retry = 60
	}
	log.Printf("rate limit exceeded mailbox %s org %s window %s", mailboxID, orgID, failed)
	return false, retry, failed
}

type rateBucket struct {
	count       int
	windowStart time.Time
}

func allowPerUser(userID string) bool {
	rateMu.Lock()
	defer rateMu.Unlock()
	now := time.Now()
	// cleanup old buckets (>5m idle) to prevent unbounded growth
	for k, v := range rateBuckets {
		if now.Sub(v.windowStart) > 5*time.Minute {
			delete(rateBuckets, k)
		}
	}
	b, ok := rateBuckets[userID]
	if !ok {
		rateBuckets[userID] = &rateBucket{count: 1, windowStart: now}
		return true
	}
	if now.Sub(b.windowStart) >= time.Minute {
		b.windowStart = now
		b.count = 1
		return true
	}
	if b.count >= 60 {
		return false
	}
	b.count++
	return true
}

type HealthStatus struct {
	Status    string            `json:"status"`
	Services  map[string]string `json:"services"`
	Timestamp time.Time         `json:"timestamp"`
}

type ServiceHealth struct {
	Name   string
	Status string
	Error  string
}

func main() {
	port := os.Getenv("API_PORT")
	if port == "" {
		port = "8080"
	}
	initRedis()
	loadRateLimits()
	startRateCacheRefresh()
	startStorageHealthMonitor()

	http.HandleFunc("/health", withSecurityHeaders(withCORS(healthHandler)))
	http.HandleFunc("/metrics", withSecurityHeaders(metricsHandler))
	http.HandleFunc("/", withSecurityHeaders(rootHandler))
	http.HandleFunc("/v1/auth/register", withSecurityHeaders(withCORS(registerHandler)))
	http.HandleFunc("/v1/auth/login", withSecurityHeaders(withCORS(loginHandler)))
	http.HandleFunc("/v1/auth/recovery-enroll", withSecurityHeaders(withCORS(recoveryEnrollHandler)))
	http.HandleFunc("/v1/auth/recovery-challenge", withSecurityHeaders(withCORS(recoveryChallengeHandler)))
	http.HandleFunc("/v1/auth/me", withSecurityHeaders(withCORS(meHandler)))
	http.HandleFunc("/v1/auth/logout", withSecurityHeaders(withCORS(logoutHandler)))
	http.HandleFunc("/v1/auth/device-enroll", withSecurityHeaders(withCORS(deviceEnrollHandler)))
	http.HandleFunc("/v1/auth/device-revoke", withSecurityHeaders(withCORS(deviceRevokeHandler)))
	http.HandleFunc("/v1/auth/organization-members", withSecurityHeaders(withCORS(organizationMembersHandler)))
	http.HandleFunc("/v1/auth/change-member-role", withSecurityHeaders(withCORS(changeMemberRoleHandler)))
	http.HandleFunc("/v1/auth/terminate-user", withSecurityHeaders(withCORS(terminateUserHandler)))
	http.HandleFunc("/v1/outbound/pubkey", withSecurityHeaders(withCORS(outboundPubkeyHandler)))
	http.HandleFunc("/v1/outbound/prepare", withSecurityHeaders(withCORS(outboundPrepareHandler)))
	http.HandleFunc("/v1/outbound/send", withSecurityHeaders(withCORS(outboundSendHandler)))
	http.HandleFunc("/v1/outbound/schedule", withSecurityHeaders(withCORS(outboundScheduleHandler)))
	http.HandleFunc("/v1/outbound/scheduled/cancel", withSecurityHeaders(withCORS(outboundScheduledCancelHandler)))
	http.HandleFunc("/v1/bridge/authenticate", withSecurityHeaders(withCORS(bridgeAuthenticateHandler)))

	http.HandleFunc("/v1/organizations/{org_id}/storage/connection", withSecurityHeaders(withCORS(storageConnectionHandler)))
	http.HandleFunc("/v1/organizations/{org_id}/storage/connection/test", withSecurityHeaders(withCORS(storageConnectionTestHandler)))
	http.HandleFunc("/v1/organizations/{org_id}/storage/google-drive/authorize", withSecurityHeaders(withCORS(googleDriveAuthorizeHandler)))
	http.HandleFunc("/v1/storage/google-drive/callback", withSecurityHeaders(withCORS(googleDriveCallbackHandler)))
	http.HandleFunc("/v1/organizations/{org_id}/storage/migration/preflight", withSecurityHeaders(withCORS(storageMigrationPreflightHandler)))
	http.HandleFunc("/v1/organizations/{org_id}/storage/migration/copy", withSecurityHeaders(withCORS(storageMigrationCopyHandler)))
	http.HandleFunc("/v1/organizations/{org_id}/storage/migration/{migration_id}/retry", withSecurityHeaders(withCORS(storageMigrationRetryHandler)))
	http.HandleFunc("/v1/organizations/{org_id}/storage/migration/{migration_id}", withSecurityHeaders(withCORS(storageMigrationStatusHandler)))
	http.HandleFunc("/v1/organizations/{org_id}/storage/migration/{migration_id}/cutover", withSecurityHeaders(withCORS(storageMigrationCutoverHandler)))
	http.HandleFunc("/v1/organizations/{org_id}/domains", withSecurityHeaders(withCORS(domainsHandler)))
	http.HandleFunc("/v1/organizations/{org_id}/domains/{domain_id}/verify", withSecurityHeaders(withCORS(domainVerifyHandler)))
	http.HandleFunc("/v1/organizations/{org_id}", withSecurityHeaders(withCORS(organizationGetHandler)))
	http.HandleFunc("/v1/organizations/{org_id}/mailboxes", withSecurityHeaders(withCORS(mailboxesHandler)))
	http.HandleFunc("/v1/mailboxes/{mailbox_id}", withSecurityHeaders(withCORS(mailboxGetHandler)))
	http.HandleFunc("/v1/mailboxes/{mailbox_id}/messages", withSecurityHeaders(withCORS(messagesHandler)))
	http.HandleFunc("/v1/mailboxes/{mailbox_id}/aliases", withSecurityHeaders(withCORS(mailboxAliasesHandler)))
	http.HandleFunc("/v1/mailboxes/{mailbox_id}/drafts", withSecurityHeaders(withCORS(draftsHandler)))
	http.HandleFunc("/v1/mailboxes/{mailbox_id}/drafts/{draft_id}", withSecurityHeaders(withCORS(draftsHandler)))
	http.HandleFunc("/v1/mailboxes/{mailbox_id}/contacts", withSecurityHeaders(withCORS(contactsHandler)))
	http.HandleFunc("/v1/mailboxes/{mailbox_id}/contacts/{contact_id}", withSecurityHeaders(withCORS(contactsHandler)))
	http.HandleFunc("/v1/mailboxes/{mailbox_id}/search", withSecurityHeaders(withCORS(searchTokensHandler)))
	http.HandleFunc("/v1/mailboxes/{mailbox_id}/bridge/credentials", withSecurityHeaders(withCORS(bridgeCredentialsHandler)))
	http.HandleFunc("/v1/mailboxes/{mailbox_id}/bridge/credentials/{credential_id}", withSecurityHeaders(withCORS(bridgeCredentialsHandler)))
	http.HandleFunc("/v1/mailboxes/{mailbox_id}/attachments", withSecurityHeaders(withCORS(attachmentsHandler)))
	http.HandleFunc("/v1/mailboxes/{mailbox_id}/attachments/{attachment_id}", withSecurityHeaders(withCORS(attachmentsHandler)))
	http.HandleFunc("/v1/organizations/{org_id}/billing", withSecurityHeaders(withCORS(billingHandler)))
	http.HandleFunc("/v1/organizations/{org_id}/billing/plan", withSecurityHeaders(withCORS(billingHandler)))
	log.Printf("BYOS API service starting on port %s", port)
	log.Fatal(http.ListenAndServe(":"+port, nil))
}

func rootHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"service": "byos-api",
		"version": "0.1.0",
	})
}
