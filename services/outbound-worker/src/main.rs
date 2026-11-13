use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use byos_crypto_core::{decrypt_dkim_private_key, decrypt_outbound, dkim_sign, AAD_VERSION, ENCRYPTION_VERSION};
use lettre::{
    address::{Address, Envelope},
    transport::smtp::{
        commands::{Data, Ehlo, Mail, Quit, Rcpt, Rset},
        extension::{ClientId, MailBodyParameter, MailParameter},
        Error as SmtpError,
    },
    SmtpTransport, Transport,
};
use std::{
    collections::HashMap,
    env,
    future::Future,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, OnceLock, RwLock,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    net::TcpStream,
    time::{interval, sleep, timeout, MissedTickBehavior},
};
use tokio_postgres::{Client, NoTls};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

mod attachments;
use attachments::{
    assemble_mime_with_attachments, fetch_and_decrypt_attachments_with_metrics,
    read_process_peak_rss_kib, AttachmentFetchError, AttachmentFetchMetrics, OutboundKeyring,
};

// Rate limit Lua script: atomic check+incr for 6 keys
const RATE_LUA: &str = r#"
local n = #KEYS
local half = n
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
"#;

type RateCache = Arc<RwLock<HashMap<String, HashMap<String, HashMap<String, i32>>>>>;
static RATE_CACHE: OnceLock<RateCache> = OnceLock::new();
fn rate_cache() -> RateCache {
    RATE_CACHE.get_or_init(|| Arc::new(RwLock::new(HashMap::new()))).clone()
}

fn get_limit(plan: &str, scope: &str, window: &str) -> i32 {
    let binding = rate_cache();
    let cache = binding.read().unwrap();
    if let Some(m1) = cache.get(plan) {
        if let Some(m2) = m1.get(scope) {
            if let Some(v) = m2.get(window) {
                return *v;
            }
        }
    }
    if let Some(m1) = cache.get("solo") {
        if let Some(m2) = m1.get(scope) {
            if let Some(v) = m2.get(window) {
                return *v;
            }
        }
    }
    // hard defaults
    match (scope, window) {
        ("mailbox","minute") => 5,
        ("mailbox","hour") => 50,
        ("mailbox","day") => 200,
        ("org","minute") => 10,
        ("org","hour") => 100,
        ("org","day") => 400,
        ("recipients","recipients") => 100,
        _ => 100,
    }
}

async fn load_rate_limits(client: &Client) {
    match client.query("SELECT plan_name, scope, time_window, limit_value FROM rate_limits", &[]).await {
        Ok(rows) => {
            let mut tmp: HashMap<String, HashMap<String, HashMap<String, i32>>> = HashMap::new();
            for row in rows {
                let plan: String = row.get(0);
                let scope: String = row.get(1);
                let window: String = row.get(2);
                let val: i32 = row.get(3);
                tmp.entry(plan).or_insert_with(HashMap::new).entry(scope).or_insert_with(HashMap::new).insert(window, val);
            }
            if !tmp.is_empty() {
                let binding = rate_cache();
                let mut w = binding.write().unwrap();
                *w = tmp;
                info!("rate cache loaded {} plans", w.len());
            }
        }
        Err(e) => warn!("rate cache load failed: {}", e),
    }
}

async fn check_and_incr_rate(
    redis_client: &Option<redis::Client>,
    mailbox_id: &str,
    org_id: &str,
    mailbox_plan: &str,
    org_plan: &str,
) -> (bool, i64, String) {
    let rc = match redis_client {
        Some(c) => c,
        None => return (true, 0, "".to_string()),
    };
    let mut conn = match rc.get_async_connection().await {
        Ok(c) => c,
        Err(e) => {
            warn!("redis connect failed (fail closed): {}", e);
            return (false, 30, "rate limiter unavailable".to_string());
        }
    };
    let now: i64 = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64;
    let minute_w = now / 60;
    let hour_w = now / 3600;
    let day_w = now / 86400;
    let keys = vec![
        format!("rate:mailbox:{}:minute:{}", mailbox_id, minute_w),
        format!("rate:mailbox:{}:hour:{}", mailbox_id, hour_w),
        format!("rate:mailbox:{}:day:{}", mailbox_id, day_w),
        format!("rate:org:{}:minute:{}", org_id, minute_w),
        format!("rate:org:{}:hour:{}", org_id, hour_w),
        format!("rate:org:{}:day:{}", org_id, day_w),
    ];
    let limits = vec![
        get_limit(mailbox_plan, "mailbox", "minute") as i64,
        get_limit(mailbox_plan, "mailbox", "hour") as i64,
        get_limit(mailbox_plan, "mailbox", "day") as i64,
        get_limit(org_plan, "org", "minute") as i64,
        get_limit(org_plan, "org", "hour") as i64,
        get_limit(org_plan, "org", "day") as i64,
    ];
    let ttls = vec![70i64, 3610, 86410, 70, 3610, 86410];
    let mut args: Vec<i64> = Vec::new();
    args.extend(limits.iter().cloned());
    args.extend(ttls.iter().cloned());
    let script = redis::Script::new(RATE_LUA);
    let res: Result<Vec<i64>, _> = script.key(keys.clone()).arg(args.clone()).invoke_async(&mut conn).await;
    match res {
        Ok(v) if !v.is_empty() && v[0] == 1 => (true, 0, "".to_string()),
        Ok(v) if !v.is_empty() && v[0] == 0 => {
            let idx = if v.len() > 1 { v[1] } else { 1 };
            let names = ["mailbox:minute","mailbox:hour","mailbox:day","org:minute","org:hour","org:day"];
            let failed = if idx >=1 && idx <=6 { names[(idx-1) as usize].to_string() } else { "unknown".to_string() };
            let retry = match failed.as_str() {
                "mailbox:minute" | "org:minute" => 60 - (now % 60) + 1,
                "mailbox:hour" | "org:hour" => 3600 - (now % 3600) + 1,
                _ => 86400 - (now % 86400) + 1,
            };
            warn!("rate limit exceeded mailbox {} org {} window {} retry {}", mailbox_id, org_id, failed, retry);
            (false, retry, failed)
        }
        Ok(v) => {
            warn!("rate lua unexpected result {:?}", v);
            (false, 30, "rate limiter invalid response".to_string())
        }
        Err(e) => {
            warn!("rate lua error (fail closed): {}", e);
            (false, 30, "rate limiter script error".to_string())
        }
    }
}

fn count_recipients(plaintext: &[u8]) -> usize {
    // Try mailparse
    if let Ok(parsed) = mailparse::parse_mail(plaintext) {
        let mut count = 0;
        for hdr in parsed.headers.iter() {
            let key = hdr.get_key().to_ascii_lowercase();
            if key == "to" || key == "cc" || key == "bcc" {
                let val = hdr.get_value();
                // Count addresses by splitting on ',' and checking for '@'
                for part in val.split(',') {
                    if part.trim().contains('@') {
                        count += 1;
                    }
                }
            }
        }
        // Fallback: also check if count is 0, try simple scan
        if count > 0 {
            return count;
        }
    }
    // Fallback simple scan
    let text = String::from_utf8_lossy(plaintext);
    let mut cnt = 0;
    for line in text.lines() {
        let lower = line.to_ascii_lowercase();
        if lower.starts_with("to:") || lower.starts_with("cc:") || lower.starts_with("bcc:") {
            if let Some(colon) = line.find(':') {
                let rest = &line[colon+1..];
                for part in rest.split(',') {
                    if part.trim().contains('@') { cnt += 1; }
                }
                // Handle folded headers? For V1 simple, assume single line.
            }
        }
    }
    // If still 0, assume 1 recipient (the envelope recipient)
    if cnt == 0 { 1 } else { cnt }
}

fn extract_from_header(plaintext: &[u8]) -> (Option<String>, Option<String>) {
    if let Ok(parsed) = mailparse::parse_mail(plaintext) {
        for hdr in parsed.headers.iter() {
            if hdr.get_key().eq_ignore_ascii_case("from") {
                let val = hdr.get_value();
                let addr = if let Some(start) = val.find('<') {
                    if let Some(end) = val[start + 1..].find('>') {
                        val[start + 1..start + 1 + end].trim().to_string()
                    } else {
                        val.trim().to_string()
                    }
                } else {
                    val.trim().to_string()
                };
                if let Some(at) = addr.rfind('@') {
                    let domain = addr[at + 1..].trim().to_ascii_lowercase();
                    return (Some(addr), Some(domain));
                }
            }
        }
    }
    let text = String::from_utf8_lossy(plaintext);
    for line in text.lines() {
        if line.to_ascii_lowercase().starts_with("from:") {
            if let Some(colon) = line.find(':') {
                let rest = line[colon + 1..].trim();
                let addr = if let Some(start) = rest.find('<') {
                    if let Some(end) = rest[start + 1..].find('>') {
                        rest[start + 1..start + 1 + end].trim().to_string()
                    } else {
                        rest.to_string()
                    }
                } else {
                    rest.to_string()
                };
                if let Some(at) = addr.rfind('@') {
                    let domain = addr[at + 1..].trim().to_ascii_lowercase();
                    return (Some(addr), Some(domain));
                }
            }
        }
    }
    (None, None)
}

/// Strips all Bcc: headers (case-insensitive, including folded continuation lines)
/// from the RFC 5322 header section prior to the first blank-line boundary.
/// Preserves legitimate headers, folded lines of non-Bcc headers, delimiter, and body content exactly.
pub fn strip_bcc_headers(raw: &[u8]) -> Vec<u8> {
    let (header_bytes, delimiter, body_bytes) = if raw.starts_with(b"\r\n") {
        (&[][..], &b"\r\n"[..], &raw[2..])
    } else if raw.starts_with(b"\n") {
        (&[][..], &b"\n"[..], &raw[1..])
    } else {
        let crlf_idx = raw.windows(4).position(|w| w == b"\r\n\r\n");
        let lf_idx = raw.windows(2).position(|w| w == b"\n\n");
        match (crlf_idx, lf_idx) {
            (Some(c_pos), Some(l_pos)) if c_pos <= l_pos => {
                (&raw[..c_pos + 2], &b"\r\n"[..], &raw[c_pos + 4..])
            }
            (Some(c_pos), None) => {
                (&raw[..c_pos + 2], &b"\r\n"[..], &raw[c_pos + 4..])
            }
            (_, Some(l_pos)) => {
                (&raw[..l_pos + 1], &b"\n"[..], &raw[l_pos + 2..])
            }
            _ => (raw, &[][..], &[][..]),
        }
    };

    let mut sanitized_headers = Vec::with_capacity(header_bytes.len());
    let mut skipping_bcc = false;
    let mut cursor = 0;

    while cursor < header_bytes.len() {
        let (line_with_ending, next_cursor) = match header_bytes[cursor..].iter().position(|&b| b == b'\n') {
            Some(nl_pos) => (&header_bytes[cursor..=cursor + nl_pos], cursor + nl_pos + 1),
            None => (&header_bytes[cursor..], header_bytes.len()),
        };

        let is_continuation = matches!(line_with_ending.first(), Some(&b' ') | Some(&b'\t'));

        if is_continuation {
            if skipping_bcc {
                cursor = next_cursor;
                continue;
            }
            sanitized_headers.extend_from_slice(line_with_ending);
        } else {
            let is_bcc = if let Some(colon_pos) = line_with_ending.iter().position(|&b| b == b':') {
                let raw_name = &line_with_ending[..colon_pos];
                let mut start = 0;
                while start < raw_name.len() && raw_name[start].is_ascii_whitespace() {
                    start += 1;
                }
                let mut end = raw_name.len();
                while end > start && raw_name[end - 1].is_ascii_whitespace() {
                    end -= 1;
                }
                raw_name[start..end].eq_ignore_ascii_case(b"bcc")
            } else {
                false
            };

            if is_bcc {
                skipping_bcc = true;
                cursor = next_cursor;
                continue;
            }
            skipping_bcc = false;
            sanitized_headers.extend_from_slice(line_with_ending);
        }

        cursor = next_cursor;
    }

    let mut out = Vec::with_capacity(sanitized_headers.len() + delimiter.len() + body_bytes.len());
    out.extend_from_slice(&sanitized_headers);
    out.extend_from_slice(delimiter);
    out.extend_from_slice(body_bytes);
    out
}

fn split_recipient_tokens(input: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    let mut in_quotes = false;
    let mut escape = false;
    let mut start = 0;
    for (idx, ch) in input.char_indices() {
        if escape {
            escape = false;
            continue;
        }
        if ch == '\\' && in_quotes {
            escape = true;
            continue;
        }
        if ch == '"' {
            in_quotes = !in_quotes;
            continue;
        }
        if !in_quotes && (ch == ',' || ch == ';') {
            parts.push(&input[start..idx]);
            start = idx + ch.len_utf8();
        }
    }
    parts.push(&input[start..]);
    parts
}

/// Parses a comma- or semicolon-delimited recipient string (respecting quoted display names),
/// trims surrounding whitespace, validates address syntax via Lettre's Address/Mailbox parser
/// and domain dot requirements, and deduplicates addresses (case-insensitive) while preserving order.
pub fn parse_and_validate_recipients(recipient_str: &str) -> Result<Vec<Address>, String> {
    if recipient_str.contains('\r') || recipient_str.contains('\n') || recipient_str.contains('\0') {
        return Err("recipient string contains invalid control characters".to_string());
    }

    let mut addrs: Vec<Address> = Vec::new();
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    for part in split_recipient_tokens(recipient_str) {
        let trimmed = part.trim();
        if trimmed.is_empty() {
            continue;
        }
        let parsed: Address = match trimmed.parse::<Address>() {
            Ok(a) => a,
            Err(_) => trimmed
                .parse::<lettre::message::Mailbox>()
                .map(|mb| mb.email)
                .map_err(|e| format!("invalid recipient syntax ({})", e))?,
        };
        let domain = parsed.domain();
        if parsed.user().is_empty() || domain.len() < 3 || !domain.contains('.') {
            return Err(format!("invalid recipient email domain: {}", trimmed));
        }
        let canonical = parsed.to_string().to_ascii_lowercase();
        if seen.insert(canonical) {
            addrs.push(parsed);
        }
    }

    if addrs.is_empty() {
        return Err("recipient list is empty".to_string());
    }

    Ok(addrs)
}

/// Assembles the final RFC 5322 message passed to SMTP DATA after DKIM signing.
pub fn assemble_final_message(domain_name: &str, dkim_selector: &str, signed_sanitized: &[u8]) -> Vec<u8> {
    let auth_results_hdr = format!(
        "Authentication-Results: byos.local; dkim=pass (2048-bit key) header.d={} header.i=@{} header.s={}\r\n",
        domain_name, domain_name, dkim_selector
    );
    let mut final_message = Vec::with_capacity(auth_results_hdr.len() + signed_sanitized.len());
    final_message.extend_from_slice(auth_results_hdr.as_bytes());
    final_message.extend_from_slice(signed_sanitized);
    final_message
}

/// Structural retry classification for an SMTP delivery failure.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SmtpFailureClass {
    /// Temporary condition (`4xx` reply or connection/network failure without a `5xx` reply); keep row `pending` and retry.
    Temporary,
    /// Permanent SMTP `5xx` rejection; bounce row and notify scheduled state.
    Permanent,
}

/// Structured SMTP failure retaining `lettre`'s parsed reply status code rather than string matching.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SmtpDeliveryError {
    pub smtp_code: Option<u16>,
    pub class: SmtpFailureClass,
    pub message: String,
}

impl SmtpDeliveryError {
    /// Returns `true` when delivery should stay queued for retry rather than bounce permanently.
    pub fn is_temporary(&self) -> bool {
        self.class == SmtpFailureClass::Temporary
    }
}

impl std::fmt::Display for SmtpDeliveryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}

/// Classifies a primary 3-digit SMTP reply code (or `None` when no server reply was received).
///
/// Primary `4xx` codes are temporary and `5xx` codes are permanent regardless of enhanced status
/// codes (`4.2.0`, `5.1.1`) or diagnostic text. Errors without a server reply default to temporary
/// retry so transient connection or transport faults never cause false permanent bounces.
pub fn classify_smtp_status_code(smtp_code: Option<u16>) -> SmtpFailureClass {
    match smtp_code {
        Some(code) if (400..=499).contains(&code) => SmtpFailureClass::Temporary,
        Some(code) if (500..=599).contains(&code) => SmtpFailureClass::Permanent,
        _ => SmtpFailureClass::Temporary,
    }
}

/// Extracts `lettre`'s structural SMTP status code and classifies the error without string heuristics.
pub fn classify_smtp_error(err: &SmtpError) -> SmtpDeliveryError {
    let smtp_code = err.status().map(u16::from);
    let class = match smtp_code {
        Some(code) => classify_smtp_status_code(Some(code)),
        None if err.is_permanent() => SmtpFailureClass::Permanent,
        None if err.is_transient() => SmtpFailureClass::Temporary,
        None => SmtpFailureClass::Temporary,
    };
    SmtpDeliveryError {
        smtp_code,
        class,
        message: err.to_string(),
    }
}

/// Delivers a finalized RFC 5322 message to Postfix / SMTP relay using an explicit SMTP envelope.
pub fn deliver_raw_to_smtp(
    postfix_addr: &str,
    envelope: &Envelope,
    final_message: &[u8],
) -> std::result::Result<(), SmtpDeliveryError> {
    deliver_raw_to_smtp_with_timeout(
        postfix_addr,
        envelope,
        final_message,
        Some(Duration::from_secs(60)),
    )
}

/// Delivers a finalized RFC 5322 message using an explicit SMTP socket timeout.
pub fn deliver_raw_to_smtp_with_timeout(
    postfix_addr: &str,
    envelope: &Envelope,
    final_message: &[u8],
    timeout: Option<Duration>,
) -> std::result::Result<(), SmtpDeliveryError> {
    let (postfix_host, postfix_port) = parse_postfix_addr(postfix_addr);
    let mailer = SmtpTransport::builder_dangerous(postfix_host)
        .port(postfix_port)
        .timeout(timeout)
        .build();
    mailer
        .send_raw(envelope, final_message)
        .map(|_| ())
        .map_err(|e| classify_smtp_error(&e))
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();

    let sk = load_outbound_sk().context("load OUTBOUND_DELIVERY_SK")?;
    info!("outbound-worker loaded SK ({} bytes)", sk.len());

    let dkim_dek = load_dkim_dek().context("load BYOS_DKIM_DEK")?;
    info!("outbound-worker loaded DKIM DEK ({} bytes)", dkim_dek.len());

    let pg_url = build_pg_url().context("build pg url")?;
    let postfix_addr = env::var("POSTFIX_ADDR").unwrap_or_else(|_| "postfix:25".into());
    let poll_ms: u64 = env::var("POLL_INTERVAL_MS").ok().and_then(|s| s.parse().ok()).unwrap_or(5000);
    let redis_addr = env::var("REDIS_ADDR").or_else(|_| env::var("REDIS_URL")).unwrap_or_else(|_| "redis:6379".into());
    let redis_url = if redis_addr.starts_with("redis://") { redis_addr } else { format!("redis://{}", redis_addr) };
    let redis_client = match redis::Client::open(redis_url.clone()) {
        Ok(c) => {
            // test connection
            match c.get_async_connection().await {
                Ok(mut conn) => {
                    let _: Result<String, _> = redis::cmd("PING").query_async(&mut conn).await;
                    info!("redis connected {}", redis_url);
                    Some(c)
                }
                Err(e) => {
                    warn!("redis connect fail {}: {}", redis_url, e);
                    None
                }
            }
        }
        Err(e) => {
            warn!("redis client open fail {}: {}", redis_url, e);
            None
        }
    };

    let (mut client, connection) = tokio_postgres::connect(&pg_url, NoTls).await.context("connect pg")?;
    tokio::spawn(async move {
        if let Err(e) = connection.await {
            error!("pg connection error: {}", e);
        }
    });

    // Load rate limits cache
    load_rate_limits(&client).await;
    // Refresh every 5m via separate connection
    let pg_url_clone = pg_url.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(300));
        loop {
            interval.tick().await;
            if let Ok((rc, conn)) = tokio_postgres::connect(&pg_url_clone, NoTls).await {
                tokio::spawn(async move {
                    if let Err(e) = conn.await { tracing::warn!("refresh pg conn error: {}", e); }
                });
                load_rate_limits(&rc).await;
            }
        }
    });

    // Verify least privilege: cannot access restricted tables (should fail)
    verify_least_privilege(&client).await;
    verify_queue_lease_schema(&client).await;

    let api_addr = env::var("BYOS_API_ADDR").unwrap_or_else(|_| "api:8080".into());
    let lease_config = LeaseConfig::from_env();
    info!(
        "outbound-worker polling every {}ms, postfix={}, redis={}, api={}, lease_owner={}, lease_ttl={}s, renew_interval={}s",
        poll_ms,
        postfix_addr,
        redis_url,
        api_addr,
        lease_config.lease_owner,
        lease_config.lease_ttl.as_secs(),
        lease_config.renew_interval.as_secs()
    );
    info!("scheduled poller: filtering WHERE is_path_a = false");

    // Reconcile delivered-but-pending scheduled messages on startup
    reconcile_delivered_scheduled(&client, &api_addr).await;
    let mut last_reconcile = Instant::now();

    loop {
        if last_reconcile.elapsed() >= Duration::from_secs(300) {
            reconcile_delivered_scheduled(&client, &api_addr).await;
            last_reconcile = Instant::now();
        }
        if let Err(e) = poll_scheduled(&mut client, &api_addr, redis_client.as_ref()).await {
            warn!("scheduled poll error: {}", e);
        }
        if let Err(e) = poll_once_with_config(&mut client, &sk, &dkim_dek, &postfix_addr, &api_addr, redis_client.as_ref(), &lease_config).await {
            warn!("poll error: {}", e);
        }
        sleep(Duration::from_millis(poll_ms)).await;
    }
}

fn load_outbound_sk() -> Result<[u8; 32]> {
    // Prefer secret file, fallback to env
    let b64 = if let Ok(path) = env::var("OUTBOUND_DELIVERY_SK_FILE") {
        std::fs::read_to_string(&path).with_context(|| format!("read {}", path))?
    } else if let Ok(p) = env::var("OUTBOUND_DELIVERY_SK_B64") {
        p
    } else {
        // Try default secret path
        std::fs::read_to_string("/run/secrets/outbound_delivery_sk")
            .context("OUTBOUND_DELIVERY_SK not set and no secret file")?
    };
    let b64 = b64.trim();
    let bytes = BASE64.decode(b64).context("base64 decode SK")?;
    if bytes.len() != 32 {
        anyhow::bail!("SK must be 32 bytes, got {}", bytes.len());
    }
    let mut out = [0u8; 32];
    out.copy_from_slice(&bytes);
    Ok(out)
}

fn load_dkim_dek() -> Result<[u8; 32]> {
    let b64 = if let Ok(path) = env::var("BYOS_DKIM_DEK_FILE") {
        std::fs::read_to_string(&path).with_context(|| format!("read {}", path))?
    } else if let Ok(p) = env::var("BYOS_DKIM_DEK_B64") {
        p
    } else {
        std::fs::read_to_string("/run/secrets/byos_dkim_dek").context("BYOS_DKIM_DEK not set and no secret file")?
    };
    let b64 = b64.trim();
    let bytes = BASE64.decode(b64).context("base64 decode DKIM DEK")?;
    if bytes.len() != 32 {
        anyhow::bail!("DKIM DEK must be 32 bytes, got {}", bytes.len());
    }
    let mut out = [0u8; 32];
    out.copy_from_slice(&bytes);
    Ok(out)
}

fn parse_postfix_addr(addr: &str) -> (String, u16) {
    if let Some((host, port_str)) = addr.rsplit_once(':') {
        if let Ok(port) = port_str.parse::<u16>() {
            // Check host is not empty and does not contain extra colon (IPv6 bracket not needed here)
            if !host.is_empty() && !host.contains(':') {
                return (host.to_string(), port);
            }
        }
    }
    (addr.to_string(), 25)
}

fn build_pg_url() -> Result<String> {
    // Prefer DATABASE_URL, but if OUTBOUND_WORKER_DB_PASSWORD_FILE is set, replace password
    let mut url = env::var("DATABASE_URL").unwrap_or_else(|_| "postgres://outbound_worker_login@postgres:5432/byos".into());
    // If file-based password provided, inject it
    if let Ok(pw_file) = env::var("OUTBOUND_WORKER_DB_PASSWORD_FILE") {
        if let Ok(pw) = std::fs::read_to_string(&pw_file) {
            let pw = pw.trim();
            // Replace password in URL: postgres://user:pass@host/db -> postgres://user:NEW@host/db
            // Simple string replace for dev: if URL contains @, insert password
            if url.contains("@") && !url.contains(&format!(":{}@", pw)) {
                // Parse as postgres://user:old@host -> postgres://user:new@host
                // For simplicity, rebuild: postgres://outbound_worker_login:{pw}@postgres:5432/byos
                url = format!("postgres://outbound_worker_login:{}@postgres:5432/byos", pw);
            }
        }
    }
    // Ensure login role is used (not superuser)
    if !url.contains("outbound_worker_login") && url.contains("byos:") {
        // Keep as is for dev fallback (byos superuser) but warn
        warn!("DATABASE_URL still uses superuser 'byos', expected outbound_worker_login for least privilege");
    }
    Ok(url)
}

async fn verify_least_privilege(client: &Client) {
    let checks = [
        ("root_secrets", "SELECT * FROM root_secrets LIMIT 1"),
        ("message_metadata", "SELECT * FROM message_metadata LIMIT 1"),
        ("device_mailbox_access", "SELECT * FROM device_mailbox_access LIMIT 1"),
        ("storage_connections", "SELECT * FROM storage_connections LIMIT 1"),
    ];
    for (tbl, sql) in checks {
        match client.query_opt(sql, &[]).await {
            Ok(_) => error!("SECURITY VIOLATION: outbound_worker can SELECT {}", tbl),
            Err(e) => {
                let db_msg = e
                    .as_db_error()
                    .map(|d| d.message().to_string())
                    .unwrap_or_else(|| e.to_string());
                if db_msg.contains("permission denied") {
                    info!("least-privilege OK: cannot SELECT {} (denied as expected)", tbl);
                } else {
                    info!("least-privilege check {}: {}", tbl, db_msg);
                }
            }
        }
    }
    // Positive checks: should be able to access outbound tables
    for tbl in ["outbound_queue", "outbound_reservations", "scheduled_messages", "delivery_log", "mailboxes", "domains", "rate_limits", "organizations"] {
        let sql = format!("SELECT 1 FROM {} LIMIT 1", tbl);
        match client.query_opt(&sql, &[]).await {
            Ok(_) => info!("least-privilege OK: can access {}", tbl),
            Err(e) => warn!("least-privilege: cannot access {}: {}", tbl, e),
        }
    }
}

/// Verifies on startup that proposed Release A.2 lease/outcome columns exist before polling.
async fn verify_queue_lease_schema(client: &Client) {
    match client
        .query_opt(
            "SELECT lease_token, lease_expires_at, smtp_phase, last_error FROM outbound_queue LIMIT 0",
            &[],
        )
        .await
    {
        Ok(_) => info!("outbound_queue lease & outcome schema verified"),
        Err(e) => error!(
            "outbound_queue is missing Release A.2 lease columns (apply proposed_069_outbound_queue_lease_and_outcomes.sql): {}",
            e
        ),
    }
}

async fn poll_scheduled(client: &mut Client, api_addr: &str, redis_client: Option<&redis::Client>) -> Result<()> {
    // Always expire past-TTL Path B scheduled rows, even when nothing is ready to promote.
    let _ = client
        .execute(
            "UPDATE scheduled_messages SET status='expired', updated_at=now() WHERE status='pending' AND is_path_a = false AND expires_at <= now()",
            &[],
        )
        .await;

    let has_v2_cols: bool = client
        .query_one(
            "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='outbound_queue' AND column_name='attachment_count')",
            &[],
        )
        .await
        .map(|r| r.get(0))
        .unwrap_or(false);

    // Hold row locks inside a real PostgreSQL transaction across rate checks and promotion.
    let mut deferred_notifications: Vec<(String, &'static str, Option<String>)> = Vec::new();
    {
        let tx = client.transaction().await.context("begin scheduled promotion tx")?;
        let select_sql = if has_v2_cols {
            "SELECT sm.id::text, sm.delivery_id::text, sm.mailbox_id::text, sm.domain_id::text, sm.recipient, sm.encrypted_message, sm.send_token_hpke_wrapped, sm.outbox_seq, sm.encryption_version, sm.aad_version, sm.encryption_iv, sm.reservation_id::text, sm.expires_at, sm.is_path_a, COALESCE(sm.attachment_count, 0), COALESCE(sm.send_token_key_epoch, 1), sm.send_token_key_id FROM scheduled_messages sm WHERE sm.status='pending' AND sm.is_path_a = false AND sm.scheduled_at <= now() AND sm.expires_at > now() AND (sm.retry_after IS NULL OR sm.retry_after <= now()) AND NOT EXISTS (SELECT 1 FROM outbound_queue oq WHERE oq.delivery_id = sm.delivery_id) ORDER BY sm.scheduled_at ASC LIMIT 10 FOR UPDATE SKIP LOCKED"
        } else {
            "SELECT sm.id::text, sm.delivery_id::text, sm.mailbox_id::text, sm.domain_id::text, sm.recipient, sm.encrypted_message, sm.send_token_hpke_wrapped, sm.outbox_seq, sm.encryption_version, sm.aad_version, sm.encryption_iv, sm.reservation_id::text, sm.expires_at, sm.is_path_a FROM scheduled_messages sm WHERE sm.status='pending' AND sm.is_path_a = false AND sm.scheduled_at <= now() AND sm.expires_at > now() AND (sm.retry_after IS NULL OR sm.retry_after <= now()) AND NOT EXISTS (SELECT 1 FROM outbound_queue oq WHERE oq.delivery_id = sm.delivery_id) ORDER BY sm.scheduled_at ASC LIMIT 10 FOR UPDATE SKIP LOCKED"
        };
        let rows = tx
            .query(select_sql, &[])
            .await
            .context("select scheduled pending")?;

        if rows.is_empty() {
            tx.commit().await.context("commit empty scheduled tx")?;
            return Ok(());
        }

        info!("processing {} scheduled", rows.len());

        for row in rows {
            let id: String = row.get(0);
            let delivery_id: String = row.get(1);
            let mailbox_id: String = row.get(2);
            let domain_id: String = row.get(3);
            let recipient: String = row.get(4);
            let encrypted_message: Option<Vec<u8>> = row.get(5);
            let wrapped: Option<Vec<u8>> = row.get(6);
            let outbox_seq: Option<i64> = row.get(7);
            let enc_ver: Option<i32> = row.get(8);
            let aad_ver: Option<i16> = row.get(9);
            let enc_iv: Option<Vec<u8>> = row.get(10);
            let reservation_id: Option<String> = row.get(11);
            let is_path_a: bool = row.get(13);

            if is_path_a {
                warn!("scheduled row {} has is_path_a=true but was fetched by Path B worker — skipping", delivery_id);
                continue;
            }

            let sched_uuid = Uuid::parse_str(&id)?;
            if encrypted_message.is_none() || wrapped.is_none() || outbox_seq.is_none() || enc_ver.is_none() || aad_ver.is_none() || enc_iv.is_none() || reservation_id.is_none() {
                warn!("scheduled row {} missing message payload or V5.3 AAD/reservation, marking failed", delivery_id);
                let _ = tx
                    .execute(
                        "UPDATE scheduled_messages SET status='failed', updated_at=now() WHERE id=$1",
                        &[&sched_uuid],
                    )
                    .await;
                deferred_notifications.push((
                    delivery_id,
                    "failed",
                    Some("missing message payload or V5.3 AAD/reservation".to_string()),
                ));
                continue;
            }

            let encrypted_message = encrypted_message.unwrap();
            let wrapped = wrapped.unwrap();
            let outbox_seq = outbox_seq.unwrap();
            let enc_ver = enc_ver.unwrap();
            let aad_ver = aad_ver.unwrap();
            let enc_iv = enc_iv.unwrap();
            let reservation_id = reservation_id.unwrap();

            let mailbox_uuid = Uuid::parse_str(&mailbox_id)?;
            let (org_id, mailbox_plan, org_plan) = match tx
                .query_opt("SELECT org_id::text FROM mailboxes WHERE id=$1", &[&mailbox_uuid])
                .await
            {
                Ok(Some(r)) => {
                    let oid: String = r.get(0);
                    (oid, "solo".to_string(), "solo".to_string())
                }
                _ => {
                    warn!("rate check: mailbox {} not found, failing closed", mailbox_id);
                    continue;
                }
            };

            if !org_id.is_empty() {
                let rc_opt = redis_client.cloned();
                let (ok, retry, _failed) = check_and_incr_rate(&rc_opt, &mailbox_id, &org_id, &mailbox_plan, &org_plan).await;
                if !ok {
                    let retry_at = SystemTime::now() + Duration::from_secs(retry.max(0) as u64);
                    if let Err(e) = tx
                        .execute(
                            "UPDATE scheduled_messages SET retry_after = $2 WHERE id=$1",
                            &[&sched_uuid, &retry_at],
                        )
                        .await
                    {
                        warn!("scheduled {} retry_after update failed: {:?}", delivery_id, e);
                    }
                    info!("scheduled {} deferred retry_after {}s due to rate limit", delivery_id, retry);
                    continue;
                }
            }

            let delivery_uuid = Uuid::parse_str(&delivery_id)?;
            let domain_uuid = Uuid::parse_str(&domain_id)?;
            let reservation_uuid = Uuid::parse_str(&reservation_id)?;

            let insert_res = if has_v2_cols {
                let att_count: i32 = row.get(14);
                let st_epoch: i32 = row.get(15);
                let st_key_id: Option<String> = row.get(16);
                tx.execute(
                    "INSERT INTO outbound_queue (delivery_id, mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped, outbox_seq, encryption_version, aad_version, encryption_iv, reservation_id, attachment_count, send_token_key_epoch, send_token_key_id, status, next_attempt_at, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'pending', now(), now() + interval '7 days') ON CONFLICT (delivery_id) DO NOTHING",
                    &[&delivery_uuid, &mailbox_uuid, &domain_uuid, &recipient, &encrypted_message, &wrapped, &outbox_seq, &enc_ver, &aad_ver, &enc_iv, &reservation_uuid, &att_count, &st_epoch, &st_key_id],
                )
                .await
            } else {
                tx.execute(
                    "INSERT INTO outbound_queue (delivery_id, mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped, outbox_seq, encryption_version, aad_version, encryption_iv, reservation_id, status, next_attempt_at, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending', now(), now() + interval '7 days') ON CONFLICT (delivery_id) DO NOTHING",
                    &[&delivery_uuid, &mailbox_uuid, &domain_uuid, &recipient, &encrypted_message, &wrapped, &outbox_seq, &enc_ver, &aad_ver, &enc_iv, &reservation_uuid],
                )
                .await
            };

            match insert_res {
                Ok(0) => {
                    info!("scheduled {} already promoted to outbound_queue (idempotent)", delivery_id);
                }
                Ok(_) => {
                    info!("promoted scheduled {} to outbound_queue (seq {})", delivery_id, outbox_seq);
                }
                Err(e) => {
                    let msg = e.to_string();
                    if msg.contains("duplicate key") || msg.contains("23505") {
                        warn!("scheduled promotion conflict {}: {}", delivery_id, msg);
                    } else {
                        warn!("scheduled promotion failed {}: {}", delivery_id, msg);
                        let _ = tx
                            .execute(
                                "UPDATE scheduled_messages SET status='failed', updated_at=now() WHERE id=$1",
                                &[&sched_uuid],
                            )
                            .await;
                        deferred_notifications.push((delivery_id, "failed", Some(msg)));
                    }
                }
            }
        }

        tx.commit().await.context("commit scheduled promotion tx")?;
    }

    for (delivery_id, status, err_msg) in deferred_notifications {
        notify_scheduled_complete(api_addr, &delivery_id, status, err_msg.as_deref()).await;
    }
    Ok(())
}

/// Queue outcome produced after applying an SMTP delivery result to an `outbound_queue` row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum QueueDeliveryDisposition {
    Delivered,
    RetryScheduled {
        smtp_code: Option<u16>,
        message: String,
    },
    Bounced {
        smtp_code: Option<u16>,
        message: String,
    },
}

#[cfg_attr(not(test), allow(dead_code))]
trait OutboundCompletionSink {
    async fn record_delivered(
        &mut self,
        queue_id: Uuid,
        delivery_uuid: Uuid,
        mailbox_uuid: Uuid,
        domain_uuid: Uuid,
        recipient: &str,
    ) -> Result<()>;

    async fn record_retry(&mut self, queue_id: Uuid) -> Result<()>;

    #[allow(clippy::too_many_arguments)]
    async fn record_bounced(
        &mut self,
        queue_id: Uuid,
        delivery_uuid: Uuid,
        mailbox_uuid: Uuid,
        domain_uuid: Uuid,
        recipient: &str,
        smtp_code: Option<u16>,
        message: &str,
    ) -> Result<()>;

    async fn notify_scheduled(&mut self, delivery_id: &str, status: &str, err_msg: Option<&str>);
}

#[cfg_attr(not(test), allow(dead_code))]
#[allow(clippy::too_many_arguments)]
async fn apply_smtp_delivery_outcome<S: OutboundCompletionSink>(
    sink: &mut S,
    queue_id: Uuid,
    delivery_id: &str,
    delivery_uuid: Uuid,
    mailbox_uuid: Uuid,
    delivered_domain_uuid: Uuid,
    bounce_domain_uuid: Uuid,
    recipient: &str,
    postfix_addr: &str,
    domain_name: &str,
    smtp_result: std::result::Result<(), SmtpDeliveryError>,
) -> Result<QueueDeliveryDisposition> {
    match smtp_result {
        Ok(()) => {
            info!(
                "delivered {} to {} via {} (dkim signed for domain {})",
                delivery_id, recipient, postfix_addr, domain_name
            );
            sink.record_delivered(
                queue_id,
                delivery_uuid,
                mailbox_uuid,
                delivered_domain_uuid,
                recipient,
            )
            .await?;
            sink.notify_scheduled(delivery_id, "delivered", None).await;
            Ok(QueueDeliveryDisposition::Delivered)
        }
        Err(err) if err.is_temporary() => {
            sink.record_retry(queue_id).await?;
            warn!(
                "temp fail {} (smtp_code={:?}): {}",
                delivery_id, err.smtp_code, err.message
            );
            Ok(QueueDeliveryDisposition::RetryScheduled {
                smtp_code: err.smtp_code,
                message: err.message,
            })
        }
        Err(err) => {
            sink.record_bounced(
                queue_id,
                delivery_uuid,
                mailbox_uuid,
                bounce_domain_uuid,
                recipient,
                err.smtp_code,
                &err.message,
            )
            .await?;
            warn!(
                "perm fail {} (smtp_code={:?}): {}",
                delivery_id, err.smtp_code, err.message
            );
            sink.notify_scheduled(delivery_id, "failed", Some(&err.message))
                .await;
            Ok(QueueDeliveryDisposition::Bounced {
                smtp_code: err.smtp_code,
                message: err.message,
            })
        }
    }
}

/// Configuration controlling queue lease ownership, renewal cadence, and SMTP timeouts.
#[derive(Debug, Clone)]
pub struct LeaseConfig {
    pub lease_owner: String,
    pub lease_ttl: Duration,
    pub renew_interval: Duration,
    pub smtp_timeout: Duration,
    pub batch_size: i64,
}

