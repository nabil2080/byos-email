# BYOS C6.9.2AA: Full API Test Suite Stabilization Report

## 1. Executive Summary & Final Verdict

**Final Verdict:** **PASS**

The complete `services/api` `go vet ./...` and `go test ./...` suite exited `0` (`ok byos.email/services/api 92.933s`) against the dedicated disposable databases `byos_disposable_c692z` and `byos_unmigrated_c692aa`. Production security enforcement (CSRF origin allowlist, strict client-context cookie isolation, passkey/TOTP MFA step-up, Section 12 envelope validation, and disposable-DB guards) remains intact or strengthened, and the active `byos` development database was untouched.

---

## 2. Root Causes & Remediation

1. **Task A (`path_a_attachments_test.go`, `message_attachments_test.go`):**
   - **Root Cause 1 (CSRF):** Cookie-authenticated `POST` requests lacked `Origin` and `BYOS_ALLOWED_ORIGINS`, causing `withCORS` (`services/api/cors.go`) to fail closed with `403 {"error":"CSRF origin validation failed"}` when `BYOS_ENV` was not `development`.
   - **Root Cause 2 (Cookie Context):** Once `Origin: http://127.0.0.1:3001` was added, `detectClient` resolved `"webmail"`, which strictly requires `byos_webmail_session` (`X-BYOS-Client: webmail`) rather than `byos_session`.
   - **Root Cause 3 (Section 12 Synthetic Payloads):** `TestUploadAttachmentChunk_StorageWorkerFailure` and `TestUploadAttachmentChunk_EndToEndCiphertextIntegrity` used all-zero 12-byte IVs, which `validateSection12BinaryEnvelope` rejected with `400`.
   - **Fix:** Configured `t.Setenv("BYOS_ALLOWED_ORIGINS", "http://127.0.0.1:3001")` in `setupAttachmentMockStorage` and `TestUploadAttachmentChunk_StorageWorkerFailure`, sent `Origin: http://127.0.0.1:3001` + `X-BYOS-Client: webmail` + `byos_webmail_session` on simulated Webmail attachment `POST` requests, populated non-zero synthetic IV bytes, and added `TestUploadAttachmentChunk_CSRFRejection` verifying `403`/`401` on missing, unconfigured, and conflicting `Origin`/`Referer`.

2. **Task B (`TestRegistrationCompatibilityPreAndPostMigration`):**
   - **Root Cause:** Existing `byos_unmigrated` already had migration `058` applied (`organizations.org_recovery_pk` `is_nullable = 'YES'`).
   - **Fix:** Provisioned dedicated disposable database `byos_unmigrated_c692aa` with migrations `001`–`057` (`org_recovery_pk.is_nullable = 'NO'`) and ran with `TEST_UNMIGRATED_DATABASE_URL`, preserving the `byos_unmigrated` DB guard.

3. **Task C (`recovery_flow_test.go` & `services/api/recovery.go`):**
   - **Passkey MFA Bypass Bug (`services/api/recovery.go:430`):** `else if hasPasskeys && strings.TrimSpace(req.MFACode) != ""` skipped MFA when a passkey-only user omitted `mfa_code`, returning `204` instead of `403`. Fixed to `else if hasPasskeys` requiring `mfa_code` (`403 Forbidden` when empty).
   - **C4.1 Cookie Extraction (`recovery_flow_test.go:1138, 1532`):** `exceptionalRecoveryResetHandler` returns the session token in `Set-Cookie: byos_session` (omitting `token` from JSON per C4.1); updated tests to read `byos_session` from `recReset.Result().Cookies()`.
   - **TOTP Replay Collision (`recovery_flow_test.go:2377`):** `TestPasswordModificationInvalidatesPendingReactivations` reused `totpSecret` within the same 30s step; updated to use a fresh `step_up_mfa` challenge token.

4. **Task D (`tools/clean-test-data.sql` Review):**
   - Verified `target_test_users`, `target_test_domains`, and `target_test_orgs` exclude any rows referenced by surviving `mailboxes` (`mailboxes_user_id_fkey`), clean `support_ticket_messages`/`support_tickets` for `target_test_users`, preserve all seed users/mailboxes, and pass idempotently (`-count=2`).

---

## 3. Verification Output

- **Full `services/api` `go vet ./...` & `go test ./...` (`TEST_DATABASE_URL=.../byos_disposable_c692z`, `TEST_UNMIGRATED_DATABASE_URL=.../byos_unmigrated_c692aa`):**
  ```text
  ok  	byos.email/services/api	92.933s
  ```
- **Active Development Database (`byos`) Untouched & Ports Closed:**
  ```text
   current_database | users_cnt | mb_cnt 
  ------------------+-----------+--------
   byos             |         2 |      2
  (1 row)
  ```
  Mail ports `25, 2525, 1025, 8025` closed; `BYOS_BACKUP_REMOTE_ENABLED=false` unchanged; no containers restarted/recreated.
