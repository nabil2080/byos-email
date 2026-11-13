use std::collections::{BTreeMap, HashSet};
use std::env;
use std::fmt::Write as _;
use std::time::{Duration, Instant};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use byos_crypto_core::{
    attachment_blob_aad_v2, attachment_metadata_sha256_v2, attachment_outbound_wrap_aad_v2,
    decrypt_attachment_blob_v2, hex, outbound_key_id, outbound_key_id_hex, sha256_digest,
    unwrap_cek_outbound_v2, OutboundDeliveryKeypair, Zeroizing,
    ATTACHMENT_AAD_VERSION_V2, ATTACHMENT_CRYPTO_VERSION_V2, ATTACHMENT_DISPOSITION_ATTACHMENT,
    ATTACHMENT_DISPOSITION_INLINE,
};
use serde::Deserialize;
use uuid::Uuid;

pub const MAX_OUTBOUND_PATH_B_PLAINTEXT_BYTES: u64 = 25 * 1024 * 1024; // 25 MiB
pub const MAX_OUTBOUND_ATTACHMENT_COUNT: usize = 100;
pub const AES_GCM_OVERHEAD_BYTES: u64 = 29;
pub const DEFAULT_MAX_OUTBOUND_SMTP_MESSAGE_BYTES: usize = 45_000_000; // < 50 MiB Postfix message_size_limit

pub fn max_outbound_smtp_message_bytes() -> usize {
    env::var("OUTBOUND_MAX_MIME_BYTES")
        .ok()
        .and_then(|v| v.trim().parse::<usize>().ok())
        .filter(|&n| n > 0)
        .unwrap_or(DEFAULT_MAX_OUTBOUND_SMTP_MESSAGE_BYTES)
}

pub fn internal_api_blob_timeout() -> Duration {
    let secs = env::var("OUTBOUND_INTERNAL_API_TIMEOUT_SECS")
        .ok()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .filter(|&s| s >= 120)
        .unwrap_or(180);
    Duration::from_secs(secs)
}

#[derive(Debug, Clone)]
pub struct OutboundKeyEntry {
    #[allow(dead_code)]
    pub key_epoch: u32,
    #[allow(dead_code)]
    pub key_id: String,
    pub status: String,
    sk: Zeroizing<[u8; 32]>,
}

#[derive(Debug, Clone)]
pub struct OutboundKeyring {
    entries: BTreeMap<(u32, String), OutboundKeyEntry>,
}

#[derive(Deserialize)]
struct RawKeyringFile {
    keys: Vec<RawKeyringItem>,
}

#[derive(Deserialize)]
struct RawKeyringItem {
    key_epoch: u32,
    key_id: String,
    sk_b64: String,
    status: String,
}

impl OutboundKeyring {
    pub fn from_single_sk(sk: &[u8; 32], key_epoch: u32) -> anyhow::Result<Self> {
        let kp = OutboundDeliveryKeypair::from_private_key(*sk)
            .map_err(|e| anyhow::anyhow!("invalid outbound delivery secret key: {}", e))?;
        let key_id = outbound_key_id_hex(&kp.public_key);
        let mut entries = BTreeMap::new();
        entries.insert(
            (key_epoch, key_id.clone()),
            OutboundKeyEntry {
                key_epoch,
                key_id,
                status: "active".to_string(),
                sk: Zeroizing::new(*sk),
            },
        );
        Ok(Self { entries })
    }

    pub fn load_with_fallback(fallback_sk: &[u8; 32]) -> anyhow::Result<Self> {
        let ring_path = env::var("OUTBOUND_DELIVERY_SK_RING_FILE")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .or_else(|| {
                let p = "/run/secrets/outbound_delivery_keyring.json";
                if std::path::Path::new(p).exists() {
                    Some(p.to_string())
                } else {
                    None
                }
            });

        if let Some(path) = ring_path {
            let raw = std::fs::read_to_string(&path)
                .map_err(|e| anyhow::anyhow!("read keyring {}: {}", path, e))?;
            return Self::from_json_str(&raw);
        }

        Self::from_single_sk(fallback_sk, 1)
    }

    pub fn from_json_str(raw: &str) -> anyhow::Result<Self> {
        let parsed: RawKeyringFile = serde_json::from_str(raw)
            .map_err(|e| anyhow::anyhow!("parse outbound keyring JSON: {}", e))?;
        let mut entries = BTreeMap::new();
        for item in parsed.keys {
            let status = item.status.trim().to_ascii_lowercase();
            if status == "retired" || status == "pending" {
                continue;
            }
            if status != "active" && status != "decrypt_only" {
                anyhow::bail!("unsupported keyring status: {}", item.status);
            }
            let sk_bytes = BASE64
                .decode(item.sk_b64.trim())
                .map_err(|_| anyhow::anyhow!("invalid base64 secret key in keyring"))?;
            if sk_bytes.len() != 32 {
                anyhow::bail!("keyring secret key must be 32 bytes");
            }
            let mut sk = Zeroizing::new([0u8; 32]);
            sk.copy_from_slice(&sk_bytes);
            let kp = OutboundDeliveryKeypair::from_private_key(*sk)
                .map_err(|_| anyhow::anyhow!("invalid X25519 key in keyring"))?;
            let derived_id = outbound_key_id_hex(&kp.public_key);
            if derived_id != item.key_id.trim().to_ascii_lowercase() {
                anyhow::bail!(
                    "keyring key_id mismatch for epoch {}: expected {}",
                    item.key_epoch,
                    derived_id
                );
            }
            entries.insert(
                (item.key_epoch, derived_id.clone()),
                OutboundKeyEntry {
                    key_epoch: item.key_epoch,
                    key_id: derived_id,
                    status,
                    sk,
                },
            );
        }
        if entries.is_empty() {
            anyhow::bail!("outbound keyring contains no usable active/decrypt_only keys");
        }
        Ok(Self { entries })
    }

    pub fn get_sk(&self, key_epoch: u32, key_id: &str) -> Option<&[u8; 32]> {
        let norm_id = key_id.trim().to_ascii_lowercase();
        self.entries
            .get(&(key_epoch, norm_id))
            .map(|entry| &*entry.sk)
    }

    pub fn max_epoch(&self) -> u32 {
        self.entries
            .keys()
            .map(|(epoch, _)| *epoch)
            .max()
            .unwrap_or(0)
    }