impl LeaseConfig {
    pub fn from_env() -> Self {
        let ttl_secs = env::var("OUTBOUND_LEASE_TTL_SECS")
            .ok()
            .and_then(|s| s.parse::<u64>().ok())
            .filter(|&v| v > 0)
            .unwrap_or(120);
        let smtp_timeout_secs = env::var("OUTBOUND_SMTP_TIMEOUT_SECS")
            .ok()
            .and_then(|s| s.parse::<u64>().ok())
            .filter(|&v| v > 0)
            .unwrap_or(60);
        let batch_size = env::var("OUTBOUND_BATCH_SIZE")
            .ok()
            .and_then(|s| s.parse::<i64>().ok())
            .filter(|&v| v > 0)
            .unwrap_or(10);
        let host = env::var("HOSTNAME").unwrap_or_else(|_| "outbound-worker".to_string());
        let owner = format!("{}:{}:{}", host, std::process::id(), Uuid::new_v4().simple());
        let lease_ttl = Duration::from_secs(ttl_secs);
        Self {
            lease_owner: owner,
            lease_ttl,
            renew_interval: Self::default_renew_interval(lease_ttl),
            smtp_timeout: Duration::from_secs(smtp_timeout_secs),
            batch_size,
        }
    }

    pub fn default_renew_interval(lease_ttl: Duration) -> Duration {
        let third = lease_ttl / 3;
        let max_allowed = (lease_ttl / 2).max(Duration::from_millis(10));
        third.max(Duration::from_millis(20)).min(max_allowed)
    }
}

/// Claimed `outbound_queue` entry protected by an active `lease_token`.
#[derive(Debug, Clone)]
pub struct ClaimedOutboundItem {
    pub id: Uuid,
    pub delivery_id: Uuid,
    pub mailbox_id: Uuid,
    pub domain_id: Uuid,
    pub recipient: String,
    pub encrypted_message: Vec<u8>,
    pub wrapped: Vec<u8>,
    pub outbox_seq: Option<i64>,
    pub enc_ver: Option<i32>,
    pub aad_ver: Option<i16>,
    pub attempts: i32,
    pub max_attempts: i32,
    pub lease_token: Uuid,
    pub attachment_count: i32,
    pub send_token_key_epoch: Option<u32>,
    pub send_token_key_id: Option<String>,
}

/// Outcome of a lease-fenced state transition.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LeaseFenceResult<T> {
    Applied(T),
    AlreadySettled,
    StaleLease,
}

/// Persisted SMTP phase within a worker lease.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SmtpPhase {
    Claimed,
    PreData,
    DataStreaming,
    TerminatorInFlight,
    AcceptedByMta,
}

impl SmtpPhase {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Claimed => "claimed",
            Self::PreData => "pre_data",
            Self::DataStreaming => "data_streaming",
            Self::TerminatorInFlight => "terminator_in_flight",
            Self::AcceptedByMta => "accepted_by_mta",
        }
    }
}

/// Wire-phase-aware SMTP transmission outcome distinguishing pre-terminator faults
/// (known unsent / uncommitted) from post-terminator ambiguity.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SmtpDeliveryOutcome {
    Delivered { smtp_code: u16 },
    FailedBeforeData(SmtpDeliveryError),
    FailedDuringDataStreaming(SmtpDeliveryError),
    RejectedAfterTerminator(SmtpDeliveryError),
    AmbiguousAfterTerminator { message: String },
    StaleLeaseAbortedBeforeData,
    StaleLeaseAbortedInDataStreaming,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ReapSummary {
    pub expired_pending: usize,
    pub released_pre_data_leases: usize,
    pub bounced_max_attempt_leases: usize,
    pub expired_processing_leases: usize,
    pub moved_to_outcome_unknown: usize,
    pub preserved_accepted_by_mta: usize,
    pub expired_scheduled: usize,
}

/// Computes bounded exponential retry backoff (60s, 120s, 240s, ... capped at 3600s).
pub fn compute_retry_backoff(next_attempt_number: i32) -> Duration {
    let shift = next_attempt_number.saturating_sub(1).clamp(0, 6) as u32;
    let secs = (60u64.saturating_mul(1u64 << shift)).min(3600);
    Duration::from_secs(secs)
}

fn temp_smtp_err(message: impl Into<String>) -> SmtpDeliveryError {
    SmtpDeliveryError {
        smtp_code: None,
        class: SmtpFailureClass::Temporary,
        message: message.into(),
    }
}

/// Applies RFC 5321 §4.5.2 dot-stuffing to `raw` and selects the minimal `<CRLF>.<CRLF>`
/// end-of-data marker (`.\r\n` if `raw` already ends with `\r\n`, otherwise `\r\n.\r\n`).
pub fn smtp_dot_stuff_body(raw: &[u8]) -> (Vec<u8>, &'static [u8]) {
    #[derive(Copy, Clone, Eq, PartialEq)]
    enum LineState {
        StartOfNewLine,
        AfterCr,
        MiddleOfLine,
    }

    let mut stuffed = Vec::with_capacity(raw.len() + 32);
    let mut state = LineState::StartOfNewLine;
    for &b in raw {
        match (b, state) {
            (b'\r', _) => {
                stuffed.push(b);
                state = LineState::AfterCr;
            }
            (b'\n', LineState::AfterCr) => {
                stuffed.push(b);
                state = LineState::StartOfNewLine;
            }
            (b'.', LineState::StartOfNewLine) => {
                stuffed.push(b'.');
                stuffed.push(b'.');
                state = LineState::MiddleOfLine;
            }
            _ => {
                stuffed.push(b);
                state = LineState::MiddleOfLine;
            }
        }
    }
    let terminator: &'static [u8] = if stuffed.ends_with(b"\r\n") {
        b".\r\n"
    } else {
        b"\r\n.\r\n"
    };
    (stuffed, terminator)
}

#[derive(Debug, Clone)]
struct SmtpWireReply {
    code: u16,
    lines: Vec<String>,
    message: String,
}

#[derive(Debug, Default, Clone, Copy)]
struct EhloCapabilities {
    supports_smtputf8: bool,
    supports_8bitmime: bool,
}

impl EhloCapabilities {
    fn from_lines(lines: &[String]) -> Self {
        let mut caps = Self::default();
        // RFC 5321 §4.1.1.1: line 0 of an EHLO 250 response is always `Domain [ SP ehlo-greet ]`.
        // Capability keywords only appear on subsequent lines.
        for line in lines.iter().skip(1) {
            if let Some(first_word) = line.split_whitespace().next() {
                match first_word.to_ascii_uppercase().as_str() {
                    "SMTPUTF8" => caps.supports_smtputf8 = true,
                    "8BITMIME" => caps.supports_8bitmime = true,
                    _ => {}
                }
            }
        }
        caps
    }
}

async fn read_smtp_reply<R: AsyncBufReadExt + Unpin>(
    reader: &mut R,
) -> std::io::Result<Option<SmtpWireReply>> {
    const MAX_REPLY_LINE_BYTES: usize = 2048;
    const MAX_REPLY_TOTAL_BYTES: usize = 100_000;

    let mut total_bytes = 0usize;
    let mut expected_code: Option<u16> = None;
    let mut text_lines = Vec::new();
    let mut joined = String::new();
    let mut raw_line = Vec::with_capacity(256);

    loop {
        raw_line.clear();
        let n = AsyncReadExt::take(&mut *reader, (MAX_REPLY_LINE_BYTES + 1) as u64)
            .read_until(b'\n', &mut raw_line)
            .await?;
        if n == 0 {
            if text_lines.is_empty() {
                return Ok(None);
            }
            return Err(std::io::Error::new(
                std::io::ErrorKind::UnexpectedEof,
                "truncated multiline SMTP reply",
            ));
        }
        total_bytes += n;
        if n > MAX_REPLY_LINE_BYTES || total_bytes > MAX_REPLY_TOTAL_BYTES {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "SMTP response exceeded size limit",
            ));
        }
        if !raw_line.ends_with(b"\n") {
            return Err(std::io::Error::new(
                std::io::ErrorKind::UnexpectedEof,
                "truncated SMTP reply line before newline",
            ));
        }

        let line = std::str::from_utf8(&raw_line).map_err(|_| {
            std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "SMTP reply line is not valid UTF-8",
            )
        })?;
        let trimmed = line.trim_end_matches(&['\r', '\n'][..]);
        if trimmed.len() < 3 || !trimmed.as_bytes()[..3].iter().all(|b| b.is_ascii_digit()) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("malformed SMTP reply line: {}", trimmed),
            ));
        }
        let code: u16 = trimmed[..3].parse().map_err(|_| {
            std::io::Error::new(std::io::ErrorKind::InvalidData, "invalid SMTP reply code")
        })?;
        if !(200..=599).contains(&code) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("out-of-range SMTP reply code: {}", code),
            ));
        }
        if let Some(prev) = expected_code {
            if prev != code {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "mismatched multiline SMTP reply code",
                ));
            }
        } else {
            expected_code = Some(code);
        }

        let sep = trimmed.as_bytes().get(3).copied();
        if !matches!(sep, Some(b'-') | Some(b' ') | None) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("invalid SMTP reply separator: {}", trimmed),
            ));
        }
        let body_text = if trimmed.len() > 4 {
            trimmed[4..].to_string()
        } else {
            String::new()
        };
        if !joined.is_empty() {
            joined.push('\n');
        }
        joined.push_str(trimmed);
        text_lines.push(body_text);

        if sep != Some(b'-') {
            return Ok(Some(SmtpWireReply {
                code,
                lines: text_lines,
                message: joined,
            }));
        }
    }
}

async fn write_and_flush_all(
    stream: &mut TcpStream,
    data: &[u8],
) -> std::io::Result<()> {
    stream.write_all(data).await?;
    stream.flush().await
}

/// Strictly for SMTP command mode BEFORE `DATA 354` (never called in DATA mode).
async fn close_command_mode_cleanly(mut reader: BufReader<TcpStream>, send_rset: bool) {
    let cleanup_timeout = Duration::from_millis(250);
    if send_rset {
        let rset_cmd = Rset.to_string();
        if timeout(
            cleanup_timeout,
            write_and_flush_all(reader.get_mut(), rset_cmd.as_bytes()),
        )
        .await
        .is_ok_and(|r| r.is_ok())
        {
            let _ = timeout(cleanup_timeout, read_smtp_reply(&mut reader)).await;
        }
    }
    let quit_cmd = Quit.to_string();
    if timeout(
        cleanup_timeout,
        write_and_flush_all(reader.get_mut(), quit_cmd.as_bytes()),
    )
    .await
    .is_ok_and(|r| r.is_ok())
    {
        let _ = timeout(cleanup_timeout, read_smtp_reply(&mut reader)).await;
    }
    drop(reader);
}

fn reply_to_smtp_error(reply: SmtpWireReply) -> SmtpDeliveryError {
    SmtpDeliveryError {
        smtp_code: Some(reply.code),
        class: classify_smtp_status_code(Some(reply.code)),
        message: reply.message,
    }
}

const SMTP_DATA_STREAM_CHUNK_SIZE: usize = 16 * 1024;

/// Delivers an RFC 5322 message over async SMTP with strict RFC 5321 transaction phase fencing:
/// - `on_before_mail`: before `MAIL FROM` (`claimed -> pre_data`), aborting in command mode with `QUIT` if stale
/// - `on_data_streaming`: immediately after `354` from `DATA` (`pre_data -> data_streaming`), aborting by closing TCP without `RSET`/`QUIT`/`.` if stale
/// - Dot-stuffs & streams the full message body and flushes
/// - `on_before_terminator`: durable, lease-fenced transition to `terminator_in_flight` BEFORE sending `\r\n.\r\n` (closes TCP without terminator if stale/failed)
/// - Transmits `\r\n.\r\n` and reads final `2xx` / `4xx` / `5xx` SMTP acceptance response.
#[allow(clippy::too_many_arguments)]
pub async fn deliver_raw_to_smtp_phased_with_timeout<
    FPre,
    FutPre,
    FStream,
    FutStream,
    FTerm,
    FutTerm,
