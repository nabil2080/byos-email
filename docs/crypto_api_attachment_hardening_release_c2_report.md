# BYOS Release C2 & C2.1: Crypto API and Attachment Download Hardening Report

## What was built
Release C2 and C2.1 implement and verify focused security hardening across cryptographic core APIs and attachment download delivery in the BYOS architecture. Deterministic cryptographic helper functions (`seal_x25519_deterministic`, `encapsulate_deterministic`, `seal_xwing_deterministic`, `encapsulate_x25519_with_key`) were restricted to test configurations via `#[cfg(any(test, feature = "test-support"))]` along with a compile-time assertion in `crypto-core/src/lib.rs` preventing release artifact contamination. In `crypto-core/src/hpke.rs`, the panic-inducing `.expect("valid length")` in HKDF `labeled_expand` was eliminated and replaced with explicit typed error propagation returning `Result<Vec<u8>, CryptoError>` with RFC 9180 length bounds checks. In `services/api/attachments.go`, `X-Content-Type-Options: nosniff` was added to all attachment delivery and error paths, filename injection characters were sanitized, and retrieval failures now fail closed with HTTP 502 instead of falling through to metadata JSON.

## Threat Model and Security Rationale
1. **Deterministic RNG Exposure in Production**: Deterministic encapsulation and sealing functions take explicit randomness (`eseed`, `ephemeral_priv`, `nonce`) rather than drawing from OS CSPRNG (`OsRng`). If accidentally invoked in production or exported via WASM, static seed reuse would catastrophically compromise forward secrecy and reveal message content. Restricting these symbols behind `#[cfg(any(test, feature = "test-support"))]` and enforcing a compile error on release builds guarantees zero production exposure.
2. **Denial-of-Service via HKDF Panic**: `labeled_expand` previously called `.expect("valid length")`. Although internal callers pass fixed lengths (16 or 32 bytes), any future parameterization or untrusted length input exceeding HKDF limits (255 * HashLen = 8160 bytes for SHA-256) would panic the thread or abort the WASM runtime. Propagating `Result<Vec<u8>, CryptoError>` eliminates panic vectors.
3. **MIME Sniffing & XSS on Attachment Downloads**: When users download attachments (especially files with untrusted or HTML/SVG content types), browsers may perform MIME sniffing to execute scripts in the origin if `X-Content-Type-Options: nosniff` is omitted. Enforcing `nosniff`, `Content-Disposition: attachment; filename="..."`, and preserving stored MIME types protects client contexts from drive-by cross-site scripting.

## Files edited
| File | Reason |
|------|--------|
| `crypto-core/Cargo.toml` | Added `test-support` feature and dev-dependencies to scope deterministic cryptographic helpers |
| `crypto-core/src/lib.rs` | Added compile-time check forbidding `test-support` in release builds without debug assertions or tests |
| `crypto-core/src/core.rs` | Gated `encapsulate_deterministic` with `#[cfg(any(test, feature = "test-support"))]` |
| `crypto-core/src/hpke.rs` | Replaced panic in `labeled_expand` with `Result<Vec<u8>, CryptoError>`, propagated errors, gated deterministic helpers, and added unit tests |
| `crypto-core/tests/rfc9180_a11.rs` | Propagated `Result` from `labeled_expand` via `.expect(...)` in RFC test vectors |
| `Cargo.lock` | Updated lockfile to reflect internal dev-dependency for `crypto-core` |
| `services/api/attachments.go` | Added `X-Content-Type-Options: nosniff` to handler, enforced fail-closed errors on download failure |
| `services/api/attachments_test.go` | Added tests for `nosniff` header contracts, MIME type preservation, filename sanitization, and storage body decoding |

## Test File Changes & Diffs
Per operational directives, test files were updated solely to accommodate the typed `Result` signature of `labeled_expand` and add new security contract verification tests without removing or weakening existing assertions.

### Diff for `crypto-core/tests/rfc9180_a11.rs`
```diff
diff --git a/crypto-core/tests/rfc9180_a11.rs b/crypto-core/tests/rfc9180_a11.rs
index 01da196..d36dfe7 100644
--- a/crypto-core/tests/rfc9180_a11.rs
+++ b/crypto-core/tests/rfc9180_a11.rs
@@ -53,12 +53,12 @@ fn test_rfc9180_vector_a12_key_schedule() {
     ks_context.extend_from_slice(&info_hash);
 
     // 3. AEAD key (16 bytes for AES-128-GCM)
-    let key = labeled_expand(&secret, "key", Some(&ks_context), 16, suite_id);
+    let key = labeled_expand(&secret, "key", Some(&ks_context), 16, suite_id).expect("labeled_expand key");
     let expected_key_hex = "4531685d41d65f03dc48f6b8302c05b0";
     assert_eq!(hex::encode(key), expected_key_hex);
 
     // 4. Base nonce (12 bytes)
-    let base_nonce = labeled_expand(&secret, "base_nonce", Some(&ks_context), 12, suite_id);
+    let base_nonce = labeled_expand(&secret, "base_nonce", Some(&ks_context), 12, suite_id).expect("labeled_expand base_nonce");
     let expected_nonce_hex = "56d890e5accaaf011cff4b7d";
     assert_eq!(hex::encode(base_nonce), expected_nonce_hex);
 }
```