    pub fn select_send_token_sk(&self, key_epoch: Option<u32>, key_id: Option<&str>) -> Option<&[u8; 32]> {
        if let (Some(epoch), Some(kid)) = (key_epoch, key_id) {
            if let Some(sk) = self.get_sk(epoch, kid) {
                return Some(sk);
            }
        }
        if let Some(epoch) = key_epoch {
            if let Some((_, entry)) = self.entries.iter().find(|((e, _), _)| *e == epoch) {
                return Some(&*entry.sk);
            }
        }
        self.entries
            .values()
            .find(|e| e.status == "active")
            .or_else(|| self.entries.values().next())
            .map(|e| &*e.sk)
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct AttachmentManifestItem {
    pub attachment_id: String,
    pub position: usize,
    pub disposition: String,
    #[serde(default)]
    pub content_id: String,
    pub filename: String,
    pub content_type: String,
    pub crypto_version: u32,
    pub blob_aad_version: u8,
    pub plaintext_size_bytes: u64,
    pub ciphertext_size_bytes: u64,
    pub plaintext_sha256_hex: String,
    pub ciphertext_sha256_hex: String,
    pub wrap_alg: String,
    pub outbound_key_id: String,
    pub outbound_key_epoch: u32,
    pub cek_outbound_wrapped_b64: String,
    pub metadata_sha256_hex: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AttachmentManifestResponse {
    pub delivery_id: String,
    pub mailbox_id: String,
    pub outbox_seq: i64,
    pub attachment_count: usize,
    pub attachments: Vec<AttachmentManifestItem>,
}

pub struct DecryptedMimeAttachment {
    pub filename: String,
    pub content_type: String,
    pub disposition: String,
    pub content_id: String,
    pub encoded_base64: Zeroizing<String>,
}

impl DecryptedMimeAttachment {
    /// Immediately encodes plaintext into 76-col CRLF Base64 and drops/zeroizes the raw plaintext buffer.
    pub fn from_plaintext(
        filename: String,
        content_type: String,
        disposition: String,
        content_id: String,
        plaintext: Zeroizing<Vec<u8>>,
    ) -> Self {
        let encoded_base64 = Zeroizing::new(encode_base64_76_crlf(&plaintext));
        drop(plaintext);
        Self {
            filename,
            content_type,
            disposition,
            content_id,
            encoded_base64,
        }
    }
}

#[derive(Debug)]
pub enum AttachmentFetchError {
    LeaseLost(String),
    Retryable(String),
    Permanent(String),
}

#[derive(Debug, Default, Clone, Copy)]
pub struct AttachmentFetchMetrics {
    pub retrieval_duration: Duration,
    pub decryption_duration: Duration,
}

#[allow(dead_code)]
pub fn read_process_peak_rss_kib() -> Option<u64> {
    let status = std::fs::read_to_string("/proc/self/status").ok()?;
    for line in status.lines() {
        if let Some(rest) = line.strip_prefix("VmHWM:") {
            let num_str = rest.split_whitespace().next()?;
            return num_str.parse::<u64>().ok();
        }
    }
    None
}

pub async fn fetch_and_decrypt_attachments(
    http: &reqwest::Client,
    api_addr: &str,
    internal_key: &str,
    keyring: &OutboundKeyring,
    delivery_id: Uuid,
    mailbox_id: Uuid,
    outbox_seq: i64,
    expected_count: usize,
    lease_token: Uuid,
) -> Result<Vec<DecryptedMimeAttachment>, AttachmentFetchError> {
    let (atts, _metrics) = fetch_and_decrypt_attachments_with_metrics(
        http,
        api_addr,
        internal_key,
        keyring,
        delivery_id,
        mailbox_id,
        outbox_seq,
        expected_count,
        lease_token,
    )
    .await?;
    Ok(atts)
}

#[allow(clippy::too_many_arguments)]
pub async fn fetch_and_decrypt_attachments_with_metrics(
    http: &reqwest::Client,
    api_addr: &str,
    internal_key: &str,
    keyring: &OutboundKeyring,
    delivery_id: Uuid,
    mailbox_id: Uuid,
    outbox_seq: i64,
    expected_count: usize,
    lease_token: Uuid,
) -> Result<(Vec<DecryptedMimeAttachment>, AttachmentFetchMetrics), AttachmentFetchError> {
    let mut metrics = AttachmentFetchMetrics::default();
    if expected_count == 0 {
        return Ok((Vec::new(), metrics));
    }
    if expected_count > MAX_OUTBOUND_ATTACHMENT_COUNT {
        return Err(AttachmentFetchError::Permanent(format!(
            "attachment_count {} exceeds limit {}",
            expected_count, MAX_OUTBOUND_ATTACHMENT_COUNT
        )));
    }
    if outbox_seq < 0 {
        return Err(AttachmentFetchError::Permanent(format!(
            "invalid negative outbox_seq {}",
            outbox_seq
        )));
    }

    let manifest_url = format_internal_url(
        api_addr,
        &format!("v1/internal/outbound/{}/attachments", delivery_id),
    );
    let lease_hdr = lease_token.to_string();

    let manifest_t0 = Instant::now();
    let resp = http
        .get(&manifest_url)
        .header("X-Internal-Key", internal_key)
        .header("X-Lease-Token", &lease_hdr)
        .timeout(internal_api_blob_timeout())
        .send()
        .await
        .map_err(|e| AttachmentFetchError::Retryable(format!("manifest request error: {}", e)))?;

    let status = resp.status();
    if status == reqwest::StatusCode::CONFLICT || status == reqwest::StatusCode::GONE {
        return Err(AttachmentFetchError::LeaseLost(format!(
            "manifest lease rejected with HTTP {}",
            status
        )));
    }
    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        return Err(AttachmentFetchError::Retryable(format!(
            "manifest auth rejected with HTTP {} (retryable)",
            status
        )));
    }
    if status == reqwest::StatusCode::NOT_FOUND
        || status == reqwest::StatusCode::UNPROCESSABLE_ENTITY
        || status == reqwest::StatusCode::BAD_REQUEST
    {
        return Err(AttachmentFetchError::Permanent(format!(
            "manifest rejected with HTTP {}",
            status
        )));
    }
    if !status.is_success() {
        return Err(AttachmentFetchError::Retryable(format!(
            "manifest temporary HTTP {}",
            status
        )));
    }

    let mut manifest: AttachmentManifestResponse = resp
        .json()
        .await
        .map_err(|e| AttachmentFetchError::Retryable(format!("manifest JSON decode error: {}", e)))?;
    metrics.retrieval_duration += manifest_t0.elapsed();

    if manifest.delivery_id != delivery_id.to_string()
        || manifest.mailbox_id != mailbox_id.to_string()
        || manifest.outbox_seq != outbox_seq
    {
        return Err(AttachmentFetchError::Permanent(
            "manifest identity mismatch against claimed queue row".to_string(),
        ));
    }
    if manifest.attachment_count != expected_count || manifest.attachments.len() != expected_count {
        return Err(AttachmentFetchError::Permanent(format!(
            "manifest incomplete: expected {} attachments, got count={} items={}",
            expected_count,
            manifest.attachment_count,
            manifest.attachments.len()
        )));
    }

    manifest.attachments.sort_by_key(|a| a.position);
    let mut seen_ids = HashSet::with_capacity(manifest.attachments.len());
    let mut total_plaintext_bytes: u64 = 0;
    for (idx, item) in manifest.attachments.iter().enumerate() {
        if item.position != idx {
            return Err(AttachmentFetchError::Permanent(
                "manifest attachment positions must be contiguous 0..N-1".to_string(),
            ));
        }
        if !seen_ids.insert(item.attachment_id.clone()) {
            return Err(AttachmentFetchError::Permanent(
                "duplicate attachment_id in manifest".to_string(),
            ));
        }
        if item.crypto_version != ATTACHMENT_CRYPTO_VERSION_V2
            || item.blob_aad_version != ATTACHMENT_AAD_VERSION_V2
            || item.wrap_alg != "HPKE-X25519-AES256GCM-v1"
        {
            return Err(AttachmentFetchError::Permanent(
                "attachment crypto version/algorithm invariant violated".to_string(),
            ));
        }
        if item.ciphertext_size_bytes != item.plaintext_size_bytes.saturating_add(AES_GCM_OVERHEAD_BYTES) {
            return Err(AttachmentFetchError::Permanent(
                "attachment ciphertext_size_bytes != plaintext_size_bytes + 29".to_string(),
            ));
        }
        total_plaintext_bytes = total_plaintext_bytes
            .checked_add(item.plaintext_size_bytes)
            .ok_or_else(|| AttachmentFetchError::Permanent("attachment size overflow".to_string()))?;
    }
    if total_plaintext_bytes > MAX_OUTBOUND_PATH_B_PLAINTEXT_BYTES {
        return Err(AttachmentFetchError::Permanent(format!(
            "aggregate attachment plaintext {} bytes exceeds 25 MiB Path B limit",
            total_plaintext_bytes
        )));
    }
    let max_mime_bytes = max_outbound_smtp_message_bytes();
    let approx_b64_bytes = ((total_plaintext_bytes.saturating_add(2)) / 3) * 4;
    if approx_b64_bytes > max_mime_bytes as u64 {
        return Err(AttachmentFetchError::Permanent(format!(
            "estimated attachment Base64 size {} bytes exceeds configured SMTP limit {} bytes",
            approx_b64_bytes, max_mime_bytes
        )));
    }

    let mailbox_uuid_bytes = *mailbox_id.as_bytes();
    let mut encoded_list = Vec::with_capacity(manifest.attachments.len());

    // Fetch and decrypt sequentially (concurrency = 1) to tightly bound memory usage,
    // immediately Base64-encoding and zeroizing raw plaintext before the next attachment.
    for item in manifest.attachments {
        let att_uuid = Uuid::parse_str(&item.attachment_id)
            .map_err(|_| AttachmentFetchError::Permanent("invalid attachment_id UUID".to_string()))?;
        let pt_sha_vec = hex::decode(item.plaintext_sha256_hex.trim())
            .map_err(|_| AttachmentFetchError::Permanent("invalid plaintext_sha256_hex".to_string()))?;
        let ct_sha_vec = hex::decode(item.ciphertext_sha256_hex.trim())
            .map_err(|_| AttachmentFetchError::Permanent("invalid ciphertext_sha256_hex".to_string()))?;
        let meta_sha_vec = hex::decode(item.metadata_sha256_hex.trim())
            .map_err(|_| AttachmentFetchError::Permanent("invalid metadata_sha256_hex".to_string()))?;
        let key_id_vec = hex::decode(item.outbound_key_id.trim())
            .map_err(|_| AttachmentFetchError::Permanent("invalid outbound_key_id hex".to_string()))?;

        if pt_sha_vec.len() != 32 || ct_sha_vec.len() != 32 || meta_sha_vec.len() != 32 || key_id_vec.len() != 8 {
            return Err(AttachmentFetchError::Permanent("invalid manifest digest/key length".to_string()));
        }
        let pt_sha: [u8; 32] = pt_sha_vec.try_into().unwrap();
        let ct_sha: [u8; 32] = ct_sha_vec.try_into().unwrap();
        let meta_sha: [u8; 32] = meta_sha_vec.try_into().unwrap();
        let key_id_8: [u8; 8] = key_id_vec.try_into().unwrap();

        let disp_norm = item.disposition.trim().to_ascii_lowercase();
        let disp_tag = match disp_norm.as_str() {
            "attachment" => ATTACHMENT_DISPOSITION_ATTACHMENT,
            "inline" => ATTACHMENT_DISPOSITION_INLINE,
            _ => return Err(AttachmentFetchError::Permanent("invalid attachment disposition".to_string())),
        };
        let sanitized_name = sanitize_filename_ascii_safe(&item.filename);
        let mime_type = normalize_mime_type(&item.content_type);
        let content_id = sanitize_content_id(&item.content_id);
        if content_id != item.content_id.trim() {
            return Err(AttachmentFetchError::Permanent(
                "attachment content_id contains invalid characters".to_string(),
            ));
        }

        // Recompute metadata_sha256 locally before trusting manifest headers.
        let recomputed_meta = attachment_metadata_sha256_v2(
            &item.filename,
            &mime_type,
            item.plaintext_size_bytes,
            &pt_sha,
            disp_tag,
            &content_id,
        );
        if recomputed_meta != meta_sha {
            return Err(AttachmentFetchError::Permanent(
                "attachment metadata_sha256 verification failed".to_string(),
            ));
        }

        let wrapped_cek = BASE64
            .decode(item.cek_outbound_wrapped_b64.trim())
            .map_err(|_| AttachmentFetchError::Permanent("invalid cek_outbound_wrapped base64".to_string()))?;

        let sk = match keyring.get_sk(item.outbound_key_epoch, &item.outbound_key_id) {
            Some(sk) => sk,
            None => {
                if item.outbound_key_epoch > keyring.max_epoch() {
                    return Err(AttachmentFetchError::Retryable(format!(
                        "outbound key epoch {} newer than local keyring max epoch {} (retryable)",
                        item.outbound_key_epoch,
                        keyring.max_epoch()
                    )));
                }
                return Err(AttachmentFetchError::Permanent(format!(
                    "unknown or retired outbound key epoch {}",
                    item.outbound_key_epoch
                )));
            }
        };
        // Verify sk matches key_id
        let kp_check = OutboundDeliveryKeypair::from_private_key(*sk)
            .map_err(|_| AttachmentFetchError::Permanent("invalid keyring key".to_string()))?;
        if outbound_key_id(&kp_check.public_key) != key_id_8 {
            return Err(AttachmentFetchError::Permanent("outbound_key_id mismatch".to_string()));
        }

        let dec_t0 = Instant::now();
        let out_aad = attachment_outbound_wrap_aad_v2(
            &mailbox_uuid_bytes,
            outbox_seq as u64,
            att_uuid.as_bytes(),
            &key_id_8,
            item.outbound_key_epoch,
            ATTACHMENT_CRYPTO_VERSION_V2 as u8,
            &meta_sha,
        );
        let cek = unwrap_cek_outbound_v2(sk, &wrapped_cek, &out_aad).map_err(|_| {
            AttachmentFetchError::Permanent("HPKE unwrap of attachment CEK failed".to_string())
        })?;
        metrics.decryption_duration += dec_t0.elapsed();

        let blob_url = format_internal_url(
            api_addr,
            &format!(
                "v1/internal/outbound/{}/attachments/{}/blob",
                delivery_id, att_uuid
            ),
        );
        let blob_t0 = Instant::now();
        let mut blob_resp = http
            .get(&blob_url)
            .header("X-Internal-Key", internal_key)
            .header("X-Lease-Token", &lease_hdr)
            .timeout(internal_api_blob_timeout())
            .send()
            .await
            .map_err(|e| AttachmentFetchError::Retryable(format!("blob request failed: {}", e)))?;

        let bstatus = blob_resp.status();
        if bstatus == reqwest::StatusCode::CONFLICT || bstatus == reqwest::StatusCode::GONE {
            return Err(AttachmentFetchError::LeaseLost(format!(
                "blob fetch lease rejected HTTP {}",
                bstatus
            )));
        }
        if bstatus == reqwest::StatusCode::UNAUTHORIZED || bstatus == reqwest::StatusCode::FORBIDDEN {
            return Err(AttachmentFetchError::Retryable(format!(
                "blob auth rejected HTTP {} (retryable)",
                bstatus
            )));
        }
        if bstatus == reqwest::StatusCode::NOT_FOUND || bstatus == reqwest::StatusCode::BAD_REQUEST {
            return Err(AttachmentFetchError::Permanent(format!(
                "blob missing or invalid HTTP {}",
                bstatus
            )));
        }
        if !bstatus.is_success() {
            return Err(AttachmentFetchError::Retryable(format!(
                "blob storage temporary HTTP {}",
                bstatus
            )));
        }

        let max_ct_len = usize::try_from(item.ciphertext_size_bytes)
            .map_err(|_| AttachmentFetchError::Permanent("ciphertext size overflow".to_string()))?;
        let mut ct_buf = Vec::with_capacity(max_ct_len);
        while let Some(chunk) = blob_resp
            .chunk()
            .await
            .map_err(|e| AttachmentFetchError::Retryable(format!("blob stream read error: {}", e)))?
        {
            if ct_buf.len() + chunk.len() > max_ct_len {
                return Err(AttachmentFetchError::Permanent(
                    "blob stream exceeded expected ciphertext_size_bytes".to_string(),
                ));
            }
            ct_buf.extend_from_slice(&chunk);
        }
        metrics.retrieval_duration += blob_t0.elapsed();

        if ct_buf.len() != max_ct_len {
            return Err(AttachmentFetchError::Permanent(format!(
                "incomplete attachment blob: expected {} bytes, got {}",
                max_ct_len,
                ct_buf.len()
            )));
        }

        let dec_blob_t0 = Instant::now();
        let got_ct_sha = sha256_digest(&ct_buf);
        if got_ct_sha != ct_sha {
            return Err(AttachmentFetchError::Permanent(
                "ciphertext_sha256 verification failed".to_string(),
            ));
        }

        let blob_aad = attachment_blob_aad_v2(
            &mailbox_uuid_bytes,
            att_uuid.as_bytes(),
            ATTACHMENT_CRYPTO_VERSION_V2,
            ATTACHMENT_AAD_VERSION_V2,
        );
        let plaintext = decrypt_attachment_blob_v2(
            &cek,
            &ct_buf,
            &blob_aad,
            &pt_sha,
            item.plaintext_size_bytes,
        )
        .map_err(|_| {
            AttachmentFetchError::Permanent("attachment blob decryption/integrity failed".to_string())
        })?;
        drop(ct_buf);
        drop(cek);

        let _ = sanitized_name;
        let encoded_att = DecryptedMimeAttachment::from_plaintext(
            sanitize_filename_for_header(&item.filename),
            mime_type,
            disp_norm,
            content_id,
            plaintext,
        );
        metrics.decryption_duration += dec_blob_t0.elapsed();
        encoded_list.push(encoded_att);
    }

    Ok((encoded_list, metrics))
}

fn format_internal_url(api_addr: &str, path: &str) -> String {
    let clean = path.trim_start_matches('/');
    if api_addr.starts_with("http://") || api_addr.starts_with("https://") {
        format!("{}/{}", api_addr.trim_end_matches('/'), clean)
    } else {
        format!("http://{}/{}", api_addr.trim_end_matches('/'), clean)
    }
}

pub fn normalize_mime_type(raw: &str) -> String {
    let media = raw.split(';').next().unwrap_or("").trim().to_ascii_lowercase();
    if media.is_empty() {
        return "application/octet-stream".to_string();
    }
    let Some((top, sub)) = media.split_once('/') else {
        return "application/octet-stream".to_string();
    };
    let valid_part = |p: &str| {
        !p.is_empty()
            && p.bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'+' | b'_'))
    };
    if valid_part(top) && valid_part(sub) {
        media
    } else {
        "application/octet-stream".to_string()
    }
}