>(
    postfix_addr: &str,
    envelope: &Envelope,
    final_message: &[u8],
    stage_timeout: Option<Duration>,
    on_before_mail: FPre,
    on_data_streaming: FStream,
    on_before_terminator: FTerm,
) -> Result<SmtpDeliveryOutcome>
where
    FPre: FnOnce() -> FutPre,
    FutPre: Future<Output = Result<bool>>,
    FStream: FnOnce() -> FutStream,
    FutStream: Future<Output = Result<bool>>,
    FTerm: FnOnce() -> FutTerm,
    FutTerm: Future<Output = Result<bool>>,
{
    deliver_raw_to_smtp_phased_impl(
        postfix_addr,
        envelope,
        final_message,
        stage_timeout,
        on_before_mail,
        on_data_streaming,
        || async { Ok(()) },
        on_before_terminator,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn deliver_raw_to_smtp_phased_impl<
    FPre,
    FutPre,
    FStream,
    FutStream,
    FMid,
    FutMid,
    FTerm,
    FutTerm,
>(
    postfix_addr: &str,
    envelope: &Envelope,
    final_message: &[u8],
    stage_timeout: Option<Duration>,
    on_before_mail: FPre,
    on_data_streaming: FStream,
    on_mid_stream: FMid,
    on_before_terminator: FTerm,
) -> Result<SmtpDeliveryOutcome>
where
    FPre: FnOnce() -> FutPre,
    FutPre: Future<Output = Result<bool>>,
    FStream: FnOnce() -> FutStream,
    FutStream: Future<Output = Result<bool>>,
    FMid: FnOnce() -> FutMid,
    FutMid: Future<Output = Result<()>>,
    FTerm: FnOnce() -> FutTerm,
    FutTerm: Future<Output = Result<bool>>,
{
    let (postfix_host, postfix_port) = parse_postfix_addr(postfix_addr);
    let io_timeout = stage_timeout.unwrap_or_else(|| Duration::from_secs(60));
    let hello = ClientId::default();

    let stream = match timeout(io_timeout, TcpStream::connect((postfix_host.as_str(), postfix_port))).await {
        Ok(Ok(s)) => s,
        Ok(Err(e)) => {
            return Ok(SmtpDeliveryOutcome::FailedBeforeData(temp_smtp_err(format!(
                "SMTP TCP connect failed: {}",
                e
            ))));
        }
        Err(_) => {
            return Ok(SmtpDeliveryOutcome::FailedBeforeData(temp_smtp_err(
                "SMTP connect timed out",
            )));
        }
    };
    let mut reader = BufReader::new(stream);

    // 1. Server greeting (220)
    match timeout(io_timeout, read_smtp_reply(&mut reader)).await {
        Ok(Ok(Some(reply))) if (200..=299).contains(&reply.code) => {}
        Ok(Ok(Some(reply))) => {
            close_command_mode_cleanly(reader, false).await;
            return Ok(SmtpDeliveryOutcome::FailedBeforeData(reply_to_smtp_error(reply)));
        }
        Ok(Ok(None)) => {
            drop(reader);
            return Ok(SmtpDeliveryOutcome::FailedBeforeData(temp_smtp_err(
                "SMTP connection closed before greeting",
            )));
        }
        Ok(Err(e)) => {
            drop(reader);
            return Ok(SmtpDeliveryOutcome::FailedBeforeData(temp_smtp_err(format!(
                "SMTP greeting read failed: {}",
                e
            ))));
        }
        Err(_) => {
            drop(reader);
            return Ok(SmtpDeliveryOutcome::FailedBeforeData(temp_smtp_err(
                "SMTP greeting timed out",
            )));
        }
    }

    // 2. EHLO
    let ehlo_cmd = Ehlo::new(hello).to_string();
    match timeout(io_timeout, async {
        write_and_flush_all(reader.get_mut(), ehlo_cmd.as_bytes()).await?;
        read_smtp_reply(&mut reader).await
    })
    .await
    {
        Ok(Ok(Some(reply))) if (200..=299).contains(&reply.code) => {
            let caps = EhloCapabilities::from_lines(&reply.lines);
            let has_non_ascii_addresses = envelope.from().is_some_and(|a| !a.to_string().is_ascii())
                || envelope.to().iter().any(|a| !a.to_string().is_ascii());
            let mut mail_options = Vec::new();
            if has_non_ascii_addresses {
                if !caps.supports_smtputf8 {
                    close_command_mode_cleanly(reader, false).await;
                    return Ok(SmtpDeliveryOutcome::FailedBeforeData(SmtpDeliveryError {
                        smtp_code: None,
                        class: SmtpFailureClass::Permanent,
                        message: "Envelope contains non-ascii chars but server does not support SMTPUTF8"
                            .to_string(),
                    }));
                }
                mail_options.push(MailParameter::SmtpUtfEight);
            }
            if !final_message.is_ascii() {
                if !caps.supports_8bitmime {
                    close_command_mode_cleanly(reader, false).await;
                    return Ok(SmtpDeliveryOutcome::FailedBeforeData(SmtpDeliveryError {
                        smtp_code: None,
                        class: SmtpFailureClass::Permanent,
                        message: "Message contains non-ascii chars but server does not support 8BITMIME"
                            .to_string(),
                    }));
                }
                mail_options.push(MailParameter::Body(MailBodyParameter::EightBitMime));
            }

            // 3. Fenced transition: claimed -> pre_data
            match on_before_mail().await {
                Ok(true) => {}
                Ok(false) => {
                    close_command_mode_cleanly(reader, false).await;
                    return Ok(SmtpDeliveryOutcome::StaleLeaseAbortedBeforeData);
                }
                Err(e) => {
                    close_command_mode_cleanly(reader, false).await;
                    return Err(e);
                }
            }

            // 4. MAIL FROM
            let mail_cmd = Mail::new(envelope.from().cloned(), mail_options).to_string();
            match timeout(io_timeout, async {
                write_and_flush_all(reader.get_mut(), mail_cmd.as_bytes()).await?;
                read_smtp_reply(&mut reader).await
            })
            .await
            {
                Ok(Ok(Some(r))) if (200..=299).contains(&r.code) => {}
                Ok(Ok(Some(r))) => {
                    close_command_mode_cleanly(reader, true).await;
                    return Ok(SmtpDeliveryOutcome::FailedBeforeData(reply_to_smtp_error(r)));
                }
                Ok(Ok(None)) => {
                    drop(reader);
                    return Ok(SmtpDeliveryOutcome::FailedBeforeData(temp_smtp_err(
                        "SMTP closed after MAIL FROM",
                    )));
                }
                Ok(Err(e)) => {
                    drop(reader);
                    return Ok(SmtpDeliveryOutcome::FailedBeforeData(temp_smtp_err(format!(
                        "SMTP MAIL FROM failed: {}",
                        e
                    ))));
                }
                Err(_) => {
                    drop(reader);
                    return Ok(SmtpDeliveryOutcome::FailedBeforeData(temp_smtp_err(
                        "SMTP MAIL FROM timed out",
                    )));
                }
            }

            // 5. RCPT TO (all envelope recipients)
            for to_addr in envelope.to() {
                let rcpt_cmd = Rcpt::new(to_addr.clone(), vec![]).to_string();
                match timeout(io_timeout, async {
                    write_and_flush_all(reader.get_mut(), rcpt_cmd.as_bytes()).await?;
                    read_smtp_reply(&mut reader).await
                })
                .await
                {
                    Ok(Ok(Some(r))) if (200..=299).contains(&r.code) => {}
                    Ok(Ok(Some(r))) => {
                        close_command_mode_cleanly(reader, true).await;
                        return Ok(SmtpDeliveryOutcome::FailedBeforeData(reply_to_smtp_error(r)));
                    }
                    Ok(Ok(None)) => {
                        drop(reader);
                        return Ok(SmtpDeliveryOutcome::FailedBeforeData(temp_smtp_err(
                            "SMTP closed after RCPT TO",
                        )));
                    }
                    Ok(Err(e)) => {
                        drop(reader);
                        return Ok(SmtpDeliveryOutcome::FailedBeforeData(temp_smtp_err(format!(
                            "SMTP RCPT TO failed: {}",
                            e
                        ))));
                    }
                    Err(_) => {
                        drop(reader);
                        return Ok(SmtpDeliveryOutcome::FailedBeforeData(temp_smtp_err(
                            "SMTP RCPT TO timed out",
                        )));
                    }
                }
            }

            // 6. DATA command (still command mode until 354)
            let data_cmd = Data.to_string();
            match timeout(io_timeout, async {
                write_and_flush_all(reader.get_mut(), data_cmd.as_bytes()).await?;
                read_smtp_reply(&mut reader).await
            })
            .await
            {
                Ok(Ok(Some(r))) if r.code == 354 => {}
                Ok(Ok(Some(r))) => {
                    close_command_mode_cleanly(reader, true).await;
                    let err = if (400..=599).contains(&r.code) {
                        reply_to_smtp_error(r)
                    } else {
                        temp_smtp_err(format!("unexpected reply to DATA: {}", r.message))
                    };
                    return Ok(SmtpDeliveryOutcome::FailedBeforeData(err));
                }
                Ok(Ok(None)) => {
                    drop(reader);
                    return Ok(SmtpDeliveryOutcome::FailedBeforeData(temp_smtp_err(
                        "SMTP closed before 354 DATA acceptance",
                    )));
                }
                Ok(Err(e)) => {
                    drop(reader);
                    return Ok(SmtpDeliveryOutcome::FailedBeforeData(temp_smtp_err(format!(
                        "SMTP DATA command failed: {}",
                        e
                    ))));
                }
                Err(_) => {
                    drop(reader);
                    return Ok(SmtpDeliveryOutcome::FailedBeforeData(temp_smtp_err(
                        "SMTP DATA command timed out",
                    )));
                }
            }

            // =========================================================================
            // 7. ENTERED SMTP DATA MODE (`354`).
            // RFC 5321: NEVER send `RSET` or `QUIT` on this connection while in DATA mode.
            // Aborts MUST close the TCP socket without attempting the end-of-data marker.
            // =========================================================================
            match on_data_streaming().await {
                Ok(true) => {}
                Ok(false) => {
                    drop(reader);
                    return Ok(SmtpDeliveryOutcome::StaleLeaseAbortedInDataStreaming);
                }
                Err(e) => {
                    drop(reader);
                    return Err(e);
                }
            }

            // 8. Transmit MIME body with RFC 5321 dot-stuffing (NO terminator yet).
            let (stuffed_body, terminator) = smtp_dot_stuff_body(final_message);
            let stream_res = timeout(io_timeout, async {
                let mut offset = 0usize;
                let total = stuffed_body.len();
                let mid_point = total / 2;
                let mut mid_hook = Some(on_mid_stream);
                while offset < total {
                    let end = (offset + SMTP_DATA_STREAM_CHUNK_SIZE).min(total);
                    reader.get_mut().write_all(&stuffed_body[offset..end]).await?;
                    offset = end;
                    if offset >= mid_point {
                        if let Some(hook) = mid_hook.take() {
                            reader.get_mut().flush().await?;
                            if let Err(e) = hook().await {
                                return Err(std::io::Error::new(std::io::ErrorKind::Other, e.to_string()));
                            }
                        }
                    }
                }
                if let Some(hook) = mid_hook.take() {
                    if let Err(e) = hook().await {
                        return Err(std::io::Error::new(std::io::ErrorKind::Other, e.to_string()));
                    }
                }
                reader.get_mut().flush().await
            })
            .await;

            match stream_res {
                Ok(Ok(())) => {}
                Ok(Err(e)) => {
                    drop(reader);
                    return Ok(SmtpDeliveryOutcome::FailedDuringDataStreaming(temp_smtp_err(
                        format!("SMTP body streaming failed before terminator: {}", e),
                    )));
                }
                Err(_) => {
                    drop(reader);
                    return Ok(SmtpDeliveryOutcome::FailedDuringDataStreaming(temp_smtp_err(
                        "SMTP body streaming timed out before terminator",
                    )));
                }
            }

            // 9. Atomic lease-fenced transition to `terminator_in_flight` BEFORE sending marker.
            match on_before_terminator().await {
                Ok(true) => {}
                Ok(false) => {
                    // Close socket immediately WITHOUT sending terminator, RSET, or QUIT.
                    drop(reader);
                    return Ok(SmtpDeliveryOutcome::StaleLeaseAbortedInDataStreaming);
                }
                Err(e) => {
                    // Durable fence failed before marker was attempted: close cleanly without sending marker.
                    drop(reader);
                    return Err(e);
                }
            }

            // 10. Transmit end-of-data marker and await final SMTP acceptance response.
            match timeout(
                io_timeout,
                write_and_flush_all(reader.get_mut(), terminator),
            )
            .await
            {
                Ok(Ok(())) => {}
                Ok(Err(e)) => {
                    drop(reader);
                    return Ok(SmtpDeliveryOutcome::AmbiguousAfterTerminator {
                        message: format!("error writing SMTP DATA terminator after fence: {}", e),
                    });
                }
                Err(_) => {
                    drop(reader);
                    return Ok(SmtpDeliveryOutcome::AmbiguousAfterTerminator {
                        message: "timed out writing SMTP DATA terminator after fence".to_string(),
                    });
                }
            }

            match timeout(io_timeout, read_smtp_reply(&mut reader)).await {
                Ok(Ok(Some(reply))) if (200..=299).contains(&reply.code) => {
                    close_command_mode_cleanly(reader, false).await;
                    Ok(SmtpDeliveryOutcome::Delivered {
                        smtp_code: reply.code,
                    })
                }
                Ok(Ok(Some(reply))) => {
                    close_command_mode_cleanly(reader, false).await;
                    let classified = if (400..=599).contains(&reply.code) {
                        reply_to_smtp_error(reply)
                    } else {
                        temp_smtp_err(format!("unexpected final SMTP reply: {}", reply.message))
                    };
                    Ok(SmtpDeliveryOutcome::RejectedAfterTerminator(classified))
                }
                Ok(Ok(None)) => {
                    drop(reader);
                    Ok(SmtpDeliveryOutcome::AmbiguousAfterTerminator {
                        message: "SMTP closed connection without reply after DATA terminator"
                            .to_string(),
                    })
                }
                Ok(Err(e)) => {
                    drop(reader);
                    Ok(SmtpDeliveryOutcome::AmbiguousAfterTerminator {
                        message: format!("post-terminator SMTP read error without reply: {}", e),
                    })
                }
                Err(_) => {
                    drop(reader);
                    Ok(SmtpDeliveryOutcome::AmbiguousAfterTerminator {
                        message: "timed out awaiting SMTP reply after DATA terminator".to_string(),
                    })
                }
            }
        }
        Ok(Ok(Some(reply))) => {
            close_command_mode_cleanly(reader, false).await;
            Ok(SmtpDeliveryOutcome::FailedBeforeData(reply_to_smtp_error(reply)))
        }
        Ok(Ok(None)) => {
            drop(reader);
            Ok(SmtpDeliveryOutcome::FailedBeforeData(temp_smtp_err(
                "SMTP closed connection during EHLO",
            )))
        }
        Ok(Err(e)) => {
            drop(reader);
            Ok(SmtpDeliveryOutcome::FailedBeforeData(temp_smtp_err(format!(
                "SMTP EHLO failed: {}",
                e
            ))))
        }
        Err(_) => {
            drop(reader);
            Ok(SmtpDeliveryOutcome::FailedBeforeData(temp_smtp_err(
                "SMTP EHLO timed out",
            )))
        }
    }
}

/// Inserts a `delivery_log` row idempotently inside an active transaction, honoring
/// Release A.2 unique partial indexes for terminal and per-attempt events.
#[allow(clippy::too_many_arguments)]
async fn insert_delivery_log_tx(
    tx: &tokio_postgres::Transaction<'_>,
    delivery_id: Uuid,
    mailbox_id: Uuid,
    domain_id: Uuid,
    recipient: &str,
    status: &str,
    smtp_code: Option<i32>,
    smtp_message: Option<&str>,
    lease_token: Option<Uuid>,
    smtp_phase: Option<&str>,
) -> Result<()> {
    tx.execute(
        "INSERT INTO delivery_log (delivery_id, direction, mailbox_id, domain_id, recipient, status, smtp_code, smtp_message, lease_token, smtp_phase) \
         VALUES ($1, 'outbound', $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT DO NOTHING",
        &[
            &delivery_id,
            &mailbox_id,
            &domain_id,
            &recipient,
            &status,
            &smtp_code,
            &smtp_message,
            &lease_token,
            &smtp_phase,
        ],
    )
    .await
    .context("insert delivery_log")?;
    Ok(())
}

/// Atomically reaps expired `pending` rows, expired `processing` leases, and expired Path B
/// scheduled rows according to the refined SMTP phase policy:
/// - `claimed`, `pre_data`, `data_streaming`: safely reclaimable (never falsely quarantined as `outcome_unknown`)
/// - `terminator_in_flight`: quarantined to `outcome_unknown` (never automatically resent)
/// - `accepted_by_mta`: settled as `delivered` (preserves success; never resent)
pub async fn reap_stale_and_expired(client: &mut Client, api_addr: &str) -> Result<ReapSummary> {
    let mut summary = ReapSummary::default();
    let mut deferred_notifications: Vec<(Uuid, &'static str, Option<&'static str>)> = Vec::new();

    {
        let tx = client.transaction().await.context("begin reap tx")?;

        // 1. Expire pending rows whose overall delivery TTL has elapsed.
        let expired_pending_rows = tx
            .query(
                "WITH doomed AS ( \
                     SELECT id \
                     FROM outbound_queue \
                     WHERE status = 'pending' AND expires_at <= now() \
                     FOR UPDATE SKIP LOCKED \
                 ) \
                 UPDATE outbound_queue q \
                 SET status = 'expired', \
                     failed_at = COALESCE(q.failed_at, now()), \
                     lease_token = NULL, \
                     lease_expires_at = NULL, \
                     last_error = COALESCE(q.last_error, 'delivery_expired') \
                 FROM doomed d \
                 WHERE q.id = d.id \
                 RETURNING q.delivery_id, q.mailbox_id, q.domain_id, q.recipient, q.smtp_phase",
                &[],
            )
            .await
            .context("expire pending outbound_queue rows")?;

        for row in expired_pending_rows {
            let delivery_id: Uuid = row.get(0);
            let mailbox_id: Uuid = row.get(1);
            let domain_id: Uuid = row.get(2);
            let recipient: String = row.get(3);
            let smtp_phase: Option<String> = row.get(4);
            insert_delivery_log_tx(
                &tx,
                delivery_id,
                mailbox_id,
                domain_id,
                &recipient,
                "expired",
                None,
                Some("delivery_expired"),
                None,
                smtp_phase.as_deref(),
            )
            .await?;
            deferred_notifications.push((delivery_id, "failed", Some("delivery_expired")));
            summary.expired_pending += 1;
        }

        // 2. Inspect expired active leases carefully before releasing or transitioning.
        let stale_leases = tx
            .query(
                "SELECT id, delivery_id, mailbox_id, domain_id, recipient, attempts, max_attempts, \
                        lease_token, smtp_phase, (expires_at <= now()) AS ttl_expired, last_smtp_code \
                 FROM outbound_queue \
                 WHERE status = 'processing' AND lease_expires_at <= now() \
                 FOR UPDATE SKIP LOCKED",
                &[],
            )
            .await
            .context("select expired processing leases")?;

        for row in stale_leases {
            let queue_id: Uuid = row.get(0);
            let delivery_id: Uuid = row.get(1);
            let mailbox_id: Uuid = row.get(2);
            let domain_id: Uuid = row.get(3);
            let recipient: String = row.get(4);
            let attempts: i32 = row.get(5);
            let max_attempts: i32 = row.get(6);
            let old_lease_token: Option<Uuid> = row.get(7);
            let smtp_phase: Option<String> = row.get(8);
            let ttl_expired: bool = row.get(9);
            let last_smtp_code: Option<i32> = row.get(10);

            if smtp_phase.as_deref() == Some(SmtpPhase::AcceptedByMta.as_str()) {
                tx.execute(
                    "UPDATE outbound_queue \
                     SET status = 'delivered', \
                         delivered_at = COALESCE(delivered_at, now()), \
                         attempts = attempts + 1, \
                         last_attempt_at = now(), \
                         lease_token = NULL, \
                         lease_expires_at = NULL, \
                         smtp_phase = 'accepted_by_mta', \
                         last_smtp_code = COALESCE(last_smtp_code, 250), \
                         last_error = NULL \
                     WHERE id = $1 AND status = 'processing'",
                    &[&queue_id],
                )
                .await
                .context("settle accepted_by_mta expired lease as delivered")?;
                insert_delivery_log_tx(
                    &tx,
                    delivery_id,
                    mailbox_id,
                    domain_id,
                    &recipient,
                    "delivered",
                    Some(last_smtp_code.unwrap_or(250)),
                    None,
                    old_lease_token,
                    Some("accepted_by_mta"),
                )
                .await?;
                deferred_notifications.push((delivery_id, "delivered", None));
                summary.preserved_accepted_by_mta += 1;
            } else if smtp_phase.as_deref() == Some(SmtpPhase::TerminatorInFlight.as_str()) {
                tx.execute(
                    "UPDATE outbound_queue \
                     SET status = 'outcome_unknown', \
                         failed_at = COALESCE(failed_at, now()), \
                         attempts = attempts + 1, \
                         last_attempt_at = now(), \
                         lease_token = NULL, \
                         lease_expires_at = NULL, \
                         smtp_phase = 'terminator_in_flight', \
                         last_error = 'lease_expired_during_terminator_in_flight' \
                     WHERE id = $1 AND status = 'processing'",
                    &[&queue_id],
                )
                .await
                .context("transition terminator_in_flight lease to outcome_unknown")?;
                insert_delivery_log_tx(
                    &tx,
                    delivery_id,
                    mailbox_id,
                    domain_id,
                    &recipient,
                    "outcome_unknown",
                    None,
                    Some("lease_expired_during_terminator_in_flight"),
                    old_lease_token,
                    Some("terminator_in_flight"),
                )
                .await?;
                error!(
                    "AMBIGUOUS OUTBOUND DELIVERY delivery_id={} recipient={}: lease expired during terminator_in_flight; moved to outcome_unknown for manual reconciliation (no auto-resend)",
                    delivery_id, recipient
                );
                summary.moved_to_outcome_unknown += 1;
            } else if ttl_expired {
                tx.execute(
                    "UPDATE outbound_queue \
                     SET status = 'expired', \
                         failed_at = COALESCE(failed_at, now()), \
                         attempts = attempts + 1, \
                         last_attempt_at = now(), \
                         lease_token = NULL, \
                         lease_expires_at = NULL, \
                         smtp_phase = NULL, \
                         last_error = 'delivery_expired_while_processing' \
                     WHERE id = $1 AND status = 'processing'",
                    &[&queue_id],
                )
                .await
                .context("expire processing lease past TTL")?;
                insert_delivery_log_tx(
                    &tx,
                    delivery_id,
                    mailbox_id,
                    domain_id,
                    &recipient,
                    "expired",
                    None,
                    Some("delivery_expired_while_processing"),
                    old_lease_token,
                    smtp_phase.as_deref(),
                )
                .await?;
                deferred_notifications.push((
                    delivery_id,
                    "failed",
                    Some("delivery_expired_while_processing"),
                ));
                summary.expired_processing_leases += 1;
            } else if attempts + 1 >= max_attempts {
                tx.execute(
                    "UPDATE outbound_queue \
                     SET status = 'bounced', \
                         failed_at = now(), \
                         attempts = attempts + 1, \
                         last_attempt_at = now(), \
                         lease_token = NULL, \
                         lease_expires_at = NULL, \
                         smtp_phase = NULL, \
                         last_error = 'lease_expired_max_attempts' \
                     WHERE id = $1 AND status = 'processing'",
                    &[&queue_id],
                )
                .await
                .context("bounce max-attempt expired lease")?;
                insert_delivery_log_tx(
                    &tx,
                    delivery_id,
                    mailbox_id,
                    domain_id,
                    &recipient,
                    "bounced",
                    None,
                    Some("lease_expired_max_attempts"),
                    old_lease_token,
                    smtp_phase.as_deref(),
                )
                .await?;
                deferred_notifications.push((
                    delivery_id,
                    "failed",
                    Some("lease_expired_max_attempts"),
                ));
                summary.bounced_max_attempt_leases += 1;
            } else {
                let reclaim_reason = if smtp_phase.as_deref() == Some(SmtpPhase::DataStreaming.as_str()) {
                    "lease_expired_before_terminator"
                } else {
                    "lease_expired_before_data"
                };
                tx.execute(
                    "UPDATE outbound_queue \
                     SET status = 'pending', \
                         attempts = attempts + 1, \
                         last_attempt_at = now(), \
                         next_attempt_at = now(), \
                         lease_token = NULL, \
                         lease_expires_at = NULL, \
                         smtp_phase = NULL, \
                         last_error = $2 \
                     WHERE id = $1 AND status = 'processing'",
                    &[&queue_id, &reclaim_reason],
                )
                .await
                .context("release expired pre-terminator lease to pending")?;
                insert_delivery_log_tx(
                    &tx,
                    delivery_id,
                    mailbox_id,
                    domain_id,
                    &recipient,
                    "retry",
                    None,
                    Some(reclaim_reason),
                    old_lease_token,
                    smtp_phase.as_deref(),
                )
                .await?;
                summary.released_pre_data_leases += 1;
            }
        }

        // 3. Expire stale Path B scheduled_messages past their TTL.
        let exp_sched = tx
            .execute(
                "UPDATE scheduled_messages SET status = 'expired', updated_at = now() \
                 WHERE status = 'pending' AND is_path_a = false AND expires_at <= now()",
                &[],
            )
            .await
            .context("expire pending scheduled_messages")?;
        summary.expired_scheduled = exp_sched as usize;

        tx.commit().await.context("commit reap tx")?;
    }

    for (delivery_id, status, reason) in deferred_notifications {
        notify_scheduled_complete(api_addr, &delivery_id.to_string(), status, reason).await;
    }

    Ok(summary)
}

/// Atomically claims up to `config.batch_size` deliverable rows (or reclaimable expired
/// `claimed`/`pre_data`/`data_streaming` leases whose old holder is fenced out before terminator)
/// inside a PostgreSQL transaction, assigning a unique per-attempt `lease_token`.
pub async fn claim_outbound_batch(client: &mut Client, config: &LeaseConfig) -> Result<Vec<ClaimedOutboundItem>> {
    let tx = client.transaction().await.context("begin claim tx")?;
    let ttl_secs = config.lease_ttl.as_secs_f64();
    let rows = tx
        .query(
            "WITH candidates AS ( \
                 SELECT id \
                 FROM outbound_queue \
                 WHERE expires_at > now() \
                   AND ( \
                     (status = 'pending' AND next_attempt_at <= now()) \
                     OR ( \
                       status = 'processing' \
                       AND lease_expires_at <= now() \
                       AND COALESCE(smtp_phase, 'claimed') IN ('claimed', 'pre_data', 'data_streaming') \
                       AND attempts + 1 < max_attempts \
                     ) \
                   ) \
                 ORDER BY COALESCE(lease_expires_at, next_attempt_at) ASC, next_attempt_at ASC \
                 LIMIT $1 \
                 FOR UPDATE SKIP LOCKED \
             ) \
             UPDATE outbound_queue q \
             SET status = 'processing', \
                 lease_token = gen_random_uuid(), \
                 lease_owner = $2, \
                 claimed_at = now(), \
                 lease_expires_at = now() + make_interval(secs => $3), \
                 smtp_phase = 'claimed', \
                 attempts = CASE WHEN q.status = 'processing' THEN q.attempts + 1 ELSE q.attempts END \
             FROM candidates c \
             WHERE q.id = c.id \
             RETURNING q.id, q.delivery_id, q.mailbox_id, q.domain_id, q.recipient, \
                       q.encrypted_message, q.send_token_hpke_wrapped, q.outbox_seq, \
                       q.encryption_version, q.aad_version, q.attempts, q.max_attempts, \
                       q.lease_token, \
                       COALESCE((to_jsonb(q)->>'attachment_count')::int, 0), \
                       (to_jsonb(q)->>'send_token_key_epoch')::int, \
                       to_jsonb(q)->>'send_token_key_id'",
            &[&config.batch_size, &config.lease_owner, &ttl_secs],
        )
        .await
        .context("claim outbound_queue batch")?;

    tx.commit().await.context("commit claim tx")?;

    Ok(rows
        .into_iter()
        .map(|row| ClaimedOutboundItem {
            id: row.get(0),
            delivery_id: row.get(1),
            mailbox_id: row.get(2),
            domain_id: row.get(3),
            recipient: row.get(4),
            encrypted_message: row.get(5),
            wrapped: row.get(6),
            outbox_seq: row.get(7),
            enc_ver: row.get(8),
            aad_ver: row.get(9),
            attempts: row.get(10),
            max_attempts: row.get(11),
            lease_token: row.get(12),
            attachment_count: row.get(13),
            send_token_key_epoch: row.get::<_, Option<i32>>(14).and_then(|v| u32::try_from(v).ok()),
            send_token_key_id: row.get(15),
        })
        .collect())
}

/// Extends an active, unexpired worker lease when both `id` and `lease_token` still own `processing`.
pub async fn renew_lease(
    client: &Client,
    queue_id: Uuid,
    lease_token: Uuid,
    lease_ttl: Duration,
) -> Result<bool> {
    let ttl_secs = lease_ttl.as_secs_f64();
    let updated = client
        .execute(
            "UPDATE outbound_queue \
             SET lease_expires_at = clock_timestamp() + make_interval(secs => $3) \
             WHERE id = $1 \
               AND lease_token = $2 \
               AND status = 'processing' \
               AND lease_expires_at > clock_timestamp()",
            &[&queue_id, &lease_token, &ttl_secs],
        )
        .await
        .context("renew outbound_queue lease")?;
    Ok(updated == 1)
}

/// Fences and advances the active attempt's `smtp_phase` (`pre_data`, `data_streaming`,
/// `terminator_in_flight`, or `accepted_by_mta`) only when the lease token is active AND unexpired.
pub async fn mark_smtp_phase(
    client: &Client,
    queue_id: Uuid,
    lease_token: Uuid,
    phase: SmtpPhase,
) -> Result<bool> {
    let updated = client
        .execute(
            "UPDATE outbound_queue \
             SET smtp_phase = $3 \
             WHERE id = $1 \
               AND lease_token = $2 \
               AND status = 'processing' \
               AND lease_expires_at > clock_timestamp()",
            &[&queue_id, &lease_token, &phase.as_str()],
        )
        .await
        .context("mark outbound_queue smtp_phase")?;
    Ok(updated == 1)
}

/// Releases an active lease back to `pending` when deferred by rate limits (does not consume an attempt).
pub async fn release_for_rate_limit(
    client: &mut Client,
    queue_id: Uuid,
    lease_token: Uuid,
    retry_after_secs: i64,
    reason: &str,
) -> Result<LeaseFenceResult<()>> {
    let delay_secs = retry_after_secs.max(5) as f64;
    let updated = client
        .execute(
            "UPDATE outbound_queue \
             SET status = 'pending', \
                 lease_token = NULL, \
                 lease_expires_at = NULL, \
                 smtp_phase = NULL, \
                 last_attempt_at = now(), \
                 next_attempt_at = now() + make_interval(secs => $3), \
                 last_error = $4 \
             WHERE id = $1 AND lease_token = $2 AND status = 'processing'",
            &[&queue_id, &lease_token, &delay_secs, &reason],
        )
        .await
        .context("release lease for rate limit")?;
    if updated == 1 {
        Ok(LeaseFenceResult::Applied(()))
    } else {
        Ok(LeaseFenceResult::StaleLease)
    }
}

/// Lease-fenced, idempotent transition to `delivered` (`smtp_phase = 'accepted_by_mta'`)
/// + single `delivery_log` entry after positive `2xx` final SMTP response.
#[allow(clippy::too_many_arguments)]
pub async fn record_delivered_leased(
    client: &mut Client,
    api_addr: &str,
    queue_id: Uuid,
    lease_token: Uuid,
    delivery_id: Uuid,
    mailbox_id: Uuid,
    domain_id: Uuid,
    recipient: &str,
    smtp_code: u16,
) -> Result<LeaseFenceResult<()>> {
    let code_i32 = i32::from(smtp_code);
    let result = {
        let tx = client.transaction().await.context("begin delivered tx")?;
        let updated = tx
            .execute(
                "UPDATE outbound_queue \
                 SET status = 'delivered', \
                     delivered_at = now(), \
                     attempts = attempts + 1, \
                     last_attempt_at = now(), \
                     lease_token = NULL, \
                     lease_expires_at = NULL, \
                     smtp_phase = 'accepted_by_mta', \
                     last_smtp_code = $3, \
                     last_error = NULL \
                 WHERE id = $1 AND lease_token = $2 AND status = 'processing'",
                &[&queue_id, &lease_token, &code_i32],
            )
            .await
            .context("mark outbound_queue delivered")?;

        if updated == 1 {
            insert_delivery_log_tx(
                &tx,
                delivery_id,
                mailbox_id,
                domain_id,
                recipient,
                "delivered",
                Some(code_i32),
                None,
                Some(lease_token),
                Some("accepted_by_mta"),
            )
            .await?;
            tx.commit().await.context("commit delivered tx")?;
            LeaseFenceResult::Applied(())
        } else {
            let current = tx
                .query_opt("SELECT status FROM outbound_queue WHERE id = $1", &[&queue_id])
                .await?;
            tx.commit().await.context("commit delivered check tx")?;
            match current.map(|r| r.get::<_, String>(0)).as_deref() {
                Some("delivered") => {
                    info!("delivery {} already settled as delivered (idempotent)", delivery_id);
                    LeaseFenceResult::AlreadySettled
                }
                _ => LeaseFenceResult::StaleLease,
            }
        }
    };

    if matches!(result, LeaseFenceResult::Applied(())) {
        notify_scheduled_complete(api_addr, &delivery_id.to_string(), "delivered", None).await;
    }

    Ok(result)
}

/// Lease-fenced temporary-failure handler: increments `attempts`, clears active lease,
/// logs `'retry'` while under `max_attempts`, and transitions to terminal `'bounced'`
/// once `attempts + 1 >= max_attempts`.
#[allow(clippy::too_many_arguments)]
pub async fn record_retry_leased(
    client: &mut Client,
    api_addr: &str,
    queue_id: Uuid,
    lease_token: Uuid,
    delivery_id: Uuid,
    mailbox_id: Uuid,
    domain_id: Uuid,
    recipient: &str,
    current_attempts: i32,
    smtp_code: Option<u16>,
    message: &str,
    smtp_phase: Option<&str>,
) -> Result<LeaseFenceResult<QueueDeliveryDisposition>> {
    let backoff_secs = compute_retry_backoff(current_attempts.saturating_add(1)).as_secs_f64();
    let code_i32 = smtp_code.map(i32::from);

    let outcome = {
        let tx = client.transaction().await.context("begin retry tx")?;
        let row_opt = tx
            .query_opt(
                "UPDATE outbound_queue \
                 SET attempts = attempts + 1, \
                     last_attempt_at = now(), \
                     status = CASE WHEN attempts + 1 >= max_attempts THEN 'bounced' ELSE 'pending' END, \
                     failed_at = CASE WHEN attempts + 1 >= max_attempts THEN now() ELSE failed_at END, \
                     next_attempt_at = CASE \
                         WHEN attempts + 1 >= max_attempts THEN next_attempt_at \
                         ELSE now() + make_interval(secs => $3) \
                     END, \
                     lease_token = NULL, \
                     lease_expires_at = NULL, \
                     smtp_phase = NULL, \
                     last_smtp_code = $4, \
                     last_error = $5 \
                 WHERE id = $1 AND lease_token = $2 AND status = 'processing' \
                 RETURNING status",
                &[&queue_id, &lease_token, &backoff_secs, &code_i32, &message],
            )
            .await
            .context("update outbound_queue retry/exhaustion")?;

        match row_opt {
            None => LeaseFenceResult::StaleLease,
            Some(row) => {
                let next_status: String = row.get(0);
                if next_status == "bounced" {
                    insert_delivery_log_tx(
                        &tx,
                        delivery_id,
                        mailbox_id,
                        domain_id,
                        recipient,
                        "bounced",
                        code_i32,
                        Some(message),
                        Some(lease_token),
                        smtp_phase,
                    )
                    .await?;
                    tx.commit().await.context("commit max-attempt bounce tx")?;
                    LeaseFenceResult::Applied(QueueDeliveryDisposition::Bounced {
                        smtp_code,
                        message: message.to_string(),
                    })
                } else {
                    insert_delivery_log_tx(
                        &tx,
                        delivery_id,
                        mailbox_id,
                        domain_id,
                        recipient,
                        "retry",
                        code_i32,
                        Some(message),
                        Some(lease_token),
                        smtp_phase,
                    )
                    .await?;
                    tx.commit().await.context("commit retry tx")?;
                    LeaseFenceResult::Applied(QueueDeliveryDisposition::RetryScheduled {
                        smtp_code,
                        message: message.to_string(),
                    })
                }
            }
        }
    };

    if matches!(
        outcome,
        LeaseFenceResult::Applied(QueueDeliveryDisposition::Bounced { .. })
    ) {
        notify_scheduled_complete(api_addr, &delivery_id.to_string(), "failed", Some(message)).await;
    }

    Ok(outcome)
}

/// Lease-fenced permanent failure transition to `bounced` + deduplicated `'bounced'` `delivery_log`.
#[allow(clippy::too_many_arguments)]
pub async fn record_bounced_leased(
    client: &mut Client,
    api_addr: &str,
    queue_id: Uuid,
    lease_token: Uuid,
    delivery_id: Uuid,
    mailbox_id: Uuid,
    domain_id: Uuid,
    recipient: &str,
    smtp_code: Option<u16>,
    message: &str,
    smtp_phase: Option<&str>,
) -> Result<LeaseFenceResult<QueueDeliveryDisposition>> {
    let code_i32 = smtp_code.map(i32::from);
    let outcome = {
        let tx = client.transaction().await.context("begin bounced tx")?;
        let updated = tx
            .execute(
                "UPDATE outbound_queue \
                 SET status = 'bounced', \
                     failed_at = now(), \
                     attempts = attempts + 1, \
                     last_attempt_at = now(), \
                     lease_token = NULL, \
                     lease_expires_at = NULL, \
                     smtp_phase = NULL, \
                     last_smtp_code = $3, \
                     last_error = $4 \
                 WHERE id = $1 AND lease_token = $2 AND status = 'processing'",
                &[&queue_id, &lease_token, &code_i32, &message],
            )
            .await
            .context("mark outbound_queue bounced")?;

        if updated == 0 {
            LeaseFenceResult::StaleLease
        } else {
            insert_delivery_log_tx(
                &tx,
                delivery_id,
                mailbox_id,
                domain_id,
                recipient,
                "bounced",
                code_i32,
                Some(message),
                Some(lease_token),
                smtp_phase,
            )
            .await?;
            tx.commit().await.context("commit bounced tx")?;
            LeaseFenceResult::Applied(QueueDeliveryDisposition::Bounced {
                smtp_code,
                message: message.to_string(),
            })
        }
    };

    if matches!(outcome, LeaseFenceResult::Applied(_)) {
        notify_scheduled_complete(api_addr, &delivery_id.to_string(), "failed", Some(message)).await;
    }

    Ok(outcome)
}

/// Lease-fenced transition to `outcome_unknown` for ambiguous post-terminator disconnects/timeouts.
/// Never auto-resends (prevents duplicates) and never inserts a false `'bounced'` log entry.
#[allow(clippy::too_many_arguments)]
pub async fn record_outcome_unknown_leased(
    client: &mut Client,
    queue_id: Uuid,
    lease_token: Uuid,
    delivery_id: Uuid,
    mailbox_id: Uuid,
    domain_id: Uuid,
    recipient: &str,
    message: &str,
) -> Result<LeaseFenceResult<()>> {
    let tx = client.transaction().await.context("begin outcome_unknown tx")?;
    let updated = tx
        .execute(
            "UPDATE outbound_queue \
             SET status = 'outcome_unknown', \
                 failed_at = COALESCE(failed_at, now()), \
                 attempts = attempts + 1, \
                 last_attempt_at = now(), \
                 lease_token = NULL, \
                 lease_expires_at = NULL, \
                 smtp_phase = 'terminator_in_flight', \
                 last_smtp_code = NULL, \
                 last_error = $3 \
             WHERE id = $1 AND lease_token = $2 AND status = 'processing'",
            &[&queue_id, &lease_token, &message],
        )
        .await
        .context("mark outbound_queue outcome_unknown")?;

    if updated == 0 {
        return Ok(LeaseFenceResult::StaleLease);
    }

    insert_delivery_log_tx(
        &tx,
        delivery_id,
        mailbox_id,
        domain_id,
        recipient,
        "outcome_unknown",
        None,
        Some(message),
        Some(lease_token),
        Some("terminator_in_flight"),
    )
    .await?;
    tx.commit().await.context("commit outcome_unknown tx")?;

    error!(
        "AMBIGUOUS OUTBOUND DELIVERY delivery_id={} recipient={}: {}; marked status=outcome_unknown for manual operator reconciliation (no auto-retry)",
        delivery_id, recipient, message
    );

    Ok(LeaseFenceResult::Applied(()))
}

#[allow(clippy::too_many_arguments)]
async fn process_claimed_outbound_item(
    client: &mut Client,
    sk: &[u8; 32],
    dkim_dek: &[u8; 32],
    postfix_addr: &str,
    api_addr: &str,
    redis_client: Option<&redis::Client>,
    config: &LeaseConfig,
    item: ClaimedOutboundItem,
) -> Result<()> {
    let delivery_id_str = item.delivery_id.to_string();

    if item.outbox_seq.is_none() || item.enc_ver.is_none() || item.aad_ver.is_none() {
        warn!(
            "legacy outbound row {} missing V5.3 AAD metadata (outbox_seq/enc_ver/aad_ver), failing safely",
            delivery_id_str
        );
        let _ = record_bounced_leased(
            client,
            api_addr,
            item.id,
            item.lease_token,
            item.delivery_id,
            item.mailbox_id,
            item.domain_id,
            &item.recipient,
            None,
            "missing V5.3 AAD metadata",
            Some(SmtpPhase::Claimed.as_str()),
        )
        .await?;
        return Ok(());
    }
    let outbox_seq = item.outbox_seq.unwrap();
    let enc_ver = item.enc_ver.unwrap();
    let aad_ver = item.aad_ver.unwrap();

    if enc_ver != ENCRYPTION_VERSION as i32 || aad_ver as i32 != AAD_VERSION as i32 {
        warn!("wrong version for {}: enc {} aad {}", delivery_id_str, enc_ver, aad_ver);
        let _ = record_bounced_leased(
            client,
            api_addr,
            item.id,
            item.lease_token,
            item.delivery_id,
            item.mailbox_id,
            item.domain_id,
            &item.recipient,
            None,
            &format!("unsupported encryption/aad version: enc={} aad={}", enc_ver, aad_ver),
            Some(SmtpPhase::Claimed.as_str()),
        )
        .await?;
        return Ok(());
    }

    let mut mailbox_bytes = [0u8; 16];
    mailbox_bytes.copy_from_slice(item.mailbox_id.as_bytes());

    let keyring = match OutboundKeyring::load_with_fallback(sk) {
        Ok(kr) => kr,
        Err(e) => {
            warn!("outbound keyring load failed {}: {}", delivery_id_str, e);
            let _ = record_bounced_leased(
                client,
                api_addr,
                item.id,
                item.lease_token,
                item.delivery_id,
                item.mailbox_id,
                item.domain_id,
                &item.recipient,
                None,
                "outbound keyring unavailable",
                Some(SmtpPhase::Claimed.as_str()),
            )
            .await?;
            return Ok(());
        }
    };
    let send_token_sk = keyring
        .select_send_token_sk(item.send_token_key_epoch, item.send_token_key_id.as_deref())
        .unwrap_or(sk);

    let plaintext = match decrypt_outbound(send_token_sk, &item.wrapped, &mailbox_bytes, outbox_seq as u64, &item.encrypted_message) {
        Ok(p) => p,
        Err(e) => {
            warn!("decrypt failed {}: {}", delivery_id_str, e);
            let _ = record_retry_leased(
                client,
                api_addr,
                item.id,
                item.lease_token,
                item.delivery_id,
                item.mailbox_id,
                item.domain_id,
                &item.recipient,
                item.attempts,
                None,
                &e.to_string(),
                Some(SmtpPhase::Claimed.as_str()),
            )
            .await?;
            return Ok(());
        }
    };

    let rcpt_count = count_recipients(&plaintext);
    let (mailbox_plan, org_id, local_part) = match client
        .query_opt("SELECT org_id::text, local_part FROM mailboxes WHERE id=$1", &[&item.mailbox_id])
        .await
    {
        Ok(Some(r)) => ("solo".to_string(), r.get(0), r.get(1)),
        _ => ("solo".to_string(), "".to_string(), "noreply".to_string()),
    };

    let recip_limit = get_limit(&mailbox_plan, "recipients", "recipients");
    if rcpt_count as i32 > recip_limit {
        warn!(
            "recipient limit exceeded {} count {} > limit {} (plan {})",
            delivery_id_str, rcpt_count, recip_limit, mailbox_plan
        );
        let _ = record_bounced_leased(
            client,
            api_addr,
            item.id,
            item.lease_token,
            item.delivery_id,
            item.mailbox_id,
            item.domain_id,
            &item.recipient,
            None,
            "too many recipients",
            Some(SmtpPhase::Claimed.as_str()),
        )
        .await?;
        return Ok(());
    }

    if !org_id.is_empty() {
        let org_plan = mailbox_plan.clone();
        let rc_opt = redis_client.cloned();
        let (ok, retry, failed) = check_and_incr_rate(
            &rc_opt,
            &item.mailbox_id.to_string(),
            &org_id,
            &mailbox_plan,
            &org_plan,
        )
        .await;
        if !ok {
            warn!(
                "outbound delivery {} deferred due to rate limit (failed {}, retry {}s)",
                delivery_id_str, failed, retry
            );
            let _ = release_for_rate_limit(
                client,
                item.id,
                item.lease_token,
                retry,
                "rate_limit_deferred",
            )
            .await?;
            return Ok(());
        }
    }

    let (extracted_sender, extracted_domain) = extract_from_header(&plaintext);

    let dkim_row = if let Some(ref s_domain) = extracted_domain {
        match client
            .query_opt(
                "SELECT id, name, dkim_selector, dkim_private_key_enc FROM domains WHERE lower(name) = lower($1)",
                &[s_domain],
            )
            .await
        {
            Ok(Some(r)) => Ok(Some(r)),
            _ => {
                client
                    .query_opt(
                        "SELECT id, name, dkim_selector, dkim_private_key_enc FROM domains WHERE id=$1",
                        &[&item.domain_id],
                    )
                    .await
            }
        }
    } else {
        client
            .query_opt(
                "SELECT id, name, dkim_selector, dkim_private_key_enc FROM domains WHERE id=$1",
                &[&item.domain_id],
            )
            .await
    };

    let dkim_row = match dkim_row {
        Ok(r) => r,
        Err(e) => {
            warn!("dkim domain lookup failed {}: {}", delivery_id_str, e);
            let _ = record_retry_leased(
                client,
                api_addr,
                item.id,
                item.lease_token,
                item.delivery_id,
                item.mailbox_id,
                item.domain_id,
                &item.recipient,
                item.attempts,
                None,
                &format!("dkim domain lookup failed: {}", e),
                Some(SmtpPhase::Claimed.as_str()),
            )
            .await?;
            return Ok(());
        }
    };

    let (actual_domain_id, domain_name, dkim_selector, dkim_enc_opt): (Uuid, String, String, Option<Vec<u8>>) = match dkim_row {
        Some(r) => (r.get(0), r.get(1), r.get(2), r.get(3)),
        None => {
            warn!("dkim domain not found {} for sending domain {:?}", delivery_id_str, extracted_domain);
            let _ = record_bounced_leased(
                client,
                api_addr,
                item.id,
                item.lease_token,
                item.delivery_id,
                item.mailbox_id,
                item.domain_id,
                &item.recipient,
                None,
                "dkim domain not found",
                Some(SmtpPhase::Claimed.as_str()),
            )
            .await?;
            return Ok(());
        }
    };

    let dkim_enc = match dkim_enc_opt {
        Some(v) if !v.is_empty() => v,
        _ => {
            warn!("dkim private key missing for domain {} delivery {}", domain_name, delivery_id_str);
            let _ = record_bounced_leased(
                client,
                api_addr,
                item.id,
                item.lease_token,
                item.delivery_id,
                item.mailbox_id,
                actual_domain_id,
                &item.recipient,
                None,
                "dkim key missing",
                Some(SmtpPhase::Claimed.as_str()),
            )
            .await?;
            return Ok(());
        }
    };

    let dkim_pem = match decrypt_dkim_private_key(dkim_dek, &dkim_enc) {
        Ok(p) => p,
        Err(e) => {
            warn!("dkim decrypt failed {}: {}", delivery_id_str, e);
            let _ = record_bounced_leased(
                client,
                api_addr,
                item.id,
                item.lease_token,
                item.delivery_id,
                item.mailbox_id,
                actual_domain_id,
                &item.recipient,
                None,
                "dkim decrypt failed",
                Some(SmtpPhase::Claimed.as_str()),
            )
            .await?;
            return Ok(());
        }
    };

    // Strip all Bcc: headers prior to attachment MIME assembly and DKIM signing.
    let sanitized_plaintext = byos_crypto_core::Zeroizing::new(strip_bcc_headers(&plaintext));
    drop(plaintext);

    let construction_t0 = Instant::now();
    let mut att_metrics = AttachmentFetchMetrics::default();
    let mut mime_assembly_ms: u128 = 0;

    let assembled_sanitized: byos_crypto_core::Zeroizing<Vec<u8>> = if item.attachment_count > 0 {
        let internal_key = match load_internal_api_key() {
            Some(k) => k,
            None => {
                warn!("missing INTERNAL_API_KEY for outbound attachments {}", delivery_id_str);
                let _ = record_retry_leased(
                    client,
                    api_addr,
                    item.id,
                    item.lease_token,
                    item.delivery_id,
                    item.mailbox_id,
                    actual_domain_id,
                    &item.recipient,
                    item.attempts,
                    None,
                    "missing internal API key for outbound attachments",
                    Some(SmtpPhase::Claimed.as_str()),
                )
                .await?;
                return Ok(());
            }
        };
        let http = http_client();
        let fetch_res = {
            let shared_client: &Client = &*client;
            let mut renew_ticker = interval(config.renew_interval);
            renew_ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);
            renew_ticker.tick().await;

            let fetch_fut = fetch_and_decrypt_attachments_with_metrics(
                &http,
                api_addr,
                &internal_key,
                &keyring,
                item.delivery_id,
                item.mailbox_id,
                outbox_seq,
                item.attachment_count as usize,
                item.lease_token,
            );
            tokio::pin!(fetch_fut);

            loop {
                tokio::select! {
                    res = &mut fetch_fut => break res,
                    _ = renew_ticker.tick() => {
                        match renew_lease(shared_client, item.id, item.lease_token, config.lease_ttl).await {
                            Ok(true) => {
                                debug!("renewed active lease during attachment fetch for {}", delivery_id_str);
                            }
                            Ok(false) => {
                                break Err(AttachmentFetchError::LeaseLost(
                                    "lease lost during attachment fetch/decryption".to_string(),
                                ));
                            }
                            Err(e) => {
                                warn!("lease renewal failed during attachment fetch {}: {}", delivery_id_str, e);
                            }
                        }
                    }
                }
            }
        };
        let (decrypted_atts, fetched_metrics) = match fetch_res {
            Ok(res) => res,
            Err(AttachmentFetchError::LeaseLost(reason)) => {
                warn!("attachment retrieval lease lost {}: {}", delivery_id_str, reason);
                return Ok(());
            }
            Err(AttachmentFetchError::Retryable(reason)) => {
                warn!("attachment retrieval retryable {}: {}", delivery_id_str, reason);
                let _ = record_retry_leased(
                    client,
                    api_addr,
                    item.id,
                    item.lease_token,
                    item.delivery_id,
                    item.mailbox_id,
                    actual_domain_id,
                    &item.recipient,
                    item.attempts,
                    None,
                    &reason,
                    Some(SmtpPhase::Claimed.as_str()),
                )
                .await?;
                return Ok(());
            }
            Err(AttachmentFetchError::Permanent(reason)) => {
                warn!("attachment retrieval/decryption failed permanently {}: {}", delivery_id_str, reason);
                let _ = record_bounced_leased(
                    client,
                    api_addr,
                    item.id,
                    item.lease_token,
                    item.delivery_id,
                    item.mailbox_id,
                    actual_domain_id,
                    &item.recipient,
                    None,
                    &reason,
                    Some(SmtpPhase::Claimed.as_str()),
                )
                .await?;
                return Ok(());
            }
        };
        att_metrics = fetched_metrics;

        let mime_t0 = Instant::now();
        let mime_res = assemble_mime_with_attachments(&sanitized_plaintext, &decrypted_atts);
        drop(decrypted_atts);
        drop(sanitized_plaintext);
        mime_assembly_ms = mime_t0.elapsed().as_millis();
        match mime_res {
            Ok(assembled) => byos_crypto_core::Zeroizing::new(strip_bcc_headers(&assembled)),
            Err(e) => {
                warn!("MIME attachment assembly failed {}: {}", delivery_id_str, e);
                let _ = record_bounced_leased(
                    client,
                    api_addr,
                    item.id,
                    item.lease_token,
                    item.delivery_id,
                    item.mailbox_id,
                    actual_domain_id,
                    &item.recipient,
                    None,
                    &format!("MIME assembly failed: {}", e),
                    Some(SmtpPhase::Claimed.as_str()),
                )
                .await?;
                return Ok(());
            }
        }
    } else {
        sanitized_plaintext
    };

    let dkim_t0 = Instant::now();
    let signed = match dkim_sign(&dkim_pem, &dkim_selector, &domain_name, &assembled_sanitized) {
        Ok(s) => byos_crypto_core::Zeroizing::new(s),
        Err(e) => {
            warn!("dkim sign failed {}: {}", delivery_id_str, e);
            let _ = record_bounced_leased(
                client,
                api_addr,
                item.id,
                item.lease_token,
                item.delivery_id,
                item.mailbox_id,
                actual_domain_id,
                &item.recipient,
                None,
                "dkim sign failed",
                Some(SmtpPhase::Claimed.as_str()),
            )
            .await?;
            return Ok(());
        }
    };
    let dkim_sign_ms = dkim_t0.elapsed().as_millis();
    if item.attachment_count > 0 {
        let total_construction_ms = construction_t0.elapsed().as_millis();
        let peak_rss_kib = read_process_peak_rss_kib();
        info!(
            "attachment pipeline metrics delivery_id={} count={} retrieval_ms={} decryption_ms={} mime_assembly_ms={} dkim_sign_ms={} total_construction_ms={} final_mime_bytes={} peak_rss_kib={:?}",
            delivery_id_str,
            item.attachment_count,
            att_metrics.retrieval_duration.as_millis(),
            att_metrics.decryption_duration.as_millis(),
            mime_assembly_ms,
            dkim_sign_ms,
            total_construction_ms,
            signed.len(),
            peak_rss_kib
        );
    }

    let recipient_addrs = match parse_and_validate_recipients(&item.recipient) {
        Ok(addrs) => addrs,
        Err(e) => {
            warn!("invalid recipient {} {}: {}", delivery_id_str, item.recipient, e);
            let _ = record_bounced_leased(
                client,
                api_addr,
                item.id,
                item.lease_token,
                item.delivery_id,
                item.mailbox_id,
                actual_domain_id,
                &item.recipient,
                None,
                &e,
                Some(SmtpPhase::Claimed.as_str()),
            )
            .await?;
            return Ok(());
        }
    };

    let sender_email = if let Some(ref s_addr) = extracted_sender {
        s_addr.clone()
    } else {
        format!("{}@{}", local_part, domain_name)
    };
    let sender_addr: Address = match sender_email.parse() {
        Ok(a) => a,
        Err(e) => {
            warn!("invalid sender address {} {}: {}", delivery_id_str, sender_email, e);
            let _ = record_bounced_leased(
                client,
                api_addr,
                item.id,
                item.lease_token,
                item.delivery_id,
                item.mailbox_id,
                actual_domain_id,
                &item.recipient,
                None,
                &format!("invalid sender address: {}", e),
                Some(SmtpPhase::Claimed.as_str()),
            )
            .await?;
            return Ok(());
        }
    };
    let envelope = match Envelope::new(Some(sender_addr), recipient_addrs) {
        Ok(env) => env,
        Err(e) => {
            warn!("envelope build failed {}: {}", delivery_id_str, e);
            let _ = record_bounced_leased(
                client,
                api_addr,
                item.id,
                item.lease_token,
                item.delivery_id,
                item.mailbox_id,
                actual_domain_id,
                &item.recipient,
                None,
                &format!("envelope build failed: {}", e),
                Some(SmtpPhase::Claimed.as_str()),
            )
            .await?;
            return Ok(());
        }
    };
    drop(assembled_sanitized);

    let final_message = byos_crypto_core::Zeroizing::new(assemble_final_message(&domain_name, &dkim_selector, &signed));
    drop(signed);
    let max_mime_bytes = attachments::max_outbound_smtp_message_bytes();
    if final_message.len() > max_mime_bytes {
        let msg = format!(
            "assembled MIME size {} bytes exceeds configured SMTP message limit {} bytes",
            final_message.len(),
            max_mime_bytes
        );
        warn!("{} for {}", msg, delivery_id_str);
        let _ = record_bounced_leased(
            client,
            api_addr,
            item.id,
            item.lease_token,
            item.delivery_id,
            item.mailbox_id,
            actual_domain_id,
            &item.recipient,
            None,
            &msg,
            Some(SmtpPhase::Claimed.as_str()),
        )
        .await?;
        return Ok(());
    }

    // Run phase-aware SMTP send with concurrent heartbeat renewal; drop shared borrow before committing.
    let smtp_outcome = {
        let shared_client: &Client = &*client;
        let terminator_in_flight_flag = AtomicBool::new(false);
        let mut renew_ticker = interval(config.renew_interval);
        renew_ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);
        renew_ticker.tick().await;

        let smtp_fut = deliver_raw_to_smtp_phased_with_timeout(
            postfix_addr,
            &envelope,
            &final_message,
            Some(config.smtp_timeout),
            || async {
                mark_smtp_phase(shared_client, item.id, item.lease_token, SmtpPhase::PreData).await
            },
            || async {
                mark_smtp_phase(
                    shared_client,
                    item.id,
                    item.lease_token,
                    SmtpPhase::DataStreaming,
                )
                .await
            },
            || async {
                let fenced = mark_smtp_phase(
                    shared_client,
                    item.id,
                    item.lease_token,
                    SmtpPhase::TerminatorInFlight,
                )
                .await?;
                if fenced {
                    terminator_in_flight_flag.store(true, Ordering::SeqCst);
                }
                Ok(fenced)
            },
        );
        tokio::pin!(smtp_fut);

        loop {
            tokio::select! {
                res = &mut smtp_fut => break Some(res?),
                _ = renew_ticker.tick() => {
                    match renew_lease(shared_client, item.id, item.lease_token, config.lease_ttl).await {
                        Ok(true) => {
                            debug!("renewed active lease for delivery {}", delivery_id_str);
                        }
                        Ok(false) => {
                            if !terminator_in_flight_flag.load(Ordering::SeqCst) {
                                warn!("lease lost before terminator transmission for {}, closing SMTP connection cleanly", delivery_id_str);
                                break None;
                            }
                        }
                        Err(e) => {
                            warn!("lease renewal failed for {}: {}", delivery_id_str, e);
                        }
                    }
                }
            }
        }
    };

    let Some(smtp_outcome) = smtp_outcome else {
        return Ok(());
    };

    match smtp_outcome {
        SmtpDeliveryOutcome::Delivered { smtp_code } => {
            match record_delivered_leased(
                client,
                api_addr,
                item.id,
                item.lease_token,
                item.delivery_id,
                item.mailbox_id,
                actual_domain_id,
                &item.recipient,
                smtp_code,
            )
            .await?
            {
                LeaseFenceResult::Applied(()) => {
                    info!(
                        "delivered {} to {} via {} (dkim signed for domain {}, smtp_code={})",
                        delivery_id_str, item.recipient, postfix_addr, domain_name, smtp_code
                    );
                }
                LeaseFenceResult::AlreadySettled => {}
                LeaseFenceResult::StaleLease => {
                    error!(
                        "LATE SMTP {} OK for delivery {} after lease was superseded/reaped; inspect delivery state before taking action",
                        smtp_code, delivery_id_str
                    );
                }
            }
        }
        SmtpDeliveryOutcome::StaleLeaseAbortedBeforeData => {
            warn!(
                "aborted SMTP attempt before DATA for delivery {} due to stale lease",
                delivery_id_str
            );
        }
        SmtpDeliveryOutcome::StaleLeaseAbortedInDataStreaming => {
            warn!(
                "aborted SMTP DATA streaming before terminator for delivery {} by closing socket due to stale lease",
                delivery_id_str
            );
        }
        SmtpDeliveryOutcome::FailedBeforeData(err) => {
            if err.is_temporary() {
                warn!("temp fail pre-DATA {} (smtp_code={:?}): {}", delivery_id_str, err.smtp_code, err.message);
                let _ = record_retry_leased(
                    client,
                    api_addr,
                    item.id,
                    item.lease_token,
                    item.delivery_id,
                    item.mailbox_id,
                    item.domain_id,
                    &item.recipient,
                    item.attempts,
                    err.smtp_code,
                    &err.message,
                    Some(SmtpPhase::PreData.as_str()),
                )
                .await?;
            } else {
                warn!("perm fail pre-DATA {} (smtp_code={:?}): {}", delivery_id_str, err.smtp_code, err.message);
                let _ = record_bounced_leased(
                    client,
                    api_addr,
                    item.id,
                    item.lease_token,
                    item.delivery_id,
                    item.mailbox_id,
                    item.domain_id,
                    &item.recipient,
                    err.smtp_code,
                    &err.message,
                    Some(SmtpPhase::PreData.as_str()),
                )
                .await?;
            }
        }
        SmtpDeliveryOutcome::FailedDuringDataStreaming(err) => {
            warn!("temp fail during data_streaming before terminator {} (smtp_code={:?}): {}", delivery_id_str, err.smtp_code, err.message);
            let _ = record_retry_leased(
                client,
                api_addr,
                item.id,
                item.lease_token,
                item.delivery_id,
                item.mailbox_id,
                item.domain_id,
                &item.recipient,
                item.attempts,
                err.smtp_code,
                &err.message,
                Some(SmtpPhase::DataStreaming.as_str()),
            )
            .await?;
        }
        SmtpDeliveryOutcome::RejectedAfterTerminator(err) => {
            if err.is_temporary() {
                warn!("temp fail post-terminator {} (smtp_code={:?}): {}", delivery_id_str, err.smtp_code, err.message);
                let _ = record_retry_leased(
                    client,
                    api_addr,
                    item.id,
                    item.lease_token,
                    item.delivery_id,
                    item.mailbox_id,
                    item.domain_id,
                    &item.recipient,
                    item.attempts,
                    err.smtp_code,
                    &err.message,
                    Some(SmtpPhase::TerminatorInFlight.as_str()),
                )
                .await?;
            } else {
                warn!("perm fail post-terminator {} (smtp_code={:?}): {}", delivery_id_str, err.smtp_code, err.message);
                let _ = record_bounced_leased(
                    client,
                    api_addr,
                    item.id,
                    item.lease_token,
                    item.delivery_id,
                    item.mailbox_id,
                    item.domain_id,
                    &item.recipient,
                    err.smtp_code,
                    &err.message,
                    Some(SmtpPhase::TerminatorInFlight.as_str()),
                )
                .await?;
            }
        }
        SmtpDeliveryOutcome::AmbiguousAfterTerminator { message } => {
            let _ = record_outcome_unknown_leased(
                client,
                item.id,
                item.lease_token,
                item.delivery_id,
                item.mailbox_id,
                item.domain_id,
                &item.recipient,
                &message,
            )
            .await?;
        }
    }

    Ok(())
}

/// Runs one leased worker poll pass: reaps stale/expired rows, claims a lease-protected batch,
/// and delivers each claimed item sequentially while renewing leases when needed.
pub async fn poll_once_with_config(
    client: &mut Client,
    sk: &[u8; 32],
    dkim_dek: &[u8; 32],
    postfix_addr: &str,
    api_addr: &str,
    redis_client: Option<&redis::Client>,
    config: &LeaseConfig,
) -> Result<()> {
    let _ = reap_stale_and_expired(client, api_addr).await?;

    let items = claim_outbound_batch(client, config).await?;
    if items.is_empty() {
        return Ok(());
    }
    info!("claimed {} outbound (owner={})", items.len(), config.lease_owner);

    for item in items {
        process_claimed_outbound_item(client, sk, dkim_dek, postfix_addr, api_addr, redis_client, config, item)
            .await?;
    }
    let _ = redis_client;
    Ok(())
}

#[allow(dead_code)]
async fn poll_once(
    client: &mut Client,
    sk: &[u8; 32],
    dkim_dek: &[u8; 32],
    postfix_addr: &str,
    api_addr: &str,
    redis_client: Option<&redis::Client>,
) -> Result<()> {
    let config = LeaseConfig::from_env();
    poll_once_with_config(client, sk, dkim_dek, postfix_addr, api_addr, redis_client, &config).await
}

fn load_internal_api_key() -> Option<String> {
    if let Ok(k) = env::var("INTERNAL_API_KEY") {
        let trimmed = k.trim().to_string();
        if !trimmed.is_empty() {
            return Some(trimmed);
        }
    }
    let path = env::var("INTERNAL_API_KEY_FILE").unwrap_or_else(|_| "/run/secrets/internal_api_key".into());
    if let Ok(s) = std::fs::read_to_string(&path) {
        let trimmed = s.trim().to_string();
        if !trimmed.is_empty() {
            return Some(trimmed);
        }
    }
    None
}

fn format_api_url(api_addr: &str, path: &str) -> String {
    let clean_path = path.trim_start_matches('/');
    if api_addr.starts_with("http://") || api_addr.starts_with("https://") {
        format!("{}/{}", api_addr.trim_end_matches('/'), clean_path)
    } else {
        format!("http://{}/{}", api_addr.trim_end_matches('/'), clean_path)
    }
}

static HTTP_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
fn http_client() -> reqwest::Client {
    HTTP_CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .timeout(Duration::from_secs(10))
                .build()
                .unwrap_or_else(|_| reqwest::Client::new())
        })
        .clone()
}

