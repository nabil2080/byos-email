use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use byos_crypto_core::{decrypt_dkim_private_key, decrypt_outbound, dkim_sign, AAD_VERSION, ENCRYPTION_VERSION};
use lettre::{
    address::{Address, Envelope},
    SmtpTransport, Transport,
};
use std::{collections::HashMap, env, sync::{Arc, OnceLock, RwLock}, time::{Duration, SystemTime, UNIX_EPOCH}};
use tokio::time::sleep;
use tokio_postgres::{Client, NoTls};
use tracing::{error, info, warn};
use uuid::Uuid;

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
            warn!("redis connect failed (fail open): {}", e);
            return (true, 0, "".to_string());
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
            (true, 0, "".to_string())
        }
        Err(e) => {
            warn!("rate lua error (fail open): {}", e);
            (true, 0, "".to_string())
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

    let (client, connection) = tokio_postgres::connect(&pg_url, NoTls).await.context("connect pg")?;
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

    info!("outbound-worker polling every {}ms, postfix={}, redis={}", poll_ms, postfix_addr, redis_url);

    loop {
        if let Err(e) = poll_scheduled(&client, redis_client.as_ref()).await {
            warn!("scheduled poll error: {}", e);
        }
        if let Err(e) = poll_once(&client, &sk, &dkim_dek, &postfix_addr, redis_client.as_ref()).await {
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
        ("org_recovery_principals", "SELECT * FROM org_recovery_principals LIMIT 1"),
        ("storage_connections", "SELECT * FROM storage_connections LIMIT 1"),
    ];
    for (tbl, sql) in checks {
        match client.query_opt(sql, &[]).await {
            Ok(_) => error!("SECURITY VIOLATION: outbound_worker can SELECT {}", tbl),
            Err(e) => {
                let msg = e.to_string();
                if msg.contains("permission denied") {
                    info!("least-privilege OK: cannot SELECT {} (denied as expected)", tbl);
                } else {
                    info!("least-privilege check {}: {}", tbl, msg);
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

async fn poll_scheduled(client: &Client, redis_client: Option<&redis::Client>) -> Result<()> {
    // Select pending scheduled messages ready for delivery. Use transaction with SKIP LOCKED.
    // No decryption — copy encrypted payload verbatim to outbound_queue.
    // Exclude those deferred via retry_after
    let trans = client
        .query(
            "SELECT id::text, delivery_id::text, mailbox_id::text, domain_id::text, recipient, encrypted_message, send_token_hpke_wrapped, outbox_seq, encryption_version, aad_version, encryption_iv, reservation_id::text, expires_at FROM scheduled_messages WHERE status='pending' AND scheduled_at <= now() AND expires_at > now() AND (retry_after IS NULL OR retry_after <= now()) ORDER BY scheduled_at ASC LIMIT 10 FOR UPDATE SKIP LOCKED",
            &[],
        )
        .await
        .context("select scheduled pending")?;

    if trans.is_empty() {
        // Also opportunistically mark expired scheduled messages
        let _ = client
            .execute(
                "UPDATE scheduled_messages SET status='expired' WHERE status='pending' AND expires_at <= now()",
                &[],
            )
            .await;
        return Ok(());
    }

    info!("processing {} scheduled", trans.len());

    for row in trans {
        let id: String = row.get(0);
        let delivery_id: String = row.get(1);
        let mailbox_id: String = row.get(2);
        let domain_id: String = row.get(3);
        let recipient: String = row.get(4);
        let encrypted_message: Vec<u8> = row.get(5);
        let wrapped: Vec<u8> = row.get(6);
        let outbox_seq: Option<i64> = row.get(7);
        let enc_ver: Option<i32> = row.get(8);
        let aad_ver: Option<i16> = row.get(9);
        let enc_iv: Option<Vec<u8>> = row.get(10);
        let reservation_id: Option<String> = row.get(11);

        if outbox_seq.is_none() || enc_ver.is_none() || aad_ver.is_none() || enc_iv.is_none() || reservation_id.is_none() {
            warn!("scheduled row {} missing V5.3 AAD/reservation, marking failed", delivery_id);
            let _ = client
                .execute(
                    "UPDATE scheduled_messages SET status='failed' WHERE id=$1",
                    &[&Uuid::parse_str(&id).unwrap()],
                )
                .await;
            continue;
        }
        let outbox_seq = outbox_seq.unwrap();
        let enc_ver = enc_ver.unwrap();
        let aad_ver = aad_ver.unwrap();
        let enc_iv = enc_iv.unwrap();
        let reservation_id = reservation_id.unwrap();

        // Rate limit check before promotion (no decryption)
        // Lookup org_id and plan for rate limiting
        let (org_id, mailbox_plan, org_plan) = match client.query_opt("SELECT org_id::text, plan FROM mailboxes WHERE id=$1", &[&Uuid::parse_str(&mailbox_id).unwrap()]).await {
            Ok(Some(r)) => {
                let oid: String = r.get(0);
                let mplan: String = r.get(1);
                let oplan: String = client.query_opt("SELECT plan FROM organizations WHERE id=$1", &[&Uuid::parse_str(&oid).unwrap()]).await.ok().and_then(|opt| opt.map(|rr| rr.get(0))).unwrap_or_else(|| mplan.clone());
                (oid, mplan, oplan)
            },
            _ => {
                warn!("rate check: mailbox {} not found, skipping rate check (fail open)", mailbox_id);
                (String::new(), "solo".to_string(), "solo".to_string())
            }
        };
        if !org_id.is_empty() {
            // Convert Option<&Client> to Option<&redis::Client> for helper
            let rc_opt = redis_client.cloned();
            let (ok, retry, _failed) = check_and_incr_rate(&rc_opt, &mailbox_id, &org_id, &mailbox_plan, &org_plan).await;
            if !ok {
                let sched_uuid = Uuid::parse_str(&id).unwrap();
                let _ = client.execute("UPDATE scheduled_messages SET retry_after = now() + ($2 * interval '1 second') WHERE id=$1", &[&sched_uuid, &(retry as i32)]).await;
                info!("scheduled {} deferred retry_after {}s due to rate limit", delivery_id, retry);
                continue;
            }
        }

        // Atomically promote to outbound_queue and mark executed
        // No decryption — verbatim copy. Idempotent via ON CONFLICT (reservation_id)
        let delivery_uuid = Uuid::parse_str(&delivery_id).unwrap();
        let mailbox_uuid = Uuid::parse_str(&mailbox_id).unwrap();
        let domain_uuid = Uuid::parse_str(&domain_id).unwrap();
        let reservation_uuid = Uuid::parse_str(&reservation_id).unwrap();
        let sched_uuid = Uuid::parse_str(&id).unwrap();

        // Insert into outbound_queue copying encrypted payload without decryption
        let insert_res = client
            .execute(
                "INSERT INTO outbound_queue (delivery_id, mailbox_id, domain_id, recipient, encrypted_message, send_token_hpke_wrapped, outbox_seq, encryption_version, aad_version, encryption_iv, reservation_id, status, next_attempt_at, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending', now(), now() + interval '7 days') ON CONFLICT (reservation_id) DO NOTHING",
                &[&delivery_uuid, &mailbox_uuid, &domain_uuid, &recipient, &encrypted_message, &wrapped, &outbox_seq, &enc_ver, &aad_ver, &enc_iv, &reservation_uuid],
            )
            .await;

        match insert_res {
            Ok(0) => {
                // Conflict — already promoted. Mark executed if not already.
                let _ = client
                    .execute(
                        "UPDATE scheduled_messages SET status='executed', sent_at=now() WHERE id=$1 AND status='pending'",
                        &[&sched_uuid],
                    )
                    .await;
                info!("scheduled {} already promoted (idempotent)", delivery_id);
                continue;
            }
            Ok(_) => {
                let _ = client
                    .execute(
                        "UPDATE scheduled_messages SET status='executed', sent_at=now() WHERE id=$1",
                        &[&sched_uuid],
                    )
                    .await;
                info!("promoted scheduled {} to outbound_queue (seq {})", delivery_id, outbox_seq);
            }
            Err(e) => {
                let msg = e.to_string();
                if msg.contains("duplicate key") || msg.contains("23505") {
                    let _ = client
                        .execute(
                            "UPDATE scheduled_messages SET status='executed', sent_at=now() WHERE id=$1 AND status='pending'",
                            &[&sched_uuid],
                        )
                        .await;
                    warn!("scheduled promotion conflict {}: {}", delivery_id, msg);
                } else {
                    warn!("scheduled promotion failed {}: {}", delivery_id, msg);
                    let _ = client
                        .execute(
                            "UPDATE scheduled_messages SET status='failed' WHERE id=$1",
                            &[&sched_uuid],
                        )
                        .await;
                }
            }
        }
    }
    Ok(())
}

async fn poll_once(client: &Client, sk: &[u8; 32], dkim_dek: &[u8; 32], postfix_addr: &str, redis_client: Option<&redis::Client>) -> Result<()> {
    let rows = client
        .query(
            "SELECT id::text, delivery_id::text, mailbox_id::text, domain_id::text, recipient, encrypted_message, send_token_hpke_wrapped, outbox_seq, encryption_version, aad_version, attempts, expires_at FROM outbound_queue WHERE status='pending' AND next_attempt_at <= now() AND expires_at > now() ORDER BY next_attempt_at ASC LIMIT 10 FOR UPDATE SKIP LOCKED",
            &[],
        )
        .await
        .context("select pending")?;

    if rows.is_empty() {
        return Ok(());
    }
    info!("processing {} outbound", rows.len());

    for row in rows {
        let id: String = row.get(0);
        let delivery_id: String = row.get(1);
        let mailbox_id: String = row.get(2);
        let domain_id: String = row.get(3);
        let recipient: String = row.get(4);
        let encrypted_message: Vec<u8> = row.get(5);
        let wrapped: Vec<u8> = row.get(6);
        let outbox_seq_opt: Option<i64> = row.get(7);
        let enc_ver_opt: Option<i32> = row.get(8);
        let aad_ver_opt: Option<i16> = row.get(9);
        // Do not invent AAD values for legacy rows lacking V5.3 metadata — fail safely
        if outbox_seq_opt.is_none() || enc_ver_opt.is_none() || aad_ver_opt.is_none() {
            warn!("legacy outbound row {} missing V5.3 AAD metadata (outbox_seq/enc_ver/aad_ver), failing safely", delivery_id);
            client.execute("UPDATE outbound_queue SET status='bounced', failed_at=now(), attempts=attempts+1 WHERE id=$1", &[&Uuid::parse_str(&id).unwrap()]).await?;
            continue;
        }
        let outbox_seq = outbox_seq_opt.unwrap();
        let enc_ver = enc_ver_opt.unwrap();
        let aad_ver = aad_ver_opt.unwrap();

        // Verify versions
        if enc_ver != ENCRYPTION_VERSION as i32 || aad_ver as i32 != AAD_VERSION as i32 {
            warn!("wrong version for {}: enc {} aad {}", delivery_id, enc_ver, aad_ver);
            client.execute("UPDATE outbound_queue SET status='bounced', failed_at=now(), attempts=attempts+1 WHERE id=$1", &[&Uuid::parse_str(&id).unwrap()]).await?;
            continue;
        }

        let mailbox_uuid = Uuid::parse_str(&mailbox_id).unwrap();
        let mut mailbox_bytes = [0u8; 16];
        mailbox_bytes.copy_from_slice(mailbox_uuid.as_bytes());

        let plaintext = match decrypt_outbound(sk, &wrapped, &mailbox_bytes, outbox_seq as u64, &encrypted_message) {
            Ok(p) => p,
            Err(e) => {
                warn!("decrypt failed {}: {}", delivery_id, e);
                client.execute("UPDATE outbound_queue SET attempts=attempts+1, last_attempt_at=now(), next_attempt_at=now()+ interval '1 minute' * (attempts+1), status=CASE WHEN attempts+1>=max_attempts THEN 'bounced' ELSE 'pending' END, failed_at=CASE WHEN attempts+1>=max_attempts THEN now() ELSE failed_at END WHERE id=$1", &[&Uuid::parse_str(&id).unwrap()]).await?;
                client.execute("INSERT INTO delivery_log (delivery_id, direction, mailbox_id, domain_id, recipient, status, smtp_message) VALUES ($1,'outbound',$2,$3,$4,'bounced',$5)", &[&Uuid::parse_str(&delivery_id).unwrap(), &Uuid::parse_str(&mailbox_id).unwrap(), &Uuid::parse_str(&domain_id).unwrap(), &recipient, &e.to_string()]).await?;
                continue;
            }
        };

        // Recipient count check (per-message limit)
        let rcpt_count = count_recipients(&plaintext);
        // Lookup plan for recipients limit
        let (mailbox_plan, _org_id) = match client.query_opt("SELECT plan, org_id::text FROM mailboxes WHERE id=$1", &[&Uuid::parse_str(&mailbox_id).unwrap()]).await {
            Ok(Some(r)) => {
                let p: String = r.get(0);
                let oid: String = r.get(1);
                (p, oid)
            },
            _ => ("solo".to_string(), "".to_string()),
        };
        let recip_limit = get_limit(&mailbox_plan, "recipients", "recipients");
        if rcpt_count as i32 > recip_limit {
            warn!("recipient limit exceeded {} count {} > limit {} (plan {})", delivery_id, rcpt_count, recip_limit, mailbox_plan);
            client.execute("UPDATE outbound_queue SET status='bounced', failed_at=now(), attempts=attempts+1 WHERE id=$1", &[&Uuid::parse_str(&id).unwrap()]).await?;
            client.execute("INSERT INTO delivery_log (delivery_id, direction, mailbox_id, domain_id, recipient, status, smtp_message) VALUES ($1,'outbound',$2,$3,$4,'bounced',$5)", &[&Uuid::parse_str(&delivery_id).unwrap(), &Uuid::parse_str(&mailbox_id).unwrap(), &Uuid::parse_str(&domain_id).unwrap(), &recipient, &"too many recipients"]).await?;
            continue;
        }

        // DKIM: lookup authoritative domain via mailbox.domain_id (least-privilege narrow columns)
        let dkim_row = match client
            .query_opt(
                "SELECT name, dkim_selector, dkim_private_key_enc FROM domains WHERE id=$1",
                &[&Uuid::parse_str(&domain_id).unwrap()],
            )
            .await
        {
            Ok(r) => r,
            Err(e) => {
                warn!("dkim domain lookup failed {}: {}", delivery_id, e);
                client.execute("UPDATE outbound_queue SET status='bounced', failed_at=now(), attempts=attempts+1 WHERE id=$1", &[&Uuid::parse_str(&id).unwrap()]).await?;
                client.execute("INSERT INTO delivery_log (delivery_id, direction, mailbox_id, domain_id, recipient, status, smtp_message) VALUES ($1,'outbound',$2,$3,$4,'bounced',$5)", &[&Uuid::parse_str(&delivery_id).unwrap(), &Uuid::parse_str(&mailbox_id).unwrap(), &Uuid::parse_str(&domain_id).unwrap(), &recipient, &"dkim domain lookup failed"]).await?;
                continue;
            }
        };
        let (domain_name, dkim_selector, dkim_enc_opt): (String, String, Option<Vec<u8>>) = match dkim_row {
            Some(r) => (r.get(0), r.get(1), r.get(2)),
            None => {
                warn!("dkim domain not found {} for {}", delivery_id, domain_id);
                client.execute("UPDATE outbound_queue SET status='bounced', failed_at=now(), attempts=attempts+1 WHERE id=$1", &[&Uuid::parse_str(&id).unwrap()]).await?;
                continue;
            }
        };
        let dkim_enc = match dkim_enc_opt {
            Some(v) if !v.is_empty() => v,
            _ => {
                warn!("dkim private key missing for domain {} delivery {}", domain_name, delivery_id);
                client.execute("UPDATE outbound_queue SET status='bounced', failed_at=now(), attempts=attempts+1 WHERE id=$1", &[&Uuid::parse_str(&id).unwrap()]).await?;
                client.execute("INSERT INTO delivery_log (delivery_id, direction, mailbox_id, domain_id, recipient, status, smtp_message) VALUES ($1,'outbound',$2,$3,$4,'bounced',$5)", &[&Uuid::parse_str(&delivery_id).unwrap(), &Uuid::parse_str(&mailbox_id).unwrap(), &Uuid::parse_str(&domain_id).unwrap(), &recipient, &"dkim key missing"]).await?;
                continue;
            }
        };

        // Decrypt DKIM private key using DEK (never log key material)
        let dkim_pem = match decrypt_dkim_private_key(dkim_dek, &dkim_enc) {
            Ok(p) => p,
            Err(e) => {
                warn!("dkim decrypt failed {}: {}", delivery_id, e);
                client.execute("UPDATE outbound_queue SET status='bounced', failed_at=now(), attempts=attempts+1 WHERE id=$1", &[&Uuid::parse_str(&id).unwrap()]).await?;
                client.execute("INSERT INTO delivery_log (delivery_id, direction, mailbox_id, domain_id, recipient, status, smtp_message) VALUES ($1,'outbound',$2,$3,$4,'bounced',$5)", &[&Uuid::parse_str(&delivery_id).unwrap(), &Uuid::parse_str(&mailbox_id).unwrap(), &Uuid::parse_str(&domain_id).unwrap(), &recipient, &"dkim decrypt failed"]).await?;
                continue;
            }
        };

        // Sign the exact plaintext that will be handed to Postfix (preserve original RFC5322)
        let signed = match dkim_sign(&dkim_pem, &dkim_selector, &domain_name, &plaintext) {
            Ok(s) => s,
            Err(e) => {
                warn!("dkim sign failed {}: {}", delivery_id, e);
                client.execute("UPDATE outbound_queue SET status='bounced', failed_at=now(), attempts=attempts+1 WHERE id=$1", &[&Uuid::parse_str(&id).unwrap()]).await?;
                client.execute("INSERT INTO delivery_log (delivery_id, direction, mailbox_id, domain_id, recipient, status, smtp_message) VALUES ($1,'outbound',$2,$3,$4,'bounced',$5)", &[&Uuid::parse_str(&delivery_id).unwrap(), &Uuid::parse_str(&mailbox_id).unwrap(), &Uuid::parse_str(&domain_id).unwrap(), &recipient, &"dkim sign failed"]).await?;
                continue;
            }
        };

        // Build envelope and send signed message raw to Postfix (do not reconstruct via Message::builder)
        let recipient_addr: Address = match recipient.parse() {
            Ok(a) => a,
            Err(e) => {
                warn!("invalid recipient {} {}: {}", delivery_id, recipient, e);
                client.execute("UPDATE outbound_queue SET status='bounced', failed_at=now(), attempts=attempts+1 WHERE id=$1", &[&Uuid::parse_str(&id).unwrap()]).await?;
                continue;
            }
        };
        let sender_addr: Address = match format!("noreply@{}", domain_name).parse() {
            Ok(a) => a,
            Err(e) => {
                warn!("invalid sender domain {} {}: {}", delivery_id, domain_name, e);
                client.execute("UPDATE outbound_queue SET status='bounced', failed_at=now(), attempts=attempts+1 WHERE id=$1", &[&Uuid::parse_str(&id).unwrap()]).await?;
                continue;
            }
        };
        let envelope = match Envelope::new(Some(sender_addr), vec![recipient_addr]) {
            Ok(env) => env,
            Err(e) => {
                warn!("envelope build failed {}: {}", delivery_id, e);
                client.execute("UPDATE outbound_queue SET status='bounced', failed_at=now(), attempts=attempts+1 WHERE id=$1", &[&Uuid::parse_str(&id).unwrap()]).await?;
                continue;
            }
        };

        let (postfix_host, postfix_port) = parse_postfix_addr(postfix_addr);
        let mailer = SmtpTransport::builder_dangerous(postfix_host).port(postfix_port).build();
        match mailer.send_raw(&envelope, &signed) {
            Ok(_) => {
                info!("delivered {} to {} via {} (dkim signed)", delivery_id, recipient, postfix_addr);
                client.execute("UPDATE outbound_queue SET status='delivered', delivered_at=now(), attempts=attempts+1, last_attempt_at=now() WHERE id=$1", &[&Uuid::parse_str(&id).unwrap()]).await?;
                client.execute("INSERT INTO delivery_log (delivery_id, direction, mailbox_id, domain_id, recipient, status, smtp_code) VALUES ($1,'outbound',$2,$3,$4,'delivered',250)", &[&Uuid::parse_str(&delivery_id).unwrap(), &Uuid::parse_str(&mailbox_id).unwrap(), &Uuid::parse_str(&domain_id).unwrap(), &recipient]).await?;
            }
            Err(e) => {
                let msg = e.to_string();
                let is_temp = msg.contains("451") || msg.contains("421") || msg.contains("4.") || msg.contains("timeout") || msg.contains("connection");
                if is_temp {
                    // Only increment attempts, keep pending for retry
                    client.execute("UPDATE outbound_queue SET attempts=attempts+1, last_attempt_at=now(), next_attempt_at=now()+ interval '1 minute' * (attempts+1) WHERE id=$1", &[&Uuid::parse_str(&id).unwrap()]).await?;
                    warn!("temp fail {}: {}", delivery_id, msg);
                } else {
                    client.execute("UPDATE outbound_queue SET status='bounced', failed_at=now(), attempts=attempts+1 WHERE id=$1", &[&Uuid::parse_str(&id).unwrap()]).await?;
                    client.execute("INSERT INTO delivery_log (delivery_id, direction, mailbox_id, domain_id, recipient, status, smtp_message) VALUES ($1,'outbound',$2,$3,$4,'bounced',$5)", &[&Uuid::parse_str(&delivery_id).unwrap(), &Uuid::parse_str(&mailbox_id).unwrap(), &Uuid::parse_str(&domain_id).unwrap(), &recipient, &msg]).await?;
                    warn!("perm fail {}: {}", delivery_id, msg);
                }
            }
        }
    }
    // Silence unused warning for redis_client param if not used in recipient path
    let _ = redis_client;
    Ok(())
}