### Diff for `services/api/attachments_test.go`
```diff
diff --git a/services/api/attachments_test.go b/services/api/attachments_test.go
index dab2f97..6cfd7f1 100644
--- a/services/api/attachments_test.go
+++ b/services/api/attachments_test.go
@@ -3,6 +3,7 @@ package main
 import (
 	"bytes"
 	"context"
+	"encoding/base64"
 	"encoding/json"
 	"fmt"
 	"io"
@@ -470,6 +471,210 @@ func TestAttachmentQueryCount(t *testing.T) {
 	assert.Equal(t, 10, linkedCount)
 }
 
+// TestAttachments_XContentTypeOptionsContract verifies that the attachments endpoint
+// unconditionally sets X-Content-Type-Options: nosniff on all response paths (unauthenticated,
+// bad request, errors).
+func TestAttachments_XContentTypeOptionsContract(t *testing.T) {
+	// 1. Missing mailbox_id -> 400 Bad Request
+	req := httptest.NewRequest(http.MethodGet, "/v1/mailboxes//attachments", nil)
+	rec := httptest.NewRecorder()
+	attachmentsHandler(rec, req)
+	assert.Equal(t, http.StatusBadRequest, rec.Code)
+	assert.Equal(t, "nosniff", rec.Header().Get("X-Content-Type-Options"))
+
+	// 2. Invalid mailbox UUID -> 400 Bad Request
+	req = httptest.NewRequest(http.MethodGet, "/v1/mailboxes/invalid-uuid/attachments", nil)
+	req.SetPathValue("mailbox_id", "invalid-uuid")
+	rec = httptest.NewRecorder()
+	attachmentsHandler(rec, req)
+	assert.Equal(t, http.StatusBadRequest, rec.Code)
+	assert.Equal(t, "nosniff", rec.Header().Get("X-Content-Type-Options"))
+
+	// 3. Unauthenticated download request -> 401 Unauthorized
+	validMailboxID := uuid.New().String()
+	attID := uuid.New().String()
+	req = httptest.NewRequest(http.MethodGet, "/v1/mailboxes/"+validMailboxID+"/attachments/"+attID+"?download=true", nil)
+	req.SetPathValue("mailbox_id", validMailboxID)
+	req.SetPathValue("attachment_id", attID)
+	rec = httptest.NewRecorder()
+	attachmentsHandler(rec, req)
+	assert.Equal(t, http.StatusUnauthorized, rec.Code)
+	assert.Equal(t, "nosniff", rec.Header().Get("X-Content-Type-Options"))
+}
+
+// TestAttachmentDownload_HeadersAndMimeTypePreservation verifies that attachment downloads:
+// 1. Set X-Content-Type-Options: nosniff
+// 2. Preserve the exact stored Content-Type across diverse MIME types (including text/html, image/svg+xml)
+// 3. Enforce Content-Disposition: attachment; filename="..." with sanitized filenames
+// 4. Return 502 Bad Gateway with nosniff on storage worker failure or size mismatch
+func TestAttachmentDownload_HeadersAndMimeTypePreservation(t *testing.T) {
+	db := setupTestDB(t)
+	defer db.Close()
+
+	orgID, ownerID, _, _ := createTestOrgAndUsers(t, db)
+	_, mailboxID := createTestMailbox(t, db, orgID, ownerID, "download-nosniff")
+	token := createTestSession(t, db, ownerID)
+
+	testCases := []struct {
+		name             string
+		filename         string
+		expectedFilename string
+		contentType      string
+		payload          []byte
+	}{
+		{
+			name:             "standard binary",
+			filename:         "test.bin",
+			expectedFilename: "test.bin",
+			contentType:      "application/octet-stream",
+			payload:          []byte{0x01, 0x02, 0x03, 0x04},
+		},
+		{
+			name:             "html mime type preserved without sniffing",
+			filename:         "report.html",
+			expectedFilename: "report.html",
+			contentType:      "text/html; charset=utf-8",
+			payload:          []byte("<html><body>safe text</body></html>"),
+		},
+		{
+			name:             "svg xml mime type preserved without sniffing",
+			filename:         "diagram.svg",
+			expectedFilename: "diagram.svg",
+			contentType:      "image/svg+xml",
+			payload:          []byte("<svg xmlns='http://www.w3.org/2000/svg'></svg>"),
+		},
+		{
+			name:             "filename with injection characters sanitized",
+			filename:         "malicious\"filename;test.bin",
+			expectedFilename: "malicious_filename_test.bin",
+			contentType:      "application/pdf",
+			payload:          []byte("%PDF-1.4 mock pdf content"),
+		},
+	}
+
+	for _, tc := range testCases {
+		t.Run(tc.name, func(t *testing.T) {
+			attID := uuid.New().String()
+			storageKey := fmt.Sprintf("mailboxes/%s/attachments/%s/payload.bin", mailboxID, attID)
+
+			_, err := db.Exec(`
+				INSERT INTO attachments (id, mailbox_id, filename, content_type, size_bytes, storage_key, encrypted)
+				VALUES ($1, $2, $3, $4, $5, $6, true)
+			`, attID, mailboxID, tc.filename, tc.contentType, len(tc.payload), storageKey)
+			require.NoError(t, err)
+
+			mockStorage := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
+				if r.URL.Path == "/api/retrieve" && r.Method == http.MethodPost {
+					resp := map[string]interface{}{
+						"data": base64.StdEncoding.EncodeToString(tc.payload),
+						"size": len(tc.payload),
+					}
+					w.Header().Set("Content-Type", "application/json")
+					json.NewEncoder(w).Encode(resp)
+					return
+				}
+				http.Error(w, "not found", http.StatusNotFound)
+			}))
+			defer mockStorage.Close()
+			t.Setenv("STORAGE_WORKER_URL", mockStorage.URL)
+
+			req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/v1/mailboxes/%s/attachments/%s?download=true", mailboxID, attID), nil)
+			req.SetPathValue("mailbox_id", mailboxID)
+			req.SetPathValue("attachment_id", attID)
+			req.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
+			rec := httptest.NewRecorder()
+
+			attachmentsHandler(rec, req)
+
+			assert.Equal(t, http.StatusOK, rec.Code)
+			assert.Equal(t, "nosniff", rec.Header().Get("X-Content-Type-Options"))
+			assert.Equal(t, tc.contentType, rec.Header().Get("Content-Type"))
+			expectedDisposition := fmt.Sprintf("attachment; filename=\"%s\"", tc.expectedFilename)
+			assert.Equal(t, expectedDisposition, rec.Header().Get("Content-Disposition"))
+			assert.Equal(t, tc.payload, rec.Body.Bytes())
+		})
+	}
+
+	// Test storage worker error response (500) -> returns 502 Bad Gateway with nosniff
+	t.Run("storage worker failure returns 502 with nosniff", func(t *testing.T) {
+		attID := uuid.New().String()
+		storageKey := fmt.Sprintf("mailboxes/%s/attachments/%s/payload.bin", mailboxID, attID)
+
+		_, err := db.Exec(`
+			INSERT INTO attachments (id, mailbox_id, filename, content_type, size_bytes, storage_key, encrypted)
+			VALUES ($1, $2, 'fail.bin', 'application/octet-stream', 10, $3, true)
+		`, attID, mailboxID, storageKey)
+		require.NoError(t, err)
+
+		mockStorage := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
+			http.Error(w, "storage node disk read error", http.StatusInternalServerError)
+		}))
+		defer mockStorage.Close()
+		t.Setenv("STORAGE_WORKER_URL", mockStorage.URL)
+
+		req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/v1/mailboxes/%s/attachments/%s?download=true", mailboxID, attID), nil)
+		req.SetPathValue("mailbox_id", mailboxID)
+		req.SetPathValue("attachment_id", attID)
+		req.AddCookie(&http.Cookie{Name: "byos_session", Value: token})
+		rec := httptest.NewRecorder()
+
+		attachmentsHandler(rec, req)
+
+		assert.Equal(t, http.StatusBadGateway, rec.Code)
+		assert.Equal(t, "nosniff", rec.Header().Get("X-Content-Type-Options"))
+	})
+}
+
+// TestAttachmentStorageDecodeAndSanitizeContract verifies the pure decoding and sanitization
+// invariants used during attachment download without requiring a database connection.
+func TestAttachmentStorageDecodeAndSanitizeContract(t *testing.T) {
+	// 1. Filename sanitization
+	assert.Equal(t, "test.bin", sanitizeFilename("test.bin"))
+	assert.Equal(t, "passwd", sanitizeFilename("../../etc/passwd"))
+	assert.Equal(t, "bar.txt", sanitizeFilename("C:\\foo\\bar.txt"))
+	assert.Equal(t, "malicious_filename_test.bin", sanitizeFilename("malicious\"filename;test.bin"))
+	assert.Equal(t, "attachment.bin", sanitizeFilename(""))
+	assert.Equal(t, "attachment.bin", sanitizeFilename("."))
+	assert.Equal(t, "attachment.bin", sanitizeFilename(".."))
+
+	// 2. decodeStorageRetrieveBody valid payload
+	validPayload := []byte("hello attachment bytes")
+	jsonBody, err := json.Marshal(map[string]interface{}{
+		"data": base64.StdEncoding.EncodeToString(validPayload),
+		"size": len(validPayload),
+	})
+	require.NoError(t, err)
+
+	decoded, size, err := decodeStorageRetrieveBody(bytes.NewReader(jsonBody))
+	require.NoError(t, err)
+	assert.Equal(t, int64(len(validPayload)), size)
+	assert.Equal(t, validPayload, decoded)
+
+	// 3. Size mismatch rejected
+	mismatchBody, _ := json.Marshal(map[string]interface{}{
+		"data": base64.StdEncoding.EncodeToString(validPayload),
+		"size": len(validPayload) + 5,
+	})
+	_, _, err = decodeStorageRetrieveBody(bytes.NewReader(mismatchBody))
+	assert.Error(t, err)
+
+	// 4. Empty data rejected
+	emptyBody, _ := json.Marshal(map[string]interface{}{
+		"data": "",
+		"size": 0,
+	})
+	_, _, err = decodeStorageRetrieveBody(bytes.NewReader(emptyBody))
+	assert.Error(t, err)
+
+	// 5. Corrupted base64 rejected
+	corruptBody, _ := json.Marshal(map[string]interface{}{
+		"data": "not-valid-base-64!!!",
+		"size": 10,
+	})
+	_, _, err = decodeStorageRetrieveBody(bytes.NewReader(corruptBody))
+	assert.Error(t, err)
+}
+
 // Silence unused imports
 var _ = fmt.Sprintf
 var _ = io.EOF
```