#[derive(serde::Serialize)]
struct ScheduledCompletePayload<'a> {
    delivery_id: &'a str,
    status: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    error_message: Option<&'a str>,
}

async fn notify_scheduled_complete_with_retries(
    client: &reqwest::Client,
    api_addr: &str,
    internal_key: Option<&str>,
    delivery_id: &str,
    status: &str,
    err_msg: Option<&str>,
    max_retries: u32,
    base_backoff: Duration,
) -> Result<(), ()> {
    let url = format_api_url(api_addr, "/v1/internal/scheduled/complete");
    let payload = ScheduledCompletePayload {
        delivery_id,
        status,
        error_message: err_msg,
    };

    let mut attempt = 0;
    loop {
        attempt += 1;
        let mut req = client.post(&url).json(&payload);
        if let Some(key) = internal_key {
            req = req.header("X-Internal-Key", key);
        }

        match req.send().await {
            Ok(resp) => {
                let code = resp.status();
                if code.is_success() {
                    info!(
                        "scheduled completion notified for {} (status={}, attempt={})",
                        delivery_id, status, attempt
                    );
                    return Ok(());
                } else if code.is_client_error() {
                    let body_text = resp.text().await.unwrap_or_default();
                    warn!(
                        "scheduled completion rejected with client error {} for {}: {}",
                        code, delivery_id, body_text
                    );
                    return Err(());
                } else {
                    warn!(
                        "scheduled completion server error {} for {} on attempt {}/{}",
                        code, delivery_id, attempt, max_retries
                    );
                }
            }
            Err(e) => {
                warn!(
                    "scheduled completion network error for {} on attempt {}/{}: {}",
                    delivery_id, attempt, max_retries, e
                );
            }
        }

        if attempt >= max_retries {
            error!(
                "SCHEDULED COMPLETION FAILED: exhausted {} retries for delivery_id={} status={}",
                max_retries, delivery_id, status
            );
            return Err(());
        }

        let backoff = base_backoff * 2u32.saturating_pow(attempt - 1);
        let backoff = backoff.min(Duration::from_secs(30));
        sleep(backoff).await;
    }
}

async fn notify_scheduled_complete(api_addr: &str, delivery_id: &str, status: &str, err_msg: Option<&str>) {
    let client = http_client();
    let key = load_internal_api_key();
    let _ = notify_scheduled_complete_with_retries(
        &client,
        api_addr,
        key.as_deref(),
        delivery_id,
        status,
        err_msg,
        4,
        Duration::from_secs(1),
    )
    .await;
}

