# Track 3 Security & Feature Report

## What was built

Track 3 delivered three infrastructure-level features for the calendar subsystem of the BYOS zero-knowledge email platform:

1. **External Calendar Feed CORS Proxy** – a Go HTTP handler that safely fetches remote `.ics` feeds on behalf of the browser client, with full SSRF protection (private IP ranges, loopback, link-local, cloud-metadata), 5 MB size cap, and `webcal://` normalization. The TypeScript `urlCalendarStore.ts` client routes all feed fetches through `/v1/calendar/feed-proxy` first, falling back to a direct browser fetch only when the proxy is unavailable.

2. **Offline Recurring Event Exception Sync** – `OfflineActionType` was extended with `create_exception`, `update_exception`, and `delete_exception` variants. The existing `syncOfflineQueue` replay engine in `calendarOfflineSync.ts` now handles all three action types, passing exception payloads to the corresponding `createCalendarEventException` / `updateCalendarEventException` / `deleteCalendarEventException` API calls. `CalendarView.tsx` enqueues exception actions offline instead of throwing.

3. **Encrypted Calendar Trash & Task Storage** – `calendarTrashStore.ts` encrypts deleted event details with AES-GCM (WASM `byos_crypto_core`) and stores only ciphertext in `localStorage`; plaintext is redacted before write. `taskStore.ts` encrypts `title` and `description` with AES-GCM per task; raw plaintext is scrubbed from persisted JSON. Both stores fall back gracefully to plaintext when the mailbox key is unavailable.

---

## Files edited

| File | Reason |
|------|--------|
| `services/api/calendar_feed_proxy.go` | **New** – SSRF-safe CORS proxy handler for external `.ics` feeds |
| `services/api/calendar_feed_proxy_test.go` | **New** – Go unit tests: unauthorized, bad URL, 18-target SSRF table, size-limit logic, IP unit checks |
| `services/api/main.go` | Register `GET /v1/calendar/feed-proxy` route |
| `apps/webmail/src/components/calendar/url/urlCalendarStore.ts` | `fetchAndParseUrlFeed` routes through proxy with auth headers, falls back to direct fetch |
| `apps/webmail/src/components/calendar/offline/calendarOfflineSync.ts` | Added `create_exception`, `update_exception`, `delete_exception` to `OfflineActionType` and `syncOfflineQueue` |
| `apps/webmail/src/components/calendar/tasks/taskStore.ts` | AES-GCM encryption of task `title` and `description`; redacts plaintext from localStorage |
| `apps/webmail/src/components/calendar/tasks/taskTypes.ts` | Added `encryptedTitle` and `encryptedDescription` optional fields to `TaskItem` |
| `apps/webmail/src/components/calendar/trash/calendarTrashStore.ts` | AES-GCM encryption of deleted event details; plaintext redaction before localStorage write |
| `apps/webmail/src/components/calendar/trash/CalendarTrashModal.tsx` | Updated to pass mailbox key to `getTrashEvents` / `moveEventToTrash` |
| `apps/webmail/src/components/calendar/CalendarView.tsx` | Enqueues exception offline actions instead of throwing when network is unavailable |
| `apps/webmail/src/calendar_track3.test.ts` | **New** – 8 end-to-end tests covering proxy routing, exception queue/replay, encrypted trash, encrypted tasks, and legacy fallbacks |

---

## Raw evidence

### TypeScript typecheck (zero errors)

```
> typecheck
> tsc --noEmit

(exit code 0, no output)
```

### Full frontend test suite

```
OVERALL: 587 passed, 0 failed
```

All 587 tests including 8 new Track 3 tests passed.

### Track 3 tests (subset of 587)