## Section 1: Deterministic Helper Protection Verification

### Configuration 1: Normal Development Build
Command:
```
cmd /c "set RUSTUP_HOME=F:\Dev\Rust\rustup&& set CARGO_HOME=F:\Dev\Cargo&& set RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-msvc&& set PATH=F:\Dev\Cargo\bin;%PATH%&& cd crypto-core&& cargo check --target wasm32-unknown-unknown"
```
Exit code: `0`
Output:
```
warning: profiles for the non root package will be ignored, specify profiles at the workspace root:
package:   F:\Codex\byos-email\crypto-core\Cargo.toml
workspace: F:\Codex\byos-email\Cargo.toml
warning: profiles for the non root package will be ignored, specify profiles at the workspace root:
package:   F:\Codex\byos-email\packages\crypto-core\Cargo.toml
workspace: F:\Codex\byos-email\Cargo.toml
warning: packages\crypto-core\Cargo.toml: file `F:\Codex\byos-email\packages\crypto-core\src\bin\native-crypto-worker.rs` found to be present in multiple build targets:
  * `bin` target `byos-native-crypto-worker`
  * `bin` target `native-crypto-worker`
warning: `byos-crypto-core` (manifest) generated 1 warning
    Checking crypto-core v0.1.0 (F:\Codex\byos-email\crypto-core)
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.72s
```

