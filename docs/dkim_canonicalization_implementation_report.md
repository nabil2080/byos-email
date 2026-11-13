# BYOS DKIM Canonicalization Implementation & Bidirectional Interoperability Report

**Verdict:** `ACCEPTED`  
**Specification Authority:** RFC 6376 (Section 3.4, Section 3.5, Section 3.7, Section 5.4, Section 6.1)  
**Remediation Proposal:** [`docs/dkim_canonicalization_remediation_proposal.md`](file:///f:/Codex/byos-email/docs/dkim_canonicalization_remediation_proposal.md)  
**Scope Boundary:** Explicit partial Section 12 unfreeze covering only the four authorized DKIM functions (`relaxed_header_canonicalize`, `relaxed_body_canonicalize`, `dkim_sign`, `verify_dkim_signature`) and byte-safe DKIM helpers in [`packages/crypto-core/src/lib.rs`](file:///f:/Codex/byos-email/packages/crypto-core/src/lib.rs#L1296-L1895), plus regression unit tests in [`packages/crypto-core/src/lib.rs`](file:///f:/Codex/byos-email/packages/crypto-core/src/lib.rs#L3387-L3541) and a preceding-header assertion in [`services/outbound-worker/src/main.rs`](file:///f:/Codex/byos-email/services/outbound-worker/src/main.rs#L7691). All HPKE (`RFC 9180`), X-Wing, ML-KEM, AES-256-GCM envelope/attachment v2, Ed25519, BIP39/Argon2id recovery, database migrations, and active `byos` PostgreSQL data remained untouched.

---

## 1. What Was Built

The RFC 6376 DKIM signer and verifier in [`packages/crypto-core/src/lib.rs`](file:///f:/Codex/byos-email/packages/crypto-core/src/lib.rs#L1296-L1895) were rewritten to operate on raw RFC 5322 byte slices instead of lossy UTF-8 string lines:

- **Header extraction and unfolding (`unfold_raw_headers_bytes`, `split_dkim_header_body`):** Splits headers from body at the earliest `\r\n\r\n` or `\n\n` boundary (`L1303-L1318`) and groups folded continuation lines (`SP`/`HTAB`) with their parent header field (`L1322-L1354`) rather than splitting via `.lines()`.
- **Relaxed header canonicalization (`relaxed_header_canonicalize_bytes`, `relaxed_header_canonicalize`):** Lowercases only the trimmed header field name, writes a single `:` separator (eliminating the pre-remediation double `::` defect), unfolds `\r`/`\n`, strips leading and trailing `WSP`, collapses internal `[ \t]+` sequences to a single `0x20` space, preserves all non-UTF-8 bytes in header values verbatim, and omits any extra trailing CRLF (`L1359-L1416`).
- **Relaxed and simple body canonicalization (`relaxed_body_canonicalize`, `simple_body_canonicalize`):** Strips trailing `[ \t]` per line, collapses intra-line `[ \t]+` runs to a single `0x20`, emits uniform CRLF line endings without injecting extra `\n` characters on LF input or non-UTF-8 byte corruption, removes all trailing empty lines, and returns `0` bytes (`SHA-256 = 47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=`) for empty or whitespace-only bodies (`L1424-L1509`).
- **Signing digest and header order (`dkim_sign`):** Selects signed headers from the candidate list bottom-to-top per RFC 6376 §5.4 (`L1802-L1828`), constructs the canonical signing input with `\r\n` between signed headers and **no trailing CRLF** after the unsigned `DKIM-Signature` header (`L1846-L1851`), signs with blinded RSA-SHA256 (`L1854-L1855`), and prepends the completed `DKIM-Signature:` line verbatim above the original message bytes (`L1863-L1867`).
- **Interoperable multi-mode verifier (`verify_dkim_signature`, `verify_single_dkim_header`):** Searches all unfolded headers rather than line `0` so messages with prepended `Authentication-Results:` headers succeed directly (`L1874-L1894`), parses tag-values across folded FWS (`parse_dkim_signature_tags`, `L1512-L1541`), empties only the `b=` tag while preserving surrounding semicolon/WSP layout (`strip_b_tag_preserving_layout`, `L1545-L1577`), enforces `v=1` and `a=rsa-sha256`, supports `relaxed`/`simple` header and body modes (`parse_canon_modes`, `L1599-L1619`), selects headers using RFC 6376 §5.4 bottom-up occurrence matching (`L1725-L1748`), and performs PKCS#1 v1.5 SHA-256 verification without appending a trailing CRLF (`L1750-L1760`).

---

## 2. Files Edited

| File | Reason |
|---|---|
| [`packages/crypto-core/src/lib.rs`](file:///f:/Codex/byos-email/packages/crypto-core/src/lib.rs) | Implemented RFC 6376 DKIM canonicalization, signing, and multi-mode verification across the four approved DKIM functions plus byte-safe helpers and five unit tests |
| [`services/outbound-worker/src/main.rs`](file:///f:/Codex/byos-email/services/outbound-worker/src/main.rs) | Added direct assertion verifying full SMTP DATA including preceding `Authentication-Results:` in existing Release B integration test (`L7691`) |
| [`docs/dkim_canonicalization_remediation_proposal.md`](file:///f:/Codex/byos-email/docs/dkim_canonicalization_remediation_proposal.md) | Updated document status header and approval checklist linking to this implementation report |
| [`docs/dkim_canonicalization_implementation_report.md`](file:///f:/Codex/byos-email/docs/dkim_canonicalization_implementation_report.md) | Documented code changes, before/after byte comparisons, regression suite outputs, and bidirectional independent verifier results |

*(Other modified and untracked files shown in `git status --short` pre-existed from earlier releases and were preserved untouched.)*

---

## 3. Before-and-After Canonicalization & Digest Comparison

1. **Relaxed header canonicalization (RFC 6376 §3.4.2 vector `"B : Y\t\r\n\tZ  "`):**
   - **Pre-remediation behavior:** Split with `.lines()` (dropping multi-line unfolding) and re-formatted `"{}:{}"` after a header name slice that retained `':'`, producing double colon `"b::Y\t\r\n\tZ  "` with uncollapsed folding and trailing whitespace.
   - **Post-remediation output ([`packages/crypto-core/src/lib.rs#L3389-L3390`](file:///f:/Codex/byos-email/packages/crypto-core/src/lib.rs#L3389-L3390)):** `"b:Y Z"` (`"A: X"` -> `"a:X"`, `"X-Empty : \t \r\n\t "` -> `"x-empty:"`).
2. **Relaxed body canonicalization (RFC 6376 §3.4.5 vectors):**
   - **Empty / blank-only bodies (`""`, `"\r\n"`, `"\r\n\r\n"`, `"   \t\r\n\r\n"`):** Pre-remediation logic returned non-empty newline bytes on `\r\n` inputs; post-remediation output returns `0` bytes (`SHA-256 = 47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=`).
   - **Body `" C \r\nD \t E\r\n\r\n\r\n"`:** Returns `" C\r\nD E\r\n"`; `"Hello"` (no trailing newline) returns `"Hello\r\n"`.
3. **Signature digest terminator:**
   - **Pre-remediation behavior:** `dkim_sign` appended `\r\n` after the canonicalized `DKIM-Signature` header (`L1458` previously).
   - **Post-remediation behavior (`L1846-L1851`):** Canonicalized `DKIM-Signature:` is appended last with zero trailing `\r\n` per RFC 6376 §3.7.
4. **Historical pre-remediation captured wire sample ([`scratch/captured_inline_wire.eml`](file:///f:/Codex/byos-email/scratch/captured_inline_wire.eml)):**
   - Pre-fix `bh=` in wire capture: `xNNo0iow9zT1ZPbjI9tlK/hJoI4hjpPhdDnopIYufGw=`
   - RFC 6376 relaxed `bh=`: `RfkIz1dvIeLXw5vZXqD2p23CLDxAioYy5DlItEboXiI=`
   - Both [`scratch/verify_dkim_rfc6376.mjs`](file:///f:/Codex/byos-email/scratch/verify_dkim_rfc6376.mjs) and remediated `byos_crypto_core::verify_dkim_signature` reject this historical malformed signature (`false`).

---

## 4. Independent Bidirectional Interoperability Evidence

**Harness:** Isolated Node runner with `mailauth` `8.0.6` (installed transiently in `scratch/tmp_mailauth`), ephemeral `rspamd/rspamd:latest` (`Rspamd 4.1.5` running an in-container Perl UDP DNS responder bound on `127.0.0.1:53` serving `byos._domainkey.byos.local` TXT), [`scratch/verify_dkim_rfc6376.mjs`](file:///f:/Codex/byos-email/scratch/verify_dkim_rfc6376.mjs), and a Rust binary wrapper (`byos_crypto_core::dkim_sign` / `verify_dkim_signature` + `smtp_dot_stuff_body` simulation). No production configuration, DNS zones, or `Cargo.toml` manifests were modified.

Command executed (`exit code 0`):
```powershell
node scratch/run_dkim_interop.mjs
```

Raw terminal summary output:
```text
header subject is intended to be unique by email standards, but we have 2 headers of this type, artificially break DKIM check
header subject is intended to be unique by email standards, but we have 2 headers of this type, artificially break DKIM check
got empty text part
RFC vectors ok: true (4)
Direction 1 wire/byos/node/mailauth all valid: true (10/10)
Direction 1 Rspamd R_DKIM_ALLOW (all valid RFC5322 msgs): true (9/10; case2 dup-Subject=R_DKIM_REJECT)
Direction 2 all matched: true (36/36)
```

Note on `case2_folded_repeated_wsp`: that synthetic fixture intentionally places two `Subject:` headers in a single message to test RFC 6376 §5.4 bottom-up repeated-header matching. `byos_crypto_core`, [`scratch/verify_dkim_rfc6376.mjs`](file:///f:/Codex/byos-email/scratch/verify_dkim_rfc6376.mjs), and `mailauth` `8.0.6` (across all four `c=` canonicalization combinations in both directions) accept `case2_folded_repeated_wsp`. `Rspamd` `4.1.5` enforces an RFC 5322 single-`Subject` anti-spoofing rule (logged above: `"header subject is intended to be unique by email standards, but we have 2 headers of this type, artificially break DKIM check"`), intentionally yielding `R_DKIM_REJECT` in Direction 1 and signing an intentionally broken signature in Direction 2 (which `byos_crypto_core::verify_dkim_signature` also rejects). Valid RFC 5322 folded headers (`case2b_folded_rfc5322`) achieve `R_DKIM_ALLOW` (`score: -0.2`, `DKIM_TRACE: byos.local:+`) in Rspamd as well as `dkim=pass` in `mailauth`.

Raw JSON result output (`scratch/dkim_interop_results.json`):
```json
{
  "rfcVectorChecks": [
    {
      "name": "Header RFC6376 §3.4.2 A",
      "ok": true
    },
    {
      "name": "Header RFC6376 §3.4.2 B",
      "ok": true
    },
    {
      "name": "Body empty SHA-256 relaxed",
      "ok": true
    },
    {
      "name": "Body empty SHA-256 simple",
      "ok": true
    }
  ],
  "historicalPreFixWireSample": {
    "file": "scratch/captured_inline_wire.eml",
    "nodeBodyHashMatch": false,
    "expectedBhInPreFixWire": "xNNo0iow9zT1ZPbjI9tlK/hJoI4hjpPhdDnopIYufGw=",
    "rfc6376Bh": "RfkIz1dvIeLXw5vZXqD2p23CLDxAioYy5DlItEboXiI=",
    "note": "Captured before DKIM remediation; remains rejected cleanly by RFC 6376 verifiers and remediated verify_dkim_signature."
  },
  "direction1_ByosSigned_WireUnstuffed_To_AllVerifiers": [
    {
      "id": "case1_ordinary_plain_crlf",
      "wireRoundtripExact": true,
      "byosSelfVerifyOk": true,
      "nodeRfc6376Valid": true,
      "nodeBodyHashMatch": true,
      "nodeSigValid": true,
      "mailauthResult": "pass",
      "mailauthInfo": "dkim=pass header.i=@byos.local header.s=byos header.a=rsa-sha256 header.b=Rq3MUfNK",
      "rspamdR_DKIM_ALLOW": true,
      "rspamdDkimSymbol": {
        "name": "R_DKIM_ALLOW",
        "score": -0.2,
        "metric_score": -0.2,
        "description": "DKIM verification succeed",
        "options": [
          "byos.local:s=byos"
        ]
      }
    },
    {
      "id": "case2_folded_repeated_wsp",
      "wireRoundtripExact": true,
      "byosSelfVerifyOk": true,
      "nodeRfc6376Valid": true,
      "nodeBodyHashMatch": true,
      "nodeSigValid": true,
      "mailauthResult": "pass",
      "mailauthInfo": "dkim=pass header.i=@byos.local header.s=byos header.a=rsa-sha256 header.b=\"s+/DpjqH\"",
      "rspamdR_DKIM_ALLOW": false,
      "rspamdDkimSymbol": {
        "name": "R_DKIM_REJECT",
        "score": 1,
        "metric_score": 1,
        "description": "DKIM verification failed",
        "options": [
          "byos.local:s=byos"
        ]
      }
    },
    {
      "id": "case2b_folded_rfc5322",
      "wireRoundtripExact": true,
      "byosSelfVerifyOk": true,
      "nodeRfc6376Valid": true,
      "nodeBodyHashMatch": true,
      "nodeSigValid": true,
      "mailauthResult": "pass",
      "mailauthInfo": "dkim=pass header.i=@byos.local header.s=byos header.a=rsa-sha256 header.b=HosoczWZ",
      "rspamdR_DKIM_ALLOW": true,
      "rspamdDkimSymbol": {
        "name": "R_DKIM_ALLOW",
        "score": -0.2,
        "metric_score": -0.2,
        "description": "DKIM verification succeed",
        "options": [
          "byos.local:s=byos"
        ]
      }
    },
    {
      "id": "case3_multiline_wsp_trailing_empty",
      "wireRoundtripExact": true,
      "byosSelfVerifyOk": true,
      "nodeRfc6376Valid": true,
      "nodeBodyHashMatch": true,
      "nodeSigValid": true,
      "mailauthResult": "pass",
      "mailauthInfo": "dkim=pass header.i=@byos.local header.s=byos header.a=rsa-sha256 header.b=nzOnKnsq",
      "rspamdR_DKIM_ALLOW": true,
      "rspamdDkimSymbol": {
        "name": "R_DKIM_ALLOW",
        "score": -0.2,
        "metric_score": -0.2,
        "description": "DKIM verification succeed",
        "options": [
          "byos.local:s=byos"
        ]
      }
    },
    {
      "id": "case4_empty_body_zero",
      "wireRoundtripExact": true,
      "byosSelfVerifyOk": true,
      "nodeRfc6376Valid": true,
      "nodeBodyHashMatch": true,
      "nodeSigValid": true,
      "mailauthResult": "pass",
      "mailauthInfo": "dkim=pass header.i=@byos.local header.s=byos header.a=rsa-sha256 header.b=HA3BgKC8",
      "rspamdR_DKIM_ALLOW": true,
      "rspamdDkimSymbol": {
        "name": "R_DKIM_ALLOW",
        "score": -0.2,
        "metric_score": -0.2,
        "description": "DKIM verification succeed",
        "options": [
          "byos.local:s=byos"
        ]
      }
    },
    {
      "id": "case5_empty_body_crlf",
      "wireRoundtripExact": true,
      "byosSelfVerifyOk": true,
      "nodeRfc6376Valid": true,
      "nodeBodyHashMatch": true,
      "nodeSigValid": true,
      "mailauthResult": "pass",
      "mailauthInfo": "dkim=pass header.i=@byos.local header.s=byos header.a=rsa-sha256 header.b=G3+A5rvJ",
      "rspamdR_DKIM_ALLOW": true,
      "rspamdDkimSymbol": {
        "name": "R_DKIM_ALLOW",
        "score": -0.2,
        "metric_score": -0.2,
        "description": "DKIM verification succeed",
        "options": [
          "byos.local:s=byos"
        ]
      }
    },
    {
      "id": "case6_ordinary_no_final_newline",
      "wireRoundtripExact": true,
      "byosSelfVerifyOk": true,
      "nodeRfc6376Valid": true,
      "nodeBodyHashMatch": true,
      "nodeSigValid": true,
      "mailauthResult": "pass",
      "mailauthInfo": "dkim=pass header.i=@byos.local header.s=byos header.a=rsa-sha256 header.b=QwsEx9qp",
      "rspamdR_DKIM_ALLOW": true,
      "rspamdDkimSymbol": {
        "name": "R_DKIM_ALLOW",
        "score": -0.2,
        "metric_score": -0.2,
        "description": "DKIM verification succeed",
        "options": [
          "byos.local:s=byos"
        ]
      }
    },
    {
      "id": "case7_ordinary_multipart_alternative",
      "wireRoundtripExact": true,
      "byosSelfVerifyOk": true,
      "nodeRfc6376Valid": true,
      "nodeBodyHashMatch": true,
      "nodeSigValid": true,
      "mailauthResult": "pass",
      "mailauthInfo": "dkim=pass header.i=@byos.local header.s=byos header.a=rsa-sha256 header.b=hqzpVqNy",
      "rspamdR_DKIM_ALLOW": true,
      "rspamdDkimSymbol": {
        "name": "R_DKIM_ALLOW",
        "score": -0.2,
        "metric_score": -0.2,
        "description": "DKIM verification succeed",
        "options": [
          "byos.local:s=byos"
        ]
      }
    },
    {
      "id": "case8_multipart_mixed_nested_inline_auth_results",
      "wireRoundtripExact": true,
      "byosSelfVerifyOk": true,
      "nodeRfc6376Valid": true,
      "nodeBodyHashMatch": true,
      "nodeSigValid": true,
      "mailauthResult": "pass",
      "mailauthInfo": "dkim=pass header.i=@byos.local header.s=byos header.a=rsa-sha256 header.b=BzfWGko6",
      "rspamdR_DKIM_ALLOW": true,
      "rspamdDkimSymbol": {
        "name": "R_DKIM_ALLOW",
        "score": -0.2,
        "metric_score": -0.2,
        "description": "DKIM verification succeed",
        "options": [
          "byos.local:s=byos"
        ]
      }
    },
    {
      "id": "case9_smtp_dot_stuffed_and_auth_results",
      "wireRoundtripExact": true,
      "byosSelfVerifyOk": true,
      "nodeRfc6376Valid": true,
      "nodeBodyHashMatch": true,
      "nodeSigValid": true,
      "mailauthResult": "pass",
      "mailauthInfo": "dkim=pass header.i=@byos.local header.s=byos header.a=rsa-sha256 header.b=\"B48RIe/B\"",
      "rspamdR_DKIM_ALLOW": true,
      "rspamdDkimSymbol": {
        "name": "R_DKIM_ALLOW",
        "score": -0.2,
        "metric_score": -0.2,
        "description": "DKIM verification succeed",
        "options": [
          "byos.local:s=byos"
        ]
      }
    }
  ],
  "direction2_ExternalSigned_To_ByosVerify": [
    {
      "label": "Rspamd 4.1.5 (relaxed/relaxed) -> BYOS [case1_ordinary_plain_crlf]",
      "expected": true,
      "byos_verified": true,
      "matched": true
    },
    {
      "label": "Rspamd 4.1.5 + Authentication-Results -> BYOS [case1_ordinary_plain_crlf]",
      "expected": true,
      "byos_verified": true,
      "matched": true
    },
    {
      "label": "mailauth 8.0.6 (relaxed/relaxed) -> BYOS [case1_ordinary_plain_crlf]",
      "expected": true,
      "byos_verified": true,
      "matched": true
    },
    {
      "label": "mailauth 8.0.6 (simple/relaxed) -> BYOS [case1_ordinary_plain_crlf]",
      "expected": true,
      "byos_verified": true,
      "matched": true
    },
    {
      "label": "mailauth 8.0.6 (relaxed/simple) -> BYOS [case1_ordinary_plain_crlf]",
      "expected": true,
      "byos_verified": true,
      "matched": true
    },
    {
      "label": "mailauth 8.0.6 (simple/simple) -> BYOS [case1_ordinary_plain_crlf]",
      "expected": true,
      "byos_verified": true,
      "matched": true
    },
    {
      "label": "Negative (Rspamd RFC5322 dup-Subject broken sig) -> BYOS rejects [case2_folded_repeated_wsp]",
      "expected": false,
      "byos_verified": false,
      "matched": true
    },
    {
      "label": "Negative (Rspamd RFC5322 dup-Subject broken sig) + Auth-Results -> BYOS rejects [case2_folded_repeated_wsp]",
      "expected": false,
      "byos_verified": false,
      "matched": true
    },
    {
      "label": "mailauth 8.0.6 (relaxed/relaxed) -> BYOS [case2_folded_repeated_wsp]",
      "expected": true,
      "byos_verified": true,
      "matched": true
    },
    {
      "label": "mailauth 8.0.6 (simple/relaxed) -> BYOS [case2_folded_repeated_wsp]",
      "expected": true,
      "byos_verified": true,
      "matched": true
    },
    {
      "label": "mailauth 8.0.6 (relaxed/simple) -> BYOS [case2_folded_repeated_wsp]",
      "expected": true,
      "byos_verified": true,
      "matched": true
    },
    {
      "label": "mailauth 8.0.6 (simple/simple) -> BYOS [case2_folded_repeated_wsp]",
      "expected": true,
      "byos_verified": true,
      "matched": true
    },
    {
      "label": "Rspamd 4.1.5 (relaxed/relaxed) -> BYOS [case2b_folded_rfc5322]",
      "expected": true,
      "byos_verified": true,
      "matched": true
    },
    {
      "label": "Rspamd 4.1.5 + Authentication-Results -> BYOS [case2b_folded_rfc5322]",
      "expected": true,
      "byos_verified": true,
      "matched": true
    },
    {
      "label": "mailauth 8.0.6 (relaxed/relaxed) -> BYOS [case2b_folded_rfc5322]",
      "expected": true,
      "byos_verified": true,
      "matched": true
    },
    {
      "label": "Rspamd 4.1.5 (relaxed/relaxed) -> BYOS [case3_multiline_wsp_trailing_empty]",
      "expected": true,
      "byos_verified": true,
      "matched": true
    },
    {
      "label": "Rspamd 4.1.5 + Authentication-Results -> BYOS [case3_multiline_wsp_trailing_empty]",
      "expected": true,
      "byos_verified": true,
      "matched": true
    },
    {
      "label": "mailauth 8.0.6 (relaxed/relaxed) -> BYOS [case3_multiline_wsp_trailing_empty]",
      "expected": true,
      "byos_verified": true,
      "matched": true
    },
    {
      "label": "Rspamd 4.1.5 (relaxed/relaxed) -> BYOS [case4_empty_body_zero]",
      "expected": true,
      "byos_verified": true,
      "matched": true
    },
    {
      "label": "Rspamd 4.1.5 + Authentication-Results -> BYOS [case4_empty_body_zero]",
      "expected": true,
      "byos_verified": true,
      "matched": true
    },
    {
      "label": "mailauth 8.0.6 (relaxed/relaxed) -> BYOS [case4_empty_body_zero]",
      "expected": true,
      "byos_verified": true,
      "matched": true
    },
    {
      "label": "Rspamd 4.1.5 (relaxed/relaxed) -> BYOS [case6_ordinary_no_final_newline]",
      "expected": true,
      "byos_verified": true,
      "matched": true
    },
    {
      "label": "Rspamd 4.1.5 + Authentication-Results -> BYOS [case6_ordinary_no_final_newline]",
      "expected": true,
      "byos_verified": true,
      "matched": true
    },
    {
      "label": "mailauth 8.0.6 (relaxed/relaxed) -> BYOS [case6_ordinary_no_final_newline]",
      "expected": true,
      "byos_verified": true,
      "matched": true
    },
    {
      "label": "Rspamd 4.1.5 (relaxed/relaxed) -> BYOS [case7_ordinary_multipart_alternative]",
      "expected": true,
      "byos_verified": true,
      "matched": true
    },
    {
      "label": "Rspamd 4.1.5 + Authentication-Results -> BYOS [case7_ordinary_multipart_alternative]",
      "expected": true,
      "byos_verified": true,
      "matched": true
    },
    {
      "label": "mailauth 8.0.6 (relaxed/relaxed) -> BYOS [case7_ordinary_multipart_alternative]",
      "expected": true,
      "byos_verified": true,
      "matched": true
    },
    {
      "label": "Rspamd 4.1.5 (relaxed/relaxed) -> BYOS [case8_multipart_mixed_nested_inline_auth_results]",
      "expected": true,
      "byos_verified": true,
      "matched": true
    },
    {
      "label": "Rspamd 4.1.5 + Authentication-Results -> BYOS [case8_multipart_mixed_nested_inline_auth_results]",
      "expected": true,
      "byos_verified": true,
      "matched": true
    },
    {
      "label": "mailauth 8.0.6 (relaxed/relaxed) -> BYOS [case8_multipart_mixed_nested_inline_auth_results]",
      "expected": true,
      "byos_verified": true,
      "matched": true
    },
    {
      "label": "Rspamd 4.1.5 (relaxed/relaxed) -> BYOS [case9_smtp_dot_stuffed_and_auth_results]",
      "expected": true,
      "byos_verified": true,
      "matched": true
    },
    {
      "label": "Rspamd 4.1.5 + Authentication-Results -> BYOS [case9_smtp_dot_stuffed_and_auth_results]",
      "expected": true,
      "byos_verified": true,
      "matched": true
    },
    {
      "label": "mailauth 8.0.6 (relaxed/relaxed) -> BYOS [case9_smtp_dot_stuffed_and_auth_results]",
      "expected": true,
      "byos_verified": true,
      "matched": true
    },
    {
      "label": "Negative: Rspamd tampered body -> BYOS rejects",
      "expected": false,
      "byos_verified": false,
      "matched": true
    },
    {
      "label": "Negative: Rspamd valid msg with wrong BYOS key -> BYOS rejects",
      "expected": false,
      "byos_verified": false,
      "matched": true
    },
    {
      "label": "Negative: Historical pre-fix captured_inline_wire.eml -> BYOS rejects",
      "expected": false,
      "byos_verified": false,
      "matched": true
    }
  ]
}
```

---

## 5. Raw Regression Test Suite Outputs

### 5.1 `byos-crypto-core` Full Test Suite

Command executed (`exit code 0`):
```powershell
docker run --rm -v "${PWD}:/workspace" -v byos-cargo-cache:/cargo-cache -v relb_rust_target:/tmp/target -e CARGO_HOME=/cargo-cache -e CARGO_TARGET_DIR=/tmp/target rustlang/rust:nightly-slim bash -c 'export PATH="/usr/local/cargo/bin:$PATH"; cd /workspace/packages/crypto-core && cargo test --offline'
```

Raw output:
```text
warning: profiles for the non root package will be ignored, specify profiles at the workspace root:
package:   /workspace/crypto-core/Cargo.toml
workspace: /workspace/Cargo.toml
warning: profiles for the non root package will be ignored, specify profiles at the workspace root:
package:   /workspace/packages/crypto-core/Cargo.toml
workspace: /workspace/Cargo.toml
warning: packages/crypto-core/Cargo.toml: file `/workspace/packages/crypto-core/src/bin/native-crypto-worker.rs` found to be present in multiple build targets:
  * `bin` target `byos-native-crypto-worker`
  * `bin` target `native-crypto-worker`
warning: `byos-crypto-core` (manifest) generated 1 warning
   Compiling byos-crypto-core v0.1.0 (/workspace/packages/crypto-core)
    Finished `test` profile [unoptimized + debuginfo] target(s) in 5.28s
warning: the following packages contain code that will be rejected by a future version of Rust: rand_core v0.4.2
note: to see what the problems were, use the option `--future-incompat-report`, or run `cargo report future-incompatibilities --id 3`
     Running unittests src/lib.rs (/tmp/target/debug/build/byos-crypto-core/39b2e10dfc5833d6/out/byos_crypto_core-39b2e10dfc5833d6)

running 51 tests
test tests::test_aes_gcm_envelope_format ... ok
test tests::test_aes_gcm_with_nonce_wrong_aad_fails ... ok
test tests::test_aes_gcm_roundtrip ... ok
test tests::test_aes_gcm_with_nonce_roundtrip ... ok
test tests::test_aes_gcm_with_nonce_wrong_key_fails ... ok
test tests::test_aes_gcm_wrong_aad_fails ... ok
test tests::test_aes_gcm_wrong_key_fails ... ok
test tests::test_attachment_v2_golden_test_vectors ... ok
test tests::test_build_envelope_aad_layout ... ok
test tests::test_canonical_aad ... ok
test tests::test_canonical_aad_immutable ... ok
test tests::test_canonical_bundle_hash ... ok
test tests::test_canonical_bundle_hash_changes_on_wrapper_rotation ... ok
test tests::test_canonical_bundle_hash_deterministic ... ok
test tests::test_decrypt_outbound_invalid_format ... ok
test tests::test_derive_root_secret ... ok
test tests::test_derive_root_secret_deterministic ... ok
test tests::test_derive_search_key ... ok
test tests::test_dkim_rfc6376_body_canonicalization_vectors_and_crlf ... ok
test tests::test_attachment_v2_hpke_wrap_unwrap_and_tamper_rejection ... ok
test tests::test_dkim_rfc6376_header_canonicalization_and_wsp ... ok
test tests::test_dkim_body_hash_changes ... ok
test tests::test_dkim_key_generation ... ok
test tests::test_dkim_sign_blinded_positive_still_verifies ... ok
test tests::test_dkim_ordinary_multipart_and_nested_inline_cid_mime ... ok
test tests::test_hpke_content_key_roundtrip ... ok
test tests::test_hpke_rejects_wrong_private_key ... ok
test tests::test_hpke_wrapped_roundtrip ... ok
test tests::test_mnemonic_roundtrip ... ok
test tests::test_recovery_auth_pk_is_public_not_seed ... ok
test tests::test_recovery_auth_sign_verify_negative ... ok
test tests::test_dkim_verify_fails_on_header_tamper ... ok
test tests::test_dkim_private_key_not_in_ciphertext ... ok
test tests::test_dkim_folded_repeated_headers_and_bottom_up_matching ... ok
test tests::test_wasm_canonical_aad_wire_shape ... ok
test tests::test_wasm_derive_search_key_logic ... ok
test tests::test_webmail_client_decrypt_chain ... ok
test tests::test_wrap_unwrap_mailbox_key ... ok
test tests::test_x25519_dh ... ok
test tests::test_x25519_keypair ... ok
test tests::test_dkim_verify_fails_on_body_tamper ... ok
test tests::test_dkim_sign_contains_fields ... ok
test tests::test_dkim_verify_fails_wrong_key ... ok
test tests::test_dkim_sign_negative_invalid_pem_and_tamper_blocked ... ok
test tests::test_dkim_wrong_dek_fails ... ok
test tests::test_recovery_principal_kdf_params_frozen ... ok
test tests::test_dkim_encrypt_decrypt_roundtrip ... ok
test tests::test_recovery_principal_passphrase_roundtrip ... ok
test tests::test_dkim_auth_results_preceding_multiple_sigs_and_non_utf8 ... ok
test tests::test_recovery_principal_passphrase_negative ... ok
test tests::test_dkim_verify_valid ... ok

test result: ok. 51 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 17.20s

     Running unittests src/bin/crypto-client.rs (/tmp/target/debug/build/byos-crypto-core/41031a3a9fee9bdc/out/byos_crypto_client-41031a3a9fee9bdc)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

     Running unittests src/bin/crypto-worker.rs (/tmp/target/debug/build/byos-crypto-core/ecba1c490e4edd1d/out/byos_crypto_worker-ecba1c490e4edd1d)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

     Running unittests src/bin/native-crypto-worker.rs (/tmp/target/debug/build/byos-crypto-core/38e632bef803153d/out/byos_native_crypto_worker-38e632bef803153d)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

     Running unittests src/bin/native-crypto-worker.rs (/tmp/target/debug/build/byos-crypto-core/c5ba128f553c3280/out/native_crypto_worker-c5ba128f553c3280)

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s

     Running unittests src/bin/seed_test_mailboxes.rs (/tmp/target/debug/build/byos-crypto-core/5cb9d7ba275c58d3/out/seed_test_mailboxes-5cb9d7ba275c58d3)

running 1 test
test tests::hash_format_matches_server_expectation ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 2.26s

     Running tests/ed25519_signing.rs (/tmp/target/debug/build/byos-crypto-core/849ba990f5b1650e/out/ed25519_signing-849ba990f5b1650e)

running 9 tests
test test_derivation_different_epochs ... ok
test test_derivation_deterministic ... ok
test test_derivation_different_mailboxes ... ok
test test_verify_fails_tampered_ciphertext ... ok
test test_verify_fails_tampered_aad ... ok
test test_sign_verify_round_trip ... ok
test test_verify_fails_tampered_signature ... ok
test test_verify_fails_wrong_public_key ... ok
test test_cross_language_vectors ... ok

test result: ok. 9 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.06s

     Running tests/seed_tool_roundtrip.rs (/tmp/target/debug/build/byos-crypto-core/b863ff2505c7bfe8/out/seed_tool_roundtrip-b863ff2505c7bfe8)

running 1 test
test seed_tool_produces_unwrappable_payload ... ok

test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 14.39s

     Running tests/signing_seed.rs (/tmp/target/debug/build/byos-crypto-core/1e4d7a8a7a91237f/out/signing_seed-1e4d7a8a7a91237f)

running 8 tests
test test_rfc_8032_vector ... ok
test test_derive_different_mailbox ... ok
test test_derive_signing_seed_deterministic ... ok
test test_derive_different_epoch ... ok
test test_round_trip_wrap_unwrap ... ok
test test_sign_and_verify_with_seed ... ok
test test_tamper_ciphertext ... ok
test test_tamper_aad ... ok

test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s

     Running tests/worker_dispatch.rs (/tmp/target/debug/build/byos-crypto-core/28060a3fbeff2bae/out/worker_dispatch-28060a3fbeff2bae)

running 4 tests
test test_dispatch_invalid_xwing_key_length ... ok
test test_dispatch_x25519_path ... ok
test test_dispatch_xwing_path ... ok
test test_dispatch_round_trip_xwing ... ok

test result: ok. 4 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.02s

     Running tests/xwing_envelope.rs (/tmp/target/debug/build/byos-crypto-core/c40063b3dd82923b/out/xwing_envelope-c40063b3dd82923b)

running 20 tests
test test_envelope_canonical_form ... ok
test test_seal_xwing_envelope_signed_different_sender_fails_verify ... ok
test test_envelope_round_trip ... ok
test test_envelope_tamper_nonce ... ok
test test_envelope_tamper_ciphertext ... ok
test test_envelope_tamper_key_id ... ok
test test_envelope_tamper_enc ... ok
test test_envelope_tamper_key_epoch ... ok
test test_seal_xwing_envelope_signed_empty_seed_rejected ... ok
test test_envelope_wrong_recipient ... ok
test test_envelope_empty_plaintext ... ok
test test_seal_xwing_envelope_signed_wrong_recipient_key_length_rejected ... ok
test test_wasm_build_envelope_aad_matches_direct ... ok
test test_cross_language_signed_vector ... ok
test test_seal_xwing_envelope_signed_wrong_seed_length_rejected ... ok
test test_seal_xwing_envelope_signed_empty_plaintext ... ok
test test_seal_xwing_envelope_signed_tamper_ciphertext ... ok
test test_seal_xwing_envelope_signed_wrong_recipient ... ok
test test_seal_xwing_envelope_signed_round_trip ... ok
test test_envelope_1mb_plaintext ... ok

test result: ok. 20 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.73s

     Running tests/xwing_seed.rs (/tmp/target/debug/build/byos-crypto-core/46a696bc4fd372c9/out/xwing_seed-46a696bc4fd372c9)

running 8 tests
test test_derive_xwing_seed_different_epoch ... ok
test test_derive_xwing_seed_deterministic ... ok
test test_derive_xwing_seed_different_mailbox ... ok
test test_derive_xwing_seed_different_root ... ok
test test_xwing_seed_wrap_tamper_fails ... ok
test test_xwing_seed_wrap_unwrap_roundtrip ... ok
test test_derive_xwing_seed_domain_separation ... ok
test test_xwing_public_key_from_seed_length ... ok

test result: ok. 8 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.01s

     Running tests/xwing_storage.rs (/tmp/target/debug/build/byos-crypto-core/9b00be76b006ad1c/out/xwing_storage-9b00be76b006ad1c)

running 2 tests
test xwing_storage_round_trip ... ok
test xwing_cross_language_vectors_match ... ok

test result: ok. 2 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.07s

   Doc-tests byos_crypto_core

running 0 tests

test result: ok. 0 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.00s
```

### 5.2 `byos-outbound-worker` Full 60-Test Suite (Isolated Disposable Postgres `relb-dkim-pg`)

Command executed against disposable `byos_dkim_test` container (`exit code 0`; active `byos` DB untouched):
```powershell
docker run --rm --network relb-dkim-net -v "${PWD}:/workspace" -v byos-cargo-cache:/cargo-cache -v relb_rust_target:/tmp/target -e CARGO_HOME=/cargo-cache -e CARGO_TARGET_DIR=/tmp/target -e OUTBOUND_TEST_ADMIN_PG_URL="postgres://pgadmin@relb-dkim-pg:5432/byos_dkim_test" -e OUTBOUND_TEST_PG_URL="postgres://outbound_worker_login@relb-dkim-pg:5432/byos_dkim_test" rustlang/rust:nightly-slim bash -c 'export PATH="/usr/local/cargo/bin:$PATH"; cd /workspace/services/outbound-worker && cargo test --offline -- --test-threads=1'
```

Raw output:
```text
running 60 tests
test attachments::tests::test_fetch_auth_401_403_and_future_key_epoch_are_retryable ... ok
test attachments::tests::test_fetch_interrupted_retrieval_and_incomplete_object_and_corrupt_decryption ... ok
test attachments::tests::test_fetch_rejects_negative_outbox_seq ... ok
test attachments::tests::test_keyring_rotation_epochs ... ok
test attachments::tests::test_mime_bcc_stripped_before_assembly_and_dkim_verifies ... ok
test attachments::tests::test_mime_crlf_line_endings_base64_wrap_and_injection_blocked ... ok
test attachments::tests::test_mime_html_only_with_attachment_and_dkim ... ok
test attachments::tests::test_mime_mixed_single_and_multiple_attachments_roundtrip ... ok
test attachments::tests::test_mime_size_limit_and_cid_sanitization ... ok
test attachments::tests::test_mime_spaces_special_chars_and_unicode_filenames ... ok
test attachments::tests::test_mime_text_only_and_html_only_and_alternative ... ok
test attachments::tests::test_mime_unicode_filename_and_zero_byte_and_inline_cid ... ok
test pg_tests::test_pg_active_lease_blocks_second_worker_and_reclaims_only_after_expiry ... ok
test pg_tests::test_pg_concurrent_workers_claim_disjoint_rows_and_deliver_once ... ok
test pg_tests::test_pg_data_streaming_fence_reclaim_reaper_and_post_terminator_outcomes ... ok
test pg_tests::test_pg_expired_pending_and_scheduled_reaper ... ok
test pg_tests::test_pg_least_privilege_rbac_enforced ... ok
test pg_tests::test_pg_long_running_delivery_renews_lease_and_blocks_concurrent_steal ... ok
test pg_tests::test_pg_partial_rcpt_abort_and_ambiguous_post_data_never_auto_resend ... ok
test pg_tests::test_pg_release_b_interrupted_retrieval_and_performance_metrics ... ok
test pg_tests::test_pg_release_b_least_privilege_rbac_and_e2e_attachments_25mib_and_failures ... ok
test pg_tests::test_pg_scheduled_promotion_concurrency_is_idempotent ... ok
test pg_tests::test_pg_stale_lease_token_rejected_across_all_fenced_mutations_and_idempotent_completion ... ok
test pg_tests::test_pg_temp_450_perm_550_max_attempts_and_decrypt_retry_log_accuracy ... ok
test tests::test_classify_smtp_status_code_matrix ... ok
test tests::test_completion_does_not_retry_on_4xx ... ok
test tests::test_completion_retries_on_5xx ... ok
test tests::test_compute_retry_backoff_bounded ... ok
test tests::test_dkim_identity_is_single_at_domain ... ok
test tests::test_dkim_sign_sanitized_message_matches_clean_body_and_excludes_bcc ... ok
test tests::test_end_to_end_rust_smtp_delivery_captures_individual_rcpts_and_no_bcc_in_data ... ok
test tests::test_parse_and_validate_recipients ... ok
test tests::test_partial_rcpt_permanent_rejection_aborts_data_and_bounces_queue ... ok
test tests::test_partial_rcpt_temporary_450_aborts_data_and_retries_without_duplicates ... ok
test tests::test_phased_smtp_post_data_disconnect_and_timeout_return_ambiguous ... ok
test tests::test_phased_smtp_stale_lease_aborts_before_sending_data_body ... ok
test tests::test_smtp_classification_for_bare_4xx_and_5xx_table ... ok
test tests::test_smtp_connection_and_no_response_failures_retry_safely ... ok
test tests::test_smtp_dot_stuffing_edge_cases_empty_crlf_and_leading_dots ... ok
test tests::test_smtp_enhanced_status_codes_and_non_override_over_wire ... ok
test tests::test_strip_bcc_as_last_header_before_delimiter ... ok
test tests::test_strip_bcc_mixed_case_and_multiple_headers_and_obs_space ... ok
test tests::test_strip_bcc_multiple_recipients_and_folded ... ok
test tests::test_strip_bcc_preserves_literal_bcc_in_body ... ok
test tests::test_strip_bcc_preserves_non_bcc_headers_and_folded_to_cc ... ok
test tests::test_strip_bcc_single_to_no_bcc ... ok
test tests::test_strip_bcc_to_cc_bcc ... ok
test tests::test_wire_data_mode_body_commands_not_interpreted_and_no_rset_quit ... ok
test tests::test_wire_db_error_at_terminator_fence_aborts_without_marker_and_body_write_drop_fails_streaming ... ok
test tests::test_wire_dkim_preserved_bytes_after_dot_unstuffing ... ok
test tests::test_wire_dot_stuffing_and_clean_250_delivery ... ok
test tests::test_wire_ehlo_line0_and_greeting_timeout_and_data_non_354 ... ok
test tests::test_wire_incomplete_smtp_server_responses ... ok
test tests::test_wire_malformed_and_oversized_smtp_replies ... ok
test tests::test_wire_multiline_ehlo_and_capability_negotiation ... ok
test tests::test_wire_phased_client_preserves_a1_4xx_5xx_classification ... ok
test tests::test_wire_plaintext_boundary_no_tls_handshake_or_starttls ... ok
test tests::test_wire_smtp_command_timeouts ... ok
test tests::test_wire_stale_during_chunked_streaming_closes_without_terminator_or_commands ... ok
test tests::test_wire_stale_immediately_after_354_drops_socket_without_rset_quit_or_dot ... ok

test result: ok. 60 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 67.49s
```

### 5.3 Go API DKIM, Domain DNS & Recipient Tests

Command executed (`exit code 0`):
```powershell
Push-Location services/api ; go test -count=1 -v -run "TestGenerateDKIM|TestGenerateVerificationToken|TestBuildExpectedDNSRecords|TestVerifyDomain|TestValidateRecipients|TestOutboundMessage" .
```

Raw output:
```text
=== RUN   TestGenerateDKIMKeypair
--- PASS: TestGenerateDKIMKeypair (0.06s)
=== RUN   TestGenerateVerificationToken
--- PASS: TestGenerateVerificationToken (0.00s)
=== RUN   TestBuildExpectedDNSRecords
--- PASS: TestBuildExpectedDNSRecords (0.00s)
=== RUN   TestVerifyDomainDNSBypass
--- PASS: TestVerifyDomainDNSBypass (0.00s)
=== RUN   TestOutboundMessageDKIMHeaderFormat
=== RUN   TestOutboundMessageDKIMHeaderFormat/Real_mailbox_sender
=== RUN   TestOutboundMessageDKIMHeaderFormat/Masked_alias_sender
=== NAME  TestOutboundMessageDKIMHeaderFormat
    outbound_dkim_test.go:55: Mailpit not reachable, skipping live message header check: Get "http://localhost:8025/api/v1/messages": dial tcp [::1]:8025: connectex: No connection could be made because the target machine actively refused it.
--- PASS: TestOutboundMessageDKIMHeaderFormat (0.01s)
    --- PASS: TestOutboundMessageDKIMHeaderFormat/Real_mailbox_sender (0.00s)
    --- PASS: TestOutboundMessageDKIMHeaderFormat/Masked_alias_sender (0.00s)
=== RUN   TestValidateRecipients_ValidSingle
--- PASS: TestValidateRecipients_ValidSingle (0.00s)
=== RUN   TestValidateRecipients_ValidMultiple
--- PASS: TestValidateRecipients_ValidMultiple (0.00s)
=== RUN   TestValidateRecipients_HeaderInjectionRejected
--- PASS: TestValidateRecipients_HeaderInjectionRejected (0.00s)
=== RUN   TestValidateRecipients_MaxCeilingEnforced
--- PASS: TestValidateRecipients_MaxCeilingEnforced (0.00s)
=== RUN   TestValidateRecipients_MalformedRejected
--- PASS: TestValidateRecipients_MalformedRejected (0.00s)
PASS
ok  	byos.email/services/api	0.235s
```

### 5.4 Webmail Crypto & Client Suite

Command executed (`exit code 0`):
```powershell
Push-Location apps/webmail ; npx.cmd tsx --experimental-wasm-modules src/run_test.node.js
```

Raw tail output:
```text
ATTACHMENT CRYPTO TESTS: 22 passed, 0 failed
...
TRACK 4 RESILIENCE TESTS: 7 passed, 0 failed
...
SUBSCRIPTIONS & UNSUBSCRIBE STORE TESTS: 4 passed, 0 failed
IMAGE PRIVACY STORE TESTS: 4 passed, 0 failed
KASHCAL PARSER TESTS: 6 passed, 0 failed
TRANSLATOR & LOCALIZATION TESTS: 15 passed, 0 failed
FOLDER & TRASH TESTS: 9 passed, 0 failed

OVERALL: 707 passed, 0 failed
```

---

## 6. Compatibility Considerations, Limitations & Unverified Items

- **No backward-compatibility fallback for broken double-colon signatures:** `verify_dkim_signature` intentionally rejects legacy signatures created by the pre-remediation BYOS implementation (`a=rsa-sha256` with `::` header canonicalization and extra trailing `\r\n`), preventing canonicalization ambiguity.
- **Unimplemented optional RFC 6376 tags:** Neither `dkim_sign` nor `verify_dkim_signature` emits or validates the optional body-length limit (`l=`) tag.
- **Host Mailpit & Vitest component checks:** `TestOutboundMessageDKIMHeaderFormat` sub-skipped its live Mailpit HTTP assertion because Mailpit (`http://localhost:8025`) was not running on the host (the Go unit subtests reported ok overall). Direct host invocation of `npx.cmd vitest run` in `apps/webmail` reported `4 passed` test files and `2 failed` suites (`ComposeDrawer.test.tsx` Vite WASM helper URL error and `kashcalParser.test.ts` empty file) whereas Webmail's primary test runner `tsx --experimental-wasm-modules src/run_test.node.js` succeeded with `707 passed, 0 failed`.
- **Rspamd duplicate-header heuristic:** As documented in Section 4, Rspamd `4.1.5` intentionally rejects duplicate `Subject:` headers even when cryptographically valid per RFC 6376; all valid RFC 5322 single-`Subject` BYOS messages (including folded continuation lines) yield `R_DKIM_ALLOW` in Rspamd.