```
Running Calendar Track 3 Verification Tests...
  ✓ Track 3.1: External Calendar URL normalization converts webcal:// to https://
  ✓ Track 3.2: URL feed fetcher routes through /v1/calendar/feed-proxy and falls back to direct fetch
  ✓ Track 3.3: OfflineActionType supports create_exception, update_exception, delete_exception
  ✓ Track 3.4: syncOfflineQueue replays recurrence exception actions and clears queue
  ✓ Track 3.5: moveEventToTrash encrypts details with AES-GCM and eliminates plaintext leakage in localStorage
  ✓ Track 3.6: Calendar trash supports legacy unencrypted fallback
  ✓ Track 3.7: saveTask encrypts task title and description with AES-GCM when key is available
  ✓ Track 3.8: taskStore supports legacy unencrypted fallback
CALENDAR TRACK 3 TESTS: 8 passed, 0 failed
```

### Go backend calendar proxy tests

```
=== RUN   TestCalendarFeedProxy_Unauthorized
--- PASS: TestCalendarFeedProxy_Unauthorized (0.00s)
=== RUN   TestCalendarFeedProxy_MissingOrInvalidURL
--- PASS: TestCalendarFeedProxy_MissingOrInvalidURL (0.00s)
=== RUN   TestCalendarFeedProxy_SSRFProtection
--- PASS: TestCalendarFeedProxy_SSRFProtection (0.00s)
    (18 subtests, all PASS: 127.0.0.1, 127.0.0.2, localhost, sub.localhost,
    10.0.0.1, 10.254.1.1, 172.16.0.1, 172.31.255.255, 192.168.1.1,
    192.168.100.50, 169.254.169.254, 169.254.1.1, ::1, fc00::1, fe80::1,
    webcal://127.0.0.1, webcal://169.254.169.254)
=== RUN   TestCalendarFeedProxy_ResponseSizeLimitLogic
--- PASS: TestCalendarFeedProxy_ResponseSizeLimitLogic (0.00s)
=== RUN   TestCalendarFeedProxy_SSRFForbiddenIPUnit
--- PASS: TestCalendarFeedProxy_SSRFForbiddenIPUnit (0.00s)
PASS
ok  	byos.email/services/api	1.838s
```

### Git commit

```
[feat/mengto-anti-slop-webmail-craftsmanship 075367f] feat: Track 3 calendar feed proxy, offline exceptions, encrypted trash and tasks
 11 files changed, 1452 insertions(+), 79 deletions(-)\n create mode 100644 apps/webmail/src/calendar_track3.test.ts
 create mode 100644 services/api/calendar_feed_proxy.go
 create mode 100644 services/api/calendar_feed_proxy_test.go
```

---

## Manual browser verification

**UNTESTED** – browser verification requires the running app with a live mailbox session.

Steps required to verify manually:
1. Start the dev server (`npm run dev` in `apps/webmail`).
2. Log in to a mailbox account.
3. Open Calendar → Subscriptions → Add URL feed using a real `.ics` URL. Confirm events appear.
4. Go offline (DevTools → Network → Offline), edit a single occurrence of a recurring event. Confirm offline badge appears.
5. Go back online. Confirm the queued exception is synced and the occurrence reflects the edit.
6. Delete a calendar event. Open Trash. Inspect `localStorage` in DevTools Storage tab: confirm the `byos_calendar_trash_<mailboxId>` value shows `encryptedDetails` with no plaintext title.
7. Open Tasks. Create a task. Inspect `localStorage` under `byos_calendar_tasks_<mailboxId>`: confirm `encryptedTitle` is present and the raw title string is absent.

---

## What did not work or is untested

- No live browser screenshots were captured (no headless browser available in this environment).
- Full `go test ./...` suite was not re-run (only the new proxy tests were run). The existing Go test baseline was passing at commit `35f5e97` and no existing Go files were modified other than `main.go` route registration.

---

## Test suite output (summary)

```
npm test → OVERALL: 587 passed, 0 failed
go test -run TestCalendarFeedProxy -v → PASS (5 tests, 18 subtests)
npm run typecheck → exit 0, no errors
```