fn sanitize_header_value(raw: &str) -> String {
    raw.chars()
        .filter(|&c| c != '\r' && c != '\n' && c != '\0')
        .collect::<String>()
        .trim()
        .to_string()
}

fn sanitize_content_id(raw: &str) -> String {
    raw.chars()
        .filter(|&c| c != '\r' && c != '\n' && c != '\0' && c != '<' && c != '>')
        .collect::<String>()
        .trim()
        .to_string()
}

fn sanitize_filename_for_header(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| match c {
            '\r' | '\n' | '\0' | '/' | '\\' => '_',
            c if (c as u32) < 32 || (c as u32) == 127 => '_',
            _ => c,
        })
        .collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        "attachment.bin".to_string()
    } else {
        trimmed.to_string()
    }
}

fn sanitize_filename_ascii_safe(raw: &str) -> String {
    let base = sanitize_filename_for_header(raw);
    let mut out = String::with_capacity(base.len());
    for ch in base.chars() {
        if ch.is_ascii() && !matches!(ch, '"' | '\\' | ';') {
            out.push(ch);
        } else {
            out.push('_');
        }
    }
    if out.is_empty() {
        "attachment.bin".to_string()
    } else {
        out
    }
}

/// Percent-encodes UTF-8 filename per RFC 5987 / RFC 2231 `attr-char` rules.
pub fn rfc5987_encode_utf8(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for &b in input.as_bytes() {
        let is_attr_char = b.is_ascii_alphanumeric()
            || matches!(
                b,
                b'!' | b'#' | b'$' | b'&' | b'+' | b'-' | b'.' | b'^' | b'_' | b'`' | b'|' | b'~'
            );
        if is_attr_char {
            out.push(b as char);
        } else {
            let _ = write!(out, "%{:02X}", b);
        }
    }
    out
}

pub fn format_disposition_filename_params(filename: &str) -> String {
    let clean = sanitize_filename_for_header(filename);
    let ascii_fallback = sanitize_filename_ascii_safe(&clean);
    let needs_rfc5987 = clean != ascii_fallback || !clean.is_ascii();
    if needs_rfc5987 {
        format!(
            "filename=\"{}\"; filename*=UTF-8''{}",
            ascii_fallback,
            rfc5987_encode_utf8(&clean)
        )
    } else {
        format!("filename=\"{}\"", ascii_fallback)
    }
}

/// Encodes binary payload as RFC 2045 Base64 wrapped at 76 columns with CRLF line endings.
pub fn encode_base64_76_crlf(data: &[u8]) -> String {
    if data.is_empty() {
        return String::new();
    }
    let raw = BASE64.encode(data);
    let lines = raw.as_bytes().chunks(76);
    let mut out = String::with_capacity(raw.len() + (raw.len() / 76 + 1) * 2);
    for (idx, chunk) in lines.enumerate() {
        if idx > 0 {
            out.push_str("\r\n");
        }
        out.push_str(std::str::from_utf8(chunk).unwrap_or(""));
    }
    out
}