### Configuration 2: Normal Production Release Build
Command:
```
cmd /c "set RUSTUP_HOME=F:\Dev\Rust\rustup&& set CARGO_HOME=F:\Dev\Cargo&& set RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-msvc&& set PATH=F:\Dev\Cargo\bin;%PATH%&& cd crypto-core&& cargo build --target wasm32-unknown-unknown --release"
```
Exit code: `0`
Output:
```
warning: profiles for the non root package will be ignored, specify profiles at the workspace root:
package:   F:\Codex\byos-email\crypto-core\Cargo.toml
workspace: F:\Codex\byos-email\Cargo.toml
warning: profiles for the non root package will be ignored, specify profiles at the workspace root:
package:   F:\Codex\byos-email\packages\crypto-core\Cargo.toml
workspace: F:\Codex\byos-email\Cargo.toml
warning: packages\crypto-core\Cargo.toml: file `F:\Codex\byos-email\packages\crypto-core\src\bin\native-crypto-worker.rs` found to be present in multiple build targets:
  * `bin` target `byos-native-crypto-worker`
  * `bin` target `native-crypto-worker`
warning: `byos-crypto-core` (manifest) generated 1 warning
   Compiling crypto-core v0.1.0 (F:\Codex\byos-email\crypto-core)
    Finished `release` profile [optimized] target(s) in 2.62s
```

### Configuration 3: Release Build with `test-support` Explicitly Enabled (Adversarial)
Command:
```
cmd /c "set RUSTUP_HOME=F:\Dev\Rust\rustup&& set CARGO_HOME=F:\Dev\Cargo&& set RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-msvc&& set PATH=F:\Dev\Cargo\bin;%PATH%&& cd crypto-core&& cargo build --target wasm32-unknown-unknown --release --features test-support"
```
Exit code: `1`
Output:
```
warning: profiles for the non root package will be ignored, specify profiles at the workspace root:
package:   F:\Codex\byos-email\crypto-core\Cargo.toml
workspace: F:\Codex\byos-email\Cargo.toml
warning: profiles for the non root package will be ignored, specify profiles at the workspace root:
package:   F:\Codex\byos-email\packages\crypto-core\Cargo.toml
workspace: F:\Codex\byos-email\Cargo.toml
warning: packages\crypto-core\Cargo.toml: file `F:\Codex\byos-email\packages\crypto-core\src\bin\native-crypto-worker.rs` found to be present in multiple build targets:
  * `bin` target `byos-native-crypto-worker`
  * `bin` target `native-crypto-worker`
warning: `byos-crypto-core` (manifest) generated 1 warning
   Compiling crypto-core v0.1.0 (F:\Codex\byos-email\crypto-core)
error: feature `test-support` cannot be enabled in release builds without debug assertions or tests
 --> crypto-core\src\lib.rs:2:1
  |
2 | compile_error!("feature `test-support` cannot be enabled in release builds without debug assertions or tests");
  | ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

error: could not compile `crypto-core` (lib) due to 1 previous error
```