async fn reconcile_delivered_scheduled(client: &Client, api_addr: &str) {
    let rows = match client
        .query(
            "SELECT sm.delivery_id::text, oq.status FROM scheduled_messages sm JOIN outbound_queue oq ON oq.delivery_id = sm.delivery_id WHERE sm.status = 'pending' AND oq.status IN ('delivered', 'bounced', 'expired') LIMIT 50",
            &[],
        )
        .await
    {
        Ok(r) => r,
        Err(e) => {
            warn!("reconcile_delivered_scheduled query failed: {}", e);
            return;
        }
    };

    info!("scheduled reconciliation pass: checked (found {} pending completed rows)", rows.len());
    if !rows.is_empty() {
        for row in rows {
            let delivery_id: String = row.get(0);
            let oq_status: String = row.get(1);
            let (status, err_msg) = match oq_status.as_str() {
                "bounced" => ("failed", Some("outbound delivery bounced")),
                "expired" => ("failed", Some("outbound delivery expired")),
                _ => ("delivered", None),
            };
            info!("reconciling scheduled delivery_id={} status={}", delivery_id, status);
            notify_scheduled_complete(api_addr, &delivery_id, status, err_msg).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    #[tokio::test]
    async fn test_completion_retries_on_5xx() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let attempts = Arc::new(AtomicUsize::new(0));
        let attempts_clone = attempts.clone();

        tokio::spawn(async move {
            while let Ok((mut socket, _)) = listener.accept().await {
                let count = attempts_clone.fetch_add(1, Ordering::SeqCst) + 1;
                let mut buf = [0u8; 1024];
                let _ = socket.read(&mut buf).await;
                if count < 3 {
                    let resp = "HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                    let _ = socket.write_all(resp.as_bytes()).await;
                } else {
                    let resp = "HTTP/1.1 200 OK\r\nContent-Length: 15\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{\"status\":\"ok\"}";
                    let _ = socket.write_all(resp.as_bytes()).await;
                    break;
                }
            }
        });

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(2))
            .build()
            .unwrap();
        let api_addr = format!("127.0.0.1:{}", port);
        let res = notify_scheduled_complete_with_retries(
            &client,
            &api_addr,
            Some("test-key"),
            "test-delivery-id",
            "delivered",
            None,
            4,
            Duration::from_millis(10),
        )
        .await;

        assert!(res.is_ok(), "expected completion to succeed on 3rd attempt");
        assert_eq!(attempts.load(Ordering::SeqCst), 3, "expected exactly 3 attempts");
    }

    #[tokio::test]
    async fn test_completion_does_not_retry_on_4xx() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let attempts = Arc::new(AtomicUsize::new(0));
        let attempts_clone = attempts.clone();

        tokio::spawn(async move {
            while let Ok((mut socket, _)) = listener.accept().await {
                attempts_clone.fetch_add(1, Ordering::SeqCst);
                let mut buf = [0u8; 1024];
                let _ = socket.read(&mut buf).await;
                let resp = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                let _ = socket.write_all(resp.as_bytes()).await;
                break;
            }
        });

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(2))
            .build()
            .unwrap();
        let api_addr = format!("127.0.0.1:{}", port);
        let res = notify_scheduled_complete_with_retries(
            &client,
            &api_addr,
            Some("test-key"),
            "test-delivery-id",
            "delivered",
            None,
            4,
            Duration::from_millis(10),
        )
        .await;

        assert!(res.is_err(), "expected completion to fail on 404");
        assert_eq!(attempts.load(Ordering::SeqCst), 1, "expected exactly 1 attempt on 4xx");
    }

    #[test]
    fn test_dkim_identity_is_single_at_domain() {
        let sender = "x@y.byos.local";
        let email_raw = format!("From: {}\r\nSubject: Test\r\n\r\nHello", sender);
        let (_extracted_sender, extracted_domain) = extract_from_header(email_raw.as_bytes());
        assert_eq!(extracted_domain.as_deref(), Some("y.byos.local"));

        let domain_name = extracted_domain.unwrap();
        let header_i = format!("@{}", domain_name);

        assert_eq!(header_i, "@y.byos.local");
        assert_ne!(header_i, format!("@{}", sender));
        assert_ne!(header_i, "@x@y.byos.local");
        assert_eq!(header_i.matches('@').count(), 1, "header.i must contain exactly one @ symbol");

        let auth_results_hdr = format!(
            "Authentication-Results: byos.local; dkim=pass (2048-bit key) header.d={} header.i={} header.s=byos\r\n",
            domain_name, header_i
        );
        assert!(auth_results_hdr.contains("header.i=@y.byos.local"));
        assert!(!auth_results_hdr.contains("@x@y.byos.local"));
    }

    #[test]
    fn test_strip_bcc_single_to_no_bcc() {
        let raw = b"From: sender@byos.local\r\nTo: to@example.com\r\nSubject: Hello\r\n\r\nPlain body";
        let sanitized = strip_bcc_headers(raw);
        assert_eq!(sanitized.as_slice(), raw.as_slice());
    }

    #[test]
    fn test_strip_bcc_to_cc_bcc() {
        let raw = b"From: sender@byos.local\r\nTo: to@example.com\r\nCc: cc@example.com\r\nBcc: bcc@example.com\r\nSubject: Release A\r\n\r\nMessage body";
        let sanitized = strip_bcc_headers(raw);
        assert_eq!(
            String::from_utf8(sanitized).unwrap(),
            "From: sender@byos.local\r\nTo: to@example.com\r\nCc: cc@example.com\r\nSubject: Release A\r\n\r\nMessage body"
        );
    }

    #[test]
    fn test_strip_bcc_multiple_recipients_and_folded() {
        let raw = concat!(
            "From: sender@byos.local\r\n",
            "Bcc: secret1@example.com,\r\n",
            "\tsecret2@example.com,\r\n",
            "  secret3@example.com\r\n",
            "To: to@example.com\r\n",
            "\r\n",
            "Body"
        );
        let sanitized = strip_bcc_headers(raw.as_bytes());
        assert_eq!(
            String::from_utf8(sanitized).unwrap(),
            "From: sender@byos.local\r\nTo: to@example.com\r\n\r\nBody"
        );
    }

    #[test]
    fn test_strip_bcc_mixed_case_and_multiple_headers_and_obs_space() {
        let raw = concat!(
            "From: sender@byos.local\r\n",
            "bCc: first@example.com\r\n",
            "To: to@example.com\r\n",
            "BCC: second@example.com\r\n",
            "Bcc : obs@example.com\r\n",
            "Subject: Cases\r\n",
            "\r\n",
            "Hello"
        );
        let sanitized = String::from_utf8(strip_bcc_headers(raw.as_bytes())).unwrap();
        assert_eq!(
            sanitized,
            "From: sender@byos.local\r\nTo: to@example.com\r\nSubject: Cases\r\n\r\nHello"
        );
    }

    #[test]
    fn test_strip_bcc_preserves_literal_bcc_in_body() {
        let raw = concat!(
            "From: sender@byos.local\n",
            "To: to@example.com\n",
            "Bcc: real-hidden@example.com\n",
            "\n",
            "Note for user:\n",
            "Bcc: literal-in-body@example.com\r\n",
            "\r\n",
            "Trailing line"
        );
        let sanitized = String::from_utf8(strip_bcc_headers(raw.as_bytes())).unwrap();
        assert!(!sanitized.contains("real-hidden@example.com"));
        assert_eq!(
            sanitized,
            "From: sender@byos.local\nTo: to@example.com\n\nNote for user:\nBcc: literal-in-body@example.com\r\n\r\nTrailing line"
        );
    }

    #[test]
    fn test_strip_bcc_preserves_non_bcc_headers_and_folded_to_cc() {
        let raw = concat!(
            "From: sender@byos.local\r\n",
            "X-Bcc-Audit: keep-me\r\n",
            "To: a@example.com,\r\n",
            " b@example.com\r\n",
            "Bcc: secret@example.com\r\n",
            "Cc: c1@example.com,\r\n",
            "\tc2@example.com\r\n",
            "\r\n",
            "Body"
        );
        let sanitized = String::from_utf8(strip_bcc_headers(raw.as_bytes())).unwrap();
        assert_eq!(
            sanitized,
            concat!(
                "From: sender@byos.local\r\n",
                "X-Bcc-Audit: keep-me\r\n",
                "To: a@example.com,\r\n",
                " b@example.com\r\n",
                "Cc: c1@example.com,\r\n",
                "\tc2@example.com\r\n",
                "\r\n",
                "Body"
            )
        );
    }

    #[test]
    fn test_strip_bcc_as_last_header_before_delimiter() {
        let raw = b"From: sender@byos.local\r\nTo: a@example.com\r\nBcc: secret@example.com\r\n\r\nBody";
        let sanitized = String::from_utf8(strip_bcc_headers(raw)).unwrap();
        assert_eq!(
            sanitized,
            "From: sender@byos.local\r\nTo: a@example.com\r\n\r\nBody"
        );
    }

    #[test]
    fn test_parse_and_validate_recipients() {
        // Single recipient
        let r = parse_and_validate_recipients("alice@example.com").unwrap();
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].to_string(), "alice@example.com");

        // Comma & semicolon separated with extra whitespace & empty elements
        let r = parse_and_validate_recipients(" alice@example.com , ; bob@example.com ;  carol@example.org ").unwrap();
        let strs: Vec<String> = r.into_iter().map(|a| a.to_string()).collect();
        assert_eq!(
            strs,
            vec!["alice@example.com", "bob@example.com", "carol@example.org"]
        );

        // Quoted display names and case-insensitive deduplication preserving first occurrence
        let r = parse_and_validate_recipients(
            "\"Doe, Alice\" <Alice@Example.com>, alice@example.com; \"Bob\" <BOB@EXAMPLE.ORG>",
        )
        .unwrap();
        assert_eq!(r.len(), 2);
        assert_eq!(r[0].to_string().to_ascii_lowercase(), "alice@example.com");
        assert_eq!(r[1].to_string().to_ascii_lowercase(), "bob@example.org");

        // Malformed / empty / injection / single-label domain inputs must be rejected
        for bad in [
            "",
            "   , ;  ",
            "notanemail",
            "alice@localhost",
            "@missinglocal.com",
            "alice@example.com\r\nBcc: evil@attacker.com",
            "alice@example.com\nX-Inject: 1",
            "alice@example.com\0",
        ] {
            assert!(
                parse_and_validate_recipients(bad).is_err(),
                "expected error for invalid recipient {:?}",
                bad
            );
        }
    }

    #[test]
    fn test_dkim_sign_sanitized_message_matches_clean_body_and_excludes_bcc() {
        let kp = byos_crypto_core::DkimKeypair::generate("byos").expect("generate RSA DKIM keypair");

        let with_bcc = concat!(
            "From: sender@byos.local\r\n",
            "To: to@example.com\r\n",
            "Cc: cc@example.com\r\n",
            "Bcc: secret1@example.com, secret2@example.com\r\n",
            "Subject: DKIM Bcc Sanitization\r\n",
            "\r\n",
            "Confidential body line 1\r\nLine 2\r\n"
        );
        let without_bcc = concat!(
            "From: sender@byos.local\r\n",
            "To: to@example.com\r\n",
            "Cc: cc@example.com\r\n",
            "Subject: DKIM Bcc Sanitization\r\n",
            "\r\n",
            "Confidential body line 1\r\nLine 2\r\n"
        );

        let sanitized = strip_bcc_headers(with_bcc.as_bytes());
        assert_eq!(sanitized, without_bcc.as_bytes());

        let signed_sanitized = dkim_sign(&kp.private_key_pem, "byos", "byos.local", &sanitized).unwrap();
        let signed_clean = dkim_sign(&kp.private_key_pem, "byos", "byos.local", without_bcc.as_bytes()).unwrap();

        let signed_sanitized_str = String::from_utf8(signed_sanitized).unwrap();
        let signed_clean_str = String::from_utf8(signed_clean).unwrap();

        let dkim_sanitized = signed_sanitized_str.lines().next().unwrap();
        let dkim_clean = signed_clean_str.lines().next().unwrap();

        assert!(dkim_sanitized.starts_with("DKIM-Signature: v=1;"));
        let bh_sanitized = dkim_sanitized.split("bh=").nth(1).unwrap().split(';').next().unwrap();
        let bh_clean = dkim_clean.split("bh=").nth(1).unwrap().split(';').next().unwrap();
        assert_eq!(bh_sanitized, bh_clean, "DKIM body hash must match sanitized clean message");

        assert!(!signed_sanitized_str.contains("secret1@example.com"));
        assert!(!signed_sanitized_str.contains("secret2@example.com"));
        assert!(!signed_sanitized_str.to_ascii_lowercase().contains("\nbcc:"));
    }

    #[test]
    fn test_end_to_end_rust_smtp_delivery_captures_individual_rcpts_and_no_bcc_in_data() {
        use std::io::{BufRead, BufReader, Write};
        use std::net::TcpListener;
        use std::sync::{Arc, Mutex};

        let kp = byos_crypto_core::DkimKeypair::generate("byos").expect("generate DKIM keypair");

        let listener = TcpListener::bind("127.0.0.1:0").expect("bind mock SMTP port");
        let port = listener.local_addr().unwrap().port();

        let captured_mail_from = Arc::new(Mutex::new(String::new()));
        let captured_rcpts = Arc::new(Mutex::new(Vec::<String>::new()));
        let captured_data = Arc::new(Mutex::new(String::new()));

        let mf_clone = captured_mail_from.clone();
        let rcpt_clone = captured_rcpts.clone();
        let data_clone = captured_data.clone();

        let server_handle = std::thread::spawn(move || {
            if let Ok((stream, _)) = listener.accept() {
                let mut writer = stream.try_clone().unwrap();
                let mut reader = BufReader::new(stream);
                let _ = writer.write_all(b"220 mock-rust-smtp ESMTP\r\n");
                let _ = writer.flush();

                let mut in_data = false;
                let mut data_buf = String::new();
                let mut line = String::new();

                loop {
                    line.clear();
                    match reader.read_line(&mut line) {
                        Ok(0) | Err(_) => break,
                        Ok(_) => {}
                    }

                    if in_data {
                        if line == ".\r\n" || line == ".\n" {
                            in_data = false;
                            *data_clone.lock().unwrap() = data_buf.clone();
                            let _ = writer.write_all(b"250 2.0.0 OK queued\r\n");
                            let _ = writer.flush();
                        } else {
                            data_buf.push_str(&line);
                        }
                        continue;
                    }

                    let upper = line.trim().to_ascii_uppercase();
                    if upper.starts_with("EHLO") || upper.starts_with("HELO") {
                        let _ = writer.write_all(b"250-mock-rust-smtp\r\n250 8BITMIME\r\n");
                    } else if upper.starts_with("MAIL FROM:") {
                        *mf_clone.lock().unwrap() = line.trim().to_string();
                        let _ = writer.write_all(b"250 2.1.0 OK\r\n");
                    } else if upper.starts_with("RCPT TO:") {
                        let arg = line[8..].trim();
                        if arg.contains(',') {
                            let _ = writer.write_all(b"501 5.1.3 Multiple recipients invalid in RCPT TO\r\n");
                        } else {
                            rcpt_clone.lock().unwrap().push(line.trim().to_string());
                            let _ = writer.write_all(b"250 2.1.5 OK\r\n");
                        }
                    } else if upper == "DATA" {
                        in_data = true;
                        let _ = writer.write_all(b"354 Start mail input; end with <CRLF>.<CRLF>\r\n");
                    } else if upper == "QUIT" {
                        let _ = writer.write_all(b"221 2.0.0 Bye\r\n");
                        let _ = writer.flush();
                        break;
                    } else {
                        let _ = writer.write_all(b"250 OK\r\n");
                    }
                    let _ = writer.flush();
                }
            }
        });

        let raw_plaintext = concat!(
            "From: sender@byos.local\r\n",
            "To: to-recipient@external.com\r\n",
            "Cc: cc-recipient@external.com\r\n",
            "Bcc: secret-bcc1@external.com,\r\n",
            "\tsecret-bcc2@external.com\r\n",
            "Subject: E2E BCC Privacy Verification\r\n",
            "\r\n",
            "Hello team,\r\nBcc: literal-body-example@external.com\r\n"
        );
        let recipient_col = "to-recipient@external.com, cc-recipient@external.com; secret-bcc1@external.com, secret-bcc2@external.com";

        let sanitized_plaintext = strip_bcc_headers(raw_plaintext.as_bytes());
        let signed = dkim_sign(&kp.private_key_pem, "byos", "byos.local", &sanitized_plaintext).unwrap();
        let recipient_addrs = parse_and_validate_recipients(recipient_col).unwrap();
        let sender_addr: Address = "sender@byos.local".parse().unwrap();
        let envelope = Envelope::new(Some(sender_addr), recipient_addrs).unwrap();
        let final_message = assemble_final_message("byos.local", "byos", &signed);

        let smtp_addr = format!("127.0.0.1:{}", port);
        deliver_raw_to_smtp(&smtp_addr, &envelope, &final_message).expect("mock SMTP delivery must succeed");
        server_handle.join().expect("mock SMTP thread exited cleanly");

        assert_eq!(captured_mail_from.lock().unwrap().as_str(), "MAIL FROM:<sender@byos.local>");

        let rcpts = captured_rcpts.lock().unwrap().clone();
        assert_eq!(
            rcpts,
            vec![
                "RCPT TO:<to-recipient@external.com>",
                "RCPT TO:<cc-recipient@external.com>",
                "RCPT TO:<secret-bcc1@external.com>",
                "RCPT TO:<secret-bcc2@external.com>",
            ],
            "All 4 envelope recipients (To, Cc, 2x Bcc) must receive separate RCPT TO commands"
        );

        let data_payload = captured_data.lock().unwrap().clone();
        let (hdr_part, body_part) = data_payload.split_once("\r\n\r\n").expect("DATA must contain header/body separator");

        println!("[RUST-SMTP-CAPTURE] MAIL FROM: {}", captured_mail_from.lock().unwrap());
        for rcpt in &rcpts {
            println!("[RUST-SMTP-CAPTURE] {}", rcpt);
        }
        println!("[RUST-SMTP-CAPTURE] DATA Headers:\n{}", hdr_part);
        println!("[RUST-SMTP-CAPTURE] DATA Body:\n{}", body_part.trim_end());

        assert!(hdr_part.contains("Authentication-Results: byos.local; dkim=pass"));
        assert!(hdr_part.contains("DKIM-Signature: v=1;"));
        assert!(hdr_part.contains("To: to-recipient@external.com"));
        assert!(hdr_part.contains("Cc: cc-recipient@external.com"));
        assert!(
            !hdr_part.to_ascii_lowercase().contains("bcc:"),
            "Bcc header MUST NOT appear in transmitted SMTP DATA headers:\n{}",
            hdr_part
        );
        assert!(
            !data_payload.contains("secret-bcc1@external.com") && !data_payload.contains("secret-bcc2@external.com"),
            "Secret BCC addresses leaked into SMTP DATA:\n{}",
            data_payload
        );
        assert!(
            body_part.contains("Bcc: literal-body-example@external.com"),
            "Body literal text must remain intact:\n{}",
            body_part
        );
    }

    #[derive(Clone, Copy)]
    pub(super) enum MockGreeting {
        Banner(&'static str),
        DropImmediately,
        HangFor(Duration),
    }

    pub(super) struct ScriptedSmtpStep {
        pub(super) greeting: MockGreeting,
        pub(super) rcpt_responses: Vec<&'static str>,
        pub(super) data_response: &'static str,
    }

    #[derive(Default)]
    pub(super) struct MockSmtpStats {
        pub(super) connections: usize,
        pub(super) rcpt_commands: Vec<String>,
        pub(super) data_command_count: usize,
        pub(super) payloads: Vec<String>,
    }

    pub(super) fn spawn_scripted_smtp(
        steps: Vec<ScriptedSmtpStep>,
    ) -> (
        String,
        Arc<std::sync::Mutex<MockSmtpStats>>,
        std::thread::JoinHandle<()>,
    ) {
        use std::io::{BufRead, BufReader, Write};
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").expect("bind scripted mock SMTP");
        let port = listener.local_addr().unwrap().port();
        let stats = Arc::new(std::sync::Mutex::new(MockSmtpStats::default()));
        let stats_clone = stats.clone();

        let handle = std::thread::spawn(move || {
            for step in steps {
                let Ok((stream, _)) = listener.accept() else {
                    break;
                };
                stats_clone.lock().unwrap().connections += 1;

                match step.greeting {
                    MockGreeting::DropImmediately => {
                        drop(stream);
                        continue;
                    }
                    MockGreeting::HangFor(delay) => {
                        std::thread::sleep(delay);
                        drop(stream);
                        continue;
                    }
                    MockGreeting::Banner(banner) => {
                        let mut writer = stream.try_clone().unwrap();
                        let mut reader = BufReader::new(stream);
                        let _ = writer.write_all(banner.as_bytes());
                        let _ = writer.flush();

                        let mut rcpt_idx = 0usize;
                        let mut in_data = false;
                        let mut data_buf = String::new();
                        let mut line = String::new();

                        loop {
                            line.clear();
                            match reader.read_line(&mut line) {
                                Ok(0) | Err(_) => break,
                                Ok(_) => {}
                            }

                            if in_data {
                                if line == ".\r\n" || line == ".\n" {
                                    in_data = false;
                                    stats_clone.lock().unwrap().payloads.push(data_buf.clone());
                                    data_buf.clear();
                                    let _ = writer.write_all(step.data_response.as_bytes());
                                    let _ = writer.flush();
                                } else {
                                    data_buf.push_str(&line);
                                }
                                continue;
                            }

                            let upper = line.trim().to_ascii_uppercase();
                            if upper.starts_with("EHLO") || upper.starts_with("HELO") {
                                let _ = writer.write_all(b"250-mock-smtp\r\n250 8BITMIME\r\n");
                            } else if upper.starts_with("MAIL FROM:") {
                                let _ = writer.write_all(b"250 2.1.0 OK\r\n");
                            } else if upper.starts_with("RCPT TO:") {
                                stats_clone
                                    .lock()
                                    .unwrap()
                                    .rcpt_commands
                                    .push(line.trim().to_string());
                                let reply = step
                                    .rcpt_responses
                                    .get(rcpt_idx)
                                    .copied()
                                    .unwrap_or("250 2.1.5 OK\r\n");
                                rcpt_idx += 1;
                                let _ = writer.write_all(reply.as_bytes());
                            } else if upper == "DATA" {
                                stats_clone.lock().unwrap().data_command_count += 1;
                                in_data = true;
                                let _ = writer
                                    .write_all(b"354 Start mail input; end with <CRLF>.<CRLF>\r\n");
                            } else if upper == "QUIT" {
                                let _ = writer.write_all(b"221 2.0.0 Bye\r\n");
                                let _ = writer.flush();
                                break;
                            } else {
                                let _ = writer.write_all(b"250 OK\r\n");
                            }
                            let _ = writer.flush();
                        }
                    }
                }
            }
        });

        (format!("127.0.0.1:{}", port), stats, handle)
    }

    struct InMemoryQueueRecorder {
        status: &'static str,
        attempts: i32,
        delivered_at_set: bool,
        failed_at_set: bool,
        retry_count: usize,
        delivery_logs: Vec<(&'static str, Option<u16>, String)>,
        notifications: Vec<(String, Option<String>)>,
    }

    impl Default for InMemoryQueueRecorder {
        fn default() -> Self {
            Self {
                status: "pending",
                attempts: 0,
                delivered_at_set: false,
                failed_at_set: false,
                retry_count: 0,
                delivery_logs: Vec::new(),
                notifications: Vec::new(),
            }
        }
    }

    impl OutboundCompletionSink for InMemoryQueueRecorder {
        async fn record_delivered(
            &mut self,
            _queue_id: Uuid,
            _delivery_uuid: Uuid,
            _mailbox_uuid: Uuid,
            _domain_uuid: Uuid,
            _recipient: &str,
        ) -> Result<()> {
            self.status = "delivered";
            self.delivered_at_set = true;
            self.attempts += 1;
            self.delivery_logs
                .push(("delivered", Some(250), String::new()));
            Ok(())
        }

        async fn record_retry(&mut self, _queue_id: Uuid) -> Result<()> {
            self.attempts += 1;
            self.retry_count += 1;
            Ok(())
        }

        async fn record_bounced(
            &mut self,
            _queue_id: Uuid,
            _delivery_uuid: Uuid,
            _mailbox_uuid: Uuid,
            _domain_uuid: Uuid,
            _recipient: &str,
            smtp_code: Option<u16>,
            message: &str,
        ) -> Result<()> {
            self.status = "bounced";
            self.failed_at_set = true;
            self.attempts += 1;
            self.delivery_logs
                .push(("bounced", smtp_code, message.to_string()));
            Ok(())
        }

        async fn notify_scheduled(
            &mut self,
            _delivery_id: &str,
            status: &str,
            err_msg: Option<&str>,
        ) {
            self.notifications
                .push((status.to_string(), err_msg.map(str::to_string)));
        }
    }

    pub(super) fn build_test_envelope(recipients: &[&str]) -> Envelope {
        let sender: Address = "sender@byos.local".parse().unwrap();
        let rcpts: Vec<Address> = recipients.iter().map(|r| r.parse().unwrap()).collect();
        Envelope::new(Some(sender), rcpts).unwrap()
    }

    fn sample_test_message() -> &'static [u8] {
        b"From: sender@byos.local\r\nTo: to@external.com\r\nSubject: Classification Test\r\n\r\nBody\r\n"
    }

    #[test]
    fn test_classify_smtp_status_code_matrix() {
        for code in [400u16, 421, 450, 451, 452, 499] {
            assert_eq!(
                classify_smtp_status_code(Some(code)),
                SmtpFailureClass::Temporary,
                "expected SMTP {} to be classified as Temporary",
                code
            );
        }

        for code in [500u16, 501, 550, 551, 553, 554, 599] {
            assert_eq!(
                classify_smtp_status_code(Some(code)),
                SmtpFailureClass::Permanent,
                "expected SMTP {} to be classified as Permanent",
                code
            );
        }

        assert_eq!(
            classify_smtp_status_code(None),
            SmtpFailureClass::Temporary,
            "errors without an SMTP response code must retain safe retry policy"
        );
    }

    #[test]
    fn test_smtp_classification_for_bare_4xx_and_5xx_table() {
        let rcpt_cases = [
            (
                "bare 450",
                "450 Mailbox busy\r\n",
                Some(450u16),
                SmtpFailureClass::Temporary,
            ),
            (
                "bare 450 minimal",
                "450 \r\n",
                Some(450u16),
                SmtpFailureClass::Temporary,
            ),
            (
                "bare 451",
                "451 Requested action aborted: local error\r\n",
                Some(451u16),
                SmtpFailureClass::Temporary,
            ),
            (
                "bare 452",
                "452 Insufficient system storage\r\n",
                Some(452u16),
                SmtpFailureClass::Temporary,
            ),
            (
                "bare 421 on RCPT",
                "421 Service not available, closing transmission channel\r\n",
                Some(421u16),
                SmtpFailureClass::Temporary,
            ),
            (
                "bare 550",
                "550 Requested action not taken: mailbox unavailable\r\n",
                Some(550u16),
                SmtpFailureClass::Permanent,
            ),
            (
                "bare 551",
                "551 User not local\r\n",
                Some(551u16),
                SmtpFailureClass::Permanent,
            ),
            (
                "bare 553",
                "553 Mailbox name not allowed\r\n",
                Some(553u16),
                SmtpFailureClass::Permanent,
            ),
            (
                "bare 554",
                "554 Transaction failed\r\n",
                Some(554u16),
                SmtpFailureClass::Permanent,
            ),
        ];

        for (label, reply, expected_code, expected_class) in rcpt_cases {
            let (addr, stats, handle) = spawn_scripted_smtp(vec![ScriptedSmtpStep {
                greeting: MockGreeting::Banner("220 mock-smtp ESMTP\r\n"),
                rcpt_responses: vec![reply],
                data_response: "250 2.0.0 OK\r\n",
            }]);

            let env = build_test_envelope(&["recipient@external.com"]);
            let err = deliver_raw_to_smtp(&addr, &env, sample_test_message())
                .expect_err(&format!("case '{}' should fail delivery", label));
            handle.join().unwrap();

            assert_eq!(err.smtp_code, expected_code, "case '{}'", label);
            assert_eq!(err.class, expected_class, "case '{}'", label);
            assert_eq!(
                stats.lock().unwrap().data_command_count,
                0,
                "case '{}' must never transmit DATA",
                label
            );
        }

        // Also confirm 421 at SMTP greeting classifies as Temporary without reaching DATA.
        let (addr, stats, handle) = spawn_scripted_smtp(vec![ScriptedSmtpStep {
            greeting: MockGreeting::Banner("421 Service not available\r\n"),
            rcpt_responses: vec![],
            data_response: "250 2.0.0 OK\r\n",
        }]);
        let env = build_test_envelope(&["recipient@external.com"]);
        let err = deliver_raw_to_smtp(&addr, &env, sample_test_message()).unwrap_err();
        handle.join().unwrap();
        assert_eq!(err.smtp_code, Some(421));
        assert_eq!(err.class, SmtpFailureClass::Temporary);
        assert_eq!(stats.lock().unwrap().data_command_count, 0);
    }

    #[test]
    fn test_smtp_enhanced_status_codes_and_non_override_over_wire() {
        let cases = [
            (
                "450 4.2.0",
                "450 4.2.0 Mailbox temporarily unavailable\r\n",
                Some(450u16),
                SmtpFailureClass::Temporary,
            ),
            (
                "550 5.1.1",
                "550 5.1.1 <unknown@external.com>: Recipient address rejected\r\n",
                Some(550u16),
                SmtpFailureClass::Permanent,
            ),
            (
                "450 primary with contradictory 5.1.1 enhanced text",
                "450 5.1.1 Temporary throttle citing 5.1.1\r\n",
                Some(450u16),
                SmtpFailureClass::Temporary,
            ),
            (
                "550 primary with 4.2.0 connection timeout text",
                "550 4.2.0 Connection timeout mentioned in permanent rejection\r\n",
                Some(550u16),
                SmtpFailureClass::Permanent,
            ),
            (
                "multiline 550 with disagreed 4.7.1 code",
                "550-4.7.1 first line\r\n550 4.7.1 second line\r\n",
                Some(550u16),
                SmtpFailureClass::Permanent,
            ),
        ];

        for (label, reply, expected_code, expected_class) in cases {
            let (addr, stats, handle) = spawn_scripted_smtp(vec![ScriptedSmtpStep {
                greeting: MockGreeting::Banner("220 mock-smtp ESMTP\r\n"),
                rcpt_responses: vec![reply],
                data_response: "250 2.0.0 OK\r\n",
            }]);

            let env = build_test_envelope(&["recipient@external.com"]);
            let err = deliver_raw_to_smtp(&addr, &env, sample_test_message()).unwrap_err();
            handle.join().unwrap();

            assert_eq!(err.smtp_code, expected_code, "case '{}'", label);
            assert_eq!(err.class, expected_class, "case '{}'", label);
            assert_eq!(stats.lock().unwrap().data_command_count, 0);
        }
    }

    #[tokio::test]
    async fn test_smtp_connection_and_no_response_failures_retry_safely() {
        // 1. Unbound localhost port -> TCP connection refused (no response code)
        let unbound = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let closed_port = unbound.local_addr().unwrap().port();
        drop(unbound);

        let env = build_test_envelope(&["recipient@external.com"]);
        let refused_err = deliver_raw_to_smtp(
            &format!("127.0.0.1:{}", closed_port),
            &env,
            sample_test_message(),
        )
        .expect_err("closed port must error");
        assert_eq!(refused_err.smtp_code, None);
        assert!(
            refused_err.is_temporary(),
            "TCP connection failure must retry safely; got {:?}",
            refused_err
        );

        let mut sink = InMemoryQueueRecorder::default();
        let disposition = apply_smtp_delivery_outcome(
            &mut sink,
            Uuid::new_v4(),
            &Uuid::new_v4().to_string(),
            Uuid::new_v4(),
            Uuid::new_v4(),
            Uuid::new_v4(),
            Uuid::new_v4(),
            "recipient@external.com",
            "127.0.0.1",
            "byos.local",
            Err(refused_err),
        )
        .await
        .unwrap();
        assert!(matches!(
            disposition,
            QueueDeliveryDisposition::RetryScheduled {
                smtp_code: None,
                ..
            }
        ));
        assert_eq!(sink.status, "pending");
        assert_eq!(sink.attempts, 1);
        assert!(!sink.failed_at_set);
        assert!(sink.delivery_logs.is_empty());

        // 2. TCP listener drops connection immediately with zero SMTP bytes
        let (eof_addr, _, eof_handle) = spawn_scripted_smtp(vec![ScriptedSmtpStep {
            greeting: MockGreeting::DropImmediately,
            rcpt_responses: vec![],
            data_response: "",
        }]);
        let eof_err = deliver_raw_to_smtp(&eof_addr, &env, sample_test_message())
            .expect_err("immediate EOF must fail");
        eof_handle.join().unwrap();
        assert_eq!(eof_err.smtp_code, None);
        assert!(eof_err.is_temporary());

        // 3. Stalled TCP listener triggers socket timeout without response code
        let (hang_addr, _, hang_handle) = spawn_scripted_smtp(vec![ScriptedSmtpStep {
            greeting: MockGreeting::HangFor(Duration::from_millis(400)),
            rcpt_responses: vec![],
            data_response: "",
        }]);
        let timeout_err = deliver_raw_to_smtp_with_timeout(
            &hang_addr,
            &env,
            sample_test_message(),
            Some(Duration::from_millis(100)),
        )
        .expect_err("hung socket must time out");
        hang_handle.join().unwrap();
        assert_eq!(timeout_err.smtp_code, None);
        assert!(timeout_err.is_temporary());
    }

    #[tokio::test]
    async fn test_partial_rcpt_temporary_450_aborts_data_and_retries_without_duplicates() {
        let (addr, stats, handle) = spawn_scripted_smtp(vec![
            ScriptedSmtpStep {
                greeting: MockGreeting::Banner("220 mock-smtp ESMTP\r\n"),
                // Recipient 1 accepted, recipient 2 temporarily rejected with bare 450
                rcpt_responses: vec![
                    "250 2.1.5 OK\r\n",
                    "450 Mailbox temporarily unavailable\r\n",
                ],
                data_response: "250 2.0.0 OK queued\r\n",
            },
            ScriptedSmtpStep {
                greeting: MockGreeting::Banner("220 mock-smtp ESMTP\r\n"),
                // Retry accepts both recipients cleanly
                rcpt_responses: vec!["250 2.1.5 OK\r\n", "250 2.1.5 OK\r\n"],
                data_response: "250 2.0.0 OK queued\r\n",
            },
        ]);

        let env = build_test_envelope(&["accepted-first@external.com", "temp-second@external.com"]);
        let queue_id = Uuid::new_v4();
        let delivery_uuid = Uuid::new_v4();
        let delivery_id = delivery_uuid.to_string();
        let mailbox_uuid = Uuid::new_v4();
        let domain_uuid = Uuid::new_v4();
        let mut sink = InMemoryQueueRecorder::default();

        // Attempt 1: partial RCPT rejection (250 then bare 450)
        let attempt1 = deliver_raw_to_smtp(&addr, &env, sample_test_message());
        assert!(matches!(
            attempt1,
            Err(ref e) if e.smtp_code == Some(450) && e.is_temporary()
        ));
        {
            let guard = stats.lock().unwrap();
            assert_eq!(
                guard.data_command_count, 0,
                "aborted RCPT must not send DATA"
            );
            assert!(
                guard.payloads.is_empty(),
                "accepted recipient must receive zero partial messages"
            );
        }

        let disp1 = apply_smtp_delivery_outcome(
            &mut sink,
            queue_id,
            &delivery_id,
            delivery_uuid,
            mailbox_uuid,
            domain_uuid,
            domain_uuid,
            "accepted-first@external.com, temp-second@external.com",
            &addr,
            "byos.local",
            attempt1,
        )
        .await
        .unwrap();
        assert!(matches!(
            disp1,
            QueueDeliveryDisposition::RetryScheduled {
                smtp_code: Some(450),
                ..
            }
        ));
        assert_eq!(sink.status, "pending");
        assert_eq!(sink.attempts, 1);
        assert_eq!(sink.retry_count, 1);
        assert!(!sink.failed_at_set);
        assert!(sink.notifications.is_empty());

        // Attempt 2: retry succeeds cleanly across all recipients with one total DATA
        let attempt2 = deliver_raw_to_smtp(&addr, &env, sample_test_message());
        assert!(
            attempt2.is_ok(),
            "retry attempt must succeed: {:?}",
            attempt2
        );

        let disp2 = apply_smtp_delivery_outcome(
            &mut sink,
            queue_id,
            &delivery_id,
            delivery_uuid,
            mailbox_uuid,
            domain_uuid,
            domain_uuid,
            "accepted-first@external.com, temp-second@external.com",
            &addr,
            "byos.local",
            attempt2,
        )
        .await
        .unwrap();
        assert_eq!(disp2, QueueDeliveryDisposition::Delivered);
        assert_eq!(sink.status, "delivered");
        assert_eq!(sink.attempts, 2);
        assert!(sink.delivered_at_set);
        assert_eq!(sink.delivery_logs.len(), 1);
        assert_eq!(sink.delivery_logs[0].0, "delivered");
        assert_eq!(sink.notifications, vec![("delivered".to_string(), None)]);

        handle.join().unwrap();

        let guard = stats.lock().unwrap();
        assert_eq!(guard.connections, 2);
        assert_eq!(
            guard.rcpt_commands,
            vec![
                "RCPT TO:<accepted-first@external.com>",
                "RCPT TO:<temp-second@external.com>",
                "RCPT TO:<accepted-first@external.com>",
                "RCPT TO:<temp-second@external.com>",
            ]
        );
        assert_eq!(
            guard.data_command_count, 1,
            "accepted-first@external.com must receive DATA once total (zero duplicate DATA across retry)"
        );
        assert_eq!(guard.payloads.len(), 1);
    }

    #[tokio::test]
    async fn test_partial_rcpt_permanent_rejection_aborts_data_and_bounces_queue() {
        for (reply, expected_code) in [
            ("550 No such user here\r\n", 550u16),
            ("554 Transaction failed\r\n", 554u16),
        ] {
            let (addr, stats, handle) = spawn_scripted_smtp(vec![ScriptedSmtpStep {
                greeting: MockGreeting::Banner("220 mock-smtp ESMTP\r\n"),
                rcpt_responses: vec!["250 2.1.5 OK\r\n", reply],
                data_response: "250 2.0.0 OK queued\r\n",
            }]);

            let env =
                build_test_envelope(&["accepted-first@external.com", "perm-bad@external.com"]);
            let delivery_result = deliver_raw_to_smtp(&addr, &env, sample_test_message());
            handle.join().unwrap();

            assert!(matches!(
                delivery_result,
                Err(ref e) if e.smtp_code == Some(expected_code) && !e.is_temporary()
            ));
            {
                let guard = stats.lock().unwrap();
                assert_eq!(guard.data_command_count, 0, "rejected RCPT must block DATA");
                assert!(
                    guard.payloads.is_empty(),
                    "accepted recipient must receive zero partial messages"
                );
            }

            let mut sink = InMemoryQueueRecorder::default();
            let delivery_uuid = Uuid::new_v4();
            let disposition = apply_smtp_delivery_outcome(
                &mut sink,
                Uuid::new_v4(),
                &delivery_uuid.to_string(),
                delivery_uuid,
                Uuid::new_v4(),
                Uuid::new_v4(),
                Uuid::new_v4(),
                "accepted-first@external.com, perm-bad@external.com",
                &addr,
                "byos.local",
                delivery_result,
            )
            .await
            .unwrap();

            assert!(matches!(
                disposition,
                QueueDeliveryDisposition::Bounced {
                    smtp_code: Some(code),
                    ..
                } if code == expected_code
            ));
            assert_eq!(sink.status, "bounced");
            assert_eq!(sink.attempts, 1);
            assert!(sink.failed_at_set);
            assert_eq!(sink.delivery_logs.len(), 1);
            assert_eq!(sink.delivery_logs[0].0, "bounced");
            assert_eq!(sink.delivery_logs[0].1, Some(expected_code));
            assert_eq!(sink.notifications.len(), 1);
            assert_eq!(sink.notifications[0].0, "failed");
            assert!(sink.notifications[0].1.is_some());
        }
    }

    #[test]
    fn test_compute_retry_backoff_bounded() {
        assert_eq!(compute_retry_backoff(1), Duration::from_secs(60));
        assert_eq!(compute_retry_backoff(2), Duration::from_secs(120));
        assert_eq!(compute_retry_backoff(3), Duration::from_secs(240));
        assert_eq!(compute_retry_backoff(4), Duration::from_secs(480));
        assert_eq!(compute_retry_backoff(10), Duration::from_secs(3600));
    }

    pub(super) enum PhasedSmtpBehavior {
        DropAfterDataDot,
        HangAfterDataDot(Duration),
        RejectAfterDataDot(&'static str),
        PauseAfterDataDotThenAccept(Duration),
    }

    pub(super) fn spawn_phased_mock_smtp(
        behavior: PhasedSmtpBehavior,
    ) -> (
        String,
        Arc<std::sync::Mutex<MockSmtpStats>>,
        std::thread::JoinHandle<()>,
    ) {
        use std::io::{BufRead, BufReader, Write};
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").expect("bind phased mock SMTP");
        let port = listener.local_addr().unwrap().port();
        let stats = Arc::new(std::sync::Mutex::new(MockSmtpStats::default()));
        let stats_clone = stats.clone();

        let handle = std::thread::spawn(move || {
            let Ok((stream, _)) = listener.accept() else {
                return;
            };
            stats_clone.lock().unwrap().connections += 1;
            let mut writer = stream.try_clone().unwrap();
            let mut reader = BufReader::new(stream);
            let _ = writer.write_all(b"220 mock-phased ESMTP\r\n");
            let _ = writer.flush();

            let mut in_data = false;
            let mut data_buf = String::new();
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line) {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {}
                }
                if in_data {
                    if line == ".\r\n" || line == ".\n" {
                        stats_clone.lock().unwrap().payloads.push(data_buf.clone());
                        match &behavior {
                            PhasedSmtpBehavior::DropAfterDataDot => {
                                drop(writer);
                                drop(reader);
                                return;
                            }
                            PhasedSmtpBehavior::HangAfterDataDot(d) => {
                                std::thread::sleep(*d);
                                drop(writer);
                                drop(reader);
                                return;
                            }
                            PhasedSmtpBehavior::RejectAfterDataDot(reply) => {
                                let _ = writer.write_all(reply.as_bytes());
                                let _ = writer.flush();
                            }
                            PhasedSmtpBehavior::PauseAfterDataDotThenAccept(d) => {
                                std::thread::sleep(*d);
                                let _ = writer.write_all(b"250 2.0.0 OK delayed\r\n");
                                let _ = writer.flush();
                            }
                        }
                        in_data = false;
                        data_buf.clear();
                    } else {
                        data_buf.push_str(&line);
                    }
                    continue;
                }
                let upper = line.trim().to_ascii_uppercase();
                if upper.starts_with("EHLO") || upper.starts_with("HELO") {
                    let _ = writer.write_all(b"250-mock-phased\r\n250 8BITMIME\r\n");
                } else if upper.starts_with("MAIL FROM:") || upper.starts_with("RCPT TO:") {
                    if upper.starts_with("RCPT TO:") {
                        stats_clone
                            .lock()
                            .unwrap()
                            .rcpt_commands
                            .push(line.trim().to_string());
                    }
                    let _ = writer.write_all(b"250 2.1.5 OK\r\n");
                } else if upper == "DATA" {
                    stats_clone.lock().unwrap().data_command_count += 1;
                    in_data = true;
                    let _ = writer.write_all(b"354 End with <CRLF>.<CRLF>\r\n");
                } else if upper == "QUIT" {
                    let _ = writer.write_all(b"221 Bye\r\n");
                    let _ = writer.flush();
                    break;
                } else {
                    let _ = writer.write_all(b"250 OK\r\n");
                }
                let _ = writer.flush();
            }
        });

        (format!("127.0.0.1:{}", port), stats, handle)
    }

    #[derive(Debug, Clone, PartialEq, Eq)]
    pub(super) enum WireEvent {
        Command(String),
        EnteredDataMode,
        DataLineCount(usize),
        DataSnippet(String),
        EndOfDataMarker,
        FinalReplySent(u16),
        ClientEofInDataMode,
        ClientEofInCommandMode,
    }

    pub(super) enum WireServerBehavior {
        Accept250,
        DropAfterDataDot,
        HangAfterDataDot(Duration),
        ReplyAfterDataDot(&'static str, u16),
        DropDuringDataAfterLines(usize),
    }

    pub(super) fn spawn_wire_transcript_smtp(
        behavior: WireServerBehavior,
    ) -> (
        String,
        Arc<std::sync::Mutex<Vec<WireEvent>>>,
        Arc<std::sync::Mutex<Vec<String>>>,
        std::thread::JoinHandle<()>,
    ) {
        use std::io::{BufRead, BufReader, Write};
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").expect("bind wire transcript mock SMTP");
        let port = listener.local_addr().unwrap().port();
        let events = Arc::new(std::sync::Mutex::new(Vec::new()));
        let payloads = Arc::new(std::sync::Mutex::new(Vec::new()));
        let events_clone = events.clone();
        let payloads_clone = payloads.clone();

        let handle = std::thread::spawn(move || {
            let Ok((stream, _)) = listener.accept() else {
                return;
            };
            let mut writer = stream.try_clone().unwrap();
            let mut reader = BufReader::new(stream);
            let _ = writer.write_all(b"220 mock-wire ESMTP\r\n");
            let _ = writer.flush();

            let mut in_data = false;
            let mut data_buf = String::new();
            let mut data_lines = 0usize;
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line) {
                    Ok(0) | Err(_) => {
                        let ev = if in_data {
                            WireEvent::ClientEofInDataMode
                        } else {
                            WireEvent::ClientEofInCommandMode
                        };
                        events_clone.lock().unwrap().push(ev);
                        break;
                    }
                    Ok(_) => {}
                }
                if in_data {
                    if line == ".\r\n" || line == ".\n" {
                        events_clone
                            .lock()
                            .unwrap()
                            .push(WireEvent::DataLineCount(data_lines));
                        events_clone
                            .lock()
                            .unwrap()
                            .push(WireEvent::EndOfDataMarker);
                        payloads_clone.lock().unwrap().push(data_buf.clone());
                        match &behavior {
                            WireServerBehavior::Accept250 => {
                                let _ = writer.write_all(b"250 2.0.0 OK accepted\r\n");
                                let _ = writer.flush();
                                events_clone
                                    .lock()
                                    .unwrap()
                                    .push(WireEvent::FinalReplySent(250));
                            }
                            WireServerBehavior::DropAfterDataDot => {
                                drop(writer);
                                drop(reader);
                                return;
                            }
                            WireServerBehavior::HangAfterDataDot(d) => {
                                std::thread::sleep(*d);
                                drop(writer);
                                drop(reader);
                                return;
                            }
                            WireServerBehavior::ReplyAfterDataDot(reply, code) => {
                                let _ = writer.write_all(reply.as_bytes());
                                let _ = writer.flush();
                                events_clone
                                    .lock()
                                    .unwrap()
                                    .push(WireEvent::FinalReplySent(*code));
                            }
                            WireServerBehavior::DropDuringDataAfterLines(_) => {
                                let _ = writer.write_all(b"250 OK\r\n");
                                let _ = writer.flush();
                                events_clone
                                    .lock()
                                    .unwrap()
                                    .push(WireEvent::FinalReplySent(250));
                            }
                        }
                        in_data = false;
                        data_buf.clear();
                        data_lines = 0;
                    } else {
                        data_lines += 1;
                        if data_lines <= 64 {
                            events_clone
                                .lock()
                                .unwrap()
                                .push(WireEvent::DataSnippet(line.clone()));
                        }
                        if let Some(unescaped) = line.strip_prefix("..") {
                            data_buf.push('.');
                            data_buf.push_str(unescaped);
                        } else {
                            data_buf.push_str(&line);
                        }
                        if let WireServerBehavior::DropDuringDataAfterLines(limit) = behavior {
                            if data_lines >= limit {
                                drop(writer);
                                drop(reader);
                                return;
                            }
                        }
                    }
                    continue;
                }
                let trimmed = line.trim_end_matches(&['\r', '\n'][..]).to_string();
                let upper = trimmed.to_ascii_uppercase();
                events_clone
                    .lock()
                    .unwrap()
                    .push(WireEvent::Command(upper.clone()));
                if upper.starts_with("EHLO") || upper.starts_with("HELO") {
                    let _ = writer.write_all(b"250-mock-wire\r\n250 8BITMIME\r\n");
                } else if upper.starts_with("MAIL FROM:") || upper.starts_with("RCPT TO:") {
                    let _ = writer.write_all(b"250 2.1.5 OK\r\n");
                } else if upper == "DATA" {
                    in_data = true;
                    let _ = writer.write_all(b"354 End with <CRLF>.<CRLF>\r\n");
                    events_clone.lock().unwrap().push(WireEvent::EnteredDataMode);
                } else if upper == "RSET" {
                    let _ = writer.write_all(b"250 2.0.0 Reset\r\n");
                } else if upper == "QUIT" {
                    let _ = writer.write_all(b"221 Bye\r\n");
                    let _ = writer.flush();
                    break;
                } else {
                    let _ = writer.write_all(b"250 OK\r\n");
                }
                let _ = writer.flush();
            }
        });

        (format!("127.0.0.1:{}", port), events, payloads, handle)
    }

    #[tokio::test]
    async fn test_phased_smtp_post_data_disconnect_and_timeout_return_ambiguous() {
        let env = build_test_envelope(&["recipient@external.com"]);

        // 1. Socket dropped immediately after <CRLF>.<CRLF> with no reply -> AmbiguousAfterTerminator
        let (addr_drop, stats_drop, h_drop) =
            spawn_phased_mock_smtp(PhasedSmtpBehavior::DropAfterDataDot);
        let outcome_drop = deliver_raw_to_smtp_phased_with_timeout(
            &addr_drop,
            &env,
            sample_test_message(),
            Some(Duration::from_secs(2)),
            || async { Ok(true) },
            || async { Ok(true) },
            || async { Ok(true) },
        )
        .await
        .unwrap();
        h_drop.join().unwrap();
        assert!(matches!(
            outcome_drop,
            SmtpDeliveryOutcome::AmbiguousAfterTerminator { .. }
        ));
        assert_eq!(stats_drop.lock().unwrap().payloads.len(), 1);

        // 2. Socket hangs past timeout after <CRLF>.<CRLF> -> AmbiguousAfterTerminator
        let (addr_hang, stats_hang, h_hang) =
            spawn_phased_mock_smtp(PhasedSmtpBehavior::HangAfterDataDot(Duration::from_millis(600)));
        let outcome_hang = deliver_raw_to_smtp_phased_with_timeout(
            &addr_hang,
            &env,
            sample_test_message(),
            Some(Duration::from_millis(120)),
            || async { Ok(true) },
            || async { Ok(true) },
            || async { Ok(true) },
        )
        .await
        .unwrap();
        h_hang.join().unwrap();
        assert!(matches!(
            outcome_hang,
            SmtpDeliveryOutcome::AmbiguousAfterTerminator { .. }
        ));
        assert_eq!(stats_hang.lock().unwrap().payloads.len(), 1);

        // 3. Explicit 451 / 550 after <CRLF>.<CRLF> -> RejectedAfterTerminator (not ambiguous)
        for (reply, expected_code, expected_temp) in [
            ("451 4.3.0 Temporary queue error\r\n", 451u16, true),
            ("550 5.7.1 Message rejected\r\n", 550u16, false),
        ] {
            let (addr_rej, _, h_rej) =
                spawn_phased_mock_smtp(PhasedSmtpBehavior::RejectAfterDataDot(reply));
            let outcome_rej = deliver_raw_to_smtp_phased_with_timeout(
                &addr_rej,
                &env,
                sample_test_message(),
                Some(Duration::from_secs(2)),
                || async { Ok(true) },
                || async { Ok(true) },
                || async { Ok(true) },
            )
            .await
            .unwrap();
            h_rej.join().unwrap();
            assert!(matches!(
                outcome_rej,
                SmtpDeliveryOutcome::RejectedAfterTerminator(ref e)
                    if e.smtp_code == Some(expected_code) && e.is_temporary() == expected_temp
            ));
        }
    }

    #[tokio::test]
    async fn test_phased_smtp_stale_lease_aborts_before_sending_data_body() {
        let env = build_test_envelope(&["recipient@external.com"]);
        let (addr, events, payloads, h) =
            spawn_wire_transcript_smtp(WireServerBehavior::DropAfterDataDot);
        let outcome = deliver_raw_to_smtp_phased_with_timeout(
            &addr,
            &env,
            sample_test_message(),
            Some(Duration::from_secs(2)),
            || async { Ok(false) },
            || async { unreachable!("must never enter DATA streaming hook if pre_data aborted") },
            || async { unreachable!("must never enter terminator hook if pre_data aborted") },
        )
        .await
        .unwrap();
        h.join().unwrap();
        assert_eq!(outcome, SmtpDeliveryOutcome::StaleLeaseAbortedBeforeData);
        let log = events.lock().unwrap().clone();
        assert!(payloads.lock().unwrap().is_empty());
        assert!(!log.contains(&WireEvent::EnteredDataMode));
        assert!(!log.contains(&WireEvent::EndOfDataMarker));
        assert!(!log.iter().any(|e| matches!(e, WireEvent::Command(c) if c.starts_with("MAIL FROM:"))));
        assert!(log.contains(&WireEvent::Command("QUIT".to_string())));
    }

    #[tokio::test]
    async fn test_wire_dot_stuffing_and_clean_250_delivery() {
        let env = build_test_envelope(&["recipient@external.com"]);
        let msg = b"Subject: Dot Test\r\n\r\n.leading dot\r\n..\r\nnormal line\r\n.no trailing crlf";
        let (stuffed, term) = smtp_dot_stuff_body(msg);
        assert_eq!(term, b"\r\n.\r\n");
        let stuffed_str = String::from_utf8(stuffed).unwrap();
        assert!(stuffed_str.contains("\r\n..leading dot\r\n"));
        assert!(stuffed_str.contains("\r\n...\r\n"));
        assert!(stuffed_str.ends_with("\r\n..no trailing crlf"));

        let (stuffed_crlf, term_crlf) = smtp_dot_stuff_body(b".byte0\r\n.\r\n");
        assert_eq!(term_crlf, b".\r\n");
        assert_eq!(stuffed_crlf, b"..byte0\r\n..\r\n");

        let (addr, events, payloads, h) = spawn_wire_transcript_smtp(WireServerBehavior::Accept250);
        let outcome = deliver_raw_to_smtp_phased_with_timeout(
            &addr,
            &env,
            msg,
            Some(Duration::from_secs(2)),
            || async { Ok(true) },
            || async { Ok(true) },
            || async { Ok(true) },
        )
        .await
        .unwrap();
        h.join().unwrap();
        assert_eq!(outcome, SmtpDeliveryOutcome::Delivered { smtp_code: 250 });
        let log = events.lock().unwrap();
        assert!(log.contains(&WireEvent::EnteredDataMode));
        assert!(log.contains(&WireEvent::EndOfDataMarker));
        assert!(log.contains(&WireEvent::FinalReplySent(250)));
        assert!(log.contains(&WireEvent::Command("QUIT".to_string())));
        let received = &payloads.lock().unwrap()[0];
        assert!(received.contains("\r\n.leading dot\r\n"));
        assert!(received.contains("\r\n..\r\n"));
        assert!(received.contains("\r\n.no trailing crlf\r\n"));
    }

    #[tokio::test]
    async fn test_wire_stale_immediately_after_354_drops_socket_without_rset_quit_or_dot() {
        let env = build_test_envelope(&["recipient@external.com"]);
        let (addr, events, payloads, h) = spawn_wire_transcript_smtp(WireServerBehavior::Accept250);
        let outcome = deliver_raw_to_smtp_phased_with_timeout(
            &addr,
            &env,
            sample_test_message(),
            Some(Duration::from_secs(2)),
            || async { Ok(true) },
            || async { Ok(false) },
            || async { unreachable!("must not reach terminator hook") },
        )
        .await
        .unwrap();
        h.join().unwrap();
        assert_eq!(outcome, SmtpDeliveryOutcome::StaleLeaseAbortedInDataStreaming);
        assert!(payloads.lock().unwrap().is_empty());
        let log = events.lock().unwrap();
        assert!(log.contains(&WireEvent::EnteredDataMode));
        assert!(log.contains(&WireEvent::ClientEofInDataMode));
        assert!(!log.contains(&WireEvent::EndOfDataMarker));
        assert!(!log.contains(&WireEvent::Command("RSET".to_string())));
        assert!(!log.contains(&WireEvent::Command("QUIT".to_string())));
        assert!(!log.iter().any(|e| matches!(e, WireEvent::DataSnippet(_))));
    }

    #[tokio::test]
    async fn test_wire_stale_during_chunked_streaming_closes_without_terminator_or_commands() {
        let env = build_test_envelope(&["recipient@external.com"]);
        // Exceed 32KB chunk size so streaming pauses cleanly mid-body at on_mid_stream.
        let mut large_msg = b"From: s@example.test\r\nSubject: Chunked\r\n\r\n".to_vec();
        for i in 0..700 {
            large_msg.extend_from_slice(
                format!("Line {:04}: 0123456789abcdef0123456789abcdef0123456789abcdef\r\n", i)
                    .as_bytes(),
            );
        }
        let mid_reached = Arc::new(AtomicBool::new(false));
        let mid_reached_inner = mid_reached.clone();

        let (addr, events, payloads, h) = spawn_wire_transcript_smtp(WireServerBehavior::Accept250);
        let outcome = deliver_raw_to_smtp_phased_impl(
            &addr,
            &env,
            &large_msg,
            Some(Duration::from_secs(2)),
            || async { Ok(true) },
            || async { Ok(true) },
            || async move {
                mid_reached_inner.store(true, Ordering::SeqCst);
                Ok(())
            },
            || async { Ok(false) },
        )
        .await
        .unwrap();
        h.join().unwrap();

        assert!(mid_reached.load(Ordering::SeqCst));
        assert_eq!(outcome, SmtpDeliveryOutcome::StaleLeaseAbortedInDataStreaming);
        assert!(payloads.lock().unwrap().is_empty());
        let log = events.lock().unwrap();
        assert!(log.contains(&WireEvent::EnteredDataMode));
        assert!(log.iter().any(|e| matches!(e, WireEvent::DataSnippet(_))));
        assert!(log.contains(&WireEvent::ClientEofInDataMode));
        assert!(!log.contains(&WireEvent::EndOfDataMarker));
        assert!(!log.contains(&WireEvent::Command("RSET".to_string())));
        assert!(!log.contains(&WireEvent::Command("QUIT".to_string())));
    }

    #[tokio::test]
    async fn test_wire_db_error_at_terminator_fence_aborts_without_marker_and_body_write_drop_fails_streaming() {
        let env = build_test_envelope(&["recipient@external.com"]);

        // 1. DB error when fencing terminator_in_flight closes socket without ".\r\n", RSET, QUIT, returns Err.
        let (addr_err, events_err, payloads_err, h_err) =
            spawn_wire_transcript_smtp(WireServerBehavior::Accept250);
        let res = deliver_raw_to_smtp_phased_with_timeout(
            &addr_err,
            &env,
            sample_test_message(),
            Some(Duration::from_secs(2)),
            || async { Ok(true) },
            || async { Ok(true) },
            || async { Err(anyhow::anyhow!("simulated db outage at terminator fence")) },
        )
        .await;
        h_err.join().unwrap();
        assert!(res.is_err());
        assert!(payloads_err.lock().unwrap().is_empty());
        let log = events_err.lock().unwrap();
        assert!(log.contains(&WireEvent::ClientEofInDataMode));
        assert!(!log.contains(&WireEvent::EndOfDataMarker));
        assert!(!log.contains(&WireEvent::Command("RSET".to_string())));
        assert!(!log.contains(&WireEvent::Command("QUIT".to_string())));

        // 2. Server disconnect mid-body before terminator -> FailedDuringDataStreaming (NOT AmbiguousAfterTerminator).
        let mut huge = b"Subject: Drop mid\r\n\r\n".to_vec();
        for i in 0..4000 {
            huge.extend_from_slice(format!("Row {}: payload-bytes-for-tcp-drop-test\r\n", i).as_bytes());
        }
        let (addr_mid, events_mid, payloads_mid, h_mid) =
            spawn_wire_transcript_smtp(WireServerBehavior::DropDuringDataAfterLines(5));
        let outcome_mid = deliver_raw_to_smtp_phased_impl(
            &addr_mid,
            &env,
            &huge,
            Some(Duration::from_secs(2)),
            || async { Ok(true) },
            || async { Ok(true) },
            || async {
                sleep(Duration::from_millis(40)).await;
                Ok(())
            },
            || async { Ok(true) },
        )
        .await
        .unwrap();
        h_mid.join().unwrap();
        assert!(matches!(
            outcome_mid,
            SmtpDeliveryOutcome::FailedDuringDataStreaming(_)
        ));
        assert!(payloads_mid.lock().unwrap().is_empty());
        assert!(!events_mid.lock().unwrap().contains(&WireEvent::EndOfDataMarker));

        // 3. Timeout waiting for reply AFTER <CRLF>.<CRLF> -> EndOfDataMarker sent, AmbiguousAfterTerminator.
        let (addr_hang, events_hang, _, h_hang) =
            spawn_wire_transcript_smtp(WireServerBehavior::HangAfterDataDot(Duration::from_millis(450)));
        let outcome_hang = deliver_raw_to_smtp_phased_with_timeout(
            &addr_hang,
            &env,
            sample_test_message(),
            Some(Duration::from_millis(120)),
            || async { Ok(true) },
            || async { Ok(true) },
            || async { Ok(true) },
        )
        .await
        .unwrap();
        h_hang.join().unwrap();
        assert!(matches!(
            outcome_hang,
            SmtpDeliveryOutcome::AmbiguousAfterTerminator { .. }
        ));
        assert!(events_hang.lock().unwrap().contains(&WireEvent::EndOfDataMarker));
    }

    fn smtp_dot_unstuff_wire_data(wire_data: &[u8]) -> Vec<u8> {
        // Simulates an RFC 5321 §4.5.2 SMTP receiver stripping the end-of-data marker
        // and unstuffing leading '.' on each CRLF-delimited line.
        let without_eod = if let Some(prefix) = wire_data.strip_suffix(b"\r\n.\r\n") {
            let mut out = prefix.to_vec();
            out.extend_from_slice(b"\r\n");
            out
        } else {
            wire_data.to_vec()
        };
        let mut unstuffed = Vec::with_capacity(without_eod.len());
        let mut at_line_start = true;
        let mut i = 0usize;
        while i < without_eod.len() {
            if at_line_start && without_eod[i] == b'.' && without_eod.get(i + 1) == Some(&b'.') {
                unstuffed.push(b'.');
                i += 2;
                at_line_start = false;
                continue;
            }
            let b = without_eod[i];
            unstuffed.push(b);
            if b == b'\n' && i > 0 && without_eod[i - 1] == b'\r' {
                at_line_start = true;
            } else if b != b'\r' {
                at_line_start = false;
            }
            i += 1;
        }
        unstuffed
    }

    #[tokio::test]
    async fn test_wire_multiline_ehlo_and_capability_negotiation() {
        use std::io::{BufRead, BufReader, Write};
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap().to_string();
        let seen_cmds = Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
        let seen_clone = seen_cmds.clone();

        let h = std::thread::spawn(move || {
            for idx in 0..3 {
                let Ok((stream, _)) = listener.accept() else {
                    break;
                };
                let mut writer = stream.try_clone().unwrap();
                let mut reader = BufReader::new(stream);
                let _ = writer.write_all(b"220-mail.byos.local ESMTP\r\n220 Ready\r\n");
                let _ = writer.flush();
                let mut in_data = false;
                let mut line = String::new();
                loop {
                    line.clear();
                    if reader.read_line(&mut line).unwrap_or(0) == 0 {
                        break;
                    }
                    if in_data {
                        if line == ".\r\n" {
                            in_data = false;
                            let _ = writer.write_all(b"250-2.0.0 Queued\r\n250 Accepted\r\n");
                            let _ = writer.flush();
                        }
                        continue;
                    }
                    let trimmed = line.trim_end_matches(&['\r', '\n'][..]).to_string();
                    seen_clone.lock().unwrap().push(trimmed.clone());
                    let upper = trimmed.to_ascii_uppercase();
                    if upper.starts_with("EHLO") {
                        if idx == 0 {
                            let _ = writer.write_all(
                                b"250-mail.byos.local\r\n250-PIPELINING\r\n250-SIZE 10485760\r\n250-STARTTLS\r\n250-8BITMIME\r\n250 SMTPUTF8\r\n",
                            );
                        } else if idx == 1 {
                            let _ = writer.write_all(b"250-mail.byos.local\r\n250 PIPELINING\r\n");
                        } else {
                            let _ = writer.write_all(b"502 5.5.1 EHLO unsupported\r\n");
                        }
                    } else if upper.starts_with("MAIL FROM:") || upper.starts_with("RCPT TO:") {
                        let _ = writer.write_all(b"250 2.1.0 OK\r\n");
                    } else if upper == "DATA" {
                        in_data = true;
                        let _ = writer.write_all(b"354-Send data\r\n354 End with <CRLF>.<CRLF>\r\n");
                    } else if upper == "QUIT" {
                        let _ = writer.write_all(b"221 Bye\r\n");
                        let _ = writer.flush();
                        break;
                    } else {
                        let _ = writer.write_all(b"500 Unknown\r\n");
                    }
                    let _ = writer.flush();
                }
            }
        });

        let env = build_test_envelope(&["recipient@external.com"]);
        let utf8_msg = "From: sender@byos.local\r\nSubject: Café\r\n\r\nBonjour café\r\n".as_bytes();

        // 1. Multiline EHLO advertising 8BITMIME + SMTPUTF8 + STARTTLS -> sends BODY=8BITMIME, never sends STARTTLS
        let ok_res = deliver_raw_to_smtp_phased_with_timeout(
            &addr,
            &env,
            utf8_msg,
            Some(Duration::from_secs(2)),
            || async { Ok(true) },
            || async { Ok(true) },
            || async { Ok(true) },
        )
        .await
        .unwrap();
        assert_eq!(ok_res, SmtpDeliveryOutcome::Delivered { smtp_code: 250 });

        // 2. Non-ASCII body when server EHLO omits 8BITMIME -> fails Permanent before DATA
        let no_8bit = deliver_raw_to_smtp_phased_with_timeout(
            &addr,
            &env,
            utf8_msg,
            Some(Duration::from_secs(2)),
            || async { unreachable!("must not advance to pre_data") },
            || async { unreachable!() },
            || async { unreachable!() },
        )
        .await
        .unwrap();
        assert!(matches!(
            no_8bit,
            SmtpDeliveryOutcome::FailedBeforeData(ref e) if !e.is_temporary() && e.message.contains("8BITMIME")
        ));

        // 3. EHLO 502 -> fails Permanent without HELO fallback
        let ehlo_502 = deliver_raw_to_smtp_phased_with_timeout(
            &addr,
            &env,
            sample_test_message(),
            Some(Duration::from_secs(2)),
            || async { unreachable!() },
            || async { unreachable!() },
            || async { unreachable!() },
        )
        .await
        .unwrap();
        assert!(matches!(
            ehlo_502,
            SmtpDeliveryOutcome::FailedBeforeData(ref e) if e.smtp_code == Some(502) && !e.is_temporary()
        ));

        h.join().unwrap();
        let cmds = seen_cmds.lock().unwrap();
        assert!(cmds.iter().any(|c| c.contains("BODY=8BITMIME")));
        assert!(!cmds.iter().any(|c| c.eq_ignore_ascii_case("STARTTLS")));
        assert!(!cmds.iter().any(|c| c.to_ascii_uppercase().starts_with("HELO")));
    }

    #[tokio::test]
    async fn test_wire_malformed_and_oversized_smtp_replies() {
        use std::io::{Cursor, Write};
        use std::net::TcpListener;

        // Direct parser cases
        for (label, raw) in [
            ("mismatched multiline code", b"250-first line\r\n450 second line\r\n".as_slice()),
            ("invalid separator char", b"250Xbad separator\r\n".as_slice()),
            ("multibyte utf8 separator", "250é\r\n".as_bytes()),
            ("non-digit code", b"abc ok\r\n".as_slice()),
            ("short line", b"25\r\n".as_slice()),
            ("invalid utf8", b"250 \xff\xfe\r\n".as_slice()),
            ("out-of-range 000", b"000 bad\r\n".as_slice()),
            ("out-of-range 100", b"100 info\r\n".as_slice()),
            ("out-of-range 600", b"600 bad\r\n".as_slice()),
            ("out-of-range 999", b"999 bogus\r\n".as_slice()),
        ] {
            let mut cursor = BufReader::new(Cursor::new(raw));
            let err = read_smtp_reply(&mut cursor)
                .await
                .expect_err(&format!("case '{}' must fail", label));
            assert_eq!(err.kind(), std::io::ErrorKind::InvalidData, "case '{}'", label);
        }

        // Exact line-length boundary: 2048 bytes succeeds, 2049 bytes (with or without \n) fails
        let mut exact_ok = b"250 ".to_vec();
        exact_ok.extend(std::iter::repeat_n(b'A', 2042));
        exact_ok.extend_from_slice(b"\r\n");
        assert_eq!(exact_ok.len(), 2048);
        let mut exact_cursor = BufReader::new(Cursor::new(exact_ok));
        let ok_reply = read_smtp_reply(&mut exact_cursor).await.unwrap().unwrap();
        assert_eq!(ok_reply.code, 250);

        let mut exact_over_no_nl = b"250 ".to_vec();
        exact_over_no_nl.extend(std::iter::repeat_n(b'A', 2045));
        assert_eq!(exact_over_no_nl.len(), 2049);
        let mut over_no_nl_cursor = BufReader::new(Cursor::new(exact_over_no_nl));
        let over_no_nl_err = read_smtp_reply(&mut over_no_nl_cursor).await.unwrap_err();
        assert_eq!(over_no_nl_err.kind(), std::io::ErrorKind::InvalidData);

        // Total multiline reply limit (> 100_000 bytes across valid lines) fails safely
        let mut huge_multiline = Vec::new();
        let line_chunk = format!("250-{}\r\n", "X".repeat(1994)); // 2000 bytes/line
        for _ in 0..51 {
            huge_multiline.extend_from_slice(line_chunk.as_bytes());
        }
        huge_multiline.extend_from_slice(b"250 OK\r\n");
        let mut huge_cursor = BufReader::new(Cursor::new(huge_multiline));
        let huge_err = read_smtp_reply(&mut huge_cursor).await.unwrap_err();
        assert_eq!(huge_err.kind(), std::io::ErrorKind::InvalidData);

        // Oversized single line (> 2048 bytes) without waiting for unbounded memory
        let mut oversized = b"250 ".to_vec();
        oversized.extend(std::iter::repeat_n(b'A', 3000));
        oversized.extend_from_slice(b"\r\n");
        let mut over_cursor = BufReader::new(Cursor::new(oversized));
        let over_err = read_smtp_reply(&mut over_cursor).await.unwrap_err();
        assert_eq!(over_err.kind(), std::io::ErrorKind::InvalidData);

        // End-to-end mismatched multiline EHLO fails safely pre-DATA as Temporary
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap().to_string();
        let h = std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let _ = stream.write_all(b"220 mock\r\n");
                let _ = stream.flush();
                let mut buf = [0u8; 512];
                let _ = std::io::Read::read(&mut stream, &mut buf);
                let _ = stream.write_all(b"250-mock\r\n550 mismatched\r\n");
                let _ = stream.flush();
            }
        });
        let env = build_test_envelope(&["recipient@external.com"]);
        let outcome = deliver_raw_to_smtp_phased_with_timeout(
            &addr,
            &env,
            sample_test_message(),
            Some(Duration::from_secs(2)),
            || async { Ok(true) },
            || async { Ok(true) },
            || async { Ok(true) },
        )
        .await
        .unwrap();
        h.join().unwrap();
        assert!(matches!(
            outcome,
            SmtpDeliveryOutcome::FailedBeforeData(ref e) if e.smtp_code == None && e.is_temporary()
        ));
    }

    #[tokio::test]
    async fn test_wire_incomplete_smtp_server_responses() {
        use std::io::{BufRead, Cursor, Write};
        use std::net::TcpListener;

        // Direct parser incomplete/truncated cases
        for (label, raw) in [
            ("truncated multiline EOF", b"250-first line\r\n".as_slice()),
            ("unterminated single line", b"250 OK".as_slice()),
            ("unterminated bare code", b"250".as_slice()),
            ("unterminated multiline last line", b"250-first\r\n250 last".as_slice()),
        ] {
            let mut cursor = BufReader::new(Cursor::new(raw));
            let err = read_smtp_reply(&mut cursor)
                .await
                .expect_err(&format!("case '{}' must fail as UnexpectedEof", label));
            assert_eq!(err.kind(), std::io::ErrorKind::UnexpectedEof, "case '{}'", label);
        }

        // End-to-end: server writes "250 OK" WITHOUT \r\n after <CRLF>.<CRLF> and drops TCP ->
        // MUST return AmbiguousAfterTerminator, NEVER Delivered!
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap().to_string();
        let h = std::thread::spawn(move || {
            let Ok((stream, _)) = listener.accept() else {
                return;
            };
            let mut writer = stream.try_clone().unwrap();
            let mut reader = std::io::BufReader::new(stream);
            let _ = writer.write_all(b"220 mock ESMTP\r\n");
            let _ = writer.flush();
            let mut in_data = false;
            let mut line = String::new();
            loop {
                line.clear();
                if reader.read_line(&mut line).unwrap_or(0) == 0 {
                    break;
                }
                if in_data {
                    if line == ".\r\n" {
                        let _ = writer.write_all(b"250 OK"); // NO \r\n before close!
                        let _ = writer.flush();
                        drop(writer);
                        drop(reader);
                        break;
                    }
                    continue;
                }
                let upper = line.trim().to_ascii_uppercase();
                if upper.starts_with("EHLO") {
                    let _ = writer.write_all(b"250-mock\r\n250 8BITMIME\r\n");
                } else if upper == "DATA" {
                    in_data = true;
                    let _ = writer.write_all(b"354 End with <CRLF>.<CRLF>\r\n");
                } else {
                    let _ = writer.write_all(b"250 OK\r\n");
                }
                let _ = writer.flush();
            }
        });

        let env = build_test_envelope(&["recipient@external.com"]);
        let outcome = deliver_raw_to_smtp_phased_with_timeout(
            &addr,
            &env,
            sample_test_message(),
            Some(Duration::from_secs(2)),
            || async { Ok(true) },
            || async { Ok(true) },
            || async { Ok(true) },
        )
        .await
        .unwrap();
        h.join().unwrap();
        assert!(matches!(
            outcome,
            SmtpDeliveryOutcome::AmbiguousAfterTerminator { .. }
        ));
    }

    #[tokio::test]
    async fn test_wire_smtp_command_timeouts() {
        use std::io::{BufRead, Write};
        use std::net::TcpListener;

        for stall_stage in ["EHLO", "MAIL", "RCPT", "DATA"] {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let addr = listener.local_addr().unwrap().to_string();
            let stage_owned = stall_stage.to_string();
            let h = std::thread::spawn(move || {
                let Ok((stream, _)) = listener.accept() else {
                    return;
                };
                let mut writer = stream.try_clone().unwrap();
                let mut reader = std::io::BufReader::new(stream);
                let _ = writer.write_all(b"220 mock ESMTP\r\n");
                let _ = writer.flush();
                let mut line = String::new();
                loop {
                    line.clear();
                    if reader.read_line(&mut line).unwrap_or(0) == 0 {
                        break;
                    }
                    let upper = line.trim().to_ascii_uppercase();
                    if upper.starts_with(&stage_owned) {
                        std::thread::sleep(Duration::from_millis(250));
                        break;
                    }
                    if upper.starts_with("EHLO") {
                        let _ = writer.write_all(b"250-mock\r\n250 8BITMIME\r\n");
                    } else {
                        let _ = writer.write_all(b"250 OK\r\n");
                    }
                    let _ = writer.flush();
                }
            });

            let env = build_test_envelope(&["recipient@external.com"]);
            let outcome = deliver_raw_to_smtp_phased_with_timeout(
                &addr,
                &env,
                sample_test_message(),
                Some(Duration::from_millis(80)),
                || async { Ok(true) },
                || async { Ok(true) },
                || async { Ok(true) },
            )
            .await
            .unwrap();
            h.join().unwrap();
            assert!(
                matches!(outcome, SmtpDeliveryOutcome::FailedBeforeData(ref e) if e.smtp_code.is_none() && e.is_temporary()),
                "stage {} timeout must return temporary FailedBeforeData, got {:?}",
                stall_stage,
                outcome
            );
        }
    }

    #[tokio::test]
    async fn test_wire_plaintext_boundary_no_tls_handshake_or_starttls() {
        use std::io::Read;
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap().to_string();
        let captured_first_bytes = Arc::new(std::sync::Mutex::new(Vec::<u8>::new()));
        let bytes_clone = captured_first_bytes.clone();

        let h = std::thread::spawn(move || {
            use std::io::Write;
            if let Ok((mut stream, _)) = listener.accept() {
                let _ = stream.write_all(b"220 postfix.internal ESMTP\r\n");
                let _ = stream.flush();
                let mut buf = [0u8; 64];
                if let Ok(n) = stream.read(&mut buf) {
                    bytes_clone.lock().unwrap().extend_from_slice(&buf[..n]);
                }
                let _ = stream.write_all(b"250-postfix.internal\r\n250-STARTTLS\r\n250 8BITMIME\r\n");
                let _ = stream.flush();
                // Read next command after EHLO to prove it's MAIL FROM, not STARTTLS
                let mut next = [0u8; 64];
                if let Ok(n) = stream.read(&mut next) {
                    bytes_clone.lock().unwrap().extend_from_slice(&next[..n]);
                }
            }
        });

        let env = build_test_envelope(&["recipient@external.com"]);
        let _ = deliver_raw_to_smtp_phased_with_timeout(
            &addr,
            &env,
            sample_test_message(),
            Some(Duration::from_secs(1)),
            || async { Ok(true) },
            || async { Ok(true) },
            || async { Ok(true) },
        )
        .await;
        h.join().unwrap();

        let wire = captured_first_bytes.lock().unwrap();
        assert!(!wire.starts_with(&[0x16, 0x03]), "internal postfix:25 client must not send TLS ClientHello");
        let text = String::from_utf8_lossy(&wire);
        assert!(text.starts_with("EHLO "), "expected plaintext EHLO, got {:?}", text);
        assert!(text.contains("MAIL FROM:"), "expected MAIL FROM without STARTTLS, got {:?}", text);
        assert!(!text.to_ascii_uppercase().contains("STARTTLS"));
    }

    #[tokio::test]
    async fn test_wire_data_mode_body_commands_not_interpreted_and_no_rset_quit() {
        let env = build_test_envelope(&["recipient@external.com"]);
        let body_with_cmds = concat!(
            "From: sender@byos.local\r\n",
            "To: recipient@external.com\r\n",
            "Subject: Command Injection Immunity\r\n",
            "\r\n",
            "RSET\r\n",
            "QUIT\r\n",
            "MAIL FROM:<attacker@evil.test>\r\n",
            ".\r\n",
            "..\r\n",
            "End line\r\n"
        );
        let (addr, events, payloads, h) = spawn_wire_transcript_smtp(WireServerBehavior::Accept250);
        let outcome = deliver_raw_to_smtp_phased_with_timeout(
            &addr,
            &env,
            body_with_cmds.as_bytes(),
            Some(Duration::from_secs(2)),
            || async { Ok(true) },
            || async { Ok(true) },
            || async { Ok(true) },
        )
        .await
        .unwrap();
        h.join().unwrap();
        assert_eq!(outcome, SmtpDeliveryOutcome::Delivered { smtp_code: 250 });

        let log = events.lock().unwrap();
        assert_eq!(
            log.iter().filter(|e| matches!(e, WireEvent::Command(c) if c == "RSET")).count(),
            0,
            "RSET must never be sent"
        );
        assert_eq!(
            log.iter().filter(|e| matches!(e, WireEvent::Command(c) if c == "QUIT")).count(),
            1,
            "QUIT may only appear once after final 250 reply"
        );
        let received = &payloads.lock().unwrap()[0];
        assert_eq!(received, body_with_cmds);
    }

    #[test]
    fn test_smtp_dot_stuffing_edge_cases_empty_crlf_and_leading_dots() {
        // 1. Empty slice -> minimal CRLF terminator
        let (stuffed_empty, term_empty) = smtp_dot_stuff_body(b"");
        assert!(stuffed_empty.is_empty());
        assert_eq!(term_empty, b"\r\n.\r\n");

        // 2. Headers with empty body ending in CRLF\r\n
        let hdr_empty_body = b"From: s@byos.local\r\nSubject: Empty\r\n\r\n";
        let (stuffed_hdr, term_hdr) = smtp_dot_stuff_body(hdr_empty_body);
        assert_eq!(stuffed_hdr, hdr_empty_body);
        assert_eq!(term_hdr, b".\r\n");
        let mut wire_hdr = stuffed_hdr;
        wire_hdr.extend_from_slice(term_hdr);
        assert_eq!(smtp_dot_unstuff_wire_data(&wire_hdr), hdr_empty_body);

        // 3. Input ending without CRLF (plain text and lone trailing dot)
        let no_crlf = b"From: s@byos.local\r\n\r\n.";
        let (stuffed_dot, term_dot) = smtp_dot_stuff_body(no_crlf);
        assert_eq!(stuffed_dot, b"From: s@byos.local\r\n\r\n..");
        assert_eq!(term_dot, b"\r\n.\r\n");
        let mut wire_dot = stuffed_dot;
        wire_dot.extend_from_slice(term_dot);
        assert_eq!(
            smtp_dot_unstuff_wire_data(&wire_dot),
            b"From: s@byos.local\r\n\r\n.\r\n"
        );

        // 4. Input ending with bare '\r'
        let (stuffed_cr, term_cr) = smtp_dot_stuff_body(b"Body\r");
        assert_eq!(stuffed_cr, b"Body\r");
        assert_eq!(term_cr, b"\r\n.\r\n");

        // 5. Multiple leading dots at line 0 and mid-body
        let dots = b".zero\r\n.\r\n..\r\n...\r\n.end\r\n";
        let (stuffed_dots, term_dots) = smtp_dot_stuff_body(dots);
        assert_eq!(stuffed_dots, b"..zero\r\n..\r\n...\r\n....\r\n..end\r\n");
        assert_eq!(term_dots, b".\r\n");
        let mut wire_dots = stuffed_dots;
        wire_dots.extend_from_slice(term_dots);
        assert_eq!(smtp_dot_unstuff_wire_data(&wire_dots), dots);
    }

    #[tokio::test]
    async fn test_wire_dkim_preserved_bytes_after_dot_unstuffing() {
        let kp = byos_crypto_core::DkimKeypair::generate("byos").expect("generate DKIM keypair");
        let raw_with_bcc_and_dots = concat!(
            "From: sender@byos.local\r\n",
            "To: to@external.com\r\n",
            "Bcc: secret@external.com\r\n",
            "Subject: DKIM Dot-Stuffing Preservation\r\n",
            "\r\n",
            ".First line starts with dot\r\n",
            ".\r\n",
            "..\r\n",
            "Normal line\r\n",
            ".Last line with dot\r\n"
        );

        let sanitized = strip_bcc_headers(raw_with_bcc_and_dots.as_bytes());
        let signed = dkim_sign(&kp.private_key_pem, "byos", "byos.local", &sanitized).unwrap();
        let final_message = assemble_final_message("byos.local", "byos", &signed);
        let env = build_test_envelope(&["to@external.com", "secret@external.com"]);

        let (addr, _, payloads, h) = spawn_wire_transcript_smtp(WireServerBehavior::Accept250);
        let outcome = deliver_raw_to_smtp_phased_with_timeout(
            &addr,
            &env,
            &final_message,
            Some(Duration::from_secs(2)),
            || async { Ok(true) },
            || async { Ok(true) },
            || async { Ok(true) },
        )
        .await
        .unwrap();
        h.join().unwrap();
        assert_eq!(outcome, SmtpDeliveryOutcome::Delivered { smtp_code: 250 });

        let received = payloads.lock().unwrap()[0].as_bytes().to_vec();
        assert_eq!(
            received, final_message,
            "dot-unstuffed wire payload must match assembled final_message byte-for-byte"
        );

        // Strip Authentication-Results header added after DKIM signing and confirm signed MIME matches verbatim
        let (_, received_signed) = std::str::from_utf8(&received)
            .unwrap()
            .split_once("\r\n")
            .unwrap();
        assert_eq!(
            received_signed.as_bytes(),
            signed.as_slice(),
            "DKIM-signed MIME bytes must be identical after SMTP transport + dot-unstuffing"
        );
        assert!(!received_signed.contains("secret@external.com"));
    }

    #[tokio::test]
    async fn test_wire_phased_client_preserves_a1_4xx_5xx_classification() {
        let env = build_test_envelope(&["recipient@external.com"]);
        let cases = [
            ("450 5.1.1 Contradictory text\r\n", 450u16, SmtpFailureClass::Temporary),
            ("421 Service closing\r\n", 421u16, SmtpFailureClass::Temporary),
            ("550 4.2.0 Contradictory text\r\n", 550u16, SmtpFailureClass::Permanent),
            ("554 Transaction failed\r\n", 554u16, SmtpFailureClass::Permanent),
        ];

        for (reply, expected_code, expected_class) in cases {
            let (addr, stats, h) = spawn_scripted_smtp(vec![ScriptedSmtpStep {
                greeting: MockGreeting::Banner("220 mock-smtp ESMTP\r\n"),
                rcpt_responses: vec![reply],
                data_response: "250 OK\r\n",
            }]);
            let outcome = deliver_raw_to_smtp_phased_with_timeout(
                &addr,
                &env,
                sample_test_message(),
                Some(Duration::from_secs(2)),
                || async { Ok(true) },
                || async { unreachable!() },
                || async { unreachable!() },
            )
            .await
            .unwrap();
            h.join().unwrap();
            assert_eq!(stats.lock().unwrap().data_command_count, 0);
            assert!(
                matches!(
                    outcome,
                    SmtpDeliveryOutcome::FailedBeforeData(ref e)
                        if e.smtp_code == Some(expected_code) && e.class == expected_class
                ),
                "unexpected outcome for {}: {:?}",
                reply,
                outcome
            );
        }
    }

    #[tokio::test]
    async fn test_wire_ehlo_line0_and_greeting_timeout_and_data_non_354() {
        use std::io::{BufRead, Write};
        use std::net::TcpListener;

        // 1. RFC 5321 §4.1.1.1: EHLO line 0 is Domain [ehlo-greet], NOT a capability keyword
        let line0_caps = EhloCapabilities::from_lines(&[
            "8BITMIME SMTPUTF8".to_string(),
            "PIPELINING".to_string(),
        ]);
        assert!(!line0_caps.supports_8bitmime);
        assert!(!line0_caps.supports_smtputf8);

        let line1_caps = EhloCapabilities::from_lines(&[
            "postfix.internal".to_string(),
            "8BITMIME".to_string(),
            "SMTPUTF8".to_string(),
        ]);
        assert!(line1_caps.supports_8bitmime);
        assert!(line1_caps.supports_smtputf8);

        // 2. Out-of-range 999 reply from mock SMTP must fail safely with smtp_code: None (Temporary)
        let listener_999 = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr_999 = listener_999.local_addr().unwrap().to_string();
        let h_999 = std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener_999.accept() {
                let _ = stream.write_all(b"999 bogus banner\r\n");
                let _ = stream.flush();
            }
        });
        let env = build_test_envelope(&["recipient@external.com"]);
        let out_999 = deliver_raw_to_smtp_phased_with_timeout(
            &addr_999,
            &env,
            sample_test_message(),
            Some(Duration::from_secs(2)),
            || async { unreachable!() },
            || async { unreachable!() },
            || async { unreachable!() },
        )
        .await
        .unwrap();
        h_999.join().unwrap();
        assert!(matches!(
            out_999,
            SmtpDeliveryOutcome::FailedBeforeData(ref e) if e.smtp_code.is_none() && e.is_temporary()
        ));

        // 3. Greeting timeout before 220 banner fails safely pre-DATA
        let listener_greet = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr_greet = listener_greet.local_addr().unwrap().to_string();
        let h_greet = std::thread::spawn(move || {
            if let Ok((_stream, _)) = listener_greet.accept() {
                std::thread::sleep(Duration::from_millis(250));
            }
        });
        let out_greet = deliver_raw_to_smtp_phased_with_timeout(
            &addr_greet,
            &env,
            sample_test_message(),
            Some(Duration::from_millis(80)),
            || async { unreachable!() },
            || async { unreachable!() },
            || async { unreachable!() },
        )
        .await
        .unwrap();
        h_greet.join().unwrap();
        assert!(matches!(
            out_greet,
            SmtpDeliveryOutcome::FailedBeforeData(ref e) if e.smtp_code.is_none() && e.is_temporary()
        ));

        // 4. Unexpected non-354 replies to DATA (250, 451, 554) must abort before DATA streaming
        for (data_reply, expected_code, expected_temp) in [
            ("250 Unexpected 250 on DATA\r\n", None, true),
            ("451 Temporary DATA failure\r\n", Some(451), true),
            ("554 Transaction failed\r\n", Some(554), false),
        ] {
            let listener_data = TcpListener::bind("127.0.0.1:0").unwrap();
            let addr_data = listener_data.local_addr().unwrap().to_string();
            let reply_owned = data_reply.to_string();
            let h_data = std::thread::spawn(move || {
                let Ok((stream, _)) = listener_data.accept() else {
                    return;
                };
                let mut writer = stream.try_clone().unwrap();
                let mut reader = std::io::BufReader::new(stream);
                let _ = writer.write_all(b"220 mock ESMTP\r\n");
                let _ = writer.flush();
                let mut line = String::new();
                loop {
                    line.clear();
                    if reader.read_line(&mut line).unwrap_or(0) == 0 {
                        break;
                    }
                    let upper = line.trim().to_ascii_uppercase();
                    if upper.starts_with("EHLO") {
                        let _ = writer.write_all(b"250-mock\r\n250 8BITMIME\r\n");
                    } else if upper.starts_with("DATA") {
                        let _ = writer.write_all(reply_owned.as_bytes());
                        let _ = writer.flush();
                        break;
                    } else {
                        let _ = writer.write_all(b"250 OK\r\n");
                    }
                    let _ = writer.flush();
                }
            });
            let out_data = deliver_raw_to_smtp_phased_with_timeout(
                &addr_data,
                &env,
                sample_test_message(),
                Some(Duration::from_secs(2)),
                || async { Ok(true) },
                || async { unreachable!("must not enter DATA phase when DATA reply != 354") },
                || async { unreachable!("must not record terminator when DATA reply != 354") },
            )
            .await
            .unwrap();
            h_data.join().unwrap();
            assert!(
                matches!(
                    out_data,
                    SmtpDeliveryOutcome::FailedBeforeData(ref e)
                        if e.smtp_code == expected_code && e.is_temporary() == expected_temp
                ),
                "unexpected outcome for DATA reply '{}': {:?}",
                data_reply.trim(),
                out_data
            );
        }
    }
}