/// Encodes UTF-8 text using RFC 2045 Quoted-Printable with CRLF line endings (76-col soft wraps).
pub fn encode_quoted_printable_crlf(input: &[u8]) -> String {
    let mut normalized = Vec::with_capacity(input.len() + 16);
    let mut i = 0;
    while i < input.len() {
        if input[i] == b'\r' && i + 1 < input.len() && input[i + 1] == b'\n' {
            normalized.extend_from_slice(b"\r\n");
            i += 2;
        } else if input[i] == b'\n' || input[i] == b'\r' {
            normalized.extend_from_slice(b"\r\n");
            i += 1;
        } else {
            normalized.push(input[i]);
            i += 1;
        }
    }

    let mut out = String::with_capacity(normalized.len() + 32);
    let mut line_len = 0usize;
    let mut idx = 0usize;
    while idx < normalized.len() {
        if idx + 1 < normalized.len() && normalized[idx] == b'\r' && normalized[idx + 1] == b'\n' {
            out.push_str("\r\n");
            line_len = 0;
            idx += 2;
            continue;
        }
        let b = normalized[idx];
        let at_eol = idx + 1 == normalized.len()
            || (idx + 2 <= normalized.len() && normalized[idx + 1] == b'\r' && normalized[idx + 2] == b'\n');
        let needs_escape = b == b'='
            || b < 32
            || b > 126
            || ((b == b' ' || b == b'\t') && at_eol);
        let token = if needs_escape {
            format!("={:02X}", b)
        } else {
            (b as char).to_string()
        };
        if line_len + token.len() > 75 {
            out.push_str("=\r\n");
            line_len = 0;
        }
        out.push_str(&token);
        line_len += token.len();
        idx += 1;
    }
    out
}

fn normalize_to_crlf(raw: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(raw.len() + 32);
    let mut i = 0;
    while i < raw.len() {
        if raw[i] == b'\r' {
            if i + 1 < raw.len() && raw[i + 1] == b'\n' {
                out.extend_from_slice(b"\r\n");
                i += 2;
            } else {
                out.extend_from_slice(b"\r\n");
                i += 1;
            }
        } else if raw[i] == b'\n' {
            out.extend_from_slice(b"\r\n");
            i += 1;
        } else {
            out.push(raw[i]);
            i += 1;
        }
    }
    out
}

fn parse_header_blocks(header_text: &str) -> Vec<(String, String)> {
    let mut blocks: Vec<(String, String)> = Vec::new();
    for line in header_text.split("\r\n") {
        if line.is_empty() {
            continue;
        }
        if line.starts_with(' ') || line.starts_with('\t') {
            if let Some((_, val)) = blocks.last_mut() {
                val.push_str("\r\n");
                val.push_str(line);
            }
        } else if let Some((name, val)) = line.split_once(':') {
            blocks.push((name.trim().to_string(), val.trim_start().to_string()));
        }
    }
    blocks
}

fn generate_unique_boundary(prefix: &str, haystack: &[u8]) -> String {
    loop {
        let candidate = format!("=_BYOS_{}_{}", prefix, Uuid::new_v4().simple());
        if !haystack
            .windows(candidate.len())
            .any(|w| w == candidate.as_bytes())
        {
            return candidate;
        }
    }
}

/// Wraps an already BCC-stripped RFC 5322 + MIME message with zero-or-more decrypted
/// attachments into a standards-compliant `multipart/mixed` (plus `multipart/related`
/// when `disposition = "inline"` CID parts are present), preserving CRLF endings and
/// leaving top-level `Content-Type` on a single DKIM-canonicalizable line.
pub fn assemble_mime_with_attachments(
    sanitized_plaintext: &[u8],
    attachments: &[DecryptedMimeAttachment],
) -> anyhow::Result<Vec<u8>> {
    assemble_mime_with_attachments_limited(
        sanitized_plaintext,
        attachments,
        max_outbound_smtp_message_bytes(),
    )
}

pub fn assemble_mime_with_attachments_limited(
    sanitized_plaintext: &[u8],
    attachments: &[DecryptedMimeAttachment],
    max_mime_bytes: usize,
) -> anyhow::Result<Vec<u8>> {
    if attachments.is_empty() {
        if sanitized_plaintext.len() > max_mime_bytes {
            anyhow::bail!(
                "assembled MIME size {} bytes exceeds configured SMTP limit {} bytes",
                sanitized_plaintext.len(),
                max_mime_bytes
            );
        }
        return Ok(sanitized_plaintext.to_vec());
    }

    let normalized = normalize_to_crlf(sanitized_plaintext);
    let split_pos = normalized
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .ok_or_else(|| anyhow::anyhow!("malformed RFC5322 message: missing header/body separator"))?;

    let header_bytes = &normalized[..split_pos];
    let body_bytes = &normalized[split_pos + 4..];
    let header_str = std::str::from_utf8(header_bytes)
        .map_err(|_| anyhow::anyhow!("non-UTF8 RFC5322 headers"))?;

    let headers = parse_header_blocks(header_str);

    let mut top_headers: Vec<(String, String)> = Vec::new();
    let mut body_headers: Vec<(String, String)> = Vec::new();
    let mut has_mime_version = false;

    for (name, val) in headers {
        let lower = name.to_ascii_lowercase();
        if lower == "bcc" {
            continue;
        }
        if lower == "mime-version" {
            has_mime_version = true;
            top_headers.push((name, val));
            continue;
        }
        if matches!(
            lower.as_str(),
            "content-type" | "content-transfer-encoding" | "content-disposition"
        ) {
            body_headers.push((name, val));
        } else {
            top_headers.push((name, val));
        }
    }
    if !has_mime_version {
        top_headers.push(("MIME-Version".to_string(), "1.0".to_string()));
    }
    if !body_headers
        .iter()
        .any(|(n, _)| n.eq_ignore_ascii_case("content-type"))
    {
        body_headers.push((
            "Content-Type".to_string(),
            "text/plain; charset=UTF-8".to_string(),
        ));
    }

    let mixed_boundary = generate_unique_boundary("Mixed", &normalized);
    let inline_atts: Vec<&DecryptedMimeAttachment> = attachments
        .iter()
        .filter(|a| a.disposition == "inline" && !a.content_id.is_empty())
        .collect();
    let regular_atts: Vec<&DecryptedMimeAttachment> = attachments
        .iter()
        .filter(|a| !(a.disposition == "inline" && !a.content_id.is_empty()))
        .collect();

    let mut out = Vec::with_capacity(normalized.len() + 4096);
    for (name, val) in &top_headers {
        out.extend_from_slice(name.as_bytes());
        out.extend_from_slice(b": ");
        out.extend_from_slice(val.as_bytes());
        out.extend_from_slice(b"\r\n");
    }
    // Emit top-level Content-Type on one unfolded line so dkim_sign signs boundary= cleanly.
    out.extend_from_slice(
        format!(
            "Content-Type: multipart/mixed; boundary=\"{}\"\r\n\r\n",
            mixed_boundary
        )
        .as_bytes(),
    );

    if !inline_atts.is_empty() {
        let related_boundary = generate_unique_boundary("Related", &normalized);
        out.extend_from_slice(format!("--{}\r\n", mixed_boundary).as_bytes());
        out.extend_from_slice(
            format!(
                "Content-Type: multipart/related; boundary=\"{}\"\r\n\r\n",
                related_boundary
            )
            .as_bytes(),
        );

        write_body_part(&mut out, &related_boundary, &body_headers, body_bytes);
        for att in inline_atts {
            write_attachment_part(&mut out, &related_boundary, att);
        }
        out.extend_from_slice(format!("--{}--\r\n", related_boundary).as_bytes());
    } else {
        write_body_part(&mut out, &mixed_boundary, &body_headers, body_bytes);
    }

    for att in regular_atts {
        write_attachment_part(&mut out, &mixed_boundary, att);
    }

    out.extend_from_slice(format!("--{}--\r\n", mixed_boundary).as_bytes());
    if out.len() > max_mime_bytes {
        anyhow::bail!(
            "assembled MIME size {} bytes exceeds configured SMTP limit {} bytes",
            out.len(),
            max_mime_bytes
        );
    }
    Ok(out)
}

fn write_body_part(
    out: &mut Vec<u8>,
    boundary: &str,
    body_headers: &[(String, String)],
    body_bytes: &[u8],
) {
    out.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    for (name, val) in body_headers {
        out.extend_from_slice(name.as_bytes());
        out.extend_from_slice(b": ");
        out.extend_from_slice(val.as_bytes());
        out.extend_from_slice(b"\r\n");
    }
    out.extend_from_slice(b"\r\n");
    out.extend_from_slice(body_bytes);
    if !body_bytes.ends_with(b"\r\n") {
        out.extend_from_slice(b"\r\n");
    }
}

fn write_attachment_part(out: &mut Vec<u8>, boundary: &str, att: &DecryptedMimeAttachment) {
    let fname_params = format_disposition_filename_params(&att.filename);
    let ascii_name = sanitize_filename_ascii_safe(&att.filename);

    out.extend_from_slice(format!("--{}\r\n", boundary).as_bytes());
    out.extend_from_slice(
        format!(
            "Content-Type: {}; name=\"{}\"\r\n",
            att.content_type, ascii_name
        )
        .as_bytes(),
    );
    out.extend_from_slice(b"Content-Transfer-Encoding: base64\r\n");
    if att.disposition == "inline" && !att.content_id.is_empty() {
        let safe_cid = sanitize_content_id(&att.content_id);
        out.extend_from_slice(format!("Content-ID: <{}>\r\n", safe_cid).as_bytes());
        out.extend_from_slice(
            format!("Content-Disposition: inline; {}\r\n", fname_params).as_bytes(),
        );
    } else {
        out.extend_from_slice(
            format!("Content-Disposition: attachment; {}\r\n", fname_params).as_bytes(),
        );
    }
    out.extend_from_slice(b"\r\n");

    out.extend_from_slice(att.encoded_base64.as_bytes());
    out.extend_from_slice(b"\r\n");
}