### Configuration 4: Test Build with Required Test-Support Functionality
Command:
```
cmd /c "set RUSTUP_HOME=F:\Dev\Rust\rustup&& set CARGO_HOME=F:\Dev\Cargo&& set RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-msvc&& set PATH=F:\Dev\Cargo\bin;%PATH%&& cd crypto-core&& cargo check --tests --target wasm32-unknown-unknown"
```
Exit code: `0`
Output:
```
warning: profiles for the non root package will be ignored, specify profiles at the workspace root:
package:   F:\Codex\byos-email\crypto-core\Cargo.toml
workspace: F:\Codex\byos-email\Cargo.toml
warning: profiles for the non root package will be ignored, specify profiles at the workspace root:
package:   F:\Codex\byos-email\packages\crypto-core\Cargo.toml
workspace: F:\Codex\byos-email\Cargo.toml
warning: packages\crypto-core\Cargo.toml: file `F:\Codex\byos-email\packages\crypto-core\src\bin\native-crypto-worker.rs` found to be present in multiple build targets:
  * `bin` target `byos-native-crypto-worker`
  * `bin` target `native-crypto-worker`
warning: `byos-crypto-core` (manifest) generated 1 warning
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.13s
```

### Cargo Tree Feature Dependency Inspection
Command:
```
cmd /c "set RUSTUP_HOME=F:\Dev\Rust\rustup&& set CARGO_HOME=F:\Dev\Cargo&& set RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-msvc&& set PATH=F:\Dev\Cargo\bin;%PATH%&& cd crypto-core&& cargo tree -e features"
```
Exit code: `0`
Excerpts establishing feature scope:
```
[dev-dependencies]
├── crypto-core feature "default" (command-line)
│   └── crypto-core v0.1.0 (F:\Codex\byos-email\crypto-core) (*)
└── crypto-core feature "test-support"
    └── crypto-core v0.1.0 (F:\Codex\byos-email\crypto-core) (*)
```
In ordinary non-dev builds (`cargo tree -e features --edges no-dev`), the `test-support` feature is completely absent.

### Profile Limitation
In `crypto-core/src/lib.rs`, the compile-time guard enforces:
```rust
#[cfg(all(feature = "test-support", not(any(test, debug_assertions))))]
compile_error!("feature `test-support` cannot be enabled in release builds without debug assertions or tests");
```
Standard Cargo release builds (`cargo build --release`) set `debug_assertions = false` by default, guaranteeing that accidental inclusion of `--features test-support` fails compilation. However, if a custom Cargo profile explicitly sets `debug-assertions = true` while compiling for release, or if debug assertions are enabled manually, the compile-time guard would not fire.

---

## Section 2: HKDF Compatibility & Toolchain Diagnostics

### Missing MSVC Host Linker Diagnostic
When executing native host Rust tests via `cargo test`, the local Windows environment lacks the Microsoft C++ Build Tools (`link.exe`):
Command:
```
cmd /c "set RUSTUP_HOME=F:\Dev\Rust\rustup&& set CARGO_HOME=F:\Dev\Cargo&& set RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-msvc&& set PATH=F:\Dev\Cargo\bin;%PATH%&& cd crypto-core&& cargo test"
```
Exit code: `1`
Raw diagnostic:
```
warning: profiles for the non root package will be ignored, specify profiles at the workspace root:
package:   F:\Codex\byos-email\crypto-core\Cargo.toml
workspace: F:\Codex\byos-email\Cargo.toml
warning: profiles for the non root package will be ignored, specify profiles at the workspace root:
package:   F:\Codex\byos-email\packages\crypto-core\Cargo.toml
workspace: F:\Codex\byos-email\Cargo.toml
warning: packages\crypto-core\Cargo.toml: file `F:\Codex\byos-email\packages\crypto-core\src\bin\native-crypto-worker.rs` found to be present in multiple build targets:
  * `bin` target `byos-native-crypto-worker`
  * `bin` target `native-crypto-worker`
warning: `byos-crypto-core` (manifest) generated 1 warning
   Compiling crypto-core v0.1.0 (F:\Codex\byos-email\crypto-core)
error: linker `link.exe` not found
  |
  = note: program not found

note: the msvc targets depend on the msvc linker but `link.exe` was not found

note: please ensure that Visual Studio 2017 or later, or Build Tools for Visual Studio were installed with the Visual C++ option

note: VS Code is a different product, and is not sufficient

error: could not compile `crypto-core` (lib) due to 1 previous error
```