#[cfg(test)]
mod pg_tests {
    use super::*;
    use byos_crypto_core::{
        encrypt_dkim_private_key, encrypt_outbound, generate_outbound_delivery_keypair, hex,
        DkimKeypair,
    };
    use std::sync::Mutex;

    static DKIM_FIXTURE: OnceLock<(String, String)> = OnceLock::new();
    static TEST_DB_SERIAL: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();

    fn dkim_fixture() -> &'static (String, String) {
        DKIM_FIXTURE.get_or_init(|| {
            let kp = DkimKeypair::generate("sel1").expect("generate test DKIM keypair");
            (kp.selector, kp.private_key_pem)
        })
    }

    fn require_isolated_pg_urls() -> (String, String) {
        let worker_url = env::var("OUTBOUND_TEST_PG_URL").expect(
            "OUTBOUND_TEST_PG_URL must point to an isolated disposable PostgreSQL database (never production 'byos')",
        );
        let admin_url = env::var("OUTBOUND_TEST_ADMIN_PG_URL").unwrap_or_else(|_| worker_url.clone());
        assert!(
            !worker_url.contains("/byos?") && !worker_url.ends_with("/byos"),
            "REFUSING to run against database named 'byos'"
        );
        assert!(
            !admin_url.contains("/byos?") && !admin_url.ends_with("/byos"),
            "REFUSING to run admin fixture against database named 'byos'"
        );
        (admin_url, worker_url)
    }

    async fn connect_pg(url: &str) -> Client {
        let (client, conn) = tokio_postgres::connect(url, NoTls).await.expect("connect test pg");
        tokio::spawn(async move {
            let _ = conn.await;
        });
        let db_name: String = client
            .query_one("SELECT current_database()", &[])
            .await
            .expect("query current_database()")
            .get(0);
        assert_ne!(
            db_name, "byos",
            "SAFETY ABORT: refusing to execute tests on active 'byos' database"
        );
        client
    }

    struct TestTenantFixture {
        admin: Client,
        worker_url: String,
        sk: [u8; 32],
        pk: [u8; 32],
        dkim_dek: [u8; 32],
        org_id: Uuid,
        user_id: Uuid,
        domain_id: Uuid,
        domain_name: String,
        mailbox_id: Uuid,
        seq_counter: u64,
    }

    impl TestTenantFixture {
        async fn setup() -> Self {
            let (admin_url, worker_url) = require_isolated_pg_urls();
            let admin = connect_pg(&admin_url).await;
            let (sk, pk) = generate_outbound_delivery_keypair();
            let dkim_dek = [0x42u8; 32];
            let (selector, pem) = dkim_fixture();
            let dkim_enc = encrypt_dkim_private_key(&dkim_dek, pem).unwrap();

            let org_id = Uuid::new_v4();
            let user_id = Uuid::new_v4();
            let domain_id = Uuid::new_v4();
            let mailbox_id = Uuid::new_v4();
            let domain_name = format!("t-{}.example.test", &org_id.simple().to_string()[..8]);
            let user_email = format!("sender@{}", domain_name);

            admin
                .execute(
                    "INSERT INTO organizations (id, name, org_recovery_pk) VALUES ($1, 'Test Org', $2)",
                    &[&org_id, &vec![0xAAu8; 32]],
                )
                .await
                .unwrap();
            admin
                .execute(
                    "INSERT INTO users (id, org_id, email, password_hash, is_active) VALUES ($1, $2, $3, 'hash', true)",
                    &[&user_id, &org_id, &user_email],
                )
                .await
                .unwrap();
            admin
                .execute(
                    "INSERT INTO domains (id, org_id, name, dkim_selector, dkim_private_key_enc, is_verified) VALUES ($1, $2, $3, $4, $5, true)",
                    &[&domain_id, &org_id, &domain_name, selector, &dkim_enc],
                )
                .await
                .unwrap();
            admin
                .execute(
                    "INSERT INTO root_secrets (id, version, root_secret_wrapped) VALUES ($1, 1, NULL)",
                    &[&user_id],
                )
                .await
                .unwrap();
            admin
                .execute(
                    "INSERT INTO mailboxes (id, org_id, user_id, domain_id, local_part, mode, root_secret_id, mailbox_sk_wrapped, mailbox_pk, is_active) \
                     VALUES ($1, $2, $3, $4, 'sender', 'private', $3, $5, $6, true)",
                    &[&mailbox_id, &org_id, &user_id, &domain_id, &vec![2u8; 32], &vec![1u8; 32]],
                )
                .await
                .unwrap();

            Self {
                admin,
                worker_url,
                sk,
                pk,
                dkim_dek,
                org_id,
                user_id,
                domain_id,
                domain_name,
                mailbox_id,
                seq_counter: 100,
            }
        }

        async fn worker_client(&self) -> Client {
            connect_pg(&self.worker_url).await
        }

        async fn enqueue_valid_delivery(
            &mut self,
            recipient: &str,
            include_bcc: bool,
            max_attempts: i32,
            expires_offset_secs: i64,
        ) -> (Uuid, Uuid) {
            self.seq_counter += 1;
            let seq = self.seq_counter as i64;
            let mut mailbox_bytes = [0u8; 16];
            mailbox_bytes.copy_from_slice(self.mailbox_id.as_bytes());
            let mut mime = format!(
                "From: sender@{}\r\nTo: {}\r\n",
                self.domain_name,
                recipient.split(',').next().unwrap_or(recipient).trim()
            );
            if include_bcc {
                mime.push_str("Bcc: hidden-bcc@external.com\r\n");
            }
            mime.push_str(&format!(
                "Message-ID: <{}@{}>\r\nSubject: Release A2 Test {}\r\n\r\nHello reliable queue!\r\n",
                Uuid::new_v4(),
                self.domain_name,
                seq
            ));
            let (enc_msg, wrapped, iv, _, _) =
                encrypt_outbound(&self.pk, &mailbox_bytes, seq as u64, mime.as_bytes()).unwrap();
            let reservation_id = Uuid::new_v4();
            let delivery_id = Uuid::new_v4();

            self.admin
                .execute(
                    "INSERT INTO outbound_reservations (reservation_id, user_id, mailbox_id, outbox_seq, encryption_version, aad_version, status, delivery_id) \
                     VALUES ($1, $2, $3, $4, 1, 1, 'consumed', $5)",
                    &[&reservation_id, &self.user_id, &self.mailbox_id, &seq, &delivery_id],
                )
                .await
                .unwrap();

            let expires_secs = expires_offset_secs as f64;
            let row = self
                .admin
                .query_one(
                    "INSERT INTO outbound_queue \
                     (delivery_id, mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped, outbox_seq, encryption_version, aad_version, encryption_iv, reservation_id, status, max_attempts, next_attempt_at, expires_at) \
                     VALUES ($1, $2, $3, $4, $5, $6, $7, 1, 1, $8, $9, 'pending', $10, now(), now() + make_interval(secs => $11)) \
                     RETURNING id",
                    &[
                        &delivery_id,
                        &self.mailbox_id,
                        &self.domain_id,
                        &recipient,
                        &enc_msg,
                        &wrapped,
                        &seq,
                        &iv.as_slice(),
                        &reservation_id,
                        &max_attempts,
                        &expires_secs,
                    ],
                )
                .await
                .unwrap();
            (row.get(0), delivery_id)
        }

        async fn enqueue_corrupt_delivery(&mut self, recipient: &str, max_attempts: i32) -> (Uuid, Uuid) {
            self.seq_counter += 1;
            let seq = self.seq_counter as i64;
            let reservation_id = Uuid::new_v4();
            let delivery_id = Uuid::new_v4();
            let bad_msg = vec![0x01u8; 40];
            let bad_wrapped = vec![0x02u8; 64];
            let iv = vec![0x03u8; 12];

            self.admin
                .execute(
                    "INSERT INTO outbound_reservations (reservation_id, user_id, mailbox_id, outbox_seq, encryption_version, aad_version, status, delivery_id) \
                     VALUES ($1, $2, $3, $4, 1, 1, 'consumed', $5)",
                    &[&reservation_id, &self.user_id, &self.mailbox_id, &seq, &delivery_id],
                )
                .await
                .unwrap();

            let row = self
                .admin
                .query_one(
                    "INSERT INTO outbound_queue \
                     (delivery_id, mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped, outbox_seq, encryption_version, aad_version, encryption_iv, reservation_id, status, max_attempts, next_attempt_at, expires_at) \
                     VALUES ($1, $2, $3, $4, $5, $6, $7, 1, 1, $8, $9, 'pending', $10, now(), now() + interval '1 hour') \
                     RETURNING id",
                    &[
                        &delivery_id,
                        &self.mailbox_id,
                        &self.domain_id,
                        &recipient,
                        &bad_msg,
                        &bad_wrapped,
                        &seq,
                        &iv,
                        &reservation_id,
                        &max_attempts,
                    ],
                )
                .await
                .unwrap();
            (row.get(0), delivery_id)
        }

        async fn enqueue_scheduled_path_b(&mut self, recipient: &str, expires_offset_secs: i64) -> Uuid {
            self.seq_counter += 1;
            let seq = self.seq_counter as i64;
            let mut mailbox_bytes = [0u8; 16];
            mailbox_bytes.copy_from_slice(self.mailbox_id.as_bytes());
            let mime = format!(
                "From: sender@{}\r\nTo: {}\r\nSubject: Scheduled {}\r\n\r\nScheduled body\r\n",
                self.domain_name, recipient, seq
            );
            let (enc_msg, wrapped, iv, _, _) =
                encrypt_outbound(&self.pk, &mailbox_bytes, seq as u64, mime.as_bytes()).unwrap();
            let reservation_id = Uuid::new_v4();
            let delivery_id = Uuid::new_v4();

            self.admin
                .execute(
                    "INSERT INTO outbound_reservations (reservation_id, user_id, mailbox_id, outbox_seq, encryption_version, aad_version, status, delivery_id) \
                     VALUES ($1, $2, $3, $4, 1, 1, 'consumed', $5)",
                    &[&reservation_id, &self.user_id, &self.mailbox_id, &seq, &delivery_id],
                )
                .await
                .unwrap();

            let exp_secs = expires_offset_secs as f64;
            let draft_ref = format!("mailboxes/{}/scheduled/{}.enc", self.mailbox_id, delivery_id);
            self.admin
                .execute(
                    "INSERT INTO scheduled_messages \
                     (mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped, send_token_hash, scheduled_at, status, delivery_id, expires_at, is_path_a, reservation_id, outbox_seq, encryption_version, aad_version, encryption_iv, draft_storage_ref) \
                     VALUES ($1, $2, $3, $4, $5, $6, now() - interval '10 seconds', 'pending', $7, now() + make_interval(secs => $8), false, $9, $10, 1, 1, $11, $12)",
                    &[
                        &self.mailbox_id,
                        &self.domain_id,
                        &recipient,
                        &enc_msg,
                        &wrapped,
                        &vec![0x11u8; 32],
                        &delivery_id,
                        &exp_secs,
                        &reservation_id,
                        &seq,
                        &iv.as_slice(),
                        &draft_ref,
                    ],
                )
                .await
                .unwrap();
            delivery_id
        }

        async fn cleanup(&self) {
            let _ = self
                .admin
                .execute("DELETE FROM delivery_log WHERE mailbox_id = $1", &[&self.mailbox_id])
                .await;
            let _ = self
                .admin
                .execute("DELETE FROM outbound_queue WHERE mailbox_id = $1", &[&self.mailbox_id])
                .await;
            let _ = self
                .admin
                .execute("DELETE FROM scheduled_messages WHERE mailbox_id = $1", &[&self.mailbox_id])
                .await;
            let _ = self
                .admin
                .execute("DELETE FROM outbound_reservations WHERE mailbox_id = $1", &[&self.mailbox_id])
                .await;
            let _ = self
                .admin
                .execute("DELETE FROM mailboxes WHERE id = $1", &[&self.mailbox_id])
                .await;
            let _ = self
                .admin
                .execute("DELETE FROM root_secrets WHERE id = $1", &[&self.user_id])
                .await;
            let _ = self
                .admin
                .execute("DELETE FROM domains WHERE id = $1", &[&self.domain_id])
                .await;
            let _ = self
                .admin
                .execute("DELETE FROM users WHERE id = $1", &[&self.user_id])
                .await;
            let _ = self
                .admin
                .execute("DELETE FROM organizations WHERE id = $1", &[&self.org_id])
                .await;
        }
    }

    async fn spawn_mock_scheduled_api() -> (
        String,
        Arc<Mutex<Vec<(String, String, Option<String>)>>>,
        tokio::task::JoinHandle<()>,
    ) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        use tokio::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap().to_string();
        let events = Arc::new(Mutex::new(Vec::new()));
        let events_clone = events.clone();

        let handle = tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else {
                    break;
                };
                let mut buf = vec![0u8; 8192];
                let n = sock.read(&mut buf).await.unwrap_or(0);
                if n > 0 {
                    let req = String::from_utf8_lossy(&buf[..n]);
                    if let Some(idx) = req.find("\r\n\r\n") {
                        let body = req[idx + 4..].trim();
                        if let Ok(v) = serde_json::from_str::<serde_json::Value>(body) {
                            let did = v["delivery_id"].as_str().unwrap_or("").to_string();
                            let st = v["status"].as_str().unwrap_or("").to_string();
                            let err = v["error_message"].as_str().map(str::to_string);
                            events_clone.lock().unwrap().push((did, st, err));
                        }
                    }
                }
                let _ = sock
                    .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok")
                    .await;
            }
        });
        (addr, events, handle)
    }

    fn test_lease_config(owner: &str, lease_ttl: Duration, batch_size: i64) -> LeaseConfig {
        LeaseConfig {
            lease_owner: owner.to_string(),
            lease_ttl,
            renew_interval: LeaseConfig::default_renew_interval(lease_ttl),
            smtp_timeout: Duration::from_secs(3),
            batch_size,
        }
    }

    fn spawn_multi_accept_ok_smtp(
        expected: usize,
        delay_after_dot: Duration,
    ) -> (
        String,
        Arc<std::sync::Mutex<super::tests::MockSmtpStats>>,
        std::thread::JoinHandle<()>,
    ) {
        use std::io::{BufRead, BufReader, Write};
        use std::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap().to_string();
        let stats = Arc::new(std::sync::Mutex::new(super::tests::MockSmtpStats::default()));
        let stats_clone = stats.clone();

        let handle = std::thread::spawn(move || {
            for _ in 0..expected {
                let Ok((stream, _)) = listener.accept() else {
                    break;
                };
                stats_clone.lock().unwrap().connections += 1;
                let s = stats_clone.clone();
                std::thread::spawn(move || {
                    let mut writer = stream.try_clone().unwrap();
                    let mut reader = BufReader::new(stream);
                    let _ = writer.write_all(b"220 mock-multi ESMTP\r\n");
                    let _ = writer.flush();
                    let mut in_data = false;
                    let mut data_buf = String::new();
                    let mut line = String::new();
                    loop {
                        line.clear();
                        match reader.read_line(&mut line) {
                            Ok(0) | Err(_) => break,
                            Ok(_) => {}
                        }
                        if in_data {
                            if line == ".\r\n" || line == ".\n" {
                                in_data = false;
                                if !delay_after_dot.is_zero() {
                                    std::thread::sleep(delay_after_dot);
                                }
                                s.lock().unwrap().payloads.push(data_buf.clone());
                                data_buf.clear();
                                let _ = writer.write_all(b"250 2.0.0 OK\r\n");
                            } else {
                                data_buf.push_str(&line);
                            }
                            let _ = writer.flush();
                            continue;
                        }
                        let upper = line.trim().to_ascii_uppercase();
                        if upper.starts_with("EHLO") || upper.starts_with("HELO") {
                            let _ = writer.write_all(b"250-mock-multi\r\n250 8BITMIME\r\n");
                        } else if upper.starts_with("MAIL FROM:") {
                            let _ = writer.write_all(b"250 2.1.0 OK\r\n");
                        } else if upper.starts_with("RCPT TO:") {
                            s.lock().unwrap().rcpt_commands.push(line.trim().to_string());
                            let _ = writer.write_all(b"250 2.1.5 OK\r\n");
                        } else if upper == "DATA" {
                            s.lock().unwrap().data_command_count += 1;
                            in_data = true;
                            let _ = writer.write_all(b"354 End with <CRLF>.<CRLF>\r\n");
                        } else if upper == "QUIT" {
                            let _ = writer.write_all(b"221 Bye\r\n");
                            let _ = writer.flush();
                            break;
                        } else {
                            let _ = writer.write_all(b"250 OK\r\n");
                        }
                        let _ = writer.flush();
                    }
                });
            }
        });
        (addr, stats, handle)
    }

    #[tokio::test]
    async fn test_pg_concurrent_workers_claim_disjoint_rows_and_deliver_once() {
        let _lock = TEST_DB_SERIAL.get_or_init(|| tokio::sync::Mutex::new(())).lock().await;
        let mut fx = TestTenantFixture::setup().await;
        let (api_addr, events, api_h) = spawn_mock_scheduled_api().await;

        let count = 6usize;
        let mut ids = Vec::new();
        for i in 0..count {
            let (qid, did) = fx
                .enqueue_valid_delivery(&format!("u{}@external.com", i), true, 5, 3600)
                .await;
            ids.push((qid, did));
        }

        let (smtp_addr, stats, smtp_h) = spawn_multi_accept_ok_smtp(count, Duration::ZERO);
        let mut w1 = fx.worker_client().await;
        let mut w2 = fx.worker_client().await;
        let c1 = test_lease_config("worker-1", Duration::from_secs(30), 3);
        let c2 = test_lease_config("worker-2", Duration::from_secs(30), 3);

        let (r1, r2) = tokio::join!(
            poll_once_with_config(&mut w1, &fx.sk, &fx.dkim_dek, &smtp_addr, &api_addr, None, &c1),
            poll_once_with_config(&mut w2, &fx.sk, &fx.dkim_dek, &smtp_addr, &api_addr, None, &c2),
        );
        r1.unwrap();
        r2.unwrap();
        smtp_h.join().unwrap();
        api_h.abort();
        let _ = events.lock().unwrap().len();

        let guard = stats.lock().unwrap();
        assert_eq!(guard.connections, count, "each row must trigger exactly 1 SMTP connection");
        assert_eq!(guard.payloads.len(), count);
        for p in &guard.payloads {
            assert!(!p.to_ascii_lowercase().contains("\r\nbcc:"));
        }
        drop(guard);

        for (qid, did) in &ids {
            let row = fx
                .admin
                .query_one(
                    "SELECT status, attempts, lease_token FROM outbound_queue WHERE id = $1",
                    &[qid],
                )
                .await
                .unwrap();
            assert_eq!(row.get::<_, String>(0), "delivered");
            assert_eq!(row.get::<_, i32>(1), 1);
            assert!(row.get::<_, Option<Uuid>>(2).is_none());

            let log_cnt: i64 = fx
                .admin
                .query_one(
                    "SELECT count(*) FROM delivery_log WHERE delivery_id = $1 AND status = 'delivered'",
                    &[did],
                )
                .await
                .unwrap()
                .get(0);
            assert_eq!(log_cnt, 1);
        }

        fx.cleanup().await;
    }

    #[tokio::test]
    async fn test_pg_active_lease_blocks_second_worker_and_reclaims_only_after_expiry() {
        let _lock = TEST_DB_SERIAL.get_or_init(|| tokio::sync::Mutex::new(())).lock().await;
        let mut fx = TestTenantFixture::setup().await;
        let (api_addr, _, api_h) = spawn_mock_scheduled_api().await;

        let (qid, did) = fx.enqueue_valid_delivery("reclaim@external.com", false, 5, 3600).await;

        let mut w1 = fx.worker_client().await;
        let mut w2 = fx.worker_client().await;
        let c1 = test_lease_config("worker-1", Duration::from_secs(60), 5);
        let c2 = test_lease_config("worker-2", Duration::from_secs(60), 5);

        // Worker 1 claims active lease
        let claimed1 = claim_outbound_batch(&mut w1, &c1).await.unwrap();
        assert_eq!(claimed1.len(), 1);
        let old_token = claimed1[0].lease_token;

        // Active lease protects row from Worker 2
        let claimed2 = claim_outbound_batch(&mut w2, &c2).await.unwrap();
        assert!(claimed2.is_empty(), "worker-2 must not claim row while worker-1 lease is active");

        // Simulate Worker 1 crash before DATA by expiring lease_expires_at
        fx.admin
            .execute(
                "UPDATE outbound_queue SET smtp_phase = 'pre_data', lease_expires_at = now() - interval '5 seconds' WHERE id = $1",
                &[&qid],
            )
            .await
            .unwrap();

        // Worker 2 reaps + claims + delivers once
        let (smtp_addr, stats, smtp_h) = spawn_multi_accept_ok_smtp(1, Duration::ZERO);
        poll_once_with_config(&mut w2, &fx.sk, &fx.dkim_dek, &smtp_addr, &api_addr, None, &c2)
            .await
            .unwrap();
        smtp_h.join().unwrap();
        assert_eq!(stats.lock().unwrap().payloads.len(), 1);

        // Stale Worker 1 cannot mutate the row with old_token
        let stale_deliv = record_delivered_leased(
            &mut w1,
            &api_addr,
            qid,
            old_token,
            did,
            fx.mailbox_id,
            fx.domain_id,
            "reclaim@external.com",
            250,
        )
        .await
        .unwrap();
        assert_eq!(stale_deliv, LeaseFenceResult::AlreadySettled);

        let log_rows = fx
            .admin
            .query(
                "SELECT status FROM delivery_log WHERE delivery_id = $1 ORDER BY created_at ASC",
                &[&did],
            )
            .await
            .unwrap();
        let statuses: Vec<String> = log_rows.into_iter().map(|r| r.get(0)).collect();
        assert_eq!(statuses, vec!["retry".to_string(), "delivered".to_string()]);

        api_h.abort();
        fx.cleanup().await;
    }

    #[tokio::test]
    async fn test_pg_stale_lease_token_rejected_across_all_fenced_mutations_and_idempotent_completion() {
        let _lock = TEST_DB_SERIAL.get_or_init(|| tokio::sync::Mutex::new(())).lock().await;
        let mut fx = TestTenantFixture::setup().await;
        let (api_addr, _, api_h) = spawn_mock_scheduled_api().await;

        let (qid, did) = fx.enqueue_valid_delivery("fence@external.com", false, 5, 3600).await;
        let mut w1 = fx.worker_client().await;
        let mut w2 = fx.worker_client().await;

        let c1 = claim_outbound_batch(&mut w1, &test_lease_config("w1", Duration::from_secs(60), 5))
            .await
            .unwrap();
        let stale_token = c1[0].lease_token;

        // Expire w1 lease and have w2 reclaim directly with a fresh token
        fx.admin
            .execute(
                "UPDATE outbound_queue SET lease_expires_at = now() - interval '10 seconds' WHERE id = $1",
                &[&qid],
            )
            .await
            .unwrap();
        let c2 = claim_outbound_batch(&mut w2, &test_lease_config("w2", Duration::from_secs(60), 5))
            .await
            .unwrap();
        assert_eq!(c2.len(), 1);
        let new_token = c2[0].lease_token;
        assert_ne!(stale_token, new_token);

        // Every stale mutation using old_token must fail closed without altering state or logs
        assert!(!renew_lease(&w1, qid, stale_token, Duration::from_secs(60)).await.unwrap());
        assert!(!mark_smtp_phase(&w1, qid, stale_token, SmtpPhase::TerminatorInFlight).await.unwrap());
        assert_eq!(
            record_retry_leased(
                &mut w1, &api_addr, qid, stale_token, did, fx.mailbox_id, fx.domain_id,
                "fence@external.com", 1, Some(450), "stale 450", Some("pre_data")
            ).await.unwrap(),
            LeaseFenceResult::StaleLease
        );
        assert_eq!(
            record_bounced_leased(
                &mut w1, &api_addr, qid, stale_token, did, fx.mailbox_id, fx.domain_id,
                "fence@external.com", Some(550), "stale 550", Some("pre_data")
            ).await.unwrap(),
            LeaseFenceResult::StaleLease
        );
        assert_eq!(
            record_outcome_unknown_leased(
                &mut w1, qid, stale_token, did, fx.mailbox_id, fx.domain_id,
                "fence@external.com", "stale unknown"
            ).await.unwrap(),
            LeaseFenceResult::StaleLease
        );

        // Verify w2 still holds processing lease cleanly with 0 delivery_log rows
        let log_before: i64 = fx
            .admin
            .query_one("SELECT count(*) FROM delivery_log WHERE delivery_id = $1", &[&did])
            .await
            .unwrap()
            .get(0);
        assert_eq!(log_before, 0);

        // Active w2 completes delivered, and repeated call with same token is idempotent
        assert_eq!(
            record_delivered_leased(
                &mut w2, &api_addr, qid, new_token, did, fx.mailbox_id, fx.domain_id, "fence@external.com", 250
            ).await.unwrap(),
            LeaseFenceResult::Applied(())
        );
        assert_eq!(
            record_delivered_leased(
                &mut w2, &api_addr, qid, new_token, did, fx.mailbox_id, fx.domain_id, "fence@external.com", 250
            ).await.unwrap(),
            LeaseFenceResult::AlreadySettled
        );

        let delivered_logs: i64 = fx
            .admin
            .query_one(
                "SELECT count(*) FROM delivery_log WHERE delivery_id = $1 AND status = 'delivered'",
                &[&did],
            )
            .await
            .unwrap()
            .get(0);
        assert_eq!(delivered_logs, 1);

        api_h.abort();
        fx.cleanup().await;
    }

    #[tokio::test]
    async fn test_pg_scheduled_promotion_concurrency_is_idempotent() {
        let _lock = TEST_DB_SERIAL.get_or_init(|| tokio::sync::Mutex::new(())).lock().await;
        let mut fx = TestTenantFixture::setup().await;
        let (api_addr, _, api_h) = spawn_mock_scheduled_api().await;

        let d1 = fx.enqueue_scheduled_path_b("sched1@external.com", 3600).await;
        let d2 = fx.enqueue_scheduled_path_b("sched2@external.com", 3600).await;

        let mut w1 = fx.worker_client().await;
        let mut w2 = fx.worker_client().await;
        let (r1, r2) = tokio::join!(
            poll_scheduled(&mut w1, &api_addr, None),
            poll_scheduled(&mut w2, &api_addr, None),
        );
        r1.unwrap();
        r2.unwrap();

        for did in [d1, d2] {
            let cnt: i64 = fx
                .admin
                .query_one(
                    "SELECT count(*) FROM outbound_queue WHERE delivery_id = $1 AND status = 'pending'",
                    &[&did],
                )
                .await
                .unwrap()
                .get(0);
            assert_eq!(cnt, 1, "scheduled promotion must produce exactly 1 queue row");
        }

        api_h.abort();
        fx.cleanup().await;
    }

    #[tokio::test]
    async fn test_pg_temp_450_perm_550_max_attempts_and_decrypt_retry_log_accuracy() {
        let _lock = TEST_DB_SERIAL.get_or_init(|| tokio::sync::Mutex::new(())).lock().await;
        let mut fx = TestTenantFixture::setup().await;
        let (api_addr, events, api_h) = spawn_mock_scheduled_api().await;
        let mut worker = fx.worker_client().await;
        let cfg = test_lease_config("worker-disp", Duration::from_secs(30), 10);

        // 1. Temporary 450 on pre-DATA -> stays pending, logs 'retry', ZERO 'bounced', ZERO scheduled failed callback
        let (qid_temp, did_temp) = fx.enqueue_valid_delivery("temp@external.com", false, 5, 3600).await;
        let (smtp_temp, _, h_temp) = super::tests::spawn_scripted_smtp(vec![super::tests::ScriptedSmtpStep {
            greeting: super::tests::MockGreeting::Banner("220 mock ESMTP\r\n"),
            rcpt_responses: vec!["450 4.2.0 Try again later\r\n"],
            data_response: "250 OK\r\n",
        }]);
        poll_once_with_config(&mut worker, &fx.sk, &fx.dkim_dek, &smtp_temp, &api_addr, None, &cfg)
            .await
            .unwrap();
        h_temp.join().unwrap();

        let row_t = fx
            .admin
            .query_one("SELECT status, attempts, lease_token, (next_attempt_at > now()) FROM outbound_queue WHERE id = $1", &[&qid_temp])
            .await
            .unwrap();
        assert_eq!(row_t.get::<_, String>(0), "pending");
        assert_eq!(row_t.get::<_, i32>(1), 1);
        assert!(row_t.get::<_, Option<Uuid>>(2).is_none());
        assert!(row_t.get::<_, bool>(3));
        let bounce_cnt_t: i64 = fx
            .admin
            .query_one("SELECT count(*) FROM delivery_log WHERE delivery_id = $1 AND status = 'bounced'", &[&did_temp])
            .await.unwrap().get(0);
        let retry_cnt_t: i64 = fx
            .admin
            .query_one("SELECT count(*) FROM delivery_log WHERE delivery_id = $1 AND status = 'retry'", &[&did_temp])
            .await.unwrap().get(0);
        assert_eq!(bounce_cnt_t, 0, "temporary retry must NEVER insert bounced into delivery_log");
        assert_eq!(retry_cnt_t, 1);

        // Move temp row aside so subsequent polls focus cleanly
        fx.admin.execute("UPDATE outbound_queue SET next_attempt_at = now() + interval '1 hour' WHERE id = $1", &[&qid_temp]).await.unwrap();

        // 2. Permanent 550 -> 'bounced', single 'bounced' delivery_log, scheduled callback
        let (qid_perm, did_perm) = fx.enqueue_valid_delivery("perm@external.com", false, 5, 3600).await;
        let (smtp_perm, _, h_perm) = super::tests::spawn_scripted_smtp(vec![super::tests::ScriptedSmtpStep {
            greeting: super::tests::MockGreeting::Banner("220 mock ESMTP\r\n"),
            rcpt_responses: vec!["550 5.1.1 Mailbox unavailable\r\n"],
            data_response: "250 OK\r\n",
        }]);
        poll_once_with_config(&mut worker, &fx.sk, &fx.dkim_dek, &smtp_perm, &api_addr, None, &cfg)
            .await
            .unwrap();
        h_perm.join().unwrap();
        assert_eq!(
            fx.admin.query_one("SELECT status FROM outbound_queue WHERE id = $1", &[&qid_perm]).await.unwrap().get::<_, String>(0),
            "bounced"
        );
        let perm_log: i64 = fx
            .admin
            .query_one("SELECT count(*) FROM delivery_log WHERE delivery_id = $1 AND status = 'bounced'", &[&did_perm])
            .await.unwrap().get(0);
        assert_eq!(perm_log, 1);

        // 3. Max attempts exhaustion (starts at attempts=4, max_attempts=5 -> temp 451 bounces terminally)
        let (qid_max, did_max) = fx.enqueue_valid_delivery("max@external.com", false, 5, 3600).await;
        fx.admin.execute("UPDATE outbound_queue SET attempts = 4 WHERE id = $1", &[&qid_max]).await.unwrap();
        let (smtp_max, _, h_max) = super::tests::spawn_scripted_smtp(vec![super::tests::ScriptedSmtpStep {
            greeting: super::tests::MockGreeting::Banner("220 mock ESMTP\r\n"),
            rcpt_responses: vec!["451 Temporary local problem\r\n"],
            data_response: "250 OK\r\n",
        }]);
        poll_once_with_config(&mut worker, &fx.sk, &fx.dkim_dek, &smtp_max, &api_addr, None, &cfg)
            .await
            .unwrap();
        h_max.join().unwrap();
        let row_m = fx.admin.query_one("SELECT status, attempts FROM outbound_queue WHERE id = $1", &[&qid_max]).await.unwrap();
        assert_eq!(row_m.get::<_, String>(0), "bounced");
        assert_eq!(row_m.get::<_, i32>(1), 5);
        assert_eq!(
            fx.admin.query_one("SELECT count(*) FROM delivery_log WHERE delivery_id = $1 AND status = 'bounced'", &[&did_max]).await.unwrap().get::<_, i64>(0),
            1
        );

        // 4. Pre-SMTP decrypt failures: non-terminal attempts log 'retry' (never 'bounced'), final attempt logs 1 'bounced'
        let (qid_bad, did_bad) = fx.enqueue_corrupt_delivery("bad@external.com", 3).await;
        for step in 1..=3 {
            fx.admin.execute("UPDATE outbound_queue SET next_attempt_at = now() - interval '1 second' WHERE id = $1", &[&qid_bad]).await.unwrap();
            poll_once_with_config(&mut worker, &fx.sk, &fx.dkim_dek, "127.0.0.1:1", &api_addr, None, &cfg)
                .await
                .unwrap();
            let b_cnt: i64 = fx.admin.query_one("SELECT count(*) FROM delivery_log WHERE delivery_id = $1 AND status = 'bounced'", &[&did_bad]).await.unwrap().get(0);
            let r_cnt: i64 = fx.admin.query_one("SELECT count(*) FROM delivery_log WHERE delivery_id = $1 AND status = 'retry'", &[&did_bad]).await.unwrap().get(0);
            if step < 3 {
                assert_eq!(b_cnt, 0, "step {} decrypt retry must not emit bounced log", step);
                assert_eq!(r_cnt, step as i64);
            } else {
                assert_eq!(b_cnt, 1, "terminal decrypt failure must emit exactly 1 bounced log");
                assert_eq!(r_cnt, 2);
            }
        }

        // Confirm permanent & max-attempt failures notified scheduled completion API
        let evs = events.lock().unwrap().clone();
        assert!(evs.iter().any(|(d, s, _)| d == &did_perm.to_string() && s == "failed"));
        assert!(evs.iter().any(|(d, s, _)| d == &did_max.to_string() && s == "failed"));
        assert!(!evs.iter().any(|(d, _, _)| d == &did_temp.to_string()));

        api_h.abort();
        fx.cleanup().await;
    }

    #[tokio::test]
    async fn test_pg_expired_pending_and_scheduled_reaper() {
        let _lock = TEST_DB_SERIAL.get_or_init(|| tokio::sync::Mutex::new(())).lock().await;
        let mut fx = TestTenantFixture::setup().await;
        let (api_addr, events, api_h) = spawn_mock_scheduled_api().await;

        let (qid_exp, did_exp) = fx.enqueue_valid_delivery("exp@external.com", false, 5, -60).await;
        let sched_exp = fx.enqueue_scheduled_path_b("sched-exp@external.com", -60).await;

        let mut worker = fx.worker_client().await;
        let cfg = test_lease_config("worker-reap", Duration::from_secs(30), 10);

        poll_scheduled(&mut worker, &api_addr, None).await.unwrap();
        poll_once_with_config(&mut worker, &fx.sk, &fx.dkim_dek, "127.0.0.1:1", &api_addr, None, &cfg)
            .await
            .unwrap();

        assert_eq!(
            fx.admin.query_one("SELECT status FROM outbound_queue WHERE id = $1", &[&qid_exp]).await.unwrap().get::<_, String>(0),
            "expired"
        );
        assert_eq!(
            fx.admin.query_one("SELECT count(*) FROM delivery_log WHERE delivery_id = $1 AND status = 'expired'", &[&did_exp]).await.unwrap().get::<_, i64>(0),
            1
        );
        assert_eq!(
            fx.admin.query_one("SELECT status FROM scheduled_messages WHERE delivery_id = $1", &[&sched_exp]).await.unwrap().get::<_, String>(0),
            "expired"
        );
        assert!(events.lock().unwrap().iter().any(|(d, s, _)| d == &did_exp.to_string() && s == "failed"));

        api_h.abort();
        fx.cleanup().await;
    }

    #[tokio::test]
    async fn test_pg_long_running_delivery_renews_lease_and_blocks_concurrent_steal() {
        let _lock = TEST_DB_SERIAL.get_or_init(|| tokio::sync::Mutex::new(())).lock().await;
        let mut fx = TestTenantFixture::setup().await;
        let (api_addr, _, api_h) = spawn_mock_scheduled_api().await;

        let (qid, _) = fx.enqueue_valid_delivery("slow@external.com", false, 5, 3600).await;
        let (smtp_addr, stats, smtp_h) = super::tests::spawn_phased_mock_smtp(
            super::tests::PhasedSmtpBehavior::PauseAfterDataDotThenAccept(Duration::from_millis(650)),
        );

        let mut w1 = fx.worker_client().await;
        let mut w2 = fx.worker_client().await;
        let c1 = test_lease_config("worker-slow", Duration::from_millis(280), 5);
        let c2 = test_lease_config("worker-rival", Duration::from_millis(280), 5);

        let w1_fut = poll_once_with_config(&mut w1, &fx.sk, &fx.dkim_dek, &smtp_addr, &api_addr, None, &c1);
        let w2_fut = async {
            sleep(Duration::from_millis(400)).await;
            claim_outbound_batch(&mut w2, &c2).await
        };

        let (r1, claimed_rival) = tokio::join!(w1_fut, w2_fut);
        r1.unwrap();
        smtp_h.join().unwrap();

        assert!(
            claimed_rival.unwrap().is_empty(),
            "rival worker must not steal lease kept alive by heartbeat renewal"
        );
        assert_eq!(stats.lock().unwrap().connections, 1);
        assert_eq!(
            fx.admin.query_one("SELECT status FROM outbound_queue WHERE id = $1", &[&qid]).await.unwrap().get::<_, String>(0),
            "delivered"
        );

        api_h.abort();
        fx.cleanup().await;
    }

    #[tokio::test]
    async fn test_pg_partial_rcpt_abort_and_ambiguous_post_data_never_auto_resend() {
        let _lock = TEST_DB_SERIAL.get_or_init(|| tokio::sync::Mutex::new(())).lock().await;
        let mut fx = TestTenantFixture::setup().await;
        let (api_addr, events, api_h) = spawn_mock_scheduled_api().await;
        let mut worker = fx.worker_client().await;
        let cfg = test_lease_config("worker-ambig", Duration::from_secs(30), 10);

        // 1. Partial RCPT TO 450 aborts before DATA and leaves row pending with 'retry'
        let (qid_rcpt, _) = fx
            .enqueue_valid_delivery("ok@external.com, later@external.com", true, 5, 3600)
            .await;
        let (smtp_rcpt, stats_rcpt, h_rcpt) = super::tests::spawn_scripted_smtp(vec![super::tests::ScriptedSmtpStep {
            greeting: super::tests::MockGreeting::Banner("220 mock ESMTP\r\n"),
            rcpt_responses: vec!["250 2.1.5 OK\r\n", "450 4.2.0 Throttle second rcpt\r\n"],
            data_response: "250 OK\r\n",
        }]);
        poll_once_with_config(&mut worker, &fx.sk, &fx.dkim_dek, &smtp_rcpt, &api_addr, None, &cfg)
            .await
            .unwrap();
        h_rcpt.join().unwrap();
        assert_eq!(stats_rcpt.lock().unwrap().data_command_count, 0);
        assert_eq!(
            fx.admin.query_one("SELECT status FROM outbound_queue WHERE id = $1", &[&qid_rcpt]).await.unwrap().get::<_, String>(0),
            "pending"
        );
        fx.admin.execute("UPDATE outbound_queue SET next_attempt_at = now() + interval '1 hour' WHERE id = $1", &[&qid_rcpt]).await.unwrap();

        // 2. Ambiguous disconnect right after <CRLF>.<CRLF> -> outcome_unknown, NEVER auto-resent
        let (qid_unk, did_unk) = fx.enqueue_valid_delivery("ambig@external.com", false, 5, 3600).await;
        let (smtp_drop, stats_drop, h_drop) =
            super::tests::spawn_phased_mock_smtp(super::tests::PhasedSmtpBehavior::DropAfterDataDot);
        poll_once_with_config(&mut worker, &fx.sk, &fx.dkim_dek, &smtp_drop, &api_addr, None, &cfg)
            .await
            .unwrap();
        h_drop.join().unwrap();
        assert_eq!(stats_drop.lock().unwrap().payloads.len(), 1);

        let row_u = fx
            .admin
            .query_one(
                "SELECT status, smtp_phase, lease_token FROM outbound_queue WHERE id = $1",
                &[&qid_unk],
            )
            .await
            .unwrap();
        assert_eq!(row_u.get::<_, String>(0), "outcome_unknown");
        assert_eq!(row_u.get::<_, Option<String>>(1).as_deref(), Some("terminator_in_flight"));
        assert!(row_u.get::<_, Option<Uuid>>(2).is_none());
        assert_eq!(
            fx.admin.query_one("SELECT count(*) FROM delivery_log WHERE delivery_id = $1 AND status = 'outcome_unknown'", &[&did_unk]).await.unwrap().get::<_, i64>(0),
            1
        );
        assert_eq!(
            fx.admin.query_one("SELECT count(*) FROM delivery_log WHERE delivery_id = $1 AND status IN ('delivered', 'bounced')", &[&did_unk]).await.unwrap().get::<_, i64>(0),
            0
        );

        // 3. Crashed worker lease already in smtp_phase='terminator_in_flight' with expired lease -> reaped to outcome_unknown
        let (qid_crash, did_crash) = fx.enqueue_valid_delivery("crash@external.com", false, 5, 3600).await;
        fx.admin
            .execute(
                "UPDATE outbound_queue \
                 SET status = 'processing', lease_token = gen_random_uuid(), lease_expires_at = now() - interval '10 seconds', smtp_phase = 'terminator_in_flight' \
                 WHERE id = $1",
                &[&qid_crash],
            )
            .await
            .unwrap();

        // 4. Crashed worker lease already in smtp_phase='accepted_by_mta' with expired lease -> settled as delivered, NEVER outcome_unknown
        let (qid_acc, did_acc) = fx.enqueue_valid_delivery("accepted-crash@external.com", false, 5, 3600).await;
        fx.admin
            .execute(
                "UPDATE outbound_queue \
                 SET status = 'processing', lease_token = gen_random_uuid(), lease_expires_at = now() - interval '10 seconds', smtp_phase = 'accepted_by_mta', last_smtp_code = 250 \
                 WHERE id = $1",
                &[&qid_acc],
            )
            .await
            .unwrap();

        // Subsequent poll must reap terminator_in_flight -> outcome_unknown and accepted_by_mta -> delivered without opening SMTP
        poll_once_with_config(&mut worker, &fx.sk, &fx.dkim_dek, "127.0.0.1:1", &api_addr, None, &cfg)
            .await
            .unwrap();
        assert_eq!(
            fx.admin.query_one("SELECT status FROM outbound_queue WHERE id = $1", &[&qid_crash]).await.unwrap().get::<_, String>(0),
            "outcome_unknown"
        );
        assert_eq!(
            fx.admin.query_one("SELECT count(*) FROM delivery_log WHERE delivery_id = $1 AND status = 'outcome_unknown'", &[&did_crash]).await.unwrap().get::<_, i64>(0),
            1
        );
        assert_eq!(
            fx.admin.query_one("SELECT status FROM outbound_queue WHERE id = $1", &[&qid_acc]).await.unwrap().get::<_, String>(0),
            "delivered"
        );
        assert_eq!(
            fx.admin.query_one("SELECT count(*) FROM delivery_log WHERE delivery_id = $1 AND status = 'delivered'", &[&did_acc]).await.unwrap().get::<_, i64>(0),
            1
        );
        assert_eq!(
            events.lock().unwrap().as_slice(),
            &[(did_acc.to_string(), "delivered".to_string(), None)],
            "reaper must notify delivered only for accepted_by_mta and never emit failed/delivered for outcome_unknown"
        );

        api_h.abort();
        fx.cleanup().await;
    }

    #[tokio::test]
    async fn test_pg_data_streaming_fence_reclaim_reaper_and_post_terminator_outcomes() {
        let _lock = TEST_DB_SERIAL.get_or_init(|| tokio::sync::Mutex::new(())).lock().await;
        let mut fx = TestTenantFixture::setup().await;
        let (api_addr, _, api_h) = spawn_mock_scheduled_api().await;
        let mut w1 = fx.worker_client().await;
        let mut w2 = fx.worker_client().await;
        let c1 = test_lease_config("w1-stream", Duration::from_secs(30), 10);
        let c2 = test_lease_config("w2-stream", Duration::from_secs(30), 10);

        // Part A: Lease expires while smtp_phase='data_streaming' (before terminator fence) ->
        // reaper releases row back to pending, and w2 reclaims & delivers once.
        let (qid_a, did_a) = fx.enqueue_valid_delivery("reap-stream@external.com", false, 5, 3600).await;
        let claimed_a = claim_outbound_batch(&mut w1, &c1).await.unwrap();
        assert_eq!(claimed_a.len(), 1);
        assert!(mark_smtp_phase(&w1, qid_a, claimed_a[0].lease_token, SmtpPhase::PreData).await.unwrap());
        assert!(mark_smtp_phase(&w1, qid_a, claimed_a[0].lease_token, SmtpPhase::DataStreaming).await.unwrap());
        fx.admin
            .execute(
                "UPDATE outbound_queue SET lease_expires_at = now() - interval '5 seconds' WHERE id = $1",
                &[&qid_a],
            )
            .await
            .unwrap();
        // Attempting terminator fence after expiry must return false via lease_expires_at > clock_timestamp()
        assert!(!mark_smtp_phase(&w1, qid_a, claimed_a[0].lease_token, SmtpPhase::TerminatorInFlight).await.unwrap());

        let reap_a = reap_stale_and_expired(&mut w2, &api_addr).await.unwrap();
        assert_eq!(reap_a.released_pre_data_leases, 1);
        assert_eq!(reap_a.moved_to_outcome_unknown, 0);
        let row_a = fx.admin.query_one("SELECT status, smtp_phase FROM outbound_queue WHERE id = $1", &[&qid_a]).await.unwrap();
        assert_eq!(row_a.get::<_, String>(0), "pending");
        assert!(row_a.get::<_, Option<String>>(1).is_none());

        let (smtp_ok, stats_ok, _, h_ok) = super::tests::spawn_wire_transcript_smtp(super::tests::WireServerBehavior::Accept250);
        poll_once_with_config(&mut w2, &fx.sk, &fx.dkim_dek, &smtp_ok, &api_addr, None, &c2).await.unwrap();
        h_ok.join().unwrap();
        assert_eq!(stats_ok.lock().unwrap().iter().filter(|e| **e == super::tests::WireEvent::EndOfDataMarker).count(), 1);
        assert_eq!(
            fx.admin.query_one("SELECT status, smtp_phase FROM outbound_queue WHERE id = $1", &[&qid_a]).await.unwrap().get::<_, Option<String>>(1).as_deref(),
            Some("accepted_by_mta")
        );
        assert_eq!(
            fx.admin.query_one("SELECT count(*) FROM delivery_log WHERE delivery_id = $1 AND status = 'delivered'", &[&did_a]).await.unwrap().get::<_, i64>(0),
            1
        );

        // Part B: Mid-stream lease expiry + reclaim by w2 BEFORE terminator fence ->
        // w1's mark_smtp_phase(TerminatorInFlight) fails closed -> socket closes WITHOUT .\r\n, RSET, QUIT;
        // w2 delivers the reclaimed row once.
        let (qid_b, did_b) = fx.enqueue_valid_delivery("mid-steal@external.com", false, 5, 3600).await;
        let claimed_b = claim_outbound_batch(&mut w1, &c1).await.unwrap();
        assert_eq!(claimed_b.len(), 1);
        let tok_b1 = claimed_b[0].lease_token;
        let env_b = super::tests::build_test_envelope(&["mid-steal@external.com"]);
        let mut large_b = b"Subject: Mid Stream Steal\r\n\r\n".to_vec();
        for i in 0..700 {
            large_b.extend_from_slice(format!("ChunkLine {:04}: 0123456789abcdef0123456789abcdef\r\n", i).as_bytes());
        }
        let (smtp_b1, ev_b1, pay_b1, h_b1) =
            super::tests::spawn_wire_transcript_smtp(super::tests::WireServerBehavior::Accept250);
        let admin_ref = &fx.admin;
        let w1_ref = &w1;
        let outcome_b = deliver_raw_to_smtp_phased_impl(
            &smtp_b1,
            &env_b,
            &large_b,
            Some(Duration::from_secs(2)),
            || async { mark_smtp_phase(w1_ref, qid_b, tok_b1, SmtpPhase::PreData).await },
            || async { mark_smtp_phase(w1_ref, qid_b, tok_b1, SmtpPhase::DataStreaming).await },
            || async {
                admin_ref
                    .execute(
                        "UPDATE outbound_queue SET lease_expires_at = now() - interval '5 seconds' WHERE id = $1",
                        &[&qid_b],
                    )
                    .await
                    .map_err(|e| anyhow::anyhow!(e))?;
                Ok(())
            },
            || async { mark_smtp_phase(w1_ref, qid_b, tok_b1, SmtpPhase::TerminatorInFlight).await },
        )
        .await
        .unwrap();
        h_b1.join().unwrap();
        assert_eq!(outcome_b, SmtpDeliveryOutcome::StaleLeaseAbortedInDataStreaming);
        assert!(pay_b1.lock().unwrap().is_empty());
        let wire_b1 = ev_b1.lock().unwrap();
        assert!(wire_b1.contains(&super::tests::WireEvent::EnteredDataMode));
        assert!(wire_b1.contains(&super::tests::WireEvent::ClientEofInDataMode));
        assert!(!wire_b1.contains(&super::tests::WireEvent::EndOfDataMarker));
        assert!(!wire_b1.contains(&super::tests::WireEvent::Command("RSET".to_string())));
        assert!(!wire_b1.contains(&super::tests::WireEvent::Command("QUIT".to_string())));

        let (smtp_b2, ev_b2, _, h_b2) =
            super::tests::spawn_wire_transcript_smtp(super::tests::WireServerBehavior::Accept250);
        poll_once_with_config(&mut w2, &fx.sk, &fx.dkim_dek, &smtp_b2, &api_addr, None, &c2).await.unwrap();
        h_b2.join().unwrap();
        assert!(ev_b2.lock().unwrap().contains(&super::tests::WireEvent::FinalReplySent(250)));
        assert_eq!(
            fx.admin.query_one("SELECT count(*) FROM delivery_log WHERE delivery_id = $1 AND status = 'delivered'", &[&did_b]).await.unwrap().get::<_, i64>(0),
            1
        );

        // Part C: Explicit post-terminator 451 -> temporary retry (status='pending', 'retry' log);
        // Explicit post-terminator 550 -> permanent bounce (status='bounced', 'bounced' log).
        let (qid_451, did_451) = fx.enqueue_valid_delivery("temp-post@external.com", false, 5, 3600).await;
        let (smtp_451, ev_451, _, h_451) = super::tests::spawn_wire_transcript_smtp(
            super::tests::WireServerBehavior::ReplyAfterDataDot("451 4.3.0 Try later\r\n", 451),
        );
        poll_once_with_config(&mut w2, &fx.sk, &fx.dkim_dek, &smtp_451, &api_addr, None, &c2).await.unwrap();
        h_451.join().unwrap();
        assert!(ev_451.lock().unwrap().contains(&super::tests::WireEvent::EndOfDataMarker));
        assert_eq!(
            fx.admin.query_one("SELECT status, smtp_phase FROM outbound_queue WHERE id = $1", &[&qid_451]).await.unwrap().get::<_, String>(0),
            "pending"
        );
        assert_eq!(
            fx.admin.query_one("SELECT status FROM delivery_log WHERE delivery_id = $1", &[&did_451]).await.unwrap().get::<_, String>(0),
            "retry"
        );
        fx.admin.execute("UPDATE outbound_queue SET next_attempt_at = now() + interval '1 hour' WHERE id = $1", &[&qid_451]).await.unwrap();

        let (qid_550, did_550) = fx.enqueue_valid_delivery("perm-post@external.com", false, 5, 3600).await;
        let (smtp_550, ev_550, _, h_550) = super::tests::spawn_wire_transcript_smtp(
            super::tests::WireServerBehavior::ReplyAfterDataDot("550 5.7.1 Rejected\r\n", 550),
        );
        poll_once_with_config(&mut w2, &fx.sk, &fx.dkim_dek, &smtp_550, &api_addr, None, &c2).await.unwrap();
        h_550.join().unwrap();
        assert!(ev_550.lock().unwrap().contains(&super::tests::WireEvent::EndOfDataMarker));
        assert_eq!(
            fx.admin.query_one("SELECT status FROM outbound_queue WHERE id = $1", &[&qid_550]).await.unwrap().get::<_, String>(0),
            "bounced"
        );
        assert_eq!(
            fx.admin.query_one("SELECT status FROM delivery_log WHERE delivery_id = $1", &[&did_550]).await.unwrap().get::<_, String>(0),
            "bounced"
        );

        api_h.abort();
        fx.cleanup().await;
    }

    #[tokio::test]
    async fn test_pg_least_privilege_rbac_enforced() {
        let _lock = TEST_DB_SERIAL.get_or_init(|| tokio::sync::Mutex::new(())).lock().await;
        let (_, worker_url) = require_isolated_pg_urls();
        let worker = connect_pg(&worker_url).await;
        for restricted in [
            "root_secrets",
            "message_metadata",
            "device_mailbox_access",
            "storage_connections",
        ] {
            let err = worker
                .query_opt(&format!("SELECT 1 FROM {} LIMIT 1", restricted), &[])
                .await
                .unwrap_err();
            let db_msg = err
                .as_db_error()
                .map(|d| d.message().to_string())
                .unwrap_or_else(|| err.to_string());
            assert!(
                db_msg.contains("permission denied"),
                "expected permission denied on {}, got {} ({:?})",
                restricted,
                db_msg,
                err
            );
        }
    }

    #[derive(Clone)]
    struct MockV2AttachmentObj {
        mailbox_id: Uuid,
        outbox_seq: i64,
        attachment_id: Uuid,
        position: i32,
        disposition: String,
        content_id: String,
        filename: String,
        content_type: String,
        plaintext: Vec<u8>,
        ciphertext: Vec<u8>,
        plaintext_sha256_hex: String,
        ciphertext_sha256_hex: String,
        outbound_key_id: String,
        outbound_key_epoch: i32,
        cek_outbound_wrapped_b64: String,
        metadata_sha256_hex: String,
        blob_status_override: Option<u16>,
        manifest_status_override: Option<u16>,
    }

    fn build_mock_v2_obj(
        mailbox_id: Uuid,
        outbox_seq: u64,
        outbound_pk: &[u8; 32],
        outbound_epoch: i32,
        position: i32,
        filename: &str,
        content_type: &str,
        plaintext: &[u8],
    ) -> MockV2AttachmentObj {
        use base64::Engine as _;
        let att_id = Uuid::new_v4();
        let cek = [0x5Au8; 32];
        let pt_sha = byos_crypto_core::sha256_digest(plaintext);
        let blob_aad = byos_crypto_core::attachment_blob_aad_v2(
            mailbox_id.as_bytes(),
            att_id.as_bytes(),
            byos_crypto_core::ATTACHMENT_CRYPTO_VERSION_V2,
            byos_crypto_core::ATTACHMENT_AAD_VERSION_V2,
        );
        let ct = byos_crypto_core::aes_gcm_encrypt(&cek, plaintext, &blob_aad).unwrap();
        let ct_sha = byos_crypto_core::sha256_digest(&ct);
        let meta_sha = byos_crypto_core::attachment_metadata_sha256_v2(
            filename,
            content_type,
            plaintext.len() as u64,
            &pt_sha,
            byos_crypto_core::ATTACHMENT_DISPOSITION_ATTACHMENT,
            "",
        );
        let key_id = byos_crypto_core::outbound_key_id(outbound_pk);
        let out_aad = byos_crypto_core::attachment_outbound_wrap_aad_v2(
            mailbox_id.as_bytes(),
            outbox_seq,
            att_id.as_bytes(),
            &key_id,
            outbound_epoch as u32,
            byos_crypto_core::ATTACHMENT_CRYPTO_VERSION_V2 as u8,
            &meta_sha,
        );
        let wrapped = byos_crypto_core::wrap_cek_outbound_v2(outbound_pk, &cek, &out_aad).unwrap();
        MockV2AttachmentObj {
            mailbox_id,
            outbox_seq: outbox_seq as i64,
            attachment_id: att_id,
            position,
            disposition: "attachment".to_string(),
            content_id: String::new(),
            filename: filename.to_string(),
            content_type: content_type.to_string(),
            plaintext: plaintext.to_vec(),
            ciphertext: ct,
            plaintext_sha256_hex: hex::encode(pt_sha),
            ciphertext_sha256_hex: hex::encode(ct_sha),
            outbound_key_id: hex::encode(key_id),
            outbound_key_epoch: outbound_epoch,
            cek_outbound_wrapped_b64: base64::engine::general_purpose::STANDARD.encode(&wrapped),
            metadata_sha256_hex: hex::encode(meta_sha),
            blob_status_override: None,
            manifest_status_override: None,
        }
    }

    async fn spawn_mock_release_b_api(
        store: Arc<std::sync::Mutex<std::collections::HashMap<Uuid, Vec<MockV2AttachmentObj>>>>,
        transient_503_budget: Arc<std::sync::atomic::AtomicUsize>,
    ) -> (String, tokio::task::JoinHandle<()>) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        use tokio::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap().to_string();

        let handle = tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else {
                    break;
                };
                let store = store.clone();
                let budget = transient_503_budget.clone();
                tokio::spawn(async move {
                    let mut buf = vec![0u8; 65536];
                    let n = sock.read(&mut buf).await.unwrap_or(0);
                    if n == 0 {
                        return;
                    }
                    let req_str = String::from_utf8_lossy(&buf[..n]);
                    let first_line = req_str.lines().next().unwrap_or("");
                    let path = first_line.split_whitespace().nth(1).unwrap_or("");

                    // /v1/internal/scheduled/complete
                    if path == "/v1/internal/scheduled/complete" {
                        let _ = sock
                            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok")
                            .await;
                        return;
                    }

                    // Parse /v1/internal/outbound/{delivery_id}/attachments[/<att_id>/blob]
                    let trimmed = path.trim_start_matches("/v1/internal/outbound/");
                    let parts: Vec<&str> = trimmed.split('/').collect();
                    let did = parts.first().and_then(|s| Uuid::parse_str(s).ok());
                    let Some(delivery_id) = did else {
                        let _ = sock
                            .write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 9\r\nConnection: close\r\n\r\nnot found")
                            .await;
                        return;
                    };

                    let items = {
                        let guard = store.lock().unwrap();
                        guard.get(&delivery_id).cloned().unwrap_or_default()
                    };

                    if parts.len() == 2 && parts[1] == "attachments" {
                        if let Some(status) = items.first().and_then(|i| i.manifest_status_override) {
                            let hdr = format!("HTTP/1.1 {} Override\r\nContent-Length: 5\r\nConnection: close\r\n\r\nerror", status);
                            let _ = sock.write_all(hdr.as_bytes()).await;
                            return;
                        }
                        let mut manifest_items = Vec::new();
                        for it in &items {
                            manifest_items.push(serde_json::json!({
                                "attachment_id": it.attachment_id.to_string(),
                                "position": it.position,
                                "disposition": it.disposition,
                                "content_id": it.content_id,
                                "filename": it.filename,
                                "content_type": it.content_type,
                                "crypto_version": 2,
                                "blob_aad_version": 2,
                                "plaintext_size_bytes": it.plaintext.len(),
                                "ciphertext_size_bytes": it.ciphertext.len(),
                                "plaintext_sha256_hex": it.plaintext_sha256_hex,
                                "ciphertext_sha256_hex": it.ciphertext_sha256_hex,
                                "wrap_alg": "HPKE-X25519-AES256GCM-v1",
                                "outbound_key_id": it.outbound_key_id,
                                "outbound_key_epoch": it.outbound_key_epoch,
                                "cek_outbound_wrapped_b64": it.cek_outbound_wrapped_b64,
                                "metadata_sha256_hex": it.metadata_sha256_hex,
                            }));
                        }
                        let first_mb = items.first().map(|i| i.mailbox_id.to_string()).unwrap_or_default();
                        let first_seq = items.first().map(|i| i.outbox_seq).unwrap_or(0);
                        let body = serde_json::json!({
                            "delivery_id": delivery_id.to_string(),
                            "mailbox_id": first_mb,
                            "outbox_seq": first_seq,
                            "attachment_count": items.len(),
                            "attachments": manifest_items,
                        })
                        .to_string();
                        let resp = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                            body.len(),
                            body
                        );
                        let _ = sock.write_all(resp.as_bytes()).await;
                        return;
                    }

                    if parts.len() == 4 && parts[1] == "attachments" && parts[3] == "blob" {
                        if budget
                            .fetch_update(
                                std::sync::atomic::Ordering::SeqCst,
                                std::sync::atomic::Ordering::SeqCst,
                                |cur| if cur > 0 { Some(cur - 1) } else { None },
                            )
                            .is_ok()
                        {
                            let _ = sock
                                .write_all(b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 11\r\nConnection: close\r\n\r\nunavailable")
                                .await;
                            return;
                        }
                        let att_uuid = Uuid::parse_str(parts[2]).ok();
                        let found = att_uuid.and_then(|aid| items.into_iter().find(|i| i.attachment_id == aid));
                        let Some(it) = found else {
                            let _ = sock
                                .write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 7\r\nConnection: close\r\n\r\nmissing")
                                .await;
                            return;
                        };
                        if let Some(status) = it.blob_status_override {
                            let hdr = format!("HTTP/1.1 {} Error\r\nContent-Length: 5\r\nConnection: close\r\n\r\nerror", status);
                            let _ = sock.write_all(hdr.as_bytes()).await;
                            return;
                        }
                        let hdr = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: {}\r\nX-Expected-Ciphertext-Sha256: {}\r\nConnection: close\r\n\r\n",
                            it.ciphertext.len(),
                            it.ciphertext_sha256_hex
                        );
                        let _ = sock.write_all(hdr.as_bytes()).await;
                        let _ = sock.write_all(&it.ciphertext).await;
                        return;
                    }

                    let _ = sock
                        .write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 9\r\nConnection: close\r\n\r\nnot found")
                        .await;
                });
            }
        });
        (addr, handle)
    }

    async fn spawn_capture_smtp_multi() -> (
        String,
        Arc<Mutex<Vec<(Vec<String>, Vec<u8>)>>>,
        tokio::task::JoinHandle<()>,
    ) {
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
        use tokio::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap().to_string();
        let captured = Arc::new(Mutex::new(Vec::new()));
        let cap_clone = captured.clone();

        let handle = tokio::spawn(async move {
            loop {
                let Ok((stream, _)) = listener.accept().await else {
                    break;
                };
                let cap_conn = cap_clone.clone();
                tokio::spawn(async move {
                    let (rh, mut wh) = stream.into_split();
                    let mut reader = BufReader::new(rh);
                    let _ = wh.write_all(b"220 mock-capture ESMTP\r\n").await;
                    let mut in_data = false;
                    let mut rcpts = Vec::new();
                    let mut data_buf = Vec::<u8>::new();
                    let mut line_buf = Vec::<u8>::new();
                    loop {
                        line_buf.clear();
                        match reader.read_until(b'\n', &mut line_buf).await {
                            Ok(0) | Err(_) => break,
                            Ok(_) => {}
                        }
                        if in_data {
                            if line_buf == b".\r\n" || line_buf == b".\n" {
                                in_data = false;
                                cap_conn.lock().unwrap().push((rcpts.clone(), data_buf.clone()));
                                data_buf.clear();
                                rcpts.clear();
                                let _ = wh.write_all(b"250 2.0.0 OK queued\r\n").await;
                            } else if line_buf.starts_with(b"..") {
                                data_buf.extend_from_slice(&line_buf[1..]);
                            } else {
                                data_buf.extend_from_slice(&line_buf);
                            }
                            continue;
                        }
                        let line_str = String::from_utf8_lossy(&line_buf);
                        let upper = line_str.trim().to_ascii_uppercase();
                        if upper.starts_with("EHLO") || upper.starts_with("HELO") {
                            let _ = wh.write_all(b"250-mock-capture\r\n250 8BITMIME\r\n").await;
                        } else if upper.starts_with("MAIL FROM:") {
                            let _ = wh.write_all(b"250 2.1.0 OK\r\n").await;
                        } else if upper.starts_with("RCPT TO:") {
                            rcpts.push(line_str.trim().to_string());
                            let _ = wh.write_all(b"250 2.1.5 OK\r\n").await;
                        } else if upper == "DATA" {
                            in_data = true;
                            let _ = wh.write_all(b"354 End with <CRLF>.<CRLF>\r\n").await;
                        } else if upper == "QUIT" {
                            let _ = wh.write_all(b"221 2.0.0 Bye\r\n").await;
                            break;
                        } else {
                            let _ = wh.write_all(b"250 OK\r\n").await;
                        }
                    }
                });
            }
        });
        (addr, captured, handle)
    }

    #[tokio::test]
    async fn test_pg_release_b_least_privilege_rbac_and_e2e_attachments_25mib_and_failures() {
        let _lock = TEST_DB_SERIAL.get_or_init(|| tokio::sync::Mutex::new(())).lock().await;
        let mut fx = TestTenantFixture::setup().await;
        let mut worker = connect_pg(&fx.worker_url).await;

        // Verify schema_070 columns exist on isolated test DB
        let has_att_col: bool = fx
            .admin
            .query_one(
                "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='outbound_queue' AND column_name='attachment_count')",
                &[],
            )
            .await
            .unwrap()
            .get(0);
        if !has_att_col {
            fx.cleanup().await;
            panic!("isolated test DB missing proposed_070 schema (attachment_count)");
        }

        // 1. Verify least-privilege RBAC rejects outbound_worker SELECT on attachment metadata & grant tables
        for restricted in [
            "attachments",
            "outbound_delivery_attachments",
            "outbound_delivery_keys",
            "draft_attachments",
        ] {
            let err = worker
                .query_opt(&format!("SELECT 1 FROM {} LIMIT 1", restricted), &[])
                .await
                .unwrap_err();
            let db_msg = err
                .as_db_error()
                .map(|d| d.message().to_string())
                .unwrap_or_else(|| err.to_string());
            assert!(
                db_msg.contains("permission denied"),
                "expected permission denied on {}, got {}",
                restricted,
                db_msg
            );
        }

        // Configure two-epoch keyring file (epoch 1 decrypt_only = fx.sk, epoch 2 active = rotated keypair)
        use base64::Engine as _;
        let (sk2, pk2) = generate_outbound_delivery_keypair();
        let ring_json = serde_json::json!({
            "keys": [
                {
                    "key_epoch": 1,
                    "key_id": byos_crypto_core::outbound_key_id_hex(&fx.pk),
                    "sk_b64": base64::engine::general_purpose::STANDARD.encode(fx.sk),
                    "status": "decrypt_only"
                },
                {
                    "key_epoch": 2,
                    "key_id": byos_crypto_core::outbound_key_id_hex(&pk2),
                    "sk_b64": base64::engine::general_purpose::STANDARD.encode(sk2),
                    "status": "active"
                }
            ]
        });
        let ring_path = std::env::temp_dir().join(format!("byos_relb_ring_{}.json", Uuid::new_v4()));
        std::fs::write(&ring_path, ring_json.to_string()).unwrap();
        std::env::set_var("OUTBOUND_DELIVERY_SK_RING_FILE", &ring_path);
        std::env::set_var("INTERNAL_API_KEY", "test-internal-api-key-relb");

        let dkim_kp = DkimKeypair::generate("sel1").unwrap();
        let dkim_enc = encrypt_dkim_private_key(&fx.dkim_dek, &dkim_kp.private_key_pem).unwrap();
        fx.admin
            .execute(
                "UPDATE domains SET dkim_private_key_enc = $1 WHERE id = $2",
                &[&dkim_enc, &fx.domain_id],
            )
            .await
            .unwrap();

        let att_store: Arc<std::sync::Mutex<std::collections::HashMap<Uuid, Vec<MockV2AttachmentObj>>>> =
            Arc::new(std::sync::Mutex::new(std::collections::HashMap::new()));
        let transient_budget = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let (api_addr, api_h) = spawn_mock_release_b_api(att_store.clone(), transient_budget.clone()).await;
        let (smtp_addr, captured_smtp, smtp_h) = spawn_capture_smtp_multi().await;
        let lcfg = test_lease_config("worker-relb", Duration::from_secs(60), 10);

        let enqueue_with_att_count = |fx: &mut TestTenantFixture,
                                      recipient_csv: &str,
                                      mime_body: &str,
                                      att_count: i32,
                                      epoch: i32,
                                      key_id: &str,
                                      send_pk: &[u8; 32]| {
            fx.seq_counter += 1;
            let seq = fx.seq_counter as i64;
            let mut mailbox_bytes = [0u8; 16];
            mailbox_bytes.copy_from_slice(fx.mailbox_id.as_bytes());
            let (enc_msg, wrapped, iv, _, _) =
                encrypt_outbound(send_pk, &mailbox_bytes, seq as u64, mime_body.as_bytes()).unwrap();
            let reservation_id = Uuid::new_v4();
            let delivery_id = Uuid::new_v4();
            let recipient_str = recipient_csv.to_string();
            let key_id_str = key_id.to_string();
            (seq, reservation_id, delivery_id, enc_msg, wrapped, iv, recipient_str, epoch, key_id_str, att_count)
        };

        // ---- Case 1: Multi-attachment external message (PDF, PNG, DOCX, Unicode TXT, 0-byte BIN) + BCC privacy + DKIM + Key Epoch 1 decrypt_only ----
        let pdf_bytes = b"%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n".to_vec();
        let png_bytes = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D];
        let docx_bytes = b"PK\x03\x04mock-docx-zip-header-bytes-1234567890".to_vec();
        let unicode_bytes = "Résumé 日本語 €100 attachment body\nline2".as_bytes().to_vec();
        let zero_bytes = Vec::<u8>::new();

        let raw_mime_1 = format!(
            "From: sender@{}\r\nTo: to@external.test\r\nCc: cc@external.test\r\nBcc: secret-bcc@external.test\r\nSubject: Release B Multi Attachment\r\nMIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary=\"alt-1\"\r\n\r\n--alt-1\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nPlain body with attachments\r\n--alt-1\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>HTML body with attachments</p>\r\n--alt-1--\r\n",
            fx.domain_name
        );
        let rcpt_csv_1 = "to@external.test, cc@external.test, secret-bcc@external.test";
        let pk1 = fx.pk;
        let key_id_1 = byos_crypto_core::outbound_key_id_hex(&pk1);
        let (seq1, res1, did1, em1, wr1, iv1, r1, ep1, kid1, ac1) =
            enqueue_with_att_count(&mut fx, rcpt_csv_1, &raw_mime_1, 5, 1, &key_id_1, &pk1);

        let objs1 = vec![
            build_mock_v2_obj(fx.mailbox_id, seq1 as u64, &fx.pk, 1, 0, "report.pdf", "application/pdf", &pdf_bytes),
            build_mock_v2_obj(fx.mailbox_id, seq1 as u64, &pk2, 2, 1, "chart.png", "image/png", &png_bytes),
            build_mock_v2_obj(fx.mailbox_id, seq1 as u64, &pk2, 2, 2, "proposal.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", &docx_bytes),
            build_mock_v2_obj(fx.mailbox_id, seq1 as u64, &pk2, 2, 3, "résumé_日本語.txt", "text/plain", &unicode_bytes),
            build_mock_v2_obj(fx.mailbox_id, seq1 as u64, &pk2, 2, 4, "empty.bin", "application/octet-stream", &zero_bytes),
        ];
        att_store.lock().unwrap().insert(did1, objs1.clone());

        fx.admin
            .execute(
                "INSERT INTO outbound_reservations (reservation_id, user_id, mailbox_id, outbox_seq, encryption_version, aad_version, status, delivery_id) VALUES ($1,$2,$3,$4,1,1,'consumed',$5)",
                &[&res1, &fx.user_id, &fx.mailbox_id, &seq1, &did1],
            )
            .await
            .unwrap();
        let qid1: Uuid = fx
            .admin
            .query_one(
                "INSERT INTO outbound_queue (delivery_id, mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped, outbox_seq, encryption_version, aad_version, encryption_iv, reservation_id, status, max_attempts, next_attempt_at, expires_at, attachment_count, send_token_key_epoch, send_token_key_id) \
                 VALUES ($1,$2,$3,$4,$5,$6,$7,1,1,$8,$9,'pending',5,now(),now()+interval '1 hour',$10,$11,$12) RETURNING id",
                &[&did1, &fx.mailbox_id, &fx.domain_id, &r1, &em1, &wr1, &seq1, &iv1.as_slice(), &res1, &ac1, &ep1, &kid1],
            )
            .await
            .unwrap()
            .get(0);

        poll_once_with_config(&mut worker, &fx.sk, &fx.dkim_dek, &smtp_addr, &api_addr, None, &lcfg).await.unwrap();
        assert_eq!(
            fx.admin.query_one("SELECT status FROM outbound_queue WHERE id=$1", &[&qid1]).await.unwrap().get::<_, String>(0),
            "delivered"
        );

        let cap1 = captured_smtp.lock().unwrap().remove(0);
        assert_eq!(cap1.0.len(), 3, "expected 3 RCPT TO commands including Bcc");
        assert!(cap1.0.iter().any(|r| r.contains("secret-bcc@external.test")));
        let data1_str = String::from_utf8_lossy(&cap1.1);
        assert!(!data1_str.to_ascii_lowercase().contains("bcc:"), "BCC leaked into SMTP DATA!");
        let dkim_signed_portion = data1_str
            .find("DKIM-Signature:")
            .map(|pos| &cap1.1[pos..])
            .expect("missing DKIM-Signature header in SMTP DATA");
        assert!(byos_crypto_core::verify_dkim_signature(dkim_signed_portion, &dkim_kp.public_key_pem), "DKIM verification failed on multipart/mixed with 5 attachments!");
        assert!(byos_crypto_core::verify_dkim_signature(&cap1.1, &dkim_kp.public_key_pem), "DKIM verification must also succeed directly when Authentication-Results precedes DKIM-Signature!");

        let parsed1 = mailparse::parse_mail(&cap1.1).unwrap();
        assert_eq!(parsed1.ctype.mimetype, "multipart/mixed");
        assert_eq!(parsed1.subparts.len(), 6, "expected 1 body + 5 attachments");
        assert_eq!(parsed1.subparts[0].ctype.mimetype, "multipart/alternative");
        let expected_payloads = [&pdf_bytes, &png_bytes, &docx_bytes, &unicode_bytes, &zero_bytes];
        for (idx, expected) in expected_payloads.iter().enumerate() {
            let decoded = parsed1.subparts[idx + 1].get_body_raw().unwrap();
            assert_eq!(
                byos_crypto_core::sha256_digest(&decoded),
                byos_crypto_core::sha256_digest(expected),
                "SHA-256 mismatch for attachment {}",
                idx
            );
        }

        // ---- Case 2: Exact 25 MiB aggregate attachment delivery + timing/memory check ----
        let exact_25_mib = vec![0x5Bu8; 25 * 1024 * 1024];
        let raw_mime_25 = format!(
            "From: sender@{}\r\nTo: big@external.test\r\nSubject: 25 MiB Limit Test\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n25 MiB body\r\n",
            fx.domain_name
        );
        let key_id_2 = byos_crypto_core::outbound_key_id_hex(&pk2);
        let (seq2, res2, did2, em2, wr2, iv2, r2, ep2, kid2, ac2) =
            enqueue_with_att_count(&mut fx, "big@external.test", &raw_mime_25, 1, 2, &key_id_2, &pk2);
        let obj25 = build_mock_v2_obj(fx.mailbox_id, seq2 as u64, &pk2, 2, 0, "limit-25mib.bin", "application/octet-stream", &exact_25_mib);
        att_store.lock().unwrap().insert(did2, vec![obj25]);
        fx.admin
            .execute(
                "INSERT INTO outbound_reservations (reservation_id, user_id, mailbox_id, outbox_seq, encryption_version, aad_version, status, delivery_id) VALUES ($1,$2,$3,$4,1,1,'consumed',$5)",
                &[&res2, &fx.user_id, &fx.mailbox_id, &seq2, &did2],
            )
            .await
            .unwrap();
        let qid2: Uuid = fx
            .admin
            .query_one(
                "INSERT INTO outbound_queue (delivery_id, mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped, outbox_seq, encryption_version, aad_version, encryption_iv, reservation_id, status, max_attempts, next_attempt_at, expires_at, attachment_count, send_token_key_epoch, send_token_key_id) \
                 VALUES ($1,$2,$3,$4,$5,$6,$7,1,1,$8,$9,'pending',5,now(),now()+interval '1 hour',$10,$11,$12) RETURNING id",
                &[&did2, &fx.mailbox_id, &fx.domain_id, &r2, &em2, &wr2, &seq2, &iv2.as_slice(), &res2, &ac2, &ep2, &kid2],
            )
            .await
            .unwrap()
            .get(0);

        let t0 = std::time::Instant::now();
        poll_once_with_config(&mut worker, &fx.sk, &fx.dkim_dek, &smtp_addr, &api_addr, None, &lcfg).await.unwrap();
        let elapsed_25mib = t0.elapsed();
        eprintln!("[REL-B BENCHMARK] 25 MiB attachment retrieve+decrypt+MIME+DKIM+SMTP elapsed={:?}", elapsed_25mib);
        assert_eq!(
            fx.admin.query_one("SELECT status FROM outbound_queue WHERE id=$1", &[&qid2]).await.unwrap().get::<_, String>(0),
            "delivered"
        );
        let cap25 = captured_smtp.lock().unwrap().remove(0);
        let parsed25 = mailparse::parse_mail(&cap25.1).unwrap();
        assert_eq!(parsed25.subparts.len(), 2);
        let decoded25 = parsed25.subparts[1].get_body_raw().unwrap();
        assert_eq!(decoded25.len(), 25 * 1024 * 1024);
        assert_eq!(byos_crypto_core::sha256_digest(&decoded25), byos_crypto_core::sha256_digest(&exact_25_mib));

        // ---- Case 3: Missing blob (404) -> permanent bounce, zero SMTP ----
        let (seq3, res3, did3, em3, wr3, iv3, r3, ep3, kid3, ac3) =
            enqueue_with_att_count(&mut fx, "miss@external.test", &raw_mime_25, 1, 2, &key_id_2, &pk2);
        let mut obj_miss = build_mock_v2_obj(fx.mailbox_id, seq3 as u64, &pk2, 2, 0, "miss.pdf", "application/pdf", b"hello");
        obj_miss.blob_status_override = Some(404);
        att_store.lock().unwrap().insert(did3, vec![obj_miss]);
        fx.admin.execute("INSERT INTO outbound_reservations (reservation_id, user_id, mailbox_id, outbox_seq, encryption_version, aad_version, status, delivery_id) VALUES ($1,$2,$3,$4,1,1,'consumed',$5)", &[&res3, &fx.user_id, &fx.mailbox_id, &seq3, &did3]).await.unwrap();
        let qid3: Uuid = fx.admin.query_one("INSERT INTO outbound_queue (delivery_id, mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped, outbox_seq, encryption_version, aad_version, encryption_iv, reservation_id, status, max_attempts, next_attempt_at, expires_at, attachment_count, send_token_key_epoch, send_token_key_id) VALUES ($1,$2,$3,$4,$5,$6,$7,1,1,$8,$9,'pending',5,now(),now()+interval '1 hour',$10,$11,$12) RETURNING id", &[&did3, &fx.mailbox_id, &fx.domain_id, &r3, &em3, &wr3, &seq3, &iv3.as_slice(), &res3, &ac3, &ep3, &kid3]).await.unwrap().get(0);
        poll_once_with_config(&mut worker, &fx.sk, &fx.dkim_dek, &smtp_addr, &api_addr, None, &lcfg).await.unwrap();
        assert_eq!(fx.admin.query_one("SELECT status FROM outbound_queue WHERE id=$1", &[&qid3]).await.unwrap().get::<_, String>(0), "bounced");
        assert!(captured_smtp.lock().unwrap().is_empty(), "missing blob must never send SMTP");

        // ---- Case 4: Corrupted ciphertext -> permanent bounce, zero SMTP ----
        let (seq4, res4, did4, em4, wr4, iv4, r4, ep4, kid4, ac4) =
            enqueue_with_att_count(&mut fx, "badct@external.test", &raw_mime_25, 1, 2, &key_id_2, &pk2);
        let mut obj_badct = build_mock_v2_obj(fx.mailbox_id, seq4 as u64, &pk2, 2, 0, "bad.pdf", "application/pdf", b"hello");
        let last = obj_badct.ciphertext.len() - 1;
        obj_badct.ciphertext[last] ^= 0xff;
        att_store.lock().unwrap().insert(did4, vec![obj_badct]);
        fx.admin.execute("INSERT INTO outbound_reservations (reservation_id, user_id, mailbox_id, outbox_seq, encryption_version, aad_version, status, delivery_id) VALUES ($1,$2,$3,$4,1,1,'consumed',$5)", &[&res4, &fx.user_id, &fx.mailbox_id, &seq4, &did4]).await.unwrap();
        let qid4: Uuid = fx.admin.query_one("INSERT INTO outbound_queue (delivery_id, mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped, outbox_seq, encryption_version, aad_version, encryption_iv, reservation_id, status, max_attempts, next_attempt_at, expires_at, attachment_count, send_token_key_epoch, send_token_key_id) VALUES ($1,$2,$3,$4,$5,$6,$7,1,1,$8,$9,'pending',5,now(),now()+interval '1 hour',$10,$11,$12) RETURNING id", &[&did4, &fx.mailbox_id, &fx.domain_id, &r4, &em4, &wr4, &seq4, &iv4.as_slice(), &res4, &ac4, &ep4, &kid4]).await.unwrap().get(0);
        poll_once_with_config(&mut worker, &fx.sk, &fx.dkim_dek, &smtp_addr, &api_addr, None, &lcfg).await.unwrap();
        assert_eq!(fx.admin.query_one("SELECT status FROM outbound_queue WHERE id=$1", &[&qid4]).await.unwrap().get::<_, String>(0), "bounced");
        assert!(captured_smtp.lock().unwrap().is_empty(), "corrupt ciphertext must never send SMTP");

        // ---- Case 5: Transient 503 storage outage -> retry -> recovery delivers ONCE with exact 1 attachment ----
        transient_budget.store(1, std::sync::atomic::Ordering::SeqCst);
        let (seq5, res5, did5, em5, wr5, iv5, r5, ep5, kid5, ac5) =
            enqueue_with_att_count(&mut fx, "retry503@external.test", &raw_mime_25, 1, 2, &key_id_2, &pk2);
        let obj_retry = build_mock_v2_obj(fx.mailbox_id, seq5 as u64, &pk2, 2, 0, "once.pdf", "application/pdf", b"retry-payload");
        att_store.lock().unwrap().insert(did5, vec![obj_retry]);
        fx.admin.execute("INSERT INTO outbound_reservations (reservation_id, user_id, mailbox_id, outbox_seq, encryption_version, aad_version, status, delivery_id) VALUES ($1,$2,$3,$4,1,1,'consumed',$5)", &[&res5, &fx.user_id, &fx.mailbox_id, &seq5, &did5]).await.unwrap();
        let qid5: Uuid = fx.admin.query_one("INSERT INTO outbound_queue (delivery_id, mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped, outbox_seq, encryption_version, aad_version, encryption_iv, reservation_id, status, max_attempts, next_attempt_at, expires_at, attachment_count, send_token_key_epoch, send_token_key_id) VALUES ($1,$2,$3,$4,$5,$6,$7,1,1,$8,$9,'pending',5,now(),now()+interval '1 hour',$10,$11,$12) RETURNING id", &[&did5, &fx.mailbox_id, &fx.domain_id, &r5, &em5, &wr5, &seq5, &iv5.as_slice(), &res5, &ac5, &ep5, &kid5]).await.unwrap().get(0);

        poll_once_with_config(&mut worker, &fx.sk, &fx.dkim_dek, &smtp_addr, &api_addr, None, &lcfg).await.unwrap();
        let st5 = fx.admin.query_one("SELECT status, attempts FROM outbound_queue WHERE id=$1", &[&qid5]).await.unwrap();
        assert_eq!(st5.get::<_, String>(0), "pending");
        assert_eq!(st5.get::<_, i32>(1), 1);
        assert!(captured_smtp.lock().unwrap().is_empty());

        fx.admin.execute("UPDATE outbound_queue SET next_attempt_at = now() - interval '1 second' WHERE id=$1", &[&qid5]).await.unwrap();
        poll_once_with_config(&mut worker, &fx.sk, &fx.dkim_dek, &smtp_addr, &api_addr, None, &lcfg).await.unwrap();
        assert_eq!(fx.admin.query_one("SELECT status FROM outbound_queue WHERE id=$1", &[&qid5]).await.unwrap().get::<_, String>(0), "delivered");
        let cap5 = captured_smtp.lock().unwrap().remove(0);
        let parsed5 = mailparse::parse_mail(&cap5.1).unwrap();
        assert_eq!(parsed5.subparts.len(), 2, "retry must attach exactly 1 attachment without duplication");
        assert_eq!(parsed5.subparts[1].get_body_raw().unwrap(), b"retry-payload");

        // ---- Case 6: Scheduled delivery promotion with attachment -> delivered cleanly ----
        let (seq6, res6, did6, em6, wr6, iv6, r6, ep6, kid6, ac6) =
            enqueue_with_att_count(&mut fx, "sched@external.test", &raw_mime_25, 1, 2, &key_id_2, &pk2);
        let obj_sched = build_mock_v2_obj(fx.mailbox_id, seq6 as u64, &pk2, 2, 0, "sched.txt", "text/plain", b"scheduled-att-body");
        att_store.lock().unwrap().insert(did6, vec![obj_sched]);
        fx.admin.execute("INSERT INTO outbound_reservations (reservation_id, user_id, mailbox_id, outbox_seq, encryption_version, aad_version, status, delivery_id) VALUES ($1,$2,$3,$4,1,1,'consumed',$5)", &[&res6, &fx.user_id, &fx.mailbox_id, &seq6, &did6]).await.unwrap();
        let draft_ref6 = format!("mailboxes/{}/scheduled/{}.draft.enc", fx.mailbox_id, did6);
        fx.admin.execute(
            "INSERT INTO scheduled_messages (delivery_id, mailbox_id, domain_id, reservation_id, recipient, encrypted_message, send_token_hpke_wrapped, send_token_hash, outbox_seq, encryption_version, aad_version, encryption_iv, scheduled_at, expires_at, is_path_a, draft_storage_ref, status, attachment_count, send_token_key_epoch, send_token_key_id) \
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,1,$10,now() - interval '5 seconds',now() + interval '1 hour',false,$11,'pending',$12,$13,$14)",
            &[&did6, &fx.mailbox_id, &fx.domain_id, &res6, &r6, &em6, &wr6, &vec![0x11u8; 32], &seq6, &iv6.as_slice(), &draft_ref6, &ac6, &ep6, &kid6],
        ).await.unwrap();

        poll_scheduled(&mut worker, &api_addr, None).await.unwrap();
        poll_once_with_config(&mut worker, &fx.sk, &fx.dkim_dek, &smtp_addr, &api_addr, None, &lcfg).await.unwrap();
        assert_eq!(
            fx.admin.query_one("SELECT status FROM outbound_queue WHERE delivery_id=$1", &[&did6]).await.unwrap().get::<_, String>(0),
            "delivered"
        );
        let cap6 = captured_smtp.lock().unwrap().remove(0);
        let parsed6 = mailparse::parse_mail(&cap6.1).unwrap();
        assert_eq!(parsed6.subparts.len(), 2);
        assert_eq!(parsed6.subparts[1].get_body_raw().unwrap(), b"scheduled-att-body");

        // Cleanup
        let _ = std::fs::remove_file(&ring_path);
        std::env::remove_var("OUTBOUND_DELIVERY_SK_RING_FILE");
        std::env::remove_var("INTERNAL_API_KEY");
        api_h.abort();
        smtp_h.abort();
        fx.cleanup().await;
    }

    #[tokio::test]
    async fn test_pg_release_b_interrupted_retrieval_and_performance_metrics() {
        let _lock = TEST_DB_SERIAL.get_or_init(|| tokio::sync::Mutex::new(())).lock().await;
        let mut fx = TestTenantFixture::setup().await;
        let mut worker = connect_pg(&fx.worker_url).await;

        let has_att_col: bool = fx
            .admin
            .query_one(
                "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='outbound_queue' AND column_name='attachment_count')",
                &[],
            )
            .await
            .unwrap()
            .get(0);
        if !has_att_col {
            fx.cleanup().await;
            panic!("isolated test DB missing proposed_070 schema (attachment_count)");
        }

        use base64::Engine as _;
        let key_id_hex = byos_crypto_core::outbound_key_id_hex(&fx.pk);
        let ring_json = serde_json::json!({
            "keys": [{
                "key_epoch": 1,
                "key_id": key_id_hex,
                "sk_b64": base64::engine::general_purpose::STANDARD.encode(fx.sk),
                "status": "active"
            }]
        });
        let ring_path = std::env::temp_dir().join(format!("byos_relb_perf_ring_{}.json", Uuid::new_v4()));
        std::fs::write(&ring_path, ring_json.to_string()).unwrap();
        std::env::set_var("OUTBOUND_DELIVERY_SK_RING_FILE", &ring_path);
        std::env::set_var("INTERNAL_API_KEY", "test-internal-api-key-perf");

        let dkim_kp = DkimKeypair::generate("sel1").unwrap();
        let dkim_enc = encrypt_dkim_private_key(&fx.dkim_dek, &dkim_kp.private_key_pem).unwrap();
        fx.admin
            .execute(
                "UPDATE domains SET dkim_private_key_enc = $1 WHERE id = $2",
                &[&dkim_enc, &fx.domain_id],
            )
            .await
            .unwrap();

        // 1. Interrupted TCP stream on /blob (budget=1) -> Retryable (no SMTP send), then retry delivers cleanly
        let att_store: Arc<std::sync::Mutex<std::collections::HashMap<Uuid, Vec<MockV2AttachmentObj>>>> =
            Arc::new(std::sync::Mutex::new(std::collections::HashMap::new()));
        let interrupt_budget = Arc::new(std::sync::atomic::AtomicUsize::new(1));

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let api_addr = listener.local_addr().unwrap().to_string();
        let store_c = att_store.clone();
        let budget_c = interrupt_budget.clone();
        let api_h = tokio::spawn(async move {
            use tokio::io::{AsyncReadExt, AsyncWriteExt};
            loop {
                let Ok((mut sock, _)) = listener.accept().await else {
                    break;
                };
                let store = store_c.clone();
                let budget = budget_c.clone();
                tokio::spawn(async move {
                    let mut buf = vec![0u8; 65536];
                    let n = sock.read(&mut buf).await.unwrap_or(0);
                    if n == 0 {
                        return;
                    }
                    let req_str = String::from_utf8_lossy(&buf[..n]);
                    let path = req_str.lines().next().and_then(|l| l.split_whitespace().nth(1)).unwrap_or("");
                    let trimmed = path.trim_start_matches("/v1/internal/outbound/");
                    let parts: Vec<&str> = trimmed.split('/').collect();
                    let Some(delivery_id) = parts.first().and_then(|s| Uuid::parse_str(s).ok()) else {
                        let _ = sock.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;
                        return;
                    };
                    let items = store.lock().unwrap().get(&delivery_id).cloned().unwrap_or_default();
                    if parts.len() == 2 && parts[1] == "attachments" {
                        let mut manifest_items = Vec::new();
                        for it in &items {
                            manifest_items.push(serde_json::json!({
                                "attachment_id": it.attachment_id.to_string(),
                                "position": it.position,
                                "disposition": it.disposition,
                                "content_id": it.content_id,
                                "filename": it.filename,
                                "content_type": it.content_type,
                                "crypto_version": 2,
                                "blob_aad_version": 2,
                                "plaintext_size_bytes": it.plaintext.len(),
                                "ciphertext_size_bytes": it.ciphertext.len(),
                                "plaintext_sha256_hex": it.plaintext_sha256_hex,
                                "ciphertext_sha256_hex": it.ciphertext_sha256_hex,
                                "wrap_alg": "HPKE-X25519-AES256GCM-v1",
                                "outbound_key_id": it.outbound_key_id,
                                "outbound_key_epoch": it.outbound_key_epoch,
                                "cek_outbound_wrapped_b64": it.cek_outbound_wrapped_b64,
                                "metadata_sha256_hex": it.metadata_sha256_hex,
                            }));
                        }
                        let body = serde_json::json!({
                            "delivery_id": delivery_id.to_string(),
                            "mailbox_id": items.first().map(|i| i.mailbox_id.to_string()).unwrap_or_default(),
                            "outbox_seq": items.first().map(|i| i.outbox_seq).unwrap_or(0),
                            "attachment_count": items.len(),
                            "attachments": manifest_items,
                        })
                        .to_string();
                        let resp = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                            body.len(),
                            body
                        );
                        let _ = sock.write_all(resp.as_bytes()).await;
                    } else if parts.len() == 4 && parts[1] == "attachments" && parts[3] == "blob" {
                        let att_uuid = Uuid::parse_str(parts[2]).ok();
                        let Some(it) = att_uuid.and_then(|aid| items.into_iter().find(|i| i.attachment_id == aid)) else {
                            let _ = sock.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;
                            return;
                        };
                        let hdr = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                            it.ciphertext.len()
                        );
                        let _ = sock.write_all(hdr.as_bytes()).await;
                        if budget
                            .fetch_update(
                                std::sync::atomic::Ordering::SeqCst,
                                std::sync::atomic::Ordering::SeqCst,
                                |cur| if cur > 0 { Some(cur - 1) } else { None },
                            )
                            .is_ok()
                        {
                            // Abrupt mid-body TCP drop after writing 64 bytes of ciphertext
                            let _ = sock.write_all(&it.ciphertext[..64.min(it.ciphertext.len())]).await;
                            let _ = sock.flush().await;
                            drop(sock);
                            return;
                        }
                        let _ = sock.write_all(&it.ciphertext).await;
                    }
                });
            }
        });

        let (smtp_addr, captured_smtp, smtp_h) = spawn_capture_smtp_multi().await;
        let lcfg = test_lease_config("worker-relb-perf", Duration::from_secs(60), 10);

        fx.seq_counter += 1;
        let seq_int = fx.seq_counter as i64;
        let mut mailbox_bytes = [0u8; 16];
        mailbox_bytes.copy_from_slice(fx.mailbox_id.as_bytes());
        let raw_mime_int = format!(
            "From: sender@{}\r\nTo: interrupt@external.test\r\nSubject: Interrupted Test\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nBody\r\n",
            fx.domain_name
        );
        let (em_i, wr_i, iv_i, _, _) =
            encrypt_outbound(&fx.pk, &mailbox_bytes, seq_int as u64, raw_mime_int.as_bytes()).unwrap();
        let res_i = Uuid::new_v4();
        let did_i = Uuid::new_v4();
        let int_payload = vec![0x77u8; 2048];
        let obj_int = build_mock_v2_obj(fx.mailbox_id, seq_int as u64, &fx.pk, 1, 0, "interrupted.bin", "application/octet-stream", &int_payload);
        att_store.lock().unwrap().insert(did_i, vec![obj_int]);
        fx.admin.execute("INSERT INTO outbound_reservations (reservation_id, user_id, mailbox_id, outbox_seq, encryption_version, aad_version, status, delivery_id) VALUES ($1,$2,$3,$4,1,1,'consumed',$5)", &[&res_i, &fx.user_id, &fx.mailbox_id, &seq_int, &did_i]).await.unwrap();
        let qid_i: Uuid = fx.admin.query_one("INSERT INTO outbound_queue (delivery_id, mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped, outbox_seq, encryption_version, aad_version, encryption_iv, reservation_id, status, max_attempts, next_attempt_at, expires_at, attachment_count, send_token_key_epoch, send_token_key_id) VALUES ($1,$2,$3,$4,$5,$6,$7,1,1,$8,$9,'pending',5,now(),now()+interval '1 hour',1,1,$10) RETURNING id", &[&did_i, &fx.mailbox_id, &fx.domain_id, &"interrupt@external.test", &em_i, &wr_i, &seq_int, &iv_i.as_slice(), &res_i, &key_id_hex]).await.unwrap().get(0);

        poll_once_with_config(&mut worker, &fx.sk, &fx.dkim_dek, &smtp_addr, &api_addr, None, &lcfg).await.unwrap();
        let st_i = fx.admin.query_one("SELECT status, attempts FROM outbound_queue WHERE id=$1", &[&qid_i]).await.unwrap();
        assert_eq!(st_i.get::<_, String>(0), "pending", "interrupted retrieval must stay pending for retry");
        assert_eq!(st_i.get::<_, i32>(1), 1);
        assert!(captured_smtp.lock().unwrap().is_empty(), "interrupted retrieval must never invoke SMTP");

        fx.admin.execute("UPDATE outbound_queue SET next_attempt_at = now() - interval '1 second' WHERE id=$1", &[&qid_i]).await.unwrap();
        poll_once_with_config(&mut worker, &fx.sk, &fx.dkim_dek, &smtp_addr, &api_addr, None, &lcfg).await.unwrap();
        assert_eq!(fx.admin.query_one("SELECT status FROM outbound_queue WHERE id=$1", &[&qid_i]).await.unwrap().get::<_, String>(0), "delivered");
        let cap_i = captured_smtp.lock().unwrap().remove(0);
        let parsed_i = mailparse::parse_mail(&cap_i.1).unwrap();
        assert_eq!(parsed_i.subparts.len(), 2);
        assert_eq!(parsed_i.subparts[1].get_body_raw().unwrap(), int_payload);

        // 2. Realistic multi-attachment performance & resource benchmark (8 MiB PDF + 6 MiB PNG + 4 MiB DOCX + 4 MiB BIN = 22 MiB)
        fx.seq_counter += 1;
        let seq_p = fx.seq_counter as i64;
        let pdf_big = vec![0x25u8; 8 * 1024 * 1024];
        let png_big = vec![0x89u8; 6 * 1024 * 1024];
        let docx_big = vec![0x50u8; 4 * 1024 * 1024];
        let bin_big = vec![0x1Au8; 4 * 1024 * 1024];
        let did_p = Uuid::new_v4();
        let objs_p = vec![
            build_mock_v2_obj(fx.mailbox_id, seq_p as u64, &fx.pk, 1, 0, "annual-report.pdf", "application/pdf", &pdf_big),
            build_mock_v2_obj(fx.mailbox_id, seq_p as u64, &fx.pk, 1, 1, "architecture.png", "image/png", &png_big),
            build_mock_v2_obj(fx.mailbox_id, seq_p as u64, &fx.pk, 1, 2, "financials.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", &docx_big),
            build_mock_v2_obj(fx.mailbox_id, seq_p as u64, &fx.pk, 1, 3, "dataset.bin", "application/octet-stream", &bin_big),
        ];
        att_store.lock().unwrap().insert(did_p, objs_p);

        let keyring = OutboundKeyring::from_single_sk(&fx.sk, 1).unwrap();
        let http = http_client();
        let raw_body_p = format!(
            "From: sender@{}\r\nTo: perf@external.test\r\nSubject: Perf Multi-Attachment\r\nMIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary=\"alt-perf\"\r\n\r\n--alt-perf\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nPlain body\r\n--alt-perf\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>HTML body</p>\r\n--alt-perf--\r\n",
            fx.domain_name
        );

        let t_total = Instant::now();
        let (decrypted_p, fetch_metrics) = fetch_and_decrypt_attachments_with_metrics(
            &http,
            &api_addr,
            "test-internal-api-key-perf",
            &keyring,
            did_p,
            fx.mailbox_id,
            seq_p,
            4,
            Uuid::new_v4(),
        )
        .await
        .unwrap();
        let t_mime = Instant::now();
        let assembled_p = assemble_mime_with_attachments(raw_body_p.as_bytes(), &decrypted_p).unwrap();
        let mime_ms = t_mime.elapsed().as_millis();
        drop(decrypted_p);
        let t_dkim = Instant::now();
        let signed_p = dkim_sign(&dkim_kp.private_key_pem, "sel1", &fx.domain_name, &assembled_p).unwrap();
        let dkim_ms = t_dkim.elapsed().as_millis();
        let total_construction_ms = t_total.elapsed().as_millis();
        let peak_rss_kib = attachments::read_process_peak_rss_kib();
        let final_mime_bytes = signed_p.len();

        eprintln!(
            "[REL-B PERF BENCHMARK] 22 MiB multi-attachment (4 files: 8M PDF + 6M PNG + 4M DOCX + 4M BIN): retrieval_ms={}, decryption_ms={}, mime_assembly_ms={}, dkim_sign_ms={}, total_construction_ms={}, final_mime_bytes={}, peak_rss_kib={:?}",
            fetch_metrics.retrieval_duration.as_millis(),
            fetch_metrics.decryption_duration.as_millis(),
            mime_ms,
            dkim_ms,
            total_construction_ms,
            final_mime_bytes,
            peak_rss_kib
        );

        assert!(final_mime_bytes > 22 * 1024 * 1024);
        assert!(final_mime_bytes < attachments::DEFAULT_MAX_OUTBOUND_SMTP_MESSAGE_BYTES);

        // Deliver over real async phased mock SMTP capture and verify all 4 attachments reconstruct byte-for-byte
        let env_p = crate::tests::build_test_envelope(&["perf@external.test"]);
        let outcome_p = deliver_raw_to_smtp_phased_with_timeout(
            &smtp_addr,
            &env_p,
            &signed_p,
            Some(Duration::from_secs(60)),
            || async { Ok(true) },
            || async { Ok(true) },
            || async { Ok(true) },
        )
        .await
        .unwrap();
        assert!(matches!(outcome_p, SmtpDeliveryOutcome::Delivered { smtp_code: 250 }), "got {:?}", outcome_p);
        let cap_p = captured_smtp.lock().unwrap().remove(0);
        let parsed_p = mailparse::parse_mail(&cap_p.1).unwrap();
        assert_eq!(parsed_p.subparts.len(), 5);
        assert_eq!(parsed_p.subparts[1].get_body_raw().unwrap().len(), pdf_big.len());
        assert_eq!(parsed_p.subparts[2].get_body_raw().unwrap().len(), png_big.len());
        assert_eq!(parsed_p.subparts[3].get_body_raw().unwrap().len(), docx_big.len());
        assert_eq!(parsed_p.subparts[4].get_body_raw().unwrap().len(), bin_big.len());

        let _ = std::fs::remove_file(&ring_path);
        std::env::remove_var("OUTBOUND_DELIVERY_SK_RING_FILE");
        std::env::remove_var("INTERNAL_API_KEY");
        api_h.abort();
        smtp_h.abort();
        fx.cleanup().await;
    }
}