/// Structured MIME builder supporting text-only, HTML-only, multipart/alternative (plain + HTML),
/// and multipart/mixed with attachments using RFC 2045 Quoted-Printable + Base64 and CRLF endings.
#[allow(dead_code)]
pub fn build_structured_mime_message(
    from: &str,
    to: &str,
    cc: Option<&str>,
    subject: &str,
    plain_body: Option<&str>,
    html_body: Option<&str>,
    attachments: &[DecryptedMimeAttachment],
) -> anyhow::Result<Vec<u8>> {
    let mut base = Vec::new();
    base.extend_from_slice(format!("From: {}\r\n", sanitize_header_value(from)).as_bytes());
    if !to.trim().is_empty() {
        base.extend_from_slice(format!("To: {}\r\n", sanitize_header_value(to)).as_bytes());
    }
    if let Some(cc_val) = cc {
        if !cc_val.trim().is_empty() {
            base.extend_from_slice(format!("Cc: {}\r\n", sanitize_header_value(cc_val)).as_bytes());
        }
    }
    base.extend_from_slice(format!("Subject: {}\r\n", sanitize_header_value(subject)).as_bytes());
    base.extend_from_slice(b"MIME-Version: 1.0\r\n");

    match (plain_body, html_body) {
        (Some(pt), Some(html)) => {
            let alt_boundary = generate_unique_boundary("Alt", pt.as_bytes());
            base.extend_from_slice(
                format!(
                    "Content-Type: multipart/alternative; boundary=\"{}\"\r\n\r\n",
                    alt_boundary
                )
                .as_bytes(),
            );
            base.extend_from_slice(format!("--{}\r\n", alt_boundary).as_bytes());
            base.extend_from_slice(b"Content-Type: text/plain; charset=UTF-8\r\n");
            base.extend_from_slice(b"Content-Transfer-Encoding: quoted-printable\r\n\r\n");
            base.extend_from_slice(encode_quoted_printable_crlf(pt.as_bytes()).as_bytes());
            base.extend_from_slice(b"\r\n");

            base.extend_from_slice(format!("--{}\r\n", alt_boundary).as_bytes());
            base.extend_from_slice(b"Content-Type: text/html; charset=UTF-8\r\n");
            base.extend_from_slice(b"Content-Transfer-Encoding: quoted-printable\r\n\r\n");
            base.extend_from_slice(encode_quoted_printable_crlf(html.as_bytes()).as_bytes());
            base.extend_from_slice(b"\r\n");
            base.extend_from_slice(format!("--{}--\r\n", alt_boundary).as_bytes());
        }
        (Some(pt), None) => {
            base.extend_from_slice(b"Content-Type: text/plain; charset=UTF-8\r\n");
            base.extend_from_slice(b"Content-Transfer-Encoding: quoted-printable\r\n\r\n");
            base.extend_from_slice(encode_quoted_printable_crlf(pt.as_bytes()).as_bytes());
            base.extend_from_slice(b"\r\n");
        }
        (None, Some(html)) => {
            base.extend_from_slice(b"Content-Type: text/html; charset=UTF-8\r\n");
            base.extend_from_slice(b"Content-Transfer-Encoding: quoted-printable\r\n\r\n");
            base.extend_from_slice(encode_quoted_printable_crlf(html.as_bytes()).as_bytes());
            base.extend_from_slice(b"\r\n");
        }
        (None, None) => {
            base.extend_from_slice(b"Content-Type: text/plain; charset=UTF-8\r\n\r\n\r\n");
        }
    }

    assemble_mime_with_attachments(&base, attachments)
}

#[cfg(test)]
mod tests {
    use super::*;
    use byos_crypto_core::{dkim_sign, verify_dkim_signature, DkimKeypair};

    fn make_att(name: &str, mime: &str, data: &[u8]) -> DecryptedMimeAttachment {
        DecryptedMimeAttachment::from_plaintext(
            name.to_string(),
            normalize_mime_type(mime),
            "attachment".to_string(),
            String::new(),
            Zeroizing::new(data.to_vec()),
        )
    }

    #[test]
    fn test_mime_text_only_and_html_only_and_alternative() {
        let text_only = build_structured_mime_message(
            "sender@byos.local",
            "rcpt@example.com",
            None,
            "Text Only",
            Some("Hello plain world"),
            None,
            &[],
        )
        .unwrap();
        let p1 = mailparse::parse_mail(&text_only).unwrap();
        assert_eq!(p1.ctype.mimetype, "text/plain");
        assert_eq!(p1.get_body().unwrap().trim(), "Hello plain world");

        let html_only = build_structured_mime_message(
            "sender@byos.local",
            "rcpt@example.com",
            None,
            "HTML Only",
            None,
            Some("<html><body><b>Hi</b></body></html>"),
            &[],
        )
        .unwrap();
        let p2 = mailparse::parse_mail(&html_only).unwrap();
        assert_eq!(p2.ctype.mimetype, "text/html");
        assert!(p2.get_body().unwrap().contains("<b>Hi</b>"));

        let alt = build_structured_mime_message(
            "sender@byos.local",
            "rcpt@example.com",
            None,
            "Alternative",
            Some("Plain text"),
            Some("<html><body><p>HTML text</p></body></html>"),
            &[],
        )
        .unwrap();
        let p3 = mailparse::parse_mail(&alt).unwrap();
        assert_eq!(p3.ctype.mimetype, "multipart/alternative");
        assert_eq!(p3.subparts.len(), 2);
        assert_eq!(p3.subparts[0].ctype.mimetype, "text/plain");
        assert_eq!(p3.subparts[1].ctype.mimetype, "text/html");
    }

    #[test]
    fn test_mime_mixed_single_and_multiple_attachments_roundtrip() {
        let pdf_bytes = b"%PDF-1.4\n%fake-pdf-payload\x00\x01\x02\xff%%EOF";
        let png_bytes = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDRfake-png";
        let docx_bytes = b"PK\x03\x04fake-docx-zip-binary-stream";

        let raw_alt = b"From: alice@byos.local\r\nTo: bob@example.com\r\nSubject: Multi Attach\r\nMIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary=\"alt_b\"\r\n\r\n--alt_b\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nHello Bob\r\n--alt_b\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>Hello Bob</p>\r\n--alt_b--\r\n";

        let atts = vec![
            make_att("document.pdf", "application/pdf", pdf_bytes),
            make_att("image.png", "image/png", png_bytes),
            make_att(
                "report.docx",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                docx_bytes,
            ),
        ];
        let assembled = assemble_mime_with_attachments(raw_alt, &atts).unwrap();
        let parsed = mailparse::parse_mail(&assembled).unwrap();
        assert_eq!(parsed.ctype.mimetype, "multipart/mixed");
        assert_eq!(parsed.subparts.len(), 4);
        assert_eq!(parsed.subparts[0].ctype.mimetype, "multipart/alternative");
        assert_eq!(parsed.subparts[1].get_body_raw().unwrap(), pdf_bytes);
        assert_eq!(parsed.subparts[2].get_body_raw().unwrap(), png_bytes);
        assert_eq!(parsed.subparts[3].get_body_raw().unwrap(), docx_bytes);
    }

    #[test]
    fn test_mime_unicode_filename_and_zero_byte_and_inline_cid() {
        let unicode_name = "résumé — 2026 日本語.pdf";
        let zero_bytes: &[u8] = b"";
        let inline_img = b"\x89PNG\r\n\x1a\ninline-pixel";

        let raw_html = b"From: alice@byos.local\r\nTo: bob@example.com\r\nSubject: Unicode + CID\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<img src=\"cid:logo123@byos.local\"/>\r\n";
        let atts = vec![
            DecryptedMimeAttachment::from_plaintext(
                "logo.png".to_string(),
                "image/png".to_string(),
                "inline".to_string(),
                "logo123@byos.local".to_string(),
                Zeroizing::new(inline_img.to_vec()),
            ),
            make_att(unicode_name, "application/pdf", b"unicode-doc"),
            make_att("empty.txt", "text/plain", zero_bytes),
        ];

        let assembled = assemble_mime_with_attachments(raw_html, &atts).unwrap();
        let parsed = mailparse::parse_mail(&assembled).unwrap();
        assert_eq!(parsed.ctype.mimetype, "multipart/mixed");
        assert_eq!(parsed.subparts.len(), 3);
        assert_eq!(parsed.subparts[0].ctype.mimetype, "multipart/related");
        assert_eq!(parsed.subparts[0].subparts.len(), 2);
        assert_eq!(parsed.subparts[0].subparts[1].get_body_raw().unwrap(), inline_img);

        let disp_hdr = parsed.subparts[1]
            .get_headers()
            .into_iter()
            .find(|h| h.get_key().eq_ignore_ascii_case("Content-Disposition"))
            .unwrap()
            .get_value();
        assert!(disp_hdr.contains("filename*=UTF-8''"));

        assert_eq!(parsed.subparts[2].get_body_raw().unwrap(), zero_bytes);
    }

    #[test]
    fn test_mime_crlf_line_endings_base64_wrap_and_injection_blocked() {
        let big_payload = vec![0xABu8; 200];
        let raw_text = b"From: alice@byos.local\r\nTo: bob@example.com\r\nSubject: CRLF\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nBody\nWith LF\r\n";
        let atts = vec![make_att(
            "evil\r\nBcc: spy@attacker.com\r\n.pdf",
            "application/pdf",
            &big_payload,
        )];
        let assembled = assemble_mime_with_attachments(raw_text, &atts).unwrap();
        let as_str = std::str::from_utf8(&assembled).unwrap();
        // Verify zero bare LF
        for (idx, b) in assembled.iter().enumerate() {
            if *b == b'\n' {
                assert!(idx > 0 && assembled[idx - 1] == b'\r', "found bare LF at {}", idx);
            }
        }
        // Verify header injection sanitized
        assert!(!as_str.contains("\r\nBcc:"));
        // Verify 76-char Base64 wrapping
        for line in as_str.split("\r\n") {
            if line.starts_with("q6ur") {
                assert!(line.len() <= 76);
            }
        }
    }