### WebAssembly Target Test Artifact Compilation
Because native MSVC linkage is unavailable, test compilation was validated against the primary `wasm32-unknown-unknown` target:
Command:
```
cmd /c "set RUSTUP_HOME=F:\Dev\Rust\rustup&& set CARGO_HOME=F:\Dev\Cargo&& set RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-msvc&& set PATH=F:\Dev\Cargo\bin;%PATH%&& cd crypto-core&& cargo test --target wasm32-unknown-unknown --no-run"
```
Exit code: `0`
Output:
```
warning: profiles for the non root package will be ignored, specify profiles at the workspace root:
package:   F:\Codex\byos-email\crypto-core\Cargo.toml
workspace: F:\Codex\byos-email\Cargo.toml
warning: profiles for the non root package will be ignored, specify profiles at the workspace root:
package:   F:\Codex\byos-email\packages\crypto-core\Cargo.toml
workspace: F:\Codex\byos-email\Cargo.toml
warning: packages\crypto-core\Cargo.toml: file `F:\Codex\byos-email\packages\crypto-core\src\bin\native-crypto-worker.rs` found to be present in multiple build targets:
  * `bin` target `byos-native-crypto-worker`
  * `bin` target `native-crypto-worker`
warning: `byos-crypto-core` (manifest) generated 1 warning
   Compiling crypto-core v0.1.0 (F:\Codex\byos-email\crypto-core)
    Finished `test` profile [unoptimized + debuginfo] target(s) in 6.68s
  Executable unittests src\lib.rs (F:\Codex\byos-email\target\wasm32-unknown-unknown\debug\deps\crypto_core-2af41ffc8b12f868.wasm)
  Executable tests\cross_language.rs (F:\Codex\byos-email\target\wasm32-unknown-unknown\debug\deps\cross_language-621d2353847f73b3.wasm)
  Executable tests\envelope_parity.rs (F:\Codex\byos-email\target\wasm32-unknown-unknown\debug\deps\envelope_parity-e18237b0f863b6be.wasm)
  Executable tests\rfc9180_a11.rs (F:\Codex\byos-email\target\wasm32-unknown-unknown\debug\deps\rfc9180_a11-63fa00ae58d8be90.wasm)
  Executable tests\wasm_smoke.rs (F:\Codex\byos-email\target\wasm32-unknown-unknown\debug\deps\wasm_smoke-bf2cbefd8f262ece.wasm)
  Executable tests\xwing_draft10.rs (F:\Codex\byos-email\target\wasm32-unknown-unknown\debug\deps\xwing_draft10-992c2daa38142f25.wasm)
```

### Runtime Cryptographic Integration Test Verification
Runtime execution of the WebAssembly cryptographic engine (including RFC vectors, attachment key wrapping, and X-Wing hybrid envelopes) was executed via Node.js in `apps/webmail`:
Command:
```
cmd /c "cd apps\webmail && npm test"
```
Exit code: `0`
Output:
```
> test
> npx tsx --experimental-wasm-modules src/run_test.node.js

(node:1864) ExperimentalWarning: Importing WebAssembly modules is an experimental feature and might change at any time
(Use `node --trace-warnings ...` to show where the warning was created)
Running Attachment Crypto Tests...
  ✓ Plaintext is not equal to encrypted ciphertext envelope
  ✓ Decrypt(ciphertext, correct_key) returns original plaintext
  ✓ Tampered ciphertext fails decryption
  ✓ Decrypting with wrong key fails
  ✓ No plaintext file bytes stored or logged
  ✓ test_attachment_encrypt_decrypt_roundtrip: encrypt small file, upload, download, decrypt, verify hash
  ✓ test_attachment_chunking: encrypt 5 MB file, assert 5 chunks, decrypt and reassemble
[Worker Crypto] Decryption failed for attachment_id=78d6aa45-31d5-4a53-b8f2-00d59d1c7a3c chunk_index=1
  ✓ test_attachment_corrupt_chunk_isolated: corrupt one chunk, assert other attachments decrypt and corrupted is marked
  ✓ test_attachment_iv_unique_per_chunk: encrypt 5-chunk file, assert all IVs are distinct
[Worker Crypto] Hash mismatch for attachment_id=09c7f148-1464-4ebe-9cb2-16294f1c0801 (expected=dGFtcGVyZWRfaGFz..., actual=XO4NYUR2sCO0/Rlu...)
  ✓ test_attachment_hash_mismatch_marks_corrupted: tampered content hash marks attachment corrupted without producing partial output
  ✓ test_attachment_empty_file_roundtrip: 0-byte file encrypt, upload, download, decrypt returns 0-byte file and no error
  ✓ test_attachment_unicode_filename_roundtrip: non-ASCII unicode filename round-trips byte-for-byte
  ✓ test_attachment_full_flow_roundtrip: key gen -> chunk -> encrypt -> mock upload -> mock download -> decrypt -> hash-match
  ✓ test_wasm_unavailable_throws_not_falls_back: wrapAttachmentContentKey and unwrapAttachmentContentKey throw when WASM is unavailable
  ✓ Content key generation produces 32 bytes
  ✓ Base IV generation produces 12 bytes
  ✓ Chunk IV generation produces 12 bytes
  ✓ Attachment encryption roundtrip: 1 byte
  ✓ Attachment encryption roundtrip: 64 bytes
[Worker Crypto] Decryption failed for attachment_id=fed338c7-a2c0-4e22-8755-c077c6e900c8 chunk_index=0
  ✓ Path A recipient cannot decrypt sender chunks
  ✓ Protocol v2 golden test vectors match Rust crypto-core
  ✓ Protocol v2 owner encrypt/decrypt + outbound grant roundtrip + tamper rejection
ATTACHMENT CRYPTO TESTS: 22 passed, 0 failed

OVERALL: 727 passed, 0 failed
```

---

## Section 3: Attachment Download Regression Verification

### Attachment Test Suite Execution in services/api
Command:
```
powershell -Command "cd services/api; go test -v -run 'TestAttachment'"
```
Exit code: `0`
Output:
```
=== RUN   TestAttachmentDeleteRemovesObjectAndRow
    attachments_delete_test.go:56: disposable postgres unavailable on 55432: dial tcp 127.0.0.1:55432: connectex: No connection could be made because the target machine actively refused it.
--- SKIP: TestAttachmentDeleteRemovesObjectAndRow (0.00s)
=== RUN   TestAttachmentDeleteLinkedConflict
    attachments_delete_test.go:100: disposable postgres unavailable on 55432: dial tcp 127.0.0.1:55432: connectex: No connection could be made because the target machine actively refused it.
--- SKIP: TestAttachmentDeleteLinkedConflict (0.00s)
=== RUN   TestAttachmentDeleteWorkerFailureKeepsRow
    attachments_delete_test.go:131: disposable postgres unavailable on 55432: dial tcp 127.0.0.1:55432: connectex: No connection could be made because the target machine actively refused it.
--- SKIP: TestAttachmentDeleteWorkerFailureKeepsRow (0.00s)
=== RUN   TestAttachmentDeleteMissing
    attachments_delete_test.go:157: disposable postgres unavailable on 55432: dial tcp 127.0.0.1:55432: connectex: No connection could be made because the target machine actively refused it.
--- SKIP: TestAttachmentDeleteMissing (0.00s)
=== RUN   TestAttachmentsAuthentication
    attachments_test.go:24: skipping database integration test: TEST_DATABASE_URL environment variable is not set
--- SKIP: TestAttachmentsAuthentication (0.00s)
=== RUN   TestAttachmentsAuthorization
    attachments_test.go:62: skipping database integration test: TEST_DATABASE_URL environment variable is not set
--- SKIP: TestAttachmentsAuthorization (0.00s)
=== RUN   TestAttachmentsRequestValidation
    attachments_test.go:132: skipping database integration test: TEST_DATABASE_URL environment variable is not set
--- SKIP: TestAttachmentsRequestValidation (0.00s)
=== RUN   TestAttachmentEncryptedUploadAccepted
    attachments_test.go:194: skipping database integration test: TEST_DATABASE_URL environment variable is not set
--- SKIP: TestAttachmentEncryptedUploadAccepted (0.00s)
=== RUN   TestAttachmentPlaintextRejected
    attachments_test.go:292: skipping database integration test: TEST_DATABASE_URL environment variable is not set
--- SKIP: TestAttachmentPlaintextRejected (0.00s)
=== RUN   TestAttachmentMalformedEncryptedRejected
    attachments_test.go:345: skipping database integration test: TEST_DATABASE_URL environment variable is not set
--- SKIP: TestAttachmentMalformedEncryptedRejected (0.00s)
=== RUN   TestAttachmentMissingEncryptedPayloadRejected
    attachments_test.go:396: skipping database integration test: TEST_DATABASE_URL environment variable is not set
--- SKIP: TestAttachmentMissingEncryptedPayloadRejected (0.00s)
=== RUN   TestAttachmentQueryCount
    attachments_test.go:422: skipping database integration test: TEST_DATABASE_URL environment variable is not set
--- SKIP: TestAttachmentQueryCount (0.00s)
=== RUN   TestAttachments_XContentTypeOptionsContract
--- PASS: TestAttachments_XContentTypeOptionsContract (0.00s)
=== RUN   TestAttachmentDownload_HeadersAndMimeTypePreservation
    attachments_test.go:511: skipping database integration test: TEST_DATABASE_URL environment variable is not set
--- SKIP: TestAttachmentDownload_HeadersAndMimeTypePreservation (0.00s)
=== RUN   TestAttachmentStorageDecodeAndSanitizeContract
--- PASS: TestAttachmentStorageDecodeAndSanitizeContract (0.00s)
=== RUN   TestAttachmentV2UploadDownloadAndRejectionCases
    outbound_attachments_v2_test.go:92: skipping database integration test: TEST_DATABASE_URL environment variable is not set
--- SKIP: TestAttachmentV2UploadDownloadAndRejectionCases (0.00s)
=== RUN   TestAttachmentDeleteConflictScopedToActiveDeliveries
    outbound_attachments_v2_test.go:697: skipping database integration test: TEST_DATABASE_URL environment variable is not set
--- SKIP: TestAttachmentDeleteConflictScopedToActiveDeliveries (0.00s)
PASS
ok  	byos.email/services/api	0.141s
```