    #[test]
    fn test_mime_bcc_stripped_before_assembly_and_dkim_verifies() {
        let kp = DkimKeypair::generate("byos").unwrap();
        let raw_with_bcc = b"From: alice@byos.local\r\nTo: bob@example.com\r\nBcc: secret@example.com\r\nSubject: Secret BCC + PDF\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nHello Bob\r\n";
        let sanitized = crate::strip_bcc_headers(raw_with_bcc);
        let atts = vec![make_att("invoice.pdf", "application/pdf", b"%PDF-1.7-data")];
        let assembled = assemble_mime_with_attachments(&sanitized, &atts).unwrap();
        let signed = dkim_sign(&kp.private_key_pem, "byos", "byos.local", &assembled).unwrap();
        let signed_str = std::str::from_utf8(&signed).unwrap();
        assert!(!signed_str.to_ascii_lowercase().contains("\r\nbcc:"));
        assert!(verify_dkim_signature(&signed, &kp.public_key_pem));
    }

    #[test]
    fn test_keyring_rotation_epochs() {
        let (sk1, pk1) = byos_crypto_core::generate_outbound_delivery_keypair();
        let (sk2, pk2) = byos_crypto_core::generate_outbound_delivery_keypair();
        let json = format!(
            r#"{{
              "keys": [
                {{"key_epoch": 1, "key_id": "{}", "sk_b64": "{}", "status": "decrypt_only"}},
                {{"key_epoch": 2, "key_id": "{}", "sk_b64": "{}", "status": "active"}}
              ]
            }}"#,
            outbound_key_id_hex(&pk1),
            BASE64.encode(sk1),
            outbound_key_id_hex(&pk2),
            BASE64.encode(sk2)
        );
        let ring = OutboundKeyring::from_json_str(&json).unwrap();
        assert_eq!(ring.max_epoch(), 2);
        assert_eq!(ring.get_sk(1, &outbound_key_id_hex(&pk1)), Some(&sk1));
        assert_eq!(ring.get_sk(2, &outbound_key_id_hex(&pk2)), Some(&sk2));
        assert!(ring.get_sk(3, &outbound_key_id_hex(&pk2)).is_none());
    }

    #[test]
    fn test_mime_size_limit_and_cid_sanitization() {
        let raw_text = b"From: alice@byos.local\r\nTo: bob@example.com\r\nSubject: Size Limit\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nHi\r\n";
        let atts = vec![DecryptedMimeAttachment::from_plaintext(
            "big.bin".to_string(),
            "application/octet-stream".to_string(),
            "inline".to_string(),
            "cid123\r\nBcc: spy@evil.com".to_string(),
            Zeroizing::new(vec![0x41u8; 4096]),
        )];
        // Small cap must reject before SMTP
        let too_big = assemble_mime_with_attachments_limited(raw_text, &atts, 1024);
        assert!(too_big.is_err());

        // Under cap succeeds and strips CR/LF from Content-ID
        let ok = assemble_mime_with_attachments_limited(raw_text, &atts, 100_000).unwrap();
        let ok_str = std::str::from_utf8(&ok).unwrap();
        assert!(!ok_str.contains("\r\nBcc:"));
    }

    #[tokio::test]
    async fn test_fetch_auth_401_403_and_future_key_epoch_are_retryable() {
        use byos_crypto_core::{aes_gcm_encrypt, wrap_cek_outbound_v2};
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        use tokio::net::TcpListener;

        async fn spawn_http_mock<F>(handler: F) -> (std::net::SocketAddr, tokio::task::JoinHandle<()>)
        where
            F: Fn(&str) -> (u16, &'static str, Vec<u8>) + Send + Sync + 'static,
        {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let addr = listener.local_addr().unwrap();
            let handler = std::sync::Arc::new(handler);
            let handle = tokio::spawn(async move {
                loop {
                    let Ok((mut stream, _)) = listener.accept().await else {
                        break;
                    };
                    let h = handler.clone();
                    tokio::spawn(async move {
                        let mut buf = Vec::with_capacity(2048);
                        let mut tmp = [0u8; 512];
                        loop {
                            let Ok(n) = stream.read(&mut tmp).await else {
                                return;
                            };
                            if n == 0 {
                                break;
                            }
                            buf.extend_from_slice(&tmp[..n]);
                            if buf.windows(4).any(|w| w == b"\r\n\r\n") {
                                break;
                            }
                        }
                        let req_str = String::from_utf8_lossy(&buf);
                        let path = req_str
                            .lines()
                            .next()
                            .and_then(|l| l.split_whitespace().nth(1))
                            .unwrap_or("/");
                        let (status, ctype, body) = h(path);
                        let reason = match status {
                            200 => "OK",
                            401 => "Unauthorized",
                            403 => "Forbidden",
                            _ => "Error",
                        };
                        let hdr = format!(
                            "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                            status,
                            reason,
                            ctype,
                            body.len()
                        );
                        let _ = stream.write_all(hdr.as_bytes()).await;
                        let _ = stream.write_all(&body).await;
                    });
                }
            });
            (addr, handle)
        }

        let (sk1, pk1) = byos_crypto_core::generate_outbound_delivery_keypair();
        let ring = OutboundKeyring::from_single_sk(&sk1, 1).unwrap();
        let delivery_id = Uuid::new_v4();
        let mailbox_id = Uuid::new_v4();
        let lease_token = Uuid::new_v4();
        let att_id = Uuid::new_v4();
        let http = reqwest::Client::new();

        // 1. Manifest 401 -> Retryable (not Permanent)
        let (a1, h1) = spawn_http_mock(|_| (401, "text/plain", b"unauthorized".to_vec())).await;
        let err_401 = fetch_and_decrypt_attachments(
            &http,
            &a1.to_string(),
            "k",
            &ring,
            delivery_id,
            mailbox_id,
            1,
            1,
            lease_token,
        )
        .await
        .err()
        .unwrap();
        assert!(matches!(err_401, AttachmentFetchError::Retryable(_)));
        h1.abort();

        // 2. Blob 403 -> Retryable, and Future Epoch 9 > max_epoch 1 -> Retryable
        let plaintext = b"hello";
        let pt_sha = sha256_digest(plaintext);
        let meta_sha = attachment_metadata_sha256_v2(
            "a.txt",
            "text/plain",
            plaintext.len() as u64,
            &pt_sha,
            ATTACHMENT_DISPOSITION_ATTACHMENT,
            "",
        );
        let cek = [7u8; 32];
        let blob_aad = attachment_blob_aad_v2(
            mailbox_id.as_bytes(),
            att_id.as_bytes(),
            ATTACHMENT_CRYPTO_VERSION_V2,
            ATTACHMENT_AAD_VERSION_V2,
        );
        let ct = aes_gcm_encrypt(&cek, plaintext, &blob_aad).unwrap();
        let ct_sha = sha256_digest(&ct);
        let key_id_hex = outbound_key_id_hex(&pk1);
        let key_id_8 = outbound_key_id(&pk1);
        let out_aad = attachment_outbound_wrap_aad_v2(
            mailbox_id.as_bytes(),
            1,
            att_id.as_bytes(),
            &key_id_8,
            1,
            ATTACHMENT_CRYPTO_VERSION_V2 as u8,
            &meta_sha,
        );
        let wrapped = wrap_cek_outbound_v2(&pk1, &cek, &out_aad).unwrap();

        let manifest_blob403 = serde_json::json!({
            "delivery_id": delivery_id.to_string(),
            "mailbox_id": mailbox_id.to_string(),
            "outbox_seq": 1,
            "attachment_count": 1,
            "attachments": [{
                "attachment_id": att_id.to_string(),
                "position": 0,
                "disposition": "attachment",
                "content_id": "",
                "filename": "a.txt",
                "content_type": "text/plain",
                "crypto_version": 2,
                "blob_aad_version": 2,
                "plaintext_size_bytes": plaintext.len(),
                "ciphertext_size_bytes": ct.len(),
                "plaintext_sha256_hex": hex::encode(pt_sha),
                "ciphertext_sha256_hex": hex::encode(ct_sha),
                "wrap_alg": "HPKE-X25519-AES256GCM-v1",
                "outbound_key_id": key_id_hex,
                "outbound_key_epoch": 1,
                "cek_outbound_wrapped_b64": BASE64.encode(&wrapped),
                "metadata_sha256_hex": hex::encode(meta_sha),
            }]
        });
        let m1_bytes = serde_json::to_vec(&manifest_blob403).unwrap();
        let (a2, h2) = spawn_http_mock(move |path| {
            if path.ends_with("/blob") {
                (403, "text/plain", b"forbidden".to_vec())
            } else {
                (200, "application/json", m1_bytes.clone())
            }
        })
        .await;
        let err_403 = fetch_and_decrypt_attachments(
            &http,
            &a2.to_string(),
            "k",
            &ring,
            delivery_id,
            mailbox_id,
            1,
            1,
            lease_token,
        )
        .await
        .err()
        .unwrap();
        assert!(matches!(err_403, AttachmentFetchError::Retryable(_)));
        h2.abort();

        // 3. Future key epoch 9 (> max_epoch 1) -> Retryable
        let mut m_future = manifest_blob403;
        m_future["attachments"][0]["outbound_key_epoch"] = serde_json::json!(9);
        let m_future_bytes = serde_json::to_vec(&m_future).unwrap();
        let (a3, h3) = spawn_http_mock(move |_| (200, "application/json", m_future_bytes.clone())).await;
        let err_future = fetch_and_decrypt_attachments(
            &http,
            &a3.to_string(),
            "k",
            &ring,
            delivery_id,
            mailbox_id,
            1,
            1,
            lease_token,
        )
        .await
        .err()
        .unwrap();
        assert!(matches!(err_future, AttachmentFetchError::Retryable(_)));
        h3.abort();
    }

    fn build_signed_v2_test_fixture(
        mailbox_id: Uuid,
        delivery_id: Uuid,
        outbox_seq: i64,
        pk: &[u8; 32],
        filename: &str,
        content_type: &str,
        plaintext: &[u8],
    ) -> (Vec<u8>, serde_json::Value) {
        use byos_crypto_core::{aes_gcm_encrypt, wrap_cek_outbound_v2};
        let att_id = Uuid::new_v4();
        let pt_sha = sha256_digest(plaintext);
        let meta_sha = attachment_metadata_sha256_v2(
            filename,
            content_type,
            plaintext.len() as u64,
            &pt_sha,
            ATTACHMENT_DISPOSITION_ATTACHMENT,
            "",
        );
        let cek = [0x33u8; 32];
        let blob_aad = attachment_blob_aad_v2(
            mailbox_id.as_bytes(),
            att_id.as_bytes(),
            ATTACHMENT_CRYPTO_VERSION_V2,
            ATTACHMENT_AAD_VERSION_V2,
        );
        let ct = aes_gcm_encrypt(&cek, plaintext, &blob_aad).unwrap();
        let ct_sha = sha256_digest(&ct);
        let key_id_hex = outbound_key_id_hex(pk);
        let key_id_8 = outbound_key_id(pk);
        let out_aad = attachment_outbound_wrap_aad_v2(
            mailbox_id.as_bytes(),
            outbox_seq as u64,
            att_id.as_bytes(),
            &key_id_8,
            1,
            ATTACHMENT_CRYPTO_VERSION_V2 as u8,
            &meta_sha,
        );
        let wrapped = wrap_cek_outbound_v2(pk, &cek, &out_aad).unwrap();
        let manifest = serde_json::json!({
            "delivery_id": delivery_id.to_string(),
            "mailbox_id": mailbox_id.to_string(),
            "outbox_seq": outbox_seq,
            "attachment_count": 1,
            "attachments": [{
                "attachment_id": att_id.to_string(),
                "position": 0,
                "disposition": "attachment",
                "content_id": "",
                "filename": filename,
                "content_type": content_type,
                "crypto_version": 2,
                "blob_aad_version": 2,
                "plaintext_size_bytes": plaintext.len(),
                "ciphertext_size_bytes": ct.len(),
                "plaintext_sha256_hex": hex::encode(pt_sha),
                "ciphertext_sha256_hex": hex::encode(ct_sha),
                "wrap_alg": "HPKE-X25519-AES256GCM-v1",
                "outbound_key_id": key_id_hex,
                "outbound_key_epoch": 1,
                "cek_outbound_wrapped_b64": BASE64.encode(&wrapped),
                "metadata_sha256_hex": hex::encode(meta_sha),
            }]
        });
        (ct, manifest)
    }

    #[tokio::test]
    async fn test_fetch_interrupted_retrieval_and_incomplete_object_and_corrupt_decryption() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Arc;
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        use tokio::net::TcpListener;

        let (sk1, pk1) = byos_crypto_core::generate_outbound_delivery_keypair();
        let ring = OutboundKeyring::from_single_sk(&sk1, 1).unwrap();
        let delivery_id = Uuid::new_v4();
        let mailbox_id = Uuid::new_v4();
        let lease_token = Uuid::new_v4();
        let http = reqwest::Client::new();

        let plaintext = vec![0x42u8; 4096];
        let (ct, manifest) = build_signed_v2_test_fixture(
            mailbox_id,
            delivery_id,
            1,
            &pk1,
            "sample.bin",
            "application/octet-stream",
            &plaintext,
        );
        let manifest_bytes = serde_json::to_vec(&manifest).unwrap();

        // 1. Interrupted retrieval: TCP closes mid-body after advertising full Content-Length -> Retryable
        let listener_int = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr_int = listener_int.local_addr().unwrap();
        let m_int = manifest_bytes.clone();
        let ct_int = ct.clone();
        let h_int = tokio::spawn(async move {
            loop {
                let Ok((mut stream, _)) = listener_int.accept().await else {
                    break;
                };
                let m = m_int.clone();
                let c = ct_int.clone();
                tokio::spawn(async move {
                    let mut buf = [0u8; 2048];
                    let n = stream.read(&mut buf).await.unwrap_or(0);
                    let req = String::from_utf8_lossy(&buf[..n]);
                    let path = req.lines().next().and_then(|l| l.split_whitespace().nth(1)).unwrap_or("/");
                    if path.ends_with("/blob") {
                        let hdr = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                            c.len()
                        );
                        let _ = stream.write_all(hdr.as_bytes()).await;
                        let _ = stream.write_all(&c[..128]).await;
                        let _ = stream.flush().await;
                        drop(stream); // Abrupt mid-body TCP close before Content-Length bytes!
                    } else {
                        let hdr = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                            m.len()
                        );
                        let _ = stream.write_all(hdr.as_bytes()).await;
                        let _ = stream.write_all(&m).await;
                    }
                });
            }
        });
        let err_interrupted = fetch_and_decrypt_attachments(
            &http,
            &addr_int.to_string(),
            "k",
            &ring,
            delivery_id,
            mailbox_id,
            1,
            1,
            lease_token,
        )
        .await
        .err()
        .expect("interrupted stream must fail");
        assert!(
            matches!(err_interrupted, AttachmentFetchError::Retryable(_)),
            "expected Retryable for interrupted stream, got {:?}",
            err_interrupted
        );
        h_int.abort();

        // 2. Incomplete object on clean HTTP EOF (actual_bytes < ciphertext_size_bytes) -> Permanent
        let listener_inc = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr_inc = listener_inc.local_addr().unwrap();
        let m_inc = manifest_bytes.clone();
        let ct_inc = ct.clone();
        let h_inc = tokio::spawn(async move {
            loop {
                let Ok((mut stream, _)) = listener_inc.accept().await else {
                    break;
                };
                let m = m_inc.clone();
                let c = ct_inc.clone();
                tokio::spawn(async move {
                    let mut buf = [0u8; 2048];
                    let n = stream.read(&mut buf).await.unwrap_or(0);
                    let req = String::from_utf8_lossy(&buf[..n]);
                    let path = req.lines().next().and_then(|l| l.split_whitespace().nth(1)).unwrap_or("/");
                    if path.ends_with("/blob") {
                        let truncated = &c[..100];
                        let hdr = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                            truncated.len()
                        );
                        let _ = stream.write_all(hdr.as_bytes()).await;
                        let _ = stream.write_all(truncated).await;
                    } else {
                        let hdr = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                            m.len()
                        );
                        let _ = stream.write_all(hdr.as_bytes()).await;
                        let _ = stream.write_all(&m).await;
                    }
                });
            }
        });
        let err_incomplete = fetch_and_decrypt_attachments(
            &http,
            &addr_inc.to_string(),
            "k",
            &ring,
            delivery_id,
            mailbox_id,
            1,
            1,
            lease_token,
        )
        .await
        .err()
        .expect("incomplete blob must fail");
        assert!(
            matches!(err_incomplete, AttachmentFetchError::Permanent(ref s) if s.contains("incomplete attachment blob")),
            "expected Permanent incomplete blob, got {:?}",
            err_incomplete
        );
        h_inc.abort();

        // 3. Corrupted ciphertext (ciphertext_sha256 mismatch) AND AEAD decryption failure (with matching ct_sha) -> Permanent
        let mut ct_corrupt = ct.clone();
        let last_idx = ct_corrupt.len() - 1;
        ct_corrupt[last_idx] ^= 0xFF;

        let mut manifest_matching_corrupt_sha = manifest.clone();
        manifest_matching_corrupt_sha["attachments"][0]["ciphertext_sha256_hex"] =
            serde_json::json!(hex::encode(sha256_digest(&ct_corrupt)));
        let m_aead_bytes = serde_json::to_vec(&manifest_matching_corrupt_sha).unwrap();

        for (label, m_vec) in [
            ("ciphertext_sha256 mismatch", manifest_bytes.clone()),
            ("AEAD tag failure", m_aead_bytes),
        ] {
            let listener_bad = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let addr_bad = listener_bad.local_addr().unwrap();
            let c_bad = ct_corrupt.clone();
            let h_bad = tokio::spawn(async move {
                loop {
                    let Ok((mut stream, _)) = listener_bad.accept().await else {
                        break;
                    };
                    let m = m_vec.clone();
                    let c = c_bad.clone();
                    tokio::spawn(async move {
                        let mut buf = [0u8; 2048];
                        let n = stream.read(&mut buf).await.unwrap_or(0);
                        let req = String::from_utf8_lossy(&buf[..n]);
                        let path = req.lines().next().and_then(|l| l.split_whitespace().nth(1)).unwrap_or("/");
                        let body = if path.ends_with("/blob") { &c } else { &m };
                        let ctype = if path.ends_with("/blob") { "application/octet-stream" } else { "application/json" };
                        let hdr = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                            ctype,
                            body.len()
                        );
                        let _ = stream.write_all(hdr.as_bytes()).await;
                        let _ = stream.write_all(body).await;
                    });
                }
            });
            let err_bad = fetch_and_decrypt_attachments(
                &http,
                &addr_bad.to_string(),
                "k",
                &ring,
                delivery_id,
                mailbox_id,
                1,
                1,
                lease_token,
            )
            .await
            .err()
            .expect("corrupt ciphertext must fail");
            assert!(
                matches!(err_bad, AttachmentFetchError::Permanent(_)),
                "expected Permanent for {}, got {:?}",
                label,
                err_bad
            );
            h_bad.abort();
        }

        // 4. HPKE unwrap decryption failure (tampered cek_outbound_wrapped_b64) -> Permanent
        let mut manifest_bad_hpke = manifest.clone();
        let mut wrapped_raw = BASE64
            .decode(manifest["attachments"][0]["cek_outbound_wrapped_b64"].as_str().unwrap())
            .unwrap();
        let wlen = wrapped_raw.len();
        wrapped_raw[wlen - 1] ^= 0xAA;
        manifest_bad_hpke["attachments"][0]["cek_outbound_wrapped_b64"] =
            serde_json::json!(BASE64.encode(&wrapped_raw));
        let m_hpke_bytes = serde_json::to_vec(&manifest_bad_hpke).unwrap();
        let listener_hpke = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr_hpke = listener_hpke.local_addr().unwrap();
        let h_hpke = tokio::spawn(async move {
            loop {
                let Ok((mut stream, _)) = listener_hpke.accept().await else {
                    break;
                };
                let m = m_hpke_bytes.clone();
                tokio::spawn(async move {
                    let mut buf = [0u8; 2048];
                    let _ = stream.read(&mut buf).await;
                    let hdr = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        m.len()
                    );
                    let _ = stream.write_all(hdr.as_bytes()).await;
                    let _ = stream.write_all(&m).await;
                });
            }
        });
        let err_hpke = fetch_and_decrypt_attachments(
            &http,
            &addr_hpke.to_string(),
            "k",
            &ring,
            delivery_id,
            mailbox_id,
            1,
            1,
            lease_token,
        )
        .await
        .err()
        .expect("bad HPKE wrap must fail");
        assert!(
            matches!(err_hpke, AttachmentFetchError::Permanent(ref s) if s.contains("HPKE unwrap")),
            "expected Permanent HPKE unwrap failure, got {:?}",
            err_hpke
        );
        h_hpke.abort();

        // 5. Exceeding 25 MiB plaintext limit -> Permanent before any /blob fetch
        let blob_calls = Arc::new(AtomicUsize::new(0));
        let blob_calls_c = blob_calls.clone();
        let mut item0 = manifest["attachments"][0].clone();
        item0["plaintext_size_bytes"] = serde_json::json!(20 * 1024 * 1024);
        item0["ciphertext_size_bytes"] = serde_json::json!(20 * 1024 * 1024 + 29);
        let mut item1 = item0.clone();
        item1["attachment_id"] = serde_json::json!(Uuid::new_v4().to_string());
        item1["position"] = serde_json::json!(1);
        item1["plaintext_size_bytes"] = serde_json::json!(5 * 1024 * 1024 + 1);
        item1["ciphertext_size_bytes"] = serde_json::json!(5 * 1024 * 1024 + 1 + 29);
        let over_manifest = serde_json::to_vec(&serde_json::json!({
            "delivery_id": delivery_id.to_string(),
            "mailbox_id": mailbox_id.to_string(),
            "outbox_seq": 1,
            "attachment_count": 2,
            "attachments": [item0, item1],
        }))
        .unwrap();
        let listener_over = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr_over = listener_over.local_addr().unwrap();
        let h_over = tokio::spawn(async move {
            loop {
                let Ok((mut stream, _)) = listener_over.accept().await else {
                    break;
                };
                let m = over_manifest.clone();
                let calls = blob_calls_c.clone();
                tokio::spawn(async move {
                    let mut buf = [0u8; 2048];
                    let n = stream.read(&mut buf).await.unwrap_or(0);
                    let req = String::from_utf8_lossy(&buf[..n]);
                    if req.contains("/blob") {
                        calls.fetch_add(1, Ordering::SeqCst);
                    }
                    let hdr = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        m.len()
                    );
                    let _ = stream.write_all(hdr.as_bytes()).await;
                    let _ = stream.write_all(&m).await;
                });
            }
        });
        let err_over = fetch_and_decrypt_attachments(
            &http,
            &addr_over.to_string(),
            "k",
            &ring,
            delivery_id,
            mailbox_id,
            1,
            2,
            lease_token,
        )
        .await
        .err()
        .expect("over 25 MiB must fail");
        assert!(
            matches!(err_over, AttachmentFetchError::Permanent(ref s) if s.contains("25 MiB")),
            "expected Permanent 25 MiB limit failure, got {:?}",
            err_over
        );
        assert_eq!(blob_calls.load(Ordering::SeqCst), 0, "must reject oversized manifest before fetching blobs");
        h_over.abort();

        // 6. Mailbox ownership mismatch in manifest -> Permanent before any /blob fetch
        let mut wrong_mb = manifest.clone();
        wrong_mb["mailbox_id"] = serde_json::json!(Uuid::new_v4().to_string());
        let wrong_mb_bytes = serde_json::to_vec(&wrong_mb).unwrap();
        let listener_mb = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr_mb = listener_mb.local_addr().unwrap();
        let h_mb = tokio::spawn(async move {
            loop {
                let Ok((mut stream, _)) = listener_mb.accept().await else {
                    break;
                };
                let m = wrong_mb_bytes.clone();
                tokio::spawn(async move {
                    let mut buf = [0u8; 2048];
                    let _ = stream.read(&mut buf).await;
                    let hdr = format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        m.len()
                    );
                    let _ = stream.write_all(hdr.as_bytes()).await;
                    let _ = stream.write_all(&m).await;
                });
            }
        });
        let err_mb = fetch_and_decrypt_attachments(
            &http,
            &addr_mb.to_string(),
            "k",
            &ring,
            delivery_id,
            mailbox_id,
            1,
            1,
            lease_token,
        )
        .await
        .err()
        .expect("wrong mailbox_id in manifest must fail");
        assert!(
            matches!(err_mb, AttachmentFetchError::Permanent(ref s) if s.contains("identity mismatch")),
            "expected Permanent identity mismatch, got {:?}",
            err_mb
        );
        h_mb.abort();
    }

    #[test]
    fn test_mime_spaces_special_chars_and_unicode_filenames() {
        let raw_text = b"From: alice@byos.local\r\nTo: bob@example.com\r\nSubject: Special Filenames\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nBody\r\n";
        let special_ascii = "report \"final\"; v2 (draft) & summary.pdf";
        let unicode_special = "résumé — \"2026\"; 日本語 file.docx";
        let payload_a = b"%PDF-1.4-special-chars";
        let payload_b = b"PK\x03\x04unicode-special-chars";

        let atts = vec![
            make_att(special_ascii, "application/pdf", payload_a),
            make_att(
                unicode_special,
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                payload_b,
            ),
        ];
        let assembled = assemble_mime_with_attachments(raw_text, &atts).unwrap();
        let parsed = mailparse::parse_mail(&assembled).unwrap();
        assert_eq!(parsed.ctype.mimetype, "multipart/mixed");
        assert_eq!(parsed.subparts.len(), 3);

        let disp1 = parsed.subparts[1]
            .get_headers()
            .into_iter()
            .find(|h| h.get_key().eq_ignore_ascii_case("Content-Disposition"))
            .unwrap()
            .get_value();
        assert!(disp1.contains("filename=\"report _final__ v2 (draft) & summary.pdf\""), "got {}", disp1);
        assert!(disp1.contains("filename*=UTF-8''report%20%22final%22%3B%20v2%20%28draft%29%20&%20summary.pdf"), "got {}", disp1);

        let disp2 = parsed.subparts[2]
            .get_headers()
            .into_iter()
            .find(|h| h.get_key().eq_ignore_ascii_case("Content-Disposition"))
            .unwrap()
            .get_value();
        assert!(disp2.contains("filename*=UTF-8''r%C3%A9sum%C3%A9"), "got {}", disp2);
        assert_eq!(parsed.subparts[1].get_body_raw().unwrap(), payload_a);
        assert_eq!(parsed.subparts[2].get_body_raw().unwrap(), payload_b);
    }

    #[test]
    fn test_mime_html_only_with_attachment_and_dkim() {
        let html_msg = b"From: alice@byos.local\r\nTo: bob@example.com\r\nBcc: secret@example.com\r\nSubject: HTML + PDF\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<html><body><p>Hello <b>HTML</b> only</p></body></html>\r\n";
        let sanitized = crate::strip_bcc_headers(html_msg);
        let pdf_bytes = b"%PDF-1.7-html-only-test";
        let atts = vec![make_att("summary.pdf", "application/pdf", pdf_bytes)];
        let assembled = assemble_mime_with_attachments(&sanitized, &atts).unwrap();
        let assembled_str = String::from_utf8_lossy(&assembled);
        assert!(!assembled_str.to_ascii_lowercase().contains("\r\nbcc:"));

        let parsed = mailparse::parse_mail(&assembled).unwrap();
        assert_eq!(parsed.ctype.mimetype, "multipart/mixed");
        assert_eq!(parsed.subparts.len(), 2);
        assert_eq!(parsed.subparts[0].ctype.mimetype, "text/html");
        assert!(parsed.subparts[0].get_body().unwrap().contains("<b>HTML</b>"));
        assert_eq!(parsed.subparts[1].ctype.mimetype, "application/pdf");
        assert_eq!(parsed.subparts[1].get_body_raw().unwrap(), pdf_bytes);

        let kp = byos_crypto_core::DkimKeypair::generate("byos").unwrap();
        let signed = byos_crypto_core::dkim_sign(&kp.private_key_pem, "byos", "byos.local", &assembled).unwrap();
        assert!(verify_dkim_signature(&signed, &kp.public_key_pem));
    }

    #[tokio::test]
    async fn test_fetch_rejects_negative_outbox_seq() {
        let (sk, _pk) = byos_crypto_core::generate_outbound_delivery_keypair();
        let keyring = OutboundKeyring::from_single_sk(&sk, 1).unwrap();
        let http = reqwest::Client::new();
        let err = fetch_and_decrypt_attachments_with_metrics(
            &http,
            "127.0.0.1:1",
            "k",
            &keyring,
            Uuid::new_v4(),
            Uuid::new_v4(),
            -1,
            1,
            Uuid::new_v4(),
        )
        .await
        .err()
        .expect("negative outbox_seq must fail");
        assert!(matches!(err, AttachmentFetchError::Permanent(ref s) if s.contains("negative outbox_seq")));
    }
}