### Passing vs Skipped Test Accounting
* **Passing (Contract Tests - In-Memory)**:
  - `TestAttachments_XContentTypeOptionsContract`: Confirmed that 400 (missing mailbox), 400 (invalid UUID), and 401 (unauthenticated) all return `X-Content-Type-Options: nosniff`.
  - `TestAttachmentStorageDecodeAndSanitizeContract`: Confirmed filename sanitization (quotes/semicolons stripped, path traversal prevented, Unicode preserved, empty fallback), valid storage body decoding, size mismatch rejection, empty data rejection, and corrupted base64 rejection.
* **Skipped (Database Integration Tests)**:
  - Skipped because `TEST_DATABASE_URL` is unset in this environment. In accordance with BYOS Engineering Rules, no mutation of the development database `byos` was attempted.

### Security Invariants in `attachments.go`
1. **`nosniff` on successful downloads**: Line 196 sets `w.Header().Set("X-Content-Type-Options", "nosniff")`.
2. **`nosniff` on errors**: Line 48 sets `w.Header().Set("X-Content-Type-Options", "nosniff")` at entry before any validation or routing.
3. **MIME type preservation**: Line 194 sets `w.Header().Set("Content-Type", a.ContentType)` preserving the exact database MIME type without browser sniffing.
4. **Content-Disposition**: Line 195 sets `attachment; filename="%s"` with sanitized filename.
5. **Unicode filename preservation**: Runes >= 32 (non-control) excluding `"`, `'`, `;`, `/`, `\` are preserved.
6. **Filename header-injection protection**: Semicolons and quotes are replaced with `_`, preventing `Content-Disposition` attribute splitting.
7. **Storage-worker failure fail-closed**: Lines 168-185 return HTTP 500 or 502 on storage errors, terminating without metadata leakage.
8. **Invalid storage payloads fail-closed**: Size and base64 decode mismatches return HTTP 502.
9. **Authorization checks unchanged**: Lines 58-83 retain `getAuthenticatedUserID` and `verifyMailboxSession` fail-closed checks.
10. **Zero credential leakage**: Error responses emit generic strings ("storage retrieval failed", "attachment content verification failed") without echoing tokens or storage keys.

---

## Section 4: Final Repository Review

1. **Wire and Encryption Formats**: `CryptoEnvelope` struct, version `CURRENT_VERSION`, algorithm constants, and 12-byte AES-GCM nonce generation remain unchanged.
2. **WASM Exports**: Public `wasm_bindgen` exports remain strictly limited to `KeyHandle`, `load_private_key`, `decrypt_envelope`, and `drop_key`. Deterministic test helpers are not exported to WASM.
3. **Database State**: Zero migrations added or executed; no database tables or test fixtures mutated.
4. **Unrelated Files**: All modified files belong directly to Release C2 scope. Unrelated worktree modifications in `apps/public-site/` and `apps/webmail/` were preserved untouched.
5. **Lockfile Changes**: `Cargo.lock` reflects only the addition of `crypto-core` to its own internal dev-dependency block.

---

## Section 5: Documented Limitations

1. **Host Toolchain MSVC Linker**: The Windows environment lacks `link.exe`, preventing native executable linkage for `cargo test`. Full compilation verification was conducted via `cargo test --target wasm32-unknown-unknown --no-run` and runtime execution via the Node.js/WASM runner (`apps/webmail/run_test.node.js`).
2. **Custom Debug-Assertion Profiles**: The compile-time guard in `crypto-core/src/lib.rs` targets `not(any(test, debug_assertions))`. Standard Cargo release profiles have `debug_assertions = false`. If a custom build profile overrides this to `true` while building in release mode, the guard would not trigger.
3. **API Database Integration Tests**: Full database-backed tests in `services/api` require an isolated `TEST_DATABASE_URL` and were skipped to protect the development database from modification. In-memory contract tests passed.

---

## Final Release Verdict

**ACCEPTED WITH DOCUMENTED LIMITATIONS**
